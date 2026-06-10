# ADR 0010 — Per-mode honest measurement (A+C+D floors + firing-mode attribution)

- **Status:** Accepted
- **Date:** 2026-06-09
- **Decision owner:** Tessera-RNG (post-v1, round 2)
- **Supersedes:** extends the AC-10 coverage matrix

---

## Context

Post-v1 added three detector families catching three distinct anomaly modes — **A** (mean shift),
**C** (cross-signal covariance, ADR-0007), **D** (spectral periodicity, ADR-0009). But the
honest-measurement surface (AC-10) still characterized only a single-signal **p99 mean shift**, with
covariance and spectral disclosed as "future work." Each new mode was *demonstrated* by one binding
test, never *measured*: we showed "Family D catches an oscillation," not "the smallest oscillation
amplitude it catches is X." DISCIPLINES §7 (honest measurement) requires the real number, in the
open — a detection claim should never be published without its floor and without naming the mode it
applies to.

## Decision

1. **Firing-mode attribution in the audit.** `AuditRecord` gains
   `firing_families: { A, C, D }` — the count of **selected** path-classes each family fired on,
   computed in the pipeline. A degradation's *mode* is thereby attributed to the family that caught
   it (mean → A, covariance → C, periodicity → D), so a detection number always carries which mode
   produced it. Deterministic and replay-clean (counts derive from the sorted verdict/selection).

2. **Per-mode floor table.** The coverage tool sweeps **each of the three modes independently** and
   reports a detection floor, an attribution floor, and the firing family per mode:
   - **mean shift** — Δ on p99 (Family A),
   - **covariance flip** — a baseline ρ = 0.9 on a signal pair flipped toward −ρ; magnitude = Δρ
     (Family C),
   - **oscillation** — period-7 amplitude over a 600-tick window (Family D).
   The markdown scope note now states all three modes are measured (none in a footnote).

3. **Pipeline baseline structure.** `PipelineParams.telemetry` gains `noiseCorr`/`arCoeffs`, applied
   to **both** the calibration and live windows, so the covariance-flip and AR(p) regimes are
   calibrated under the same baseline the live stream carries (the degradation stays live-only).

## Consequences

- **Honest floors, measured (not asserted).** The regenerated matrix reports, at
  kind = passive_shuffler, 2 seeds × 2 targets, q = 0.05:

  | mode | unit | detection floor | attribution floor | firing family |
  |---|---|---|---|---|
  | mean shift | Δ (p99 mean) | 1.0 | 2.0 | A (→ A+C at Δ ≥ 2) |
  | covariance flip | Δρ | 0.2 | 0.4 | C |
  | oscillation | amplitude (period 7) | 0.9 | 0.9 | D |

  The numbers are honest about the trade-offs: a *large* mean shift also trips Family C (so the
  attribution column reads `A+C`), the covariance detector is sensitive (Δρ = 0.2 off a 0.9 baseline;
  the sweep brackets the knee — 0.1 → 0%, 0.2 → 100%), and the spectral detector is the
  blunt-but-distinct one (amplitude ≈ 0.9 at this window count) — exactly the long-window character
  recorded in ADR-0009. Each mode's sweep brackets its detection knee with a below-floor sample
  (cold-eye review), so the floors are demonstrated knees, not just smallest-tested lower bounds.
- **Mode → family confirmed in the open.** Covariance flips fire C *only*, oscillations fire D
  *only*, mean shifts fire A (then A+C) — the firing-family column makes the mode↔detector mapping a
  reported fact, not a claim.
- **No regression.** The audit field is additive and replay-clean (108→109 tests; byte-identical
  replay holds because both runs produce the same `firing_families`). The coverage tool's heavy sweep
  is not run in the test suite — `renderMarkdown`/`modeFloorOf` are unit-tested on fixtures, and the
  full sweep is regenerated via `pnpm coverage`.
- **Honest limits.** Floors are at one kind / a small seed×target grid (the matrix says so); the
  oscillation floor is window-count-limited (ADR-0009); the covariance sweep flips one signal pair.
  Wider grids are cheap future runs, not new contract.
