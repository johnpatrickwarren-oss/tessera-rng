import fs from 'node:fs'; import path from 'node:path'; import { render } from './report.mjs';
const dir = process.argv[2]; if (!dir) { console.error('usage: check_report.mjs <run-dir>'); process.exit(2); }
const cells = JSON.parse(fs.readFileSync(path.join(dir, 'cells.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
if (render(cells, manifest) !== fs.readFileSync(path.join(dir, 'REPORT.md'), 'utf8')) { console.error('REPORT.md does not match its data'); process.exit(1); }
console.log(`ok: REPORT.md matches cells.json (${cells.length} cells)`);
