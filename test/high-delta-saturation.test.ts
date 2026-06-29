/**
 * ADR-0034 — high-δ cross-optic saturation: root-cause characterization.
 *
 * The ADR-0031 acceptance bar recovers cross-kind in the δ≈3–6 band; at δ≥8 both scorers fail.
 * This file PINS the diagnosed root cause so the characterization cannot silently rot: the
 * localization null q₀ = the observed firing fraction (ADR-0016), which a single fault's fleet-wide
 * cross-optic leak inflates — circularly discounting the very signal it should localize. Dropping
 * q₀ to the clean rate recovers the optic, proving q₀ is the lever (but only partially across seeds,
 * and at the cost of the genuine fleet-wide-event rejection — see ADR-0034).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../src/pipeline';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { buildSurface } from '../src/surface';
import { localize, DEFAULT_LOCALIZE } from '../src/tomography';

const CROSS = generateSpraypointFabric({ ...DEFAULT_SPRAYPOINT, crossOptic: true });

test('ROOT CAUSE (ADR-0034): a fleet-wide fault inflates the firing-fraction q₀, which then masks the fault', async () => {
  const audit = await runPipeline({ snapshot: CROSS, q: 0.05, telemetry: { seed: 1, ticks: 60, degradations: [
    { resource_id: 'optic-3', delta: 16, start_tick: 0 }, { resource_id: 'panel-7', delta: 16, start_tick: 0 },
  ] } });
  const surface = buildSurface(audit.verdicts, 0.05);
  const sel = surface.selected_path_class_ids;
  const eOf = new Map(audit.verdicts.map((v) => [v.path_class_id, v.e_value]));
  const mag = new Map(sel.map((pc) => [pc, eOf.get(pc)!]));

  // (1) q₀ is CORRUPTED upward: the optic-3 leak fires the whole fleet, so the observed firing
  // fraction — the ADR-0016 null — climbs far past a quiet-fleet rate. This is the circularity.
  assert.ok(surface.base_rate_q0 > 0.5, `q₀ inflated by the fault's own fleet-wide firing (got ${surface.base_rate_q0.toFixed(3)})`);
  assert.ok(sel.filter((pc) => pc.startsWith('tor-')).length >= 60, 'nearly all tor leaves fire (the leak)');

  // (2) At the corrupted q₀ the magnitude scorer does NOT rank optic-3 (the inflated null says its
  // firing is "expected") — but at the CLEAN rate it recovers it. q₀ is the lever; the firing-
  // fraction estimate is the defect, not the scorer.
  const atCorrupted = localize(CROSS, sel, { ...DEFAULT_LOCALIZE, q0: surface.base_rate_q0, magnitude: mag });
  const atClean = localize(CROSS, sel, { ...DEFAULT_LOCALIZE, q0: 0.05, magnitude: mag });
  assert.ok(!atCorrupted.culprits.some((c) => c.resource_id === 'optic-3'), 'corrupted q₀: optic-3 not ranked');
  assert.ok(atClean.culprits.some((c) => c.resource_id === 'optic-3'), 'clean q₀: optic-3 recovered — q₀ corruption is the cause');
});
