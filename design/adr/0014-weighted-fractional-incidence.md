# ADR 0014 — Weighted (fractional) incidence

- **Status:** Accepted
- **Date:** 2026-06-09
- **Decision owner:** Tessera-RNG (post-v1, round 3 — work order item 2)
- **Supersedes:** —

---

## Context

v1 incidence is **binary**: a path-class either traverses a resource or it does not, and the fault
injection shifts every traversing path-class by the full `delta`. The paper (ADR-0013) shows the real
regime is fractional: under **Spraypoint**, a ToR-pair sprays its traffic across **>50 edge-disjoint
paths** via ECMP hashing, so a single faulty resource carries only a *fraction* of any path-class's
traffic. A single faulty optic shifts an affected path-class by ≈ `delta · (traffic fraction through
that optic)` — diluted, and smeared across many path-classes. The v1 binary model is the *easy
regime*; the published floors (Δ ≈ 1–2σ) are floors *for that injection model*. The tomography
treated incidence as binary too, so collateral was an all-or-nothing count.

## Decision

Add an optional **traffic weight** `w ∈ (0, 1]` to the incidence edge and thread it through injection
and localization. `w` absent ⇒ `1` (full traversal) ⇒ **byte-identical v1 behavior** — that
equivalence is the anti-self-confirming guard.

1. **`FaultDomainEdge.weight?`** — the fraction of the path-class's traffic through the resource.
2. **Hash + validation** — the weight is part of the measurement design, so it enters
   `computeFaultDomainHash` (as `weight ?? 1`, so weight-1 ≡ absent) and `validateFaultDomainSnapshot`
   rejects weights outside `(0, 1]`. Re-weighting an incidence is a distinct replay identity.
3. **Telemetry dilution** — a fault on resource `r` shifts an affected leaf by `delta · w(pc, r)`
   (and a `shiftVector` scales likewise). The honest Spraypoint dilution; weight 1 ⇒ full shift.
4. **Weighted tomography** — `gain(r) = Σ_{newly firing} w − λ·Σ_{quiet} w`. A resource explains a
   firing path proportionally to how much of its traffic flows through `r`; a quiet path costs
   collateral proportionally to its weight (a quiet path sending 2 % through `r` is weak evidence
   against it; 60 % is strong). With all weights 1 this is the v1 integer `|newly| − λ|quiet|`.

The Spraypoint-flavored fabric generator and the two-view leaf model that *produce* realistic weights
at scale are the adjacent ADR-0015 (work-order item 5 resolution); this ADR is the mechanism, proven
on hand-built and operator-supplied weighted snapshots.

## Consequences

- **The dilution is honest and the scorer follows the traffic.** Binding test: a fault diluted to
  `w = 0.5` shifts the leaf by exactly `delta·0.5`. And an anti-self-confirming fixture — a decoy
  resource that carries the firing paths at low weight (incidental) vs. the true resource that
  carries them at full weight plus a couple of barely-traversing quiet members — the **unweighted**
  scorer picks the decoy (wrong); the **weighted** scorer picks the true resource. The old failure
  mode is kept in the test as the control.
- **Default unchanged.** Weight 1 ≡ absent across hash, telemetry, and tomography; all 112 prior
  tests pass unchanged, and the weighted solver holds **100 %** mutation (8/8).
- **Detection-layer consequence (favorable).** Dilution produces many *weakly* shifted, correlated
  streams — exactly what the hierarchical e-value combine + e-BH aggregate well. Measuring the
  floors *under* dilution is deferred to the Spraypoint fabric + coverage sweep (ADR-0015), so the
  current floor table stays honestly scoped as the easy (binary) regime until then.
- **N1–N5 intact.** Pure product-side change; the solver schema is unchanged (counts stay integer,
  `correlational_not_causal` on every culprit, unexplained set still reported). No engine change.
