import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../src/pipeline';
import type { PipelineParams } from '../src/pipeline';
import { generateFabric } from '../src/fabric';

const FABRIC = { seed: 0x7e55e4a, n_path_classes: 200, n_optics: 48, n_shufflers: 12, n_bundles: 18, n_power_zones: 4, n_cooling_zones: 4 };

function mostTraversedShuffler(): string {
  const snap = generateFabric(FABRIC);
  const counts = new Map<string, number>();
  for (const e of snap.edges) {
    if (e.resource.startsWith('shuffler-')) counts.set(e.resource, (counts.get(e.resource) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

test('clean baseline: no firing, no culprits, no drain — and replay-clean', async () => {
  const params: PipelineParams = { fabric: FABRIC, telemetry: { seed: 7, ticks: 80 }, q: 0.05 };
  const a = await runPipeline(params);
  const b = await runPipeline(params);
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'same inputs -> byte-identical audit record (AC-9)');
  assert.equal(a.selected_path_class_ids.length, 0, 'clean fabric should select nothing under FDR control');
  assert.equal(a.culprits.length, 0);
  assert.equal(a.drain_actions.length, 0);
  assert.match(a.snapshot_hash, /^[0-9a-f]{64}$/);
});

test('single-shuffler common-mode: that shuffler is the rank-1 culprit and is (sim) drained', async () => {
  const target = mostTraversedShuffler();
  const params: PipelineParams = {
    fabric: FABRIC,
    telemetry: { seed: 7, ticks: 100, degradation: { resource_id: target, delta: 4, start_tick: 0 } },
    q: 0.05,
  };
  const rec = await runPipeline(params);

  assert.ok(rec.selected_path_class_ids.length > 0, 'the degraded path-classes should be selected');
  assert.equal(rec.culprits[0].resource_id, target, 'tomography localizes the common-mode resource');
  assert.equal(rec.culprits[0].resource_kind, 'passive_shuffler');
  assert.equal(rec.culprits[0].correlational_not_causal, true);
  assert.equal(rec.drain_actions[0].resource_id, target);
  assert.equal(rec.drain_actions[0].simulated, true);

  // replay-clean including localization (AC-9)
  const again = await runPipeline(params);
  assert.equal(JSON.stringify(rec), JSON.stringify(again));
});

test('TWO simultaneous faults: the set-cover returns BOTH culprits end-to-end, each with its own members; top-2 drains both (ADR-0021)', async () => {
  // the set-cover's "minimal explaining SET" claim, finally exercised by real telemetry rather
  // than a hand-built firing set (the gap recorded in ADR-0019's cold-eye). NOTE: s1/s2 member
  // sets are disjoint, so this binds the ADR-0021 e2e path — the BINARY cover would also pass
  // here; only the spraypoint cross-kind fixture discriminates the ADR-0022 marginal mechanism.
  const snap = generateFabric(FABRIC);
  const counts = new Map<string, number>();
  for (const e of snap.edges) if (e.resource.startsWith('shuffler-')) counts.set(e.resource, (counts.get(e.resource) ?? 0) + 1);
  const [s1, s2] = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const params: PipelineParams = {
    fabric: FABRIC,
    telemetry: { seed: 7, ticks: 80, degradations: [
      { resource_id: s1, delta: 4, start_tick: 0 },
      { resource_id: s2, delta: 4, start_tick: 0 },
    ] },
    q: 0.05,
    drain_top_k: 2,
  };
  const a = await runPipeline(params);
  const ids = a.culprits.map((c) => c.resource_id);
  assert.ok(ids.includes(s1) && ids.includes(s2), `both injected faults must be culprits (got ${ids.join(', ')})`);
  assert.equal(a.unexplained_path_class_ids.length, 0, 'the two-resource cover explains the firing set');
  const drained = a.drain_actions.map((d) => d.resource_id).sort();
  assert.deepEqual(drained, [s1, s2].sort(), 'drain_top_k: 2 drains both culprits');
  // replay-clean across the multi-fault path (AC-9).
  assert.equal(JSON.stringify(a), JSON.stringify(await runPipeline(params)));
});

test('TIERED drain budgeting: every evidence group\'s rank-1 drains before any group\'s rank-2 (ADR-0023)', async () => {
  const { drainTargets } = await import('../src/pipeline');
  const c = (resource_id: string, score: number, ep: number) => ({
    resource_id, resource_kind: 'optic' as const, score, member_path_class_ids: [], firing_member_count: 1,
    traversing_count: 1, supporting_views: [], localized_against_epoch: ep, correlational_not_causal: true as const,
  });
  // the recorded ADR-0022 L2 starvation case: group-0 = [X full-LLR 31.5, Y marginal 1.5],
  // group-1 = [Z full-LLR 0.8]. A flat score sort takes [X, Y] and starves the real fault Z.
  const culprits = [c('X', 31.5, 0), c('Y', 1.5, 0), c('Z', 0.8, 1)];
  assert.deepEqual(drainTargets(culprits, 2).map((t) => t.resource_id), ['X', 'Z'], 'tier beats raw score across groups');
  // within tier-1: score desc, id tie-break; dedupe still holds through the tiered path.
  const tie = [c('B', 5, 0), c('A', 5, 1), c('A', 2, 0)];
  assert.deepEqual(drainTargets(tie, 3).map((t) => t.resource_id), ['A', 'B'], 'score/id ordering within a tier; one drain per resource');
});

test('ADR-0066: the audit carries log_threshold_e and per-leaf margins; margin sign reproduces the selection; JSON-safe', async () => {
  const target = mostTraversedShuffler();
  const rec = await runPipeline({
    fabric: FABRIC,
    telemetry: { seed: 7, ticks: 100, degradation: { resource_id: target, delta: 4, start_tick: 0 } },
    q: 0.05,
  });
  const N = rec.verdicts.length;
  const K = rec.selected_path_class_ids.length;
  assert.ok(K > 0, 'precondition: a firing run');
  assert.equal(rec.margins.length, N, 'one margin per verdict');
  assert.deepEqual(rec.margins.map((m) => m.path_class_id), rec.verdicts.map((v) => v.path_class_id), 'margins align with the audit verdict order');
  assert.deepEqual(rec.margins.filter((m) => m.log_margin >= 0).map((m) => m.path_class_id).sort(), [...rec.selected_path_class_ids].sort(), 'margin ≥ 0 ⇔ selected');
  const expected = Math.log(N / (0.05 * Math.max(K, 1)));
  assert.ok(Math.abs(rec.log_threshold_e - expected) <= 1e-12 * expected, `log_threshold_e = log(N/(qK)) (got ${rec.log_threshold_e}, expected ${expected})`);
  const back = JSON.parse(JSON.stringify(rec));
  assert.ok(Number.isFinite(back.log_threshold_e));
  assert.ok(back.margins.every((m: { log_margin: number | null }) => typeof m.log_margin === 'number' && Number.isFinite(m.log_margin)), 'no null/Infinity margin after a JSON round-trip');
});
