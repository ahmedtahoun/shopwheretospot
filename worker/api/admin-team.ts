// Dashboard: Bosta shipping, deleting orders, quick search, settings checks (problems, Meta, Paymob), backups and
// the team (ports of those parts of api/admin.php).
import { round, phpInt, phpFloat, phpStr, phpTrim, mbLen, numberFormat, randomHex } from '../lib/php';
import { type Row } from '../lib/catalog';
import { bostaAreas, bostaZones } from '../lib/areas';
import { type Shop, strIn, logActivity, orderNumber, stockAfter, clientIp } from '../lib/shop';
import { fail, requirePerm, currentUser, hasPerm, deviceHints, deviceList, loginLocation, teamSetting, teamSetSetting, loginList, workingHours, saveUser } from '../lib/team';
import { setOrderStatus } from '../lib/orders';
import { bostaEnabled, bostaLocations, bostaCreateForOrder, bostaView, bostaGone, bostaMarkDeleted, bostaApplyState, bostaSyncOpen, bostaAwbPdf, bostaTerminate } from '../lib/bosta';
import { bostaStateLabel } from '../lib/customers';
import { metaReady, metaSend } from '../lib/meta';
import { paymobMethods, paymobRequest, PaymobError } from '../lib/paymob';
import { sendMail, emailShell } from '../lib/mail';
import { MARKET } from '../lib/catalog';
import { cairoDay, addDays } from '../lib/time';
import type { A } from './admin';

type Handler = (a: A) => Promise<unknown>;
const num = (v: unknown) => Number(v ?? 0);
const first = (s: Shop, sql: string, ...args: unknown[]) => s.db.prepare(sql).bind(...args).first<Row>();
const all = async (s: Shop, sql: string, ...args: unknown[]) => (await s.db.prepare(sql).bind(...args).all<Row>()).results;
const truthy = (v: unknown) => !!v && v !== '0' && !(Array.isArray(v) && !v.length);
const accessible = (u: Row, o: Row) => !hasPerm(u, 'own_orders') || phpInt(o.rep_id) === phpInt(u.id);

export function registerTeam(H: Record<string, Handler>): void {
  // ---------- Bosta ----------
  H.bosta_info = async ({ s }) => {
    await requirePerm(s, 'orders');
    if (!bostaEnabled(s)) return { enabled: false, market: MARKET.code };
    let locations: Row[] = [], locError: string | null = null;
    try { locations = await bostaLocations(s); } catch (e) { locError = e instanceof Error ? e.message : String(e); }
    return { enabled: true, locations, locationsError: locError, defaultLocation: s.env.BOSTA_LOCATION_ID ?? '', defaultSize: s.env.BOSTA_DEFAULT_SIZE || 'SMALL' };
  };
  H.bosta_areas = async ({ s }) => {
    await requirePerm(s, 'orders');
    return { cities: bostaAreas().map((c) => ({ id: c.id, name: c.name, ar: c.ar, zones: bostaZones(c) })) };
  };
  H.bosta_create = async ({ s, body }) => {
    const u = await requirePerm(s, 'orders');
    const b = await body();
    const ids = (Array.isArray(b.ids) ? b.ids : [b.id ?? 0]).map((x: unknown) => phpInt(x));
    const results: Row[] = [];
    for (const id of ids) {
      const o = await first(s, 'SELECT * FROM orders WHERE id = ?', id);
      if (!o || !accessible(u, o)) { results.push({ id, error: 'Order not found.' }); continue; }
      try {
        if (o.status === 'Cancelled') throw new Error('Order is cancelled.');
        const opts = ids.length === 1 ? b : { size: b.size ?? '', location_id: b.location_id ?? '' };
        if (ids.length === 1 && 'prep_notes' in b) {
          o.prep_notes = strIn(b.prep_notes, 500);
          await s.db.prepare('UPDATE orders SET prep_notes = ? WHERE id = ?').bind(o.prep_notes, id).run();
        }
        const r = await bostaCreateForOrder(s, o, opts);
        await s.db.prepare(`UPDATE orders SET bosta_id = ?, tracking_number = ?, bosta_state = ?, bosta_cod = ?, city_id = ?, district_id = ?, district = ?,
          address = ?, bosta_note = '', bosta_updated_at = datetime('now') WHERE id = ?`)
          .bind(r.bosta_id, r.tracking_number, r.state, r.cod, r.city_id, r.district_id, r.district, ids.length === 1 && truthy(b.address) ? strIn(b.address, 500) : o.address, id).run();
        if (o.status === 'Pending') await setOrderStatus(s, id, 'Confirmed');
        await logActivity(s, u, 'Bosta shipment created', orderNumber(id) + ' · ' + r.tracking_number);
        results.push({ id, number: orderNumber(id), tracking: r.tracking_number });
      } catch (e) {
        results.push({ id, number: orderNumber(id), error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { results };
  };
  H.bosta_refresh = async ({ s, body }) => {
    const u = await requirePerm(s, 'orders');
    const o = await first(s, 'SELECT id, tracking_number, rep_id FROM orders WHERE id = ?', phpInt((await body()).id ?? 0));
    if (!o || !o.tracking_number) fail('This order has no Bosta shipment.', 404);
    if (!accessible(u, o!)) fail('Order not found.', 404);
    let d: Row;
    try { d = await bostaView(s, String(o!.tracking_number)); }
    catch (e) { if (!bostaGone(e)) throw e; await bostaMarkDeleted(s, phpInt(o!.id)); return { state: 49, label: 'Deleted on Bosta' }; }
    const code = phpInt(d.state?.code ?? 0);
    if (code) await bostaApplyState(s, phpInt(o!.id), code, String(d.state?.exception?.reason ?? d.exceptionReason ?? ''));
    return { state: code, label: bostaStateLabel(code) };
  };
  H.bosta_sync = async ({ s }) => {
    await requirePerm(s, 'orders');
    const [checked, changed] = await bostaSyncOpen(s, 100);
    await s.db.prepare("INSERT INTO kv (key, value) VALUES ('bosta.sync_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(Math.floor(Date.now() / 1000))).run();
    return { checked, changed };
  };
  H.bosta_awb = async ({ s, q }) => {
    const u = await requirePerm(s, 'orders');
    const ids = String(q.get('ids') ?? '').split(',').map((x) => phpInt(x));
    const own = hasPerm(u, 'own_orders') ? ' AND rep_id = ' + phpInt(u.id) : '';
    const tracks = (await all(s, `SELECT tracking_number FROM orders WHERE id IN (${ids.map(() => '?').join(',')}) AND tracking_number IS NOT NULL AND tracking_number != ''${own}`, ...ids)).map((r) => String(r.tracking_number));
    if (!tracks.length) fail('None of these orders has a Bosta shipment yet.', 404);
    if (tracks.length > 50) fail('Print up to 50 waybills at a time.');
    const pdf = await bostaAwbPdf(s, tracks);
    return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="bosta-waybills.pdf"', 'Cache-Control': 'no-store' } });
  };
  H.bosta_cancel = async ({ s, body }) => {
    const u = await requirePerm(s, 'orders');
    const o = await first(s, 'SELECT id, tracking_number, rep_id FROM orders WHERE id = ?', phpInt((await body()).id ?? 0));
    if (!o || !o.tracking_number) fail('This order has no Bosta shipment.', 404);
    if (!accessible(u, o!)) fail('Order not found.', 404);
    await bostaTerminate(s, String(o!.tracking_number));
    await s.db.prepare("UPDATE orders SET bosta_state = 48, bosta_updated_at = datetime('now') WHERE id = ?").bind(o!.id).run();
    await logActivity(s, u, 'Bosta shipment cancelled', orderNumber(phpInt(o!.id)) + ' · ' + o!.tracking_number);
    return { ok: true };
  };

  // Owner only: remove test or mistaken orders completely (stock goes back, payments are removed).
  H.order_delete = async ({ s, body }) => {
    const u = await requirePerm(s, 'team');
    const raw = (await body()).ids;
    const ids = [...new Set((Array.isArray(raw) ? raw : raw ? [raw] : []).map((x: unknown) => phpInt(x)).filter((x: number) => x))] as number[];
    if (!ids.length || ids.length > 50) fail('Choose up to 50 orders to delete.');
    const deleted: string[] = [];
    for (const id of ids) {
      const o = await first(s, 'SELECT * FROM orders WHERE id = ?', id);
      if (!o) continue;
      if (o.tracking_number && ![45, 46, 48, 49, 60].includes(phpInt(o.bosta_state))) {
        try { await bostaTerminate(s, String(o.tracking_number)); }
        catch (e) { if (!bostaGone(e)) fail(orderNumber(id) + ': Bosta didn’t let us cancel its shipment (' + (e instanceof Error ? e.message : String(e)) + '). Cancel it in Bosta, then delete the order.'); }
      }
      const stmts: D1PreparedStatement[] = [];
      if (!['Cancelled', 'Returned'].includes(o.status)) {
        let items: Row[] = []; try { items = JSON.parse(String(o.items)) || []; } catch { /* none */ }
        const after = new Map<string, Row>();
        for (const it of items) {
          if ((it.id ?? '') === 'custom') continue;
          const pid = String(it.id);
          const p = after.get(pid) ?? await first(s, 'SELECT id, cat, stock, variants FROM products WHERE id = ?', pid);
          if (!p) continue;
          const na = stockAfter(p, it.variant !== undefined && it.variant !== null ? String(it.variant) : null, phpInt(it.qty));
          if (na) after.set(pid, { ...p, stock: na.stock, variants: na.variants ?? p.variants, _v: na.variants !== null || p._v });
        }
        for (const [pid, p] of after) stmts.push(p._v
          ? s.db.prepare("UPDATE products SET variants = ?, stock = ?, updated_at = datetime('now') WHERE id = ?").bind(p.variants, p.stock, pid)
          : s.db.prepare("UPDATE products SET stock = ?, updated_at = datetime('now') WHERE id = ?").bind(p.stock, pid));
      }
      stmts.push(s.db.prepare('DELETE FROM payments WHERE order_id = ?').bind(id), s.db.prepare('DELETE FROM orders WHERE id = ?').bind(id));
      await s.db.batch(stmts);
      await logActivity(s, u, 'Deleted order', orderNumber(id) + ' · ' + o.customer + ' · EGP ' + numberFormat(num(o.total)));
      deleted.push(orderNumber(id));
    }
    await s.db.prepare("UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(id), 0) FROM orders) WHERE name = 'orders'").run();
    return { deleted };
  };

  // ---------- quick search ----------
  H.search = async ({ s, q }) => {
    const u = await requirePerm(s, 'dashboard');
    const qq = phpTrim(strIn(q.get('q') ?? '', 60));
    if (mbLen(qq) < 2) return { results: [] };
    const like = '%' + qq + '%';
    const digits = qq.replace(/\D/g, '');
    const out: Row[] = [];
    if (hasPerm(u, 'orders')) {
      const own = hasPerm(u, 'own_orders') ? ' AND rep_id = ' + phpInt(u.id) : '';
      const m = qq.match(/^(wts-?)?(\d{4,})$/i);
      const n = m ? phpInt(m[2]) - 1000 : 0;
      const args: unknown[] = [n, like, like, like];
      if (digits.length >= 4) args.push('%' + digits + '%');
      for (const r of await all(s, "SELECT id, customer, phone, total, status, business_name FROM orders WHERE (id = ? OR customer LIKE ? OR email LIKE ? OR business_name LIKE ?"
        + (digits.length >= 4 ? " OR replace(replace(phone, ' ', ''), '-', '') LIKE ?" : '') + `)${own} ORDER BY id DESC LIMIT 8`, ...args))
        out.push({ type: 'order', id: phpInt(r.id), title: orderNumber(phpInt(r.id)) + ' · ' + r.customer, sub: phpTrim((r.business_name ? r.business_name + ' · ' : '') + r.phone + ' · EGP ' + numberFormat(num(r.total)) + ' · ' + r.status) });
    }
    if (hasPerm(u, 'leads')) {
      const args: unknown[] = [like, like, like];
      if (digits.length >= 4) args.push('%' + digits.slice(-9) + '%');
      for (const r of await all(s, 'SELECT id, name, contact, status, source FROM leads WHERE name LIKE ? OR contact LIKE ? OR notes LIKE ?' + (digits.length >= 4 ? ' OR phone_key LIKE ?' : '') + ' ORDER BY id DESC LIMIT 6', ...args))
        out.push({ type: 'lead', id: phpInt(r.id), title: r.name, sub: r.contact + ' · ' + r.status + ' · ' + r.source });
    }
    if (hasPerm(u, 'products')) {
      for (const r of await all(s, 'SELECT id, name, sku, price FROM products WHERE name LIKE ? OR sku LIKE ? OR id LIKE ? ORDER BY sort LIMIT 5', like, like, like))
        out.push({ type: 'product', id: r.id, title: r.name, sub: r.sku + ' · EGP ' + numberFormat(num(r.price)) });
    }
    return { results: out };
  };

  // ---------- settings checks ----------
  H.ops_errors = async ({ s }) => {
    await requirePerm(s, 'backups');
    return { problems: (await all(s, 'SELECT * FROM ops_errors ORDER BY last_at DESC LIMIT 50')).map((r) => ({ id: phpInt(r.id), area: r.area, message: r.message, count: phpInt(r.count), firstAt: r.first_at, lastAt: r.last_at, seen: !!phpInt(r.seen) })) };
  };
  H.ops_clear = async ({ s, method }) => {
    const u = await requirePerm(s, 'backups');
    if (method !== 'POST') fail('Not found', 404);
    await s.db.prepare('DELETE FROM ops_errors').run();
    await logActivity(s, u, 'Cleared the problems list', '');
    return { ok: true };
  };
  H.meta_status = async ({ s }) => {
    await requirePerm(s, 'backups');
    return { pixel: String(s.env.META_PIXEL_ID ?? ''), capi: metaReady(s), testCode: !!s.env.META_TEST_CODE, ga4: String(s.env.GA4_ID ?? ''),
      sent: phpInt((await first(s, 'SELECT COUNT(*) AS n FROM orders WHERE capi_at IS NOT NULL'))?.n) };
  };
  H.meta_test = async ({ s, method }) => {
    await requirePerm(s, 'backups');
    if (method !== 'POST') fail('Not found', 404);
    if (!metaReady(s)) fail('Add the pixel ID and the Conversions API token to api/config.local.php first.', 502);
    try {
      const r = await metaSend(s, [{ event_name: 'PageView', event_time: Math.floor(Date.now() / 1000), event_id: 'test-' + randomHex(6), action_source: 'website',
        event_source_url: s.site + '/', user_data: { client_ip_address: clientIp(s), client_user_agent: s.request.headers.get('User-Agent') ?? '' } }]);
      return { received: phpInt(r.events_received ?? 0) };
    } catch (e) { return fail('Meta said: ' + (e instanceof Error ? e.message : String(e))); }
  };
  // What is set for Paymob (never the secrets themselves). On Cloudflare the settings are Worker secrets.
  H.paymob_status = async ({ s, q }) => {
    await requirePerm(s, 'backups');
    const kind = (v: string, prefix: string) => (v === '' ? 'missing' : v.startsWith(prefix + 'test_') ? 'test' : v.startsWith(prefix + 'live_') ? 'live' : 'unrecognised');
    const e = s.env;
    const set = !!(e.PAYMOB_SECRET_KEY || e.PAYMOB_PUBLIC_KEY || e.PAYMOB_HMAC_SECRET);
    const out: Row = { fileFound: true, fileReturnsArray: true, topLevel: [], paymobBlock: set, nestedIn: null,
      secretKey: kind(e.PAYMOB_SECRET_KEY ?? '', 'egy_sk_'), publicKey: kind(e.PAYMOB_PUBLIC_KEY ?? '', 'egy_pk_'), hmac: phpTrim(e.PAYMOB_HMAC_SECRET ?? '') !== '' ? 'set' : 'missing',
      cardId: phpInt(e.PAYMOB_CARD_INTEGRATION_ID ?? 0), walletId: phpInt(e.PAYMOB_WALLET_INTEGRATION_ID ?? 0), unknownNames: [],
      methodsOffered: Object.keys(paymobMethods(s)), phpLoaded: !!Object.keys(paymobMethods(s)).length };
    if (q.get('test') === '1' && Object.keys(paymobMethods(s)).length) {
      try {
        const res = await paymobRequest(s, 'POST', '/v1/intention/', { amount: 100, currency: 'EGP', payment_methods: Object.values(paymobMethods(s)),
          items: [{ name: 'Connection test', amount: 100, quantity: 1 }],
          billing_data: { first_name: 'Test', last_name: 'Test', email: 'test@wheretospot.com', phone_number: '01000000000', street: 'NA', building: 'NA', floor: 'NA', apartment: 'NA', city: 'Cairo', state: 'Cairo', country: 'EG' } });
        out.connection = res.client_secret ? 'ok' : 'unexpected reply';
        out.integrations = (Array.isArray(res.payment_methods) ? res.payment_methods : []).filter((m: unknown) => m && typeof m === 'object')
          .map((m: Row) => ({ id: phpInt(m.integration_id ?? 0), name: String(m.name ?? ''), type: String(m.method_type ?? ''), live: m.live !== undefined ? !!m.live : null }));
      } catch (err) { out.connection = 'failed: ' + (err instanceof PaymobError && err.detail ? err.detail : err instanceof Error ? err.message : String(err)); }
    }
    return out;
  };

  // ---------- backups ----------
  // D1 keeps every change for 30 days (Time Travel: `wrangler d1 time-travel restore shop --timestamp=…`), so there
  // are no backup files here. Copies kept outside Cloudflare come with the photo storage (R2) port.
  H.backups = async ({ s }) => { await requirePerm(s, 'backups'); return { backups: [], keep: 14, offsite: { enabled: false, timeTravel: true } }; };
  H.backup_now = async ({ s }) => { await requirePerm(s, 'backups'); return { ok: true, file: null, backups: [], timeTravel: true }; };
  H.backup_offsite = async ({ s, method }) => {
    const u = await requirePerm(s, 'backups');
    if (method !== 'POST') fail('Not found', 404);
    if ((u.role ?? '') !== 'owner') fail('Only an owner can send the backup.', 403);
    return fail('Not available on the test shop yet', 501);
  };

  // ---------- team ----------
  H.team = async ({ s }) => {
    await requirePerm(s, 'dashboard');
    const u = (await currentUser(s))!;
    const owner = hasPerm(u, 'team');
    const cols = owner ? `id, name, email, phone, role, ref_code, active, notify, created_at, last_login,
      (SELECT COUNT(*) FROM user_devices d WHERE d.user_id = users.id AND d.revoked = 0) AS devices,
      (SELECT label FROM user_devices d WHERE d.user_id = users.id ORDER BY d.last_seen DESC LIMIT 1) AS last_device` : 'id, name, role';
    return { team: await all(s, `SELECT ${cols} FROM users ORDER BY active DESC, name`) };
  };
  H.device_hints = async ({ s, body }) => { const u = await requirePerm(s, 'dashboard'); await deviceHints(s, phpInt(u.id), await body()); return { ok: true }; };
  H.login_location = async ({ s, body }) => { const u = await requirePerm(s, 'dashboard'); await loginLocation(s, phpInt(u.id), await body()); return { ok: true }; };
  H.team_security = async ({ s, method, body }) => {
    const u = await requirePerm(s, 'team');
    if (method === 'POST') {
      const on = truthy((await body()).ask_location);
      await teamSetSetting(s, 'ask_location', on);
      await logActivity(s, u, 'Changed sign-in checks', 'Ask for location at sign-in: ' + (on ? 'on' : 'off'));
    }
    return { askLocation: !!(await teamSetting(s, 'ask_location', false)) };
  };
  H.person_activity = async ({ s, q }) => {
    await requirePerm(s, 'team');
    const id = phpInt(q.get('user') ?? 0);
    return { logins: await loginList(s, id, 20), days: await workingHours(s, addDays(cairoDay(), -13), id) };
  };
  H.team_hours = async ({ s, q }) => {
    await requirePerm(s, 'team');
    // As in PHP: the check reads ?days (7 when missing) but then uses (int) $_GET['days'], so no ?days gives 0.
    const d = phpInt(q.get('days') ?? 7);
    const days = [7, 14, 30].includes(d) ? phpInt(q.get('days')) : 7;
    const since = addDays(cairoDay(), -(days - 1));
    return { days, since, rows: await workingHours(s, since) };
  };
  H.devices = async ({ s, q }) => { await requirePerm(s, 'team'); return { devices: await deviceList(s, phpInt(q.get('user') ?? 0)) }; };
  H.device_signout = async ({ s, body }) => {
    const u = await requirePerm(s, 'team');
    const d = await first(s, 'SELECT d.id, d.label, d.user_id, us.name FROM user_devices d JOIN users us ON us.id = d.user_id WHERE d.id = ?', phpInt((await body()).id ?? 0));
    if (!d) fail('Device not found.', 404);
    await s.db.prepare('UPDATE user_devices SET revoked = 1 WHERE id = ?').bind(d!.id).run();
    await logActivity(s, u, 'Signed out a device', d!.name + ' · ' + d!.label);
    return { devices: await deviceList(s, phpInt(d!.user_id)) };
  };
  H.team_save = async ({ s, body }) => {
    const u = await requirePerm(s, 'team');
    const b = await body();
    const id = phpInt(b.id ?? 0);
    if (id === phpInt(u.id) && ((b.role ?? 'owner') !== 'owner' || !truthy(b.active))) fail('You cannot remove your own owner access.');
    const newId = await saveUser(s, b, id || null);
    await logActivity(s, u, id ? 'Updated team member' : 'Added team member', strIn(b.name, 120));
    return { id: newId };
  };
  H.mail_test = async ({ s }) => {
    const u = await requirePerm(s, 'team');
    const subscribed = !!phpInt((await first(s, 'SELECT notify FROM users WHERE id = ?', u.id))?.notify);
    const ok = await sendMail(s, [u.email], 'Test alert from your shop',
      emailShell(s, 'Email alerts are working', '<p>New orders and enquiries will arrive like this. If this landed in spam, mark it “Not spam” and see the setup notes about SMTP/SPF.</p>'), 'Email alerts are working.\n');
    const via = 'Brevo';
    if (!ok) fail('Could not send the test email via ' + via + '. Check the BREVO_API_KEY secret.', 502);
    return { ok: true, to: u.email, via, subscribed };
  };
  H.activity = async ({ s }) => { await requirePerm(s, 'activity'); return { activity: await all(s, 'SELECT * FROM activity ORDER BY id DESC LIMIT 300') }; };
}
