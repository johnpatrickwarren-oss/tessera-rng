# Telemetry temporal characterization — grounding the synthetic null

**Status:** research findings (evidence base, not a decision). Informs the telemetry-realism
enrichment and the null-window rebaseline. **Tier-2.5:** real *temporal* structure extrapolated from
fat-tree studies; *spatial*/incidence structure stays the synthetic RNG model; real RNG telemetry
remains the unfilled Tier-3 (see `VALIDATION.md`).

**Provenance:** deep-research dive (2026-06-29), 5 search angles, 17 sources fetched, 77 claims
extracted, 25 adversarially verified (3-vote, 2/3-refute-to-kill), **23 confirmed / 2 killed**.
Primary sources: Meta/Facebook SIGCOMM'15 (Roy et al.), Millisampler IMC'22, Microburst IMC'17
(Zhang et al.), Pingmesh SIGCOMM'15 (Microsoft), Benson IMC'10, DCTCP SIGCOMM'10, Twitter
AnomalyDetection (S-H-ESD).

---

## Why this exists

The validation depth-check (the round before this) found our standard null is **2.5 days, one
time-sample deep, leaning on cross-leaf pooling** — and that a week-spanning clean run produces 18
false positives with that null. Before rebaselining at an arbitrary "bigger" window, we grounded the
realistic temporal structure in real datacenter-network measurement, so the enrichment parameters and
the null window are evidence-backed, not guessed.

**Scope constraints (held firm):** TEMPORAL/workload-driven structure only. **ECMP/load-balance
imbalance excluded** (topology-specific — does not transfer fat-tree→RNG). Cross-link/cross-path
*spatial* correlation and fault-domain coupling **not** extrapolated — that is exactly where RNG
differs and remains Tessera's own incidence model.

## Grounded parameter table

| dimension | grounded value | confidence | for the generator |
|---|---|---|---|
| **Monitoring cadence** | minute-scale rollup (1–30 min SNMP, commonly 4–5 min; per-minute flow). Bursts/loss live **sub-ms** and are invisible to it — util↔drop correlation only **0.098** at 4-min | high | emit a minute-scale observable; aberrations originate *beneath* the rollup |
| **Diurnal + weekly** | real but **modest, ~2× swing** (Meta), shape time-invariant across the cycle; amplitude layer/workload-dependent | high (existence) / med (amplitude) | ~2× diurnal + a real weekday/weekend term; amplitude flagged workload-dependent |
| **p99 latency** | right-skewed, steep **host-OS-driven** tail (p50 ~250µs → p99 ~1.3ms → p99.99 100s of ms). Tail mechanism topology-independent; absolute magnitudes dated | high (shape) / low (absolute) | right-skewed marginal, steep upper tail decoupled from congestion |
| **Loss / drop rate** | near-zero floor **~1e-5–1e-4**, heavy-tailed, **burst-driven & decoupled from mean util**; leaves the band only on incidents (boundary ~1e-3) | high | near-zero floor + rare burst excursions, NOT a seasonal-mean-tracking signal |
| **Aberrations ("always happen")** | frequent short microbursts (**median 7.5/s, 2 ms**; sub-ms congestion bursts); **clustered, NOT Poisson** (KS p~0; Markov LR 15–120×); edge ON/OFF heavy-tailed | high | **clustered/Markov aberration injection**, never independent Poisson; robust baselining must exclude |
| **Utilization (driver)** | low-mean right-skewed (~1–6% mean, brief 50–65% burst excursions) | high | low-mean substrate with brief high excursions |

## Null window — grounded estimate

**~4 weeks** robust target. **≥2 weeks floor** (≥2 weekday/weekend cycles — Benson needed ≥10 days
to *see* day-of-week; Twitter runs a 14-day decomposed window daily). Push to **4–6 weeks** so rarer
recurring *incidents* (the events that push loss out of the 1e-5–1e-4 band) stay a robustly-excludable
fraction (anomaly base rates <1% app / <5% system). **Loss is the binding constraint** — its
informative aberrations are rarer per-window incidents, not per-second bursts. Confidence **medium**
(the 14-day / base-rate figures are web-service practice, not DC-network telemetry).

## Honest gaps (carry these into every downstream claim)

- **Largest weakness — retransmit-rate & flow-completion have ZERO direct grounding** in the surveyed
  sources. Model as **proxies, flagged ASSUMED:** retransmit ≈ burst-correlated function of loss;
  flow-completion ≈ right-skewed ceiling driven by the latency tail.
- **Source age** (mostly 2010–2017): absolute magnitudes (p99.99 of 100s of ms) are dated — modern
  RDMA/kernel-bypass compresses the host tail. Treat absolutes as **order-of-magnitude anchors**.
- **Topology-caveated, excluded:** per-layer seasonality amplitude (spatial), Benson util thresholds,
  per-layer loss ordering, DCTCP queue-buildup (workload-specific). **ECMP excluded** entirely.
- **Cadence simplification:** our model uses 1-hour ticks (60× coarser than realistic minute-scale);
  the sub-ms burst structure is approximated at the observable level, not simulated beneath it.
- **Weeks-to-null** leans on web-service analogy; the per-DC-network marginal payoff of extra weeks is
  an open question. Pingmesh drop is inferred from TCP-timeout heuristics, not directly measured.

## Enrichment spec (what the "robust RNG test network" must add)

Keep the RNG **incidence/correlation** model untouched. Enrich the **temporal/marginal** generation,
opt-in (so existing validation stays byte-stable), to make the synthetic a Tier-2.5 test network:

1. **Real weekly signal + ~2× diurnal** — so DoW is a generated dimension, not a modeled-but-empty one.
2. **Right-skewed / heavy-tailed marginals** — esp. loss as a near-zero floor with burst excursions
   (replace the Gaussian-around-baseline for those signals).
3. **Clustered (Markov) aberration injection** into the *clean* stream at a realistic rate — the
   "aberrations that always happen" a robust null must toss. NEVER independent Poisson.
4. **A ~4-week null window** for the rebaseline, with the calibration built **robustly** (the
   contamination-robust common-mode / `robustLocation` work finally earns a *fundamental* use here:
   building a clean null from aberration-contaminated history).

## Validation plan (what this enables)

Rebaseline against the enriched generator at the ~4-week null and surface what breaks: (a) does FDR
control hold when the null spans the full week *and* the clean stream contains clustered aberrations?
(b) which floors move vs. the thin-null numbers? (c) does robust null-building actually toss the
aberrations, or absorb them? Each of these is a finding that tells us "what else needs attention" —
the point of the test network.

## Open questions (recorded)

- Direct production temporal characterization of **retransmit rate** and **flow-completion** (the two
  ungrounded target metrics).
- Does ~2× diurnal / weekly structure hold on modern post-2020 high-radix or flat/expander fabrics, or
  has burst-dominance flattened it?
- The actual marginal-payoff curve of extra weeks for a DC-network null specifically.
- Real incident recurrence rate (how long must a null span to exclude rather than absorb incidents).
