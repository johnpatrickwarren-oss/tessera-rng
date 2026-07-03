/**
 * Filtration-boundary + Family-D-null evidence tests (ADR-0044 / ADR-0045) — pin the FACTS behind
 * the combiner analysis and the null-validity fix, so the ADRs' claims are observed, not asserted:
 *
 *   (1) Family D's spectral wealth is NOT a supermartingale in the TICK filtration (under BOTH
 *       nulls): conditioned on the first 39 ticks of a 40-tick window (a strongly periodic
 *       prefix — an event with positive density under the null), the expected wealth multiple
 *       over the final tick exceeds 1. The e-detector is a supermartingale in the WINDOW
 *       filtration (conditioning only on completed windows), a strictly coarser statement.
 *       This is the ADR-0044 boundary: per-family fire rules keep their own Ville bounds, and
 *       fixed-time combined queries are valid, but the mean-across-families leaf e-value is not
 *       itself an anytime e-process in tick time (sup-crossing degrades to the K/c union bound).
 *   (2) PINNED DEFECT (ADR-0045): the raw Gaussian-null path is not even a valid e-value at
 *       fixed time against the true peak-|ACF| null — E[wealth] ≈ 1.12 per clean window.
 *   (2b) FIX: the PIT (rank-Gaussianized) null restores E[wealth] ≤ ≈1 on held-out clean data.
 *   (3) Between window boundaries the wealth is CONSTANT (a 39-tick feed leaves wealth exactly
 *       1) — the reason Family D's own Ville bound transfers from window time to tick time.
 *
 * Anti-self-confirming note: thresholds were pinned from an observed run (recorded in the ADRs),
 * with margins wide enough to be seed-robust but tight enough that removing the conditional
 * inflation fails (1), a "fixed" raw path fails (2)'s lower bound, and a PIT path that silently
 * reverts to the raw null fails (2b)'s upper bound.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/rng';
import {
  DEFAULT_SPECTRAL,
  makeFamilyDCell,
  nonOverlappingPeaks,
  freshSpectralStream,
  feedSpectralWindow,
  readSpectralWealth,
} from '../src/family-d';

const P = DEFAULT_SPECTRAL; // window 40, lags 3..10, alphaD 0.01, deltaSigma 1.0
const W = P.window;

/** Calibrate the peak-|ACF| null from a long clean stream — the same estimator production uses. */
function calibrateNull(seed: number, nWindows: number): { mean: number; std: number } {
  const rng = makeRng(seed);
  const col: number[] = [];
  for (let i = 0; i < nWindows * W; i++) col.push(rng.gaussian());
  const peaks = nonOverlappingPeaks(col, P);
  const mean = peaks.reduce((s, x) => s + x, 0) / peaks.length;
  const std = Math.sqrt(peaks.reduce((s, x) => s + (x - mean) ** 2, 0) / peaks.length);
  return { mean, std };
}

/** Wealth multiple from feeding ONE completed 40-tick window to a fresh spectral stream. */
function oneWindowWealth(col: readonly number[], cell: ReturnType<typeof makeFamilyDCell>): number {
  const state = freshSpectralStream();
  feedSpectralWindow(state, col, cell, P);
  return readSpectralWealth(state);
}

/** The strongly periodic 39-tick prefix: period-7, amplitude 2 (residual scale, null sd ≈ 1). */
function periodicPrefix(): number[] {
  const prefix: number[] = [];
  for (let t = 0; t < W - 1; t++) prefix.push(2 * Math.sin((2 * Math.PI * t) / 7));
  return prefix;
}

test('(1) conditional on 39 periodic ticks, the expected one-window wealth multiple EXCEEDS 1 — Family D is not a tick-filtration supermartingale (raw AND PIT nulls)', () => {
  const rng0 = makeRng(7);
  const calCol: number[] = [];
  for (let i = 0; i < 5000 * W; i++) calCol.push(rng0.gaussian());
  const calPeaks = nonOverlappingPeaks(calCol, P);
  const mean = calPeaks.reduce((s, x) => s + x, 0) / calPeaks.length;
  const std = Math.sqrt(calPeaks.reduce((s, x) => s + (x - mean) ** 2, 0) / calPeaks.length);
  const raw = makeFamilyDCell(mean, std, P);
  const pit = { ...raw, pit_sorted_peaks: [...calPeaks].sort((a, b) => a - b) };
  const prefix = periodicPrefix();
  const rng = makeRng(1234);
  const N = 4000;
  let sumRaw = 0;
  let sumPit = 0;
  for (let i = 0; i < N; i++) {
    const col = [...prefix, rng.gaussian()];
    sumRaw += oneWindowWealth(col, raw);
    sumPit += oneWindowWealth(col, pit);
  }
  // Supermartingale in the tick filtration would force these ≤ 1 (wealth was 1 at tick 39).
  // The PIT null (ADR-0045) fixes the MARGINAL validity, not the filtration granularity — the
  // conditional inflation is structural to window-level betting read at tick time (ADR-0044).
  assert.ok(sumRaw / N > 1.1, `raw E[wealth | periodic prefix] = ${sumRaw / N} — expected > 1.1`);
  assert.ok(sumPit / N > 1.1, `PIT E[wealth | periodic prefix] = ${sumPit / N} — expected > 1.1`);
});

test('(2) PINNED DEFECT (ADR-0045): the raw Gaussian-null path over-pays on clean data — E[wealth] ≈ 1.12 per window, NOT ≤ 1', () => {
  // The engine bet L = exp(r·u − r²/2) has E[L] = 1 only for u ~ N(0,1); the peak-|ACF| statistic
  // is right-skewed (measured skew ≈ 0.46), so the raw path's E[L] ≈ 1.12 (held-out, ±0.017) and
  // its anytime false-alarm rate runs ≈1.3% vs the claimed ≤1%. Pinned as the recorded defect the
  // PIT null fixes; the band is wide enough to be seed-robust, and a "fixed" raw path (E[L] ≤ 1.05)
  // would FAIL this pin — forcing whoever changes it to reconcile with ADR-0045 on the record.
  const { mean, std } = calibrateNull(7, 5000);
  const cell = makeFamilyDCell(mean, std, P); // NO pit_sorted_peaks — the raw control path
  const rng = makeRng(4321);
  const N = 4000;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const col: number[] = [];
    for (let t = 0; t < W; t++) col.push(rng.gaussian());
    sum += oneWindowWealth(col, cell);
  }
  const uncondMean = sum / N;
  assert.ok(uncondMean > 1.05 && uncondMean < 1.25, `raw-path unconditional E[wealth] = ${uncondMean} — pinned defect band (1.05, 1.25), see ADR-0045`);
});

test('(2b) FIX (ADR-0045): the PIT null restores fixed-time validity — held-out unconditional E[wealth] ≤ ≈1', () => {
  const rng0 = makeRng(7);
  const calCol: number[] = [];
  for (let i = 0; i < 5000 * W; i++) calCol.push(rng0.gaussian());
  const calPeaks = nonOverlappingPeaks(calCol, P);
  const mean = calPeaks.reduce((s, x) => s + x, 0) / calPeaks.length;
  const std = Math.sqrt(calPeaks.reduce((s, x) => s + (x - mean) ** 2, 0) / calPeaks.length);
  const cell = { ...makeFamilyDCell(mean, std, P), pit_sorted_peaks: [...calPeaks].sort((a, b) => a - b) };
  const rng = makeRng(4321);
  const N = 4000;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const col: number[] = [];
    for (let t = 0; t < W; t++) col.push(rng.gaussian());
    sum += oneWindowWealth(col, cell);
  }
  const uncondMean = sum / N;
  // exchangeability gives E[L] ≤ 1 exactly; the 1.05 headroom is Monte-Carlo error only.
  assert.ok(uncondMean < 1.05, `PIT unconditional E[wealth] = ${uncondMean} — expected < 1.05 (valid e-value per window)`);
});

test('(3) between window boundaries the wealth is constant: a 39-tick feed leaves wealth exactly 1', () => {
  const { mean, std } = calibrateNull(7, 5000);
  const cell = makeFamilyDCell(mean, std, P);
  const state = freshSpectralStream();
  feedSpectralWindow(state, periodicPrefix(), cell, P); // 39 ticks — no completed window
  assert.equal(readSpectralWealth(state), 1);
});
