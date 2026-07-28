/**
 * ADR-0050 — generator-side heterogeneity / correlated-null knobs (AC-1..AC-4, generator half).
 *
 * Anti-self-confirming (DISCIPLINES §6): every mechanism assertion is cross-validated against an
 * INDEPENDENT computation over the emitted series (same-seed run differencing / two-pass per-hour
 * demeaning), never against the generator's internals — and each is calibrated to FAIL under a
 * no-op mutant of its knob (σ multiply dropped ⇒ the log-scale dispersion assertion reads 0;
 * λ injection dropped ⇒ the shared-factor difference is identically zero).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTelemetry } from '../src/telemetry';
import type { TelemetryParams } from '../src/telemetry';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { signalIndex } from '../src/signals';
import type { FaultDomainSnapshot, PathClassId } from '../src/domain';

const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
const P99 = signalIndex('p99_latency');

const ser = (p: Partial<TelemetryParams>, snap: FaultDomainSnapshot = SNAP, seed = 7, ticks = 40) =>
  JSON.stringify([...generateTelemetry(snap, { seed, ticks, ...p }).series]);

/** Per-leaf pooled noise sd over one signal via two-pass per-hour demeaning (independent of the
 *  generator: the hour-of-day baseline is the only per-tick structure in a clean run). */
function leafSd(series: ReadonlyArray<readonly number[]>, sig: number): number {
  const byHour = new Map<number, number[]>();
  series.forEach((v, t) => {
    const h = t % 24;
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h)!.push(v[sig]);
  });
  let sq = 0;
  let n = 0;
  for (const vals of byHour.values()) {
    const m = vals.reduce((s, x) => s + x, 0) / vals.length;
    for (const x of vals) {
      sq += (x - m) ** 2;
      n += 1;
    }
  }
  return Math.sqrt(sq / n);
}

const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs: readonly number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

/** Same-seed σ recovery: sd ratio het/base per leaf is EXACTLY σ_pc (identical noise draws). */
function sigmaRatios(het: Partial<TelemetryParams>, ticks = 240, seed = 11): Map<PathClassId, number> {
  const base = generateTelemetry(SNAP, { seed, ticks });
  const hetT = generateTelemetry(SNAP, { seed, ticks, ...het });
  const out = new Map<PathClassId, number>();
  for (const pc of base.series.keys()) {
    out.set(pc, leafSd(hetT.series.get(pc)!, P99) / leafSd(base.series.get(pc)!, P99));
  }
  return out;
}

// ───────────────────────── AC-1: byte-identity at zero ─────────────────────────

test('AC-1: heterogeneity absent ≡ {sigmaLogSd: 0}; latentNull absent ≡ {load: 0} — byte-for-byte', () => {
  const clean = ser({});
  assert.equal(ser({ heterogeneity: { sigmaLogSd: 0 } }), clean, 'ς = 0 must be byte-identical');
  assert.equal(ser({ heterogeneity: { sigmaLogSd: 0, driftMix: 1, driftSeed: 99 } }), clean, 'ς = 0 with drift still byte-identical');
  assert.equal(ser({ latentNull: { load: 0 } }), clean, 'load = 0 must be byte-identical');
  assert.equal(ser({ heterogeneity: { sigmaLogSd: 0 }, latentNull: { load: 0 } }), clean, 'both zeroed ⇒ byte-identical');
});

test('AC-1: a mean-mode fault shift composes independently of the structure knobs', () => {
  // same seed: (het+fault) − (het) must equal (fault) − (clean) at every tick. NB (cold-eye
  // finding 4): a MEAN-mode shift is deterministic (delta·w), so this binds composition, NOT the
  // main-RNG-stream-untouched claim — THAT is bound by AC-2's cross-signal ratio equality (1e-6)
  // and AC-3's exact per-tick relations (1e-9), both of which need identical noise realizations.
  const fault = { resource_id: 'optic-3', delta: 4, start_tick: 0 };
  const het = { heterogeneity: { sigmaLogSd: 0.4 }, latentNull: { load: 0.5 } };
  const runs = {
    clean: generateTelemetry(SNAP, { seed: 5, ticks: 30 }),
    faulted: generateTelemetry(SNAP, { seed: 5, ticks: 30, degradation: fault }),
    het: generateTelemetry(SNAP, { seed: 5, ticks: 30, ...het }),
    hetFaulted: generateTelemetry(SNAP, { seed: 5, ticks: 30, degradation: fault, ...het }),
  };
  for (const pc of runs.clean.series.keys()) {
    for (let t = 0; t < 30; t++) {
      const dPlain = runs.faulted.series.get(pc)![t][P99] - runs.clean.series.get(pc)![t][P99];
      const dHet = runs.hetFaulted.series.get(pc)![t][P99] - runs.het.series.get(pc)![t][P99];
      assert.ok(Math.abs(dPlain - dHet) < 1e-9, `${pc} tick ${t}: fault shift must not depend on the structure knobs`);
    }
  }
});

// ───────────────────────── AC-2: dispersion mechanism ─────────────────────────

test('AC-2: ς > 0 disperses per-leaf noise scale with log-sd ≈ ς; per-leaf means unchanged (kills the σ no-op mutant)', () => {
  const SIGMA = 0.3;
  const ratios = sigmaRatios({ heterogeneity: { sigmaLogSd: SIGMA } });
  const logR = [...ratios.values()].map(Math.log);
  // ratio = σ_pc exactly (same noise realization), so sd(log ratio) = ς·sd(g draws over 109 leaves):
  // sampling tolerance ≈ 3·ς/√(2·(n−1)) ≈ 0.06.
  assert.ok(Math.abs(sd(logR) - SIGMA) < 0.07, `population log-scale dispersion ${sd(logR).toFixed(3)} should be ≈ ς = ${SIGMA}`);
  assert.ok(Math.abs(mean(logR)) < 0.07, `log-scale center ${mean(logR).toFixed(3)} should be ≈ 0 (median-1 multiplier)`);
  // a no-op σ mutant makes every ratio exactly 1 ⇒ sd(logR) = 0 ⇒ the first assertion fails.

  // means untouched: same-seed per-leaf mean difference is (σ−1)·mean(noise) — small; and the σ
  // multiplier must not shift the level systematically across the fleet.
  const base = generateTelemetry(SNAP, { seed: 11, ticks: 240 });
  const het = generateTelemetry(SNAP, { seed: 11, ticks: 240, heterogeneity: { sigmaLogSd: SIGMA } });
  const dMeans = [...base.series.keys()].map((pc) => {
    const b = base.series.get(pc)!.map((v) => v[P99]);
    const h = het.series.get(pc)!.map((v) => v[P99]);
    return mean(h) - mean(b);
  });
  assert.ok(Math.abs(mean(dMeans)) < 0.05, `fleet-mean shift ${mean(dMeans).toFixed(4)} should be ≈ 0`);
  assert.ok(Math.max(...dMeans.map(Math.abs)) < 0.6, 'no leaf gains a systematic level shift from σ');
});

test('AC-2: σ scales ALL signals of a leaf by the same factor', () => {
  const ratiosBySignal: Map<PathClassId, number>[] = [];
  for (let sig = 0; sig < 5; sig++) {
    const base = generateTelemetry(SNAP, { seed: 13, ticks: 240 });
    const het = generateTelemetry(SNAP, { seed: 13, ticks: 240, heterogeneity: { sigmaLogSd: 0.4 } });
    const m = new Map<PathClassId, number>();
    for (const pc of base.series.keys()) m.set(pc, leafSd(het.series.get(pc)!, sig) / leafSd(base.series.get(pc)!, sig));
    ratiosBySignal.push(m);
  }
  for (const pc of ratiosBySignal[0].keys()) {
    const r0 = ratiosBySignal[0].get(pc)!;
    for (let sig = 1; sig < 5; sig++) {
      assert.ok(Math.abs(ratiosBySignal[sig].get(pc)! - r0) < 1e-6, `${pc}: signal ${sig} scale ${ratiosBySignal[sig].get(pc)} ≠ signal 0 scale ${r0}`);
    }
  }
});

// ───────────────────────── AC-3: latent-null mechanism ─────────────────────────

const t9 = (pc: string, r: string, w?: number) => ({ path_class: pc, resource: r, relationship: 'traverses' as const, ...(w !== undefined ? { weight: w } : {}) });
const TINY: FaultDomainSnapshot = {
  nodes: [],
  path_classes: ['pc-a', 'pc-b', 'pc-c', 'pc-d'],
  edges: [t9('pc-a', 'r-shared'), t9('pc-b', 'r-shared', 0.5), t9('pc-c', 'r-other'), t9('pc-d', 'r-other')],
  resources: [
    { id: 'r-shared', kind: 'optic' as const },
    { id: 'r-other', kind: 'optic' as const },
  ],
  fetched_at_ts: 0,
  source_id: 's',
  source_version: 'v',
};

test('AC-3: latent factors ride the WEIGHTED incidence — shared-resource leaves co-move, disjoint leaves do not (kills the λ no-op mutant)', () => {
  const LOAD = 0.8;
  const ticks = 600;
  const base = generateTelemetry(TINY, { seed: 21, ticks });
  const lat = generateTelemetry(TINY, { seed: 21, ticks, latentNull: { load: LOAD } });
  // same seed ⇒ the per-tick primary-signal difference IS load·Σ_r w·λ_r(t), exactly.
  const diff = (pc: string) => base.series.get(pc)!.map((v, t) => lat.series.get(pc)![t][P99] - v[P99]);
  const dA = diff('pc-a');
  const dB = diff('pc-b');
  const dC = diff('pc-c');
  const dD = diff('pc-d');
  assert.ok(sd(dA) > 0.5 * LOAD, `λ contribution must be non-degenerate (sd ${sd(dA).toFixed(3)}) — a no-op mutant zeroes it`);
  // pc-b traverses r-shared at weight 0.5 ⇒ its contribution is EXACTLY half of pc-a's, per tick.
  for (let t = 0; t < ticks; t++) assert.ok(Math.abs(dB[t] - 0.5 * dA[t]) < 1e-9, `tick ${t}: weight-0.5 leaf must carry half the factor`);
  // pc-c and pc-d share r-other ⇒ identical contribution; disjoint from pc-a ⇒ independent stream.
  for (let t = 0; t < ticks; t++) assert.ok(Math.abs(dC[t] - dD[t]) < 1e-9, `tick ${t}: same-incidence leaves carry the same factor`);
  const corr = (x: number[], y: number[]) => {
    const mx = mean(x);
    const my = mean(y);
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < x.length; i++) {
      sxy += (x[i] - mx) * (y[i] - my);
      sxx += (x[i] - mx) ** 2;
      syy += (y[i] - my) ** 2;
    }
    return sxy / Math.sqrt(sxx * syy);
  };
  assert.ok(Math.abs(corr(dA, dC)) < 0.25, `disjoint-resource factors should be ≈ independent (corr ${corr(dA, dC).toFixed(3)})`);
  // non-signal channels untouched: λ is injected on the primary signal only.
  for (const pc of TINY.path_classes) {
    for (let t = 0; t < 20; t++) {
      for (let sig = 0; sig < 5; sig++) {
        if (sig === P99) continue;
        assert.equal(lat.series.get(pc)![t][sig], base.series.get(pc)![t][sig], `${pc} tick ${t} signal ${sig}: λ must not leak off the primary signal`);
      }
    }
  }
});

test('AC-3: latentNull with epochs throws; out-of-domain params throw', () => {
  const epochs = [{ snapshot: TINY, valid_from_tick: 0, hash: 'h' }];
  assert.throws(() => generateTelemetry(TINY, { seed: 1, ticks: 10, latentNull: { load: 0.1 }, epochs }), /latentNull with epochs/);
  assert.throws(() => generateTelemetry(TINY, { seed: 1, ticks: 10, latentNull: { load: -0.1 } }), /load must be/);
  assert.throws(() => generateTelemetry(TINY, { seed: 1, ticks: 10, latentNull: { load: 0.1, phi: 1 } }), /phi must be/);
  assert.throws(() => generateTelemetry(TINY, { seed: 1, ticks: 10, heterogeneity: { sigmaLogSd: -0.2 } }), /sigmaLogSd must be/);
  assert.throws(() => generateTelemetry(TINY, { seed: 1, ticks: 10, heterogeneity: { sigmaLogSd: 0.2, driftMix: 1.5 } }), /driftMix must be/);
});

// ───────────────────────── AC-4: drift mechanism ─────────────────────────

test('AC-4: driftMix 0 ≡ no drift byte-for-byte; driftMix 1 re-assigns WHICH leaves are noisy while preserving the population dispersion', () => {
  const SIGMA = 0.3;
  assert.equal(
    ser({ heterogeneity: { sigmaLogSd: SIGMA } }),
    ser({ heterogeneity: { sigmaLogSd: SIGMA, driftMix: 0, driftSeed: 12345 } }),
    'driftMix 0 must reproduce the base draw exactly, whatever the driftSeed',
  );
  const rBase = sigmaRatios({ heterogeneity: { sigmaLogSd: SIGMA } });
  const rDrift = sigmaRatios({ heterogeneity: { sigmaLogSd: SIGMA, driftMix: 1 } });
  const pcs = [...rBase.keys()];
  const changed = pcs.filter((pc) => Math.abs(Math.log(rDrift.get(pc)!) - Math.log(rBase.get(pc)!)) > 0.02).length;
  assert.ok(changed > pcs.length / 2, `driftMix 1 must re-draw most leaves' σ (changed ${changed}/${pcs.length})`);
  // Dispersion preservation: realized sd of 109 fixed g-draws carries ≈ ±20% sampling spread, so
  // assert a band, not equality. The DISCRIMINATING point for a broken mix formula is m = 0.5 —
  // a linear mix ((1−m)·g_base + m·g_new, missing the √(1−m²)) shrinks dispersion to 0.707·ς
  // there, well below the band floor — while at m = 1 any formula degenerates to the new draw.
  const dispAt = (r: Map<PathClassId, number>) => sd([...r.values()].map(Math.log));
  const dispHalf = dispAt(sigmaRatios({ heterogeneity: { sigmaLogSd: SIGMA, driftMix: 0.5 } }));
  assert.ok(dispHalf > 0.78 * SIGMA && dispHalf < 1.3 * SIGMA, `driftMix 0.5 dispersion ${dispHalf.toFixed(3)} must stay ≈ ς (a linear mix gives ≈ ${(0.707 * SIGMA).toFixed(3)})`);
  const dispFull = dispAt(rDrift);
  assert.ok(dispFull > 0.6 * SIGMA && dispFull < 1.5 * SIGMA, `driftMix 1 dispersion ${dispFull.toFixed(3)} must stay in the ς band`);
});
