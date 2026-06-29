# ADR 0034 — High-δ cross-optic saturation: root cause + decision to bound it

- **Status:** ACCEPTED (characterization + decision; no behavioral change). The ADR-0031 high-δ
  limitation is diagnosed to root cause and **accepted as a bounded limit** — the simple fixes are
  fragile and trade off a real guarantee, and the regime is operationally low-priority. Root cause
  pinned by `test/high-delta-saturation.test.ts`. 224 tests green, gate PASS.
- **Date:** 2026-06-29
- **Decision owner:** Tessera-RNG (post-v1; completes the ADR-0031 `RECORDED LIMITATION`)
- **Relates to:** ADR-0031 (the limitation), ADR-0016 (the firing-fraction q₀ null), ADR-0033 (the
  z scale), ADR-0001 (engine never forked — bears on fix option C).

---

## Context

ADR-0031 reversed the ADR-0028 cross-optic rejection in the δ≈3–6 band (magnitude 4/4 vs binary
0/4) but recorded that at δ≥8 both scorers fail. "Tackle the saturation" → diagnose it. Measured on
the cross-optic fabric (cross-kind optic-3 + panel-7, `runPipeline`, q=0.05, 60 ticks, 4 seeds):

| δ | magnitude recovers | observed q₀ | selected | e=∞ leaves |
|---|---|---|---|---|
| 3–6 | 4/4 | 0.11 | 12 | 0 |
| 8 | 2/4 | 0.37 | 40 | 0 |
| 16 | 0/4 | 0.70 | 77 | 1 |
| 32 | 0/4 | — | 98 | 10 |

## Root cause — two upstream defects, neither in the magnitude scorer

**(1) The firing-fraction q₀ is self-corrupting (dominant, δ=8–16).** The localization null is
`base_rate_q0 = (|selected|+½)/(|leaves|+1)` — the observed firing fraction (ADR-0016). A δ≥8 optic
fault leaks ~δ/(nTors−1) into **every** tor leaf, firing the whole fleet, so q₀ climbs to 0.37–0.70.
The inflated null then declares that firing is "expected" and discounts the optic's own genuine
signal — **the fault inflates the very base rate used to localize it.** Confirmed: at the corrupted
q₀ optic-3 is not ranked; at the clean rate (0.05) it recovers (pinned in the test, decisive for
seed 1; only ~1/4 across seeds — see below).

**(2) e-value overflow (δ≥32).** Combined e-values overflow to `+∞` (1 leaf at δ=16, 10 at δ=32);
z clamps at `Z_MAX`, so optic-vs-optic magnitude discrimination is **lost upstream of tomography** —
the localizer cannot recover information already saturated in the detection layer.

## Why the obvious fixes don't earn their place

- **Cap q₀ at the clean rate** (`min(q0, 0.05)`): measured — δ=8 improves 2→3/4, δ=16 0→1/4, δ=32
  0→1/4. **Partial and fragile**, and it **breaks the ADR-0016 fleet-wide-event rejection**: a
  *genuine* fleet-wide event (no localizable cause) also fires the fleet and *should* yield no
  culprit via a high q₀. A firing-rate q₀ cannot tell "widespread fault" from "fleet-wide event" —
  only the **magnitude concentration** can (a fault fires its own w=1 leaf hardest; an event fires
  uniformly), and encoding that is a redesign of the null, not a cap.
- **Raise Z_MAX:** useless at δ≥32 — the e-value is *already* `+∞`; there is no finite z to recover.
  The information is lost in the e-process accrual (an engine/detection concern; the engine is never
  forked, ADR-0001).

## Decision

**Accept the high-δ extreme as a characterized, bounded limit.** Do not ship the fragile q₀ cap or
any tuned patch. Rationale:

1. **Operationally low-priority.** The system exists to catch *subtle* faults early ("by the time a
   threshold alarm fires, the margin is spent"). A δ≥8 optic fault firing 40–98% of the fleet is an
   unmissable klaxon; localization to a single optic is least valuable exactly when the blast radius
   is fleet-wide. The solved band (δ≈3–6) is the operating regime.
2. **The principled fixes are real but out of this round's scope**, and recorded as future work:
   - **A — magnitude-concentration-robust localization null:** replace the firing-fraction q₀ with a
     base rate that a single concentrated fault cannot inflate (a contamination-robust / leave-out
     estimator, mirroring the engine's own contamination-robust common-mode line). This is the only
     fix that resolves the fault-vs-event tension without breaking ADR-0016. Non-trivial; its own ADR.
   - **B — log-space / capped e-values upstream** so magnitude survives at δ≥32. An engine extension
     point question (never fork), so it routes to the engine, not Tessera.
3. **No false comfort.** The limit is pinned by `test/high-delta-saturation.test.ts` (q₀ corruption
   is the lever) and the ADR-0031 `RECORDED LIMITATION` test (both scorers fail δ≥8), so it cannot
   silently rot, and the in-band win is not overstated to cover it.

## Anti-scope (must-never)

- **No firing-rate q₀ cap as a default** — it trades the ADR-0016 fleet-wide-event guarantee for a
  fragile partial gain.
- **No forking the engine** to change e-value accrual (ADR-0001) — fix B is an engine extension-point
  request, not a Tessera change.
- **No claim that the magnitude scorer "solves cross-optic"** — it solves the operating band; the
  extreme is bounded and recorded.

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test |
|---|---|
| q₀ self-corruption is the δ=8–16 root cause | `high-delta-saturation.test.ts`: q₀>0.5 at δ=16; optic-3 unranked at the corrupted q₀, recovered at the clean rate |
| The limit is honestly bounded, not hidden | the ADR-0031 `RECORDED LIMITATION` test (both fail δ≥8) stands; this ADR records the operating band and the two fix directions |

## Consequences

- The ADR-0028 → 0029 → 0031 → 0033 → 0034 arc is closed with an honest boundary: **cross-optic
  localization works in the operating band and is characterized (not silently broken) outside it.**
- Two future directions are on the record (contamination-robust null; upstream e-value scaling), each
  routed to the right layer. Neither is forced now.
