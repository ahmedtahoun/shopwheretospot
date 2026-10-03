<?php
// Product options and pricing.
//
// A product can have:
//   variants  — e.g. sizes: [{id, label, sku, stock, tiers:[{min, price}]}]; each has its own stock and prices
//   tiers     — quantity prices when there are no variants: [{min, price}] (price = per piece at qty >= min)
//   addons    — extras chosen once per line: [{group, options:[{id, label, price, per:'unit'|'order'}]}]
//               The first option in a group is the default (usually "Standard", price 0).
// Line totals are rounded to whole pounds, so "3 for EGP 1,000" can be entered as 333.33 per piece.

function product_json(array $p, string $key): array
{
    $v = json_decode((string) ($p[$key] ?? ''), true);
    return is_array($v) ? $v : [];
}

function pick_tier(array $tiers, int $qty): ?float
{
    $best = null;
    $bestMin = 0;
    foreach ($tiers as $t) {
        $min = (int) ($t['min'] ?? 0);
        if ($min >= 1 && $min <= $qty && $min >= $bestMin && (float) ($t['price'] ?? 0) > 0) { $best = (float) $t['price']; $bestMin = $min; }
    }
    return $best;
}

// Price one cart line. Throws ShopError if the variant/addon doesn't exist.
// Returns [unit, total, variant|null, addonLabels[], displayName].
function price_line(array $p, ?string $variantId, array $addonIds, int $qty): array
{
    $variants = product_json($p, 'variants');
    $variant = null;
    if ($variants) {
        foreach ($variants as $v) if ((string) $v['id'] === (string) $variantId) $variant = $v;
        if (!$variant) {
            if (count($variants) === 1) $variant = $variants[0];
            else throw new ShopError('Choose an option for ' . $p['name'] . '.');
        }
    }
    $base = (float) $p['price'];
    $tiers = $variant ? (array) ($variant['tiers'] ?? []) : product_json($p, 'tiers');
    $unit = pick_tier($tiers, $qty) ?? ($variant && !empty($variant['price']) ? (float) $variant['price'] : $base);
    $disc = (float) ($p['discount_pct'] ?? 0);
    if ($disc > 0) $unit = $unit * (1 - $disc / 100);

    $labels = [];
    $perUnit = 0.0;
    $perOrder = 0.0;
    foreach (product_json($p, 'addons') as $g) {
        $opts = (array) ($g['options'] ?? []);
        if (!$opts) continue;
        $chosen = $opts[0];
        foreach ($opts as $o) if (in_array((string) $o['id'], array_map('strval', $addonIds), true)) $chosen = $o;
        $price = (float) ($chosen['price'] ?? 0);
        if (($chosen['per'] ?? 'unit') === 'order') $perOrder += $price; else $perUnit += $price;
        if ($price != 0 || count($opts) > 1) $labels[] = ['id' => (string) $chosen['id'], 'label' => (string) $chosen['label'], 'group' => (string) ($g['group'] ?? '')];
    }
    $total = round(($unit + $perUnit) * $qty + $perOrder);
    $name = $p['name'] . ($variant ? ' — ' . $variant['label'] : '');
    $extras = array_values(array_filter(array_map(function ($a) { return $a['label']; }, $labels), function ($l) { return stripos($l, 'standard') === false; }));
    if ($extras) $name .= ' · ' . implode(' · ', $extras);
    return [round($total / max(1, $qty), 4), (float) $total, $variant, $labels, $name];
}

// Lowest per-piece price, for "From EGP …" labels.
function from_price(array $p): float
{
    $prices = [];
    $variants = product_json($p, 'variants');
    $lists = $variants ? array_map(function ($v) { return (array) ($v['tiers'] ?? []); }, $variants) : [product_json($p, 'tiers')];
    foreach ($lists as $i => $tiers) {
        foreach ($tiers as $t) if ((float) ($t['price'] ?? 0) > 0) $prices[] = (float) $t['price'];
        if (!$tiers) $prices[] = $variants && !empty($variants[$i]['price']) ? (float) $variants[$i]['price'] : (float) $p['price'];
    }
    $min = $prices ? min($prices) : (float) $p['price'];
    $disc = (float) ($p['discount_pct'] ?? 0);
    return $disc > 0 ? round($min * (1 - $disc / 100), 2) : $min;
}

// Stock lives on the variant when a product has variants; products.stock then holds their sum.
function variant_stock(array $p, ?array $variant): int
{
    return $variant ? (int) ($variant['stock'] ?? 0) : (int) $p['stock'];
}

function adjust_stock(PDO $pdo, string $productId, ?string $variantId, int $delta): void
{
    $st = $pdo->prepare("SELECT cat, variants FROM products WHERE id = ?");
    $st->execute([$productId]);
    $p = $st->fetch();
    if (!$p || $p['cat'] === 'services') return;
    $variants = product_json($p, 'variants');
    if ($variants && $variantId !== null) {
        $sum = 0;
        foreach ($variants as &$v) {
            if ((string) $v['id'] === (string) $variantId) $v['stock'] = max(0, (int) ($v['stock'] ?? 0) + $delta);
            $sum += (int) ($v['stock'] ?? 0);
        }
        unset($v);
        $pdo->prepare("UPDATE products SET variants = ?, stock = ?, updated_at = datetime('now') WHERE id = ?")
            ->execute([json_encode($variants, JSON_UNESCAPED_UNICODE), $sum, $productId]);
        return;
    }
    $pdo->prepare("UPDATE products SET stock = MAX(0, stock + ?), updated_at = datetime('now') WHERE id = ?")->execute([$delta, $productId]);
}

// Clean up variants/tiers/addons coming from the product editor.
function clean_tiers($tiers): array
{
    $out = [];
    foreach ((array) $tiers as $t) {
        $min = max(1, (int) ($t['min'] ?? 0));
        $price = round((float) ($t['price'] ?? 0), 2);
        if ($price > 0) $out[$min] = ['min' => $min, 'price' => $price];
    }
    ksort($out);
    return array_values($out);
}

function clean_variants($variants): array
{
    $out = [];
    foreach ((array) $variants as $v) {
        $label = str_in($v['label'] ?? '', 60);
        if ($label === '') continue;
        $id = preg_replace('/[^a-z0-9]/', '', strtolower((string) ($v['id'] ?? ''))) ?: 'v' . bin2hex(random_bytes(3));
        $out[] = ['id' => $id, 'label' => $label, 'sku' => str_in($v['sku'] ?? '', 40), 'stock' => max(0, (int) ($v['stock'] ?? 0)),
            'price' => max(0, round((float) ($v['price'] ?? 0), 2)), 'tiers' => clean_tiers($v['tiers'] ?? [])];
    }
    return $out;
}

function clean_addons($groups): array
{
    $out = [];
    foreach ((array) $groups as $g) {
        $opts = [];
        foreach ((array) ($g['options'] ?? []) as $o) {
            $label = str_in($o['label'] ?? '', 60);
            if ($label === '') continue;
            $id = preg_replace('/[^a-z0-9]/', '', strtolower((string) ($o['id'] ?? ''))) ?: 'a' . bin2hex(random_bytes(3));
            $opts[] = ['id' => $id, 'label' => $label, 'price' => round((float) ($o['price'] ?? 0), 2), 'per' => ($o['per'] ?? '') === 'order' ? 'order' : 'unit'];
        }
        $name = str_in($g['group'] ?? '', 40);
        if ($opts) $out[] = ['group' => $name ?: 'Option', 'options' => $opts];
    }
    return $out;
}
