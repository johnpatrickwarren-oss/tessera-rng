# ADR 0062 — Anytime alarms: the Ville rule on the tick-valid family mean (the ADR-0043 EOP adoption)

- **Status:** ACCEPTED (measured envelope below)
- **Date:** 2026-07-28
- **Decision owner:** Tessera-RNG (operator-ratified direction — improvement recommendation 3)
- **Relates to:** ADR-0043 (the recorded EOP adoption this discharges: streaming FDR at
  arbitrary stopping times is unlicensed for correlated leaves, worst-case streaming FDR is
  provably impossible, and error-over-patience is the controllable streaming metric),
  ADR-0044 (the filtration boundary this respects: Family D's wealth is NOT a
  tick-filtration supermartingale — it is EXCLUDED from the alarm statistic), ADR-0027 (the
  incremental session this extends), ADR-0060 (the license rule — untouched: alarms are a
  DETECTION surface, not an FDR claim).

---

## Problem

The session answers anytime, but its selection surface's FDR reading is fixed-time/licensed
only (ADR-0043/0060); the streaming story rides a per-query caveat. What streaming operations
actually need is an ALARM with an anytime guarantee: "page me the moment evidence crosses a
bar, with a bounded false-alarm rate no matter when or how often I look."

## Decision

**RNG's per-leaf evidence is a genuine supermartingale, so the adoption is STRONGER than
detector-style EOP:** Family A's e-value is a MEAN of per-signal betting supermartingales and
Family C is a Safe-Hotelling e-process — both tick-filtration supermartingales with E ≤ 1
under H0; their mean `(A + C)/2` is one too. Ville's inequality then gives the textbook
anytime alarm: threshold `1/α` ⇒ **P(a null leaf EVER alarms) ≤ α** — no patience parameter,
and EOP ≤ α at every patience follows a fortiori (the GPU sibling needed `patience/α` because
its detector statistic is a submartingale with E[M_n] ≤ n; RNG's wealth is E ≤ 1).

**CONDITIONALITY (cold-eye CRITICAL, recorded):** the guarantee holds **under the calibrated
null** — the exact condition ADR-0050→0061 spent six ADRs measuring. The alarm statistic is
the same wealth e-BH selects on: under per-leaf scale dispersion, HEALTHY leaves violate the
calibrated null and would alarm far above α (the onset-scale mechanism verbatim), and
ADR-0057 measured real fleets at ς̂ ≈ 0.4–1.1 vs the 0.05 boundary. **The alarm read
therefore carries the same preconditions as the evidence surface: the dispersion gate on the
calibration window and, in the live window, drift-monitor-`ok`** (or the `perLeafScale`
construction — the ADR-0060 pair). An unguarded alarm stream on a dispersed fleet is noise
with a false certificate — the caveat lives in the artifact, the audit type, and the session
docs, not only here.

1. **`SessionParams.eopAlarms?: { alpha?: number; scope?: 'per-leaf' | 'fleet' }`** (default
   α = 0.05, scope `per-leaf`). Scope `fleet` runs each leaf at level α/n (Bonferroni):
   P(ANY null leaf ever alarms) ≤ α.
2. **Per tick, per leaf** (in ingest, after the detector update): alarm statistic
   `(mean(aM) + cState.M)/2`; first crossing of `1/α_leaf` recorded as
   `{path_class_id, at_tick}` — once per leaf, immutable after.
3. **Family D is excluded** (ADR-0044: window filtration — including it would void the
   supermartingale property; its per-window fire semantics are untouched).
4. **The audit gains `eop_alarms`** when opted in: `{alpha, scope, threshold, alarms[]}` —
   stamped even when empty (monitored-and-quiet is information); absent ⇒ byte-identity.
5. **Recorded narrowings:** session-only (alarms are streaming semantics; a batch run has no
   "when" — the batch pipeline never stamps the field); `reroutes` throw (ADR-0018 wealth
   resets restart segments with fresh wealth — the ever-guarantee does not span resets
   without a union cost; alarm semantics across epochs is future work).

**Alarms are not claims.** An alarm says "evidence crossed an anytime-valid bar" — triage
follows (drill-down, tail triage, the licensed fixed-time read). The ADR-0060 license rule is
untouched; nothing here suppresses or licenses anything (the ADR-0051 claim-not-alarm rule,
now with the alarm half formalized).

## Acceptance criteria

- **AC-1 (byte-identity + narrowings):** opt-out audits byte-identical; opt-in adds ONLY
  `eop_alarms`; reroutes + alarms throws; the batch pipeline never stamps the field.
- **AC-2 (the rule, mutant-killed):** the threshold is `1/α_leaf` (a mutant thresholding at 1
  alarms every leaf on clean data and dies on the clean test); a crossing is recorded ONCE
  with the correct first-crossing tick (bound against a hand-replay of the wealth path on a
  faulted leaf); scope `fleet` divides by n (a mutant ignoring scope dies on the fleet clean
  test).
- **AC-3 (measured envelope):** clean fleets × seeds — per-leaf scope: the fraction of null
  leaf-streams ever alarming, published against the α bound; fleet scope: alarm count
  (expected 0) published; faulted runs: first-alarm tick for the fault's leaves (the anytime
  win: alarm latency vs the fixed-time window end), published as measured.
- **AC-4 (freshness):** artifact recomputes; `.md` ≡ renderMarkdown(`.json`).

## Anti-scope

- **No FDR/license semantics** — alarms are detection, ADR-0060 is untouched.
- **No Family D inclusion** (ADR-0044); no epoch'd-session support (throws); no batch
  alarms; no e-BH-side streaming claims (stopped e-BH remains unlicensed, ADR-0043).
- **No alarm-driven actions** (drains etc.) — operator scope.

## Prescription → AC coverage

| Prescription | Bound by |
|---|---|
| Ville threshold 1/α on the tick-valid mean; D excluded | AC-2 (threshold mutant) + construction (recorded) |
| First-crossing once, correct tick | AC-2 (hand-replay bind) |
| Fleet scope = α/n | AC-2 |
| Opt-in field, session-only, reroutes throw | AC-1 |
| Envelope: clean rates vs bound + faulted latency | AC-3, AC-4 |

## Consequences — measured (AC-3/4)

Artifact: `coverage-matrices/eop-alarms.{json,md}` (n = 8 seeds/cell, T = 60 sessions).

- **Clean fleets sit under the guarantee:** per-leaf scope ever-alarm counts
  {1, 5, 2, 2, 3, 4, 0, 0} (reference data; expected count E ≤ N·α = 5.45 — see the bound-
  semantics bullet), pooled ever-alarm fraction 1.95% (17/872) ≤ α = 5% (the guaranteed quantity, and
  the Ville guarantee is infinite-horizon — finite-window fractions sit under it a
  fortiori); the fleet scope (threshold n/α = 2180) is **silent on all 8 seeds**.
- **Every faulted leaf alarms, fast:** 16/16 across two targets; first-alarm ticks mostly in
  single digits (optic-3: {0, 4, 3, 2, 4, 10, 0, 3}; optic-40: {13, 0, 1, 12, 3, 18, 15,
  14}) — the anytime win: a δ = 3 fault pages within seconds-equivalent of onset with the
  guarantee intact at every tick, versus the fixed-time read at the window end.
- The streaming story is now honest end-to-end **conditional on the calibrated null**:
  anytime ALARMS with a Ville guarantee under the gate/monitor preconditions (this ADR) +
  fixed-time FDR readings under the license (ADR-0060) — the ADR-0043 recorded gap
  (unlicensed anytime-FDR) is closed by giving streaming its own valid instrument instead of
  an invalid reading of the old one.
- **Bound semantics (cold-eye finding 2, corrected):** the guaranteed quantity is the
  per-leaf ever-alarm PROBABILITY ≤ α — equivalently the POOLED ever-alarm fraction across
  null leaf-streams (measured: 1.95% = 17/872 pooled over 8×109 ≤ α = 5%); the per-seed COUNT is
  binomial-fluctuating around E ≤ N·α = 5.45 and can legitimately exceed ⌈N·α⌉ on some seed
  (a 20-seed probe found one 7). The artifact publishes the pooled fraction as the
  guaranteed quantity; the per-seed counts are reference data, and the test's count pin is a
  MUTANT-KILLER, not the bound.
- **Recorded narrowing (cold-eye finding 4):** `commonModeRobust` + alarms THROWS — the
  robust cross-leaf location strip makes each leaf's residual depend on the fleet's
  concurrent tick, so the per-leaf tick-filtration supermartingale is only approximate;
  composition awaits its own analysis (matching the reroutes treatment).
