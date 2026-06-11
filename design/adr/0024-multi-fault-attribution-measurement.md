# ADR 0024 — Multi-fault attribution, measured: the both-in-top-2 floor

- **Status:** Accepted
- **Date:** 2026-06-10
- **Decision owner:** Tessera-RNG (post-v1 round 6, item 3 — owner-authorized; closes the
  measurement deferral recorded in ADR-0021)
- **Supersedes:** —

---

## Context

ADR-0021/0022 made simultaneous multi-fault localization a shipped capability, but deliberately
deferred its *measurement*: "a multi-fault row would need its own attribution definition" —
single-fault floors define attribution as rank-1 = the injected resource, which has no direct
two-fault analogue. Until measured, the capability has binding example tests (one binary pair,
one cross-kind pair, one δ each) but no published floor — the same gap the dilution floors
closed for fractional incidence in ADR-0020.

## Decision

The coverage matrix gains a **multi-fault section** on the Spraypoint two-view fabric:

- **Attribution definition (recorded):** for a simultaneous fault pair (A, B) at equal Δ, a run
  is *attributed* when **both A and B appear in the top-2 culprits** (`culprits[0..1]` of the
  audit). Strict by construction: a third spurious culprit ranking above either injected fault
  fails the run. Detection = any leaf selected (unchanged semantics).
- **Pairs measured:** `cross_kind` = (optic-3, panel-7) — the ADR-0022 discriminating shape —
  and `same_kind` = (optic-3, optic-40), both faults from tick 0, the standard 2 seeds, sweep
  Δ ∈ {0.5, 1, 2, 3, 4} (n = 2 per cell per pair; the same coarse "first unanimous Δ" floor
  estimator as every other table, stated in the artifact).
- Published as `multi_fault {deltas, cells, floors}` in
  `coverage-matrices/coverage-saturation.{json,md}` with its own markdown section, beside the
  single-fault tables — never replacing them.

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test ("Then") |
|---|---|
| The section exists in the committed artifact with both pair kinds | `coverage.test.ts`: the committed JSON's `multi_fault.floors` lists cross_kind and same_kind |
| Attribution = both-in-top-2, floors via the shared `floorFor` semantics | unit-level: `multiFaultCell` exported and exercised; floors satisfy attribution ≥ detection when both exist (asserted on the committed artifact) |
| The committed numbers describe the shipped model | spot-check #3: one cell recomputed in-suite and compared field-for-field to the committed JSON (the same honest-partial freshness pattern as ADR-0019/0020) |
| The md section is EMITTED, not just typed | `renderMarkdown` asserts the section heading + a floors row (the ADR-0020 C2 lesson) |
| Measured, not assumed | the observed floors land in the table below after `pnpm coverage` |

## Measured result (observed output of the regenerated artifact)

| pair | detection floor (Δ) | attribution floor (Δ, both-in-top-2) | constituents' single-fault floors (ADR-0020) |
|---|---|---|---|
| cross_kind (optic+panel) | 1 | 2 | optic 2/2, panel 1/2 |
| same_kind (optic+optic) | 2 | 2 | optic 2/2 |

(A pre-measurement draft predicted cross_kind detection at 0.5 and same_kind at 1 — wrong both
times, replaced with observed numbers per DISCIPLINES §0: at Δ = 0.5 nothing selects on this
fabric, and at Δ = 1 the same-kind pair detects in only 1/2 runs.)

Reading: **every measured floor equals its constituents' single-fault floors** — detection
inherits the stronger fault's floor (the panel detects at Δ = 1; two optics need Δ = 2, exactly
the single-optic floor), and joint attribution lands at Δ = 2 for both pairs because the optic
side of each pair attributes at 2 on its own (ADR-0020). At Δ = 1 the cross-kind pair detects
4/4 leaves but both-ranks in only 1/2 runs — the optic side is below its own attribution floor.
**No multi-fault-specific penalty beyond the constituents' own floors was observed on this
grid** — the (favorable) finding, with the caveat that n = 2 per cell makes each floor a
"first unanimous Δ" estimate on grid resolution.

## Consequences

- The ADR-0021 measurement deferral is closed; every shipped localization capability now has a
  published floor (single-fault binary, single-fault diluted, multi-fault diluted).
- Anti-scope intact: synthetic, independent additive faults (the ADR-0021 interaction caveat
  stands); two-fault pairs only — k ≥ 3 simultaneous faults remain example-tested, not
  floor-measured (recorded narrowing).
- Runtime: `pnpm coverage` grows ~10 s; the suite pays one ~1 s spot-check.
