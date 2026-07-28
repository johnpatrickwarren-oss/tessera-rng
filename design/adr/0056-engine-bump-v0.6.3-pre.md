# ADR 0056 — Engine git-dep bump v0.6.0-pre → v0.6.3-pre (pin-only)

- **Status:** ACCEPTED
- **Date:** 2026-07-28
- **Decision owner:** Tessera-RNG (operator-ratified)
- **Relates to:** ADR-0030 (the prior pin-only bump — the template this follows), ADR-0037
  (engine surface adoption questions — deliberately NOT decided here), the GPU-sibling 2026-07-02
  math audit (the hygiene motivation).

---

## Decision

`package.json` dependency `#v0.6.0-pre` → `#v0.6.3-pre`; lockfile resolves to
`e1d0c90ff2d0f8b0b581f67abe1e58222c6c664e`, verified equal to
`git rev-parse v0.6.3-pre^{commit}` in the engine repo (the ADR-0030 gotcha checked; the
printed version field also reads 0.6.3-pre correctly this time).

**Pin-only.** The 9-import consumption surface was verified unchanged across the gap before
this bump (checked module-by-module during the ADR-0050 kickoff: the only code change in any
imported module is a comment in `fleet/common-mode.ts`): clean `tsc`, **299/299 tests**, gate
PASS against the new tree. No engine surface adopted — the v0.6.2-pre BF-validity correction
(`nuisanceRobustBFEValue` deprecated, E[BF|H0]≈1.155 — Tessera-RNG never imported it) and the
v0.6.3-pre localization work (`topology/common-mode-attribution`, Tessera-RNG has its own
tomography) change nothing here.

## Why now

Hygiene: staying pinned to a tag whose tree still asserts the "valid by construction" claim
for `nuisanceRobustBFEValue` — known-false since the GPU-sibling's 2026-07-02 math audit — is
bad posture even for an un-imported module; v0.6.2-pre+ carries the corrected envelope
(`validUnderEstimatedBaseline: false`) and deprecation pointers. Also aligns the pin with
engine main for any future ADR-0037-class adoption conversation.

## Anti-scope

No surface adoption (e-BH boosting, safe-t routing, engine `localizeFaults` — each remains an
ADR-0037-class decision); no code changes anywhere in `src/`/`tools/`.
