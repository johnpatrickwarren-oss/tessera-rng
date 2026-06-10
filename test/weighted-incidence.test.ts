/**
 * Weighted (fractional) incidence (ADR-0014): a path-class traverses a resource with a traffic
 * weight w ∈ (0, 1] (Spraypoint dilution, arXiv 2604.15261 / ADR-0013). Telemetry dilutes a fault's
 * mean shift by w; tomography scores explanation/collateral by w. Weight 1 ⇒ the v1 binary fabric,
 * byte-identical.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localize, DEFAULT_LOCALIZE } from '../src/tomography';
import { generateTelemetry } from '../src/telemetry';
import { computeFaultDomainHash } from '../src/fault-domain-source';
import type { FaultDomainSnapshot, FaultDomainEdge, ResourceKind } from '../src/domain';
import { signalIndex } from '../src/signals';

function snap(edges: FaultDomainEdge[], kinds: Record<string, ResourceKind>): FaultDomainSnapshot {
  const pcs = [...new Set(edges.map((e) => e.path_class))].sort();
  const resources = Object.entries(kinds).map(([id, kind]) => ({ id, kind }));
  return {
    nodes: [...pcs.map((id) => ({ id, kind: 'path_class' as const })), ...resources.map((r) => ({ id: r.id, kind: r.kind }))],
    edges,
    path_classes: pcs,
    resources,
    fetched_at_ts: 0,
    source_id: 'test',
    source_version: 'v1',
  };
}
const E = (path_class: string, resource: string, weight?: number): FaultDomainEdge => ({ path_class, resource, relationship: 'traverses', ...(weight !== undefined ? { weight } : {}) });
const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

test('telemetry dilutes a fault by the leaf traffic weight: shift = delta·w (ADR-0014)', () => {
  const s = snap([E('pc-full', 'r-1', 1.0), E('pc-half', 'r-1', 0.5)], { 'r-1': 'passive_shuffler' });
  const p99 = signalIndex('p99_latency');
  const clean = generateTelemetry(s, { seed: 5, ticks: 40 });
  const deg = generateTelemetry(s, { seed: 5, ticks: 40, degradation: { resource_id: 'r-1', delta: 4, start_tick: 0 } });
  // same seed ⇒ identical noise ⇒ the per-tick difference IS the diluted shift, exactly delta·w.
  for (const [pc, w] of [['pc-full', 1.0], ['pc-half', 0.5]] as const) {
    const c = clean.series.get(pc)!;
    const d = deg.series.get(pc)!;
    for (let t = 0; t < 40; t++) {
      assert.ok(Math.abs((d[t][p99] - c[t][p99]) - 4 * w) < 1e-9, `${pc} tick ${t}: shift must be 4·${w}`);
    }
  }
});

test('weighted tomography picks the resource traffic actually flows through — where the unweighted scorer fails (ADR-0014)', () => {
  // firing set {pc1,pc2,pc3}. Decoy carries them at low weight (they barely route through it);
  // the True culprit carries them at full weight plus two barely-traversing quiet members.
  const edges = [
    E('pc1', 'true-shuffler', 1.0), E('pc2', 'true-shuffler', 1.0), E('pc3', 'true-shuffler', 1.0),
    E('q1', 'true-shuffler', 0.05), E('q2', 'true-shuffler', 0.05),
    E('pc1', 'decoy-optic', 0.3), E('pc2', 'decoy-optic', 0.3), E('pc3', 'decoy-optic', 0.3),
  ];
  const s = snap(edges, { 'true-shuffler': 'passive_shuffler', 'decoy-optic': 'optic' });
  const firing = ['pc1', 'pc2', 'pc3'];

  // WEIGHTED: true gain = 3·1 − λ·(2·0.05) = 2.9 ; decoy gain = 3·0.3 = 0.9 → true wins.
  const weighted = localize(s, firing);
  assert.equal(weighted.culprits[0].resource_id, 'true-shuffler', 'weighted scorer must follow the traffic');

  // UNWEIGHTED control (strip weights → all 1): true gain = 3 − λ·2 = 1 ; decoy gain = 3 → decoy wins.
  // This proves the old failure mode existed and that the weighting (not luck) fixes it.
  const stripped = snap(edges.map((e) => E(e.path_class, e.resource)), { 'true-shuffler': 'passive_shuffler', 'decoy-optic': 'optic' });
  const unweighted = localize(stripped, firing);
  assert.equal(unweighted.culprits[0].resource_id, 'decoy-optic', 'the unweighted scorer picks the wrong (incidental) resource');

  // N1 intact under weighting: every culprit still carries the non-causal flag, counts are integer.
  for (const c of weighted.culprits) {
    assert.equal(c.correlational_not_causal, true);
    assert.ok(Number.isInteger(c.firing_member_count) && Number.isInteger(c.traversing_count));
  }
});

test('all-weight-1 incidence is byte-identical to the v1 binary fabric (the anti-self-confirming guard)', () => {
  const edges = [E('pc1', 'r', 1.0), E('pc2', 'r', 1.0), E('pc3', 'r'), E('pc4', 'r')]; // pc3/pc4 quiet
  const withW = snap(edges, { r: 'passive_shuffler' });
  const noW = snap(edges.map((e) => E(e.path_class, e.resource)), { r: 'passive_shuffler' });
  const a = localize(withW, ['pc1', 'pc2'], DEFAULT_LOCALIZE);
  const b = localize(noW, ['pc1', 'pc2'], DEFAULT_LOCALIZE);
  assert.deepEqual(a.culprits, b.culprits, 'explicit weight 1 must localize identically to no weight');
  assert.deepEqual(a.unexplained_path_class_ids, b.unexplained_path_class_ids);
});

test('the snapshot hash incorporates weight — a re-weighted incidence is a distinct measurement design', () => {
  const a = snap([E('pc1', 'r', 1.0)], { r: 'passive_shuffler' });
  const b = snap([E('pc1', 'r', 0.4)], { r: 'passive_shuffler' });
  assert.notEqual(computeFaultDomainHash(a), computeFaultDomainHash(b), 'different weights ⇒ different hash');
  // weight 1 must equal the absent-weight (v1) hash so default fabrics are unaffected.
  const explicit1 = snap([E('pc1', 'r', 1.0)], { r: 'passive_shuffler' });
  const absent = snap([E('pc1', 'r')], { r: 'passive_shuffler' });
  assert.equal(computeFaultDomainHash(explicit1), computeFaultDomainHash(absent), 'weight 1 ≡ absent (byte-identical default)');
});
