# ADR 0009 — Family D (spectral) detector

- **Status:** Accepted
- **Date:** 2026-06-09
- **Decision owner:** Tessera-RNG (post-v1)
- **Supersedes:** —

---

## Context

The audit ran two anytime-valid detector families: **A** (per-signal mean shift, betting e-process)
and **C** (multivariate covariance/magnitude, Safe-Hotelling). Both are *amplitude* tests — they
look at where each tick's value sits, not at temporal *structure*. A failure mode neither sees: a
path-class whose signal develops a **periodic oscillation** (a resonance, a control-loop limit
cycle, a flapping link) with **no change in marginal mean or variance**. Family A sees a zero-mean
oscillation as nothing; Family C sees unchanged per-tick magnitude as nothing. The signature lives
in the *autocorrelation* — a spectral peak — which the engine ships a detector for
(`detectors/spectral`).

## Decision

Add **Family D (spectral)** as a third anytime-valid family (`src/family-d.ts`), wired into the
detector stack and the audit (extends the v1 AC-2 A+C contract):

1. **Observation.** For each signal's pre-whitened residual stream, compute the peak |ACF| over the
   lag range `[minLag, maxLag]` (oscillation periods 3–10) on **non-overlapping** windows of length
   `window = 40`. Non-overlapping is load-bearing: overlapping windows produce autocorrelated peak
   observations that break the e-process supermartingale and inflate the null wealth (observed in
   prototyping — the overlapping variant false-fired on ~10% of clean streams at α = 1%).
2. **e-process.** Each peak feeds the engine's mixture-prior spectral e-detector
   (`evaluateSpectralEDetector`): wealth accrues when the live peak exceeds the calibrated null
   (μ₀, σ₀). Per-signal wealths are **averaged** into the family e-value (valid under dependence, as
   in Family A's multi-signal merge).
3. **Calibration.** `estimateFamilyDNull` pools the clean-residual peak |ACF| across all
   path-classes to fit each signal's (μ₀, σ₀); `betting_delta = 1.0·σ₀`. Signals with fewer than
   `MIN_NULL_PEAKS` windows (calibration shorter than ~8 windows) are **disabled** (silent), never
   dividing by a degenerate spread.
4. **Integration.** `detectAll` takes a `DetectorContext { familyCCell?, familyDCells? }`; Family D
   runs **only when its nulls are supplied**, so A+C-only callers are unchanged and the combined
   verdict e-value generalizes to the mean over whatever detectors are present (2 → unchanged
   `(a+c)/2`; 3 → `(a+c+d)/3`). The pipeline calibrates the nulls and always runs A+C+D.
5. **Telemetry.** A new `oscillationPeriod`/`oscillationAmp` degradation injects a variance-
   preserving periodic component on the affected path-classes' signal (an equal slice of white-noise
   variance is swapped for the oscillation), so mean **and** variance are unchanged — a pure
   spectral shift. The period must not divide 24 (else the per-cell hour-of-day baseline absorbs it).

## Consequences

- **A new anomaly mode, caught.** On a clean fabric, a period-7 oscillation (amp 0.9, marginal mean
  and variance unchanged) injected on the path-classes through a degraded shuffler is caught by
  Family D on **every** affected path-class, while the A+C stack selects **zero** (binding test).
  The same A+C+D stack on a clean window is **FDR-controlled, not zero-false-positive**: at the test
  seed it selects nothing, but across many clean seeds a small fraction show a single false discovery
  — exactly what e-BH permits at q = 0.1 (honest measurement, DISCIPLINES §7). The spectral
  e-process is silent under H₀ and e-BH bounds the fleet false-discovery rate; it does not promise a
  literal zero on every audit.
- **Power needs windows.** The non-overlapping e-process needs ~15 windows (≈600 ticks at
  `window = 40`) for reliable per-path-class firing; at the short tick counts of the existing
  scenarios Family D is near-inert (1–2 windows) but harmless — 0 false selections over 40 clean
  seeds at the 60-tick scenario scale. Recorded honestly: Family D is the long-window detector.
- **New math, mutation-tested.** Under `arch mutate` the only surviving mutant in `family-d.ts` is
  the `M >= 1/α` fire boundary (`>=` → `>`), the same measure-zero equality benign across all
  families. The telemetry oscillation injection is bound by the end-to-end catch test, and a
  degenerate-σ₀ test binds the NaN-safety guards (a cold-eye review found and these closed an
  overflow→NaN path that could have poisoned the fleet surface).
- **N5 intact.** Only the engine's public `detectors/spectral` surface is consumed.
- **Honest limits.** Window/lag range are fixed defaults (not per-signal tuned); the per-signal null
  is global (not per-cell); detection power is window-count-limited; a degenerate calibration null
  (σ₀ < `MIN_NULL_STD`) disables that signal rather than trusting an explosive standardization, and
  every signal's wealth is capped to a finite ceiling; Family E (conformal) was **not** added (it is
  Mahalanobis-based, overlapping Family C — a weaker complement than the distinct spectral mode). All
  recorded.
