<?php
// QR codes for Google reviews, sold from the free tool (google-review-link.html).
//
// Anyone can make a review link and see the card; downloading needs a shop account (email code sign-in,
// api/customers.php). Each account gets QR_FREE codes free, then buys packs with Paymob. One QR = one
// business: making it uses 1 from the balance; downloading or printing it again is free.
//
// Each business also gets its own page, shop.wheretospot.com/r/<slug> (api/qr-page.php): a big review
// button plus WhatsApp, Instagram, Facebook and other links. Its QR leads to the review box or to the page.
//
// A pack is bought as a normal order (source "QR tool", status "Awaiting payment"); when Paymob confirms
// the payment (api/paymob.php → qr_order_paid) the codes are added and the order is marked Delivered.

const QR_FREE = 2;
const QR_PACKS = [
    'starter' => ['credits' => 5, 'price' => 300, 'en' => 'Starter', 'ar' => 'البداية'],
    'business' => ['credits' => 15, 'price' => 750, 'en' => 'Business', 'ar' => 'الأعمال'],
    'agency' => ['credits' => 40, 'price' => 1600, 'en' => 'Agency', 'ar' => 'الوكالات'],
];
// Links a business page can show, in this order. 'value' is a URL, a handle or a number depending on the type.
const QR_LINK_TYPES = ['whatsapp', 'phone', 'instagram', 'facebook', 'tiktok', 'website', 'menu', 'location', 'email', 'custom'];
const QR_COLORS = ['#A8552F', '#22201D', '#2C5DA8', '#1F7A4D', '#7D3C93', '#A33650'];

function qr_migrate(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS qr_businesses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL DEFAULT '',
        review_link TEXT NOT NULL,
        cid TEXT DEFAULT '', place_id TEXT DEFAULT '', maps TEXT DEFAULT '', lat REAL, lng REAL,
        target TEXT NOT NULL DEFAULT 'review',
        card_lang TEXT NOT NULL DEFAULT 'both',
        page TEXT NOT NULL DEFAULT '{}',
        views INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_qr_businesses_customer ON qr_businesses(customer_id)');
    // The balance: +QR_FREE once, +pack size when paid, −1 per new business.
    $pdo->exec("CREATE TABLE IF NOT EXISTS qr_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        order_id INTEGER, business_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_qr_ledger_customer ON qr_ledger(customer_id)');
}

function qr_balance(int $customerId): int
{
    $db = db();
    $has = $db->prepare("SELECT 1 FROM qr_ledger WHERE customer_id = ? AND reason = 'free'");
    $has->execute([$customerId]);
    if (!$has->fetchColumn()) $db->prepare("INSERT INTO qr_ledger (customer_id, delta, reason) VALUES (?, ?, 'free')")->execute([$customerId, QR_FREE]);
    $st = $db->prepare('SELECT COALESCE(SUM(delta), 0) FROM qr_ledger WHERE customer_id = ?');
    $st->execute([$customerId]);
    return (int) $st->fetchColumn();
}

function qr_page_url(string $slug): string
{
    return rtrim((string) cfg('site_url'), '/') . '/r/' . rawurlencode($slug);
}

function qr_business_out(array $b): array
{
    $page = json_decode((string) $b['page'], true) ?: [];
    return ['id' => (int) $b['id'], 'slug' => $b['slug'], 'name' => $b['name'], 'link' => $b['review_link'], 'cid' => $b['cid'], 'placeId' => $b['place_id'],
        'maps' => $b['maps'], 'lat' => $b['lat'] !== null ? (float) $b['lat'] : null, 'lng' => $b['lng'] !== null ? (float) $b['lng'] : null,
        'target' => $b['target'], 'cardLang' => $b['card_lang'], 'pageUrl' => qr_page_url($b['slug']), 'page' => qr_page_clean($page), 'views' => (int) $b['views'],
        'qr' => $b['target'] === 'page' ? qr_page_url($b['slug']) : $b['review_link'], 'createdAt' => $b['created_at']];
}

function qr_businesses(int $customerId): array
{
    $st = db()->prepare('SELECT * FROM qr_businesses WHERE customer_id = ? ORDER BY id DESC');
    $st->execute([$customerId]);
    return array_map('qr_business_out', $st->fetchAll());
}

// Only Google review links are accepted: the owner's g.page link or Google's writereview link.
function qr_valid_review_link(string $link): bool
{
    return (bool) preg_match('~^https://(g\.page/r/[A-Za-z0-9_-]{10,40}/review|search\.google\.com/local/writereview\?placeid=[A-Za-z0-9_-]{10,300})$~', $link);
}

function qr_slug(string $name): string
{
    $base = strtolower(trim(preg_replace('/[^A-Za-z0-9]+/', '-', iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $name) ?: ''), '-'));
    $base = substr($base, 0, 40) ?: 'business';
    $st = db()->prepare('SELECT 1 FROM qr_businesses WHERE slug = ?');
    for ($i = 0; $i < 20; $i++) {
        $slug = $base . '-' . substr(bin2hex(random_bytes(3)), 0, 4);
        $st->execute([$slug]);
        if (!$st->fetchColumn()) return $slug;
    }
    return $base . '-' . bin2hex(random_bytes(6));
}

// Make a business (uses 1 QR from the balance) or, for a link this account already has, return that one free.
function qr_create(array $c, array $in): array
{
    $link = trim((string) ($in['link'] ?? ''));
    if (!qr_valid_review_link($link)) throw new ShopError('That isn’t a Google review link. Make the link with the tool first.');
    $db = db();
    $st = $db->prepare('SELECT * FROM qr_businesses WHERE customer_id = ? AND review_link = ?');
    $st->execute([(int) $c['id'], $link]);
    if ($b = $st->fetch()) return qr_business_out($b);
    tx_begin();
    try {
        if (qr_balance((int) $c['id']) < 1) throw new ShopError('You’ve used all your QR codes. Buy a pack to make more.', 402);
        $name = str_in($in['name'] ?? '', 80);
        $lang = in_array($in['card_lang'] ?? '', ['ar', 'en', 'both'], true) ? $in['card_lang'] : 'both';
        $page = ['lang' => preg_match('/\p{Arabic}/u', $name) ? 'ar' : 'en', 'color' => QR_COLORS[0], 'links' => []];
        if (!empty($in['maps']) && preg_match('~^https://(maps\.google\.com|www\.google\.com/maps)/~', (string) $in['maps'])) $page['links'][] = ['type' => 'location', 'value' => (string) $in['maps']];
        $db->prepare('INSERT INTO qr_businesses (customer_id, slug, name, review_link, cid, place_id, maps, lat, lng, target, card_lang, page) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([(int) $c['id'], qr_slug($name), $name, $link, preg_replace('/\D/', '', (string) ($in['cid'] ?? '')), str_in($in['place_id'] ?? '', 300),
                str_in($in['maps'] ?? '', 300), is_numeric($in['lat'] ?? null) ? (float) $in['lat'] : null, is_numeric($in['lng'] ?? null) ? (float) $in['lng'] : null,
                ($in['target'] ?? '') === 'page' ? 'page' : 'review', $lang, json_encode($page, JSON_UNESCAPED_UNICODE)]);
        $id = (int) $db->lastInsertId();
        $db->prepare("INSERT INTO qr_ledger (customer_id, delta, reason, business_id) VALUES (?, -1, 'qr', ?)")->execute([(int) $c['id'], $id]);
        tx_commit();
    } catch (Throwable $e) { tx_rollback(); throw $e; }
    log_activity(null, 'QR tool: new business', $name . ' · ' . $c['email']);
    return qr_business_row((int) $c['id'], $id);
}

function qr_business_row(int $customerId, int $id): array
{
    $st = db()->prepare('SELECT * FROM qr_businesses WHERE id = ? AND customer_id = ?');
    $st->execute([$id, $customerId]);
    $b = $st->fetch();
    if (!$b) throw new ShopError('QR code not found.', 404);
    return qr_business_out($b);
}

// What a link looks like when shown: its full URL (from a handle or number) and its button text.
function qr_link_href(array $l): string
{
    $v = trim((string) ($l['value'] ?? ''));
    if ($v === '') return '';
    $digits = preg_replace('/\D/', '', strtr($v, ['٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9']));
    $handle = ltrim(preg_replace('~^https?://(www\.)?[^/]+/~i', '', $v), '@/');
    switch ($l['type']) {
        case 'whatsapp': $id = function_exists('wa_id_from_phone') ? wa_id_from_phone($digits) : $digits; return $id ? 'https://wa.me/' . $id : '';
        case 'phone': return strlen($digits) >= 6 ? 'tel:+' . (strpos($digits, '0') === 0 ? '20' . substr($digits, 1) : $digits) : '';
        case 'email': return filter_var($v, FILTER_VALIDATE_EMAIL) ? 'mailto:' . $v : '';
        case 'instagram': return preg_match('~^https?://~i', $v) ? $v : ($handle !== '' ? 'https://instagram.com/' . rawurlencode($handle) : '');
        case 'tiktok': return preg_match('~^https?://~i', $v) ? $v : ($handle !== '' ? 'https://www.tiktok.com/@' . rawurlencode($handle) : '');
        default: return preg_match('~^https?://[^\s<>"]+$~i', $v) ? $v : (preg_match('~^[\w.-]+\.[a-z]{2,}(/\S*)?$~i', $v) ? 'https://' . $v : '');
    }
}

// The page settings, cleaned: language, colour, short line, logo and up to 12 links.
function qr_page_clean(array $p): array
{
    $out = ['lang' => ($p['lang'] ?? '') === 'ar' ? 'ar' : 'en', 'color' => in_array($p['color'] ?? '', QR_COLORS, true) ? $p['color'] : QR_COLORS[0],
        'tagline' => mb_substr(trim((string) ($p['tagline'] ?? '')), 0, 140), 'logo' => preg_match('~^uploads/qr/[a-f0-9]{24}\.(jpg|png)$~', (string) ($p['logo'] ?? '')) ? $p['logo'] : '', 'links' => []];
    foreach (array_slice((array) ($p['links'] ?? []), 0, 12) as $l) {
        if (!is_array($l) || !in_array($l['type'] ?? '', QR_LINK_TYPES, true)) continue;
        $l = ['type' => $l['type'], 'value' => mb_substr(trim((string) ($l['value'] ?? '')), 0, 300), 'label' => mb_substr(trim((string) ($l['label'] ?? '')), 0, 40)];
        if ($l['value'] === '' || qr_link_href($l) === '') continue;
        $out['links'][] = $l;
    }
    return $out;
}

function qr_update(array $c, array $in): array
{
    $b = qr_business_row((int) $c['id'], (int) ($in['id'] ?? 0));
    $name = isset($in['name']) ? str_in($in['name'], 80) : $b['name'];
    $target = isset($in['target']) ? ($in['target'] === 'page' ? 'page' : 'review') : $b['target'];
    $lang = in_array($in['card_lang'] ?? '', ['ar', 'en', 'both'], true) ? $in['card_lang'] : $b['cardLang'];
    $page = isset($in['page']) && is_array($in['page']) ? qr_page_clean($in['page']) : $b['page'];
    db()->prepare("UPDATE qr_businesses SET name = ?, target = ?, card_lang = ?, page = ?, updated_at = datetime('now') WHERE id = ? AND customer_id = ?")
        ->execute([$name, $target, $lang, json_encode($page, JSON_UNESCAPED_UNICODE), $b['id'], (int) $c['id']]);
    return qr_business_row((int) $c['id'], $b['id']);
}

// A business logo for its page: checked, resized to 400 px and saved again (nothing else from the file is kept).
function qr_logo(array $c, int $businessId, array $f): array
{
    $b = qr_business_row((int) $c['id'], $businessId);
    if (($f['error'] ?? 1) !== UPLOAD_ERR_OK || $f['size'] > 5 * 1024 * 1024) throw new ShopError('Upload failed. The logo must be a photo under 5 MB.');
    $info = @getimagesize($f['tmp_name']);
    $load = ['image/jpeg' => 'imagecreatefromjpeg', 'image/png' => 'imagecreatefrompng', 'image/webp' => 'imagecreatefromwebp'][$info['mime'] ?? ''] ?? null;
    if (!$load || !function_exists($load) || !($src = @$load($f['tmp_name']))) throw new ShopError('Please upload a JPG, PNG or WebP image.');
    [$w, $h] = [imagesx($src), imagesy($src)];
    $s = min(400, max($w, $h)); $r = $s / max($w, $h);
    $out = imagecreatetruecolor((int) round($w * $r), (int) round($h * $r));
    imagealphablending($out, false); imagesavealpha($out, true);
    imagefill($out, 0, 0, imagecolorallocatealpha($out, 255, 255, 255, 127));
    imagecopyresampled($out, $src, 0, 0, 0, 0, imagesx($out), imagesy($out), $w, $h);
    $dir = dirname(__DIR__) . '/uploads/qr';
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $rel = 'uploads/qr/' . bin2hex(random_bytes(12)) . '.png';
    if (!imagepng($out, dirname(__DIR__) . '/' . $rel, 7)) throw new ShopError('Could not save the logo.');
    $old = $b['page']['logo'];
    if ($old && is_file(dirname(__DIR__) . '/' . $old)) @unlink(dirname(__DIR__) . '/' . $old);
    $page = $b['page']; $page['logo'] = $rel;
    return qr_update($c, ['id' => $businessId, 'page' => $page]);
}

// Buy a pack: an order waiting for Paymob, then Paymob's page.
function qr_buy(array $c, string $pack, string $method): string
{
    if (!isset(QR_PACKS[$pack])) throw new ShopError('Choose a pack.');
    $methods = paymob_visible_methods();
    if (!$methods) throw new ShopError('Online payment isn’t available right now. Message us on WhatsApp to buy QR codes.');
    if (!isset($methods[$method])) $method = array_keys($methods)[0];
    $p = QR_PACKS[$pack];
    $item = ['id' => 'custom', 'name' => 'Google review QR codes — ' . $p['en'] . ' pack (' . $p['credits'] . ')', 'qty' => 1, 'price' => (float) $p['price'], 'total' => (float) $p['price'],
        'cat' => 'services', 'qr_pack' => $pack, 'qr_credits' => $p['credits']];
    db()->prepare("INSERT INTO orders (customer, email, phone, address, city, items, subtotal, discount, shipping, total, promo, payment, source, status, notes, customer_id)
        VALUES (?, ?, ?, '', '', ?, ?, 0, 0, ?, '', ?, 'QR tool', 'Awaiting payment', ?, ?)")
        ->execute([trim((string) $c['name']) !== '' ? $c['name'] : $c['email'], $c['email'], (string) $c['phone'], json_encode([$item], JSON_UNESCAPED_UNICODE),
            $p['price'], $p['price'], $method, 'Digital: QR codes are added to the customer’s account when paid.', (int) $c['id']]);
    return paymob_checkout_url((int) db()->lastInsertId(), $method);
}

// Paymob confirmed a fully paid order: if it's a QR pack, add the codes (once) and mark it Delivered.
function qr_order_paid(int $orderId): void
{
    $st = db()->prepare("SELECT * FROM orders WHERE id = ? AND source = 'QR tool'");
    $st->execute([$orderId]);
    $o = $st->fetch();
    if (!$o || !$o['customer_id']) return;
    $done = db()->prepare('SELECT 1 FROM qr_ledger WHERE order_id = ?');
    $done->execute([$orderId]);
    if ($done->fetchColumn()) return;
    $credits = 0;
    foreach (json_decode((string) $o['items'], true) ?: [] as $i) $credits += (int) ($i['qr_credits'] ?? 0) * max(1, (int) ($i['qty'] ?? 1));
    if ($credits < 1) return;
    qr_balance((int) $o['customer_id']); // the free codes first, so they're never lost
    db()->prepare("INSERT INTO qr_ledger (customer_id, delta, reason, order_id) VALUES (?, ?, 'pack', ?)")->execute([(int) $o['customer_id'], $credits, $orderId]);
    if ($o['status'] !== 'Delivered') set_order_status($orderId, 'Delivered');
    log_activity(null, 'QR tool: pack paid', order_number($orderId) . ' · ' . $credits . ' QR · ' . $o['email']);
}
