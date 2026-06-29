# ADR 0030 — Engine git-dep bump `v0.3.1-pre` → `v0.6.0-pre`

- **Status:** ACCEPTED (bump run and verified on branch `engine-bump-v0.6.0-pre`; observed
  outputs recorded inline below). No `src/` change — import surface compile-compatible.
- **Date:** 2026-06-29
- **Decision owner:** Tessera-RNG (post-v1 round 10)
- **Relates to:** ADR-0001 (engine consumed as a git-dep, **never forked** — extension points
  only), CLAUDE.md non-negotiable #1. This ADR records a *dependency* decision, not a
  mechanism; it adopts none of the new engine surface yet (see "Deliberately out of scope").

---

## Context

Tessera-RNG pins `@johnpatrickwarren-oss/deploysignal-engine` at `v0.3.1-pre`. Upstream the
engine has advanced **53 commits / 5 tags** (`v0.3.4`, `v0.4.0`, `v0.5.0`, `v0.6.0-pre`; 300
files changed, engine ADRs 0004–0021) — a large nuisance-robust-evidence + localization arc.

A version bump is a real decision (DISCIPLINES §9) and must not enter as silent dependency
drift. Per halt-on-contradiction (DISCIPLINES §0): *inherited testimony is not verification* —
the claim "the bump is safe" had to be **run and the observed output recorded**, not asserted
from a static surface read.

**Why bump now (and only the pin):** the static surface diff established that Tessera's actual
consumption surface is compile-compatible (analysis below). Bumping the pin keeps the engine
fork-free and current, and *unlocks* — without yet adopting — the new FDR/localization
machinery for a future ADR. This ADR deliberately does not consume any of it.

### Consumption surface (the 9 import points) — diffed `v0.3.1-pre → v0.6.0-pre`

| Engine import (symbols Tessera uses) | Consumer | Status at v0.6.0-pre |
|---|---|---|
| `detectors/ar-p` → `fitArP`, `prewhitenAr` | `calibration.ts` | unchanged |
| `fleet/combine` → `combineAverage` | `surface.ts` | unchanged |
| `fleet/e-bh` → `eBenjaminiHochberg` | `surface.ts` | unchanged |
| `detectors/spectral` (Family D) | `family-d.ts` | unchanged |
| `topology-overlay` → `pureJsSha256` | `fault-domain-source.ts` | unchanged |
| `types/families/c`, `types/families/d` | detect / session / family-c | unchanged |
| `detectors/hotelling` → `freshSafeHotellingState`, `evaluateSafeHotelling` (Family C) | `session.ts`, `family-c.ts` | **relocated, re-exported, byte-identical** |
| `detectors/betting-e-process` → `freshBettingState`, `updateBettingState` (Family A) | `detect.ts`, `session.ts` | **signature widened, back-compatible** |

Two files looked alarming and aren't:

- **`hotelling.ts` (−310 lines)** — split into `_hotelling-core` / `_hotelling-dispatch` /
  `_hotelling-safe`. But `hotelling.ts` now re-exports `freshSafeHotellingState` /
  `evaluateSafeHotelling` from `./_hotelling-safe`, and both functions (and
  `SafeHotellingState`) are **byte-for-byte identical** to v0.3.1. The public path Tessera
  imports is preserved.
- **`betting-e-process.ts` (+127/−74)** — `updateBettingState` gained one **optional trailing**
  parameter `ar1Phi = 0`. Tessera's existing 5-arg calls compile and behave identically
  (φ defaults to 0). `BettingInput` and `freshBettingState` unchanged.

## Decision

Bump the `package.json` git-dep ref `v0.3.1-pre` → `v0.6.0-pre`. Single-line pin change plus
the resolved `pnpm-lock.yaml`. No `src/`, test, demo, or coverage-matrix change.

## Evidence (run, recorded — DISCIPLINES §0)

Branch `engine-bump-v0.6.0-pre`, observed 2026-06-29:

- **Resolve** — `pnpm install` resolved the dep to commit **`b942b5b2`** (= HEAD of
  `v0.6.0-pre`, "Merge PR #32"). Lockfile `resolution.tarball` carries that SHA.
- **Compile** — `pnpm typecheck` (`tsc -p tsconfig.test.json --noEmit`): **EXIT 0**, no
  diagnostics. This is the substantive proof: `tsc` resolves all 9 import points against the
  new engine tree, so the Safe-Hotelling relocation and the `updateBettingState(ar1Phi)`
  widening are confirmed compile-compatible **in the actual build**, not by inspection.
- **Tests** — `pnpm test`: **198 pass, 0 fail, 0 skipped** (duration ~4.7 s). Includes
  `smoke-engine-import.test.ts`, which directly exercises the engine's betting e-process,
  Welford per-shard runtime, hierarchical combine, e-BH FDR, and snapshot hashing. Family
  A/C/D verdicts, calibration, e-BH, and tomography all reproduce identically.

## Gotcha (recorded so the next reader isn't misled)

`pnpm install` reports `+ deploysignal-engine 0.5.0-pre`, **not** 0.6.0 — the engine's internal
`package.json` `version` field still reads `0.5.0-pre` at the `v0.6.0-pre` git tag (the tag
advanced; the version string did not). **The lockfile commit hash (`b942b5b2`) is the source of
truth for which engine tree is installed, not the printed version string.** Anyone diffing
`pnpm list` output alone would wrongly conclude the bump only reached 0.5.0.

## Deliberately out of scope (anti-scope — DISCIPLINES §2)

This ADR changes the pin and nothing else. The v0.4–v0.6 arc added machinery that lands on
Tessera-RNG's two missions (FDR-without-blowup; tomographic localization) — **none adopted
here**, each is its own future ADR:

- AR(1)-aware betting (`updateBettingState(ar1Phi)`) — relates to the ADR-0008 AR(p)
  prewhitening already in `calibration.ts`.
- e-BH conditional-calibration boosting (`fleet/e-bh-conditional-calibration`) — more power in
  the `surface.ts` e-BH step.
- Stronger valid e-values: universal-inference (any-φ FDR), safe-t/GROW, nuisance-robust BF.
- `localizeFaults` + `leaveOutGroups`, and engine ADR-0017's "*localizeFaults is a RANKING aid,
  not a discovery set*" — a near-exact parallel to Tessera-RNG's own localization + the N1
  "correlational-not-causal / RANKING" contract; worth a reconciliation pass.
- Distributional-signature detectors, validity envelopes, instrumented common-mode loading
  model, seasonal + multivariate per-cell baseline kits.

Adopting any of the above is **new consumption surface** and must clear its own spec-first ADR.

## Consequences

- **Engine stays fork-free and current** at the most recent tag, honoring ADR-0001 / CLAUDE.md
  #1. The git-dep + declared-extension-point posture is unchanged.
- **No behavioral change to Tessera-RNG.** 198 tests green, typecheck clean; the only on-disk
  change is `package.json` + `pnpm-lock.yaml`. The sprag gate scans `src/` (untouched), so it is
  unaffected by this bump.
- **Risk carried forward:** the *internals* of `evaluateBettingEProcess` / `updateBettingState`
  changed substantially (+127/−74) even though the symbols Tessera calls are signature-stable.
  Our coverage is the existing 198-test suite (Family A verdicts reproduce); we did **not**
  audit the engine's new betting internals line-by-line. If a future engine release changes
  Family A *verdict* behavior under the same inputs, our anti-self-confirming tests are the
  tripwire — re-run on every subsequent bump.
- **Next:** the adoption ADRs above. Recommended first candidate: e-BH conditional-calibration
  boosting (lowest-risk power gain at an extension point already consumed).
