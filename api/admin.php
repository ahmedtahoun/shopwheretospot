<?php
// Team dashboard API. Every action except session/login/setup needs a signed-in user
// with the matching permission (see ROLES in bootstrap.php) and, for writes, the CSRF token.

require __DIR__ . '/bootstrap.php';

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

try {
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
        require_perm('dashboard');
        $days = max(7, min(365, (int) ($_GET['days'] ?? 30)));
        $pdo = db();
        $since = gmdate('Y-m-d', time() - ($days - 1) * 86400);
        $valid = "status NOT IN ('Cancelled','Returned')";
        $st = $pdo->prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) revenue FROM orders WHERE $valid AND date(created_at) >= ?");
        $st->execute([$since]);
        $k = $st->fetch();
        $st = $pdo->prepare("SELECT date(created_at) d, COUNT(*) n, SUM(total) revenue FROM orders WHERE $valid AND date(created_at) >= ? GROUP BY d");
        $st->execute([$since]);
        $byDay = [];
        foreach ($st as $r) $byDay[$r['d']] = $r;
        $series = [];
        for ($i = $days - 1; $i >= 0; $i--) {
            $d = gmdate('Y-m-d', time() - $i * 86400);
            $series[] = ['date' => $d, 'orders' => (int) ($byDay[$d]['n'] ?? 0), 'revenue' => (float) ($byDay[$d]['revenue'] ?? 0)];
        }
        $status = $pdo->query('SELECT status, COUNT(*) n FROM orders GROUP BY status')->fetchAll(PDO::FETCH_KEY_PAIR);
        $top = [];
        $st = $pdo->prepare("SELECT items FROM orders WHERE $valid AND date(created_at) >= ?");
        $st->execute([$since]);
        foreach ($st as $o) {
            foreach (json_decode($o['items'], true) ?: [] as $it) {
                $key = $it['id'];
                if (!isset($top[$key])) $top[$key] = ['name' => $it['name'], 'qty' => 0, 'revenue' => 0];
                $top[$key]['qty'] += $it['qty'];
                $top[$key]['revenue'] += $it['qty'] * $it['price'];
            }
        }
        usort($top, function ($a, $b) { return $b['revenue'] <=> $a['revenue']; });
        $lowStock = $pdo->query("SELECT id, name, stock FROM products WHERE status = 'Active' AND cat != 'services' AND stock <= 5 ORDER BY stock")->fetchAll();
        $reps = $pdo->prepare("SELECT u.name, COUNT(o.id) n, COALESCE(SUM(o.total),0) revenue FROM orders o JOIN users u ON u.id = o.rep_id WHERE o.$valid AND date(o.created_at) >= ? GROUP BY u.id ORDER BY revenue DESC");
        $reps->execute([$since]);
        $recent = array_map('order_out', $pdo->query('SELECT * FROM orders ORDER BY id DESC LIMIT 6')->fetchAll());
        json_out([
            'days' => $days,
            'kpi' => [
                'revenue' => (float) $k['revenue'], 'orders' => (int) $k['n'],
                'aov' => $k['n'] ? round($k['revenue'] / $k['n']) : 0,
                'pending' => (int) ($status['Pending'] ?? 0),
                'newLeads' => (int) $pdo->query("SELECT COUNT(*) FROM leads WHERE status = 'New'")->fetchColumn(),
                'products' => (int) $pdo->query("SELECT COUNT(*) FROM products WHERE status = 'Active'")->fetchColumn(),
            ],
            'series' => $series, 'statusCounts' => $status, 'topProducts' => array_slice($top, 0, 5),
            'lowStock' => $lowStock, 'reps' => $reps->fetchAll(), 'recentOrders' => $recent,
        ]);

    // ---------- products & categories ----------

    case 'products':
        require_perm('products');
        $cats = db()->query('SELECT key, label, descr, sort, (SELECT COUNT(*) FROM products p WHERE p.cat = c.key) AS count FROM categories c ORDER BY sort, label')->fetchAll();
        json_out(['products' => load_products(false), 'categories' => $cats]);

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
        $price = (float) ($b['price'] ?? 0);
        if ($price <= 0) fail('Price must be more than 0 EGP.');
        $features = array_values(array_filter(array_map(function ($f) { return str_in($f, 160); }, (array) ($b['features'] ?? []))));
        $vals = [
            ':id' => $id, ':sku' => str_in($b['sku'] ?? '', 40), ':name' => $name, ':cat' => $cat,
            ':vendor' => str_in($b['vendor'] ?? '', 80), ':price' => $price, ':cost' => max(0, (float) ($b['cost'] ?? 0)),
            ':stock' => max(0, (int) ($b['stock'] ?? 0)), ':discount_pct' => max(0, min(90, (float) ($b['discountPct'] ?? 0))),
            ':label' => str_in($b['label'] ?? '', 30), ':status' => in_array($b['status'] ?? '', ['Active', 'Draft', 'Archived'], true) ? $b['status'] : 'Draft',
            ':sub' => str_in($b['sub'] ?? '', 160), ':descr' => str_in($b['desc'] ?? '', 4000),
            ':features' => json_encode($features, JSON_UNESCAPED_UNICODE), ':period' => $cat === 'services' ? 'month' : '',
        ];
        if ($isNew) {
            $vals[':sort'] = (int) $pdo->query('SELECT COALESCE(MAX(sort),0)+1 FROM products')->fetchColumn();
            $pdo->prepare('INSERT INTO products (id, sku, name, cat, vendor, price, cost, stock, discount_pct, label, status, sub, descr, features, period, sort)
                VALUES (:id, :sku, :name, :cat, :vendor, :price, :cost, :stock, :discount_pct, :label, :status, :sub, :descr, :features, :period, :sort)')->execute($vals);
        } else {
            $st = $pdo->prepare("UPDATE products SET sku=:sku, name=:name, cat=:cat, vendor=:vendor, price=:price, cost=:cost, stock=:stock, discount_pct=:discount_pct,
                label=:label, status=:status, sub=:sub, descr=:descr, features=:features, period=:period, updated_at=datetime('now') WHERE id=:id");
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
            db()->prepare('INSERT INTO categories (key, label, descr, sort) VALUES (?, ?, ?, ?)')
                ->execute([$key, $label, str_in($b['descr'] ?? '', 200), (int) ($b['sort'] ?? 50)]);
        } else {
            db()->prepare('UPDATE categories SET label = ?, descr = ?, sort = ? WHERE key = ?')
                ->execute([$label, str_in($b['descr'] ?? '', 200), (int) ($b['sort'] ?? 50), $key]);
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
        if (!empty($_GET['status'])) { $where[] = 'status = ?'; $args[] = $_GET['status']; }
        if (!empty($_GET['q'])) {
            $q = '%' . $_GET['q'] . '%';
            $where[] = '(customer LIKE ? OR email LIKE ? OR phone LIKE ? OR (\'WTS-\' || (1000 + id)) LIKE ?)';
            array_push($args, $q, $q, $q, $q);
        }
        $sql = 'SELECT o.*, u.name AS rep_name FROM orders o LEFT JOIN users u ON u.id = o.rep_id'
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
        set_order_status($id, (string) ($b['status'] ?? $o['status']), str_in($b['notes'] ?? $o['notes'], 2000));
        json_out(['ok' => true]);

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
        json_out(['cities' => bosta_areas()]);

    case 'bosta_create':
        $u = require_perm('orders');
        $b = body();
        $ids = array_map('intval', (array) ($b['ids'] ?? [$b['id'] ?? 0]));
        $results = [];
        foreach ($ids as $id) {
            $st = db()->prepare('SELECT * FROM orders WHERE id = ?');
            $st->execute([$id]);
            $o = $st->fetch();
            if (!$o) { $results[] = ['id' => $id, 'error' => 'Order not found.']; continue; }
            try {
                if ($o['status'] === 'Cancelled') throw new RuntimeException('Order is cancelled.');
                $opts = count($ids) === 1 ? $b : ['size' => $b['size'] ?? '', 'location_id' => $b['location_id'] ?? ''];
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
        require_perm('orders');
        $st = db()->prepare('SELECT id, tracking_number FROM orders WHERE id = ?');
        $st->execute([(int) (body()['id'] ?? 0)]);
        $o = $st->fetch();
        if (!$o || !$o['tracking_number']) fail('This order has no Bosta shipment.', 404);
        $d = bosta_view($o['tracking_number']);
        $code = (int) ($d['state']['code'] ?? 0);
        if ($code) bosta_apply_state((int) $o['id'], $code, (string) ($d['state']['exception']['reason'] ?? ($d['exceptionReason'] ?? '')));
        json_out(['state' => $code, 'label' => bosta_state_label($code)]);

    case 'bosta_awb':
        require_perm('orders');
        $ids = array_map('intval', explode(',', (string) ($_GET['ids'] ?? '')));
        $in = implode(',', array_fill(0, count($ids), '?'));
        $st = db()->prepare("SELECT tracking_number FROM orders WHERE id IN ($in) AND tracking_number IS NOT NULL AND tracking_number != ''");
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
        $st = db()->prepare('SELECT id, tracking_number FROM orders WHERE id = ?');
        $st->execute([(int) (body()['id'] ?? 0)]);
        $o = $st->fetch();
        if (!$o || !$o['tracking_number']) fail('This order has no Bosta shipment.', 404);
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
        if ($id) {
            db()->prepare('UPDATE leads SET status = ?, notes = ?, assigned_to = ? WHERE id = ?')
                ->execute([$status, str_in($b['notes'] ?? '', 2000), $assigned, $id]);
            log_activity($u, 'Updated lead', '#' . $id . ' → ' . $status);
        } else {
            $name = str_in($b['name'] ?? '', 120);
            $contact = str_in($b['contact'] ?? '', 160);
            if ($name === '' || $contact === '') fail('Name and contact are required.');
            db()->prepare('INSERT INTO leads (name, contact, cat, source, status, notes, assigned_to) VALUES (?, ?, ?, ?, ?, ?, ?)')
                ->execute([$name, $contact, str_in($b['cat'] ?? '', 40), str_in($b['source'] ?? 'Added by team', 80), $status, str_in($b['notes'] ?? '', 2000), $assigned]);
            log_activity($u, 'Added lead', $name);
        }
        json_out(['ok' => true]);

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
        $ok = send_mail([$u['email']], 'Test alert from your shop',
            email_shell('Email alerts are working', '<p>New orders and enquiries will arrive like this. If this landed in spam, mark it “Not spam” and see the setup notes about SMTP/SPF.</p>'),
            "Email alerts are working.\n");
        $via = cfg('smtp') ? 'your mailbox (SMTP)' : 'the server’s built-in mail';
        if (!$ok) fail('Could not send the test email via ' . $via . '. Check the SMTP settings in api/config.local.php.', 502);
        json_out(['ok' => true, 'to' => $u['email'], 'via' => $via]);

    case 'activity':
        require_perm('activity');
        json_out(['activity' => db()->query('SELECT * FROM activity ORDER BY id DESC LIMIT 300')->fetchAll()]);

    default:
        fail('Not found', 404);
    }
} catch (ShopError $e) {
    fail($e->getMessage(), 502);
} catch (Throwable $e) {
    try { if (db()->inTransaction()) db()->rollBack(); } catch (Throwable $ignored) {}
    error_log('[shop admin] ' . $e->getMessage());
    fail('Something went wrong. Please try again.', 500);
}

// ---------- helpers ----------

function order_out(array $o): array
{
    return [
        'id' => (int) $o['id'], 'number' => order_number((int) $o['id']), 'customer' => $o['customer'], 'email' => $o['email'],
        'phone' => $o['phone'], 'address' => $o['address'], 'city' => $o['city'], 'items' => json_decode($o['items'], true) ?: [],
        'subtotal' => (float) $o['subtotal'], 'discount' => (float) $o['discount'], 'shipping' => (float) $o['shipping'],
        'total' => (float) $o['total'], 'promo' => $o['promo'], 'payment' => $o['payment'], 'status' => $o['status'],
        'notes' => $o['notes'], 'rep' => $o['rep_name'] ?? null, 'createdAt' => $o['created_at'],
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
    imagedestroy($im);
    imagedestroy($out);
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
