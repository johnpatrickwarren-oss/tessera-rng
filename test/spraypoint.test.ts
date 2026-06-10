/**
 * Spraypoint two-view fabric (ADR-0015): the leaf is an aggregation-view class, and the leaf set is
 * the UNION of a per-ToR view and a per-panel-pair view over the same underlying ToR-pair traffic.
 * The honest measurement these tests bind: each view concentrates a DIFFERENT fault kind and is
 * blind to the other — optic faults land in per_tor, panel faults in per_panel_pair. That
 * complementary blind-spot structure is the whole reason for running two views, so the tests assert
 * it directly (and would fail if the weighting/dilution collapsed the views together).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT, viewOfLeaf } from '../src/spraypoint';
import { runPipeline } from '../src/pipeline';

const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);

function viewsOf(selected: readonly string[]): Record<string, number> {
  const by: Record<string, number> = {};
  for (const leaf of selected) { const v = viewOfLeaf(SNAP, leaf) ?? '?'; by[v] = (by[v] ?? 0) + 1; }
  return by;
}
async function fault(resource: string | undefined, delta = 4): Promise<{ selected: readonly string[]; rank1?: string }> {
  const a = await runPipeline({ snapshot: SNAP, q: 0.05, telemetry: { seed: 1, ticks: 60, degradation: resource ? { resource_id: resource, delta, start_tick: 0 } : undefined } });
  return { selected: a.selected_path_class_ids, rank1: a.culprits[0]?.resource_id };
}

test('the fabric is the union of two aggregation views with weighted incidence, inside AC-1 (ADR-0015)', () => {
  assert.deepEqual(SNAP.views!.map((v) => v.view), ['per_tor', 'per_panel_pair']);
  assert.equal(SNAP.views![0].leaf_ids.length, DEFAULT_SPRAYPOINT.nTors); // 64 per-ToR leaves
  assert.equal(SNAP.views![1].leaf_ids.length, (DEFAULT_SPRAYPOINT.nPanels * (DEFAULT_SPRAYPOINT.nPanels - 1)) / 2); // C(10,2)=45
  assert.ok(SNAP.path_classes.length >= 100 && SNAP.path_classes.length <= 10000, 'leaf count inside AC-1 [100,10000]');
  // weighted incidence: a ToR's own optic is full-weight on its per-ToR leaf, a thin slice on a pair leaf.
  const onTor = SNAP.edges.find((e) => e.path_class === 'tor-3' && e.resource === 'optic-3')!;
  const onPair = SNAP.edges.find((e) => e.path_class.startsWith('pp-') && e.resource === 'optic-3')!;
  assert.equal(onTor.weight, 1);
  assert.ok(onPair.weight! < 0.02, `a pair leaf carries only ~1/nTors of an optic (got ${onPair.weight})`);
});

test('clean Spraypoint fabric selects nothing — FDR holds across two DEPENDENT views (ADR-0015)', async () => {
  const r = await fault(undefined);
  assert.equal(r.selected.length, 0, 'two dependent views must not break e-BH FDR control');
});

test('an OPTIC fault is concentrated by the per-ToR view and BLIND in the per-panel-pair view', async () => {
  const r = await fault('optic-3');
  const by = viewsOf(r.selected);
  assert.ok((by['per_tor'] ?? 0) >= 1, 'the faulty ToR\'s optic must fire its per-ToR leaf');
  assert.equal(by['per_panel_pair'] ?? 0, 0, 'an optic fault is 1/nTors-diluted in pair leaves → blind there');
  assert.equal(r.rank1, 'optic-3', 'localizes to the faulty optic over the union');
});

test('a PANEL fault is concentrated by the per-panel-pair view and BLIND in the per-ToR view', async () => {
  const r = await fault('panel-2');
  const by = viewsOf(r.selected);
  assert.ok((by['per_panel_pair'] ?? 0) >= 2, 'a panel fault must fire the pair leaves through it');
  assert.equal(by['per_tor'] ?? 0, 0, 'a panel fault is 1/nPanels-diluted in ToR leaves → blind there');
  assert.equal(r.rank1, 'panel-2', 'localizes to the faulty panel over the union');
});

test('Spraypoint localization is replay-clean (same inputs → byte-identical audit)', async () => {
  const a = await runPipeline({ snapshot: SNAP, q: 0.05, telemetry: { seed: 2, ticks: 60, degradation: { resource_id: 'panel-1', delta: 4, start_tick: 0 } } });
  const b = await runPipeline({ snapshot: SNAP, q: 0.05, telemetry: { seed: 2, ticks: 60, degradation: { resource_id: 'panel-1', delta: 4, start_tick: 0 } } });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
