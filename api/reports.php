<?php
// Monthly reports (dashboard → Reports): each calendar month in Cairo time, calculated live from orders,
// payments, expenses and the team's pay, plus a copy saved when the month closes (on the 1st) so later
// changes (an October order cancelled in November, an expense entered late) show as "at month close → now".
//
// Money is shown three ways, because each answers a different question:
//   Sales      – orders placed in the month (not cancelled, returned or unpaid online)
//   Delivered  – orders delivered in the month (what commissions are paid on)
//   Collected  – money actually received in the month (payments, any order)
// Profit:
//   Gross = sales − cost of those sales. Cost = each line's saved unit cost or the product's cost price,
//           plus supplier bills linked to a custom order (made-to-order lines have no cost price).
//   Net   = gross − operating expenses − salaries and commissions. Supplier/production bills never come off
//           again here: a bill for a custom order is already in that order's cost, and buying stock is already
//           counted through the products' cost prices.

function reports_migrate(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS month_reports (month TEXT PRIMARY KEY, data TEXT NOT NULL, saved_at TEXT NOT NULL DEFAULT (datetime('now')))");
}

function report_cairo_now(): DateTime { return new DateTime('now', new DateTimeZone('Africa/Cairo')); }

// One month's numbers.
function month_report(string $month): array
{
    [$month, $from, $to] = cairo_month_bounds($month);
    $pdo = db();
    $valid = "status NOT IN ('Cancelled','Returned','Awaiting payment')";
    $now = report_cairo_now();
    $first = new DateTime($month . '-01', new DateTimeZone('Africa/Cairo'));
    $daysIn = (int) $first->format('t');
    $isCurrent = $now->format('Y-m') === $month;
    $daysSoFar = $isCurrent ? (int) $now->format('j') : $daysIn;

    // Orders placed this month (all statuses, to also count cancellations).
    $st = $pdo->prepare("SELECT o.*, u.name AS rep_name FROM orders o LEFT JOIN users u ON u.id = o.rep_id WHERE o.status != 'Awaiting payment' AND o.created_at >= ? AND o.created_at < ?");
    $st->execute([$from, $to]);
    $orders = $st->fetchAll();
    $costs = [];
    foreach ($pdo->query('SELECT id, cost, cat FROM products')->fetchAll() as $p) $costs[$p['id']] = ['cost' => (float) $p['cost'], 'cat' => $p['cat']];
    $catLabels = $pdo->query('SELECT key, label FROM categories')->fetchAll(PDO::FETCH_KEY_PAIR);

    $sales = ['orders' => 0, 'value' => 0.0, 'shipping' => 0.0, 'discounts' => 0.0];
    $lost = ['orders' => 0, 'value' => 0.0];
    $byCat = []; $top = []; $bySource = []; $byRep = [];
    $cogs = 0.0; $covered = 0.0; $linesValue = 0.0; $customOrders = [];
    $customerKeys = [];
    foreach ($orders as $o) {
        if (in_array($o['status'], ['Cancelled', 'Returned'], true)) { $lost['orders']++; $lost['value'] += (float) $o['total']; continue; }
        $sales['orders']++; $sales['value'] += (float) $o['total']; $sales['shipping'] += (float) $o['shipping']; $sales['discounts'] += (float) $o['discount'];
        $src = $o['source'] ?: 'Website';
        $bySource[$src] = $bySource[$src] ?? ['source' => $src, 'orders' => 0, 'value' => 0.0];
        $bySource[$src]['orders']++; $bySource[$src]['value'] += (float) $o['total'];
        $rep = $o['rep_name'] ?: '';
        $byRep[$rep] = $byRep[$rep] ?? ['name' => $rep, 'orders' => 0, 'value' => 0.0];
        $byRep[$rep]['orders']++; $byRep[$rep]['value'] += (float) $o['total'];
        $key = phone_key((string) $o['phone']) ?: strtolower(trim((string) $o['email']));
        if ($key) $customerKeys[$key] = true;
        foreach (json_decode((string) $o['items'], true) ?: [] as $it) {
            $line = (float) ($it['total'] ?? ((float) $it['price'] * (int) $it['qty']));
            $qty = (int) ($it['qty'] ?? 1);
            $id = (string) ($it['id'] ?? '');
            $linesValue += $line;
            $cat = $id === 'custom' ? 'custom' : ($costs[$id]['cat'] ?? ($it['cat'] ?? 'other'));
            $byCat[$cat] = $byCat[$cat] ?? ['key' => $cat, 'label' => $cat === 'custom' ? 'Custom & quoted items' : ($catLabels[$cat] ?? ucfirst($cat)), 'qty' => 0, 'value' => 0.0];
            $byCat[$cat]['qty'] += $qty; $byCat[$cat]['value'] += $line;
            $tk = $id === 'custom' ? 'custom:' . ($it['name'] ?? '') : $id;
            $top[$tk] = $top[$tk] ?? ['name' => (string) ($it['name'] ?? $id), 'qty' => 0, 'value' => 0.0];
            $top[$tk]['qty'] += $qty; $top[$tk]['value'] += $line;
            $unit = isset($it['cost']) ? (float) $it['cost'] : ($id !== 'custom' ? ($costs[$id]['cost'] ?? 0.0) : 0.0);
            if ($unit > 0) { $cogs += $unit * $qty; $covered += $line; }
            if ($id === 'custom') $customOrders[(int) $o['id']] = ($customOrders[(int) $o['id']] ?? 0) + $line;
        }
    }

    // Supplier bills linked to this month's custom orders: their cost.
    $customCost = 0.0;
    if ($customOrders) {
        $ids = implode(',', array_map('intval', array_keys($customOrders)));
        foreach ($pdo->query("SELECT order_id, SUM(amount) v FROM expenses WHERE category = " . $pdo->quote(SUPPLIER_CATEGORY) . " AND order_id IN ($ids) GROUP BY order_id") as $b) {
            $customCost += (float) $b['v'];
            $covered += $customOrders[(int) $b['order_id']]; // that custom work's cost is known
        }
    }

    // Delivered this month.
    $st = $pdo->prepare("SELECT COUNT(*), COALESCE(SUM(total), 0) FROM orders WHERE status = 'Delivered' AND delivered_at >= ? AND delivered_at < ?");
    $st->execute([$from, $to]);
    [$delN, $delV] = $st->fetch(PDO::FETCH_NUM);

    // Money received this month, by how it was paid.
    $st = $pdo->prepare('SELECT method, COUNT(*) n, COALESCE(SUM(amount), 0) v FROM payments WHERE created_at >= ? AND created_at < ? GROUP BY method ORDER BY v DESC');
    $st->execute([$from, $to]);
    $byMethod = array_map(function ($r) { return ['method' => PAYMENT_METHODS[$r['method']] ?? ucfirst($r['method']), 'payments' => (int) $r['n'], 'value' => round((float) $r['v'], 2)]; }, $st->fetchAll());
    $collected = array_sum(array_column($byMethod, 'value'));

    // Expenses (by the day they were spent; days are Cairo days).
    $lastDay = $first->format('Y-m-t');
    $st = $pdo->prepare('SELECT category, COUNT(*) n, COALESCE(SUM(amount), 0) v FROM expenses WHERE spent_on >= ? AND spent_on <= ? GROUP BY category ORDER BY v DESC');
    $st->execute([$month . '-01', $lastDay]);
    $expRows = $st->fetchAll();
    $expenses = round(array_sum(array_map(function ($r) { return (float) $r['v']; }, $expRows)), 2);
    $supplierBills = round(array_sum(array_map(function ($r) { return $r['category'] === SUPPLIER_CATEGORY ? (float) $r['v'] : 0; }, $expRows)), 2);
    $byExpense = array_map(function ($r) { return ['category' => $r['category'], 'items' => (int) $r['n'], 'value' => round((float) $r['v'], 2)]; }, $expRows);
    $st = $pdo->prepare('SELECT COALESCE(SUM(amount), 0) FROM supplier_payments WHERE paid_on >= ? AND paid_on <= ?');
    $st->execute([$month . '-01', $lastDay]);
    $paidSuppliers = round((float) $st->fetchColumn(), 2);

    // The team's pay for the month (salaries + commissions on delivered orders).
    $team = team_commissions($month)['totals'];

    // Customers: first order ever placed this month = new.
    $new = 0;
    if ($customerKeys) {
        $firsts = [];
        foreach ($pdo->query("SELECT phone, email, MIN(created_at) first FROM orders WHERE $valid GROUP BY phone, email")->fetchAll() as $r) {
            $k = phone_key((string) $r['phone']) ?: strtolower(trim((string) $r['email']));
            if ($k && (!isset($firsts[$k]) || $r['first'] < $firsts[$k])) $firsts[$k] = $r['first'];
        }
        foreach (array_keys($customerKeys) as $k) if (isset($firsts[$k]) && $firsts[$k] >= $from && $firsts[$k] < $to) $new++;
    }
    $st = $pdo->prepare('SELECT COUNT(*), SUM(CASE WHEN status = \'Won\' THEN 1 ELSE 0 END) FROM leads WHERE created_at >= ? AND created_at < ?');
    $st->execute([$from, $to]);
    [$leads, $leadsWon] = $st->fetch(PDO::FETCH_NUM);
    $chats = ['new' => 0, 'fromAds' => 0];
    try {
        $st = $pdo->prepare("SELECT COUNT(*), SUM(CASE WHEN ad_id != '' OR ad_headline != '' THEN 1 ELSE 0 END) FROM wa_chats WHERE created_at >= ? AND created_at < ?");
        $st->execute([$from, $to]);
        [$cn, $ca] = $st->fetch(PDO::FETCH_NUM);
        $chats = ['new' => (int) $cn, 'fromAds' => (int) $ca];
    } catch (Throwable $e) {}

    $costOfSales = round($cogs + $customCost, 2);
    $gross = round($sales['value'] - $costOfSales, 2);
    $operating = round($expenses - $supplierBills, 2);
    $net = round($gross - $operating - (float) $team['pay'], 2);
    $sortVal = function (array $a) { $a = array_values($a); usort($a, function ($x, $y) { return $y['value'] <=> $x['value']; }); return array_map(function ($r) { $r['value'] = round($r['value'], 2); return $r; }, $a); };

    return [
        'month' => $month, 'current' => $isCurrent, 'days' => $daysIn, 'daysSoFar' => $daysSoFar,
        'sales' => ['orders' => $sales['orders'], 'value' => round($sales['value'], 2), 'avg' => $sales['orders'] ? round($sales['value'] / $sales['orders'], 2) : 0,
            'shipping' => round($sales['shipping'], 2), 'discounts' => round($sales['discounts'], 2)],
        'lost' => ['orders' => $lost['orders'], 'value' => round($lost['value'], 2)],
        'delivered' => ['orders' => (int) $delN, 'value' => round((float) $delV, 2)],
        'collected' => ['value' => round($collected, 2), 'byMethod' => $byMethod],
        'expenses' => ['value' => $expenses, 'operating' => $operating, 'supplierBills' => $supplierBills, 'paidSuppliers' => $paidSuppliers, 'byCategory' => $byExpense],
        'team' => ['salaries' => round((float) $team['salary'], 2), 'commissions' => round((float) $team['commission'], 2), 'pay' => round((float) $team['pay'], 2)],
        'profit' => ['costOfSales' => $costOfSales, 'customCost' => round($customCost, 2), 'gross' => $gross, 'net' => $net,
            // Share of sales whose cost is known (lines without a cost price lower the accuracy of profit).
            'costCoverage' => $linesValue > 0 ? (int) round($covered / $linesValue * 100) : 100],
        'customers' => ['total' => count($customerKeys), 'new' => $new, 'returning' => count($customerKeys) - $new],
        'leads' => ['new' => (int) $leads, 'won' => (int) $leadsWon], 'chats' => $chats,
        'byCategory' => $sortVal($byCat), 'topProducts' => array_slice($sortVal($top), 0, 10), 'bySource' => $sortVal($bySource), 'byRep' => $sortVal($byRep),
    ];
}

// The months that have any data, newest first (from the first order or expense to this month).
function report_months(): array
{
    $pdo = db();
    $firstOrder = $pdo->query("SELECT MIN(created_at) FROM orders WHERE status != 'Awaiting payment'")->fetchColumn();
    $firstExp = $pdo->query('SELECT MIN(spent_on) FROM expenses')->fetchColumn();
    $start = min(array_filter([$firstOrder ? substr($firstOrder, 0, 7) : null, $firstExp ? substr($firstExp, 0, 7) : null])) ?: report_cairo_now()->format('Y-m');
    $months = [];
    $m = new DateTime(report_cairo_now()->format('Y-m') . '-01');
    $stop = new DateTime($start . '-01');
    while ($m >= $stop && count($months) < 60) { $months[] = $m->format('Y-m'); $m->modify('-1 month'); }
    return $months;
}

// The copy saved when the month closed (or when reports started, for older months).
function report_snapshot(string $month): ?array
{
    $st = db()->prepare('SELECT data, saved_at FROM month_reports WHERE month = ?');
    $st->execute([$month]);
    $r = $st->fetch();
    return $r ? ['savedAt' => $r['saved_at'], 'data' => json_decode($r['data'], true)] : null;
}

// From the 1st: save every finished month that has no copy yet. Cheap; called from the dashboard and the cron job.
function report_close_months(): array
{
    $closed = [];
    $current = report_cairo_now()->format('Y-m');
    foreach (report_months() as $m) {
        if ($m === $current || report_snapshot($m)) continue;
        db()->prepare('INSERT OR IGNORE INTO month_reports (month, data) VALUES (?, ?)')->execute([$m, json_encode(month_report($m), JSON_UNESCAPED_UNICODE)]);
        $closed[] = $m;
    }
    return $closed;
}

// The few numbers that tell whether a month changed since it closed.
function report_changes(array $then, array $now): array
{
    $out = [];
    foreach ([['sales', 'value', 'Sales'], ['sales', 'orders', 'Orders'], ['collected', 'value', 'Collected'], ['expenses', 'value', 'Expenses'], ['profit', 'net', 'Net profit']] as [$a, $b, $label]) {
        $x = (float) ($then[$a][$b] ?? 0); $y = (float) ($now[$a][$b] ?? 0);
        if (abs($x - $y) >= 1) $out[] = ['label' => $label, 'then' => $x, 'now' => $y];
    }
    return $out;
}
