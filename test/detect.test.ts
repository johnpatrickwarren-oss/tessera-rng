import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/rng';
import { detectPathClass } from '../src/detect';
import { SIGNALS, signalIndex } from '../src/signals';

// Build a synthetic residual matrix (ticks × |SIGNALS|) with an optional p99 shift.
function series(seed: number, ticks: number, delta: number): number[][] {
  const r = makeRng(seed);
  const p99 = signalIndex('p99_latency');
  const out: number[][] = [];
  for (let t = 0; t < ticks; t++) {
    const v = SIGNALS.map(() => r.gaussian());
    v[p99] += delta;
    out.push(v);
  }
  return out;
}

const P = { alphaA: 0.01, alphaC: 0.01 };

function family(v: ReturnType<typeof detectPathClass>, f: 'A' | 'C' | 'D') {
  return v.detectors.find((d) => d.family === f)!;
}

test('both Family A and Family C fire on a sustained shift; each α-budget is recorded', () => {
  const v = detectPathClass('pc-x', series(11, 120, 2.5), P);
  assert.equal(v.detectors.length, 2);
  const a = family(v, 'A');
  const c = family(v, 'C');
  assert.ok(a.fired, `Family A e-value ${a.e_value} should cross threshold`);
  assert.ok(c.fired, `Family C e-value ${c.e_value} should cross threshold`);
  assert.equal(a.alpha_allocated, 0.01);
  assert.equal(c.alpha_allocated, 0.01);
  // spent-on-fire: a fired detector books exactly its allocation; both fired here.
  assert.equal(a.alpha_spent, 0.01);
  assert.equal(c.alpha_spent, 0.01);
  assert.ok(v.fired);
  assert.equal(v.alpha_spent, a.alpha_spent + c.alpha_spent);
});

test('a Family D context adds a third detector and averages its e-value into the verdict (ADR-0009)', () => {
  // a neutral (disabled) Family D context: D contributes a no-op e-value of 1 but IS recorded.
  const disabledD = SIGNALS.map(() => null);
  const shifted = detectPathClass('pc-s', series(11, 120, 2.5), P, { familyDCells: disabledD });
  assert.equal(shifted.detectors.length, 3, 'A + C + D recorded when a D context is supplied');
  const d = family(shifted, 'D');
  assert.equal(d.e_value, 1);
  assert.equal(d.fired, false);
  // combined e-value is the mean over all three present detectors.
  const mean = shifted.detectors.reduce((s, dt) => s + dt.e_value, 0) / 3;
  assert.ok(Math.abs(shifted.e_value - mean) < 1e-9, 'verdict e-value averages all present detectors');
  // without a D context the verdict is A+C only (backward-compatible).
  assert.equal(detectPathClass('pc-s', series(11, 120, 2.5), P).detectors.length, 2);
});

test('neither family fires on a clean stream; NO α is spent (not just "fired=false")', () => {
  const clean = detectPathClass('pc-c', series(11, 120, 0), P);
  const shifted = detectPathClass('pc-s', series(11, 120, 2.5), P);
  assert.ok(!clean.fired, `clean combined e-value ${clean.e_value} should stay below threshold`);
  assert.ok(!family(clean, 'A').fired && !family(clean, 'C').fired);
  // the accounting bug guard: a non-firing detector must book ZERO spend (kills the
  // "cumulative per-tick allocation" mis-report, which would be 1.2 here for Family A).
  assert.equal(family(clean, 'A').alpha_spent, 0);
  assert.equal(family(clean, 'C').alpha_spent, 0);
  assert.equal(clean.alpha_spent, 0);
  assert.ok(shifted.e_value > clean.e_value * 10, 'a real shift must dominate the null stream');
});

test('Family A now catches a mean shift on a NON-p99 signal (multi-signal, ADR-0003)', () => {
  const r = makeRng(21);
  const loss = signalIndex('loss_rate');
  const ticks = 150;
  const s: number[][] = [];
  for (let t = 0; t < ticks; t++) {
    const v = SIGNALS.map(() => r.gaussian());
    v[loss] += 3; // mean shift on loss_rate only
    s.push(v);
  }
  const v = detectPathClass('pc-loss', s, P);
  assert.ok(family(v, 'A').fired, 'Family A must fire on a loss_rate mean shift, not only p99');
});

test('Family C (distributional) fires on a variance shift Family A can miss', () => {
  // Inflate variance on a non-p99 signal: A (watching p99 mean) stays quiet, C should fire.
  const r = makeRng(5);
  const loss = signalIndex('loss_rate');
  const ticks = 150;
  const s: number[][] = [];
  for (let t = 0; t < ticks; t++) {
    const v = SIGNALS.map(() => r.gaussian());
    v[loss] *= 4; // variance inflation on loss_rate only
    s.push(v);
  }
  const v = detectPathClass('pc-var', s, P);
  assert.ok(!family(v, 'A').fired, 'Family A (p99 mean) should not fire on a loss_rate variance shift');
  assert.ok(family(v, 'C').fired, 'Family C should catch the distributional change');
  // the path-class verdict fires if EITHER family fires (kills the ||->&& mutant)
  assert.ok(v.fired, 'verdict fires when any single family fires');
});

// ── Segmented (epoch-aware) detection: the recorded wealth reset (ADR-0018) ─────

test('segmented detection: fresh wealth per segment, MEAN combine, summed α, argmax evidence epoch (ADR-0018)', async () => {
  const { detectPathClassSegmented } = await import('../src/detect');
  // shifted first half, clean second half — the fault "ends" at the boundary (e.g. rerouted away).
  const full = [...series(11, 30, 3.0).slice(0, 15), ...series(12, 15, 0)];
  const segs = [
    { epoch_index: 0, from_tick: 0, to_tick: 15 },
    { epoch_index: 1, from_tick: 15, to_tick: 30 },
  ];
  const v = detectPathClassSegmented('pc-x', full, segs, P);

  // cross-validate against independently sliced runs (the naive two-pass reference).
  const s0 = detectPathClass('pc-x', full.slice(0, 15), P);
  const s1 = detectPathClass('pc-x', full.slice(15, 30), P);
  assert.equal(v.segments!.length, 2);
  assert.equal(v.segments![0].e_value, s0.e_value);
  assert.equal(v.segments![1].e_value, s1.e_value);
  assert.equal(v.e_value, (s0.e_value + s1.e_value) / 2, 'leaf e-value is the MEAN over segments (valid under dependence)');
  assert.equal(family(v, 'A').alpha_spent, family(s0, 'A').alpha_spent + family(s1, 'A').alpha_spent, 'α spent sums over segment runs');
  assert.equal(v.evidence_epoch, 0, 'the evidence accrued in the shifted (first) segment');

  // the RESET is real: an unsegmented run carries the first half's wealth to the end; the second
  // segment starts FRESH and stays small on clean ticks. Deleting the reset (running the full
  // series) would make the second segment's e-value as large as the carried wealth.
  const carried = detectPathClass('pc-x', full, P);
  assert.ok(v.segments![0].fired, 'the shifted segment fires');
  assert.ok(!v.segments![1].fired, 'the clean post-reset segment does not fire on fresh wealth');
  assert.ok(v.segments![1].e_value < carried.e_value / 100, 'post-reset wealth is fresh, not carried');
});
