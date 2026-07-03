# ADR 0045 — Family D PIT null: rank-Gaussianize the peak statistic; the Gaussian null was measurably invalid

- **Status:** ACCEPTED (behavioral change, **default ON** via the production calibrator
  `estimateFamilyDNull`; raw Gaussian path retained for unit fixtures / as the recorded-defect
  control). Surfaced by the ADR-0044 filtration investigation's own evidence experiment.
- **Date:** 2026-07-02
- **Decision owner:** Tessera-RNG
- **Relates to:** ADR-0009 (Family D), ADR-0044 (filtration boundary), ADR-0039 (the precedent:
  validity beats efficiency for a DEFAULT), `test/filtration-boundary.test.ts`,
  `test/family-d.test.ts`.

---

## The defect (measured, held-out)

The engine's spectral e-detector bets `L = exp(r·u − r²/2)` with `u = (peak − μ₀)/σ₀` — the exact
Gaussian likelihood ratio, whose e-value property `E[L] = 1` holds **iff u ~ N(0,1)** under the
null. Tessera feeds it the peak-|ACF| statistic (max of 8 |correlations| over a 40-tick window),
which is intrinsically right-skewed even on perfectly Gaussian residuals — this is a property of
the statistic, not of telemetry realism. Measured (20 000 held-out clean windows, seeded):

- peak|ACF| null: mean 0.250, sd 0.072, **skew 0.46**;
- **E[L] = 1.121 ± 0.017 per clean window** (production feed path cross-checked identical);
- anytime false-alarm rate P(sup M ≥ 1/α_D) over long clean horizons: **1.05–1.35% vs the
  claimed ≤ 1%** (Ville) — inflated because the exponential tilt θ* solving E[e^{θz}] = 1 sits
  below 1 when E[e^z] > 1. Bounded (log-wealth drift is still −r²/2 < 0), but the anytime-valid
  claim — the product's core claim — was measurably false for Family D.

Why never seen: ADR-0009's clean controls were 60-tick (1-window) scenarios where compounding
cannot express; the ≈1.3% only emerges at 50+ windows.

## The fix — validity from ranks, not from a distributional fit

`estimateFamilyDNull` now ships each enabled cell with its **sorted calibration peaks**
(`pit_sorted_peaks`), and the single shared update path (`updateWithPeak`, used by batch AND the
streaming session — the ADR-0027 byte-equality is one code path) bets on the PIT-Gaussianized
statistic:

    u = Φ⁻¹( count(cal ≤ peak) / (n+1) ),  clamped to [1/(n+1), n/(n+1)]

fed to the engine against an exact (0, 1) null with `betting_delta = deltaSigma`. Under
exchangeability of the live window with the calibration windows, the rank is uniform on its
n+1 cells and **E[L] ≤ 1 exactly — no distributional assumption at all** (the missing right-tail
cell makes it strictly conservative). This is the conformal-style construction; it also
future-proofs the null against ANY residual marginal (a step toward the recorded heavy-tail gap).
The engine is consumed unchanged (N5): tessera owns the statistic and the params it feeds.

Measured (held-out): **E[L] = 1.018 ± 0.010** (≈1, MC error); anytime false-alarm **0.55–0.63%
≤ 1%** at 100–200 clean windows; power at the published floor amplitude 0.9 **unchanged (99%,
fires ~0.7 windows later)**; sub-floor amplitude 0.6 power 26% → 20%.

## Cost, published (instrumented-caveat)

Coverage regenerated: the **oscillation floor stays 0.9/0.9** — the only movement is the
sub-floor knee amp 0.7: detection/attribution 75% → **25%**. That lost 50% was purchased with an
invalid null (the raw path's over-payment); the honest detector does not get to keep it.
`demos/demo.html` regenerated (oscillation-scenario wealth values changed).

Recorded narrowings:
- **Thin calibration caps single-window evidence** at Φ⁻¹(n/(n+1)) (n = pooled calibration
  peaks): at MIN_NULL_PEAKS = 8 that is u ≤ 1.22 — Family D stays valid but slow on tiny
  calibrations. Power now scales with calibration depth; the default pipeline pools hundreds of
  peaks (u_max ≈ 2.9+).
- The exchangeability argument treats calibration peaks as identically distributed with the live
  peak and independent across windows; strong CROSS-LEAF dependence in the pooled calibration
  sample could distort ranks (same estimation-caveat class as the plug-in (μ₀, σ₀) it replaces,
  and as ADR-0006 min-samples). The degenerate-null gate (MIN_NULL_STD on raw peaks) stays — a
  tied/degenerate calibration sample must disable the signal, not rank against it.
- Ties rank conservatively-upward (`count ≤`); peaks are continuous so this is measure-zero in
  practice; recorded.

## Alternatives rejected

- **Empirical lift constant** (divide L by ĉ = mean calibration multiple): restores E[L] ≤ 1 on
  average via a plug-in MGF estimate — weaker guarantee (average-calibrated, not
  rank-exact), same plumbing cost. PIT dominates.
- **Raise/lower deltaSigma or Z-style caps**: shrinks but does not remove E[L] > 1; the model
  class is wrong, not the knob.
- **Fix inside the engine**: the engine's detector is correct *for the Gaussian null it
  documents*; the mismatch is tessera feeding it a non-Gaussian statistic. Consumption-side fix
  is the right layer (N5).

## Binding tests

- `family-d.test.ts`: production calibrator ships sorted PIT peaks (kills the drop-the-field
  mutant); per-window E[L] on 12 000 held-out clean windows — raw path pinned in the defect band
  (> 1.05), PIT path < 1.05 (kills a silent revert-to-raw mutant).
- `filtration-boundary.test.ts` (2)/(2b): the defect and the fix, through the production feed
  path (`feedSpectralWindow`).
- All prior Family D behavior tests pass unchanged (silent-under-null, fires-on-oscillation,
  A/C-blind oscillation e2e, degenerate-null disable, session byte-equality keystones).
