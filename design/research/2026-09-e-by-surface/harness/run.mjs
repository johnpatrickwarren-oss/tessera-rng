// design/research/2026-09-e-by-surface/harness/run.mjs — the registered harness (PREREGISTRATION §3).
// Build first: the harness imports the repo's compiled in-place src/*.js and the engine's fleet/e-by.
//   node design/research/2026-09-e-by-surface/harness/run.mjs --mode live
//   node design/research/2026-09-e-by-surface/harness/run.mjs --mode sim --quick     (N = 10, never scored)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { render } from '../analysis/report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUDY = resolve(HERE, '..');
const ROOT = resolve(STUDY, '../../..');
const require = createRequire(join(ROOT, 'package.json'));
for (const f of ['src/detect.js', 'src/telemetry.js', 'src/pipeline.js', 'src/calibration.js', 'src/fabric.js', 'src/surface.js', 'src/session.js', 'src/fault-domain-source.js']) {
  if (!existsSync(join(ROOT, f))) throw new Error(`build first: ${f} missing`);
}
const { generateFabric, DEFAULT_FABRIC } = require(join(ROOT, 'src/fabric.js'));
const { generateTelemetry } = require(join(ROOT, 'src/telemetry.js'));
const { standardizeAll } = require(join(ROOT, 'src/calibration.js'));
const { calibrateForSession, leafTStats, assembleAudit } = require(join(ROOT, 'src/pipeline.js'));
const { detectAll, DEFAULT_DETECT, CS_SIGMA_SQUARED_PRIOR } = require(join(ROOT, 'src/detect.js'));
const { buildSurface } = require(join(ROOT, 'src/surface.js'));
const { openSession } = require(join(ROOT, 'src/session.js'));
const { computeFaultDomainHash } = require(join(ROOT, 'src/fault-domain-source.js'));
const { SIGNALS } = require(join(ROOT, 'src/signals.js'));
const { eBenjaminiYekutieli } = require('@johnpatrickwarren-oss/deploysignal-engine/fleet/e-by');
const enginePkg = require('@johnpatrickwarren-oss/deploysignal-engine/package.json');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MODE = arg('--mode', 'sim');
const QUICK = process.argv.includes('--quick');
if (MODE === 'live' && QUICK) { console.error('--quick may not write under results/live'); process.exit(1); }

// ── registered constants (PREREGISTRATION §3) ──
const N = QUICK ? 10 : 500;
const TRUTH_M = QUICK ? 20 : 2000;
const T = 200;
const Q = 0.05;
const DELTAS = [0.05, 0.10];
const SHIFTS = [0, 2, 4];
const DEGRADED_RESOURCE = 'pzone-0';
const SIGNAL = 'p99_latency';
const TOP = 3;
const SEED = 20260907;
const TRUTH_SEED = 30000001;
const CAL = { seed: 0xca11b, ticks: 2000 };
const Z_UNUSED = null;

const SNAP = generateFabric(DEFAULT_FABRIC);
const DEGRADED = new Set(SNAP.edges.filter((e) => e.resource === DEGRADED_RESOURCE).map((e) => e.path_class));
const { calibration, ctx } = calibrateForSession(SNAP, CAL, DEFAULT_DETECT);
const P99 = SIGNALS.indexOf(SIGNAL);
if (P99 < 0) throw new Error('signal index');

const closedForm = (S, t, alpha) => { const v = t + CS_SIGMA_SQUARED_PRIOR; return Math.sqrt(v * Math.log(v / (alpha * alpha * CS_SIGMA_SQUARED_PRIOR))) / t; };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const se = (xs) => { if (xs.length < 2) return NaN; const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) / xs.length); };

function residualsFor(seed, deltaShift) {
  const tel = { seed, ticks: T };
  if (deltaShift > 0) tel.degradation = { resource_id: DEGRADED_RESOURCE, delta: deltaShift, start_tick: 0, signal: SIGNAL, mode: 'mean' };
  return standardizeAll(generateTelemetry(SNAP, tel).series, calibration);
}

/** Monte-Carlo truth per degraded leaf: mean p99 residual under the fixed calibration over TRUTH_M seeds. */
function truthFor(deltaShift) {
  const theta = new Map(); const sums = new Map(), sumsq = new Map(); let n = 0;
  for (let j = 0; j < TRUTH_M; j++) {
    const res = residualsFor(TRUTH_SEED + 7919 * j, deltaShift);
    for (const pc of DEGRADED) {
      const series = res.get(pc); let s = 0;
      for (let t = 0; t < series.length; t++) { const r = series[t][P99]; s += r; sumsq.set(pc, (sumsq.get(pc) ?? 0) + r * r); }
      sums.set(pc, (sums.get(pc) ?? 0) + s);
    }
    n += T;
  }
  const ses = [];
  for (const pc of DEGRADED) { const m = sums.get(pc) / n; const v = sumsq.get(pc) / n - m * m; theta.set(pc, { theta: m, se: Math.sqrt(Math.max(v, 0) / n) }); ses.push(Math.sqrt(Math.max(v, 0) / n)); }
  const th = [...theta.values()].map((x) => x.theta);
  return { theta, summary: { delta_shift: deltaShift, leaves: DEGRADED.size, mean_theta: mean(th), min_theta: Math.min(...th), max_theta: Math.max(...th), mean_se: mean(ses) } };
}

const truthByShift = new Map(SHIFTS.filter((d) => d > 0).map((d) => [d, truthFor(d)]));
const truthOf = (deltaShift, pc, sig) => (deltaShift > 0 && sig === SIGNAL && DEGRADED.has(pc) ? truthByShift.get(deltaShift).theta.get(pc).theta : 0);
const exactTruth = (deltaShift, pc, sig) => !(deltaShift > 0 && sig === SIGNAL && DEGRADED.has(pc));

let deviations = 0;
function evaluate(intervals, deltaShift, alphaI, csById) {
  let miss = 0, exactN = 0, exactMiss = 0, degradedN = 0, degradedExcl = 0; const hw = [];
  for (const iv of intervals) {
    const cs = csById.get(iv.path_class_id).find((c) => c.signal === iv.signal);
    if (Math.abs(iv.half_width - closedForm(cs.S_t, cs.t, alphaI)) > 1e-12) deviations++;
    const th = truthOf(deltaShift, iv.path_class_id, iv.signal);
    const m = th < iv.lower || th > iv.upper; if (m) miss++;
    if (exactTruth(deltaShift, iv.path_class_id, iv.signal)) { exactN++; if (m) exactMiss++; }
    if (iv.signal === SIGNAL && DEGRADED.has(iv.path_class_id) && deltaShift > 0) { degradedN++; if (iv.lower > 0 || iv.upper < 0) degradedExcl++; }
    hw.push(iv.half_width);
  }
  return { miss, n: intervals.length, exactN, exactMiss, degradedN, degradedExcl, hw };
}

function cell(deltaShift, rule, salt) {
  const acc = Object.fromEntries(DELTAS.map((d) => [d, { fcp: [], exactMiss: [], exactN: 0, degN: 0, degExcl: 0, hw: [], ratio: [] }]));
  const sel = [], pairs = [];
  for (let i = 0; i < N; i++) {
    const residuals = residualsFor(SEED + 7919 * i + salt, deltaShift);
    const verdicts = detectAll(residuals, DEFAULT_DETECT, ctx);
    const csById = new Map(verdicts.map((v) => [v.path_class_id, v.detectors.find((d) => d.family === 'A').effect_cs]));
    let S;
    if (rule === 'A') S = buildSurface(verdicts, Q).selected_path_class_ids;
    else { const ts = leafTStats(residuals); S = [...ts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP).map((x) => x[0]); }
    sel.push(S.length); pairs.push(S.length * SIGNALS.length);
    for (const d of DELTAS) {
      let intervals, alphaI;
      if (rule === 'A') { const surf = buildSurface(verdicts, Q, d); intervals = surf.effect_intervals.intervals; alphaI = surf.effect_intervals.alpha_i;
        if (surf.selected_path_class_ids.length !== S.length) throw new Error('selection moved with delta'); }
      else {
        const inputs = S.flatMap((pc) => csById.get(pc).map((c) => ({ id: `${pc}/${c.signal}`, level_free: { S_t: c.S_t, t: c.t, sigma_squared: 1, sigma_squared_prior: CS_SIGMA_SQUARED_PRIOR } })));
        const out = eBenjaminiYekutieli(inputs, verdicts.length * SIGNALS.length, d);
        alphaI = out.alpha_i; intervals = out.intervals.map((iv) => { const k = iv.id.lastIndexOf('/'); return { path_class_id: iv.id.slice(0, k), signal: iv.id.slice(k + 1), center: iv.center, half_width: iv.half_width, lower: iv.lower, upper: iv.upper }; });
      }
      const ev = evaluate(intervals, deltaShift, alphaI, csById);
      const a = acc[d];
      a.fcp.push(ev.n ? ev.miss / ev.n : 0);
      if (ev.exactN) a.exactMiss.push(ev.exactMiss / ev.exactN);
      a.degN += ev.degradedN; a.degExcl += ev.degradedExcl; a.hw.push(...ev.hw);
      for (const iv of intervals) { const cs = csById.get(iv.path_class_id).find((c) => c.signal === iv.signal); a.ratio.push(iv.half_width / closedForm(cs.S_t, cs.t, d)); }
    }
  }
  const per_delta = DELTAS.map((d) => {
    const a = acc[d]; const fcr = mean(a.fcp), s = se(a.fcp);
    return { delta: d, fcr, fcr_se: s, verdict: fcr <= d + 3 * s ? 'HELD' : 'FAILED',
      exact_miss: a.exactMiss.length ? mean(a.exactMiss) : null, exact_miss_se: a.exactMiss.length ? se(a.exactMiss) : null,
      excludes_zero_degraded: a.degN ? a.degExcl / a.degN : null, mean_half_width: a.hw.length ? mean(a.hw) : null, width_ratio: a.ratio.length ? mean(a.ratio) : null };
  });
  return { delta_shift: deltaShift, rule, n: N, mean_selected: mean(sel), mean_pairs: mean(pairs), p_empty: sel.filter((x) => x === 0).length / N, per_delta, closed_form_deviations: deviations };
}

/** P4 parity: for one seed per Δ, the incremental session's audit effect_cs and effect_intervals equal the batch path's, byte for byte. */
function parityCheck(deltaShift, seed) {
  const tel = { seed, ticks: T };
  if (deltaShift > 0) tel.degradation = { resource_id: DEGRADED_RESOURCE, delta: deltaShift, start_tick: 0, signal: SIGNAL, mode: 'mean' };
  const raw = generateTelemetry(SNAP, tel);
  const residuals = standardizeAll(raw.series, calibration);
  const verdicts = detectAll(residuals, DEFAULT_DETECT, ctx);
  const batch = assembleAudit({ snapshot: SNAP, snapshot_hash: computeFaultDomainHash(SNAP), q: Q, verdicts, epochs: null, resets: null, drain_top_k: 1, magnitudeT: leafTStats(residuals), ticks: T });
  const session = openSession({ snapshot: SNAP, calibration, q: Q, ctx, drain_top_k: 1 });
  const ids = [...raw.series.keys()].sort();
  for (let t = 0; t < T; t++) { const tick = new Map(); for (const pc of ids) tick.set(pc, raw.series.get(pc)[t]); session.ingest(tick); }
  const live = session.audit();
  const a = JSON.stringify(batch.verdicts.map((v) => v.detectors.find((d) => d.family === 'A').effect_cs));
  const b = JSON.stringify(live.verdicts.map((v) => v.detectors.find((d) => d.family === 'A').effect_cs));
  return a === b && JSON.stringify(batch.effect_intervals) === JSON.stringify(live.effect_intervals);
}

const t0 = Date.now();
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const runDir = join(STUDY, 'results', MODE === 'live' ? 'live' : 'sim', `run-${stamp}`);
if (existsSync(runDir)) { console.error(`refusing to reuse ${runDir}`); process.exit(1); }
mkdirSync(runDir, { recursive: true });

const cells = []; let idx = 0;
for (const ds of SHIFTS) for (const rule of ['A', 'B']) {
  deviations = 0;
  const c = cell(ds, rule, 1_000_000 * idx++); cells.push(c);
  console.log(`Δ=${ds} rule=${rule}: |S| ${c.mean_selected.toFixed(2)} ` + c.per_delta.map((d) => `δ${d.delta}: fcr ${d.fcr.toFixed(4)}±${d.fcr_se.toFixed(4)} ${d.verdict} exact ${d.exact_miss == null ? '—' : d.exact_miss.toFixed(4)} excl0 ${d.excludes_zero_degraded == null ? '—' : d.excludes_zero_degraded.toFixed(3)}`).join(' | '));
}
let parityChecks = 0, parityEqual = 0;
for (const ds of SHIFTS) { parityChecks++; if (parityCheck(ds, 4242 + ds)) parityEqual++; }
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const manifest = { study: '2026-09-e-by-surface', run: `run-${stamp}`, mode: MODE, quick: QUICK,
  git_sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim(), engine_version: enginePkg.version,
  harness_sha256: sha256(fileURLToPath(import.meta.url)), n: N, T, q: Q, deltas: DELTAS, shifts: SHIFTS, top: TOP, seed: SEED, truth_seed: TRUTH_SEED, truth_M: TRUTH_M,
  calibration_ticks: CAL.ticks, calibration_seed: CAL.seed, leaves: SNAP.edges.length ? new Set(SNAP.edges.map((e) => e.path_class)).size : 0, degraded_leaves: DEGRADED.size,
  truth: [...truthByShift.values()].map((t) => t.summary), parity_checks: parityChecks, parity_equal: parityEqual,
  wall_seconds: Math.round((Date.now() - t0) / 1000), argv: process.argv.slice(2) };
writeFileSync(join(runDir, 'cells.json'), JSON.stringify(cells, null, 2) + '\n');
writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(runDir, 'REPORT.md'), render(cells, manifest));
console.log(`parity ${parityEqual}/${parityChecks}; wrote ${runDir} (${cells.length} cells, ${manifest.wall_seconds} s)`);
