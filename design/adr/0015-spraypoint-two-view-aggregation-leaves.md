# ADR 0015 — Spraypoint two-view aggregation leaves (resolves the path-class-scale question)

- **Status:** Accepted
- **Date:** 2026-06-09
- **Decision owner:** owner-resolved (work-order item 5, HALT-CLASS), built by Tessera-RNG round 3
- **Supersedes:** amends AC-1; adjacent to ADR-0014

---

## Context

The paper (ADR-0013) puts production at ~960 ToRs ⇒ **~460K ToR-pairs**, which does not fit AC-1's
`[100, 10000]`. Routed to the owner as a spec question (item 5, HALT-CLASS); resolved as **Option 1
(coarser equivalence classes), refined**. The owner corrected the framing: the scale problem is **not**
calibration sample budget — calibration already pools across leaves (`cellKey` has no path-class
component; AR(p) is per-signal-global; per-leaf state is only e-process wealth, which needs no
samples). The real problem is **per-leaf heterogeneity**: at 460K ToR-pairs the leaves have genuinely
different baselines (path-length distributions differ by pair), so the shared cell baselines become
**misspecified**. And under Spraypoint a single-component fault is intrinsically **diluted everywhere**
(one optic ≈ 1/d of one ToR's sprayed traffic, smeared over ~all its pairs) — per-leaf SNR is tiny;
detection power comes from **aggregating** many weakly-affected leaves that share fault exposure (m
leaves keep the mean shift δ but cut noise by √m).

## Decision

The monitored leaf is an **aggregation-view class**, and the leaf set is the **union of two
complementary views** over the same underlying ToR-pair traffic, because the "right axis" differs by
fault kind:

- **`per_tor`** (~nTors leaves) — concentrates **optic/router** faults (a faulty ToR's pairs all
  share its optic), smears panel/room faults.
- **`per_panel_pair`** (~C(nPanels, 2) leaves) — concentrates **shuffle-panel/room** faults, smears
  optic faults (a faulty ToR is 1/nTors of a pair leaf).

The views are **dependent** (same underlying flows) — fine, because e-BH and the e-value merges are
arbitrary-dependence valid (P1, the reason they were chosen; the clean Spraypoint fabric still selects
nothing across both views). Incidence is **weighted** (ADR-0014): a view's weights are the fraction of
its aggregate traffic through each resource (`per_tor`: w=1 on its own optic, 1/nPanels per panel;
`per_panel_pair`: w=1 on both panels, 1/nTors per optic). `src/spraypoint.ts`
(`generateSpraypointFabric`, defaults 64×10×2 = 109 leaves) emits both views with their weights and a
`shuffle_panel`/`room` taxonomy faithful to the paper's ShuffleBox/rooms.

**AC-1 amended:** keep `[100, 10000]`; the counted leaf is an aggregation-view class; the view
definitions are recorded in the snapshot (`FaultDomainSnapshot.views`, part of the hash ⇒ part of
replay). **ToR-pair stays the underlying entity** (ADR-0001 §3.1 intact); per-pair drill-down is
future scope, not deleted scope.

## Consequences

- **Complementary blind spots, measured and published.** An optic fault is caught by `per_tor` only
  (1/nTors-diluted, blind in `per_panel_pair`); a panel fault is caught by `per_panel_pair` only
  (1/nPanels-diluted, blind in `per_tor`); a room fault (coarse) shows in both. All three localize to
  the faulty resource over the union. Bound by `test/spraypoint.test.ts` (the blind-spot assertions
  are the anti-self-confirming core — they fail if the views collapse together) and published as a
  **per-view column** in the coverage matrix (honest measurement; a fault kind that neither view
  concentrated would appear as a gap).
- **The aggregation adds power in the spray regime.** Aggregating m fault-sharing leaves keeps δ and
  cuts noise by √m, trading the ToR-pair's measurement-matrix diversity (which the weighted tomography
  no longer needs, ADR-0014) for per-leaf SNR — deliberately, per the owner's analysis.
- **N1–N5 intact; v1 unaffected.** The two-view fabric is a new generator; the default `generateFabric`
  and all existing scenarios are unchanged (121 tests green). The snapshot `views`/weight fields are
  additive and replay-clean.
- **Honest limits.** The synthetic spray model is full-mesh (every ToR reaches every panel) with
  uniform per-resource weights — a faithful-enough caricature, not the paper's exact spray
  distribution; scaled to 64×10×2, not 960×… . A long-tail spray distribution and the real ShuffleBox
  internal shuffle are future fidelity, recorded not hidden.
