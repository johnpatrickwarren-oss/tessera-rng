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
import type { SignalVector } from './signals';
import { trafficClassOf, HOURS_PER_DAY } from './calibration';
import type { TrafficClass } from './calibration';
import type { FaultDomainSnapshot, PathClassId, ResourceId } from './domain';

export interface DegradationSpec {
  resource_id: ResourceId;
  /** raw mean shift applied to p99_latency after start_tick. */
  delta: number;
  start_tick: number;
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
  const p99 = signalIndex('p99_latency');
  const affected = params.degradation ? affectedPathClasses(snapshot, params.degradation.resource_id) : new Set<PathClassId>();
  const series = new Map<PathClassId, SignalVector[]>();

  const order = [...snapshot.path_classes].sort();
  for (const pc of order) {
    const tc = trafficClassOf(pc);
    const isAffected = affected.has(pc);
    const matrix: number[][] = [];
    for (let t = 0; t < params.ticks; t++) {
      const hour = t % HOURS_PER_DAY;
      const vec = SIGNALS.map((_, i) => rawBaseline(i, hour, tc) + rng.gaussian());
      if (isAffected && params.degradation && t >= params.degradation.start_tick) {
        vec[p99] += params.degradation.delta;
      }
      matrix.push(vec);
    }
    series.set(pc, matrix);
  }
  return { series, ticks: params.ticks };
}
