/**
 * ADR-0057 — real-telemetry replay acceptance bar.
 *
 * CI-reproducibility boundary (AC-3): the committed fixtures recompute EXACTLY through the
 * same pipeline the full-rate rows used; the full-rate rows themselves are off-repo data and
 * are bound structurally (from the committed artifact JSON) plus by a consistency band to the
 * fixture cells — not recomputed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureAnalysis, loadFixture, buildRealSubstrate, standardizeReal, activeSubset, renderMarkdown } from '../tools/real-replay';
import { estimateDispersion, dispersionGate } from '../src/dispersion-gate';

const rep = () => JSON.parse(readFileSync(join(__dirname, '..', 'coverage-matrices', 'real-replay.json'), 'utf8'));

test('AC-3: the committed fixture cells recompute EXACTLY and the .md is bound to the .json', () => {
  const r = rep();
  const recomputed = fixtureAnalysis();
  assert.deepEqual(r.fixture, recomputed, 'published fixture cells must recompute exactly from the committed fixtures');
  const md = readFileSync(join(__dirname, '..', 'coverage-matrices', 'real-replay.md'), 'utf8');
  assert.equal(md, renderMarkdown(r), 'published .md must equal renderMarkdown(published .json)');
});

test('AC-1/AC-4 (structural, from the committed artifact): real ς̂ is far past the boundary, the gate withholds, and the outage is the largest drift', () => {
  const r = rep();
  for (const c of r.dispersion) {
    assert.equal(c.gate_passing, false, `${c.population}: the gate must withhold on the real population`);
    assert.ok(c.sigma_hat > 0.3, `${c.population}: real ς̂ (${c.sigma_hat}) must sit far past the synthetic boundary — else the headline is wrong`);
  }
  for (const m of r.monitors) assert.equal(m.status, 'drifted', `${m.window}/${m.arm}/${m.population}: every real live window measured drifted`);
  // the natural experiment, bound on the monitor's BINDING statistic max(ς̂, tail ς̂), across
  // ALL FOUR arms (cold-eye finding 3: robust alone reverses in perLeafScale/active).
  const binding = (m: { sigma_hat: number; sigma_hat_tail: number }) => Math.max(m.sigma_hat, m.sigma_hat_tail);
  for (const arm of ['shared', 'perLeafScale']) {
    for (const population of ['full', 'active']) {
      const rows = r.monitors.filter((m: { arm: string; population: string }) => m.arm === arm && m.population === population);
      const outage = rows.find((m: { window: string }) => m.window.includes('OUTAGE'));
      assert.ok(rows.every((m: { sigma_hat: number; sigma_hat_tail: number }) => binding(m) <= binding(outage)), `${arm}/${population}: across-outage must be the largest drift on the binding statistic`);
    }
  }
  // the CI-reproducible cell ties to the full-rate headline: downsampling must not move ς̂ much.
  assert.ok(Math.abs(r.fixture[0].sigma_hat - r.dispersion[0].sigma_hat) < 0.15, `fixture ς̂ ${r.fixture[0].sigma_hat} must corroborate the full-rate ${r.dispersion[0].sigma_hat}`);
});

test('AC-2: the production objects run verbatim on the fixture — gate verdict and shrinkage arm reproduce the mechanism end-to-end', () => {
  const cal = loadFixture('mini-cores-cal.json');
  const sub = buildRealSubstrate(cal.entities);
  const resid = standardizeReal(cal.entities, sub);
  const est = estimateDispersion(resid);
  // cold-eye finding 5: bind the TOOL's estimator to src's by exact float equality — this
  // path goes through the test's own src import; the published cell went through the tool's.
  // Identical inputs ⇒ bit-identical output IFF the tool did not reimplement the estimator.
  assert.equal(est.sigma_hat, rep().fixture[0].sigma_hat, 'tool estimator ≡ src estimator, bit-for-bit');
  assert.equal(dispersionGate(est).passing, false, 'the verbatim gate must withhold on real fixture residuals');
  const active = activeSubset(cal.entities);
  assert.ok(active.length >= 5 && active.length < 14, `the liveness pre-filter must find a real parked subpopulation (active ${active.length}/14)`);
  const activeEst = estimateDispersion(new Map(active.map((id) => [id, resid.get(id)!])));
  assert.ok(activeEst.sigma_hat < est.sigma_hat, 'excluding parked cores must reduce (not eliminate) the measured dispersion');
});
