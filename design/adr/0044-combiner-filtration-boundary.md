# ADR 0044 — The e-value combiner's filtration boundary: pinned, evidence-tested, claims scoped

- **Status:** ACCEPTED (analysis + evidence tests + doc-comment scoping; **no behavioral change**).
  Prompted by Choe & Ramdas, *Combining evidence across filtrations* (JRSS-B 2026,
  arXiv:2402.09698): e-processes built in different filtrations cannot be naively combined into
  an anytime-valid e-process — validity does not transfer without "adjusters."
- **Date:** 2026-07-02
- **Decision owner:** Tessera-RNG
- **Relates to:** ADR-0009 (Family D), ADR-0018 (segments), ADR-0027 (session), ADR-0043
  (every-tick boundary), ADR-0045 (the Family D null defect this investigation surfaced),
  `test/filtration-boundary.test.ts`.

---

## The question

`detect.ts` averages Family A and C (per-tick processes, tick filtration F_t) with Family D
(spectral e-detector over NON-overlapping 40-tick windows — window filtration G_k = F_{40k}),
and averages per-segment e-values across epochs (ADR-0018). Averaging e-VALUES is valid under
arbitrary dependence — but is the combined leaf value an anytime-valid e-PROCESS in tick time?

## The analysis (each claim observed or proved, not assumed)

1. **Family A and C are F-supermartingales.** A mean of supermartingales *w.r.t. the same
   filtration* is a supermartingale — Family A's per-signal mean and the A/C pair are fine.
2. **Family D is a G-supermartingale and provably NOT an F-supermartingale.** Conditioned on the
   first 39 ticks of a window (a strongly periodic prefix — positive density under the null),
   the expected wealth multiple over the final tick exceeds 1 (measured ≈ 2+; evidence test (1)).
   The engine detector was built to satisfy E[L_k | G_{k−1}] ≤ 1, a strictly coarser statement.
3. **Family D's own fire rule keeps its exact Ville bound at every tick anyway**: its wealth is
   CONSTANT between window boundaries (evidence test (3)), so sup over ticks = sup over windows
   and P(sup_t D_t ≥ 1/α) ≤ α transfers verbatim. Per-family firing needs no fix.
4. **Any FIXED-time combined query is a valid e-value**: at fixed t each family has E ≤ 1 in its
   own filtration (fixed times are stopping times in every filtration); linearity does the rest.
   Every published figure — batch audits, coverage floors, clean-FDR — is a fixed-time read.
5. **The combined value at an arbitrary F-stopping time is NOT exactly valid — but is bounded.**
   The mean of K nonnegative processes is ≤ their max pointwise, so
   P(sup_t X̄_t ≥ c) ≤ Σ_f P(sup M_f ≥ c) ≤ **K/c** (K = number of families present, 3; the
   same argument covers the ADR-0018 per-segment mean with K = segments × families). So
   "stop on first combined crossing" inflates the e-value guarantee by at most K — degraded,
   not destroyed.

## Decision

- **No behavioral change.** The published claims are fixed-time claims and remain exactly valid;
  per-family fire rules keep exact Ville bounds. The K/c union bound is the honest statement for
  data-dependent stopping on the *combined* value, and it is now stated where the combiner lives
  (`detect.ts`) and where the session's anytime language lived (`session.ts` — its "makes the
  SYSTEM anytime" sentence overstated; rewritten).
- **Evidence tests** (`test/filtration-boundary.test.ts`) pin facts (2), (3), and — surfaced by
  this very investigation — the ADR-0045 marginal-validity defect, so none of this analysis
  rests on reading comprehension of an external paper.
- **Upgrade path recorded, not built:** lift Family D to F with a Choe–Ramdas adjuster (known
  power haircut), or move families to predictable-weight meta-betting in F. Only worth doing if
  a consumer actually needs an exactly-valid *combined* anytime e-process; today none does.

## What the investigation surfaced en route

Running the evidence experiment falsified a bigger assumption than the one under test: the raw
Family D wealth is not even a valid e-value at FIXED time against its true null (E[L] ≈ 1.12 per
clean window) — the Gaussian null model class does not fit the right-skewed peak-|ACF| statistic.
That is a marginal-validity defect, orthogonal to filtrations, and it gets its own decision:
**ADR-0045** (PIT-Gaussianized null, shipped as default). Halt-on-contradiction honored: the
experiment was widened to diagnose (skew, held-out E[L], anytime false-alarm rate at 1.3% vs the
claimed 1%) before any fix was designed.
