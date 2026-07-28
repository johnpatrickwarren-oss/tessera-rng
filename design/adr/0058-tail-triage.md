# ADR 0058 — Tail triage: the monitor→tomography bridge (fault-shaped vs drift-shaped)

- **Status:** ACCEPTED (fixture numbers below)
- **Date:** 2026-07-28
- **Decision owner:** Tessera-RNG (operator-ratified direction — recommendation 2)
- **Relates to:** ADR-0053 (the recorded `tail` ambiguity this disambiguates: "localized
  variance-mode faults and subpopulation drift are INDISTINGUISHABLE here"), ADR-0046 (the
  linear-magnitude localizer machinery reused on a new currency), ADR-0051 (ℓ statistics).
- **Files:** `src/tail-triage.ts`, `test/tail-triage.test.ts`. No pipeline changes.

---

## Problem

When the drift monitor reads `drifted`/`tail`, the operator action forks: a dispersed
SUBPOPULATION of noisy leaves is either a real localized fault (→ page the resource) or
subpopulation calibration drift (→ recalibrate). ADR-0053 recorded the two as
indistinguishable from the dispersion statistics alone. But the repo owns the instrument
that CAN distinguish them: the incidence hypergraph. A fault-driven tail shares a physical
resource; a drift-driven tail is incidence-scattered. That is a localization question.

## Decision

`tailTriage(snapshot, residuals, opts)` — a standalone pure function (recorded operator flow:
when the monitor reads `drifted`/`tail`, run it on the same residual map; no pipeline
threading this round — anti-scope):

1. **Tail membership:** per-leaf pooled log-scale ℓ_i (the ADR-0051 statistic, shared code);
   member iff the ONE-SIDED standardized deviation z_i = (ℓ_i − median ℓ)/√floorVar exceeds
   `zThreshold` (default 3 — individually-significant scale INFLATION; deflation, e.g. parked
   entities, is not the false-selection direction and is not tail). Empty tail ⇒ `no-tail`.
2. **Localize the tail on the scale-deviation currency:** the ADR-0046 linear localizer runs
   with `magnitudeT: z_i` and `magnitudeTicks: T` — a RECORDED REINTERPRETATION: y ~
   N(θ·w·√T, 1) scores z as accrued scale-drift evidence (z genuinely grows as √T for a fixed
   true scale deviation), with the virtual fleet candidate competing. This is a triage
   heuristic on sound Gaussian scoring, NOT a calibrated variance-fault model (the generator's
   variance faults are undiluted; real dilution semantics for scale faults are unknown —
   recorded).
3. **Verdict:** `fault-shaped` iff the top culprit is physical AND is **MATERIALLY incident**
   (edge weight ≥ 0.5 — the ADR-0054 concept) on ≥ `minExplained` (default 0.6) of the tail;
   else `drift-shaped`; `indeterminate` when |tail| < 2 (a single drifted leaf and a one-leaf
   fault are genuinely indistinguishable by incidence — the instrument does not claim a
   discrimination it cannot make). The verdict carries the culprits and the coverage
   fraction — the operator sees the evidence, not just the label.

   **CORRECTED (cold-eye CRITICAL):** the draft computed coverage from
   `Culprit.member_path_class_ids` — PROVENANCE over all firing members, weight-blind — and
   on the DEFAULT full-support fabric (crossOptic: every tor leaf traverses every optic at
   1/(nTors−1)) that read a SCATTERED tail as `fault-shaped` with coverage 1.0: the drift
   case inverted with maximal confidence, demonstrated by the reviewer on the exact fabric
   the monitor runs on. Material-weight coverage restores the discriminator (bound by the
   AC-1b spraypoint test). The draft's "singleton own-resources each cover ~1/|tail|"
   generality claim was false outside disjoint incidence — replaced. NB (reviewer residual):
   BROAD resources (rooms carry w ≥ 0.5 to most of the fleet) are materially incident on
   nearly everything — for them the discrimination rides on the LOCALIZER (quiet-member
   falsification keeps a room from topping a scattered tail; a genuine room fault topping it
   with full coverage is the correct fault-shaped reading), not on coverage alone.

## Acceptance criteria

- **AC-1 (separation, both directions):** a resource-aligned scale inflation (subpopulation
  sharing one resource) triages `fault-shaped` with that resource top and coverage ≥ 0.9; an
  incidence-SCATTERED inflation of equal magnitude triages `drift-shaped`. An
  incidence-blind mutant (always-fault or always-drift) dies on one of the pair.
- **AC-2 (no-tail honesty):** clean residuals ⇒ `no-tail`; nothing is fabricated.
- **AC-3 (agreement with the monitor's home case):** the ADR-0053 AC-4 fixture (2/20 leaves
  on `r-hot`, genuine variance fault) triages `fault-shaped`/`r-hot` — the bridge closes the
  recorded ambiguity in the direction the monitor could not.

## Anti-scope

- **No pipeline/audit threading** (its own decision once an operator flow uses it); **no
  drain wiring** (a `fault-shaped` verdict is evidence, not an action). **No calibrated
  variance-fault member model** (the reinterpretation is recorded; a proper scale-fault
  likelihood is future work). **No real-data run this round** (the real replay's tail is
  deflation-side — parked cores — outside the one-sided rule by design).

## Prescription → AC coverage

| Prescription | Bound by |
|---|---|
| One-sided z tail membership + empty ⇒ no-tail | AC-2 |
| Localizer on the z currency, fleet candidate competing | AC-1 |
| MATERIAL-weight coverage verdict rule (w ≥ 0.5) | AC-1 (both directions) + AC-1b (full-support fabric) |
| Singleton tail ⇒ indeterminate, nothing fabricated | AC-2b |
| Bridge closes the ADR-0053 ambiguity | AC-3 |

## Consequences — measured (AC-1..3, test-bound)

On the 20-leaf fixture (each leaf its own resource; `r-hot` shared by 2):

- **Separation is clean in both directions at equal magnitude (×2.5 inflation):** the
  resource-aligned pair triages `fault-shaped`, top culprit `r-hot`, coverage 1.0, tail
  exactly the pair; the incidence-scattered trio triages `drift-shaped` with top coverage
  < 0.6 and tail exactly the trio. An incidence-blind mutant dies on one of the pair (AC-1).
- **Nothing fabricated:** clean residuals read `no-tail` with empty culprits (AC-2).
- **The ADR-0053 ambiguity is closed end-to-end (AC-3):** the exact fixture ADR-0053
  recorded as indistinguishable — a genuine variance fault reading `drifted`/`tail` — now
  resolves to `fault-shaped`/`r-hot` through the bridge. The operator fork (page vs
  recalibrate) has an evidence-bearing answer: verdict + culprits + coverage fraction.
- **Full-support incidence is covered (AC-1b, the cold-eye CRITICAL bound):** on
  DEFAULT_SPRAYPOINT — where the weight-blind draft inverted the verdict — a scattered tail
  reads `drift-shaped` under material-weight coverage; a singleton tail reads
  `indeterminate` (AC-2b). Cold-eye findings 3–5 also folded: the inert q0 computation
  deleted (the magnitudeT path is parameter-free), `pooledLogScales` errors neutrally worded,
  the sampling floor now shared from ONE definition (`samplingFloorVar` — estimator, monitor
  and triage can no longer desynchronize). Recorded (finding 6): `zThreshold` is fixed
  w.r.t. n — at n ≈ 10⁴ chance tail members dilute coverage toward `drift-shaped`, the safe
  direction for paging.

Recorded follow-ups: pipeline/audit threading once an operator flow consumes it; a
calibrated scale-fault member model to replace the reinterpretation; a real-data triage run
when a real population with an inflation-side tail exists (the current real replay's tail is
deflation-side — parked cores — outside the one-sided rule by design).
