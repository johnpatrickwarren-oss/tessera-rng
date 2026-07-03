/**
 * Family D (spectral) detector wrapper (ADR-0009) — a THIRD anomaly mode beyond A and C.
 *
 * Family A catches a mean shift; Family C catches a covariance/magnitude shift. Family D catches
 * temporal PERIODICITY: a signal that develops an oscillation (a spectral peak in its
 * autocorrelation) with NO change in marginal mean or variance — invisible to A (zero-mean
 * oscillation) and to C (per-tick magnitude unchanged), but a clear peak in the windowed ACF.
 *
 * It reuses the engine's mixture-prior spectral e-detector (`evaluateSpectralEDetector`) over the
 * peak |ACF| of NON-overlapping windows of each signal's pre-whitened residual stream. Non-
 * overlapping is load-bearing: overlapping windows produce autocorrelated peak observations that
 * break the e-process's supermartingale validity and inflate the null wealth (verified). The null
 * (μ₀, σ₀) of the peak |ACF| is calibrated from the clean residuals; live peaks above it accrue
 * wealth. Per-signal wealths are averaged into the family e-value (valid under dependence, as in
 * Family A). No detector math here — only the windowing, null calibration, and combination.
 */
import {
  peakACF,
  freshSpectralEDetectorState,
  evaluateSpectralEDetector,
} from '@johnpatrickwarren-oss/deploysignal-engine/detectors/spectral';
import type { FamilyDPerSignal } from '@johnpatrickwarren-oss/deploysignal-engine/types/families/d';
import { SIGNALS } from './signals';
import type { PathClassId } from './domain';

export interface SpectralParams {
  /** non-overlapping window length over which each peak |ACF| is computed. */
  window: number;
  /** ACF lag range searched for the spectral peak (oscillation periods). */
  minLag: number;
  maxLag: number;
  /** per-detector α for the spectral e-process. */
  alphaD: number;
  /** mixture shift-prior magnitude as a multiple of σ₀ (engine default 0.3; we use 1.0). */
  deltaSigma: number;
}

export const DEFAULT_SPECTRAL: SpectralParams = { window: 40, minLag: 3, maxLag: 10, alphaD: 0.01, deltaSigma: 1.0 };

/** A signal needs at least this many calibration peak observations before Family D trusts its null. */
export const MIN_NULL_PEAKS = 8;

/**
 * A signal whose calibration peak |ACF| has std below this is DISABLED (ADR-0009). A genuinely white
 * residual has peak-|ACF| std ≈ 0.07 (the max over the lag band fluctuates); a near-constant
 * calibration (degenerate σ₀) would make the standardized peak u = (peak−μ₀)/σ₀ — and thus the
 * wealth — explode on any ordinary live peak, manufacturing false fires. Disabling is safer than
 * trusting a σ₀ that under-estimates the live fluctuation scale.
 */
export const MIN_NULL_STD = 0.02;

/** Finite ceiling on a signal's spectral wealth — a true oscillation can overflow to Infinity over
 *  many windows; capping keeps the family e-value finite (still far above any fire threshold) so a
 *  non-finite value can never poison the fleet surface. */
export const WEALTH_CAP = 1e12;

/** Peak |ACF| over each NON-overlapping window of a column (the spectral observation sequence). */
export function nonOverlappingPeaks(col: readonly number[], p: SpectralParams): number[] {
  const out: number[] = [];
  for (let t = p.window; t <= col.length; t += p.window) {
    out.push(peakACF(col.slice(t - p.window, t), p.minLag, p.maxLag).peak);
  }
  return out;
}

/**
 * A Tessera Family D cell: the engine's per-signal params, optionally carrying the SORTED
 * calibration peaks for the PIT-Gaussianized null (ADR-0045). The engine's e-detector bet
 * `L = exp(r·u − r²/2)` has E[L] = 1 ONLY if u = (peak−μ₀)/σ₀ is exactly N(0,1) under the null —
 * but peak|ACF| (a max of 8 |correlations|) is right-skewed (measured skew ≈ 0.46), so the raw
 * Gaussian null over-pays: E[L] ≈ 1.12 per clean window, and the anytime false-alarm rate runs
 * ≈1.3% against the claimed ≤1% (measured, ADR-0045). When `pit_sorted_peaks` is present the
 * update path rank-transforms the live peak against the calibration empirical CDF —
 * u = Φ⁻¹(rank/(n+1)) — which is an e-value by EXCHANGEABILITY, no distributional assumption:
 * E[L] ≤ 1 exactly for a live window exchangeable with the calibration windows.
 */
export type FamilyDCell = FamilyDPerSignal & {
  /** ascending calibration peaks for the PIT null (ADR-0045); absent ⇒ raw Gaussian null (the
   *  recorded-defect CONTROL path, kept for unit fixtures and as the failure-mode reference). */
  pit_sorted_peaks?: readonly number[];
};

/** A Family D cell for a signal whose clean peak |ACF| has the given null (μ₀, σ₀). */
export function makeFamilyDCell(nullMean: number, nullStd: number, p: SpectralParams): FamilyDPerSignal {
  return {
    bootstrap_null_quantile: 0, // unused on the e_detector path
    min_peak_lag: p.minLag,
    max_peak_lag: p.maxLag,
    spectral_variant: 'e_detector',
    null_mean: nullMean,
    null_std: nullStd,
    betting_delta: p.deltaSigma * nullStd,
  };
}

/** Acklam's inverse-normal-CDF approximation (|rel err| < 1.2e-9) — pure math helper for the PIT. */
function invNorm(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const rr = q * q;
  return ((((((a[0] * rr + a[1]) * rr + a[2]) * rr + a[3]) * rr + a[4]) * rr + a[5]) * q) / (((((b[0] * rr + b[1]) * rr + b[2]) * rr + b[3]) * rr + b[4]) * rr + 1);
}

/**
 * PIT-Gaussianize a live peak against the sorted calibration peaks (ADR-0045):
 * u = Φ⁻¹(count(cal ≤ peak) / (n+1)), clamped to [1/(n+1), n/(n+1)]. Under exchangeability the
 * rank is uniform on its n+1 values and E[exp(r·u − r²/2)] ≤ 1 (the missing right-tail cell makes
 * it strictly conservative) — validity from ranks, not from a Gaussian fit the statistic violates.
 * The clamp also caps single-window evidence at Φ⁻¹(n/(n+1)): a thin calibration sample honestly
 * limits how much one window can prove (recorded power narrowing, ADR-0045).
 */
export function pitGaussianize(peak: number, sorted: readonly number[]): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= peak) lo = mid + 1;
    else hi = mid;
  }
  const q = Math.max(lo, 1) / (sorted.length + 1);
  return invNorm(q);
}

/**
 * Calibrate the per-signal Family D null from clean residuals: the (mean, std) of the peak |ACF|
 * over non-overlapping windows, pooled across all path-classes. Signals with too few windows (short
 * calibration relative to the window) or a degenerate spread are disabled (null entry) so the
 * detector stays silent rather than dividing by ~0.
 */
export function estimateFamilyDNull(
  residuals: ReadonlyMap<PathClassId, number[][]>,
  p: SpectralParams = DEFAULT_SPECTRAL,
): (FamilyDCell | null)[] {
  const peaksBySignal: number[][] = SIGNALS.map(() => []);
  for (const series of residuals.values()) {
    for (let j = 0; j < SIGNALS.length; j++) {
      const col = series.map((row) => row[j]);
      for (const pk of nonOverlappingPeaks(col, p)) peaksBySignal[j].push(pk);
    }
  }
  return peaksBySignal.map((peaks) => {
    if (peaks.length < MIN_NULL_PEAKS) return null;
    const mean = peaks.reduce((s, x) => s + x, 0) / peaks.length;
    const std = Math.sqrt(peaks.reduce((s, x) => s + (x - mean) ** 2, 0) / peaks.length);
    if (std < MIN_NULL_STD) return null; // degenerate null → would explode on live peaks; disable
    // PIT null (ADR-0045): the production calibrator ships the sorted calibration peaks so the
    // update path bets on the rank-Gaussianized statistic (valid by exchangeability) instead of
    // trusting a Gaussian fit the right-skewed peak|ACF| measurably violates. (μ₀, σ₀) are kept
    // for the degenerate-null gate above and as the raw-path fixture surface.
    return { ...makeFamilyDCell(mean, std, p), pit_sorted_peaks: [...peaks].sort((a, b) => a - b) };
  });
}

/**
 * One e-detector update for one window peak (ADR-0045): with a PIT cell, bet on the
 * rank-Gaussianized u against an exact (0, 1) null with betting_delta = deltaSigma (r unchanged);
 * without one, the raw Gaussian-null path — byte-identical to the pre-ADR-0045 behavior, kept as
 * the recorded-defect control. ONE code path for batch and streaming (ADR-0027 byte-equality).
 */
function updateWithPeak(state: { M: number }, pk: number, cell: FamilyDCell, p: SpectralParams): void {
  if (cell.pit_sorted_peaks) {
    const params = { ...cell, null_mean: 0, null_std: 1, betting_delta: p.deltaSigma };
    evaluateSpectralEDetector({ params, alpha: p.alphaD, signal: 'd' }, pitGaussianize(pk, cell.pit_sorted_peaks), state as ReturnType<typeof freshSpectralEDetectorState>);
  } else {
    evaluateSpectralEDetector({ params: cell, alpha: p.alphaD, signal: 'd' }, pk, state as ReturnType<typeof freshSpectralEDetectorState>);
  }
}

/** Sequential spectral wealth for one signal column against its null cell, capped finite. */
function signalSpectralWealth(col: readonly number[], cell: FamilyDCell, p: SpectralParams): number {
  const state = freshSpectralEDetectorState();
  for (const pk of nonOverlappingPeaks(col, p)) {
    updateWithPeak(state, pk, cell, p);
  }
  // a true oscillation can overflow M to Infinity over many windows → NaN on the next decay step;
  // the cap convention is one code path with the streaming reader (ADR-0027).
  return readSpectralWealth(state);
}

/** Streaming face of the per-signal spectral detector (ADR-0027): feed completed non-overlapping
 *  windows as they fill; read the capped wealth anytime. Chunking matches `nonOverlappingPeaks`. */
export function freshSpectralStream(): ReturnType<typeof freshSpectralEDetectorState> {
  return freshSpectralEDetectorState();
}

export function feedSpectralWindow(state: ReturnType<typeof freshSpectralEDetectorState>, window: readonly number[], cell: FamilyDCell, p: SpectralParams): void {
  for (const pk of nonOverlappingPeaks(window, p)) {
    updateWithPeak(state, pk, cell, p);
  }
}

export function readSpectralWealth(state: { M: number }): number {
  return Number.isFinite(state.M) ? Math.min(state.M, WEALTH_CAP) : WEALTH_CAP;
}

export interface FamilyDResult {
  e_value: number;
  fired: boolean;
  alpha_spent: number;
}

/**
 * Run Family D over a path-class's residual stream. Per-signal spectral wealths (for the calibrated
 * signals only) are averaged into the family e-value — averaging e-values is valid under dependence.
 * With no calibrated signal the family is a silent no-op (e_value 1).
 */
export function runFamilyD(
  series: readonly (readonly number[])[],
  cells: readonly (FamilyDCell | null)[],
  p: SpectralParams = DEFAULT_SPECTRAL,
): FamilyDResult {
  const wealths: number[] = [];
  for (let j = 0; j < cells.length; j++) {
    const cell = cells[j];
    if (!cell) continue;
    wealths.push(signalSpectralWealth(series.map((row) => row[j]), cell, p));
  }
  if (wealths.length === 0) return { e_value: 1, fired: false, alpha_spent: 0 };
  const e = wealths.reduce((s, x) => s + x, 0) / wealths.length;
  const fired = e >= 1 / p.alphaD;
  return { e_value: e, fired, alpha_spent: fired ? p.alphaD : 0 };
}
