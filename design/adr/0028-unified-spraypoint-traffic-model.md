# ADR 0028 — One Spraypoint traffic model: view weights and drill exposures from a single flow space

- **Status:** Accepted
- **Date:** 2026-06-11
- **Decision owner:** owner-authorized (post-v1 round 9 — "follow the recommendations" on the
  handoff's decision 1; decisions 2 and 3 stay deferred / on-demand as recommended)
- **Supersedes:** the recorded divergence in ADR-0026 (the "separate models, each internally
  consistent" stopgap); amends the ADR-0015 weight conventions. ADR-0015's view STRUCTURE and
  ADR-0026's drill exposures are unchanged.

---

## Context

The round-7 cold-eye (ADR-0026 C1) found that the repo carried **two traffic models**: the
fabric's leaf-local view weights (`src/spraypoint.ts`) and the drill's flow-level exposures
(`src/drilldown.ts`) diverge by 2× conventions, and the fabric is internally mixed (tor leaves
count one panel per flow; pp leaves carry w=1 on BOTH panels). Concretely:

- a pp leaf's optic weight is 1/nTors (source-side counting) where the flow aggregate gives 2/nTors;
- a pp leaf carries w=1 on both its panels (a two-panel convention) while tor leaves carry
  1/nPanels per panel (one-panel);
- a tor leaf's room weight is a flat 1/nRooms where the flow model gives panels-in-room/nPanels
  (they differ whenever panels split unevenly across rooms — and 1/nRooms fabricates a traversal
  for a room with no panels at all);
- a tor leaf carries NO weight on its partners' optics, though every flow it aggregates fully
  crosses the partner's optic.

Every published Spraypoint floor and pinned δ-band inherits this ambiguity; the owner ruled:
unify before external consumers rely on the numbers.

## Decision

**One elementary flow space, everything derived from it.** An elementary flow is a pair
`(unordered ToR pair {i,j}, panel p)`, distributed **uniformly** over
`C(nTors,2) × nPanels` — the drill's one-panel-per-flow, both-endpoint-optics model (the
physically cleanest reading of a single-stage shuffle). A flow `({i,j}, p)` traverses exactly:
`optic-i`, `optic-j`, `panel-p`, and `room(p)`.

All quantities are conditional traversal probabilities on this one space:

- **View weight** `w(L, r) ≡ P(flow traverses r | flow ∈ L)`, where `tor-i` = flows with
  endpoint `i`, and `pp-a-b` = flows with `p ∈ {a, b}`.
- **Drill exposure** `x(pair, r) ≡ P(flow traverses r | flow ∈ pair)` — exactly what
  `exposedPairs` already computes (ADR-0026); the drill does not change.

Derived closed forms (the spec; the snapshot must emit exactly these, omitting zero-weight
edges — a zero-probability traversal is not an edge):

| Leaf | Resource | Weight | Was |
|---|---|---|---|
| `tor-i` | `optic-i` | 1 | 1 (unchanged) |
| `tor-i` | `optic-j`, j≠i | **none — RECORDED sub-resolution omission, see below** (true P = 1/(nTors−1)) | absent |
| `tor-i` | `panel-p` | 1/nPanels | 1/nPanels (unchanged) |
| `tor-i` | `room-r` | **panelsInRoom(r)/nPanels** | 1/nRooms (equal only at even splits; fabricated for empty rooms) |
| `pp-a-b` | `panel-a` and `panel-b` | **1/2** each | 1 each (two-panel convention) |
| `pp-a-b` | `optic-k` | **2/nTors** | 1/nTors (source-side counting) |
| `pp-a-b` | `room-r` | **\|{a,b} ∩ panels(r)\|/2** (1 if both panels in r, 1/2 if split) | 1 per distinct room |

Drill exposures (unchanged, restated for the record as consequences of the same space):
optic-k → the nTors−1 pairs with endpoint k at 1; panel-p → every pair at 1/nPanels;
room-r → every pair at panelsInRoom(r)/nPanels.

### The one recorded narrowing: per-ToR cross-optic exposure stays below model resolution

On the flow space, `P(tor-i's traffic crosses optic-j) = 1/(nTors−1)` — real, not zero. The
fabric deliberately does NOT emit these edges. This is an evidence-gated rejection, not an
oversight — the full-support variant (every positive-probability traversal an edge) was BUILT
and MEASURED first, and it collapses the repo's localization capability (numbers in
"Considered and rejected" below) because the tomography scorer is a binary fire/quiet noisy-OR:
61 quiet members at w=1/63 accumulate falsification penalties that bury a true optic's LLR,
and at high δ the cross-optic shifts fire every tor leaf, erasing fire/quiet discrimination
between optics entirely. The owner's authorization for this round expected "floors move a grid
step" and enumerated pp-weight changes only — the full-support reading exceeded it and the
evidence agrees.

The omission is honest per the instrumented-caveat discipline because it is (a) stated here
with its true magnitude, (b) **bound by a test** that enumerates the flow space, asserts the
true probability IS 1/(nTors−1), and asserts the fabric deliberately omits the edge — so the
narrowing can never silently rot, and (c) paired with a named revisit condition: add the
cross-optic edges WHEN the scorer can use magnitude information (a magnitude-aware member
model is recorded future work; the binary caricature cannot — measured). Consequence of the
omission: the synthetic per-ToR view does not feel remote-optic saturation (a real fabric's
would, at ~δ/(nTors−1) per leaf); the published δ-bands are conditioned on this, as they
implicitly always were.

The generator's `source_version` becomes `sp2:${nTors}x${nPanels}x${nRooms}` — a visible marker
that an artifact was produced under the unified model (the hash changes anyway; the marker says
why).

One API narrowing rides along: `generateSpraypointFabric` now requires **nTors ≥ 2** (was ≥ 1).
With one ToR the flow space — unordered pairs × panels — is EMPTY, so every conditional
traversal probability is undefined; the old per-leaf conventions happened to tolerate the
degenerate fabric, the unified model does not pretend to. Bound by per-clause throw asserts in
the keystone file.

## Considered and REJECTED on the evidence: full-support unification

The first build of this round emitted every positive-probability traversal, including the
tor-leaf cross-optic edges at 1/(nTors−1). Measured on the default fabric (seeds 1–4 where
sweeps are shown; `runPipeline`, q=0.05, 60 ticks):

| Probe | Full support | Existing support (kept) | Pre-round |
|---|---|---|---|
| cross-kind optic-3+panel-7, δ∈{4,8,16}, 4 seeds | **panel-7 only — optic NEVER recovered** | panel-7 + optic-3 (all seeds) | both |
| optic-3 single δ=32 | optic-3 + spurious optic-40, optic-61 | optic-3 alone, score 7.6 | optic-3 |
| optic-3 single δ=64 | **optic-1 (wrong)** | optic-3, score 33.7 | optic-3 |
| optic-3 single δ=128 | **room-0+room-1 (fleet-saturated)** | optic-3, score 33.7 | optic-3, 33.3 |
| single-fault δ=4 (all kinds), same-kind multi-fault, clean FDR | fine | fine | fine |

Mechanism (not seed noise): the binary fire/quiet member model pays a small falsification
penalty per quiet diluted member; 61 cross-optic members at w=1/63 (plus the doubled quiet-pp
weights) accumulate enough to sink a true optic's marginal LLR below zero after the panel pick,
and at δ ≳ nTors·(per-leaf floor) the cross shifts fire EVERY tor leaf, making all optics'
member multisets identical — no fire/quiet scorer can separate them. Capability loss of this
size is not the authorized "floors move a grid step"; the variant is rejected and recorded
here, with the cross-optic term carried as the recorded narrowing above. (It also costs ~2.8×
edges at paper scale — ~514K → ~1.4M — for information the current scorer cannot use.)

## What this is expected to move (inventory; values re-pinned from OBSERVATION, never predicted —
the ADR-0020/0024 lesson, twice)

- **Snapshot hashes** — all Spraypoint snapshots, epochs, audits, the demo, the coverage matrix.
- **Panel-fault SNR on pp leaves halves** (w 1 → 1/2) — the shuffle_panel floors will move
  (the owner-anticipated grid step).
- **Room floors may move** where split-room pp weights halve.
- **Tomography scores shift** wherever pp weights enter (e.g. the C1 saturation margin).
- **Published artifacts**: `pnpm demo && pnpm coverage` regenerate; the byte-bound freshness
  spot-checks re-pin from the fresh artifacts.

## Anti-scope (must-never, this round)

- **No view redefinition.** `per_tor` ∪ `per_panel_pair` stays exactly as ADR-0015 defined it
  (a `per_panel` view is NOT introduced, even though one-panel-per-flow would also support it).
- **No scorer changes.** Tomography (ADR-0019/0022) is untouched. If the saturated regime
  regresses, the honest output is a re-pinned band + documented limitation — not a
  magnitude-aware or tie-detecting scorer bolted on mid-round (recorded future work if observed).
- **No drill changes** beyond comment cross-references (its exposures already ARE the model).
- **No edge-pruning threshold.** The cross-optic omission is ONE NAMED TERM, rejected on
  measured evidence and bound by its own test — not a magnitude knob. No general "drop weights
  below x" rule exists or may be added (that would re-create the mixed-convention dishonesty
  this round removes).
- **No spray-distribution fidelity work** (long-tail spray, real ShuffleBox internals — the
  ADR-0015 recorded limitation stands; uniformity is the model, now stated once).
- **No epoch wealth carryover, no live-fabric seam** (owner decisions 2 and 3 — deferred /
  on-demand per the same ruling that authorized this round).

## Prescription → AC coverage (DISCIPLINES §4)

| Prescription | Binding test ("Then") |
|---|---|
| Single-source derivation (THE keystone) | a brute-force enumeration over all (pair, panel) flows — independent of the closed forms — recomputes every view weight AND every drill exposure as conditional traversal frequencies and matches `generateSpraypointFabric` edges and `exposedPairs` exactly, on DEFAULT and on an asymmetric fabric (uneven panels-per-room), with the cross-optic omission carved out explicitly |
| The recorded cross-optic narrowing cannot rot | a test asserts BOTH halves: the enumerated `P(tor-i crosses optic-j) = 1/(nTors−1) > 0` AND the fabric emits no such edge — if either side changes, the narrowing must be re-decided on the record |
| Closed-form weights as tabled above | exact-equality asserts per (leaf-kind × resource-kind) cell on DEFAULT: pp optic 2/64, pp panel 1/2, pp same-room 1 vs split-room 1/2, tor room panels/nPanels |
| Zero-probability ⇒ no edge | an empty room (nRooms > nPanels case) gets NO tor-leaf edge; pp leaves carry edges only to rooms containing a or b |
| Drill unchanged | the existing `test/drilldown.test.ts` passes UNMODIFIED |
| Complementary views still bind (ADR-0015) | blind-spot tests still assert optic→per_tor / panel→per_panel_pair concentration at the floor-scale δ (re-pinned only if observation forces it, on the record) |
| δ-sweep / C1 / cross-kind capability intact | the pinned-band, C1-closed, room, panel-saturation, and cross-kind multi-fault tests pass, with score pins re-pinned from observation where pp weights moved them |
| Floors re-measured, artifacts fresh | `pnpm demo && pnpm coverage` regenerated; byte-bound demo test + coverage spot-checks #1–#4 pass against the fresh artifacts |
| FDR intact | clean default Spraypoint and clean paper-scale fabrics still select 0 |
| Replay/keystone intact | replay byte-identity tests pass; the ADR-0027 incremental ≡ batch keystone holds on the new fabric |
| `sp2` version marker | generator emits `source_version: sp2:NxPxR`; asserted |
| New math mutation-checked | `arch mutate` over the weight derivation + hand-applied index-constant mutants (the ADR-0018 lesson) |

## Consequences

- One model. Every published Spraypoint number — view weights, floors, δ-bands, drill exposures
  — now derives from a single stated flow space (modulo the ONE recorded, test-bound
  cross-optic omission); a future consumer reads one definition. The ADR-0026 "separate models,
  related but not derivable" stopgap is closed.
- Recorded future work, paired: a **magnitude-aware member model** for the tomography scorer
  (use the e-value/shift size, not just fire/quiet) and, WITH it, the cross-optic edges — the
  full-support measurements above are the acceptance bar (cross-kind recovery, sane δ-sweep).
- Costs: one-time re-pin of weight-conditioned tests and every published Spraypoint artifact;
  shuffle_panel (and possibly room) floors move and are republished from measurement.

## Post-build observations (from observed runs, per the evidence-gated discipline)

- **δ-sweep under the kept model**: the pinned band (optic-3 rank-1 at δ ∈ {4,16,32}) HOLDS;
  C1 stays closed at δ ∈ {64,128} with the saturation margin 33.7 (was 33.3 — pp weights
  moved it); room and panel extreme-δ tests unchanged; cross-kind multi-fault recovers both
  culprits (panel-7 + optic-3) — all existing claims survive, only scores shifted.
- **One control retired on observation**: the ADR-0016 legacy-linear "still flips at δ=128"
  control no longer flips under sp2 weights (legacy also picks optic-3 here) — the flip was
  conditioned on the old two-panel w=1 / source-side 1/nTors conventions. Retired in-test with
  the observation recorded; the κ=1 saturation-disabled control still discriminates, and the
  linear scorer's failure-mode role survives in the ADR-0014 decoy fixture.
- **Floors (re-measured, published)**: shuffle_panel detection 1→2 (boundary 1.5–2: Δ=1.5
  detects 1/4 — the halved w=1/2 panel exposure), attribution 2→3 (Δ=2: 3/4); room detection
  unchanged at 1, attribution 2→3 (Δ=2 detects 4/4, attributes 0/4; boundary 2–2.5: Δ=2.5
  attributes 4/4); cross_kind multi-fault 1→2 / 2→3; optic and same_kind unchanged. The
  coverage-matrix prose was rewritten to the sp2 numbers (the old "detection floors match the
  binary analogues" claim is no longer true for shuffle_panel).
- **Paper scale**: edge count UNCHANGED at 513,552 (existing support kept), clean FDR 0, all
  three kinds detect + localize rank-1, replay-clean; suite runtime within the ADR-0025
  envelope (scale test ~2.6 s in-suite). The `scale_proof` deterministic values are identical
  pre/post — only weights changed, which that section does not publish.
- **Demo reconciliation**: `demos/demo.html` is byte-UNCHANGED — the inventory above listed it
  conservatively, but the demo's eight scenarios all run on the v1 generated fabric and embed
  no Spraypoint snapshot; `pnpm demo` was re-run and reproduced the committed bytes (the
  freshness bind passes for the right reason).
- **Mutation**: broad pass 95% (57/60; the 3 survivors are the recorded benign `>=`→`>`
  fire-boundary class in detect/family-c/family-d, untouched this round); targeted spraypoint
  pass 100% (4/4) after a guard `||`→`&&` survivor forced per-clause throw asserts; six
  hand-applied convention/index mutants all killed, including a cross-module drill-room
  convention mutant — the keystone binds the drill to the fabric convention for real.
- **Suite**: 192 → 198 tests (the six traffic-model keystone/closed-form tests), gate PASS
  (bare exit).
