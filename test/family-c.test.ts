import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/rng';
import { runFamilyC, makeFamilyCCell, identityCovariance, DEFAULT_TAU_SQUARED } from '../src/family-c';
import { SIGNALS } from '../src/signals';

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
