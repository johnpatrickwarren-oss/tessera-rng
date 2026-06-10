/**
 * Epoch'd incidence snapshots + synthetic reroute events (ADR-0017; work-order item 4).
 *
 * Spraypoint is link-state and reconverges: the incidence model changes mid-stream. An epoch is
 * one incidence regime — a snapshot plus the tick it became valid, hashed so the full measurement
 * design (edges, weights, AND the ADR-0015 view definitions) is versioned per epoch. Epochs are
 * driven by SYNTHETIC events only (N2: no live fetchSnapshot/poller — that stays anti-scope).
 *
 * The reroute event models a drain/reconvergence: at `at_tick` a deterministic `fraction` of the
 * path-classes traversing `resource_id` remap off it onto same-kind alternates. The remap draw is
 * seeded (src/rng.ts) — replay-clean (AC-9). The atomic-at-one-tick switch is an honest
 * simplification (real reconvergence has a transient); recorded in ADR-0017, not hidden.
 */
import { makeRng } from './rng';
import { computeFaultDomainHash } from './fault-domain-source';
import type { SegmentSpec } from './detect';
import type { FaultDomainSnapshot, FaultDomainEdge, PathClassId, ResourceId } from './domain';

export interface SnapshotEpoch {
  snapshot: FaultDomainSnapshot;
  /** first tick this incidence regime is active (epoch 0 must start at tick 0). */
  valid_from_tick: number;
  /** computeFaultDomainHash(snapshot) — the epoch's replay identity, views included. */
  hash: string;
}

export interface RerouteEvent {
  /** tick at which the reconvergence lands (the new epoch's valid_from_tick). */
  at_tick: number;
  /** the resource traffic is rerouted AWAY from (the drained/failed one). */
  resource_id: ResourceId;
  /** fraction of the traversing path-classes that remap: floor(fraction·|candidates|) of them. */
  fraction: number;
  /** seed for the without-replacement remap draw (deterministic, AC-9). */
  seed: number;
}

/** Seeded without-replacement draw of k items from a sorted pool (partial Fisher–Yates). */
function drawWithoutReplacement<T>(pool: T[], k: number, seed: number): T[] {
  const rng = makeRng(seed);
  const a = [...pool];
  for (let i = 0; i < k; i++) {
    const j = i + rng.int(a.length - i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

/** The (resource → weight) incidence of one path-class, for edge-set comparison and rewriting. */
function incidenceOf(snapshot: FaultDomainSnapshot, pc: PathClassId): Map<ResourceId, number> {
  const m = new Map<ResourceId, number>();
  for (const e of snapshot.edges) if (e.path_class === pc) m.set(e.resource, e.weight ?? 1);
  return m;
}

/** Rewrite one remapped path-class's edges: drop the drained resource, merge its weight onto the alternate. */
function rerouteEdges(edges: readonly FaultDomainEdge[], pc: PathClassId, from: ResourceId, to: ResourceId): FaultDomainEdge[] {
  const moved = edges.find((e) => e.path_class === pc && e.resource === from);
  const w = moved?.weight ?? 1;
  const out: FaultDomainEdge[] = [];
  let merged = false;
  for (const e of edges) {
    if (e.path_class === pc && e.resource === from) continue; // dropped
    if (e.path_class === pc && e.resource === to) {
      // a leaf cannot route more than all of its traffic through one resource — cap at 1.
      out.push({ ...e, weight: Math.min(1, (e.weight ?? 1) + w) });
      merged = true;
    } else {
      out.push(e);
    }
  }
  if (!merged) out.push({ path_class: pc, resource: to, relationship: 'traverses', ...(w !== 1 ? { weight: w } : {}) });
  return out;
}

/**
 * Apply a synthetic reroute event: pure, seeded, deterministic. Throws if the drained resource has
 * no same-kind alternate (the event would be physically impossible). Path-classes, resources, and
 * views carry over verbatim; source_version gains a deterministic suffix.
 */
export function applyRerouteEvent(snapshot: FaultDomainSnapshot, ev: RerouteEvent): FaultDomainSnapshot {
  if (!(ev.fraction >= 0 && ev.fraction <= 1)) throw new RangeError('reroute fraction must be in [0, 1]');
  const kind = snapshot.resources.find((r) => r.id === ev.resource_id)?.kind;
  if (!kind) throw new RangeError(`reroute resource '${ev.resource_id}' is not in the snapshot`);
  const alternates = snapshot.resources.filter((r) => r.kind === kind && r.id !== ev.resource_id).map((r) => r.id).sort();
  if (alternates.length === 0) throw new RangeError(`no same-kind alternate for '${ev.resource_id}' — reroute impossible`);

  const candidates = [...new Set(snapshot.edges.filter((e) => e.resource === ev.resource_id).map((e) => e.path_class))].sort();
  const remapped = drawWithoutReplacement(candidates, Math.floor(ev.fraction * candidates.length), ev.seed).sort();

  const rng = makeRng(ev.seed ^ 0x5eed);
  let edges: readonly FaultDomainEdge[] = snapshot.edges;
  for (const pc of remapped) edges = rerouteEdges(edges, pc, ev.resource_id, alternates[rng.int(alternates.length)]);

  return {
    ...snapshot,
    edges: [...edges],
    source_version: `${snapshot.source_version}+reroute(${ev.resource_id},${ev.fraction},${ev.seed})@${ev.at_tick}`,
  };
}

/** Fold reroute events into a validated epoch sequence (epoch 0 = the initial snapshot at tick 0). */
export function makeEpochs(initial: FaultDomainSnapshot, events: readonly RerouteEvent[]): SnapshotEpoch[] {
  const epochs: SnapshotEpoch[] = [{ snapshot: initial, valid_from_tick: 0, hash: computeFaultDomainHash(initial) }];
  let prevTick = 0;
  let current = initial;
  for (const ev of events) {
    if (!(ev.at_tick > prevTick)) throw new RangeError(`epoch valid_from_tick must be strictly increasing (got ${ev.at_tick} after ${prevTick})`);
    current = applyRerouteEvent(current, ev);
    epochs.push({ snapshot: current, valid_from_tick: ev.at_tick, hash: computeFaultDomainHash(current) });
    prevTick = ev.at_tick;
  }
  return epochs;
}

/** The active epoch index at a tick (a tick exactly at valid_from_tick belongs to the NEW epoch). */
export function epochIndexAt(epochs: readonly SnapshotEpoch[], tick: number): number {
  let idx = 0;
  for (let i = 1; i < epochs.length; i++) if (tick >= epochs[i].valid_from_tick) idx = i;
  return idx;
}

/** Path-classes whose (resource, weight) edge-set differs between two snapshots (ADR-0018's reset boundary). */
export function changedLeaves(a: FaultDomainSnapshot, b: FaultDomainSnapshot): Set<PathClassId> {
  const changed = new Set<PathClassId>();
  for (const pc of a.path_classes) {
    const ia = incidenceOf(a, pc);
    const ib = incidenceOf(b, pc);
    if (ia.size !== ib.size) { changed.add(pc); continue; }
    for (const [r, w] of ia) if (ib.get(r) !== w) { changed.add(pc); break; }
  }
  return changed;
}

/** One recorded e-process wealth reset (ADR-0018): leaf × the tick its incidence changed. */
export interface LeafReset {
  path_class_id: PathClassId;
  at_tick: number;
  epoch_index: number;
}

/**
 * The ADR-0018 segmentation plan: for each leaf whose incidence changed INSIDE the live window,
 * the e-process segments (each restarted with fresh wealth — the deliberate, recorded power
 * loss), plus the flat reset list the audit records. A segment's epoch_index is the epoch at the
 * segment's start; epochs that do not change a leaf do not reset it (its e-process validly spans
 * them, and its own incidence is identical across them).
 */
export function segmentPlan(
  epochs: readonly SnapshotEpoch[],
  ticks: number,
): { plan: Map<PathClassId, SegmentSpec[]>; resets: LeafReset[] } {
  const byLeaf = new Map<PathClassId, { at_tick: number; epoch_index: number }[]>();
  for (let e = 1; e < epochs.length; e++) {
    const t = epochs[e].valid_from_tick;
    if (t <= 0 || t >= ticks) continue; // a boundary outside the live window resets nothing
    for (const pc of changedLeaves(epochs[e - 1].snapshot, epochs[e].snapshot)) {
      if (!byLeaf.has(pc)) byLeaf.set(pc, []);
      byLeaf.get(pc)!.push({ at_tick: t, epoch_index: e });
    }
  }
  const plan = new Map<PathClassId, SegmentSpec[]>();
  const resets: LeafReset[] = [];
  for (const pc of [...byLeaf.keys()].sort()) {
    const segs: SegmentSpec[] = [];
    let from = 0;
    let epoch = 0;
    for (const r of byLeaf.get(pc)!) {
      segs.push({ epoch_index: epoch, from_tick: from, to_tick: r.at_tick });
      from = r.at_tick;
      epoch = r.epoch_index;
      resets.push({ path_class_id: pc, at_tick: r.at_tick, epoch_index: r.epoch_index });
    }
    segs.push({ epoch_index: epoch, from_tick: from, to_tick: ticks });
    plan.set(pc, segs);
  }
  return { plan, resets };
}
