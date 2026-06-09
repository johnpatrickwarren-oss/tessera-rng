/**
 * Deterministic scenario registry (v1 spec AC-8) — the six canned situations the demo pages
 * and the coverage matrix sweeps. Each scenario is a pure function of a seed, so the same
 * scenario always produces the same audit record (replay-clean, AC-9).
 *
 * Tools live outside src/ (build/reporting layer) and consume the already-tested pipeline.
 */
import { runPipeline } from '../src/pipeline';
import { generateFabric } from '../src/fabric';
import type { FabricParams } from '../src/fabric';
import type { ResourceKind } from '../src/domain';
import type { AuditRecord } from '../src/verdict';

export type ScenarioName =
  | 'clean-baseline'
  | 'single-optic-degradation'
  | 'shuffle-device-common-mode'
  | 'fiber-bundle-common-mode'
  | 'fdr-control'
  | 'topology-spanning-common-mode';

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
const Q = 0.05;

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
  audit: AuditRecord;
}

interface Spec {
  description: string;
  kind: ResourceKind | null;
  seed: number;
  delta: number;
}

const SPECS: Record<ScenarioName, Spec> = {
  'clean-baseline': { description: 'Healthy fabric, no degradation — FDR control keeps the verdict surface quiet.', kind: null, seed: 0x0c1ea4, delta: 0 },
  'single-optic-degradation': { description: 'One optic degrades; only the few path-classes through it should fire and localize to that optic.', kind: 'optic', seed: 0x09271c, delta: 4 },
  'shuffle-device-common-mode': { description: 'A passive optical shuffler degrades — a classic common mode smeared across many edge-disjoint paths.', kind: 'passive_shuffler', seed: 0x05caf1, delta: 4 },
  'fiber-bundle-common-mode': { description: 'A fiber bundle degrades; every path-class routed through the bundle is implicated.', kind: 'fiber_bundle', seed: 0x0b2d1e, delta: 4 },
  'fdr-control': { description: 'No common mode, large path-class population — demonstrates e-BH controls false positives under heavy correlation.', kind: null, seed: 0x0fdc01, delta: 0 },
  'topology-spanning-common-mode': { description: 'A power zone degrades — a topology-spanning common mode touching path-classes all over the fabric.', kind: 'power_zone', seed: 0x70b5b1, delta: 4 },
};

export async function runScenario(name: ScenarioName): Promise<ScenarioResult> {
  const spec = SPECS[name];
  const injected = spec.kind ? targetByKind(spec.kind) : null;
  const audit = await runPipeline({
    fabric: SCENARIO_FABRIC,
    telemetry: { seed: spec.seed, ticks: TICKS, degradation: injected ? { resource_id: injected, delta: spec.delta, start_tick: 0 } : undefined },
    q: Q,
    drain_top_k: 1,
  });
  return { name, description: spec.description, injected_resource_id: injected, injected_kind: spec.kind, audit };
}

export const SCENARIO_NAMES: ScenarioName[] = [
  'clean-baseline',
  'single-optic-degradation',
  'shuffle-device-common-mode',
  'fiber-bundle-common-mode',
  'fdr-control',
  'topology-spanning-common-mode',
];

export async function runAllScenarios(): Promise<ScenarioResult[]> {
  const out: ScenarioResult[] = [];
  for (const name of SCENARIO_NAMES) out.push(await runScenario(name));
  return out;
}
