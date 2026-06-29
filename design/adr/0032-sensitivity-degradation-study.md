# ADR 0032 — Sensitivity / degradation study (synthetic robustness envelope)

- **Status:** PROPOSED (spec-first; not yet built). Sketch — acceptance bar drafted, scope
  bounded; not yet owner-ratified.
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
| **Routing churn** | reconvergence unrelated to the fault (reroute noise) | spurious-epoch rate (reuses the ADR-0017 epoch machinery) |
| **Aggregation error** | view-level rollup mis-attributing pair traffic | perturbation on the incidence weights feeding the leaf |

Axes are **composable** (per ADR-0021's compose contract) so a small number of joint regimes can
be measured, not just one-axis-at-a-time.

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

## Prescription → AC coverage (DISCIPLINES §4) — draft

| Prescription | Binding test ("Then") |
|---|---|
| Intensity-0 ≡ clean baseline | the degradation harness at all-zero intensity reproduces `coverage-saturation.json` byte-for-byte; mutating the harness to leak noise at 0 ⇒ this test fails |
| Each axis genuinely perturbs | per axis, a fixture where raising intensity provably shifts the standardized stream (delete the axis's effect ⇒ floor is unchanged ⇒ test fails — anti-self-confirming) |
| Monotone, seeded, composable | floors are monotone non-improving in intensity; two axes compose per ADR-0021; re-running a seed is byte-identical |
| Breakdown frontier is real | for ≥1 axis, a regime exists where the floor *does* regress (a study that never breaks is measuring nothing) and a regime where it holds |
| Sample size raised & stated | per-cell n is published and ≥ a threshold large enough that the frontier is stable across an extra held-out seed block (kills the "n=4-fragile frontier" objection) |
| Honest caveat | the artifact names its estimator coarseness and its synthetic-only reach, in-file (instrumented-caveat), and points back to `VALIDATION.md` Tier 3 |

## Open questions (for owner ratification before build)

1. **Sample size**: what per-cell n makes the frontier trustworthy without blowing the suite
   runtime envelope (ADR-0025)? Proposal: raise to n≥16 on the frontier cells only, keep the
   clean coverage matrix as-is.
2. **Joint regimes**: which 2–3 axis combinations are worth the cost (e.g. noise×missingness as
   the "degraded telemetry" regime; delay×churn as the "reconvergence storm" regime)?
3. **Pass/fail or descriptive?** Recommend **descriptive** — publish the frontier, do not gate on
   it. A gate would smuggle a robustness *claim* back in.

## Consequences (if accepted)

- Converts `VALIDATION.md` Tier 2 from "coherent under its own world" to "coherent, with a
  measured degradation envelope" — the highest-leverage move that stays inside the anti-scope.
- Does **not** touch Tier 3: real telemetry, real fabrics, real incidents remain unvalidated and
  correctly out of v1 scope.
- Pairs naturally with ADR-0029/0031 (magnitude scorer + cross-optic re-add): once full incidence
  is modeled, the same harness measures whether the richer model is *more* or *less* robust to
  degradation — a reusable instrument, not a one-off.
