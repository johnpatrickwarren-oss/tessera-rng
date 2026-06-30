# ADR 0038 — Common-mode: session support ADDED, default cutover REJECTED on evidence

- **Status:** ACCEPTED. The ADR-0036 common-mode flag now works on the **incremental session**
  (byte-identical to batch — keystone bound). The **default cutover was measured and REJECTED**:
  defaulting common-mode ON regresses broad-fault floors and *mislocalizes a room fault*. It stays
  OPT-IN. 232 tests green, gate PASS.
- **Date:** 2026-06-29
- **Decision owner:** Tessera-RNG (post-v1; the requested "default cutover + session support")
- **Relates to:** ADR-0036 (the consumed common-mode), ADR-0027 (incremental≡batch keystone),
  ADR-0034 (the saturation common-mode lifts), ADR-0035 (the magnitude cutover this is NOT like).

---

## Context

ADR-0036 consumed the engine's contamination-robust common-mode opt-in, deferring two follow-ups:
session support and the default cutover. This round does both — and the cutover measurement changed
the decision.

## Part 1 — Session support: ADDED (incremental≡batch preserved)

`IncrementalSession.ingest` now strips the per-tick robust common-mode across leaves when
`commonModeRobust` is set. The shared primitive `stripCommonModeTick` processes leaves in **sorted id
order** (same `robustLocation`, same input) as the batch `stripCommonMode`, so the streaming and
batch residuals are bit-identical. Bound by a new keystone: `incremental ≡ batch byte-for-byte WITH
opt-in common-mode removal` on a high-δ cross-kind fault (where common-mode genuinely changes the
result — not a trivial pass). Calibration and live both opt in via the same flag; both default OFF,
so the default path and all existing keystones are byte-unchanged.

## Part 2 — Default cutover: REJECTED on the evidence

**Measured** (regenerate coverage with `commonModeRobust` defaulted ON, compare to committed):

| floor | OFF (committed) | ON (default cutover) |
|---|---|---|
| room detection | 1 | **2** (worse) |
| room attribution | 3 | **None — lost** |
| passive_shuffler detection | 1 | **2** |
| power_zone detection / attribution | 1 / 1 | **2 / 2** |
| shuffle_panel detection / attribution | 2 / 2 | **3 / 3** |
| cross_kind multi-fault attribution | 2 | **3** |

**Zero improvements; multiple regressions.** And worse than weaker — it **mislocalizes**: a room-0
fault at δ=3 goes from `rank-1 = room-0` (correct, 97 leaves) to `rank-1 = room-1` (WRONG, 18 leaves)
under common-mode removal.

**Root cause (fundamental, not tunable):** common-mode removal strips the robust cross-leaf *shared*
shift. A **broad** fault (room / zone / panel — affecting many leaves) **IS** that shared shift, so
removing it deletes the fault's own signal and leaves misleading structure. Common-mode helps a
**concentrated** fault hidden under a broad leak (the ADR-0034 cross-optic high-δ case); it **hurts**
a genuinely broad fault. ADR-0036's payoff measurement only covered the cross-kind concentrated case,
not the single broad-fault floors — this round measured the rest and found the tradeoff.

**Decision: do NOT default it.** Unlike the ADR-0035 magnitude cutover (strictly non-regressing,
several improvements), common-mode is a genuine **tradeoff**. It stays opt-in, for callers who know
they are in the concentrated-fault-amid-leak regime (e.g. high-δ cross-optic saturation suspected).

## Anti-scope (must-never)

- **No blanket default** — it regresses broad-fault detection and mislocalizes. Opt-in only.
- **No per-fabric / per-fault auto-enable heuristic** — that would be a fitted knob choosing when to
  strip; if a future round wants conditional enablement it goes through an evidence-gated ADR.
- **Session opt-in must match calibration opt-in** — a `ctx` calibrated one way fed to a session the
  other way mis-calibrates the detectors (documented at both call sites; both default OFF).

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test |
|---|---|
| Session strips identically ⇒ incremental≡batch under common-mode | `session.test.ts` KEYSTONE (ADR-0038) — byte-equality on a high-δ cross-kind fault |
| Default unchanged (opt-in) | `common-mode.test.ts` "default ≡ explicit-off"; coverage regenerates byte-identical with default OFF |
| The rejection rationale is recorded, not silent | this ADR + the measured floor table + the room-mislocalization probe |

## Cold-eye fold-in (fresh-context review)

Verdict: session support byte-sound (incremental≡batch holds *for the right reason* — both paths force
identical sorted-leaf input into `robustLocation`, not luck); cutover-rejection honest and
mechanistically correct (the 3-pass `ingest` restructure is semantically identical — leaves are
independent except the intentional pass-2 strip; default revert complete at all three entry points).
Two non-blocking caveats addressed/recorded:

- **(addressed)** the rejection was ADR-only testimony (the ON-default measurement was reverted, nothing
  committed pinned it). Now bound by a test — `WHY NOT DEFAULT (ADR-0038)`: a room fault localizes to
  room-0 with common-mode OFF and does NOT with it ON. The rejection is reproducible from the tree.
- **(recorded follow-up)** the calibrate↔session opt-in mismatch is a documented-but-UNENFORCED silent
  footgun: `ctx` (DetectorContext) carries no flag to assert against, so a mismatched pair yields a
  valid-looking but mis-calibrated audit. Documented at all three call sites; a runtime guard would
  need the flag threaded into `ctx` — deferred (opt-in advanced usage; both default OFF).

## Consequences

- The common-mode capability is now **complete and consistent across batch and streaming** — opt-in,
  with incremental≡batch preserved. A caller facing the ADR-0034 saturation can turn it on end-to-end.
- The "expand consumption" line is honestly bounded: the consumed common-mode is a **targeted tool**,
  not a global default — the cutover request was answered with a measurement that said *don't*.
- No artifact churn: demo, coverage, hashes, floors all byte-unchanged (default OFF).
