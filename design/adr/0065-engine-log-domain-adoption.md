# ADR 0065 — Engine v0.6.5-pre adoption: the δ=32 overflow defect closed; exact log-domain audit record

- **Status:** ACCEPTED (measured below)
- **Date:** 2026-07-29
- **Decision owner:** Tessera-RNG (the ADR-0063 parked decision was operator-ratified
  2026-07-29: option (a), the engine log-domain fix — engine ADR 0026, released v0.6.5-pre)
- **Relates to:** ADR-0063 (the measured defect + the parked decision this discharges),
  ADR-0034 fix B (the original recording), ADR-0056 (the pin-bump pattern),
  engine ADR 0026 (log-domain wealth), engine ADR 0025 (sequential UI e-process — in the
  same release; not consumed here, no RNG surface needs it),
  `test/overflow-defect.test.ts` (the tripwire this FLIPS, as it said it would).

---

## What the pin bump brings

Engine v0.6.3-pre → v0.6.5-pre (v0.6.4-pre's covariate residualizer is not in this
repo's import surface; it rides along):

- **Safe-Hotelling / betting wealth is log-domain** (engine ADR 0026): `state.log_M` is
  exact; `state.M` (what our Family A/C consume) is a `Number.MAX_VALUE`-saturating view —
  never `Infinity`, never JSON `null`, non-absorbing, NaN-pathway closed.
- ⚠️ **Ulp-level numeric shift:** `exp(Σ z_t)` rounds differently than `Π exp(z_t)`, so
  every downstream pinned artifact can move in final ulps. This is the versioned break
  engine ADR 0026 records; artifacts whose freshness binds break are regenerated in this
  round and the diffs are verified ulp-level only.

## Decision

1. **Pin bump** to `#v0.6.5-pre`.
2. **The tripwire flips** (`test/overflow-defect.test.ts`): δ=32 per-leaf e-values are now
   FINITE (saturated view), JSON round-trips carry no `null`, selection still fires. The
   test now pins the FIXED behavior and would flip back on a regression.
3. **The exact record:** per-leaf verdicts and the audit gain `log_e_value` — the exact
   log-domain per-leaf combined e-value (engine `combineAverage` over the family
   log-e-values: A = logSumExp-mean of per-signal `log_M`; C = `log_M` of the
   safe-Hotelling state; D = `log(M)` of the RNG-side capped spectral wealth, exact by
   its 1e12 cap). `e_value` keeps its existing definition (linear mean of the family
   views) byte-for-byte, so artifact churn is confined to the engine's own ulp shift.

## Scope change, on measured evidence: the localizer's log-magnitude channel

The draft parked "the localizer keeps consuming the linear view" as anti-scope. The suite
falsified that scoping immediately: the ADR-0033 recorded band-tradeoff pin
(`test/z-calibration.test.ts`) FAILED on the new engine — at δ=32 every saturated leaf ties
at the `Number.MAX_VALUE` view, so calibrated z lost the high-δ band it was recorded to win
(measured: cal 0/3, raw 0/3 — the pre-fix pass had been holding by Infinity-arithmetic
accident). Since `magnitudeZ` only ever consumes ln E, the principled fix was exactly the
exact record this ADR adds: `LocalizeOpts.logMagnitude` (+ `magnitudeZFromLog`) feeds the
same statistic from `log_e_value`, restoring true ordering at saturation. **Re-measured,
the recorded tradeoff reproduces as originally pinned: δ=4 raw 3/3 > cal 0/3; δ=32
cal 3/3 > raw 0/3.** The tradeoff test now feeds the log channel and documents why.

## Anti-scope, with reasons

- **Selection stays on linear e-BH.** `eBenjaminiHochbergLog` exists engine-side, but
  switching the selection input would move selections at ulp boundaries for zero measured
  gain: at δ=32 the saturated leaves are all selected either way (the defect was always
  representational, ADR-0063).
- **The production localizer wiring is unchanged** — non-epoch'd runs use the ADR-0046
  linear-t currency (unsaturated by construction); `magnitudeT` composition and the legacy
  pipeline wiring keep their bytes. ⚠️ The EPOCH'D fallback path still feeds the saturating
  linear e-channel (`pipeline.ts` `magnitudeT: epochs ? null : …`), where saturated leaves
  now tie at z(ln MAX) ≈ 37.7 (pre-fix: at Z_MAX = 40 via the Infinity branch) — the same
  latent tie the band pin exposed, LIVE in that unpinned regime. The new `logMagnitude`
  channel is exercised by the z-calibration band pin; flipping the epoch'd wiring to it is
  future work with a trigger (a real fault regime that saturates multiple leaves there).
- `fleet_log_e` (surface) keeps its existing computation from the linear views — in-range
  it is ulp-identical to the exact record; at saturation it is capped at ~log(MAX) while
  the per-leaf exactness lives in `log_e_value`. Recorded, not hidden.
- No consumption of engine ADR 0025 (sequential UI); no other engine surfaces adopted.

## Acceptance criteria

- **AC-1 (tripwire flip):** δ=32 → max per-leaf `e_value` finite, no JSON `null`
  anywhere in the audit, selection fires, and `log_e_value` is exact (finite, huge, and
  strictly ordered where the linear view ties at saturation).
- **AC-2 (ulp-only artifact churn):** every regenerated artifact differs from its
  predecessor only in float ulps — no selection set, verdict, gate decision, or count
  changes anywhere in the regenerated matrices.
- **AC-3 (log/linear coherence):** in-range leaves satisfy
  `|log(e_value) − log_e_value| ≤ 1e-9` (they are the same quantity in two domains —
  computed independently, so this binds the threading).
- **AC-4 (suite + gate):** full suite green; sprag arch gate PASS.
- **AC-5 (cold-eye finding 1 — the means saturate too):** the engine saturates each STATE's
  view, but the RNG-side linear MEANS sum those views and `MAX + MAX/K = Infinity` — a
  long-session hard fault (Family A saturates after ~1100 growth ticks alongside C)
  resurrected the JSON null on the combined `e_value` (reviewer-demonstrated). Every linear
  mean (`runFamilyA`, combined/segment/family combines, session `segmentVerdict`, the
  escalation tier) now passes through `saturateE` (identity in range — bytes preserved);
  bound by a 3000-tick hard-fault test asserting the combined view saturates finite while
  `log_e_value` keeps the true magnitude.
- **AC-6 (cold-eye findings 2–3):** the `magnitudeZFromLog` Z_MAX clamp is mutant-bound
  (raw clamps at 40 where calibrated reads exactly 10); `detectorLogE` heals a DEFECT-ERA
  serialized-Infinity row (`e_value: null`) to the saturation point, never through
  null-coercion to the floor — both pinned directly.

## Cold-eye round — folded

Fresh-context review: NOT-MERGE-READY on finding 1 (above — the round's own "JSON
corruption class closed" claim was falsifiable through the linear means; my in-range
"only one family saturates" reasoning did not survive the always-on session's time
horizon). Also folded: the surviving Z_MAX-clamp mutant (AC-6), the `detectorLogE`
null-coercion heal inversion, stale `LocalizeOpts` precedence docs, a redundant
segment-row expression, the epoch'd-path anti-scope overstatement (kept as anti-scope,
now stated honestly above), and `package-lock.json` staged with the pin bump. The
reviewer independently reproduced the ADR's band-tradeoff numbers and the ulp-only demo
churn, and verified every producer's log/linear coherence.
