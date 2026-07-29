/**
 * Per-path-class anytime-valid detection (v1 spec AC-2a + AC-2b).
 *
 * Runs BOTH families per path-class, reused wholesale from the engine (no detector math here):
 *   - Family A (mean-shift): betting e-process over the standardized p99_latency residual.
 *   - Family C (distributional): Safe-Hotelling e-process over the full residual vector.
 *
 * Each family's α-budget (allocated + spent) is carried into the verdict, and thence the
 * audit record. The combined per-path e-value is the AVERAGE of the family e-values —
 * averaging e-values is valid under arbitrary dependence (the two families share data) AT A
 * FIXED QUERY TIME. Filtration boundary (ADR-0044): Family D lives in the WINDOW filtration
 * (its wealth is provably not a tick-filtration supermartingale — evidence-tested), so the
 * combined value is NOT itself an anytime e-process across ticks: its sup-crossing guarantee
 * degrades to the K/c union bound over the K families. Each family's own fire rule keeps its
 * exact Ville bound (D is constant between window boundaries), and every published figure is a
 * fixed-time/single-query read — see ADR-0044 for the analysis and the adjuster upgrade path.
 */
import {
  freshBettingState,
  updateBettingState,
} from '@johnpatrickwarren-oss/deploysignal-engine/detectors/betting-e-process';
import { combineAverage } from '@johnpatrickwarren-oss/deploysignal-engine/fleet/combine';
import { runFamilyC } from './family-c';
import { runFamilyD, DEFAULT_SPECTRAL } from './family-d';
import type { SpectralParams } from './family-d';
import type { FamilyCPerCell } from '@johnpatrickwarren-oss/deploysignal-engine/types/families/c';
import type { FamilyDCell } from './family-d';
import { SIGNALS } from './signals';
import type { SignalVector } from './signals';
import type { PathClassId } from './domain';
import type { PathClassVerdict, DetectorResult, SegmentVerdict } from './verdict';

export interface DetectParams {
  /** per-tick α for the Family A betting e-process. */
  alphaA: number;
  /** per-tick α for the Family C Safe-Hotelling e-process. */
  alphaC: number;
}

export const DEFAULT_DETECT: DetectParams = { alphaA: 0.01, alphaC: 0.01 };

/** Calibrated detector context (ADR-0007/0009): the learned Family C Σ and the Family D nulls. */
export interface DetectorContext {
  /** learned Family C baseline covariance cell (ADR-0007); omitted ⇒ identity Σ. */
  familyCCell?: FamilyCPerCell;
  /** per-signal Family D spectral nulls (ADR-0009); omitted ⇒ Family D not run. */
  familyDCells?: readonly (FamilyDCell | null)[];
  /** Family D windowing params (defaults to DEFAULT_SPECTRAL). */
  spectral?: SpectralParams;
}

/**
 * Family A (mean-shift) over ALL signals (ADR-0003): one betting e-process per signal, family
 * e-value = mean of per-signal e-values. Averaging e-values preserves the e-value property under
 * arbitrary dependence, so the family fires validly at M ≥ 1/α_A and a mean shift on ANY signal
 * is caught — at the honest cost of an ≈p× higher single-signal detection floor.
 */
function runFamilyA(series: readonly SignalVector[], alphaA: number): DetectorResult {
  const p = SIGNALS.length;
  const states = SIGNALS.map(() => freshBettingState());
  const M = new Array<number>(p).fill(1);
  for (const vec of series) {
    for (let i = 0; i < p; i++) {
      M[i] = updateBettingState(states[i], vec[i], /*baselineMean*/ 0, /*sigma^2*/ 1, alphaA);
    }
  }
  const familyE = saturateE(M.reduce((s, x) => s + x, 0) / p);
  // ADR-0065 — the same mean kept exactly in the log domain (logSumExp over the engine's exact
  // per-signal log-wealth); familyE is its saturating linear view.
  const familyLogE = combineAverage(states.map((s, i) => s.log_M ?? Math.log(M[i]))).log_fleet_e;
  // α is booked as spent iff the family rejects (spent-on-fire), matching Family C; the engine's
  // betting state.alphaConsumed is a cumulative per-tick allocation and is deliberately not used.
  const fired = familyE >= 1 / alphaA;
  return { family: 'A', e_value: familyE, log_e_value: familyLogE, fired, alpha_allocated: alphaA, alpha_spent: fired ? alphaA : 0 };
}

export function detectPathClass(
  pathClassId: PathClassId,
  series: readonly SignalVector[],
  params: DetectParams = DEFAULT_DETECT,
  ctx: DetectorContext = {},
): PathClassVerdict {
  const a = runFamilyA(series, params.alphaA);
  const c = runFamilyC(series, params.alphaC, ctx.familyCCell);
  const detectors: DetectorResult[] = [
    a,
    { family: 'C', e_value: c.e_value, log_e_value: c.log_e_value, fired: c.fired, alpha_allocated: params.alphaC, alpha_spent: c.alpha_spent },
  ];
  // Family D (spectral) runs only when its nulls are calibrated (ADR-0009); A+C-only callers are
  // unchanged. The combined e-value is the mean over whatever detectors are present (2 → (a+c)/2).
  if (ctx.familyDCells) {
    const d = runFamilyD(series, ctx.familyDCells, ctx.spectral ?? DEFAULT_SPECTRAL);
    detectors.push({ family: 'D', e_value: d.e_value, log_e_value: d.log_e_value, fired: d.fired, alpha_allocated: (ctx.spectral ?? DEFAULT_SPECTRAL).alphaD, alpha_spent: d.alpha_spent });
  }
  return {
    path_class_id: pathClassId,
    detectors,
    e_value: saturateE(detectors.reduce((s, dt) => s + dt.e_value, 0) / detectors.length),
    log_e_value: combineAverage(detectors.map(detectorLogE)).log_fleet_e,
    fired: detectors.some((dt) => dt.fired),
    alpha_spent: detectors.reduce((s, dt) => s + dt.alpha_spent, 0),
  };
}

/** ADR-0065 — saturate a linear e-value mean at Number.MAX_VALUE. The engine saturates each
 *  STATE's view, but a SUM of near-saturated views overflows to Infinity (MAX + MAX/5 = ∞) —
 *  reachable in a long always-on session where Family A saturates alongside C (cold-eye 0065
 *  finding 1). In range this is the identity (bytes preserved); the exact record lives in
 *  log_e_value either way. */
export function saturateE(x: number): number {
  return Math.min(x, Number.MAX_VALUE);
}

/** ADR-0065 — a detector's exact log e-value, healing rows that lack it:
 *  - a pre-0065 DEFECT-ERA audit row whose e_value JSON-serialized Infinity to null heals to
 *    the saturation point (the engine healLogWealth convention), NOT to the floor — null must
 *    never be coerced to a number;
 *  - a live non-positive/absent value heals to the engine wealth floor;
 *  - otherwise log of the linear view (saturation → log MAX). */
export function detectorLogE(dt: { e_value: number | null; log_e_value?: number | null }): number {
  const logE = dt.log_e_value;
  if (logE != null && !Number.isNaN(logE)) return logE;
  const e = dt.e_value;
  if (e == null) return Math.log(Number.MAX_VALUE);
  if (!(e > 0)) return Math.log(1e-300);
  return Number.isFinite(e) ? Math.log(e) : Math.log(Number.MAX_VALUE);
}

/** One planned e-process segment for a leaf whose incidence changed mid-stream (ADR-0018). */
export interface SegmentSpec {
  epoch_index: number;
  from_tick: number;
  /** exclusive. */
  to_tick: number;
}

/** Combine one family's per-segment results: MEAN e-value (valid under arbitrary dependence — the
 *  same rule as the family combine), any-segment-fired, α spent summed over segment runs. */
function combineFamily(runs: readonly PathClassVerdict[], f: number): DetectorResult {
  const rows = runs.map((r) => r.detectors[f]);
  return {
    family: rows[0].family,
    e_value: saturateE(rows.reduce((s, r) => s + r.e_value, 0) / rows.length),
    log_e_value: combineAverage(rows.map(detectorLogE)).log_fleet_e,
    fired: rows.some((r) => r.fired),
    alpha_allocated: rows[0].alpha_allocated,
    alpha_spent: rows.reduce((s, r) => s + r.alpha_spent, 0),
  };
}

/**
 * Epoch-aware detection for a leaf whose incidence changed mid-stream (ADR-0018): each segment is
 * detected with FRESH wealth — the deliberate, recorded reset (the pipeline writes it into the
 * audit's `eprocess_resets`). The leaf's `evidence_epoch` is the epoch of its max-e-value segment
 * (ties → earlier) — attribution metadata for per-epoch tomography, not part of the e-value.
 */
/** Combine per-segment runs into the leaf verdict (ADR-0018) — shared by the batch slicer and
 *  the incremental session (ADR-0027), so the composition is one code path. */
export function combineSegmentRuns(pathClassId: PathClassId, runs: readonly PathClassVerdict[], segs: readonly SegmentSpec[]): PathClassVerdict {
  const detectors = runs[0].detectors.map((_, f) => combineFamily(runs, f));
  const segments: SegmentVerdict[] = segs.map((s, i) => ({
    epoch_index: s.epoch_index,
    from_tick: s.from_tick,
    to_tick: s.to_tick,
    e_value: runs[i].e_value,
    log_e_value: detectorLogE(runs[i]),
    fired: runs[i].fired,
  }));
  let best = 0;
  for (let i = 1; i < segments.length; i++) if (segments[i].e_value > segments[best].e_value) best = i;
  return {
    path_class_id: pathClassId,
    detectors,
    e_value: saturateE(detectors.reduce((s, dt) => s + dt.e_value, 0) / detectors.length),
    log_e_value: combineAverage(detectors.map(detectorLogE)).log_fleet_e,
    fired: detectors.some((dt) => dt.fired),
    alpha_spent: detectors.reduce((s, dt) => s + dt.alpha_spent, 0),
    segments,
    evidence_epoch: segments[best].epoch_index,
  };
}

export function detectPathClassSegmented(
  pathClassId: PathClassId,
  series: readonly SignalVector[],
  segs: readonly SegmentSpec[],
  params: DetectParams = DEFAULT_DETECT,
  ctx: DetectorContext = {},
): PathClassVerdict {
  if (segs.length === 0) throw new RangeError('segmented detection needs at least one segment');
  const runs = segs.map((s) => detectPathClass(pathClassId, series.slice(s.from_tick, s.to_tick), params, ctx));
  return combineSegmentRuns(pathClassId, runs, segs);
}

/**
 * Detect across all path-classes in canonical order. The optional DetectorContext supplies the
 * learned Family C Σ (ADR-0007) and/or the Family D spectral nulls (ADR-0009); omitted ⇒ A+C with
 * the identity-Σ default. The optional `plan` (ADR-0018) routes leaves whose incidence changed
 * mid-stream through segmented detection; leaves not in the plan are untouched (byte-identical).
 */
export function detectAll(
  series: ReadonlyMap<PathClassId, SignalVector[]>,
  params: DetectParams = DEFAULT_DETECT,
  ctx: DetectorContext = {},
  plan?: ReadonlyMap<PathClassId, readonly SegmentSpec[]>,
): PathClassVerdict[] {
  const ids = [...series.keys()].sort();
  return ids.map((id) => {
    const segs = plan?.get(id);
    return segs?.length
      ? detectPathClassSegmented(id, series.get(id)!, segs, params, ctx)
      : detectPathClass(id, series.get(id)!, params, ctx);
  });
}
