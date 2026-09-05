// design/research/2026-09-sequencing/harness/run.mjs — the registered harness for 2026-09-sequencing,
// tessera-rng half (PREREGISTRATION.md §2–§3). Fabric, calibration and selection copied from the
// e-by-surface harness (not imported: it executes on import). Drives the shipped IncrementalSession
// tick by tick for the Family A betting crossing and the per-tick e-BH selection, and the engine's
// mixture and e-SR (pinned dependency) on the batch-standardized residuals of the same telemetry.
// Cells run in worker threads; each cell's result is a pure function of its registered seed.
// No catch anywhere. Build first (the harness imports the compiled in-place src/*.js).
//
//   node design/research/2026-09-sequencing/harness/run.mjs --mode live [--workers 10]
//   node design/research/2026-09-sequencing/harness/run.mjs --mode sim --quick     (N = 8, never scored)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { render } from '../analysis/report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUDY = resolve(HERE, '..');
const ROOT = resolve(STUDY, '../../..');
const require = createRequire(join(ROOT, 'package.json'));
for (const f of ['src/detect.js', 'src/telemetry.js', 'src/pipeline.js', 'src/calibration.js', 'src/fabric.js', 'src/surface.js', 'src/session.js']) {
  if (!existsSync(join(ROOT, f))) throw new Error(`build first: ${f} missing`);
}
const { generateFabric, DEFAULT_FABRIC } = require(join(ROOT, 'src/fabric.js'));
const { generateTelemetry } = require(join(ROOT, 'src/telemetry.js'));
const { standardizeAll } = require(join(ROOT, 'src/calibration.js'));
const { calibrateForSession } = require(join(ROOT, 'src/pipeline.js'));
const { DEFAULT_DETECT, CS_SIGMA_SQUARED_PRIOR } = require(join(ROOT, 'src/detect.js'));
const { buildSurface } = require(join(ROOT, 'src/surface.js'));
const { openSession } = require(join(ROOT, 'src/session.js'));
const { SIGNALS } = require(join(ROOT, 'src/signals.js'));
const mix = require('@johnpatrickwarren-oss/deploysignal-engine/detectors/family-a-mixture-supermartingale');
const esr = require('@johnpatrickwarren-oss/deploysignal-engine/detectors/e-sr-mean-shift');
const enginePkg = require('@johnpatrickwarren-oss/deploysignal-engine/package.json');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MODE = arg('--mode', 'sim');
const QUICK = process.argv.includes('--quick');
const WORKERS = Number(arg('--workers', '10'));
if (MODE === 'live' && QUICK) { console.error('--quick may not write under results/live'); process.exit(1); }

// ── registered constants (PREREGISTRATION §2) ──
const N = QUICK ? 8 : 1000;
const TRUTH_M = QUICK ? 10 : 200;
const SEED = 20260913;
const TRUTH_SEED = 30000001;
const Q = 0.05;
const NU0 = 100, CENSOR = 300;
const FS = [3, 5], DELTAS = [2.58, 5.16], GAPS = [5, 20, 50];
const SIGNAL = 'p99_latency';
const ALPHA_A = DEFAULT_DETECT.alphaA, ALPHA_ARL = 1e-3;
const CAL = { seed: 0xca11b, ticks: 2000 };
const CELLS = []; for (const F of FS) for (const delta of DELTAS) for (const g of GAPS) CELLS.push({ F, delta, g, j: CELLS.length });
const ORDERINGS = ['bet', 'mix', 'sr', 'srx', 'ebh'];

const SNAP = generateFabric(DEFAULT_FABRIC);
const { calibration, ctx } = calibrateForSession(SNAP, CAL, DEFAULT_DETECT);
const P99 = SIGNALS.indexOf(SIGNAL);
if (P99 < 0) throw new Error('signal index');
const IDS = [...SNAP.path_classes].sort();
const P = SIGNALS.length;
const LEAVES_OF = (r) => new Set(SNAP.edges.filter((e) => e.resource === r).map((e) => e.path_class));

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const se = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) / xs.length); };
const sd = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const INF = Number.POSITIVE_INFINITY;
const asOrd = (v) => (v < 0 ? INF : v);
const pairScore = (oa, ob) => (oa < ob ? 1 : oa > ob ? 0 : 0.5);

function degradationsFor(F, delta, g) {
  return Array.from({ length: F }, (_, k) => ({ resource_id: `bundle-${k}`, delta, start_tick: NU0 + k * g, signal: SIGNAL, mode: 'mean' }));
}

/** Realised residual shift on p99 over the degraded leaves, from TRUTH_M seeds with the fault from tick 0. */
function truthFor(delta) {
  const leaves = new Set(); for (let k = 0; k < 5; k++) for (const pc of LEAVES_OF(`bundle-${k}`)) leaves.add(pc);
  let s = 0, n = 0;
  for (let j = 0; j < TRUTH_M; j++) {
    const res = standardizeAll(generateTelemetry(SNAP, { seed: TRUTH_SEED + 7919 * j, ticks: 200, degradations: [0, 1, 2, 3, 4].map((k) => ({ resource_id: `bundle-${k}`, delta, start_tick: 0, signal: SIGNAL, mode: 'mean' })) }).series, calibration);
    for (const pc of leaves) for (const v of res.get(pc)) { s += v[P99]; n++; }
  }
  return { delta, leaves: leaves.size, mean_theta: s / n };
}

/** One replication: the fabric with F bundles degraded at staggered start_ticks; per leaf the tick of
 *  the shipped Family A crossing (bet), the mixture family-mean crossing (mix), the e-SR family-mean
 *  crossing (srx) with the argmax signal's onset_estimate (sr), and first e-BH selection (ebh). */
function replicate(seed, F, delta, g, T) {
  const raw = generateTelemetry(SNAP, { seed, ticks: T, degradations: degradationsFor(F, delta, g) });
  const resid = standardizeAll(raw.series, calibration);
  const session = openSession({ snapshot: SNAP, calibration, q: Q, ctx, drain_top_k: 1 });
  const mp = { mixture_distribution: 'gaussian', gaussian_sigma_squared_prior: CS_SIGMA_SQUARED_PRIOR, ar1_phi: 0 };
  const sp = { alpha_arl: ALPHA_ARL };
  const leaf = new Map(IDS.map((pc) => [pc, { mixS: SIGNALS.map(() => mix.freshMixtureSupermartingaleState()), srS: SIGNALS.map(() => esr.freshESrMeanShiftState(sp)), bet: -1, mixT: -1, srx: -1, sr: -1, ebh: -1 }]));
  let lastSelected = null;
  for (let t = 0; t < T; t++) {
    const tick = new Map(); for (const pc of IDS) tick.set(pc, raw.series.get(pc)[t]);
    session.ingest(tick);
    const verdicts = [];
    for (const pc of IDS) {
      const ls = session.leaves.get(pc);
      const v = session.segmentVerdict(pc, ls.det);
      verdicts.push(v);
      const L = leaf.get(pc);
      if (L.bet < 0 && v.detectors[0].fired) L.bet = t;
      const r = resid.get(pc)[t];
      if (L.mixT < 0) {
        let s = 0;
        for (let i = 0; i < P; i++) { mix.evaluatePageCusumMixtureSupermartingale({ x_centered: r[i], live_value: r[i], baseline_mean: 0, sigma_squared: 1, params: mp, state: L.mixS[i], alpha: ALPHA_A, ar1_phi: 0 }); s += L.mixS[i].M_t; }
        if (s / P >= 1 / ALPHA_A) L.mixT = t;
      }
      if (L.srx < 0) {
        let logs = -Infinity, best = -1, bestLog = -Infinity, bestOnset = -1;
        for (let i = 0; i < P; i++) { const o = esr.evaluateESrMeanShift(r[i], sp, L.srS[i]); logs = Math.log(Math.exp(logs) + Math.exp(o.log_M)); if (o.log_M > bestLog) { bestLog = o.log_M; best = i; bestOnset = o.onset_estimate; } }
        if (logs - Math.log(P) >= Math.log(1 / ALPHA_ARL)) { L.srx = t; L.sr = bestOnset; }
      }
    }
    lastSelected = buildSurface(verdicts, Q).selected_path_class_ids;
    for (const pc of lastSelected) { const L = leaf.get(pc); if (L.ebh < 0) L.ebh = t; }
  }
  // parity (§1, §4): the reconstructed per-tick verdicts and selection equal the shipped audit at T.
  const aud = session.audit();
  const parity = JSON.stringify(aud.verdicts.map((v) => v.e_value)) === JSON.stringify(IDS.map((pc) => session.segmentVerdict(pc, session.leaves.get(pc).det).e_value))
    && JSON.stringify([...aud.selected_path_class_ids].sort()) === JSON.stringify([...lastSelected].sort());
  // batch residual sums equal the session's (ADR-0027 byte-equality), so the mixture/e-SR saw the shipped residuals
  let residParity = true;
  for (const pc of IDS) { const ls = session.leaves.get(pc); const rs = resid.get(pc); let s = 0; for (let t = 0; t < T; t++) s += rs[t][P99]; if (Math.abs(s - ls.det.csSums[P99]) > 1e-9) residParity = false; }
  return { leaf, parity: parity && residParity };
}

function cell(F, delta, g) {
  const T = NU0 + (F - 1) * g + CENSOR;
  const nuLast = NU0 + (F - 1) * g;
  const bundles = Array.from({ length: F }, (_, k) => ({ leaves: [...LEAVES_OF(`bundle-${k}`)], nu: NU0 + k * g }));
  const onsetOf = new Map(); for (const b of bundles) for (const pc of b.leaves) onsetOf.set(pc, b.nu);
  const faulted = [...onsetOf.keys()];
  const nulls = IDS.filter((pc) => !onsetOf.has(pc));
  const statOf = (L, o) => (o === 'bet' ? L.bet : o === 'mix' ? L.mixT : o === 'srx' ? L.srx : o === 'sr' ? L.sr : L.ebh);
  const crossKey = (o) => (o === 'sr' ? 'srx' : o);
  const acc = Object.fromEntries(ORDERINGS.map((o) => [o, { A: [], Ares: [], phi: [], delays: [], detected: 0, faultedN: 0, preOnset: 0, uncrossedPairs: 0, pairs: 0, onsetErr: [], within: 0, crossedFaulted: 0 }]));
  const diff = { sr_bet: [], sr_mix: [] };
  let parityFails = 0;
  for (let i = 0; i < N; i++) {
    const { leaf, parity } = replicate(SEED + 7919 * i + 1_000_000 * CELLS.find((c) => c.F === F && c.delta === delta && c.g === g).j, F, delta, g, T);
    if (!parity) parityFails++;
    const aOf = {};
    for (const o of ORDERINGS) {
      const a = acc[o];
      let score = 0, pairs = 0;
      for (let x = 0; x < faulted.length; x++) for (let y = x + 1; y < faulted.length; y++) {
        const pa = faulted[x], pb = faulted[y];
        if (onsetOf.get(pa) === onsetOf.get(pb)) continue;
        const [first, second] = onsetOf.get(pa) < onsetOf.get(pb) ? [pa, pb] : [pb, pa];
        const oa = asOrd(statOf(leaf.get(first), o)), ob = asOrd(statOf(leaf.get(second), o));
        score += pairScore(oa, ob); pairs++;
        if (oa === INF || ob === INF) a.uncrossedPairs++;
      }
      a.pairs += pairs; aOf[o] = score / pairs; a.A.push(aOf[o]);
      // resource level: median leaf statistic per bundle
      const bStat = bundles.map((b) => median(b.leaves.map((pc) => asOrd(statOf(leaf.get(pc), o)))));
      let rs = 0, rp = 0; for (let x = 0; x < F; x++) for (let y = x + 1; y < F; y++) { rs += pairScore(bStat[x], bStat[y]); rp++; }
      a.Ares.push(rs / rp);
      let fs = 0; for (const pc of nulls) { const c = statOf(leaf.get(pc), crossKey(o)); if (c >= 0 && c < nuLast) fs++; }
      a.phi.push(fs / nulls.length);
      for (const pc of faulted) {
        a.faultedN++;
        const c = statOf(leaf.get(pc), crossKey(o)); const nu = onsetOf.get(pc);
        if (c >= 0) { a.detected++; a.delays.push(c - nu); if (c < nu) a.preOnset++; }
        if (o === 'sr' && c >= 0) { a.crossedFaulted++; const err = Math.abs(leaf.get(pc).sr - nu); a.onsetErr.push(err); if (err <= g / 2) a.within++; }
      }
    }
    diff.sr_bet.push(aOf.sr - aOf.bet); diff.sr_mix.push(aOf.sr - aOf.mix);
  }
  const per_ordering = ORDERINGS.map((o) => {
    const a = acc[o]; const A = mean(a.A), As = se(a.A); const pd = a.detected / a.faultedN;
    return { ordering: o, A, A_se: As, e1: pd < 0.5 ? 'NOT-SCORED' : (A - 3 * As > 0.5 ? 'HELD' : 'FAILED'),
      e2: g === 50 ? (pd < 0.5 ? 'NOT-SCORED' : (A >= 0.8 ? 'HELD' : 'FAILED')) : null,
      A_resource: mean(a.Ares), A_resource_se: se(a.Ares),
      phi: mean(a.phi), phi_se: se(a.phi), e4: (o === 'bet' || o === 'mix') ? (mean(a.phi) <= 0.02 ? 'HELD' : 'FAILED') : null,
      p_detect: pd, delay_mean: a.delays.length ? mean(a.delays) : null, delay_sd: a.delays.length ? sd(a.delays) : null, pre_onset_frac: a.preOnset / a.faultedN,
      uncrossed_pair_frac: a.uncrossedPairs / a.pairs,
      onset_err_mean: o === 'sr' && a.onsetErr.length ? mean(a.onsetErr) : null, onset_within_half_gap: o === 'sr' && a.crossedFaulted ? a.within / a.crossedFaulted : null };
  });
  const e3 = { sr_minus_bet: mean(diff.sr_bet), sr_minus_bet_se: se(diff.sr_bet), sr_minus_mix: mean(diff.sr_mix), sr_minus_mix_se: se(diff.sr_mix),
    verdict: delta === 2.58 && g === 5 ? ((mean(diff.sr_bet) > 3 * se(diff.sr_bet) && mean(diff.sr_mix) > 3 * se(diff.sr_mix)) ? 'HELD' : 'FAILED') : null };
  return { F, delta, g, nu_last: nuLast, T, n: N, faulted_leaves: faulted.length, null_leaves: nulls.length, per_ordering, e3, parity_failures: parityFails, exceptions: 0 };
}

if (!isMainThread) {
  const out = workerData.cells.map((c) => { const r = cell(c.F, c.delta, c.g); parentPort.postMessage({ progress: r }); return r; });
  parentPort.postMessage({ done: out });
} else {
  const t0 = Date.now();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const runDir = join(STUDY, 'results', MODE === 'live' ? 'live' : 'sim', `run-${stamp}`);
  if (existsSync(runDir)) { console.error(`refusing to reuse ${runDir}`); process.exit(1); }
  mkdirSync(runDir, { recursive: true });
  const truth = DELTAS.map(truthFor);
  console.log('truth: ' + truth.map((t) => `Δ ${t.delta} → θ ${t.mean_theta.toFixed(3)} over ${t.leaves} leaves`).join('; '));
  const nw = Math.max(1, Math.min(WORKERS, CELLS.length));
  const shards = Array.from({ length: nw }, () => []);
  CELLS.forEach((c, i) => shards[i % nw].push(c));
  const results = await Promise.all(shards.map((cells) => new Promise((res, rej) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { cells }, argv: process.argv.slice(2) });
    w.on('message', (m) => { if (m.progress) { const c = m.progress; console.log(`F=${c.F} Δ=${c.delta} g=${c.g}: ` + c.per_ordering.map((o) => `${o.ordering} A=${o.A.toFixed(3)}±${o.A_se.toFixed(3)} ${o.e1} Φ=${o.phi.toFixed(3)} pdet=${o.p_detect.toFixed(3)}`).join(' | ') + ` parityFail=${c.parity_failures}`); } if (m.done) res(m.done); });
    w.on('error', rej);
    w.on('exit', (code) => { if (code !== 0) rej(new Error(`worker exit ${code}`)); });
  })));
  const cells = results.flat().sort((a, b) => CELLS.find((c) => c.F === a.F && c.delta === a.delta && c.g === a.g).j - CELLS.find((c) => c.F === b.F && c.delta === b.delta && c.g === b.g).j);
  const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const manifest = { study: '2026-09-sequencing', substrate: 'tessera-rng', run: `run-${stamp}`, mode: MODE, quick: QUICK,
    git_sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim(), engine_version: enginePkg.version,
    harness_sha256: sha256(fileURLToPath(import.meta.url)), registration_sha256: sha256(join(STUDY, 'PREREGISTRATION.md')),
    n: N, seed: SEED, truth_seed: TRUTH_SEED, truth_M: TRUTH_M, truth, q: Q, nu0: NU0, censor: CENSOR, fs: FS, deltas: DELTAS, gaps: GAPS, alpha_a: ALPHA_A, alpha_arl: ALPHA_ARL,
    calibration_ticks: CAL.ticks, calibration_seed: CAL.seed, leaves: IDS.length, bundles: [0, 1, 2, 3, 4].map((k) => ({ resource: `bundle-${k}`, leaves: LEAVES_OF(`bundle-${k}`).size })),
    workers: nw, cells: cells.length, wall_seconds: Math.round((Date.now() - t0) / 1000), argv: process.argv.slice(2) };
  writeFileSync(join(runDir, 'cells.json'), JSON.stringify(cells, null, 2) + '\n');
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(runDir, 'REPORT.md'), render(cells, manifest));
  console.log(`wrote ${runDir} (${cells.length} cells, ${manifest.wall_seconds} s)`);
}
