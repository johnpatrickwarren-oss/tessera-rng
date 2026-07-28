/**
 * The ς power axis (ADR-0054): fault detection + attribution under per-leaf scale dispersion.
 *
 * Closes the ADR-0050 "not a power measurement" deferral: faulted runs (the ADR-0032 operating
 * point — optic mean fault δ=3, DEFAULT_SPRAYPOINT, 60 ticks, q=0.05) across ς × {shared
 * calibration, perLeafScale}. Composition mirrors the production path end-to-end (calibration
 * under the same ς physics, full audit tail incl. tomography); the ς=0 shared-calibration cell
 * is anchor-bound byte-for-byte to runPipeline (test/heterogeneity-power.test.ts). Metrics are
 * sharper than ADR-0032's because under dispersion "any selection" is trivially true: detection
 * = an AFFECTED leaf selected; attribution = the faulted resource rank-1; false co-selections
 * = selected leaves the fault does not touch (the ADR-0050 mechanism inside a faulted run).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateSpraypointFabric, DEFAULT_SPRAYPOINT } from '../src/spraypoint';
import { StaticFaultDomainSource } from '../src/fault-domain-source';
import { generateTelemetry } from '../src/telemetry';
import type { HeterogeneitySpec } from '../src/telemetry';
import { buildCalibration, standardizeAll } from '../src/calibration';
import { detectAll, DEFAULT_DETECT } from '../src/detect';
import { estimateBaselineCovariance, makeFamilyCCellFromCovariance } from '../src/family-c';
import { estimateFamilyDNull } from '../src/family-d';
import { assembleAudit, leafTStats } from '../src/pipeline';
import { FLEET_RESOURCE_ID } from '../src/tomography';
import type { AuditRecord } from '../src/verdict';
import type { FaultDomainSnapshot, PathClassId, ResourceId } from '../src/domain';

const SEEDS = [0xb0a01, 0xb0a02, 0xb0a03, 0xb0a04, 0xb0a05, 0xb0a06, 0xb0a07, 0xb0a08];
const TARGETS: ResourceId[] = ['optic-3', 'optic-40'];
const SIGMA_GRID = [0, 0.1, 0.2, 0.3];
const TICKS = 60;
const Q = 0.05;
const DELTA = 3;

const SNAP = generateSpraypointFabric(DEFAULT_SPRAYPOINT);

/** One faulted run through the production composition; returns the full audit. */
export async function runFaulted(seed: number, target: ResourceId, het: HeterogeneitySpec | undefined, perLeafScale: boolean): Promise<AuditRecord> {
  const source = new StaticFaultDomainSource(SNAP);
  const snapshot_hash = source.snapshotHash(await source.fetchSnapshot());
  const calHet = het ? { heterogeneity: { ...het, driftMix: 0 } } : {};
  const calibRaw = generateTelemetry(SNAP, { seed: seed ^ 0xca11b, ticks: TICKS, ...calHet });
  const calibration = buildCalibration(calibRaw.series, { robust: true, perLeafScale });
  const calibResiduals = standardizeAll(calibRaw.series, calibration);
  const ctx = {
    familyCCell: makeFamilyCCellFromCovariance(estimateBaselineCovariance(calibResiduals).sigma, DEFAULT_DETECT.alphaC),
    familyDCells: estimateFamilyDNull(calibResiduals),
  };
  const live = generateTelemetry(SNAP, {
    seed,
    ticks: TICKS,
    degradation: { resource_id: target, delta: DELTA, start_tick: 0 },
    ...(het ? { heterogeneity: het } : {}),
  });
  const residuals = standardizeAll(live.series, calibration);
  const verdicts = detectAll(residuals, DEFAULT_DETECT, ctx);
  return assembleAudit({ snapshot: SNAP, snapshot_hash, q: Q, verdicts, epochs: null, resets: null, drain_top_k: 1, magnitudeT: leafTStats(residuals), ticks: TICKS });
}

/**
 * Leaves the fault MATERIALLY touches: incidence weight ≥ 0.5 (the mean shift is δ·w, so a
 * cross-optic edge at 1/(nTors−1) shifts its leaf by ≈ 0.05σ — undetectable at this δ). Without
 * the threshold, crossOptic incidence makes every tor leaf "affected" and the false-co-selection
 * metric degenerates to 0 (caught during the build — recorded in ADR-0054). Diluted (w < 0.5)
 * selected leaves count as false co-selections DELIBERATELY: their ε-shift is not what selected
 * them (caveated in the artifact).
 */
const MATERIAL_WEIGHT = 0.5;
function affectedLeaves(snapshot: FaultDomainSnapshot, target: ResourceId): Set<PathClassId> {
  const s = new Set<PathClassId>();
  for (const e of snapshot.edges) if (e.resource === target && (e.weight ?? 1) >= MATERIAL_WEIGHT) s.add(e.path_class);
  return s;
}

export interface PowerCell {
  sigma: number;
  per_leaf_scale: boolean;
  fault_detection_rate: number;
  attribution_rate: number;
  /** when attribution fails, WHERE it went: rank-1 = the virtual fleet-event candidate. A
   *  fleet-event mis-read and a wrong-physical-resource mis-read are different operational
   *  stories — published separately, not folded into one failure number. */
  fleet_event_top_rate: number;
  mean_false_coselections: number;
  mean_selected: number;
  n: number;
}

export async function computePowerEnvelope(log: (m: string) => void = () => {}): Promise<{ cells: PowerCell[] }> {
  const cells: PowerCell[] = [];
  for (const pls of [false, true]) {
    for (const sigma of SIGMA_GRID) {
      log(`ς=${sigma} perLeafScale=${pls}…`);
      let detected = 0;
      let attributed = 0;
      let fleetTop = 0;
      let falseCo = 0;
      let selected = 0;
      let n = 0;
      for (const target of TARGETS) {
        const affected = affectedLeaves(SNAP, target);
        for (const seed of SEEDS) {
          const audit = await runFaulted(seed, target, sigma > 0 ? { sigmaLogSd: sigma } : undefined, pls);
          n += 1;
          const sel = audit.selected_path_class_ids;
          selected += sel.length;
          const hitFault = sel.some((pc) => affected.has(pc));
          if (hitFault) detected += 1;
          if (audit.culprits[0]?.resource_id === target) attributed += 1;
          if (audit.culprits[0]?.resource_id === FLEET_RESOURCE_ID) fleetTop += 1;
          falseCo += sel.filter((pc) => !affected.has(pc)).length;
        }
      }
      cells.push({
        sigma,
        per_leaf_scale: pls,
        fault_detection_rate: detected / n,
        attribution_rate: attributed / n,
        fleet_event_top_rate: fleetTop / n,
        mean_false_coselections: falseCo / n,
        mean_selected: selected / n,
        n,
      });
    }
  }
  return { cells };
}

export interface PowerReport {
  generated_for: string;
  operating_point: string;
  cells: PowerCell[];
  caveat: string;
}

export function renderMarkdown(rep: PowerReport): string {
  const L: string[] = [];
  L.push('# Tessera-RNG — the ς power axis (ADR-0054)');
  L.push('');
  L.push(`Operating point: ${rep.generated_for}; ${rep.operating_point}.`);
  L.push('');
  L.push(`> ${rep.caveat}`);
  L.push('');
  const table = (pls: boolean, title: string) => {
    L.push(`## ${title}`);
    L.push('');
    L.push('| ς | fault detection | attribution (rank-1) | fleet-event top | mean false co-sel | mean selected | n |');
    L.push('|---|---|---|---|---|---|---|');
    for (const c of rep.cells.filter((x) => x.per_leaf_scale === pls)) {
      L.push(`| ${c.sigma} | ${Math.round(c.fault_detection_rate * 100)}% | ${Math.round(c.attribution_rate * 100)}% | ${Math.round(c.fleet_event_top_rate * 100)}% | ${c.mean_false_coselections.toFixed(2)} | ${c.mean_selected.toFixed(2)} | ${c.n} |`);
    }
    L.push('');
  };
  table(false, 'Shared calibration (the ADR-0050 exposure)');
  table(true, 'perLeafScale ON (the ADR-0052 remedy, static ς)');
  return L.join('\n');
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  const { cells } = await computePowerEnvelope((m) => console.log(m));
  const rep: PowerReport = {
    generated_for: `spraypoint:${DEFAULT_SPRAYPOINT.nTors}x${DEFAULT_SPRAYPOINT.nPanels}x${DEFAULT_SPRAYPOINT.nRooms}`,
    operating_point: `optic mean fault δ=${DELTA} from tick 0, ${TICKS} ticks, q=${Q}; 2 targets × ${SEEDS.length} seeds ⇒ n=16/cell; calibration under the same ς physics (driftMix 0)`,
    cells,
    caveat:
      'Synthetic Tier-2 (ADR-0054). Detection = a MATERIALLY affected leaf (incidence w ≥ 0.5) selected; ' +
      'attribution = the faulted resource rank-1; fleet-event top = the virtual fleet candidate rank-1 ' +
      '(a different failure story than a wrong physical resource); false co-selections = selected leaves ' +
      'below the material threshold — diluted leaves (w ≤ 2/64 for an optic fault: panel-pair leaves at ' +
      '2/64 ⇒ shift ≈ 0.09σ, cross-optic at 1/63 ⇒ ≈ 0.05σ; both sub-detectable, t ≲ 0.7 over 60 ticks) ' +
      'count as false DELIBERATELY (their selection is not fault-driven). The ς=0 shared-calibration cell is ' +
      'anchor-bound byte-for-byte to runPipeline. Static ς only (drift is ADR-0053 scope); mean-mode ' +
      'fault only (mode coverage is ADR-0032 scope).',
  };
  const outDir = join(process.cwd(), 'coverage-matrices');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'heterogeneity-power.json'), JSON.stringify(rep, null, 2));
  writeFileSync(join(outDir, 'heterogeneity-power.md'), renderMarkdown(rep));
  // eslint-disable-next-line no-console
  console.log('wrote coverage-matrices/heterogeneity-power.{json,md}');
}

if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
