import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateDrain } from '../src/drain';
import type { FaultDomainSnapshot } from '../src/domain';
import type { Culprit } from '../src/verdict';

function snap(): FaultDomainSnapshot {
  return {
    nodes: [],
    edges: [
      { path_class: 'pc-0', resource: 'shuffler-0', relationship: 'traverses' },
      { path_class: 'pc-1', resource: 'shuffler-0', relationship: 'traverses' },
      { path_class: 'pc-2', resource: 'optic-7', relationship: 'traverses' },
    ],
    path_classes: ['pc-0', 'pc-1', 'pc-2'],
    resources: [
      { id: 'shuffler-0', kind: 'passive_shuffler' },
      { id: 'optic-7', kind: 'optic' },
    ],
    fetched_at_ts: 0,
    source_id: 's',
    source_version: 'v',
  };
}

function culprit(id: string): Culprit {
  return { resource_id: id, resource_kind: 'passive_shuffler', score: 2, member_path_class_ids: [], firing_member_count: 2, traversing_count: 2, correlational_not_causal: true };
}

test('drain is simulated and covers exactly the path-classes traversing the culprit', () => {
  const action = simulateDrain(snap(), culprit('shuffler-0'));
  assert.equal(action.simulated, true);
  assert.deepEqual([...action.drained_path_class_ids], ['pc-0', 'pc-1']);
});

test('drain on a resource with no traversing path-classes is an empty (still simulated) action', () => {
  const action = simulateDrain(snap(), culprit('nonexistent'));
  assert.equal(action.simulated, true);
  assert.equal(action.drained_path_class_ids.length, 0);
});
