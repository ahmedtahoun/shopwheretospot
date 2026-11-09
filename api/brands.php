<?php
// Partner brands: products another brand supplies to us. The shop shows them under the brand's
// logo. Pricing: the brand's price + our margin % = the shop price. The brand gets its price minus
// our commission %; we keep the commission and the margin. Order-level promo discounts and delivery
// fees are ours. (Products without a brand price: the brand's share is worked out on the shop price.)
//
// Each order line remembers the brand and commission at the time of sale ('brand', 'comm'), so a
// later change of commission doesn't rewrite past statements.

function brand_row(array $b, bool $admin = false): array
{
    $out = [
        'id' => (int) $b['id'], 'slug' => $b['slug'], 'name' => $b['name'], 'nameAr' => (string) $b['name_ar'],
        'tagline' => (string) $b['tagline'], 'taglineAr' => (string) $b['tagline_ar'],
        'about' => (string) $b['about'], 'aboutAr' => (string) $b['about_ar'],
        'logo' => (string) $b['logo'], 'link' => (string) $b['link'],
    ];
    if ($admin) $out += ['commission' => (float) $b['commission'], 'margin' => (float) ($b['margin'] ?? 0), 'active' => (bool) $b['active'], 'sort' => (int) $b['sort'],
        'commissionB2b' => isset($b['commission_b2b']) ? (float) $b['commission_b2b'] : null, 'b2bMinQty' => isset($b['b2b_min_qty']) ? (int) $b['b2b_min_qty'] : null,
        'orderEmails' => (string) ($b['order_emails'] ?? ''), 'orderWhatsapp' => (string) ($b['order_whatsapp'] ?? '')];
    return $out;
}

function load_brands(bool $activeOnly, bool $admin = false): array
{
    $rows = db()->query('SELECT * FROM brands' . ($activeOnly ? ' WHERE active = 1' : '') . ' ORDER BY sort, name')->fetchAll();
    return array_map(function ($b) use ($admin) { return brand_row($b, $admin); }, $rows);
}

function brand_get(int $id): ?array
{
    $st = db()->prepare('SELECT * FROM brands WHERE id = ?');
    $st->execute([$id]);
    return $st->fetch() ?: null;
}

// The brand's margin changed: work out the shop prices of all its products again.
function reprice_brand_products(int $brandId): int
{
    $b = brand_get($brandId);
    if (!$b) return 0;
    $st = db()->prepare('SELECT id, brand_price, margin_pct, variants FROM products WHERE brand_id = ? AND brand_price > 0');
    $st->execute([$brandId]);
    $upd = db()->prepare("UPDATE products SET price = ?, variants = ?, updated_at = datetime('now') WHERE id = ?");
    $n = 0;
    foreach ($st->fetchAll() as $p) {
        $margin = $p['margin_pct'] !== null ? (float) $p['margin_pct'] : (float) $b['margin'];
        $main = brand_sell_price((float) $p['brand_price'], $margin);
        $vs = apply_size_prices($main, json_decode((string) $p['variants'], true) ?: [], (float) $p['brand_price']);
        $upd->execute([$main, json_encode($vs, JSON_UNESCAPED_UNICODE), $p['id']]);
        $n++;
    }
    return $n;
}

// Every line of every order that sold this brand's products, optionally for one month (YYYY-MM).
// Cancelled, returned and never-paid online orders don't count.
function brand_lines(int $brandId, ?string $month = null): array
{
    $pdo = db();
    $b = brand_get($brandId);
    if (!$b) return [];
    // Older lines without a stored brand: match by the product's current brand.
    $ids = $pdo->prepare('SELECT id FROM products WHERE brand_id = ?');
    $ids->execute([$brandId]);
    $mine = array_flip($ids->fetchAll(PDO::FETCH_COLUMN));
    $sql = "SELECT id, customer, status, items, created_at, updated_at FROM orders WHERE status NOT IN ('Cancelled', 'Returned', 'Awaiting payment')";
    $args = [];
    if ($month) { $sql .= " AND strftime('%Y-%m', created_at) = ?"; $args[] = $month; }
    $st = $pdo->prepare($sql . ' ORDER BY id');
    $st->execute($args);
    $out = [];
    foreach ($st->fetchAll() as $o) {
        foreach (json_decode($o['items'], true) ?: [] as $it) {
            $hit = isset($it['brand']) ? (int) $it['brand'] === $brandId : isset($mine[(string) ($it['id'] ?? '')]);
            if (!$hit) continue;
            $sales = (float) ($it['total'] ?? ((float) $it['price'] * (int) $it['qty']));
            $pct = isset($it['comm']) ? (float) $it['comm'] : (float) $b['commission'];
            // The brand's share is worked out on the brand's own price ('bp', per piece) when we know it;
            // anything we charged above it is our margin.
            $base = isset($it['bp']) ? round((float) $it['bp'] * (int) $it['qty'], 2) : $sales;
            $comm = round($base * $pct / 100, 2);
            $out[] = ['orderId' => (int) $o['id'], 'number' => order_number((int) $o['id']), 'customer' => $o['customer'], 'status' => $o['status'],
                'at' => $o['created_at'], 'name' => $it['name'], 'qty' => (int) $it['qty'], 'sales' => $sales, 'base' => $base, 'pct' => $pct,
                'commission' => $comm, 'margin' => round($sales - $base, 2), 'due' => round($base - $comm, 2), 'delivered' => $o['status'] === 'Delivered', 'b2b' => !empty($it['b2b'])];
        }
    }
    return $out;
}

// Totals for a set of lines: everything sold, and the part already delivered (cash in hand).
function brand_totals(array $lines): array
{
    $t = ['pieces' => 0, 'sales' => 0.0, 'base' => 0.0, 'margin' => 0.0, 'commission' => 0.0, 'due' => 0.0, 'deliveredSales' => 0.0, 'deliveredCommission' => 0.0, 'deliveredDue' => 0.0, 'orders' => 0];
    $orders = [];
    foreach ($lines as $l) {
        $t['pieces'] += $l['qty']; $t['sales'] += $l['sales']; $t['base'] += $l['base']; $t['margin'] += $l['margin']; $t['commission'] += $l['commission']; $t['due'] += $l['due'];
        if ($l['delivered']) { $t['deliveredSales'] += $l['sales']; $t['deliveredCommission'] += $l['commission']; $t['deliveredDue'] += $l['due']; }
        $orders[$l['orderId']] = 1;
    }
    $t['orders'] = count($orders);
    foreach ($t as $k => $v) if (is_float($v)) $t[$k] = round($v, 2);
    return $t;
}

function brand_paid_out(int $brandId): float
{
    $st = db()->prepare('SELECT COALESCE(SUM(amount), 0) FROM brand_payouts WHERE brand_id = ?');
    $st->execute([$brandId]);
    return round((float) $st->fetchColumn(), 2);
}

// What we owe the brand right now: its share of delivered orders, minus what we already paid.
function brand_balance(int $brandId): array
{
    $all = brand_totals(brand_lines($brandId));
    $paid = brand_paid_out($brandId);
    return ['earned' => $all['deliveredDue'], 'paid' => $paid, 'owed' => round($all['deliveredDue'] - $paid, 2),
        'pending' => round($all['due'] - $all['deliveredDue'], 2), 'commissionAllTime' => $all['deliveredCommission']];
}

// ---------- telling a brand about its orders (partner brands that deliver themselves, e.g. Heff in the UAE) ----------
// Each brand can have order emails (one or more) and a WhatsApp number (Partner brands → Edit brand). When an order
// is confirmed (cash on delivery: when placed; online: once paid), each brand in it gets an email with only its
// items, the customer, the address and what to collect. The order page also has "Send to <brand> on WhatsApp".

function brand_contacts(array $b): array
{
    $emails = array_values(array_filter(array_map('trim', preg_split('/[\s,;]+/', (string) ($b['order_emails'] ?? ''))), function ($e) { return filter_var($e, FILTER_VALIDATE_EMAIL); }));
    $wa = preg_replace('/\D/', '', (string) ($b['order_whatsapp'] ?? ''));
    return ['emails' => $emails, 'whatsapp' => strlen($wa) >= 8 ? market_intl_digits($wa) : ''];
}

// The brands in an order, each with its own lines. 'only': every product in the order is this brand's.
function brand_order_parts(array $o): array
{
    static $brands = [];
    $lines = is_array($o['items']) ? $o['items'] : (json_decode((string) $o['items'], true) ?: []);
    $parts = [];
    $products = 0;
    foreach ($lines as $l) {
        if (($l['cat'] ?? '') === 'services' || ($l['id'] ?? '') === 'custom') continue;
        $products++;
        if (empty($l['brand'])) continue;
        $id = (int) $l['brand'];
        if (!array_key_exists($id, $brands)) $brands[$id] = brand_get($id);
        if (!$brands[$id]) continue;
        $parts[$id] = $parts[$id] ?? ['brand' => $brands[$id], 'lines' => [], 'pieces' => 0, 'value' => 0.0];
        $parts[$id]['lines'][] = $l;
        $parts[$id]['pieces'] += (int) $l['qty'];
        $parts[$id]['value'] += (float) ($l['total'] ?? ((float) $l['price'] * (int) $l['qty']));
    }
    foreach ($parts as &$p) { $p['only'] = $p['pieces'] > 0 && count($p['lines']) === $products; $p['value'] = round($p['value'], 2); }
    unset($p);
    return array_values($parts);
}

// What the brand's courier collects: the order's balance when it's all theirs, else their items' value (mixed orders);
// nothing when the order is paid.
function brand_order_collect(array $o, array $part): float
{
    $due = max(0, round((float) $o['total'] - order_paid((int) $o['id']), 2));
    if ($due <= 0) return 0.0;
    return $part['only'] ? $due : min($due, $part['value']);
}

// The message for the brand (email text and WhatsApp), in English.
function brand_order_text(array $o, array $part): string
{
    $number = order_number((int) $o['id']);
    $collect = brand_order_collect($o, $part);
    $where = trim(implode(', ', array_filter([(string) $o['address'], (string) ($o['district'] ?? ''), (string) $o['city']])));
    $items = implode("\n", array_map(function ($l) { return '• ' . (int) $l['qty'] . '× ' . $l['name']; }, $part['lines']));
    return 'New order ' . $number . ' from Where To Spot for ' . $part['brand']['name'] . "\n\n"
        . $items . "\n\n"
        . 'Customer: ' . $o['customer'] . "\n"
        . 'Phone: ' . $o['phone'] . "\n"
        . 'Address: ' . ($where ?: '—') . "\n"
        . ($collect > 0 ? 'Collect on delivery: ' . money($collect) . ($part['only'] ? '' : ' (for these items; the order also has items from another seller)') : 'Paid online: collect nothing') . "\n"
        . (trim((string) ($o['notes'] ?? '')) !== '' ? 'Note: ' . trim((string) $o['notes']) . "\n" : '')
        . "\nPlease confirm, and tell us when it ships. Thank you!";
}

function brand_notify_order(array $o): void
{
    foreach (brand_order_parts($o) as $part) {
        $to = brand_contacts($part['brand'])['emails'];
        if (!$to) continue;
        $number = order_number((int) $o['id']);
        $collect = brand_order_collect($o, $part);
        $where = trim(implode(', ', array_filter([(string) $o['address'], (string) ($o['district'] ?? ''), (string) $o['city']])));
        $rows = implode('', array_map(function ($l) {
            return '<tr><td style="padding:6px 0;border-bottom:1px solid #EFEAE3">' . (int) $l['qty'] . '× ' . h($l['name']) . '</td></tr>';
        }, $part['lines']));
        $html = email_shell('New order ' . $number . ' for ' . $part['brand']['name'],
            '<p style="margin:0 0 4px"><b>' . h($o['customer']) . '</b></p>'
            . '<p style="margin:0 0 4px"><a href="tel:' . h($o['phone']) . '" style="color:#22201D">' . h($o['phone']) . '</a></p>'
            . '<p style="margin:0 0 16px;color:#6B6660">' . h($where ?: '—') . '</p>'
            . '<table style="width:100%;border-collapse:collapse;font-size:14px">' . $rows . '</table>'
            . '<p style="margin:16px 0 0;font-size:15px"><b>' . ($collect > 0 ? 'Collect on delivery: ' . h(money($collect)) : 'Paid online: collect nothing') . '</b>'
            . ($collect > 0 && !$part['only'] ? '<br><span style="color:#6B6660;font-size:13px">For these items; the order also has items from another seller.</span>' : '') . '</p>'
            . (trim((string) ($o['notes'] ?? '')) !== '' ? '<p style="margin:12px 0 0;white-space:pre-line;background:#F7F3ED;border-radius:10px;padding:12px 14px">' . h(trim((string) $o['notes'])) . '</p>' : '')
            . '<p style="margin:18px 0 0">' . btn(wa_link((string) $o['phone']), 'WhatsApp customer', '#1F7A4D') . '</p>'
            . '<p style="color:#6B6660;font-size:13px;margin:16px 0 0">Please confirm, and tell us when it ships. Thank you!</p>', 'brand');
        send_mail_later($to, 'New order ' . $number . ' · ' . $part['pieces'] . ($part['pieces'] === 1 ? ' item' : ' items') . ' · ' . ($collect > 0 ? 'collect ' . money($collect) : 'paid'),
            $html, brand_order_text($o, $part));
    }
}

// For the order page: a WhatsApp link per brand that has a number, with the order's message ready to send.
function brand_order_share(array $o): array
{
    $out = [];
    foreach (brand_order_parts($o) as $part) {
        $wa = brand_contacts($part['brand'])['whatsapp'];
        if ($wa === '') continue;
        $out[] = ['brand' => $part['brand']['name'], 'url' => 'https://wa.me/' . $wa . '?text=' . rawurlencode(brand_order_text($o, $part))];
    }
    return $out;
}
