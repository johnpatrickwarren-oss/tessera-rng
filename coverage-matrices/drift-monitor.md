# Tessera-RNG — runtime drift monitor: detection envelope (ADR-0053)

Operating point: spraypoint:64x10x2; T=60; thresholds: shared-calibration default ς*=0.05 (clean-fabric ς̂ ≈ 0.009), perLeafScale regime 0.07 (fresh-correction noise ≈0.03–0.06, max 0.0594 on this seed set — measured, regime-dependent).

> Synthetic Tier-2. The false-selection columns recompute the ADR-0050/0052 cells (same seeds). The monitor gates the CLAIM, never the alarm; licensed ⇔ gate passing AND monitor ok (both opted in). Tail pattern is AMBIGUOUS between subpopulation drift and genuine localized variance faults — recorded, the claim is withheld either way. Thresholds are synthetic-boundary-derived (Tier 3: real deployments re-derive).

## Cliff detection (perLeafScale ON, the ADR-0052 D axis)

| cell | thr | ok | drifted | indet | fleet | mean ς̂ | mean tail ς̂ | mean false sel | n |
|---|---|---|---|---|---|---|---|---|---|
| driftMix 0 | 0.07 | 100% | 0% | 0% | 0% | 0.042 | 0.042 | 0.00 | 8 |
| driftMix 0.25 | 0.07 | 88% | 13% | 0% | 13% | 0.059 | 0.057 | 0.25 | 8 |
| driftMix 0.5 | 0.07 | 0% | 100% | 0% | 100% | 0.094 | 0.091 | 3.13 | 8 |
| driftMix 1 | 0.07 | 0% | 100% | 0% | 100% | 0.247 | 0.265 | 25.25 | 8 |

## Shared-calibration regime (default threshold)

| cell | thr | ok | drifted | indet | fleet | mean ς̂ | mean tail ς̂ | mean false sel | n |
|---|---|---|---|---|---|---|---|---|---|
| ς 0 | 0.05 | 100% | 0% | 0% | 0% | 0.007 | 0.005 | 0.00 | 8 |
| ς 0.1 | 0.05 | 0% | 100% | 0% | 100% | 0.099 | 0.113 | 5.25 | 8 |
| ς 0.2 | 0.05 | 0% | 100% | 0% | 100% | 0.191 | 0.225 | 15.50 | 8 |

## Pattern attribution (recorded fixtures)

- subpopulation variance fault (2/20 leaves, δ=4) → expect drifted/tail: **drifted/tail**
- single-leaf single-signal variance fault on DEFAULT fabric (δ=3) → expect ok (correctly ignored): **ok**

## Resolvability (floor ≥ threshold must read indeterminate)

| cell | thr | ok | drifted | indet | fleet | mean ς̂ | mean tail ς̂ | mean false sel | n |
|---|---|---|---|---|---|---|---|---|---|
| T=40 @ ς*=0.05 (floor 0.051) | 0.05 | 0% | 0% | 100% | 0% | 0.006 | 0.005 | — | 8 |
