import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../tools/build-demo';
import { runAllScenarios, SCENARIO_NAMES } from '../tools/scenarios';

test('the single-file demo embeds all eight scenarios and the key surfaces (AC-8 + ADR-0012)', async () => {
  const html = render(await runAllScenarios());

  // self-contained single file: a document with a scenario selector, no external asset refs.
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<select id="sel">/);
  assert.ok(!/src=["']https?:/.test(html) && !/<link/.test(html), 'must be self-contained (no external assets)');

  // all eight scenarios are pageable — including the two post-v1 mode scenarios.
  assert.equal(SCENARIO_NAMES.length, 8);
  for (const name of SCENARIO_NAMES) assert.ok(html.includes(name), `demo must include scenario ${name}`);
  assert.ok(html.includes('covariance-flip-common-mode') && html.includes('oscillation-common-mode'), 'the new C/D mode scenarios must be present');

  // the honest/required surfaces are rendered, including firing-mode attribution (ADR-0010/0012).
  assert.match(html, /correlational, not causal/);
  assert.match(html, /simulated/);
  assert.match(html, /unexplained/);
  assert.match(html, /caught by family/);

  // the embedded payload is valid and has eight entries.
  const m = html.match(/const SCENARIOS = (\[.*?\]);\n/s);
  assert.ok(m, 'embedded SCENARIOS payload present');
  const data = JSON.parse(m![1]);
  assert.equal(data.length, 8);
  // the new modes are attributed to the expected family in the embedded audit (firing-mode honesty).
  const cov = data.find((s: { name: string }) => s.name === 'covariance-flip-common-mode');
  const osc = data.find((s: { name: string }) => s.name === 'oscillation-common-mode');
  assert.ok(cov.audit.firing_families.C > 0 && cov.audit.firing_families.A === 0, 'covariance flip is caught by Family C, not A');
  assert.ok(osc.audit.firing_families.D > 0 && osc.audit.firing_families.A === 0 && osc.audit.firing_families.C === 0, 'oscillation is caught by Family D only');
});

test('the demo is deterministic (same render twice -> identical)', async () => {
  const a = render(await runAllScenarios());
  const b = render(await runAllScenarios());
  assert.equal(a, b);
});
