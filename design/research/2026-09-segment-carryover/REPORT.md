# Report — wealth carryover across ADR-0018 reset segments (`2026-09-segment-carryover`, WORKLIST C63)

- **Run:** `results/run-2026-09-03T01-58-14Z/` (manifest, endpoints, cells, per-leaf rows, post-hoc).
- **Code:** tessera-rng `9ad6c20` (registration `c21029b` + amendment A + harness), engine pin
  `github:johnpatrickwarren-oss/deploysignal-engine#v0.6.9-pre` (installed `0.6.9-pre`); the
  martingale arm is a local copy of engine `fleet/combine.ts` at `d6785f3` (ADR 0028, PR #77),
  asserted to 1e-12 against that commit's own dist. Node v25.9.0. Fabric hash `2bc6340d…`.
- **Grid:** 6 registered cells × 200 seeds; α = 0.05; γ = ½; T = 200. Every run passed the
  harness's equality assertions (shipped verdict re-derived; per-tick Family A wealth equal to the
  shipped segment value at every segment end): 6,800 + 6,800 + 6,800 + 14,400 + 14,400 + 14,400
  leaf-runs, zero failures — the harness has no catch, so a failure would have aborted the run.
- **Check:** `node design/research/2026-09-segment-carryover/analysis/check_report.mjs` pins every
  number below to the run artifacts (exit 1 on drift).

## Substrate

The design was executable as registered with one reading fixed in amendment A: `generateTelemetry`
applies a degradation on a resource the leaf keeps traversing through every epoch, so a fault on
`pzone-0` persists across reroutes that drain the leaf's cooling zone (`makeEpochs` +
`segmentPlan`, the `test/epoch.test.ts` pattern). `runPerturbed` (ADR-0032) was not needed.
Population: changed leaves on `pzone-0` reset at every boundary of the cell — 34 per seed in the
1-boundary cells (N = 6800), 3–5 per seed in the 3-boundary cells (N = 757 / 752 / 741; the
any-boundary K histogram at `b3-d0` is 8728 / 4915 / 757 for K = 2 / 3 / 4).

## Registered endpoints, as measured

Rates are "merged e-value ≥ 1/α at any segment end" over the cell's population. Cells are
`b<boundaries>-d<δ>`.

| # | endpoint | measured (mean / product / martingale) | band | verdict |
|---|---|---|---|---|
| P1 | H0 ever-crossing, `b1-d0` (N = 6800) | 0.0049 / 0.0044 / 0.0001 | ≤ 0.0579 each | **HELD** |
| P1 | H0 ever-crossing, `b3-d0` (N = 757) | 0.0079 / 0.0225 / 0.0013 | ≤ 0.0738 each | (same verdict) |
| P2 | product ≥ mean on `b1-d2`, `b1-d4`, `b3-d2`, `b3-d4` | 1.0000 = 1.0000 on 4/4 | ≥ on 4/4 | clause holds (ties) |
| P2 | product − mean at `b3-d4` (N = 741) | 0.0000 (band ≥ 0.10) | ≥ 0.10 | **FAILED** |
| P3 | martingale ≥ mean, per injected cell | 0.5116, 0.9309, 1.0000, 1.0000 vs mean 1.0000 | ≥ on 4/4 | **FAILED** (2/4) |
| P4 | median first tick at δ = 4, `b1-d4` / `b3-d4` (product / mean / martingale) | 98 / 98 / 111 and 41 / 41 / 61 | product ≤ mean | **HELD** (ties) |
| P5 | Var at T under H0, product vs martingale, `b1-d0` / `b3-d0` | 12.16 vs 0.15; 22.71 vs 1.40 | product > martingale | **HELD** |

P5's mean variance (10.92, 52.00) is reported, not compared: the mean is not an se-merging function.

## What it settles

1. **Validity is not the issue (P1).** All three merges sit far under α at the segment-end stopping
   times; the martingale merge is the most conservative by two orders of magnitude, because with
   λ₁ = 0 it does not bet on the first segment at all.
2. **The mean's restarts cost time, not detections, at these δ and segment lengths (P2).** A
   fully faulted 50-tick segment reaches Family A e ≈ 1e12 (δ = 2) to 1e22 (δ = 4) on its own,
   so every merge is at 1.0000 by the end of the second segment and the registered ≥ 0.10 margin
   cannot appear. Amendment A recorded this before the run; the endpoint is scored as registered:
   FAILED. Per §4 the ADR-0018 mean stands.
3. **The adaptive martingale merge is dominated by the mean on two-segment leaves (P3).** With
   K = 2, λ₂ is a function of e₁ alone and is 0 whenever e₁ ≤ 1; the merge then never bets and
   stays at 1. The mean λ₂ on `b1-d2` was 0.2559 (about half the leaves at γ = ½, half at 0),
   which is the 0.5116 detection rate. With K = 4 (the 3-boundary cells) λ has reached γ by the
   third segment and the merge detects 1.0000. Theorem 7.22's log-optimality is asymptotic in K;
   the registration anticipated the transient against the product and registered the mean
   comparison anyway, and it failed.
4. **Time to cross ties at δ = 4 (P4).** The onset 25 ticks before the first boundary lets the
   median leaf fire inside the first segment, before any merge is involved: product = mean at 98
   and 41. At δ = 2 (reported, no verdict) the carried wealth shows: `b1-d2` medians
   118 / 116 / 132 and `b3-d2` 64 / 56 / 70 (mean / product / martingale) — the product crosses 2
   and 8 ticks earlier than the mean.
5. **The product is the maximum-variance merge under the null (P5),** by a factor of 16–80 over
   the martingale merge, as Proposition 8.16 says.

## Ship rule (§4)

P1 HELD, P2 FAILED: the rule **does not fire**. No `carryover` parameter, no ADR, no change to
`combineSegmentRuns`. The shipped mean is retained, and the finding narrows what "smarter wealth
carryover" would buy on this substrate: earlier crossing at low δ, never more detections at T.

## Reported quantities (no verdict)

- **Tick-resolution H0 crossing** (the merge over completed segments times the running wealth):
  `b1-d0` 0.0403 / 0.0393 / 0.0010, `b3-d0` 0.0225 / 0.0436 / 0.0040 (mean / product /
  martingale). The product at tick resolution is a genuine e-process on sequential segments and
  sits under α; the mean at tick resolution is not one and also sits under α here.
- **Family C** (Safe-Hotelling) segment merges at segment ends, `b1-d2`: 0.1053 / 0.0009 / 0.0001;
  `b3-d2`: 0.3830 / 0.0505 / 0.0838. The product carries C's sub-1 null segments as a deficit and
  loses to the mean at δ = 2; at δ = 4 all three reach 1.0000 (C) except the martingale on
  `b1-d4` (0.3151). **Family D** never crosses in any cell above 0.0054.
- **Martingale vs product**: the product's rate is ≥ the martingale's in every injected cell; the
  martingale's median crossing is later in every cell (111 vs 98, 61 vs 41, 132 vs 116, 70 vs 56).
- **Any-boundary population** (K ≥ 2, N = 14,400 in the 3-boundary cells): mean and product at
  1.0000 on every injected cell, martingale 0.9769 / 0.9908 at δ = 2 / 4; medians 53 / 53 / 117 and
  41 / 41 / 110.
- **Shipped Family A `fired`** (any segment ≥ 1/α_A with α_A = 0.01): 0.0012 and 0.0013 on the H0
  cells, ≥ 0.9999 on every injected cell.

## POST-HOC — the fault-onset lead (declared in amendment A.4; no verdict)

Same population rule, same N, lead L ticks before the first boundary. Medians are first ticks at
1/α (mean / product / martingale); ∞ = fewer than half the leaves crossed.

| cell | N | median first tick (mean / product / martingale) | martingale rate |
|---|---|---|---|
| b1-d2-L5 | 6800 | 119 / 121 / ∞ | 0.0915 |
| b1-d4-L5 | 6800 | 111 / 112 / ∞ | 0.1179 |
| b3-d2-L5 | 760 | 69 / 69 / 117 | 1.0000 |
| b3-d4-L5 | 721 | 60 / 60 / 110 | 1.0000 |
| b1-d2-L10 | 6800 | 119 / 120 / ∞ | 0.1275 |
| b1-d4-L10 | 6800 | 110 / 111 / ∞ | 0.2463 |
| b3-d2-L10 | 741 | 68 / 68 / 117 | 1.0000 |
| b3-d4-L10 | 763 | 60 / 59 / 62 | 1.0000 |
| b1-d2-L40 | 6800 | 96 / 96 / 119 | 0.9178 |
| b1-d4-L40 | 6800 | 81 / 81 / 111 | 0.9874 |
| b3-d2-L40 | 751 | 32 / 32 / 69 | 1.0000 |
| b3-d4-L40 | 754 | 23 / 23 / 60 | 1.0000 |

Reading: with an onset 5–10 ticks before the boundary the first segment ends below wealth 1 (the
null ticks before onset ate it), the product carries that deficit and crosses 1–2 ticks LATER than
the mean in the 1-boundary cells; the product's segment-end rate at `b1-d2-L10` is 0.9999, the
only injected cell in the study where any arm other than the martingale missed a leaf. With a
40-tick lead every leaf fires in the first segment and the arms tie. The registered P4 verdict
therefore depends on the lead, as amendment A.2 said it would; the verdict above is at L = 25.

## Not measured, and scope

- Synthetic fabric only, Family A only for the verdicts, α = 0.05, δ ∈ {2, 4}, 50- and 100-tick
  segments. No claim about real telemetry (`VALIDATION.md` Tier 3) or about δ small enough that a
  faulted segment does not fire on its own — the regime where a rate margin could exist was not
  in the registered grid.
- One lead per registered cell; the lead sweep is post-hoc.
- The fabric is fixed (`DEFAULT_FABRIC`); seeds vary the telemetry and the remap draw, so the
  1-boundary population is the same 34 leaves under 200 noise realizations.
- A first launch of the harness (`run-2026-09-03T00-34-56Z`) was killed by the tool timeout before
  writing any file; the empty directory was removed. No numbers were produced by it.
- Wiki write-back (source page, C63 close) is not done here; it belongs to the knowledge repo.
