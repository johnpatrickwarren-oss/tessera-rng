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

Reading: **dilution does not raise the floors** — every fault kind has a w = 1 view, and the
measured Spraypoint floors match the binary regime's corresponding kinds (optic 2/2 ≡ binary
optic; panel and room detect at 1 like the binary shuffler). The honest cost is in **attribution
lag**: a room fault at Δ = 1 is detected in 4/4 runs but attributed in **0/4** (the wrong-kind
boundary ADR-0019 recorded) — operators get a reliable alarm with an unreliable culprit below
Δ = 2, and the published table now says so instead of implying attribution comes free with
detection.

## Consequences

- The ADR-0014 deferral is closed; the coverage doc's scope note now distinguishes the binary
  table (generated quasi-random fabric) from the Spraypoint dilution table (two-view fabric).
- Runtime: `pnpm coverage` grows ~12 s (60 additional pipeline runs). The suite pays only the
  one-cell spot-check (~0.5 s).
- Anti-scope intact: synthetic fabric only (N2); floors are measurement, no new claims surface.
