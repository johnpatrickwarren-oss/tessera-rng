/**
 * ADR-0031 — cross-optic re-add + magnitude scorer (ADR-0029 Phase 2), the acceptance bar.
 *
 * Reverses the ADR-0028 rejection: on the OPT-IN cross-optic fabric (partner-optic edges at
 * 1/(nTors−1) re-added), the BINARY fire/quiet scorer cannot recover the cross-kind optic (the
 * recorded ADR-0028 result), but the q₀-aware MAGNITUDE scorer recovers it across seeds. The
 * high-δ saturation limitation is recorded here too — not hidden (instrumented-caveat).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../src/pipeline';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { buildSurface } from '../src/surface';
import { localize, DEFAULT_LOCALIZE } from '../src/tomography';
import type { FaultDomainSnapshot } from '../src/domain';

const CROSS = generateSpraypointFabric({ ...DEFAULT_SPRAYPOINT, crossOptic: true });
const top2 = (cs: readonly { resource_id: string }[]): string[] => cs.slice(0, 2).map((c) => c.resource_id);
const bothRecovered = (t: string[]): boolean => t.includes('optic-3') && t.includes('panel-7');

/** Run the cross-kind fault and localize with BOTH scorers off the same detection result. */
async function recover(snap: FaultDomainSnapshot, delta: number, seed: number): Promise<{ binary: string[]; magnitude: string[] }> {
  const audit = await runPipeline({ snapshot: snap, q: 0.05, telemetry: { seed, ticks: 60, degradations: [
    { resource_id: 'optic-3', delta, start_tick: 0 }, { resource_id: 'panel-7', delta, start_tick: 0 },
  ] } });
  const surface = buildSurface(audit.verdicts, 0.05);
  const eOf = new Map(audit.verdicts.map((v) => [v.path_class_id, v.e_value]));
  const mag = new Map(surface.selected_path_class_ids.map((pc) => [pc, eOf.get(pc)!]));
  // BINARY baseline computed explicitly (no magnitude) — the pipeline default is now magnitude
  // (ADR-0035), so we localize both ways from the same detection surface to keep the contrast.
  const bin = localize(snap, surface.selected_path_class_ids, { ...DEFAULT_LOCALIZE, q0: surface.base_rate_q0 });
  const m = localize(snap, surface.selected_path_class_ids, { ...DEFAULT_LOCALIZE, q0: surface.base_rate_q0, magnitude: mag });
  return { binary: top2(bin.culprits), magnitude: top2(m.culprits) };
}

test('cross-optic edges are emitted BY DEFAULT (ADR-0035 cutover); opting out restores the sp2 omission', () => {
  const partner = CROSS.edges.filter((e) => e.path_class === 'tor-3' && e.resource.startsWith('optic-') && e.resource !== 'optic-3');
  assert.equal(partner.length, DEFAULT_SPRAYPOINT.nTors - 1, 'every partner optic is an edge by default');
  for (const e of partner) assert.ok(Math.abs((e.weight ?? 1) - 1 / (DEFAULT_SPRAYPOINT.nTors - 1)) < 1e-12, 'partner weight = 1/(nTors−1)');
  assert.ok(CROSS.source_version.startsWith('sp3:'), 'marked sp3 (full-support variant)');

  // opting OUT (crossOptic:false) restores the historic ADR-0028 omission — the binary-era fabric.
  const noCross = generateSpraypointFabric({ ...DEFAULT_SPRAYPOINT, crossOptic: false });
  const none = noCross.edges.filter((e) => e.path_class === 'tor-3' && e.resource.startsWith('optic-') && e.resource !== 'optic-3');
  assert.equal(none.length, 0, 'crossOptic:false omits the cross-optic edges (the retired sp2 fabric)');
  assert.ok(noCross.source_version.startsWith('sp2:'));
});

test('ACCEPTANCE BAR: magnitude recovers the cross-kind optic 4/4 seeds where binary gets 0/4 (δ∈{3,4,5,6})', async () => {
  // ADR-0028's rejection table: binary gets "panel-7 only — optic NEVER recovered". Reversed here —
  // the FULL committed sweep that backs the ADR Build-note table (no manual-run testimony, §0).
  for (const delta of [3, 4, 5, 6]) {
    let binaryRecovered = 0;
    let magnitudeRecovered = 0;
    for (const seed of [1, 2, 3, 4]) {
      const { binary, magnitude } = await recover(CROSS, delta, seed);
      if (bothRecovered(binary)) binaryRecovered += 1;
      if (bothRecovered(magnitude)) magnitudeRecovered += 1;
    }
    assert.equal(binaryRecovered, 0, `δ=${delta}: binary reproduces the ADR-0028 rejection (optic never recovered)`);
    assert.equal(magnitudeRecovered, 4, `δ=${delta}: q₀-aware magnitude recovers BOTH optic-3 and panel-7, every seed`);
  }
});

test('RECORDED LIMITATION (instrumented-caveat): out of band (δ≥8) the fleet saturates — BOTH fail, magnitude EQUAL to binary not better', async () => {
  // A δ≥8 optic fault leaks ~δ/(nTors−1) into every tor leaf, firing the whole fleet: the estimated
  // base rate q₀ climbs (≈0.37 at δ=8, ≈0.70 at δ=16) and accrued e-values overflow (z clamps),
  // both flattening discrimination. Magnitude does NOT solve this deeper saturation — recovery holds
  // in the δ≈3–6 band; outside it both scorers fail EQUALLY (magnitude is better in-band, equal
  // out-of-band, never worse). Published, not implied away.
  for (const delta of [8, 16]) {
    const { binary, magnitude } = await recover(CROSS, delta, 1);
    assert.ok(!bothRecovered(binary), `δ=${delta}: binary fails (control)`);
    assert.ok(!bothRecovered(magnitude), `δ=${delta}: magnitude ALSO fails under fleet saturation — the recorded limitation`);
  }
});

test('SAFETY (ADR-0035 cutover, production default fabric): a saturating fault is never localized to a WRONG optic', async () => {
  // ADR-0035 ships cross-optic by DEFAULT, so exercise the real pipeline path on the default fabric.
  // The high-δ failure mode (ADR-0034) must be "incomplete" (the true optic is missed), NEVER
  // "confidently wrong" (a spurious optic blamed). Verified across the saturation band × seeds.
  const snap = generateSpraypointFabric(DEFAULT_SPRAYPOINT); // cross-optic by default now
  for (const delta of [8, 16, 32]) {
    for (const seed of [1, 2, 3, 4]) {
      const a = await runPipeline({ snapshot: snap, q: 0.05, telemetry: { seed, ticks: 60, degradations: [
        { resource_id: 'optic-3', delta, start_tick: 0 }, { resource_id: 'panel-7', delta, start_tick: 0 },
      ] } });
      const wrongOptic = a.culprits.find((c) => c.resource_id.startsWith('optic-') && c.resource_id !== 'optic-3');
      assert.equal(wrongOptic, undefined, `δ=${delta} seed=${seed}: no spurious optic culprit (${wrongOptic?.resource_id}) — failure is incomplete, not wrong`);
    }
  }
});
