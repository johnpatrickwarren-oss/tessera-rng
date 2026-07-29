/**
 * ADR-0063 → ADR-0065 — the δ=32 e-value overflow defect, FIXED (the tripwire flipped).
 *
 * This test originally pinned the KNOWN DEFECT (engine linear wealth at δ=32 — inside the
 * claimed cross-kind band δ ∈ {3..32}, ADR-0046 — overflowed per-leaf e-values to Infinity,
 * which JSON-serializes to null in audits). Its assertions were written to FLIP when the fix
 * landed; engine ADR 0026 (log-domain wealth, v0.6.5-pre) landed it, and ADR-0065 adopted it.
 * The test now pins the FIXED behavior and flips back on any regression:
 *   - per-leaf e-values are FINITE (the Number.MAX_VALUE-saturating view, never Infinity);
 *   - JSON round-trips carry no null anywhere in the audit;
 *   - selection still fires (it always did — the defect was representational);
 *   - log_e_value carries the EXACT magnitudes: finite, huge, and strictly ordered where the
 *     linear view ties at saturation (the record the fix was for).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { runPipeline } from '../src/pipeline';

test('FIXED (ADR-0065, was ADR-0063 KNOWN DEFECT): δ=32 per-leaf e-values are finite, JSON-safe, and exactly recorded in the log domain', async () => {
  const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
  // the original defect pin used a single optic-3 δ=32 degradation; a second δ=32 fault is
  // added so MULTIPLE leaves saturate — the ordering claim below needs at least two.
  const audit = await runPipeline({
    snapshot: SNAP,
    q: 0.05,
    telemetry: { seed: 5, ticks: 60, degradations: [
      { resource_id: 'optic-3', delta: 32, start_tick: 0 },
      { resource_id: 'panel-7', delta: 32, start_tick: 0 },
    ] },
  });
  const maxE = Math.max(...audit.verdicts.map((v) => v.e_value));
  assert.equal(Number.isFinite(maxE), true, 'the fix: per-leaf e-values stay finite inside the claimed band');
  assert.ok(maxE > 1e300, 'and the extreme leaves genuinely reached the saturating view (the defect regime was exercised)');
  const roundTripped = JSON.parse(JSON.stringify(audit));
  assert.equal(
    roundTripped.verdicts.some((v: { e_value: number | null; log_e_value?: number | null }) => v.e_value === null || v.log_e_value === null),
    false,
    'no consumer-visible null anywhere: the JSON corruption class is closed',
  );
  assert.ok(audit.selected_path_class_ids.length > 0, 'selection fires, as it did even under the defect');
  // The exact record: saturated leaves tie in the linear view but their log_e_value is finite,
  // beyond the linear range, and NOT all equal — the true ordering survives.
  const saturated = audit.verdicts.filter((v) => v.e_value > 1e300);
  assert.ok(saturated.length >= 2, `enough saturated leaves to exercise ordering (got ${saturated.length})`);
  for (const v of saturated) {
    assert.ok(Number.isFinite(v.log_e_value!), 'exact log record is finite');
    assert.ok(v.log_e_value! > Math.log(1e300), 'and beyond the linear range');
  }
  const distinctLogs = new Set(saturated.map((v) => v.log_e_value)).size;
  assert.ok(distinctLogs > 1, 'the exact records are strictly ordered where the linear view ties');
  // log/linear coherence in range (AC-3): the two are the same quantity in two domains.
  for (const v of audit.verdicts) {
    if (v.e_value < 1e300 && v.e_value > 1e-300) {
      assert.ok(Math.abs(Math.log(v.e_value) - v.log_e_value!) <= 1e-9 * Math.max(1, Math.abs(v.log_e_value!)),
        `log/linear coherence for ${v.path_class_id}`);
    }
  }
});

test('cold-eye 0065 finding 1: the LINEAR MEANS saturate too — a long-session hard fault cannot overflow the combined e-value to Infinity → JSON null', async () => {
  // The engine saturates each STATE's view; the RNG-side means SUM those views, and
  // MAX + MAX/K = Infinity. Reproduce the reviewer's scenario at the detect layer: a series
  // long and hot enough that Family A per-signal wealth saturates alongside Family C
  // (betting growth ≤ ln2/tick ⇒ ~1100 ticks; C saturates in a handful).
  const { detectPathClass, saturateE, detectorLogE } = await import('../src/detect');
  const p = (await import('../src/signals')).SIGNALS.length;
  const series = Array.from({ length: 3000 }, () => new Array(p).fill(50));
  const v = detectPathClass('pc-hot' as never, series);
  for (const dt of v.detectors) assert.ok(Number.isFinite(dt.e_value), `${dt.family} view finite`);
  assert.equal(v.e_value, Number.MAX_VALUE, 'the combined mean saturates instead of overflowing');
  assert.ok(Number.isFinite(v.log_e_value!) && v.log_e_value! > 709, 'while the exact record keeps the true magnitude');
  assert.equal(JSON.parse(JSON.stringify(v)).e_value, Number.MAX_VALUE, 'JSON-safe');
  // the helper itself (mutant bind: dropping the cap fails here and above):
  assert.equal(saturateE(Infinity), Number.MAX_VALUE);
  assert.equal(saturateE(123.5), 123.5, 'identity in range — bytes preserved');
  // detectorLogE healing (cold-eye finding 3): a DEFECT-ERA null row heals to the saturation
  // point, never to the floor via null-coercion; live shapes heal as documented.
  assert.equal(detectorLogE({ e_value: null }), Math.log(Number.MAX_VALUE), 'pre-0065 serialized-Infinity row');
  assert.equal(detectorLogE({ e_value: Infinity }), Math.log(Number.MAX_VALUE), 'in-memory defect-era Infinity');
  assert.equal(detectorLogE({ e_value: 0 }), Math.log(1e-300), 'non-positive heals to the floor');
  assert.equal(detectorLogE({ e_value: 7, log_e_value: 1.5 }), 1.5, 'present log always wins');
});
