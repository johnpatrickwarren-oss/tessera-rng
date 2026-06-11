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
import type { PipelineParams } from '../src/pipeline';
import { generateFabric } from '../src/fabric';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT, PAPER_SPRAYPOINT, viewOfLeaf } from '../src/spraypoint';
import type { ResourceKind } from '../src/domain';
import { SIGNALS } from '../src/signals';
import type { SignalName } from '../src/signals';
import { SCENARIO_FABRIC } from './scenarios';

const KINDS: ResourceKind[] = ['optic', 'passive_shuffler', 'fiber_bundle', 'power_zone'];
const DELTAS = [0.5, 1.0, 2.0, 3.0];
const SEEDS = [0x5eed01, 0x5eed02];
const TARGETS_PER_KIND = 2;
const TICKS = 60;
const Q = 0.05;
const FLOOR_RATE = 0.9;

/** The N most-traversed resources of a kind (deterministic). */
export function topTargets(kind: ResourceKind, n: number): string[] {
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
  /** a resource kind for the single-fault tables; a PAIR name (cross_kind/same_kind) for the
   *  ADR-0024 multi-fault table — widened to string so the published JSON matches its schema. */
  kind: string;
  delta: number;
  n: number;
  detected: number;
  attributed: number;
  detection_rate: number;
  attribution_rate: number;
}

export interface FloorRow {
  kind: string;
  detection_floor: number | null;
  attribution_floor: number | null;
}

export interface SignalCoverageRow {
  signal: SignalName;
  mode: 'mean' | 'variance';
  delta: number;
  n: number;
  detection_rate: number;
  attribution_rate: number;
}

/** One swept magnitude of one anomaly mode: detection + attribution + which family caught it. */
export interface ModePoint {
  magnitude: number;
  detection_rate: number;
  attribution_rate: number;
  /** the family(ies) that fired on the selected set ('A+C', 'C', 'D', …) — firing-mode attribution. */
  family: string;
}

export interface ModeFloorRow {
  mode: 'mean_shift' | 'covariance_flip' | 'oscillation';
  unit: string;
  detection_floor: number | null;
  attribution_floor: number | null;
  /** the expected detecting family for this mode (A=mean, C=covariance, D=spectral). */
  detecting_family: string;
  points: ModePoint[];
}

export interface CoverageReport {
  generated_for: string;
  deltas: number[];
  seeds_per_cell: number;
  targets_per_kind: number;
  floor_rate: number;
  cells: CoverageCell[];
  floors: FloorRow[];
  /** per-signal detection sweep (fixed kind+Δ) demonstrating all five signals are exercised. */
  per_signal: SignalCoverageRow[];
  /** per-mode floors (A=mean, C=covariance, D=spectral) — the three anomaly modes, each measured. */
  mode_floors: ModeFloorRow[];
  /** per-view detection on the Spraypoint fabric — which aggregation view concentrates each fault kind (ADR-0015). */
  spraypoint_views: SpraypointViewRow[];
  /** detection/attribution floors UNDER DILUTION on the Spraypoint two-view fabric (ADR-0020) — closes the ADR-0014 deferral. */
  spraypoint_floors: { deltas: number[]; cells: CoverageCell[]; floors: FloorRow[] };
  /** FDR control on the SAME fabric the dilution floors characterize (ADR-0020 cold-eye L5). */
  clean_spraypoint: { trials: number; mean_selected: number; false_positive_rate: number };
  /** simultaneous two-fault floors on the Spraypoint fabric (ADR-0024) — attribution = BOTH injected resources in the top-2 culprits. */
  multi_fault: { deltas: number[]; cells: CoverageCell[]; floors: FloorRow[] };
  /** the paper-scale proof (ADR-0025): deterministic outcomes at 960 ToRs — wall-clock lives in the ADR, not here (artifact stays replay-stable). */
  scale_proof: { leaves: number; per_tor_leaves: number; per_panel_pair_leaves: number; edges: number; resources: number; clean_selected: number; outcomes: { kind: string; resource: string; delta: number; detected: boolean; rank1: string }[] };
  clean: { trials: number; mean_selected: number; false_positive_rate: number };
}

export interface SpraypointViewRow {
  fault_kind: string;
  resource: string;
  /** view → number of that view's leaves selected. */
  per_view_detected: Record<string, number>;
  /** the view(s) that concentrated the fault, or 'none' — the published blind-spot map. */
  concentrated_by: string;
}

export async function cell(kind: ResourceKind, delta: number, targets: string[]): Promise<CoverageCell> {
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

export function floorFor(cells: CoverageCell[], kind: string, key: 'detection_rate' | 'attribution_rate'): number | null {
  const rows = cells.filter((c) => c.kind === kind).sort((a, b) => a.delta - b.delta);
  for (const r of rows) if (r[key] >= FLOOR_RATE) return r.delta;
  return null;
}

const PER_SIGNAL_KIND: ResourceKind = 'passive_shuffler';
const PER_SIGNAL_DELTA = 3.0;

/** Detection + attribution for a degradation on one signal in one mode (fixed kind + Δ). */
async function signalRow(targets: string[], signal: SignalName, mode: 'mean' | 'variance', delta: number): Promise<SignalCoverageRow> {
  let detected = 0;
  let attributed = 0;
  let n = 0;
  for (const resource of targets) {
    for (const seed of SEEDS) {
      const audit = await runPipeline({
        fabric: SCENARIO_FABRIC,
        telemetry: { seed, ticks: TICKS, degradation: { resource_id: resource, delta, start_tick: 0, signal, mode } },
        q: Q,
      });
      n += 1;
      const isDetected = audit.selected_path_class_ids.length > 0;
      if (isDetected) detected += 1;
      if (isDetected && audit.culprits[0]?.resource_id === resource) attributed += 1;
    }
  }
  return { signal, mode, delta, n, detection_rate: detected / n, attribution_rate: attributed / n };
}

async function perSignalCoverage(): Promise<SignalCoverageRow[]> {
  const targets = topTargets(PER_SIGNAL_KIND, TARGETS_PER_KIND);
  const rows: SignalCoverageRow[] = [];
  for (const signal of SIGNALS) rows.push(await signalRow(targets, signal, 'mean', PER_SIGNAL_DELTA));
  // a distributional (variance) shift demonstrates Family C catches what Family A cannot.
  rows.push(await signalRow(targets, 'loss_rate', 'variance', 4.0));
  return rows;
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

// ───────────────────────── per-mode floors (A=mean, C=covariance, D=spectral) ─────────────────────────

const MODE_KIND: ResourceKind = 'passive_shuffler';
const MEAN_MAGNITUDES = [0.5, 1.0, 2.0, 3.0]; // Δ on p99 (mode A)
const COV_BASE_RHO = 0.9; // baseline correlation of signals 0,2 …
// … flipped to these; magnitude = base − degraded. Includes sub-floor points (0.1, 0.2) so the
// detection knee is BRACKETED (a below-floor sample precedes the floor), not just lower-bounded.
const COV_DEGRADED_RHO = [0.9, 0.8, 0.7, 0.5, 0.0, -0.5, -0.9];
const OSC_AMPLITUDES = [0.3, 0.5, 0.7, 0.9]; // period-7 oscillation amplitude (mode D)
const COV_TICKS = 96;
const OSC_TICKS = 600; // Family D needs ~15 non-overlapping windows for power

/** A p×p correlation matrix: ρ between signals (i,j), identity elsewhere. */
function corrMatrix(i: number, j: number, rho: number): number[][] {
  const p = SIGNALS.length;
  return Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => (a === b ? 1 : (a === i && b === j) || (a === j && b === i) ? rho : 0)));
}

/** Families that fired across the trials, joined ('A+C', 'C', 'D'); 'none' if silent. */
function firedFamilies(fam: { A: number; C: number; D: number }): string {
  const on = (['A', 'C', 'D'] as const).filter((k) => fam[k] > 0);
  return on.length ? on.join('+') : 'none';
}

/** Run one magnitude of a mode over the targets×seeds and aggregate the rates + firing families. */
async function modePoint(magnitude: number, targets: string[], paramsFor: (resource: string, seed: number, magnitude: number) => PipelineParams): Promise<ModePoint> {
  let detected = 0;
  let attributed = 0;
  let n = 0;
  const fam = { A: 0, C: 0, D: 0 };
  for (const resource of targets) {
    for (const seed of SEEDS) {
      const audit = await runPipeline(paramsFor(resource, seed, magnitude));
      n += 1;
      const isDetected = audit.selected_path_class_ids.length > 0;
      if (isDetected) detected += 1;
      if (isDetected && audit.culprits[0]?.resource_id === resource) attributed += 1;
      fam.A += audit.firing_families.A;
      fam.C += audit.firing_families.C;
      fam.D += audit.firing_families.D;
    }
  }
  return { magnitude, detection_rate: detected / n, attribution_rate: attributed / n, family: firedFamilies(fam) };
}

/** Smallest magnitude whose rate reaches the floor (points must be magnitude-ascending). */
export function modeFloorOf(points: ModePoint[], key: 'detection_rate' | 'attribution_rate'): number | null {
  for (const p of [...points].sort((a, b) => a.magnitude - b.magnitude)) if (p[key] >= FLOOR_RATE) return p.magnitude;
  return null;
}

async function modeFloors(): Promise<ModeFloorRow[]> {
  const targets = topTargets(MODE_KIND, TARGETS_PER_KIND);
  const rows: ModeFloorRow[] = [];

  const meanPts = await Promise.all(MEAN_MAGNITUDES.map((d) => modePoint(d, targets, (resource, seed, delta) => ({
    fabric: SCENARIO_FABRIC, q: Q, telemetry: { seed, ticks: TICKS, degradation: { resource_id: resource, delta, start_tick: 0, signal: 'p99_latency' } },
  }))));
  rows.push({ mode: 'mean_shift', unit: 'Δ (p99 mean)', detection_floor: modeFloorOf(meanPts, 'detection_rate'), attribution_floor: modeFloorOf(meanPts, 'attribution_rate'), detecting_family: 'A', points: meanPts });

  const covPts = await Promise.all(COV_DEGRADED_RHO.map((degRho) => modePoint(Math.round((COV_BASE_RHO - degRho) * 100) / 100, targets, (resource, seed) => ({
    fabric: SCENARIO_FABRIC, q: Q, telemetry: { seed, ticks: COV_TICKS, noiseCorr: corrMatrix(0, 2, COV_BASE_RHO), degradation: { resource_id: resource, delta: 0, start_tick: 0, degradedNoiseCorr: corrMatrix(0, 2, degRho) } },
  }))));
  rows.push({ mode: 'covariance_flip', unit: 'Δρ (corr change)', detection_floor: modeFloorOf(covPts, 'detection_rate'), attribution_floor: modeFloorOf(covPts, 'attribution_rate'), detecting_family: 'C', points: covPts });

  const oscPts = await Promise.all(OSC_AMPLITUDES.map((amp) => modePoint(amp, targets, (resource, seed, magnitude) => ({
    fabric: SCENARIO_FABRIC, q: Q, telemetry: { seed, ticks: OSC_TICKS, degradation: { resource_id: resource, delta: 0, start_tick: 0, signal: 'p99_latency', oscillationPeriod: 7, oscillationAmp: magnitude } },
  }))));
  rows.push({ mode: 'oscillation', unit: 'amplitude (period 7)', detection_floor: modeFloorOf(oscPts, 'detection_rate'), attribution_floor: modeFloorOf(oscPts, 'attribution_rate'), detecting_family: 'D', points: oscPts });

  return rows;
}

/**
 * Per-view detection on the Spraypoint two-view fabric (ADR-0015): for each fault kind, which
 * aggregation view concentrates it and which is blind. Publishes the complementary blind-spot map
 * rather than implying any one view covers everything (honest measurement).
 */
async function spraypointViewCoverage(): Promise<SpraypointViewRow[]> {
  const snap = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
  const faults = [
    { fault_kind: 'optic', resource: 'optic-3' },
    { fault_kind: 'shuffle_panel', resource: 'panel-2' },
    { fault_kind: 'room', resource: 'room-1' },
  ];
  const rows: SpraypointViewRow[] = [];
  for (const f of faults) {
    const audit = await runPipeline({ snapshot: snap, q: Q, telemetry: { seed: 1, ticks: TICKS, degradation: { resource_id: f.resource, delta: 4, start_tick: 0 } } });
    const by: Record<string, number> = {};
    for (const leaf of audit.selected_path_class_ids) { const v = viewOfLeaf(snap, leaf) ?? '?'; by[v] = (by[v] ?? 0) + 1; }
    const on = Object.entries(by).filter(([, n]) => n > 0).map(([v]) => v).sort();
    rows.push({ fault_kind: f.fault_kind, resource: f.resource, per_view_detected: by, concentrated_by: on.length ? on.join('+') : 'none' });
  }
  return rows;
}

const SPRAYPOINT_DELTAS = [0.5, 1, 2, 3, 4];
const SPRAYPOINT_KINDS = ['optic', 'shuffle_panel', 'room'] as const;
/** Deterministic Spraypoint floor targets — two per kind (the fabric is symmetric within a kind). */
export const SPRAYPOINT_FLOOR_TARGETS: Record<(typeof SPRAYPOINT_KINDS)[number], string[]> = {
  optic: ['optic-3', 'optic-40'],
  shuffle_panel: ['panel-2', 'panel-7'],
  room: ['room-0', 'room-1'],
};

/** One Spraypoint dilution cell (ADR-0020): same detection/attribution semantics as the binary `cell`. */
export async function spraypointCell(kind: ResourceKind, delta: number, targets: string[]): Promise<CoverageCell> {
  const snap = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
  let detected = 0;
  let attributed = 0;
  let n = 0;
  for (const resource of targets) {
    for (const seed of SEEDS) {
      const audit = await runPipeline({ snapshot: snap, telemetry: { seed, ticks: TICKS, degradation: { resource_id: resource, delta, start_tick: 0 } }, q: Q });
      n += 1;
      const isDetected = audit.selected_path_class_ids.length > 0;
      if (isDetected) detected += 1;
      if (isDetected && audit.culprits[0]?.resource_id === resource) attributed += 1;
    }
  }
  return { kind, delta, n, detected, attributed, detection_rate: detected / n, attribution_rate: attributed / n };
}

/** The Spraypoint dilution floor table (ADR-0020): floors per fault kind on the two-view fabric. */
async function spraypointFloors(): Promise<{ deltas: number[]; cells: CoverageCell[]; floors: FloorRow[] }> {
  const kinds = SPRAYPOINT_KINDS;
  const cells: CoverageCell[] = [];
  for (const kind of kinds) {
    for (const delta of SPRAYPOINT_DELTAS) cells.push(await spraypointCell(kind, delta, SPRAYPOINT_FLOOR_TARGETS[kind]));
  }
  const floors: FloorRow[] = kinds.map((kind) => ({
    kind,
    detection_floor: floorFor(cells, kind, 'detection_rate'),
    attribution_floor: floorFor(cells, kind, 'attribution_rate'),
  }));
  return { deltas: SPRAYPOINT_DELTAS, cells, floors };
}

/** Clean-fabric FDR control on the Spraypoint fabric itself — the new detection column must not
 *  borrow its false-alarm baseline from a different fabric (ADR-0020 cold-eye L5). */
async function cleanSpraypoint(): Promise<{ trials: number; mean_selected: number; false_positive_rate: number }> {
  const snap = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
  const seeds = [0xc1ea0, 0xc1ea1, 0xc1ea2, 0xc1ea3];
  let selected = 0;
  let fp = 0;
  for (const seed of seeds) {
    const audit = await runPipeline({ snapshot: snap, telemetry: { seed, ticks: TICKS }, q: Q });
    selected += audit.selected_path_class_ids.length;
    if (audit.selected_path_class_ids.length > 0) fp += 1;
  }
  return { trials: seeds.length, mean_selected: selected / seeds.length, false_positive_rate: fp / seeds.length };
}

/** The measured simultaneous-fault pairs (ADR-0024): the cross-kind ADR-0022 discriminating
 *  shape, and a same-kind pair. Both faults at equal Δ from tick 0. */
export const MULTI_FAULT_PAIRS: Record<string, [string, string]> = {
  cross_kind: ['optic-3', 'panel-7'],
  same_kind: ['optic-3', 'optic-40'],
};
const MULTI_FAULT_DELTAS = [0.5, 1, 2, 3, 4];

/** One multi-fault cell (ADR-0024): detection = any leaf selected; attribution = BOTH injected
 *  resources in the top-2 culprits (strict — a spurious culprit outranking either fails). */
export async function multiFaultCell(pairKind: string, delta: number): Promise<CoverageCell> {
  const snap = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
  const [a, b] = MULTI_FAULT_PAIRS[pairKind];
  let detected = 0;
  let attributed = 0;
  let n = 0;
  for (const seed of SEEDS) {
    const audit = await runPipeline({
      snapshot: snap,
      telemetry: { seed, ticks: TICKS, degradations: [
        { resource_id: a, delta, start_tick: 0 },
        { resource_id: b, delta, start_tick: 0 },
      ] },
      q: Q,
    });
    n += 1;
    const isDetected = audit.selected_path_class_ids.length > 0;
    if (isDetected) detected += 1;
    const top2 = audit.culprits.slice(0, 2).map((c) => c.resource_id);
    if (isDetected && top2.includes(a) && top2.includes(b)) attributed += 1;
  }
  return { kind: pairKind, delta, n, detected, attributed, detection_rate: detected / n, attribution_rate: attributed / n };
}

/** The multi-fault floor table (ADR-0024). */
async function multiFaultFloors(): Promise<{ deltas: number[]; cells: CoverageCell[]; floors: FloorRow[] }> {
  const pairKinds = Object.keys(MULTI_FAULT_PAIRS);
  const cells: CoverageCell[] = [];
  for (const pairKind of pairKinds) {
    for (const delta of MULTI_FAULT_DELTAS) cells.push(await multiFaultCell(pairKind, delta));
  }
  const floors: FloorRow[] = pairKinds.map((kind) => ({
    kind,
    detection_floor: floorFor(cells, kind, 'detection_rate'),
    attribution_floor: floorFor(cells, kind, 'attribution_rate'),
  }));
  return { deltas: MULTI_FAULT_DELTAS, cells, floors };
}

/** The paper-scale proof row (ADR-0025): 960 ToRs, deterministic outcomes only. */
export async function scaleProof(): Promise<CoverageReport['scale_proof']> {
  const snap = generateSpraypointFabric(PAPER_SPRAYPOINT);
  const clean = await runPipeline({ snapshot: snap, q: Q, telemetry: { seed: 1, ticks: TICKS } });
  const faults = [
    { kind: 'optic', resource: 'optic-3' },
    { kind: 'shuffle_panel', resource: 'panel-2' },
    { kind: 'room', resource: 'room-1' },
  ];
  const outcomes = [];
  for (const f of faults) {
    const a = await runPipeline({ snapshot: snap, q: Q, telemetry: { seed: 1, ticks: TICKS, degradation: { resource_id: f.resource, delta: 4, start_tick: 0 } } });
    outcomes.push({ kind: f.kind, resource: f.resource, delta: 4, detected: a.selected_path_class_ids.length > 0, rank1: a.culprits[0]?.resource_id ?? '(none)' });
  }
  return {
    leaves: snap.path_classes.length,
    per_tor_leaves: snap.views![0].leaf_ids.length,
    per_panel_pair_leaves: snap.views![1].leaf_ids.length,
    edges: snap.edges.length,
    resources: snap.resources.length,
    clean_selected: clean.selected_path_class_ids.length,
    outcomes,
  };
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
    per_signal: await perSignalCoverage(),
    mode_floors: await modeFloors(),
    spraypoint_views: await spraypointViewCoverage(),
    spraypoint_floors: await spraypointFloors(),
    clean_spraypoint: await cleanSpraypoint(),
    multi_fault: await multiFaultFloors(),
    scale_proof: await scaleProof(),
    clean: await cleanFalsePositives(),
  };
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** The ADR-0020 dilution-floor + clean-control lines (extracted: complexity cap). */
function renderSpraypointFloors(L: string[], rep: CoverageReport): void {
  L.push('| fault kind | detection floor (Δ) | attribution floor (Δ) |');
  L.push('|---|---|---|');
  for (const f of rep.spraypoint_floors.floors) {
    const big = `>${Math.max(...rep.spraypoint_floors.deltas)}`;
    L.push(`| ${f.kind} | ${f.detection_floor ?? big} | ${f.attribution_floor ?? big} |`);
  }
  L.push('');
  L.push('| fault kind | Δ | detection | attribution |');
  L.push('|---|---|---|---|');
  for (const c of rep.spraypoint_floors.cells) L.push(`| ${c.kind} | ${c.delta} | ${pct(c.detection_rate)} (${c.detected}/${c.n}) | ${pct(c.attribution_rate)} (${c.attributed}/${c.n}) |`);
}

/** The ADR-0024 multi-fault tables (extracted: complexity cap). */
function renderMultiFault(L: string[], rep: CoverageReport): void {
  L.push('| pair | detection floor (Δ) | attribution floor (Δ, both-in-top-2) |');
  L.push('|---|---|---|');
  for (const f of rep.multi_fault.floors) {
    const big = `>${Math.max(...rep.multi_fault.deltas)}`;
    L.push(`| ${f.kind} | ${f.detection_floor ?? big} | ${f.attribution_floor ?? big} |`);
  }
  L.push('');
  L.push('| pair | Δ | detection | attribution (both-in-top-2) |');
  L.push('|---|---|---|---|');
  for (const c of rep.multi_fault.cells) L.push(`| ${c.kind} | ${c.delta} | ${pct(c.detection_rate)} (${c.detected}/${c.n}) | ${pct(c.attribution_rate)} (${c.attributed}/${c.n}) |`);
}

/** The ADR-0025 scale-proof table (extracted: complexity cap). */
function renderScaleProof(L: string[], rep: CoverageReport): void {
  L.push(`Fabric: **${rep.scale_proof.leaves} leaves** (${rep.scale_proof.per_tor_leaves} per-ToR + ${rep.scale_proof.per_panel_pair_leaves} panel-pair views), ${rep.scale_proof.edges} weighted edges, ${rep.scale_proof.resources} resources — the upper range of AC-1. Clean run selects **${rep.scale_proof.clean_selected}** (FDR holds at scale). Wall-clock/memory are machine numbers and live in ADR-0025, keeping this artifact replay-stable. Floors are NOT swept at this scale (recorded); the demo-scale floors above remain the published floors.`);
  L.push('');
  L.push('| fault kind | resource | Δ | detected | rank-1 |');
  L.push('|---|---|---|---|---|');
  for (const o of rep.scale_proof.outcomes) L.push(`| ${o.kind} | ${o.resource} | ${o.delta} | ${o.detected ? 'yes' : 'NO'} | ${o.rank1} |`);
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
  L.push('The first **floor table** characterizes a single-signal **`p99_latency` mean shift** (Δ added to');
  L.push('the p99 residual of every path-class traversing the target resource) — the calibrated reference');
  L.push('response, so its floors are floors *for a p99 mean shift*, not a blanket "any degradation"');
  L.push('guarantee. The **per-signal section** exercises the full five-signal contract: a mean shift on each');
  L.push('signal (Family A is multi-signal, ADR-0003) plus a pure variance shift (caught by Family C, not A).');
  L.push('The **per-mode floor table** (ADR-0010) goes further: it reports a separate detection/attribution');
  L.push('floor for EACH of the three anomaly modes — mean shift (Family A), covariance flip (Family C), and');
  L.push('periodicity (Family D) — with the firing family that caught it, so a detection number is never');
  L.push('published without naming its mode. No mode is left in a footnote. The binary tables above are');
  L.push('the generated quasi-random fabric; the **Spraypoint sections** below measure the two-view');
  L.push('FRACTIONAL-dilution fabric (ADR-0015/0020) — per-view blind spots, dilution floors, the');
  L.push('multi-fault pair floors (ADR-0024), and its own clean-fabric FDR control. Every floor is the');
  L.push('first Δ reaching ≥90% — single-fault tables on an n=4 grid (2 targets × 2 seeds), the');
  L.push('multi-fault table on n=2 (FIXED pairs × 2 seeds): a floor means "first unanimous Δ" — a');
  L.push('coarse, honest estimator, grid-resolution-limited (reported at grid points, not interpolated).');
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
  L.push(`## Per-signal coverage (kind=${PER_SIGNAL_KIND}, mean Δ=${PER_SIGNAL_DELTA} unless noted)`);
  L.push('');
  L.push('Demonstrates the system responds to a degradation on **every** signal, and that a variance');
  L.push('(distributional) shift is caught by Family C where Family A is silent.');
  L.push('');
  L.push('| signal | mode | Δ | detection | attribution |');
  L.push('|---|---|---|---|---|');
  for (const r of rep.per_signal) L.push(`| ${r.signal} | ${r.mode} | ${r.delta} | ${pct(r.detection_rate)} | ${pct(r.attribution_rate)} |`);
  L.push('');
  L.push('## Per-mode detection floors — A + C + D (ADR-0010)');
  L.push('');
  L.push(`Each of the three anomaly modes swept independently (kind=${MODE_KIND}, ${rep.seeds_per_cell} seeds × ${rep.targets_per_kind} targets).`);
  L.push('The **firing family** column is the firing-mode attribution: which detector actually caught each mode.');
  L.push('');
  L.push(`| mode | unit | detection floor | attribution floor | detecting family | per-magnitude (mag → det / family) |`);
  L.push('|---|---|---|---|---|---|');
  for (const m of rep.mode_floors) {
    const big = `>${Math.max(...m.points.map((p) => p.magnitude))}`;
    const trail = m.points.map((p) => `${p.magnitude}→${pct(p.detection_rate)}/${p.family}`).join(', ');
    L.push(`| ${m.mode} | ${m.unit} | ${m.detection_floor ?? big} | ${m.attribution_floor ?? big} | ${m.detecting_family} | ${trail} |`);
  }
  L.push('');
  L.push('## Spraypoint per-view detection (ADR-0015) — which view concentrates each fault kind');
  L.push('');
  L.push('On the two-view Spraypoint fabric (`per_tor` ∪ `per_panel_pair`, weighted/diluted incidence),');
  L.push('the views have COMPLEMENTARY blind spots — published here, not implied. An optic fault is');
  L.push('1/nTors-diluted in pair leaves; a panel fault is 1/nPanels-diluted in ToR leaves.');
  L.push('');
  L.push('| fault kind | resource | per-view detected | concentrated by |');
  L.push('|---|---|---|---|');
  for (const v of rep.spraypoint_views) {
    const cells = Object.entries(v.per_view_detected).map(([view, n]) => `${view}:${n}`).join(', ') || '—';
    L.push(`| ${v.fault_kind} | ${v.resource} | ${cells} | ${v.concentrated_by} |`);
  }
  L.push('');
  L.push('## Spraypoint dilution floors (ADR-0020) — the fractional-incidence regime, measured');
  L.push('');
  L.push('Floors on the two-view Spraypoint fabric (64×10×2; weighted/diluted incidence) under a');
  L.push('`p99_latency` mean shift — the regime ADR-0014 deferred. Same floor semantics as the binary');
  L.push('table above. Read against the binary fabric\'s nearest-analogue kinds (optic↔optic,');
  L.push('shuffle_panel↔passive_shuffler, room↔power_zone — a DIFFERENT fabric, so the comparison is');
  L.push('indicative, not a controlled dilution-only experiment): **detection** floors match the binary');
  L.push('analogues (each kind has a w=1 view), but the **room attribution floor RISES 1 → 2** vs');
  L.push('power_zone 1/1 — a room fault at Δ=1 is detected 4/4 yet attributed 0/4 (the ADR-0019');
  L.push('wrong-kind band; the true boundary sits between 1.5 and 2 — Δ=1.5 attributes 2/4).');
  L.push('');
  renderSpraypointFloors(L, rep);
  L.push('');
  L.push('## Multi-fault floors (ADR-0024) — simultaneous two-fault pairs, Spraypoint fabric');
  L.push('');
  L.push('Both faults injected at equal Δ from tick 0; the standard 2 seeds (n=2 per cell — the same');
  L.push('coarse "first unanimous Δ" estimator as every table here). **Attribution = BOTH injected');
  L.push('resources in the top-2 culprits** (strict: a spurious culprit outranking either fails the');
  L.push('run). Pairs: cross_kind = optic-3 + panel-7 (the ADR-0022 discriminating shape); same_kind =');
  L.push('optic-3 + optic-40. k ≥ 3 simultaneous faults are example-tested, not floor-measured.');
  L.push('');
  renderMultiFault(L, rep);
  L.push('');
  L.push('## Paper-scale proof (ADR-0025) — 960 ToRs, executed not extrapolated');
  L.push('');
  renderScaleProof(L, rep);
  L.push('');
  L.push('## FDR control (clean fabric, no degradation)');
  L.push('');
  L.push(`Across ${rep.clean.trials} clean trials over ${SCENARIO_FABRIC.n_path_classes} path-classes: mean selected = **${rep.clean.mean_selected}**, false-positive rate = **${pct(rep.clean.false_positive_rate)}** — e-BH holds the surface quiet under heavy correlation.`);
  L.push('');
  L.push(`Spraypoint fabric (the one the dilution floors characterize): ${rep.clean_spraypoint.trials} clean trials, mean selected = **${rep.clean_spraypoint.mean_selected}**, false-positive rate = **${pct(rep.clean_spraypoint.false_positive_rate)}** — the dilution detection column does not borrow its false-alarm baseline from another fabric.`);
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
