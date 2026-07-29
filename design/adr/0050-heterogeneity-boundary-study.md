# ADR 0050 — Heterogeneity boundary study: per-leaf scale dispersion, correlated null, and where e-BH selection breaks

- **Status:** ACCEPTED (envelope measured; consequences recorded below)
- **Date:** 2026-07-27
- **Decision owner:** Tessera-RNG
- **Relates to:** ADR-0011/0012 (Σ/φ kept global — evidence-gated on a fabric with no per-cell
  structure), ADR-0015 (per-leaf heterogeneity named as the real scale problem), ADR-0025
  (paper-scale clean-fabric measurement), ADR-0032 (degradation harness pattern this study
  extends), ADR-0036/0038 (robust common-mode arm), VALIDATION.md Tier 2, `src/telemetry.ts`,
  `tools/heterogeneity.ts` (new), `coverage-matrices/heterogeneity-boundary.{json,md}` (new).
- **Cross-project provenance:** Tessera (GPU sibling) A2-disp / ADR 0023 CORR 3 + N12
  (`~/concord/tessera` RESEARCH-INDEX): under per-unit scale dispersion (ς), e-BH false-selects
  from HEALTHY units (onset ς ≈ 0.31 in its conformal-rank setting), and fleet-size protection
  REVERSES under a shared latent factor + step-up cascade (0/3/26.5 false selections per run at
  N = 1k/2k/4k). Numbers do NOT transfer (different e-value construction); the mechanisms do.

---

## Problem

Every existing Tessera-RNG measurement — including paper-scale clean-fabric FP = 0 (ADR-0025)
and the ADR-0032 degradation envelope — runs in a regime where two failure mechanisms are
**absent by construction**:

1. **Per-leaf scale dispersion (ς).** The generator gives every leaf unit-variance noise, and
   calibration cells are keyed `(hour × day-of-week × traffic-class)` — no path-class in the
   key (`src/calibration.ts:cellKey`). Shared-cell calibration therefore *cannot represent*
   per-leaf scale, but the generator never produces any: ς = 0 in every run ever measured. On a
   real fabric, leaves whose noise scale sits above their cohort's shared cell sd get
   under-standardized residuals (variance > 1) — the exact mechanism ADR-0006 identified for
   *estimation-noise*-induced sd error, now structural and permanent. The GPU sibling measured
   the consequence: e-BH selects healthy units, and the count grows with dispersion.
2. **Correlated null.** The null noise is independent across leaves; the incidence hypergraph
   propagates *faults* only. The README's own premise — signals "correlated through shared
   fiber/optic/shuffle hardware" — is modeled for alternatives, never for the null. The GPU
   sibling's N12 shows the dangerous interaction: a shared latent factor plus e-BH's step-up
   makes false selections GROW with fleet size.

The ADR-0032 `noiseStd` axis does not cover (1): it adds noise *uniformly* (homogeneous), and
the study's headline (detection holds, attribution collapses) is about fault sensitivity, not
null validity. This study measures where the **selection layer's** validity boundary sits.

## Decision

### 1. Two opt-in generator knobs (`src/telemetry.ts`), byte-identical when absent

Both are **baseline structure** (like `noiseCorr`/`arCoeffs`): physics of the fabric, present
in calibration AND live windows. Neither consumes draws from the main RNG stream (byte-identity
at zero is exact, not approximate).

- **`heterogeneity?: { sigmaLogSd, seed?, driftMix?, driftSeed? }`** — a static per-leaf noise
  scale multiplier σ_pc = exp(sigmaLogSd · g_pc), applied to the noise of ALL signals of the
  leaf (leaf-level scale heterogeneity; baselines/means untouched). g_pc ~ N(0,1) drawn from a
  dedicated RNG seeded by (seed ⊕ hash(pc)) — deterministic per leaf, independent of the tick
  loop and of the population's composition. ς ≡ sigmaLogSd is the population log-scale
  dispersion (the GPU sibling's ς, on the same log scale).
  **Drift:** g_pc(m) = √(1−m²)·g_base + m·g_new with g_new from (driftSeed ⊕ hash(pc)) and
  m = driftMix ∈ [0,1] — marginal N(0,1) preserved at every m, so drift changes WHICH leaves
  are noisy, not how dispersed the population is. The boundary tool calibrates at m = 0 and
  runs live at m > 0 (cal/monitor drift — the GPU sibling's N1 mechanism).
- **`latentNull?: { load, phi? }`** — per-resource shared null factors λ_r(t): independent
  AR(1) streams (coefficient `phi`, default 0.5, unit marginal variance), one per snapshot
  resource, drawn from a dedicated RNG. Each leaf's primary signal (p99_latency) gains
  `load · Σ_{r ∈ edges(pc)} w(pc,r) · λ_r(t)` — the null correlated through shared hardware
  via the SAME weighted incidence that propagates faults. `latentNull` with `epochs` throws
  (incidence is epoch-dependent; recorded narrowing — the boundary tool is non-epoch'd).

Validation: `sigmaLogSd < 0`, `load < 0`, `driftMix ∉ [0,1]`, non-stationary `phi ∉ (−1,1)`
throw `RangeError`.

### 2. Boundary-sweep tool (`tools/heterogeneity.ts`) + published envelope

Degradation-harness pattern (ADR-0032): compose the EXPORTED pipeline building blocks, never
fork the stack. **Null runs only** (no degradations): every e-BH selection is a false
selection. Detection stops at `buildSurface` (no tomography/drain — selection is the object
under study; also keeps large-fabric runs cheap). Calibration follows production defaults
(robust per-cell, `seed ⊕ 0xca11b`, coupled window) except where an axis says otherwise.

Axes (grids are constants in the tool; any truncation is logged, DISCIPLINES §"no silent
caps"):

- **H — dispersion:** ς ∈ {0, 0.05, 0.1, 0.2, 0.3, 0.5}, DEFAULT_SPRAYPOINT (109 leaves),
  n = 8 telemetry seeds. Metrics: mean false selections/run, fraction of runs selecting ≥ 1.
  The **onset** is the first grid ς whose mean false-selection count exceeds the ς = 0 row's.
- **L — correlated null:** load ∈ {0, 0.1, 0.25, 0.5} at ς = 0, each with and without
  `commonModeRobust` (ADR-0036) — the fleet-level spatial-control arm: a cross-sectional
  median SHOULD cancel a fleet-wide component of the shared factors; per-resource-local
  structure is what survives. Plus the joint regime (ς = 0.2, load = 0.25), both arms.
- **N — scale (the N12 probe):** fabrics 109 / 360 / 1456 (paper) / 3176 / 6112 leaves
  (Spraypoint nTors×nPanels ramp), each at three regimes: clean (ς=0, load=0 — re-confirms
  ADR-0025 at every size), dispersion-only (ς = 0.2), dispersion+latent (ς = 0.2,
  load = 0.25). n = 5 seeds at ≤ 1456 leaves, n = 3 above (logged truncation). Metric: false
  selections/run vs leaf count — flat, sub-linear, or growing is the finding.
- **D — drift:** driftMix ∈ {0, 0.25, 0.5, 1} at ς = 0.2, DEFAULT fabric, n = 8. Separates
  "static heterogeneity a shared calibration averages over" from "heterogeneity that moved
  since calibration".

Artifact: `coverage-matrices/heterogeneity-boundary.{json,md}` + `pnpm heterogeneity` script.

### 3. What this study does NOT change

No production-path change. The knobs are generator opt-ins; `runPipeline` does not thread
them; no default flips; the prior suite is unchanged by construction (byte-identity).

**Gate loosening on the record:** `no-god-module` 22 → 23 — `tools/heterogeneity.ts`'s
type-only `FaultDomainSnapshot` import pushed `domain.ts` to 23 importers, the same admitted
zero-behavior-contract case as ADR-0017/0036/0047 (a leaf report script under `tools/`, the
intent's (b) clause). Behavioral-hub protection (a logic module imported by 24+ blocks)
unchanged.

## Acceptance criteria

- **AC-1 (byte-identity at zero):** `generateTelemetry` with `heterogeneity` absent,
  `{sigmaLogSd: 0}`, and `latentNull: {load: 0}` produce deep-equal series (and equal to the
  pre-ADR generator's output). The TOOL's inert run reproduces `runPipeline`'s
  `selected_path_class_ids` + `fleet_log_e` exactly.
- **AC-2 (dispersion mechanism):** at ς > 0, per-leaf realized noise sd's disperse with
  log-sd ≈ ς (cross-validated against an independent two-pass computation over the emitted
  series, NOT against the generator's internals) while per-leaf means are unchanged; a no-op
  mutant of the σ multiply fails the test.
- **AC-3 (latent-null mechanism):** at load > 0, residual correlation between two leaves
  sharing a resource exceeds that of two resource-disjoint leaves by a margin; load = 0 is
  byte-identical; the epochs combination throws.
- **AC-4 (drift mechanism):** driftMix = 0 reproduces the no-drift series byte-for-byte;
  driftMix = 1 with a different driftSeed changes per-leaf σ assignment while population
  dispersion is preserved (independent check on realized sd's).
- **AC-5 (envelope honesty):** the published matrix reports mean false selections AND the
  select-anything fraction per cell with n; every truncation (reduced seeds at scale) appears
  in the artifact; the clean row at every fabric size is published even (especially) if 0.
- **AC-6 (boundary is measured, not assumed):** the ADR's ACCEPTED text records the observed
  onset ς, the scale trend under each regime, the commonModeRobust deltas, and the drift
  effect — with the numbers, whatever they are.

## Anti-scope (deliberately NOT this round)

- **No per-leaf calibration fix** (per-path-class cells / per-leaf scale estimation) — that is
  the *remedy* ADR; this round measures the disease. Same for any **runtime dispersion gate**
  (the GPU sibling's ICC+ς pair-gate analog): gate design follows the measured boundary.
- **No matched-pair / disjoint-path differencing design** (the per-resource spatial control).
  The fleet-level `commonModeRobust` arm is included because it already exists (ADR-0036);
  the pairwise design is its own ADR with its own identifiability questions.
- **No power measurement under heterogeneity** (faulted runs) — ADR-0032 owns fault
  sensitivity; extending it with ς is future work.
- **No `latentNull` × epochs semantics.** Throws.
- **No real-fabric claim.** Tier-2 synthetic (VALIDATION.md): this maps where the SYNTHETIC
  model's selection guarantee breaks; it neither proves nor bounds real-fabric behavior.
- **No engine changes, no engine-pin bump** (pin hygiene is separate housekeeping).

## Prescription → AC coverage

| Prescription | Bound by |
|---|---|
| σ multiplier per leaf, all signals, means untouched | AC-2 |
| σ drawn off-stream (main RNG untouched) | AC-1 (byte-identity would fail otherwise) |
| Drift preserves marginal dispersion | AC-4 |
| λ_r per resource, injected via weighted incidence | AC-3 |
| latentNull+epochs throw; param validation throws | AC-3 / validation tests |
| Tool composes exported blocks; inert ≡ runPipeline | AC-1 |
| Envelope fields (false-sel mean, fraction, n, truncations) | AC-5 |
| Measured boundary folded into this ADR | AC-6 |

## Consequences — the measured boundary (AC-6)

Artifact: `coverage-matrices/heterogeneity-boundary.{json,md}` (all counts deterministic;
"realized ς" = the exact log-scale sd of the fixed σ-draw set, published per cell — the fixed
draws realize nominal ς with ±≈20% sampling spread at 109 leaves).

- **H (dispersion) — the boundary is SHARP and EARLY.** Zero false selections at realized
  ς ≈ 0.06; at realized ς ≈ 0.12 the mean is 5.25 false selections/run (≈5% of the fleet) with
  **100% of runs selecting** — failure is not a tail event. By realized ς ≈ 0.24 it is 15.5
  (≈14%), saturating ≈19 (≈17%) by ς ≈ 0.35. The validity floor at this operating point sits
  between realized ς 0.06 and 0.12 — far below the GPU sibling's 0.31 onset (different e-value
  construction; the common content is that dispersion, not correlation, is the wall).
  **Disclosed condition (cold-eye finding 3):** at 109 leaves / 60 ticks every calibration cell
  is under `ROBUST_MIN_CELL_SAMPLES` and falls back to the pooled-global baseline — the H/L/D
  axes ran under a SINGLE global scale ("per-cell" had zero per-cell resolution). A fortiori
  shared-not-per-leaf, so the mechanism claim stands, but the floor number is
  operating-point-specific; the artifact carries the disclosure.
- **L (correlated null) — the POSITIVE result.** Latent load alone (ς = 0) produces ZERO false
  selections through load 0.5, with and without `commonModeRobust`. Two recorded reasons: e-BH
  under arbitrary dependence covers the correlation per se (the theorem doing its job), and the
  latent variance is baseline structure absorbed into the shared-cell scale (it inflates cohort
  members' variance roughly alike). The README's "correlated through shared hardware" premise
  does not, by itself, break selection. **Quantified scope (cold-eye finding 6):** on THIS
  fabric the near-uniformity is structural — at load 0.5 the per-leaf latent log-sd inflation
  has cross-leaf dispersion ≈ 0.02, ~3× below the measured no-effect point — so the L axis
  could not have failed through the dispersion side-channel by construction. A fabric with
  heterogeneous per-leaf Σw² converts latent load directly into ς; do not over-generalize the
  zero.
- **Joint — dispersion dominates; the fleet-level control is the WRONG TOOL.** ς = 0.2 +
  load = 0.25 gives 15.5 false selections — identical to dispersion alone — and
  `commonModeRobust` does not reduce it (15.5 both arms; the damage is per-leaf SCALE, not
  shared level, so a cross-sectional location control cannot see it). Recorded: remedies must
  address per-leaf scale; more common-mode is not a mitigation.
- **N (scale) — no cascade, and no protection: a constant FRACTION fails.** Clean stays 0 at
  every size to 6112 leaves (ADR-0025's clean-fabric result re-confirmed 4× beyond paper
  scale). Under ς = 0.2 the count grows LINEARLY: 15.8 / 48.2 / 173 / 378 / 755 at
  109 / 360 / 1456 / 3176 / 6112 leaves — a roughly constant ≈12–14.5% of the fleet, so at
  paper scale that is ~173 false selections per 60-tick window (the ramp crosses the
  pooled-fallback → per-cell calibration boundary between 109 and 360 leaves — disclosed in
  the artifact — and the mild 14.5% → 12% dip may partly be that regime change). The latent
  factor adds +0.7–2.9% relative on top (≤ 0.4 points of fleet). The GPU sibling's fleet-size
  REVERSAL does not reproduce here because there is no small-N protection to lose: per-leaf
  e-values are individually invalid under dispersion, so the failing fraction is ς-determined
  at every N.
- **D (drift) — no additional effect; the apparent trend was a draw artifact, caught; the
  claim is now MEASURED, not argued.** Counts track the REALIZED dispersion of the drawn
  population (0.235 → 0.173 as the driftMix redraw changes the fixed draw set), not driftMix
  itself. Mechanistically expected: nothing calibrated is per-leaf (cells are hour×dow×tc, AR
  pooled, Family C Σ pooled, Family D peaks pooled — cold-eye-verified across every component),
  so WHICH leaves are noisy cannot matter — only how dispersed the population is. The direct
  control (cold-eye finding 7, published in the artifact): the m=1 σ-set run as a BASE draw
  (calibration under the same assignment) gives **9.38 vs the drift cell's 9.88** at identical
  realized ς 0.173 — no cal→live-mismatch effect. The first reading of this axis ("drift
  reduces false selections") was wrong; the realized-ς column was added so the table itself
  says so (DISCIPLINES §7).

**Recorded follow-up direction (each its own ADR, per anti-scope):** (1) per-leaf scale in
calibration — per-path-class cells with the ADR-0006 min-sample pooling fallback; (2) a
population-dispersion GATE — estimate ς̂ from calibration residuals and abstain from
FDR-bearing claims above the measured floor (the GPU sibling's pair-gate analog, with THIS
study's floor as the threshold evidence); (3) extending ADR-0032 with a ς axis (power under
heterogeneity). Real-fabric validation (N2) should not proceed ahead of (2): the boundary
sits well inside plausible real-fabric heterogeneity.
