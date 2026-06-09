import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFabric, DEFAULT_FABRIC } from '../src/fabric';
import { isResourceKind } from '../src/domain';

test('fabric generation is deterministic for fixed params', () => {
  const a = generateFabric(DEFAULT_FABRIC);
  const b = generateFabric(DEFAULT_FABRIC);
  assert.deepEqual(a.edges, b.edges);
  assert.deepEqual(a.resources, b.resources);
});

test('fabric has the requested path-class count (AC-1 range)', () => {
  const s = generateFabric(DEFAULT_FABRIC);
  assert.equal(s.path_classes.length, DEFAULT_FABRIC.n_path_classes);
  assert.ok(s.path_classes.length >= 100 && s.path_classes.length <= 10000);
});

test('every path-class traverses at least one resource; all edges are "traverses"', () => {
  const s = generateFabric(DEFAULT_FABRIC);
  const withEdges = new Set(s.edges.map((e) => e.path_class));
  for (const pc of s.path_classes) assert.ok(withEdges.has(pc), `${pc} has no incidence edge`);
  assert.ok(s.edges.every((e) => e.relationship === 'traverses'));
});

test('every resource referenced by an edge has a known RNG kind', () => {
  const s = generateFabric(DEFAULT_FABRIC);
  const kinds = new Map(s.resources.map((r) => [r.id, r.kind]));
  for (const e of s.edges) {
    const k = kinds.get(e.resource);
    assert.ok(k && isResourceKind(k), `resource ${e.resource} missing/invalid kind`);
  }
});

test('a non-positive path-class count is rejected (AC-1 lower-bound guard)', () => {
  assert.throws(() => generateFabric({ ...DEFAULT_FABRIC, n_path_classes: 0 }), /n_path_classes/);
});

test('changing the seed changes the incidence (measurement matrix is seed-driven)', () => {
  const a = generateFabric({ ...DEFAULT_FABRIC, seed: 1 });
  const b = generateFabric({ ...DEFAULT_FABRIC, seed: 2 });
  assert.notDeepEqual(a.edges, b.edges);
});
