/**
 * Synthetic per-path-class telemetry (v1 spec §3.2, N2/N3: synthetic only, no live fabric).
 *
 * Emits RAW per-tick signal vectors whose baseline is a per-cell SMEAR: the "normal" varies
 * by hour-of-day (diurnal), traffic-class, and signal — deliberately non-unimodal, so the
 * calibration substrate (calibration.ts) has a real smear to characterize before detection.
 * A degradation injected on a shared RESOURCE adds a shift to every path-class that traverses
 * it — the common-mode the tomography must localize.
 */
import { makeRng } from './rng';
import { SIGNALS, signalIndex } from './signals';
import type { SignalVector, SignalName } from './signals';
import { trafficClassOf, HOURS_PER_DAY } from './calibration';
import type { TrafficClass } from './calibration';
import { cholesky } from './covariance';
import type { FaultDomainSnapshot, PathClassId, ResourceId } from './domain';

export interface DegradationSpec {
  resource_id: ResourceId;
  /** magnitude: a mean shift (mode 'mean') or a noise std multiplier (mode 'variance'). */
  delta: number;
  start_tick: number;
  /** which signal degrades (default p99_latency). */
  signal?: SignalName;
  /** 'mean' shifts the signal's level (Family A); 'variance' inflates its noise (Family C). */
  mode?: 'mean' | 'variance';
  /**
   * A full per-signal mean-shift vector (mode 'mean'), applied to affected path-classes instead of
   * the single-signal `delta`. Lets a degradation move several signals jointly — e.g. an
   * anti-correlated shift that violates the learned cross-signal covariance (ADR-0007).
   */
  shiftVector?: number[];
  /**
   * A degraded p×p noise correlation applied to affected path-classes from `start_tick` (ADR-0007):
   * a pure SECOND-ORDER shift — signals keep their marginal mean and variance but their joint
   * co-movement changes (e.g. a +ρ pair flips to −ρ). Invisible to a per-signal mean detector and
   * to an identity-Σ test; only a learned-covariance Family C sees it. Must be positive-definite.
   */
  degradedNoiseCorr?: number[][];
}

export interface TelemetryParams {
  seed: number;
  ticks: number;
  degradation?: DegradationSpec;
  /**
   * Optional p×p correlation matrix for the per-tick noise innovations (ADR-0007). When set, the
   * five signals co-move with this structure; when absent the noise is independent per signal
   * (identity), preserving the v1 byte-for-byte telemetry. Must be positive-definite.
   */
  noiseCorr?: number[][];
  /**
   * Optional per-signal AR coefficient vectors (ADR-0008): signal i's noise follows AR(arCoeffs[i])
   * with unit-variance innovations, instead of the default AR(1) `AR1_PHI`. Lets telemetry emit
   * higher-order temporal memory the AR(p) calibrator must recover. Absent ⇒ the v1 AR(1) stream
   * (byte-for-byte identical). The marginal variance is whatever the AR(p) recursion produces; the
   * per-cell calibration sd standardizes it, so it need not be 1. Coefficients must be **stationary**
   * (no guard — a non-stationary set explodes numerically, though per-cell sd keeps residuals finite).
   */
  arCoeffs?: number[][];
}

export interface Telemetry {
  /** path-class id -> ticks × |SIGNALS| RAW matrix. */
  series: ReadonlyMap<PathClassId, SignalVector[]>;
  ticks: number;
}

/** Per-signal baseline "normal" for a cell — the smear calibration must learn. */
const SIGNAL_BASE = [10, 0.5, 0.1, 0.2, 0.99]; // p99_latency, retransmit, loss, ecmp_imbalance, completion

/**
 * Per-signal AR(1) coefficient of the synthetic noise (real network signals are temporally
 * autocorrelated). The production-AR substrate calibrator estimates and removes this (ADR-0004);
 * left in, it would inflate false positives by breaking the detectors' near-iid assumption.
 */
export const AR1_PHI = [0.5, 0.4, 0.6, 0.3, 0.45];

function rawBaseline(signalIdx: number, hour: number, tc: TrafficClass): number {
  const diurnal = 0.5 * Math.sin((2 * Math.PI * hour) / HOURS_PER_DAY);
  const classOffset = 0.3 * (['interactive', 'bulk', 'storage'].indexOf(tc));
  return (SIGNAL_BASE[signalIdx] ?? 0) + diurnal + classOffset;
}

function affectedPathClasses(snapshot: FaultDomainSnapshot, resourceId: ResourceId): Set<PathClassId> {
  const affected = new Set<PathClassId>();
  for (const e of snapshot.edges) if (e.resource === resourceId) affected.add(e.path_class);
  return affected;
}

/** Cholesky factor of a correlation matrix, or null if absent; throws if present but not PD. */
function choleskyOrThrow(corr: number[][] | undefined, name: string): number[][] | null {
  if (!corr) return null;
  const L = cholesky(corr);
  if (!L) throw new RangeError(`${name} must be positive-definite`);
  return L;
}

/** The innovation Cholesky factor for one tick: the degraded L on affected path-classes from start. */
function tickL(isAffected: boolean, t: number, start: number, Lr: number[][] | null, LrDeg: number[][] | null): number[][] | null {
  return isAffected && LrDeg && t >= start ? LrDeg : Lr;
}

/**
 * One AR(p) recursion step: noise_t = Σ_k coeffs_k·hist_{t-k} + scale·innov. With an empty history
 * (t=0) it returns the bare innovation — a stationary-ish start. For the default AR(1) (one coeff,
 * `unitVar`) the innovation is scaled by √(1−φ²) so the marginal variance is exactly 1, reproducing
 * the v1 noise byte-for-byte; for AR(p) opt-in (`unitVar` false) the innovation is unit-scaled and
 * the per-cell calibration sd absorbs whatever marginal variance the recursion yields.
 */
function arStep(innov: number, coeffs: number[], hist: number[], unitVar: boolean): number {
  if (hist.length === 0) return innov;
  let pred = 0;
  const avail = Math.min(coeffs.length, hist.length);
  for (let k = 0; k < avail; k++) pred += coeffs[k] * hist[hist.length - 1 - k];
  const innovScale = unitVar ? Math.sqrt(Math.max(1 - coeffs[0] * coeffs[0], 1e-9)) : 1;
  return pred + innovScale * innov;
}

/** Correlate an iid draw z into innovation L·z; identity (L=null) returns z unchanged. */
function correlate(z: number[], L: number[][] | null): number[] {
  if (!L) return z;
  return z.map((_, i) => {
    let s = 0;
    for (let k = 0; k <= i; k++) s += L[i][k] * z[k];
    return s;
  });
}

/** Apply a degradation's mean/variance/covariance effect to one already-noised tick vector. */
function degradeVector(
  vec: number[],
  deg: DegradationSpec,
  ctx: { sigIdx: number; mode: 'mean' | 'variance'; hour: number; tc: TrafficClass },
): void {
  if (deg.degradedNoiseCorr) return; // a pure 2nd-order shift — already applied via the innovation L
  if (deg.shiftVector) {
    for (let i = 0; i < vec.length; i++) vec[i] += deg.shiftVector[i]; // joint multivariate mean shift
  } else if (ctx.mode === 'variance') {
    const base = rawBaseline(ctx.sigIdx, ctx.hour, ctx.tc);
    vec[ctx.sigIdx] = base + (vec[ctx.sigIdx] - base) * deg.delta; // inflate noise around the baseline
  } else {
    vec[ctx.sigIdx] += deg.delta; // single-signal mean shift
  }
}

export function generateTelemetry(snapshot: FaultDomainSnapshot, params: TelemetryParams): Telemetry {
  const rng = makeRng(params.seed);
  const deg = params.degradation;
  const sigIdx = signalIndex(deg?.signal ?? 'p99_latency');
  const mode = deg?.mode ?? 'mean';
  const start = deg?.start_tick ?? 0;
  const affected = deg ? affectedPathClasses(snapshot, deg.resource_id) : new Set<PathClassId>();
  const series = new Map<PathClassId, SignalVector[]>();

  const p = SIGNALS.length;
  // Innovation = L·z has covariance L·Lᵀ. Baseline L from noiseCorr (absent ⇒ identity, which
  // reproduces the v1 RNG stream byte-for-byte); affected path-classes swap to the degraded L
  // from start_tick (a second-order degradation).
  const Lr = choleskyOrThrow(params.noiseCorr, 'noiseCorr');
  const LrDeg = choleskyOrThrow(deg?.degradedNoiseCorr, 'degradedNoiseCorr');
  // Per-signal AR coefficients: AR(p) opt-in (arCoeffs) or the default AR(1) (AR1_PHI, unit-variance).
  const unitVar = params.arCoeffs === undefined;
  const arc = SIGNALS.map((_, i) => (params.arCoeffs ? params.arCoeffs[i] : [AR1_PHI[i]]));
  const order = [...snapshot.path_classes].sort();
  for (const pc of order) {
    const tc = trafficClassOf(pc);
    const isAffected = affected.has(pc);
    const matrix: number[][] = [];
    const hist: number[][] = SIGNALS.map(() => []);
    for (let t = 0; t < params.ticks; t++) {
      const hour = t % HOURS_PER_DAY;
      // draw z in signal order (preserves the v1 sequence), then optionally correlate via L.
      const z = new Array<number>(p);
      for (let i = 0; i < p; i++) z[i] = rng.gaussian();
      const innov = correlate(z, tickL(isAffected, t, start, Lr, LrDeg));
      const vec = new Array<number>(p);
      for (let i = 0; i < p; i++) {
        const noise = arStep(innov[i], arc[i], hist[i], unitVar);
        hist[i].push(noise);
        if (hist[i].length > arc[i].length) hist[i].shift(); // keep only the lags the order needs
        vec[i] = rawBaseline(i, hour, tc) + noise;
      }
      if (isAffected && deg && t >= start) degradeVector(vec, deg, { sigIdx, mode, hour, tc });
      matrix.push(vec);
    }
    series.set(pc, matrix);
  }
  return { series, ticks: params.ticks };
}
