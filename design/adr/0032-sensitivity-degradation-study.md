# ADR 0032 — Sensitivity / degradation study (synthetic robustness envelope)

- **Status:** ACCEPTED (built and measured — `tools/degradation.ts`,
  `test/degradation.test.ts`, `coverage-matrices/degradation-saturation.{json,md}`). Four of the
  five proposed axes built; **routing churn narrowed out with rationale** (below). The three open
  questions are resolved as recommended. 209 tests green, gate PASS.
- **Date:** 2026-06-29
- **Decision owner:** Tessera-RNG (post-v1; prompted by an external validation review)
- **Relates to:** the v1 anti-scope (`CLAUDE.md` — no live fabric / customer telemetry),
  `VALIDATION.md` (Tier 2 vs Tier 3), ADR-0010/0024 (honest-measurement floors), ADR-0028
  (the deliberate cross-optic omission), the coverage matrix (`coverage-matrices/`).

---

## Context

An external review found the validation *sufficient for the synthetic v1 scope, insufficient for
the stronger claim that RNG fault localization works in the real world*. That verdict is correct
and largely the project's own stated position (the anti-scope). The review's sharpest point:
the repo proves the math is **coherent under its own synthetic world**, but does not characterize
**how close to the model the world must be** before localization degrades.

Two paths close that gap. (a) Replay against real path-level telemetry — **out of scope** (needs
customer/live data the anti-scope forbids in v1). (b) A **sensitivity study**: perturb the
synthetic world along the axes real telemetry is known to differ from the clean model, and
measure where the floors break. Path (b) is fully synthetic — it honors the anti-scope — yet
directly answers the review's deepest question. This ADR scopes (b).

This is **measurement, not a new guarantee**. It publishes a degradation envelope; it changes no
detector, no FDR claim, and no published floor on the *clean* fabric.

## Decision (proposed)

Add a **perturbation harness** that wraps the existing synthetic telemetry stream with a set of
named, seeded, composable degradations, and a **degradation-coverage matrix** that re-measures
detection and localization floors as each degradation intensifies. The clean point (all
intensities 0) must reproduce today's coverage matrix **byte-for-byte** — the anti-self-confirming
anchor.

### Perturbation axes (each: off at intensity 0, monotone, independently seeded)

| Axis | Models | Knob |
|---|---|---|
| **Signal noise** | telemetry SNR worse than the calibrated null | extra variance multiplier on the standardized residual |
| **Missingness** | dropped/absent samples per path-class per tick | Bernoulli drop probability |
| **Observation delay** | telemetry arriving late vs. the fault | per-signal lag in ticks |
| ~~**Routing churn**~~ | reconvergence unrelated to the fault | **NARROWED OUT — see below** |
| **Aggregation error** | view-level rollup mis-attributing pair traffic | ±perturbation of the **localizer's** incidence weights only — telemetry physics keeps the true weights, so this isolates a true-vs-believed-incidence *mismatch* (cold-eye fix) |

Axes are **composable** (per ADR-0021's compose contract) so a small number of joint regimes can
be measured, not just one-axis-at-a-time.

**Routing churn narrowed out (recorded, not silent — DISCIPLINES §2).** Churn is the one axis
that is *not* a telemetry-quality perturbation: a faithful model reuses the ADR-0017/0018
epoch/reroute machinery (valid `RerouteEvent`s that preserve the path-class population, e-process
wealth resets), which is its own already-built, already-tested subsystem. Folding it into this
harness would either half-implement it (spurious series jumps that don't exercise the real reset
path — worse than nothing) or duplicate the epoch validation that lives in `src/`. The four axes
built here all attach cleanly at the telemetry-series or incidence-weight layer and share one
byte-identity anchor; churn belongs in a separate measurement against the epoch path. **Deferred,
not dropped.**

### Output

A `degradation-saturation.{json,md}` artifact alongside the existing coverage matrix: for each
axis (and a few joint regimes), the intensity at which detection floor and attribution floor
first regress past the clean baseline — the **breakdown frontier**. Reported with the same
coarse-estimator caveat the coverage matrix already carries, **plus the per-cell n made explicit
and raised** (see acceptance bar) so the frontier is not itself n=4-fragile.

## Anti-scope (must-never)

- **No real data.** Purely synthetic perturbations of the existing stream. Tier 3 stays empty.
- **No detector / FDR / family change.** The harness perturbs *inputs*; the stack under test is
  unchanged. No published guarantee moves.
- **No clean-fabric floor change.** Intensity-0 reproduces the current coverage matrix
  byte-for-byte; if it cannot, the harness is contaminating the null and the round **halts**.
- **No new knob in the product.** The perturbation harness lives in `test/` / `tools/`, never in
  `src/` runPipeline. It is a measurement instrument, not a feature.
- **No "robustness proven" language.** The artifact reports a *breakdown frontier on the synthetic
  model*; it does not claim real-world robustness (that is still Tier 3).

## Prescription → AC coverage (DISCIPLINES §4) — bound

| Prescription | Binding test (`test/degradation.test.ts`) — built |
|---|---|
| Intensity-0 ≡ pipeline baseline | `intensity-0 reproduces runPipeline BYTE-FOR-BYTE` (clean + fault × 2 seeds, any perturb seed). The anchor is bound to `runPipeline` directly, not a stored artifact — stronger (no stale fixture). A no-op-at-0 leak ⇒ fails. |
| Each axis genuinely perturbs | one test per axis asserting the audit changes; aggregation-error binds the **snapshot hash**. Hand-mutant (no-op `applyNoise`) kills 5 tests including the anchor's partner — recorded below. |
| Seeded, composable | `seeded determinism` (same spec+seed ⇒ identical) and `composition` (joint ≠ either single axis). |
| Breakdown frontier is real | `breakdown frontier is REAL` — attribution holds at 0.01σ (== clean), collapses at 6σ; a study that never breaks measures nothing. |
| Sample size raised & stated | per-cell **n=32** published (2 targets × 2 telemetry × 8 perturbation seeds); `frontier is stable across a HELD-OUT seed block` runs two disjoint 8-seed blocks that must agree — kills the n=4-fragile-frontier objection. |
| Honest caveat | the artifact carries its synthetic-only / clean-calibration caveat in-file and points to `VALIDATION.md`. |

## Open questions — RESOLVED (as recommended; owner may revise)

1. **Sample size** → **n=32 per cell** (2 targets × 2 telemetry seeds × 8 perturbation seeds), with
   a held-out-block stability test. The envelope is a `tools/` artifact, not part of `pnpm test`,
   so it carries no suite-runtime cost; the in-suite frontier tests use small blocks.
2. **Joint regimes** → **two**: `degraded_telemetry` (noise 1σ + 25% missing) and
   `lossy_aggregation` (50% missing + ±25% weight). (The proposed delay×churn "reconvergence storm"
   is dropped with churn.)
3. **Descriptive, not a gate.** The artifact publishes the frontier; nothing gates on it. A pass/fail
   threshold would smuggle a robustness *claim* back in, violating this ADR's own anti-scope.

## Findings (built — `coverage-matrices/degradation-saturation.md`)

Operating point: `DEFAULT_SPRAYPOINT`, an optic fault at Δ=3, clean run detects + attributes 100%.

- **The dominant failure mode is silent MIS-attribution, not silence.** On every axis, *detection*
  (something selected) stays ~100% well past where *attribution* (true culprit ranks #1) collapses
  (detection never breaks within any grid). Uncalibrated degradation doesn't quiet the system — it
  makes it confidently localize the wrong resource. The meaningful frontier is therefore attribution.
- **Signal noise is the sharpest axis.** Attribution holds through 0.1σ of added noise, is half-gone
  by 0.25σ, and zero by 0.5σ — against a Δ=3 fault. Mechanism (corrected per cold-eye): the noise is
  *independent* per sample/signal/leaf and is added uncalibrated, so it does not cancel — it **floods
  the noisy-OR localizer with spurious firing leaves**, tipping rank-1 toward a higher-incidence
  resource than the true diluted optic. (It is false-alarm flooding of the ranker, not common-mode
  cancellation.) This is the single biggest sensitivity and it directly motivates ADR-0029 (magnitude
  scorer, which would down-weight barely-firing leaves) and a live-calibration story.
- **Missingness and delay are gentle**; attribution survives 50% drop and 3-tick lag, degrading only
  at 80% drop / 8–20-tick lag.
- **Aggregation (weight) error is the most robust axis** — attribution holds across the full ±90%
  grid. Because this axis now perturbs *only the localizer's incidence belief* (not the physical
  fault — the isolation fix from the cold-eye), the result is a clean statement: the marginal-LLR
  ranking is driven by *which* leaves fire, not their exact weights, so the localizer tolerates large
  incidence-weight mismatch. (The earlier conflated version perturbed the whole fabric and spuriously
  showed a detection drop that was really the injected fault shrinking — fixed.)
- **Joint:** `degraded_telemetry` (1σ + 25% miss) already breaks attribution (the noise term
  dominates); `lossy_aggregation` (50% miss + ±25% weight) stays at 94% — two individually-gentle
  axes compose gently.

### Mutation record

Hand-mutant: `applyNoise` → no-op (the "transform does nothing" mutant). Recompiled, ran
`test/degradation.test.js`: **5/11 fail** (the anchor's partner, the noise axis, composition, and
both frontier tests), confirming the anti-self-confirming guards bite. Reverted; 11/11 green.

## Consequences

- Converts `VALIDATION.md` Tier 2 from "coherent under its own world" to "coherent, **with a
  measured degradation envelope and a named sharpest-failure axis**" — the highest-leverage move
  inside the anti-scope. VALIDATION.md updated.
- Does **not** touch Tier 3: real telemetry, real fabrics, real incidents remain unvalidated and
  correctly out of v1 scope. The noise finding is a *synthetic* fragility, not a real-world claim.
- Reusable instrument: pairs with ADR-0029/0031 (magnitude scorer + cross-optic re-add) — once full
  incidence is modeled, the same harness measures whether the richer model is *more* or *less*
  robust, especially on the noise axis where dilution currently hurts most.
- **Follow-ups:** (a) routing-churn axis against the epoch path (deferred above); (b) the noise
  finding argues for live-calibration tracking — a Tier-3-adjacent design question, owner-deferred.
