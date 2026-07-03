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

/** Open RNG fault-domain taxonomy (v1 spec §3.3; `shuffle_panel`/`room` added in ADR-0015;
 *  `fleet_common_mode` is RESERVED for the solver's virtual fleet-event candidate (ADR-0046) —
 *  it is not a declarable physical resource and operator snapshots must not use it. */
export const RESOURCE_KINDS = [
  'optic',
  'passive_shuffler',
  'fiber_bundle',
  'linecard',
  'switch',
  'power_zone',
  'cooling_zone',
  'shuffle_panel',
  'room',
  'fleet_common_mode',
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
  /**
   * Fraction of the path-class's traffic traversing this resource, ∈ (0, 1] (ADR-0014). Models the
   * Spraypoint regime where a ToR-pair spreads fractionally across a large resource set (arXiv
   * 2604.15261; ADR-0013). Absent ⇒ 1 (full traversal) — the v1 binary incidence, byte-identical.
   */
  weight?: number;
}

/**
 * An aggregation VIEW over the underlying ToR-pair traffic (ADR-0015). The monitored leaf
 * (`path_class`) is a view-class; each view names the axis it aggregates along (e.g. `per_tor`,
 * `per_panel_pair`). Recorded in the snapshot because it is part of the measurement design (hence
 * part of replay) and lets honest measurement report per-view detection/blind-spots.
 */
export interface AggregationView {
  view: string;
  leaf_ids: readonly PathClassId[];
}

export interface FaultDomainSnapshot {
  nodes: readonly FaultDomainNode[];
  edges: readonly FaultDomainEdge[]; // path-class -> resource incidence
  path_classes: readonly PathClassId[];
  resources: ReadonlyArray<{ id: ResourceId; kind: ResourceKind }>;
  fetched_at_ts: number;
  source_id: string;
  source_version: string;
  /** aggregation-view leaf grouping (ADR-0015); absent ⇒ a single implicit path-class view (v1). */
  views?: readonly AggregationView[];
}
