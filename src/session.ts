/**
 * Incremental session (ADR-0027): the streaming face of the batch pipeline — feed raw ticks as
 * they arrive, query a full AuditRecord at ANY tick. Every statistical component was already
 * anytime-valid (betting e-processes, Safe-Hotelling, the spectral e-detector, e-BH at arbitrary
 * stopping rules); this makes the SYSTEM anytime, not just the math.
 *
 * The binding contract is byte-equality with the batch path: ingesting the batch pipeline's
 * exact live telemetry tick-by-tick must reproduce `runPipeline`'s audit byte-for-byte at the
 * final tick (single-fault, multi-fault, and epoch'd reroute runs — bound in session.test.ts).
 * The audit tail (surface → localization → drains) is literally shared (`assembleAudit`).
 *
 * Recorded narrowings (ADR-0027): calibration is batch (a session opens WITH a substrate built
 * from a clean window — calibrate offline, stream live); `ingest` expects a full tick for all
 * leaves; querying every tick and acting on the first positive is a stopping rule — each query
 * is valid, but the published FDR figure describes a single query.
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
import type { CalibrationSubstrate, StreamStandardizer } from './calibration';
import { DEFAULT_DETECT, combineSegmentRuns } from './detect';
import type { DetectParams, DetectorContext, SegmentSpec } from './detect';
import { makeFamilyCCell } from './family-c';
import { DEFAULT_SPECTRAL, freshSpectralStream, feedSpectralWindow, readSpectralWealth } from './family-d';
import { makeEpochs, changedLeaves } from './epoch';
import type { LeafReset, RerouteEvent, SnapshotEpoch } from './epoch';
import { assembleAudit } from './pipeline';
import { computeFaultDomainHash } from './fault-domain-source';
import { SIGNALS } from './signals';
import type { SignalVector } from './signals';
import type { FaultDomainSnapshot, PathClassId } from './domain';
import type { AuditRecord, DetectorResult, PathClassVerdict } from './verdict';

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

export class IncrementalSession {
  private readonly p: Required<Pick<SessionParams, 'snapshot' | 'calibration' | 'q'>> & SessionParams;
  private readonly detect: DetectParams;
  private readonly ctx: DetectorContext;
  private readonly cCell: FamilyCPerCell;
  private readonly epochs: SnapshotEpoch[] | null;
  private readonly hash: string;
  private readonly leaves: Map<PathClassId, LeafState> = new Map();
  private readonly firedResets: LeafReset[] = [];
  private t = 0;

  constructor(params: SessionParams) {
    this.p = params;
    this.detect = params.detect ?? DEFAULT_DETECT;
    this.ctx = params.ctx ?? {};
    this.cCell = this.ctx.familyCCell ?? makeFamilyCCell(SIGNALS.length, this.detect.alphaC);
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

  /** Ingest one tick of RAW signal vectors for every leaf. */
  ingest(tickByLeaf: ReadonlyMap<PathClassId, SignalVector>): void {
    for (const [pc, ls] of this.leaves) {
      const epoch = ls.resets.get(this.t);
      if (epoch !== undefined && this.t > 0) this.resetLeaf(pc, ls, epoch);
      const raw = tickByLeaf.get(pc);
      if (!raw) throw new RangeError(`ingest needs a full tick: missing leaf '${pc}'`);
      const resid = standardizeTick(raw, this.t, pc, this.p.calibration, ls.std);
      this.updateDetectors(ls.det, resid);
    }
    this.t += 1;
  }

  /** A full AuditRecord at the CURRENT tick — valid at any time (the whole point). */
  audit(): AuditRecord {
    const verdicts = [...this.leaves].map(([pc, ls]) => this.leafVerdict(pc, ls));
    return assembleAudit({
      snapshot: this.p.snapshot,
      snapshot_hash: this.hash,
      q: this.p.q,
      verdicts,
      epochs: this.epochs,
      resets: this.epochs ? this.firedResets : null,
      drain_top_k: this.p.drain_top_k ?? 1,
    });
  }

  /** ADR-0018 wealth reset at an incidence-change boundary: finalize the segment, fresh states. */
  private resetLeaf(pc: PathClassId, ls: LeafState, epoch: number): void {
    ls.doneRuns.push(this.segmentVerdict(pc, ls.det));
    ls.doneSegs.push({ epoch_index: ls.segEpoch, from_tick: ls.segStart, to_tick: this.t });
    ls.det = freshDetectors(this.ctx);
    ls.segStart = this.t;
    ls.segEpoch = epoch;
    this.firedResets.push({ path_class_id: pc, at_tick: this.t, epoch_index: epoch });
    this.firedResets.sort((a, b) => (a.path_class_id < b.path_class_id ? -1 : a.path_class_id > b.path_class_id ? 1 : a.at_tick - b.at_tick));
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
