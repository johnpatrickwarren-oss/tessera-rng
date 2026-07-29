/**
 * Incremental session (ADR-0027): the streaming face of the batch pipeline — feed raw ticks as
 * they arrive, query a full AuditRecord at ANY tick. Each component is anytime-valid in its own
 * filtration (betting e-processes, Safe-Hotelling, the spectral e-detector), and any single
 * query at any tick is a valid fixed-time read; the COMBINED leaf e-value is not itself an
 * anytime e-process in tick time (Family D lives in the window filtration — ADR-0044 pins the
 * boundary and the K/c union bound that survives it).
 *
 * The binding contract is byte-equality with the batch path: ingesting the batch pipeline's
 * exact live telemetry tick-by-tick must reproduce `runPipeline`'s audit byte-for-byte at the
 * final tick (single-fault, multi-fault, and epoch'd reroute runs — bound in session.test.ts).
 * The audit tail (surface → localization → drains) is literally shared (`assembleAudit`).
 *
 * Recorded narrowings (ADR-0027): calibration is batch (a session opens WITH a substrate built
 * from a clean window — calibrate offline, stream live); `ingest` expects a full tick for all
 * leaves; querying every tick and acting on the first positive is a stopping rule — each query
 * is valid, but the published FDR figure describes a single query. ADR-0043 pins the exact
 * boundary of that narrowing: FDR at an arbitrary data-dependent stopping time (stopped e-BH,
 * arXiv:2502.08539) needs stream independence or a no-unobserved-confounding condition our
 * correlated leaves have not been shown to satisfy, and finite mean time-to-alarm with nontrivial worst-case
 * streaming FDR is impossible outright (arXiv:2501.04130) — the controllable streaming metric is
 * error-over-patience (EOP), adoptable if detection moves to e-detector form (recorded future).
 */
import {
  freshBettingState,
  updateBettingState,
} from '@johnpatrickwarren-oss/deploysignal-engine/detectors/betting-e-process';
import {
  freshSafeHotellingState,
  evaluateSafeHotelling,
} from '@johnpatrickwarren-oss/deploysignal-engine/detectors/hotelling';
import type { FamilyCPerCell } from '@johnpatrickwarren-oss/deploysignal-engine/types/families/c';
import { freshStreamStandardizer, standardizeTick } from './calibration';
import { stripCommonModeTick } from './common-mode';
import { logScaleFromSums, dispersionFromLogScales, DEFAULT_SIGMA_THRESHOLD } from './dispersion-gate';
import { driftMonitor, degenerateDriftVerdict } from './drift-monitor';
import type { CalibrationSubstrate, StreamStandardizer } from './calibration';
import { DEFAULT_DETECT, combineSegmentRuns } from './detect';
import type { DetectParams, DetectorContext, SegmentSpec } from './detect';
import { makeFamilyCCell } from './family-c';
import { DEFAULT_SPECTRAL, freshSpectralStream, feedSpectralWindow, readSpectralWealth } from './family-d';
import { makeEpochs, changedLeaves, epochIndexAt } from './epoch';
import type { LeafReset, RerouteEvent, SnapshotEpoch } from './epoch';
import { assembleAudit } from './pipeline';
import { computeFaultDomainHash } from './fault-domain-source';
import { SIGNALS } from './signals';
import type { SignalVector } from './signals';
import type { FaultDomainSnapshot, PathClassId } from './domain';
import type { AuditDispersionGate, AuditRecord, DetectorResult, PathClassVerdict } from './verdict';

export interface SessionParams {
  snapshot: FaultDomainSnapshot;
  /** built from a CLEAN window, offline — the batch calibration substrate (recorded narrowing). */
  calibration: CalibrationSubstrate;
  q: number;
  detect?: DetectParams;
  /** the calibrated detector context (learned Σ cell, Family D nulls) — same as the batch path. */
  ctx?: DetectorContext;
  reroutes?: readonly RerouteEvent[];
  drain_top_k?: number;
  /**
   * Contamination-robust common-mode removal (ADR-0036), OPT-IN (default OFF — see ADR-0038, which
   * rejected the default cutover). When set, strips the engine's robust per-tick cross-leaf common-mode
   * from each ingested tick — IDENTICAL to the batch path (sorted leaf order, same `robustLocation`),
   * so incremental≡batch byte-equality holds. The caller's `ctx` MUST be calibrated under the same
   * setting (`calibrateForSession` with the matching flag) or the detectors are mis-calibrated.
   */
  commonModeRobust?: boolean;
  /**
   * The ADR-0051 ς̂ dispersion-gate field, computed by `calibrateForSession` (the shared prelude —
   * calibration is batch per ADR-0027, so the estimate exists once, at open). When supplied it is
   * stamped verbatim on every audit this session emits — identical to the batch pipeline's field
   * by construction. Absent ⇒ no field (byte-identity).
   */
  dispersionGate?: AuditDispersionGate;
  /**
   * The runtime drift monitor (ADR-0053), OPT-IN: `audit()` computes the ADR-0051 estimator on
   * the live window from per-leaf running sums (Σx, Σx² — accumulated in the same per-tick
   * order as the batch column sums, so the stamped field is bit-for-bit the batch pipeline's on
   * the same inputs). Non-epoch'd sessions only (reroutes throw at open — recorded narrowing).
   * At t < 3 the verdict is the degenerate `indeterminate` (no variance estimate exists).
   */
  driftMonitor?: boolean | { threshold?: number };
  /**
   * Anytime alarms (ADR-0062): the Ville rule at threshold 1/α_leaf on the per-leaf tick-valid
   * family mean (A + C)/2 — P(a null leaf EVER alarms) ≤ α_leaf UNDER THE CALIBRATED NULL:
   * dispersion/drift voids the guarantee exactly as it voids e-BH validity (ADR-0050/0057 —
   * real fleets measured far past the boundary), so the alarm read carries the SAME
   * gate/monitor (or perLeafScale) preconditions as the evidence surface. Checked per ingest,
   * first crossing recorded once; scope 'fleet' runs each leaf at α/n (fleet-wise ≤ α).
   * Family D excluded (ADR-0044). Session-only; reroutes throw (wealth resets restart
   * segments); commonModeRobust throws (the cross-leaf strip makes residuals depend on the
   * fleet's concurrent tick — the per-leaf supermartingale is only approximate; recorded
   * narrowing).
   */
  eopAlarms?: { alpha?: number; scope?: 'per-leaf' | 'fleet' };
}

interface DetectorStates {
  aStates: ReturnType<typeof freshBettingState>[];
  aM: number[];
  cState: ReturnType<typeof freshSafeHotellingState>;
  dStates: (ReturnType<typeof freshSpectralStream> | null)[] | null;
  dBufs: number[][] | null;
}

interface LeafState {
  std: StreamStandardizer;
  det: DetectorStates;
  /** per-signal running residual sums (ADR-0046) — the t-statistic numerator, accumulated in the
   *  same per-tick order as the batch path's column sums (byte-equality). */
  residSums: number[];
  /** per-signal running Σx² (ADR-0053) — the drift monitor's variance numerator, same order. */
  residSumsqs: number[];
  /** completed epoch segments: the segment's verdict + its spec (ADR-0018 bookkeeping). */
  doneRuns: PathClassVerdict[];
  doneSegs: SegmentSpec[];
  segStart: number;
  segEpoch: number;
  /** this leaf's incidence-change boundaries: tick → epoch index. */
  resets: Map<number, number>;
}

function freshDetectors(ctx: DetectorContext): DetectorStates {
  const d = ctx.familyDCells ?? null;
  return {
    aStates: SIGNALS.map(() => freshBettingState()),
    aM: SIGNALS.map(() => 1),
    cState: freshSafeHotellingState(),
    dStates: d ? d.map((cell) => (cell ? freshSpectralStream() : null)) : null,
    dBufs: d ? d.map(() => []) : null,
  };
}

/** ADR-0053 open-time validation. Recorded narrowings: epoch resets fragment per-leaf live
 *  windows (the running sums would silently span segments, wrong floor); and a 1-leaf
 *  population has no cross-leaf dispersion — the batch estimator throws, and without the guard
 *  the sums path divides by (n−1)=0 and NaN reads as 'ok' (cold-eye finding 2). */
function validateDriftMonitorParams(params: SessionParams): void {
  if (!params.driftMonitor) return;
  if (params.reroutes?.length) throw new RangeError('driftMonitor with reroutes is unsupported (ADR-0053 recorded narrowing)');
  if (params.snapshot.path_classes.length < 2) {
    throw new RangeError(`driftMonitor needs ≥ 2 leaves — got ${params.snapshot.path_classes.length} (ADR-0053; parity with estimateDispersion)`);
  }
}

/** ADR-0062 open-time validation: α ∈ (0, 1); reroutes throw (wealth resets restart segments —
 *  the Ville ever-guarantee does not span resets; recorded narrowing). Returns the per-leaf
 *  threshold: 1/α ('per-leaf') or n/α ('fleet' — Bonferroni over the population). */
function eopThreshold(params: SessionParams): number | null {
  if (!params.eopAlarms) return null;
  const alpha = params.eopAlarms.alpha ?? 0.05;
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`eopAlarms.alpha must be in (0, 1) — got ${alpha}`);
  if (params.reroutes?.length) throw new RangeError('eopAlarms with reroutes is unsupported (ADR-0062 recorded narrowing)');
  if (params.commonModeRobust) throw new RangeError('eopAlarms with commonModeRobust is unsupported (ADR-0062 recorded narrowing — the cross-leaf strip breaks the per-leaf supermartingale)');
  const scope = params.eopAlarms.scope ?? 'per-leaf';
  return scope === 'fleet' ? params.snapshot.path_classes.length / alpha : 1 / alpha;
}

export class IncrementalSession {
  private readonly p: Required<Pick<SessionParams, 'snapshot' | 'calibration' | 'q'>> & SessionParams;
  private readonly detect: DetectParams;
  private readonly ctx: DetectorContext;
  private readonly cCell: FamilyCPerCell;
  private readonly commonModeRobust: boolean;
  private readonly epochs: SnapshotEpoch[] | null;
  private readonly hash: string;
  private readonly leaves: Map<PathClassId, LeafState> = new Map();
  private readonly firedResets: LeafReset[] = [];
  /** ADR-0062: the per-leaf Ville threshold (null = alarms off) + first crossings, once each. */
  private readonly eopThr: number | null;
  private readonly eopFired: Map<PathClassId, number> = new Map();
  private t = 0;

  constructor(params: SessionParams) {
    this.p = params;
    this.detect = params.detect ?? DEFAULT_DETECT;
    this.ctx = params.ctx ?? {};
    this.cCell = this.ctx.familyCCell ?? makeFamilyCCell(SIGNALS.length, this.detect.alphaC);
    this.commonModeRobust = params.commonModeRobust ?? false;
    // ADR-0018 L2 applies to THIS entry point too (round-8 cold-eye C3): a fractional at_tick
    // would never match the integer-tick reset lookup and the wealth reset would silently never
    // fire. The `at_tick < ticks` half of the batch validation cannot be checked streaming —
    // recorded narrowing: a boundary beyond the stream simply never activates.
    for (const ev of params.reroutes ?? []) {
      if (!Number.isInteger(ev.at_tick) || ev.at_tick <= 0) {
        throw new RangeError(`reroute at_tick must be a positive integer — got ${ev.at_tick}`);
      }
    }
    validateDriftMonitorParams(params);
    this.eopThr = eopThreshold(params);
    this.epochs = params.reroutes?.length ? makeEpochs(params.snapshot, params.reroutes) : null;
    this.hash = computeFaultDomainHash(params.snapshot);
    const resetsByLeaf = new Map<PathClassId, Map<number, number>>();
    if (this.epochs) {
      for (let e = 1; e < this.epochs.length; e++) {
        for (const pc of changedLeaves(this.epochs[e - 1].snapshot, this.epochs[e].snapshot)) {
          if (!resetsByLeaf.has(pc)) resetsByLeaf.set(pc, new Map());
          resetsByLeaf.get(pc)!.set(this.epochs[e].valid_from_tick, e);
        }
      }
    }
    for (const pc of [...params.snapshot.path_classes].sort()) {
      this.leaves.set(pc, {
        std: freshStreamStandardizer(params.calibration),
        det: freshDetectors(this.ctx),
        residSums: SIGNALS.map(() => 0),
        residSumsqs: SIGNALS.map(() => 0),
        doneRuns: [],
        doneSegs: [],
        segStart: 0,
        segEpoch: 0,
        resets: resetsByLeaf.get(pc) ?? new Map(),
      });
    }
  }

  tick(): number {
    return this.t;
  }

  /** Ingest one tick of RAW signal vectors for every leaf. The tick is validated COMPLETELY
   *  before any state mutates (round-8 cold-eye C2): a thrown ingest leaves the session exactly
   *  as it was — retry with the full tick and no observation is double-counted, no reset
   *  double-fires. */
  ingest(tickByLeaf: ReadonlyMap<PathClassId, SignalVector>): void {
    for (const pc of this.leaves.keys()) {
      if (!tickByLeaf.get(pc)) throw new RangeError(`ingest needs a full tick: missing leaf '${pc}'`);
    }
    // Pass 1: resets + per-cell standardization, collecting this tick's residuals for every leaf.
    const residByLeaf = new Map<PathClassId, number[]>();
    for (const [pc, ls] of this.leaves) {
      const epoch = ls.resets.get(this.t);
      // (a tick-0 reset is unreachable: makeEpochs rejects at_tick ≤ 0, validated above too)
      if (epoch !== undefined) this.resetLeaf(pc, ls, epoch);
      residByLeaf.set(pc, standardizeTick(tickByLeaf.get(pc)!, this.t, pc, this.p.calibration, ls.std));
    }
    // Pass 2 (ADR-0036/0038): strip the robust cross-leaf common-mode for this tick — IDENTICAL to
    // the batch path (sorted leaves, same robustLocation), preserving incremental≡batch byte-equality.
    if (this.commonModeRobust) stripCommonModeTick(residByLeaf);
    // Pass 3: feed each leaf's (stripped) residual to its detectors + the t-statistic sums (ADR-0046).
    for (const [pc, ls] of this.leaves) {
      const resid = residByLeaf.get(pc)!;
      this.updateDetectors(ls.det, resid);
      for (let i = 0; i < SIGNALS.length; i++) {
        ls.residSums[i] += resid[i];
        ls.residSumsqs[i] += resid[i] * resid[i];
      }
      // ADR-0062: the Ville alarm on the tick-valid family mean — (A + C)/2 is a nonnegative
      // supermartingale with E ≤ 1 under H0 (A is a mean of per-signal betting supermartingales,
      // C is the Safe-Hotelling e-process; D is EXCLUDED — window filtration, ADR-0044), so
      // P(a null leaf ever crosses 1/α) ≤ α at ANY time. First crossing only.
      if (this.eopThr !== null && !this.eopFired.has(pc)) {
        const aE = ls.det.aM.reduce((s, x) => s + x, 0) / ls.det.aM.length;
        if ((aE + ls.det.cState.M) / 2 >= this.eopThr) this.eopFired.set(pc, this.t);
      }
    }
    this.t += 1;
  }

  /** A full AuditRecord at the CURRENT tick — valid at any time (the whole point). The audit is
   *  a SNAPSHOT: the resets list is copied and sorted here (round-8 cold-eye C1 — a returned
   *  audit must never mutate under later ingests), and the epoch list is TRIMMED to the epochs
   *  active by NOW (cold-eye L2 — a mid-stream audit must not drain against future routing). */
  audit(): AuditRecord {
    const verdicts = [...this.leaves].map(([pc, ls]) => this.leafVerdict(pc, ls));
    const activeEpochs = this.epochs ? this.epochs.slice(0, epochIndexAt(this.epochs, Math.max(this.t - 1, 0)) + 1) : null;
    const resets = activeEpochs
      ? [...this.firedResets].sort((a, b) => (a.path_class_id < b.path_class_id ? -1 : a.path_class_id > b.path_class_id ? 1 : a.at_tick - b.at_tick))
      : null;
    // Linear t currency (ADR-0046): non-epoch'd sessions only — max_j |Σ resid_j| / √t, the exact
    // batch `leafTStats` value at this tick (same summation order; keystone-bound).
    const magnitudeT = this.epochs || this.t === 0
      ? null
      : new Map([...this.leaves].map(([pc, ls]) => [pc, Math.max(...ls.residSums.map((s) => Math.abs(s))) / Math.sqrt(this.t)]));
    return assembleAudit({
      snapshot: this.p.snapshot,
      snapshot_hash: this.hash,
      q: this.p.q,
      verdicts,
      epochs: activeEpochs,
      resets,
      drain_top_k: this.p.drain_top_k ?? 1,
      magnitudeT,
      ticks: this.t,
      dispersion_gate: this.p.dispersionGate ?? null,
      drift_monitor: this.driftMonitorField(),
      per_leaf_construction: this.p.calibration.leafScale !== undefined,
      eop_alarms: this.eopAlarmsField(),
    });
  }

  /** ADR-0062: the alarm field — stamped whenever alarms are on (even when quiet: monitored-
   *  and-quiet is information), sorted for replay-cleanliness, a SNAPSHOT (copied per audit). */
  private eopAlarmsField(): import('./verdict').AuditEopAlarms | null {
    if (this.eopThr === null || !this.p.eopAlarms) return null;
    return {
      alpha: this.p.eopAlarms.alpha ?? 0.05,
      scope: this.p.eopAlarms.scope ?? 'per-leaf',
      threshold: this.eopThr,
      alarms: [...this.eopFired]
        .map(([path_class_id, at_tick]) => ({ path_class_id, at_tick }))
        .sort((a, b) => (a.path_class_id < b.path_class_id ? -1 : 1)),
    };
  }

  /** ADR-0053: the live-window monitor from the running sums — bit-for-bit the batch value at
   *  the same tick (same per-signal accumulation order, shared formula path, sorted leaves). */
  private driftMonitorField(): ReturnType<typeof driftMonitor> | null {
    if (!this.p.driftMonitor) return null;
    const thr = typeof this.p.driftMonitor === 'object' && this.p.driftMonitor.threshold !== undefined ? this.p.driftMonitor.threshold : DEFAULT_SIGMA_THRESHOLD;
    if (this.t < 3) return degenerateDriftVerdict(thr, this.t, this.leaves.size);
    const logScales = [...this.leaves.keys()]
      .sort()
      .map((pc) => {
        const ls = this.leaves.get(pc)!;
        return logScaleFromSums(ls.residSums, ls.residSumsqs, this.t);
      });
    return driftMonitor(dispersionFromLogScales(logScales, this.t, SIGNALS.length), thr);
  }

  /** ADR-0018 wealth reset at an incidence-change boundary: finalize the segment, fresh states. */
  private resetLeaf(pc: PathClassId, ls: LeafState, epoch: number): void {
    ls.doneRuns.push(this.segmentVerdict(pc, ls.det));
    ls.doneSegs.push({ epoch_index: ls.segEpoch, from_tick: ls.segStart, to_tick: this.t });
    ls.det = freshDetectors(this.ctx);
    ls.segStart = this.t;
    ls.segEpoch = epoch;
    this.firedResets.push({ path_class_id: pc, at_tick: this.t, epoch_index: epoch });
  }

  private updateDetectors(det: DetectorStates, resid: number[]): void {
    for (let i = 0; i < SIGNALS.length; i++) {
      det.aM[i] = updateBettingState(det.aStates[i], resid[i], 0, 1, this.detect.alphaA);
    }
    evaluateSafeHotelling({ cell: this.cCell, alpha: this.detect.alphaC }, [...resid], det.cState);
    if (det.dStates && det.dBufs && this.ctx.familyDCells) {
      const sp = this.ctx.spectral ?? DEFAULT_SPECTRAL;
      for (let i = 0; i < SIGNALS.length; i++) {
        const cell = this.ctx.familyDCells[i];
        if (!cell || !det.dStates[i]) continue;
        det.dBufs[i].push(resid[i]);
        if (det.dBufs[i].length === sp.window) {
          feedSpectralWindow(det.dStates[i]!, det.dBufs[i], cell, sp);
          det.dBufs[i] = [];
        }
      }
    }
  }

  /** The current segment's verdict from live states — replicates detectPathClass's assembly. */
  private segmentVerdict(pc: PathClassId, det: DetectorStates): PathClassVerdict {
    const aE = det.aM.reduce((s, x) => s + x, 0) / det.aM.length;
    const aFired = aE >= 1 / this.detect.alphaA;
    const detectors: DetectorResult[] = [
      { family: 'A', e_value: aE, fired: aFired, alpha_allocated: this.detect.alphaA, alpha_spent: aFired ? this.detect.alphaA : 0 },
      {
        family: 'C',
        e_value: det.cState.M,
        fired: det.cState.M >= 1 / this.detect.alphaC,
        alpha_allocated: this.detect.alphaC,
        alpha_spent: det.cState.alphaConsumed,
      },
    ];
    if (det.dStates && this.ctx.familyDCells) {
      const sp = this.ctx.spectral ?? DEFAULT_SPECTRAL;
      const wealths: number[] = [];
      for (let i = 0; i < SIGNALS.length; i++) if (det.dStates[i]) wealths.push(readSpectralWealth(det.dStates[i]!));
      const e = wealths.length ? wealths.reduce((s, x) => s + x, 0) / wealths.length : 1;
      const fired = wealths.length ? e >= 1 / sp.alphaD : false;
      detectors.push({ family: 'D', e_value: e, fired, alpha_allocated: sp.alphaD, alpha_spent: fired ? sp.alphaD : 0 });
    }
    return {
      path_class_id: pc,
      detectors,
      e_value: detectors.reduce((s, dt) => s + dt.e_value, 0) / detectors.length,
      fired: detectors.some((dt) => dt.fired),
      alpha_spent: detectors.reduce((s, dt) => s + dt.alpha_spent, 0),
    };
  }

  private leafVerdict(pc: PathClassId, ls: LeafState): PathClassVerdict {
    const cur = this.segmentVerdict(pc, ls.det);
    if (ls.doneRuns.length === 0) return cur;
    const runs = [...ls.doneRuns, cur];
    const segs = [...ls.doneSegs, { epoch_index: ls.segEpoch, from_tick: ls.segStart, to_tick: this.t }];
    return combineSegmentRuns(pc, runs, segs);
  }
}

export function openSession(params: SessionParams): IncrementalSession {
  return new IncrementalSession(params);
}
