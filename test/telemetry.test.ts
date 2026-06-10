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

// ───────────────────────── ADR-0007: correlated noise + covariance shift ─────────────────────────

test('noiseCorr=identity reproduces the v1 (uncorrelated) telemetry byte-for-byte', () => {
  const snap = generateFabric(SMALL);
  const p = SIGNALS.length;
  const I = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => (i === j ? 1 : 0)));
  const base = generateTelemetry(snap, { seed: 5, ticks: 40 });
  const withI = generateTelemetry(snap, { seed: 5, ticks: 40, noiseCorr: I });
  for (const pc of snap.path_classes) assert.deepEqual(withI.series.get(pc), base.series.get(pc));
});

test('noiseCorr injects the requested cross-signal correlation into the raw noise', () => {
  const snap = generateFabric(SMALL);
  const p = SIGNALS.length;
  const i0 = 0, j0 = 2, rho = 0.8;
  const R = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) => (i === j ? 1 : (i === i0 && j === j0) || (i === j0 && j === i0) ? rho : 0)));
  const tel = generateTelemetry(snap, { seed: 5, ticks: 400, noiseCorr: R });
  // pool the de-trended (per-tick first-difference removes the diurnal/baseline) sample correlation.
  let s00 = 0, s22 = 0, s02 = 0, n = 0;
  for (const series of tel.series.values()) {
    for (let t = 1; t < series.length; t++) {
      const a = series[t][i0] - series[t - 1][i0];
      const b = series[t][j0] - series[t - 1][j0];
      s00 += a * a; s22 += b * b; s02 += a * b; n++;
    }
  }
  const r = s02 / Math.sqrt(s00 * s22);
  assert.ok(r > 0.4, `injected ρ=${rho} should produce a clearly positive sample correlation (got ${r})`);
});

test('degradedNoiseCorr changes only affected path-classes and preserves their marginals', () => {
  const snap = generateFabric(SMALL);
  const p = SIGNALS.length;
  const target = mostTraversedShuffler(snap);
  const affected = new Set(snap.edges.filter((e) => e.resource === target).map((e) => e.path_class));
  const R: number[][] = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => (i === j ? 1 : 0)));
  const Rflip = R.map((row) => [...row]); Rflip[0][2] = -0.9; Rflip[2][0] = -0.9;
  const baseR = R.map((row) => [...row]); baseR[0][2] = 0.9; baseR[2][0] = 0.9;

  const clean = generateTelemetry(snap, { seed: 9, ticks: 80, noiseCorr: baseR });
  const deg = generateTelemetry(snap, { seed: 9, ticks: 80, noiseCorr: baseR, degradation: { resource_id: target, delta: 0, start_tick: 0, degradedNoiseCorr: Rflip } });

  // an unaffected path-class is byte-identical (the degradation is local to the affected set).
  const un = snap.path_classes.find((x) => !affected.has(x))!;
  assert.deepEqual(deg.series.get(un), clean.series.get(un));

  // an affected path-class keeps BOTH per-signal marginals — mean AND variance — unchanged: the
  // degradation is purely second-order (only the cross-correlation between signals 0 and 2 flips).
  const pc = [...affected][0];
  const c = clean.series.get(pc)!;
  const d = deg.series.get(pc)!;
  const moments = (m: readonly (readonly number[])[], sig: number) => {
    const mean = m.reduce((s, v) => s + v[sig], 0) / m.length;
    const variance = m.reduce((s, v) => s + (v[sig] - mean) ** 2, 0) / m.length;
    return { mean, variance };
  };
  for (const sig of [0, 2]) {
    const a = moments(c, sig);
    const b = moments(d, sig);
    assert.ok(Math.abs(a.mean - b.mean) < 0.5, `signal ${sig} marginal mean must be ~unchanged (${a.mean} vs ${b.mean})`);
    assert.ok(Math.abs(a.variance - b.variance) < 0.5, `signal ${sig} marginal variance must be ~unchanged (${a.variance} vs ${b.variance})`);
  }
});

test('default telemetry noise carries the AR(1) stationary unit-variance contract', () => {
  // The v1 contract: stationary AR(1) noise with marginal variance ≈ 1 at every tick (the
  // √(1−φ²) innovation scaling). Strip the diurnal/baseline by removing each (path-class, hour)
  // mean, then pool the residual variance. A signal with φ=0.6 would sit at 1/(1−0.36)≈1.56 if
  // the unit-variance scaling were dropped — so this binds the scaling, not just "some noise".
  const snap = generateFabric(SMALL);
  const tel = generateTelemetry(snap, { seed: 7, ticks: 240 });
  const sig = signalIndex('loss_rate'); // φ = 0.6
  let sq = 0, n = 0;
  for (const series of tel.series.values()) {
    const byHour = new Map<number, number[]>();
    series.forEach((v, t) => { const h = t % 24; const a = byHour.get(h) ?? []; a.push(v[sig]); byHour.set(h, a); });
    for (const vals of byHour.values()) {
      const m = vals.reduce((s, x) => s + x, 0) / vals.length;
      for (const x of vals) { sq += (x - m) ** 2; n++; }
    }
  }
  const variance = sq / n;
  assert.ok(variance > 0.75 && variance < 1.25, `AR(1) noise marginal variance ${variance} should be ≈ 1`);
});
