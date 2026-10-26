<?php
// Review requests: when an order is delivered (Bosta or the team), the customer gets an email (and a WhatsApp
// message if their chat is open) with a personal link, /rate/<token>, where they rate each product in the order
// without signing in. No review 3 days later → one reminder. Reviews land in the product pages like any
// verified review (api/reviews.php); the team sees and hides them in Products → Reviews.

declare(strict_types=1);

const REVIEW_REMIND_DAYS = 3;

function reviewreq_migrate(PDO $pdo): void
{
    $cols = array_column($pdo->query('PRAGMA table_info(orders)')->fetchAll(), 'name');
    foreach (['review_token' => 'TEXT', 'review_asked_at' => 'TEXT', 'review_reminded_at' => 'TEXT', 'lang' => "TEXT DEFAULT ''"] as $c => $type) {
        if (!in_array($c, $cols, true)) $pdo->exec("ALTER TABLE orders ADD COLUMN $c $type");
    }
    $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_review_token ON orders(review_token)');
}

// The order's personal review link (made the first time it's needed).
function review_url(array $o): string
{
    $t = (string) ($o['review_token'] ?? '');
    if (!preg_match('/^[a-f0-9]{24}$/', $t)) {
        $t = bin2hex(random_bytes(12));
        db()->prepare('UPDATE orders SET review_token = ? WHERE id = ? AND review_token IS NULL')->execute([$t, (int) $o['id']]);
        $st = db()->prepare('SELECT review_token FROM orders WHERE id = ?');
        $st->execute([(int) $o['id']]);
        $t = (string) $st->fetchColumn();
    }
    return rtrim((string) cfg('site_url'), '/') . '/rate/' . $t;
}

// The products of an order that can be reviewed (each once; not custom lines or services).
function review_order_products(array $o): array
{
    $out = [];
    foreach (json_decode((string) $o['items'], true) ?: [] as $i) {
        $id = (string) ($i['id'] ?? '');
        if ($id === '' || $id === 'custom' || ($i['cat'] ?? '') === 'services' || isset($out[$id])) continue;
        $out[$id] = ['id' => $id, 'name' => preg_replace('/ — [^—]*$/u', '', (string) $i['name']) ?: (string) $i['name']];
    }
    return array_values($out);
}

// Delivered just now: ask after the answer has gone back (the status change is never slowed down).
function review_request_queue(int $orderId): void
{
    register_shutdown_function(function () use ($orderId) {
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        elseif (function_exists('litespeed_finish_request')) litespeed_finish_request();
        try { review_request_send($orderId, false); } catch (Throwable $e) { ops_error('Reviews', 'The review request for ' . order_number($orderId) . ' could not be sent', $e); }
    });
}

function review_request_send(int $orderId, bool $reminder): bool
{
    $st = db()->prepare('SELECT * FROM orders WHERE id = ?');
    $st->execute([$orderId]);
    $o = $st->fetch();
    if (!$o || $o['status'] !== 'Delivered' || !review_order_products($o)) return false;
    if (!$reminder && $o['review_asked_at']) return false;
    $url = review_url($o);
    $first = preg_split('/\s+/u', trim((string) $o['customer']))[0] ?? '';
    $ar = $o['lang'] !== 'en'; // most customers are Arabic-speaking; English when they ordered in English
    $sent = false;
    if (filter_var((string) $o['email'], FILTER_VALIDATE_EMAIL)) {
        $title = $reminder ? ($ar ? 'رأيك يهمنا في طلب ' . order_number($orderId) : 'How was order ' . order_number($orderId) . '?')
            : ($ar ? 'وصلك طلبك؟ قيّمه في دقيقة ⭐' : 'Your order arrived — how is it? ⭐');
        $names = implode('، ', array_column(review_order_products($o), 'name'));
        $inner = '<p style="font-size:15px;line-height:1.7">' . ($ar
                ? 'أهلًا ' . h($first) . ' 👋<br>' . ($reminder ? 'لسه ممكن تقيّم طلبك. ' : 'نتمنى يكون طلبك وصل وعجبك. ') . 'رأيك في <b>' . h($names) . '</b> بيساعد عملاء تانيين يختاروا، وبياخد أقل من دقيقة.'
                : 'Hi ' . h($first) . ' 👋<br>' . ($reminder ? 'There’s still time to rate your order. ' : 'We hope your order arrived and you love it. ') . 'Your opinion of <b>' . h($names) . '</b> helps other customers choose, and takes less than a minute.')
            . '</p><p style="text-align:center;margin:22px 0">' . btn($url, $ar ? '⭐ قيّم طلبك' : '⭐ Rate your order') . '</p>'
            . '<p style="font-size:13px;color:#6B6660">' . ($ar ? 'طلب ' : 'Order ') . h(order_number($orderId)) . '</p>';
        send_mail_later([(string) $o['email']], $title, email_shell($ar ? 'قيّم طلبك' : 'Rate your order', $inner, 'customer'),
            ($ar ? 'قيّم طلبك: ' : 'Rate your order: ') . $url);
        $sent = true;
    }
    // WhatsApp only when the customer's chat is open (they wrote in the last 24 hours): free, and allowed without a template.
    if (!$reminder && function_exists('wa_ready') && wa_ready() && ($waId = wa_id_from_phone((string) $o['phone'])) && ($chat = wa_chat_by_wa_id($waId)) && wa_window_open($chat)) {
        try {
            wa_send_text($chat, $ar ? 'أهلًا ' . $first . ' 👋 نتمنى يكون طلبك ' . order_number($orderId) . ' وصل وعجبك. لو عندك دقيقة، قيّمه من هنا ⭐ ' . $url
                : 'Hi ' . $first . ' 👋 we hope order ' . order_number($orderId) . ' arrived and you love it. If you have a minute, rate it here ⭐ ' . $url, null, true);
            $sent = true;
        } catch (Throwable $e) { ops_error('WhatsApp', 'The review request message could not be sent', $e); }
    }
    if ($sent) db()->prepare('UPDATE orders SET ' . ($reminder ? 'review_reminded_at' : 'review_asked_at') . " = datetime('now') WHERE id = ?")->execute([$orderId]);
    elseif (!$reminder) db()->prepare("UPDATE orders SET review_asked_at = datetime('now'), review_reminded_at = datetime('now') WHERE id = ?")->execute([$orderId]); // nothing to send to: don't try again
    return $sent;
}

// One reminder, 3 days after the request, to customers who haven't reviewed that order yet.
function reviews_due(): void
{
    $rows = db()->query("SELECT o.id FROM orders o WHERE o.status = 'Delivered' AND o.review_asked_at IS NOT NULL AND o.review_reminded_at IS NULL
        AND o.review_asked_at < datetime('now', '-" . REVIEW_REMIND_DAYS . " days') AND o.review_asked_at > datetime('now', '-30 days')
        AND NOT EXISTS (SELECT 1 FROM product_reviews r WHERE r.order_id = o.id) LIMIT 20")->fetchAll(PDO::FETCH_COLUMN);
    foreach ($rows as $id) {
        try { review_request_send((int) $id, true); }
        catch (Throwable $e) { ops_error('Reviews', 'A review reminder could not be sent', $e); }
        db()->prepare("UPDATE orders SET review_reminded_at = COALESCE(review_reminded_at, datetime('now')) WHERE id = ?")->execute([(int) $id]);
    }
}

function review_order_by_token(string $t): ?array
{
    if (!preg_match('/^[a-f0-9]{24}$/', $t)) return null;
    $st = db()->prepare("SELECT * FROM orders WHERE review_token = ? AND status = 'Delivered'");
    $st->execute([$t]);
    return $st->fetch() ?: null;
}

// The customer record reviews belong to: by the order's email, or by phone for orders without one.
function review_customer(array $o): int
{
    $email = strtolower(trim((string) $o['email']));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) $email = 'phone-' . (phone_key((string) $o['phone']) ?: 'order' . $o['id']) . '@buyers.wheretospot.invalid';
    $pdo = db();
    $pdo->prepare('INSERT OR IGNORE INTO customers (email) VALUES (?)')->execute([$email]);
    $st = $pdo->prepare('SELECT * FROM customers WHERE email = ?');
    $st->execute([$email]);
    $c = $st->fetch();
    if ($c['name'] === '' && $c['phone'] === '') customer_remember_order((int) $c['id'], $o);
    return (int) $c['id'];
}

// What the review page shows: the products with a photo, and the stars already given from this order.
function review_page_data(array $o): array
{
    $pdo = db();
    $cid = review_customer($o);
    $img = $pdo->prepare('SELECT path FROM product_images WHERE product_id = ? ORDER BY sort LIMIT 1');
    $mine = $pdo->prepare('SELECT rating, text FROM product_reviews WHERE customer_id = ? AND product_id = ?');
    $nameAr = $pdo->prepare('SELECT name_ar FROM products WHERE id = ?');
    $out = [];
    foreach (review_order_products($o) as $p) {
        $img->execute([$p['id']]);
        $mine->execute([$cid, $p['id']]);
        $r = $mine->fetch();
        $nameAr->execute([$p['id']]);
        $out[] = ['id' => $p['id'], 'name' => $p['name'], 'nameAr' => (string) ($nameAr->fetchColumn() ?: ''), 'img' => (string) ($img->fetchColumn() ?: ''), 'rating' => $r ? (int) $r['rating'] : 0, 'text' => $r ? $r['text'] : ''];
    }
    return ['number' => order_number((int) $o['id']), 'name' => (string) $o['customer'], 'products' => $out, 'google' => (string) cfg('google_review_url')];
}

// Saved from the review page: one review per product (updates if they come back).
function review_save_token(string $t, array $b): array
{
    $o = review_order_by_token($t);
    if (!$o) throw new ShopError('This review link isn’t valid any more.');
    $cid = review_customer($o);
    $name = trim(str_in($b['name'] ?? '', 60)) ?: (string) $o['customer'];
    $allowed = array_column(review_order_products($o), 'id');
    $saved = 0;
    foreach (array_slice(is_array($b['reviews'] ?? null) ? $b['reviews'] : [], 0, 30) as $r) {
        $pid = (string) ($r['product_id'] ?? '');
        $rating = (int) ($r['rating'] ?? 0);
        if (!in_array($pid, $allowed, true) || $rating < 1 || $rating > 5) continue;
        $text = trim(str_in($r['text'] ?? '', 1500));
        $st = db()->prepare('SELECT id FROM product_reviews WHERE customer_id = ? AND product_id = ?');
        $st->execute([$cid, $pid]);
        if ($id = $st->fetchColumn()) {
            db()->prepare("UPDATE product_reviews SET name = ?, rating = ?, text = ?, order_id = ?, updated_at = datetime('now') WHERE id = ?")->execute([$name, $rating, $text, (int) $o['id'], $id]);
        } else {
            db()->prepare('INSERT INTO product_reviews (product_id, customer_id, order_id, name, rating, text) VALUES (?, ?, ?, ?, ?, ?)')->execute([$pid, $cid, (int) $o['id'], $name, $rating, $text]);
            log_activity(null, 'New product review', $pid . ' · ' . str_repeat('★', $rating) . ' · ' . $name . ' · ' . order_number((int) $o['id']));
        }
        if (function_exists('seo_indexnow_product')) seo_indexnow_product($pid);
        $saved++;
    }
    if (!$saved) throw new ShopError('Choose the stars for at least one product.');
    return ['saved' => $saved];
}
