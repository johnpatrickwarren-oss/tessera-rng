import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFabric, DEFAULT_FABRIC } from '../src/fabric';
import { generateTelemetry, AR1_PHI } from '../src/telemetry';
import {
  trafficClassOf,
  cellKey,
  buildCalibration,
  standardizeAll,
  standardizeStream,
  DEFAULT_MIN_CELL_SAMPLES,
  TRAFFIC_CLASSES,
} from '../src/calibration';
import { detectAll, DEFAULT_DETECT } from '../src/detect';
import { buildSurface } from '../src/surface';
import { SIGNALS, signalIndex } from '../src/signals';

const SMALL = { ...DEFAULT_FABRIC, n_path_classes: 150 };
/** A topology small enough that every (HoD×DoW×class) cell is under-sampled (n ≈ 10 < 30). */
const TINY = { ...DEFAULT_FABRIC, n_path_classes: 30 };

function lag1Autocorr(col: number[]): number {
  const n = col.length;
  const mean = col.reduce((s, x) => s + x, 0) / n;
  let c0 = 0;
  let c1 = 0;
  for (let t = 0; t < n; t++) c0 += (col[t] - mean) ** 2;
  for (let t = 0; t < n - 1; t++) c1 += (col[t] - mean) * (col[t + 1] - mean);
  return c1 / c0;
}

test('traffic class is deterministic and within the declared set', () => {
  assert.ok(TRAFFIC_CLASSES.includes(trafficClassOf('pc-7')));
  assert.equal(trafficClassOf('pc-7'), trafficClassOf('pc-7'));
});

test('cell key encodes hour-of-day × day-of-week × traffic-class and wraps correctly', () => {
  assert.equal(cellKey(0, 'bulk'), '0-0-bulk');
  assert.equal(cellKey(25, 'bulk'), '1-1-bulk'); // hour wraps at 24, dow advances
  assert.equal(cellKey(24 * 7, 'bulk'), '0-0-bulk'); // dow wraps at 7
});

test('calibration characterizes a non-unimodal smear: cells differ by hour', () => {
  const snap = generateFabric(SMALL);
  const sub = buildCalibration(generateTelemetry(snap, { seed: 3, ticks: 48 }).series);
  const p99 = signalIndex('p99_latency');
  // hour 6 (diurnal peak) vs hour 18 (trough), same dow/class — baselines must differ.
  const peak = sub.cells.get('6-0-bulk');
  const trough = sub.cells.get('18-0-bulk');
  assert.ok(peak && trough, 'both cells should be populated');
  assert.ok(Math.abs(peak!.mean[p99] - trough!.mean[p99]) > 0.3, 'the normal is a smear, not unimodal');
});

test('the AR substrate recovers the per-signal AR(1) coefficient (ADR-0004)', () => {
  const snap = generateFabric({ ...SMALL, n_path_classes: 200 });
  // long contiguous window so γ̂₁/γ̂₀ is well-estimated.
  const sub = buildCalibration(generateTelemetry(snap, { seed: 3, ticks: 200 }).series);
  for (let j = 0; j < SIGNALS.length; j++) {
    assert.ok(Math.abs(sub.arPhi[j] - AR1_PHI[j]) < 0.1, `φ̂[${j}]=${sub.arPhi[j]} should approximate true ${AR1_PHI[j]}`);
  }
});

test('pre-whitening removes the temporal autocorrelation the AR noise injected', () => {
  const snap = generateFabric(SMALL);
  const raw = generateTelemetry(snap, { seed: 3, ticks: 200 });
  const sub = buildCalibration(raw.series);
  const resid = standardizeAll(raw.series, sub);
  const p99 = signalIndex('p99_latency');
  // pool lag-1 autocorrelation of the whitened residual across path-classes.
  let acc = 0;
  let k = 0;
  for (const series of resid.values()) { acc += lag1Autocorr(series.map((v) => v[p99])); k++; }
  const meanAcf = acc / k;
  assert.ok(Math.abs(meanAcf) < 0.15, `whitened lag-1 autocorr ${meanAcf} should be near 0 (raw φ≈${AR1_PHI[0]})`);
});

test('standardizing the clean window yields ~zero-mean residuals', () => {
  const snap = generateFabric(SMALL);
  const raw = generateTelemetry(snap, { seed: 3, ticks: 48 });
  const sub = buildCalibration(raw.series);
  const resid = standardizeAll(raw.series, sub);
  const p99 = signalIndex('p99_latency');
  let s = 0;
  let n = 0;
  for (const series of resid.values()) for (const v of series) { s += v[p99]; n++; }
  assert.ok(Math.abs(s / n) < 0.2, `clean residual mean ${s / n} should be near 0`);
});

// ───────────────────────── ADR-0006: min-sample pooled fallback ─────────────────────────

test('under-sampled cells fall back to the pooled per-signal baseline (ADR-0006)', () => {
  const tiny = buildCalibration(generateTelemetry(generateFabric(TINY), { seed: 3, ticks: 48 }).series);
  // every cell holds ~10 samples (30 path-classes / 3 classes), all below the 30-sample floor.
  const cells = [...tiny.cells.values()];
  assert.ok(cells.length > 0);
  assert.ok(cells.every((c) => c.n < DEFAULT_MIN_CELL_SAMPLES), 'TINY must under-sample every cell');
  assert.ok(cells.every((c) => c.pooled === true), 'under-sampled cells must be flagged pooled');
  // a pooled cell borrows the pooled (mean, sd) verbatim — not a noisy, possibly-floored per-cell sd.
  for (const c of cells) {
    for (let i = 0; i < SIGNALS.length; i++) {
      assert.equal(c.sd[i], tiny.pooled.sd[i], 'pooled cell sd must equal the pooled baseline sd');
      assert.equal(c.mean[i], tiny.pooled.mean[i], 'pooled cell mean must equal the pooled baseline mean');
    }
  }
  assert.ok(tiny.pooled.sd.every((s) => s > 0.5), 'pooled sd is well-estimated (~1), not floored to ~0');

  // a well-sampled topology keeps full per-cell resolution (no pooling).
  const big = buildCalibration(generateTelemetry(generateFabric(SMALL), { seed: 3, ticks: 48 }).series);
  assert.ok([...big.cells.values()].every((c) => c.n >= DEFAULT_MIN_CELL_SAMPLES && !c.pooled), 'SMALL must keep per-cell stats');
});

test('the pooled fallback preserves FDR control on a small topology — and is load-bearing (ADR-0006)', () => {
  const snap = generateFabric(TINY);
  const calClean = generateTelemetry(snap, { seed: 1 ^ 0xca11b, ticks: 48 }).series;
  const live = generateTelemetry(snap, { seed: 1, ticks: 48 }); // clean live window, independent seed

  // WITH the fallback (default min-samples): an under-sampled clean fabric selects NOTHING.
  const withFallback = standardizeAll(live.series, buildCalibration(calClean));
  const selected = buildSurface(detectAll(withFallback, DEFAULT_DETECT), 0.1).selected_path_class_ids;
  assert.equal(selected.length, 0, 'clean small topology must select nothing (FDR controlled)');

  // WITHOUT it (min-samples = 0 → trust the noisy per-cell sd): the same clean fabric false-selects.
  // This is the anti-self-confirming control — if the fallback were a no-op, the assertion above
  // would already fail here, so it proves the fallback (not luck) is what holds FDR.
  const noFallback = standardizeAll(live.series, buildCalibration(calClean, { minCellSamples: 0 }));
  const falsePositives = buildSurface(detectAll(noFallback, DEFAULT_DETECT), 0.1).selected_path_class_ids;
  assert.ok(falsePositives.length > 0, 'without the fallback, under-sampled per-cell sd must break FDR control');
});

test('the pooled fallback preserves detection power: a real shift on a small topology still fires', () => {
  const snap = generateFabric(TINY);
  const pzone = snap.resources.find((r) => r.kind === 'power_zone')!.id;
  const affected = new Set(snap.edges.filter((e) => e.resource === pzone).map((e) => e.path_class));
  const calib = buildCalibration(generateTelemetry(snap, { seed: 1 ^ 0xca11b, ticks: 48 }).series);
  const degraded = generateTelemetry(snap, { seed: 1, ticks: 48, degradation: { resource_id: pzone, delta: 8, start_tick: 0 } });
  const selected = new Set(buildSurface(detectAll(standardizeAll(degraded.series, calib), DEFAULT_DETECT), 0.1).selected_path_class_ids);
  for (const pc of affected) assert.ok(selected.has(pc), `pooled de-meaning must still expose the shift on ${pc}`);
});

test('an unseen cell falls back to the pooled baseline, not a raw pass-through (ADR-0006)', () => {
  const snap = generateFabric(SMALL);
  const raw = generateTelemetry(snap, { seed: 3, ticks: 48 });
  // calibrate on ONE day only (ticks 0..23 → dow 0); ticks 24..47 live in dow-1 cells never seen.
  const oneDay = new Map([...raw.series].map(([pc, s]) => [pc, s.slice(0, 24)]));
  const sub = buildCalibration(oneDay);
  const pc = [...raw.series.keys()][0];
  const resid = standardizeStream(raw.series.get(pc)!, pc, sub);
  // the unseen tail (ticks 24..47) must be de-meaned by the pooled baseline → near-standardized,
  // NOT passed through raw (a raw p99 level ≈ 10 would dwarf this bound).
  for (let t = 24; t < 48; t++) {
    assert.ok(Math.abs(resid[t][signalIndex('p99_latency')]) < 6, `unseen-cell residual at t=${t} must be pooled-standardized, not raw`);
  }
});

test('standardizing a degraded window still exposes the degradation after pre-whitening', () => {
  const snap = generateFabric(SMALL);
  const target = snap.resources.find((r) => r.kind === 'passive_shuffler')!.id;
  const affected = new Set(snap.edges.filter((e) => e.resource === target).map((e) => e.path_class));
  const sub = buildCalibration(generateTelemetry(snap, { seed: 3, ticks: 48 }).series);
  const degraded = generateTelemetry(snap, { seed: 11, ticks: 48, degradation: { resource_id: target, delta: 5, start_tick: 0 } });
  const resid = standardizeAll(degraded.series, sub);
  const p99 = signalIndex('p99_latency');
  const pc = [...affected][0];
  const series = resid.get(pc)!;
  const mean = series.reduce((acc, v) => acc + v[p99], 0) / series.length;
  // pre-whitening attenuates a step by sqrt((1-φ)/(1+φ)) but it remains clearly positive.
  assert.ok(mean > 1, `affected residual p99 mean ${mean} should still reveal the injected shift`);
});
