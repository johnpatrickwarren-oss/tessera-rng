# ADR 0067 — e-BY effect-size intervals on the fleet surface (engine ADR 0030 adoption)

- **Status:** ACCEPTED (measured below; study `2026-09-e-by-surface`, `design/research/2026-09-e-by-surface/PREREGISTRATION.md` §4 ship rule met)
- **Date:** 2026-09-03
- **Decision owner:** Tessera-RNG (knowledge WORKLIST C62 (c), the tessera-rng e-BY half left open on 2026-09-03)
- **Relates to:** engine ADR 0030 (`fleet/e-by.ts`, the level-free confidence sequence), ADR-0066 (the surface's e-BH threshold and margins — unchanged), ADR-0046 (the t-statistic scale the interval lives on), ADR-0018 (segments: the interval is the current segment's), ADR-0050 / ADR-0060 (the FDR boundary and license — unchanged; they bound the reading of this field the same way), `knowledge/stats/pages/e-by-fcr-2026-09-03.md`, Ramdas–Wang 2025 Proposition 13.4, Definition 13.6, Theorem 13.7.

---

## What the engine pin brings

v0.6.11-pre carries `fleet/e-by.ts` (`eBenjaminiYekutieli`: each selected parameter's e-CI at `α_i = δ|S|/K`, FCR ≤ δ for any selection rule under any dependence when the e-CIs are level-free) and `mixtureConfidenceSequenceAt`: the Gaussian-mixture confidence sequence at any level from `(S_t, t, σ², ρ)`. On a unit-variance residual, `S_t` is the running residual sum — which this repo already keeps per signal (the session's `residSums`, ADR-0046) and computes on the batch path (`leafTStats`). No second detector is needed.

## Decision

1. `DetectorResult.effect_cs` on Family A rows: the CURRENT segment's per-signal `{ signal, S_t, t }`. Batch: `runFamilyA` sums in tick order; `combineSegmentRuns` carries the last segment's. Session: `csSums`/`csN` on `DetectorStates`, reset with the segment, accumulated in the same order — the keystone byte-equality tests pass unchanged.
2. `FleetSurface.effect_intervals`, present iff every verdict's Family A row carries `effect_cs`: for every selected leaf, one interval per signal at `α_i = fcrDelta·|S|/|leaves|` (universe `|leaves|·p` parameters, `|S|·p` selected, the same ratio), through the engine's `eBenjaminiYekutieli` with `ρ = CS_SIGMA_SQUARED_PRIOR = 1`. `buildSurface(verdicts, q, fcrDelta = q)`; `PipelineParams.fcrDelta` and `SessionParams.fcrDelta` thread it; `assembleAudit` copies the field onto the audit record when present.
3. Nothing else moves: no selection, α, verdict, localization or drain path reads the field; a pre-0067 verdict set yields a surface and audit byte-identical to before.

## Anti-scope

- The interval is the shift FROM THE CALIBRATED BASELINE in residual units, for the leaf's current segment, and covers a CONSTANT shift. Per-cell standardization (hour × day × class) turns a raw level shift into a residual shift that varies with the cell's `sd`; what that does to coverage on this fabric is the study's P1b, and the surface docstring says so.
- The premise is the engine mixture's: the un-shifted standardized residual is conditionally mean-zero sub-Gaussian(1). The betting e-process that selects does not need it; this field does. The dispersion boundary (ADR-0050) and the license gate (ADR-0060) bound the reading of `effect_intervals` exactly as they bound the selection.
- Family C/D-mode selections get intervals too (every selected leaf does), but the interval is a mean-shift object and says nothing about why a dispersion-selected leaf was selected.
- No new α is booked; FCR is a coverage guarantee on reported intervals, not a selection error rate.

## Acceptance criteria

Study `2026-09-e-by-surface`: P1a (exact-truth FCR under extremeness selection) HELD at both δ and P4 (closed form, session/batch parity) HELD → ACCEPTED. P1b (the shipped e-BH rule on faulted fabrics, Monte-Carlo truth) reported either way; a FAIL with P1a HELD is filed as the per-cell-scale finding and does not block. P1a or P4 FAILED → nothing ships and a contradiction with Theorem 13.7 is filed.

## Results append — 2026-09-03, run `run-20260904T031343Z`

6 cells × 2 δ, N = 500, T = 200, 400 leaves, 97 degraded by `pzone-0`, one fixed 2,000-tick
calibration, Monte-Carlo truth from 2,000 seeds per Δ (se 0.0016), 454 s, 0 closed-form
deviations, session/batch parity 3 of 3. **P1a HELD** (extremeness rule on the null fabric:
FCR 0.0005 at δ = 0.05, 0.0011 at δ = 0.10 — a hundredth of the level). **P1b HELD** (the
shipped e-BH rule on faulted fabrics selects all 97 degraded leaves, 485 intervals per
replication: FCR 0.0003 / 0.0005 at δ = 0.05 / 0.10, both Δ). **P2 HELD** (exact-truth pairs on
selected leaves: miss 0.0003–0.0005). **P3**: every selected degraded leaf's `p99_latency`
interval excludes 0; mean half-width 0.27 (δ = 0.05) against residual shifts of 1.16 (Δ = 2) and
2.33 (Δ = 4); width ratio e-BY/naive 1.12–1.13. **P4 HELD.** The anti-scope's named risk — a raw
level shift becoming a non-constant residual shift under per-cell standardization — did not
bite on this fabric: the Monte-Carlo θ across the 97 degraded leaves spans 1.156–1.167 at Δ = 2,
a 1% spread against an interval of ±0.27. At Δ = 0 under the shipped rule one replication in 500
selected one leaf (δ = 0.10) and missed on one of its five signals; that is the 0.0004 FCR and
the 0.2 exact-miss reading in that cell, both inside the bar. Ship rule met; ACCEPTED.
