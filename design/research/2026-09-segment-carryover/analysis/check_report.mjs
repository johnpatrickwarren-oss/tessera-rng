// check_report.mjs — pins every number in REPORT.md to the run artifacts. Exit 1 on drift.
//   node design/research/2026-09-segment-carryover/analysis/check_report.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUDY = join(HERE, '..');
const report = readFileSync(join(STUDY, 'REPORT.md'), 'utf8');
const runs = readdirSync(join(STUDY, 'results')).filter((d) => d.startsWith('run-'));
if (runs.length !== 1) { console.error(`expected exactly 1 run dir, found ${runs.length}`); process.exit(1); }
const run = runs[0];
const R = (f) => JSON.parse(readFileSync(join(STUDY, 'results', run, f), 'utf8'));
const E = R('endpoints.json'), C = R('cells.json'), M = R('manifest.json'), P = R('posthoc.json');
for (const f of ['leaves.json']) if (!existsSync(join(STUDY, 'results', run, f))) { console.error(`missing ${f}`); process.exit(1); }

let failed = 0;
const check = (name, ok) => { if (!ok) { console.error(`FAIL ${name}`); failed++; } };
const has = (s) => report.includes(s);
const f4 = (x) => x.toFixed(4);
const ARMS = ['mean', 'product', 'martingale'];
const CELLS = ['b1-d0', 'b3-d0', 'b1-d2', 'b1-d4', 'b3-d2', 'b3-d4'];

check('report names the run dir', has(run));
check('report names the repo sha', has(M.repo_sha.slice(0, 7)));
check('report names the engine pin', has(M.engine_pin) && has(M.engine_installed_version));
check('manifest carries no wall clock', !('runtime_seconds' in M) && !('generated_at' in M));
check('manifest: 200 seeds, lead 25, not a dry run', M.n_seeds_per_cell === 200 && M.cell_grid.lead === 25 && M.dry_run === false);

// verdict lines, one per endpoint, exactly as computed.
for (const p of ['P1', 'P2', 'P3', 'P4', 'P5']) check(`${p} verdict line`, has(`| ${p} `) && has(`**${E[p].verdict}**`) && new RegExp(`\\| ${p} [^\\n]*\\*\\*${E[p].verdict}\\*\\*`).test(report));
check('ship rule', E.REPORTED.ship_rule.startsWith('DOES NOT FIRE') && has('does not fire'));

// P1: every H0 cell × arm number and band.
for (const arm of ARMS) for (const c of ['b1-d0', 'b3-d0']) {
  const m = E.P1.measured[arm][c];
  check(`P1 ${arm} ${c}`, m.held && has(f4(m.measured)) && has(f4(m.band_upper)));
}
check('P1 N', has('6800') && has('757'));
// P2: rates and the margin.
for (const c of ['b1-d2', 'b1-d4', 'b3-d2', 'b3-d4']) check(`P2 ${c} rates`, E.P2.measured.per_cell[c].product === 1 && E.P2.measured.per_cell[c].mean === 1);
check('P2 margin 0', E.P2.measured.margin_b3_d4 === 0 && E.P2.clauses.all_cells_product_ge_mean && !E.P2.clauses.margin_b3_d4_ge_0_10 && has('0.0000 (band ≥ 0.10)'));
// P3: the martingale rates.
for (const c of ['b1-d2', 'b1-d4', 'b3-d2', 'b3-d4']) check(`P3 ${c}`, has(f4(E.P3.measured[c].martingale)));
check('P3 fails on b1', E.P3.measured['b1-d2'].martingale < 1 && E.P3.measured['b1-d4'].martingale < 1 && E.P3.measured['b3-d2'].martingale === 1 && E.P3.measured['b3-d4'].martingale === 1);
// P4: medians.
for (const c of ['b1-d4', 'b3-d4']) { const m = E.P4.measured[c]; check(`P4 ${c}`, m.product === m.mean && has(`${m.product} / ${m.mean} / ${m.martingale_reported}`)); }
// P5: variances to 2 decimals.
for (const c of ['b1-d0', 'b3-d0']) { const m = E.P5.measured[c]; check(`P5 ${c}`, m.product > m.martingale && has(m.product.toFixed(2)) && has(m.martingale.toFixed(2))); }
// reported: δ=2 medians, tick-resolution H0 rates, Family C, K histogram, λ.
for (const c of ['b1-d2', 'b3-d2']) { const m = C[c].registered.median_first_tick; check(`reported medians ${c}`, has(`${m.mean} / ${m.product} / ${m.martingale}`)); }
for (const c of ['b1-d0', 'b3-d0']) for (const arm of ARMS) check(`tick-res H0 ${c} ${arm}`, has(f4(E.REPORTED.tick_resolution_rates[c][arm])));
for (const c of ['b1-d2', 'b3-d2']) for (const arm of ARMS) check(`family C ${c} ${arm}`, has(f4(E.REPORTED.family_C_rate_end[c][arm])));
const kh = E.REPORTED.any_boundary_population['b3-d0'].K_histogram;
check('K histogram b3-d0', has(`${kh['2']} / ${kh['3']} / ${kh['4']}`));
check('λ mean b1-d2', has(f4(E.REPORTED.lambda_mean_by_segment['b1-d2'][1])));
// every registered cell's N appears.
for (const c of CELLS) check(`N ${c}`, has(String(C[c].registered.n_leaves)));
// post-hoc: each lead cell's product/mean medians appear in the post-hoc table.
for (const [label, cell] of Object.entries(P.cells)) {
  const m = cell.median_first_tick;
  const med = (x) => (x === null ? '∞' : x);   // JSON serializes +Infinity (no crossing) as null
  check(`post-hoc ${label}`, has(`| ${label} | ${cell.n_leaves} | ${med(m.mean)} / ${med(m.product)} / ${med(m.martingale)} |`));
}
check('post-hoc labelled', has('POST-HOC') && has('no verdict'));
// counters: no failures possible (no catch), but the equality counters must equal the leaf counts.
for (const c of CELLS) check(`counters ${c}`, M.counters[c].shipped_equalities === M.counters[c].trajectory_equalities && M.counters[c].shipped_equalities >= C[c].registered.n_leaves);

if (failed) { console.error(`${failed} inconsistencies`); process.exit(1); }
console.log(`check_report: REPORT.md consistent with ${run}`);
