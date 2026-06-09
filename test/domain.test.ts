import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCE_KINDS, isResourceKind } from '../src/domain';

test('resource taxonomy is the RNG-native (non-engine) set', () => {
  assert.ok(isResourceKind('optic'));
  assert.ok(isResourceKind('passive_shuffler'));
  assert.ok(isResourceKind('fiber_bundle'));
  // engine-only kinds must NOT be valid RNG resource kinds (ADR-0002 separation)
  assert.ok(!isResourceKind('gpu_shard'));
  assert.ok(!isResourceKind('nvlink_peer'));
  assert.equal(RESOURCE_KINDS.length, 7);
});
