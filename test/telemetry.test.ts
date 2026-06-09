import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFabric, DEFAULT_FABRIC } from '../src/fabric';
import { generateTelemetry } from '../src/telemetry';
import { SIGNALS, signalIndex } from '../src/signals';

const SMALL = { ...DEFAULT_FABRIC, n_path_classes: 120 };

function mostTraversedShuffler(snap = generateFabric(SMALL)): string {
  const counts = new Map<string, number>();
  for (const e of snap.edges) {
    if (e.resource.startsWith('shuffler-')) counts.set(e.resource, (counts.get(e.resource) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

test('telemetry has one ticks×|SIGNALS| matrix per path-class; deterministic', () => {
  const snap = generateFabric(SMALL);
  const a = generateTelemetry(snap, { seed: 5, ticks: 40 });
  const b = generateTelemetry(snap, { seed: 5, ticks: 40 });
  assert.equal(a.series.size, snap.path_classes.length);
  for (const pc of snap.path_classes) {
    const m = a.series.get(pc)!;
    assert.equal(m.length, 40);
    assert.equal(m[0].length, SIGNALS.length);
    assert.deepEqual(m, b.series.get(pc));
  }
});

test('signals are RAW (centered on a per-cell baseline, not pre-standardized)', () => {
  const snap = generateFabric(SMALL);
  const tel = generateTelemetry(snap, { seed: 5, ticks: 40 });
  const p99 = signalIndex('p99_latency');
  const m = tel.series.get(snap.path_classes[0])!;
  const meanP99 = m.reduce((s, v) => s + v[p99], 0) / m.length;
  // baseline p99 ~ 10ms; a standardized residual would sit near 0. This pins "raw".
  assert.ok(meanP99 > 5, `raw p99 mean ${meanP99} should reflect the ~10 baseline, not ~0`);
});

test('degradation adds exactly delta to affected p99 post-start; unaffected unchanged (same seed)', () => {
  const snap = generateFabric(SMALL);
  const target = mostTraversedShuffler(snap);
  const affected = new Set(snap.edges.filter((e) => e.resource === target).map((e) => e.path_class));
  const p99 = signalIndex('p99_latency');
  const start = 20;
  const delta = 4;

  const clean = generateTelemetry(snap, { seed: 9, ticks: 50 });
  const deg = generateTelemetry(snap, { seed: 9, ticks: 50, degradation: { resource_id: target, delta, start_tick: start } });

  // affected path-class: deg − clean == delta on every post-start tick, 0 before.
  const pc = [...affected][0];
  const c = clean.series.get(pc)!;
  const d = deg.series.get(pc)!;
  for (let t = 0; t < 50; t++) {
    const diff = d[t][p99] - c[t][p99];
    assert.ok(Math.abs(diff - (t >= start ? delta : 0)) < 1e-9, `tick ${t} diff ${diff}`);
  }

  // an unaffected path-class is byte-identical between the two runs.
  const un = snap.path_classes.find((x) => !affected.has(x))!;
  assert.deepEqual(deg.series.get(un), clean.series.get(un));
});
