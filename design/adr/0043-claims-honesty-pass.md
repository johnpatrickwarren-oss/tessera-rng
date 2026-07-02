# ADR 0043 — Claims-honesty pass: leaf-count overclaim, GROW check, the every-tick-query boundary pinned

- **Status:** ACCEPTED (docs/claims only — **no behavioral code change**; one `src/` doc-comment
  extended). Motivated by an external-literature review (2026-07-02) that dove into the math and
  the published claims against the tomography / anytime-valid-inference / production-systems
  literature.
- **Date:** 2026-07-02
- **Decision owner:** Tessera-RNG
- **Relates to:** ADR-0027 (incremental session; the every-tick narrowing), `VALIDATION.md`,
  `Writings/rng-fault-localization.md`, `src/session.ts`.

---

## 1. Leaf-count overclaim — FIXED

`Writings/rng-fault-localization.md` claimed e-BH FDR control "across all 10³ to 10⁶ leaves at
once." The monitored-leaf bound is **[100, 10000]** (AC-1); 10⁶ is the per-microflow count the
path-class aggregation exists to *avoid* (ADR-0001). The sentence now says 10³–10⁴ path-class
leaves and credits the aggregation for holding the count there. One-sentence fix; the rest of the
piece already states the honest posture.

## 2. GROW / growth-optimality claims — CHECKED, NONE FOUND

The literature review flagged that the Safe-Hotelling e-process's GROW-optimality (Pérez-Ortiz,
Lardy, de Heide & Grünwald, AoS 2024) requires group *amenability*, and GL(d) — the full
Hotelling invariance group — is **non-amenable**, so growth-optimality must not be claimed for
d > 1 without qualification. Grepped the repo (`README.md`, `VALIDATION.md`, `Writings/`, `src/`,
`design/spec/`): **no Tessera-RNG doc claims GROW/growth-optimality** for any detector — we claim
validity (Ville) only. Recorded here so a future doc does not innocently add the claim: if Family
C optimality language is ever wanted, it must carry the amenability qualification.

## 3. The every-tick-query narrowing — PINNED to its exact boundary (not removed)

ADR-0027 recorded: "querying every tick and acting on the first positive is a stopping rule —
each query is valid, but the published FDR figure describes a single query." The 2025–26
literature lets us state the boundary of that narrowing *precisely* instead of vaguely:

- **Stopped e-BH** (Wang, Dandapanthula & Ramdas, arXiv:2502.08539): e-BH over stopped
  e-processes controls FDR **at an arbitrary stopping time** — but the clean guarantee needs
  **independent streams**, and the dependent case needs a **causal no-leakage condition**
  (no unobserved confounding across streams through time). Tessera's leaves are correlated *by
  design* (shared hardware is the product premise, P1), and we have NOT established the causal
  condition for them. So the theorem is a candidate upgrade, not a license — the single-query
  framing stands.
- **The ARL-vs-FDR impossibility** (Dandapanthula & Ramdas, arXiv:2501.04130): any multi-stream
  change-detection procedure with finite average run length has trivial worst-case FDR. So an
  unqualified streaming "FDR ≤ q at all times" claim is not merely unproven for us — it is
  **impossible in the worst case**, for anyone. The controllable streaming metric is
  **error-over-patience (EOP)**, which their e-detector + e-BH construction controls under
  arbitrary dependence, uniformly over stopping times.

**Decision:** keep the single-query claim; sharpen its stated boundary in `src/session.ts` and
`VALIDATION.md` (done). **Recorded future adoption:** if/when the detection layer moves to
e-detector form (the Shin–Ramdas–Rinaldo e-SR recursion — also the candidate fix for the
ADR-0018 epoch wealth-reset power loss, an engine-extension conversation), the session can adopt
EOP as its *published, controlled* streaming metric. That is the honest end-state: not a stronger
FDR claim, but the right metric with an actual guarantee.

## Verification note

Both papers' claims were verified against their arXiv abstracts at decision time (2026-07-02);
the stopped-e-BH "causal condition" is characterized from the abstract's own language ("excludes
unobserved confounding from the past"; guarantee stated cleanly for independent streams). If the
full text turns out to license our dependent-leaf case directly, the upgrade is a new ADR, not an
edit to this one.

## Consequences

- No test or artifact changes (no behavior changed); 241 tests and the gate must stay green.
- `VALIDATION.md` Tier-2 "no FP blowup" row now carries the streaming-boundary caveat inline —
  the instrumented-caveat discipline applied to a *claim* rather than a measurement.
