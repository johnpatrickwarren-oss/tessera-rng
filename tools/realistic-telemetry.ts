/**
 * Robust RNG test network — realistic TEMPORAL enrichment of the synthetic telemetry (ADR/round:
 * telemetry realism). Grounded in design/research/telemetry-temporal-characterization.md (deep-research
 * dive, fat-tree → RNG temporal extrapolation). This is a VALIDATION instrument (a tools/ harness like
 * coverage.ts), not product code: it post-processes a telemetry series to add the two stressors that
 * actually exercise null-building, leaving the RNG incidence/correlation model untouched:
 *
 *   1. a REAL weekly signal (weekday/weekend baseline shift) — so day-of-week is a GENERATED dimension,
 *      not the modeled-but-empty one the depth-check exposed;
 *   2. CLUSTERED (Markov, NOT Poisson) per-leaf aberrations — the "aberrations that always happen"
 *      (median ~7.5 bursts/s in reality, clustered KS p~0) that a robust healthy null must TOSS.
 *
 * Deferred (recorded gaps, not modelled here): heavy-tailed/right-skewed marginals; sub-ms cadence
 * beneath a minute rollup; shared (fleet-wide) aberrations; retransmit/flow-completion are proxies.
 */
import { makeRng } from '../src/rng';

const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;

export interface RealisticParams {
  seed: number;
  /** weekend baseline multiplier vs weekday (real data: ~modest swing; default 0.7 = 30% lighter). */
  weekendFactor?: number;
  /** per-leaf per-tick probability of ENTERING a burst from calm (default 0.03). */
  aberrationEnter?: number;
  /** probability of STAYING in a burst once in it — the clustering/persistence (default 0.6, ≫ enter
   *  ⇒ bursts run in clusters, not independent Poisson spikes). */
  aberrationPersist?: number;
  /** burst magnitude added to every signal during a burst, in raw units (default 6 — a clear outlier). */
  aberrationMag?: number;
  /** if false, only the weekly signal is added (no aberrations) — for isolating the two effects. */
  aberrations?: boolean;
}

const DEFAULTS: Required<Omit<RealisticParams, 'seed'>> = {
  weekendFactor: 0.7, aberrationEnter: 0.03, aberrationPersist: 0.6, aberrationMag: 6, aberrations: true,
};

/** weekday/weekend baseline offset for a tick (additive, in raw units) — learnable by the per-cell
 *  HoD×DoW calibration because the cell key includes day-of-week. */
function weeklyOffset(tick: number, weekendFactor: number, baseLevel: number): number {
  const dow = Math.floor(tick / HOURS_PER_DAY) % DAYS_PER_WEEK;
  const weekend = dow >= 5;
  return weekend ? (weekendFactor - 1) * baseLevel : 0; // weekends sit weekendFactor× of the weekday level
}

/**
 * Enrich a raw telemetry series (leaf → ticks×signals) with a weekly signal and clustered aberrations.
 * Pure: returns a fresh series. Seeded & deterministic. The weekly offset is applied to EVERY tick;
 * the aberration burst is a per-leaf 2-state Markov walk (calm↔burst) adding `aberrationMag` to all
 * signals while in burst — clustered because persist ≫ enter.
 */
export function enrichRealistic(series: ReadonlyMap<string, ReadonlyArray<ReadonlyArray<number>>>, params: RealisticParams): Map<string, number[][]> {
  const p = { ...DEFAULTS, ...params };
  const rng = makeRng(params.seed);
  const out = new Map<string, number[][]>();
  // a representative baseline level per signal (the synthetic SIGNAL_BASE) to scale the weekly offset.
  const baseLevel = [10, 0.5, 0.1, 0.2, 0.99];
  for (const pc of [...series.keys()].sort()) {
    const matrix = series.get(pc)!.map((row) => [...row]);
    let inBurst = false;
    for (let t = 0; t < matrix.length; t++) {
      // clustered aberration state: enter from calm w.p. enter; stay from burst w.p. persist.
      inBurst = inBurst ? rng.next() < p.aberrationPersist : rng.next() < p.aberrationEnter;
      for (let s = 0; s < matrix[t].length; s++) {
        matrix[t][s] += weeklyOffset(t, p.weekendFactor, baseLevel[s] ?? 1);
        if (p.aberrations && inBurst) matrix[t][s] += p.aberrationMag;
      }
    }
    out.set(pc, matrix);
  }
  return out;
}

/** Fraction of ticks in a burst, and a crude run-length proxy — for confirming clustering in tests. */
export function burstStats(series: ReadonlyMap<string, ReadonlyArray<ReadonlyArray<number>>>, params: RealisticParams): { burstFraction: number } {
  // re-derive the burst mask the same way enrichRealistic does, for one leaf, to report clustering.
  const p = { ...DEFAULTS, ...params };
  const rng = makeRng(params.seed);
  let bursts = 0;
  let total = 0;
  for (const pc of [...series.keys()].sort()) {
    let inBurst = false;
    for (let t = 0; t < series.get(pc)!.length; t++) {
      inBurst = inBurst ? rng.next() < p.aberrationPersist : rng.next() < p.aberrationEnter;
      if (inBurst) bursts += 1;
      total += 1;
    }
  }
  return { burstFraction: bursts / total };
}
