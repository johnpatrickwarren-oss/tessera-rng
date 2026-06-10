# ADR 0018 — Epoch-aware detection + per-epoch localization (incidence churn, detector side)

- **Status:** Accepted
- **Date:** 2026-06-10
- **Decision owner:** Tessera-RNG (post-v1, round 3 — work order item 4, part 2 of 2)
- **Supersedes:** — (builds on ADR-0017's epoch'd source)

---

## Context

ADR-0017 gives the pipeline an epoch'd incidence sequence and telemetry whose degradation follows
the active epoch. The detector and localizer are still epoch-blind: a leaf's e-process runs over
the whole live window as if its incidence never changed, and tomography localizes every selected
leaf against the single static snapshot. Two failure modes follow: (a) after a reroute the leaf's
pre-reroute evidence is attributed to its **current** incidence — the localizer blames resources
the leaf no longer traverses *as if it still did*; (b) the e-process carries wealth across a
model change (the leaf's baseline may shift with its new path), silently.

## Decision

`runPipeline` gains `reroutes?: RerouteEvent[]`. Absent (or empty) ⇒ **byte-identical v1 audit**
— the anti-self-confirming guard. Present ⇒ `makeEpochs` builds the sequence, telemetry follows
it (ADR-0017), and:

1. **Per-leaf e-process reset at incidence-change boundaries.** A leaf's reset ticks are the
   epochs where `changedLeaves` includes it (a reroute that does not touch a leaf does NOT reset
   it — its e-process validly spans the boundary). The leaf's live residual series is split at its
   reset ticks and each segment is detected **with fresh wealth** (`detectPathClassSegmented`,
   `src/detect.ts`). This is the work order's deliberate, **recorded power loss**
   (instrumented-caveat): the audit lists every reset in `eprocess_resets
   [{path_class_id, at_tick, epoch_index}]` — never silent. Smarter wealth carryover is future
   work, deliberately not built.
2. **Valid evidence combine.** The segmented leaf's per-family e-value is the **mean** of its
   per-segment family e-values — averaging e-values is valid under arbitrary dependence, the same
   rule the family combine already uses. `fired` = any segment fired; `alpha_spent` sums over
   segments (α is spent per segment run); `alpha_allocated` stays the per-tick α. Per-segment
   verdicts are carried in the leaf verdict (`segments`) as displayed provenance.
3. **Evidence-epoch attribution + per-epoch tomography.** Each segmented leaf carries
   `evidence_epoch` = the epoch of its **max-e-value** segment (ties → earlier; attribution
   metadata, not part of the e-value). Selected leaves are grouped by evidence epoch and
   `localize()` runs **per group against that epoch's snapshot** — tomography runs against the
   incidence the firing evidence accrued in. Culprits gain `evidence_epoch`; the per-epoch culprit
   lists are concatenated (epoch order, score-ranked within an epoch); unexplained sets union.
   Cross-epoch culprit merging is deliberately NOT attempted (one more composite approximation
   would change claim strength); with the v1 single-reroute slice the groups are exact.
4. **Audit records the epoch sequence**: `epochs [{valid_from_tick, hash}]` — each epoch's full
   measurement design (views included) is replay-identified. Drains act on the **latest** epoch's
   snapshot (you drain the fabric as routed *now*, wherever the evidence accrued).

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test ("Then") |
|---|---|
| No reroutes ⇒ byte-identical v1 audit | `drain-epoch` test: `reroutes: []` audit JSON equals the no-param audit, byte-for-byte |
| (i) reroute with NO fault selects nothing | epoch'd clean run: `selected_path_class_ids` empty, no culprits (the critical false-fire guard) |
| (ii) fault + subsequent reroute still localizes from pre-reroute evidence | fault on R from tick 0, full reroute off R at T: leaf still selected, `evidence_epoch = 0`, rank-1 = R **against the epoch-0 snapshot**, and the post-reroute control (same fault, no reroute history needed) |
| Resets recorded, never silent | audit `eprocess_resets` lists exactly the remapped leaves at the boundary tick |
| Reset is REAL (wealth actually restarts) | the segmented leaf's post-boundary segment e-value is fresh (≈1 on clean ticks), not the carried pre-boundary wealth |
| Mean-combine + α accounting | segmented leaf: per-family e-value = mean over segments (cross-checked against independently computed segment runs); `alpha_spent` = segment sum |
| Unchanged leaves are NOT reset | a leaf untouched by the reroute has no `segments` and no reset entry |
| (iii) replay-clean across epochs | two identical epoch'd runs ⇒ byte-identical audit JSON (AC-9 extended) |
| Epoch sequence in the audit | `epochs` lists per-epoch `{valid_from_tick, hash}` matching `makeEpochs` |

## Consequences

- **Honest power loss, on the record.** A reset discards the affected leaf's accumulated wealth;
  a fault whose evidence straddles a reroute needs to re-accrue in the new epoch (the audit shows
  the reset; the e-BH guarantee is unaffected — each segment e-value is null-valid). That is the
  cost of model honesty after an incidence change, and it is *displayed*, not absorbed.
- **Attribution claim unchanged (N1):** per-epoch tomography narrows *when* the evidence accrued,
  not causality; every culprit still carries `correlational_not_causal`, the unexplained set is
  always reported.
- **Anti-scope intact:** epochs are synthetic-event-driven (N2 — no live `fetchSnapshot`); drains
  stay simulated (N4). The §4 evidence-epoch grouping is exact for the single-event slice and a
  stated ranking approximation beyond it.
