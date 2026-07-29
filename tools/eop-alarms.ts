/**
 * Anytime-alarm envelope (ADR-0062): the measured half of the Ville rule's adoption.
 *
 * Clean fleets: ever-alarm counts per run vs the Ville bound (per-leaf scope: expected
 * ≤ N·α over ANY horizon; fleet scope at α/n: expected 0). Faulted runs: the first-alarm
 * tick of the faulted leaf — the anytime win over the fixed-time window read. Session-based
 * throughout (alarms are session-only semantics, ADR-0062).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { generateTelemetry } from '../src/telemetry';
import { calibrateForSession } from '../src/pipeline';
import { openSession } from '../src/session';
import type { PathClassId } from '../src/domain';
import type { SignalVector } from '../src/signals';

const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
const TICKS = 60;
const SEEDS = [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04, 0xb0a05, 0xb0a06, 0xb0a07, 0xb0a08];
const ALPHA = 0.05;

export function runSession(seed: number, scope: 'per-leaf' | 'fleet', degradation?: { resource_id: string; delta: number; start_tick: number }) {
  const telemetry = { seed, ticks: TICKS };
  const pre = calibrateForSession(SNAP, telemetry);
  const session = openSession({ snapshot: SNAP, calibration: pre.calibration, q: 0.05, ctx: pre.ctx, eopAlarms: { alpha: ALPHA, scope } });
  const live = generateTelemetry(SNAP, { ...telemetry, ...(degradation ? { degradation } : {}) });
  for (let t = 0; t < TICKS; t++) {
    const tick = new Map<PathClassId, SignalVector>();
    for (const [pc, series] of live.series) tick.set(pc, series[t]);
    session.ingest(tick);
  }
  return session.audit().eop_alarms!;
}

export interface EopReport {
  generated_for: string;
  operating_point: string;
  clean: { scope: string; threshold: number; alarm_counts: number[]; pooled_ever_alarm_fraction: number; guaranteed_bound: number; expected_count_reference: number }[];
  faulted: { target: string; leaf: string; first_alarm_ticks: (number | null)[]; alarmed: number; n: number }[];
  caveat: string;
}

export function computeEopEnvelope(log: (m: string) => void = () => {}): EopReport {
  const clean = (['per-leaf', 'fleet'] as const).map((scope) => {
    log(`clean/${scope}…`);
    const runs = SEEDS.map((s) => runSession(s, scope));
    const counts = runs.map((r) => r.alarms.length);
    const total = counts.reduce((a, b) => a + b, 0);
    return {
      scope,
      threshold: runs[0].threshold,
      alarm_counts: counts,
      // the GUARANTEED quantity is the per-leaf ever-alarm probability ≤ α_leaf — pooled
      // fraction across null leaf-streams; per-seed counts fluctuate binomially around
      // E ≤ N·α_leaf and are reference data, not the bound (ADR-0062 cold-eye finding 2).
      pooled_ever_alarm_fraction: total / (SEEDS.length * SNAP.path_classes.length),
      guaranteed_bound: scope === 'per-leaf' ? ALPHA : ALPHA / SNAP.path_classes.length,
      expected_count_reference: scope === 'per-leaf' ? SNAP.path_classes.length * ALPHA : ALPHA,
    };
  });
  const faulted = ['optic-3', 'optic-40'].map((target) => {
    log(`faulted/${target}…`);
    const leaf = `tor-${target.split('-')[1]}`;
    const ticks = SEEDS.map((s) => {
      const a = runSession(s, 'per-leaf', { resource_id: target, delta: 3, start_tick: 0 });
      return a.alarms.find((x) => x.path_class_id === leaf)?.at_tick ?? null;
    });
    return { target, leaf, first_alarm_ticks: ticks, alarmed: ticks.filter((t) => t !== null).length, n: SEEDS.length };
  });
  return {
    generated_for: `spraypoint:${DEFAULT_SPRAYPOINT.nTors}x${DEFAULT_SPRAYPOINT.nPanels}x${DEFAULT_SPRAYPOINT.nRooms}, sessions of T=${TICKS}`,
    operating_point: `α=${ALPHA}; per-leaf threshold 1/α=${1 / ALPHA}; fleet threshold n/α=${SNAP.path_classes.length / ALPHA}; alarm statistic = (A+C)/2 (D excluded, ADR-0044); δ=3 mean fault for the latency arm`,
    clean,
    faulted,
    caveat:
      'Synthetic Tier-2. THE GUARANTEE IS CONDITIONAL ON THE CALIBRATED NULL (ADR-0062): dispersion/drift ' +
      'voids it exactly as it voids e-BH validity (ADR-0050/0057 — real fleets measured far past the boundary); ' +
      'the alarm read carries the same gate/monitor (or perLeafScale) preconditions as the evidence surface. ' +
      'The guaranteed quantity is the per-leaf ever-alarm PROBABILITY ≤ α (pooled fraction column); per-seed ' +
      'counts fluctuate binomially around E ≤ N·α and are reference data. The Ville guarantee is over an ' +
      'INFINITE horizon — finite-window fractions sit under it a fortiori. Fleet scope buys fleet-wise ≤ α at ' +
      'a Bonferroni power cost. Alarms are DETECTION, not FDR claims (ADR-0060 untouched). First-alarm latency ' +
      'is the anytime win: the alarm fires mid-window with the guarantee intact at every tick.',
  };
}

export function renderMarkdown(rep: EopReport): string {
  const L: string[] = [];
  L.push('# Tessera-RNG — anytime alarms: the Ville-rule envelope (ADR-0062)');
  L.push('');
  L.push(`Operating point: ${rep.generated_for}; ${rep.operating_point}.`);
  L.push('');
  L.push(`> ${rep.caveat}`);
  L.push('');
  L.push('## Clean fleets (the guaranteed quantity is the pooled fraction; counts are reference)');
  L.push('');
  L.push('| scope | threshold | alarm counts (per seed; reference) | pooled ever-alarm fraction | guaranteed bound | E[count] ref |');
  L.push('|---|---|---|---|---|---|');
  for (const c of rep.clean) L.push(`| ${c.scope} | ${c.threshold} | ${c.alarm_counts.join(', ')} | ${(c.pooled_ever_alarm_fraction * 100).toFixed(2)}% | ≤ ${(c.guaranteed_bound * 100).toFixed(2)}% | ${c.expected_count_reference.toFixed(2)} |`);
  L.push('');
  L.push('## Faulted (δ=3): first-alarm tick of the faulted leaf');
  L.push('');
  L.push('| target | leaf | first-alarm ticks (per seed; — = no alarm) | alarmed | n |');
  L.push('|---|---|---|---|---|');
  for (const f of rep.faulted) L.push(`| ${f.target} | ${f.leaf} | ${f.first_alarm_ticks.map((t) => (t === null ? '—' : t)).join(', ')} | ${f.alarmed}/${f.n} | ${f.n} |`);
  L.push('');
  return L.join('\n');
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  const rep = computeEopEnvelope((m) => console.log(m));
  const outDir = join(process.cwd(), 'coverage-matrices');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'eop-alarms.json'), JSON.stringify(rep, null, 2));
  writeFileSync(join(outDir, 'eop-alarms.md'), renderMarkdown(rep));
  // eslint-disable-next-line no-console
  console.log('wrote coverage-matrices/eop-alarms.{json,md}');
}

if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
