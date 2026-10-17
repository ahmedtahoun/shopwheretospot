<?php
// Partner brands: products another brand supplies to us. The shop shows them under the brand's
// logo; each sale of their product earns us the brand's commission (a % of the item price) and the
// rest is owed to the brand. Order-level promo discounts and delivery fees are ours, so the brand's
// share is always worked out on the item price the customer was charged before any promo code.
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
    if ($admin) $out += ['commission' => (float) $b['commission'], 'active' => (bool) $b['active'], 'sort' => (int) $b['sort']];
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
            $comm = round($sales * $pct / 100, 2);
            $out[] = ['orderId' => (int) $o['id'], 'number' => order_number((int) $o['id']), 'customer' => $o['customer'], 'status' => $o['status'],
                'at' => $o['created_at'], 'name' => $it['name'], 'qty' => (int) $it['qty'], 'sales' => $sales, 'pct' => $pct,
                'commission' => $comm, 'due' => round($sales - $comm, 2), 'delivered' => $o['status'] === 'Delivered'];
        }
    }
    return $out;
}

// Totals for a set of lines: everything sold, and the part already delivered (cash in hand).
function brand_totals(array $lines): array
{
    $t = ['pieces' => 0, 'sales' => 0.0, 'commission' => 0.0, 'due' => 0.0, 'deliveredSales' => 0.0, 'deliveredCommission' => 0.0, 'deliveredDue' => 0.0, 'orders' => 0];
    $orders = [];
    foreach ($lines as $l) {
        $t['pieces'] += $l['qty']; $t['sales'] += $l['sales']; $t['commission'] += $l['commission']; $t['due'] += $l['due'];
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
