# ADR 0021 — Multi-fault injection: the set-cover's "minimal explaining SET" claim, bound end-to-end

- **Status:** Accepted
- **Date:** 2026-06-10
- **Decision owner:** Tessera-RNG (post-v1 round 5, item 1 — owner-authorized round; closes the
  gap recorded in ADR-0019's cold-eye fold-in)
- **Supersedes:** —

---

## Context

The tomography contract (AC-5, ADR-0001/0016/0019) is a greedy set-cover returning the **minimal
set of shared resources** that explains the firing leaves — a claim whose whole point is
simultaneous faults. But `DegradationSpec` injects exactly one resource, so the multi-fault path
has only ever been exercised at the `localize()` unit level (hand-built firing sets); no
end-to-end run has ever produced two real faults through telemetry → calibration → detection →
e-BH → localization → drains. The ADR-0019 cold-eye recorded this as an explicit gap.

## Decision

1. **`TelemetryParams.degradations?: readonly DegradationSpec[]`** (plural). Each entry carries
   its own resource/δ/start/signal/mode. Per tick, every degradation affecting a leaf applies
   **in array order** (deterministic composition; mean shifts add). The noise stream (RNG, AR
   history, baselines) is untouched by how many degradations exist — adding a second fault
   changes nothing about the first's noise, byte-for-byte.
2. **Compatibility contract:** the singular `degradation` is unchanged; `degradations: [x]` is
   **byte-identical** to `degradation: x` (the anti-self-confirming guard); supplying both
   throws (ambiguity is operator error, not a merge rule); absent/empty ⇒ clean, byte-identical
   v1.
3. **Narrowing, on the record:** at most ONE degradation may carry `degradedNoiseCorr` (the
   innovation Cholesky swap is a per-tick whole-vector transform; composing two correlation
   swaps has no defined semantics in this synthetic model) — validated with a thrown error, not
   silently ignored. Mean/variance/oscillation modes compose. _CORRECTED (round-5 cold-eye C1):
   the original "compose freely" was FALSE — variance/oscillation rescaled around the RAW
   baseline, so a preceding mean shift on the same leaf was MULTIPLIED (observed 12.3 instead of
   the promised 4) and array order was silently load-bearing. Fixed: 2nd-order modes now center
   on the baseline plus the tick's ACCUMULATED mean shift — variance inflates the noise only,
   and mean × 2nd-order composition is order-independent (bound per tick in both orders). Two
   2nd-order modes on the SAME signal of the same leaf remain order-sensitive — recorded, not
   hidden._
4. **Pipeline:** `PipelineParams.telemetry` accepts `degradations` and threads it to the live
   window only (the calibration window stays clean, as today). _CORRECTED ON THE RECORD
   (halt-on-contradiction): the original prescription here read "no detector/surface/tomography
   code changes". The cross-kind e2e fixture FALSIFIED it — the binary explained-set cover let
   panel-7 claim tor-3 through a w=0.1 membership and returned ONE culprit for two faults. The
   fix is its own decision: ADR-0022 (marginal-LLR set construction)._

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test ("Then") |
|---|---|
| Shifts compose exactly, per leaf, in array order | `telemetry.test.ts`: same-seed diff vs clean = δ₁·w₁ + δ₂·w₂ on a doubly-affected leaf; the single-fault leaves carry only their own term |
| `degradations: [x]` ≡ `degradation: x` | byte-identical series (JSON equality) |
| Both forms supplied ⇒ throw; two `degradedNoiseCorr` ⇒ throw | rejection tests with message match |
| Absent/empty ⇒ byte-identical v1 | `degradations: []` equals the clean run byte-for-byte |
| END-TO-END two-fault localization (binary fabric) | `pipeline.test.ts` or `tomography`-adjacent e2e: two shuffler faults ⇒ BOTH are culprits, each with its own member set; `drain_top_k: 2` drains both |
| END-TO-END two-fault localization (Spraypoint, cross-kind) | `spraypoint.test.ts`: simultaneous optic-3 + panel-7 at δ=4 ⇒ culprit set contains both, neither explains the other's leaves. FAILED under the binary cover (one culprit for two faults) — the finding that forced ADR-0022 |
| Replay-clean (AC-9) | two identical multi-fault runs ⇒ byte-identical audit |

## Consequences

- The set-cover's headline claim is finally bound by reality-shaped evidence rather than
  hand-built firing sets; AC-5c's identifiability claim extends to the simultaneous case
  actually exercised.
- Honest limitation: simultaneous faults are injected as INDEPENDENT additive effects; real
  co-located failures can interact (shared queues, cascading drops). Out of synthetic scope
  (N2), recorded.
- The multi-fault attribution floor (coverage matrix) is deliberately NOT added in this ADR —
  single-fault floors stay the published measurement; a multi-fault row would need its own
  "attribution" definition (both-in-top-k?) and is future work, recorded here so the narrowing
  is visible.
