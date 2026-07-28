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
import { stripCommonMode } from './common-mode';
import { detectAll, DEFAULT_DETECT } from './detect';
import type { DetectParams } from './detect';
import { estimateBaselineCovariance, makeFamilyCCellFromCovariance } from './family-c';
import { estimateFamilyDNull } from './family-d';
import { buildSurface } from './surface';
import { localize, magnitudeZ, DEFAULT_LOCALIZE, FLEET_RESOURCE_ID } from './tomography';
import type { LocalizeOpts } from './tomography';
import { simulateDrain } from './drain';
import { makeEpochs, segmentPlan } from './epoch';
import type { LeafReset, RerouteEvent, SnapshotEpoch } from './epoch';
import { estimateDispersion, dispersionGate, DEFAULT_SIGMA_THRESHOLD } from './dispersion-gate';
import type { AuditDispersionGate, AuditRecord, Culprit, DrainAction, FiringFamilies, PathClassVerdict } from './verdict';
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
  /**
   * Contamination-robust common-mode removal (ADR-0036), OPT-IN (default OFF). Strips the engine's
   * robust per-tick cross-leaf common-mode from the residuals (calibration + live) before detection —
   * lifts the ADR-0034 high-δ cross-optic saturation (a fleet-wide fault's shared shift no longer
   * inflates q₀). ADR-0038 measured the DEFAULT cutover and REJECTED it: common-mode also strips a
   * BROAD fault's OWN signal (it mislocalized a room fault), so it is a tradeoff, not a strict win —
   * use it when concentrated-fault-amid-leak is the regime, not as a blanket default. The incremental
   * session (`SessionParams.commonModeRobust`) strips identically, so opting in keeps incremental≡batch.
   */
  commonModeRobust?: boolean;
  /**
   * Contamination-robust per-cell calibration (telemetry-realism), DEFAULT ON. Estimates each cell's
   * baseline with median/MAD/`robustLocation` instead of mean/sd, so clustered aberrations in real
   * history are tossed, not absorbed. Validated as a clean improvement (closes the aberration FDR gap,
   * ≈ mean/sd on clean history, clean FDR stays 0). Set `false` for the pre-robust mean/sd null.
   */
  robustCalibration?: boolean;
  /**
   * Calibration (null) window length, DECOUPLED from the live detection window (`telemetry.ticks`).
   * Real systems build the healthy null from a LONG history (weeks) but detect on a SHORT live window;
   * and robust per-cell calibration needs a deep enough null for per-cell resolution (telemetry-realism).
   * Default = `telemetry.ticks` (coupled — the pre-decoupling behaviour). When set, the calibration
   * substrate is built from a clean window of THIS length (same seed derivation); live detection is
   * unchanged.
   */
  calibrationTicks?: number;
  /**
   * The ς̂ dispersion gate (ADR-0051), OPT-IN (default OFF — absent keeps every audit
   * byte-identical). When set, the ADR-0050 validity precondition (per-leaf scale dispersion
   * below the measured boundary) is ESTIMATED from the calibration residuals the detector
   * context was built from, and the audit gains a `dispersion_gate` field. `passing: false`
   * withholds the FDR-controlled READING of the selection set — it never suppresses the
   * selections themselves (claim, not alarm). `true` uses DEFAULT_SIGMA_THRESHOLD.
   */
  dispersionGate?: boolean | { threshold?: number };
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
  // ADR-0036: strip the robust common-mode from the calibration residuals too. Default OFF — ADR-0038
  // evaluated the default cutover and REJECTED it (common-mode strips a BROAD fault's own signal:
  // it mislocalized a room fault). It stays opt-in. The IncrementalSession now strips live ticks
  // identically (sorted leaves, same robustLocation), so when a caller DOES opt in, a `ctx` calibrated
  // here composes with a session opened under the same flag and incremental≡batch holds.
  commonModeRobust = false,
  // Contamination-robust per-cell calibration (telemetry-realism): median/MAD/`robustLocation`
  // instead of mean/sd, so the clustered aberrations that always occur in real history are TOSSED
  // rather than absorbed into the null. DEFAULT ON — validated a clean improvement (closes the
  // aberration gap; ≈ mean/sd on clean history; clean-fabric FDR stays 0 via the higher robust
  // min-cell-samples). Set false to opt out (the pre-robust mean/sd null).
  robustCalibration = true,
  // The ς̂ dispersion gate (ADR-0051), computed HERE — from the same calibration residuals the
  // detector context is built from — so the batch pipeline and the incremental session stamp an
  // identical field by construction (the shared-prelude property, ADR-0027).
  dispersionGateOpt: boolean | { threshold?: number } = false,
): {
  calibration: ReturnType<typeof buildCalibration>;
  ctx: { familyCCell: ReturnType<typeof makeFamilyCCellFromCovariance>; familyDCells: ReturnType<typeof estimateFamilyDNull> };
  dispersionGate?: AuditDispersionGate;
} {
  const calibRaw = generateTelemetry(snapshot, {
    seed: telemetry.seed ^ 0xca11b,
    ticks: telemetry.ticks,
    noiseCorr: telemetry.noiseCorr,
    arCoeffs: telemetry.arCoeffs,
  });
  const calibration = buildCalibration(calibRaw.series, { robust: robustCalibration });
  // Common-mode removal (ADR-0036) must be applied to the calibration residuals TOO, so Family C's Σ
  // and Family D's nulls are estimated under the same regime the live detector sees (else mismatch).
  const calibResiduals = commonModeRobust ? stripCommonMode(standardizeAll(calibRaw.series, calibration)) : standardizeAll(calibRaw.series, calibration);
  const familyCCell = makeFamilyCCellFromCovariance(estimateBaselineCovariance(calibResiduals).sigma, detect.alphaC);
  const familyDCells = estimateFamilyDNull(calibResiduals);
  if (!dispersionGateOpt) return { calibration, ctx: { familyCCell, familyDCells } };
  const threshold = typeof dispersionGateOpt === 'object' && dispersionGateOpt.threshold !== undefined ? dispersionGateOpt.threshold : DEFAULT_SIGMA_THRESHOLD;
  const est = estimateDispersion(calibResiduals);
  const verdict = dispersionGate(est, threshold);
  return { calibration, ctx: { familyCCell, familyDCells }, dispersionGate: { ...verdict, raw_log_sd: est.raw_log_sd, raw_log_sd_tail: est.raw_log_sd_tail, sampling_floor_sd: est.sampling_floor_sd, n_leaves: est.n_leaves, ticks: est.ticks, signals: est.signals } };
}

export async function runPipeline(params: PipelineParams): Promise<AuditRecord> {
  const snapshot = params.snapshot ?? generateFabric(params.fabric ?? DEFAULT_FABRIC);
  const source = new StaticFaultDomainSource(snapshot);
  const snapshot_hash = source.snapshotHash(await source.fetchSnapshot());

  // Per-cell calibration substrate (AC-7): clean window, distinct seed (the shared prelude).
  const detect = params.detect ?? DEFAULT_DETECT;
  const cmRobust = params.commonModeRobust ?? false;
  // Decoupled null depth (telemetry-realism): calibrate on a clean window of `calibrationTicks`
  // (default = the live length), so a deep robust null can back a short live detection window.
  const calibTel = params.calibrationTicks ? { ...params.telemetry, ticks: params.calibrationTicks } : params.telemetry;
  const { calibration, ctx, dispersionGate: gateField } = calibrateForSession(snapshot, calibTel, detect, cmRobust, params.robustCalibration ?? true, params.dispersionGate ?? false);
  const { familyCCell, familyDCells } = ctx;

  // Epoch'd run (ADR-0017/0018): the live window follows the epoch sequence; changed leaves'
  // e-processes reset at their boundaries. Absent ⇒ the byte-identical v1 path.
  validateReroutes(params.reroutes, params.telemetry.ticks);
  const epochs = params.reroutes?.length ? makeEpochs(snapshot, params.reroutes) : null;
  const seg = epochs ? segmentPlan(epochs, params.telemetry.ticks) : null;

  const liveRaw = generateTelemetry(snapshot, epochs ? { ...params.telemetry, epochs } : params.telemetry);
  const standardized = standardizeAll(liveRaw.series, calibration);
  // ADR-0036: strip the engine's robust common-mode from the live residuals too (q₀-saturation fix).
  const residuals = cmRobust ? stripCommonMode(standardized) : standardized;
  const verdicts = detectAll(residuals, detect, { familyCCell, familyDCells }, seg?.plan);

  return assembleAudit({
    snapshot,
    snapshot_hash,
    q: params.q,
    verdicts,
    epochs,
    resets: seg?.resets ?? null,
    drain_top_k: params.drain_top_k ?? 1,
    // Linear t currency (ADR-0046): non-epoch'd runs only (epoch'd runs keep the z currency —
    // t-over-which-segment interacts with ADR-0018 grouping; recorded narrowing).
    magnitudeT: epochs ? null : leafTStats(residuals),
    ticks: params.telemetry.ticks,
    dispersion_gate: gateField ?? null,
  });
}

/**
 * Per-leaf t-statistic (ADR-0046): max over signals of |Σ_t residual| / √T — the exact
 * standardized-shift estimate on the accrued (θ√T) scale, shared verbatim by the incremental
 * session's running sums (byte-equality: same per-tick summation order).
 */
export function leafTStats(residuals: ReadonlyMap<PathClassId, number[][]>): Map<PathClassId, number> {
  const out = new Map<PathClassId, number>();
  for (const [pc, series] of residuals) {
    const p = series[0]?.length ?? 0;
    let best = 0;
    for (let j = 0; j < p; j++) {
      let s = 0;
      for (let t = 0; t < series.length; t++) s += series[t][j];
      best = Math.max(best, Math.abs(s) / Math.sqrt(series.length));
    }
    out.set(pc, best);
  }
  return out;
}

/**
 * The shared audit tail (ADR-0027): surface/e-BH → per-evidence-epoch localization → tiered
 * drains → the AuditRecord — one code path for the batch pipeline and the incremental session,
 * so streaming and batch can never drift in assembly.
 */
/** The localizer options for the audit tail: LINEAR (ADR-0046, y = max(t, z(E)) per selected
 *  leaf) when t-statistics are supplied (non-epoch'd runs), else the z-currency path (ADR-0035,
 *  epoch'd runs — recorded narrowing). */
function buildLocalizeOpts(
  surface: ReturnType<typeof buildSurface>,
  verdicts: readonly PathClassVerdict[],
  magnitudeT: ReadonlyMap<PathClassId, number> | null,
  ticks: number,
): LocalizeOpts {
  const eByPc = new Map(verdicts.map((v) => [v.path_class_id, v.e_value]));
  if (magnitudeT) {
    return {
      ...DEFAULT_LOCALIZE,
      q0: surface.base_rate_q0,
      magnitudeT: new Map(surface.selected_path_class_ids.map((pc) => [pc, Math.max(magnitudeT.get(pc) ?? 0, magnitudeZ(eByPc.get(pc)!))])),
      magnitudeTicks: ticks,
    };
  }
  return { ...DEFAULT_LOCALIZE, q0: surface.base_rate_q0, magnitude: new Map(surface.selected_path_class_ids.map((pc) => [pc, eByPc.get(pc)!])) };
}

export function assembleAudit(args: {
  snapshot: FaultDomainSnapshot;
  snapshot_hash: string;
  q: number;
  verdicts: PathClassVerdict[];
  epochs: SnapshotEpoch[] | null;
  resets: LeafReset[] | null;
  drain_top_k: number;
  /** per-leaf t-statistics (ADR-0046); present on non-epoch'd runs — activates the LINEAR scorer. */
  magnitudeT?: Map<PathClassId, number> | null;
  /** live window length (√T for the linear predictor); required with magnitudeT. */
  ticks?: number;
  /** the ADR-0051 gate field; null/absent ⇒ no field on the audit (byte-identity). */
  dispersion_gate?: AuditDispersionGate | null;
}): AuditRecord {
  const { snapshot, snapshot_hash, q, verdicts, epochs, resets } = args;
  const surface = buildSurface(verdicts, q);

  // Production scorer (ADR-0046 cutover, superseding the ADR-0035 z-currency flip): non-epoch'd
  // runs localize with the LINEAR t-statistic model — y = max(t, z(E)) per selected leaf (t
  // carries unsaturated mean-shift magnitude; z(E) carries C/D-mode evidence on the same accrued
  // scale), member model y ~ N(θ·w·√T, 1) over the fixed θ grid, null N(0,1) — q₀-free, with the
  // virtual fleet-event candidate competing. Measured (ADR-0046): cross-kind recovery 4/4 across
  // δ∈{3..32} (z: 0/4 at δ≥16), room Δ=2 attribution 4/4, C1 exact minimal set at δ=128.
  // Epoch'd runs keep the ADR-0035 z path (recorded narrowing).
  const locOpts = buildLocalizeOpts(surface, verdicts, epochs ? null : args.magnitudeT ?? null, args.ticks ?? 1);
  const loc = epochs
    ? localizeByEvidenceEpoch(epochs, verdicts, surface.selected_path_class_ids, locOpts)
    : localize(snapshot, surface.selected_path_class_ids, locOpts);

  // Drains act on the LATEST epoch's snapshot — the fabric as routed NOW (ADR-0018) — picking
  // targets by TIER then score (ADR-0023), one drain per resource. The v1 path is untouched
  // (a single greedy list is already tier-ordered and resource-unique). The virtual fleet-event
  // culprit (ADR-0046) is NEVER a drain target — a fleet-wide elevation has no route to drain.
  const k = args.drain_top_k;
  const drainable = loc.culprits.filter((c) => c.resource_id !== FLEET_RESOURCE_ID);
  const targets = epochs ? drainTargets(drainable, k) : drainable.slice(0, k);
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
    ...(args.dispersion_gate ? { dispersion_gate: args.dispersion_gate } : {}),
  };
}
