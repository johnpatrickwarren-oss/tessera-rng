/**
 * FaultDomainSource — mirrors the engine's TopologySource *shape* (ADR-0002):
 *   { id, version, fetchSnapshot(): Promise<FaultDomainSnapshot>, snapshotHash(s): string }
 * but over RNG-native fault-domain types instead of the engine's closed TopologySnapshot.
 *
 * The hash REUSES the engine's public pureJsSha256 (declared cross-platform-parity export),
 * so determinism matches the engine exactly — without forking or importing engine internals.
 */
import { pureJsSha256 } from '@johnpatrickwarren-oss/deploysignal-engine/topology-overlay';
import { isResourceKind } from './domain';
import type { FaultDomainSnapshot, FaultDomainEdge, FaultDomainNode, ResourceKind } from './domain';

export interface FetchContext {
  signal?: AbortSignal;
}

export interface FaultDomainSource {
  readonly id: string;
  readonly version: string;
  fetchSnapshot(ctx?: FetchContext): Promise<FaultDomainSnapshot>;
  snapshotHash(snapshot: FaultDomainSnapshot): string;
}

/** Canonical, sort-stable serialization → SHA-256. Same incidence map ⇒ same hash. */
export function computeFaultDomainHash(snapshot: FaultDomainSnapshot): string {
  const nodes = [...snapshot.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const edges = [...snapshot.edges].sort((a, b) => {
    if (a.path_class !== b.path_class) return a.path_class < b.path_class ? -1 : 1;
    if (a.resource !== b.resource) return a.resource < b.resource ? -1 : 1;
    return 0;
  });
  // aggregation views are part of the measurement design (ADR-0015) ⇒ part of replay; canonicalize.
  const views = snapshot.views
    ? [...snapshot.views].sort((a, b) => (a.view < b.view ? -1 : a.view > b.view ? 1 : 0)).map((v) => [v.view, [...v.leaf_ids].sort()])
    : null;
  const canonical = JSON.stringify({
    source_id: snapshot.source_id,
    source_version: snapshot.source_version,
    nodes: nodes.map((n) => [n.id, n.kind]),
    // weight is part of the measurement design (ADR-0014) ⇒ part of the replay identity; absent ⇒ 1.
    edges: edges.map((e) => [e.path_class, e.resource, e.weight ?? 1]),
    views,
  });
  return pureJsSha256(canonical);
}

// ── Operator-supplied incidence validation (ADR-0005) ───────────────────────────
// Pure validation only — NO filesystem/network here (anti-scope N2). The tools/ loader
// reads + parses the file and hands the parsed object to this validator.

function asResources(x: unknown): Array<{ id: string; kind: ResourceKind }> {
  if (!Array.isArray(x)) throw new TypeError('resources must be an array');
  return x.map((r, i) => {
    const o = r as Record<string, unknown>;
    if (typeof o?.id !== 'string') throw new TypeError(`resources[${i}].id must be a string`);
    if (typeof o?.kind !== 'string' || !isResourceKind(o.kind)) throw new TypeError(`resources[${i}].kind '${String(o?.kind)}' is not a valid RNG resource kind`);
    return { id: o.id, kind: o.kind };
  });
}

function asEdges(x: unknown, pcs: ReadonlySet<string>, resIds: ReadonlySet<string>): FaultDomainEdge[] {
  if (!Array.isArray(x)) throw new TypeError('edges must be an array');
  return x.map((e, i) => {
    const o = e as Record<string, unknown>;
    if (o?.relationship !== 'traverses') throw new TypeError(`edges[${i}].relationship must be 'traverses'`);
    if (typeof o.path_class !== 'string' || !pcs.has(o.path_class)) throw new TypeError(`edges[${i}].path_class '${String(o.path_class)}' is not a declared path_class`);
    if (typeof o.resource !== 'string' || !resIds.has(o.resource)) throw new TypeError(`edges[${i}].resource '${String(o.resource)}' is not a declared resource`);
    // optional fractional weight ∈ (0, 1] (ADR-0014); absent ⇒ full traversal.
    let weight: number | undefined;
    if (o.weight !== undefined) {
      if (typeof o.weight !== 'number' || !(o.weight > 0) || o.weight > 1) throw new TypeError(`edges[${i}].weight must be a number in (0, 1]`);
      weight = o.weight;
    }
    return { path_class: o.path_class, resource: o.resource, relationship: 'traverses', ...(weight !== undefined ? { weight } : {}) };
  });
}

/**
 * Validate an operator-supplied incidence object into a FaultDomainSnapshot. Checks the resource
 * taxonomy, the 'traverses' relationship, and referential integrity (every edge references a
 * declared path-class and resource). `nodes` are reconstructed; `fetched_at_ts`/source fields
 * default deterministically. Throws a descriptive error on any malformed input.
 */
export function validateFaultDomainSnapshot(obj: unknown): FaultDomainSnapshot {
  if (typeof obj !== 'object' || obj === null) throw new TypeError('snapshot must be an object');
  const o = obj as Record<string, unknown>;
  if (!Array.isArray(o.path_classes) || !o.path_classes.every((p) => typeof p === 'string')) {
    throw new TypeError('path_classes must be a string[]');
  }
  const path_classes = o.path_classes as string[];
  const resources = asResources(o.resources);
  const edges = asEdges(o.edges, new Set(path_classes), new Set(resources.map((r) => r.id)));
  const nodes: FaultDomainNode[] = [
    ...path_classes.map((id) => ({ id, kind: 'path_class' as const })),
    ...resources.map((r) => ({ id: r.id, kind: r.kind })),
  ];
  return {
    nodes,
    edges,
    path_classes,
    resources,
    fetched_at_ts: typeof o.fetched_at_ts === 'number' ? o.fetched_at_ts : 0,
    source_id: typeof o.source_id === 'string' ? o.source_id : 'operator-supplied',
    source_version: typeof o.source_version === 'string' ? o.source_version : 'v1',
  };
}

export class StaticFaultDomainSource implements FaultDomainSource {
  readonly id: string;
  readonly version: string;
  private readonly snapshot: FaultDomainSnapshot;

  constructor(snapshot: FaultDomainSnapshot, opts?: { id?: string; version?: string }) {
    this.snapshot = snapshot;
    this.id = opts?.id ?? snapshot.source_id;
    this.version = opts?.version ?? snapshot.source_version;
  }

  async fetchSnapshot(_ctx?: FetchContext): Promise<FaultDomainSnapshot> {
    return this.snapshot;
  }

  snapshotHash(snapshot: FaultDomainSnapshot): string {
    return computeFaultDomainHash(snapshot);
  }
}
