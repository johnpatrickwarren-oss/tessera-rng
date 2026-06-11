# Handoff — post-roadmap (rounds 1–8 complete), 2026-06-11

Self-contained resume prompt for the next session. Written at a TRUE STOPPING POINT: the
recommended post-v1 roadmap is complete and merged; no round is in flight; the working tree is
clean; everything remaining is an owner decision.

## Orient (read in order)
- STATE.md — the cold-readable "now" (current: rounds 1–8 merged via PRs #1–#8, 192 tests, gate PASS).
- design/adr/0001..0027 — one ADR per decision. The arc: 0013–0018 (paper reconciliation, weighted
  incidence, two-view leaves, leaky-LLR, epochs), 0019 (saturating noisy-OR — closed C1), 0020–0024
  (dilution/multi-fault floors, tiered drains), 0025/0026 (paper scale, ToR-pair drill-down),
  0027 (incremental session — anytime made operational, keystone: incremental ≡ batch byte-for-byte).
- DISCIPLINES.md, arch-gate-usage.md, README.md (current through round 8).

## Where you are (git)
- `main` = everything (last merge: PR #8, docs). Branches post-v1-round2..8 merged; repo PUBLIC.
- Round rhythm: branch `post-v1-roundN` → spec-first ADR → build + anti-self-confirming tests →
  mutation on new math → bare-exit gate → fresh-context cold-eye → fold-in commit → PR → merge.
- Commit messages end with: Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

## Commands
- pnpm install ; pnpm test ; pnpm typecheck ; pnpm demo ; pnpm coverage (~45s, regenerates the
  freshness-bound artifacts)
- Gate: node ../sprag/arch.mjs check . --invariants arch-invariants.json --baseline-in arch-invariants.baseline.json
  — run BARE and check its own exit code; NEVER pipe through tail/grep inside && chains (exit
  masking shipped a violating commit once; recorded in c8c7d56).
- Mutation: node ../sprag/arch.mjs mutate src --test "pnpm test" --all --max-mutants 60 --exclude
  '<comma-separated globs, ONE flag>'. Mutates src/ IN PLACE: never edit/stash/commit during a
  run; verify `git diff` clean after; the generated operator set has NO index-constant mutants —
  hand-apply those for selection/index logic (the ADR-0018 C1 lesson).

## The three OWNER DECISIONS (the whole remaining queue), with recommendations
1. **Unify the Spraypoint traffic model** (ADR-0026 cold-eye; queued in STATE). The fabric's
   leaf-local view weights and the drill's flow-level exposures diverge by 2× conventions, and
   the fabric is internally mixed (tor leaves: one-panel-per-flow; pp leaves: two-panel w=1).
   RECOMMENDED: do it as round 9, evidence-gated — pick ONE flow model (the drill's
   one-panel-per-flow + both-endpoint-optics is the physically cleanest for a single-stage
   shuffle), derive ALL view weights from it, re-run δ-sweeps/floors, re-pin observed bands,
   regenerate artifacts. Expect: snapshot hashes change, pp-leaf weights change (optic 1/nTors →
   2/nTors; panel w=1 → re-derived), pinned δ-bands and floors move a grid step. Do it BEFORE
   external consumers rely on the published floors.
2. **Epoch wealth carryover** (ADR-0018 deferral). RECOMMENDED: keep deferred. The recorded
   reset is honest and visible; the power loss touches only mid-window-changed leaves and
   re-detection is fast (bound in tests). No obviously-valid carryover exists: naive carryover
   breaks e-validity exactly when the post-change null shifts (the reason for resetting), and a
   hedged mean-of-(continued, fresh) inherits the same doubt. Revisit only if real-fabric data
   shows reconvergence so frequent that reset power loss dominates.
3. **Live-fabric adapter seam** (N2 boundary). RECOMMENDED: types/docs only, when a real
   consumer appears. The seam ALREADY exists as code: FaultDomainSource + calibrateForSession +
   openSession/ingest/audit (full-tick contract). A short design/spec doc stating the adapter
   contract + amending N2's wording ("no live I/O in this repo; adapters live out-of-repo
   against the documented seam") is a half-day docs item. Building I/O here stays anti-scope.

Minor recorded-not-built (no rounds needed): k≥3 simultaneous-fault floors; the residual
free-rider window when a picked set explains nothing past ½; same-tier cross-group drain-score
mixing beyond tier-1; partial/missing-leaf ingest ticks.

## Hard-won gotchas (beyond the memory file)
- Freshness binds: demos/demo.html is byte-bound; coverage-matrices spot-checks #1–#4. Any
  scorer/model change ⇒ `pnpm demo && pnpm coverage` or the suite fails (by design).
- Determinism: seeded LCG only; no Date.now/Math.random in src/; tools/coverage publishes only
  DETERMINISTIC values (wall-clock lives in ADRs).
- Complexity cap 12 bites accreting functions (renderMarkdown twice); extract helpers early.
- python-replace refactors: replace the CALL SITE before inserting a helper containing the same
  pattern (self-recursive-stub incident, recorded).
- The owner edits design/*.svg concurrently — check `git status` before `git add -A` sweeps.

## Stop conditions
- The three decisions above are the owner's; do not pick unilaterally (recommendations stand).
- N1/N2/N4/N5 anti-scope unchanged. Engine via package name only, no `_`-internals.
