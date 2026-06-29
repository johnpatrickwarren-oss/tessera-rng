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
}

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
export function magnitudeZ(eValue: number): number {
  // Fail LOUD on a non-finite/negative e-value: otherwise z = NaN/∞ silently vanishes the candidate
  // (dropped by the `!(score > 0)` gate) with no diagnostic. e-values are finite and ≥ 0 by
  // construction, so this is a contract guard, not an expected path.
  if (!Number.isFinite(eValue) || eValue < 0) throw new RangeError(`magnitudeZ: e-value must be finite and ≥ 0 — got ${eValue}`);
  return Math.sqrt(2 * Math.max(Math.log(eValue), 0));
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
 * difference isolates the candidate's marginal lighting; at the first pick (G ≡ 1, L_base = 0) the base
 * is the μ = 0 null and the score is exactly logMixExp(faulty). The returned cells carry (δ, κ) so the
 * posterior fold (`posteriorQuietFactors`/`foldPosterior`) is reused UNCHANGED — S only re-weights the
 * posterior, it is not part of the residual quiet factor E_post[(1−δ)^{κw}].
 */
function resourceMagnitudeLLR(
  a: Acc,
  logG: ReadonlyMap<PathClassId, number>,
  zOf: (pc: PathClassId) => number,
  grid: number[],
  kappas: number[],
  scales: number[],
): { score: number; cells: MixCell[] } | null {
  if (a.firing.length === 0) return null;
  const logZ = Math.log(kappas.reduce((s, k) => s + 1 / k, 0) * scales.reduce((s, S) => s + 1 / S, 0) * grid.length);
  const faulty: MixCell[] = [];
  const base: { ll: number; logPrior: number }[] = [];
  for (const d of grid) {
    for (const k of kappas) {
      for (const S of scales) {
        const logPrior = -Math.log(k) - Math.log(S) - logZ;
        let llF = 0;
        let llB = 0;
        for (const m of a.members) {
          const G = Math.exp(logG.get(m.pc) ?? 0);
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
      ? resourceMagnitudeLLR(a, logG, zOf, opts.grid, opts.kappas, opts.scales ?? DEFAULT_SCALES)
      : resourceLLR(a, logG, opts.q0, opts.grid, opts.kappas);
    if (!p || !(p.score > 0)) continue;
    if (!best || p.score > best.score || (p.score === best.score && resource < best.resource)) best = { resource, ...p };
  }
  return best;
}

/** The aggregation views (ADR-0015) that have a firing member of this resource — per-view concurrence. */
function supportingViews(snapshot: FaultDomainSnapshot, firing: readonly PathClassId[]): string[] {
  if (!snapshot.views) return [];
  const fset = new Set(firing);
  return snapshot.views.filter((v) => v.leaf_ids.some((id) => fset.has(id))).map((v) => v.view);
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
  const mkCulprit = (resource: ResourceId, score: number): Culprit => {
    const a = acc.get(resource)!;
    return {
      resource_id: resource,
      resource_kind: kindOf.get(resource) ?? 'switch',
      score,
      member_path_class_ids: [...a.firing].sort(),
      firing_member_count: a.firing.length,
      traversing_count: a.members.length,
      supporting_views: supportingViews(snapshot, a.firing),
      correlational_not_causal: true,
    };
  };
  if (opts.legacy) return localizeLegacy(fired, acc, mkCulprit, opts);

  // Magnitude currency (ADR-0029): firing leaves carry z = magnitudeZ(e_value), quiet leaves z = 0.
  // Fail-closed — a firing leaf with no supplied e-value in magnitude mode is a contract violation,
  // not a silent z = 0 (which would falsify the very resource it fired for).
  const mag = opts.magnitude;
  const zOf = (pc: PathClassId): number => {
    if (!mag || !fired.has(pc)) return 0;
    const e = mag.get(pc);
    if (e === undefined) throw new RangeError(`magnitude mode: firing leaf ${pc} has no e-value`);
    return magnitudeZ(e);
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
