# ADR 0055 — no-god-module restructured: named zero-behavior-contract exemption, threshold restored to tight

- **Status:** ACCEPTED
- **Date:** 2026-07-28
- **Decision owner:** Tessera-RNG (operator-ratified: the standing flag raised in the
  ADR-0051 loosening was answered "go ahead")
- **Relates to:** the eight per-round loosenings this supersedes (16→20 ADR-0017, 20→21
  ADR-0036, 21→22 ADR-0047, 22→23 ADR-0050, 23→25 ADR-0051, 25→27 ADR-0053/0054), sprag
  commit `de823f9` (the `module_fanin` `exempt` option this consumes),
  `arch-invariants.json`.

---

## Problem

Eight identical on-the-record loosenings of `no-god-module` (16 → 27), every one a type-only
import of the zero-behavior `domain.ts` contract by a leaf tool or module — the case the
invariant's intent has explicitly admitted since the first loosening. The per-round ratchet
bump had two compounding costs: boilerplate (a recorded paragraph per round for a
non-decision), and — worse — signal erosion: at threshold 27, a REAL behavioral coupling hub
would need 28 importers to block, and instance #9 of the benign case is indistinguishable in
a diff from a genuine regression.

## Decision

sprag's `module_fanin` gains an `exempt` list (repo-relative module paths; sprag `de823f9`,
4 new metric tests, 42/42 suites). The invariant is restructured:

- **Exempt by name:** `src/domain.ts` (fan-in 27), `src/signals.ts` (10), `src/verdict.ts`
  (10) — the three declared zero-behavior type contracts. For them fan-in is module-count
  growth, not coupling-cascade risk.
- **Threshold drops 27 → 10** — one above the measured behavioral maximum (`calibration` 9,
  `detect` 8, `spraypoint` 8: pipeline cores consumed by ~8 leaf report tools, which consume
  them exactly as tests do). A behavioral module reaching 11 importers now BLOCKS — the
  protection the bumps had eroded, restored.
- **Conditions of the exemption (in the invariant intent):** an exempted file gaining
  behavior requires an ADR de-exempting it or recording why not; growing the exempt list is
  an on-the-record act reviewed like any invariant change.

Verified mechanics (both directions): with the exemption removed the gate counts 1
(`domain` > 10); with the threshold at 8 the gate counts 1 (`calibration` at 9) — the
exemption matches what it names and the tight threshold genuinely bites.

## Anti-scope

No other invariant touched; no sprag default changed (the exemption is per-repo config);
tools/ remain production importers (treating them as test-like was considered and rejected —
a leaf tool CAN become a coupling hub, and the 10-threshold accommodates the honest current
shape without exempting the category).
