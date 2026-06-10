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
import { localize, DEFAULT_LOCALIZE } from '../src/tomography';

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

// ── Leaky-LLR δ-sweep: the pinned band and the documented C1 residue (ADR-0016) ──

/** The surface's floored fleet base rate over an arbitrary leaf population (ADR-0016). */
const q0Of = (nSelected: number, nLeaves: number): number => (nSelected + 0.5) / (nLeaves + 1);

test('PINNED BAND (ADR-0016): the leaky-LLR holds the true optic at rank-1 across the realistic δ band', async () => {
  // The owner-pinned C1 resolution: the LLR localizes optic-3 across the band where the fault's
  // leakage into the per_panel_pair view stays sub-threshold (δ ≤ 32 on this fabric/seed). The
  // band edge is empirical — the flip at δ ≥ 64 is the DOCUMENTED residue, asserted below.
  for (const delta of [4, 16, 32]) {
    const r = await fault('optic-3', delta);
    assert.equal(r.rank1, 'optic-3', `LLR must hold the true optic at δ=${delta} (pinned band)`);
  }
});

test('C1 RESIDUE CANARY (ADR-0016, documented limitation): at high δ the UNION flips while the per-ToR view alone does not', async () => {
  // At δ=128 the optic fault saturates the entire per_panel_pair view (leakage past e-BH), and a
  // coarse panel/room — which genuinely carries those pair leaves at w=1 — out-explains the optic
  // (w=1/nTors there). No per-resource scorer on this incidence can see that tor-3's firing
  // causally explains away the pair-view firing; the residue is STRUCTURAL (union of dependent
  // views), recorded in ADR-0016, NOT a bug in the scorer. If this canary ever fails because the
  // flip got FIXED (e.g. an explain-away scorer), update ADR-0016 — do not delete the test.
  // δ=64 — the band edge: the flip is already present (binds the ADR's "flip begins at δ ≥ 64").
  const edge = await runPipeline({ snapshot: SNAP, q: 0.05, telemetry: { seed: 1, ticks: 60, degradation: { resource_id: 'optic-3', delta: 64, start_tick: 0 } } });
  assert.match(edge.culprits[0]?.resource_id ?? '', /^(panel|room)-/, 'the flip begins at δ=64');

  const a = await runPipeline({ snapshot: SNAP, q: 0.05, telemetry: { seed: 1, ticks: 60, degradation: { resource_id: 'optic-3', delta: 128, start_tick: 0 } } });
  const sel = a.selected_path_class_ids;
  assert.ok(sel.length > 30, 'the high-δ fault must have saturated the pair view (leakage premise)');
  assert.notEqual(a.culprits[0]?.resource_id, 'optic-3', 'the union flips at δ=128 — the documented residue');
  assert.match(a.culprits[0]?.resource_id ?? '', /^(panel|room)-/, 'the usurper is a coarse pair-view resource');

  // The same evidence restricted to the per_tor view localizes cleanly — the residue is a UNION
  // artifact, not a detection failure (the basis for the ADR-0016 "document + pin" resolution).
  const torLeaves = new Set(SNAP.views![0].leaf_ids);
  const torOnly = sel.filter((l) => torLeaves.has(l));
  const single = localize(SNAP, torOnly, { ...DEFAULT_LOCALIZE, q0: q0Of(torOnly.length, torLeaves.size) });
  assert.equal(single.culprits[0]?.resource_id, 'optic-3', 'the per-ToR view alone still localizes the true optic');

  // The ORIGINAL C1 evidence: the legacy linear scorer also flips here (it was never a fix either).
  const linear = localize(SNAP, sel, { ...DEFAULT_LOCALIZE, legacy: true, collateralWeight: 1.0 });
  assert.notEqual(linear.culprits[0]?.resource_id, 'optic-3', 'the linear control flips at δ=128 (original C1)');
});

test('NEGATIVE FINDING (ADR-0016): in the pinned band the union does NOT distort rank vs a single view — no view-multiplicity knob', async () => {
  // The owner's one-view-vs-both-view double-count check: if the union's overlapping views
  // double-counted evidence, the union rank-1 would diverge from the per_tor-only rank-1 inside
  // the band, and the minimal fix would be dividing each leaf's log-contribution by view
  // multiplicity. It does not diverge → recorded negative finding, no knob added.
  const a = await runPipeline({ snapshot: SNAP, q: 0.05, telemetry: { seed: 1, ticks: 60, degradation: { resource_id: 'optic-3', delta: 16, start_tick: 0 } } });
  const sel = a.selected_path_class_ids;
  const torLeaves = new Set(SNAP.views![0].leaf_ids);
  const torOnly = sel.filter((l) => torLeaves.has(l));
  const union = localize(SNAP, sel, { ...DEFAULT_LOCALIZE, q0: q0Of(sel.length, SNAP.path_classes.length) });
  const single = localize(SNAP, torOnly, { ...DEFAULT_LOCALIZE, q0: q0Of(torOnly.length, torLeaves.size) });
  assert.equal(union.culprits[0]?.resource_id, 'optic-3');
  assert.equal(single.culprits[0]?.resource_id, union.culprits[0]?.resource_id, 'union and single-view agree in the band');
});

test('SPURIOUS-WINNER GUARD (ADR-0016): a single false-positive pair leaf yields NO culprit, reported unexplained', async () => {
  // One stray pair-leaf selection (an FDR-budget false positive). Every candidate that could
  // "explain" it carries many quiet high-weight members whose falsification buries it (negative
  // LLR) → no culprit, and the leaf lands in unexplained rather than being force-attributed.
  // (Deleting the quiet-member falsification term in resourceLLR turns its panels positive and
  // fails this test — the no-op guard for the null side of the likelihood.)
  const r = localize(SNAP, ['pp-2-7'], { ...DEFAULT_LOCALIZE, q0: q0Of(1, SNAP.path_classes.length) });
  assert.equal(r.culprits.length, 0, 'falsification must bury every candidate explanation');
  assert.deepEqual(r.unexplained_path_class_ids, ['pp-2-7']);
});

test('Spraypoint localization is replay-clean (same inputs → byte-identical audit)', async () => {
  const a = await runPipeline({ snapshot: SNAP, q: 0.05, telemetry: { seed: 2, ticks: 60, degradation: { resource_id: 'panel-1', delta: 4, start_tick: 0 } } });
  const b = await runPipeline({ snapshot: SNAP, q: 0.05, telemetry: { seed: 2, ticks: 60, degradation: { resource_id: 'panel-1', delta: 4, start_tick: 0 } } });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
