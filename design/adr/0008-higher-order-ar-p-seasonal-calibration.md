# ADR 0008 — Higher-order AR(p) calibration (and why seasonal is subsumed)

- **Status:** Accepted
- **Date:** 2026-06-09
- **Decision owner:** Tessera-RNG (post-v1)
- **Supersedes:** extends ADR-0004

---

## Context

ADR-0004 added a per-signal **AR(1)** temporal substrate: detectors assume near-iid input, but
real signals are autocorrelated, so calibration pre-whitens each signal's residual stream with a
single coefficient φ̂ before detection (otherwise positive serial correlation inflates the
e-process wealth under the null and erodes FDR control). AR(1) only removes lag-1 memory. A signal
with genuine AR(2)/AR(3) structure leaves **higher-lag** autocorrelation after AR(1) whitening —
the FDR leak ADR-0004 closed at lag 1 reopens at lag ≥ 2. The engine ships the general machinery
(`detectors/ar-p` `fitArP`, with AIC/BIC order selection).

## Decision

Generalize the temporal substrate from AR(1) to **AR(p)**, order-selected per signal:

1. **`CalibrationSubstrate.arPhi: number[]` → `ar: ArModel[]`**, where `ArModel = { phi: number[];
   innovationSd: number }`. Order `p` (the length of `phi`) is chosen by `fitArP` via **BIC**, capped
   at `DEFAULT_AR_PMAX = 6`. A near-white signal selects a low order with φ̂ ≈ 0 (≈ no whitening —
   `fitArP` iterates p ∈ [1, p_max] and returns p ≥ 1, not 0); an AR(k) signal is fit at order k.
2. **Estimation** concatenates each signal's de-meaned residual columns across all path-class
   streams into one long series and calls `fitArP(col, 0, { p_max, ic: 'bic' })`. This pools the
   estimate across path-classes exactly as the AR(1) substrate did (φ is a property of the signal
   type). **BIC, not AIC:** the concatenated series is very long (N ≈ 10⁴–10⁵); AIC's fixed +2p
   penalty is not order-consistent at that N and over-selects spurious high orders off the
   cross-stream boundaries (measured: AIC picked orders [4,1,1,1,3] on default AR(1) telemetry, the
   extra coefficients ≈ 0). BIC's `log(N)·p` penalty stays parsimonious — it picks [1,1,1,1,1] on the
   same data — and still recovers true higher orders (AR(2) → p = 2). The few boundaries contribute
   mean-zero noise that perturbs only the high-lag tail; the coefficients are recovered cleanly.
3. **Pre-whitening** uses the engine's multi-lag `prewhitenAr(col, 0, phi)` and rescales by the
   fitted `innovationSd = √(sigma2_innovation)` to restore unit innovation variance. This degrades
   to the ADR-0004 AR(1) case: on AR(1) telemetry BIC selects p = 1, φ̂₁ ≈ the true φ, and
   `innovationSd ≈ √(1−φ²)` — ≈ the old rescaling (an *empirical* innovation sd, ~1–2% off the
   analytic √(1−φ²), arguably more accurate finite-sample). Note this means only the **raw
   telemetry** is byte-identical to v1; the standardized **residuals** differ slightly from ADR-0004
   because the estimator changed (the pipeline outcomes — selections, ranks — are unchanged).
4. **Telemetry** gains an optional per-signal `arCoeffs` (AR(p) noise via a unit-variance recursion);
   absent ⇒ the v1 AR(1) stream **byte-for-byte identical** (the default path keeps the √(1−φ²)
   unit-variance scaling, bound by a test).

### Seasonal is deliberately NOT wired (anti-scope)

The engine's `detectors/seasonal` (`detectDominantPeriod` / `seasonalMeans`) decomposes a series by
its dominant period. In Tessera-RNG the **per-cell calibration already removes seasonality at the
level**: cells are keyed by hour-of-day × day-of-week, so the diurnal (period-24) and weekly
(period-168) means are exactly the per-cell baselines that `deMean` subtracts. Adding a seasonal
decomposition would rediscover and re-subtract structure the per-cell substrate has already removed
— redundant machinery. Recorded here rather than silently absorbed (DISCIPLINES §2): the meaningful
extension was the order of the *residual* AR model, which the per-cell baseline does not touch.

## Consequences

- **Higher-order memory whitened.** On AR(2) telemetry (φ = [0.5, 0.3]) the substrate selects order
  2 and recovers φ̂ ≈ [0.50, 0.30]; the pre-whitened residual has lag-1 **and** lag-2 autocorrelation
  ≈ 0. An AR(1)-capped model fits a single φ̂ ≈ 0.71 and **leaves lag-2 autocorrelation ≈ 0.18** — the
  anti-self-confirming control proving the order selection is load-bearing.
- **FDR preserved under AR(2).** A clean AR(2) fabric still selects nothing; a real degradation still
  fires on the affected path-classes after AR(p) whitening.
- **v1 telemetry unchanged.** Default telemetry is byte-for-byte identical; all existing
  scenarios/replay pass (95→100 tests green). On AR(1) telemetry BIC selects p = 1 for every signal,
  so the substrate matches ADR-0004 (the standardized residuals shift only at the ~1% scale of the
  empirical-vs-analytic innovation sd; selections and ranks are unchanged).
- **New math, mutation-tested.** `calibration.ts` + `telemetry.ts` new paths score **92%** (12/13)
  under `arch mutate`; the lone survivor is the 1-tick `t >= start` boundary of the covariance-shift
  guard (`tickL`) — a measure-one-tick equality, benign like the Family C fire boundary.
- **Honest limits.** BIC (chosen over AIC for our large N); order capped at 6; the concatenation
  pools across path-class boundaries (small high-lag noise; coefficients recovered cleanly); φ is
  per-signal-global, not per-cell; the opt-in telemetry `arCoeffs` must be stationary (no guard — a
  non-stationary set explodes numerically, though per-cell sd keeps the residuals finite). Recorded.
