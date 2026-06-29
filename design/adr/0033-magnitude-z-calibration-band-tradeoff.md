# ADR 0033 — Magnitude z-calibration is a band tradeoff, not a fix

- **Status:** ACCEPTED — built opt-in (`magnitudeTicks`), measured. **Finding: calibrating z to the
  per-tick scale does NOT uniformly improve recovery — it shifts the cross-optic recovery band
  upward in δ.** The **raw (accrued) scale is retained as the operational default** because it
  recovers the low-δ band the system exists to catch; calibration is available opt-in. 223 tests
  green, gate PASS. The magnitude scorer stays dormant (ADR-0031 anti-scope).
- **Date:** 2026-06-29
- **Decision owner:** Tessera-RNG (post-v1; discharges the ADR-0031 z-scale prerequisite)
- **Relates to:** ADR-0031 (the cold-eye z-scale caveat this resolves), ADR-0029 (the soft-evidence
  LR), the README founding motivation ("by the time a threshold alarm fires, the margin is spent").

---

## Context

The ADR-0031 cold-eye found the pipeline feeds the **multi-tick accrued** combined e-value, so
`ln E ≈ T·θ²/2` and `z = √(2 ln E) ≈ θ·√T` (≈ 7.7θ at T=60) — not the per-tick shift θ the
ADR-0029 D1 identity implies. Consequence: with `μ = S·L ~ O(1–4)` but `z ~ O(10–40)`, the
soft-evidence term `μz` dwarfs the falsification term `−μ²/2`, so `μz − μ²/2` is not a calibrated
LR. It was recorded as a prerequisite for the production cutover. This round discharges it.

## Decision

Add opt-in z-calibration: `magnitudeZ(E, ticks)` divides `ln E` by the accrual window, so
`z = √(2·max(ln E,0)/ticks) ≈ θ` (the per-tick shift, on μ's O(1) scale). `LocalizeOpts.magnitudeTicks`
threads it; absent/1 ⇒ the raw single-observation z (the D1 identity, unchanged for unit callers).

**Then MEASURE it end-to-end** before claiming it as the cutover scale — because LR-calibration is a
theory argument, and the scorer's actual job is RANKING (N1).

## Finding (measured — `runPipeline`, cross-optic fabric, cross-kind optic-3+panel-7, 4 seeds)

| δ | raw (accrued) z recovers | calibrated z recovers |
|---|---|---|
| 3, 4 | **4/4** | 0/4 |
| 6 | 4/4 | 4/4 |
| 8 | 2/4 | 3/4 |
| 16 | 0/4 | 0/4 |
| 32 | 0/4 | **4/4** |

**Calibration is a BAND TRADEOFF, not an improvement.** Smaller calibrated z lets the `−μ²/2`
falsification term carry real weight: at low δ that **over-falsifies** the optic's diluted
cross-optic members (z is tiny, the penalty dominates) and the optic is lost; at very high δ it
**properly separates** the saturated fleet that raw z's evidence-dominated score cannot. The two
scales are the principled endpoints — neither dominates.

## Decision rationale: keep RAW (accrued) z as the operational default

The system's founding purpose (README, ADR-0001) is to catch **subtle** faults early — "by the time
a threshold alarm fires, the path-margin is already spent." That is the **low-δ band**, exactly where
raw z recovers and calibrated z does not. A δ=32 optic fault (where calibration wins) is a klaxon the
fleet already feels. So the operationally favorable scale is the raw accrued one — the cold-eye's
"miscalibration" is, for ranking in the band that matters, a feature.

This **reframes, not contradicts, the cold-eye**: z is a monotone RANKING proxy (N1), and which
monotone scale ranks best is an empirical operating-point question, not the LR-calibration question.
Calibration stays available (`magnitudeTicks`) for high-δ-focused analysis.

## Anti-scope (must-never)

- **No fitted partial-√T knob.** The two scales (raw, per-tick) are the principled endpoints; a
  tuned intermediate exponent would be exactly the kind of fitted knob the project rejects (cf. the
  fixed-form S and κ priors). If a future regime needs the middle, it goes through evidence-gated ADR.
- **No pipeline flip.** The scorer stays dormant (ADR-0031); this round only settles which scale the
  eventual cutover should use, and records why.
- **No claim that calibration "fixes" the high-δ saturation.** δ=16 still fails both; the recovery
  the calibrated scale buys is the δ≳32 extreme, not the δ=8–16 gap.

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test (`test/z-calibration.test.ts`) |
|---|---|
| `magnitudeZ(E, ticks)` recovers the per-tick θ | `z(e^{T·θ²/2}, T) ≈ θ`; `ticks=1` is the D1 identity; raw z is √T-inflated vs calibrated |
| The scales are a band tradeoff (the core finding) | raw recovers MORE at low δ (=4); calibrated recovers MORE at high δ (=32) — both pinned, neither dominates |
| ticks=1 default preserves prior behavior | the ADR-0029/0031 magnitude + cross-optic fixtures are unchanged (no `magnitudeTicks` passed) |

## Consequences

- The ADR-0031 z-scale prerequisite is discharged with a recorded decision: **the cutover uses raw
  accrued z**, and the reason (low-δ operating band) is on the record.
- The magnitude scorer remains opt-in/dormant; nothing in the pipeline, demo, replay, coverage,
  hashes, or floors changes.
- Remaining cutover prerequisites (unchanged): make the cross-optic fabric the default + flip
  `runPipeline` to the magnitude scorer + the high-δ saturation question (ADR-0031). The scale
  question is now settled.
