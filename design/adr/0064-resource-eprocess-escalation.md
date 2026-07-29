# ADR 0064 — Resource-directed matched-filter e-processes: the sub-floor escalation tier, shipped under ADR-0049's build conditions

- **Status:** ACCEPTED (measured floors below — with an honest correction to the probe table)
- **Date:** 2026-07-28
- **Decision owner:** Tessera-RNG (operator-ratified direction — improvement recommendation 5)
- **Relates to:** ADR-0049 §2 (the probe: √m SNR gain real — room detection at HALF the leaf
  floor — and the sibling-aggregate confound real, E ≈ 882 on room-1 for a room-0 fault; the
  recorded build conditions this discharges), ADR-0047 (identifiability machinery),
  ADR-0058 (the standalone-triage precedent this follows), ADR-0044 (tick-filtration
  validity of the betting statistic under a calibrated null).
- **Files:** `src/resource-eprocess.ts`, `test/resource-eprocess.test.ts`,
  `tools/resource-eprocess.ts` → `coverage-matrices/resource-eprocess.{json,md}`.

---

## Problem

Broad faults below the leaf-layer detection floor (a room at Δ = 0.5 shifts every member
leaf by a diluted fraction) are invisible per-leaf but visible in aggregate: the w-weighted
sum over m member leaves gains ≈ √m in SNR. ADR-0049 probed exactly this and measured the
gain (room Δ = 0.5: leaf layer 0/4, aggregate 4/4) — and refused to ship it on two recorded
grounds: the probe's unit-variance null was WRONG under cross-leaf dependence, and the
aggregate hypothesis ("this weighted combination shifted") must not masquerade as
resource-level selection when domains overlap (the sibling confound).

## Decision — the two build conditions, discharged

### 1. Calibrated aggregate nulls

Per resource r and signal j, the aggregate `y_{r,j}(t) = Σ_pc w(pc,r) · resid_{pc,j}(t)`
over its member leaves. Its null (mean, sd) is estimated **from the clean calibration
window's aggregates** — the same discipline as every other null in the system, and it prices
the cross-leaf dependence the probe's informal null ignored (the aggregate of correlated
residuals has variance ≠ Σw²). Live aggregates standardize against that null and feed the
engine betting e-process per signal; the resource e-value is the per-signal MEAN (the Family
A pattern — a tick-filtration supermartingale UNDER THE CALIBRATED AGGREGATE NULL, with the
same ADR-0062-class conditionality: dispersion/drift voids it, the gate/monitor
preconditions apply).

### 2. Escalation-tier semantics: neighborhoods, not selection

A firing aggregate claims **"this overlapping NEIGHBORHOOD shifted — run the drill"**, never
"this resource is at fault". The neighborhood is the **OVERLAP UNION**: resources sharing
material member weight (w ≥ 0.5, the ADR-0054/0058 concept) with r, plus r's ADR-0047
ambiguity group. **Spec correction recorded upfront:** ADR-0049's wording named the
ambiguity union alone as the granularity — but ADR-0047 measured these fabrics fully
1-identifiable (ambiguity groups EMPTY), while the measured sibling confound is
OVERLAP-driven (split pair-leaves belong to both rooms at w = ½ — a room-0 fault fires the
room-1 aggregate through their shared members). The ambiguity union alone would cover
nothing; the overlap union covers the measured confound. Both are included; the deviation
from the recorded wording is this paragraph.

Multiplicity is DISCLOSED, not laundered: `alpha` is per-resource (R resources ⇒ fleet-wise
false-escalation budget ≈ R·α, stated in the output and artifact); the tier is early warning
for the ADR-0049 §1 evidence-ordered drill, not an FDR surface — nothing here touches
selection, the license (ADR-0060), or the audit.

### 3. Standalone, like the tail triage

`escalationTier(snapshot, calibResiduals, liveResiduals, opts)` — a pure exported function;
no pipeline/audit threading (the ADR-0058 precedent: threading follows an operator flow).

## Acceptance criteria

- **AC-1 (calibrated-null validity SMOKE — the probe's missing half):** on clean fabrics
  across seeds, the per-resource false-escalation rate is consistent with α (published; the
  probe had no such validation). NB (corrected against measurement): clean-side, mean-betting
  is SCALE-FAIR, so this smoke CANNOT bind the calibration — that binding is AC-1b.
- **AC-1b (the calibration mutant-killer, FAULT-side):** under a room-0 fault, the calibrated
  sibling (room-1) aggregate E clears 1/α on every seed; a no-calibration (unit-variance)
  mutant's sibling E is erratic and drops below 1/α on half the seeds — the mutant dies on
  this pin. The published `sibling_null_comparison` table carries both columns.
- **AC-2 (the sub-floor gain reproduces under the HONEST null):** room Δ = 0.5 — leaf layer
  0/4 vs escalation ≥ 3/4 (whatever is measured is published; the probe's 4/4 was under the
  wrong null). Panel/optic Δ = 1 likewise published.
- **AC-3 (the confound is semantics now):** for a room-0 fault, if the room-1 aggregate
  fires, room-1's tier entry NAMES room-0 in its neighborhood (the overlap union) — the
  operator is pointed at the drill over the neighborhood, never at a bare sibling. Bound by
  test on the measured confound case.
- **AC-4 (freshness):** artifact recomputes; `.md` ≡ renderMarkdown(`.json`).

## Anti-scope

No pipeline/audit threading; no FDR/selection semantics (the tier cannot select — its output
type has no selection field); no drill automation (the tier RECOMMENDS the drill target set);
no per-resource α correction beyond disclosure (a corrected tier-wide budget is future work
with an operator flow); no epoch support.

## Prescription → AC coverage

| Prescription | Bound by |
|---|---|
| Calibrated aggregate null (dependence priced) | AC-1b (fault-side sibling pin — the unit-variance mutant dies there; AC-1 is the clean validity smoke) |
| Sub-floor gain under the honest null | AC-2 |
| Overlap-union neighborhood semantics on the measured confound | AC-3 |
| Per-resource α disclosed; no selection surface | type-level + AC-1 publication |

## Consequences — measured under the honest null (AC-1..4; one RETRACTION on the record)

Artifact: `coverage-matrices/resource-eprocess.{json,md}` (n = 4 seeds/cell, 76 resources).

- **RETRACTION + the guard it bought (cold-eye CRITICAL):** this ADR's first published
  consequences claimed the probe's narrow-resource wins were "null-error artifacts" (panel
  Δ = 1: 0/4). That claim was itself an artifact — the tool targeted `shuffle-panel-7`, a
  NONEXISTENT resource id, and `generateTelemetry` silently no-opped: the row measured clean
  data. With the real id, **panel-7 Δ = 1 escalates 3/4 — the probe REPRODUCES** (optic-3:
  2/4 vs the probe's 3/4, within n = 4 seed noise). The silent no-op is now a THROW in the
  generator (a degradation naming an unknown resource fails loudly, guard-tested) — a typo
  can never again manufacture a "finding" from clean data.
- **Clean validity (the probe's missing half): 0 escalations in 4×76 resource-runs.**
  Clean-side, mean-betting is scale-fair, so this smoke cannot bind the calibration; the
  calibration's mutant-killer is fault-side (next bullet).
- **The sibling confound is real and STRONGER than the probe suggested — and it is the
  calibration's binding test:** under a room-0 Δ = 1 fault, the room-1 aggregate genuinely
  shifts (shared members at w = ½) and the calibrated null detects it on every seed
  (E ≈ 1.1–2.5e5); the unit-variance null is ERRATIC on the same data (E from 2.1e-3 to
  1.9e3 — clipped bets on mis-scaled inputs; below 1/α on half the seeds), so the AC-1b pin
  (calibrated sibling E ≥ 1/α on every seed) kills the no-calibration mutant. The probe's
  E ≈ 882 was uninterpretable, not merely inflated. Neighborhood semantics carry the
  (now-stronger) confound, exactly as designed.
- **The sub-floor gain reproduces under the honest null:** room Δ = 0.5 → tier 4/4 where the
  leaf layer is 0/4 (the headline); room Δ = 1 → 4/4 vs 2/4; panel Δ = 1 → 3/4 vs 0/4;
  optic Δ = 1 → 2/4 = leaf layer. **The escalation SURFACE at broad faults is large and its
  order is not localization** (published: room Δ = 0.5 fires a mean 20.3 aggregates with a
  spurious narrow resource top-ranked on every seed; room Δ = 1 fires 72.8 — most of the
  fleet): the tier's output is the drill recommendation SET, and the drill does the
  localizing.
- **Rooms' neighborhoods are THE FLEET on this fabric (76/76 — disclosed, corrected):** every
  tor leaf carries room weight exactly 0.5, so the material-overlap union of a room is
  everything. The draft's "{room-0, room-1}" sentence was false as a general description —
  a room here IS a fleet-scale domain, and a room escalation honestly recommends drilling
  everything. Hood sizes are published (optics 3, panels 12, rooms 76); whether the
  inclusive w ≥ 0.5 materiality on tor→room edges is the right rule is recorded as an open
  design point, not decided here.
- The ADR-0037 evaluate-on-evidence loop closes: probed (0049) → build conditions recorded →
  shipped under them → the honest null CONFIRMED the probe's table and strengthened its
  confound. Randomized e-BH (ADR-0063, queued) should be re-weighed against sub-floor gains
  existing at both broad and panel granularity.

**Gate loosening on the record:** `no-god-module` 10 → 11 — `src/spraypoint.ts` reached 11
importers, 10 of them leaf measurement tools consuming the fabric generator exactly as tests
do (the intent's (b) clause pattern; no src-side coupling grew). Behavioral-hub protection
(12+ blocks) unchanged.
