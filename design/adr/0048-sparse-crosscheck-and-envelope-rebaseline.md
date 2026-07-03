# ADR 0048 — Sparse-recovery cross-check + degradation-envelope re-baseline under the linear scorer

- **Status:** ACCEPTED
- **Date:** 2026-07-02
- **Decision owner:** Tessera-RNG
- **Relates to:** ADR-0046 (the linear member model both halves check), ADR-0032 (the envelope
  being re-baselined), DISCIPLINES §6 (cross-validate against an independent reference),
  `test/sparse-crosscheck.test.ts`, `coverage-matrices/degradation-saturation.{json,md}`.

---

## 1. Sparse-recovery cross-check (the anti-self-confirming reference)

The ADR-0046 localizer is a greedy mixture-LLR cover on the linear model y ≈ √T·W·θ. A wrong
implementation could be self-consistent, so the suite now carries an INDEPENDENT reference that
solves the same observation model by a different algorithm: **non-negative LASSO** via projected
cyclic coordinate descent (min ½‖y − √T·Wθ‖² + λ‖θ‖₁, θ ≥ 0) — the compressed-sensing
formulation, whose recovery conditions expander incidence matrices are known to satisfy
(Firooz & Roy, arXiv:1106.0941; the Spraypoint fabric is exactly such a design). λ is the
universal threshold σ√(2 ln R) — the ADR-0046 look-elsewhere charge in its L1 guise, not a knob.

Measured agreement (bound as tests): cross-kind δ=16 support {optic-3, panel-7} (2 seeds), room
Δ=3 rank-1, clean ⇒ both empty. The reference lives in TEST code deliberately — it is a
cross-check, not a second production localizer (one shipped ranking, N1; no dueling outputs).
Disagreement on any fixture fails the suite and names the fixture.

## 2. Degradation-envelope re-baseline (staleness honesty)

`coverage-matrices/degradation-saturation.{json,md}` was measured under the z-currency scorer
(ADR-0032). ADR-0046 changed the production localizer, so the committed envelope described a
scorer that no longer runs — re-measured with the same harness (n=32/cell; the intensity-0
byte-identity anchor to `runPipeline` already re-bound in the ADR-0046 round via `leafTStats`
threading in `tools/degradation.ts`).

**Findings (observed diff vs the z-scorer envelope, n=32/cell):**

| axis | z-scorer breakdown (ADR-0032) | linear-scorer breakdown |
|---|---|---|
| signal_noise | 0.25σ (53%), 0.5σ (0%) | **0.5σ (81%)**; 0.25σ back to 100%; ≥1σ still 0% |
| missingness | 0.8 drop-prob (0%) | 0.8 drop-prob **94%** |
| observation_delay | 8 ticks (75%), 20 (50%) | **never — 100% across the grid** |
| aggregation_error | never (held) | never (held) |
| joint lossy_aggregation | 94% | **100%** |
| joint degraded_telemetry (1σ + 25% missing) | 0% | 0% (the extreme joint stands) |

Mechanism, as predicted: spurious noise-fired leaves carry small magnitudes and small predicted
μ under the linear model, instead of binary-equal votes flooding the cover. The ADR-0032
headline ("silent mis-attribution, sharpest at 0.25σ") is now "attribution survives to ~0.5σ and
degrades gracefully"; detection never collapses on any axis (unchanged).

## Consequences

- **Round-H evidence columns NOT built** (co-onset synchrony, CorrOpt CV/utilization
  fingerprint, mix-vs-level check, 1/h vote normalization): their target regime — sub-σ noise
  flooding the cover — is measured-moot under the linear scorer, and the ≥1σ regime's recorded
  fix direction remains live-calibration tracking (ADR-0032), which no scorer feature
  substitutes for. Anti-gold-plating (the ADR-0042 lesson); revisit only if a future envelope
  shows a gap these address.
- `VALIDATION.md`'s degradation row updated to the re-baselined numbers.
