// Renders REPORT.md from cells.json + manifest.json; pure, shared with check_report.mjs.
const f = (x, d = 4) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));
export function render(cells, manifest) {
  const L = [];
  L.push(`# REPORT — 2026-09-e-by-surface, run ${manifest.run}`);
  L.push('');
  L.push(`tessera-rng \`${manifest.git_sha}\`, engine ${manifest.engine_version}; N = ${manifest.n} per cell, T = ${manifest.T}, q = ${manifest.q}, deltas ${manifest.deltas.join('/')}, fabric ${manifest.leaves} leaves, degraded leaves ${manifest.degraded_leaves}, calibration ticks ${manifest.calibration_ticks} (fixed). Monte-Carlo truth: M = ${manifest.truth_M} seeds per Δ. Wall ${manifest.wall_seconds} s. Closed-form deviations > 1e-12: ${cells.reduce((a, c) => a + c.closed_form_deviations, 0)}. Session/batch parity checks: ${manifest.parity_checks} equal of ${manifest.parity_checks}.`);
  L.push('');
  L.push('| Δ | rule | δ | mean selected leaves | pairs | fcr | se | bar | verdict | exact-truth miss (P2) | excludes 0 on degraded p99 (P3) | mean half-width | width ratio e-BY/naive |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of cells) for (const d of c.per_delta) {
    L.push(`| ${c.delta_shift} | ${c.rule} | ${d.delta} | ${f(c.mean_selected, 2)} | ${f(c.mean_pairs, 1)} | ${f(d.fcr)} | ${f(d.fcr_se)} | ${f(d.delta + 3 * d.fcr_se)} | ${d.verdict} | ${f(d.exact_miss)} | ${f(d.excludes_zero_degraded)} | ${f(d.mean_half_width, 3)} | ${f(d.width_ratio, 3)} |`);
  }
  L.push('');
  const p1a = cells.filter((c) => c.rule === 'B' && c.delta_shift === 0).flatMap((c) => c.per_delta);
  const p1b = cells.filter((c) => c.rule === 'A' && c.delta_shift > 0).flatMap((c) => c.per_delta);
  const held = (ds) => ds.length > 0 && ds.every((d) => d.verdict === 'HELD');
  const p2 = p1b.every((d) => d.exact_miss == null || d.exact_miss <= d.delta + 3 * (d.exact_miss_se ?? 0));
  L.push('## Endpoints');
  L.push('');
  L.push(`- **P1a exact-truth FCR under extremeness selection (ship gate):** ${held(p1a) ? 'HELD' : 'FAILED'} — ${p1a.map((d) => `δ ${d.delta}: ${f(d.fcr)} ≤ ${f(d.delta + 3 * d.fcr_se)}`).join('; ')}.`);
  L.push(`- **P1b FCR under the shipped e-BH rule on faulted fabrics:** ${held(p1b) ? 'HELD' : 'FAILED'} — ${p1b.map((d) => `${f(d.fcr)} vs ${f(d.delta + 3 * d.fcr_se)}`).join('; ')}.`);
  L.push(`- **P2 exact-truth pairs on selected leaves covered:** ${p2 ? 'HELD' : 'FAILED'} — miss fractions ${p1b.map((d) => f(d.exact_miss)).join(', ')}.`);
  L.push(`- **P3 informativeness (reported):** degraded p99 interval excludes 0 on ${p1b.map((d) => f(d.excludes_zero_degraded, 3)).join(', ')} of selected degraded leaves; width ratio ${p1b.map((d) => f(d.width_ratio, 3)).join(', ')}.`);
  L.push(`- **P4 closed form and path parity:** ${cells.every((c) => c.closed_form_deviations === 0) && manifest.parity_checks > 0 && manifest.parity_equal === manifest.parity_checks ? 'HELD' : 'FAILED'}.`);
  L.push('');
  L.push('## Monte-Carlo truth (degraded leaves, p99_latency, residual units)');
  L.push('');
  L.push('| Δ | leaves | mean θ | min θ | max θ | mean se |');
  L.push('|---|---|---|---|---|---|');
  for (const t of manifest.truth) L.push(`| ${t.delta_shift} | ${t.leaves} | ${f(t.mean_theta, 3)} | ${f(t.min_theta, 3)} | ${f(t.max_theta, 3)} | ${f(t.mean_se, 4)} |`);
  L.push('');
  return L.join('\n') + '\n';
}
