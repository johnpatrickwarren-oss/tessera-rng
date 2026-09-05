// design/research/2026-09-cascade/analysis/report.mjs — renders REPORT.md from cells.json + manifest.json.
// Pure; the harness and check_report.mjs both call it so the report cannot drift from its data.
const f = (x, d = 3) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));
const pct = (x) => (x == null ? '—' : x.toFixed(3));
const counts = (m) => Object.entries(m ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || '—';
const NAMES = { bet: 'O_bet (shipped Family A crossing)', ebh: 'O_ebh (first e-BH selection)', ctr: 'O_ctr (ADR-0067 effect-interval centre at T, descending)' };
export function render(cells, manifest) {
  const L = [];
  const key = (c) => `f = ${c.f}, r = ${c.r}, lag = ${c.lag}`;
  L.push(`# REPORT — 2026-09-cascade (tessera-rng), run ${manifest.run}`);
  L.push('');
  L.push(`tessera-rng \`${manifest.git_sha}\`, engine ${manifest.engine_version}, N = ${manifest.n} per cell, ${manifest.leaves} leaves, A = ${manifest.A}, B = ${manifest.B}, Δ_A = ${manifest.delta_a} raw, t₀ = ${manifest.t0}, censor ${manifest.censor}, mid audit at t₁ + ${manifest.mid_offset}, lags {${manifest.lags.join(', ')}}, ratios {${manifest.ratios.join(', ')}}, fractions {${manifest.fractions.join(', ')}} (f = 1 at r = 2 only), reroute seed ${manifest.reroute_seed}, α_A ${manifest.alpha_a}, q = δ = ${manifest.q}, truth M = ${manifest.truth_M}. Workers ${manifest.workers}. Wall ${manifest.wall_seconds} s. Exceptions ${cells.reduce((a, c) => a + c.exceptions, 0)}. Parity failures ${cells.reduce((a, c) => a + c.parity_failures, 0)}.`);
  L.push('');
  L.push('## Scenario per cell (the registered routing outcome, the realised shifts, the certificate)');
  L.push('');
  L.push('| f | r | lag | t₁ | T | stay | →B | →other | B orig | nulls | pairs | rerouted by zone | θ_A per tick | θ_B per tick | window mean stay / →B / →other / B | certificate e0, e1 (groups, fleet-amb, identifiable/resources) |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of cells) L.push(`| ${c.f} | ${c.r} | ${c.lag} | ${c.t1} | ${c.T} | ${c.sets.stay} | ${c.sets.toB} | ${c.sets.toOther} | ${c.sets.B} | ${c.null_leaves} | ${c.pairs} | ${counts(c.dest)} | ${f(c.truth.shift_A)} | ${f(c.truth.shift_B)} | ${f(c.truth.window_mean_by_set.stay)} / ${f(c.truth.window_mean_by_set.toB)} / ${f(c.truth.window_mean_by_set.toOther)} / ${f(c.truth.window_mean_by_set.B)} | ${c.certificate.map((x) => `${x.ambiguity_groups}, ${x.fleet_ambiguous}, ${x.identifiable}/${x.resources}`).join('; ')} |`);
  L.push('');
  L.push('## P1 — sequencing against the causal order (P1a: A − 3·se > 0.5; P1b at lag 50: A ≥ 0.8; P1c: Φ_bet ≤ 0.02; P4 at lag 50, f = 0.5: A_seg − 3·se > 0.5)');
  L.push('');
  L.push('| f | r | lag | ordering | A (leaf pairs) | se | P1a | P1b | A (resources) | A_stay | A_seg | P4 | seg crossed before t₁ | Φ | P1c | p_detect | delay stay | delay →B | delay →other | delay B |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of cells) for (const o of c.per_ordering) {
    const d = (k) => (o.by_set ? `${f(o.by_set[k].delay_mean, 1)} (${f(o.by_set[k].delay_sd, 1)}, p ${f(o.by_set[k].p_detect, 2)})` : '—');
    L.push(`| ${c.f} | ${c.r} | ${c.lag} | ${o.ordering} | ${f(o.A)} | ${f(o.A_se, 4)} | ${o.p1a} | ${o.p1b ?? '—'} | ${f(o.A_resource)} | ${f(o.A_stay)} | ${f(o.A_seg)} | ${o.p4 ?? '—'} | ${f(o.seg_crossed_before_t1)} | ${f(o.phi, 4)} | ${o.p1c ?? '—'} | ${f(o.p_detect)} | ${d('stay')} | ${d('toB')} | ${d('toOther')} | ${d('B')} |`);
  }
  L.push('');
  L.push('## P2 — location from the shipped audit at T (P2a: named_A ≥ 0.9 where it applies; P2b: drain target ∈ {A, B} ≥ 0.95)');
  L.push('');
  L.push('| f | r | lag | named_A | named_B | P2a | drain = A | drain = B | drain faulted | P2b | head = A | head = B | head faulted | P2b (head) | drain targets | rank A | rank B | occurrences A | epochs A | epochs B | best epoch A | score A | score B | firing A | firing B | culprits | unexplained | ambiguous | selected | empty | resets |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of cells) { const e = c.p2.end; L.push(`| ${c.f} | ${c.r} | ${c.lag} | ${pct(e.named_A)} | ${pct(e.named_B)} | ${c.p2.p2a ?? '—'} | ${pct(e.drain_A)} | ${pct(e.drain_B)} | ${pct(e.drain_faulted)} | ${c.p2.p2b} | ${pct(e.head_A)} | ${pct(e.head_B)} | ${pct(e.head_faulted)} | ${c.p2.p2b_head} | ${counts(e.drain_counts)} | ${f(e.rank_A_mean, 2)} | ${f(e.rank_B_mean, 2)} | ${f(e.occ_A_mean, 2)} | ${counts(e.epoch_A)} | ${counts(e.epoch_B)} | ${counts(e.best_epoch_A)} | ${f(e.score_A_mean, 1)} | ${f(e.score_B_mean, 1)} | ${f(e.firing_A_mean, 1)} | ${f(e.firing_B_mean, 1)} | ${f(e.n_culprits_mean, 2)} | ${f(e.n_unexplained_mean, 1)} | ${e.n_ambiguous_total} | ${f(e.n_selected_mean, 1)} | ${pct(e.p_empty)} | ${e.n_resets} |`); }
  L.push('');
  L.push('### P2 at t₁ + 50 (reported)');
  L.push('');
  L.push('| f | r | lag | named_A | named_B | drain = A | drain = B | drain faulted | head = A | head = B | drain targets | rank A | rank B | epoch A | epoch B | culprits | selected | empty |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of cells) { const e = c.p2.mid; L.push(`| ${c.f} | ${c.r} | ${c.lag} | ${pct(e.named_A)} | ${pct(e.named_B)} | ${pct(e.drain_A)} | ${pct(e.drain_B)} | ${pct(e.drain_faulted)} | ${pct(e.head_A)} | ${pct(e.head_B)} | ${counts(e.drain_counts)} | ${f(e.rank_A_mean, 2)} | ${f(e.rank_B_mean, 2)} | ${counts(e.epoch_A)} | ${counts(e.epoch_B)} | ${f(e.n_culprits_mean, 2)} | ${f(e.n_selected_mean, 1)} | ${pct(e.p_empty)} |`); }
  L.push('');
  L.push('## P3 — e-BY coverage of the window-average truth at T (FCR ≤ δ + 3·se, δ = 0.05)');
  L.push('');
  L.push('| f | r | lag | FCR | se | P3 | intervals | α_i | mean half-width | miss stay | miss →B | miss →other | miss B | miss null | n stay / →B / →other / B / null |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of cells) { const p = c.p3; L.push(`| ${c.f} | ${c.r} | ${c.lag} | ${f(p.fcr, 4)} | ${f(p.fcr_se, 4)} | ${p.verdict} | ${p.n_intervals} | ${f(p.alpha_i_mean, 4)} | ${f(p.mean_half_width)} | ${f(p.miss_by_set.stay, 4)} | ${f(p.miss_by_set.toB, 4)} | ${f(p.miss_by_set.toOther, 4)} | ${f(p.miss_by_set.B, 4)} | ${f(p.miss_by_set.null, 4)} | ${p.n_by_set.stay} / ${p.n_by_set.toB} / ${p.n_by_set.toOther} / ${p.n_by_set.B} / ${p.n_by_set.null} |`); }
  L.push('');
  const ords = cells.flatMap((c) => c.per_ordering.map((o) => ({ c, o })));
  const p1a = ords.filter((x) => x.o.p1a !== 'NOT-SCORED');
  const p1aHeld = p1a.filter((x) => x.o.p1a === 'HELD');
  const p1aFailed = p1a.filter((x) => x.o.p1a === 'FAILED');
  const p1b = ords.filter((x) => x.o.p1b && x.o.p1b !== 'NOT-SCORED');
  const p1c = ords.filter((x) => x.o.p1c);
  const p4 = ords.filter((x) => x.o.p4 && x.o.p4 !== 'NOT-SCORED');
  const p2a = cells.filter((c) => c.p2.p2a && c.p2.p2a !== 'NOT-SCORED');
  const p2b = cells.filter((c) => c.p2.p2b !== 'NOT-SCORED');
  const r2 = cells.filter((c) => c.r === 2);
  const tag = (x) => `${key(x.c)} ${x.o.ordering}`;
  L.push('## Endpoints');
  L.push('');
  L.push(`- **P1a better than chance:** ${p1aFailed.length === 0 ? 'HELD' : 'FAILED'} (${p1aHeld.length} of ${p1a.length} scored cell×ordering bars; ${ords.length - p1a.length} not scored)${p1aFailed.length ? '; failed: ' + p1aFailed.map((x) => `${tag(x)} A ${f(x.o.A)}`).join('; ') : ''}.`);
  L.push(`- **P1b C74's floor 0.8 at lag 50 (bet, ebh):** ${p1b.every((x) => x.o.p1b === 'HELD') ? 'HELD' : 'FAILED'} (${p1b.filter((x) => x.o.p1b === 'HELD').length} of ${p1b.length}; smallest A ${f(Math.min(...p1b.map((x) => x.o.A)))})${p1b.some((x) => x.o.p1b === 'FAILED') ? '; failed: ' + p1b.filter((x) => x.o.p1b === 'FAILED').map((x) => `${tag(x)} A ${f(x.o.A)}`).join('; ') : ''}.`);
  L.push(`- **P1c false sequencing Φ_bet ≤ 0.02:** ${p1c.every((x) => x.o.p1c === 'HELD') ? 'HELD' : 'FAILED'} (largest Φ_bet ${f(Math.max(...p1c.map((x) => x.o.phi)), 4)}; Φ_ebh ${f(Math.min(...ords.filter((x) => x.o.ordering === 'ebh').map((x) => x.o.phi)), 4)}–${f(Math.max(...ords.filter((x) => x.o.ordering === 'ebh').map((x) => x.o.phi)), 4)}).`);
  L.push(`- **P2a the causal resource is named (where the bar applies):** ${p2a.every((c) => c.p2.p2a === 'HELD') ? 'HELD' : 'FAILED'} (${p2a.filter((c) => c.p2.p2a === 'HELD').length} of ${p2a.length}; smallest named_A ${pct(Math.min(...p2a.map((c) => c.p2.end.named_A)))})${p2a.some((c) => c.p2.p2a === 'FAILED') ? '; failed: ' + p2a.filter((c) => c.p2.p2a === 'FAILED').map((c) => `${key(c)} ${pct(c.p2.end.named_A)}`).join('; ') : ''}. Reported at f = 1, lag 5 / 20: named_A ${cells.filter((c) => c.f === 1 && c.lag !== 50).map((c) => `${pct(c.p2.end.named_A)} (lag ${c.lag})`).join(', ')}.`);
  L.push(`- **P2b no non-faulted resource is the drain target:** ${p2b.every((c) => c.p2.p2b === 'HELD') ? 'HELD' : 'FAILED'} (${p2b.filter((c) => c.p2.p2b === 'HELD').length} of ${p2b.length}; smallest ${pct(Math.min(...p2b.map((c) => c.p2.end.drain_faulted)))}); list head on the same bar: ${p2b.every((c) => c.p2.p2b_head === 'HELD') ? 'HELD' : 'FAILED'} (smallest ${pct(Math.min(...p2b.map((c) => c.p2.end.head_faulted)))}).`);
  L.push(`- **P2c which resource when B is larger (r = 2), registered prediction B:** drain = B in ${r2.map((c) => `${pct(c.p2.end.drain_B)} (f ${c.f}, lag ${c.lag})`).join(', ')}; drain = A at r = 0.5: ${cells.filter((c) => c.r === 0.5).map((c) => `${pct(c.p2.end.drain_A)} (lag ${c.lag})`).join(', ')}; at r = 1: drain = B ${cells.filter((c) => c.r === 1).map((c) => `${pct(c.p2.end.drain_B)} (lag ${c.lag})`).join(', ')}.`);
  L.push(`- **P2d ambiguity:** ${cells.reduce((a, c) => a + c.p2.end.n_ambiguous_total, 0)} culprits carry an ambiguity group across all cells; certificate groups ${cells.every((c) => c.certificate.every((x) => x.ambiguity_groups === 0)) ? '0 on every epoch snapshot' : 'PRESENT on some snapshot'}.`);
  L.push(`- **P3 e-BY coverage:** ${cells.every((c) => c.p3.verdict === 'HELD') ? 'HELD' : 'FAILED'} (${cells.filter((c) => c.p3.verdict === 'HELD').length} of ${cells.length}; largest FCR ${f(Math.max(...cells.map((c) => c.p3.fcr)), 4)}).`);
  L.push(`- **P4 segment reset at lag 50, f = 0.5 (bet, ebh):** ${p4.every((x) => x.o.p4 === 'HELD') ? 'HELD' : 'FAILED'} (${p4.filter((x) => x.o.p4 === 'HELD').length} of ${p4.length}; smallest A_seg ${f(Math.min(...p4.map((x) => x.o.A_seg)))}). A_seg − A_stay per f = 0.5 cell (bet): ${cells.filter((c) => c.f === 0.5).map((c) => { const o = c.per_ordering.find((x) => x.ordering === 'bet'); return `${f(o.A_seg - o.A_stay, 2)} (r ${c.r}, lag ${c.lag})`; }).join(', ')}.`);
  const uneq = cells.filter((c) => c.r === 2 && c.f === 0.5);
  const uneqFires = uneq.every((c) => c.per_ordering.every((o) => o.p1a !== 'HELD'));
  const locFails = p2b.some((c) => c.p2.p2b === 'FAILED') || p2a.some((c) => c.p2.p2a === 'FAILED');
  L.push(`- **Falsifier 3, unequal-size half (fires only if at r = 2, f = 0.5 no ordering meets P1a at any lag):** ${uneqFires ? 'FIRED' : 'DID NOT FIRE'}; orderings meeting P1a at r = 2, f = 0.5: ${uneq.map((c) => `lag ${c.lag}: ${c.per_ordering.filter((o) => o.p1a === 'HELD').map((o) => o.ordering).join('/') || 'none'}`).join('; ')}.`);
  L.push(`- **Falsifier 3, location half (fires if P2b fails in any cell or P2a fails where its bar applies):** ${locFails ? 'FIRED' : 'DID NOT FIRE'}.`);
  L.push('');
  L.push('Ordering names: ' + Object.entries(NAMES).map(([k, v]) => `${k} = ${v}`).join('; ') + '. Leaf sets: stay = A\'s leaves not rerouted; →B = rerouted onto B; →other = rerouted onto pzone-1/pzone-2; B = B\'s original members. Pairs are (a ∈ L_A, b ∈ L_B); A_seg is over a ∈ →B ∪ →other, A_stay over a ∈ stay. Delays are crossing tick minus the leaf\'s onset (t₀ for L_A, t₁ for L_B); "seg crossed before t₁" is the fraction of rerouted A leaves whose crossing precedes the reset.');
  L.push('');
  return L.join('\n') + '\n';
}
