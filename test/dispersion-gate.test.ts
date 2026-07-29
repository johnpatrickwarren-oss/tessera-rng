/**
 * ADR-0051 — ς̂ dispersion gate acceptance bar.
 *
 * Anti-self-confirming (DISCIPLINES §6): the estimator is validated against the INDEPENDENT
 * sd-ratio realized-ς measurement (the ADR-0050 estimator), never against its own internals;
 * the debias is bound at ς = 0 with a tolerance a skip-the-subtraction mutant cannot meet
 * (raw ≈ the 0.041 sampling floor > the 0.025 bound); the gate ROC is bound at both ends so a
 * constant-pass or constant-fail mutant dies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { generateTelemetry } from '../src/telemetry';
import { buildCalibration, standardizeAll } from '../src/calibration';
import { estimateDispersion, dispersionGate, DEFAULT_SIGMA_THRESHOLD } from '../src/dispersion-gate';
import { runPipeline, calibrateForSession, assembleAudit } from '../src/pipeline';
import { detectAll, DEFAULT_DETECT } from '../src/detect';
import { buildSurface } from '../src/surface';
import { openSession } from '../src/session';
import { realizedDispersion } from '../tools/heterogeneity';
import type { HeterogeneitySpec } from '../src/telemetry';
import type { PathClassId } from '../src/domain';

const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
const TICKS = 60;
const SEEDS = [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04, 0xb0a05, 0xb0a06, 0xb0a07, 0xb0a08];

/** The production calibration composition (calibrateForSession's path) under a ς spec. */
function calibResidualsUnder(seed: number, het?: HeterogeneitySpec): Map<PathClassId, number[][]> {
  const raw = generateTelemetry(SNAP, { seed: seed ^ 0xca11b, ticks: TICKS, ...(het ? { heterogeneity: { ...het, driftMix: 0 } } : {}) });
  return standardizeAll(raw.series, buildCalibration(raw.series, { robust: true }));
}

// ───────────────────────── AC-2: estimator honesty ─────────────────────────

test('AC-2: at ς = 0 the debiased ς̂ sits below half the threshold on every seed (kills the debias no-op mutant)', () => {
  for (const seed of SEEDS) {
    const est = estimateDispersion(calibResidualsUnder(seed));
    assert.ok(est.sigma_hat < DEFAULT_SIGMA_THRESHOLD / 2, `seed ${seed}: ς̂ ${est.sigma_hat.toFixed(4)} must be < ${DEFAULT_SIGMA_THRESHOLD / 2} at ς = 0`);
    // the tail statistic's ς=0 noise is larger (plain sd, no MAD averaging) but must stay under
    // the threshold so clean fleets PASS the pair gate.
    assert.ok(est.sigma_hat_tail < DEFAULT_SIGMA_THRESHOLD, `seed ${seed}: tail ς̂ ${est.sigma_hat_tail.toFixed(4)} must stay below the threshold at ς = 0`);
    // the floor itself must be published and match the operating point: √(1/(2·59·5)) ≈ 0.041 —
    // a skip-the-debias mutant returns raw_log_sd ≈ this floor and fails the bound above.
    assert.ok(Math.abs(est.sampling_floor_sd - Math.sqrt(1 / (2 * (TICKS - 1) * 5))) < 1e-12, 'published sampling floor must match 1/(2(T−1)p)');
  }
});

test('AC-2b: a tail-contaminated fleet (10% of leaves at 2× scale) FAILS the gate even though the robust core sits still (the cold-eye finding-1 kill-test)', () => {
  for (const seed of SEEDS.slice(0, 4)) {
    const clean = calibResidualsUnder(seed);
    const contaminated = new Map<PathClassId, number[][]>();
    const leaves = [...clean.keys()];
    const hot = new Set(leaves.filter((_, i) => i % 10 === 0)); // ~10% of the fleet
    for (const pc of leaves) {
      const m = clean.get(pc)!;
      contaminated.set(pc, hot.has(pc) ? m.map((row) => row.map((x) => 2 * x)) : m);
    }
    const est = estimateDispersion(contaminated);
    // the demonstrated blindness: the MAD core barely moves while the tail statistic sees the
    // subpopulation — a robust-only gate (the pre-correction design) passes this fleet while
    // e-BH false-selects exactly the hot leaves.
    assert.ok(est.sigma_hat < DEFAULT_SIGMA_THRESHOLD, `seed ${seed}: the ROBUST statistic alone (${est.sigma_hat.toFixed(3)}) would have PASSED — that is the laundering this test pins`);
    assert.ok(est.sigma_hat_tail > 2 * DEFAULT_SIGMA_THRESHOLD, `seed ${seed}: the tail statistic (${est.sigma_hat_tail.toFixed(3)}) must see the subpopulation`);
    assert.equal(dispersionGate(est).passing, false, `seed ${seed}: the PAIR gate must fail a tail-contaminated fleet`);
  }
});

test('AC-2: ς̂ recovers the REALIZED ς (independent sd-ratio cross-check) at ς ∈ {0.1, 0.2, 0.3}', () => {
  for (const nominal of [0.1, 0.2, 0.3]) {
    const realized = realizedDispersion(SNAP, { sigmaLogSd: nominal });
    const estimates = SEEDS.map((s) => estimateDispersion(calibResidualsUnder(s, { sigmaLogSd: nominal })).sigma_hat);
    const mean = estimates.reduce((a, b) => a + b, 0) / estimates.length;
    // tolerance: ±25% relative or ±0.03 absolute, whichever is looser — the estimator sees ONE
    // 60-tick window per seed where the reference sees a 240-tick same-seed ratio.
    const tol = Math.max(0.25 * realized, 0.03);
    assert.ok(Math.abs(mean - realized) < tol, `nominal ς ${nominal}: mean ς̂ ${mean.toFixed(3)} must be within ${tol.toFixed(3)} of realized ${realized.toFixed(3)}`);
  }
});

test('AC-2: degenerate inputs throw', () => {
  assert.throws(() => estimateDispersion(new Map([['one', [[1, 2]]]])), /needs ≥ 2 leaves/);
  assert.throws(() => estimateDispersion(new Map([['a', [[1]]], ['b', [[1]]]])), /degenerate residual matrix/);
  const m = (T: number) => Array.from({ length: T }, () => [1, 2, 3]);
  assert.throws(() => estimateDispersion(new Map([['a', m(10)], ['b', m(8)]])), /ragged residual map/);
  assert.throws(() => dispersionGate(estimateDispersion(calibResidualsUnder(1)), 0), /threshold must be/);
});

// ───────────────────────── AC-3: gate ROC endpoints ─────────────────────────

test('AC-3: the gate PASSES at ς = 0 and FAILS at ς = 0.3 on every seed (kills constant-verdict mutants)', () => {
  for (const seed of SEEDS) {
    assert.equal(dispersionGate(estimateDispersion(calibResidualsUnder(seed))).passing, true, `seed ${seed}: clean fabric must pass`);
    const fail = dispersionGate(estimateDispersion(calibResidualsUnder(seed, { sigmaLogSd: 0.3 })));
    assert.equal(fail.passing, false, `seed ${seed}: ς = 0.3 must fail`);
    assert.ok(fail.margin < 0, 'a failing gate publishes a negative margin');
  }
});

// ───────────────────────── AC-1: byte-identity ─────────────────────────

test('AC-1: opting in adds ONLY the dispersion_gate field; opting out is byte-identical', async () => {
  const base = { snapshot: SNAP, q: 0.05, telemetry: { seed: 7, ticks: 40 } };
  const off = await runPipeline(base);
  const on = await runPipeline({ ...base, dispersionGate: true });
  assert.ok(on.dispersion_gate, 'opted-in audit must carry the field');
  assert.equal(on.dispersion_gate!.passing, true, 'clean synthetic calibration must pass');
  const { dispersion_gate: _gate, ...rest } = on;
  assert.equal(JSON.stringify(rest), JSON.stringify(off), 'everything except the field must be byte-identical');
  assert.equal('dispersion_gate' in off, false, 'opted-out audit must not carry the field');
});

// ───────────────────────── AC-4: claim-not-alarm semantics ─────────────────────────

test('AC-4: a FAILING gate leaves the selection set untouched — the claim is withheld, the alarm survives', () => {
  // composed run at ς = 0.3 (the pipeline cannot inject ς itself — ADR-0050 anti-scope), mirroring
  // the boundary tool: calibrate under dispersion, detect the live window, gate from the SAME
  // calibration residuals.
  const seed = 0xb0a03;
  const het = { sigmaLogSd: 0.3 };
  const calibRaw = generateTelemetry(SNAP, { seed: seed ^ 0xca11b, ticks: TICKS, heterogeneity: { ...het, driftMix: 0 } });
  const calibration = buildCalibration(calibRaw.series, { robust: true });
  const calibResiduals = standardizeAll(calibRaw.series, calibration);
  const est = estimateDispersion(calibResiduals);
  const verdictGate = dispersionGate(est);
  assert.equal(verdictGate.passing, false, 'precondition: the gate must fail at ς = 0.3');

  const { estimateBaselineCovariance, makeFamilyCCellFromCovariance } = require('../src/family-c');
  const { estimateFamilyDNull } = require('../src/family-d');
  const ctx = {
    familyCCell: makeFamilyCCellFromCovariance(estimateBaselineCovariance(calibResiduals).sigma, DEFAULT_DETECT.alphaC),
    familyDCells: estimateFamilyDNull(calibResiduals),
  };
  const live = generateTelemetry(SNAP, { seed, ticks: TICKS, heterogeneity: het });
  const verdicts = detectAll(standardizeAll(live.series, calibration), DEFAULT_DETECT, ctx);
  const surface = buildSurface(verdicts, 0.05);
  assert.ok(surface.selected_path_class_ids.length > 0, 'precondition: dispersion must be false-selecting here (ADR-0050)');

  const gateField = { ...verdictGate, raw_log_sd: est.raw_log_sd, raw_log_sd_tail: est.raw_log_sd_tail, sampling_floor_sd: est.sampling_floor_sd, n_leaves: est.n_leaves, ticks: est.ticks, signals: est.signals };
  const args = { snapshot: SNAP, snapshot_hash: 'h', q: 0.05, verdicts, epochs: null, resets: null, drain_top_k: 1 };
  const withGate = assembleAudit({ ...args, verdicts: [...verdicts], dispersion_gate: gateField });
  const withoutGate = assembleAudit({ ...args, verdicts: [...verdicts] });
  assert.deepEqual(withGate.selected_path_class_ids, withoutGate.selected_path_class_ids, 'the failing gate must not change selection');
  assert.equal(withGate.dispersion_gate!.passing, false, 'the audit must say the claim is withheld');
});

// ───────────────────────── ADR-0061: the z_max conjunct, directly bound ─────────────────────────

test('ADR-0061: the TRIPLE binding — pair-passing with z_max over bound must FAIL (kills the pair-only mutant directly); normalQuantile pinned to reference values', () => {
  const { normalQuantile, dispersionGate: gate } = require('../src/dispersion-gate');
  // reference values (kills a degenerate/+Infinity-bound mutant): Acklam |rel err| < 1.15e-9.
  assert.ok(Math.abs(normalQuantile(0.975) - 1.959964) < 1e-5, 'Φ⁻¹(0.975) ≈ 1.959964');
  assert.ok(Math.abs(normalQuantile(1 - 0.01 / 109) - 3.7407) < 1e-3, 'Φ⁻¹(1−0.01/109) ≈ 3.7407');
  assert.ok(Math.abs(normalQuantile(1 - 0.01 / 6112) - 4.6529) < 1e-3, 'Φ⁻¹(1−0.01/6112) ≈ 4.6529');
  assert.throws(() => normalQuantile(0), /needs p/);
  assert.throws(() => normalQuantile(1), /needs p/);

  // estimate-level: pair comfortably under threshold, z_max over its bound ⇒ MUST fail; the
  // same estimate with z_max under bound ⇒ passes. Deleting `&& z_max <= z_max_bound` from
  // dispersionGate flips the first assertion (the ADR-0061 cold-eye CRITICAL, closed).
  const base = {
    sigma_hat: 0.02, sigma_hat_tail: 0.025, raw_log_sd: 0.045, raw_log_sd_tail: 0.047,
    sampling_floor_sd: 0.041, n_leaves: 1456, ticks: 60, signals: 5, z_max_bound: 4.348,
  };
  assert.equal(gate({ ...base, z_max: 4.6 }).passing, false, 'pair-passing + z_max over bound must FAIL');
  assert.equal(gate({ ...base, z_max: 4.0 }).passing, true, 'pair-passing + z_max under bound passes');
});

test('ADR-0061: production-path pin — a former laundering run (1456 leaves, ς=0.05) now fails the gate WITH the pair passing (z_max is the tripping conjunct)', async () => {
  const { generateSpraypointFabric } = await import('../src/spraypoint');
  const { runNullRun } = await import('../tools/heterogeneity');
  const snap = generateSpraypointFabric({ nTors: 960, nPanels: 32, nRooms: 4, crossOptic: false });
  // seed 0xb0a01 was one of the pair-era laundering runs (gate passed, e-BH false-selected).
  const run = runNullRun(snap, 0xb0a01, { heterogeneity: { sigmaLogSd: 0.05 } });
  assert.equal(run.gate_passing, false, 'the triple gate must refuse the former laundering run');
  assert.ok(run.gate_z_max > run.gate_z_max_bound, `z_max (${run.gate_z_max.toFixed(2)}) must be the tripping conjunct (bound ${run.gate_z_max_bound.toFixed(2)})`);
});

// ───────────────────────── AC-6: published-envelope freshness ─────────────────────────

test('AC-6: the published gate envelope is FRESH (the ς=0.1 ROC cell recomputes exactly) and the .md is bound to the .json', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { renderMarkdown } = require('../tools/dispersion-gate');
  const rep = JSON.parse(readFileSync(join(__dirname, '..', 'coverage-matrices', 'dispersion-gate.json'), 'utf8'));
  const cell = rep.cells.find((c: { nominal: number }) => c.nominal === 0.1);
  assert.ok(cell, 'the ς=0.1 cell must be published');
  const runs = SEEDS.map((s) => {
    const est = estimateDispersion(calibResidualsUnder(s, { sigmaLogSd: 0.1 }));
    return { sigma_hat: est.sigma_hat, passing: dispersionGate(est).passing };
  });
  assert.equal(cell.mean_sigma_hat, runs.reduce((a, r) => a + r.sigma_hat, 0) / runs.length, 'published mean ς̂ must recompute exactly');
  assert.equal(cell.pass_rate, runs.filter((r) => r.passing).length / runs.length, 'published pass rate must recompute exactly');
  assert.equal(cell.pass_rate, 0, 'the onset cell must show the gate FAILING where selection lies (a constant-pass mutant publishes 1)');
  const md = readFileSync(join(__dirname, '..', 'coverage-matrices', 'dispersion-gate.md'), 'utf8');
  assert.equal(md, renderMarkdown(rep), 'published .md must equal renderMarkdown(published .json)');
});

// ───────────────────────── AC-5: session parity ─────────────────────────

test('AC-5: batch pipeline and incremental session stamp the IDENTICAL gate field (shared prelude)', async () => {
  const telemetry = { seed: 11, ticks: 40 };
  const pre = calibrateForSession(SNAP, telemetry, DEFAULT_DETECT, false, true, true);
  assert.ok(pre.dispersionGate, 'the prelude must produce the field when opted in');
  const audit = await runPipeline({ snapshot: SNAP, q: 0.05, telemetry, dispersionGate: true });
  assert.deepEqual(audit.dispersion_gate, pre.dispersionGate, 'batch field ≡ prelude field');
  const session = openSession({ snapshot: SNAP, calibration: pre.calibration, q: 0.05, ctx: pre.ctx, dispersionGate: pre.dispersionGate });
  const sAudit = await session.audit();
  assert.deepEqual(sAudit.dispersion_gate, pre.dispersionGate, 'session field ≡ prelude field');
});

test('AC-5b: the test/tool composition is ANCHORED to the production path — the helper estimate equals runPipeline\'s stamped fields', async () => {
  // calibResidualsUnder duplicates ⟨seed ⊕ 0xca11b, robust⟩, and tools/dispersion-gate.ts's
  // estimateUnder is the same composition (its published cells are bound to this helper by the
  // AC-6 recompute) — this assertion pins BOTH to the production prelude so they cannot drift
  // together (cold-eye finding 5).
  const audit = await runPipeline({ snapshot: SNAP, q: 0.05, telemetry: { seed: 0xb0a02, ticks: TICKS }, dispersionGate: true });
  const est = estimateDispersion(calibResidualsUnder(0xb0a02));
  assert.equal(audit.dispersion_gate!.sigma_hat, est.sigma_hat, 'helper ς̂ ≡ production ς̂, bit-for-bit');
  assert.equal(audit.dispersion_gate!.sigma_hat_tail, est.sigma_hat_tail, 'helper tail ς̂ ≡ production, bit-for-bit');
  assert.equal(audit.dispersion_gate!.raw_log_sd, est.raw_log_sd, 'helper raw ≡ production, bit-for-bit');
});
