// Server-built pages (port of api/product-page.php, category-page.php and share-page.php).
import PRODUCT_TEMPLATE from '../../shop-product.dc.html';
import { esc, mbSubstr, rawurlencode, phpJson, round } from '../lib/php';
import { trackJs } from '../data/track-js';
import { MARKET, money, loadBrands, type Row } from '../lib/catalog';
import { seoBase, seoAbs, seoProducts, seoCatalog, categoryText, productJsonld, priceText, productUrl, categoryUrl, brandUrl, seoSitemap, seoFeed, seoLlms, seoHomeBlock, SEO_SITE, type Ctx } from '../lib/seo';
import type { Env } from '../index';

const html = (body: string, status = 200, cache = ''): Response =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...(cache ? { 'Cache-Control': cache } : {}) } });

const replaceOnce = (s: string, find: string, withText: string): string => {
  const at = s.indexOf(find);
  return at < 0 ? s : s.slice(0, at) + withText + s.slice(at + find.length);
};
// json_encode with JSON_HEX_TAG: < and > as \u003C / \u003E.
const ldJson = (d: unknown): string => '<script type="application/ld+json">' + phpJson(d).replace(/</g, '\\u003C').replace(/>/g, '\\u003E') + '</script>';
const nl2br = (s: string): string => s.replace(/(\r\n|\n\r|\n|\r)/g, '<br />$1');

export const isPreviewBot = (request: Request): boolean =>
  /WhatsApp|facebookexternalhit|Facebot|meta-externalagent|Twitterbot|TelegramBot|Slackbot|LinkedInBot|Discordbot|Pinterest|SkypeUriPreview|Viber|Snapchat|redditbot|Iframely|Embedly/i
    .test(request.headers.get('User-Agent') ?? '');

export function shareCardHtml(title: string, desc: string, image: string, url: string, lang: string): string {
  const e = esc;
  return '<!doctype html><html lang="' + lang + '"' + (lang === 'ar' ? ' dir="rtl"' : '') + '><head><meta charset="utf-8">' +
    '<title>' + e(title) + '</title><meta name="description" content="' + e(desc) + '">' +
    '<meta property="og:type" content="website"><meta property="og:site_name" content="Where To Spot">' +
    '<meta property="og:title" content="' + e(title) + '"><meta property="og:description" content="' + e(desc) + '">' +
    '<meta property="og:image" content="' + e(image) + '"><meta property="og:image:alt" content="' + e(title) + '">' +
    '<meta property="og:url" content="' + e(url) + '"><meta property="og:locale" content="' + (lang === 'ar' ? 'ar_EG' : 'en_US') + '">' +
    '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' + e(title) + '">' +
    '<meta name="twitter:description" content="' + e(desc) + '"><meta name="twitter:image" content="' + e(image) + '">' +
    '<link rel="icon" href="/favicon.ico?v=3" sizes="48x48"><link rel="icon" type="image/png" sizes="192x192" href="/images/favicon-192.png?v=3">' +
    '<link rel="canonical" href="' + e(url) + '"></head><body><a href="' + e(url) + '">' + e(title) + '</a></body></html>';
}

async function reviewsFor(env: Env, id: string, limit: number) {
  const { results } = await env.DB.prepare("SELECT * FROM product_reviews WHERE product_id = ? AND status = 'published' ORDER BY id DESC LIMIT " + Math.trunc(limit)).bind(id).all<Row>();
  return results.map((r) => {
    const parts = String(r.name).trim().split(/\s+/u);
    const name = !parts.length || parts[0] === '' ? 'Customer' : parts[0] + (parts.length > 1 ? ' ' + mbSubstr(parts[parts.length - 1], 0, 1) + '.' : '');
    return { id: Math.trunc(Number(r.id)), name, rating: Math.trunc(Number(r.rating)), text: r.text, date: String(r.created_at).slice(0, 10), verified: true };
  });
}
async function reviewStats(env: Env, id: string) {
  const s = await env.DB.prepare("SELECT COUNT(*) AS n, AVG(rating) AS a FROM product_reviews WHERE product_id = ? AND status = 'published'").bind(id).first<Row>();
  const n = Math.trunc(Number(s?.n ?? 0));
  return { count: n, avg: n ? round(Number(s?.a), 1) : 0 };
}

// ---------------------------------------------------------------------------------------------------------
// /p/<id>
export async function productPage(request: Request, env: Env, url: URL, ctx: Ctx): Promise<Response> {
  const id = String(url.searchParams.get('id') ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  const ar = url.searchParams.get('lang') === 'ar';
  const all = await seoProducts(ctx, ar);
  const product = all.find((p) => p.id === id) ?? null;
  let h = replaceOnce(PRODUCT_TEMPLATE, '<head>', '<head>\n<base href="/">');
  if (!product) return html(replaceOnce(h, '<head>', '<head>\n<meta name="robots" content="noindex">'), 404);

  const title: string = product.seoTitle, desc: string = product.seoDesc;
  h = replaceOnce(h, '<html>', ar ? '<html lang="ar" dir="rtl">' : '<html lang="en" dir="ltr">');
  const image: string = product.imageUrls[0] ?? seoAbs(ctx, 'images/share-card.jpg');
  if (isPreviewBot(request)) return html(shareCardHtml(title, desc, image, product.url, ar ? 'ar' : 'en'), 200, 'public, max-age=300');

  const meta = (s: string, attr: string, key: string, value: string) => {
    const re = new RegExp('<meta ' + attr + '="' + key.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '" content="[^"]*">');
    const tag = '<meta ' + attr + '="' + key + '" content="' + esc(value) + '">';
    return re.test(s) ? s.replace(re, () => tag) : replaceOnce(s, '</head>', tag + '\n</head>');
  };
  h = h.replace(/<title>[\s\S]*?<\/title>/, () => '<title>' + esc(title) + '</title>');
  for (const [k, v] of Object.entries({ description: desc, 'twitter:title': title, 'twitter:description': desc, 'twitter:image': image })) h = meta(h, 'name', k, v);
  for (const [k, v] of Object.entries({ 'og:title': title, 'og:description': desc, 'og:image': image, 'og:type': 'product', 'og:url': product.url, 'og:locale': ar ? MARKET.og_locale_ar : 'en_US' })) h = meta(h, 'property', k, v);
  h = h.replace(/<meta property="og:image:(width|height)" content="[^"]*">[\t\n\x0B\f\r ]*/g, '');

  const breadcrumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: SEO_SITE, item: seoBase(ctx) + '/' },
    { '@type': 'ListItem', position: 2, name: product.catLabel, item: categoryUrl(ctx, product.cat, ar) },
    { '@type': 'ListItem', position: 3, name: product.title, item: product.url },
  ] };
  const stats = await reviewStats(env, id);
  const list = await reviewsFor(env, id, 10);
  const productLd = productJsonld(ctx, product);
  if (stats.count > 0) {
    productLd.aggregateRating = { '@type': 'AggregateRating', ratingValue: stats.avg, reviewCount: stats.count, bestRating: 5, worstRating: 1 };
    productLd.review = list.slice(0, 5).map((r) => ({ '@type': 'Review', author: { '@type': 'Person', name: r.name }, datePublished: r.date, reviewBody: r.text,
      reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5, worstRating: 1 } }));
  }
  const head = '<link rel="canonical" href="' + esc(product.url) + '">\n' +
    '<link rel="alternate" hreflang="en" href="' + esc(productUrl(ctx, id)) + '">\n' +
    '<link rel="alternate" hreflang="ar" href="' + esc(productUrl(ctx, id, true)) + '">\n' +
    '<link rel="alternate" hreflang="x-default" href="' + esc(productUrl(ctx, id)) + '">\n' +
    ldJson(productLd) + '\n' + ldJson(breadcrumbs) + '\n' +
    '<script>document.documentElement.className += " js";</script><style>.js #seo-product{display:none}</style>\n';
  h = replaceOnce(h, '</head>', head + '</head>');

  const sizes = product.sizes.length > 1 ? '<ul>' + (product.sizes as Row[]).map((s) =>
    '<li>' + esc(s.label) + ': ' + esc(money(s.price, ar)) + (s.stock > 0 ? '' : ar ? ' (نفد)' : ' (sold out)') + '</li>').join('') + '</ul>' : '';
  const reviewsHtml = stats.count ? '<h2>' + (ar ? 'التقييمات' : 'Reviews') + ' (' + stats.count + ', ' + stats.avg + '/5)</h2>' +
    list.map((r) => '<p><strong>' + esc(r.name) + '</strong> · ' + '★'.repeat(r.rating) + ' · ' + (ar ? 'مشتري مؤكد' : 'verified purchase') + '<br>' + esc(r.text) + '</p>').join('') : '';
  const catText = categoryText(String(product.cat), String(product.catLabel), '', ar);
  const faq = catText.faq.length ? '<h2>' + (ar ? 'أسئلة شائعة' : 'Questions') + '</h2>' + catText.faq.map((q) => '<h3>' + esc(q[0]) + '</h3><p>' + esc(q[1]) + '</p>').join('') : '';
  const others = all.filter((p) => p.cat === product.cat && p.id !== product.id).slice(0, 6);
  const related = others.length ? '<h2>' + (ar ? 'منتجات مشابهة' : 'Related products') + '</h2><ul>' + others.map((p) => '<li><a href="' + esc(p.url) + '">' + esc(p.title) + '</a>: ' + esc(priceText(p, ar)) + '</li>').join('') +
    '</ul><p><a href="' + esc(categoryUrl(ctx, product.cat, ar)) + '">' + (ar ? 'كل منتجات ' : 'All ') + esc(product.catLabel) + '</a></p>' : '';
  const features = product.features.length && !ar ? '<ul>' + (product.features as string[]).map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>' : '';
  const notUs = product.brand !== SEO_SITE;
  const stat = '<article id="seo-product" style="max-width:760px;margin:24px auto;padding:0 20px;font-family:system-ui,sans-serif;line-height:1.6">' +
    '<p><a href="/">' + SEO_SITE + '</a> › <a href="' + esc(categoryUrl(ctx, product.cat, ar)) + '">' + esc(product.catLabel) + '</a></p>' +
    '<h1>' + esc(product.title) + '</h1>' +
    '<p><strong>' + (ar ? 'باختصار: ' : 'In short: ') + '</strong>' + esc(product.title) + (notUs ? (ar ? ' من ' : ' by ') + esc(product.brand) : '') + (ar ? '، ' : ', ') +
      esc(priceText(product, ar)) + (ar ? '، ' : ', ') + (product.inStock ? (ar ? 'متوفر' : 'in stock') : (ar ? 'غير متوفر حاليًا' : 'out of stock')) +
      (ar ? '، توصيل لكل مصر خلال 2–5 أيام والدفع عند الاستلام.' : ', delivered across Egypt in 2–5 days with cash on delivery.') + '</p>' +
    (product.partner ? '<p>' + (ar ? 'من ' : 'By ') + esc(product.brand) + (ar ? ' — شريك رسمي، منتجات أصلية من العلامة مباشرة.' : ' — official partner; original products supplied directly by the brand.') + '</p>' : '') +
    (product.imageUrls.length ? '<img src="' + esc(product.imageUrls[0]) + '" alt="' + esc(product.title + (notUs ? ' – ' + product.brand : '')) + '" width="480" style="max-width:100%;height:auto">' : '') +
    '<p><strong>' + esc(priceText(product, ar)) + '</strong> · ' + (product.inStock ? (ar ? 'متوفر' : 'In stock') : (ar ? 'غير متوفر حاليًا' : 'Out of stock')) + '</p>' + sizes +
    (product.summary ? '<p>' + esc(product.summary) + '</p>' : '') + (product.text ? '<p>' + nl2br(esc(product.text)) + '</p>' : '') + features +
    '<p>' + (ar ? 'توصيل لكل مصر خلال 2–5 أيام · الدفع عند الاستلام أو بالبطاقة أو المحفظة · ' + (product.cat === 'coffee' ? 'الاسترجاع للأكياس المقفولة بالسعر الكامل فقط.' : 'استرجاع خلال 14 يوم.') : 'Delivery across Egypt in 2–5 days · cash on delivery, card or mobile wallet · ' + (product.cat === 'coffee' ? 'returns on unopened, full-price bags only.' : '14-day returns.')) +
    ' <a href="/shipping-policy.html">' + (ar ? 'التوصيل' : 'Delivery') + '</a> · <a href="/refund-policy.html">' + (ar ? 'الاسترجاع' : 'Returns') + '</a></p>' + reviewsHtml + faq + related + '</article>';
  h = replaceOnce(h, '<body>', '<body>\n' + stat);
  return html(h, 200, 'public, max-age=300');
}

// ---------------------------------------------------------------------------------------------------------
// /c/<category> and /b/<brand>
export async function categoryPage(request: Request, env: Env, url: URL, ctx: Ctx): Promise<Response> {
  const ar = url.searchParams.get('lang') === 'ar';
  const catKey = String(url.searchParams.get('c') ?? '').replace(/[^a-z0-9_-]/g, '');
  const brandSlug = String(url.searchParams.get('b') ?? '').replace(/[^a-z0-9_-]/g, '');
  const L = (en: string, a: string) => (ar ? a : en);
  const e = esc;
  let page: Row | null = null;
  const catalog = await seoCatalog(ctx, ar);
  if (catKey !== '') {
    for (const c of catalog) if (c.key === catKey) {
      const t = categoryText(c.key, c.label, c.descr, ar);
      page = { kind: 'category', name: c.label, title: t.title, intro: t.intro, faq: t.faq, products: c.products,
        url: categoryUrl(ctx, c.key, ar), en: categoryUrl(ctx, c.key), ar: categoryUrl(ctx, c.key, true) };
    }
  } else if (brandSlug !== '') {
    for (const b of await loadBrands(env.DB, true)) if (b.slug === brandSlug) {
      const name = ar && b.nameAr ? b.nameAr : b.name;
      const products = (await seoProducts(ctx, ar)).filter((p) => p.brandId === b.id);
      const about = String(ar && b.aboutAr ? b.aboutAr : b.about ?? '').trim();
      page = { kind: 'brand', name, title: name + ' — ' + L('official partner', 'شريك رسمي'), intro: about !== '' ? about : String(b.tagline ?? ''), faq: [],
        products, logo: b.logo ?? '', url: brandUrl(ctx, b.slug, ar), en: brandUrl(ctx, b.slug), ar: brandUrl(ctx, b.slug, true) };
    }
  }
  if (!page) return html('<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Not found</title><p style="font:16px system-ui;text-align:center;margin-top:30vh"><a href="/">Where To Spot</a></p>', 404);

  const products = page.products as Row[];
  const desc = mbSubstr(page.intro, 0, 155);
  const lowest = products.length ? Math.min(...products.map((p) => Number(p.low))) : 0;
  const base = seoBase(ctx);
  const crumbs: [string, string][] = [['Where To Spot', base + '/' + (ar ? '?lang=ar' : '')], [page.name, page.url]];
  const ld: Row = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'CollectionPage', '@id': page.url + '#page', url: page.url, name: page.title, description: page.intro, inLanguage: ar ? 'ar' : 'en',
      isPartOf: { '@type': 'WebSite', name: SEO_SITE, url: base + '/' },
      mainEntity: { '@type': 'ItemList', numberOfItems: products.length, itemListElement: products.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: p.url, name: p.title })) } },
    { '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: c[1] })) },
  ] };
  if (page.faq.length) ld['@graph'].push({ '@type': 'FAQPage', mainEntity: (page.faq as [string, string][]).map((q) => ({ '@type': 'Question', name: q[0], acceptedAnswer: { '@type': 'Answer', text: q[1] } })) });
  const img = (p: Row) => { const src = p.images[0] ?? ''; return src ? '/api/img.php?src=' + rawurlencode(typeof src === 'object' ? src.path : src) + '&w=600' : ''; };
  const lq = ar ? '?lang=ar' : '';

  // The PHP template drops the line break right after every "?>"; the strings below keep that exactly.
  let o = '<!doctype html>\n<html lang="' + (ar ? 'ar' : 'en') + '"' + (ar ? ' dir="rtl"' : '') + '>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + e(page.title) + ' | Where To Spot</title>\n<meta name="description" content="' + e(desc) + '">\n<link rel="canonical" href="' + e(page.url) + '">\n' +
    '<link rel="alternate" hreflang="en" href="' + e(page.en) + '">\n<link rel="alternate" hreflang="ar" href="' + e(page.ar) + '">\n<link rel="alternate" hreflang="x-default" href="' + e(page.en) + '">\n' +
    '<meta property="og:type" content="website"><meta property="og:site_name" content="Where To Spot">\n' +
    '<meta property="og:title" content="' + e(page.title) + '"><meta property="og:description" content="' + e(desc) + '"><meta property="og:url" content="' + e(page.url) + '">\n' +
    '<meta property="og:image" content="' + e(products[0]?.imageUrls[0] ?? base + '/images/share-card.jpg') + '"><meta property="og:locale" content="' + (ar ? MARKET.og_locale_ar : 'en_US') + '">\n' +
    '<link rel="icon" href="/favicon.ico?v=3" sizes="48x48"><link rel="icon" type="image/png" sizes="192x192" href="/images/favicon-192.png?v=3">\n' +
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Work+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">\n' +
    '<link rel="stylesheet" href="/site.css">\n<meta name="theme-color" content="#22201D">\n' +
    '<script type="application/ld+json">' + phpJson(ld).replace(/</g, '\\u003C').replace(/>/g, '\\u003E') + '</script>\n' +
    CATEGORY_STYLE +
    '</head>\n<body>\n<div class="bar">' + L('All prices in Egyptian Pounds (EGP) · Delivery across Egypt · Cash on delivery', 'كل الأسعار بالجنيه المصري · توصيل لكل مصر · الدفع عند الاستلام') + '</div>\n' +
    '<nav><div class="in"><a class="brand" href="/' + lq + '"><img src="/images/logo-mark.png?v=3" alt="Where To Spot logo" width="40" height="40">Where To Spot</a><div class="links"><a href="/' + lq + '">' + L('Shop', 'المتجر') + '</a><a href="/plans.html">' + L('Marketing plans', 'خطط التسويق') + '</a><a href="/google-review-link.html' + lq + '">' + L('Free review link', 'رابط تقييم مجاني') + '</a><a href="/about.html">' + L('About us', 'من نحن') + '</a><a href="/contact.html">' + L('Contact us', 'تواصل معنا') + '</a><a href="' + e(ar ? page.en : page.ar) + '" hreflang="' + (ar ? 'en' : 'ar') + '">' + (ar ? 'English' : 'العربية') + '</a></div></div></nav>\n' +
    '<main class="wide">\n<nav class="crumbs" aria-label="Breadcrumb"><a href="/' + lq + '">Where To Spot</a> › <span aria-current="page">' + e(page.name) + '</span></nav>\n' +
    (page.logo ? '<img src="/' + e(page.logo) + '" alt="' + e(page.name) + '" width="72" height="72" style="border-radius:50%;margin-top:18px;object-fit:contain;background:#fff">' : '') +
    '<h1>' + e(page.title) + '</h1>\n<p>' + e(page.intro) + '</p>\n<ul class="facts">\n' +
    (products.length ? '<li>✓ ' + products.length + ' ' + L('products', 'منتج') + ' · ' + L('from', 'من') + ' ' + e(money(lowest, ar)) + '</li>' : '') +
    '<li>✓ ' + L('Delivery across Egypt in 2–5 days', 'توصيل لكل مصر خلال 2–5 أيام') + '</li><li>✓ ' + L('Cash on delivery, card or wallet', 'الدفع عند الاستلام أو بالبطاقة أو المحفظة') + '</li><li>✓ ' + L('14-day returns', 'استرجاع خلال 14 يوم') + '</li>\n</ul>\n' +
    '<h2>' + L('Products', 'المنتجات') + '</h2>\n<div class="grid">\n';
  for (const p of products) {
    o += '<a class="pc" href="' + e(p.url) + '"><span class="im">' + (img(p) ? '<img src="' + e(img(p)) + '" alt="' + e(p.title) + '" loading="lazy" width="300" height="300">' : '') + '</span>\n' +
      '<span class="tx"><h3>' + e(p.title) + '</h3><span class="pr">' + e(priceText(p, ar)) + '</span>' + (p.summary ? '<small>' + e(p.summary) + '</small>' : '') + (!p.inStock ? '<small>' + L('Out of stock', 'غير متوفر حاليًا') + '</small>' : '') + '</span></a>\n';
  }
  o += '</div>\n';
  if (page.faq.length) {
    o += '<h2>' + L('Questions', 'أسئلة شائعة') + '</h2>\n';
    for (const q of page.faq as [string, string][]) o += '<details><summary>' + e(q[0]) + '</summary><p>' + e(q[1]) + '</p></details>';
  }
  if (page.kind === 'category' && ['nfc', 'stands'].includes(catKey)) {
    o += '<p><a class="btn alt" href="/google-review-link.html' + lq + '">' + L('Free: make your Google review link & QR', 'مجانًا: اعمل رابط تقييم جوجل وكود QR') + '</a></p>\n';
  }
  o += '<p><a class="btn" href="/' + lq + '#products">' + L('Visit the shop', 'زيارة المتجر') + '</a></p>\n</main>\n<footer><div class="in">\n' +
    '<span>© 2026 Where To Spot · ' + L('MQR, El Wahat Road, 6th of October City, Giza, Egypt', 'MQR، طريق الواحات، مدينة 6 أكتوبر، الجيزة، مصر') + ' · <a href="mailto:info@wheretospot.com">info@wheretospot.com</a> · <a href="tel:+201277660666">+20 127 766 0666</a></span>\n';
  for (const c of catalog) o += '<a href="' + e(categoryUrl(ctx, c.key, ar)) + '">' + e(c.label) + '</a>';
  o += '<a href="/about.html">' + L('About us', 'من نحن') + '</a><a href="/shipping-policy.html">' + L('Delivery & shipping', 'التوصيل') + '</a><a href="/refund-policy.html">' + L('Refund & cancellation', 'الاسترجاع') + '</a>\n' +
    '</div></footer>\n<script src="/api/track.php" async></script>\n<script src="/chat.js" defer></script>\n</body>\n</html>\n';
  return html(o, 200, 'public, max-age=600');
}

const CATEGORY_STYLE = `<style>
  main.wide{max-width:1100px}
  .crumbs{font-size:13px;color:#8A8478}.crumbs a{color:#6B6660;text-decoration:none}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin:26px 0}
  .pc{background:#fff;border:1px solid #DDD6CC;border-radius:16px;overflow:hidden;text-decoration:none;color:#22201D;display:flex;flex-direction:column}
  .pc:hover{border-color:#A8552F}
  .pc .im{aspect-ratio:1;background:#F6F2EC;display:grid;place-items:center}.pc img{width:100%;height:100%;object-fit:contain}
  .pc .tx{padding:14px;display:flex;flex-direction:column;gap:4px}
  .pc h3{font-size:15.5px;line-height:1.35;margin:0;font-family:'Work Sans',sans-serif;font-weight:600}.pc .pr{color:#A8552F;font-weight:700}.pc small{color:#6B6660;font-size:13px}
  .facts{display:flex;gap:10px 22px;flex-wrap:wrap;font-size:14px;color:#3E3A35;margin:12px 0 0;padding:0;list-style:none}
  html[lang=ar] body{line-height:1.85}
</style>
`;

// ---------------------------------------------------------------------------------------------------------
// The homepage's catalogue for crawlers (between <!--seo:home--> and <!--/seo:home-->), built from the database on
// every request instead of being written into index.html (seo_publish_home in PHP).
export async function withHomeBlock(h: string, ctx: Ctx): Promise<string> {
  const a = h.indexOf('<!--seo:home-->'), b = h.indexOf('<!--/seo:home-->');
  if (a < 0 || b < 0 || b < a) return h;
  return h.slice(0, a) + '<!--seo:home--><div id="seo-home">' + (await seoHomeBlock(ctx)) + '</div>' + h.slice(b);
}

// ---------------------------------------------------------------------------------------------------------
// ?lang=ar pages (api/page.php)
const PAGE_AR: Record<string, { file: string; title: string; desc: string }> = {
  index: { file: 'index.html', title: 'كروت وستاندات NFC لتقييمات جوجل والمزيد في مصر | Where To Spot',
    desc: 'متجر Where To Spot في مصر: كروت وستاندات NFC لتقييمات جوجل، ستاندات أكريليك، قهوة مختصة، منتجات عناية كورية، وخطط تسويق. توصيل لكل مصر والدفع عند الاستلام.' },
  'google-review-link': { file: 'google-review-link.html', title: 'رابط تقييم جوجل وكود QR مجانًا لنشاطك — Where To Spot',
    desc: 'هات رابط تقييم جوجل لنشاطك مجانًا: الصق رابط خرائط جوجل وخد رابط التقييم الرسمي، وكارت QR للطباعة، وزرار تقييم لموقعك.' },
  about: { file: 'about.html', title: 'من نحن — Where To Spot',
    desc: 'Where To Spot استوديو تسويق ومتجر أونلاين في مدينة 6 أكتوبر، الجيزة: كروت تقييم NFC، ستاندات أكريليك، خطط جلب عملاء والمزيد.' },
  contact: { file: 'contact.html', title: 'تواصل معنا — Where To Spot',
    desc: 'تواصل مع Where To Spot: واتساب وتليفون 01277660666، إيميل info@wheretospot.com، والعنوان في مدينة 6 أكتوبر، الجيزة. بنرد خلال يوم عمل.' },
  sell: { file: 'sell.html', title: 'بيع منتجاتك مع Where To Spot',
    desc: 'عندك براند أو منتجات؟ ابعتها لنا وإحنا نعرضها في متجرنا ونسوّق لها بالإعلانات والسوشيال ميديا مقابل عمولة متفق عليها، لكل مصر.' },
  plans: { file: 'plans.html', title: 'خطط جلب العملاء الشهرية — Where To Spot',
    desc: 'خطط تسويق شهرية للشركات في مصر من 299 ج.م: إعلانات، صفحات هبوط، CRM وأتمتة. من غير عقود، وضمان استرداد خلال 14 يوم في أول شهر.' },
  'privacy-policy': { file: 'privacy-policy.html', title: 'سياسة الخصوصية — Where To Spot',
    desc: 'إزاي Where To Spot بتجمع وتستخدم وتحمي بياناتك لما تشتري أو تدفع أونلاين أو تكلمنا واتساب أو تستخدم أدواتنا المجانية، وحقوقك.' },
  'refund-policy': { file: 'refund-policy.html', title: 'سياسة الاسترجاع والإلغاء — Where To Spot',
    desc: 'الاسترجاع في Where To Spot: 14 يوم للمنتجات اللي ما اتستخدمتش، وإلغاء خطط التسويق في أي وقت مع ضمان استرداد خلال 14 يوم في أول شهر.' },
  'shipping-policy': { file: 'shipping-policy.html', title: 'سياسة التوصيل والشحن — Where To Spot',
    desc: 'التوصيل من Where To Spot: لكل مصر خلال 2–5 أيام عمل، 75 ج.م أو مجانًا للطلبات فوق 1,500 ج.م، والدفع عند الاستلام أو بالبطاقة أو المحفظة.' },
  terms: { file: 'terms.html', title: 'الشروط والأحكام — Where To Spot',
    desc: 'الشروط والأحكام للشراء من Where To Spot في مصر: الطلبات، الأسعار بالجنيه، الدفع، التوصيل، الاسترجاع، المنتجات المخصصة وخطط التسويق.' },
};
const reQuote = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/=:-]/g, '\\$&');

export async function arPage(request: Request, env: Env, url: URL, ctx: Ctx): Promise<Response> {
  const key = String(url.searchParams.get('f') ?? '').replace(/[^a-z-]/g, '');
  const page = PAGE_AR[key];
  const res = page ? await env.ASSETS.fetch(new Request(new URL('/' + page.file, url))) : null;
  if (!page || !res || res.status !== 200) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
  if (url.searchParams.get('lang') !== 'ar') return new Response(null, { status: 301, headers: { Location: '/' + (key === 'index' ? '' : page.file) } });
  let h = await res.text();
  if (key === 'index') h = await withHomeBlock(h, ctx);

  const pageUrl = seoBase(ctx) + '/' + (key === 'index' ? '' : page.file) + '?lang=ar';
  const set = (s: string, re: RegExp, withText: string) => s.replace(re, () => withText);
  h = set(h, /<html[^>]*>/, '<html lang="ar" dir="rtl">');
  h = set(h, /<title>[\s\S]*?<\/title>/, '<title>' + esc(page.title) + '</title>');
  for (const m of ['name="description"', 'property="og:description"', 'name="twitter:description"']) h = set(h, new RegExp('<meta ' + reQuote(m) + ' content="[^"]*">'), '<meta ' + m + ' content="' + esc(page.desc) + '">');
  for (const m of ['property="og:title"', 'name="twitter:title"']) h = set(h, new RegExp('<meta ' + reQuote(m) + ' content="[^"]*">'), '<meta ' + m + ' content="' + esc(page.title) + '">');
  h = set(h, /<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + esc(pageUrl) + '">');
  h = set(h, /<meta property="og:locale" content="[^"]*">/, '<meta property="og:locale" content="' + MARKET.og_locale_ar + '">');
  h = set(h, /<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + esc(pageUrl) + '">');

  // Only the Arabic text: each English-only block whose inside holds no other block of the same kind goes.
  // (PCRE's \s and \b without the u flag are ASCII, as here.)
  for (const tag of ['main', 'article', 'aside', 'section', 'div', 'p', 'li', 'span']) {
    const re = new RegExp('<' + tag + '\\b[^>]*\\bclass="(?:[^"]*[\\t\\n\\x0B\\f\\r ])?en-only(?:[\\t\\n\\x0B\\f\\r ][^"]*)?"[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'g');
    const inner = new RegExp('<' + tag + '\\b', 'i');
    h = h.replace(re, (all, body: string) => (inner.test(body) ? all : ''));
  }
  if (key === 'index') h = h.replace(/<section lang="en">[\s\S]*?<\/section>/, '');
  return new Response(h, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Language': 'ar', 'Cache-Control': 'public, max-age=300' } });
}

// ---------------------------------------------------------------------------------------------------------
// /api/track.php: the Meta Pixel and GA4 loader, empty when their IDs aren't set.
export function trackScript(env: Env): Response {
  const pixel = /^\d{6,20}$/.test(env.META_PIXEL_ID ?? '') ? String(env.META_PIXEL_ID) : '';
  const ga4 = /^G-[A-Z0-9]{4,16}$/.test(env.GA4_ID ?? '') ? String(env.GA4_ID) : '';
  return new Response(trackJs(JSON.stringify(pixel), JSON.stringify(ga4)), { headers: {
    'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=600', 'X-Content-Type-Options': 'nosniff' } });
}

// ---------------------------------------------------------------------------------------------------------
// /api/seo.php?f=sitemap|feed|llms, and /sitemap.xml and /llms.txt at the root (files PHP rewrote now and then).
export async function seoFile(f: string, ctx: Ctx): Promise<Response> {
  const cache = { 'Cache-Control': 'public, max-age=900' };
  if (f === 'feed') return new Response(await seoFeed(ctx), { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', ...cache } });
  if (f === 'llms') return new Response(await seoLlms(ctx), { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...cache } });
  return new Response(await seoSitemap(ctx), { headers: { 'Content-Type': 'application/xml; charset=utf-8', ...cache } });
}
