// Port of api/seo-lib.php: product facts, search titles and descriptions, structured data, sitemap, product feed,
// llms.txt and the crawler copy of the catalogue on the homepage. Text must come out exactly as the PHP made it.
import { esc, mbLen, mbSubstr, mbStripos, mbStrrpos, round, numberFormat, rawurlencode } from './php';
import { MARKET, SHOP, money, loadProducts, loadBrands, type Row } from './catalog';
import { SEO_CATEGORY_TEXT } from '../data/category-text';

export const SEO_SITE = 'Where To Spot';
// PCRE without UCP: \s is ASCII whitespace only (JS \s would also match no-break spaces).
const S = '[\\t\\n\\x0B\\f\\r ]';

export interface Ctx { db: D1Database; base: string }
export const seoBase = (c: Ctx): string => c.base.replace(/\/+$/, '');
export const productUrl = (c: Ctx, id: string, ar = false): string => seoBase(c) + '/p/' + rawurlencode(id) + (ar ? '?lang=ar' : '');
export const categoryUrl = (c: Ctx, key: string, ar = false): string => seoBase(c) + '/c/' + rawurlencode(key) + (ar ? '?lang=ar' : '');
export const brandUrl = (c: Ctx, slug: string, ar = false): string => seoBase(c) + '/b/' + rawurlencode(slug) + (ar ? '?lang=ar' : '');
export const seoAbs = (c: Ctx, path: string): string => (/^https?:\/\//.test(path) ? path : seoBase(c) + '/' + path.replace(/^\/+/, ''));

export type Lookups = [Record<string, string>, Record<number, Row>];

export async function seoLookups(c: Ctx, ar: boolean): Promise<Lookups> {
  const { results } = await c.db.prepare('SELECT key, label, label_ar FROM categories').all<Row>();
  const cats: Record<string, string> = {};
  for (const r of results) cats[r.key] = ar && r.label_ar ? r.label_ar : r.label;
  const brands: Record<number, Row> = {};
  for (const b of await loadBrands(c.db, false)) brands[b.id] = b;
  return [cats, brands];
}

export function seoItem(c: Ctx, p: Row, ar: boolean, cats: Record<string, string>, brands: Record<number, Row>): Row {
  const b = p.brandId ? brands[p.brandId] ?? null : null;
  const sizes: Row[] = [];
  for (const v of p.variants as Row[]) {
    let price = Number(v.price || p.price);
    if (p.discountPct) price = round(price * (1 - p.discountPct / 100)); // whole pounds, like checkout
    sizes.push({ label: v.label, price, stock: Math.trunc(Number(v.stock)), sku: v.sku ?? '' });
  }
  const sale = p.discountPct ? round(p.price * (1 - p.discountPct / 100)) : Number(p.price);
  const vendor = String(p.vendor ?? '');
  const item: Row = {
    ...p,
    title: ar && p.nameAr ? p.nameAr : p.name,
    summary: ar && p.subAr ? p.subAr : String(p.sub ?? ''),
    text: ar && p.descAr ? p.descAr : String(p.desc ?? ''),
    catLabel: cats[p.cat] ?? p.cat,
    brand: b ? (ar && b.nameAr ? b.nameAr : b.name) : vendor !== '' && !vendor.includes('.') ? vendor : SEO_SITE,
    partner: !!b,
    sizes,
    low: sizes.length ? Math.min(...sizes.map((s) => s.price)) : sale,
    high: sizes.length ? Math.max(...sizes.map((s) => s.price)) : sale,
    was: p.discountPct && !sizes.length ? Number(p.price) : 0,
    inStock: p.cat === 'services' || (sizes.length ? sizes.reduce((t, s) => t + s.stock, 0) > 0 : p.stock > 0),
    imageUrls: (p.images as unknown[]).map((i) => seoAbs(c, typeof i === 'object' && i ? String((i as Row).path ?? '') : String(i))),
    url: productUrl(c, p.id, ar),
  };
  item.seoTitle = String(ar ? p.seoTitleAr ?? '' : p.seoTitle ?? '').trim() || seoAutoTitle(item);
  item.seoDesc = String(ar ? p.seoDescAr ?? '' : p.seoDesc ?? '').trim() || seoAutoDesc(item, ar);
  return item;
}

export async function seoProducts(c: Ctx, ar = false): Promise<Row[]> {
  const [cats, brands] = await seoLookups(c, ar);
  return (await loadProducts(c.db, true)).map((p) => seoItem(c, p, ar, cats, brands));
}

export function seoCut(s: string, max: number): string {
  s = s.replace(new RegExp(S + '+', 'gu'), ' ').trim();
  if (mbLen(s) <= max) return s;
  const cut = mbSubstr(s, 0, max - 1);
  const sp = mbStrrpos(cut, ' ');
  const base = sp !== false && sp > max * 0.6 ? mbSubstr(cut, 0, sp) : cut;
  return base.replace(new RegExp('[\\t\\n\\x0B\\f\\r ,.;:·—–|،-]+$', 'u'), '') + '…';
}

export function seoAutoTitle(p: Row): string {
  const name = String(p.title).trim();
  const brand = p.brand !== SEO_SITE && mbStripos(name, p.brand) === false ? p.brand : '';
  const tries = brand ? [name + ' – ' + brand + ' | ' + SEO_SITE, name + ' – ' + brand, name + ' | ' + SEO_SITE] : [name + ' | ' + SEO_SITE];
  for (const t of tries) if (mbLen(t) <= 60) return t;
  return seoCut(brand && mbLen(name) < 45 ? name + ' – ' + brand : name, 60);
}

const sizeAr = (l: string): string =>
  l.replace(/^Without NFC$/u, 'بدون NFC').replace(/^With NFC$/u, 'مع NFC').replace(/\bkg\b/gu, 'كجم').replace(/\bg\b/gu, 'جم')
    .replace(/\bml\b/gu, 'مل').replace(/\bcm\b/gu, 'سم');

export function seoAutoDesc(p: Row, ar: boolean): string {
  const m = (n: unknown) => money(n, ar);
  const size = (l: string) => (ar ? sizeAr(l) : l);
  const by = p.brand !== SEO_SITE && mbStripos(p.title, p.brand) === false ? (ar ? ' من ' : ' by ') + p.brand : '';
  const lead = p.title + by;
  const labels = (p.sizes as Row[]).map((s) => s.label as string);
  const parts = String(p.summary).split('·').map((x) => x.trim()).filter((part) => {
    for (const l of labels) if (l !== '' && (mbStripos(part, l) !== false || mbStripos(part, size(l)) !== false)) return false;
    return part !== '';
  });
  const summary = parts.join(' · ').replace(/\.+$/, '');
  let partner = '';
  let price: string, why: string;
  if (p.cat === 'services') {
    price = (ar ? 'يبدأ من ' : 'From ') + m(p.low) + (ar ? ' شهريًا' : ' a month');
    why = ar ? 'خطة تسويق شهرية لجلب عملاء جدد في مصر.' : 'Monthly lead-generation marketing plan in Egypt.';
  } else {
    if (p.sizes.length > 1) {
      const sizes = [...(p.sizes as Row[])].sort((x, y) => x.price - y.price);
      price = sizes.length > 2
        ? (ar ? 'من ' + numberFormat(p.low) + ' إلى ' + m(p.high) : MARKET.cur_en + ' ' + numberFormat(p.low) + '–' + numberFormat(p.high))
        : sizes.map((s) => size(s.label) + ' ' + m(s.price)).join(' · ');
    } else {
      price = p.was ? (ar ? 'الآن ' + m(p.low) + ' بدلًا من ' + m(p.was) : 'Now ' + m(p.low) + ' (was ' + m(p.was) + ')') : m(p.low);
    }
    why = p.inStock
      ? (ar ? 'الدفع عند الاستلام وتوصيل لكل مصر خلال 2–5 أيام.' : 'Cash on delivery & 2–5 day delivery across Egypt.')
      : (ar ? 'غير متوفر حاليًا.' : 'Currently out of stock.');
    if (p.partner) partner = ar ? 'منتج أصلي من شريك رسمي. ' : 'Original, from an official partner. ';
  }
  const rtrimWs = (s: string) => s.replace(/[ \t\n\r\0\x0B]+$/, '');
  const withT = (sum: string, extra: string, tail: string | null = null) => rtrimWs(lead + (sum !== '' ? ': ' + sum : '') + '. ' + price + '. ' + extra + (tail ?? why));
  const short = p.cat === 'services' ? '' : p.inStock ? (ar ? 'الدفع عند الاستلام في كل مصر.' : 'Cash on delivery in Egypt.') : why;
  const tries = [withT(summary, partner), withT(summary, ''), withT(summary, '', short), withT(summary, '', ''), withT('', partner), withT('', '')];
  const listRe = new RegExp('^(.+?)' + S + '*(?:,|،|·|&|\\bو)' + S + '*[^,،·&]+$', 'u');
  for (let sum = summary, mm: RegExpMatchArray | null; (mm = sum.match(listRe));) {
    sum = mm[1].replace(/[ ,،·&]+$/u, '');
    tries.splice(4, 0, withT(sum, '', short));
    if (mbLen(withT(sum, '', short)) <= 160) break;
  }
  let d = '';
  for (const t of tries) if (mbLen(t) <= 160) { d = t; break; }
  if (d === '') return seoCut(tries[tries.length - 1], 160);
  const text = String(p.text).replace(new RegExp(S + '+', 'gu'), ' ').trim();
  if (text !== '' && mbLen(d) < 125) {
    const first = text.split(new RegExp('(?<=[.!؟?])' + S, 'u'))[0].trim();
    const longer = lead + (summary !== '' ? ': ' + summary : '') + '. ' + first + ' ' + price + '. ' + partner + why;
    if (mbLen(longer) <= 160) d = longer;
  }
  return d;
}

// array_filter() drops falsy values (null, '', 0) from an associative array.
const filterAssoc = (o: Row): Row => Object.fromEntries(Object.entries(o).filter(([, v]) => !(v === null || v === '' || v === 0 || v === false)));

export function productJsonld(c: Ctx, p: Row): Row {
  const avail = p.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';
  const seller = { '@type': 'Organization', name: SEO_SITE, url: seoBase(c) };
  const shipping = {
    '@type': 'OfferShippingDetails',
    shippingRate: { '@type': 'MonetaryAmount', value: SHOP.shipping_fee, currency: MARKET.currency },
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: MARKET.code },
    deliveryTime: { '@type': 'ShippingDeliveryTime',
      handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 2, unitCode: 'DAY' },
      transitTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 5, unitCode: 'DAY' } },
  };
  const returns = { '@type': 'MerchantReturnPolicy', applicableCountry: MARKET.code, returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    merchantReturnDays: 14, returnMethod: 'https://schema.org/ReturnByMail', returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility' };
  const offer = (price: number, name = '', sku = '') => filterAssoc({ '@type': 'Offer', name: name || null, sku: sku || null, price, priceCurrency: MARKET.currency,
    availability: avail, itemCondition: 'https://schema.org/NewCondition', url: p.url, seller, shippingDetails: shipping, hasMerchantReturnPolicy: returns });
  const data: Row = {
    '@context': 'https://schema.org', '@type': 'Product', name: p.title, description: String(p.text || p.summary).trim(),
    sku: p.sku || p.id, image: p.imageUrls.length ? p.imageUrls : [seoAbs(c, 'images/og-share.png')], category: p.catLabel,
    brand: { '@type': 'Brand', name: p.brand }, url: p.url,
  };
  if (p.sizes.length > 1) {
    data.offers = { '@type': 'AggregateOffer', priceCurrency: MARKET.currency, lowPrice: p.low, highPrice: p.high, offerCount: p.sizes.length, availability: avail,
      offers: (p.sizes as Row[]).map((s) => offer(s.price, p.title + ' — ' + s.label, s.sku)) };
  } else data.offers = offer(p.low);
  return data;
}

export function priceText(p: Row, ar = false): string {
  if (p.sizes.length > 1) return (p.sizes as Row[]).map((s) => s.label + ': ' + money(s.price, ar)).join(' · ');
  return money(p.low, ar) + (p.cat === 'services' ? (ar ? ' / شهريًا' : ' / month') : '');
}

export function orgJsonld(c: Ctx): Row {
  return { '@context': 'https://schema.org', '@type': 'OnlineStore', name: SEO_SITE, url: seoBase(c), logo: seoAbs(c, 'images/logo-round.png?v=3'),
    email: 'info@wheretospot.com', telephone: MARKET.phone_display, currenciesAccepted: MARKET.currency, areaServed: MARKET.code,
    address: { '@type': 'PostalAddress', streetAddress: 'MQR, El Wahat Road', addressLocality: '6th of October City', addressRegion: 'Giza', addressCountry: 'EG' },
    sameAs: ['https://instagram.com/wheretospot', 'https://facebook.com/wheretospot', 'https://tiktok.com/@wheretospot'] };
}

export function categoryText(key: string, label: string, descr: string, ar: boolean): { title: string; intro: string; faq: [string, string][] } {
  return SEO_CATEGORY_TEXT[key]?.[ar ? 'ar' : 'en'] ?? { title: label, intro: descr, faq: [] };
}

export async function seoCatalog(c: Ctx, ar: boolean): Promise<Row[]> {
  const { results } = await c.db.prepare('SELECT key, label, label_ar, descr, descr_ar FROM categories ORDER BY sort, label').all<Row>();
  const cats = new Map<string, Row>();
  for (const r of results) cats.set(r.key, { key: r.key, label: ar && r.label_ar ? r.label_ar : r.label, descr: ar && r.descr_ar ? r.descr_ar : String(r.descr ?? ''), products: [] as Row[] });
  for (const p of await seoProducts(c, ar)) cats.get(p.cat)?.products.push(p);
  return [...cats.values()].filter((x) => x.products.length);
}

export async function seoSitemap(c: Ctx): Promise<string> {
  let x = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';
  const page = (loc: string, lastmod = '', images: string[] = [], alt = '') => {
    let s = '  <url><loc>' + esc(loc) + '</loc>' + (lastmod ? '<lastmod>' + lastmod.slice(0, 10) + '</lastmod>' : '');
    if (alt) s += '<xhtml:link rel="alternate" hreflang="en" href="' + esc(loc) + '"/><xhtml:link rel="alternate" hreflang="ar" href="' + esc(alt) + '"/>';
    for (const img of images.slice(0, 5)) s += '<image:image><image:loc>' + esc(img) + '</image:loc></image:image>';
    return s + '</url>\n';
  };
  const b = seoBase(c);
  for (const f of ['', 'plans.html', 'about.html', 'contact.html', 'sell.html', 'shipping-policy.html', 'refund-policy.html', 'privacy-policy.html', 'terms.html']) x += page(b + '/' + f, '', [], b + '/' + f + '?lang=ar');
  x += page(b + '/google-review-link.html', '2026-10-24', [], b + '/google-review-link.html?lang=ar');
  for (const p of await seoProducts(c)) x += page(p.url, String(p.updatedAt ?? ''), p.imageUrls, productUrl(c, p.id, true));
  for (const cat of await seoCatalog(c, false)) x += page(categoryUrl(c, cat.key), '', [], categoryUrl(c, cat.key, true));
  for (const br of await loadBrands(c.db, true)) x += page(brandUrl(c, br.slug), '', [], brandUrl(c, br.slug, true));
  return x + '</urlset>\n';
}

export async function seoFeed(c: Ctx): Promise<string> {
  let x = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>\n' +
    '<title>' + SEO_SITE + '</title><link>' + esc(seoBase(c)) + '</link><description>Where To Spot shop, ' + MARKET.country_en + '. Prices in ' + MARKET.currency + '.</description>\n';
  for (const p of await seoProducts(c)) {
    if (p.cat === 'services') continue;
    const rows: Row[] = p.sizes.length > 1 ? p.sizes : [{ label: '', price: p.low, stock: p.stock, sku: '' }];
    rows.forEach((s, i) => {
      x += '<item><g:id>' + esc(p.id + (s.label !== '' ? '-' + i : '')) + '</g:id>' + (s.label !== '' ? '<g:item_group_id>' + esc(p.id) + '</g:item_group_id><g:size>' + esc(s.label) + '</g:size>' : '') +
        '<g:title>' + esc(p.title + (s.label !== '' ? ' — ' + s.label : '')) + '</g:title><g:description>' + esc(String(p.text || p.summary).trim()) + '</g:description>' +
        '<g:link>' + esc(p.url) + '</g:link>' + (p.imageUrls.length ? '<g:image_link>' + esc(p.imageUrls[0]) + '</g:image_link>' : '') +
        (p.imageUrls as string[]).slice(1, 6).map((u) => '<g:additional_image_link>' + esc(u) + '</g:additional_image_link>').join('') +
        '<g:availability>' + ((p.cat === 'services' || (p.sizes.length > 1 ? s.stock : p.stock) > 0) ? 'in_stock' : 'out_of_stock') + '</g:availability>' +
        '<g:price>' + numberFormat(s.price, 2, '.', '') + ' ' + MARKET.currency + '</g:price><g:condition>new</g:condition><g:brand>' + esc(p.brand) + '</g:brand>' +
        '<g:identifier_exists>no</g:identifier_exists><g:product_type>' + esc(p.catLabel) + '</g:product_type>' +
        '<g:shipping><g:country>' + MARKET.code + '</g:country><g:price>' + numberFormat(s.price >= SHOP.free_shipping_threshold ? 0 : SHOP.shipping_fee, 2, '.', '') + ' ' + MARKET.currency + '</g:price></g:shipping></item>\n';
    });
  }
  return x + '</channel></rss>\n';
}

export async function seoLlms(c: Ctx): Promise<string> {
  const b = seoBase(c);
  let t = '# Where To Spot\n\n> Online shop and marketing studio in Egypt (6th of October City, Giza). Sells NFC Google-review cards and stands, ' +
    'acrylic display stands, Korean skincare, specialty coffee from partner roasters, and monthly lead-generation marketing plans. ' +
    'All prices are in Egyptian Pounds (EGP). Delivery across Egypt in 2–5 days; cash on delivery, cards and mobile wallets accepted; 14-day returns.\n\n' +
    '- Shop: ' + b + '/\n- Arabic shop: ' + b + '/?lang=ar\n- Contact: info@wheretospot.com · +20 127 766 0666 · WhatsApp +20 127 766 0666\n' +
    '- Delivery: ' + money(SHOP.shipping_fee) + ' across ' + MARKET.country_en + ', free on orders over ' + money(SHOP.free_shipping_threshold) + ' (' + b + '/shipping-policy.html)\n' +
    '- Returns: 14 days (' + b + '/refund-policy.html)\n- Free tool: Google review link and QR code generator (' + b + '/google-review-link.html, Arabic: ?lang=ar). Paste any Google Maps link to get the business\'s official review link (g.page/r/…/review), checked with Google. Free: the review link and a review button for websites. QR cards: 2 free with an account, then 5 for EGP 300, 15 for EGP 750, 40 for EGP 1,600; each QR includes a business page (shop.wheretospot.com/r/…) with WhatsApp, Instagram, Facebook, TikTok, menu and location links.\n- Product feed: ' + b + '/api/seo.php?f=feed\n\n';
  const byCat = new Map<string, Row[]>();
  for (const p of await seoProducts(c)) { if (!byCat.has(p.catLabel)) byCat.set(p.catLabel, []); byCat.get(p.catLabel)!.push(p); }
  for (const [cat, list] of byCat) {
    t += '## ' + cat + '\n\n';
    for (const p of list) {
      t += '- [' + p.title + '](' + p.url + '): ' + priceText(p) + (p.partner ? ' · by ' + p.brand + ' (official partner)' : '') +
        (p.inStock ? '' : ' · currently out of stock') + '. ' + String(p.text || p.summary).replace(new RegExp(S + '+', 'g'), ' ').trim() + '\n';
    }
    t += '\n';
  }
  const brands = await loadBrands(c.db, true);
  if (brands.length) {
    t += '## Partner brands\n\n';
    for (const br of brands) t += '- ' + br.name + ': ' + String(br.about || br.tagline).trim() + ' Products: ' + b + '/?brand=' + br.slug + '\n';
    t += '\n';
  }
  return t;
}

export async function seoHomeBlock(c: Ctx): Promise<string> {
  let out = '';
  const b = seoBase(c);
  const brands = await loadBrands(c.db, true);
  for (const ar of [false, true]) {
    out += '<section lang="' + (ar ? 'ar' : 'en') + '"' + (ar ? ' dir="rtl"' : '') + '>';
    out += '<h2>' + (ar ? 'منتجات Where To Spot' : 'Where To Spot products') + '</h2><p>' + (ar
      ? 'متجر وستوديو تسويق في مدينة 6 أكتوبر، الجيزة: كروت وستاندات NFC لتقييمات جوجل، ستاندات أكريليك، قهوة مختصة، منتجات عناية كورية، وخطط تسويق شهرية. كل الأسعار بالجنيه المصري، توصيل لكل مصر خلال 2–5 أيام، الدفع عند الاستلام أو بالبطاقة أو المحفظة، واسترجاع خلال 14 يوم.'
      : 'Online shop and marketing studio in 6th of October City, Giza: NFC Google review cards and stands, acrylic stands, specialty coffee, Korean skincare and monthly marketing plans. All prices in EGP, delivery across Egypt in 2–5 days, cash on delivery, card or mobile wallet, 14-day returns.') + '</p>';
    for (const cat of await seoCatalog(c, ar)) {
      out += '<h3><a href="' + esc(categoryUrl(c, cat.key, ar)) + '">' + esc(cat.label) + '</a></h3><ul>';
      for (const p of cat.products) out += '<li><a href="' + esc(p.url) + '">' + esc(p.title) + '</a>: ' + esc(priceText(p, ar)) + (p.summary ? ' · ' + esc(p.summary) : '') + '</li>';
      out += '</ul>';
    }
    for (const br of brands) out += '<p><a href="' + esc(brandUrl(c, br.slug, ar)) + '">' + esc(ar && br.nameAr ? br.nameAr : br.name) + '</a> · ' + (ar ? 'شريك رسمي' : 'official partner') + '</p>';
    out += '<p><a href="' + b + '/google-review-link.html' + (ar ? '?lang=ar' : '') + '">' + (ar ? 'أداة مجانية: رابط تقييم جوجل وكود QR' : 'Free tool: Google review link & QR code generator') + '</a> · <a href="' + b + '/plans.html">' + (ar ? 'خطط التسويق' : 'Marketing plans') + '</a> · <a href="' + b + '/contact.html">' + (ar ? 'تواصل معنا' : 'Contact us') + '</a></p></section>';
  }
  return out;
}
