// Products, brands and the Egypt market settings (port of bootstrap.php product_row/load_products, pricing.php
// from_price/product_json, brands.php brand_row/load_brands and market.php for Egypt; the UAE market is left out).
import { round, numberFormat, jsonArray, truthy } from './php';

export const MARKET = {
  code: 'EG', currency: 'EGP', cur_en: 'EGP', cur_ar: 'ج.م', currency_en: 'Egyptian Pounds', currency_ar: 'الجنيه المصري',
  country_en: 'Egypt', country_ar: 'مصر', og_locale_ar: 'ar_EG', timezone: 'Africa/Cairo', phone_cc: '20',
  phone_display: '+20 127 766 0666', charge_currency: 'EGP', charge_rate: 1,
} as const;

export const SHOP = { shipping_fee: 75, free_shipping_threshold: 1500 } as const;

export const money = (amount: unknown, ar = false): string =>
  ar ? numberFormat(Number(amount)) + ' ' + MARKET.cur_ar : MARKET.cur_en + ' ' + numberFormat(Number(amount));

export type Row = Record<string, any>;

export const productJson = (p: Row, key: string): any[] => {
  const v = jsonArray(p[key]);
  return Array.isArray(v) ? v : Object.values(v);
};

export function fromPrice(p: Row): number {
  const prices: number[] = [];
  const variants = productJson(p, 'variants');
  const lists = variants.length ? variants.map((v: Row) => (Array.isArray(v.tiers) ? v.tiers : v.tiers ? Object.values(v.tiers) : [])) : [productJson(p, 'tiers')];
  lists.forEach((tiers: Row[], i: number) => {
    for (const t of tiers) if (Number(t.price ?? 0) > 0) prices.push(Number(t.price));
    if (!tiers.length) prices.push(variants.length && truthy(variants[i].price) ? Number(variants[i].price) : Number(p.price));
  });
  const min = prices.length ? Math.min(...prices) : Number(p.price);
  const disc = Number(p.discount_pct ?? 0);
  return disc > 0 ? round(min * (1 - disc / 100), 2) : min;
}

export function productRow(p: Row, images: unknown[]): Row {
  let features: any = jsonArray(p.features || '[]');
  if (!truthy(features)) features = [];
  return {
    id: p.id, sku: p.sku, name: p.name, cat: p.cat, vendor: p.vendor,
    price: Number(p.price), cost: Number(p.cost), stock: Math.trunc(Number(p.stock)),
    discountPct: Number(p.discount_pct), label: p.label, status: p.status,
    nameAr: String(p.name_ar ?? ''), subAr: String(p.sub_ar ?? ''), descAr: String(p.desc_ar ?? ''),
    sub: p.sub, desc: p.descr, features,
    period: p.period, sort: Math.trunc(Number(p.sort)), images,
    variants: productJson(p, 'variants'), tiers: productJson(p, 'tiers'), addons: productJson(p, 'addons'),
    personalized: truthy(p.personalized ?? 0), fromPrice: fromPrice(p),
    brandId: p.brand_id !== undefined && p.brand_id !== null ? Math.trunc(Number(p.brand_id)) : null,
    seoTitle: String(p.seo_title ?? ''), seoTitleAr: String(p.seo_title_ar ?? ''),
    seoDesc: String(p.seo_desc ?? ''), seoDescAr: String(p.seo_desc_ar ?? ''),
    brandPrice: Number(p.brand_price ?? 0), marginPct: p.margin_pct !== undefined && p.margin_pct !== null ? Number(p.margin_pct) : null,
    createdAt: p.created_at, updatedAt: p.updated_at,
  };
}

export async function loadProducts(db: D1Database, activeOnly: boolean): Promise<Row[]> {
  const sql = 'SELECT * FROM products' + (activeOnly ? " WHERE status = 'Active'" : '') + ' ORDER BY sort, name';
  const [rows, imgs] = await db.batch([db.prepare(sql), db.prepare('SELECT id, product_id, path FROM product_images ORDER BY sort, id')]);
  const byProduct: Record<string, unknown[]> = {};
  for (const i of imgs.results as Row[]) (byProduct[i.product_id] ??= []).push(activeOnly ? i.path : { id: Math.trunc(Number(i.id)), path: i.path });
  return (rows.results as Row[]).map((p) => productRow(p, byProduct[p.id] ?? []));
}

export function brandRow(b: Row, admin = false): Row {
  const out: Row = {
    id: Math.trunc(Number(b.id)), slug: b.slug, name: b.name, nameAr: String(b.name_ar ?? ''),
    tagline: String(b.tagline ?? ''), taglineAr: String(b.tagline_ar ?? ''),
    about: String(b.about ?? ''), aboutAr: String(b.about_ar ?? ''),
    logo: String(b.logo ?? ''), link: String(b.link ?? ''),
  };
  if (admin) Object.assign(out, {
    commission: Number(b.commission), margin: Number(b.margin ?? 0), active: truthy(b.active), sort: Math.trunc(Number(b.sort)),
    commissionB2b: b.commission_b2b !== undefined && b.commission_b2b !== null ? Number(b.commission_b2b) : null,
    b2bMinQty: b.b2b_min_qty !== undefined && b.b2b_min_qty !== null ? Math.trunc(Number(b.b2b_min_qty)) : null,
    orderEmails: String(b.order_emails ?? ''), orderWhatsapp: String(b.order_whatsapp ?? ''),
  });
  return out;
}

export async function loadBrands(db: D1Database, activeOnly: boolean, admin = false): Promise<Row[]> {
  const { results } = await db.prepare('SELECT * FROM brands' + (activeOnly ? ' WHERE active = 1' : '') + ' ORDER BY sort, name').all<Row>();
  return results.map((b) => brandRow(b, admin));
}
