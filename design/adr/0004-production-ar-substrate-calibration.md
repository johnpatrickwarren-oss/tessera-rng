# ADR 0004 — Production-AR substrate calibration (per-signal AR(1) pre-whitening)

- **Status:** Accepted
- **Date:** 2026-06-09
- **Decision owner:** Tessera-RNG (post-v1)
- **Supersedes:** —

---

## Context

v1 calibration removed the per-cell **level** smear (hour-of-day × day-of-week × traffic-class
mean/sd) but assumed the resulting residual stream was iid. Real network signals are
**temporally autocorrelated** — consecutive ticks are correlated — which the anytime-valid
detectors do not assume away. Feeding autocorrelated residuals into the betting / Safe-Hotelling
e-processes inflates their wealth under the null (positive serial correlation looks like a
persistent shift), eroding the e-BH FDR guarantee. Tessera referenced a "production-AR substrate
calibrator" for exactly this; the engine ships the AR primitives (`detectors/ar-p`).

v1 telemetry emitted iid Gaussian noise, so the gap was latent. Post-v1 telemetry now emits
**AR(1)** noise per signal (a fixed per-signal φ), making the autocorrelation real and the
calibrator load-bearing.

## Decision

The calibration substrate is extended from per-cell `(mean, sd)` to **`(cells, arPhi)`**:

1. **Level** — per-cell `(mean, sd)` as before (the diurnal/class smear).
2. **Temporal** — a per-signal AR(1) coefficient `φ̂`, estimated as the pooled lag-1
   autocovariance ratio `γ̂₁/γ̂₀` over the de-meaned calibration residuals (reusing the engine's
   `sampleAutocovariance`), clamped to `[-0.95, 0.95]`.

Standardization is now two stages: per-cell de-mean/sd, then **AR(1) pre-whitening** of each
signal column via the engine's `prewhitenAr` (`w_t = r_t − φ·r_{t-1}`), rescaled by
`1/√(1−φ²)` to restore unit innovation variance. The whitened residuals are near-iid, so the
detectors' assumptions hold and FDR control is restored under autocorrelated telemetry.

φ is estimated **per-signal, pooled across path-classes** (a property of the signal type), not
per-cell — cells partition by hour-of-day and are not temporally contiguous, so AR estimation
belongs on the contiguous per-path-class stream, orthogonal to the per-cell level model.

## Consequences

- Detectors see near-iid input; the clean-fabric false-positive rate stays ~0 even though the
  raw telemetry is now autocorrelated (verified by the clean scenario/pipeline tests continuing
  to select nothing).
- A genuine step degradation survives pre-whitening, attenuated by `√((1−φ)/(1+φ))` but clearly
  positive — detection is preserved (tested).
- The engine is reused at its public AR surface (`sampleAutocovariance`, `prewhitenAr`); no
  internals are forked (N5 intact).
- Still not modeled: higher-order AR(p)/seasonal structure (the engine's `fitArP`/`seasonal`
  surfaces) and cross-signal covariance — recorded as future work in STATE.md.
