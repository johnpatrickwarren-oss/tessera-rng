# Tessera-RNG — resource e-process escalation tier (ADR-0064)

Operating point: spraypoint:64x10x2, T=60; α=0.05 per resource (fleet budget ≈ R·α, disclosed); tier fires when a neighborhood's aggregate crosses 1/α under the CALIBRATED null; leaf-layer control = the standard e-BH surface at q=0.05.

> Synthetic Tier-2 (ADR-0064). The tier is an EARLY-WARNING surface: a firing aggregate claims "this overlapping NEIGHBORHOOD shifted — run the drill", never "this resource is at fault"; it has no selection semantics and no license interaction (ADR-0060 untouched). NEIGHBORHOOD SIZES on this fabric: optics 3, panels 12, ROOMS = THE FLEET (76 — every tor leaf carries room weight 0.5, so a room escalation recommends drilling everything: rooms are fleet-scale domains here, disclosed). The drill-recommendation ORDER is not localization — spurious narrow resources can out-rank the true broad one (see top_resources). The e-process guarantee is conditional on the CALIBRATED null (ADR-0062-class conditionality; the T=60 plug-in (mean, sd) carries ≈9% sd estimation error and an in-sample/out-of-sample asymmetry — mildly anti-conservative, not binding at the measured clean 0/304). Clean-side, mean-betting is SCALE-FAIR, so the unit-variance column cannot show the probe error there; the calibrated null binds FAULT-SIDE — the sibling_null_comparison table: under a room-0 fault the room-1 aggregate GENUINELY shifts (shared members), and the calibrated null detects it consistently (E ≈ 1e5+ every seed — the confound is real and STRONGER than the probe suggested, which is exactly why the claim granularity is a neighborhood), while the unit-variance null is ERRATIC (2e-3 to 1.9e3 — clipped bets on mis-scaled data; the probe numbers were uninterpretable, not merely inflated). tier_escalates counts runs whose ESCALATION SET contains the true target in some fired neighborhood.

## Clean validity (the validation the ADR-0049 probe lacked)

| null | escalations per run (of 76 resources) | per-resource rate |
|---|---|---|
| CALIBRATED (shipped) | 0, 0, 0, 0 | 0.00% (α=5%) |
| unit-variance (the probe's error, comparison only) | 0, 1, 0, 0 | — |

## Sub-floor detection (the ADR-0049 table under the honest null)

| target | Δ | leaf layer detects | tier escalates (target in a fired neighborhood) | mean escalation-set size | top-ranked per seed | n |
|---|---|---|---|---|---|---|
| room-0 | 0.5 | 0/4 | 4/4 | 20.3 | optic-5, panel-4, panel-4, panel-2 | 4 |
| room-0 | 1 | 2/4 | 4/4 | 72.8 | room-0, room-0, panel-4, room-0 | 4 |
| panel-7 | 1 | 0/4 | 3/4 | 1.5 | optic-5, panel-7, panel-7, — | 4 |
| optic-3 | 1 | 2/4 | 2/4 | 0.8 | optic-5, optic-3, optic-3, — | 4 |

## Fault-side null comparison (the calibrated null's necessity, shown where it binds)

room-0 fault at Δ=1; the SIBLING room-1 aggregate E under each null (the ADR-0049 E≈882 confound):

| seed | calibrated sibling E | unit-variance sibling E |
|---|---|---|
| b0a01 | 2.19e+5 | 3.29e-2 |
| b0a02 | 2.52e+5 | 1.90e+3 |
| b0a03 | 1.13e+5 | 4.83e+1 |
| b0a04 | 1.20e+5 | 2.12e-3 |
