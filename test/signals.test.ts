import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIGNALS, signalIndex } from '../src/signals';

test('the ratified five-signal contract is present and ordered', () => {
  assert.equal(SIGNALS.length, 5);
  assert.deepEqual([...SIGNALS], ['p99_latency', 'retransmit_rate', 'loss_rate', 'ecmp_imbalance', 'path_completion']);
  assert.equal(signalIndex('p99_latency'), 0);
  assert.equal(signalIndex('path_completion'), 4);
});
