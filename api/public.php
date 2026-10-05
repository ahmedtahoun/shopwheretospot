<?php
// Public endpoints used by the storefront. No login.
//   GET  ?action=catalog  -> categories + active products with images
//   POST ?action=order    -> place an order (prices and stock checked here, not trusted from the browser)
//   POST ?action=lead     -> bulk / corporate enquiry
//   POST ?action=track    -> order status by order number + email
//   POST ?action=promo    -> validate a promo code

require __DIR__ . '/bootstrap.php';

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

try {
    if ($action === 'catalog' && $method === 'GET') {
        $cats = db()->query('SELECT key, label, descr AS "desc", sort FROM categories ORDER BY sort, label')->fetchAll();
        $products = array_map(function ($p) {
            unset($p['cost'], $p['createdAt'], $p['updatedAt']);
            return $p;
        }, load_products(true));
        json_out(['categories' => $cats, 'products' => $products], 200, 60);
    }

    // Cities Bosta delivers to (?action=areas) or the areas of one city (?action=areas&city=ID).
    if ($action === 'areas' && $method === 'GET') {
        $cities = bosta_areas();
        if (!empty($_GET['city'])) {
            foreach ($cities as $c) if ($c['id'] === $_GET['city']) json_out(['zones' => bosta_zones($c)], 200, 3600);
            fail('City not found', 404);
        }
        json_out(['cities' => array_map(function ($c) { return ['id' => $c['id'], 'name' => $c['name'], 'ar' => $c['ar']]; }, $cities)], 200, 3600);
    }

    // "Type your area" search and suggestions from the typed street address.
    if ($action === 'area_search' && $method === 'GET') {
        json_out(['results' => area_search(str_in($_GET['q'] ?? '', 80))], 200, 3600);
    }
    if ($action === 'area_suggest' && $method === 'GET') {
        json_out(['results' => area_suggest(str_in($_GET['text'] ?? '', 300))], 200, 3600);
    }

    if ($method !== 'POST') fail('Not found', 404);
    $b = body();

    // Customer logo for a personalised order, uploaded before the order is placed.
    if ($action === 'upload_logo') {
        if (too_many_attempts('logo', 15, 3600)) fail('Too many uploads. Please send your logo on WhatsApp instead.', 429);
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) fail('Upload failed. Files must be under ' . (cfg('max_upload_bytes') >> 20) . ' MB.');
        record_attempt('logo');
        $path = store_order_file($f, 'logo');
        json_out(['token' => basename($path), 'name' => str_in($f['name'], 120)]);
    }

    if ($action === 'promo') {
        $code = strtoupper(str_in($b['code'] ?? '', 40));
        $codes = cfg('promo_codes');
        if (!isset($codes[$code])) fail('Invalid promo code', 404);
        json_out(['code' => $code, 'pct' => $codes[$code]]);
    }

    if ($action === 'order') {
        if (too_many_attempts('order', 10, 3600)) fail('Too many orders from this connection. Please call us.', 429);
        $r = create_order($b);
        record_attempt('order');
        try {
            $st = db()->prepare('SELECT rep_id FROM orders WHERE id = ?');
            $st->execute([$r['id']]);
            lead_from_order($b, $r, ($rep = $st->fetchColumn()) ? (int) $rep : null, 'Website');
        } catch (Throwable $e) { error_log('[shop] lead from website order failed: ' . $e->getMessage()); }
        log_activity(null, 'New order', $r['number'] . ' · ' . str_in($b['name'] ?? '', 120) . ' · EGP ' . number_format($r['total']));
        json_out(['number' => $r['number'], 'total' => $r['total'], 'shipping' => $r['shipping'], 'discount' => $r['discount']]);
    }

    if ($action === 'lead') {
        if (too_many_attempts('lead', 10, 3600)) fail('Too many requests. Please call us.', 429);
        $name = str_in($b['name'] ?? '', 120);
        $contact = str_in($b['contact'] ?? '', 160);
        if ($name === '' || $contact === '') fail('Please enter your name and email or phone.');
        $cat = str_in($b['cat'] ?? '', 40);
        $source = str_in($b['source'] ?? 'Website', 80);
        // What they told us (the chat assistant sends the customer's answers here).
        $details = str_in($b['notes'] ?? '', 1000);
        $existing = find_lead(phone_key($contact), email_key($contact));
        if ($existing) {
            // Same person asking again: add it to their lead and put it back in the New pile.
            touch_lead($existing, date('Y-m-d') . ' · New enquiry (' . $source . ')' . ($cat ? ' · interested in ' . $cat : '') . ' · from ' . $name . ($details !== '' ? "\n" . $details : ''), 'New', null, $contact);
        } else {
            insert_lead(['name' => $name, 'contact' => $contact, 'cat' => $cat, 'source' => $source, 'status' => 'New', 'notes' => $details]);
        }
        record_attempt('lead');
        log_activity(null, 'New lead', $name . ' · ' . $source);
        notify_new_lead(['name' => $name, 'contact' => $contact, 'cat' => $cat, 'source' => $source, 'notes' => $details]);
        json_out(['ok' => true]);
    }

    if ($action === 'track') {
        if (too_many_attempts('track', 30, 900)) fail('Too many lookups. Try again later.', 429);
        record_attempt('track');
        $email = str_in($b['email'] ?? '', 160);
        $num = strtoupper(str_in($b['number'] ?? '', 20));
        $pdo = db();
        if ($num !== '') {
            $id = (int) preg_replace('/\D/', '', $num) - 1000;
            $st = $pdo->prepare('SELECT * FROM orders WHERE id = ? AND email = ? COLLATE NOCASE');
            $st->execute([$id, $email]);
        } else {
            $st = $pdo->prepare('SELECT * FROM orders WHERE email = ? COLLATE NOCASE ORDER BY id DESC LIMIT 20');
            $st->execute([$email]);
        }
        $out = array_map(function ($o) {
            return [
                'number' => order_number((int) $o['id']), 'status' => $o['status'], 'total' => (float) $o['total'],
                'date' => substr($o['created_at'], 0, 10), 'items' => json_decode($o['items'], true),
            ];
        }, $st->fetchAll());
        json_out(['orders' => $out]);
    }

    fail('Not found', 404);
} catch (ShopError $e) {
    fail($e->getMessage(), 422);
} catch (Throwable $e) {
    error_log('[shop api] ' . $e->getMessage());
    fail('Something went wrong. Please try again or contact us.', 500);
}
