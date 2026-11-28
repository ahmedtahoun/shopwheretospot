// Customer accounts (port of api/customers.php) and product reviews (api/reviews.php).
// Sign-in is a 6-digit code by email; the code signs the device in with a random token in the wts_cust cookie.
import { mbSubstr, mbLen, round, phpTrim, phpInt, phpStr, validEmail, randomHex, sha256Hex } from './php';
import { type Row } from './catalog';
import { ShopError, type Shop, tooManyAttempts, recordAttempt, nowUnix, orderPaid, orderNumber, strIn, logActivity } from './shop';
import { sendMailLater, emailShell } from './mail';

export const CUSTOMER_COOKIE = 'wts_cust';
const CUSTOMER_DAYS = 180;
export const UNPAID_EXPIRED_NOTE = 'Online payment not completed — released automatically.';

export const BOSTA_STATES: Record<number, string> = {
  10: 'Pickup requested', 11: 'Waiting for route', 20: 'Route assigned', 21: 'Picked up from business',
  22: 'Picking up from consignee', 23: 'Picked up from consignee', 24: 'Received at warehouse', 25: 'Fulfilled',
  30: 'In transit between hubs', 40: 'Picking up', 41: 'Out for delivery', 45: 'Delivered',
  46: 'Returned to business', 47: 'Exception', 48: 'Terminated', 49: 'Canceled', 60: 'Returned to stock',
  100: 'Lost', 101: 'Damaged', 102: 'Investigation', 103: 'Awaiting your action', 104: 'Archived', 105: 'On hold',
};
export const bostaStateLabel = (code: number | null): string => (code === null ? '' : BOSTA_STATES[code] ?? 'State ' + code);

export const readCookie = (request: Request, name: string): string => {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) { try { return decodeURIComponent(v.join('=')); } catch { return v.join('='); } }
  }
  return '';
};

// setcookie(): the same attributes PHP sent.
function customerCookie(s: Shop, value: string, expires: number): void {
  const secure = new URL(s.request.url).protocol === 'https:';
  const maxAge = Math.max(0, expires - nowUnix());
  s.cookies.push(CUSTOMER_COOKIE + '=' + (value === '' ? 'deleted' : encodeURIComponent(value)) + '; expires=' + new Date((value === '' ? 1 : expires) * 1000).toUTCString().replace(/GMT$/, 'GMT')
    + '; Max-Age=' + (value === '' ? 0 : maxAge) + '; path=/' + (secure ? '; secure' : '') + '; HttpOnly; SameSite=Lax');
}

export async function currentCustomer(s: Shop): Promise<Row | null> {
  if (s.customer !== undefined) return s.customer;
  const token = readCookie(s.request, CUSTOMER_COOKIE);
  if (token.length < 32) return (s.customer = null);
  return (s.customer = await s.db.prepare('SELECT c.* FROM customer_sessions s JOIN customers c ON c.id = s.customer_id WHERE s.token_hash = ? AND s.expires > ?')
    .bind(await sha256Hex(token), nowUnix()).first<Row>());
}

// The code is kept hashed with a random salt (PHP used password_hash; a code lives 15 minutes and allows 5 tries).
const hashCode = async (code: string): Promise<string> => { const salt = randomHex(8); return 's256:' + salt + ':' + await sha256Hex(salt + ':' + code); };
const codeMatches = async (code: string, stored: string): Promise<boolean> => {
  const m = stored.match(/^s256:([a-f0-9]+):([a-f0-9]{64})$/);
  return !!m && (await sha256Hex(m[1] + ':' + code)) === m[2];
};
const sixDigits = (): string => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));

export async function customerSendCode(s: Shop, email: string, lang: string): Promise<void> {
  email = phpTrim(email).toLowerCase();
  if (!validEmail(email)) throw new ShopError('Please enter a valid email.');
  if (await tooManyAttempts(s, 'ccode', 8, 3600)) throw new ShopError('Too many tries. Please wait a while.');
  await recordAttempt(s, 'ccode');
  const row = await s.db.prepare('SELECT sent_at, sends FROM customer_codes WHERE email = ?').bind(email).first<Row>();
  if (row && phpInt(row.sent_at) > nowUnix() - 45) throw new ShopError('We just sent a code — please check your email (and spam), or wait a minute to get a new one.');
  const sends = row && phpInt(row.sent_at) > nowUnix() - 3600 ? phpInt(row.sends) + 1 : 1;
  if (sends > 5) throw new ShopError('Too many tries. Please wait a while.');
  const code = sixDigits();
  await s.db.prepare('INSERT OR REPLACE INTO customer_codes (email, code_hash, expires, tries, sent_at, sends) VALUES (?, ?, ?, 0, ?, ?)')
    .bind(email, await hashCode(code), nowUnix() + 900, nowUnix(), sends).run();
  const ar = lang === 'ar';
  const title = ar ? 'كود الدخول: ' + code : 'Your sign-in code: ' + code;
  const inner = '<p style="font-size:15px;line-height:1.6">' + (ar ? 'استخدم هذا الكود لتسجيل الدخول إلى حسابك في متجر Where To Spot:' : 'Use this code to sign in to your Where To Spot shop account:') + '</p>'
    + '<div style="font-size:34px;font-weight:bold;letter-spacing:8px;background:#F7F3ED;border-radius:12px;padding:16px;text-align:center;margin:16px 0">' + code + '</div>'
    + '<p style="font-size:13px;color:#6B6660">' + (ar ? 'الكود صالح لمدة 15 دقيقة. إذا لم تطلبه، تجاهل هذه الرسالة.' : 'The code works for 15 minutes. If you didn’t ask for it, you can ignore this email.') + '</p>';
  sendMailLater(s, [email], title, emailShell(s, ar ? 'تسجيل الدخول' : 'Sign in', inner, 'customer'),
    (ar ? 'كود الدخول: ' : 'Your sign-in code: ') + code + '\n' + (ar ? 'صالح لمدة 15 دقيقة.' : 'It works for 15 minutes.'));
}

export async function customerVerify(s: Shop, email: string, code: string): Promise<Row> {
  email = phpTrim(email).toLowerCase();
  code = code.replace(/\D/g, '');
  if (await tooManyAttempts(s, 'cverify', 20, 3600)) throw new ShopError('Too many tries. Please wait a while.');
  const row = await s.db.prepare('SELECT * FROM customer_codes WHERE email = ?').bind(email).first<Row>();
  if (!row || phpInt(row.expires) < nowUnix()) throw new ShopError('This code has expired. Please ask for a new one.');
  if (phpInt(row.tries) >= 5) throw new ShopError('Too many wrong codes. Please ask for a new one.');
  if (!(await codeMatches(code, String(row.code_hash)))) {
    await recordAttempt(s, 'cverify');
    await s.db.prepare('UPDATE customer_codes SET tries = tries + 1 WHERE email = ?').bind(email).run();
    throw new ShopError('That code isn’t right. Check the latest email we sent.');
  }
  await s.db.batch([s.db.prepare('DELETE FROM customer_codes WHERE email = ?').bind(email), s.db.prepare('INSERT OR IGNORE INTO customers (email) VALUES (?)').bind(email)]);
  const c = (await s.db.prepare('SELECT * FROM customers WHERE email = ?').bind(email).first<Row>())!;
  if (c.name === '' && c.phone === '') {
    const last = await s.db.prepare('SELECT * FROM orders WHERE email = ? COLLATE NOCASE ORDER BY id DESC LIMIT 1').bind(email).first<Row>();
    if (last) await customerRememberOrder(s, phpInt(c.id), last);
  }
  const token = randomHex(32);
  const exp = nowUnix() + CUSTOMER_DAYS * 86400;
  await s.db.batch([
    s.db.prepare('DELETE FROM customer_sessions WHERE expires < ?').bind(nowUnix()),
    s.db.prepare('INSERT INTO customer_sessions (token_hash, customer_id, expires) VALUES (?, ?, ?)').bind(await sha256Hex(token), c.id, exp),
    s.db.prepare("UPDATE customers SET last_login = datetime('now') WHERE id = ?").bind(c.id),
  ]);
  customerCookie(s, token, exp);
  return (await s.db.prepare('SELECT * FROM customers WHERE email = ?').bind(email).first<Row>())!;
}

export async function customerLogout(s: Shop): Promise<void> {
  const token = readCookie(s.request, CUSTOMER_COOKIE);
  if (token !== '') await s.db.prepare('DELETE FROM customer_sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  customerCookie(s, '', nowUnix() - 3600);
}

export const customerRememberOrder = (s: Shop, customerId: number, o: Row, area: Row = {}) =>
  s.db.prepare(`UPDATE customers SET name = ?, phone = ?, address = ?, city = ?, city_id = ?, district_id = ?, district = ?,
    zone_id = COALESCE(?, zone_id), area_title = COALESCE(?, area_title), area_sub = COALESCE(?, area_sub) WHERE id = ?`)
    .bind(o.customer, o.phone, o.address, o.city, o.city_id ?? null, o.district_id ?? null, o.district ?? '', area.zone_id ?? null, area.area_title ?? null, area.area_sub ?? null, customerId).run();

export async function customerOut(s: Shop, c: Row): Promise<Row> {
  return { email: c.email, name: c.name, phone: c.phone, address: c.address, city: c.city, cityId: c.city_id, districtId: c.district_id, zoneId: c.zone_id,
    areaTitle: c.area_title, areaSub: c.area_sub, lang: c.lang, contact: c.contact_pref, offers: !!phpInt(c.offers), since: String(c.created_at ?? '').slice(0, 10),
    addresses: await customerAddresses(s, c) };
}

async function customerAddresses(s: Shop, c: Row): Promise<Row[]> {
  const { results } = await s.db.prepare(`SELECT address, city, district, city_id, district_id FROM orders WHERE (customer_id = ? OR email = ? COLLATE NOCASE)
    AND TRIM(address) != '' ORDER BY id DESC LIMIT 40`).bind(c.id, c.email).all<Row>();
  const out: Row[] = []; const seen = new Set<string>();
  for (const r of results) {
    const k = phpTrim(String(r.address)).replace(/[\t\n\x0B\f\r ]+/g, ' ').toLowerCase() + '|' + phpStr(r.district_id);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ address: r.address, city: r.city, district: r.district, cityId: r.city_id, districtId: r.district_id,
      current: phpTrim(String(r.address)) === phpTrim(phpStr(c.address)) && phpStr(r.district_id) === phpStr(c.district_id) });
    if (out.length >= 5) break;
  }
  return out;
}

export async function customerOrders(s: Shop, c: Row): Promise<Row[]> {
  const [orders, imgs, active] = await s.db.batch([
    s.db.prepare(`SELECT * FROM orders WHERE (customer_id = ? OR email = ? COLLATE NOCASE) AND NOT (status = 'Cancelled' AND notes LIKE ?) ORDER BY id DESC LIMIT 50`)
      .bind(c.id, c.email, '%' + UNPAID_EXPIRED_NOTE + '%'),
    s.db.prepare('SELECT product_id, path FROM product_images ORDER BY sort, id'),
    s.db.prepare("SELECT id FROM products WHERE status = 'Active'"),
  ]);
  const first: Record<string, string> = {};
  for (const i of imgs.results as Row[]) if (!(i.product_id in first)) first[i.product_id] = i.path;
  const live = new Set((active.results as Row[]).map((r) => String(r.id)));
  const out: Row[] = [];
  for (const o of orders.results as Row[]) {
    const paid = await orderPaid(s, Number(o.id));
    let items: Row[] = []; try { items = JSON.parse(String(o.items)) || []; } catch { /* none */ }
    out.push({ number: orderNumber(Number(o.id)), date: String(o.created_at).slice(0, 10), status: o.status,
      total: Number(o.total), shipping: Number(o.shipping), discount: Number(o.discount),
      paid: paid >= Number(o.total) - 0.5, due: Math.max(0, round(Number(o.total) - paid, 2)), payment: o.payment,
      tracking: o.tracking_number || '', shipment: o.tracking_number ? bostaStateLabel(o.bosta_state === null ? null : phpInt(o.bosta_state)) : '',
      address: phpTrim(o.address + (o.district ? ', ' + o.district : '') + (o.city ? ', ' + o.city : ''), ', '),
      items: items.map((it) => { const id = phpStr(it.id ?? ''); return { id, variant: it.variant ?? null, addons: it.addons ?? [], name: it.name, qty: phpInt(it.qty),
        total: Number(it.total ?? it.qty * it.price), image: first[id] ?? '', available: live.has(id) }; }) });
  }
  return out;
}

export async function customerSave(s: Shop, c: Row, b: Row): Promise<Row> {
  const name = strIn(b.name ?? c.name, 120), phone = strIn(b.phone ?? c.phone, 40);
  const contact = ['whatsapp', 'call', 'email'].includes(b.contact) ? b.contact : c.contact_pref;
  const lang = ['ar', 'en'].includes(b.lang) ? b.lang : c.lang;
  const empty = (v: unknown) => !v || v === '0' || (Array.isArray(v) && !v.length);
  const stmts = [s.db.prepare('UPDATE customers SET name = ?, phone = ?, address = ?, contact_pref = ?, lang = ?, offers = ? WHERE id = ?')
    .bind(name, phone, strIn(b.address ?? c.address, 500), contact, lang, 'offers' in b ? (empty(b.offers) ? 0 : 1) : phpInt(c.offers), c.id)];
  if ('districtId' in b) {
    stmts.push(s.db.prepare('UPDATE customers SET city = ?, city_id = ?, district_id = ?, district = ?, zone_id = NULL, area_title = ?, area_sub = ? WHERE id = ?')
      .bind(strIn(b.city, 80), strIn(b.cityId, 40) || null, strIn(b.districtId, 40) || null, strIn(b.district, 120), strIn(b.district, 120), strIn(b.city, 80), c.id));
  }
  await s.db.batch(stmts);
  return (await s.db.prepare('SELECT * FROM customers WHERE id = ?').bind(c.id).first<Row>())!;
}

// ---------- reviews ----------
async function reviewOrder(s: Shop, c: Row, productId: string): Promise<number | null> {
  const like = '%"id":"' + productId.replace(/%/g, '\\%').replace(/_/g, '\\_') + '"%';
  const o = await s.db.prepare("SELECT id FROM orders WHERE status = 'Delivered' AND (customer_id = ? OR email = ? COLLATE NOCASE) AND items LIKE ? ORDER BY id DESC LIMIT 1")
    .bind(phpInt(c.id), String(c.email), like).first<Row>();
  return o ? phpInt(o.id) : null;
}
export async function reviewSave(s: Shop, c: Row, productId: string, input: Row): Promise<void> {
  const order = await reviewOrder(s, c, productId);
  if (!order) throw new ShopError('Only customers who received this product can review it.', 403);
  const rating = Math.max(1, Math.min(5, phpInt(input.rating ?? 0)));
  const text = phpTrim(strIn(input.text, 1500));
  const name = phpTrim(strIn(input.name, 60)) || String(c.name);
  if (name === '') throw new ShopError('Please write your name.');
  if (mbLen(text) < 3) throw new ShopError('Please write a few words about the product.');
  const ex = await s.db.prepare('SELECT id FROM product_reviews WHERE customer_id = ? AND product_id = ?').bind(phpInt(c.id), productId).first<Row>();
  if (ex) {
    await s.db.prepare("UPDATE product_reviews SET name = ?, rating = ?, text = ?, order_id = ?, updated_at = datetime('now') WHERE id = ?").bind(name, rating, text, order, ex.id).run();
  } else {
    await s.db.prepare('INSERT INTO product_reviews (product_id, customer_id, order_id, name, rating, text) VALUES (?, ?, ?, ?, ?, ?)').bind(productId, phpInt(c.id), order, name, rating, text).run();
    await logActivity(s, null, 'New product review', productId + ' · ' + '★'.repeat(rating) + ' · ' + name);
  }
  // IndexNow pings come with switch day (the test shop must not announce itself).
}
export { mbSubstr };
