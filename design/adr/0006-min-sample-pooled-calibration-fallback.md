# ADR 0006 — Min-sample pooled calibration fallback

- **Status:** Accepted
- **Date:** 2026-06-09
- **Decision owner:** Tessera-RNG (post-v1)
- **Supersedes:** —

---

## Context

Calibration (ADR-0004) standardizes each live signal against its **cell** baseline — a
per-cell `(mean, sd)` keyed by hour-of-day × day-of-week × traffic-class. The live window is
standardized against an **independent** clean calibration window (different seed). This is
sound when each cell is well-sampled, but a cell's `sd` is an estimate with relative error
≈ `1/√(2n)`. When a cell has few samples, a downward-fluctuated `sd` estimate makes the live
residual `(x − mean)/sd` blow up: `Var(residual) ≈ liveVar / sd̂²`, which is heavy-tailed for
small `n`. Those inflated residuals manufacture detector fires on a *clean* fabric, breaking
the e-BH FDR guarantee that the whole surface rests on.

This is latent on the default fabric (~400 path-classes → ~130 samples/cell) but becomes
acute on **small operator topologies**: a handful of path-classes, or a short calibration
window, leaves cells with single-digit sample counts. The v1 code also floored `sd` at
`1e-9` and, for cells unseen at calibration time, passed the raw value through unchanged — a
raw level (e.g. ~10 ms latency) treated as a residual is itself a false detection.

Honest measurement of where this bites (clean fabric, q = 0.1, 3 seeds, ticks = 48 so each
cell sees ≈ `n_path_classes / 3` samples; entries are #path-classes false-selected):

| path-classes | samples/cell | MIN 5 | MIN 10 | MIN 15 | MIN 20 | MIN 30 |
|---|---|---|---|---|---|---|
| 9   | ≈3  | 0     | 0     | 0 | 0 | 0 |
| 15  | ≈5  | **15**| 0     | 0 | 0 | 0 |
| 30  | ≈10 | **21+**| **21+**| 0 | 0 | 0 |
| 60  | ≈20 | 1     | 1     | 1 | 1 | 0 |
| 150 | ≈50 | 0     | 0     | 0 | 0 | 0 |

Per-cell standardization only stops false-selecting once `n ≳ 30`. The kickoff's rough
"~5" is **not** enough; 5–10-sample cells still break FDR control.

## Decision

Add a **pooled per-signal fallback** to the calibration substrate:

1. In one pass, build per-cell `(mean, sd)` *and* a **pooled** `(mean, sd)` over **all**
   calibration samples (every path-class, every tick).
2. A cell with `n < minCellSamples` borrows the pooled `(mean, sd)` instead of its own
   noisy estimate, and is flagged `pooled: true` (inspectable / testable).
3. `minCellSamples` defaults to **`DEFAULT_MIN_CELL_SAMPLES = 30`** (empirical, per the table
   above), overridable via `buildCalibration(raw, { minCellSamples })`.
4. A cell **unseen** at calibration time also falls back to the pooled baseline (it was a raw
   pass-through before), so out-of-calibration cells are standardized, not leaked as raw.

The pooled baseline averages over the diurnal/class smear, so it is a coarser de-meaner — but
for an under-sampled cell there is no trustworthy finer estimate, and a clean window still
de-means to ~0 (the diurnal sine nets out) while a real `+δ` shift survives (verified). The
well-sampled default fabric is **unchanged**: every cell stays above the floor and keeps full
per-cell resolution.

## Consequences

- **FDR control restored on small topologies.** Clean fabrics from 9 path-classes upward
  select nothing; the default ~400-path-class fabric (≈130 samples/cell) is untouched.
- **Detection power preserved.** A real shift on a tiny topology (power-zone common-mode,
  δ = 8) still fires on every affected path-class under pooled de-meaning.
- **No new engine surface.** Pure arithmetic over existing residuals; AR(1) pre-whitening
  (ADR-0004) is unaffected (it runs on the de-meaned residuals as before). N5 intact.
- **Honest limitation.** The count threshold is a blunt instrument; a per-cell variance
  *shrinkage* estimator (James–Stein / Ledoit–Wolf toward the pooled variance) would degrade
  more gracefully across the boundary and is recorded as possible future refinement. The
  diurnal resolution lost when a cell pools is acceptable because the cell could not estimate
  that structure reliably anyway.
