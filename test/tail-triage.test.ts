/**
 * ADR-0058 — tail triage acceptance bar.
 *
 * Anti-self-confirming (DISCIPLINES §6): AC-1 tests BOTH directions with equal-magnitude
 * inflations — resource-aligned vs incidence-scattered — so an incidence-blind mutant
 * (always-fault or always-drift) dies on one of the pair; AC-3 replays the ADR-0053 AC-4
 * fixture end-to-end (monitor says drifted/tail → triage names the resource), closing the
 * recorded ambiguity in the direction the monitor could not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTelemetry } from '../src/telemetry';
import { buildCalibration, standardizeAll } from '../src/calibration';
import { estimateDispersion } from '../src/dispersion-gate';
import { driftMonitor } from '../src/drift-monitor';
import { tailTriage } from '../src/tail-triage';
import type { FaultDomainSnapshot, PathClassId } from '../src/domain';

const t9 = (pc: string, r: string) => ({ path_class: pc, resource: r, relationship: 'traverses' as const });
const pcs = Array.from({ length: 20 }, (_, i) => `pc-${String(i).padStart(2, '0')}`);
const SNAP: FaultDomainSnapshot = {
  nodes: [],
  path_classes: pcs,
  edges: [...pcs.map((pc, i) => t9(pc, `r-own-${i}`)), t9('pc-00', 'r-hot'), t9('pc-01', 'r-hot')],
  resources: [...pcs.map((_, i) => ({ id: `r-own-${i}`, kind: 'optic' as const })), { id: 'r-hot', kind: 'shuffle_panel' as const }],
  fetched_at_ts: 0,
  source_id: 's',
  source_version: 'v',
};
const TICKS = 60;

/** Clean standardized residuals for the 20-leaf fixture (calibrate + standardize a clean window). */
function cleanResiduals(seed: number): Map<PathClassId, number[][]> {
  const calRaw = generateTelemetry(SNAP, { seed: seed ^ 0xca11b, ticks: TICKS });
  const sub = buildCalibration(calRaw.series, { robust: true });
  const live = generateTelemetry(SNAP, { seed, ticks: TICKS });
  return standardizeAll(live.series, sub);
}

/** Scale the named leaves' residual rows ×k — an equal-magnitude inflation for both AC-1 arms. */
function inflate(resid: Map<PathClassId, number[][]>, ids: readonly string[], k: number): Map<PathClassId, number[][]> {
  const out = new Map(resid);
  for (const id of ids) out.set(id, out.get(id)!.map((row) => row.map((x) => k * x)));
  return out;
}

test('AC-1: a resource-ALIGNED inflation triages fault-shaped with full coverage; an equal-magnitude SCATTERED inflation triages drift-shaped', () => {
  const base = cleanResiduals(5);
  const aligned = tailTriage(SNAP, inflate(base, ['pc-00', 'pc-01'], 2.5));
  assert.equal(aligned.verdict, 'fault-shaped', 'the r-hot pair must read fault-shaped');
  assert.equal(aligned.culprits[0]?.resource_id, 'r-hot', 'and name the shared resource');
  assert.ok(aligned.top_coverage >= 0.9, `top coverage ${aligned.top_coverage} must be ≥ 0.9`);
  assert.equal(aligned.tail.length, 2, 'exactly the inflated pair is tail');

  const scattered = tailTriage(SNAP, inflate(base, ['pc-03', 'pc-08', 'pc-14'], 2.5));
  assert.equal(scattered.verdict, 'drift-shaped', 'incidence-scattered inflation must read drift-shaped');
  assert.ok(scattered.top_coverage < 0.6, `no single resource may cover the scattered tail (top ${scattered.top_coverage})`);
  assert.equal(scattered.tail.length, 3, 'exactly the inflated trio is tail');
});

test('AC-1b (the cold-eye CRITICAL, bound): on DEFAULT_SPRAYPOINT — full-support crossOptic incidence — a scattered tail still reads drift-shaped', async () => {
  // Provenance-based coverage read this exact case as fault-shaped with coverage 1.0 (every tor
  // leaf traverses every optic at 1/63, so every culprit's member list contained the whole
  // tail). Material-weight coverage (w ≥ 0.5) must restore the discriminator.
  const { generateSpraypointFabric, DEFAULT_SPRAYPOINT } = await import('../src/spraypoint');
  const SP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
  const calRaw = generateTelemetry(SP, { seed: 5 ^ 0xca11b, ticks: TICKS });
  const sub = buildCalibration(calRaw.series, { robust: true });
  const live = generateTelemetry(SP, { seed: 5, ticks: TICKS });
  const resid = standardizeAll(live.series, sub);
  const scatteredIds = [...resid.keys()].filter((pc) => pc.startsWith('tor-')).filter((_, i) => i % 20 === 3).slice(0, 3);
  assert.equal(scatteredIds.length, 3, 'need three scattered tor leaves');
  const scattered = tailTriage(SP, inflate(resid, scatteredIds, 2.5));
  assert.equal(scattered.verdict, 'drift-shaped', `scattered inflation on the full-support fabric must read drift-shaped (top coverage ${scattered.top_coverage})`);
  assert.ok(scattered.top_coverage < 0.6, 'no resource is MATERIALLY incident on the scattered tail');
});

test('AC-2b (cold-eye finding 2): a singleton tail reads indeterminate — one drifted leaf and a one-leaf fault are indistinguishable by incidence', () => {
  const base = cleanResiduals(9);
  const single = tailTriage(SNAP, inflate(base, ['pc-07'], 2.5));
  assert.equal(single.verdict, 'indeterminate');
  assert.equal(single.tail.length, 1);
  assert.equal(single.culprits.length, 0, 'no culprit is fabricated for an unresolvable tail');
});

test('AC-2: clean residuals ⇒ no-tail, nothing fabricated; degenerate/invalid inputs throw', () => {
  const r = tailTriage(SNAP, cleanResiduals(7));
  assert.equal(r.verdict, 'no-tail');
  assert.equal(r.tail.length, 0);
  assert.equal(r.culprits.length, 0);
  assert.throws(() => tailTriage(SNAP, cleanResiduals(7), { zThreshold: 0 }), /zThreshold/);
  assert.throws(() => tailTriage(SNAP, cleanResiduals(7), { minExplained: 1.5 }), /minExplained/);
});

test('AC-3: the ADR-0053 AC-4 fixture end-to-end — the monitor reads drifted/tail, the triage names r-hot (the recorded ambiguity closed)', () => {
  const calRaw = generateTelemetry(SNAP, { seed: 5 ^ 0xca11b, ticks: TICKS });
  const sub = buildCalibration(calRaw.series, { robust: true });
  const live = generateTelemetry(SNAP, { seed: 5, ticks: TICKS, degradation: { resource_id: 'r-hot', delta: 4, start_tick: 0, mode: 'variance' } });
  const resid = standardizeAll(live.series, sub);
  const monitor = driftMonitor(estimateDispersion(resid));
  assert.equal(monitor.status, 'drifted');
  assert.equal(monitor.pattern, 'tail', 'precondition: this is exactly the ambiguous reading ADR-0053 recorded');
  const triage = tailTriage(SNAP, resid);
  assert.equal(triage.verdict, 'fault-shaped', 'the bridge must resolve the ambiguity toward the genuine fault');
  assert.equal(triage.culprits[0]?.resource_id, 'r-hot', 'and name the faulted resource');
});
