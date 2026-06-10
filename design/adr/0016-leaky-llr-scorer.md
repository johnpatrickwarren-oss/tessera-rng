# ADR 0016 — Leaky noisy-OR mixture LLR scorer; the C1 residue pinned + documented

- **Status:** Accepted. _Annotation (2026-06-10): the pinned C1 residue is CLOSED by ADR-0019
  (exposure-saturating noisy-OR); the canary test was updated per its own instruction. The
  member fire-probability model here is superseded; the LLR/set-cover machinery stands._
- **Date:** 2026-06-10
- **Decision owner:** owner-directed spec; empirical contradiction routed back and resolved by the
  owner (Q1: pin + document; Q2: test q₀ = FDR target q; Q3: commit LLR as default)
- **Supersedes:** the linear tomography gain of ADR-0014 §4 as the *default* scorer (it survives as
  the failure-mode control, `opts.legacy`)

---

## Context

The round-3 cold-eye flagged **C1 (CRITICAL)**: on the Spraypoint two-view fabric (ADR-0015) a strong
optic fault leaks into the `per_panel_pair` view and a coarse resource (panel/room) — which genuinely
carries those pair leaves at `w = 1` while the optic carries them at `w = 1/nTors` — out-explains the
true optic and flips rank-1. The owner directed replacing the linear gain
`Σ newly·w − λ·Σ quiet·w` with a **leaky noisy-OR mixture log-likelihood-ratio** scorer, predicting
the coarse resource's many quiet members would falsify it.

## Decision

### The scorer (owner's spec, implemented exactly)

Per member leaf `i` of candidate resource `r`, with traffic weight `wᵢ` (ADR-0014):

- **clean (null):** `P(fire) = q₀` — the floored fleet base rate from the surface,
  `q₀ = (|selected| + ½)/(|leaves| + 1)` (Jeffreys-style pseudo-count; `src/surface.ts`
  emits it as `base_rate_q0`).
- **faulty:** `P(fire) = q₁ᵢ(δ) = q₀ + (δ − q₀)·wᵢ` for fault strength `δ`, **mixed** over the
  deterministic grid `δ ∈ {0.3, 0.6, 0.9}` (average per-δ likelihoods, then LLR vs the null —
  method of mixtures). Greedy set-cover proceeds on `LLR > 0`; already-explained firing members are
  excluded from later candidates' scoring.

This is weight-aware falsification: a quiet high-weight member is strong evidence *against* a
resource; a quiet low-weight member costs ~nothing. It **subsumes the free `collateralWeight` λ
knob**; the linear scorer is retained only as the failure-mode control (`opts.legacy`). Culprits gain
`supporting_views` — per-view concurrence as *displayed metadata*, not the mechanism. The product
over overlapping-view leaves is a stated **composite (pseudo-)likelihood**: valid for *ranking*
candidates on the same observation set, not for calibrated posteriors — consistent with
`correlational_not_causal` (N1).

### The empirical contradiction (halt-on-contradiction, verified)

The LLR did **not** fix C1. δ-sweep on the default 64×10×2 fabric (seed 1, optic-3 fault, q=0.05):

| δ | \|selected\| | linear (control) | LLR, surface q₀ | LLR, q₀ = q (0.05) |
|---|---|---|---|---|
| 4–32 | 1 | optic-3 | optic-3 | optic-3 |
| 64 | 26 | optic-3 | **panel-8** | **room-0** (huge score) |
| 128 | 46 | **room-0** | **panel-0** | **room-0** (huge score) |

(The first two columns are bound by tests — the pinned-band sweep and the residue canary at δ ∈
{64, 128}. The `q₀ = q` column is the recorded Q2 comparison run; it is deliberately **not**
reproduced by an in-repo test — the q₀ = q variant was rejected, not shipped.)

The owner's predicted mechanism is empirically **false**: at high δ the optic fault saturates the
*entire* `per_panel_pair` view (all 45 pair leaves selected), so a panel/room has ~23 firing
members at `w = 1` there — evidence its per-ToR quiet members cannot outweigh. No q₀ fixes it
(swept; surface q₀ inflates to ≈0.42 because the selected set is dominated by true positives →
panel wins; small q₀ → room wins with huge scores). The root cause is **structural**: tor-3's
per-ToR firing causally explains away the pair-view firing (same physical optic), but no
per-resource scorer on this incidence can express that cross-view dependence — and the optic
genuinely is not the likelihood-best explanation of the pair-view firing.

### Resolution (owner's Q1/Q2/Q3 calls)

- **Q1 — pin + document.** The realistic regime is pinned: the LLR holds the true optic at rank-1
  across the band where pair-view leakage stays sub-threshold (**δ ≤ 32** on this fabric/seed; the
  flip begins at δ ≥ 64). The high-δ flip is recorded here as a **known limitation of
  union-of-dependent-views localization**, bound by a residue **canary test** that also proves the
  per-ToR view *alone* still localizes cleanly at δ = 128 — the residue is a union artifact, not a
  detection failure. The structural **explain-away** scorer (discount a leaf's contribution when a
  higher-weight resource in another view already explains the same underlying flow) is the only
  thing that would close it; it is *future work*, deliberately not built now.
- **Q2 — q₀ comparison run; surface q₀ kept.** `q₀ = q` ranks identically in the pinned band (the
  table above) and makes the residue *worse* (room-0 with huge scores at δ ≥ 64, because nothing
  inflates the null when the fleet genuinely fires). Keeping the surface estimate also avoids
  coupling the scorer's null to the operator's FDR knob. Recorded as a negative finding.
- **Q3 — LLR is the default scorer, committed now.** Its value is independent of C1: the null is
  **base-rate aware** (members firing at ≈ the fleet base rate are not evidence — the linear control
  blames them; the discriminating test would fail if the default silently reverted), falsification
  is weight-aware without a free λ, and scores are interpretable LLRs.

### The owner's double-count check — negative finding, no knob

One-view-vs-both-view fixture: inside the pinned band the union's rank-1 equals the per-ToR-only
rank-1 (no rank distortion from overlapping views), so the contemplated minimal fix (divide each
leaf's log-contribution by view multiplicity) is **not added**. The only divergence is the δ ≥ 64
residue already documented above.

### Cold-eye L1 folded in

`validateFaultDomainSnapshot` silently **dropped** operator-supplied `views`, so an operator
two-view fabric lost its view definitions — and its replay hash identity (views enter the hash,
ADR-0015). Fixed: `views` are parsed and validated (non-empty view name; `leaf_ids` ⊆ declared
path-classes), with a binding round-trip + hash-difference test.

## Consequences

- **Binding tests** (anti-self-confirming, per DISCIPLINES §6): the pinned-band sweep (δ ∈ {4,16,32}
  → optic-3); the C1 residue canary (δ ∈ {64, 128}: union flips to a coarse pair-view resource,
  per-ToR view alone holds at 128, linear control also flips at 128 — if the canary fails because
  the flip got *fixed*, update this ADR, do not delete the test); the base-rate discriminator (LLR
  rejects at q₀ = 0.5 what the linear control blames); the spurious-winner guard (a single
  false-positive pair leaf yields **no** culprit and is reported unexplained — deleting the
  quiet-member falsification term fails it); `supporting_views` exactness; the L1 views round-trip.
  **133 tests green** (observed); the LLR solver holds **100 % mutation (11/11)** and
  `fault-domain-source` **100 % (31/31)** after closing two pre-existing weight-validation gaps the
  sweep surfaced (a validator that silently dropped edge weights — the L1 bug class again).
- **Cold-eye hardening folded in** (fresh-context review, DISCIPLINES §8): the score gate is
  `!(score > 0)` so a NaN score (empty grid) is rejected rather than ranked; `DEFAULT_LOCALIZE` is
  frozen (the grid array was a mutable alias); `asViews` rejects empty `leaf_ids`; the q₀ > δ
  regime is documented at the type (a saturating fleet eventually scores nothing — deliberate: a
  fleet-wide event is not localizable); `DEFAULT_LOCALIZE.q0 = 0.01` is documented as a
  quiet-fleet convention that the pipeline always overrides with `surface.base_rate_q0`.
- **Honest claims:** localization on a union of dependent views is trustworthy in the sub-leakage
  band and *ambiguous between the fine and coarse explanation* once a fault saturates a coarse
  view — operators see `supporting_views` and the unexplained set either way. The composite
  likelihood gives rankings, not posteriors.
- **The linear scorer is not deleted** — it is the recorded failure-mode control (`opts.legacy`),
  used by the control assertions.
- **N1–N5 intact.** Product-side only; solver schema gains `supporting_views`; every culprit still
  carries `correlational_not_causal`; the unexplained set is still always reported.
