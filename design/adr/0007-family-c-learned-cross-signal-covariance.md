# ADR 0007 — Family C learned cross-signal covariance

- **Status:** Accepted
- **Date:** 2026-06-09
- **Decision owner:** Tessera-RNG (post-v1)
- **Supersedes:** —

---

## Context

Family C is the engine's Safe-Hotelling sequential e-process — a multivariate, anytime-valid test
of the per-path-class signal vector against a baseline covariance Σ. Its log-wealth update is

```
z_t = −precompiled_log_det_shrink + ½·xᵀ Σ⁻¹ x − ½·xᵀ (Σ+τ²I)⁻¹ x,
      precompiled_log_det_shrink = ½·log( det(Σ+τ²I) / det(Σ) ).
```

v1 set **Σ = I_p**: residuals are per-cell standardized to unit marginal variance, so the diagonal
is right, but the cell never learned the **off-diagonal** structure. With Σ = I the data term
collapses to ½·(τ²/(1+τ²))·‖x‖² — a function of the Euclidean norm alone. Real network signals
co-move (a shared optic degrading lifts latency *and* loss together), so the *informative* failure
is a shift that **violates the learned co-movement** — e.g. two normally-correlated signals that
begin moving oppositely. Such a shift can have a small Euclidean norm yet a large Mahalanobis
distance xᵀΣ⁻¹x. An identity-Σ cell is blind to it; only a learned Σ sees it.

## Decision

Learn the Family C baseline covariance from the **clean calibration residuals** and feed it to the
detector:

1. **New module `src/covariance.ts`** (pure arithmetic; the engine's cholesky/log-det live behind a
   `_`-prefixed internal path that N5 forbids importing, so these are independent implementations):
   `cholesky`, `logDet`, `sampleCovariance`, and **Ledoit-Wolf (2004) shrinkage** toward the
   scaled-identity target μI (μ = trace(S)/p). LW gives a well-conditioned, invertible Σ and drives
   spurious off-diagonals toward identity, so uncorrelated signals recover Σ ≈ I (λ → 1) while real,
   well-sampled structure is kept (λ → 0).
2. **`family-c.ts`** gains `estimateBaselineCovariance(residuals)` (global LW over all path-classes ×
   ticks) and `makeFamilyCCellFromCovariance(Σ, α, τ²)`, which **recomputes**
   `precompiled_log_det_shrink = ½·(logDet(Σ+τ²I) − logDet(Σ))` for the real Σ. The identity helper
   `makeFamilyCCell` is retained — its `(p/2)·log(1+τ²)` is exactly this term at Σ = I.
3. **Pipeline** standardizes the clean calibration window, estimates Σ from those residuals, and
   passes the learned cell through `detectAll(…, familyCCell)`. `detectAll`/`detectPathClass` take an
   optional cell; omitted ⇒ identity (backward-compatible).
4. **Telemetry** gains a `noiseCorr` (cross-signal correlation of the innovation, via `L = chol(R)`)
   and a `degradedNoiseCorr` (a pure **second-order** degradation: affected path-classes flip their
   correlation from `start_tick` with no marginal mean/variance change). Default (no `noiseCorr`)
   reproduces the v1 RNG stream **byte-for-byte** (guarded by a test) — the draw order is unchanged
   and L = I.

τ² stays at `DEFAULT_TAU_SQUARED = 1`, so the only change vs v1 is Σ and its log-det term — a fair
comparison. Σ is learned **globally** (one cell for all path-classes): the calibration window has
thousands of residual rows, so the estimate is stable; per-cell Σ is possible future work.

## Consequences

- **Catches what identity missed.** On a clean fabric where signals 0 and 2 carry ρ = 0.9, a pure
  correlation flip (ρ → −0.9) on the path-classes through a degraded shuffler — *no* marginal mean or
  variance change — is caught by the learned-Σ cell on **every** affected path-class, while the
  identity-Σ cell (and the per-signal Family A) select **zero**. (Binding test in `family-c.test.ts`.)
- **FDR preserved.** The same learned Σ on a clean correlated window selects nothing — learning Σ
  does not inflate the null. Uncorrelated telemetry → Σ ≈ I, so existing scenarios/replay are
  unchanged (93→94 tests green; byte-identical replay holds).
- **New math, mutation-tested.** `covariance.ts` + the new `family-c.ts` functions score **93%**
  (13/14) under `arch mutate`. The lone survivor is the pre-existing `M >= 1/α` fire boundary in
  `runFamilyC` (`>=` → `>`): a measure-zero equality, practically unkillable, and not new code.
- **Ledoit-Wolf is the centered estimator.** S and the dispersion b̄² are both computed from the
  same mean-centered rows (a cold-eye review caught an earlier mean-leaking b̄²); the degenerate
  `n<2` path returns a positive-definite scaled identity (μ floored to ≥ a positive value).
- **N5 intact.** Only the engine's public Safe-Hotelling surface is consumed; cholesky/log-det are
  re-implemented in `src/`, not deep-linked from the engine.
- **Honest limits.** Σ is global, not per-cell; τ² is fixed (not the engine's scale-invariant
  `c·trace(Σ)/p`); LW shrinks toward a scaled identity (not a factor model). All recorded as future
  work.
