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
