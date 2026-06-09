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

/** A Family C cell for standardized residuals (Σ = I_p). */
export function makeFamilyCCell(p: number, alphaC: number, tauSquared: number = DEFAULT_TAU_SQUARED): FamilyCPerCell {
  return {
    mean_vector: new Array<number>(p).fill(0),
    covariance: identityCovariance(p),
    hotelling_variant: 'safe_test',
    safe_hotelling_params: {
      tau_squared: tauSquared,
      alpha: alphaC,
      precompiled_log_det_shrink: (p / 2) * Math.log(1 + tauSquared),
      shrink_fraction: tauSquared / (1 + tauSquared),
    },
  };
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
