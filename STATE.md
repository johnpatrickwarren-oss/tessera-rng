# STATE — Tessera-RNG

_Cold-readable snapshot of the "now". Overwritten as work lands; decision history lives in
`design/adr/`. Last updated: 2026-07-02._

## What this is

Operational observability for flat random-graph (RNG-family) datacenter networks. A fork of
**Tessera** (GPU-cluster shard observability) that reuses the same statistical engine
(`@johnpatrickwarren-oss/deploysignal-engine`, git-dep, **never forked**), repointed from
cluster shards to network **path-classes** and physical **fault domains**. It exists to
solve two problems a redundant random-graph fabric creates: monitoring 10^3–10^4 correlated
path-classes without false-positive blowup (→ reuse hierarchical e-values + e-BH FDR — the
aggregation to path-classes is what keeps the e-process count at 10^3–10^4 rather than 10^6
per-microflow, ADR-0001; measured at paper scale, 1,456 leaves, ADR-0025), and
turning "something shifted" into "this shared physical resource is the culprit" on a
topology where hop distance does **not** encode fault domain (→ a new tomographic
localization module). See ADR-0001.

## Phase

**v1 + all post-v1 work through ADR-0042 merged to `main` (PRs #1–#29); no round in flight;
241 tests, gate PASS.** v1: all ten
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
anytime-valid made operational. The recommended post-v1 roadmap is COMPLETE. Round 9
(branch `post-v1-round9`, ADR-0028): the owner ruled on the three queued decisions ("follow the
recommendations") — the Spraypoint traffic model is UNIFIED (this round), epoch wealth carryover
stays deferred, the live-fabric seam doc waits for a real consumer. **198 tests, gate PASS.**
Round 10 (branch `engine-bump-v0.6.0-pre`, ADR-0030): the engine git-dep was bumped
`v0.3.1-pre` → `v0.6.0-pre` (53 commits ahead; resolved commit `b942b5b2`). The bump is
**pin-only** — the 9-import consumption surface is compile-compatible (Safe-Hotelling relocated
but byte-identical and re-exported; `updateBettingState` gained an optional `ar1Phi`), verified
by a clean `tsc` and **198 tests green** against the new tree. No engine surface adopted yet
(e-BH boosting, AR(1)-aware betting, `localizeFaults` are deferred to their own ADRs). Gotcha
recorded in ADR-0030: `pnpm` prints `0.5.0-pre`, but the lockfile SHA is the truth.
Validation-honesty pass (branch `validation-honesty-pass`): an external review prompted a
language softening (README FDR/floor claims re-pinned to what's actually measured — a theorem
conditional on valid e-values + clean-fabric FP=0, not a measured FDR curve; floors flagged as
coarse n=4) and a new top-level **`VALIDATION.md`** that splits the validation into three tiers
(impl invariants / synthetic-model / **external = deliberately empty**). The highest-leverage
in-scope next step — a synthetic sensitivity/degradation study — is sketched in **ADR-0032
(PROPOSED)**; ADR-0031 stays reserved for the ADR-0029 cross-optic Phase 2.
Degradation study (branch `adr-0032-degradation-study`, **ADR-0032 ACCEPTED**): built the
synthetic perturbation harness (`tools/degradation.ts`) + envelope
(`coverage-matrices/degradation-saturation.{json,md}`), perturbing the telemetry the stack sees
along four axes (signal noise, missingness, observation delay, aggregation/weight error) and
re-measuring detection/attribution — n=32/cell, byte-identity-at-zero anchor bound to
`runPipeline`, anti-self-confirming tests (no-op mutant kills 5/11). **Headline finding:** the
dominant failure mode is **silent mis-attribution, not silence** (detection stays ~100% while
attribution collapses), and **signal noise is the sharpest axis** (attribution gone by ~0.5σ of
uncalibrated noise under dilution — motivates ADR-0029). Routing churn deferred-with-rationale
(reuses the ADR-0017/0018 epoch path). **209 tests, gate PASS.** README/VALIDATION.md updated.
Magnitude scorer (branch `adr-0029-magnitude-scorer`, **ADR-0029 Phase 1 ACCEPTED, OPT-IN/DORMANT**):
generalized the tomography member likelihood from Bernoulli(`fired`) to the continuous soft-evidence
LR `μz−μ²/2` (z=√(2·max(ln E,0)), μ=S·L) mixed over (δ,κ,S), activated only via `opts.magnitude` —
the pipeline does NOT pass it (owner-ratified: zero artifact churn; the 209 prior tests unchanged by
construction). Posterior fold + admission gate reused unchanged (cold-eye confirmed no S-leak).
Default preservation holds byte-for-byte **at small q₀**; the cold-eye caught that the magnitude null
is **q₀-blind** and diverges at high q₀ (would blame a fleet-wide event) — re-scoped, divergence
pinned by a recorded fixture, and the q₀-aware null made a **hard prerequisite for the Phase-2 flip**
(ADR-0031). μz-drop mutant kills 3 tests. **218 tests, gate PASS.**
Cross-optic re-add + magnitude Phase 2 (branch `adr-0031-cross-optic-magnitude`, **ADR-0031
ACCEPTED, in-band**): (1) made the magnitude scorer **q₀-aware** (a `(1−q₀)` leak on the unlit
fraction — closes the ADR-0029 divergence: boundary firing at high q₀ is no longer fabricated into a
culprit, while a genuine 4σ shift still is); (2) added an **opt-in `crossOptic`** Spraypoint variant
re-adding partner-optic edges at `1/(nTors−1)` (the ADR-0028 omission; default OFF, marked `sp3:`);
(3) **acceptance bar**: on the cross-optic fabric the magnitude scorer recovers cross-kind optic-3 +
panel-7 **4/4 seeds at δ∈{3–6}** where binary recovers **0/4** — reversing the ADR-0028 rejection.
**Recorded limitation:** at δ≥8 the cross-optic leak saturates the fleet (estimated q₀→0.37–0.70)
and recovery is lost — magnitude is better in-band, equal (both fail) out-of-band, never worse;
z is a monotone ranking proxy (the pipeline feeds an accrued e-value ≈θ√T). Pipeline default flip
deliberately NOT done (anti-scope; production cutover is the next recorded step). q₀-leak + μz
mutants both caught. **221 tests, gate PASS.**
z-calibration (branch `adr-0033-z-calibration`, **ADR-0033 ACCEPTED**): discharged the ADR-0031
z-scale prerequisite. Added opt-in `magnitudeTicks` (z = √(2·max(ln E,0)/ticks) ≈ per-tick θ) and
**measured it end-to-end** — the finding: calibration is a **band tradeoff, not a fix**. Raw
(accrued) z recovers cross-kind at low δ (3–4, 4/4) where calibrated fails (0/4); calibrated recovers
at very high δ (32, 4/4) where raw fails — neither dominates. **Decision: keep RAW accrued z as the
operational default** (the low-δ band is the system's founding purpose — catch subtle faults before
the margin is spent; δ=32 is already a klaxon). Reframes the cold-eye's "miscalibration": z is a
monotone ranking proxy (N1), and which scale ranks best is an operating-point question. Scorer stays
dormant. **223 tests, gate PASS.**
High-δ saturation characterized (branch `adr-0034-high-delta-saturation`, **ADR-0034 ACCEPTED**):
diagnosed the ADR-0031 δ≥8 limitation to **two upstream root causes** — (1) the firing-fraction q₀
(ADR-0016 null) is self-corrupting: a fault's fleet-wide cross-optic leak fires the whole fleet,
inflating q₀ to 0.37–0.70, which then masks the very fault (pinned in test: optic-3 unranked at the
corrupted q₀, recovered at the clean rate); (2) e-values overflow to +∞ at δ≥32, losing magnitude
discrimination upstream of tomography. The obvious fixes are fragile: a q₀ cap only partially recovers
(δ=8: 2→3/4) AND breaks the genuine fleet-wide-event rejection; raising Z_MAX is useless (e-value
already +∞). **Decision: accept the bounded limit** (δ≥8 is an unmissable klaxon; the operating band
δ≈3–6 is solved), with two principled fix directions recorded for future work — a magnitude-
concentration-robust null, and upstream e-value scaling (an engine extension-point request, never
forked). The ADR-0028→0029→0031→0033→0034 arc closes with an honest, characterized boundary.
**224 tests, gate PASS.**
**Production cutover (branch `adr-0035-production-cutover`, ADR-0035 ACCEPTED):** turned the arc on
in production. (A) `assembleAudit` flips the localizer to the **magnitude scorer** (raw z, ADR-0033;
incremental≡batch preserved as both share assembleAudit); (B) `DEFAULT_SPRAYPOINT`/`PAPER_SPRAYPOINT`
set **`crossOptic: true`** — the ADR-0028 omission is retired. **Measured before commit: zero floor
regressions, several improvements** (room attribution Δ=2 0%→75%; shuffle_panel & cross_kind
attribution floors 3→2; fiber_bundle 50%→75%), clean FDR still 0 at paper scale, all faults rank-1
at 960 ToRs. Bind-tests rewritten on the record: the traffic-model keystone is now omission-free
(fabric fully matches the enumeration), the cross-optic test asserts default-on + opt-out, and the
epoch (ADR-0018) + C1 (ADR-0019) tests are pinned to `crossOptic:false` (orthogonal machinery /
distinct phenomenon). demo.html + coverage regenerated. The high-δ limit (ADR-0034) ships bounded.
The default v1 pipeline fabric (`generateFabric`) is unchanged; `crossOptic:false` stays supported.
The **ADR-0028→0029→0031→0033→0034→0035 arc is closed — cross-optic localization is live.**
**224 tests, gate PASS.**
**Expand engine consumption (directive: don't re-engineer what the engine has).** ADR-0036
(branch `adr-0036-consume-engine-common-mode`): **consumed** the engine's contamination-robust
common-mode (`fleet/common-mode` `robustLocation`) as `src/common-mode.ts` `stripCommonMode` — a
compose-layer that strips the robust per-tick cross-leaf common-mode from Tessera's standardized
residuals (calibration + live), opt-in via `commonModeRobust`. **Extends cross-optic recovery
≈δ6→≈δ16** (δ=16: 0/4→4/4), closing most of the ADR-0034 saturation, in-band preserved, clean FDR
still 0 — using engine code, NOT a re-engineered tomography null. Default OFF (no churn,
incremental≡batch holds; session support + default cutover deferred). Gate `no-god-module`
loosened 20→21 on the record (domain.ts type contract, same admitted case as ADR-0017). **231
tests, gate PASS.** Cold-eye: sound, no defect; folded in the Family-A variance asymmetry +
session-footgun notes. Merged via PR #21.
ADR-0037 (engine consumption review — companion to ADR-0036): the other two candidates evaluated
and **decided not to consume**, on evidence. **e-BH conditional-calibration REJECTED** — zero power
boost: Tessera's e-process e-values sit at the Ville bound (`1/x`), so the boost (which needs a
sub-worst-case null tail) has nothing to exploit; the valid Markov fallback is provably zero-gain.
**`fleet/localize` RECONCILED, kept `tomography.ts`** — different problem (engine = per-shard victim
ranking ≈ Tessera's detection+surface; Tessera tomography = the downstream resource-attribution
inverse the engine doesn't do, ADR-0001). Net consumption review: **1 adopted, 1 rejected, 1
reconciled** — consume where the engine adds capability, decline where it adds nothing or subtracts.
ADR-0038 (common-mode session support + default-cutover decision): **session support ADDED** — the
incremental session now strips the per-tick common-mode identically to batch (sorted leaves, same
`robustLocation`), bound by a new incremental≡batch keystone WITH the flag on; **default cutover
MEASURED and REJECTED** — defaulting common-mode ON regresses broad-fault floors (room attribution
3→None, passive_shuffler/power_zone/shuffle_panel detection up a step) and **mislocalizes a room
fault** (room-0→room-1), because a BROAD fault's own signal IS the cross-leaf common mode it strips.
So common-mode is a TRADEOFF (helps concentrated-fault-amid-leak, hurts broad faults) — stays
**opt-in**, not a blanket default. No artifact churn (default OFF). **232 tests, gate PASS.**
Telemetry-realism test network (branch `telemetry-realism-test-network`): a validation question —
"is our null long/deep enough?" — surfaced that the standard 60-tick (2.5-day) null is one
time-sample deep, leans on cross-leaf pooling, and a week-spanning clean run yields **18 false
positives** (FDR=0 was a matched-short-window artifact). Grounded the realistic temporal structure
in real fat-tree measurement (deep-research dive, 23/25 claims verified → `design/research/
telemetry-temporal-characterization.md`): minute cadence, ~2× diurnal, near-zero heavy-tailed loss,
**clustered (non-Poisson) aberrations**, ~4-week robust null (loss-binding). Built the "robust RNG
test network" (`tools/realistic-telemetry.ts`: real weekly signal + clustered aberration injection,
RNG incidence untouched) and validated our work against it. **Two findings, pinned:** (GOOD) the
per-cell calibration HANDLES realistic weekly seasonality (0 FP once the null spans the week);
(GAP) our **mean/sd calibration is NOT robust** to the clustered aberrations that always happen —
contaminated history manufactures false positives (34 vs 0). **Next attention: a robust calibration
estimator** (the engine ships one — the next consumption). ECMP excluded from extrapolation
(topology-specific); retransmit/flow-completion are proxies (largest evidence gap). **237 tests, gate PASS.**
Robust calibration + deep-null rebaseline (branch `adr-0039-robust-calibration`, **ADR-0039 ACCEPTED**):
closed the telemetry-realism gap. (1) Per-cell null now estimated **robustly** (engine `robustLocation`
+ MAD) by DEFAULT instead of mean/sd — clustered aberrations are tossed, not absorbed (gap closed:
contaminated history 32 FP → **0**; unbiased on clean, median scale ratio 1.000; clean FDR 0 via robust
min-cell-samples=50). (2) **Decoupled** the calibration window from the live window (`calibrationTicks`
— calibrate long, detect short, as real systems do). (3) **Rebaselined the coverage matrix at a ~2-week
robust null**: 20 of 24 floor entries unchanged, clean FDR 0, paper-scale clean 0 — **cost (corrected
per cold-eye, first draft undercounted): FOUR detection floors +1 step** (passive_shuffler, room,
mean_shift, and Family-C covariance_flip 0.2→0.4 — a DOUBLING), plus room Δ=2 attribution 0.75→0. The
cost is ONE-SIDED on the aberration-FREE synthetic (robust pays its MAD-efficiency cost, earns none of
its robustness benefit); on real aberration-laden telemetry robust is strictly better (mean/sd → 32 FP).
Realistic-regime coverage (branch `realistic-coverage-regime`, **ADR-0040 ACCEPTED**): converted that
one-sided cost into the published WIN — added a realistic-regime FDR section to the coverage matrix
that builds the null from aberration-laden history: **mean/sd false-positives 434 / 4 trials, robust 0**.
The coverage now shows the tradeoff whole (clean-data cost AND realistic-data win). Honest caveats:
aberration intensity is a modeled parameter (the 434 scales with it; robust's 0 is invariant), the
aberration model is crude (uniform additive — realistic for p99, not near-zero loss). **240 tests, gate PASS.**
Common-mode default RE-OPEN under the robust null (branch `commonmode-default-under-robust`, **ADR-0041
ACCEPTED, no behavioral change**): ADR-0039's robust-default null changed ADR-0038's specific
room-0→room-1 mislocalization, so the default-cutover question was re-opened. The single-fault probe
looked promising (room-0 Δ=3 rank-1 stayed correct under common-mode ON), but the FULL coverage sweep
(common-mode default ON + robust, diffed across ALL structures incl mode_floors) showed the broad-fault
regression PERSISTS — room attr 3→None, power_zone det/attr 1→2, shuffle_panel det/attr 2→3, room Δ=4
attr 4/4→0/4. **Common-mode stays OPT-IN; ADR-0038 reaffirmed under the robust null.** The benefit is
intact (still lifts cross-optic δ=8: 2→4, δ=16: 0→4 — the right opt-in tool, not a default). Pinned by
a RE-OPEN test. Methodological lesson recorded: the single-fault probe + the changed pinned-test misled;
the full sweep (the ADR-0039 cold-eye's mode_floors lesson) gave the right answer. **240 tests, gate PASS.** 3 calibration-orthogonal tests pinned to `robustCalibration:false`
(common-mode demo, ANYTIME profile, C1 saturation); demo + coverage regenerated; coverage prose
de-hard-coded. The "FDR=0" claim is no longer a matched-short-window artifact (the deep null covers the
full week). Follow-ups: AR-model robustness, 4-week null for real incident exclusion. **240 tests, gate PASS.**
Telemetry-realism follow-ups investigated — NONE shipped (branch `realistic-coverage-followups`,
**ADR-0042 ACCEPTED, zero code change**), anti-gold-plating + halt-on-contradiction throughout:
(1) PER-METRIC aberrations PROTOTYPED then REVERTED on a FALSE PREMISE the cold-eye caught — the
synthetic signals are ABSTRACT (sd≈1, base [10,0.5,0.1,0.2,0.99], measured ranges ~[-4,6], routinely
negative), NOT physical [0,1] rates, so the "+12 on loss" I called absurd is +12σ (sensible) and the
[0,1] clamp would crush ~53% of the clean baseline. The uniform σ-scale model was already defensible;
realistic-regime stays 434/0 (ADR-0040 unchanged). (2) AR-model robustness PROTOTYPED & REVERTED — the
order-inflation artifact is real (clean p=1 → laden p=5) but winsorizing changed NO detection metric
(the robust baseline already neutralizes the bursts' leverage). (3) 4-week null RECORDED as a
real-deployment parameter (faking synthetic recurring incidents to "demonstrate" it would be theater).
(4) Tier-3 real telemetry REAFFIRMED permanently external. The heavy-tailed-marginal gap remains a
recorded limitation, not gold-plated. **241 tests, gate PASS (unchanged from main).**
Claims-honesty pass (branch `round-a-claims-honesty`, **ADR-0043 ACCEPTED, docs only**): a
literature deep-dive (tomography theory, production DC systems, anytime-valid SOTA) prompted three
claim fixes: (1) the Writings piece's "10³ to 10⁶ leaves" e-BH claim re-pinned to the AC-1 bound
(10³–10⁴ path-class leaves; 10⁶ is the microflow count aggregation avoids); (2) GROW/growth-
optimality claims grepped — none exist; recorded that any future Family-C optimality language must
carry the GL(d) non-amenability qualification (Pérez-Ortiz et al. AoS 2024); (3) the ADR-0027
every-tick-query narrowing pinned to its exact boundary: stopped e-BH (arXiv:2502.08539) licenses
anytime FDR only for independent streams or under a no-unobserved-confounding condition our
correlated leaves haven't been shown to satisfy, and finite-ARL + nontrivial worst-case streaming
FDR is impossible (arXiv:2501.04130) — the controllable streaming metric is error-over-patience,
a recorded future adoption alongside e-detector form. **241 tests, gate PASS.**
Combiner filtration boundary + Family D null fix (branch `round-b-filtration-familyd`, **ADR-0044 +
ADR-0045 ACCEPTED**): the Choe–Ramdas cross-filtration question was investigated with an evidence
experiment. ADR-0044 (no behavior change): Family D's wealth is provably NOT a tick-filtration
supermartingale (pinned by test — conditioning on 39 of a window's 40 ticks inflates the expected
multiple), but its own fire rule keeps its exact Ville bound (wealth constant between boundaries),
every published figure is a fixed-time read (exactly valid), and the combined leaf value at an
arbitrary stopping time degrades to the K/c union bound — stated in detect.ts/session.ts; the
adjuster upgrade is recorded, not built. The experiment surfaced a BIGGER defect (halt honored):
the raw Gaussian null over-pays on the right-skewed peak-|ACF| statistic — **E[L] = 1.121 ± 0.017
per clean window (held-out), anytime false-alarm 1.3% vs the claimed ≤1%**. ADR-0045 (behavioral,
default ON): `estimateFamilyDNull` ships sorted calibration peaks and the shared update path bets
on the PIT-Gaussianized rank statistic u = Φ⁻¹(rank/(n+1)) — an e-value by EXCHANGEABILITY, no
distributional assumption; measured E[L] = 1.018 ± 0.010, anytime false-alarm 0.55–0.63% ≤ 1%,
floor-amplitude power unchanged (99%). Cost published: oscillation floor stays 0.9; the sub-floor
amp-0.7 knee drops 75%→25% (the invalid over-payment taken back). Raw path kept as the pinned-
defect control; demo + coverage regenerated. **246 tests, gate PASS.**
Linear magnitude member model (branch `round-cd-linear-magnitude`, **ADR-0046 ACCEPTED, production
cutover**): the tomography member model becomes the exact Gaussian mean model on the t-statistic
scale — per selected leaf y = max(t, z(E)) with t = max_j |Σ residual_j|/√T (unsaturated; the
session keeps byte-identical running sums), member LR μ(y−m)−μ²/2 with μ = θ·w·√T over the fixed
θ grid {¼..128} (1/θ prior), null y ~ N(0,1) — **q₀-FREE: both ADR-0034 root causes dissolve**
(no scalar null to corrupt; nothing overflows). Marginal cover: score by mixture, fold by ML
refit (Deepview post-selection-refit composition; a grid-quantized fold measurably admitted
mop-up picks), rank-≥2 picks pay a ln R look-elsewhere charge (rank-1 exempt — e-BH already
certified the evidence; charging it converted weak-but-correct attributions to abstentions,
measured). A virtual `__fleet__` candidate (w=1 everywhere, kind `fleet_common_mode`, never
drained) absorbs uniform fleet events structurally — safe for broad faults (quiet leaves cost
the fleet μ²/2 the room doesn't pay; the ADR-0038 strip-regression cannot recur — nothing is
stripped, models compete). **Measured: cross-kind recovery 4/4 at EVERY δ∈{3..32}** (z scorer:
0/4 at δ≥16; common-mode's old ceiling was δ16) — **the ADR-0034 bounded limit and the ADR-0036
payoff role are retired on the record**; C1 δ=128 exact minimal set (z gave wrong-kind rooms);
room dilution attribution floor **3→2** (Δ=2: 0%→100%, and z's 2/4 included a wrong-room rank-1);
zero floor regressions; sub-floor knee flips recorded honestly (optic Δ=1 attr 75→50, fiber Δ=1
50→25, cov 0.2 50→0, osc 0.7 25→0). Epoch'd runs keep the z currency (recorded narrowing).
Two design iterations forced by measurement recorded in the ADR (θ-grid low end; ML fold + charge).
demo + coverage regenerated; keystones hold. **255 tests, gate PASS.**

## Built so far

- **Scaffold** — `pnpm` + `tsc` + `node --test` toolchain mirroring Tessera (tsconfig.json,
  tsconfig.test.json, .npmrc, .gitignore). Product → `src/`, tests → `test/`, demo →
  `demos/`, honest-measurement → `coverage-matrices/`, decisions → `design/`.
- **Engine git-dep proven** (halt-check #1) — `deploysignal-engine` installs and imports
  cleanly; `test/smoke-engine-import.test.ts` exercises Family A betting e-process, Welford
  per-shard runtime, hierarchical combine, e-BH FDR, and snapshot hashing — **5/5 green**. (One
  smoke assertion initially encoded the e-BH threshold wrong; the engine was right, the test was
  fixed — confirming the engine isn't rubber-stamping.) Pin is now **`#v0.6.0-pre`** (ADR-0030);
  originally proven at `#v0.3.1-pre`.
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

## Post-v1 round 9 (branch `post-v1-round9`, off merged main)

- **Unified Spraypoint traffic model** (ADR-0028, closes the ADR-0026 divergence): ONE
  elementary flow space — (unordered ToR pair, panel), uniform; one panel per flow, both
  endpoint optics — now derives BOTH the fabric's view weights and the drill's pair exposures:
  pp optic 1/nTors → **2/nTors**, pp panels w=1 → **1/2 each**, pp rooms conditioned on the
  panel pair (1 same-room, 1/2 split), tor rooms = **panel share** (empty rooms get no edge);
  `source_version: sp2`. The KEYSTONE test enumerates the space and recomputes every view
  weight AND every drill exposure independently of the closed forms (exact agreement, default +
  asymmetric fabrics; a cross-module drill-convention mutant dies on it). ONE recorded
  narrowing, bound by its own test from both sides: tor-leaf cross-optic exposure (true
  P = 1/(nTors−1)) is deliberately NOT an edge — the full-support variant was built and
  MEASURED first and collapsed cross-kind multi-fault localization and the high-δ sweep
  (binary fire/quiet scorer drowns in 63 quiet 1/63 members; numbers in the ADR); revisit only
  together with a magnitude-aware member model (recorded future work). Floors republished from
  measurement (the owner-anticipated grid step): shuffle_panel 2/3 (was 1/2), room 1/3 (was
  1/2), cross_kind 2/3 (was 1/2); optic, same_kind unchanged; pinned δ-band and C1 closure
  survive (margin 33.3 → 33.7); the legacy-flip control retired on observation. Paper-scale
  values unchanged (existing edge support kept, 513,552 edges).

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
HALT was resolved by the owner in ADR-0015 (aggregation-view leaves). The round-7 cold-eye's
traffic-model divergence was RESOLVED by round 9 (ADR-0028, owner-authorized): one flow space,
floors republished, with one recorded test-bound narrowing (tor cross-optic exposure) awaiting
a magnitude-aware scorer. Remaining owner-deferred items: epoch wealth carryover (keep
deferred until real-fabric reconvergence data says otherwise), live-fabric adapter seam doc
(write when a real consumer appears).

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
