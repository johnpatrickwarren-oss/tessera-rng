# ADR 0060 — The FDR license rule, in code: per-leaf construction + monitor-ok

- **Status:** ACCEPTED (operator-ratified: "let's do a and b" — this is (a) of the ADR-0059
  parked decision)
- **Date:** 2026-07-28
- **Decision owner:** John (ratified); Tessera-RNG (execution)
- **Relates to:** ADR-0059 (the evidence: the fixed-ς\* gate launders at ≥ paper scale;
  `perLeafScale` is the measured N-robust construction), ADR-0052 (`perLeafScale` + its
  drift cliff), ADR-0053 (the monitor — the cliff's detector, the license's second
  conjunct), ADR-0057 (real fleets make per-entity calibration a precondition anyway),
  ADR-0061 (the (b) companion: the max-z statistic).

---

## Decision

The license rule becomes code — and CHANGES: this SUPERSEDES ADR-0053's stated rule
("licensed ⇔ gate passing AND monitor ok"; an addendum there records the supersession). The
gate conjunct is replaced by the construction conjunct, for the reasons below:

1. **`PipelineParams.perLeafScale?: boolean`** threads to `buildCalibration` through
   `calibrateForSession` (opt-in, default OFF — byte-identity preserved).
2. **The audit knows its construction:** `calibration_construction: 'per_leaf_scale'` is
   stamped on the audit iff the substrate carries `leafScale` (derived from the substrate,
   so batch and session agree by construction; ABSENT ⇒ shared — stamping 'shared'
   everywhere would break byte-identity, so absence is the documented encoding).
3. **`src/license.ts` — `fdrLicense(audit)`**, a pure function over the audit:
   `licensed ⇔ calibration_construction === 'per_leaf_scale' AND drift_monitor.status ===
   'ok'`, with a `reasons` list naming every failing conjunct (absent monitor = a failing
   conjunct: an unmonitored window cannot license). Shared-calibration audits are NEVER
   licensed — they remain Mode-A evidence/ranking (the ADR-0059 measured basis: the fixed
   gate is anti-conservative at scale, and ADR-0057 measured real fleets far past any
   fixed threshold under shared calibration).

The ADR-0051 gate is NOT a license conjunct: under `perLeafScale` its calibration-window
reading is in-sample-trivial (ADR-0052 §2), and for shared audits the license is refused on
construction grounds before the gate matters. The gate remains what it is — the Mode-A
honesty instrument for calibration windows, with its VALIDATION ⚠️ scale limit.

## Acceptance criteria (all test-bound)

- **AC-1 (byte-identity):** no opt-in ⇒ audits byte-identical (existing suite +
  explicit field-absence check); `perLeafScale` opt-in adds ONLY the construction field
  (plus its effect on residuals, which is the point).
- **AC-2 (truth table):** the four (construction × monitor-status) combinations produce the
  right verdict with the right reasons; `indeterminate`/`drifted`/absent monitor all refuse.
- **AC-3 (e2e):** `runPipeline({perLeafScale: true, driftMonitor: true})` on a clean fabric
  → licensed; shared + monitor-ok → refused on construction; per-leaf + no monitor →
  refused on monitoring.
- **AC-4 (session parity):** a session over a `perLeafScale` substrate stamps the same
  construction field; license agrees batch/session.

## Anti-scope

No default flip of `perLeafScale` itself (the license rule makes the requirement explicit
without forcing the construction on Mode-A users); no action wiring (the license is data);
no change to gate/monitor verdicts (ADR-0061 owns the statistic change); no removal of the
Mode-A path.

## Prescription → AC coverage

| Prescription | Bound by |
|---|---|
| perLeafScale threading + construction stamp (substrate-derived) | AC-1, AC-4 |
| License truth table incl. absent-monitor refusal | AC-2 |
| e2e both directions | AC-3 |
