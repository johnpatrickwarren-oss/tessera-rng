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
import { fitArP, prewhitenAr } from '@johnpatrickwarren-oss/deploysignal-engine/detectors/ar-p';
import { SIGNALS } from './signals';
import type { SignalVector } from './signals';
import type { PathClassId } from './domain';

export const TRAFFIC_CLASSES = ['interactive', 'bulk', 'storage'] as const;
export type TrafficClass = (typeof TRAFFIC_CLASSES)[number];
export const HOURS_PER_DAY = 24;
export const DAYS_PER_WEEK = 7;

/**
 * Order cap for per-signal AR(p) calibration (ADR-0008). The temporal substrate is no longer a
 * fixed AR(1): `fitArP` selects the order p ∈ [1, AR_PMAX] per signal by **BIC**, so a signal with
 * AR(2)/AR(3) memory is whitened at its true order while a near-white signal selects a low order
 * with φ̂ ≈ 0 (≈ no whitening; fitArP returns p ≥ 1, not 0). BIC (not AIC) because the estimate is
 * pooled over a very long concatenated stream (N ≈ 10⁴–10⁵): AIC's fixed +2p penalty is not
 * order-consistent at that N and over-selects spurious high orders (verified: AIC picked [4,1,1,1,3]
 * on default AR(1) telemetry, the extra coefficients ≈ 0); BIC's log(N)·p penalty stays parsimonious
 * (the engine's underfit caveat is for N ≈ 600, far below ours). Capped at 6 as a backstop.
 */
export const DEFAULT_AR_PMAX = 6;

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
/** A per-signal AR(p) model: φ̂ coefficients (length = selected order p) + innovation sd (ADR-0008). */
export interface ArModel {
  /** AR coefficients φ̂₁..φ̂_p (empty ⇒ AR(0), white residual, no pre-whitening). */
  phi: number[];
  /** sd of the AR(p) innovation; pre-whitened residuals are divided by it to restore unit variance. */
  innovationSd: number;
}

/**
 * The production-AR substrate (ADR-0004/0008): per-cell level baselines (the diurnal/class smear) +
 * a per-signal AR(**p**) model (the temporal autocorrelation, order selected by AIC).
 * Standardization removes the level with the cell baseline, then pre-whitens the temporal
 * correlation with the AR(p) model, so detectors see near-iid residuals and FDR control holds under
 * autocorrelated telemetry — now including higher-order (AR(2)/AR(3)/…) memory, not just AR(1).
 */
export interface CalibrationSubstrate {
  cells: ReadonlyMap<string, CellStats>;
  /**
   * Pooled per-signal (mean, sd) over ALL calibration samples — the fallback baseline for
   * under-sampled cells (n < minCellSamples) and for cells unseen at calibration time (ADR-0006).
   */
  pooled: CellStats;
  /** per-signal AR(p) model (ADR-0008). */
  ar: ArModel[];
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

/**
 * Per-signal AR(p) model from the de-meaned calibration residuals (ADR-0008). Each signal's
 * residual columns are concatenated across all path-class streams into one long series and fitted
 * with the engine's `fitArP` (BIC order selection). The concatenation pools the temporal estimate
 * across path-classes (φ is a property of the signal type, like the AR(1) substrate before it); the
 * few cross-stream boundaries contribute mean-zero noise that perturbs only the high-lag tail (the
 * coefficients are recovered cleanly — verified — and BIC resists ordering up to chase that noise).
 */
function estimateAr(
  raw: ReadonlyMap<PathClassId, SignalVector[]>,
  cells: ReadonlyMap<string, CellStats>,
  pooled: CellStats,
  pMax: number,
): ArModel[] {
  const p = SIGNALS.length;
  const cols: number[][] = SIGNALS.map(() => []);
  for (const [pc, series] of raw) {
    const resid = deMean(series, pc, cells, pooled);
    for (const row of resid) for (let j = 0; j < p; j++) cols[j].push(row[j]);
  }
  return cols.map((col) => {
    const fit = fitArP(col, 0, { p_max: pMax, ic: 'bic' });
    return { phi: fit.phi, innovationSd: Math.sqrt(Math.max(fit.sigma2_innovation, 1e-9)) };
  });
}

export interface CalibrationOptions {
  /** below this per-cell sample count, fall back to the pooled baseline (ADR-0006). */
  minCellSamples?: number;
  /** AR(p) order cap for the temporal substrate (ADR-0008). */
  arPMax?: number;
}

export function buildCalibration(raw: ReadonlyMap<PathClassId, SignalVector[]>, opts: CalibrationOptions = {}): CalibrationSubstrate {
  const minCellSamples = opts.minCellSamples ?? DEFAULT_MIN_CELL_SAMPLES;
  const pMax = opts.arPMax ?? DEFAULT_AR_PMAX;
  const { cells, pooled } = buildCells(raw, minCellSamples);
  return { cells, pooled, ar: estimateAr(raw, cells, pooled, pMax) };
}

/** AR(p) pre-whiten each signal column, rescaling innovations back to unit variance. */
function prewhitenColumns(resid: number[][], ar: readonly ArModel[]): number[][] {
  const whitened: number[][] = resid.map((row) => [...row]);
  for (let j = 0; j < ar.length; j++) {
    const col = resid.map((row) => row[j]);
    const innov = prewhitenAr(col, 0, ar[j].phi); // identity when phi is empty (AR(0))
    const scale = ar[j].innovationSd;
    for (let t = 0; t < whitened.length; t++) whitened[t][j] = innov[t] / scale;
  }
  return whitened;
}

/** Standardize a raw stream: per-cell de-mean/sd, then per-signal AR(p) pre-whitening → residuals. */
export function standardizeStream(series: readonly SignalVector[], pathClassId: PathClassId, sub: CalibrationSubstrate): number[][] {
  return prewhitenColumns(deMean(series, pathClassId, sub.cells, sub.pooled), sub.ar);
}

/** Per-signal lag buffers for incremental standardization (ADR-0027). */
export interface StreamStandardizer {
  lags: number[][];
}

export function freshStreamStandardizer(sub: CalibrationSubstrate): StreamStandardizer {
  return { lags: sub.ar.map(() => []) };
}

/**
 * One tick of incremental standardization (ADR-0027) — replicates `standardizeStream` exactly:
 * per-cell de-mean, then the engine filter's probed convention
 * `innov_t = d_t − Σ_{k ≤ min(t, p)} φ_k·d_{t−k}`, divided by the innovation sd. The byte-equality
 * session test is the guard that this stays in lockstep with the batch path.
 */
export function standardizeTick(vec: SignalVector, tick: number, pathClassId: PathClassId, sub: CalibrationSubstrate, st: StreamStandardizer): number[] {
  const tc = trafficClassOf(pathClassId);
  const cell = sub.cells.get(cellKey(tick, tc)) ?? sub.pooled;
  return vec.map((x, i) => {
    const d = (x - cell.mean[i]) / cell.sd[i];
    const { phi, innovationSd } = sub.ar[i];
    const lags = st.lags[i];
    let innov = d;
    for (let k = 1; k <= Math.min(phi.length, lags.length); k++) innov -= phi[k - 1] * lags[lags.length - k];
    lags.push(d);
    if (lags.length > phi.length) lags.shift();
    return innov / innovationSd;
  });
}

export function standardizeAll(raw: ReadonlyMap<PathClassId, SignalVector[]>, sub: CalibrationSubstrate): Map<PathClassId, number[][]> {
  const out = new Map<PathClassId, number[][]>();
  for (const [pc, series] of raw) out.set(pc, standardizeStream(series, pc, sub));
  return out;
}
