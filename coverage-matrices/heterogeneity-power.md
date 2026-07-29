# Tessera-RNG — the ς power axis (ADR-0054)

Operating point: spraypoint:64x10x2; optic mean fault δ=3 from tick 0, 60 ticks, q=0.05; 2 targets × 8 seeds ⇒ n=16/cell; calibration under the same ς physics (driftMix 0).

> Synthetic Tier-2 (ADR-0054). Detection = a MATERIALLY affected leaf (incidence w ≥ 0.5) selected; attribution = the faulted resource rank-1; fleet-event top = the virtual fleet candidate rank-1 (a different failure story than a wrong physical resource); false co-selections = selected leaves below the material threshold — diluted leaves (w ≤ 2/64 for an optic fault: panel-pair leaves at 2/64 ⇒ shift ≈ 0.09σ, cross-optic at 1/63 ⇒ ≈ 0.05σ; both sub-detectable, t ≲ 0.7 over 60 ticks) count as false DELIBERATELY (their selection is not fault-driven). The ς=0 shared-calibration cell is anchor-bound byte-for-byte to runPipeline. Static ς only (drift is ADR-0053 scope); mean-mode fault only (mode coverage is ADR-0032 scope).

## Shared calibration (the ADR-0050 exposure)

| ς | fault detection | attribution (rank-1) | fleet-event top | mean false co-sel | mean selected | n |
|---|---|---|---|---|---|---|
| 0 | 100% | 100% | 0% | 0.00 | 1.00 | 16 |
| 0.1 | 100% | 100% | 0% | 5.38 | 6.38 | 16 |
| 0.2 | 100% | 0% | 0% | 15.63 | 16.63 | 16 |
| 0.3 | 100% | 0% | 0% | 18.88 | 19.88 | 16 |

## perLeafScale ON (the ADR-0052 remedy, static ς)

| ς | fault detection | attribution (rank-1) | fleet-event top | mean false co-sel | mean selected | n |
|---|---|---|---|---|---|---|
| 0 | 100% | 100% | 0% | 0.00 | 1.00 | 16 |
| 0.1 | 100% | 100% | 0% | 0.00 | 1.00 | 16 |
| 0.2 | 100% | 100% | 0% | 0.00 | 1.00 | 16 |
| 0.3 | 100% | 100% | 0% | 0.00 | 1.00 | 16 |
