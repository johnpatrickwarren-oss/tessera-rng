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

test('the surface emits the floored fleet base rate q₀ = (|selected|+½)/(|leaves|+1) (ADR-0016)', () => {
  // literal expectations, not the formula re-derived: 3 of 5 selected → 3.5/6; 0 of 3 → 0.5/4.
  const firing = buildSurface([v('pc-a', 300), v('pc-b', 150), v('pc-c', 60), v('pc-d', 1), v('pc-e', 0.2)], 0.05);
  assert.equal(firing.base_rate_q0, 3.5 / 6);
  const quiet = buildSurface([v('pc-a', 0.9), v('pc-b', 1.1), v('pc-c', 0.7)], 0.05);
  assert.equal(quiet.base_rate_q0, 0.5 / 4);
  assert.ok(quiet.base_rate_q0 > 0 && quiet.base_rate_q0 < 1, 'floored: never 0 even on an all-quiet fleet');
});

// ---- ADR-0066: e-BH log_threshold_e + per-leaf log_margin (engine ADR 0027) ----

/** −log(Number.MAX_VALUE): the engine's LOG_MAX_WEALTH floor on a zero e-value's margin. */
const MARGIN_FLOOR = -Math.log(Number.MAX_VALUE);

/** a verdict carrying the ADR-0065 exact log record alongside its linear view. */
function vLog(id: string, logE: number): PathClassVerdict {
  const e = Math.min(Number.MAX_VALUE, Math.exp(logE));
  return { ...v(id, e), log_e_value: logE };
}

/** margin sign ⇒ selection set, and the threshold formula, on one surface. */
function assertMarginsReproduceSelection(s: ReturnType<typeof buildSurface>, n: number, label: string): void {
  const bySign = s.margins.filter((m) => m.log_margin >= 0).map((m) => m.path_class_id).sort();
  assert.deepEqual(bySign, s.selected_path_class_ids, `${label}: margin ≥ 0 must reproduce the selected set exactly`);
  assert.equal(s.margins.length, n, `${label}: one margin per verdict`);
  const K = s.selected_path_class_ids.length;
  const expected = Math.log(n / (s.q * Math.max(K, 1)));
  assert.ok(Math.abs(s.log_threshold_e - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), `${label}: log_threshold_e = log(N/(q·max(K,1))) (got ${s.log_threshold_e}, expected ${expected})`);
}

test('ADR-0066 (a): margin sign reproduces selected_path_class_ids on the existing fixtures (linear and log variants)', () => {
  const linear = [v('pc-a', 300), v('pc-b', 150), v('pc-c', 60), v('pc-d', 1), v('pc-e', 0.2)];
  assertMarginsReproduceSelection(buildSurface(linear, 0.05), 5, 'firing/linear');
  assertMarginsReproduceSelection(buildSurface([v('pc-a', 0.9), v('pc-b', 1.1), v('pc-c', 0.7)], 0.05), 3, 'quiet/linear');
  // margins are in canonical id order, aligned with the audit's verdicts array.
  const s = buildSurface([v('pc-e', 0.2), v('pc-a', 300), v('pc-c', 60)], 0.05);
  assert.deepEqual(s.margins.map((m) => m.path_class_id), ['pc-a', 'pc-c', 'pc-e']);
  // the same fixture with the exact log record takes the log variant and selects identically.
  const log = linear.map((x) => ({ ...x, log_e_value: Math.log(x.e_value) }));
  const sl = buildSurface(log, 0.05);
  assert.deepEqual(sl.selected_path_class_ids, ['pc-a', 'pc-b', 'pc-c']);
  assertMarginsReproduceSelection(sl, 5, 'firing/log');
});

test('ADR-0066 (a): margin sign reproduces the selection on random snapshots — 200 linear, 200 log-domain', () => {
  let x = 0x2f6e2b1;
  const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let trial = 0; trial < 200; trial++) {
    const n = 1 + Math.floor(rnd() * 40);
    const q = 0.01 + rnd() * 0.3;
    // log-uniform on [1e-3, 1e4], with a few exact ties and a zero to hit the boundaries.
    const logs = Array.from({ length: n }, () => -3 * Math.LN10 + rnd() * 7 * Math.LN10);
    if (n > 2 && rnd() < 0.3) logs[1] = logs[0];
    if (rnd() < 0.2) logs[n - 1] = -Infinity;
    const lin = logs.map((l, i) => v(`pc-${String(i).padStart(3, '0')}`, Math.exp(l)));
    assertMarginsReproduceSelection(buildSurface(lin, q), n, `trial ${trial} linear`);
    const lg = logs.map((l, i) => vLog(`pc-${String(i).padStart(3, '0')}`, l));
    assertMarginsReproduceSelection(buildSurface(lg, q), n, `trial ${trial} log`);
  }
});

test('ADR-0066 (b): log_threshold_e = log(N/(q·max(K,1))) — K=0 gives log(N/q), K>0 divides by K', () => {
  const quiet = buildSurface([v('pc-a', 0.9), v('pc-b', 1.1), v('pc-c', 0.7)], 0.05);
  assert.equal(quiet.selected_path_class_ids.length, 0);
  assert.ok(Math.abs(quiet.log_threshold_e - Math.log(3 / 0.05)) < 1e-12, 'K=0: the value the largest e-value would have needed');
  const firing = buildSurface([v('pc-a', 300), v('pc-b', 150), v('pc-c', 60), v('pc-d', 1), v('pc-e', 0.2)], 0.05);
  assert.equal(firing.selected_path_class_ids.length, 3);
  assert.ok(Math.abs(firing.log_threshold_e - Math.log(5 / (0.05 * 3))) < 1e-12, 'K=3: log(N/(qK)) = log(33.3…)');
  // the threshold separates exactly: pc-c (60 ≥ 33.3) is in, pc-d (1) is out.
  const m = new Map(firing.margins.map((r) => [r.path_class_id, r.log_margin]));
  assert.ok(m.get('pc-c')! >= 0 && m.get('pc-d')! < 0);
});

test('ADR-0066 (c): the surface JSON round-trips with no null and no Infinity, including saturated and zero leaves', () => {
  const verdicts = [
    vLog('pc-sat-1', 5000), // beyond the linear range: e_value saturates at MAX_VALUE, log record exact
    vLog('pc-sat-2', 4000),
    vLog('pc-mid', 3),
    vLog('pc-zero', -Infinity), // a zero e-value
  ];
  const s = buildSurface(verdicts, 0.05);
  const text = JSON.stringify(s);
  assert.ok(!/null/.test(text), `no null in the serialized surface: ${text}`);
  const back = JSON.parse(text) as typeof s;
  assert.ok(Number.isFinite(back.log_threshold_e));
  for (const m of back.margins) assert.ok(Number.isFinite(m.log_margin), `finite margin for ${m.path_class_id}`);
  assert.ok(Number.isFinite(back.fleet_log_e));
  // the log variant keeps the saturated leaves' ordering in their margins (the reason for the variant).
  const mm = new Map(s.margins.map((r) => [r.path_class_id, r.log_margin]));
  assert.ok(mm.get('pc-sat-1')! > mm.get('pc-sat-2')!, 'saturated leaves are strictly ordered by their exact log record');
});

test('ADR-0066 (d): a zero e-value gets the floored margin −log(Number.MAX_VALUE), never −Infinity — both variants', () => {
  const lin = buildSurface([v('pc-a', 300), v('pc-zero', 0)], 0.05);
  const ml = lin.margins.find((m) => m.path_class_id === 'pc-zero')!.log_margin;
  assert.equal(ml, MARGIN_FLOOR);
  assert.ok(Number.isFinite(ml) && ml < 0);
  const log = buildSurface([vLog('pc-a', Math.log(300)), vLog('pc-zero', -Infinity)], 0.05);
  const mg = log.margins.find((m) => m.path_class_id === 'pc-zero')!.log_margin;
  assert.equal(mg, MARGIN_FLOOR);
  assert.deepEqual(lin.selected_path_class_ids, log.selected_path_class_ids);
});

test('ADR-0066: a verdict set that lacks log_e_value ANYWHERE takes the linear procedure whole — variants are never mixed', () => {
  // one leaf without the exact record: the call must still succeed and select by the linear view.
  const mixed = [vLog('pc-a', Math.log(300)), v('pc-b', 150), vLog('pc-c', Math.log(60)), v('pc-d', 1), v('pc-e', 0.2)];
  const s = buildSurface(mixed, 0.05);
  assert.deepEqual(s.selected_path_class_ids, ['pc-a', 'pc-b', 'pc-c']);
  assertMarginsReproduceSelection(s, 5, 'mixed→linear');
});
