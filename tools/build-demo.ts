/**
 * Single-file demo dashboard builder (v1 spec AC-8).
 *
 * Runs the eight deterministic scenarios (six v1 + covariance-flip and oscillation, ADR-0012) and
 * emits a self-contained demos/demo.html that pages through them: verdict surface, the firing-mode
 * attribution (which detector family A/C/D caught it), ranked shared-resource culprits (with the
 * correlational-not-causal badge), the simulated route-drain, and the honest unexplained-set count.
 * No external assets; the scenario audit records are embedded as JSON, so the page is replay-clean.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runAllScenarios } from './scenarios';
import type { ScenarioResult } from './scenarios';

export function render(scenarios: ScenarioResult[]): string {
  // Embed the verdict SURFACE, not every per-path-class verdict (the dashboard renders the
  // surface + culprits + drain). Dropping the large verdicts array keeps the file lean.
  const data = JSON.stringify(scenarios, (k, v) => (k === 'verdicts' ? undefined : v));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>Tessera-RNG — demo</title>
<style>
 :root{color-scheme:dark}
 body{background:#0e1116;color:#d7dde5;font:14px/1.5 ui-monospace,Menlo,monospace;margin:0;padding:24px}
 h1{font-size:18px;margin:0 0 4px}.sub{color:#8b97a7;margin:0 0 16px}
 select{background:#161b22;color:#d7dde5;border:1px solid #30363d;border-radius:6px;padding:6px 10px;font:inherit}
 .panel{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px 16px;margin:14px 0}
 .k{color:#8b97a7}.v{color:#e6edf3}.big{font-size:22px;font-weight:600}
 table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:6px 10px;border-bottom:1px solid #21262d}
 th{color:#8b97a7;font-weight:500}
 .badge{display:inline-block;font-size:11px;padding:1px 7px;border-radius:10px;border:1px solid #b5891f;color:#e3b341}
 .ok{color:#3fb950}.fire{color:#f85149}
 .row{display:flex;gap:28px;flex-wrap:wrap}
</style></head><body>
<h1>Tessera-RNG</h1>
<p class="sub">Operational observability for flat random-graph network fabrics — deterministic demo scenarios.</p>
<select id="sel"></select>
<div class="panel"><div id="desc"></div></div>
<div class="panel"><div class="row">
  <div><div class="k">fleet log e-value</div><div class="big" id="fleet"></div></div>
  <div><div class="k">path-classes selected (e-BH, q)</div><div class="big" id="sel-n"></div></div>
  <div><div class="k">caught by family (A/C/D)</div><div class="big" id="fam"></div></div>
  <div><div class="k">unexplained firing</div><div class="big" id="unexp"></div></div>
  <div><div class="k">snapshot hash</div><div class="v" id="hash"></div></div>
</div></div>
<div class="panel"><div class="k">ranked shared-resource culprits (tomographic localization)</div>
  <table id="culprits"><thead><tr><th>#</th><th>resource</th><th>kind</th><th>score</th><th>firing / traversing</th><th></th></tr></thead><tbody></tbody></table>
  <div id="no-culprits" class="ok" style="display:none">no culprit — verdict surface quiet (FDR control)</div>
</div>
<div class="panel"><div class="k">route-drain actuation (simulated)</div><div id="drain"></div></div>
<script>
const SCENARIOS = ${data};
const sel = document.getElementById('sel');
SCENARIOS.forEach((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent=s.name;sel.appendChild(o);});
function r6(x){return Math.round(x*1e6)/1e6;}
function render(i){
  const s = SCENARIOS[i], a = s.audit;
  document.getElementById('desc').innerHTML = '<b>'+s.name+'</b> — '+s.description+(s.injected_resource_id?' <span class="k">(injected: '+s.injected_resource_id+')</span>':'');
  document.getElementById('fleet').textContent = r6(a.fleet_log_e);
  document.getElementById('sel-n').innerHTML = '<span class="'+(a.selected_path_class_ids.length?'fire':'ok')+'">'+a.selected_path_class_ids.length+'</span> <span class="k">@ q='+a.q+'</span>';
  const ff = a.firing_families;
  document.getElementById('fam').innerHTML = (ff.A||ff.C||ff.D) ? ('<span class="fire">'+ff.A+' / '+ff.C+' / '+ff.D+'</span>') : '<span class="ok">— / — / —</span>';
  document.getElementById('unexp').textContent = a.unexplained_path_class_ids.length;
  document.getElementById('hash').textContent = a.snapshot_hash.slice(0,16)+'…';
  const tb = document.querySelector('#culprits tbody'); tb.innerHTML='';
  document.getElementById('no-culprits').style.display = a.culprits.length?'none':'block';
  a.culprits.forEach((c,n)=>{const tr=document.createElement('tr');
    tr.innerHTML='<td>'+(n+1)+'</td><td class="v">'+c.resource_id+'</td><td>'+c.resource_kind+'</td><td>'+r6(c.score)+'</td><td>'+c.firing_member_count+' / '+c.traversing_count+'</td><td><span class="badge">correlational, not causal</span></td>';
    tb.appendChild(tr);});
  const d = a.drain_actions[0];
  document.getElementById('drain').innerHTML = d ? ('draining <span class="v">'+d.drained_path_class_ids.length+'</span> path-classes off <span class="v">'+d.resource_id+'</span> <span class="badge">simulated</span>') : '<span class="ok">no actuation</span>';
}
sel.addEventListener('change',e=>render(+e.target.value));
render(0);
</script></body></html>`;
}

async function main(): Promise<void> {
  const scenarios = await runAllScenarios();
  const outDir = join(process.cwd(), 'demos');
  mkdirSync(outDir, { recursive: true });
  const html = render(scenarios);
  writeFileSync(join(outDir, 'demo.html'), html);
  // eslint-disable-next-line no-console
  console.log(`wrote demos/demo.html (${scenarios.length} scenarios, ${html.length} bytes)`);
}

if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
