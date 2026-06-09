/**
 * Coverage/saturation matrix + detection/attribution-floor table (v1 spec AC-10).
 *
 * Honest measurement (DISCIPLINES §7): every cell reports BOTH detection and attribution as
 * parallel columns, so a strong detection number can never mask weak localization. The floor
 * table reports the detection floor AND the attribution floor side by side. A clean-fabric
 * false-positive measurement is included as direct evidence of e-BH FDR control.
 *
 * Deterministic: fixed seed list, fixed target selection. Re-running yields identical output.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runPipeline } from '../src/pipeline';
import { generateFabric } from '../src/fabric';
import type { ResourceKind } from '../src/domain';
import { SCENARIO_FABRIC } from './scenarios';

const KINDS: ResourceKind[] = ['optic', 'passive_shuffler', 'fiber_bundle', 'power_zone'];
const DELTAS = [0.5, 1.0, 2.0, 3.0];
const SEEDS = [0x5eed01, 0x5eed02];
const TARGETS_PER_KIND = 2;
const TICKS = 60;
const Q = 0.05;
const FLOOR_RATE = 0.9;

/** The N most-traversed resources of a kind (deterministic). */
function topTargets(kind: ResourceKind, n: number): string[] {
  const snap = generateFabric(SCENARIO_FABRIC);
  const counts = new Map<string, number>();
  for (const e of snap.edges) counts.set(e.resource, (counts.get(e.resource) ?? 0) + 1);
  return snap.resources
    .filter((r) => r.kind === kind)
    .map((r) => r.id)
    .sort((a, b) => (counts.get(b)! - counts.get(a)!) || (a < b ? -1 : 1))
    .slice(0, n);
}

export interface CoverageCell {
  kind: ResourceKind;
  delta: number;
  n: number;
  detected: number;
  attributed: number;
  detection_rate: number;
  attribution_rate: number;
}

export interface FloorRow {
  kind: ResourceKind;
  detection_floor: number | null;
  attribution_floor: number | null;
}

export interface CoverageReport {
  generated_for: string;
  deltas: number[];
  seeds_per_cell: number;
  targets_per_kind: number;
  floor_rate: number;
  cells: CoverageCell[];
  floors: FloorRow[];
  clean: { trials: number; mean_selected: number; false_positive_rate: number };
}

async function cell(kind: ResourceKind, delta: number, targets: string[]): Promise<CoverageCell> {
  let detected = 0;
  let attributed = 0;
  let n = 0;
  for (const resource of targets) {
    for (const seed of SEEDS) {
      const audit = await runPipeline({
        fabric: SCENARIO_FABRIC,
        telemetry: { seed, ticks: TICKS, degradation: { resource_id: resource, delta, start_tick: 0 } },
        q: Q,
      });
      n += 1;
      const isDetected = audit.selected_path_class_ids.length > 0;
      if (isDetected) detected += 1;
      if (isDetected && audit.culprits[0]?.resource_id === resource) attributed += 1;
    }
  }
  return { kind, delta, n, detected, attributed, detection_rate: detected / n, attribution_rate: attributed / n };
}

export function floorFor(cells: CoverageCell[], kind: ResourceKind, key: 'detection_rate' | 'attribution_rate'): number | null {
  const rows = cells.filter((c) => c.kind === kind).sort((a, b) => a.delta - b.delta);
  for (const r of rows) if (r[key] >= FLOOR_RATE) return r.delta;
  return null;
}

async function cleanFalsePositives(): Promise<CoverageReport['clean']> {
  let total = 0;
  for (const seed of [...SEEDS, 0x5eed03, 0x5eed04]) {
    const audit = await runPipeline({ fabric: SCENARIO_FABRIC, telemetry: { seed, ticks: TICKS }, q: Q });
    total += audit.selected_path_class_ids.length;
  }
  const trials = SEEDS.length + 2;
  return { trials, mean_selected: total / trials, false_positive_rate: total / (trials * SCENARIO_FABRIC.n_path_classes) };
}

export async function computeCoverage(): Promise<CoverageReport> {
  const cells: CoverageCell[] = [];
  for (const kind of KINDS) {
    const targets = topTargets(kind, TARGETS_PER_KIND);
    for (const delta of DELTAS) cells.push(await cell(kind, delta, targets));
  }
  const floors: FloorRow[] = KINDS.map((kind) => ({
    kind,
    detection_floor: floorFor(cells, kind, 'detection_rate'),
    attribution_floor: floorFor(cells, kind, 'attribution_rate'),
  }));
  return {
    generated_for: `synthetic-rng-fabric:${SCENARIO_FABRIC.seed}`,
    deltas: DELTAS,
    seeds_per_cell: SEEDS.length,
    targets_per_kind: TARGETS_PER_KIND,
    floor_rate: FLOOR_RATE,
    cells,
    floors,
    clean: await cleanFalsePositives(),
  };
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function renderMarkdown(rep: CoverageReport): string {
  const L: string[] = [];
  L.push('# Tessera-RNG — coverage/saturation & floor matrices (AC-10)');
  L.push('');
  L.push(`Synthetic fabric \`${rep.generated_for}\`; ${rep.seeds_per_cell} seeds × ${rep.targets_per_kind} targets per cell; FDR target q=${Q}.`);
  L.push('Every cell reports **detection** and **attribution** as parallel columns — a strong detection rate never hides weak localization.');
  L.push('');
  L.push('## Perturbation model & scope (read before the numbers)');
  L.push('');
  L.push('These floors characterize a **single-signal mean shift**: each injected degradation adds Δ to the');
  L.push('`p99_latency` residual of every path-class traversing the target resource. The full five-signal');
  L.push('vector is plumbed end-to-end and Family C (distributional) consumes all five, but **this sweep does');
  L.push('not perturb the other four signals**, nor inject pure variance/covariance shifts. So the detection');
  L.push('and attribution floors below are floors *for a p99-latency mean shift*, not a general "any');
  L.push('degradation" guarantee. Multi-signal and distributional-shift coverage is future work — stated here,');
  L.push('not in a footnote.');
  L.push('');
  L.push('## Coverage / saturation');
  L.push('');
  L.push('| resource kind | Δ (mean shift) | detection | attribution |');
  L.push('|---|---|---|---|');
  for (const c of rep.cells) L.push(`| ${c.kind} | ${c.delta} | ${pct(c.detection_rate)} (${c.detected}/${c.n}) | ${pct(c.attribution_rate)} (${c.attributed}/${c.n}) |`);
  L.push('');
  L.push(`## Detection & attribution floors (smallest Δ reaching ≥${pct(rep.floor_rate)})`);
  L.push('');
  L.push('| resource kind | detection floor (Δ) | attribution floor (Δ) |');
  L.push('|---|---|---|');
  for (const f of rep.floors) L.push(`| ${f.kind} | ${f.detection_floor ?? `>${Math.max(...rep.deltas)}`} | ${f.attribution_floor ?? `>${Math.max(...rep.deltas)}`} |`);
  L.push('');
  L.push('## FDR control (clean fabric, no degradation)');
  L.push('');
  L.push(`Across ${rep.clean.trials} clean trials over ${SCENARIO_FABRIC.n_path_classes} path-classes: mean selected = **${rep.clean.mean_selected}**, false-positive rate = **${pct(rep.clean.false_positive_rate)}** — e-BH holds the surface quiet under heavy correlation.`);
  L.push('');
  return L.join('\n');
}

async function main(): Promise<void> {
  const rep = await computeCoverage();
  const outDir = join(process.cwd(), 'coverage-matrices');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'coverage-saturation.json'), JSON.stringify(rep, null, 2));
  writeFileSync(join(outDir, 'coverage-saturation.md'), renderMarkdown(rep));
  // eslint-disable-next-line no-console
  console.log(`wrote coverage-matrices/coverage-saturation.{json,md} (${rep.cells.length} cells)`);
}

if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
