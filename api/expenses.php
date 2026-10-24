<?php
// Expenses and suppliers: money going out. Everyday costs (Bosta shipping and fees, packaging, Uber/inDrive, ads…)
// are expenses. Suppliers who print and produce for us send bills (what we owe them, also counted as an expense)
// and get paid in parts or in full; what's left is the balance owed.

declare(strict_types=1);

// Categories offered in the form (any other text is allowed too).
const EXPENSE_CATEGORIES = ['Bosta shipping', 'Bosta extra fees', 'Packaging', 'Transport (Uber / inDrive)', 'Supplier / production', 'Ads', 'Other'];
const SUPPLIER_CATEGORY = 'Supplier / production';

function expenses_migrate(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT DEFAULT '',
        makes TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spent_on TEXT NOT NULL,
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        note TEXT DEFAULT '',
        supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        order_id INTEGER,
        created_by INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_expenses_day ON expenses(spent_on)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_expenses_supplier ON expenses(supplier_id)');
    $pdo->exec("CREATE TABLE IF NOT EXISTS supplier_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        paid_on TEXT NOT NULL,
        note TEXT DEFAULT '',
        created_by INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )");
}

// A day the team typed (YYYY-MM-DD), or today in Cairo.
function expense_day($v): string
{
    $v = (string) $v;
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) && checkdate((int) substr($v, 5, 2), (int) substr($v, 8, 2), (int) substr($v, 0, 4))
        ? $v : (new DateTime('now', new DateTimeZone('Africa/Cairo')))->format('Y-m-d');
}

// "WTS-1015", "1015" or "" → the order's id (or null).
function expense_order_id($v): ?int
{
    $v = trim((string) $v);
    if ($v === '') return null;
    if (!preg_match('/(\d+)/', $v, $m)) fail('Order number not recognised — use the number like WTS-1015.');
    $n = (int) $m[1];
    $id = $n >= 1000 ? $n - 1000 : $n;
    $st = db()->prepare('SELECT id FROM orders WHERE id = ?');
    $st->execute([$id]);
    if (!$st->fetchColumn()) fail('There is no order ' . order_number($id) . '.');
    return $id;
}

// Every supplier with what we were billed, what we paid and what's still owed (all time), plus this month's bills.
function suppliers_list(?string $from = null, ?string $to = null): array
{
    $pdo = db();
    $rows = $pdo->query("SELECT s.*,
            (SELECT COALESCE(SUM(amount), 0) FROM expenses e WHERE e.supplier_id = s.id) AS billed,
            (SELECT COALESCE(SUM(amount), 0) FROM supplier_payments p WHERE p.supplier_id = s.id) AS paid,
            (SELECT MAX(d) FROM (SELECT MAX(spent_on) d FROM expenses WHERE supplier_id = s.id UNION ALL SELECT MAX(paid_on) FROM supplier_payments WHERE supplier_id = s.id)) AS last_on
        FROM suppliers s ORDER BY s.active DESC, s.name")->fetchAll();
    $month = [];
    if ($from && $to) {
        $st = $pdo->prepare('SELECT supplier_id, SUM(amount) v FROM expenses WHERE supplier_id IS NOT NULL AND spent_on >= ? AND spent_on <= ? GROUP BY supplier_id');
        $st->execute([$from, $to]);
        $month = $st->fetchAll(PDO::FETCH_KEY_PAIR);
    }
    return array_map(function ($s) use ($month) {
        $billed = round((float) $s['billed'], 2); $paid = round((float) $s['paid'], 2);
        return ['id' => (int) $s['id'], 'name' => $s['name'], 'phone' => $s['phone'], 'makes' => $s['makes'], 'notes' => $s['notes'], 'active' => (bool) $s['active'],
            'billed' => $billed, 'paid' => $paid, 'balance' => round($billed - $paid, 2), 'monthBilled' => round((float) ($month[$s['id']] ?? 0), 2), 'lastOn' => $s['last_on']];
    }, $rows);
}

// The month's report: every expense, totals by category, suppliers, and sales for the same month.
function expenses_report(string $month): array
{
    [$month, $fromUtc, $toUtc] = cairo_month_bounds($month);
    $first = $month . '-01';
    $last = (new DateTime($first))->modify('last day of this month')->format('Y-m-d');
    $pdo = db();
    $st = $pdo->prepare('SELECT e.*, s.name AS supplier_name, u.name AS by_name FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id
        LEFT JOIN users u ON u.id = e.created_by WHERE e.spent_on >= ? AND e.spent_on <= ? ORDER BY e.spent_on DESC, e.id DESC');
    $st->execute([$first, $last]);
    $list = []; $byCat = []; $total = 0.0;
    foreach ($st->fetchAll() as $e) {
        $amt = round((float) $e['amount'], 2);
        $total += $amt;
        $byCat[$e['category']] = ($byCat[$e['category']] ?? 0) + $amt;
        $list[] = ['id' => (int) $e['id'], 'on' => $e['spent_on'], 'category' => $e['category'], 'amount' => $amt, 'note' => $e['note'],
            'supplierId' => $e['supplier_id'] === null ? null : (int) $e['supplier_id'], 'supplier' => $e['supplier_name'],
            'orderId' => $e['order_id'] === null ? null : (int) $e['order_id'], 'order' => $e['order_id'] === null ? null : order_number((int) $e['order_id']), 'by' => $e['by_name']];
    }
    arsort($byCat);
    $cats = array_map(function ($k, $v) { return ['category' => $k, 'amount' => round($v, 2)]; }, array_keys($byCat), $byCat);
    // Payments to suppliers this month (cash out; the bill itself is the expense).
    $st = $pdo->prepare('SELECT COALESCE(SUM(amount), 0) FROM supplier_payments WHERE paid_on >= ? AND paid_on <= ?');
    $st->execute([$first, $last]);
    $paidSuppliers = round((float) $st->fetchColumn(), 2);
    // Sales in the same month (orders placed, without cancelled and returned), to show what's left after expenses.
    $st = $pdo->prepare("SELECT COALESCE(SUM(total), 0) FROM orders WHERE status NOT IN ('Cancelled','Returned','Awaiting payment') AND created_at >= ? AND created_at < ?");
    $st->execute([$fromUtc, $toUtc]);
    $sales = round((float) $st->fetchColumn(), 2);
    $suppliers = suppliers_list($first, $last);
    $used = $pdo->query('SELECT DISTINCT category FROM expenses ORDER BY category')->fetchAll(PDO::FETCH_COLUMN);
    return ['month' => $month, 'expenses' => $list, 'total' => round($total, 2), 'byCategory' => $cats, 'sales' => $sales, 'net' => round($sales - $total, 2),
        'paidSuppliers' => $paidSuppliers, 'owed' => round(array_sum(array_map(function ($s) { return max(0, $s['balance']); }, $suppliers)), 2),
        'suppliers' => $suppliers, 'categories' => array_values(array_unique(array_merge(EXPENSE_CATEGORIES, $used))), 'supplierCategory' => SUPPLIER_CATEGORY];
}

// One supplier's bills and payments, newest first, with the running balance.
function supplier_statement(int $id): array
{
    $pdo = db();
    $st = $pdo->prepare('SELECT * FROM suppliers WHERE id = ?');
    $st->execute([$id]);
    if (!$st->fetch()) fail('Supplier not found.', 404);
    $rows = [];
    $st = $pdo->prepare('SELECT id, spent_on AS on_day, amount, note, order_id, created_at FROM expenses WHERE supplier_id = ?');
    $st->execute([$id]);
    foreach ($st as $r) $rows[] = ['type' => 'bill', 'id' => (int) $r['id'], 'on' => $r['on_day'], 'amount' => round((float) $r['amount'], 2), 'note' => $r['note'],
        'order' => $r['order_id'] === null ? null : order_number((int) $r['order_id']), 'at' => $r['created_at']];
    $st = $pdo->prepare('SELECT p.id, p.paid_on AS on_day, p.amount, p.note, p.created_at, u.name AS by_name FROM supplier_payments p LEFT JOIN users u ON u.id = p.created_by WHERE p.supplier_id = ?');
    $st->execute([$id]);
    foreach ($st as $r) $rows[] = ['type' => 'payment', 'id' => (int) $r['id'], 'on' => $r['on_day'], 'amount' => round((float) $r['amount'], 2), 'note' => $r['note'], 'by' => $r['by_name'], 'at' => $r['created_at']];
    // Oldest first to build the running balance, then newest first for the list.
    usort($rows, function ($a, $b) { return [$a['on'], $a['at']] <=> [$b['on'], $b['at']]; });
    $bal = 0.0;
    foreach ($rows as &$r) { $bal += $r['type'] === 'bill' ? $r['amount'] : -$r['amount']; $r['balance'] = round($bal, 2); }
    unset($r);
    $sup = array_values(array_filter(suppliers_list(), function ($s) use ($id) { return $s['id'] === $id; }))[0];
    return ['supplier' => $sup, 'rows' => array_reverse($rows)];
}

// Expenses for the dashboard: total since a day, and what's owed to suppliers now.
function expenses_since(string $sinceDay, string $untilDay = '9999-12-31'): array
{
    $st = db()->prepare('SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE spent_on >= ? AND spent_on <= ?');
    $st->execute([$sinceDay, $untilDay]);
    $owed = 0.0;
    foreach (suppliers_list() as $s) $owed += max(0, $s['balance']);
    return ['total' => round((float) $st->fetchColumn(), 2), 'owed' => round($owed, 2)];
}
