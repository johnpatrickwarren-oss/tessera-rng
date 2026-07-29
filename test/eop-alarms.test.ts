/**
 * ADR-0062 — anytime alarms acceptance bar.
 *
 * Anti-self-confirming (DISCIPLINES §6): the threshold is bound two ways — a threshold-1
 * mutant alarms MOST leaves on clean data within the window (measured: 78/109, 33 at tick 0)
 * and dies on the clean-count assertion (a MUTANT-KILLER pin, not the statistical bound —
 * the guaranteed quantity is the pooled ever-alarm fraction ≤ α, asserted separately); a
 * scope-blind mutant dies on the exact fleet-threshold pin. The
 * first-crossing tick is bound by tick-by-tick REPLAY (audit after every ingest — the alarm
 * must appear exactly at its recorded tick, not before, and stay immutable after), not by
 * reimplementing the wealth path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { generateTelemetry } from '../src/telemetry';
import { calibrateForSession } from '../src/pipeline';
import { runPipeline } from '../src/pipeline';
import { openSession } from '../src/session';
import type { SessionParams } from '../src/session';
import type { PathClassId } from '../src/domain';
import type { SignalVector } from '../src/signals';

const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
const TICKS = 60;
const N = SNAP.path_classes.length;

function stream(params: Omit<SessionParams, 'snapshot' | 'calibration' | 'q' | 'ctx'>, seed: number, degradation?: { resource_id: string; delta: number; start_tick: number }) {
  const telemetry = { seed, ticks: TICKS };
  const pre = calibrateForSession(SNAP, telemetry);
  const session = openSession({ snapshot: SNAP, calibration: pre.calibration, q: 0.05, ctx: pre.ctx, ...params });
  const live = generateTelemetry(SNAP, { ...telemetry, ...(degradation ? { degradation } : {}) });
  return { session, live };
}

function ingestAll(s: ReturnType<typeof stream>): void {
  for (let t = 0; t < TICKS; t++) {
    const tick = new Map<PathClassId, SignalVector>();
    for (const [pc, series] of s.live.series) tick.set(pc, series[t]);
    s.session.ingest(tick);
  }
}

test('AC-1: opt-in adds ONLY eop_alarms (stamped even when quiet); batch never stamps; reroutes/bad-alpha throw', async () => {
  const off = stream({}, 7);
  ingestAll(off);
  const offAudit = off.session.audit();
  assert.equal('eop_alarms' in offAudit, false, 'opt-out audits carry no field');

  const on = stream({ eopAlarms: {} }, 7);
  ingestAll(on);
  const onAudit = on.session.audit();
  assert.ok(onAudit.eop_alarms, 'opted-in audit carries the field even when quiet');
  assert.equal(onAudit.eop_alarms!.alpha, 0.05);
  assert.equal(onAudit.eop_alarms!.threshold, 1 / 0.05, 'per-leaf threshold is 1/α');
  const { eop_alarms: _e, ...rest } = onAudit;
  assert.equal(JSON.stringify(rest), JSON.stringify(offAudit), 'everything except the field is byte-identical');

  const batch = await runPipeline({ snapshot: SNAP, q: 0.05, telemetry: { seed: 7, ticks: TICKS } });
  assert.equal('eop_alarms' in batch, false, 'the batch pipeline never stamps alarms (session-only semantics)');

  const pre = calibrateForSession(SNAP, { seed: 7, ticks: TICKS });
  assert.throws(
    () => openSession({ snapshot: SNAP, calibration: pre.calibration, q: 0.05, ctx: pre.ctx, eopAlarms: {}, reroutes: [{ at_tick: 10, resource_id: 'optic-3', fraction: 0.5, seed: 1 }] }),
    /eopAlarms with reroutes/,
  );
  assert.throws(() => openSession({ snapshot: SNAP, calibration: pre.calibration, q: 0.05, ctx: pre.ctx, eopAlarms: { alpha: 1 } }), /alpha must be/);
  assert.throws(
    () => openSession({ snapshot: SNAP, calibration: pre.calibration, q: 0.05, ctx: pre.ctx, eopAlarms: {}, commonModeRobust: true }),
    /eopAlarms with commonModeRobust/,
  );
});

test('AC-2: clean-fleet alarm counts respect the Ville bound (kills the threshold-1 mutant); the fleet scope pins n/α exactly', () => {
  let total = 0;
  for (const seed of [0xb0a01, 0xb0a02, 0xb0a03]) {
    const s = stream({ eopAlarms: {} }, seed);
    ingestAll(s);
    const alarms = s.session.audit().eop_alarms!.alarms;
    total += alarms.length;
    // MUTANT-KILLER pin (not the statistical bound — per-seed counts fluctuate binomially and
    // may legitimately exceed ⌈N·α⌉ on some seed; the guaranteed quantity is the pooled
    // fraction below): a threshold-1 mutant alarms 78/109 clean leaves and dies here.
    assert.ok(alarms.length <= Math.ceil(N * 0.05), `seed ${seed}: clean alarms (${alarms.length}) — mutant-killer pin on these fixed seeds`);
  }
  // the GUARANTEED quantity: pooled ever-alarm fraction across null leaf-streams ≤ α.
  assert.ok(total / (3 * N) <= 0.05, `pooled clean ever-alarm fraction ${(total / (3 * N)).toFixed(4)} must be ≤ α`);
  const fleet = stream({ eopAlarms: { scope: 'fleet' } }, 0xb0a01);
  ingestAll(fleet);
  const f = fleet.session.audit().eop_alarms!;
  assert.equal(f.threshold, N / 0.05, 'fleet scope must divide the level by n (a scope-blind mutant pins 1/α)');
  assert.equal(f.alarms.length, 0, 'clean fleet at the Bonferroni threshold must be silent');
});

test('AC-3/AC-4: the published envelope recomputes (clean count + faulted first-alarm tick) and .md ≡ renderMarkdown(.json)', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { runSession, renderMarkdown } = require('../tools/eop-alarms');
  const rep = JSON.parse(readFileSync(join(__dirname, '..', 'coverage-matrices', 'eop-alarms.json'), 'utf8'));
  const clean = rep.clean.find((c: { scope: string }) => c.scope === 'per-leaf');
  assert.equal(clean.alarm_counts[0], runSession(0xb0a01, 'per-leaf').alarms.length, 'the first clean cell must recompute exactly');
  assert.ok(clean.pooled_ever_alarm_fraction <= clean.guaranteed_bound, `published pooled fraction ${clean.pooled_ever_alarm_fraction} must be ≤ the guaranteed bound ${clean.guaranteed_bound}`);
  assert.equal(clean.pooled_ever_alarm_fraction, clean.alarm_counts.reduce((a: number, b: number) => a + b, 0) / (8 * 109), 'the published pooled fraction must equal its own counts');
  const fleet = rep.clean.find((c: { scope: string }) => c.scope === 'fleet');
  assert.ok(fleet.alarm_counts.every((c: number) => c === 0), 'the fleet scope is silent on clean data');
  const f = rep.faulted[0];
  const recomputed = runSession(0xb0a01, 'per-leaf', { resource_id: f.target, delta: 3, start_tick: 0 }).alarms.find((a: { path_class_id: string }) => a.path_class_id === f.leaf)?.at_tick ?? null;
  assert.equal(f.first_alarm_ticks[0], recomputed, 'the faulted first-alarm tick must recompute exactly');
  assert.ok(rep.faulted.every((x: { alarmed: number; n: number }) => x.alarmed === x.n), 'every faulted leaf alarmed (as published)');
  const md = readFileSync(join(__dirname, '..', 'coverage-matrices', 'eop-alarms.md'), 'utf8');
  assert.equal(md, renderMarkdown(rep), 'published .md must equal renderMarkdown(published .json)');
});

test('AC-2: first crossing is recorded at the exact tick, once, immutably (tick-by-tick replay bind)', () => {
  const fault = { resource_id: 'optic-3', delta: 3, start_tick: 0 };
  const s = stream({ eopAlarms: {} }, 5, fault);
  const seen = new Map<PathClassId, number>();
  for (let t = 0; t < TICKS; t++) {
    const tick = new Map<PathClassId, SignalVector>();
    for (const [pc, series] of s.live.series) tick.set(pc, series[t]);
    s.session.ingest(tick);
    for (const a of s.session.audit().eop_alarms!.alarms) {
      if (!seen.has(a.path_class_id)) {
        assert.equal(a.at_tick, t, `${a.path_class_id}: an alarm must first APPEAR at its recorded tick (recorded ${a.at_tick}, appeared after ingest ${t})`);
        seen.set(a.path_class_id, a.at_tick);
      } else {
        assert.equal(a.at_tick, seen.get(a.path_class_id), `${a.path_class_id}: the recorded tick is immutable`);
      }
    }
  }
  assert.ok(seen.has('tor-3'), 'the faulted leaf must alarm within the window');
  assert.ok(seen.get('tor-3')! < TICKS - 1, 'and strictly before the window end — the anytime win');
});