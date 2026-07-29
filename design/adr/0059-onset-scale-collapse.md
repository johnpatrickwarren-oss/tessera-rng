# ADR 0059 — Onset vs N: does the dispersion wall collapse with fleet size, and is the remedy N-robust?

- **Status:** ACCEPTED (measured; the gate-redesign decision is PARKED with the operator —
  see consequences)
- **Date:** 2026-07-28
- **Decision owner:** Tessera-RNG (operator-ratified direction; the gate-redesign decision —
  if a laundering region appears — is explicitly PARKED with the operator, mirroring the GPU
  sibling's open N13 gate decision)
- **Relates to:** the GPU sibling's **N13** (fixed-ς̂ gate onset COLLAPSES with N — dead at
  ≥20k units; rack-local construction is their positive fix — the transfer flag this answers
  for RNG), ADR-0050 (measured the onset at 109 leaves ONLY and swept scale at FIXED ς — the
  onset-vs-N question was never asked), ADR-0051 (the fixed ς\* = 0.05 whose scale validity
  this tests), ADR-0052 (`perLeafScale` — the candidate N-robust construction, measured at
  109 leaves only).
- **Files:** `tools/onset-scale.ts` → `coverage-matrices/onset-scale.{json,md}`,
  `test/onset-scale.test.ts`.

---

## Problem

The GPU sibling measured that no fixed dispersion threshold protects e-BH at scale: the
false-selection onset ς collapses as N grows (extreme-value mechanics — with more units, some
unit's draw is always far enough out), until the gate's fixed threshold sits ABOVE the onset
and the gate LAUNDERS: it passes fleets that are actively false-selecting. RNG's numbers
don't transfer, but the mechanism should: the σ-draw's max grows like √(2 ln N), so the leaf
that false-selects first gets worse with N while ς (a population sd) stays put. ADR-0051's
ς\* = 0.05 was justified at 109 leaves; RNG's paper scale is 1,456+ — the question is open,
and it decides whether the gate as shipped is protective or anti-conservative at scale.

The mirror question: the GPU side's positive fix is a BLOCK-LOCAL construction. RNG's analog
is already built — `perLeafScale` (ADR-0052) removes static per-leaf deviation entirely, which
should kill the extreme-value channel (the corrected residual dispersion is shrinkage noise,
whose own max still grows as √(2 ln N) but from a far smaller base). Whether the remedy is
genuinely N-robust was measured only at 109 leaves.

## Decision

One sweep tool, no production changes. NULL runs (every selection false) on the ADR-0050
crossOptic-off size ramp, both arms:

- **Grid:** ς ∈ {0.02, 0.05, 0.075, 0.1, 0.15} × sizes {109, 1456, 6112} (360/3176 skipped —
  logged truncation; the question is the trend, and three fabric sizes spanning 56× bound it)
  × arms
  {shared, `perLeafScale`}. Seeds: the ADR-0050 8-seed block at 109 (so the overlapping cells
  are CROSS-ARTIFACT ANCHORED: ς = 0.05 and 0.1 at 109/shared must reproduce
  `heterogeneity-boundary.json` exactly), 5 seeds at 1456, 3 at 6112 (logged).
- **Per cell:** mean/max false selections; the PAIR-gate verdict on the calibration window
  (pass rate); and the LAUNDERING rate — fraction of runs where the gate PASSES while e-BH
  false-selects ≥ 1. The laundering column is the finding: a fixed gate is protective exactly
  where that column is 0.
- **Onset per (size, arm):** first grid ς with mean false selections > 0.

## Acceptance criteria

- **AC-1 (anchor):** the 109/shared cells at ς ∈ {0.05, 0.1} equal the ADR-0050 published
  cells exactly (same seeds, same composition).
- **AC-2 (the question answered honestly):** onset per size published for both arms, with the
  laundering column per cell; whatever the trend is — collapse, flat, or reverse — is the
  recorded finding, and if a laundering region exists at any tested size the ADR says so in
  the first line of the consequences and PARKS the gate redesign with the operator (no
  unilateral threshold change).
- **AC-3 (freshness):** one cell recomputes exactly; `.md` ≡ renderMarkdown(`.json`);
  truncations logged.

## Anti-scope

- **No gate/threshold change** — measurement first; redesign (scale-indexed threshold,
  extreme-value-corrected statistic, per-leaf construction as default) is the operator's
  parked decision, informed by this artifact.
- **No new constructions** — `perLeafScale` is the only remedy arm (the GPU rack-local analog
  RNG already owns); a view-local/block-local calibration variant is future work if the
  remedy arm disappoints.
- **No latent-null arm** (ADR-0050 measured it inert; re-crossing it with N is not this
  question). **No power arm** (ADR-0054 owns power).

## Prescription → AC coverage

| Prescription | Bound by |
|---|---|
| 109/shared overlap cells ≡ ADR-0050 artifact | AC-1 |
| Onset + laundering columns per (size, arm) | AC-2 |
| Truncations logged; artifact freshness | AC-3 |

## Consequences — the N13 transfer CONFIRMS, and the remedy is the fix (AC-2)

**A laundering region EXISTS at paper scale, exactly on the fixed threshold.** Artifact:
`coverage-matrices/onset-scale.{json,md}`.

- **The onset collapses with N — into ς\*.** Shared calibration: onset 0.075 at 109 leaves →
  **≤ 0.05 at 1456 and 6112** (a ONE-SIDED bound: no false selections were observed at
  ς = 0.02, but at n = 5/3 seeds a zero count cannot support a lower edge — the true onset
  at scale is somewhere at or below 0.05). At ς = 0.05 the PAIR gate passes **100% of runs**
  while e-BH false-selects in **40% (2 of 5 runs, 1456 leaves) and 67% (2 of 3, 6112)** of
  them — the anti-conservative failure a claim gate must never have, the exact GPU-N13
  pattern (the direction is structurally forced: a gate calibrated to pass at ς\* where the
  onset has collapsed to ≤ ς\* must launder). Magnitude is mild at these sizes (mean ≤ 0.67
  false selections/run, max 1) and confined to the near-threshold band (at ς ≥ 0.075 the
  gate correctly fails 100% and laundering is 0); the measured points are monotone in N
  (2/5 → 2/3 — not resolved at these n) and the grid stops at 6112 leaves; production
  fabrics are larger.
- **`perLeafScale` is the N-robust construction — the RNG mirror of the GPU rack-local fix,
  measured.** Zero false selections and zero laundering in EVERY cell of the remedy arm:
  15/15 (size × ς) combinations across a 56× size span (109 → 6112), through ς = 0.15. The
  extreme-value channel the shared calibration cannot escape (some leaf's draw is always far
  enough out, and its distance grows with N) is removed at the source rather than gated
  after the fact.
- **Cross-artifact anchor held:** the 109/shared overlap cells reproduce
  `heterogeneity-boundary.json` exactly (test-bound).

**The PARKED decision (operator's, mirroring the GPU side's open N13 gate decision):** the
fixed ς\* = 0.05 gate is measured anti-conservative at ≥ paper scale in the band at and
below ς\* (one-sided; see above). Options, with this ADR's evidence: (a) **adopt
`perLeafScale` as the default construction** — the measured fix, N-robust here, but it
carries the ADR-0052 drift cliff (requires the ADR-0053 monitor + recalibration cadence as
preconditions); (b) a **max-statistic gate** (the first false selection comes from the
extreme leaf, so gate on the max standardized ℓ deviation — extreme-value-calibrated —
rather than the population sd); (c) a **scale-indexed threshold** (its real weakness here:
the index would be fit to onset estimates that are 2-of-5-run counts with one-sided lower
bounds — thin material for a curve). No change is made here; ADR-0051's threshold text
stands until the decision, and VALIDATION.md carries the laundering disclosure so the
gate's scale limit cannot be read as protection it does not provide.

Anchor note (cold-eye finding 7): the 109-leaf anchor crosses the crossOptic variant
(ADR-0050's H axis ran crossOptic-on; this sweep's ramp is crossOptic-off) — valid because
incidence edges are INERT in dispersion-only nulls (they enter telemetry only via
`latentNull`); the anchor BREAKS if a latent arm is ever added to this sweep.
