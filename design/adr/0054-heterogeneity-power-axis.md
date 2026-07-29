# ADR 0054 — The ς power axis: fault detection and attribution under dispersion

- **Status:** ACCEPTED (envelope measured; one metric correction during build recorded below)
- **Date:** 2026-07-28
- **Decision owner:** Tessera-RNG
- **Relates to:** ADR-0050 (the null side: false selections vs ς; its "not a power
  measurement" caveat is the deferral this closes), ADR-0032 (the degradation harness whose
  operating point this mirrors), ADR-0052 (`perLeafScale` — the remedy arm), ADR-0046 (the
  linear localizer under test).
- **Files:** `tools/heterogeneity-power.ts` → `coverage-matrices/heterogeneity-power.{json,md}`,
  `test/heterogeneity-power.test.ts`. No `src/` changes.

---

## Problem

ADR-0050 measured what dispersion does to the NULL (a ς-determined fraction of healthy leaves
false-selects). Open question, recorded there: what happens to POWER — does a real fault still
get detected, and does the localizer still attribute it, when its selection set is polluted
with false leaves? And does the ADR-0052 remedy restore attribution? Without this, "detection
works, claims are gated" is an assumption on the faulted side.

## Decision

One measurement tool, no production changes. Faulted runs (the ADR-0032 operating point:
optic mean fault δ = 3 from tick 0, DEFAULT_SPRAYPOINT, 60 ticks, q = 0.05; two targets ×
8 seeds ⇒ n = 16/cell) across ς ∈ {0, 0.1, 0.2, 0.3} × arms {shared calibration,
`perLeafScale`}. Composition mirrors the production path (calibrate under the same ς physics,
drift 0; full audit tail incl. tomography); the ς = 0 shared-calibration cell is
anchor-bound byte-for-byte to `runPipeline`.

Per-cell metrics — sharper than ADR-0032's, because under dispersion "any selection" is
trivially true:

- **fault_detection_rate** — ≥ 1 leaf AFFECTED by the fault (its incidence edges) selected;
- **attribution_rate** — top culprit = the faulted resource (rank-1, the ADR-0032 bar);
- **mean_false_coselections** — selected leaves NOT affected by the fault (the ADR-0050
  mechanism showing up in a faulted run);
- **mean_selected** — total, for scale.

## Acceptance criteria

- **AC-1 (anchor):** the ς = 0 / shared-calibration composed run reproduces `runPipeline`'s
  `selected_path_class_ids` AND `culprits` resource ranking exactly, per seed.
- **AC-2 (clean baseline):** ς = 0 cells: detection = attribution = 100%, false
  co-selections = 0 (else the axis measures nothing).
- **AC-3 (envelope honesty + freshness):** all four metrics published per cell with n; one
  cell recomputes exactly; `.md` ≡ renderMarkdown(`.json`); whatever the dispersion arm shows
  — including attribution surviving — is published as measured (no narrative smoothing).

## Anti-scope

- **No production changes, no new knobs.** Measurement only.
- **No variance/covariance/spectral fault modes** (the ADR-0032 grid owns mode coverage; this
  axis isolates ς with the canonical mean fault). No multi-fault. No scale ramp.
- **No drift arm** (ADR-0053 owns drift; this axis is static ς).
- **No threshold/gate coupling** — power is measured unconditionally; how a failing gate
  interacts with paging policy is operator scope.

## Prescription → AC coverage

| Prescription | Bound by |
|---|---|
| Composition ≡ production path at the inert cell | AC-1 |
| Clean cells non-degenerate | AC-2 |
| Four metrics, per cell, published as measured | AC-3 |

## Consequences — the measured power envelope (AC-3)

Artifact: `coverage-matrices/heterogeneity-power.{json,md}` (n = 16/cell).

- **Detection never fails; attribution is the casualty — and it fails toward WRONG HARDWARE.**
  Under shared calibration the fault's own leaves select at 100% at every ς (a δ = 3 fault is
  loud), and attribution even SURVIVES a handful of false co-selections (100% at ς = 0.1
  despite 5.4 false leaves/run — the ADR-0046 localizer has real robustness margin). At
  ς = 0.2 it collapses to **0%** (15.6 false leaves drown the explaining set) — and the
  mis-attribution goes to **wrong physical resources, never the fleet-event candidate (0%)**:
  the operationally worst failure (paging the wrong hardware with confidence), the same shape
  as ADR-0032's silent-mis-attribution headline, now with dispersion as the cause.
- **The remedy restores everything, at every tested ς.** `perLeafScale` ON: exactly 1
  selection/run, 0 false co-selections, 100% attribution through ς = 0.3 — the faulted arm's
  confirmation of the ADR-0052 static result.
- **Metric correction recorded (caught during build):** the first cut counted a leaf
  "affected" via ANY incidence edge — with `crossOptic` every tor leaf is ε-connected to every
  optic (w = 1/(nTors−1) ⇒ δ·w ≈ 0.05σ, undetectable), which degenerated false co-selections
  to 0. The published metric uses a material-incidence threshold (w ≥ 0.5), with ε-shifted
  leaves counted as false co-selections deliberately (their selection is not fault-driven) —
  disclosed in the artifact caveat.

Combined reading across the program (ADR-0050→0054): under dispersion the alarm still fires
(detection 100%) but BOTH downstream products degrade — the FDR claim (ADR-0050) and the
culprit (this ADR) — and both are restored by `perLeafScale` on static-ς fabrics, with the
gate (ADR-0051) + monitor (ADR-0053) guarding the regimes where the remedy itself fails.
The ADR-0050 "not a power study" caveat is closed.
