/**
 * ADR-0052 — shrunk per-leaf scale calibration acceptance bar.
 *
 * Anti-self-confirming (DISCIPLINES §6): absorption is verified OUT-OF-SAMPLE — a fresh window
 * standardized under the corrected substrate — because in-sample the shrinkage zeroes the
 * pooled-ℓ statistic algebraically (cold-eye finding 4; a fresh window is not zeroed by
 * construction). The ς = 0 no-injection bound is on the POPULATION dispersion the correction
 * injects, calibrated so a skip-the-shrinkage mutant (λ = 1) fails it on every seed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { generateTelemetry } from '../src/telemetry';
import { buildCalibration, standardizeAll, standardizeStream, standardizeTick, freshStreamStandardizer } from '../src/calibration';
import { estimateDispersion } from '../src/dispersion-gate';
import { runNullRun } from '../tools/heterogeneity';
import type { PathClassId } from '../src/domain';

const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
const TICKS = 60;
const SEEDS = [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04, 0xb0a05, 0xb0a06, 0xb0a07, 0xb0a08];

function calRaw(seed: number, sigma?: number) {
  return generateTelemetry(SNAP, { seed: seed ^ 0xca11b, ticks: TICKS, ...(sigma ? { heterogeneity: { sigmaLogSd: sigma, driftMix: 0 } } : {}) }).series;
}

// ───────────────────────── AC-1: byte-identity ─────────────────────────

test('AC-1: flag absent ⇒ no leafScale on the substrate and byte-identical standardization', () => {
  const raw = calRaw(7);
  const off = buildCalibration(raw, { robust: true });
  assert.equal(off.leafScale, undefined, 'no flag ⇒ no map');
  const on = buildCalibration(raw, { robust: true, perLeafScale: true });
  assert.ok(on.leafScale, 'flag ⇒ map present');
  // cells/AR identical — the second pass must not perturb the first.
  assert.equal(JSON.stringify({ c: [...off.cells], p: off.pooled, a: off.ar }), JSON.stringify({ c: [...on.cells], p: on.pooled, a: on.ar }), 'first-pass substrate identical under the flag');
});

// ───────────────────────── AC-2: no injection at ς = 0 ─────────────────────────

test('AC-2: at ς = 0 the INJECTED dispersion stays ≈ 0 and null-run false selections stay 0 (kills the λ=1 mutant)', () => {
  for (const seed of SEEDS) {
    const sub = buildCalibration(calRaw(seed), { robust: true, perLeafScale: true });
    // The load-bearing quantity is the POPULATION dispersion the correction injects — sd of
    // log(leafScale) = λ·raw — not any single leaf's value (λ legitimately fluctuates to ~0.3 on
    // seeds where the MAD estimate of raw lands above the floor; individual scales then deviate
    // while the injected dispersion stays ≲ 0.02). The λ = 1 mutant injects the FULL draw noise,
    // sd ≈ 0.04–0.05 — twice this bound.
    const logs = [...sub.leafScale!.values()].map(Math.log);
    const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
    const sd = Math.sqrt(logs.reduce((a, x) => a + (x - mean) ** 2, 0) / (logs.length - 1));
    assert.ok(sd < 0.025, `seed ${seed}: injected log-scale dispersion ${sd.toFixed(4)} must be < 0.025 at ς = 0`);
    assert.equal(runNullRun(SNAP, seed, { perLeafScale: true }).false_selections, 0, `seed ${seed}: clean fabric must still select nothing under the flag`);
  }
});

// ───────────────────────── AC-3: absorption at ς = 0.2 ─────────────────────────

test('AC-3: at ς = 0.2 the correction absorbs the dispersion OUT-OF-SAMPLE — a fresh window standardized under the corrected substrate', () => {
  // The measurement must be out-of-sample (cold-eye finding 4): IN-sample, the shrinkage zeroes
  // the pooled-ℓ statistic ALGEBRAICALLY (corrected ℓ′ = (1−λ)(ℓ−med) exactly), so an in-window
  // estimate is near-tautological. A fresh same-σ window (driftMix 0, different noise seed) is
  // not zeroed by construction — it measures whether the fitted corrections genuinely match the
  // leaves' true scales.
  for (const seed of SEEDS.slice(0, 4)) {
    const sub = buildCalibration(calRaw(seed, 0.2), { robust: true, perLeafScale: true });
    const fresh = generateTelemetry(SNAP, { seed: seed ^ 0x0f5e7, ticks: TICKS, heterogeneity: { sigmaLogSd: 0.2, driftMix: 0 } }).series;
    const est = estimateDispersion(standardizeAll(fresh, sub));
    assert.ok(est.sigma_hat <= 2 * est.sampling_floor_sd, `seed ${seed}: corrected OUT-OF-SAMPLE dispersion ${est.sigma_hat.toFixed(3)} must be ≤ 2×floor ${(2 * est.sampling_floor_sd).toFixed(3)}`);
    const off = estimateDispersion(standardizeAll(fresh, buildCalibration(calRaw(seed, 0.2), { robust: true })));
    assert.ok(off.sigma_hat > 0.1, `seed ${seed}: the OFF path must still see the dispersion (${off.sigma_hat.toFixed(3)}) — else this test measures nothing`);
  }
});

// ───────────────────────── AC-5: envelope honesty + the cross-artifact anchor ─────────────────────────

test('AC-5: OFF rows reproduce the ADR-0050 published cells EXACTLY; the ON ς=0.2 cell recomputes; .md bound to .json', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { renderMarkdown } = require('../tools/per-leaf-scale');
  const shift = JSON.parse(readFileSync(join(__dirname, '..', 'coverage-matrices', 'per-leaf-scale.json'), 'utf8'));
  const boundary = JSON.parse(readFileSync(join(__dirname, '..', 'coverage-matrices', 'heterogeneity-boundary.json'), 'utf8'));

  // cross-artifact anchor: same seeds ⇒ the OFF columns must equal ADR-0050's published cells.
  for (const c of shift.h) {
    const ref = boundary.axes.dispersion.cells.find((b: { intensity: number }) => b.intensity === c.intensity);
    assert.ok(ref, `ADR-0050 must publish the H ς=${c.intensity} cell`);
    assert.equal(c.off_mean_false_selections, ref.mean_false_selections, `H ς=${c.intensity}: OFF row must equal the ADR-0050 cell`);
  }
  for (const c of shift.d) {
    const ref = boundary.axes.drift.cells.find((b: { intensity: number }) => b.intensity === c.intensity);
    assert.ok(ref, `ADR-0050 must publish the D m=${c.intensity} cell`);
    assert.equal(c.off_mean_false_selections, ref.mean_false_selections, `D m=${c.intensity}: OFF row must equal the ADR-0050 cell`);
  }

  // freshness: the headline ON cell (H ς=0.2 — full absorption) recomputes exactly.
  const on = SEEDS.map((s) => runNullRun(SNAP, s, { heterogeneity: { sigmaLogSd: 0.2 }, perLeafScale: true }).false_selections);
  const cell = shift.h.find((c: { intensity: number }) => c.intensity === 0.2);
  assert.equal(cell.on_mean_false_selections, on.reduce((a: number, b: number) => a + b, 0) / on.length, 'published ON mean must recompute exactly');

  // the published D reversal is present as measured (the ADR-0052 falsifiable prediction).
  const d1 = shift.d.find((c: { intensity: number }) => c.intensity === 1);
  assert.ok(d1.on_mean_false_selections > d1.off_mean_false_selections, 'the full-drift ON cell must publish the reversal (worse than OFF) as measured');

  const md = readFileSync(join(__dirname, '..', 'coverage-matrices', 'per-leaf-scale.md'), 'utf8');
  assert.equal(md, renderMarkdown(shift), 'published .md must equal renderMarkdown(published .json)');
});

// ───────────────────────── AC-4: session parity ─────────────────────────

test('AC-4: standardizeTick reproduces standardizeStream byte-for-byte over a perLeafScale substrate', () => {
  const raw = calRaw(11, 0.25);
  const sub = buildCalibration(raw, { robust: true, perLeafScale: true });
  const live = generateTelemetry(SNAP, { seed: 11, ticks: 30, heterogeneity: { sigmaLogSd: 0.25 } });
  let checkedScaled = false;
  for (const pc of [...live.series.keys()].slice(0, 12) as PathClassId[]) {
    const batch = standardizeStream(live.series.get(pc)!, pc, sub);
    const st = freshStreamStandardizer(sub);
    for (let t = 0; t < 30; t++) {
      const inc = standardizeTick(live.series.get(pc)![t], t, pc, sub, st);
      assert.deepEqual(inc, batch[t], `${pc} tick ${t}: incremental must equal batch exactly`);
    }
    if (Math.abs(Math.log(sub.leafScale!.get(pc)!)) > 0.05) checkedScaled = true;
  }
  assert.ok(checkedScaled, 'at least one checked leaf must carry a real (≠1) correction — else the parity check never exercises the division');
});
