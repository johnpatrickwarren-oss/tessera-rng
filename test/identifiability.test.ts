/**
 * ADR-0047 — identifiability certificate: the N1 claim ("identifiability of the shared-resource
 * set, nothing stronger") computed per snapshot, and surfaced on culprits where the measurement
 * design cannot support a unique claim.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identifiabilityCertificate, ambiguityGroupsByResource } from '../src/identifiability';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { generateFabric, DEFAULT_FABRIC } from '../src/fabric';
import { localize, DEFAULT_LOCALIZE } from '../src/tomography';
import type { FaultDomainSnapshot } from '../src/domain';

function snapOf(edges: Array<[string, string, number]>, resources: Array<[string, 'optic' | 'shuffle_panel' | 'room']>): FaultDomainSnapshot {
  return {
    nodes: [],
    edges: edges.map(([pc, r, w]) => ({ path_class: pc, resource: r, relationship: 'traverses' as const, weight: w })),
    path_classes: [...new Set(edges.map(([pc]) => pc))],
    resources: resources.map(([id, kind]) => ({ id, kind })),
    fetched_at_ts: 0,
    source_id: 't',
    source_version: 'v',
  };
}

test('identical columns group; PROPORTIONAL columns group (θ absorbs scale); different support does not', () => {
  const snap = snapOf(
    [
      ['pc-1', 'a', 1], ['pc-2', 'a', 0.5],
      ['pc-1', 'b', 1], ['pc-2', 'b', 0.5], // identical to a
      ['pc-1', 'c', 0.4], ['pc-2', 'c', 0.2], // proportional to a (×0.4)
      ['pc-1', 'd', 1], // different support
    ],
    [['a', 'optic'], ['b', 'optic'], ['c', 'optic'], ['d', 'optic']],
  );
  const cert = identifiabilityCertificate(snap);
  assert.deepEqual(cert.ambiguity_groups, [['a', 'b', 'c']]);
  assert.equal(cert.identifiable_count, 1); // only d
  assert.equal(cert.resource_count, 4);
});

test('a uniform full-support column is flagged fleet-ambiguous', () => {
  const snap = snapOf(
    [
      ['pc-1', 'u', 0.7], ['pc-2', 'u', 0.7], // uniform over ALL leaves
      ['pc-1', 'v', 1],
    ],
    [['u', 'room'], ['v', 'optic']],
  );
  const cert = identifiabilityCertificate(snap);
  assert.deepEqual(cert.fleet_ambiguous, ['u']);
});

test('the published fabrics are FULLY 1-identifiable — the certificate the N1 claim rides on', () => {
  for (const snap of [generateFabric(DEFAULT_FABRIC), generateSpraypointFabric(DEFAULT_SPRAYPOINT)]) {
    const cert = identifiabilityCertificate(snap);
    assert.deepEqual(cert.ambiguity_groups, [], 'no ambiguity groups on the published fabric');
    assert.deepEqual(cert.fleet_ambiguous, [], 'no fleet-ambiguous resource');
    assert.ok(cert.identifiable_count > 0);
  }
});

test('a one-room Spraypoint degenerates: the room column is uniform ⇒ fleet-ambiguous (the certificate CATCHES the worst case)', () => {
  // Jupiter-style uniformly-striped domains are the localization worst case — the certificate
  // must say so instead of letting the fabric silently promise what it cannot deliver.
  const snap = generateSpraypointFabric({ ...DEFAULT_SPRAYPOINT, nRooms: 1 });
  const cert = identifiabilityCertificate(snap);
  assert.ok(cert.fleet_ambiguous.includes('room-0'), 'the all-covering room is fleet-ambiguous');
});

test('culprits inside an ambiguity group CARRY it (audit metadata) — the claim weakens where the design cannot rank', () => {
  const snap = snapOf(
    [
      ['pc-1', 'a', 1], ['pc-2', 'a', 0.5],
      ['pc-1', 'b', 1], ['pc-2', 'b', 0.5],
    ],
    [['a', 'optic'], ['b', 'optic']],
  );
  const y = new Map([['pc-1', 10], ['pc-2', 5]]);
  const loc = localize(snap, ['pc-1', 'pc-2'], { ...DEFAULT_LOCALIZE, q0: 0.1, magnitudeT: y, magnitudeTicks: 1 });
  assert.ok(loc.culprits.length >= 1);
  assert.deepEqual(loc.culprits[0].ambiguity_group, [loc.culprits[0].resource_id === 'a' ? 'b' : 'a'],
    'the picked culprit names its indistinguishable sibling');
  // and by-resource lookup agrees
  assert.deepEqual(ambiguityGroupsByResource(snap).get('a'), ['b']);
});

test('an identifiable culprit carries NO ambiguity_group field (absent, not empty)', () => {
  const snap = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
  const w0 = new Map<string, number>();
  for (const e of snap.edges) if (e.resource === 'room-0') w0.set(e.path_class, e.weight ?? 1);
  const firedRoom = [...w0.keys()].filter((pc) => (w0.get(pc) ?? 0) > 0.3);
  const y = new Map(firedRoom.map((pc) => [pc, 8 * (w0.get(pc) ?? 1)]));
  const loc = localize(snap, firedRoom, { ...DEFAULT_LOCALIZE, q0: 0.5, magnitudeT: y, magnitudeTicks: 60 });
  assert.equal(loc.culprits[0]?.resource_id, 'room-0');
  assert.ok(!('ambiguity_group' in loc.culprits[0]), 'no field on an identifiable culprit');
});
