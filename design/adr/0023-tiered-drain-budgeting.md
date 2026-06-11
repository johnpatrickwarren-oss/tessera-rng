# ADR 0023 — Tiered drain budgeting: rank-1 culprits of every evidence group drain first

- **Status:** Accepted
- **Date:** 2026-06-10
- **Decision owner:** Tessera-RNG (post-v1 round 6, item 2 — owner-authorized; closes the
  ADR-0022 L2 recorded limitation)
- **Supersedes:** the flat score-sorted drain ranking on epoch'd runs (ADR-0018's
  `drainTargets`)

---

## Context

ADR-0022 made rank ≥ 2 culprit scores **pick-order-conditional marginals**, while each evidence
group's rank-1 carries a full LLR. The epoch'd drain ranking (`drainTargets`) sorts the
concatenated per-group culprit lists by raw score — mixing those scales. Recorded consequence
(ADR-0022 L2): with `drain_top_k = 2`, a group-1 second-pick marginal (e.g. 1.5, possibly an
artifact) can outrank a group-2 **first-pick** full LLR for a real fault (e.g. 0.8) and starve
its drain.

## Decision

On epoch'd runs, drain targets are chosen by **tier, then score**:

- A culprit's **tier** is its pick position within its evidence group (the per-group lists
  arrive in greedy pick order). Tier-1 entries are full LLRs — comparable across groups;
  tier-t ≥ 2 entries are marginals conditional on t−1 earlier picks — comparable within a tier,
  approximately across groups (recorded, not hidden).
- Ranking: tier ascending, then score descending, then resource id (deterministic); one drain
  per resource (unchanged); take `drain_top_k`.
- Consequence: **every evidence group's strongest culprit is drained before any group's
  second pick** — a real fault localized in a later epoch can no longer be starved by another
  group's trailing marginal.
- The non-epoch'd path is untouched (a single greedy list is already tier-ordered, so
  `slice(0, k)` is the same thing — byte-identical v1 audits, guard-tested since ADR-0018).

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test ("Then") |
|---|---|
| Tier beats raw score across groups | `pipeline.test.ts` unit test on `drainTargets`: group-0 = [X:31.5, Y:1.5], group-1 = [Z:0.8] with k=2 ⇒ targets [X, Z]. The flat sort's [X, Y] outcome is the documented contrast — the tier assertion fails under it (not separately asserted; the old sort is not re-runnable) |
| Within a tier, score then id | same test: tier-1 ordering by score desc with id tie-break |
| One drain per resource | existing ADR-0018 dedupe behavior re-asserted through the tiered path |
| Non-epoch'd path byte-identical | the existing `reroutes: []` byte-identity guard + the full v1 suite |
| End-to-end sanity | the epoch'd tests (ii)/(ii-b) and the multi-fault e2e pass unchanged |

## Consequences

- The starvation case is closed structurally; what remains approximate is same-tier
  cross-group comparison (marginals conditional on different sets) — recorded here, acceptable
  because tier-1 (the case that matters operationally) is exact.
- `drain_top_k`'s doc ("how many top culprits") now means top by tier-then-score on epoch'd
  runs — documented at the parameter.
