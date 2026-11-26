// Records the PHP shop's answers ("golden snapshots") for every read: pages, public API reads and admin reads.
// The Cloudflare version must give the same answers (see compare.mjs). Run through record.sh.
// Usage: node record.mjs <baseUrl> <dbFile> <outDir>
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [base, db, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const q = (sql) => execFileSync('sqlite3', ['-json', db, sql], { encoding: 'utf8' }).trim();
const rows = (sql) => { const t = q(sql); return t ? JSON.parse(t) : []; };
const col = (sql, k) => rows(sql).map((r) => r[k]).filter((v) => v !== null && v !== '');

// ---- what to request -------------------------------------------------------------------------------
const pages = ['/', '/?lang=ar', '/index.html', '/about.html', '/about.html?lang=ar', '/contact.html', '/contact.html?lang=ar',
  '/sell.html', '/sell.html?lang=ar', '/plans.html', '/plans.html?lang=ar', '/privacy-policy.html', '/privacy-policy.html?lang=ar',
  '/refund-policy.html', '/refund-policy.html?lang=ar', '/shipping-policy.html', '/shipping-policy.html?lang=ar', '/terms.html',
  '/terms.html?lang=ar', '/google-review-link.html', '/google-review-link.html?lang=ar', '/robots.txt', '/sitemap.xml', '/llms.txt',
  '/manifest.json', '/admin/', '/p/', '/c/', '/r/', '/b/', '/rate/', '/p/does-not-exist', '/c/does-not-exist', '/r/does-not-exist'];
for (const id of col('SELECT id FROM products', 'id')) pages.push(`/p/${id}`, `/p/${id}?lang=ar`);
for (const s of col('SELECT key FROM categories', 'key')) pages.push(`/c/${s}`, `/c/${s}?lang=ar`);
for (const s of col('SELECT slug FROM brands', 'slug')) pages.push(`/b/${s}`, `/b/${s}?lang=ar`);
for (const s of col('SELECT slug FROM qr_businesses', 'slug')) pages.push(`/r/${s}`);
pages.push('/api/seo.php', '/api/track.php');

const publicReads = ['catalog', 'areas', 'reviews', 'account'].map((a) => `/api/public.php?action=${a}`);
publicReads.push('/api/public.php?action=area_search&q=maadi', '/api/public.php?action=area_suggest&q=nasr',
  '/api/qr.php?action=me');

// Admin reads: every action whose name doesn't say it writes. Ids come from the data so detail views are covered.
const WRITE = /(save|delete|create|update|upload|send|add|pay|move|set|status|approve|logo|link|unlink|test|register|subscribe|signout|close|assign|react|submit|away|now|cancel|refresh|sync|setup|login|logout|password|lead$|apply|order$|location|try|rate$|security)/;
import { readFileSync } from 'node:fs';
const adminSrc = readFileSync(new URL('../../api/admin.php', import.meta.url), 'utf8');
const adminActions = [...adminSrc.matchAll(/\n\s*case '([a-z0-9_]+)':/g)].map((m) => m[1]).filter((a) => !WRITE.test(a) || ['session', 'dashboard', 'orders'].includes(a));
const one = (sql, k) => col(sql, k)[0];
const ids = { order: one('SELECT id FROM orders ORDER BY id DESC LIMIT 1', 'id'), customer: one('SELECT phone FROM customers WHERE phone <> "" LIMIT 1', 'phone'),
  brand: one('SELECT id FROM brands LIMIT 1', 'id'), quote: one('SELECT id FROM quotes ORDER BY id DESC LIMIT 1', 'id'),
  chat: one('SELECT id FROM wa_chats ORDER BY id DESC LIMIT 1', 'id'), user: one("SELECT id FROM users WHERE email <> 'golden@example.test' LIMIT 1", 'id') };
const month = new Date().toISOString().slice(0, 7);
const extra = { order_payments: `&id=${ids.order}`, order_doc: `&id=${ids.order}`, customer: `&phone=${encodeURIComponent(ids.customer ?? '')}`,
  brand_statement: `&id=${ids.brand}`, quote_doc: `&id=${ids.quote}`, quote_text: `&id=${ids.quote}`, wa_chat: `&id=${ids.chat}`, wa_media: `&id=${ids.chat}`,
  person_activity: `&id=${ids.user}`, report_month: `&month=${month}`, search: '&q=nfc', customer_lookup: `&phone=${encodeURIComponent(ids.customer ?? '')}` };
const adminReads = adminActions.map((a) => `/api/admin.php?action=${a}${extra[a] ?? ''}`);

// ---- normalising: remove what changes on every request ------------------------------------------------
function normalise(text) {
  return text
    .replace(/https?:\/\/(localhost:\d+|127\.0\.0\.1:\d+|shop\.wheretospot\.com|shop\.wheretospot\.workers\.dev)/g, '<site>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g, '<datetime>')
    .replace(/"csrf"\s*:\s*"[a-f0-9]+"/g, '"csrf":"<csrf>"')
    .replace(/\b1[6-9]\d{8}(\.\d+)?\b/g, '<unixtime>')
    .replace(/nonce="[^"]+"/g, 'nonce="<nonce>"')
    .replace(/[?&]v=[0-9a-f]{6,}/g, '?v=<ver>');
}

// ---- recording -----------------------------------------------------------------------------------------
let cookie = '';
async function get(path) {
  const r = await fetch(base + path, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  const type = r.headers.get('content-type') ?? '';
  const buf = Buffer.from(await r.arrayBuffer());
  const textual = /text|json|xml|javascript/.test(type) || buf.length === 0;
  const loc = r.headers.get('location');
  return { status: r.status, type: type.split(';')[0], location: loc ? normalise(loc) : undefined,
    body: textual ? normalise(buf.toString('utf8')) : undefined, sha256: textual ? undefined : createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
}
async function login() {
  let r = await fetch(base + '/api/admin.php?action=session');
  cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  r = await fetch(base + '/api/admin.php?action=login', { method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'golden@example.test', password: 'golden-local' }) });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  if (!r.ok) throw new Error('login failed: ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

const file = (p) => p.replace(/^\//, '').replace(/[^A-Za-z0-9._=-]+/g, '_').slice(0, 150) || 'root';
const index = [];
async function record(group, list) {
  for (const p of list) {
    const res = await get(p);
    const name = `${group}__${file(p)}.json`;
    writeFileSync(`${out}/${name}`, JSON.stringify({ path: p, ...res }, null, 1));
    index.push({ group, path: p, status: res.status, file: name });
  }
}
await record('page', pages);
await record('public', publicReads);
try { await login(); } catch (e) { console.log('admin sign-in failed:', e.message, '(admin reads recorded signed out)'); }
await record('admin', adminReads);
writeFileSync(`${out}/_index.json`, JSON.stringify(index, null, 1));
const by = index.reduce((m, x) => ((m[x.group] = (m[x.group] ?? 0) + 1), m), {});
const bad = index.filter((x) => x.status >= 500);
console.log('recorded', index.length, by, '| 5xx:', bad.length, bad.slice(0, 10).map((x) => x.path));
