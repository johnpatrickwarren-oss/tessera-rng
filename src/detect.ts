/**
 * Per-path-class anytime-valid detection (v1 spec AC-2a + AC-2b).
 *
 * Runs BOTH families per path-class, reused wholesale from the engine (no detector math here):
 *   - Family A (mean-shift): betting e-process over the standardized p99_latency residual.
 *   - Family C (distributional): Safe-Hotelling e-process over the full residual vector.
 *
 * Each family's α-budget (allocated + spent) is carried into the verdict, and thence the
 * audit record. The combined per-path e-value is the AVERAGE of the family e-values —
 * averaging e-values is valid under arbitrary dependence (the two families share data).
 */
import {
  freshBettingState,
  updateBettingState,
} from '@johnpatrickwarren-oss/deploysignal-engine/detectors/betting-e-process';
import { runFamilyC } from './family-c';
import { SIGNALS } from './signals';
import type { SignalVector } from './signals';
import type { PathClassId } from './domain';
import type { PathClassVerdict, DetectorResult } from './verdict';

export interface DetectParams {
  /** per-tick α for the Family A betting e-process. */
  alphaA: number;
  /** per-tick α for the Family C Safe-Hotelling e-process. */
  alphaC: number;
}

export const DEFAULT_DETECT: DetectParams = { alphaA: 0.01, alphaC: 0.01 };

/**
 * Family A (mean-shift) over ALL signals (ADR-0003): one betting e-process per signal, family
 * e-value = mean of per-signal e-values. Averaging e-values preserves the e-value property under
 * arbitrary dependence, so the family fires validly at M ≥ 1/α_A and a mean shift on ANY signal
 * is caught — at the honest cost of an ≈p× higher single-signal detection floor.
 */
function runFamilyA(series: readonly SignalVector[], alphaA: number): DetectorResult {
  const p = SIGNALS.length;
  const states = SIGNALS.map(() => freshBettingState());
  const M = new Array<number>(p).fill(1);
  for (const vec of series) {
    for (let i = 0; i < p; i++) {
      M[i] = updateBettingState(states[i], vec[i], /*baselineMean*/ 0, /*sigma^2*/ 1, alphaA);
    }
  }
  const familyE = M.reduce((s, x) => s + x, 0) / p;
  // α is booked as spent iff the family rejects (spent-on-fire), matching Family C; the engine's
  // betting state.alphaConsumed is a cumulative per-tick allocation and is deliberately not used.
  const fired = familyE >= 1 / alphaA;
  return { family: 'A', e_value: familyE, fired, alpha_allocated: alphaA, alpha_spent: fired ? alphaA : 0 };
}

export function detectPathClass(
  pathClassId: PathClassId,
  series: readonly SignalVector[],
  params: DetectParams = DEFAULT_DETECT,
): PathClassVerdict {
  const a = runFamilyA(series, params.alphaA);
  const c = runFamilyC(series, params.alphaC);
  const cResult: DetectorResult = {
    family: 'C',
    e_value: c.e_value,
    fired: c.fired,
    alpha_allocated: params.alphaC,
    alpha_spent: c.alpha_spent,
  };
  const detectors: DetectorResult[] = [a, cResult];
  return {
    path_class_id: pathClassId,
    detectors,
    e_value: (a.e_value + c.e_value) / 2,
    fired: a.fired || c.fired,
    alpha_spent: a.alpha_spent + c.alpha_spent,
  };
}

/** Detect across all path-classes in canonical order. */
export function detectAll(
  series: ReadonlyMap<PathClassId, SignalVector[]>,
  params: DetectParams = DEFAULT_DETECT,
): PathClassVerdict[] {
  const ids = [...series.keys()].sort();
  return ids.map((id) => detectPathClass(id, series.get(id)!, params));
}
