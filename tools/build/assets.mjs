// Copies the shop's public files into dist/, the folder Cloudflare serves as static assets.
// Everything listed in .assetsignore stays out (server code, data, notes, tooling). Files are hard-linked, so
// this is instant and takes no space. Run before `wrangler dev` / `wrangler deploy` (npm run build).
import { readFileSync, readdirSync, mkdirSync, linkSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const out = join(root, 'dist');
const rules = readFileSync(join(root, '.assetsignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
// The patterns used here: a name or path from the root, "*.ext", and "**/name" (anywhere).
const toRe = (p) => new RegExp('^' + (p.startsWith('**/') ? '(.*/)?' + p.slice(3) : p).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '(/.*)?$');
const ignore = rules.map((p) => (p.includes('/') || p.startsWith('*') ? toRe(p) : new RegExp('^(.*/)?' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&') + '(/.*)?$')));
const skip = (rel) => rel === 'dist' || ignore.some((re) => re.test(rel));

rmSync(out, { recursive: true, force: true });
let n = 0;
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name), rel = relative(root, abs);
    if (skip(rel)) continue;
    if (e.isDirectory()) { walk(abs); continue; }
    if (!e.isFile()) continue;
    const dest = join(out, rel);
    mkdirSync(join(dest, '..'), { recursive: true });
    try { linkSync(abs, dest); } catch { copyFileSync(abs, dest); }
    n++;
  }
})(root);
console.log('dist/:', n, 'files');
