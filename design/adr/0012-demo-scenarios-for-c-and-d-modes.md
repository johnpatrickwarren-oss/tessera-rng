# ADR 0012 — Demo scenarios for the covariance (C) and spectral (D) modes

- **Status:** Accepted
- **Date:** 2026-06-09
- **Decision owner:** Tessera-RNG (post-v1, round 2)
- **Supersedes:** extends AC-8 (six → eight scenarios)

---

## Context

The demo dashboard (AC-8) paged **six** scenarios, all of which are mean-shift degradations — the
mode Family A catches. Post-v1 added two more detection modes (Family C, covariance flips, ADR-0007;
Family D, periodicity, ADR-0009), but the demo never *showed* them: a viewer paging the dashboard
would see only Family-A-style common modes and have no visual evidence that the covariance or
spectral detectors do anything. The honest-measurement round (ADR-0010) put the firing-mode
attribution in the audit; the demo should surface it.

## Decision

Extend the demo from six to **eight** scenarios (amends AC-8; the spec carries the annotation):

1. **`covariance-flip-common-mode`** — a passive shuffler reverses the normal cross-signal
   correlation (baseline ρ = 0.9 → −0.9 on a signal pair) with **no mean or variance change**.
   Family A is blind; the learned-covariance **Family C** catches it.
2. **`oscillation-common-mode`** — a passive shuffler develops a period-7 oscillation (a limit cycle)
   with **unchanged mean and variance**, over a 600-tick window (Family D's power requirement,
   ADR-0009). Families A and C are blind; the spectral **Family D** catches it.

Supporting changes:
- The `Spec` gains a `mode` ('mean' | 'covariance' | 'oscillation') and an optional `ticks`; a
  `telemetryFor` helper builds the right pipeline telemetry per mode (baseline `noiseCorr` +
  `degradedNoiseCorr` for covariance; `oscillationPeriod`/`Amp` for spectral).
- `ScenarioResult` carries the `mode`, and the demo renders the audit's **firing-family tally**
  (A / C / D) so each scenario visibly names the detector that caught it.

## Consequences

- **The new modes are visible and bound.** Both new scenarios localize rank-1 to the injected
  shuffler and are attributed to the expected family: the covariance flip fires **C only**
  (A = 0), the oscillation fires **D only** (A = C = 0). The scenario and demo tests assert this —
  the demo is not just decorative, it is an anti-self-confirming check that the modes map to the
  right detectors end-to-end.
- **Contract amended on the record.** AC-8's "six" is annotated in the spec with the extension to
  eight (ADR-0012); the binding tests (`demo.test.ts`, `scenarios.test.ts`) assert eight and the
  per-mode attribution. The amendment is a post-v1 extension, not a silent change.
- **Deterministic / replay-clean.** Both scenarios are pure functions of their seed (the demo
  "render twice → identical" test covers them, including the 600-tick oscillation); `demos/demo.html`
  regenerates byte-stable. No new product code in `src/` — the scenarios compose the already-tested
  pipeline and the ADR-0007/0009/0010 surfaces.
- **Honest limit.** The oscillation scenario runs at 600 ticks (vs 60 for the others) — disclosed in
  the spec and the scenario, the long-window character of Family D recorded in ADR-0009.
