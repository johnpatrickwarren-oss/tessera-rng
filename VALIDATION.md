# VALIDATION — what is and isn't validated

Tessera-RNG is a **synthetic research prototype**. Its machinery — detection, selection,
tomographic localization, replay, audit — is implemented and meaningfully tested *against a
synthetic model of an RNG fabric*. It has **not** been validated against real telemetry, real
fabrics, or real incidents, and v1 deliberately does not attempt to (see the anti-scope in
`CLAUDE.md` and `design/spec/v1-spec.md`).

This file exists so no reader mistakes Tier-2 evidence (the model is internally coherent and
behaves as designed) for Tier-3 evidence (the model matches the world). The single most
load-bearing unvalidated assumption is the **five-signal telemetry contract** (§Tier 3).

> Read this before reading any claim in the README or an ADR as operational. A guarantee proved
> here is proved *under the synthetic null*; where that is narrower than the prose suggests, it
> is said so plainly below.

---

## Tier 1 — implementation invariants (validated)

Properties of the code as written, independent of whether the synthetic model is realistic.

| Property | Evidence |
|---|---|
| Pipeline runs end-to-end | fabric → signal gen → calibration → per-path-class detection → e-BH surface → tomography → simulated drain → audit; 241 tests green |
| Deterministic & replay-clean | same incidence model + telemetry stream ⇒ byte-identical `AuditRecord`, across reroute epochs and multi-fault runs |
| Incremental ≡ batch (anytime) | `openSession`/`ingest`/`audit` bound byte-for-byte to the batch pipeline at the final tick (ADR-0027 keystone) |
| Traffic model coherence | view weights and drill exposures enumerate one elementary flow space, bound by keystone tests independent of the closed forms (ADR-0028) |
| New math mutation-checked | mutation passes recorded per round in the ADR trail (localization math at/near 100%) |
| Architectural floor | sprag gate green; complexity/size/require-tests invariants enforced |

**Status: sufficient.** These are the strongest claims in the repo and they are well-supported.

## Tier 2 — synthetic-model validation (validated *for the synthetic model*)

Properties of the statistical method, measured on synthetic fabrics. Real-world reach is bounded
by Tier 3.

| Property | Evidence | Honest caveat |
|---|---|---|
| Detection / attribution floors per anomaly mode | `coverage-matrices/coverage-saturation.{json,md}` | **n=4** per cell (2 seeds × 2 targets); multi-fault **n=2**. Coarse, grid-resolution-limited point estimates — regression artifacts, not robust operating curves. Variance is **not** characterized. |
| No false-positive blowup on clean fabrics | 4 clean trials/fabric, mean selected = 0, FP rate 0 | Corroborates that the per-path-class e-values are valid in the **synthetic null**. It is **not** a measured FDR curve over many/varied null regimes. FDR control itself is an engine-level *theorem*, conditional on valid e-values — and it describes a **single query**: for the streaming session, FDR at an arbitrary data-dependent stopping time is licensed (stopped e-BH, arXiv:2502.08539) only for independent streams or under a causal condition not established for our correlated leaves, and finite-ARL + nontrivial worst-case streaming FDR is provably impossible (arXiv:2501.04130). The controllable streaming metric is **error-over-patience (EOP)** — a recorded future adoption, ADR-0043. |
| Localization on the synthetic incidence model | optic/panel/room/cross-kind faults localize rank-1; minimal explaining set; `correlational_not_causal` flag + unexplained set always reported | The incidence model is **partly shaped around the scorer**: ADR-0028 omits the real per-ToR cross-optic edges (`1/(nTors−1)`) because the binary fire/quiet noisy-OR collapses under full support. ADR-0029 (magnitude-aware scorer) is the proposed fix; until built, full physical incidence is not modeled. |
| Multi-fault ranking | cross-kind pairs recover both-in-top-2 on tested cases | Under-sampled (n=2); "tested cases," not a characterized regime. |
| Paper-scale computational feasibility | full stack at 960 ToRs / 1,456 leaves / ~513k weighted edges, clean selection 0, representative faults rank-1 | A **computational** smoke proof (it runs, deterministically, at scale) — not a statistical power study at scale. |
| ToR-pair drill-down | operator-initiated; fleet → fault domain → impacted pairs, truncation always reported | A **prototype**, not a production diagnostic: residual-level synthetic window, selection-conditioned FDR, id-order truncation sampling; production needs pair-level calibration. |
| Degradation / sensitivity envelope (ADR-0032, re-baselined under the linear scorer ADR-0046/0048) | `coverage-matrices/degradation-saturation.{json,md}`: detection + attribution measured as telemetry quality degrades along 4 axes (signal noise, missingness, observation delay, aggregation/weight error), n=32 per cell | Synthetic perturbation of the clean stream — a breakdown frontier *on the model*, not real-telemetry robustness. **Headline finding:** the dominant failure mode remains **silent mis-attribution, not silence** — detection stays ~100% on every axis — but the linear scorer (ADR-0046) moved the frontier substantially: signal-noise attribution now survives to **~0.5σ (81%)** and degrades gracefully (was collapsed to 0% at 0.5σ under the z scorer), missingness holds 94% at 0.8 drop-prob (was 0%), observation delay never breaks across the grid (was 8 ticks), aggregation error tolerates ±90% mismatch (unchanged). The extreme joint (1σ uncalibrated noise + 25% missing) still zeroes attribution — the recorded fix direction is live-calibration tracking, not scorer features (ADR-0048). Routing churn is **not** an axis here (reuses the ADR-0017/0018 epoch machinery). |
| Heterogeneity boundary — where SELECTION validity breaks (ADR-0050) | `coverage-matrices/heterogeneity-boundary.{json,md}`: false selections on NULL fabrics under per-leaf scale dispersion (ς), correlated-null latent factors, fleet-size ramp to 6112 leaves, cal→live drift; n=8 (n=3–5 at scale, truncations recorded) | The clean-fabric FP=0 rows above were measured at **ς=0 by construction** — this row maps what they could not see. **Boundary: sharp and early** — 0 false selections at realized ς≈0.06 but ≈5% of the fleet false-selects at ς≈0.12 (100% of runs), saturating ≈17% by ς≈0.35; a constant ς-determined *fraction* fails at every scale (linear counts, no cascade, no protection; ~173/window at paper scale). **Positive:** correlated null alone (load ≤ 0.5) breaks nothing — e-BH's arbitrary-dependence theorem holds; dispersion, not correlation, is the wall. `commonModeRobust` does **not** mitigate (per-leaf scale ≠ shared level). Not a power study (null runs only); not a real-fabric ς estimate — the recorded prerequisite for real-fabric (N2) claims is a ς̂ **gate** (follow-up ADR). |
| ς̂ dispersion gate (ADR-0051) | `coverage-matrices/dispersion-gate.{json,md}`: recovery + operating characteristic on the known-ς generator + a tail-contamination kill-test, n=8/cell | The PAIR gate — max(robust ς̂, tail ς̂); the robust statistic alone launders tail-contaminated fleets (cold-eye-demonstrated, corrected on the record) — passes 100% on clean fabrics (ς̂ 0.009/0.006) and **fails 100% at every cell where selection lies**, including the 10%-at-2× contaminated fleet the robust core is blind to; the threshold-straddling cell (realized ς 0.059 vs ς\*=0.05) passes 13% — conservative by design. Tail ς̂ tracks realized ς almost exactly (0.335 vs 0.353). Gates the FDR **claim**, never the alarm. ROC measured on the Gaussian-ς family + the two-point contamination case; threshold justified by the SYNTHETIC boundary only. |
| Per-leaf scale calibration (ADR-0052) | `coverage-matrices/per-leaf-scale.{json,md}`: ADR-0050 H/D axes OFF vs ON, n=8/cell, OFF rows anchor-bound to ADR-0050 | Shrunk per-leaf correction (λ = ς̂²/raw²) **absorbs static dispersion completely** (0.00 false selections through ς=0.5; injects <0.025 at ς=0) — but **full cal→live drift REVERSES it: 25.25 false selections vs 9.88 uncorrected at that cell (≈15.5 at the realized-ς-matched reference)** — two recorded mechanisms: stale-correction compounding + a tightened Family C/D null. The cliff's detector is the ADR-0053 runtime monitor (next row); the gate alone cannot see staleness (it refits at every re-calibration — recorded correction). Opt-in, no default flip. |
| Runtime drift monitor (ADR-0053) | `coverage-matrices/drift-monitor.{json,md}`: cliff detection + shared-regime consistency + pattern fixtures + resolvability, n=8/cell | The live-window dispersion estimate with a THREE-state verdict — `indeterminate` when the window's sampling floor exceeds the threshold (an early audit never reads ok). **Detects the ADR-0052 cliff**: 100% at driftMix ≥ 0.5 (false selections ≥ 3.13); the mild 0.25 cell detects 13% (0.25 false sel — published, not smoothed). Pattern: fleet (recalibrate) vs tail (subpopulation — ambiguous with genuine localized variance faults, recorded). **Threshold is regime-dependent** (measured): shared-calibration clean-fabric ς̂ 0.009 → ς\*=0.05; fresh perLeafScale corrections carry ≈0.03–0.06 correction noise (envelope max 0.0594) → operating threshold 0.07, ≈0.011 margin each side. License rule: gate passing AND monitor ok. |
| ς power axis (ADR-0054) | `coverage-matrices/heterogeneity-power.{json,md}`: faulted runs (δ=3 optic) across ς × {shared, perLeafScale}, n=16/cell, inert cell anchor-bound byte-for-byte to runPipeline | Closes ADR-0050's "not a power study" caveat. **Detection never fails (100% at every ς); attribution survives 5.4 false co-selections (100% at ς=0.1) then collapses to 0% at ς=0.2 — toward WRONG PHYSICAL RESOURCES, never the fleet-event candidate** (confident wrong-hardware paging: the ADR-0032 silent-mis-attribution shape with dispersion as a measured cause). perLeafScale restores 100% attribution / 0 false co-selections at every tested ς. Material-incidence metric (w ≥ 0.5) — the crossOptic ε-edge degeneracy caught and disclosed. |

**Status: sufficient for the synthetic model; do not read as operational performance.** The
degradation envelope now bounds *how far* the model tolerates departures — synthetically; the
heterogeneity boundary bounds *how much per-leaf scale dispersion* the selection layer tolerates
(very little — realized ς below ≈0.1); the gate (ADR-0051) makes that precondition measurable
in the calibration window, the per-leaf correction (ADR-0052) removes its static part, the
runtime monitor (ADR-0053) detects the correction's drift cliff in the live window, and the
power axis (ADR-0054) shows what dispersion costs on the faulted side (wrong-hardware
attribution) and that the remedy restores it. The license rule across the set: FDR-bearing
readings require gate-passing AND monitor-ok; everything else is Mode-A evidence/ranking.

## Tier 3 — external validation (NOT done — deliberately out of v1 scope)

Nothing in this tier is validated. These are the claims a reader might *assume* and must not.

| Claim | Status | Why it's missing |
|---|---|---|
| The five-signal telemetry contract is realistic | **NOT validated** | `p99_latency`, `retransmit_rate`, `loss_rate`, `ecmp_imbalance`, `path_completion` are *assumed* to be observable, stable, attributable at the path-class/view level, and timely. ADR-0013: the RNG paper validates topology/routing/path-diversity/scale but **not operations/telemetry** — the contract is *unfalsified, not validated*. Localization quality rides on this. |
| Localization works on a real RNG fabric | **NOT validated** | No real fabric, routing/controller state, or incident labels have been replayed. |
| FDR does not blow up in real null regimes | **NOT validated** | Only synthetic nulls measured (above). ADR-0050 bounds the *synthetic* tolerance — selection validity dies at realized per-leaf scale dispersion ς ≈ 0.1, well inside plausible real-fabric heterogeneity — but real-fabric ς itself is unmeasured. The ς̂ gate is now BUILT (ADR-0051): the real-fabric posture is *run it on the real calibration window first*; `passing: false` (or a floor-dominated estimate) means Mode-A evidence/ranking only. The gate's threshold and the per-leaf correction's drift cliff (ADR-0052) are synthetic results — neither is real-fabric-validated. |
| Drain recommendations are operationally sound RCA | **NOT validated** | Drain is *simulated*; no real data-plane wiring, no operator-in-the-loop evaluation. |

**Status: out of scope for v1, by design.** The honest posture is to name this tier, not to
fill it with synthetic stand-ins.

**Citation provenance note (2026-07-02):** the fabric model's source paper was previously
verified only by this repo's own records (a circular attestation). It has now been re-verified
externally: arXiv:2604.15261 exists and is *"RNG: Flat Datacenter Networks at Scale"* (G.
Bernardi, R. Mahajan, C. Seshadhri, et al. — Amazon's production flat-network deployment on
quasi-random graphs; abstract confirms the edge-disjoint-paths framing). Parameter-level figures
(degree, ToR/server counts, path lengths) come from the paper body and remain repo-transcribed
rather than independently re-extracted.

---

## The highest-leverage next step (still in synthetic scope)

External validation (Tier 3) needs real data and is correctly deferred. The most valuable
in-scope work was a **sensitivity / degradation study** — now **built** (ADR-0032, the envelope
row above): it holds the fabric fixed and sweeps signal noise, missingness, observation delay, and
aggregation error, measuring where attribution breaks. That converted "coherent under its own
world" into a *characterized failure envelope* — a bounded, synthetic answer to *how close to the
model must the world be?* — without claiming real telemetry.

What it surfaced sets the next steps, both still synthetic-or-design:
- **Routing-churn axis** — the one degradation axis deferred from ADR-0032 (it reuses the
  ADR-0017/0018 epoch/reroute machinery); measure it against the epoch path.
- **The noise fragility** — attribution collapsing by ~0.5σ of *uncalibrated* noise argues for a
  live-calibration-tracking story and reinforces ADR-0029 (magnitude scorer). A design question,
  owner-deferred.

_Last updated: 2026-06-29._
