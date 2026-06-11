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
import { runPipeline } from '../src/pipeline';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { generateTelemetry } from '../src/telemetry';
import { buildCalibration, standardizeAll } from '../src/calibration';
import { estimateBaselineCovariance, makeFamilyCCellFromCovariance } from '../src/family-c';
import { estimateFamilyDNull } from '../src/family-d';
import { DEFAULT_DETECT } from '../src/detect';
import { makeEpochs } from '../src/epoch';
import type { PipelineParams } from '../src/pipeline';
import type { SignalVector } from '../src/signals';
import type { PathClassId } from '../src/domain';

const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);

/** Replicate runPipeline's prelude exactly: calibration substrate + detector context. */
function prelude(telemetry: PipelineParams['telemetry']) {
  const calibRaw = generateTelemetry(SNAP, { seed: telemetry.seed ^ 0xca11b, ticks: telemetry.ticks });
  const calibration = buildCalibration(calibRaw.series);
  const calibResiduals = standardizeAll(calibRaw.series, calibration);
  const familyCCell = makeFamilyCCellFromCovariance(estimateBaselineCovariance(calibResiduals).sigma, DEFAULT_DETECT.alphaC);
  const familyDCells = estimateFamilyDNull(calibResiduals);
  return { calibration, ctx: { familyCCell, familyDCells } };
}

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
