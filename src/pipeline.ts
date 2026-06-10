/**
 * End-to-end pipeline (v1 walking skeleton; DISCIPLINES §3).
 *
 * Proves the spine: synthetic telemetry → per-path-class e-processes → e-BH surface →
 * one tomographic localization → simulated route-drain → a single replay-clean AuditRecord.
 * Same fabric params + same telemetry params ⇒ byte-identical AuditRecord (spec AC-9).
 */
import { generateFabric, DEFAULT_FABRIC } from './fabric';
import type { FabricParams } from './fabric';
import type { FaultDomainSnapshot } from './domain';
import { StaticFaultDomainSource } from './fault-domain-source';
import { generateTelemetry } from './telemetry';
import type { DegradationSpec } from './telemetry';
import { buildCalibration, standardizeAll } from './calibration';
import { detectAll, DEFAULT_DETECT } from './detect';
import type { DetectParams } from './detect';
import { estimateBaselineCovariance, makeFamilyCCellFromCovariance } from './family-c';
import { estimateFamilyDNull } from './family-d';
import { buildSurface } from './surface';
import { localize } from './tomography';
import { simulateDrain } from './drain';
import type { AuditRecord, DrainAction, FiringFamilies, PathClassVerdict } from './verdict';
import type { PathClassId } from './domain';

export interface PipelineParams {
  fabric?: FabricParams;
  /** operator-supplied incidence model; overrides the generated fabric when provided (ADR-0005). */
  snapshot?: FaultDomainSnapshot;
  /**
   * `degradation` applies to the LIVE window only; `noiseCorr`/`arCoeffs` are the BASELINE structure
   * and are applied to BOTH the calibration and live windows (so the substrate is calibrated under
   * the same correlation/AR(p) regime the live stream carries — ADR-0007/0008/0010).
   */
  telemetry: { seed: number; ticks: number; degradation?: DegradationSpec; noiseCorr?: number[][]; arCoeffs?: number[][] };
  detect?: DetectParams;
  /** e-BH FDR target. */
  q: number;
  /** how many top culprits to act on with the (simulated) drain. */
  drain_top_k?: number;
}

/** Tally which family fired on each selected path-class (firing-mode attribution, ADR-0010). */
function tallyFiringFamilies(verdicts: readonly PathClassVerdict[], selected: readonly PathClassId[]): FiringFamilies {
  const sel = new Set(selected);
  const tally: FiringFamilies = { A: 0, C: 0, D: 0 };
  for (const v of verdicts) {
    if (!sel.has(v.path_class_id)) continue;
    for (const d of v.detectors) if (d.fired) tally[d.family] += 1;
  }
  return tally;
}

export async function runPipeline(params: PipelineParams): Promise<AuditRecord> {
  const snapshot = params.snapshot ?? generateFabric(params.fabric ?? DEFAULT_FABRIC);
  const source = new StaticFaultDomainSource(snapshot);
  const snapshot_hash = source.snapshotHash(await source.fetchSnapshot());

  // Per-cell calibration substrate (AC-7): characterize the "normal" smear from a CLEAN
  // window, then standardize the live (possibly degraded) raw stream against it. Distinct
  // calibration seed → calibration noise is independent of the live window.
  const calibRaw = generateTelemetry(snapshot, {
    seed: params.telemetry.seed ^ 0xca11b,
    ticks: params.telemetry.ticks,
    noiseCorr: params.telemetry.noiseCorr,
    arCoeffs: params.telemetry.arCoeffs,
  });
  const calibration = buildCalibration(calibRaw.series);
  // Learn the Family C baseline covariance Σ from the CLEAN calibration residuals (ADR-0007):
  // cross-signal co-movement the identity-Σ baseline could not see. Uncorrelated signals → Σ≈I.
  const detect = params.detect ?? DEFAULT_DETECT;
  const calibResiduals = standardizeAll(calibRaw.series, calibration);
  const sigma = estimateBaselineCovariance(calibResiduals).sigma;
  const familyCCell = makeFamilyCCellFromCovariance(sigma, detect.alphaC);
  // Family D (spectral) nulls from the clean residuals (ADR-0009): the peak-|ACF| baseline each
  // signal's live oscillation must exceed to fire. Silent for signals with too short a window.
  const familyDCells = estimateFamilyDNull(calibResiduals);

  const liveRaw = generateTelemetry(snapshot, params.telemetry);
  const residuals = standardizeAll(liveRaw.series, calibration);
  const verdicts = detectAll(residuals, detect, { familyCCell, familyDCells });
  const surface = buildSurface(verdicts, params.q);

  const loc = localize(snapshot, surface.selected_path_class_ids);

  const k = params.drain_top_k ?? 1;
  const drain_actions: DrainAction[] = loc.culprits.slice(0, k).map((c) => simulateDrain(snapshot, c));

  return {
    snapshot_hash,
    q: params.q,
    fleet_log_e: surface.fleet_log_e,
    verdicts: [...verdicts].sort((a, b) => (a.path_class_id < b.path_class_id ? -1 : a.path_class_id > b.path_class_id ? 1 : 0)),
    selected_path_class_ids: surface.selected_path_class_ids,
    culprits: loc.culprits,
    unexplained_path_class_ids: loc.unexplained_path_class_ids,
    drain_actions,
    firing_families: tallyFiringFamilies(verdicts, surface.selected_path_class_ids),
  };
}
