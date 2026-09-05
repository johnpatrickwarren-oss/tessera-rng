# Pre-registration — cascades on the fabric: does the shipped path recover the causal order and the causal resource when fault B is caused by fault A and is larger? (`2026-09-cascade`)

- **Study id:** `2026-09-cascade`
- **Register:** `knowledge/WORKLIST.md` C80; `knowledge/methodology/pages/threshold-free-observability.md`
  claim (4), falsifier 3 — the halves C74 left open ("faults of unequal size, and the location
  half"); `knowledge/stats/pages/sequencing-2026-09-04.md` (C74: independent staggered onsets,
  equal sizes, no reroutes); `knowledge/stats/pages/e-by-surface-2026-09-03.md` (the fabric,
  calibration, selection and Monte-Carlo-truth pattern this harness copies).
- **Discipline:** `knowledge/methodology/pre-registration-discipline`;
  `knowledge/methodology/harness-discipline`.
- **Status: REGISTERED, NOT RUN.** No `src/` changes. The harness drives the shipped
  `IncrementalSession` (`src/session.ts`) tick by tick with `reroutes` set, reads the shipped
  audit (`assembleAudit`, `src/pipeline.ts`) for location and e-BY intervals, and imports the
  compiled in-place `src/*.js` as the earlier studies do. Engine pin v0.6.11-pre
  (`package.json`, lockfile unchanged). This file is committed first so that no endpoint, bar,
  grid, prediction or seed below can be chosen after a number is seen. Later commits must not
  edit it; a change is an amendment, appended and dated.

## 1. The claim under test, and what the code does

Thesis claim (4): first-crossing times order an incident and e-BH selection plus tomography
locate it. C74 measured the sequencing half with independent onsets of equal size and no
routing change. This study builds the case C74 excluded: a CASCADE, where fault B is caused by
fault A through the operator's response.

The scenario, in the code's own primitives:

1. **A degrades.** `DegradationSpec { resource_id: A, delta: Δ_A, start_tick: t₀, signal:
   'p99_latency', mode: 'mean' }` (`src/telemetry.ts`): every leaf traversing A shifts by Δ_A
   (binary incidence, weight 1) from t₀.
2. **The operator drains A.** `RerouteEvent { at_tick: t₁ = t₀ + lag, resource_id: A, fraction:
   f, seed }` (ADR-0017, `applyRerouteEvent`, `src/epoch.ts`): `floor(f·|members(A)|)` of A's
   leaves, drawn by the seeded without-replacement draw, remap off A onto same-kind alternates,
   each to a seeded alternate. From t₁ the degradation follows the new epoch (`buildDegCtxs`,
   `src/telemetry.ts`): a leaf that left A stops shifting. The session resets the wealth of every
   remapped leaf at t₁ (ADR-0018, `IncrementalSession.resetLeaf`) and its leaf e-value becomes
   the mean of its segment e-values (`combineSegmentRuns`, `src/detect.ts`).
3. **The load lands and B degrades.** The alternate that absorbed the most rerouted leaves is B;
   `DegradationSpec { resource_id: B, delta: Δ_B = r·Δ_A, start_tick: t₁ }`. B's original
   members and the leaves rerouted onto it shift from t₁.

Location on an epoch'd run (`assembleAudit`, `src/pipeline.ts`): selected leaves are grouped
by `evidence_epoch` (segmented leaves: the epoch of their max-e-value segment; unsegmented
leaves: the latest epoch by ADR-0018's convention), each group is localized against its
epoch's snapshot with the z-currency magnitude scorer (`buildLocalizeOpts` passes `magnitude`
because `magnitudeT` is null on epoch'd runs — the ADR-0046 linear scorer does not run here;
recorded narrowing, measured as shipped), culprits are concatenated in epoch order, and the
drain target is chosen tier-then-score across groups (`drainTargets`, ADR-0023). Every culprit
carries `correlational_not_causal: true` and, when the certificate finds one, an
`ambiguity_group` (ADR-0047, `ambiguityGroupsByResource`, `src/identifiability.ts`).

Two consequences follow from the code and are the predictions' spine. (i) A leaf rerouted off
A loses A's shift at t₁ and its accrued wealth at t₁; its causal evidence is whatever it
accrued in `[t₀, t₁)`. (ii) After a full drain (f = 1) A has no members in epoch 1, so any leaf
attributed to epoch 1 cannot point at A; A can be named only through leaves whose evidence
epoch is 0.

## 2. The study

**Fabric** `generateFabric(DEFAULT_FABRIC)` (400 leaves, 2,391 binary edges; 4 power zones of
97–104 leaves). **Calibration** `calibrateForSession(SNAP, { seed: 0xca11b, ticks: 2000 },
DEFAULT_DETECT)`, one fixed substrate for the whole study, no common-mode stripping, no
dispersion gate. **Session** `openSession({ snapshot, calibration, q: 0.05, ctx, reroutes,
drain_top_k: 1 })`, fcrDelta defaulting to q.

**A = `pzone-0`** (97 leaves). **Reroute** `{ at_tick: t₁, resource_id: 'pzone-0', fraction:
f, seed: 0xca5cad }`, one registered routing outcome for the whole study (the seed is fixed,
not per replication; replications vary the noise). Computed 2026-09-04 from `makeEpochs` at
this seed and recorded in the manifest: at f = 0.5, 48 leaves leave A (20 to `pzone-3`, 17 to
`pzone-1`, 11 to `pzone-2`; 49 stay); at f = 1, 97 leave (39 to `pzone-3`, 31 to `pzone-1`,
27 to `pzone-2`; 0 stay). **B = `pzone-3`** at both fractions (104 original members; 124 and
143 members in epoch 1). The identifiability certificate (`identifiabilityCertificate`) on the
epoch-0 snapshot and on both epoch-1 snapshots reports 0 ambiguity groups and 0
fleet-ambiguous resources (112 of 112 identifiable in epoch 0; 111 of 112 at f = 1, where the
drained A has no edges and asserts nothing).

**Sizes.** `Δ_A = 2.58` raw, which C74's Monte-Carlo truth puts at 1.500 residual sd on this
fabric and calibration (`run-20260905T025749Z`, K1 canonical). **Ratio `r ∈ {0.5, 1, 2}`**:
`Δ_B = r·Δ_A ∈ {1.29, 2.58, 5.16}` raw (≈ 0.75, 1.5, 3.0 sd). The realised per-tick shift on
each resource's leaves is re-measured on the truth seeds and reported; endpoints do not depend
on the label.

**Timing.** `t₀ = 100`; `lag ∈ {5, 20, 50}`; `t₁ = t₀ + lag`; horizon `T = t₁ + 300`.

**Cells.** `f = 0.5` × `r ∈ {0.5, 1, 2}` × `lag ∈ {5, 20, 50}` (9 cells) plus `f = 1` × `r = 2`
× `lag ∈ {5, 20, 50}` (3 cells): 12 cells, index `j` in that order (f outer, then r, then
lag). **N = 500** per cell, replication seed `20260915 + 7919·i + 10⁶·j`. Truth seeds
`30000001 + 7919·m + 10⁶·j`, `M = 200` per cell, disjoint from the replication seeds.

**Leaf sets**, fixed per cell by the epoch structure: `L_A` (97, onset t₀), split into
`L_A^stay` (49 / 0), `L_A^→B` (20 / 39), `L_A^→other` (28 / 58); `L_B` = B's original members
(104, onset t₁; disjoint from `L_A` — each leaf traverses one power zone); nulls (199 / 199).
The rerouted leaves that land on B are in `L_A`, not `L_B`: their onset is t₀.

**Causal pairs.** `(a, b)` with `a ∈ L_A`, `b ∈ L_B`: 97 × 104 = 10,088 pairs, injected order
`a` before `b`.

### 2.1 Orderings

- **O_bet** — the shipped Family A crossing: the first tick at which the leaf's CURRENT
  segment's Family A row is `fired` (`session.segmentVerdict(pc, ls.det).detectors[0].fired`,
  `1/α_A`, `α_A = 0.01`), recorded once. A leaf that crossed before t₁ keeps that tick; one that
  had not must re-accrue from fresh wealth after the reset.
- **O_ebh** — the first tick at which the leaf is in `buildSurface(V_t, q).selected_path_class_ids`,
  `q = 0.05`, where `V_t` are the shipped LEAF verdicts at tick `t` (`session.leafVerdict`, the
  combined segment verdict `audit()` uses). Parity: at T the reconstructed e-values and
  selection equal `session.audit()`'s for every leaf.
- **O_ctr** — the ADR-0067 effect-interval centre at T as a magnitude-aware ordering: the
  Family A row's `effect_cs` for `p99_latency`, `S_t/t` over the leaf's current segment, ranked
  DESCENDING (a larger centre reads as earlier). Reported for every leaf whether or not
  selected (the centre of the selected leaf's interval is this quantity exactly).

### 2.2 Scoring

**Pair agreement `A`** per replication over the causal pairs: 1 if `o_a < o_b`, 0 if
`o_a > o_b`, 0.5 on a tie (equal ticks; both uncrossed); crossed before uncrossed; for O_ctr
larger-before-smaller. Cell mean and se. **Resource-level order** (reported): median of `L_A`'s
statistic against median of `L_B`'s. **Subset agreement**: `A_stay` over pairs with
`a ∈ L_A^stay` and `A_seg` over `a ∈ L_A^→B ∪ L_A^→other` (P4). **False sequencing `Φ`**: the
fraction of the 199 null leaves whose crossing (per ordering; O_ebh first selection) precedes
t₁. **p_detect**, delay mean and sd per leaf set; the fraction of segmented `L_A` leaves crossed
before t₁.

**Location** from `session.audit()` at T (primary) and at `t₁ + 50` (reported): `named_A`
(pzone-0 in `culprits` at any rank), `named_B`, the list head `culprits[0].resource_id`, the
drain target `drain_actions[0].resource_id` (ADR-0023, k = 1), the rank and
`localized_against_epoch` of A and B, the culprit count, the unexplained count, A's
`firing_member_count`, the number of culprits carrying `ambiguity_group`, and `|selected|`.

**Coverage** from `audit().effect_intervals` at T (δ = 0.05, `α_i = δ|S|/400`): truth per
(leaf, signal) is 0 for every signal but `p99_latency` and for every leaf outside `L_A ∪ L_B`;
for `p99_latency` on `L_A ∪ L_B` it is the Monte-Carlo mean standardized residual over the
leaf's CURRENT segment window at T (`[0, T)` unsegmented; `[t₁, T)` rerouted) over the M truth
seeds of the same cell. The mixture confidence sequence bounds `S_t − Σμ_i` for any sequence
of conditional means, so the window average is the covered quantity for a leaf whose shift
starts mid-window; a miss is `θ ∉ [lower, upper]`. FCR per replication = misses / intervals.

## 3. Endpoints (HELD / FAILED on their own bars; predictions carry no authority)

- **P1a — better than chance.** Per cell, for O_bet, O_ebh and O_ctr: `A − 3·se > 0.5`.
  Predictions: O_bet and O_ebh HELD at r ∈ {0.5, 1} in every cell. **At r = 2: FAILED at
  lag 5** (B's 3-sd leaves cross ≈ 15 ticks sooner than A's 1.5-sd leaves — C74 measured 25.7
  against 41.1 — so a 5-tick causal lead reverses; predicted A ≈ 0.2–0.35), near chance at
  lag 20 (0.45–0.6, bar not met), HELD at lag 50 (≈ 0.9). **O_ctr HELD at r ≤ 1 and FAILED at
  r = 2** (an unsegmented leaf's centre is ≈ θ·(T − ν)/T; B's 3.0·300/T exceeds A's
  1.5·(300 + lag)/T on almost every pair; predicted A_ctr ≤ 0.1). First crossing orders by
  detectability, not by onset; the size ratio is the confound this study exists to measure.
- **P1b — C74's floor.** At lag 50, O_bet and O_ebh: `A ≥ 0.8`, every r and f. Predicted
  HELD at f = 0.5 (≈ 0.99 for `L_A^stay`; ≈ 0.8 for the rerouted, of which ≈ 75% cross before
  t₁), borderline at f = 1, r = 2 (every A leaf is rerouted).
- **P1c — false sequencing.** `Φ_bet ≤ 0.02` per cell; `Φ_ebh` reported. Predicted HELD.
- **P2 — location.**
  - **P2a — the causal resource is named.** `named_A ≥ 0.9` at f = 0.5 (all 9 cells; 49 leaves
    stay on A and shift through T) and at (f = 1, lag 50) (58 rerouted-to-other leaves carry
    50 shifted ticks in segment 0 and no shift after, so their evidence epoch is 0 and they are
    localized against the epoch-0 snapshot, where they traverse A). Reported at (f = 1, lag 5)
    and (f = 1, lag 20): predicted `named_A < 0.5` at lag 5 — five shifted ticks before the
    drain do not lift a leaf's segment-0 e-value to the e-BH threshold, and A has no members in
    epoch 1 — and low at lag 20. This is the location price of a full drain, not of the
    localizer, and the study reports it as such.
  - **P2b — no non-faulted resource is acted on.** The drain target ∈ {pzone-0, pzone-3} in
    ≥ 0.95 of replications, every cell; the list head reported on the same bar. **"Location
    fails"** means P2b FAILED in any cell, or P2a FAILED in a cell where its bar applies.
  - **P2c — which resource, registered prediction.** When B is larger (r = 2) tomography names
    **B (`pzone-3`) as the drain target and the list head at every lag and both fractions**, and
    A at rank 2 in the same evidence group at f = 0.5. Mechanism: the magnitude scorer ranks by
    explained firing mass; in epoch 1 B has 124 (f = 0.5) or 143 (f = 1) firing members against
    A's 49 or 0, and at r = 2 B's leaves carry the larger z. At r = 1 the same member-count
    asymmetry predicts B. At r = 0.5 predicted A at lag 50, uncertain at lags 5 and 20 (B's
    0.75-sd leaves cross late but outnumber A's stayers 2.5 to 1). Naming B when B is larger is
    NOT a location failure under N1: B is faulted, and the certificate is correlational. The
    failure the brief asks about — naming the larger effect INSTEAD of the cause — is P2a's
    `named_A` reading, bar above.
  - **P2d — ambiguity.** The count of culprits carrying `ambiguity_group` (predicted 0) and the
    per-epoch certificate (predicted 0 groups) in the manifest. Reported.
- **P3 — coverage.** Per cell, `mean FCR ≤ δ + 3·se` at δ = 0.05 over the intervals at T;
  miss rates per leaf set reported (A-stay, A→B, A→other, B-orig, null). Predicted HELD at a
  hundredth of δ, as [[e-by-surface-2026-09-03]] measured; mean half-width ≈ 0.18–0.2 at
  `α_i ≈ 0.025`. Note the semantics the shipped field carries: a rerouted leaf's interval
  describes its CURRENT segment, so an A→other leaf's interval is centred near 0 and an A→B
  leaf's near B's shift; the pre-reroute evidence on A is not in the interval.
- **P4 — the segment reset.** At lag 50, f = 0.5, every r: `A_seg − 3·se > 0.5` for O_bet and
  O_ebh. Reported per f = 0.5 cell: `A_seg − A_stay` and the fraction of segmented A leaves
  crossed before t₁. Prediction: the lag-50 bar HELD; the gap ≈ −0.3 at lags 5 and 20 (a
  rerouted leaf loses A's shift and its partial wealth at t₁; the 28 landing on pzone-1/2 never
  cross, the 20 landing on B cross with B's leaves and tie) and ≈ −0.1 at lag 50. The reroute
  (loss of the shift) and the reset (loss of the wealth) are confounded on the shipped path;
  the crossed-before-t₁ fraction isolates the part no reset can touch.

**Falsifier 3, the readings fixed in advance.** The unequal-size half fires if at r = 2,
f = 0.5, no ordering meets P1a at any lag. The location half fires if "location fails" as
defined under P2b. Predicted: neither fires; the unequal-size half is expected to fail P1a at
lag 5 and hold at lag 50, which narrows claim (4) to "first crossing orders faults whose
causal lead exceeds their detection-delay difference" rather than firing the falsifier.

## 4. NOT-EXECUTABLE conditions

- Any replication throws (no catch anywhere); the parity check fails on any leaf; the run is
  preserved unscored and reported not-executable.
- An ordering's cell is not scored for P1 if its `p_detect` over `L_A ∪ L_B` is below 0.5.
- P2 is not scored in a cell where the selected set at T is empty in more than 10% of
  replications.
- The routing outcome differs from §2 (a different B, or zero rerouted leaves): harness defect,
  not executable.

## 5. Ship rule

Nothing ships; no `src/` change; `demos/demo.html` is untouched (no audit field changes).

## 6. What this study does not measure

A third hop; partial or transient reconvergence (the reroute is atomic, ADR-0017); more than
one routing outcome; faults on more than one signal; variance or spectral faults; the e-SR
onset estimate (C74 measured it on independent onsets; not a shipped tessera-rng detector);
the ADR-0046 linear localizer (not on the epoch'd path); common-mode stripping; the dispersion
gate; per-leaf scale; any real trace. Tier T1, synthetic.
