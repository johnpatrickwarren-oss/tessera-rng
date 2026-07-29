/**
 * ς̂ dispersion-gate validation envelope (ADR-0051).
 *
 * Publishes, on the DEFAULT fabric at the ADR-0050 operating point: (1) ς̂ RECOVERY — the
 * debiased estimate vs the independently-measured realized ς of the same draw set; (2) the gate
 * OPERATING CHARACTERISTIC — pass rate per ς, printed beside the ADR-0050 false-selection counts
 * for the SAME cells, so the table shows the gate failing exactly where selection lies; (3) a
 * calibration-depth row (T = 240) showing the sampling floor shrink. Honest scope: synthetic
 * Tier-2; the threshold's real-fabric meaning is NOT established here (ADR-0051 anti-scope).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { generateTelemetry } from '../src/telemetry';
import type { HeterogeneitySpec } from '../src/telemetry';
import { buildCalibration, standardizeAll } from '../src/calibration';
import { estimateDispersion, dispersionGate, DEFAULT_SIGMA_THRESHOLD } from '../src/dispersion-gate';
import { runNullRun, realizedDispersion } from './heterogeneity';
import type { FaultDomainSnapshot } from '../src/domain';

const SIGMA_GRID = [0, 0.05, 0.1, 0.2, 0.3];
const SEEDS = [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04, 0xb0a05, 0xb0a06, 0xb0a07, 0xb0a08];
const TICKS = 60;
const DEPTH_TICKS = 240;

export interface GateCell {
  nominal: number;
  realized: number | null;
  mean_sigma_hat: number;
  mean_sigma_hat_tail: number;
  sd_sigma_hat: number;
  mean_raw_log_sd: number;
  sampling_floor_sd: number;
  pass_rate: number;
  mean_false_selections: number;
  n: number;
}

function estimateUnder(snapshot: FaultDomainSnapshot, seed: number, ticks: number, het?: HeterogeneitySpec): { sigma_hat: number; tail: number; raw: number; floor: number; passing: boolean } {
  const raw = generateTelemetry(snapshot, { seed: seed ^ 0xca11b, ticks, ...(het ? { heterogeneity: { ...het, driftMix: 0 } } : {}) });
  const est = estimateDispersion(standardizeAll(raw.series, buildCalibration(raw.series, { robust: true })));
  return { sigma_hat: est.sigma_hat, tail: est.sigma_hat_tail, raw: est.raw_log_sd, floor: est.sampling_floor_sd, passing: dispersionGate(est).passing };
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: readonly number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

export interface GateReport {
  generated_for: string;
  operating_point: { ticks: number; q: number; threshold: number; calibration: string };
  cells: GateCell[];
  depth: { ticks: number; cells: { nominal: number; mean_sigma_hat: number; sampling_floor_sd: number; pass_rate: number; n: number }[] };
  caveat: string;
}

export function computeGateEnvelope(log: (m: string) => void = () => {}): GateReport {
  const snap = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
  const cells: GateCell[] = [];
  for (const nominal of SIGMA_GRID) {
    log(`ς = ${nominal}…`);
    const het = nominal > 0 ? { sigmaLogSd: nominal } : undefined;
    const runs = SEEDS.map((s) => estimateUnder(snap, s, TICKS, het));
    const falseSel = SEEDS.map((s) => runNullRun(snap, s, het ? { heterogeneity: het } : {}).false_selections);
    cells.push({
      nominal,
      realized: het ? realizedDispersion(snap, het) : null,
      mean_sigma_hat: mean(runs.map((r) => r.sigma_hat)),
      mean_sigma_hat_tail: mean(runs.map((r) => r.tail)),
      sd_sigma_hat: sd(runs.map((r) => r.sigma_hat)),
      mean_raw_log_sd: mean(runs.map((r) => r.raw)),
      sampling_floor_sd: runs[0].floor,
      pass_rate: runs.filter((r) => r.passing).length / runs.length,
      mean_false_selections: mean(falseSel),
      n: SEEDS.length,
    });
  }
  const depthCells = [0, 0.1].map((nominal) => {
    log(`depth T=${DEPTH_TICKS}, ς = ${nominal}…`);
    const het = nominal > 0 ? { sigmaLogSd: nominal } : undefined;
    const runs = SEEDS.map((s) => estimateUnder(snap, s, DEPTH_TICKS, het));
    return { nominal, mean_sigma_hat: mean(runs.map((r) => r.sigma_hat)), sampling_floor_sd: runs[0].floor, pass_rate: runs.filter((r) => r.passing).length / runs.length, n: SEEDS.length };
  });
  return {
    generated_for: `spraypoint:${DEFAULT_SPRAYPOINT.nTors}x${DEFAULT_SPRAYPOINT.nPanels}x${DEFAULT_SPRAYPOINT.nRooms}`,
    operating_point: {
      ticks: TICKS,
      q: 0.05,
      threshold: DEFAULT_SIGMA_THRESHOLD,
      calibration: 'robust per-cell, seed ⊕ 0xca11b (production defaults; at this operating point all cells are on the pooled-global fallback — ADR-0050 disclosure)',
    },
    cells,
    depth: { ticks: DEPTH_TICKS, cells: depthCells },
    caveat:
      'Synthetic Tier-2 (VALIDATION.md): the gate is validated against the SAME synthetic mechanism the ' +
      'boundary was measured on (ADR-0050). The false-selection column reuses the ADR-0050 null-run cells so ' +
      'the ROC and the failure sit in one table. The ς* = ' + DEFAULT_SIGMA_THRESHOLD + ' threshold is justified by the synthetic ' +
      'boundary ONLY — a real deployment must re-derive it (ADR-0051 anti-scope).',
  };
}

export function renderMarkdown(rep: GateReport): string {
  const L: string[] = [];
  L.push('# Tessera-RNG — ς̂ dispersion-gate validation (ADR-0051)');
  L.push('');
  L.push(`Operating point: ${rep.generated_for}; T=${rep.operating_point.ticks}, threshold ς*=${rep.operating_point.threshold}; calibration: ${rep.operating_point.calibration}.`);
  L.push('');
  L.push(`> ${rep.caveat}`);
  L.push('');
  L.push('## Recovery + operating characteristic (n=8 per cell)');
  L.push('');
  L.push('The gate binds on the ADR-0061 TRIPLE: max(ς̂, tail ς̂) ≤ ς* AND z_max ≤ Φ⁻¹(1−0.01/n) — the pair guards against dispersed subpopulations (the ADR-0051 cold-eye correction; AC-2b contamination test), the max-z against the extreme-leaf scale laundering (ADR-0059/0061).');
  L.push('');
  L.push('| nominal | realized ς | mean ς̂ (robust) | mean tail ς̂ | sd ς̂ | mean raw | floor | pass rate | mean false sel |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const c of rep.cells) {
    L.push(
      `| ${c.nominal} | ${c.realized === null ? '—' : c.realized.toFixed(3)} | ${c.mean_sigma_hat.toFixed(3)} | ${c.mean_sigma_hat_tail.toFixed(3)} | ${c.sd_sigma_hat.toFixed(3)} | ${c.mean_raw_log_sd.toFixed(3)} | ${c.sampling_floor_sd.toFixed(3)} | ${Math.round(c.pass_rate * 100)}% | ${c.mean_false_selections.toFixed(2)} |`,
    );
  }
  L.push('');
  L.push(`## Calibration depth (T=${rep.depth.ticks}: the sampling floor shrinks)`);
  L.push('');
  L.push('| nominal | mean ς̂ | floor | pass rate | n |');
  L.push('|---|---|---|---|---|');
  for (const c of rep.depth.cells) L.push(`| ${c.nominal} | ${c.mean_sigma_hat.toFixed(3)} | ${c.sampling_floor_sd.toFixed(3)} | ${Math.round(c.pass_rate * 100)}% | ${c.n} |`);
  L.push('');
  return L.join('\n');
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  const rep = computeGateEnvelope((m) => console.log(m));
  const outDir = join(process.cwd(), 'coverage-matrices');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'dispersion-gate.json'), JSON.stringify(rep, null, 2));
  writeFileSync(join(outDir, 'dispersion-gate.md'), renderMarkdown(rep));
  // eslint-disable-next-line no-console
  console.log('wrote coverage-matrices/dispersion-gate.{json,md}');
}

if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
