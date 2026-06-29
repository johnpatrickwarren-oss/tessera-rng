# ADR 0037 — Engine consumption review: e-BH boost REJECTED, fleet/localize RECONCILED

- **Status:** ACCEPTED (decision record; no code change). Following the "expand consumption, don't
  re-engineer" directive, the two remaining candidate engine capabilities were evaluated. **e-BH
  conditional-calibration: rejected on the evidence** (no power for Tessera's e-process e-values).
  **`fleet/localize`: reconciled — kept Tessera's `tomography.ts`** (a different problem, ADR-0001).
- **Date:** 2026-06-29
- **Decision owner:** Tessera-RNG (post-v1; companion to ADR-0036, which ADOPTED the common-mode)
- **Relates to:** ADR-0036 (the adopted common-mode), ADR-0001 (engine never forked; tomography is
  Tessera's new math), ADR-0016/0019/0022 (the tomography this would-not replace).

---

## Candidate 1 — `fleet/e-bh-conditional-calibration` (e-BH boosting): REJECTED on the evidence

**Hypothesis:** the engine's `eBHConditionalCalibration` (Lee–Ren closed-form boost) is a drop-in
for the `surface.ts` e-BH step that returns a deterministic superset (more detection power) with
FDR ≤ q preserved — free power at an extension point already consumed.

**Measured (cross-optic fabric, plain vs boosted with the always-valid Markov null survival
`min(1, 1/x)`):**

| scenario | plain e-BH selected | boosted selected |
|---|---|---|
| clean (δ=0), 4 seeds | 0 | 0 |
| δ=1.5 / δ=2 (at the floor) | 2 / 8 | 2 / 8 — **identical** |

**Zero boost, every case.** Root cause (principled, not just empirical): the boost exploits a null
survival *thinner* than the worst case. Tessera's per-path e-values are **e-processes** (Family A
betting martingale, Family C Safe-Hotelling, merged mean-of-families), and an e-process sits at its
**Ville bound** `P(sup ≥ x) ≤ 1/x` — which IS the Markov tail. There is no slack between the actual
null tail and worst-case for the boost to convert into power.

**Decision: do NOT adopt.** A real boost would require a *tighter* closed-form null survival than
`1/x` for Tessera's heterogeneous mean-of-families e-value — which (a) does not exist in closed form
and (b) would be *deriving new statistics*, the opposite of the "consume, don't re-engineer"
directive. The conservative fallback is provably zero-gain. Revisit only if a family's e-value is
ever replaced by one with a known sub-Ville null tail.

## Candidate 2 — `fleet/localize` (`localizeFaults`): RECONCILED, not adopted

`localizeFaults` and Tessera's `tomography.ts` **solve different problems**:

| | engine `localizeFaults` | Tessera `tomography.ts` |
|---|---|---|
| Output | per-**shard** victim e-value + ranked victim shards | the shared **resource** (optic/panel/room) whose joint failure explains the firing leaves |
| Method | detection-common-mode residual → UI e-value → topology-partitioned e-BH | inverse problem: saturating leaky noisy-OR over the incidence hypergraph (marginal-LLR cover) |
| Layer | ≈ Tessera's **detection + surface** (which entities fired) | the **downstream attribution** the engine does NOT do |

The engine localizes *which leaves are victims* — which is essentially what Tessera's e-BH surface
already produces. Tessera's tomography is the **next step the engine has no equivalent for**: mapping
the victim leaf set back to the causal shared physical resource on the RNG incidence hypergraph
(ADR-0001's "new math"; the binary→magnitude noisy-OR of ADR-0019/0029). Adopting `localizeFaults`
would replace a *resource-attribution* layer with a *victim-ranking* one — a regression in capability,
not a consumption.

**Decision: keep `tomography.ts`.** It is not a reimplementation of engine code — it is the
domain-specific inverse the engine does not provide. (Note: the engine's `localizeFaults` *internally*
uses `detection-common-mode` — the same robust-common-mode family ADR-0036 consumed at the
`robustLocation` primitive — confirming the consumption boundary is drawn at the right granularity.)

## Anti-scope

- **Not forking / not re-deriving** — both decisions keep Tessera at consumed extension points; #1
  declines new statistics, #2 declines a capability swap that would lose function.
- **No silent rejection** — both are recorded with the measurement / the model comparison, so a future
  reader can re-open either on a concrete trigger (a sub-Ville e-value; or an engine localize variant
  that outputs resource attribution).

## Consequences

- The "expand consumption" review concludes: **1 adopted (common-mode, ADR-0036), 1 rejected (e-BH
  boost — no power), 1 reconciled (localize — different problem).** Consumption was expanded exactly
  where the engine adds capability Tessera lacks, and declined where it would add nothing or subtract.
- The honest takeaway: "consume don't rebuild" is right *when the engine solves the same problem
  better* — verified per-candidate, not assumed.
