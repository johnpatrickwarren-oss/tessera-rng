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
}
/**
 * The production-AR substrate (ADR-0004): per-cell level baselines (the diurnal/class smear) +
 * a per-signal AR(1) coefficient (the temporal autocorrelation). Standardization removes the
 * level with the cell baseline, then pre-whitens the temporal correlation with the AR model, so
 * detectors see near-iid residuals and FDR control holds under autocorrelated telemetry.
 */
export interface CalibrationSubstrate {
  cells: ReadonlyMap<string, CellStats>;
  /** per-signal AR(1) coefficient φ. */
  arPhi: number[];
}

interface Acc {
  n: number;
  sum: number[];
  sumsq: number[];
}

function buildCells(raw: ReadonlyMap<PathClassId, SignalVector[]>): Map<string, CellStats> {
  const p = SIGNALS.length;
  const acc = new Map<string, Acc>();
  for (const [pc, series] of raw) {
    const tc = trafficClassOf(pc);
    for (let t = 0; t < series.length; t++) {
      const key = cellKey(t, tc);
      let a = acc.get(key);
      if (!a) {
        a = { n: 0, sum: new Array<number>(p).fill(0), sumsq: new Array<number>(p).fill(0) };
        acc.set(key, a);
      }
      a.n += 1;
      const v = series[t];
      for (let i = 0; i < p; i++) {
        a.sum[i] += v[i];
        a.sumsq[i] += v[i] * v[i];
      }
    }
  }
  const cells = new Map<string, CellStats>();
  for (const [key, a] of acc) {
    const mean = a.sum.map((s) => s / a.n);
    const sd = a.sum.map((_, i) => Math.sqrt(Math.max(a.sumsq[i] / a.n - mean[i] * mean[i], 1e-9)));
    cells.set(key, { n: a.n, mean, sd });
  }
  return cells;
}

/** Per-cell de-mean/standardize only (no pre-whitening). */
function deMean(series: readonly SignalVector[], pathClassId: PathClassId, cells: ReadonlyMap<string, CellStats>): number[][] {
  const tc = trafficClassOf(pathClassId);
  return series.map((v, t) => {
    const cell = cells.get(cellKey(t, tc));
    // Unseen cell: pass through unchanged. v1 calibration windows span the same tick range as the
    // live window, so every live cell is calibrated and this branch is not exercised; it is a
    // defensive fallthrough, NOT a surfaced calibration-gap signal (gap reporting is future work).
    if (!cell) return [...v];
    return v.map((x, i) => (x - cell.mean[i]) / cell.sd[i]);
  });
}

/** Pooled per-signal AR(1) φ̂ from the de-meaned calibration residuals (γ̂₁/γ̂₀ over all streams). */
function estimatePhi(raw: ReadonlyMap<PathClassId, SignalVector[]>, cells: ReadonlyMap<string, CellStats>): number[] {
  const p = SIGNALS.length;
  const cov1 = new Array<number>(p).fill(0);
  const cov0 = new Array<number>(p).fill(0);
  for (const [pc, series] of raw) {
    const resid = deMean(series, pc, cells);
    for (let j = 0; j < p; j++) {
      const col = resid.map((row) => row[j]);
      cov1[j] += sampleAutocovariance(col, 0, 1);
      cov0[j] += sampleAutocovariance(col, 0, 0);
    }
  }
  return cov0.map((c0, j) => Math.max(-0.95, Math.min(0.95, c0 > 1e-12 ? cov1[j] / c0 : 0)));
}

export function buildCalibration(raw: ReadonlyMap<PathClassId, SignalVector[]>): CalibrationSubstrate {
  const cells = buildCells(raw);
  return { cells, arPhi: estimatePhi(raw, cells) };
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
  return prewhitenColumns(deMean(series, pathClassId, sub.cells), sub.arPhi);
}

export function standardizeAll(raw: ReadonlyMap<PathClassId, SignalVector[]>, sub: CalibrationSubstrate): Map<PathClassId, number[][]> {
  const out = new Map<PathClassId, number[][]>();
  for (const [pc, series] of raw) out.set(pc, standardizeStream(series, pc, sub));
  return out;
}
