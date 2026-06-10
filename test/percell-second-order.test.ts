/**
 * Evidence for ADR-0011: is there per-cell (HoD×DoW×traffic-class) structure in the SECOND-order
 * statistics — the Family C covariance Σ and the AR(p) coefficient φ — that a per-cell estimator
 * would capture but the global one misses?
 *
 * These tests are the durable measurement behind the decision to KEEP the global Σ/φ and NOT build
 * per-cell estimators. They are anti-self-confirming: if the synthetic telemetry DID carry per-cell
 * second-order structure, the per-cell spread would EXCEED the pure-sampling-noise floor and the
 * first test would fail; if a traffic class needed its own φ, the global pre-whitening would leave
 * residual autocorrelation in that class and the second test would fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/rng';
import { generateFabric, DEFAULT_FABRIC } from '../src/fabric';
import { generateTelemetry } from '../src/telemetry';
import { buildCalibration, standardizeAll, cellKey, trafficClassOf, TRAFFIC_CLASSES } from '../src/calibration';
import { ledoitWolf } from '../src/covariance';
import { SIGNALS } from '../src/signals';

function corr(i: number, j: number, rho: number): number[][] {
  const p = SIGNALS.length;
  return Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => (a === b ? 1 : (a === i && b === j) || (a === j && b === i) ? rho : 0)));
}
const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / a.length;
const stdev = (a: number[]): number => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

// One clean fabric with a KNOWN global cross-signal correlation ρ=0.9 on signals (0,2) and the
// default global AR(1) noise — 168 ticks = exactly one HoD×DoW week, so each cell is well-sampled.
const FAB = { ...DEFAULT_FABRIC, n_path_classes: 400 };
const RESID = (() => {
  const snap = generateFabric(FAB);
  const raw = generateTelemetry(snap, { seed: 3, ticks: 168, noiseCorr: corr(0, 2, 0.9) });
  return { snap, resid: standardizeAll(raw.series, buildCalibration(raw.series)) };
})();

test('per-cell Family C Σ carries NO structure beyond sampling noise — global Σ suffices (ADR-0011)', () => {
  const rows: number[][] = [];
  for (const s of RESID.resid.values()) for (const v of s) rows.push(v);
  const globalSigma = ledoitWolf(rows).sigma[0][2];
  assert.ok(globalSigma > 0.8, `global Σ[0][2]=${globalSigma} should recover the injected ρ=0.9`);

  // per-cell Σ[0][2] over well-sampled cells.
  const byCell = new Map<string, number[][]>();
  for (const [pc, s] of RESID.resid) {
    const tc = trafficClassOf(pc);
    s.forEach((v, t) => { const k = cellKey(t, tc); (byCell.get(k) ?? byCell.set(k, []).get(k)!).push(v); });
  }
  const cells = [...byCell.values()].filter((r) => r.length >= 100);
  const perCell = cells.map((r) => ledoitWolf(r).sigma[0][2]);
  const cellSize = cells[0].length;

  // the sampling-noise floor: random GLOBAL subsets of the SAME size as a cell. If per-cell variation
  // were real structure it would exceed this; if it's pure sampling, it sits at or below it.
  const rng = makeRng(99);
  const floor = cells.map(() => {
    const sub: number[][] = [];
    for (let k = 0; k < cellSize; k++) sub.push(rows[rng.int(rows.length)]);
    return ledoitWolf(sub).sigma[0][2];
  });

  assert.ok(stdev(perCell) <= stdev(floor) * 1.5, `per-cell spread ${stdev(perCell).toFixed(3)} must not exceed the sampling-noise floor ${stdev(floor).toFixed(3)} — no real per-cell structure`);
  // and per-cell is a WORSE estimate of the true ρ: fewer samples → more shrinkage → attenuation.
  assert.ok(mean(perCell) < globalSigma, `per-cell mean Σ ${mean(perCell).toFixed(3)} is attenuated vs global ${globalSigma.toFixed(3)} (the estimation-variance penalty per ADR-0006/0011)`);
});

test('the global AR(p) φ whitens every traffic class equally — no per-class φ is warranted (ADR-0011)', () => {
  const lag1 = (col: number[]): number => {
    const m = mean(col);
    let c0 = 0; let c1 = 0;
    for (let t = 0; t < col.length; t++) c0 += (col[t] - m) ** 2;
    for (let t = 0; t < col.length - 1; t++) c1 += (col[t] - m) * (col[t + 1] - m);
    return c1 / c0;
  };
  for (const cls of TRAFFIC_CLASSES) {
    let acc = 0; let n = 0;
    for (const [pc, s] of RESID.resid) {
      if (trafficClassOf(pc) !== cls) continue;
      acc += lag1(s.map((v) => v[0]));
      n += 1;
    }
    // global φ already whitens this class to ~0; a class-specific φ would only chase sampling noise.
    assert.ok(Math.abs(acc / n) < 0.05, `class ${cls} whitened lag-1 autocorr ${(acc / n).toFixed(4)} ≈ 0 under the GLOBAL φ`);
  }
});
