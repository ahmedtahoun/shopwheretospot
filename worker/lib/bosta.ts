// Bosta shipping (port of the shipment part of api/bosta.php and api/bosta-webhook.php).
// Settings: BOSTA_API_KEY (secret), BOSTA_BASE_URL (default https://app.bosta.co/api/v2), BOSTA_LOCATION_ID,
// BOSTA_DEFAULT_SIZE, BOSTA_AWB_SIZE, BOSTA_AWB_LANG, and BOSTA_WEBHOOK_SECRET (copied from the live
// data/bosta-webhook-secret.txt on switch day, so shipments already created keep reporting back).
import { round, mbSubstr, mbLen, phpInt, phpFloat, phpTrim, phpJsonU } from './php';
import { type Row } from './catalog';
import { type Shop, ShopError, orderNumber, orderPaid, bostaFindArea, logActivity, opsError, nowUnix } from './shop';
import { bostaStateLabel } from './customers';
import { setOrderStatus } from './orders';

const ORDER_STAGE: Record<string, number> = { 'Awaiting payment': 0, Pending: 0, Confirmed: 1, Designing: 2, 'Awaiting approval': 3, 'In production': 4, Ready: 5, Shipped: 6, Delivered: 7, Returned: 7, Cancelled: 7 };
const BOSTA = { name: 'Bosta' } as Row;

export const bostaEnabled = (s: Shop): boolean => !!s.env.BOSTA_API_KEY;
export class BostaError extends ShopError { constructor(message: string, public status = 0) { super(message); } }

export async function bostaRequest(s: Shop, method: string, path: string, body?: unknown, auth = true): Promise<Row> {
  const url = (s.env.BOSTA_BASE_URL || 'https://app.bosta.co/api/v2').replace(/\/+$/, '') + path;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (auth) headers.Authorization = s.env.BOSTA_API_KEY ?? '';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try { res = await fetch(url, { method, headers, body: body === undefined ? undefined : phpJsonU(body), signal: AbortSignal.timeout(20000) }); }
  catch (e) { throw new BostaError('Could not reach Bosta: ' + (e instanceof Error ? e.message : String(e))); }
  let json: any = null; try { json = await res.json(); } catch { /* not JSON */ }
  if (!json || typeof json !== 'object') throw new BostaError('Unexpected reply from Bosta (HTTP ' + res.status + ').', res.status);
  if (res.status >= 400 || json.success === false) {
    let msg = json.message ?? 'HTTP ' + res.status;
    if (res.status === 401) msg = 'Bosta rejected the API key. Check it in api/config.local.php.';
    if (res.status === 403) msg = 'Your Bosta API key does not have permission for this. (' + msg + ')';
    throw new BostaError('Bosta: ' + (typeof msg === 'string' ? msg : JSON.stringify(msg)), res.status);
  }
  return json;
}

// Pickup locations, kept 6 hours (an old copy is used if Bosta is briefly unreachable).
export async function bostaLocations(s: Shop): Promise<Row[]> {
  const cached = await s.db.prepare("SELECT value FROM kv WHERE key = 'bosta.locations'").first<Row>();
  let c: Row | null = null; try { c = cached ? JSON.parse(String(cached.value)) : null; } catch { c = null; }
  if (c && c.at > nowUnix() - 6 * 3600) return c.data;
  try {
    const res = await bostaRequest(s, 'GET', '/pickup-locations');
    const list = res.data?.list ?? res.data ?? [];
    const data = (Array.isArray(list) ? list : []).map((l: Row) => {
      const city = l.address?.city ?? '';
      return { id: l._id, name: l.locationName ?? l._id, isDefault: !!l.isDefault, city: typeof city === 'object' ? city?.name ?? '' : String(city) };
    });
    await s.db.prepare("INSERT INTO kv (key, value) VALUES ('bosta.locations', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify({ at: nowUnix(), data })).run();
    return data;
  } catch (e) { if (c) return c.data; throw e; }
}

export async function bostaCreateForOrder(s: Shop, o: Row, opts: Row): Promise<Row> {
  if (!bostaEnabled(s)) throw new ShopError('Bosta is not set up yet. Add the API key to api/config.local.php.');
  if (o.tracking_number) throw new ShopError('This order already has a Bosta shipment (' + o.tracking_number + ').');
  const cityId = opts.city_id || String(o.city_id ?? ''), districtId = opts.district_id || String(o.district_id ?? '');
  const area = cityId && districtId ? bostaFindArea(String(cityId), String(districtId)) : null;
  if (!area) throw new ShopError('Choose the customer’s city and area (Bosta needs an exact district).');
  const firstLine = phpTrim(String(opts.address ?? o.address ?? ''));
  if (mbLen(firstLine) <= 5) throw new ShopError('The street address must be longer than 5 characters for Bosta.');
  let items: Row[] = []; try { items = JSON.parse(String(o.items)) || []; } catch { /* none */ }
  const physical = items.filter((i) => (i.cat ?? '') !== 'services');
  if (!physical.length) throw new ShopError('This order has no physical products to ship.');
  const count = physical.reduce((a, i) => a + phpInt(i.qty), 0);
  let desc = physical.map((i) => i.qty + 'x ' + i.name).join(', ');
  const prep = phpTrim(String(opts.prep_notes ?? o.prep_notes ?? ''));
  if (prep !== '') desc = 'NOTE: ' + prep + ' | ' + desc;
  const cod = opts.cod !== undefined && opts.cod !== '' && opts.cod !== null ? phpFloat(opts.cod) : Math.max(0, round(Number(o.total) - await orderPaid(s, phpInt(o.id)), 2));
  if (cod < 0 || cod > 30000) throw new ShopError('Cash to collect must be between 0 and 30,000 EGP (Bosta limit).');
  const parts = phpTrim(String(o.customer ?? '')).split(/[\t\n\x0B\f\r ]+/);
  const first = parts[0] || 'Customer', last = parts.slice(1).join(' ');
  const goods = physical.reduce((a, i) => a + Number(i.total ?? i.qty * i.price), 0);
  const t = (v: unknown) => phpTrim(String(v ?? '')) || null;
  const drop: Row = { city: area.city.name, districtId: area.district.id, zoneId: area.district.zoneId || null, firstLine: mbSubstr(firstLine, 0, 250),
    secondLine: t(opts.landmark), buildingNumber: t(opts.building), floor: t(opts.floor), apartment: t(opts.apartment) };
  for (const k of Object.keys(drop)) if (drop[k] === null || drop[k] === '') delete drop[k];
  const receiver: Row = { firstName: first, lastName: last, phone: o.phone, email: o.email };
  for (const k of Object.keys(receiver)) if (!receiver[k]) delete receiver[k];
  const payload: Row = {
    type: 10,
    specs: { packageType: 'Parcel', size: ['SMALL', 'MEDIUM', 'LARGE'].includes(opts.size) ? opts.size : s.env.BOSTA_DEFAULT_SIZE || 'SMALL',
      packageDetails: { itemsCount: Math.max(1, count), description: mbSubstr(desc, 0, 500) } },
    goodsInfo: { amount: round(goods, 2) },
    notes: mbSubstr(phpTrim(String(opts.notes ?? '')), 0, 500),
    cod: round(cod, 2),
    dropOffAddress: drop,
    businessReference: orderNumber(phpInt(o.id)), uniqueBusinessReference: orderNumber(phpInt(o.id)),
    receiver,
    webhookUrl: s.site + '/api/bosta-webhook.php',
    webhookCustomHeaders: { Authorization: 'Bearer ' + (s.env.BOSTA_WEBHOOK_SECRET ?? '') },
  };
  const loc = opts.location_id || s.env.BOSTA_LOCATION_ID || '';
  if (loc) payload.businessLocationId = loc;
  if (!payload.notes) delete payload.notes;
  const res = await bostaRequest(s, 'POST', '/deliveries?apiVersion=1', payload);
  const d = res.data ?? {};
  if (!d.trackingNumber) throw new ShopError('Bosta did not return a tracking number.');
  return { bosta_id: String(d._id ?? ''), tracking_number: String(d.trackingNumber), state: phpInt(d.state?.code ?? 10), city_id: area.city.id, district_id: area.district.id,
    district: area.district.name, city: o.city || area.city.name, cod };
}

export const bostaView = async (s: Shop, tracking: string): Promise<Row> => (await bostaRequest(s, 'GET', '/deliveries/business/' + encodeURIComponent(tracking))).data ?? {};
export const bostaTerminate = (s: Shop, tracking: string) => bostaRequest(s, 'DELETE', '/deliveries/business/' + encodeURIComponent(tracking) + '/terminate');

export async function bostaAwbPdf(s: Shop, tracks: string[]): Promise<Uint8Array> {
  const res = await bostaRequest(s, 'POST', '/deliveries/mass-awb', { trackingNumbers: tracks.join(','), requestedAwbType: s.env.BOSTA_AWB_SIZE || 'A6', lang: s.env.BOSTA_AWB_LANG || 'ar' });
  const b64 = typeof res.data === 'string' ? res.data : res.data?.file ?? res.data?.data ?? '';
  let pdf: Uint8Array | null = null;
  try { pdf = Uint8Array.from(atob(String(b64)), (c) => c.charCodeAt(0)); } catch { pdf = null; }
  if (!pdf || new TextDecoder().decode(pdf.slice(0, 4)) !== '%PDF') throw new ShopError('Bosta did not return a printable waybill. ' + (res.message ?? ''));
  return pdf;
}

export function bostaOrderStatus(code: number): string | null {
  if ([21, 24, 30, 41].includes(code)) return 'Shipped';
  if (code === 45) return 'Delivered';
  if ([46, 60].includes(code)) return 'Returned';
  if ([48, 49].includes(code)) return 'Cancelled';
  return null;
}

export async function bostaApplyState(s: Shop, orderId: number, code: number, note = ''): Promise<void> {
  const o = await s.db.prepare('SELECT status, bosta_state FROM orders WHERE id = ?').bind(orderId).first<Row>();
  if (!o) return;
  const current = o.status;
  const before = o.bosta_state === null ? null : phpInt(o.bosta_state);
  await s.db.prepare("UPDATE orders SET bosta_state = ?, bosta_note = ?, bosta_updated_at = datetime('now') WHERE id = ?").bind(code, mbSubstr(note, 0, 300), orderId).run();
  // (The WhatsApp "out for delivery" / "delivery attempt" messages come with the messaging port.)
  const next = bostaOrderStatus(code);
  if (!next || next === current || current === 'Cancelled') return;
  if (next === 'Cancelled') {
    if ((before !== null && [48, 49].includes(before)) || ['Delivered', 'Returned'].includes(current)) return;
    await setOrderStatus(s, orderId, 'Cancelled');
    return;
  }
  if (next === 'Returned') { await setOrderStatus(s, orderId, 'Returned'); return; }
  if ((ORDER_STAGE[next] ?? 0) >= (ORDER_STAGE[current] ?? 0) && current !== 'Returned') await setOrderStatus(s, orderId, next);
}

export const bostaGone = (e: unknown): boolean =>
  (e instanceof BostaError && e.status === 404) || /not found|not exist/i.test(e instanceof Error ? e.message : String(e));

export async function bostaMarkDeleted(s: Shop, orderId: number): Promise<void> {
  await s.db.prepare("UPDATE orders SET bosta_state = 49, bosta_note = 'Deleted on Bosta', bosta_updated_at = datetime('now') WHERE id = ?").bind(orderId).run();
  await logActivity(s, BOSTA, 'Shipment deleted on Bosta', orderNumber(orderId));
}

export async function bostaSyncOpen(s: Shop, limit = 60): Promise<[number, number]> {
  if (!bostaEnabled(s)) return [0, 0];
  const { results } = await s.db.prepare(`SELECT id, status, bosta_state, tracking_number FROM orders WHERE tracking_number IS NOT NULL AND tracking_number != ''
    AND (bosta_state IS NULL OR bosta_state NOT IN (45, 46, 48, 49, 60, 104)) AND status NOT IN ('Cancelled')
    ORDER BY COALESCE(bosta_updated_at, created_at) ASC LIMIT ` + Math.trunc(limit)).all<Row>();
  let checked = 0, changed = 0;
  for (const r of results) {
    let d: Row;
    try { d = await bostaView(s, String(r.tracking_number)); }
    catch (e) {
      if (bostaGone(e)) { await bostaMarkDeleted(s, phpInt(r.id)); changed++; checked++; }
      else await opsError(s, 'Bosta', 'Checking a shipment with Bosta failed', e);
      continue;
    }
    checked++;
    const code = phpInt(d.state?.code ?? 0);
    if (!code) continue;
    if (code !== phpInt(r.bosta_state)) {
      await bostaApplyState(s, phpInt(r.id), code, String(d.state?.exception?.reason ?? d.exceptionReason ?? ''));
      await logActivity(s, BOSTA, 'Shipment ' + bostaStateLabel(code), orderNumber(phpInt(r.id)) + ' · synced');
      changed++;
    } else await s.db.prepare("UPDATE orders SET bosta_updated_at = datetime('now') WHERE id = ?").bind(r.id).run();
  }
  return [checked, changed];
}

// The sync runs at most every 2 hours (from the cron; PHP ran it after dashboard visits).
export async function bostaSyncDue(s: Shop): Promise<void> {
  if (!bostaEnabled(s)) return;
  const r = await s.db.prepare("SELECT value FROM kv WHERE key = 'bosta.sync_at'").first<Row>();
  if (r && phpInt(r.value) > nowUnix() - 7200) return;
  await s.db.prepare("INSERT INTO kv (key, value) VALUES ('bosta.sync_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(nowUnix())).run();
  try { await bostaSyncOpen(s); } catch (e) { await opsError(s, 'Bosta', 'Updating shipments from Bosta failed', e); }
}

// Bosta calls this when a shipment changes state (with our secret in the Authorization header).
export async function bostaWebhook(s: Shop): Promise<Response> {
  const out = (d: unknown, code = 200) => new Response(JSON.stringify(d), { status: code, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (s.request.method !== 'POST') return out({ error: 'Not found' }, 404);
  const secret = s.env.BOSTA_WEBHOOK_SECRET ?? '';
  if (!secret || s.request.headers.get('Authorization') !== 'Bearer ' + secret) return out({ error: 'Unauthorized' }, 401);
  let b: Row = {}; try { b = (await s.request.json()) || {}; } catch { b = {}; }
  const tracking = String(b.trackingNumber ?? ''), code = phpInt(b.state ?? 0);
  if (tracking === '' || !code) return out({ error: 'Missing trackingNumber or state' }, 400);
  try {
    const o = await s.db.prepare('SELECT id FROM orders WHERE tracking_number = ?').bind(tracking).first<Row>();
    if (!o) return out({ ok: true, ignored: 'unknown tracking number' });
    let note = String(b.exceptionReason ?? '');
    if (b.numberOfAttempts) note = phpTrim(note + ' (attempt ' + phpInt(b.numberOfAttempts) + ')');
    await bostaApplyState(s, phpInt(o.id), code, note);
    await logActivity(s, BOSTA, 'Shipment ' + bostaStateLabel(code), orderNumber(phpInt(o.id)) + ' · ' + tracking + (note ? ' · ' + note : ''));
    return out({ ok: true });
  } catch (e) {
    await opsError(s, 'Bosta', 'A delivery update from Bosta could not be saved', e);
    return out({ error: 'Error' }, 500);
  }
}
