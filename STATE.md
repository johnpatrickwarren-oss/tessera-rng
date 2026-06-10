# STATE — Tessera-RNG

_Cold-readable snapshot of the "now". Overwritten as work lands; decision history lives in
`design/adr/`. Last updated: 2026-06-08._

## What this is

Operational observability for flat random-graph (RNG-family) datacenter networks. A fork of
**Tessera** (GPU-cluster shard observability) that reuses the same statistical engine
(`@johnpatrickwarren-oss/deploysignal-engine`, git-dep, **never forked**), repointed from
cluster shards to network **path-classes** and physical **fault domains**. It exists to
solve two problems a redundant random-graph fabric creates: monitoring 10^3–10^6 correlated
entities without false-positive blowup (→ reuse hierarchical e-values + e-BH FDR), and
turning "something shifted" into "this shared physical resource is the culprit" on a
topology where hop distance does **not** encode fault domain (→ a new tomographic
localization module). See ADR-0001.

## Phase

**v1 + post-v1 round 1 merged to `main`; round 2 on `post-v1-round2`.** v1: all ten
acceptance-criteria clusters, Q1–Q3 ratified. Round 1 (ADR-0006..0009, merged via PR #1):
min-sample pooled calibration fallback, Family C learned cross-signal covariance, higher-order
AR(p) calibration, Family D spectral detector — each with an ADR, anti-self-confirming tests, a
mutation pass on the new math, a fresh-context cold-eye review, and a green gate. Round 2
(ADR-0010..0012): per-mode honest measurement (A+C+D floors + firing-mode attribution), the
evidence-gated decision to keep Σ/φ global (no per-cell structure exists), and demo scenarios for
the C and D modes. The repo is **public**. **112 tests, gate PASS.**

## Built so far

- **Scaffold** — `pnpm` + `tsc` + `node --test` toolchain mirroring Tessera (tsconfig.json,
  tsconfig.test.json, .npmrc, .gitignore). Product → `src/`, tests → `test/`, demo →
  `demos/`, honest-measurement → `coverage-matrices/`, decisions → `design/`.
- **Engine git-dep proven** (halt-check #1) — `deploysignal-engine#v0.3.1-pre` installs and
  imports cleanly; `test/smoke-engine-import.test.ts` exercises Family A betting e-process,
  Welford per-shard runtime, hierarchical combine, e-BH FDR, and snapshot hashing — **5/5
  green**. (One smoke assertion initially encoded the e-BH threshold wrong; the engine was
  right, the test was fixed — confirming the engine isn't rubber-stamping.)
- **archgate wired** — `DISCIPLINES.md` (Anchor disciplines, distilled) + `arch-gate-usage.md`
  (sprag's canonical usage doc, installed by `sprag init`), both `@`-referenced from
  `CLAUDE.md`. sprag gate over `src/` with 6 invariants (complexity-12 primary,
  150-line backstop, god-file/module, require-tests, no-time-bomb); baseline recorded from
  the clean scaffold; **`pnpm gate` PASS**.
- **Durable trail** — ADR-0001 (domain remap, Accepted), ADR-0002 (FaultDomainSource mirrors
  TopologySource shape — Accepted, Q1 ratified), `design/spec/v1-spec.md` (impl-blind v1
  contract, Q1–Q3 resolved).
- **Walking skeleton** (`src/`, 10 modules, each with a test; 33/33 green, gate PASS) — the
  thin end-to-end spine: `rng` → `fabric` (generated quasi-random incidence) +
  `fault-domain-source` (mirrors TopologySource shape, hash via engine `pureJsSha256`) →
  `telemetry` (synthetic 5-signal, resource-degradation injection) → `detect` (Family A
  betting e-process per path-class) → `surface` (`combineAverage` + e-BH FDR) → `tomography`
  (precision-weighted firing-score localizer; common-mode resource ranks #1) → `drain`
  (simulated) → `pipeline` (one replay-clean `AuditRecord`). E2E tests prove: clean baseline
  selects nothing + replay-clean; single-shuffler common-mode → that shuffler is rank-1
  culprit, simulated drain fires, byte-identical on replay.

## Key decisions (see design/adr)

- Path-class = the engine "shard" leaf; multiplicity machinery reused wholesale (ADR-0001).
- Localization is a NEW tomographic solver over a fault-domain incidence hypergraph, NOT the
  engine's hop-distance BFS (ADR-0001).
- Incidence model rides a product-side `FaultDomainSource` mirroring the engine's
  TopologySource *shape*, not its closed `TopologySnapshot` type; hashing reuses the engine's
  public `pureJsSha256` (ADR-0002).

## v1 surface (src/ + tools/)

- `rng` seeded LCG · `signals` 5-signal contract · `domain` incidence model · `verdict` outputs.
- `fabric` generated quasi-random incidence · `fault-domain-source` (mirrors TopologySource
  shape; hash via engine `pureJsSha256`).
- `telemetry` raw per-cell-smear signals + degradation injection · `calibration` per-cell
  (HoD × DoW × traffic-class) baselines → residuals (AC-7).
- `detect` Family A (mean-shift), Family C (Safe-Hotelling distributional) **and** Family D
  (spectral/periodicity, ADR-0009, opt-in via DetectorContext), per-detector α-budget (AC-2a/2b) ·
  `family-d` spectral e-detector · `covariance` cholesky/logDet/Ledoit-Wolf (ADR-0007) ·
  `surface` hierarchical combine + e-BH FDR (AC-3) · `tomography`
  noisy-OR set-cover MAP (AC-5, **100% mutation score**) · `drain` simulated (AC-6) ·
  `pipeline` → replay-clean `AuditRecord` (AC-9).
- `tools/scenarios` eight deterministic scenarios (six v1 + covariance-flip + oscillation,
  ADR-0012) · `tools/build-demo` → `demos/demo.html` (AC-8) with firing-mode attribution ·
  `tools/coverage` → `coverage-matrices/coverage-saturation.{json,md}` with detection+attribution
  parallel columns, per-mode floor table (A+C+D, ADR-0010), and clean-fabric FDR-control evidence
  (AC-10).

## Post-v1 progress (branch `post-v1`)

- **Multi-signal Family A** (ADR-0003): Family A runs a betting e-process per signal, family
  e-value = mean of per-signal e-values (AoE, valid under dependence). Degradations can target
  any signal in `'mean'` or `'variance'` mode. Coverage now has a per-signal section showing
  detection+attribution across all five signals (100%) plus a variance row caught by Family C
  — the full signal contract is exercised end-to-end, not just disclosed.
- **Production-AR substrate calibration** (ADR-0004): telemetry now emits AR(1)-autocorrelated
  noise (real signals are temporally correlated); calibration estimates a per-signal AR(1) φ
  (pooled γ̂₁/γ̂₀, reusing the engine's `sampleAutocovariance`) and pre-whitens residuals
  (engine `prewhitenAr` + unit-variance rescale) after per-cell de-meaning. Detectors see
  near-iid input → FDR control holds (clean fabric still selects 0) under autocorrelated
  telemetry; tests verify φ recovery and lag-1 autocorrelation removal. (Generalized to
  per-signal AR(p) with BIC order selection in ADR-0008.)
- **Operator-supplied topology override** (ADR-0005): `validateFaultDomainSnapshot` (pure, in
  `src/`) validates a parsed incidence object (RNG taxonomy, `traverses` relationship,
  referential integrity); `tools/load-topology.ts` reads+parses the file (fs confined to
  `tools/`, N2 intact) and a CLI prints a summary+hash; `runPipeline` accepts an optional
  `snapshot` that overrides the generated fabric. Closes the Q3 deferral.
- **Min-sample pooled calibration fallback** (ADR-0006): cells with `n < 30` calibration
  samples borrow a pooled per-signal `(mean, sd)` (well-estimated over all cells) instead of a
  noisy per-cell `sd` that, against an independent live window, inflates residual variance and
  false-selects on a clean fabric. Unseen-at-calibration cells now pool too (were raw
  pass-through). Threshold 30 is empirical (a sweep: per-cell standardization only stops
  breaking FDR at `n ≳ 30`); the default ~400-path-class fabric is untouched. Unblocks small
  operator topologies — clean fabrics from 9 path-classes up select nothing, while a real shift
  still fires on every affected path-class.
- **Family D (spectral) detector** (ADR-0009): a THIRD anytime-valid family beyond A (mean) and C
  (covariance), catching temporal PERIODICITY — a signal that develops an oscillation with no change
  in marginal mean or variance. `src/family-d.ts` runs the engine's mixture-prior spectral
  e-detector over the peak |ACF| of NON-overlapping windows (overlapping breaks e-validity) of each
  pre-whitened residual; per-signal wealths averaged into the family e-value. Nulls (μ₀,σ₀)
  calibrated from clean residuals; `detectAll` takes a `DetectorContext {familyCCell?, familyDCells?}`
  so Family D runs only when calibrated (A+C-only callers unchanged; combined e-value = mean over
  present detectors). Telemetry gains a variance-preserving `oscillationPeriod/Amp` degradation. On a
  clean fabric a period-7 oscillation is caught on every affected path-class while A+C select zero;
  the clean A+C+D stack is FDR-controlled (not literally zero on every seed — e-BH bounds the rate).
  Power needs ~15 windows (~600 ticks); near-inert at short scenarios (0 false selections over 40
  clean 60-tick seeds). Degenerate-σ₀ nulls are disabled and wealth is capped finite (a cold-eye
  review closed an overflow→NaN path). New math; lone surviving mutant = the benign fire boundary.
  Family E (conformal) intentionally not added (Mahalanobis-based, overlaps C).
- **Higher-order AR(p) calibration** (ADR-0008): the temporal substrate generalizes from a fixed
  AR(1) to a per-signal AR(**p**), order-selected by BIC via the engine's `fitArP` (cap 6; BIC over
  AIC because AIC over-selects spurious orders on the long pooled stream). Each
  signal's de-meaned residual columns are concatenated across path-classes and fitted; pre-whitening
  uses multi-lag `prewhitenAr` rescaled by the fitted innovation sd. Telemetry gains an optional
  per-signal `arCoeffs` (AR(p) noise); the default stays byte-for-byte AR(1). On AR(2) telemetry the
  substrate recovers φ̂≈[0.5,0.3] and whitens lag-1 AND lag-2 to ~0, where an AR(1)-cap leaves lag-2
  ≈0.18; FDR holds. **Seasonal is deliberately not wired** — the per-cell HoD×DoW baseline already
  removes diurnal/weekly seasonality at the level (recorded, not silently absorbed). New math, 92%
  mutation.
- **Family C learned cross-signal covariance** (ADR-0007): replaces the identity Σ with a
  covariance LEARNED from the clean calibration residuals via Ledoit-Wolf shrinkage (new module
  `src/covariance.ts`: cholesky / logDet / sampleCovariance / ledoitWolf — pure, no engine
  internals). `makeFamilyCCellFromCovariance` recomputes the Safe-Hotelling log-det shrink
  constant for the real Σ; the pipeline learns Σ and threads it through `detectAll`. Telemetry
  gains optional cross-signal `noiseCorr` and a pure second-order `degradedNoiseCorr` (correlation
  flip, no marginal change). A learned Σ catches a correlation-flip degradation on every affected
  path-class that the identity Σ — and per-signal Family A — are completely blind to, while a
  clean correlated window still selects 0. New math, 92% mutation score; default telemetry stays
  byte-for-byte identical to v1.

## Post-v1 round 2 (branch `post-v1-round2`, off merged main)

- **Per-mode honest measurement** (ADR-0010): the audit gains `firing_families {A,C,D}` (the
  firing-mode attribution — which family caught the selected set), and the coverage tool gains a
  **per-mode floor table** measuring detection+attribution floors for all three anomaly modes
  (mean-shift Δ→A, covariance-flip Δρ→C, oscillation amp→D) with the firing family per mode. The
  scope note no longer defers covariance/spectral to a footnote — they are measured. `runPipeline`
  now threads baseline `noiseCorr`/`arCoeffs` into the calibration window too. Measured floors
  (passive_shuffler, q=0.05): mean Δ=1 (A; A+C at Δ≥2), covariance Δρ=0.2 (C), oscillation amp=0.9
  (D).
- **Demo scenarios for the C and D modes** (ADR-0012): the demo dashboard extends from six to
  **eight** scenarios — adds `covariance-flip-common-mode` (a shuffler reverses cross-signal
  correlation, no mean/variance change → caught by Family C, A blind) and `oscillation-common-mode`
  (a shuffler develops a period-7 limit cycle, 600 ticks → caught by Family D, A+C blind). Both
  localize rank-1 to the injected shuffler; the demo renders the audit's firing-family tally so each
  scenario names the detector that caught it. AC-8 amended on the record (spec annotated). No new
  `src/` code — composes the tested pipeline.
- **No per-cell second-order structure** (ADR-0011): evidence-gated — measured whether per-cell
  (HoD×DoW×class) Σ and φ structure exists before building it. It does **not**: per-cell Σ spread
  sits below the pure-sampling-noise floor (0.09 vs 0.12), per-cell estimates are *attenuated*
  (0.78 vs global 0.90; small-sample shrinkage, the ADR-0006 lesson), per-class φ is flat, and
  per-cell AR(p) is structurally ill-posed (cells are non-contiguous in time). Decision: **keep
  global Σ/φ, build nothing.** A durable evidence test (`test/percell-second-order.test.ts`) guards
  the call.

## Honest current limitations (NOT hidden)

- Family C now learns a GLOBAL cross-signal covariance Σ (Ledoit-Wolf); per-cell Σ, a factor-model
  target, and a scale-invariant τ²=c·trace(Σ)/p remain future refinements (ADR-0007).
- Calibration now models AR(**p**) (BIC order selection, cap 6); φ is per-signal-global not
  per-cell, and seasonal decomposition is intentionally omitted (subsumed by the per-cell HoD×DoW
  baseline) — see ADR-0008.
- Live-fabric polling / streaming ingestion (a real `fetchSnapshot` against a controller)
  remains N2 anti-scope.
- Synthetic fabric/telemetry only (N2); arXiv:2604.15261 unavailable to validate the signal
  contract against — recorded assumption, not a fidelity claim.

## Next (resumable, post-v1)

Documented future-work queue (each = ADR + tests + green gate + commit):

1. ✅ Min-sample pooled calibration fallback (ADR-0006) — done.
2. ✅ Family C learned cross-signal covariance (ADR-0007) — done; 92% mutation on the new math.
3. ✅ Higher-order AR(p) calibration (ADR-0008) — done; BIC order selection, seasonal subsumed; 92% mutation.
4. ✅ Family D (spectral) detector (ADR-0009) — done; catches periodicity A+C miss; 75% mutation. (Family E not added — overlaps C.)

All four documented future-work items are complete. Possible further work (none started): per-cell
Family C Σ, per-cell AR(p), Family E if a non-Gaussian-tail mode is needed, Family D in the coverage
matrix, real-fabric validation.

Out of scope / needs outside input: live-fabric validation (N2), real data-plane drain wiring
(N4), the arXiv:2604.15261 signal-contract fidelity question, repo visibility (private→public).
