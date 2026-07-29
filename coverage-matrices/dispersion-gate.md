# Tessera-RNG — ς̂ dispersion-gate validation (ADR-0051)

Operating point: spraypoint:64x10x2; T=60, threshold ς*=0.05; calibration: robust per-cell, seed ⊕ 0xca11b (production defaults; at this operating point all cells are on the pooled-global fallback — ADR-0050 disclosure).

> Synthetic Tier-2 (VALIDATION.md): the gate is validated against the SAME synthetic mechanism the boundary was measured on (ADR-0050). The false-selection column reuses the ADR-0050 null-run cells so the ROC and the failure sit in one table. The ς* = 0.05 threshold is justified by the synthetic boundary ONLY — a real deployment must re-derive it (ADR-0051 anti-scope).

## Recovery + operating characteristic (n=8 per cell)

The gate binds on the ADR-0061 TRIPLE: max(ς̂, tail ς̂) ≤ ς* AND z_max ≤ Φ⁻¹(1−0.01/n) — the pair guards against dispersed subpopulations (the ADR-0051 cold-eye correction; AC-2b contamination test), the max-z against the extreme-leaf scale laundering (ADR-0059/0061).

| nominal | realized ς | mean ς̂ (robust) | mean tail ς̂ | sd ς̂ | mean raw | floor | pass rate | mean false sel |
|---|---|---|---|---|---|---|---|---|
| 0 | — | 0.009 | 0.006 | 0.010 | 0.042 | 0.041 | 100% | 0.00 |
| 0.05 | 0.059 | 0.054 | 0.056 | 0.008 | 0.068 | 0.041 | 0% | 0.00 |
| 0.1 | 0.118 | 0.102 | 0.113 | 0.012 | 0.110 | 0.041 | 0% | 5.25 |
| 0.2 | 0.235 | 0.191 | 0.225 | 0.017 | 0.196 | 0.041 | 0% | 15.50 |
| 0.3 | 0.353 | 0.286 | 0.335 | 0.021 | 0.289 | 0.041 | 0% | 18.88 |

## Calibration depth (T=240: the sampling floor shrinks)

| nominal | mean ς̂ | floor | pass rate | n |
|---|---|---|---|---|
| 0 | 0.008 | 0.020 | 100% | 8 |
| 0.1 | 0.090 | 0.020 | 0% | 8 |
