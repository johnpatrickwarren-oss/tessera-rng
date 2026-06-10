import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuditRecord, Culprit, PathClassVerdict } from '../src/verdict';

// verdict.ts is the output-contract type module. These tests pin the shape that the rest of
// the pipeline (and any downstream consumer / audit reader) depends on — if a required field
// is dropped or renamed, construction here fails to type-check and the build breaks.

test('a Culprit always carries the non-causal flag and provenance (N1 contract)', () => {
  const c: Culprit = {
    resource_id: 'shuffler-3',
    resource_kind: 'passive_shuffler',
    score: 4,
    member_path_class_ids: ['pc-0', 'pc-1'],
    firing_member_count: 2,
    traversing_count: 2,
    correlational_not_causal: true,
  };
  // (The runtime guarantee that localize() always sets this flag is verified in
  // anti-scope.test.ts / tomography.test.ts; here we only pin the type shape + provenance.)
  assert.equal(c.member_path_class_ids.length, c.firing_member_count);
});

test('a PathClassVerdict records per-detector α-budget for both families (AC-2 contract)', () => {
  const v: PathClassVerdict = {
    path_class_id: 'pc-0',
    detectors: [
      { family: 'A', e_value: 500, fired: true, alpha_allocated: 0.01, alpha_spent: 0.01 },
      { family: 'C', e_value: 2, fired: false, alpha_allocated: 0.01, alpha_spent: 0 },
    ],
    e_value: 251,
    fired: true,
    alpha_spent: 0.01,
  };
  assert.deepEqual(v.detectors.map((d) => d.family), ['A', 'C']);
});

test('an AuditRecord exposes the honest-measurement fields (unexplained set + firing-mode tally required)', () => {
  const rec: AuditRecord = {
    snapshot_hash: 'a'.repeat(64),
    q: 0.05,
    fleet_log_e: 1.2,
    verdicts: [],
    selected_path_class_ids: [],
    culprits: [],
    unexplained_path_class_ids: [],
    drain_actions: [],
    firing_families: { A: 0, C: 0, D: 0 },
  };
  assert.ok('unexplained_path_class_ids' in rec, 'unexplained set must be a first-class audit field');
  assert.ok('firing_families' in rec, 'firing-mode attribution must be a first-class audit field (ADR-0010)');
});
