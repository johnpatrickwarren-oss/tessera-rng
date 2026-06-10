/**
 * Tomographic localization (v1 spec AC-5; the new math, ADR-0001; leaky-LLR scorer, ADR-0016).
 *
 * Inverse problem: given the e-BH-selected (firing) leaf set, recover the minimal set of shared
 * physical resources whose joint failure best explains it. We model fault → firing as a LEAKY
 * noisy-OR and score each candidate resource by the log-likelihood ratio of its members' observed
 * firing pattern under (faulty) vs (clean), then run greedy set-cover deterministically on that LLR.
 *
 * Per member i of resource r, with traffic weight wᵢ (ADR-0014):
 *   - clean (null):  P(fire) = q₀  (the floored fleet base rate from the surface, ADR-0016).
 *   - faulty:        P(fire) = q₁ᵢ(δ) = q₀ + (δ − q₀)·wᵢ, for a fault strength δ.
 * Because the true δ is unknown, we MIX over a small deterministic grid δ ∈ {0.3, 0.6, 0.9} (a
 * method-of-mixtures: average the per-δ likelihoods, then take the LLR vs null). This is weight-aware
 * FALSIFICATION: a QUIET high-weight member (wᵢ→1 ⇒ q₁→δ, large) is strong evidence AGAINST the
 * resource, while a quiet low-weight member (q₁≈q₀) costs ~nothing — exactly what the old linear
 * `gain = Σ newly·w − λ·Σ quiet·w` could not express (collateral was a free λ knob). It subsumes
 * `collateralWeight` and, on the Spraypoint union of dependent views, buries a coarse resource whose
 * many quiet home-view members contradict it, fixing the cross-view rank flip (ADR-0015/0016).
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

export const DEFAULT_LOCALIZE: LocalizeOpts = Object.freeze({ grid: Object.freeze([0.3, 0.6, 0.9]) as number[], q0: 0.01, maxResources: 16 });

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

/** log( mean_k exp(xs[k]) ) — stable mixture over the fault-strength grid. */
function logMeanExp(xs: number[]): number {
  const max = Math.max(...xs);
  let s = 0;
  for (const x of xs) s += Math.exp(x - max);
  return max + Math.log(s / xs.length);
}

/** Leaky-LLR of a resource's members vs the null, excluding already-explained firing members. */
function resourceLLR(a: Acc, explained: ReadonlySet<PathClassId>, q0: number, grid: number[]): Pick | null {
  const scoring = a.members.filter((m) => !(m.fired && explained.has(m.pc)));
  const newly = scoring.filter((m) => m.fired).map((m) => m.pc);
  if (newly.length === 0) return null;
  const altByDelta = grid.map((d) => {
    let ll = 0;
    for (const m of scoring) ll += memberLL(m.fired, q0 + (d - q0) * m.weight);
    return ll;
  });
  let nullLL = 0;
  for (const m of scoring) nullLL += memberLL(m.fired, q0);
  return { resource: '', score: logMeanExp(altByDelta) - nullLL, newly };
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
    const p = opts.legacy ? resourceLinear(a, explained, opts.collateralWeight ?? 1) : resourceLLR(a, explained, opts.q0, opts.grid);
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
