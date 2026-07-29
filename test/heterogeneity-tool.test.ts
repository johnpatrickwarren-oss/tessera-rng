/**
 * ADR-0050 — boundary-tool acceptance bar (AC-1 tool half + AC-5 structure).
 *
 * Anti-self-confirming (DISCIPLINES §6): the load-bearing test is the inert anchor — the tool's
 * null-run composition MUST reproduce `runPipeline`'s surface (selected ids + fleet_log_e)
 * exactly when no knob is active. If the tool mis-wired calibration (wrong seed derivation,
 * wrong robust default, missing common-mode symmetry) the anchor fails; if it failed to wire the
 * knobs into BOTH windows, the mechanism spot-check fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runPipeline } from '../src/pipeline';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { runNullRun, realizedDispersion, renderMarkdown } from '../tools/heterogeneity';

const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);

test('AC-1 (tool): inert null run reproduces runPipeline surface EXACTLY (selected + fleet_log_e), across seeds and arms', async () => {
  for (const seed of [0xb0a01, 0xb0a02, 77]) {
    for (const cm of [false, true]) {
      const audit = await runPipeline({ snapshot: SNAP, q: 0.05, telemetry: { seed, ticks: 60 }, commonModeRobust: cm });
      const run = runNullRun(SNAP, seed, { commonModeRobust: cm });
      assert.deepEqual([...run.selected], audit.selected_path_class_ids, `seed ${seed} cm=${cm}: selected sets must match`);
      assert.equal(run.fleet_log_e, audit.fleet_log_e, `seed ${seed} cm=${cm}: fleet e-value must match bit-for-bit`);
    }
  }
});

test('AC-1 (tool): clean DEFAULT fabric selects nothing at every sweep seed (the ς=0 baseline row)', () => {
  for (const seed of [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04, 0xb0a05, 0xb0a06, 0xb0a07, 0xb0a08]) {
    assert.equal(runNullRun(SNAP, seed, {}).false_selections, 0, `seed ${seed}: clean fabric must select nothing`);
  }
});

// ───────────────────────── AC-5: published-envelope freshness + honesty structure ─────────────────────────

test('AC-5: published envelope is FRESH (the H ς=0.1 onset cell recomputes exactly) and structurally honest', () => {
  const rep = JSON.parse(readFileSync(join(__dirname, '..', 'coverage-matrices', 'heterogeneity-boundary.json'), 'utf8'));

  // Freshness spot-check: recompute the onset cell from the same seeds — deterministic, must match
  // the artifact EXACTLY. Also the wiring mutant-killer: a tool that failed to thread ς into both
  // windows would publish 0 here, and this recomputation (mean > 0) plus equality would expose a
  // stale or hand-edited artifact.
  const seeds = [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04, 0xb0a05, 0xb0a06, 0xb0a07, 0xb0a08];
  const counts = seeds.map((s) => runNullRun(SNAP, s, { heterogeneity: { sigmaLogSd: 0.1 } }).false_selections);
  const cell = rep.axes.dispersion.cells.find((c: { intensity: number }) => c.intensity === 0.1);
  assert.ok(cell, 'the ς=0.1 grid cell must be published');
  assert.equal(cell.mean_false_selections, counts.reduce((s: number, x: number) => s + x, 0) / counts.length, 'published mean must recompute exactly');
  assert.equal(cell.max_false_selections, Math.max(...counts), 'published max must recompute exactly');
  assert.ok(cell.mean_false_selections > 0, 'the onset cell must show the mechanism (a no-op wiring mutant publishes 0)');

  // Honesty structure (AC-5): clean rows published at every fabric size; truncations on the
  // record; realized dispersion published on every D cell and every active H cell.
  const cleanRegime = rep.axes.scale.regimes.find((r: { regime: string }) => r.regime === 'clean');
  assert.equal(cleanRegime.cells.length, 5, 'all five fabric sizes must publish a clean row');
  for (const c of cleanRegime.cells) assert.equal(c.mean_false_selections, 0, `clean row at ${c.leaves} leaves must be 0 (and published)`);
  assert.ok(rep.truncations.length >= 2, 'reduced seed blocks at scale must be recorded as truncations');
  for (const c of rep.axes.drift.cells) assert.ok(typeof c.realized_dispersion === 'number', 'every D cell must publish realized dispersion (the draw-artifact guard)');
  for (const c of rep.axes.dispersion.cells) if (c.intensity > 0) assert.ok(typeof c.realized_dispersion === 'number', 'every active H cell must publish realized dispersion');
  assert.equal(rep.axes.dispersion.onset, 0.1, 'the recorded onset must match the published grid');
});

test('AC-5: the D-axis m=1 cell + its realized dispersion + the no-mismatch control recompute exactly; the .md is bound to the .json', () => {
  const rep = JSON.parse(readFileSync(join(__dirname, '..', 'coverage-matrices', 'heterogeneity-boundary.json'), 'utf8'));
  const seeds = [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04, 0xb0a05, 0xb0a06, 0xb0a07, 0xb0a08];

  // the load-bearing D cell (cold-eye finding 5): the draw-artifact claim rides on this column.
  const m1 = rep.axes.drift.cells[rep.axes.drift.cells.length - 1];
  assert.equal(m1.intensity, 1, 'the last D cell must be driftMix=1');
  const m1Counts = seeds.map((s) => runNullRun(SNAP, s, { heterogeneity: { sigmaLogSd: 0.2, driftMix: 1 } }).false_selections);
  assert.equal(m1.mean_false_selections, m1Counts.reduce((s: number, x: number) => s + x, 0) / m1Counts.length, 'D m=1 mean must recompute exactly');
  assert.equal(m1.realized_dispersion, realizedDispersion(SNAP, { sigmaLogSd: 0.2, driftMix: 1 }), 'D m=1 realized dispersion must recompute exactly');

  // the direct no-mismatch control: same σ-set as m=1, run as a base draw (0x5e7e0 ^ 0xd41f7).
  const ctl = rep.axes.drift.control;
  const ctlCounts = seeds.map((s) => runNullRun(SNAP, s, { heterogeneity: { sigmaLogSd: 0.2, seed: 0x5e7e0 ^ 0xd41f7 } }).false_selections);
  assert.equal(ctl.mean_false_selections, ctlCounts.reduce((s: number, x: number) => s + x, 0) / ctlCounts.length, 'control mean must recompute exactly');
  assert.equal(ctl.realized_dispersion, m1.realized_dispersion, 'control runs the SAME σ-set as m=1 — realized dispersion must be identical');

  // the .md is a render of the .json — a hand-edited or stale .md fails here.
  const md = readFileSync(join(__dirname, '..', 'coverage-matrices', 'heterogeneity-boundary.md'), 'utf8');
  assert.equal(md, renderMarkdown(rep), 'published .md must equal renderMarkdown(published .json)');
});
