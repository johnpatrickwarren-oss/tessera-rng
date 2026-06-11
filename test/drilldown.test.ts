/**
 * ToR-pair drill-down (ADR-0026): binds the exposure model, the FDR-controlled drill, the
 * dilution honesty (a drill must not invent impact), cross-resource informativeness, the
 * truncation caveat, determinism, and N1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exposedPairs, drillDown } from '../src/drilldown';
import { DEFAULT_SPRAYPOINT } from '../src/spraypoint';

const P = DEFAULT_SPRAYPOINT; // 64 ToRs, 10 panels, 2 rooms

test('the drill\'s FLOW-level exposure model (ADR-0026 — deliberately NOT the fabric\'s leaf-local view weights)', () => {
  const optic = exposedPairs(P, 'optic-3');
  assert.equal(optic.length, P.nTors - 1, 'an optic exposes its endpoint pairs');
  assert.ok(optic.every((e) => e.exposure === 1 && /(^pair-3-|^pair-\d+-3$)/.test(e.pair)));

  const panel = exposedPairs(P, 'panel-2');
  assert.equal(panel.length, (P.nTors * (P.nTors - 1)) / 2, 'a panel exposes every pair');
  assert.ok(panel.every((e) => e.exposure === 1 / P.nPanels));

  const room = exposedPairs(P, 'room-0');
  assert.ok(room.every((e) => e.exposure === 5 / 10), 'a room exposes every pair at panels-in-room/nPanels');

  // ASYMMETRIC room split (10 panels, 3 rooms → room-0 gets panels {0,3,6,9} = 4): kills the
  // ===→!== modulus mutant, which the symmetric 2-room default cannot see (5 in ≡ 5 out).
  const asym = exposedPairs({ nTors: 8, nPanels: 10, nRooms: 3 }, 'room-0');
  assert.ok(asym.every((e) => e.exposure === 4 / 10), 'panels are counted IN the room, not out of it');

  assert.throws(() => exposedPairs(P, 'switch-9'), /no pair-exposure model/);
});

test('drilling the TRUE culprit ranks its impacted pairs; a clean drill selects ~nothing (FDR within the drill)', () => {
  const fault = [{ resource_id: 'optic-3', delta: 4 }];
  const hit = drillDown({ params: P, resource: 'optic-3', faults: fault, telemetry: { seed: 5, ticks: 60 }, q: 0.05 });
  assert.equal(hit.exposed, 63);
  assert.equal(hit.truncated, false);
  assert.ok(hit.selected.length >= 60, `nearly all 63 exposed pairs are impacted at exposure 1 (got ${hit.selected.length})`);
  assert.ok(hit.selected.every((s) => s.e_value >= hit.selected[hit.selected.length - 1].e_value), 'ranked strongest-first');

  const clean = drillDown({ params: P, resource: 'optic-3', faults: [], telemetry: { seed: 5, ticks: 60 }, q: 0.05 });
  assert.ok(clean.selected.length <= 1, `a clean drill is FDR-quiet (got ${clean.selected.length})`);
});

test('DILUTION HONESTY: a panel drill at fleet-detectable Δ reports the per-pair truth, not invented impact', () => {
  // Δ=4 detects at the VIEW level (the pooled pair-view leaf), but each individual pair only
  // shifts by Δ/nPanels = 0.4σ — below per-pair detectability in 60 ticks. The drill must say
  // so rather than manufacture per-pair culpability. At Δ=40 (4σ per pair) the pairs select.
  const weak = drillDown({ params: P, resource: 'panel-2', faults: [{ resource_id: 'panel-2', delta: 4 }], telemetry: { seed: 5, ticks: 60 }, q: 0.05 });
  assert.ok(weak.selected.length <= 2, `0.4σ per pair is honestly sub-floor (got ${weak.selected.length})`);
  const strong = drillDown({ params: P, resource: 'panel-2', faults: [{ resource_id: 'panel-2', delta: 40 }], telemetry: { seed: 5, ticks: 60 }, q: 0.05 });
  assert.ok(strong.selected.length >= 200, `4σ per pair selects broadly (got ${strong.selected.length})`);
});

test('CROSS-RESOURCE drill is informative, not spurious: drilling optic-5 under an optic-3 fault selects exactly pair-3-5', () => {
  const r = drillDown({ params: P, resource: 'optic-5', faults: [{ resource_id: 'optic-3', delta: 4 }], telemetry: { seed: 5, ticks: 60 }, q: 0.05 });
  assert.deepEqual(r.selected.map((s) => s.pair), ['pair-3-5'], 'the one optic-5 pair that crosses optic-3');
});

test('truncation is REPORTED, never silent (instrumented-caveat)', () => {
  const r = drillDown({ params: P, resource: 'panel-2', faults: [], telemetry: { seed: 5, ticks: 30 }, q: 0.05, maxPairs: 100 });
  assert.equal(r.exposed, 2016);
  assert.equal(r.examined, 100);
  assert.equal(r.truncated, true);
});

test('multi-fault shifts are ADDITIVE: both endpoint optics faulted ⇒ the joint pair carries 2δ (ADR-0026)', () => {
  // pair-3-5 is exposed to optic-3 AND optic-5 at 1 each → shift 2δ; every other endpoint pair
  // of either optic carries δ. With δ=2 (sub-floor alone over 60 ticks, detectable at 2δ=4) the
  // drill selects pair-3-5 FIRST — binding the additivity, not just the routing.
  const r = drillDown({ params: P, resource: 'optic-3', faults: [
    { resource_id: 'optic-3', delta: 2 },
    { resource_id: 'optic-5', delta: 2 },
  ], telemetry: { seed: 5, ticks: 60 }, q: 0.05 });
  assert.equal(r.selected[0]?.pair, 'pair-3-5', 'the doubly-exposed pair carries the strongest evidence');
});

test('the drill is deterministic and carries N1', () => {
  const opts = { params: P, resource: 'optic-3', faults: [{ resource_id: 'optic-3', delta: 4 }], telemetry: { seed: 9, ticks: 40 }, q: 0.05 } as const;
  const a = drillDown(opts);
  const b = drillDown(opts);
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'same seed ⇒ byte-identical report');
  assert.equal(a.correlational_not_causal, true);
  // N1 shape bind: no per-pair root-cause (or any undeclared) field can exist on the report.
  assert.deepEqual(Object.keys(a).sort(), ['correlational_not_causal', 'examined', 'exposed', 'q', 'resource', 'selected', 'truncated']);
});
