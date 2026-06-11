/**
 * THE unified traffic model (ADR-0028): one elementary flow space — (unordered ToR pair {i,j},
 * panel p), uniform over C(nTors,2) × nPanels; a flow crosses optic-i, optic-j, panel-p, and
 * room(p) with room(p) = p mod nRooms (the stated convention). Every fabric view weight is
 * P(cross r | flow ∈ leaf) and every drill exposure is P(cross r | flow ∈ pair) on that SAME
 * space.
 *
 * The keystone here is anti-self-confirming by construction (DISCIPLINES §6): the tests below
 * ENUMERATE the space and count traversals — no closed form from src/ is reused — and demand
 * exact agreement with both `generateSpraypointFabric` and `exposedPairs`. Replace either
 * implementation's formulas with a no-op or a different convention and the counts disagree.
 * (Exact FP equality is deliberate: both sides are correctly-rounded quotients of the same
 * rational, so IEEE division makes them identical doubles.)
 *
 * ONE exception, asserted from both sides so it can never rot silently: the tor-leaf
 * cross-optic term (true P = 1/(nTors−1)) is the RECORDED ADR-0028 narrowing — the fabric
 * deliberately omits it (the full-support variant collapsed cross-kind localization and the
 * δ-sweep; measurements in the ADR). If you add the edges back, this file fails until the
 * narrowing is re-decided on the record.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import type { SpraypointParams } from '../src/spraypoint';
import { exposedPairs } from '../src/drilldown';

/** One elementary flow and the resources it crosses — defined HERE, from the ADR-0028 prose. */
interface Flow { i: number; j: number; p: number }

function* flows(params: SpraypointParams): Generator<Flow> {
  for (let i = 0; i < params.nTors; i++) {
    for (let j = i + 1; j < params.nTors; j++) {
      for (let p = 0; p < params.nPanels; p++) yield { i, j, p };
    }
  }
}

function crossings(f: Flow, params: SpraypointParams): string[] {
  return [`optic-${f.i}`, `optic-${f.j}`, `panel-${f.p}`, `room-${f.p % params.nRooms}`];
}

/** P(cross r | flow ∈ leaf) for every leaf × resource, by counting — the independent reference. */
function enumerateViewWeights(params: SpraypointParams): Map<string, Map<string, number>> {
  const inLeaf = new Map<string, { total: number; cross: Map<string, number> }>();
  const bump = (leaf: string, crossed: string[]) => {
    let a = inLeaf.get(leaf);
    if (!a) { a = { total: 0, cross: new Map() }; inLeaf.set(leaf, a); }
    a.total += 1;
    for (const r of crossed) a.cross.set(r, (a.cross.get(r) ?? 0) + 1);
  };
  for (const f of flows(params)) {
    const crossed = crossings(f, params);
    bump(`tor-${f.i}`, crossed); // a flow belongs to BOTH endpoints' per-ToR leaves...
    bump(`tor-${f.j}`, crossed);
  }
  // ...and to every pp leaf whose panel set contains its panel. Done in a second pass so the
  // pp membership rule is stated explicitly rather than folded into the loop above.
  for (let x = 0; x < params.nPanels; x++) {
    for (let y = x + 1; y < params.nPanels; y++) {
      const leaf = `pp-${x}-${y}`;
      for (const f of flows(params)) {
        if (f.p === x || f.p === y) bump(leaf, crossings(f, params));
      }
    }
  }
  const out = new Map<string, Map<string, number>>();
  for (const [leaf, a] of inLeaf) {
    const m = new Map<string, number>();
    for (const [r, c] of a.cross) m.set(r, c / a.total);
    out.set(leaf, m);
  }
  return out;
}

/** P(cross r | flow ∈ pair) by counting over the pair's nPanels flows. */
function enumeratePairExposure(pair: { i: number; j: number }, resource: string, params: SpraypointParams): number {
  let cross = 0;
  let total = 0;
  for (let p = 0; p < params.nPanels; p++) {
    total += 1;
    if (crossings({ i: pair.i, j: pair.j, p }, params).includes(resource)) cross += 1;
  }
  return cross / total;
}

/** The ONE recorded ADR-0028 narrowing: a tor leaf's PARTNER optics are not edges. */
function isRecordedCrossOpticOmission(leaf: string, resource: string): boolean {
  return leaf.startsWith('tor-') && resource.startsWith('optic-') && resource !== `optic-${leaf.slice(4)}`;
}

function checkFabricAgainstEnumeration(params: SpraypointParams): void {
  const snap = generateSpraypointFabric(params);
  const ref = enumerateViewWeights(params);
  const edgeWeight = new Map<string, number>();
  for (const e of snap.edges) edgeWeight.set(`${e.path_class}→${e.resource}`, e.weight ?? 1);
  // every enumerated nonzero traversal probability has exactly that edge weight...
  let checked = 0;
  for (const [leaf, m] of ref) {
    for (const r of snap.resources) {
      const want = m.get(r.id) ?? 0;
      const got = edgeWeight.get(`${leaf}→${r.id}`);
      if (isRecordedCrossOpticOmission(leaf, r.id)) {
        // ...EXCEPT the recorded narrowing, asserted from BOTH sides so it can never rot
        // silently: the flow space says the traversal is real, the fabric deliberately omits it.
        assert.equal(want, 1 / (params.nTors - 1), `${leaf}→${r.id}: the omitted term's true probability`);
        assert.equal(got, undefined, `${leaf}→${r.id}: the cross-optic edge is the RECORDED ADR-0028 omission — adding it back requires re-deciding the narrowing on the record (see the rejected full-support measurements)`);
      } else if (want === 0) {
        assert.equal(got, undefined, `${leaf}→${r.id}: zero-probability traversal must have NO edge`);
      } else {
        assert.equal(got, want, `${leaf}→${r.id}: fabric weight must equal the enumerated P(cross|leaf)`);
        checked += 1;
      }
    }
  }
  // ...and the fabric has no edges beyond the enumerated support (completeness both ways).
  assert.equal(snap.edges.length, checked, 'no fabric edge outside the enumerated flow support');
}

test('KEYSTONE (ADR-0028): fabric view weights ARE the enumerated flow-space probabilities — default fabric', () => {
  checkFabricAgainstEnumeration(DEFAULT_SPRAYPOINT);
});

test('KEYSTONE (ADR-0028): holds on an ASYMMETRIC fabric (uneven panels per room)', () => {
  // 4 panels over 3 rooms: room-0={p0,p3}, room-1={p1}, room-2={p2} — the case where the old
  // flat 1/nRooms tor-leaf convention was simply wrong (1/3 each vs true 1/2, 1/4, 1/4).
  checkFabricAgainstEnumeration({ nTors: 6, nPanels: 4, nRooms: 3 });
});

test('KEYSTONE (ADR-0028): drill exposures derive from the SAME space — both fabrics', () => {
  for (const params of [DEFAULT_SPRAYPOINT, { nTors: 6, nPanels: 4, nRooms: 3 }]) {
    const resources = [`optic-3`, `panel-1`, `room-0`, `room-${params.nRooms - 1}`];
    for (const resource of resources) {
      const byPair = new Map(exposedPairs(params, resource).map((e) => [e.pair, e.exposure]));
      for (let i = 0; i < params.nTors; i++) {
        for (let j = i + 1; j < params.nTors; j++) {
          const want = enumeratePairExposure({ i, j }, resource, params);
          const got = byPair.get(`pair-${i}-${j}`) ?? 0;
          assert.equal(got, want, `${resource} exposure of pair-${i}-${j} must equal the enumerated P(cross|pair)`);
        }
      }
    }
  }
});

test('closed forms on the DEFAULT fabric, exact (the ADR-0028 weight table)', () => {
  const snap = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
  const w = (leaf: string, r: string): number | undefined =>
    snap.edges.find((e) => e.path_class === leaf && e.resource === r)?.weight;
  assert.equal(w('tor-3', 'optic-3'), 1, 'own optic: every flow crosses it');
  assert.equal(w('tor-3', 'optic-7'), undefined, 'partner optic: the recorded ADR-0028 omission (true P = 1/63, bound in the keystone)');
  assert.equal(w('tor-3', 'panel-2'), 1 / 10, 'panels uniform');
  assert.equal(w('tor-3', 'room-0'), 5 / 10, 'room = its panel share (even split here)');
  assert.equal(w('pp-0-1', 'panel-0'), 1 / 2, 'one panel per flow — NOT the old two-panel w=1');
  assert.equal(w('pp-0-1', 'panel-1'), 1 / 2);
  assert.equal(w('pp-0-1', 'optic-9'), 2 / 64, 'both-endpoint counting — NOT the old source-side 1/nTors');
  assert.equal(w('pp-0-2', 'room-0'), 1, 'both panels in the room (0%2 = 2%2 = 0)');
  assert.equal(w('pp-0-1', 'room-0'), 1 / 2, 'split rooms: half each');
  assert.equal(w('pp-0-1', 'room-1'), 1 / 2);
  assert.equal(snap.source_version, 'sp2:64x10x2', 'the unified-model marker (ADR-0028)');
});

test('degenerate params are rejected: a one-ToR fabric has an EMPTY flow space (ADR-0028)', () => {
  // each clause independently (a ||→&& mutant on the guard survived the first draft — caught
  // by the targeted mutation pass and bound here, one violation at a time).
  assert.throws(() => generateSpraypointFabric({ nTors: 1, nPanels: 10, nRooms: 2 }), /nTors≥2/);
  assert.throws(() => generateSpraypointFabric({ nTors: 64, nPanels: 1, nRooms: 1 }), /nPanels≥2/);
  assert.throws(() => generateSpraypointFabric({ nTors: 64, nPanels: 10, nRooms: 0 }), /nRooms≥1/);
});

test('an EMPTY room (nRooms > nPanels) is never traversed — no edge, not a fabricated 1/nRooms', () => {
  const snap = generateSpraypointFabric({ nTors: 4, nPanels: 2, nRooms: 3 }); // room-2 holds no panel
  assert.ok(snap.resources.some((r) => r.id === 'room-2'), 'the room exists as a resource');
  assert.ok(!snap.edges.some((e) => e.resource === 'room-2'), 'but carries zero traffic ⇒ zero edges');
  checkFabricAgainstEnumeration({ nTors: 4, nPanels: 2, nRooms: 3 });
});
