# ADR 0025 — Paper-scale proof: the pipeline measured at 960 ToRs

- **Status:** Accepted
- **Date:** 2026-06-10
- **Decision owner:** Tessera-RNG (post-v1 round 7, item 1 — owner-authorized)
- **Supersedes:** —

---

## Context

Everything measured so far runs at the 64×10×2 demo scale (109 leaves). The paper's production
fabric (ADR-0013) is 960 ToRs with a 32-panel shuffle across 4 rooms — under the ADR-0015 view
model that is 960 + C(32,2) = **1,456 leaves** and ~514 K weighted incidence edges, inside
AC-1's [100, 10000] bound but **13× beyond anything ever executed**. Runtime, memory, FDR
behavior, and localization correctness at that scale were unmeasured assumptions; the README
says "10³–10⁴ path-classes" and nothing had ever run past 4×10².

## Decision

1. **A paper-scale fabric constant** — `PAPER_SPRAYPOINT = { nTors: 960, nPanels: 32, nRooms: 4 }`
   exported beside `DEFAULT_SPRAYPOINT` (`src/spraypoint.ts`), so the scale is a named,
   testable artifact rather than a probe-only configuration.
2. **A suite-level scale test** (correctness, not wall-clock — runtime assertions flake):
   at paper scale, a clean run selects nothing (FDR holds at 1,456 dependent leaves), an optic
   fault detects + localizes rank-1, and a panel fault does the same. Replay-clean.
3. **A published scale row** — the coverage matrix gains `scale_proof`: fabric dimensions,
   clean FDR control at scale, and detect/attribute outcomes per fault kind at a representative
   Δ — all DETERMINISTIC, so the artifact stays replay-stable (wall-clock/RSS are machine
   numbers and live in this ADR's measured table, not the regenerating artifact). The README's
   10³–10⁴ claim then points at a measured row instead of an extrapolation.

## Measured (confirmed by the committed artifact + the probe)

| quantity | observed |
|---|---|
| fabric | 1,456 leaves · 513,552 edges · 996 resources (24 ms to generate) |
| full pipeline run (60 ticks) | ~0.7 s, ~550 MB RSS (one machine — context, not contract) |
| clean fabric | selects 0 (FDR holds at 1,456 dependent leaves) |
| optic-3 / panel-2 / room-1 at Δ=4 | each detects, each localizes rank-1 (artifact `scale_proof`) |

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test ("Then") |
|---|---|
| Paper-scale fabric is a named constant inside AC-1 | `spraypoint.test.ts`: leaf count 1,456 ∈ [100, 10000]; views sized 960 / 496 |
| Clean FDR at scale | scale test: zero selections on the clean paper-scale fabric |
| Detection + localization at scale | scale test: optic and panel faults each detect and localize rank-1 |
| Replay-clean at scale (AC-9) | scale test: byte-identical audits |
| Published scale row is fresh | spot-check #4: the optic outcome recomputed in-suite vs the committed JSON; md emission asserted (the ADR-0020 C2 lesson) |

## Consequences

- AC-1's upper range stops being aspirational: the README scale claim is backed by a measured
  row. Suite cost ~4 s (paper-scale runs in the scale test + spot-check #4) — accepted; the
  mutation oracle inherits it.
- Honest limitation: wall-clock and RSS are one machine's numbers, published as context, not a
  performance contract. Floors at paper scale are NOT swept (each cell would cost ~0.7 s × n —
  a full sweep is future work, recorded; the demo-scale floors remain the published floors).
