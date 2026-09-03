# Pre-registration — wealth carryover across ADR-0018 reset segments (WORKLIST C63, tessera-rng half)

- **Study id:** `2026-09-segment-carryover`
- **Register:** `~/concord/knowledge/WORKLIST.md` C63; thesis claim (3) of
  `knowledge/methodology/pages/threshold-free-observability.md`. Operator authorization
  2026-09-02 ("continue with C63 once the re-pins land").
- **Discipline:** `knowledge/methodology/pre-registration-discipline`; `harness-discipline`.
- **Engine:** v0.6.9-pre on `main` at registration. The martingale-merge arm needs engine
  ADR 0028 (`combineMartingale`, `adaptiveLambdas`; engine PR #77, unmerged at registration);
  the harness may carry a local copy of that arithmetic until the re-pin, and must assert
  agreement with the engine's function once it is installed.

Committed before any harness exists. Bands frozen here.

## 1. The system, from code

ADR-0018 splits a leaf's live series at its incidence-change ticks and detects each segment with
fresh wealth (`src/detect.ts` `detectPathClassSegmented`). The leaf's per-family e-value is the
**arithmetic mean** of the segment e-values (`combineFamily`, `src/detect.ts:137-148`), valid
under arbitrary dependence (Ramdas–Wang 2025 Theorem 8.4), and the ADR calls the reset "a
deliberate, recorded power loss" and defers "smarter wealth carryover".

The segments are **sequential e-values**: segment `k` is an e-process on its own window given
everything before it, so `E[e_k | e_1..e_{k−1}] ≤ 1` under the null. That admits two merges the
mean does not exploit (`knowledge/stats/pages/ramdas-wang-2025.md` §2):

- **continuation product** (Proposition 7.9 / §8.3): `∏_k e_k` — the wealth carried across the
  boundary instead of reset, the "all-in" bet with the largest null variance (Prop. 8.16);
- **adaptive martingale merge** (Definition 8.10, Example 8.14): `∏_k (1 − λ_k + λ_k e_k)` with
  `λ_1 = 0`, `λ_k` maximizing mean past log-growth over `[0, ½]` — predictable, so an e-value on
  sequential inputs, and asymptotically log-optimal on iid inputs (Theorem 7.22).

All three are e-values under the null by theorem; **validity is not the question**. The question
is power, and the theorem says only that the mean is dominated in e-power by the log-optimal
martingale merge asymptotically.

## 2. Design

Substrate: the synthetic RNG fabric (`generateFabric(DEFAULT_FABRIC)`), telemetry with reroute
epochs (`makeEpochs`, `generateTelemetry({ epochs })`, the `test/epoch.test.ts` fixture pattern),
seeds by the repo's scrambled scheme. Cells:

| axis | levels |
|---|---|
| reroute boundaries in the live window | 1 (at T/2), 3 (at T/4, T/2, 3T/4) |
| injected degradation on the leaf's resource | none (H0); δ ∈ {2, 4} (the repo's optic-δ levels), starting before the first boundary and persisting across it |
| live window | T = 200 ticks |
| seeds | 200 per cell |

Per leaf whose incidence changes, compute the three merges of its segment e-values
(`combineSegmentRuns` output for the mean; the product and the adaptive martingale from the same
segment runs), for Family A only (the betting e-process; Families C/D report descriptively).

## 3. Registered endpoints

**P1 — validity (all three arms).** On H0 cells, the fraction of changed leaves whose merged
e-value ever reaches `1/α` (α = 0.05, evaluated at the end of each segment, i.e. the merge's
own stopping times). **Registered: ≤ α + 3·se_binomial(α, N_leaves)** for each arm. A FAIL on
the product or martingale arm is a harness defect (the segments are sequential by construction)
and a stop condition; a FAIL on the mean is a defect in the shipped path and the stop is the
same.

**P2 — power: the mean never beats the product.** On each injected cell, detection rate at
`1/α` for the continuation product ≥ that for the mean. **Registered: holds on every injected
cell (4 cells), with the product's rate at δ = 4 exceeding the mean's by ≥ 0.10 absolute in the
3-boundary cells** (three resets cost the mean three restarts from 1; the product keeps them).

**P3 — power: the adaptive martingale is between.** Detection rate of the adaptive merge ≥ the
mean's on every injected cell. **Registered: holds on 4 of 4 cells.** Its relation to the
product is REPORTED, not registered: with `γ = ½` and a handful of segments, λ is still in its
transient and the product may win on these short horizons (Example 8.17's asymptotics need many
segments).

**P4 — time to cross.** Median first tick at which the merged e-value reaches `1/α` on δ = 4
cells, product vs mean. **Registered: product ≤ mean on both boundary counts.**

**P5 — null variance (structural).** On H0 cells, the sample variance of the merged e-value at
T is largest for the product (Prop. 8.16). **Registered: product > martingale ≥ ... ; the mean
is not comparable (not an se-merging function). Reported only for the product vs martingale
ordering; verdict HELD/FAILED on that one inequality.**

## 4. What ships on each outcome

- P1 and P2 HELD: the continuation product becomes an OPT-IN alternative to the mean in
  `combineSegmentRuns` (a `carryover: 'mean' | 'product' | 'martingale'` parameter, default
  unchanged), its choice recorded in the audit beside `eprocess_resets`. Default flips only
  after a second registered study on the real-telemetry substrate this repo does not yet have
  (`VALIDATION.md` Tier 3).
- P2 FAILED with P1 HELD: the ADR-0018 mean stands; the theorem's dominance is asymptotic and
  did not materialize at these horizons; recorded, no code change.
- P1 FAILED on any arm: stop; harness or shipped-path defect; fix test-first and re-register.

## 5. Stop conditions and boundaries

Synthetic fabric only; Family A only for the registered endpoints; α = 0.05; two boundary
counts; two δ levels. No claim about real telemetry. Non-finite merged values in any cell stop
the run.

## Amendment A — 2026-09-02, appended before the run (harness smoke only; no registered run yet)

Nothing above changes: endpoints, bands, N, α, γ, cells and stop conditions stand as frozen at
`c21029b`. This section fixes the readings the registration left open and records one registered
assumption the substrate cannot satisfy, so the verdicts are scored as registered and the reason is
on the record before any number exists.

**A.1 Free readings, fixed here.**
- Fault resource: `pzone-0` (97 leaves of the 400; weight 1), mean shift on `p99_latency`, never
  drained, so the degradation persists through every epoch on every leaf that traverses it.
- Reroutes: boundary k drains `czone-k` at fraction 1 (`czone-0` at T/2 in the 1-boundary cells;
  `czone-0`, `czone-1`, `czone-2` at T/4, T/2, 3T/4 in the 3-boundary cells). Cooling zones are
  drained rather than optics because a leaf has exactly one, so the changed set is large (97 leaves
  at the first boundary) and the fault resource is untouched.
- Population per cell: changed leaves that traverse `pzone-0` in every epoch AND reset at every
  boundary of the cell (K = boundaries + 1 segments; 34 leaves per seed in the 1-boundary cells,
  about 3–5 per seed in the 3-boundary cells, where a leaf must be drained three times in a row).
  This is the population the P2 rationale ("three restarts from 1") describes. The same leaves
  changed at ≥ 1 boundary (any K ≥ 2) are REPORTED, no verdict.
- P1/P2/P3 evaluate "ever reaches 1/α" at segment ends, the merge's own stopping times (§3). P4
  is at tick resolution: the merge over completed segments times the running Family A wealth of
  the current segment, the per-tick wealth recomputed from the engine's betting states and
  asserted equal to the shipped segment value at every segment end. Non-crossers are censored at
  +∞; the median is the upper median. P5 is the (n−1) sample variance of exp(merged log e) at T.
- Seeds: telemetry seed = one house-LCG draw from `fnv1a("2026-09-segment-carryover|<cell>|<i>")`,
  i = 0..199; reroute seeds derive from the same key; the calibration seed is the pipeline's
  `seed ^ 0xca11b`.
- The martingale arm is a local copy of engine `fleet/combine.ts` `combineMartingale` /
  `adaptiveLambdas` (γ = ½) at `d6785f3` (PR #77, now on engine `main`; identical at
  `origin/c63/martingale-merging`), asserted to 1e-12 against values computed by that commit's own
  compiled dist on three fixed vectors, one of which exercises the bisection at interior λ. The
  product arm uses the installed pin's ungated `combineProduct` (v0.6.9-pre) and a local sum,
  cross-checked. The mean arm is the shipped `combineSegmentRuns` output, asserted equal to the
  harness's running mean at the last segment end.

**A.2 The fault-onset lead — a registered assumption the substrate cannot satisfy.** §2 says the
degradation starts "before the first boundary" without saying how long before. The harness smoke
(one seed, 34 leaves, run before this amendment, not a registered measurement) shows that a
fully faulted 50-tick segment after a boundary reaches Family A e ≈ 1e12 at δ = 2 and ≈ 1e22 at
δ = 4 on its own. Every merge therefore detects by the end of the second segment at both δ,
whatever the onset, and P2's "≥ 0.10 absolute margin at δ = 4 in the 3-boundary cells" cannot be
produced on this substrate at these δ and segment lengths: the restarts cost the mean time, not
detections at T. **P2 is kept and scored exactly as registered.** What the lead does decide is P4
(time to cross): with an onset so close to the boundary that the first segment ends below wealth
1, the product carries that deficit and crosses LATER than the mean; with an onset far enough
back that the first segment fires, every arm crosses before the boundary and the arms tie. The
pilot made this dependence visible before the choice. There is no natural shortest lead to take
as the harder-to-pass reading, so the lead is fixed at the structural midpoint of the shortest
segment, **T/8 = 25 ticks before the first boundary** (onset at tick 75 in the 1-boundary cells,
tick 25 in the 3-boundary cells), and a post-hoc lead sweep at 5, 10 and 40 ticks is reported
without verdict (A.4).

**A.3 Stop conditions applied by the harness.** Any assertion failure aborts the run: shipped
verdict ≠ re-derived verdict, per-tick wealth ≠ shipped segment value, non-finite merged value,
local martingale ≠ engine reference. There is no catch anywhere in the harness.

**A.4 Post-hoc, declared in advance, no verdict:** the lead sweep of A.2 on the four injected
cells at the registered N; Family C and D merges at segment ends; tick-resolution detection
rates; the any-boundary population; the martingale-vs-product relation (§3 P3).
