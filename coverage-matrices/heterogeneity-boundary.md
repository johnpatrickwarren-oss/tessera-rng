# Tessera-RNG — heterogeneity boundary (ADR-0050)

Operating point: spraypoint:64x10x2 (H/L/D); crossOptic-off ramp 109→6112 (N — recorded design choice, see tool header); 60 ticks, q=0.05; calibration: robust per-cell, coupled window, seed ⊕ 0xca11b (production defaults).

**Calibration-regime disclosure:** At 109 leaves / 60 ticks every calibration cell is under ROBUST_MIN_CELL_SAMPLES (≈36 < 50) and falls back to the pooled-global baseline — the H/L/D axes (and the 109-leaf N rows) were measured under a SINGLE global scale. At ≥ 360 leaves all cells have genuine per-cell resolution, so the N ramp crosses a calibration-regime boundary between 109 and 360 leaves; the fraction dip across the ramp (≈14.5% → ≈12%) may partly reflect that regime change. The mechanism claim is unaffected (pooled-global is a fortiori shared-not-per-leaf).

> NULL runs only: every selection is a FALSE selection (no degradations injected). Synthetic Tier-2 (VALIDATION.md): maps where the synthetic model breaks under null mechanisms previously absent by construction (ADR-0050); NOT a real-fabric claim, and NOT a power measurement (ADR-0032 owns fault sensitivity). e-BH FDR control is a theorem conditional on valid per-leaf e-values — these axes measure where that condition fails, not a defect in e-BH.

## H — per-leaf scale dispersion (ς)

False-selection onset at **nominal ς = 0.1** (first grid point whose mean exceeds the ς=0 row; quote the onset against the REALIZED ς column — the fixed draw set realizes nominal ς with ±≈20% sampling spread at 109 leaves).

| nominal | realized ς | mean false sel | max | runs selecting | n |
|---|---|---|---|---|---|
| 0 | — | 0 | 0 | 0% | 8 |
| 0.05 | 0.059 | 0 | 0 | 0% | 8 |
| 0.1 | 0.118 | 5.25 | 8 | 100% | 8 |
| 0.2 | 0.235 | 15.50 | 17 | 100% | 8 |
| 0.3 | 0.353 | 18.88 | 20 | 100% | 8 |
| 0.5 | 0.588 | 19 | 20 | 100% | 8 |

## L — correlated null (latent load), ± fleet-level common-mode control (ADR-0036)

### commonModeRobust: false

| intensity | mean false sel | max | runs selecting | n |
|---|---|---|---|---|
| 0 | 0 | 0 | 0% | 8 |
| 0.1 | 0 | 0 | 0% | 8 |
| 0.25 | 0 | 0 | 0% | 8 |
| 0.5 | 0 | 0 | 0% | 8 |

### commonModeRobust: true

| intensity | mean false sel | max | runs selecting | n |
|---|---|---|---|---|
| 0 | 0 | 0 | 0% | 8 |
| 0.1 | 0 | 0 | 0% | 8 |
| 0.25 | 0 | 0 | 0% | 8 |
| 0.5 | 0 | 0 | 0% | 8 |

### joint regime (ς=0.2, load=0.25)

| intensity | mean false sel | max | runs selecting | n |
|---|---|---|---|---|
| cm=false | 15.50 | 17 | 100% | 8 |
| cm=true | 15.50 | 16 | 100% | 8 |

## N — scale ramp (the fleet-size probe)

Note the calibration-regime boundary between 109 and 360 leaves (see the disclosure above): 109-leaf rows run on the pooled-global fallback; larger rows on genuine per-cell calibration.

### clean

| leaves | mean false sel | max | runs selecting | n |
|---|---|---|---|---|
| 109 | 0 | 0 | 0% | 5 |
| 360 | 0 | 0 | 0% | 5 |
| 1456 | 0 | 0 | 0% | 5 |
| 3176 † | 0 | 0 | 0% | 3 |
| 6112 † | 0 | 0 | 0% | 3 |

### dispersion (ς=0.2)

| leaves | mean false sel | max | runs selecting | n |
|---|---|---|---|---|
| 109 | 15.80 | 17 | 100% | 5 |
| 360 | 48.20 | 51 | 100% | 5 |
| 1456 | 173 | 182 | 100% | 5 |
| 3176 † | 378.33 | 381 | 100% | 3 |
| 6112 † | 755 | 762 | 100% | 3 |

### dispersion+latent (ς=0.2, load=0.25)

| leaves | mean false sel | max | runs selecting | n |
|---|---|---|---|---|
| 109 | 16 | 17 | 100% | 5 |
| 360 | 49.60 | 52 | 100% | 5 |
| 1456 | 175.40 | 179 | 100% | 5 |
| 3176 † | 381 | 386 | 100% | 3 |
| 6112 † | 770.67 | 780 | 100% | 3 |

## D — calibration→live drift (driftMix at nominal ς=0.2)

Read this axis against the REALIZED ς column: the drift redraw changes the fixed draw set, so realized dispersion moves with driftMix. False-selection counts track realized ς, not driftMix — the mechanistic finding is that drift adds NO additional effect: the shared-cell calibration never learns per-leaf scale (cellKey has no path-class in it), so WHICH leaves are noisy cannot matter, only how dispersed the population is.

| nominal | realized ς | mean false sel | max | runs selecting | n |
|---|---|---|---|---|---|
| 0 | 0.235 | 15.50 | 17 | 100% | 8 |
| 0.25 | 0.234 | 15.38 | 16 | 100% | 8 |
| 0.5 | 0.226 | 13.88 | 15 | 100% | 8 |
| 1 | 0.173 | 9.88 | 12 | 100% | 8 |

### Direct control (no-mismatch): the m=1 σ-set run as a BASE draw

Same live σ assignment as driftMix=1, but calibration ALSO ran under it — if cal→live mismatch mattered, this row would differ from the m=1 row. Matching counts pin "no drift effect" as a measurement.

| cell | realized ς | mean false sel | max | runs selecting | n |
|---|---|---|---|---|---|
| control | 0.173 | 9.38 | 12 | 100% | 8 |
| driftMix=1 | 0.173 | 9.88 | 12 | 100% | 8 |

## Truncations (no silent caps)

- † scale axis at 3176 leaves: n=3 seeds (runtime), vs n=5 below
- † scale axis at 6112 leaves: n=3 seeds (runtime), vs n=5 below
