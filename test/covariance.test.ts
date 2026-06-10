import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/rng';
import { cholesky, logDet, addToDiagonal, sampleCovariance, ledoitWolf } from '../src/covariance';

/** Naive log-determinant via Gaussian elimination — an INDEPENDENT reference for logDet(). */
function logDetGauss(M: readonly number[][]): number {
  const n = M.length;
  const a = M.map((r) => [...r]);
  let logdet = 0;
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[piv][i])) piv = r;
    if (piv !== i) [a[i], a[piv]] = [a[piv], a[i]];
    logdet += Math.log(Math.abs(a[i][i]));
    for (let r = i + 1; r < n; r++) {
      const f = a[r][i] / a[i][i];
      for (let c = i; c < n; c++) a[r][c] -= f * a[i][c];
    }
  }
  return logdet;
}

/** Draw n rows from N(0, Σ) via x = L·z, L = chol(Σ). */
function gaussianRows(n: number, sigma: number[][], seed: number): number[][] {
  const L = cholesky(sigma)!;
  const p = sigma.length;
  const r = makeRng(seed);
  const rows: number[][] = [];
  for (let t = 0; t < n; t++) {
    const z = Array.from({ length: p }, () => r.gaussian());
    rows.push(z.map((_, i) => { let s = 0; for (let k = 0; k <= i; k++) s += L[i][k] * z[k]; return s; }));
  }
  return rows;
}

test('cholesky reconstructs the matrix: L·Lᵀ = M', () => {
  const M = [[4, 2, 0.6], [2, 3, 0.4], [0.6, 0.4, 1.5]];
  const L = cholesky(M)!;
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) assert.equal(L[i][j], 0, 'L must be lower-triangular');
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += L[i][k] * L[j][k];
      assert.ok(Math.abs(s - M[i][j]) < 1e-12, `L·Lᵀ[${i}][${j}] must equal M`);
    }
  }
});

test('cholesky returns null for a non-positive-definite matrix', () => {
  assert.equal(cholesky([[1, 2], [2, 1]]), null); // eigenvalues -1, 3 → indefinite
  assert.equal(cholesky([[0, 0], [0, 0]]), null);
});

test('logDet matches an independent Gaussian-elimination reference', () => {
  const M = [[4, 2, 0.6], [2, 3, 0.4], [0.6, 0.4, 1.5]];
  assert.ok(Math.abs(logDet(M)! - logDetGauss(M)) < 1e-10);
  assert.equal(logDet([[1, 2], [2, 1]]), null); // not PD → null
  // diagonal: logDet(diag) = Σ log(d_i)
  assert.ok(Math.abs(logDet([[2, 0], [0, 5]])! - (Math.log(2) + Math.log(5))) < 1e-12);
});

test('addToDiagonal adds the scalar only on the diagonal and does not mutate the input', () => {
  const M = [[1, 0.5], [0.5, 1]];
  const out = addToDiagonal(M, 0.25);
  assert.deepEqual(out, [[1.25, 0.5], [0.5, 1.25]]);
  assert.deepEqual(M, [[1, 0.5], [0.5, 1]], 'input must be untouched');
});

test('sampleCovariance recovers a known covariance from many samples', () => {
  const sigma = [[1, 0.7, 0], [0.7, 1, 0], [0, 0, 2]];
  const S = sampleCovariance(gaussianRows(20000, sigma, 11));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    assert.ok(Math.abs(S[i][j] - sigma[i][j]) < 0.06, `S[${i}][${j}]=${S[i][j]} ≈ ${sigma[i][j]}`);
  }
});

test('Ledoit-Wolf keeps real correlation (λ→0) and is positive-definite', () => {
  const sigma = [[1, 0.9, 0], [0.9, 1, 0], [0, 0, 1]];
  const lw = ledoitWolf(gaussianRows(8000, sigma, 3));
  assert.ok(lw.lambda >= 0 && lw.lambda <= 1, 'λ in [0,1]');
  assert.ok(lw.lambda < 0.2, `strong, well-sampled structure → little shrinkage (λ=${lw.lambda})`);
  assert.ok(lw.sigma[0][1] > 0.7, `recovers the ρ=0.9 off-diagonal (got ${lw.sigma[0][1]})`);
  assert.ok(cholesky(lw.sigma) !== null, 'shrunk Σ must be positive-definite');
});

test('Ledoit-Wolf degenerates safely on a single sample: full shrinkage to a positive-definite target', () => {
  // 1 sample cannot estimate covariance (its centered sample covariance is the zero matrix); the
  // estimator must short-circuit to λ=1 and an invertible scaled-identity Σ, never a rank-deficient
  // zero matrix that would break the detector's Cholesky.
  const one = ledoitWolf([[1, 2, 3]]);
  assert.equal(one.lambda, 1, 'fewer than 2 samples ⇒ fully shrunk');
  assert.ok(one.mu > 0, 'identity scale μ falls back to a positive value, not 0');
  assert.ok(cholesky(one.sigma) !== null, 'degenerate Σ must still be positive-definite');
  assert.ok(one.sigma[0][0] > 0 && one.sigma[1][1] > 0 && one.sigma[2][2] > 0, 'diagonal must be positive');
});

test('Ledoit-Wolf shrinks spurious off-diagonals toward the identity target (λ→1)', () => {
  // pure independent noise: the only off-diagonal structure is estimation noise → heavy shrinkage.
  const lw = ledoitWolf(gaussianRows(40, [[1, 0], [0, 1]], 9));
  assert.ok(lw.lambda > 0.5, `noise-only off-diagonals → strong shrinkage (λ=${lw.lambda})`);
  assert.ok(Math.abs(lw.sigma[0][1]) < Math.abs(sampleCovariance(gaussianRows(40, [[1, 0], [0, 1]], 9))[0][1]),
    'shrunk off-diagonal must be closer to 0 than the raw sample off-diagonal');
});
