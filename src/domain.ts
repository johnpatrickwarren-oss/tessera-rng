/**
 * Tessera-RNG domain/data contract (v1 spec §3.1–3.3).
 *
 * The INPUT side: path-class identity, the signal vector, and the fault-domain incidence
 * model. Path-class = the engine "shard" leaf (ADR-0001). RNG-native resource kinds —
 * deliberately NOT the engine's closed TopologyNode.kind union (ADR-0002).
 *
 * (Split from the verdict/output contract in verdict.ts to keep the data layer and the
 * result layer as separate, low-coupling concerns.)
 */

export type PathClassId = string;
export type ResourceId = string;

/** Open RNG fault-domain taxonomy (v1 spec §3.3). */
export const RESOURCE_KINDS = [
  'optic',
  'passive_shuffler',
  'fiber_bundle',
  'linecard',
  'switch',
  'power_zone',
  'cooling_zone',
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export function isResourceKind(x: string): x is ResourceKind {
  return (RESOURCE_KINDS as readonly string[]).includes(x);
}

// (The telemetry signal contract lives in signals.ts — a distinct concern.)

// ── Fault-domain incidence model (rides a FaultDomainSource; ADR-0002) ──────────

export interface FaultDomainNode {
  id: string; // path-class id or resource id
  kind: 'path_class' | ResourceKind;
}

export interface FaultDomainEdge {
  path_class: PathClassId;
  resource: ResourceId;
  relationship: 'traverses';
}

export interface FaultDomainSnapshot {
  nodes: readonly FaultDomainNode[];
  edges: readonly FaultDomainEdge[]; // path-class -> resource incidence
  path_classes: readonly PathClassId[];
  resources: ReadonlyArray<{ id: ResourceId; kind: ResourceKind }>;
  fetched_at_ts: number;
  source_id: string;
  source_version: string;
}
