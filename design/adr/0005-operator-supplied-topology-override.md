# ADR 0005 — Operator-supplied topology override (file-backed FaultDomainSource)

- **Status:** Accepted
- **Date:** 2026-06-09
- **Decision owner:** Tessera-RNG (post-v1)
- **Supersedes:** —

---

## Context

v1 ratified Q3 as "generated fabric with documented defaults," explicitly deferring an
operator-supplied topology override to post-v1. Operators want to run the pipeline on a
*real* (hand-authored or exported) cabling/shuffle incidence map, not only the seeded
generator. This requires loading an external incidence file and feeding it through the same
pipeline.

Constraint: anti-scope **N2** forbids `src/` from importing any filesystem/network client —
product source ingests no live data. So file I/O cannot live in `src/`.

## Decision

Split responsibilities across the existing layer boundary:

1. **`src/` — pure validation.** `validateFaultDomainSnapshot(obj: unknown)` validates a
   *parsed* object into a `FaultDomainSnapshot`: it checks the RNG resource taxonomy
   (`isResourceKind`), requires the `'traverses'` relationship, enforces referential integrity
   (every edge references a declared path-class and resource), reconstructs `nodes`, and
   defaults `fetched_at_ts`/source fields deterministically. No filesystem access.

2. **`tools/` — file loading.** `tools/load-topology.ts` reads + `JSON.parse`s the file
   (`node:fs` is fine in tools) and hands the parsed object to the `src/` validator. It also
   provides a CLI that prints a summary + the deterministic snapshot hash.

3. **`runPipeline` accepts an optional `snapshot`.** When provided, it overrides the generated
   fabric; everything downstream (calibration, detection, surface, tomography, drain) is
   unchanged. The operator path is therefore: load file → validate → run pipeline.

## Consequences

- Operators can drive the full pipeline from an external incidence map without touching the
  generator. The deterministic hash (engine `pureJsSha256`) gives a stable identity for an
  operator-supplied topology, so audit records remain replay-clean.
- N2 is preserved: `src/` still imports no `node:fs`/network client (enforced by
  `test/anti-scope.test.ts`); the loader's I/O is confined to `tools/`.
- Validation is strict and pure, so it is unit-tested directly with good/bad objects — no
  filesystem needed for the validation tests.
- Out of scope still: live-fabric polling / streaming ingestion (a real `fetchSnapshot` against
  a controller) remains N2 anti-scope for now.
