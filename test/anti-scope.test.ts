import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localize } from '../src/tomography';
import type { FaultDomainSnapshot } from '../src/domain';

// Structural guards for the v1 must-never anti-scope (spec §2). These read the product source
// directly, so a future edit that violates an anti-scope rule turns a test red even if it
// type-checks and the runtime behaves.

const SRC_DIR = join(__dirname, '..', 'src');
function srcFiles(): { name: string; text: string }[] {
  return readdirSync(SRC_DIR)
    .filter((n) => n.endsWith('.ts'))
    .map((n) => ({ name: n, text: readFileSync(join(SRC_DIR, n), 'utf8') }));
}
function importSpecifiers(text: string): string[] {
  const re = /(?:\bfrom|\brequire\(\s*|\bimport\(\s*)\s*['"]([^'"]+)['"]/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

const ENGINE = '@johnpatrickwarren-oss/deploysignal-engine';

test('N5 — the engine is consumed only via its package name, never forked/reached-into', () => {
  for (const f of srcFiles()) {
    for (const spec of importSpecifiers(f.text)) {
      if (!spec.includes('deploysignal-engine')) continue;
      assert.ok(spec === ENGINE || spec.startsWith(`${ENGINE}/`), `${f.name}: engine import must be the bare package, got '${spec}'`);
      assert.ok(!spec.includes('/_'), `${f.name}: must not import engine internals ('_'-prefixed), got '${spec}'`);
      assert.ok(!spec.includes('/dist/') && !spec.includes('node_modules'), `${f.name}: must not deep-link into engine build output, got '${spec}'`);
    }
  }
});

test('N2/N3 — product source imports no live-fabric / network / fs ingestion client', () => {
  const forbidden = ['node:net', 'node:http', 'node:https', 'node:dgram', 'node:tls', 'node:fs', 'undici', 'axios', 'got', 'node-fetch'];
  for (const f of srcFiles()) {
    for (const spec of importSpecifiers(f.text)) {
      assert.ok(!forbidden.includes(spec), `${f.name}: src must not import '${spec}' (synthetic-only, no live ingestion)`);
    }
  }
});

test('N1 — no product surface exposes a single-component / causal root-cause field', () => {
  const ALLOWED = new Set(['correlational_not_causal', 'correlational-not-causal']);
  for (const f of srcFiles()) {
    assert.ok(!/root_?cause/i.test(f.text), `${f.name}: no 'root cause' surface allowed (localization is a resource GROUP)`);
    // every token containing 'causal' must be the correlational-not-causal disclaimer (field or hyphenated prose).
    for (const tok of f.text.match(/[A-Za-z_-]*causal[A-Za-z_-]*/g) ?? []) {
      assert.ok(ALLOWED.has(tok), `${f.name}: '${tok}' — 'causal' may only appear in the correlational-not-causal disclaimer`);
    }
  }
});

test('N1 — every localized culprit is flagged correlational-not-causal at runtime', () => {
  const snap: FaultDomainSnapshot = {
    nodes: [],
    edges: [
      { path_class: 'pc-0', resource: 'shuffler-0', relationship: 'traverses' },
      { path_class: 'pc-1', resource: 'shuffler-0', relationship: 'traverses' },
    ],
    path_classes: ['pc-0', 'pc-1'],
    resources: [{ id: 'shuffler-0', kind: 'passive_shuffler' }],
    fetched_at_ts: 0,
    source_id: 's',
    source_version: 'v',
  };
  const res = localize(snap, ['pc-0', 'pc-1']);
  assert.ok(res.culprits.length > 0);
  for (const c of res.culprits) assert.equal(c.correlational_not_causal, true);
});
