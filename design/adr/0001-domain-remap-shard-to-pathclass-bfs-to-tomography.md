# ADR 0001 — Domain remap: shard→path-class, BFS-attribution→tomography

- **Status:** Accepted
- **Date:** 2026-06-08
- **Decision owner:** Tessera-RNG (archgate single-agent build)
- **Supersedes:** —

---

## Context

Tessera-RNG forks Tessera from GPU-cluster observability to flat random-graph (RNG-family)
datacenter network observability (quasi-random graph fabric, distributed edge-disjoint-path
routing, passive optical shuffle cabling). Two facts about the new domain force a remap:

1. **The monitored entity changes.** Tessera's leaf is a GPU shard. Here the leaf is a
   **path-class**: an aggregated equivalence class of flows between a ToR-pair (not a
   per-microflow). This keeps the e-process count tractable (10^3–10^4 leaves, not 10^6
   microflows) while remaining the unit at which degradation is observable.

2. **Hop distance no longer encodes fault containment.** Tessera's attribution
   (`attributeCommonMode` in the engine) is a **BFS over undirected hop distance** — it
   assumes proximity implies a shared fault domain (true for shard→host→rack). On an
   expander / quasi-random graph the diameter is tiny: every node is ~2–3 hops from
   everything, so hop distance carries almost no localization signal. This is Tessera's own
   recorded R78 brittleness finding, and it is *structural* here, not incidental.

The statistical multiplicity machinery, by contrast, transfers unchanged: the per-shard
runtime (Welford + warm-start) is signal-agnostic; hierarchical e-value combination and
e-BH FDR control FDR **under arbitrary dependence**, which is load-bearing because
path-class signals are heavily correlated through shared fiber/optic/shuffle hardware.

(Verification, per halt-on-contradiction: the engine imports cleanly as a git-dep and the
relevant surfaces run — proven by `test/smoke-engine-import.test.ts`, 5/5 green. The closed
topology unions that motivate ADR-0002 were confirmed by grepping the engine source, not
assumed.)

## Decision

1. **Map the path-class to the engine's "shard" abstraction.** Each path-class is a leaf;
   its residual stream feeds the existing per-shard runtime; roll-up uses the engine's
   hierarchical combination, and the verdict surface uses e-BH FDR — all **reused, not
   reinvented**, at the engine's declared extension points.

2. **Do NOT reuse the engine's BFS `attributeCommonMode` for localization.** Replace it
   with a new product module: **tomographic localization**. Model the topology as a
   **fault-domain incidence hypergraph** — each path-class maps to the set of shared
   physical resources it traverses (optic → passive shuffle device → fiber bundle →
   linecard → switch → cooling/power zone). Given the firing path-class set, solve the
   inverse problem: find the minimal set of shared resources whose failure explains the
   degraded-path set (sparse recovery / group testing / set-cover MAP over the incidence
   matrix). This is network tomography, and it *exploits* RNG's many edge-disjoint paths —
   the same path diversity that masks failures makes the measurement matrix well-conditioned
   and the inversion identifiable. That identifiability is the core product thesis.

3. **Calibration and actuation remap, not reinvent.** Reuse the production-AR substrate
   calibrator for network signals (p99 latency, retransmit rate, loss, ECMP imbalance,
   path-completion), with per-cell baselines (hour-of-day × day-of-week × traffic-class).
   Tessera's freeze-hook pattern maps to a **route-drain hook** (simulated in v1).

## Consequences

- The localization solver is the new math and carries v1's real risk — it gets the most
  test pressure and a mutation-testing pass (DISCIPLINES §6).
- The engine stays unforked; everything new lives in `src/` as product code consuming the
  engine's public surface.
- The topology-carrying mechanism cannot ride inside the engine's `TopologySnapshot`
  (closed node/edge unions); how the incidence model is typed and loaded is decided
  separately in **ADR-0002**.
- The tomography must not over-claim: it identifies a shared-resource **set**, not a
  specific marginal optic. Hardware root-cause stays out of scope (mirrors Tessera's A10
  carve-out); every culprit carries a `correlational_not_causal` flag.
