/**
 * Covariance estimation + the linear-algebra primitives Family C needs (v1 ADR-0007).
 *
 * Family C's Safe-Hotelling e-process is a multivariate test against a baseline covariance Σ.
 * v1 assumed Σ = I (no cross-signal structure). Real network signals co-move — a shared optic
 * degrading lifts latency AND loss together — so the *informative* shift is one that violates
 * the learned co-movement, which an identity Σ cannot see. Here we LEARN Σ from the clean
 * calibration residuals (Ledoit-Wolf shrinkage toward a scaled identity, for a well-conditioned,
 * invertible estimate even from short windows) and provide the Cholesky/log-det the engine's
 * detector consumes via `precompiled_log_det_shrink` (see family-c.ts).
 *
 * Pure arithmetic — no engine internals (the engine's cholesky/log-det live behind a
 * `_`-prefixed internal path, which N5 forbids importing; these are independent implementations).
 */

/** Lower-triangular Cholesky factor L with L·Lᵀ = M, or null if M is not positive-definite. */
export function cholesky(M: readonly number[][]): number[][] | null {
  const n = M.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = M[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 0) return null; // not positive-definite
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return L;
}

/** log det(M) = 2·Σ log L_ii via Cholesky, or null if M is not positive-definite. */
export function logDet(M: readonly number[][]): number | null {
  const L = cholesky(M);
  if (!L) return null;
  let s = 0;
  for (let i = 0; i < L.length; i++) s += Math.log(L[i][i]);
  return 2 * s;
}

/** Σ + cI (add a scalar to the diagonal), returning a fresh matrix. */
export function addToDiagonal(M: readonly number[][], c: number): number[][] {
  return M.map((row, i) => row.map((x, j) => (i === j ? x + c : x)));
}

/** MLE sample covariance (÷n) of mean-centered rows; each row is a p-vector. */
export function sampleCovariance(rows: readonly number[][]): number[][] {
  const n = rows.length;
  const p = n > 0 ? rows[0].length : 0;
  const mean = new Array<number>(p).fill(0);
  for (const r of rows) for (let i = 0; i < p; i++) mean[i] += r[i];
  for (let i = 0; i < p; i++) mean[i] /= n || 1;
  const S = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (const r of rows) {
    for (let i = 0; i < p; i++) {
      const di = r[i] - mean[i];
      for (let j = 0; j < p; j++) S[i][j] += di * (r[j] - mean[j]);
    }
  }
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) S[i][j] /= n || 1;
  return S;
}

/** Squared Frobenius norm of an arbitrary matrix. */
function frobeniusSq(A: readonly number[][]): number {
  let s = 0;
  for (const row of A) for (const x of row) s += x * x;
  return s;
}

/** Mean-center rows by their column means (so S and the dispersion below share one centering). */
function centerRows(rows: readonly number[][]): number[][] {
  const n = rows.length;
  const p = n > 0 ? rows[0].length : 0;
  const mean = new Array<number>(p).fill(0);
  for (const r of rows) for (let i = 0; i < p; i++) mean[i] += r[i];
  for (let i = 0; i < p; i++) mean[i] /= n || 1;
  return rows.map((r) => r.map((x, i) => x - mean[i]));
}

/** b̄² = (1/n²) Σ_k ‖x_k x_kᵀ − S‖²_F over centered samples — the sampling variance of S's entries. */
function entrywiseDispersion(centered: readonly number[][], S: readonly number[][]): number {
  let acc = 0;
  for (const xc of centered) {
    for (let i = 0; i < xc.length; i++) {
      for (let j = 0; j < xc.length; j++) {
        const diff = xc[i] * xc[j] - S[i][j];
        acc += diff * diff;
      }
    }
  }
  return acc / (centered.length * centered.length || 1);
}

export interface ShrunkCovariance {
  /** the shrunk, well-conditioned estimate Σ = λ·μI + (1−λ)·S. */
  sigma: number[][];
  /** shrinkage intensity λ ∈ [0, 1]; 0 ⇒ raw sample covariance, 1 ⇒ scaled identity. */
  lambda: number;
  /** identity scale μ = trace(S)/p (the average sample variance). */
  mu: number;
}

/**
 * Ledoit-Wolf (2004) shrinkage of the sample covariance toward the scaled-identity target μI,
 * μ = trace(S)/p. The optimal λ̂ minimizes E‖Σ − S_true‖²: it tends to 1 when the off-diagonal
 * sample structure is dominated by estimation noise (→ identity) and to 0 when the structure is
 * real and well-estimated. This both de-noises spurious correlations and guarantees an
 * invertible Σ for the detector's Cholesky.
 */
export function ledoitWolf(rows: readonly number[][]): ShrunkCovariance {
  const n = rows.length;
  const p = n > 0 ? rows[0].length : 0;
  const zeros = (): number[][] => Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const S = sampleCovariance(rows);
  let mu = 0;
  for (let i = 0; i < p; i++) mu += S[i][i];
  mu = mu / (p || 1) || 1; // average sample variance (identity scale); ≥ tiny so the target is PD
  if (n < 2 || p === 0) return { sigma: addToDiagonal(zeros(), mu), lambda: 1, mu };

  // target = μI; d² = ‖S − μI‖²_F (sample's distance from target); b̄² = sampling variance of S.
  // Both S and b̄² are computed from the SAME centered rows (canonical, non-mean-leaking, Ledoit-Wolf).
  const target = addToDiagonal(zeros(), mu);
  const d2 = frobeniusSq(S.map((row, i) => row.map((x, j) => x - target[i][j])));
  const b2 = Math.min(entrywiseDispersion(centerRows(rows), S), d2); // b² ≤ d² (Ledoit-Wolf bound)
  const lambda = d2 > 0 ? b2 / d2 : 1; // all-target ⇒ fully shrink
  const sigma = S.map((row, i) => row.map((x, j) => lambda * target[i][j] + (1 - lambda) * x));
  return { sigma, lambda, mu };
}
