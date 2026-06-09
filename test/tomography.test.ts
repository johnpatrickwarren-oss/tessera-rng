import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localize, DEFAULT_LOCALIZE } from '../src/tomography';
import type { FaultDomainSnapshot, FaultDomainEdge } from '../src/domain';

function snapshot(edges: FaultDomainEdge[], resources: { id: string; kind: 'optic' | 'passive_shuffler' | 'fiber_bundle' }[]): FaultDomainSnapshot {
  const pcs = [...new Set(edges.map((e) => e.path_class))].sort();
  return { nodes: [], edges, path_classes: pcs, resources, fetched_at_ts: 0, source_id: 's', source_version: 'v' };
}

function traverses(pc: string, r: string): FaultDomainEdge {
  return { path_class: pc, resource: r, relationship: 'traverses' };
}

// shuffler-0 is the common mode of the fired set (collateral 0); optic-0 is incidentally
// shared — one fired member, one quiet — so the MAP should NOT add it.
function toy(): FaultDomainSnapshot {
  return snapshot(
    [
      traverses('pc-0', 'shuffler-0'),
      traverses('pc-1', 'shuffler-0'),
      traverses('pc-2', 'shuffler-0'),
      traverses('pc-0', 'optic-0'),
      traverses('pc-9', 'optic-0'),
    ],
    [
      { id: 'shuffler-0', kind: 'passive_shuffler' },
      { id: 'optic-0', kind: 'optic' },
    ],
  );
}

test('MAP selects the zero-collateral common-mode and stops (minimal set, AC-5c)', () => {
  const res = localize(toy(), ['pc-0', 'pc-1', 'pc-2']);
  assert.equal(res.culprits.length, 1, 'minimal explaining set is just the shuffler');
  assert.equal(res.culprits[0].resource_id, 'shuffler-0');
  assert.equal(res.culprits[0].resource_kind, 'passive_shuffler');
  assert.deepEqual(res.explained_path_class_ids, ['pc-0', 'pc-1', 'pc-2']);
  assert.equal(res.unexplained_path_class_ids.length, 0);
});

test('every culprit is correlational-not-causal with sorted provenance (N1 guard)', () => {
  const res = localize(toy(), ['pc-2', 'pc-0', 'pc-1']);
  for (const c of res.culprits) {
    assert.equal(c.correlational_not_causal, true);
    assert.deepEqual([...c.member_path_class_ids], [...c.member_path_class_ids].sort());
  }
});

test('a high-collateral resource is rejected rather than blamed (path diversity pays off)', () => {
  // bundle-0 is traversed by 2 fired + 6 quiet paths: collateral 6 > gain 2 -> not selected.
  const edges = [
    traverses('pc-0', 'shuffler-0'),
    traverses('pc-1', 'shuffler-0'),
    traverses('pc-0', 'bundle-0'),
    traverses('pc-1', 'bundle-0'),
    ...['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].map((q) => traverses(q, 'bundle-0')),
  ];
  const res = localize(snapshot(edges, [
    { id: 'shuffler-0', kind: 'passive_shuffler' },
    { id: 'bundle-0', kind: 'fiber_bundle' },
  ]), ['pc-0', 'pc-1']);
  assert.equal(res.culprits.length, 1);
  assert.equal(res.culprits[0].resource_id, 'shuffler-0');
  assert.ok(!res.culprits.some((c) => c.resource_id === 'bundle-0'));
});

test('two independent common-modes both surface (cover requires two resources)', () => {
  const edges = [
    traverses('pc-0', 'shuffler-0'),
    traverses('pc-1', 'shuffler-0'),
    traverses('pc-2', 'shuffler-1'),
    traverses('pc-3', 'shuffler-1'),
  ];
  const res = localize(snapshot(edges, [
    { id: 'shuffler-0', kind: 'passive_shuffler' },
    { id: 'shuffler-1', kind: 'passive_shuffler' },
  ]), ['pc-0', 'pc-1', 'pc-2', 'pc-3']);
  const ids = res.culprits.map((c) => c.resource_id).sort();
  assert.deepEqual(ids, ['shuffler-0', 'shuffler-1']);
  assert.equal(res.unexplained_path_class_ids.length, 0);
});

test('ties are broken deterministically by resource id (lower id ranks first)', () => {
  // Two zero-collateral resources, equal gain=1. Insertion order is shuffler-1 BEFORE
  // shuffler-0, so only an explicit id tie-break yields shuffler-0 first (kills the
  // tie-break-clause mutants). Each covers a disjoint fired path.
  const edges = [traverses('pc-1', 'shuffler-1'), traverses('pc-0', 'shuffler-0')];
  const res = localize(snapshot(edges, [
    { id: 'shuffler-1', kind: 'passive_shuffler' },
    { id: 'shuffler-0', kind: 'passive_shuffler' },
  ]), ['pc-0', 'pc-1']);
  assert.equal(res.culprits[0].resource_id, 'shuffler-0', 'lower id wins the tie deterministically');
  assert.equal(res.culprits[1].resource_id, 'shuffler-1');
});

test('higher gain wins over a smaller id (id is only a TIE-break, not a primary key)', () => {
  // shuffler-9 explains 2 fired paths (gain 2); optic-0 explains 1 (gain 1). optic-0 has the
  // smaller id but the LOWER gain, so it must rank second. (Kills the &&->|| tie-break mutant,
  // which would let the smaller id win regardless of gain.)
  const edges = [
    traverses('pc-0', 'shuffler-9'),
    traverses('pc-1', 'shuffler-9'),
    traverses('pc-2', 'optic-0'),
  ];
  const res = localize(snapshot(edges, [
    { id: 'shuffler-9', kind: 'passive_shuffler' },
    { id: 'optic-0', kind: 'optic' },
  ]), ['pc-0', 'pc-1', 'pc-2']);
  assert.equal(res.culprits[0].resource_id, 'shuffler-9', 'rank-1 is the higher-gain resource, not the smaller id');
  assert.equal(res.culprits[1].resource_id, 'optic-0');
});

test('a resource at exactly gain 0 is not blamed (boundary: gain must be strictly positive)', () => {
  // λ=1, one firing + one quiet -> gain = 1 - 1 = 0 -> excluded (kills the <= boundary mutant).
  const edges = [traverses('pc-0', 'optic-0'), traverses('q1', 'optic-0')];
  const res = localize(snapshot(edges, [{ id: 'optic-0', kind: 'optic' }]), ['pc-0']);
  assert.equal(res.culprits.length, 0, 'a zero-gain resource explains nothing net');
  assert.deepEqual(res.unexplained_path_class_ids, ['pc-0']);
});

test('maxResources caps the explaining set (parsimony), leaving the rest unexplained', () => {
  const edges = [traverses('pc-0', 'shuffler-0'), traverses('pc-1', 'shuffler-1')];
  const res = localize(snapshot(edges, [
    { id: 'shuffler-0', kind: 'passive_shuffler' },
    { id: 'shuffler-1', kind: 'passive_shuffler' },
  ]), ['pc-0', 'pc-1'], { collateralWeight: 1.0, maxResources: 1 });
  assert.equal(res.culprits.length, 1, 'never exceed the parsimony cap');
  assert.equal(res.unexplained_path_class_ids.length, 1);
});

test('unexplained firing paths are reported, not hidden (instrumented-caveat)', () => {
  // pc-7 traverses nothing high-signal: only a resource with too much collateral.
  const edges = [
    traverses('pc-0', 'shuffler-0'),
    traverses('pc-7', 'bundle-0'),
    ...['q1', 'q2', 'q3'].map((q) => traverses(q, 'bundle-0')),
  ];
  const res = localize(snapshot(edges, [
    { id: 'shuffler-0', kind: 'passive_shuffler' },
    { id: 'bundle-0', kind: 'fiber_bundle' },
  ]), ['pc-0', 'pc-7'], { ...DEFAULT_LOCALIZE, collateralWeight: 2.0 });
  assert.ok(res.culprits.some((c) => c.resource_id === 'shuffler-0'));
  assert.deepEqual(res.unexplained_path_class_ids, ['pc-7']);
});
