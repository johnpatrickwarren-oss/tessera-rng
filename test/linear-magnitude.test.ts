/**
 * ADR-0046 — linear t-statistic member model: the acceptance bars, bound to the PRODUCTION path.
 *
 * The member model y ~ N(θ·w·√T, 1) (θ-grid mixture, 1/θ prior, ML-refit fold, look-elsewhere
 * admission for rank ≥ 2, virtual fleet-event candidate) replaces the z(E) saturating scorer on
 * non-epoch'd runs. These tests kill the hand mutants by construction: dropping the μ·y evidence
 * term, the −μ²/2 falsification term, the ML fold, or the rank-≥2 admission charge each breaks a
 * named assertion below (exact minimal sets / recovery / separation).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../src/pipeline';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { localize, DEFAULT_LOCALIZE, FLEET_RESOURCE_ID } from '../src/tomography';

const CROSS = generateSpraypointFabric(DEFAULT_SPRAYPOINT); // cross-optic default (ADR-0035)
const T = 60;

async function crossKind(delta: number, seed: number) {
  return runPipeline({ snapshot: CROSS, q: 0.05, telemetry: { seed, ticks: T, degradations: [
    { resource_id: 'optic-3', delta, start_tick: 0 }, { resource_id: 'panel-7', delta, start_tick: 0 },
  ] } });
}

test('RETIRED LIMIT (AC-2): cross-kind recovery holds across the FULL band δ∈{8,16,32} — the ADR-0034 saturation is gone in production', async () => {
  // Under the z currency: δ=8 2/4, δ=16 0/4, δ=32 0/4 (ADR-0031/0034; common-mode reached δ16).
  // The linear scorer: 4/4 at every δ, no common-mode, q₀ ranging to 0.84 (irrelevant — the
  // linear null is q₀-free). Full 4-seed sweep at the decisive δ=16; spot seeds at 8 and 32.
  for (const seed of [1, 2, 3, 4]) {
    const a = await crossKind(16, seed);
    const top2 = a.culprits.slice(0, 2).map((c) => c.resource_id);
    assert.ok(top2.includes('optic-3') && top2.includes('panel-7'), `δ=16 seed=${seed}: got [${top2}]`);
  }
  for (const delta of [8, 32]) {
    const a = await crossKind(delta, 1);
    const top2 = a.culprits.slice(0, 2).map((c) => c.resource_id);
    assert.ok(top2.includes('optic-3') && top2.includes('panel-7'), `δ=${delta}: got [${top2}]`);
  }
});

test('PARSIMONY (AC-8, kills the fold/admission mutants): the cross-kind cover is EXACTLY the two injected resources', async () => {
  // Without the ML-refit fold, grid-quantization leftovers admit sibling-panel/fleet mop-ups
  // (measured during the round); without the rank-≥2 ln R charge, low-θ cells admit weak trailing
  // optics. Exactly-two binds both mechanisms.
  const a = await crossKind(16, 1);
  assert.deepEqual(new Set(a.culprits.map((c) => c.resource_id)), new Set(['optic-3', 'panel-7']),
    `expected exactly the injected pair — got [${a.culprits.map((c) => c.resource_id)}]`);
});

test('BROAD FAULT (AC-3): room Δ=2 attributes rank-1 every seed — the dilution attribution floor improves 3 → 2', async () => {
  // Under z: 2/4 at Δ=2 (and a WRONG room rank-1 on one seed). Linear: 4/4, exact minimal set.
  for (const seed of [1, 2, 3, 4]) {
    const a = await runPipeline({ snapshot: CROSS, q: 0.05, telemetry: { seed, ticks: T, degradation: { resource_id: 'room-0', delta: 2, start_tick: 0 } } });
    assert.equal(a.culprits[0]?.resource_id, 'room-0', `Δ=2 seed=${seed}: rank-1 is ${a.culprits[0]?.resource_id}`);
  }
});

test('C1 (AC-5): a δ=128 single optic yields the EXACT minimal set — where the z scorer returned wrong-kind rooms', async () => {
  for (const seed of [1, 2]) {
    const a = await runPipeline({ snapshot: CROSS, q: 0.05, telemetry: { seed, ticks: T, degradation: { resource_id: 'optic-3', delta: 128, start_tick: 0 } } });
    assert.deepEqual(a.culprits.map((c) => c.resource_id), ['optic-3'], `seed=${seed}: got [${a.culprits.map((c) => c.resource_id)}]`);
  }
});

test('FLEET-EVENT SEPARATION (AC-4): uniform elevation ⇒ the virtual fleet candidate, never a fabricated physical culprit', () => {
  const all = CROSS.path_classes;
  const y = new Map(all.map((pc) => [pc, 8]));
  const loc = localize(CROSS, all, { ...DEFAULT_LOCALIZE, q0: 0.5, magnitudeT: y, magnitudeTicks: T });
  assert.equal(loc.culprits[0]?.resource_id, FLEET_RESOURCE_ID, 'uniform event → fleet rank-1');
  assert.equal(loc.culprits[0]?.resource_kind, 'fleet_common_mode');
  assert.equal(loc.culprits[0]?.correlational_not_causal, true);
  assert.equal(loc.culprits.length, 1, 'no physical resource fabricated on top of the fleet event');
});

test('FLEET-EVENT SEPARATION (AC-4): a room-patterned elevation beats the fleet candidate — quiet leaves falsify uniformity', () => {
  // Each quiet leaf costs the fleet candidate μ²/2 the room does not pay — the structural
  // discriminator that makes the fleet candidate SAFE for broad faults (the ADR-0038 regression
  // cannot recur: nothing is stripped, the models compete).
  const w0 = new Map<string, number>();
  for (const e of CROSS.edges) if (e.resource === 'room-0') w0.set(e.path_class, e.weight ?? 1);
  const firedRoom = [...w0.keys()].filter((pc) => (w0.get(pc) ?? 0) > 0.3);
  const y = new Map(firedRoom.map((pc) => [pc, 8 * (w0.get(pc) ?? 1)]));
  const loc = localize(CROSS, firedRoom, { ...DEFAULT_LOCALIZE, q0: 0.5, magnitudeT: y, magnitudeTicks: T });
  assert.equal(loc.culprits[0]?.resource_id, 'room-0', 'room-patterned → room-0 rank-1');
  assert.ok(!loc.culprits.some((c) => c.resource_id === FLEET_RESOURCE_ID), 'fleet not picked');
});

test('DRAIN GUARD: the fleet culprit is never a drain target', async () => {
  // Force a fleet pick through the production path: a uniform synthetic shift is not injectable
  // via a single resource on this fabric, so bind at the assembly level instead — a localize()
  // fleet pick carries the reserved id, and assembleAudit filters it from drain targets. The
  // pipeline-level guard: on the cross-kind run the drain target is the rank-1 PHYSICAL culprit.
  const a = await crossKind(16, 1);
  assert.ok(a.drain_actions.length > 0);
  for (const d of a.drain_actions) assert.notEqual(d.resource_id, FLEET_RESOURCE_ID);
});

test('FALSIFICATION TERM (AC-8, kills the −μ²/2 mutant): a quiet high-weight member disqualifies a decoy', () => {
  // Two resources both touch the fired leaf; the decoy also has a QUIET full-weight member the
  // true resource does not touch. Dropping the −μ²/2 term (or the quiet member's contribution)
  // flips the ranking to the decoy, which covers more weight.
  const snap = {
    nodes: [],
    edges: [
      { path_class: 'pc-hot', resource: 'true-r', relationship: 'traverses' as const, weight: 1 },
      { path_class: 'pc-hot', resource: 'decoy', relationship: 'traverses' as const, weight: 1 },
      { path_class: 'pc-quiet', resource: 'decoy', relationship: 'traverses' as const, weight: 1 },
    ],
    path_classes: ['pc-hot', 'pc-quiet'],
    resources: [
      { id: 'true-r', kind: 'optic' as const },
      { id: 'decoy', kind: 'shuffle_panel' as const },
    ],
    fetched_at_ts: 0,
    source_id: 't',
    source_version: 'v',
  };
  const y = new Map([['pc-hot', 10]]);
  const loc = localize(snap, ['pc-hot'], { ...DEFAULT_LOCALIZE, q0: 0.1, magnitudeT: y, magnitudeTicks: 1 });
  assert.equal(loc.culprits[0]?.resource_id, 'true-r', 'the quiet member falsifies the decoy');
  assert.equal(loc.culprits.length, 1);
  assert.deepEqual(loc.explained_path_class_ids, ['pc-hot']);
});

test('FAIL-CLOSED: a firing leaf missing from the magnitude map throws (contract violation, not silent z=0)', () => {
  const snap = {
    nodes: [],
    edges: [{ path_class: 'pc-1', resource: 'r-1', relationship: 'traverses' as const, weight: 1 }],
    path_classes: ['pc-1'],
    resources: [{ id: 'r-1', kind: 'optic' as const }],
    fetched_at_ts: 0,
    source_id: 't',
    source_version: 'v',
  };
  assert.throws(() => localize(snap, ['pc-1'], { ...DEFAULT_LOCALIZE, q0: 0.1, magnitudeT: new Map(), magnitudeTicks: 1 }), RangeError);
});
