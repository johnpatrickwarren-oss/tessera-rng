# Handoff — post-v1 round 3 (RNG-paper work order), mid-round

Self-contained handoff for resuming round 3. Written at the item-3 decision point;
the leaky-LLR WIP is in the working tree, deliberately uncommitted pending the owner's
Q1/Q2/Q3 answers (§ DECIDE FIRST). Verified on resume 2026-06-10: 121/121 tests green
with the WIP.

## Orient (read in order)

- `STATE.md` — cold-readable "now".
- `design/adr/0001..0015` — decisions. Round 3 is 0013 (paper reconciliation),
  0014 (weighted incidence), 0015 (Spraypoint two-view leaves). 0016 (leaky-LLR scorer)
  is IN PROGRESS, not yet written/committed.
- `design/spec/v1-spec.md` — AC-1 amended (leaf = aggregation-view class), AC-8 (eight scenarios).
- `DISCIPLINES.md`, `arch-gate-usage.md`, `README.md`.
- The external work order this round implements is items 1–5 of "post-review work order —
  RNG-paper reconciliation + tomography noise-model upgrades".

## Where you are (git)

- Branch `post-v1-round2`; PR #2 (post-v1-round2 → main) is OPEN and accumulating round-2
  AND round-3 commits. main = round-1 (PRs already merged). Repo is PUBLIC.
- Committed round 3: 906b563 (ADR-0013), 4a1befb (ADR-0014), 3703f30 (ADR-0015).
- UNCOMMITTED item-3 WIP (the leaky-LLR scorer) is in the working tree:
  `src/{tomography,surface,verdict,pipeline}.ts` + `test/{tomography,drain,verdict}.test.ts`.
  121 tests pass WITH the WIP. Nothing for item 3 is committed — it awaits the
  § DECIDE FIRST call.
- Commit/push each increment.

## Commands

- `pnpm install` ; `pnpm test` ; `pnpm typecheck` ; `pnpm demo` ; `pnpm coverage`
- Gate: `node ../sprag/arch.mjs check . --invariants arch-invariants.json --baseline-in arch-invariants.baseline.json`
- Mutation (new math only): `node ../sprag/arch.mjs mutate src --test "pnpm test" --all --max-mutants 40 --exclude '<all other src basenames as **/x.ts>'`
- Engine API: `node_modules/@johnpatrickwarren-oss/deploysignal-engine/dist/**/*.d.ts`

## What round 3 has settled (done, committed)

- **ADR-0013**: arXiv:2604.15261 is REAL and was self-fetched/verified (quasi-random
  expander, d=64, max path 5, >50 edge-disjoint paths, Spraypoint ECMP+waypoints,
  ShuffleBox 32×4=4×32, 960 ToRs / 61.4K servers). It confirms P2 (hop distance dead) but
  treats telemetry as out of scope → the five-signal contract stays a working assumption,
  UNFALSIFIED, NOT validated. Do not claim validation.
- **ADR-0014**: weighted/fractional incidence. `FaultDomainEdge.weight ∈ (0,1]` (absent ⇒ 1
  ⇒ byte-identical v1). Telemetry dilutes a fault by delta·w; tomography gain weighted;
  hash+validation carry weight. Weighted tomography held 100% mutation.
- **ADR-0015** (owner-resolved HALT item 5): the leaf is an AGGREGATION-VIEW CLASS — union
  of a `per_tor` view (~nTors) and a `per_panel_pair` view (~C(nPanels,2)),
  `src/spraypoint.ts`, ~109 leaves at the 64×10×2 default. Owner's framing: the scale
  problem is per-leaf HETEROGENEITY (misspecified shared baselines), not sample budget;
  aggregating m fault-sharing leaves cuts noise by √m. The two views have COMPLEMENTARY
  blind spots (optic→per_tor, panel→per_panel_pair, room→both), published as a per-view
  coverage column. Views are dependent; e-BH/AoE handle it. ToR-pair stays the underlying
  entity. `shuffle_panel`/`room` kinds added.

## DECIDE FIRST — the active blocker (item-3 leaky-LLR scorer, ADR-0016)

The owner directed: replace the linear tomography gain (gain = Σnewly·w − λ·Σquiet·w) with
a leaky noisy-OR mixture log-likelihood-ratio scorer, to fix the cold-eye CRITICAL "C1"
cross-view rank flip on the Spraypoint fabric (a strong optic fault leaks into the
`per_panel_pair` view and a coarse resource out-explains the true optic, flipping rank-1).
Spec given by the owner and IMPLEMENTED in the WIP exactly as specified:

- q₀ floored fleet base rate at the surface: q₀ = (|selected| + ½)/(|leaves| + 1)
  (`src/surface.ts`).
- Per member i: clean P(fire)=q₀; faulty P(fire)=q₁ᵢ(δ)=q₀+(δ−q₀)·wᵢ ; MIX over
  δ∈{0.3,0.6,0.9} (average per-δ likelihoods, then LLR vs null). Greedy set-cover on
  LLR>0. Subsumes collateralWeight. Linear scorer kept ONLY as the failure-mode control
  (`opts.legacy`).
- Culprit gains `supporting_views` (per-view concurrence, DISPLAYED metadata not the
  mechanism).
- Composite/pseudo-likelihood framing (independence across overlapping-view leaves is an
  approximation valid for RANKING, aligned with `correlational_not_causal`).

**EMPIRICAL CONTRADICTION (verified, halt-on-contradiction):** the LLR holds optic-3
rank-1 at realistic δ (4,16) — same as before, no leakage there — but it DOES NOT fix the
flip at δ≥64. The owner's predicted mechanism (the coarse resource's many quiet per-ToR
members "bury" it via falsification) is empirically FALSE: at high δ the optic fault
lights up the ENTIRE per_panel_pair view (all 45 pair leaves fire), so a room/panel has
~23 FIRING members at w=1 there — overwhelming evidence the per-ToR falsification
(63 quiet at w≈0.5, or 32 at w=1) cannot outweigh. Sweeping q₀ confirms NO value fixes it:
surface q₀≈0.42 (inflated because the selected set is dominated by TRUE positives) →
panel-0 wins; q₀∈{0.05,0.01,0.001} → room-0 wins with huge scores. The rooms→ToR-w=1
prerequisite was checked and does not change the outcome. Root cause is STRUCTURAL:
tor-3's per-ToR firing causally explains away the pair-view firing (same physical optic),
but no per-resource scorer on this incidence can see that cross-view dependence; and the
optic genuinely carries the pair leaves at w=1/64, so it is not the likelihood-best
explanation of the pair-view firing.

**THREE QUESTIONS FOR THE OWNER** (modeling/contract forks — not picked unilaterally):

- **Q1 (C1 residue).** The owner's own fallback allows "(c) document + pin the residue" if
  a high-δ band survives — and the realistic regime IS fixed. Accept (c): pin the
  realistic regime (LLR holds optic-3 up to the dilution-leakage threshold, ~δ≤16 here)
  and DOCUMENT the high-δ cross-view ambiguity as a recorded limitation of
  union-of-dependent-views localization? OR invest in the STRUCTURAL "explain-away" fix
  (discount a leaf's contribution to a resource when a higher-weight resource in another
  view already explains the same underlying flow)? The explain-away fix is the only thing
  that actually closes it, and it's a meaningfully larger build.
- **Q2 (q₀ model).** Keep q₀=(|selected|+½)/(|leaves|+1) (it inflates to 0.42 at high δ,
  signal-absorbing), or switch the null to the FDR target q (the e-BH bound on a clean
  leaf's selection rate, which does NOT inflate with the fault)? Recommend at least
  testing q₀=q.
- **Q3 (LLR disposition).** The LLR is built, green (121 tests), and is a real improvement
  for the realistic + binary-fabric attribution regime (its original item-3 goal)
  regardless of C1. Keep it as the default scorer (linear as control) and commit it now
  with C1 handled per Q1/Q2, OR hold the entire item-3 commit until C1 is settled?

**Once decided:** finish item 3 = ADR-0016 (record the LLR + the C1 resolution + the
composite-likelihood caveat + whatever (c)/explain-away/q₀ choice was made) +
anti-self-confirming tests (the δ-sweep is the fixture: old/linear scorer flips at δ=128,
the LLR must hold optic-3 across whatever band the owner pins; the "spurious winner from
nothing" variant; an adversarial one-view-vs-both-view double-count fixture per the
owner's check — if rank-distorted, the minimal fix is dividing each leaf's
log-contribution by view multiplicity, else record the negative finding and add no knob) +
mutation pass on the LLR (keep the solver's 100%) + a fresh-context cold-eye + green gate.
Also fold in cold-eye L1: `validateFaultDomainSnapshot` currently DROPS operator-supplied
`views` (so an operator two-view fabric loses its replay hash) — parse/validate `o.views`,
with a test.

## Then: item 4 (the largest) — incidence churn / routing reconvergence epochs (ADR-0017+)

Spraypoint is link-state and reconverges; incidence changes mid-stream. v1-compatible
slice, N2 intact (synthetic-event-driven only — NOT a live fetchSnapshot):

- FaultDomainSource → a SEQUENCE of epoch'd snapshots (snapshot + valid-from tick + hash).
  NOTE (cold-eye L-forward): epochs will version the VIEW DEFINITIONS from ADR-0015 too —
  handle that.
- Synthetic "reroute event": at tick T a configurable fraction of path-classes traversing
  a named resource remap to alternates (a drain/reconvergence).
- Pipeline epoch-aware: on epoch change, affected leaves' e-processes RESET (wealth reset)
  and the audit RECORDS the reset — a deliberate, recorded power loss
  (instrumented-caveat), not silent. Smarter carryover is future work; do not build it.
- Tomography runs against the epoch the firing evidence accrued in.
- Tests: (i) reroute with NO fault selects nothing (the critical false-fire guard);
  (ii) fault + subsequent reroute still localizes from pre-reroute evidence;
  (iii) replay-clean across epochs.
- May decompose into >1 ADR (source epochs vs detector epoch-awareness); decompose if so.

## Hard-won gotchas (don't relearn)

- Gate runs over '.', but `require_tests` is scoped to src/ by BASE NAME; only GIT-TRACKED
  files count → `git add -A` before the gate or new files are invisible. Complexity cap
  12; keep functions small (extract helpers; the cap bit telemetry/coverage already).
- Determinism (AC-9): seeded LCG (`src/rng.ts`) only — NO Date.now/Math.random/new Date;
  sort before emitting; runPipeline is async; replay tests assert byte-identical JSON. The
  snapshot hash now includes edge weight (??1) and views (ADR-0014/0015) — weight-1≡absent
  so v1 is byte-stable; demo.html embeds the hash so regenerate it after any
  hash-format change.
- Mutation oracle MUST be `"pnpm test"` (recompiles via pretest); `node --test` alone
  tests stale .js.
- N5: engine ONLY via package name (subpaths ok, no `_`-prefixed internals:
  _linalg/_q72-trace are off-limits — that's why `src/covariance.ts` re-implements
  cholesky/logDet). N2: no node:fs/net/http in src/ (file IO lives in tools/). N1: no
  root_cause surface; every culprit carries `correlational_not_causal`; unexplained set
  always reported.
- Don't `cd` into node_modules (it repoints pnpm at the engine's package.json). Run pnpm
  from repo root.

## Stop conditions (need outside input — flag, don't attempt)

- The three § DECIDE-FIRST questions (Q1/Q2/Q3) — owner modeling/contract calls.
- Item 5 is DONE (owner-resolved). Live-fabric validation (N2), real drain wiring (N4),
  hardware root-cause (N1), engine forking (N5) — all anti-scope. Item 4's epochs are
  synthetic-event-only and do NOT open a live fetchSnapshot.
- Whether to merge PR #2 / open a separate round-3 PR — owner's call (not yet authorized).

Start by getting the owner's Q1/Q2/Q3 answers, then finish item 3 (ADR-0016) and proceed
to item 4.
