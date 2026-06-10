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
   metadata, not part of the e-value). A segment is *labeled* with the epoch in force at its
   start: the leaf's OWN incidence is constant for the whole segment, but other leaves' incidence
   may change mid-segment at epochs that didn't touch this leaf — the localization snapshot is
   exact for the leaf's edges, approximate for cross-leaf context beyond the single-event slice.
   An **unsegmented** leaf's evidence epoch is *unknown/spanning* — it is **never fabricated**
   (the verdict field stays absent); by stated convention it joins the **latest** epoch's
   localization group, which is exact for its own (epoch-invariant) edges and merges with the
   most-recent evidence instead of fragmenting the joint localization (cold-eye C2: the original
   `?? 0` default split corroborating leaves into separate groups, turning each group's firing
   leaves into the other group's quiet falsifiers and duplicating culprits). Selected leaves are
   grouped accordingly and `localize()` runs **per group against that epoch's snapshot**.
   Culprits carry `localized_against_epoch` — named for what it factually is (the snapshot the
   group was localized against), NOT a claim about when evidence accrued. Per-epoch culprit lists
   are concatenated (epoch order, score-ranked within an epoch); unexplained sets union. The same
   physical resource may appear once per epoch group (a per-epoch claim, interpretable via the
   epoch field); cross-epoch culprit merging is deliberately NOT attempted.
4. **Audit records the epoch sequence**: `epochs [{valid_from_tick, hash}]` — each epoch's full
   measurement design (views included) is replay-identified. Drains act on the **latest** epoch's
   snapshot (you drain the fabric as routed *now*, wherever the evidence accrued), and the drain
   targets are the **strongest-scoring culprits across all groups, one drain per resource** —
   never epoch-earliest-first, never the same resource twice (cold-eye L1/C2b). Reroute events
   are validated at the pipeline: `at_tick` must be an **integer strictly inside (0, ticks)** —
   a fractional boundary would let telemetry (`tick ≥ at_tick`) and detection (`Array.slice`)
   disagree by one tick, and an event at/after the window end was never active during measurement
   (cold-eye L2).

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test ("Then") |
|---|---|
| No reroutes ⇒ byte-identical v1 audit | `epoch.test.ts`: `reroutes: []` audit JSON equals the no-param audit, byte-for-byte; no epoch fields emitted. CAVEAT (cold-eye L3): this binds the two **code paths** to each other, not to frozen v1 bytes — a golden pinned to a git ref is barred by the `no-time-bomb-tests` invariant; v1 behavior is pinned by the pre-existing replay + scenario suites, which run the no-reroute path |
| (i) reroute with NO fault selects nothing | `epoch.test.ts` (i): epoch'd clean run — `selected_path_class_ids` empty, no culprits (the critical false-fire guard), resets still recorded |
| (ii) fault + subsequent reroute still localizes from pre-reroute evidence | `epoch.test.ts` (ii): optic-3 fault from tick 0, full reroute off it at t=40 — tor-3 selected, segment 0 fired / segment 1 quiet, `evidence_epoch = 0`, rank-1 = optic-3 with `localized_against_epoch: 0` |
| (ii-b) evidence accruing AFTER the reroute (cold-eye C1) | `epoch.test.ts` (ii-b): reroute at t=20 lands tor-3 on optic-39; fault on optic-39 from t=25 — `evidence_epoch = 1` (argmax binds), ONE optic-39 culprit with both leaves corroborating (C2 binds), no optic-3 culprit (per-epoch snapshot binds), drained member set includes tor-3 (latest-epoch drain binds). Each assertion verified to KILL its hand-made constant mutant (always-epoch-0 localize, `evidence_epoch := 0`, drain-on-initial-snapshot, unsegmented `:= 0`) |
| Reroute event validation | `epoch.test.ts`: `at_tick` ∈ {39.5, 60, 100, 0} all rejected at the pipeline |
| Resets recorded, never silent | `epoch.test.ts` (ii): `eprocess_resets` contains the remapped leaf at exactly the boundary tick |
| Reset is REAL (wealth actually restarts) | `detect.test.ts`: the post-boundary segment's e-value is fresh (< carried-wealth run by 100×), does not fire on clean ticks |
| Mean-combine + α accounting | `detect.test.ts`: per-family e-value = mean over segments, cross-checked against independently sliced `detectPathClass` runs (the naive two-pass reference); `alpha_spent` = segment sum; `evidence_epoch` = argmax segment |
| Unchanged leaves are NOT reset | `epoch.test.ts` (ii): tor-5 has no `segments` and no reset entry |
| (iii) replay-clean across epochs | `epoch.test.ts` (iii): two identical epoch'd runs ⇒ byte-identical audit JSON (AC-9 extended) |
| Epoch sequence in the audit | `epoch.test.ts` (ii): audit `epochs` deep-equals the `makeEpochs` `{valid_from_tick, hash}` sequence |

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
- **Mutation record:** `epoch.ts` 100 % after a survivor-killing round on the `segmentPlan` window
  guard (boundaries at t = 0 / t = ticks / beyond reset nothing); generated `pipeline.ts` mutants
  all killed. The one surviving mutant in `detect.ts` is the **pre-existing benign Family-A fire
  boundary** (`e ≥ 1/α` vs `>` — the same accepted-on-the-record mutant class as ADR-0009's), not
  ADR-0018 code. HONESTY NOTE (cold-eye C1): the generated operator set does **not** produce
  index-constant mutants, and the original commit's "mutants all killed" overstated coverage —
  three hand-made constants (always-epoch-0 localize, `evidence_epoch := 0`, drain-on-initial
  snapshot) survived the original suite. The (ii-b) fixture now kills all three (verified by
  re-applying each mutant by hand), plus the unsegmented-`:= 0` C2 mutant.
- **Cold-eye fold-in (fresh-context review of 4b6821c + ca0ed5e):** C1 (headline behaviors
  unbound) → the (ii-b) fixture; C2 (fabricated epoch-0 attribution fragmenting culprits) → the
  unknown-evidence convention + `localized_against_epoch` rename + one-drain-per-resource; L1 →
  strongest-first drain targets; L2 → `at_tick` validation; L3/L4 → claims narrowed in this ADR;
  P1 → different-seed remap test; P2 → `SegmentSpec` shared type; P3 → empty-segs guard; P4 →
  `epochAffected` maps over snapshots; P5 → the segmented-`fired` K× flag caveat documented at
  the type.
