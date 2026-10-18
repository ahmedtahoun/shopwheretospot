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
    'bosta' => [],
    'paymob' => [],         // online payments; see api/paymob.php and api/config.local.example.php          // see api/bosta.php and api/config.local.example.php         // e.g. ['host' => 'serverXXX.web-hosting.com', 'port' => 465, 'user' => 'orders@wheretospot.com', 'pass' => '…']
];
if (is_file(__DIR__ . '/config.local.php')) {
    $config = array_merge($config, (array) require __DIR__ . '/config.local.php');
}

// Errors whose message is safe to show to the team (Bosta replies, validation). Database errors are never shown.
class ShopError extends RuntimeException {}

// 'sell' = can enter orders; 'targets' = can set monthly targets; 'own_orders' = only sees orders credited to them.
const ROLES = [
    // 'revenue': sales totals, profit and money figures (owner and managers only).
    // 'orders_only': telesales — orders and the order counts, nothing else.
    'owner' => ['dashboard', 'products', 'orders', 'sell', 'leads', 'team', 'targets', 'activity', 'backups', 'revenue'],
    'manager' => ['dashboard', 'products', 'orders', 'sell', 'leads', 'targets', 'activity', 'revenue'],
    'sales' => ['dashboard', 'orders', 'sell', 'leads', 'own_orders'],
    // Everyone except owner and manager sees only the orders credited to them (the ones they entered).
    'staff' => ['dashboard', 'orders', 'sell', 'leads', 'own_orders'],
    'telesales' => ['dashboard', 'orders', 'sell', 'orders_only', 'own_orders'],
];
// Order lifecycle, including production of personalised items. Cancelled/Returned put stock back.
// 'Awaiting payment': an online-payment order whose payment Paymob hasn't confirmed yet (hidden from lists and totals).
const ORDER_STATUSES = ['Awaiting payment', 'Pending', 'Confirmed', 'Designing', 'Awaiting approval', 'In production', 'Ready', 'Shipped', 'Delivered', 'Cancelled', 'Returned'];
const ORDER_STAGE = ['Awaiting payment' => 0, 'Pending' => 0, 'Confirmed' => 1, 'Designing' => 2, 'Awaiting approval' => 3, 'In production' => 4, 'Ready' => 5, 'Shipped' => 6, 'Delivered' => 7, 'Returned' => 7, 'Cancelled' => 7];
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
const SCHEMA_VERSION = 26;

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
        'bosta_state' => 'INTEGER', 'bosta_note' => "TEXT DEFAULT ''", 'bosta_cod' => 'REAL', 'bosta_updated_at' => 'TEXT',
        'pay_refs' => "TEXT DEFAULT ''", 'customer_id' => 'INTEGER']; // Paymob references created for this order (a payment must match one)
    foreach ($add as $col => $type) {
        if (!in_array($col, $orderCols, true)) $pdo->exec("ALTER TABLE orders ADD COLUMN $col $type");
    }
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_orders_tracking ON orders(tracking_number)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_orders_rep ON orders(rep_id, created_at)');
    $prodCols = $pdo->query('PRAGMA table_info(products)')->fetchAll(PDO::FETCH_COLUMN, 1);
    foreach (['variants' => "TEXT DEFAULT '[]'", 'tiers' => "TEXT DEFAULT '[]'", 'addons' => "TEXT DEFAULT '[]'", 'personalized' => 'INTEGER NOT NULL DEFAULT 0',
        'name_ar' => "TEXT DEFAULT ''", 'sub_ar' => "TEXT DEFAULT ''", 'desc_ar' => "TEXT DEFAULT ''"] as $col => $type) {
        if (!in_array($col, $prodCols, true)) $pdo->exec("ALTER TABLE products ADD COLUMN $col $type");
    }
    // Arabic shop: optional Arabic names for categories (and products above); the English text shows when empty.
    $catCols = $pdo->query('PRAGMA table_info(categories)')->fetchAll(PDO::FETCH_COLUMN, 1);
    foreach (['label_ar' => "TEXT DEFAULT ''", 'descr_ar' => "TEXT DEFAULT ''"] as $col => $type) {
        if (!in_array($col, $catCols, true)) $pdo->exec("ALTER TABLE categories ADD COLUMN $col $type");
    }
    $catAr = ['nfc' => ['حلول NFC', 'كروت وستاندات تقييم جوجل باللمس'], 'cosmetics' => ['مستحضرات التجميل', 'عناية بالبشرة بتركيبات نظيفة'],
        'stands' => ['ستاندات المعارض', 'أجنحة وستاندات عرض للمعارض والفعاليات'], 'pets' => ['منتجات الحيوانات الأليفة', 'مستلزمات يومية للحيوانات الأليفة'],
        'school' => ['أدوات المدارس الصيفية', 'أنشطة للمعسكرات والبرامج الصيفية'], 'gift' => ['هدايا مميزة', 'مجموعات هدايا مختارة'],
        'services' => ['خطط التسويق', 'خطط شهرية لجلب العملاء'], 'acrylic' => ['منتجات الأكريليك', 'ستاندات وعلب عرض من الأكريليك']];

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
    // Money received per order: deposits, transfers, cash collected on delivery.
    $hadPayments = (bool) $pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'payments'")->fetchColumn();
    $pdo->exec("CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        method TEXT NOT NULL DEFAULT 'cash',
        note TEXT DEFAULT '',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id)');
    if (!$hadPayments) {
        // Existing orders: paid-upfront ones and delivered cash-on-delivery ones count as fully paid.
        $pdo->exec("INSERT INTO payments (order_id, amount, method, note, created_at)
            SELECT id, total, payment, 'Paid when the order was placed', created_at FROM orders WHERE payment != 'cod' AND status NOT IN ('Cancelled','Returned')");
        $pdo->exec("INSERT INTO payments (order_id, amount, method, note, created_at)
            SELECT id, total, 'cod', 'Collected on delivery', updated_at FROM orders WHERE payment = 'cod' AND status = 'Delivered'");
    }
    // Quotes: priced offers that don't touch stock or revenue until the customer accepts.
    $pdo->exec("CREATE TABLE IF NOT EXISTS quotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
        order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
        customer TEXT NOT NULL,
        phone TEXT DEFAULT '',
        email TEXT DEFAULT '',
        business_name TEXT DEFAULT '',
        review_link TEXT DEFAULT '',
        links TEXT DEFAULT '',
        design_notes TEXT DEFAULT '',
        address TEXT DEFAULT '',
        city TEXT DEFAULT '',
        district TEXT DEFAULT '',
        city_id TEXT DEFAULT NULL,
        district_id TEXT DEFAULT NULL,
        items_in TEXT NOT NULL DEFAULT '[]',
        items TEXT NOT NULL DEFAULT '[]',
        subtotal REAL NOT NULL DEFAULT 0,
        discount REAL NOT NULL DEFAULT 0,
        shipping REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'Draft',
        valid_until TEXT DEFAULT NULL,
        terms TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        rep_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        sent_at TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )");
    // Promo codes the team manages in the dashboard (they used to be fixed in the code).
    if (!$pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='promos'")->fetchColumn()) {
        $pdo->exec("CREATE TABLE promos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE COLLATE NOCASE,
            kind TEXT NOT NULL DEFAULT 'percent',
            value REAL NOT NULL DEFAULT 0,
            min_order REAL NOT NULL DEFAULT 0,
            max_uses INTEGER DEFAULT NULL,
            starts_at TEXT DEFAULT NULL,
            expires_at TEXT DEFAULT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            note TEXT DEFAULT '',
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )");
        $ins = $pdo->prepare("INSERT OR IGNORE INTO promos (code, kind, value, note) VALUES (?, 'percent', ?, 'Original code')");
        foreach ((array) cfg('promo_codes') as $c => $pct) $ins->execute([strtoupper($c), (float) $pct]);
    }
    // Shop customer accounts (sign-in by emailed code; see api/customers.php).
    $pdo->exec("CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
        city TEXT DEFAULT '', city_id TEXT, district_id TEXT, zone_id TEXT, district TEXT DEFAULT '', area_title TEXT DEFAULT '', area_sub TEXT DEFAULT '',
        lang TEXT DEFAULT '', contact_pref TEXT DEFAULT 'whatsapp', offers INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), last_login TEXT
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS customer_codes (email TEXT PRIMARY KEY COLLATE NOCASE, code_hash TEXT NOT NULL, expires INTEGER NOT NULL,
        tries INTEGER NOT NULL DEFAULT 0, sent_at INTEGER NOT NULL DEFAULT 0, sends INTEGER NOT NULL DEFAULT 0)");
    $pdo->exec("CREATE TABLE IF NOT EXISTS customer_sessions (token_hash TEXT PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE, expires INTEGER NOT NULL)");
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
    // Partner brands: products another brand supplies; we sell them under their logo and keep a commission.
    $pdo->exec("CREATE TABLE IF NOT EXISTS brands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        name_ar TEXT DEFAULT '',
        tagline TEXT DEFAULT '',
        tagline_ar TEXT DEFAULT '',
        about TEXT DEFAULT '',
        about_ar TEXT DEFAULT '',
        logo TEXT DEFAULT '',
        link TEXT DEFAULT '',
        commission REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        sort INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )");
    // Money handed over to a brand for its sales (what is left after our commission).
    $pdo->exec("CREATE TABLE IF NOT EXISTS brand_payouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        paid_on TEXT NOT NULL,
        note TEXT DEFAULT '',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )");
    $prodCols = $pdo->query('PRAGMA table_info(products)')->fetchAll(PDO::FETCH_COLUMN, 1);
    if (!in_array('brand_id', $prodCols, true)) $pdo->exec('ALTER TABLE products ADD COLUMN brand_id INTEGER DEFAULT NULL');
    if (!(int) $pdo->query("SELECT COUNT(*) FROM brands WHERE slug = 'bonds'")->fetchColumn()) {
        $pdo->prepare("INSERT INTO brands (slug, name, name_ar, tagline, tagline_ar, logo, link, commission, sort) VALUES ('bonds', 'Bonds Coffee Roasters', 'بوندز لتحميص القهوة', 'Coffee roasters', 'محمصة قهوة', 'images/brands/bonds.png', 'https://www.instagram.com/bondscoffeeroasters', 20, 1)")->execute();
    }
    // Agreed commission with Bonds: 20% (only fills it in if it was never set).
    $pdo->exec("UPDATE brands SET commission = 20 WHERE slug = 'bonds' AND commission = 0");
    // Bonds' own words for its brand box in the shop (only if nobody wrote one yet).
    $pdo->prepare("UPDATE brands SET about = ?, about_ar = ?, tagline = ?, tagline_ar = ? WHERE slug = 'bonds' AND COALESCE(about, '') = ''")->execute([
        "We don’t just roast coffee. We create coffee programs. ☕ Private label & tailored roasting solutions.",
        "نحن لا نحمّص القهوة فقط، بل نصنع برامج قهوة متكاملة. ☕ حلول تحميص مخصصة وتصنيع بعلامتك الخاصة.",
        'Coffee roasters · private label & tailored roasting', 'محمصة قهوة · تحميص مخصص وعلامة خاصة']);
    // Bonds coffees (each added once; after that they're managed in the dashboard like any product).
    $bondsCoffees = [
        ['bonds-chrome', 'BND-CHR-1KG', 'Chrome', 750, 'caramel, dark chocolate, roasted nuts', 'mild acidity and a full, rich body',
            'كروم', 'كراميل، شوكولاتة داكنة، مكسرات محمصة', 'حموضة خفيفة وقوام غني وممتلئ'],
        ['bonds-amber', 'BND-AMB-1KG', 'Amber', 850, 'dark chocolate, molasses, roasted hazelnut', 'low acidity and a rich body',
            'أمبر', 'شوكولاتة داكنة، عسل أسود، بندق محمص', 'حموضة منخفضة وقوام غني'],
        ['bonds-sienna', 'BND-SIE-1KG', 'Sienna', 895, 'brown sugar, cocoa, roasted nuts', 'low acidity and a medium body',
            'سيينا', 'سكر بني، كاكاو، مكسرات محمصة', 'حموضة منخفضة وقوام متوسط'],
    ];
    // Single origins: [id, sku, name, price, notes, region, variety, process, Arabic name, Arabic notes, Arabic region, Arabic variety, Arabic process]
    $bondsOrigins = [
        ['bonds-ethiopia-limu', 'BND-ETH-1KG', 'Ethiopia Limu', 950, 'dark chocolate, roasted nuts, black tea, brown sugar & orange', 'Limu', 'Heirloom', 'Natural',
            'إثيوبيا ليمو', 'شوكولاتة داكنة، مكسرات محمصة، شاي أسود، سكر بني وبرتقال', 'ليمو', 'هيرلوم', 'طبيعية'],
        ['bonds-brazil-cerrado', 'BND-BRA-1KG', 'Brazil Cerrado', 990, 'toffee, dark chocolate, hazelnut, maple syrup', 'Cerrado', 'Catuai', 'Natural',
            'البرازيل سيرادو', 'توفي، شوكولاتة داكنة، بندق، شراب القيقب', 'سيرادو', 'كاتواي', 'طبيعية'],
    ];
    $hasProduct = $pdo->prepare('SELECT COUNT(*) FROM products WHERE id = ?');
    $addCoffee = $pdo->prepare("INSERT INTO products (id, sku, name, cat, vendor, price, cost, stock, status, sub, descr, features, sort, name_ar, sub_ar, desc_ar, brand_id)
        VALUES (?, ?, ?, 'coffee', 'Bonds Coffee Roasters', ?, 0, 10, 'Active', ?, ?, '[]', (SELECT COALESCE(MAX(sort),0)+1 FROM products), ?, ?, ?, (SELECT id FROM brands WHERE slug = 'bonds'))");
    $addPhoto = $pdo->prepare('INSERT INTO product_images (product_id, path, sort) VALUES (?, ?, 0)');
    foreach ($bondsCoffees as [$id, $sku, $name, $price, $notes, $body, $nameAr, $notesAr, $bodyAr]) {
        $hasProduct->execute([$id]);
        if ((int) $hasProduct->fetchColumn()) continue;
        if (!(int) $pdo->query("SELECT COUNT(*) FROM categories WHERE key = 'coffee'")->fetchColumn()) {
            $pdo->exec("INSERT INTO categories (key, label, descr, label_ar, descr_ar, sort) VALUES ('coffee', 'Coffee', 'Specialty coffee from partner roasters', 'القهوة', 'قهوة مختصة من محامص شريكة', 3)");
        }
        $addCoffee->execute([$id, $sku, $name . ' Coffee Blend — 1 kg', $price, '1 kg coffee beans · ' . $notes,
            $name . ' is a Bonds Coffee Roasters blend with ' . $body . '. Tasting notes: ' . $notes . '.',
            'قهوة ' . $nameAr . ' بلند — 1 كجم', '1 كجم حبوب قهوة · ' . $notesAr, $nameAr . ' بلند من بوندز لتحميص القهوة، ' . $bodyAr . '. النكهات: ' . $notesAr . '.']);
        $addPhoto->execute([$id, 'images/brands/' . $id . '.jpg']);
    }
    $addOrigin = $pdo->prepare("INSERT INTO products (id, sku, name, cat, vendor, price, cost, stock, status, sub, descr, features, sort, name_ar, sub_ar, desc_ar, brand_id)
        VALUES (?, ?, ?, 'coffee', 'Bonds Coffee Roasters', ?, 0, 10, 'Active', ?, ?, ?, (SELECT COALESCE(MAX(sort),0)+1 FROM products), ?, ?, ?, (SELECT id FROM brands WHERE slug = 'bonds'))");
    foreach ($bondsOrigins as [$id, $sku, $name, $price, $notes, $region, $variety, $process, $nameAr, $notesAr, $regionAr, $varietyAr, $processAr]) {
        $hasProduct->execute([$id]);
        if ((int) $hasProduct->fetchColumn()) continue;
        $addOrigin->execute([$id, $sku, $name . ' — 1 kg', $price, '1 kg single-origin coffee beans · ' . $notes,
            $name . ' is a single-origin coffee roasted by Bonds Coffee Roasters. Tasting notes: ' . $notes . '. Region: ' . $region . ' · Variety: ' . $variety . ' · Process: ' . $process . '.',
            json_encode(['Region: ' . $region, 'Variety: ' . $variety, 'Process: ' . $process, 'Notes: ' . $notes], JSON_UNESCAPED_UNICODE),
            $nameAr . ' — 1 كجم', '1 كجم حبوب قهوة أحادية المصدر · ' . $notesAr,
            $nameAr . ' قهوة أحادية المصدر من تحميص بوندز. النكهات: ' . $notesAr . '. المنطقة: ' . $regionAr . ' · السلالة: ' . $varietyAr . ' · المعالجة: ' . $processAr . '.']);
        $addPhoto->execute([$id, 'images/brands/' . $id . '.jpg']);
    }
    // Bonds coffees in two sizes: 1 kg (the listed price) and 250 g (a quarter of it). Done once per
    // product; the 1 kg size keeps the stock the product already had.
    $sizeless = $pdo->query("SELECT id, name, name_ar, sub, sub_ar, price, stock FROM products WHERE id LIKE 'bonds-%' AND COALESCE(variants, '[]') IN ('', '[]')")->fetchAll();
    $setSizes = $pdo->prepare("UPDATE products SET variants = ?, stock = ?, name = ?, name_ar = ?, sub = ?, sub_ar = ?, updated_at = datetime('now') WHERE id = ?");
    foreach ($sizeless as $p) {
        $kg = (float) $p['price'];
        $variants = [
            ['id' => 'kg1', 'label' => '1 kg', 'sku' => '', 'stock' => (int) $p['stock'], 'price' => $kg, 'tiers' => []],
            ['id' => 'g250', 'label' => '250 g', 'sku' => '', 'stock' => 10, 'price' => round($kg / 4, 2), 'tiers' => []],
        ];
        $setSizes->execute([json_encode($variants), (int) $p['stock'] + 10,
            preg_replace('/ — 1 kg$/u', '', $p['name']), preg_replace('/ — 1 كجم$/u', '', (string) $p['name_ar']),
            preg_replace('/^1 kg /', '1 kg or 250 g · ', (string) $p['sub']), preg_replace('/^1 كجم /u', '1 كجم أو 250 جم · ', (string) $p['sub_ar']), $p['id']]);
    }
    // Partner brand pricing: the brand's price for the main size + your margin = the shop price.
    $prodCols = $pdo->query('PRAGMA table_info(products)')->fetchAll(PDO::FETCH_COLUMN, 1);
    if (!in_array('brand_price', $prodCols, true)) $pdo->exec('ALTER TABLE products ADD COLUMN brand_price REAL NOT NULL DEFAULT 0');
    if (!in_array('margin_pct', $prodCols, true)) $pdo->exec('ALTER TABLE products ADD COLUMN margin_pct REAL DEFAULT NULL');
    $brandCols = $pdo->query('PRAGMA table_info(brands)')->fetchAll(PDO::FETCH_COLUMN, 1);
    if (!in_array('margin', $brandCols, true)) $pdo->exec('ALTER TABLE brands ADD COLUMN margin REAL NOT NULL DEFAULT 0');
    // Bonds coffees: today's 1 kg price becomes the Bonds price; 250 g follows it as a quarter.
    foreach ($pdo->query("SELECT id, variants FROM products WHERE id LIKE 'bonds-%' AND brand_price = 0")->fetchAll() as $p) {
        $vs = json_decode((string) $p['variants'], true) ?: [];
        $kg = 0.0;
        foreach ($vs as $v) if (($v['id'] ?? '') === 'kg1') $kg = (float) $v['price'];
        if ($kg <= 0) continue;
        foreach ($vs as &$v) $v['ratio'] = ($v['id'] ?? '') === 'g250' ? 0.25 : (($v['id'] ?? '') === 'kg1' ? 1 : 0);
        unset($v);
        $vs = apply_size_prices($kg, $vs, $kg);
        $pdo->prepare("UPDATE products SET brand_price = ?, price = ?, variants = ? WHERE id = ?")->execute([$kg, $kg, json_encode($vs), $p['id']]);
    }
    // Packing notes: what whoever prepares the order must know (sent to Bosta with the shipment).
    $orderCols = $pdo->query('PRAGMA table_info(orders)')->fetchAll(PDO::FETCH_COLUMN, 1);
    if (!in_array('prep_notes', $orderCols, true)) $pdo->exec("ALTER TABLE orders ADD COLUMN prep_notes TEXT DEFAULT ''");
    $setAr = $pdo->prepare("UPDATE categories SET label_ar = ?, descr_ar = CASE WHEN COALESCE(descr_ar, '') = '' THEN ? ELSE descr_ar END WHERE key = ? AND COALESCE(label_ar, '') = ''");
    foreach ($catAr as $k => [$l, $d]) $setAr->execute([$l, $d, $k]);
    // Search results: an optional hand-written title and description per product and language
    // (left empty, they're written automatically from the product's name, brand, price and text).
    $prodCols = $pdo->query('PRAGMA table_info(products)')->fetchAll(PDO::FETCH_COLUMN, 1);
    foreach (['seo_title', 'seo_title_ar', 'seo_desc', 'seo_desc_ar'] as $col) {
        if (!in_array($col, $prodCols, true)) $pdo->exec("ALTER TABLE products ADD COLUMN $col TEXT DEFAULT ''");
    }
    seed_product_texts($pdo);
    seed_a_stand($pdo);
    seed_qr_coasters($pdo);
}

// Acrylic QR coasters (Google review, social media, InstaPay / wallet payment designs) in four sizes,
// EGP 20 less per piece from 10 pieces of a size. Added once; edited in the admin after that.
function seed_qr_coasters(PDO $pdo): void
{
    $id = 'acr-qr-coaster';
    $has = $pdo->prepare('SELECT COUNT(*) FROM products WHERE id = ?');
    $has->execute([$id]);
    if ((int) $has->fetchColumn()) return;
    $variants = [];
    foreach ([['c5', 5, 45], ['c8', 8, 75], ['c10', 10, 100], ['c12', 12, 120]] as [$vid, $cm, $price]) {
        $variants[] = ['id' => $vid, 'label' => $cm . ' × ' . $cm . ' cm', 'sku' => 'ACR-CST-' . $cm, 'stock' => 100, 'price' => $price,
            'tiers' => [['min' => 10, 'price' => $price - 20]], 'ratio' => 0];
    }
    $pdo->prepare("INSERT INTO products (id, sku, name, cat, vendor, price, cost, stock, status, label, sub, descr, features, sort, variants, personalized, name_ar, sub_ar, desc_ar)
        VALUES (?, 'ACR-CST', ?, 'stands', '', 45, 0, 400, 'Active', 'Special offer', ?, ?, ?, (SELECT COALESCE(MAX(sort),0)+1 FROM products), ?, 1, ?, ?, ?)")->execute([$id,
        'Acrylic QR Coaster — Google Review, Social Media & Payment',
        'UV printed 3 mm acrylic with a suede backing · 4 sizes',
        'A 3 mm acrylic coaster UV printed directly with your design: a Google review QR code, your social media links, or a "Scan to pay" QR for InstaPay and mobile wallets (Vodafone Cash, Orange, Etisalat). A suede (chamois) layer on the back protects the print and the table. Sizes 5 × 5, 8 × 8, 10 × 10 and 12 × 12 cm, with EGP 20 off each piece when you order 10 or more of a size. Ideal for cafés, restaurants, shops and clinics.',
        json_encode(['Sizes: 5 × 5, 8 × 8, 10 × 10, 12 × 12 cm', 'Material: 3 mm acrylic', 'Direct UV print with your design', 'Suede (chamois) backing protects the print', 'EGP 20 off per piece from 10 pieces']),
        json_encode($variants),
        'كوستر أكريليك QR — تقييم جوجل وسوشيال ميديا والدفع',
        'أكريليك 3 مم بطباعة UV وطبقة شامواه · 4 مقاسات',
        'كوستر أكريليك بسُمك 3 مم بطباعة UV مباشرة بتصميمك: كود QR لتقييمات جوجل، أو روابط السوشيال ميديا، أو كود "امسح وادفع" لإنستاباي والمحافظ الإلكترونية (فودافون كاش وأورنج واتصالات). طبقة شامواه في الظهر تحفظ التصميم وتحمي الطاولة. المقاسات 5 × 5 و8 × 8 و10 × 10 و12 × 12 سم، وخصم 20 ج.م على القطعة عند طلب 10 قطع أو أكثر من نفس المقاس. مثالي للكافيهات والمطاعم والمحلات والعيادات.']);
    $pdo->prepare('INSERT INTO product_images (product_id, path, sort) VALUES (?, ?, 0)')->execute([$id, 'images/acrylic-qr-coasters.jpg']);
}

// A-shape acrylic table stand, 8 × 10 cm, UV printed with the customer's design; with or without NFC.
// Added once; after that it's edited in the admin like any product.
function seed_a_stand(PDO $pdo): void
{
    $id = 'acr-a-stand-8x10';
    $has = $pdo->prepare('SELECT COUNT(*) FROM products WHERE id = ?');
    $has->execute([$id]);
    if ((int) $has->fetchColumn()) return;
    $variants = [
        ['id' => 'std', 'label' => 'Without NFC', 'sku' => 'ACR-A810', 'stock' => 100, 'price' => 230, 'tiers' => [], 'ratio' => 0],
        ['id' => 'nfc', 'label' => 'With NFC', 'sku' => 'ACR-A810-NFC', 'stock' => 100, 'price' => 250, 'tiers' => [], 'ratio' => 0],
    ];
    $pdo->prepare("INSERT INTO products (id, sku, name, cat, vendor, price, cost, stock, status, sub, descr, features, sort, variants, personalized, name_ar, sub_ar, desc_ar)
        VALUES (?, 'ACR-A810', ?, 'stands', '', 230, 0, 200, 'Active', ?, ?, ?, (SELECT COALESCE(MAX(sort),0)+1 FROM products), ?, 1, ?, ?, ?)")->execute([$id,
        'A-Shape Acrylic Table Stand — 8 × 10 cm',
        'Printed with your logo, table number or menu QR · 3 mm acrylic',
        'An A-shape table stand in 3 mm acrylic, 8 × 10 cm, UV printed directly on the acrylic (no stickers) with your logo, table number, menu QR code or Wi-Fi details. Add NFC and guests just tap their phone to open your menu, Google review page or any link. Ideal for cafés, restaurants and hotels.',
        json_encode(['Size: 8 × 10 cm', 'Material: 3 mm acrylic', 'Direct UV print with your design', 'Optional NFC chip (tap to open any link)']),
        json_encode($variants),
        'ستاند طاولة أكريليك على شكل A — ‏8 × 10 سم',
        'مطبوع بشعارك أو رقم الطاولة أو QR المنيو · أكريليك 3 مم',
        'ستاند طاولة على شكل حرف A من الأكريليك بسُمك 3 مم، مقاس 8 × 10 سم، بطباعة UV مباشرة على الأكريليك (بدون ستيكر) بشعارك أو رقم الطاولة أو كود QR للمنيو أو بيانات الواي فاي. أضف شريحة NFC ويكفي أن يقرّب الضيف هاتفه ليفتح المنيو أو صفحة تقييم جوجل أو أي رابط. مثالي للكافيهات والمطاعم والفنادق.']);
    $pdo->prepare('INSERT INTO product_images (product_id, path, sort) VALUES (?, ?, 0)')->execute([$id, 'images/acrylic-a-stand-table.jpg']);
}

// Arabic (and missing English) names and descriptions for the products that had none, so both
// language versions of every product page have real text. Only empty fields are filled; a name is
// only tidied while it's still exactly the original one.
function seed_product_texts(PDO $pdo): void
{
    $face = ' من ذا فيس شوب';
    $texts = [
        'co4' => ['ar' => ['سيروم تانجرين فيتا سي للتفتيح', 'جمال نظيف، فيتامين سي من اليوسفي', 'سيروم لتفتيح البشرة من خط Clean Beauty' . $face . '، بتركيبة فيتامين سي المستخلص من اليوسفي (التانجرين).']],
        'co5' => ['ar' => ['غسول بيرش جوس المرطب', '150 مل، غسول أمبول مرطب', 'غسول مرطب من خط Birch Juice من راوند لاب، يعيد الترطيب للبشرة وينعش البشرة المتعبة.']],
        'co6' => ['ar' => ['كريم العين النباتي رايس ووتر برايت', '20 مل، نباتي، مستخلص أرز مخمّر', 'كريم عين نباتي (فيجان) من خط Rice Water Bright' . $face . '. مستخلص أرز مخمّر لمدة 30 يومًا مع حمض الهيالورونيك والنياسيناميد لتفتيح منطقة تحت العين.']],
        'co7' => ['ar' => ['بودرة غسول الإنزيم رايس ووتر برايت', '55 جم، غسول إنزيمي لطيف', 'بودرة غسول بالإنزيمات من خط Rice Water Bright' . $face . '، لتنظيف عميق ولطيف للبشرة.']],
        'nfc1' => ['ar' => ['كارت NFC لتقييمات جوجل — أسود', 'كارت تقييم باللمس، بدون تطبيق', 'كارت NFC يفتح صفحة تقييمك على جوجل فورًا — يكفي أن يقرّب العميل هاتفه من الكارت، دون تطبيق أو كتابة. اشترِ 3 واحصل على الرابع مجانًا. متوفر أيضًا باللون الأبيض.']],
        'nfc2' => ['ar' => ['كارت NFC لتقييمات جوجل — أبيض', 'كارت تقييم باللمس، بدون تطبيق', 'كارت NFC يفتح صفحة تقييمك على جوجل فورًا — يكفي أن يقرّب العميل هاتفه من الكارت، دون تطبيق أو كتابة. اشترِ 3 واحصل على الرابع مجانًا. متوفر أيضًا باللون الأسود.']],
        'nfc3' => ['ar' => ['ميدالية NFC لتقييمات جوجل', 'ميدالية تقييم باللمس، بدون تطبيق', 'ميدالية مفاتيح NFC تفتح صفحة تقييمك على جوجل فورًا — يكفي أن يقرّب العميل هاتفه منها، دون تطبيق أو كتابة.']],
        'nfc4' => ['ar' => ['ستاند عرض NFC + كود QR — ‏12×18 سم', 'ستاند مكتبي، لمس أو مسح للتقييم', 'ستاند عرض مكتبي بخاصية اللمس NFC ومسح كود QR، يوصّل عملاءك مباشرة إلى صفحة تقييمك على جوجل. متوفر أيضًا بمقاس 10×15 سم.']],
        'nfc5' => ['ar' => ['ستاند عرض NFC + كود QR — ‏10×15 سم', 'ستاند مكتبي، لمس أو مسح للتقييم', 'ستاند عرض مكتبي بخاصية اللمس NFC ومسح كود QR، يوصّل عملاءك مباشرة إلى صفحة تقييمك على جوجل. متوفر أيضًا بمقاس 12×18 سم.']],
    ];
    // The clear L-shaped acrylic sign holders: [id, original name, size word, cm, uses].
    $holders = [
        ['ptme37e9715', 'Acrylic Stand A5 (15cm*21cm)', 'A5', '15 × 21'],
        ['ptme5nra4d2', 'Acrylic Stand (10cm*10cm)', '', '10 × 10'],
        ['ptme6sg3d83', 'Acrylic Stand A4(21cm * 29.7cm)', 'A4', '21 × 29.7'],
        ['ptmkyia3492', 'Acrylic Stand A6 (10cm*15cm)', 'A6', '10 × 15'],
    ];
    foreach ($holders as [$id, $old, $size, $cm]) {
        $sheet = $size ? 'an ' . $size . ' sheet (' . $cm . ' cm)' : 'a ' . $cm . ' cm card';
        $sheetAr = $size ? 'ورقة مقاس ' . $size . ' ‏(' . $cm . ' سم)' : 'كارت مقاس ' . $cm . ' سم';
        $texts[$id] = [
            'name' => [$old, 'Acrylic Stand ' . ($size ? $size . ' — ' : '') . $cm . ' cm'],
            'en' => ['Clear L-shape sign holder for menus, prices & QR codes',
                'A clear acrylic L-shape stand that holds ' . $sheet . ' upright on a counter or table. Insert a menu, price list, QR code or promo flyer and change it anytime. Ideal for cafés, restaurants, clinics, shops and events.'],
            'ar' => ['ستاند أكريليك ' . ($size ? $size . ' — ' : '') . '‏' . $cm . ' سم', 'حامل لافتات شفاف على شكل L للمنيو والأسعار وأكواد QR',
                'ستاند أكريليك شفاف على شكل حرف L يحمل ' . $sheetAr . ' بشكل عمودي على الكاونتر أو الطاولة. ضع فيه المنيو أو قائمة الأسعار أو كود QR أو إعلان عرض، وغيّره في أي وقت. مثالي للكافيهات والمطاعم والعيادات والمحلات والمعارض.'],
        ];
    }
    $fill = function (string $col, string $id, string $value) use ($pdo) {
        $pdo->prepare("UPDATE products SET $col = ? WHERE id = ? AND COALESCE($col, '') = ''")->execute([$value, $id]);
    };
    foreach ($texts as $id => $t) {
        if (isset($t['name'])) $pdo->prepare('UPDATE products SET name = ? WHERE id = ? AND name = ?')->execute([$t['name'][1], $id, $t['name'][0]]);
        if (isset($t['en'])) { $fill('sub', $id, $t['en'][0]); $fill('descr', $id, $t['en'][1]); }
        $fill('name_ar', $id, $t['ar'][0]); $fill('sub_ar', $id, $t['ar'][1]); $fill('desc_ar', $id, $t['ar'][2]);
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
require __DIR__ . '/paymob.php';
require __DIR__ . '/customers.php';
require __DIR__ . '/brands.php';
require __DIR__ . '/seo-lib.php';

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
        'nameAr' => (string) ($p['name_ar'] ?? ''), 'subAr' => (string) ($p['sub_ar'] ?? ''), 'descAr' => (string) ($p['desc_ar'] ?? ''),
        'sub' => $p['sub'], 'desc' => $p['descr'], 'features' => json_decode($p['features'] ?: '[]', true) ?: [],
        'period' => $p['period'], 'sort' => (int) $p['sort'], 'images' => $images,
        'variants' => product_json($p, 'variants'), 'tiers' => product_json($p, 'tiers'), 'addons' => product_json($p, 'addons'),
        'personalized' => (bool) ($p['personalized'] ?? 0), 'fromPrice' => from_price($p),
        'brandId' => isset($p['brand_id']) && $p['brand_id'] !== null ? (int) $p['brand_id'] : null,
        'seoTitle' => (string) ($p['seo_title'] ?? ''), 'seoTitleAr' => (string) ($p['seo_title_ar'] ?? ''),
        'seoDesc' => (string) ($p['seo_desc'] ?? ''), 'seoDescAr' => (string) ($p['seo_desc_ar'] ?? ''),
        'brandPrice' => (float) ($p['brand_price'] ?? 0), 'marginPct' => isset($p['margin_pct']) && $p['margin_pct'] !== null ? (float) $p['margin_pct'] : null,
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
    // Delivered: whatever was still owed was collected by the courier or in person.
    if ($status === 'Delivered' && $o['status'] !== 'Delivered') {
        $due = round((float) $o['total'] - order_paid($id), 2);
        if ($due > 0) add_payment($id, $due, 'cod', 'Collected on delivery', null);
    }
    // Returned or cancelled: the courier's collection never happened, so drop the automatic delivery payment.
    // Payments the team entered (deposits, transfers, online) stay and show as a refund to settle.
    if (!$isOpen && $wasOpen) {
        $pdo->prepare("DELETE FROM payments WHERE order_id = ? AND method = 'cod' AND note = 'Collected on delivery' AND created_by IS NULL")->execute([$id]);
    }
    if ($own) tx_commit();
    if ($status !== $o['status']) log_activity(current_user_quiet(), 'Order ' . $status, order_number($id));
    return $o;
}

// ---------- promo codes ----------
function promo_uses(string $code): int
{
    $st = db()->prepare("SELECT COUNT(*) FROM orders WHERE promo = ? COLLATE NOCASE AND status != 'Cancelled'");
    $st->execute([$code]);
    return (int) $st->fetchColumn();
}

// Check a code against an items subtotal. Returns [promo row, discount]; throws ShopError with a clear reason.
function promo_check(string $code, float $subtotal): array
{
    // Case-sensitive: the customer must type the code exactly as it was created.
    $code = trim($code);
    $st = db()->prepare('SELECT * FROM promos WHERE code = ? COLLATE BINARY');
    $st->execute([$code]);
    $p = $st->fetch();
    if (!$p || !(int) $p['active']) throw new ShopError('This promo code is not valid.');
    $today = (new DateTime('now', new DateTimeZone('Africa/Cairo')))->format('Y-m-d');
    if ($p['starts_at'] && $today < $p['starts_at']) throw new ShopError('This promo code is not active yet.');
    if ($p['expires_at'] && $today > $p['expires_at']) throw new ShopError('This promo code has expired.');
    if ($p['max_uses'] !== null && promo_uses($p['code']) >= (int) $p['max_uses']) throw new ShopError('This promo code has been fully used.');
    if ((float) $p['min_order'] > 0 && $subtotal > 0 && $subtotal < (float) $p['min_order'])
        throw new ShopError('This code needs an order of EGP ' . number_format((float) $p['min_order']) . ' or more.');
    if ($p['kind'] === 'shipping') return [$p, 0.0]; // free delivery: the order drops the delivery fee instead
    $discount = $p['kind'] === 'fixed' ? min($subtotal, (float) $p['value']) : round($subtotal * min(100, (float) $p['value']) / 100, 2);
    return [$p, round($discount, 2)];
}

function promo_label(array $p): string
{
    if ($p['kind'] === 'shipping') return 'Free delivery';
    return $p['kind'] === 'fixed' ? 'EGP ' . number_format((float) $p['value']) . ' off' : rtrim(rtrim(number_format((float) $p['value'], 2), '0'), '.') . '% off';
}

// ---------- payments ----------
const PAYMENT_KINDS = ['cash' => 'Cash', 'bank' => 'Bank transfer', 'wallet' => 'InstaPay / wallet', 'cod' => 'Collected on delivery', 'paymob' => 'Paid online (Paymob)'];

function order_paid(int $orderId): float
{
    $st = db()->prepare('SELECT COALESCE(SUM(amount), 0) FROM payments WHERE order_id = ?');
    $st->execute([$orderId]);
    return round((float) $st->fetchColumn(), 2);
}

function add_payment(int $orderId, float $amount, string $method, string $note, ?int $userId): void
{
    if (!array_key_exists($method, PAYMENT_KINDS)) $method = 'cash';
    db()->prepare('INSERT INTO payments (order_id, amount, method, note, created_by) VALUES (?, ?, ?, ?, ?)')
        ->execute([$orderId, round($amount, 2), $method, mb_substr($note, 0, 200), $userId]);
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
