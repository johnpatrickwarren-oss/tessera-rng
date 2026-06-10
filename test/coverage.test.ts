import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floorFor, modeFloorOf, renderMarkdown } from '../tools/coverage';
import type { CoverageCell, CoverageReport, ModePoint } from '../tools/coverage';

function cells(): CoverageCell[] {
  // detection reaches >=0.9 at Δ=1.0; attribution only at Δ=2.0 (you must detect before you attribute).
  return [
    { kind: 'optic', delta: 0.5, n: 4, detected: 1, attributed: 0, detection_rate: 0.25, attribution_rate: 0 },
    { kind: 'optic', delta: 1.0, n: 4, detected: 4, attributed: 2, detection_rate: 1.0, attribution_rate: 0.5 },
    { kind: 'optic', delta: 2.0, n: 4, detected: 4, attributed: 4, detection_rate: 1.0, attribution_rate: 1.0 },
  ];
}

test('detection floor is the smallest Δ reaching the rate; attribution floor is no smaller', () => {
  const c = cells();
  const det = floorFor(c, 'optic', 'detection_rate');
  const att = floorFor(c, 'optic', 'attribution_rate');
  assert.equal(det, 1.0);
  assert.equal(att, 2.0);
  assert.ok(att! >= det!, 'cannot attribute below the detection floor');
});

test('floor is null when the rate is never reached', () => {
  const weak: CoverageCell[] = [
    { kind: 'optic', delta: 0.5, n: 4, detected: 1, attributed: 0, detection_rate: 0.25, attribution_rate: 0 },
  ];
  assert.equal(floorFor(weak, 'optic', 'detection_rate'), null);
});

test('modeFloorOf returns the smallest magnitude reaching the rate (mode floors, ADR-0010)', () => {
  const pts: ModePoint[] = [
    { magnitude: 0.3, detection_rate: 0.25, attribution_rate: 0, family: 'none' },
    { magnitude: 0.7, detection_rate: 1.0, attribution_rate: 0.5, family: 'D' },
    { magnitude: 0.9, detection_rate: 1.0, attribution_rate: 1.0, family: 'D' },
  ];
  assert.equal(modeFloorOf(pts, 'detection_rate'), 0.7);
  assert.equal(modeFloorOf(pts, 'attribution_rate'), 0.9);
  assert.equal(modeFloorOf([pts[0]], 'detection_rate'), null);
});

test('markdown exposes detection AND attribution columns plus the FDR-control line', () => {
  const rep: CoverageReport = {
    generated_for: 'x',
    deltas: [0.5, 1.0, 2.0],
    seeds_per_cell: 2,
    targets_per_kind: 2,
    floor_rate: 0.9,
    cells: cells(),
    floors: [{ kind: 'optic', detection_floor: 1.0, attribution_floor: 2.0 }],
    per_signal: [
      { signal: 'loss_rate', mode: 'mean', delta: 3, n: 4, detection_rate: 1, attribution_rate: 1 },
      { signal: 'loss_rate', mode: 'variance', delta: 4, n: 4, detection_rate: 0.75, attribution_rate: 0.75 },
    ],
    mode_floors: [
      { mode: 'mean_shift', unit: 'Δ (p99 mean)', detection_floor: 1.0, attribution_floor: 2.0, detecting_family: 'A', points: [{ magnitude: 1.0, detection_rate: 1, attribution_rate: 0.5, family: 'A+C' }] },
      { mode: 'covariance_flip', unit: 'Δρ (corr change)', detection_floor: 1.0, attribution_floor: 1.0, detecting_family: 'C', points: [{ magnitude: 1.0, detection_rate: 1, attribution_rate: 1, family: 'C' }] },
      { mode: 'oscillation', unit: 'amplitude (period 7)', detection_floor: 0.9, attribution_floor: 0.9, detecting_family: 'D', points: [{ magnitude: 0.9, detection_rate: 1, attribution_rate: 1, family: 'D' }] },
    ],
    spraypoint_views: [
      { fault_kind: 'optic', resource: 'optic-3', per_view_detected: { per_tor: 1 }, concentrated_by: 'per_tor' },
      { fault_kind: 'shuffle_panel', resource: 'panel-2', per_view_detected: { per_panel_pair: 9 }, concentrated_by: 'per_panel_pair' },
    ],
    clean: { trials: 4, mean_selected: 0, false_positive_rate: 0 },
  };
  const md = renderMarkdown(rep);
  assert.match(md, /detection \| attribution/);
  assert.match(md, /detection floor/);
  assert.match(md, /attribution floor/);
  assert.match(md, /FDR control/);
  // scope must be disclosed prominently, not hidden (instrumented-caveat).
  assert.match(md, /Perturbation model & scope/);
  assert.match(md, /p99_latency.* mean shift|p99 mean shift/);
  // the per-signal section + variance row demonstrate the full contract is exercised.
  assert.match(md, /Per-signal coverage/);
  assert.match(md, /loss_rate \| variance/);
  // the per-mode floor table covers all three modes with their firing family (ADR-0010).
  assert.match(md, /Per-mode detection floors/);
  assert.match(md, /covariance_flip/);
  assert.match(md, /oscillation/);
  assert.match(md, /detecting family/);
  // the Spraypoint per-view blind-spot map (ADR-0015) is published, not implied.
  assert.match(md, /Spraypoint per-view detection/);
  assert.match(md, /concentrated by/);
  assert.match(md, /per_tor/);
});

test('SPOT-CHECK: one committed coverage cell matches a fresh recomputation (freshness floor, ADR-0019 cold-eye)', async () => {
  // The full sweep (~18s) is too heavy for the suite, so this is an honest PARTIAL bind: the
  // optic Δ=1.0 cell — exactly where the stale artifact diverged (attribution 25% vs 75%) — is
  // recomputed and compared field-for-field to coverage-matrices/coverage-saturation.json.
  // The byte-exact demo freshness test (demo.test.ts) is the broad-spectrum companion. Fix a
  // failure by re-running `pnpm coverage`, never by editing the JSON.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { cell, topTargets } = await import('../tools/coverage');
  const rep = JSON.parse(readFileSync(join(__dirname, '..', 'coverage-matrices', 'coverage-saturation.json'), 'utf8'));
  const committed = rep.cells.find((c: { kind: string; delta: number }) => c.kind === 'optic' && c.delta === 1.0);
  assert.ok(committed, 'the optic Δ=1.0 cell must exist in the committed matrix');
  const fresh = await cell('optic', 1.0, topTargets('optic', rep.targets_per_kind));
  assert.deepEqual(committed, JSON.parse(JSON.stringify(fresh)), 'coverage-matrices/ is stale — run `pnpm coverage`');
});
