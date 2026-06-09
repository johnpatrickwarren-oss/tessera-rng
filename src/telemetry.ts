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
}

export interface TelemetryParams {
  seed: number;
  ticks: number;
  degradation?: DegradationSpec;
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

export function generateTelemetry(snapshot: FaultDomainSnapshot, params: TelemetryParams): Telemetry {
  const rng = makeRng(params.seed);
  const deg = params.degradation;
  const sigIdx = signalIndex(deg?.signal ?? 'p99_latency');
  const mode = deg?.mode ?? 'mean';
  const affected = deg ? affectedPathClasses(snapshot, deg.resource_id) : new Set<PathClassId>();
  const series = new Map<PathClassId, SignalVector[]>();

  const p = SIGNALS.length;
  const order = [...snapshot.path_classes].sort();
  for (const pc of order) {
    const tc = trafficClassOf(pc);
    const isAffected = affected.has(pc);
    const matrix: number[][] = [];
    const prevNoise = new Array<number>(p).fill(0);
    for (let t = 0; t < params.ticks; t++) {
      const hour = t % HOURS_PER_DAY;
      const vec = SIGNALS.map((_, i) => {
        const z = rng.gaussian();
        // stationary AR(1) noise: var 1 at every tick; t=0 is a stationary draw.
        const phi = AR1_PHI[i];
        const noise = t === 0 ? z : phi * prevNoise[i] + Math.sqrt(1 - phi * phi) * z;
        prevNoise[i] = noise;
        return rawBaseline(i, hour, tc) + noise;
      });
      if (isAffected && deg && t >= deg.start_tick) {
        if (mode === 'variance') {
          const base = rawBaseline(sigIdx, hour, tc);
          vec[sigIdx] = base + (vec[sigIdx] - base) * deg.delta; // inflate noise around the baseline
        } else {
          vec[sigIdx] += deg.delta; // mean shift
        }
      }
      matrix.push(vec);
    }
    series.set(pc, matrix);
  }
  return { series, ticks: params.ticks };
}
