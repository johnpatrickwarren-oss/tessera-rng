/**
 * ADR-0060 — FDR license rule acceptance bar.
 *
 * Anti-self-confirming (DISCIPLINES §6): the truth table covers every conjunct combination
 * (a constant-true license dies on the shared/absent/drifted rows; a constant-false one on
 * the licensed row); the e2e binds the pipeline threading (a perLeafScale flag that never
 * reached buildCalibration would leave the construction field unstamped and fail AC-3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { runPipeline, calibrateForSession } from '../src/pipeline';
import { openSession } from '../src/session';
import { fdrLicense } from '../src/license';
import { generateTelemetry } from '../src/telemetry';
import type { AuditRecord } from '../src/verdict';
import type { PathClassId } from '../src/domain';
import type { SignalVector } from '../src/signals';

const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
const TICKS = 60;

test('AC-2: the truth table — only per_leaf_scale + monitor-ok licenses; every refusal names its conjunct', () => {
  const monitor = (status: 'ok' | 'drifted' | 'indeterminate') => ({
    status,
    pattern: null,
    sigma_hat: 0,
    sigma_hat_tail: 0,
    threshold: 0.07,
    sampling_floor_sd: 0.01,
    ticks: 60,
    n_leaves: 109,
  });
  const audit = (fields: Partial<AuditRecord>): AuditRecord => ({ ...fields } as AuditRecord);

  const good = fdrLicense(audit({ calibration_construction: 'per_leaf_scale', drift_monitor: monitor('ok') }));
  assert.equal(good.licensed, true);
  assert.equal(good.reasons.length, 0);

  const shared = fdrLicense(audit({ drift_monitor: monitor('ok') }));
  assert.equal(shared.licensed, false);
  assert.ok(shared.reasons.some((r) => r.startsWith('construction:')), 'shared calibration must refuse on construction');

  const unmonitored = fdrLicense(audit({ calibration_construction: 'per_leaf_scale' }));
  assert.equal(unmonitored.licensed, false);
  assert.ok(unmonitored.reasons.some((r) => r.includes('no drift monitor')), 'an unmonitored window cannot license');

  for (const status of ['drifted', 'indeterminate'] as const) {
    const bad = fdrLicense(audit({ calibration_construction: 'per_leaf_scale', drift_monitor: monitor(status) }));
    assert.equal(bad.licensed, false, `${status} must refuse`);
    assert.ok(bad.reasons.some((r) => r.includes(status)), 'the refusal must name the monitor status');
  }

  const doubleBad = fdrLicense(audit({}));
  assert.equal(doubleBad.reasons.length, 2, 'both failing conjuncts are named');

  // the remaining construction×status combinations (cold-eye finding 9 — the full 8):
  for (const status of ['drifted', 'indeterminate'] as const) {
    const sharedBad = fdrLicense(audit({ drift_monitor: monitor(status) }));
    assert.equal(sharedBad.licensed, false);
    assert.equal(sharedBad.reasons.length, 2, `shared + ${status}: BOTH conjuncts named`);
  }
});

test('AC-1 + AC-3: e2e — perLeafScale + driftMonitor licenses on a clean fabric; each missing piece refuses; opt-out audits carry no field', async () => {
  const base = { snapshot: SNAP, q: 0.05, telemetry: { seed: 7, ticks: TICKS } };
  const full = await runPipeline({ ...base, perLeafScale: true, driftMonitor: true });
  assert.equal(full.calibration_construction, 'per_leaf_scale', 'the construction stamp must ride the substrate');
  assert.equal(fdrLicense(full).licensed, true, 'the measured-safe configuration must license');

  const sharedMonitored = await runPipeline({ ...base, driftMonitor: true });
  assert.equal('calibration_construction' in sharedMonitored, false, 'shared audits carry NO construction field (byte-identity encoding)');
  const refusedShared = fdrLicense(sharedMonitored);
  assert.equal(refusedShared.licensed, false);
  assert.ok(refusedShared.reasons.some((r) => r.startsWith('construction:')));

  const unmonitored = await runPipeline({ ...base, perLeafScale: true });
  assert.equal(fdrLicense(unmonitored).licensed, false, 'per-leaf without the monitor must refuse');

  const off = await runPipeline(base);
  assert.equal('calibration_construction' in off, false);
  assert.equal('drift_monitor' in off, false);
});

test('AC-4: session parity — a session over a perLeafScale substrate stamps the same construction; license agrees batch/session', async () => {
  const telemetry = { seed: 11, ticks: TICKS };
  const pre = calibrateForSession(SNAP, telemetry, undefined, false, true, false, true);
  assert.ok(pre.calibration.leafScale, 'precondition: the prelude built a per-leaf substrate');
  const batch = await runPipeline({ snapshot: SNAP, q: 0.05, telemetry, perLeafScale: true, driftMonitor: true });
  const session = openSession({ snapshot: SNAP, calibration: pre.calibration, q: 0.05, ctx: pre.ctx, driftMonitor: true });
  const live = generateTelemetry(SNAP, telemetry);
  for (let t = 0; t < telemetry.ticks; t++) {
    const tick = new Map<PathClassId, SignalVector>();
    for (const [pc, series] of live.series) tick.set(pc, series[t]);
    session.ingest(tick);
  }
  const sAudit = await session.audit();
  assert.equal(sAudit.calibration_construction, 'per_leaf_scale', 'the session derives the stamp from its substrate');
  assert.equal(fdrLicense(sAudit).licensed, fdrLicense(batch).licensed, 'license agrees batch/session');
});
