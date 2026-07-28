/**
 * Runtime drift monitor (ADR-0053) — the ADR-0051 dispersion estimator pointed at the LIVE
 * window, and the detector the ADR-0052 cliff was recorded as not having.
 *
 * The gate (dispersion-gate.ts) reads the CALIBRATION window and cannot see staleness — a
 * re-calibration refits the per-leaf corrections and zeroes the signal (ADR-0052 finding-2
 * correction). Stale-correction dispersion, and any dispersion that ARISES after calibration,
 * lives in exactly one place: the live residuals. This module reads them.
 *
 * Verdict semantics: three states, because a short window is not a clean window —
 * `indeterminate` (the sampling floor at this tick count cannot resolve a boundary-scale ς;
 * an early audit must not read as 'ok'), `drifted`, `ok`. The FDR-claim composition rule
 * (recorded in ADR-0053/VALIDATION): licensed ⇔ gate passing AND monitor 'ok'. Selections are
 * never suppressed (claim, not alarm — the ADR-0051 rule).
 */
import { DEFAULT_SIGMA_THRESHOLD } from './dispersion-gate';
import type { DispersionEstimate } from './dispersion-gate';

export type DriftStatus = 'ok' | 'drifted' | 'indeterminate';

export interface DriftMonitorVerdict {
  status: DriftStatus;
  /**
   * Attribution when drifted: 'fleet' — the ROBUST ς̂ exceeds the threshold (fleet-wide scale
   * mismatch: stale per-leaf corrections and shared-calibration drift both land here — the
   * recalibrate-now signal); 'tail' — only the tail statistic fired (a dispersed subpopulation:
   * localized variance-mode faults and subpopulation drift are INDISTINGUISHABLE here —
   * recorded, ADR-0053 §2; the claim is withheld either way, only the operator action differs).
   */
  pattern: 'fleet' | 'tail' | null;
  sigma_hat: number;
  sigma_hat_tail: number;
  threshold: number;
  sampling_floor_sd: number;
  ticks: number;
  n_leaves: number;
}

/** Apply the three-state rule to a live-window estimate. Pure and total (the ADR-0051 rule:
 *  the verdict is data; the caller decides nothing here). */
export function driftMonitor(est: DispersionEstimate, threshold = DEFAULT_SIGMA_THRESHOLD): DriftMonitorVerdict {
  if (!(threshold > 0)) throw new RangeError(`driftMonitor threshold must be > 0 — got ${threshold}`);
  const status: DriftStatus =
    est.sampling_floor_sd >= threshold ? 'indeterminate' : Math.max(est.sigma_hat, est.sigma_hat_tail) > threshold ? 'drifted' : 'ok';
  const pattern = status === 'drifted' ? (est.sigma_hat > threshold ? ('fleet' as const) : ('tail' as const)) : null;
  return {
    status,
    pattern,
    sigma_hat: est.sigma_hat,
    sigma_hat_tail: est.sigma_hat_tail,
    threshold,
    sampling_floor_sd: est.sampling_floor_sd,
    ticks: est.ticks,
    n_leaves: est.n_leaves,
  };
}

/** The degenerate-window verdict (t < 3: no variance estimate exists). `sampling_floor_sd: 1`
 *  is a documented sentinel — "unresolvable at any threshold in (0, 1]" — chosen over NaN or
 *  Infinity because the audit must survive JSON round-trips losslessly (ADR-0053 §3). */
export function degenerateDriftVerdict(threshold: number, ticks: number, nLeaves: number): DriftMonitorVerdict {
  if (!(threshold > 0)) throw new RangeError(`driftMonitor threshold must be > 0 — got ${threshold}`);
  return { status: 'indeterminate', pattern: null, sigma_hat: 0, sigma_hat_tail: 0, threshold, sampling_floor_sd: 1, ticks, n_leaves: nLeaves };
}
