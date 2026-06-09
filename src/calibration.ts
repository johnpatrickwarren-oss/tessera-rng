/**
 * Per-cell calibration substrate (v1 spec AC-7).
 *
 * The random-graph "normal" is itself a smear — baseline behavior varies by time-of-day,
 * day-of-week and traffic-class. We characterize it per cell rather than assuming a single
 * unimodal baseline: each cell = (hour-of-day × day-of-week × traffic-class) gets its own
 * per-signal (mean, sd), estimated from a clean calibration window. Live raw signals are
 * then standardized against their cell's baseline to produce the residuals detectors consume.
 *
 * This is the network analogue of Tessera's production-AR substrate calibrator + per-cell
 * baselines; the engine's per-shard runtime is signal-agnostic, so standardized residuals
 * feed it unchanged.
 */
import { sampleAutocovariance, prewhitenAr } from '@johnpatrickwarren-oss/deploysignal-engine/detectors/ar-p';
import { SIGNALS } from './signals';
import type { SignalVector } from './signals';
import type { PathClassId } from './domain';

export const TRAFFIC_CLASSES = ['interactive', 'bulk', 'storage'] as const;
export type TrafficClass = (typeof TRAFFIC_CLASSES)[number];
export const HOURS_PER_DAY = 24;
export const DAYS_PER_WEEK = 7;

/**
 * Minimum calibration samples a cell needs before its OWN (mean, sd) is trusted (ADR-0006).
 * Below this, a cell's sd is estimated from too few points: against an INDEPENDENT live window,
 * a downward-fluctuated sd estimate inflates the standardized residual variance, manufacturing
 * false positives and breaking e-BH FDR control. Such under-sampled cells fall back to the
 * pooled per-signal baseline (well-estimated from all cells).
 *
 * The value 30 is empirical, not the kickoff's rough "~5": a sweep over clean small topologies
 * (ADR-0006) shows per-cell standardization only stops false-selecting once n ≳ 30 (sd relative
 * error ≈ 1/√(2n) ≈ 13%). At 30, clean fabrics from 9 → ∞ path-classes select nothing, while the
 * default ~400-path-class fabric (n ≈ 130/cell) keeps full per-cell resolution untouched.
 */
export const DEFAULT_MIN_CELL_SAMPLES = 30;

/** Deterministic traffic-class assignment per path-class (stable hash of the id). */
export function trafficClassOf(pathClassId: PathClassId): TrafficClass {
  let h = 0;
  for (let i = 0; i < pathClassId.length; i++) h = (h * 31 + pathClassId.charCodeAt(i)) >>> 0;
  return TRAFFIC_CLASSES[h % TRAFFIC_CLASSES.length];
}

/** Cell key for a tick: hour-of-day × day-of-week × traffic-class. */
export function cellKey(tick: number, tc: TrafficClass): string {
  const hour = ((tick % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  const dow = Math.floor(tick / HOURS_PER_DAY) % DAYS_PER_WEEK;
  return `${hour}-${dow}-${tc}`;
}

export interface CellStats {
  n: number;
  mean: number[];
  sd: number[];
  /** true iff (mean, sd) came from the pooled fallback because the cell was under-sampled (ADR-0006). */
  pooled?: boolean;
}
/**
 * The production-AR substrate (ADR-0004): per-cell level baselines (the diurnal/class smear) +
 * a per-signal AR(1) coefficient (the temporal autocorrelation). Standardization removes the
 * level with the cell baseline, then pre-whitens the temporal correlation with the AR model, so
 * detectors see near-iid residuals and FDR control holds under autocorrelated telemetry.
 */
export interface CalibrationSubstrate {
  cells: ReadonlyMap<string, CellStats>;
  /**
   * Pooled per-signal (mean, sd) over ALL calibration samples — the fallback baseline for
   * under-sampled cells (n < minCellSamples) and for cells unseen at calibration time (ADR-0006).
   */
  pooled: CellStats;
  /** per-signal AR(1) coefficient φ. */
  arPhi: number[];
}

interface Acc {
  n: number;
  sum: number[];
  sumsq: number[];
}

/** Finalize an accumulator into (mean, sd), flooring sd to keep standardization finite. */
function statsOf(a: Acc): { mean: number[]; sd: number[] } {
  const mean = a.sum.map((s) => s / a.n);
  const sd = a.sum.map((_, i) => Math.sqrt(Math.max(a.sumsq[i] / a.n - mean[i] * mean[i], 1e-9)));
  return { mean, sd };
}

/**
 * Build per-cell baselines AND the pooled per-signal baseline in one pass. Cells with fewer
 * than `minCellSamples` observations fall back to the pooled (mean, sd) — their own sd is too
 * noisy to trust (ADR-0006). The pooled stats are returned too, for cells unseen at calibration.
 */
function buildCells(
  raw: ReadonlyMap<PathClassId, SignalVector[]>,
  minCellSamples: number,
): { cells: Map<string, CellStats>; pooled: CellStats } {
  const p = SIGNALS.length;
  const acc = new Map<string, Acc>();
  const pool: Acc = { n: 0, sum: new Array<number>(p).fill(0), sumsq: new Array<number>(p).fill(0) };
  for (const [pc, series] of raw) {
    const tc = trafficClassOf(pc);
    for (let t = 0; t < series.length; t++) {
      const key = cellKey(t, tc);
      let a = acc.get(key);
      if (!a) {
        a = { n: 0, sum: new Array<number>(p).fill(0), sumsq: new Array<number>(p).fill(0) };
        acc.set(key, a);
      }
      const v = series[t];
      a.n += 1;
      pool.n += 1;
      for (let i = 0; i < p; i++) {
        a.sum[i] += v[i];
        a.sumsq[i] += v[i] * v[i];
        pool.sum[i] += v[i];
        pool.sumsq[i] += v[i] * v[i];
      }
    }
  }
  const pooledStats = pool.n > 0 ? statsOf(pool) : { mean: new Array<number>(p).fill(0), sd: new Array<number>(p).fill(1) };
  const pooled: CellStats = { n: pool.n, ...pooledStats, pooled: true };

  const cells = new Map<string, CellStats>();
  for (const [key, a] of acc) {
    if (a.n < minCellSamples) {
      // under-sampled: borrow the pooled baseline rather than trust a noisy per-cell sd.
      cells.set(key, { n: a.n, mean: pooled.mean, sd: pooled.sd, pooled: true });
    } else {
      cells.set(key, { n: a.n, ...statsOf(a) });
    }
  }
  return { cells, pooled };
}

/** Per-cell de-mean/standardize only (no pre-whitening). */
function deMean(
  series: readonly SignalVector[],
  pathClassId: PathClassId,
  cells: ReadonlyMap<string, CellStats>,
  pooled: CellStats,
): number[][] {
  const tc = trafficClassOf(pathClassId);
  return series.map((v, t) => {
    // Unseen cell (no calibration sample mapped here): fall back to the pooled per-signal
    // baseline (ADR-0006) rather than passing the raw value through — a raw level (e.g. ~10ms
    // latency) treated as a residual would manufacture a false detection. Pooled standardization
    // is the same fallback under-sampled cells use; gap reporting remains future work.
    const cell = cells.get(cellKey(t, tc)) ?? pooled;
    return v.map((x, i) => (x - cell.mean[i]) / cell.sd[i]);
  });
}

/** Pooled per-signal AR(1) φ̂ from the de-meaned calibration residuals (γ̂₁/γ̂₀ over all streams). */
function estimatePhi(raw: ReadonlyMap<PathClassId, SignalVector[]>, cells: ReadonlyMap<string, CellStats>, pooled: CellStats): number[] {
  const p = SIGNALS.length;
  const cov1 = new Array<number>(p).fill(0);
  const cov0 = new Array<number>(p).fill(0);
  for (const [pc, series] of raw) {
    const resid = deMean(series, pc, cells, pooled);
    for (let j = 0; j < p; j++) {
      const col = resid.map((row) => row[j]);
      cov1[j] += sampleAutocovariance(col, 0, 1);
      cov0[j] += sampleAutocovariance(col, 0, 0);
    }
  }
  return cov0.map((c0, j) => Math.max(-0.95, Math.min(0.95, c0 > 1e-12 ? cov1[j] / c0 : 0)));
}

export interface CalibrationOptions {
  /** below this per-cell sample count, fall back to the pooled baseline (ADR-0006). */
  minCellSamples?: number;
}

export function buildCalibration(raw: ReadonlyMap<PathClassId, SignalVector[]>, opts: CalibrationOptions = {}): CalibrationSubstrate {
  const minCellSamples = opts.minCellSamples ?? DEFAULT_MIN_CELL_SAMPLES;
  const { cells, pooled } = buildCells(raw, minCellSamples);
  return { cells, pooled, arPhi: estimatePhi(raw, cells, pooled) };
}

/** AR(1) pre-whiten each signal column, rescaling innovations back to unit variance. */
function prewhitenColumns(resid: number[][], arPhi: number[]): number[][] {
  const p = SIGNALS.length;
  const whitened: number[][] = resid.map((row) => [...row]);
  for (let j = 0; j < p; j++) {
    const phi = arPhi[j];
    const col = resid.map((row) => row[j]);
    const innov = prewhitenAr(col, 0, [phi]);
    const scale = Math.sqrt(Math.max(1 - phi * phi, 1e-9));
    for (let t = 0; t < whitened.length; t++) whitened[t][j] = innov[t] / scale;
  }
  return whitened;
}

/** Standardize a raw stream: per-cell de-mean/sd, then per-signal AR(1) pre-whitening → residuals. */
export function standardizeStream(series: readonly SignalVector[], pathClassId: PathClassId, sub: CalibrationSubstrate): number[][] {
  return prewhitenColumns(deMean(series, pathClassId, sub.cells, sub.pooled), sub.arPhi);
}

export function standardizeAll(raw: ReadonlyMap<PathClassId, SignalVector[]>, sub: CalibrationSubstrate): Map<PathClassId, number[][]> {
  const out = new Map<PathClassId, number[][]>();
  for (const [pc, series] of raw) out.set(pc, standardizeStream(series, pc, sub));
  return out;
}
