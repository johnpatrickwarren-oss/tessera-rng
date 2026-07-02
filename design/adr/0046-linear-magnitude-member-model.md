# ADR 0046 — Linear t-statistic member model: unsaturated magnitude, q₀-free null, fleet-event candidate

- **Status:** ACCEPTED — Phase 1 measured, Phase 2 (production cutover) measured and DONE in the
  same round (the bar cleared with zero floor regressions and one floor IMPROVEMENT; measurements
  in §Measurement below, appended after implementation exactly as this header promised).
- **Date:** 2026-07-02
- **Decision owner:** Tessera-RNG
- **Relates to:** ADR-0016/0019/0022 (the noisy-OR scorer line), ADR-0029/0031/0033 (magnitude
  z(E) currency + its recorded caveats), ADR-0034 (the two root causes this targets),
  ADR-0028 (the "magnitude-aware member model" revisit condition), ADR-0036/0038/0041 (the
  common-mode tradeoff this aims to retire for the concentrated case).

---

## Problem (all previously recorded)

1. **q₀ self-corruption (ADR-0034 root cause 1):** the localization null is the fleet firing
   fraction; a fleet-leaking fault inflates it to 0.37–0.70 and masks itself. The q₀ cap was
   rejected because a firing-rate null cannot distinguish a widespread fault from a genuine
   fleet-wide event.
2. **Magnitude ceiling (ADR-0034 root cause 2 + ADR-0031 scale caveat):** the z(E) currency
   saturates — e-values overflow to +∞ at δ≥32, z clamps at 40, and the member predictor
   μ = S·L caps at S_max = 4 while observed z reaches 40+, so a 63×-concentrated optic and a
   uniform fleet elevation become indistinguishable exactly where discrimination matters.
3. **The δ-band tradeoff (ADR-0033)** between raw and per-tick z was a symptom of the same
   mis-scaled predictor, not an operating-point truth.

## Design

**Currency.** Per selected leaf, y = max(t, z(E)) where t = max over signals of
|Σ_ticks residual| / √T — the exact t-statistic of the standardized residual stream (≈ θ√T for a
per-tick shift θ), and z(E) = the ADR-0029 accrued currency (≈ θ√T for Family-A evidence; the
monotone proxy for C/D-mode evidence, which has no mean shift for t to see). Same scale, so the
max is coherent; t never overflows (δ=32, T=60 → t ≈ 248, finite), so root cause 2 disappears
for mean-shift faults. Quiet leaves carry y = 0 (the existing convention; recorded info loss).

**Member model.** Under candidate r with per-tick strength θ, a member with weight w has
y ~ N(θ·w·√T, 1); under the null y ~ N(0, 1) — **parameter-free: q₀ exits the magnitude path
entirely** (root cause 1 dissolves — there is no fleet-corruptible scalar left). Member log-LR:
μ·y − μ²/2 with μ = θ·w·√T, mixed over the FIXED grid θ ∈ {1, 2, 4, 8, 16, 32, 64, 128} with a
1/θ prior (Jeffreys-style scale prior, same fixed-form rationale as the ADR-0019 1/κ). κ and S
disappear: dilution is expressed exactly by w (linear), severity by θ — no saturation device
needed because the observation scale itself no longer saturates.

**Marginal-LLR construction (ADR-0022 shape, additive).** Picks fold their posterior-predicted
mean into each leaf: m_i += E_post[θ]·w_i·√T; subsequent candidates are scored on
(μ_new + m_i)-vs-m_i — the linear analogue of the residual quiet factor. Explained (display +
admission gate): the picked set accounts for at least half the observed magnitude
(m_i ≥ y_i/2, fired leaves only). With nothing picked this reduces to the plain LR scorer.

**Fleet-event candidate.** A virtual candidate `__fleet__` with w = 1 on every leaf competes in
the cover. A genuinely uniform fleet-wide elevation is best explained by it (it wins and is
reported as a non-drainable `fleet_wide` culprit — the ADR-0016 "fleet event ⇒ no localizable
culprit" made explicit instead of silent); a BROAD-but-structured fault (room: 97 of 109 leaves)
beats it because its quiet leaves sit exactly where the room's incidence says they should —
each quiet leaf costs the fleet candidate μ²/2 that the room candidate does not pay. This is the
Deepview grand-mean-refit / Ghita window-null idea expressed as model competition rather than
residual surgery — the ADR-0038 broad-fault regression cannot recur because nothing is stripped.

**Scope narrowings (recorded up front):**
- Epoch'd runs keep the z(E) currency (t-over-which-segment interacts with ADR-0018 grouping;
  epoch'd × magnitude was already a recorded gap from ADR-0035). t activates iff no epochs.
- The t currency is direction-folded (|·|); a signed treatment is future work.
- Binary scorer and z(E) scorer remain as controls (`legacy`, `magnitude` without `magnitudeT`).

## Acceptance criteria (written before implementation)

- **AC-1 (Phase-1 dormancy):** without `magnitudeT`, every existing test passes byte-identically.
- **AC-2 (the headline):** cross-optic fabric, cross-kind optic-3 + panel-7: at δ ∈ {3, 4, 6}
  the linear scorer matches the z scorer's 4/4-seed recovery; at δ ∈ {8, 16, 32} — where z gets
  0/4 and common-mode tops out at δ16 — linear recovers ≥ 3/4 WITHOUT common-mode.
- **AC-3 (broad faults):** room/power-zone floors equal or better across the FULL coverage sweep
  (the ADR-0041 lesson: full sweep incl. mode_floors, never a single-δ probe).
- **AC-4 (fleet-vs-broad separation):** a uniform all-leaf shift ⇒ `__fleet__` rank-1 and no
  physical resource blamed, drains empty; a room fault ⇒ the room rank-1, NOT fleet.
- **AC-5 (C1 stays closed):** δ = 128 single optic ⇒ minimal set, optic rank-1.
- **AC-6 (multi-fault):** cross-kind both-in-top-2 floors no worse than ADR-0035's.
- **AC-7 (keystone):** incremental ≡ batch byte-for-byte with the linear currency active.
- **AC-8 (anti-self-confirming):** hand mutants — drop the μ·y term, flatten the 1/θ prior,
  skip the posterior fold — each killed by a named test.
- **Phase-2 cutover bar:** full coverage diff shows zero floor regressions (any regression ⇒
  HALT and present to the owner with numbers); demo + coverage regenerated; paper-scale
  rank-1 + clean-FDR-0 preserved.

## Measurement (observed, seeded, reproducible via the committed tests + coverage tool)

**Two design iterations were forced by measurement (recorded, not hidden):**
1. The initial θ grid {1..128} made every C/D-mode scenario abstain (fired leaves carry y ≈ 2.8
   from z(E) with no mean shift; μ = θ·w·√T ≥ 7.75 over-predicted and falsified every candidate
   into zero culprits — caught by the scenarios suite). Grid extended down to {¼, ½}.
2. The low-θ cells then admitted weak trailing picks (sibling panels, the fleet candidate as
   rank-2/3 mop-ups; a grid-quantized posterior-mean fold leaves a systematic ±½-cell residual
   across ~10² members). Fixed by the pair: ML-refit fold (Deepview post-selection-refit
   composition — score with the mixture, fold with the continuous WLS fit) + the rank-≥2
   look-elsewhere charge ln R. A first draft charged rank-1 too and converted weak-but-correct
   attributions into abstentions (optic Δ=1 attribution 75% → 25%, measured) — rank-1 is exempt
   (e-BH already certified the selected leaves; rank-1 is the argmax explanation, a ranking, N1).

**AC-2 (cross-kind optic-3 + panel-7, cross-optic fabric, 4 seeds each):**

| δ | z scorer (prod before) | linear | note |
|---|---|---|---|
| 3, 4, 6 | 4/4 | 4/4 | in-band parity, exact minimal sets |
| 8 | 2/4 | **4/4** | q₀ = 0.30 |
| 16 | 0/4 | **4/4** | q₀ = 0.70 — the ADR-0034/0036 boundary, gone without common-mode |
| 32 | 0/4 | **4/4** | q₀ = 0.84 — beyond even common-mode's old reach |

**AC-3 (room-0, spraypoint):** Δ=2 rank-1 4/4 (z: 2/4, with a WRONG-room rank-1 on one seed);
Δ=3, 4: 4/4 exact minimal sets. **The dilution attribution floor improves 3 → 2** in the
regenerated coverage matrix. Δ=1 stays unattributed (published floor unchanged).
**AC-4:** uniform elevation → `__fleet__` rank-1, culprits length 1, drains empty of it;
room-patterned elevation → room-0 rank-1, fleet not picked. **AC-5 (C1):** δ=128 → exactly
[optic-3] both seeds — the z scorer returned [room-0, room-1], confidently wrong-kind.
**AC-6:** same_kind both-in-top-2 2/2 (parity). **AC-7:** the incremental≡batch keystones pass
with the linear currency active (the session's running residual sums reproduce `leafTStats`
exactly). **AC-1/AC-8:** full suite green; the exactly-minimal-set and quiet-decoy tests in
`test/linear-magnitude.test.ts` kill the μ·y-drop, −μ²/2-drop, fold-drop, and charge-drop
mutants; a targeted sprag mutation pass on `tomography.ts` scored **90% (38/42)**. The four
survivors are ONE cluster — the linear admission gate (`isExplainedLinear` boundary and
`hasUnexplainedFiringLinear`): on every measured geometry it is a REDUNDANT defense behind the
ML fold (which zeroes exactly the residuals the gate would test) and the ln R charge (which
blocks what remains), so its mutants change no observable outcome. Kept as defense-in-depth
mirroring the binary path's ADR-0022 gate; recorded as benign-redundant rather than bound by a
contrived fixture (the ADR-0009 "benign surviving mutant" precedent).

**Phase-2 coverage diff (the cutover bar — full regenerated matrix vs committed):**
- Floors: ALL unchanged except room dilution attribution **3 → 2 (improvement)**. Clean-fabric
  FDR sections unchanged (0 FP). Paper-scale scale-proof section unchanged (rank-1 preserved).
- Sub-floor knee cells (below every published floor, recorded honestly): optic Δ=1 attribution
  75% → 50%, fiber_bundle Δ=1 50% → 25%, covariance_flip Δρ=0.2 attribution 50% → 0%,
  oscillation amp=0.7 attribution 25% → 0% — single-seed weak-evidence flips where the linear
  model disagrees with z on sub-floor magnitudes; not chased (anti-gold-plating), listed.

**Superseded/retired on the record:** the ADR-0034 "accept the bounded limit" decision (both its
root causes are now moot in production: nothing saturates, no scalar null to corrupt); the
ADR-0036 payoff role of common-mode for high-δ localization (the mechanism stays, opt-in, and
must not regress recovery — re-bound in common-mode.test.ts); the ADR-0033 raw-vs-calibrated z
band tradeoff (both z scales remain only as the epoch'd-run currency and the recorded control).
The ADR-0028 "revisit full-support cross-optic only with a magnitude-aware member model"
condition is now discharged by an actually-linear member model.
