// test/sha256.test.ts — src/sha256.ts against the FIPS 180-4 vectors, and the property
// FaultDomainSource relies on: the same canonical string hashes the same every time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pureJsSha256 } from '../src/sha256.js';

test('sha256: FIPS 180-4 vectors', () => {
  assert.equal(pureJsSha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(pureJsSha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(pureJsSha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

test('sha256: byte-identical to node:crypto across padding boundaries', () => {
  for (const s of ['x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(70), JSON.stringify({ a: 1 }).repeat(30)]) {
    assert.equal(pureJsSha256(s), createHash('sha256').update(s).digest('hex'), `length ${s.length}`);
  }
});
