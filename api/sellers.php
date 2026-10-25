<?php
// "Sell with us": brands and makers send their products from /sell.html; the team reviews them in
// Partner brands → Seller requests, agrees a commission, and Approve turns the request into a partner
// brand (hidden until ready) with its products as drafts. Each request is also a lead for follow-up.

declare(strict_types=1);

const SELLER_STATUSES = ['New', 'Contacted', 'Approved', 'Rejected'];
// What sellers can choose on the form, and the shop category each one goes to when approved.
const SELLER_CATEGORIES = ['Coffee & drinks' => 'coffee', 'Skincare & beauty' => 'cosmetics', 'Food & sweets' => 'gift', 'Handmade & gifts' => 'gift',
    'Fashion & accessories' => 'gift', 'Home & decor' => 'gift', 'Pets' => 'pets', 'Business products' => 'stands', 'Other' => 'gift'];

function sellers_migrate(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS seller_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT DEFAULT '',
        brand TEXT NOT NULL,
        city TEXT DEFAULT '',
        link TEXT DEFAULT '',
        category TEXT DEFAULT '',
        stock_mode TEXT DEFAULT '',
        products TEXT NOT NULL DEFAULT '[]',
        notes TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'New',
        team_note TEXT DEFAULT '',
        commission REAL,
        lead_id INTEGER,
        brand_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_seller_status ON seller_requests(status, id)');
}

// A request from the public form. Products come as fields product_name_0…4 (+ price, desc) and an
// optional photo per product (photo_0…4).
function seller_apply(array $d, array $files): int
{
    $name = str_in($d['name'] ?? '', 120);
    $phone = str_in($d['phone'] ?? '', 40);
    $brand = str_in($d['brand'] ?? '', 120);
    if ($name === '' || $brand === '') fail('Please enter your name and your brand or shop name.');
    if (!phone_key($phone)) fail('Please enter a WhatsApp number we can reach you on.');
    $email = str_in($d['email'] ?? '', 160);
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Please check the email address.');
    $link = str_in($d['link'] ?? '', 300);
    if ($link !== '' && !preg_match('~^https?://~i', $link)) $link = 'https://' . $link;
    $category = array_key_exists($d['category'] ?? '', SELLER_CATEGORIES) ? $d['category'] : 'Other';
    $stock = in_array($d['stock_mode'] ?? '', ['Ready stock', 'Made to order'], true) ? $d['stock_mode'] : '';

    // Products first (photos are only saved once everything else is valid).
    $rows = [];
    for ($i = 0; $i < 5; $i++) {
        $pn = str_in($d['product_name_' . $i] ?? '', 120);
        if ($pn === '') continue;
        $price = round(max(0, min(1000000, (float) ($d['product_price_' . $i] ?? 0))), 2);
        $rows[$i] = ['name' => $pn, 'price' => $price, 'desc' => str_in($d['product_desc_' . $i] ?? '', 400), 'photo' => ''];
    }
    if (!$rows) fail('Please add at least one product with its name.');
    foreach ($rows as $i => &$r) {
        $f = $files['photo_' . $i] ?? null;
        if ($f && ($f['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK && is_uploaded_file($f['tmp_name'])) $r['photo'] = store_image($f, 'seller');
    }
    unset($r);

    $notes = str_in($d['notes'] ?? '', 1000);
    db()->prepare('INSERT INTO seller_requests (name, phone, email, brand, city, link, category, stock_mode, products, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$name, $phone, $email, $brand, str_in($d['city'] ?? '', 80), $link, $category, $stock, json_encode(array_values($rows), JSON_UNESCAPED_UNICODE), $notes]);
    $id = (int) db()->lastInsertId();

    // Also a lead, so the team follows up like any other enquiry.
    $summary = 'Wants to sell with us: ' . $brand . ' (' . $category . ')' . "\n" . implode("\n", array_map(function ($r) { return '· ' . $r['name'] . ($r['price'] ? ' — EGP ' . $r['price'] : ''); }, $rows))
        . ($notes !== '' ? "\n" . $notes : '');
    $existing = find_lead(phone_key($phone), email_key($email));
    if ($existing) {
        touch_lead($existing, date('Y-m-d') . ' · ' . $summary, 'New', null, $phone);
        $leadId = (int) $existing['id'];
    } else {
        $leadId = insert_lead(['name' => $name, 'contact' => $phone, 'cat' => 'Sell with us', 'source' => 'Sell with us', 'status' => 'New', 'notes' => $summary]);
    }
    db()->prepare('UPDATE seller_requests SET lead_id = ? WHERE id = ?')->execute([$leadId, $id]);
    log_activity(null, 'New seller request', $brand . ' · ' . $name);
    notify_new_lead(['name' => $name . ' (' . $brand . ')', 'contact' => $phone, 'cat' => 'Sell with us · ' . $category, 'source' => 'Sell with us form', 'notes' => $summary]);
    // Owners and managers who connected Telegram hear about it straight away (after the answer is sent).
    register_shutdown_function(function () use ($brand, $name, $category, $rows) {
        if (!function_exists('tg_ready') || !tg_ready()) return;
        $msg = '🛍️ <b>New seller request</b>' . "\n" . tg_h($brand) . ' · ' . tg_h($name) . "\n" . tg_h($category) . ' · ' . count($rows) . (count($rows) === 1 ? ' product' : ' products');
        foreach (tg_managers() as $m) tg_send_user($m, $msg, ['Open requests', rtrim((string) cfg('site_url'), '/') . '/admin/#brands']);
    });
    return $id;
}

function seller_row(array $r): array
{
    return ['id' => (int) $r['id'], 'name' => $r['name'], 'phone' => $r['phone'], 'email' => $r['email'], 'brand' => $r['brand'], 'city' => $r['city'],
        'link' => $r['link'], 'category' => $r['category'], 'shopCat' => SELLER_CATEGORIES[$r['category']] ?? 'gift', 'stock' => $r['stock_mode'],
        'products' => json_decode((string) $r['products'], true) ?: [], 'notes' => $r['notes'], 'status' => $r['status'], 'teamNote' => $r['team_note'],
        'commission' => $r['commission'] === null ? null : (float) $r['commission'], 'leadId' => $r['lead_id'] === null ? null : (int) $r['lead_id'],
        'brandId' => $r['brand_id'] === null ? null : (int) $r['brand_id'], 'createdAt' => $r['created_at']];
}

function seller_list(): array
{
    $rows = db()->query("SELECT * FROM seller_requests ORDER BY CASE status WHEN 'New' THEN 0 WHEN 'Contacted' THEN 1 ELSE 2 END, id DESC LIMIT 300")->fetchAll();
    return array_map('seller_row', $rows);
}

function seller_get(int $id): array
{
    $st = db()->prepare('SELECT * FROM seller_requests WHERE id = ?');
    $st->execute([$id]);
    $r = $st->fetch();
    if (!$r) fail('Request not found.', 404);
    return $r;
}

// Approve: a partner brand (hidden until the team turns it on) with the agreed commission, and each
// product as a draft with its photo, price and description, ready to finish in Products.
function seller_approve(int $id, float $commission, string $cat): array
{
    $r = seller_get($id);
    if ($r['brand_id']) fail('This request was already approved.');
    $pdo = db();
    if (!(int) $pdo->query('SELECT COUNT(*) FROM categories WHERE key = ' . $pdo->quote($cat))->fetchColumn()) fail('Choose a shop category.');
    $commission = max(0, min(100, round($commission, 2)));
    $slugify = function (string $s, string $fallback): string { return trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($s)), '-') ?: $fallback; };
    tx_begin();
    $slug = $slugify($r['brand'], 'brand-' . $id);
    $n = 2; $base = $slug;
    $exists = $pdo->prepare('SELECT COUNT(*) FROM brands WHERE slug = ?');
    while (true) { $exists->execute([$slug]); if (!(int) $exists->fetchColumn()) break; $slug = $base . '-' . $n++; }
    $pdo->prepare("INSERT INTO brands (slug, name, tagline, link, commission, active, sort) VALUES (?, ?, ?, ?, ?, 0, (SELECT COALESCE(MAX(sort),0)+1 FROM brands))")
        ->execute([$slug, $r['brand'], $r['category'], $r['link'], $commission]);
    $brandId = (int) $pdo->lastInsertId();
    $hasId = $pdo->prepare('SELECT COUNT(*) FROM products WHERE id = ?');
    $add = $pdo->prepare("INSERT INTO products (id, sku, name, cat, vendor, price, brand_price, cost, stock, status, sub, descr, features, sort, brand_id)
        VALUES (?, '', ?, ?, ?, ?, ?, 0, 0, 'Draft', '', ?, '[]', (SELECT COALESCE(MAX(sort),0)+1 FROM products), ?)");
    $photo = $pdo->prepare('INSERT INTO product_images (product_id, path, sort) VALUES (?, ?, 0)');
    $made = [];
    foreach (json_decode((string) $r['products'], true) ?: [] as $p) {
        $pid = $slug . '-' . $slugify((string) $p['name'], 'item');
        $pid = substr($pid, 0, 60); $try = $pid; $k = 2;
        while (true) { $hasId->execute([$try]); if (!(int) $hasId->fetchColumn()) break; $try = $pid . '-' . $k++; }
        $add->execute([$try, $p['name'], $cat, $r['brand'], (float) $p['price'], (float) $p['price'], (string) ($p['desc'] ?? ''), $brandId]);
        if (!empty($p['photo'])) $photo->execute([$try, $p['photo']]);
        $made[] = $try;
    }
    $pdo->prepare("UPDATE seller_requests SET status = 'Approved', commission = ?, brand_id = ?, updated_at = datetime('now') WHERE id = ?")->execute([$commission, $brandId, $id]);
    tx_commit();
    return ['brandId' => $brandId, 'products' => $made];
}
