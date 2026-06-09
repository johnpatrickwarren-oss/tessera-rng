import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSurface } from '../src/surface';
import type { PathClassVerdict } from '../src/verdict';

function v(id: string, e: number): PathClassVerdict {
  return {
    path_class_id: id,
    detectors: [{ family: 'A', e_value: e, fired: e >= 100, alpha_allocated: 0.01, alpha_spent: e >= 100 ? 0.01 : 0 }],
    e_value: e,
    fired: e >= 100,
    alpha_spent: e >= 100 ? 0.01 : 0,
  };
}

test('e-BH selects strong-evidence path-classes and excludes weak ones (FDR surface)', () => {
  // N=5, q=0.05 -> N/q=100. e-BH rejects top-k where e_(k) >= N/(q*k).
  // [300,150,60,1,0.2]: k=1:300>=100, k=2:150>=50, k=3:60>=33.3, k=4:1>=25 X -> K=3.
  const verdicts = [v('pc-a', 300), v('pc-b', 150), v('pc-c', 60), v('pc-d', 1), v('pc-e', 0.2)];
  const s = buildSurface(verdicts, 0.05);
  assert.deepEqual(s.selected_path_class_ids, ['pc-a', 'pc-b', 'pc-c']);
  assert.equal(s.q, 0.05);
});

test('fleet_log_e is the arbitrary-dependence average merge (finite, between min/max log-e)', () => {
  const verdicts = [v('pc-a', 50), v('pc-b', 0.5), v('pc-c', 8)];
  const s = buildSurface(verdicts, 0.05);
  const logs = [Math.log(50), Math.log(0.5), Math.log(8)];
  assert.ok(Number.isFinite(s.fleet_log_e));
  assert.ok(s.fleet_log_e <= Math.max(...logs) && s.fleet_log_e >= Math.min(...logs));
});

test('all-quiet verdict set selects nothing (FDR control under the null)', () => {
  const verdicts = [v('pc-a', 0.9), v('pc-b', 1.1), v('pc-c', 0.7)];
  const s = buildSurface(verdicts, 0.05);
  assert.equal(s.selected_path_class_ids.length, 0);
});
