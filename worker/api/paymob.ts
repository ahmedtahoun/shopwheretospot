// Paymob's callbacks and the team's payment links (ports of api/paymob-webhook.php, paymob-return.php and pay.php).
import { mbSubstr, rawurlencode, numberFormat, round, phpInt, esc } from '../lib/php';
import { type Row } from '../lib/catalog';
import { makeShop, orderNumber, orderPaid, logActivity, opsError, tooManyAttempts, recordAttempt } from '../lib/shop';
import { paymobHmacValid, paymobOrderId, paymobRecord, paymobMethods, paymobCheckoutUrl, payLinkKey, payLinkUrl, PaymobError } from '../lib/paymob';
import { isPreviewBot, shareCardHtml } from './pages';
import type { Env } from '../index';

const text = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });

// Server-to-server "transaction processed". Always 200 for well-formed calls so Paymob doesn't keep retrying.
export async function paymobWebhook(request: Request, env: Env, url: URL, ec: ExecutionContext): Promise<Response> {
  const s = makeShop(request, env, ec);
  if (request.method !== 'POST') return text('', 405);
  let payload: Row | null = null; try { payload = await request.json(); } catch { /* not JSON */ }
  const t = payload && typeof payload === 'object' ? payload.obj : null;
  if (!t || typeof t !== 'object' || (payload!.type ?? '') !== 'TRANSACTION') return text('ignored');
  if (!(await paymobHmacValid(s, t, url.searchParams.get('hmac') ?? '', false))) {
    await opsError(s, 'Paymob', 'A payment notice with a wrong signature was refused (transaction ' + (t.id ?? '?') + '). If real payments stop being confirmed, check the HMAC in config.local.php.');
    return text('bad hmac', 401);
  }
  let orderId = paymobOrderId(String(t.order?.merchant_order_id ?? ''));
  if (!orderId && t.payment_key_claims?.extra?.order_id !== undefined) orderId = phpInt(t.payment_key_claims.extra.order_id);
  const empty = (v: unknown) => !v || v === '0' || (Array.isArray(v) && !v.length); // PHP empty()
  const ok = !empty(t.success) && empty(t.pending) && empty(t.is_voided) && empty(t.is_refunded) && empty(t.is_void) && empty(t.is_refund);
  try {
    if (ok && orderId) {
      const src = t.source_data ?? {};
      const label = 'Paid online · ' + ((src.sub_type ?? '') + ' ' + (src.pan ? '•••• ' + src.pan : '')).trim();
      await paymobRecord(s, orderId, String(t.id), phpInt(t.amount_cents), label, String(t.order?.merchant_order_id ?? ''));
    } else if (orderId && empty(t.pending)) {
      await logActivity(s, null, 'Online payment failed', orderNumber(orderId) + ' · ' + mbSubstr(String(t.data?.message ?? 'declined'), 0, 80));
    }
  } catch (e) {
    await opsError(s, 'Paymob', 'A payment notice from Paymob could not be processed', e);
    return text('', 500);
  }
  return text('ok');
}

// Where Paymob sends the customer after paying (query parameters signed with the HMAC secret).
export async function paymobReturn(request: Request, env: Env, url: URL, ec: ExecutionContext): Promise<Response> {
  const s = makeShop(request, env, ec);
  const q = Object.fromEntries(url.searchParams);
  const valid = await paymobHmacValid(s, q, q.hmac ?? '', true);
  const orderId = paymobOrderId(q.merchant_order_id ?? '');
  const success = q.success === 'true' && q.pending !== 'true';
  if (valid && success && orderId) {
    try {
      const pan = q.source_data_pan ?? q['source_data.pan'] ?? '';
      const label = 'Paid online · ' + ((q.source_data_sub_type ?? q['source_data.sub_type'] ?? '') + ' ' + (pan ? '•••• ' + pan : '')).trim();
      await paymobRecord(s, orderId, q.id ?? '', phpInt(q.amount_cents ?? 0), label, q.merchant_order_id ?? '');
    } catch (e) { await opsError(s, 'Paymob', 'A paid order coming back from Paymob could not be recorded', e); }
  }
  const number = orderId ? orderNumber(orderId) : '';
  const go = (to: string) => new Response(null, { status: 302, headers: { Location: to, 'Content-Type': 'text/html; charset=UTF-8' } });
  if (orderId) {
    const o = await s.db.prepare('SELECT source FROM orders WHERE id = ?').bind(orderId).first<Row>();
    if (o?.source === 'QR tool') return go(s.site + '/google-review-link.html?paid=' + (!valid ? 'check' : success ? 'ok' : 'failed') + '#pricing');
  }
  if (!valid) return go(s.site + '/index.html?pay=check' + (number ? '&order=' + rawurlencode(number) : ''));
  if (success) return go(s.site + '/index.html?pay=ok&order=' + rawurlencode(number));
  return go(s.site + '/index.html?pay=failed&order=' + rawurlencode(number) + '&reason=' + rawurlencode(mbSubstr(q.data_message ?? q['data.message'] ?? '', 0, 80)));
}

// /api/pay.php?o=<order>&k=<key>: a fresh Paymob payment for what's still due.
function payPage(titleAr: string, titleEn: string, body: string, status = 200): Response {
  const hs = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]!);
  return new Response('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex"><title>' + hs(titleAr + ' · ' + titleEn) + '</title><link rel="icon" href="/favicon.ico?v=3">'
    + '<style>body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;background:#F6F3EE;color:#1C1B19;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}'
    + '.c{background:#fff;border-radius:18px;padding:28px 22px;max-width:380px;width:100%;box-sizing:border-box;box-shadow:0 6px 24px rgba(0,0,0,.08);text-align:center}'
    + 'img{width:64px;height:64px}h1{font-size:20px;margin:12px 0 2px}h2{font-size:15px;font-weight:500;color:#6B675F;margin:0 0 16px}'
    + '.amt{font-size:28px;font-weight:700;margin:6px 0 2px}.muted{color:#6B675F;font-size:14px}'
    + 'a.b{display:block;margin-top:12px;padding:14px;border-radius:12px;background:#B5562F;color:#fff;text-decoration:none;font-weight:600}a.b.alt{background:#fff;color:#B5562F;border:1.5px solid #B5562F}'
    + 'small{display:block;font-weight:400;opacity:.85}</style></head><body><div class="c"><img src="/images/logo.png?v=3" alt="Where To Spot">'
    + '<h1>' + hs(titleAr) + '</h1><h2 dir="ltr">' + hs(titleEn) + '</h2>' + body + '</div></body></html>',
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

export async function payLink(request: Request, env: Env, url: URL, ec: ExecutionContext): Promise<Response> {
  const s = makeShop(request, env, ec);
  const e = esc;
  const id = phpInt(url.searchParams.get('o') ?? 0);
  const key = url.searchParams.get('k') ?? '';
  let o: Row | null = null;
  if (id > 0 && env.SETUP_KEY && (await payLinkKey(s, id)) === key) o = await s.db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<Row>();
  if (!o) return payPage('الرابط غير صحيح', 'This link isn’t valid', '<p class="muted">اطلب رابطًا جديدًا من فريقنا على واتساب.<br><span dir="ltr">Ask our team on WhatsApp for a new link.</span></p>', 404);
  const number = orderNumber(id);
  const due = round(Number(o.total) - await orderPaid(s, id), 2);
  const amount = '<div class="amt" dir="ltr">EGP ' + numberFormat(due, due === Math.floor(due) ? 0 : 2) + '</div><div class="muted">طلب رقم · Order <b dir="ltr">' + e(number) + '</b></div>';
  if (isPreviewBot(request)) {
    return new Response(shareCardHtml('Where To Spot · ' + number + ' · EGP ' + numberFormat(due), 'ادفع طلبك أونلاين بالبطاقة أو المحفظة · Pay your order online', s.site + '/images/share-card.jpg', await payLinkUrl(s, id), 'ar'),
      { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
  }
  if (o.status === 'Cancelled' || o.status === 'Returned') return payPage('الطلب ملغي', 'This order was cancelled', '<p class="muted">تواصل معنا على واتساب لعمل طلب جديد.<br><span dir="ltr">Message us on WhatsApp to place it again.</span></p>');
  if (due <= 0) return payPage('تم الدفع ✓', 'Already paid ✓', '<p class="muted">طلب رقم <span dir="ltr">' + e(number) + '</span> مدفوع بالكامل. شكرًا لك!<br><span dir="ltr">Order ' + e(number) + ' is fully paid. Thank you!</span></p>');
  const methods = paymobMethods(s);
  if (!Object.keys(methods).length) return payPage('الدفع أونلاين غير متاح الآن', 'Online payment isn’t available right now', '<p class="muted">تواصل معنا على واتساب.<br><span dir="ltr">Please message us on WhatsApp.</span></p>');
  let method = url.searchParams.get('m') ?? '';
  if (!(method in methods)) {
    if (Object.keys(methods).length > 1) {
      const link = (m: string) => '/api/pay.php?o=' + id + '&k=' + rawurlencode(key) + '&m=' + m;
      return payPage('ادفع طلبك', 'Pay for your order', amount
        + '<a class="b" href="' + e(link('paymob_card')) + '">💳 بطاقة بنكية<small dir="ltr">Card · Visa / Mastercard / Meeza</small></a>'
        + '<a class="b alt" href="' + e(link('paymob_wallet')) + '">📱 محفظة إلكترونية<small dir="ltr">Mobile wallet · Vodafone Cash and others</small></a>'
        + '<p class="muted" style="margin-top:16px">🔒 الدفع آمن عبر Paymob<br><span dir="ltr">Secure payment by Paymob</span></p>');
    }
    method = Object.keys(methods)[0];
  }
  if (await tooManyAttempts(s, 'paylink', 30, 3600)) return payPage('محاولات كثيرة', 'Too many attempts', '<p class="muted">حاول مرة أخرى بعد قليل.<br><span dir="ltr">Please try again a little later.</span></p>');
  await recordAttempt(s, 'paylink');
  try {
    return new Response(null, { status: 302, headers: { Location: await paymobCheckoutUrl(s, id, method) } });
  } catch (err) {
    await logActivity(s, null, 'Online payment could not start', number + ' · payment link · ' + mbSubstr(err instanceof PaymobError && err.detail ? err.detail : err instanceof Error ? err.message : String(err), 0, 250));
    return payPage('تعذر بدء الدفع', 'The payment couldn’t start', '<p class="muted">حاول مرة أخرى بعد قليل أو تواصل معنا على واتساب.<br><span dir="ltr">Try again in a moment, or message us on WhatsApp.</span></p>');
  }
}
