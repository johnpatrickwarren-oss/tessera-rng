/**
 * Per-leaf scale calibration — the measured boundary shift (ADR-0052).
 *
 * Re-runs the ADR-0050 H (static dispersion) and D (cal→live drift) axes with the shrunk
 * per-leaf correction ON, beside the OFF rows. Same seeds as ADR-0050, so the OFF rows must
 * reproduce `coverage-matrices/heterogeneity-boundary.json` EXACTLY — the cross-artifact anchor
 * (bound by test). Predictions on the record (ADR-0052 §3): H — static ς absorbed, the ς = 0 row
 * stays 0 (noise-injection guard); D — the ADR-0050 "drift adds no effect" result REVERSES
 * (a leaf corrected by its OLD scale is mis-scaled by the movement). Whatever is measured is
 * published, including a wrong prediction (ADR-0020 precedent).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { runNullRun, realizedDispersion } from './heterogeneity';
import type { NullRunOpts } from './heterogeneity';

const SEEDS = [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04, 0xb0a05, 0xb0a06, 0xb0a07, 0xb0a08];
const SIGMA_GRID = [0, 0.05, 0.1, 0.2, 0.3, 0.5];
const DRIFT_GRID = [0, 0.25, 0.5, 1];

export interface ShiftCell {
  intensity: number;
  realized_dispersion: number | null;
  off_mean_false_selections: number;
  on_mean_false_selections: number;
  on_max_false_selections: number;
  n: number;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface ShiftReport {
  generated_for: string;
  operating_point: string;
  h: ShiftCell[];
  d: ShiftCell[];
  caveat: string;
}

export function computeShift(log: (m: string) => void = () => {}): ShiftReport {
  const snap = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
  const cell = (intensity: number, het: NullRunOpts['heterogeneity']): ShiftCell => {
    const off = SEEDS.map((s) => runNullRun(snap, s, het ? { heterogeneity: het } : {}).false_selections);
    const on = SEEDS.map((s) => runNullRun(snap, s, { ...(het ? { heterogeneity: het } : {}), perLeafScale: true }).false_selections);
    return {
      intensity,
      realized_dispersion: het ? realizedDispersion(snap, het) : null,
      off_mean_false_selections: mean(off),
      on_mean_false_selections: mean(on),
      on_max_false_selections: Math.max(...on),
      n: SEEDS.length,
    };
  };
  const h: ShiftCell[] = [];
  for (const s of SIGMA_GRID) {
    log(`H ς = ${s}…`);
    h.push(cell(s, s > 0 ? { sigmaLogSd: s } : undefined));
  }
  const d: ShiftCell[] = [];
  for (const m of DRIFT_GRID) {
    log(`D driftMix = ${m}…`);
    d.push(cell(m, { sigmaLogSd: 0.2, driftMix: m }));
  }
  return {
    generated_for: `spraypoint:${DEFAULT_SPRAYPOINT.nTors}x${DEFAULT_SPRAYPOINT.nPanels}x${DEFAULT_SPRAYPOINT.nRooms}`,
    operating_point: '60 ticks, q=0.05, robust per-cell calibration (pooled-fallback regime at this size — ADR-0050 disclosure); OFF rows = the ADR-0050 published cells (same seeds, anchor-bound by test)',
    h,
    d,
    caveat:
      'Synthetic Tier-2. NULL runs — every selection is false. ON = CalibrationOptions.perLeafScale (shrunk, ' +
      'ADR-0052); OFF = the ADR-0050 baseline. The D axis is the recorded falsifiable prediction: under ' +
      'per-leaf correction, cal→live drift becomes a REAL mechanism (it was measured irrelevant under shared ' +
      'calibration, ADR-0050). Realized ς republished per cell (draw-artifact guard).',
  };
}

export function renderMarkdown(rep: ShiftReport): string {
  const L: string[] = [];
  L.push('# Tessera-RNG — per-leaf scale calibration: the measured boundary shift (ADR-0052)');
  L.push('');
  L.push(`Operating point: ${rep.generated_for}; ${rep.operating_point}.`);
  L.push('');
  L.push(`> ${rep.caveat}`);
  L.push('');
  const table = (cells: readonly ShiftCell[], label: string) => {
    L.push(`| ${label} | realized ς | OFF mean false sel | ON mean false sel | ON max | n |`);
    L.push('|---|---|---|---|---|---|');
    for (const c of cells) {
      L.push(`| ${c.intensity} | ${c.realized_dispersion === null ? '—' : c.realized_dispersion.toFixed(3)} | ${c.off_mean_false_selections.toFixed(2)} | ${c.on_mean_false_selections.toFixed(2)} | ${c.on_max_false_selections} | ${c.n} |`);
    }
    L.push('');
  };
  L.push('## H — static dispersion (ς), OFF vs ON');
  L.push('');
  table(rep.h, 'nominal ς');
  L.push('## D — cal→live drift (driftMix at nominal ς=0.2), OFF vs ON');
  L.push('');
  table(rep.d, 'driftMix');
  return L.join('\n');
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  const rep = computeShift((m) => console.log(m));
  const outDir = join(process.cwd(), 'coverage-matrices');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'per-leaf-scale.json'), JSON.stringify(rep, null, 2));
  writeFileSync(join(outDir, 'per-leaf-scale.md'), renderMarkdown(rep));
  // eslint-disable-next-line no-console
  console.log('wrote coverage-matrices/per-leaf-scale.{json,md}');
}

if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
