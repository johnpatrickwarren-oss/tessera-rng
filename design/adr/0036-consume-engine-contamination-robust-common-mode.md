# ADR 0036 — Consume the engine's contamination-robust common-mode (ADR-0034 fix)

- **Status:** ACCEPTED — BUILT, OPT-IN. The pipeline can strip the engine's robust per-tick
  cross-leaf common-mode before detection (`commonModeRobust: true`), which **extends cross-optic
  recovery from ≈δ6 to ≈δ16** — closing most of the ADR-0034 high-δ saturation. Default OFF (no
  artifact churn; incremental≡batch preserved). 231 tests green, gate PASS.
- **Date:** 2026-06-29
- **Decision owner:** Tessera-RNG (post-v1; the "expand consumption, don't re-engineer" directive)
- **Relates to:** ADR-0034 (the saturation this addresses), ADR-0035 (the cutover whose high-δ limit
  this lifts), ADR-0001 (engine never forked — this is consumption at an extension point), engine
  ADR-0008/0017 (the contamination-robust common-mode being consumed).

---

## Context

ADR-0034 diagnosed the high-δ cross-optic saturation: a fleet-wide fault shifts nearly all leaves
together, inflating the surface's firing-fraction q₀, which then masks the fault. It named the
principled fix — a contamination-robust base rate — and recorded that **the engine already ships
one** (`fleet/common-mode`). Rather than re-engineer a robust null in `tomography.ts`, this round
**consumes** it.

## Decision

Add `src/common-mode.ts` `stripCommonMode(residuals)` that consumes the engine's `robustLocation`
(Tukey-biweight, redescending) to remove the per-(tick, signal) robust common-mode across leaves,
composed **on top of** Tessera's per-cell standardized residuals.

- **Compose, not replace (the design fork resolved by measurement):** consume ONLY the
  `robustLocation` primitive, applied to Tessera's already-standardized residuals. The engine's full
  `contaminationRobustResiduals` also does per-shard levelling, which would double-count Tessera's
  per-cell (HoD×DoW×traffic-class) calibration. Keep the validated per-cell layer; add the robust
  cross-leaf common-mode as a residual layer feeding detection.
- **Applied to BOTH calibration and live residuals** (in `calibrateForSession` and the live path) so
  Family C's Σ and Family D's nulls are estimated under the same regime the live detector sees.
- **OPT-IN** via `PipelineParams.commonModeRobust` (default OFF). The cut-over default path, the demo,
  coverage, hashes, floors, and the incremental session (which does not yet support it) are
  byte-unchanged — so incremental≡batch holds. Batch path only this round.

## Evidence (measured, `runPipeline`, cross-optic default fabric, cross-kind, 4 seeds)

| δ | recovery OFF | recovery ON (common-mode) |
|---|---|---|
| 4, 6 | 4/4 | 4/4 (in-band preserved) |
| 8 | 2/4 | 4/4 |
| **16** | **0/4** | **4/4** (the ADR-0034 case, recovered) |
| 32 | 0/4 | 0/4 (still bounded — see below) |

The robust common-mode returns the diluted leak leaves to ≈ their noise floor (verified directly: at
δ=16 the leak leaves' mean |residual| drops to ~the noise level while tor-3's stays ~15×), so q₀
stays low and the optic is recoverable. **Clean fabric still selects 0** under common-mode removal
(no manufactured false positives). δ=4 in-band recovery is preserved.

## Anti-scope (must-never)

- **Default stays OFF this round** — turning it on is a floor-moving cutover (its own decision), and
  the just-completed ADR-0035 cutover should settle before another. The capability is consumed and
  proven; the flip is deferred.
- **Engine not forked** — we consume `robustLocation` at the published subpath; no engine code copied.
- **No re-engineered robust null in `tomography.ts`** — the ADR-0034 fix is the consumed common-mode,
  per the "don't rebuild what the engine has" directive.
- **The δ≈32 extreme is still bounded** — common-mode moved the boundary up (≈δ6 → ≈δ16), it did not
  remove it; at δ=32 the fault overwhelms even the robust estimator (and e-values overflow, ADR-0034).
  Recorded by a test, not hidden.

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test (`test/common-mode.test.ts`) |
|---|---|
| `stripCommonMode` removes the robust common-mode, outlier survives | shared-shift leaves → ≈0; concentrated outlier keeps its signal; input not mutated |
| Wired payoff: extends recovery to δ=16 | δ=16 recovers 0/4 OFF → 4/4 ON |
| No in-band regression / no false positives | δ=4 still recovers ON; clean fabric selects 0 ON |
| Default OFF (incremental≡batch safe) | a default run is byte-identical to `commonModeRobust:false` |
| Boundary moved, not removed (honest) | δ=32 still fails both ON and OFF |

## Consequences

- The ADR-0034 high-δ saturation is largely closed by **consuming engine code**, not re-engineering —
  the first of the "expand consumption" line.
- Gate: `no-god-module` loosened 20→21 on the record (ADR-0036) — `common-mode.ts`'s type-only
  `PathClassId` import pushed the zero-behavior `domain.ts` contract to 21 importers, the same admitted
  case as ADR-0017's 16→20. Behavioral-hub protection unchanged.
- Follow-ups: (a) session support so the flag composes with the incremental path; (b) the default
  cutover decision (turn it on), with a full coverage re-measure.
