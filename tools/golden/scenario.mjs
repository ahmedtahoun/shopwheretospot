// Write tests: the same checkout steps against the PHP shop and the Worker, then everything they saved and sent.
// Records each answer, every row of the tables checkout touches, and every outside call / email the mock caught.
// Usage: node scenario.mjs <baseUrl> <sqliteFile> <outFile>      (run through write-test.sh)
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [base, db, outFile] = process.argv.slice(2);
const MOCK = 'http://127.0.0.1:8098';
const jars = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(step) {
  const jar = (jars[step.as ?? 'a'] ??= {});
  const headers = { 'Content-Type': 'application/json', 'User-Agent': step.ua ?? 'Mozilla/5.0 write-test' };
  const cookies = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
  if (cookies) headers.Cookie = cookies;
  const r = await fetch(base + step.path, { method: step.body === undefined ? 'GET' : 'POST', headers, redirect: 'manual',
    body: step.body === undefined ? undefined : JSON.stringify(typeof step.body === 'function' ? step.body() : step.body) });
  for (const c of r.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(';'); const [k, ...v] = kv.split('=');
    const exp = c.match(/expires=([^;]+)/i);
    if (v.join('=') === '' || v.join('=') === 'deleted' || (exp && Date.parse(exp[1]) < Date.now()) || /Max-Age=0\b/i.test(c)) delete jar[k.trim()];
    else jar[k.trim()] = v.join('=');
  }
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { step: step.name, status: r.status, type: (r.headers.get('content-type') ?? '').split(';')[0], location: r.headers.get('location') ?? undefined, body };
}

const mockLog = async () => (await fetch(MOCK + '/__log')).json();
let lastCode = '';
const codeFromMail = async (email) => {
  await sleep(400);
  const mails = (await mockLog()).filter((m) => m.kind === 'mail' && m.to.includes(email));
  lastCode = (mails.at(-1)?.subject.match(/\d{6}/) ?? [''])[0];
  return lastCode;
};

// ---- the steps ------------------------------------------------------------------------------------------
const P = '/api/public.php?action=';
const cust = { name: 'Mona Write Test', email: 'mona.test@example.test', phone: '01001234567', address: '12 Test Street, Floor 3', city: 'Cairo' };
const steps = [
  { name: 'promo bad', path: P + 'promo', body: { code: 'NOPE', subtotal: 500 } },
  { name: 'promo lower case', path: P + 'promo', body: { code: 'welcome10', subtotal: 500 } },
  { name: 'promo percent', path: P + 'promo', body: { code: 'WELCOME10', subtotal: 500 } },
  { name: 'promo shipping', path: P + 'promo', body: { code: 'TEST', subtotal: 100 } },
  { name: 'draft no phone', path: P + 'checkout_draft', body: { token: 'a'.repeat(32), phone: '12', items: [{ id: 'nfc1', qty: 1 }] } },
  { name: 'draft', path: P + 'checkout_draft', body: { token: 'b'.repeat(32), name: cust.name, phone: cust.phone, email: cust.email, lang: 'ar', total: 200,
    items: [{ id: 'nfc1', variant: null, addons: [], qty: 2, name: 'Google Review NFC Card — Black', price: 180 }] } },
  { name: 'draft cart', path: P + 'draft_cart&t=' + 'b'.repeat(32) },
  { name: 'order empty cart', path: P + 'order', body: { ...cust, items: [] } },
  { name: 'order bad email', path: P + 'order', body: { ...cust, email: 'nope', items: [{ id: 'nfc1', qty: 1 }] } },
  { name: 'order no name', path: P + 'order', body: { ...cust, name: ' ', items: [{ id: 'nfc1', qty: 1 }] } },
  { name: 'order no address', path: P + 'order', body: { ...cust, address: 'x', items: [{ id: 'nfc1', qty: 1 }] } },
  { name: 'order unknown product', path: P + 'order', body: { ...cust, items: [{ id: 'no-such', qty: 1 }] } },
  { name: 'order too many', path: P + 'order', body: { ...cust, items: [{ id: 'bonds-chrome', variant: 'g250', qty: 6 }] } },
  { name: 'order needs variant', path: P + 'order', body: { ...cust, items: [{ id: 'nfc-qr-stand', qty: 1 }] } },
  { name: 'order personalised no business', path: P + 'order', body: { ...cust, items: [{ id: 'nfc-qr-stand', variant: 's10', qty: 1 }] } },
  { name: 'order bad promo', path: P + 'order', body: { ...cust, promo: 'NOPE', items: [{ id: 'nfc1', qty: 1 }] } },
  { name: 'order bad referral', path: P + 'order', body: { ...cust, ref: 'ZZZ', items: [{ id: 'nfc1', qty: 1 }] } },
  { name: 'order cod', path: P + 'order', body: { ...cust, draft_token: 'b'.repeat(32), lang: 'ar', items: [{ id: 'nfc1', variant: null, addons: [], qty: 2 }],
    city_id: 'FceDyHXwpSYYF9zGW', district_id: 'i8XARRIMA8ypnLPDIY5Wz' } },
  { name: 'order cod tiers + promo', path: P + 'order', body: { ...cust, lang: 'en', promo: 'WELCOME10', business_name: 'Café Test', review_link: 'https://g.page/r/test/review',
    design_notes: 'Blue please', items: [{ id: 'nfc-qr-stand', variant: 's10', qty: 3 }, { id: 'bonds-chrome', variant: 'kg1', qty: 1 }, { id: 'nfc2', qty: 1 }] } },
  { name: 'order free delivery code', path: P + 'order', body: { ...cust, name: 'Karim Second', email: 'karim.test@example.test', phone: '+20 111 222 3333', promo: 'TEST',
    items: [{ id: 'acr-qr-coaster', variant: 'c5', qty: 12 }], business_name: 'Karim Co' } },
  { name: 'order services only', path: P + 'order', body: { ...cust, address: '', items: [{ id: 'plan1', qty: 1 }] } },
  { name: 'track wrong', path: P + 'track', body: { email: 'nobody@example.test', number: 'WTS-1001' } },
  { name: 'track by email', path: P + 'track', body: { email: cust.email } },
  { name: 'pay_cod not found', path: P + 'pay_cod', body: { number: 'WTS-99999', contact: cust.email } },
  { name: 'pay not online', path: P + 'pay', body: { number: 'WTS-1001', contact: 'x@example.test' } },
  { name: 'lead missing', path: P + 'lead', body: { name: '', contact: '' } },
  { name: 'lead new', path: P + 'lead', body: { name: 'Lead Person', contact: '01009998887', cat: 'nfc', source: 'Website', notes: 'Wants 50 cards' } },
  { name: 'lead again', path: P + 'lead', body: { name: 'Lead Person', contact: 'lead.person@example.test', cat: 'stands', source: 'Chat' } },
  { name: 'lead same phone', path: P + 'lead', body: { name: 'Lead P', contact: '+201009998887', source: 'Website' } },
  // Accounts (sign in with the emailed code).
  { name: 'account signed out', path: P + 'account' },
  { name: 'code bad email', path: P + 'account_code', body: { email: 'nope' } },
  { name: 'code', path: P + 'account_code', body: { email: 'Mona.Test@example.test', lang: 'ar' } },
  { name: 'code again too soon', path: P + 'account_code', body: { email: 'mona.test@example.test', lang: 'ar' } },
  { name: 'verify wrong', path: P + 'account_verify', body: { email: 'mona.test@example.test', code: '000000' } },
  { name: 'verify', path: P + 'account_verify', body: () => ({ email: 'mona.test@example.test', code: lastCode }), before: () => codeFromMail('mona.test@example.test') },
  { name: 'account signed in', path: P + 'account' },
  { name: 'account save', path: P + 'account_save', body: { name: 'Mona W. Test', contact: 'whatsapp', lang: 'en', offers: true } },
  { name: 'order signed in', path: P + 'order', body: { ...cust, name: 'Mona W. Test', lang: 'en', items: [{ id: 'nfc3', qty: 1 }], zone_id: 'z1', area_title: 'Area', area_sub: 'Sub' } },
  { name: 'account after order', path: P + 'account' },
  { name: 'review not bought', path: P + 'review_save', body: { product: 'nfc3', rating: 5, text: 'Great' } },
  { name: 'reviews me', path: P + 'reviews&product=nfc3' },
  { name: 'qr me signed in', path: '/api/qr.php?action=me' },
  { name: 'logout', path: P + 'account_logout', body: {} },
  { name: 'account after logout', path: P + 'account' },
  { name: 'review signed out', path: P + 'review_save', body: { product: 'nfc3', rating: 5 } },
  { name: 'unknown action', path: P + 'nothing', body: {} },
  { name: 'get on post action', path: P + 'order' },
];

const out = [];
for (const s of steps) {
  if (s.before) await s.before();
  out.push(await call(s));
}
await sleep(1500); // the Worker sends emails and outside calls after answering

// ---- what was saved ----------------------------------------------------------------------------------------
const q = (sql) => { const t = execFileSync('sqlite3', ['-json', db, sql], { encoding: 'utf8' }).trim(); return t ? JSON.parse(t) : []; };
const tables = {
  orders: 'SELECT * FROM orders ORDER BY id', payments: 'SELECT * FROM payments ORDER BY id', leads: 'SELECT * FROM leads ORDER BY id',
  activity: 'SELECT user_id, user_name, action, detail FROM activity ORDER BY id DESC LIMIT 40',
  attempts: 'SELECT substr(ip, 1, instr(ip, \':\') - 1) AS bucket, count(*) AS n FROM login_attempts GROUP BY bucket ORDER BY bucket',
  drafts: 'SELECT * FROM checkout_drafts ORDER BY id', customers: 'SELECT * FROM customers ORDER BY id',
  sessions: 'SELECT customer_id, count(*) AS n FROM customer_sessions GROUP BY customer_id ORDER BY customer_id',
  codes: 'SELECT email, tries, sends FROM customer_codes ORDER BY email',
  stock: 'SELECT id, stock, variants FROM products ORDER BY id', ops_errors: 'SELECT area, message, count FROM ops_errors ORDER BY id',
  reviews: 'SELECT * FROM product_reviews ORDER BY id', qr_ledger: 'SELECT customer_id, delta, reason, business_id FROM qr_ledger ORDER BY id',
};
const saved = Object.fromEntries(Object.entries(tables).map(([k, sql]) => [k, q(sql)]));
const sent = (await mockLog()).sort((a, b) => JSON.stringify([a.kind, a.to ?? a.path, a.subject ?? '']).localeCompare(JSON.stringify([b.kind, b.to ?? b.path, b.subject ?? ''])));
writeFileSync(outFile, JSON.stringify({ answers: out, saved, sent }, null, 1));
console.log('steps', out.length, '· outside calls/emails', sent.length, '→', outFile);
