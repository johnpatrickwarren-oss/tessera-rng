# ADR 0041 — Common-mode default RE-OPENED under the robust null: opt-in REAFFIRMED

- **Status:** ACCEPTED (decision record; NO behavioral change — common-mode stays opt-in). The
  ADR-0039 robust-default null changed ADR-0038's specific room-mislocalization demo, so the
  default-cutover question was re-opened and re-measured under robust calibration. **The broad-fault
  regression persists across the floor sweep → common-mode stays OPT-IN.** Reaffirmed with fresh
  evidence; pinned by a test. 240 tests, gate PASS.
- **Date:** 2026-06-29
- **Decision owner:** Tessera-RNG (the ADR-0039 follow-up re-open)
- **Relates to:** ADR-0038 (kept common-mode opt-in under the mean/sd null), ADR-0039 (the robust
  default that triggered the re-open), ADR-0034 (the high-δ saturation common-mode lifts — the benefit).

---

## Why re-opened

ADR-0038 kept common-mode opt-in because defaulting it ON regressed broad-fault floors and
mislocalized a room fault (room-0 → room-1). ADR-0039 made calibration robust by default, and its
cold-eye recorded that under the robust null **that specific room mislocalization no longer reproduces**
(the `WHY NOT DEFAULT` demo had to be pinned to `robustCalibration:false`). So the genuine question:
**is common-mode now safe to default given a robust null** — which would lift the ADR-0034 high-δ
saturation in production?

## What was measured

Re-measured the default cutover with robust calibration as the baseline:

- **The single-fault PROBE looked promising:** room-0 at Δ=3, common-mode ON, kept rank-1 = room-0
  (correct) — unlike the mean/sd case. It *seemed* the cost was gone.
- **The FULL coverage sweep said otherwise** (defaulting common-mode ON + robust calibration,
  regenerated and diffed across ALL floor structures *including* `mode_floors`):
  | regression | |
  |---|---|
  | `room` attribution | 3 → **None (lost)** |
  | `power_zone` det / attr | 1 → 2 / 1 → 2 |
  | `shuffle_panel` det / attr | 2 → 3 / 2 → 3 |
  | `cross_kind` multi-fault attribution | 2 → 3 |

  with cell-level drops: `power_zone` Δ=1 detection 1 → **0.25**, `shuffle_panel` Δ=2 detection 1 → **0**,
  `room` Δ=4 attribution **4/4 → 0/4** (pinned). Clean FDR stays 0.

**So the broad-fault cost PERSISTS under the robust null.** The single-δ probe (and the changed
room-0→room-1 demo) were misleading — across the floor sweep common-mode still strips broad faults'
own signal, because that signal *is* the cross-leaf common-mode (the ADR-0038 mechanism, unchanged by
how the null is *estimated*).

## Decision

**Common-mode stays OPT-IN.** ADR-0038's decision is reaffirmed under the robust default. The benefit
is unchanged and real — common-mode ON still lifts the cross-optic high-δ saturation (δ=8: 2/4 → 4/4,
δ=16: 0/4 → 4/4) — so it remains the right *opt-in tool* for the concentrated-fault-amid-leak regime,
not a blanket default.

## Methodological note (the lesson, recorded)

This re-open is a clean case study in why the disciplines exist: a **single-fault probe and a changed
pinned-test outcome suggested the cost was gone**, and a hasty read would have defaulted common-mode.
The **full coverage sweep — measured across every floor structure including `mode_floors`** (the exact
structure the ADR-0039 cold-eye caught a diff silently skipping) — showed the regression persists. The
ADR-0038 "measure the whole coverage, not a spot-check" discipline + the ADR-0039 cold-eye "don't trust
a partial diff" lesson are what turned a tempting wrong conclusion into the right one.

## Anti-scope

- **No default flip** — common-mode stays opt-in; `runPipeline`/`calibrateForSession` defaults unchanged.
- **No claim the room demo is unchanged** — under the robust null the *specific* room-0→room-1
  mislocalization does not reproduce; the `WHY NOT DEFAULT` test stays pinned to `robustCalibration:false`
  to preserve that as-measured demo, while the new `RE-OPEN` test pins the persistent floor-level cost
  under the robust default.

## Consequences

- The one follow-up that could have changed a prior decision is **resolved without changing it** — the
  opt-in posture is now reaffirmed under both the mean/sd and the robust null, with the cost pinned by a
  test under each.
- Common-mode's status is settled: a validated, consumed engine capability, opt-in, for the high-δ
  cross-optic regime — not a default, under any calibration.
