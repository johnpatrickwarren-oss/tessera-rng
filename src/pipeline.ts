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
import { localize, DEFAULT_LOCALIZE } from './tomography';
import type { LocalizeOpts } from './tomography';
import { simulateDrain } from './drain';
import { makeEpochs, segmentPlan } from './epoch';
import type { LeafReset, RerouteEvent, SnapshotEpoch } from './epoch';
import type { AuditRecord, Culprit, DrainAction, FiringFamilies, PathClassVerdict } from './verdict';
import type { PathClassId } from './domain';

export interface PipelineParams {
  fabric?: FabricParams;
  /** operator-supplied incidence model; overrides the generated fabric when provided (ADR-0005). */
  snapshot?: FaultDomainSnapshot;
  /**
   * `degradation`/`degradations` apply to the LIVE window only; `noiseCorr`/`arCoeffs` are the BASELINE structure
   * and are applied to BOTH the calibration and live windows (so the substrate is calibrated under
   * the same correlation/AR(p) regime the live stream carries — ADR-0007/0008/0010).
   */
  telemetry: { seed: number; ticks: number; degradation?: DegradationSpec; degradations?: readonly DegradationSpec[]; noiseCorr?: number[][]; arCoeffs?: number[][] };
  detect?: DetectParams;
  /** e-BH FDR target. */
  q: number;
  /** how many top culprits to act on with the (simulated) drain. On epoch'd runs "top" means
   *  tier-then-score (ADR-0023): every evidence group's rank-1 drains before any rank-2. */
  drain_top_k?: number;
  /**
   * Synthetic reroute/reconvergence events (ADR-0017/0018). Present ⇒ the run is epoch'd: the
   * degradation follows the active epoch, changed leaves' e-processes reset at their boundaries
   * (recorded in `eprocess_resets`), and tomography runs per evidence epoch. Absent or empty ⇒
   * byte-identical v1 audit.
   */
  reroutes?: readonly RerouteEvent[];
}

/**
 * Per-evidence-epoch tomography (ADR-0018): selected leaves are grouped by the epoch their firing
 * evidence accrued in and localized against THAT epoch's snapshot; per-epoch culprit lists are
 * concatenated in epoch order, each in greedy PICK order (the property ADR-0023's tiering
 * assumes; pick order coincides with score order within a group), unexplained sets unioned.
 */
function localizeByEvidenceEpoch(
  epochs: readonly SnapshotEpoch[],
  verdicts: readonly PathClassVerdict[],
  selected: readonly PathClassId[],
  opts: LocalizeOpts,
): { culprits: Culprit[]; unexplained_path_class_ids: PathClassId[] } {
  const epochOf = new Map(verdicts.map((v) => [v.path_class_id, v.evidence_epoch]));
  const groups = new Map<number, PathClassId[]>();
  for (const id of selected) {
    // Segmented leaves group where their max evidence accrued. An UNSEGMENTED leaf's evidence
    // epoch is unknown/spanning — never fabricated: its incidence is epoch-invariant, so by
    // stated convention it joins the LATEST epoch's group (exact for its own edges, merges with
    // the most-recent evidence rather than fragmenting the joint localization — ADR-0018).
    const e = epochOf.get(id) ?? epochs.length - 1;
    if (!groups.has(e)) groups.set(e, []);
    groups.get(e)!.push(id);
  }
  const culprits: Culprit[] = [];
  const unexplained = new Set<PathClassId>();
  for (const e of [...groups.keys()].sort((a, b) => a - b)) {
    const loc = localize(epochs[e].snapshot, groups.get(e)!, opts);
    culprits.push(...loc.culprits.map((c) => ({ ...c, localized_against_epoch: e })));
    for (const u of loc.unexplained_path_class_ids) unexplained.add(u);
  }
  return { culprits, unexplained_path_class_ids: [...unexplained].sort() };
}

/**
 * Drain targets on an epoch'd run (ADR-0023): TIER first, then score, one drain per resource.
 * A culprit's tier is its pick position within its evidence group — tier-1 entries carry full
 * LLRs (comparable across groups); tier ≥ 2 entries are pick-order-conditional marginals
 * (ADR-0022), comparable within a tier, approximately across groups (recorded). Every group's
 * strongest culprit drains before any group's second pick — a real fault localized in a later
 * epoch cannot be starved by another group's trailing marginal.
 */
export function drainTargets(culprits: readonly Culprit[], k: number): Culprit[] {
  // direct callers: culprits without localized_against_epoch tier-count as group 0 (the
  // pipeline always stamps the field on epoch'd runs and never calls this otherwise).
  const tierWithin = new Map<number, number>();
  const tiered = culprits.map((c) => {
    const g = c.localized_against_epoch ?? 0;
    const tier = tierWithin.get(g) ?? 0;
    tierWithin.set(g, tier + 1);
    return { c, tier };
  });
  tiered.sort((x, y) => x.tier - y.tier || y.c.score - x.c.score || (x.c.resource_id < y.c.resource_id ? -1 : x.c.resource_id > y.c.resource_id ? 1 : 0));
  const seen = new Set<string>();
  const out: Culprit[] = [];
  for (const { c } of tiered) {
    if (seen.has(c.resource_id)) continue;
    seen.add(c.resource_id);
    out.push(c);
    if (out.length === k) break;
  }
  return out;
}

/** Integer-tick boundaries strictly inside (0, ticks) only (ADR-0018): telemetry switches at
 *  `tick >= at_tick` while detection slices at floor(at_tick) — a fractional boundary would
 *  silently disagree by one tick; and an event at/after the window end was never active during
 *  measurement — reject it, don't record it. */
function validateReroutes(reroutes: readonly RerouteEvent[] | undefined, ticks: number): void {
  for (const ev of reroutes ?? []) {
    if (!Number.isInteger(ev.at_tick) || ev.at_tick <= 0 || ev.at_tick >= ticks) {
      throw new RangeError(`reroute at_tick must be an integer in (0, ticks) — got ${ev.at_tick}`);
    }
  }
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

/**
 * The calibration prelude, shared by the batch pipeline, the incremental session's operators,
 * and the equivalence tests (ADR-0027 cold-eye P4): a CLEAN synthetic window (distinct seed) →
 * per-cell substrate, learned Family C Σ, Family D nulls. "Calibrate offline, stream live"
 * without reverse-engineering pipeline internals.
 */
export function calibrateForSession(
  snapshot: FaultDomainSnapshot,
  telemetry: { seed: number; ticks: number; noiseCorr?: number[][]; arCoeffs?: number[][] },
  detect: DetectParams = DEFAULT_DETECT,
): { calibration: ReturnType<typeof buildCalibration>; ctx: { familyCCell: ReturnType<typeof makeFamilyCCellFromCovariance>; familyDCells: ReturnType<typeof estimateFamilyDNull> } } {
  const calibRaw = generateTelemetry(snapshot, {
    seed: telemetry.seed ^ 0xca11b,
    ticks: telemetry.ticks,
    noiseCorr: telemetry.noiseCorr,
    arCoeffs: telemetry.arCoeffs,
  });
  const calibration = buildCalibration(calibRaw.series);
  const calibResiduals = standardizeAll(calibRaw.series, calibration);
  const familyCCell = makeFamilyCCellFromCovariance(estimateBaselineCovariance(calibResiduals).sigma, detect.alphaC);
  const familyDCells = estimateFamilyDNull(calibResiduals);
  return { calibration, ctx: { familyCCell, familyDCells } };
}

export async function runPipeline(params: PipelineParams): Promise<AuditRecord> {
  const snapshot = params.snapshot ?? generateFabric(params.fabric ?? DEFAULT_FABRIC);
  const source = new StaticFaultDomainSource(snapshot);
  const snapshot_hash = source.snapshotHash(await source.fetchSnapshot());

  // Per-cell calibration substrate (AC-7): clean window, distinct seed (the shared prelude).
  const detect = params.detect ?? DEFAULT_DETECT;
  const { calibration, ctx } = calibrateForSession(snapshot, params.telemetry, detect);
  const { familyCCell, familyDCells } = ctx;

  // Epoch'd run (ADR-0017/0018): the live window follows the epoch sequence; changed leaves'
  // e-processes reset at their boundaries. Absent ⇒ the byte-identical v1 path.
  validateReroutes(params.reroutes, params.telemetry.ticks);
  const epochs = params.reroutes?.length ? makeEpochs(snapshot, params.reroutes) : null;
  const seg = epochs ? segmentPlan(epochs, params.telemetry.ticks) : null;

  const liveRaw = generateTelemetry(snapshot, epochs ? { ...params.telemetry, epochs } : params.telemetry);
  const residuals = standardizeAll(liveRaw.series, calibration);
  const verdicts = detectAll(residuals, detect, { familyCCell, familyDCells }, seg?.plan);

  return assembleAudit({ snapshot, snapshot_hash, q: params.q, verdicts, epochs, resets: seg?.resets ?? null, drain_top_k: params.drain_top_k ?? 1 });
}

/**
 * The shared audit tail (ADR-0027): surface/e-BH → per-evidence-epoch localization → tiered
 * drains → the AuditRecord — one code path for the batch pipeline and the incremental session,
 * so streaming and batch can never drift in assembly.
 */
export function assembleAudit(args: {
  snapshot: FaultDomainSnapshot;
  snapshot_hash: string;
  q: number;
  verdicts: PathClassVerdict[];
  epochs: SnapshotEpoch[] | null;
  resets: LeafReset[] | null;
  drain_top_k: number;
}): AuditRecord {
  const { snapshot, snapshot_hash, q, verdicts, epochs, resets } = args;
  const surface = buildSurface(verdicts, q);

  const locOpts = { ...DEFAULT_LOCALIZE, q0: surface.base_rate_q0 };
  const loc = epochs
    ? localizeByEvidenceEpoch(epochs, verdicts, surface.selected_path_class_ids, locOpts)
    : localize(snapshot, surface.selected_path_class_ids, locOpts);

  // Drains act on the LATEST epoch's snapshot — the fabric as routed NOW (ADR-0018) — picking
  // targets by TIER then score (ADR-0023), one drain per resource. The v1 path is untouched
  // (a single greedy list is already tier-ordered and resource-unique).
  const k = args.drain_top_k;
  const targets = epochs ? drainTargets(loc.culprits, k) : loc.culprits.slice(0, k);
  const drainSnap = epochs ? epochs[epochs.length - 1].snapshot : snapshot;
  const drain_actions: DrainAction[] = targets.map((c) => simulateDrain(drainSnap, c));

  return {
    snapshot_hash,
    q,
    fleet_log_e: surface.fleet_log_e,
    verdicts: [...verdicts].sort((a, b) => (a.path_class_id < b.path_class_id ? -1 : a.path_class_id > b.path_class_id ? 1 : 0)),
    selected_path_class_ids: surface.selected_path_class_ids,
    culprits: loc.culprits,
    unexplained_path_class_ids: loc.unexplained_path_class_ids,
    drain_actions,
    firing_families: tallyFiringFamilies(verdicts, surface.selected_path_class_ids),
    ...(epochs
      ? {
          epochs: epochs.map((e) => ({ valid_from_tick: e.valid_from_tick, hash: e.hash })),
          eprocess_resets: resets ?? [],
        }
      : {}),
  };
}
