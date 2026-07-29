/**
 * The ς̂ dispersion gate (ADR-0051).
 *
 * ADR-0050 measured that e-BH selection validity dies once per-leaf noise-scale dispersion
 * exceeds realized ς ≈ 0.06–0.12 — and that nothing measures ς. This module estimates it from
 * the standardized CALIBRATION residuals the pipeline already computes, debiases the estimation
 * noise, and gates the FDR claim on a threshold set from the measured boundary.
 *
 * Semantics (the GPU sibling's Mode A/B split): a failing gate gates the CLAIM, not the alarm —
 * selection still runs and is still published (evidence/ranking stays useful for triage); the
 * audit records that the FDR-controlled reading of the selection set is withheld.
 */
import type { PathClassId } from './domain';

/** Default gate threshold ς* (ADR-0051): above the debiased sampling floor at the default
 *  operating point (T=60, p=5 ⇒ ≈0.041), below the ADR-0050 measured onset band (0.06–0.12).
 *  Conservative in the safe direction — failing early withholds a claim; failing late launders
 *  an invalid one. Synthetic-boundary-derived; a real deployment must re-derive it (Tier 3). */
export const DEFAULT_SIGMA_THRESHOLD = 0.05;

/** Per-window false gate-trip budget for the max-z bound (ADR-0061): z_max_bound = Φ⁻¹(1 − α/n)
 *  — Bonferroni: CONSERVATIVE (P(trip) ≤ α) under the iid-Gaussian null, approximate in practice
 *  (median-centering inflates deviation variance ≈ (1 + π/2n); the ℓ's share the AR fit and
 *  pooled scale). N-INDEXED FROM THEORY (no fitted curve). */
export const Z_MAX_ALPHA = 0.01;

/**
 * Inverse standard-normal CDF (Acklam's rational approximation, |rel err| < 1.15e-9) — the
 * Bonferroni bound needs Φ⁻¹ at 1 − α/n. Domain (0, 1); throws outside.
 */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`normalQuantile needs p ∈ (0, 1) — got ${p}`);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pLow) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export interface DispersionEstimate {
  /** debiased ROBUST population log-scale dispersion ς̂ = √max(0, raw² − floor) — the
   *  typical-population measure (MAD core). Blind to small dispersed SUBPOPULATIONS by
   *  construction; never gate on it alone (the ADR-0051 cold-eye correction). */
  sigma_hat: number;
  /**
   * Debiased TAIL-SENSITIVE dispersion: the plain (non-robust) sd of the per-leaf pooled
   * log-scales, floor-debiased. A 10%-of-leaves-at-2× contaminated fleet moves THIS while the
   * MAD core sits still — and those tail leaves are exactly the ADR-0050 false-selection
   * source, so for a claim-withholding gate the conservative statistic is this one. The gate
   * binds on max(sigma_hat, sigma_hat_tail).
   */
  sigma_hat_tail: number;
  /** robust (MAD×1.4826) sd of the per-leaf pooled log-scales, BEFORE debias. */
  raw_log_sd: number;
  /** plain sd of the per-leaf pooled log-scales, BEFORE debias (the tail statistic's raw). */
  raw_log_sd_tail: number;
  /**
   * The EXTREME-LEAF statistic (ADR-0061): max one-sided standardized deviation
   * max_i (ℓ_i − median)/√floorVar. Population statistics cannot see the first false selection
   * (it comes from the extreme leaf, whose expected deviation grows √(2 ln n) while ς̂ stays
   * put — the ADR-0059 laundering mechanism); the max, standardized by the SAMPLING FLOOR
   * (not the population sd — a studentized max would re-launder a Gaussian-family extreme,
   * recorded design trap), sees it.
   */
  z_max: number;
  /** the Bonferroni bound Φ⁻¹(1 − Z_MAX_ALPHA/n) — N-indexed from theory, no fitted curve. */
  z_max_bound: number;
  /** the estimation-noise variance removed: 1/(2(T−1)p) — the ς=0 floor. Published so a
   *  floor-dominated short-window estimate is visible as such, never silently ≈0. */
  sampling_floor_sd: number;
  n_leaves: number;
  ticks: number;
  signals: number;
}

export interface DispersionGateVerdict {
  /** true ⇔ max(sigma_hat, sigma_hat_tail) ≤ threshold AND z_max ≤ z_max_bound — the TRIPLE
   *  binding (ADR-0061). The pair is load-bearing against tail subpopulations (ADR-0051
   *  cold-eye); the max-z is load-bearing against the ADR-0059 scale laundering (population
   *  statistics cannot see the extreme leaf whose deviation grows with N). */
  passing: boolean;
  sigma_hat: number;
  sigma_hat_tail: number;
  z_max: number;
  z_max_bound: number;
  threshold: number;
  /** threshold − max(sigma_hat, sigma_hat_tail) (negative when failing) — room left in ς units
   *  on the PAIR half (the z half's room is z_max_bound − z_max, read from the fields). */
  margin: number;
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

/**
 * Estimate ς̂ from standardized calibration residuals (leaf → ticks×signals matrix — exactly what
 * `calibrateForSession` produces). Per leaf: pooled log-scale ℓ_i = mean_j log s_{i,j} (the
 * ADR-0050 model scales all of a leaf's signals by one σ_pc; pooling divides sampling variance
 * by ≈p). Population: ROBUST sd of {ℓ_i} (MAD — genuinely faulty calibration leaves must not
 * inflate the fleet's ς̂), debiased by the iid sampling floor 1/(2(T−1)p). The floor is an
 * approximation (imperfect whitening, cross-signal correlation) — validated empirically at ς=0
 * (test/dispersion-gate.test.ts), not assumed.
 */
/**
 * Per-leaf pooled log-scale from per-signal running sums (Σx, Σx²) over T ticks — the SESSION
 * path (ADR-0053): a session accumulating these in per-tick order produces the exact floats the
 * matrix path produces, so batch ≡ incremental holds bit-for-bit (bound by test).
 */
export function logScaleFromSums(sum: readonly number[], sumsq: readonly number[], T: number): number {
  const p = sum.length;
  let sumLog = 0;
  for (let j = 0; j < p; j++) {
    const mean = sum[j] / T;
    const varJ = Math.max(sumsq[j] / T - mean * mean, 1e-12) * (T / (T - 1));
    sumLog += 0.5 * Math.log(varJ);
  }
  return sumLog / p;
}

/** The ς=0 estimation-noise variance of a per-leaf pooled log-scale: 1/(2(T−1)p). The ONE
 *  definition — the estimator, the monitor and the tail triage all derive from here so a floor
 *  correction can never desynchronize them (ADR-0058 cold-eye finding 5). */
export function samplingFloorVar(ticks: number, signals: number): number {
  return 1 / (2 * (ticks - 1) * signals);
}

/** The population statistics over per-leaf log-scales — shared by the matrix and sums paths.
 *  `logScales` must be in sorted-leaf order (mean/sd float summation is order-sensitive). */
export function dispersionFromLogScales(logScales: readonly number[], ticks: number, signals: number): DispersionEstimate {
  const med = median(logScales);
  const rawLogSd = 1.4826 * median(logScales.map((x) => Math.abs(x - med)));
  const mean = logScales.reduce((a, b) => a + b, 0) / logScales.length;
  const rawSdTail = Math.sqrt(logScales.reduce((a, x) => a + (x - mean) ** 2, 0) / (logScales.length - 1));
  const floorVar = samplingFloorVar(ticks, signals);
  const se = Math.sqrt(floorVar);
  let zMax = -Infinity;
  for (const l of logScales) zMax = Math.max(zMax, (l - med) / se);
  return {
    sigma_hat: Math.sqrt(Math.max(0, rawLogSd * rawLogSd - floorVar)),
    sigma_hat_tail: Math.sqrt(Math.max(0, rawSdTail * rawSdTail - floorVar)),
    raw_log_sd: rawLogSd,
    raw_log_sd_tail: rawSdTail,
    z_max: zMax,
    z_max_bound: normalQuantile(1 - Z_MAX_ALPHA / logScales.length),
    sampling_floor_sd: se,
    n_leaves: logScales.length,
    ticks,
    signals,
  };
}

/** Per-leaf pooled log-scales over a residual map, in SORTED leaf order (the shared front half
 *  of estimateDispersion and tail triage, ADR-0058). Validates dimensions; returns (ticks,
 *  signals) so callers form the matching sampling floor. */
export function pooledLogScales(residuals: ReadonlyMap<PathClassId, ReadonlyArray<readonly number[]>>): { ells: Map<PathClassId, number>; ticks: number; signals: number } {
  if (residuals.size < 2) throw new RangeError(`pooledLogScales needs ≥ 2 leaves — got ${residuals.size}`);
  const ells = new Map<PathClassId, number>();
  let ticks = 0;
  let signals = 0;
  for (const pc of [...residuals.keys()].sort()) {
    const m = residuals.get(pc)!;
    const T = m.length;
    const p = m[0]?.length ?? 0;
    if (T < 3 || p < 1) throw new RangeError(`pooledLogScales: leaf ${pc} has a degenerate residual matrix (${T}×${p})`);
    if (ticks !== 0 && (T !== ticks || p !== signals)) throw new RangeError(`pooledLogScales: ragged residual map (leaf ${pc} is ${T}×${p}, expected ${ticks}×${signals}) — the sampling floor would be wrong`);
    ticks = T;
    signals = p;
    const sum = new Array<number>(p).fill(0);
    const sumsq = new Array<number>(p).fill(0);
    for (let t = 0; t < T; t++) {
      for (let j = 0; j < p; j++) {
        sum[j] += m[t][j];
        sumsq[j] += m[t][j] * m[t][j];
      }
    }
    ells.set(pc, logScaleFromSums(sum, sumsq, T));
  }
  return { ells, ticks, signals };
}

export function estimateDispersion(residuals: ReadonlyMap<PathClassId, ReadonlyArray<readonly number[]>>): DispersionEstimate {
  const { ells, ticks, signals } = pooledLogScales(residuals);
  return dispersionFromLogScales([...ells.values()], ticks, signals);
}

/** Apply the threshold to the PAIR. Pure and total: the verdict is data, the caller decides
 *  nothing here. Binding on max(robust, tail) is the cold-eye-corrected rule: robust-only
 *  launders tail-contaminated fleets (the anti-conservative direction). */
export function dispersionGate(est: DispersionEstimate, threshold = DEFAULT_SIGMA_THRESHOLD): DispersionGateVerdict {
  if (!(threshold > 0)) throw new RangeError(`dispersionGate threshold must be > 0 — got ${threshold}`);
  const binding = Math.max(est.sigma_hat, est.sigma_hat_tail);
  return {
    passing: binding <= threshold && est.z_max <= est.z_max_bound,
    sigma_hat: est.sigma_hat,
    sigma_hat_tail: est.sigma_hat_tail,
    z_max: est.z_max,
    z_max_bound: est.z_max_bound,
    threshold,
    margin: threshold - binding,
  };
}
