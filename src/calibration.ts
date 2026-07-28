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
import { robustLocation } from '@johnpatrickwarren-oss/deploysignal-engine/fleet/common-mode';
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

/** Robust-mode min-cell-samples (telemetry-realism): MAD is ~37% less efficient than the sample sd,
 *  so a robust per-cell scale needs more samples for the same accuracy — below this a cell borrows the
 *  (stable, large-n) robust pooled baseline. 50 keeps clean-fabric FDR at 0 even at thin windows. */
export const ROBUST_MIN_CELL_SAMPLES = 50;

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
  /**
   * SHRUNK per-leaf scale corrections (ADR-0052, `perLeafScale` opt-in): residuals are divided by
   * `leafScale.get(pc) ?? 1` after pre-whitening, in BOTH the batch and incremental paths (the
   * substrate carries the map — session parity by construction). Scalar per leaf (the σ_pc model),
   * median-centered, shrunk by λ = ς̂²/raw² so a clean fleet gets ≈ no correction (the ADR-0006
   * noise-injection trap, avoided structurally). Absent ⇒ no division ⇒ byte-identical pre-ADR
   * standardization.
   */
  leafScale?: ReadonlyMap<PathClassId, number>;
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

/** Median of a column (0 for an empty sample). */
function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * Robust per-signal (center, scale) from the cell's samples — the contamination-robust null
 * estimator (telemetry-realism finding: real history is full of clustered aberrations a mean/sd
 * estimator ABSORBS, corrupting the null). Center = the engine's `robustLocation` (Tukey biweight,
 * 95%-efficient at the Gaussian, redescending — CONSUMED, not rebuilt); scale = MAD×1.4826 about the
 * median. On clean Gaussian samples these ≈ (mean, sd), so a clean null is ~unchanged; on contaminated
 * samples they reject the bursts instead of inflating to them.
 */
function robustStatsOf(samples: readonly number[][]): { mean: number[]; sd: number[] } {
  const p = SIGNALS.length;
  const mean = new Array<number>(p);
  const sd = new Array<number>(p);
  for (let i = 0; i < p; i++) {
    const col = samples.map((s) => s[i]);
    const med = median(col);
    mean[i] = robustLocation(col);
    // floor the SCALE at √1e-9 ≈ 3.16e-5 to match the mean/sd path (which floors the VARIANCE at 1e-9),
    // so a degenerate cell (MAD=0) standardizes identically in both paths — no robust-only FP blowup.
    sd[i] = Math.max(1.4826 * median(col.map((x) => Math.abs(x - med))), Math.sqrt(1e-9));
  }
  return { mean, sd };
}

/**
 * Build per-cell baselines AND the pooled per-signal baseline in one pass. Cells with fewer
 * than `minCellSamples` observations fall back to the pooled (mean, sd) — their own sd is too
 * noisy to trust (ADR-0006). The pooled stats are returned too, for cells unseen at calibration.
 */
/** Robust per-cell baselines (telemetry-realism): collect each cell's samples and finalize with the
 *  contamination-robust `robustStatsOf` (median/MAD/Tukey) instead of mean/sd, so clustered
 *  aberrations in the calibration history are TOSSED, not absorbed into the null. Same fallback rule
 *  (under-sampled cells borrow the robust pooled baseline). */
function buildCellsRobust(
  raw: ReadonlyMap<PathClassId, SignalVector[]>,
  minCellSamples: number,
): { cells: Map<string, CellStats>; pooled: CellStats } {
  const p = SIGNALS.length;
  const acc = new Map<string, number[][]>();
  const pool: number[][] = [];
  for (const [pc, series] of raw) {
    const tc = trafficClassOf(pc);
    for (let t = 0; t < series.length; t++) {
      const key = cellKey(t, tc);
      let s = acc.get(key);
      if (!s) { s = []; acc.set(key, s); }
      const v = [...series[t]];
      s.push(v);
      pool.push(v);
    }
  }
  const pooledStats = pool.length > 0 ? robustStatsOf(pool) : { mean: new Array<number>(p).fill(0), sd: new Array<number>(p).fill(1) };
  const pooled: CellStats = { n: pool.length, ...pooledStats, pooled: true };
  const cells = new Map<string, CellStats>();
  for (const [key, s] of acc) {
    if (s.length < minCellSamples) cells.set(key, { n: s.length, mean: pooled.mean, sd: pooled.sd, pooled: true });
    else cells.set(key, { n: s.length, ...robustStatsOf(s) });
  }
  return { cells, pooled };
}

function buildCells(
  raw: ReadonlyMap<PathClassId, SignalVector[]>,
  minCellSamples: number,
  robust = false,
): { cells: Map<string, CellStats>; pooled: CellStats } {
  if (robust) return buildCellsRobust(raw, minCellSamples);
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
  /**
   * Contamination-robust per-cell baselines (telemetry-realism): estimate each cell's (center, scale)
   * with `robustLocation`/MAD instead of mean/sd, so the clustered aberrations that always occur in
   * real history are TOSSED, not absorbed into the null. On clean Gaussian history ≈ mean/sd.
   */
  robust?: boolean;
  /**
   * SHRUNK per-leaf scale correction (ADR-0052), default OFF. Adds a second calibration pass: per
   * leaf, the pooled log-scale of its standardized calibration residuals, shrunk toward the fleet
   * median by λ = ς̂²/raw² (the ADR-0051 decomposition) and stored as `substrate.leafScale`. A
   * clean fleet (raw ≈ sampling floor) gets λ ≈ 0 ⇒ scales ≈ 1 ⇒ nothing injected — the ADR-0006
   * lesson enforced by construction, not by a sample-count knob.
   */
  perLeafScale?: boolean;
}

export function buildCalibration(raw: ReadonlyMap<PathClassId, SignalVector[]>, opts: CalibrationOptions = {}): CalibrationSubstrate {
  const minCellSamples = opts.minCellSamples ?? (opts.robust ? ROBUST_MIN_CELL_SAMPLES : DEFAULT_MIN_CELL_SAMPLES);
  const pMax = opts.arPMax ?? DEFAULT_AR_PMAX;
  const { cells, pooled } = buildCells(raw, minCellSamples, opts.robust ?? false);
  const base: CalibrationSubstrate = { cells, pooled, ar: estimateAr(raw, cells, pooled, pMax) };
  if (!opts.perLeafScale) return base;
  return { ...base, leafScale: shrunkLeafScales(raw, base) };
}

/**
 * The ADR-0052 second pass: per-leaf pooled log-scale ℓ_i of the standardized calibration
 * residuals (the ADR-0051 estimator's statistic), shrunk toward the fleet median by
 * λ = max(0, raw² − floor)/raw² with raw = MAD-sd of {ℓ_i} and floor = 1/(2(T−1)p). Division by
 * `exp(λ·(ℓ_i − median))` then removes the ESTIMATED-real part of each leaf's scale deviation
 * while leaving the sampling-noise part (which division could only re-inject) untouched.
 */
function shrunkLeafScales(raw: ReadonlyMap<PathClassId, SignalVector[]>, sub: CalibrationSubstrate): Map<PathClassId, number> {
  const logScales = new Map<PathClassId, number>();
  let ticks = 0;
  let signals = 0;
  for (const pc of [...raw.keys()].sort()) {
    const resid = standardizeStream(raw.get(pc)!, pc, sub); // sub has no leafScale yet — first-order residuals
    const T = resid.length;
    const p = resid[0]?.length ?? 0;
    if (T < 3 || p < 1) throw new RangeError(`perLeafScale: leaf ${pc} has a degenerate calibration series (${T}×${p})`);
    ticks = T;
    signals = p;
    let sumLog = 0;
    for (let j = 0; j < p; j++) {
      let s = 0;
      let sq = 0;
      for (let t = 0; t < T; t++) {
        s += resid[t][j];
        sq += resid[t][j] * resid[t][j];
      }
      const mean = s / T;
      sumLog += 0.5 * Math.log(Math.max(sq / T - mean * mean, 1e-12) * (T / (T - 1)));
    }
    logScales.set(pc, sumLog / p);
  }
  const ls = [...logScales.values()];
  const sorted = [...ls].sort((a, b) => a - b);
  const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const dev = ls.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
  const mad = dev.length % 2 ? dev[(dev.length - 1) / 2] : (dev[dev.length / 2 - 1] + dev[dev.length / 2]) / 2;
  const rawSd = 1.4826 * mad;
  const floorVar = 1 / (2 * (ticks - 1) * signals);
  const lambda = rawSd * rawSd > floorVar ? (rawSd * rawSd - floorVar) / (rawSd * rawSd) : 0;
  const out = new Map<PathClassId, number>();
  for (const [pc, l] of logScales) out.set(pc, Math.exp(lambda * (l - med)));
  return out;
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

/** Standardize a raw stream: per-cell de-mean/sd, per-signal AR(p) pre-whitening, then the
 *  ADR-0052 per-leaf scale division when the substrate carries it (absent ⇒ untouched). */
export function standardizeStream(series: readonly SignalVector[], pathClassId: PathClassId, sub: CalibrationSubstrate): number[][] {
  const whitened = prewhitenColumns(deMean(series, pathClassId, sub.cells, sub.pooled), sub.ar);
  const scale = sub.leafScale?.get(pathClassId);
  if (scale === undefined || scale === 1) return whitened;
  return whitened.map((row) => row.map((x) => x / scale));
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
  // ADR-0052: the same per-leaf division as `standardizeStream` — skipped identically when the
  // substrate carries no map (byte-identity) so incremental ≡ batch holds under the flag too.
  const leafScale = sub.leafScale?.get(pathClassId);
  return vec.map((x, i) => {
    const d = (x - cell.mean[i]) / cell.sd[i];
    const { phi, innovationSd } = sub.ar[i];
    const lags = st.lags[i];
    let innov = d;
    for (let k = 1; k <= Math.min(phi.length, lags.length); k++) innov -= phi[k - 1] * lags[lags.length - k];
    lags.push(d);
    if (lags.length > phi.length) lags.shift();
    const out = innov / innovationSd;
    return leafScale === undefined || leafScale === 1 ? out : out / leafScale;
  });
}

export function standardizeAll(raw: ReadonlyMap<PathClassId, SignalVector[]>, sub: CalibrationSubstrate): Map<PathClassId, number[][]> {
  const out = new Map<PathClassId, number[][]>();
  for (const [pc, series] of raw) out.set(pc, standardizeStream(series, pc, sub));
  return out;
}
