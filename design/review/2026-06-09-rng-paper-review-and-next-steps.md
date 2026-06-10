# Prompt: post-review work order — RNG-paper reconciliation + tomography noise-model upgrades

- **Date:** 2026-06-09
- **Source:** external cold-eye review of the repo against James Hamilton's post
  ("Flat Datacenter Networks at Scale", perspectives.mvdirona.com, 2026-06) and — newly
  available — the RNG paper itself: **arXiv:2604.15261v3** (submitted 2026-04-16, revised
  2026-05-21). STATE.md still records this paper as unavailable. It is now retrievable
  (abstract, HTML, and PDF). Several recorded working assumptions can now be checked.
- **How to use this document:** this is a work order under the existing archgate discipline.
  Nothing here overrides DISCIPLINES.md, the v1 spec anti-scope, or arch-gate-usage.md.
  Every item below that changes behavior = ADR + anti-self-confirming tests + mutation pass
  on new math + cold-eye + green gate, per the established loop. Items marked **[HALT-CLASS]**
  touch the spec contract and must be routed back to the owner as a spec question, not
  silently absorbed.

---

## 0. Review verdict (context, read first)

The review confirmed the two core mathematical commitments:

- **P1 (multiplicity)** is sound and essentially deployment-shaped. Anytime-valid e-processes
  + e-BH under arbitrary dependence is the right machinery for a fabric whose guarantees are
  explicitly stochastic; AR(p) pre-whitening, the n<30 pooled fallback, and the clean-fabric
  FDR evidence make the claim credible. No P1 work is requested here.
- **P2 (localization)** is the right *kind* of math — the paper confirms hop distance is
  structurally dead (max path length 5; "no special routers") and confirms the path-diversity
  raw material (">50 edge disjoint paths" for almost all endpoint pairs). But the solver's
  **noise model does not match how Spraypoint moves traffic**, in three specific ways
  (items 2–4 below). The repo's own coverage matrix already shows the symptom of one of them.

The paper leaves operations/telemetry essentially open — its ONLY sentence on the topic:
*"We ensured that fault localization functions properly and built new tools to easily
determine the paths between ToRs for troubleshooting."* No signal inventory, no failure-rate
taxonomy, no localization mechanism described. So tessera-rng targets a real, unsolved gap;
the five-signal contract is neither validated nor contradicted (it stays a recorded
assumption, now with a checked citation).

---

## 1. Close the arXiv-unavailable assumption (documentation; do this first)

**What:** STATE.md ("arXiv:2604.15261 unavailable to validate the signal contract against —
recorded assumption") and v1-spec §7 Q2 are now stale. The paper is available. Record what it
does and does not settle.

**Paper facts to record (verbatim-sourced, fetched 2026-06-09):**

- Telemetry/diagnostics: **absent from the paper** (operations explicitly "not a focus of
  this paper", §8). The §3.2 five-signal contract remains a working assumption — now verified
  to be *unfalsified* rather than unverifiable. The paper does mention latency as a signal
  the multipath transport uses when picking flowlets (§8).
- Routing (Spraypoint, §5): packets are **sprayed at the source** — "all neighbors are
  eligible next hops and one is selected based on ECMP hashing" — then channeled via
  waypoint levels toward the destination. A single flow(let) samples ONE path via ECMP hash;
  a ToR-pair's aggregate traffic spreads across the sprayed path set. "For almost all endpoint
  pairs, Spraypoint finds over 50 edge disjoint paths" out of a max of d=64 (§9.2).
- Topology: quasi-random expander, n≈1000 routers, d=64 uplinks (breakout lanes), path
  lengths 1–5 with ℓ=1 in the practical regime; "no such special routers" (§2).
- ShuffleBox (§6): 32 r-ports × 4 fiber-pairs = 4 c-ports × 32 fiber-pairs (full bipartite
  internal shuffle); unconnected c-ports get **ShuffleBacks**; rooms hold **shuffle panels**;
  paths with >7 connectors are disabled for optical-quality reasons. Rooms/panels are real
  shared fault domains.
- Failure model: blast-radius arguments only; no per-component failure rates. Drains are a
  real operational primitive ("We thus drain impacted links to minimize impact", §A).
  Link-state reconvergence after failure is comparable to the incumbent protocol (§8).
- Scale anchor: production fabrics sized at "61.4K servers across 960 ToRs" (§9.3).

**Deliverable:** update STATE.md + a short ADR ("RNG-paper reconciliation") recording which
assumptions are closed, which stay open, and which downstream items (2–5) it motivates. No
code change. Do NOT claim the signal contract is validated — it is not.

---

## 2. Weighted (fractional) incidence — ADR + fabric + tomography

**Problem.** `src/fabric` gives each path-class a fixed, small, deterministic resource set
(2 optics + 1 shuffler + 1 bundle + zones), and `src/tomography` treats incidence as binary.
Under Spraypoint, a ToR-pair path-class traverses a *large* resource set **fractionally**:
each resource carries some fraction of the class's flowlets (ECMP hash measure). A single
faulty optic shifts an affected path-class by ~Δ·(traffic fraction through that optic) —
diluted, smeared across many path-classes. The current synthetic fabric is the easy regime;
the published floors (Δ≈1–2σ) are floors *for that injection model* and the coverage-matrix
scope note should say so until this lands.

**Direction:**

- Extend the incidence edge with an optional `weight ∈ (0, 1]` (fraction of the path-class's
  traffic traversing the resource). Default 1 ⇒ byte-identical v1 behavior (keep the
  default-fabric replay tests green unchanged — that is the anti-self-confirming guard).
- Telemetry injection: a degradation on resource r shifts path-class pc by `delta * w(pc,r)`,
  not by `delta`. This is the honest dilution model.
- Fabric generator: add a Spraypoint-flavored mode — path-classes traverse O(10–50) resources
  with weights drawn from the spray distribution (most mass on a few, long tail), plus the
  ShuffleBox-derived taxonomy from item 1 (shuffle panel / room as fault-domain kinds is a
  natural extension of the existing power/cooling zones; keep the taxonomy open as §3.3
  already provides).
- Tomography: gains become weighted — a resource "explains" a firing path proportionally to
  w; collateral from a quiet path costs proportionally to w (a quiet path that sends 2% of
  its traffic through r is weak evidence against r; one that sends 60% is strong).
- Note the detection-layer consequence (favorable, record it): dilution produces many weakly
  shifted correlated streams — exactly what hierarchical e-value combination + e-BH
  aggregates well. Measure it: the coverage tool should gain a diluted-injection sweep so the
  floor table reports floors under dilution, parallel to the existing columns (per the
  honest-measurement discipline — never let the easy-regime number stand alone).

**Engine boundary:** all of this is product-side (`src/`); no engine change needed (N5 safe).

---

## 3. Leaky noisy-OR scoring in `localize()` — ADR + new math + mutation pass

**Problem.** `bestResource()` uses `gain = |newly| − λ·|quiet|`, a *hard* noisy-OR: it
implicitly assumes a faulty resource fires ALL traversing paths. The repo's own coverage
matrix shows the symptom: **attribution floor (Δ=2) lags detection floor (Δ=1)** — at Δ=1
some traversing paths sit below the per-path detection floor, the true culprit eats collateral
penalty for its own non-fired members, and attribution fails. Under spraying + automatic
rerouting, partial firing is the NORM, not a corner case.

**Direction:** replace the linear gain with a **leaky noisy-OR likelihood-ratio score**.
Sketch: let q₀ = fleet base firing rate (from the e-BH surface), and q₁ = expected firing
probability of a member path given the resource is faulty (a function of the per-path
detection floor and, post-item-2, the incidence weight). Score each candidate resource by the
log-likelihood ratio of its members' observed firing pattern under (faulty, q₁) vs (clean,
q₀); greedy set cover proceeds on that score. Properties to preserve and test:

- Deterministic, replay-clean (tie-break on resource id as today).
- A true common-mode resource with *partial* member firing must beat an incidentally shared
  resource with the same firing count but more quiet members — write that as an explicit
  fixture (this is the anti-self-confirming test: build the fixture where the OLD scorer
  picks the wrong resource, assert the new one picks the right one, and keep a test proving
  the old failure mode existed).
- N1 intact: output schema unchanged, `correlational_not_causal` everywhere, unexplained set
  still reported.
- Target: attribution floor at passive_shuffler drops to meet the detection floor (Δ=1) on
  the existing sweep; record whatever it actually does in the floor table, including if it
  does not fully close the gap.
- Mutation pass on the new scoring math (the solver currently holds 100% — keep the bar).

`DEFAULT_LOCALIZE.collateralWeight` becomes derived/subsumed; keep the old scorer available
behind the options object only if a test needs it to demonstrate the failure mode, otherwise
delete (no dead knobs).

---

## 4. Incidence churn (routing reconvergence) — ADR first, scope deliberately

**Problem.** Spraypoint is link-state and reconverges after failures; when it does, the
path-class→resource incidence changes mid-stream. Two effects, both currently unmodeled:
(a) the tomography matrix goes stale; (b) calibration baselines shift for non-fault reasons
(a reroute changes a path-class's residual distribution — risk of false fire and of
masking). Hamilton: failures are "mask[ed] with automatic re-routing"; the README's own
motivation ("by the time a threshold alarm fires, the path-margin is already spent") is
precisely about this window.

**Direction (v1-compatible slice; N2 stays intact — synthetic only):**

- `FaultDomainSource` already mirrors TopologySource *shape*; extend it to a **sequence of
  epoch'd snapshots** (snapshot + valid-from tick + hash). Synthetic generator gains a
  "reroute event": at tick T, a configurable fraction of path-classes traversing a named
  resource remap to alternates (this is what a drain or reconvergence does).
- Pipeline: detection state and calibration cell-assignment must be epoch-aware. Minimal
  honest v1 slice: on epoch change, affected path-classes' e-processes restart (wealth
  reset) and the audit records the reset — a deliberate, *recorded* power loss, not a
  silent one (instrumented-caveat). Smarter carryover is future work; do not build it yet.
- Tomography runs against the epoch the firing evidence accrued in.
- Tests: (i) a reroute with NO fault must select nothing (the false-fire guard — this is the
  critical anti-self-confirming test); (ii) a fault + subsequent reroute must still localize
  from pre-reroute evidence; (iii) replay-clean across epochs.

This is the largest item; if it decomposes into >1 ADR (source epochs vs. detector
epoch-awareness), decompose it.

---

## 5. **[HALT-CLASS]** Path-class granularity at real scale — spec question, not code

AC-1 bounds the path-class count at [100, 10000]. The paper's production anchor is 960 ToRs
⇒ ~460K ToR-pairs. Path-class = ToR-pair (ADR-0001 §3.1) does not fit inside AC-1 at real
scale. Options to put to the owner: coarser equivalence classes (e.g., ToR-pair groups by
shuffle-panel pair), sampling, or raising the bound (e-BH is O(n log n); per-leaf e-process
state is small — the constraint is honesty about calibration sample budgets, not compute).
**Do not change the spec unilaterally.** Raise it with a recommendation and wait.

---

## Sequencing

1 (docs, closes a recorded assumption) → 2 (weighted incidence; unblocks honest floors) →
3 (leaky scorer; uses weights from 2) → 4 (epochs) → 5 (raise immediately as a question in
parallel with 1, since its answer shapes nothing in 2–4).

Each lands as its own ADR + tests + mutation (where new math) + gate, on the established
branch convention. Never `--no-verify`; loosen only on the record.

## Out of scope for this work order (unchanged anti-scope)

Live-fabric ingestion (N2), customer telemetry (N3), real drain wiring (N4), engine forking
(N5), hardware root-cause (N1). Item 4's epochs are synthetic-event-driven only — they do
NOT open the door to a live `fetchSnapshot`.
