# ADR 0017 — Epoch'd snapshot sequence + synthetic reroute events (incidence churn, source side)

- **Status:** Accepted
- **Date:** 2026-06-10
- **Decision owner:** Tessera-RNG (post-v1, round 3 — work order item 4, part 1 of 2)
- **Supersedes:** — (ADR-0018 builds the detector side on top of this)

---

## Context

Spraypoint is link-state and **reconverges**: the incidence model is not static — a drain, a
failure, or a routing event remaps a fraction of path-classes onto alternate resources
mid-stream. v1 (and rounds 1–3 so far) assume one immutable snapshot per run; a fault that
persists across a reconvergence is currently modeled as if the traffic never moved. The work
order calls for a v1-compatible slice with **N2 intact**: epochs are driven by **synthetic
events only** — this ADR deliberately does NOT open a live `fetchSnapshot` poller.

Scope split (the work order anticipated decomposition): this ADR is the **source side** — the
epoch'd snapshot sequence, the synthetic reroute event, and epoch-aware telemetry. The
**detector side** (e-process wealth resets at incidence-change boundaries, evidence-epoch
attribution, per-epoch tomography) is ADR-0018.

## Decision

New module `src/epoch.ts`:

1. **`SnapshotEpoch { snapshot, valid_from_tick, hash }`** — one incidence regime. The hash is
   `computeFaultDomainHash(snapshot)`, so each epoch's full measurement design — **including the
   ADR-0015 view definitions** — is versioned per epoch (the cold-eye forward-flag: a future event
   that changes views is automatically a distinct epoch identity).
2. **`RerouteEvent { at_tick, resource_id, fraction, seed }`** — the synthetic
   drain/reconvergence: at `at_tick`, a deterministic `fraction` of the path-classes traversing
   `resource_id` remap off it onto **same-kind alternate** resources.
   `applyRerouteEvent(snapshot, event)` is pure and seeded (`src/rng.ts` LCG — no ambient
   randomness, AC-9): candidates sorted, `floor(fraction·|candidates|)` chosen by seeded
   without-replacement draw, each remapped path-class drops its edge to `resource_id` and its
   traffic weight lands on a seeded same-kind alternate (merged into an existing edge, capped at
   `min(1, w_alt + w_moved)` — a leaf cannot route more than all of its traffic through one
   resource). No same-kind alternate ⇒ throw (the event is physically impossible). Path-classes,
   resources, and views carry over verbatim; `source_version` gains a deterministic
   `+reroute(...)` suffix.
3. **`makeEpochs(initial, events)`** — folds events into a validated epoch sequence: epoch 0 at
   tick 0, `valid_from_tick` strictly increasing, hashes computed per epoch.
   **`epochIndexAt(epochs, tick)`** — the active epoch for a tick.
   **`changedLeaves(a, b)`** — the path-classes whose (resource, weight) edge-set differs between
   two snapshots (exactly the remapped set for a reroute; ADR-0018's reset boundary).
4. **Epoch-aware telemetry** — `TelemetryParams.epochs?: SnapshotEpoch[]`: the degradation's
   affected-weights map follows the **active epoch per tick**, so a leaf rerouted off a faulty
   resource stops shifting at the boundary (and one rerouted onto it starts). The noise process
   (RNG stream, AR history, baselines) is intentionally **continuous across epochs** — a reroute
   changes routing, not the physical noise of the fabric. Absent ⇒ the static-snapshot path,
   **byte-identical** to v1.

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test ("Then") |
|---|---|
| Single-epoch sequence ≡ static snapshot, byte-identical | `epoch.test.ts`: telemetry with `epochs=[{snap,0}]` equals the no-epochs run, byte-for-byte |
| Reroute is deterministic + seeded | same event twice ⇒ identical snapshot + identical hash; different seed ⇒ different remap |
| Remapped leaves lose the edge; weight lands on a same-kind alternate, capped at 1 | edge-set assertions on a hand-built fabric (incl. the cap when the alternate is already w=1) |
| `fraction` semantics | `floor(fraction·|candidates|)` leaves remapped, the rest untouched |
| No same-kind alternate ⇒ throw | single-resource-kind fixture throws |
| Views/path-classes preserved; epoch hash differs | post-event snapshot keeps views + path_classes; hash ≠ pre-event hash |
| Epoch sequence validated | non-zero first epoch / non-increasing `valid_from_tick` throw; `epochIndexAt` boundaries (tick exactly at `valid_from_tick` belongs to the new epoch) |
| `changedLeaves` = exactly the remapped set | compared against the event's recorded remap |
| Degradation follows the active epoch | fault on R + reroute moving pc off R at T ⇒ pc's raw shift present before T, absent after (and the unremapped control keeps shifting) |

## Consequences

- **Anti-scope intact.** N2: no fs/net in `src/`; events are synthetic parameters. The epoch
  sequence is data handed to the pipeline, not a poller. Live reconvergence detection stays out.
- **Determinism (AC-9)** is preserved: the remap draw uses the seeded LCG; epochs are part of the
  measurement design via per-epoch hashes (ADR-0018 will carry them into the audit).
- **Honest limitation:** the synthetic reroute moves traffic to alternates *atomically at one
  tick*; real reconvergence has a transient (microbursts, partial FIBs). Out of scope, recorded.
- **Smarter wealth carryover across epochs is future work** — ADR-0018 implements the deliberate,
  recorded reset, nothing cleverer (the work order's explicit instruction).
- **Gate loosening on the record:** `no-god-module` raised 16 → 20 (`arch-invariants.json`, intent
  updated in place). `epoch.ts`'s type-only import pushed `domain.ts` to 17 importers — exactly the
  zero-behavior data-contract case the invariant's intent already admitted; 16 was calibrated to
  the then-current module count, not a coupling judgment. Behavioral-hub protection (logic modules
  sit at ≤3 importers) is unchanged.
