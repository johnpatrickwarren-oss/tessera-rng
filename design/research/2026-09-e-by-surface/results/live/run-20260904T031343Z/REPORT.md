# REPORT — 2026-09-e-by-surface, run run-20260904T031343Z

tessera-rng `a5320dbe586160a24d2d4253f0c20649598d3ff8`, engine 0.6.11-pre; N = 500 per cell, T = 200, q = 0.05, deltas 0.05/0.1, fabric 400 leaves, degraded leaves 97, calibration ticks 2000 (fixed). Monte-Carlo truth: M = 2000 seeds per Δ. Wall 454 s. Closed-form deviations > 1e-12: 0. Session/batch parity checks: 3 equal of 3.

| Δ | rule | δ | mean selected leaves | pairs | fcr | se | bar | verdict | exact-truth miss (P2) | excludes 0 on degraded p99 (P3) | mean half-width | width ratio e-BY/naive |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | A | 0.05 | 0.00 | 0.0 | 0.0000 | 0.0000 | 0.0500 | HELD | 0.0000 | — | 0.342 | 1.436 |
| 0 | A | 0.1 | 0.00 | 0.0 | 0.0004 | 0.0004 | 0.1012 | HELD | 0.2000 | — | 0.332 | 1.486 |
| 0 | B | 0.05 | 3.00 | 15.0 | 0.0005 | 0.0003 | 0.0508 | HELD | 0.0005 | — | 0.325 | 1.366 |
| 0 | B | 0.1 | 3.00 | 15.0 | 0.0011 | 0.0004 | 0.1011 | HELD | 0.0011 | — | 0.315 | 1.410 |
| 2 | A | 0.05 | 97.06 | 485.3 | 0.0003 | 0.0000 | 0.0501 | HELD | 0.0003 | 1.0000 | 0.266 | 1.118 |
| 2 | A | 0.1 | 97.06 | 485.3 | 0.0005 | 0.0000 | 0.1001 | HELD | 0.0005 | 1.0000 | 0.253 | 1.134 |
| 2 | B | 0.05 | 3.00 | 15.0 | 0.0000 | 0.0000 | 0.0500 | HELD | 0.0000 | 1.0000 | 0.325 | 1.366 |
| 2 | B | 0.1 | 3.00 | 15.0 | 0.0000 | 0.0000 | 0.1000 | HELD | 0.0000 | 1.0000 | 0.315 | 1.410 |
| 4 | A | 0.05 | 97.07 | 485.4 | 0.0003 | 0.0000 | 0.0501 | HELD | 0.0003 | 1.0000 | 0.266 | 1.118 |
| 4 | A | 0.1 | 97.07 | 485.4 | 0.0005 | 0.0000 | 0.1001 | HELD | 0.0005 | 1.0000 | 0.253 | 1.134 |
| 4 | B | 0.05 | 3.00 | 15.0 | 0.0000 | 0.0000 | 0.0500 | HELD | 0.0000 | 1.0000 | 0.325 | 1.366 |
| 4 | B | 0.1 | 3.00 | 15.0 | 0.0000 | 0.0000 | 0.1000 | HELD | 0.0000 | 1.0000 | 0.315 | 1.410 |

## Endpoints

- **P1a exact-truth FCR under extremeness selection (ship gate):** HELD — δ 0.05: 0.0005 ≤ 0.0508; δ 0.1: 0.0011 ≤ 0.1011.
- **P1b FCR under the shipped e-BH rule on faulted fabrics:** HELD — 0.0003 vs 0.0501; 0.0005 vs 0.1001; 0.0003 vs 0.0501; 0.0005 vs 0.1001.
- **P2 exact-truth pairs on selected leaves covered:** HELD — miss fractions 0.0003, 0.0005, 0.0003, 0.0005.
- **P3 informativeness (reported):** degraded p99 interval excludes 0 on 1.000, 1.000, 1.000, 1.000 of selected degraded leaves; width ratio 1.118, 1.134, 1.118, 1.134.
- **P4 closed form and path parity:** HELD.

## Monte-Carlo truth (degraded leaves, p99_latency, residual units)

| Δ | leaves | mean θ | min θ | max θ | mean se |
|---|---|---|---|---|---|
| 2 | 97 | 1.163 | 1.156 | 1.167 | 0.0016 |
| 4 | 97 | 2.327 | 2.317 | 2.334 | 0.0016 |

