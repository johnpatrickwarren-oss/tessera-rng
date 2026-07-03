/**
 * Tomographic localization (v1 spec AC-5; the new math, ADR-0001; leaky-LLR scorer, ADR-0016;
 * exposure-saturating noisy-OR, ADR-0019; marginal-LLR set construction, ADR-0022 — the greedy
 * cover scores each candidate against what the picked set ALREADY predicts, via per-leaf
 * residual quiet factors, instead of a binary explained-set).
 *
 * Inverse problem: given the e-BH-selected (firing) leaf set, recover the minimal set of shared
 * physical resources whose joint failure best explains it. We model fault → firing as a LEAKY
 * noisy-OR and score each candidate resource by the log-likelihood ratio of its members' observed
 * firing pattern under (faulty) vs (clean), then run greedy set-cover deterministically on that LLR.
 *
 * Per member i of resource r, with traffic weight wᵢ (ADR-0014), under fault strength δ and
 * exposure scale κ (ADR-0019):
 *   - clean (null):  P(fire) = q₀  (the floored fleet base rate from the surface, ADR-0016).
 *   - faulty:        P(quiet) = (1−q₀)·(1−δ)^{κ·wᵢ}  — the true noisy-OR: κ·wᵢ independent
 *     exposure "trials" each failing with probability δ. At κ·w small the fire probability is
 *     ≈ q₀ + κw·δ·(1−q₀) (first order — near the ADR-0016 linear leak when q₀δ is negligible);
 *     at κ·w large it SATURATES toward 1.
 * The true (δ, κ) are unknown, so we MIX over the deterministic product grid δ ∈ {0.3, 0.6, 0.9} ×
 * κ ∈ {1, 16, 256} (method of mixtures: average per-cell likelihoods, then LLR vs null). This is
 * weight-aware FALSIFICATION both ways: a QUIET high-weight member is strong evidence AGAINST a
 * resource (the high-κ components predict it fires), while saturation lets an extreme fault's
 * leakage into 1/64-diluted leaves be EXPECTED rather than surprising — without it, a coarse
 * pair-view resource out-explains the true optic at high δ (the ADR-0016 C1 residue) and a true
 * room fault mislocalizes to a panel at every δ (the latent defect the ADR-0019 probe surfaced).
 * It subsumes `collateralWeight` (the ADR-0016 step) and the C1 pin (the ADR-0019 step).
 *
 * The union of dependent views means leaves overlap physically; the product over leaves is a stated
 * COMPOSITE (pseudo-)likelihood — valid for RANKING candidates on the same observation set, not for
 * calibrated posteriors. That is consistent with the `correlational_not_causal` contract (N1).
 *
 * MUST-NEVER (N1): output is a shared-resource GROUP with a correlational-not-causal flag, never a
 * single-component hardware root cause. Unexplained firing paths are reported (instrumented-caveat).
 */
import type { FaultDomainSnapshot, PathClassId, ResourceId, ResourceKind } from './domain';
import type { Culprit } from './verdict';
import { ambiguityGroupsByResource } from './identifiability';

export interface LocalizeOpts {
  /** fault-strength grid the leaky-LLR mixes over (ADR-0016). The grid implicitly assumes δ > q₀:
   *  once q₀ exceeds a grid point, q₁ < q₀ there and a saturating fleet eventually scores nothing —
   *  deliberate (a fleet-wide event is not localizable to a shared resource). */
  grid: number[];
  /** exposure-scale grid κ (ADR-0019), mixed with `grid` as a product: κ·w is the member's
   *  effective number of exposure trials. κ = 1 ≈ the ADR-0016 linear leak; large κ expresses an
   *  extreme fault whose leakage saturates even heavily diluted members. */
  kappas: number[];
  /** floored fleet base firing rate q₀ — the LLR null. The pipeline ALWAYS overrides this with the
   *  surface's `base_rate_q0`; the default 0.01 is only a conventional quiet-fleet value for direct
   *  localize() callers (e.g. unit fixtures) with no surface in hand. */
  q0: number;
  /** parsimony cap: never return more than this many resources. */
  maxResources: number;
  /** failure-mode CONTROL ONLY (ADR-0016): the legacy linear scorer `Σ newly·w − λ·Σ quiet·w`. */
  legacy?: boolean;
  /** collateral weight λ for the legacy scorer only. */
  collateralWeight?: number;
  /**
   * OPT-IN magnitude scorer (ADR-0029, Phase 1): per-firing-leaf combined e-value. When present,
   * the member likelihood generalizes from Bernoulli(`fired`) to the continuous soft-evidence LR
   * `μz − μ²/2` (z = magnitudeZ(e_value); quiet members z = 0). ABSENT ⇒ the exact binary scorer
   * above, byte-for-byte (the default-preservation guarantee). The (δ, κ) mixture, the 1/κ prior,
   * the marginal-LLR construction and the posterior fold are unchanged in form. Every firing leaf
   * MUST appear in the map (fail-closed). The pipeline does NOT pass this in Phase 1 — it is proven
   * dormant; the flip to magnitude-by-default is Phase 2 (ADR-0031), alongside the cross-optic fabric.
   */
  magnitude?: ReadonlyMap<PathClassId, number>;
  /** fault-amplitude grid S the magnitude scorer mixes over with a 1/S prior (ADR-0029 D2); only used
   *  when `magnitude` is set. Fixed-form, not a tunable knob — the meaningful 1–4σ standardized range. */
  scales?: number[];
  /** z-calibration (ADR-0033): the number of observations the magnitude e-values were ACCRUED over,
   *  so z = √(2·max(ln E,0)/ticks) ≈ the per-tick shift θ (on μ's O(1) scale). Absent/1 ⇒ the raw
   *  single-observation z. The pipeline passes its window tick count when it wires magnitude. */
  magnitudeTicks?: number;
  /**
   * LINEAR t-statistic currency (ADR-0046): per-FIRING-leaf magnitude y on the θ√T (accrued)
   * scale — the caller composes y = max(t-statistic, z(E)) so mean-shift evidence rides the
   * unsaturated t and C/D-mode evidence rides z. When present, the member model becomes the
   * exact Gaussian mean model y ~ N(θ·w·√T, 1) mixed over the fixed `thetas` grid with a 1/θ
   * prior; the null is y ~ N(0, 1) — PARAMETER-FREE: q₀ exits the magnitude path (the ADR-0034
   * root-cause-1 corruption dissolves), κ and S disappear (dilution is w, severity is θ, and the
   * observation scale itself no longer saturates). Takes precedence over `magnitude`. Every
   * firing leaf MUST appear in the map (fail-closed). A virtual fleet-event candidate
   * (`FLEET_RESOURCE_ID`, w = 1 on every leaf) competes in the cover: a genuinely uniform
   * elevation is reported as a non-drainable fleet_common_mode culprit instead of a fabricated
   * physical one, while a broad-but-structured fault (room) still beats it — each quiet leaf
   * costs the fleet candidate μ²/2 the room does not pay.
   */
  magnitudeT?: ReadonlyMap<PathClassId, number>;
  /** fault-strength grid θ (per-tick standardized shift) for the linear model; fixed form, not a
   *  knob — spans the sub-floor band to the C1 extreme (δ=128). */
  thetas?: number[];
}

/** Reserved id of the virtual fleet-event candidate (ADR-0046); never a physical resource. */
export const FLEET_RESOURCE_ID = '__fleet__';

/** Fixed θ grid + 1/θ prior (ADR-0046): admit the per-tick fault strength is unknown and mix.
 *  The low end (¼, ½) covers weak-magnitude evidence — C/D-mode leaves whose y rides z(E) with no
 *  mean shift, and sub-floor mean shifts — where θ ≥ 1 would over-predict (μ = θ·w·√T ≥ √T) and
 *  falsify every candidate into abstention; the high end spans the C1 extreme (δ = 128). */
export const DEFAULT_THETAS: number[] = Object.freeze([0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128]) as number[];

/** Fixed S grid + 1/S prior (ADR-0029 D2): admit the fault amplitude is unknown and mix, never fit it. */
export const DEFAULT_SCALES: number[] = Object.freeze([1, 2, 4]) as number[];

export const DEFAULT_LOCALIZE: LocalizeOpts = Object.freeze({
  grid: Object.freeze([0.3, 0.6, 0.9]) as number[],
  kappas: Object.freeze([1, 16, 256]) as number[],
  q0: 0.01,
  maxResources: 16,
});

export interface LocalizationResult {
  /** ranked minimal explaining set (rank-1 = strongest explanation). */
  culprits: Culprit[];
  explained_path_class_ids: PathClassId[];
  /** firing paths no parsimonious resource set explains (reported, never hidden). */
  unexplained_path_class_ids: PathClassId[];
}

interface Member {
  pc: PathClassId;
  weight: number;
  fired: boolean;
}
interface Acc {
  members: Member[];
  firing: PathClassId[];
}

function accumulate(snapshot: FaultDomainSnapshot, fired: ReadonlySet<PathClassId>): Map<ResourceId, Acc> {
  const acc = new Map<ResourceId, Acc>();
  for (const e of snapshot.edges) {
    let a = acc.get(e.resource);
    if (!a) {
      a = { members: [], firing: [] };
      acc.set(e.resource, a);
    }
    const isFiring = fired.has(e.path_class);
    a.members.push({ pc: e.path_class, weight: e.weight ?? 1, fired: isFiring });
    if (isFiring) a.firing.push(e.path_class);
  }
  return acc;
}

interface Pick {
  resource: ResourceId;
  score: number;
  newly: PathClassId[];
}

/** One (δ, κ) mixture cell with its grid coordinates (needed for the posterior fold, ADR-0022). */
interface MixCell {
  ll: number;
  logPrior: number;
  d: number;
  k: number;
}

/** log( Σᵢ priorᵢ·exp(llᵢ) ), Σ prior = 1 — stable prior-weighted mixture (ADR-0019). */
function logMixExp(cells: ReadonlyArray<{ ll: number; logPrior: number }>): number {
  const max = Math.max(...cells.map((c) => c.ll + c.logPrior));
  let s = 0;
  for (const c of cells) s += Math.exp(c.ll + c.logPrior - max);
  return max + Math.log(s);
}

/**
 * One member's log-likelihood under (faulty, δ, κ) given the picked set's residual quiet factor
 * logG — the SATURATING leaky noisy-OR (ADR-0019) with marginal bookkeeping (ADR-0022):
 *   log P(quiet) = log(1−q₀) + logG + κ·w·log(1−δ)   (exact, no clamp)
 * κ is the exposure scale: at κ·w large the fire probability SATURATES toward 1, which the old
 * linear leak q₁ = q₀+(δ−q₀)·w could not express — an extreme fault fires even a 1/64-diluted
 * leaf reliably, and a model that cannot say so hands the coarse pair-view resource the win
 * (the ADR-0016 C1 residue, closed by ADR-0019) and mislocalizes a true room fault entirely.
 * With logG = 0 (nothing picked, or leaf untouched) this is exactly the ADR-0019 form.
 */
function memberLLMarginal(fired: boolean, q0: number, logG: number, d: number, kw: number): number {
  const logQuiet = Math.log1p(-q0) + logG + kw * Math.log1p(-d);
  return fired ? Math.log(-Math.expm1(logQuiet)) : logQuiet;
}

/** A member's log-likelihood under the PICKED SET ALONE (the marginal-LLR base, ADR-0022). */
function memberLLBase(fired: boolean, q0: number, logG: number): number {
  const logQuiet = Math.log1p(-q0) + logG;
  return fired ? Math.log(-Math.expm1(logQuiet)) : logQuiet;
}

/**
 * Magnitude currency (ADR-0029 D1): z(E) = √(2·max(ln E, 0)). An e-value's growth rate E[log E] is
 * the alt-vs-null KL, which for a standardized mean shift θ is θ²/2 — so log E ≈ θ²/2 and z ≈ θ,
 * mapping the combined e-value back to the standardized-shift scale the Gaussian LR below lives on.
 * E ≤ 1 ⇒ z = 0 (clean members sit at zero). Literal effect size for Family A; a monotone evidence
 * proxy for C/D (admissible because tomography is RANKING, N1 — recorded, not hidden).
 */
/** z is capped at a large-but-finite value: a combined e-value CAN overflow to +∞ (a hugely-fired
 *  leaf), which is genuine "infinitely strong" evidence — but z=∞ ⇒ μz=∞ ⇒ NaN in logMixExp. Cap so
 *  the LR stays finite. The cap DOES bite in the extreme-δ regime where accrued e-values overflow
 *  (recorded in ADR-0031): there it flattens magnitude discrimination — part of why high-δ recovery
 *  is lost. It never bites a moderate-δ value, where recovery holds.
 *
 *  SCALE CAVEAT (ADR-0031 cold-eye): the pipeline feeds the MULTI-TICK ACCRUED combined e-value, so
 *  ln E ≈ T·θ²/2 and z ≈ θ·√T (≈ 7.7·θ at T=60), NOT the literal per-tick shift θ the unit identity
 *  z(e^{θ²/2})=θ suggests. Since √T inflates every firing leaf uniformly, z stays a MONOTONE evidence
 *  proxy — valid for RANKING (N1), which is all tomography claims — but `μz − μ²/2` is NOT a calibrated
 *  per-tick LR in production (μ ~ O(1–4), z ~ O(10–40), so the −μ²/2 falsification term is under-scaled
 *  vs the evidence term). Calibrating z to the per-tick scale is a recorded prerequisite for the
 *  production pipeline flip (it does not affect this round: the scorer ships dormant). */
const Z_MAX = 40;
export function magnitudeZ(eValue: number, ticks = 1): number {
  // Throw on a NEGATIVE or NaN e-value (a contract violation that would otherwise silently NaN-vanish
  // the candidate via the `!(score > 0)` gate). +∞ is a legitimate extreme — clamp it, don't throw.
  if (Number.isNaN(eValue) || eValue < 0) throw new RangeError(`magnitudeZ: e-value must be ≥ 0 — got ${eValue}`);
  // z-CALIBRATION (ADR-0033): the pipeline's e-value is ACCRUED over `ticks` observations, so
  // ln E ≈ ticks·θ²/2. Dividing by ticks recovers the PER-TICK standardized shift z ≈ θ — putting z
  // on the same O(1) scale as μ = S·L, so `μz − μ²/2` is a calibrated LR (the falsification term is
  // no longer √ticks-dominated by the evidence term). ticks = 1 (default) is the single-observation
  // interpretation: z(e^{θ²/2}) = θ exactly, the D1 identity for direct callers / unit fixtures.
  if (eValue === Infinity) return Z_MAX;
  return Math.min(Z_MAX, Math.sqrt((2 * Math.max(Math.log(eValue), 0)) / Math.max(ticks, 1)));
}

/** Soft-evidence member log-LR (ADR-0029): log[ N(z; μ, 1) / N(z; 0, 1) ] = μz − μ²/2, with μ = S·L
 *  the predicted standardized shift of a member whose lit fraction is L. Large μ + large z ⇒ support;
 *  large μ + z≈0 ⇒ −μ²/2 falsification; tiny μ + z≈0 ⇒ ≈0 (no spurious falsification of diluted leaves). */
function memberSoftLR(z: number, mu: number): number {
  return mu * z - (mu * mu) / 2;
}

/**
 * Magnitude marginal-LLR (ADR-0029) — the soft-evidence generalization of `resourceLLR`. In mixture
 * cell (δ, κ, S) a member's predicted mean is μ = S·L, where L = 1 − G·(1−δ)^{κw} is the lit fraction
 * COMBINING the picked set's residual unlit factor G = exp(logG) with the candidate's own lighting.
 * The base subtracts the candidate-OFF prediction (L_base = 1 − G) in the SAME mixture, so the
 * difference isolates the candidate's marginal lighting. With the q₀ leak (ADR-0031) G = (1−q₀)·exp(logG),
 * so at the FIRST pick G = 1−q₀, L_base = q₀, and the base is the base-rate null μ = S·q₀ (only the μ = 0
 * null in the q₀→0 limit). The returned cells carry (δ, κ) so the
 * posterior fold (`posteriorQuietFactors`/`foldPosterior`) is reused UNCHANGED — S only re-weights the
 * posterior, it is not part of the residual quiet factor E_post[(1−δ)^{κw}].
 */
function resourceMagnitudeLLR(
  a: Acc,
  logG: ReadonlyMap<PathClassId, number>,
  zOf: (pc: PathClassId) => number,
  q0: number,
  grid: number[],
  kappas: number[],
  scales: number[],
): { score: number; cells: MixCell[] } | null {
  if (a.firing.length === 0) return null;
  const logZ = Math.log(kappas.reduce((s, k) => s + 1 / k, 0) * scales.reduce((s, S) => s + 1 / S, 0) * grid.length);
  // q₀-aware null (ADR-0031): the leak (1−q₀) multiplies the unlit factor, so the NULL lit fraction
  // is q₀ (a member firing at the base rate is not evidence) — the magnitude analogue of the binary
  // scorer's `log(1−q₀) + logG + κw·log(1−δ)` quiet log-prob. At q₀→0 the leak vanishes and this
  // recovers the ADR-0029 Phase-1 (μ=0 null) form, so small-q₀ default-preservation is unchanged.
  const leak = 1 - q0;
  const faulty: MixCell[] = [];
  const base: { ll: number; logPrior: number }[] = [];
  for (const d of grid) {
    for (const k of kappas) {
      for (const S of scales) {
        const logPrior = -Math.log(k) - Math.log(S) - logZ;
        let llF = 0;
        let llB = 0;
        for (const m of a.members) {
          const G = leak * Math.exp(logG.get(m.pc) ?? 0);
          const z = zOf(m.pc);
          const litWith = 1 - G * Math.exp(k * m.weight * Math.log1p(-d));
          llF += memberSoftLR(z, S * litWith);
          llB += memberSoftLR(z, S * (1 - G));
        }
        faulty.push({ ll: llF, logPrior, d, k });
        base.push({ ll: llB, logPrior });
      }
    }
  }
  return { score: logMixExp(faulty) - logMixExp(base), cells: faulty };
}

/**
 * MARGINAL saturating leaky-LLR (ADR-0019/0022): the candidate's members are scored against what
 * the already-picked set ALREADY predicts (the residual quiet factor G per leaf), mixed over the
 * (δ, κ) product grid. With nothing picked (G ≡ 1) this is exactly the ADR-0019 scorer. The
 * mixture prior is uniform over δ and ∝ 1/κ (a Jeffreys-style scale prior, fixed form — NOT a
 * tunable knob): under a UNIFORM prior every candidate can jump to the saturated cells for free
 * and the ADR-0014 follow-the-traffic discrimination is lost; 1/κ makes extreme severity pay its
 * prior cost while still letting it win when it is the only hypothesis fitting the data (C1).
 */
function resourceLLR(a: Acc, logG: ReadonlyMap<PathClassId, number>, q0: number, grid: number[], kappas: number[]): { score: number; cells: MixCell[] } | null {
  if (a.firing.length === 0) return null;
  const logZ = Math.log(kappas.reduce((s, k) => s + 1 / k, 0) * grid.length);
  const cells: MixCell[] = [];
  for (const d of grid) {
    for (const k of kappas) {
      let ll = 0;
      for (const m of a.members) ll += memberLLMarginal(m.fired, q0, logG.get(m.pc) ?? 0, d, k * m.weight);
      cells.push({ ll, logPrior: -Math.log(k) - logZ, d, k });
    }
  }
  let base = 0;
  for (const m of a.members) base += memberLLBase(m.fired, q0, logG.get(m.pc) ?? 0);
  return { score: logMixExp(cells) - base, cells };
}

/** The picked resource's posterior-predictive quiet factor per member: E_post[(1−δ)^{κ·wᵢ}]. */
function posteriorQuietFactors(a: Acc, cells: readonly MixCell[]): Map<PathClassId, number> {
  const mx = Math.max(...cells.map((c) => c.ll + c.logPrior));
  const ws = cells.map((c) => Math.exp(c.ll + c.logPrior - mx));
  const Z = ws.reduce((s, x) => s + x, 0);
  const out = new Map<PathClassId, number>();
  for (const m of a.members) {
    let g = 0;
    for (let i = 0; i < cells.length; i++) g += (ws[i] / Z) * Math.exp(cells[i].k * m.weight * Math.log1p(-cells[i].d));
    out.set(m.pc, g);
  }
  return out;
}

/**
 * Fold the picked resource's POSTERIOR over (δ, κ) into each member's residual quiet factor
 * (ADR-0022): logGᵢ += log E_post[(1−δ)^{κ·wᵢ}]. Subsequent candidates then gain nothing for
 * leaves the picked set already predicts to fire, and the cover needs no binary explained-set.
 */
function foldPosterior(a: Acc, factors: ReadonlyMap<PathClassId, number>, logG: Map<PathClassId, number>): void {
  for (const [pc, g] of factors) logG.set(pc, (logG.get(pc) ?? 0) + Math.log(g));
}

/** One θ mixture cell (ADR-0046) — carries θ for the posterior-mean fold. */
interface ThetaCell {
  ll: number;
  logPrior: number;
  theta: number;
}

/**
 * Linear marginal LLR (ADR-0046): under candidate strength θ, member i adds μᵢ = θ·wᵢ·√T to the
 * picked set's predicted mean mᵢ, so its marginal log-LR is exactly
 *   log N(yᵢ; mᵢ+μᵢ, 1) − log N(yᵢ; mᵢ, 1) = μᵢ·(yᵢ − mᵢ) − μᵢ²/2
 * — the picked-set base cancels per cell (θ-independent), so the mixture IS the marginal score.
 * With nothing picked (m ≡ 0) this is the plain Gaussian mixture LR against the N(0,1) null.
 * A QUIET high-weight member (y = 0) pays −μ·mᵢ − μᵢ²/2: weight-aware falsification, correctly
 * scaled — the ADR-0014 follow-the-traffic discrimination without κ or saturation devices.
 */
function resourceThetaLLR(
  a: Acc,
  m: ReadonlyMap<PathClassId, number>,
  yOf: (pc: PathClassId) => number,
  thetas: number[],
  sqrtT: number,
): { score: number; cells: ThetaCell[] } | null {
  if (a.firing.length === 0) return null;
  const logZ = Math.log(thetas.reduce((s, t) => s + 1 / t, 0));
  const cells: ThetaCell[] = thetas.map((theta) => {
    let ll = 0;
    for (const mem of a.members) {
      const mu = theta * mem.weight * sqrtT;
      ll += mu * (yOf(mem.pc) - (m.get(mem.pc) ?? 0)) - (mu * mu) / 2;
    }
    return { ll, logPrior: -Math.log(theta) - logZ, theta };
  });
  return { score: logMixExp(cells), cells };
}

/**
 * Fold a linear pick's ML-refit prediction into each member (ADR-0046): mᵢ += θ̂·wᵢ·√T with the
 * exact weighted-least-squares refit θ̂ = Σ wᵢ(yᵢ−mᵢ) / (√T·Σ wᵢ²) over the pick's members —
 * the Deepview post-selection-refit composition: SCORE with the θ-grid mixture (Bayes, for the
 * admission decision), FOLD with the continuous ML fit (so the leftover residual is orthogonal
 * to the picked profile). A grid-quantized fold leaves a systematic ±½-cell residual on every
 * member, which across ~10² members hands a mop-up candidate (the fleet, a sibling panel) a
 * spuriously large marginal — measured, which is why the fold is ML, not posterior-mean.
 * θ̂ is clamped ≥ 0: a net-negative refit folds nothing rather than subtracting predictions.
 */
function foldThetaML(a: Acc, m: Map<PathClassId, number>, yOf: (pc: PathClassId) => number, sqrtT: number): void {
  let num = 0;
  let den = 0;
  for (const mem of a.members) {
    num += mem.weight * (yOf(mem.pc) - (m.get(mem.pc) ?? 0));
    den += mem.weight * mem.weight;
  }
  const thetaHat = Math.max(num / (sqrtT * den), 0);
  for (const mem of a.members) m.set(mem.pc, (m.get(mem.pc) ?? 0) + thetaHat * mem.weight * sqrtT);
}

/** Linear-mode explained (display + admission gate): the picked set predicts at least HALF the
 *  observed magnitude (m ≥ y/2, m > 0) — the ½ mirrors the binary path's more-likely-than-not. */
function isExplainedLinear(y: number, m: number): boolean {
  return m > 0 && m >= y / 2;
}

/** Linear-mode admission gate (the ADR-0022 rule, linear form): a candidate must have at least
 *  one firing member whose magnitude the picked set has NOT already half-explained. */
function hasUnexplainedFiringLinear(a: Acc, m: ReadonlyMap<PathClassId, number>, yOf: (pc: PathClassId) => number): boolean {
  for (const mem of a.members) {
    if (mem.fired && !isExplainedLinear(yOf(mem.pc), m.get(mem.pc) ?? 0)) return true;
  }
  return false;
}

/** Best unpicked candidate by linear marginal LLR (ADR-0046). `!(score > 0)` so NaN never ranks. */
function bestThetaMarginal(
  acc: Map<ResourceId, Acc>,
  picked: ReadonlySet<ResourceId>,
  m: ReadonlyMap<PathClassId, number>,
  yOf: (pc: PathClassId) => number,
  thetas: number[],
  sqrtT: number,
): { resource: ResourceId; score: number; cells: ThetaCell[] } | null {
  let best: { resource: ResourceId; score: number; cells: ThetaCell[] } | null = null;
  for (const [resource, a] of acc) {
    if (picked.has(resource) || !hasUnexplainedFiringLinear(a, m, yOf)) continue;
    const p = resourceThetaLLR(a, m, yOf, thetas, sqrtT);
    if (!p || !(p.score > 0)) continue;
    if (!best || p.score > best.score || (p.score === best.score && resource < best.resource)) best = { resource, ...p };
  }
  return best;
}

const LOG_HALF = Math.log(0.5);
/** explained ⇔ the picked set touches the leaf (logG < 0) AND makes its firing more likely than
 *  not (P(fire | set) > ½, strict) — the audit binarization AND the pick admission gate. */
function isExplained(q0: number, logG: number): boolean {
  return logG < 0 && Math.log1p(-q0) + logG < LOG_HALF;
}

/**
 * Pick admission gate (ADR-0022, cold-eye C2): a candidate must have at least one firing member
 * the picked set has NOT already explained — without this, a resource whose firing members are a
 * SUBSET of an earlier pick's (with no quiet members to falsify it) free-rides to a small
 * positive marginal (every fired member's marginal contribution is ≥ 0; only quiet members push
 * it negative). The binarization-level analogue of the retired `newly.length === 0` rule: it
 * admits weak first picks (nothing is explained yet) and never blocks a candidate carrying
 * genuinely surprising evidence. Residual recorded in ADR-0022: when the picked set explains
 * NOTHING past ½, a nested no-quiet candidate remains admissible with a tiny marginal.
 */
function hasUnexplainedFiring(a: Acc, logG: ReadonlyMap<PathClassId, number>, q0: number): boolean {
  for (const m of a.members) {
    if (m.fired && !isExplained(q0, logG.get(m.pc) ?? 0)) return true;
  }
  return false;
}

/** Legacy linear scorer (CONTROL ONLY): `Σ newly·w − λ·Σ quiet·w` — the rank-flip failure mode. */
function resourceLinear(a: Acc, explained: ReadonlySet<PathClassId>, lambda: number): Pick | null {
  let wNewly = 0;
  let wQuiet = 0;
  const newly: PathClassId[] = [];
  for (const m of a.members) {
    if (!m.fired) wQuiet += m.weight;
    else if (!explained.has(m.pc)) { wNewly += m.weight; newly.push(m.pc); }
  }
  if (newly.length === 0) return null;
  return { resource: '', score: wNewly - lambda * wQuiet, newly };
}

/** Best legacy candidate (CONTROL ONLY) under the binary explained-set cover. */
function bestLegacy(acc: Map<ResourceId, Acc>, explained: ReadonlySet<PathClassId>, lambda: number): Pick | null {
  let best: Pick | null = null;
  for (const [resource, a] of acc) {
    const p = resourceLinear(a, explained, lambda);
    if (!p || !(p.score > 0)) continue;
    p.resource = resource;
    if (!best || p.score > best.score || (p.score === best.score && resource < best.resource)) best = p;
  }
  return best;
}

/** Best unpicked candidate by marginal LLR that NEWLY EXPLAINS ≥ 1 leaf (ADR-0022).
 *  `!(score > 0)` so NaN never ranks. */
function bestMarginal(
  acc: Map<ResourceId, Acc>,
  picked: ReadonlySet<ResourceId>,
  logG: ReadonlyMap<PathClassId, number>,
  opts: LocalizeOpts,
  zOf: (pc: PathClassId) => number,
): { resource: ResourceId; score: number; cells: MixCell[] } | null {
  let best: { resource: ResourceId; score: number; cells: MixCell[] } | null = null;
  for (const [resource, a] of acc) {
    if (picked.has(resource) || !hasUnexplainedFiring(a, logG, opts.q0)) continue;
    const p = opts.magnitude
      ? resourceMagnitudeLLR(a, logG, zOf, opts.q0, opts.grid, opts.kappas, opts.scales ?? DEFAULT_SCALES)
      : resourceLLR(a, logG, opts.q0, opts.grid, opts.kappas);
    if (!p || !(p.score > 0)) continue;
    if (!best || p.score > best.score || (p.score === best.score && resource < best.resource)) best = { resource, ...p };
  }
  return best;
}

/**
 * The linear t-statistic cover (ADR-0046). Look-elsewhere admission charge: a rank ≥ 2 pick is
 * the MAX marginal LLR over R candidates scored on residual leftovers, so under the
 * no-more-faults null its score is inflated by up to ln R (Bonferroni) — it must clear that
 * charge or the cover stops. Fixed form (R is the candidate count, not a knob) — without it the
 * low-θ grid cells let arbitrarily weak leftovers admit trailing culprits (measured: sibling
 * panels and the fleet candidate as rank-2/3 mop-ups). The FIRST pick is exempt: e-BH already
 * certified the selected leaves as non-null at FDR q, and rank-1 is the argmax explanation of
 * that certified evidence (a ranking, N1) — charging it ln R only converts weak-but-correct
 * attributions into abstentions (measured: optic Δ=1 attribution 75% → 25%).
 */
function localizeLinear(
  snapshot: FaultDomainSnapshot,
  fired: ReadonlySet<PathClassId>,
  acc: Map<ResourceId, Acc>,
  mkCulprit: (resource: ResourceId, score: number) => Culprit,
  opts: LocalizeOpts,
): LocalizationResult {
  const yMap = opts.magnitudeT!;
  const yOf = (pc: PathClassId): number => {
    if (!fired.has(pc)) return 0;
    const y = yMap.get(pc);
    if (y === undefined) throw new RangeError(`magnitudeT mode: firing leaf ${pc} has no magnitude`);
    return y;
  };
  const sqrtT = Math.sqrt(Math.max(opts.magnitudeTicks ?? 1, 1));
  const thetas = opts.thetas ?? DEFAULT_THETAS;
  // The virtual fleet-event candidate: w = 1 on every leaf (ADR-0046).
  acc.set(FLEET_RESOURCE_ID, {
    members: snapshot.path_classes.map((pc) => ({ pc, weight: 1, fired: fired.has(pc) })),
    firing: [...fired].sort(),
  });
  const m = new Map<PathClassId, number>();
  const picked = new Set<ResourceId>();
  const culprits: Culprit[] = [];
  const logR = Math.log(acc.size);
  while (culprits.length < opts.maxResources) {
    const best = bestThetaMarginal(acc, picked, m, yOf, thetas, sqrtT);
    if (!best || !(best.score > (culprits.length === 0 ? 0 : logR))) break;
    picked.add(best.resource);
    foldThetaML(acc.get(best.resource)!, m, yOf, sqrtT);
    culprits.push(mkCulprit(best.resource, best.score));
  }
  const explained = [...fired].filter((pc) => isExplainedLinear(yOf(pc), m.get(pc) ?? 0)).sort();
  const explainedSet = new Set(explained);
  return {
    culprits,
    explained_path_class_ids: explained,
    unexplained_path_class_ids: [...fired].filter((pc) => !explainedSet.has(pc)).sort(),
  };
}

/** The aggregation views (ADR-0015) that have a firing member of this resource — per-view concurrence. */
function supportingViews(snapshot: FaultDomainSnapshot, firing: readonly PathClassId[]): string[] {
  if (!snapshot.views) return [];
  const fset = new Set(firing);
  return snapshot.views.filter((v) => v.leaf_ids.some((id) => fset.has(id))).map((v) => v.view);
}

/** Build one culprit record: provenance + views + identifiability metadata (ADR-0047 — the
 *  ambiguity group appears only when non-empty, a strictly weaker claim). */
function culpritOf(
  snapshot: FaultDomainSnapshot,
  acc: Map<ResourceId, Acc>,
  kindOf: ReadonlyMap<ResourceId, ResourceKind>,
  ambiguity: ReadonlyMap<ResourceId, ResourceId[]>,
  resource: ResourceId,
  score: number,
): Culprit {
  const a = acc.get(resource)!;
  const group = ambiguity.get(resource);
  return {
    resource_id: resource,
    resource_kind: kindOf.get(resource) ?? 'switch',
    score,
    member_path_class_ids: [...a.firing].sort(),
    firing_member_count: a.firing.length,
    traversing_count: a.members.length,
    supporting_views: supportingViews(snapshot, a.firing),
    ...(group && group.length > 0 ? { ambiguity_group: group } : {}),
    correlational_not_causal: true,
  };
}

export function localize(
  snapshot: FaultDomainSnapshot,
  firingPathClassIds: readonly PathClassId[],
  opts: LocalizeOpts = DEFAULT_LOCALIZE,
): LocalizationResult {
  // q₀ is a probability: q₀ ≤ 0 or ≥ 1 makes the LLR ±Infinity and would RANK garbage
  // (the `!(score > 0)` gate stops NaN, not +Infinity) — reject at the boundary instead.
  if (!opts.legacy && !(opts.q0 > 0 && opts.q0 < 1)) throw new RangeError(`q0 must be in (0, 1) — got ${opts.q0}`);
  const fired = new Set(firingPathClassIds);
  const acc = accumulate(snapshot, fired);
  const kindOf = new Map<ResourceId, ResourceKind>();
  for (const r of snapshot.resources) kindOf.set(r.id, r.kind);
  kindOf.set(FLEET_RESOURCE_ID, 'fleet_common_mode'); // the virtual candidate's kind (ADR-0046)
  // Identifiability metadata (ADR-0047): a culprit indistinguishable from proportional-column
  // siblings SAYS SO — the certificate's per-resource groups, computed once per localization.
  const ambiguity = ambiguityGroupsByResource(snapshot);
  const mkCulprit = (resource: ResourceId, score: number): Culprit =>
    culpritOf(snapshot, acc, kindOf, ambiguity, resource, score);
  if (opts.legacy) return localizeLegacy(fired, acc, mkCulprit, opts);
  if (opts.magnitudeT) return localizeLinear(snapshot, fired, acc, mkCulprit, opts);

  // Magnitude currency (ADR-0029): firing leaves carry z = magnitudeZ(e_value), quiet leaves z = 0.
  // Fail-closed — a firing leaf with no supplied e-value in magnitude mode is a contract violation,
  // not a silent z = 0 (which would falsify the very resource it fired for).
  const mag = opts.magnitude;
  const magTicks = opts.magnitudeTicks ?? 1;
  const zOf = (pc: PathClassId): number => {
    if (!mag || !fired.has(pc)) return 0;
    const e = mag.get(pc);
    if (e === undefined) throw new RangeError(`magnitude mode: firing leaf ${pc} has no e-value`);
    return magnitudeZ(e, magTicks);
  };

  // Marginal-LLR set construction (ADR-0022): each pick folds its (δ, κ) posterior into the
  // residual quiet factors, so the next candidate is scored on what remains SURPRISING — no
  // binary explained-set, no weight threshold. A leaf is reported "explained" when the picked
  // set makes its firing more likely than not (P ≥ ½ — audit binarization only, not mechanism).
  const logG = new Map<PathClassId, number>();
  const picked = new Set<ResourceId>();
  const culprits: Culprit[] = [];
  while (culprits.length < opts.maxResources) {
    const best = bestMarginal(acc, picked, logG, opts, zOf);
    if (!best) break;
    picked.add(best.resource);
    foldPosterior(acc.get(best.resource)!, posteriorQuietFactors(acc.get(best.resource)!, best.cells), logG);
    culprits.push(mkCulprit(best.resource, best.score));
  }
  // at q₀ ≥ ½ a firing leaf is unsurprising under the NULL, which is not the same as being
  // explained by the culprit set — and near q₀ ≈ ½ the rule is dominated by the null (recorded
  // in ADR-0022; the binarization is q₀-relative display, the admission gate is the mechanism).
  const explained = [...fired].filter((pc) => isExplained(opts.q0, logG.get(pc) ?? 0)).sort();
  const explainedSet = new Set(explained);
  return {
    culprits,
    explained_path_class_ids: explained,
    unexplained_path_class_ids: [...fired].filter((pc) => !explainedSet.has(pc)).sort(),
  };
}

/** The legacy linear cover (CONTROL ONLY): binary explained-set, the historic v1 semantics. */
function localizeLegacy(
  fired: ReadonlySet<PathClassId>,
  acc: Map<ResourceId, Acc>,
  mkCulprit: (resource: ResourceId, score: number) => Culprit,
  opts: LocalizeOpts,
): LocalizationResult {
  const explained = new Set<PathClassId>();
  const culprits: Culprit[] = [];
  while (explained.size < fired.size && culprits.length < opts.maxResources) {
    const pick = bestLegacy(acc, explained, opts.collateralWeight ?? 1);
    if (!pick) break;
    culprits.push(mkCulprit(pick.resource, pick.score));
    for (const pc of pick.newly) explained.add(pc);
  }
  return {
    culprits,
    explained_path_class_ids: [...explained].sort(),
    unexplained_path_class_ids: [...fired].filter((pc) => !explained.has(pc)).sort(),
  };
}
