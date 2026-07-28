# ADR 0051 — The ς̂ dispersion gate: measure the ADR-0050 failure mechanism from calibration residuals and gate the FDR claim on it

- **Status:** ACCEPTED (validation numbers + one recorded spec correction below)
- **Date:** 2026-07-27
- **Decision owner:** Tessera-RNG
- **Relates to:** ADR-0050 (the measured boundary this gate enforces — floor at realized
  ς ≈ 0.06–0.12 at the default operating point), ADR-0006 (min-sample estimation-noise
  precedent), ADR-0019-GPU-sibling analog (the ICC+ς pair gate; Tessera `~/concord/tessera`
  tools/dispersion-monitor.ts / heterogeneityGatePassing), VALIDATION.md Tier-3 ("the recorded
  prerequisite for any real-fabric FDR claim is a ς̂ dispersion gate").
- **New files:** `src/dispersion-gate.ts`, `test/dispersion-gate.test.ts`,
  `tools/dispersion-gate.ts` → `coverage-matrices/dispersion-gate.{json,md}`.

---

## Problem

ADR-0050 measured that e-BH selection validity dies once per-leaf noise-scale dispersion
exceeds realized ς ≈ 0.06–0.12 — well inside plausible real-fabric heterogeneity — and that
nothing currently measures ς. A real-fabric deployment would sail past the boundary silently:
selections would keep flowing, every one of them potentially a healthy leaf. The system needs
to KNOW when its own validity precondition fails, from data it already has (the calibration
window), and say so in the audit.

## Decision

### 1. The estimator (`estimateDispersion`)

Input: the standardized calibration residuals (the exact map `calibrateForSession` /
`runPipeline` already computes — no new data path). Per leaf i and signal j, the sample sd
s_{i,j} of the whitened residual column; per-leaf pooled log-scale
`ℓ_i = (1/p)·Σ_j log s_{i,j}` (the ADR-0050 generative model scales all of a leaf's signals by
one σ_pc; pooling over p signals divides the sampling variance by ≈p). Population dispersion:

- `raw_log_sd` — ROBUST sd of {ℓ_i}: MAD × 1.4826 about the median. **CORRECTED (cold-eye
  finding 1): this statistic must never gate ALONE.** The draft's justification ("faulty
  leaves must not inflate ς̂") conflated faulty-MEAN leaves (tossed by robust calibration,
  harmless) with high-noise-scale HEALTHY leaves — which are exactly the ADR-0050
  false-selection source. Demonstrated: a fleet with 10% of leaves at 2× scale reads robust
  ς̂ ≈ 0.03 (passing) while e-BH false-selects all and only the hot leaves — laundering, the
  one direction this gate must never fail. For a claim-withholding gate, robustness points the
  WRONG way.
- `raw_log_sd_tail` — the PLAIN sd of {ℓ_i} (the finding-1 companion): tail-sensitive, moved
  by subpopulations the MAD core is blind to. Both are published; both are debiased by the
  same floor; **the gate binds on max(ς̂, tail ς̂)** — bound by the AC-2b contamination test,
  which pins that the robust statistic alone would have passed the demonstrated fleet.
- `sampling_floor` — the estimation-noise contribution present even at ς = 0: for a sample sd
  over T ticks, Var(log s) ≈ 1/(2(T−1)); averaged over p signals, `1/(2(T−1)p)`. This is an
  iid/independence approximation (AR pre-whitening is imperfect; signals can be correlated) —
  its adequacy is VALIDATED, not assumed (AC-2).
- `sigma_hat = √max(0, raw_log_sd² − sampling_floor)` — the debiased estimate.

At the ADR-0050 operating point (T = 60, p = 5) the floor is √(1/590) ≈ 0.041 — below the
measured 0.06 no-effect point, so the estimator can resolve the boundary; at shorter windows
it cannot, and `sigma_hat`'s floor-dominated regime must be visible in the output (the
envelope publishes both raw and debiased values).

### 2. The gate (`dispersionGate`)

`{ passing, sigma_hat, sigma_hat_tail, threshold, margin }` with **default threshold
ς\* = 0.05**: above the
debiased sampling floor at the default operating point, below the measured 0.06–0.12 onset
band — conservative in the direction that matters (a gate that fails early withholds a claim;
a gate that fails late launders an invalid one). Threshold is a parameter; the default is the
recorded operating point.

**Semantics: the gate gates the CLAIM, not the alarm** (the GPU sibling's Mode A/B split,
its ADR 0019): a failing gate does not suppress detection or selection — evidence and ranking
remain useful for triage — it withholds the *FDR-controlled* reading of the selection set.
The audit says which one it is publishing.

### 3. Pipeline wiring (opt-in; byte-identity preserved)

`PipelineParams.dispersionGate?: boolean | { threshold?: number }`. When set, the pipeline
computes the estimate from the SAME calibration residuals the detector context was built from
and stamps the audit with a `dispersion_gate` field (estimate + gate verdict). Absent ⇒ the
field is absent ⇒ every existing audit is byte-identical (the `epochs`/`eprocess_resets`
precedent). The incremental session takes the same option at open time (calibration is batch
per ADR-0027, so the estimate is computed once at open and stamped on every audit).
Note (cold-eye finding 7, recorded): `runPipeline` self-generates a CLEAN synthetic
calibration window, so every reachable in-pipeline audit stamps `passing: true` — the audit
field is the wiring proof; real-fabric use calls `estimateDispersion` on real calibration
residuals directly.

### 4. The published validation envelope (`tools/dispersion-gate.ts`)

On the DEFAULT fabric at the ADR-0050 operating point, over the known-ς generator
(`heterogeneity`, ADR-0050): for each nominal ς in the H grid × seeds, publish ς̂ recovery
(mean/sd of `sigma_hat` vs realized ς) and the **gate operating characteristic** — pass rate
per ς — alongside the ADR-0050 false-selection counts for the same cells, so the table shows
the gate failing exactly where selection lies. Plus a calibration-depth row (T = 240) showing
the sampling floor shrink. Truncations logged.

## Acceptance criteria

- **AC-1 (byte-identity):** `dispersionGate` absent ⇒ audits byte-identical to pre-ADR
  (existing suite is the guard); present ⇒ ONLY the `dispersion_gate` field differs.
- **AC-2 (estimator honesty):** at ς = 0 the debiased `sigma_hat` ≈ 0 (below half the
  threshold across seeds — the debias approximation validated, not assumed) and
  `sigma_hat_tail` stays under the threshold (clean fleets pass the PAIR); at known
  ς ∈ {0.1, 0.2, 0.3} the estimate recovers REALIZED ς within a stated tolerance,
  cross-validated against the independent sd-ratio measurement (ADR-0050's estimator), not
  against the generator's internals. A no-op mutant of the debias (skip the subtraction)
  fails the ς = 0 assertion.
- **AC-2b (tail contamination — the finding-1 kill-test):** a fleet with ~10% of leaves at 2×
  residual scale FAILS the pair gate, with the test additionally asserting the robust
  statistic alone would have passed it — so a revert to robust-only gating cannot survive
  the suite.
- **AC-3 (gate ROC):** pass rate 100% at ς = 0; fail rate 100% at nominal ς ≥ 0.1 (where
  false selection begins); the ς = 0.05-nominal transition published as measured. A gate that
  ignores `sigma_hat` (constant-pass mutant) fails these. **CORRECTED against measurement
  (ADR-0020 precedent):** the PROPOSED draft predicted 100% pass at ς = 0.05-nominal — wrong,
  because nominal 0.05 REALIZES at 0.059, above ς\* = 0.05; the measured 38% pass rate there
  (robust-only draft design; 13% under the final pair gate) is the gate straddling its own
  threshold correctly (conservative in the safe direction —
  false selections at that cell are still 0, so the 62% of runs that fail withhold a claim
  that would in fact have been valid). The draft prediction, not the gate, was the error.
- **AC-4 (claim semantics):** with the gate opted in and failing, `selected_path_class_ids`
  is UNCHANGED (the alarm survives) and the audit's gate field says `passing: false` — bound
  by a test on a high-ς run; with the gate passing, same selections, `passing: true`.
- **AC-5 (session parity):** an incremental session opened with the gate stamps the SAME
  gate field as the batch pipeline for the same inputs (byte-equality on the field).
- **AC-6 (envelope honesty):** recovery table + ROC published with n per cell; the
  floor-dominated short-window regime visibly flagged (raw vs debiased columns).

## Anti-scope

- **No default-on.** Opt-in only; a default flip is its own decision after real-consumer use.
- **No selection suppression / no Mode-B-style action gating.** The gate labels the claim.
  Wiring actions (drains) to the gate verdict is future scope with its own semantics.
- **No live/streaming re-estimation.** Calibration-window estimate only (batch, ADR-0027
  narrowing). A runtime drift monitor (the GPU sibling's calibration-monitor analog) is
  future work — and ADR-0050's D axis measured that cal→live σ re-assignment adds no effect
  under SHARED calibration, so the static estimate is not known to be stale-prone in the
  current architecture; that changes if ADR-0052's per-leaf calibration lands (recorded
  there).
- **No per-leaf remediation** — that is ADR-0052.
- **No real-fabric threshold tuning.** ς\* = 0.05 is justified by the SYNTHETIC boundary
  only; a real deployment must re-derive it (Tier-3 honesty).

**Gate loosening on the record:** `no-god-module` 23 → 25 — `src/dispersion-gate.ts`
(type-only `PathClassId`) and `tools/dispersion-gate.ts` (type-only `FaultDomainSnapshot`)
pushed `domain.ts` to 25 importers; the same admitted zero-behavior-contract case, 5th and 6th
instances. Flagged to the operator in the invariant intent: six identical loosenings suggest a
structural exemption for the named zero-behavior contracts may be the better invariant design —
not decided unilaterally here.

## Prescription → AC coverage

| Prescription | Bound by |
|---|---|
| Estimator: robust pooled per-leaf log-scale + debias | AC-2 |
| Tail statistic + PAIR binding (max of the two) | AC-2b |
| Debias floor validated at ς = 0 (mutant-killed) | AC-2 |
| Gate thresholds + ROC | AC-3 |
| Audit field only when opted in | AC-1 |
| Claim-not-alarm semantics | AC-4 |
| Session stamps identical field | AC-5 |
| Envelope: recovery + ROC + floor visibility | AC-6 |

## Consequences — the measured validation (AC-6)

Artifact: `coverage-matrices/dispersion-gate.{json,md}` (n = 8/cell, deterministic).

- **The PAIR gate separates at the boundary on the Gaussian-ς family AND fails the
  contaminated fleet the robust core launders.** Pass rate 100% at ς = 0 (robust ς̂ 0.009,
  tail ς̂ 0.006 — the debias works on both; raw 0.042 ≈ the published floor 0.041) and **0% at
  every cell where selection lies** (nominal ς ≥ 0.1 = realized ≥ 0.118, false selections
  ≥ 5.25). The transitional cell, nominal 0.05 (realized 0.059), passes 13% (was 38% under
  the robust-only draft design) — conservative straddling; false selections there are still
  0, so every failure at that cell withholds a claim that would have been valid, none
  launders. The AC-2b fleet (10% of leaves at 2× scale — robust ς̂ ≈ 0.03, would PASS) fails
  the pair gate on every tested seed. **Scope, on the record:** the ROC table is measured on
  the single-Gaussian-ς family plus the two-point contamination case; other dispersion shapes
  inherit the pair's design logic, not a measurement.
- **Recovery:** the TAIL statistic tracks realized ς almost exactly (0.113 vs 0.118; 0.225 vs
  0.235; 0.335 vs 0.353); the robust statistic reads low (0.102 / 0.191 / 0.286) — the
  finding-1 diagnosis confirmed: the draft's "mild finite-window bias" was mostly
  MAD-core-vs-tail, largely eliminated by the pair.
- **Depth:** at T = 240 the sampling floor halves (0.041 → 0.020) and the clean estimate
  drops to 0.008 — longer calibration buys resolution, exactly as the floor formula says.
- **Wiring:** batch and session stamp identical fields by construction (the shared prelude
  computes once — AC-5 bound); opting in changes ONLY the `dispersion_gate` field (AC-1
  bound); a failing gate leaves the selection set untouched (AC-4 bound).

Real-fabric posture (Tier 3): the recorded N2 prerequisite from ADR-0050 is now BUILT —
before any real-fabric FDR claim, run the gate on the real calibration window; `passing:
false` (or a floor-dominated estimate — visible in the published fields) means Mode-A
evidence/ranking only.
