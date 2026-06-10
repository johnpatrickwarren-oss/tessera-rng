/**
 * Tomographic localization (v1 spec AC-5; the new math, ADR-0001).
 *
 * Inverse problem: given the e-BH-selected (firing) path-class set, recover the minimal set
 * of shared physical resources whose joint failure best explains it. We model fault → firing
 * as a noisy-OR: a path-class fires if it traverses ≥1 faulty resource. The MAP estimate
 * under a parsimony prior is the classic objective behind greedy weighted set cover, which
 * we run deterministically:
 *
 *   repeatedly pick the resource with the greatest marginal gain
 *       gain(r) = Σ_{newly firing} w − λ·Σ_{quiet} w
 *   until the firing set is explained, gain ≤ 0, or the parsimony cap is hit.
 *
 * Incidence is WEIGHTED (ADR-0014): a resource explains a firing path proportionally to the path's
 * traffic weight w(pc, r) through it, and a quiet path costs collateral proportionally to its weight
 * (a quiet path sending 2% of its traffic through r is weak evidence against r; one sending 60% is
 * strong). With the v1 binary fabric every weight is 1 and this reduces to the unweighted counts —
 * byte-identical. The λ·collateral term is what makes RNG's path diversity pay off: a true
 * common-mode resource has ALL its traversing paths firing (collateral ≈ 0) and wins; an
 * incidentally shared resource drags in many quiet paths (high collateral) and is rejected.
 *
 * MUST-NEVER (N1): output is a shared-resource GROUP with a correlational-not-causal flag,
 * never a single-component hardware root cause. Unexplained firing paths are reported, not
 * silently dropped (instrumented-caveat discipline).
 */
import type { FaultDomainSnapshot, PathClassId, ResourceId, ResourceKind } from './domain';
import type { Culprit } from './verdict';

export interface LocalizeOpts {
  /** collateral weight λ: cost (in explained-path units) per quiet path a resource implicates. */
  collateralWeight: number;
  /** parsimony cap: never return more than this many resources. */
  maxResources: number;
}

export const DEFAULT_LOCALIZE: LocalizeOpts = { collateralWeight: 1.0, maxResources: 16 };

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
  gain: number;
  newly: PathClassId[];
}

/** Best marginal resource given what is already explained; null if none has positive (weighted) gain. */
function bestResource(acc: Map<ResourceId, Acc>, explained: ReadonlySet<PathClassId>, lambda: number): Pick | null {
  let best: Pick | null = null;
  for (const [resource, a] of acc) {
    let wNewly = 0;
    let wQuiet = 0;
    const newly: PathClassId[] = [];
    for (const m of a.members) {
      if (!m.fired) wQuiet += m.weight;
      else if (!explained.has(m.pc)) { wNewly += m.weight; newly.push(m.pc); }
    }
    if (newly.length === 0) continue;
    const gain = wNewly - lambda * wQuiet;
    if (gain <= 0) continue;
    const better = !best || gain > best.gain || (gain === best.gain && resource < best.resource);
    if (better) best = { resource, gain, newly };
  }
  return best;
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
    const pick = bestResource(acc, explained, opts.collateralWeight);
    if (!pick) break;
    const a = acc.get(pick.resource)!;
    culprits.push({
      resource_id: pick.resource,
      resource_kind: kindOf.get(pick.resource) ?? 'switch',
      score: pick.gain,
      member_path_class_ids: [...a.firing].sort(),
      firing_member_count: a.firing.length,
      traversing_count: a.members.length,
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
