# Tessera-RNG — anytime alarms: the Ville-rule envelope (ADR-0062)

Operating point: spraypoint:64x10x2, sessions of T=60; α=0.05; per-leaf threshold 1/α=20; fleet threshold n/α=2180; alarm statistic = (A+C)/2 (D excluded, ADR-0044); δ=3 mean fault for the latency arm.

> Synthetic Tier-2. THE GUARANTEE IS CONDITIONAL ON THE CALIBRATED NULL (ADR-0062): dispersion/drift voids it exactly as it voids e-BH validity (ADR-0050/0057 — real fleets measured far past the boundary); the alarm read carries the same gate/monitor (or perLeafScale) preconditions as the evidence surface. The guaranteed quantity is the per-leaf ever-alarm PROBABILITY ≤ α (pooled fraction column); per-seed counts fluctuate binomially around E ≤ N·α and are reference data. The Ville guarantee is over an INFINITE horizon — finite-window fractions sit under it a fortiori. Fleet scope buys fleet-wise ≤ α at a Bonferroni power cost. Alarms are DETECTION, not FDR claims (ADR-0060 untouched). First-alarm latency is the anytime win: the alarm fires mid-window with the guarantee intact at every tick.

## Clean fleets (the guaranteed quantity is the pooled fraction; counts are reference)

| scope | threshold | alarm counts (per seed; reference) | pooled ever-alarm fraction | guaranteed bound | E[count] ref |
|---|---|---|---|---|---|
| per-leaf | 20 | 1, 5, 2, 2, 3, 4, 0, 0 | 1.95% | ≤ 5.00% | 5.45 |
| fleet | 2180 | 0, 0, 0, 0, 0, 0, 0, 0 | 0.00% | ≤ 0.05% | 0.05 |

## Faulted (δ=3): first-alarm tick of the faulted leaf

| target | leaf | first-alarm ticks (per seed; — = no alarm) | alarmed | n |
|---|---|---|---|---|
| optic-3 | tor-3 | 0, 4, 3, 2, 4, 10, 0, 3 | 8/8 | 8 |
| optic-40 | tor-40 | 13, 0, 1, 12, 3, 18, 15, 14 | 8/8 | 8 |
