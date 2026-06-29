/**
 * ADR-0032 — degradation/sensitivity harness acceptance bar.
 *
 * Anti-self-confirming (DISCIPLINES §6): the load-bearing test is byte-identity at intensity 0 —
 * the harness MUST reproduce `runPipeline` when nothing is perturbed. If `perturbTelemetry` were
 * a no-op, the "genuinely perturbs" tests fail; if it leaked at intensity 0, the anchor fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../src/pipeline';
import type { PipelineParams } from '../src/pipeline';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { runPerturbed, perturbTelemetry, perturbSnapshot } from '../tools/degradation';
import { makeRng } from '../src/rng';
import { generateTelemetry } from '../src/telemetry';

const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
const Q = 0.05;
const TICKS = 40;

function cleanParams(seed: number): PipelineParams {
  return { snapshot: SNAP, q: Q, telemetry: { seed, ticks: TICKS } };
}
function faultParams(seed: number): PipelineParams {
  return { snapshot: SNAP, q: Q, telemetry: { seed, ticks: TICKS, degradation: { resource_id: 'optic-3', delta: 3, start_tick: 0 } } };
}

// ───────────────────────── the anti-self-confirming anchor ─────────────────────────

test('intensity-0 reproduces runPipeline BYTE-FOR-BYTE (clean + fault, any perturb seed)', async () => {
  for (const mk of [cleanParams, faultParams]) {
    for (const seed of [0x5eed01, 0x5eed02]) {
      const ref = await runPipeline(mk(seed));
      // an inert spec must short-circuit to the exact pipeline output regardless of perturb seed.
      const got = await runPerturbed(mk(seed), {}, 0xabcdef);
      assert.equal(JSON.stringify(got), JSON.stringify(ref), `inert spec must equal runPipeline (seed ${seed})`);
    }
  }
});

test('a no-op perturbTelemetry (the mutant) would BREAK the genuinely-perturbs tests', async () => {
  // guards the anchor's partner: prove the transform actually changes the stream, so the
  // byte-identity above is meaningful (not "everything is identity").
  const rng = makeRng(1);
  const raw = generateTelemetry(SNAP, { seed: 7, ticks: TICKS }).series;
  const noised = perturbTelemetry(raw, { noiseStd: 2 }, rng);
  let differs = false;
  for (const pc of raw.keys()) {
    const a = raw.get(pc)![0], b = noised.get(pc)![0];
    if (a.some((v, i) => v !== b[i])) { differs = true; break; }
  }
  assert.ok(differs, 'noise must change the raw stream');
});

// ───────────────────────── each axis genuinely perturbs ─────────────────────────

const PSEED = 0x1234abcd;

test('signal_noise axis perturbs the audit', async () => {
  const base = JSON.stringify(await runPerturbed(faultParams(0x5eed01), {}, PSEED));
  const got = JSON.stringify(await runPerturbed(faultParams(0x5eed01), { noiseStd: 2 }, PSEED));
  assert.notEqual(got, base, 'noise must change the audit');
});

test('missingness axis perturbs the audit', async () => {
  const base = JSON.stringify(await runPerturbed(faultParams(0x5eed01), {}, PSEED));
  const got = JSON.stringify(await runPerturbed(faultParams(0x5eed01), { missingness: 0.5 }, PSEED));
  assert.notEqual(got, base, 'missingness must change the audit');
});

test('observation_delay axis perturbs the audit', async () => {
  const base = JSON.stringify(await runPerturbed(faultParams(0x5eed01), {}, PSEED));
  const got = JSON.stringify(await runPerturbed(faultParams(0x5eed01), { delayTicks: 8 }, PSEED));
  assert.notEqual(got, base, 'delay must change the audit');
});

test('aggregation_error perturbs the SNAPSHOT (hash changes)', async () => {
  const base = await runPerturbed(faultParams(0x5eed01), {}, PSEED);
  const got = await runPerturbed(faultParams(0x5eed01), { aggregationError: 0.5 }, PSEED);
  assert.notEqual(got.snapshot_hash, base.snapshot_hash, 'perturbing weights must change the snapshot hash');
});

test('perturbSnapshot clamps weights into (0,1] and only touches weights', () => {
  const rng = makeRng(3);
  const p = perturbSnapshot(SNAP, 0.9, rng);
  assert.equal(p.edges.length, SNAP.edges.length);
  for (const e of p.edges) {
    assert.ok((e.weight ?? 1) > 0 && (e.weight ?? 1) <= 1, 'weight stays in (0,1]');
  }
  assert.deepEqual(p.path_classes, SNAP.path_classes, 'population is preserved');
});

// ───────────────────────── determinism, composition, frontier ─────────────────────────

test('seeded determinism — same spec + seed ⇒ identical audit', async () => {
  const a = JSON.stringify(await runPerturbed(faultParams(0x5eed01), { noiseStd: 1, missingness: 0.2 }, PSEED));
  const b = JSON.stringify(await runPerturbed(faultParams(0x5eed01), { noiseStd: 1, missingness: 0.2 }, PSEED));
  assert.equal(a, b);
});

test('composition — a joint spec differs from each single axis alone (composable)', async () => {
  const noise = JSON.stringify(await runPerturbed(faultParams(0x5eed01), { noiseStd: 1 }, PSEED));
  const miss = JSON.stringify(await runPerturbed(faultParams(0x5eed01), { missingness: 0.3 }, PSEED));
  const both = JSON.stringify(await runPerturbed(faultParams(0x5eed01), { noiseStd: 1, missingness: 0.3 }, PSEED));
  assert.notEqual(both, noise);
  assert.notEqual(both, miss);
});

/** Attribution rate (true culprit ranks #1) over a small seed block — the frontier metric. */
async function attribution(spec: Parameters<typeof runPerturbed>[1], seeds: number[]): Promise<number> {
  let hit = 0;
  for (const pseed of seeds) {
    const audit = await runPerturbed(faultParams(0x5eed01), spec, pseed);
    if (audit.selected_path_class_ids.length > 0 && audit.culprits[0]?.resource_id === 'optic-3') hit += 1;
  }
  return hit / seeds.length;
}

test('breakdown frontier is REAL — attribution holds at tiny intensity, collapses at large', async () => {
  const seeds = [0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6];
  const clean = await attribution({}, seeds);
  const tiny = await attribution({ noiseStd: 0.01 }, seeds);
  const large = await attribution({ noiseStd: 6 }, seeds);
  assert.ok(clean >= 0.8, `clean must attribute (got ${clean})`);
  assert.equal(tiny, clean, 'a negligible perturbation must not move the frontier');
  assert.ok(large < clean, `a large perturbation must degrade attribution (clean ${clean}, large ${large})`);
});

test('frontier is stable across a HELD-OUT seed block (sample size is sufficient)', async () => {
  // ADR-0032 open-Q1: the frontier must not be an n=4 artifact. Two disjoint 8-seed blocks must
  // agree on the qualitative verdict (clean attributes, heavy noise breaks) — not a fragile point.
  const blockA = [0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8];
  const blockB = [0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8];
  const cleanA = await attribution({}, blockA);
  const cleanB = await attribution({}, blockB);
  const heavyA = await attribution({ noiseStd: 6 }, blockA);
  const heavyB = await attribution({ noiseStd: 6 }, blockB);
  assert.ok(cleanA >= 0.8 && cleanB >= 0.8, 'both blocks attribute when clean');
  assert.ok(heavyA < cleanA && heavyB < cleanB, 'both blocks break under heavy noise');
});
