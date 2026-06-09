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

**Fuller v1 complete.** All ten v1 acceptance-criteria clusters implemented and tested
(67 tests, gate PASS, tomography 100% mutation score). Q1–Q3 ratified. A fresh-context
cold-eye review was run and its findings addressed: Family A α-accounting corrected to
spent-on-fire, anti-scope guard tests added (N1/N2/N5), AC-8 demo test added, and the
coverage report now states its single-signal (p99-mean-shift) perturbation scope prominently.

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
- `detect` Family A (mean-shift) **and** Family C (Safe-Hotelling distributional), per-detector
  α-budget (AC-2a/2b) · `surface` hierarchical combine + e-BH FDR (AC-3) · `tomography`
  noisy-OR set-cover MAP (AC-5, **100% mutation score**) · `drain` simulated (AC-6) ·
  `pipeline` → replay-clean `AuditRecord` (AC-9).
- `tools/scenarios` six deterministic scenarios · `tools/build-demo` → `demos/demo.html`
  (AC-8) · `tools/coverage` → `coverage-matrices/coverage-saturation.{json,md}` with
  detection+attribution parallel columns, floor table, and clean-fabric FDR-control evidence
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
  telemetry; tests verify φ recovery and lag-1 autocorrelation removal.
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

## Honest current limitations (NOT hidden)

- Family C uses an identity baseline covariance (residuals are per-cell standardized);
  cross-signal covariance structure is not yet learned.
- Calibration models AR(1) only; higher-order AR(p)/seasonal structure (engine `fitArP`/
  `seasonal`) is future work.
- Live-fabric polling / streaming ingestion (a real `fetchSnapshot` against a controller)
  remains N2 anti-scope.
- Synthetic fabric/telemetry only (N2); arXiv:2604.15261 unavailable to validate the signal
  contract against — recorded assumption, not a fidelity claim.

## Next (resumable, post-v1)

Documented future-work queue (each = ADR + tests + green gate + commit):

1. ✅ Min-sample pooled calibration fallback (ADR-0006) — done.
2. ⏳ Family C learned cross-signal covariance — replace the identity Σ with a covariance
   estimated from calibration residuals (Ledoit–Wolf shrinkage); recompute the Safe-Hotelling
   log-det shrink. New math → mutation pass. (ADR-0007)
3. ⏳ Higher-order AR(p)/seasonal calibration — extend AR(1) via the engine's `fitArP`
   (AIC/BIC order selection) and optionally `seasonal`. (ADR-0008)
4. ⏳ (Stretch) Family D (spectral) and/or E (conformal) detectors in `detect.ts`. (ADR-0009)

Out of scope / needs outside input: live-fabric validation (N2), real data-plane drain wiring
(N4), the arXiv:2604.15261 signal-contract fidelity question, repo visibility (private→public).
