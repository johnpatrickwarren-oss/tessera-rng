# ADR 0035 — Production cutover: magnitude scorer + cross-optic default

- **Status:** ACCEPTED — BUILT. The pipeline now localizes with the magnitude scorer (raw z), and
  the production Spraypoint fabrics model cross-optic exposure by default. The ADR-0028 omission is
  retired. Measured: **zero floor regressions, two improvements**, clean FDR preserved at scale.
  224 tests green, gate PASS. Owner-authorized scope (full cutover).
- **Date:** 2026-06-29
- **Decision owner:** Tessera-RNG (post-v1; the endpoint of the ADR-0028→0029→0031→0033→0034 arc)
- **Relates to:** ADR-0028 (the omission, now retired), ADR-0029 (the magnitude scorer), ADR-0031
  (cross-optic re-add + q₀-aware null), ADR-0033 (raw z is the operational scale), ADR-0034 (the
  high-δ limit now shipping, bounded), ADR-0016/0019/0022 (the scorer this generalizes).

---

## Context

The arc built and validated a magnitude-aware tomography scorer and the cross-optic fabric it
needs, all dormant/opt-in. This round turns them on in production — the cutover ADR-0031 deferred.

## Decision (two halves, both measured before commit)

**(A) Flip the localizer to the magnitude scorer.** `assembleAudit` threads each selected leaf's
combined e-value into `localize` as evidence magnitude (ADR-0029), q₀-aware (ADR-0031), on the RAW
accrued scale (ADR-0033). Both the batch pipeline and the incremental session use `assembleAudit`,
so incremental ≡ batch is preserved (both flip together).

**(B) Cross-optic by default.** `DEFAULT_SPRAYPOINT` and `PAPER_SPRAYPOINT` set `crossOptic: true` —
the honest full-support fabric (partner-optic edges at `1/(nTors−1)`), `source_version` → `sp3:`.

## Evidence (measured, not assumed)

Regenerated the coverage matrix and compared floors to the committed (pre-cutover) artifact:

- **Zero regressions.** Every detection/attribution floor held or improved.
- **Improvements:** single-fabric — room attribution at Δ=2 **0%→75%**, shuffle_panel attribution
  floor **3→2**, fiber_bundle attribution at Δ=1 **50%→75%**; Spraypoint — shuffle_panel attribution
  **3→2**; multi-fault — cross_kind attribution **3→2**. (Magnitude is strictly better, not churn.)
- **Clean FDR preserved:** paper-scale clean run still selects **0**; all three reference faults
  (optic/panel/room) still detect and localize **rank-1** on the 960-ToR cross-optic fabric.
- The edges that broke the *binary* scorer (ADR-0028) are now handled by magnitude with floors
  holding/improving — the named revisit condition is met in production.

## Blast radius (bind-tests rewritten — recorded, per §0)

- **traffic-model keystone** — the ADR-0028 omission exception is removed; the fabric now FULLY
  matches the enumerated flow space (the cross-optic edge is emitted at its true `1/(nTors−1)`). The
  keystone is *stronger* (no special-case). Small flow-space fabrics gained `crossOptic: true` to
  match the (cross-optic-inclusive) enumeration; the closed-form table asserts `1/63` and `sp3:`.
- **cross-optic acceptance test** — cross-optic is now the default (assert present + opt-OUT
  `crossOptic:false` restores the sp2 omission); the binary baseline is computed explicitly via
  `localize` (no magnitude), since the pipeline default is now magnitude.
- **epoch (ADR-0018) tests** — pinned to `crossOptic:false`: rerouting optic-3 must cleanly remove
  tor-3's only optic-3 edge; cross-optic is an orthogonal fabric-model concern.
- **C1 saturating-noisy-OR (ADR-0019) test** — pinned to `crossOptic:false`: it binds the saturation
  into the diluted PAIR leaves at extreme δ, a distinct phenomenon from the cross-optic fleet
  saturation whose extreme-δ limit is separately characterized (ADR-0034).
- **Artifacts re-baselined:** `demos/demo.html` and `coverage-matrices/coverage-saturation.{json,md}`
  regenerated; the demo byte-exact and coverage spot-check binds pass on the new values.

## Anti-scope (must-never)

- **The default v1 pipeline fabric (`generateFabric`) is unchanged** as a *fabric* — only the
  Spraypoint production fabrics go cross-optic. But the localizer flips to magnitude **everywhere**,
  so v1-fabric AUDITS do change — *only as measured improvements*, not ranking-equivalence: the
  regenerated matrix shows v1-path attribution gains (fiber_bundle Δ=1 0.5→0.75; covariance_flip
  Δρ=0.2 0.5→0.75, detection held), i.e. a rank-1 culprit improved in ≥1 trial, with **zero
  regressions**. (Default-preservation, ADR-0029, is the small-q₀ *ranking* guarantee; in practice
  the graded evidence does strictly better here, as the Consequences below note.)
- **The high-δ limit ships, bounded (ADR-0034)** — not hidden: a δ≥8 fleet-saturating optic fault is
  not localized to a single optic. The operating band is solved; the limit is pinned by tests.
- **No new tunable knob.** Raw z (ADR-0033), fixed S/κ priors, q₀ from the surface — all as decided.
- **`crossOptic:false` remains supported** — the retired sp2 fabric is one parameter away for any
  analysis that needs the binary-era model.

## Consequences

- The ADR-0028→0035 arc closes: cross-optic localization is **on in production**, validated by
  non-regressing/improving floors and preserved clean FDR, with the high-δ extreme bounded.
- Localization is meaningfully better fleet-wide (room/cross-kind attribution floors improved), not
  just on cross-optic faults — the magnitude scorer's graded evidence helps the existing modes too.
- Remaining open items are the two ADR-0034 future directions (contamination-robust null; upstream
  e-value scaling), unchanged by this round.

## Cold-eye fold-in (fresh-context review of the cutover)

- **Corrected (was a false durable claim):** the anti-scope originally said the magnitude flip is
  "ranking-equivalent on non-cross-optic fabrics." The regenerated matrix proves v1-fabric audits
  *change* — as measured improvements (the rank-1 culprit improved in ≥1 trial), zero regressions.
  Reworded above so a future reader is not misled across an irreversible cutover.
- **Safety pinned:** added a test (`cross-optic-magnitude.test.ts`) exercising the **production
  default (cross-optic) fabric through `runPipeline`** across δ∈{8,16,32}×4 seeds — a saturating
  fault is never localized to a *wrong* optic (the high-δ failure is incomplete, not confidently
  wrong). This was previously documented (ADR-0034) but not test-pinned.
- **Recorded coverage gap (MINOR):** the epoch'd per-evidence-epoch localization (ADR-0018) is still
  only exercised on `crossOptic:false`; the epoch'd × cross-optic-default combination is untested
  (epoch runs require explicit `reroutes`, so it is not a default production path). Left as a noted
  gap, not closed this round.
- Cold-eye independently confirmed: magnitude wiring correct/complete (no spurious throw,
  `selected ⊆ verdicts`), incremental ≡ batch preserved, raw z (no `magnitudeTicks`), and the
  bind-test rewrites faithful (the keystone is strengthened, not weakened).
