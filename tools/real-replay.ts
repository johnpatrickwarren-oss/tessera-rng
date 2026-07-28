/**
 * Real-telemetry replay (ADR-0057): the first measured ς̂ on a REAL concurrent population.
 *
 * Data: the GPU sibling's mac-mini 1 Hz powermetrics collector — the per-core counters form a
 * genuine concurrent population (14 cores × 2 shared signals: c*_mhz, c*_res), with real
 * subpopulation structure (≈half the cores parked at idle) and a natural drift experiment
 * (a 14-day outage + reboot between the calibration and the across-outage live window).
 *
 * HONESTY (Tier 2.5): real telemetry, NOT network telemetry — nothing localization-related
 * runs (no incidence model exists here), and no FDR claim of any kind is made. The objects
 * under test — estimateDispersion, dispersionGate, driftMonitor, the ADR-0052 shrinkage
 * formula — run VERBATIM (imported from src/, AC-2); only leaf standardization is
 * adapter-level, built from the SAME engine primitives the production substrate consumes
 * (robustLocation center + MAD scale, pooled fitArP/prewhitenAr — mirroring
 * calibration.ts:estimateAr's POOLED-FALLBACK path; the per-cell de-mean is replaced by the
 * global pooled one, disclosed in ADR §1), because the production substrate is hardwired to
 * the 5-signal network contract. Recorded narrowing: no byte-anchor to runPipeline is
 * possible across the domain gap.
 *
 * Full-rate day files live OFF-repo (the mini: ~/concord/telemetry/data/, + a local scratch
 * copy); the repo commits 1-in-10 downsampled field-trimmed fixtures for reproducible tests.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fitArP, prewhitenAr } from '@johnpatrickwarren-oss/deploysignal-engine/detectors/ar-p';
import { robustLocation } from '@johnpatrickwarren-oss/deploysignal-engine/fleet/common-mode';
import { estimateDispersion, dispersionGate, logScaleFromSums, DEFAULT_SIGMA_THRESHOLD } from '../src/dispersion-gate';
import type { DispersionEstimate } from '../src/dispersion-gate';
import { driftMonitor } from '../src/drift-monitor';
import type { DriftMonitorVerdict } from '../src/drift-monitor';

const N_CORES = 14;
export const RR_SIGNALS = ['mhz', 'res'] as const;
/** Liveness pre-filter: parked cores idle at residency ≈ 0.005% with rare wake blips; active
 *  cores sit ≥ 0.15%. Mean residency over the calibration window ≥ this ⇒ active. Whether ς̂
 *  needs such a pre-filter on real populations is itself a finding (AC-1). */
const ACTIVE_RES_MEAN = 0.05;
const AR_PMAX = 6;

export type EntitySeries = Map<string, number[][]>; // core id -> ticks × [mhz, res]

/** Parse a slice of an ndjson day file into the per-core population. */
export function parseWindow(text: string, startRow: number, ticks: number): EntitySeries {
  const lines = text.split('\n');
  const out: EntitySeries = new Map();
  for (let c = 0; c < N_CORES; c++) out.set(`c${String(c).padStart(2, '0')}`, []);
  for (let i = startRow; i < startRow + ticks; i++) {
    if (!lines[i]) throw new RangeError(`window [${startRow}, ${startRow + ticks}) runs past the file (${lines.length} lines)`);
    const r = JSON.parse(lines[i]);
    for (let c = 0; c < N_CORES; c++) out.get(`c${String(c).padStart(2, '0')}`)!.push([r[`c${c}_mhz`], r[`c${c}_res`]]);
  }
  return out;
}

/** The shared-calibration substrate from engine primitives (mirrors calibration.ts: robust
 *  global center/scale per signal, pooled BIC AR(p) on the de-meaned concatenation). */
export interface RealSubstrate {
  center: number[];
  scale: number[];
  ar: { phi: number[]; innovationSd: number }[];
  /** ADR-0052 shrinkage arm (λ = ς̂²/raw² on the pooled per-leaf log-scales), when fitted. */
  leafScale?: Map<string, number>;
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function buildRealSubstrate(cal: EntitySeries): RealSubstrate {
  const p = RR_SIGNALS.length;
  const center: number[] = [];
  const scale: number[] = [];
  for (let j = 0; j < p; j++) {
    const col: number[] = [];
    for (const rows of cal.values()) for (const row of rows) col.push(row[j]);
    const med = median(col);
    center.push(robustLocation(col));
    scale.push(Math.max(1.4826 * median(col.map((x) => Math.abs(x - med))), Math.sqrt(1e-9)));
  }
  const ar = Array.from({ length: p }, (_, j) => {
    const col: number[] = [];
    for (const id of [...cal.keys()].sort()) for (const row of cal.get(id)!) col.push((row[j] - center[j]) / scale[j]);
    const fit = fitArP(col, 0, { p_max: AR_PMAX, ic: 'bic' });
    return { phi: fit.phi, innovationSd: Math.sqrt(Math.max(fit.sigma2_innovation, 1e-9)) };
  });
  return { center, scale, ar };
}

/** Standardize a window under the substrate: de-mean/scale, AR-prewhiten, per-leaf divide. */
export function standardizeReal(win: EntitySeries, sub: RealSubstrate): Map<string, number[][]> {
  const p = RR_SIGNALS.length;
  const out = new Map<string, number[][]>();
  for (const id of [...win.keys()].sort()) {
    const rows = win.get(id)!;
    const resid: number[][] = rows.map(() => new Array<number>(p));
    for (let j = 0; j < p; j++) {
      const d = rows.map((row) => (row[j] - sub.center[j]) / sub.scale[j]);
      const innov = prewhitenAr(d, 0, sub.ar[j].phi);
      for (let t = 0; t < rows.length; t++) resid[t][j] = innov[t] / sub.ar[j].innovationSd;
    }
    const ls = sub.leafScale?.get(id);
    out.set(id, ls !== undefined && ls !== 1 ? resid.map((row) => row.map((x) => x / ls)) : resid);
  }
  return out;
}

/** Fit the ADR-0052 shrinkage on calibration residuals (the production λ = ς̂²/raw² formula,
 *  adapter-applied and labeled as such). */
export function fitLeafScales(calResid: ReadonlyMap<string, number[][]>): Map<string, number> {
  const est = estimateDispersion(calResid);
  const lambda = est.raw_log_sd > 0 ? (est.sigma_hat * est.sigma_hat) / (est.raw_log_sd * est.raw_log_sd) : 0;
  const ells = new Map<string, number>();
  for (const id of [...calResid.keys()].sort()) {
    const m = calResid.get(id)!;
    const p = m[0].length;
    const sum = new Array<number>(p).fill(0);
    const sumsq = new Array<number>(p).fill(0);
    for (const row of m) for (let j = 0; j < p; j++) { sum[j] += row[j]; sumsq[j] += row[j] * row[j]; }
    ells.set(id, logScaleFromSums(sum, sumsq, m.length));
  }
  const med = median([...ells.values()]);
  return new Map([...ells].map(([id, l]) => [id, Math.exp(lambda * (l - med))]));
}

export function activeSubset(cal: EntitySeries): string[] {
  const resIdx = RR_SIGNALS.indexOf('res');
  return [...cal.keys()].sort().filter((id) => {
    const rows = cal.get(id)!;
    return rows.reduce((s, r) => s + r[resIdx], 0) / rows.length >= ACTIVE_RES_MEAN;
  });
}

const restrict = (m: ReadonlyMap<string, number[][]>, ids: readonly string[]) => new Map(ids.map((id) => [id, m.get(id)!]));

export interface PopulationCell {
  population: string;
  n_entities: number;
  sigma_hat: number;
  sigma_hat_tail: number;
  raw_log_sd: number;
  sampling_floor_sd: number;
  gate_passing: boolean;
}

export interface MonitorCell {
  window: string;
  arm: 'shared' | 'perLeafScale';
  population: string;
  status: DriftMonitorVerdict['status'];
  pattern: DriftMonitorVerdict['pattern'];
  sigma_hat: number;
  sigma_hat_tail: number;
  threshold: number;
}

function popCell(label: string, est: DispersionEstimate): PopulationCell {
  return {
    population: label,
    n_entities: est.n_leaves,
    sigma_hat: est.sigma_hat,
    sigma_hat_tail: est.sigma_hat_tail,
    raw_log_sd: est.raw_log_sd,
    sampling_floor_sd: est.sampling_floor_sd,
    gate_passing: dispersionGate(est).passing,
  };
}

function monCell(window: string, arm: MonitorCell['arm'], population: string, est: DispersionEstimate, threshold: number): MonitorCell {
  const v = driftMonitor(est, threshold);
  return { window, arm, population, status: v.status, pattern: v.pattern, sigma_hat: v.sigma_hat, sigma_hat_tail: v.sigma_hat_tail, threshold };
}

export interface RealReplayReport {
  generated_for: string;
  operating_point: string;
  dispersion: PopulationCell[];
  monitors: MonitorCell[];
  fixture: { window: string; sigma_hat: number; sigma_hat_tail: number; n_entities: number; ticks: number }[];
  caveat: string;
}

export interface WindowSpec { label: string; file: string; startRow: number }

/** The full-rate analysis over a cal window + live windows (paths point at the OFF-repo data). */
export function computeRealReplay(dataDir: string, cal: WindowSpec, lives: WindowSpec[], ticks: number, log: (m: string) => void = () => {}): { dispersion: PopulationCell[]; monitors: MonitorCell[] } {
  log(`cal ${cal.label}…`);
  const calWin = parseWindow(readFileSync(join(dataDir, cal.file), 'utf8'), cal.startRow, ticks);
  const shared = buildRealSubstrate(calWin);
  const calResid = standardizeReal(calWin, shared);
  const active = activeSubset(calWin);
  const dispersion = [popCell('full (14 cores)', estimateDispersion(calResid)), popCell(`active (${active.length} cores)`, estimateDispersion(restrict(calResid, active)))];
  const pls: RealSubstrate = { ...shared, leafScale: fitLeafScales(calResid) };
  const monitors: MonitorCell[] = [];
  for (const live of lives) {
    log(`live ${live.label}…`);
    const liveWin = parseWindow(readFileSync(join(dataDir, live.file), 'utf8'), live.startRow, ticks);
    for (const [arm, sub] of [['shared', shared], ['perLeafScale', pls]] as const) {
      const resid = standardizeReal(liveWin, sub);
      const thr = arm === 'perLeafScale' ? 0.07 : DEFAULT_SIGMA_THRESHOLD;
      monitors.push(monCell(live.label, arm, 'full', estimateDispersion(resid), thr));
      monitors.push(monCell(live.label, arm, 'active', estimateDispersion(restrict(resid, active)), thr));
    }
  }
  return { dispersion, monitors };
}

export function renderMarkdown(rep: RealReplayReport): string {
  const L: string[] = [];
  L.push('# Tessera-RNG — real-telemetry replay (ADR-0057)');
  L.push('');
  L.push(`Operating point: ${rep.generated_for}; ${rep.operating_point}.`);
  L.push('');
  L.push(`> ${rep.caveat}`);
  L.push('');
  L.push('## Real population dispersion (calibration window, shared substrate)');
  L.push('');
  L.push('| population | n | robust ς̂ | tail ς̂ | raw | floor | gate |');
  L.push('|---|---|---|---|---|---|---|');
  for (const c of rep.dispersion) {
    L.push(`| ${c.population} | ${c.n_entities} | ${c.sigma_hat.toFixed(3)} | ${c.sigma_hat_tail.toFixed(3)} | ${c.raw_log_sd.toFixed(3)} | ${c.sampling_floor_sd.toFixed(4)} | ${c.gate_passing ? 'PASS' : 'FAIL (claim withheld)'} |`);
  }
  L.push('');
  L.push('## Live-window monitor (incl. the across-outage natural drift experiment)');
  L.push('');
  L.push('| window | arm | population | status | pattern | ς̂ | tail ς̂ | thr |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const m of rep.monitors) {
    L.push(`| ${m.window} | ${m.arm} | ${m.population} | ${m.status} | ${m.pattern ?? '—'} | ${m.sigma_hat.toFixed(3)} | ${m.sigma_hat_tail.toFixed(3)} | ${m.threshold} |`);
  }
  L.push('');
  L.push('## Committed fixture cells (downsampled 1-in-10 — the CI-reproducible subset)');
  L.push('');
  L.push('| window | n | ticks | robust ς̂ | tail ς̂ |');
  L.push('|---|---|---|---|---|');
  for (const f of rep.fixture) L.push(`| ${f.window} | ${f.n_entities} | ${f.ticks} | ${f.sigma_hat.toFixed(3)} | ${f.sigma_hat_tail.toFixed(3)} |`);
  L.push('');
  return L.join('\n');
}

/** Fixture path helper shared with the test. */
export const FIXTURE_DIR = join(__dirname, '..', 'test', 'fixtures');

export function loadFixture(name: string): { label: string; entities: EntitySeries } {
  const fx = JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
  return { label: fx.label, entities: new Map(Object.entries(fx.entities)) as EntitySeries };
}

/** The CI-reproducible analysis: the SAME pipeline as the full-rate path (substrate fit on the
 *  fixture cal window; the outage fixture standardized UNDER the cal substrate, monitor-style) —
 *  estimating on raw values would measure raw per-core scale spread, not residual dispersion. */
export function fixtureAnalysis(): { window: string; sigma_hat: number; sigma_hat_tail: number; n_entities: number; ticks: number }[] {
  const cal = loadFixture('mini-cores-cal.json');
  const sub = buildRealSubstrate(cal.entities);
  const calEst = estimateDispersion(standardizeReal(cal.entities, sub));
  const outage = loadFixture('mini-cores-outage.json');
  const outEst = estimateDispersion(standardizeReal(outage.entities, sub));
  return [
    { window: cal.label, n_entities: calEst.n_leaves, ticks: calEst.ticks, sigma_hat: calEst.sigma_hat, sigma_hat_tail: calEst.sigma_hat_tail },
    { window: `${outage.label} — under the cal substrate`, n_entities: outEst.n_leaves, ticks: outEst.ticks, sigma_hat: outEst.sigma_hat, sigma_hat_tail: outEst.sigma_hat_tail },
  ];
}

async function main(): Promise<void> {
  const dataDir = process.env.RR_DATA ?? '/private/tmp/claude-501/-Users-johnwarren-concord-tessera/59d1282a-543b-49c1-bb49-59cfa8f03423/scratchpad/mini-data';
  if (!existsSync(join(dataDir, '2026-07-08.ndjson'))) {
    // eslint-disable-next-line no-console
    console.error(`full-rate data not found under ${dataDir} — set RR_DATA to the day-file dir (source: the mini, ~/concord/telemetry/data/)`);
    process.exit(1);
  }
  const TICKS = 3600;
  const CAL: WindowSpec = { label: 'cal 07-08 h≈11', file: '2026-07-08.ndjson', startRow: 41400 };
  const LIVES: WindowSpec[] = [
    { label: 'adjacent hour (07-08 h≈12)', file: '2026-07-08.ndjson', startRow: 45000 },
    { label: '+3 days (07-11, same hour)', file: '2026-07-11.ndjson', startRow: 41400 },
    { label: 'ACROSS OUTAGE (07-28, post-reboot)', file: '2026-07-28.ndjson', startRow: 41400 },
  ];
  // eslint-disable-next-line no-console
  const { dispersion, monitors } = computeRealReplay(dataDir, CAL, LIVES, TICKS, (m) => console.log(m));
  const fixture = fixtureAnalysis();
  const rep: RealReplayReport = {
    generated_for: 'mac-mini 1 Hz powermetrics per-core population (14 cores × {mhz, res})',
    operating_point: `T=${TICKS} (1 h @ 1 Hz; sampling floor ≈ 0.0083 at p=2 — an iid-residual approximation; 1 Hz autocorrelation surviving the AR(≤6) whitening may understate it, immaterial at ς̂ ≈ 0.4–1.1); cal 2026-07-08, lives: adjacent hour / +3 days / across the 14-day outage+reboot; thresholds ς*=${DEFAULT_SIGMA_THRESHOLD} (shared) and 0.07 (perLeafScale arm); shrinkage λ = ς̂²/raw² (ADR-0052 formula, adapter-applied)`,
    dispersion,
    monitors,
    fixture,
    caveat:
      'Tier 2.5: REAL telemetry, NOT network telemetry — no RNG-domain claim (no incidence model, nothing ' +
      'localization-related runs) and no FDR claim. The objects under test (estimateDispersion, ' +
      'dispersionGate, driftMonitor, the ADR-0052 shrinkage formula) run VERBATIM from src/; leaf ' +
      'standardization is adapter-level from the SAME engine primitives the production substrate consumes ' +
      '(robustLocation + MAD, pooled BIC fitArP / prewhitenAr) — no byte-anchor to runPipeline is possible ' +
      'across the domain gap (recorded narrowing). Full-rate rows are NOT CI-reproducible (day files live ' +
      'off-repo: the mini ~/concord/telemetry/data/); the fixture rows are (committed, downsampled 1-in-10).',
  };
  const outDir = join(process.cwd(), 'coverage-matrices');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'real-replay.json'), JSON.stringify(rep, null, 2));
  writeFileSync(join(outDir, 'real-replay.md'), renderMarkdown(rep));
  // eslint-disable-next-line no-console
  console.log('wrote coverage-matrices/real-replay.{json,md}');
}

if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
