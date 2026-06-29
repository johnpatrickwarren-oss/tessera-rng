# Tessera-RNG — degradation / sensitivity envelope (ADR-0032)

Operating point: **DEFAULT_SPRAYPOINT**, an optic fault at Δ=3, 60 ticks, q=0.05. Clean (no perturbation): detection 100%, attribution 100%.
Per cell **n=32** (2 telemetry seeds × 8 perturbation seeds).

> Synthetic Tier-2 measurement (VALIDATION.md): a breakdown frontier on the synthetic model, NOT a claim of real-world robustness. Calibration is on a CLEAN window, so perturbations both mask faults (attribution falls) and raise false alarms (detection of *something* can rise) — both reported. Routing churn is not an axis here (reuses the ADR-0017/0018 epoch machinery).

## Per-axis breakdown frontier

Each axis swept alone. **Detection** = any leaf selected (can RISE — noise manufactures false alarms); **attribution** = true culprit ranks #1 (the meaningful frontier — it falls as the world leaves the model).

### signal_noise (extra σ (raw))

Attribution breakdown at: **0.25** extra σ (raw). Detection breakdown at: **never** (detection rarely falls — the failure mode is mis-attribution, not silence).

| intensity | detection | attribution | n |
|---|---|---|---|
| 0 | 100% | 100% | 32 |
| 0.05 | 100% | 100% | 32 |
| 0.1 | 100% | 100% | 32 |
| 0.25 | 100% | 53% | 32 |
| 0.5 | 100% | 0% | 32 |
| 1 | 100% | 0% | 32 |
| 2 | 100% | 0% | 32 |

### missingness (drop probability)

Attribution breakdown at: **0.8** drop probability. Detection breakdown at: **never** (detection rarely falls — the failure mode is mis-attribution, not silence).

| intensity | detection | attribution | n |
|---|---|---|---|
| 0 | 100% | 100% | 32 |
| 0.1 | 100% | 100% | 32 |
| 0.25 | 100% | 100% | 32 |
| 0.5 | 100% | 100% | 32 |
| 0.8 | 100% | 0% | 32 |

### observation_delay (lag (ticks))

Attribution breakdown at: **8** lag (ticks). Detection breakdown at: **never** (detection rarely falls — the failure mode is mis-attribution, not silence).

| intensity | detection | attribution | n |
|---|---|---|---|
| 0 | 100% | 100% | 32 |
| 1 | 100% | 100% | 32 |
| 3 | 100% | 100% | 32 |
| 8 | 100% | 75% | 32 |
| 20 | 100% | 50% | 32 |

### aggregation_error (± weight frac)

Attribution breakdown at: **never (held across grid)**. Detection breakdown at: **never** (detection rarely falls — the failure mode is mis-attribution, not silence).

| intensity | detection | attribution | n |
|---|---|---|---|
| 0 | 100% | 100% | 32 |
| 0.1 | 100% | 100% | 32 |
| 0.25 | 100% | 100% | 32 |
| 0.5 | 100% | 100% | 32 |
| 0.9 | 100% | 100% | 32 |

## Joint regimes

| regime | detection | attribution | n |
|---|---|---|---|
| degraded_telemetry (noise 1σ + 25% missing) | 100% | 0% | 32 |
| lossy_aggregation (50% missing + ±25% weight) | 100% | 94% | 32 |
