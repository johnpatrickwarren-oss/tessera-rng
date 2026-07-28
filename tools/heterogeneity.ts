/**
 * Heterogeneity boundary study (ADR-0050).
 *
 * Measures where the SELECTION layer's validity breaks under the two null mechanisms every prior
 * measurement excluded by construction: per-leaf noise-scale dispersion (ς — shared-cell
 * calibration cannot represent it, `src/calibration.ts:cellKey`) and a correlated null (per-
 * resource latent factors riding the weighted incidence). NULL RUNS ONLY — no degradations, so
 * every e-BH selection is a false selection. The stack under test is composed from the EXPORTED
 * pipeline building blocks with production defaults (robust per-cell calibration, `seed ⊕ 0xca11b`
 * calibration seed, coupled window); at inert knobs it reproduces `runPipeline`'s surface exactly
 * (selected ids + fleet_log_e — the anti-self-confirming anchor, test/heterogeneity-tool.test.ts).
 * Detection stops at `buildSurface`: selection is the object under study (tomography/drain add
 * nothing to a false-selection count, and would dominate large-fabric runtime).
 *
 * Cross-project provenance (ADR-0050): the GPU sibling measured e-BH false-selecting from HEALTHY
 * units under dispersion, and fleet-size protection REVERSING under a shared latent factor. Its
 * numbers do not transfer (different e-value construction); these axes measure where THIS stack's
 * boundary sits. Honest scope (VALIDATION.md Tier 2): synthetic only — maps where the synthetic
 * model's selection guarantee breaks, no real-fabric claim.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT, PAPER_SPRAYPOINT } from '../src/spraypoint';
import type { SpraypointParams } from '../src/spraypoint';
import { generateTelemetry, HET_BASE_SEED, HET_DRIFT_SALT } from '../src/telemetry';
import type { HeterogeneitySpec, LatentNullSpec } from '../src/telemetry';
import { buildCalibration, standardizeAll } from '../src/calibration';
import { stripCommonMode } from '../src/common-mode';
import { detectAll, DEFAULT_DETECT } from '../src/detect';
import { estimateBaselineCovariance, makeFamilyCCellFromCovariance } from '../src/family-c';
import { estimateFamilyDNull } from '../src/family-d';
import { buildSurface } from '../src/surface';
import type { FaultDomainSnapshot } from '../src/domain';

const Q = 0.05;
const TICKS = 60; // matches the ADR-0032 harness operating point; calibration window coupled.

export interface NullRunOpts {
  heterogeneity?: HeterogeneitySpec;
  latentNull?: LatentNullSpec;
  commonModeRobust?: boolean;
}

export interface NullRunResult {
  false_selections: number;
  fleet_log_e: number;
  selected: readonly string[];
}

/**
 * One clean-fabric (null) run: calibrate on a structure-matched clean window (drift forced to 0 —
 * calibration happens BEFORE the drift), detect on the live window, e-BH select. Faithful
 * re-composition of `calibrateForSession` + `runPipeline`'s non-epoch surface path; the inert
 * case is anchored byte-exactly by test.
 */
export function runNullRun(snapshot: FaultDomainSnapshot, seed: number, opts: NullRunOpts, ticks = TICKS): NullRunResult {
  const detect = DEFAULT_DETECT;
  const cm = opts.commonModeRobust ?? false;
  const het = opts.heterogeneity;
  // calibration-window structure: same ς/latent physics, driftMix 0 (drift is cal→live movement).
  const calHet = het ? { ...het, driftMix: 0 } : undefined;
  const calibRaw = generateTelemetry(snapshot, {
    seed: seed ^ 0xca11b,
    ticks,
    ...(calHet ? { heterogeneity: calHet } : {}),
    ...(opts.latentNull ? { latentNull: opts.latentNull } : {}),
  });
  const calibration = buildCalibration(calibRaw.series, { robust: true });
  const calibStd = standardizeAll(calibRaw.series, calibration);
  const calibResiduals = cm ? stripCommonMode(calibStd) : calibStd;
  const familyCCell = makeFamilyCCellFromCovariance(estimateBaselineCovariance(calibResiduals).sigma, detect.alphaC);
  const familyDCells = estimateFamilyDNull(calibResiduals);

  const liveRaw = generateTelemetry(snapshot, {
    seed,
    ticks,
    ...(het ? { heterogeneity: het } : {}),
    ...(opts.latentNull ? { latentNull: opts.latentNull } : {}),
  });
  const liveStd = standardizeAll(liveRaw.series, calibration);
  const residuals = cm ? stripCommonMode(liveStd) : liveStd;
  const verdicts = detectAll(residuals, detect, { familyCCell, familyDCells });
  const surface = buildSurface(verdicts, Q);
  return { false_selections: surface.selected_path_class_ids.length, fleet_log_e: surface.fleet_log_e, selected: surface.selected_path_class_ids };
}

// ───────────────────────── the sweep (grids are the record; truncations logged) ─────────────────────────

const SEEDS_FULL = [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04, 0xb0a05, 0xb0a06, 0xb0a07, 0xb0a08];
const SEEDS_SCALE = SEEDS_FULL.slice(0, 5);
const SEEDS_SCALE_LARGE = SEEDS_FULL.slice(0, 3);

const SIGMA_GRID = [0, 0.05, 0.1, 0.2, 0.3, 0.5];
const LOAD_GRID = [0, 0.1, 0.25, 0.5];
const DRIFT_GRID = [0, 0.25, 0.5, 1];
const JOINT = { sigma: 0.2, load: 0.25 };

/** N-axis fabrics: crossOptic OFF above default is a RECORDED design choice — at nTors ≥ 2048 the
 *  cross-optic variant emits O(nTors²) ≈ 10⁷ edges (memory/runtime wall) whose 1/(nTors−1) weights
 *  contribute negligibly to the latent sum; OFF keeps the ramp homogeneous, so it is off at EVERY
 *  size including 109 (the per-size rows are comparable to each other, not to the H-axis rows). */
const SCALE_FABRICS: { label: string; params: SpraypointParams }[] = [
  { label: '109', params: { nTors: 64, nPanels: 10, nRooms: 2, crossOptic: false } },
  { label: '360', params: { nTors: 240, nPanels: 16, nRooms: 2, crossOptic: false } },
  { label: '1456', params: { nTors: PAPER_SPRAYPOINT.nTors, nPanels: PAPER_SPRAYPOINT.nPanels, nRooms: PAPER_SPRAYPOINT.nRooms, crossOptic: false } },
  { label: '3176', params: { nTors: 2048, nPanels: 48, nRooms: 4, crossOptic: false } },
  { label: '6112', params: { nTors: 4096, nPanels: 64, nRooms: 4, crossOptic: false } },
];
const SCALE_LARGE_FROM = 3176; // leaves ≥ this use the reduced seed block (logged truncation).

export interface Cell {
  /** axis coordinate (ς, load, driftMix, or leaf count). */
  intensity: number;
  n: number;
  mean_false_selections: number;
  max_false_selections: number;
  frac_runs_selecting: number;
  /**
   * REALIZED population log-scale dispersion of the σ draw the cell actually ran under (H and D
   * axes). The g-draws are a fixed deterministic set, so realized dispersion differs from nominal
   * ς by the draw's sampling spread (±≈20% at 109 leaves) — and the drift axis REDRAWS the set,
   * so its cells' realized dispersion moves. Published per cell (instrumented-caveat, DISCIPLINES
   * §7): without it the D-axis trend reads as a drift mechanism when it is a draw artifact.
   */
  realized_dispersion?: number;
}

/** Realized log-scale dispersion via the same-seed sd-ratio method (independent two-pass per-hour
 *  demeaning — the test/heterogeneity.test.ts estimator), on a fixed measurement seed. Exported
 *  for the AC-5 freshness recompute. */
export function realizedDispersion(snapshot: FaultDomainSnapshot, het: HeterogeneitySpec): number {
  const MEAS_SEED = 0x0d15b;
  const MEAS_TICKS = 240;
  const base = generateTelemetry(snapshot, { seed: MEAS_SEED, ticks: MEAS_TICKS });
  const hetT = generateTelemetry(snapshot, { seed: MEAS_SEED, ticks: MEAS_TICKS, heterogeneity: het });
  const logR: number[] = [];
  for (const pc of base.series.keys()) {
    const sdOf = (series: ReadonlyArray<readonly number[]>): number => {
      const byHour = new Map<number, number[]>();
      series.forEach((v, t) => {
        const h = t % 24;
        if (!byHour.has(h)) byHour.set(h, []);
        byHour.get(h)!.push(v[0]);
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
    };
    logR.push(Math.log(sdOf(hetT.series.get(pc)!) / sdOf(base.series.get(pc)!)));
  }
  const m = logR.reduce((s, x) => s + x, 0) / logR.length;
  return Math.sqrt(logR.reduce((s, x) => s + (x - m) ** 2, 0) / (logR.length - 1));
}

function cellOf(intensity: number, counts: number[]): Cell {
  return {
    intensity,
    n: counts.length,
    mean_false_selections: counts.reduce((s, x) => s + x, 0) / counts.length,
    max_false_selections: Math.max(...counts),
    frac_runs_selecting: counts.filter((c) => c > 0).length / counts.length,
  };
}

function sweepCell(snapshot: FaultDomainSnapshot, seeds: readonly number[], opts: NullRunOpts, intensity: number): Cell {
  const counts = seeds.map((s) => runNullRun(snapshot, s, opts).false_selections);
  return cellOf(intensity, counts);
}

/** First grid intensity whose mean false-selection count exceeds the zero row's, or null. */
function onsetOf(cells: readonly Cell[]): number | null {
  const zero = cells[0].mean_false_selections;
  for (const c of cells.slice(1)) if (c.mean_false_selections > zero) return c.intensity;
  return null;
}

export interface HeterogeneityReport {
  generated_for: string;
  operating_point: { ticks: number; q: number; calibration: string; calibration_regime_note: string };
  axes: {
    dispersion: { grid: number[]; cells: Cell[]; onset: number | null };
    latent: { grid: number[]; arms: { commonModeRobust: boolean; cells: Cell[] }[]; joint: { commonModeRobust: boolean; cell: Cell }[] };
    scale: { regimes: { regime: string; cells: (Cell & { leaves: number; n_note?: string })[] }[] };
    drift: {
      grid: number[];
      cells: Cell[];
      /** the DIRECT no-mismatch control (cold-eye finding 7): the m=1 σ-set run as a BASE draw —
       *  calibration and live under the SAME σ assignment. If cal→live mismatch mattered, this
       *  cell would differ from the driftMix=1 cell; matching counts pin "no drift effect" as a
       *  measurement, not an interpolation argument. */
      control: Cell;
    };
  };
  truncations: string[];
  caveat: string;
}

export function computeBoundary(log: (msg: string) => void = () => {}): HeterogeneityReport {
  const snap = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
  const truncations: string[] = [];

  // H — dispersion.
  log('axis H (dispersion)…');
  const hCells = SIGMA_GRID.map((s) => ({
    ...sweepCell(snap, SEEDS_FULL, s === 0 ? {} : { heterogeneity: { sigmaLogSd: s } }, s),
    ...(s > 0 ? { realized_dispersion: realizedDispersion(snap, { sigmaLogSd: s }) } : {}),
  }));

  // L — correlated null, ± the fleet-level spatial-control arm (ADR-0036 commonModeRobust).
  log('axis L (correlated null)…');
  const lArms = [false, true].map((cmr) => ({
    commonModeRobust: cmr,
    cells: LOAD_GRID.map((l) => sweepCell(snap, SEEDS_FULL, { ...(l > 0 ? { latentNull: { load: l } } : {}), commonModeRobust: cmr }, l)),
  }));
  const lJoint = [false, true].map((cmr) => ({
    commonModeRobust: cmr,
    cell: sweepCell(snap, SEEDS_FULL, { heterogeneity: { sigmaLogSd: JOINT.sigma }, latentNull: { load: JOINT.load }, commonModeRobust: cmr }, JOINT.sigma),
  }));

  // N — scale (the N12 probe): clean / dispersion-only / dispersion+latent at each fabric size.
  const regimes: { regime: string; opts: NullRunOpts }[] = [
    { regime: 'clean', opts: {} },
    { regime: `dispersion (ς=${JOINT.sigma})`, opts: { heterogeneity: { sigmaLogSd: JOINT.sigma } } },
    { regime: `dispersion+latent (ς=${JOINT.sigma}, load=${JOINT.load})`, opts: { heterogeneity: { sigmaLogSd: JOINT.sigma }, latentNull: { load: JOINT.load } } },
  ];
  const scale = regimes.map((r) => ({ regime: r.regime, cells: [] as (Cell & { leaves: number; n_note?: string })[] }));
  for (const f of SCALE_FABRICS) {
    const leaves = Number(f.label);
    const fsnap = generateSpraypointFabric(f.params);
    const seeds = leaves >= SCALE_LARGE_FROM ? SEEDS_SCALE_LARGE : SEEDS_SCALE;
    if (leaves >= SCALE_LARGE_FROM) truncations.push(`scale axis at ${leaves} leaves: n=${seeds.length} seeds (runtime), vs n=${SEEDS_SCALE.length} below`);
    for (let i = 0; i < regimes.length; i++) {
      log(`axis N (scale): ${leaves} leaves, ${regimes[i].regime}…`);
      const cell = sweepCell(fsnap, seeds, regimes[i].opts, leaves);
      scale[i].cells.push({ ...cell, leaves, ...(leaves >= SCALE_LARGE_FROM ? { n_note: 'reduced seed block' } : {}) });
    }
  }

  // D — drift. Realized dispersion per cell is load-bearing here: the drift redraw CHANGES the
  // realized population dispersion (fixed deterministic draws), and false-selection counts track
  // realized ς, not driftMix — publishing both is what lets the table say so.
  log('axis D (drift)…');
  const dCells = DRIFT_GRID.map((m) => ({
    ...sweepCell(snap, SEEDS_FULL, { heterogeneity: { sigmaLogSd: JOINT.sigma, driftMix: m } }, m),
    realized_dispersion: realizedDispersion(snap, { sigmaLogSd: JOINT.sigma, driftMix: m }),
  }));
  // the direct control: the m=1 σ-set (base seed ⊕ drift salt) as a BASE draw — same live σ's,
  // calibration under them too. Counts matching the m=1 cell = no cal→live mismatch effect.
  const controlHet: HeterogeneitySpec = { sigmaLogSd: JOINT.sigma, seed: HET_BASE_SEED ^ HET_DRIFT_SALT };
  const dControl = {
    ...sweepCell(snap, SEEDS_FULL, { heterogeneity: controlHet }, 1),
    realized_dispersion: realizedDispersion(snap, controlHet),
  };

  return {
    generated_for: `spraypoint:${DEFAULT_SPRAYPOINT.nTors}x${DEFAULT_SPRAYPOINT.nPanels}x${DEFAULT_SPRAYPOINT.nRooms} (H/L/D); crossOptic-off ramp 109→6112 (N — recorded design choice, see tool header)`,
    operating_point: {
      ticks: TICKS,
      q: Q,
      calibration: 'robust per-cell, coupled window, seed ⊕ 0xca11b (production defaults)',
      // Disclosed measurement condition (DISCIPLINES §7; cold-eye finding 3): "per-cell" has zero
      // per-cell RESOLUTION at the small operating point, and the N ramp crosses the regime line.
      calibration_regime_note:
        'At 109 leaves / 60 ticks every calibration cell is under ROBUST_MIN_CELL_SAMPLES (≈36 < 50) and ' +
        'falls back to the pooled-global baseline — the H/L/D axes (and the 109-leaf N rows) were measured ' +
        'under a SINGLE global scale. At ≥ 360 leaves all cells have genuine per-cell resolution, so the N ' +
        'ramp crosses a calibration-regime boundary between 109 and 360 leaves; the fraction dip across the ' +
        'ramp (≈14.5% → ≈12%) may partly reflect that regime change. The mechanism claim is unaffected ' +
        '(pooled-global is a fortiori shared-not-per-leaf).',
    },
    axes: {
      dispersion: { grid: SIGMA_GRID, cells: hCells, onset: onsetOf(hCells) },
      latent: { grid: LOAD_GRID, arms: lArms, joint: lJoint },
      scale: { regimes: scale },
      drift: { grid: DRIFT_GRID, cells: dCells, control: dControl },
    },
    truncations,
    caveat:
      'NULL runs only: every selection is a FALSE selection (no degradations injected). Synthetic Tier-2 ' +
      '(VALIDATION.md): maps where the synthetic model breaks under null mechanisms previously absent by ' +
      'construction (ADR-0050); NOT a real-fabric claim, and NOT a power measurement (ADR-0032 owns fault ' +
      'sensitivity). e-BH FDR control is a theorem conditional on valid per-leaf e-values — these axes measure ' +
      'where that condition fails, not a defect in e-BH.',
  };
}

function fmt(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(2);
}

function cellRow(c: Cell, label?: string): string {
  return `| ${label ?? c.intensity} | ${fmt(c.mean_false_selections)} | ${c.max_false_selections} | ${Math.round(c.frac_runs_selecting * 100)}% | ${c.n} |`;
}

function dispCellRow(c: Cell): string {
  return `| ${c.intensity} | ${c.realized_dispersion !== undefined ? c.realized_dispersion.toFixed(3) : '—'} | ${fmt(c.mean_false_selections)} | ${c.max_false_selections} | ${Math.round(c.frac_runs_selecting * 100)}% | ${c.n} |`;
}

const CELL_HEADER = '| intensity | mean false sel | max | runs selecting | n |\n|---|---|---|---|---|';
const DISP_HEADER = '| nominal | realized ς | mean false sel | max | runs selecting | n |\n|---|---|---|---|---|---|';

export function renderMarkdown(rep: HeterogeneityReport): string {
  const L: string[] = [];
  L.push('# Tessera-RNG — heterogeneity boundary (ADR-0050)');
  L.push('');
  L.push(`Operating point: ${rep.generated_for}; ${rep.operating_point.ticks} ticks, q=${rep.operating_point.q}; calibration: ${rep.operating_point.calibration}.`);
  L.push('');
  L.push(`**Calibration-regime disclosure:** ${rep.operating_point.calibration_regime_note}`);
  L.push('');
  L.push(`> ${rep.caveat}`);
  L.push('');
  L.push('## H — per-leaf scale dispersion (ς)');
  L.push('');
  L.push(`False-selection onset at **nominal ς = ${rep.axes.dispersion.onset ?? 'none in grid'}** (first grid point whose mean exceeds the ς=0 row; quote the onset against the REALIZED ς column — the fixed draw set realizes nominal ς with ±≈20% sampling spread at 109 leaves).`);
  L.push('');
  L.push(DISP_HEADER);
  for (const c of rep.axes.dispersion.cells) L.push(dispCellRow(c));
  L.push('');
  L.push('## L — correlated null (latent load), ± fleet-level common-mode control (ADR-0036)');
  L.push('');
  for (const arm of rep.axes.latent.arms) {
    L.push(`### commonModeRobust: ${arm.commonModeRobust}`);
    L.push('');
    L.push(CELL_HEADER);
    for (const c of arm.cells) L.push(cellRow(c));
    L.push('');
  }
  L.push(`### joint regime (ς=${JOINT.sigma}, load=${JOINT.load})`);
  L.push('');
  L.push(CELL_HEADER);
  for (const j of rep.axes.latent.joint) L.push(cellRow(j.cell, `cm=${j.commonModeRobust}`));
  L.push('');
  L.push('## N — scale ramp (the fleet-size probe)');
  L.push('');
  L.push('Note the calibration-regime boundary between 109 and 360 leaves (see the disclosure above): 109-leaf rows run on the pooled-global fallback; larger rows on genuine per-cell calibration.');
  L.push('');
  for (const r of rep.axes.scale.regimes) {
    L.push(`### ${r.regime}`);
    L.push('');
    L.push('| leaves | mean false sel | max | runs selecting | n |\n|---|---|---|---|---|');
    for (const c of r.cells) L.push(`| ${c.leaves}${c.n_note ? ' †' : ''} | ${fmt(c.mean_false_selections)} | ${c.max_false_selections} | ${Math.round(c.frac_runs_selecting * 100)}% | ${c.n} |`);
    L.push('');
  }
  L.push('## D — calibration→live drift (driftMix at nominal ς=0.2)');
  L.push('');
  L.push(
    'Read this axis against the REALIZED ς column: the drift redraw changes the fixed draw set, so ' +
      'realized dispersion moves with driftMix. False-selection counts track realized ς, not driftMix — ' +
      'the mechanistic finding is that drift adds NO additional effect: the shared-cell calibration never ' +
      'learns per-leaf scale (cellKey has no path-class in it), so WHICH leaves are noisy cannot matter, ' +
      'only how dispersed the population is.',
  );
  L.push('');
  L.push(DISP_HEADER);
  for (const c of rep.axes.drift.cells) L.push(dispCellRow(c));
  L.push('');
  L.push('### Direct control (no-mismatch): the m=1 σ-set run as a BASE draw');
  L.push('');
  L.push('Same live σ assignment as driftMix=1, but calibration ALSO ran under it — if cal→live mismatch mattered, this row would differ from the m=1 row. Matching counts pin "no drift effect" as a measurement.');
  L.push('');
  L.push(DISP_HEADER.replace('| nominal |', '| cell |'));
  L.push(dispCellRow({ ...rep.axes.drift.control, intensity: rep.axes.drift.control.intensity }).replace(/^\| 1 \|/, '| control |'));
  L.push(dispCellRow(rep.axes.drift.cells[rep.axes.drift.cells.length - 1]).replace(/^\| 1 \|/, '| driftMix=1 |'));
  L.push('');
  if (rep.truncations.length) {
    L.push('## Truncations (no silent caps)');
    L.push('');
    for (const t of rep.truncations) L.push(`- † ${t}`);
    L.push('');
  }
  return L.join('\n');
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  const rep = computeBoundary((m) => console.log(m));
  const outDir = join(process.cwd(), 'coverage-matrices');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'heterogeneity-boundary.json'), JSON.stringify(rep, null, 2));
  writeFileSync(join(outDir, 'heterogeneity-boundary.md'), renderMarkdown(rep));
  // eslint-disable-next-line no-console
  console.log('wrote coverage-matrices/heterogeneity-boundary.{json,md}');
}

if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
