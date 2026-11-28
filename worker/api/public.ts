// Port of api/public.php: the storefront's endpoints (no team login). Reads: catalog, delivery areas, reviews, account.
// Writes: promo check, checkout drafts, orders (cash and Paymob), paying an unpaid order, leads, customer accounts,
// reviews, order tracking. Logo uploads and "sell with us" files wait for the photo storage (R2) port.
import { phpJson, round, mbSubstr, phpInt, phpFloat, phpStr } from '../lib/php';
import { loadProducts, loadBrands, money, type Row } from '../lib/catalog';
import { seoLookups, seoItem, type Ctx } from '../lib/seo';
import { bostaAreas, bostaZones, areaSearch, areaSuggest } from '../lib/areas';
import { type Shop, ShopError, makeShop, readBody, strIn, tooManyAttempts, recordAttempt, logActivity, opsError, orderNumber, orderPaid, phoneKey, emailKey,
  findLead, touchLead, insertLead, leadFromOrder, promoCheck, promoLabel, createOrder, today } from '../lib/shop';
import { currentCustomer, customerOut, customerOrders, customerSendCode, customerVerify, customerSave, customerLogout, customerRememberOrder, reviewSave, UNPAID_EXPIRED_NOTE } from '../lib/customers';
import { draftSave, draftOrdered, abandonedDue, draftCart } from '../lib/drafts';
import { metaRememberOrder, metaPurchase } from '../lib/meta';
import { paymobVisible, paymobIsTest, paymobCheckoutUrl, PaymobError } from '../lib/paymob';
import { confirmOnlineOrder, expireUnpaidOrders } from '../lib/orders';
import { notifyNewLead } from '../lib/mail';
import { reviewSaveToken } from './review';

export function jsonOut(data: unknown, code = 200, cacheSeconds = 0, s?: Shop): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheSeconds > 0 ? 'public, max-age=' + cacheSeconds : 'no-store' });
  for (const c of s?.cookies ?? []) headers.append('Set-Cookie', c);
  return new Response(phpJson(data), { status: code, headers });
}
// The answer ends the request (PHP's json_out() / fail() exit).
class Answer { constructor(public res: Response) {} }
const out = (s: Shop, data: unknown, code = 200, cache = 0): never => { throw new Answer(jsonOut(data, code, cache, s)); };
const fail = (s: Shop, msg: string, code = 400): never => out(s, { error: msg }, code);

// ---- reviews (api/reviews.php) ----
const reviewName = (name: string): string => {
  const parts = name.trim().split(/\s+/u);
  if (!parts.length || parts[0] === '') return 'Customer';
  return parts[0] + (parts.length > 1 ? ' ' + mbSubstr(parts[parts.length - 1], 0, 1) + '.' : '');
};
export async function reviewStatus(s: Shop, c: Row | null, productId: string) {
  const me: Row = { signedIn: !!c, email: c ? c.email : null, canReview: false, mine: null, name: c ? String(c.name ?? '') : '' };
  if (c) {
    const like = '%"id":"' + productId.replace(/%/g, '\\%').replace(/_/g, '\\_') + '"%';
    const o = await s.db.prepare("SELECT id FROM orders WHERE status = 'Delivered' AND (customer_id = ? OR email = ? COLLATE NOCASE) AND items LIKE ? ORDER BY id DESC LIMIT 1")
      .bind(Math.trunc(Number(c.id)), String(c.email), like).first<Row>();
    me.canReview = !!o;
    const r = await s.db.prepare('SELECT rating, text, name, status FROM product_reviews WHERE customer_id = ? AND product_id = ?').bind(Math.trunc(Number(c.id)), productId).first<Row>();
    if (r) me.mine = { rating: Math.trunc(Number(r.rating)), text: r.text, name: r.name, hidden: r.status !== 'published' };
  }
  const { results } = await s.db.prepare("SELECT * FROM product_reviews WHERE product_id = ? AND status = 'published' ORDER BY id DESC LIMIT 50").bind(productId).all<Row>();
  const reviews = results.map((r) => ({ id: Math.trunc(Number(r.id)), name: reviewName(String(r.name)), rating: Math.trunc(Number(r.rating)), text: r.text, date: String(r.created_at).slice(0, 10), verified: true }));
  const st = await s.db.prepare("SELECT COUNT(*) AS n, AVG(rating) AS a FROM product_reviews WHERE product_id = ? AND status = 'published'").bind(productId).first<Row>();
  const n = Math.trunc(Number(st?.n ?? 0));
  return { reviews, stats: { count: n, avg: n ? round(Number(st?.a), 1) : 0 }, me };
}

// ---- catalog ----
export async function catalog(s: Shop, ctx: Ctx) {
  const cats = (await s.db.prepare('SELECT key, label, descr AS "desc", label_ar AS "labelAr", descr_ar AS "descAr", sort FROM categories ORDER BY sort, label').all<Row>()).results;
  const en = await seoLookups(ctx, false), ar = await seoLookups(ctx, true);
  const products = (await loadProducts(s.db, true)).map((p) => {
    const e = seoItem(ctx, p, false, ...en), a = seoItem(ctx, p, true, ...ar);
    const o: Row = { ...p, seo: { en: [e.seoTitle, e.seoDesc], ar: [a.seoTitle, a.seoDesc] } };
    for (const k of ['cost', 'createdAt', 'updatedAt', 'brandPrice', 'marginPct', 'seoTitle', 'seoTitleAr', 'seoDesc', 'seoDescAr']) delete o[k];
    o.variants = (o.variants as Row[]).map((v) => { const { brandPrice, brandOwn, ...rest } = v; return rest; });
    return o;
  });
  const used = new Set(products.map((p) => p.brandId).filter((x) => x));
  const brands = (await loadBrands(s.db, true)).filter((b) => used.has(b.id));
  return { categories: cats, products, brands, payments: { online: Object.keys(paymobVisible(s)), test: paymobIsTest(s) } };
}

// An unpaid order, found by its number and the email or phone it was placed with.
async function orderByContact(s: Shop, b: Row): Promise<[number, Row]> {
  const id = phpInt(strIn(b.number, 20).toUpperCase().replace(/\D/g, '')) - 1000;
  const who = strIn(b.contact, 160);
  const o = await s.db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<Row>();
  const match = o && who !== '' && (String(o.email).toLowerCase() === who.toLowerCase() || (phoneKey(who) && phoneKey(who) === phoneKey(String(o.phone))));
  if (!match) fail(s, 'We couldn’t find that order. Check the number and the email or phone you used.', 404);
  return [id, o!];
}

async function actions(s: Shop, url: URL, ctx: Ctx, action: string): Promise<void> {
  const method = s.request.method;
  if (action === 'catalog' && method === 'GET') out(s, await catalog(s, ctx), 200, paymobIsTest(s) ? 0 : 60);
  if (action === 'draft_cart' && method === 'GET') out(s, { items: await draftCart(s, url.searchParams.get('t') ?? '') });
  if (action === 'areas' && method === 'GET') {
    const cities = bostaAreas();
    const city = url.searchParams.get('city');
    if (city) {
      for (const c of cities) if (c.id === city) out(s, { zones: bostaZones(c) }, 200, 3600);
      fail(s, 'City not found', 404);
    }
    out(s, { cities: cities.map((c) => ({ id: c.id, name: c.name, ar: c.ar })) }, 200, 3600);
  }
  if (action === 'area_search' && method === 'GET') out(s, { results: areaSearch(strIn(url.searchParams.get('q'), 80)) }, 200, 3600);
  if (action === 'area_suggest' && method === 'GET') out(s, { results: areaSuggest(strIn(url.searchParams.get('text'), 300)) }, 200, 3600);
  if (action === 'reviews' && method === 'GET') {
    const product = String(url.searchParams.get('product') ?? '').replace(/[^A-Za-z0-9_-]/g, '');
    out(s, await reviewStatus(s, await currentCustomer(s), product));
  }
  if (action === 'account' && method === 'GET') {
    const c = await currentCustomer(s);
    out(s, c ? { customer: await customerOut(s, c), orders: await customerOrders(s, c) } : { customer: null });
  }

  if (method !== 'POST') fail(s, 'Not found', 404);
  const b = await readBody(s);

  if (action === 'upload_logo' || action === 'seller_apply') {
    out(s, { error: 'Uploads are not available on the test shop yet', path: '/api/public.php', action }, 501);
  }
  if (action === 'promo') {
    if (await tooManyAttempts(s, 'promo', 30, 3600)) fail(s, 'Too many tries. Please wait a while.', 429);
    await recordAttempt(s, 'promo');
    let p: Row;
    try { [p] = await promoCheck(s, strIn(b.code, 40), phpFloat(b.subtotal ?? 0)); }
    catch (e) { if (e instanceof ShopError) fail(s, e.message, 404); throw e; }
    out(s, { code: p!.code, kind: p!.kind, value: phpFloat(p!.value), min: phpFloat(p!.min_order), pct: p!.kind === 'percent' ? phpFloat(p!.value) : 0, label: promoLabel(p!) });
  }
  if (action === 'review_token_save') {
    if (await tooManyAttempts(s, 'rtoken', 30, 3600)) fail(s, 'Too many tries. Please wait a while.', 429);
    await recordAttempt(s, 'rtoken');
    out(s, await reviewSaveToken(s, phpStr(b.t ?? ''), b));
  }
  if (action === 'checkout_draft') {
    if (await tooManyAttempts(s, 'draft', 120, 3600)) out(s, { ok: true });
    await recordAttempt(s, 'draft');
    await draftSave(s, b);
    await abandonedDue(s);
    out(s, { ok: true });
  }
  if (action === 'order') {
    if (await tooManyAttempts(s, 'order', 10, 3600)) fail(s, 'Too many orders from this connection. Please call us.', 429);
    const pay = Object.keys(paymobVisible(s)).includes(b.payment) ? String(b.payment) : 'cod';
    await expireUnpaidOrders(s);
    const r = await createOrder(s, b, pay === 'cod' ? {} : { payment: pay, paid_now: 0, status: 'Awaiting payment' });
    await recordAttempt(s, 'order');
    // (schedule_daily_backup: D1 keeps 30 days of point-in-time recovery, so there is nothing to schedule.)
    await s.db.prepare('UPDATE orders SET lang = ? WHERE id = ?').bind(b.lang === 'en' ? 'en' : 'ar', r.id).run();
    try { await draftOrdered(s, phpStr(b.draft_token ?? ''), phpStr(b.phone ?? ''), r.id); } catch (e) { await opsError(s, 'Leads', 'An order’s checkout draft could not be closed', e); }
    try { await metaRememberOrder(s, r.id); if (pay === 'cod') await metaPurchase(s, r.id); } catch (e) { await opsError(s, 'Ad tracking', 'An order’s tracking details could not be saved', e); }
    const cust = await currentCustomer(s);
    if (cust) {
      await s.db.prepare('UPDATE orders SET customer_id = ? WHERE id = ?').bind(cust.id, r.id).run();
      const o = await s.db.prepare('SELECT * FROM orders WHERE id = ?').bind(r.id).first<Row>();
      await customerRememberOrder(s, phpInt(cust.id), o!, { zone_id: strIn(b.zone_id, 40) || null, area_title: strIn(b.area_title, 160) || null, area_sub: strIn(b.area_sub, 160) || null });
    }
    if (pay === 'cod') try {
      const o = await s.db.prepare('SELECT rep_id FROM orders WHERE id = ?').bind(r.id).first<Row>();
      await leadFromOrder(s, b, r, o?.rep_id ? phpInt(o.rep_id) : null, 'Website');
    } catch (e) { await opsError(s, 'Leads', 'A website order was saved but its lead wasn’t', e); }
    if (pay === 'cod') await logActivity(s, null, 'New order', r.number + ' · ' + strIn(b.name, 120) + ' · ' + money(r.total));
    let payUrl: string | null = null, payError: string | null = null;
    if (pay !== 'cod') {
      try { payUrl = await paymobCheckoutUrl(s, r.id, pay); }
      catch (e) {
        payError = 'Online payment could not be started.';
        const detail = e instanceof PaymobError ? e.detail : '';
        await opsError(s, 'Paymob', 'Online payment could not start for ' + r.number + ' — ' + mbSubstr(detail, 0, 200), e);
        await logActivity(s, null, 'Online payment could not start', r.number + ' · ' + mbSubstr(detail || (e instanceof Error ? e.message : String(e)), 0, 250));
      }
    }
    out(s, { number: r.number, total: r.total, shipping: r.shipping, discount: r.discount, payUrl, payError });
  }
  if (action === 'pay_cod') {
    if (await tooManyAttempts(s, 'pay', 20, 3600)) fail(s, 'Too many attempts. Please call us.', 429);
    await recordAttempt(s, 'pay');
    const [id, o] = await orderByContact(s, b);
    if (o.status !== 'Awaiting payment') fail(s, o.status === 'Cancelled' ? 'This order expired. Please place it again from the shop.' : 'This order is already confirmed.');
    if (await orderPaid(s, id) > 0) fail(s, 'This order already has a payment. Please contact us.');
    await s.db.prepare("UPDATE orders SET payment = 'cod' WHERE id = ?").bind(id).run();
    await confirmOnlineOrder(s, id, 'Order switched to cash on delivery');
    out(s, { ok: true, number: orderNumber(id), total: Number(o.total) });
  }
  if (action === 'pay') {
    if (await tooManyAttempts(s, 'pay', 20, 3600)) fail(s, 'Too many attempts. Please call us.', 429);
    await recordAttempt(s, 'pay');
    const [, o] = await orderByContact(s, b);
    if (o.status === 'Cancelled' && String(o.notes ?? '').includes(UNPAID_EXPIRED_NOTE)) fail(s, 'This order expired because it wasn’t paid. Please place it again from the shop.');
    if (['Cancelled', 'Returned', 'Delivered'].includes(o.status)) fail(s, 'This order can’t be paid online. Please contact us.');
    const visible = Object.keys(paymobVisible(s));
    const m = visible.includes(b.method) ? String(b.method) : visible[0] ?? '';
    if (m === '') fail(s, 'Online payment is not available right now.');
    try { out(s, { payUrl: await paymobCheckoutUrl(s, phpInt(o.id), m) }); }
    catch (e) {
      if (e instanceof Answer) throw e;
      if (e instanceof ShopError) await logActivity(s, null, 'Online payment could not start', orderNumber(phpInt(o.id)) + ' · retry · ' + mbSubstr(e instanceof PaymobError && e.detail ? e.detail : e.message, 0, 250));
      throw e;
    }
  }
  if (action === 'lead') {
    if (await tooManyAttempts(s, 'lead', 10, 3600)) fail(s, 'Too many requests. Please call us.', 429);
    const name = strIn(b.name, 120), contact = strIn(b.contact, 160);
    if (name === '' || contact === '') fail(s, 'Please enter your name and email or phone.');
    const cat = strIn(b.cat, 40), source = strIn(b.source ?? 'Website', 80), details = strIn(b.notes, 1000);
    const existing = await findLead(s, phoneKey(contact), emailKey(contact));
    if (existing) {
      await touchLead(s, existing, today() + ' · New enquiry (' + source + ')' + (cat ? ' · interested in ' + cat : '') + ' · from ' + name + (details !== '' ? '\n' + details : ''), 'New', null, contact);
    } else {
      await insertLead(s, { name, contact, cat, source, status: 'New', notes: details });
    }
    await recordAttempt(s, 'lead');
    await logActivity(s, null, 'New lead', name + ' · ' + source);
    await notifyNewLead(s, { name, contact, cat, source, notes: details });
    out(s, { ok: true });
  }
  if (action === 'account_code') {
    await customerSendCode(s, strIn(b.email, 160), b.lang === 'ar' ? 'ar' : 'en');
    out(s, { ok: true });
  }
  if (action === 'account_verify') {
    const c = await customerVerify(s, strIn(b.email, 160), strIn(b.code, 12));
    out(s, { customer: await customerOut(s, c), orders: await customerOrders(s, c) });
  }
  if (action === 'account_save') {
    const c = await currentCustomer(s);
    if (!c) fail(s, 'Please sign in again.', 401);
    out(s, { customer: await customerOut(s, await customerSave(s, c!, b)) });
  }
  if (action === 'review_save') {
    const c = await currentCustomer(s);
    if (!c) fail(s, 'Please sign in with the email you ordered with.', 401);
    if (await tooManyAttempts(s, 'review', 20, 3600)) fail(s, 'Too many tries. Please wait a while.', 429);
    await recordAttempt(s, 'review');
    const pid = phpStr(b.product ?? '').replace(/[^A-Za-z0-9_-]/g, '');
    try { await reviewSave(s, c!, pid, b); } catch (e) { if (e instanceof ShopError) fail(s, e.message, e.code === 403 ? 403 : 400); throw e; }
    out(s, await reviewStatus(s, c, pid));
  }
  if (action === 'account_logout') {
    await customerLogout(s);
    out(s, { ok: true });
  }
  if (action === 'track') {
    if (await tooManyAttempts(s, 'track', 30, 900)) fail(s, 'Too many lookups. Try again later.', 429);
    await recordAttempt(s, 'track');
    const email = strIn(b.email, 160), num = strIn(b.number, 20).toUpperCase();
    const rows = num !== ''
      ? (await s.db.prepare('SELECT * FROM orders WHERE id = ? AND email = ? COLLATE NOCASE').bind(phpInt(num.replace(/\D/g, '')) - 1000, email).all<Row>()).results
      : (await s.db.prepare('SELECT * FROM orders WHERE email = ? COLLATE NOCASE ORDER BY id DESC LIMIT 20').bind(email).all<Row>()).results;
    out(s, { orders: rows.map((o) => { let items = null; try { items = JSON.parse(String(o.items)); } catch { /* null */ }
      return { number: orderNumber(Number(o.id)), status: o.status, total: Number(o.total), date: String(o.created_at).slice(0, 10), items }; }) });
  }
  fail(s, 'Not found', 404);
}

export async function handlePublic(request: Request, env: import('../index').Env, url: URL, ctx: Ctx, ec: ExecutionContext): Promise<Response> {
  const s = makeShop(request, env, ec);
  const action = url.searchParams.get('action') ?? '';
  try {
    await actions(s, url, ctx, action);
    return jsonOut({ error: 'Not found' }, 404, 0, s);
  } catch (e) {
    if (e instanceof Answer) return e.res;
    if (e instanceof ShopError) return jsonOut({ error: e.message }, 422, 0, s);
    await opsError(s, 'Server', 'Shop error (' + action + ')', e);
    return jsonOut({ error: 'Something went wrong. Please try again or contact us.' }, 500, 0, s);
  }
}
