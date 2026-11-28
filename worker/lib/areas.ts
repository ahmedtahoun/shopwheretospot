// Delivery areas for checkout (port of the area part of api/bosta.php): the city list, a city's areas,
// "type your area" search and suggestions from the typed address.
// The Bosta lists are built into the Worker (worker/data/*.json) so nothing large is parsed per request.
import AREAS from '../data/bosta-areas.json';
import INDEX from '../data/bosta-area-index.json';
import { mbLen } from './php';

type City = { id: string; name: string; ar: string; districts: { id: string; name: string; ar: string; zoneId: string; zone: string; zoneAr: string }[] };
type Entry = { cityId: string; city: string; cityAr: string; zoneId: string; zone: string; zoneAr: string; zoneMain: boolean; zoneSize: number; id: string; name: string; ar: string; k: string[] };

export const bostaAreas = (): City[] => AREAS as City[];
const areaIndex = (): Entry[] => INDEX as Entry[];

// strcasecmp: byte-wise, ASCII case-insensitive.
const strcasecmp = (a: string, b: string): number => {
  const x = new TextEncoder().encode(a.replace(/[A-Z]/g, (c) => c.toLowerCase()));
  const y = new TextEncoder().encode(b.replace(/[A-Z]/g, (c) => c.toLowerCase()));
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};

export function bostaZones(city: City) {
  const zones = new Map<string, { id: string; name: string; ar: string; districts: { id: string; name: string; ar: string }[]; main?: string }>();
  for (const d of city.districts) {
    const key = d.zoneId || d.id;
    if (!zones.has(key)) zones.set(key, { id: key, name: d.zone || d.name, ar: d.zoneAr || d.ar, districts: [] });
    zones.get(key)!.districts.push({ id: d.id, name: d.name, ar: d.ar });
  }
  for (const z of zones.values()) {
    let main = z.districts[0].id;
    for (const d of z.districts) if (strcasecmp(d.name, z.name) === 0) { main = d.id; break; }
    z.main = main;
  }
  return [...zones.values()].sort((a, b) => strcasecmp(a.name, b.name));
}

const AR_MAP: Record<string, string> = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ة': 'ه', 'ى': 'ي', 'ؤ': 'و', 'ئ': '', 'ء': '',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

export function areaNorm(s: string): string {
  s = s.toLowerCase();
  s = s.replace(/[ً-ٰٟـ]/gu, '');
  s = s.replace(/[أإآٱةىؤئء٠-٩]/gu, (c) => AR_MAP[c] ?? c);
  s = s.replace(/[^\p{L}\p{N}]+/gu, ' ');
  return s.replace(/\s+/gu, ' ').trim();
}

const AREA_ALIASES: [string, string][] = Object.entries({
  tagamoa: 'التجمع', tagamo3: 'التجمع', tagamo: 'التجمع', tagamou: 'التجمع', fifth: '5th',
  heliopolis: 'مصر الجديده', 'masr el gedida': 'مصر الجديده', mohandeseen: 'المهندسين', mohandessin: 'المهندسين',
  mohandseen: 'المهندسين', downtown: 'وسط البلد', 'wust el balad': 'وسط البلد', zayed: 'الشيخ زايد',
  agami: 'العجمي', agamy: 'العجمي', alex: 'الاسكندريه', alexandria: 'الاسكندريه', october: 'اكتوبر', hadayek: 'حدائق', kobba: 'القبه', qobba: 'القبه',
});

function areaAlias(s: string): string {
  let n = ' ' + areaNorm(s) + ' ';
  for (const [from, to] of AREA_ALIASES) n = n.split(' ' + from + ' ').join(' ' + to + ' ');
  return n.trim();
}

function areaCompact(s: string): string {
  const words = areaNorm(s).split(' ').filter((w) => !['el', 'al', 'ال'].includes(w)).map((w) => w.replace(/^(el|al|ال)(?=\p{L}{3})/u, ''));
  return words.join('');
}

function areaResult(e: Entry, wholeZone: boolean) {
  if (wholeZone && e.zoneSize > 1) {
    return { districtId: e.id, cityId: e.cityId, zoneId: e.zoneId, title: e.zone, titleAr: e.zoneAr, sub: e.city + ' · any neighbourhood', subAr: e.cityAr };
  }
  const same = strcasecmp(e.name, e.zone) === 0;
  return { districtId: e.id, cityId: e.cityId, zoneId: e.zoneId, title: e.name, titleAr: e.ar,
    sub: (same ? '' : e.zone + ', ') + e.city, subAr: (same ? '' : e.zoneAr + '، ') + e.cityAr };
}

// PHP's usort with <=> is stable; JS sort is stable too.
function topUnique(scored: [number, ReturnType<typeof areaResult>][], limit: number, firstWins: boolean) {
  scored.sort((a, b) => (b[0] < a[0] ? -1 : b[0] > a[0] ? 1 : 0));
  const out = new Map<string, ReturnType<typeof areaResult>>();
  for (const [, r] of scored) {
    const key = r.districtId + '|' + r.title;
    if (firstWins && out.has(key)) continue;
    out.set(key, r);
    if (out.size >= limit) break;
  }
  return [...out.values()];
}

export function areaSearch(q: string, limit = 8) {
  q = areaAlias(q);
  const words = areaNorm(q).split(' ').map(areaCompact).filter((w) => w !== '' && w !== '0');
  const full = areaCompact(q);
  if (mbLen(full) < 2) return [];
  const scored: [number, ReturnType<typeof areaResult>][] = [];
  for (const e of areaIndex()) {
    const [dEn, dAr, zEn, zAr, cEn, cAr] = e.k;
    const hay = dEn + ' ' + dAr + ' ' + zEn + ' ' + zAr + ' ' + cEn + ' ' + cAr;
    if (!words.every((w) => hay.includes(w))) continue;
    let score = 0;
    for (const [en, ar, base] of [[dEn, dAr, 100], [zEn, zAr, 80]] as [string, string, number][]) {
      for (const k of [en, ar]) {
        if (k === '') continue;
        if (k === full) score = Math.max(score, base + 30);
        else if (k.startsWith(full)) score = Math.max(score, base + 15);
        else if (k.includes(full)) score = Math.max(score, base);
      }
    }
    if (!score) score = 20;
    const zoneHit = zEn === full || zAr === full || zEn.startsWith(full) || zAr.startsWith(full);
    if (zoneHit && e.zoneMain) scored.push([score + 40, areaResult(e, true)]);
    if (!(zoneHit && e.zoneSize > 1 && !e.zoneMain && score < 100) || words.length > 1) scored.push([score - mbLen(dEn) / 100, areaResult(e, false)]);
  }
  return topUnique(scored, limit, true);
}

export function areaSuggest(text: string, limit = 4) {
  const t = ' ' + areaAlias(text).split(' ').map(areaCompact).join(' ') + ' ';
  const tc = t.split(' ').join('');
  if (mbLen(tc) < 4) return [];
  const cities = new Set<string>();
  for (const e of areaIndex()) for (const k of [e.k[4], e.k[5]]) if (mbLen(k) >= 4 && tc.includes(k)) cities.add(e.cityId);
  const scored: [number, ReturnType<typeof areaResult>][] = [];
  for (const e of areaIndex()) {
    if (cities.size && !cities.has(e.cityId)) continue;
    const [dEn, dAr, zEn, zAr] = e.k;
    const hit = (k: string) => mbLen(k) >= 4 && tc.includes(k);
    const zoneLen = Math.max(hit(zEn) ? mbLen(zEn) : 0, hit(zAr) ? mbLen(zAr) : 0);
    const distLen = Math.max(hit(dEn) ? mbLen(dEn) : 0, hit(dAr) ? mbLen(dAr) : 0);
    if (distLen && (distLen !== zoneLen || e.zoneSize === 1)) scored.push([distLen + (zoneLen ? 8 : 0) + (cities.size ? 5 : 0), areaResult(e, false)]);
    if (zoneLen && e.zoneMain) scored.push([zoneLen + 6 + (cities.size ? 5 : 0), areaResult(e, true)]);
  }
  return topUnique(scored, limit, false);
}
