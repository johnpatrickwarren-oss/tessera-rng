# ADR 0047 — Identifiability certificate: the N1 claim computed per snapshot, ambiguity surfaced on culprits

- **Status:** ACCEPTED
- **Date:** 2026-07-02
- **Decision owner:** Tessera-RNG
- **Relates to:** N1 / AC-5b (identifiability of the shared-resource set, nothing stronger),
  ADR-0015 (views are part of the measurement design), ADR-0046 (the linear member model whose
  hypothesis space defines distinguishability), `src/identifiability.ts`,
  `test/identifiability.test.ts`, the coverage matrix's new certificate section.

---

## Problem

N1 claims "identifiability of the shared-resource set" as prose. Boolean-tomography theory
(Ma, He, Swami, Towsley et al., IMC 2014 / ToN 2017) makes identifiability a *computable
property of the measurement design*: two failure hypotheses are distinguishable iff some
monitored class separates them. The claim should be an artifact, not a disclaimer — and a
culprit the design *cannot* uniquely support should say so instead of presenting an arbitrary
rank order between indistinguishable siblings.

## Decision

`src/identifiability.ts` computes, per snapshot (deterministically, O(E log E) via canonical
unit-max profile signatures — paper-scale cheap):

1. **Ambiguity groups** — proportionality classes of the weighted incidence columns. Under the
   ADR-0046 linear model a single-resource hypothesis is a profile θ·w⃗ᵣ, so PROPORTIONAL columns
   are indistinguishable by any scorer on this design (θ absorbs scale). Weights are compared at
   9 decimals — far below any modeled weight difference (e.g. 1/63 vs 2/64 differ in the 3rd).
2. **Fleet-ambiguous resources** — uniform full-support columns, indistinguishable from a
   fleet-wide event (and from the ADR-0046 virtual fleet candidate).
3. The **k = 1 summary** (identifiable count / resource count). k ≥ 2 (set-vs-set)
   identifiability is combinatorial and deliberately NOT claimed — recorded narrowing.

Surfaced in two places:
- **Coverage matrix** section "Identifiability certificate" — certificates for the three
  published fabrics. Measured: the generated fabric and both Spraypoint fabrics are **fully
  1-identifiable** (no ambiguity groups, no fleet-ambiguous resource) — the N1 claim now rides
  on a computed artifact. The degenerate worst case is caught, not hidden: a one-room Spraypoint
  (`nRooms: 1`) makes `room-0`'s column uniform ⇒ fleet-ambiguous (bound by test) — the
  Jupiter-OCS lesson that uniformly-striped domains are the localization worst case.
- **Culprits**: `Culprit.ambiguity_group?` names the indistinguishable siblings when non-empty
  (absent otherwise — no schema noise on the published fabrics). This is a strictly WEAKER
  claim, N1-aligned; it can never make a claim finer.

## Consequences

- No behavioral change to ranking or selection; audits on the published fabrics are
  byte-identical (the field only appears when a group exists — bound by test).
- Coverage matrix + demo regenerated (new section; JSON gains `identifiability`).
- Future work recorded: k ≥ 2 certificates (Ma/Towsley set condition), and identifiability-driven
  VIEW design (choose aggregation views to break computed ambiguity groups — the deTector/monitor-
  placement move) — the natural companion when an operator fabric shows non-singleton groups.
