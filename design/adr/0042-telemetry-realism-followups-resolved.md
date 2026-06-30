# ADR 0042 — Telemetry-realism follow-ups: investigated, none shipped

- **Status:** ACCEPTED (decision record; **NO code change** — net diff vs the prior state is this ADR +
  STATE). The four standing telemetry-realism follow-ups were each investigated under anti-gold-plating
  + halt-on-contradiction; **none warranted a code change.** Two prototypes were built and REVERTED
  (one on a false premise the cold-eye caught, one as immaterial); two are real-data-dependent / external.
  241 tests, gate PASS (unchanged from `main`).
- **Date:** 2026-06-30
- **Decision owner:** Tessera-RNG (the ADR-0039/0040 follow-up sweep)
- **Relates to:** ADR-0039 (robust calibration), ADR-0040 (realistic-regime coverage — its 434/0 stands
  unchanged), the test network (`tools/realistic-telemetry.ts`),
  `design/research/telemetry-temporal-characterization.md`, [`VALIDATION.md`](../../VALIDATION.md).

---

## 1. Per-metric heavy-tailed aberrations — PROTOTYPED, FALSE PREMISE, REVERTED

I built a per-metric aberration model (proportional to each signal's baseline, direction-aware,
heavy-tailed, **clamped to `[0,1]`**) on the premise that the synthetic signals are physical
rates/fractions and that a uniform `+6`/`+12` was therefore absurd (a `+12` on a loss "rate" of 0.1).

**The cold-eye caught that this premise is FALSE, and I confirmed it by measuring the raw ranges:**

```
p99:  [6.03, 14.58]   retx: [-3.68, 5.05]   loss: [-4.12, 4.93]
ecmp: [-3.84, 5.23]   compl:[-2.92, 5.42]
```

The synthetic signals are **abstract** — `SIGNAL_BASE + diurnal + AR(1) unit-Gaussian noise`, each with
**sd ≈ 1**, routinely negative — and are only ever **standardized** downstream; they are NOT physical
`[0,1]` rates. So:

- The `+12` I called absurd is `+12σ` on an abstract, sd≈1 signal — a sensible (strong) outlier. The
  original **uniform σ-scale aberration model was already defensible.**
- The `[0,1]` clamp is not a physical correction — it would crush **~53% of the clean baseline** (the
  `aberrations:false` path used by the realistic-regime live window and the clean-FDR tests) into point
  masses at 0 and 1, a destructive distribution change that would also have **confounded** the 434→207
  realistic-regime revision the first draft of this ADR wrongly attributed to "model defensibility."

This is a textbook halt-on-contradiction miss: I assumed a data property instead of running it and
recording the range. The prototype is **fully reverted** (`tools/realistic-telemetry.ts`, `coverage.ts`,
and the tests are byte-identical to `main`); the realistic-regime row stays **434 / 0** (ADR-0040).

## 2. AR-model robustness — PROTOTYPED, IMMATERIAL, REVERTED

The artifact is real (aberration residual spikes inflate the BIC-selected AR order, clean p=1 →
laden p=5), but a winsorized-AR prototype changed **no** detection metric — regenerating the full
coverage with it gave zero floor changes (incl. `mode_floors`), unchanged realistic-regime, clean FDR 0.
The robust BASELINE already removes the bursts' leverage on every measured axis. Reverted per
anti-gold-plating; recorded so it is not re-investigated.

## 3. The 4-week null for real incident exclusion — RECORDED, real-data-dependent

Stays **2 weeks** for the synthetic (n≥50/cell for robust per-cell resolution). 4 weeks is the depth to
exclude *recurring incidents*, but the aberration-free synthetic has none; fabricating synthetic
recurring incidents to "demonstrate" a 4-week requirement would be modeling theater (it would prove only
that we excluded what we injected). A real-deployment parameter, deferred until real telemetry exists.

## 4. Tier-3 real RNG telemetry — PERMANENTLY EXTERNAL (anti-scope)

Cannot be built without real RNG-fabric telemetry, which does not exist for this project
(`VALIDATION.md` Tier 3, empty by construction). Closed by *acquiring data*, never by simulating it.

## The heavy-tailed-marginal gap (the one real research finding behind #1)

Real telemetry has heavy-tailed marginals; the synthetic uses unit-Gaussian noise. This remains a
**recorded limitation**, NOT closed here: the aberration is a deliberate σ-scale stressor for
null-building, not a marginal-distribution model, and (per the AR lesson) a heavier-tailed aberration
intensity changes none of the published conclusions. Documented, not gold-plated.

## Anti-scope (must-never)

- **No gold-plating** — both prototypes were built and reverted *because* they moved no metric (AR) or
  rested on a false premise (per-metric); neither earns a maintenance surface.
- **No assuming data properties** — the per-metric miss is the lesson: measure the range, don't assume it.
- **No simulated Tier-3, no faked incident exclusion.**

## Consequences

- The follow-up list is closed honestly: rigorously investigated, **zero code shipped** — a legitimate
  and disciplined outcome. The realistic-regime claim (ADR-0040, mean/sd 434 vs robust 0) stands exactly
  as published, on the uniform σ-scale aberration model that the range-check vindicated.
- The cold-eye earned its keep again: it caught a false-premise build (the `[0,1]` clamp) before merge,
  on the artifact that underpins a published claim.
