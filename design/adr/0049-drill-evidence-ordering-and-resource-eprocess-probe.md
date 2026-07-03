# ADR 0049 — Evidence-ordered drill truncation; resource-directed e-processes probed, NOT shipped

- **Status:** ACCEPTED
- **Date:** 2026-07-02
- **Decision owner:** Tessera-RNG
- **Relates to:** ADR-0026 (drill-down + its id-order truncation narrowing), ADR-0046 (the
  magnitude currency the ordering consumes), ADR-0037 (the evaluate-then-decline pattern),
  `src/drilldown.ts`, `test/drilldown.test.ts`.

---

## 1. Drill truncation is now evidence-ordered (closes the ADR-0026 narrowing)

The drill's examined set was "the deterministic id-order head of the exposed set (no per-pair
prior exists before examining — recorded)." A per-pair prior DOES exist since the fleet layer
carries per-leaf magnitudes (ADR-0046): a pair's endpoints' per-ToR-view evidence. `drillDown`
now accepts `leafEvidence` (leaf id → magnitude, e.g. the audit's t-statistics) and orders the
truncation sample by endpoint-evidence sum (desc, id tiebreak) — the progressive-tomography move
(examine where the posterior mass is; Bartolini et al., INFOCOM 2021). Absent evidence ⇒ the
historic id-order head, byte-identical. The report carries `truncation_order: 'evidence' | 'id'`
(declared in the N1 shape bind).

Bound: a panel drill capped at 100 of 2016 pairs under a two-optic fault at high ToR indices —
id-order never examines `pair-40-63` (the control pins the old narrowing); evidence-order
examines and selects it.

## 2. Resource-directed (matched-filter) e-processes — PROBED, recorded, not shipped

The literature review proposed per-resource aggregate e-processes (√m SNR gain; compound-e-value
framing) for sub-floor broad-fault detection. Probed on the Spraypoint fabric (4 seeds/cell,
w-weighted per-resource residual aggregates, engine betting e-process, informal unit-variance
null):

| target | Δ | leaf layer detects | resource e-process | sibling aggregate (max E) |
|---|---|---|---|---|
| room-0 | 0.5 | 0/4 | **4/4** | **882** (room-1!) |
| room-0 | 1 | 3/4 | 4/4 | 6.9e7 (room-1) |
| panel-7 | 1 | 0/4 | 3/4 | 1.06 |
| optic-3 | 1 | 0/4 | 3/4 | 0.37 |

The gain is real (room detection at HALF the current floor) — and so is the hazard: overlapping
domains share leaves (split pair-leaves belong to both rooms at w=½), so a room-0 fault fires the
room-1 aggregate at E ≈ 882. Two structural problems before this can ship: (a) the aggregate
hypothesis is "this weighted combination shifted," NOT "this resource is at fault" — resource-
level selection would be misleading for overlapping domains; (b) the unit-variance null is wrong
under cross-leaf dependence — the aggregate null must be CALIBRATED from the clean window like
every other null in this system. The honest shape is an **early-warning escalation tier**
(coarse "this overlapping neighborhood shifted" → triggers the evidence-ordered drill of §1),
not a resource-level FDR surface.

**Decision: not shipped this round** (the ADR-0037 evaluate-on-evidence pattern). Recorded
build conditions: calibrated aggregate nulls; escalation-tier semantics with the ambiguity
union (ADR-0047 machinery) as the claim granularity; measured floors before/after. Detection
floors are not a recorded defect today; this is an enhancement with a known confound, not a fix.
