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
        header('Cache-Control: public, max-age=30');
        json_out(['categories' => $cats, 'products' => $products]);
    }

    // Cities Bosta delivers to (?action=areas) or the areas of one city (?action=areas&city=ID).
    if ($action === 'areas' && $method === 'GET') {
        $cities = bosta_areas();
        header('Cache-Control: public, max-age=3600');
        if (!empty($_GET['city'])) {
            foreach ($cities as $c) if ($c['id'] === $_GET['city']) json_out(['zones' => bosta_zones($c)]);
            fail('City not found', 404);
        }
        json_out(['cities' => array_map(function ($c) { return ['id' => $c['id'], 'name' => $c['name'], 'ar' => $c['ar']]; }, $cities)]);
    }

    if ($method !== 'POST') fail('Not found', 404);
    $b = body();

    if ($action === 'promo') {
        $code = strtoupper(str_in($b['code'] ?? '', 40));
        $codes = cfg('promo_codes');
        if (!isset($codes[$code])) fail('Invalid promo code', 404);
        json_out(['code' => $code, 'pct' => $codes[$code]]);
    }

    if ($action === 'order') {
        if (too_many_attempts('order', 10, 3600)) fail('Too many orders from this connection. Please call us.', 429);
        $name = str_in($b['name'] ?? '', 120);
        $email = str_in($b['email'] ?? '', 160);
        $phone = str_in($b['phone'] ?? '', 40);
        $address = str_in($b['address'] ?? '', 500);
        $city = str_in($b['city'] ?? '', 60);
        $cityId = str_in($b['city_id'] ?? '', 40);
        $districtId = str_in($b['district_id'] ?? '', 40);
        $district = '';
        if ($cityId && $districtId) {
            try {
                $area = bosta_find_area($cityId, $districtId);
                if ($area) { $city = $area['city']['name']; $district = $area['district']['name']; }
                else { $cityId = $districtId = ''; }
            } catch (Throwable $e) { $cityId = $districtId = ''; } // area list unavailable: the team picks it later
        }
        if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Please enter your name and a valid email.');
        if ($phone === '') fail('Please enter a phone number so we can confirm your order.');
        $items = is_array($b['items'] ?? null) ? $b['items'] : [];
        if (!$items || count($items) > 50) fail('Your cart is empty.');

        $pdo = db();
        $pdo->beginTransaction();
        $get = $pdo->prepare("SELECT * FROM products WHERE id = ? AND status = 'Active'");
        $lines = [];
        $subtotal = 0.0;
        $physical = 0.0;
        foreach ($items as $it) {
            $qty = max(1, min(99, (int) ($it['qty'] ?? 1)));
            $get->execute([(string) ($it['id'] ?? '')]);
            $p = $get->fetch();
            if (!$p) { $pdo->rollBack(); fail('A product in your cart is no longer available. Please refresh.', 409); }
            if ($p['cat'] !== 'services' && (int) $p['stock'] < $qty) {
                $pdo->rollBack();
                fail($p['name'] . ': only ' . (int) $p['stock'] . ' left in stock.', 409);
            }
            $price = sale_price($p);
            $lines[] = ['id' => $p['id'], 'name' => $p['name'], 'qty' => $qty, 'price' => $price, 'cat' => $p['cat']];
            $subtotal += $price * $qty;
            if ($p['cat'] !== 'services') $physical += $price * $qty;
        }
        if (!$address && $physical > 0) { $pdo->rollBack(); fail('Please enter your delivery address.'); }

        $promo = strtoupper(str_in($b['promo'] ?? '', 40));
        $codes = cfg('promo_codes');
        $discount = isset($codes[$promo]) ? round($subtotal * $codes[$promo] / 100, 2) : 0.0;
        if (!$discount) $promo = '';
        $shipping = $physical > 0 && $physical < cfg('free_shipping_threshold') ? (float) cfg('shipping_fee') : 0.0;
        $total = round($subtotal - $discount + $shipping, 2);

        $repId = null;
        $ref = str_in($b['ref'] ?? '', 40);
        if ($ref !== '') {
            $st = $pdo->prepare('SELECT id FROM users WHERE ref_code = ? AND active = 1');
            $st->execute([$ref]);
            $repId = $st->fetchColumn() ?: null;
            if (!$repId) { $pdo->rollBack(); fail('Referral code not recognised — check it or leave it blank.'); }
        }

        $pdo->prepare('INSERT INTO orders (customer, email, phone, address, city, city_id, district_id, district, items, subtotal, discount, shipping, total, promo, payment, rep_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$name, $email, $phone, $address, $city, $cityId ?: null, $districtId ?: null, $district, json_encode($lines, JSON_UNESCAPED_UNICODE), $subtotal, $discount, $shipping, $total, $promo, 'cod', $repId]);
        $id = (int) $pdo->lastInsertId();
        $dec = $pdo->prepare("UPDATE products SET stock = MAX(0, stock - ?), updated_at = datetime('now') WHERE id = ? AND cat != 'services'");
        foreach ($lines as $l) $dec->execute([$l['qty'], $l['id']]);
        $pdo->commit();
        record_attempt('order');
        log_activity(null, 'New order', order_number($id) . ' · ' . $name . ' · EGP ' . number_format($total));
        $repName = null;
        if ($repId) { $st = $pdo->prepare('SELECT name FROM users WHERE id = ?'); $st->execute([$repId]); $repName = $st->fetchColumn(); }
        notify_new_order(order_number($id), [
            'name' => $name, 'email' => $email, 'phone' => $phone, 'address' => $address, 'city' => $district ? $district . ', ' . $city : $city,
            'subtotal' => $subtotal, 'discount' => $discount, 'promo' => $promo, 'shipping' => $shipping, 'total' => $total, 'rep' => $repName,
        ], $lines);
        json_out(['number' => order_number($id), 'total' => $total, 'shipping' => $shipping, 'discount' => $discount]);
    }

    if ($action === 'lead') {
        if (too_many_attempts('lead', 10, 3600)) fail('Too many requests. Please call us.', 429);
        $name = str_in($b['name'] ?? '', 120);
        $contact = str_in($b['contact'] ?? '', 160);
        if ($name === '' || $contact === '') fail('Please enter your name and email or phone.');
        db()->prepare('INSERT INTO leads (name, contact, cat, source) VALUES (?, ?, ?, ?)')
            ->execute([$name, $contact, str_in($b['cat'] ?? '', 40), str_in($b['source'] ?? 'Website', 80)]);
        record_attempt('lead');
        log_activity(null, 'New lead', $name);
        notify_new_lead(['name' => $name, 'contact' => $contact, 'cat' => str_in($b['cat'] ?? '', 40)]);
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
} catch (Throwable $e) {
    error_log('[shop api] ' . $e->getMessage());
    fail('Something went wrong. Please try again or contact us.', 500);
}
