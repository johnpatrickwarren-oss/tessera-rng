# STATE — Tessera-RNG

_Cold-readable snapshot of the "now". Overwritten as work lands; decision history lives in
`design/adr/`. Last updated: 2026-06-10._

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

**v1 + post-v1 rounds 1–8 merged to `main` (PRs #1–#7); no round in flight.** v1: all ten
acceptance-criteria clusters, Q1–Q3 ratified. Round 1 (ADR-0006..0009, merged via PR #1):
min-sample pooled calibration fallback, Family C learned cross-signal covariance, higher-order
AR(p) calibration, Family D spectral detector — each with an ADR, anti-self-confirming tests, a
mutation pass on the new math, a fresh-context cold-eye review, and a green gate. Round 2
(ADR-0010..0012): per-mode honest measurement (A+C+D floors + firing-mode attribution), the
evidence-gated decision to keep Σ/φ global (no per-cell structure exists), and demo scenarios for
the C and D modes. Round 3 (ADR-0013..0018, same branch): the RNG-paper reconciliation work order —
paper verified, weighted incidence, Spraypoint two-view leaves, the leaky-LLR scorer, and
reconvergence epochs (source + detector sides). **All five work-order items done**, each closed
with a fresh-context cold-eye (the item-4 cold-eye caught the headline epoch behaviors unbound and
a fabricated epoch-0 attribution — both fixed and bound, see ADR-0018). Rounds 2+3 merged to
`main` via PR #2. Round 4 (ADR-0019/0020, merged via PR #3): the exposure-saturating noisy-OR
(C1 closed; latent room-fault defect fixed) + Spraypoint dilution floors, each with a cold-eye
fold-in. Round 5 (branch `post-v1-round5`, ADR-0021/0022): multi-fault injection — whose e2e test
immediately falsified the binary set-cover and forced marginal-LLR set construction. The repo is
**public**. Round 6 (ADR-0023/0024 + docs, merged via PR #5): README brought current, tiered
drain budgeting, multi-fault floors. Round 7 (ADR-0025/0026, merged via PR #6): paper-scale
proof + ToR-pair drill-down. Round 8 (ADR-0027, merged via PR #7): the incremental session —
anytime-valid made operational. The recommended post-v1 roadmap is COMPLETE; the remaining queue
is owner-decision items only (traffic-model unification, epoch wealth carryover, live-fabric
seam — see "needs outside input"). **192 tests, gate PASS.**

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

## Post-v1 round 5 (branch `post-v1-round5`, off merged main)

- **Multi-fault injection** (ADR-0021): `TelemetryParams.degradations?` — simultaneous
  degradations compose in array order (mean shifts add exactly: δ₁w₁+δ₂w₂, bound per tick);
  `[x]` ≡ singular `x` byte-identical; both forms throw; at most one `degradedNoiseCorr`
  (validated narrowing). The set-cover's "minimal explaining SET" claim is finally exercised by
  real telemetry: two shufflers end-to-end ⇒ both culprits, both drained, replay-clean.
- **Marginal-LLR set construction** (ADR-0022, forced by ADR-0021's cross-kind fixture per
  halt-on-contradiction): the binary explained-set let a panel claim a ToR leaf through a w=0.1
  membership (ONE culprit for two faults, observed). The cover now scores candidates by MARGINAL
  LLR against the picked set's per-leaf residual quiet factors, folding each pick's (δ,κ)
  POSTERIOR into its members — knob-free, reduces exactly to ADR-0019 at first pick (score
  bounds pass untouched), recovers both cross-kind faults, and keeps the saturated single-fault
  minimal set (one culprit at δ=128, binding the posterior fold against deletion/prior mutants).
  `explained` is now "more likely than not under a picked set that touches the leaf" (display
  binarization, not mechanism); legacy linear keeps the historic binary cover as the control.
  Round-5 cold-eye fold-in: variance/oscillation modes now center on the ACCUMULATED mean (they
  multiplied a preceding mean shift — "compose freely" was falsified, fixed + bound
  order-independently in both orders); nested no-quiet free-riders blocked by the
  has-unexplained-firing admission gate (a stricter draft gate was itself rejected by the
  coverage freshness bind for blocking weak first picks — optic Δ=1 attribution fell 3/4 → 1/4,
  observed and reverted); score/member-list semantics documented (rank≥2 = pick-order-conditional
  marginal; member lists are provenance, not attribution partitions).

## Post-v1 round 6 (branch `post-v1-round6`, off merged main)

- **README current through round 5** (docs): the public front page was frozen at v1 (no Family
  D, six scenarios, none of rounds 1–5); rewritten with the owner's intuition diagram embedded.
- **Tiered drain budgeting** (ADR-0023, closes ADR-0022 L2): epoch'd drain targets rank by TIER
  (pick position within the evidence group) then score — every group's rank-1 (a full LLR,
  comparable across groups) drains before any group's rank-2 marginal; the recorded starvation
  case is bound as a unit test. Same-tier cross-group comparison stays approximate, recorded.
- **Multi-fault floors** (ADR-0024, closes the ADR-0021 measurement deferral): attribution =
  BOTH injected resources in the top-2 culprits. Measured on Spraypoint (cross_kind optic+panel:
  detection 1 / attribution 2; same_kind optic+optic: 2 / 2) — **every floor equals its
  constituents' single-fault floors**: no multi-fault-specific penalty observed on this grid
  (n=2 "first unanimous Δ" estimator, recorded). A pre-measurement draft predicted lower floors
  and was corrected against observation. Bound by spot-check #3 + md-emission asserts. k≥3
  simultaneous faults remain example-tested, not floor-measured (recorded narrowing).

## Post-v1 round 7 (branch `post-v1-round7`, off merged main)

- **Paper-scale proof** (ADR-0025): `PAPER_SPRAYPOINT` (960×32×4 → 1,456 leaves, ~514K weighted
  edges — AC-1's upper range, 13× past anything previously executed). Measured: clean FDR holds
  at scale; optic/panel/room faults each detect and localize rank-1; replay-clean; ~0.7 s/run,
  ~550 MB (machine numbers, recorded in the ADR — the published `scale_proof` artifact section
  is deterministic and freshness-bound by spot-check #4). Floors are NOT swept at scale
  (recorded; demo-scale floors remain the published floors).
- **ToR-pair drill-down** (ADR-0026, closes the ADR-0015 deferral): `src/drilldown.ts` — the
  on-demand second stage from a localized fault domain to impacted underlying ToR-pairs.
  Exposure model mirrors the spray weights (optic → endpoint pairs at 1; panel → all at
  1/nPanels; room → panels-in-room/nPanels); synthetic per-pair standardized-residual window;
  detection REUSES detectPathClass + e-BH at the drill's own q (FDR over the EXAMINED pairs);
  `maxPairs` cap with exposed/examined/truncated ALWAYS reported. Bound: true-culprit drill
  ranks impacted pairs; clean drill FDR-quiet; **dilution honesty** (panel Δ=4 detects at view
  level but is 0.4σ per pair — the drill says so instead of inventing impact; Δ=40 selects
  broadly); cross-resource drill selects exactly the genuinely-crossing pair (pair-3-5);
  deterministic; N1 carried. Recorded narrowings: mean-shift faults only; residual-level window
  (production needs pair-level calibration, N2); selection-conditioned FDR; id-order truncation
  sample. NOT in runPipeline/the audit — operator-initiated by design.

## Post-v1 round 8 (branch `post-v1-round8`, off merged main)

- **Incremental session** (ADR-0027): `src/session.ts` — `openSession(...)` then `ingest(tick)`
  / `audit()` at ANY tick: per-tick standardization (per-cell de-mean + an AR(p) lag buffer
  replicating the engine filter's probed convention), engine-incremental Family A/C updates,
  Family D window buffering, epoch wealth-resets at ingest time, and the batch pipeline's own
  audit tail (`assembleAudit`, extracted and SHARED so streaming and batch cannot drift).
  KEYSTONE bind: incremental ≡ batch **byte-for-byte** at the final tick for single-fault,
  multi-fault, and epoch'd reroute runs. Anytime binds: the clean every-tick profile pinned
  honestly (a 3-tick single-leaf transient is what per-query FDR permits — the first test draft
  overclaimed "never selects" and was corrected on the record); a fault localizes at a recorded
  tick well before the batch window ends. Recorded narrowings: batch calibration (open with a
  substrate, stream live); full-tick ingest; every-tick querying is a stopping rule (each query
  valid; the published FDR figure describes a single query). Round-8 cold-eye fold-in: returned
  audits are SNAPSHOTS (the resets list was aliased and self-rewrote under later ingests);
  partial-tick ingest is validated before any state mutates (a throw is a no-op — retry is
  corruption-free, bound against batch); openSession validates reroutes (a fractional at_tick
  silently skipped its wealth reset); mid-stream audits trim to the epochs ACTIVE so far (no
  future routing); keystones extended to 600-tick Family-D, AR(2), and two-reroute runs;
  calibrateForSession shared by pipeline, tests, and operators.

## Honest current limitations (NOT hidden)

- Family C now learns a GLOBAL cross-signal covariance Σ (Ledoit-Wolf); per-cell Σ, a factor-model
  target, and a scale-invariant τ²=c·trace(Σ)/p remain future refinements (ADR-0007).
- Calibration now models AR(**p**) (BIC order selection, cap 6); φ is per-signal-global not
  per-cell, and seasonal decomposition is intentionally omitted (subsumed by the per-cell HoD×DoW
  baseline) — see ADR-0008.
- Live-fabric polling / streaming ingestion (a real `fetchSnapshot` against a controller)
  remains N2 anti-scope.
- Synthetic fabric/telemetry only (N2). **arXiv:2604.15261 is now available and verified**
  (ADR-0013): topology/routing/ShuffleBox/scale confirmed (quasi-random expander, d=64, max path
  5, >50 edge-disjoint paths, Spraypoint ECMP, 960 ToRs/61.4K servers), and the paper confirms hop
  distance is structurally dead (P2). But the paper treats telemetry/operations as out of scope, so
  the §3.2 five-signal contract stays a working assumption — now **unfalsified, not validated**. The
  published floors now cover BOTH regimes: the v1 binary/fixed-set injection model AND the
  Spraypoint fractional-dilution fabric (ADR-0020 closed the ADR-0014 deferral — detection floors
  unchanged; the room ATTRIBUTION floor rises 1→2 vs its binary analogue, published).

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
(N4), the §3.2 signal-contract *fidelity* question (paper now read — ADR-0013 — but telemetry is
out of its scope, so fidelity stays unprovable without real data). The WO-item-5 granularity
HALT was resolved by the owner in ADR-0015 (aggregation-view leaves). **Open owner decision
(round-7 cold-eye):** unify the Spraypoint traffic model — the fabric's leaf-local view weights
and the drill's flow-level exposures diverge by 2× conventions (recorded in ADR-0026);
unification would change snapshot hashes, pinned δ-bands, and every published Spraypoint floor.

## Post-v1 round 3 — RNG-paper reconciliation work order (branch `post-v1-round2`)

- **RNG-paper reconciliation** (ADR-0013): arXiv:2604.15261 is now available; I self-fetched and
  verified its topology/routing/ShuffleBox/scale (quasi-random expander, d=64, max path 5, >50
  edge-disjoint paths, Spraypoint ECMP+waypoints, 960 ToRs/61.4K servers). The paper confirms P2
  (hop distance is dead) and the path-diversity raw material, but treats telemetry as out of scope —
  the five-signal contract is now *unfalsified, not validated*. Motivates the weighted-incidence,
  leaky-scorer, and epoch items (ADR-0014..0016) and the HALT-CLASS granularity question. Docs only.
- **Spraypoint two-view aggregation leaves** (ADR-0015, resolves the HALT-CLASS item 5): at
  production scale (~460K ToR-pairs) the monitored leaf becomes an **aggregation-view class** — the
  union of a `per_tor` view (~nTors) and a `per_panel_pair` view (~C(nPanels,2)) over the underlying
  ToR-pair traffic (~109 leaves at the 64×10×2 default, inside AC-1). The owner corrected the framing:
  the scale problem is per-leaf **heterogeneity** (misspecified shared baselines), not sample budget;
  and aggregating m fault-sharing leaves cuts noise by √m, which adds power in the diluted spray
  regime. The two views have **complementary blind spots** — optic faults concentrate in `per_tor`
  (blind in `per_panel_pair`), panel faults in `per_panel_pair` (blind in `per_tor`), room faults in
  both — published as a per-view coverage column and bound by anti-self-confirming tests. Views are
  dependent (e-BH/AoE handle it; clean still selects 0). `src/spraypoint.ts`; `shuffle_panel`/`room`
  taxonomy added; AC-1 amended (leaf = view-class; view defs in the snapshot/hash). ToR-pair stays the
  underlying entity (drill-down = future scope).
- **Weighted (fractional) incidence** (ADR-0014): the incidence edge gains an optional traffic
  weight `w ∈ (0,1]` (Spraypoint dilution); absent ⇒ 1 ⇒ byte-identical v1. A fault shifts a leaf by
  `delta·w` (honest dilution); tomography scores explanation/collateral by `w`. Hash + validation
  incorporate the weight. Anti-self-confirming fixture: where the unweighted scorer picks an
  incidental decoy resource, the weighted scorer follows the traffic to the true one. Weighted
  solver holds 100% mutation; default unchanged.
- **Leaky-LLR scorer + C1 residue pinned** (ADR-0016, work-order item 3; member model since superseded by ADR-0019, residue closed): the tomography default is
  now a **leaky noisy-OR mixture LLR** — per member, clean `P(fire)=q₀` (the surface's floored fleet
  base rate `(|selected|+½)/(|leaves|+1)`) vs faulty `q₁=q₀+(δ−q₀)·w`, mixed over δ∈{0.3,0.6,0.9};
  greedy set-cover on LLR>0. Base-rate-aware, weight-aware falsification; subsumes the λ knob (the
  linear scorer survives only as the `opts.legacy` failure-mode control). Culprits gain
  `supporting_views` (displayed metadata). **The LLR did NOT fix the cold-eye C1 high-δ cross-view
  flip** — empirically the residue is structural (a saturating optic fault lights the whole pair
  view; no per-resource scorer sees the cross-view explain-away), and no q₀ fixes it (q₀=q makes it
  worse — comparison recorded). Owner-resolved: **pin the realistic band (δ≤32 holds optic-3) +
  document the δ≥64 residue** as a union-of-dependent-views limitation, with a canary test proving
  the per-ToR view alone still localizes at δ=128 (union artifact, not detection failure). The
  one-view-vs-union double-count check came back negative in the band → no view-multiplicity knob.
  Cold-eye L1 folded in: operator-supplied `views` now survive validation (they were silently
  dropped, breaking the operator replay-hash identity). Explain-away scorer = recorded future work.
- **Epoch'd snapshots + synthetic reroute events** (ADR-0017, work-order item 4 part 1 — source
  side): Spraypoint reconverges, so the incidence model becomes a SEQUENCE of epochs
  (`src/epoch.ts`: `SnapshotEpoch {snapshot, valid_from_tick, hash}` — per-epoch hash versions the
  full measurement design including the ADR-0015 views). A synthetic `RerouteEvent` models a
  drain/reconvergence: at `at_tick` a seeded `floor(fraction·|candidates|)` of the path-classes
  traversing `resource_id` remap onto same-kind alternates (weight merged, capped at 1; no
  alternate ⇒ throw; pure + deterministic, AC-9). Telemetry's degradation follows the ACTIVE epoch
  per tick (a leaf rerouted off a faulty resource stops shifting at the boundary); the noise
  process is deliberately continuous across epochs. No epochs ⇒ byte-identical v1 (guard test).
  N2 intact: synthetic events only, no live fetchSnapshot. Gate loosening on the record:
  `no-god-module` 16→20 (`domain.ts` is the invariant-admitted zero-behavior type contract; intent
  updated in place, ADR-0017).
- **Epoch-aware detection + per-epoch localization** (ADR-0018, item 4 part 2 — detector side):
  `runPipeline` gains `reroutes?` (absent/empty ⇒ byte-identical v1 audit, guard-tested). A leaf
  whose incidence changed at an epoch boundary has its e-process **reset there with fresh wealth**
  (`detectPathClassSegmented`) — a deliberate, RECORDED power loss: the audit lists every reset in
  `eprocess_resets`, and the leaf verdict carries per-segment e-values. Leaf e-value = MEAN over
  segments (valid under arbitrary dependence, same rule as the family combine); `evidence_epoch` =
  argmax segment (attribution metadata; an UNSEGMENTED leaf's evidence epoch is unknown and never
  fabricated — by stated convention it joins the latest group). Tomography groups selected leaves
  by evidence epoch and localizes each group **against that epoch's snapshot** (culprits carry
  `localized_against_epoch` — named for what it factually is); drains act on the LATEST epoch,
  strongest culprit first, one drain per resource. Audit records the epoch sequence
  `{valid_from_tick, hash}`. Work-order tests bound: (i) reroute+no-fault selects nothing;
  (ii) fault + subsequent reroute still localizes from pre-reroute evidence against epoch 0;
  (ii-b, cold-eye C1) evidence accruing AFTER the reroute localizes against epoch 1 — each
  headline behavior verified to kill its hand-made constant mutant; (iii) replay-clean across
  epochs. Unchanged leaves never reset. Smarter wealth carryover = recorded future work.

## Post-v1 round 4 (branch `post-v1-round4`, off merged main)

- **Exposure-saturating noisy-OR** (ADR-0019): the tomography member model becomes the true
  noisy-OR `P(quiet) = (1−q₀)(1−δ)^{κ·w}` mixed over δ ∈ {0.3,0.6,0.9} × κ ∈ {1,16,256} with a
  **1/κ scale prior** (fixed form, not a knob — a uniform κ prior loses the ADR-0014
  follow-the-traffic discrimination, recorded). Root cause of the ADR-0016 C1 residue was the
  non-saturating linear leak, not cross-view structure: at extreme δ the optic's leakage into
  1/64-diluted pair leaves is *expected* under high κ, and the coarse pair-view resources are
  falsified by their quiet per-ToR members. **C1 closed** (optic-3 rank-1 across the full sweep,
  33.3 at δ=128), **no symmetric regression** (panel margins grow), and a **latent defect fixed**:
  a true ROOM fault mislocalized to a panel at every δ under the old model — now room-0
  across the tabulated band (δ≳2; the under-selected δ≈1 regime localizes a wrong KIND under
  either model, recorded). The owner's explain-away discount and set-completion candidates were
  analyzed and rejected on the record (symmetric failure / needs a parsimony knob). The ADR-0016
  canary was retired per its own instruction into the C1-CLOSED test with two failure-mode
  controls. Cold-eye fold-in: the published honest-measurement artifacts were STALE (demo.html
  since ADR-0016, coverage matrix since ADR-0019) — both regenerated (the new scorer measures
  BETTER: optic Δ=1 attribution 25%→75%, power_zone attribution floor 2→1) and now bound by a
  byte-exact demo freshness test + a coverage single-cell spot-check; q₀ ∉ (0,1) is rejected
  (the +Infinity ranking hole); empty κ grid covered by the degenerate-mixture gate.
- **Spraypoint dilution floors** (ADR-0020, round-4 item 2): the honest-measurement matrix gains
  a dilution floor table on the two-view fabric (3 kinds × Δ∈{0.5..4} × 2 targets × 2 seeds),
  closing the ADR-0014 "binary regime only" deferral. Measured: optic 2/2, shuffle_panel 1/2,
  room 1/2 — **detection floors are not raised by dilution** (each kind's w=1 view carries
  detection, matching the binary analogues), but the **room attribution floor rises 1→2** vs its
  binary reference (power_zone 1/1): Δ=1 detects 4/4 yet attributes 0/4 (the ADR-0019 wrong-kind
  band — a reliable alarm with an unreliable culprit, published, not implied away; true boundary
  ≈1.5–2). A pre-measurement draft predicted lower floors and was wrong — replaced with observed
  numbers on the record; the first published reading ALSO overclaimed ("dilution does not raise
  the floors") and was corrected by the round-4 cold-eye. Bound by a second freshness spot-check
  (the room Δ=2 cell), structural floor assertions, markdown-section emission asserts, and a
  Spraypoint clean-fabric FDR control (0% FP) so the detection column owns its baseline.
