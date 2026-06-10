/**
 * Epoch'd snapshots + synthetic reroute events (ADR-0017). Binds the prescription table:
 * determinism of the seeded remap, edge/weight semantics, epoch validation, and the telemetry
 * mid-stream switch (the degradation follows the ACTIVE epoch). The single-epoch ≡ static
 * byte-identity is the anti-self-confirming guard for the telemetry refactor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRerouteEvent, makeEpochs, epochIndexAt, changedLeaves } from '../src/epoch';
import { generateTelemetry } from '../src/telemetry';
import { computeFaultDomainHash } from '../src/fault-domain-source';
import { signalIndex } from '../src/signals';
import type { FaultDomainSnapshot, FaultDomainEdge } from '../src/domain';

function edge(pc: string, r: string, weight?: number): FaultDomainEdge {
  return { path_class: pc, resource: r, relationship: 'traverses', ...(weight !== undefined ? { weight } : {}) };
}

/** Two optics (same kind ⇒ reroutable) + one shuffler; pc-1/pc-2 traverse opt-A. */
function fixture(): FaultDomainSnapshot {
  const edges = [edge('pc-1', 'opt-A', 0.5), edge('pc-2', 'opt-A'), edge('pc-2', 'opt-B', 0.8), edge('pc-3', 'shuf-0')];
  return {
    nodes: [],
    edges,
    path_classes: ['pc-1', 'pc-2', 'pc-3'],
    resources: [
      { id: 'opt-A', kind: 'optic' },
      { id: 'opt-B', kind: 'optic' },
      { id: 'shuf-0', kind: 'passive_shuffler' },
    ],
    views: [{ view: 'va', leaf_ids: ['pc-1', 'pc-2', 'pc-3'] }],
    fetched_at_ts: 0,
    source_id: 's',
    source_version: 'v',
  };
}

test('a reroute is pure, seeded, and deterministic — same event ⇒ identical snapshot hash (AC-9)', () => {
  const snap = fixture();
  const ev = { at_tick: 30, resource_id: 'opt-A', fraction: 1, seed: 7 };
  const a = applyRerouteEvent(snap, ev);
  const b = applyRerouteEvent(snap, ev);
  assert.equal(computeFaultDomainHash(a), computeFaultDomainHash(b), 'same seed ⇒ same remap, byte-stable');
  assert.notEqual(computeFaultDomainHash(a), computeFaultDomainHash(snap), 'a reroute is a distinct measurement design');
  assert.deepEqual(snap.edges, fixture().edges, 'the input snapshot is not mutated (pure)');
});

test('remapped leaves drop the drained edge; the weight lands on a same-kind alternate, capped at 1', () => {
  const out = applyRerouteEvent(fixture(), { at_tick: 30, resource_id: 'opt-A', fraction: 1, seed: 7 });
  assert.ok(!out.edges.some((e) => e.resource === 'opt-A'), 'every leaf was rerouted off the drained optic');
  // pc-1 had no opt-B edge: its 0.5 moves there as a new edge. pc-2 had opt-B at 0.8: 0.8+1 caps at 1.
  const pc1 = out.edges.find((e) => e.path_class === 'pc-1' && e.resource === 'opt-B');
  const pc2 = out.edges.find((e) => e.path_class === 'pc-2' && e.resource === 'opt-B');
  assert.equal(pc1?.weight, 0.5);
  assert.equal(pc2?.weight, 1, 'a leaf cannot route more than all of its traffic through one resource');
  assert.deepEqual(out.path_classes, fixture().path_classes, 'path-classes carry over verbatim');
  assert.deepEqual(out.views, fixture().views, 'view definitions carry over verbatim');
  assert.ok(out.edges.some((e) => e.path_class === 'pc-3' && e.resource === 'shuf-0'), 'untouched leaves keep their edges');
});

test('fraction semantics: floor(fraction·|candidates|) leaves remap, the rest keep the drained edge', () => {
  // 2 candidates on opt-A, fraction 0.5 ⇒ floor(1) = exactly one remapped.
  const out = applyRerouteEvent(fixture(), { at_tick: 30, resource_id: 'opt-A', fraction: 0.5, seed: 7 });
  const stillOn = new Set(out.edges.filter((e) => e.resource === 'opt-A').map((e) => e.path_class));
  assert.equal(stillOn.size, 1, 'exactly one of two candidates remapped');
  const moved = changedLeaves(fixture(), out);
  assert.equal(moved.size, 1);
  assert.ok(!stillOn.has([...moved][0]), 'the changed leaf is the remapped one');
});

test('fraction bounds: outside [0,1] is rejected; fraction 0 is a valid no-op reroute', () => {
  assert.throws(() => applyRerouteEvent(fixture(), { at_tick: 1, resource_id: 'opt-A', fraction: 2, seed: 1 }), /fraction must be in \[0, 1\]/);
  assert.throws(() => applyRerouteEvent(fixture(), { at_tick: 1, resource_id: 'opt-A', fraction: -1, seed: 1 }), /fraction must be in \[0, 1\]/);
  const noop = applyRerouteEvent(fixture(), { at_tick: 1, resource_id: 'opt-A', fraction: 0, seed: 1 });
  assert.equal(changedLeaves(fixture(), noop).size, 0, 'fraction 0 remaps nobody');
});

test('the moved weight is THIS leaf\'s edge weight, merged exactly once (no decoy pick-up, no duplicate edge)', () => {
  // decoy-first edge order: pc-X's OWN edge to a DIFFERENT resource (bundle-Z) comes first, so an
  // edge lookup that matches on either condition (path_class OR resource) picks bundle-Z's 0.0625
  // instead of the drained opt-A edge's 0.5 — and the un-capped merge (0.25 + 0.5 = 0.75 < 1,
  // exact in binary) exposes the wrong weight.
  const snap: FaultDomainSnapshot = {
    nodes: [],
    edges: [edge('pc-X', 'bundle-Z', 0.0625), edge('decoy', 'opt-A', 0.125), edge('pc-X', 'opt-A', 0.5), edge('pc-X', 'opt-B', 0.25), edge('decoy', 'opt-B')],
    path_classes: ['decoy', 'pc-X'],
    resources: [{ id: 'opt-A', kind: 'optic' }, { id: 'opt-B', kind: 'optic' }, { id: 'bundle-Z', kind: 'fiber_bundle' }],
    fetched_at_ts: 0,
    source_id: 's',
    source_version: 'v',
  };
  const out = applyRerouteEvent(snap, { at_tick: 1, resource_id: 'opt-A', fraction: 1, seed: 3 });
  const x = out.edges.filter((e) => e.path_class === 'pc-X' && e.resource === 'opt-B');
  assert.equal(x.length, 1, 'the weight merges into the existing edge — never a duplicate edge');
  assert.equal(x[0].weight, 0.75, 'pc-X moved ITS opt-A 0.5 — not its first-listed bundle-Z edge, not the decoy\'s 0.125');
  assert.equal(out.edges.find((e) => e.path_class === 'pc-X' && e.resource === 'bundle-Z')?.weight, 0.0625, 'the unrelated edge is untouched');
  assert.equal(out.edges.filter((e) => e.path_class === 'decoy' && e.resource === 'opt-B').length, 1);
});

test('a reroute with no same-kind alternate throws (physically impossible event)', () => {
  assert.throws(
    () => applyRerouteEvent(fixture(), { at_tick: 30, resource_id: 'shuf-0', fraction: 1, seed: 1 }),
    /no same-kind alternate/,
  );
  assert.throws(
    () => applyRerouteEvent(fixture(), { at_tick: 30, resource_id: 'nope', fraction: 1, seed: 1 }),
    /not in the snapshot/,
  );
});

test('makeEpochs validates the sequence and stamps per-epoch hashes (views included in the identity)', () => {
  const snap = fixture();
  const epochs = makeEpochs(snap, [{ at_tick: 30, resource_id: 'opt-A', fraction: 1, seed: 7 }]);
  assert.equal(epochs.length, 2);
  assert.equal(epochs[0].valid_from_tick, 0);
  assert.equal(epochs[0].hash, computeFaultDomainHash(snap));
  assert.equal(epochs[1].hash, computeFaultDomainHash(epochs[1].snapshot));
  assert.notEqual(epochs[0].hash, epochs[1].hash);
  // strictly-increasing valid_from (an event at tick 0 or out of order is rejected).
  assert.throws(() => makeEpochs(snap, [{ at_tick: 0, resource_id: 'opt-A', fraction: 1, seed: 1 }]), /strictly increasing/);
  assert.throws(
    () => makeEpochs(snap, [
      { at_tick: 30, resource_id: 'opt-A', fraction: 0.5, seed: 1 },
      { at_tick: 30, resource_id: 'opt-A', fraction: 0.5, seed: 2 },
    ]),
    /strictly increasing/,
  );
});

test('epochIndexAt: a tick exactly at valid_from_tick belongs to the NEW epoch', () => {
  const epochs = makeEpochs(fixture(), [{ at_tick: 40, resource_id: 'opt-A', fraction: 1, seed: 7 }]);
  assert.equal(epochIndexAt(epochs, 0), 0);
  assert.equal(epochIndexAt(epochs, 39), 0);
  assert.equal(epochIndexAt(epochs, 40), 1);
  assert.equal(epochIndexAt(epochs, 59), 1);
});

test('single-epoch telemetry is BYTE-IDENTICAL to the static path (the anti-self-confirming guard)', () => {
  const snap = fixture();
  const params = { seed: 11, ticks: 50, degradation: { resource_id: 'opt-A', delta: 4, start_tick: 0 } };
  const stat = generateTelemetry(snap, params);
  const epoched = generateTelemetry(snap, { ...params, epochs: makeEpochs(snap, []) });
  assert.equal(JSON.stringify([...stat.series]), JSON.stringify([...epoched.series]));
});

test('the degradation follows the ACTIVE epoch: a leaf rerouted off the faulty resource stops shifting at the boundary', () => {
  const snap = fixture();
  const T = 25;
  const epochs = makeEpochs(snap, [{ at_tick: T, resource_id: 'opt-A', fraction: 1, seed: 7 }]);
  const params = { seed: 11, ticks: 50, degradation: { resource_id: 'opt-A', delta: 8, start_tick: 0 } };
  const stat = generateTelemetry(snap, params); // never rerouted — shifts for the whole window
  const epoched = generateTelemetry(snap, { ...params, epochs });
  const sig = signalIndex('p99_latency');

  // The noise stream is continuous and identical across the two runs (same seed), so the series
  // differ EXACTLY by the injected shift: delta·w before the boundary in both, absent after the
  // boundary only in the epoch'd run. pc-1 carries w=0.5 on opt-A.
  const a = stat.series.get('pc-1')!;
  const b = epoched.series.get('pc-1')!;
  for (let t = 0; t < T; t++) assert.equal(b[t][sig], a[t][sig], `pre-boundary tick ${t}: same shift in both runs`);
  for (let t = T; t < 50; t++) {
    assert.ok(Math.abs(a[t][sig] - b[t][sig] - 8 * 0.5) < 1e-9, `post-boundary tick ${t}: the epoch'd leaf lost exactly delta·w`);
  }
  // pc-3 never traversed opt-A: identical throughout (the unaffected control).
  assert.equal(JSON.stringify(epoched.series.get('pc-3')), JSON.stringify(stat.series.get('pc-3')));
});
