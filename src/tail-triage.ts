/**
 * Tail triage (ADR-0058) — the monitor→tomography bridge.
 *
 * When the drift monitor reads `drifted`/`tail` (ADR-0053), the operator action forks on a
 * question the dispersion statistics cannot answer: is the noisy subpopulation a real
 * localized fault (page the resource) or subpopulation calibration drift (recalibrate)?
 * The incidence hypergraph answers it: a fault-driven tail SHARES a resource; a drift-driven
 * tail is incidence-scattered. This module localizes the tail-flagged leaves with the
 * ADR-0046 linear machinery on the scale-deviation currency — a RECORDED REINTERPRETATION
 * (z genuinely accrues as √T for a fixed true scale deviation, so y ~ N(θ·w·√T, 1) scores it
 * soundly as Gaussian evidence, with the virtual fleet candidate competing), a triage
 * heuristic, NOT a calibrated variance-fault model.
 *
 * Standalone by design (ADR-0058 anti-scope): no pipeline threading, no audit field, no
 * drain wiring. Operator flow: monitor says `drifted`/`tail` → run this on the SAME residual
 * map → the verdict carries the culprits and coverage fraction, evidence not just a label.
 */
import { pooledLogScales, samplingFloorVar } from './dispersion-gate';
import { localize, DEFAULT_LOCALIZE, FLEET_RESOURCE_ID } from './tomography';
import type { Culprit } from './verdict';
import type { FaultDomainSnapshot, PathClassId, ResourceId } from './domain';

/**
 * Coverage counts only MATERIAL incidence (edge weight ≥ this) — the ADR-0054 concept, and the
 * ADR-0058 cold-eye CRITICAL: `Culprit.member_path_class_ids` is provenance over ALL firing
 * members, so on a full-support fabric (crossOptic: every tor leaf traverses every optic at
 * 1/(nTors−1)) an unweighted coverage reads 1.0 for a SCATTERED tail — the drift case inverted
 * into a confident fault verdict. Materially-weighted coverage restores the discriminator:
 * scattered leaves are materially incident only on their own resources.
 */
const MATERIAL_WEIGHT = 0.5;

export interface TailTriageOpts {
  /** one-sided membership threshold on z_i = (ℓ_i − median)/√floorVar (default 3 — an
   *  individually-significant scale INFLATION; deflation is not the false-selection direction). */
  zThreshold?: number;
  /** minimum fraction of the tail the top physical culprit must cover to read fault-shaped. */
  minExplained?: number;
}

export interface TailTriageResult {
  /** `indeterminate`: |tail| < 2 — a single drifted leaf and a single-leaf fault are genuinely
   *  indistinguishable by incidence (ADR-0058 cold-eye finding 2); the instrument must not
   *  claim a discrimination it cannot make. */
  verdict: 'fault-shaped' | 'drift-shaped' | 'no-tail' | 'indeterminate';
  /** the tail members (sorted) with their standardized scale deviations. */
  tail: { path_class_id: PathClassId; z: number }[];
  /** the localizer's culprit list over the tail (empty for no-tail). */
  culprits: readonly Culprit[];
  /** fraction of the tail the top physical culprit covers (0 for no-tail / fleet-topped). */
  top_coverage: number;
  z_threshold: number;
  min_explained: number;
}

/**
 * Triage a drifted/tail monitor reading. `residuals` is the SAME standardized live residual
 * map the monitor consumed (leaf → ticks×signals).
 */
export function tailTriage(
  snapshot: FaultDomainSnapshot,
  residuals: ReadonlyMap<PathClassId, ReadonlyArray<readonly number[]>>,
  opts: TailTriageOpts = {},
): TailTriageResult {
  const zThreshold = opts.zThreshold ?? 3;
  const minExplained = opts.minExplained ?? 0.6;
  if (!(zThreshold > 0)) throw new RangeError(`zThreshold must be > 0 — got ${zThreshold}`);
  if (!(minExplained > 0 && minExplained <= 1)) throw new RangeError(`minExplained must be in (0, 1] — got ${minExplained}`);

  // per-leaf pooled log-scales (the ADR-0051 statistic — the estimator's own shared helper).
  const { ells, ticks, signals } = pooledLogScales(residuals);
  const sorted = [...ells.values()].sort((a, b) => a - b);
  const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const se = Math.sqrt(samplingFloorVar(ticks, signals));

  const tail = [...ells]
    .map(([pc, l]) => ({ path_class_id: pc, z: (l - med) / se }))
    .filter((t) => t.z > zThreshold)
    .sort((a, b) => (a.path_class_id < b.path_class_id ? -1 : 1));
  const empty = { tail, culprits: [] as Culprit[], top_coverage: 0, z_threshold: zThreshold, min_explained: minExplained };
  if (tail.length === 0) return { verdict: 'no-tail', ...empty };
  if (tail.length < 2) return { verdict: 'indeterminate', ...empty };

  // Localize the tail on the scale-deviation currency (the recorded reinterpretation): y = z_i,
  // magnitudeTicks = T (z accrues as √T), fleet candidate competing. (The magnitudeT path is
  // parameter-free — DEFAULT_LOCALIZE's q0 only satisfies entry validation.)
  const tailIds = tail.map((t) => t.path_class_id);
  const loc = localize(snapshot, tailIds, {
    ...DEFAULT_LOCALIZE,
    magnitudeT: new Map(tail.map((t) => [t.path_class_id, t.z])),
    magnitudeTicks: ticks,
  });

  const top = loc.culprits[0];
  const topCoverage = top && top.resource_id !== FLEET_RESOURCE_ID ? materialCoverage(snapshot, top.resource_id, tailIds) : 0;
  return {
    verdict: topCoverage >= minExplained ? 'fault-shaped' : 'drift-shaped',
    ...empty,
    culprits: loc.culprits,
    top_coverage: topCoverage,
  };
}

/** Fraction of the tail MATERIALLY incident (w ≥ MATERIAL_WEIGHT) on the resource — the
 *  weight-aware coverage that survives full-support fabrics (see MATERIAL_WEIGHT). */
function materialCoverage(snapshot: FaultDomainSnapshot, resource: ResourceId, tail: readonly PathClassId[]): number {
  const material = new Set<PathClassId>();
  for (const e of snapshot.edges) if (e.resource === resource && (e.weight ?? 1) >= MATERIAL_WEIGHT) material.add(e.path_class);
  return tail.filter((pc) => material.has(pc)).length / tail.length;
}
