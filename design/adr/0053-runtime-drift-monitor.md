# ADR 0053 — Runtime drift monitor: the live-window dispersion estimate, and a detector for the ADR-0052 cliff

- **Status:** ACCEPTED (detection envelope measured; one threshold-guidance amendment below)
- **Date:** 2026-07-28
- **Decision owner:** Tessera-RNG
- **Relates to:** ADR-0052 (the cliff this detects: stale per-leaf corrections → 25.25 false
  selections/run at full drift, recorded as having NO detector; the fresh-calibration-cadence
  posture this monitor supersedes as the only guard), ADR-0051 (the shared estimator + the
  pair-binding lesson; the gate covers the CALIBRATION window — this covers the LIVE window),
  ADR-0050 (the boundary that makes live dispersion the right thing to watch), ADR-0027
  (incremental session; running-sums parity).
- **Files:** `src/drift-monitor.ts`, `src/dispersion-gate.ts` (shared estimator, sums-path
  helper), `src/pipeline.ts` / `src/session.ts` (opt-in threading),
  `test/drift-monitor.test.ts`, `tools/drift-monitor.ts` →
  `coverage-matrices/drift-monitor.{json,md}`.

---

## Problem

ADR-0052 measured that per-leaf scale corrections turn cal→live drift into the WORST failure
mode on the books (25.25 false selections/run — steeper than the uncorrected disease) and
recorded, after cold-eye correction, that **nothing shipped can detect it**: the ADR-0051 gate
reads the calibration window, and re-calibrating refits the corrections, zeroing the very
signal. Stale-correction dispersion lives in exactly one place — the LIVE residuals — and
nothing estimates it there. The same blind spot exists without `perLeafScale`: dispersion that
ARISES after calibration (new-in-live heterogeneity) passes the calibration-window gate and
false-selects exactly as ADR-0050 measured.

## Decision

### 1. The monitor: the ADR-0051 estimator pointed at the live window

`estimateDispersion` is input-agnostic — the monitor applies it to the LIVE residual matrix
the pipeline already computes (batch) or to per-leaf running sums (session; §3). Same pooled
per-leaf log-scale ℓ_i, same robust + tail pair, same sampling floor `1/(2(t−1)p)` — now with
t = the live tick count, which is SMALL at early audits, making floor honesty load-bearing
(§2). Mean shifts do NOT inflate ℓ (per-leaf sd is computed about the leaf's own mean), so a
mean-mode fault does not masquerade as drift; variance-mode faults DO inflate the affected
leaves' ℓ — handled by pattern attribution (§2), not ignored.

### 2. Three-state verdict + pattern attribution (`driftMonitor`)

```
status = 'indeterminate'  if sampling_floor_sd ≥ threshold      (the window CANNOT resolve
                                                                 a boundary-scale ς — an early
                                                                 audit must not read as 'ok')
         'drifted'        else if max(ς̂, tail ς̂) > threshold
         'ok'             otherwise

Recorded narrowing (cold-eye finding 3): `indeterminate` takes precedence even when the
evidence would clear the floor decisively (e.g. full drift at an unresolvable window reads
`indeterminate`, not `drifted`) — claim-safe (both states withhold), but the wait-vs-
recalibrate operator distinction is unavailable below the resolvable window; a decisive-
evidence escalation rule is possible future work, not built (it adds a second threshold).
pattern  (when drifted): 'fleet' if the ROBUST ς̂ exceeds the threshold (fleet-wide scale
         mismatch — the recalibrate-now signal; stale corrections and shared-calibration
         drift both land here), else 'tail' (a dispersed subpopulation: localized
         variance-mode faults and subpopulation drift are INDISTINGUISHABLE here — recorded;
         the claim is withheld either way, only the operator action differs).
```

Claim semantics compose with ADR-0051: the FDR-controlled reading of a selection set is
licensed only when the gate passes AND the monitor reads `ok` (both opted in). `indeterminate`
withholds the claim — a window too short to verify the precondition cannot license it — and is
visibly different from `drifted` so the operator knows whether to wait or to recalibrate.
Selections are NEVER suppressed (claim, not alarm — the ADR-0051 rule).

**Threshold guidance amendment (measured during build):** the monitor's clean baseline is
REGIME-DEPENDENT. Under shared calibration the live window's clean-fabric ς̂ matches the
gate's (≈ 0.007–0.009 at T = 60) and the default ς\* = 0.05 is right. Under `perLeafScale`,
FRESH corrections carry out-of-sample correction noise in the live window (≈ 0.03–0.06 at
this operating point — the same quantity ADR-0052's AC-3 out-of-sample bound covers), putting
the default threshold on the fresh-noise edge. Measured separation on the 8-seed envelope
set: fresh ≤ 0.0594, half-drift ≥ 0.081 (already 3.13 false selections/run), full drift
≈ 0.26 — the **recommended perLeafScale operating threshold is 0.07**
(`PER_LEAF_SCALE_MONITOR_THRESHOLD`, tools/drift-monitor.ts), with ≈ 0.011 of margin on each
side. **CORRECTED (cold-eye finding 1):** the first published bracket ("fresh ≤ 0.055") was
the max of the 4-seed AC-2 test subset, not the 8-seed envelope set (whose max is 0.0594) —
the recommendation survives, the bracket and margin were wrong and are fixed here and in the
regenerated artifact. Regime thresholds are data, not defaults: the envelope publishes both
regimes so the choice is informed.

### 3. Wiring (opt-in; byte-identity; session parity by running sums)

`PipelineParams.driftMonitor?: boolean | { threshold?: number }` (default threshold
`DEFAULT_SIGMA_THRESHOLD`): batch computes from the live residual map post common-mode strip
(the residuals detection consumed); the audit gains `drift_monitor` (absent ⇒ byte-identical).
Non-epoch'd runs only — epoch resets fragment per-leaf live windows; combining with `reroutes`
throws (recorded narrowing). `SessionParams.driftMonitor` likewise: `LeafState` accumulates
per-signal running Σx² beside the existing Σx (same per-tick order as the batch column sums),
and `audit()` computes the estimate closed-form from the sums — bit-for-bit equal to the batch
path on the same inputs (AC-3). At t < 3 the estimate is degenerate ⇒ `indeterminate`.

### 4. The detection envelope (`tools/drift-monitor.ts`)

The published proof that the ADR-0052 cliff now has its detector — same seeds/fabric as the
ADR-0052 artifact so the columns line up:

- **Cliff detection (perLeafScale ON, driftMix grid):** monitor status per cell beside the
  ADR-0052 false-selection counts. The bar, AS AMENDED against measurement (recorded
  narrowing — the draft said "`drifted` wherever false selections are non-zero"): `drifted`
  wherever false selections are MATERIAL (≥ 1/run); the mild driftMix 0.25 cell (0.25 false
  selections/run) detects partially (13%) and is published as such, not smoothed into either
  bar. `ok` at driftMix 0.
- **Shared-calibration static ς (no perLeafScale):** the monitor sees in the live window what
  the gate sees in the calibration window (consistency), and `ok` on clean fabrics.
- **Pattern attribution:** a localized variance-mode fault (no drift) reads `tail`, not
  `fleet` — the monitor does not cry "recalibrate" at a real fault; a full-drift cell reads
  `fleet`.
- **Resolvability:** the short-window row (t where floor ≥ threshold) reads `indeterminate`,
  never `ok`.

## Acceptance criteria

- **AC-1 (byte-identity):** opt-out audits byte-identical; opt-in adds ONLY `drift_monitor`;
  `reroutes` + monitor throws.
- **AC-2 (detection, the load-bearing one):** composed perLeafScale runs — driftMix 0 reads
  `ok`; driftMix 1 reads `drifted`/`fleet` on every seed. A constant-`ok` mutant dies here.
- **AC-3 (session parity):** session `audit()` at the final tick stamps a `drift_monitor`
  bit-for-bit equal to the batch pipeline's on the same inputs (running-sums path vs matrix
  path).
- **AC-4 (pattern honesty):** a localized variance-mode fault with no drift reads `tail`
  (robust ς̂ under threshold), and the tail/fault ambiguity is recorded, not hidden.
- **AC-5 (resolvability):** with t chosen so floor ≥ threshold, status is `indeterminate`
  regardless of the data — an `ok`-by-default mutant dies here.
- **AC-6 (envelope honesty + freshness):** the published table recomputes exactly (spot
  cells), `.md` ≡ renderMarkdown(`.json`), every cell carries n and the floor.

## Anti-scope

- **No automatic recalibration / no action wiring.** The monitor reports; cadence decisions
  are operator scope.
- **No epoch'd-run support** (throws; recorded narrowing — per-leaf windows fragment).
- **No per-leaf drill-down** (which leaves moved) — the pattern field is fleet-vs-tail only;
  leaf attribution is future scope.
- **No real-fabric thresholds** (Tier-3 honesty, as ADR-0051).
- **No change to gate or perLeafScale behavior** — the monitor composes, it does not modify.

**Gate loosening on the record:** `no-god-module` 25 → 27 (`tools/drift-monitor.ts` +
`tools/heterogeneity-power.ts` type-only domain imports — the admitted zero-behavior-contract
case, 7th/8th instances; the standing operator flag on a structural exemption gains force).

## Prescription → AC coverage

| Prescription | Bound by |
|---|---|
| Estimator on live residuals (batch) / running sums (session), equal | AC-3 |
| Three-state verdict; indeterminate at unresolvable windows | AC-5 |
| Pattern fleet vs tail | AC-4 |
| Cliff detection (the ADR-0052 bar) | AC-2 |
| Opt-in field only; epochs throw | AC-1 |
| Envelope freshness + floor visibility | AC-6 |

## Consequences — the measured detection envelope (AC-6)

Artifact: `coverage-matrices/drift-monitor.{json,md}` (n = 8/cell; false-selection columns
recompute the ADR-0050/0052 cells, same seeds).

- **The ADR-0052 cliff has its detector.** At the recommended perLeafScale threshold (0.07):
  driftMix 0 → 100% `ok` (0.00 false selections); driftMix 0.5 → **100% `drifted`/`fleet`**
  (3.13 false selections); driftMix 1 → **100% `drifted`/`fleet`** (25.25). The transitional
  driftMix 0.25 cell detects 13% (0.25 false selections/run — mild damage, partial detection;
  published, not smoothed). Detection tracks damage: every cell with material false selections
  is fully detected.
- **Shared-calibration consistency:** at the default threshold the live-window monitor reads
  exactly what the calibration-window gate reads — 100% `ok` clean (ς̂ 0.007), 100% `drifted`
  at ς ≥ 0.1 (where selection lies).
- **Pattern attribution behaves:** the 2-of-20-leaves subpopulation variance fault reads
  `drifted`/`tail` (claim withheld, no recalibrate-now cry); the single-leaf single-signal
  fault reads `ok` — correctly ignored (one faulty leaf must not withhold the fleet's claim;
  its detection belongs to the detectors, not the monitor). The tail/fault ambiguity is
  recorded in the artifact caveat.
- **Resolvability honesty:** T = 40 at ς\* = 0.05 (floor 0.051) reads 100% `indeterminate` —
  a window that cannot resolve the boundary never reads `ok`.

The ADR-0052 "no detector" posture is superseded: `perLeafScale` production use now composes
with the monitor (recommended threshold 0.07) + the ADR-0051 gate; the license rule is
gate-passing AND monitor-`ok`. The fresh-calibration cadence remains good hygiene, no longer
the only guard.
