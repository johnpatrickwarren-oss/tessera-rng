/**
 * Robust calibration (telemetry-realism follow-up) — closes the gap the test network surfaced:
 * our mean/sd per-cell null ABSORBS the clustered aberrations that always happen in real history,
 * manufacturing false positives. The robust estimator (engine `robustLocation` + MAD) TOSSES them.
 * Two pins: (1) it closes the gap on contaminated history; (2) it ≈ mean/sd on clean Gaussian
 * history, so a clean null — and the existing floors — are essentially unchanged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTelemetry } from '../src/telemetry';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { buildCalibration, standardizeAll } from '../src/calibration';
import { detectAll, DEFAULT_DETECT } from '../src/detect';
import { estimateBaselineCovariance, makeFamilyCCellFromCovariance } from '../src/family-c';
import { estimateFamilyDNull } from '../src/family-d';
import { buildSurface } from '../src/surface';
import { enrichRealistic } from '../tools/realistic-telemetry';

const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);

function falsePositives(calSeries: ReadonlyMap<string, number[][]>, liveSeries: ReadonlyMap<string, number[][]>, robust: boolean): number {
  const cal = buildCalibration(calSeries as Map<string, number[][]>, { robust });
  const calR = standardizeAll(calSeries as Map<string, number[][]>, cal);
  const ctx = {
    familyCCell: makeFamilyCCellFromCovariance(estimateBaselineCovariance(calR).sigma, DEFAULT_DETECT.alphaC),
    familyDCells: estimateFamilyDNull(calR),
  };
  const resid = standardizeAll(liveSeries as Map<string, number[][]>, cal);
  return buildSurface(detectAll(resid, DEFAULT_DETECT, ctx), 0.05).selected_path_class_ids.length;
}

test('GAP CLOSED: robust calibration tosses the clustered aberrations a mean/sd null absorbs', () => {
  const liveClean = enrichRealistic(generateTelemetry(SNAP, { seed: 3, ticks: 168 }).series, { seed: 11, aberrations: false });
  const calDirty = enrichRealistic(generateTelemetry(SNAP, { seed: 2, ticks: 336 }).series, { seed: 9, aberrations: true });
  const meanSd = falsePositives(calDirty, liveClean, false);
  const robust = falsePositives(calDirty, liveClean, true);
  assert.ok(meanSd > 10, `mean/sd absorbs the aberrations ⇒ many false positives (got ${meanSd})`);
  assert.equal(robust, 0, `robust calibration tosses them ⇒ FDR controlled (got ${robust})`);
});

test('CLEAN EQUIVALENCE: robust calibration is UNBIASED on clean Gaussian history (median scale ratio ≈ 1)', () => {
  // robustLocation≈mean and MAD×1.4826≈sd at the Gaussian, so on average the robust null matches
  // mean/sd; per-cell the MAD scale is noisier (≈37% less efficient), so individual cells scatter —
  // the honest claim is UNBIASED-on-average, not per-cell-identical. (The clean-FDR cost of that
  // scatter is handled by the higher robust min-cell-samples — see the clean-FDR test below.)
  const clean = generateTelemetry(SNAP, { seed: 2, ticks: 336 }).series;
  const meanSd = buildCalibration(clean, { robust: false, minCellSamples: 30 });
  const robust = buildCalibration(clean, { robust: true, minCellSamples: 30 });
  const ratios: number[] = [];
  for (const [key, c] of meanSd.cells) {
    if (c.pooled || robust.cells.get(key)!.pooled) continue;
    const r = robust.cells.get(key)!;
    for (let i = 0; i < c.mean.length; i++) ratios.push(r.sd[i] / (c.sd[i] || 1));
  }
  ratios.sort((a, b) => a - b);
  const median = ratios[ratios.length >> 1];
  assert.ok(ratios.length > 100 && median > 0.95 && median < 1.05, `median per-cell scale ratio ≈ 1 (got ${median.toFixed(3)} over ${ratios.length} cells)`);
});

test('robust calibration keeps clean-fabric FDR at 0 (the higher robust min-sample absorbs MAD scatter)', () => {
  // 4 clean trials, matched windows, robust calibration at its DEFAULT (robust min-cell-samples) —
  // no false positives, even at the thin 60-tick window where the per-cell MAD scatter is largest.
  let fp = 0;
  for (const seed of [1, 2, 3, 4]) {
    const cal = buildCalibration(generateTelemetry(SNAP, { seed: seed ^ 0xca11b, ticks: 60 }).series, { robust: true });
    const calR = standardizeAll(generateTelemetry(SNAP, { seed: seed ^ 0xca11b, ticks: 60 }).series, cal);
    const ctx = {
      familyCCell: makeFamilyCCellFromCovariance(estimateBaselineCovariance(calR).sigma, DEFAULT_DETECT.alphaC),
      familyDCells: estimateFamilyDNull(calR),
    };
    fp += buildSurface(detectAll(standardizeAll(generateTelemetry(SNAP, { seed, ticks: 60 }).series, cal), DEFAULT_DETECT, ctx), 0.05).selected_path_class_ids.length;
  }
  assert.equal(fp, 0, `robust calibration controls clean-fabric FDR (got ${fp} false selections)`);
});
