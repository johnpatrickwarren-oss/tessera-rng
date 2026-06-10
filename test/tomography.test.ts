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

test('LEGACY-CONTROL: the linear scorer rejects an exactly-gain-0 resource (the old boundary)', () => {
  // λ=1, one firing + one quiet -> gain = 1 - 1 = 0 -> excluded under the OLD linear scorer.
  // Retained only as the failure-mode control for the leaky-LLR (ADR-0016); not the default path.
  const edges = [traverses('pc-0', 'optic-0'), traverses('q1', 'optic-0')];
  const res = localize(snapshot(edges, [{ id: 'optic-0', kind: 'optic' }]), ['pc-0'], { ...DEFAULT_LOCALIZE, legacy: true, collateralWeight: 1.0 });
  assert.equal(res.culprits.length, 0, 'a zero-gain resource explains nothing net (linear scorer)');
  assert.deepEqual(res.unexplained_path_class_ids, ['pc-0']);
});

test('maxResources caps the explaining set (parsimony), leaving the rest unexplained', () => {
  const edges = [traverses('pc-0', 'shuffler-0'), traverses('pc-1', 'shuffler-1')];
  const res = localize(snapshot(edges, [
    { id: 'shuffler-0', kind: 'passive_shuffler' },
    { id: 'shuffler-1', kind: 'passive_shuffler' },
  ]), ['pc-0', 'pc-1'], { ...DEFAULT_LOCALIZE, maxResources: 1 });
  assert.equal(res.culprits.length, 1, 'never exceed the parsimony cap');
  assert.equal(res.unexplained_path_class_ids.length, 1);
});

test('unexplained firing paths are reported, not hidden (instrumented-caveat)', () => {
  // pc-7's only resource is bundle-0, whose 10 quiet high-weight members FALSIFY it under the
  // leaky-LLR (negative LLR) → it is not blamed → pc-7 is reported unexplained, never hidden.
  const edges = [
    traverses('pc-0', 'shuffler-0'),
    traverses('pc-7', 'bundle-0'),
    ...['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10'].map((q) => traverses(q, 'bundle-0')),
  ];
  const res = localize(snapshot(edges, [
    { id: 'shuffler-0', kind: 'passive_shuffler' },
    { id: 'bundle-0', kind: 'fiber_bundle' },
  ]), ['pc-0', 'pc-7']);
  assert.ok(res.culprits.some((c) => c.resource_id === 'shuffler-0'));
  assert.ok(!res.culprits.some((c) => c.resource_id === 'bundle-0'), 'the falsified high-collateral resource is not blamed');
  assert.deepEqual(res.unexplained_path_class_ids, ['pc-7']);
});

// ── Leaky-LLR scorer (ADR-0016) ─────────────────────────────────────────────────

test('the LLR null is BASE-RATE AWARE: members firing at ≈ the fleet base rate are not evidence (ADR-0016)', () => {
  // 3 of 5 w=1 members firing. At a high fleet base rate (q₀=0.5, e.g. a fleet-wide event) that
  // pattern is ~what the null predicts → LLR rejects. The λ=1 LINEAR control still blames it
  // (gain = 3 − 2 = 1 > 0): the linear scorer has no concept of a base rate. This is the
  // anti-self-confirming discriminator — if the default scorer silently became the linear one,
  // this test fails. At a quiet-fleet q₀=0.05 the same pattern IS evidence and the LLR blames.
  const edges = ['f1', 'f2', 'f3', 'q1', 'q2'].map((p) => traverses(p, 'bundle-0'));
  const snap = snapshot(edges, [{ id: 'bundle-0', kind: 'fiber_bundle' }]);
  const firing = ['f1', 'f2', 'f3'];

  const noisy = localize(snap, firing, { ...DEFAULT_LOCALIZE, q0: 0.5 });
  assert.equal(noisy.culprits.length, 0, 'base-rate firing is not evidence under the LLR null');
  assert.deepEqual(noisy.unexplained_path_class_ids, firing);

  const linear = localize(snap, firing, { ...DEFAULT_LOCALIZE, legacy: true, collateralWeight: 1.0 });
  assert.equal(linear.culprits[0]?.resource_id, 'bundle-0', 'the linear CONTROL blames it regardless (the failure mode)');

  const quiet = localize(snap, firing, { ...DEFAULT_LOCALIZE, q0: 0.05 });
  assert.equal(quiet.culprits[0]?.resource_id, 'bundle-0', 'on a quiet fleet the same pattern is real evidence');
  assert.ok(quiet.culprits[0].score > 0);
});

test('a degenerate mixture is rejected, never ranked (empty grid OR empty κ grid blames nothing instead of everything)', () => {
  // an empty grid/kappas makes logMixExp −Infinity (Math.max of nothing + log 0); the
  // `!(score > 0)` gate rejects it — a misconfigured caller gets no culprits, not garbage.
  const edges = ['f1', 'f2'].map((p) => traverses(p, 'bundle-0'));
  const snap = snapshot(edges, [{ id: 'bundle-0', kind: 'fiber_bundle' }]);
  for (const broken of [{ grid: [] as number[] }, { kappas: [] as number[] }]) {
    const r = localize(snap, ['f1', 'f2'], { ...DEFAULT_LOCALIZE, ...broken });
    assert.equal(r.culprits.length, 0, `no culprit may be ranked under ${JSON.stringify(broken)}`);
    assert.deepEqual(r.unexplained_path_class_ids, ['f1', 'f2']);
  }
});

test('q₀ outside (0, 1) is rejected — at q₀ = 0 every candidate scores +Infinity and garbage would rank (ADR-0019 cold-eye)', () => {
  const edges = ['f1', 'f2'].map((p) => traverses(p, 'bundle-0'));
  const snap = snapshot(edges, [{ id: 'bundle-0', kind: 'fiber_bundle' }]);
  for (const q0 of [0, 1, -0.1, 1.5]) {
    assert.throws(() => localize(snap, ['f1', 'f2'], { ...DEFAULT_LOCALIZE, q0 }), /q0 must be in \(0, 1\)/, `q0=${q0}`);
  }
});

test('supporting_views lists exactly the views with a FIRING member of the culprit — metadata, not mechanism (ADR-0016)', () => {
  const edges = ['f1', 'f2', 'f3', 'q1', 'q2'].map((p) => traverses(p, 'bundle-0'));
  const snap = snapshot(edges, [{ id: 'bundle-0', kind: 'fiber_bundle' }]);
  const withViews = {
    ...snap,
    views: [
      { view: 'va', leaf_ids: ['f1', 'f2', 'q1'] }, // firing members → supporting
      { view: 'vb', leaf_ids: ['f3', 'q2'] },       // firing member  → supporting
      { view: 'vc', leaf_ids: ['q1', 'q2'] },       // quiet members only → NOT supporting
    ],
  };
  const r = localize(withViews, ['f1', 'f2', 'f3'], { ...DEFAULT_LOCALIZE, q0: 0.05 });
  assert.deepEqual(r.culprits[0].supporting_views, ['va', 'vb']);

  const noViews = localize(snap, ['f1', 'f2', 'f3'], { ...DEFAULT_LOCALIZE, q0: 0.05 });
  assert.deepEqual(noViews.culprits[0].supporting_views, [], 'a view-less fabric carries empty supporting_views');
});

// ── ADR-0022 binarization + legacy-control coverage (mutation-surfaced gaps) ──

test('a firing leaf the picked set only WEAKLY touches stays unexplained — touch alone is not explanation (ADR-0022)', () => {
  // fx is a member of the picked resource at w=0.05, but the posterior (driven by the three w=1
  // members) leaves P(fire fx | set) < ½ → reported unexplained. Kills the &&→|| mutant on the
  // binarization conjunction (under which "touched" alone would count as explained).
  const edges = [traverses('f1', 'r'), traverses('f2', 'r'), traverses('f3', 'r'), { ...traverses('fx', 'r'), weight: 0.05 }];
  const snap = snapshot(edges, [{ id: 'r', kind: 'fiber_bundle' }]);
  const res = localize(snap, ['f1', 'f2', 'f3', 'fx'], { ...DEFAULT_LOCALIZE, q0: 0.01 });
  assert.deepEqual(res.culprits.map((c) => c.resource_id), ['r']);
  assert.deepEqual(res.explained_path_class_ids, ['f1', 'f2', 'f3']);
  assert.deepEqual(res.unexplained_path_class_ids, ['fx'], 'weak touch ≠ explanation');
});

test('LEGACY-CONTROL: deterministic tie-break, gain ordering, and the maxResources cap hold on the legacy path', () => {
  // The historic tie-break/cap tests migrated to the default (marginal) path when ADR-0022
  // landed; these pin the CONTROL path's own determinism (mutation-surfaced gap).
  const L = { ...DEFAULT_LOCALIZE, legacy: true, collateralWeight: 1.0 };
  const tie = localize(snapshot(
    [traverses('pc-1', 'shuffler-1'), traverses('pc-0', 'shuffler-0')],
    [{ id: 'shuffler-1', kind: 'passive_shuffler' }, { id: 'shuffler-0', kind: 'passive_shuffler' }],
  ), ['pc-0', 'pc-1'], L);
  assert.equal(tie.culprits[0].resource_id, 'shuffler-0', 'equal gains → lower id first');
  assert.equal(tie.culprits[1].resource_id, 'shuffler-1');
  const order = localize(snapshot(
    [traverses('pc-0', 'shuffler-9'), traverses('pc-1', 'shuffler-9'), traverses('pc-2', 'optic-0')],
    [{ id: 'shuffler-9', kind: 'passive_shuffler' }, { id: 'optic-0', kind: 'optic' }],
  ), ['pc-0', 'pc-1', 'pc-2'], L);
  assert.equal(order.culprits[0].resource_id, 'shuffler-9', 'higher gain beats smaller id');
  const capped = localize(snapshot(
    [traverses('pc-0', 'shuffler-0'), traverses('pc-1', 'shuffler-1')],
    [{ id: 'shuffler-0', kind: 'passive_shuffler' }, { id: 'shuffler-1', kind: 'passive_shuffler' }],
  ), ['pc-0', 'pc-1'], { ...L, maxResources: 1 });
  assert.equal(capped.culprits.length, 1, 'the cap binds on the legacy path too');
  assert.equal(capped.unexplained_path_class_ids.length, 1);
});
