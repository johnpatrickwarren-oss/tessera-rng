/**
 * Tomographic localization (v1 spec AC-5; the new math, ADR-0001; leaky-LLR scorer, ADR-0016;
 * exposure-saturating noisy-OR, ADR-0019).
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
}

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

const memberLL = (fired: boolean, p: number): number => (fired ? Math.log(p) : Math.log(1 - p));

/** log( Σᵢ priorᵢ·exp(llᵢ) ), Σ prior = 1 — stable prior-weighted mixture (ADR-0019). */
function logMixExp(cells: ReadonlyArray<{ ll: number; logPrior: number }>): number {
  const max = Math.max(...cells.map((c) => c.ll + c.logPrior));
  let s = 0;
  for (const c of cells) s += Math.exp(c.ll + c.logPrior - max);
  return max + Math.log(s);
}

/**
 * One member's log-likelihood under (faulty, δ, κ) — the SATURATING leaky noisy-OR (ADR-0019):
 *   P(quiet) = (1−q₀)·(1−δ)^{κ·w}   ⇒   log P(quiet) = log(1−q₀) + κ·w·log(1−δ)   (exact, no clamp)
 * κ is the exposure scale: at κ·w large the fire probability SATURATES toward 1, which the old
 * linear leak q₁ = q₀+(δ−q₀)·w could not express — an extreme fault fires even a 1/64-diluted
 * leaf reliably, and a model that cannot say so hands the coarse pair-view resource the win
 * (the ADR-0016 C1 residue, now closed) and mislocalizes a true room fault entirely.
 */
function memberLLSat(fired: boolean, q0: number, d: number, kw: number): number {
  const logQuiet = Math.log1p(-q0) + kw * Math.log1p(-d);
  return fired ? Math.log(-Math.expm1(logQuiet)) : logQuiet;
}

/**
 * Saturating leaky-LLR of a resource's members vs the null, mixed over the (δ, κ) product grid,
 * excluding already-explained firing members. The mixture prior is uniform over δ and ∝ 1/κ over
 * the exposure scale (a Jeffreys-style scale prior, fixed form — NOT a tunable knob): under a
 * UNIFORM prior every candidate can jump to the saturated cells for free, so an unfalsified
 * low-weight decoy explains full firing as well as the true full-weight resource and the
 * ADR-0014 follow-the-traffic discrimination is lost; 1/κ makes extreme severity pay its prior
 * cost while still letting it win when it is the only hypothesis fitting the data (high-δ C1).
 */
function resourceLLR(a: Acc, explained: ReadonlySet<PathClassId>, q0: number, grid: number[], kappas: number[]): Pick | null {
  const scoring = a.members.filter((m) => !(m.fired && explained.has(m.pc)));
  const newly = scoring.filter((m) => m.fired).map((m) => m.pc);
  if (newly.length === 0) return null;
  const logZ = Math.log(kappas.reduce((s, k) => s + 1 / k, 0) * grid.length);
  const cells: { ll: number; logPrior: number }[] = [];
  for (const d of grid) {
    for (const k of kappas) {
      let ll = 0;
      for (const m of scoring) ll += memberLLSat(m.fired, q0, d, k * m.weight);
      cells.push({ ll, logPrior: -Math.log(k) - logZ });
    }
  }
  let nullLL = 0;
  for (const m of scoring) nullLL += memberLL(m.fired, q0);
  return { resource: '', score: logMixExp(cells) - nullLL, newly };
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

function bestResource(acc: Map<ResourceId, Acc>, explained: ReadonlySet<PathClassId>, opts: LocalizeOpts): Pick | null {
  let best: Pick | null = null;
  for (const [resource, a] of acc) {
    const p = opts.legacy ? resourceLinear(a, explained, opts.collateralWeight ?? 1) : resourceLLR(a, explained, opts.q0, opts.grid, opts.kappas);
    // `!(score > 0)` (not `score <= 0`) so a NaN score (e.g. an empty grid) is rejected, never ranked.
    if (!p || !(p.score > 0)) continue;
    p.resource = resource;
    if (!best || p.score > best.score || (p.score === best.score && resource < best.resource)) best = p;
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

  const explained = new Set<PathClassId>();
  const culprits: Culprit[] = [];
  while (explained.size < fired.size && culprits.length < opts.maxResources) {
    const pick = bestResource(acc, explained, opts);
    if (!pick) break;
    const a = acc.get(pick.resource)!;
    culprits.push({
      resource_id: pick.resource,
      resource_kind: kindOf.get(pick.resource) ?? 'switch',
      score: pick.score,
      member_path_class_ids: [...a.firing].sort(),
      firing_member_count: a.firing.length,
      traversing_count: a.members.length,
      supporting_views: supportingViews(snapshot, a.firing),
      correlational_not_causal: true,
    });
    for (const pc of pick.newly) explained.add(pc);
  }

  const unexplained = [...fired].filter((pc) => !explained.has(pc)).sort();
  return {
    culprits,
    explained_path_class_ids: [...explained].sort(),
    unexplained_path_class_ids: unexplained,
  };
}
