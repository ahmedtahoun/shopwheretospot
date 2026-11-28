// Dashboard: partner brands and their statements, "sell with us" requests, promo codes and quote pages
// (ports of those parts of api/admin.php, api/brands.php and api/sellers.php).
import { round, phpInt, phpFloat, phpStr, phpTrim, numberFormat, validEmail, phpJsonU } from '../lib/php';
import { type Row, loadBrands, brandRow } from '../lib/catalog';
import { type Shop, strIn, logActivity, orderNumber, brandGet, promoLabel } from '../lib/shop';
import { fail, requirePerm, hasPerm } from '../lib/team';
import { applySizePrices, brandSellPrice } from '../lib/products';
import { loadQuote, quoteOut } from './admin-orders';
import type { A } from './admin';

type Handler = (a: A) => Promise<unknown>;
const num = (v: unknown) => Number(v ?? 0);
const first = (s: Shop, sql: string, ...args: unknown[]) => s.db.prepare(sql).bind(...args).first<Row>();
const all = async (s: Shop, sql: string, ...args: unknown[]) => (await s.db.prepare(sql).bind(...args).all<Row>()).results;
const truthy = (v: unknown) => !!v && v !== '0' && !(Array.isArray(v) && !v.length);
const slugify = (s: string, fallback: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
const jl = (v: unknown): any => { try { const x = JSON.parse(String(v ?? '')); return x && typeof x === 'object' && (Array.isArray(x) ? x.length : Object.keys(x).length) ? x : []; } catch { return []; } };

// ---------- brand statements (api/brands.php) ----------
async function repriceBrandProducts(s: Shop, brandId: number): Promise<number> {
  const b = await brandGet(s, brandId);
  if (!b) return 0;
  let n = 0;
  for (const p of await all(s, 'SELECT id, brand_price, margin_pct, variants FROM products WHERE brand_id = ? AND brand_price > 0', brandId)) {
    const margin = p.margin_pct !== null ? num(p.margin_pct) : num(b.margin);
    const main = brandSellPrice(num(p.brand_price), margin);
    const vs = applySizePrices(main, jl(p.variants), num(p.brand_price));
    await s.db.prepare("UPDATE products SET price = ?, variants = ?, updated_at = datetime('now') WHERE id = ?").bind(main, phpJsonU(vs), p.id).run();
    n++;
  }
  return n;
}
export async function brandLines(s: Shop, brandId: number, month: string | null = null): Promise<Row[]> {
  const b = await brandGet(s, brandId);
  if (!b) return [];
  const mine = new Set((await all(s, 'SELECT id FROM products WHERE brand_id = ?', brandId)).map((r) => String(r.id)));
  let sql = "SELECT id, customer, status, items, created_at, updated_at FROM orders WHERE status NOT IN ('Cancelled', 'Returned', 'Awaiting payment')";
  const args: unknown[] = [];
  if (month) { sql += " AND strftime('%Y-%m', created_at) = ?"; args.push(month); }
  const out: Row[] = [];
  for (const o of await all(s, sql + ' ORDER BY id', ...args)) {
    for (const it of jl(o.items) as Row[]) {
      const hit = it.brand !== undefined && it.brand !== null ? phpInt(it.brand) === brandId : mine.has(String(it.id ?? ''));
      if (!hit) continue;
      const sales = phpFloat(it.total ?? phpFloat(it.price) * phpInt(it.qty));
      const pct = it.comm !== undefined && it.comm !== null ? phpFloat(it.comm) : num(b.commission);
      const base = it.bp !== undefined && it.bp !== null ? round(phpFloat(it.bp) * phpInt(it.qty), 2) : sales;
      const comm = round(base * pct / 100, 2);
      out.push({ orderId: phpInt(o.id), number: orderNumber(phpInt(o.id)), customer: o.customer, status: o.status, at: o.created_at, name: it.name, qty: phpInt(it.qty),
        sales, base, pct, commission: comm, margin: round(sales - base, 2), due: round(base - comm, 2), delivered: o.status === 'Delivered', b2b: truthy(it.b2b) });
    }
  }
  return out;
}
export function brandTotals(lines: Row[]): Row {
  const t: Row = { pieces: 0, sales: 0, base: 0, margin: 0, commission: 0, due: 0, deliveredSales: 0, deliveredCommission: 0, deliveredDue: 0, orders: 0 };
  const orders = new Set<number>();
  for (const l of lines) {
    t.pieces += l.qty; t.sales += l.sales; t.base += l.base; t.margin += l.margin; t.commission += l.commission; t.due += l.due;
    if (l.delivered) { t.deliveredSales += l.sales; t.deliveredCommission += l.commission; t.deliveredDue += l.due; }
    orders.add(l.orderId);
  }
  t.orders = orders.size;
  for (const k of ['sales', 'base', 'margin', 'commission', 'due', 'deliveredSales', 'deliveredCommission', 'deliveredDue']) t[k] = round(t[k], 2);
  return t;
}
async function brandBalance(s: Shop, brandId: number): Promise<Row> {
  const t = brandTotals(await brandLines(s, brandId));
  const paid = round(num((await first(s, 'SELECT COALESCE(SUM(amount), 0) AS v FROM brand_payouts WHERE brand_id = ?', brandId))?.v), 2);
  return { earned: t.deliveredDue, paid, owed: round(t.deliveredDue - paid, 2), pending: round(t.due - t.deliveredDue, 2), commissionAllTime: t.deliveredCommission };
}

// ---------- seller requests (api/sellers.php) ----------
const SELLER_STATUSES = ['New', 'Contacted', 'Approved', 'Rejected'];
const SELLER_CATEGORIES: Record<string, string> = { 'Coffee & drinks': 'coffee', 'Skincare & beauty': 'cosmetics', 'Food & sweets': 'gift', 'Handmade & gifts': 'gift',
  'Fashion & accessories': 'gift', 'Home & decor': 'gift', Pets: 'pets', 'Business products': 'stands', Other: 'gift' };
const sellerRow = (r: Row): Row => ({ id: phpInt(r.id), name: r.name, phone: r.phone, email: r.email, brand: r.brand, city: r.city, link: r.link, category: r.category,
  shopCat: SELLER_CATEGORIES[r.category] ?? 'gift', stock: r.stock_mode, products: jl(r.products), notes: r.notes, status: r.status, teamNote: r.team_note,
  commission: r.commission === null ? null : num(r.commission), leadId: r.lead_id === null ? null : phpInt(r.lead_id), brandId: r.brand_id === null ? null : phpInt(r.brand_id), createdAt: r.created_at });
async function sellerGet(s: Shop, id: number): Promise<Row> {
  const r = await first(s, 'SELECT * FROM seller_requests WHERE id = ?', id);
  if (!r) fail('Request not found.', 404);
  return r!;
}

export function registerBrands(H: Record<string, Handler>): void {
  H.seller_requests = async ({ s }) => {
    await requirePerm(s, 'products');
    const rows = await all(s, "SELECT * FROM seller_requests ORDER BY CASE status WHEN 'New' THEN 0 WHEN 'Contacted' THEN 1 ELSE 2 END, id DESC LIMIT 300");
    return { requests: rows.map(sellerRow), statuses: SELLER_STATUSES, categories: await all(s, "SELECT key, label FROM categories WHERE key != 'services' ORDER BY sort, label") };
  };
  H.seller_status = async ({ s, body }) => {
    const u = await requirePerm(s, 'products');
    const b = await body();
    const r = await sellerGet(s, phpInt(b.id ?? 0));
    const status = ['New', 'Contacted', 'Rejected'].includes(b.status) ? b.status : r.status;
    await s.db.prepare("UPDATE seller_requests SET status = ?, team_note = ?, updated_at = datetime('now') WHERE id = ?").bind(status, strIn(b.note ?? r.team_note, 1000), r.id).run();
    await logActivity(s, u, 'Seller request ' + status, r.brand);
    return { ok: true };
  };
  H.seller_approve = async ({ s, body }) => {
    const u = await requirePerm(s, 'products');
    const b = await body();
    const id = phpInt(b.id ?? 0);
    const r = await sellerGet(s, id);
    if (r.brand_id) fail('This request was already approved.');
    const cat = phpStr(b.cat ?? '');
    if (!num((await first(s, 'SELECT COUNT(*) AS n FROM categories WHERE key = ?', cat))?.n)) fail('Choose a shop category.');
    const commission = Math.max(0, Math.min(100, round(phpFloat(b.commission ?? 0), 2)));
    let slug = slugify(String(r.brand), 'brand-' + id);
    const base = slug; let n = 2;
    while (num((await first(s, 'SELECT COUNT(*) AS n FROM brands WHERE slug = ?', slug))?.n)) slug = base + '-' + n++;
    const ins = await s.db.prepare("INSERT INTO brands (slug, name, tagline, link, commission, active, sort) VALUES (?, ?, ?, ?, ?, 0, (SELECT COALESCE(MAX(sort),0)+1 FROM brands))")
      .bind(slug, r.brand, r.category, r.link, commission).run();
    const brandId = Number(ins.meta.last_row_id);
    const made: string[] = [];
    for (const p of jl(r.products) as Row[]) {
      const pid = (slug + '-' + slugify(String(p.name), 'item')).slice(0, 60);
      let tryId = pid, k = 2;
      while (num((await first(s, 'SELECT COUNT(*) AS n FROM products WHERE id = ?', tryId))?.n)) tryId = pid + '-' + k++;
      const stmts = [s.db.prepare(`INSERT INTO products (id, sku, name, cat, vendor, price, brand_price, cost, stock, status, sub, descr, features, sort, brand_id)
        VALUES (?, '', ?, ?, ?, ?, ?, 0, 0, 'Draft', '', ?, '[]', (SELECT COALESCE(MAX(sort),0)+1 FROM products), ?)`).bind(tryId, p.name, cat, r.brand, phpFloat(p.price), phpFloat(p.price), String(p.desc ?? ''), brandId)];
      if (p.photo) stmts.push(s.db.prepare('INSERT INTO product_images (product_id, path, sort) VALUES (?, ?, 0)').bind(tryId, p.photo));
      await s.db.batch(stmts);
      made.push(tryId);
    }
    await s.db.prepare("UPDATE seller_requests SET status = 'Approved', commission = ?, brand_id = ?, updated_at = datetime('now') WHERE id = ?").bind(commission, brandId, id).run();
    await logActivity(s, u, 'Approved a seller', phpStr(b.brand ?? '') + ' · ' + made.length + ' draft products');
    return { brandId, products: made };
  };

  H.brands = async ({ s, q }) => {
    const u = await requirePerm(s, 'products');
    const month = /^\d{4}-\d{2}$/.test(q.get('month') ?? '') ? q.get('month')! : new Date().toISOString().slice(0, 7);
    const money = hasPerm(u, 'revenue');
    const counts = new Map<number, Row>();
    for (const r of await all(s, "SELECT brand_id, COUNT(*) n, SUM(status = 'Active') live FROM products WHERE brand_id IS NOT NULL GROUP BY brand_id")) counts.set(phpInt(r.brand_id), r);
    const health = new Map<number, Row>();
    for (const p of await all(s, 'SELECT brand_id, status, stock, variants FROM products WHERE brand_id IS NOT NULL')) {
      const h = health.get(phpInt(p.brand_id)) ?? { hidden: 0, out: 0, low: 0 };
      health.set(phpInt(p.brand_id), h);
      if (p.status !== 'Active') { h.hidden++; continue; }
      const vs = jl(p.variants);
      const list = Array.isArray(vs) ? vs : Object.values(vs);
      const stock = list.length ? list.reduce((a: number, v: Row) => a + phpInt(v.stock ?? 0), 0) : phpInt(p.stock);
      if (stock <= 0) h.out++; else if (stock <= 5) h.low++;
    }
    const out: Row[] = [];
    for (const b of await loadBrands(s.db, false, true)) {
      b.health = health.get(b.id) ?? { hidden: 0, out: 0, low: 0 };
      b.products = phpInt(counts.get(b.id)?.n ?? 0);
      b.live = phpInt(counts.get(b.id)?.live ?? 0);
      if (money) { b.month = brandTotals(await brandLines(s, b.id, month)); b.balance = await brandBalance(s, b.id); }
      out.push(b);
    }
    return { brands: out, month };
  };
  H.brand_save = async ({ s, body }) => {
    const u = await requirePerm(s, 'products');
    const b = await body();
    let id = phpInt(b.id ?? 0);
    const name = strIn(b.name, 80);
    if (name === '') fail('Enter the brand name.');
    let link = strIn(b.link, 300);
    if (link !== '' && !/^https?:\/\//i.test(link)) link = 'https://' + link;
    const v: Row = { name, name_ar: strIn(b.nameAr, 80), tagline: strIn(b.tagline, 120), tagline_ar: strIn(b.taglineAr, 120), about: strIn(b.about, 1000), about_ar: strIn(b.aboutAr, 1000), link,
      commission: Math.max(0, Math.min(100, phpFloat(b.commission ?? 0))), margin: Math.max(0, Math.min(500, phpFloat(b.margin ?? 0))), active: truthy(b.active) ? 1 : 0,
      commission_b2b: (b.commissionB2b ?? '') === '' || b.commissionB2b === null ? null : Math.max(0, Math.min(100, phpFloat(b.commissionB2b))),
      b2b_min_qty: phpInt(b.b2bMinQty ?? 0) > 0 ? Math.min(100000, phpInt(b.b2bMinQty)) : null };
    const emails = strIn(b.orderEmails, 300).split(/[\t\n\x0B\f\r ,;]+/).map((e) => phpTrim(e)).filter((e) => e !== '' && e !== '0');
    for (const em of emails) if (!validEmail(em)) fail('“' + em + '” isn’t a valid email address.');
    v.order_emails = emails.join(', ');
    v.order_whatsapp = strIn(b.orderWhatsapp, 40);
    if (v.order_whatsapp !== '' && String(v.order_whatsapp).replace(/\D/g, '').length < 8) fail('Enter the brand’s WhatsApp number with its country code, e.g. +971 50 123 4567.');
    if ((v.commission_b2b === null) !== (v.b2b_min_qty === null)) fail('For a B2B commission, fill in both the B2B commission and from how many pieces it applies (or leave both empty).');
    const cols = ['name', 'name_ar', 'tagline', 'tagline_ar', 'about', 'about_ar', 'link', 'commission', 'margin', 'commission_b2b', 'b2b_min_qty', 'order_emails', 'order_whatsapp', 'active'];
    if (id) {
      const r = await s.db.prepare('UPDATE brands SET ' + cols.map((c) => c + ' = ?').join(', ') + ' WHERE id = ?').bind(...cols.map((c) => v[c]), id).run();
      if (!r.meta.changes && !(await brandGet(s, id))) fail('Brand not found.', 404);
    } else {
      let slug = slugify(name, 'brand'); const base = slug; let n = 1;
      while (await first(s, 'SELECT 1 AS x FROM brands WHERE slug = ?', slug)) slug = base + '-' + (++n);
      const sort = phpInt((await first(s, 'SELECT COALESCE(MAX(sort),0)+1 AS n FROM brands'))?.n);
      id = Number((await s.db.prepare('INSERT INTO brands (slug, ' + cols.join(', ') + ', sort) VALUES (?, ' + cols.map(() => '?').join(', ') + ', ?)').bind(slug, ...cols.map((c) => v[c]), sort).run()).meta.last_row_id);
    }
    const repriced = await repriceBrandProducts(s, id);
    await logActivity(s, u, truthy(b.id) ? 'Updated brand' : 'Added brand', name);
    return { brand: brandRow((await brandGet(s, id))!, true), repriced };
  };
  H.brand_delete = async ({ s, body }) => {
    const u = await requirePerm(s, 'products');
    const id = phpInt((await body()).id ?? 0);
    const brand = await brandGet(s, id);
    if (!brand) fail('Brand not found.', 404);
    if (num((await first(s, 'SELECT COUNT(*) AS n FROM products WHERE brand_id = ?', id))?.n)) fail('Move this brand’s products to another brand (or delete them) first. To hide the brand, switch it off instead.');
    if ((await brandLines(s, id)).length) fail('This brand has sales on record, so it is kept for its statements. Switch it off instead.');
    await s.db.prepare('DELETE FROM brands WHERE id = ?').bind(id).run();
    // (Its logo file goes with the photo storage port.)
    await logActivity(s, u, 'Deleted brand', brand!.name);
    return { ok: true };
  };
  H.brand_statement = async ({ s, q }) => {
    await requirePerm(s, 'products'); await requirePerm(s, 'revenue');
    const id = phpInt(q.get('id') ?? 0);
    const brand = await brandGet(s, id);
    if (!brand) fail('Brand not found.', 404);
    const month = /^\d{4}-\d{2}$/.test(q.get('month') ?? '') ? q.get('month')! : new Date().toISOString().slice(0, 7);
    const lines = await brandLines(s, id, month);
    const pay = await all(s, 'SELECT p.id, p.amount, p.paid_on, p.note, u.name AS by_name FROM brand_payouts p LEFT JOIN users u ON u.id = p.created_by WHERE p.brand_id = ? ORDER BY p.paid_on DESC, p.id DESC', id);
    return { brand: brandRow(brand!, true), month, lines, totals: brandTotals(lines), balance: await brandBalance(s, id),
      payouts: pay.map((r) => ({ id: phpInt(r.id), amount: num(r.amount), on: r.paid_on, note: String(r.note ?? ''), by: String(r.by_name ?? '') })) };
  };
  H.brand_payout = async ({ s, body }) => {
    const u = await requirePerm(s, 'products'); await requirePerm(s, 'revenue');
    const b = await body();
    const brand = await brandGet(s, phpInt(b.brand_id ?? 0));
    if (!brand) fail('Brand not found.', 404);
    const amount = round(phpFloat(b.amount ?? 0), 2);
    if (amount === 0) fail('Enter the amount you paid the brand.');
    const on = /^\d{4}-\d{2}-\d{2}$/.test(phpStr(b.on ?? '')) ? b.on : new Date().toISOString().slice(0, 10);
    await s.db.prepare('INSERT INTO brand_payouts (brand_id, amount, paid_on, note, created_by) VALUES (?, ?, ?, ?, ?)').bind(brand!.id, amount, on, strIn(b.note, 200), u.id).run();
    await logActivity(s, u, 'Paid brand', brand!.name + ' · EGP ' + numberFormat(amount, 2));
    return { ok: true };
  };
  H.brand_payout_delete = async ({ s, body }) => {
    const u = await requirePerm(s, 'products'); await requirePerm(s, 'revenue');
    const id = phpInt((await body()).id ?? 0);
    const r = await first(s, 'SELECT p.amount, b.name FROM brand_payouts p JOIN brands b ON b.id = p.brand_id WHERE p.id = ?', id);
    if (!r) fail('Payment not found.', 404);
    await s.db.prepare('DELETE FROM brand_payouts WHERE id = ?').bind(id).run();
    await logActivity(s, u, 'Deleted a brand payment', r!.name + ' · EGP ' + numberFormat(num(r!.amount), 2));
    return { ok: true };
  };

  // ---------- promo codes ----------
  H.promos = async ({ s }) => {
    await requirePerm(s, 'products');
    const rows = await all(s, `SELECT p.*, (SELECT COUNT(*) FROM orders o WHERE o.promo = p.code COLLATE NOCASE AND o.status != 'Cancelled') AS uses,
      (SELECT COALESCE(SUM(o.discount), 0) FROM orders o WHERE o.promo = p.code COLLATE NOCASE AND o.status != 'Cancelled') AS given,
      (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.promo = p.code COLLATE NOCASE AND o.status NOT IN ('Cancelled','Returned')) AS sales
      FROM promos p ORDER BY p.active DESC, p.id DESC`);
    return { promos: rows.map((p) => ({ id: phpInt(p.id), code: p.code, kind: p.kind, value: num(p.value), minOrder: num(p.min_order), maxUses: p.max_uses === null ? null : phpInt(p.max_uses),
      startsAt: p.starts_at, expiresAt: p.expires_at, active: !!phpInt(p.active), note: p.note, uses: phpInt(p.uses), given: num(p.given), sales: num(p.sales), label: promoLabel(p), createdAt: p.created_at })) };
  };
  H.promo_save = async ({ s, body }) => {
    const u = await requirePerm(s, 'products');
    const b = await body();
    const id = phpInt(b.id ?? 0);
    const code = phpStr(b.code ?? '').replace(/[^A-Za-z0-9_-]/g, '');
    if (code.length < 3 || code.length > 30) fail('Use 3 to 30 letters or numbers for the code (no spaces).');
    const kind = ['fixed', 'shipping'].includes(b.kind) ? b.kind : 'percent';
    const value = kind === 'shipping' ? 0 : round(phpFloat(b.value ?? 0), 2);
    if (value <= 0 && kind !== 'shipping') fail('Enter the discount amount.');
    if (kind === 'percent' && value > 100) fail('A percentage can be at most 100.');
    const date = (v: unknown) => { const t = phpTrim(phpStr(v ?? '')); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };
    const max = (b.max_uses ?? '') === '' || b.max_uses === null ? null : Math.max(1, phpInt(b.max_uses));
    const vals = [code, kind, value, Math.max(0, round(phpFloat(b.min_order ?? 0), 2)), max, date(b.starts_at), date(b.expires_at), truthy(b.active) ? 1 : 0, strIn(b.note, 200)];
    if (await first(s, 'SELECT id FROM promos WHERE code = ? COLLATE NOCASE AND id != ?', code, id)) fail('There is already a promo code called ' + code + ' (in capitals or small letters). Pick a different code.');
    if (id) {
      await s.db.prepare('UPDATE promos SET code = ?, kind = ?, value = ?, min_order = ?, max_uses = ?, starts_at = ?, expires_at = ?, active = ?, note = ? WHERE id = ?').bind(...vals, id).run();
      await logActivity(s, u, 'Updated promo code', code);
    } else {
      await s.db.prepare('INSERT INTO promos (code, kind, value, min_order, max_uses, starts_at, expires_at, active, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(...vals, u.id).run();
      await logActivity(s, u, 'Created promo code', code);
    }
    return { ok: true };
  };
  H.promo_delete = async ({ s, body }) => {
    const u = await requirePerm(s, 'products');
    const p = await first(s, 'SELECT code FROM promos WHERE id = ?', phpInt((await body()).id ?? 0));
    if (!p) fail('Promo code not found.', 404);
    const uses = num((await first(s, "SELECT COUNT(*) AS n FROM orders WHERE promo = ? COLLATE NOCASE AND status != 'Cancelled'", p!.code))?.n);
    if (uses > 0) fail('This code was used on orders, so it is kept for the records. Switch it off instead.');
    await s.db.prepare('DELETE FROM promos WHERE code = ?').bind(p!.code).run();
    await logActivity(s, u, 'Deleted promo code', p!.code);
    return { ok: true };
  };

  // ---------- quote pages ----------
  H.quote_doc = async ({ s, q }) => {
    const u = await requirePerm(s, 'sell');
    const qq = await loadQuote(s, phpInt(q.get('id') ?? 0));
    if (hasPerm(u, 'own_orders') && phpInt(qq.rep_id) !== phpInt(u.id)) fail('Quote not found.', 404);
    return { quote: quoteOut(qq), me: u.name };
  };
  H.quote_text = async ({ s, body }) => {
    const u = await requirePerm(s, 'sell');
    const b = await body();
    const qq = await loadQuote(s, phpInt(b.id ?? 0));
    if (hasPerm(u, 'own_orders') && phpInt(qq.rep_id) !== phpInt(u.id)) fail('Quote not found.', 404);
    await s.db.prepare("UPDATE quotes SET terms = ?, design_notes = ?, updated_at = datetime('now') WHERE id = ?").bind(strIn(b.terms, 2000), strIn(b.notes, 2000), phpInt(qq.id)).run();
    return { ok: true };
  };
}
