// Small helpers that behave exactly like the PHP functions the shop used, so pages and JSON come out the same.

// mb_strlen / mb_substr count characters (code points), not UTF-16 units like JS .length.
export const mbLen = (s: string): number => [...s].length;
export function mbSubstr(s: string, start: number, len?: number): string {
  const a = [...s];
  const from = start < 0 ? Math.max(0, a.length + start) : start;
  return a.slice(from, len === undefined ? undefined : from + len).join('');
}
// mb_stripos: case-insensitive position (characters), or false.
export function mbStripos(haystack: string, needle: string): number | false {
  const i = [...haystack.toLowerCase()].join('').indexOf(needle.toLowerCase());
  if (i < 0) return false;
  return [...haystack.toLowerCase().slice(0, i)].length;
}
export function mbStrrpos(s: string, needle: string): number | false {
  const i = s.lastIndexOf(needle);
  return i < 0 ? false : [...s.slice(0, i)].length;
}

// PHP round(): half away from zero, after PHP's pre-rounding to 15 significant digits.
export function round(v: number, precision = 0): number {
  const m = 10 ** precision;
  const x = Number((v * m).toPrecision(15));
  const r = Math.sign(x) * Math.round(Math.abs(x));
  return (r / m) || 0;
}

// number_format($n, $decimals, '.', ',')
export function numberFormat(n: number, decimals = 0, decPoint = '.', thousands = ','): string {
  const v = round(n, decimals);
  const neg = v < 0;
  const [int, frac = ''] = Math.abs(v).toFixed(decimals).split('.');
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  return (neg && Number(v) !== 0 ? '-' : '') + withSep + (decimals > 0 ? decPoint + frac : '');
}

// htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')
export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]!);

// rawurlencode: like encodeURIComponent, but also encodes ! ' ( ) *
export const rawurlencode = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES). PHP still escapes U+2028 / U+2029.
export const phpJson = (data: unknown): string =>
  JSON.stringify(data).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// PHP's (string) cast of a number: integers without ".0", other floats in shortest form (same as JS here).
export const str = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? '1' : '') : String(v));

// "Truthy" the PHP way (empty string, "0", 0, null, [] are false).
export const truthy = (v: unknown): boolean =>
  !(v === null || v === undefined || v === false || v === 0 || v === '' || v === '0' || (Array.isArray(v) && v.length === 0));

// json_decode($s, true) that falls back to [] like the shop's product_json().
export function jsonArray(s: unknown): any[] | Record<string, any> {
  if (typeof s !== 'string' || s === '') return [];
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : []; } catch { return []; }
}

// trim(): only " \t\n\r\0\x0B" (JS .trim() also strips Unicode spaces).
export const phpTrim = (s: string, chars = ' \t\n\r\0\x0B'): string => {
  let a = 0, b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
};

// (int) and (float) casts: numeric prefix of a string, booleans as 0/1, everything else 0.
export function phpInt(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') { const m = phpTrim(v, ' \t\n\r\x0B\f').match(/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/); return m ? Math.trunc(Number(m[0])) || 0 : 0; }
  return 0;
}
export function phpFloat(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') { const m = phpTrim(v, ' \t\n\r\x0B\f').match(/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/); return m ? Number(m[0]) : 0; }
  return 0;
}
// (string) cast as the shop uses it on request values.
export const phpStr = (v: unknown): string => (v === null || v === undefined || v === false ? '' : v === true ? '1' : typeof v === 'object' ? 'Array' : String(v));

// filter_var($e, FILTER_VALIDATE_EMAIL) for the addresses people type (ASCII local part and domain).
export const validEmail = (v: unknown): boolean => {
  const s = typeof v === 'string' ? v : '';
  if (s.length > 320 || !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(s)) return false;
  return s.split('@')[0].length <= 64;
};

// json_encode($d, JSON_UNESCAPED_UNICODE): like phpJson, but "/" is escaped as "\/".
export const phpJsonU = (data: unknown): string => phpJson(data).replace(/\//g, '\\/');
// json_encode($d) with no flags: also every non-ASCII character as \uXXXX.
export const phpJsonPlain = (data: unknown): string =>
  phpJsonU(data).replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

// Hex of random bytes (bin2hex(random_bytes(n))).
export const randomHex = (bytes: number): string => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function sha1Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}
