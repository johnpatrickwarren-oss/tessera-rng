/**
 * Fleet surface (v1 spec AC-3a/3b): hierarchical e-value combination + e-BH FDR over the
 * per-path-class verdict set. Both reused from the engine.
 *
 * combineAverage is the arbitrary-dependence-valid (AoE) merge — load-bearing because
 * path-class signals are heavily correlated through shared hardware (ADR-0001 / spec P1).
 * e-BH controls FDR under arbitrary dependence; it selects WHICH path-classes are degraded.
 */
import { combineAverage } from '@johnpatrickwarren-oss/deploysignal-engine/fleet/combine';
import { eBenjaminiHochberg } from '@johnpatrickwarren-oss/deploysignal-engine/fleet/e-bh';
import type { PathClassId } from './domain';
import type { PathClassVerdict } from './verdict';

const WEALTH_FLOOR = 1e-12;

export interface FleetSurface {
  /** log of the arbitrary-dependence-valid fleet e-value. */
  fleet_log_e: number;
  /** e-BH FDR target. */
  q: number;
  /** path-class ids selected by e-BH (FDR controlled at q). */
  selected_path_class_ids: PathClassId[];
}

export function buildSurface(verdicts: readonly PathClassVerdict[], q: number): FleetSurface {
  // canonical order so indices ↔ ids are stable and replay-clean.
  const ordered = [...verdicts].sort((a, b) => (a.path_class_id < b.path_class_id ? -1 : a.path_class_id > b.path_class_id ? 1 : 0));
  const logEs = ordered.map((v) => Math.log(Math.max(v.e_value, WEALTH_FLOOR)));
  const fleet = combineAverage(logEs);

  const eValues = ordered.map((v) => v.e_value);
  const ebh = eBenjaminiHochberg(eValues, q);
  const selected = ebh.selected.map((i) => ordered[i].path_class_id).sort();

  return { fleet_log_e: fleet.log_fleet_e, q, selected_path_class_ids: selected };
}
