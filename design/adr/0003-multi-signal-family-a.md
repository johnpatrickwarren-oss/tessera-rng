# ADR 0003 — Multi-signal Family A (average-of-e-values across the signal vector)

- **Status:** Accepted
- **Date:** 2026-06-09
- **Decision owner:** Tessera-RNG (post-v1)
- **Supersedes:** —

---

## Context

v1 wired Family A (mean-shift) to a single signal, `p99_latency`, while Family C (Safe-Hotelling)
consumed the full five-signal residual vector. The v1 cold-eye review flagged this as the most
substantive limitation: the five-signal contract (`p99_latency`, `retransmit_rate`, `loss_rate`,
`ecmp_imbalance`, `path_completion`) was structurally present but operationally exercised on one
signal only, and the coverage matrix characterized a `p99`-mean-shift response while presenting as
a general degradation response.

A mean shift on `retransmit_rate` or `loss_rate` is a perfectly real network degradation that
single-signal Family A would miss entirely.

## Decision

Family A runs an **independent betting e-process per signal** and reports the family e-value as the
**average of the per-signal e-values**.

- Each signal's e-process is the engine's `updateBettingState` at the family's α; validity (the
  e-value property E[M] ≤ 1 under H₀) holds per signal.
- The family e-value is `mean_i(M_i)`. Averaging e-values **preserves the e-value property under
  arbitrary dependence** (the same AoE principle the fleet combiner uses), so the family fires
  validly at `M_family ≥ 1/α_A`. No α-splitting / Bonferroni is needed — multiplicity across
  signals is absorbed by the average, exactly as multiplicity across path-classes is absorbed by
  the fleet combine + e-BH.
- Telemetry's `DegradationSpec` gains an optional target `signal` (default `p99_latency`) and a
  `mode` (`'mean'` | `'variance'`), so degradations can be injected on any signal and the
  coverage sweep can vary the signal dimension.

## Consequences

- The product now detects a mean shift on **any** signal; the five-signal contract is operational.
- **Honest cost:** averaging over `p=5` signals dilutes a single-signal shift by ≈`p`, so the
  detection floor for a single-signal mean shift rises by roughly that factor versus the v1
  single-signal detector. This is the genuine price of monitoring five signals at once and is
  reported in the coverage matrix (which now sweeps the signal dimension), not hidden.
- A pure **variance** shift (mean unchanged) still does not fire Family A — that is Family C's job
  — even though Family A now observes the signal; this A-vs-C division is exercised in tests and
  coverage.
- The verdict schema is unchanged: Family A remains one `DetectorResult` (a family-level summary);
  per-signal detail stays internal. α accounting remains spent-on-fire (ADR-0003 keeps the v1
  convention from the cold-eye fix).
