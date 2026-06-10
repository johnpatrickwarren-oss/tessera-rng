# ADR 0019 — Exposure-saturating noisy-OR closes the C1 residue (and a latent room-fault defect)

- **Status:** Accepted
- **Date:** 2026-06-10
- **Decision owner:** owner-authorized round 4 ("merge PR #2 and move to next round, following your
  recommendations" — the recommendation was the structural fix for the ADR-0016 C1 residue);
  mechanism chosen by evidence (probe table below), per the ADR-0011 evidence-gated pattern.
- **Supersedes:** the ADR-0016 linear leak `q₁ = q₀ + (δ−q₀)·w` as the member fire-probability
  model (the LLR + greedy set-cover machinery of ADR-0016 is unchanged). The ADR-0016 C1
  "pin + document" resolution is closed: the pinned band now spans the full sweep.

---

## Context

ADR-0016 pinned a residue: at δ ≥ 64 a strong optic fault saturates the entire `per_panel_pair`
view and a coarse resource out-explains the true optic — no q₀ fixed it, and the residue was
recorded as structural. The owner's contemplated structural fix was a cross-view **explain-away
discount** ("discount a leaf's contribution to a resource when a higher-weight resource in another
view already explains the same underlying flow").

## Candidate analysis (recorded, including the losers)

- **(a) Cross-view explain-away discount** (the owner's sketch): a naive existence-based discount
  is **symmetric-unsafe** — under a true high-δ *panel* fault the per-ToR leaves also fire (δ/10
  leakage), so every optic acquires a high-weight firing cross-view member and the discount kills
  the *true* panel exactly the way it kills the false one. Making the discount conditional on
  "which resource explains the cross-view leaf better" re-derives joint-hypothesis scoring — see
  (b). Not implemented.
- **(b) Set-completion comparison** (rank-1 = first pick of the best *completed* cover): the
  panel-first chain accumulates more total LLR than the singleton {optic} under the linear-leak
  member model, so it does not fix C1 without a parsimony prior — a new free knob. Not implemented.
- **(d) Full-population scoring** (penalize non-member firing leaves): non-members contribute
  `log(q₀/q₀) = 0` to any LLR vs the null — algebraically identical to member-only scoring. Dead
  end, recorded.
- **(e) Exposure-saturating noisy-OR — CHOSEN.** The actual root cause of C1 is not cross-view
  structure but that the linear leak **cannot saturate**: at physical δ = 128σ even a 1/64-diluted
  leaf fires reliably, and a model whose leakage prediction is capped near q₀ + δ/64 treats 45/45
  firing pair leaves as astronomically unlikely under {optic} — handing the win to the coarse
  resource that carries them at w = 1.

## Decision

Member fire-probability becomes the **true noisy-OR with an exposure scale κ**:

```
P(quiet | δ, κ) = (1−q₀) · (1−δ)^{κ·w}        (exact log form: log1p(−q₀) + κ·w·log1p(−δ))
```

κ·w is the member's effective number of exposure trials: κ·w small ≈ the ADR-0016 linear leak;
κ·w large → the fire probability **saturates** toward 1. The LLR mixes over the deterministic
product grid δ ∈ {0.3, 0.6, 0.9} × κ ∈ {1, 16, 256} with prior **uniform over δ and ∝ 1/κ over
κ** (a Jeffreys-style scale prior, fixed form — *not* a tunable knob). The prior is load-bearing:
under a **uniform** κ prior every candidate jumps to the saturated cells for free, and an
unfalsified low-weight decoy explains full firing as well as the true full-weight resource —
the uniform variant **failed the ADR-0014 follow-the-traffic fixture** (decoy 13.0 vs true 11.7).
With 1/κ, extreme severity pays its prior cost yet still wins when it is the only hypothesis
fitting the data. `LocalizeOpts` gains `kappas` (frozen default `[1, 16, 256]`); the legacy
linear scorer remains the `opts.legacy` control.

## Evidence (probe, 64×10×2 Spraypoint, seed 1, q = 0.05, rank-1 : score)

| fault | δ=4 | δ=16 | δ=64 | δ=128 |
|---|---|---|---|---|
| optic-3, ADR-0016 model | optic-3 | optic-3 | **panel-8** | **panel-0** |
| optic-3, saturating+1/κ | optic-3:2.8 | optic-3:2.8 | optic-3:7.7 | optic-3:33.3 |
| panel-2, ADR-0016 model | panel-2 | panel-2 | panel-2 | panel-2 |
| panel-2, saturating+1/κ | panel-2:11.1 | panel-2:19.3 | panel-2:25.2 | panel-2:25.2 |
| room-0, ADR-0016 model | **panel-1** | **panel-1** | **panel-1** | **panel-1** |
| room-0, saturating+1/κ | room-0:7.5 | room-0:7.5 | room-0:7.5 | room-0:7.5 |

Three results: **C1 closed** (the optic row); **no symmetric regression** (the panel row, with
larger margins); and a **latent defect surfaced and fixed** — under the ADR-0016 model a true
ROOM fault mislocalized to a panel at *every* δ (a room's pair-view members include many quiet
pairs the linear leak couldn't trade off against its tor-view support; saturation + the falsified
alternatives settle it). C1 was the visible corner of a broader model misspecification.

Negative finding (recorded in the C1-closed control): the exact noisy-OR form at κ = 1 *alone*
already holds optic-3 rank-1 at δ = 128 (score 2.1) — the historic flip required the linear-leak
parameterization specifically. The κ mixture's contribution is the decisive **evidence margin**
(33.3 vs 2.1), bound quantitatively in the test.

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test ("Then") |
|---|---|
| C1 closed across the sweep | `spraypoint.test.ts` "C1 CLOSED": rank-1 = optic-3 at δ ∈ {64, 128} (plus the pinned band {4,16,32} unchanged) |
| The old failure modes are real (controls) | same test: the legacy linear scorer still flips at δ=128; κ={1} scores < 5 while the κ mixture scores > 20 (kills a κ-ignoring `k·w → w` mutant) |
| Room fault localizes to the room | `spraypoint.test.ts`: room-0 rank-1 at δ ∈ {4, 128} (fails under the ADR-0016 model — the latent-defect bind) |
| No symmetric regression | `spraypoint.test.ts`: panel-2 rank-1 at δ = 128 (and the existing δ=4 panel test) |
| 1/κ prior is load-bearing | `weighted-incidence.test.ts` (ADR-0014 fixture): true-shuffler beats the low-weight decoy — fails under a uniform κ prior |
| Base-rate null, falsification, spurious-winner, NaN guard | the ADR-0016 suite passes unchanged on the new model (base-rate discriminator, falsified bundle, single spurious pair leaf, empty grid) |

## Consequences

- **The ADR-0016 C1 canary was retired per its own instruction** ("if this fails because the flip
  got FIXED, update ADR-0016 — do not delete the test"): it is now the C1-CLOSED test with the
  two failure-mode controls. ADR-0016's status is annotated to point here.
- **Claim strength:** localization on the union of dependent views now holds rank-1 across the
  measured sweep for all three resource kinds. The composite-likelihood framing (ranking, not
  calibrated posteriors) and `correlational_not_causal` (N1) are unchanged. The explain-away
  graph surgery the owner sketched was **not needed** — recorded so it is not rebuilt later.
- **κ is part of the model surface:** `kappas` sits in `LocalizeOpts` (frozen default); the
  q₀ > δ fleet-saturation note from ADR-0016 still applies per grid cell.
- Scores are larger in saturated regimes (they are honest log-likelihood ratios over more
  decisive evidence); nothing downstream consumes absolute score magnitudes.
