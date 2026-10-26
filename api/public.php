<?php
// Public endpoints used by the storefront. No login.
//   GET  ?action=catalog  -> categories + active products with images
//   POST ?action=order    -> place an order (prices and stock checked here, not trusted from the browser)
//   POST ?action=lead     -> bulk / corporate enquiry
//   POST ?action=track    -> order status by order number + email
//   POST ?action=promo    -> validate a promo code
//   ?action=account / account_code / account_verify / account_save / account_logout -> customer accounts (api/customers.php)

require __DIR__ . '/bootstrap.php';

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

try {
    if ($action === 'catalog' && $method === 'GET') {
        // After a deploy the homepage's crawler copy is the fallback: fill it in from the live catalogue (api/seo-lib.php).
        if (seo_home_stale()) register_shutdown_function(function () { try { seo_publish(); } catch (Throwable $e) {} });
        $cats = db()->query('SELECT key, label, descr AS "desc", label_ar AS "labelAr", descr_ar AS "descAr", sort FROM categories ORDER BY sort, label')->fetchAll();
        // Search title + description per language, so the product page script shows the same ones as the server.
        $en = seo_lookups(false); $arL = seo_lookups(true);
        $products = array_map(function ($p) use ($en, $arL) {
            $e = seo_item($p, false, ...$en); $a = seo_item($p, true, ...$arL);
            $p['seo'] = ['en' => [$e['seoTitle'], $e['seoDesc']], 'ar' => [$a['seoTitle'], $a['seoDesc']]];
            unset($p['cost'], $p['createdAt'], $p['updatedAt'], $p['brandPrice'], $p['marginPct'], $p['seoTitle'], $p['seoTitleAr'], $p['seoDesc'], $p['seoDescAr']);
            $p['variants'] = array_map(function ($v) { unset($v['brandPrice']); return $v; }, $p['variants']);
            return $p;
        }, load_products(true));
        // Partner brands that have something on sale (logo + name show on their products).
        $used = array_flip(array_filter(array_map(function ($p) { return $p['brandId']; }, $products)));
        $brands = array_values(array_filter(load_brands(true), function ($b) use ($used) { return isset($used[$b['id']]); }));
        json_out(['categories' => $cats, 'products' => $products, 'brands' => $brands, 'payments' => ['online' => array_keys(paymob_visible_methods()), 'test' => paymob_is_test()]], 200, paymob_is_test() ? 0 : 60);
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

    // Signed-in customer: profile and orders (never cached).
    // Product reviews: the list, and whether this visitor may write one (verified buyers only, api/reviews.php).
    if ($action === 'reviews' && $method === 'GET') {
        json_out(review_status(current_customer(), preg_replace('/[^A-Za-z0-9_-]/', '', (string) ($_GET['product'] ?? ''))));
    }

    if ($action === 'account' && $method === 'GET') {
        $c = current_customer();
        json_out($c ? ['customer' => customer_out($c), 'orders' => customer_orders($c)] : ['customer' => null]);
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
        if (too_many_attempts('promo', 30, 3600)) fail('Too many tries. Please wait a while.', 429);
        record_attempt('promo');
        try { [$p] = promo_check(str_in($b['code'] ?? '', 40), (float) ($b['subtotal'] ?? 0)); }
        catch (ShopError $e) { fail($e->getMessage(), 404); }
        json_out(['code' => $p['code'], 'kind' => $p['kind'], 'value' => (float) $p['value'], 'min' => (float) $p['min_order'],
            'pct' => $p['kind'] === 'percent' ? (float) $p['value'] : 0, 'label' => promo_label($p)]);
    }

    if ($action === 'order') {
        if (too_many_attempts('order', 10, 3600)) fail('Too many orders from this connection. Please call us.', 429);
        // Online payment: the order is saved first (unpaid), then the customer pays on Paymob's page.
        $pay = in_array($b['payment'] ?? '', array_keys(paymob_visible_methods()), true) ? $b['payment'] : 'cod';
        expire_unpaid_orders();
        // Paid online: kept as "Awaiting payment" (no alert, not in the team's lists) until Paymob confirms.
        $r = create_order($b, $pay === 'cod' ? [] : ['payment' => $pay, 'paid_now' => 0, 'status' => 'Awaiting payment']);
        record_attempt('order');
        schedule_daily_backup();
        // Ad tracking: Meta's browser cookies with the order; cash orders are a purchase now, online ones once paid.
        try { meta_remember_order((int) $r['id']); if ($pay === 'cod') meta_purchase((int) $r['id']); } catch (Throwable $e) { error_log('[meta] ' . $e->getMessage()); }
        if ($cust = current_customer()) {
            db()->prepare('UPDATE orders SET customer_id = ? WHERE id = ?')->execute([$cust['id'], $r['id']]);
            $st = db()->prepare('SELECT * FROM orders WHERE id = ?');
            $st->execute([$r['id']]);
            customer_remember_order((int) $cust['id'], $st->fetch(), ['zone_id' => str_in($b['zone_id'] ?? '', 40) ?: null,
                'area_title' => str_in($b['area_title'] ?? '', 160) ?: null, 'area_sub' => str_in($b['area_sub'] ?? '', 160) ?: null]);
        }
        if ($pay === 'cod') try {
            $st = db()->prepare('SELECT rep_id FROM orders WHERE id = ?');
            $st->execute([$r['id']]);
            lead_from_order($b, $r, ($rep = $st->fetchColumn()) ? (int) $rep : null, 'Website');
        } catch (Throwable $e) { error_log('[shop] lead from website order failed: ' . $e->getMessage()); }
        if ($pay === 'cod') log_activity(null, 'New order', $r['number'] . ' · ' . str_in($b['name'] ?? '', 120) . ' · EGP ' . number_format($r['total']));
        $payUrl = null; $payError = null;
        if ($pay !== 'cod') {
            try { $payUrl = paymob_checkout_url((int) $r['id'], $pay); }
            catch (Throwable $e) {
                $payError = 'Online payment could not be started.';
                error_log('[paymob] ' . $e->getMessage());
                // Paymob's own reply goes to Activity so the owner can see why (wrong key, ID, mode…).
                log_activity(null, 'Online payment could not start', $r['number'] . ' · ' . mb_substr((string) ($GLOBALS['paymob_last_error'] ?? $e->getMessage()), 0, 250));
            }
        }
        json_out(['number' => $r['number'], 'total' => $r['total'], 'shipping' => $r['shipping'], 'discount' => $r['discount'], 'payUrl' => $payUrl, 'payError' => $payError]);
    }

    // Pay (again) online for an existing unpaid order, e.g. after a declined card. Needs the order's email or phone.
    // The customer gave up on paying online and prefers cash on delivery for the same order.
    if ($action === 'pay_cod') {
        if (too_many_attempts('pay', 20, 3600)) fail('Too many attempts. Please call us.', 429);
        record_attempt('pay');
        $id = (int) preg_replace('/\D/', '', strtoupper(str_in($b['number'] ?? '', 20))) - 1000;
        $who = str_in($b['contact'] ?? '', 160);
        $st = db()->prepare('SELECT * FROM orders WHERE id = ?');
        $st->execute([$id]);
        $o = $st->fetch();
        $match = $o && $who !== '' && (strcasecmp($o['email'], $who) === 0 || (phone_key($who) && phone_key($who) === phone_key((string) $o['phone'])));
        if (!$match) fail('We couldn’t find that order. Check the number and the email or phone you used.', 404);
        if ($o['status'] !== 'Awaiting payment') fail($o['status'] === 'Cancelled' ? 'This order expired. Please place it again from the shop.' : 'This order is already confirmed.');
        if (order_paid($id) > 0) fail('This order already has a payment. Please contact us.');
        db()->prepare("UPDATE orders SET payment = 'cod' WHERE id = ?")->execute([$id]);
        confirm_online_order($id, 'Order switched to cash on delivery');
        json_out(['ok' => true, 'number' => order_number($id), 'total' => (float) $o['total']]);
    }

    if ($action === 'pay') {
        if (too_many_attempts('pay', 20, 3600)) fail('Too many attempts. Please call us.', 429);
        record_attempt('pay');
        $num = strtoupper(str_in($b['number'] ?? '', 20));
        $id = (int) preg_replace('/\D/', '', $num) - 1000;
        $who = str_in($b['contact'] ?? '', 160);
        $st = db()->prepare('SELECT * FROM orders WHERE id = ?');
        $st->execute([$id]);
        $o = $st->fetch();
        $match = $o && $who !== '' && (strcasecmp($o['email'], $who) === 0 || (phone_key($who) && phone_key($who) === phone_key((string) $o['phone'])));
        if (!$match) fail('We couldn’t find that order. Check the number and the email or phone you used.', 404);
        if ($o['status'] === 'Cancelled' && strpos((string) $o['notes'], UNPAID_EXPIRED_NOTE) !== false) fail('This order expired because it wasn’t paid. Please place it again from the shop.');
        if (in_array($o['status'], ['Cancelled', 'Returned', 'Delivered'], true)) fail('This order can’t be paid online. Please contact us.');
        $method = in_array($b['method'] ?? '', array_keys(paymob_visible_methods()), true) ? $b['method'] : (array_keys(paymob_visible_methods())[0] ?? '');
        if ($method === '') fail('Online payment is not available right now.');
        try { json_out(['payUrl' => paymob_checkout_url((int) $o['id'], $method)]); }
        catch (ShopError $e) {
            log_activity(null, 'Online payment could not start', order_number((int) $o['id']) . ' · retry · ' . mb_substr((string) ($GLOBALS['paymob_last_error'] ?? $e->getMessage()), 0, 250));
            throw $e;
        }
    }

    // "Sell with us" (sell.html): a brand or maker sends their products and photos for the team to review.
    if ($action === 'seller_apply') {
        if (too_many_attempts('seller', 5, 3600)) fail('Too many requests. Please message us on WhatsApp instead.', 429);
        if (trim((string) ($b['website'] ?? '')) !== '') json_out(['ok' => true]); // hidden field: only bots fill it in
        seller_apply($b, $_FILES);
        record_attempt('seller');
        json_out(['ok' => true]);
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

    // ---------- customer accounts ----------
    if ($action === 'account_code') {
        customer_send_code(str_in($b['email'] ?? '', 160), ($b['lang'] ?? '') === 'ar' ? 'ar' : 'en');
        json_out(['ok' => true]);
    }
    if ($action === 'account_verify') {
        $c = customer_verify(str_in($b['email'] ?? '', 160), str_in($b['code'] ?? '', 12));
        json_out(['customer' => customer_out($c), 'orders' => customer_orders($c)]);
    }
    if ($action === 'account_save') {
        $c = current_customer();
        if (!$c) fail('Please sign in again.', 401);
        json_out(['customer' => customer_out(customer_save($c, $b))]);
    }
    if ($action === 'review_save') {
        $c = current_customer();
        if (!$c) fail('Please sign in with the email you ordered with.', 401);
        if (too_many_attempts('review', 20, 3600)) fail('Too many tries. Please wait a while.', 429);
        record_attempt('review');
        $pid = preg_replace('/[^A-Za-z0-9_-]/', '', (string) ($b['product'] ?? ''));
        try { review_save($c, $pid, $b); } catch (ShopError $e) { fail($e->getMessage(), $e->getCode() === 403 ? 403 : 400); }
        json_out(review_status($c, $pid));
    }
    if ($action === 'account_logout') {
        customer_logout();
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
