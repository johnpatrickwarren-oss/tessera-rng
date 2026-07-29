# ADR 0063 — Engine-adoption review at v0.6.3-pre: nothing to adopt, one measured DEFECT recorded, the rest evidence-triggered

- **Status:** ACCEPTED (decision record + one recorded defect; the defect FIX decision is
  PARKED with the operator — shared-engine API)
- **Date:** 2026-07-28
- **Decision owner:** Tessera-RNG (review); John (the parked log-domain decision — the engine
  is the shared library, its API changes affect the GPU product)
- **Relates to:** ADR-0037 (the prior review — e-BH boosting REJECTED on evidence, localize
  RECONCILED; both stand), ADR-0049 (the recorded candidate list this re-reviews: log-domain
  e-values, aGRAPA/clipped betting, randomized e-BH, heavy-tail-robust increments, e-SR),
  ADR-0034 (fix B — the log-domain recording this converts from hygiene to defect),
  ADR-0056 (the pin this reviews against), `test/overflow-defect.test.ts` (the pin).

---

## Review at the current pin (v0.6.3-pre)

Verified by inspection: **none of the ADR-0049 candidates exist as engine surfaces** — no
log-domain combine/e-BH input path, no aGRAPA/clipped betting export, no randomized e-BH, no
heavy-tail-robust increments, no e-SR wealth recursion. Every candidate is an engine
EXTENSION ask, not a consumption gap. Per the charter (engine never forked, statistical
machinery consumed at declared extension points) none can be built RNG-side.

## The measured defect: e-value overflow INSIDE the claimed band

- δ = 3 (the standard operating point): max per-leaf e-value ≈ **4.5e9** — comfortable
  headroom (Number.MAX_VALUE ≈ 1.8e308).
- δ = 32 — **inside the band the repo claims** (cross-kind recovery "δ ∈ {3..32}",
  ADR-0046): max per-leaf e-value = **Infinity**. `JSON.stringify` serializes Infinity as
  `null`, so audits at high-δ faults carry null e-values (replay determinism is unaffected —
  the corruption is identical every run — but an audit consumer reads nulls), and
  `magnitudeZ(∞) = ∞` feeds the localizer an infinite magnitude. Pinned by
  `test/overflow-defect.test.ts` as a KNOWN DEFECT (the test's assertions flip when the fix
  lands — that is the intended tripwire, and the test says so).

**The real fix is engine-side log-domain wealth** (ADR-0034 fix B, now evidence-backed as a
defect): betting/Hotelling states carrying log-wealth, `combineAverage`/`eBenjaminiHochberg`
taking log inputs. That is a cross-product API change on the shared library — **PARKED with
the operator**, with two recorded options: (a) engine log-domain (the real fix; touches the
GPU product's consumption too); (b) an RNG-side interim clamp of family e-values at a large
finite cap (preserves ordering and selection; fixes the JSON corruption; honest as a recorded
interim, but it papers over the representation problem and touches byte-identity of high-δ
audits). No unilateral action taken.

## The other candidates — evidence-based dispositions

- **Randomized e-BH:** measured power at every tested operating point is already 1.0
  (ADR-0054's tables); the gain concentrates at sub-floor faults — exactly what the
  matched-filter program (recommendation 5, ADR-0049's build conditions) targets directly.
  QUEUED behind it; revisit with its results in hand.
- **Heavy-tail-robust increments:** deferred to real-fabric evidence (ADR-0057's replay
  measured dispersion, not tail weight; the trigger is a real calibration window showing
  heavy-tailed residuals).
- **aGRAPA/clipped betting, e-SR wealth recursion:** detector-form upgrades with no measured
  RNG gap behind them today; remain recorded engine conversations.

ADR-0037's two decisions (boosting rejected, tomography kept) were re-checked against the
current pin and stand unchanged.

## Anti-scope

No engine changes, no pin change, no RNG-side clamp (option (b) is parked, not taken), no
re-derivation of any engine machinery RNG-side.
