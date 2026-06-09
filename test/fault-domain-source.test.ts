import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFabric, DEFAULT_FABRIC } from '../src/fabric';
import { StaticFaultDomainSource, computeFaultDomainHash } from '../src/fault-domain-source';

test('FaultDomainSource mirrors the TopologySource shape and returns the snapshot', async () => {
  const snap = generateFabric(DEFAULT_FABRIC);
  const src = new StaticFaultDomainSource(snap, { id: 'fd-1', version: 'v1' });
  assert.equal(src.id, 'fd-1');
  assert.equal(src.version, 'v1');
  const fetched = await src.fetchSnapshot();
  assert.equal(fetched, snap);
});

test('snapshot hash is deterministic and 64-hex (reuses engine pureJsSha256)', () => {
  const snap = generateFabric(DEFAULT_FABRIC);
  const h1 = computeFaultDomainHash(snap);
  const h2 = computeFaultDomainHash(snap);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('hash is order-invariant over node/edge listing but sensitive to incidence content', () => {
  const snap = generateFabric(DEFAULT_FABRIC);
  // reversing the edge listing must NOT change the canonical hash
  const reversed = { ...snap, edges: [...snap.edges].reverse(), nodes: [...snap.nodes].reverse() };
  assert.equal(computeFaultDomainHash(snap), computeFaultDomainHash(reversed));
  // a genuinely different incidence map MUST change it
  const other = generateFabric({ ...DEFAULT_FABRIC, seed: 999 });
  assert.notEqual(computeFaultDomainHash(snap), computeFaultDomainHash(other));
});
