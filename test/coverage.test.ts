import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floorFor, renderMarkdown } from '../tools/coverage';
import type { CoverageCell, CoverageReport } from '../tools/coverage';

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

test('markdown exposes detection AND attribution columns plus the FDR-control line', () => {
  const rep: CoverageReport = {
    generated_for: 'x',
    deltas: [0.5, 1.0, 2.0],
    seeds_per_cell: 2,
    targets_per_kind: 2,
    floor_rate: 0.9,
    cells: cells(),
    floors: [{ kind: 'optic', detection_floor: 1.0, attribution_floor: 2.0 }],
    clean: { trials: 4, mean_selected: 0, false_positive_rate: 0 },
  };
  const md = renderMarkdown(rep);
  assert.match(md, /detection \| attribution/);
  assert.match(md, /detection floor/);
  assert.match(md, /attribution floor/);
  assert.match(md, /FDR control/);
  // the p99-only scope must be disclosed prominently, not hidden (instrumented-caveat).
  assert.match(md, /Perturbation model & scope/);
  assert.match(md, /single-signal mean shift/);
});
