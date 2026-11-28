// Money views of the dashboard: team targets and commissions (orders.php team_performance / team_commissions),
// expenses and suppliers (expenses.php) and monthly reports (reports.php). Maps keep PHP's key order.
import { round, phpInt, phpFloat, phpTrim, phpJson } from './php';
import { type Row } from './catalog';
import { type Shop, orderNumber, phoneKey, PAYMENT_METHODS } from './shop';
import { cairoMonthBounds, cairoMonth, cairoDay, cairoDayOfMonth, addMonths } from './time';
import { fail } from './team';

const num = (v: unknown) => Number(v ?? 0);
const ucfirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const daysInMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const lastDayOf = (ym: string) => ym + '-' + String(daysInMonth(ym)).padStart(2, '0');

// ---------- targets & commissions ----------
export async function teamPerformance(s: Shop, month: string, onlyUser: number | null = null): Promise<Row> {
  const [m, from, to] = cairoMonthBounds(month);
  const sql = `SELECT u.id, u.name, u.role, u.active,
      COALESCE(t.orders_target, 0) AS orders_target, COALESCE(t.revenue_target, 0) AS revenue_target,
      COUNT(o.id) AS orders,
      COALESCE(SUM(CASE WHEN o.status NOT IN ('Cancelled','Returned','Awaiting payment') THEN o.total END), 0) AS revenue,
      SUM(CASE WHEN o.status = 'Delivered' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN o.status IN ('Cancelled','Returned') THEN 1 ELSE 0 END) AS lost,
      MAX(o.created_at) AS last_order
    FROM users u
    LEFT JOIN targets t ON t.user_id = u.id AND t.month = ?1
    LEFT JOIN orders o ON o.rep_id = u.id AND o.created_at >= ?2 AND o.created_at < ?3 AND o.status != 'Awaiting payment'
    WHERE (u.active = 1 OR o.id IS NOT NULL)` + (onlyUser ? ' AND u.id = ?4' : '') + `
    GROUP BY u.id ORDER BY revenue DESC, u.name`;
  const st = onlyUser ? s.db.prepare(sql).bind(m, from, to, onlyUser) : s.db.prepare(sql).bind(m, from, to);
  const rows = (await st.all<Row>()).results.map((r) => {
    for (const k of ['id', 'orders', 'delivered', 'lost', 'orders_target', 'active']) r[k] = phpInt(r[k]);
    for (const k of ['revenue', 'revenue_target']) r[k] = phpFloat(r[k]);
    return r;
  });
  return { month: m, members: rows };
}

export async function teamCommissions(s: Shop, month: string): Promise<Row> {
  const [m, from, to] = cairoMonthBounds(month);
  const rates: Record<number, number> = {}, salaries: Record<number, number> = {};
  for (const r of (await s.db.prepare('SELECT user_id, commission_pct, salary FROM targets WHERE (commission_pct IS NOT NULL OR salary IS NOT NULL) AND month <= ? ORDER BY month').bind(m).all<Row>()).results) {
    if (r.commission_pct !== null) rates[phpInt(r.user_id)] = phpFloat(r.commission_pct);
    if (r.salary !== null) salaries[phpInt(r.user_id)] = phpFloat(r.salary);
  }
  const members = new Map<number, Row>();
  for (const u of (await s.db.prepare('SELECT id, name, role, active FROM users ORDER BY name').all<Row>()).results) {
    const id = phpInt(u.id);
    members.set(id, { id, name: u.name, role: u.role, active: phpInt(u.active), pct: rates[id] ?? 0, salary: salaries[id] ?? 0, sold: 0, soldValue: 0, delivered: 0, base: 0,
      returnedLater: 0, returnedBase: 0, open: 0, openValue: 0, lost: 0, commission: 0, orders: [] });
  }
  const net = (o: Row) => round(Math.max(0, num(o.total) - num(o.shipping)), 2);
  for (const o of (await s.db.prepare("SELECT rep_id, status, total, shipping FROM orders WHERE rep_id IS NOT NULL AND status != 'Awaiting payment' AND created_at >= ? AND created_at < ?").bind(from, to).all<Row>()).results) {
    const mm = members.get(phpInt(o.rep_id)); if (!mm) continue;
    if (['Cancelled', 'Returned'].includes(o.status)) mm.lost++; else { mm.sold++; mm.soldValue += net(o); }
  }
  for (const o of (await s.db.prepare("SELECT rep_id, total, shipping FROM orders WHERE rep_id IS NOT NULL AND status NOT IN ('Awaiting payment','Delivered','Cancelled','Returned')").all<Row>()).results) {
    const mm = members.get(phpInt(o.rep_id)); if (!mm) continue;
    mm.open++; mm.openValue += net(o);
  }
  const { results: del } = await s.db.prepare(`SELECT id, rep_id, customer, status, total, shipping, created_at, delivered_at, updated_at FROM orders
    WHERE rep_id IS NOT NULL AND delivered_at IS NOT NULL AND (
      (delivered_at >= ?1 AND delivered_at < ?2 AND (status = 'Delivered' OR (status IN ('Returned','Cancelled') AND updated_at >= ?2))) OR
      (status IN ('Returned','Cancelled') AND delivered_at < ?1 AND updated_at >= ?1 AND updated_at < ?2))
    ORDER BY delivered_at`).bind(from, to).all<Row>();
  for (const o of del) {
    const mm = members.get(phpInt(o.rep_id)); if (!mm) continue;
    const base = net(o);
    const back = o.status !== 'Delivered' && o.delivered_at < from;
    if (back) { mm.returnedLater++; mm.returnedBase += base; } else { mm.delivered++; mm.base += base; }
    mm.orders.push({ id: phpInt(o.id), number: orderNumber(phpInt(o.id)), customer: o.customer, status: o.status, createdAt: o.created_at, deliveredAt: o.delivered_at,
      returnedAt: back ? o.updated_at : null, returnedLater: !back && o.status !== 'Delivered' ? o.updated_at : null, total: num(o.total), shipping: num(o.shipping), base: back ? -base : base });
  }
  const totals: Row = { sold: 0, soldValue: 0, delivered: 0, base: 0, commission: 0, salary: 0, pay: 0 };
  const out: Row[] = [];
  for (const mm of members.values()) {
    mm.base = round(mm.base - mm.returnedBase, 2);
    mm.commission = round(mm.base * mm.pct / 100, 2);
    mm.pay = round(mm.salary + mm.commission, 2);
    for (const k of ['soldValue', 'openValue', 'returnedBase']) mm[k] = round(mm[k], 2);
    for (const x of mm.orders) x.commission = round(x.base * mm.pct / 100, 2);
    const sells = ['sales', 'telesales', 'staff'].includes(mm.role) && mm.active;
    if (!sells && !mm.sold && !mm.orders.length && !mm.open && !mm.pct && !mm.salary) continue;
    for (const k of ['sold', 'soldValue', 'delivered', 'base', 'commission', 'salary', 'pay']) totals[k] += mm[k];
    // Key order as in PHP: pay is added last.
    out.push(mm);
  }
  out.sort((a, b) => (b.pay - a.pay) || (b.soldValue - a.soldValue));
  return { month: m, members: out, totals };
}

// ---------- expenses & suppliers ----------
export const EXPENSE_CATEGORIES = ['Bosta shipping', 'Bosta extra fees', 'Packaging', 'Transport (Uber / inDrive)', 'Supplier / production', 'Ads', 'Other'];
export const SUPPLIER_CATEGORY = 'Supplier / production';

export function expenseDay(v: unknown): string {
  const s = String(v ?? '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); if (d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]) return s; }
  return cairoDay();
}
export async function expenseOrderId(s: Shop, v: unknown): Promise<number | null> {
  const t = phpTrim(String(v ?? ''));
  if (t === '') return null;
  const m = t.match(/(\d+)/);
  if (!m) fail('Order number not recognised — use the number like WTS-1015.');
  const n = phpInt(m![1]);
  const id = n >= 1000 ? n - 1000 : n;
  if (!(await s.db.prepare('SELECT id FROM orders WHERE id = ?').bind(id).first())) fail('There is no order ' + orderNumber(id) + '.');
  return id;
}

export async function suppliersList(s: Shop, from: string | null = null, to: string | null = null): Promise<Row[]> {
  const { results } = await s.db.prepare(`SELECT s.*,
      (SELECT COALESCE(SUM(amount), 0) FROM expenses e WHERE e.supplier_id = s.id) AS billed,
      (SELECT COALESCE(SUM(amount), 0) FROM supplier_payments p WHERE p.supplier_id = s.id) AS paid,
      (SELECT MAX(d) FROM (SELECT MAX(spent_on) d FROM expenses WHERE supplier_id = s.id UNION ALL SELECT MAX(paid_on) FROM supplier_payments WHERE supplier_id = s.id)) AS last_on
    FROM suppliers s ORDER BY s.active DESC, s.name`).all<Row>();
  const month: Record<number, number> = {};
  if (from && to) for (const r of (await s.db.prepare('SELECT supplier_id, SUM(amount) v FROM expenses WHERE supplier_id IS NOT NULL AND spent_on >= ? AND spent_on <= ? GROUP BY supplier_id').bind(from, to).all<Row>()).results) month[phpInt(r.supplier_id)] = num(r.v);
  return results.map((x) => {
    const billed = round(num(x.billed), 2), paid = round(num(x.paid), 2);
    return { id: phpInt(x.id), name: x.name, phone: x.phone, makes: x.makes, notes: x.notes, active: !!phpInt(x.active), billed, paid, balance: round(billed - paid, 2),
      monthBilled: round(month[phpInt(x.id)] ?? 0, 2), lastOn: x.last_on };
  });
}

export async function expensesReport(s: Shop, month: string): Promise<Row> {
  const [m, fromUtc, toUtc] = cairoMonthBounds(month);
  const first = m + '-01', last = lastDayOf(m);
  const { results } = await s.db.prepare(`SELECT e.*, s.name AS supplier_name, u.name AS by_name FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id
    LEFT JOIN users u ON u.id = e.created_by WHERE e.spent_on >= ? AND e.spent_on <= ? ORDER BY e.spent_on DESC, e.id DESC`).bind(first, last).all<Row>();
  const list: Row[] = []; const byCat = new Map<string, number>(); let total = 0;
  for (const e of results) {
    const amt = round(num(e.amount), 2);
    total += amt;
    byCat.set(e.category, (byCat.get(e.category) ?? 0) + amt);
    list.push({ id: phpInt(e.id), on: e.spent_on, category: e.category, amount: amt, note: e.note, supplierId: e.supplier_id === null ? null : phpInt(e.supplier_id), supplier: e.supplier_name,
      orderId: e.order_id === null ? null : phpInt(e.order_id), order: e.order_id === null ? null : orderNumber(phpInt(e.order_id)), by: e.by_name });
  }
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ category: k, amount: round(v, 2) }));
  const paidSuppliers = round(num((await s.db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM supplier_payments WHERE paid_on >= ? AND paid_on <= ?').bind(first, last).first<Row>())?.v), 2);
  const sales = round(num((await s.db.prepare("SELECT COALESCE(SUM(total), 0) AS v FROM orders WHERE status NOT IN ('Cancelled','Returned','Awaiting payment') AND created_at >= ? AND created_at < ?").bind(fromUtc, toUtc).first<Row>())?.v), 2);
  const suppliers = await suppliersList(s, first, last);
  const used = (await s.db.prepare('SELECT DISTINCT category FROM expenses ORDER BY category').all<Row>()).results.map((r) => r.category);
  return { month: m, expenses: list, total: round(total, 2), byCategory: cats, sales, net: round(sales - total, 2), paidSuppliers,
    owed: round(suppliers.reduce((a, x) => a + Math.max(0, x.balance), 0), 2), suppliers, categories: [...new Set([...EXPENSE_CATEGORIES, ...used])], supplierCategory: SUPPLIER_CATEGORY };
}

export async function supplierStatement(s: Shop, id: number): Promise<Row> {
  if (!(await s.db.prepare('SELECT id FROM suppliers WHERE id = ?').bind(id).first())) fail('Supplier not found.', 404);
  const rows: Row[] = [];
  for (const r of (await s.db.prepare('SELECT id, spent_on AS on_day, amount, note, order_id, created_at FROM expenses WHERE supplier_id = ?').bind(id).all<Row>()).results)
    rows.push({ type: 'bill', id: phpInt(r.id), on: r.on_day, amount: round(num(r.amount), 2), note: r.note, order: r.order_id === null ? null : orderNumber(phpInt(r.order_id)), at: r.created_at });
  for (const r of (await s.db.prepare('SELECT p.id, p.paid_on AS on_day, p.amount, p.note, p.created_at, u.name AS by_name FROM supplier_payments p LEFT JOIN users u ON u.id = p.created_by WHERE p.supplier_id = ?').bind(id).all<Row>()).results)
    rows.push({ type: 'payment', id: phpInt(r.id), on: r.on_day, amount: round(num(r.amount), 2), note: r.note, by: r.by_name, at: r.created_at });
  rows.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  let bal = 0;
  for (const r of rows) { bal += r.type === 'bill' ? r.amount : -r.amount; r.balance = round(bal, 2); }
  const sup = (await suppliersList(s)).find((x) => x.id === id);
  return { supplier: sup, rows: rows.reverse() };
}

export async function expensesSince(s: Shop, since: string, until = '9999-12-31'): Promise<Row> {
  const t = await s.db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE spent_on >= ? AND spent_on <= ?').bind(since, until).first<Row>();
  let owed = 0;
  for (const x of await suppliersList(s)) owed += Math.max(0, x.balance);
  return { total: round(num(t?.v), 2), owed: round(owed, 2) };
}

// ---------- monthly reports ----------
export async function monthReport(s: Shop, month: string): Promise<Row> {
  const [m, from, to] = cairoMonthBounds(month);
  const valid = "status NOT IN ('Cancelled','Returned','Awaiting payment')";
  const daysIn = daysInMonth(m);
  const isCurrent = cairoMonth() === m;
  const daysSoFar = isCurrent ? cairoDayOfMonth() : daysIn;
  const [ordersR, productsR, catsR] = await s.db.batch([
    s.db.prepare("SELECT o.*, u.name AS rep_name FROM orders o LEFT JOIN users u ON u.id = o.rep_id WHERE o.status != 'Awaiting payment' AND o.created_at >= ? AND o.created_at < ?").bind(from, to),
    s.db.prepare('SELECT id, cost, cat FROM products'), s.db.prepare('SELECT key, label FROM categories'),
  ]);
  const costs = new Map<string, Row>(); for (const p of productsR.results as Row[]) costs.set(String(p.id), { cost: num(p.cost), cat: p.cat });
  const catLabels = new Map<string, string>(); for (const c of catsR.results as Row[]) catLabels.set(String(c.key), c.label);
  const sales = { orders: 0, value: 0, shipping: 0, discounts: 0 }, lost = { orders: 0, value: 0 };
  const byCat = new Map<string, Row>(), top = new Map<string, Row>(), bySource = new Map<string, Row>(), byRep = new Map<string, Row>();
  let cogs = 0, covered = 0, linesValue = 0;
  const customOrders = new Map<number, number>(); const customerKeys = new Set<string>();
  for (const o of ordersR.results as Row[]) {
    if (['Cancelled', 'Returned'].includes(o.status)) { lost.orders++; lost.value += num(o.total); continue; }
    sales.orders++; sales.value += num(o.total); sales.shipping += num(o.shipping); sales.discounts += num(o.discount);
    const src = o.source || 'Website';
    const sx = bySource.get(src) ?? { source: src, orders: 0, value: 0 }; sx.orders++; sx.value += num(o.total); bySource.set(src, sx);
    const rep = o.rep_name || '';
    const rx = byRep.get(rep) ?? { name: rep, orders: 0, value: 0 }; rx.orders++; rx.value += num(o.total); byRep.set(rep, rx);
    const key = phoneKey(String(o.phone ?? '')) || phpTrim(String(o.email ?? '')).toLowerCase();
    if (key) customerKeys.add(key);
    let items: Row[] = []; try { items = JSON.parse(String(o.items)) || []; } catch { /* none */ }
    for (const it of items) {
      const line = phpFloat(it.total ?? phpFloat(it.price) * phpInt(it.qty));
      const qty = phpInt(it.qty ?? 1);
      const id = String(it.id ?? '');
      linesValue += line;
      const cat = id === 'custom' ? 'custom' : costs.get(id)?.cat ?? it.cat ?? 'other';
      const cx = byCat.get(cat) ?? { key: cat, label: cat === 'custom' ? 'Custom & quoted items' : catLabels.get(cat) ?? ucfirst(cat), qty: 0, value: 0 };
      cx.qty += qty; cx.value += line; byCat.set(cat, cx);
      const tk = id === 'custom' ? 'custom:' + (it.name ?? '') : id;
      const tx = top.get(tk) ?? { name: String(it.name ?? id), qty: 0, value: 0 }; tx.qty += qty; tx.value += line; top.set(tk, tx);
      const unit = it.cost !== undefined && it.cost !== null ? phpFloat(it.cost) : id !== 'custom' ? costs.get(id)?.cost ?? 0 : 0;
      if (unit > 0) { cogs += unit * qty; covered += line; }
      if (id === 'custom') customOrders.set(phpInt(o.id), (customOrders.get(phpInt(o.id)) ?? 0) + line);
    }
  }
  let customCost = 0;
  if (customOrders.size) {
    const ids = [...customOrders.keys()].join(',');
    for (const b of (await s.db.prepare(`SELECT order_id, SUM(amount) v FROM expenses WHERE category = ? AND order_id IN (${ids}) GROUP BY order_id`).bind(SUPPLIER_CATEGORY).all<Row>()).results) {
      customCost += num(b.v); covered += customOrders.get(phpInt(b.order_id)) ?? 0;
    }
  }
  const lastDay = lastDayOf(m);
  const [delR, payR, expR, supR, leadR, chatR] = await s.db.batch([
    s.db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS v FROM orders WHERE status = 'Delivered' AND delivered_at >= ? AND delivered_at < ?").bind(from, to),
    s.db.prepare('SELECT method, COUNT(*) n, COALESCE(SUM(amount), 0) v FROM payments WHERE created_at >= ? AND created_at < ? GROUP BY method ORDER BY v DESC').bind(from, to),
    s.db.prepare('SELECT category, COUNT(*) n, COALESCE(SUM(amount), 0) v FROM expenses WHERE spent_on >= ? AND spent_on <= ? GROUP BY category ORDER BY v DESC').bind(m + '-01', lastDay),
    s.db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM supplier_payments WHERE paid_on >= ? AND paid_on <= ?').bind(m + '-01', lastDay),
    s.db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'Won' THEN 1 ELSE 0 END) AS w FROM leads WHERE created_at >= ? AND created_at < ?").bind(from, to),
    s.db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN ad_id != '' OR ad_headline != '' THEN 1 ELSE 0 END) AS a FROM wa_chats WHERE created_at >= ? AND created_at < ?").bind(from, to),
  ]);
  const del = delR.results[0] as Row;
  const byMethod = (payR.results as Row[]).map((r) => ({ method: PAYMENT_METHODS[r.method] ?? ucfirst(String(r.method)), payments: phpInt(r.n), value: round(num(r.v), 2) }));
  const collected = byMethod.reduce((a, r) => a + r.value, 0);
  const expRows = expR.results as Row[];
  const expenses = round(expRows.reduce((a, r) => a + num(r.v), 0), 2);
  const supplierBills = round(expRows.reduce((a, r) => a + (r.category === SUPPLIER_CATEGORY ? num(r.v) : 0), 0), 2);
  const byExpense = expRows.map((r) => ({ category: r.category, items: phpInt(r.n), value: round(num(r.v), 2) }));
  const paidSuppliers = round(num((supR.results[0] as Row).v), 2);
  const team = (await teamCommissions(s, m)).totals;
  let fresh = 0;
  if (customerKeys.size) {
    const firsts = new Map<string, string>();
    for (const r of (await s.db.prepare(`SELECT phone, email, MIN(created_at) first FROM orders WHERE ${valid} GROUP BY phone, email`).all<Row>()).results) {
      const k = phoneKey(String(r.phone ?? '')) || phpTrim(String(r.email ?? '')).toLowerCase();
      if (k && (!firsts.has(k) || r.first < firsts.get(k)!)) firsts.set(k, r.first);
    }
    for (const k of customerKeys) { const f = firsts.get(k); if (f !== undefined && f >= from && f < to) fresh++; }
  }
  const lr = leadR.results[0] as Row, cr = chatR.results[0] as Row;
  const costOfSales = round(cogs + customCost, 2);
  const gross = round(sales.value - costOfSales, 2);
  const operating = round(expenses - supplierBills, 2);
  const net = round(gross - operating - num(team.pay), 2);
  const sortVal = (mp: Map<string, Row>) => [...mp.values()].sort((x, y) => y.value - x.value).map((r) => ({ ...r, value: round(r.value, 2) }));
  return {
    month: m, current: isCurrent, days: daysIn, daysSoFar,
    sales: { orders: sales.orders, value: round(sales.value, 2), avg: sales.orders ? round(sales.value / sales.orders, 2) : 0, shipping: round(sales.shipping, 2), discounts: round(sales.discounts, 2) },
    lost: { orders: lost.orders, value: round(lost.value, 2) },
    delivered: { orders: phpInt(del.n), value: round(num(del.v), 2) },
    collected: { value: round(collected, 2), byMethod },
    expenses: { value: expenses, operating, supplierBills, paidSuppliers, byCategory: byExpense },
    team: { salaries: round(num(team.salary), 2), commissions: round(num(team.commission), 2), pay: round(num(team.pay), 2) },
    profit: { costOfSales, customCost: round(customCost, 2), gross, net, costCoverage: linesValue > 0 ? Math.trunc(round(covered / linesValue * 100)) : 100 },
    customers: { total: customerKeys.size, new: fresh, returning: customerKeys.size - fresh },
    leads: { new: phpInt(lr.n), won: phpInt(lr.w) }, chats: { new: phpInt(cr.n), fromAds: phpInt(cr.a) },
    byCategory: sortVal(byCat), topProducts: sortVal(top).slice(0, 10), bySource: sortVal(bySource), byRep: sortVal(byRep),
  };
}

export async function reportMonths(s: Shop): Promise<string[]> {
  const fo = (await s.db.prepare("SELECT MIN(created_at) AS v FROM orders WHERE status != 'Awaiting payment'").first<Row>())?.v;
  const fe = (await s.db.prepare('SELECT MIN(spent_on) AS v FROM expenses').first<Row>())?.v;
  const cands = [fo ? String(fo).slice(0, 7) : null, fe ? String(fe).slice(0, 7) : null].filter((x): x is string => !!x);
  const start = cands.length ? cands.sort()[0] : cairoMonth();
  const months: string[] = [];
  for (let mm = cairoMonth(); mm >= start && months.length < 60; mm = addMonths(mm, -1)) months.push(mm);
  return months;
}
export async function reportSnapshot(s: Shop, month: string): Promise<Row | null> {
  const r = await s.db.prepare('SELECT data, saved_at FROM month_reports WHERE month = ?').bind(month).first<Row>();
  if (!r) return null;
  let data = null; try { data = JSON.parse(String(r.data)); } catch { /* null */ }
  return { savedAt: r.saved_at, data };
}
export async function reportCloseMonths(s: Shop): Promise<string[]> {
  const closed: string[] = [];
  const current = cairoMonth();
  for (const mm of await reportMonths(s)) {
    if (mm === current || (await reportSnapshot(s, mm))) continue;
    await s.db.prepare('INSERT OR IGNORE INTO month_reports (month, data) VALUES (?, ?)').bind(mm, phpJson(await monthReport(s, mm)).replace(/\//g, '\\/')).run();
    closed.push(mm);
  }
  return closed;
}
export function reportChanges(then: Row, now: Row): Row[] {
  const out: Row[] = [];
  for (const [a, b, label] of [['sales', 'value', 'Sales'], ['sales', 'orders', 'Orders'], ['collected', 'value', 'Collected'], ['expenses', 'value', 'Expenses'], ['profit', 'net', 'Net profit']]) {
    const x = phpFloat(then?.[a]?.[b] ?? 0), y = phpFloat(now?.[a]?.[b] ?? 0);
    if (Math.abs(x - y) >= 1) out.push({ label, then: x, now: y });
  }
  return out;
}
