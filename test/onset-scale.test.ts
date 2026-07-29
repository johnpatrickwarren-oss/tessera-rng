/**
 * ADR-0059 — onset-vs-N acceptance bar.
 *
 * The load-bearing binds: the cross-artifact anchor (109/shared overlap cells ≡ the ADR-0050
 * artifact — same seeds, same composition), an exact freshness recompute, and the two measured
 * findings pinned as data: the LAUNDERING region at (paper scale, ς = ς*) and the remedy arm's
 * N-robustness. A stale or hand-edited artifact fails the recompute; a re-run that loses either
 * finding fails the pins (which is correct — those pins ARE the ADR's recorded consequences).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateSpraypointFabric } from '../src/spraypoint';
import { runNullRun } from '../tools/heterogeneity';
import { renderMarkdown } from '../tools/onset-scale';

const rep = () => JSON.parse(readFileSync(join(__dirname, '..', 'coverage-matrices', 'onset-scale.json'), 'utf8'));
const boundary = () => JSON.parse(readFileSync(join(__dirname, '..', 'coverage-matrices', 'heterogeneity-boundary.json'), 'utf8'));

const cell = (r: ReturnType<typeof rep>, leaves: number, arm: string, sigma: number) =>
  r.cells.find((c: { leaves: number; arm: string; sigma: number }) => c.leaves === leaves && c.arm === arm && c.sigma === sigma);

test('AC-1: the 109/shared overlap cells reproduce the ADR-0050 artifact exactly (cross-artifact anchor)', () => {
  const r = rep();
  const b = boundary();
  for (const sigma of [0.05, 0.1]) {
    const here = cell(r, 109, 'shared', sigma);
    const ref = b.axes.dispersion.cells.find((c: { intensity: number }) => c.intensity === sigma);
    assert.ok(here && ref, `both artifacts must publish ς=${sigma} at 109 leaves`);
    assert.equal(here.mean_false_selections, ref.mean_false_selections, `ς=${sigma}: mean must equal the ADR-0050 cell`);
    assert.equal(here.max_false_selections, ref.max_false_selections, `ς=${sigma}: max must equal the ADR-0050 cell`);
  }
});

test('AC-3: the 109/shared ς=0.075 cell recomputes exactly; .md bound to .json; truncations recorded', () => {
  const r = rep();
  const snap = generateSpraypointFabric({ nTors: 64, nPanels: 10, nRooms: 2, crossOptic: false });
  const seeds = [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04, 0xb0a05, 0xb0a06, 0xb0a07, 0xb0a08];
  const runs = seeds.map((s) => runNullRun(snap, s, { heterogeneity: { sigmaLogSd: 0.075 } }));
  const c = cell(r, 109, 'shared', 0.075);
  assert.equal(c.mean_false_selections, runs.reduce((a, x) => a + x.false_selections, 0) / runs.length, 'published mean must recompute exactly');
  assert.equal(c.gate_pass_rate, runs.filter((x) => x.gate_passing).length / runs.length, 'published gate pass rate must recompute exactly');
  assert.ok(r.truncations.length >= 3, 'seed and grid truncations must be on the record');
  const md = readFileSync(join(__dirname, '..', 'coverage-matrices', 'onset-scale.md'), 'utf8');
  assert.equal(md, renderMarkdown(r), 'published .md must equal renderMarkdown(published .json)');
});

test('AC-2: the findings pinned — the pair-era laundering region CLOSED by the ADR-0061 triple gate; the remedy arm N-robust', () => {
  const r = rep();
  // The pair-era finding (gate passes 100% while e-BH false-selects at these cells) is
  // preserved in ADR-0059's text and git history; the artifact now records the TRIPLE gate
  // (ADR-0061): the same cells FAIL via z_max — the laundering region is closed, exactly the
  // extreme-value prediction. NB: a z_max-blind mutant is killed by the DIRECT tests in
  // test/dispersion-gate.test.ts (estimate-level + production-path pins), NOT by these
  // artifact pins alone (cold-eye-demonstrated) — these pins record the consequences.
  for (const leaves of [1456, 6112]) {
    const c = cell(r, leaves, 'shared', 0.05);
    assert.equal(c.gate_pass_rate, 0, `${leaves} leaves @ ς=0.05: the TRIPLE gate must fail the former laundering cells (z_max trips)`);
    assert.equal(c.laundering_rate, 0, `${leaves} leaves @ ς=0.05: laundering closed`);
    assert.ok(c.mean_false_selections > 0, `${leaves} leaves @ ς=0.05: the false selections are still there — the gate now correctly refuses them`);
  }
  // laundering is 0 in EVERY cell of both arms under the triple gate.
  for (const c of r.cells) assert.equal(c.laundering_rate, 0, `${c.leaves}/${c.arm}/ς=${c.sigma}: no laundering anywhere under the triple gate`);
  // clean-at-scale cells still pass (the α=0.01 budget holds where it must).
  for (const leaves of [1456, 6112]) assert.equal(cell(r, leaves, 'shared', 0.02).gate_pass_rate, 1, `${leaves} leaves @ ς=0.02: clean fleets still pass`);
  // onset monotone non-increasing with N on the shared arm (non-null asserted first — a null
  // onset would coerce to 0 and pass vacuously, cold-eye finding 9).
  const onset = (leaves: number) => {
    const o = r.onsets.find((x: { leaves: number; arm: string }) => x.leaves === leaves && x.arm === 'shared')!.onset;
    assert.ok(o !== null, `${leaves} leaves: the shared arm must have an in-grid onset`);
    return o as number;
  };
  assert.ok(onset(1456) <= onset(109) && onset(6112) <= onset(1456), 'the shared-arm onset must not increase with N');
  // the gate-wiring channel bound against an always-passing stub (cold-eye finding 2): the
  // 109/shared cells where the gate FAILS. NB the ς=0.05 straddle cell was 12.5% under the
  // pair gate (ADR-0051's 13%); under the ADR-0061 triple it fully fails (0% — more
  // conservative; the pair-era value is preserved in ADR-0051's text).
  assert.equal(cell(r, 109, 'shared', 0.075).gate_pass_rate, 0, 'the gate must be measured FAILING past the boundary — an always-pass stub dies here');
  assert.equal(cell(r, 109, 'shared', 0.05).gate_pass_rate, 0, 'the 109 straddle cell fully fails under the triple gate');
  // finding 2: the remedy arm is N-robust — zero false selections and zero laundering EVERYWHERE.
  for (const c of r.cells.filter((x: { arm: string }) => x.arm === 'perLeafScale')) {
    assert.equal(c.mean_false_selections, 0, `perLeafScale ${c.leaves}@ς=${c.sigma}: the remedy must hold at scale`);
    assert.equal(c.laundering_rate, 0, `perLeafScale ${c.leaves}@ς=${c.sigma}: no laundering`);
  }
});
