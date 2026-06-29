/**
 * ADR-0033 — magnitude z-calibration is a BAND TRADEOFF, not a uniform fix.
 *
 * The ADR-0031 cold-eye noted the pipeline feeds an ACCRUED e-value, so z ≈ θ√T rather than the
 * per-tick θ. Dividing ln E by the accrual window (opt-in `magnitudeTicks`) recovers z ≈ θ — but
 * measured end-to-end it does NOT uniformly improve recovery: it rebalances evidence (μz) vs
 * falsification (−μ²/2), shifting the cross-optic recovery band UPWARD in δ. Pinned here so the
 * scale choice for the production cutover is made on recorded evidence, not on the LR-theory
 * argument alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../src/pipeline';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { buildSurface } from '../src/surface';
import { localize, magnitudeZ, DEFAULT_LOCALIZE } from '../src/tomography';
import type { FaultDomainSnapshot } from '../src/domain';

const CROSS = generateSpraypointFabric({ ...DEFAULT_SPRAYPOINT, crossOptic: true });
const TICKS = 60;
const top2 = (cs: readonly { resource_id: string }[]): string[] => cs.slice(0, 2).map((c) => c.resource_id);
const both = (t: string[]): boolean => t.includes('optic-3') && t.includes('panel-7');

/** cross-kind recovery count over seeds, for raw (ticks=1) vs calibrated (ticks=T) z. */
async function counts(snap: FaultDomainSnapshot, delta: number, seeds: number[]): Promise<{ raw: number; cal: number }> {
  let raw = 0;
  let cal = 0;
  for (const seed of seeds) {
    const audit = await runPipeline({ snapshot: snap, q: 0.05, telemetry: { seed, ticks: TICKS, degradations: [
      { resource_id: 'optic-3', delta, start_tick: 0 }, { resource_id: 'panel-7', delta, start_tick: 0 },
    ] } });
    const surface = buildSurface(audit.verdicts, 0.05);
    const eOf = new Map(audit.verdicts.map((v) => [v.path_class_id, v.e_value]));
    const mag = new Map(surface.selected_path_class_ids.map((pc) => [pc, eOf.get(pc)!]));
    const opts = { ...DEFAULT_LOCALIZE, q0: surface.base_rate_q0, magnitude: mag };
    if (both(top2(localize(snap, surface.selected_path_class_ids, opts).culprits))) raw += 1;
    if (both(top2(localize(snap, surface.selected_path_class_ids, { ...opts, magnitudeTicks: TICKS }).culprits))) cal += 1;
  }
  return { raw, cal };
}

test('magnitudeZ calibration recovers the per-tick shift: z(e^{T·θ²/2}, T) ≈ θ; ticks=1 is the raw identity', () => {
  for (const theta of [1, 2, 3]) {
    assert.ok(Math.abs(magnitudeZ(Math.exp((TICKS * theta * theta) / 2), TICKS) - theta) < 1e-9, `accrued z over T recovers θ=${theta}`);
    assert.ok(Math.abs(magnitudeZ(Math.exp((theta * theta) / 2), 1) - theta) < 1e-12, `ticks=1 is the single-observation identity θ=${theta}`);
  }
  // raw z over an accrued e-value is √T larger than the calibrated z — the scale mismatch itself.
  assert.ok(magnitudeZ(Math.exp(TICKS * 0.5), 1) > 5 * magnitudeZ(Math.exp(TICKS * 0.5), TICKS), 'raw z is √T-inflated vs calibrated');
});

test('TRADEOFF (recorded): raw (accrued) z wins the LOW-δ band; calibrated z wins the HIGH-δ band', async () => {
  // Low δ=4 — the operationally important "subtle fault before the margin is spent" regime:
  const lo = await counts(CROSS, 4, [1, 2, 3]);
  assert.ok(lo.raw > lo.cal, `low-δ: raw recovers more (raw ${lo.raw}/3 > cal ${lo.cal}/3) — calibration over-falsifies the diluted optic`);

  // High δ=32 — calibration's balanced falsification separates the saturated fleet where raw cannot:
  const hi = await counts(CROSS, 32, [1, 2, 3]);
  assert.ok(hi.cal > hi.raw, `high-δ: calibrated recovers more (cal ${hi.cal}/3 > raw ${hi.raw}/3) — the scale choice is a band tradeoff, not a fix`);
});
