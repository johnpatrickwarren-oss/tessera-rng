import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/rng';
import {
  nonOverlappingPeaks,
  estimateFamilyDNull,
  makeFamilyDCell,
  pitGaussianize,
  runFamilyD,
  DEFAULT_SPECTRAL,
  MIN_NULL_PEAKS,
} from '../src/family-d';
import { generateFabric, DEFAULT_FABRIC } from '../src/fabric';
import { generateTelemetry } from '../src/telemetry';
import { buildCalibration, standardizeAll } from '../src/calibration';
import { detectAll, DEFAULT_DETECT } from '../src/detect';
import { buildSurface } from '../src/surface';
import { estimateBaselineCovariance, makeFamilyCCellFromCovariance } from '../src/family-c';
import { SIGNALS } from '../src/signals';

const P = DEFAULT_SPECTRAL;

/** A length-`n` series: white noise, optionally with a period-`period` oscillation (variance-preserving). */
function stream(n: number, amp: number, period: number, seed: number): number[] {
  const r = makeRng(seed);
  const w = Math.sqrt(Math.max(1 - (amp * amp) / 2, 0));
  return Array.from({ length: n }, (_, t) => amp * Math.sin((2 * Math.PI * t) / period) + w * r.gaussian());
}

/** Build a 5-signal residual map where signal 0 optionally oscillates (period 7). */
function residuals(nPc: number, ticks: number, amp: number, seed: number): Map<string, number[][]> {
  const m = new Map<string, number[][]>();
  for (let k = 0; k < nPc; k++) {
    const cols = SIGNALS.map((_, j) => stream(ticks, j === 0 ? amp : 0, 7, seed + k * 11 + j));
    m.set(`pc-${k}`, Array.from({ length: ticks }, (_, t) => cols.map((c) => c[t])));
  }
  return m;
}

test('nonOverlappingPeaks: a period-7 oscillation peaks far above white noise', () => {
  const white = nonOverlappingPeaks(stream(600, 0, 7, 1), P);
  const osc = nonOverlappingPeaks(stream(600, 0.9, 7, 1), P);
  const meanWhite = white.reduce((s, x) => s + x, 0) / white.length;
  const meanOsc = osc.reduce((s, x) => s + x, 0) / osc.length;
  assert.equal(white.length, Math.floor(600 / P.window), 'one peak per non-overlapping window');
  assert.ok(meanOsc > meanWhite + 0.1, `oscillation peak ${meanOsc} should dominate white ${meanWhite}`);
});

test('makeFamilyDCell wires the e_detector variant and betting_delta = deltaSigma·σ₀', () => {
  const cell = makeFamilyDCell(0.25, 0.08, P);
  assert.equal(cell.spectral_variant, 'e_detector');
  assert.equal(cell.null_mean, 0.25);
  assert.equal(cell.null_std, 0.08);
  assert.ok(Math.abs(cell.betting_delta! - P.deltaSigma * 0.08) < 1e-12);
});

test('estimateFamilyDNull calibrates a per-signal null and disables under-sampled signals', () => {
  const cells = estimateFamilyDNull(residuals(40, 600, 0, 7), P);
  assert.equal(cells.length, SIGNALS.length);
  for (const c of cells) {
    assert.ok(c, 'a well-sampled clean signal yields a null cell');
    assert.ok(c!.null_mean! > 0.1 && c!.null_mean! < 0.4, `null peak mean ${c!.null_mean} ~ white-noise ACF max`);
    assert.ok(c!.null_std! > 0, 'null std is positive');
  }
  // a calibration window shorter than one full spectral window cannot estimate the null → disabled.
  const tooShort = estimateFamilyDNull(residuals(40, P.window - 1, 0, 7), P);
  assert.ok(tooShort.every((c) => c === null), 'signals with < MIN_NULL_PEAKS windows are disabled');
  assert.ok(MIN_NULL_PEAKS >= 1);
});

test('estimateFamilyDNull ships the PIT null: sorted calibration peaks on every enabled cell (ADR-0045)', () => {
  const cells = estimateFamilyDNull(residuals(40, 600, 0, 7), P);
  for (const c of cells) {
    assert.ok(c, 'enabled cell expected');
    const peaks = c!.pit_sorted_peaks;
    assert.ok(peaks && peaks.length >= MIN_NULL_PEAKS, 'PIT cell carries the calibration peaks');
    for (let i = 1; i < peaks!.length; i++) assert.ok(peaks![i] >= peaks![i - 1], 'peaks are sorted ascending');
  }
  // DEMONSTRATE defect vs fix with the calibrator's own cell (signal 0): per-window betting
  // multiple L = exp(r·u − r²/2) on held-out clean windows. Raw u = (pk−μ₀)/σ₀ over-pays
  // (E[L] ≈ 1.12, the ADR-0045 defect); PIT u = Φ⁻¹(rank/(n+1)) restores E[L] ≤ ≈1. The mean-gap
  // is the marginal-validity fact itself; n is sized so the gap is far outside Monte-Carlo error.
  const cell = cells[0]!;
  const r = P.deltaSigma;
  const held = stream(12000 * P.window, 0, 7, 424242);
  const heldPeaks = nonOverlappingPeaks(held, P);
  let sumRaw = 0;
  let sumPit = 0;
  for (const pk of heldPeaks) {
    sumRaw += Math.exp(r * ((pk - cell.null_mean!) / cell.null_std!) - 0.5 * r * r);
    sumPit += Math.exp(r * pitGaussianize(pk, cell.pit_sorted_peaks!) - 0.5 * r * r);
  }
  const meanRaw = sumRaw / heldPeaks.length;
  const meanPit = sumPit / heldPeaks.length;
  assert.ok(meanRaw > 1.05, `raw per-window E[L] = ${meanRaw} — the pinned over-payment (ADR-0045)`);
  assert.ok(meanPit < 1.05, `PIT per-window E[L] = ${meanPit} — restored validity (ADR-0045)`);
});

test('runFamilyD: silent under the null, fires on a periodic oscillation (ADR-0009)', () => {
  const cells = estimateFamilyDNull(residuals(60, 600, 0, 7), P);
  const clean = residuals(1, 600, 0, 9999).get('pc-0')!; // independent of the calibration streams
  const oscill = residuals(1, 600, 0.9, 9999).get('pc-0')!;
  const dClean = runFamilyD(clean, cells, P);
  const dOsc = runFamilyD(oscill, cells, P);
  assert.ok(!dClean.fired, `clean spectral wealth ${dClean.e_value} should stay below 1/α`);
  assert.ok(dOsc.fired, `oscillating spectral wealth ${dOsc.e_value} should exceed 1/α`);
  assert.ok(dOsc.alpha_spent > 0 && dClean.alpha_spent === 0);
});

test('Family D stays finite on a degenerate null and disables it (no NaN poisons the surface)', () => {
  // a pathologically small σ₀ would blow up u=(peak−μ₀)/σ₀ and overflow the wealth to Inf→NaN;
  // the cap must keep the family e-value finite.
  const tinyStd = makeFamilyDCell(0.25, 1e-4, P);
  const cells = SIGNALS.map((_, j) => (j === 0 ? tinyStd : null));
  const r = runFamilyD(residuals(1, 600, 0.9, 5).get('pc-0')!, cells, P);
  assert.ok(Number.isFinite(r.e_value), `family e-value ${r.e_value} must be finite, never NaN/Infinity`);

  // a near-constant calibration (a pure noiseless sinusoid → peak |ACF| ≈ 1 every window → σ₀ ≈ 0)
  // is DISABLED, not trusted as a null.
  const degenerate = new Map<string, number[][]>();
  for (let k = 0; k < 40; k++) {
    const r2 = makeRng(700 + k);
    degenerate.set(`pc-${k}`, Array.from({ length: 600 }, (_, t) => SIGNALS.map((_, j) => (j === 0 ? Math.sin((2 * Math.PI * t) / 7) : r2.gaussian()))));
  }
  assert.equal(estimateFamilyDNull(degenerate, P)[0], null, 'a near-constant (degenerate σ₀) signal must be disabled');
});

test('runFamilyD with no calibrated signals is a silent no-op (e_value 1)', () => {
  const allDisabled = SIGNALS.map(() => null);
  const r = runFamilyD(residuals(1, 600, 0.9, 7).get('pc-0')!, allDisabled, P);
  assert.equal(r.e_value, 1);
  assert.equal(r.fired, false);
});

test('Family D catches a periodic oscillation that Family A and Family C are blind to (ADR-0009)', () => {
  const snap = generateFabric({ ...DEFAULT_FABRIC, n_path_classes: 200 });
  const target = snap.resources.find((r) => r.kind === 'passive_shuffler')!.id;
  const affected = new Set(snap.edges.filter((e) => e.resource === target).map((e) => e.path_class));
  const TICKS = 600;

  // calibrate on a clean window; build the learned Σ (Family C) and the Family D spectral nulls.
  const calRaw = generateTelemetry(snap, { seed: 5 ^ 0xca11b, ticks: TICKS });
  const calib = buildCalibration(calRaw.series);
  const calResid = standardizeAll(calRaw.series, calib);
  const cCell = makeFamilyCCellFromCovariance(estimateBaselineCovariance(calResid).sigma, DEFAULT_DETECT.alphaC);
  const dCells = estimateFamilyDNull(calResid);

  // live: affected path-classes gain a period-7 oscillation on p99 — NO marginal mean/variance change.
  const live = generateTelemetry(snap, {
    seed: 5,
    ticks: TICKS,
    degradation: { resource_id: target, delta: 0, start_tick: 0, signal: 'p99_latency', oscillationPeriod: 7, oscillationAmp: 0.9 },
  });
  const resid = standardizeAll(live.series, calib);
  const selAC = new Set(buildSurface(detectAll(resid, DEFAULT_DETECT, { familyCCell: cCell }), 0.1).selected_path_class_ids);
  const selACD = new Set(buildSurface(detectAll(resid, DEFAULT_DETECT, { familyCCell: cCell, familyDCells: dCells }), 0.1).selected_path_class_ids);

  // A+C (mean + covariance) are blind; adding D catches every affected path-class.
  for (const pc of affected) assert.ok(!selAC.has(pc), `A+C must be blind to the oscillation on ${pc}`);
  for (const pc of affected) assert.ok(selACD.has(pc), `Family D must catch the oscillation on ${pc}`);

  // FDR: the same A+C+D stack on a CLEAN window selects nothing.
  const clean = standardizeAll(generateTelemetry(snap, { seed: 5, ticks: TICKS }).series, calib);
  assert.equal(buildSurface(detectAll(clean, DEFAULT_DETECT, { familyCCell: cCell, familyDCells: dCells }), 0.1).selected_path_class_ids.length, 0);
});
