// The team's side: sign-in sessions, roles and permissions, devices, sign-ins and working hours
// (ports of bootstrap.php start_session/current_user/require_perm, devices.php and admin.php save_user).
// PHP kept sessions in files; here they live in D1 (team_sessions), keyed by a hash of the wts_admin cookie.
// Passwords stay bcrypt ($2y$, cost 10), so the team's existing passwords keep working.
import bcrypt from 'bcryptjs';
import { mbSubstr, phpTrim, phpInt, phpFloat, round, randomHex, sha256Hex, validEmail, rawurlencode } from './php';
import { type Row } from './catalog';
import { type Shop, ShopError, nowUnix, logActivity, strIn } from './shop';
import { readCookie } from './customers';
import { sendMail, emailShell, btn, h } from './mail';
import { cairoDay, utcStamp } from './time';

export const TEAM_SESSION_DAYS = 30;
export const ROLES: Record<string, string[]> = {
  owner: ['dashboard', 'products', 'orders', 'sell', 'leads', 'team', 'targets', 'activity', 'backups', 'revenue', 'whatsapp', 'whatsapp_all'],
  manager: ['dashboard', 'products', 'orders', 'sell', 'leads', 'targets', 'activity', 'revenue', 'whatsapp', 'whatsapp_all'],
  sales: ['dashboard', 'orders', 'sell', 'leads', 'own_orders', 'whatsapp'],
  staff: ['dashboard', 'orders', 'sell', 'leads', 'own_orders', 'whatsapp'],
  telesales: ['dashboard', 'orders', 'sell', 'orders_only', 'own_orders', 'whatsapp'],
};
export const LEAD_STATUSES = ['New', 'Contacted', 'Quoted', 'Won', 'Lost'];

// The admin answer ends the request (PHP's json_out()/fail() exit), with the HTTP code.
export class AdminFail extends Error { constructor(message: string, public code: number) { super(message); } }
export const fail = (msg: string, code = 400): never => { throw new AdminFail(msg, code); };

// ---------- passwords ----------
export const passwordHash = (pw: string): string => bcrypt.hashSync(pw, 10).replace(/^\$2[ab]\$/, '$2y$');
export const passwordVerify = (pw: string, hash: string): boolean => {
  if (!/^\$2[aby]\$\d\d\$/.test(hash)) return false;
  try { return bcrypt.compareSync(pw, hash.replace(/^\$2y\$/, '$2b$')); } catch { return false; }
};

// ---------- sessions ----------
export interface Session { id: string | null; data: Row; dirty: boolean; started: boolean; destroyed?: boolean }
let tableReady = false;
async function ensureTable(s: Shop) {
  if (tableReady) return;
  await s.db.prepare('CREATE TABLE IF NOT EXISTS team_sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL)').run();
  tableReady = true;
}
const sessionCookie = (s: Shop, id: string, expires: number) => {
  const secure = new URL(s.request.url).protocol === 'https:';
  s.cookies.push('wts_admin=' + id + '; expires=' + new Date(expires * 1000).toUTCString() + '; Max-Age=' + (expires - nowUnix()) + '; path=/' + (secure ? '; secure' : '') + '; HttpOnly; SameSite=Lax');
};

export async function startSession(s: Shop): Promise<Session> {
  if (s.session?.started) return s.session;
  await ensureTable(s);
  const id = readCookie(s.request, 'wts_admin');
  let data: Row = {};
  let known = false;
  if (/^[a-f0-9]{32,64}$/.test(id)) {
    const r = await s.db.prepare('SELECT data FROM team_sessions WHERE sid = ? AND expires > ?').bind(await sha256Hex(id), nowUnix()).first<Row>();
    if (r) { try { data = JSON.parse(String(r.data)) || {}; } catch { data = {}; } known = true; }
  }
  // Like PHP, a request without a session gets a new id (and cookie) the first time a session is started.
  const sess: Session = { id: known ? id : randomHex(16), data, dirty: false, started: true };
  if (!known) { sessionCookie(s, sess.id!, nowUnix() + TEAM_SESSION_DAYS * 86400); sess.dirty = true; }
  return (s.session = sess);
}
export async function regenerateSession(s: Shop): Promise<void> {
  const sess = await startSession(s);
  if (sess.id) await s.db.prepare('DELETE FROM team_sessions WHERE sid = ?').bind(await sha256Hex(sess.id)).run();
  sess.id = randomHex(16);
  sess.dirty = true;
  sessionCookie(s, sess.id, nowUnix() + TEAM_SESSION_DAYS * 86400);
}
export async function destroySession(s: Shop): Promise<void> {
  const sess = await startSession(s);
  if (sess.id) await s.db.prepare('DELETE FROM team_sessions WHERE sid = ?').bind(await sha256Hex(sess.id)).run();
  sess.data = {}; sess.dirty = false; sess.destroyed = true;
}
// Saved once at the end of the request (PHP writes the session file when the script ends).
export async function saveSession(s: Shop): Promise<void> {
  const sess = s.session;
  if (!sess || !sess.dirty || sess.destroyed || !sess.id) return;
  await s.db.prepare('INSERT INTO team_sessions (sid, data, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires')
    .bind(await sha256Hex(sess.id), JSON.stringify(sess.data), nowUnix() + TEAM_SESSION_DAYS * 86400).run();
}
const setSess = (s: Shop, k: string, v: unknown) => { s.session!.data[k] = v; s.session!.dirty = true; };

function renewSessionCookie(s: Shop) {
  if (nowUnix() - phpInt(s.session!.data.renewed ?? 0) < 86400) return;
  setSess(s, 'renewed', nowUnix());
  sessionCookie(s, s.session!.id!, nowUnix() + TEAM_SESSION_DAYS * 86400);
}

export async function currentUser(s: Shop): Promise<Row | null> {
  if (s.user !== undefined) return s.user;
  const sess = await startSession(s);
  if (!sess.data.uid) return (s.user = null);
  const u = await s.db.prepare('SELECT id, name, email, phone, role, ref_code, active, wa_agent, wa_away, tg_chat_id, tg_name, wa_seen_at FROM users WHERE id = ?').bind(sess.data.uid).first<Row>();
  if (!u || !u.active) return (s.user = null);
  if (!(await deviceCheck(s, phpInt(u.id)))) { await destroySession(s); return (s.user = null); }
  await devicePing(s, phpInt(u.id));
  renewSessionCookie(s);
  u.perms = ROLES[u.role] ?? [];
  return (s.user = u);
}

export async function requirePerm(s: Shop, perm: string): Promise<Row> {
  const u = await currentUser(s);
  if (!u) fail('Not signed in', 401);
  if (!u!.perms.includes(perm)) fail('You do not have access to this', 403);
  if (s.request.method !== 'GET') {
    const token = s.request.headers.get('X-CSRF-Token') ?? '';
    if (!s.session!.data.csrf || s.session!.data.csrf !== token) fail('Session expired, please reload', 419);
  }
  return u!;
}
export const hasPerm = (u: Row, p: string): boolean => (u.perms as string[]).includes(p);

// ---------- devices ----------
export function deviceId(s: Shop): string {
  if (s.deviceId) return s.deviceId;
  const c = readCookie(s.request, 'wts_dev');
  if (/^[a-f0-9]{32}$/.test(c)) return (s.deviceId = c);
  s.deviceId = randomHex(16);
  const secure = new URL(s.request.url).protocol === 'https:';
  const exp = nowUnix() + 2 * 365 * 86400;
  s.cookies.push('wts_dev=' + s.deviceId + '; expires=' + new Date(exp * 1000).toUTCString() + '; Max-Age=' + (exp - nowUnix()) + '; path=/' + (secure ? '; secure' : '') + '; HttpOnly; SameSite=Lax');
  return s.deviceId;
}
export const deviceIp = (s: Shop): string => (s.request.headers.get('CF-Connecting-IP') ?? '').slice(0, 45);
const ua = (s: Shop): string => (s.request.headers.get('User-Agent') ?? '').slice(0, 400);

function deviceBrand(model: string): string {
  const m = phpTrim(model);
  const map: [RegExp, string][] = [[/^SM-/i, 'Samsung'], [/^Galaxy/i, 'Samsung'], [/^CPH\d/i, 'OPPO'], [/^RMX\d/i, 'realme'], [/^V2\d{3}/i, 'vivo'], [/^Infinix/i, ''], [/^TECNO/i, ''],
    [/^itel/i, ''], [/^(Redmi|POCO|Mi )/i, 'Xiaomi'], [/^(2\d{3}[0-9A-Z]{3,}|M2\d{3})/, 'Xiaomi'], [/^Pixel/i, 'Google'], [/^moto/i, 'Motorola'], [/^Nokia/i, ''],
    [/^(HUAWEI|ALN-|ANA-|ELS-|NOH-|JAD-|BAL-)/i, 'Huawei'], [/^(HONOR|ANY-|RMO-|CMA-)/i, 'Honor'], [/^(ONEPLUS|CPH25|LE2|NE2|PHB)/i, 'OnePlus']];
  for (const [re, brand] of map) if (re.test(m)) return brand;
  return '';
}
function iphoneGuess(screen: string): string {
  const m = screen.match(/^(\d+)x(\d+)$/);
  if (!m) return '';
  const w = Math.min(Number(m[1]), Number(m[2])), hh = Math.max(Number(m[1]), Number(m[2]));
  const map: Record<string, string> = { '320x568': 'SE (1st)', '375x667': '6 / 7 / 8 / SE', '414x736': '6–8 Plus', '375x812': 'X / XS / 11 Pro / 12–13 mini', '414x896': 'XR / XS Max / 11 / 11 Pro Max',
    '390x844': '12 / 13 / 14 / 16e', '428x926': '12–13 Pro Max / 14 Plus', '393x852': '14 Pro / 15 / 15 Pro / 16', '430x932': '14 Pro Max / 15 Plus / 15 Pro Max / 16 Plus',
    '402x874': '16 Pro / 17 / 17 Pro', '440x956': '16 Pro Max / 17 Pro Max', '420x912': 'Air' };
  return map[w + 'x' + hh] ?? '';
}
export function deviceLabel(u: string, model = '', platform = '', pv = '', screen = ''): string {
  let browser = /SamsungBrowser\//.test(u) ? 'Samsung Internet' : /Edg[A]?\//.test(u) ? 'Edge' : /OPR\/|Opera/.test(u) ? 'Opera'
    : /CriOS\//.test(u) ? 'Chrome' : /FxiOS\/|Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Browser';
  if (/WhatsApp|FBAN|FBAV|Instagram/.test(u)) browser = 'in-app browser';
  if (/iPhone/.test(u)) {
    const m = u.match(/OS (\d+)_(\d+)/);
    const v = m ? m[1] + '.' + m[2] : '';
    const g = iphoneGuess(screen);
    return 'iPhone' + (g ? ' (likely ' + g + ')' : '') + (v ? ' · iOS ' + v : '') + ' · ' + browser;
  }
  if (/iPad/.test(u) || platform === 'iPadOS') return 'iPad · ' + browser;
  const am = u.match(/Android ([\d.]+)?;?[\t\n\x0B\f\r ]*([^;)]*)/);
  if (am || platform.toLowerCase().includes('android')) {
    const m2 = am?.[2] ?? '';
    const mod = phpTrim(model !== '' ? model : m2 !== 'K' ? m2.replace(/[\t\n\x0B\f\r ]*Build\/.*$/, '') : '');
    const brand = mod !== '' ? deviceBrand(mod) : '';
    const ver = pv !== '' ? pv.replace(/\.0(\.0)?$/, '') : (am?.[1] ?? '') !== '10' || model !== '' ? am?.[1] ?? '' : '';
    return phpTrim((brand ? brand + ' ' : '') + (mod !== '' ? mod : 'Android phone')) + (ver ? ' · Android ' + ver : '') + ' · ' + browser;
  }
  if (/Windows NT/.test(u) || platform.toLowerCase().includes('windows')) {
    const win = pv !== '' ? (phpInt(pv.split('.')[0]) >= 13 ? 'Windows 11' : 'Windows 10') : 'Windows';
    return win + ' computer · ' + browser;
  }
  if (/Macintosh|Mac OS X/.test(u) || platform.toLowerCase().includes('mac')) return 'Mac · ' + browser;
  if (/CrOS/.test(u)) return 'Chromebook · ' + browser;
  if (/Linux/.test(u)) return 'Linux computer · ' + browser;
  return 'Unknown device · ' + browser;
}

export async function deviceCheck(s: Shop, uid: number, login = false): Promise<boolean> {
  const dev = deviceId(s);
  const d = await s.db.prepare('SELECT id, revoked, last_seen, model, platform, platform_version, screen FROM user_devices WHERE user_id = ? AND dev_id = ?').bind(uid, dev).first<Row>();
  const agent = ua(s);
  if (!d) {
    await s.db.prepare('INSERT INTO user_devices (user_id, dev_id, ua, label, last_ip, logins) VALUES (?, ?, ?, ?, ?, ?)').bind(uid, dev, agent, deviceLabel(agent), deviceIp(s), login ? 1 : 0).run();
    return true;
  }
  if (login) {
    await s.db.prepare("UPDATE user_devices SET revoked = 0, logins = logins + 1, last_seen = datetime('now'), last_ip = ?, ua = ?, label = ? WHERE id = ?")
      .bind(deviceIp(s), agent, deviceLabel(agent, d.model ?? '', d.platform ?? '', d.platform_version ?? '', d.screen ?? ''), d.id).run();
    return true;
  }
  if (phpInt(d.revoked)) return false;
  if (Date.parse(String(d.last_seen).replace(' ', 'T') + 'Z') / 1000 < nowUnix() - 600) {
    await s.db.prepare("UPDATE user_devices SET last_seen = datetime('now'), last_ip = ? WHERE id = ?").bind(deviceIp(s), d.id).run();
  }
  return true;
}

export async function deviceHints(s: Shop, uid: number, b: Row): Promise<void> {
  const clean = (v: unknown, n: number) => [...String(v ?? '').replace(/[^\p{L}\p{N}\p{Mn}\p{Pc} .,\-/()+]/gu, '')].join('').slice(0, n);
  const model = clean(b.model, 60), platform = clean(b.platform, 30), pv = clean(b.platformVersion, 20);
  const screen = /^\d{2,5}x\d{2,5}$/.test(String(b.screen ?? '')) ? String(b.screen) : '';
  const agent = ua(s);
  await s.db.prepare('UPDATE user_devices SET model = ?, platform = ?, platform_version = ?, screen = ?, ua = ?, label = ? WHERE user_id = ? AND dev_id = ?')
    .bind(model, platform, pv, screen, agent, deviceLabel(agent, model, platform, pv, screen), uid, deviceId(s)).run();
}

export async function deviceList(s: Shop, uid: number): Promise<Row[]> {
  const { results } = await s.db.prepare(`SELECT d.id, d.dev_id, d.label, d.first_seen, d.last_seen, d.last_ip, d.logins, d.revoked,
      (SELECT TRIM(l.city || CASE WHEN l.isp != '' THEN ' · ' || l.isp ELSE '' END) FROM user_logins l WHERE l.device_id = d.id ORDER BY l.id DESC LIMIT 1) AS place
    FROM user_devices d WHERE d.user_id = ? ORDER BY d.revoked, d.last_seen DESC`).bind(uid).all<Row>();
  const mine = deviceId(s);
  return results.map((d) => ({ id: phpInt(d.id), label: d.label, firstSeen: d.first_seen, lastSeen: d.last_seen, ip: d.last_ip, logins: phpInt(d.logins),
    signedOut: !!phpInt(d.revoked), thisDevice: d.dev_id === mine, place: phpTrim(String(d.place ?? ''), ' ·') }));
}

export async function deviceLogin(s: Shop, u: Row): Promise<void> {
  const uid = phpInt(u.id);
  const dev = deviceId(s);
  const known = !!(await s.db.prepare('SELECT 1 AS x FROM user_devices WHERE user_id = ? AND dev_id = ?').bind(uid, dev).first());
  const before = Number((await s.db.prepare('SELECT COUNT(*) AS n FROM user_devices WHERE user_id = ?').bind(uid).first<Row>())?.n ?? 0);
  await deviceCheck(s, uid, true);
  const d = await s.db.prepare('SELECT id, label FROM user_devices WHERE user_id = ? AND dev_id = ?').bind(uid, dev).first<Row>();
  const isNew = !known && before > 0;
  const ip = deviceIp(s);
  const r = await s.db.prepare('INSERT INTO user_logins (user_id, device_id, ip, new_device) VALUES (?, ?, ?, ?)').bind(uid, d?.id ?? null, ip, isNew ? 1 : 0).run();
  const loginId = Number(r.meta.last_row_id);
  setSess(s, 'login_id', loginId);
  const label = String(d?.label ?? '');
  s.later((async () => {
    const g = await ipGeo(s, ip);
    await s.db.prepare('UPDATE user_logins SET city = ?, isp = ? WHERE id = ?').bind(g.city, g.isp, loginId).run();
    if (isNew) await deviceNewAlert(s, u, label, g, ip);
  })());
}

const publicIp = (ip: string): boolean => {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224 || (a === 100 && b >= 64 && b <= 127));
  }
  return ip.includes(':') && !/^(::1|fe80:|fc|fd|::$)/i.test(ip);
};
export async function ipGeo(s: Shop, ip: string): Promise<{ city: string; isp: string }> {
  const none = { city: '', isp: '' };
  if (ip === '' || !publicIp(ip)) return none;
  const row = await s.db.prepare("SELECT city, isp FROM ip_geo WHERE ip = ? AND at > datetime('now', '-30 days')").bind(ip).first<Row>();
  if (row) return { city: row.city, isp: row.isp };
  // Cloudflare already knows the city of the visitor making this request (no outside lookup needed).
  const cf = (s.request as any).cf ?? {};
  let city = '', isp = '';
  if (ip === deviceIp(s) && cf.city) { city = [...new Set([cf.city, cf.region].filter(Boolean))].join(', '); isp = String(cf.asOrganization ?? ''); }
  else {
    try {
      const token = s.env.IPINFO_TOKEN ?? '';
      const url = token ? 'https://ipinfo.io/' + rawurlencode(ip) + '/json?token=' + rawurlencode(token) : 'https://ipapi.co/' + rawurlencode(ip) + '/json/';
      const j: Row = await (await fetch(url, { headers: { 'User-Agent': 'WhereToSpot-Dashboard/1.0' }, signal: AbortSignal.timeout(6000) })).json();
      if (!j || j.error || j.bogon) return none;
      city = phpTrim([...new Set([j.city ?? '', j.region ?? ''].filter(Boolean))].join(', '));
      isp = phpTrim(String(j.org ?? j.asn_org ?? '').replace(/^AS\d+[\t\n\x0B\f\r ]+/, ''));
    } catch { return none; }
  }
  const out = { city: mbSubstr(city, 0, 80), isp: mbSubstr(isp, 0, 80) };
  await s.db.prepare("INSERT INTO ip_geo (ip, city, isp, at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(ip) DO UPDATE SET city = excluded.city, isp = excluded.isp, at = excluded.at").bind(ip, out.city, out.isp).run();
  return out;
}

async function deviceNewAlert(s: Shop, u: Row, label: string, geo: { city: string; isp: string }, ip: string): Promise<void> {
  await logActivity(s, u, 'New device', label + (geo.city ? ' · ' + geo.city : ''));
  const to = (await s.db.prepare("SELECT email FROM users WHERE role = 'owner' AND active = 1").all<Row>()).results.map((r) => String(r.email));
  if (!to.length) return;
  const where = phpTrim([geo.city, geo.isp].filter(Boolean).join(' · '));
  const inner = '<p style="margin:0 0 12px"><b>' + h(u.name) + '</b> just signed in to the dashboard from a device they haven’t used before.</p>'
    + '<p style="margin:0 0 6px"><b>Device:</b> ' + h(label) + '</p>' + (where ? '<p style="margin:0 0 6px"><b>From:</b> ' + h(where) + '</p>' : '')
    + '<p style="margin:0 0 16px"><b>IP:</b> ' + h(ip) + '</p><p style="margin:0 0 16px">If this wasn’t them, open Team → ' + h(u.name) + ' → Devices and press Sign out, and change their password.</p>'
    + btn(s.site + '/admin/#team', 'Open Team');
  await sendMail(s, to, 'New device sign-in: ' + u.name, emailShell(s, 'New device sign-in', inner),
    u.name + ' signed in from a new device.\nDevice: ' + label + '\n' + (where ? 'From: ' + where + '\n' : '') + 'IP: ' + ip + "\n\nIf this wasn't them: Team → " + u.name + ' → Devices → Sign out.');
}

// ---------- settings in kv ----------
export async function teamSetting(s: Shop, key: string, def: unknown = null): Promise<any> {
  const r = await s.db.prepare('SELECT value FROM kv WHERE key = ?').bind('team.' + key).first<Row>();
  if (!r) return def;
  try { return JSON.parse(String(r.value)); } catch { return null; }
}
export const teamSetSetting = (s: Shop, key: string, value: unknown) =>
  s.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind('team.' + key, JSON.stringify(value)).run();

export async function loginLocationNeeded(s: Shop, u: Row): Promise<boolean> {
  if (!(await teamSetting(s, 'ask_location', false))) return false;
  const id = phpInt(s.session!.data.login_id ?? 0);
  if (!id) return false;
  const r = await s.db.prepare('SELECT loc_status FROM user_logins WHERE id = ? AND user_id = ?').bind(id, phpInt(u.id)).first<Row>();
  return !!r && r.loc_status === null; // fetchColumn() === null only for a NULL value; no row gives false in PHP
}
export async function loginLocationRefreshDue(s: Shop, u: Row): Promise<boolean> {
  if (!(await teamSetting(s, 'ask_location', false))) return false;
  const r = await s.db.prepare('SELECT loc_status, loc_at FROM user_logins WHERE id = ? AND user_id = ?').bind(phpInt(s.session!.data.login_id ?? 0), phpInt(u.id)).first<Row>();
  return !!r && r.loc_status !== null && (!r.loc_at || Date.parse(String(r.loc_at).replace(' ', 'T') + 'Z') / 1000 < nowUnix() - 86400);
}
export async function loginLocation(s: Shop, uid: number, b: Row): Promise<void> {
  const id = phpInt(s.session!.data.login_id ?? 0);
  if (!id) return;
  if (b.lat === undefined || b.lat === null || b.lng === undefined || b.lng === null) {
    const why = ['denied', 'unavailable', 'timeout', 'skipped'].includes(b.denied) ? b.denied : 'denied';
    await s.db.prepare('UPDATE user_logins SET loc_status = ? WHERE id = ? AND user_id = ?').bind(why, id, uid).run();
    return;
  }
  const lat = Math.max(-90, Math.min(90, phpFloat(b.lat))), lng = Math.max(-180, Math.min(180, phpFloat(b.lng)));
  await s.db.prepare("UPDATE user_logins SET lat = ?, lng = ?, acc = ?, loc_status = 'ok', loc_at = datetime('now') WHERE id = ? AND user_id = ?")
    .bind(round(lat, 6), round(lng, 6), round(Math.max(0, phpFloat(b.acc ?? 0))), id, uid).run();
}

// Working hours: first and last use each day, and minutes with activity (once a minute at most).
export async function devicePing(s: Shop, uid: number): Promise<void> {
  const now = nowUnix();
  const prev = phpInt(s.session!.data.ping ?? 0);
  if (now - prev < 60) return;
  setSess(s, 'ping', now);
  const day = cairoDay(new Date(now * 1000));
  const at = utcStamp(new Date(now * 1000));
  const gap = prev && now - prev <= 900 ? (now - prev) / 60 : 0;
  await s.db.prepare(`INSERT INTO user_days (user_id, day, first_at, last_at, online_min) VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(user_id, day) DO UPDATE SET last_at = excluded.last_at, online_min = online_min + ?`).bind(uid, day, at, at, round(gap, 2)).run();
}

export async function loginList(s: Shop, uid: number, limit = 20): Promise<Row[]> {
  const { results } = await s.db.prepare('SELECT l.*, d.label FROM user_logins l LEFT JOIN user_devices d ON d.id = l.device_id WHERE l.user_id = ? ORDER BY l.id DESC LIMIT ' + Math.max(1, Math.min(100, limit))).bind(uid).all<Row>();
  return results.map((l) => ({ at: l.at, device: l.label, ip: l.ip, city: l.city, isp: l.isp, newDevice: !!phpInt(l.new_device),
    location: (l.loc_status ?? '') === 'ok' ? { lat: Number(l.lat), lng: Number(l.lng), acc: phpInt(l.acc), at: l.loc_at ?? null } : null, locStatus: l.loc_status ?? null }));
}
export async function workingHours(s: Shop, since: string, uid: number | null = null): Promise<Row[]> {
  const sql = 'SELECT d.*, u.name, u.role FROM user_days d JOIN users u ON u.id = d.user_id WHERE d.day >= ?' + (uid ? ' AND d.user_id = ?' : '') + ' ORDER BY d.day DESC, u.name';
  const st = uid ? s.db.prepare(sql).bind(since, uid) : s.db.prepare(sql).bind(since);
  return (await st.all<Row>()).results.map((r) => ({ userId: phpInt(r.user_id), name: r.name, role: r.role, day: r.day, first: r.first_at, last: r.last_at, onlineMin: Math.trunc(round(Number(r.online_min))) }));
}

// ---------- team members ----------
export async function saveUser(s: Shop, b: Row, id: number | null): Promise<number> {
  const name = strIn(b.name, 120), email = strIn(b.email, 160);
  const role = (b.role ?? '') in ROLES ? b.role : 'staff';
  let ref: string | null = strIn(b.ref_code, 20).toUpperCase();
  ref = ref === '' ? null : ref.replace(/[^A-Z0-9-]/g, '');
  const pw = String(b.password ?? '');
  const empty = (v: unknown) => !v || v === '0';
  if (name === '' || !validEmail(email)) fail('Enter a name and a valid email.');
  if ((!id || pw !== '') && new TextEncoder().encode(pw).length < 8) fail('Password must be at least 8 characters.');
  const dupe = await s.db.prepare('SELECT id FROM users WHERE (email = ? OR (ref_code IS NOT NULL AND ref_code = ?)) AND id != ?').bind(email, ref, id || 0).first();
  if (dupe) fail('That email or referral code is already used by another team member.');
  if (id) {
    const stmts = [s.db.prepare('UPDATE users SET name = ?, email = ?, phone = ?, role = ?, ref_code = ?, active = ?, notify = ? WHERE id = ?')
      .bind(name, email, strIn(b.phone, 40), role, ref, empty(b.active) ? 0 : 1, empty(b.notify) ? 0 : 1, id)];
    if (pw !== '') stmts.push(s.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash(pw), id));
    await s.db.batch(stmts);
    const owners = Number((await s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1").first<Row>())?.n ?? 0);
    if (owners === 0) fail('At least one active owner is required.'); // (PHP had no transaction here either)
    return id;
  }
  const r = await s.db.prepare('INSERT INTO users (name, email, phone, password_hash, role, ref_code, active, notify) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(name, email, strIn(b.phone, 40), passwordHash(pw), role, ref, 'active' in b && empty(b.active) ? 0 : 1, empty(b.notify) ? 0 : 1).run();
  return Number(r.meta.last_row_id);
}
export { ShopError };
