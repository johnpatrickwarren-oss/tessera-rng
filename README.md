# Tessera-RNG

**Operational observability for flat random-graph (RNG-family) datacenter networks** —
anytime-valid per-path-class verdicts, e-BH FDR over correlated entities, and tomographic
localization of shared physical fault domains.

A fork of [Tessera](https://github.com/johnpatrickwarren-oss/tessera) (GPU-cluster shard
observability) that **reuses the same statistical engine**
([`deploysignal-engine`](https://github.com/johnpatrickwarren-oss/deploysignal-engine)) as a
git-dependency — never forked — repointed from cluster shards to network **path-classes** and
physical **fault domains**.

## The problem

A flat random-graph fabric (quasi-random graph topology, distributed edge-disjoint-path
routing, passive optical shuffle cabling) trades structural observability for resilience. Its
redundant paths smear failures across many flows and mask them with automatic re-routing — so
by the time a threshold alarm fires, the path-margin is already spent. Two hard problems
follow, and Tessera-RNG addresses both:

1. **Multiplicity at scale** — monitor 10³–10⁴ heavily-correlated path-classes without
   false-positive blowup. *Solved by reuse:* hierarchical e-value combination + **e-BH FDR**,
   which controls the false-discovery rate **under arbitrary dependence** (load-bearing, since
   path-class signals are correlated through shared fiber/optic/shuffle hardware).
2. **Localization** — turn "something shifted" into "this shared physical resource is the
   culprit" on a topology where **hop distance does not encode fault domain**. *Solved by new
   math:* network tomography — a noisy-OR set-cover MAP over a fault-domain incidence
   hypergraph. RNG's many edge-disjoint paths make the measurement matrix well-conditioned, so
   the same path diversity that masks failures makes the inversion identifiable.

## How it works

```
synthetic raw telemetry            per-cell calibration            per-path-class detection
(5-signal vectors, per-cell  ──▶   (HoD × DoW × traffic-class) ──▶  Family A (mean-shift) +
 baseline "smear" + injected        raw → standardized residual      Family C (distributional)
 resource degradation)                                                      │
                                                                            ▼
   simulated route-drain   ◀──  tomographic localization   ◀──  hierarchical combine + e-BH
   (on the rank-1 culprit)      (minimal shared-resource set,    FDR surface (which path-
                                 correlational-not-causal)        classes are degraded)
```

Everything is deterministic and replay-clean: the same incidence model + telemetry stream
produce a byte-identical `AuditRecord`.

## Quickstart

```bash
pnpm install          # resolves the engine git-dep (deploysignal-engine#v0.3.1-pre)
pnpm test             # tsc -p tsconfig.test.json && node --test test/*.test.js
pnpm typecheck
pnpm demo             # -> demos/demo.html  (six deterministic scenarios, single file)
pnpm coverage         # -> coverage-matrices/coverage-saturation.{json,md}
pnpm gate             # sprag architectural gate over the repo
```

Requires Node ≥ 20 and pnpm ≥ 11.

## What's in v1

Synthetic fixtures only (no live fabric). Per-path-class anytime-valid verdicts from Family A +
Family C with per-detector α-budget; hierarchical e-value combination + e-BH FDR; a
fault-domain incidence model via a `FaultDomainSource`; the tomographic solver (100% mutation
score); a simulated route-drain hook; per-cell calibration; a six-scenario single-file demo;
and honest coverage/saturation + detection-and-attribution-floor matrices with FDR-control
evidence.

The statistical layer localizes to a shared-resource **fault domain**, never to a specific
marginal optic — hardware root-cause is out of scope, and every culprit carries a
`correlational_not_causal` flag.

## Built with archgate

This repo was built under the **archgate** discipline: the Anchor disciplines as an
in-context contract ([`DISCIPLINES.md`](DISCIPLINES.md)) plus the **sprag** gate as a
deterministic architectural floor ([`arch-gate-usage.md`](arch-gate-usage.md)). Spec-first and
impl-blind, anti-scope-first, every conjunct bound to a test, with a cold-eye review before
v1 was declared done.

- [`STATE.md`](STATE.md) — the cold-readable "now".
- [`design/spec/v1-spec.md`](design/spec/v1-spec.md) — the v1 contract (anti-scope first; ACs).
- [`design/adr/`](design/adr/) — one ADR per real decision (start at ADR-0001).

## License

Apache-2.0.
