# ADR 0061 — The max-z statistic: an extreme-value-calibrated third gate binding, N-indexed from theory

- **Status:** ACCEPTED (regenerated envelopes below; the prediction held — both cells trip, realized z above bound)
- **Date:** 2026-07-28
- **Decision owner:** John (ratified — (b) of the ADR-0059 parked decision); Tessera-RNG
  (execution)
- **Relates to:** ADR-0059 (the laundering this closes: the pair gate passes at ς\* where the
  onset has collapsed below it), ADR-0051 (the gate family this extends — third binding),
  ADR-0060 (the (a) companion; the license does not change here), ADR-0053 (the monitor —
  deliberately NOT extended, see the recorded narrowing).

---

## Problem

ADR-0059 measured why the pair gate launders: ς̂ is a POPULATION statistic, but the first
false selection comes from the EXTREME leaf, whose expected deviation grows like √(2 ln n)
while ς̂ stays put. A population test cannot see an event that is typical FOR the population's
maximum. The right instrument is the max itself, standardized by the SAMPLING floor (the
absolute scale on which e-BH's per-leaf validity lives) — NOT by the population sd
(a studentized max asks "is the extreme leaf an outlier among its peers?", which a
Gaussian-family extreme never is; the laundering leaf is a typical Gaussian max, and a
studentized test would re-launder it — the design trap, recorded).

## Decision

1. **`z_max`** joins the estimate: max over leaves of the one-sided standardized deviation
   `(ℓ_i − median ℓ)/√floorVar` (the tail-triage statistic, computed where the estimator
   already has the ℓ's).
2. **`z_max_bound`** — the Bonferroni bound `Φ⁻¹(1 − α/n)` at **α = 0.01**: CONSERVATIVE
   (P(trip) ≤ α) under the iid-Gaussian null, approximate in practice (median-centering,
   shared-fit dependence — see the code doc), N-INDEXED FROM THEORY (this is what separates it from the rejected
   scale-indexed-threshold option: no curve is fit to anything). α = 0.01 budgets a 1%
   per-window false gate-trip on clean fleets.
3. **The gate binds on the TRIPLE:** passing ⇔ max(robust ς̂, tail ς̂) ≤ ς\* AND
   z_max ≤ z_max_bound. Verdict carries both new fields.
4. **The monitor is deliberately NOT extended (recorded narrowing):** the floor
   standardization is only clean on the calibration window. Under `perLeafScale`, fresh
   live-window deviations carry correction noise (variance ≈ 2× the floor — the ADR-0053
   regime effect), so a floor-standardized max would read every fresh window as drifted. A
   regime-aware max for the monitor is future work; under the ADR-0060 license the monitor's
   role is guarded by the per-leaf construction + pair statistics, and shared-calibration
   audits are never licensed regardless.

## Predicted (from the extreme-value arithmetic) — to be replaced by measurement

At ς = 0.05: dev_max ≈ ς·√(2 ln n) → z ≈ 4.6 (1456) and ≈ 5.1 (6112) vs bounds 4.35 / 4.65 —
both TRIP (the laundering closes); at 109 clean, realized max ≈ 2.5–3.2 vs bound 3.74 —
passes. Whatever is measured is published, including a wrong prediction (ADR-0020 precedent).

## Acceptance criteria

- **AC-1 (the laundering closes):** the regenerated onset-scale artifact shows laundering = 0
  in EVERY cell under the triple gate; the previously-laundering cells (1456/6112, ς = 0.05)
  now show gate_pass_rate < 1. The ADR-0059 pins are updated to the triple-gate reality with
  the pair-era numbers preserved in ADR-0059's text (historical, git-recorded).
- **AC-2 (clean fleets still pass):** clean-cell gate pass rates in the regenerated
  dispersion-gate and onset-scale artifacts published as measured (α = 0.01 budgets ~1% trips;
  fixed seeds make any trip a permanent published dent — honest, not smoothed).
- **AC-3 (session parity + wiring):** the new fields ride the estimate through gate, prelude,
  and audit; batch ≡ session on the stamped fields; a z_max-blind mutant (gate on the pair
  only) dies on the DIRECT tests in test/dispersion-gate.test.ts (an estimate-level
  triple-binding pin + a production-path pin on a former laundering run — experiment-
  confirmed; the artifact pins alone did not kill it, the round-7 cold-eye CRITICAL).
- **AC-4 (freshness):** regenerated artifacts recompute exactly; `.md` ≡ renderMarkdown.

## Anti-scope

No monitor extension (recorded above); no license change (ADR-0060's rule is unchanged — the
gate is not a license conjunct); no α tuning beyond the recorded 0.01; no re-run of
heterogeneity-boundary / per-leaf-scale / heterogeneity-power (no gate fields in their
artifacts; drift-monitor regenerates for a license-phrasing correction only — numerics
unchanged, ADR-0060 finding 2); real-replay regenerates only if its published gate booleans
change (they cannot — z_max only adds failures to already-failing cells; verified).

## Prescription → AC coverage

| Prescription | Bound by |
|---|---|
| z_max + Bonferroni bound in the estimate (floor-standardized, one-sided) | AC-3 |
| Triple gate binding | AC-1 (mutant-killing pins) |
| Clean-fleet budget honest | AC-2 |
| Monitor narrowing recorded, not implemented | anti-scope (reviewed) |

## Consequences — the laundering is closed (AC-1..4, regenerated artifacts)

- **The extreme-value prediction held (both cells trip; realized z above bound).** The former laundering cells — (1456, ς=0.05)
  and (6112, ς=0.05), where the pair gate passed 100% while e-BH false-selected — now FAIL
  **100%** via z_max (published per cell: the artifacts carry mean/max z_max and the bound) (predicted z ≈ 4.6/5.1 from NOMINAL ς — realized ς runs ≈1.18× nominal, so realized-ς predictions are ≈5.5/6.0, closer to the measured means — vs bounds 4.35/4.65). **Laundering is 0 in every
  cell of both arms** (onset-scale regenerated; pinned by test — a pair-only mutant
  resurrects the laundering and dies).
- **Clean fleets still pass where it matters:** ς = 0.02 at 1456/6112 → 100% pass; the fixed
  clean seeds at 109 all clear the bound (max realized z 3.00 vs 3.74). One conservative
  trip appeared: (109, ς = 0.02) passes 7/8 (the tripping run has 0 false selections — a
  claim withheld that would have been valid; the α = 0.01 budget's price, published).
- **The straddle cells turned fully conservative:** 109/ς = 0.05 now 0% pass (pair-era
  12.5%/13% — preserved in ADR-0051's text as the pair-era value); the dispersion-gate
  envelope's transitional cell likewise 13% → 0%. More claims withheld near the boundary,
  none laundered — the correct trade for a claim gate.
- **The remedy arm is untouched:** perLeafScale 100% pass / 0 false selections / 0
  laundering everywhere (same single conservative trip at 109/0.02, where λ ≈ 0 makes the
  corrected residuals ≈ uncorrected).
- The ADR-0051 VALIDATION ⚠️ scale limit is CLOSED: the gate family's scale story is now
  "the triple gate refuses everywhere selection lies, at every tested N, with a
  theory-indexed bound" — ADR-0059's pair-era laundering numbers remain in its text as the
  motivating measurement.
