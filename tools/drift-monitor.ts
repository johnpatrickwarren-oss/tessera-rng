/**
 * Runtime drift monitor — detection envelope (ADR-0053).
 *
 * The published proof that the ADR-0052 cliff now has a detector, plus the monitor's honest
 * operating envelope: (1) cliff detection under perLeafScale at the RECOMMENDED regime
 * threshold (0.07 — fresh corrections carry ≈0.03–0.06 out-of-sample correction noise, so the
 * shared-calibration default ς* = 0.05 sits on the fresh-noise edge; measured separation on the
 * 8-seed envelope set: fresh ≤ 0.0594 / half-drift ≥ 0.081 / full ≈ 0.26 — margin to the 0.07
 * threshold 0.0106 below, 0.011 above); (2) the shared-calibration regime at the
 * default threshold (clean floor 0.009 — same estimator the gate runs, now on the live
 * window); (3) pattern attribution (subpopulation fault → tail; single-leaf fault → correctly
 * ignored); (4) resolvability (a window whose floor exceeds the threshold reads indeterminate,
 * never ok). False-selection columns recompute the ADR-0052 cells (same seeds — deterministic
 * agreement with the published per-leaf-scale artifact).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { generateTelemetry } from '../src/telemetry';
import type { HeterogeneitySpec } from '../src/telemetry';
import { buildCalibration, standardizeAll } from '../src/calibration';
import { estimateDispersion, DEFAULT_SIGMA_THRESHOLD } from '../src/dispersion-gate';
import { driftMonitor } from '../src/drift-monitor';
import type { DriftMonitorVerdict } from '../src/drift-monitor';
import { runNullRun } from './heterogeneity';
import type { FaultDomainSnapshot } from '../src/domain';

const SEEDS = [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04, 0xb0a05, 0xb0a06, 0xb0a07, 0xb0a08];
const TICKS = 60;
/** Recommended perLeafScale-regime threshold (measured; see file header + ADR-0053 §2). */
export const PER_LEAF_SCALE_MONITOR_THRESHOLD = 0.07;

const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);

function monitorUnder(seed: number, opts: { calHet?: HeterogeneitySpec; liveHet?: HeterogeneitySpec; perLeafScale?: boolean; threshold?: number; ticks?: number }): DriftMonitorVerdict {
  const ticks = opts.ticks ?? TICKS;
  const calRaw = generateTelemetry(SNAP, { seed: seed ^ 0xca11b, ticks, ...(opts.calHet ? { heterogeneity: { ...opts.calHet, driftMix: 0 } } : {}) });
  const sub = buildCalibration(calRaw.series, { robust: true, perLeafScale: opts.perLeafScale ?? false });
  const live = generateTelemetry(SNAP, { seed, ticks, ...(opts.liveHet ? { heterogeneity: opts.liveHet } : {}) });
  return driftMonitor(estimateDispersion(standardizeAll(live.series, sub)), opts.threshold ?? DEFAULT_SIGMA_THRESHOLD);
}

export interface MonitorCell {
  label: string;
  threshold: number;
  ok_rate: number;
  drifted_rate: number;
  indeterminate_rate: number;
  fleet_rate: number;
  mean_sigma_hat: number;
  mean_sigma_hat_tail: number;
  mean_false_selections: number | null;
  n: number;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function cellOf(label: string, threshold: number, verdicts: readonly DriftMonitorVerdict[], falseSel: readonly number[] | null): MonitorCell {
  return {
    label,
    threshold,
    ok_rate: verdicts.filter((v) => v.status === 'ok').length / verdicts.length,
    drifted_rate: verdicts.filter((v) => v.status === 'drifted').length / verdicts.length,
    indeterminate_rate: verdicts.filter((v) => v.status === 'indeterminate').length / verdicts.length,
    fleet_rate: verdicts.filter((v) => v.pattern === 'fleet').length / verdicts.length,
    mean_sigma_hat: mean(verdicts.map((v) => v.sigma_hat)),
    mean_sigma_hat_tail: mean(verdicts.map((v) => v.sigma_hat_tail)),
    mean_false_selections: falseSel ? mean(falseSel) : null,
    n: verdicts.length,
  };
}

export interface MonitorReport {
  generated_for: string;
  operating_point: string;
  cliff: MonitorCell[];
  shared: MonitorCell[];
  pattern: { label: string; verdicts: { status: string; pattern: string | null }[] }[];
  resolvability: MonitorCell[];
  caveat: string;
}

export function computeMonitorEnvelope(log: (m: string) => void = () => {}): MonitorReport {
  // 1 — the ADR-0052 cliff, at the recommended perLeafScale threshold.
  const cliff: MonitorCell[] = [];
  for (const m of [0, 0.25, 0.5, 1]) {
    log(`cliff driftMix=${m}…`);
    const het = { sigmaLogSd: 0.2, driftMix: m };
    const verdicts = SEEDS.map((s) => monitorUnder(s, { calHet: het, liveHet: het, perLeafScale: true, threshold: PER_LEAF_SCALE_MONITOR_THRESHOLD }));
    const falseSel = SEEDS.map((s) => runNullRun(SNAP, s, { heterogeneity: het, perLeafScale: true }).false_selections);
    cliff.push(cellOf(`driftMix ${m}`, PER_LEAF_SCALE_MONITOR_THRESHOLD, verdicts, falseSel));
  }
  // 2 — shared-calibration regime at the default threshold.
  const shared: MonitorCell[] = [];
  for (const s of [0, 0.1, 0.2]) {
    log(`shared ς=${s}…`);
    const het = s > 0 ? { sigmaLogSd: s } : undefined;
    const verdicts = SEEDS.map((seed) => monitorUnder(seed, { calHet: het, liveHet: het }));
    const falseSel = SEEDS.map((seed) => runNullRun(SNAP, seed, het ? { heterogeneity: het } : {}).false_selections);
    shared.push(cellOf(`ς ${s}`, DEFAULT_SIGMA_THRESHOLD, verdicts, falseSel));
  }
  // 3 — pattern attribution (recorded fixtures; single seeds, deterministic).
  log('pattern fixtures…');
  const t9 = (pc: string, r: string) => ({ path_class: pc, resource: r, relationship: 'traverses' as const });
  const pcs = Array.from({ length: 20 }, (_, i) => `pc-${String(i).padStart(2, '0')}`);
  const subSnap: FaultDomainSnapshot = {
    nodes: [],
    path_classes: pcs,
    edges: [...pcs.map((pc, i) => t9(pc, `r-own-${i}`)), t9('pc-00', 'r-hot'), t9('pc-01', 'r-hot')],
    resources: [...pcs.map((_, i) => ({ id: `r-own-${i}`, kind: 'optic' as const })), { id: 'r-hot', kind: 'shuffle_panel' as const }],
    fetched_at_ts: 0,
    source_id: 's',
    source_version: 'v',
  };
  const patternRun = (snap: FaultDomainSnapshot, resource: string): { status: string; pattern: string | null } => {
    const calRaw = generateTelemetry(snap, { seed: 5 ^ 0xca11b, ticks: TICKS });
    const sub = buildCalibration(calRaw.series, { robust: true });
    const live = generateTelemetry(snap, { seed: 5, ticks: TICKS, degradation: { resource_id: resource, delta: 4, start_tick: 0, mode: 'variance' } });
    const v = driftMonitor(estimateDispersion(standardizeAll(live.series, sub)));
    return { status: v.status, pattern: v.pattern };
  };
  const pattern = [
    { label: 'subpopulation variance fault (2/20 leaves, δ=4) → expect drifted/tail', verdicts: [patternRun(subSnap, 'r-hot')] },
    { label: 'single-leaf single-signal variance fault on DEFAULT fabric (δ=3) → expect ok (correctly ignored)', verdicts: [(() => {
      const calRaw = generateTelemetry(SNAP, { seed: 5 ^ 0xca11b, ticks: TICKS });
      const sub = buildCalibration(calRaw.series, { robust: true });
      const live = generateTelemetry(SNAP, { seed: 5, ticks: TICKS, degradation: { resource_id: 'optic-3', delta: 3, start_tick: 0, mode: 'variance' } });
      const v = driftMonitor(estimateDispersion(standardizeAll(live.series, sub)));
      return { status: v.status, pattern: v.pattern };
    })()] },
  ];
  // 4 — resolvability: T=40's floor (0.051) exceeds ς* = 0.05.
  log('resolvability…');
  const resolvability = [cellOf('T=40 @ ς*=0.05 (floor 0.051)', DEFAULT_SIGMA_THRESHOLD, SEEDS.map((s) => monitorUnder(s, { ticks: 40 })), null)];
  return {
    generated_for: `spraypoint:${DEFAULT_SPRAYPOINT.nTors}x${DEFAULT_SPRAYPOINT.nPanels}x${DEFAULT_SPRAYPOINT.nRooms}`,
    operating_point: `T=${TICKS}; thresholds: shared-calibration default ς*=${DEFAULT_SIGMA_THRESHOLD} (clean-fabric ς̂ ≈ 0.009), perLeafScale regime ${PER_LEAF_SCALE_MONITOR_THRESHOLD} (fresh-correction noise ≈0.03–0.06, max 0.0594 on this seed set — measured, regime-dependent)`,
    cliff,
    shared,
    pattern,
    resolvability,
    caveat:
      'Synthetic Tier-2. The false-selection columns recompute the ADR-0050/0052 cells (same seeds). The ' +
      'monitor gates the CLAIM, never the alarm; license rule (ADR-0060, superseding the original gate-AND-monitor phrasing): per-leaf construction AND monitor ok. ' +
      'Tail pattern is AMBIGUOUS between subpopulation drift and genuine localized variance faults — ' +
      'recorded, the claim is withheld either way. Thresholds are synthetic-boundary-derived (Tier 3: ' +
      'real deployments re-derive).',
  };
}

export function renderMarkdown(rep: MonitorReport): string {
  const L: string[] = [];
  L.push('# Tessera-RNG — runtime drift monitor: detection envelope (ADR-0053)');
  L.push('');
  L.push(`Operating point: ${rep.generated_for}; ${rep.operating_point}.`);
  L.push('');
  L.push(`> ${rep.caveat}`);
  L.push('');
  const table = (cells: readonly MonitorCell[], title: string) => {
    L.push(`## ${title}`);
    L.push('');
    L.push('| cell | thr | ok | drifted | indet | fleet | mean ς̂ | mean tail ς̂ | mean false sel | n |');
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const c of cells) {
      L.push(
        `| ${c.label} | ${c.threshold} | ${Math.round(c.ok_rate * 100)}% | ${Math.round(c.drifted_rate * 100)}% | ${Math.round(c.indeterminate_rate * 100)}% | ${Math.round(c.fleet_rate * 100)}% | ${c.mean_sigma_hat.toFixed(3)} | ${c.mean_sigma_hat_tail.toFixed(3)} | ${c.mean_false_selections === null ? '—' : c.mean_false_selections.toFixed(2)} | ${c.n} |`,
      );
    }
    L.push('');
  };
  table(rep.cliff, 'Cliff detection (perLeafScale ON, the ADR-0052 D axis)');
  table(rep.shared, 'Shared-calibration regime (default threshold)');
  L.push('## Pattern attribution (recorded fixtures)');
  L.push('');
  for (const p of rep.pattern) L.push(`- ${p.label}: **${p.verdicts.map((v) => `${v.status}${v.pattern ? `/${v.pattern}` : ''}`).join(', ')}**`);
  L.push('');
  table(rep.resolvability, 'Resolvability (floor ≥ threshold must read indeterminate)');
  return L.join('\n');
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  const rep = computeMonitorEnvelope((m) => console.log(m));
  const outDir = join(process.cwd(), 'coverage-matrices');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'drift-monitor.json'), JSON.stringify(rep, null, 2));
  writeFileSync(join(outDir, 'drift-monitor.md'), renderMarkdown(rep));
  // eslint-disable-next-line no-console
  console.log('wrote coverage-matrices/drift-monitor.{json,md}');
}

if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
