# Tessera-RNG — onset vs N: the dispersion wall under fleet growth (ADR-0059)

Operating point: spraypoint crossOptic-off ramp 109 / 1456 / 6112 leaves (the ADR-0050 N-axis fabrics); 60 ticks, q=0.05, production calibration defaults; gate = the ADR-0051 PAIR at ς*=0.05 on the calibration residuals (perLeafScale arm: on the CORRECTED residuals — in-sample ≈ 0 by construction, which is what makes that arm's laundering column the N-robustness question).

> NULL runs — every selection is false. Synthetic Tier-2. The 109/shared ς∈{0.05,0.1} cells are cross-artifact-anchored to heterogeneity-boundary.json (same seeds/composition, test-bound). LAUNDERING = gate passes while e-BH false-selects — where that column is nonzero, the fixed ς* is anti-conservative at that scale; no threshold change is made here (the redesign decision is parked with the operator, ADR-0059). Onset estimates are grid-resolution-limited and small-n.

## Onsets (first grid ς with mean false selections > 0)

| leaves | shared | perLeafScale |
|---|---|---|
| 109 | 0.075 | none ≤ 0.15 |
| 1456 | 0.05 | none ≤ 0.15 |
| 6112 | 0.05 | none ≤ 0.15 |

## Arm: shared

| leaves | ς | mean false sel | max | gate pass | LAUNDERING | n |
|---|---|---|---|---|---|---|
| 109 | 0.02 | 0.00 | 0 | 100% | 0% | 8 |
| 109 | 0.05 | 0.00 | 0 | 13% | 0% | 8 |
| 109 | 0.075 | 2.25 | 4 | 0% | 0% | 8 |
| 109 | 0.1 | 5.25 | 8 | 0% | 0% | 8 |
| 109 | 0.15 | 12.25 | 14 | 0% | 0% | 8 |
| 1456 | 0.02 | 0.00 | 0 | 100% | 0% | 5 |
| 1456 | 0.05 | 0.40 | 1 | 100% | 40% | 5 |
| 1456 | 0.075 | 8.80 | 11 | 0% | 0% | 5 |
| 1456 | 0.1 | 33.00 | 43 | 0% | 0% | 5 |
| 1456 | 0.15 | 113.60 | 118 | 0% | 0% | 5 |
| 6112 | 0.02 | 0.00 | 0 | 100% | 0% | 3 |
| 6112 | 0.05 | 0.67 | 1 | 100% | 67% | 3 |
| 6112 | 0.075 | 32.33 | 37 | 0% | 0% | 3 |
| 6112 | 0.1 | 144.67 | 157 | 0% | 0% | 3 |
| 6112 | 0.15 | 486.67 | 494 | 0% | 0% | 3 |

## Arm: perLeafScale

| leaves | ς | mean false sel | max | gate pass | LAUNDERING | n |
|---|---|---|---|---|---|---|
| 109 | 0.02 | 0.00 | 0 | 100% | 0% | 8 |
| 109 | 0.05 | 0.00 | 0 | 100% | 0% | 8 |
| 109 | 0.075 | 0.00 | 0 | 100% | 0% | 8 |
| 109 | 0.1 | 0.00 | 0 | 100% | 0% | 8 |
| 109 | 0.15 | 0.00 | 0 | 100% | 0% | 8 |
| 1456 | 0.02 | 0.00 | 0 | 100% | 0% | 5 |
| 1456 | 0.05 | 0.00 | 0 | 100% | 0% | 5 |
| 1456 | 0.075 | 0.00 | 0 | 100% | 0% | 5 |
| 1456 | 0.1 | 0.00 | 0 | 100% | 0% | 5 |
| 1456 | 0.15 | 0.00 | 0 | 100% | 0% | 5 |
| 6112 | 0.02 | 0.00 | 0 | 100% | 0% | 3 |
| 6112 | 0.05 | 0.00 | 0 | 100% | 0% | 3 |
| 6112 | 0.075 | 0.00 | 0 | 100% | 0% | 3 |
| 6112 | 0.1 | 0.00 | 0 | 100% | 0% | 3 |
| 6112 | 0.15 | 0.00 | 0 | 100% | 0% | 3 |

## Truncations (no silent caps)

- ς grid capped at 0.15 (the ADR-0050 boundary region; higher is measured there)
- sizes 360/3176 skipped (the trend is bound by three fabric sizes spanning 56× — 109 to 6112 leaves)
- 1456 leaves: n=5 seeds (runtime)
- 6112 leaves: n=3 seeds (runtime)
