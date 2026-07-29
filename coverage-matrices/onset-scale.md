# Tessera-RNG — onset vs N: the dispersion wall under fleet growth (ADR-0059)

Operating point: spraypoint crossOptic-off ramp 109 / 1456 / 6112 leaves (the ADR-0050 N-axis fabrics); 60 ticks, q=0.05, production calibration defaults; gate = the ADR-0061 TRIPLE at ς*=0.05 — pair AND z_max ≤ Φ⁻¹(1−0.01/n) — on the calibration residuals (perLeafScale arm: on the CORRECTED residuals — in-sample ≈ 0 by construction, which is what makes that arm's laundering column the N-robustness question).

> NULL runs — every selection is false. Synthetic Tier-2. The 109/shared ς∈{0.05,0.1} cells are cross-artifact-anchored to heterogeneity-boundary.json (same seeds; anchor validity note in the tool header, test-bound). LAUNDERING = gate passes while e-BH false-selects. The PAIR-era run of this sweep measured laundering at paper scale (ADR-0059, preserved there); THIS artifact runs the ratified ADR-0061 TRIPLE gate — the z_max columns make the closure verifiable as data. Onset estimates are grid-resolution-limited and small-n.

## Onsets (first grid ς with mean false selections > 0)

| leaves | shared | perLeafScale |
|---|---|---|
| 109 | 0.075 | none ≤ 0.15 |
| 1456 | 0.05 | none ≤ 0.15 |
| 6112 | 0.05 | none ≤ 0.15 |

## Arm: shared

| leaves | ς | mean false sel | max | gate pass | LAUNDERING | mean z_max | max z_max | z bound | n |
|---|---|---|---|---|---|---|---|---|---|
| 109 | 0.02 | 0.00 | 0 | 88% | 0% | 2.72 | 3.96 | 3.74 | 8 |
| 109 | 0.05 | 0.00 | 0 | 0% | 0% | 4.41 | 6.07 | 3.74 | 8 |
| 109 | 0.075 | 2.25 | 4 | 0% | 0% | 6.04 | 7.82 | 3.74 | 8 |
| 109 | 0.1 | 5.25 | 8 | 0% | 0% | 7.74 | 9.48 | 3.74 | 8 |
| 109 | 0.15 | 12.25 | 14 | 0% | 0% | 11.18 | 13.01 | 3.74 | 8 |
| 1456 | 0.02 | 0.00 | 0 | 100% | 0% | 3.41 | 3.75 | 4.35 | 5 |
| 1456 | 0.05 | 0.40 | 1 | 0% | 0% | 4.75 | 5.35 | 4.35 | 5 |
| 1456 | 0.075 | 8.80 | 11 | 0% | 0% | 6.35 | 7.15 | 4.35 | 5 |
| 1456 | 0.1 | 33.00 | 43 | 0% | 0% | 8.20 | 8.93 | 4.35 | 5 |
| 1456 | 0.15 | 113.60 | 118 | 0% | 0% | 11.93 | 12.52 | 4.35 | 5 |
| 6112 | 0.02 | 0.00 | 0 | 100% | 0% | 3.71 | 3.82 | 4.65 | 3 |
| 6112 | 0.05 | 0.67 | 1 | 0% | 0% | 5.60 | 6.11 | 4.65 | 3 |
| 6112 | 0.075 | 32.33 | 37 | 0% | 0% | 7.71 | 8.42 | 4.65 | 3 |
| 6112 | 0.1 | 144.67 | 157 | 0% | 0% | 10.03 | 10.73 | 4.65 | 3 |
| 6112 | 0.15 | 486.67 | 494 | 0% | 0% | 14.69 | 15.38 | 4.65 | 3 |

## Arm: perLeafScale

| leaves | ς | mean false sel | max | gate pass | LAUNDERING | mean z_max | max z_max | z bound | n |
|---|---|---|---|---|---|---|---|---|---|
| 109 | 0.02 | 0.00 | 0 | 88% | 0% | 2.14 | 3.96 | 3.74 | 8 |
| 109 | 0.05 | 0.00 | 0 | 100% | 0% | 1.64 | 2.52 | 3.74 | 8 |
| 109 | 0.075 | 0.00 | 0 | 100% | 0% | 1.32 | 2.23 | 3.74 | 8 |
| 109 | 0.1 | 0.00 | 0 | 100% | 0% | 1.12 | 1.67 | 3.74 | 8 |
| 109 | 0.15 | 0.00 | 0 | 100% | 0% | 0.85 | 1.17 | 3.74 | 8 |
| 1456 | 0.02 | 0.00 | 0 | 100% | 0% | 2.70 | 2.99 | 4.35 | 5 |
| 1456 | 0.05 | 0.00 | 0 | 100% | 0% | 2.10 | 2.34 | 4.35 | 5 |
| 1456 | 0.075 | 0.00 | 0 | 100% | 0% | 1.76 | 1.97 | 4.35 | 5 |
| 1456 | 0.1 | 0.00 | 0 | 100% | 0% | 1.51 | 1.64 | 4.35 | 5 |
| 1456 | 0.15 | 0.00 | 0 | 100% | 0% | 1.15 | 1.20 | 4.35 | 5 |
| 6112 | 0.02 | 0.00 | 0 | 100% | 0% | 2.97 | 3.04 | 4.65 | 3 |
| 6112 | 0.05 | 0.00 | 0 | 100% | 0% | 2.31 | 2.48 | 4.65 | 3 |
| 6112 | 0.075 | 0.00 | 0 | 100% | 0% | 1.89 | 1.98 | 4.65 | 3 |
| 6112 | 0.1 | 0.00 | 0 | 100% | 0% | 1.54 | 1.60 | 4.65 | 3 |
| 6112 | 0.15 | 0.00 | 0 | 100% | 0% | 1.09 | 1.13 | 4.65 | 3 |

## Truncations (no silent caps)

- ς grid capped at 0.15 (the ADR-0050 boundary region; higher is measured there)
- sizes 360/3176 skipped (the trend is bound by three fabric sizes spanning 56× — 109 to 6112 leaves)
- 1456 leaves: n=5 seeds (runtime)
- 6112 leaves: n=3 seeds (runtime)
