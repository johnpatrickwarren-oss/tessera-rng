/**
 * Onset vs N (ADR-0059, regenerated under ADR-0061's TRIPLE gate after the parked decision
 * was taken) — the GPU sibling's N13 transfer, answered for RNG.
 *
 * Question 1: does the false-selection onset ς collapse with fleet size, toward/below the
 * gate threshold ς* = 0.05? Where a gate PASSES a calibration window while e-BH
 * false-selects from it, the LAUNDERING column lights up — the anti-conservative failure a
 * claim gate must never have. The PAIR-era artifact measured exactly that at paper scale
 * (ADR-0059's recorded motivation); the current artifact runs the ADR-0061 triple gate
 * (pair AND z_max ≤ Φ⁻¹(1−0.01/n)), whose z columns make the closure verifiable as data.
 * Question 2 (the GPU rack-local mirror): is `perLeafScale` (ADR-0052) the N-robust
 * construction — 0 false selections at every (size, ς) — or does shrinkage-noise
 * extreme-value growth re-break it at scale?
 *
 * NULL runs only; the ADR-0050 crossOptic-off ramp; the 109/shared cells at ς ∈ {0.05, 0.1}
 * are CROSS-ARTIFACT ANCHORED to heterogeneity-boundary.json (same seeds; the fabrics differ
 * in crossOptic — the anchor is valid because incidence edges are INERT in dispersion-only
 * nulls (edges enter telemetry only via latentNull), and BREAKS if a latent arm is ever added
 * to this sweep — recorded, cold-eye finding 7). The ADR-0059 run of this tool made no gate
 * change and parked the redesign; the decision was TAKEN (ADR-0060/0061) and this tool now
 * measures the ratified triple gate.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateSpraypointFabric } from '../src/spraypoint';
import type { SpraypointParams } from '../src/spraypoint';
import { runNullRun } from './heterogeneity';

const SIGMAS = [0.02, 0.05, 0.075, 0.1, 0.15];
const SEEDS_ALL = [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04, 0xb0a05, 0xb0a06, 0xb0a07, 0xb0a08];
const SIZES: { leaves: number; params: SpraypointParams; nSeeds: number }[] = [
  { leaves: 109, params: { nTors: 64, nPanels: 10, nRooms: 2, crossOptic: false }, nSeeds: 8 },
  { leaves: 1456, params: { nTors: 960, nPanels: 32, nRooms: 4, crossOptic: false }, nSeeds: 5 },
  { leaves: 6112, params: { nTors: 4096, nPanels: 64, nRooms: 4, crossOptic: false }, nSeeds: 3 },
];

export interface OnsetCell {
  leaves: number;
  arm: 'shared' | 'perLeafScale';
  sigma: number;
  mean_false_selections: number;
  max_false_selections: number;
  gate_pass_rate: number;
  /** fraction of runs where the gate PASSED while e-BH false-selected ≥ 1 — the laundering rate. */
  laundering_rate: number;
  /** the extreme-leaf statistic per cell (ADR-0061): the headline "fails via z_max" must be
   *  verifiable from published data, not narrative. */
  mean_z_max: number;
  max_z_max: number;
  z_max_bound: number;
  n: number;
}

export interface OnsetReport {
  generated_for: string;
  operating_point: string;
  cells: OnsetCell[];
  /** first grid ς with mean false selections > 0, per (size, arm); null = none in grid. */
  onsets: { leaves: number; arm: string; onset: number | null }[];
  truncations: string[];
  caveat: string;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function computeOnsetScale(log: (m: string) => void = () => {}): OnsetReport {
  const cells: OnsetCell[] = [];
  const truncations: string[] = ['ς grid capped at 0.15 (the ADR-0050 boundary region; higher is measured there)', 'sizes 360/3176 skipped (the trend is bound by three fabric sizes spanning 56× — 109 to 6112 leaves)'];
  for (const size of SIZES) {
    const snap = generateSpraypointFabric(size.params);
    const seeds = SEEDS_ALL.slice(0, size.nSeeds);
    if (size.nSeeds < 8) truncations.push(`${size.leaves} leaves: n=${size.nSeeds} seeds (runtime)`);
    for (const arm of ['shared', 'perLeafScale'] as const) {
      for (const sigma of SIGMAS) {
        log(`${size.leaves} leaves / ${arm} / ς=${sigma}…`);
        const runs = seeds.map((s) => runNullRun(snap, s, { heterogeneity: { sigmaLogSd: sigma }, perLeafScale: arm === 'perLeafScale' }));
        cells.push({
          leaves: size.leaves,
          arm,
          sigma,
          mean_false_selections: mean(runs.map((r) => r.false_selections)),
          max_false_selections: Math.max(...runs.map((r) => r.false_selections)),
          gate_pass_rate: runs.filter((r) => r.gate_passing).length / runs.length,
          laundering_rate: runs.filter((r) => r.gate_passing && r.false_selections > 0).length / runs.length,
          mean_z_max: mean(runs.map((r) => r.gate_z_max)),
          max_z_max: Math.max(...runs.map((r) => r.gate_z_max)),
          z_max_bound: runs[0].gate_z_max_bound,
          n: runs.length,
        });
      }
    }
  }
  const onsets = SIZES.flatMap((size) =>
    (['shared', 'perLeafScale'] as const).map((arm) => {
      const first = cells.find((c) => c.leaves === size.leaves && c.arm === arm && c.mean_false_selections > 0);
      return { leaves: size.leaves, arm, onset: first ? first.sigma : null };
    }),
  );
  return {
    generated_for: 'spraypoint crossOptic-off ramp 109 / 1456 / 6112 leaves (the ADR-0050 N-axis fabrics)',
    operating_point: '60 ticks, q=0.05, production calibration defaults; gate = the ADR-0061 TRIPLE at ς*=0.05 — pair AND z_max ≤ Φ⁻¹(1−0.01/n) — on the calibration residuals (perLeafScale arm: on the CORRECTED residuals — in-sample ≈ 0 by construction, which is what makes that arm\'s laundering column the N-robustness question)',
    cells,
    onsets,
    truncations,
    caveat:
      'NULL runs — every selection is false. Synthetic Tier-2. The 109/shared ς∈{0.05,0.1} cells are ' +
      'cross-artifact-anchored to heterogeneity-boundary.json (same seeds; anchor validity note in the ' +
      'tool header, test-bound). LAUNDERING = gate passes while e-BH false-selects. The PAIR-era run of ' +
      'this sweep measured laundering at paper scale (ADR-0059, preserved there); THIS artifact runs the ' +
      'ratified ADR-0061 TRIPLE gate — the z_max columns make the closure verifiable as data. Onset ' +
      'estimates are grid-resolution-limited and small-n.',
  };
}

export function renderMarkdown(rep: OnsetReport): string {
  const L: string[] = [];
  L.push('# Tessera-RNG — onset vs N: the dispersion wall under fleet growth (ADR-0059)');
  L.push('');
  L.push(`Operating point: ${rep.generated_for}; ${rep.operating_point}.`);
  L.push('');
  L.push(`> ${rep.caveat}`);
  L.push('');
  L.push('## Onsets (first grid ς with mean false selections > 0)');
  L.push('');
  L.push('| leaves | shared | perLeafScale |');
  L.push('|---|---|---|');
  for (const size of [...new Set(rep.onsets.map((o) => o.leaves))]) {
    const s = rep.onsets.find((o) => o.leaves === size && o.arm === 'shared')!;
    const p = rep.onsets.find((o) => o.leaves === size && o.arm === 'perLeafScale')!;
    L.push(`| ${size} | ${s.onset ?? 'none ≤ 0.15'} | ${p.onset ?? 'none ≤ 0.15'} |`);
  }
  L.push('');
  for (const arm of ['shared', 'perLeafScale']) {
    L.push(`## Arm: ${arm}`);
    L.push('');
    L.push('| leaves | ς | mean false sel | max | gate pass | LAUNDERING | mean z_max | max z_max | z bound | n |');
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const c of rep.cells.filter((x) => x.arm === arm)) {
      L.push(`| ${c.leaves} | ${c.sigma} | ${c.mean_false_selections.toFixed(2)} | ${c.max_false_selections} | ${Math.round(c.gate_pass_rate * 100)}% | ${Math.round(c.laundering_rate * 100)}% | ${c.mean_z_max.toFixed(2)} | ${c.max_z_max.toFixed(2)} | ${c.z_max_bound.toFixed(2)} | ${c.n} |`);
    }
    L.push('');
  }
  L.push('## Truncations (no silent caps)');
  L.push('');
  for (const t of rep.truncations) L.push(`- ${t}`);
  L.push('');
  return L.join('\n');
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  const rep = computeOnsetScale((m) => console.log(m));
  const outDir = join(process.cwd(), 'coverage-matrices');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'onset-scale.json'), JSON.stringify(rep, null, 2));
  writeFileSync(join(outDir, 'onset-scale.md'), renderMarkdown(rep));
  // eslint-disable-next-line no-console
  console.log('wrote coverage-matrices/onset-scale.{json,md}');
}

if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
