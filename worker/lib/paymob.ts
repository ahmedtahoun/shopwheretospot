// Paymob online payments (port of api/paymob.php): Unified Checkout intentions, the HMAC checks on Paymob's
// callbacks, and recording a payment once. Settings: PAYMOB_SECRET_KEY, PAYMOB_PUBLIC_KEY, PAYMOB_HMAC_SECRET (secrets),
// PAYMOB_CARD_INTEGRATION_ID, PAYMOB_WALLET_INTEGRATION_ID, PAYMOB_BASE_URL (default https://accept.paymob.com).
import { round, mbSubstr, rawurlencode, numberFormat, phpInt, phpJson, phpJsonU, randomHex } from './php';
import { MARKET, money, type Row } from './catalog';
import { type Shop, ShopError, orderNumber, orderPaid, paymentStmt, activityStmt, logActivity, opsError } from './shop';
import { readCookie } from './customers';
import { confirmOnlineOrder } from './orders';

export function paymobCfg(s: Shop) {
  const e = s.env;
  return { base_url: e.PAYMOB_BASE_URL || 'https://accept.paymob.com', secret_key: e.PAYMOB_SECRET_KEY ?? '', public_key: e.PAYMOB_PUBLIC_KEY ?? '', hmac_secret: e.PAYMOB_HMAC_SECRET ?? '',
    card_integration_id: phpInt(e.PAYMOB_CARD_INTEGRATION_ID ?? 0), wallet_integration_id: phpInt(e.PAYMOB_WALLET_INTEGRATION_ID ?? 0) };
}
export function paymobMethods(s: Shop): Record<string, number> {
  const c = paymobCfg(s);
  if (!c.secret_key || !c.public_key || !c.hmac_secret) return {};
  const m: Record<string, number> = {};
  if (c.card_integration_id) m.paymob_card = c.card_integration_id;
  if (c.wallet_integration_id) m.paymob_wallet = c.wallet_integration_id;
  return m;
}
export const paymobIsTest = (s: Shop): boolean => paymobCfg(s).secret_key.includes('_test_');
// With test keys only testers (a browser that opened the shop with ?paytest=1) see online payment.
export const paymobVisible = (s: Shop): Record<string, number> => (paymobIsTest(s) && readCookie(s.request, 'wts_paytest') !== '1' ? {} : paymobMethods(s));

export class PaymobError extends ShopError { constructor(message: string, public detail = '') { super(message); } }

export async function paymobRequest(s: Shop, method: string, path: string, body?: unknown): Promise<Row> {
  const c = paymobCfg(s);
  let res: Response;
  try {
    res = await fetch(c.base_url.replace(/\/+$/, '') + path, { method, signal: AbortSignal.timeout(25000),
      headers: { Authorization: 'Token ' + c.secret_key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : phpJsonU(body) });
  } catch (e) { throw new PaymobError('Could not reach Paymob (' + (e instanceof Error ? e.message : String(e)) + '). Please try again.'); }
  const raw = await res.text();
  let json: unknown = null; try { json = JSON.parse(raw); } catch { /* not JSON */ }
  if (res.status >= 400 || !json || typeof json !== 'object') {
    console.error('[paymob] HTTP ' + res.status + ' ' + raw.slice(0, 500));
    throw new PaymobError('Online payment could not be started. Please try again or choose cash on delivery.',
      'HTTP ' + res.status + ' · ' + mbSubstr(json && typeof json === 'object' ? phpJson(json) : raw, 0, 300));
  }
  return json as Row;
}

export async function paymobCheckoutUrl(s: Shop, orderId: number, method: string): Promise<string> {
  const methods = paymobMethods(s);
  if (!(method in methods)) throw new ShopError('Online payment is not available right now. Please choose cash on delivery.');
  const c = paymobCfg(s);
  const o = await s.db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first<Row>();
  if (!o) throw new ShopError('Order not found.');
  const due = round(Number(o.total) - await orderPaid(s, orderId), 2);
  if (due <= 0) throw new ShopError('This order is already paid.');
  const cents = Math.trunc(round(due * MARKET.charge_rate * 100));
  const parts = String(o.customer ?? '').trim().split(/[\t\n\x0B\f\r ]+/);
  const first = mbSubstr(parts[0] || 'Customer', 0, 50);
  const last = mbSubstr(parts.length > 1 ? parts.slice(1).join(' ') : first, 0, 50);
  const number = orderNumber(orderId);
  let items: Row[] = []; try { items = JSON.parse(String(o.items)) || []; } catch { /* none */ }
  const ref = number + '-' + randomHex(3);
  const body = {
    amount: cents, currency: MARKET.charge_currency, payment_methods: [methods[method]],
    items: [{ name: mbSubstr('Where To Spot order ' + number, 0, 50), amount: cents, quantity: 1, description: mbSubstr(items.map((i) => i.qty + '× ' + i.name).join(', '), 0, 255) }],
    billing_data: { first_name: first, last_name: last, email: o.email || 'orders@wheretospot.com', phone_number: o.phone || 'NA', street: mbSubstr(o.address || 'NA', 0, 200),
      building: 'NA', floor: 'NA', apartment: 'NA', city: o.district || (o.city || 'NA'), state: o.city || 'NA', country: MARKET.code },
    special_reference: ref, notification_url: s.site + '/api/paymob-webhook.php', redirection_url: s.site + '/api/paymob-return.php', extras: { order_id: orderId },
  };
  await s.db.prepare("UPDATE orders SET pay_refs = TRIM(COALESCE(pay_refs, '') || ' ' || ?) WHERE id = ?").bind(ref, orderId).run();
  const res = await paymobRequest(s, 'POST', '/v1/intention/', body);
  if (!res.client_secret) throw new ShopError('Paymob did not start the payment. Please try again or choose cash on delivery.');
  return c.base_url + '/unifiedcheckout/?publicKey=' + rawurlencode(c.public_key) + '&clientSecret=' + rawurlencode(String(res.client_secret));
}

// Payment links the team sends (api/pay.php): the key is an HMAC with the shop's SETUP_KEY (copied from the live
// data folder on switch day, so links already sent keep working).
export async function payLinkKey(s: Shop, orderId: number): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(s.env.SETUP_KEY ?? ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('pay-link:' + orderId)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
}
export const payLinkUrl = async (s: Shop, orderId: number): Promise<string> => s.site + '/api/pay.php?o=' + orderId + '&k=' + await payLinkKey(s, orderId);

// The HMAC on transaction callbacks: these fields, in order, joined, SHA-512 with the HMAC secret.
export async function paymobHmacValid(s: Shop, t: Row, hmac: string, get: boolean): Promise<boolean> {
  const secret = paymobCfg(s).hmac_secret;
  if (secret === '' || hmac === '') return false;
  const v = (x: unknown) => (typeof x === 'boolean' ? (x ? 'true' : 'false') : x === null || x === undefined ? '' : typeof x === 'number' ? String(x) : String(x));
  const g = (k: string, alt?: string) => t[k] ?? (alt !== undefined ? t[alt] : undefined) ?? '';
  const fields = get
    ? [g('amount_cents'), g('created_at'), g('currency'), g('error_occured'), g('has_parent_transaction'), g('id'), g('integration_id'), g('is_3d_secure'), g('is_auth'), g('is_capture'),
      g('is_refunded'), g('is_standalone_payment'), g('is_voided'), t.order ?? t.order_id ?? '', g('owner'), g('pending'), g('source_data_pan', 'source_data.pan'),
      g('source_data_sub_type', 'source_data.sub_type'), g('source_data_type', 'source_data.type'), g('success')]
    : [g('amount_cents'), g('created_at'), g('currency'), g('error_occured'), g('has_parent_transaction'), g('id'), g('integration_id'), g('is_3d_secure'), g('is_auth'), g('is_capture'),
      g('is_refunded'), g('is_standalone_payment'), g('is_voided'), t.order?.id ?? '', g('owner'), g('pending'), t.source_data?.pan ?? '', t.source_data?.sub_type ?? '', t.source_data?.type ?? '', g('success')];
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(fields.map(v).join(''))));
  const calc = [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
  return calc === hmac.toLowerCase();
}

export const paymobOrderId = (ref: string): number => { const m = ref.match(/^WTS-(\d+)/); return m ? Number(m[1]) - 1000 : 0; };

// A successful transaction, recorded once. True when the order is now fully paid.
export async function paymobRecord(s: Shop, orderId: number, txnId: string, amountCents: number, label: string, ref = ''): Promise<boolean> {
  if (orderId <= 0 || txnId === '') return false;
  const o = await s.db.prepare('SELECT id, status, pay_refs, payment FROM orders WHERE id = ?').bind(orderId).first<Row>();
  if (!o) return false;
  const refs = String(o.pay_refs ?? '').trim();
  const legacy = refs === '' && String(o.payment ?? '').startsWith('paymob_');
  const amountText = MARKET.charge_currency + ' ' + numberFormat(amountCents / 100);
  if (!legacy && (ref === '' || !refs.split(/[\t\n\x0B\f\r ]+/).includes(ref))) {
    await logActivity(s, null, 'Online payment not matched', 'Paymob ' + (ref || '(no reference)') + ' · txn ' + txnId + ' · ' + amountText + ' — check in Paymob');
    await opsError(s, 'Paymob', 'Money received that doesn’t match an order: Paymob ' + (ref || '(no reference)') + ' · txn ' + txnId + ' · ' + amountText + ' — check it in Paymob');
    return false;
  }
  const dupe = await s.db.prepare("SELECT 1 AS x FROM payments WHERE order_id = ? AND method = 'paymob' AND note LIKE ?").bind(orderId, '%txn ' + txnId).first();
  if (!dupe) {
    const amount = amountCents / 100 / MARKET.charge_rate; // Egypt: charged in the shop's own currency
    await s.db.batch([
      paymentStmt(s, orderId, amount, 'paymob', mbSubstr(label, 0, 120) + ' · txn ' + txnId, null),
      activityStmt(s, null, 'Online payment received', orderNumber(orderId) + ' · ' + money(amount) + ' · ' + label),
    ]);
    // The WhatsApp thank-you and Telegram note come with the messaging port (wa_payment_received).
  }
  const t = await s.db.prepare('SELECT total FROM orders WHERE id = ?').bind(orderId).first<Row>();
  const full = await orderPaid(s, orderId) >= Number(t?.total) - 0.5;
  if (full) {
    await confirmOnlineOrder(s, orderId, 'New order · paid online', 'Confirmed');
    // QR packs bought on the review-link tool are added with the QR tool's checkout (Phase 3, qr.ts).
    try { const { qrOrderPaid } = await import('../api/qr'); await qrOrderPaid(s, orderId); }
    catch (e) { await opsError(s, 'Payments', 'A QR pack was paid (' + orderNumber(orderId) + ') but the codes weren’t added', e); }
  }
  return full;
}
