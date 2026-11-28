// Dashboard: orders, payments, invoices, customers, leads and quotes (port of those parts of api/admin.php).
import { round, mbSubstr, phpInt, phpFloat, phpStr, phpTrim, numberFormat, validEmail, phpJsonU } from '../lib/php';
import { type Row, SHOP } from '../lib/catalog';
import { type Shop, strIn, logActivity, orderNumber, orderPaid, phoneKey, emailKey, findLead, insertLead, touchLead, paymentStmt, priceLine, bostaFindArea,
  PAYMENT_KINDS, today, ShopError } from '../lib/shop';
import { fail, requirePerm, currentUser, hasPerm, LEAD_STATUSES } from '../lib/team';
import { setOrderStatus } from '../lib/orders';
import { abandonedDue } from '../lib/drafts';
import { reviewsDue } from './review';
import { opsError } from '../lib/shop';
import { cairoDay } from '../lib/time';
import type { A } from './admin';

type Handler = (a: A) => Promise<unknown>;
const num = (v: unknown) => Number(v ?? 0);
const first = (s: Shop, sql: string, ...args: unknown[]) => s.db.prepare(sql).bind(...args).first<Row>();
const all = async (s: Shop, sql: string, ...args: unknown[]) => (await s.db.prepare(sql).bind(...args).all<Row>()).results;
const truthy = (v: unknown) => !!v && v !== '0' && !(Array.isArray(v) && !v.length);

// fputcsv: a field is quoted when it holds a comma, quote, backslash, space, tab or line break.
export function csvOut(filename: string, rows: Row[]): Response {
  const cell = (v: unknown): string => {
    let x: string;
    if (Array.isArray(v)) x = v.map((i) => (i && typeof i === 'object' ? (i.qty ?? 1) + '× ' + (i.name ?? '') : String(i))).join('; ');
    else x = v === null || v === undefined || v === false ? '' : v === true ? '1' : typeof v === 'object' ? 'Array' : String(v);
    return /[,"\\\t\n\r ]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
  };
  let out = '﻿';
  if (rows.length) { out += Object.keys(rows[0]).map(cell).join(',') + '\n'; for (const r of rows) out += Object.values(r).map(cell).join(',') + '\n'; }
  return new Response(out, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + filename + '"' } });
}

export async function loadOrder(s: Shop, id: number): Promise<Row> {
  const o = await first(s, 'SELECT o.*, u.name AS rep_name, c.name AS created_by_name FROM orders o LEFT JOIN users u ON u.id = o.rep_id LEFT JOIN users c ON c.id = o.created_by WHERE o.id = ?', id);
  if (!o) fail('Order not found.', 404);
  return o!;
}
export async function orderPayments(s: Shop, orderId: number): Promise<Row[]> {
  return (await all(s, 'SELECT p.id, p.amount, p.method, p.note, p.created_at, u.name AS by_name FROM payments p LEFT JOIN users u ON u.id = p.created_by WHERE p.order_id = ? ORDER BY p.id', orderId))
    .map((p) => ({ id: phpInt(p.id), amount: num(p.amount), method: p.method, methodLabel: PAYMENT_KINDS[p.method] ?? p.method, note: p.note, at: p.created_at, by: p.by_name }));
}
const accessible = (u: Row, o: Row) => !hasPerm(u, 'own_orders') || phpInt(o.rep_id) === phpInt(u.id);
const assertAccess = (u: Row, o: Row) => { if (!accessible(u, o)) fail('Order not found.', 404); };

// A lead's corrected name / phone / email copied to that customer's orders.
async function syncLeadOrders(s: Shop, before: Row, name: string, contact: string): Promise<{ orders: string[]; shipped: string[] }> {
  const oldPhone = phoneKey(String(before.contact)), oldEmail = emailKey(String(before.contact));
  const noEmail = contact.replace(/[\p{L}\p{N}\p{Mn}\p{Pc}.+-]+@[\p{L}\p{N}\p{Mn}\p{Pc}-]+\.[\p{L}\p{N}\p{Mn}\p{Pc}.]+/gu, ' ');
  const pm = noEmail.match(/\+?[\d٠-٩][\d٠-٩\s-]{6,}[\d٠-٩]/u);
  const newPhone = pm ? phpTrim(pm[0]) : '';
  const newEmail = emailKey(contact) ?? '';
  const ids = new Set<number>();
  for (const m of (String(before.source) + ' ' + String(before.notes)).matchAll(/WTS-(\d+)/g)) ids.add(phpInt(m[1]) - 1000);
  const done: string[] = [], shipped: string[] = [];
  for (const o of await all(s, "SELECT id, customer, phone, email, tracking_number, status FROM orders WHERE status != 'Awaiting payment'")) {
    const byPhone = !!oldPhone && phoneKey(String(o.phone ?? '')) === oldPhone;
    const byEmail = !!oldEmail && emailKey(String(o.email ?? '')) === oldEmail;
    if (!byPhone && !byEmail && !ids.has(phpInt(o.id))) continue;
    const phone = newPhone !== '' && (byPhone || !byEmail) ? newPhone : o.phone;
    const email = newEmail !== '' && (byEmail || String(o.email ?? '') === '') ? newEmail : o.email;
    const cust = before.name !== name ? name : o.customer;
    if (phone === o.phone && email === o.email && cust === o.customer) continue;
    await s.db.prepare("UPDATE orders SET customer = ?, phone = ?, email = ?, updated_at = datetime('now') WHERE id = ?").bind(cust, phone, email, o.id).run();
    done.push(orderNumber(phpInt(o.id)));
    if (o.tracking_number && !['Delivered', 'Cancelled', 'Returned'].includes(o.status)) shipped.push(orderNumber(phpInt(o.id)));
  }
  return { orders: done, shipped };
}

// ---------- quotes ----------
export const QUOTE_STATUSES = ['Draft', 'Sent', 'Accepted', 'Declined'];
export const quoteNumber = (id: number) => 'Q-' + (1000 + id);
export async function loadQuote(s: Shop, id: number): Promise<Row> {
  const q = await first(s, 'SELECT q.*, u.name AS rep_name FROM quotes q LEFT JOIN users u ON u.id = q.rep_id WHERE q.id = ?', id);
  if (!q) fail('Quote not found.', 404);
  return q!;
}
const assertQuote = (u: Row, q: Row) => { if (hasPerm(u, 'own_orders') && phpInt(q.rep_id) !== phpInt(u.id)) fail('Quote not found.', 404); };
const jl = (v: unknown): any => { try { const x = JSON.parse(String(v ?? '')); return x && typeof x === 'object' && (Array.isArray(x) ? x.length : Object.keys(x).length) ? x : []; } catch { return []; } };
export function quoteOut(q: Row): Row {
  const expired = ['Draft', 'Sent'].includes(q.status) && q.valid_until && q.valid_until < cairoDay();
  return {
    id: phpInt(q.id), number: quoteNumber(phpInt(q.id)), leadId: q.lead_id === null ? null : phpInt(q.lead_id),
    orderId: q.order_id === null ? null : phpInt(q.order_id), orderNumber: q.order_id ? orderNumber(phpInt(q.order_id)) : null,
    customer: q.customer, phone: q.phone, email: q.email, businessName: q.business_name, reviewLink: q.review_link,
    links: q.links, designNotes: q.design_notes, address: q.address, city: q.city, district: q.district, cityId: q.city_id, districtId: q.district_id,
    itemsIn: jl(q.items_in), items: jl(q.items),
    subtotal: num(q.subtotal), discount: num(q.discount), shipping: num(q.shipping), total: num(q.total),
    status: expired ? 'Expired' : q.status, savedStatus: q.status, validUntil: q.valid_until, terms: q.terms, notes: q.notes,
    rep: q.rep_name ?? null, repId: q.rep_id === null ? null : phpInt(q.rep_id), sentAt: q.sent_at, createdAt: q.created_at,
  };
}
async function priceQuoteItems(s: Shop, items: Row[]): Promise<[Row[], Row[], number, number]> {
  if (!items.length || items.length > 50) throw new ShopError('Add at least one product.');
  const lines: Row[] = [], clean: Row[] = [];
  let subtotal = 0, physical = 0;
  for (const it of items) {
    const qty = Math.max(1, Math.min(99999, phpInt(it?.qty ?? 1)));
    const note = strIn(it?.note, 1000);
    if (truthy(it?.custom)) {
      const cname = strIn(it.name, 160), cprice = round(phpFloat(it.price ?? 0), 2);
      if (cname === '' || cprice <= 0) throw new ShopError('Custom items need a description and a price.');
      const lineTotal = round(cprice * qty);
      const ship = it.ship === undefined || it.ship === null || truthy(it.ship);
      lines.push({ id: 'custom', name: cname, qty, price: cprice, total: lineTotal, cat: ship ? 'custom' : 'services', ...(note !== '' ? { note } : {}) });
      clean.push({ custom: 1, name: cname, price: cprice, qty, ship: ship ? 1 : 0, note });
      subtotal += lineTotal; if (ship) physical += lineTotal;
      continue;
    }
    const p = await first(s, "SELECT * FROM products WHERE id = ? AND status = 'Active'", phpStr(it?.id ?? ''));
    if (!p) throw new ShopError('A product in the quote is no longer available.');
    const addonIds = (Array.isArray(it.addons) ? it.addons : it.addons ? [it.addons] : []).map((x: unknown) => phpStr(x));
    const [unit, lineTotal, variant, , lineName] = priceLine(p, it.variant !== undefined && it.variant !== null ? phpStr(it.variant) : null, addonIds, qty);
    lines.push({ id: p.id, name: lineName, qty, price: unit, total: lineTotal, cat: p.cat, ...(note !== '' ? { note } : {}) });
    clean.push({ id: p.id, variant: variant ? phpStr(variant.id) : null, addons: addonIds, qty, note });
    subtotal += lineTotal;
    if (p.cat !== 'services') physical += lineTotal;
  }
  return [lines, clean, round(subtotal, 2), physical];
}
async function linkQuoteLead(s: Shop, quoteId: number): Promise<void> {
  const q = await first(s, 'SELECT * FROM quotes WHERE id = ?', quoteId);
  if (!q) return;
  if (q.lead_id && (await first(s, 'SELECT 1 AS x FROM leads WHERE id = ?', phpInt(q.lead_id)))) return;
  const { money } = await import('../lib/catalog');
  const note = String(q.created_at ?? '').slice(0, 10) + ' · Quote ' + quoteNumber(quoteId) + ' · ' + money(q.total);
  const contact = phpTrim(q.phone + (q.email !== '' ? ' · ' + q.email : ''), ' ·');
  const lead = await findLead(s, phoneKey(String(q.phone ?? '')), emailKey(String(q.email ?? '')));
  let leadId: number;
  if (lead) {
    await touchLead(s, lead, note, ['New', 'Contacted'].includes(lead.status) ? 'Quoted' : null, q.rep_id ? phpInt(q.rep_id) : null, contact);
    leadId = phpInt(lead.id);
  } else {
    const items = (jl(q.items) as Row[]).map((i) => i.qty + '× ' + i.name).join(', ');
    leadId = await insertLead(s, { name: q.customer, contact, cat: mbSubstr(items, 0, 120), source: 'Quote', status: 'Quoted', notes: note, assigned_to: q.rep_id || null });
  }
  await s.db.prepare('UPDATE quotes SET lead_id = ? WHERE id = ?').bind(leadId, quoteId).run();
}

export function registerOrders(H: Record<string, Handler>, orderOut: (s: Shop, o: Row) => Promise<Row>): void {
  H.orders = async ({ s, q }) => {
    await requirePerm(s, 'orders');
    try { await reviewsDue(s); } catch (e) { await opsError(s, 'Reviews', 'Review reminders could not be checked', e); }
    const where: string[] = [], args: unknown[] = [];
    if (truthy(q.get('status'))) { where.push('o.status = ?'); args.push(q.get('status')); } else where.push("o.status != 'Awaiting payment'");
    if (truthy(q.get('due'))) where.push("o.status NOT IN ('Cancelled','Returned','Awaiting payment') AND o.total - (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.order_id = o.id) > 0.5");
    if (truthy(q.get('q'))) { const l = '%' + q.get('q') + '%'; where.push("(o.customer LIKE ? OR o.email LIKE ? OR o.phone LIKE ? OR ('WTS-' || (1000 + o.id)) LIKE ?)"); args.push(l, l, l, l); }
    const u = (await currentUser(s))!;
    if (hasPerm(u, 'own_orders')) { where.push('o.rep_id = ?'); args.push(phpInt(u.id)); }
    if (truthy(q.get('rep'))) { where.push('o.rep_id = ?'); args.push(phpInt(q.get('rep'))); }
    const sql = 'SELECT o.*, u.name AS rep_name, c.name AS created_by_name, (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.order_id = o.id) AS paid FROM orders o LEFT JOIN users u ON u.id = o.rep_id LEFT JOIN users c ON c.id = o.created_by'
      + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY o.id DESC LIMIT 500';
    const rows: Row[] = [];
    for (const o of await all(s, sql, ...args)) rows.push(await orderOut(s, o));
    if (q.get('format') === 'csv') return csvOut('orders.csv', rows);
    return { orders: rows };
  };
  H.order_update = async ({ s, body }) => {
    const u = await requirePerm(s, 'orders');
    const b = await body();
    const id = phpInt(b.id ?? 0);
    const o = await first(s, 'SELECT * FROM orders WHERE id = ?', id);
    if (!o) fail('Order not found.', 404);
    assertAccess(u, o!);
    // (PHP logged status changes from the dashboard as "Website": its session was closed by then. Kept as it was.)
    await setOrderStatus(s, id, phpStr(b.status ?? o!.status), strIn(b.notes ?? o!.notes, 2000), null, truthy(b.quiet));
    if ('prep_notes' in b) await s.db.prepare('UPDATE orders SET prep_notes = ? WHERE id = ?').bind(strIn(b.prep_notes, 500), id).run();
    if ('business_name' in b) await s.db.prepare('UPDATE orders SET business_name = ?, review_link = ?, links = ?, design_notes = ? WHERE id = ?')
      .bind(strIn(b.business_name, 120), strIn(b.review_link, 500), strIn(b.links, 1000), strIn(b.design_notes, 2000), id).run();
    return { ok: true };
  };

  // ---------- leads ----------
  H.leads = async ({ s, q }) => {
    await requirePerm(s, 'leads');
    await abandonedDue(s);
    const rows = await all(s, 'SELECT l.*, u.name AS assigned_name FROM leads l LEFT JOIN users u ON u.id = l.assigned_to ORDER BY l.id DESC LIMIT 500');
    if (q.get('format') === 'csv') return csvOut('leads.csv', rows);
    return { leads: rows };
  };
  H.lead_save = async ({ s, body }) => {
    const u = await requirePerm(s, 'leads');
    const b = await body();
    const id = phpInt(b.id ?? 0);
    const status = LEAD_STATUSES.includes(b.status) ? b.status : 'New';
    const assigned = truthy(b.assigned_to) ? phpInt(b.assigned_to) : null;
    const follow = /^\d{4}-\d{2}-\d{2}$/.test(phpStr(b.follow_up ?? '')) ? b.follow_up : null;
    const dupeMsg = (d: Row) => 'This number or email already belongs to “' + d.name + '” (' + d.status + (d.assigned_name ? ', ' + d.assigned_name : '') + '). Open that lead and add a note instead.';
    if (id) {
      await s.db.prepare('UPDATE leads SET status = ?, notes = ?, assigned_to = ?, follow_up = ? WHERE id = ?').bind(status, strIn(b.notes, 4000), assigned, follow, id).run();
      let sync: { orders: string[]; shipped: string[] } | null = null;
      if ('name' in b || 'contact' in b) {
        const name = strIn(b.name, 120), contact = strIn(b.contact, 160);
        if (name === '' || contact === '') fail('Name and contact are required.');
        const before = (await first(s, 'SELECT name, contact, source, notes FROM leads WHERE id = ?', id)) ?? { name: '', contact: '', source: '', notes: '' };
        const dupe = before.contact === contact ? null : await findLead(s, phoneKey(contact), emailKey(contact));
        if (dupe && phpInt(dupe.id) !== id) fail(dupeMsg(dupe), 409);
        await s.db.prepare('UPDATE leads SET name = ?, contact = ?, cat = ?, phone_key = ?, email_key = ? WHERE id = ?').bind(name, contact, strIn(b.cat, 120), phoneKey(contact), emailKey(contact), id).run();
        sync = await syncLeadOrders(s, before, name, contact);
      }
      await logActivity(s, u, 'Updated lead', '#' + id + ' → ' + status + (sync?.orders.length ? ' · details copied to ' + sync.orders.join(', ') : ''));
      return { ok: true, synced: sync?.orders ?? [], shipped: sync?.shipped ?? [] };
    }
    const name = strIn(b.name, 120), contact = strIn(b.contact, 160);
    if (name === '' || contact === '') fail('Name and contact are required.');
    const dupe = await findLead(s, phoneKey(contact), emailKey(contact));
    if (dupe) fail(dupeMsg(dupe), 409);
    const newId = await insertLead(s, { name, contact, cat: strIn(b.cat, 40), source: strIn(b.source ?? 'Added by team', 80), status, notes: strIn(b.notes, 2000), assigned_to: assigned });
    if (follow) await s.db.prepare('UPDATE leads SET follow_up = ? WHERE id = ?').bind(follow, newId).run();
    await logActivity(s, u, 'Added lead', name);
    return { ok: true };
  };
  H.lead_move = async ({ s, body }) => {
    const u = await requirePerm(s, 'leads');
    const b = await body();
    const id = phpInt(b.id ?? 0);
    const sets: string[] = [], vals: unknown[] = [];
    if (b.status !== undefined && b.status !== null) {
      if (!LEAD_STATUSES.includes(b.status)) fail('Unknown status');
      sets.push('status = ?'); vals.push(b.status);
    }
    if ('follow_up' in b) { sets.push('follow_up = ?'); vals.push(/^\d{4}-\d{2}-\d{2}$/.test(phpStr(b.follow_up)) ? b.follow_up : null); }
    if (!id || !sets.length) fail('Nothing to change');
    await s.db.prepare('UPDATE leads SET ' + sets.join(', ') + ' WHERE id = ?').bind(...vals, id).run();
    await logActivity(s, u, 'Updated lead', '#' + id + (b.status !== undefined && b.status !== null ? ' → ' + b.status : ' · follow-up ' + (truthy(b.follow_up) ? b.follow_up : 'cleared')));
    return { ok: true };
  };
  H.lead_delete = async ({ s, body }) => {
    const u = await requirePerm(s, 'leads');
    await s.db.prepare('DELETE FROM leads WHERE id = ?').bind(phpInt((await body()).id ?? 0)).run();
    await logActivity(s, u, 'Deleted lead');
    return { ok: true };
  };

  // ---------- payments & invoices ----------
  H.order_payments = async ({ s, q }) => {
    const u = await requirePerm(s, 'orders');
    const o = await loadOrder(s, phpInt(q.get('id') ?? 0));
    assertAccess(u, o);
    return { payments: await orderPayments(s, phpInt(o.id)), kinds: PAYMENT_KINDS };
  };
  H.payment_add = async ({ s, body }) => {
    const u = await requirePerm(s, 'orders');
    const b = await body();
    const o = await loadOrder(s, phpInt(b.order_id ?? 0));
    assertAccess(u, o);
    const amount = round(phpFloat(b.amount ?? 0), 2);
    if (amount == 0 || Math.abs(amount) > 1000000) fail('Enter the amount received (use a minus amount for a refund).');
    await paymentStmt(s, phpInt(o.id), amount, phpStr(b.method ?? 'cash'), strIn(b.note, 200), phpInt(u.id)).run();
    await logActivity(s, u, amount > 0 ? 'Payment received' : 'Refund recorded', orderNumber(phpInt(o.id)) + ' · EGP ' + numberFormat(amount));
    const o2 = await orderOut(s, await loadOrder(s, phpInt(o.id)));
    return { payments: await orderPayments(s, phpInt(o.id)), paid: o2.paid, due: o2.due };
  };
  H.payment_delete = async ({ s, body }) => {
    const u = await requirePerm(s, 'products');
    const b = await body();
    const pay = await first(s, 'SELECT * FROM payments WHERE id = ?', phpInt(b.id ?? 0));
    if (!pay) fail('Payment not found.', 404);
    await s.db.prepare('DELETE FROM payments WHERE id = ?').bind(phpInt(pay!.id)).run();
    await logActivity(s, u, 'Deleted a payment', orderNumber(phpInt(pay!.order_id)) + ' · EGP ' + numberFormat(num(pay!.amount)));
    const o2 = await orderOut(s, await loadOrder(s, phpInt(pay!.order_id)));
    return { payments: await orderPayments(s, phpInt(pay!.order_id)), paid: o2.paid, due: o2.due };
  };
  H.order_doc = async ({ s, q }) => {
    const u = await requirePerm(s, 'orders');
    const o = await loadOrder(s, phpInt(q.get('id') ?? 0));
    assertAccess(u, o);
    return { order: await orderOut(s, o), payments: await orderPayments(s, phpInt(o.id)), kinds: PAYMENT_KINDS, me: u.name };
  };

  // ---------- customers ----------
  H.customers = async ({ s }) => {
    const u = await requirePerm(s, 'orders');
    const own = hasPerm(u, 'own_orders');
    const rows = await all(s, `SELECT o.id, o.customer, o.email, o.phone, o.total, o.status, o.created_at, o.business_name, o.city, o.district,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.order_id = o.id) AS paid FROM orders o WHERE o.status != 'Awaiting payment'` + (own ? ' AND o.rep_id = ' + phpInt(u.id) : '') + ' ORDER BY o.id');
    const map = new Map<string, Row>();
    for (const r of rows) {
      const key = phoneKey(String(r.phone ?? '')) || emailKey(String(r.email ?? '')) || 'order-' + r.id;
      const closed = ['Cancelled', 'Returned'].includes(r.status);
      if (!map.has(key)) map.set(key, { key, name: r.customer, phone: r.phone, email: r.email, business: '', city: '', orders: 0, spent: 0, due: 0, first: r.created_at, last: r.created_at });
      const c = map.get(key)!;
      c.name = r.customer;
      if (r.phone) c.phone = r.phone;
      if (r.email && String(r.email).includes('@')) c.email = r.email;
      if (r.business_name) c.business = r.business_name;
      if (r.district || r.city) c.city = phpTrim(String(r.district ?? '') + (r.district && r.city ? ', ' : '') + String(r.city ?? ''));
      c.last = r.created_at;
      if (!closed) { c.orders++; c.spent += num(r.total); c.due += Math.max(0, num(r.total) - num(r.paid)); }
    }
    const byEmail = new Map<string, string>(), byPhone = new Map<string, string>();
    for (const [k, c] of map) { const e = emailKey(String(c.email ?? '')); if (e) byEmail.set(e, k); const ph = phoneKey(String(c.phone ?? '')); if (ph) byPhone.set(ph, k); }
    for (const a of await all(s, 'SELECT * FROM customers ORDER BY id')) {
      const acct = { since: a.created_at, lastLogin: a.last_login, offers: !!phpInt(a.offers), contact: a.contact_pref, lang: a.lang };
      const ek = emailKey(String(a.email ?? '')), pk = phoneKey(String(a.phone ?? ''));
      const k = (ek !== null ? byEmail.get(ek) : undefined) ?? (pk ? byPhone.get(pk) ?? null : null);
      if (k !== null && k !== undefined) { const c = map.get(k)!; c.account = acct; if (!c.email) c.email = a.email; continue; }
      if (own) continue;
      const key = ek ?? '';
      map.set(key, { key: ek, name: a.name || String(a.email).split('@')[0], phone: a.phone, email: a.email, business: '',
        city: phpTrim((a.district || '') + (a.district && a.city ? ', ' : '') + (a.city || '')), orders: 0, spent: 0, due: 0, first: a.created_at, last: a.last_login || a.created_at, account: acct });
    }
    const list = [...map.values()].map((c) => ('account' in c ? c : { ...c, account: null }));
    list.sort((x, y) => (String(y.last ?? '') < String(x.last ?? '') ? -1 : String(y.last ?? '') > String(x.last ?? '') ? 1 : 0));
    return { customers: list };
  };
  H.customer = async ({ s, q }) => {
    const u = await requirePerm(s, 'orders');
    const key = String(q.get('key') ?? '').replace(/[^\p{L}\p{N}\p{Mn}\p{Pc}.@+-]/gu, '');
    if (key === '') fail('Customer not found.', 404);
    const own = hasPerm(u, 'own_orders');
    const isPhone = /^\d+$/.test(key);
    const rows = await all(s, `SELECT o.*, u.name AS rep_name, (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.order_id = o.id) AS paid
      FROM orders o LEFT JOIN users u ON u.id = o.rep_id WHERE ` + (isPhone ? 'o.phone LIKE ?' : 'o.email = ? COLLATE NOCASE') + (own ? ' AND o.rep_id = ' + phpInt(u.id) : '') + ' ORDER BY o.id DESC',
      isPhone ? '%' + key.slice(-4) : key);
    const orders: Row[] = [];
    for (const o of rows) { const x = await orderOut(s, o); if (!isPhone || phoneKey(String(x.phone ?? '')) === key) orders.push(x); }
    const lead = hasPerm(u, 'leads') ? await findLead(s, isPhone ? key : null, isPhone ? null : key) : null;
    return { orders, lead };
  };

  // ---------- quotes ----------
  H.quotes = async ({ s }) => {
    const u = await requirePerm(s, 'sell');
    const own = hasPerm(u, 'own_orders');
    const rows = await all(s, 'SELECT q.*, u.name AS rep_name FROM quotes q LEFT JOIN users u ON u.id = q.rep_id' + (own ? ' WHERE q.rep_id = ' + phpInt(u.id) : '') + ' ORDER BY q.id DESC LIMIT 500');
    return { quotes: rows.map(quoteOut), statuses: QUOTE_STATUSES };
  };
  H.quote_save = async ({ s, body }) => {
    const u = await requirePerm(s, 'sell');
    const b = await body();
    let id = phpInt(b.id ?? 0);
    let q: Row | null = null;
    if (id) { q = await loadQuote(s, id); assertQuote(u, q); if (q.status === 'Accepted') fail('This quote was accepted and turned into an order, so it can’t be changed.'); }
    const name = strIn(b.name, 120);
    if (name === '') fail('Enter the customer’s name.');
    const email = strIn(b.email, 160);
    if (email !== '' && !validEmail(email)) fail('That email doesn’t look right — fix it or leave it empty.');
    const [lines, clean, subtotal, physical] = await priceQuoteItems(s, Array.isArray(b.items) ? b.items : []);
    const discount = Math.min(subtotal, Math.max(0, round(phpFloat(b.discount ?? 0), 2)));
    const shipping = b.shipping !== undefined && b.shipping !== null && b.shipping !== '' ? Math.max(0, round(phpFloat(b.shipping), 2))
      : physical > 0 && physical < SHOP.free_shipping_threshold ? SHOP.shipping_fee : 0;
    const total = round(subtotal - discount + shipping, 2);
    let cityId = strIn(b.city_id, 40), districtId = strIn(b.district_id, 40), city = '', district = '';
    if (cityId && districtId) { const area = bostaFindArea(cityId, districtId); if (area) { city = area.city.name; district = area.district.name; } else { cityId = districtId = ''; } }
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(phpStr(b.valid_until ?? '')) ? b.valid_until : new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const repId = hasPerm(u, 'targets') && truthy(b.rep_id) ? phpInt(b.rep_id) : id ? phpInt(q!.rep_id) : phpInt(u.id);
    const leadId = truthy(b.lead_id) ? phpInt(b.lead_id) : id ? q!.lead_id : null;
    const vals = [leadId, name, strIn(b.phone, 40), email, strIn(b.business_name, 120), strIn(b.review_link, 500), strIn(b.links, 1000),
      strIn(b.design_notes, 2000), strIn(b.address, 500), city, district, cityId || null, districtId || null,
      phpJsonU(clean), phpJsonU(lines), subtotal, discount, shipping, total, valid, strIn(b.terms, 2000), strIn(b.notes, 2000), repId || null];
    const cols = 'lead_id, customer, phone, email, business_name, review_link, links, design_notes, address, city, district, city_id, district_id, items_in, items, subtotal, discount, shipping, total, valid_until, terms, notes, rep_id';
    if (id) {
      await s.db.prepare('UPDATE quotes SET ' + cols.split(', ').join(' = ?, ') + " = ?, updated_at = datetime('now') WHERE id = ?").bind(...vals, id).run();
      await logActivity(s, u, 'Updated quote', quoteNumber(id) + ' · EGP ' + numberFormat(total));
      await linkQuoteLead(s, id);
    } else {
      const r = await s.db.prepare('INSERT INTO quotes (' + cols + ', created_by) VALUES (' + Array(23).fill('?').join(', ') + ', ?)').bind(...vals, phpInt(u.id)).run();
      id = Number(r.meta.last_row_id);
      await logActivity(s, u, 'Created quote', quoteNumber(id) + ' · ' + name + ' · EGP ' + numberFormat(total));
      const lead = leadId ? await first(s, 'SELECT * FROM leads WHERE id = ?', leadId) : null;
      if (lead) await touchLead(s, lead, today() + ' · Quote ' + quoteNumber(id) + ' · EGP ' + numberFormat(total), ['New', 'Contacted'].includes(lead.status) ? 'Quoted' : null, phpInt(u.id));
      else await linkQuoteLead(s, id);
    }
    return { quote: quoteOut(await loadQuote(s, id)) };
  };
  H.quote_status = async ({ s, body }) => {
    const u = await requirePerm(s, 'sell');
    const b = await body();
    const q = await loadQuote(s, phpInt(b.id ?? 0));
    assertQuote(u, q);
    const status = phpStr(b.status ?? '');
    if (!['Draft', 'Sent', 'Declined'].includes(status)) fail('Unknown status');
    if (q.status === 'Accepted') fail('This quote is already accepted.');
    await s.db.prepare("UPDATE quotes SET status = ?, sent_at = CASE WHEN ? = 'Sent' THEN COALESCE(sent_at, datetime('now')) ELSE sent_at END, updated_at = datetime('now') WHERE id = ?").bind(status, status, phpInt(q.id)).run();
    await logActivity(s, u, 'Quote ' + status.toLowerCase(), quoteNumber(phpInt(q.id)));
    return { quote: quoteOut(await loadQuote(s, phpInt(q.id))) };
  };
  H.quote_delete = async ({ s, body }) => {
    const u = await requirePerm(s, 'sell');
    const q = await loadQuote(s, phpInt((await body()).id ?? 0));
    assertQuote(u, q);
    if (q.status === 'Accepted') fail('Accepted quotes are kept with their order.');
    await s.db.prepare('DELETE FROM quotes WHERE id = ?').bind(phpInt(q.id)).run();
    await logActivity(s, u, 'Deleted quote', quoteNumber(phpInt(q.id)));
    return { ok: true };
  };
}
