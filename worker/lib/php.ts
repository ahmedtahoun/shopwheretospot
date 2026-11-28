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
