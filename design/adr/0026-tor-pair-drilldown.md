# ADR 0026 — ToR-pair drill-down: from fault domain to impacted pairs, on demand

- **Status:** Accepted
- **Date:** 2026-06-10
- **Decision owner:** Tessera-RNG (post-v1 round 7, item 2 — owner-authorized round; closes the
  drill-down deferral recorded in ADR-0015)
- **Supersedes:** —

---

## Context

ADR-0015 made the monitored leaf an aggregation-view class and recorded: "ToR-pair stays the
UNDERLYING entity (drill-down is future scope)." Since then the operator story stops at the
fault domain: an audit says `optic-3, correlational` but not **which of the underlying ToR-pairs
are impacted** — the question a drain/triage decision actually needs. Continuous per-pair
monitoring is exactly what the views exist to avoid (the production fabric's ~460 K pairs); the
missing capability is an **on-demand, culprit-scoped** second stage.

## Decision

New module `src/drilldown.ts`, an operator-initiated query — deliberately NOT part of
`runPipeline` or the audit (the fleet pipeline stays view-level):

1. **Exposure model** — `exposedPairs(params, resource)`: the ToR-pairs whose traffic crosses
   the resource, with the model-derived exposure fraction. Optic-k → the nTors−1 pairs with
   endpoint k at exposure 1; panel-p → every pair at 1/nPanels; room-r → every pair at
   (panels in r)/nPanels. (Mirrors the ADR-0015 spray weights at pair granularity.)
2. **Drill window** — synthetic per-pair STANDARDIZED residual series (5-signal, seeded,
   deterministic) for the examined pairs; each ground-truth fault `{resource_id, delta}` shifts
   a pair's p99 residual by `delta · exposure(pair, fault)`. Residual-level by design: in
   production the drill would standardize from pair-level calibration; the synthetic harness
   models the post-calibration stream directly (recorded). Mean-shift faults only — other modes
   contribute no per-pair shift in the drill window (recorded narrowing).
3. **Detection by reuse** — pairs run the EXISTING `detectPathClass` (Families A+C) and
   `buildSurface` e-BH at the drill's own `q`: FDR is controlled over the EXAMINED pairs.
   Output: `DrillDownReport { resource, exposed, examined, truncated, q, selected: [{pair,
   e_value}] ranked, correlational_not_causal: true }`.
4. **Bounded work, truncation visible** — `maxPairs` (default 256) caps the examined set
   (deterministic id-order sample); `exposed` vs `examined` and a `truncated` flag are ALWAYS
   reported (instrumented-caveat: a panel drill at paper scale exposes ~460 K pairs; the report
   says what fraction it looked at, never implies completeness).
5. **Claim strength** — the drill is triage conditioned on a fleet-level selection (a
   selection-conditioned query, not fresh anytime inference); the report carries
   `correlational_not_causal` and pair evidence is correlational impact, not hardware blame.

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test ("Then") |
|---|---|
| Exposure model matches the spray weights | unit: optic-k → nTors−1 pairs at 1; panel → all at 1/nPanels; room → all at panels/nPanels |
| True-culprit drill ranks the impacted pairs | optic-3 fault, drill optic-3 ⇒ the exposed pairs select with high e-values; clean drill selects ~nothing (FDR within the drill) |
| The drill is honest about dilution | panel-2 fault at Δ=4, drill panel-2 ⇒ few/no pairs select (per-pair shift is Δ/nPanels — the drill reports the dilution truth instead of inventing impact); at large Δ the pairs select |
| Cross-resource exposure is informative, not spurious | optic-3 fault, drill optic-5 ⇒ ONLY pair (3,5) selects (the one optic-5 pair that crosses optic-3) |
| Truncation reported, never silent | panel drill at defaults: exposed 2016, examined ≤ maxPairs, truncated true; counts in the report |
| Deterministic (AC-9 spirit) | same seed ⇒ byte-identical report |
| N1 intact | report carries `correlational_not_causal: true`; no per-pair root-cause field exists |

## Consequences

- The localization story is complete end-to-end: fleet → fault domain → impacted pairs, all
  under the same e-value discipline, with multiplicity paid only where it is affordable (the
  drill's examined set), which is the entire design rationale of ADR-0015's views.
- Honest limitations, recorded: the drill window is synthetic-residual-level (production needs
  pair-level calibration — out of N2 scope); selection-conditioned FDR is over examined pairs
  given the trigger, not an unconditional guarantee; mean-shift faults only; the truncation
  sample is id-ordered, not evidence-ordered (no per-pair prior exists before examining).
