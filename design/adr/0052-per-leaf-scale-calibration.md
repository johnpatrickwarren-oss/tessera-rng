# ADR 0052 — Per-leaf scale calibration (shrunk, opt-in): absorb static ς instead of gating on it

- **Status:** ACCEPTED (boundary shift measured; both predictions confirmed — the drift one
  dramatically; consequences below)
- **Date:** 2026-07-27
- **Decision owner:** Tessera-RNG
- **Relates to:** ADR-0050 (the disease: shared-cell calibration cannot represent per-leaf
  scale; selection validity dies at realized ς ≈ 0.06–0.12), ADR-0051 (the gate; supplies the
  ς̂²/raw² decomposition this remedy reuses), ADR-0006 (the precedent: per-cell sd from too few
  samples MANUFACTURES false positives — the same trap this design must not walk into at the
  leaf level), ADR-0027 (batch calibration; session parity via the substrate).
- **Files:** `src/calibration.ts` (the knob), `test/per-leaf-scale.test.ts`,
  `tools/heterogeneity.ts` (`NullRunOpts.perLeafScale` threading),
  `tools/per-leaf-scale.ts` → `coverage-matrices/per-leaf-scale.{json,md}`.

---

## Problem

ADR-0050's wall is *representational*: calibration cells are `(hour × dow × traffic-class)` —
per-leaf scale has nowhere to live, so any real dispersion lands in the residuals and e-BH
false-selects a ς-determined fraction of the fleet. The gate (ADR-0051) *detects* the condition;
this ADR *removes* the static part of it.

The naive fix — divide each leaf's residuals by its own estimated calibration scale — walks
straight into ADR-0006's trap at the leaf level: a per-signal MAD over T = 60 ticks carries
≈ 0.107 log-noise, ABOVE the 0.06 boundary; the correction would manufacture the very
dispersion it removes. Any per-leaf design must inject less noise than it absorbs, including
at ς = 0 where there is nothing to absorb.

## Decision

### 1. Shrunk per-leaf scale (`CalibrationOptions.perLeafScale`, default OFF)

Second calibration pass (batch, on the same clean window): standardize the calibration series
with the substrate as built (cells + AR), then per leaf compute the pooled log-scale
`ℓ_i = (1/p)·Σ_j log s_{i,j}` — the ADR-0051 estimator's quantity, the σ_pc model's sufficient
statistic (pooling divides sampling variance by ≈ p). The stored correction is **shrunk toward
the fleet**:

    leafScale_i = exp( λ · (ℓ_i − median ℓ) ),   λ = max(0, raw² − floor) / raw²  = ς̂² / raw²

with `raw` and `floor` exactly as in ADR-0051 (robust sd of {ℓ_i}; sampling floor
`1/(2(T−1)p)`). Properties, by construction:

- **ς = 0 injects ≈ nothing:** raw ≈ floor ⇒ λ ≈ 0 ⇒ every leafScale ≈ 1. The clean-fabric
  FP = 0 result must survive the flag (AC-2) — this is the ADR-0006 lesson, structurally.
- **Large ς corrects ≈ fully:** at ς = 0.2, λ ≈ 0.96; residual dispersion after correction is
  ≈ √λ·floor ≈ 0.04 — back under the measured boundary. (Exactly √λ·floor, not λ·floor —
  numerically indistinguishable at these values; cold-eye finding 8.)
- **Median-centered:** the typical leaf is untouched; the correction re-scales relative to the
  fleet, never re-scales the fleet.
- Scalar per leaf (the σ_pc generative model). Per-signal scales are DEFERRED — they cut the
  pooling factor p and re-open the noise-injection question; recorded, not built.

`standardizeStream` and `standardizeTick` divide by `leafScale.get(pc) ?? 1` at the same code
point — the substrate carries the map, so batch and incremental stay in lockstep by
construction (ADR-0027 property; AC-4). Flag absent ⇒ map absent ⇒ no division ⇒ byte-identity
(AC-1).

### 2. Recorded interaction with the gate (ADR-0051)

With `perLeafScale` ON, the calibration residuals the gate estimates from are the CORRECTED
ones — and the correction was fit on the same window, so the gate reads ≈ 0 and passes
**in-sample by construction**. That is not laundering (the detector really does see corrected
residuals) but it narrows what the gate protects against: under per-leaf calibration the live
threat is **drift** — σ assignment moving between calibration and live windows, which ADR-0050
measured as irrelevant under shared calibration but which per-leaf correction makes real
(a leaf corrected by its OLD scale is now mis-scaled by the movement).

**CORRECTED (cold-eye finding 2): under this architecture the gate CANNOT detect staleness at
all.** `shrunkLeafScales` refits on every rebuild, so a re-calibration's gate reads freshly
zeroed residuals whatever happened to the assignment in between (demonstrated: a COMPLETE
σ-reassignment between windows reads ς̂ = 0.000, passing, on both windows). Stale-correction
dispersion exists only in the LIVE window between calibrations, and nothing shipped estimates
the live window (anti-scope). As merged, the drift cliff measured below has **no detector**;
the only guard is the operational posture — a re-calibration cadence faster than the fabric's
σ-assignment drift, "fresh calibration window only" — until the runtime drift monitor (future
ADR, the GPU sibling's calibration-monitor analog) exists.

### 3. The measured boundary shift (`tools/per-leaf-scale.ts`)

The ADR-0050 H and D axes re-run with the flag ON, beside the OFF rows (same seeds — the OFF
rows must reproduce ADR-0050 exactly):

- **H (static ς):** prediction — the boundary moves far out (static ς absorbed; false
  selections ≈ 0 through ς = 0.3); the ς = 0 row must stay 0 (noise-injection regression
  guard).
- **D (drift at ς = 0.2):** prediction — drift NOW matters (the ADR-0050 no-effect result
  REVERSES under per-leaf calibration): driftMix 0 ≈ clean, driftMix 1 re-breaks selection.
  Whatever is measured is published, including if the prediction is wrong (ADR-0020
  precedent).

## Acceptance criteria

- **AC-1 (byte-identity):** flag absent ⇒ substrate has no `leafScale`, standardization
  byte-identical (existing suite + explicit test).
- **AC-2 (no noise injection at ς = 0):** with the flag ON on clean fabrics, λ ≈ 0, every
  leafScale within e^±0.01 of 1, and null-run false selections stay 0 across the ADR-0050
  seeds. A mutant that skips the shrinkage (λ = 1) fails this.
- **AC-3 (absorption):** with the flag ON at ς = 0.2, per-leaf residual dispersion (measured
  by the independent sd-ratio estimator) drops to ≤ 2× the sampling floor, and null-run false
  selections collapse relative to the OFF row.
- **AC-4 (session parity):** `standardizeTick` over a `perLeafScale` substrate reproduces
  `standardizeStream` byte-for-byte.
- **AC-5 (envelope honesty):** OFF rows reproduce ADR-0050's published cells exactly (same
  seeds — the cross-artifact anchor); every prediction above is published against what was
  measured; truncations logged.

## Anti-scope

- **No default flip** — opt-in; cutover is its own decision with real-consumer evidence.
- **No per-signal leaf scales** (noise-injection question re-opens; recorded above).
- **No runtime drift monitor** (the recorded production companion; future ADR).
- **No gate semantics change** — the ADR-0051 field is unchanged; the in-sample narrowing is
  RECORDED here, not patched there.
- **No re-run of the N/L axes under the flag** (scale ramp cost; H and D are where the
  mechanism lives — recorded narrowing).

## Prescription → AC coverage

| Prescription | Bound by |
|---|---|
| Shrinkage λ = ς̂²/raw², median-centered, pooled scalar | AC-2 (λ≈0 end) + AC-3 (λ≈1 end) |
| No injection at ς = 0 (λ = 1 mutant killed) | AC-2 |
| Substrate-carried map; single division point | AC-1, AC-4 |
| OFF rows ≡ ADR-0050 cells | AC-5 |
| D-axis reversal prediction published as measured | AC-5 |

## Consequences — the measured boundary shift (AC-5)

Artifact: `coverage-matrices/per-leaf-scale.{json,md}` (n = 8/cell; OFF rows anchor-bound to
the ADR-0050 cells by test).

- **H — static dispersion is absorbed COMPLETELY.** With the flag ON: **0.00 false selections
  at every ς through 0.5** (OFF: 5.25 / 15.5 / 18.9 / 19 at ς = 0.1/0.2/0.3/0.5), max 0
  across all 48 runs. The ς = 0 row stays 0 and injected dispersion stays < 0.025
  (the shrinkage doing its job — AC-2). Against the STATIC mechanism, the remedy is total at
  this operating point.
- **D — the ADR-0050 no-effect result REVERSES, harder than predicted.** driftMix 0 → 0.00
  (the correction is exact for the assignment it was fit on), but full drift → **25.25 false
  selections — WORSE than no correction at all (9.88 at that cell)**. TWO mechanisms, both
  recorded (the second per cold-eye finding 3, which showed compounding alone cannot reach
  25.25 — the OFF curve saturates at ~19 even at realized ς 0.588): (i) **compounding** — a
  stale correction divides by the WRONG scale, ≈ ς√2 effective dispersion (measured ≈ 0.26 at
  the m=1 cell); (ii) **a tightened null** — with the flag ON, the Family C/D nulls are fit on
  corrected ≈ clean calibration residuals (dispersion 0.000 vs ≈ 0.18 OFF), so dispersed live
  residuals hit a TIGHT null where every OFF cell's null was fattened by the same dispersion —
  this is what pushes past the OFF saturation ceiling. Comparison honesty: 9.88 is the OFF
  count at that cell's realized ς 0.173 (the mildest draw on the axis); the
  realized-ς-matched OFF reference is ≈ 15.5 (ς 0.235) — the reversal holds against either.
  Partial drift interpolates (0.25 → 0.25, 0.5 → 3.13).
- **The recorded consequence:** `perLeafScale` is not a free win — it TRADES the static wall
  for a drift cliff that is steeper than the disease at full drift, and (finding-2 correction,
  §2) that cliff currently has **no detector**: the gate refits with every re-calibration and
  cannot see staleness. Production use therefore REQUIRES the operational guard — a
  re-calibration cadence faster than the fabric's σ-assignment drift ("fresh calibration
  window only") — until the runtime drift monitor exists (future ADR). The ADR-0051 gate
  stays necessary for what it CAN see: dispersion present in the calibration window itself.

Follow-up recorded, not built: the runtime drift monitor; per-signal leaf scales; N/L axes
under the flag; default-flip decision (needs the drift companion first — the D cliff makes a
naive default flip strictly dangerous on drifting fabrics).
