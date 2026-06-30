/**
 * ADR-0036 — contamination-robust common-mode removal, CONSUMED from the engine.
 *
 * Two layers of test: (1) the `stripCommonMode` primitive does what it claims (removes the robust
 * cross-leaf common-mode, leaves a concentrated outlier standing); (2) wired opt-in into the
 * pipeline it EXTENDS the cross-optic recovery band into the ADR-0034 high-δ regime, with no
 * in-band regression and clean FDR preserved — and is OFF by default (incremental≡batch holds).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripCommonMode } from '../src/common-mode';
import { runPipeline } from '../src/pipeline';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { buildSurface } from '../src/surface';
import { localize, DEFAULT_LOCALIZE } from '../src/tomography';
import type { PathClassId } from '../src/domain';

// ───────────────────────── the primitive ─────────────────────────

test('stripCommonMode removes the robust cross-leaf common-mode; a concentrated outlier survives', () => {
  // 5 leaves, 1 signal, 1 tick: four share a +3 common shift, one (the "fault") has +3 + 10 extra.
  const resid = new Map<PathClassId, number[][]>([
    ['a', [[3]]], ['b', [[3]]], ['c', [[3]]], ['d', [[3]]], ['fault', [[13]]],
  ]);
  const out = stripCommonMode(resid);
  for (const pc of ['a', 'b', 'c', 'd']) assert.ok(Math.abs(out.get(pc)![0][0]) < 1e-9, `${pc}: shared shift removed ⇒ ≈0`);
  assert.ok(out.get('fault')![0][0] > 9, 'the concentrated outlier keeps its differential signal');
  // pure: input untouched
  assert.equal(resid.get('a')![0][0], 3, 'input map is not mutated');
});

test('stripCommonMode is a no-op on already-centered residuals (clean fleet ⇒ ≈ unchanged)', () => {
  const resid = new Map<PathClassId, number[][]>([['a', [[1], [-1]]], ['b', [[-1], [1]]], ['c', [[0], [0]]]]);
  const out = stripCommonMode(resid);
  // robust location of a symmetric column ≈ 0, so values barely move
  for (const pc of ['a', 'b', 'c']) for (let t = 0; t < 2; t++) assert.ok(Math.abs(out.get(pc)![t][0] - resid.get(pc)![t][0]) < 0.5);
});

// ───────────────────────── wired into the pipeline (the consumption payoff) ─────────────────────────

const CROSS = generateSpraypointFabric(DEFAULT_SPRAYPOINT); // cross-optic default (ADR-0035)
const top2 = (cs: readonly { resource_id: string }[]): string[] => cs.slice(0, 2).map((c) => c.resource_id);
const both = (t: string[]): boolean => t.includes('optic-3') && t.includes('panel-7');

async function recovers(delta: number, seed: number, commonModeRobust: boolean): Promise<boolean> {
  const a = await runPipeline({ snapshot: CROSS, q: 0.05, commonModeRobust, telemetry: { seed, ticks: 60, degradations: [
    { resource_id: 'optic-3', delta, start_tick: 0 }, { resource_id: 'panel-7', delta, start_tick: 0 },
  ] } });
  return both(top2(a.culprits));
}

test('ADR-0036 payoff: the engine common-mode EXTENDS cross-optic recovery into the high-δ band (δ=16)', async () => {
  // δ=16 is the decisive case: the base pipeline NEVER recovers (the ADR-0034 saturation), and the
  // engine common-mode recovers it every seed. (δ=8 is the borderline — base already recovers some;
  // δ=32 still fails both, the remaining extreme limit common-mode does not reach — see below.)
  let off = 0;
  let on = 0;
  for (const seed of [1, 2, 3, 4]) {
    if (await recovers(16, seed, false)) off += 1;
    if (await recovers(16, seed, true)) on += 1;
  }
  assert.equal(off, 0, 'δ=16: WITHOUT common-mode, the ADR-0034 saturation holds (0/4)');
  assert.equal(on, 4, 'δ=16: WITH the engine common-mode, the cross-kind optic recovers (4/4)');
});

test('RECORDED: common-mode pushes the boundary to ≈δ16 but does NOT reach the δ32 extreme (still bounded)', async () => {
  // Honest boundary: the engine common-mode extends recovery from ≈δ6 to ≈δ16, not to infinity. At
  // δ=32 a fault this catastrophic overwhelms even the robust common-mode (and e-values overflow,
  // ADR-0034) — both ON and OFF fail. The bounded limit moved up; it did not vanish.
  assert.equal(await recovers(32, 1, false), false, 'δ=32 OFF fails (control)');
  assert.equal(await recovers(32, 1, true), false, 'δ=32 ON also fails — boundary moved to ≈δ16, not removed');
});

test('no in-band regression: δ=4 still recovers with common-mode on; clean fabric still selects nothing', async () => {
  assert.ok(await recovers(4, 1, true), 'in-band recovery preserved under common-mode removal');
  // clean fabric (no fault): common-mode removal must not manufacture false selections.
  const clean = await runPipeline({ snapshot: CROSS, q: 0.05, commonModeRobust: true, telemetry: { seed: 7, ticks: 60 } });
  assert.equal(clean.selected_path_class_ids.length, 0, 'clean fleet: no false positives under common-mode removal');
});

test('WHY NOT DEFAULT (ADR-0038): common-mode strips a BROAD fault\'s own signal — a room fault mislocalizes', async () => {
  // Pins the cutover-rejection evidence in the committed tree (the cold-eye noted the floor table was
  // ADR-only testimony). A broad room fault shifts every leaf in the room together — that shared shift
  // IS the cross-leaf common-mode, so stripping it deletes the fault's own signal. OFF localizes room-0
  // correctly; ON does NOT — exactly why common-mode is a tradeoff, kept opt-in, never defaulted.
  // pinned to the pre-robust mean/sd null (robustCalibration:false) — demonstrates the COMMON-MODE
  // tradeoff under the calibration it was measured on; robust calibration shifts the specific room
  // outcome (a separate interaction, not what this test is about).
  const mk = (cm: boolean) => ({ snapshot: CROSS, q: 0.05, commonModeRobust: cm, robustCalibration: false, telemetry: { seed: 1, ticks: 60, degradation: { resource_id: 'room-0', delta: 3, start_tick: 0 } } });
  const off = await runPipeline(mk(false));
  const on = await runPipeline(mk(true));
  assert.equal(off.culprits[0]?.resource_id, 'room-0', 'OFF: the broad room fault localizes correctly');
  assert.notEqual(on.culprits[0]?.resource_id, 'room-0', 'ON: common-mode strips the broad fault ⇒ it does NOT localize to room-0 (the rejection)');
});

test('RE-OPEN (ADR-0041): under ROBUST calibration too, common-mode default-ON breaks broad-fault attribution — opt-in reaffirmed', async () => {
  // ADR-0038 kept common-mode opt-in because it broke broad faults (room-0→room-1) under the mean/sd
  // null. The robust-default null (ADR-0039) changed that SPECIFIC mislocalization, so the re-open
  // asked: is common-mode now safe to default? The full coverage sweep said NO — across floor δ it
  // still loses broad-fault attribution. Pinned: a room fault at its floor δ, robust calibration (the
  // DEFAULT here — no robustCalibration:false), attributes every seed with common-mode OFF and NONE ON.
  const mk = (cm: boolean, seed: number) => ({ snapshot: CROSS, q: 0.05, commonModeRobust: cm, telemetry: { seed, ticks: 60, degradation: { resource_id: 'room-0', delta: 4, start_tick: 0 } } });
  let off = 0;
  let on = 0;
  for (const seed of [1, 2, 3]) {
    if ((await runPipeline(mk(false, seed))).culprits[0]?.resource_id === 'room-0') off += 1;
    if ((await runPipeline(mk(true, seed))).culprits[0]?.resource_id === 'room-0') on += 1;
  }
  assert.equal(off, 3, 'robust calibration, common-mode OFF: the room fault attributes every seed');
  assert.equal(on, 0, 'robust calibration, common-mode ON: room attribution lost — common-mode stays opt-in even under a robust null');
});

test('OFF by default: a default run is byte-identical with/without the (false) flag — incremental≡batch unaffected', async () => {
  const params = { snapshot: CROSS, q: 0.05, telemetry: { seed: 1, ticks: 60, degradation: { resource_id: 'optic-3', delta: 4, start_tick: 0 } } };
  const implicit = await runPipeline(params);
  const explicitOff = await runPipeline({ ...params, commonModeRobust: false });
  assert.equal(JSON.stringify(implicit), JSON.stringify(explicitOff), 'default ≡ explicit-off — the flag is opt-in, the default path is untouched');
});
