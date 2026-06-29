/**
 * ADR-0029 (Phase 1) — magnitude-aware tomography member model, OPT-IN scorer.
 *
 * The load-bearing anti-self-confirming test (DISCIPLINES §6) is `discriminates by magnitude`:
 * two candidates with IDENTICAL fire-patterns but DIFFERENT member magnitudes must rank by
 * magnitude — if the `μz` term were deleted the scorer would tie and fall back to id order, and
 * that test would fail. Default-preservation pins the generalization: a binarized magnitude
 * reproduces the binary scorer's ranking. The pipeline does NOT use this scorer in Phase 1
 * (proven dormant) — so every other test in the suite is unaffected by construction.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localize, magnitudeZ, DEFAULT_LOCALIZE, DEFAULT_SCALES } from '../src/tomography';
import type { FaultDomainSnapshot, FaultDomainEdge, ResourceKind } from '../src/domain';

function snap(edges: FaultDomainEdge[], kinds: Record<string, ResourceKind>): FaultDomainSnapshot {
  const pcs = [...new Set(edges.map((e) => e.path_class))].sort();
  const resources = Object.entries(kinds).map(([id, kind]) => ({ id, kind }));
  return {
    nodes: [...pcs.map((id) => ({ id, kind: 'path_class' as const })), ...resources.map((r) => ({ id: r.id, kind: r.kind }))],
    edges, path_classes: pcs, resources, fetched_at_ts: 0, source_id: 'test', source_version: 'v1',
  };
}
const E = (path_class: string, resource: string, weight?: number): FaultDomainEdge => ({ path_class, resource, relationship: 'traverses', ...(weight !== undefined ? { weight } : {}) });
const ids = (r: { culprits: { resource_id: string }[] }): string[] => r.culprits.map((c) => c.resource_id);

// ───────────────────────── D1: the magnitude currency z(E) ─────────────────────────

test('magnitudeZ: z(E≤1)=0, monotone, and z(e^{θ²/2}) = θ exactly (the KL→shift identity)', () => {
  assert.equal(magnitudeZ(1), 0);
  assert.equal(magnitudeZ(0.5), 0, 'sub-unit e-value sits at the null');
  assert.ok(magnitudeZ(10) > magnitudeZ(2) && magnitudeZ(2) > 0, 'monotone increasing above 1');
  for (const theta of [0.5, 1, 2, 4]) {
    assert.ok(Math.abs(magnitudeZ(Math.exp((theta * theta) / 2)) - theta) < 1e-12, `z(e^{${theta}²/2}) = ${theta}`);
  }
});

// ───────────────────────── the anti-self-confirming core ─────────────────────────

test('discriminates by magnitude: identical fire-patterns, different magnitudes ⇒ ranking flips vs binary', () => {
  // r-a and r-b each carry exactly one firing member at weight 1 — IDENTICAL patterns. The binary
  // scorer ties them and breaks by id (r-a first). Magnitude: r-b's member fired far harder.
  const s = snap([E('pc-a', 'r-a', 1), E('pc-b', 'r-b', 1)], { 'r-a': 'optic', 'r-b': 'optic' });
  const firing = ['pc-a', 'pc-b'];

  const binary = localize(s, firing);
  assert.equal(binary.culprits[0].resource_id, 'r-a', 'binary ties on identical patterns ⇒ id order');

  const mag = new Map([['pc-a', Math.exp(0.125)], ['pc-b', Math.exp(8)]]); // z: 0.5 vs 4
  const magnitude = localize(s, firing, { ...DEFAULT_LOCALIZE, magnitude: mag });
  assert.equal(magnitude.culprits[0].resource_id, 'r-b', 'magnitude ranks the harder-firing member #1 — the μz term is genuinely used');
});

// ───────────────────────── default preservation (the generalization pin) ─────────────────────────

const DECOY = snap([
  E('pc1', 'true-shuffler', 1.0), E('pc2', 'true-shuffler', 1.0), E('pc3', 'true-shuffler', 1.0),
  E('q1', 'true-shuffler', 0.05), E('q2', 'true-shuffler', 0.05),
  E('pc1', 'decoy-optic', 0.3), E('pc2', 'decoy-optic', 0.3), E('pc3', 'decoy-optic', 0.3),
], { 'true-shuffler': 'passive_shuffler', 'decoy-optic': 'optic' });
const DECOY_FIRING = ['pc1', 'pc2', 'pc3'];

test('default preservation AT SMALL q₀: a BINARIZED magnitude reproduces the binary ranking (ADR-0014 decoy fixture)', () => {
  // DEFAULT_LOCALIZE q₀=0.01 — the surface's typical quiet-fleet base rate. Preservation is a
  // small-q₀ property, NOT a global identity (see the divergence fixture below): the magnitude null
  // is μ=0, which only coincides with the binary base-rate null when q₀≈0.
  const binary = localize(DECOY, DECOY_FIRING);
  const flat = new Map(DECOY_FIRING.map((pc) => [pc, Math.exp(8)])); // constant supra-threshold ⇒ z is a "fired" bit
  const magBinarized = localize(DECOY, DECOY_FIRING, { ...DEFAULT_LOCALIZE, magnitude: flat });
  assert.deepEqual(ids(magBinarized), ids(binary), 'binarized magnitude must reproduce the binary culprit ranking at small q₀');
  assert.deepEqual(magBinarized.explained_path_class_ids, binary.explained_path_class_ids, 'and the explained set');
});

test('DIVERGENCE (recorded, instrumented-caveat): the magnitude null is q₀-BLIND — diverges from binary at high q₀', () => {
  // The binary LLR null is base-rate aware (a fleet-wide event firing at ≈q₀ is NOT evidence); the
  // magnitude scorer's null is μ=0, with no q₀ term. So at a high q₀ they DISAGREE. Pinned here in
  // the open: this is the gap the ADR Risk flagged (map q₀ to a null offset) and it is a REQUIRED
  // prerequisite for the Phase-2 pipeline flip — until then the magnitude scorer stays dormant.
  const edges = ['f1', 'f2', 'f3', 'q1', 'q2'].map((p) => E(p, 'bundle-0', 1));
  const s = snap(edges, { 'bundle-0': 'fiber_bundle' });
  const firing = ['f1', 'f2', 'f3'];
  const flat = new Map(firing.map((pc) => [pc, Math.exp(8)]));

  // q₀=0.5 (fleet-wide event): binary correctly blames NOTHING …
  const binary = localize(s, firing, { ...DEFAULT_LOCALIZE, q0: 0.5 });
  assert.equal(binary.culprits.length, 0, 'binary: base-rate firing is not evidence');
  // … but binarized magnitude (q₀-blind null) fabricates a culprit — the recorded divergence.
  const mag = localize(s, firing, { ...DEFAULT_LOCALIZE, q0: 0.5, magnitude: flat });
  assert.equal(mag.culprits[0]?.resource_id, 'bundle-0', 'magnitude: q₀-blind null blames a fleet-wide event (KNOWN gap, Phase-2 blocker)');

  // At the quiet-fleet q₀=0.05 they AGREE again — bounding the divergence to high base rates.
  assert.equal(localize(s, firing, { ...DEFAULT_LOCALIZE, q0: 0.05 }).culprits[0]?.resource_id, 'bundle-0');
  assert.equal(localize(s, firing, { ...DEFAULT_LOCALIZE, q0: 0.05, magnitude: flat }).culprits[0]?.resource_id, 'bundle-0');
});

test('magnitudeZ fails loud on a non-finite or negative e-value (no silent NaN-vanish)', () => {
  assert.throws(() => magnitudeZ(Infinity), /finite/);
  assert.throws(() => magnitudeZ(-1), /≥ 0/);
});

test('no regression with REAL (varied) magnitudes: the follow-the-traffic culprit still wins (ADR-0014/0019)', () => {
  // firing leaves carry genuinely different e-values; the magnitude scorer must NOT flip the
  // ADR-0014 result (true-shuffler, the resource traffic actually flows through, stays rank-1).
  const varied = new Map([['pc1', Math.exp(2)], ['pc2', Math.exp(4.5)], ['pc3', Math.exp(8)]]);
  const magnitude = localize(DECOY, DECOY_FIRING, { ...DEFAULT_LOCALIZE, magnitude: varied });
  assert.equal(magnitude.culprits[0].resource_id, 'true-shuffler', 'magnitude keeps following the traffic');
});

// ───────────────────────── contracts: fail-closed + fixed-form S ─────────────────────────

test('fail-closed: a firing leaf with no supplied e-value in magnitude mode throws', () => {
  const s = snap([E('pc-a', 'r-a', 1), E('pc-b', 'r-a', 1)], { 'r-a': 'optic' });
  assert.throws(
    () => localize(s, ['pc-a', 'pc-b'], { ...DEFAULT_LOCALIZE, magnitude: new Map([['pc-a', Math.exp(4)]]) }),
    /no e-value/,
    'a firing leaf missing from the magnitude map must throw, not silently score z=0',
  );
});

test('S grid is fixed-form (ADR-0029 D2): DEFAULT_SCALES is the frozen {1,2,4}, no data-derived path', () => {
  assert.deepEqual([...DEFAULT_SCALES], [1, 2, 4]);
  assert.ok(Object.isFrozen(DEFAULT_SCALES), 'the S grid is a constant, not a tunable knob');
});

test('N1 intact under the magnitude scorer: every culprit stays correlational-not-causal', () => {
  const mag = new Map([['pc-a', Math.exp(4)], ['pc-b', Math.exp(4)]]);
  const r = localize(snap([E('pc-a', 'r-a', 1), E('pc-b', 'r-b', 1)], { 'r-a': 'optic', 'r-b': 'optic' }), ['pc-a', 'pc-b'], { ...DEFAULT_LOCALIZE, magnitude: mag });
  for (const c of r.culprits) assert.equal(c.correlational_not_causal, true);
});
