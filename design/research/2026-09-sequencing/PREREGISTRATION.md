# Pre-registration — sequencing from crossings on the fabric: does per-leaf first-crossing order recover the injected resource order? (`2026-09-sequencing`, tessera-rng substrate)

- **Study id:** `2026-09-sequencing` (tessera-rng half; the engine half is
  `../deploysignal-engine/validation/sequencing/PREREGISTRATION.md`, mirrored).
- **Register:** `knowledge/WORKLIST.md` C74; `knowledge/methodology/pages/threshold-free-observability.md`
  claim (4), falsifier 3; `knowledge/stats/pages/segment-carryover-2026-09-02.md` (this
  fabric with staggered degradations via `DegradationSpec.start_tick`);
  `knowledge/stats/pages/e-by-surface-2026-09-03.md` (the harness this one copies its fabric,
  calibration and selection from).
- **Discipline:** `knowledge/methodology/pre-registration-discipline`;
  `knowledge/methodology/harness-discipline`.
- **Status: REGISTERED, NOT RUN.** No `src/` changes. The harness drives the shipped
  `IncrementalSession` (`src/session.ts`) tick by tick and the engine's mixture and e-SR from
  the pinned dependency (`@johnpatrickwarren-oss/deploysignal-engine` v0.6.11-pre, `ac1b908`)
  on the same standardized residuals. This file is committed first so that no endpoint, bar,
  grid, prediction or seed below can be chosen after a number is seen. Later commits must not
  edit it; a change is an amendment, appended and dated.

## 1. The claim under test

The same as the engine half: thesis claim (4), falsifier 3. On the fabric the injected order
is a **resource** order (F fiber bundles degrade at staggered `start_tick`s), observed through
their leaves. Four per-leaf orderings are compared with the injected order:

- **O_bet** — the shipped Family A per-leaf crossing: the tick at which the leaf's Family A
  e-value (the mean over the five signals of the engine betting wealth, `runFamilyA` in
  `src/detect.ts`, as the session keeps it in `det.aM`) first reaches `1/α_A`, `α_A = 0.01`
  (`DEFAULT_DETECT`).
- **O_mix** — the engine's Family A mixture supermartingale per signal on the same standardized
  residuals (σ² = 1, `gaussian_sigma_squared_prior = CS_SIGMA_SQUARED_PRIOR = 1`, `ar1_phi = 0`,
  exactly the premise the shipped betting path assumes), family mean over the five signals,
  first tick at `≥ 1/α_A`.
- **O_sr** — the engine's e-SR mean-shift e-detector per signal at `α_ARL = 10⁻³` on the same
  residuals, family mean of the five SR statistics first reaching `1/α_ARL`; the ordering
  statistic is the `onset_estimate` of the signal carrying the largest SR statistic at that
  tick. Reported without a bar: **O_srx**, the crossing tick itself.
- **O_ebh** — the leaf-level e-BH selection order: the first tick at which the leaf is in
  `buildSurface(verdicts_t, q).selected_path_class_ids`, `q = 0.05`, where `verdicts_t` are the
  shipped per-leaf verdicts at tick `t` (Family A and Family C, leaf e-value their mean, as
  `leafVerdict` computes). The per-tick verdicts are read from the session's leaf states with
  an exact parity check: at the final tick the reconstructed e-values equal
  `session.audit().verdicts[*].e_value` for every leaf. (Calling `audit()` per tick is
  admissible instead; the quantity is the same.)

## 2. The study

Fabric `generateFabric(DEFAULT_FABRIC)` (400 leaves; 24 bundles of 11–26 leaves), calibration
`{seed: 0xca11b, ticks: 2000}` via `calibrateForSession(SNAP, CAL, DEFAULT_DETECT)` as in the
e-by-surface harness, no common-mode stripping (the session default), no reroutes, no epochs.
Degradations: `F ∈ {3, 5}` bundles `bundle-0 .. bundle-(F−1)` (13, 18, 26, 14, 20 leaves;
pairwise disjoint, verified 2026-09-04), each `{resource_id, delta: Δ, start_tick: ν_k,
signal: 'p99_latency', mode: 'mean'}` with `ν_k = ν_0 + k·g`, `ν_0 = 100`, `g ∈ {5, 20, 50}`,
supplied through `degradations` (ADR-0021). `Δ ∈ {2.58, 5.16}` raw units, which the
e-by-surface run's Monte-Carlo truth (θ = 1.163 at Δ = 2, θ = 2.327 at Δ = 4, i.e. 0.5817 per
raw unit, `run-20260904T031343Z`) puts at **1.5 and 3.0 residual sd**, the K1 canonical and
its double. The realised residual shift is re-measured on 200 truth seeds per Δ and reported;
the endpoints do not depend on the label. Horizon `T = ν_0 + (F−1)·g + 300`. 12 cells,
`N = 1,000` per cell, seeds `20260913 + 7919·i + 10⁶·j` (`j` the cell index, F outer, then Δ,
then g). All four orderings are read on the same replication.

### 2.1 Scoring

**Pair agreement `A`** per replication over all pairs of faulted leaves `(a, b)` from different
bundles (`ν_a < ν_b`); leaves of the same bundle share an onset and form no pair. Score 1 if
`o_a < o_b`, 0 if `o_a > o_b`, 0.5 on a tie (equal ticks, or both uncrossed); crossed before
uncrossed. Cell mean and se over replications. Ties are never broken by leaf id.

**Resource-level order** (reported, no bar): each bundle's statistic is the median of its
leaves' ordering statistic (uncrossed leaves count as `∞`); pair agreement over the
`F(F−1)/2` bundle pairs.

**False sequencing `Φ`** per replication: the fraction of the `400 − |faulted|` null leaves
whose crossing (per ordering; for O_ebh, first selection) precedes `ν_{F−1}`.

**Onset error** (O_sr, reported): mean `|onset_estimate − ν_k|` over crossed faulted leaves.
Also reported per ordering: `p_detect` over faulted leaves by `T`, delay mean and sd.

## 3. Endpoints (HELD/FAILED on their own bars)

- **E1 — better than chance.** Per cell and ordering: `A − 3·se(A) > 0.5`. Prediction: HELD
  for every ordering in every cell.
- **E2 — the floor at the widest gap.** At `g = 50`: `A ≥ 0.8` for every ordering, both F,
  both Δ. Prediction: HELD. The family mean over five signals makes a single-signal shift reach
  `5/α_A` rather than `1/α_A`, so delays and their spread are larger than the engine's
  (predicted delay ≈ 60–90 ticks with sd ≈ 20 at 1.5 sd); a 50-tick gap is still ≈ 1.8 sd
  of the pairwise difference, `A ≈ 0.96`.
- **E3 — the e-SR's design claim at small gaps.** At `g = 5`, `Δ = 2.58`, both F:
  `A_sr − A_bet` and `A_sr − A_mix` each exceed `3·se` of the paired difference. Prediction:
  HELD, `A_sr ≈ 0.70–0.80` against `≈ 0.55–0.60` for the crossings.
- **E4 — false sequencing.** Per cell: `Φ_bet ≤ 0.02` and `Φ_mix ≤ 0.02`. Prediction: HELD.
  `Φ_ebh` reported (predicted ≤ 0.02: the e-BH threshold on 400 leaves exceeds `1/α_A`
  until many leaves are selected). `Φ_sr` reported without a bar: the fabric residuals are
  AR(1) at φ = 0.5 on `p99_latency` (`AR1_PHI`), standardized per cell but **not whitened**,
  and the e-SR's ARL guarantee is for sub-Gaussian(1) increments; positive serial correlation
  inflates its wealth, so predicted `Φ_sr ∈ [0.15, 0.50]`, above the engine half's oracle
  band. Reported as the unwhitened price, which is what a consumer would pay today.

Registered predictions for the crossing orderings at `Δ = 2.58`: `A ≈ 0.57 / 0.78 / 0.96` at
`g = 5 / 20 / 50`; O_ebh within 0.05 of O_bet at every gap. Predictions carry no authority.

## 4. NOT-EXECUTABLE conditions

- Any replication throws (no catch); the parity check fails on any leaf; the run is preserved
  unscored and reported not-executable.
- A cell where an ordering's `p_detect < 0.5` over faulted leaves is not scored for that
  ordering and is listed.

## 5. Ship rule and the falsifier

Nothing ships (no `src/` changes). Falsifier 3 fires only if NO ordering beats chance (E1) in
ANY cell of **either** substrate; the thesis page's state is set from both halves together.

## 6. What this study does not measure

Common-mode stripping (ADR-0036, off here), reroutes and epochs, variance or spectral
faults, faults on more than one signal, faults that end, location (tomography), any real
trace. The e-SR is not a shipped tessera-rng detector; O_sr and O_mix measure what the
fabric's residuals would give those constructions, not a shipped surface.
