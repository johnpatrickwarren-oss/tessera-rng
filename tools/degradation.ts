/**
 * Synthetic sensitivity / degradation harness (ADR-0032).
 *
 * Perturbs the telemetry the detection stack SEES — never the stack itself — and re-measures
 * detection/attribution as each perturbation intensifies. The stack under test (calibration →
 * detect → surface → tomography → drain) is unchanged: this file reuses the EXPORTED pipeline
 * building blocks (`calibrateForSession`, `generateTelemetry`, `standardizeAll`, `detectAll`,
 * `assembleAudit`) and inserts a transform between telemetry generation and standardization
 * (series-level axes) or on the localizer's incidence weights (snapshot-level axis). At zero
 * intensity it reproduces `runPipeline`'s NON-epoch path byte-for-byte — the anti-self-confirming
 * anchor (test/degradation.test.ts). Reroutes/epochs are out of scope here (a hard error).
 *
 * Honest scope (DISCIPLINES §7; VALIDATION.md): synthetic only. This characterizes where the
 * SYNTHETIC model breaks down under telemetry degradation — Tier-2 evidence, not a claim about
 * real telemetry. Routing churn is deliberately NOT an axis here (ADR-0032): it reuses the
 * ADR-0017/0018 epoch/reroute machinery and is a separate measurement.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeRng } from '../src/rng';
import type { Rng } from '../src/rng';
import { generateFabric, DEFAULT_FABRIC } from '../src/fabric';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { StaticFaultDomainSource } from '../src/fault-domain-source';
import { generateTelemetry } from '../src/telemetry';
import { standardizeAll } from '../src/calibration';
import { detectAll, DEFAULT_DETECT } from '../src/detect';
import { calibrateForSession, assembleAudit, leafTStats } from '../src/pipeline';
import type { PipelineParams } from '../src/pipeline';
import type { AuditRecord } from '../src/verdict';
import type { FaultDomainSnapshot, PathClassId } from '../src/domain';
import type { SignalVector } from '../src/signals';

/** One named degradation of telemetry quality. Every knob defaults to OFF (0/undefined). */
export interface PerturbationSpec {
  /** extra Gaussian noise (std, raw units) added to every sample — models worse SNR than calibrated. */
  noiseStd?: number;
  /** per-tick probability a sample is dropped, modeled as carry-forward of the last value (stale). */
  missingness?: number;
  /** observation lag in ticks: the stream arrives this many ticks late (uniform across signals). */
  delayTicks?: number;
  /** fractional ±perturbation of incidence weights (rollup/aggregation error). 0.2 ⇒ ±20% multiplicative. */
  aggregationError?: number;
}

/** True when nothing is perturbed — the byte-identity short-circuit. */
function isInert(s: PerturbationSpec): boolean {
  return !s.noiseStd && !s.missingness && !s.delayTicks && !s.aggregationError;
}

/** Shift one path-class matrix `lag` ticks later: value at t reflects t−lag (held at the first sample). */
function applyDelay(matrix: number[][], lag: number): number[][] {
  if (lag <= 0) return matrix;
  return matrix.map((_, t) => [...matrix[Math.max(0, t - lag)]]);
}

/** Carry-forward staleness: with probability `p`, tick t repeats tick t−1 (a dropped/absent sample). */
function applyMissingness(matrix: number[][], p: number, rng: Rng): number[][] {
  if (p <= 0) return matrix;
  const out = matrix.map((row) => [...row]);
  for (let t = 1; t < out.length; t++) if (rng.next() < p) out[t] = [...out[t - 1]];
  return out;
}

/** Additive Gaussian noise on every sample — uncalibrated, so it both masks faults and raises false alarms. */
function applyNoise(matrix: number[][], std: number, rng: Rng): number[][] {
  if (std <= 0) return matrix;
  return matrix.map((row) => row.map((v) => v + std * rng.gaussian()));
}

/**
 * Perturb the raw telemetry series (noise / missingness / delay), seeded and deterministic.
 * Order is delay → missingness → noise; inert spec returns the input untouched (byte-identity).
 */
export function perturbTelemetry(
  series: ReadonlyMap<PathClassId, SignalVector[]>,
  spec: PerturbationSpec,
  rng: Rng,
): Map<PathClassId, number[][]> {
  const out = new Map<PathClassId, number[][]>();
  for (const pc of [...series.keys()].sort()) {
    let m: number[][] = (series.get(pc) as number[][]).map((row) => [...row]);
    m = applyDelay(m, spec.delayTicks ?? 0);
    m = applyMissingness(m, spec.missingness ?? 0, rng);
    m = applyNoise(m, spec.noiseStd ?? 0, rng);
    out.set(pc, m);
  }
  return out;
}

/**
 * Perturb incidence weights by ±`frac` (multiplicative, clamped to (0,1]). Applied ONLY to the
 * snapshot the LOCALIZER uses (see `runPerturbed`), not the one telemetry is generated from — so
 * this models a genuine *mismatch* between the true incidence and the localizer's belief
 * (rollup/aggregation error), not a self-consistent re-weighting of the whole fabric.
 */
export function perturbSnapshot(snapshot: FaultDomainSnapshot, frac: number, rng: Rng): FaultDomainSnapshot {
  if (frac <= 0) return snapshot;
  const edges = snapshot.edges.map((e) => {
    const w = (e.weight ?? 1) * (1 + frac * (2 * rng.next() - 1));
    return { ...e, weight: Math.min(1, Math.max(1e-6, w)) };
  });
  return { ...snapshot, edges };
}

/**
 * Run the pipeline with a perturbation inserted — a faithful re-composition of `runPipeline`'s
 * NON-epoch'd path with the telemetry/snapshot transforms applied. At an inert spec the result is
 * byte-identical to `runPipeline(params)` (proven in test/degradation.test.ts). Reroutes are NOT
 * modeled here (the epoch path is a separate measurement, ADR-0032) — passing them is a hard error
 * rather than a silent divergence from the byte-identity claim.
 *
 * The TRUE fabric (`trueSnap`) generates telemetry and calibrates; the LOCALIZER sees `locSnap`,
 * which carries the aggregation-error weight perturbation — so that axis models a mismatch between
 * physical incidence and the localizer's belief, isolated from fault strength.
 */
export async function runPerturbed(params: PipelineParams, spec: PerturbationSpec, perturbSeed: number): Promise<AuditRecord> {
  if (params.reroutes?.length) throw new RangeError('runPerturbed models the non-epoch path; reroutes are unsupported (ADR-0032)');
  const rng = makeRng(perturbSeed);
  const trueSnap = params.snapshot ?? generateFabric(params.fabric ?? DEFAULT_FABRIC);
  const locSnap = perturbSnapshot(trueSnap, spec.aggregationError ?? 0, rng);
  const source = new StaticFaultDomainSource(locSnap);
  const snapshot_hash = source.snapshotHash(await source.fetchSnapshot());
  const detect = params.detect ?? DEFAULT_DETECT;
  const { calibration, ctx } = calibrateForSession(trueSnap, params.telemetry, detect);
  const liveRaw = generateTelemetry(trueSnap, params.telemetry);
  const series = isInert(spec) ? (liveRaw.series as Map<PathClassId, number[][]>) : perturbTelemetry(liveRaw.series, spec, rng);
  const residuals = standardizeAll(series, calibration);
  const verdicts = detectAll(residuals, detect, ctx);
  return assembleAudit({
    snapshot: locSnap,
    snapshot_hash,
    q: params.q,
    verdicts,
    epochs: null,
    resets: null,
    drain_top_k: params.drain_top_k ?? 1,
    // ADR-0046: the linear t currency, exactly as runPipeline's non-epoch path computes it.
    magnitudeT: leafTStats(residuals),
    ticks: params.telemetry.ticks,
  });
}

// ───────────────────────── the degradation envelope (the published artifact) ─────────────────────────

/** A fixed operating point chosen so the clean (intensity-0) run detects AND attributes rank-1,
 *  leaving room for degradation to break it — otherwise an axis would measure nothing. */
const FAULT_RESOURCE = 'optic-3';
const FAULT_DELTA = 3;
const TICKS = 60;
const Q = 0.05;
/** Raised sample size (ADR-0032 open-Q1): 2 targets × 2 telemetry × 8 perturbation seeds = n=32 per
 *  cell, large enough that the frontier is stable across a held-out seed block (test/degradation.test.ts). */
const PERTURB_SEEDS = [0xd00d01, 0xd00d02, 0xd00d03, 0xd00d04, 0xd00d05, 0xd00d06, 0xd00d07, 0xd00d08];
const TELEMETRY_SEEDS = [0x5eed01, 0x5eed02];

export interface EnvelopePoint {
  intensity: number;
  n: number;
  detection_rate: number;
  attribution_rate: number;
}

export interface AxisEnvelope {
  axis: string;
  unit: string;
  /** the spec field this axis drives. */
  knob: keyof PerturbationSpec;
  points: EnvelopePoint[];
  /** first intensity at which attribution drops below the clean (intensity-0) rate — the frontier. */
  attribution_breakdown: number | null;
  /** first intensity at which detection of *something* drops below clean. */
  detection_breakdown: number | null;
}

const AXES: { axis: string; unit: string; knob: keyof PerturbationSpec; grid: number[] }[] = [
  { axis: 'signal_noise', unit: 'extra σ (raw)', knob: 'noiseStd', grid: [0, 0.05, 0.1, 0.25, 0.5, 1, 2] },
  { axis: 'missingness', unit: 'drop probability', knob: 'missingness', grid: [0, 0.1, 0.25, 0.5, 0.8] },
  { axis: 'observation_delay', unit: 'lag (ticks)', knob: 'delayTicks', grid: [0, 1, 3, 8, 20] },
  { axis: 'aggregation_error', unit: '± weight frac', knob: 'aggregationError', grid: [0, 0.1, 0.25, 0.5, 0.9] },
];

/** Detection + attribution rate for one spec over targets×telemetry-seeds×perturbation-seeds. */
async function ratesFor(snapshot: FaultDomainSnapshot, targets: string[], spec: PerturbationSpec): Promise<EnvelopePoint & { intensity: number }> {
  let detected = 0;
  let attributed = 0;
  let n = 0;
  for (const resource of targets) {
    for (const tseed of TELEMETRY_SEEDS) {
      const params: PipelineParams = { snapshot, q: Q, telemetry: { seed: tseed, ticks: TICKS, degradation: { resource_id: resource, delta: FAULT_DELTA, start_tick: 0 } } };
      for (const pseed of PERTURB_SEEDS) {
        const audit = await runPerturbed(params, spec, pseed ^ tseed);
        n += 1;
        const isDetected = audit.selected_path_class_ids.length > 0;
        if (isDetected) detected += 1;
        if (isDetected && audit.culprits[0]?.resource_id === resource) attributed += 1;
      }
    }
  }
  return { intensity: 0, n, detection_rate: detected / n, attribution_rate: attributed / n };
}

/** First grid intensity whose rate falls below the clean (grid[0]) rate, or null if it never does. */
function breakdownOf(points: EnvelopePoint[], key: 'detection_rate' | 'attribution_rate'): number | null {
  const clean = points[0][key];
  for (const p of points.slice(1)) if (p[key] < clean) return p.intensity;
  return null;
}

async function axisEnvelope(snapshot: FaultDomainSnapshot, targets: string[], a: (typeof AXES)[number]): Promise<AxisEnvelope> {
  const points: EnvelopePoint[] = [];
  for (const intensity of a.grid) {
    const r = await ratesFor(snapshot, targets, { [a.knob]: intensity });
    points.push({ intensity, n: r.n, detection_rate: r.detection_rate, attribution_rate: r.attribution_rate });
  }
  return {
    axis: a.axis,
    unit: a.unit,
    knob: a.knob,
    points,
    attribution_breakdown: breakdownOf(points, 'attribution_rate'),
    detection_breakdown: breakdownOf(points, 'detection_rate'),
  };
}

/** Two joint regimes (ADR-0032 open-Q2): "degraded telemetry" and "lossy + mis-rolled-up". */
const JOINT: { regime: string; spec: PerturbationSpec }[] = [
  { regime: 'degraded_telemetry (noise 1σ + 25% missing)', spec: { noiseStd: 1, missingness: 0.25 } },
  { regime: 'lossy_aggregation (50% missing + ±25% weight)', spec: { missingness: 0.5, aggregationError: 0.25 } },
];

export interface DegradationReport {
  generated_for: string;
  operating_point: { fabric: string; fault_resource_kind: string; delta: number; ticks: number; q: number };
  n_per_cell: number;
  telemetry_seeds: number;
  perturbation_seeds: number;
  clean: { detection_rate: number; attribution_rate: number };
  axes: AxisEnvelope[];
  joint: { regime: string; detection_rate: number; attribution_rate: number; n: number }[];
  caveat: string;
}

export async function computeDegradation(): Promise<DegradationReport> {
  const snapshot = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
  const targets = [FAULT_RESOURCE, 'optic-40'];
  const axes: AxisEnvelope[] = [];
  for (const a of AXES) axes.push(await axisEnvelope(snapshot, targets, a));
  const clean = axes[0].points[0];
  const joint = [];
  for (const j of JOINT) {
    const r = await ratesFor(snapshot, targets, j.spec);
    joint.push({ regime: j.regime, detection_rate: r.detection_rate, attribution_rate: r.attribution_rate, n: r.n });
  }
  return {
    generated_for: `spraypoint:${DEFAULT_SPRAYPOINT.nTors}x${DEFAULT_SPRAYPOINT.nPanels}x${DEFAULT_SPRAYPOINT.nRooms}`,
    operating_point: { fabric: 'DEFAULT_SPRAYPOINT', fault_resource_kind: 'optic', delta: FAULT_DELTA, ticks: TICKS, q: Q },
    n_per_cell: clean.n,
    telemetry_seeds: TELEMETRY_SEEDS.length,
    perturbation_seeds: PERTURB_SEEDS.length,
    clean: { detection_rate: clean.detection_rate, attribution_rate: clean.attribution_rate },
    axes,
    joint,
    caveat:
      'Synthetic Tier-2 measurement (VALIDATION.md): a breakdown frontier on the synthetic model, ' +
      'NOT a claim of real-world robustness. Calibration is on a CLEAN window, so perturbations both ' +
      'mask faults (attribution falls) and raise false alarms (detection of *something* can rise) — ' +
      'both reported. Routing churn is not an axis here (reuses the ADR-0017/0018 epoch machinery).',
  };
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function renderMarkdown(rep: DegradationReport): string {
  const L: string[] = [];
  L.push('# Tessera-RNG — degradation / sensitivity envelope (ADR-0032)');
  L.push('');
  L.push(`Operating point: **${rep.operating_point.fabric}**, an ${rep.operating_point.fault_resource_kind} fault at Δ=${rep.operating_point.delta}, ${rep.operating_point.ticks} ticks, q=${rep.operating_point.q}. Clean (no perturbation): detection ${pct(rep.clean.detection_rate)}, attribution ${pct(rep.clean.attribution_rate)}.`);
  L.push(`Per cell **n=${rep.n_per_cell}** (${rep.telemetry_seeds} telemetry seeds × ${rep.perturbation_seeds} perturbation seeds).`);
  L.push('');
  L.push(`> ${rep.caveat}`);
  L.push('');
  L.push('## Per-axis breakdown frontier');
  L.push('');
  L.push('Each axis swept alone. **Detection** = any leaf selected (can RISE — noise manufactures false alarms); **attribution** = true culprit ranks #1 (the meaningful frontier — it falls as the world leaves the model).');
  L.push('');
  for (const a of rep.axes) {
    L.push(`### ${a.axis} (${a.unit})`);
    L.push('');
    L.push(`Attribution breakdown at: **${a.attribution_breakdown ?? 'never (held across grid)'}**${a.attribution_breakdown !== null ? ` ${a.unit}` : ''}. Detection breakdown at: **${a.detection_breakdown ?? 'never'}**${a.detection_breakdown !== null ? ` ${a.unit}` : ''} (detection rarely falls — the failure mode is mis-attribution, not silence).`);
    L.push('');
    L.push('| intensity | detection | attribution | n |');
    L.push('|---|---|---|---|');
    for (const p of a.points) L.push(`| ${p.intensity} | ${pct(p.detection_rate)} | ${pct(p.attribution_rate)} | ${p.n} |`);
    L.push('');
  }
  L.push('## Joint regimes');
  L.push('');
  L.push('| regime | detection | attribution | n |');
  L.push('|---|---|---|---|');
  for (const j of rep.joint) L.push(`| ${j.regime} | ${pct(j.detection_rate)} | ${pct(j.attribution_rate)} | ${j.n} |`);
  L.push('');
  return L.join('\n');
}

async function main(): Promise<void> {
  const rep = await computeDegradation();
  const outDir = join(process.cwd(), 'coverage-matrices');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'degradation-saturation.json'), JSON.stringify(rep, null, 2));
  writeFileSync(join(outDir, 'degradation-saturation.md'), renderMarkdown(rep));
  // eslint-disable-next-line no-console
  console.log(`wrote coverage-matrices/degradation-saturation.{json,md} (${rep.axes.length} axes)`);
}

if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
