# Tessera-RNG — coverage/saturation & floor matrices (AC-10)

Synthetic fabric `synthetic-rng-fabric:132472394`; 2 seeds × 2 targets per cell; FDR target q=0.05.
Every cell reports **detection** and **attribution** as parallel columns — a strong detection rate never hides weak localization.

## Perturbation model & scope (read before the numbers)

The first **floor table** characterizes a single-signal **`p99_latency` mean shift** (Δ added to
the p99 residual of every path-class traversing the target resource) — the calibrated reference
response, so its floors are floors *for a p99 mean shift*, not a blanket "any degradation"
guarantee. The **per-signal section** exercises the full five-signal contract: a mean shift on each
signal (Family A is multi-signal, ADR-0003) plus a pure variance shift (caught by Family C, not A).
The **per-mode floor table** (ADR-0010) goes further: it reports a separate detection/attribution
floor for EACH of the three anomaly modes — mean shift (Family A), covariance flip (Family C), and
periodicity (Family D) — with the firing family that caught it, so a detection number is never
published without naming its mode. No mode is left in a footnote. The binary tables above are
the generated quasi-random fabric; the **Spraypoint sections** below measure the two-view
FRACTIONAL-dilution fabric (ADR-0015/0020) — per-view blind spots, dilution floors, the
multi-fault pair floors (ADR-0024), and its own clean-fabric FDR control. Every floor is the
first Δ reaching ≥90% — single-fault tables on an n=4 grid (2 targets × 2 seeds), the
multi-fault table on n=2 (FIXED pairs × 2 seeds): a floor means "first unanimous Δ" — a
coarse, honest estimator, grid-resolution-limited (reported at grid points, not interpolated).

## Coverage / saturation

| resource kind | Δ (mean shift) | detection | attribution |
|---|---|---|---|
| optic | 0.5 | 0% (0/4) | 0% (0/4) |
| optic | 1 | 75% (3/4) | 75% (3/4) |
| optic | 2 | 100% (4/4) | 100% (4/4) |
| optic | 3 | 100% (4/4) | 100% (4/4) |
| passive_shuffler | 0.5 | 0% (0/4) | 0% (0/4) |
| passive_shuffler | 1 | 100% (4/4) | 50% (2/4) |
| passive_shuffler | 2 | 100% (4/4) | 100% (4/4) |
| passive_shuffler | 3 | 100% (4/4) | 100% (4/4) |
| fiber_bundle | 0.5 | 0% (0/4) | 0% (0/4) |
| fiber_bundle | 1 | 75% (3/4) | 50% (2/4) |
| fiber_bundle | 2 | 100% (4/4) | 100% (4/4) |
| fiber_bundle | 3 | 100% (4/4) | 100% (4/4) |
| power_zone | 0.5 | 0% (0/4) | 0% (0/4) |
| power_zone | 1 | 100% (4/4) | 100% (4/4) |
| power_zone | 2 | 100% (4/4) | 100% (4/4) |
| power_zone | 3 | 100% (4/4) | 100% (4/4) |

## Detection & attribution floors (smallest Δ reaching ≥90%)

| resource kind | detection floor (Δ) | attribution floor (Δ) |
|---|---|---|
| optic | 2 | 2 |
| passive_shuffler | 1 | 2 |
| fiber_bundle | 2 | 2 |
| power_zone | 1 | 1 |

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

## Per-mode detection floors — A + C + D (ADR-0010)

Each of the three anomaly modes swept independently (kind=passive_shuffler, 2 seeds × 2 targets).
The **firing family** column is the firing-mode attribution: which detector actually caught each mode.

| mode | unit | detection floor | attribution floor | detecting family | per-magnitude (mag → det / family) |
|---|---|---|---|---|---|
| mean_shift | Δ (p99 mean) | 1 | 2 | A | 0.5→0%/none, 1→100%/A, 2→100%/A+C, 3→100%/A+C |
| covariance_flip | Δρ (corr change) | 0.2 | 0.4 | C | 0→0%/none, 0.1→0%/none, 0.2→100%/C, 0.4→100%/C, 0.9→100%/C, 1.4→100%/C, 1.8→100%/C |
| oscillation | amplitude (period 7) | 0.9 | 0.9 | D | 0.3→0%/none, 0.5→0%/none, 0.7→50%/D, 0.9→100%/D |

## Spraypoint per-view detection (ADR-0015) — which view concentrates each fault kind

On the two-view Spraypoint fabric (`per_tor` ∪ `per_panel_pair`, weighted/diluted incidence),
the views have COMPLEMENTARY blind spots — published here, not implied. An optic fault is
1/nTors-diluted in pair leaves; a panel fault is 1/nPanels-diluted in ToR leaves.

| fault kind | resource | per-view detected | concentrated by |
|---|---|---|---|
| optic | optic-3 | per_tor:1 | per_tor |
| shuffle_panel | panel-2 | per_panel_pair:9 | per_panel_pair |
| room | room-1 | per_panel_pair:35, per_tor:64 | per_panel_pair+per_tor |

## Spraypoint dilution floors (ADR-0020) — the fractional-incidence regime, measured

Floors on the two-view Spraypoint fabric (64×10×2; weighted/diluted incidence) under a
`p99_latency` mean shift — the regime ADR-0014 deferred. Same floor semantics as the binary
table above. Read against the binary fabric's nearest-analogue kinds (optic↔optic,
shuffle_panel↔passive_shuffler, room↔power_zone — a DIFFERENT fabric, so the comparison is
indicative, not a controlled dilution-only experiment): **detection** floors match the binary
analogues (each kind has a w=1 view), but the **room attribution floor RISES 1 → 2** vs
power_zone 1/1 — a room fault at Δ=1 is detected 4/4 yet attributed 0/4 (the ADR-0019
wrong-kind band; the true boundary sits between 1.5 and 2 — Δ=1.5 attributes 2/4).

| fault kind | detection floor (Δ) | attribution floor (Δ) |
|---|---|---|
| optic | 2 | 2 |
| shuffle_panel | 1 | 2 |
| room | 1 | 2 |

| fault kind | Δ | detection | attribution |
|---|---|---|---|
| optic | 0.5 | 0% (0/4) | 0% (0/4) |
| optic | 1 | 25% (1/4) | 25% (1/4) |
| optic | 2 | 100% (4/4) | 100% (4/4) |
| optic | 3 | 100% (4/4) | 100% (4/4) |
| optic | 4 | 100% (4/4) | 100% (4/4) |
| shuffle_panel | 0.5 | 0% (0/4) | 0% (0/4) |
| shuffle_panel | 1 | 100% (4/4) | 75% (3/4) |
| shuffle_panel | 2 | 100% (4/4) | 100% (4/4) |
| shuffle_panel | 3 | 100% (4/4) | 100% (4/4) |
| shuffle_panel | 4 | 100% (4/4) | 100% (4/4) |
| room | 0.5 | 50% (2/4) | 0% (0/4) |
| room | 1 | 100% (4/4) | 0% (0/4) |
| room | 2 | 100% (4/4) | 100% (4/4) |
| room | 3 | 100% (4/4) | 100% (4/4) |
| room | 4 | 100% (4/4) | 100% (4/4) |

## Multi-fault floors (ADR-0024) — simultaneous two-fault pairs, Spraypoint fabric

Both faults injected at equal Δ from tick 0; the standard 2 seeds (n=2 per cell — the same
coarse "first unanimous Δ" estimator as every table here). **Attribution = BOTH injected
resources in the top-2 culprits** (strict: a spurious culprit outranking either fails the
run). Pairs: cross_kind = optic-3 + panel-7 (the ADR-0022 discriminating shape); same_kind =
optic-3 + optic-40. k ≥ 3 simultaneous faults are example-tested, not floor-measured.

| pair | detection floor (Δ) | attribution floor (Δ, both-in-top-2) |
|---|---|---|
| cross_kind | 1 | 2 |
| same_kind | 2 | 2 |

| pair | Δ | detection | attribution (both-in-top-2) |
|---|---|---|---|
| cross_kind | 0.5 | 0% (0/2) | 0% (0/2) |
| cross_kind | 1 | 100% (2/2) | 50% (1/2) |
| cross_kind | 2 | 100% (2/2) | 100% (2/2) |
| cross_kind | 3 | 100% (2/2) | 100% (2/2) |
| cross_kind | 4 | 100% (2/2) | 100% (2/2) |
| same_kind | 0.5 | 0% (0/2) | 0% (0/2) |
| same_kind | 1 | 50% (1/2) | 0% (0/2) |
| same_kind | 2 | 100% (2/2) | 100% (2/2) |
| same_kind | 3 | 100% (2/2) | 100% (2/2) |
| same_kind | 4 | 100% (2/2) | 100% (2/2) |

## Paper-scale proof (ADR-0025) — 960 ToRs, executed not extrapolated

Fabric: **1456 leaves** (960 per-ToR + 496 panel-pair views), 513552 weighted edges, 996 resources — the upper range of AC-1. Clean run selects **0** (FDR holds at scale). Wall-clock/memory are machine numbers and live in ADR-0025, keeping this artifact replay-stable. Floors are NOT swept at this scale (recorded); the demo-scale floors above remain the published floors.

| fault kind | resource | Δ | detected | rank-1 |
|---|---|---|---|---|
| optic | optic-3 | 4 | yes | optic-3 |
| shuffle_panel | panel-2 | 4 | yes | panel-2 |
| room | room-1 | 4 | yes | room-1 |

## FDR control (clean fabric, no degradation)

Across 4 clean trials over 300 path-classes: mean selected = **0**, false-positive rate = **0%** — e-BH holds the surface quiet under heavy correlation.

Spraypoint fabric (the one the dilution floors characterize): 4 clean trials, mean selected = **0**, false-positive rate = **0%** — the dilution detection column does not borrow its false-alarm baseline from another fabric.
