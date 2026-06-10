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
/** Jeffreys pseudo-count for the floored fleet base firing rate q₀ (ADR-0016) — keeps q₀ ∈ (0,1)
 *  even on a quiet fabric (|selected|=0), so the leaky-LLR scorer's log(·/q₀) never degenerates. */
const Q0_PSEUDO = 0.5;

export interface FleetSurface {
  /** log of the arbitrary-dependence-valid fleet e-value. */
  fleet_log_e: number;
  /** e-BH FDR target. */
  q: number;
  /** path-class ids selected by e-BH (FDR controlled at q). */
  selected_path_class_ids: PathClassId[];
  /** floored fleet base firing rate q₀ = (|selected| + ½)/(|leaves| + 1) — the leaky-LLR null (ADR-0016). */
  base_rate_q0: number;
}

export function buildSurface(verdicts: readonly PathClassVerdict[], q: number): FleetSurface {
  // canonical order so indices ↔ ids are stable and replay-clean.
  const ordered = [...verdicts].sort((a, b) => (a.path_class_id < b.path_class_id ? -1 : a.path_class_id > b.path_class_id ? 1 : 0));
  const logEs = ordered.map((v) => Math.log(Math.max(v.e_value, WEALTH_FLOOR)));
  const fleet = combineAverage(logEs);

  const eValues = ordered.map((v) => v.e_value);
  const ebh = eBenjaminiHochberg(eValues, q);
  const selected = ebh.selected.map((i) => ordered[i].path_class_id).sort();

  const base_rate_q0 = (selected.length + Q0_PSEUDO) / (ordered.length + 2 * Q0_PSEUDO);
  return { fleet_log_e: fleet.log_fleet_e, q, selected_path_class_ids: selected, base_rate_q0 };
}
