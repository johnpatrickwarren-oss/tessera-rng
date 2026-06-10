# ADR 0013 — RNG-paper reconciliation (arXiv:2604.15261 now available)

- **Status:** Accepted
- **Date:** 2026-06-09
- **Decision owner:** Tessera-RNG (post-v1, round 3 — post-review work order)
- **Supersedes:** updates the "paper unavailable" caveat in STATE.md and v1-spec §7 Q2

---

## Context

STATE.md and v1-spec §7 Q2 record the source paper — **arXiv:2604.15261**, *"RNG: Flat Datacenter
Networks at Scale"* (Bernardi, Mahajan, Seshadhri, et al.) — as **unavailable**, so the §3.2
five-signal telemetry contract and the topology parameters were recorded as working assumptions that
"could not be verified." The paper is now retrievable. Per DISCIPLINES §0 (inherited testimony is not
verification), the facts below were **independently fetched and verified** from the abstract and the
arXiv HTML full text (v3) on 2026-06-09 — not taken on the review's word.

## Decision

Record what the paper settles and what it leaves open, and let it motivate (not silently absorb) the
downstream work-order items. **No code change in this ADR.** The signal contract is **not** claimed
validated.

### Verified paper facts (self-fetched 2026-06-09)

- **Topology** — quasi-random graph (expander); default params `n=1000, d=64, p=4, h=2`. *"When ℓ=1
  (practical regime), the maximum path length is 5, and 5-hop paths are a negligible fraction."* No
  special routers. → **Confirms P2's thesis** (ADR-0001): hop distance is structurally dead as a
  fault-domain signal.
- **Routing (Spraypoint)** — *"all neighbors are eligible next hops and one is selected based on ECMP
  hashing,"* then channeled through waypoint levels by distance-to-destination. A single flowlet
  samples ONE path via ECMP hash; a ToR-pair's aggregate spreads across the sprayed set.
- **Path diversity** — *"For almost all endpoint pairs, Spraypoint finds over 50 edge disjoint
  paths"* (of a max d=64). → **Confirms the raw material** the tomography exploits.
- **ShuffleBox** — `dr=32` r-ports × `fr=4` fiber-pairs = `dc=4` c-ports × `fc=32` fiber-pairs (full
  bipartite internal shuffle); *"We disable paths with over seven connectors."* Rooms/panels are real
  shared fault domains.
- **Scale** — *"both topologies are designed to support 61.4K servers across 960 ToRs."*
- **Operations / telemetry** — essentially **absent**. The paper's only sentence: *"We ensured that
  fault localization functions properly and built new tools to easily determine the paths between
  ToRs for troubleshooting."* No signal inventory, no failure-rate taxonomy, no localization
  mechanism. Drains are a real operational primitive; link-state reconverges after failure.

### What is closed / open / motivated

- **Closed (now verified):** the paper exists and is retrievable; the topology shape, routing model,
  path diversity, ShuffleBox structure, and production scale are as the work order reports. P2's "hop
  distance does not encode fault domain" is confirmed by the paper, not just assumed.
- **Open (stays a working assumption):** the §3.2 five-signal telemetry contract. The paper treats
  operations/telemetry as out of scope, so the contract is now **unfalsified, not unverifiable** — it
  is neither validated nor contradicted. Tessera-RNG targets a real, paper-acknowledged but
  undescribed gap (fault localization with no published signal model). **We do not claim validation.**
- **Motivated downstream work** (each its own ADR + tests + mutation + cold-eye + gate):
  - *Weighted/fractional incidence* (item 2) — Spraypoint spreads a ToR-pair fractionally across a
    large path set; binary incidence + fixed small resource sets are the easy regime. The published
    floors are floors *for that injection model*; the coverage scope note must say so until item 2
    lands.
  - *Leaky noisy-OR scorer* (item 3) — spraying + automatic rerouting make **partial** member firing
    the norm; the current hard noisy-OR is why the attribution floor (Δ=2) lags detection (Δ=1).
  - *Reconvergence epochs* (item 4) — Spraypoint is link-state and reconverges; incidence churns
    mid-stream (synthetic-event-driven only; N2 intact).
  - *Path-class granularity at scale* (item 5, **HALT-CLASS**) — 960 ToRs ⇒ ~460K ToR-pairs, which
    does not fit AC-1's `[100, 10000]`. Routed to the owner as a spec question; not changed here.

## Consequences

- STATE.md and v1-spec §7 Q2 are corrected from "unavailable" to "available; topology/routing/scale
  verified, telemetry contract still a working assumption (now unfalsified)."
- The synthetic fabric/floors remain honestly scoped as the easy (binary, fixed-set) injection model
  until item 2 adds the dilution sweep; this ADR is the record that the next items exist *because the
  paper's routing model differs from the v1 fabric's*, not as gratuitous scope.
- N1–N5 unchanged. The paper being readable does not change the synthetic-only posture (N2): no code
  reads a live fabric; the paper is a citation, not a data source.
