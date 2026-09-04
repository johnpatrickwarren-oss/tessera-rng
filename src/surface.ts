/**
 * Fleet surface (v1 spec AC-3a/3b): hierarchical e-value combination + e-BH FDR over the
 * per-path-class verdict set. Both reused from the engine.
 *
 * combineAverage is the arbitrary-dependence-valid (AoE) merge — load-bearing because
 * path-class signals are heavily correlated through shared hardware (ADR-0001 / spec P1).
 * e-BH controls FDR under arbitrary dependence; it selects WHICH path-classes are degraded.
 *
 * ADR-0066: the surface also carries e-BH's realized threshold and each leaf's log-margin to it
 * (engine ADR 0027) — DIAGNOSTIC fields, read from the selection the engine already computed.
 */
import { combineAverage } from '@johnpatrickwarren-oss/deploysignal-engine/fleet/combine';
import { eBenjaminiHochberg, eBenjaminiHochbergLog } from '@johnpatrickwarren-oss/deploysignal-engine/fleet/e-bh';
import { eBenjaminiYekutieli } from '@johnpatrickwarren-oss/deploysignal-engine/fleet/e-by';
import { CS_SIGMA_SQUARED_PRIOR } from './detect';
import { SIGNALS } from './signals';
import type { EffectIntervals } from './verdict';
import type { PathClassId } from './domain';
import type { PathClassVerdict, EffectCs } from './verdict';

const WEALTH_FLOOR = 1e-12;
/** Jeffreys pseudo-count for the floored fleet base firing rate q₀ (ADR-0016) — keeps q₀ ∈ (0,1)
 *  even on a quiet fabric (|selected|=0), so the leaky-LLR scorer's log(·/q₀) never degenerates. */
const Q0_PSEUDO = 0.5;

/** One leaf's log-margin to the realized e-BH threshold (ADR-0066). See FleetSurface.margins. */
export interface LeafMargin {
  path_class_id: PathClassId;
  /** log(e_leaf) − log_threshold_e. ≥ 0 iff the leaf is in `selected_path_class_ids` (ties at the
   *  boundary are selected). Floored at −log(Number.MAX_VALUE) so a zero e-value never serializes
   *  as null (engine ADR 0026 convention). */
  log_margin: number;
}

export interface FleetSurface {
  /** log of the arbitrary-dependence-valid fleet e-value. */
  fleet_log_e: number;
  /** e-BH FDR target. */
  q: number;
  /** path-class ids selected by e-BH (FDR controlled at q). */
  selected_path_class_ids: PathClassId[];
  /** floored fleet base firing rate q₀ = (|selected| + ½)/(|leaves| + 1) — the leaky-LLR null (ADR-0016). */
  base_rate_q0: number;
  /**
   * The realized e-BH selection threshold, log domain: log(N / (q · max(K, 1))), K = |selected|
   * (Ramdas–Wang 2025 Proposition 9.12: e-BH rejects iff e_k ≥ t_q with t_q ∈ {N/(kq)}). It
   * separates the selected set exactly — `selected_path_class_ids` is precisely the leaves with
   * `log_margin ≥ 0` (engine `fleet/e-bh.ts`, proof in the field docstring; engine ADR 0027).
   *
   * DIAGNOSTIC, NOT A GUARANTEE (knowledge stats/e-betting-metrics-2026-09-02 option 3): the
   * threshold is DATA-DEPENDENT — it moves with K — so a leaf's distance to it describes THIS
   * snapshot's ranking, not a certified quantity. The FDR claim is unchanged and still rests on
   * the inputs being e-values: ADR-0050's dispersion boundary and the ADR-0060 license gate
   * (src/license.ts) apply to the reading of this field exactly as to the selection.
   */
  log_threshold_e: number;
  /**
   * Per-leaf log-margin to `log_threshold_e`, one entry per verdict, in canonical (sorted
   * path_class_id) order — the same order the audit's `verdicts` array uses. A margin ≥ 0 means
   * selected in THIS snapshot; a negative margin is how far (in nats) the leaf sat below the
   * realized threshold, which itself would move if the leaf's evidence did. Same diagnostic
   * caveat as `log_threshold_e`: ranking information, no FDR claim of its own.
   */
  margins: ReadonlyArray<LeafMargin>;
  /**
   * ADR-0067 — e-BY effect-size intervals for every selected leaf, one per signal, at
   * `alpha_i = fcrDelta·|S|/|leaves|` (engine `fleet/e-by.ts`; Ramdas–Wang 2025 Theorem 13.7:
   * FCR ≤ fcrDelta for ANY selection rule under ANY dependence, given level-free e-CIs). Present
   * iff every verdict's Family A row carries `effect_cs` (the level-free inputs); a verdict set
   * that lacks it anywhere (pre-ADR-0067 audits) yields a surface without this field, byte-identical
   * to before. Reported: the interval is the shift from the calibrated baseline in residual units
   * over the leaf's current segment, covering a CONSTANT shift (study 2026-09-e-by-surface P1b on
   * what per-cell standardization does to a raw level shift). No selection, α or verdict reads it.
   */
  effect_intervals?: EffectIntervals;
}

/** ADR-0067 — true iff every verdict has a Family A row with a full `effect_cs`. */
function allCarryEffectCs(verdicts: readonly PathClassVerdict[]): boolean {
  return verdicts.every((v) => {
    const a = v.detectors.find((d) => d.family === 'A');
    return !!a?.effect_cs && a.effect_cs.length === SIGNALS.length;
  });
}

function effectIntervals(ordered: readonly PathClassVerdict[], selected: readonly PathClassId[], delta: number): EffectIntervals {
  const p = SIGNALS.length;
  const K = ordered.length * p;
  const byId = new Map(ordered.map((v) => [v.path_class_id, v.detectors.find((d) => d.family === 'A')!.effect_cs as readonly EffectCs[]]));
  const inputs = selected.flatMap((pc) => byId.get(pc)!.map((c) => ({
    id: `${pc}/${c.signal}`,
    level_free: { S_t: c.S_t, t: c.t, sigma_squared: 1, sigma_squared_prior: CS_SIGMA_SQUARED_PRIOR },
  })));
  const out = eBenjaminiYekutieli(inputs, K, delta);
  const intervals = out.intervals.map((iv) => {
    const slash = iv.id.lastIndexOf('/');
    return { path_class_id: iv.id.slice(0, slash) as PathClassId, signal: iv.id.slice(slash + 1) as EffectIntervals['intervals'][number]['signal'], center: iv.center, half_width: iv.half_width, lower: iv.lower, upper: iv.upper };
  });
  return { delta, K, selected: out.selected_count, alpha_i: out.alpha_i, intervals, guarantee: out.guarantee };
}

export function buildSurface(verdicts: readonly PathClassVerdict[], q: number, fcrDelta: number = q): FleetSurface {
  // canonical order so indices ↔ ids are stable and replay-clean.
  const ordered = [...verdicts].sort((a, b) => (a.path_class_id < b.path_class_id ? -1 : a.path_class_id > b.path_class_id ? 1 : 0));
  const logEs = ordered.map((v) => Math.log(Math.max(v.e_value, WEALTH_FLOOR)));
  const fleet = combineAverage(logEs);

  // ADR-0066: when every verdict carries the exact ADR-0065 log record, select in the log
  // domain so saturated leaves keep their true ordering (and their true margins); a verdict set
  // that lacks it anywhere (pre-ADR-0065 audits) goes through the linear procedure unchanged.
  // The two variants are never mixed within one call. Measured identical selections on every
  // committed fixture (ADR-0066).
  const exact = ordered.every((v) => typeof v.log_e_value === 'number');
  const ebh = exact
    ? eBenjaminiHochbergLog(ordered.map((v) => v.log_e_value!), q)
    : eBenjaminiHochberg(ordered.map((v) => v.e_value), q);
  const selected = ebh.selected.map((i) => ordered[i].path_class_id).sort();
  const margins = ordered.map((v, i) => ({ path_class_id: v.path_class_id, log_margin: ebh.log_margin[i] }));

  const base_rate_q0 = (selected.length + Q0_PSEUDO) / (ordered.length + 2 * Q0_PSEUDO);
  const surface: FleetSurface = { fleet_log_e: fleet.log_fleet_e, q, selected_path_class_ids: selected, base_rate_q0, log_threshold_e: ebh.log_threshold_e, margins };
  // ADR-0067: only when every leaf carries the level-free inputs; otherwise the surface is as before.
  if (ordered.length > 0 && allCarryEffectCs(ordered)) surface.effect_intervals = effectIntervals(ordered, selected, fcrDelta);
  return surface;
}
