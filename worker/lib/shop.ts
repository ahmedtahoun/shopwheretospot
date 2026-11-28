// The shop's shared rules (ports of api/bootstrap.php, orders.php, pricing.php, alerts.php, brands.php order parts):
// rate limits, the activity log, problem alerts, leads, promo codes, pricing, stock and placing orders.
// D1 has no open transactions: an order and its stock changes are written in one atomic batch, and the batch checks
// that the products didn't change since they were read (another order in between), so stock can't go wrong.
import { mbSubstr, mbLen, round, numberFormat, phpTrim, phpInt, phpFloat, phpStr, validEmail, phpJsonU, sha1Hex } from './php';
import { money, MARKET, SHOP, type Row } from './catalog';
import { bostaAreas } from './areas';
import { sendMail, sendMailLater, notifyNewOrder, emailShell, btn, h, waLink } from './mail';
import type { Env } from '../index';

export class ShopError extends Error {
  constructor(message: string, public code = 0) { super(message); }
}

// One request's context: the database, the site address, and work to finish after answering.
export interface Shop { request: Request; env: Env; db: D1Database; site: string; later(p: Promise<unknown>): void;
  cookies: string[]; customer?: Row | null; body?: Row }
export const makeShop = (request: Request, env: Env, ctx: ExecutionContext): Shop =>
  ({ request, env, db: env.DB, site: env.SITE_URL.replace(/\/+$/, ''), later: (p) => ctx.waitUntil(p.catch((e) => console.error('[later]', e))), cookies: [] });

// body(): JSON when sent as JSON, otherwise the form fields.
export async function readBody(s: Shop): Promise<Row> {
  if (s.body) return s.body;
  const ct = s.request.headers.get('Content-Type') ?? '';
  let b: Row = {};
  try {
    if (ct.toLowerCase().includes('application/json')) { const v = JSON.parse(await s.request.text()); b = v && typeof v === 'object' ? v : {}; }
    else if (/multipart\/form-data|application\/x-www-form-urlencoded/i.test(ct)) { const f = await s.request.formData(); for (const [k, v] of f) if (typeof v === 'string') b[k] = v; }
  } catch { b = {}; }
  return (s.body = b);
}

export const clientIp = (s: Shop): string => s.request.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
export const nowUnix = (): number => Math.floor(Date.now() / 1000);
export const today = (): string => new Date().toISOString().slice(0, 10); // date('Y-m-d'), server time (UTC)

// str_in(): trimmed, cut to a length in characters.
export const strIn = (v: unknown, max = 500): string => mbSubstr(phpTrim(phpStr(v)), 0, max);

export const orderNumber = (id: number): string => 'WTS-' + (1000 + id);

// ---------- rate limits (login_attempts) ----------
export async function tooManyAttempts(s: Shop, bucket: string, max: number, windowSec: number): Promise<boolean> {
  const key = bucket + ':' + clientIp(s);
  const [, r] = await s.db.batch([
    s.db.prepare('DELETE FROM login_attempts WHERE ts < ?').bind(nowUnix() - 86400),
    s.db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ts > ?').bind(key, nowUnix() - windowSec),
  ]);
  return Number((r.results[0] as Row).n) >= max;
}
export const recordAttempt = (s: Shop, bucket: string) =>
  s.db.prepare('INSERT INTO login_attempts (ip, ts) VALUES (?, ?)').bind(bucket + ':' + clientIp(s), nowUnix()).run();

// ---------- activity log ----------
export const activityStmt = (s: Shop, user: Row | null, action: string, detail = '') =>
  s.db.prepare('INSERT INTO activity (user_id, user_name, action, detail) VALUES (?, ?, ?, ?)').bind(user?.id ?? null, user?.name ?? 'Website', action, mbSubstr(detail, 0, 500));
export const logActivity = (s: Shop, user: Row | null, action: string, detail = '') => activityStmt(s, user, action, detail).run();

// ---------- problem alerts (api/alerts.php) ----------
const OPS_ALERT_EVERY = 3600;
const cairoWhen = (): string => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: MARKET.timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return p.day + ' ' + p.month + ', ' + p.hour + ':' + p.minute;
};
export async function opsError(s: Shop, area: string, message: string, e?: unknown): Promise<void> {
  message = phpTrim(mbSubstr(message + (e ? ': ' + (e instanceof Error ? e.message : String(e)) : ''), 0, 600));
  console.error('[' + area + '] ' + message);
  try {
    const fp = await sha1Hex(area + '|' + message.toLowerCase().replace(/\d+/g, '#'));
    await s.db.prepare(`INSERT INTO ops_errors (area, message, fp) VALUES (?, ?, ?)
      ON CONFLICT(fp) DO UPDATE SET count = count + 1, pending = pending + 1, message = excluded.message, last_at = datetime('now'), seen = 0`).bind(area, message, fp).run();
    const row = await s.db.prepare('SELECT * FROM ops_errors WHERE fp = ?').bind(fp).first<Row>();
    if (!row || (row.alerted_at && Date.parse(row.alerted_at.replace(' ', 'T') + 'Z') / 1000 > nowUnix() - OPS_ALERT_EVERY)) return;
    await s.db.prepare("UPDATE ops_errors SET alerted_at = datetime('now'), pending = 0 WHERE id = ?").bind(row.id).run();
    const times = Math.trunc(Number(row.pending)) + 1;
    s.later(opsNotify(s, area, message, times));
  } catch (x) { console.error('[alerts] could not record:', x); }
}
async function opsNotify(s: Shop, area: string, message: string, times: number): Promise<void> {
  const when = cairoWhen();
  const more = times > 1 ? ' · ' + times + '× in the last hour' : '';
  const { results: owners } = await s.db.prepare("SELECT id, name, email, tg_chat_id FROM users WHERE active = 1 AND role = 'owner'").all<Row>();
  const url = s.site + '/admin/#settings';
  // Telegram alerts come with the messaging port; until then the owners get an email.
  const to = owners.map((o) => String(o.email ?? '')).filter(Boolean);
  if (to.length && area !== 'Email') {
    await sendMail(s, to, 'Problem: ' + area + ' — Where To Spot shop', emailShell(s, 'Problem: ' + h(area),
      '<p>' + h(message).replace(/(\r\n|\n\r|\n|\r)/g, '<br />$1') + '</p><p style="color:#6B6660">' + h(when + more) + '</p>' + btn(url, 'Open the dashboard')),
      'Problem: ' + area + '\n' + message + '\n' + when + more + '\n' + url);
  }
}

// ---------- leads: one per phone number / email (api/orders.php) ----------
const AR_DIGITS: Record<string, string> = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
const EMAIL_RE = /[\p{L}\p{N}\p{Mn}\p{Pc}.+-]+@[\p{L}\p{N}\p{Mn}\p{Pc}-]+\.[\p{L}\p{N}\p{Mn}\p{Pc}.]+/u;
export function phoneKey(text: string): string | null {
  text = text.replace(/[٠-٩]/g, (c) => AR_DIGITS[c]).replace(new RegExp(EMAIL_RE.source, 'gu'), ' ');
  const digits = text.replace(/[^0-9]/g, '');
  return digits.length >= 8 ? digits.slice(-9) : null;
}
export const emailKey = (text: string): string | null => { const m = text.match(EMAIL_RE); return m ? m[0].toLowerCase() : null; };

export async function findLead(s: Shop, pk: string | null, ek: string | null): Promise<Row | null> {
  if (!pk && !ek) return null;
  return s.db.prepare(`SELECT l.*, u.name AS assigned_name FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
    WHERE (? IS NOT NULL AND l.phone_key = ?) OR (? IS NOT NULL AND l.email_key = ?) ORDER BY l.id LIMIT 1`).bind(pk, pk, ek, ek).first<Row>();
}
export async function insertLead(s: Shop, f: Row): Promise<number> {
  const contact = String(f.contact);
  const r = await s.db.prepare('INSERT INTO leads (name, contact, cat, source, status, notes, assigned_to, phone_key, email_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(f.name, contact, f.cat ?? '', f.source ?? '', f.status ?? 'New', f.notes ?? '', f.assigned_to ?? null, phoneKey(contact), emailKey(contact)).run();
  return Number(r.meta.last_row_id);
}
export async function touchLead(s: Shop, lead: Row, note: string, status: string | null, assignTo: number | null, contact = ''): Promise<void> {
  const notes = mbSubstr(phpTrim(note + '\n' + String(lead.notes ?? '')), 0, 4000);
  let c = String(lead.contact ?? '');
  if (contact !== '') {
    if (!lead.phone_key && phoneKey(contact)) c += ' · ' + phpTrim(contact.replace(new RegExp(EMAIL_RE.source, 'gu'), ''), ' ·');
    if (!lead.email_key && emailKey(contact)) c += ' · ' + emailKey(contact);
  }
  const nc = mbSubstr(c, 0, 160);
  await s.db.prepare('UPDATE leads SET notes = ?, status = COALESCE(?, status), assigned_to = COALESCE(assigned_to, ?), contact = ?, phone_key = ?, email_key = ? WHERE id = ?')
    .bind(notes, status, assignTo, nc, phoneKey(nc), emailKey(nc), lead.id).run();
}
const itemsText = (items: Row[]): string => items.map((i) => i.qty + '× ' + i.name).join(', ');

// The customer of an order becomes (or is added to) a Won lead.
export async function leadFromOrder(s: Shop, input: Row, order: { id: number; number: string; total: number }, repId: number | null, channel = 'Website'): Promise<string> {
  const name = strIn(input.name, 120), phone = strIn(input.phone, 40), email = strIn(input.email, 160);
  const contact = phpTrim(phone + (email !== '' ? ' · ' + email : ''), ' ·');
  const row = await s.db.prepare('SELECT items FROM orders WHERE id = ?').bind(order.id).first<Row>();
  let items: Row[] = []; try { items = JSON.parse(String(row?.items ?? '')) || []; } catch { /* none */ }
  const what = itemsText(items);
  const note = today() + ' · Order ' + order.number + ' (' + channel + ') · ' + money(order.total) + ' · ' + what;
  let existing = await findLead(s, phoneKey(phone), emailKey(email));
  if (!existing && input.lead_id) existing = await s.db.prepare('SELECT * FROM leads WHERE id = ?').bind(phpInt(input.lead_id)).first<Row>();
  if (existing) { await touchLead(s, existing, note, 'Won', repId, contact); return 'updated'; }
  await insertLead(s, { name, contact, cat: mbSubstr(what, 0, 120), source: 'Order ' + order.number + ' · ' + channel, status: 'Won', notes: note, assigned_to: repId });
  return 'created';
}

// ---------- promo codes ----------
const cairoToday = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: MARKET.timezone }).format(new Date());
export async function promoCheck(s: Shop, code: string, subtotal: number): Promise<[Row, number]> {
  code = phpTrim(code);
  const p = await s.db.prepare('SELECT * FROM promos WHERE code = ? COLLATE BINARY').bind(code).first<Row>();
  if (!p || !phpInt(p.active)) throw new ShopError('This promo code is not valid.');
  const t = cairoToday();
  if (p.starts_at && t < p.starts_at) throw new ShopError('This promo code is not active yet.');
  if (p.expires_at && t > p.expires_at) throw new ShopError('This promo code has expired.');
  if (p.max_uses !== null && p.max_uses !== undefined) {
    const u = await s.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE promo = ? COLLATE NOCASE AND status != 'Cancelled'").bind(p.code).first<Row>();
    if (Number(u?.n ?? 0) >= phpInt(p.max_uses)) throw new ShopError('This promo code has been fully used.');
  }
  if (phpFloat(p.min_order) > 0 && subtotal > 0 && subtotal < phpFloat(p.min_order)) throw new ShopError('This code needs an order of ' + money(p.min_order) + ' or more.');
  if (p.kind === 'shipping') return [p, 0];
  const discount = p.kind === 'fixed' ? Math.min(subtotal, phpFloat(p.value)) : round(subtotal * Math.min(100, phpFloat(p.value)) / 100, 2);
  return [p, round(discount, 2)];
}
export const promoLabel = (p: Row): string =>
  p.kind === 'shipping' ? 'Free delivery' : p.kind === 'fixed' ? money(p.value) + ' off' : numberFormat(phpFloat(p.value), 2).replace(/0+$/, '').replace(/\.$/, '') + '% off';

// ---------- payments ----------
export const PAYMENT_KINDS: Record<string, string> = { cash: 'Cash', bank: 'Bank transfer', wallet: 'InstaPay / wallet', cod: 'Collected on delivery', paymob: 'Paid online (Paymob)' };
export const PAYMENT_METHODS: Record<string, string> = { cod: 'Cash on delivery', bank: 'Paid — bank transfer', wallet: 'Paid — InstaPay / wallet', cash: 'Paid — cash in hand',
  paymob_card: 'Online — card (Paymob)', paymob_wallet: 'Online — mobile wallet (Paymob)' };
export const ORDER_STATUSES = ['Awaiting payment', 'Pending', 'Confirmed', 'Designing', 'Awaiting approval', 'In production', 'Ready', 'Shipped', 'Delivered', 'Cancelled', 'Returned'];
export const ORDER_SOURCES = ['Website', 'Phone', 'WhatsApp', 'Instagram', 'Facebook', 'TikTok', 'Walk-in', 'Referral', 'QR tool', 'Other'];
export async function orderPaid(s: Shop, orderId: number): Promise<number> {
  const r = await s.db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE order_id = ?').bind(orderId).first<Row>();
  return round(Number(r?.n ?? 0), 2);
}
// orderId may be a number or null (null: the order just inserted in the same batch, by last_insert_rowid()).
export const paymentStmt = (s: Shop, orderId: number | null, amount: number, method: string, note: string, userId: number | null) => {
  if (!(method in PAYMENT_KINDS)) method = 'cash';
  return orderId === null
    ? s.db.prepare('INSERT INTO payments (order_id, amount, method, note, created_by) VALUES (last_insert_rowid(), ?, ?, ?, ?)').bind(round(amount, 2), method, mbSubstr(note, 0, 200), userId)
    : s.db.prepare('INSERT INTO payments (order_id, amount, method, note, created_by) VALUES (?, ?, ?, ?, ?)').bind(orderId, round(amount, 2), method, mbSubstr(note, 0, 200), userId);
};

// ---------- pricing (api/pricing.php) ----------
export const productJsonArr = (p: Row, key: string): any => {
  try { const v = JSON.parse(String(p[key] ?? '')); return v && typeof v === 'object' ? v : []; } catch { return []; }
};
const asList = (v: any): any[] => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
const nonEmpty = (v: any): boolean => (Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' ? Object.keys(v).length > 0 : !!v);

export function pickTier(tiers: any[], qty: number): number | null {
  let best: number | null = null, bestMin = 0;
  for (const t of tiers) {
    const min = phpInt(t?.min ?? 0);
    if (min >= 1 && min <= qty && min >= bestMin && phpFloat(t?.price ?? 0) > 0) { best = phpFloat(t.price); bestMin = min; }
  }
  return best;
}

// One cart line: [unit, total, variant|null, addon labels, display name]. Throws when the option doesn't exist.
export function priceLine(p: Row, variantId: string | null, addonIds: unknown[], qty: number): [number, number, Row | null, Row[], string] {
  const variants = asList(productJsonArr(p, 'variants'));
  let variant: Row | null = null;
  if (variants.length) {
    for (const v of variants) if (phpStr(v.id) === phpStr(variantId)) variant = v;
    if (!variant) {
      if (variants.length === 1) variant = variants[0];
      else throw new ShopError('Choose an option for ' + p.name + '.');
    }
  }
  const base = phpFloat(p.price);
  const tiers = variant ? asList(variant.tiers ?? []) : asList(productJsonArr(p, 'tiers'));
  let unit = pickTier(tiers, qty) ?? (variant && nonEmpty(variant.price) && variant.price !== '0' ? phpFloat(variant.price) : base);
  const disc = phpFloat(p.discount_pct ?? 0);
  if (disc > 0) unit = unit * (1 - disc / 100);
  const ids = addonIds.map((x) => phpStr(x));
  const labels: Row[] = [];
  let perUnit = 0, perOrder = 0;
  for (const g of asList(productJsonArr(p, 'addons'))) {
    const opts = asList(g?.options ?? []);
    if (!opts.length) continue;
    let chosen = opts[0];
    for (const o of opts) if (ids.includes(phpStr(o.id))) chosen = o;
    const price = phpFloat(chosen.price ?? 0);
    if ((chosen.per ?? 'unit') === 'order') perOrder += price; else perUnit += price;
    if (price != 0 || opts.length > 1) labels.push({ id: phpStr(chosen.id), label: phpStr(chosen.label), group: phpStr(g.group ?? '') });
  }
  const total = round((unit + perUnit) * qty + perOrder);
  let name = p.name + (variant ? ' — ' + variant.label : '');
  const extras = labels.map((a) => a.label).filter((l) => !l.toLowerCase().includes('standard'));
  if (extras.length) name += ' · ' + extras.join(' · ');
  return [round(total / Math.max(1, qty), 4), total, variant, labels, name];
}
export const variantStock = (p: Row, variant: Row | null): number => (variant ? phpInt(variant.stock ?? 0) : phpInt(p.stock));

// The new stock of a product after an order line (adjust_stock): [stock, variants JSON or null].
export function stockAfter(p: Row, variantId: string | null, delta: number): { stock: number; variants: string | null } | null {
  if (p.cat === 'services') return null;
  const variants = productJsonArr(p, 'variants');
  const list = asList(variants);
  if (list.length && variantId !== null) {
    let sum = 0;
    for (const v of list) {
      if (phpStr(v.id) === phpStr(variantId)) v.stock = Math.max(0, phpInt(v.stock ?? 0) + delta);
      sum += phpInt(v.stock ?? 0);
    }
    return { stock: sum, variants: phpJsonU(variants) };
  }
  return { stock: Math.max(0, phpInt(p.stock) + delta), variants: null };
}

// ---------- brands in an order (api/brands.php) ----------
export const brandGet = (s: Shop, id: number) => s.db.prepare('SELECT * FROM brands WHERE id = ?').bind(id).first<Row>();
const intlDigits = (d: string): string => { if (d.startsWith('00')) d = d.slice(2); if (/^01\d{9}$/.test(d)) d = MARKET.phone_cc + d.slice(1); return d; };
export function brandContacts(b: Row): { emails: string[]; whatsapp: string } {
  const emails = String(b.order_emails ?? '').split(/[\t\n\x0B\f\r ,;]+/).map((e) => phpTrim(e)).filter((e) => validEmail(e));
  const wa = String(b.order_whatsapp ?? '').replace(/\D/g, '');
  return { emails, whatsapp: wa.length >= 8 ? intlDigits(wa) : '' };
}
export async function brandOrderParts(s: Shop, o: Row): Promise<Row[]> {
  let lines: Row[] = Array.isArray(o.items) ? o.items : []; if (!Array.isArray(o.items)) { try { lines = JSON.parse(String(o.items)) || []; } catch { lines = []; } }
  const parts = new Map<number, Row>(); const cache = new Map<number, Row | null>();
  let products = 0;
  for (const l of lines) {
    if ((l.cat ?? '') === 'services' || (l.id ?? '') === 'custom') continue;
    products++;
    if (!l.brand) continue;
    const id = phpInt(l.brand);
    if (!cache.has(id)) cache.set(id, await brandGet(s, id));
    const b = cache.get(id);
    if (!b) continue;
    const p = parts.get(id) ?? { brand: b, lines: [], pieces: 0, value: 0 };
    p.lines.push(l); p.pieces += phpInt(l.qty); p.value += phpFloat(l.total ?? phpFloat(l.price) * phpInt(l.qty));
    parts.set(id, p);
  }
  return [...parts.values()].map((p) => ({ ...p, only: p.pieces > 0 && p.lines.length === products, value: round(p.value, 2) }));
}
export async function brandOrderCollect(s: Shop, o: Row, part: Row): Promise<number> {
  const due = Math.max(0, round(phpFloat(o.total) - await orderPaid(s, Number(o.id)), 2));
  if (due <= 0) return 0;
  return part.only ? due : Math.min(due, part.value);
}
export async function brandOrderText(s: Shop, o: Row, part: Row): Promise<string> {
  const number = orderNumber(Number(o.id));
  const collect = await brandOrderCollect(s, o, part);
  const where = phpTrim([String(o.address ?? ''), String(o.district ?? ''), String(o.city ?? '')].filter((x) => x !== '' && x !== '0').join(', '));
  const items = (part.lines as Row[]).map((l) => '• ' + phpInt(l.qty) + '× ' + l.name).join('\n');
  return 'New order ' + number + ' from Where To Spot for ' + part.brand.name + '\n\n' + items + '\n\n'
    + 'Customer: ' + o.customer + '\n' + 'Phone: ' + o.phone + '\n' + 'Address: ' + (where || '—') + '\n'
    + (collect > 0 ? 'Collect on delivery: ' + money(collect) + (part.only ? '' : ' (for these items; the order also has items from another seller)') : 'Paid online: collect nothing') + '\n'
    + (phpTrim(String(o.notes ?? '')) !== '' ? 'Note: ' + phpTrim(String(o.notes ?? '')) + '\n' : '')
    + '\nPlease confirm, and tell us when it ships. Thank you!';
}
export async function brandNotifyOrder(s: Shop, o: Row): Promise<void> {
  for (const part of await brandOrderParts(s, o)) {
    const to = brandContacts(part.brand).emails;
    if (!to.length) continue;
    const number = orderNumber(Number(o.id));
    const collect = await brandOrderCollect(s, o, part);
    const where = phpTrim([String(o.address ?? ''), String(o.district ?? ''), String(o.city ?? '')].filter((x) => x !== '' && x !== '0').join(', '));
    const rows = (part.lines as Row[]).map((l) => '<tr><td style="padding:6px 0;border-bottom:1px solid #EFEAE3">' + phpInt(l.qty) + '× ' + h(l.name) + '</td></tr>').join('');
    const notes = phpTrim(String(o.notes ?? ''));
    const html = emailShell(s, 'New order ' + number + ' for ' + part.brand.name,
      '<p style="margin:0 0 4px"><b>' + h(o.customer) + '</b></p>'
      + '<p style="margin:0 0 4px"><a href="tel:' + h(o.phone) + '" style="color:#22201D">' + h(o.phone) + '</a></p>'
      + '<p style="margin:0 0 16px;color:#6B6660">' + h(where || '—') + '</p>'
      + '<table style="width:100%;border-collapse:collapse;font-size:14px">' + rows + '</table>'
      + '<p style="margin:16px 0 0;font-size:15px"><b>' + (collect > 0 ? 'Collect on delivery: ' + h(money(collect)) : 'Paid online: collect nothing') + '</b>'
      + (collect > 0 && !part.only ? '<br><span style="color:#6B6660;font-size:13px">For these items; the order also has items from another seller.</span>' : '') + '</p>'
      + (notes !== '' ? '<p style="margin:12px 0 0;white-space:pre-line;background:#F7F3ED;border-radius:10px;padding:12px 14px">' + h(notes) + '</p>' : '')
      + '<p style="margin:18px 0 0">' + btn(waLink(String(o.phone)), 'WhatsApp customer', '#1F7A4D') + '</p>'
      + '<p style="color:#6B6660;font-size:13px;margin:16px 0 0">Please confirm, and tell us when it ships. Thank you!</p>', 'brand');
    sendMailLater(s, to, 'New order ' + number + ' · ' + part.pieces + (part.pieces === 1 ? ' item' : ' items') + ' · ' + (collect > 0 ? 'collect ' + money(collect) : 'paid'), html, await brandOrderText(s, o, part));
  }
}

// ---------- placing an order (create_order) ----------
export function bostaFindArea(cityId: string, districtId: string): { city: Row; district: Row } | null {
  for (const c of bostaAreas() as Row[]) {
    if (c.id !== cityId) continue;
    for (const d of c.districts ?? []) if (d.id === districtId) return { city: c, district: d };
  }
  return null;
}

export interface OrderOpts { by_team?: boolean; rep_id?: number | null; created_by?: number | null; source?: string; payment?: string; status?: string;
  discount?: number; shipping?: number | string | null; notes?: string; paid_now?: number | string; deposit_method?: string }

export async function createOrder(s: Shop, input: Row, opts: OrderOpts = {}, attempt = 0): Promise<{ id: number; number: string; total: number; shipping: number; discount: number }> {
  const team = !!opts.by_team;
  const name = strIn(input.name, 120), email = strIn(input.email, 160), phone = strIn(input.phone, 40), address = strIn(input.address, 500);
  let city = strIn(input.city, 60), cityId = strIn(input.city_id, 40), districtId = strIn(input.district_id, 40), district = '';
  if (cityId && districtId) {
    const area = bostaFindArea(cityId, districtId);
    if (area) { city = area.city.name; district = area.district.name; } else { cityId = districtId = ''; }
  }
  if (name === '') throw new ShopError(team ? 'Enter the customer’s name.' : 'Please enter your name.');
  if (team ? email !== '' && !validEmail(email) : !validEmail(email)) throw new ShopError(team ? 'That email doesn’t look right — fix it or leave it empty.' : 'Please enter a valid email.');
  if (phone === '') throw new ShopError(team ? 'Enter the customer’s phone number.' : 'Please enter a phone number so we can confirm your order.');
  const items: Row[] = Array.isArray(input.items) ? input.items : input.items && typeof input.items === 'object' ? Object.values(input.items) : [];
  if (!items.length || items.length > 50) throw new ShopError(team ? 'Add at least one product.' : 'Your cart is empty.');

  const lines: Row[] = [];
  let subtotal = 0, physical = 0, personalized = false;
  const taken: Record<string, number> = {};
  const read = new Map<string, Row>(); // each product as read now (the batch checks it is unchanged)
  const working = new Map<string, Row>(); // with this order's stock taken off so far
  const brands = new Map<number, Row | null>();
  const brand = async (id: number) => { if (!brands.has(id)) brands.set(id, await brandGet(s, id)); return brands.get(id)!; };
  for (const it of items) {
    const qty = Math.max(1, Math.min(9999, phpInt(it?.qty ?? 1)));
    if (it?.custom) {
      if (!team) throw new ShopError('A product in your cart is no longer available. Please refresh.');
      const cname = strIn(it.name, 160), cprice = round(phpFloat(it.price ?? 0), 2);
      if (cname === '' || cprice <= 0) throw new ShopError('Custom items need a description and a price.');
      const lineTotal = round(cprice * qty);
      const ship = it.ship === undefined || it.ship === null || !!it.ship && it.ship !== '0';
      const line: Row = { id: 'custom', name: cname, qty, price: cprice, total: lineTotal, cat: ship ? 'custom' : 'services' };
      if (team && strIn(it.note, 1000) !== '') line.note = strIn(it.note, 1000);
      lines.push(line); subtotal += lineTotal; if (ship) physical += lineTotal; personalized = true;
      continue;
    }
    const pid = phpStr(it?.id ?? '');
    let p = working.get(pid);
    if (!p) {
      const row = await s.db.prepare("SELECT * FROM products WHERE id = ? AND status = 'Active'").bind(pid).first<Row>();
      if (row) { read.set(pid, { ...row }); working.set(pid, row); p = row; }
    }
    if (!p) throw new ShopError('A product in the order is no longer available. Please refresh.');
    const [unit, lineTotal, variant, addons, lineName] = priceLine(p, it.variant !== undefined && it.variant !== null ? phpStr(it.variant) : null, Array.isArray(it.addons) ? it.addons : it.addons ? [it.addons] : [], qty);
    const key = p.id + '|' + (variant?.id ?? '');
    taken[key] = (taken[key] ?? 0) + qty;
    // Stock as read (earlier lines of this order are counted in "taken").
    const fresh = read.get(pid)!;
    const freshVariant = variant ? asList(productJsonArr(fresh, 'variants')).find((v) => phpStr(v.id) === phpStr(variant.id)) ?? variant : null;
    if (p.cat !== 'services' && variantStock(fresh, freshVariant) < taken[key]) throw new ShopError(lineName + ': only ' + variantStock(fresh, freshVariant) + ' left in stock.');
    const line: Row = { id: p.id, name: lineName, qty, price: unit, total: lineTotal, cat: p.cat };
    if (phpFloat(p.cost) > 0) line.cost = phpFloat(p.cost);
    if (variant) line.variant = phpStr(variant.id);
    if (team && strIn(it.note, 1000) !== '') line.note = strIn(it.note, 1000);
    if (addons.length) line.addons = addons;
    if (p.brand_id) {
      const b = await brand(phpInt(p.brand_id));
      if (b) {
        line.brand = phpInt(b.id); line.comm = phpFloat(b.commission);
        const bp = variant && variant.brandPrice !== undefined && variant.brandPrice !== null ? phpFloat(variant.brandPrice) : phpFloat(p.brand_price ?? 0);
        if (bp > 0) line.bp = bp;
      }
    }
    lines.push(line); subtotal += lineTotal;
    if (p.cat !== 'services') physical += lineTotal;
    if (p.personalized && p.personalized !== '0') personalized = true;
  }
  const brandQty: Record<number, number> = {};
  for (const l of lines) if (l.brand !== undefined) brandQty[l.brand] = (brandQty[l.brand] ?? 0) + phpInt(l.qty);
  for (const l of lines) {
    if (l.brand === undefined) continue;
    const br = await brand(l.brand);
    const min = phpInt(br?.b2b_min_qty ?? 0);
    if (br && br.commission_b2b !== null && br.commission_b2b !== undefined && min > 0 && brandQty[l.brand] >= min) { l.comm = phpFloat(br.commission_b2b); l.b2b = 1; }
  }
  const biz = strIn(input.business_name, 120);
  if (personalized && !team && biz === '') throw new ShopError('Please enter the business or brand name to print on your items.');
  if (physical > 0 && mbLen(address) < 6) throw new ShopError(team ? 'Enter the delivery address.' : 'Please enter your delivery address.');

  let promo = strIn(input.promo, 40), discount = 0, freeDelivery = false;
  if (promo !== '') {
    try { const [pr, d] = await promoCheck(s, promo, subtotal); discount = d; promo = pr.code; freeDelivery = pr.kind === 'shipping'; }
    catch (e) { if (!team || !(e instanceof ShopError)) throw e; promo = ''; }
  }
  if (!discount && !freeDelivery) promo = '';
  if (team && opts.discount !== undefined && phpFloat(opts.discount) > 0) { discount = Math.min(subtotal, round(phpFloat(opts.discount), 2)); promo = 'MANUAL'; }
  let shipping = physical > 0 && physical < SHOP.free_shipping_threshold && !freeDelivery ? SHOP.shipping_fee : 0;
  if (team && opts.shipping !== undefined && opts.shipping !== '' && opts.shipping !== null) shipping = Math.max(0, round(phpFloat(opts.shipping), 2));
  subtotal = round(subtotal, 2);
  const total = round(subtotal - discount + shipping, 2);

  let repId: number | null = opts.rep_id ?? null;
  const ref = strIn(input.ref, 40);
  if (!repId && ref !== '') {
    const u = await s.db.prepare('SELECT id FROM users WHERE ref_code = ? AND active = 1').bind(ref).first<Row>();
    repId = u ? phpInt(u.id) : null;
    if (!repId) throw new ShopError('Referral code not recognised — check it or leave it blank.');
  }
  const source = ORDER_SOURCES.includes(opts.source ?? '') ? opts.source! : repId && !team ? 'Referral' : 'Website';
  const payment = (opts.payment ?? '') in PAYMENT_METHODS ? opts.payment! : 'cod';
  const status = ['Pending', 'Confirmed', 'Awaiting payment'].includes(opts.status ?? '') ? opts.status! : 'Pending';

  // Logos uploaded before the order (upload_logo) come with the photo storage port; none can exist yet.
  const files: Row[] = [];

  const stmts: D1PreparedStatement[] = [];
  // Abort the whole batch if a product changed since it was read (json('x') is an error).
  for (const [id, p] of read) stmts.push(s.db.prepare("SELECT json(CASE WHEN EXISTS (SELECT 1 FROM products WHERE id = ? AND stock IS ? AND variants IS ?) THEN '1' ELSE 'changed' END) AS ok").bind(id, p.stock, p.variants));
  stmts.push(s.db.prepare(`INSERT INTO orders (customer, email, phone, address, city, city_id, district_id, district, items, subtotal, discount, shipping, total, promo, payment, rep_id, source, created_by, status, notes,
      business_name, review_link, links, design_notes, files) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(name, email, phone, address, city, cityId || null, districtId || null, district, phpJsonU(lines), subtotal, discount, shipping, total, promo, payment, repId, source,
      opts.created_by ?? null, status, strIn(opts.notes, 2000), biz, strIn(input.review_link, 500), strIn(input.links, 1000), strIn(input.design_notes, 2000), phpJsonU(files)));
  const paidNow = opts.paid_now !== undefined && opts.paid_now !== '' ? Math.max(0, Math.min(total, phpFloat(opts.paid_now))) : payment !== 'cod' ? total : 0;
  if (paidNow > 0) stmts.push(paymentStmt(s, null, paidNow, payment === 'cod' ? opts.deposit_method ?? 'cash' : payment, paidNow < total ? 'Deposit' : 'Paid when the order was placed', opts.created_by ?? null));
  // Stock: each product once, with every line of this order taken off.
  const after = new Map<string, { stock: number; variants: string | null }>();
  for (const l of lines) {
    if (l.id === 'custom') continue;
    const cur = { ...read.get(l.id)!, ...(after.has(l.id) ? { stock: after.get(l.id)!.stock, variants: after.get(l.id)!.variants ?? read.get(l.id)!.variants } : {}) };
    const na = stockAfter(cur, l.variant ?? null, -phpInt(l.qty));
    if (na) after.set(l.id, { stock: na.stock, variants: na.variants ?? (after.get(l.id)?.variants ?? null) });
  }
  for (const [id, a] of after) {
    stmts.push(a.variants === null
      ? s.db.prepare("UPDATE products SET stock = ?, updated_at = datetime('now') WHERE id = ?").bind(a.stock, id)
      : s.db.prepare("UPDATE products SET variants = ?, stock = ?, updated_at = datetime('now') WHERE id = ?").bind(a.variants, a.stock, id));
  }
  let id: number;
  try {
    const res = await s.db.batch(stmts);
    id = Number((res[read.size].results[0] as Row).id);
  } catch (e) {
    if (String(e).includes('malformed JSON') && attempt < 3) return createOrder(s, input, opts, attempt + 1); // another order took stock meanwhile: read again
    throw e;
  }
  if (status !== 'Awaiting payment') await notifyOrder(s, id);
  return { id, number: orderNumber(id), total, shipping, discount };
}

// "New order" alert to the team, and to partner brands that deliver themselves.
export async function notifyOrder(s: Shop, id: number): Promise<void> {
  const o = await s.db.prepare('SELECT o.*, u.name AS rep_name FROM orders o LEFT JOIN users u ON u.id = o.rep_id WHERE o.id = ?').bind(id).first<Row>();
  if (!o) return;
  let items: Row[] = []; try { items = JSON.parse(String(o.items)) || []; } catch { /* none */ }
  await notifyNewOrder(s, orderNumber(id), {
    name: o.customer, email: o.email, phone: o.phone, address: o.address, city: o.district ? o.district + ', ' + o.city : o.city,
    subtotal: Number(o.subtotal), discount: Number(o.discount), promo: o.promo, shipping: Number(o.shipping), total: Number(o.total),
    rep: o.rep_name || null, source: o.source, payment: PAYMENT_METHODS[o.payment] ?? o.payment,
  }, items as any);
  try { await brandNotifyOrder(s, o); } catch (e) { await opsError(s, 'Partner brands', 'A brand wasn’t emailed about ' + orderNumber(id), e); }
}
