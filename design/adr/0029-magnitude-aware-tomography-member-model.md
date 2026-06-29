# ADR 0029 — Magnitude-aware tomography member model

- **Status:** ACCEPTED — **Phase 1 BUILT, OPT-IN / DORMANT** (`src/tomography.ts`,
  `test/magnitude-tomography.test.ts`). The scorer activates only when `opts.magnitude` is passed;
  the pipeline does NOT pass it (owner-ratified: keep the pipeline on the binary scorer so no
  freshness-bound artifact — demo/replay/coverage — churns). 218 tests green, gate PASS. **The
  default-preservation claim is re-scoped (see Build note): it holds byte-for-byte at the surface's
  typical small q₀, but the magnitude null is q₀-blind and DIVERGES at high q₀ — a recorded gap and a
  hard prerequisite for the Phase-2 flip.** Phase 2 (cross-optic re-add) remains ADR-0031.
- **Date:** 2026-06-14 (spec); 2026-06-29 (Phase 1 built)
- **Decision owner:** Tessera-RNG (post-v1 round 10 spec; owner-authorized direction "follow the
  recommendations", continuing the ADR-0028 lineage)
- **Relates to:** ADR-0019 (exposure-saturating noisy-OR), ADR-0022 (marginal-LLR set
  construction), ADR-0016 (leaky-LLR / q₀), ADR-0028 (unified traffic model — the rejected
  full-support variant and its written acceptance bar)

---

## Context

ADR-0028 unified the Spraypoint traffic model but had to **omit the tor-leaf cross-optic edges**
(true `P = 1/(nTors−1)` per partner optic) because the binary fire/quiet noisy-OR collapses under
them: a true optic accrues ~63 quiet diluted members, the high-κ mixture cells predict those
members fire, so each quiet one falsifies the true optic until a coarse pair-view resource
out-scores it. The rejection was recorded with a written acceptance bar (the full-support
measurements: cross-kind recovery across seeds, sane δ-sweep).

Root cause is **information discarded at the selection threshold**. The scorer's only per-member
observable today is the boolean `fired` (= e-BH-selected). A remote cross-optic member is not
"quiet" — it carries a small standardized shift fully consistent with the true optic's tiny
predicted exposure. The binary model cannot see that; it reads "below threshold" as falsifying.
A scorer that sees *magnitude* reads it as expected.

This does **not** weaken any published guarantee. The N1 contract already states tomography is a
composite pseudo-likelihood "valid for RANKING candidates on the same observation set, not for
calibrated posteriors." e-BH keeps the anytime-valid FDR guarantee upstream; localization is
explicitly downstream ranking, so graded evidence is admissible there.

## Decision

Thread per-leaf evidence **magnitude** into `localize()` and generalize the member likelihood from
Bernoulli(`fired`) to a continuous likelihood ratio, **keeping the (δ, κ) saturating mixture, the
`1/κ` scale prior, the marginal-LLR set construction, and the posterior fold unchanged in form**.

### D1 — Magnitude currency: derive it from the existing combined e-value (not a new statistic, not raw log-e)

Each leaf's combined e-value `E` (`PathClassVerdict.e_value`) is the system's single,
validity-preserving evidence summary — it is what e-BH selects on, what the family merge
(mean-of-e) produces, and what the epoch-segment merge (mean-of-e) produces. Ranking on a transform
of that **same** quantity is the *coherent* choice; a separately-plumbed effect size would have the
scorer and the detector reasoning about two different definitions of a leaf's evidence (and Families
C/D have no single scalar effect size to plumb anyway). It also needs **zero new plumbing** through
detect/surface/verdict/session — `localize()` simply receives `e_value` alongside the IDs.

Transform to the standardized-shift scale:

```
z(E) = sqrt( 2 · max(log E, 0) )
```

Justification (grounded, not heuristic): an e-value's growth rate `E[log E]` equals the KL
divergence between alternative and null; for a standardized mean shift θ that KL is `θ²/2`, so
`log E ≈ θ²/2` and `z ≈ θ`. The transform maps the e-value back onto the scale where the Gaussian
likelihood-ratio below is valid. Two guards fall out for free: under the null `log E ≤ 0 ⇒ z ≈ 0`
(clean members sit at zero), and **thresholding `z` at the selection boundary recovers today's
`fired` bit** — the default-preservation guarantee.

HONEST CAVEAT (instrumented-caveat discipline): `z` is a literal standardized effect only for
Family A (mean shift); for Families C/D it is a **monotone evidence proxy**, not a calibrated effect
size. Acceptable precisely because tomography is RANKING (N1), which needs a coherent monotone
ordering, not a calibrated magnitude. Recorded, not hidden.

### D2 — Scale S: mix over a fixed grid with a fixed prior (never fit it)

The member's predicted mean is `μ = S · L`, where `L = 1 − (1−δ)^{κ·w}` is the lit fraction the
noisy-OR already computes and `S` is the standardized shift of a fully-lit member — the one new
amplitude. A single fixed `S` is a magic number; fitting `S` from the data is a nuisance parameter.
Both are knobs by this project's standard (λ was subsumed; the κ prior is fixed-form). The
in-keeping move is to **admit the fault amplitude is unknown and mix over it**, identically to κ:

```
S ∈ {1, 2, 4}   with a 1/S scale prior   (mixed jointly with δ × κ)
```

The grid is not arbitrary: `z` is standardized, so the meaningful effect range is 1–4σ — that is
what "standardized" means, which is why D1 had to land first. A fixed grid + fixed prior is exactly
what the project already accepts as principled (not tuned) for δ and κ. The acceptance bar (below)
empirically falsifies a bad grid; the choice is evidence-gated, not asserted.

### The scoring rule (drop-in for the existing mixture machinery)

Per member with magnitude `z` and weight `w`, in mixture cell `(δ, κ, S)` with `μ = S·L`,
`L = 1 − (1−δ)^{κ·w}`, the **soft-evidence likelihood ratio** (graded evidence into a noisy-OR via a
per-member LR — the standard virtual/soft-evidence treatment) is `N(z; μ, 1) / N(z; 0, 1)`, so:

```
log-LR(member) = μ·z − μ²/2
```

- predicted-lit (large μ), observed large z → large `+μz` (support);
- predicted-lit (large μ), observed z ≈ 0 → `−μ²/2` (falsification, scaled by predicted lit-ness);
- diluted (tiny μ), observed z ≈ 0 → `≈ 0` (no spurious falsification).

**Why this re-admits the cross-optic edges** (stated precisely — the naive "tiny weight, tiny
penalty" story is wrong): at high κ the mixture still predicts a 1/63 member is lit. The fix is that
magnitude lets the mixture **pick the right κ per member** — a diluted cross-optic member's observed
`z ≈ 0` gives the high-κ cells (which predict it lit) low likelihood so they self-down-weight, while
the low-κ cells (which predict it barely lit) fit; the member stops falsifying the true optic. The
binary model had nothing to discriminate κ with.

### What stays unchanged (form-preserving)

`logMixExp`, the marginal-LLR `score = logMix − base`, `bestMarginal`, the admission gate
(`hasUnexplainedFiring`), the q₀-relative `isExplained` binarization, the legacy linear control,
and the per-resource accumulation. Only `memberLLMarginal` / `memberLLBase` change (Bernoulli
log-prob → `μz − μ²/2`), plus the mixture gains the S dimension and the posterior fold is
re-derived for the magnitude mixture (see Risk).

## Anti-scope (must-never)

- **Detection / FDR / families untouched.** Magnitude enters `tomography.ts` only. e-BH still
  decides what is firing-eligible; the anytime-valid layer does not move.
- **No anytime-validity claim for the localization posterior.** N1 `correlational_not_causal`
  stands verbatim — ranking, not calibrated inference.
- **No knob.** S is mixed over a fixed grid with a fixed prior; if a defensible fixed grid cannot
  pass the acceptance bar, the round HALTS back to the owner rather than fitting S.
- **No scorer + fabric change in one round.** The cross-optic re-add is Phase 2, a separate ADR —
  Phase 1 changes only the scorer and must not move any snapshot hash or published floor.
- **Keep the binary scorer as a control** (as the legacy linear scorer survives, ADR-0016/0022).
- **No drain-ranking semantics change** — the ADR-0022/0023 cross-group scale caveat stands.
- **No per-leaf causal / hardware claim** (N1).
- Carryover and live-fabric seam remain owner-deferred (unchanged by this round).

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test ("Then") |
|---|---|
| Magnitude is genuinely USED (anti-self-confirming core) | a fixture with two candidates of IDENTICAL fire-patterns but DIFFERENT member magnitudes — the scorer discriminates; deleting the `μz` term ⇒ test passes-as-before ⇒ FAILS (proves it is not the binary model in disguise) |
| `z(E)` transform | unit test: `z(E)=0` for `E ≤ 1`; monotone increasing in `E`; `z ≈ θ` recovered on a seeded N(θ,1) e-process within tolerance |
| Default preservation **at small q₀** (re-scoped per cold-eye) | with magnitude binarized (firing → constant supra-threshold e-value, quiet → z=0), `localize()` reproduces the binary ranking + explained set byte-for-byte on the ADR-0014 decoy fixture (`DEFAULT_LOCALIZE` q₀=0.01). NOT a global identity — the magnitude null is μ=0 (q₀-blind), so it diverges at high q₀; pinned by the divergence fixture below |
| No regression — C1 closure (ADR-0019) | optic-3 rank-1 across the full δ sweep incl. saturation; the discriminating-control floor holds |
| No regression — set construction (ADR-0022) | minimal single-fault set; cross-kind multi-fault recovery; spurious-winner guard; posterior-fold deletion/prior-instead-of-posterior mutants die; no view-multiplicity knob |
| Posterior fold re-derived correctly | the fold uses the magnitude-mixture weights; its deletion mutant still fails a test |
| S mix is fixed-form | a test asserts the S grid + prior are constants (no data-derived S path exists) |
| Replay + incremental≡batch keystone | byte-identity holds; `session.ts` shared `assembleAudit` stays aligned through the new `localize` signature |
| ACCEPTANCE BAR (Phase 2 only, separate ADR) | on the full-support fabric (cross-optic edges re-added), cross-kind faults recover and the δ-sweep is sane — the exact ADR-0028 measurements that rejected the binary model now pass |
| New math mutation-checked | `arch mutate` over the member-LR + fold; hand-applied constant mutants on the S/κ grids and the `z` transform |

## Risk surface (the load-bearing review targets)

This touches the most-tuned code in the repo. Where the cold-eye must look hardest:

- **Posterior fold** (`posteriorQuietFactors` / `foldPosterior`): keyed on the (δ, κ) mixture
  weights; the magnitude likelihood changes those weights, so the fold must be **re-derived**, not
  merely extended. Highest-risk item.
- **The q₀ null**: today's floored base rate keeps `log(·/q₀)` finite; in magnitude space the null
  is `z ≈ 0` with an atom at 0. Map the q₀ pseudo-count to a small null offset cleanly; the
  Gaussian opens new degenerate paths (μ→0, large-z overflow) that need their own gates — the kind
  of overflow→NaN path a past cold-eye caught in Family D.
- **Signature ripple**: `localize`'s new input flows into `session.ts` (shared `assembleAudit`) and
  every direct test caller; the incremental≡batch keystone must stay byte-identical.

## Sequencing

- **Phase 1 (this ADR, authorized-pending):** magnitude scorer on the EXISTING fabric. Prove no
  regression on every ADR-0019/0022 test + the anti-self-confirming magnitude fixture + the
  default-preservation guard. Snapshot hashes and published floors **do not move**.
- **Phase 2 (separate ADR-0031):** re-add the ADR-0028 cross-optic edges and measure against the
  acceptance bar. Hashes and floors move again here, and only here. Splitting isolates the
  variable: a Phase-2 regression is a fabric interaction, not the scorer.
  **HARD PREREQUISITE for the Phase-2 flip (new, from the Phase-1 cold-eye):** implement the
  q₀-aware magnitude null (the ADR Risk bullet — map q₀ to a null mean offset) BEFORE wiring the
  magnitude scorer into the pipeline. As built, the null is μ=0; under a high surface `base_rate_q0`
  (a fleet-wide event) the magnitude scorer would fabricate a shared-resource culprit the binary
  scorer correctly rejects — a false-positive regression. Dormant in Phase 1, so no live risk; the
  divergence is pinned by a test so it cannot be flipped on silently.

## Build note (Phase 1, 2026-06-29)

Built as an **opt-in** generalization in `src/tomography.ts`: `magnitudeZ(E)=√(2·max(ln E,0))`;
`memberSoftLR(z,μ)=μz−μ²/2` (= log[N(z;μ,1)/N(z;0,1)], exact); `resourceMagnitudeLLR` mixes the
soft-evidence LR over the (δ,κ,S) grid with prior ∝(1/κ)(1/S), the candidate-off base subtracted in
the SAME mixture (so the marginal LLR is 0 at the first pick, G≡1). The posterior fold
(`posteriorQuietFactors`/`foldPosterior`) and the admission gate are **reused unchanged** — S is not
stored in `MixCell` and does not enter the residual quiet factor, so the fold marginalizes S out
correctly (cold-eye confirmed, no S-leak). Fail-closed: a firing leaf missing from the magnitude
map throws; `magnitudeZ` throws on a non-finite/negative e-value (no silent NaN-vanish).

**Owner-ratified scope:** Phase 1 keeps the pipeline on the binary scorer (magnitude dormant), so
the 209 pre-existing tests, demo bytes, replay/coverage artifacts, snapshot hashes and published
floors are all unchanged **by construction** — satisfying "Phase 1 changes only the scorer and must
not move any hash or floor" without churning a single artifact. The behavior win lands at the
Phase-2 flip (with the q₀ prerequisite above).

**Cold-eye fold-in (fresh-context review of the Phase-1 build):** one CRITICAL — the default-
preservation claim was overstated (the magnitude null is q₀-blind; binarized magnitude diverges
from the base-rate-aware binary null at high q₀, e.g. blaming a fleet-wide q₀=0.5 event the binary
scorer rejects). Resolved per instrumented-caveat (§7): the claim is re-scoped to small q₀, the
divergence is **recorded by a pinned fixture** (`DIVERGENCE … the magnitude null is q₀-BLIND`), and
the q₀ offset is now a hard Phase-2 prerequisite (above). The reviewer confirmed the core math, the
first-pick=0 property, the fold reuse (no S-leak), and that the μz term genuinely binds (dropping it
kills 3 tests).

### Mutation record
Hand-mutant: `memberSoftLR` → `−μ²/2` (drop the μz support term). Recompiled, ran
`test/magnitude-tomography.test.js`: **3 fail** (`discriminates by magnitude`, default-preservation,
`no regression with REAL magnitudes`) — the magnitude term is load-bearing, not incidental.
Reverted; 9/9 green.

## References

- GRO e-variable: growth rate `E[log E]` = KL divergence; mean-shift KL = θ²/2.
  https://thestatsmap.com/GRO-e-variable · https://arxiv.org/pdf/2306.16646
- Soft / virtual evidence as a per-member likelihood ratio into a noisy-OR (QMR-DT lineage):
  https://arxiv.org/pdf/1207.4124 · https://arxiv.org/pdf/1105.5462
