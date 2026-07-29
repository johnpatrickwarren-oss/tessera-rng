/**
 * Resource-directed matched-filter e-processes — the sub-floor escalation tier (ADR-0064,
 * discharging ADR-0049 §2's recorded build conditions).
 *
 * Per resource, the w-weighted aggregate of member-leaf residuals gains ≈ √m in SNR over any
 * single leaf — broad faults below the leaf-layer floor (a room at Δ = 0.5) surface here.
 * The two hazards the ADR-0049 probe recorded are structural in this implementation:
 *
 *  1. THE NULL IS CALIBRATED: the aggregate's (mean, sd) come from the clean calibration
 *     window's own aggregates — pricing cross-leaf dependence — never assumed unit-variance
 *     (the probe's error). The e-process is a tick-filtration supermartingale UNDER THAT
 *     CALIBRATED NULL, with the ADR-0062-class conditionality (dispersion/drift voids it;
 *     the gate/monitor preconditions apply).
 *  2. THE CLAIM IS A NEIGHBORHOOD, NOT A RESOURCE: a firing aggregate says "this overlapping
 *     neighborhood shifted — run the evidence-ordered drill", naming the OVERLAP UNION
 *     (resources sharing material member weight, w ≥ 0.5) plus the ADR-0047 ambiguity group.
 *     There is deliberately NO selection surface here (no FDR claim, no license interaction —
 *     ADR-0060 untouched); α is per-resource and the fleet-wise budget ≈ R·α is disclosed in
 *     the output.
 *
 * Standalone (the ADR-0058 precedent): pure functions, no pipeline/audit threading.
 */
import { freshBettingState, updateBettingState } from '@johnpatrickwarren-oss/deploysignal-engine/detectors/betting-e-process';
import { ambiguityGroupsByResource } from './identifiability';
import type { FaultDomainSnapshot, PathClassId, ResourceId } from './domain';

/** Material-overlap threshold for the neighborhood union (the ADR-0054/0058 concept). */
const MATERIAL_WEIGHT = 0.5;

export interface EscalationOpts {
  /** per-resource level (default 0.05). The fleet-wise false-escalation budget is ≈ R·α —
   *  DISCLOSED in the result, not corrected (the tier is early warning, not selection). */
  alpha?: number;
}

export interface EscalationEntry {
  resource_id: ResourceId;
  /** per-signal-mean betting e-value over the CALIBRATED aggregate null. */
  e_value: number;
  fired: boolean;
  /**
   * The claim granularity: the resources this firing cannot be distinguished from at the
   * aggregate level — the material-overlap union (shared members at w ≥ 0.5) plus the
   * ADR-0047 ambiguity group. A fired entry recommends the drill over THIS set, never names
   * a bare resource.
   */
  neighborhood: readonly ResourceId[];
}

export interface EscalationTier {
  alpha: number;
  threshold: number;
  /** R·α — the disclosed fleet-wise false-escalation budget at this α. */
  fleet_budget: number;
  entries: readonly EscalationEntry[];
  /** the fired subset, e-value descending — the drill recommendation order. */
  escalations: readonly EscalationEntry[];
}

/** Per-resource member weights (materiality-agnostic — the aggregate uses ALL weights;
 *  materiality applies to the NEIGHBORHOOD claim, not the statistic). */
function memberWeights(snapshot: FaultDomainSnapshot): Map<ResourceId, Map<PathClassId, number>> {
  const m = new Map<ResourceId, Map<PathClassId, number>>();
  for (const e of snapshot.edges) {
    if (!m.has(e.resource)) m.set(e.resource, new Map());
    m.get(e.resource)!.set(e.path_class, e.weight ?? 1);
  }
  return m;
}

/** The w-weighted per-signal aggregate series of one resource over a residual map. */
function aggregate(members: ReadonlyMap<PathClassId, number>, residuals: ReadonlyMap<PathClassId, ReadonlyArray<readonly number[]>>, ticks: number, signals: number): number[][] {
  const y: number[][] = Array.from({ length: ticks }, () => new Array<number>(signals).fill(0));
  for (const [pc, w] of members) {
    const m = residuals.get(pc);
    if (!m) continue;
    for (let t = 0; t < ticks; t++) for (let j = 0; j < signals; j++) y[t][j] += w * m[t][j];
  }
  return y;
}

/** The material-overlap ∪ ambiguity neighborhood of each resource (sorted, self first). */
export function neighborhoods(snapshot: FaultDomainSnapshot): Map<ResourceId, ResourceId[]> {
  const members = memberWeights(snapshot);
  const ambiguity = ambiguityGroupsByResource(snapshot);
  const out = new Map<ResourceId, ResourceId[]>();
  for (const [r, mw] of members) {
    const material = new Set([...mw].filter(([, w]) => w >= MATERIAL_WEIGHT).map(([pc]) => pc));
    const overlap = new Set<ResourceId>([r]);
    for (const [other, ow] of members) {
      if (other === r) continue;
      for (const [pc, w] of ow) if (w >= MATERIAL_WEIGHT && material.has(pc)) { overlap.add(other); break; }
    }
    for (const a of ambiguity.get(r) ?? []) overlap.add(a);
    out.set(r, [...overlap].sort((a, b) => (a === r ? -1 : b === r ? 1 : a < b ? -1 : 1)));
  }
  return out;
}

/**
 * The escalation tier: calibrate each resource's aggregate null from the CLEAN calibration
 * residuals, run the live aggregates through per-signal betting e-processes against that
 * null, and report fired neighborhoods in drill-recommendation order.
 */
export function escalationTier(
  snapshot: FaultDomainSnapshot,
  calibResiduals: ReadonlyMap<PathClassId, ReadonlyArray<readonly number[]>>,
  liveResiduals: ReadonlyMap<PathClassId, ReadonlyArray<readonly number[]>>,
  opts: EscalationOpts = {},
): EscalationTier {
  const alpha = opts.alpha ?? 0.05;
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`escalationTier alpha must be in (0, 1) — got ${alpha}`);
  const anyCal = calibResiduals.values().next().value as number[][] | undefined;
  const anyLive = liveResiduals.values().next().value as number[][] | undefined;
  if (!anyCal || !anyLive) throw new RangeError('escalationTier needs non-empty calibration and live residual maps');
  const calT = anyCal.length;
  const liveT = anyLive.length;
  const p = anyCal[0].length;
  const members = memberWeights(snapshot);
  const hoods = neighborhoods(snapshot);
  const threshold = 1 / alpha;

  const entries: EscalationEntry[] = [];
  for (const r of [...members.keys()].sort()) {
    const mw = members.get(r)!;
    // the CALIBRATED null: per-signal (mean, sd) of the clean window's own aggregates —
    // cross-leaf dependence is priced here, never assumed away (ADR-0049's recorded error).
    const cal = aggregate(mw, calibResiduals, calT, p);
    const mean = new Array<number>(p).fill(0);
    const sd = new Array<number>(p).fill(0);
    for (let j = 0; j < p; j++) {
      let s = 0;
      for (let t = 0; t < calT; t++) s += cal[t][j];
      mean[j] = s / calT;
      let sq = 0;
      for (let t = 0; t < calT; t++) sq += (cal[t][j] - mean[j]) ** 2;
      sd[j] = Math.sqrt(Math.max(sq / (calT - 1), 1e-12));
    }
    const live = aggregate(mw, liveResiduals, liveT, p);
    const states = Array.from({ length: p }, () => freshBettingState());
    const M = new Array<number>(p).fill(1);
    for (let t = 0; t < liveT; t++) {
      for (let j = 0; j < p; j++) M[j] = updateBettingState(states[j], (live[t][j] - mean[j]) / sd[j], 0, 1, alpha);
    }
    const e = M.reduce((s, x) => s + x, 0) / p;
    entries.push({ resource_id: r, e_value: e, fired: e >= threshold, neighborhood: hoods.get(r)! });
  }
  return {
    alpha,
    threshold,
    fleet_budget: entries.length * alpha,
    entries,
    escalations: entries.filter((x) => x.fired).sort((a, b) => b.e_value - a.e_value),
  };
}
