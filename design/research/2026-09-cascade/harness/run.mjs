// design/research/2026-09-cascade/harness/run.mjs — the registered harness for 2026-09-cascade
// (PREREGISTRATION.md §2–§3). Fabric, calibration and selection copied from the sequencing and
// e-by-surface harnesses (not imported: they execute on import). Drives the shipped
// IncrementalSession with `reroutes` set, tick by tick, for the Family A crossing and the
// per-tick e-BH selection order; reads the shipped audit for location (culprits, drain target,
// ambiguity groups) and for the e-BY intervals. Cells run in worker threads; each cell's result is
// a pure function of its registered seeds. No catch anywhere. Build first (the harness imports the
// compiled in-place src/*.js).
//
//   node design/research/2026-09-cascade/harness/run.mjs --mode live [--workers 10]
//   node design/research/2026-09-cascade/harness/run.mjs --mode sim --quick     (N = 8, never scored)
//   node design/research/2026-09-cascade/harness/run.mjs --smoke                (one faulted + one null replication, printed)
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
for (const f of ['src/detect.js', 'src/telemetry.js', 'src/pipeline.js', 'src/calibration.js', 'src/fabric.js', 'src/surface.js', 'src/session.js', 'src/epoch.js', 'src/identifiability.js']) {
  if (!existsSync(join(ROOT, f))) throw new Error(`build first: ${f} missing`);
}
const { generateFabric, DEFAULT_FABRIC } = require(join(ROOT, 'src/fabric.js'));
const { generateTelemetry } = require(join(ROOT, 'src/telemetry.js'));
const { standardizeAll } = require(join(ROOT, 'src/calibration.js'));
const { calibrateForSession } = require(join(ROOT, 'src/pipeline.js'));
const { DEFAULT_DETECT } = require(join(ROOT, 'src/detect.js'));
const { buildSurface } = require(join(ROOT, 'src/surface.js'));
const { openSession } = require(join(ROOT, 'src/session.js'));
const { makeEpochs, changedLeaves } = require(join(ROOT, 'src/epoch.js'));
const { identifiabilityCertificate } = require(join(ROOT, 'src/identifiability.js'));
const { SIGNALS } = require(join(ROOT, 'src/signals.js'));
const enginePkg = require('@johnpatrickwarren-oss/deploysignal-engine/package.json');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MODE = arg('--mode', 'sim');
const QUICK = process.argv.includes('--quick');
const SMOKE = process.argv.includes('--smoke');
const WORKERS = Number(arg('--workers', '10'));
if (MODE === 'live' && QUICK) { console.error('--quick may not write under results/live'); process.exit(1); }

// ── registered constants (PREREGISTRATION §2) ──
const N = QUICK ? 8 : 500;
const TRUTH_M = QUICK ? 10 : 200;
const SEED = 20260915;
const TRUTH_SEED = 30000001;
const REROUTE_SEED = 0xca5cad;
const Q = 0.05;
const T0 = 100, CENSOR = 300, MID_OFFSET = 50;
const DELTA_A = 2.58;
const A = 'pzone-0', B_REGISTERED = 'pzone-3';
const SIGNAL = 'p99_latency';
const LAGS = [5, 20, 50], RATIOS = [0.5, 1, 2], FRACS = [0.5, 1];
const ALPHA_A = DEFAULT_DETECT.alphaA;
const CAL = { seed: 0xca11b, ticks: 2000 };
const CELLS = []; for (const f of FRACS) for (const r of (f === 1 ? [2] : RATIOS)) for (const lag of LAGS) CELLS.push({ f, r, lag, j: CELLS.length });
const ORDERINGS = ['bet', 'ebh', 'ctr'];
const SETS = ['stay', 'toB', 'toOther', 'B'];

const SNAP = generateFabric(DEFAULT_FABRIC);
const { calibration, ctx } = calibrateForSession(SNAP, CAL, DEFAULT_DETECT);
const P99 = SIGNALS.indexOf(SIGNAL);
if (P99 < 0) throw new Error('signal index');
const IDS = [...SNAP.path_classes].sort();
const members = (snap, r) => new Set(snap.edges.filter((e) => e.resource === r).map((e) => e.path_class));

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const se = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) / xs.length); };
const sd = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const frac = (xs) => xs.filter(Boolean).length / xs.length;
const INF = Number.POSITIVE_INFINITY;
const asOrd = (v) => (v < 0 ? INF : v);
const pairScore = (oa, ob) => (oa < ob ? 1 : oa > ob ? 0 : 0.5);

/** The cell's epoch structure and leaf sets (§2), fixed by the registered reroute seed. */
function scenario(f, r, lag) {
  const t1 = T0 + lag, T = t1 + CENSOR;
  const reroute = { at_tick: t1, resource_id: A, fraction: f, seed: REROUTE_SEED };
  const epochs = makeEpochs(SNAP, [reroute]);
  const snap1 = epochs[1].snapshot;
  const LA = members(SNAP, A);
  const moved = changedLeaves(SNAP, snap1);
  const dest = new Map();
  for (const pc of moved) { const z = snap1.edges.find((e) => e.path_class === pc && e.resource.startsWith('pzone')).resource; dest.set(z, (dest.get(z) ?? 0) + 1); }
  const B = [...dest.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]?.[0] ?? null;
  if (B !== B_REGISTERED || moved.size === 0) throw new Error(`routing outcome differs from the registration: B=${B}, moved=${moved.size} (NOT-EXECUTABLE)`);
  const LB = members(SNAP, B);
  for (const pc of LA) if (LB.has(pc)) throw new Error('L_A and L_B overlap');
  const toB = new Set([...moved].filter((pc) => members(snap1, B).has(pc)));
  const sets = {
    stay: [...LA].filter((pc) => !moved.has(pc)).sort(),
    toB: [...toB].sort(),
    toOther: [...moved].filter((pc) => !toB.has(pc)).sort(),
    B: [...LB].sort(),
  };
  const onsetOf = new Map(); for (const pc of LA) onsetOf.set(pc, T0); for (const pc of LB) onsetOf.set(pc, t1);
  const nulls = IDS.filter((pc) => !onsetOf.has(pc));
  const degradations = [
    { resource_id: A, delta: DELTA_A, start_tick: T0, signal: SIGNAL, mode: 'mean' },
    { resource_id: B, delta: r * DELTA_A, start_tick: t1, signal: SIGNAL, mode: 'mean' },
  ];
  const cert = [identifiabilityCertificate(SNAP), identifiabilityCertificate(snap1)].map((c) => ({ ambiguity_groups: c.ambiguity_groups.length, fleet_ambiguous: c.fleet_ambiguous.length, identifiable: c.identifiable_count, resources: c.resource_count }));
  return { f, r, lag, t1, T, reroute, epochs, B, LA: [...LA].sort(), LB: sets.B, sets, moved, onsetOf, nulls, degradations, dest: Object.fromEntries([...dest.entries()].sort()), cert };
}

/** Monte-Carlo truth (§2.2, coverage): per leaf in L_A ∪ L_B the mean p99 residual over its current-segment window at T;
 *  and the realised per-tick shift on the stayers (A) and on B's originals (B) over their shifted ticks. */
function truthFor(sc, j) {
  const win = new Map(); for (const pc of [...sc.LA, ...sc.LB]) win.set(pc, sc.moved.has(pc) ? [sc.t1, sc.T] : [0, sc.T]);
  const sums = new Map([...win.keys()].map((pc) => [pc, 0]));
  let sA = 0, nA = 0, sB = 0, nB = 0;
  for (let m = 0; m < TRUTH_M; m++) {
    const res = standardizeAll(generateTelemetry(SNAP, { seed: TRUTH_SEED + 7919 * m + 1_000_000 * j, ticks: sc.T, degradations: sc.degradations, epochs: sc.epochs }).series, calibration);
    for (const [pc, [a, b]] of win) { const s = res.get(pc); let x = 0; for (let t = a; t < b; t++) x += s[t][P99]; sums.set(pc, sums.get(pc) + x); }
    for (const pc of sc.sets.stay) { const s = res.get(pc); for (let t = T0; t < sc.T; t++) { sA += s[t][P99]; nA++; } }
    for (const pc of sc.sets.B) { const s = res.get(pc); for (let t = sc.t1; t < sc.T; t++) { sB += s[t][P99]; nB++; } }
  }
  const theta = new Map(); for (const [pc, [a, b]] of win) theta.set(pc, sums.get(pc) / (TRUTH_M * (b - a)));
  const bySet = Object.fromEntries(SETS.map((k) => [k, sc.sets[k].length ? mean(sc.sets[k].map((pc) => theta.get(pc))) : null]));
  return { theta, shift_A: nA ? sA / nA : null, shift_B: sB / nB, window_mean_by_set: bySet };
}

/** Summary of one shipped audit for P2 (§2.2). */
function locationOf(aud, B) {
  const ids = aud.culprits.map((c) => c.resource_id);
  // ADR-0018: a resource may appear once per evidence-epoch group; first occurrence for rank/epoch, and the
  // best-scoring occurrence's score and epoch (the one drainTargets compares across groups).
  const occ = (r) => aud.culprits.filter((c) => c.resource_id === r);
  const oA = occ(A), oB = occ(B);
  const best = (o) => o.reduce((b, c) => (b === null || c.score > b.score ? c : b), null);
  const bA = best(oA), bB = best(oB);
  return {
    named_A: oA.length > 0, named_B: oB.length > 0, head: ids[0] ?? null, drain: aud.drain_actions[0]?.resource_id ?? null,
    rank_A: ids.indexOf(A) + 1, rank_B: ids.indexOf(B) + 1, occ_A: oA.length, occ_B: oB.length,
    epoch_A: oA.map((c) => c.localized_against_epoch).join('+') || null, epoch_B: oB.map((c) => c.localized_against_epoch).join('+') || null,
    score_A: bA?.score ?? null, score_B: bB?.score ?? null, best_epoch_A: bA?.localized_against_epoch ?? null,
    firing_A: bA?.firing_member_count ?? 0, firing_B: bB?.firing_member_count ?? 0,
    n_culprits: ids.length, n_unexplained: aud.unexplained_path_class_ids.length,
    n_ambiguous: aud.culprits.filter((c) => c.ambiguity_group).length,
    n_selected: aud.selected_path_class_ids.length, n_resets: (aud.eprocess_resets ?? []).length,
  };
}

/** One replication (§2.1): the session with reroutes, per leaf the shipped Family A crossing (bet), the first
 *  e-BH selection from the shipped leaf verdicts (ebh), the effect-interval centre at T (ctr); the audits at
 *  t₁ + 50 and at T. `nullRun` drops both degradations (the smoke check's no-fire arm). */
function replicate(seed, sc, nullRun = false) {
  const raw = generateTelemetry(SNAP, { seed, ticks: sc.T, degradations: nullRun ? [] : sc.degradations, epochs: sc.epochs });
  const session = openSession({ snapshot: SNAP, calibration, q: Q, ctx, reroutes: [sc.reroute], drain_top_k: 1 });
  const leaf = new Map(IDS.map((pc) => [pc, { bet: -1, ebh: -1, ctr: null }]));
  let lastVerdicts = null, lastSelected = null, mid = null;
  for (let t = 0; t < sc.T; t++) {
    const tick = new Map(); for (const pc of IDS) tick.set(pc, raw.series.get(pc)[t]);
    session.ingest(tick);
    const verdicts = [];
    for (const pc of IDS) {
      const ls = session.leaves.get(pc);
      const v = session.leafVerdict(pc, ls); // the combined segment verdict audit() uses; Family A `fired` is any-segment-fired, so its first true tick is the current segment's first crossing
      verdicts.push(v);
      const L = leaf.get(pc);
      if (L.bet < 0 && v.detectors[0].fired) L.bet = t;
    }
    lastVerdicts = verdicts;
    lastSelected = buildSurface(verdicts, Q).selected_path_class_ids;
    for (const pc of lastSelected) { const L = leaf.get(pc); if (L.ebh < 0) L.ebh = t; }
    if (session.tick() === sc.t1 + MID_OFFSET) mid = locationOf(session.audit(), sc.B);
  }
  const aud = session.audit();
  for (const v of aud.verdicts) { const c = v.detectors[0].effect_cs[P99]; if (c.signal !== SIGNAL) throw new Error('effect_cs order'); leaf.get(v.path_class_id).ctr = c.S_t / c.t; }
  const parity = JSON.stringify(aud.verdicts.map((v) => v.e_value)) === JSON.stringify(lastVerdicts.map((v) => v.e_value))
    && JSON.stringify([...aud.selected_path_class_ids].sort()) === JSON.stringify([...lastSelected].sort());
  return { leaf, parity, end: locationOf(aud, sc.B), mid, intervals: aud.effect_intervals, audit: aud };
}

/** P3: misses against the Monte-Carlo truth, by leaf set. */
function coverage(intervals, truth, sc) {
  const setOf = new Map(); for (const k of SETS) for (const pc of sc.sets[k]) setOf.set(pc, k);
  const miss = { all: 0, stay: 0, toB: 0, toOther: 0, B: 0, null: 0 }, n = { all: 0, stay: 0, toB: 0, toOther: 0, B: 0, null: 0 };
  let hw = 0;
  for (const iv of intervals.intervals) {
    const k = iv.signal === SIGNAL ? (setOf.get(iv.path_class_id) ?? 'null') : 'null';
    const th = iv.signal === SIGNAL && truth.theta.has(iv.path_class_id) ? truth.theta.get(iv.path_class_id) : 0;
    const m = th < iv.lower || th > iv.upper;
    n.all++; n[k]++; if (m) { miss.all++; miss[k]++; }
    hw += iv.half_width;
  }
  return { miss, n, hw_sum: hw, alpha_i: intervals.alpha_i };
}

function cell(c) {
  const sc = scenario(c.f, c.r, c.lag);
  const truth = truthFor(sc, c.j);
  const seg = new Set([...sc.sets.toB, ...sc.sets.toOther]);
  const statOf = (L, o) => (o === 'bet' ? L.bet : o === 'ebh' ? L.ebh : L.ctr);
  const ordPair = (o, La, Lb) => (o === 'ctr' ? pairScore(-La.ctr, -Lb.ctr) : pairScore(asOrd(La[o]), asOrd(Lb[o])));
  const acc = Object.fromEntries(ORDERINGS.map((o) => [o, { A: [], Ares: [], Astay: [], Aseg: [], phi: [], detected: 0, faultedN: 0, delays: Object.fromEntries(SETS.map((k) => [k, []])), det: Object.fromEntries(SETS.map((k) => [k, 0])), segBefore: 0, segN: 0 }]));
  const loc = { end: [], mid: [] };
  const cov = { fcr: [], miss: Object.fromEntries(['all', ...SETS, 'null'].map((k) => [k, 0])), n: Object.fromEntries(['all', ...SETS, 'null'].map((k) => [k, 0])), hw: 0, alpha_i: [] };
  let parityFails = 0;
  for (let i = 0; i < N; i++) {
    const rep = replicate(SEED + 7919 * i + 1_000_000 * c.j, sc);
    if (!rep.parity) parityFails++;
    for (const o of ORDERINGS) {
      const a = acc[o];
      let s = 0, p = 0, ss = 0, ps = 0, sg = 0, pg = 0;
      for (const pa of sc.LA) {
        const La = rep.leaf.get(pa);
        for (const pb of sc.LB) {
          const x = ordPair(o, La, rep.leaf.get(pb)); s += x; p++;
          if (seg.has(pa)) { sg += x; pg++; } else { ss += x; ps++; }
        }
      }
      a.A.push(s / p); if (ps) a.Astay.push(ss / ps); if (pg) a.Aseg.push(sg / pg);
      const mA = o === 'ctr' ? -median(sc.LA.map((pc) => rep.leaf.get(pc).ctr)) : median(sc.LA.map((pc) => asOrd(rep.leaf.get(pc)[o])));
      const mB = o === 'ctr' ? -median(sc.LB.map((pc) => rep.leaf.get(pc).ctr)) : median(sc.LB.map((pc) => asOrd(rep.leaf.get(pc)[o])));
      a.Ares.push(pairScore(mA, mB));
      if (o !== 'ctr') {
        let fs = 0; for (const pc of sc.nulls) { const t = rep.leaf.get(pc)[o]; if (t >= 0 && t < sc.t1) fs++; }
        a.phi.push(fs / sc.nulls.length);
        for (const k of SETS) for (const pc of sc.sets[k]) {
          a.faultedN++;
          const t = rep.leaf.get(pc)[o];
          if (t >= 0) { a.detected++; a.det[k]++; a.delays[k].push(t - sc.onsetOf.get(pc)); }
          if (seg.has(pc)) { a.segN++; if (t >= 0 && t < sc.t1) a.segBefore++; }
        }
      }
    }
    loc.end.push(rep.end); loc.mid.push(rep.mid);
    const cv = coverage(rep.intervals, truth, sc);
    cov.fcr.push(cv.n.all ? cv.miss.all / cv.n.all : 0);
    for (const k of Object.keys(cv.n)) { cov.miss[k] += cv.miss[k]; cov.n[k] += cv.n[k]; }
    cov.hw += cv.hw_sum; cov.alpha_i.push(cv.alpha_i);
  }
  const per_ordering = ORDERINGS.map((o) => {
    const a = acc[o];
    const Am = mean(a.A), As = se(a.A);
    const pd = o === 'ctr' ? 1 : a.detected / a.faultedN;
    const scored = pd >= 0.5;
    const out = { ordering: o, A: Am, A_se: As, p1a: scored ? (Am - 3 * As > 0.5 ? 'HELD' : 'FAILED') : 'NOT-SCORED',
      p1b: c.lag === 50 && o !== 'ctr' ? (scored ? (Am >= 0.8 ? 'HELD' : 'FAILED') : 'NOT-SCORED') : null,
      A_resource: mean(a.Ares), A_stay: a.Astay.length ? mean(a.Astay) : null, A_stay_se: a.Astay.length ? se(a.Astay) : null,
      A_seg: a.Aseg.length ? mean(a.Aseg) : null, A_seg_se: a.Aseg.length ? se(a.Aseg) : null,
      p4: c.lag === 50 && c.f === 0.5 && o !== 'ctr' && a.Aseg.length ? (scored ? (mean(a.Aseg) - 3 * se(a.Aseg) > 0.5 ? 'HELD' : 'FAILED') : 'NOT-SCORED') : null,
      p_detect: o === 'ctr' ? null : pd };
    if (o !== 'ctr') {
      out.phi = mean(a.phi); out.phi_se = se(a.phi); out.p1c = o === 'bet' ? (out.phi <= 0.02 ? 'HELD' : 'FAILED') : null;
      out.by_set = Object.fromEntries(SETS.map((k) => [k, { n: sc.sets[k].length, p_detect: sc.sets[k].length ? a.det[k] / (N * sc.sets[k].length) : null, delay_mean: a.delays[k].length ? mean(a.delays[k]) : null, delay_sd: a.delays[k].length > 1 ? sd(a.delays[k]) : null }]));
      out.seg_crossed_before_t1 = a.segN ? a.segBefore / a.segN : null;
    }
    return out;
  });
  const locSummary = (L) => {
    const named = L.filter((x) => x.named_A);
    const eps = (key) => { const m = {}; for (const x of L) { const v = x[key]; if (v === null) continue; m[v] = (m[v] ?? 0) + 1; } return m; };
    const counts = (key) => { const m = {}; for (const x of L) { const v = x[key] ?? 'none'; m[v] = (m[v] ?? 0) + 1; } return Object.fromEntries(Object.entries(m).sort((p, q) => q[1] - p[1])); };
    return { named_A: frac(L.map((x) => x.named_A)), named_B: frac(L.map((x) => x.named_B)),
      head_A: frac(L.map((x) => x.head === A)), head_B: frac(L.map((x) => x.head === sc.B)), head_faulted: frac(L.map((x) => x.head === A || x.head === sc.B)),
      drain_A: frac(L.map((x) => x.drain === A)), drain_B: frac(L.map((x) => x.drain === sc.B)), drain_faulted: frac(L.map((x) => x.drain === A || x.drain === sc.B)),
      drain_counts: counts('drain'), head_counts: counts('head'),
      rank_A_mean: named.length ? mean(named.map((x) => x.rank_A)) : null, rank_B_mean: L.filter((x) => x.named_B).length ? mean(L.filter((x) => x.named_B).map((x) => x.rank_B)) : null,
      epoch_A: eps('epoch_A'), epoch_B: eps('epoch_B'),
      occ_A_mean: named.length ? mean(named.map((x) => x.occ_A)) : null, score_A_mean: named.length ? mean(named.map((x) => x.score_A)) : null, score_B_mean: L.filter((x) => x.named_B).length ? mean(L.filter((x) => x.named_B).map((x) => x.score_B)) : null, best_epoch_A: eps('best_epoch_A'),
      firing_A_mean: named.length ? mean(named.map((x) => x.firing_A)) : null, firing_B_mean: L.filter((x) => x.named_B).length ? mean(L.filter((x) => x.named_B).map((x) => x.firing_B)) : null,
      n_culprits_mean: mean(L.map((x) => x.n_culprits)), n_unexplained_mean: mean(L.map((x) => x.n_unexplained)),
      n_ambiguous_total: L.reduce((s, x) => s + x.n_ambiguous, 0), n_selected_mean: mean(L.map((x) => x.n_selected)), p_empty: frac(L.map((x) => x.n_selected === 0)), n_resets: L[0].n_resets };
  };
  const end = locSummary(loc.end), mid = locSummary(loc.mid);
  const p2scored = end.p_empty <= 0.1;
  const p2a_applies = c.f === 0.5 || c.lag === 50;
  const p2 = { end, mid, scored: p2scored,
    p2a: p2a_applies ? (p2scored ? (end.named_A >= 0.9 ? 'HELD' : 'FAILED') : 'NOT-SCORED') : null,
    p2b: p2scored ? (end.drain_faulted >= 0.95 ? 'HELD' : 'FAILED') : 'NOT-SCORED',
    p2b_head: p2scored ? (end.head_faulted >= 0.95 ? 'HELD' : 'FAILED') : 'NOT-SCORED' };
  const fcr = mean(cov.fcr), fcrSe = se(cov.fcr);
  const p3 = { fcr, fcr_se: fcrSe, verdict: fcr <= Q + 3 * fcrSe ? 'HELD' : 'FAILED', n_intervals: cov.n.all, mean_half_width: cov.n.all ? cov.hw / cov.n.all : null, alpha_i_mean: mean(cov.alpha_i),
    miss_by_set: Object.fromEntries(Object.keys(cov.n).map((k) => [k, cov.n[k] ? cov.miss[k] / cov.n[k] : null])), n_by_set: cov.n };
  return { f: c.f, r: c.r, lag: c.lag, j: c.j, t1: sc.t1, T: sc.T, n: N, B: sc.B, sets: Object.fromEntries(SETS.map((k) => [k, sc.sets[k].length])), null_leaves: sc.nulls.length, pairs: sc.LA.length * sc.LB.length,
    dest: sc.dest, certificate: sc.cert, truth: { shift_A: truth.shift_A, shift_B: truth.shift_B, window_mean_by_set: truth.window_mean_by_set, M: TRUTH_M },
    per_ordering, p2, p3, parity_failures: parityFails, exceptions: 0 };
}

function smoke() {
  const sc = scenario(0.5, 2, 50);
  console.log(`scenario f=0.5 r=2 lag=50: B=${sc.B} dest=${JSON.stringify(sc.dest)} sets=${JSON.stringify(Object.fromEntries(SETS.map((k) => [k, sc.sets[k].length])))} nulls=${sc.nulls.length} cert=${JSON.stringify(sc.cert)}`);
  for (const nullRun of [false, true]) {
    const rep = replicate(SEED + 424242, sc, nullRun);
    const cross = (o, pcs) => pcs.map((pc) => rep.leaf.get(pc)[o]).filter((t) => t >= 0);
    console.log(`${nullRun ? 'NULL' : 'FAULTED'} replication: parity=${rep.parity} selected=${rep.end.n_selected} resets=${rep.end.n_resets}`);
    for (const k of SETS) console.log(`  ${k} (${sc.sets[k].length}): bet crossed ${cross('bet', sc.sets[k]).length} median ${cross('bet', sc.sets[k]).length ? median(cross('bet', sc.sets[k])) : '—'}; ebh selected ${cross('ebh', sc.sets[k]).length} median ${cross('ebh', sc.sets[k]).length ? median(cross('ebh', sc.sets[k])) : '—'}; ctr median ${median(sc.sets[k].map((pc) => rep.leaf.get(pc).ctr)).toFixed(3)}`);
    console.log(`  nulls (${sc.nulls.length}): bet crossed ${cross('bet', sc.nulls).length}; ebh selected ${cross('ebh', sc.nulls).length}; ctr median ${median(sc.nulls.map((pc) => rep.leaf.get(pc).ctr)).toFixed(3)}`);
    console.log(`  audit@T: ${JSON.stringify(rep.end)}`);
    console.log(`  audit@t1+50: ${JSON.stringify(rep.mid)}`);
    console.log(`  culprits: ${rep.audit.culprits.map((c) => `${c.resource_id}(e${c.localized_against_epoch},score ${c.score.toFixed(1)},fire ${c.firing_member_count}/${c.traversing_count})`).join(' ')}`);
    console.log(`  intervals: ${rep.intervals.intervals.length} at alpha_i ${rep.intervals.alpha_i.toFixed(4)}; p99 centres: stay ${rep.intervals.intervals.filter((iv) => iv.signal === SIGNAL && sc.sets.stay.includes(iv.path_class_id)).slice(0, 2).map((iv) => `${iv.center.toFixed(2)}±${iv.half_width.toFixed(2)}`).join(' ')} | B ${rep.intervals.intervals.filter((iv) => iv.signal === SIGNAL && sc.sets.B.includes(iv.path_class_id)).slice(0, 2).map((iv) => `${iv.center.toFixed(2)}±${iv.half_width.toFixed(2)}`).join(' ')} | toB ${rep.intervals.intervals.filter((iv) => iv.signal === SIGNAL && sc.sets.toB.includes(iv.path_class_id)).slice(0, 2).map((iv) => `${iv.center.toFixed(2)}±${iv.half_width.toFixed(2)}`).join(' ')}`);
  }
}

if (SMOKE) {
  smoke();
} else if (!isMainThread) {
  const out = workerData.cells.map((c) => { const r = cell(c); parentPort.postMessage({ progress: r }); return r; });
  parentPort.postMessage({ done: out });
} else {
  const t0 = Date.now();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const runDir = join(STUDY, 'results', MODE === 'live' ? 'live' : 'sim', `run-${stamp}`);
  if (existsSync(runDir)) { console.error(`refusing to reuse ${runDir}`); process.exit(1); }
  mkdirSync(runDir, { recursive: true });
  const nw = Math.max(1, Math.min(WORKERS, CELLS.length));
  const shards = Array.from({ length: nw }, () => []);
  CELLS.forEach((c, i) => shards[i % nw].push(c));
  const results = await Promise.all(shards.map((cells) => new Promise((res, rej) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { cells }, argv: process.argv.slice(2) });
    w.on('message', (m) => {
      if (m.progress) { const c = m.progress; console.log(`f=${c.f} r=${c.r} lag=${c.lag}: ` + c.per_ordering.map((o) => `${o.ordering} A=${o.A.toFixed(3)}±${o.A_se.toFixed(3)} ${o.p1a}`).join(' | ') + ` | named_A ${c.p2.end.named_A.toFixed(2)} drain ${JSON.stringify(c.p2.end.drain_counts)} | fcr ${c.p3.fcr.toFixed(4)} ${c.p3.verdict} | parityFail=${c.parity_failures}`); }
      if (m.done) res(m.done);
    });
    w.on('error', rej);
    w.on('exit', (code) => { if (code !== 0) rej(new Error(`worker exit ${code}`)); });
  })));
  const cells = results.flat().sort((a, b) => a.j - b.j);
  const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const manifest = { study: '2026-09-cascade', substrate: 'tessera-rng', run: `run-${stamp}`, mode: MODE, quick: QUICK,
    git_sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim(), engine_version: enginePkg.version,
    harness_sha256: sha256(fileURLToPath(import.meta.url)), registration_sha256: sha256(join(STUDY, 'PREREGISTRATION.md')),
    n: N, seed: SEED, truth_seed: TRUTH_SEED, truth_M: TRUTH_M, reroute_seed: REROUTE_SEED, q: Q, t0: T0, censor: CENSOR, mid_offset: MID_OFFSET, delta_a: DELTA_A, A, B: B_REGISTERED,
    lags: LAGS, ratios: RATIOS, fractions: FRACS, alpha_a: ALPHA_A, calibration_ticks: CAL.ticks, calibration_seed: CAL.seed, leaves: IDS.length,
    workers: nw, cells: cells.length, wall_seconds: Math.round((Date.now() - t0) / 1000), argv: process.argv.slice(2) };
  writeFileSync(join(runDir, 'cells.json'), JSON.stringify(cells, null, 2) + '\n');
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(runDir, 'REPORT.md'), render(cells, manifest));
  console.log(`wrote ${runDir} (${cells.length} cells, ${manifest.wall_seconds} s)`);
}
