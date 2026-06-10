# ADR 0020 — Spraypoint dilution floors: honest measurement under fractional incidence

- **Status:** Accepted
- **Date:** 2026-06-10
- **Decision owner:** Tessera-RNG (post-v1 round 4, item 2 — owner-authorized round; closes the
  measurement deferral recorded in ADR-0014)
- **Supersedes:** the floor table's "binary regime only" scope note (the binary floors stand;
  they are no longer the only published regime)

---

## Context

ADR-0014 introduced fractional incidence and explicitly deferred measuring floors *under
dilution*: "the current floor table stays honestly scoped as the easy (binary) regime until
then." ADR-0015 built the Spraypoint two-view fabric and published the per-view blind-spot map,
but only at a single magnitude (δ = 4). The honest-measurement surface therefore quantifies
detection/attribution floors on the binary fabric only — the regime the paper (ADR-0013) says is
*not* the production one. ADR-0019's scorer change makes this the right moment: floors published
now describe the shipped model.

## Decision

`tools/coverage.ts` gains a **Spraypoint dilution floor table**: for each fault kind on the
default 64×10×2 two-view fabric — `optic` (w=1 in `per_tor`, 1/64 in `per_panel_pair`),
`shuffle_panel` (w=1 in `per_panel_pair`, 1/10 in `per_tor`), `room` (w=1 / w=1/2) — sweep
δ ∈ {0.5, 1, 2, 3, 4} over 2 deterministic targets × the standard 2 seeds, and report the
**detection floor** (smallest δ with ≥ 90 % of runs selecting anything) and **attribution floor**
(smallest δ with ≥ 90 % rank-1 = the injected resource), exactly the `floorFor` semantics the
binary table uses. Published in `coverage-matrices/coverage-saturation.{json,md}` as a named
section (`spraypoint_floors`), beside — never replacing — the binary table.

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test ("Then") |
|---|---|
| The section exists in the committed artifact with all three kinds | `coverage.test.ts`: the committed JSON's `spraypoint_floors.floors` lists optic, shuffle_panel, room |
| Floor semantics shared with the binary table | floors derived via the same exported `floorFor` at the same `FLOOR_RATE` (existing unit tests); per kind, attribution floor ≥ detection floor when both exist (asserted on the committed artifact) |
| The committed numbers describe the shipped model | `coverage.test.ts` spot-check #2: the room δ=2 Spraypoint cell recomputed in-suite and compared field-for-field to the committed JSON (same honest-partial pattern as the ADR-0019 optic cell bind) |
| Dilution measured, not assumed | the measured floors land in the ADR (table below) after `pnpm coverage` regeneration |

## Measured result (observed output of the regenerated artifact)

| kind | detection floor (Δ) | attribution floor (Δ) | binary-table reference |
|---|---|---|---|
| optic | 2 | 2 | optic 2 / 2 |
| shuffle_panel | 1 | 2 | passive_shuffler 1 / 2 |
| room | 1 | 2 | power_zone 1 / 1 |

(A pre-measurement draft of this table predicted lower floors — optic 1/1, panel 0.5/0.5 — and
was wrong; replaced with the observed numbers per DISCIPLINES §0. The prediction underestimated
the per-leaf noise of a 60-tick window.)

Reading (corrected by the round-4 cold-eye — the first draft overclaimed): **detection floors
are not raised by dilution** — every fault kind has a w = 1 view and the detection floors match
the binary analogues. But the **room attribution floor RISES 1 → 2** against its own stated
binary reference (power_zone 1/1): a room fault at Δ = 1 is detected in 4/4 runs yet attributed
in **0/4** (the wrong-kind boundary ADR-0019 recorded; the true boundary sits between 1.5 and 2 —
Δ = 1.5 attributes 2/4, so "2" is grid-resolution-limited). Operators get a reliable alarm with
an unreliable culprit below Δ = 2 — published, not implied away. The kind mapping
(shuffle_panel↔passive_shuffler, room↔power_zone) crosses two different fabrics, so the
comparison is indicative, not a controlled dilution-only experiment; and with n = 4 per cell a
floor means "first unanimous Δ" (the same coarse estimator the binary table uses).

## Consequences

- The ADR-0014 deferral is closed; the coverage doc's scope note now distinguishes the binary
  table (generated quasi-random fabric) from the Spraypoint dilution table (two-view fabric).
- Runtime: `pnpm coverage` grows ~12 s (60 additional pipeline runs). The suite pays only the
  one-cell spot-check (~0.5 s).
- Anti-scope intact: synthetic fabric only (N2); floors are measurement, no new claims surface.

## Cold-eye fold-in (fresh-context review of d569469)

- **C1 — the headline reading was falsified by its own table**: "dilution does not raise the
  floors" while the room attribution floor rose 1 → 2 vs power_zone 1/1, with comparator-swapping
  prose hiding it. Corrected here, in STATE.md, and in the published narrative (which now names
  the cross-fabric kind mapping and the detection-only claim the data supports). The commit
  message of d569469 carries the same overclaim — it is immutable; this section is the record.
- **C2 — the published markdown section was unbound** (deleting the renderer block kept 159
  green): the renderMarkdown test now asserts the section heading, a floors row, and the
  Spraypoint clean-control line.
- **L5 — the dilution detection column borrowed its false-alarm baseline from another fabric**:
  a Spraypoint clean-fabric FDR control is now measured and published (`clean_spraypoint`,
  4 trials, observed 0 selections / 0 % FP).
- **L3 — the scope paragraph** now names the Spraypoint sections and states the n=4
  "first unanimous Δ" estimator + grid-resolution limits up front.
- **P7/P8/P9** — ADR-0014's deferral line annotated to point here; `SPRAYPOINT_FLOOR_TARGETS`
  is kind-keyed (compile-time target/kind mismatch); the md-test fixture's floors now follow
  from its own cells.
