import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadIncidenceFile } from '../tools/load-topology';
import { validateFaultDomainSnapshot, computeFaultDomainHash } from '../src/fault-domain-source';
import { runPipeline } from '../src/pipeline';
import { generateFabric } from '../src/fabric';

const FIXTURE = join(__dirname, 'fixtures', 'sample-incidence.json');

function goodObj(): Record<string, unknown> {
  return {
    path_classes: ['p0', 'p1'],
    resources: [{ id: 'shuffler-0', kind: 'passive_shuffler' }],
    edges: [{ path_class: 'p0', resource: 'shuffler-0', relationship: 'traverses' }],
  };
}

test('validateFaultDomainSnapshot accepts a well-formed incidence object', () => {
  const snap = validateFaultDomainSnapshot(goodObj());
  assert.equal(snap.path_classes.length, 2);
  assert.equal(snap.resources[0].kind, 'passive_shuffler');
  assert.equal(snap.source_id, 'operator-supplied'); // defaulted
});

test('validation rejects a non-object snapshot with the guard message (not an incidental downstream throw)', () => {
  for (const garbage of [null, 42]) {
    assert.throws(() => validateFaultDomainSnapshot(garbage), /snapshot must be an object/);
  }
});

test('validation rejects an invalid resource kind (RNG taxonomy enforced)', () => {
  const bad = { ...goodObj(), resources: [{ id: 'x', kind: 'gpu_shard' }] };
  assert.throws(() => validateFaultDomainSnapshot(bad), /not a valid RNG resource kind/);
});

test('validation rejects a dangling edge (referential integrity)', () => {
  const bad = { ...goodObj(), edges: [{ path_class: 'p9', resource: 'shuffler-0', relationship: 'traverses' }] };
  assert.throws(() => validateFaultDomainSnapshot(bad), /not a declared path_class/);
});

test('validation rejects a non-traverses relationship', () => {
  const bad = { ...goodObj(), edges: [{ path_class: 'p0', resource: 'shuffler-0', relationship: 'contains' }] };
  assert.throws(() => validateFaultDomainSnapshot(bad), /must be 'traverses'/);
});

test('operator-supplied aggregation views SURVIVE validation and reach the replay hash (cold-eye L1, ADR-0016)', () => {
  // Before the fix, validateFaultDomainSnapshot silently DROPPED o.views — an operator two-view
  // fabric lost its view definitions and therefore hashed identically to a view-less one.
  const withViews = validateFaultDomainSnapshot({ ...goodObj(), views: [{ view: 'per_tor', leaf_ids: ['p0', 'p1'] }] });
  assert.deepEqual(withViews.views, [{ view: 'per_tor', leaf_ids: ['p0', 'p1'] }]);
  const without = validateFaultDomainSnapshot(goodObj());
  assert.equal(without.views, undefined);
  assert.notEqual(computeFaultDomainHash(withViews), computeFaultDomainHash(without), 'views are part of the measurement design ⇒ part of the replay identity');
});

test('edge weights SURVIVE validation, and out-of-range weights are rejected (ADR-0014 binding; mutation gap)', () => {
  // Same bug class as the dropped views (L1): a validator that silently DROPS the weight — or stops
  // range-checking it — changes the operator's measurement design. Kills the surviving
  // fault-domain-source mutants (`!==`→`===` on the weight spread, `||`→`&&` on the range check).
  const weighted = { ...goodObj(), edges: [{ path_class: 'p0', resource: 'shuffler-0', relationship: 'traverses', weight: 0.25 }] };
  const snap = validateFaultDomainSnapshot(weighted);
  assert.equal(snap.edges[0].weight, 0.25, 'a validated edge keeps its fractional weight');
  for (const weight of [0, 2, '0.5']) {
    const bad = { ...goodObj(), edges: [{ path_class: 'p0', resource: 'shuffler-0', relationship: 'traverses', weight }] };
    assert.throws(() => validateFaultDomainSnapshot(bad), /weight must be a number in \(0, 1\]/, `weight ${JSON.stringify(weight)} must be rejected`);
  }
});

test('validation rejects a view referencing an undeclared leaf (referential integrity)', () => {
  const bad = { ...goodObj(), views: [{ view: 'per_tor', leaf_ids: ['p9'] }] };
  assert.throws(() => validateFaultDomainSnapshot(bad), /leaf_ids must be a non-empty array of declared path_classes/);
  const badName = { ...goodObj(), views: [{ view: '', leaf_ids: ['p0'] }] };
  assert.throws(() => validateFaultDomainSnapshot(badName), /view must be a non-empty string/);
  const empty = { ...goodObj(), views: [{ view: 'per_tor', leaf_ids: [] }] };
  assert.throws(() => validateFaultDomainSnapshot(empty), /leaf_ids must be a non-empty array/, 'an empty view is meaningless — rejected');
});

test('an operator incidence file loads + validates into a snapshot', () => {
  const snap = loadIncidenceFile(FIXTURE);
  assert.equal(snap.path_classes.length, 4);
  assert.equal(snap.resources.length, 5);
  assert.equal(snap.edges.length, 9);
  assert.ok(snap.edges.every((e) => e.relationship === 'traverses'));
  assert.match(computeFaultDomainHash(snap), /^[0-9a-f]{64}$/);
});

test('the pipeline runs on an injected (operator-supplied) snapshot and localizes on it', async () => {
  // a well-sampled injected snapshot (small topologies under-sample per-cell calibration; see STATE.md).
  const snap = generateFabric({ seed: 0x09e7a, n_path_classes: 250, n_optics: 48, n_shufflers: 12, n_bundles: 18, n_power_zones: 4, n_cooling_zones: 4 });
  const counts = new Map<string, number>();
  for (const e of snap.edges) if (e.resource.startsWith('shuffler-')) counts.set(e.resource, (counts.get(e.resource) ?? 0) + 1);
  const target = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const rec = await runPipeline({
    snapshot: snap, // <-- override the generated fabric with a supplied snapshot
    telemetry: { seed: 7, ticks: 80, degradation: { resource_id: target, delta: 4, start_tick: 0 } },
    q: 0.05,
  });
  assert.equal(rec.snapshot_hash, computeFaultDomainHash(snap), 'the audit must use the injected snapshot');
  assert.ok(rec.selected_path_class_ids.length > 0);
  assert.equal(rec.culprits[0].resource_id, target);
});
