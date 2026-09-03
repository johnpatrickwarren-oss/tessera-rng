// Study 2026-09-segment-carryover (WORKLIST C63, tessera-rng half) — harness.
//
// Measures the three merges of a changed leaf's ADR-0018 segment e-values — the shipped MEAN
// (`combineSegmentRuns`), the continuation PRODUCT, and the adaptive MARTINGALE merge (engine
// ADR 0028, local copy asserted against the engine's own values) — on the synthetic fabric with
// reroute epochs. Endpoints, bands and stop conditions are frozen in ../PREREGISTRATION.md.
//
// Build first (the harness imports the repo's compiled in-place `src/*.js`, the way tools/ do):
//   pnpm exec tsc -p tsconfig.test.json
//   node design/research/2026-09-segment-carryover/harness/run.mjs
//
// Discipline (knowledge methodology/harness-discipline): seeded determinism, no wall clock in any
// written artifact (the run directory name carries the UTC stamp; the files do not), append-only
// results directory that refuses to overwrite, every interface smoke-checked before the sweep, no
// catch anywhere — an exception aborts the run (the registered stop condition).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUDY = resolve(HERE, '..');
const ROOT = resolve(STUDY, '../../..');
const require = createRequire(join(ROOT, 'package.json'));

for (const f of ['src/detect.js', 'src/epoch.js', 'src/telemetry.js', 'src/pipeline.js', 'src/calibration.js', 'src/fabric.js', 'src/rng.js']) {
  if (!existsSync(join(ROOT, f))) throw new Error(`${f} missing — run \`pnpm exec tsc -p tsconfig.test.json\` first`);
}

const { generateFabric, DEFAULT_FABRIC } = require(join(ROOT, 'src/fabric.js'));
const { makeEpochs, segmentPlan } = require(join(ROOT, 'src/epoch.js'));
const { generateTelemetry } = require(join(ROOT, 'src/telemetry.js'));
const { standardizeAll } = require(join(ROOT, 'src/calibration.js'));
const { calibrateForSession } = require(join(ROOT, 'src/pipeline.js'));
const { detectPathClass, detectPathClassSegmented, combineSegmentRuns, DEFAULT_DETECT } = require(join(ROOT, 'src/detect.js'));
const { computeFaultDomainHash } = require(join(ROOT, 'src/fault-domain-source.js'));
const { SIGNALS } = require(join(ROOT, 'src/signals.js'));
const { makeRng } = require(join(ROOT, 'src/rng.js'));
const { freshBettingState, updateBettingState } = require('@johnpatrickwarren-oss/deploysignal-engine/detectors/betting-e-process');
const engineCombine = require('@johnpatrickwarren-oss/deploysignal-engine/fleet/combine');
const { combineAverage } = engineCombine;

// ── Registered design (PREREGISTRATION.md §2, amendment 2026-09-02) ──────────────────────────
const STUDY_ID = '2026-09-segment-carryover';
const T = 200;
const ALPHA = 0.05;
const LOG_THRESHOLD = Math.log(1 / ALPHA);
const DRY_RUN = process.env.SEGCARRY_DRY_RUN === '1';   // harness smoke only: 3 seeds, writes to the scratch dir, never to results/
const N_SEEDS = DRY_RUN ? 3 : 200;
const DELTAS = [0, 2, 4];
const BOUNDARY_CELLS = { 1: [100], 3: [50, 100, 150] };
const DEGRADED_RESOURCE = 'pzone-0';            // the leaf's resource under fault; never drained
const DRAIN_RESOURCES = ['czone-0', 'czone-1', 'czone-2']; // reroute k drains DRAIN_RESOURCES[k], fraction 1
const LEAD = 25;                                // fault onset = first boundary − LEAD (amendment §A.2)
const POSTHOC_LEADS = [5, 10, 40];              // post-hoc lead sweep, no verdict (amendment §A.5)
const GAMMA = 0.5;

// ── Seeds: scrambled per (cell, index) through the house LCG ────────────────────────────────
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** telemetry seed for (cell key, seed index): fnv1a of the key, scrambled by one house-LCG draw. */
function scrambledSeed(key) {
  return Math.floor(makeRng(fnv1a(`${STUDY_ID}|${key}`)).next() * 0x100000000) >>> 0;
}

// ── ADR 0028 arithmetic, local copy (engine fleet/combine.ts at d6785f3, PR #77) ─────────────
// The installed pin (v0.6.9-pre) lacks combineMartingale/adaptiveLambdas; the registration lets
// the harness carry a copy and requires it to agree with the engine's function. selfCheck() below
// pins it to values computed by the engine branch's own compiled dist on three fixed vectors.
function logMix(lambda, logE) {
  if (lambda <= 0) return 0;
  if (lambda >= 1) return logE;
  const a = Math.log(1 - lambda);
  const b = Math.log(lambda) + logE;
  const m = a > b ? a : b;
  if (m === -Infinity) return -Infinity;
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
}
function combineMartingale(logEs, lambdas) {
  if (logEs.length === 0) throw new Error('combineMartingale: empty input');
  if (lambdas.length !== logEs.length) throw new Error('combineMartingale: length mismatch');
  let sum = 0;
  for (let k = 0; k < logEs.length; k++) {
    const l = lambdas[k];
    if (!(l >= 0 && l <= 1)) throw new Error(`combineMartingale: lambda[${k}] = ${l} outside [0, 1]`);
    sum += logMix(l, logEs[k]);
  }
  return sum;
}
function adaptiveLambdas(logEs, gamma = GAMMA) {
  if (!(gamma > 0 && gamma <= 1)) throw new Error('adaptiveLambdas: gamma out of range');
  const K = logEs.length;
  const out = new Array(K);
  if (K === 0) return out;
  out[0] = 0;
  const term = (x, l) => {
    if (x <= 0) { const e = Math.exp(x); return (e - 1) / (1 - l + l * e); }
    const r = Math.exp(-x);
    return (1 - r) / ((1 - l) * r + l);
  };
  const g = (l, upto) => { let s = 0; for (let i = 0; i < upto; i++) s += term(logEs[i], l); return s; };
  for (let k = 1; k < K; k++) {
    if (g(0, k) <= 0) { out[k] = 0; continue; }
    if (g(gamma, k) >= 0) { out[k] = gamma; continue; }
    let lo = 0, hi = gamma;
    for (let it = 0; it < 60; it++) { const mid = 0.5 * (lo + hi); if (g(mid, k) > 0) lo = mid; else hi = mid; }
    out[k] = 0.5 * (lo + hi);
  }
  return out;
}
function combineProductLocal(logEs) { let s = 0; for (const x of logEs) s += x; return s; }

/** Engine-branch reference values (dist of fleet/combine.ts at d6785f3, run once, pasted). */
const ENGINE_REFERENCE = {
  A: { v: [0.3, -0.2, 1.1, 0.05, -0.7, 2.0, 0.4], lambdas: [0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], mart: 1.9881800714790203, prod: 2.95, avg: 0.8014564517335996, mart_g1: 2.487242818300634 },
  B: { v: [0.05, -0.3, 0.2, -0.1, 0.15, -0.05, 0.1, 0.3], lambdas: [0, 0.5, 0, 0.11277561125579666, 0, 0.5, 0.1994612594854675, 0.5], mart: 0.007699098455648201, prod: 0.35, avg: 0.059026037247120744, mart_g1: -0.07289618263658132 },
  C: { v: [-0.5, 0.4, -0.2, 0.6, -0.8, 0.9, 0.05, -0.1, 0.2], lambdas: [0, 0, 0.2541246504085307, 0, 0.5, 0.13873929128586915, 0.5, 0.5, 0.5], mart: -0.10324630620863351, prod: 0.55, avg: 0.18469358008664383, mart_g1: -0.4288487242439909 },
};
function selfCheck() {
  const TOL = 1e-12;
  let n = 0;
  for (const [name, r] of Object.entries(ENGINE_REFERENCE)) {
    const l = adaptiveLambdas(r.v);
    assert.equal(l.length, r.lambdas.length, `${name}: lambda count`);
    for (let i = 0; i < l.length; i++) assert.ok(Math.abs(l[i] - r.lambdas[i]) <= TOL, `${name}: lambda[${i}] ${l[i]} vs engine ${r.lambdas[i]}`);
    assert.ok(Math.abs(combineMartingale(r.v, l) - r.mart) <= TOL, `${name}: martingale ${combineMartingale(r.v, l)} vs engine ${r.mart}`);
    assert.ok(Math.abs(combineMartingale(r.v, adaptiveLambdas(r.v, 1)) - r.mart_g1) <= TOL, `${name}: martingale γ=1`);
    assert.ok(Math.abs(combineProductLocal(r.v) - r.prod) <= TOL, `${name}: product`);
    // the installed engine's ungated combineProduct and combineAverage agree with the reference too.
    assert.ok(Math.abs(engineCombine.combineProduct(r.v).log_fleet_e - r.prod) <= TOL, `${name}: installed combineProduct`);
    assert.ok(Math.abs(combineAverage(r.v).log_fleet_e - r.avg) <= TOL, `${name}: installed combineAverage`);
    // predictability: λ on every prefix is a prefix of λ on the full vector.
    for (let k = 1; k <= r.v.length; k++) {
      const lp = adaptiveLambdas(r.v.slice(0, k));
      for (let i = 0; i < k; i++) assert.equal(lp[i], l[i], `${name}: λ predictable at prefix ${k}`);
    }
    n++;
  }
  return n;
}

// ── Per-tick Family A wealth, exactly as src/detect.ts runFamilyA advances it ────────────────
/** Returns { linear[t], log[t] } of the family e-value after each tick of `series` (fresh wealth). */
function familyATrajectory(series, alphaA) {
  const p = SIGNALS.length;
  const states = SIGNALS.map(() => freshBettingState());
  const M = new Array(p).fill(1);
  const linear = new Array(series.length);
  const log = new Array(series.length);
  for (let t = 0; t < series.length; t++) {
    const vec = series[t];
    for (let i = 0; i < p; i++) M[i] = updateBettingState(states[i], vec[i], 0, 1, alphaA);
    linear[t] = Math.min(M.reduce((s, x) => s + x, 0) / p, Number.MAX_VALUE);
    log[t] = combineAverage(states.map((s, i) => s.log_M ?? Math.log(M[i]))).log_fleet_e;
  }
  return { linear, log };
}

// ── Merges ──────────────────────────────────────────────────────────────────────────────────
const ARMS = ['mean', 'product', 'martingale'];
/** Merge over completed segments 0..k−1 plus the running segment's log e-value `logRun`. */
function mergeAt(logEs, k, logRun, lambdasFull) {
  const v = logEs.slice(0, k).concat([logRun]);
  return {
    mean: combineAverage(v).log_fleet_e,
    product: combineProductLocal(v),
    martingale: combineMartingale(v, lambdasFull.slice(0, k + 1)),
  };
}
function mergesAtSegmentEnds(logEs) {
  const lambdas = adaptiveLambdas(logEs);
  const out = { mean: [], product: [], martingale: [] };
  for (let k = 1; k <= logEs.length; k++) {
    const v = logEs.slice(0, k);
    out.mean.push(combineAverage(v).log_fleet_e);
    out.product.push(combineProductLocal(v));
    out.martingale.push(combineMartingale(v, lambdas.slice(0, k)));
  }
  return { ...out, lambdas };
}
function assertFinite(x, what) { if (!Number.isFinite(x)) throw new Error(`STOP: non-finite merged value (${what}): ${x}`); }

// ── One cell ────────────────────────────────────────────────────────────────────────────────
const SNAP = generateFabric(DEFAULT_FABRIC);
const FABRIC_HASH = computeFaultDomainHash(SNAP);
const DEGRADED_LEAVES = new Set(SNAP.edges.filter((e) => e.resource === DEGRADED_RESOURCE).map((e) => e.path_class));

function traversesInEveryEpoch(epochs, pc, resource) {
  return epochs.every((ep) => ep.snapshot.edges.some((e) => e.path_class === pc && e.resource === resource));
}

/** Run one (boundaries, δ, lead) cell over N seeds; returns per-leaf rows + counters. */
function runCell({ boundaries, delta, lead, label }) {
  const bTicks = BOUNDARY_CELLS[boundaries];
  const rows = [];      // registered population: reset at EVERY boundary, on the degraded resource in every epoch
  const rowsAny = [];   // reported population: changed at ≥1 boundary, on the degraded resource in every epoch
  const counters = { seeds: 0, shipped_equalities: 0, trajectory_equalities: 0, leaves_changed_total: 0 };
  const startTick = bTicks[0] - lead;
  for (let i = 0; i < N_SEEDS; i++) {
    const key = `${label}|b${boundaries}|d${delta}|L${lead}|${i}`;
    const seed = scrambledSeed(key);
    const reroutes = bTicks.map((at, k) => ({ at_tick: at, resource_id: DRAIN_RESOURCES[k], fraction: 1, seed: scrambledSeed(`${key}|reroute|${k}`) }));
    const epochs = makeEpochs(SNAP, reroutes);
    const { plan } = segmentPlan(epochs, T);
    const { calibration, ctx } = calibrateForSession(SNAP, { seed, ticks: T }, DEFAULT_DETECT);
    const tel = { seed, ticks: T, epochs };
    if (delta > 0) tel.degradation = { resource_id: DEGRADED_RESOURCE, delta, start_tick: startTick };
    const residuals = standardizeAll(generateTelemetry(SNAP, tel).series, calibration);
    counters.seeds++;
    counters.leaves_changed_total += plan.size;
    for (const pc of [...plan.keys()].sort()) {
      if (!DEGRADED_LEAVES.has(pc) || !traversesInEveryEpoch(epochs, pc, DEGRADED_RESOURCE)) continue;
      const segs = plan.get(pc);
      const series = residuals.get(pc);
      // the shipped path, and the same runs re-derived so per-family segment values are in hand.
      const shipped = detectPathClassSegmented(pc, series, segs, DEFAULT_DETECT, ctx);
      const runs = segs.map((s) => detectPathClass(pc, series.slice(s.from_tick, s.to_tick), DEFAULT_DETECT, ctx));
      assert.equal(JSON.stringify(combineSegmentRuns(pc, runs, segs)), JSON.stringify(shipped), `${key}/${pc}: shipped verdict re-derived`);
      counters.shipped_equalities++;
      const fam = (f) => runs.map((r) => { const d = r.detectors[f]; assert.equal(d.family, 'ACD'[f]); return d; });
      const A = fam(0), C = fam(1), D = fam(2);
      const logA = A.map((d) => d.log_e_value);
      // per-tick Family A wealth per segment; final tick must equal the shipped segment value exactly.
      const traj = segs.map((s) => familyATrajectory(series.slice(s.from_tick, s.to_tick), DEFAULT_DETECT.alphaA));
      traj.forEach((tr, k) => {
        assert.equal(tr.linear[tr.linear.length - 1], A[k].e_value, `${key}/${pc}: segment ${k} linear A`);
        assert.equal(tr.log[tr.log.length - 1], A[k].log_e_value, `${key}/${pc}: segment ${k} log A`);
      });
      counters.trajectory_equalities++;
      const endsA = mergesAtSegmentEnds(logA);
      const endsC = mergesAtSegmentEnds(C.map((d) => d.log_e_value));
      const endsD = mergesAtSegmentEnds(D.map((d) => d.log_e_value));
      // the shipped mean at the last segment end IS the arm's value (linear/log both).
      assert.equal(endsA.mean[endsA.mean.length - 1], shipped.detectors[0].log_e_value, `${key}/${pc}: shipped mean log`);
      for (const arm of ARMS) for (const x of endsA[arm]) assertFinite(x, `${key}/${pc}/${arm}`);
      // first crossing at segment ends (the merge's own stopping times) and at tick resolution.
      const firstEnd = {}, firstTick = {};
      for (const arm of ARMS) {
        const kEnd = endsA[arm].findIndex((x) => x >= LOG_THRESHOLD);
        firstEnd[arm] = kEnd < 0 ? null : segs[kEnd].to_tick;
        let ft = null;
        for (let k = 0; k < segs.length && ft === null; k++) {
          const tr = traj[k];
          for (let t = 0; t < tr.log.length; t++) {
            const m = mergeAt(logA, k, tr.log[t], endsA.lambdas)[arm];
            assertFinite(m, `${key}/${pc}/${arm}@tick`);
            if (m >= LOG_THRESHOLD) { ft = segs[k].from_tick + t; break; }
          }
        }
        firstTick[arm] = ft;
      }
      const row = {
        cell: label, boundaries, delta, lead, seed_index: i, seed, pc, K: segs.length,
        logA, lambdas: endsA.lambdas,
        endA: { mean: endsA.mean, product: endsA.product, martingale: endsA.martingale },
        first_end: firstEnd, first_tick: firstTick,
        final: { mean: endsA.mean[segs.length - 1], product: endsA.product[segs.length - 1], martingale: endsA.martingale[segs.length - 1] },
        shipped_fired_A: shipped.detectors[0].fired,
        crossC: Object.fromEntries(ARMS.map((a) => [a, endsC[a].some((x) => x >= LOG_THRESHOLD)])),
        crossD: Object.fromEntries(ARMS.map((a) => [a, endsD[a].some((x) => x >= LOG_THRESHOLD)])),
      };
      rowsAny.push(row);
      if (segs.length === boundaries + 1) rows.push(row);
    }
  }
  return { rows, rowsAny, counters };
}

/** The per-leaf record kept on disk (the registered population only; aggregates carry the rest). */
function compactRow(r) {
  return { cell: r.cell, seed_index: r.seed_index, seed: r.seed, pc: r.pc, K: r.K, logA: r.logA, lambdas: r.lambdas, first_end: r.first_end, first_tick: r.first_tick, final: r.final, shipped_fired_A: r.shipped_fired_A };
}

// ── Endpoint arithmetic ─────────────────────────────────────────────────────────────────────
const rate = (rows, f) => rows.length ? rows.filter(f).length / rows.length : NaN;
const crossRateEnd = (rows, arm) => rate(rows, (r) => r.first_end[arm] !== null);
const crossRateTick = (rows, arm) => rate(rows, (r) => r.first_tick[arm] !== null);
/** upper median: sorted[floor(n/2)], non-crossers count as +Infinity (censored at T). */
function medianFirstTick(rows, arm) {
  const v = rows.map((r) => (r.first_tick[arm] === null ? Infinity : r.first_tick[arm])).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
}
function sampleVariance(xs) {
  const n = xs.length; if (n < 2) return NaN;
  const m = xs.reduce((s, x) => s + x, 0) / n;
  return xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (n - 1);
}
const seBinomial = (p, n) => Math.sqrt(p * (1 - p) / n);

function summarize(rows) {
  const out = { n_leaves: rows.length, K_histogram: {}, rate_end: {}, rate_tick: {}, median_first_tick: {}, variance_final_linear: {}, shipped_fired_A_rate: rate(rows, (r) => r.shipped_fired_A), rate_end_C: {}, rate_end_D: {}, lambda_mean_by_k: [] };
  for (const r of rows) out.K_histogram[r.K] = (out.K_histogram[r.K] ?? 0) + 1;
  for (const arm of ARMS) {
    out.rate_end[arm] = crossRateEnd(rows, arm);
    out.rate_tick[arm] = crossRateTick(rows, arm);
    out.median_first_tick[arm] = medianFirstTick(rows, arm);
    out.variance_final_linear[arm] = sampleVariance(rows.map((r) => Math.exp(r.final[arm])));
    out.rate_end_C[arm] = rate(rows, (r) => r.crossC[arm]);
    out.rate_end_D[arm] = rate(rows, (r) => r.crossD[arm]);
  }
  const maxK = Math.max(0, ...rows.map((r) => r.K));
  for (let k = 0; k < maxK; k++) {
    const ls = rows.filter((r) => r.K > k).map((r) => r.lambdas[k]);
    out.lambda_mean_by_k.push(ls.length ? ls.reduce((s, x) => s + x, 0) / ls.length : null);
  }
  return out;
}

// ── Main ────────────────────────────────────────────────────────────────────────────────────
function main() {
  const t0 = process.hrtime.bigint();
  const selfChecked = selfCheck();
  console.log(`self-check: local ADR 0028 arithmetic reproduces engine d6785f3 on ${selfChecked} vectors (1e-12); installed combineProduct is ungated`);

  // smoke: a fire on an obvious signal, a no-fire on clean data, trajectory ≡ shipped.
  {
    const smoke = (delta) => {
      const eps = makeEpochs(SNAP, [{ at_tick: 100, resource_id: 'czone-0', fraction: 1, seed: 1 }]);
      const { plan } = segmentPlan(eps, T);
      const pc = [...plan.keys()].sort().find((p) => DEGRADED_LEAVES.has(p));
      const { calibration, ctx } = calibrateForSession(SNAP, { seed: 0x5eed01, ticks: T }, DEFAULT_DETECT);
      const tel = { seed: 0x5eed01, ticks: T, epochs: eps, ...(delta ? { degradation: { resource_id: DEGRADED_RESOURCE, delta, start_tick: 100 - LEAD } } : {}) };
      const res = standardizeAll(generateTelemetry(SNAP, tel).series, calibration);
      const v = detectPathClassSegmented(pc, res.get(pc), plan.get(pc), DEFAULT_DETECT, ctx);
      return { pc, segA: v.segments.map((s, k) => detectPathClass(pc, res.get(pc).slice(s.from_tick, s.to_tick), DEFAULT_DETECT, ctx).detectors[0].e_value), fired: v.detectors[0].fired };
    };
    const hot = smoke(4), cold = smoke(0);
    console.log(`smoke fire  δ=4 ${hot.pc}: Family A per-segment e = [${hot.segA.map((x) => x.toExponential(2)).join(', ')}] fired=${hot.fired}`);
    console.log(`smoke clean δ=0 ${cold.pc}: Family A per-segment e = [${cold.segA.map((x) => x.toExponential(2)).join(', ')}] fired=${cold.fired}`);
    assert.ok(hot.segA[1] >= 1 / ALPHA, 'smoke: the post-boundary faulted segment must fire');
    assert.ok(cold.segA.every((x) => x < 1 / ALPHA), 'smoke: clean segments must not fire');
  }

  // results directory: append-only, refuses an existing dir. The UTC stamp lives in the dir name only.
  const stamp = (process.env.SOURCE_DATE_EPOCH ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000) : new Date()).toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
  const runDir = DRY_RUN ? join(process.env.SEGCARRY_DRY_DIR ?? HERE, `dry-run-${stamp}`) : join(STUDY, 'results', `run-${stamp}`);
  if (existsSync(runDir)) throw new Error(`refusing to overwrite ${runDir}`);
  mkdirSync(runDir, { recursive: true });
  console.log(`run dir ${runDir}`);

  // the registered grid.
  const cells = {};
  const leaves = [];
  const counters = {};
  for (const boundaries of [1, 3]) for (const delta of DELTAS) {
    const label = `b${boundaries}-d${delta}`;
    const r = runCell({ boundaries, delta, lead: LEAD, label });
    cells[label] = { boundaries, delta, lead: LEAD, registered: summarize(r.rows), any_boundary: summarize(r.rowsAny) };
    leaves.push(...r.rows.map(compactRow));
    counters[label] = r.counters;
    const s = cells[label].registered;
    console.log(`${label}: N=${s.n_leaves} (any-boundary ${cells[label].any_boundary.n_leaves}) rate_end mean/product/martingale = ${ARMS.map((a) => s.rate_end[a].toFixed(4)).join(' / ')}; median first tick = ${ARMS.map((a) => s.median_first_tick[a]).join(' / ')}`);
  }

  // ── Endpoints (PREREGISTRATION.md §3) ──
  const E = {};
  const h0 = ['b1-d0', 'b3-d0'], inj = ['b1-d2', 'b1-d4', 'b3-d2', 'b3-d4'];
  {
    const perArm = {};
    let held = true;
    for (const arm of ARMS) {
      perArm[arm] = {};
      for (const c of h0) {
        const s = cells[c].registered;
        const band = ALPHA + 3 * seBinomial(ALPHA, s.n_leaves);
        const ok = s.rate_end[arm] <= band;
        perArm[arm][c] = { measured: s.rate_end[arm], n_leaves: s.n_leaves, band_upper: band, held: ok };
        if (!ok) held = false;
      }
    }
    const pooled = {};
    for (const arm of ARMS) {
      const rows = h0.flatMap((c) => leaves.filter((r) => r.cell === c));
      pooled[arm] = { measured: crossRateEnd(rows, arm), n_leaves: rows.length, band_upper: ALPHA + 3 * seBinomial(ALPHA, rows.length) };
    }
    E.P1 = { name: 'validity (H0 ever-crossing at segment ends, all three arms)', measured: perArm, pooled_reported: pooled, band: `≤ α + 3·se_binomial(α, N_leaves) per arm per H0 cell, α = ${ALPHA}`, verdict: held ? 'HELD' : 'FAILED' };
  }
  {
    const perCell = {};
    let allGe = true;
    for (const c of inj) {
      const s = cells[c].registered;
      perCell[c] = { product: s.rate_end.product, mean: s.rate_end.mean, diff: s.rate_end.product - s.rate_end.mean, n_leaves: s.n_leaves };
      if (!(s.rate_end.product >= s.rate_end.mean)) allGe = false;
    }
    const margin = perCell['b3-d4'].diff;
    const marginOk = margin >= 0.10;
    E.P2 = { name: 'power: product ≥ mean on every injected cell; ≥ 0.10 absolute margin at δ = 4, 3 boundaries', measured: { per_cell: perCell, margin_b3_d4: margin }, band: 'product ≥ mean on 4/4 cells AND (product − mean) ≥ 0.10 at b3-d4', verdict: allGe && marginOk ? 'HELD' : 'FAILED', clauses: { all_cells_product_ge_mean: allGe, margin_b3_d4_ge_0_10: marginOk } };
  }
  {
    const perCell = {};
    let allGe = true;
    for (const c of inj) {
      const s = cells[c].registered;
      perCell[c] = { martingale: s.rate_end.martingale, mean: s.rate_end.mean, product: s.rate_end.product, n_leaves: s.n_leaves };
      if (!(s.rate_end.martingale >= s.rate_end.mean)) allGe = false;
    }
    E.P3 = { name: 'power: adaptive martingale ≥ mean on every injected cell (its relation to the product REPORTED)', measured: perCell, band: 'martingale ≥ mean on 4/4 cells', verdict: allGe ? 'HELD' : 'FAILED' };
  }
  {
    const perCell = {};
    let ok = true;
    for (const c of ['b1-d4', 'b3-d4']) {
      const s = cells[c].registered;
      perCell[c] = { product: s.median_first_tick.product, mean: s.median_first_tick.mean, martingale_reported: s.median_first_tick.martingale, n_leaves: s.n_leaves };
      if (!(s.median_first_tick.product <= s.median_first_tick.mean)) ok = false;
    }
    E.P4 = { name: 'time to cross: median first tick at 1/α on δ = 4 cells, product vs mean (tick resolution; non-crossers censored as +∞)', measured: perCell, band: 'product ≤ mean on both boundary counts', verdict: ok ? 'HELD' : 'FAILED' };
  }
  {
    const perCell = {};
    let ok = true;
    for (const c of h0) {
      const s = cells[c].registered;
      perCell[c] = { product: s.variance_final_linear.product, martingale: s.variance_final_linear.martingale, mean_reported_not_comparable: s.variance_final_linear.mean, n_leaves: s.n_leaves };
      if (!(s.variance_final_linear.product > s.variance_final_linear.martingale)) ok = false;
    }
    E.P5 = { name: 'null variance at T: product > martingale (H0 cells)', measured: perCell, band: 'Var(product) > Var(martingale) on both H0 cells', verdict: ok ? 'HELD' : 'FAILED' };
  }
  const shipRule = E.P1.verdict === 'HELD' && E.P2.verdict === 'HELD' ? 'FIRES: implement opt-in carryover parameter' : 'DOES NOT FIRE: no code change';
  E.REPORTED = {
    martingale_vs_product_rate_end: Object.fromEntries(inj.map((c) => [c, { martingale: cells[c].registered.rate_end.martingale, product: cells[c].registered.rate_end.product }])),
    tick_resolution_rates: Object.fromEntries([...h0, ...inj].map((c) => [c, cells[c].registered.rate_tick])),
    family_C_rate_end: Object.fromEntries([...h0, ...inj].map((c) => [c, cells[c].registered.rate_end_C])),
    family_D_rate_end: Object.fromEntries([...h0, ...inj].map((c) => [c, cells[c].registered.rate_end_D])),
    any_boundary_population: Object.fromEntries([...h0, ...inj].map((c) => [c, { n_leaves: cells[c].any_boundary.n_leaves, K_histogram: cells[c].any_boundary.K_histogram, rate_end: cells[c].any_boundary.rate_end, median_first_tick: cells[c].any_boundary.median_first_tick }])),
    shipped_family_A_fired_rate: Object.fromEntries([...h0, ...inj].map((c) => [c, cells[c].registered.shipped_fired_A_rate])),
    lambda_mean_by_segment: Object.fromEntries([...h0, ...inj].map((c) => [c, cells[c].registered.lambda_mean_by_k])),
    ship_rule: shipRule,
  };
  writeFileSync(join(runDir, 'endpoints.json'), JSON.stringify(E, null, 2) + '\n');
  writeFileSync(join(runDir, 'cells.json'), JSON.stringify(cells, null, 2) + '\n');
  writeFileSync(join(runDir, 'leaves.json'), JSON.stringify(leaves) + '\n');
  for (const [k, v] of Object.entries(E)) if (v.verdict) console.log(`${k}: ${v.verdict}`);
  console.log(`ship rule: ${shipRule}`);

  // ── Post-hoc (labelled; no verdict): the fault-onset lead, on the injected cells ──
  const posthoc = { label: 'POST-HOC — lead sensitivity, no verdict', leads: POSTHOC_LEADS, cells: {} };
  for (const lead of POSTHOC_LEADS) for (const boundaries of [1, 3]) for (const delta of [2, 4]) {
    const label = `b${boundaries}-d${delta}-L${lead}`;
    const r = runCell({ boundaries, delta, lead, label });
    const s = summarize(r.rows);
    posthoc.cells[label] = { boundaries, delta, lead, n_leaves: s.n_leaves, rate_end: s.rate_end, rate_tick: s.rate_tick, median_first_tick: s.median_first_tick, lambda_mean_by_k: s.lambda_mean_by_k };
    counters[label] = r.counters;
    console.log(`post-hoc ${label}: N=${s.n_leaves} rate_end m/p/M = ${ARMS.map((a) => s.rate_end[a].toFixed(4)).join(' / ')}; median first tick = ${ARMS.map((a) => s.median_first_tick[a]).join(' / ')}`);
  }
  writeFileSync(join(runDir, 'posthoc.json'), JSON.stringify(posthoc, null, 2) + '\n');

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const enginePkg = JSON.parse(readFileSync(join(ROOT, 'node_modules/@johnpatrickwarren-oss/deploysignal-engine/package.json'), 'utf8'));
  const manifest = {
    study: STUDY_ID,
    registration: 'PREREGISTRATION.md (frozen at c21029b; amendment 2026-09-02 appended before this run)',
    repo_sha: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    engine_pin: pkg.dependencies['@johnpatrickwarren-oss/deploysignal-engine'],
    engine_installed_version: enginePkg.version,
    engine_adr0028_reference: 'fleet/combine.ts at d6785f3 (origin/c63/martingale-merging, PR #77), local copy asserted to 1e-12 on 3 vectors',
    node_version: process.version,
    fabric: 'generateFabric(DEFAULT_FABRIC)',
    fabric_hash: FABRIC_HASH,
    ticks: T,
    alpha: ALPHA,
    gamma: GAMMA,
    detect_params: DEFAULT_DETECT,
    seed_scheme: 'telemetry seed = floor(makeRng(fnv1a(`2026-09-segment-carryover|<cell>|b<B>|d<δ>|L<lead>|<i>`)).next()·2^32); reroute k seed = same key + `|reroute|<k>`; calibration seed = telemetry seed ^ 0xca11b (calibrateForSession)',
    n_seeds_per_cell: N_SEEDS,
    cell_grid: { boundaries: BOUNDARY_CELLS, deltas: DELTAS, lead: LEAD },
    design: {
      degraded_resource: DEGRADED_RESOURCE,
      degradation: `mean shift δ on p99_latency from tick (first boundary − ${LEAD}), weight 1, persisting through every epoch (the resource is never drained)`,
      reroutes: DRAIN_RESOURCES.map((r, k) => `boundary ${k}: drain ${r}, fraction 1`),
      population_registered: `changed leaves traversing ${DEGRADED_RESOURCE} in every epoch AND reset at every boundary of the cell (K = boundaries + 1)`,
      population_reported: 'the same, changed at ≥ 1 boundary (any K ≥ 2)',
      p1_p2_p3_evaluation: 'merged value ≥ 1/α at any segment end (the merge\'s own stopping times)',
      p4_evaluation: 'first tick at which the merge over completed segments × the running Family A wealth ≥ 1/α; per-tick wealth recomputed from the engine betting states and asserted equal to the shipped segment value',
      p5_evaluation: 'sample variance (n−1) of exp(merged log e) at T over the H0 population',
    },
    counters,
    posthoc: { leads: POSTHOC_LEADS, note: 'post-hoc, labelled, no verdict' },
    dry_run: DRY_RUN,
  };
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`done in ${(Number(process.hrtime.bigint() - t0) / 1e9).toFixed(0)} s (not recorded in the artifacts)`);
}

main();
