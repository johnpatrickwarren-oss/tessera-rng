// ADR-0067: e-BY effect-size intervals on the surface from the per-signal residual sums.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSurface } from '../src/surface';
import { detectPathClass, detectPathClassSegmented, CS_SIGMA_SQUARED_PRIOR, DEFAULT_DETECT } from '../src/detect';
import { SIGNALS } from '../src/signals';
import { runPipeline } from '../src/pipeline';
import type { PathClassVerdict } from '../src/verdict';
import { mixtureConfidenceSequenceAt } from '@johnpatrickwarren-oss/deploysignal-engine/detectors/mixture-confidence-sequence';

const vec = (x: number) => SIGNALS.map((_, i) => x * (i === 0 ? 1 : 0.1));
const series = (n: number, x: number) => Array.from({ length: n }, () => vec(x));

test('ADR-0067: a Family A row carries effect_cs = the per-signal residual sum and count of the series', () => {
  const v = detectPathClass('pc-1' as any, series(40, 0.3));
  const a = v.detectors.find((d) => d.family === 'A')!;
  assert.ok(a.effect_cs && a.effect_cs.length === SIGNALS.length);
  assert.equal(a.effect_cs![0].signal, 'p99_latency');
  assert.ok(Math.abs(a.effect_cs![0].S_t - 40 * 0.3) < 1e-12);
  assert.equal(a.effect_cs![0].t, 40);
  assert.ok(!v.detectors.find((d) => d.family === 'C')!.effect_cs);
});

test('ADR-0067: a segmented leaf carries the LAST segment\'s effect_cs', () => {
  const s = [...series(30, 0), ...series(20, 0.5)];
  const v = detectPathClassSegmented('pc-2' as any, s, [{ epoch_index: 0, from_tick: 0, to_tick: 30 }, { epoch_index: 1, from_tick: 30, to_tick: 50 }]);
  const a = v.detectors.find((d) => d.family === 'A')!;
  assert.equal(a.effect_cs![0].t, 20);
  assert.ok(Math.abs(a.effect_cs![0].S_t - 10) < 1e-12);
});

test('ADR-0067: the surface reports e-BY intervals at delta·|S|/|leaves| that equal the closed form; absent when any leaf lacks effect_cs', () => {
  const quiet = Array.from({ length: 9 }, (_, i) => detectPathClass(`pc-${i}` as any, series(60, 0.02)));
  const loud = detectPathClass('pc-9' as any, series(60, 1.5));
  const verdicts = [...quiet, loud];
  const surf = buildSurface(verdicts, 0.05, 0.1);
  assert.deepEqual(surf.selected_path_class_ids, ['pc-9']);
  const ei = surf.effect_intervals!;
  assert.equal(ei.K, 10 * SIGNALS.length); assert.equal(ei.selected, SIGNALS.length); assert.equal(ei.delta, 0.1);
  assert.ok(Math.abs(ei.alpha_i - 0.1 * 1 / 10) < 1e-15);
  assert.equal(ei.intervals.length, SIGNALS.length);
  const cs = loud.detectors.find((d) => d.family === 'A')!.effect_cs!;
  for (const [k, iv] of ei.intervals.entries()) {
    const ref = mixtureConfidenceSequenceAt({ S_t: cs[k].S_t, t: cs[k].t, sigma_squared: 1, sigma_squared_prior: CS_SIGMA_SQUARED_PRIOR }, ei.alpha_i);
    assert.equal(iv.path_class_id, 'pc-9'); assert.equal(iv.signal, SIGNALS[k]);
    assert.ok(Math.abs(iv.half_width - ref.half_width) < 1e-12 && Math.abs(iv.center - ref.center) < 1e-12);
  }
  assert.ok(ei.intervals[0].lower > 0, 'the loud p99_latency interval excludes 0');
  assert.ok(ei.intervals[1].lower < 0 && ei.intervals[1].upper > 0, 'a barely-shifted signal covers 0');
  // default delta = q
  assert.equal(buildSurface(verdicts, 0.05).effect_intervals!.delta, 0.05);
  // a pre-0067 verdict set (no effect_cs) → no field, everything else unchanged
  const stripped: PathClassVerdict[] = verdicts.map((v) => ({ ...v, detectors: v.detectors.map(({ effect_cs: _e, ...d }) => d) }));
  const old = buildSurface(stripped, 0.05);
  assert.ok(!('effect_intervals' in old));
  const { effect_intervals: _x, ...rest } = surf;
  assert.deepEqual(JSON.parse(JSON.stringify(rest)), JSON.parse(JSON.stringify(old)));
  // nothing selected → empty intervals, alpha_i 0
  const none = buildSurface(quiet, 0.05);
  assert.equal(none.effect_intervals!.intervals.length, 0); assert.equal(none.effect_intervals!.alpha_i, 0);
});

test('ADR-0067: the batch audit carries effect_intervals for the selected leaves, at fcrDelta when given', async () => {
  const FABRIC = { seed: 0x7e55e4a, n_path_classes: 200, n_optics: 48, n_shufflers: 12, n_bundles: 18, n_power_zones: 4, n_cooling_zones: 4 };
  const rec = await runPipeline({ fabric: FABRIC, telemetry: { seed: 3, ticks: 80, degradation: { resource_id: 'optic-3', delta: 6, start_tick: 0 } }, q: 0.05, fcrDelta: 0.1 });
  assert.ok(rec.effect_intervals, 'audit should carry effect_intervals');
  assert.equal(rec.effect_intervals!.delta, 0.1);
  assert.equal(rec.effect_intervals!.intervals.length, rec.selected_path_class_ids.length * SIGNALS.length);
  const rec2 = await runPipeline({ fabric: FABRIC, telemetry: { seed: 3, ticks: 80 }, q: 0.05 });
  assert.equal(rec2.effect_intervals!.delta, 0.05);
});
