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
| No false-positive blowup on clean fabrics | 4 clean trials/fabric, mean selected = 0, FP rate 0 | Corroborates that the per-path-class e-values are valid in the **synthetic null**. It is **not** a measured FDR curve over many/varied null regimes. FDR control itself is an engine-level *theorem*, conditional on valid e-values. |
| Localization on the synthetic incidence model | optic/panel/room/cross-kind faults localize rank-1; minimal explaining set; `correlational_not_causal` flag + unexplained set always reported | The incidence model is **partly shaped around the scorer**: ADR-0028 omits the real per-ToR cross-optic edges (`1/(nTors−1)`) because the binary fire/quiet noisy-OR collapses under full support. ADR-0029 (magnitude-aware scorer) is the proposed fix; until built, full physical incidence is not modeled. |
| Multi-fault ranking | cross-kind pairs recover both-in-top-2 on tested cases | Under-sampled (n=2); "tested cases," not a characterized regime. |
| Paper-scale computational feasibility | full stack at 960 ToRs / 1,456 leaves / ~513k weighted edges, clean selection 0, representative faults rank-1 | A **computational** smoke proof (it runs, deterministically, at scale) — not a statistical power study at scale. |
| ToR-pair drill-down | operator-initiated; fleet → fault domain → impacted pairs, truncation always reported | A **prototype**, not a production diagnostic: residual-level synthetic window, selection-conditioned FDR, id-order truncation sampling; production needs pair-level calibration. |
| Degradation / sensitivity envelope (ADR-0032) | `coverage-matrices/degradation-saturation.{json,md}`: detection + attribution measured as telemetry quality degrades along 4 axes (signal noise, missingness, observation delay, aggregation/weight error), n=32 per cell, frontier stable across a held-out seed block | Synthetic perturbation of the clean stream — a breakdown frontier *on the model*, not real-telemetry robustness. **Headline finding:** the dominant failure mode is **silent mis-attribution, not silence** — detection stays ~100% while attribution collapses; and **signal noise is the sharpest axis** (attribution gone by ~0.5σ of added uncalibrated noise, which floods the noisy-OR localizer with spurious firing leaves and tips rank-1 to the wrong resource). Weight/aggregation error, by contrast, is the most robust axis (the localizer tolerates ±90% incidence-weight mismatch). Routing churn is **not** an axis here (reuses the ADR-0017/0018 epoch machinery). |

**Status: sufficient for the synthetic model; do not read as operational performance.** The
degradation envelope now bounds *how far* the model tolerates departures — synthetically.

## Tier 3 — external validation (NOT done — deliberately out of v1 scope)

Nothing in this tier is validated. These are the claims a reader might *assume* and must not.

| Claim | Status | Why it's missing |
|---|---|---|
| The five-signal telemetry contract is realistic | **NOT validated** | `p99_latency`, `retransmit_rate`, `loss_rate`, `ecmp_imbalance`, `path_completion` are *assumed* to be observable, stable, attributable at the path-class/view level, and timely. ADR-0013: the RNG paper validates topology/routing/path-diversity/scale but **not operations/telemetry** — the contract is *unfalsified, not validated*. Localization quality rides on this. |
| Localization works on a real RNG fabric | **NOT validated** | No real fabric, routing/controller state, or incident labels have been replayed. |
| FDR does not blow up in real null regimes | **NOT validated** | Only synthetic clean fabrics measured (above). Real correlation structure, drift, and missingness are untested. |
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
