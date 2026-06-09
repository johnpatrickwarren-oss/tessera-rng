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
}

export interface Culprit {
  resource_id: ResourceId;
  resource_kind: ResourceKind;
  /** localization score; higher = better explains the firing set. */
  score: number;
  member_path_class_ids: readonly PathClassId[];
  firing_member_count: number;
  traversing_count: number;
  /** v1 spec AC-5b / N1: the layer claims correlation, never hardware root cause. */
  correlational_not_causal: true;
}

export interface DrainAction {
  resource_id: ResourceId;
  drained_path_class_ids: readonly PathClassId[];
  /** v1 spec N4: never a real data-plane call. */
  simulated: true;
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
}
