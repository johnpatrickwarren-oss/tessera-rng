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
const WEALTH_CAP = 1e12;

/** Peak |ACF| over each NON-overlapping window of a column (the spectral observation sequence). */
export function nonOverlappingPeaks(col: readonly number[], p: SpectralParams): number[] {
  const out: number[] = [];
  for (let t = p.window; t <= col.length; t += p.window) {
    out.push(peakACF(col.slice(t - p.window, t), p.minLag, p.maxLag).peak);
  }
  return out;
}

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

/**
 * Calibrate the per-signal Family D null from clean residuals: the (mean, std) of the peak |ACF|
 * over non-overlapping windows, pooled across all path-classes. Signals with too few windows (short
 * calibration relative to the window) or a degenerate spread are disabled (null entry) so the
 * detector stays silent rather than dividing by ~0.
 */
export function estimateFamilyDNull(
  residuals: ReadonlyMap<PathClassId, number[][]>,
  p: SpectralParams = DEFAULT_SPECTRAL,
): (FamilyDPerSignal | null)[] {
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
    return makeFamilyDCell(mean, std, p);
  });
}

/** Sequential spectral wealth for one signal column against its null cell, capped finite. */
function signalSpectralWealth(col: readonly number[], cell: FamilyDPerSignal, p: SpectralParams): number {
  const state = freshSpectralEDetectorState();
  for (const pk of nonOverlappingPeaks(col, p)) {
    evaluateSpectralEDetector({ params: cell, alpha: p.alphaD, signal: 'd' }, pk, state);
  }
  // a true oscillation can overflow M to Infinity over many windows → NaN on the next decay step;
  // cap to a finite ceiling so the family e-value (and the fleet surface) stay finite.
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
  cells: readonly (FamilyDPerSignal | null)[],
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
