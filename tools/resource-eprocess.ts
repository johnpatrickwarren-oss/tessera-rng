/**
 * Escalation-tier envelope (ADR-0064): the ADR-0049 §2 probe table reproduced under the
 * HONEST (calibrated) aggregate null, plus the validation the probe lacked — clean
 * false-escalation vs α — and the fault-side sibling comparison where the calibrated null
 * actually binds (clean-side, mean-betting is scale-fair; see the caveat).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { generateTelemetry } from '../src/telemetry';
import { buildCalibration, standardizeAll } from '../src/calibration';
import { detectAll, DEFAULT_DETECT } from '../src/detect';
import { estimateBaselineCovariance, makeFamilyCCellFromCovariance } from '../src/family-c';
import { estimateFamilyDNull } from '../src/family-d';
import { buildSurface } from '../src/surface';
import { escalationTier } from '../src/resource-eprocess';
import type { FaultDomainSnapshot, PathClassId } from '../src/domain';

const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);
const TICKS = 60;
const SEEDS = [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04];
const ALPHA = 0.05;

export function residPair(snapshot: FaultDomainSnapshot, seed: number, degradation?: { resource_id: string; delta: number; start_tick: number }) {
  const calRaw = generateTelemetry(snapshot, { seed: seed ^ 0xca11b, ticks: TICKS });
  const sub = buildCalibration(calRaw.series, { robust: true });
  const cal = standardizeAll(calRaw.series, sub);
  const live = standardizeAll(generateTelemetry(snapshot, { seed, ticks: TICKS, ...(degradation ? { degradation } : {}) }).series, sub);
  return { cal, live };
}

function leafDetects(cal: Map<PathClassId, number[][]>, live: Map<PathClassId, number[][]>): boolean {
  const ctx = {
    familyCCell: makeFamilyCCellFromCovariance(estimateBaselineCovariance(cal).sigma, DEFAULT_DETECT.alphaC),
    familyDCells: estimateFamilyDNull(cal),
  };
  return buildSurface(detectAll(live, DEFAULT_DETECT, ctx), 0.05).selected_path_class_ids.length > 0;
}

/** The probe's ERROR, reproduced for the published comparison: aggregates scored against a
 *  unit-variance null (calibration skipped). Tool-side only — src never implements this. */
export function unitVarianceEValues(live: Map<PathClassId, number[][]>): Map<string, number> {
  // feed escalationTier a fake calibration whose aggregates have sd ≈ 1: iid N(0,1) residual
  // shapes independent per leaf make each aggregate's variance Σw² (≠ the dependent truth) —
  // the closest honest surrogate of "assume unit variance" without reimplementing the tier.
  // Instead we score directly: aggregate the live residuals and threshold betting wealth
  // against sd = 1 per signal.
  const { freshBettingState, updateBettingState } = require('@johnpatrickwarren-oss/deploysignal-engine/detectors/betting-e-process');
  const members = new Map<string, Map<PathClassId, number>>();
  for (const e of SNAP.edges) {
    if (!members.has(e.resource)) members.set(e.resource, new Map());
    members.get(e.resource)!.set(e.path_class, e.weight ?? 1);
  }
  const any = live.values().next().value as number[][];
  const p = any[0].length;
  const out = new Map<string, number>();
  for (const [r, mw] of members) {
    const y: number[][] = Array.from({ length: TICKS }, () => new Array(p).fill(0));
    for (const [pc, w] of mw) {
      const m = live.get(pc)!;
      for (let t = 0; t < TICKS; t++) for (let j = 0; j < p; j++) y[t][j] += w * m[t][j];
    }
    const states = Array.from({ length: p }, () => freshBettingState());
    const M = new Array(p).fill(1);
    for (let t = 0; t < TICKS; t++) for (let j = 0; j < p; j++) M[j] = updateBettingState(states[j], y[t][j], 0, 1, ALPHA);
    out.set(r, M.reduce((s: number, x: number) => s + x, 0) / p);
  }
  return out;
}

function unitVarianceEscalations(live: Map<PathClassId, number[][]>): number {
  return [...unitVarianceEValues(live).values()].filter((e) => e >= 1 / ALPHA).length;
}

export interface TierReport {
  generated_for: string;
  operating_point: string;
  clean: { calibrated_escalations: number[]; unit_variance_escalations: number[]; resources: number; per_resource_rate: number; alpha: number };
  floors: { target: string; delta: number; leaf_detects: number; tier_escalates: number; mean_escalation_set: number; top_resources: string[]; n: number }[];
  /** the fault-side null comparison — WHERE the calibrated null's necessity actually shows
   *  (clean-side, mean-betting is scale-fair; the probe's error manifests on SHIFTED
   *  aggregates): the sibling room-1 aggregate E under both nulls for a room-0 Δ=1 fault. */
  sibling_null_comparison: { seed: string; calibrated_sibling_e: number; unit_variance_sibling_e: number }[];
  caveat: string;
}

export function computeTierEnvelope(log: (m: string) => void = () => {}): TierReport {
  log('clean…');
  const calCounts: number[] = [];
  const uvCounts: number[] = [];
  let resources = 0;
  for (const seed of SEEDS) {
    const { cal, live } = residPair(SNAP, seed);
    const tier = escalationTier(SNAP, cal, live, { alpha: ALPHA });
    calCounts.push(tier.escalations.length);
    resources = tier.entries.length;
    uvCounts.push(unitVarianceEscalations(live));
  }
  const floors = [
    { target: 'room-0', delta: 0.5 },
    { target: 'room-0', delta: 1 },
    { target: 'panel-7', delta: 1 },
    { target: 'optic-3', delta: 1 },
  ].map(({ target, delta }) => {
    log(`${target} Δ=${delta}…`);
    let leaf = 0;
    let tier = 0;
    let setSizes = 0;
    const tops: string[] = [];
    for (const seed of SEEDS) {
      const { cal, live } = residPair(SNAP, seed, { resource_id: target, delta, start_tick: 0 });
      if (leafDetects(cal, live)) leaf += 1;
      const t = escalationTier(SNAP, cal, live, { alpha: ALPHA });
      if (t.escalations.some((e) => e.neighborhood.includes(target))) tier += 1;
      setSizes += t.escalations.length;
      tops.push(t.escalations[0]?.resource_id ?? '—');
    }
    return { target, delta, leaf_detects: leaf, tier_escalates: tier, mean_escalation_set: setSizes / SEEDS.length, top_resources: tops, n: SEEDS.length };
  });
  log('sibling null comparison…');
  const sibling = SEEDS.map((seed) => {
    const { cal, live } = residPair(SNAP, seed, { resource_id: 'room-0', delta: 1, start_tick: 0 });
    const t = escalationTier(SNAP, cal, live, { alpha: ALPHA });
    const calE = t.entries.find((e) => e.resource_id === 'room-1')!.e_value;
    const uvE = unitVarianceEValues(live).get('room-1')!;
    return { seed: seed.toString(16), calibrated_sibling_e: calE, unit_variance_sibling_e: uvE };
  });
  return {
    sibling_null_comparison: sibling,
    generated_for: `spraypoint:${DEFAULT_SPRAYPOINT.nTors}x${DEFAULT_SPRAYPOINT.nPanels}x${DEFAULT_SPRAYPOINT.nRooms}, T=${TICKS}`,
    operating_point: `α=${ALPHA} per resource (fleet budget ≈ R·α, disclosed); tier fires when a neighborhood's aggregate crosses 1/α under the CALIBRATED null; leaf-layer control = the standard e-BH surface at q=0.05`,
    clean: {
      calibrated_escalations: calCounts,
      unit_variance_escalations: uvCounts,
      resources,
      per_resource_rate: calCounts.reduce((a, b) => a + b, 0) / (SEEDS.length * resources),
      alpha: ALPHA,
    },
    floors,
    caveat:
      'Synthetic Tier-2 (ADR-0064). The tier is an EARLY-WARNING surface: a firing aggregate claims "this ' +
      'overlapping NEIGHBORHOOD shifted — run the drill", never "this resource is at fault"; it has no ' +
      'selection semantics and no license interaction (ADR-0060 untouched). NEIGHBORHOOD SIZES on this ' +
      'fabric: optics 3, panels 12, ROOMS = THE FLEET (76 — every tor leaf carries room weight 0.5, so a ' +
      'room escalation recommends drilling everything: rooms are fleet-scale domains here, disclosed). The ' +
      'drill-recommendation ORDER is not localization — spurious narrow resources can out-rank the true ' +
      'broad one (see top_resources). The e-process guarantee is conditional on the CALIBRATED null ' +
      '(ADR-0062-class conditionality; the T=60 plug-in (mean, sd) carries ≈9% sd estimation error and an ' +
      'in-sample/out-of-sample asymmetry — mildly anti-conservative, not binding at the measured clean ' +
      '0/304). Clean-side, mean-betting is SCALE-FAIR, so the unit-variance column cannot show the probe ' +
      'error there; the calibrated null binds FAULT-SIDE — the sibling_null_comparison table: under a ' +
      'room-0 fault the room-1 aggregate GENUINELY shifts (shared members), and the calibrated null ' +
      'detects it consistently (E ≈ 1e5+ every seed — the confound is real and STRONGER than the probe ' +
      'suggested, which is exactly why the claim granularity is a neighborhood), while the unit-variance ' +
      'null is ERRATIC (2e-3 to 1.9e3 — clipped bets on mis-scaled data; the probe numbers were ' +
      'uninterpretable, not merely inflated). ' +
      'tier_escalates counts runs whose ESCALATION SET contains the true target in some fired neighborhood.',
  };
}

export function renderMarkdown(rep: TierReport): string {
  const L: string[] = [];
  L.push('# Tessera-RNG — resource e-process escalation tier (ADR-0064)');
  L.push('');
  L.push(`Operating point: ${rep.generated_for}; ${rep.operating_point}.`);
  L.push('');
  L.push(`> ${rep.caveat}`);
  L.push('');
  L.push('## Clean validity (the validation the ADR-0049 probe lacked)');
  L.push('');
  L.push('| null | escalations per run (of ' + rep.clean.resources + ' resources) | per-resource rate |');
  L.push('|---|---|---|');
  L.push(`| CALIBRATED (shipped) | ${rep.clean.calibrated_escalations.join(', ')} | ${(rep.clean.per_resource_rate * 100).toFixed(2)}% (α=${rep.clean.alpha * 100}%) |`);
  L.push(`| unit-variance (the probe's error, comparison only) | ${rep.clean.unit_variance_escalations.join(', ')} | — |`);
  L.push('');
  L.push('## Sub-floor detection (the ADR-0049 table under the honest null)');
  L.push('');
  L.push('| target | Δ | leaf layer detects | tier escalates (target in a fired neighborhood) | mean escalation-set size | top-ranked per seed | n |');
  L.push('|---|---|---|---|---|---|---|');
  for (const f of rep.floors) L.push(`| ${f.target} | ${f.delta} | ${f.leaf_detects}/${f.n} | ${f.tier_escalates}/${f.n} | ${f.mean_escalation_set.toFixed(1)} | ${f.top_resources.join(', ')} | ${f.n} |`);
  L.push('');
  L.push('## Fault-side null comparison (the calibrated null\'s necessity, shown where it binds)');
  L.push('');
  L.push('room-0 fault at Δ=1; the SIBLING room-1 aggregate E under each null (the ADR-0049 E≈882 confound):');
  L.push('');
  L.push('| seed | calibrated sibling E | unit-variance sibling E |');
  L.push('|---|---|---|');
  for (const c of rep.sibling_null_comparison) L.push(`| ${c.seed} | ${c.calibrated_sibling_e.toExponential(2)} | ${c.unit_variance_sibling_e.toExponential(2)} |`);
  L.push('');
  return L.join('\n');
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  const rep = computeTierEnvelope((m) => console.log(m));
  const outDir = join(process.cwd(), 'coverage-matrices');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'resource-eprocess.json'), JSON.stringify(rep, null, 2));
  writeFileSync(join(outDir, 'resource-eprocess.md'), renderMarkdown(rep));
  // eslint-disable-next-line no-console
  console.log('wrote coverage-matrices/resource-eprocess.{json,md}');
}

if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
