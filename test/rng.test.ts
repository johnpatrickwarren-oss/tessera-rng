import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/rng';

test('rng is deterministic for a given seed', () => {
  const a = makeRng(123);
  const b = makeRng(123);
  for (let i = 0; i < 50; i++) assert.equal(a.next(), b.next());
});

test('rng diverges across seeds', () => {
  const a = makeRng(1);
  const b = makeRng(2);
  let differ = 0;
  for (let i = 0; i < 50; i++) if (a.next() !== b.next()) differ++;
  assert.ok(differ > 40, 'distinct seeds should produce distinct streams');
});

test('next() stays in [0,1); int(n) stays in [0,n)', () => {
  const r = makeRng(7);
  for (let i = 0; i < 1000; i++) {
    const x = r.next();
    assert.ok(x >= 0 && x < 1);
    const k = r.int(5);
    assert.ok(k >= 0 && k < 5 && Number.isInteger(k));
  }
});

test('gaussian has ~zero mean (independent reference: sample mean)', () => {
  const r = makeRng(42);
  let s = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) s += r.gaussian();
  assert.ok(Math.abs(s / N) < 0.05, `sample mean ${s / N} should be near 0`);
});
