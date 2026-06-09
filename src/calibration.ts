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
export type CalibrationSubstrate = ReadonlyMap<string, CellStats>;

interface Acc {
  n: number;
  sum: number[];
  sumsq: number[];
}

/** Build per-cell per-signal (mean, sd) from a clean calibration window. */
export function buildCalibration(raw: ReadonlyMap<PathClassId, SignalVector[]>): CalibrationSubstrate {
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
  const sub = new Map<string, CellStats>();
  for (const [key, a] of acc) {
    const mean = a.sum.map((s) => s / a.n);
    const sd = a.sum.map((_, i) => Math.sqrt(Math.max(a.sumsq[i] / a.n - mean[i] * mean[i], 1e-9)));
    sub.set(key, { n: a.n, mean, sd });
  }
  return sub;
}

/** Standardize one path-class's raw stream against its per-cell baseline → residuals. */
export function standardizeStream(series: readonly SignalVector[], pathClassId: PathClassId, sub: CalibrationSubstrate): number[][] {
  const tc = trafficClassOf(pathClassId);
  return series.map((v, t) => {
    const cell = sub.get(cellKey(t, tc));
    // Unseen cell: pass the raw vector through unchanged. v1 calibration windows span the same
    // tick range as the live window, so every live cell is calibrated and this branch is not
    // exercised; it is a defensive fallthrough, NOT a surfaced calibration-gap signal (emitting
    // a gap report is future work — see STATE.md limitations).
    if (!cell) return [...v];
    return v.map((x, i) => (x - cell.mean[i]) / cell.sd[i]);
  });
}

export function standardizeAll(raw: ReadonlyMap<PathClassId, SignalVector[]>, sub: CalibrationSubstrate): Map<PathClassId, number[][]> {
  const out = new Map<PathClassId, number[][]>();
  for (const [pc, series] of raw) out.set(pc, standardizeStream(series, pc, sub));
  return out;
}
