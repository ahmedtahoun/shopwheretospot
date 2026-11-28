// Meta Conversions API (port of api/meta.php): each website purchase is sent from the server too, with the same
// event ID as the browser pixel, so Meta counts it once. Settings: META_PIXEL_ID, META_CAPI_TOKEN (secret),
// META_TEST_CODE, META_GRAPH_URL / META_GRAPH_VERSION (defaults https://graph.facebook.com, v23.0).
import { round, phpJson, phpJsonPlain, mbSubstr, sha256Hex, phpInt } from './php';
import { MARKET, type Row } from './catalog';
import { type Shop, clientIp, orderNumber, phoneKey, opsError, logActivity } from './shop';
import { readCookie } from './customers';

export const metaReady = (s: Shop): boolean => /^\d{6,20}$/.test(s.env.META_PIXEL_ID ?? '') && !!s.env.META_CAPI_TOKEN;

export async function metaRememberOrder(s: Shop, orderId: number): Promise<void> {
  const t: Row = { fbp: readCookie(s.request, '_fbp'), fbc: readCookie(s.request, '_fbc'), ip: clientIp(s), ua: mbSubstr(s.request.headers.get('User-Agent') ?? '', 0, 400) };
  for (const k of ['fbp', 'fbc']) if (!/^fb\.\d\.\d+\.[A-Za-z0-9_\-.]+$/.test(t[k])) t[k] = '';
  await s.db.prepare('UPDATE orders SET track = ? WHERE id = ?').bind(phpJsonPlain(t), orderId).run();
}

const hash = async (v: string): Promise<string> => (v === '' ? '' : sha256Hex(v));
const metaPhone = (phone: string): string => {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (/^01\d{9}$/.test(d)) d = MARKET.phone_cc + d.slice(1);
  return d.length >= 8 ? d : '';
};

export async function metaPurchaseEvent(s: Shop, o: Row): Promise<Row> {
  let t: Row = {}; try { t = JSON.parse(String(o.track ?? '')) || {}; } catch { /* none */ }
  const parts = String(o.customer ?? '').trim().toLowerCase().split(/[\t\n\x0B\f\r ]+/);
  const u: Row = {
    em: [await hash(String(o.email ?? '').trim().toLowerCase())], ph: [await hash(metaPhone(String(o.phone ?? '')))],
    fn: [await hash(parts[0] ?? '')], ln: [await hash(parts.length > 1 ? parts[parts.length - 1] : '')],
    ct: [await hash(String(o.city ?? '').toLowerCase().replace(/[^a-z]/g, ''))], country: [await hash(MARKET.code.toLowerCase())],
    external_id: [await hash(phoneKey(String(o.phone ?? '')) || '')],
    client_ip_address: t.ip ?? '', client_user_agent: t.ua ?? '', fbp: t.fbp ?? '', fbc: t.fbc ?? '',
  };
  for (const k of Object.keys(u)) if (Array.isArray(u[k]) ? u[k][0] === '' : u[k] === '') delete u[k];
  let items: Row[] = []; try { items = JSON.parse(String(o.items)) || []; } catch { /* none */ }
  const contents = items.filter((i) => (i.id ?? '') !== '' && i.id !== 'custom').map((i) => ({ id: String(i.id), quantity: phpInt(i.qty ?? 1), item_price: round(Number(i.price ?? 0), 2) }));
  const number = orderNumber(Number(o.id));
  return { event_name: 'Purchase', event_time: Math.floor(Date.now() / 1000), event_id: 'order-' + number, action_source: 'website',
    event_source_url: s.site + '/index.html', user_data: u,
    custom_data: { currency: MARKET.currency, value: round(Number(o.total), 2), order_id: number, content_type: 'product',
      content_ids: contents.map((c) => c.id), contents, num_items: contents.reduce((n, c) => n + c.quantity, 0) } };
}

// Once per order (claimed first, so the payment return page and the webhook can't both send it).
export async function metaPurchase(s: Shop, orderId: number): Promise<void> {
  if (!metaReady(s)) return;
  const r = await s.db.prepare("UPDATE orders SET capi_at = datetime('now') WHERE id = ? AND capi_at IS NULL AND created_by IS NULL").bind(orderId).run();
  if (!r.meta.changes) return;
  const o = await s.db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first<Row>();
  if (!o) return;
  const event = await metaPurchaseEvent(s, o);
  s.later((async () => {
    try { await metaSend(s, [event]); }
    catch (e) {
      await opsError(s, 'Ad tracking', 'Purchase ' + orderNumber(orderId) + ' was not sent to Meta', e);
      await logActivity(s, null, 'Meta purchase event not sent', orderNumber(orderId) + ' · ' + mbSubstr(e instanceof Error ? e.message : String(e), 0, 200));
    }
  })());
}

export async function metaSend(s: Shop, events: Row[]): Promise<Row> {
  const body = new URLSearchParams({ data: phpJson(events), access_token: s.env.META_CAPI_TOKEN ?? '' });
  if (s.env.META_TEST_CODE) body.set('test_event_code', s.env.META_TEST_CODE);
  const url = (s.env.META_GRAPH_URL ?? 'https://graph.facebook.com').replace(/\/+$/, '') + '/' + (s.env.META_GRAPH_VERSION ?? 'v23.0').replace(/^\/+|\/+$/g, '') + '/' + s.env.META_PIXEL_ID + '/events';
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000) });
  let r: Row = {}; try { r = await res.json(); } catch { /* not JSON */ }
  if (res.status >= 400 || r.error) throw new Error(String(r.error?.error_user_msg ?? r.error?.message ?? 'HTTP ' + res.status));
  return r;
}
