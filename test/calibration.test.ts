import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFabric, DEFAULT_FABRIC } from '../src/fabric';
import { generateTelemetry } from '../src/telemetry';
import {
  trafficClassOf,
  cellKey,
  buildCalibration,
  standardizeAll,
  TRAFFIC_CLASSES,
} from '../src/calibration';
import { signalIndex } from '../src/signals';

const SMALL = { ...DEFAULT_FABRIC, n_path_classes: 150 };

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
  const peak = sub.get('6-0-bulk');
  const trough = sub.get('18-0-bulk');
  assert.ok(peak && trough, 'both cells should be populated');
  assert.ok(Math.abs(peak!.mean[p99] - trough!.mean[p99]) > 0.3, 'the normal is a smear, not unimodal');
});

test('standardizing the clean window yields ~N(0,1) residuals (mean≈0)', () => {
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

test('standardizing a degraded window exposes the degradation as a residual shift', () => {
  const snap = generateFabric(SMALL);
  const target = snap.resources.find((r) => r.kind === 'passive_shuffler')!.id;
  const affected = new Set(snap.edges.filter((e) => e.resource === target).map((e) => e.path_class));
  // calibrate on a CLEAN window, then standardize a degraded window against it.
  const sub = buildCalibration(generateTelemetry(snap, { seed: 3, ticks: 48 }).series);
  const degraded = generateTelemetry(snap, { seed: 11, ticks: 48, degradation: { resource_id: target, delta: 4, start_tick: 0 } });
  const resid = standardizeAll(degraded.series, sub);
  const p99 = signalIndex('p99_latency');
  const pc = [...affected][0];
  const series = resid.get(pc)!;
  const mean = series.reduce((acc, v) => acc + v[p99], 0) / series.length;
  assert.ok(mean > 2, `affected residual p99 mean ${mean} should reveal the injected shift (≈delta/sd)`);
});
