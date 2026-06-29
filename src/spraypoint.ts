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
 * valid (P1, the reason they were chosen). ToR-pair stays the UNDERLYING entity (the ADR-0026 drill
 * examines it on demand); the leaves are views over it. Incidence is WEIGHTED (ADR-0014).
 *
 * ONE traffic model (ADR-0028): an elementary flow is (unordered ToR pair {i,j}, panel p), uniform
 * over C(nTors,2) × nPanels — one panel per flow, BOTH endpoint optics crossed (the single-stage
 * shuffle reading). Every view weight is the conditional traversal probability
 * P(flow crosses resource | flow ∈ leaf), and the drill's pair exposures are
 * P(flow crosses resource | flow ∈ pair) on the SAME space (the keystone bind in
 * test/traffic-model.test.ts enumerates the space and recomputes both). Zero-probability
 * traversals get NO edge — with ONE recorded exception going the other way: a tor leaf's
 * cross-optic exposure (true P = 1/(nTors−1) per partner optic) is deliberately NOT an edge.
 * The full-support variant was built and measured: the binary fire/quiet scorer drowns in 63
 * quiet 1/63-weight members (cross-kind multi-fault attribution collapses; the δ-sweep loses
 * the optic at δ≥64) — rejected on that evidence, bound by its own test, revisit only together
 * with a magnitude-aware member model (ADR-0028).
 */
import type { FaultDomainSnapshot, FaultDomainNode, FaultDomainEdge, ResourceKind, ResourceId, AggregationView } from './domain';

export interface SpraypointParams {
  /** number of ToRs (echoes the paper's d=64). */
  nTors: number;
  /** number of shuffle panels (full spray: every ToR reaches every panel). */
  nPanels: number;
  /** number of rooms the panels sit in. */
  nRooms: number;
  /**
   * OPT-IN full-support variant (ADR-0031): emit each tor leaf's partner-optic edges at the true
   * `P = 1/(nTors−1)` (the ADR-0028 recorded omission). DEFAULT OFF — the existing fabric, its
   * hashes/floors and the ADR-0028 narrowing-bind test are unchanged. ON is only sound WITH the
   * magnitude scorer (ADR-0029): the binary fire/quiet scorer drowns in the diluted quiet members
   * (the measured ADR-0028 rejection this round reverses). `source_version` marks `sp3:` when on.
   */
  crossOptic?: boolean;
}

/** Documented defaults — 64 ToRs + C(10,2)=45 panel-pairs = 109 leaves, inside AC-1's [100, 10000]. */
export const DEFAULT_SPRAYPOINT: SpraypointParams = { nTors: 64, nPanels: 10, nRooms: 2 };

/** The PAPER's production scale (ADR-0013/0025): 960 ToRs + C(32,2)=496 pair leaves = 1,456
 *  leaves (~514K weighted edges) — the upper range of AC-1, measured, not extrapolated. */
export const PAPER_SPRAYPOINT: SpraypointParams = { nTors: 960, nPanels: 32, nRooms: 4 };

const opticId = (i: number): ResourceId => `optic-${i}`;
const panelId = (p: number): ResourceId => `panel-${p}`;
const roomId = (r: number): ResourceId => `room-${r}`;
const roomOf = (panel: number, nRooms: number): number => panel % nRooms;
const panelsInRoom = (room: number, params: SpraypointParams): number => {
  let n = 0;
  for (let p = 0; p < params.nPanels; p++) if (roomOf(p, params.nRooms) === room) n += 1;
  return n;
};

function buildResources(params: SpraypointParams): Array<{ id: ResourceId; kind: ResourceKind }> {
  const res: Array<{ id: ResourceId; kind: ResourceKind }> = [];
  for (let i = 0; i < params.nTors; i++) res.push({ id: opticId(i), kind: 'optic' });
  for (let p = 0; p < params.nPanels; p++) res.push({ id: panelId(p), kind: 'shuffle_panel' });
  for (let r = 0; r < params.nRooms; r++) res.push({ id: roomId(r), kind: 'room' });
  return res;
}

/**
 * Edges for a per-ToR leaf — P(crosses · | endpoint i) under the ADR-0028 flow model:
 * own optic 1 (every flow crosses it); panels uniform 1/nPanels; room-r = its panel share,
 * panelsInRoom(r)/nPanels (an empty room is never traversed — no edge). PARTNER optics
 * (true P = 1/(nTors−1) each) are the recorded ADR-0028 omission — deliberately NOT emitted;
 * see the module header and the narrowing-bind test before "fixing" this.
 */
function torLeafEdges(leaf: string, i: number, params: SpraypointParams): FaultDomainEdge[] {
  const edges: FaultDomainEdge[] = [{ path_class: leaf, resource: opticId(i), relationship: 'traverses', weight: 1 }];
  // Partner-optic cross edges (ADR-0031 opt-in): true P = 1/(nTors−1) per partner. Off by default
  // (the ADR-0028 omission); on only WITH the magnitude scorer that can use the diluted evidence.
  if (params.crossOptic) {
    const w = 1 / (params.nTors - 1);
    for (let j = 0; j < params.nTors; j++) if (j !== i) edges.push({ path_class: leaf, resource: opticId(j), relationship: 'traverses', weight: w });
  }
  for (let p = 0; p < params.nPanels; p++) edges.push({ path_class: leaf, resource: panelId(p), relationship: 'traverses', weight: 1 / params.nPanels });
  for (let r = 0; r < params.nRooms; r++) {
    const share = panelsInRoom(r, params) / params.nPanels;
    if (share > 0) edges.push({ path_class: leaf, resource: roomId(r), relationship: 'traverses', weight: share });
  }
  return edges;
}

/**
 * Edges for a per-panel-pair leaf — P(crosses · | panel ∈ {a,b}) under the ADR-0028 flow model:
 * each of its two panels 1/2 (one panel per flow — the old two-panel w=1 convention is gone);
 * each optic 2/nTors (both-endpoint counting: nTors−1 of C(nTors,2) pairs end there); room-r =
 * |{a,b} ∩ panels(r)|/2 — 1 when both panels share the room, 1/2 each when they split.
 */
function panelPairLeafEdges(leaf: string, a: number, b: number, params: SpraypointParams): FaultDomainEdge[] {
  const edges: FaultDomainEdge[] = [
    { path_class: leaf, resource: panelId(a), relationship: 'traverses', weight: 1 / 2 },
    { path_class: leaf, resource: panelId(b), relationship: 'traverses', weight: 1 / 2 },
  ];
  for (let i = 0; i < params.nTors; i++) edges.push({ path_class: leaf, resource: opticId(i), relationship: 'traverses', weight: 2 / params.nTors });
  const ra = roomOf(a, params.nRooms);
  const rb = roomOf(b, params.nRooms);
  if (ra === rb) edges.push({ path_class: leaf, resource: roomId(ra), relationship: 'traverses', weight: 1 });
  else {
    edges.push({ path_class: leaf, resource: roomId(ra), relationship: 'traverses', weight: 1 / 2 });
    edges.push({ path_class: leaf, resource: roomId(rb), relationship: 'traverses', weight: 1 / 2 });
  }
  return edges;
}

export function generateSpraypointFabric(params: SpraypointParams = DEFAULT_SPRAYPOINT): FaultDomainSnapshot {
  // nTors ≥ 2: with one ToR the flow space (unordered pairs × panels) is EMPTY — every leaf's
  // conditional traversal probability is undefined (ADR-0028; the old per-leaf conventions
  // happened to tolerate it, the unified model does not pretend to).
  if (params.nTors < 2 || params.nPanels < 2 || params.nRooms < 1) throw new RangeError('spraypoint needs nTors≥2, nPanels≥2, nRooms≥1');
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
    // `sp2` marks the unified flow model (ADR-0028); `sp3` the opt-in cross-optic full-support
    // variant (ADR-0031) — artifacts differ by hash anyway; the marker says WHY.
    source_version: `${params.crossOptic ? 'sp3' : 'sp2'}:${params.nTors}x${params.nPanels}x${params.nRooms}`,
  };
}

/** Which aggregation view a leaf belongs to (for honest per-view coverage). */
export function viewOfLeaf(snapshot: FaultDomainSnapshot, leaf: string): string | null {
  for (const v of snapshot.views ?? []) if (v.leaf_ids.includes(leaf)) return v.view;
  return null;
}
