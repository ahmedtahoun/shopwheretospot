// The review-link tool: its business pages (/r/<slug>, port of api/qr-page.php) and the account read
// (api/qr.php?action=me). Helpers are ports of api/qrtool.php; the writes come with the checkout phase.
import { esc, mbSubstr, rawurlencode, phpJsonU, phpInt, phpFloat, phpTrim } from '../lib/php';
import { type Row } from '../lib/catalog';
import { jsonOut } from './public';
import { isPreviewBot } from './pages';
import { type Shop, ShopError, makeShop, readBody, strIn, tooManyAttempts, recordAttempt, logActivity, opsError, orderNumber } from '../lib/shop';
import { currentCustomer, customerSendCode, customerVerify, customerLogout } from '../lib/customers';
import { paymobVisible, paymobCheckoutUrl } from '../lib/paymob';
import { setOrderStatus } from '../lib/orders';
import { randomHex } from '../lib/php';
import type { Env } from '../index';

export const QR_FREE = 2;
export const QR_PACKS: Record<string, Row> = {
  starter: { credits: 5, price: 300, en: 'Starter', ar: 'البداية' },
  business: { credits: 15, price: 750, en: 'Business', ar: 'الأعمال' },
  agency: { credits: 40, price: 1600, en: 'Agency', ar: 'الوكالات' },
};
export const QR_LINK_TYPES = ['whatsapp', 'phone', 'instagram', 'facebook', 'tiktok', 'website', 'menu', 'location', 'email', 'custom'];
export const QR_COLORS = ['#A8552F', '#22201D', '#2C5DA8', '#1F7A4D', '#7D3C93', '#A33650'];

const siteUrl = (env: Env): string => env.SITE_URL.replace(/\/+$/, '');
export const qrPageUrl = (env: Env, slug: string): string => siteUrl(env) + '/r/' + rawurlencode(slug);

const AR_DIGITS: Record<string, string> = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
const westernDigits = (s: string): string => s.replace(/[٠-٩]/g, (c) => AR_DIGITS[c]);

// wa_id_from_phone (api/whatsapp.php) for Egypt.
export function waIdFromPhone(phone: string): string | null {
  let d = westernDigits(phone).replace(/\D/g, '');
  if (d === '') return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (/^01\d{9}$/.test(d)) d = '20' + d.slice(1);
  if (/^1\d{9}$/.test(d)) d = '20' + d;
  return d.length >= 10 ? d : null;
}

// filter_var(FILTER_VALIDATE_EMAIL), close enough for links the owner typed (ASCII local part and domain).
const validEmail = (v: string): boolean =>
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/.test(v) && v.length <= 320;

export function qrLinkHref(l: Row): string {
  const v = String(l.value ?? '').trim();
  if (v === '') return '';
  const digits = westernDigits(v).replace(/\D/g, '');
  const handle = v.replace(/^https?:\/\/(www\.)?[^/]+\//i, '').replace(/^[@/]+/, '');
  switch (l.type) {
    case 'whatsapp': { const id = waIdFromPhone(digits); return id ? 'https://wa.me/' + id : ''; }
    case 'phone': return digits.length >= 6 ? 'tel:+' + (digits.startsWith('0') ? '20' + digits.slice(1) : digits) : '';
    case 'email': return validEmail(v) ? 'mailto:' + v : '';
    case 'instagram': return /^https?:\/\//i.test(v) ? v : handle !== '' ? 'https://instagram.com/' + rawurlencode(handle) : '';
    case 'tiktok': return /^https?:\/\//i.test(v) ? v : handle !== '' ? 'https://www.tiktok.com/@' + rawurlencode(handle) : '';
    default: return /^https?:\/\/[^\t\n\x0B\f\r <>"]+$/i.test(v) ? v : /^[A-Za-z0-9_.-]+\.[a-z]{2,}(\/[^\t\n\x0B\f\r ]*)?$/i.test(v) ? 'https://' + v : '';
  }
}

export function qrPageClean(p: Row): Row {
  const out: Row = { lang: p.lang === 'ar' ? 'ar' : 'en', color: QR_COLORS.includes(p.color) ? p.color : QR_COLORS[0],
    tagline: mbSubstr(String(p.tagline ?? '').trim(), 0, 140),
    logo: /^uploads\/qr\/[a-f0-9]{24}\.(jpg|png)$/.test(String(p.logo ?? '')) ? p.logo : '', links: [] };
  const links = Array.isArray(p.links) ? p.links : p.links && typeof p.links === 'object' ? Object.values(p.links) : [];
  for (const raw of links.slice(0, 12)) {
    if (!raw || typeof raw !== 'object' || !QR_LINK_TYPES.includes(raw.type)) continue;
    const l = { type: raw.type, value: mbSubstr(String(raw.value ?? '').trim(), 0, 300), label: mbSubstr(String(raw.label ?? '').trim(), 0, 40) };
    if (l.value === '' || qrLinkHref(l) === '') continue;
    out.links.push(l);
  }
  return out;
}

export function qrBusinessOut(env: Env, b: Row): Row {
  let page: Row = {};
  try { const v = JSON.parse(String(b.page)); if (v && typeof v === 'object') page = v; } catch { /* empty page */ }
  return { id: Math.trunc(Number(b.id)), slug: b.slug, name: b.name, link: b.review_link, cid: b.cid, placeId: b.place_id,
    maps: b.maps, lat: b.lat !== null ? Number(b.lat) : null, lng: b.lng !== null ? Number(b.lng) : null,
    target: b.target, cardLang: b.card_lang, pageUrl: qrPageUrl(env, b.slug), page: qrPageClean(page), views: Math.trunc(Number(b.views)),
    qr: b.target === 'page' ? qrPageUrl(env, b.slug) : b.review_link, createdAt: b.created_at };
}

// The balance; an account's free codes are added the first time it's read (as in PHP).
async function qrBalance(s: Shop, customerId: number): Promise<number> {
  const has = await s.db.prepare("SELECT 1 AS x FROM qr_ledger WHERE customer_id = ? AND reason = 'free'").bind(customerId).first();
  if (!has) await s.db.prepare("INSERT INTO qr_ledger (customer_id, delta, reason) VALUES (?, ?, 'free')").bind(customerId, QR_FREE).run();
  const r = await s.db.prepare('SELECT COALESCE(SUM(delta), 0) AS n FROM qr_ledger WHERE customer_id = ?').bind(customerId).first<Row>();
  return Math.trunc(Number(r?.n ?? 0));
}

const businesses = async (s: Shop, customerId: number) =>
  (await s.db.prepare('SELECT * FROM qr_businesses WHERE customer_id = ? ORDER BY id DESC').bind(customerId).all<Row>()).results.map((b) => qrBusinessOut(s.env, b));

export async function qrMe(s: Shop, c: Row | null): Promise<Row> {
  const packs = Object.entries(QR_PACKS).map(([k, p]) => ({ id: k, credits: p.credits, price: p.price, en: p.en, ar: p.ar }));
  return { email: c ? c.email : null, balance: c ? await qrBalance(s, phpInt(c.id)) : null, free: QR_FREE,
    businesses: c ? await businesses(s, phpInt(c.id)) : [], packs, payMethods: Object.keys(paymobVisible(s)), colors: QR_COLORS };
}

const validReviewLink = (link: string): boolean => /^https:\/\/(g\.page\/r\/[A-Za-z0-9_-]{10,40}\/review|search\.google\.com\/local\/writereview\?placeid=[A-Za-z0-9_-]{10,300})$/.test(link);

// A slug from the name (ASCII), with a random ending; iconv's transliteration is approximated by dropping accents.
async function qrSlug(s: Shop, name: string): Promise<string> {
  const ascii = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x00-\x7f]/g, '');
  const base = ascii.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'business';
  for (let i = 0; i < 20; i++) {
    const slug = base + '-' + randomHex(3).slice(0, 4);
    if (!(await s.db.prepare('SELECT 1 AS x FROM qr_businesses WHERE slug = ?').bind(slug).first())) return slug;
  }
  return base + '-' + randomHex(6);
}

async function qrBusinessRow(s: Shop, customerId: number, id: number): Promise<Row> {
  const b = await s.db.prepare('SELECT * FROM qr_businesses WHERE id = ? AND customer_id = ?').bind(id, customerId).first<Row>();
  if (!b) throw new ShopError('QR code not found.', 404);
  return qrBusinessOut(s.env, b);
}

async function qrCreate(s: Shop, c: Row, input: Row): Promise<Row> {
  const link = phpTrim(String(input.link ?? ''));
  if (!validReviewLink(link)) throw new ShopError('That isn’t a Google review link. Make the link with the tool first.');
  const cid = phpInt(c.id);
  const ex = await s.db.prepare('SELECT * FROM qr_businesses WHERE customer_id = ? AND review_link = ?').bind(cid, link).first<Row>();
  if (ex) return qrBusinessOut(s.env, ex);
  if (await qrBalance(s, cid) < 1) throw new ShopError('You’ve used all your QR codes. Buy a pack to make more.', 402);
  const name = strIn(input.name, 80);
  const lang = ['ar', 'en', 'both'].includes(input.card_lang) ? input.card_lang : 'both';
  const page: Row = { lang: /\p{Script=Arabic}/u.test(name) ? 'ar' : 'en', color: QR_COLORS[0], links: [] };
  if (input.maps && /^https:\/\/(maps\.google\.com|www\.google\.com\/maps)\//.test(String(input.maps))) page.links.push({ type: 'location', value: String(input.maps) });
  const num = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) ? phpFloat(v) : null);
  const [ins] = await s.db.batch([
    s.db.prepare('INSERT INTO qr_businesses (customer_id, slug, name, review_link, cid, place_id, maps, lat, lng, target, card_lang, page) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
      .bind(cid, await qrSlug(s, name), name, link, String(input.cid ?? '').replace(/\D/g, ''), strIn(input.place_id, 300), strIn(input.maps, 300), num(input.lat), num(input.lng),
        input.target === 'page' ? 'page' : 'review', lang, phpJsonU(page)),
    s.db.prepare("INSERT INTO qr_ledger (customer_id, delta, reason, business_id) VALUES (?, -1, 'qr', last_insert_rowid())").bind(cid),
  ]);
  const id = Number((ins.results[0] as Row).id);
  await logActivity(s, null, 'QR tool: new business', name + ' · ' + c.email);
  return qrBusinessRow(s, cid, id);
}

async function qrUpdate(s: Shop, c: Row, input: Row): Promise<Row> {
  const b = await qrBusinessRow(s, phpInt(c.id), phpInt(input.id ?? 0));
  const name = input.name !== undefined && input.name !== null ? strIn(input.name, 80) : b.name;
  const target = input.target !== undefined && input.target !== null ? (input.target === 'page' ? 'page' : 'review') : b.target;
  const lang = ['ar', 'en', 'both'].includes(input.card_lang) ? input.card_lang : b.cardLang;
  const page = input.page && typeof input.page === 'object' ? qrPageClean(input.page) : b.page;
  await s.db.prepare("UPDATE qr_businesses SET name = ?, target = ?, card_lang = ?, page = ?, updated_at = datetime('now') WHERE id = ? AND customer_id = ?")
    .bind(name, target, lang, phpJsonU(page), b.id, phpInt(c.id)).run();
  return qrBusinessRow(s, phpInt(c.id), b.id);
}

async function qrBuy(s: Shop, c: Row, pack: string, method: string): Promise<string> {
  if (!(pack in QR_PACKS)) throw new ShopError('Choose a pack.');
  const methods = paymobVisible(s);
  if (!Object.keys(methods).length) throw new ShopError('Online payment isn’t available right now. Message us on WhatsApp to buy QR codes.');
  if (!(method in methods)) method = Object.keys(methods)[0];
  const p = QR_PACKS[pack];
  const item = { id: 'custom', name: 'Google review QR codes — ' + p.en + ' pack (' + p.credits + ')', qty: 1, price: p.price, total: p.price, cat: 'services', qr_pack: pack, qr_credits: p.credits };
  const r = await s.db.prepare(`INSERT INTO orders (customer, email, phone, address, city, items, subtotal, discount, shipping, total, promo, payment, source, status, notes, customer_id)
    VALUES (?, ?, ?, '', '', ?, ?, 0, 0, ?, '', ?, 'QR tool', 'Awaiting payment', ?, ?) RETURNING id`)
    .bind(phpTrim(String(c.name ?? '')) !== '' ? c.name : c.email, c.email, String(c.phone ?? ''), phpJsonU([item]), p.price, p.price, method,
      'Digital: QR codes are added to the customer’s account when paid.', phpInt(c.id)).first<Row>();
  return paymobCheckoutUrl(s, Number(r!.id), method);
}

// Paymob confirmed a fully paid order: a QR pack adds its codes (once) and is marked Delivered.
export async function qrOrderPaid(s: Shop, orderId: number): Promise<void> {
  const o = await s.db.prepare("SELECT * FROM orders WHERE id = ? AND source = 'QR tool'").bind(orderId).first<Row>();
  if (!o || !o.customer_id) return;
  if (await s.db.prepare('SELECT 1 AS x FROM qr_ledger WHERE order_id = ?').bind(orderId).first()) return;
  let items: Row[] = []; try { items = JSON.parse(String(o.items)) || []; } catch { /* none */ }
  let credits = 0;
  for (const i of items) credits += phpInt(i.qr_credits ?? 0) * Math.max(1, phpInt(i.qty ?? 1));
  if (credits < 1) return;
  await qrBalance(s, phpInt(o.customer_id));
  await s.db.prepare("INSERT INTO qr_ledger (customer_id, delta, reason, order_id) VALUES (?, ?, 'pack', ?)").bind(phpInt(o.customer_id), credits, orderId).run();
  if (o.status !== 'Delivered') await setOrderStatus(s, orderId, 'Delivered');
  await logActivity(s, null, 'QR tool: pack paid', orderNumber(orderId) + ' · ' + credits + ' QR · ' + o.email);
}

export async function handleQr(request: Request, env: Env, url: URL, ec: ExecutionContext): Promise<Response> {
  const s = makeShop(request, env, ec);
  const action = url.searchParams.get('action') ?? '';
  const ok = (d: unknown, code = 200) => jsonOut(d, code, 0, s);
  try {
    if (action === 'me' && request.method === 'GET') return ok(await qrMe(s, await currentCustomer(s)));
    if (request.method !== 'POST') return ok({ error: 'Not found' }, 404);
    const b = await readBody(s);
    if (action === 'code') { await customerSendCode(s, strIn(b.email, 160), b.lang === 'ar' ? 'ar' : 'en'); return ok({ ok: true }); }
    if (action === 'verify') return ok(await qrMe(s, await customerVerify(s, strIn(b.email, 160), strIn(b.code, 12))));
    if (action === 'logout') { await customerLogout(s); return ok(await qrMe(s, null)); }
    const c = await currentCustomer(s);
    if (!c) return ok({ error: 'Please sign in first.' }, 401);
    if (action === 'create') {
      if (await tooManyAttempts(s, 'qrmake', 60, 3600)) return ok({ error: 'Too many requests. Please wait a while.' }, 429);
      await recordAttempt(s, 'qrmake');
      const biz = await qrCreate(s, c, b);
      return ok({ business: biz, ...(await qrMe(s, c)) });
    }
    if (action === 'update') { const biz = await qrUpdate(s, c, b); return ok({ business: biz, ...(await qrMe(s, c)) }); }
    if (action === 'logo') return ok({ error: 'Uploads are not available on the test shop yet', path: '/api/qr.php', action }, 501);
    if (action === 'buy') {
      if (await tooManyAttempts(s, 'qrbuy', 15, 3600)) return ok({ error: 'Too many attempts. Please wait a while.' }, 429);
      await recordAttempt(s, 'qrbuy');
      return ok({ payUrl: await qrBuy(s, c, strIn(b.pack, 20), strIn(b.method, 20)) });
    }
    return ok({ error: 'Not found' }, 404);
  } catch (e) {
    if (e instanceof ShopError) return ok({ error: e.message }, [401, 402, 404, 429].includes(e.code) ? e.code : 400);
    await opsError(s, 'Server', 'QR tool error (' + action + ')', e);
    return ok({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

// ---------------------------------------------------------------------------------------------------------
// /r/<slug>
const LABELS: Record<string, [string, string]> = { whatsapp: ['WhatsApp', 'واتساب'], phone: ['Call us', 'اتصل بنا'], instagram: ['Instagram', 'إنستجرام'], facebook: ['Facebook', 'فيسبوك'],
  tiktok: ['TikTok', 'تيك توك'], website: ['Website', 'الموقع'], menu: ['Menu', 'المنيو'], location: ['Location', 'الموقع على الخريطة'], email: ['Email', 'البريد'], custom: ['Link', 'رابط'] };
const ICONS: Record<string, string> = {
  whatsapp: '<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z"/><path d="M8.5 8.7c.2-.5.5-.6.8-.6h.6c.2 0 .4 0 .5.4l.7 1.7c.1.2 0 .4-.1.6l-.5.6c.6 1.1 1.5 2 2.6 2.6l.6-.5c.2-.2.4-.2.6-.1l1.7.7c.3.1.4.3.4.5v.6c0 .3-.1.6-.6.8-.6.3-1.7.4-3.4-.5a9 9 0 0 1-3.4-3.4c-.9-1.7-.8-2.8-.5-3.4Z"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/>',
  facebook: '<path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8Z"/>',
  tiktok: '<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.5 2.5 2.3 4.2 5 4.5"/>',
  website: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  menu: '<path d="M6 3v8a2 2 0 0 0 4 0V3M8 11v10M16 3c-1.5 1.5-2 4-2 6 0 1.5 1 2 2 2v10"/>',
  location: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  custom: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};

export async function qrPage(request: Request, env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
  const slug = url.searchParams.get('slug') ?? '';
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, follow' };
  const row = /^[a-z0-9-]{3,80}$/.test(slug) ? await env.DB.prepare('SELECT * FROM qr_businesses WHERE slug = ?').bind(slug).first<Row>() : null;
  if (!row) return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found</title><p style="font:16px system-ui;text-align:center;margin-top:30vh">This page doesn’t exist. · الصفحة غير موجودة.</p>', { status: 404, headers });
  // Count real visits (not link-preview bots), after the answer is sent.
  if (!isPreviewBot(request)) ctx.waitUntil(env.DB.prepare('UPDATE qr_businesses SET views = views + 1 WHERE id = ?').bind(row.id).run());

  const b = qrBusinessOut(env, row);
  const p = b.page;
  const ar = p.lang === 'ar';
  const L = (en: string, a: string) => (ar ? a : en);
  const e = esc;
  let links = '';
  for (const l of p.links as Row[]) {
    const href = qrLinkHref(l);
    if (href === '') continue;
    const text = l.label !== '' ? l.label : LABELS[l.type][ar ? 1 : 0];
    links += '<a class="lk" href="' + e(href) + '" target="_blank" rel="noopener nofollow"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[l.type] + '</svg><span>' + e(text) + '</span></a>';
  }
  const name: string = b.name !== '' ? String(b.name) : L('Our business', 'نشاطنا');
  const color = e(p.color);
  const initial = mbSubstr(name.trim(), 0, 1).toUpperCase();
  const site = siteUrl(env);
  // The PHP template drops the line break right after every "?>"; the strings below keep that exactly.
  const o = '<!doctype html>\n<html lang="' + (ar ? 'ar' : 'en') + '"' + (ar ? ' dir="rtl"' : '') + '>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex, follow">\n' +
    '<title>' + e(name) + '</title>\n' +
    '<meta name="description" content="' + e(p.tagline || L('Review us on Google and find all our links.', 'قيّمنا على جوجل وكل روابطنا في مكان واحد.')) + '">\n' +
    '<meta property="og:title" content="' + e(name) + '">\n' +
    '<meta property="og:description" content="' + e(p.tagline || L('Review us on Google', 'قيّمنا على جوجل')) + '">\n' +
    (p.logo ? '<meta property="og:image" content="' + e(site + '/' + p.logo) + '">' : '') +
    '<meta name="theme-color" content="' + color + '">\n<link rel="icon" href="/favicon.ico?v=3">\n' +
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;600;700&family=Cairo:wght@600;700&display=swap" rel="stylesheet">\n<style>\n  *{box-sizing:border-box}\n' +
    '  body{margin:0;min-height:100vh;background:linear-gradient(180deg,' + color + ' 0 190px,#F7F3ED 190px);font-family:' + (ar ? "'Cairo'," : '') + "'Work Sans',system-ui,sans-serif;color:#22201D;display:flex;justify-content:center;padding:28px 16px 40px}\n" +
    '  .c{width:100%;max-width:440px;display:flex;flex-direction:column;align-items:center;gap:14px}\n' +
    '  .logo{width:112px;height:112px;border-radius:50%;background:#fff;box-shadow:0 6px 20px rgba(0,0,0,.15);display:grid;place-items:center;overflow:hidden;font-size:44px;font-weight:700;color:' + color + ';border:4px solid #fff}\n' +
    '  .logo img{width:100%;height:100%;object-fit:contain}\n  h1{margin:6px 0 0;font-size:26px;text-align:center;line-height:1.25}\n  .tag{margin:0;color:#6B6660;text-align:center;font-size:15px}\n' +
    '  .review{width:100%;display:flex;flex-direction:column;align-items:center;gap:2px;background:' + color + ';color:#fff;text-decoration:none;border-radius:18px;padding:18px;margin-top:8px;box-shadow:0 8px 20px rgba(0,0,0,.14);font-weight:700;font-size:19px}\n' +
    '  .review small{font-weight:400;font-size:13.5px;opacity:.9}\n  .stars{color:#FFD24A;font-size:22px;letter-spacing:3px}\n' +
    '  .lk{width:100%;display:flex;align-items:center;gap:12px;background:#fff;border:1.5px solid #E7E1D8;border-radius:14px;padding:14px 16px;color:#22201D;text-decoration:none;font-weight:600;font-size:16px}\n' +
    '  .lk:hover{border-color:' + color + '}\n' +
    '  .lk svg{width:22px;height:22px;flex:none;fill:none;stroke:' + color + ';stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}\n' +
    '  .made{margin-top:18px;font-size:12.5px;color:#8A8478;text-decoration:none}\n  .made b{color:#A8552F}\n</style>\n</head>\n<body>\n<main class="c">\n' +
    '  <div class="logo">' + (p.logo ? '<img src="/' + e(p.logo) + '" alt="' + e(name) + '">' : e(initial)) + '</div>\n' +
    '  <h1>' + e(name) + '</h1>\n  ' + (p.tagline ? '<p class="tag">' + e(p.tagline) + '</p>' : '') +
    '  <a class="review" href="' + e(b.link) + '" rel="noopener"><span class="stars">★★★★★</span>' + e(L('Review us on Google', 'قيّمنا على جوجل')) + '<small>' + e(L('It takes 10 seconds and helps us a lot', 'بتاخد 10 ثواني وبتفرق معانا جدًا')) + '</small></a>\n' +
    '  ' + links + '  <a class="made" href="' + e(site) + '/google-review-link.html">' + e(L('Made free with', 'معمولة مجانًا مع')) + ' <b>Where To Spot</b></a>\n</main>\n</body>\n</html>\n';
  return new Response(o, { headers });
}
