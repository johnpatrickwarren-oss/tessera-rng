# ADR 0031 — Cross-optic re-add + magnitude scorer (ADR-0029 Phase 2)

- **Status:** ACCEPTED — pieces 1–3 BUILT (`src/tomography.ts` q₀-null, `src/spraypoint.ts`
  `crossOptic`, `test/cross-optic-magnitude.test.ts`). **Acceptance bar met in the operating band,
  with a recorded high-δ limitation** (see Build note): the magnitude scorer recovers the cross-kind
  optic **4/4 seeds at δ∈{3,4,5,6}** where the binary scorer recovers **0/4** (reversing the
  ADR-0028 rejection), but at δ≥8 the cross-optic leak saturates the fleet and recovery is lost —
  magnitude is **better in-band, equal (both fail) out-of-band, never worse** — not complete. The
  pipeline default flip is deliberately NOT done this round (anti-scope). 221 tests green, gate PASS.
- **Date:** 2026-06-29
- **Decision owner:** Tessera-RNG (post-v1; the ADR-0028 named revisit condition + ADR-0029 Phase 2)
- **Relates to:** ADR-0028 (the recorded cross-optic omission + its rejection table — the exact
  measurements this round must reverse), ADR-0029 (the magnitude scorer, Phase 1, opt-in/dormant +
  the q₀-null prerequisite), ADR-0019/0022 (the noisy-OR + marginal-LLR this generalizes).

---

## Context

ADR-0028 deliberately omitted the per-ToR cross-optic edges (true `P = 1/(nTors−1)` per partner
optic) because the **binary** fire/quiet noisy-OR collapses under them — 61 quiet 1/63-weight
members bury a true optic's LLR; the δ-sweep loses the optic at δ≥64; cross-kind multi-fault
attribution fails. ADR-0028 bound the omission to a test and named the revisit condition: *re-add
the edges WHEN the scorer can use magnitude information.* ADR-0029 built that scorer (Phase 1,
dormant) and its cold-eye flagged one hard prerequisite: the magnitude null is q₀-blind.

This round closes both: the **q₀-aware null** (the prerequisite) and the **cross-optic re-add**,
then measures whether magnitude recovers what the binary scorer could not.

## Decision

Three pieces, smallest-blast-radius first:

1. **q₀-aware magnitude null.** Thread the surface base rate q₀ into the soft-evidence scorer as a
   leak on the unlit fraction: `L = 1 − (1−q₀)·G·(1−δ)^{κw}` (so the null lit fraction is q₀, not 0).
   At q₀→0 this recovers the Phase-1 form (small-q₀ default-preservation unchanged); at high q₀ a
   member firing at ≈ the base rate is no longer evidence — closing the ADR-0029 divergence.
2. **Cross-optic fabric, OPT-IN.** `generateSpraypointFabric` gains `crossOptic?: boolean`; when set,
   a tor leaf emits its partner-optic edges at `1/(nTors−1)` (the ADR-0028 full-support variant).
   Default OFF — the existing fabric, its hashes, floors, and the ADR-0028 narrowing-bind test are
   unchanged. `source_version` marks `sp3:` when on.
3. **Acceptance-bar measurement.** On the cross-optic fabric, the BINARY scorer reproduces the
   ADR-0028 rejection (cross-kind optic NOT recovered), and the MAGNITUDE scorer (q₀-aware) recovers
   it. This is the proof the named revisit condition is met.

## Anti-scope (must-never)

- **No pipeline default flip in THIS round.** The production cutover — make the cross-optic fabric
  the default AND wire the magnitude scorer into `runPipeline` — churns demo/replay/coverage
  artifacts and is its own recorded step, gated on this round's acceptance bar passing. Until then
  the pipeline runs the existing fabric + binary scorer, byte-for-byte unchanged.
- **No floors/hashes move on the existing fabric.** crossOptic is opt-in; the default fabric is
  untouched, so every existing artifact and the ADR-0028 omission test stay green.
- **No N1 weakening.** Tomography stays RANKING / correlational-not-causal.
- **No fit of S or q₀.** S stays the fixed {1,2,4} mix; q₀ is the surface's measured base rate, not
  a tunable.

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test |
|---|---|
| q₀-aware null closes the divergence | at q₀=0.5 the magnitude scorer no longer blames a fleet-wide base-rate event (boundary-z); the ADR-0029 divergence fixture is updated to the closed behavior |
| q₀→0 preserves Phase-1 behavior | small-q₀ default-preservation + the discrimination/no-regression fixtures still pass (the leak factor vanishes as q₀→0) |
| crossOptic emits the partner edges | a tor leaf has `nTors−1` partner-optic edges at weight `1/(nTors−1)`; default fabric still has NONE (ADR-0028 omission test unchanged) |
| Binary fails on cross-optic (control) | on the cross-optic fabric, the binary scorer does NOT recover the cross-kind optic — reproducing the ADR-0028 rejection |
| Magnitude recovers on cross-optic | on the SAME fabric + fault, the q₀-aware magnitude scorer puts both the true optic and the true panel in the top-2 |
| New math mutation-checked | dropping the (1−q₀) leak, or the μz term, fails a test |

## Sequencing

- **This round:** pieces 1–3 (q₀-null, opt-in cross-optic fabric, acceptance proof). No artifact churn.
- **Production cutover (next, recorded):** make cross-optic the default fabric + flip `runPipeline`
  to the magnitude scorer; re-baseline demo/replay/coverage; re-publish the floors that move.

## Build note (2026-06-29)

- **q₀-aware null** — one line in `resourceMagnitudeLLR`: the leak `(1−q₀)` multiplies the unlit
  factor, so the null lit fraction is q₀. Measured: at q₀=0.5 a **boundary-strength** firing is no
  longer fabricated into a culprit (the ADR-0029 divergence is closed), while a genuine **4σ** shift
  is still evidence (magnitude is strictly more informed than the binary fire/quiet bit). At q₀→0
  the leak vanishes, so small-q₀ default-preservation and the Phase-1 fixtures are unchanged.
- **Cross-optic fabric** — `crossOptic` opt-in adds each tor leaf's `nTors−1` partner edges at
  `1/(nTors−1)`; default OFF (the ADR-0028 omission test is unchanged), `source_version` → `sp3:`.
- **Acceptance bar (measured, `runPipeline` + `buildSurface` + `localize`, q=0.05, 60 ticks):**
  cross-kind optic-3 + panel-7, both-in-top-2, seeds 1–4 —

  | δ | binary recovers | magnitude recovers |
  |---|---|---|
  | 3–6 | **0/4** (ADR-0028 rejection reproduced) | **4/4** (reversed) |
  | 8 | 0/4 | 0/4 (q₀≈0.37 — fleet leak) |
  | 16 | 0/4 | 0/4 (q₀≈0.70 — fleet-saturated) |

- **Recorded limitation (instrumented-caveat):** magnitude does NOT solve the deeper high-δ
  saturation — a δ≥8 optic fault leaks ~δ/(nTors−1) into every tor leaf, firing the fleet, which
  both (a) inflates the *estimated* base rate q₀ (→0.37 at δ=8, 0.70 at δ=16) so the q₀-null discounts
  the optic's diluted evidence, and (b) overflows the accrued e-values so z clamps at Z_MAX,
  flattening discrimination. Recovery holds in the δ≈3–6 band; outside it **both scorers fail
  equally** (magnitude is better in-band, equal out-of-band, never worse). Pinned by the
  `RECORDED LIMITATION` test (δ=8 and 16).
- **z-scale caveat (cold-eye, the substantive one):** the pipeline feeds the **multi-tick accrued**
  combined e-value, so `ln E ≈ T·θ²/2` and `z ≈ θ·√T` (≈ 7.7θ at T=60) — NOT the literal per-tick
  shift the ADR-0029 D1 identity `z(e^{θ²/2})=θ` suggests. Since √T inflates every firing leaf
  uniformly, z remains a **monotone ranking proxy** (valid for RANKING, which is all N1 claims, and
  why the recovery is real), but `μz − μ²/2` is NOT a calibrated per-tick LR in production (μ~O(1–4)
  vs z~O(10–40); the −μ²/2 falsification term is under-scaled). **Calibrating z to the per-tick scale
  is a recorded prerequisite for the production pipeline flip** (alongside making cross-optic the
  default fabric). Dormant this round, so no live effect. The ADR-0029 D1 "literal effect size for
  Family A" framing is hereby narrowed to "monotone evidence proxy" for the pipeline-fed value.
- **Mutation:** dropping the `(1−q₀)` leak fails the q₀-aware-null test; dropping `μz` fails three
  (ADR-0029). Fresh-context cold-eye run on the round; both LIKELY findings folded in (the δ-sweep
  table is now backed by a committed fixture; the wording re-pinned; the z-scale caveat recorded).
- **q₀-null Risk bullet (ADR-0029) discharged**; the `magnitudeZ` Infinity path (cold-eye MINOR, now
  live at δ≥16) is clamped to a finite cap rather than throwing.

## References

- ADR-0028 §"Considered and REJECTED": the full-support rejection table this round reverses (in band).
- ADR-0029: the soft-evidence LR, the fold reuse, and the q₀-null Risk bullet now discharged.
