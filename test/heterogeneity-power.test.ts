/**
 * ADR-0054 — ς power axis acceptance bar.
 *
 * Anti-self-confirming (DISCIPLINES §6): the anchor test binds the tool's composition to
 * runPipeline BYTE-FOR-BYTE at the inert cell (a composition that drifted from production
 * would publish numbers about a different pipeline); the freshness test recomputes a published
 * cell exactly and binds .md ≡ renderMarkdown(.json).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../src/pipeline';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { runFaulted } from '../tools/heterogeneity-power';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);

test('AC-1: the inert cell (ς=0, shared calibration) reproduces runPipeline BYTE-FOR-BYTE', async () => {
  for (const seed of [0xb0a01, 0xb0a05]) {
    const composed = await runFaulted(seed, 'optic-3', undefined, false);
    const pipeline = await runPipeline({
      snapshot: SNAP,
      q: 0.05,
      telemetry: { seed, ticks: 60, degradation: { resource_id: 'optic-3', delta: 3, start_tick: 0 } },
    });
    assert.equal(JSON.stringify(composed), JSON.stringify(pipeline), `seed ${seed}: the tool composition must BE the production path`);
  }
});

test('AC-2 + AC-3: clean baseline non-degenerate; the ς=0 cell recomputes exactly; .md bound to .json; the remedy row is as published', async () => {
  const { renderMarkdown } = require('../tools/heterogeneity-power');
  const rep = JSON.parse(readFileSync(join(__dirname, '..', 'coverage-matrices', 'heterogeneity-power.json'), 'utf8'));

  // AC-2: the axis measures something — clean cells are perfect, dispersion cells are not.
  const clean = rep.cells.find((c: { sigma: number; per_leaf_scale: boolean }) => c.sigma === 0 && !c.per_leaf_scale);
  assert.equal(clean.fault_detection_rate, 1, 'clean detection must be 100%');
  assert.equal(clean.attribution_rate, 1, 'clean attribution must be 100%');
  assert.equal(clean.mean_false_coselections, 0, 'clean false co-selections must be 0');
  const broken = rep.cells.find((c: { sigma: number; per_leaf_scale: boolean }) => c.sigma === 0.2 && !c.per_leaf_scale);
  assert.ok(broken.mean_false_coselections > 1, 'the ς=0.2 shared cell must show the ADR-0050 mechanism — else the axis measures nothing');

  // freshness: recompute the clean shared cell (2 targets × 8 seeds) exactly.
  const seeds = [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04, 0xb0a05, 0xb0a06, 0xb0a07, 0xb0a08];
  let detected = 0;
  let attributed = 0;
  let selected = 0;
  for (const target of ['optic-3', 'optic-40'] as const) {
    for (const seed of seeds) {
      const audit = await runFaulted(seed, target, undefined, false);
      if (audit.culprits[0]?.resource_id === target) attributed += 1;
      if (audit.selected_path_class_ids.length > 0) detected += 1;
      selected += audit.selected_path_class_ids.length;
    }
  }
  assert.equal(clean.attribution_rate, attributed / 16, 'published clean attribution must recompute exactly');
  assert.equal(clean.mean_selected, selected / 16, 'published clean mean selected must recompute exactly');
  assert.equal(detected, 16, 'every clean faulted run must select');

  // the remedy row (published as measured — AC-3): perLeafScale restores attribution at every ς.
  for (const c of rep.cells.filter((x: { per_leaf_scale: boolean }) => x.per_leaf_scale)) {
    assert.equal(c.attribution_rate, 1, `perLeafScale ς=${c.sigma}: published attribution must be the measured 100%`);
    assert.equal(c.mean_false_coselections, 0, `perLeafScale ς=${c.sigma}: published false co-selections must be the measured 0`);
  }

  const md = readFileSync(join(__dirname, '..', 'coverage-matrices', 'heterogeneity-power.md'), 'utf8');
  assert.equal(md, renderMarkdown(rep), 'published .md must equal renderMarkdown(published .json)');
});
