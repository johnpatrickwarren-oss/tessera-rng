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

## Honest current limitations (NOT hidden)

- Family A monitors `p99_latency`; the other four signals feed Family C (distributional) but
  not a per-signal Family A. Multi-signal Family A is a thickening target.
- Family C uses an identity baseline covariance (residuals are per-cell standardized);
  cross-signal covariance structure is not yet learned.
- Calibration estimates per-cell (mean, sd); the full production-AR temporal model (AR(1)
  pre-whitening, seasonal) from the engine substrate is not yet wired.
- Synthetic fabric/telemetry only (N2); arXiv:2604.15261 unavailable to validate the signal
  contract against — recorded assumption, not a fidelity claim.

## Next (resumable, post-v1)

1. Cold-eye review fixes (in progress) → commit.
2. Multi-signal Family A; learned cross-signal covariance for Family C.
3. Wire the engine's production-AR substrate (AR(1)/seasonal) into calibration.
4. Operator-supplied topology override; later, real-fabric validation phase.
