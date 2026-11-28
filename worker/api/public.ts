// Port of the read part of api/public.php: catalog, delivery areas, area search, product reviews, account (signed out).
// The writes (orders, leads, promo, accounts) come with the checkout phase.
import { phpJson, round, mbSubstr } from '../lib/php';
import { loadProducts, loadBrands, type Row } from '../lib/catalog';
import { seoLookups, seoItem, type Ctx } from '../lib/seo';
import { bostaAreas, bostaZones, areaSearch, areaSuggest } from '../lib/areas';
import type { Env } from '../index';

export function jsonOut(data: unknown, code = 200, cacheSeconds = 0): Response {
  return new Response(phpJson(data), { status: code, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheSeconds > 0 ? 'public, max-age=' + cacheSeconds : 'no-store',
  } });
}
export const fail = (msg: string, code = 400): Response => jsonOut({ error: msg }, code);

// str_in(): trimmed and cut to a length (characters).
export const strIn = (v: unknown, max = 500): string => mbSubstr(String(v ?? '').trim(), 0, max);

export const cookie = (request: Request, name: string): string => {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
};

async function sha256(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The signed-in shop customer (cookie wts_cust), or null.
export async function currentCustomer(request: Request, env: Env): Promise<Row | null> {
  const token = cookie(request, 'wts_cust');
  if (token.length < 32) return null;
  return env.DB.prepare('SELECT c.* FROM customer_sessions s JOIN customers c ON c.id = s.customer_id WHERE s.token_hash = ? AND s.expires > ?')
    .bind(await sha256(token), Math.floor(Date.now() / 1000)).first<Row>();
}

// Paymob online methods the visitor may see (api/paymob.php): with test keys only testers (cookie wts_paytest=1).
export function paymobMethods(env: Env): Record<string, number> {
  const m: Record<string, number> = {};
  if (Number(env.PAYMOB_CARD_INTEGRATION_ID ?? 0)) m.paymob_card = Number(env.PAYMOB_CARD_INTEGRATION_ID);
  if (Number(env.PAYMOB_WALLET_INTEGRATION_ID ?? 0)) m.paymob_wallet = Number(env.PAYMOB_WALLET_INTEGRATION_ID);
  return env.PAYMOB_SECRET_KEY ? m : {};
}
export const paymobIsTest = (env: Env): boolean => String(env.PAYMOB_SECRET_KEY ?? '').includes('_test_');
export const paymobVisible = (request: Request, env: Env): Record<string, number> =>
  paymobIsTest(env) && cookie(request, 'wts_paytest') !== '1' ? {} : paymobMethods(env);

// ---- reviews (api/reviews.php) ----
const reviewName = (name: string): string => {
  const parts = name.trim().split(/\s+/u);
  if (!parts.length || parts[0] === '') return 'Customer';
  return parts[0] + (parts.length > 1 ? ' ' + mbSubstr(parts[parts.length - 1], 0, 1) + '.' : '');
};

async function reviewStatus(env: Env, c: Row | null, productId: string) {
  const me: Row = { signedIn: !!c, email: c ? c.email : null, canReview: false, mine: null, name: c ? String(c.name ?? '') : '' };
  if (c) {
    const like = '%"id":"' + productId.replace(/%/g, '\\%').replace(/_/g, '\\_') + '"%';
    const o = await env.DB.prepare("SELECT id FROM orders WHERE status = 'Delivered' AND (customer_id = ? OR email = ? COLLATE NOCASE) AND items LIKE ? ORDER BY id DESC LIMIT 1")
      .bind(Math.trunc(Number(c.id)), String(c.email), like).first<Row>();
    me.canReview = !!o;
    const r = await env.DB.prepare('SELECT rating, text, name, status FROM product_reviews WHERE customer_id = ? AND product_id = ?').bind(Math.trunc(Number(c.id)), productId).first<Row>();
    if (r) me.mine = { rating: Math.trunc(Number(r.rating)), text: r.text, name: r.name, hidden: r.status !== 'published' };
  }
  const { results } = await env.DB.prepare("SELECT * FROM product_reviews WHERE product_id = ? AND status = 'published' ORDER BY id DESC LIMIT 50").bind(productId).all<Row>();
  const reviews = results.map((r) => ({ id: Math.trunc(Number(r.id)), name: reviewName(String(r.name)), rating: Math.trunc(Number(r.rating)), text: r.text, date: String(r.created_at).slice(0, 10), verified: true }));
  const s = await env.DB.prepare("SELECT COUNT(*) AS n, AVG(rating) AS a FROM product_reviews WHERE product_id = ? AND status = 'published'").bind(productId).first<Row>();
  const n = Math.trunc(Number(s?.n ?? 0));
  return { reviews, stats: { count: n, avg: n ? round(Number(s?.a), 1) : 0 }, me };
}

// ---- catalog ----
export async function catalog(request: Request, env: Env, ctx: Ctx) {
  const cats = (await env.DB.prepare('SELECT key, label, descr AS "desc", label_ar AS "labelAr", descr_ar AS "descAr", sort FROM categories ORDER BY sort, label').all<Row>()).results;
  const en = await seoLookups(ctx, false), ar = await seoLookups(ctx, true);
  const products = (await loadProducts(env.DB, true)).map((p) => {
    const e = seoItem(ctx, p, false, ...en), a = seoItem(ctx, p, true, ...ar);
    const out: Row = { ...p, seo: { en: [e.seoTitle, e.seoDesc], ar: [a.seoTitle, a.seoDesc] } };
    for (const k of ['cost', 'createdAt', 'updatedAt', 'brandPrice', 'marginPct', 'seoTitle', 'seoTitleAr', 'seoDesc', 'seoDescAr']) delete out[k];
    out.variants = (out.variants as Row[]).map((v) => { const { brandPrice, brandOwn, ...rest } = v; return rest; });
    return out;
  });
  const used = new Set(products.map((p) => p.brandId).filter((x) => x));
  const brands = (await loadBrands(env.DB, true)).filter((b) => used.has(b.id));
  return { categories: cats, products, brands, payments: { online: Object.keys(paymobVisible(request, env)), test: paymobIsTest(env) } };
}

export async function handlePublic(request: Request, env: Env, url: URL, ctx: Ctx): Promise<Response> {
  const action = url.searchParams.get('action') ?? '';
  const method = request.method;
  if (method === 'GET') {
    if (action === 'catalog') return jsonOut(await catalog(request, env, ctx), 200, paymobIsTest(env) ? 0 : 60);
    if (action === 'areas') {
      const cities = bostaAreas();
      const city = url.searchParams.get('city');
      if (city) {
        for (const c of cities) if (c.id === city) return jsonOut({ zones: bostaZones(c) }, 200, 3600);
        return fail('City not found', 404);
      }
      return jsonOut({ cities: cities.map((c) => ({ id: c.id, name: c.name, ar: c.ar })) }, 200, 3600);
    }
    if (action === 'area_search') return jsonOut({ results: areaSearch(strIn(url.searchParams.get('q'), 80)) }, 200, 3600);
    if (action === 'area_suggest') return jsonOut({ results: areaSuggest(strIn(url.searchParams.get('text'), 300)) }, 200, 3600);
    if (action === 'reviews') {
      const product = String(url.searchParams.get('product') ?? '').replace(/[^A-Za-z0-9_-]/g, '');
      return jsonOut(await reviewStatus(env, await currentCustomer(request, env), product));
    }
    if (action === 'account') {
      const c = await currentCustomer(request, env);
      if (!c) return jsonOut({ customer: null });
    }
  }
  return new Response(JSON.stringify({ error: 'Not available on the test shop yet', path: '/api/public.php', action }), { status: 501, headers: { 'Content-Type': 'application/json' } });
}
