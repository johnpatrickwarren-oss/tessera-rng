# ADR 0002 — FaultDomainSource mirrors the TopologySource *shape*, with RNG-native types

- **Status:** Accepted (ratified 2026-06-08 — Q1 answered "mirror the shape, RNG-native types")
- **Date:** 2026-06-08
- **Decision owner:** Tessera-RNG (archgate single-agent build)
- **Supersedes:** —

---

## Context

The kickoff prescribes: *"Reuse the TopologySource interface shape (nodes + edges +
fetchSnapshot + deterministic computeSnapshotHash) to carry [the fault-domain incidence
hypergraph] — the relationship edge field types `traverses-optic` vs `traverses-bundle`,
etc."* It also forbids re-vendoring or forking the engine internals.

**Verified contradiction** (grepped from the installed engine, not assumed):

```
deploysignal-engine/types/verdict.ts:254
  kind: 'service'|'database'|'queue'|'external'|'gpu_shard'|'rack'|'psu'
        |'cooling_zone'|'trainium_chip'|'inferentia_chip'|'tpu_shard';
deploysignal-engine/types/verdict.ts:264
  relationship: 'calls'|'reads'|'writes'|'publishes'|'contains'
                |'nvlink_peer'|'neuron_link_peer'|'tpu_ici_peer';
```

`TopologyNode.kind` and `TopologyEdge.relationship` are **closed string-literal unions**.
They contain none of the RNG fault-domain kinds (`optic`, `passive-shuffler`,
`fiber-bundle`, `linecard`, `switch`, `power-zone`) nor the `traverses-*` relationships.
Worse, the engine's `attributeCommonMode` hard-types `candidate_node_kinds:
ReadonlyArray<TopologyNode['kind']>` — its BFS is locked to those kinds. So the literal
prescription "carry our types as engine TopologyEdge.relationship values" is impossible
without either (a) editing the engine's union (a fork — forbidden), or (b) smuggling the
real types through the `metadata?: Record<string,string>` escape hatch while lying about
`kind`/`relationship`.

This is a halt-on-contradiction point: the spec's letter and the engine's reality disagree.

## Decision

Honor the **intent** ("reuse the interface *shape*; load deterministically; hash
deterministically") while declining the impossible **letter** (reuse the engine's closed
`TopologySnapshot` payload).

1. Define a product-side **`FaultDomainSource`** interface that **mirrors the shape** of the
   engine's `TopologySource` — `{ id, version, fetchSnapshot(): Promise<FaultDomainSnapshot>,
   snapshotHash(snapshot): string }` — but over an **RNG-native** `FaultDomainSnapshot`
   with our own open resource taxonomy (`optic | passive_shuffler | fiber_bundle | linecard
   | switch | power_zone | cooling_zone | …`) and incidence edges (`traverses`). This is a
   structural mirror, not a subtype of the engine type, so no engine code changes.

2. **Reuse the engine's hashing primitive, not its snapshot type.** The engine publicly
   exports `pureJsSha256` (documented "for cross-platform parity testing") and
   `computeSnapshotHash`. `FaultDomainSource.snapshotHash` canonicalizes our snapshot
   (sorted nodes by id, sorted edges) and hashes it with `pureJsSha256` — identical
   determinism guarantee, zero forking.

3. The localization solver (ADR-0001) consumes `FaultDomainSnapshot` directly. We do **not**
   call the engine's `attributeCommonMode`; our `attributeSharedResource` is a new product
   function (shared-resource MAP / set-cover), the declared generalization of "hop walk → 
   shared-resource MAP."

## Consequences

- We extend at a *new product interface* modeled on an engine contract — fully within
  "consume the engine; don't fork it." No engine union is touched; no `metadata` field is
  abused to misrepresent `kind`.
- A reader expecting our incidence model to be a literal engine `TopologySnapshot` will not
  find it; this ADR is the signpost. The mirrored method names (`fetchSnapshot`,
  `snapshotHash`) keep the shape recognizable.
- **Open for ratification (Q1):** the alternative — force-fit RNG resources into the engine
  `TopologySnapshot` via `metadata` and map every resource to `kind:'external'` — is
  recorded and rejected here as semantically dishonest and coupling us to BFS we discard.
  If the owner prefers strict literal reuse of the engine snapshot type regardless, this
  ADR flips and the solver reads `metadata`. Recommendation: keep the mirror (as decided).
