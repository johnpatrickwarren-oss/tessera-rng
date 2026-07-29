/**
 * ADR-0064 — escalation-tier acceptance bar.
 *
 * Anti-self-confirming (DISCIPLINES §6): the calibrated null's binding test is AC-1b — the
 * FAULT-side sibling pin (a no-calibration mutant's sibling E is erratic and drops below 1/α
 * on half the seeds; clean-side, mean-betting is scale-fair, so AC-1 is only a validity
 * smoke); AC-2 reproduces the ADR-0049 sub-floor gain under the honest null with the leaf
 * layer as the in-test control; AC-3 binds the neighborhood semantics on the measured
 * confound; the guard test pins the exact typo'd id that fabricated the retracted claim.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { generateTelemetry } from '../src/telemetry';
import { buildCalibration, standardizeAll } from '../src/calibration';
import { detectAll, DEFAULT_DETECT } from '../src/detect';
import { estimateBaselineCovariance, makeFamilyCCellFromCovariance } from '../src/family-c';
import { estimateFamilyDNull } from '../src/family-d';
import { buildSurface } from '../src/surface';
import { escalationTier, neighborhoods } from '../src/resource-eprocess';
import type { PathClassId } from '../src/domain';

const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
const TICKS = 60;

function residPair(seed: number, degradation?: { resource_id: string; delta: number; start_tick: number }) {
  const calRaw = generateTelemetry(SNAP, { seed: seed ^ 0xca11b, ticks: TICKS });
  const sub = buildCalibration(calRaw.series, { robust: true });
  const cal = standardizeAll(calRaw.series, sub);
  const live = standardizeAll(generateTelemetry(SNAP, { seed, ticks: TICKS, ...(degradation ? { degradation } : {}) }).series, sub);
  return { cal, live, sub };
}

/** The leaf-layer control: does the standard pipeline select ANY leaf for this run? */
function leafLayerDetects(cal: Map<PathClassId, number[][]>, live: Map<PathClassId, number[][]>): boolean {
  const ctx = {
    familyCCell: makeFamilyCCellFromCovariance(estimateBaselineCovariance(cal).sigma, DEFAULT_DETECT.alphaC),
    familyDCells: estimateFamilyDNull(cal),
  };
  return buildSurface(detectAll(live, DEFAULT_DETECT, ctx), 0.05).selected_path_class_ids.length > 0;
}

test('AC-1 (validity smoke): clean false-escalation stays near α under the calibrated null', () => {
  let calibratedFires = 0;
  let cells = 0;
  for (const seed of [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04]) {
    const { cal, live } = residPair(seed);
    const tier = escalationTier(SNAP, cal, live);
    calibratedFires += tier.escalations.length;
    cells += tier.entries.length;
  }
  const rate = calibratedFires / cells;
  // a validity SMOKE (measured 0/304 — well under; the bound tolerates statistical variation).
  // NB (cold-eye): clean-side, mean-betting is SCALE-FAIR, so this cannot kill a no-calibration
  // mutant — the REAL mutant-killer is the fault-side sibling pin in the AC-1b test below.
  assert.ok(rate <= 2 * 0.05, `clean per-resource escalation rate ${rate.toFixed(4)} must be near α`);
});

test('AC-1b (the calibration mutant-killer, fault-side): under a room-0 fault the CALIBRATED sibling aggregate fires consistently — a no-calibration mutant is erratic and dies', () => {
  // The room-1 aggregate GENUINELY shifts under a room-0 fault (shared members at w=½) — the
  // calibrated null detects it on EVERY seed (measured E ≈ 1e5+). A unit-variance mutant
  // (calibration skipped) produces clipped bets on mis-scaled data: measured sibling E
  // {3.3e-2, 1.9e3, 48, 2.1e-3} — BELOW the 1/α=20 bar on 2 of 4 seeds. This pin kills it.
  for (const seed of [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04]) {
    const { cal, live } = residPair(seed, { resource_id: 'room-0', delta: 1, start_tick: 0 });
    const t = escalationTier(SNAP, cal, live);
    const sibling = t.entries.find((e) => e.resource_id === 'room-1')!;
    assert.ok(sibling.e_value >= 20, `seed ${seed}: calibrated sibling E (${sibling.e_value.toExponential(2)}) must clear 1/α — the no-calibration mutant drops below on half the seeds`);
  }
});

test('guard (ADR-0064 cold-eye CRITICAL): a degradation naming a nonexistent resource THROWS — the silent no-op that fabricated the retracted correction', () => {
  assert.throws(
    () => generateTelemetry(SNAP, { seed: 1, ticks: 5, degradation: { resource_id: 'shuffle-panel-7', delta: 1, start_tick: 0 } }),
    /not in the snapshot/,
  );
});

test('AC-2: the sub-floor gain under the HONEST null — room Δ=0.5 escalates where the leaf layer is blind', () => {
  let leaf = 0;
  let tier = 0;
  for (const seed of [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04]) {
    const { cal, live } = residPair(seed, { resource_id: 'room-0', delta: 0.5, start_tick: 0 });
    if (leafLayerDetects(cal, live)) leaf += 1;
    const t = escalationTier(SNAP, cal, live);
    if (t.escalations.some((e) => e.neighborhood.includes('room-0'))) tier += 1;
  }
  assert.ok(tier >= 3, `escalation must catch the sub-floor room fault (got ${tier}/4; ADR-0049 probe: 4/4 under the wrong null)`);
  assert.ok(tier > leaf, `the tier must beat the leaf layer (tier ${tier}/4 vs leaf ${leaf}/4) — else the enhancement measures nothing`);
});

test('AC-3: the measured sibling confound is NEIGHBORHOOD SEMANTICS now — a firing room-1 aggregate names room-0', () => {
  const hoods = neighborhoods(SNAP);
  // the split pair-leaves belong to both rooms at w = ½ (material) ⇒ each room is in the
  // other's overlap union — the exact ADR-0049 confound, as claim granularity.
  assert.ok(hoods.get('room-1')!.includes('room-0'), 'room-1 neighborhood must name room-0');
  assert.ok(hoods.get('room-0')!.includes('room-1'), 'and vice versa');
  const { cal, live } = residPair(0xb0a01, { resource_id: 'room-0', delta: 1, start_tick: 0 });
  const t = escalationTier(SNAP, cal, live);
  const room1 = t.escalations.find((e) => e.resource_id === 'room-1');
  if (room1) assert.ok(room1.neighborhood.includes('room-0'), 'if the sibling fires, its entry points the drill at the true neighborhood');
  const room0 = t.escalations.find((e) => e.resource_id === 'room-0');
  assert.ok(room0, 'the true resource escalates at Δ=1');
  assert.equal('selected_path_class_ids' in t, false, 'the tier has NO selection surface (type-level, asserted for the record)');
});

test('AC-4: the published envelope recomputes (clean cell + the room Δ=0.5 floor) and .md ≡ renderMarkdown(.json)', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { computeTierEnvelope, renderMarkdown, residPair } = require('../tools/resource-eprocess');
  const rep = JSON.parse(readFileSync(join(__dirname, '..', 'coverage-matrices', 'resource-eprocess.json'), 'utf8'));
  // spot recompute: the first clean cell and the headline floor cell, exactly.
  const { cal, live } = residPair(SNAP, 0xb0a01);
  assert.equal(rep.clean.calibrated_escalations[0], escalationTier(SNAP, cal, live, { alpha: 0.05 }).escalations.length, 'first clean cell recomputes');
  const room = rep.floors.find((f: { target: string; delta: number }) => f.target === 'room-0' && f.delta === 0.5);
  assert.equal(room.leaf_detects, 0, 'the headline: leaf layer blind at room Δ=0.5 (as published)');
  assert.equal(room.tier_escalates, 4, 'the headline: tier 4/4 at room Δ=0.5 under the HONEST null (as published)');
  const md = readFileSync(join(__dirname, '..', 'coverage-matrices', 'resource-eprocess.md'), 'utf8');
  assert.equal(md, renderMarkdown(rep), 'published .md must equal renderMarkdown(published .json)');
});
