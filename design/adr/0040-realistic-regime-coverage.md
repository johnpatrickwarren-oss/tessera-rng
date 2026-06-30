# ADR 0040 — Realistic-regime coverage: robust calibration's win, published

- **Status:** ACCEPTED — BUILT. The coverage matrix now carries a **realistic-regime FDR** section:
  on a calibration history carrying the clustered aberrations real telemetry always has, the mean/sd
  null false-positives (434 over 4 trials) where robust calibration stays clean (0). Converts the
  ADR-0039 one-sided synthetic *cost* into the *win* robust earns on realistic data. 240 tests, gate PASS.
- **Date:** 2026-06-29
- **Decision owner:** Tessera-RNG (the ADR-0039 follow-up)
- **Relates to:** ADR-0039 (robust calibration; the recorded one-sided cost this resolves), the
  telemetry-realism test network (`tools/realistic-telemetry.ts`), `design/research/...characterization.md`.

---

## Context

ADR-0039 made robust calibration the default and, per the cold-eye, recorded honestly that on the
**aberration-free** synthetic coverage it pays a one-sided cost (4 detection floors, incl a Family-C
doubling) — robust earns none of its benefit because the synthetic has no aberrations to be robust
against. The recorded resolution: measure the regime that matters.

## Decision

Add a **realistic-regime FDR** measurement to the coverage matrix (`tools/coverage.ts`
`realisticRegime`): build the calibration null from an **aberration-laden** ~2-week history (the test
network's clustered-burst enrichment), then measure clean-fabric false selections on a clean
week-spanning live window, for mean/sd vs robust calibration.

**Result (published in `coverage-saturation.{json,md}`):**

| calibration | false selections on clean live (4 trials) |
|---|---|
| mean/sd (pre-ADR-0039) | **434** — bursts absorbed into the null, corrupting it |
| robust (ADR-0039 default) | **0** — bursts tossed, FDR controlled |

So the picture is complete: robust costs a little detection sensitivity on aberration-free data (the
ADR-0039 floors) and *prevents catastrophic false-positive corruption* on aberration-laden data — the
regime real telemetry lives in.

## Honest caveats (must carry)

- **Aberration intensity is a MODELED parameter** (real magnitudes are uncalibrated — Tier-3). The
  measurement uses a strong-but-plausible intensity so the corruption is **reliable across seeds, not
  seed-cherry-picked**; at weak intensities it is seed-dependent (a burst must land in a queried cell).
  **What is invariant is robust's 0** — the *count* (434) scales with the modeled intensity; the
  qualitative win does not.
- **The aberration model is crude** (uniform additive across signals — so the +mag spike is realistic
  for p99 but not for near-zero loss). Per-metric, heavy-tailed aberration shapes remain a recorded
  realism gap (`telemetry-temporal-characterization.md`), as do retransmit/flow-completion proxies.
- This stays **Tier-2.5**: real *temporal* structure (the test network), synthetic *spatial* model,
  no real RNG telemetry (the unfilled Tier-3 in `VALIDATION.md`).

## Consequences

- The coverage artifact no longer reads as "robust regressed the floors" without context: it now
  publishes both sides — the clean-data cost AND the realistic-data win — so a reader sees the tradeoff
  whole, per instrumented-caveat (§7).
- Recorded follow-ups unchanged: per-metric heavy-tailed aberration shapes; AR-model robustness; the
  4-week null for real incident exclusion; the common-mode-vs-robust-null re-open (ADR-0039).
