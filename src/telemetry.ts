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
import { epochIndexAt } from './epoch';
import type { SnapshotEpoch } from './epoch';
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
  /**
   * A periodic oscillation injected into the degraded `signal` of affected path-classes from
   * `start_tick` (ADR-0009): `oscillationAmp·sin(2π·t/oscillationPeriod)` replaces an equal slice of
   * the white noise variance, so the marginal mean AND variance are unchanged — a pure SPECTRAL
   * shift. Invisible to Family A (zero-mean) and Family C (unchanged magnitude); only Family D's
   * windowed-ACF detector sees the temporal periodicity. Avoid period 24 (the per-cell hour-of-day
   * baseline fully absorbs it) and 12 (partially absorbed); other periods in the lag band are fine.
   */
  oscillationPeriod?: number;
  oscillationAmp?: number;
}

/**
 * Per-leaf noise-scale heterogeneity (ADR-0050): a STATIC multiplier σ_pc = exp(sigmaLogSd·g_pc)
 * on the noise of ALL of a leaf's signals (baselines/means untouched), g_pc ~ N(0,1) drawn from a
 * dedicated RNG seeded by (seed ⊕ hash(path-class id)) — deterministic per leaf, independent of
 * the tick loop, the main RNG stream, and the population's composition. `sigmaLogSd` IS the
 * population log-scale dispersion ς. This is baseline STRUCTURE (like noiseCorr/arCoeffs): fabric
 * physics, present in calibration and live windows alike — the shared-cell calibration substrate
 * (cellKey has no path-class in it) cannot represent it, which is the point under study.
 *
 * Drift (the cal/monitor mismatch axis): g_pc(m) = √(1−m²)·g_base + m·g_new, with g_new drawn
 * from (driftSeed ⊕ hash(pc)) and m = driftMix ∈ [0,1]. The marginal stays N(0,1) at every m —
 * drift moves WHICH leaves are noisy, never how dispersed the population is. driftMix 0 (the
 * default) is exactly g_base.
 */
export interface HeterogeneitySpec {
  /** population log-scale dispersion ς ≥ 0. 0 ⇒ σ_pc = 1 for every leaf (byte-identical). */
  sigmaLogSd: number;
  /** base draw seed (default 0x5e7e0). */
  seed?: number;
  /** cal/monitor drift mix m ∈ [0,1] (default 0 = no drift). */
  driftMix?: number;
  /** seed for the drift target draw (default base seed ⊕ 0xd41f7). */
  driftSeed?: number;
}

/**
 * Correlated-null structure (ADR-0050): independent per-resource AR(1) factors λ_r(t) (unit
 * marginal variance, coefficient `phi`), drawn from a dedicated RNG per resource, injected into
 * every traversing leaf's PRIMARY signal (p99_latency) as load·Σ_r w(pc,r)·λ_r(t) — the null
 * correlated through shared hardware via the SAME weighted incidence that propagates faults.
 * Baseline structure: present in calibration and live windows alike. load 0 ⇒ byte-identical.
 * Unsupported with `epochs` (incidence is epoch-dependent) — throws, recorded narrowing.
 */
export interface LatentNullSpec {
  /** factor loading ≥ 0 in noise-σ units per unit incidence weight. */
  load: number;
  /** AR(1) coefficient of each λ_r stream, in (−1, 1) (default 0.5). */
  phi?: number;
}

export interface TelemetryParams {
  seed: number;
  ticks: number;
  degradation?: DegradationSpec;
  /**
   * SIMULTANEOUS degradations (ADR-0021): each entry carries its own resource/δ/start/signal/
   * mode and applies in ARRAY ORDER per tick (mean shifts add). The noise stream is untouched by
   * how many degradations exist. `degradations: [x]` is byte-identical to `degradation: x`;
   * supplying BOTH throws; at most one entry may carry `degradedNoiseCorr` (the innovation
   * Cholesky swap is a whole-vector transform — composing two has no defined semantics here).
   */
  degradations?: readonly DegradationSpec[];
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
  /**
   * Epoch'd incidence sequence (ADR-0017): when set, the degradation's affected set follows the
   * ACTIVE epoch per tick — a leaf rerouted off the faulty resource stops shifting at the epoch
   * boundary (and one rerouted onto it starts). Epoch snapshots must share the static `snapshot`'s
   * path-class population (a reroute preserves it). The noise process (RNG stream, AR history,
   * baselines) is deliberately CONTINUOUS across epochs — a reroute changes routing, not the
   * physics of the fabric. Absent ⇒ the static snapshot every tick, byte-identical v1.
   */
  epochs?: readonly SnapshotEpoch[];
  /** per-leaf noise-scale heterogeneity (ADR-0050). Absent or sigmaLogSd 0 ⇒ byte-identical. */
  heterogeneity?: HeterogeneitySpec;
  /** correlated-null latent factors (ADR-0050). Absent or load 0 ⇒ byte-identical; throws with epochs. */
  latentNull?: LatentNullSpec;
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

/** Path-classes traversing a resource, mapped to their traffic weight w(pc, r) ∈ (0, 1] (ADR-0014). */
function affectedWeights(snapshot: FaultDomainSnapshot, resourceId: ResourceId): Map<PathClassId, number> {
  const affected = new Map<PathClassId, number>();
  for (const e of snapshot.edges) if (e.resource === resourceId) affected.set(e.path_class, e.weight ?? 1);
  return affected;
}

/** Normalize the degradation surface (ADR-0021): singular and plural are exclusive. */
function normalizeDegradations(params: TelemetryParams): DegradationSpec[] {
  if (params.degradation && params.degradations) throw new RangeError('supply degradation OR degradations, not both');
  const degs = params.degradations ? [...params.degradations] : params.degradation ? [params.degradation] : [];
  if (degs.filter((d) => d.degradedNoiseCorr).length > 1) {
    throw new RangeError('at most one degradation may carry degradedNoiseCorr');
  }
  return degs;
}

/** One degradation's per-tick context: resolved signal/mode/start + per-epoch affected weights (ADR-0017/0021). */
interface DegCtx {
  deg: DegradationSpec;
  sigIdx: number;
  mode: 'mean' | 'variance';
  start: number;
  affectedBy: Map<PathClassId, number>[];
}

/**
 * Per-degradation contexts + the active-epoch resolver. With no epochs each context holds a
 * single constant map over the static snapshot — the byte-identical v1 path.
 */
function buildDegCtxs(
  snapshot: FaultDomainSnapshot,
  degs: readonly DegradationSpec[],
  epochsIn: readonly SnapshotEpoch[] | undefined,
): { ctxs: DegCtx[]; epochOf: (t: number) => number } {
  const epochs = epochsIn?.length ? epochsIn : null;
  const snapshots = epochs ? epochs.map((e) => e.snapshot) : [snapshot];
  // ADR-0064 cold-eye CRITICAL guard: a degradation naming a resource ABSENT from the snapshot
  // used to no-op SILENTLY — clean telemetry masquerading as a faulted run, which manufactured
  // a false "correction" in a published measurement (a typo'd resource id). Fail loudly.
  const known = new Set(snapshot.resources.map((r) => r.id));
  for (const d of degs) {
    if (!known.has(d.resource_id)) throw new RangeError(`degradation resource '${d.resource_id}' is not in the snapshot (${known.size} resources) — a silent no-op here fabricates clean data as a faulted run (ADR-0064)`);
  }
  const ctxs = degs.map((deg) => ({
    deg,
    sigIdx: signalIndex(deg.signal ?? 'p99_latency'),
    mode: deg.mode ?? ('mean' as const),
    start: deg.start_tick ?? 0,
    affectedBy: snapshots.map((s) => affectedWeights(s, deg.resource_id)),
  }));
  return { ctxs, epochOf: (t: number) => (epochs ? epochIndexAt(epochs, t) : 0) };
}

/** Apply every degradation affecting this leaf at this tick, in array order (ADR-0021). The
 *  accumulated mean shift is threaded so 2nd-order modes center on the true current mean. */
function applyDegradations(vec: number[], ctxs: readonly DegCtx[], pc: PathClassId, e: number, t: number, hour: number, tc: TrafficClass): void {
  const meanShift = new Array<number>(vec.length).fill(0);
  for (const c of ctxs) {
    const w = c.affectedBy[e].get(pc);
    if (w !== undefined && t >= c.start) degradeVector(vec, c.deg, { sigIdx: c.sigIdx, mode: c.mode, hour, tc, t, weight: w, meanShift });
  }
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

/**
 * Apply a degradation's mean/variance/covariance/spectral effect to one already-noised tick vector.
 * The mean-shift magnitude is DILUTED by the leaf's traffic weight `ctx.weight` ∈ (0, 1] (ADR-0014):
 * a fault on a resource shifts a leaf by `delta·w`, the honest Spraypoint dilution. Weight 1 (the v1
 * binary fabric) ⇒ byte-identical. The 2nd-order modes (variance/covariance/oscillation) run on the
 * weight-1 demo fabric, so they are not diluted here.
 *
 * MULTI-FAULT composition (ADR-0021, corrected by the round-5 cold-eye): the 2nd-order modes
 * center on the baseline PLUS the mean shift accumulated by other degradations this tick
 * (`ctx.meanShift`) — a variance/oscillation fault inflates/reshapes the NOISE, never a
 * co-occurring fault's mean shift, and mean × 2nd-order composition is order-independent.
 * (Two 2nd-order modes on the SAME signal of the same leaf remain order-sensitive — recorded.)
 */
function degradeVector(
  vec: number[],
  deg: DegradationSpec,
  ctx: { sigIdx: number; mode: 'mean' | 'variance'; hour: number; tc: TrafficClass; t: number; weight: number; meanShift: number[] },
): void {
  if (deg.degradedNoiseCorr) return; // a pure 2nd-order shift — already applied via the innovation L
  if (deg.oscillationPeriod) {
    // swap a slice of the white noise for a coherent oscillation — mean and variance unchanged.
    const center = rawBaseline(ctx.sigIdx, ctx.hour, ctx.tc) + ctx.meanShift[ctx.sigIdx];
    const amp = deg.oscillationAmp ?? 0;
    const osc = amp * Math.sin((2 * Math.PI * ctx.t) / deg.oscillationPeriod);
    vec[ctx.sigIdx] = center + osc + Math.sqrt(Math.max(1 - (amp * amp) / 2, 0)) * (vec[ctx.sigIdx] - center);
    return;
  }
  if (deg.shiftVector) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] += deg.shiftVector[i] * ctx.weight; // diluted joint mean shift
      ctx.meanShift[i] += deg.shiftVector[i] * ctx.weight;
    }
  } else if (ctx.mode === 'variance') {
    const center = rawBaseline(ctx.sigIdx, ctx.hour, ctx.tc) + ctx.meanShift[ctx.sigIdx];
    vec[ctx.sigIdx] = center + (vec[ctx.sigIdx] - center) * deg.delta; // inflate noise around the (shifted) mean
  } else {
    vec[ctx.sigIdx] += deg.delta * ctx.weight; // diluted single-signal mean shift
    ctx.meanShift[ctx.sigIdx] += deg.delta * ctx.weight;
  }
}

/** The 31-multiplier string hash (same family as `trafficClassOf`'s) — per-id RNG seeding. */
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

/** Default heterogeneity draw seed / drift-seed salt (ADR-0050) — exported so the boundary tool
 *  can run the drift CONTROL (the m=1 σ-set as a base draw) without duplicating the constants. */
export const HET_BASE_SEED = 0x5e7e0;
export const HET_DRIFT_SALT = 0xd41f7;
const LATENT_SALT = 0x1a7e17;

/** Validate the ADR-0050 structure params; throws RangeError on any out-of-domain value. */
function validateStructure(params: TelemetryParams): void {
  const het = params.heterogeneity;
  if (het) {
    if (!(het.sigmaLogSd >= 0)) throw new RangeError(`heterogeneity.sigmaLogSd must be ≥ 0 — got ${het.sigmaLogSd}`);
    const m = het.driftMix ?? 0;
    if (!(m >= 0 && m <= 1)) throw new RangeError(`heterogeneity.driftMix must be in [0, 1] — got ${m}`);
  }
  const ln = params.latentNull;
  if (ln) {
    if (!(ln.load >= 0)) throw new RangeError(`latentNull.load must be ≥ 0 — got ${ln.load}`);
    const phi = ln.phi ?? 0.5;
    if (!(phi > -1 && phi < 1)) throw new RangeError(`latentNull.phi must be in (−1, 1) — got ${phi}`);
    if (params.epochs?.length) throw new RangeError('latentNull with epochs is unsupported (ADR-0050 recorded narrowing)');
  }
}

/** σ_pc = exp(ς·g_pc) with the drift mix applied (ADR-0050). het absent or ς = 0 ⇒ exactly 1. */
function leafSigma(pc: PathClassId, het: HeterogeneitySpec | undefined): number {
  if (!het || het.sigmaLogSd === 0) return 1;
  const base = het.seed ?? HET_BASE_SEED;
  const gBase = makeRng((base ^ hashId(pc)) >>> 0).gaussian();
  const m = het.driftMix ?? 0;
  const g = m === 0 ? gBase : Math.sqrt(1 - m * m) * gBase + m * makeRng(((het.driftSeed ?? base ^ HET_DRIFT_SALT) ^ hashId(pc)) >>> 0).gaussian();
  return Math.exp(het.sigmaLogSd * g);
}

/**
 * Per-leaf latent-null contribution to the primary signal: contrib[pc][t] = load·Σ_r w(pc,r)·λ_r(t)
 * (ADR-0050). Each λ_r is a stationary unit-variance AR(1) stream from a dedicated RNG seeded by
 * (telemetry seed ⊕ LATENT_SALT ⊕ hash(resource id)) — the main RNG stream is untouched, so
 * load 0 (which returns null here) is byte-identical, not just approximately clean.
 */
function buildLatentContrib(snapshot: FaultDomainSnapshot, ln: LatentNullSpec | undefined, seed: number, ticks: number): Map<PathClassId, Float64Array> | null {
  if (!ln || ln.load === 0) return null;
  const phi = ln.phi ?? 0.5;
  const innovScale = Math.sqrt(1 - phi * phi);
  const contrib = new Map<PathClassId, Float64Array>();
  for (const pc of snapshot.path_classes) contrib.set(pc, new Float64Array(ticks));
  const members = new Map<ResourceId, { pc: PathClassId; w: number }[]>();
  for (const e of snapshot.edges) {
    if (!members.has(e.resource)) members.set(e.resource, []);
    members.get(e.resource)!.push({ pc: e.path_class, w: e.weight ?? 1 });
  }
  for (const r of [...members.keys()].sort()) {
    const rng = makeRng((seed ^ LATENT_SALT ^ hashId(r)) >>> 0);
    const lam = new Float64Array(ticks);
    for (let t = 0; t < ticks; t++) lam[t] = t === 0 ? rng.gaussian() : phi * lam[t - 1] + innovScale * rng.gaussian();
    for (const { pc, w } of members.get(r)!) {
      const row = contrib.get(pc);
      if (!row) continue; // an edge to a path-class outside the population — validated elsewhere
      const scaled = ln.load * w;
      for (let t = 0; t < ticks; t++) row[t] += scaled * lam[t];
    }
  }
  return contrib;
}

export function generateTelemetry(snapshot: FaultDomainSnapshot, params: TelemetryParams): Telemetry {
  validateStructure(params);
  const rng = makeRng(params.seed);
  const { ctxs, epochOf } = buildDegCtxs(snapshot, normalizeDegradations(params), params.epochs);
  // ADR-0050 baseline structure: per-leaf σ multipliers + correlated-null latent contribution.
  const latentContrib = buildLatentContrib(snapshot, params.latentNull, params.seed, params.ticks);
  const primaryIdx = signalIndex('p99_latency');
  // the (at most one, validated) degradation carrying the second-order correlation swap.
  const corrCtx = ctxs.find((c) => c.deg.degradedNoiseCorr) ?? null;
  const series = new Map<PathClassId, SignalVector[]>();

  const p = SIGNALS.length;
  // Innovation = L·z has covariance L·Lᵀ. Baseline L from noiseCorr (absent ⇒ identity, which
  // reproduces the v1 RNG stream byte-for-byte); affected path-classes swap to the degraded L
  // from start_tick (a second-order degradation).
  const Lr = choleskyOrThrow(params.noiseCorr, 'noiseCorr');
  const LrDeg = choleskyOrThrow(corrCtx?.deg.degradedNoiseCorr, 'degradedNoiseCorr');
  // Per-signal AR coefficients: AR(p) opt-in (arCoeffs) or the default AR(1) (AR1_PHI, unit-variance).
  const unitVar = params.arCoeffs === undefined;
  const arc = SIGNALS.map((_, i) => (params.arCoeffs ? params.arCoeffs[i] : [AR1_PHI[i]]));
  const order = [...snapshot.path_classes].sort();
  for (const pc of order) {
    const tc = trafficClassOf(pc);
    // per-leaf noise scale (ADR-0050): exactly 1 when heterogeneity is absent/zero, and 1·x === x
    // in IEEE arithmetic, so the byte-identity guarantee is exact.
    const sigma = leafSigma(pc, params.heterogeneity);
    const latentRow = latentContrib?.get(pc);
    const matrix: number[][] = [];
    const hist: number[][] = SIGNALS.map(() => []);
    for (let t = 0; t < params.ticks; t++) {
      const hour = t % HOURS_PER_DAY;
      // affected sets follow the ACTIVE epoch (ADR-0017); constant when no epochs are given.
      const e = epochOf(t);
      const corrOn = corrCtx !== null && corrCtx.affectedBy[e].get(pc) !== undefined;
      // draw z in signal order (preserves the v1 sequence), then optionally correlate via L.
      const z = new Array<number>(p);
      for (let i = 0; i < p; i++) z[i] = rng.gaussian();
      const innov = correlate(z, tickL(corrOn, t, corrCtx?.start ?? 0, Lr, LrDeg));
      const vec = new Array<number>(p);
      for (let i = 0; i < p; i++) {
        const noise = arStep(innov[i], arc[i], hist[i], unitVar);
        hist[i].push(noise);
        if (hist[i].length > arc[i].length) hist[i].shift(); // keep only the lags the order needs
        // σ scales the NOISE only (a static per-leaf AR innovation-sd multiplier); the AR history
        // stays raw so temporal structure is exactly preserved (ADR-0050).
        vec[i] = rawBaseline(i, hour, tc) + sigma * noise;
      }
      // correlated-null latent contribution on the primary signal (ADR-0050), added BEFORE
      // degradations: λ is null NOISE, so a variance-mode fault (which inflates vec − center)
      // scales it along with the leaf's own noise — deliberate, recorded semantics.
      if (latentRow) vec[primaryIdx] += latentRow[t];
      applyDegradations(vec, ctxs, pc, e, t, hour, tc);
      matrix.push(vec);
    }
    series.set(pc, matrix);
  }
  return { series, ticks: params.ticks };
}
