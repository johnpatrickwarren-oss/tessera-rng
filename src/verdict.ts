/**
 * Tessera-RNG verdict/output contract (v1 spec §3.4).
 *
 * The OUTPUT side: per-path-class detector verdicts (with per-detector α-budget), localized
 * culprits, the simulated drain action, and the replay-clean audit record.
 *
 * (Split from the data contract in domain.ts to keep the result layer and the data layer as
 * separate, low-coupling concerns.)
 */
import type { PathClassId, ResourceId, ResourceKind } from './domain';

/** One family's anytime-valid result for a path-class, with its α-budget (v1 spec AC-2a/2b; +D ADR-0009). */
export interface DetectorResult {
  family: 'A' | 'C' | 'D';
  e_value: number;
  fired: boolean;
  /** α allocated to this detector. */
  alpha_allocated: number;
  /** α actually spent (nonzero once the detector fires). */
  alpha_spent: number;
}

/** One epoch-segment of a leaf's e-process run after an incidence-change reset (ADR-0018). */
export interface SegmentVerdict {
  /** the epoch the segment's evidence accrued in (the epoch active at from_tick). */
  epoch_index: number;
  from_tick: number;
  /** exclusive. */
  to_tick: number;
  /** the segment's combined e-value, accrued with FRESH wealth from from_tick. */
  e_value: number;
  fired: boolean;
}

export interface PathClassVerdict {
  path_class_id: PathClassId;
  /** per-detector results (Family A mean-shift + Family C distributional). */
  detectors: readonly DetectorResult[];
  /** combined per-path e-value (average of family e-values — valid under dependence). */
  e_value: number;
  /** true if any family fired. */
  fired: boolean;
  /** total α spent across detectors (audit record). */
  alpha_spent: number;
  /**
   * Present ONLY for leaves whose incidence changed mid-stream (ADR-0018): the per-segment
   * e-process runs, each with fresh wealth (the recorded reset). The leaf-level e-value is the
   * MEAN over segments — valid under arbitrary dependence, same rule as the family combine.
   * NOTE: a segmented leaf's `fired` flag is "ANY segment crossed 1/α" — across K segments the
   * flag's null rate is ≈K× the single-test rate. FDR control is unaffected (e-BH consumes only
   * the mean e-value); the flag is display/attribution, not the selection guarantee.
   */
  segments?: readonly SegmentVerdict[];
  /** the epoch of the max-e-value segment (ties → earlier) — where the firing evidence accrued. */
  evidence_epoch?: number;
}

export interface Culprit {
  resource_id: ResourceId;
  resource_kind: ResourceKind;
  /**
   * Localization score: rank-1 carries the full saturating-mixture LLR (ADR-0019); ranks ≥ 2
   * carry the MARGINAL LLR given the earlier picks (ADR-0022) — a pick-order-conditional
   * quantity, comparable within one localization but NOT across runs or epoch groups (the
   * drain ranking mixes scales across groups; recorded in ADR-0022).
   */
  score: number;
  /** ALL firing members of this resource — provenance, NOT an attribution partition: a later
   *  pick's list may include leaves an earlier pick explains (ADR-0022). */
  member_path_class_ids: readonly PathClassId[];
  firing_member_count: number;
  traversing_count: number;
  /**
   * The aggregation views (ADR-0015) that have a firing member of this resource — per-view
   * concurrence as DISPLAYED metadata (ADR-0016): cross-view agreement is informative for an
   * operator, but the localization mechanism is the union LLR, not a per-view vote.
   */
  supporting_views: readonly string[];
  /**
   * The epoch whose incidence snapshot this culprit was localized against (ADR-0018). For
   * segmented member leaves that is the epoch their max evidence accrued in; unsegmented leaves
   * join the LATEST epoch's group by stated convention (their own incidence is epoch-invariant,
   * so any epoch is exact for their edges — the field claims the localization snapshot, nothing
   * stronger). Absent on single-epoch (no-reroute) runs.
   */
  localized_against_epoch?: number;
  /** v1 spec AC-5b / N1: the layer claims correlation, never hardware root cause. */
  correlational_not_causal: true;
}

export interface DrainAction {
  resource_id: ResourceId;
  drained_path_class_ids: readonly PathClassId[];
  /** v1 spec N4: never a real data-plane call. */
  simulated: true;
}

/** Count of SELECTED path-classes each family fired on — the firing-mode attribution (ADR-0010). */
export interface FiringFamilies {
  A: number;
  C: number;
  D: number;
}

export interface AuditRecord {
  snapshot_hash: string;
  q: number;
  fleet_log_e: number;
  verdicts: readonly PathClassVerdict[];
  selected_path_class_ids: readonly PathClassId[];
  culprits: readonly Culprit[];
  /** firing paths the parsimonious culprit set does not explain (honest measurement). */
  unexplained_path_class_ids: readonly PathClassId[];
  drain_actions: readonly DrainAction[];
  /**
   * Which detector family drove the firings on the SELECTED set (ADR-0010): a degradation's anomaly
   * MODE is attributed to the family that caught it (mean → A, covariance → C, periodicity → D), so a
   * detection number is never published without saying which mode produced it.
   */
  firing_families: FiringFamilies;
  /** The epoch sequence the run was measured against (ADR-0017/0018). Absent on no-reroute runs. */
  epochs?: readonly { valid_from_tick: number; hash: string }[];
  /**
   * Every e-process wealth reset (ADR-0018): leaf × the tick its incidence changed. A reset is a
   * deliberate, RECORDED power loss (instrumented-caveat) — the leaf's pre-reset evidence lives in
   * its verdict `segments`, never silently discarded. Absent on no-reroute runs.
   */
  eprocess_resets?: readonly { path_class_id: PathClassId; at_tick: number; epoch_index: number }[];
}
