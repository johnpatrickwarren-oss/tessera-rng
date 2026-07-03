/**
 * Identifiability certificate (ADR-0047) — upgrades the N1 claim ("identifiability of the
 * shared-resource set, nothing stronger") from a prose disclaimer to a COMPUTED artifact.
 *
 * Boolean-tomography identifiability theory (Ma, He, Swami, Towsley et al., IMC'14/ToN'17): two
 * failure hypotheses are distinguishable iff some monitored class separates them. On this
 * system's weighted incidence with the linear member model (ADR-0046), a single-resource
 * hypothesis is a leaf-magnitude PROFILE θ·w⃗ᵣ — so two resources are indistinguishable exactly
 * when their weighted incidence columns are PROPORTIONAL (θ absorbs any scale). The certificate
 * reports, per snapshot:
 *   - `ambiguity_groups`: the proportionality equivalence classes with ≥ 2 members — no scorer
 *     on this measurement design can rank inside one, whatever the telemetry says;
 *   - `fleet_ambiguous`: resources whose column is UNIFORM across every leaf — indistinguishable
 *     from a fleet-wide common-mode event (and from the ADR-0046 virtual fleet candidate);
 *   - `identifiable_count` / `resource_count`: the headline "k=1 identifiability" summary.
 * k ≥ 2 (set-vs-set) identifiability is combinatorial and deliberately out of scope — recorded,
 * not implied (the certificate claims single-fault distinguishability only).
 *
 * Deterministic and paper-scale-cheap: each column is canonicalized to a unit-maximum profile
 * SIGNATURE (weights rounded to 9 decimals — far below any modeled weight difference, e.g.
 * 1/63 vs 2/64 differ in the 3rd decimal) and grouped by exact signature match, O(E log E).
 * Keyed by the snapshot hash wherever published (part of the measurement design, ADR-0015).
 */
import type { FaultDomainSnapshot, ResourceId } from './domain';

export interface IdentifiabilityCertificate {
  /** proportionality classes with ≥ 2 members, each sorted; classes sorted by first member. */
  ambiguity_groups: ReadonlyArray<readonly ResourceId[]>;
  /** resources whose weighted column is uniform over ALL leaves — fleet-event-indistinguishable. */
  fleet_ambiguous: readonly ResourceId[];
  /** resources whose column is unique up to proportionality (singleton class). */
  identifiable_count: number;
  resource_count: number;
}

/** Canonical scale-free profile signature of one resource's weighted incidence column. */
function profileSignature(edges: Array<{ pc: string; w: number }>): string {
  let max = 0;
  for (const e of edges) max = Math.max(max, e.w);
  return edges
    .map((e) => ({ pc: e.pc, u: (e.w / max).toFixed(9) }))
    .sort((a, b) => (a.pc < b.pc ? -1 : 1))
    .map((e) => `${e.pc}:${e.u}`)
    .join('|');
}

/** Uniform full-support column ⇒ indistinguishable from a fleet-wide event. */
function isUniformFullSupport(edges: Array<{ pc: string; w: number }>, nLeaves: number): boolean {
  return edges.length === nLeaves && edges.every((e) => Math.abs(e.w - edges[0].w) < 1e-12);
}

export function identifiabilityCertificate(snapshot: FaultDomainSnapshot): IdentifiabilityCertificate {
  const byResource = new Map<ResourceId, Array<{ pc: string; w: number }>>();
  for (const r of snapshot.resources) byResource.set(r.id, []);
  for (const e of snapshot.edges) byResource.get(e.resource)?.push({ pc: e.path_class, w: e.weight ?? 1 });

  const ids = [...byResource.keys()].sort();
  const bySignature = new Map<string, ResourceId[]>();
  const fleet_ambiguous: ResourceId[] = [];
  const nLeaves = snapshot.path_classes.length;
  let withEdges = 0;
  for (const id of ids) {
    const edges = byResource.get(id)!;
    if (edges.length === 0) continue; // an untraversed resource asserts nothing — not grouped
    withEdges += 1;
    const sig = profileSignature(edges);
    const g = bySignature.get(sig);
    if (g) g.push(id);
    else bySignature.set(sig, [id]);
    if (isUniformFullSupport(edges, nLeaves)) fleet_ambiguous.push(id);
  }

  const ambiguity_groups = [...bySignature.values()]
    .filter((g) => g.length >= 2)
    .map((g) => [...g].sort())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const ambiguous = new Set(ambiguity_groups.flat());
  return {
    ambiguity_groups,
    fleet_ambiguous,
    identifiable_count: withEdges - ambiguous.size,
    resource_count: ids.length,
  };
}

/** The ambiguity group of ONE resource (culprit metadata): its proportionality class EXCLUDING
 *  itself; empty ⇒ the culprit is 1-identifiable on this measurement design. */
export function ambiguityGroupsByResource(snapshot: FaultDomainSnapshot): Map<ResourceId, ResourceId[]> {
  const cert = identifiabilityCertificate(snapshot);
  const out = new Map<ResourceId, ResourceId[]>();
  for (const g of cert.ambiguity_groups) {
    for (const id of g) out.set(id, g.filter((x) => x !== id));
  }
  return out;
}
