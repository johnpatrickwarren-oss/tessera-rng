# Tessera-RNG — real-telemetry replay (ADR-0057)

Operating point: mac-mini 1 Hz powermetrics per-core population (14 cores × {mhz, res}); T=3600 (1 h @ 1 Hz; sampling floor ≈ 0.0083 at p=2 — an iid-residual approximation; 1 Hz autocorrelation surviving the AR(≤6) whitening may understate it, immaterial at ς̂ ≈ 0.4–1.1); cal 2026-07-08, lives: adjacent hour / +3 days / across the 14-day outage+reboot; thresholds ς*=0.05 (shared) and 0.07 (perLeafScale arm); shrinkage λ = ς̂²/raw² (ADR-0052 formula, adapter-applied).

> Tier 2.5: REAL telemetry, NOT network telemetry — no RNG-domain claim (no incidence model, nothing localization-related runs) and no FDR claim. The objects under test (estimateDispersion, dispersionGate, driftMonitor, the ADR-0052 shrinkage formula) run VERBATIM from src/; leaf standardization is adapter-level from the SAME engine primitives the production substrate consumes (robustLocation + MAD, pooled BIC fitArP / prewhitenAr) — no byte-anchor to runPipeline is possible across the domain gap (recorded narrowing). Full-rate rows are NOT CI-reproducible (day files live off-repo: the mini ~/concord/telemetry/data/); the fixture rows are (committed, downsampled 1-in-10).

## Real population dispersion (calibration window, shared substrate)

| population | n | robust ς̂ | tail ς̂ | raw | floor | gate |
|---|---|---|---|---|---|---|
| full (14 cores) | 14 | 1.127 | 0.687 | 1.127 | 0.0083 | FAIL (claim withheld) |
| active (9 cores) | 9 | 0.381 | 0.454 | 0.381 | 0.0083 | FAIL (claim withheld) |

## Live-window monitor (incl. the across-outage natural drift experiment)

| window | arm | population | status | pattern | ς̂ | tail ς̂ | thr |
|---|---|---|---|---|---|---|---|
| adjacent hour (07-08 h≈12) | shared | full | drifted | fleet | 1.252 | 0.998 | 0.05 |
| adjacent hour (07-08 h≈12) | shared | active | drifted | fleet | 0.602 | 0.441 | 0.05 |
| adjacent hour (07-08 h≈12) | perLeafScale | full | drifted | fleet | 0.327 | 0.371 | 0.07 |
| adjacent hour (07-08 h≈12) | perLeafScale | active | drifted | fleet | 0.099 | 0.151 | 0.07 |
| +3 days (07-11, same hour) | shared | full | drifted | fleet | 0.912 | 0.792 | 0.05 |
| +3 days (07-11, same hour) | shared | active | drifted | fleet | 0.434 | 0.339 | 0.05 |
| +3 days (07-11, same hour) | perLeafScale | full | drifted | fleet | 0.229 | 0.196 | 0.07 |
| +3 days (07-11, same hour) | perLeafScale | active | drifted | fleet | 0.196 | 0.142 | 0.07 |
| ACROSS OUTAGE (07-28, post-reboot) | shared | full | drifted | fleet | 1.468 | 1.064 | 0.05 |
| ACROSS OUTAGE (07-28, post-reboot) | shared | active | drifted | fleet | 1.175 | 0.795 | 0.05 |
| ACROSS OUTAGE (07-28, post-reboot) | perLeafScale | full | drifted | fleet | 0.513 | 0.443 | 0.07 |
| ACROSS OUTAGE (07-28, post-reboot) | perLeafScale | active | drifted | fleet | 0.191 | 0.440 | 0.07 |

## Committed fixture cells (downsampled 1-in-10 — the CI-reproducible subset)

| window | n | ticks | robust ς̂ | tail ς̂ |
|---|---|---|---|---|
| cal 07-08 (downsampled) | 14 | 360 | 1.144 | 1.609 |
| across-outage 07-28 (downsampled) — under the cal substrate | 14 | 360 | 0.451 | 0.845 |
