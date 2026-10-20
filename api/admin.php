<?php
// Team dashboard API. Every action except session/login/setup needs a signed-in user
// with the matching permission (see ROLES in bootstrap.php) and, for writes, the CSRF token.

require __DIR__ . '/bootstrap.php';

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
if ($action !== 'backup_download') schedule_daily_backup();
if (!in_array($action, ['backup_download', 'bosta_awb', 'bosta_sync'], true)) schedule_bosta_sync();
if (in_array($action, ['dashboard', 'orders'], true)) expire_unpaid_orders();
// Catalog changes: refresh /sitemap.xml and /llms.txt for search engines and AI tools after the reply.
if (in_array($action, ['product_save', 'product_delete', 'image_upload', 'image_delete', 'image_order', 'category_save', 'category_delete', 'brand_save', 'brand_delete', 'brand_logo'], true)) {
    register_shutdown_function('seo_publish');
}

try {
    // Telesales see orders only: quotes, customers and the search across leads/products are closed to them.
    if (preg_match('/^(quote|customer|search)/', $action) && !in_array($action, ['session', 'customer_lookup'], true)) {
        $cu = current_user();
        if ($cu && in_array('orders_only', $cu['perms'], true)) fail('This isn’t available for your role.', 403);
    }
    switch ($action) {

    // ---------- session ----------

    case 'session':
        start_session();
        $needsSetup = (int) db()->query('SELECT COUNT(*) FROM users')->fetchColumn() === 0;
        if ($needsSetup) setup_key();
        $u = current_user();
        if ($u && empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
        $keyPath = basename(dirname(cfg('data_dir'))) . '/' . basename(cfg('data_dir')) . '/SETUP_KEY.txt';
        json_out(['user' => $u, 'csrf' => $u ? $_SESSION['csrf'] : null, 'needsSetup' => $needsSetup, 'setupKeyPath' => $needsSetup ? $keyPath : null,
            'roles' => array_keys(ROLES), 'orderStatuses' => ORDER_STATUSES, 'leadStatuses' => LEAD_STATUSES]);

    case 'setup':
        if ($method !== 'POST') fail('Not found', 404);
        start_session();
        if ((int) db()->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0) fail('Setup is already done.', 409);
        if (too_many_attempts('setup', 10, 900)) fail('Too many attempts. Wait 15 minutes.', 429);
        $b = body();
        if (!hash_equals(setup_key(), str_in($b['key'] ?? '', 64))) { record_attempt('setup'); fail('Setup key is wrong.', 403); }
        $id = save_user(['name' => $b['name'] ?? '', 'email' => $b['email'] ?? '', 'password' => $b['password'] ?? '', 'role' => 'owner', 'active' => 1, 'notify' => 1], null);
        @unlink(cfg('data_dir') . '/SETUP_KEY.txt');
        session_regenerate_id(true);
        $_SESSION['uid'] = $id;
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
        log_activity(current_user(), 'Created owner account');
        json_out(['ok' => true]);

    case 'login':
        if ($method !== 'POST') fail('Not found', 404);
        start_session();
        if (too_many_attempts('login', 8, 900)) fail('Too many sign-in attempts. Wait 15 minutes.', 429);
        $b = body();
        $st = db()->prepare('SELECT * FROM users WHERE email = ? AND active = 1');
        $st->execute([str_in($b['email'] ?? '', 160)]);
        $u = $st->fetch();
        if (!$u || !password_verify((string) ($b['password'] ?? ''), $u['password_hash'])) {
            record_attempt('login');
            fail('Wrong email or password.', 401);
        }
        session_regenerate_id(true);
        $_SESSION['uid'] = (int) $u['id'];
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
        db()->prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?")->execute([$u['id']]);
        log_activity($u, 'Signed in');
        json_out(['ok' => true]);

    case 'logout':
        start_session();
        $_SESSION = [];
        session_destroy();
        json_out(['ok' => true]);

    case 'password':
        $u = current_user();
        if (!$u) fail('Not signed in', 401);
        require_perm('dashboard');
        $b = body();
        $st = db()->prepare('SELECT password_hash FROM users WHERE id = ?');
        $st->execute([$u['id']]);
        if (!password_verify((string) ($b['current'] ?? ''), (string) $st->fetchColumn())) fail('Current password is wrong.');
        $new = (string) ($b['new'] ?? '');
        if (strlen($new) < 8) fail('New password must be at least 8 characters.');
        db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($new, PASSWORD_DEFAULT), $u['id']]);
        log_activity($u, 'Changed password');
        json_out(['ok' => true]);

    // ---------- dashboard ----------

    case 'dashboard':
        $u = require_perm('dashboard');
        $revenue = in_array('revenue', $u['perms'], true);
        $ordersOnly = in_array('orders_only', $u['perms'], true);
        $days = max(7, min(365, (int) ($_GET['days'] ?? 30)));
        $pdo = db();
        $own = in_array('own_orders', $u['perms'], true);
        // Money figures: the whole shop for owner and managers; sales people see the money of their own orders.
        $money = $revenue || $own;
        $scope = $own ? ' AND rep_id = ' . (int) $u['id'] : '';
        $since = gmdate('Y-m-d', time() - ($days - 1) * 86400);
        $valid = "status NOT IN ('Cancelled','Returned','Awaiting payment')";
        $st = $pdo->prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) revenue FROM orders WHERE $valid AND date(created_at) >= ?$scope");
        $st->execute([$since]);
        $k = $st->fetch();
        $st = $pdo->prepare("SELECT date(created_at) d, COUNT(*) n, SUM(total) revenue FROM orders WHERE $valid AND date(created_at) >= ?$scope GROUP BY d");
        $st->execute([$since]);
        $byDay = [];
        foreach ($st as $r) $byDay[$r['d']] = $r;
        $series = [];
        for ($i = $days - 1; $i >= 0; $i--) {
            $d = gmdate('Y-m-d', time() - $i * 86400);
            $series[] = ['date' => $d, 'orders' => (int) ($byDay[$d]['n'] ?? 0), 'revenue' => (float) ($byDay[$d]['revenue'] ?? 0)];
        }
        $status = $pdo->query('SELECT status, COUNT(*) n FROM orders WHERE 1' . $scope . ' GROUP BY status')->fetchAll(PDO::FETCH_KEY_PAIR);
        $top = [];
        $st = $pdo->prepare("SELECT items FROM orders WHERE $valid AND date(created_at) >= ?$scope");
        $st->execute([$since]);
        foreach ($st as $o) {
            foreach (json_decode($o['items'], true) ?: [] as $it) {
                $key = $it['id'];
                if (!isset($top[$key])) $top[$key] = ['name' => $it['name'], 'qty' => 0, 'revenue' => 0];
                $top[$key]['qty'] += $it['qty'];
                $top[$key]['revenue'] += $it['total'] ?? $it['qty'] * $it['price'];
            }
        }
        usort($top, function ($a, $b) { return $b['revenue'] <=> $a['revenue']; });
        $st = $pdo->prepare("SELECT COALESCE(source, 'Website') AS source, COUNT(*) n, COALESCE(SUM(total),0) revenue FROM orders WHERE $valid AND date(created_at) >= ?$scope GROUP BY 1 ORDER BY revenue DESC");
        $st->execute([$since]);
        $sources = $st->fetchAll();
        $lowStock = [];
        if (!$own && !$ordersOnly) {
            foreach ($pdo->query("SELECT id, name, stock, variants FROM products WHERE status = 'Active' AND cat != 'services'")->fetchAll() as $p) {
                $vs = product_json($p, 'variants');
                if ($vs) { foreach ($vs as $v) if ((int) $v['stock'] <= 5) $lowStock[] = ['id' => $p['id'], 'name' => $p['name'] . ' — ' . $v['label'], 'stock' => (int) $v['stock']]; }
                elseif ((int) $p['stock'] <= 5) $lowStock[] = ['id' => $p['id'], 'name' => $p['name'], 'stock' => (int) $p['stock']];
            }
            usort($lowStock, function ($a, $b) { return $a['stock'] <=> $b['stock']; });
        }
        $recent = array_map('order_out', $pdo->query('SELECT o.*, u.name AS rep_name FROM orders o LEFT JOIN users u ON u.id = o.rep_id WHERE o.status != \'Awaiting payment\'' . str_replace('rep_id', 'o.rep_id', $scope) . ' ORDER BY o.id DESC LIMIT 6')->fetchAll());
        $month = (new DateTime('now', new DateTimeZone('Africa/Cairo')))->format('Y-m');
        // Leads due a follow-up today or earlier (sales people: theirs and unassigned ones).
        $followUps = [];
        if (in_array('leads', $u['perms'], true)) {
            $today = (new DateTime('now', new DateTimeZone('Africa/Cairo')))->format('Y-m-d');
            $st = $pdo->prepare("SELECT l.id, l.name, l.contact, l.cat, l.notes, l.status, l.follow_up, u.name AS assigned_name FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
                WHERE l.follow_up IS NOT NULL AND l.follow_up <= ? AND l.status NOT IN ('Won','Lost')" . ($own ? ' AND (l.assigned_to = ' . (int) $u['id'] . ' OR l.assigned_to IS NULL)' : '') . '
                ORDER BY l.follow_up, l.id LIMIT 12');
            $st->execute([$today]);
            $followUps = $st->fetchAll();
        }
        $lastBackup = in_array('backups', $u['perms'], true) ? (backup_list()[0] ?? null) : null;
        // Quotes waiting for the customer's answer (not expired).
        $openQuotes = null;
        if (in_array('sell', $u['perms'], true) && !$ordersOnly) {
            $st = $pdo->prepare("SELECT COUNT(*) n, COALESCE(SUM(total), 0) v FROM quotes WHERE status IN ('Draft','Sent') AND (valid_until IS NULL OR valid_until >= ?)" . str_replace('rep_id', 'quotes.rep_id', $scope));
            $st->execute([(new DateTime('now', new DateTimeZone('Africa/Cairo')))->format('Y-m-d')]);
            $oq = $st->fetch();
            $openQuotes = ['n' => (int) $oq['n'], 'value' => round((float) $oq['v'])];
        }
        // Money still owed on open orders (deposits paid, balance not yet collected).
        $st = $pdo->query("SELECT COALESCE(SUM(MAX(o.total - (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.order_id = o.id), 0)), 0) due,
            SUM(CASE WHEN o.total - (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.order_id = o.id) > 0.5 THEN 1 ELSE 0 END) n
            FROM orders o WHERE o.status NOT IN ('Cancelled','Returned','Awaiting payment')" . str_replace('rep_id', 'o.rep_id', $scope));
        $collect = $st->fetch();
        // Estimated gross profit for the period, from unit costs (saved on each order line, or the product's current cost).
        $profit = null;
        if ($revenue) {
            $costs = [];
            foreach ($pdo->query('SELECT id, cost FROM products')->fetchAll() as $p) $costs[$p['id']] = (float) $p['cost'];
            $st = $pdo->prepare("SELECT items, discount FROM orders WHERE $valid AND date(created_at) >= ?");
            $st->execute([$since]);
            $rev = 0.0; $cost = 0.0; $covered = 0.0;
            foreach ($st->fetchAll() as $o) {
                foreach (json_decode($o['items'], true) ?: [] as $it) {
                    $lineTotal = (float) ($it['total'] ?? ($it['qty'] * $it['price']));
                    $unitCost = isset($it['cost']) ? (float) $it['cost'] : ($costs[$it['id'] ?? ''] ?? 0);
                    if ($unitCost > 0) { $rev += $lineTotal; $cost += $unitCost * (int) $it['qty']; }
                    $covered += $lineTotal;
                }
            }
            if ($cost > 0) $profit = ['revenue' => round($rev), 'cost' => round($cost), 'profit' => round($rev - $cost), 'margin' => $rev > 0 ? round(($rev - $cost) / $rev * 100) : 0,
                'coverage' => $covered > 0 ? round($rev / $covered * 100) : 0];
        }
        // Where leads come from, and how many became customers.
        $leadSources = [];
        if (in_array('leads', $u['perms'], true)) {
            $st = $pdo->prepare("SELECT CASE WHEN source LIKE 'Order %' THEN 'Orders (customers)' WHEN source LIKE 'Shop%' THEN 'Quote form' WHEN source = '' THEN 'Other' ELSE source END AS src,
                COUNT(*) n, SUM(status = 'Won') won FROM leads WHERE date(created_at) >= ? GROUP BY src ORDER BY n DESC");
            $st->execute([$since]);
            $leadSources = array_map(function ($r) { return ['source' => $r['src'], 'n' => (int) $r['n'], 'won' => (int) $r['won']]; }, $st->fetchAll());
        }
        // Only the owner and managers see money totals; everyone else gets the counts.
        $perf = team_performance($month, $own ? (int) $u['id'] : null);
        // A sales person's own commission this month (once the owner has set their rate).
        $myCommission = null;
        if ($own) {
            foreach (team_commissions($month)['members'] as $m) {
                if ($m['id'] !== (int) $u['id'] || !$m['pct']) continue;
                $myCommission = ['pct' => $m['pct'], 'commission' => $m['commission'], 'base' => $m['base'], 'delivered' => $m['delivered'],
                    'pending' => round($m['openValue'] * $m['pct'] / 100, 2), 'open' => $m['open']];
            }
        }
        if (!$money) {
            $k['revenue'] = null;
            foreach ($series as &$x) unset($x['revenue']);
            unset($x);
            foreach ($top as &$x) unset($x['revenue']);
            unset($x);
            usort($top, function ($a, $b) { return $b['qty'] <=> $a['qty']; });
            $sources = array_map(function ($r) { unset($r['revenue']); return $r; }, $sources);
            if ($openQuotes) unset($openQuotes['value']);
            $perf['members'] = array_map(function ($m) { unset($m['revenue'], $m['revenue_target']); return $m; }, $perf['members']);
        }
        json_out([
            'days' => $days, 'own' => $own, 'money' => $money, 'followUps' => $followUps, 'lastBackup' => $lastBackup,
            'toCollect' => $money ? ['amount' => round((float) $collect['due']), 'orders' => (int) $collect['n']] : null, 'profit' => $profit, 'leadSources' => $leadSources,
            'openQuotes' => $openQuotes, 'myCommission' => $myCommission,
            'kpi' => [
                'revenue' => $money ? (float) $k['revenue'] : null, 'orders' => (int) $k['n'],
                'aov' => $money && $k['n'] ? round($k['revenue'] / $k['n']) : null,
                'shipped' => (int) ($status['Shipped'] ?? 0), 'delivered' => (int) ($status['Delivered'] ?? 0),
                'lost' => (int) ($status['Cancelled'] ?? 0) + (int) ($status['Returned'] ?? 0),
                'pending' => (int) ($status['Pending'] ?? 0),
                'newLeads' => (int) $pdo->query("SELECT COUNT(*) FROM leads WHERE status = 'New'")->fetchColumn(),
                'products' => (int) $pdo->query("SELECT COUNT(*) FROM products WHERE status = 'Active'")->fetchColumn(),
            ],
            'series' => $series, 'statusCounts' => $status, 'topProducts' => array_slice($top, 0, 5), 'sources' => $sources,
            'lowStock' => $lowStock, 'recentOrders' => $recent,
            'performance' => $perf,
        ]);

    // ---------- targets ----------

    case 'targets':
        require_perm('targets');
        $perf = team_performance((string) ($_GET['month'] ?? ''));
        json_out($perf);

    case 'targets_save':
        $u = require_perm('targets');
        $b = body();
        [$month] = cairo_month_bounds((string) ($b['month'] ?? ''));
        $st = db()->prepare('INSERT INTO targets (user_id, month, orders_target, revenue_target) VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, month) DO UPDATE SET orders_target = excluded.orders_target, revenue_target = excluded.revenue_target');
        foreach ((array) ($b['targets'] ?? []) as $t) {
            $st->execute([(int) ($t['user_id'] ?? 0), $month, max(0, (int) ($t['orders'] ?? 0)), max(0, (float) ($t['revenue'] ?? 0))]);
        }
        log_activity($u, 'Updated targets', $month);
        json_out(['ok' => true]);

    case 'commissions':
        require_perm('targets');
        require_perm('revenue');
        json_out(team_commissions((string) ($_GET['month'] ?? '')));

    case 'commission_rate':
        $u = require_perm('targets');
        require_perm('revenue');
        $b = body();
        [$month] = cairo_month_bounds((string) ($b['month'] ?? ''));
        $uid = (int) ($b['user_id'] ?? 0);
        $name = db()->prepare('SELECT name FROM users WHERE id = ?');
        $name->execute([$uid]);
        $name = $name->fetchColumn();
        if ($name === false) fail('Team member not found.', 404);
        // Commission rate and/or monthly salary, from this month on.
        if (array_key_exists('pct', $b)) {
            $pct = max(0, min(100, round((float) $b['pct'], 2)));
            db()->prepare('INSERT INTO targets (user_id, month, commission_pct) VALUES (?, ?, ?) ON CONFLICT(user_id, month) DO UPDATE SET commission_pct = excluded.commission_pct')->execute([$uid, $month, $pct]);
            log_activity($u, 'Set commission rate', $name . ' · ' . $pct . '% from ' . $month);
        }
        if (array_key_exists('salary', $b)) {
            $salary = max(0, min(10000000, round((float) $b['salary'], 2)));
            db()->prepare('INSERT INTO targets (user_id, month, salary) VALUES (?, ?, ?) ON CONFLICT(user_id, month) DO UPDATE SET salary = excluded.salary')->execute([$uid, $month, $salary]);
            log_activity($u, 'Set salary', $name . ' · EGP ' . $salary . ' from ' . $month);
        }
        json_out(team_commissions($month));

    // ---------- team-entered orders ----------

    case 'order_catalog':
        require_perm('sell');
        $rows = array_map(function ($p) {
            return ['id' => $p['id'], 'name' => $p['name'], 'nameAr' => $p['nameAr'], 'brandId' => $p['brandId'], 'cat' => $p['cat'], 'price' => $p['discountPct'] ? round($p['price'] * (1 - $p['discountPct'] / 100), 2) : $p['price'],
                'discountPct' => $p['discountPct'], 'stock' => $p['stock'], 'image' => $p['images'][0] ?? '', 'sub' => $p['sub'],
                'variants' => array_map(function ($v) { unset($v['sku'], $v['brandPrice']); return $v; }, $p['variants']), 'tiers' => $p['tiers'], 'addons' => $p['addons'],
                'personalized' => $p['personalized'], 'fromPrice' => $p['fromPrice']];
        }, load_products(true));
        $reps = db()->query("SELECT id, name, role FROM users WHERE active = 1 ORDER BY name")->fetchAll();
        $brandNames = [];
        foreach (load_brands(false) as $br) $brandNames[$br['id']] = $br['name'];
        json_out(['products' => $rows, 'sources' => ORDER_SOURCES, 'payments' => array_filter(PAYMENT_METHODS, function ($k) { return strpos($k, 'paymob') !== 0; }, ARRAY_FILTER_USE_KEY), 'reps' => $reps, 'brands' => (object) $brandNames,
            'shippingFee' => cfg('shipping_fee'), 'freeShippingThreshold' => cfg('free_shipping_threshold')]);

    // New order: find an existing customer by name or phone and return their details to fill in.
    // People limited to their own orders search their own customers, plus anyone by full phone number.
    case 'customer_lookup':
        $u = require_perm('sell');
        $q = trim(str_in($_GET['q'] ?? '', 80));
        $digits = preg_replace('/\D/', '', strtr($q, ['٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9']));
        if (mb_strlen($q) < 2 || ($digits !== '' && strlen($digits) < 3 && !preg_match('/\p{L}/u', $q))) json_out(['results' => []]);
        $own = in_array('own_orders', $u['perms'], true);
        $byPhone = strlen($digits) >= 3;
        $fullPhone = strlen($digits) >= 10;
        $like = '%' . ($byPhone ? substr($digits, -min(8, strlen($digits))) : $q) . '%';
        $sql = "SELECT customer, phone, email, address, city, district, city_id, district_id, created_at FROM orders WHERE status != 'Awaiting payment' AND "
            . ($byPhone ? "REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') LIKE ?" : 'customer LIKE ?')
            . ($own && !$fullPhone ? ' AND rep_id = ' . (int) $u['id'] : '') . ' ORDER BY id DESC LIMIT 60';
        $st = db()->prepare($sql);
        $st->execute([$like]);
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $k = phone_key((string) $r['phone']) ?: mb_strtolower($r['customer']);
            if (!isset($out[$k])) $out[$k] = ['name' => $r['customer'], 'phone' => $r['phone'], 'email' => $r['email'], 'address' => $r['address'], 'city' => $r['city'],
                'district' => $r['district'], 'cityId' => $r['city_id'], 'districtId' => $r['district_id'], 'last' => $r['created_at'], 'orders' => 0, 'from' => 'order'];
            $out[$k]['orders']++;
        }
        // Website accounts (saved details) and leads (name + contact only).
        $st = db()->prepare('SELECT name, phone, email, address, city, district, city_id, district_id, created_at FROM customers WHERE '
            . ($byPhone ? "REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') LIKE ?" : '(name LIKE ? OR email LIKE ?)') . ' LIMIT 10');
        $st->execute($byPhone ? [$like] : [$like, $like]);
        foreach ($st->fetchAll() as $r) {
            $k = phone_key((string) $r['phone']) ?: mb_strtolower((string) $r['email']);
            if (isset($out[$k])) { $out[$k]['account'] = true; if (!$out[$k]['email']) $out[$k]['email'] = $r['email']; continue; }
            if ($own && !$fullPhone) continue;
            $out[$k] = ['name' => $r['name'] ?: $r['email'], 'phone' => $r['phone'], 'email' => $r['email'], 'address' => $r['address'], 'city' => $r['city'], 'district' => $r['district'],
                'cityId' => $r['city_id'], 'districtId' => $r['district_id'], 'last' => $r['created_at'], 'orders' => 0, 'from' => 'account', 'account' => true];
        }
        // Quotes: people priced up before they ordered (telesales don't see quotes).
        if (!in_array('orders_only', $u['perms'], true)) {
            $st = db()->prepare('SELECT customer, phone, email, address, city, district, city_id, district_id, created_at FROM quotes WHERE '
                . ($byPhone ? "REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') LIKE ?" : 'customer LIKE ?')
                . ($own && !$fullPhone ? ' AND (rep_id = ' . (int) $u['id'] . ' OR created_by = ' . (int) $u['id'] . ')' : '') . ' ORDER BY id DESC LIMIT 20');
            $st->execute([$like]);
            foreach ($st->fetchAll() as $r) {
                $k = phone_key((string) $r['phone']) ?: mb_strtolower($r['customer']);
                if (isset($out[$k])) continue;
                $out[$k] = ['name' => $r['customer'], 'phone' => $r['phone'], 'email' => $r['email'], 'address' => $r['address'], 'city' => $r['city'], 'district' => $r['district'],
                    'cityId' => $r['city_id'], 'districtId' => $r['district_id'], 'last' => $r['created_at'], 'orders' => 0, 'from' => 'quote'];
            }
        }
        if (in_array('leads', $u['perms'], true) && count($out) < 6) {
            $st = db()->prepare('SELECT name, contact, created_at FROM leads WHERE ' . ($byPhone ? "REPLACE(REPLACE(contact, ' ', ''), '-', '') LIKE ?" : 'name LIKE ?')
                . ($own && !$fullPhone ? ' AND (assigned_to = ' . (int) $u['id'] . ' OR assigned_to IS NULL)' : '') . ' ORDER BY id DESC LIMIT 10');
            $st->execute([$like]);
            foreach ($st->fetchAll() as $r) {
                $ph = phone_key((string) $r['contact']);
                $k = $ph ?: mb_strtolower($r['name']);
                if (isset($out[$k])) continue;
                preg_match('/(\+?\d[\d\s-]{8,16}\d)/', (string) $r['contact'], $m);
                $out[$k] = ['name' => $r['name'], 'phone' => $m[1] ?? '', 'email' => email_key((string) $r['contact']) ?: '', 'address' => '', 'city' => '', 'district' => '',
                    'cityId' => null, 'districtId' => null, 'last' => $r['created_at'], 'orders' => 0, 'from' => 'lead'];
            }
        }
        json_out(['results' => array_slice(array_values($out), 0, 6)]);

    case 'order_create':
        $u = require_perm('sell');
        $b = body();
        // Sales people are always credited themselves; owners/managers can credit someone else.
        $repId = (int) $u['id'];
        if (in_array('targets', $u['perms'], true) && isset($b['rep_id'])) $repId = (int) $b['rep_id'] ?: null;
        $r = create_order($b, [
            'by_team' => true, 'rep_id' => $repId, 'created_by' => (int) $u['id'],
            'source' => $b['source'] ?? 'Phone', 'payment' => $b['payment'] ?? 'cod', 'status' => $b['status'] ?? 'Pending',
            'discount' => $b['discount'] ?? 0, 'shipping' => $b['shipping'] ?? null, 'notes' => $b['notes'] ?? '',
            'paid_now' => $b['paid_now'] ?? '', 'deposit_method' => $b['deposit_method'] ?? 'cash',
        ]);
        log_activity($u, 'Created order', $r['number'] . ' · ' . str_in($b['name'] ?? '', 120) . ' · EGP ' . number_format($r['total']) . ' · ' . ($b['source'] ?? 'Phone'));
        if (!empty($b['quote_id'])) {
            // Order made from a quote: mark the quote accepted and remember which order it became.
            db()->prepare("UPDATE quotes SET status = 'Accepted', order_id = ?, updated_at = datetime('now') WHERE id = ? AND order_id IS NULL")->execute([$r['id'], (int) $b['quote_id']]);
            if (empty($b['lead_id'])) {
                $st = db()->prepare('SELECT lead_id FROM quotes WHERE id = ?');
                $st->execute([(int) $b['quote_id']]);
                if ($lid = $st->fetchColumn()) $b['lead_id'] = (int) $lid;
            }
        }
        $prep = str_in($b['prep_notes'] ?? '', 500);
        if ($prep !== '') db()->prepare('UPDATE orders SET prep_notes = ? WHERE id = ?')->execute([$prep, $r['id']]);
        try {
            $r['lead'] = lead_from_order($b, $r, $repId, in_array($b['source'] ?? '', ORDER_SOURCES, true) ? $b['source'] : 'Phone');
        } catch (Throwable $e) {
            error_log('[shop] lead from order failed: ' . $e->getMessage()); // never block the order itself
        }
        json_out($r);

        // ---------- products & categories ----------

    case 'products':
        require_perm('products');
        $cats = db()->query('SELECT key, label, descr, label_ar, descr_ar, sort, (SELECT COUNT(*) FROM products p WHERE p.cat = c.key) AS count FROM categories c ORDER BY sort, label')->fetchAll();
        // The search title + description each product gets automatically (shown in the form as the default).
        $en = seo_lookups(false); $arL = seo_lookups(true);
        $products = array_map(function ($p) use ($en, $arL) {
            $bare = ['seoTitle' => '', 'seoTitleAr' => '', 'seoDesc' => '', 'seoDescAr' => ''] + $p;
            $e = seo_item($bare, false, ...$en); $a = seo_item($bare, true, ...$arL);
            $p['seoAuto'] = ['en' => [$e['seoTitle'], $e['seoDesc']], 'ar' => [$a['seoTitle'], $a['seoDesc']], 'url' => $e['url']];
            return $p;
        }, load_products(false));
        json_out(['products' => $products, 'categories' => $cats, 'brands' => load_brands(false, true)]);

    case 'product_save':
        $u = require_perm('products');
        $b = body();
        $pdo = db();
        $id = str_in($b['id'] ?? '', 40);
        $isNew = $id === '';
        if ($isNew) $id = 'p' . base_convert((string) time(), 10, 36) . bin2hex(random_bytes(2));
        $name = str_in($b['name'] ?? '', 160);
        $cat = str_in($b['cat'] ?? '', 40);
        if ($name === '') fail('Product name is required.');
        $st = $pdo->prepare('SELECT 1 FROM categories WHERE key = ?');
        $st->execute([$cat]);
        if (!$st->fetchColumn()) fail('Pick a category.');
        $variants = clean_variants($b['variants'] ?? []);
        $tiers = $variants ? [] : clean_tiers($b['tiers'] ?? []);
        $addons = clean_addons($b['addons'] ?? []);
        $price = (float) ($b['price'] ?? 0);
        // Partner brand with a brand price: shop price = brand price + margin; sizes follow their price rule.
        $brandId = !empty($b['brandId']) && ($brandRow = brand_get((int) $b['brandId'])) ? (int) $b['brandId'] : null;
        $brandPrice = $brandId ? max(0, round((float) ($b['brandPrice'] ?? 0), 2)) : 0;
        $marginPct = $brandId && isset($b['marginPct']) && $b['marginPct'] !== '' && $b['marginPct'] !== null ? max(0, min(500, (float) $b['marginPct'])) : null;
        if ($brandPrice > 0) $price = brand_sell_price($brandPrice, $marginPct ?? (float) $brandRow['margin']);
        // With sizes or quantity prices, the base price can be left empty: it becomes the lowest price.
        if ($price <= 0) {
            $candidates = [];
            foreach ($variants as $v) { foreach ($v['tiers'] as $t) $candidates[] = $t['price']; if ($v['price'] > 0) $candidates[] = $v['price']; }
            foreach ($tiers as $t) $candidates[] = $t['price'];
            $price = $candidates ? min($candidates) : 0;
        }
        if ($price <= 0) fail('Enter a price, or add sizes / quantity prices.');
        $variants = apply_size_prices($price, $variants, $brandPrice); // sizes priced as a share of the main price
        foreach ($variants as &$v) {
            if (!$v['tiers'] && $v['price'] <= 0) $v['price'] = $price;
        }
        unset($v);
        $stock = $variants ? array_sum(array_map(function ($v) { return $v['stock']; }, $variants)) : max(0, (int) ($b['stock'] ?? 0));
        $features = array_values(array_filter(array_map(function ($f) { return str_in($f, 160); }, (array) ($b['features'] ?? []))));
        $vals = [
            ':id' => $id, ':sku' => str_in($b['sku'] ?? '', 40), ':name' => $name, ':cat' => $cat,
            ':vendor' => str_in($b['vendor'] ?? '', 80), ':price' => $price, ':cost' => max(0, (float) ($b['cost'] ?? 0)),
            ':stock' => $stock, ':discount_pct' => max(0, min(90, (float) ($b['discountPct'] ?? 0))),
            ':label' => str_in($b['label'] ?? '', 30), ':status' => in_array($b['status'] ?? '', ['Active', 'Draft', 'Archived'], true) ? $b['status'] : 'Draft',
            ':sub' => str_in($b['sub'] ?? '', 160), ':descr' => str_in($b['desc'] ?? '', 4000),
            ':name_ar' => str_in($b['nameAr'] ?? '', 160), ':sub_ar' => str_in($b['subAr'] ?? '', 160), ':desc_ar' => str_in($b['descAr'] ?? '', 4000),
            ':features' => json_encode($features, JSON_UNESCAPED_UNICODE), ':period' => $cat === 'services' ? 'month' : '',
            ':variants' => json_encode($variants, JSON_UNESCAPED_UNICODE), ':tiers' => json_encode($tiers), ':addons' => json_encode($addons, JSON_UNESCAPED_UNICODE),
            ':personalized' => empty($b['personalized']) ? 0 : 1,
            ':brand_id' => $brandId, ':brand_price' => $brandPrice, ':margin_pct' => $marginPct,
            ':seo_title' => str_in($b['seoTitle'] ?? '', 120), ':seo_title_ar' => str_in($b['seoTitleAr'] ?? '', 120),
            ':seo_desc' => str_in($b['seoDesc'] ?? '', 320), ':seo_desc_ar' => str_in($b['seoDescAr'] ?? '', 320),
        ];
        if ($isNew) {
            $vals[':sort'] = (int) $pdo->query('SELECT COALESCE(MAX(sort),0)+1 FROM products')->fetchColumn();
            $pdo->prepare('INSERT INTO products (id, sku, name, cat, vendor, price, cost, stock, discount_pct, label, status, sub, descr, features, period, sort, variants, tiers, addons, personalized, name_ar, sub_ar, desc_ar, brand_id, brand_price, margin_pct, seo_title, seo_title_ar, seo_desc, seo_desc_ar)
                VALUES (:id, :sku, :name, :cat, :vendor, :price, :cost, :stock, :discount_pct, :label, :status, :sub, :descr, :features, :period, :sort, :variants, :tiers, :addons, :personalized, :name_ar, :sub_ar, :desc_ar, :brand_id, :brand_price, :margin_pct, :seo_title, :seo_title_ar, :seo_desc, :seo_desc_ar)')->execute($vals);
        } else {
            $st = $pdo->prepare("UPDATE products SET sku=:sku, name=:name, cat=:cat, vendor=:vendor, price=:price, cost=:cost, stock=:stock, discount_pct=:discount_pct,
                label=:label, status=:status, sub=:sub, descr=:descr, features=:features, period=:period, variants=:variants, tiers=:tiers, addons=:addons,
                personalized=:personalized, name_ar=:name_ar, sub_ar=:sub_ar, desc_ar=:desc_ar, brand_id=:brand_id, brand_price=:brand_price, margin_pct=:margin_pct,
                seo_title=:seo_title, seo_title_ar=:seo_title_ar, seo_desc=:seo_desc, seo_desc_ar=:seo_desc_ar, updated_at=datetime('now') WHERE id=:id");
            $st->execute($vals);
            if (!$st->rowCount()) fail('Product not found.', 404);
        }
        log_activity($u, $isNew ? 'Added product' : 'Updated product', $name);
        json_out(['id' => $id]);

    case 'product_delete':
        $u = require_perm('products');
        $id = str_in(body()['id'] ?? '', 40);
        $pdo = db();
        $st = $pdo->prepare('SELECT name FROM products WHERE id = ?');
        $st->execute([$id]);
        $name = $st->fetchColumn();
        if (!$name) fail('Product not found.', 404);
        $imgs = $pdo->prepare('SELECT path FROM product_images WHERE product_id = ?');
        $imgs->execute([$id]);
        foreach ($imgs->fetchAll(PDO::FETCH_COLUMN) as $p) delete_upload($p);
        $pdo->prepare('DELETE FROM products WHERE id = ?')->execute([$id]);
        log_activity($u, 'Deleted product', (string) $name);
        json_out(['ok' => true]);

    case 'image_upload':
        $u = require_perm('products');
        $pid = str_in($_POST['product_id'] ?? '', 40);
        $st = db()->prepare('SELECT name FROM products WHERE id = ?');
        $st->execute([$pid]);
        $pname = $st->fetchColumn();
        if (!$pname) fail('Save the product first, then add photos.', 404);
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) fail('Upload failed. Photos must be under ' . (cfg('max_upload_bytes') >> 20) . ' MB.');
        $path = store_image($f, $pid);
        $sort = db()->prepare('SELECT COALESCE(MAX(sort),-1)+1 FROM product_images WHERE product_id = ?');
        $sort->execute([$pid]);
        db()->prepare('INSERT INTO product_images (product_id, path, sort) VALUES (?, ?, ?)')->execute([$pid, $path, (int) $sort->fetchColumn()]);
        log_activity($u, 'Added photo', (string) $pname);
        json_out(['id' => (int) db()->lastInsertId(), 'path' => $path]);

    case 'image_delete':
        $u = require_perm('products');
        $id = (int) (body()['id'] ?? 0);
        $st = db()->prepare('SELECT path FROM product_images WHERE id = ?');
        $st->execute([$id]);
        $path = $st->fetchColumn();
        if (!$path) fail('Photo not found.', 404);
        db()->prepare('DELETE FROM product_images WHERE id = ?')->execute([$id]);
        delete_upload((string) $path);
        log_activity($u, 'Removed photo');
        json_out(['ok' => true]);

    case 'image_order':
        require_perm('products');
        $ids = array_map('intval', (array) (body()['ids'] ?? []));
        $st = db()->prepare('UPDATE product_images SET sort = ? WHERE id = ?');
        foreach ($ids as $i => $id) $st->execute([$i, $id]);
        json_out(['ok' => true]);

    case 'category_save':
        $u = require_perm('products');
        $b = body();
        $label = str_in($b['label'] ?? '', 60);
        if ($label === '') fail('Category name is required.');
        $key = str_in($b['key'] ?? '', 40);
        if ($key === '') {
            $key = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($label)), '-') ?: 'cat';
            $exists = db()->prepare('SELECT 1 FROM categories WHERE key = ?');
            $exists->execute([$key]);
            if ($exists->fetchColumn()) $key .= '-' . bin2hex(random_bytes(2));
            db()->prepare('INSERT INTO categories (key, label, descr, sort, label_ar, descr_ar) VALUES (?, ?, ?, ?, ?, ?)')
                ->execute([$key, $label, str_in($b['descr'] ?? '', 200), (int) ($b['sort'] ?? 50), str_in($b['label_ar'] ?? '', 60), str_in($b['descr_ar'] ?? '', 200)]);
        } else {
            db()->prepare('UPDATE categories SET label = ?, descr = ?, sort = ?, label_ar = ?, descr_ar = ? WHERE key = ?')
                ->execute([$label, str_in($b['descr'] ?? '', 200), (int) ($b['sort'] ?? 50), str_in($b['label_ar'] ?? '', 60), str_in($b['descr_ar'] ?? '', 200), $key]);
        }
        log_activity($u, 'Saved category', $label);
        json_out(['key' => $key]);

    case 'category_delete':
        $u = require_perm('products');
        $key = str_in(body()['key'] ?? '', 40);
        if ($key === 'services') fail('The Marketing Plans category is used by the plans section and cannot be deleted.');
        $st = db()->prepare('SELECT COUNT(*) FROM products WHERE cat = ?');
        $st->execute([$key]);
        if ((int) $st->fetchColumn() > 0) fail('Move or delete the products in this category first.');
        db()->prepare('DELETE FROM categories WHERE key = ?')->execute([$key]);
        log_activity($u, 'Deleted category', $key);
        json_out(['ok' => true]);

    // ---------- orders ----------

    case 'orders':
        require_perm('orders');
        $where = [];
        $args = [];
        if (!empty($_GET['status'])) { $where[] = 'o.status = ?'; $args[] = $_GET['status']; }
        else $where[] = "o.status != 'Awaiting payment'"; // unpaid online checkouts only show under their own tab
        if (!empty($_GET['q'])) {
            $q = '%' . $_GET['q'] . '%';
            $where[] = '(o.customer LIKE ? OR o.email LIKE ? OR o.phone LIKE ? OR (\'WTS-\' || (1000 + o.id)) LIKE ?)';
            array_push($args, $q, $q, $q, $q);
        }
        $u = current_user();
        if (in_array('own_orders', $u['perms'], true)) { $where[] = 'o.rep_id = ?'; $args[] = (int) $u['id']; }
        if (!empty($_GET['rep'])) { $where[] = 'o.rep_id = ?'; $args[] = (int) $_GET['rep']; }
        $sql = 'SELECT o.*, u.name AS rep_name, c.name AS created_by_name, (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.order_id = o.id) AS paid FROM orders o LEFT JOIN users u ON u.id = o.rep_id LEFT JOIN users c ON c.id = o.created_by'
            . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY o.id DESC LIMIT 500';
        $st = db()->prepare($sql);
        $st->execute($args);
        $rows = array_map('order_out', $st->fetchAll());
        if (($_GET['format'] ?? '') === 'csv') csv_out('orders.csv', $rows);
        json_out(['orders' => $rows]);

    case 'order_update':
        $u = require_perm('orders');
        $b = body();
        $id = (int) ($b['id'] ?? 0);
        $pdo = db();
        $st = $pdo->prepare('SELECT * FROM orders WHERE id = ?');
        $st->execute([$id]);
        $o = $st->fetch();
        if (!$o) fail('Order not found.', 404);
        assert_order_access($u, $o);
        set_order_status($id, (string) ($b['status'] ?? $o['status']), str_in($b['notes'] ?? $o['notes'], 2000));
        if (array_key_exists('prep_notes', $b)) $pdo->prepare('UPDATE orders SET prep_notes = ? WHERE id = ?')->execute([str_in($b['prep_notes'], 500), $id]);
        if (array_key_exists('business_name', $b)) {
            $pdo->prepare('UPDATE orders SET business_name = ?, review_link = ?, links = ?, design_notes = ? WHERE id = ?')
                ->execute([str_in($b['business_name'], 120), str_in($b['review_link'] ?? '', 500), str_in($b['links'] ?? '', 1000), str_in($b['design_notes'] ?? '', 2000), $id]);
        }
        json_out(['ok' => true]);

    case 'order_file_upload':
        $u = require_perm('orders');
        $id = (int) ($_POST['order_id'] ?? 0);
        $st = db()->prepare('SELECT * FROM orders WHERE id = ?');
        $st->execute([$id]);
        $o = $st->fetch();
        if (!$o) fail('Order not found.', 404);
        assert_order_access($u, $o);
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) fail('Upload failed. Files must be under ' . (cfg('max_upload_bytes') >> 20) . ' MB.');
        $kind = in_array($_POST['kind'] ?? '', ['Logo', 'Design proof', 'Final design', 'Other'], true) ? $_POST['kind'] : 'Other';
        $path = store_order_file($f, $kind === 'Logo' ? 'logo' : 'file');
        $files = json_decode((string) $o['files'], true) ?: [];
        $files[] = ['path' => $path, 'name' => str_in($f['name'], 120), 'kind' => $kind, 'by' => $u['name'], 'at' => gmdate('Y-m-d H:i:s')];
        db()->prepare('UPDATE orders SET files = ? WHERE id = ?')->execute([json_encode($files, JSON_UNESCAPED_UNICODE), $id]);
        log_activity($u, 'Added ' . strtolower($kind), order_number($id));
        json_out(['files' => $files]);

    case 'order_file_delete':
        $u = require_perm('orders');
        $b = body();
        $id = (int) ($b['order_id'] ?? 0);
        $st = db()->prepare('SELECT * FROM orders WHERE id = ?');
        $st->execute([$id]);
        $o = $st->fetch();
        if (!$o) fail('Order not found.', 404);
        assert_order_access($u, $o);
        $files = json_decode((string) $o['files'], true) ?: [];
        $keep = [];
        foreach ($files as $file) {
            if ($file['path'] === ($b['path'] ?? '')) {
                $local = cfg('order_upload_dir') . '/' . basename($file['path']);
                if (strpos($file['path'], cfg('order_upload_url') . '/') === 0 && is_file($local)) @unlink($local);
                continue;
            }
            $keep[] = $file;
        }
        db()->prepare('UPDATE orders SET files = ? WHERE id = ?')->execute([json_encode($keep, JSON_UNESCAPED_UNICODE), $id]);
        json_out(['files' => $keep]);

    // ---------- Bosta shipping ----------

    case 'bosta_info':
        require_perm('orders');
        if (!bosta_enabled()) json_out(['enabled' => false]);
        $locations = [];
        $locError = null;
        try { $locations = bosta_locations(); } catch (Throwable $e) { $locError = $e->getMessage(); }
        json_out(['enabled' => true, 'locations' => $locations, 'locationsError' => $locError,
            'defaultLocation' => bosta_cfg('business_location_id', ''), 'defaultSize' => bosta_cfg('default_size', 'SMALL')]);

    case 'bosta_areas':
        require_perm('orders');
        json_out(['cities' => array_map(function ($c) {
            return ['id' => $c['id'], 'name' => $c['name'], 'ar' => $c['ar'], 'zones' => bosta_zones($c)];
        }, bosta_areas())]);

    case 'bosta_create':
        $u = require_perm('orders');
        $b = body();
        $ids = array_map('intval', (array) ($b['ids'] ?? [$b['id'] ?? 0]));
        $results = [];
        foreach ($ids as $id) {
            $st = db()->prepare('SELECT * FROM orders WHERE id = ?');
            $st->execute([$id]);
            $o = $st->fetch();
            if (!$o || !order_accessible($u, $o)) { $results[] = ['id' => $id, 'error' => 'Order not found.']; continue; }
            try {
                if ($o['status'] === 'Cancelled') throw new RuntimeException('Order is cancelled.');
                $opts = count($ids) === 1 ? $b : ['size' => $b['size'] ?? '', 'location_id' => $b['location_id'] ?? ''];
                if (count($ids) === 1 && array_key_exists('prep_notes', $b)) { // edited on the shipping card: keep it on the order too
                    $o['prep_notes'] = str_in($b['prep_notes'], 500);
                    db()->prepare('UPDATE orders SET prep_notes = ? WHERE id = ?')->execute([$o['prep_notes'], $id]);
                }
                $r = bosta_create_for_order($o, $opts);
                db()->prepare("UPDATE orders SET bosta_id = ?, tracking_number = ?, bosta_state = ?, bosta_cod = ?, city_id = ?, district_id = ?, district = ?,
                    address = ?, bosta_note = '', bosta_updated_at = datetime('now') WHERE id = ?")
                    ->execute([$r['bosta_id'], $r['tracking_number'], $r['state'], $r['cod'], $r['city_id'], $r['district_id'], $r['district'],
                        count($ids) === 1 && !empty($b['address']) ? str_in($b['address'], 500) : $o['address'], $id]);
                if ($o['status'] === 'Pending') set_order_status($id, 'Confirmed');
                log_activity($u, 'Bosta shipment created', order_number($id) . ' · ' . $r['tracking_number']);
                $results[] = ['id' => $id, 'number' => order_number($id), 'tracking' => $r['tracking_number']];
            } catch (Throwable $e) {
                $results[] = ['id' => $id, 'number' => order_number($id), 'error' => $e->getMessage()];
            }
        }
        json_out(['results' => $results]);

    case 'bosta_refresh':
        $u = require_perm('orders');
        $st = db()->prepare('SELECT id, tracking_number, rep_id FROM orders WHERE id = ?');
        $st->execute([(int) (body()['id'] ?? 0)]);
        $o = $st->fetch();
        if (!$o || !$o['tracking_number']) fail('This order has no Bosta shipment.', 404);
        assert_order_access($u, $o);
        try { $d = bosta_view($o['tracking_number']); }
        catch (ShopError $e) { if (!bosta_gone($e)) throw $e; bosta_mark_deleted((int) $o['id']); json_out(['state' => 49, 'label' => 'Deleted on Bosta']); }
        $code = (int) ($d['state']['code'] ?? 0);
        if ($code) bosta_apply_state((int) $o['id'], $code, (string) ($d['state']['exception']['reason'] ?? ($d['exceptionReason'] ?? '')));
        json_out(['state' => $code, 'label' => bosta_state_label($code)]);

    // Owner only: remove test or mistaken orders completely (stock goes back, payments are removed).
    case 'order_delete':
        $u = require_perm('team');
        $ids = array_values(array_unique(array_filter(array_map('intval', (array) (body()['ids'] ?? [])))));
        if (!$ids || count($ids) > 50) fail('Choose up to 50 orders to delete.');
        $pdo = db();
        $deleted = [];
        foreach ($ids as $id) {
            $st = $pdo->prepare('SELECT * FROM orders WHERE id = ?');
            $st->execute([$id]);
            $o = $st->fetch();
            if (!$o) continue;
            // A live Bosta shipment is cancelled first; one already deleted on Bosta is fine.
            if ($o['tracking_number'] && !in_array((int) $o['bosta_state'], [45, 46, 48, 49, 60], true)) {
                try { bosta_terminate($o['tracking_number']); }
                catch (Throwable $e) {
                    if (!bosta_gone($e)) fail(order_number($id) . ': Bosta didn’t let us cancel its shipment (' . $e->getMessage() . '). Cancel it in Bosta, then delete the order.');
                }
            }
            tx_begin();
            try {
                if (!in_array($o['status'], ['Cancelled', 'Returned'], true)) {
                    foreach (json_decode($o['items'], true) ?: [] as $it) {
                        if (($it['id'] ?? '') === 'custom') continue;
                        adjust_stock($pdo, (string) $it['id'], isset($it['variant']) ? (string) $it['variant'] : null, (int) $it['qty']);
                    }
                }
                $pdo->prepare('DELETE FROM payments WHERE order_id = ?')->execute([$id]);
                $pdo->prepare('DELETE FROM orders WHERE id = ?')->execute([$id]);
                tx_commit();
            } catch (Throwable $e) { tx_rollback(); throw $e; }
            log_activity($u, 'Deleted order', order_number($id) . ' · ' . $o['customer'] . ' · EGP ' . number_format((float) $o['total']));
            $deleted[] = order_number($id);
        }
        // Let numbering carry on from the last order that's left (deleted test orders at the end don't leave a gap).
        $pdo->exec("UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(id), 0) FROM orders) WHERE name = 'orders'");
        json_out(['deleted' => $deleted]);

    case 'bosta_sync':
        require_perm('orders');
        [$checked, $changed] = bosta_sync_open(100);
        @touch(cfg('data_dir') . '/bosta-sync.txt');
        json_out(['checked' => $checked, 'changed' => $changed]);

    case 'bosta_awb':
        $u = require_perm('orders');
        $ids = array_map('intval', explode(',', (string) ($_GET['ids'] ?? '')));
        $in = implode(',', array_fill(0, count($ids), '?'));
        $own = in_array('own_orders', $u['perms'], true) ? ' AND rep_id = ' . (int) $u['id'] : '';
        $st = db()->prepare("SELECT tracking_number FROM orders WHERE id IN ($in) AND tracking_number IS NOT NULL AND tracking_number != ''$own");
        $st->execute($ids);
        $tracks = $st->fetchAll(PDO::FETCH_COLUMN);
        if (!$tracks) fail('None of these orders has a Bosta shipment yet.', 404);
        if (count($tracks) > 50) fail('Print up to 50 waybills at a time.');
        $pdf = bosta_awb_pdf($tracks);
        header('Content-Type: application/pdf');
        header('Content-Disposition: inline; filename="bosta-waybills.pdf"');
        header('Cache-Control: no-store');
        echo $pdf;
        exit;

    case 'bosta_cancel':
        $u = require_perm('orders');
        $st = db()->prepare('SELECT id, tracking_number, rep_id FROM orders WHERE id = ?');
        $st->execute([(int) (body()['id'] ?? 0)]);
        $o = $st->fetch();
        if (!$o || !$o['tracking_number']) fail('This order has no Bosta shipment.', 404);
        assert_order_access($u, $o);
        bosta_terminate($o['tracking_number']);
        db()->prepare("UPDATE orders SET bosta_state = 48, bosta_updated_at = datetime('now') WHERE id = ?")->execute([$o['id']]);
        log_activity($u, 'Bosta shipment cancelled', order_number((int) $o['id']) . ' · ' . $o['tracking_number']);
        json_out(['ok' => true]);

    // ---------- leads ----------

    case 'leads':
        require_perm('leads');
        $rows = db()->query('SELECT l.*, u.name AS assigned_name FROM leads l LEFT JOIN users u ON u.id = l.assigned_to ORDER BY l.id DESC LIMIT 500')->fetchAll();
        if (($_GET['format'] ?? '') === 'csv') csv_out('leads.csv', $rows);
        json_out(['leads' => $rows]);

    case 'lead_save':
        $u = require_perm('leads');
        $b = body();
        $id = (int) ($b['id'] ?? 0);
        $status = in_array($b['status'] ?? '', LEAD_STATUSES, true) ? $b['status'] : 'New';
        $assigned = !empty($b['assigned_to']) ? (int) $b['assigned_to'] : null;
        $follow = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($b['follow_up'] ?? '')) ? $b['follow_up'] : null;
        if ($id) {
            db()->prepare('UPDATE leads SET status = ?, notes = ?, assigned_to = ?, follow_up = ? WHERE id = ?')
                ->execute([$status, str_in($b['notes'] ?? '', 4000), $assigned, $follow, $id]);
            // Name, phone/email and interest can be corrected after the lead was created.
            if (array_key_exists('name', $b) || array_key_exists('contact', $b)) {
                $name = str_in($b['name'] ?? '', 120);
                $contact = str_in($b['contact'] ?? '', 160);
                if ($name === '' || $contact === '') fail('Name and contact are required.');
                $old = db()->prepare('SELECT name, contact, source, notes FROM leads WHERE id = ?');
                $old->execute([$id]);
                $before = $old->fetch() ?: ['name' => '', 'contact' => '', 'source' => '', 'notes' => ''];
                $dupe = $before['contact'] === $contact ? null : find_lead(phone_key($contact), email_key($contact));
                if ($dupe && (int) $dupe['id'] !== $id) {
                    fail('This number or email already belongs to “' . $dupe['name'] . '” (' . $dupe['status'] . ($dupe['assigned_name'] ? ', ' . $dupe['assigned_name'] : '') . '). Open that lead and add a note instead.', 409);
                }
                db()->prepare('UPDATE leads SET name = ?, contact = ?, cat = ?, phone_key = ?, email_key = ? WHERE id = ?')
                    ->execute([$name, $contact, str_in($b['cat'] ?? '', 120), phone_key($contact), email_key($contact), $id]);
                // Also on a plain save, so orders that kept an old number (edited before this sync existed) catch up.
                $sync = sync_lead_orders($before, $name, $contact);
            }
            log_activity($u, 'Updated lead', '#' . $id . ' → ' . $status . (!empty($sync['orders']) ? ' · details copied to ' . implode(', ', $sync['orders']) : ''));
            json_out(['ok' => true, 'synced' => $sync['orders'] ?? [], 'shipped' => $sync['shipped'] ?? []]);
        } else {
            $name = str_in($b['name'] ?? '', 120);
            $contact = str_in($b['contact'] ?? '', 160);
            if ($name === '' || $contact === '') fail('Name and contact are required.');
            $dupe = find_lead(phone_key($contact), email_key($contact));
            if ($dupe) {
                fail('This number or email already belongs to “' . $dupe['name'] . '” (' . $dupe['status'] . ($dupe['assigned_name'] ? ', ' . $dupe['assigned_name'] : '') . '). Open that lead and add a note instead.', 409);
            }
            $newId = insert_lead(['name' => $name, 'contact' => $contact, 'cat' => str_in($b['cat'] ?? '', 40), 'source' => str_in($b['source'] ?? 'Added by team', 80),
                'status' => $status, 'notes' => str_in($b['notes'] ?? '', 2000), 'assigned_to' => $assigned]);
            if ($follow) db()->prepare('UPDATE leads SET follow_up = ? WHERE id = ?')->execute([$follow, $newId]);
            log_activity($u, 'Added lead', $name);
        }
        json_out(['ok' => true]);

    // Board moves and quick actions: change only the status and/or follow-up date.
    case 'lead_move':
        $u = require_perm('leads');
        $b = body();
        $id = (int) ($b['id'] ?? 0);
        $sets = []; $vals = [];
        if (isset($b['status'])) {
            if (!in_array($b['status'], LEAD_STATUSES, true)) fail('Unknown status');
            $sets[] = 'status = ?'; $vals[] = $b['status'];
        }
        if (array_key_exists('follow_up', $b)) {
            $sets[] = 'follow_up = ?';
            $vals[] = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $b['follow_up']) ? $b['follow_up'] : null;
        }
        if (!$id || !$sets) fail('Nothing to change');
        $vals[] = $id;
        db()->prepare('UPDATE leads SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($vals);
        log_activity($u, 'Updated lead', '#' . $id . (isset($b['status']) ? ' → ' . $b['status'] : ' · follow-up ' . ($b['follow_up'] ?: 'cleared')));
        json_out(['ok' => true]);

    // ---------- payments ----------

    case 'order_payments':
        $u = require_perm('orders');
        $o = load_order((int) ($_GET['id'] ?? 0));
        assert_order_access($u, $o);
        json_out(['payments' => order_payments((int) $o['id']), 'kinds' => PAYMENT_KINDS]);

    case 'payment_add':
        $u = require_perm('orders');
        $b = body();
        $o = load_order((int) ($b['order_id'] ?? 0));
        assert_order_access($u, $o);
        $amount = round((float) ($b['amount'] ?? 0), 2);
        if ($amount == 0 || abs($amount) > 1000000) fail('Enter the amount received (use a minus amount for a refund).');
        add_payment((int) $o['id'], $amount, (string) ($b['method'] ?? 'cash'), str_in($b['note'] ?? '', 200), (int) $u['id']);
        log_activity($u, $amount > 0 ? 'Payment received' : 'Refund recorded', order_number((int) $o['id']) . ' · EGP ' . number_format($amount));
        $o2 = order_out(load_order((int) $o['id']));
        json_out(['payments' => order_payments((int) $o['id']), 'paid' => $o2['paid'], 'due' => $o2['due']]);

    case 'payment_delete':
        $u = require_perm('products'); // owners and managers only
        $b = body();
        $st = db()->prepare('SELECT * FROM payments WHERE id = ?');
        $st->execute([(int) ($b['id'] ?? 0)]);
        $pay = $st->fetch();
        if (!$pay) fail('Payment not found.', 404);
        db()->prepare('DELETE FROM payments WHERE id = ?')->execute([(int) $pay['id']]);
        log_activity($u, 'Deleted a payment', order_number((int) $pay['order_id']) . ' · EGP ' . number_format((float) $pay['amount']));
        $o2 = order_out(load_order((int) $pay['order_id']));
        json_out(['payments' => order_payments((int) $pay['order_id']), 'paid' => $o2['paid'], 'due' => $o2['due']]);

    // Everything the printable quote / invoice needs.
    case 'order_doc':
        $u = require_perm('orders');
        $o = load_order((int) ($_GET['id'] ?? 0));
        assert_order_access($u, $o);
        json_out(['order' => order_out($o), 'payments' => order_payments((int) $o['id']), 'kinds' => PAYMENT_KINDS, 'me' => $u['name']]);

    // ---------- customers ----------
    // Customers are grouped from orders by phone (last 9 digits), falling back to email.

    case 'customers':
        $u = require_perm('orders');
        $own = in_array('own_orders', $u['perms'], true);
        $rows = db()->query('SELECT o.id, o.customer, o.email, o.phone, o.total, o.status, o.created_at, o.business_name, o.city, o.district,
            (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.order_id = o.id) AS paid FROM orders o WHERE o.status != \'Awaiting payment\'' . ($own ? ' AND o.rep_id = ' . (int) $u['id'] : '') . ' ORDER BY o.id')->fetchAll();
        $map = [];
        foreach ($rows as $r) {
            $key = phone_key((string) $r['phone']) ?: (email_key((string) $r['email']) ?: 'order-' . $r['id']);
            $closed = in_array($r['status'], ['Cancelled', 'Returned'], true);
            if (!isset($map[$key])) $map[$key] = ['key' => $key, 'name' => $r['customer'], 'phone' => $r['phone'], 'email' => $r['email'], 'business' => '', 'city' => '',
                'orders' => 0, 'spent' => 0.0, 'due' => 0.0, 'first' => $r['created_at'], 'last' => $r['created_at']];
            $c = &$map[$key];
            $c['name'] = $r['customer']; // latest name wins
            if ($r['phone']) $c['phone'] = $r['phone'];
            if ($r['email'] && strpos($r['email'], '@') !== false) $c['email'] = $r['email'];
            if ($r['business_name']) $c['business'] = $r['business_name'];
            if ($r['district'] || $r['city']) $c['city'] = trim($r['district'] . ($r['district'] && $r['city'] ? ', ' : '') . $r['city']);
            $c['last'] = $r['created_at'];
            if (!$closed) {
                $c['orders']++;
                $c['spent'] += (float) $r['total'];
                $c['due'] += max(0, (float) $r['total'] - (float) $r['paid']);
            }
            unset($c);
        }
        // Shop accounts (customers who signed in on the website), matched by email or phone.
        $byEmail = $byPhone = [];
        foreach ($map as $k => $c) {
            if ($e = email_key((string) $c['email'])) $byEmail[$e] = $k;
            if ($ph = phone_key((string) $c['phone'])) $byPhone[$ph] = $k;
        }
        foreach (db()->query('SELECT * FROM customers ORDER BY id')->fetchAll() as $a) {
            $acct = ['since' => $a['created_at'], 'lastLogin' => $a['last_login'], 'offers' => (bool) $a['offers'], 'contact' => $a['contact_pref'], 'lang' => $a['lang']];
            $k = $byEmail[email_key((string) $a['email'])] ?? (phone_key((string) $a['phone']) ? ($byPhone[phone_key((string) $a['phone'])] ?? null) : null);
            if ($k !== null) { $map[$k]['account'] = $acct; if (!$map[$k]['email']) $map[$k]['email'] = $a['email']; continue; }
            if ($own) continue; // people limited to their own orders don't see sign-ups without orders
            $key = email_key((string) $a['email']);
            $map[$key] = ['key' => $key, 'name' => $a['name'] ?: explode('@', $a['email'])[0], 'phone' => $a['phone'], 'email' => $a['email'], 'business' => '',
                'city' => trim(($a['district'] ?: '') . ($a['district'] && $a['city'] ? ', ' : '') . ($a['city'] ?: '')), 'orders' => 0, 'spent' => 0.0, 'due' => 0.0,
                'first' => $a['created_at'], 'last' => $a['last_login'] ?: $a['created_at'], 'account' => $acct];
        }
        $list = array_values(array_map(function ($c) { return $c + ['account' => null]; }, $map));
        usort($list, function ($a, $b) { return strcmp((string) $b['last'], (string) $a['last']); });
        json_out(['customers' => $list]);

    case 'customer':
        $u = require_perm('orders');
        $key = preg_replace('/[^\w.@+-]/', '', (string) ($_GET['key'] ?? ''));
        if ($key === '') fail('Customer not found.', 404);
        $own = in_array('own_orders', $u['perms'], true);
        $isPhone = ctype_digit($key);
        $st = db()->prepare('SELECT o.*, u.name AS rep_name, (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.order_id = o.id) AS paid
            FROM orders o LEFT JOIN users u ON u.id = o.rep_id WHERE ' . ($isPhone ? 'o.phone LIKE ?' : 'o.email = ? COLLATE NOCASE') . ($own ? ' AND o.rep_id = ' . (int) $u['id'] : '') . ' ORDER BY o.id DESC');
        $st->execute([$isPhone ? '%' . substr($key, -4) : $key]);
        $orders = array_values(array_filter(array_map('order_out', $st->fetchAll()), function ($o) use ($key, $isPhone) {
            return $isPhone ? phone_key($o['phone']) === $key : true;
        }));
        $lead = in_array('leads', $u['perms'], true) ? find_lead($isPhone ? $key : null, $isPhone ? null : $key) : null;
        json_out(['orders' => $orders, 'lead' => $lead]);

    // ---------- quotes ----------

    case 'quotes':
        $u = require_perm('sell');
        $own = in_array('own_orders', $u['perms'], true);
        $rows = db()->query('SELECT q.*, u.name AS rep_name FROM quotes q LEFT JOIN users u ON u.id = q.rep_id' . ($own ? ' WHERE q.rep_id = ' . (int) $u['id'] : '') . ' ORDER BY q.id DESC LIMIT 500')->fetchAll();
        json_out(['quotes' => array_map('quote_out', $rows), 'statuses' => QUOTE_STATUSES]);

    case 'quote_save':
        $u = require_perm('sell');
        $b = body();
        $id = (int) ($b['id'] ?? 0);
        if ($id) {
            $q = load_quote($id);
            assert_quote_access($u, $q);
            if ($q['status'] === 'Accepted') fail('This quote was accepted and turned into an order, so it can’t be changed.');
        }
        $name = str_in($b['name'] ?? '', 120);
        if ($name === '') fail('Enter the customer’s name.');
        $email = str_in($b['email'] ?? '', 160);
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) fail('That email doesn’t look right — fix it or leave it empty.');
        [$lines, $clean, $subtotal, $physical] = price_quote_items(is_array($b['items'] ?? null) ? $b['items'] : []);
        $discount = min($subtotal, max(0, round((float) ($b['discount'] ?? 0), 2)));
        $shipping = isset($b['shipping']) && $b['shipping'] !== '' ? max(0, round((float) $b['shipping'], 2))
            : ($physical > 0 && $physical < cfg('free_shipping_threshold') ? (float) cfg('shipping_fee') : 0.0);
        $total = round($subtotal - $discount + $shipping, 2);
        $cityId = str_in($b['city_id'] ?? '', 40); $districtId = str_in($b['district_id'] ?? '', 40); $city = ''; $district = '';
        if ($cityId && $districtId) {
            try { $area = bosta_find_area($cityId, $districtId); if ($area) { $city = $area['city']['name']; $district = $area['district']['name']; } else { $cityId = $districtId = ''; } }
            catch (Throwable $e) { $cityId = $districtId = ''; }
        }
        $valid = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($b['valid_until'] ?? '')) ? $b['valid_until'] : date('Y-m-d', time() + 14 * 86400);
        $repId = in_array('targets', $u['perms'], true) && !empty($b['rep_id']) ? (int) $b['rep_id'] : ($id ? (int) $q['rep_id'] : (int) $u['id']);
        $leadId = !empty($b['lead_id']) ? (int) $b['lead_id'] : ($id ? $q['lead_id'] : null);
        $vals = [$leadId, $name, str_in($b['phone'] ?? '', 40), $email, str_in($b['business_name'] ?? '', 120), str_in($b['review_link'] ?? '', 500), str_in($b['links'] ?? '', 1000),
            str_in($b['design_notes'] ?? '', 2000), str_in($b['address'] ?? '', 500), $city, $district, $cityId ?: null, $districtId ?: null,
            json_encode($clean, JSON_UNESCAPED_UNICODE), json_encode($lines, JSON_UNESCAPED_UNICODE), $subtotal, $discount, $shipping, $total, $valid,
            str_in($b['terms'] ?? '', 2000), str_in($b['notes'] ?? '', 2000), $repId ?: null];
        $cols = 'lead_id, customer, phone, email, business_name, review_link, links, design_notes, address, city, district, city_id, district_id, items_in, items, subtotal, discount, shipping, total, valid_until, terms, notes, rep_id';
        if ($id) {
            db()->prepare('UPDATE quotes SET ' . implode(' = ?, ', explode(', ', $cols)) . " = ?, updated_at = datetime('now') WHERE id = ?")->execute(array_merge($vals, [$id]));
            log_activity($u, 'Updated quote', quote_number($id) . ' · EGP ' . number_format($total));
            link_quote_lead($id);
        } else {
            db()->prepare("INSERT INTO quotes ($cols, created_by) VALUES (" . rtrim(str_repeat('?, ', 23), ', ') . ', ?)')->execute(array_merge($vals, [(int) $u['id']]));
            $id = (int) db()->lastInsertId();
            log_activity($u, 'Created quote', quote_number($id) . ' · ' . $name . ' · EGP ' . number_format($total));
            // The customer is kept as a lead (an existing one moves to Quoted, with the quote noted on it).
            $lead = $leadId ? (function ($lid) { $st = db()->prepare('SELECT * FROM leads WHERE id = ?'); $st->execute([$lid]); return $st->fetch() ?: null; })($leadId) : null;
            if ($lead) touch_lead($lead, date('Y-m-d') . ' · Quote ' . quote_number($id) . ' · EGP ' . number_format($total), in_array($lead['status'], ['New', 'Contacted'], true) ? 'Quoted' : null, (int) $u['id']);
            else link_quote_lead($id);
        }
        json_out(['quote' => quote_out(load_quote($id))]);

    case 'quote_status':
        $u = require_perm('sell');
        $b = body();
        $q = load_quote((int) ($b['id'] ?? 0));
        assert_quote_access($u, $q);
        $status = (string) ($b['status'] ?? '');
        if (!in_array($status, ['Draft', 'Sent', 'Declined'], true)) fail('Unknown status');
        if ($q['status'] === 'Accepted') fail('This quote is already accepted.');
        db()->prepare("UPDATE quotes SET status = ?, sent_at = CASE WHEN ? = 'Sent' THEN COALESCE(sent_at, datetime('now')) ELSE sent_at END, updated_at = datetime('now') WHERE id = ?")
            ->execute([$status, $status, (int) $q['id']]);
        log_activity($u, 'Quote ' . strtolower($status), quote_number((int) $q['id']));
        json_out(['quote' => quote_out(load_quote((int) $q['id']))]);

    case 'quote_delete':
        $u = require_perm('sell');
        $q = load_quote((int) (body()['id'] ?? 0));
        assert_quote_access($u, $q);
        if ($q['status'] === 'Accepted') fail('Accepted quotes are kept with their order.');
        db()->prepare('DELETE FROM quotes WHERE id = ?')->execute([(int) $q['id']]);
        log_activity($u, 'Deleted quote', quote_number((int) $q['id']));
        json_out(['ok' => true]);

    // ---------- WhatsApp inbox ----------

    // Chat list for the inbox (and the numbers behind the badges).
    case 'wa_chats':
        $u = require_perm('whatsapp');
        $all = in_array('whatsapp_all', $u['perms'], true);
        $view = (string) ($_GET['view'] ?? 'mine');
        $q = trim(str_in($_GET['q'] ?? '', 60));
        $where = [];
        $args = [];
        if (!$all) { $where[] = '(c.assigned_to = ? OR c.assigned_to IS NULL)'; $args[] = (int) $u['id']; }
        if ($view === 'mine') { $where[] = 'c.assigned_to = ?'; $args[] = (int) $u['id']; $where[] = "c.status = 'open'"; }
        elseif ($view === 'unassigned') { $where[] = 'c.assigned_to IS NULL'; $where[] = "c.status = 'open'"; }
        elseif ($view === 'waiting') { $where[] = 'c.waiting_since IS NOT NULL'; $where[] = "c.status = 'open'"; }
        elseif ($view === 'closed') { $where[] = "c.status = 'closed'"; }
        else { $where[] = "c.status = 'open'"; }
        if ($q !== '') {
            $digits = preg_replace('/\D/', '', $q);
            $where[] = '(c.name LIKE ? OR l.name LIKE ?' . (strlen($digits) >= 3 ? ' OR c.wa_id LIKE ?' : '') . ')';
            array_push($args, '%' . $q . '%', '%' . $q . '%');
            if (strlen($digits) >= 3) $args[] = '%' . substr($digits, -9) . '%';
        }
        $st = db()->prepare('SELECT c.*, u.name AS agent_name, l.name AS lead_name, l.status AS lead_status FROM wa_chats c LEFT JOIN users u ON u.id = c.assigned_to LEFT JOIN leads l ON l.id = c.lead_id'
            . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY c.last_at DESC LIMIT 300');
        $st->execute($args);
        $chats = array_map('wa_chat_out', $st->fetchAll());
        // Badge numbers for each view.
        $mine = db()->prepare("SELECT COUNT(*) AS n, COALESCE(SUM(unread), 0) AS unread, SUM(CASE WHEN waiting_since IS NOT NULL THEN 1 ELSE 0 END) AS waiting FROM wa_chats WHERE status = 'open' AND assigned_to = ?");
        $mine->execute([(int) $u['id']]);
        $counts = ['mine' => $mine->fetch(), 'unassigned' => (int) db()->query("SELECT COUNT(*) FROM wa_chats WHERE status = 'open' AND assigned_to IS NULL")->fetchColumn()];
        if ($all) $counts['waiting'] = (int) db()->query("SELECT COUNT(*) FROM wa_chats WHERE status = 'open' AND waiting_since IS NOT NULL")->fetchColumn();
        $agents = db()->query('SELECT id, name, wa_away FROM users WHERE active = 1 AND wa_agent = 1 ORDER BY name')->fetchAll();
        $quick = db()->query('SELECT id, title, body FROM wa_quick ORDER BY sort, id')->fetchAll();
        try { wa_cleanup(); } catch (Throwable $e) {}
        json_out(['chats' => $chats, 'counts' => $counts, 'agents' => array_map(function ($a) { return ['id' => (int) $a['id'], 'name' => $a['name'], 'away' => (bool) $a['wa_away']]; }, $agents),
            'quick' => $quick, 'ready' => wa_ready(), 'me' => ['id' => (int) $u['id'], 'agent' => (bool) ($u['wa_agent'] ?? 0), 'away' => (bool) ($u['wa_away'] ?? 0), 'all' => $all]]);

    // Small and frequent: the unread badge and new-message sound on every page.
    case 'wa_unread':
        $u = require_perm('whatsapp');
        // Your chats plus the ones nobody has taken yet.
        $st = db()->prepare("SELECT COALESCE(SUM(unread), 0) FROM wa_chats WHERE status = 'open' AND (assigned_to = ? OR assigned_to IS NULL)");
        $st->execute([(int) $u['id']]);
        $last = db()->prepare("SELECT COALESCE(MAX(m.id), 0) FROM wa_messages m JOIN wa_chats c ON c.id = m.chat_id WHERE m.dir = 'in' AND m.kind != 'reaction' AND (c.assigned_to = ? OR c.assigned_to IS NULL)");
        $last->execute([(int) $u['id']]);
        json_out(['unread' => (int) $st->fetchColumn(), 'lastIn' => (int) $last->fetchColumn()]);

    // One chat with its messages (all, or only those after ?after=<message id> for live updates).
    case 'wa_chat':
        $u = require_perm('whatsapp');
        $chat = wa_chat_for_user($u, (int) ($_GET['id'] ?? 0));
        $after = (int) ($_GET['after'] ?? 0);
        $st = db()->prepare('SELECT m.*, u.name AS user_name FROM wa_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.chat_id = ? AND m.id > ? ORDER BY m.id DESC LIMIT 300');
        $st->execute([(int) $chat['id'], $after]);
        $msgs = array_reverse(array_map('wa_message_out', $st->fetchAll()));
        // Status changes (delivered/read) of the latest sent messages, so ticks update live.
        $ticks = db()->prepare("SELECT id, status, error FROM wa_messages WHERE chat_id = ? AND dir = 'out' ORDER BY id DESC LIMIT 40");
        $ticks->execute([(int) $chat['id']]);
        // Opened by the person it belongs to (or an unassigned chat): read. A manager looking in doesn't clear someone else's unread.
        if (!empty($_GET['read']) && (int) $chat['unread'] > 0 && (!$chat['assigned_to'] || (int) $chat['assigned_to'] === (int) $u['id'])) wa_mark_read($chat);
        $full = wa_chat_out(wa_chat_row((int) $chat['id']));
        $lead = null;
        if ($chat['lead_id']) {
            $l = db()->prepare('SELECT l.*, u.name AS assigned_name FROM leads l LEFT JOIN users u ON u.id = l.assigned_to WHERE l.id = ?');
            $l->execute([(int) $chat['lead_id']]);
            if ($row = $l->fetch()) $lead = ['id' => (int) $row['id'], 'name' => $row['name'], 'contact' => $row['contact'], 'status' => $row['status'], 'source' => $row['source'], 'cat' => $row['cat'], 'notes' => $row['notes'], 'assigned' => $row['assigned_name'], 'createdAt' => $row['created_at']];
        }
        // What this customer already has with us.
        $key = phone_key(wa_local_phone($chat['wa_id']));
        $orders = []; $quotes = [];
        if ($key) {
            $o = db()->prepare("SELECT id, status, total, created_at FROM orders WHERE status != 'Awaiting payment' AND REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') LIKE ? ORDER BY id DESC LIMIT 5");
            $o->execute(['%' . $key]);
            foreach ($o->fetchAll() as $r) $orders[] = ['id' => (int) $r['id'], 'number' => order_number((int) $r['id']), 'status' => $r['status'], 'total' => (float) $r['total'], 'at' => $r['created_at']];
            $qq = db()->prepare("SELECT id, status, total, created_at FROM quotes WHERE REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') LIKE ? ORDER BY id DESC LIMIT 5");
            $qq->execute(['%' . $key]);
            foreach ($qq->fetchAll() as $r) $quotes[] = ['id' => (int) $r['id'], 'number' => quote_number((int) $r['id']), 'status' => $r['status'], 'total' => (float) $r['total'], 'at' => $r['created_at']];
        }
        json_out(['chat' => $full, 'messages' => $msgs, 'ticks' => array_map(function ($t) { return ['id' => (int) $t['id'], 'status' => $t['status'], 'error' => $t['error']]; }, $ticks->fetchAll()),
            'lead' => $lead, 'orders' => $orders, 'quotes' => $quotes]);

    case 'wa_send':
        $u = require_perm('whatsapp');
        $b = body();
        $chat = wa_chat_for_user($u, (int) ($b['chat_id'] ?? 0));
        $id = wa_send_text($chat, str_in($b['text'] ?? '', 4096), (int) $u['id']);
        wa_claim($chat, $u);
        json_out(['message' => wa_message_out(wa_message_row($id))]);

    // A file from the team (multipart: chat_id or phone, file, caption).
    case 'wa_send_file':
        $u = require_perm('whatsapp');
        $f = $_FILES['file'] ?? null;
        if (!$f || ($f['error'] ?? 4) === 4) fail('Choose a file.');
        if (in_array($f['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) fail('This file is bigger than the server allows for uploads (ask the hosting to raise upload_max_filesize), or send a smaller file.');
        if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) fail('The upload didn’t finish. Try again.');
        if (!empty($_POST['chat_id'])) $chat = wa_chat_for_user($u, (int) $_POST['chat_id']);
        else {
            $waId = wa_id_from_phone((string) ($_POST['phone'] ?? ''));
            $chat = $waId ? wa_chat_by_wa_id($waId) : null;
            if (!$chat) fail('This customer hasn’t messaged our WhatsApp number yet, so WhatsApp only allows an approved template. Use “Open WhatsApp” instead.');
            $chat = wa_chat_for_user($u, (int) $chat['id']);
        }
        $name = preg_replace('/[\/\\\\:*?"<>|]+/', '', (string) $f['name']) ?: 'file';
        $id = wa_send_file($chat, $f['tmp_name'], mb_substr($name, 0, 160), str_in($_POST['caption'] ?? '', 1024), (int) $u['id']);
        wa_claim($chat, $u);
        json_out(['message' => wa_message_out(wa_message_row($id))]);

    // Is there a chat with this phone where we can still write freely? (quote / invoice page)
    case 'wa_window':
        $u = require_perm('whatsapp');
        $waId = wa_id_from_phone((string) ($_GET['phone'] ?? ''));
        $chat = $waId ? wa_chat_by_wa_id($waId) : null;
        json_out(['ready' => wa_ready(), 'chatId' => $chat ? (int) $chat['id'] : null, 'open' => $chat ? wa_window_open($chat) : false]);

    case 'wa_assign':
        $u = require_perm('whatsapp');
        $b = body();
        $chat = wa_chat_for_user($u, (int) ($b['chat_id'] ?? 0));
        $to = !empty($b['user_id']) ? (int) $b['user_id'] : null;
        $all = in_array('whatsapp_all', $u['perms'], true);
        // Everyone can take an unassigned chat for themselves; only managers move chats between people.
        if (!$all && !($to === (int) $u['id'] && !$chat['assigned_to'])) fail('Only a manager can give a chat to someone else.', 403);
        if ($to) { $ok = db()->prepare('SELECT name FROM users WHERE id = ? AND active = 1'); $ok->execute([$to]); $toName = $ok->fetchColumn(); if (!$toName) fail('Unknown team member.'); }
        wa_assign((int) $chat['id'], $to);
        if ($to && $chat['lead_id']) db()->prepare('UPDATE leads SET assigned_to = ? WHERE id = ?')->execute([$to, (int) $chat['lead_id']]);
        log_activity($u, 'WhatsApp chat assigned', wa_local_phone($chat['wa_id']) . ' → ' . ($to ? $toName : 'nobody'));
        json_out(['chat' => wa_chat_out(wa_chat_row((int) $chat['id']))]);

    case 'wa_close':
        $u = require_perm('whatsapp');
        $b = body();
        $chat = wa_chat_for_user($u, (int) ($b['chat_id'] ?? 0));
        $open = !empty($b['open']);
        db()->prepare('UPDATE wa_chats SET status = ?, waiting_since = CASE WHEN ? THEN waiting_since ELSE NULL END, unread = CASE WHEN ? THEN unread ELSE 0 END WHERE id = ?')
            ->execute([$open ? 'open' : 'closed', $open ? 1 : 0, $open ? 1 : 0, (int) $chat['id']]);
        json_out(['chat' => wa_chat_out(wa_chat_row((int) $chat['id']))]);

    // The lead behind a chat: status and a note, from the inbox (also for telesales, for their own chats).
    case 'wa_lead':
        $u = require_perm('whatsapp');
        $b = body();
        $chat = wa_chat_for_user($u, (int) ($b['chat_id'] ?? 0));
        if (!$chat['lead_id']) fail('This chat has no lead.');
        $status = (string) ($b['status'] ?? '');
        if ($status !== '' && !in_array($status, LEAD_STATUSES, true)) fail('Unknown status.');
        $note = str_in($b['note'] ?? '', 1000);
        $l = db()->prepare('SELECT * FROM leads WHERE id = ?');
        $l->execute([(int) $chat['lead_id']]);
        $lead = $l->fetch();
        if (!$lead) fail('Lead not found.', 404);
        $name = str_in($b['name'] ?? '', 120);
        if ($name !== '') db()->prepare('UPDATE leads SET name = ? WHERE id = ?')->execute([$name, (int) $lead['id']]);
        if ($note !== '' || $status !== '') {
            touch_lead($lead, $note !== '' ? date('Y-m-d') . ' · ' . $u['name'] . ': ' . $note : '', $status !== '' ? $status : null, null);
        }
        log_activity($u, 'Updated lead from WhatsApp', $lead['name'] . ($status !== '' ? ' → ' . $status : ''));
        json_out(['ok' => true]);

    // Team member marks themselves away (no new chats handed to them) or back.
    case 'wa_away':
        $u = require_perm('whatsapp');
        db()->prepare('UPDATE users SET wa_away = ? WHERE id = ?')->execute([empty(body()['away']) ? 0 : 1, (int) $u['id']]);
        json_out(['ok' => true]);

    case 'wa_quick_save':
        $u = require_perm('whatsapp_all');
        $b = body();
        $title = str_in($b['title'] ?? '', 60); $text = str_in($b['body'] ?? '', 2000);
        if ($title === '' || $text === '') fail('Enter a name and the message.');
        if (!empty($b['id'])) db()->prepare('UPDATE wa_quick SET title = ?, body = ? WHERE id = ?')->execute([$title, $text, (int) $b['id']]);
        else db()->prepare('INSERT INTO wa_quick (title, body, sort) VALUES (?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM wa_quick))')->execute([$title, $text]);
        json_out(['quick' => db()->query('SELECT id, title, body FROM wa_quick ORDER BY sort, id')->fetchAll()]);

    case 'wa_quick_delete':
        $u = require_perm('whatsapp_all');
        db()->prepare('DELETE FROM wa_quick WHERE id = ?')->execute([(int) (body()['id'] ?? 0)]);
        json_out(['quick' => db()->query('SELECT id, title, body FROM wa_quick ORDER BY sort, id')->fetchAll()]);

    // Settings page: connection, who takes chats, how long videos are kept, space used.
    case 'wa_settings':
        $u = require_perm('backups');
        $c = wa_cfg();
        $users = db()->query('SELECT id, name, role, wa_agent, wa_away FROM users WHERE active = 1 ORDER BY name')->fetchAll();
        $info = null; $error = '';
        $live = null;
        if (!empty($_GET['test']) && wa_cfg('token') && wa_cfg('phone_number_id')) {
            $live = wa_live_status();
            $info = $live['number'];
            $error = $live['errors'][0] ?? '';
        }
        json_out(['token' => !empty($c['token']), 'phoneId' => !empty($c['phone_number_id']), 'appSecret' => !empty($c['app_secret']), 'verifyToken' => !empty($c['verify_token']),
            'ready' => wa_ready(), 'live' => $live, 'lastWebhook' => wa_setting('last_webhook', null), 'webhook' => rtrim((string) cfg('site_url'), '/') . '/api/whatsapp-webhook.php', 'info' => $info, 'error' => $error,
            'users' => array_map(function ($r) { return ['id' => (int) $r['id'], 'name' => $r['name'], 'role' => $r['role'], 'agent' => (bool) $r['wa_agent'], 'away' => (bool) $r['wa_away']]; }, $users),
            'videoDays' => (int) wa_setting('video_days', 90), 'storage' => wa_storage_bytes(), 'diskFree' => @disk_free_space(cfg('data_dir')) ?: null,
            'chats' => (int) db()->query('SELECT COUNT(*) FROM wa_chats')->fetchColumn()]);

    // Going live: register the number with Cloud API (its two-step PIN), and subscribe the app to the WhatsApp account.
    case 'wa_register':
        $u = require_perm('backups');
        $pin = preg_replace('/\D/', '', (string) (body()['pin'] ?? ''));
        if (strlen($pin) !== 6) fail('Enter the six-digit PIN.');
        wa_graph('POST', '/' . rawurlencode((string) wa_cfg('phone_number_id')) . '/register', ['messaging_product' => 'whatsapp', 'pin' => $pin]);
        log_activity($u, 'Registered the WhatsApp number');
        json_out(['ok' => true]);

    case 'wa_subscribe':
        $u = require_perm('backups');
        $id = preg_replace('/\D/', '', (string) (body()['waba'] ?? ''));
        if ($id === '') fail('No WhatsApp account to connect.');
        wa_graph('POST', '/' . $id . '/subscribed_apps');
        log_activity($u, 'Connected the WhatsApp webhook');
        json_out(['ok' => true]);

    case 'wa_settings_save':
        $u = require_perm('backups');
        $b = body();
        if (isset($b['video_days'])) wa_set_setting('video_days', max(0, min(3650, (int) $b['video_days'])));
        foreach ((array) ($b['agents'] ?? []) as $a) {
            db()->prepare('UPDATE users SET wa_agent = ?, wa_away = ? WHERE id = ?')->execute([empty($a['agent']) ? 0 : 1, empty($a['away']) ? 0 : 1, (int) ($a['id'] ?? 0)]);
        }
        log_activity($u, 'Updated WhatsApp settings');
        json_out(['ok' => true]);

    // A photo, video, voice note or document from a chat — only for the team, never public.
    case 'wa_media':
        $u = require_perm('whatsapp');
        $m = wa_message_row((int) ($_GET['id'] ?? 0));
        wa_chat_for_user($u, (int) $m['chat_id']);
        $path = wa_media_dir() . '/' . $m['media_path'];
        if ($m['media_path'] === '' || strpos($m['media_path'], '..') !== false || !is_file($path)) fail('This file is no longer available.', 404);
        header('Content-Type: ' . ($m['media_mime'] ?: 'application/octet-stream'));
        header('Content-Length: ' . filesize($path));
        header('Cache-Control: private, max-age=86400');
        header('X-Content-Type-Options: nosniff');
        $dl = !empty($_GET['download']) || !preg_match('#^(image|video|audio)/|^application/pdf$#', (string) $m['media_mime']);
        header('Content-Disposition: ' . ($dl ? 'attachment' : 'inline') . '; filename="' . rawurlencode($m['media_name'] ?: basename($m['media_path'])) . '"');
        readfile($path);
        exit;

    // ---------- promo codes ----------

    // ---------- partner brands ----------

    case 'brands':
        $u = require_perm('products');
        $month = preg_match('/^\d{4}-\d{2}$/', $_GET['month'] ?? '') ? $_GET['month'] : gmdate('Y-m');
        $money = in_array('revenue', $u['perms'], true);
        $counts = [];
        foreach (db()->query("SELECT brand_id, COUNT(*) n, SUM(status = 'Active') live FROM products WHERE brand_id IS NOT NULL GROUP BY brand_id") as $r) $counts[(int) $r['brand_id']] = $r;
        $out = array_map(function ($b) use ($month, $counts, $money) {
            $b['products'] = (int) ($counts[$b['id']]['n'] ?? 0);
            $b['live'] = (int) ($counts[$b['id']]['live'] ?? 0);
            if ($money) { $b['month'] = brand_totals(brand_lines($b['id'], $month)); $b['balance'] = brand_balance($b['id']); }
            return $b;
        }, load_brands(false, true));
        json_out(['brands' => $out, 'month' => $month]);

    case 'brand_save':
        $u = require_perm('products');
        $b = body();
        $id = (int) ($b['id'] ?? 0);
        $name = str_in($b['name'] ?? '', 80);
        if ($name === '') fail('Enter the brand name.');
        $link = str_in($b['link'] ?? '', 300);
        if ($link !== '' && !preg_match('~^https?://~i', $link)) $link = 'https://' . $link;
        $vals = [':name' => $name, ':name_ar' => str_in($b['nameAr'] ?? '', 80), ':tagline' => str_in($b['tagline'] ?? '', 120), ':tagline_ar' => str_in($b['taglineAr'] ?? '', 120),
            ':about' => str_in($b['about'] ?? '', 1000), ':about_ar' => str_in($b['aboutAr'] ?? '', 1000), ':link' => $link,
            ':commission' => max(0, min(100, (float) ($b['commission'] ?? 0))), ':margin' => max(0, min(500, (float) ($b['margin'] ?? 0))), ':active' => empty($b['active']) ? 0 : 1];
        $pdo = db();
        if ($id) {
            $vals[':id'] = $id;
            $st = $pdo->prepare('UPDATE brands SET name=:name, name_ar=:name_ar, tagline=:tagline, tagline_ar=:tagline_ar, about=:about, about_ar=:about_ar, link=:link, commission=:commission, margin=:margin, active=:active WHERE id=:id');
            $st->execute($vals);
            if (!$st->rowCount() && !brand_get($id)) fail('Brand not found.', 404);
        } else {
            $slug = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($name)), '-') ?: 'brand';
            $base = $slug; $n = 1;
            $chk = $pdo->prepare('SELECT 1 FROM brands WHERE slug = ?');
            while (true) { $chk->execute([$slug]); if (!$chk->fetchColumn()) break; $slug = $base . '-' . (++$n); }
            $vals[':slug'] = $slug;
            $vals[':sort'] = (int) $pdo->query('SELECT COALESCE(MAX(sort),0)+1 FROM brands')->fetchColumn();
            $pdo->prepare('INSERT INTO brands (slug, name, name_ar, tagline, tagline_ar, about, about_ar, link, commission, margin, active, sort) VALUES (:slug, :name, :name_ar, :tagline, :tagline_ar, :about, :about_ar, :link, :commission, :margin, :active, :sort)')->execute($vals);
            $id = (int) $pdo->lastInsertId();
        }
        $repriced = reprice_brand_products($id); // a new margin changes its products' shop prices
        log_activity($u, !empty($b['id']) ? 'Updated brand' : 'Added brand', $name);
        json_out(['brand' => brand_row(brand_get($id), true), 'repriced' => $repriced]);

    case 'brand_logo':
        $u = require_perm('products');
        $id = (int) ($_POST['brand_id'] ?? 0);
        $brand = brand_get($id);
        if (!$brand) fail('Save the brand first, then add its logo.', 404);
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) fail('Upload failed. Photos must be under ' . (cfg('max_upload_bytes') >> 20) . ' MB.');
        $path = store_image($f, 'brand' . $id);
        if ($brand['logo']) delete_upload((string) $brand['logo']);
        db()->prepare('UPDATE brands SET logo = ? WHERE id = ?')->execute([$path, $id]);
        log_activity($u, 'Updated brand', $brand['name'] . ' · logo');
        json_out(['logo' => $path]);

    case 'brand_delete':
        $u = require_perm('products');
        $id = (int) (body()['id'] ?? 0);
        $brand = brand_get($id);
        if (!$brand) fail('Brand not found.', 404);
        $st = db()->prepare('SELECT COUNT(*) FROM products WHERE brand_id = ?');
        $st->execute([$id]);
        if ((int) $st->fetchColumn()) fail('Move this brand’s products to another brand (or delete them) first. To hide the brand, switch it off instead.');
        if (brand_lines($id)) fail('This brand has sales on record, so it is kept for its statements. Switch it off instead.');
        db()->prepare('DELETE FROM brands WHERE id = ?')->execute([$id]);
        if ($brand['logo']) delete_upload((string) $brand['logo']);
        log_activity($u, 'Deleted brand', $brand['name']);
        json_out(['ok' => true]);

    // A brand's statement for one month: every item sold, our commission, their share, and payouts.
    case 'brand_statement':
        require_perm('products');
        require_perm('revenue');
        $id = (int) ($_GET['id'] ?? 0);
        $brand = brand_get($id);
        if (!$brand) fail('Brand not found.', 404);
        $month = preg_match('/^\d{4}-\d{2}$/', $_GET['month'] ?? '') ? $_GET['month'] : gmdate('Y-m');
        $lines = brand_lines($id, $month);
        $pay = db()->prepare("SELECT p.id, p.amount, p.paid_on, p.note, u.name AS by_name FROM brand_payouts p LEFT JOIN users u ON u.id = p.created_by WHERE p.brand_id = ? ORDER BY p.paid_on DESC, p.id DESC");
        $pay->execute([$id]);
        json_out(['brand' => brand_row($brand, true), 'month' => $month, 'lines' => $lines, 'totals' => brand_totals($lines), 'balance' => brand_balance($id),
            'payouts' => array_map(function ($r) { return ['id' => (int) $r['id'], 'amount' => (float) $r['amount'], 'on' => $r['paid_on'], 'note' => (string) $r['note'], 'by' => (string) $r['by_name']]; }, $pay->fetchAll())]);

    case 'brand_payout':
        $u = require_perm('products');
        require_perm('revenue');
        $b = body();
        $brand = brand_get((int) ($b['brand_id'] ?? 0));
        if (!$brand) fail('Brand not found.', 404);
        $amount = round((float) ($b['amount'] ?? 0), 2);
        if ($amount == 0.0) fail('Enter the amount you paid the brand.');
        $on = preg_match('/^\d{4}-\d{2}-\d{2}$/', $b['on'] ?? '') ? $b['on'] : gmdate('Y-m-d');
        db()->prepare('INSERT INTO brand_payouts (brand_id, amount, paid_on, note, created_by) VALUES (?, ?, ?, ?, ?)')->execute([$brand['id'], $amount, $on, str_in($b['note'] ?? '', 200), $u['id']]);
        log_activity($u, 'Paid brand', $brand['name'] . ' · EGP ' . number_format($amount, 2));
        json_out(['ok' => true]);

    case 'brand_payout_delete':
        $u = require_perm('products');
        require_perm('revenue');
        $st = db()->prepare('SELECT p.amount, b.name FROM brand_payouts p JOIN brands b ON b.id = p.brand_id WHERE p.id = ?');
        $st->execute([(int) (body()['id'] ?? 0)]);
        $r = $st->fetch();
        if (!$r) fail('Payment not found.', 404);
        db()->prepare('DELETE FROM brand_payouts WHERE id = ?')->execute([(int) body()['id']]);
        log_activity($u, 'Deleted a brand payment', $r['name'] . ' · EGP ' . number_format((float) $r['amount'], 2));
        json_out(['ok' => true]);

    case 'promos':
        require_perm('products');
        $rows = db()->query("SELECT p.*, (SELECT COUNT(*) FROM orders o WHERE o.promo = p.code COLLATE NOCASE AND o.status != 'Cancelled') AS uses,
            (SELECT COALESCE(SUM(o.discount), 0) FROM orders o WHERE o.promo = p.code COLLATE NOCASE AND o.status != 'Cancelled') AS given,
            (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.promo = p.code COLLATE NOCASE AND o.status NOT IN ('Cancelled','Returned')) AS sales
            FROM promos p ORDER BY p.active DESC, p.id DESC")->fetchAll();
        json_out(['promos' => array_map(function ($p) {
            return ['id' => (int) $p['id'], 'code' => $p['code'], 'kind' => $p['kind'], 'value' => (float) $p['value'], 'minOrder' => (float) $p['min_order'],
                'maxUses' => $p['max_uses'] === null ? null : (int) $p['max_uses'], 'startsAt' => $p['starts_at'], 'expiresAt' => $p['expires_at'],
                'active' => (bool) $p['active'], 'note' => $p['note'], 'uses' => (int) $p['uses'], 'given' => (float) $p['given'], 'sales' => (float) $p['sales'],
                'label' => promo_label($p), 'createdAt' => $p['created_at']];
        }, $rows)]);

    case 'promo_save':
        $u = require_perm('products');
        $b = body();
        $id = (int) ($b['id'] ?? 0);
        $code = preg_replace('/[^A-Za-z0-9_-]/', '', (string) ($b['code'] ?? '')); // kept exactly as typed: codes are case-sensitive
        if (strlen($code) < 3 || strlen($code) > 30) fail('Use 3 to 30 letters or numbers for the code (no spaces).');
        $kind = in_array($b['kind'] ?? '', ['fixed', 'shipping'], true) ? $b['kind'] : 'percent';
        $value = $kind === 'shipping' ? 0 : round((float) ($b['value'] ?? 0), 2);
        if ($value <= 0 && $kind !== 'shipping') fail('Enter the discount amount.');
        if ($kind === 'percent' && $value > 100) fail('A percentage can be at most 100.');
        $date = function ($v) { $v = trim((string) $v); return preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : null; };
        $max = ($b['max_uses'] ?? '') === '' || $b['max_uses'] === null ? null : max(1, (int) $b['max_uses']);
        $vals = [$code, $kind, $value, max(0, round((float) ($b['min_order'] ?? 0), 2)), $max, $date($b['starts_at'] ?? ''), $date($b['expires_at'] ?? ''),
            empty($b['active']) ? 0 : 1, str_in($b['note'] ?? '', 200)];
        $dupe = db()->prepare('SELECT id FROM promos WHERE code = ? COLLATE NOCASE AND id != ?');
        $dupe->execute([$code, $id]);
        if ($dupe->fetchColumn()) fail('There is already a promo code called ' . $code . ' (in capitals or small letters). Pick a different code.');
        if ($id) {
            db()->prepare('UPDATE promos SET code = ?, kind = ?, value = ?, min_order = ?, max_uses = ?, starts_at = ?, expires_at = ?, active = ?, note = ? WHERE id = ?')
                ->execute(array_merge($vals, [$id]));
            log_activity($u, 'Updated promo code', $code);
        } else {
            db()->prepare('INSERT INTO promos (code, kind, value, min_order, max_uses, starts_at, expires_at, active, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute(array_merge($vals, [$u['id']]));
            log_activity($u, 'Created promo code', $code);
        }
        json_out(['ok' => true]);

    case 'promo_delete':
        $u = require_perm('products');
        $st = db()->prepare('SELECT code FROM promos WHERE id = ?');
        $st->execute([(int) (body()['id'] ?? 0)]);
        $code = $st->fetchColumn();
        if ($code === false) fail('Promo code not found.', 404);
        if (promo_uses($code) > 0) fail('This code was used on orders, so it is kept for the records. Switch it off instead.');
        db()->prepare('DELETE FROM promos WHERE code = ?')->execute([$code]);
        log_activity($u, 'Deleted promo code', $code);
        json_out(['ok' => true]);

    case 'quote_doc':
        $u = require_perm('sell');
        $q = load_quote((int) ($_GET['id'] ?? 0));
        assert_quote_access($u, $q);
        json_out(['quote' => quote_out($q), 'me' => $u['name']]);

    // Terms and notes edited on the quote page are kept with the quote.
    case 'quote_text':
        $u = require_perm('sell');
        $b = body();
        $q = load_quote((int) ($b['id'] ?? 0));
        assert_quote_access($u, $q);
        db()->prepare("UPDATE quotes SET terms = ?, design_notes = ?, updated_at = datetime('now') WHERE id = ?")
            ->execute([str_in($b['terms'] ?? '', 2000), str_in($b['notes'] ?? '', 2000), (int) $q['id']]);
        json_out(['ok' => true]);

    // ---------- quick search ----------

    case 'search':
        $u = require_perm('dashboard');
        $q = trim(str_in($_GET['q'] ?? '', 60));
        if (mb_strlen($q) < 2) json_out(['results' => []]);
        $like = '%' . $q . '%';
        $digits = preg_replace('/\D/', '', $q);
        $out = [];
        if (in_array('orders', $u['perms'], true)) {
            $own = in_array('own_orders', $u['perms'], true) ? ' AND rep_id = ' . (int) $u['id'] : '';
            $num = preg_match('/^(wts-?)?(\d{4,})$/i', $q, $m) ? (int) $m[2] - 1000 : 0;
            $st = db()->prepare("SELECT id, customer, phone, total, status, business_name FROM orders WHERE (id = ? OR customer LIKE ? OR email LIKE ? OR business_name LIKE ?" .
                (strlen($digits) >= 4 ? ' OR replace(replace(phone, \' \', \'\'), \'-\', \'\') LIKE ?' : '') . ")$own ORDER BY id DESC LIMIT 8");
            $args = [$num, $like, $like, $like];
            if (strlen($digits) >= 4) $args[] = '%' . $digits . '%';
            $st->execute($args);
            foreach ($st->fetchAll() as $r) $out[] = ['type' => 'order', 'id' => (int) $r['id'], 'title' => order_number((int) $r['id']) . ' · ' . $r['customer'],
                'sub' => trim(($r['business_name'] ? $r['business_name'] . ' · ' : '') . $r['phone'] . ' · EGP ' . number_format((float) $r['total']) . ' · ' . $r['status'])];
        }
        if (in_array('leads', $u['perms'], true)) {
            $st = db()->prepare('SELECT id, name, contact, status, source FROM leads WHERE name LIKE ? OR contact LIKE ? OR notes LIKE ?' .
                (strlen($digits) >= 4 ? ' OR phone_key LIKE ?' : '') . ' ORDER BY id DESC LIMIT 6');
            $args = [$like, $like, $like];
            if (strlen($digits) >= 4) $args[] = '%' . substr($digits, -9) . '%';
            $st->execute($args);
            foreach ($st->fetchAll() as $r) $out[] = ['type' => 'lead', 'id' => (int) $r['id'], 'title' => $r['name'], 'sub' => $r['contact'] . ' · ' . $r['status'] . ' · ' . $r['source']];
        }
        if (in_array('products', $u['perms'], true)) {
            $st = db()->prepare('SELECT id, name, sku, price FROM products WHERE name LIKE ? OR sku LIKE ? OR id LIKE ? ORDER BY sort LIMIT 5');
            $st->execute([$like, $like, $like]);
            foreach ($st->fetchAll() as $r) $out[] = ['type' => 'product', 'id' => $r['id'], 'title' => $r['name'], 'sub' => $r['sku'] . ' · EGP ' . number_format((float) $r['price'])];
        }
        json_out(['results' => $out]);

    // ---------- online payments check (owner) ----------
    // Reports what api/config.local.php contains for Paymob without revealing any secret.
    case 'paymob_status':
        require_perm('backups');
        $file = __DIR__ . '/config.local.php';
        if (function_exists('opcache_invalidate')) @opcache_invalidate($file, true);
        $raw = is_file($file) ? (function ($f) { return require $f; })($file) : null;
        $kind = function ($v, $prefix) {
            $v = (string) $v;
            if ($v === '') return 'missing';
            if (strpos($v, $prefix . 'test_') === 0) return 'test';
            if (strpos($v, $prefix . 'live_') === 0) return 'live';
            return 'unrecognised';
        };
        $p = is_array($raw) && isset($raw['paymob']) && is_array($raw['paymob']) ? $raw['paymob'] : null;
        // Where did the paymob settings end up? (names only)
        $nestedIn = null;
        if (is_array($raw) && !$p) foreach ($raw as $k => $v) if (is_array($v) && isset($v['paymob'])) $nestedIn = $k;
        $out = [
            'fileFound' => is_file($file), 'fileReturnsArray' => is_array($raw),
            'topLevel' => is_array($raw) ? array_keys($raw) : [], 'paymobBlock' => (bool) $p, 'nestedIn' => $nestedIn,
            'secretKey' => $p ? $kind($p['secret_key'] ?? '', 'egy_sk_') : 'missing',
            'publicKey' => $p ? $kind($p['public_key'] ?? '', 'egy_pk_') : 'missing',
            'hmac' => $p && trim((string) ($p['hmac_secret'] ?? '')) !== '' ? 'set' : 'missing',
            'cardId' => $p ? (int) ($p['card_integration_id'] ?? 0) : 0, 'walletId' => $p ? (int) ($p['wallet_integration_id'] ?? 0) : 0,
            'unknownNames' => $p ? array_values(array_diff(array_keys($p), ['secret_key', 'public_key', 'hmac_secret', 'card_integration_id', 'wallet_integration_id', 'base_url'])) : [],
            'methodsOffered' => array_keys(paymob_methods()), 'phpLoaded' => (bool) paymob_methods(),
        ];
        // Optional: ask Paymob to create a throw-away EGP 1 intention (nothing is charged).
        if (($_GET['test'] ?? '') === '1' && paymob_methods()) {
            try {
                $res = paymob_request('POST', '/v1/intention/', ['amount' => 100, 'currency' => 'EGP', 'payment_methods' => array_values(paymob_methods()),
                    'items' => [['name' => 'Connection test', 'amount' => 100, 'quantity' => 1]],
                    'billing_data' => ['first_name' => 'Test', 'last_name' => 'Test', 'email' => 'test@wheretospot.com', 'phone_number' => '01000000000',
                        'street' => 'NA', 'building' => 'NA', 'floor' => 'NA', 'apartment' => 'NA', 'city' => 'Cairo', 'state' => 'Cairo', 'country' => 'EG']]);
                $out['connection'] = !empty($res['client_secret']) ? 'ok' : 'unexpected reply';
                // What Paymob says each integration id is (catches a card id saved as the wallet id, or test ids with live keys).
                $out['integrations'] = array_map(function ($m) {
                    return ['id' => (int) ($m['integration_id'] ?? 0), 'name' => (string) ($m['name'] ?? ''), 'type' => (string) ($m['method_type'] ?? ''),
                        'live' => isset($m['live']) ? (bool) $m['live'] : null];
                }, array_values(array_filter((array) ($res['payment_methods'] ?? []), 'is_array')));
            } catch (Throwable $e) {
                $out['connection'] = 'failed: ' . ($GLOBALS['paymob_last_error'] ?? $e->getMessage());
            }
        }
        json_out($out);

    // ---------- backups (owner) ----------

    case 'backups':
        require_perm('backups');
        json_out(['backups' => backup_list(), 'keep' => BACKUP_KEEP]);

    case 'backup_now':
        $u = require_perm('backups');
        $file = make_backup();
        log_activity($u, 'Backed up the database', $file);
        json_out(['ok' => true, 'file' => $file, 'backups' => backup_list()]);

    case 'backup_download':
        $u = require_perm('backups');
        $name = (string) ($_GET['file'] ?? '');
        if (!preg_match('/^shop-\d{4}-\d{2}-\d{2}\.sqlite$/', $name) || !is_file($path = backup_dir() . '/' . $name)) fail('Backup not found', 404);
        log_activity($u, 'Downloaded a backup', $name);
        header('Content-Type: application/vnd.sqlite3');
        header('Content-Disposition: attachment; filename="wheretospot-' . $name . '"');
        header('Content-Length: ' . filesize($path));
        header('Cache-Control: no-store');
        readfile($path);
        exit;

    case 'lead_delete':
        $u = require_perm('leads');
        db()->prepare('DELETE FROM leads WHERE id = ?')->execute([(int) (body()['id'] ?? 0)]);
        log_activity($u, 'Deleted lead');
        json_out(['ok' => true]);

    // ---------- team ----------

    case 'team':
        require_perm('dashboard');
        // Everyone can see names (for assigning leads); only owners get the full list.
        $u = current_user();
        $cols = in_array('team', $u['perms'], true) ? 'id, name, email, phone, role, ref_code, active, notify, created_at, last_login' : 'id, name, role';
        json_out(['team' => db()->query("SELECT $cols FROM users ORDER BY active DESC, name")->fetchAll()]);

    case 'team_save':
        $u = require_perm('team');
        $b = body();
        $id = (int) ($b['id'] ?? 0);
        if ($id === (int) $u['id'] && (($b['role'] ?? 'owner') !== 'owner' || empty($b['active']))) {
            fail('You cannot remove your own owner access.');
        }
        $newId = save_user($b, $id ?: null);
        log_activity($u, $id ? 'Updated team member' : 'Added team member', str_in($b['name'] ?? '', 120));
        json_out(['id' => $newId]);

    case 'mail_test':
        $u = require_perm('team');
        $st = db()->prepare('SELECT notify FROM users WHERE id = ?');
        $st->execute([$u['id']]);
        $subscribed = (bool) $st->fetchColumn();
        $ok = send_mail([$u['email']], 'Test alert from your shop',
            email_shell('Email alerts are working', '<p>New orders and enquiries will arrive like this. If this landed in spam, mark it “Not spam” and see the setup notes about SMTP/SPF.</p>'),
            "Email alerts are working.\n");
        $via = cfg('smtp') ? 'your mailbox (SMTP)' : 'the server’s built-in mail';
        if (!$ok) fail('Could not send the test email via ' . $via . '. Check the SMTP settings in api/config.local.php.', 502);
        json_out(['ok' => true, 'to' => $u['email'], 'via' => $via, 'subscribed' => $subscribed]);

    case 'activity':
        require_perm('activity');
        json_out(['activity' => db()->query('SELECT * FROM activity ORDER BY id DESC LIMIT 300')->fetchAll()]);

    default:
        fail('Not found', 404);
    }
} catch (ShopError $e) {
    fail($e->getMessage(), 502);
} catch (Throwable $e) {
    tx_rollback();
    error_log('[shop admin] ' . $e->getMessage());
    fail('Something went wrong. Please try again.', 500);
}

// ---------- helpers ----------

function load_quote(int $id): array
{
    $st = db()->prepare('SELECT q.*, u.name AS rep_name FROM quotes q LEFT JOIN users u ON u.id = q.rep_id WHERE q.id = ?');
    $st->execute([$id]);
    $q = $st->fetch();
    if (!$q) fail('Quote not found.', 404);
    return $q;
}

function assert_quote_access(array $u, array $q): void
{
    if (in_array('own_orders', $u['perms'], true) && (int) $q['rep_id'] !== (int) $u['id']) fail('Quote not found.', 404);
}

function quote_out(array $q): array
{
    $today = (new DateTime('now', new DateTimeZone('Africa/Cairo')))->format('Y-m-d');
    $expired = in_array($q['status'], ['Draft', 'Sent'], true) && $q['valid_until'] && $q['valid_until'] < $today;
    return [
        'id' => (int) $q['id'], 'number' => quote_number((int) $q['id']), 'leadId' => $q['lead_id'] === null ? null : (int) $q['lead_id'],
        'orderId' => $q['order_id'] === null ? null : (int) $q['order_id'], 'orderNumber' => $q['order_id'] ? order_number((int) $q['order_id']) : null,
        'customer' => $q['customer'], 'phone' => $q['phone'], 'email' => $q['email'], 'businessName' => $q['business_name'], 'reviewLink' => $q['review_link'],
        'links' => $q['links'], 'designNotes' => $q['design_notes'], 'address' => $q['address'], 'city' => $q['city'], 'district' => $q['district'],
        'cityId' => $q['city_id'], 'districtId' => $q['district_id'],
        'itemsIn' => json_decode($q['items_in'], true) ?: [], 'items' => json_decode($q['items'], true) ?: [],
        'subtotal' => (float) $q['subtotal'], 'discount' => (float) $q['discount'], 'shipping' => (float) $q['shipping'], 'total' => (float) $q['total'],
        'status' => $expired ? 'Expired' : $q['status'], 'savedStatus' => $q['status'], 'validUntil' => $q['valid_until'], 'terms' => $q['terms'], 'notes' => $q['notes'],
        'rep' => $q['rep_name'] ?? null, 'repId' => $q['rep_id'] === null ? null : (int) $q['rep_id'], 'sentAt' => $q['sent_at'], 'createdAt' => $q['created_at'],
    ];
}

function load_order(int $id): array
{
    $st = db()->prepare('SELECT o.*, u.name AS rep_name, c.name AS created_by_name FROM orders o LEFT JOIN users u ON u.id = o.rep_id LEFT JOIN users c ON c.id = o.created_by WHERE o.id = ?');
    $st->execute([$id]);
    $o = $st->fetch();
    if (!$o) fail('Order not found.', 404);
    return $o;
}

function order_payments(int $orderId): array
{
    $st = db()->prepare('SELECT p.id, p.amount, p.method, p.note, p.created_at, u.name AS by_name FROM payments p LEFT JOIN users u ON u.id = p.created_by WHERE p.order_id = ? ORDER BY p.id');
    $st->execute([$orderId]);
    return array_map(function ($p) {
        return ['id' => (int) $p['id'], 'amount' => (float) $p['amount'], 'method' => $p['method'], 'methodLabel' => PAYMENT_KINDS[$p['method']] ?? $p['method'],
            'note' => $p['note'], 'at' => $p['created_at'], 'by' => $p['by_name']];
    }, $st->fetchAll());
}

function order_accessible(array $u, array $o): bool
{
    return !in_array('own_orders', $u['perms'], true) || (int) $o['rep_id'] === (int) $u['id'];
}

function assert_order_access(array $u, array $o): void
{
    if (!order_accessible($u, $o)) fail('Order not found.', 404);
}

function order_out(array $o): array
{
    $paid = array_key_exists('paid', $o) ? round((float) $o['paid'], 2) : order_paid((int) $o['id']);
    $closed = in_array($o['status'], ['Cancelled', 'Returned'], true);
    return [
        'paid' => $paid, 'due' => $closed ? 0 : max(0, round((float) $o['total'] - $paid, 2)),
        'id' => (int) $o['id'], 'number' => order_number((int) $o['id']), 'customer' => $o['customer'], 'email' => $o['email'],
        'phone' => $o['phone'], 'address' => $o['address'], 'city' => $o['city'], 'items' => json_decode($o['items'], true) ?: [],
        'subtotal' => (float) $o['subtotal'], 'discount' => (float) $o['discount'], 'shipping' => (float) $o['shipping'],
        'total' => (float) $o['total'], 'promo' => $o['promo'], 'payment' => $o['payment'], 'status' => $o['status'],
        'notes' => $o['notes'], 'prepNotes' => (string) ($o['prep_notes'] ?? ''), 'rep' => $o['rep_name'] ?? null, 'repId' => $o['rep_id'] === null ? null : (int) $o['rep_id'], 'createdAt' => $o['created_at'],
        'businessName' => $o['business_name'] ?? '', 'reviewLink' => $o['review_link'] ?? '', 'links' => $o['links'] ?? '', 'designNotes' => $o['design_notes'] ?? '',
        'files' => json_decode((string) ($o['files'] ?? '[]'), true) ?: [],
        'source' => $o['source'] ?? 'Website', 'createdBy' => $o['created_by_name'] ?? null, 'paymentLabel' => PAYMENT_METHODS[$o['payment']] ?? $o['payment'],
        'cityId' => $o['city_id'], 'districtId' => $o['district_id'], 'district' => $o['district'],
        'tracking' => $o['tracking_number'], 'bostaState' => $o['bosta_state'] === null ? null : (int) $o['bosta_state'],
        'bostaLabel' => bosta_state_label($o['bosta_state'] === null ? null : (int) $o['bosta_state']), 'bostaNote' => $o['bosta_note'],
        'bostaCod' => $o['bosta_cod'] === null ? null : (float) $o['bosta_cod'], 'bostaUpdatedAt' => $o['bosta_updated_at'],
    ];
}

function save_user(array $b, ?int $id): int
{
    $pdo = db();
    $name = str_in($b['name'] ?? '', 120);
    $email = str_in($b['email'] ?? '', 160);
    $role = array_key_exists($b['role'] ?? '', ROLES) ? $b['role'] : 'staff';
    $ref = strtoupper(str_in($b['ref_code'] ?? '', 20));
    $ref = $ref === '' ? null : preg_replace('/[^A-Z0-9-]/', '', $ref);
    $pw = (string) ($b['password'] ?? '');
    if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Enter a name and a valid email.');
    if ((!$id || $pw !== '') && strlen($pw) < 8) fail('Password must be at least 8 characters.');
    $dupe = $pdo->prepare('SELECT id FROM users WHERE (email = ? OR (ref_code IS NOT NULL AND ref_code = ?)) AND id != ?');
    $dupe->execute([$email, $ref, $id ?: 0]);
    if ($dupe->fetchColumn()) fail('That email or referral code is already used by another team member.');
    if ($id) {
        $pdo->prepare('UPDATE users SET name = ?, email = ?, phone = ?, role = ?, ref_code = ?, active = ?, notify = ? WHERE id = ?')
            ->execute([$name, $email, str_in($b['phone'] ?? '', 40), $role, $ref, empty($b['active']) ? 0 : 1, empty($b['notify']) ? 0 : 1, $id]);
        if ($pw !== '') $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($pw, PASSWORD_DEFAULT), $id]);
        $owners = (int) $pdo->query("SELECT COUNT(*) FROM users WHERE role = 'owner' AND active = 1")->fetchColumn();
        if ($owners === 0) fail('At least one active owner is required.');
        return $id;
    }
    $pdo->prepare('INSERT INTO users (name, email, phone, password_hash, role, ref_code, active, notify) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$name, $email, str_in($b['phone'] ?? '', 40), password_hash($pw, PASSWORD_DEFAULT), $role, $ref, isset($b['active']) && !$b['active'] ? 0 : 1, empty($b['notify']) ? 0 : 1]);
    return (int) $pdo->lastInsertId();
}

// A lead's name / phone / email was corrected: copy it to the orders of that same customer — the ones
// with the old phone or email, and the orders the lead mentions (WTS-1023). Returns the order numbers
// changed, and those that already have a Bosta shipment (the courier keeps the details it was given).
function sync_lead_orders(array $before, string $name, string $contact): array
{
    $oldPhone = phone_key((string) $before['contact']);
    $oldEmail = email_key((string) $before['contact']);
    $newPhone = preg_match('/\+?[\d٠-٩][\d٠-٩\s-]{6,}[\d٠-٩]/u', preg_replace('/[\w.+-]+@[\w-]+\.[\w.]+/u', ' ', $contact), $m) ? trim($m[0]) : '';
    $newEmail = email_key($contact) ?? '';
    $ids = [];
    if (preg_match_all('/WTS-(\d+)/', $before['source'] . ' ' . $before['notes'], $mm)) foreach ($mm[1] as $n) $ids[(int) $n - 1000] = true;
    $done = []; $shipped = [];
    $upd = db()->prepare("UPDATE orders SET customer = ?, phone = ?, email = ?, updated_at = datetime('now') WHERE id = ?");
    foreach (db()->query("SELECT id, customer, phone, email, tracking_number, status FROM orders WHERE status != 'Awaiting payment'") as $o) {
        $byPhone = $oldPhone && phone_key((string) $o['phone']) === $oldPhone;
        $byEmail = $oldEmail && email_key((string) $o['email']) === $oldEmail;
        if (!$byPhone && !$byEmail && !isset($ids[(int) $o['id']])) continue;
        $phone = $newPhone !== '' && ($byPhone || !$byEmail) ? $newPhone : $o['phone'];
        $email = $newEmail !== '' && ($byEmail || (string) $o['email'] === '') ? $newEmail : $o['email'];
        $cust = $before['name'] !== $name ? $name : $o['customer'];
        if ($phone === $o['phone'] && $email === $o['email'] && $cust === $o['customer']) continue;
        $upd->execute([$cust, $phone, $email, $o['id']]);
        $done[] = order_number((int) $o['id']);
        if ($o['tracking_number'] && !in_array($o['status'], ['Delivered', 'Cancelled', 'Returned'], true)) $shipped[] = order_number((int) $o['id']);
    }
    return ['orders' => $done, 'shipped' => $shipped];
}

function store_image(array $f, string $pid): string
{
    if ($f['size'] > cfg('max_upload_bytes')) fail('Photo is too large (max ' . (cfg('max_upload_bytes') >> 20) . ' MB).');
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
    $exts = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    if (!isset($exts[$mime]) || !@getimagesize($f['tmp_name'])) fail('Only JPG, PNG or WebP photos are allowed.');
    $dir = cfg('upload_dir');
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $safe = preg_replace('/[^a-z0-9]/', '', strtolower($pid)) ?: 'p';
    $name = $safe . '-' . bin2hex(random_bytes(6)) . '.' . $exts[$mime];
    $dest = $dir . '/' . $name;
    if (!resize_image($f['tmp_name'], $dest, $mime, 1600) && !move_uploaded_file($f['tmp_name'], $dest)) {
        fail('Could not save the photo on the server.', 500);
    }
    @chmod($dest, 0644);
    return cfg('upload_url') . '/' . $name;
}

// Shrink big photos so the shop loads fast. Returns false when GD can't handle it (the original is kept).
function resize_image(string $src, string $dest, string $mime, int $max): bool
{
    if (!function_exists('imagecreatetruecolor')) return false;
    [$w, $h] = getimagesize($src);
    if ($w <= $max && $h <= $max) return false;
    $load = ['image/jpeg' => 'imagecreatefromjpeg', 'image/png' => 'imagecreatefrompng', 'image/webp' => 'imagecreatefromwebp'][$mime];
    if (!function_exists($load) || !($im = @$load($src))) return false;
    $scale = $max / max($w, $h);
    $nw = (int) round($w * $scale);
    $nh = (int) round($h * $scale);
    $out = imagecreatetruecolor($nw, $nh);
    imagealphablending($out, false);
    imagesavealpha($out, true);
    imagecopyresampled($out, $im, 0, 0, 0, 0, $nw, $nh, $w, $h);
    $ok = $mime === 'image/png' ? imagepng($out, $dest, 6) : ($mime === 'image/webp' ? imagewebp($out, $dest, 82) : imagejpeg($out, $dest, 82));
    return $ok;
}

// Only files we uploaded are deleted; the original catalog photos in images/ are left alone.
function delete_upload(string $path): void
{
    $prefix = cfg('upload_url') . '/';
    if (strpos($path, $prefix) !== 0) return;
    $file = cfg('upload_dir') . '/' . basename($path);
    if (is_file($file)) @unlink($file);
}

function csv_out(string $filename, array $rows): void
{
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF"); // so Excel reads Arabic names correctly
    if ($rows) {
        fputcsv($out, array_keys($rows[0]));
        foreach ($rows as $r) {
            fputcsv($out, array_map(function ($v) {
                if (is_array($v)) return implode('; ', array_map(function ($i) { return is_array($i) ? ($i['qty'] ?? 1) . '× ' . ($i['name'] ?? '') : $i; }, $v));
                return $v;
            }, $r));
        }
    }
    fclose($out);
    exit;
}

// ---------- WhatsApp helpers ----------

function wa_chat_row(int $id): array
{
    $st = db()->prepare('SELECT c.*, u.name AS agent_name, l.name AS lead_name, l.status AS lead_status FROM wa_chats c LEFT JOIN users u ON u.id = c.assigned_to LEFT JOIN leads l ON l.id = c.lead_id WHERE c.id = ?');
    $st->execute([$id]);
    $c = $st->fetch();
    if (!$c) fail('Chat not found.', 404);
    return $c;
}

// A chat this person may open: managers any; others their own and unassigned ones.
function wa_chat_for_user(array $u, int $id): array
{
    $c = wa_chat_row($id);
    if (!in_array('whatsapp_all', $u['perms'], true) && $c['assigned_to'] && (int) $c['assigned_to'] !== (int) $u['id']) fail('Chat not found.', 404);
    return $c;
}

// Replying to an unassigned chat makes it yours.
function wa_claim(array $chat, array $u): void
{
    if (!$chat['assigned_to']) wa_assign((int) $chat['id'], (int) $u['id']);
}

function wa_message_row(int $id): array
{
    $st = db()->prepare('SELECT m.*, u.name AS user_name FROM wa_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?');
    $st->execute([$id]);
    $m = $st->fetch();
    if (!$m) fail('Message not found.', 404);
    return $m;
}

function wa_chat_out(array $c): array
{
    return ['id' => (int) $c['id'], 'waId' => $c['wa_id'], 'phone' => wa_local_phone($c['wa_id']), 'name' => $c['lead_name'] ?: $c['name'] ?: wa_local_phone($c['wa_id']),
        'profileName' => $c['name'], 'leadId' => $c['lead_id'] === null ? null : (int) $c['lead_id'], 'leadStatus' => $c['lead_status'] ?? null,
        'assignedTo' => $c['assigned_to'] === null ? null : (int) $c['assigned_to'], 'agent' => $c['agent_name'] ?? null, 'status' => $c['status'],
        'unread' => (int) $c['unread'], 'lastAt' => $c['last_at'], 'lastText' => $c['last_text'], 'lastDir' => $c['last_dir'], 'waitingSince' => $c['waiting_since'],
        'lastInAt' => $c['last_in_at'], 'windowOpen' => wa_window_open($c), 'windowEnds' => $c['last_in_at'] ? gmdate('Y-m-d H:i:s', strtotime($c['last_in_at'] . ' UTC') + 86400) : null,
        'ad' => $c['ad_id'] || $c['ad_headline'] ? ['id' => $c['ad_id'], 'headline' => $c['ad_headline'], 'url' => $c['ad_url'], 'body' => $c['ad_body']] : null, 'createdAt' => $c['created_at']];
}

function wa_message_out(array $m): array
{
    $meta = $m['meta'] ? (json_decode($m['meta'], true) ?: []) : [];
    return ['id' => (int) $m['id'], 'dir' => $m['dir'], 'kind' => $m['kind'], 'body' => $m['body'], 'status' => $m['status'], 'error' => $m['error'],
        'media' => $m['media_path'] !== '' ? ['mime' => $m['media_mime'], 'name' => $m['media_name'], 'size' => (int) $m['media_size']] : null,
        'by' => $m['user_name'] ?? null, 'at' => $m['created_at'], 'ad' => isset($meta['referral']) ? ['headline' => $meta['referral']['headline'] ?? '', 'url' => $meta['referral']['source_url'] ?? ''] : null];
}

