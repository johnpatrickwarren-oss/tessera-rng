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

test('C1 CLOSED (ADR-0019): the saturating noisy-OR holds the true optic across the full δ sweep — the controls still flip', async () => {
  // The ADR-0016 canary documented the δ≥64 cross-view flip as a residue and instructed: if this
  // fails because the flip got FIXED, update the ADR — the exposure-saturating noisy-OR
  // (ADR-0019) is that fix. At extreme δ the optic's leakage into the 1/64-diluted pair leaves is
  // EXPECTED (high-κ mixture cells), and the coarse pair-view resources are falsified by their
  // quiet per-ToR members. The old failure modes survive as controls: the legacy linear scorer
  // AND a saturation-disabled κ grid both still flip — the κ mixture is the mechanism, not luck.
  for (const delta of [64, 128]) {
    const a = await runPipeline({ snapshot: SNAP, q: 0.05, telemetry: { seed: 1, ticks: 60, degradation: { resource_id: 'optic-3', delta, start_tick: 0 } } });
    assert.equal(a.culprits[0]?.resource_id, 'optic-3', `the saturating LLR holds the true optic at δ=${delta}`);
  }
  const a = await runPipeline({ snapshot: SNAP, q: 0.05, telemetry: { seed: 1, ticks: 60, degradation: { resource_id: 'optic-3', delta: 128, start_tick: 0 } } });
  const sel = a.selected_path_class_ids;
  assert.ok(sel.length > 30, 'the leakage premise still holds — the pair view saturates at δ=128');
  const q0 = q0Of(sel.length, SNAP.path_classes.length);
  // CONTROL 1: the legacy linear scorer still flips (the original C1 failure mode).
  const linear = localize(SNAP, sel, { ...DEFAULT_LOCALIZE, q0, legacy: true, collateralWeight: 1.0 });
  assert.notEqual(linear.culprits[0]?.resource_id, 'optic-3', 'the linear control still flips at δ=128');
  // CONTROL 2: saturation DISABLED (κ = {1}). Negative finding recorded in ADR-0019: the exact
  // noisy-OR form ALONE already holds rank-1 here (the old flip needed the linear-leak
  // parameterization), so the κ-mixture bind is QUANTITATIVE — saturation supplies the decisive
  // evidence margin (observed 33.3 vs 2.1). A mutant that ignores κ (k·w → w) collapses the
  // default to the κ=1 score and fails the floor assert.
  const noSat = localize(SNAP, sel, { ...DEFAULT_LOCALIZE, q0, kappas: [1] });
  assert.equal(noSat.culprits[0]?.resource_id, 'optic-3');
  assert.ok(noSat.culprits[0].score < 5, `κ=1 score stays small (got ${noSat.culprits[0].score})`);
  const sat = localize(SNAP, sel, { ...DEFAULT_LOCALIZE, q0 });
  assert.ok(sat.culprits[0].score > 20, `the κ mixture supplies the saturation margin (got ${sat.culprits[0].score})`);
  // MINIMAL SET (ADR-0022): the optic's posterior (high κ) already predicts the whole pair view,
  // so no panel/room earns a positive MARGINAL score — exactly one culprit. Kills a
  // foldPosterior-deletion (or prior-instead-of-posterior) mutant, under which panel-8's plain
  // LLR (≈3) would rank as a spurious second culprit.
  assert.equal(sat.culprits.length, 1, 'one fault ⇒ one culprit, even at saturation');
});

test('a ROOM fault localizes to the room — not a panel (the latent defect the ADR-0019 probe surfaced)', async () => {
  // Under the ADR-0016 non-saturating leak a room-0 fault mislocalized to panel-1 at EVERY δ
  // (recorded in ADR-0019); the saturating model picks room-0 across the sweep. Bind both ends.
  for (const delta of [4, 128]) {
    const a = await runPipeline({ snapshot: SNAP, q: 0.05, telemetry: { seed: 1, ticks: 60, degradation: { resource_id: 'room-0', delta, start_tick: 0 } } });
    assert.equal(a.culprits[0]?.resource_id, 'room-0', `a room fault localizes to the room at δ=${delta}`);
  }
});

test('a PANEL fault at extreme δ still localizes to the panel (no symmetric regression from saturation)', async () => {
  const a = await runPipeline({ snapshot: SNAP, q: 0.05, telemetry: { seed: 1, ticks: 60, degradation: { resource_id: 'panel-2', delta: 128, start_tick: 0 } } });
  assert.equal(a.culprits[0]?.resource_id, 'panel-2');
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

test('CROSS-KIND simultaneous faults (optic + panel): both localized over the two-view union (ADR-0021)', async () => {
  const a = await runPipeline({
    snapshot: SNAP,
    q: 0.05,
    telemetry: { seed: 1, ticks: 60, degradations: [
      { resource_id: 'optic-3', delta: 4, start_tick: 0 },
      { resource_id: 'panel-7', delta: 4, start_tick: 0 },
    ] },
    drain_top_k: 2,
  });
  const ids = a.culprits.map((c) => c.resource_id);
  assert.ok(ids.includes('optic-3'), `the optic fault is localized (got ${ids.join(', ')})`);
  assert.ok(ids.includes('panel-7'), `the panel fault is localized (got ${ids.join(', ')})`);
  // each culprit carries its own kind's anchor leaf (member lists are full firing PROVENANCE,
  // not an attribution partition — a later pick's list may include earlier-explained leaves).
  const optic = a.culprits.find((c) => c.resource_id === 'optic-3')!;
  const panel = a.culprits.find((c) => c.resource_id === 'panel-7')!;
  assert.ok(optic.member_path_class_ids.includes('tor-3'));
  assert.ok(panel.member_path_class_ids.some((l) => l.startsWith('pp-')));
});

// ── Paper-scale proof (ADR-0025): 960 ToRs, the upper range of AC-1, executed not extrapolated ──

test('PAPER SCALE (ADR-0025): clean FDR holds, faults detect + localize, replay-clean at 1,456 leaves', async () => {
  const { PAPER_SPRAYPOINT } = await import('../src/spraypoint');
  const snap = generateSpraypointFabric(PAPER_SPRAYPOINT);
  assert.equal(snap.path_classes.length, 1456, '960 per-ToR + C(32,2)=496 pair leaves');
  assert.ok(snap.path_classes.length <= 10000, 'inside AC-1');

  const clean = await runPipeline({ snapshot: snap, q: 0.05, telemetry: { seed: 1, ticks: 60 } });
  assert.equal(clean.selected_path_class_ids.length, 0, 'FDR control holds at 1,456 dependent leaves');

  const optic = await runPipeline({ snapshot: snap, q: 0.05, telemetry: { seed: 1, ticks: 60, degradation: { resource_id: 'optic-3', delta: 4, start_tick: 0 } } });
  assert.ok(optic.selected_path_class_ids.length > 0, 'an optic fault detects at scale');
  assert.equal(optic.culprits[0]?.resource_id, 'optic-3', 'and localizes rank-1');

  const panel = await runPipeline({ snapshot: snap, q: 0.05, telemetry: { seed: 1, ticks: 60, degradation: { resource_id: 'panel-2', delta: 4, start_tick: 0 } } });
  assert.ok(panel.selected_path_class_ids.length > 0, 'a panel fault detects at scale');
  assert.equal(panel.culprits[0]?.resource_id, 'panel-2', 'and localizes rank-1');

  const replay = await runPipeline({ snapshot: snap, q: 0.05, telemetry: { seed: 1, ticks: 60, degradation: { resource_id: 'optic-3', delta: 4, start_tick: 0 } } });
  assert.equal(JSON.stringify(optic), JSON.stringify(replay), 'byte-identical at scale (AC-9)');
});
