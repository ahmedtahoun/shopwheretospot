// The review link sent after delivery, /rate/<token> (port of api/review-page.php and the token part of
// api/review-requests.php): the order's products with stars and a comment, no sign-in needed.
// Sending the review requests themselves comes with the admin / messaging ports.
import { esc, phpTrim, phpInt, phpStr } from '../lib/php';
import { type Row } from '../lib/catalog';
import { type Shop, ShopError, makeShop, strIn, phoneKey, orderNumber, logActivity } from '../lib/shop';
import { customerRememberOrder } from '../lib/customers';
import { validEmail } from '../lib/php';
import { reviewCss } from '../data/review-css';
import { reviewJs } from '../data/review-js';
import type { Env } from '../index';

export async function reviewOrderByToken(s: Shop, t: string): Promise<Row | null> {
  if (!/^[a-f0-9]{24}$/.test(t)) return null;
  return s.db.prepare("SELECT * FROM orders WHERE review_token = ? AND status = 'Delivered'").bind(t).first<Row>();
}

function reviewOrderProducts(o: Row): Row[] {
  let items: Row[] = []; try { items = JSON.parse(String(o.items)) || []; } catch { /* none */ }
  const out = new Map<string, Row>();
  for (const i of items) {
    const id = phpStr(i.id ?? '');
    if (id === '' || id === 'custom' || (i.cat ?? '') === 'services' || out.has(id)) continue;
    const name = String(i.name ?? '');
    out.set(id, { id, name: name.replace(/ — [^—]*$/u, '') || name });
  }
  return [...out.values()];
}

async function reviewCustomer(s: Shop, o: Row): Promise<number> {
  let email = phpTrim(String(o.email ?? '')).toLowerCase();
  if (!validEmail(email)) email = 'phone-' + (phoneKey(String(o.phone ?? '')) || 'order' + o.id) + '@buyers.wheretospot.invalid';
  await s.db.prepare('INSERT OR IGNORE INTO customers (email) VALUES (?)').bind(email).run();
  const c = (await s.db.prepare('SELECT * FROM customers WHERE email = ?').bind(email).first<Row>())!;
  if (c.name === '' && c.phone === '') await customerRememberOrder(s, phpInt(c.id), o);
  return phpInt(c.id);
}

async function reviewPageData(s: Shop, o: Row): Promise<Row> {
  const cid = await reviewCustomer(s, o);
  const products: Row[] = [];
  for (const p of reviewOrderProducts(o)) {
    const [img, mine, ar] = await s.db.batch([
      s.db.prepare('SELECT path FROM product_images WHERE product_id = ? ORDER BY sort LIMIT 1').bind(p.id),
      s.db.prepare('SELECT rating, text FROM product_reviews WHERE customer_id = ? AND product_id = ?').bind(cid, p.id),
      s.db.prepare('SELECT name_ar FROM products WHERE id = ?').bind(p.id),
    ]);
    const r = mine.results[0] as Row | undefined;
    products.push({ id: p.id, name: p.name, nameAr: String((ar.results[0] as Row | undefined)?.name_ar || ''), img: String((img.results[0] as Row | undefined)?.path || ''),
      rating: r ? phpInt(r.rating) : 0, text: r ? r.text : '' });
  }
  return { number: orderNumber(phpInt(o.id)), name: String(o.customer ?? ''), products, google: String(s.env.GOOGLE_REVIEW_URL ?? '') };
}

export async function reviewSaveToken(s: Shop, t: string, b: Row): Promise<Row> {
  const o = await reviewOrderByToken(s, t);
  if (!o) throw new ShopError('This review link isn’t valid any more.');
  const cid = await reviewCustomer(s, o);
  const name = phpTrim(strIn(b.name, 60)) || String(o.customer ?? '');
  const allowed = reviewOrderProducts(o).map((p) => p.id);
  let saved = 0;
  for (const r of (Array.isArray(b.reviews) ? b.reviews : []).slice(0, 30)) {
    const pid = phpStr(r?.product_id ?? '');
    const rating = phpInt(r?.rating ?? 0);
    if (!allowed.includes(pid) || rating < 1 || rating > 5) continue;
    const text = phpTrim(strIn(r.text, 1500));
    const ex = await s.db.prepare('SELECT id FROM product_reviews WHERE customer_id = ? AND product_id = ?').bind(cid, pid).first<Row>();
    if (ex) {
      await s.db.prepare("UPDATE product_reviews SET name = ?, rating = ?, text = ?, order_id = ?, updated_at = datetime('now') WHERE id = ?").bind(name, rating, text, phpInt(o.id), ex.id).run();
    } else {
      await s.db.prepare('INSERT INTO product_reviews (product_id, customer_id, order_id, name, rating, text) VALUES (?, ?, ?, ?, ?, ?)').bind(pid, cid, phpInt(o.id), name, rating, text).run();
      await logActivity(s, null, 'New product review', pid + ' · ' + '★'.repeat(rating) + ' · ' + name + ' · ' + orderNumber(phpInt(o.id)));
    }
    saved++;
  }
  if (!saved) throw new ShopError('Choose the stars for at least one product.');
  return { saved };
}

export async function reviewPage(request: Request, env: Env, url: URL, ec: ExecutionContext): Promise<Response> {
  const s = makeShop(request, env, ec);
  const t = url.searchParams.get('t') ?? '';
  const o = await reviewOrderByToken(s, t);
  const q = url.searchParams.get('lang') ?? '';
  const ar = q === 'ar' || (q !== 'en' && (!o || o.lang !== 'en'));
  const e = esc;
  const T = (en: string, a: string) => (ar ? a : en);
  const d = o ? await reviewPageData(s, o) : null;
  const first = d ? (phpTrim(String(d.name)).split(/\s+/u)[0] ?? '') : '';
  const lq = ar ? '?lang=ar' : '';
  // The PHP template drops the line break right after every "?>"; the strings below keep that exactly.
  let h = '<!DOCTYPE html>\n<html lang="' + (ar ? 'ar' : 'en') + '" dir="' + (ar ? 'rtl' : 'ltr') + '">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n'
    + '<title>' + e(T('Rate your order — Where To Spot', 'قيّم طلبك — Where To Spot')) + '</title>\n<link rel="icon" href="/favicon.ico?v=3" sizes="48x48">\n'
    + '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    + '<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Work+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">\n'
    + '<style>\n' + reviewCss(ar) + '</style>\n</head>\n<body>\n<div class="wrap">\n'
    + '<a class="top" href="/' + lq + '"><img src="/images/logo-mark.png?v=3" alt="">Where To Spot</a>\n';
  if (!d) {
    h += '  <h1>' + e(T('This link has expired', 'الرابط ده مش شغال')) + '</h1>\n'
      + '  <p class="lead">' + e(T('It may be for an order that isn’t delivered yet. Message us on WhatsApp and we’ll help.', 'ممكن يكون لطلب لسه موصلش. كلمنا على واتساب وهنساعدك.')) + '</p>\n'
      + '  <a class="btn" href="https://wa.me/201277660666">' + e(T('WhatsApp us', 'كلمنا على واتساب')) + '</a>\n';
  } else {
    h += '  <div id="form">\n'
      + '  <h1>' + e(ar ? 'أهلًا ' + first + '، طلبك عجبك؟' : 'Hi ' + first + ', how was your order?') + '</h1>\n'
      + '  <p class="lead">' + e(T('Tap the stars for each product. A few words help other customers a lot (optional).', 'اختار النجوم لكل منتج. كلمتين عن رأيك بيساعدوا عملاء تانيين جدًا (اختياري).'))
      + '<br><span style="font-size:13px">' + e(T('Order', 'طلب')) + ' ' + e(d.number) + '</span></p>\n';
    for (const p of d.products as Row[]) {
      const name = ar && p.nameAr !== '' ? p.nameAr : p.name;
      let stars = '';
      for (let i = 1; i <= 5; i++) stars += '<button type="button" data-s="' + i + '" aria-label="' + i + '">★</button>';
      h += '  ' + '  <div class="card" data-p="' + e(p.id) + '" data-r="' + phpInt(p.rating) + '">\n'
        + '    <div class="p">' + (p.img ? '<img src="/img/200/' + e(p.img) + '" alt="" loading="lazy">' : '<span class="ph"></span>') + '<b>' + e(name) + '</b></div>\n'
        + '    <div class="stars" role="radiogroup" aria-label="' + e(T('Rating', 'التقييم')) + '">' + stars + '</div>\n'
        + '    <textarea maxlength="1500" placeholder="' + e(T('What did you like? How’s the quality?', 'إيه اللي عجبك؟ الجودة عاملة إزاي؟')) + '">' + e(p.text) + '</textarea>\n'
        + '  </div>\n';
    }
    h += '  ' + '  <div class="card">\n'
      + '    <label for="nm">' + e(T('Your name', 'اسمك')) + '</label>\n'
      + '    <input id="nm" maxlength="60" value="' + e(d.name) + '" autocomplete="name">\n'
      + '    <div class="hint">' + e(T('Shown as your first name and last initial, with a “verified purchase” badge.', 'هيظهر اسمك الأول وأول حرف من اسم العيلة، مع علامة “مشتري مؤكد”.')) + '</div>\n'
      + '  </div>\n'
      + '  <button class="btn" id="send">' + e(T('Send my review', 'ابعت تقييمي')) + '</button>\n'
      + '  <div class="err" id="err" role="alert"></div>\n'
      + '  </div>\n'
      + '  <div class="card done" id="done" hidden>\n'
      + '    <div class="ok">✓</div>\n'
      + '    <h1>' + e(T('Thank you!', 'شكرًا ليك!')) + '</h1>\n'
      + '    <p class="lead">' + e(T('Your review is on the product page now.', 'تقييمك ظاهر دلوقتي في صفحة المنتج.')) + '</p>\n'
      + '    ' + (d.google !== '' ? '<a class="btn" href="' + e(d.google) + '" target="_blank" rel="noopener">⭐ ' + e(T('Also rate us on Google', 'قيّمنا كمان على جوجل')) + '</a>' : '')
      + '    <a class="btn line" href="/' + lq + '">' + e(T('Back to the shop', 'ارجع للمتجر')) + '</a>\n'
      + '  </div>\n';
  }
  h += '</div>\n' + (d ? reviewJs(t, T) : '') + '</body>\n</html>\n';
  return new Response(h, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' } });
}
