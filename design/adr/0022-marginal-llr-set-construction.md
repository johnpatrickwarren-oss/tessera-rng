# ADR 0022 — Marginal-LLR set construction: the cover scores what remains SURPRISING

- **Status:** Accepted
- **Date:** 2026-06-10
- **Decision owner:** Tessera-RNG (post-v1 round 5 — forced by ADR-0021's end-to-end test, per
  halt-on-contradiction: the multi-fault e2e FALSIFIED ADR-0021's "no tomography changes"
  prescription, recorded there)
- **Supersedes:** the binary explained-set greedy cover (ADR-0001/0016) as the default set
  constructor (it survives verbatim under `opts.legacy`, the control path)

---

## Context

ADR-0021's cross-kind fixture (simultaneous optic-3 + panel-7 on the Spraypoint fabric, δ = 4)
failed under the shipped cover: **panel-7 "claimed" tor-3 through a w = 0.1 membership** — the
binary explained-set marks every firing member of a pick as explained regardless of weight, so
optic-3 was left with zero newly-firing members and never picked. The observed audit returned one
culprit for two faults. Weight-threshold patches ("claim only members with w ≥ x") and
dominance rules were considered and rejected: each introduces a knob, and the dominance variant
breaks the high-δ minimal set (the optic's 1/64 pair members would never be claimable, so
spurious panels re-enter after the true optic).

## Decision

Replace the binary explained-set with **marginal-likelihood greedy set construction**:

1. Each leaf carries a **residual quiet factor** `Gᵢ` (log-space), initially 1. A candidate's
   score is the **marginal LLR**: its members' likelihood under (picked set + candidate) vs
   under (picked set alone) — `log P(quiet) = log(1−q₀) + log Gᵢ + κw·log(1−δ)`, mixed over the
   ADR-0019 (δ, κ) grid with the same 1/κ prior, against the base
   `log P(quiet | set) = log(1−q₀) + log Gᵢ`. With nothing picked (G ≡ 1) this is **exactly the
   ADR-0019 scorer** — first picks, scores, and every single-fault behavior are unchanged
   (bound: the C1-CLOSED quantitative score bounds pass untouched).
2. After each pick, the resource's **posterior over (δ, κ)** — the same mixture cells that won
   it the pick, posterior-weighted — folds into its members:
   `log Gᵢ += log E_post[(1−δ)^{κwᵢ}]`. Leaves the picked set already predicts to fire
   contribute ~nothing to later candidates; leaves it leaves surprising (a w = 0.1 membership
   under a posterior that keeps w = 0.1 mostly quiet) remain available evidence.
3. The loop runs while any unpicked resource has marginal score > 0 (cap `maxResources`).
   **No knob anywhere**: no claim threshold, no dominance rule — the likelihood does the work.
4. Audit binarization (display only, not mechanism): a firing leaf is `explained` when the
   picked set **touches it** (log Gᵢ < 0) **and** makes its firing more likely than not
   (P(fire | set) > ½, strict — at q₀ ≥ ½ a firing leaf is unsurprising under the *null*, which
   is not the same as being explained by the culprit set).
5. The legacy linear cover keeps the historic binary semantics verbatim (`opts.legacy`).

## Why it is right in both directions (the failure modes that killed the alternatives)

- **Cross-kind multi-fault (the ADR-0021 fixture):** panel-7's posterior keeps w = 0.1 members
  mostly quiet (its 63 quiet tor members force low effective exposure), so tor-3's firing stays
  surprising after the panel is picked → optic-3 earns a positive marginal score → both culprits
  emitted, each with its own member set. Observed: before the change, culprits = [panel-7];
  after, [panel-7, optic-3] (the fixture's history is the recorded evidence — the binary cover
  is not re-runnable under the default path, same recorded-evidence pattern as ADR-0019).
- **Single saturated fault (δ = 128 optic):** the optic's posterior concentrates on high κ,
  predicting the entire pair view fires → every panel/room marginal ≈ 0 → exactly ONE culprit
  (bound by the new minimal-set assert in the C1-CLOSED test, which also kills a
  posterior-fold-deletion or prior-instead-of-posterior mutant — panel-8's plain LLR ≈ 3 would
  otherwise rank as a spurious second culprit).

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test ("Then") |
|---|---|
| G ≡ 1 reduces to ADR-0019 exactly | the untouched ADR-0016/0019 suites: first-pick ranks, the C1-CLOSED score bounds (< 5 / > 20), base-rate null, falsification, spurious-winner, weighted-traffic, q₀/degenerate-mixture guards |
| Cross-kind multi-fault recovers BOTH resources | `spraypoint.test.ts` ADR-0021 fixture (failed under the binary cover, observed) |
| Same-kind multi-fault end-to-end | `pipeline.test.ts`: two shufflers ⇒ both culprits, both drained, replay-clean |
| Minimal set preserved under saturation | C1-CLOSED: `culprits.length === 1` at δ = 128 (kills the fold-deletion mutant) |
| Minimal set on the toy fabric | the v1 MAP test: zero-collateral common-mode picked, the incidental optic earns no positive marginal (`culprits.length === 1`) |
| Audit binarization honest at the boundary | base-rate test: q₀ = 0.5, no culprits ⇒ all firing leaves UNEXPLAINED (an empty set explains nothing, whatever the base rate) |
| Legacy control untouched | the legacy-path tests (gain-0 boundary, linear flips at δ=128) pass verbatim |

## Consequences

- The "minimal explaining set" claim is now likelihood-grounded end-to-end: a resource enters
  the set iff it adds positive marginal evidence, and stops being creditable the moment the set
  already predicts its members. AC-5a/5c semantics unchanged; N1 untouched (flag, unexplained
  set, ranking-not-posterior framing all carried over).
- `explained_path_class_ids` semantics changed from "claimed by a pick" to "more likely than
  not under the picked set, which touches it" — strictly more honest; all existing assertions
  on it pass unchanged.
- The composite-likelihood caveat (ADR-0016) now also covers the posterior fold: per-resource
  posteriors are folded independently (no joint posterior across picks) — valid for ranking and
  residual bookkeeping, not calibrated joint inference.
- Demo and coverage artifacts are byte-unchanged (the freshness binds passed without
  regeneration): no published scenario had a multi-culprit output that the marginal cover alters.
