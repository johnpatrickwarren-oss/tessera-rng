/**
 * Deterministic scenario registry (v1 spec AC-8) — the eight canned situations the demo pages
 * and the coverage matrix sweeps. Each scenario is a pure function of a seed, so the same
 * scenario always produces the same audit record (replay-clean, AC-9).
 *
 * Tools live outside src/ (build/reporting layer) and consume the already-tested pipeline.
 */
import { runPipeline } from '../src/pipeline';
import type { PipelineParams } from '../src/pipeline';
import { generateFabric } from '../src/fabric';
import type { FabricParams } from '../src/fabric';
import type { ResourceKind } from '../src/domain';
import type { AuditRecord } from '../src/verdict';
import { SIGNALS } from '../src/signals';
import type { SignalName } from '../src/signals';

export type ScenarioName =
  | 'clean-baseline'
  | 'single-optic-degradation'
  | 'shuffle-device-common-mode'
  | 'fiber-bundle-common-mode'
  | 'fdr-control'
  | 'topology-spanning-common-mode'
  | 'covariance-flip-common-mode'
  | 'oscillation-common-mode';

/** Degradation mode of a scenario: a mean shift (A), a cross-signal correlation flip (C), or a
 *  periodic oscillation (D). The new C/D scenarios surface the post-v1 detector modes (ADR-0012). */
export type ScenarioMode = 'mean' | 'covariance' | 'oscillation';

export const SCENARIO_FABRIC: FabricParams = {
  seed: 0x7e55e4a,
  n_path_classes: 300,
  n_optics: 56,
  n_shufflers: 14,
  n_bundles: 20,
  n_power_zones: 4,
  n_cooling_zones: 4,
};

const TICKS = 60;
const OSC_TICKS = 600; // Family D (spectral) needs ~15 non-overlapping windows (ADR-0009)
const Q = 0.05;

/** A p×p correlation matrix: ρ between signals (i,j), identity elsewhere (baseline co-movement). */
function corr(i: number, j: number, rho: number): number[][] {
  const p = SIGNALS.length;
  return Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => (a === b ? 1 : (a === i && b === j) || (a === j && b === i) ? rho : 0)));
}

/** The resource of a given kind traversed by the most path-classes (strongest, deterministic). */
export function targetByKind(kind: ResourceKind, fabric: FabricParams = SCENARIO_FABRIC): string {
  const snap = generateFabric(fabric);
  const counts = new Map<string, number>();
  for (const e of snap.edges) counts.set(e.resource, (counts.get(e.resource) ?? 0) + 1);
  const candidates = snap.resources.filter((r) => r.kind === kind).map((r) => r.id);
  candidates.sort((a, b) => (counts.get(b)! - counts.get(a)!) || (a < b ? -1 : 1));
  return candidates[0];
}

export interface ScenarioResult {
  name: ScenarioName;
  description: string;
  injected_resource_id: string | null;
  injected_kind: ResourceKind | null;
  /** the degradation mode (which detector family is expected to catch it) — ADR-0012. */
  mode: ScenarioMode;
  audit: AuditRecord;
}

interface Spec {
  description: string;
  kind: ResourceKind | null;
  seed: number;
  delta: number;
  mode?: ScenarioMode; // default 'mean'
  ticks?: number; // default TICKS
}

const SPECS: Record<ScenarioName, Spec> = {
  'clean-baseline': { description: 'Healthy fabric, no degradation — FDR control keeps the verdict surface quiet.', kind: null, seed: 0x0c1ea4, delta: 0 },
  'single-optic-degradation': { description: 'One optic degrades; only the few path-classes through it should fire and localize to that optic.', kind: 'optic', seed: 0x09271c, delta: 4 },
  'shuffle-device-common-mode': { description: 'A passive optical shuffler degrades (mean shift) — a classic common mode smeared across many edge-disjoint paths; Family A catches it.', kind: 'passive_shuffler', seed: 0x05caf1, delta: 4 },
  'fiber-bundle-common-mode': { description: 'A fiber bundle degrades; every path-class routed through the bundle is implicated.', kind: 'fiber_bundle', seed: 0x0b2d1e, delta: 4 },
  'fdr-control': { description: 'No common mode, large path-class population — demonstrates e-BH controls false positives under heavy correlation.', kind: null, seed: 0x0fdc01, delta: 0 },
  'topology-spanning-common-mode': { description: 'A power zone degrades — a topology-spanning common mode touching path-classes all over the fabric.', kind: 'power_zone', seed: 0x70b5b1, delta: 4 },
  'covariance-flip-common-mode': { description: 'A shuffler REVERSES the normal cross-signal correlation (no mean or variance change). Family A is blind; the learned-covariance Family C catches the second-order shift (ADR-0007/0012).', kind: 'passive_shuffler', seed: 0x0c0ff1, delta: 0, mode: 'covariance' },
  'oscillation-common-mode': { description: 'A shuffler develops a periodic oscillation — a limit cycle with unchanged mean and variance. Families A and C are blind; the spectral Family D catches the periodicity (ADR-0009/0012).', kind: 'passive_shuffler', seed: 0x005c11, delta: 0, mode: 'oscillation', ticks: OSC_TICKS },
};

/** Build the pipeline telemetry params for a scenario's degradation mode. */
function telemetryFor(spec: Spec, injected: string | null): PipelineParams['telemetry'] {
  const ticks = spec.ticks ?? TICKS;
  if (!injected) return { seed: spec.seed, ticks };
  const base = { resource_id: injected, start_tick: 0 };
  if (spec.mode === 'covariance') {
    return { seed: spec.seed, ticks, noiseCorr: corr(0, 2, 0.9), degradation: { ...base, delta: 0, degradedNoiseCorr: corr(0, 2, -0.9) } };
  }
  if (spec.mode === 'oscillation') {
    return { seed: spec.seed, ticks, degradation: { ...base, delta: 0, signal: 'p99_latency' as SignalName, oscillationPeriod: 7, oscillationAmp: 0.9 } };
  }
  return { seed: spec.seed, ticks, degradation: { ...base, delta: spec.delta } };
}

export async function runScenario(name: ScenarioName): Promise<ScenarioResult> {
  const spec = SPECS[name];
  const injected = spec.kind ? targetByKind(spec.kind) : null;
  const audit = await runPipeline({ fabric: SCENARIO_FABRIC, telemetry: telemetryFor(spec, injected), q: Q, drain_top_k: 1 });
  return { name, description: spec.description, injected_resource_id: injected, injected_kind: spec.kind, mode: spec.mode ?? 'mean', audit };
}

export const SCENARIO_NAMES: ScenarioName[] = [
  'clean-baseline',
  'single-optic-degradation',
  'shuffle-device-common-mode',
  'fiber-bundle-common-mode',
  'fdr-control',
  'topology-spanning-common-mode',
  'covariance-flip-common-mode',
  'oscillation-common-mode',
];

export async function runAllScenarios(): Promise<ScenarioResult[]> {
  const out: ScenarioResult[] = [];
  for (const name of SCENARIO_NAMES) out.push(await runScenario(name));
  return out;
}
