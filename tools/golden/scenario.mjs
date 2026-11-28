// Write tests: the same checkout steps against the PHP shop and the Worker, then everything they saved and sent.
// Records each answer, every row of the tables checkout touches, and every outside call / email the mock caught.
// Usage: node scenario.mjs <baseUrl> <sqliteFile> <outFile>      (run through write-test.sh)
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const [base, db, outFile] = process.argv.slice(2);
const MOCK = 'http://127.0.0.1:8098';
const jars = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(step) {
  const jar = (jars[step.as ?? 'a'] ??= {});
  const headers = { 'Content-Type': 'application/json', 'User-Agent': step.ua ?? 'Mozilla/5.0 write-test' };
  if ((step.as ?? 'a') === 'adm' && csrf && !step.nocsrf) headers['X-CSRF-Token'] = csrf;
  Object.assign(headers, step.headers ?? {});
  const cookies = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
  if (cookies) headers.Cookie = cookies;
  const r = await fetch(base + (step.pathFn ? step.pathFn() : step.path), { method: step.body === undefined ? 'GET' : 'POST', headers, redirect: 'manual',
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

// Paymob callbacks, signed like Paymob signs them (the test HMAC secret is "mock-hmac").
const one = (sql) => { const t = execFileSync('sqlite3', ['-json', db, sql], { encoding: 'utf8' }).trim(); return t ? JSON.parse(t)[0] : null; };
const refOf = (n) => (one(`SELECT pay_refs FROM orders WHERE id = ${n - 1000}`)?.pay_refs ?? '').trim().split(/\s+/)[0];
const totalOf = (n) => Math.round(one(`SELECT total FROM orders WHERE id = ${n - 1000}`).total * 100);
const v = (x) => (typeof x === 'boolean' ? String(x) : x === undefined || x === null ? '' : String(x));
const hmacOf = (f) => createHmac('sha512', 'mock-hmac').update(f.map(v).join('')).digest('hex');
const txn = (n, id) => ({ id, amount_cents: totalOf(n), created_at: '2026-11-28T10:00:00.000000', currency: 'EGP', error_occured: false, has_parent_transaction: false,
  integration_id: 111, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false,
  order: { id: 777000 + id, merchant_order_id: refOf(n) }, owner: 4242, pending: false, source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' }, success: true, data: { message: 'Approved' } });
const hookHmac = (t) => hmacOf([t.amount_cents, t.created_at, t.currency, t.error_occured, t.has_parent_transaction, t.id, t.integration_id, t.is_3d_secure, t.is_auth, t.is_capture,
  t.is_refunded, t.is_standalone_payment, t.is_voided, t.order.id, t.owner, t.pending, t.source_data.pan, t.source_data.sub_type, t.source_data.type, t.success]);
let hook = null, hookN = 0;
const returnQuery = (n, id) => {
  const t = txn(n, id);
  const q = { amount_cents: t.amount_cents, created_at: t.created_at, currency: 'EGP', error_occured: 'false', has_parent_transaction: 'false', id: String(id), integration_id: '111',
    is_3d_secure: 'true', is_auth: 'false', is_capture: 'false', is_refunded: 'false', is_standalone_payment: 'true', is_voided: 'false', order: String(t.order.id), owner: '4242',
    pending: 'false', source_data_pan: '2346', source_data_sub_type: 'MasterCard', source_data_type: 'card', success: 'true', merchant_order_id: t.order.merchant_order_id };
  q.hmac = hmacOf([q.amount_cents, q.created_at, q.currency, q.error_occured, q.has_parent_transaction, q.id, q.integration_id, q.is_3d_secure, q.is_auth, q.is_capture, q.is_refunded,
    q.is_standalone_payment, q.is_voided, q.order, q.owner, q.pending, q.source_data_pan, q.source_data_sub_type, q.source_data_type, q.success]);
  return new URLSearchParams(q).toString();
};
let qrId = 0, rateIds = [], csrf = '';
const AD = '/api/admin.php?action=';
const adm = (name, action, body, extra = {}) => ({ name: 'admin ' + name, as: 'adm', path: AD + action, ...(body === undefined ? {} : { body }), ...extra });

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
  { name: 'qr create bad link', path: '/api/qr.php?action=create', body: { link: 'https://example.com', name: 'Bad' } },
  { name: 'qr create', path: '/api/qr.php?action=create', body: { link: 'https://g.page/r/CTestTest1234/review', name: 'Cafe Mona', card_lang: 'ar', target: 'page', maps: 'https://maps.google.com/?cid=1', lat: '30.1', lng: 31.2 } },
  { name: 'qr create same link', path: '/api/qr.php?action=create', body: { link: 'https://g.page/r/CTestTest1234/review', name: 'Again' } },
  { name: 'qr update', path: '/api/qr.php?action=update', before: () => { qrId = one("SELECT id FROM qr_businesses ORDER BY id DESC LIMIT 1").id; },
    body: () => ({ id: qrId, name: 'Cafe Mona 2', target: 'review', page: { lang: 'ar', color: '#2C5DA8', tagline: ' Best coffee ', links: [{ type: 'whatsapp', value: '01001234567' },
      { type: 'instagram', value: '@mona.cafe' }, { type: 'website', value: 'mona.example' }, { type: 'email', value: 'bad' }, { type: 'nope', value: 'x' }] } }) },
  { name: 'qr page', path: '/r/', before: () => {}, pathFn: () => '/r/' + one("SELECT slug FROM qr_businesses ORDER BY id DESC LIMIT 1").slug },
  { name: 'qr buy', path: '/api/qr.php?action=buy', body: { pack: 'starter', method: 'paymob_wallet' } },
  { name: 'qr buy bad pack', path: '/api/qr.php?action=buy', body: { pack: 'nope' } },
  { name: 'logout', path: P + 'account_logout', body: {} },
  { name: 'account after logout', path: P + 'account' },
  { name: 'review signed out', path: P + 'review_save', body: { product: 'nfc3', rating: 5 } },
  // Online payment (Paymob, mocked).
  { name: 'order online', path: P + 'order', body: { ...cust, name: 'Online Payer', email: 'online.test@example.test', phone: '01005550001', payment: 'paymob_card', items: [{ id: 'nfc4', qty: 1 }] } },
  { name: 'pay retry wrong contact', path: P + 'pay', body: { number: 'WTS-1072', contact: 'x@example.test' } },
  { name: 'pay retry', path: P + 'pay', body: { number: 'WTS-1072', contact: '01005550001', method: 'paymob_wallet' } },
  { name: 'webhook not post', path: '/api/paymob-webhook.php' },
  { name: 'webhook ignored', path: '/api/paymob-webhook.php?hmac=x', body: { type: 'TOKEN', obj: {} } },
  { name: 'webhook bad hmac', path: '/api/paymob-webhook.php?hmac=bad', body: () => ({ type: 'TRANSACTION', obj: txn(1072, 9001) }) },
  { name: 'webhook paid', before: () => { hook = txn(1072, 9002); }, path: '/api/paymob-webhook.php', pathFn: () => '/api/paymob-webhook.php?hmac=' + hookHmac(hook), body: () => ({ type: 'TRANSACTION', obj: hook }) },
  { name: 'webhook again', path: '/api/paymob-webhook.php', pathFn: () => '/api/paymob-webhook.php?hmac=' + hookHmac(hook), body: () => ({ type: 'TRANSACTION', obj: hook }) },
  { name: 'return paid', path: '/api/paymob-return.php', pathFn: () => '/api/paymob-return.php?' + returnQuery(1072, 9002) },
  { name: 'return bad', path: '/api/paymob-return.php?merchant_order_id=WTS-1072-abcdef&success=true&hmac=nope' },
  { name: 'pay already confirmed', path: P + 'pay_cod', body: { number: 'WTS-1072', contact: 'online.test@example.test' } },
  { name: 'order online 2', path: P + 'order', body: { ...cust, name: 'Cash Later', email: 'later.test@example.test', phone: '01005550002', payment: 'paymob_wallet', items: [{ id: 'nfc5', qty: 2 }] } },
  { name: 'switch to cash', path: P + 'pay_cod', body: { number: 'WTS-1073', contact: 'later.test@example.test' } },
  { name: 'pay link bad', path: '/api/pay.php?o=72&k=nope' },
  // The review link sent after delivery.
  { name: 'rate bad token', path: '/rate/000000000000000000000000' },
  { name: 'rate page', path: '/rate/bc15a8b7f7d82295299f31bb' },
  { name: 'rate page en', path: '/rate/bc15a8b7f7d82295299f31bb?lang=en' },
  { name: 'rate save nothing', path: P + 'review_token_save', body: { t: 'bc15a8b7f7d82295299f31bb', reviews: [] } },
  { name: 'rate save bad token', path: P + 'review_token_save', body: { t: 'nope', reviews: [{ product_id: 'x', rating: 5 }] } },
  { name: 'rate save', path: P + 'review_token_save', before: () => { const o = one('SELECT items FROM orders WHERE id = 2'); rateIds = JSON.parse(o.items).map((i) => i.id); },
    body: () => ({ t: 'bc15a8b7f7d82295299f31bb', name: 'Happy Buyer', reviews: rateIds.map((id, i) => ({ product_id: id, rating: 5 - i, text: i ? '' : 'Lovely quality' })).concat([{ product_id: 'not-in-order', rating: 5 }]) }) },
  { name: 'rate page after', path: '/rate/bc15a8b7f7d82295299f31bb?lang=en' },
  // ---- the team dashboard ----
  adm('session signed out', 'session'),
  adm('dashboard signed out', 'dashboard'),
  adm('login wrong', 'login', { email: 'golden@example.test', password: 'nope' }),
  adm('login', 'login', { email: 'golden@example.test', password: 'golden-local' }),
  adm('session', 'session', undefined, { after: (r) => { csrf = r.body?.csrf ?? ''; } }),
  adm('no csrf', 'targets_save', { month: '2026-11', targets: [] }, { nocsrf: true }),
  adm('targets save', 'targets_save', { month: '2026-11', targets: [{ user_id: 2, orders: 20, revenue: 15000 }, { user_id: 3, orders: '7', revenue: '4000.5' }] }),
  adm('targets', 'targets&month=2026-11'),
  adm('commission rate', 'commission_rate', { month: '2026-11', user_id: 2, pct: 5, salary: 3000 }),
  adm('commission bad user', 'commission_rate', { month: '2026-11', user_id: 99, pct: 5 }),
  adm('supplier save', 'supplier_save', { name: 'Print House', phone: '0100', makes: 'Stands', notes: 'Fast' }),
  adm('expense bad', 'expense_save', { amount: 0, category: 'Ads' }),
  adm('expense supplier bill', 'expense_save', { amount: 1200, category: 'Supplier / production', supplier_id: 3, paid_now: 500, on: '2026-11-20', note: 'Stands batch', order: 'WTS-1066' }),
  adm('expense ads', 'expense_save', { amount: 350.5, category: 'Ads', on: '2026-11-27' }),
  adm('supplier pay', 'supplier_pay', { supplier_id: 3, amount: 200, note: 'Cash' }),
  adm('expenses', 'expenses&month=2026-11'),
  adm('expense delete', 'expense_delete', { id: 5 }),
  adm('order create team', 'order_create', { name: 'Team Buyer', email: '', phone: '01112223334', address: '5 Team Street, Maadi', city: 'Cairo', city_id: 'FceDyHXwpSYYF9zGW', district_id: 'i8XARRIMA8ypnLPDIY5Wz',
    items: [{ id: 'nfc1', qty: 3, note: 'Gold print' }, { custom: 1, name: '30 mixed stands', price: 233.33, qty: 30, ship: 1 }], source: 'WhatsApp', payment: 'cod', status: 'Confirmed', discount: 100, shipping: '', paid_now: 500, deposit_method: 'wallet', notes: 'Call first', prep_notes: 'Fragile', business_name: 'Team Co' }),
  adm('order create bad', 'order_create', { name: 'X', phone: '', items: [{ id: 'nfc1', qty: 1 }] }),
  adm('order catalog', 'order_catalog'),
  adm('customer lookup', 'customer_lookup&q=0111222'),
  adm('order update shipped', 'order_update', { id: 74, status: 'Shipped', notes: 'Out today' }),
  adm('order update delivered', 'order_update', { id: 74, status: 'Delivered', prep_notes: 'Done', business_name: 'Team Co 2', review_link: '', links: '', design_notes: 'ok' }),
  adm('payment add', 'payment_add', { order_id: 74, amount: 100, method: 'bank', note: 'Transfer' }),
  adm('payment refund', 'payment_add', { order_id: 74, amount: -50, method: 'cash', note: 'Refund' }),
  adm('order payments', 'order_payments&id=74'),
  adm('payment delete', 'payment_delete', { id: 46 }),
  adm('order doc', 'order_doc&id=74'),
  adm('orders list', 'orders'),
  adm('orders due', 'orders&due=1'),
  adm('orders search', 'orders&q=Team'),
  adm('orders csv', 'orders&format=csv&q=Team'),
  adm('bosta info', 'bosta_info'),
  adm('bosta create', 'bosta_create', { id: 66, size: 'MEDIUM', notes: 'Call before', building: '4', floor: '2', prep_notes: 'Wrap well' }),
  adm('bosta create again', 'bosta_create', { id: 66 }),
  adm('bosta refresh', 'bosta_refresh', { id: 66 }),
  { name: 'bosta webhook bad', path: '/api/bosta-webhook.php', body: { trackingNumber: 'TRK1001', state: 41 } },
  { name: 'bosta webhook', path: '/api/bosta-webhook.php', headers: { Authorization: 'Bearer mock-bosta-secret' }, body: () => ({ trackingNumber: one('SELECT tracking_number FROM orders WHERE id = 66').tracking_number, state: 45, numberOfAttempts: 1 }) },
  adm('bosta cancel', 'bosta_cancel', { id: 66 }),
  adm('products', 'products'),
  adm('product save new', 'product_save', { name: 'Test Mug', cat: 'stands', price: 0, cost: 40, status: 'Active', sub: 'Ceramic', desc: 'A mug', features: ['Dishwasher safe', ''],
    variants: [{ id: 'small', label: 'Small', stock: 5, price: 120, tiers: [{ min: 10, price: 100 }] }, { label: 'Large', stock: 3, ratio: 1.5 }], addons: [{ group: 'Print', options: [{ id: 'std', label: 'Standard', price: 0 }, { id: 'gold', label: 'Gold', price: 30, per: 'unit' }] }] }),
  adm('product save bad', 'product_save', { name: 'No cat', cat: 'nope', price: 10 }),
  adm('product update', 'product_save', { id: 'nfc5', name: 'Display Stand NFC + QR Code — 10×15cm', cat: 'nfc', price: 310, stock: 20, status: 'Active', discountPct: 5, seoTitle: 'Custom title' }),
  adm('category save', 'category_save', { label: 'Mugs & Cups', descr: 'All mugs', sort: 7, label_ar: 'أكواب' }),
  adm('category delete used', 'category_delete', { key: 'nfc' }),
  adm('category delete', 'category_delete', { key: 'mugs-cups' }),
  adm('leads', 'leads'),
  adm('lead save new', 'lead_save', { name: 'Admin Lead', contact: '01223334445', cat: 'nfc', status: 'Contacted', follow_up: '2026-11-30', assigned_to: 2, notes: 'Called once' }),
  adm('lead save dupe', 'lead_save', { name: 'Again', contact: '+20 122 333 4445' }),
  adm('lead update contact', 'lead_save', { id: 322, status: 'Quoted', notes: 'Updated', name: 'Lead Person Renamed', contact: '01009998888 · lead.new@example.test', cat: 'stands' }),
  adm('lead move', 'lead_move', { id: 322, status: 'Won' }),
  adm('lead move clear', 'lead_move', { id: 322, follow_up: '' }),
  adm('quote save', 'quote_save', { name: 'Quote Customer', phone: '01001112223', email: 'quote@example.test', items: [{ id: 'nfc-qr-stand', variant: 's12', qty: 4, note: 'Logo' }, { custom: 1, name: 'Design work', price: 500, qty: 1, ship: 0 }],
    discount: 50, valid_until: '2026-12-15', terms: 'Half upfront', lead_id: 0 }),
  adm('quote update', 'quote_save', { id: 12, name: 'Quote Customer', phone: '01001112223', email: 'quote@example.test', items: [{ id: 'nfc-qr-stand', variant: 's12', qty: 5 }], shipping: 0, valid_until: '2026-12-20' }),
  adm('quote status', 'quote_status', { id: 12, status: 'Sent' }),
  adm('quote text', 'quote_text', { id: 12, terms: 'Full upfront', notes: 'Blue' }),
  adm('quotes', 'quotes'),
  adm('order from quote', 'order_create', { name: 'Quote Customer', email: 'quote@example.test', phone: '01001112223', address: '9 Quote Road, Giza', items: [{ id: 'nfc-qr-stand', variant: 's12', qty: 5 }], quote_id: 12, source: 'Phone', business_name: 'QC' }),
  adm('quote delete accepted', 'quote_delete', { id: 12 }),
  adm('quote delete', 'quote_delete', { id: 11 }),
  adm('promo save', 'promo_save', { code: 'Winter25', kind: 'percent', value: 25, min_order: 500, max_uses: 10, starts_at: '2026-11-01', expires_at: '2026-12-31', active: 1, note: 'Winter' }),
  adm('promo dupe', 'promo_save', { code: 'winter25', kind: 'fixed', value: 50, active: 1 }),
  adm('promo delete used', 'promo_delete', { id: 1 }),
  adm('promos', 'promos'),
  adm('brand save new', 'brand_save', { name: 'Nile Crafts', nameAr: 'حرف النيل', commission: 15, margin: 20, active: 1, link: 'nilecrafts.example', orderEmails: 'orders@nilecrafts.example, x@nilecrafts.example', orderWhatsapp: '+20 100 000 0000' }),
  adm('brand save bad b2b', 'brand_save', { name: 'Bad', commissionB2b: 5 }),
  adm('brand update margin', 'brand_save', { id: 1, name: 'Bonds Coffee Roasters', commission: 10, margin: 30, active: 1 }),
  adm('brands', 'brands&month=2026-11'),
  adm('brand statement', 'brand_statement&id=1&month=2026-11'),
  adm('brand payout', 'brand_payout', { brand_id: 1, amount: 750.25, on: '2026-11-25', note: 'Nov part' }),
  adm('brand delete with products', 'brand_delete', { id: 1 }),
  adm('seller requests', 'seller_requests'),
  adm('seller status', 'seller_status', { id: 1, status: 'Contacted', note: 'Called' }),
  adm('seller approve', 'seller_approve', { id: 1, commission: 12, cat: 'gift', brand: 'Ostora sneakers' }),
  adm('reviews list', 'reviews_list'),
  adm('review hide', 'review_set', { id: 1, hidden: 1 }),
  adm('search', 'search&q=Team'),
  adm('customers', 'customers', undefined, { after: (r) => { r.body?.customers?.sort((x, y) => String(x.key).localeCompare(String(y.key))); } }),
  adm('customer', 'customer&key=112223334'),
  adm('team save new', 'team_save', { name: 'New Seller', email: 'seller.test@example.test', password: 'longpassword', role: 'sales', ref_code: 'ns-1', active: 1, notify: 0 }),
  adm('team save self demote', 'team_save', { id: 5, name: 'Golden Recorder', email: 'golden@example.test', role: 'sales', active: 1 }),
  adm('team security', 'team_security', { ask_location: 1 }),
  adm('login location', 'login_location', { lat: 30.0444, lng: 31.2357, acc: 12.6 }),
  adm('team', 'team'),
  adm('team hours', 'team_hours&days=14'),
  adm('device hints', 'device_hints', { model: 'SM-A546E', platform: 'Android', platformVersion: '14.0.0', screen: '412x915' }),
  adm('password wrong', 'password', { current: 'x', new: 'newpassword1' }),
  adm('password', 'password', { current: 'golden-local', new: 'golden-local-2' }),
  adm('ops errors', 'ops_errors'),
  adm('meta status', 'meta_status'),
  adm('reports', 'reports'),
  adm('report month', 'report_month&month=2026-11'),
  adm('dashboard', 'dashboard&period=month'),
  adm('commissions', 'commissions&month=2026-11'),
  adm('order delete', 'order_delete', { ids: [73] }),
  adm('activity', 'activity'),
  adm('logout', 'logout', {}),
  adm('dashboard after logout', 'dashboard'),
  { name: 'unknown action', path: P + 'nothing', body: {} },
  { name: 'get on post action', path: P + 'order' },
];

const out = [];
for (const s of steps) {
  if (s.before) await s.before();
  const r = await call(s);
  if (s.after) s.after(r);
  out.push(r);
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
  stock: 'SELECT id, stock, variants FROM products ORDER BY id',
  products: 'SELECT id, sku, name, cat, price, cost, stock, discount_pct, status, sub, descr, features, variants, tiers, addons, personalized, brand_id, brand_price, margin_pct, seo_title, sort FROM products ORDER BY id',
  categories: 'SELECT * FROM categories ORDER BY key', brands: 'SELECT * FROM brands ORDER BY id', brand_payouts: 'SELECT brand_id, amount, paid_on, note, created_by FROM brand_payouts ORDER BY id',
  targets: 'SELECT * FROM targets ORDER BY user_id, month', expenses: 'SELECT * FROM expenses ORDER BY id', suppliers: 'SELECT * FROM suppliers ORDER BY id',
  supplier_payments: 'SELECT * FROM supplier_payments ORDER BY id', quotes: 'SELECT * FROM quotes ORDER BY id', promos: 'SELECT * FROM promos ORDER BY id',
  sellers: 'SELECT * FROM seller_requests ORDER BY id', product_images: 'SELECT * FROM product_images ORDER BY id',
  users: 'SELECT id, name, email, phone, role, ref_code, active, notify, length(password_hash) AS pw FROM users ORDER BY id',
  user_devices: 'SELECT user_id, ua, model, platform, platform_version, screen, label, logins, revoked FROM user_devices ORDER BY id',
  user_logins: 'SELECT user_id, ip, city, isp, new_device, lat, lng, acc, loc_status FROM user_logins ORDER BY id',
  user_days: 'SELECT user_id, day FROM user_days ORDER BY user_id, day', kv: "SELECT key, value FROM kv WHERE key LIKE 'team.%' ORDER BY key",
  month_reports: 'SELECT month FROM month_reports ORDER BY month', ops_errors: 'SELECT area, message, count FROM ops_errors ORDER BY id',
  reviews: 'SELECT * FROM product_reviews ORDER BY id', qr: 'SELECT id, customer_id, name, review_link, cid, place_id, maps, lat, lng, target, card_lang, page, views FROM qr_businesses ORDER BY id',
  qr_ledger: 'SELECT customer_id, delta, reason, business_id, order_id FROM qr_ledger ORDER BY id',
};
const saved = Object.fromEntries(Object.entries(tables).map(([k, sql]) => [k, q(sql)]));
const sent = (await mockLog()).sort((a, b) => JSON.stringify([a.kind, a.to ?? a.path, a.subject ?? '']).localeCompare(JSON.stringify([b.kind, b.to ?? b.path, b.subject ?? ''])));
writeFileSync(outFile, JSON.stringify({ answers: out, saved, sent }, null, 1));
console.log('steps', out.length, '· outside calls/emails', sent.length, '→', outFile);
