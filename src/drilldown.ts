/**
 * ToR-pair drill-down (ADR-0026): the on-demand second stage from a localized fault domain to
 * the impacted underlying ToR-pairs — the entity ADR-0015's aggregation views deliberately do
 * not monitor continuously (the production fabric's ~460K pairs are why the leaf is a view).
 *
 * Operator-initiated and SEPARATE from runPipeline/the audit: the fleet pipeline stays
 * view-level. The drill examines only the pairs exposed to the queried resource (bounded by
 * `maxPairs`, truncation ALWAYS reported), generates a synthetic per-pair standardized-residual
 * window (production would standardize from pair-level calibration — recorded in the ADR), and
 * reuses the existing detectors + e-BH so FDR is controlled over the EXAMINED pairs.
 *
 * Claim strength (N1): triage conditioned on a fleet-level selection — every report carries
 * `correlational_not_causal`; pair evidence is correlational impact, never hardware blame.
 */
import { makeRng } from './rng';
import { SIGNALS, signalIndex } from './signals';
import { detectPathClass, DEFAULT_DETECT } from './detect';
import type { DetectParams } from './detect';
import { buildSurface } from './surface';
import type { SpraypointParams } from './spraypoint';
import type { PathClassVerdict } from './verdict';
import type { ResourceId } from './domain';

/** A ground-truth mean-shift fault driving the synthetic drill window (mode narrowing: ADR-0026). */
export interface DrillFault {
  resource_id: ResourceId;
  delta: number;
}

export interface ExposedPair {
  /** canonical id `pair-i-j`, i < j. */
  pair: string;
  /** fraction of the pair's traffic crossing the drilled resource (the ADR-0015 spray model). */
  exposure: number;
}

export interface DrillDownOpts {
  params: SpraypointParams;
  /** the culprit resource being drilled. */
  resource: ResourceId;
  /** ground-truth faults active in the window (the synthetic harness's injection side). */
  faults: readonly DrillFault[];
  telemetry: { seed: number; ticks: number };
  /** e-BH FDR target WITHIN the drill (over the examined pairs). */
  q: number;
  /** examined-set cap; the truncation is reported, never silent. */
  maxPairs?: number;
  detect?: DetectParams;
}

export interface DrillDownReport {
  resource: ResourceId;
  /** pairs whose traffic crosses the resource (the model-derived population). */
  exposed: number;
  /** pairs actually examined (≤ maxPairs, deterministic id-order sample). */
  examined: number;
  truncated: boolean;
  q: number;
  /** e-BH-selected impacted pairs, strongest evidence first. */
  selected: { pair: string; e_value: number }[];
  /** N1: per-pair evidence is correlational impact, never hardware blame. */
  correlational_not_causal: true;
}

const pairId = (i: number, j: number): string => (i < j ? `pair-${i}-${j}` : `pair-${j}-${i}`);
const roomPanels = (room: number, params: SpraypointParams): number => {
  let n = 0;
  for (let p = 0; p < params.nPanels; p++) if (p % params.nRooms === room) n += 1;
  return n;
};

/**
 * The ToR-pairs exposed to a resource, with FLOW-level exposure fractions under the drill's
 * one-panel-per-flow, both-endpoint-optics traffic model (ADR-0026): optic-k → the nTors−1
 * pairs with endpoint k at exposure 1; panel-p → every pair at 1/nPanels; room-r → every pair
 * at (panels in r)/nPanels. NOTE: this is NOT derivable from the fabric's leaf-local view
 * weights — the recorded 2× convention divergences and the queued unification decision live in
 * ADR-0026. Sorted by pair id (LEXICOGRAPHIC — deterministic; string order, not numeric).
 */
export function exposedPairs(params: SpraypointParams, resource: ResourceId): ExposedPair[] {
  const out: ExposedPair[] = [];
  const optic = /^optic-(\d+)$/.exec(resource);
  const panel = /^panel-(\d+)$/.exec(resource);
  const room = /^room-(\d+)$/.exec(resource);
  if (optic) {
    const k = Number(optic[1]);
    for (let t = 0; t < params.nTors; t++) if (t !== k) out.push({ pair: pairId(k, t), exposure: 1 });
  } else if (panel) {
    for (let i = 0; i < params.nTors; i++) for (let j = i + 1; j < params.nTors; j++) out.push({ pair: pairId(i, j), exposure: 1 / params.nPanels });
  } else if (room) {
    const w = roomPanels(Number(room[1]), params) / params.nPanels;
    for (let i = 0; i < params.nTors; i++) for (let j = i + 1; j < params.nTors; j++) out.push({ pair: pairId(i, j), exposure: w });
  } else {
    throw new RangeError(`drill-down has no pair-exposure model for '${resource}'`);
  }
  return out.sort((a, b) => (a.pair < b.pair ? -1 : a.pair > b.pair ? 1 : 0));
}

/** A pair's total p99 residual shift from the active ground-truth faults: Σ delta·exposure —
 *  ADDITIVE across faults (both endpoint optics faulted ⇒ the joint pair shifts twice). */
function pairShift(pair: string, params: SpraypointParams, faults: readonly DrillFault[], cache: Map<ResourceId, Map<string, number>>): number {
  let shift = 0;
  for (const f of faults) {
    if (!cache.has(f.resource_id)) {
      cache.set(f.resource_id, new Map(exposedPairs(params, f.resource_id).map((e) => [e.pair, e.exposure])));
    }
    shift += f.delta * (cache.get(f.resource_id)!.get(pair) ?? 0);
  }
  return shift;
}

/**
 * Drill a localized culprit down to its impacted ToR-pairs. The examined set is the
 * deterministic id-order head of the exposed set (no per-pair prior exists before examining —
 * recorded); detection reuses the fleet detectors + e-BH at the drill's own q.
 */
export function drillDown(opts: DrillDownOpts): DrillDownReport {
  const maxPairs = opts.maxPairs ?? 256;
  const exposed = exposedPairs(opts.params, opts.resource);
  const examined = exposed.slice(0, maxPairs);
  const rng = makeRng(opts.telemetry.seed);
  const p99 = signalIndex('p99_latency');
  const cache = new Map<ResourceId, Map<string, number>>();

  const verdicts: PathClassVerdict[] = [];
  for (const e of examined) {
    const shift = pairShift(e.pair, opts.params, opts.faults, cache);
    const series: number[][] = [];
    for (let t = 0; t < opts.telemetry.ticks; t++) {
      const vec = SIGNALS.map(() => rng.gaussian());
      vec[p99] += shift;
      series.push(vec);
    }
    verdicts.push(detectPathClass(e.pair, series, opts.detect ?? DEFAULT_DETECT));
  }

  const surface = buildSurface(verdicts, opts.q);
  const byId = new Map(verdicts.map((v) => [v.path_class_id, v.e_value]));
  const selected = [...surface.selected_path_class_ids]
    .map((pair) => ({ pair, e_value: byId.get(pair)! }))
    .sort((a, b) => b.e_value - a.e_value || (a.pair < b.pair ? -1 : a.pair > b.pair ? 1 : 0));

  return {
    resource: opts.resource,
    exposed: exposed.length,
    examined: examined.length,
    truncated: examined.length < exposed.length,
    q: opts.q,
    selected,
    correlational_not_causal: true,
  };
}
