// Compares two write-test results (scenario.mjs): answers step by step, saved rows table by table, and what was sent.
// Things that differ on every run (times, random tokens, hashes, the local address and port) are blanked first.
// Usage: node compare-writes.mjs <php.json> <worker.json> [--show N]
import { readFileSync } from 'node:fs';

const [a, b] = process.argv.slice(2, 4).map((f) => JSON.parse(readFileSync(f, 'utf8')));
const show = Number(process.argv[process.argv.indexOf('--show') + 1] || 30);

const norm = (v) => v === undefined ? null : JSON.parse(JSON.stringify(v)
  .replace(/https?:\/\/(localhost|127\.0\.0\.1):\d+/g, '<site>')
  .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g, '<datetime>')
  .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '<date>')
  .replace(/\b1[6-9]\d{8}\b/g, '<unixtime>')
  .replace(/\b(\d+ [A-Z][a-z]{2}, \d{2}:\d{2})\b/g, '<when>')
  .replace(/(WTS-\d+)-[a-f0-9]{6}\b/g, '$1-<ref>')
  .replace(/\b[a-f0-9]{64}\b/g, '<sha256>')
  .replace(/\$2y\$\d\d\$[.\/A-Za-z0-9]{53}|pbkdf2:[^"\\]+/g, '<hash>')
  .replace(/(sign-in code: |كود الدخول: |letter-spacing:8px[^>]*>)\d{6}/g, '$1<code>')
  .replace(/(\\"ip\\":\\")[^\\]*(\\")/g, '$1<ip>$2')
  .replace(/"ip":"[^"]*"/g, '"ip":"<ip>"')
  .replace(/mock_cs_\d+/g, 'mock_cs_<n>'));

const diffs = [];
const cmp = (where, x, y) => { const nx = JSON.stringify(norm(x)), ny = JSON.stringify(norm(y)); if (nx !== ny) diffs.push({ where, php: norm(x), worker: norm(y) }); };

a.answers.forEach((x, i) => cmp('answer · ' + x.step, x, b.answers[i]));
for (const t of Object.keys(a.saved)) {
  const xs = a.saved[t], ys = b.saved[t] ?? [];
  const n = Math.max(xs.length, ys.length);
  let shown = 0;
  for (let i = 0; i < n; i++) {
    const before = diffs.length;
    cmp('saved · ' + t + ' #' + i, xs[i], ys[i]);
    if (diffs.length > before) {
      // Only the columns that differ, so a long row stays readable.
      const d = diffs[diffs.length - 1];
      if (d.php && d.worker && typeof d.php === 'object') {
        for (const k of Object.keys({ ...d.php, ...d.worker })) if (JSON.stringify(d.php[k]) === JSON.stringify(d.worker[k])) { delete d.php[k]; delete d.worker[k]; }
      }
      if (++shown > 5) { diffs.pop(); }
    }
  }
}
const sx = a.sent, sy = b.sent;
for (let i = 0; i < Math.max(sx.length, sy.length); i++) cmp('sent #' + i + ' · ' + (sx[i]?.subject ?? sx[i]?.path ?? sy[i]?.subject ?? sy[i]?.path), sx[i], sy[i]);

const total = a.answers.length + Object.values(a.saved).reduce((s, r) => s + r.length, 0) + sx.length;
console.log(`answers ${a.answers.length} · saved rows ${total - a.answers.length - sx.length} · sent ${sx.length}/${sy.length} · differences ${diffs.length}`);
for (const d of diffs.slice(0, show)) {
  console.log('\n## ' + d.where);
  console.log('  php:    ' + JSON.stringify(d.php).slice(0, 900));
  console.log('  worker: ' + JSON.stringify(d.worker).slice(0, 900));
}
process.exitCode = diffs.length ? 1 : 0;
