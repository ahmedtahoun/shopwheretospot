<?php
// Shared setup for the shop API: config, database, sessions, auth and helpers.
// Written for PHP 7.4+ so it runs on standard cPanel hosting.

declare(strict_types=1);

$config = [
    // Where the SQLite database and setup key live. Must be writable by PHP.
    // Preferred: a folder next to the site folder, so it can never be downloaded over the web
    // (on cPanel: /home/<user>/wts-shop-data). Falls back to the .htaccess-protected data/ folder.
    'data_dir' => getenv('WTS_DATA_DIR') ?: (is_writable(dirname(__DIR__, 2)) ? dirname(__DIR__, 2) . '/wts-shop-data' : dirname(__DIR__) . '/data'),
    'upload_dir' => dirname(__DIR__) . '/uploads/products',
    'upload_url' => 'uploads/products',
    'order_upload_dir' => dirname(__DIR__) . '/uploads/orders',
    'order_upload_url' => 'uploads/orders',
    'max_upload_bytes' => 5 * 1024 * 1024,
    'shipping_fee' => 75,
    'free_shipping_threshold' => 1500,
    'promo_codes' => ['WELCOME10' => 10, 'SPOT20' => 20],
    // Email alerts (see api/mailer.php). Team members choose to receive them in Dashboard → Team.
    'site_url' => 'https://shop.wheretospot.com',
    'mail_from' => 'no-reply@wheretospot.com',
    'mail_from_name' => 'Where To Spot Shop',
    'reply_to' => 'info@wheretospot.com',
    'alert_emails' => [],   // extra addresses that always get alerts
    'smtp' => null,
    'bosta' => [],          // see api/bosta.php and api/config.local.example.php         // e.g. ['host' => 'serverXXX.web-hosting.com', 'port' => 465, 'user' => 'orders@wheretospot.com', 'pass' => '…']
];
if (is_file(__DIR__ . '/config.local.php')) {
    $config = array_merge($config, (array) require __DIR__ . '/config.local.php');
}

// Errors whose message is safe to show to the team (Bosta replies, validation). Database errors are never shown.
class ShopError extends RuntimeException {}

// 'sell' = can enter orders; 'targets' = can set monthly targets; 'own_orders' = only sees orders credited to them.
const ROLES = [
    'owner' => ['dashboard', 'products', 'orders', 'sell', 'leads', 'team', 'targets', 'activity', 'backups'],
    'manager' => ['dashboard', 'products', 'orders', 'sell', 'leads', 'targets', 'activity'],
    'sales' => ['dashboard', 'orders', 'sell', 'leads', 'own_orders'],
    'staff' => ['dashboard', 'orders', 'sell', 'leads'],
];
// Order lifecycle, including production of personalised items. Cancelled/Returned put stock back.
const ORDER_STATUSES = ['Pending', 'Confirmed', 'Designing', 'Awaiting approval', 'In production', 'Ready', 'Shipped', 'Delivered', 'Cancelled', 'Returned'];
const ORDER_STAGE = ['Pending' => 0, 'Confirmed' => 1, 'Designing' => 2, 'Awaiting approval' => 3, 'In production' => 4, 'Ready' => 5, 'Shipped' => 6, 'Delivered' => 7, 'Returned' => 7, 'Cancelled' => 7];
const LEAD_STATUSES = ['New', 'Contacted', 'Quoted', 'Won', 'Lost'];

function cfg(string $key)
{
    global $config;
    return $config[$key];
}

// Single-row lookups (fetch / fetchColumn) close their cursor straight away. A half-read
// statement keeps an old snapshot open, and SQLite then refuses this request's next write
// with "database is locked" if another request wrote in between. Nothing reads row by row
// with fetch() in a loop (lists use fetchAll or foreach), so closing after one row is safe.
class WtsStatement extends PDOStatement
{
    protected function __construct() {}

    #[\ReturnTypeWillChange]
    public function fetch($mode = null, $cursorOrientation = PDO::FETCH_ORI_NEXT, $cursorOffset = 0)
    {
        $row = $mode === null ? parent::fetch() : parent::fetch($mode, $cursorOrientation, $cursorOffset);
        $this->closeCursor();
        return $row;
    }

    #[\ReturnTypeWillChange]
    public function fetchColumn($column = 0)
    {
        $value = parent::fetchColumn($column);
        $this->closeCursor();
        return $value;
    }
}

// Write transactions take SQLite's write lock up front (BEGIN IMMEDIATE), so concurrent orders wait
// their turn via busy_timeout instead of failing with "database is locked" halfway through.
// Plain exec() calls keep this working the same on every PHP version.
function tx_begin(): void { db()->exec('BEGIN IMMEDIATE'); $GLOBALS['wts_tx'] = true; }
function tx_commit(): void { db()->exec('COMMIT'); $GLOBALS['wts_tx'] = false; }
function tx_rollback(): void { if (!empty($GLOBALS['wts_tx'])) { $GLOBALS['wts_tx'] = false; try { db()->exec('ROLLBACK'); } catch (Throwable $e) {} } }
function tx_active(): bool { return !empty($GLOBALS['wts_tx']); }

// Bump whenever migrate() gains a new table/column so existing databases upgrade once.
const SCHEMA_VERSION = 8;

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $dir = cfg('data_dir');
    if (!is_dir($dir)) mkdir($dir, 0750, true);
    $pdo = new PDO('sqlite:' . $dir . '/shop.sqlite');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->setAttribute(PDO::ATTR_STATEMENT_CLASS, [WtsStatement::class]);
    // Wait up to 8 s for another request's write to finish instead of failing straight away
    // ("database is locked" was the intermittent "couldn't load data" error).
    $pdo->setAttribute(PDO::ATTR_TIMEOUT, 8);
    $pdo->exec('PRAGMA busy_timeout = 8000; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
    // Schema changes only run when the stored version is older than this code.
    if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() < SCHEMA_VERSION) {
        $pdo->exec('PRAGMA journal_mode = WAL;');
        migrate($pdo);
        $pdo->exec('PRAGMA user_version = ' . SCHEMA_VERSION);
    }
    if (!empty($GLOBALS['backfill_lead_keys']) && function_exists('backfill_lead_keys')) backfill_lead_keys();
    return $pdo;
}

// ---------- backups ----------
// One copy of the database per day in <data_dir>/backups (outside the website folder), last 30 kept.
// Made automatically after the first dashboard or order request of each day, so no cron job is needed.
const BACKUP_KEEP = 30;

function backup_dir(): string
{
    return cfg('data_dir') . '/backups';
}

function backup_list(): array
{
    $files = glob(backup_dir() . '/shop-*.sqlite') ?: [];
    rsort($files);
    return array_map(function ($f) {
        return ['file' => basename($f), 'size' => filesize($f), 'created' => gmdate('Y-m-d H:i:s', filemtime($f))];
    }, $files);
}

function make_backup(): string
{
    $dir = backup_dir();
    if (!is_dir($dir)) mkdir($dir, 0750, true);
    $file = $dir . '/shop-' . date('Y-m-d') . '.sqlite';
    $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
    try {
        // A consistent copy even while orders are being written.
        db()->exec('VACUUM INTO ' . db()->quote($tmp));
    } catch (Throwable $e) {
        // Very old SQLite: flush the write-ahead log and copy the file instead.
        db()->exec('PRAGMA wal_checkpoint(FULL)');
        if (!copy(cfg('data_dir') . '/shop.sqlite', $tmp)) throw new RuntimeException('Could not copy the database');
    }
    if (!rename($tmp, $file)) { @unlink($tmp); throw new RuntimeException('Could not save the backup'); }
    @chmod($file, 0640);
    foreach (array_slice(glob($dir . '/shop-*.sqlite') ?: [], 0, -BACKUP_KEEP) as $old) @unlink($old);
    return basename($file);
}

// Called by the APIs: if today's backup is missing, make it after the response has been sent.
function schedule_daily_backup(): void
{
    if (is_file(backup_dir() . '/shop-' . date('Y-m-d') . '.sqlite')) return;
    register_shutdown_function(function () {
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        elseif (function_exists('litespeed_finish_request')) litespeed_finish_request();
        try { make_backup(); } catch (Throwable $e) { error_log('[shop] daily backup failed: ' . $e->getMessage()); }
    });
}

function migrate(PDO $pdo): void
{
    $pdo->exec("
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        phone TEXT DEFAULT '',
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'staff',
        ref_code TEXT DEFAULT NULL UNIQUE,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_login TEXT
    );
    CREATE TABLE IF NOT EXISTS categories (
        key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        descr TEXT DEFAULT '',
        sort INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        sku TEXT DEFAULT '',
        name TEXT NOT NULL,
        cat TEXT NOT NULL,
        vendor TEXT DEFAULT '',
        price REAL NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0,
        stock INTEGER NOT NULL DEFAULT 0,
        discount_pct REAL NOT NULL DEFAULT 0,
        label TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Active',
        sub TEXT DEFAULT '',
        descr TEXT DEFAULT '',
        features TEXT DEFAULT '[]',
        period TEXT DEFAULT '',
        sort INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS product_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        sort INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT DEFAULT '',
        address TEXT DEFAULT '',
        city TEXT DEFAULT '',
        items TEXT NOT NULL,
        subtotal REAL NOT NULL,
        discount REAL NOT NULL DEFAULT 0,
        shipping REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL,
        promo TEXT DEFAULT '',
        payment TEXT NOT NULL DEFAULT 'cod',
        rep_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'Pending',
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        contact TEXT NOT NULL,
        cat TEXT DEFAULT '',
        source TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'New',
        notes TEXT DEFAULT '',
        assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        user_name TEXT DEFAULT '',
        action TEXT NOT NULL,
        detail TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
        ip TEXT NOT NULL,
        ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_images_product ON product_images(product_id);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
    ");
    $userCols = $pdo->query('PRAGMA table_info(users)')->fetchAll(PDO::FETCH_COLUMN, 1);
    if (!in_array('notify', $userCols, true)) $pdo->exec('ALTER TABLE users ADD COLUMN notify INTEGER NOT NULL DEFAULT 0');
    $orderCols = $pdo->query('PRAGMA table_info(orders)')->fetchAll(PDO::FETCH_COLUMN, 1);
    $add = ['source' => "TEXT DEFAULT 'Website'", 'created_by' => 'INTEGER', 'city_id' => 'TEXT', 'district_id' => 'TEXT', 'district' => "TEXT DEFAULT ''", 'bosta_id' => 'TEXT', 'tracking_number' => 'TEXT',
        'bosta_state' => 'INTEGER', 'bosta_note' => "TEXT DEFAULT ''", 'bosta_cod' => 'REAL', 'bosta_updated_at' => 'TEXT'];
    foreach ($add as $col => $type) {
        if (!in_array($col, $orderCols, true)) $pdo->exec("ALTER TABLE orders ADD COLUMN $col $type");
    }
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_orders_tracking ON orders(tracking_number)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_orders_rep ON orders(rep_id, created_at)');
    $prodCols = $pdo->query('PRAGMA table_info(products)')->fetchAll(PDO::FETCH_COLUMN, 1);
    foreach (['variants' => "TEXT DEFAULT '[]'", 'tiers' => "TEXT DEFAULT '[]'", 'addons' => "TEXT DEFAULT '[]'", 'personalized' => 'INTEGER NOT NULL DEFAULT 0'] as $col => $type) {
        if (!in_array($col, $prodCols, true)) $pdo->exec("ALTER TABLE products ADD COLUMN $col $type");
    }
    $orderCols = $pdo->query('PRAGMA table_info(orders)')->fetchAll(PDO::FETCH_COLUMN, 1);
    foreach (['business_name' => "TEXT DEFAULT ''", 'review_link' => "TEXT DEFAULT ''", 'links' => "TEXT DEFAULT ''", 'design_notes' => "TEXT DEFAULT ''", 'files' => "TEXT DEFAULT '[]'"] as $col => $type) {
        if (!in_array($col, $orderCols, true)) $pdo->exec("ALTER TABLE orders ADD COLUMN $col $type");
    }
    $leadCols = $pdo->query('PRAGMA table_info(leads)')->fetchAll(PDO::FETCH_COLUMN, 1);
    if (!in_array('phone_key', $leadCols, true)) {
        $pdo->exec('ALTER TABLE leads ADD COLUMN phone_key TEXT');
        $pdo->exec('ALTER TABLE leads ADD COLUMN email_key TEXT');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone_key)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email_key)');
        $GLOBALS['backfill_lead_keys'] = true; // filled in once orders.php (phone_key/email_key) is loaded
    }
    // Follow-up reminders: the date someone should contact this lead again.
    if (!in_array('follow_up', $leadCols, true)) {
        $pdo->exec('ALTER TABLE leads ADD COLUMN follow_up TEXT DEFAULT NULL');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_leads_follow ON leads(follow_up)');
    }
    $pdo->exec("CREATE TABLE IF NOT EXISTS targets (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        month TEXT NOT NULL,
        orders_target INTEGER NOT NULL DEFAULT 0,
        revenue_target REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, month)
    )");
    if ((int) $pdo->query('SELECT COUNT(*) FROM categories')->fetchColumn() === 0) {
        seed_catalog($pdo);
    }
}

// First run: load the catalog that used to be hard-coded in shop-data.js.
function seed_catalog(PDO $pdo): void
{
    $cats = [
        ['nfc', 'NFC Solutions', 'Tap-to-review cards for Google reviews', 1],
        ['cosmetics', 'Cosmetics', 'Clean-formula skincare & beauty', 2],
        ['stands', 'Exhibition Stands', 'Modular booths & displays for events', 3],
        ['gift', 'Premium & Gift', 'Curated gifting collections', 4],
        ['pets', 'Pet Products', 'Everyday gear for pets', 5],
        ['school', 'Summer School Kits', 'Activity kits for camps & programs', 6],
        ['services', 'Marketing Plans', 'Monthly lead-generation plans', 99],
    ];
    $st = $pdo->prepare('INSERT INTO categories (key, label, descr, sort) VALUES (?, ?, ?, ?)');
    foreach ($cats as $c) $st->execute($c);

    $seed = json_decode((string) file_get_contents(__DIR__ . '/seed-products.json'), true) ?: [];
    $ins = $pdo->prepare('INSERT INTO products (id, sku, name, cat, vendor, price, cost, stock, discount_pct, label, status, sub, descr, features, period, sort)
        VALUES (:id, :sku, :name, :cat, :vendor, :price, :cost, :stock, :discount_pct, :label, :status, :sub, :descr, :features, :period, :sort)');
    $img = $pdo->prepare('INSERT INTO product_images (product_id, path, sort) VALUES (?, ?, ?)');
    foreach ($seed as $i => $p) {
        $ins->execute([
            ':id' => $p['id'], ':sku' => $p['sku'] ?? '', ':name' => $p['name'], ':cat' => $p['cat'],
            ':vendor' => $p['vendor'] ?? '', ':price' => $p['price'], ':cost' => $p['cost'] ?? 0,
            ':stock' => $p['stock'] ?? 0, ':discount_pct' => $p['discountPct'] ?? 0, ':label' => $p['label'] ?? '',
            ':status' => $p['status'] ?? 'Active', ':sub' => $p['sub'] ?? '', ':descr' => $p['desc'] ?? '',
            ':features' => json_encode($p['features'] ?? []), ':period' => $p['period'] ?? '', ':sort' => $i,
        ]);
        foreach (($p['images'] ?? []) as $n => $path) $img->execute([$p['id'], $path, $n]);
    }
}

require __DIR__ . '/mailer.php';
require __DIR__ . '/pricing.php';
require __DIR__ . '/bosta.php';
require __DIR__ . '/orders.php';

// One-time: normalised phone/email keys for leads created before duplicate prevention existed.
function backfill_lead_keys(): void
{
    if (empty($GLOBALS['backfill_lead_keys'])) return;
    $GLOBALS['backfill_lead_keys'] = false;
    $up = db()->prepare('UPDATE leads SET phone_key = ?, email_key = ? WHERE id = ?');
    foreach (db()->query('SELECT id, contact FROM leads')->fetchAll() as $l) $up->execute([phone_key($l['contact']), email_key($l['contact']), $l['id']]);
}

// ---------- HTTP helpers ----------

function json_out($data, int $code = 200, int $cacheSeconds = 0): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header($cacheSeconds > 0 ? 'Cache-Control: public, max-age=' . $cacheSeconds : 'Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $msg, int $code = 400): void
{
    json_out(['error' => $msg], $code);
}

function body(): array
{
    static $b = null;
    if ($b !== null) return $b;
    $ct = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($ct, 'application/json') !== false) {
        $b = json_decode((string) file_get_contents('php://input'), true) ?: [];
    } else {
        $b = $_POST;
    }
    return $b;
}

function str_in($v, int $max = 500): string
{
    return mb_substr(trim((string) ($v ?? '')), 0, $max);
}

function client_ip(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

// ---------- sessions & auth ----------

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name('wts_admin');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Strict']);
    session_start();
}

function current_user(): ?array
{
    start_session();
    if (empty($_SESSION['uid'])) return null;
    $st = db()->prepare('SELECT id, name, email, phone, role, ref_code, active FROM users WHERE id = ?');
    $st->execute([$_SESSION['uid']]);
    $u = $st->fetch();
    if (!$u || !$u['active']) return null;
    $u['perms'] = ROLES[$u['role']] ?? [];
    return $u;
}

function require_perm(string $perm): array
{
    $u = current_user();
    if (!$u) fail('Not signed in', 401);
    if (!in_array($perm, $u['perms'], true)) fail('You do not have access to this', 403);
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!hash_equals($_SESSION['csrf'] ?? '', $token)) fail('Session expired, please reload', 419);
    }
    // Release the session lock: nothing writes to the session after this point, and holding it
    // made the dashboard's parallel requests queue behind each other.
    session_write_close();
    return $u;
}

function log_activity(?array $u, string $action, string $detail = ''): void
{
    $st = db()->prepare('INSERT INTO activity (user_id, user_name, action, detail) VALUES (?, ?, ?, ?)');
    $st->execute([$u['id'] ?? null, $u['name'] ?? 'Website', $action, mb_substr($detail, 0, 500)]);
}

function too_many_attempts(string $bucket, int $max, int $window): bool
{
    $pdo = db();
    $key = $bucket . ':' . client_ip();
    $pdo->prepare('DELETE FROM login_attempts WHERE ts < ?')->execute([time() - 86400]);
    $st = $pdo->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND ts > ?');
    $st->execute([$key, time() - $window]);
    return (int) $st->fetchColumn() >= $max;
}

function record_attempt(string $bucket): void
{
    db()->prepare('INSERT INTO login_attempts (ip, ts) VALUES (?, ?)')->execute([$bucket . ':' . client_ip(), time()]);
}

// The one-time key needed to create the first owner account.
// It is written to data/SETUP_KEY.txt; read it with cPanel File Manager.
function setup_key(): string
{
    $file = cfg('data_dir') . '/SETUP_KEY.txt';
    if (!is_file($file)) file_put_contents($file, bin2hex(random_bytes(12)));
    return trim((string) file_get_contents($file));
}

// ---------- catalog helpers ----------

function product_row(array $p, array $images): array
{
    return [
        'id' => $p['id'], 'sku' => $p['sku'], 'name' => $p['name'], 'cat' => $p['cat'], 'vendor' => $p['vendor'],
        'price' => (float) $p['price'], 'cost' => (float) $p['cost'], 'stock' => (int) $p['stock'],
        'discountPct' => (float) $p['discount_pct'], 'label' => $p['label'], 'status' => $p['status'],
        'sub' => $p['sub'], 'desc' => $p['descr'], 'features' => json_decode($p['features'] ?: '[]', true) ?: [],
        'period' => $p['period'], 'sort' => (int) $p['sort'], 'images' => $images,
        'variants' => product_json($p, 'variants'), 'tiers' => product_json($p, 'tiers'), 'addons' => product_json($p, 'addons'),
        'personalized' => (bool) ($p['personalized'] ?? 0), 'fromPrice' => from_price($p),
        'createdAt' => $p['created_at'], 'updatedAt' => $p['updated_at'],
    ];
}

function load_products(bool $activeOnly): array
{
    $pdo = db();
    $sql = 'SELECT * FROM products' . ($activeOnly ? " WHERE status = 'Active'" : '') . ' ORDER BY sort, name';
    $rows = $pdo->query($sql)->fetchAll();
    $imgs = [];
    foreach ($pdo->query('SELECT id, product_id, path FROM product_images ORDER BY sort, id') as $i) {
        $imgs[$i['product_id']][] = $activeOnly ? $i['path'] : ['id' => (int) $i['id'], 'path' => $i['path']];
    }
    return array_map(function ($p) use ($imgs) { return product_row($p, $imgs[$p['id']] ?? []); }, $rows);
}

function sale_price(array $p): float
{
    $d = (float) $p['discount_pct'];
    return $d ? round((float) $p['price'] * (1 - $d / 100), 2) : (float) $p['price'];
}

// Change an order's status. Cancelling or returning puts stock back; reopening takes it again.
function set_order_status(int $id, string $status, ?string $notes = null): array
{
    $pdo = db();
    $st = $pdo->prepare('SELECT * FROM orders WHERE id = ?');
    $st->execute([$id]);
    $o = $st->fetch();
    if (!$o) throw new ShopError('Order not found.');
    if (!in_array($status, ORDER_STATUSES, true)) $status = $o['status'];
    $own = !tx_active();
    if ($own) tx_begin();
    $wasOpen = !in_array($o['status'], ['Cancelled', 'Returned'], true);
    $isOpen = !in_array($status, ['Cancelled', 'Returned'], true);
    if ($wasOpen !== $isOpen) {
        $sign = $isOpen ? -1 : 1;
        foreach (json_decode($o['items'], true) ?: [] as $it) {
            if (($it['id'] ?? '') === 'custom') continue;
            adjust_stock($pdo, (string) $it['id'], isset($it['variant']) ? (string) $it['variant'] : null, $sign * (int) $it['qty']);
        }
    }
    $pdo->prepare("UPDATE orders SET status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
        ->execute([$status, $notes === null ? $o['notes'] : $notes, $id]);
    if ($own) tx_commit();
    if ($status !== $o['status']) log_activity(current_user_quiet(), 'Order ' . $status, order_number($id));
    return $o;
}

// The signed-in team member if there is one, without failing (webhooks have no session).
function current_user_quiet(): ?array
{
    if (session_status() !== PHP_SESSION_ACTIVE) return null;
    return current_user();
}

function order_number(int $id): string
{
    return 'WTS-' . (1000 + $id);
}
