/**
 * FaultDomainSource — mirrors the engine's TopologySource *shape* (ADR-0002):
 *   { id, version, fetchSnapshot(): Promise<FaultDomainSnapshot>, snapshotHash(s): string }
 * but over RNG-native fault-domain types instead of the engine's closed TopologySnapshot.
 *
 * The hash REUSES the engine's public pureJsSha256 (declared cross-platform-parity export),
 * so determinism matches the engine exactly — without forking or importing engine internals.
 */
import { pureJsSha256 } from '@johnpatrickwarren-oss/deploysignal-engine/topology-overlay';
import type { FaultDomainSnapshot } from './domain';

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
  const canonical = JSON.stringify({
    source_id: snapshot.source_id,
    source_version: snapshot.source_version,
    nodes: nodes.map((n) => [n.id, n.kind]),
    edges: edges.map((e) => [e.path_class, e.resource]),
  });
  return pureJsSha256(canonical);
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
