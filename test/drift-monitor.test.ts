/**
 * ADR-0053 — runtime drift monitor acceptance bar.
 *
 * Anti-self-confirming (DISCIPLINES §6): AC-2 (cliff detection) runs the exact ADR-0052
 * composed setup — a constant-'ok' mutant dies there; AC-5 chooses a threshold BELOW the
 * window's sampling floor so any data whatsoever must read 'indeterminate' — an ok-by-default
 * mutant dies there; AC-3 binds the session's running-sums path to the batch matrix path
 * bit-for-bit, so the two implementations cannot drift apart.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { generateTelemetry } from '../src/telemetry';
import { buildCalibration, standardizeAll } from '../src/calibration';
import { estimateDispersion } from '../src/dispersion-gate';
import { driftMonitor } from '../src/drift-monitor';
import { runPipeline, calibrateForSession } from '../src/pipeline';
import { openSession } from '../src/session';
import type { PathClassId } from '../src/domain';
import type { SignalVector } from '../src/signals';

const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
const TICKS = 60;

// ───────────────────────── AC-1: byte-identity + narrowing throws ─────────────────────────

test('AC-1: opting in adds ONLY drift_monitor; opting out is byte-identical; reroutes throw (batch + session)', async () => {
  // NB ticks 60, not 40: at T=40 the sampling floor (0.051) exceeds ς* = 0.05 and the monitor
  // correctly reads indeterminate — the resolvability rule, bound separately by AC-5.
  const base = { snapshot: SNAP, q: 0.05, telemetry: { seed: 7, ticks: TICKS } };
  const off = await runPipeline(base);
  const on = await runPipeline({ ...base, driftMonitor: true });
  assert.ok(on.drift_monitor, 'opted-in audit must carry the field');
  assert.equal(on.drift_monitor!.status, 'ok', 'clean synthetic run must read ok');
  const { drift_monitor: _m, ...rest } = on;
  assert.equal(JSON.stringify(rest), JSON.stringify(off), 'everything except the field must be byte-identical');
  assert.equal('drift_monitor' in off, false, 'opted-out audit must not carry the field');

  const reroute = [{ at_tick: 10, resource_id: 'optic-3', fraction: 0.5, seed: 1 }];
  await assert.rejects(() => runPipeline({ ...base, driftMonitor: true, reroutes: reroute }), /driftMonitor with reroutes/);
  const pre = calibrateForSession(SNAP, base.telemetry);
  assert.throws(
    () => openSession({ snapshot: SNAP, calibration: pre.calibration, q: 0.05, ctx: pre.ctx, driftMonitor: true, reroutes: reroute }),
    /driftMonitor with reroutes/,
  );
  // cold-eye finding 2: a 1-leaf session must THROW (parity with the batch estimator) — without
  // the guard, (n−1)=0 division makes sigma_hat_tail NaN and NaN-vs-threshold reads 'ok'.
  const oneLeaf = { ...SNAP, path_classes: [SNAP.path_classes[0]] };
  assert.throws(
    () => openSession({ snapshot: oneLeaf, calibration: pre.calibration, q: 0.05, ctx: pre.ctx, driftMonitor: true }),
    /needs ≥ 2 leaves/,
  );
});

// ───────────────────────── AC-2: the ADR-0052 cliff has a detector ─────────────────────────

test('AC-2: perLeafScale drift at the RECOMMENDED threshold — fresh ok, half/full drift drifted/fleet on every seed (kills the constant-ok mutant)', () => {
  // Regime-dependent threshold (ADR-0053 §2, measured): under perLeafScale, FRESH corrections
  // carry out-of-sample correction noise ≈ 0.03–0.06 in the live window (the same quantity the
  // ADR-0052 AC-3 out-of-sample bound covers), so the shared-calibration default ς* = 0.05 sits
  // on the fresh-noise edge. The measured separation on the FULL 8-seed envelope set — fresh
  // ≤ 0.0594 (NB: this test's 4-seed subset maxes at 0.0555; the bracket is quoted from the
  // envelope set, cold-eye finding 1), half-drift ≥ 0.081 (where false selections are already
  // 3.13/run), full drift ≈ 0.26 — puts the recommended perLeafScale operating threshold at
  // 0.07 (margin ≈ 0.011 on each side).
  const THR = 0.07;
  for (const seed of [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04]) {
    const calRaw = generateTelemetry(SNAP, { seed: seed ^ 0xca11b, ticks: TICKS, heterogeneity: { sigmaLogSd: 0.2, driftMix: 0 } });
    const sub = buildCalibration(calRaw.series, { robust: true, perLeafScale: true });
    const monitorAt = (m: number) => {
      const live = generateTelemetry(SNAP, { seed, ticks: TICKS, heterogeneity: { sigmaLogSd: 0.2, driftMix: m } });
      return driftMonitor(estimateDispersion(standardizeAll(live.series, sub)), THR);
    };
    const fresh = monitorAt(0);
    assert.equal(fresh.status, 'ok', `seed ${seed}: fresh corrections must read ok (got ${fresh.status}, ς̂ ${fresh.sigma_hat.toFixed(3)})`);
    const half = monitorAt(0.5);
    assert.equal(half.status, 'drifted', `seed ${seed}: half drift (3.13 false sel/run in ADR-0052) must be detected`);
    const stale = monitorAt(1);
    assert.equal(stale.status, 'drifted', `seed ${seed}: the ADR-0052 cliff must be DETECTED`);
    assert.equal(stale.pattern, 'fleet', `seed ${seed}: full-drift staleness is fleet-wide — the recalibrate-now signal`);
  }
});

// ───────────────────────── AC-3: session parity ─────────────────────────

test('AC-3: session running-sums monitor ≡ batch matrix monitor, bit-for-bit at the final tick (both an ok-status and an indeterminate-status window)', async () => {
  // T=60 (floor 0.041 < ς*: status 'ok') AND T=40 (floor 0.051 ≥ ς*: status 'indeterminate') —
  // so status parity is cross-path-tested in a resolvable window, not only derived (cold-eye
  // observation 6).
  for (const [ticks, expectStatus] of [[60, 'ok'], [40, 'indeterminate']] as const) {
    const telemetry = { seed: 11, ticks };
    const batch = await runPipeline({ snapshot: SNAP, q: 0.05, telemetry, driftMonitor: true });
    assert.equal(batch.drift_monitor!.status, expectStatus, `T=${ticks}: expected batch status ${expectStatus}`);
    const pre = calibrateForSession(SNAP, telemetry);
    const session = openSession({ snapshot: SNAP, calibration: pre.calibration, q: 0.05, ctx: pre.ctx, driftMonitor: true });
    const live = generateTelemetry(SNAP, telemetry);
    for (let t = 0; t < ticks; t++) {
      const tick = new Map<PathClassId, SignalVector>();
      for (const [pc, series] of live.series) tick.set(pc, series[t]);
      session.ingest(tick);
    }
    const sAudit = await session.audit();
    assert.deepEqual(sAudit.drift_monitor, batch.drift_monitor, `T=${ticks}: sums path ≡ matrix path, bit-for-bit`);
    assert.equal(JSON.stringify(sAudit.drift_monitor), JSON.stringify(batch.drift_monitor), `T=${ticks}: and byte-for-byte through JSON`);
  }
});

// ───────────────────────── AC-4: pattern honesty ─────────────────────────

test('AC-4: a SUBPOPULATION variance-mode fault (no drift) reads drifted/TAIL — the monitor does not cry recalibrate at a real fault', async () => {
  // Fixture note: on the full-spray DEFAULT fabric every resource touches most leaves (variance
  // mode is undiluted, ADR-0014), and a SINGLE-leaf single-signal fault moves neither statistic
  // (ℓ ≈ ln(3)/5 ≈ 0.22 on one leaf of 109 → tail ≈ 0.02 — correctly ignored: the monitor must
  // not withhold the fleet's claim for one faulty leaf). The tail pattern's home regime is a
  // SUBPOPULATION — here 2 of 20 leaves (10%) on a shared resource, the ADR-0051 contamination
  // shape arriving through a genuine fault.
  const t9 = (pc: string, r: string) => ({ path_class: pc, resource: r, relationship: 'traverses' as const });
  const pcs = Array.from({ length: 20 }, (_, i) => `pc-${String(i).padStart(2, '0')}`);
  const snap = {
    nodes: [],
    path_classes: pcs,
    edges: [...pcs.map((pc, i) => t9(pc, `r-own-${i}`)), t9('pc-00', 'r-hot'), t9('pc-01', 'r-hot')],
    resources: [...pcs.map((_, i) => ({ id: `r-own-${i}`, kind: 'optic' as const })), { id: 'r-hot', kind: 'shuffle_panel' as const }],
    fetched_at_ts: 0,
    source_id: 's',
    source_version: 'v',
  };
  const audit = await runPipeline({
    snapshot: snap,
    q: 0.05,
    telemetry: { seed: 5, ticks: TICKS, degradation: { resource_id: 'r-hot', delta: 4, start_tick: 0, mode: 'variance' } },
    driftMonitor: true,
  });
  assert.equal(audit.drift_monitor!.status, 'drifted', 'a subpopulation variance fault inflates live tail dispersion — the claim is rightly withheld');
  assert.equal(audit.drift_monitor!.pattern, 'tail', 'localized inflation must attribute to the TAIL, not fleet-wide staleness');
  assert.ok(audit.drift_monitor!.sigma_hat <= audit.drift_monitor!.threshold, 'the robust core must NOT fire on a localized fault');
});

// ───────────────────────── AC-6: published-envelope freshness ─────────────────────────

test('AC-6: the published envelope is FRESH (the cliff driftMix=1 cell recomputes exactly) and the .md is bound to the .json', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { renderMarkdown, PER_LEAF_SCALE_MONITOR_THRESHOLD } = require('../tools/drift-monitor');
  const { runNullRun } = require('../tools/heterogeneity');
  const rep = JSON.parse(readFileSync(join(__dirname, '..', 'coverage-matrices', 'drift-monitor.json'), 'utf8'));
  const cell = rep.cliff.find((c: { label: string }) => c.label === 'driftMix 1');
  assert.ok(cell, 'the driftMix 1 cliff cell must be published');
  const seeds = [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04, 0xb0a05, 0xb0a06, 0xb0a07, 0xb0a08];
  const het = { sigmaLogSd: 0.2, driftMix: 1 };
  const verdicts = seeds.map((seed) => {
    const calRaw = generateTelemetry(SNAP, { seed: seed ^ 0xca11b, ticks: TICKS, heterogeneity: { ...het, driftMix: 0 } });
    const sub = buildCalibration(calRaw.series, { robust: true, perLeafScale: true });
    const live = generateTelemetry(SNAP, { seed, ticks: TICKS, heterogeneity: het });
    return driftMonitor(estimateDispersion(standardizeAll(live.series, sub)), PER_LEAF_SCALE_MONITOR_THRESHOLD);
  });
  assert.equal(cell.drifted_rate, verdicts.filter((v) => v.status === 'drifted').length / verdicts.length, 'published drifted rate must recompute exactly');
  assert.equal(cell.mean_sigma_hat, verdicts.reduce((a, v) => a + v.sigma_hat, 0) / verdicts.length, 'published mean ς̂ must recompute exactly');
  assert.equal(cell.drifted_rate, 1, 'the cliff must be DETECTED (a constant-ok mutant publishes 0)');
  const falseSel = seeds.map((s) => runNullRun(SNAP, s, { heterogeneity: het, perLeafScale: true }).false_selections);
  assert.equal(cell.mean_false_selections, falseSel.reduce((a: number, b: number) => a + b, 0) / falseSel.length, 'published false-selection column must recompute exactly (the ADR-0052 cell)');
  const md = readFileSync(join(__dirname, '..', 'coverage-matrices', 'drift-monitor.md'), 'utf8');
  assert.equal(md, renderMarkdown(rep), 'published .md must equal renderMarkdown(published .json)');
});

// ───────────────────────── AC-5: resolvability honesty ─────────────────────────

test('AC-5: a threshold below the sampling floor reads indeterminate regardless of the data (kills the ok-by-default mutant); t<3 session is degenerate-indeterminate', async () => {
  // T=60, p=5 ⇒ floor ≈ 0.041: a threshold of 0.03 is unresolvable at this window.
  const audit = await runPipeline({ snapshot: SNAP, q: 0.05, telemetry: { seed: 7, ticks: TICKS }, driftMonitor: { threshold: 0.03 } });
  assert.equal(audit.drift_monitor!.status, 'indeterminate', 'an unresolvable window must never read ok');
  assert.equal(audit.drift_monitor!.pattern, null);

  const pre = calibrateForSession(SNAP, { seed: 7, ticks: TICKS });
  const session = openSession({ snapshot: SNAP, calibration: pre.calibration, q: 0.05, ctx: pre.ctx, driftMonitor: true });
  const early = await session.audit();
  assert.equal(early.drift_monitor!.status, 'indeterminate', 'a t<3 window has no variance estimate — indeterminate');
  assert.equal(early.drift_monitor!.sampling_floor_sd, 1, 'the degenerate sentinel floor is 1 (documented, JSON-safe)');
});
