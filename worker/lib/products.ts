// The product editor's cleaning rules (port of api/pricing.php clean_* / apply_size_prices / brand_sell_price).
import { round, phpInt, phpFloat, randomHex } from './php';
import { type Row } from './catalog';
import { strIn } from './shop';

const list = (v: unknown): any[] => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : v === undefined || v === null || v === '' ? [] : [v]);

export function cleanTiers(tiers: unknown): Row[] {
  const out = new Map<number, Row>();
  for (const t of list(tiers)) {
    const min = Math.max(1, phpInt(t?.min ?? 0));
    const price = round(phpFloat(t?.price ?? 0), 2);
    if (price > 0) { out.delete(min); out.set(min, { min, price }); }
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

export function cleanVariants(variants: unknown): Row[] {
  const out: Row[] = [];
  for (const v of list(variants)) {
    const label = strIn(v?.label, 60);
    if (label === '') continue;
    const id = String(v.id ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'v' + randomHex(3);
    const row: Row = { id, label, sku: strIn(v.sku, 40), stock: Math.max(0, phpInt(v.stock ?? 0)), price: Math.max(0, round(phpFloat(v.price ?? 0), 2)), tiers: cleanTiers(v.tiers ?? []),
      ratio: Math.max(0, Math.min(10, round(phpFloat(v.ratio ?? 0), 4))) };
    const own = round(phpFloat(v.brandOwn ?? 0), 2);
    if (own > 0) row.brandOwn = own;
    out.push(row);
  }
  return out;
}

export function applySizePrices(main: number, variants: Row[], brandPrice = 0): Row[] {
  for (const v of variants) {
    const ratio = phpFloat(v.ratio ?? 0);
    if (ratio > 0 && main > 0) v.price = round(main * ratio);
    if (brandPrice > 0 && ratio <= 0 && phpFloat(v.brandOwn ?? 0) > 0) v.brandPrice = round(phpFloat(v.brandOwn), 2);
    else if (brandPrice > 0) v.brandPrice = round(ratio > 0 ? brandPrice * ratio : main > 0 && v.price > 0 ? brandPrice * v.price / main : brandPrice, 2);
    else delete v.brandPrice;
  }
  return variants;
}

export const brandSellPrice = (brandPrice: number, marginPct: number): number => round(brandPrice * (1 + marginPct / 100));

export function cleanAddons(groups: unknown): Row[] {
  const out: Row[] = [];
  for (const g of list(groups)) {
    const opts: Row[] = [];
    for (const o of list(g?.options ?? [])) {
      const label = strIn(o?.label, 60);
      if (label === '') continue;
      const id = String(o.id ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'a' + randomHex(3);
      opts.push({ id, label, price: round(phpFloat(o.price ?? 0), 2), per: o.per === 'order' ? 'order' : 'unit' });
    }
    const name = strIn(g?.group, 40);
    if (opts.length) out.push({ group: name || 'Option', options: opts });
  }
  return out;
}
