import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../tools/build-demo';
import { runAllScenarios, SCENARIO_NAMES } from '../tools/scenarios';

test('the single-file demo embeds all six scenarios and the key surfaces (AC-8)', async () => {
  const html = render(await runAllScenarios());

  // self-contained single file: a document with a scenario selector, no external asset refs.
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<select id="sel">/);
  assert.ok(!/src=["']https?:/.test(html) && !/<link/.test(html), 'must be self-contained (no external assets)');

  // all six scenarios are pageable.
  for (const name of SCENARIO_NAMES) assert.ok(html.includes(name), `demo must include scenario ${name}`);

  // the honest/required surfaces are rendered.
  assert.match(html, /correlational, not causal/);
  assert.match(html, /simulated/);
  assert.match(html, /unexplained/);

  // the embedded payload is valid and has six entries.
  const m = html.match(/const SCENARIOS = (\[.*?\]);\n/s);
  assert.ok(m, 'embedded SCENARIOS payload present');
  const data = JSON.parse(m![1]);
  assert.equal(data.length, 6);
});

test('the demo is deterministic (same render twice -> identical)', async () => {
  const a = render(await runAllScenarios());
  const b = render(await runAllScenarios());
  assert.equal(a, b);
});
