/**
 * Spraypoint two-view fabric generator (ADR-0015; resolves work-order item 5).
 *
 * The paper (ADR-0013) puts production at ~960 ToRs ⇒ ~460K ToR-pairs, which does not fit AC-1's
 * [100, 10000] leaf bound, and — more to the point — at that scale a single-component fault is
 * intrinsically DILUTED everywhere (one optic ≈ 1/d of one ToR's sprayed traffic, smeared over ~all
 * its pairs). Per-leaf SNR is tiny; detection power comes from AGGREGATING many weakly-affected
 * leaves that share fault exposure (m leaves keep the mean shift δ but cut noise by √m).
 *
 * So the monitored leaf is an **aggregation-view class**, and we run the UNION of two complementary
 * views over the same underlying ToR-pair traffic (the "right axis" differs by fault kind):
 *   - `per_tor`        (~nTors leaves)        — concentrates optic/router faults (a faulty ToR's
 *                                               pairs all share its optic), smears trunk/panel faults;
 *   - `per_panel_pair` (~C(nPanels,2) leaves) — concentrates shuffle-panel/room faults, smears
 *                                               optic faults (a faulty ToR is 1/nTors of the pair).
 * The views are dependent (same flows) — fine: e-BH and the e-value merges are arbitrary-dependence
 * valid (P1, the reason they were chosen). ToR-pair stays the UNDERLYING entity (drill-down is future
 * scope); the leaves are views over it. Incidence is WEIGHTED (ADR-0014): a view's weights are the
 * fraction of its aggregate traffic through each resource.
 */
import type { FaultDomainSnapshot, FaultDomainNode, FaultDomainEdge, ResourceKind, ResourceId, AggregationView } from './domain';

export interface SpraypointParams {
  /** number of ToRs (echoes the paper's d=64). */
  nTors: number;
  /** number of shuffle panels (full spray: every ToR reaches every panel). */
  nPanels: number;
  /** number of rooms the panels sit in. */
  nRooms: number;
}

/** Documented defaults — 64 ToRs + C(10,2)=45 panel-pairs = 109 leaves, inside AC-1's [100, 10000]. */
export const DEFAULT_SPRAYPOINT: SpraypointParams = { nTors: 64, nPanels: 10, nRooms: 2 };

const opticId = (i: number): ResourceId => `optic-${i}`;
const panelId = (p: number): ResourceId => `panel-${p}`;
const roomId = (r: number): ResourceId => `room-${r}`;
const roomOf = (panel: number, nRooms: number): number => panel % nRooms;

function buildResources(params: SpraypointParams): Array<{ id: ResourceId; kind: ResourceKind }> {
  const res: Array<{ id: ResourceId; kind: ResourceKind }> = [];
  for (let i = 0; i < params.nTors; i++) res.push({ id: opticId(i), kind: 'optic' });
  for (let p = 0; p < params.nPanels; p++) res.push({ id: panelId(p), kind: 'shuffle_panel' });
  for (let r = 0; r < params.nRooms; r++) res.push({ id: roomId(r), kind: 'room' });
  return res;
}

/** Edges for a per-ToR leaf: all its traffic on its own optic (w=1), spread over panels and rooms. */
function torLeafEdges(leaf: string, i: number, params: SpraypointParams): FaultDomainEdge[] {
  const edges: FaultDomainEdge[] = [{ path_class: leaf, resource: opticId(i), relationship: 'traverses', weight: 1 }];
  for (let p = 0; p < params.nPanels; p++) edges.push({ path_class: leaf, resource: panelId(p), relationship: 'traverses', weight: 1 / params.nPanels });
  for (let r = 0; r < params.nRooms; r++) edges.push({ path_class: leaf, resource: roomId(r), relationship: 'traverses', weight: 1 / params.nRooms });
  return edges;
}

/** Edges for a per-panel-pair leaf: all its traffic on both panels (w=1), a 1/nTors slice per optic. */
function panelPairLeafEdges(leaf: string, a: number, b: number, params: SpraypointParams): FaultDomainEdge[] {
  const edges: FaultDomainEdge[] = [
    { path_class: leaf, resource: panelId(a), relationship: 'traverses', weight: 1 },
    { path_class: leaf, resource: panelId(b), relationship: 'traverses', weight: 1 },
  ];
  for (let i = 0; i < params.nTors; i++) edges.push({ path_class: leaf, resource: opticId(i), relationship: 'traverses', weight: 1 / params.nTors });
  for (const r of new Set([roomOf(a, params.nRooms), roomOf(b, params.nRooms)])) edges.push({ path_class: leaf, resource: roomId(r), relationship: 'traverses', weight: 1 });
  return edges;
}

export function generateSpraypointFabric(params: SpraypointParams = DEFAULT_SPRAYPOINT): FaultDomainSnapshot {
  if (params.nTors < 1 || params.nPanels < 2 || params.nRooms < 1) throw new RangeError('spraypoint needs nTors≥1, nPanels≥2, nRooms≥1');
  const resources = buildResources(params);
  const edges: FaultDomainEdge[] = [];
  const torLeaves: string[] = [];
  const ppLeaves: string[] = [];

  for (let i = 0; i < params.nTors; i++) {
    const leaf = `tor-${i}`;
    torLeaves.push(leaf);
    edges.push(...torLeafEdges(leaf, i, params));
  }
  for (let a = 0; a < params.nPanels; a++) {
    for (let b = a + 1; b < params.nPanels; b++) {
      const leaf = `pp-${a}-${b}`;
      ppLeaves.push(leaf);
      edges.push(...panelPairLeafEdges(leaf, a, b, params));
    }
  }

  const path_classes = [...torLeaves, ...ppLeaves].sort();
  const views: AggregationView[] = [
    { view: 'per_tor', leaf_ids: torLeaves },
    { view: 'per_panel_pair', leaf_ids: ppLeaves },
  ];
  const nodes: FaultDomainNode[] = [
    ...path_classes.map((id) => ({ id, kind: 'path_class' as const })),
    ...resources.map((r) => ({ id: r.id, kind: r.kind })),
  ];
  return {
    nodes,
    edges,
    path_classes,
    resources,
    views,
    fetched_at_ts: 0,
    source_id: 'synthetic-spraypoint-fabric',
    source_version: `sp:${params.nTors}x${params.nPanels}x${params.nRooms}`,
  };
}

/** Which aggregation view a leaf belongs to (for honest per-view coverage). */
export function viewOfLeaf(snapshot: FaultDomainSnapshot, leaf: string): string | null {
  for (const v of snapshot.views ?? []) if (v.leaf_ids.includes(leaf)) return v.view;
  return null;
}
