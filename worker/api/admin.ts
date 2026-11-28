// The team dashboard's API (port of api/admin.php). Every action except session/login/setup needs a signed-in
// user with the matching permission and, for writes, the CSRF token. The WhatsApp inbox, Telegram, the bot and
// insights come with the messaging port; photos and files with the photo storage (R2) port.
import { phpJson, round, mbSubstr, mbLen, phpInt, phpFloat, phpStr, phpTrim, numberFormat, validEmail, randomHex, phpJsonU, phpJsonPlain } from '../lib/php';
import { loadProducts, loadBrands, type Row, SHOP } from '../lib/catalog';
import { seoLookups, seoItem, type Ctx } from '../lib/seo';
import { type Shop, ShopError, makeShop, readBody, strIn, tooManyAttempts, recordAttempt, logActivity, opsError, orderNumber, orderPaid, phoneKey, emailKey,
  createOrder, leadFromOrder, brandGet, ORDER_STATUSES, ORDER_SOURCES, PAYMENT_METHODS, PAYMENT_KINDS, nowUnix, brandOrderParts, brandContacts, brandOrderText } from '../lib/shop';
import { AdminFail, fail, ROLES, LEAD_STATUSES, startSession, regenerateSession, destroySession, saveSession, currentUser, requirePerm, hasPerm, passwordVerify, passwordHash,
  deviceLogin, deviceLabel, deviceHints, deviceList, loginLocation, loginLocationNeeded, loginLocationRefreshDue, teamSetting, teamSetSetting, loginList, workingHours, saveUser } from '../lib/team';
import { teamPerformance, teamCommissions, expensesReport, expenseDay, expenseOrderId, supplierStatement, expensesSince, monthReport, reportMonths, reportSnapshot, reportCloseMonths, reportChanges } from '../lib/reports';
import { cleanTiers, cleanVariants, cleanAddons, applySizePrices, brandSellPrice } from '../lib/products';
import { bostaStateLabel } from '../lib/customers';
import { expireUnpaidOrders } from '../lib/orders';
import { cairoDay, cairoMonth, cairoMidnight, addDays, addMonths, dayDiff, utcStamp, parseUtc, cairoDayOfMonth } from '../lib/time';
import { sendMail, emailShell } from '../lib/mail';
import type { Env } from '../index';
import { registerOrders } from './admin-orders';
import { registerBrands } from './admin-brands';
import { registerTeam } from './admin-team';

export interface A { s: Shop; q: URLSearchParams; method: string; action: string; body(): Promise<Row>; ctx: Ctx }
type Handler = (a: A) => Promise<unknown>;
export const H: Record<string, Handler> = {};

const num = (v: unknown) => Number(v ?? 0);
const first = async (s: Shop, sql: string, ...args: unknown[]) => s.db.prepare(sql).bind(...args).first<Row>();
const all = async (s: Shop, sql: string, ...args: unknown[]) => (await s.db.prepare(sql).bind(...args).all<Row>()).results;
// PHP's json_encode of an associative array: an empty one is "[]".
export const assoc = (o: Record<string, unknown>): unknown => (Object.keys(o).length ? o : []);

// ---------- shared rows ----------
export async function reviewUrl(s: Shop, o: Row): Promise<string> {
  let t = String(o.review_token ?? '');
  if (!/^[a-f0-9]{24}$/.test(t)) {
    t = randomHex(12);
    await s.db.prepare('UPDATE orders SET review_token = ? WHERE id = ? AND review_token IS NULL').bind(t, phpInt(o.id)).run();
    t = String((await first(s, 'SELECT review_token FROM orders WHERE id = ?', phpInt(o.id)))?.review_token ?? '');
  }
  return s.site + '/rate/' + t;
}
export async function brandOrderShare(s: Shop, o: Row): Promise<Row[]> {
  const out: Row[] = [];
  for (const part of await brandOrderParts(s, o)) {
    const wa = brandContacts(part.brand).whatsapp;
    if (wa === '') continue;
    out.push({ brand: part.brand.name, url: 'https://wa.me/' + wa + '?text=' + encodeURIComponent(await brandOrderText(s, o, part)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()) });
  }
  return out;
}
const jsonList = (v: unknown): any => { try { const x = JSON.parse(String(v ?? '')); return x && typeof x === 'object' && (Array.isArray(x) ? x.length : Object.keys(x).length) ? x : []; } catch { return []; } };
export async function orderOut(s: Shop, o: Row): Promise<Row> {
  const paid = 'paid' in o ? round(num(o.paid), 2) : await orderPaid(s, phpInt(o.id));
  const closed = ['Cancelled', 'Returned'].includes(o.status);
  const bs = o.bosta_state === null || o.bosta_state === undefined ? null : phpInt(o.bosta_state);
  return {
    paid, due: closed ? 0 : Math.max(0, round(num(o.total) - paid, 2)),
    id: phpInt(o.id), number: orderNumber(phpInt(o.id)), customer: o.customer, email: o.email, phone: o.phone, address: o.address, city: o.city, items: jsonList(o.items),
    subtotal: num(o.subtotal), discount: num(o.discount), shipping: num(o.shipping), total: num(o.total), promo: o.promo, payment: o.payment, status: o.status,
    notes: o.notes, prepNotes: String(o.prep_notes ?? ''), rep: o.rep_name ?? null, repId: o.rep_id === null ? null : phpInt(o.rep_id), createdAt: o.created_at,
    businessName: o.business_name ?? '', reviewLink: o.review_link ?? '', links: o.links ?? '', designNotes: o.design_notes ?? '',
    files: jsonList(o.files ?? '[]'),
    source: o.source ?? 'Website', createdBy: o.created_by_name ?? null, paymentLabel: PAYMENT_METHODS[o.payment] ?? o.payment,
    cityId: o.city_id, districtId: o.district_id, district: o.district,
    tracking: o.tracking_number, bostaState: bs, bostaLabel: bostaStateLabel(bs), bostaNote: o.bosta_note,
    bostaCod: o.bosta_cod === null ? null : num(o.bosta_cod), bostaUpdatedAt: o.bosta_updated_at,
    rateUrl: o.status === 'Delivered' ? await reviewUrl(s, o) : null, reviewAskedAt: o.review_asked_at ?? null, lang: String(o.lang ?? ''),
    brandShare: String(o.items ?? '').includes('"brand"') ? await brandOrderShare(s, o) : [],
  };
}

// ---------- session ----------
H.session = async ({ s }) => {
  await startSession(s);
  const needsSetup = num((await first(s, 'SELECT COUNT(*) AS n FROM users'))?.n) === 0;
  const u = await currentUser(s);
  if (u && !s.session!.data.csrf) { s.session!.data.csrf = randomHex(16); s.session!.dirty = true; }
  return { user: u, csrf: u ? s.session!.data.csrf : null, needsSetup, askLocation: u ? await loginLocationNeeded(s, u) : false, refreshLocation: u ? await loginLocationRefreshDue(s, u) : false,
    locationAtSignIn: !!(await teamSetting(s, 'ask_location', false)), setupKeyPath: needsSetup ? 'SETUP_KEY secret' : null,
    roles: Object.keys(ROLES), orderStatuses: ORDER_STATUSES, leadStatuses: LEAD_STATUSES };
};
H.setup = async ({ s, method, body }) => {
  if (method !== 'POST') fail('Not found', 404);
  await startSession(s);
  if (num((await first(s, 'SELECT COUNT(*) AS n FROM users'))?.n) > 0) fail('Setup is already done.', 409);
  if (await tooManyAttempts(s, 'setup', 10, 900)) fail('Too many attempts. Wait 15 minutes.', 429);
  const b = await body();
  if (!s.env.SETUP_KEY || s.env.SETUP_KEY !== strIn(b.key, 64)) { await recordAttempt(s, 'setup'); fail('Setup key is wrong.', 403); }
  const id = await saveUser(s, { name: b.name ?? '', email: b.email ?? '', password: b.password ?? '', role: 'owner', active: 1, notify: 1 }, null);
  await regenerateSession(s);
  s.session!.data.uid = id; s.session!.data.csrf = randomHex(16);
  s.user = undefined;
  await logActivity(s, await currentUser(s), 'Created owner account');
  return { ok: true };
};
H.login = async ({ s, method, body }) => {
  if (method !== 'POST') fail('Not found', 404);
  await startSession(s);
  if (await tooManyAttempts(s, 'login', 8, 900)) fail('Too many sign-in attempts. Wait 15 minutes.', 429);
  const b = await body();
  const u = await first(s, 'SELECT * FROM users WHERE email = ? AND active = 1', strIn(b.email, 160));
  if (!u || !passwordVerify(phpStr(b.password ?? ''), String(u.password_hash))) { await recordAttempt(s, 'login'); fail('Wrong email or password.', 401); }
  await regenerateSession(s);
  s.session!.data.uid = phpInt(u!.id); s.session!.data.csrf = randomHex(16);
  await s.db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").bind(u!.id).run();
  await deviceLogin(s, u!);
  await logActivity(s, u!, 'Signed in', deviceLabel((s.request.headers.get('User-Agent') ?? '').slice(0, 400)));
  return { ok: true };
};
H.logout = async ({ s }) => { await startSession(s); await destroySession(s); return { ok: true }; };
H.password = async ({ s, body }) => {
  const u = await currentUser(s);
  if (!u) fail('Not signed in', 401);
  await requirePerm(s, 'dashboard');
  const b = await body();
  const row = await first(s, 'SELECT password_hash FROM users WHERE id = ?', u!.id);
  if (!passwordVerify(phpStr(b.current ?? ''), String(row?.password_hash ?? ''))) fail('Current password is wrong.');
  const nw = phpStr(b.new ?? '');
  if (new TextEncoder().encode(nw).length < 8) fail('New password must be at least 8 characters.');
  await s.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash(nw), u!.id).run();
  await logActivity(s, u, 'Changed password');
  return { ok: true };
};

// ---------- dashboard ----------
async function abandonedStats(s: Shop, from: string, to: string): Promise<Row> {
  const r: Row = { abandoned: 0, abandonedValue: 0, recovered: 0, recoveredValue: 0 };
  for (const x of await all(s, "SELECT status, COUNT(*) n, COALESCE(SUM(total), 0) v FROM checkout_drafts WHERE status IN ('abandoned', 'recovered') AND abandoned_at >= ? AND abandoned_at < ? GROUP BY status", from, to)) {
    r[x.status] = phpInt(x.n); r[x.status + 'Value'] = round(num(x.v), 2);
  }
  r.abandoned += r.recovered; r.abandonedValue += r.recoveredValue;
  return r;
}

H.dashboard = async ({ s, q }) => {
  const u = await requirePerm(s, 'dashboard');
  const revenue = hasPerm(u, 'revenue'), ordersOnly = hasPerm(u, 'orders_only');
  const period = ['month', 'last'].includes(q.get('period') ?? '') ? q.get('period')! : 'days';
  if (revenue) { try { await reportCloseMonths(s); } catch (e) { console.error('[shop] closing months:', e); } }
  const today = cairoDay();
  let days: number, startDay: string, endDay: string;
  if (period === 'days') {
    days = Math.max(7, Math.min(365, phpInt(q.get('days') ?? 30)));
    startDay = addDays(today, -(days - 1)); endDay = addDays(today, 1);
  } else {
    startDay = cairoMonth() + '-01';
    if (period === 'last') startDay = addMonths(cairoMonth(), -1) + '-01';
    endDay = addMonths(startDay.slice(0, 7), 1) + '-01';
    const tomorrow = addDays(today, 1);
    days = dayDiff(startDay, endDay < tomorrow ? endDay : tomorrow);
  }
  const fromUtc = utcStamp(cairoMidnight(startDay)), toUtc = utcStamp(cairoMidnight(endDay));
  const own = hasPerm(u, 'own_orders');
  const money = revenue || own;
  const scope = own ? ' AND rep_id = ' + phpInt(u.id) : '';
  const valid = "status NOT IN ('Cancelled','Returned','Awaiting payment')";
  const k = (await first(s, `SELECT COUNT(*) n, COALESCE(SUM(total),0) revenue FROM orders WHERE ${valid} AND created_at >= ? AND created_at < ?${scope}`, fromUtc, toUtc))!;
  const byDay = new Map<string, Row>();
  for (const r of await all(s, `SELECT created_at, total FROM orders WHERE ${valid} AND created_at >= ? AND created_at < ?${scope}`, fromUtc, toUtc)) {
    const d = cairoDay(parseUtc(String(r.created_at)));
    const x = byDay.get(d) ?? { n: 0, revenue: 0 }; x.n++; x.revenue += num(r.total); byDay.set(d, x);
  }
  const series: Row[] = [];
  for (let d = startDay; d < endDay && series.length < days; d = addDays(d, 1)) series.push({ date: d, orders: byDay.get(d)?.n ?? 0, revenue: byDay.get(d)?.revenue ?? 0 });
  const status: Record<string, number> = {};
  for (const r of await all(s, 'SELECT status, COUNT(*) n FROM orders WHERE 1' + scope + ' GROUP BY status')) status[r.status] = phpInt(r.n);
  const top = new Map<string, Row>();
  for (const o of await all(s, `SELECT items FROM orders WHERE ${valid} AND created_at >= ? AND created_at < ?${scope}`, fromUtc, toUtc)) {
    for (const it of jsonList(o.items) as Row[]) {
      const key = String(it.id);
      if (!top.has(key)) top.set(key, { name: it.name, qty: 0, revenue: 0 });
      const t = top.get(key)!; t.qty += it.qty; t.revenue += it.total ?? it.qty * it.price;
    }
  }
  let topList = [...top.values()].sort((a, b) => b.revenue - a.revenue);
  let sources = await all(s, `SELECT COALESCE(source, 'Website') AS source, COUNT(*) n, COALESCE(SUM(total),0) revenue FROM orders WHERE ${valid} AND created_at >= ? AND created_at < ?${scope} GROUP BY 1 ORDER BY revenue DESC`, fromUtc, toUtc);
  let lowStock: Row[] = [];
  if (!own && !ordersOnly) {
    for (const p of await all(s, "SELECT id, name, stock, variants FROM products WHERE status = 'Active' AND cat != 'services'")) {
      const vs = jsonList(p.variants);
      const arr = Array.isArray(vs) ? vs : Object.values(vs);
      if (arr.length) { for (const v of arr as Row[]) if (phpInt(v.stock) <= 5) lowStock.push({ id: p.id, name: p.name + ' — ' + v.label, stock: phpInt(v.stock) }); }
      else if (phpInt(p.stock) <= 5) lowStock.push({ id: p.id, name: p.name, stock: phpInt(p.stock) });
    }
    lowStock.sort((a, b) => a.stock - b.stock);
  }
  const recent: Row[] = [];
  for (const o of await all(s, "SELECT o.*, u.name AS rep_name FROM orders o LEFT JOIN users u ON u.id = o.rep_id WHERE o.status != 'Awaiting payment'" + scope.replace('rep_id', 'o.rep_id') + ' ORDER BY o.id DESC LIMIT 6')) recent.push(await orderOut(s, o));
  const month = cairoMonth();
  let followUps: Row[] = [];
  if (hasPerm(u, 'leads')) {
    followUps = await all(s, `SELECT l.id, l.name, l.contact, l.cat, l.notes, l.status, l.follow_up, u.name AS assigned_name FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.follow_up IS NOT NULL AND l.follow_up <= ? AND l.status NOT IN ('Won','Lost')` + (own ? ' AND (l.assigned_to = ' + phpInt(u.id) + ' OR l.assigned_to IS NULL)' : '') + `
      ORDER BY l.follow_up, l.id LIMIT 12`, today);
  }
  const lastBackup = hasPerm(u, 'backups') ? (await backupList(s))[0] ?? null : null;
  let openQuotes: Row | null = null;
  if (hasPerm(u, 'sell') && !ordersOnly) {
    const oq = (await first(s, "SELECT COUNT(*) n, COALESCE(SUM(total), 0) v FROM quotes WHERE status IN ('Draft','Sent') AND (valid_until IS NULL OR valid_until >= ?)" + scope.replace('rep_id', 'quotes.rep_id'), today))!;
    openQuotes = { n: phpInt(oq.n), value: round(num(oq.v)) };
  }
  const collect = (await first(s, `SELECT COALESCE(SUM(MAX(o.total - (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.order_id = o.id), 0)), 0) due,
      SUM(CASE WHEN o.total - (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.order_id = o.id) > 0.5 THEN 1 ELSE 0 END) n
      FROM orders o WHERE o.status NOT IN ('Cancelled','Returned','Awaiting payment')` + scope.replace('rep_id', 'o.rep_id')))!;
  let profit: Row | null = null;
  if (revenue) {
    const costs = new Map<string, number>(); for (const p of await all(s, 'SELECT id, cost FROM products')) costs.set(String(p.id), num(p.cost));
    let rev = 0, cost = 0, covered = 0;
    for (const o of await all(s, `SELECT items, discount FROM orders WHERE ${valid} AND created_at >= ? AND created_at < ?`, fromUtc, toUtc)) {
      for (const it of jsonList(o.items) as Row[]) {
        const lineTotal = phpFloat(it.total ?? it.qty * it.price);
        const unitCost = it.cost !== undefined && it.cost !== null ? phpFloat(it.cost) : costs.get(String(it.id ?? '')) ?? 0;
        if (unitCost > 0) { rev += lineTotal; cost += unitCost * phpInt(it.qty); }
        covered += lineTotal;
      }
    }
    if (cost > 0) profit = { revenue: round(rev), cost: round(cost), profit: round(rev - cost), margin: rev > 0 ? round((rev - cost) / rev * 100) : 0, coverage: covered > 0 ? round(rev / covered * 100) : 0 };
  }
  let leadSources: Row[] = [];
  if (hasPerm(u, 'leads')) {
    leadSources = (await all(s, `SELECT CASE WHEN source LIKE 'Order %' THEN 'Orders (customers)' WHEN source LIKE 'Shop%' THEN 'Quote form' WHEN source = '' THEN 'Other' ELSE source END AS src,
      COUNT(*) n, SUM(status = 'Won') won FROM leads WHERE created_at >= ? AND created_at < ? GROUP BY src ORDER BY n DESC`, fromUtc, toUtc)).map((r) => ({ source: r.src, n: phpInt(r.n), won: phpInt(r.won) }));
  }
  const perf = await teamPerformance(s, month, own ? phpInt(u.id) : null);
  let myCommission: Row | null = null;
  if (own) {
    for (const m of (await teamCommissions(s, month)).members) {
      if (m.id !== phpInt(u.id) || !m.pct) continue;
      myCommission = { pct: m.pct, commission: m.commission, base: m.base, delivered: m.delivered, pending: round(m.openValue * m.pct / 100, 2), open: m.open };
    }
  }
  if (!money) {
    k.revenue = null;
    for (const x of series) delete x.revenue;
    for (const x of topList) delete x.revenue;
    topList.sort((a, b) => b.qty - a.qty);
    sources = sources.map(({ revenue: _r, ...rest }) => rest);
    if (openQuotes) delete openQuotes.value;
    perf.members = perf.members.map(({ revenue: _a, revenue_target: _b, ...rest }: Row) => rest);
  }
  const lastDayIncl = addDays(endDay, -1);
  const spent = revenue ? await expensesSince(s, startDay, lastDayIncl) : null;
  let newDevices: Row[] = [];
  if (hasPerm(u, 'team')) {
    newDevices = await all(s, `SELECT l.at, l.city, l.isp, l.user_id, u.name, d.label FROM user_logins l JOIN users u ON u.id = l.user_id LEFT JOIN user_devices d ON d.id = l.device_id
      WHERE l.new_device = 1 AND l.at >= datetime('now', '-7 days') ORDER BY l.id DESC LIMIT 8`);
  }
  const counts = await s.db.batch([s.db.prepare("SELECT COUNT(*) AS n FROM leads WHERE status = 'New'"), s.db.prepare("SELECT COUNT(*) AS n FROM products WHERE status = 'Active'")]);
  return {
    days, period, from: startDay, to: lastDayIncl < today ? lastDayIncl : today,
    reportReady: revenue && cairoDayOfMonth() <= 7 ? addMonths(cairoMonth(), -1) : null,
    own, money, spent, newDevices, followUps, lastBackup,
    toCollect: money ? { amount: round(num(collect.due)), orders: phpInt(collect.n) } : null, profit, leadSources,
    openQuotes, myCommission,
    kpi: {
      revenue: money ? num(k.revenue) : null, orders: phpInt(k.n),
      aov: money && phpInt(k.n) ? round(num(k.revenue) / phpInt(k.n)) : null,
      shipped: status.Shipped ?? 0, delivered: status.Delivered ?? 0, lost: (status.Cancelled ?? 0) + (status.Returned ?? 0), pending: status.Pending ?? 0,
      newLeads: phpInt((counts[0].results[0] as Row).n), products: phpInt((counts[1].results[0] as Row).n),
    },
    series, statusCounts: assoc(status), topProducts: topList.slice(0, 5), sources,
    abandoned: revenue || hasPerm(u, 'leads') ? await abandonedStats(s, fromUtc, toUtc) : null,
    lowStock, recentOrders: recent, performance: perf,
  };
};

// Backups: Cloudflare D1 keeps every change for 30 days (Time Travel), so there are no backup files to list.
export async function backupList(_s: Shop): Promise<Row[]> { return []; }

// ---------- targets & commissions ----------
H.targets = async ({ s, q }) => { await requirePerm(s, 'targets'); return teamPerformance(s, q.get('month') ?? ''); };
H.targets_save = async ({ s, body }) => {
  const u = await requirePerm(s, 'targets');
  const b = await body();
  const month = (await import('../lib/time')).cairoMonthBounds(phpStr(b.month ?? ''))[0];
  const list = Array.isArray(b.targets) ? b.targets : b.targets && typeof b.targets === 'object' ? Object.values(b.targets) : [];
  const stmts = list.map((t: Row) => s.db.prepare(`INSERT INTO targets (user_id, month, orders_target, revenue_target) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, month) DO UPDATE SET orders_target = excluded.orders_target, revenue_target = excluded.revenue_target`)
    .bind(phpInt(t?.user_id ?? 0), month, Math.max(0, phpInt(t?.orders ?? 0)), Math.max(0, phpFloat(t?.revenue ?? 0))));
  if (stmts.length) await s.db.batch(stmts);
  await logActivity(s, u, 'Updated targets', month);
  return { ok: true };
};
H.commissions = async ({ s, q }) => { await requirePerm(s, 'targets'); await requirePerm(s, 'revenue'); return teamCommissions(s, q.get('month') ?? ''); };
H.commission_rate = async ({ s, body }) => {
  const u = await requirePerm(s, 'targets'); await requirePerm(s, 'revenue');
  const b = await body();
  const month = (await import('../lib/time')).cairoMonthBounds(phpStr(b.month ?? ''))[0];
  const uid = phpInt(b.user_id ?? 0);
  const n = await first(s, 'SELECT name FROM users WHERE id = ?', uid);
  if (!n) fail('Team member not found.', 404);
  if ('pct' in b) {
    const pct = Math.max(0, Math.min(100, round(phpFloat(b.pct), 2)));
    await s.db.prepare('INSERT INTO targets (user_id, month, commission_pct) VALUES (?, ?, ?) ON CONFLICT(user_id, month) DO UPDATE SET commission_pct = excluded.commission_pct').bind(uid, month, pct).run();
    await logActivity(s, u, 'Set commission rate', n!.name + ' · ' + pct + '% from ' + month);
  }
  if ('salary' in b) {
    const salary = Math.max(0, Math.min(10000000, round(phpFloat(b.salary), 2)));
    await s.db.prepare('INSERT INTO targets (user_id, month, salary) VALUES (?, ?, ?) ON CONFLICT(user_id, month) DO UPDATE SET salary = excluded.salary').bind(uid, month, salary).run();
    await logActivity(s, u, 'Set salary', n!.name + ' · EGP ' + salary + ' from ' + month);
  }
  return teamCommissions(s, month);
};

// ---------- expenses & suppliers ----------
H.expenses = async ({ s, q }) => { await requirePerm(s, 'revenue'); return expensesReport(s, q.get('month') ?? ''); };
H.expense_save = async ({ s, body }) => {
  const u = await requirePerm(s, 'revenue');
  const b = await body();
  const id = phpInt(b.id ?? 0);
  const amount = round(phpFloat(b.amount ?? 0), 2);
  if (amount <= 0 || amount > 10000000) fail('Enter the amount paid.');
  const category = strIn(b.category, 60);
  if (category === '') fail('Choose what the money was for.');
  const supplierId = phpInt(b.supplier_id ?? 0) || null;
  if (supplierId && !(await first(s, 'SELECT id FROM suppliers WHERE id = ?', supplierId))) fail('Supplier not found.');
  const vals = [expenseDay(b.on ?? ''), category, amount, strIn(b.note, 300), supplierId, await expenseOrderId(s, b.order ?? '')];
  if (id) await s.db.prepare('UPDATE expenses SET spent_on = ?, category = ?, amount = ?, note = ?, supplier_id = ?, order_id = ? WHERE id = ?').bind(...vals, id).run();
  else {
    const stmts = [s.db.prepare('INSERT INTO expenses (spent_on, category, amount, note, supplier_id, order_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(...vals, phpInt(u.id))];
    const paidNow = round(phpFloat(b.paid_now ?? 0), 2);
    if (supplierId && paidNow > 0) stmts.push(s.db.prepare('INSERT INTO supplier_payments (supplier_id, amount, paid_on, note, created_by) VALUES (?, ?, ?, ?, ?)')
      .bind(supplierId, Math.min(paidNow, amount), vals[0], 'Paid with the bill', phpInt(u.id)));
    await s.db.batch(stmts);
  }
  await logActivity(s, u, id ? 'Edited an expense' : 'Added an expense', category + ' · EGP ' + amount);
  return { ok: true };
};
H.expense_delete = async ({ s, body }) => {
  const u = await requirePerm(s, 'revenue');
  const id = phpInt((await body()).id ?? 0);
  const e = await first(s, 'SELECT category, amount FROM expenses WHERE id = ?', id);
  if (!e) fail('Expense not found.', 404);
  await s.db.prepare('DELETE FROM expenses WHERE id = ?').bind(id).run();
  await logActivity(s, u, 'Deleted an expense', e!.category + ' · EGP ' + num(e!.amount));
  return { ok: true };
};
H.supplier_save = async ({ s, body }) => {
  const u = await requirePerm(s, 'revenue');
  const b = await body();
  const id = phpInt(b.id ?? 0);
  const name = strIn(b.name, 80);
  if (name === '') fail('Enter the supplier’s name.');
  const empty = (v: unknown) => !v || v === '0';
  const vals = [name, strIn(b.phone, 40), strIn(b.makes, 120), strIn(b.notes, 500), empty(b.active) && id ? 0 : 1];
  if (id) await s.db.prepare('UPDATE suppliers SET name = ?, phone = ?, makes = ?, notes = ?, active = ? WHERE id = ?').bind(...vals, id).run();
  else await s.db.prepare('INSERT INTO suppliers (name, phone, makes, notes, active) VALUES (?, ?, ?, ?, ?)').bind(...vals).run();
  const logged = await logActivity(s, u, id ? 'Edited a supplier' : 'Added a supplier', name);
  // As in PHP: a new supplier's "id" is read after the activity log line was written, so it is that line's id.
  return { ok: true, id: id || Number(logged.meta.last_row_id) };
};
H.supplier_pay = async ({ s, body }) => {
  const u = await requirePerm(s, 'revenue');
  const b = await body();
  const sid = phpInt(b.supplier_id ?? 0);
  const amount = round(phpFloat(b.amount ?? 0), 2);
  if (amount <= 0 || amount > 10000000) fail('Enter the amount paid.');
  const n = await first(s, 'SELECT name FROM suppliers WHERE id = ?', sid);
  if (!n) fail('Supplier not found.', 404);
  await s.db.prepare('INSERT INTO supplier_payments (supplier_id, amount, paid_on, note, created_by) VALUES (?, ?, ?, ?, ?)').bind(sid, amount, expenseDay(b.on ?? ''), strIn(b.note, 300), phpInt(u.id)).run();
  await logActivity(s, u, 'Paid a supplier', n!.name + ' · EGP ' + amount);
  return supplierStatement(s, sid);
};
H.supplier_payment_delete = async ({ s, body }) => {
  const u = await requirePerm(s, 'revenue');
  const id = phpInt((await body()).id ?? 0);
  const p = await first(s, 'SELECT supplier_id, amount FROM supplier_payments WHERE id = ?', id);
  if (!p) fail('Payment not found.', 404);
  await s.db.prepare('DELETE FROM supplier_payments WHERE id = ?').bind(id).run();
  await logActivity(s, u, 'Deleted a supplier payment', 'EGP ' + num(p!.amount));
  return supplierStatement(s, phpInt(p!.supplier_id));
};
H.supplier_statement = async ({ s, q }) => { await requirePerm(s, 'revenue'); return supplierStatement(s, phpInt(q.get('id') ?? 0)); };

// ---------- team-entered orders ----------
H.order_catalog = async ({ s }) => {
  await requirePerm(s, 'sell');
  const rows = (await loadProducts(s.db, true)).map((p) => ({ id: p.id, name: p.name, nameAr: p.nameAr, brandId: p.brandId, cat: p.cat,
    price: p.discountPct ? round(p.price * (1 - p.discountPct / 100), 2) : p.price, discountPct: p.discountPct, stock: p.stock, image: p.images[0] ?? '', sub: p.sub,
    variants: (p.variants as Row[]).map(({ sku, brandPrice, brandOwn, ...v }) => v), tiers: p.tiers, addons: p.addons, personalized: p.personalized, fromPrice: p.fromPrice }));
  const reps = await all(s, 'SELECT id, name, role FROM users WHERE active = 1 ORDER BY name');
  const brandNames: Record<string, string> = {};
  for (const br of await loadBrands(s.db, false)) brandNames[br.id] = br.name;
  const payments: Record<string, string> = {};
  for (const [k, v] of Object.entries(PAYMENT_METHODS)) if (!k.startsWith('paymob')) payments[k] = v;
  return { products: rows, sources: ORDER_SOURCES, payments, reps, brands: brandNames, shippingFee: SHOP.shipping_fee, freeShippingThreshold: SHOP.free_shipping_threshold };
};

H.customer_lookup = async ({ s, q }) => {
  const u = await requirePerm(s, 'sell');
  const qq = phpTrim(strIn(q.get('q') ?? '', 80));
  const digits = qq.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\D/g, '');
  if (mbLen(qq) < 2 || (digits !== '' && digits.length < 3 && !/\p{L}/u.test(qq))) return { results: [] };
  const own = hasPerm(u, 'own_orders');
  const byPhone = digits.length >= 3, fullPhone = digits.length >= 10;
  const like = '%' + (byPhone ? digits.slice(-Math.min(8, digits.length)) : qq) + '%';
  const phoneCol = (c: string) => `REPLACE(REPLACE(REPLACE(${c}, ' ', ''), '-', ''), '+', '') LIKE ?`;
  const outM = new Map<string, Row>();
  for (const r of await all(s, "SELECT customer, phone, email, address, city, district, city_id, district_id, created_at FROM orders WHERE status != 'Awaiting payment' AND "
    + (byPhone ? phoneCol('phone') : 'customer LIKE ?') + (own && !fullPhone ? ' AND rep_id = ' + phpInt(u.id) : '') + ' ORDER BY id DESC LIMIT 60', like)) {
    const k = phoneKey(String(r.phone ?? '')) || String(r.customer).toLowerCase();
    if (!outM.has(k)) outM.set(k, { name: r.customer, phone: r.phone, email: r.email, address: r.address, city: r.city, district: r.district, cityId: r.city_id, districtId: r.district_id, last: r.created_at, orders: 0, from: 'order' });
    outM.get(k)!.orders++;
  }
  const accts = byPhone ? await all(s, 'SELECT name, phone, email, address, city, district, city_id, district_id, created_at FROM customers WHERE ' + phoneCol('phone') + ' LIMIT 10', like)
    : await all(s, 'SELECT name, phone, email, address, city, district, city_id, district_id, created_at FROM customers WHERE (name LIKE ? OR email LIKE ?) LIMIT 10', like, like);
  for (const r of accts) {
    const k = phoneKey(String(r.phone ?? '')) || String(r.email ?? '').toLowerCase();
    if (outM.has(k)) { const x = outM.get(k)!; x.account = true; if (!x.email) x.email = r.email; continue; }
    if (own && !fullPhone) continue;
    outM.set(k, { name: r.name || r.email, phone: r.phone, email: r.email, address: r.address, city: r.city, district: r.district, cityId: r.city_id, districtId: r.district_id, last: r.created_at, orders: 0, from: 'account', account: true });
  }
  if (!hasPerm(u, 'orders_only')) {
    for (const r of await all(s, 'SELECT customer, phone, email, address, city, district, city_id, district_id, created_at FROM quotes WHERE '
      + (byPhone ? phoneCol('phone') : 'customer LIKE ?') + (own && !fullPhone ? ' AND (rep_id = ' + phpInt(u.id) + ' OR created_by = ' + phpInt(u.id) + ')' : '') + ' ORDER BY id DESC LIMIT 20', like)) {
      const k = phoneKey(String(r.phone ?? '')) || String(r.customer).toLowerCase();
      if (outM.has(k)) continue;
      outM.set(k, { name: r.customer, phone: r.phone, email: r.email, address: r.address, city: r.city, district: r.district, cityId: r.city_id, districtId: r.district_id, last: r.created_at, orders: 0, from: 'quote' });
    }
  }
  if (hasPerm(u, 'leads') && outM.size < 6) {
    for (const r of await all(s, 'SELECT name, contact, created_at FROM leads WHERE ' + (byPhone ? "REPLACE(REPLACE(contact, ' ', ''), '-', '') LIKE ?" : 'name LIKE ?')
      + (own && !fullPhone ? ' AND (assigned_to = ' + phpInt(u.id) + ' OR assigned_to IS NULL)' : '') + ' ORDER BY id DESC LIMIT 10', like)) {
      const ph = phoneKey(String(r.contact ?? ''));
      const k = ph || String(r.name).toLowerCase();
      if (outM.has(k)) continue;
      const m = String(r.contact ?? '').match(/(\+?\d[\d\t\n\x0B\f\r -]{8,16}\d)/);
      outM.set(k, { name: r.name, phone: m?.[1] ?? '', email: emailKey(String(r.contact ?? '')) || '', address: '', city: '', district: '', cityId: null, districtId: null, last: r.created_at, orders: 0, from: 'lead' });
    }
  }
  return { results: [...outM.values()].slice(0, 6) };
};

H.order_create = async ({ s, body }) => {
  const u = await requirePerm(s, 'sell');
  const b = await body();
  let repId: number | null = phpInt(u.id);
  if (hasPerm(u, 'targets') && b.rep_id !== undefined && b.rep_id !== null) repId = phpInt(b.rep_id) || null;
  const r: Row = await createOrder(s, b, { by_team: true, rep_id: repId, created_by: phpInt(u.id), source: b.source ?? 'Phone', payment: b.payment ?? 'cod', status: b.status ?? 'Pending',
    discount: b.discount ?? 0, shipping: b.shipping ?? null, notes: b.notes ?? '', paid_now: b.paid_now ?? '', deposit_method: b.deposit_method ?? 'cash' });
  await logActivity(s, u, 'Created order', r.number + ' · ' + strIn(b.name, 120) + ' · EGP ' + numberFormat(r.total) + ' · ' + (b.source ?? 'Phone'));
  if (b.quote_id && b.quote_id !== '0') {
    await s.db.prepare("UPDATE quotes SET status = 'Accepted', order_id = ?, updated_at = datetime('now') WHERE id = ? AND order_id IS NULL").bind(r.id, phpInt(b.quote_id)).run();
    if (!b.lead_id || b.lead_id === '0') { const lid = (await first(s, 'SELECT lead_id FROM quotes WHERE id = ?', phpInt(b.quote_id)))?.lead_id; if (lid) b.lead_id = phpInt(lid); }
  }
  const prep = strIn(b.prep_notes, 500);
  if (prep !== '') await s.db.prepare('UPDATE orders SET prep_notes = ? WHERE id = ?').bind(prep, r.id).run();
  try { r.lead = await leadFromOrder(s, b, r as any, repId, ORDER_SOURCES.includes(b.source ?? '') ? b.source : 'Phone'); }
  catch (e) { await opsError(s, 'Leads', 'An order was saved but its lead wasn’t', e); }
  return r;
};

// ---------- products & categories ----------
H.products = async ({ s, ctx }) => {
  await requirePerm(s, 'products');
  const cats = await all(s, 'SELECT key, label, descr, label_ar, descr_ar, sort, (SELECT COUNT(*) FROM products p WHERE p.cat = c.key) AS count FROM categories c ORDER BY sort, label');
  const en = await seoLookups(ctx, false), ar = await seoLookups(ctx, true);
  const products = (await loadProducts(s.db, false)).map((p) => {
    const bare = { ...p, seoTitle: p.seoTitle, seoTitleAr: p.seoTitleAr, seoDesc: p.seoDesc, seoDescAr: p.seoDescAr };
    Object.assign(bare, { seoTitle: '', seoTitleAr: '', seoDesc: '', seoDescAr: '' });
    const e = seoItem(ctx, bare, false, ...en), a = seoItem(ctx, bare, true, ...ar);
    return { ...p, seoAuto: { en: [e.seoTitle, e.seoDesc], ar: [a.seoTitle, a.seoDesc], url: e.url } };
  });
  return { products, categories: cats, brands: await loadBrands(s.db, false, true) };
};

H.product_save = async ({ s, body }) => {
  const u = await requirePerm(s, 'products');
  const b = await body();
  let id = strIn(b.id, 40);
  const isNew = id === '';
  if (isNew) id = 'p' + nowUnix().toString(36) + randomHex(2);
  const name = strIn(b.name, 160), cat = strIn(b.cat, 40);
  if (name === '') fail('Product name is required.');
  if (!(await first(s, 'SELECT 1 AS x FROM categories WHERE key = ?', cat))) fail('Pick a category.');
  let variants = cleanVariants(b.variants ?? []);
  const tiers = variants.length ? [] : cleanTiers(b.tiers ?? []);
  const addons = cleanAddons(b.addons ?? []);
  let price = phpFloat(b.price ?? 0);
  const brandRow = b.brandId && b.brandId !== '0' ? await brandGet(s, phpInt(b.brandId)) : null;
  const brandId = brandRow ? phpInt(b.brandId) : null;
  const brandPrice = brandId ? Math.max(0, round(phpFloat(b.brandPrice ?? 0), 2)) : 0;
  const marginPct = brandId && b.marginPct !== undefined && b.marginPct !== '' && b.marginPct !== null ? Math.max(0, Math.min(500, phpFloat(b.marginPct))) : null;
  if (brandPrice > 0) price = brandSellPrice(brandPrice, marginPct ?? phpFloat(brandRow!.margin));
  if (price <= 0) {
    const c: number[] = [];
    for (const v of variants) { for (const t of v.tiers) c.push(t.price); if (v.price > 0) c.push(v.price); }
    for (const t of tiers) c.push(t.price);
    price = c.length ? Math.min(...c) : 0;
  }
  if (price <= 0) fail('Enter a price, or add sizes / quantity prices.');
  variants = applySizePrices(price, variants, brandPrice);
  for (const v of variants) if (!v.tiers.length && v.price <= 0) v.price = price;
  const stock = variants.length ? variants.reduce((a, v) => a + v.stock, 0) : Math.max(0, phpInt(b.stock ?? 0));
  const feats = (Array.isArray(b.features) ? b.features : b.features && typeof b.features === 'object' ? Object.values(b.features) : b.features ? [b.features] : []).map((f: unknown) => strIn(f, 160)).filter((f: string) => f !== '' && f !== '0');
  const v: Row = {
    sku: strIn(b.sku, 40), name, cat, vendor: strIn(b.vendor, 80), price, cost: Math.max(0, phpFloat(b.cost ?? 0)), stock, discount_pct: Math.max(0, Math.min(90, phpFloat(b.discountPct ?? 0))),
    label: strIn(b.label, 30), status: ['Active', 'Draft', 'Archived'].includes(b.status) ? b.status : 'Draft', sub: strIn(b.sub, 160), descr: strIn(b.desc, 4000),
    features: phpJsonU(feats), period: cat === 'services' ? 'month' : '', variants: phpJsonU(variants), tiers: phpJsonPlain(tiers), addons: phpJsonU(addons),
    personalized: !b.personalized || b.personalized === '0' ? 0 : 1, name_ar: strIn(b.nameAr, 160), sub_ar: strIn(b.subAr, 160), desc_ar: strIn(b.descAr, 4000),
    brand_id: brandId, brand_price: brandPrice, margin_pct: marginPct,
    seo_title: strIn(b.seoTitle, 120), seo_title_ar: strIn(b.seoTitleAr, 120), seo_desc: strIn(b.seoDesc, 320), seo_desc_ar: strIn(b.seoDescAr, 320),
  };
  const cols = Object.keys(v);
  if (isNew) {
    const sort = phpInt((await first(s, 'SELECT COALESCE(MAX(sort),0)+1 AS n FROM products'))?.n);
    await s.db.prepare('INSERT INTO products (id, ' + cols.join(', ') + ', sort) VALUES (?, ' + cols.map(() => '?').join(', ') + ', ?)').bind(id, ...cols.map((c) => v[c]), sort).run();
  } else {
    const r = await s.db.prepare('UPDATE products SET ' + cols.map((c) => c + ' = ?').join(', ') + ", updated_at = datetime('now') WHERE id = ?").bind(...cols.map((c) => v[c]), id).run();
    if (!r.meta.changes) fail('Product not found.', 404);
  }
  await logActivity(s, u, isNew ? 'Added product' : 'Updated product', name);
  return { id };
};

// ---------- reports & reviews ----------
H.reports = async ({ s }) => {
  await requirePerm(s, 'revenue');
  try { await reportCloseMonths(s); } catch (e) { console.error('[shop] closing months:', e); }
  const rows: Row[] = [];
  for (const m of await reportMonths(s)) {
    const r = await monthReport(s, m);
    rows.push({ month: m, current: r.current, daysSoFar: r.daysSoFar, days: r.days, orders: r.sales.orders, sales: r.sales.value, delivered: r.delivered.value, collected: r.collected.value,
      expenses: r.expenses.value, gross: r.profit.gross, net: r.profit.net, customers: r.customers.total, newCustomers: r.customers.new });
  }
  return { months: rows };
};
H.report_month = async ({ s, q }) => {
  await requirePerm(s, 'revenue');
  const m = /^\d{4}-\d{2}$/.test(q.get('month') ?? '') ? q.get('month')! : cairoMonth();
  const now = await monthReport(s, m);
  const prev = await monthReport(s, addMonths(m, -1));
  const snap = await reportSnapshot(s, m);
  return { report: now, previous: { sales: prev.sales, collected: prev.collected, expenses: prev.expenses, profit: prev.profit, delivered: prev.delivered },
    saved: snap ? { at: snap.savedAt, changes: reportChanges(snap.data, now) } : null };
};
H.reviews_list = async ({ s }) => {
  await requirePerm(s, 'products');
  const rows = await all(s, 'SELECT r.*, c.email, p.name AS product_name FROM product_reviews r LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN products p ON p.id = r.product_id ORDER BY r.id DESC LIMIT 300');
  return { reviews: rows.map((r) => ({ id: phpInt(r.id), product: r.product_name || r.product_id, productId: r.product_id, name: r.name, email: r.email, rating: phpInt(r.rating),
    text: r.text, status: r.status, order: r.order_id ? orderNumber(phpInt(r.order_id)) : '', at: r.created_at })) };
};
H.review_set = async ({ s, body }) => {
  const u = await requirePerm(s, 'products');
  const b = await body();
  const pid = (await first(s, 'SELECT product_id FROM product_reviews WHERE id = ?', phpInt(b.id ?? 0)))?.product_id;
  if (!pid) fail('Review not found.', 404);
  const truthy = (v: unknown) => !!v && v !== '0';
  if (truthy(b.delete)) { await s.db.prepare('DELETE FROM product_reviews WHERE id = ?').bind(phpInt(b.id)).run(); await logActivity(s, u, 'Deleted a product review', String(pid)); }
  else { await s.db.prepare('UPDATE product_reviews SET status = ? WHERE id = ?').bind(truthy(b.hidden) ? 'hidden' : 'published', phpInt(b.id)).run(); await logActivity(s, u, truthy(b.hidden) ? 'Hid a product review' : 'Showed a product review', String(pid)); }
  return { ok: true };
};

H.product_delete = async ({ s, body }) => {
  const u = await requirePerm(s, 'products');
  const id = strIn((await body()).id, 40);
  const p = await first(s, 'SELECT name FROM products WHERE id = ?', id);
  if (!p || !p.name) fail('Product not found.', 404);
  // (Its photo files go with the photo storage port; the rows go with the product.)
  await s.db.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
  await logActivity(s, u, 'Deleted product', String(p!.name));
  return { ok: true };
};
H.image_order = async ({ s, body }) => {
  await requirePerm(s, 'products');
  const raw = (await body()).ids;
  const ids = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((x: unknown) => phpInt(x));
  if (ids.length) await s.db.batch(ids.map((id: number, i: number) => s.db.prepare('UPDATE product_images SET sort = ? WHERE id = ?').bind(i, id)));
  return { ok: true };
};
H.category_save = async ({ s, body }) => {
  const u = await requirePerm(s, 'products');
  const b = await body();
  const label = strIn(b.label, 60);
  if (label === '') fail('Category name is required.');
  let key = strIn(b.key, 40);
  if (key === '') {
    key = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cat';
    if (await first(s, 'SELECT 1 AS x FROM categories WHERE key = ?', key)) key += '-' + randomHex(2);
    await s.db.prepare('INSERT INTO categories (key, label, descr, sort, label_ar, descr_ar) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(key, label, strIn(b.descr, 200), phpInt(b.sort ?? 50), strIn(b.label_ar, 60), strIn(b.descr_ar, 200)).run();
  } else {
    await s.db.prepare('UPDATE categories SET label = ?, descr = ?, sort = ?, label_ar = ?, descr_ar = ? WHERE key = ?')
      .bind(label, strIn(b.descr, 200), phpInt(b.sort ?? 50), strIn(b.label_ar, 60), strIn(b.descr_ar, 200), key).run();
  }
  await logActivity(s, u, 'Saved category', label);
  return { key };
};
H.category_delete = async ({ s, body }) => {
  const u = await requirePerm(s, 'products');
  const key = strIn((await body()).key, 40);
  if (key === 'services') fail('The Marketing Plans category is used by the plans section and cannot be deleted.');
  if (num((await first(s, 'SELECT COUNT(*) AS n FROM products WHERE cat = ?', key))?.n) > 0) fail('Move or delete the products in this category first.');
  await s.db.prepare('DELETE FROM categories WHERE key = ?').bind(key).run();
  await logActivity(s, u, 'Deleted category', key);
  return { ok: true };
};

registerOrders(H, orderOut);
registerBrands(H);
registerTeam(H);

// ---------- the endpoint ----------
export async function handleAdmin(request: Request, env: Env, url: URL, ctx: Ctx, ec: ExecutionContext): Promise<Response> {
  const s = makeShop(request, env, ec);
  const action = url.searchParams.get('action') ?? '';
  const a: A = { s, q: url.searchParams, method: request.method, action, body: () => readBody(s), ctx };
  let res: Response;
  try {
    if (['dashboard', 'orders'].includes(action)) await expireUnpaidOrders(s);
    if (/^(quote|customer|search)/.test(action) && !['session', 'customer_lookup'].includes(action)) {
      const cu = await currentUser(s);
      if (cu && hasPerm(cu, 'orders_only')) fail('This isn’t available for your role.', 403);
    }
    const h = H[action];
    if (!h) {
      // The WhatsApp inbox, Telegram, bot and insights come with the messaging port; files with photo storage.
      if (/^(wa_|tg_|sm_|bot_|ai_|ou_|au_|insights)|^(image_|order_file_|brand_logo|backup_download)/.test(action)) {
        res = jsonOut(s, { error: 'Not available on the test shop yet', path: '/api/admin.php', action }, 501);
      } else res = jsonOut(s, { error: 'Not found' }, 404);
    } else {
      const out = await h(a);
      res = out instanceof Response ? out : jsonOut(s, out, 200);
    }
  } catch (e) {
    if (e instanceof AdminFail) res = jsonOut(s, { error: e.message }, e.code);
    else if (e instanceof ShopError) res = jsonOut(s, { error: e.message }, 502);
    else { await opsError(s, 'Server', 'Dashboard error (' + action + ')', e); res = jsonOut(s, { error: 'Something went wrong. Please try again.' }, 500); }
  }
  await saveSession(s);
  return res;
}
export function jsonOut(s: Shop, data: unknown, code = 200): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  for (const c of s.cookies) headers.append('Set-Cookie', c);
  return new Response(phpJson(data), { status: code, headers });
}
