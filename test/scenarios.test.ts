import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, runAllScenarios, SCENARIO_NAMES } from '../tools/scenarios';

test('there are exactly the six required scenarios', () => {
  assert.equal(SCENARIO_NAMES.length, 6);
});

test('clean baseline and FDR-control select nothing (FDR control holds)', async () => {
  for (const name of ['clean-baseline', 'fdr-control'] as const) {
    const r = await runScenario(name);
    assert.equal(r.audit.selected_path_class_ids.length, 0, `${name} should select nothing`);
    assert.equal(r.audit.culprits.length, 0);
    assert.equal(r.audit.drain_actions.length, 0);
  }
});

test('each common-mode scenario localizes to the injected resource as rank-1 culprit', async () => {
  for (const name of ['single-optic-degradation', 'shuffle-device-common-mode', 'fiber-bundle-common-mode', 'topology-spanning-common-mode'] as const) {
    const r = await runScenario(name);
    assert.ok(r.audit.selected_path_class_ids.length > 0, `${name} should detect firing path-classes`);
    assert.equal(r.audit.culprits[0].resource_id, r.injected_resource_id, `${name} rank-1 culprit should be the injected resource`);
    assert.equal(r.audit.culprits[0].resource_kind, r.injected_kind);
    assert.equal(r.audit.culprits[0].correlational_not_causal, true);
    assert.equal(r.audit.drain_actions[0].resource_id, r.injected_resource_id);
    assert.equal(r.audit.drain_actions[0].simulated, true);
  }
});

test('scenarios are replay-clean (same name -> byte-identical audit)', async () => {
  const a = await runScenario('shuffle-device-common-mode');
  const b = await runScenario('shuffle-device-common-mode');
  assert.equal(JSON.stringify(a.audit), JSON.stringify(b.audit));
});

test('runAllScenarios returns all six', async () => {
  assert.equal((await runAllScenarios()).length, 6);
});
