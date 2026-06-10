# ADR 0011 — No per-cell second-order structure (keep global Σ and φ)

- **Status:** Accepted
- **Date:** 2026-06-09
- **Decision owner:** Tessera-RNG (post-v1, round 2)
- **Supersedes:** —

---

## Context

Family C's covariance Σ (ADR-0007) and the AR(p) coefficients φ (ADR-0008) are both estimated
**globally** — one Σ and one per-signal φ across all path-classes. The per-cell calibration substrate
(ADR-0006) already keys the **first-order** level/scale `(mean, sd)` by (hour-of-day × day-of-week ×
traffic-class). A natural-sounding refinement is to push the **second-order** statistics per-cell
too: per-cell Σ and per-cell φ. Before building that, the evidence-gated question (DISCIPLINES §2,
anti-scope; §0, halt-on-contradiction — measure, don't assume): *does per-cell second-order structure
exist, and would a per-cell estimator be better?*

## Decision

**Keep Σ and φ global. Do not build per-cell second-order estimators.** The measurement
(`test/percell-second-order.test.ts`, a durable re-runnable artifact) shows there is no per-cell
structure to capture, and that per-cell estimation would be *worse*:

1. **Per-cell Σ carries no structure beyond sampling noise.** On a clean fabric with a known global
   ρ = 0.9, the spread of per-cell Σ[0][2] across 500+ well-sampled cells (sd ≈ 0.09) is **at or below
   the pure-sampling-noise floor** — random global subsets of the same size give sd ≈ 0.12. Real
   per-cell structure would make the per-cell spread *exceed* the floor; it does not.

2. **Per-cell estimation is a *worse* estimate.** Per-cell Σ[0][2] averages ≈ 0.78 vs the global
   estimate ≈ 0.90 (true 0.9): fewer samples per cell → heavier Ledoit-Wolf shrinkage → the
   off-diagonal is attenuated toward identity. Per-cell would systematically *under-report* the real
   correlation — the same small-sample failure ADR-0006 fixed for the first-order `sd`.

3. **Per-class φ is flat.** The global φ pre-whitens all three traffic classes equally well (residual
   lag-1 autocorrelation ≈ 0.007 / −0.011 / −0.011) — no class needs its own coefficient.

4. **Per-cell AR(p) is structurally ill-posed.** AR estimation needs a *temporally contiguous*
   stream; a (hour-of-day × day-of-week) cell is non-contiguous by construction (its samples are one
   tick per week-position), so "per-cell AR(p)" has no contiguous series to fit. The only well-posed
   sub-global AR granularity is per-path-class or per-traffic-class — and (3) shows neither varies.

This is consistent with how the synthetic telemetry is built: the AR coefficients and the
cross-signal correlation are **global by construction** (one `AR1_PHI`, one `noiseCorr`); only the
*level* varies by cell (the diurnal/class smear). So per-cell second-order estimation would add
machinery and estimation variance to chase structure that isn't there.

## Consequences

- **No code added; complexity avoided.** The decision is recorded with its evidence rather than
  building a redundant, sample-starved per-cell estimator. The evidence test guards the call: anyone
  later adding per-cell Σ/φ has to first make this test fail (i.e. demonstrate the structure exists).
- **Conditional, not absolute.** The finding holds for the synthetic fixtures (N2). If *real*
  telemetry (the future real-fabric phase) exhibits per-cell-varying second-order structure, per-cell
  Σ becomes warranted — but it would have to inherit ADR-0006's min-sample discipline (pool to global
  when a cell is under-sampled, or it will attenuate), and AR(p) would be fit per contiguous
  path-class/class stream, never per non-contiguous (HoD×DoW) cell. Recorded here so that work starts
  from the right granularity.
