/**
 * Synthetic quasi-random (RNG-family) fabric + cabling/shuffle incidence generator
 * (v1 spec §3.3, Q3-ratified: seeded generator with documented defaults).
 *
 * This is the synthetic substrate that stands in for a real flat random-graph fabric.
 * Each path-class (a ToR-pair flow equivalence class) traverses a quasi-randomly chosen
 * set of shared physical resources. Because many path-classes share each resource in
 * overlapping ways, the resulting incidence matrix is the well-conditioned measurement
 * matrix tomography exploits (ADR-0001 core thesis).
 */
import { makeRng } from './rng';
import type { FaultDomainSnapshot, FaultDomainNode, FaultDomainEdge, ResourceKind, ResourceId } from './domain';

export interface FabricParams {
  seed: number;
  n_path_classes: number; // leaves to monitor (v1 spec AC-1: 100..10000)
  n_optics: number; // pool of ingress/egress optics
  n_shufflers: number; // passive optical shuffle devices
  n_bundles: number; // fiber bundles
  n_power_zones: number;
  n_cooling_zones: number;
}

/** Documented v1 defaults — a few hundred path-classes over a modest resource fabric. */
export const DEFAULT_FABRIC: FabricParams = {
  seed: 0x7e55e4a,
  n_path_classes: 400,
  n_optics: 64,
  n_shufflers: 16,
  n_bundles: 24,
  n_power_zones: 4,
  n_cooling_zones: 4,
};

interface Pool {
  prefix: string;
  kind: ResourceKind;
  size: number;
}

function poolMember(rng: ReturnType<typeof makeRng>, pool: Pool): ResourceId {
  return `${pool.prefix}-${rng.int(pool.size)}`;
}

/**
 * Build the incidence snapshot. Each path-class traverses: an ingress optic, an egress
 * optic, one passive shuffler, one fiber bundle, one power zone, one cooling zone.
 */
export function generateFabric(params: FabricParams = DEFAULT_FABRIC): FaultDomainSnapshot {
  if (params.n_path_classes < 1) throw new RangeError('n_path_classes must be >= 1 (no path-classes to monitor)');
  const rng = makeRng(params.seed);
  const pools: Pool[] = [
    { prefix: 'optic', kind: 'optic', size: params.n_optics },
    { prefix: 'shuffler', kind: 'passive_shuffler', size: params.n_shufflers },
    { prefix: 'bundle', kind: 'fiber_bundle', size: params.n_bundles },
    { prefix: 'pzone', kind: 'power_zone', size: params.n_power_zones },
    { prefix: 'czone', kind: 'cooling_zone', size: params.n_cooling_zones },
  ];

  const path_classes: string[] = [];
  const edges: FaultDomainEdge[] = [];
  const resourceKinds = new Map<ResourceId, ResourceKind>();

  for (let i = 0; i < params.n_path_classes; i++) {
    const pc = `pc-${i}`;
    path_classes.push(pc);
    // two distinct optics (ingress + egress), then one of each other resource.
    const traversed: ResourceId[] = [poolMember(rng, pools[0]), poolMember(rng, pools[0])];
    for (let p = 1; p < pools.length; p++) traversed.push(poolMember(rng, pools[p]));
    const seen = new Set<ResourceId>();
    for (const r of traversed) {
      if (seen.has(r)) continue; // a path-class traverses a given resource at most once
      seen.add(r);
      edges.push({ path_class: pc, resource: r, relationship: 'traverses' });
    }
    // record kinds
    const optic0 = traversed[0];
    const optic1 = traversed[1];
    resourceKinds.set(optic0, 'optic');
    resourceKinds.set(optic1, 'optic');
    for (let p = 1; p < pools.length; p++) resourceKinds.set(traversed[p + 1], pools[p].kind);
  }

  const resources = [...resourceKinds.entries()]
    .map(([id, kind]) => ({ id, kind }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const nodes: FaultDomainNode[] = [
    ...path_classes.map((id) => ({ id, kind: 'path_class' as const })),
    ...resources.map((r) => ({ id: r.id, kind: r.kind })),
  ];

  return {
    nodes,
    edges,
    path_classes,
    resources,
    fetched_at_ts: 0, // deterministic: no wall clock (replay-clean)
    source_id: 'synthetic-rng-fabric',
    source_version: `v1:${params.seed}`,
  };
}
