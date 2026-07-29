/**
 * ADR-0063 — the KNOWN e-value overflow defect, pinned as a tripwire.
 *
 * At δ = 32 — INSIDE the claimed cross-kind band (δ ∈ {3..32}, ADR-0046) — per-leaf e-values
 * overflow to Infinity, which JSON-serializes to null in audits. This test asserts the
 * CURRENT (defective) behavior so the defect is a permanent visible record: when the fix
 * lands (engine log-domain wealth, ADR-0034 fix B — the parked ADR-0063 decision — or the
 * parked interim clamp), these assertions FLIP and this test must be updated alongside the
 * fix's ADR. That flip is the intended tripwire, not an accident.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { runPipeline } from '../src/pipeline';

test('KNOWN DEFECT (ADR-0063): δ=32 overflows per-leaf e-values to Infinity → JSON null in audits', async () => {
  const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
  const audit = await runPipeline({
    snapshot: SNAP,
    q: 0.05,
    telemetry: { seed: 5, ticks: 60, degradation: { resource_id: 'optic-3', delta: 32, start_tick: 0 } },
  });
  const maxE = Math.max(...audit.verdicts.map((v) => v.e_value));
  assert.equal(Number.isFinite(maxE), false, 'the defect: wealth overflows inside the claimed band (flips when the log-domain fix lands)');
  const roundTripped = JSON.parse(JSON.stringify(audit));
  assert.equal(
    roundTripped.verdicts.some((v: { e_value: number | null }) => v.e_value === null),
    true,
    'the consumer-visible corruption: Infinity serializes to null (flips with the fix)',
  );
  // selection itself survives (Infinity ≥ any threshold) — the defect corrupts the RECORD,
  // not the verdict; recorded so the severity is neither over- nor under-stated.
  assert.ok(audit.selected_path_class_ids.length > 0, 'selection still fires — the defect is representational');
});
