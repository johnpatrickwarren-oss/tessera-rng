# ADR 0039 — Contamination-robust calibration + deep-null rebaseline

- **Status:** ACCEPTED — BUILT. The per-cell null is now estimated **robustly** (median/MAD/engine
  `robustLocation`) by DEFAULT, the calibration window is **decoupled** from the live window
  (`calibrationTicks`), and the coverage matrix is **rebaselined at a ~2-week robust null**. Closes
  the telemetry-realism gap (a mean/sd null absorbs the clustered aberrations real history always
  carries). 240 tests green, gate PASS.
- **Date:** 2026-06-29
- **Decision owner:** Tessera-RNG (post-v1; the telemetry-realism follow-up the test network motivated)
- **Relates to:** the telemetry-realism test network + `design/research/telemetry-temporal-characterization.md`
  (the evidence), ADR-0006 (the min-cell-sample fallback this extends), ADR-0036 (the engine
  `robustLocation` consumption this reuses), ADR-0001 (engine never forked).

---

## Context

The "robust RNG test network" demonstrated two things: our per-cell calibration handles realistic
weekly seasonality, but its **mean/sd estimator is not robust** — the clustered aberrations that
always occur in real telemetry are *absorbed* into the null, corrupting it (34 false positives on
clean data from contaminated history). The research grounded a realistic null at **~4 weeks** and
flagged that null-building must be robust. Both fixes were named: a robust estimator + a deep null.

## Decision

1. **Robust per-cell calibration, DEFAULT ON.** Each cell's (center, scale) is estimated with the
   engine's `robustLocation` (Tukey biweight, 95%-efficient, redescending — CONSUMED, not rebuilt) for
   the center and **MAD×1.4826** for the scale, instead of mean/sd. Clustered aberrations are tossed,
   not absorbed. `CalibrationOptions.robust` / `PipelineParams.robustCalibration` (default true);
   `false` opts out to the pre-robust null.
2. **Robust min-cell-samples = 50** (vs 30 for mean/sd). MAD is ~37% less efficient than the sample
   sd, so a robust per-cell scale needs more samples; below 50 a cell borrows the (stable, large-n)
   robust pooled baseline. Keeps clean-fabric FDR at 0 even at thin windows.
3. **Decouple the calibration (null) window from the live window** (`PipelineParams.calibrationTicks`,
   default = `telemetry.ticks`). Real systems calibrate on a long history and detect on a short
   window; and robust per-cell estimation needs a deep enough null for full resolution.
4. **Rebaseline the coverage matrix at a ~2-week robust null** (`CALIB_TICKS=336`, n≥50/cell, decoupled
   from the live windows). 2 weeks suffices for the aberration-free synthetic (no incidents to exclude);
   4 weeks is for real incident exclusion.

## Evidence (measured)

- **Gap closed:** aberration-contaminated 2-week history, clean week-spanning live — mean/sd **32**
  false positives, **robust 0**. (`test/robust-calibration.test.ts`.)
- **Unbiased on clean:** median per-cell scale ratio robust/(mean·sd) = **1.000**; clean-fabric FDR
  stays **0** under robust calibration even at the thin window (the robust min-samples absorbs MAD scatter).
- **Rebaselined floors (robust + 2-week null vs the old mean/sd + 60-tick):** **16 floor entries
  unchanged, clean FDR 0**, paper-scale clean run still selects 0. **Cost: 2 detection floors +1 grid
  step** (passive_shuffler, room, both Δ=1→2) — the MAD-efficiency sensitivity cost on the WEAKEST
  faults. On real telemetry (which carries aberrations) robust is strictly better; on clean synthetic
  it costs a hair of sensitivity on the weakest faults. A fair price, recorded.

## Anti-scope (must-never)

- **Not forking the engine** — `robustLocation` is consumed at the published subpath (ADR-0001).
- **The ~2-week null is the synthetic figure** — the aberration-free synthetic has no incidents to
  exclude, so 2 weeks gives robust per-cell resolution; the research-grounded **4 weeks** is for real
  incident exclusion and remains the real-deployment target.
- **AR-model robustness is NOT in scope this round** — only the per-cell baseline is robustified; the
  AR(p) temporal model still uses the standard estimator (recorded follow-up).
- **ECMP stays RNG-side; retransmit/flow-completion remain proxies** (telemetry-realism gaps unchanged).

## Blast radius (recorded)

- 3 calibration-ORTHOGONAL tests pinned to `robustCalibration:false` (preserving their measured
  fixtures): the ADR-0038 common-mode room-mislocalization demo, the ANYTIME per-query FDR transient
  profile, and the C1 saturating-noisy-OR margins. Each characterizes a property orthogonal to
  calibration robustness, measured under the mean/sd null.
- `demos/demo.html` and the coverage matrix regenerated under the new default. The coverage dilution
  prose was de-hard-coded (it now describes the phenomenon + points to the table, not stale values).
- Note (recorded interaction): under robust calibration the ADR-0038 common-mode no longer mislocalizes
  the specific room fault — a hint the common-mode tradeoff may soften with a robust null, but that is
  a separate investigation, not re-opened here.

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test |
|---|---|
| Robust calibration closes the aberration gap | `robust-calibration.test.ts` GAP CLOSED (32 → 0) |
| Unbiased on clean (no floor inflation in expectation) | CLEAN EQUIVALENCE (median scale ratio ≈ 1) |
| Clean-fabric FDR stays 0 | the clean-FDR test (robust min-samples absorbs MAD scatter) |
| Decoupled deep null + robust ⇒ floors ~hold | coverage regenerated: 16 unchanged, 2 det +1 step, FDR 0 |

## Consequences

- The most fundamental telemetry-realism gap is closed: the null is now built robustly, so the
  clustered aberrations real history always carries are tossed rather than absorbed.
- The published floors are now measured at a **realistic null depth** with a **robust estimator** —
  honest about the small sensitivity cost. The "FDR=0" claim is no longer a matched-short-window
  artifact: the deep null covers the full weekly cycle.
- Follow-ups recorded: AR-model robustness; the 4-week null for real incident exclusion; the
  common-mode-vs-robust-null interaction; the deferred realism (heavy-tailed marginals, minute cadence).
