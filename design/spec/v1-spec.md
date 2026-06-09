# Tessera-RNG — v1 Specification ("Fuller v1")

- **Spec version:** v1.0.0-draft
- **Status:** Draft — impl-blind. Finalization gated on Q1–Q3 (§7).
- **Date:** 2026-06-08
- **Authority:** This is the contract. Product code conforms to it, not the reverse. Every
  conjunct and prescription below carries a check (§4, §5). Written without reference to
  implementation.

---

## 1. Mission & the two problems

Deliver deterministic, replay-clean, sprag-green operational observability for a flat
random-graph (RNG-family) datacenter network, running end-to-end on **synthetic fixtures**
(no live fabric). It must solve two problems a redundant random-graph fabric creates:

- **P1 — Multiplicity at scale.** Monitor 10^3–10^4 correlated path-classes without
  false-positive blowup. *Resolved by reuse:* hierarchical e-value combination + e-BH FDR,
  which controls FDR **under arbitrary dependence** — load-bearing because path-class signals
  are heavily correlated through shared fiber/optic/shuffle hardware.
- **P2 — Localization.** Turn "something shifted" into "this shared physical resource is the
  culprit" on a topology where hop distance does **not** encode fault domain. *Resolved by
  new math:* tomographic localization over a fault-domain incidence hypergraph (ADR-0001).

---

## 2. Anti-scope — MUST-NEVER (lead with this)

These are hard exclusions for v1. Encountering one mid-build is a halt-and-route-back event
(DISCIPLINES §2), not a silent absorption. Each is bound by a guard check in §4 (AC-N1..N5).

- **N1 — No physical hardware root cause.** The statistical layer localizes to a fault-domain
  / shared-resource *group*. Identifying which exact optic is marginal is hardware-diagnostics
  scope and stays out (mirrors Tessera's A10). The tomography MUST NOT claim more than
  identifiability of the shared-resource set; every culprit is flagged
  `correlational_not_causal`.
- **N2 — No live-fabric validation.** Synthetic fixtures only (operator-controlled or
  generated from RNG topology parameters). No code path reads a live fabric.
- **N3 — No customer telemetry consumption.** No ingestion of real/customer data.
- **N4 — No real data-plane drain wiring.** The route-drain hook is **simulated**; no
  integration with any routing controller.
- **N5 — No re-vendoring / forking the engine internals.** The engine is a git-dependency,
  extended only at its declared extension points and public surface. No engine file is copied
  into `src/` or modified.

---

## 3. Domain model & signal contract (the "what")

### 3.1 Path-class (the leaf entity)
A **path-class** is the monitored leaf: an aggregated equivalence class of flows between a
ToR-pair over the RNG fabric (NOT a per-microflow). It maps 1:1 to the engine's "shard"
abstraction. A v1 fabric carries hundreds–thousands of path-classes.

### 3.2 Per-path-class signal vector (telemetry contract — see Q2)
Each path-class emits, per tick, a vector over network signals:
`p99_latency`, `retransmit_rate`, `loss_rate`, `ecmp_imbalance`, `path_completion`.
Telemetry is synthetic and deterministic (seeded). The contract is operator-overridable.

### 3.3 Fault-domain incidence hypergraph
Physical shared resources form an open taxonomy: `optic`, `passive_shuffler`,
`fiber_bundle`, `linecard`, `switch`, `power_zone`, `cooling_zone`. Each path-class
**traverses** a set of resources (an incidence relation). Loaded via a `FaultDomainSource`
that mirrors the engine's TopologySource *shape* (ADR-0002), built from a synthetic
cabling/shuffle map. Deterministic `snapshotHash` over a canonical form.

### 3.4 Verdict / audit / localization surfaces
- Per-path-class verdict: firing families, per-detector α spent, e-value.
- Fleet surface: hierarchical-combined fleet e-value + e-BH selected set at FDR target q.
- Localization: ranked shared-resource culprits, each with provenance (member path-classes,
  evidence) and `correlational_not_causal: true`.
- Audit record: the full deterministic trace, replay-clean.

---

## 4. Acceptance criteria — every conjunct gets a check

Each AC names the observable behavior and the **binding test** that fails if the behavior is
absent (DISCIPLINES §4, §6 — tests must fail when the bound behavior is mutated/removed).

| AC | Requirement (Given → When → Then) | Binding test |
|----|-----------------------------------|--------------|
| **AC-1** | Given synthetic RNG telemetry across a sampled quasi-random topology of **hundreds–thousands** of path-classes, When ingested, Then every path-class produces a residual stream of the §3.2 signal vector, and the count is in [100, 10000]. | `test/ac01-ingest-pathclass-telemetry.test.ts` |
| **AC-2a** | Given a path-class with a mean-shifted signal, When run through the **Family A** (mean-shift) detector, Then an anytime-valid e-value crosses the fire threshold, and the audit record carries Family A's **per-detector α-budget spent**. | `test/ac02-family-a-verdict.test.ts` |
| **AC-2b** | Given a path-class with a distributional shift, When run through the **Family C** (distributional) detector, Then an anytime-valid e-value fires, and the audit record carries Family C's per-detector α-budget spent. | `test/ac02-family-c-verdict.test.ts` |
| **AC-3a** | Given per-path-class e-values, When hierarchically combined, Then a fleet e-value is produced via a Ville-bounded merge that is valid under arbitrary dependence. | `test/ac03-hierarchical-combine.test.ts` |
| **AC-3b** | Given the per-path-class e-value surface at FDR target q, When e-BH is applied, Then a selected set is returned whose FDR is controlled at q under arbitrary dependence (the weak-evidence entities are excluded). | `test/ac03-ebh-fdr-surface.test.ts` |
| **AC-4** | Given a synthetic cabling/shuffle map (optics, passive shufflers, bundles, zones), When loaded via a `FaultDomainSource`, Then a `FaultDomainSnapshot` with path-class→resource incidence is returned and `snapshotHash` is deterministic (same map → same hash; different map → different hash). | `test/ac04-faultdomain-source.test.ts` |
| **AC-5a** | Given a firing path-class set and the incidence model, When the tomographic solver runs, Then it emits a **ranked** list of shared-resource culprits, each with provenance (member path-classes + evidence). | `test/ac05-tomography-rank.test.ts` |
| **AC-5b** | Every emitted culprit carries `correlational_not_causal: true` and the solver never returns a claim finer than a shared-resource group (guards N1). | `test/ac05-tomography-noncausal.test.ts` |
| **AC-5c** | Given degraded paths all traversing one shared resource (single-optic / shuffle / bundle common-mode), When solved, Then that resource is rank-1, exploiting path diversity for identifiability. | `test/ac05-tomography-identifiability.test.ts` |
| **AC-6** | Given a localized culprit, When the route-drain hook fires, Then it records a **simulated** drain of the path-classes traversing that resource (no real data-plane call — guards N4). | `test/ac06-route-drain-sim.test.ts` |
| **AC-7** | Given network signals, When the per-cell calibration substrate is built, Then per-cell baselines keyed by (hour-of-day × day-of-week × traffic-class) are produced and the "normal" smear is characterized, not assumed unimodal. | `test/ac07-percell-calibration.test.ts` |
| **AC-8** | Given the demo builder, When run, Then a single-file dashboard pages **six** deterministic scenarios: clean baseline, single-optic degradation, shuffle-device common-mode, fiber-bundle common-mode, FDR control, topology-spanning common-mode. | `test/demo.test.ts` (+ `tools/build-demo.ts`, `tools/scenarios.ts`, `test/scenarios.test.ts`) |
| **AC-9** | Given the same incidence model + same telemetry stream, When the pipeline is run twice, Then verdicts **and** localization are byte-identical (replay-clean). | `test/ac09-replay-clean.test.ts` |
| **AC-10a** | A coverage/saturation matrix is emitted over scenario × parameter variations, reporting detection and attribution-correctness per cell (spirit of Tessera R72). | `test/ac10-coverage-matrix.test.ts` |
| **AC-10b** | A **detection-floor + attribution-floor** table is emitted (the magnitude at which detection / correct attribution crosses threshold), with no caveat hidden in a footnote (DISCIPLINES §7). | `test/ac10-floor-table.test.ts` |
| **AC-N1** | The solver output schema admits only shared-resource-group culprits with the non-causal flag; a test asserts no `src/` API surface exposes a single-component "root cause," and every `localize()` culprit carries the flag at runtime. | `test/anti-scope.test.ts` (+ `test/tomography.test.ts`) |
| **AC-N2** | No source module imports a live-fabric/network/fs ingestion client; ingestion reads only synthetic fixtures. | `test/anti-scope.test.ts` |
| **AC-N4** | The route-drain hook has no real controller dependency; firing it mutates only simulated state. | `test/drain.test.ts` |
| **AC-N5** | No file under `src/` deep-links, copies, or reaches into engine internals; the engine is referenced only via its package name (subpaths ok, no `_`-prefixed internals). (Also enforced mechanically by the sprag gate.) | `test/anti-scope.test.ts` |

> N3 (no customer telemetry) is satisfied structurally by AC-N2 (synthetic-only ingestion);
> it has no separate data path in v1.
>
> **α-budget convention (AC-2a/2b):** each detector's `alpha_spent` follows the e-value
> spent-on-fire convention — α is booked as spent iff the detector rejects (fires), 0
> otherwise — uniform across Family A and Family C. (The engine's betting-state
> `alphaConsumed` is a cumulative per-tick allocation and is deliberately NOT used as the
> spend figure.) `alpha_allocated` records the per-detector budget regardless of firing.

---

## 5. Prescription → AC coverage (skill 15)

Every prescription from the kickoff's "decisions already made" binds to an AC; none floats
uncovered. If a prescription gained no binding AC, it would move to anti-scope.

| Prescription | Bound by |
|---|---|
| Path-class is the leaf (aggregated, not per-microflow) | AC-1 |
| Map path-class → engine "shard" runtime; residual stream reused | AC-1, AC-2a/2b |
| At least Family A + Family C detectors | AC-2a, AC-2b |
| Per-detector α-budget in the audit record | AC-2a, AC-2b |
| Hierarchical e-value combination | AC-3a |
| e-BH FDR chosen for arbitrary-dependence control | AC-3b |
| Aggregated path-classes keep e-process count tractable | AC-1 (count bound [100,10000]) |
| Fault-domain incidence model via a TopologySource-shaped source | AC-4 |
| Deterministic snapshot hash | AC-4, AC-9 |
| Tomographic localization replaces BFS ranker | AC-5a, AC-5c |
| Ranked culprits with provenance | AC-5a |
| `correlational_not_causal` flag; identifiability-only claim | AC-5b, AC-N1 |
| Exploit path diversity → well-conditioned inversion | AC-5c |
| Route-drain hook, simulated | AC-6, AC-N4 |
| Per-cell calibration (HoD × DoW × traffic-class) | AC-7 |
| Single-file demo, six named scenarios | AC-8 |
| Replay-clean audit (verdicts + localization) | AC-9 |
| Coverage/saturation matrix (R72 spirit) | AC-10a |
| Detection + attribution floor table (R77 spirit), no hidden caveats | AC-10b |
| Anti-scope must-nevers N1–N5 | AC-N1, AC-N2, AC-N4, AC-N5 (N3 via AC-N2) |

---

## 6. Honest-measurement requirements (DISCIPLINES §7)

- The coverage matrix reports both **detection** and **attribution** outcomes per cell — not
  detection alone — so a strong detection number cannot mask weak localization.
- The floor table reports the detection floor **and** the attribution floor as parallel
  columns. Where a metric captures only part of a cost, it is named for the part or paired
  with the whole — never published as a fraction with a footnote.

---

## 7. Open questions — RESOLVED 2026-06-08

- **Q1 (topology typing):** RESOLVED — `FaultDomainSource` mirrors the TopologySource *shape*
  with RNG-native types (ADR-0002 Accepted). Engine `TopologySnapshot` is not reused as the
  payload; the hash reuses the engine's public `pureJsSha256`.
- **Q2 (telemetry granularity):** RESOLVED — the §3.2 five-signal vector
  (`p99_latency`, `retransmit_rate`, `loss_rate`, `ecmp_imbalance`, `path_completion`) is the
  v1 synthetic contract. Operator-overridable. (arXiv:2604.15261 remains unavailable to
  verify against; this is the recorded working assumption, not a claim of fidelity.)
- **Q3 (topology-parameter source):** RESOLVED — a seeded generator produces the quasi-random
  fabric + cabling/shuffle map from named parameters with **documented defaults**; operator
  override is a later thickening, not a v1 blocker.

The walking skeleton may proceed under these ratified assumptions.
