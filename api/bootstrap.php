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
    'max_upload_bytes' => 5 * 1024 * 1024,
    'shipping_fee' => 75,
    'free_shipping_threshold' => 1500,
    'promo_codes' => ['WELCOME10' => 10, 'SPOT20' => 20],
];
if (is_file(__DIR__ . '/config.local.php')) {
    $config = array_merge($config, (array) require __DIR__ . '/config.local.php');
}

const ROLES = [
    'owner' => ['dashboard', 'products', 'orders', 'leads', 'team', 'activity'],
    'manager' => ['dashboard', 'products', 'orders', 'leads', 'activity'],
    'staff' => ['dashboard', 'orders', 'leads'],
];
const ORDER_STATUSES = ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled', 'Returned'];
const LEAD_STATUSES = ['New', 'Contacted', 'Quoted', 'Won', 'Lost'];

function cfg(string $key)
{
    global $config;
    return $config[$key];
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $dir = cfg('data_dir');
    if (!is_dir($dir)) mkdir($dir, 0750, true);
    $pdo = new PDO('sqlite:' . $dir . '/shop.sqlite');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    migrate($pdo);
    return $pdo;
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

// ---------- HTTP helpers ----------

function json_out($data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
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

function order_number(int $id): string
{
    return 'WTS-' . (1000 + $id);
}
