/**
 * Family C (distributional) detector wrapper (v1 spec AC-2b).
 *
 * Reuses the engine's Safe-Hotelling sequential e-process — a multivariate, anytime-valid
 * test of distributional shift over the full per-path-class signal vector (vs Family A's
 * per-signal mean-shift). No detector math here; only the cell construction.
 *
 * Residuals are per-cell standardized (AC-7) so the baseline covariance is the identity
 * Σ = I_p. The Safe-Hotelling shrink constant then has the exact closed form
 *   precompiled_log_det_shrink = ½ · log( det(Σ+τ²I) / det(Σ) ) = (p/2) · log(1+τ²).
 */
import {
  freshSafeHotellingState,
  evaluateSafeHotelling,
} from '@johnpatrickwarren-oss/deploysignal-engine/detectors/hotelling';
import type { FamilyCPerCell } from '@johnpatrickwarren-oss/deploysignal-engine/types/families/c';
import { SIGNALS } from './signals';
import type { SignalVector } from './signals';
import type { PathClassId } from './domain';
import { logDet, addToDiagonal, ledoitWolf } from './covariance';
import type { ShrunkCovariance } from './covariance';

/** Mixture-prior variance per dimension (sensitivity knob). */
export const DEFAULT_TAU_SQUARED = 1.0;

export function identityCovariance(p: number): number[][] {
  const m: number[][] = [];
  for (let i = 0; i < p; i++) {
    const row = new Array<number>(p).fill(0);
    row[i] = 1;
    m.push(row);
  }
  return m;
}

/** A Family C cell for standardized residuals with an identity baseline (Σ = I_p). */
export function makeFamilyCCell(p: number, alphaC: number, tauSquared: number = DEFAULT_TAU_SQUARED): FamilyCPerCell {
  return {
    mean_vector: new Array<number>(p).fill(0),
    covariance: identityCovariance(p),
    hotelling_variant: 'safe_test',
    safe_hotelling_params: {
      tau_squared: tauSquared,
      alpha: alphaC,
      // ½·log(det(I+τ²I)/det(I)) = (p/2)·log(1+τ²) — the closed form of the general term below.
      precompiled_log_det_shrink: (p / 2) * Math.log(1 + tauSquared),
      shrink_fraction: tauSquared / (1 + tauSquared),
    },
  };
}

/**
 * A Family C cell over a LEARNED baseline covariance Σ (ADR-0007). The Safe-Hotelling z-update is
 *   z_t = −precompiled_log_det_shrink + ½·xᵀΣ⁻¹x − ½·xᵀ(Σ+τ²I)⁻¹x,
 * so the constant MUST be recomputed for the real Σ: precompiled_log_det_shrink =
 * ½·log(det(Σ+τ²I)/det(Σ)). With Σ≠I the Mahalanobis term xᵀΣ⁻¹x rewards shifts that violate the
 * learned cross-signal co-movement (a small-Euclidean-norm but high-Mahalanobis anti-correlated
 * shift) which the identity cell, depending only on ‖x‖², cannot see.
 */
export function makeFamilyCCellFromCovariance(
  covariance: number[][],
  alphaC: number,
  tauSquared: number = DEFAULT_TAU_SQUARED,
): FamilyCPerCell {
  const p = covariance.length;
  // Σ from Ledoit-Wolf is positive-definite (λμI with μ>0 added to a PSD sample cov). The ridge is
  // a defensive net for a NEAR-singular (PSD-but-rank-deficient) Σ; it cannot fix a genuinely
  // indefinite Σ — that case can't arise from LW, and if a caller forces one ld0 falls back to 0
  // (the constant is then unused: the engine's own Cholesky suppresses on a non-PD Σ).
  let sigma = covariance;
  let ld0 = logDet(sigma);
  if (ld0 === null) {
    sigma = addToDiagonal(sigma, 1e-9);
    ld0 = logDet(sigma) ?? 0;
  }
  const ldTau = logDet(addToDiagonal(sigma, tauSquared)) ?? ld0; // Σ+τ²I is PD whenever τ²>0
  return {
    mean_vector: new Array<number>(p).fill(0),
    covariance: sigma,
    hotelling_variant: 'safe_test',
    safe_hotelling_params: {
      tau_squared: tauSquared,
      alpha: alphaC,
      precompiled_log_det_shrink: 0.5 * (ldTau - ld0),
      shrink_fraction: tauSquared / (1 + tauSquared),
    },
  };
}

/**
 * Learn the Family C baseline covariance from clean calibration residuals (global, pooled over
 * all path-classes and ticks). Ledoit-Wolf shrinkage gives a well-conditioned, invertible Σ and
 * collapses spurious off-diagonals toward identity, so uncorrelated signals recover Σ≈I.
 */
export function estimateBaselineCovariance(residuals: ReadonlyMap<PathClassId, number[][]>): ShrunkCovariance {
  const rows: number[][] = [];
  for (const series of residuals.values()) for (const v of series) rows.push(v);
  return ledoitWolf(rows);
}

export interface FamilyCResult {
  e_value: number;
  fired: boolean;
  alpha_spent: number;
}

/** Run Safe-Hotelling over a path-class's full residual-vector stream. */
export function runFamilyC(series: readonly SignalVector[], alphaC: number, cell?: FamilyCPerCell): FamilyCResult {
  const c = cell ?? makeFamilyCCell(SIGNALS.length, alphaC);
  const state = freshSafeHotellingState();
  for (const vec of series) {
    evaluateSafeHotelling({ cell: c, alpha: alphaC }, [...vec], state);
  }
  return { e_value: state.M, fired: state.M >= 1 / alphaC, alpha_spent: state.alphaConsumed };
}
