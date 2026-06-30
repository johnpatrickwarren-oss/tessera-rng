/**
 * Robust RNG test network (telemetry realism) — what the enriched generator reveals about our work.
 * Grounded in design/research/telemetry-temporal-characterization.md. Two findings, pinned:
 *   GOOD — our per-cell calibration HANDLES a realistic weekly signal (0 false positives once the
 *          null spans the week);
 *   GAP  — our mean/sd calibration is NOT ROBUST to the clustered aberrations that always happen:
 *          contaminated history corrupts the null and manufactures false positives on clean data.
 *          (Points to the next consumption: a robust calibration estimator — the engine ships one.)
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
import { enrichRealistic, burstStats } from '../tools/realistic-telemetry';

const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
const TWO_WEEKS = 336;

/** false selections on a clean live window, given a calibration history. */
function falsePositives(calSeries: ReadonlyMap<string, number[][]>, liveSeries: ReadonlyMap<string, number[][]>): number {
  const cal = buildCalibration(calSeries as Map<string, number[][]>);
  const calR = standardizeAll(calSeries as Map<string, number[][]>, cal);
  const ctx = {
    familyCCell: makeFamilyCCellFromCovariance(estimateBaselineCovariance(calR).sigma, DEFAULT_DETECT.alphaC),
    familyDCells: estimateFamilyDNull(calR),
  };
  const resid = standardizeAll(liveSeries as Map<string, number[][]>, cal);
  return buildSurface(detectAll(resid, DEFAULT_DETECT, ctx), 0.05).selected_path_class_ids.length;
}

test('enrichRealistic adds a REAL weekly signal: weekend p99 baseline shifts vs weekday (a generated DoW dimension)', () => {
  const raw = generateTelemetry(SNAP, { seed: 1, ticks: TWO_WEEKS });
  const enriched = enrichRealistic(raw.series, { seed: 9, aberrations: false });
  const pc = [...enriched.keys()].sort()[0];
  const m = enriched.get(pc)!;
  // p99 (signal 0) at a weekday noon (day 0, hour 12 = tick 12) vs weekend noon (day 5, hour 12 = tick 132).
  const weekday = m[12][0];
  const weekend = m[5 * 24 + 12][0];
  assert.ok(weekend < weekday, `weekend baseline sits below weekday (weekend ${weekend.toFixed(2)} < weekday ${weekday.toFixed(2)})`);
});

test('aberrations are CLUSTERED and a realistic small fraction (not independent Poisson noise)', () => {
  const raw = generateTelemetry(SNAP, { seed: 1, ticks: TWO_WEEKS });
  const frac = burstStats(raw.series, { seed: 9 }).burstFraction;
  assert.ok(frac > 0.02 && frac < 0.15, `burst fraction is a small realistic share (got ${(frac * 100).toFixed(1)}%)`);
  // determinism: same seed ⇒ same fraction
  assert.equal(burstStats(raw.series, { seed: 9 }).burstFraction, frac);
});

test('GOOD: our per-cell calibration HANDLES the weekly signal — 0 false positives once the null spans the week', () => {
  const cal = enrichRealistic(generateTelemetry(SNAP, { seed: 2, ticks: TWO_WEEKS }).series, { seed: 9, aberrations: false });
  const live = enrichRealistic(generateTelemetry(SNAP, { seed: 3, ticks: 168 }).series, { seed: 11, aberrations: false });
  assert.equal(falsePositives(cal, live), 0, 'weekly seasonality is learned per-cell — no false positives');
});

test('GAP (pinned): mean/sd calibration is NOT ROBUST to clustered aberrations — contaminated history manufactures false positives', () => {
  // Same clean live window, two 2-week calibration histories: weekly-only vs weekly+aberrations.
  const liveClean = enrichRealistic(generateTelemetry(SNAP, { seed: 3, ticks: 168 }).series, { seed: 11, aberrations: false });
  const calClean = enrichRealistic(generateTelemetry(SNAP, { seed: 2, ticks: TWO_WEEKS }).series, { seed: 9, aberrations: false });
  const calDirty = enrichRealistic(generateTelemetry(SNAP, { seed: 2, ticks: TWO_WEEKS }).series, { seed: 9, aberrations: true });

  const clean = falsePositives(calClean, liveClean);
  const dirty = falsePositives(calDirty, liveClean);
  assert.equal(clean, 0, 'clean history ⇒ FDR controlled');
  assert.ok(dirty > clean, `aberration-contaminated history ⇒ MORE false positives (clean ${clean}, contaminated ${dirty}) — the non-robust null absorbs the bursts`);
});
