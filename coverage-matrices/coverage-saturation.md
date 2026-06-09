# Tessera-RNG — coverage/saturation & floor matrices (AC-10)

Synthetic fabric `synthetic-rng-fabric:132472394`; 2 seeds × 2 targets per cell; FDR target q=0.05.
Every cell reports **detection** and **attribution** as parallel columns — a strong detection rate never hides weak localization.

## Perturbation model & scope (read before the numbers)

These floors characterize a **single-signal mean shift**: each injected degradation adds Δ to the
`p99_latency` residual of every path-class traversing the target resource. The full five-signal
vector is plumbed end-to-end and Family C (distributional) consumes all five, but **this sweep does
not perturb the other four signals**, nor inject pure variance/covariance shifts. So the detection
and attribution floors below are floors *for a p99-latency mean shift*, not a general "any
degradation" guarantee. Multi-signal and distributional-shift coverage is future work — stated here,
not in a footnote.

## Coverage / saturation

| resource kind | Δ (mean shift) | detection | attribution |
|---|---|---|---|
| optic | 0.5 | 75% (3/4) | 25% (1/4) |
| optic | 1 | 100% (4/4) | 100% (4/4) |
| optic | 2 | 100% (4/4) | 100% (4/4) |
| optic | 3 | 100% (4/4) | 100% (4/4) |
| passive_shuffler | 0.5 | 100% (4/4) | 25% (1/4) |
| passive_shuffler | 1 | 100% (4/4) | 100% (4/4) |
| passive_shuffler | 2 | 100% (4/4) | 100% (4/4) |
| passive_shuffler | 3 | 100% (4/4) | 100% (4/4) |
| fiber_bundle | 0.5 | 75% (3/4) | 0% (0/4) |
| fiber_bundle | 1 | 100% (4/4) | 100% (4/4) |
| fiber_bundle | 2 | 100% (4/4) | 100% (4/4) |
| fiber_bundle | 3 | 100% (4/4) | 100% (4/4) |
| power_zone | 0.5 | 100% (4/4) | 50% (2/4) |
| power_zone | 1 | 100% (4/4) | 100% (4/4) |
| power_zone | 2 | 100% (4/4) | 100% (4/4) |
| power_zone | 3 | 100% (4/4) | 100% (4/4) |

## Detection & attribution floors (smallest Δ reaching ≥90%)

| resource kind | detection floor (Δ) | attribution floor (Δ) |
|---|---|---|
| optic | 1 | 1 |
| passive_shuffler | 0.5 | 1 |
| fiber_bundle | 1 | 1 |
| power_zone | 0.5 | 1 |

## FDR control (clean fabric, no degradation)

Across 4 clean trials over 300 path-classes: mean selected = **0**, false-positive rate = **0%** — e-BH holds the surface quiet under heavy correlation.
