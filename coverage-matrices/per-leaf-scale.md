# Tessera-RNG — per-leaf scale calibration: the measured boundary shift (ADR-0052)

Operating point: spraypoint:64x10x2; 60 ticks, q=0.05, robust per-cell calibration (pooled-fallback regime at this size — ADR-0050 disclosure); OFF rows = the ADR-0050 published cells (same seeds, anchor-bound by test).

> Synthetic Tier-2. NULL runs — every selection is false. ON = CalibrationOptions.perLeafScale (shrunk, ADR-0052); OFF = the ADR-0050 baseline. The D axis is the recorded falsifiable prediction: under per-leaf correction, cal→live drift becomes a REAL mechanism (it was measured irrelevant under shared calibration, ADR-0050). Realized ς republished per cell (draw-artifact guard).

## H — static dispersion (ς), OFF vs ON

| nominal ς | realized ς | OFF mean false sel | ON mean false sel | ON max | n |
|---|---|---|---|---|---|
| 0 | — | 0.00 | 0.00 | 0 | 8 |
| 0.05 | 0.059 | 0.00 | 0.00 | 0 | 8 |
| 0.1 | 0.118 | 5.25 | 0.00 | 0 | 8 |
| 0.2 | 0.235 | 15.50 | 0.00 | 0 | 8 |
| 0.3 | 0.353 | 18.88 | 0.00 | 0 | 8 |
| 0.5 | 0.588 | 19.00 | 0.00 | 0 | 8 |

## D — cal→live drift (driftMix at nominal ς=0.2), OFF vs ON

| driftMix | realized ς | OFF mean false sel | ON mean false sel | ON max | n |
|---|---|---|---|---|---|
| 0 | 0.235 | 15.50 | 0.00 | 0 | 8 |
| 0.25 | 0.234 | 15.38 | 0.25 | 1 | 8 |
| 0.5 | 0.226 | 13.88 | 3.13 | 4 | 8 |
| 1 | 0.173 | 9.88 | 25.25 | 28 | 8 |
