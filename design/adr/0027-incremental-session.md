# ADR 0027 — Incremental session: anytime-valid made operational

- **Status:** Accepted
- **Date:** 2026-06-10
- **Decision owner:** Tessera-RNG (post-v1 round 8 — owner-authorized autonomous round)
- **Supersedes:** — (`runPipeline` stays; the session is the streaming face of the same math)

---

## Context

Every statistical component is anytime-valid (betting e-processes, Safe-Hotelling, the spectral
e-detector, e-BH at arbitrary stopping rules) — but the harness is batch: `runPipeline`
recomputes a whole fixed window, so "anytime" is a property of the math, not of the system. An
operator cannot feed ticks as they arrive and ask "what's firing *now*?".

## Decision

`src/session.ts` — `openSession(params)` returns an incremental session:

- **`ingest(tickByLeaf)`** — one tick of raw signal vectors for all leaves. Standardization is
  per-tick: per-cell de-mean (stateless given the calibration substrate) + AR(p) pre-whitening
  via a last-p lag buffer replicating the engine filter's exact convention
  (`innov_t = x_t − Σ_{k≤min(t,p)} φ_k·x_{t−k}`, probed). Detector states update in place:
  Family A per-signal betting states, Family C Safe-Hotelling state (both engine-incremental
  already), Family D per-signal window buffers (a completed non-overlapping window feeds the
  spectral state; partial windows wait, exactly the batch chunking).
- **`audit()`** — an `AuditRecord` at ANY tick: verdicts assembled from live states, then the
  SAME tail as the batch pipeline — `assembleAudit` is extracted from `runPipeline` and shared,
  so surface/e-BH, per-evidence-epoch localization, tiered drains, and the epoch/reset fields
  are one code path, not a copy.
- **Epochs**: reroute boundaries reset the affected leaves' detector states at ingest time
  (completed segments stored, AR/noise state deliberately continuous — the ADR-0017/0018
  semantics); a mid-stream audit reports the current segment as partial (`to_tick` = now).
- **Calibration stays batch** (a session opens WITH a substrate built from a clean window —
  matching operations: calibrate offline, stream live). Recorded narrowing, not a gap.

## The binding contract: incremental ≡ batch

The keystone test: feed the batch pipeline's exact live telemetry tick-by-tick and the final
`audit()` must equal `runPipeline`'s audit **byte-for-byte** — for a plain fault, a
simultaneous multi-fault run, and an epoch'd reroute run. Any drift in the per-tick filter
convention, window chunking, segment bookkeeping, or assembly order fails it. Anytime behavior
is bound separately: on a clean stream the every-tick profile is pinned HONESTLY — a first test
draft asserted "selects nothing at every tick", which is STRONGER than the q = 0.05 per-query
guarantee and false on the fixed seed (one leaf crosses transiently at ticks 9–11 on a 9-tick
prefix and decays; the observed transient is pinned, the final audit is clean). A faulted
stream localizes the culprit at a recorded tick well before the batch window ends.

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test ("Then") |
|---|---|
| Incremental ≡ batch, byte-for-byte | `session.test.ts`: final-tick `audit()` equals `runPipeline` JSON for (a) single fault, (b) multi-fault, (c) reroute epochs |
| Anytime clean profile, honestly pinned | every-tick audits on a clean stream: the observed 3-tick single-leaf transient pinned exactly, ≤1 leaf per look, final audit clean (a "never selects" assert would overclaim the per-query guarantee — corrected during the build, recorded) |
| Anytime detection beats the batch wait | faulted stream: the culprit is rank-1 at a recorded tick < the window length |
| Per-tick standardization replicates the filter | implied by byte-equality; the lag convention is recorded here from a direct probe |
| One assembly path | `assembleAudit` shared by `runPipeline` and the session (refactor is behavior-preserving: the full pre-existing suite passes untouched) |

## Consequences

- The product claim graduates from "the math is anytime-valid" to "the system answers anytime"
  — the largest capability gap identified in the round-7 roadmap, closed.
- Honest limitations, recorded: querying every tick and acting on the FIRST positive is a
  stopping rule — each e-BH query is valid, and e-processes are safe under optional stopping,
  but the published FDR figure describes a single query; calibration is batch by design;
  ingest expects a full tick for all leaves (partial/missing-leaf ticks are future work).
- Memory per session is O(leaves × signals × (p + window)) — bounded, no full-history retention.

## Mutation record

`session.ts` + `calibration.ts` + `pipeline.ts`: 18/22 generated mutants killed at landing; the
no-calibrated-D `false → true` survivor was then killed by an all-null-D-cells fixture (verified
by hand-reapplying the mutant). The three remaining survivors are the **benign fire-boundary
class** (`e ≥ 1/α` vs `>` in the session's verdict assembly for A/C/D) — the same
accepted-on-the-record class as `detect.ts`'s, ADR-0009/0019 precedent: the exact-equality
boundary is unreachable in floating practice and the keystone byte-equality binds the assembly
everywhere else.
