# ADR 0057 — Real-telemetry replay: the first measured ς̂ on a real concurrent population

- **Status:** ACCEPTED (measured; consequences below)
- **Date:** 2026-07-28
- **Decision owner:** Tessera-RNG (operator-ratified direction: "proceed with your
  recommendations" — this is recommendation 1)
- **Relates to:** VALIDATION.md Tier 3 (deliberately empty until now — this opens a
  **Tier 2.5**: real telemetry, non-RNG domain), ADR-0050 (the synthetic boundary this gets a
  first real number against), ADR-0051/0052/0053 (the estimator/gate/shrinkage/monitor that
  run UNCHANGED here), the GPU sibling's mini real-telemetry program (the data source).
- **Files:** `tools/real-replay.ts` → `coverage-matrices/real-replay.{json,md}`,
  `test/fixtures/mini-cores-*.json` (downsampled committed fixtures),
  `test/real-replay.test.ts`.

---

## Problem

Every number in ADR-0050–0054 — the boundary, the thresholds, the drift cliff — is
synthetic. The single highest-leverage question for the whole program is: **what is ς on a
real concurrent population?** If real dispersion sits inside the synthetic boundary, shared
calibration might survive real fabrics; if it sits far past it (the ADR-0015 expectation),
the gate/remedy/monitor stack is not optional but mandatory, and the program's premise is
validated on real data. No RNG fabric exists to ask; a real concurrent population does.

## The data (Tier-2.5 honesty: real telemetry, NOT network telemetry)

The GPU sibling's mac-mini collector: 1 Hz powermetrics, of which the per-core counters form
a genuine concurrent population — **14 cores × 2 shared signals** (`c*_mhz`, `c*_res`),
verified 1 Hz (epoch-second `t`, delta 1). Known real structure: ~half the cores are PARKED
at idle (near-degenerate residency — real subpopulation heterogeneity), E/P clusters differ,
and the fleet has a **natural drift experiment**: a 14-day outage + reboot
(07-13 → 07-27), giving calibration/live window pairs that genuinely span a regime change.
Windows: cal + adjacent hour on 07-08; same hour on 07-11 (+3 days); post-reboot 07-28
(across the outage). Full-rate day files stay OFF-repo (the mini + a local scratch copy);
the repo commits 1-in-10 downsampled, field-trimmed fixtures for reproducible tests.

**What this is NOT:** not the five-signal network contract (still unfalsified), not a
network fabric, not an FDR claim of any kind. It is the estimator/gate/monitor machinery
meeting real residuals, and the first real dispersion number.

## Decision

### 1. The adapter (`tools/real-replay.ts`) — production objects, adapter standardization

RNG's calibration substrate is hardwired to the 5-signal network contract (`SIGNALS`), so
the adapter standardizes with the SAME engine primitives the substrate consumes — per-signal
global robust center/scale (median/MAD over the pooled calibration samples: the
shared-calibration regime whose dispersion is exactly what we measure) + pooled `fitArP`
(cap 6) / `prewhitenAr` per signal — and everything downstream runs UNCHANGED:
`estimateDispersion`, `dispersionGate`, `driftMonitor`, and the ADR-0052 shrinkage formula
(λ = ς̂²/raw² on the pooled per-leaf log-scales, adapter-applied, labeled as such). The
recorded narrowing: no byte-anchor to `runPipeline` is possible across the domain gap — the
claim is "the ADR-0051/0053 objects verbatim on real residuals," not "the RNG pipeline on
real telemetry."

### 2. The measurements

Per window-pair (cal → live), each at T = 3600 (sampling floor ≈ 0.0083 at p = 2 — the iid
approximation; residual 1 Hz autocorrelation surviving the AR(≤6) whitening may understate
it, immaterial at the measured magnitudes):

- **Real ς̂** (robust + tail pair) on the calibration window, full 14-core population AND an
  active subset (liveness pre-filter: parked cores excluded) — real populations contain
  degenerate members, and whether ς̂ needs a liveness pre-filter is itself a finding.
- **Gate verdict** on the calibration window (shared regime).
- **Monitor verdicts** on live windows: adjacent hour, +3 days, across-outage — does the
  monitor read a real reboot as drift?
- **perLeafScale arm:** shrinkage fitted on the cal window; out-of-sample residual
  dispersion on each live window — does the ADR-0052 remedy absorb REAL static
  heterogeneity, and does the real drift experiment re-break it?

## Acceptance criteria

- **AC-1 (real number, honestly framed):** the artifact publishes real ς̂ (both statistics,
  both populations) with the floor, T, n, and the Tier-2.5 caveat; whatever it is —
  including "so large the estimator saturates" — is published as measured.
- **AC-2 (production objects verbatim):** the tool imports `estimateDispersion` /
  `dispersionGate` / `driftMonitor` from `src/` — no reimplementation of the objects under
  test; only standardization is adapter-level (from engine primitives), stated in the
  artifact.
- **AC-3 (reproducibility):** committed downsampled fixtures; tests recompute the fixture
  cells exactly; `.md` ≡ renderMarkdown(`.json`). Full-rate results in the artifact carry
  the data location (off-repo) and are labeled non-CI-reproducible.
- **AC-4 (the drift experiment):** the across-outage window's monitor verdict is published
  beside the adjacent-hour one — the natural experiment's result, whatever it is.

## Anti-scope

- **No RNG-domain claims** (topology, tomography, drain — nothing localization-related
  runs; there is no incidence model here).
- **No threshold re-derivation** — real thresholds need real *network* fabrics; this
  measures, it does not re-tune.
- **No collector changes, nothing written to the mini** (read-only fetch).
- **No raw full-rate data in the repo.** The committed fixtures ARE a deliberate disclosure
  (recorded): 2 × ~60 KB of downsampled per-core frequency/residency from a personal
  machine, in a public repo — low sensitivity (an activity pattern, no content), accepted
  for CI reproducibility.

## Prescription → AC coverage

| Prescription | Bound by |
|---|---|
| Real ς̂ published, both stats/populations, floor visible | AC-1 |
| Production objects imported, not reimplemented | AC-2 |
| Fixtures + exact recompute + md≡json | AC-3 |
| Across-outage natural experiment published | AC-4 |

## Consequences — first contact with reality (AC-1..4)

Artifact: `coverage-matrices/real-replay.{json,md}`.

- **Real ς̂ is 9–19× past the synthetic wall.** Full population: robust ς̂ **1.127**
  (tail 0.687); active subset (parked cores excluded, 9/14): **0.381** (tail 0.454) — against
  the ADR-0050 boundary of 0.06–0.12 (measured at 109 leaves / T = 60 / p = 5 synthetic; the
  boundary's location at n = 14 / p = 2 / 1 Hz is itself unmeasured — the multiplier is a
  scale comparison, not a transfer claim). The gate WITHHOLDS on both populations. This is
  the program's premise validated on real data: shared calibration on a real concurrent
  population is nowhere near FDR-valid, and a deployment without the gate would have been
  confidently wrong from the first window.
- **The liveness pre-filter is necessary and nowhere near sufficient.** The parked
  subpopulation is real (5/14 cores) and excluding it cuts ς̂ by ~3× — but the active fleet
  alone still sits 3–6× past the boundary. Real heterogeneity is not a tail phenomenon here;
  it is the population.
- **Every real live window reads `drifted` — including the adjacent hour.** Shared-substrate
  adjacent-hour ς̂ 1.252: real telemetry is non-stationary at 1-hour granularity under a
  pooled substrate. **Consistent with a diurnal fingerprint (single windows — n = 1 per
  cell, hedged accordingly):** in the SHARED arms and perLeafScale/full, the +3-days
  SAME-hour window drifts less than the adjacent DIFFERENT-hour one (0.912 < 1.252 full,
  0.434 < 0.602 active, 0.229 < 0.327 pls/full) — hour-of-day structure the pooled adapter
  cannot absorb, what per-cell (HoD) calibration exists for. **The perLeafScale/active arm
  REVERSES the ordering** (binding stat 0.196 vs 0.151) — disclosed, not smoothed; with the
  static structure absorbed, the residual ordering at n = 1 is not resolvable. An HoD-aware
  real adapter (and repeated windows) is the recorded next step for replays.
- **The natural experiment behaves (AC-4):** the across-outage window is the LARGEST drift
  in every arm **on the monitor's binding statistic max(ς̂, tail ς̂)** (shared full: 1.468
  robust; perLeafScale/active holds via the tail, 0.440) — the monitor ranks a real
  14-day-outage reboot as the biggest regime change it saw. Bound by test across all four
  arms on the binding statistic.
- **The ADR-0052 shrinkage absorbs a large share of real static structure** (adjacent-hour
  active: binding statistic 0.602 → 0.151 — still 2.2× the 0.07 threshold; the robust
  component alone drops to 0.099) yet **no window reaches `ok`**: real residual
  non-stationarity exceeds every synthetic regime tested. On real fabrics the remedy stack
  (per-entity calibration + HoD cells + liveness pre-filter + continuous recalibration) is
  MANDATORY, not optional.
- **Reproducibility:** the committed downsampled fixture corroborates the full-rate headline
  (ς̂ 1.144 vs 1.127) and recomputes exactly in CI.

Reading for the program: on their first contact with reality, the gate and monitor did
precisely their jobs — withheld the claim and ranked the drift — and the synthetic thresholds
survived in the only sense that matters (the verdicts they produce on real data are the right
ones, by a wide margin). What real data moved is the roadmap: per-entity + HoD calibration
graduates from "remedy" to "precondition."
