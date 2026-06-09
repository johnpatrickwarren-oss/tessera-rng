# Tessera-RNG — coverage/saturation & floor matrices (AC-10)

Synthetic fabric `synthetic-rng-fabric:132472394`; 2 seeds × 2 targets per cell; FDR target q=0.05.
Every cell reports **detection** and **attribution** as parallel columns — a strong detection rate never hides weak localization.

## Perturbation model & scope (read before the numbers)

The **floor table** characterizes a single-signal **`p99_latency` mean shift** (Δ added to the
p99 residual of every path-class traversing the target resource) — it is the calibrated reference
response, so its floors are floors *for a p99 mean shift*, not a blanket "any degradation"
guarantee. The **per-signal section** below exercises the full five-signal contract: a mean shift on
each signal (Family A is multi-signal, ADR-0003) plus a pure variance shift (caught by Family C, not
A). Cross-signal covariance shifts remain future work — stated here, not in a footnote.

## Coverage / saturation

| resource kind | Δ (mean shift) | detection | attribution |
|---|---|---|---|
| optic | 0.5 | 50% (2/4) | 0% (0/4) |
| optic | 1 | 100% (4/4) | 100% (4/4) |
| optic | 2 | 100% (4/4) | 100% (4/4) |
| optic | 3 | 100% (4/4) | 100% (4/4) |
| passive_shuffler | 0.5 | 50% (2/4) | 0% (0/4) |
| passive_shuffler | 1 | 100% (4/4) | 100% (4/4) |
| passive_shuffler | 2 | 100% (4/4) | 100% (4/4) |
| passive_shuffler | 3 | 100% (4/4) | 100% (4/4) |
| fiber_bundle | 0.5 | 50% (2/4) | 0% (0/4) |
| fiber_bundle | 1 | 100% (4/4) | 100% (4/4) |
| fiber_bundle | 2 | 100% (4/4) | 100% (4/4) |
| fiber_bundle | 3 | 100% (4/4) | 100% (4/4) |
| power_zone | 0.5 | 100% (4/4) | 0% (0/4) |
| power_zone | 1 | 100% (4/4) | 100% (4/4) |
| power_zone | 2 | 100% (4/4) | 100% (4/4) |
| power_zone | 3 | 100% (4/4) | 100% (4/4) |

## Detection & attribution floors (smallest Δ reaching ≥90%)

| resource kind | detection floor (Δ) | attribution floor (Δ) |
|---|---|---|
| optic | 1 | 1 |
| passive_shuffler | 1 | 1 |
| fiber_bundle | 1 | 1 |
| power_zone | 0.5 | 1 |

## Per-signal coverage (kind=passive_shuffler, mean Δ=3 unless noted)

Demonstrates the system responds to a degradation on **every** signal, and that a variance
(distributional) shift is caught by Family C where Family A is silent.

| signal | mode | Δ | detection | attribution |
|---|---|---|---|---|
| p99_latency | mean | 3 | 100% | 100% |
| retransmit_rate | mean | 3 | 100% | 100% |
| loss_rate | mean | 3 | 100% | 100% |
| ecmp_imbalance | mean | 3 | 100% | 100% |
| path_completion | mean | 3 | 100% | 100% |
| loss_rate | variance | 4 | 100% | 100% |

## FDR control (clean fabric, no degradation)

Across 4 clean trials over 300 path-classes: mean selected = **0**, false-positive rate = **0%** — e-BH holds the surface quiet under heavy correlation.
