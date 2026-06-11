/**
 * Incremental session (ADR-0027). The keystone bind: incremental ≡ batch, BYTE-FOR-BYTE — the
 * session ingesting the batch pipeline's exact live telemetry tick-by-tick must reproduce
 * runPipeline's audit at the final tick, for a single fault, a multi-fault run, and an epoch'd
 * reroute run. Anytime behavior is bound separately (the clean every-tick profile is pinned
 * HONESTLY — a brief transient is what per-query FDR permits, "never selects" would overclaim;
 * a fault localizes at a recorded tick well before the batch window ends).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSession } from '../src/session';
import { runPipeline, calibrateForSession } from '../src/pipeline';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { generateTelemetry } from '../src/telemetry';
import { makeEpochs } from '../src/epoch';
import type { PipelineParams } from '../src/pipeline';
import type { SignalVector } from '../src/signals';
import type { PathClassId } from '../src/domain';

const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);

/** The SHARED calibration prelude (ADR-0027 P4) — the same function runPipeline uses, so a real
 *  "calibrate offline, stream live" caller needs no pipeline internals. */
const prelude = (telemetry: PipelineParams['telemetry']) => calibrateForSession(SNAP, telemetry);

/** Feed the batch live telemetry to a session tick-by-tick. */
function streamInto(session: ReturnType<typeof openSession>, params: PipelineParams): void {
  const epochs = params.reroutes?.length ? makeEpochs(SNAP, params.reroutes) : undefined;
  const live = generateTelemetry(SNAP, { ...params.telemetry, ...(epochs ? { epochs } : {}) });
  for (let t = 0; t < params.telemetry.ticks; t++) {
    const tick = new Map<PathClassId, SignalVector>();
    for (const [pc, series] of live.series) tick.set(pc, series[t]);
    session.ingest(tick);
  }
}

async function assertEquivalence(params: PipelineParams): Promise<void> {
  const batch = await runPipeline(params);
  const { calibration, ctx } = prelude(params.telemetry);
  const session = openSession({ snapshot: SNAP, calibration, q: params.q, ctx, reroutes: params.reroutes, drain_top_k: params.drain_top_k });
  streamInto(session, params);
  assert.equal(JSON.stringify(session.audit()), JSON.stringify(batch), 'incremental ≡ batch, byte-for-byte');
}

test('KEYSTONE (ADR-0027): incremental ≡ batch byte-for-byte — single fault', async () => {
  await assertEquivalence({ snapshot: SNAP, q: 0.05, telemetry: { seed: 1, ticks: 60, degradation: { resource_id: 'optic-3', delta: 4, start_tick: 0 } } });
});

test('KEYSTONE (ADR-0027): incremental ≡ batch byte-for-byte — simultaneous multi-fault', async () => {
  await assertEquivalence({
    snapshot: SNAP,
    q: 0.05,
    drain_top_k: 2,
    telemetry: { seed: 1, ticks: 60, degradations: [
      { resource_id: 'optic-3', delta: 4, start_tick: 0 },
      { resource_id: 'panel-7', delta: 4, start_tick: 0 },
    ] },
  });
});

test('KEYSTONE (ADR-0027): incremental ≡ batch byte-for-byte — epoch\'d reroute run (resets included)', async () => {
  await assertEquivalence({
    snapshot: SNAP,
    q: 0.05,
    telemetry: { seed: 1, ticks: 60, degradation: { resource_id: 'optic-3', delta: 4, start_tick: 0 } },
    reroutes: [{ at_tick: 40, resource_id: 'optic-3', fraction: 1, seed: 5 }],
  });
});

test('ANYTIME on clean: per-query FDR shows as a brief deterministic transient, never persistence (honest profile)', () => {
  // Querying every tick is 60 dependent looks; each look's e-BH is individually FDR-valid, but
  // "never selects on clean" is STRONGER than the q=0.05 guarantee — and false on this fixed
  // seed: one leaf (tor-30) crosses the bar transiently at ticks 9–11 on a 9-tick prefix and
  // decays. Pinning the OBSERVED profile (not seed-shopping it away): exactly that transient,
  // at most one leaf per look, and a clean final audit (matching the batch run on this seed).
  const telemetry = { seed: 3, ticks: 60 };
  const { calibration, ctx } = prelude(telemetry);
  const session = openSession({ snapshot: SNAP, calibration, q: 0.05, ctx });
  const live = generateTelemetry(SNAP, telemetry);
  const transientTicks: number[] = [];
  for (let t = 0; t < telemetry.ticks; t++) {
    const tick = new Map<PathClassId, SignalVector>();
    for (const [pc, series] of live.series) tick.set(pc, series[t]);
    session.ingest(tick);
    const sel = session.audit().selected_path_class_ids;
    assert.ok(sel.length <= 1, `at most one transient leaf per look (tick ${t + 1}: ${sel.length})`);
    if (sel.length) {
      transientTicks.push(t + 1);
      assert.deepEqual(sel, ['tor-30'], 'the observed transient, pinned');
    }
  }
  assert.deepEqual(transientTicks, [9, 10, 11], 'the transient is brief and decays — it does not persist');
  assert.equal(session.audit().selected_path_class_ids.length, 0, 'the final audit is clean');
});

test('ANYTIME: the culprit is rank-1 at a recorded tick WELL BEFORE the batch window ends', () => {
  const telemetry = { seed: 1, ticks: 60, degradation: { resource_id: 'optic-3', delta: 4, start_tick: 0 } };
  const { calibration, ctx } = prelude(telemetry);
  const session = openSession({ snapshot: SNAP, calibration, q: 0.05, ctx });
  const live = generateTelemetry(SNAP, telemetry);
  let firstLocalized: number | null = null;
  for (let t = 0; t < telemetry.ticks; t++) {
    const tick = new Map<PathClassId, SignalVector>();
    for (const [pc, series] of live.series) tick.set(pc, series[t]);
    session.ingest(tick);
    if (firstLocalized === null && session.audit().culprits[0]?.resource_id === 'optic-3') firstLocalized = t + 1;
  }
  assert.ok(firstLocalized !== null && firstLocalized <= 40, `anytime detection beats the batch wait (localized at tick ${firstLocalized})`);
});

test('KEYSTONE (ADR-0027): incremental ≡ batch — Family D firing (600-tick oscillation, many windows + wealth cap path)', async () => {
  await assertEquivalence({
    snapshot: SNAP,
    q: 0.05,
    telemetry: { seed: 2, ticks: 600, degradation: { resource_id: 'panel-2', delta: 0, start_tick: 0, signal: 'p99_latency', oscillationPeriod: 7, oscillationAmp: 0.9 } },
  });
});

test('KEYSTONE (ADR-0027): incremental ≡ batch — AR(2) telemetry (multi-lag buffer + shift trimming)', async () => {
  await assertEquivalence({
    snapshot: SNAP,
    q: 0.05,
    telemetry: { seed: 1, ticks: 60, arCoeffs: [[0.5, 0.3], [0.4, 0.2], [0.6], [0.3, 0.2], [0.45]], degradation: { resource_id: 'optic-3', delta: 4, start_tick: 0 } },
  });
});

test('KEYSTONE (ADR-0027): incremental ≡ batch — TWO reroute events (multi-epoch segmentation)', async () => {
  await assertEquivalence({
    snapshot: SNAP,
    q: 0.05,
    telemetry: { seed: 1, ticks: 60, degradation: { resource_id: 'optic-3', delta: 4, start_tick: 0 } },
    reroutes: [
      { at_tick: 20, resource_id: 'optic-3', fraction: 1, seed: 5 },
      { at_tick: 40, resource_id: 'panel-7', fraction: 0.5, seed: 6 },
    ],
  });
});

test('a returned audit is a SNAPSHOT — later ingests never mutate it (round-8 cold-eye C1)', () => {
  const params: PipelineParams = {
    snapshot: SNAP, q: 0.05,
    telemetry: { seed: 1, ticks: 60, degradation: { resource_id: 'optic-3', delta: 4, start_tick: 0 } },
    reroutes: [{ at_tick: 20, resource_id: 'optic-3', fraction: 1, seed: 5 }, { at_tick: 40, resource_id: 'panel-7', fraction: 0.5, seed: 6 }],
  };
  const { calibration, ctx } = prelude(params.telemetry);
  const session = openSession({ snapshot: SNAP, calibration, q: params.q, ctx, reroutes: params.reroutes });
  const live = generateTelemetry(SNAP, { ...params.telemetry, epochs: makeEpochs(SNAP, params.reroutes!) });
  let mid: string | null = null;
  let midAudit: ReturnType<typeof session.audit> | null = null;
  for (let t = 0; t < 60; t++) {
    const tick = new Map<PathClassId, SignalVector>();
    for (const [pc, series] of live.series) tick.set(pc, series[t]);
    session.ingest(tick);
    if (t + 1 === 25) { midAudit = session.audit(); mid = JSON.stringify(midAudit); }
  }
  assert.equal(JSON.stringify(midAudit), mid, 'the tick-25 audit is byte-stable after 35 more ingests (incl. the tick-40 resets)');
});

test('a thrown (partial-tick) ingest leaves the session UNTOUCHED — retry produces batch equality (round-8 cold-eye C2)', async () => {
  const params: PipelineParams = {
    snapshot: SNAP, q: 0.05,
    telemetry: { seed: 1, ticks: 60, degradation: { resource_id: 'optic-3', delta: 4, start_tick: 0 } },
    reroutes: [{ at_tick: 40, resource_id: 'optic-3', fraction: 1, seed: 5 }],
  };
  const batch = await runPipeline(params);
  const { calibration, ctx } = prelude(params.telemetry);
  const session = openSession({ snapshot: SNAP, calibration, q: params.q, ctx, reroutes: params.reroutes });
  const live = generateTelemetry(SNAP, { ...params.telemetry, epochs: makeEpochs(SNAP, params.reroutes!) });
  for (let t = 0; t < 60; t++) {
    const tick = new Map<PathClassId, SignalVector>();
    for (const [pc, series] of live.series) tick.set(pc, series[t]);
    if (t === 40) {
      // a partial tick exactly at the reset boundary: before the fix, leaves ahead of the
      // missing one were updated AND reset twice — duplicated resets, phantom segments.
      const partial = new Map(tick);
      partial.delete('tor-9');
      assert.throws(() => session.ingest(partial), /full tick/);
    }
    session.ingest(tick);
  }
  assert.equal(JSON.stringify(session.audit()), JSON.stringify(batch), 'retry-after-throw is corruption-free');
});

test('openSession validates reroutes — a fractional at_tick can never silently skip its reset (round-8 cold-eye C3)', () => {
  const telemetry = { seed: 3, ticks: 10 };
  const { calibration, ctx } = prelude(telemetry);
  for (const at_tick of [39.5, 0, -3]) {
    assert.throws(
      () => openSession({ snapshot: SNAP, calibration, q: 0.05, ctx, reroutes: [{ at_tick, resource_id: 'optic-3', fraction: 1, seed: 5 }] }),
      /positive integer/,
      `at_tick ${at_tick} must be rejected by the SESSION's own validation (not deferred to a different downstream error)`,
    );
  }
});

test('a mid-stream audit reports only the epochs ACTIVE so far — never future routing (round-8 cold-eye L2); t=0 audit is clean', () => {
  const telemetry = { seed: 3, ticks: 30 };
  const { calibration, ctx } = prelude(telemetry);
  const session = openSession({ snapshot: SNAP, calibration, q: 0.05, ctx, reroutes: [{ at_tick: 20, resource_id: 'optic-3', fraction: 1, seed: 5 }] });
  const pre = session.audit(); // before ANY ingest (cold-eye L3): no crash, clean, epoch 0 only
  assert.equal(pre.selected_path_class_ids.length, 0);
  assert.equal(pre.epochs!.length, 1, 'only epoch 0 is active before the boundary');
  const live = generateTelemetry(SNAP, telemetry);
  for (let t = 0; t < 25; t++) {
    const tick = new Map<PathClassId, SignalVector>();
    for (const [pc, series] of live.series) tick.set(pc, series[t]);
    session.ingest(tick);
    if (t + 1 === 19) assert.equal(session.audit().epochs!.length, 1, 'still pre-boundary at tick 19');
    if (t + 1 === 21) assert.equal(session.audit().epochs!.length, 2, 'the boundary activates at its tick');
  }
});

test('ingest rejects a partial tick (full-tick contract, recorded narrowing)', () => {
  const telemetry = { seed: 3, ticks: 10 };
  const { calibration, ctx } = prelude(telemetry);
  const session = openSession({ snapshot: SNAP, calibration, q: 0.05, ctx });
  assert.throws(() => session.ingest(new Map([['tor-0', SNAP.path_classes.map(() => 0) as unknown as SignalVector]])), /full tick/);
});

test('with ALL Family D signals disabled (null cells), the D row is a silent no-op — e=1, never fired (mutation gap)', () => {
  // estimateFamilyDNull can disable every signal (short calibration / degenerate nulls); the
  // session's D fallback must mirror runFamilyD's {e:1, fired:false} no-op exactly.
  const telemetry = { seed: 3, ticks: 5 };
  const { calibration, ctx } = prelude(telemetry);
  const session = openSession({ snapshot: SNAP, calibration, q: 0.05, ctx: { ...ctx, familyDCells: [null, null, null, null, null] } });
  const live = generateTelemetry(SNAP, telemetry);
  for (let t = 0; t < telemetry.ticks; t++) {
    const tick = new Map<PathClassId, SignalVector>();
    for (const [pc, series] of live.series) tick.set(pc, series[t]);
    session.ingest(tick);
  }
  const v = session.audit().verdicts[0];
  const d = v.detectors.find((x) => x.family === 'D')!;
  assert.equal(d.e_value, 1);
  assert.equal(d.fired, false, 'no calibrated signal ⇒ the D family can never fire');
  assert.equal(d.alpha_spent, 0);
});
