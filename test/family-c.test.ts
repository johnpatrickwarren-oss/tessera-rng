import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/rng';
import {
  runFamilyC,
  makeFamilyCCell,
  makeFamilyCCellFromCovariance,
  estimateBaselineCovariance,
  identityCovariance,
  DEFAULT_TAU_SQUARED,
} from '../src/family-c';
import { logDet, addToDiagonal } from '../src/covariance';
import { generateFabric, DEFAULT_FABRIC } from '../src/fabric';
import { generateTelemetry } from '../src/telemetry';
import { buildCalibration, standardizeAll } from '../src/calibration';
import { detectAll, DEFAULT_DETECT } from '../src/detect';
import { buildSurface } from '../src/surface';
import { SIGNALS } from '../src/signals';

/** A p×p correlation matrix: ρ between signals (i0,j0), identity elsewhere. */
function corr(i0: number, j0: number, rho: number): number[][] {
  const p = SIGNALS.length;
  return Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) => (i === j ? 1 : (i === i0 && j === j0) || (i === j0 && j === i0) ? rho : 0)),
  );
}

function vectors(seed: number, ticks: number, shift: number[]): number[][] {
  const r = makeRng(seed);
  const out: number[][] = [];
  for (let t = 0; t < ticks; t++) {
    const v = SIGNALS.map((_, i) => r.gaussian() + (shift[i] ?? 0));
    out.push(v);
  }
  return out;
}

test('identity covariance is p×p with unit diagonal', () => {
  const I = identityCovariance(5);
  assert.equal(I.length, 5);
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) assert.equal(I[i][j], i === j ? 1 : 0);
});

test('the Σ=I closed-form shrink constant matches (p/2)·ln(1+τ²)', () => {
  const cell = makeFamilyCCell(5, 0.01, DEFAULT_TAU_SQUARED);
  const expected = (5 / 2) * Math.log(1 + DEFAULT_TAU_SQUARED);
  assert.ok(Math.abs(cell.safe_hotelling_params!.precompiled_log_det_shrink - expected) < 1e-12);
});

test('Safe-Hotelling decays under the null and fires under a multivariate shift', () => {
  const clean = runFamilyC(vectors(7, 150, [0, 0, 0, 0, 0]), 0.01);
  const shifted = runFamilyC(vectors(7, 150, [2.5, 0, 0, 0, 0]), 0.01);
  assert.ok(!clean.fired, `null wealth ${clean.e_value} should stay below 1/α`);
  assert.ok(shifted.fired, `shifted wealth ${shifted.e_value} should exceed 1/α`);
  assert.ok(shifted.alpha_spent > 0 && clean.alpha_spent === 0);
});

// ───────────────────────── ADR-0007: learned cross-signal covariance ─────────────────────────

test('the learned-Σ shrink constant equals ½·log(det(Σ+τ²I)/det(Σ))', () => {
  const sigma = corr(0, 2, 0.9); // correlation matrix, not identity
  const cell = makeFamilyCCellFromCovariance(sigma, 0.01, DEFAULT_TAU_SQUARED);
  const expected = 0.5 * (logDet(addToDiagonal(sigma, DEFAULT_TAU_SQUARED))! - logDet(sigma)!);
  assert.ok(Math.abs(cell.safe_hotelling_params!.precompiled_log_det_shrink - expected) < 1e-12);
  // a correlated Σ has a different (larger here) constant than the identity baseline — proof the
  // term is actually recomputed for the real Σ, not left at the identity closed form.
  const identityConst = makeFamilyCCell(SIGNALS.length, 0.01).safe_hotelling_params!.precompiled_log_det_shrink;
  assert.ok(Math.abs(cell.safe_hotelling_params!.precompiled_log_det_shrink - identityConst) > 0.1);
  assert.deepEqual(cell.covariance, sigma, 'the learned Σ is carried into the cell');
});

test('makeFamilyCCellFromCovariance stays finite on a non-PD covariance (engine suppresses, no NaN)', () => {
  const indefinite = [[1, 2], [2, 1]]; // eigenvalues −1, 3 — not positive-definite
  const cell = makeFamilyCCellFromCovariance(indefinite, 0.01);
  assert.ok(Number.isFinite(cell.safe_hotelling_params!.precompiled_log_det_shrink), 'shrink constant must be finite');
});

test('estimateBaselineCovariance recovers injected cross-signal correlation from residuals', () => {
  const snap = generateFabric({ ...DEFAULT_FABRIC, n_path_classes: 200 });
  const R = corr(0, 2, 0.9);
  const calib = buildCalibration(generateTelemetry(snap, { seed: 7, ticks: 96, noiseCorr: R }).series);
  const lw = estimateBaselineCovariance(standardizeAll(generateTelemetry(snap, { seed: 7, ticks: 96, noiseCorr: R }).series, calib));
  assert.ok(lw.sigma[0][2] > 0.6, `learned Σ[0][2]=${lw.sigma[0][2]} should recover the injected ρ`);
  // an unrelated pair stays near-zero.
  assert.ok(Math.abs(lw.sigma[1][3]) < 0.2, `unrelated Σ[1][3]=${lw.sigma[1][3]} should stay ~0`);
});

test('learned Σ catches a pure covariance-flip that identity Σ is blind to (ADR-0007)', () => {
  const p = SIGNALS.length;
  const snap = generateFabric({ ...DEFAULT_FABRIC, n_path_classes: 300 });
  const target = snap.resources.find((r) => r.kind === 'passive_shuffler')!.id;
  const affected = new Set(snap.edges.filter((e) => e.resource === target).map((e) => e.path_class));
  const R = corr(0, 2, 0.9); // baseline: signals 0 and 2 co-move
  const Rflip = corr(0, 2, -0.9); // degradation: same marginals, correlation reversed

  // learn Σ from clean correlated calibration; build learned vs identity cells.
  const calRaw = generateTelemetry(snap, { seed: 7 ^ 0xca11b, ticks: 96, noiseCorr: R });
  const calib = buildCalibration(calRaw.series);
  const sigma = estimateBaselineCovariance(standardizeAll(calRaw.series, calib)).sigma;
  const learned = makeFamilyCCellFromCovariance(sigma, DEFAULT_DETECT.alphaC);
  const identity = makeFamilyCCell(p, DEFAULT_DETECT.alphaC);

  // live: affected path-classes flip their correlation — NO marginal mean/variance change.
  const live = generateTelemetry(snap, { seed: 7, ticks: 96, noiseCorr: R, degradation: { resource_id: target, delta: 0, start_tick: 0, degradedNoiseCorr: Rflip } });
  const resid = standardizeAll(live.series, calib);
  const selLearned = new Set(buildSurface(detectAll(resid, DEFAULT_DETECT, { familyCCell: learned }), 0.1).selected_path_class_ids);
  const selIdentity = new Set(buildSurface(detectAll(resid, DEFAULT_DETECT, { familyCCell: identity }), 0.1).selected_path_class_ids);

  // learned Σ flags every affected path-class; identity Σ (and Family A) see nothing.
  for (const pc of affected) assert.ok(selLearned.has(pc), `learned Σ must catch the covariance shift on ${pc}`);
  for (const pc of affected) assert.ok(!selIdentity.has(pc), `identity Σ must be blind to the covariance shift on ${pc}`);
  assert.ok(selLearned.size > selIdentity.size + 10, 'learned Σ selects materially more than identity Σ');

  // FDR: the same learned Σ on a CLEAN correlated window selects nothing (no inflated null).
  const clean = standardizeAll(generateTelemetry(snap, { seed: 7, ticks: 96, noiseCorr: R }).series, calib);
  assert.equal(buildSurface(detectAll(clean, DEFAULT_DETECT, { familyCCell: learned }), 0.1).selected_path_class_ids.length, 0);
});
