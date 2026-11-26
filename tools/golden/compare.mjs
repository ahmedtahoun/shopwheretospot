// Compares two recordings (PHP vs Worker) made by record.mjs and prints what matches, what differs and what isn't
// ported yet (501). Usage: node compare.mjs <php-dir> <worker-dir> [--show N]  (shows the first N differences)
import { readFileSync, existsSync } from 'node:fs';
const [a, b, flag, nArg] = process.argv.slice(2);
const show = flag === '--show' ? Number(nArg ?? 5) : 0;
const idx = JSON.parse(readFileSync(`${a}/_index.json`, 'utf8'));
const res = { match: [], differ: [], notPorted: [], missing: [] };
for (const e of idx) {
  if (!existsSync(`${b}/${e.file}`)) { res.missing.push(e.path); continue; }
  const x = JSON.parse(readFileSync(`${a}/${e.file}`, 'utf8'));
  const y = JSON.parse(readFileSync(`${b}/${e.file}`, 'utf8'));
  if (y.status === 501) { res.notPorted.push(e.path); continue; }
  const same = x.status === y.status && x.location === y.location && x.body === y.body && x.sha256 === y.sha256;
  (same ? res.match : res.differ).push({ path: e.path, x, y });
}
const by = (list) => list.reduce((m, it) => { const g = (it.path ?? it).split('?')[0].replace(/\/[^/]+$/, '/…'); m[g] = (m[g] ?? 0) + 1; return m; }, {});
console.log(`match ${res.match.length} · differ ${res.differ.length} · not ported ${res.notPorted.length} · missing ${res.missing.length} (of ${idx.length})`);
if (res.differ.length) console.log('differ by area:', by(res.differ));
if (res.notPorted.length) console.log('not ported by area:', by(res.notPorted));
for (const d of res.differ.slice(0, show)) {
  const why = d.x.status !== d.y.status ? `status ${d.x.status} → ${d.y.status}` : d.x.location !== d.y.location ? `location ${d.x.location} → ${d.y.location}` : 'body';
  let at = '';
  if (why === 'body' && d.x.body && d.y.body) { let i = 0; while (i < d.x.body.length && d.x.body[i] === d.y.body[i]) i++; at = `\n   php:    …${d.x.body.slice(Math.max(0, i - 60), i + 120)}\n   worker: …${d.y.body.slice(Math.max(0, i - 60), i + 120)}`; }
  console.log(` - ${d.path}: ${why}${at}`);
}
