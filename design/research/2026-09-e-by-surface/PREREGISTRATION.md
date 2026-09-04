# Pre-registration — e-BY effect-size intervals on the fleet surface (`2026-09-e-by-surface`, ADR-0067)

- **Study id:** `2026-09-e-by-surface`
- **Register:** `~/concord/knowledge/WORKLIST.md` C62 (c) — the tessera-rng e-BY half left open
  when C62 closed on 2026-09-03; `knowledge/stats/pages/e-by-fcr-2026-09-03.md` (the engine's
  measurement of the same composition on independent Gaussian signals);
  `knowledge/stats/pages/ramdas-wang-2025.md` §7 (Proposition 13.4, Definition 13.6, Theorem 13.7).
- **Discipline:** `knowledge/methodology/pre-registration-discipline`; `harness-discipline`.
- **Engine:** v0.6.11-pre on `main` (ADR 0030: `fleet/e-by.ts`,
  `detectors/mixture-confidence-sequence.ts` `mixtureConfidenceSequenceAt`).
- **Status: REGISTERED, NOT RUN.** At this commit no verdict carries a confidence sequence, the
  surface has no `effect_intervals`, and no harness exists. Committed first so that no endpoint,
  band, grid or seed below can be chosen after a number is seen. A later change is an amendment,
  appended and dated.

## 1. The system, from code

Per leaf, Family A is one betting e-process per signal on the standardized residual with
baseline 0 and σ² = 1 (`src/detect.ts` `runFamilyA`; the session's `updateDetectors`,
`src/session.ts`). Selection is e-BH on the leaf's family-averaged e-value (`src/surface.ts`
`buildSurface`). Nothing on the surface says how large a selected leaf's shift is, and the
per-leaf t-statistic (ADR-0046, `leafTStats`) is a point estimate with no coverage claim.

The engine's Gaussian-mixture confidence sequence needs only `(S_t, t, σ², ρ)` (engine ADR
0030), and on a unit-variance residual `S_t` is the running residual sum the session already
keeps per signal (`residSums`, ADR-0046) and the batch path already computes (`leafTStats`).
So a CS per (leaf, signal) costs two numbers per segment and no second detector. The interval at
level α is `S_t/t ± sqrt(v·log(v/(α²ρ)))/t`, `v = t + ρ`; its e-process `M_t(S_t − tm)` does not
involve α, so stopped at the report tick it is a level-free e-CI (Proposition 13.4), and e-BY at
`α_i = δ|S|/K` gives FCR ≤ δ for any selection rule under any dependence (Theorem 13.7).

**Premise, stated once.** The standardized residual of an un-shifted (leaf, signal) is
conditionally mean-zero and sub-Gaussian(1) under the reference law — the same premise the
mixture makes in the engine, and one the betting e-process does not need (it bets on a bounded
increment). The interval covers the shift FROM THE CALIBRATED BASELINE in residual units (the
ADR-0046 scale): with per-cell (hour × day × class) standardization, a raw level shift is a
residual shift that varies with the cell's `sd`, and a constant-`m` CS covers a constant shift.
Whether that matters on this fabric is endpoint P1b below.

## 2. What will be built (registered, not yet written)

- `DetectorResult` (family A) gains `effect_cs?: readonly { signal, S_t, t }[]` — the CURRENT
  segment's per-signal residual sum and count (batch: computed in `runFamilyA`;
  `combineSegmentRuns` carries the last segment's; session: two arrays on `DetectorStates`, reset
  with the segment). `ρ = 1`, a registered constant (`CS_SIGMA_SQUARED_PRIOR`).
- `FleetSurface.effect_intervals?` — present iff every verdict's Family A row carries
  `effect_cs`: `{ delta, K, selected, alpha_i, intervals[{ path_class_id, signal, center,
  half_width, lower, upper }], guarantee }`, computed by the engine's `eBenjaminiYekutieli` with
  `K = |leaves| · p` parameters and `|S| · p` selected (α_i = δ|S|/K exactly). `buildSurface`
  gains a third argument `fcrDelta` defaulting to `q`; `PipelineParams.fcrDelta?` and the audit
  record carry it through `assembleAudit` (batch and session share it).
- ADR-0067. No selection, α, verdict or localization path changes; pre-0067 audits (no
  `effect_cs`) produce a surface without the field, byte-identical to today.

## 3. The study

Fabric `generateFabric(DEFAULT_FABRIC)` (400 leaves, 2,391 edges). Degraded resource `pzone-0`
(the carryover study's), signal `p99_latency`, mode `mean`, `start_tick 0`, raw magnitude
`Δ ∈ {0, 2, 4}` (diluted per leaf by its traffic weight, `src/telemetry.ts` ADR-0014). Live
`T = 200` ticks. **One fixed calibration** for the whole study:
`calibrateForSession(SNAP, { seed: 0xca11b, ticks: 2000 }, DEFAULT_DETECT)`, so the estimation
premise is held constant and the estimand is well defined. Residuals:
`standardizeAll(generateTelemetry(SNAP, { seed, ticks: T, degradation }).series, calibration)`;
verdicts `detectAll(residuals, DEFAULT_DETECT, ctx)`; surface `buildSurface(verdicts, q = 0.05,
fcrDelta = δ)` for `δ ∈ {0.05, 0.10}`.

Two selection rules at the report tick `T`:

- **Rule A — the shipped rule:** `S` = `surface.selected_path_class_ids` (e-BH at q = 0.05),
  intervals = `surface.effect_intervals` as shipped.
- **Rule B — extremeness:** `S` = the 3 leaves with the largest `leafTStats` (the shipped
  t-statistic, max over signals of `|Σ r|/√T`), always non-empty; intervals from the same
  `effect_cs` through the engine's `eBenjaminiYekutieli` at `δ·3/400`.

**Truth.** `θ = 0` exactly for every (leaf, signal) when `Δ = 0`; for every signal other than
`p99_latency` at any `Δ`; and for `p99_latency` on leaves that do not traverse `pzone-0`. For
`p99_latency` on the degraded leaves at `Δ > 0`, `θ` is the mean standardized residual under the
fixed calibration, estimated by Monte Carlo over `M = 2,000` live seeds disjoint from the study
seeds (`4·10⁵` residuals per leaf; se ≈ 0.002 against half-widths of order 0.3), reported with
its se. A miss is `θ ∉ [lower, upper]`.

`N = 500` replications per (Δ, rule) cell; live seeds `20260907 + 7919·i + 10⁶·cell`; the
Monte-Carlo truth uses `30000001 + 7919·j`. FCP per replication = misses / (selected pairs ∨ 1),
pairs = selected leaves × 5 signals; `fcr` = mean FCP, `fcr_se` its standard error.

**Endpoints.**

- **P1a — exact-truth FCR under adversarial selection (the ship gate).** Rule B, `Δ = 0`, both δ:
  `fcr ≤ δ + 3·fcr_se`. Every truth is exactly 0. Registered prediction: HELD with `fcr` well
  under δ (the engine study measured at most 0.04·δ off the fired-set rule).
- **P1b — FCR under the shipped rule on faulted fabrics.** Rule A, `Δ ∈ {2, 4}`, both δ:
  `fcr ≤ δ + 3·fcr_se`, with the degraded signal's truth from the Monte Carlo estimand. Registered
  prediction: HELD; the named risk is per-cell standardization making the residual shift
  time-varying, in which case the constant-`m` CS is not covering a constant and this endpoint
  FAILS for a structural reason that is then the finding (§4).
- **P2 — the undegraded signals on selected leaves (exact truth) are covered.** Rule A,
  `Δ ∈ {2, 4}`: among selected pairs whose truth is exactly 0, the miss fraction ≤ δ + 3·se.
  Reported beside P1b; it is P1b's exact-truth component.
- **P3 — informativeness (reported, no bar).** Rule A, `Δ ∈ {2, 4}`: the fraction of selected
  degraded leaves whose `p99_latency` e-BY interval excludes 0; the mean half-width; the width
  ratio e-BY/naive at level δ.
- **P4 — the shipped field is the closed form, and the two paths agree (structural).** Every
  interval in `surface.effect_intervals` equals the closed form from its `effect_cs` at 1e-12;
  for one replication per Δ the incremental session's audit carries `effect_cs` byte-equal to
  the batch path's.

Harness rules: no catch; the harness imports the repo's compiled `src/*.js` (the carryover
precedent) and the engine's `fleet/e-by` from `node_modules`; every number in `REPORT.md` is
re-derived by `analysis/check_report.mjs` from `results/.../cells.json`.

## 4. Ship rule

P1a HELD at both δ and P4 HELD → ADR-0067 ACCEPTED, the field ships. P1b FAILED with P1a HELD →
ship, with the surface docstring saying the interval covers a constant shift and the fabric's
per-cell scale makes a raw level shift non-constant, and the finding filed on the wiki. P1a
FAILED or P4 FAILED → nothing ships; a contradiction between the measurement and Theorem 13.7 is
filed at `confidence: contested` and the study stops.

## 5. Not measured

Epoch'd (segmented) leaves beyond the P4 parity check; the estimation premise itself (fixed
calibration by design; the engine's mixture-cs P3/P4 prices it); Family C/D-mode selections
(the interval is a mean-shift object and says nothing about a leaf selected on dispersion);
dependence between leaves beyond what the shared-resource fabric supplies.
