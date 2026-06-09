import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFabric, DEFAULT_FABRIC } from '../src/fabric';
import { generateTelemetry, AR1_PHI } from '../src/telemetry';
import {
  trafficClassOf,
  cellKey,
  buildCalibration,
  standardizeAll,
  TRAFFIC_CLASSES,
} from '../src/calibration';
import { SIGNALS, signalIndex } from '../src/signals';

const SMALL = { ...DEFAULT_FABRIC, n_path_classes: 150 };

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
