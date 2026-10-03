<?php
// Order creation shared by the shop checkout (public.php) and team-entered orders (admin.php).
// Prices and stock always come from the database, never from the browser.

const ORDER_SOURCES = ['Website', 'Phone', 'WhatsApp', 'Instagram', 'Facebook', 'TikTok', 'Walk-in', 'Referral', 'Other'];
const PAYMENT_METHODS = ['cod' => 'Cash on delivery', 'bank' => 'Paid — bank transfer', 'wallet' => 'Paid — InstaPay / wallet', 'cash' => 'Paid — cash in hand'];

// $in: name, email, phone, address, city, city_id, district_id, items[{id, qty}], promo, ref
// $opts: by_team (bool), rep_id, created_by, source, payment, status, discount (EGP), shipping (EGP override), notes
function create_order(array $in, array $opts = []): array
{
    $team = !empty($opts['by_team']);
    $name = str_in($in['name'] ?? '', 120);
    $email = str_in($in['email'] ?? '', 160);
    $phone = str_in($in['phone'] ?? '', 40);
    $address = str_in($in['address'] ?? '', 500);
    $city = str_in($in['city'] ?? '', 60);
    $cityId = str_in($in['city_id'] ?? '', 40);
    $districtId = str_in($in['district_id'] ?? '', 40);
    $district = '';
    if ($cityId && $districtId) {
        try {
            $area = bosta_find_area($cityId, $districtId);
            if ($area) { $city = $area['city']['name']; $district = $area['district']['name']; }
            else { $cityId = $districtId = ''; }
        } catch (Throwable $e) { $cityId = $districtId = ''; } // area list unavailable: the team picks it later
    }
    if ($name === '') throw new ShopError($team ? 'Enter the customer’s name.' : 'Please enter your name.');
    if ($team ? ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) : !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new ShopError($team ? 'That email doesn’t look right — fix it or leave it empty.' : 'Please enter a valid email.');
    }
    if ($phone === '') throw new ShopError($team ? 'Enter the customer’s phone number.' : 'Please enter a phone number so we can confirm your order.');
    $items = is_array($in['items'] ?? null) ? $in['items'] : [];
    if (!$items || count($items) > 50) throw new ShopError($team ? 'Add at least one product.' : 'Your cart is empty.');

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $get = $pdo->prepare("SELECT * FROM products WHERE id = ? AND status = 'Active'");
        $lines = [];
        $subtotal = 0.0;
        $physical = 0.0;
        foreach ($items as $it) {
            $qty = max(1, min(999, (int) ($it['qty'] ?? 1)));
            $get->execute([(string) ($it['id'] ?? '')]);
            $p = $get->fetch();
            if (!$p) throw new ShopError('A product in the order is no longer available. Please refresh.');
            if ($p['cat'] !== 'services' && (int) $p['stock'] < $qty) throw new ShopError($p['name'] . ': only ' . (int) $p['stock'] . ' left in stock.');
            $price = sale_price($p);
            $lines[] = ['id' => $p['id'], 'name' => $p['name'], 'qty' => $qty, 'price' => $price, 'cat' => $p['cat']];
            $subtotal += $price * $qty;
            if ($p['cat'] !== 'services') $physical += $price * $qty;
        }
        if ($physical > 0 && mb_strlen($address) < 6) throw new ShopError($team ? 'Enter the delivery address.' : 'Please enter your delivery address.');

        $promo = strtoupper(str_in($in['promo'] ?? '', 40));
        $codes = cfg('promo_codes');
        $discount = isset($codes[$promo]) ? round($subtotal * $codes[$promo] / 100, 2) : 0.0;
        if (!$discount) $promo = '';
        if ($team && isset($opts['discount']) && (float) $opts['discount'] > 0) {
            $discount = min($subtotal, round((float) $opts['discount'], 2));
            $promo = 'MANUAL';
        }
        $shipping = $physical > 0 && $physical < cfg('free_shipping_threshold') ? (float) cfg('shipping_fee') : 0.0;
        if ($team && isset($opts['shipping']) && $opts['shipping'] !== '' && $opts['shipping'] !== null) $shipping = max(0, round((float) $opts['shipping'], 2));
        $total = round($subtotal - $discount + $shipping, 2);

        $repId = $opts['rep_id'] ?? null;
        $ref = str_in($in['ref'] ?? '', 40);
        if (!$repId && $ref !== '') {
            $st = $pdo->prepare('SELECT id FROM users WHERE ref_code = ? AND active = 1');
            $st->execute([$ref]);
            $repId = $st->fetchColumn() ?: null;
            if (!$repId) throw new ShopError('Referral code not recognised — check it or leave it blank.');
        }
        $source = in_array($opts['source'] ?? '', ORDER_SOURCES, true) ? $opts['source'] : ($repId && !$team ? 'Referral' : 'Website');
        $payment = array_key_exists($opts['payment'] ?? '', PAYMENT_METHODS) ? $opts['payment'] : 'cod';
        $status = in_array($opts['status'] ?? '', ['Pending', 'Confirmed'], true) ? $opts['status'] : 'Pending';

        $pdo->prepare('INSERT INTO orders (customer, email, phone, address, city, city_id, district_id, district, items, subtotal, discount, shipping, total, promo, payment, rep_id, source, created_by, status, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$name, $email, $phone, $address, $city, $cityId ?: null, $districtId ?: null, $district, json_encode($lines, JSON_UNESCAPED_UNICODE),
                $subtotal, $discount, $shipping, $total, $promo, $payment, $repId, $source, $opts['created_by'] ?? null, $status, str_in($opts['notes'] ?? '', 2000)]);
        $id = (int) $pdo->lastInsertId();
        $dec = $pdo->prepare("UPDATE products SET stock = MAX(0, stock - ?), updated_at = datetime('now') WHERE id = ? AND cat != 'services'");
        foreach ($lines as $l) $dec->execute([$l['qty'], $l['id']]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    $repName = null;
    if ($repId) { $st = $pdo->prepare('SELECT name FROM users WHERE id = ?'); $st->execute([$repId]); $repName = $st->fetchColumn() ?: null; }
    notify_new_order(order_number($id), [
        'name' => $name, 'email' => $email, 'phone' => $phone, 'address' => $address, 'city' => $district ? $district . ', ' . $city : $city,
        'subtotal' => $subtotal, 'discount' => $discount, 'promo' => $promo, 'shipping' => $shipping, 'total' => $total, 'rep' => $repName,
        'source' => $source, 'payment' => PAYMENT_METHODS[$payment],
    ], $lines);
    return ['id' => $id, 'number' => order_number($id), 'total' => $total, 'shipping' => $shipping, 'discount' => $discount];
}

// ---------- months & targets (Cairo time) ----------

function cairo_month_bounds(string $month): array
{
    if (!preg_match('/^\d{4}-\d{2}$/', $month)) $month = (new DateTime('now', new DateTimeZone('Africa/Cairo')))->format('Y-m');
    $tz = new DateTimeZone('Africa/Cairo');
    $start = new DateTime($month . '-01 00:00:00', $tz);
    $end = (clone $start)->modify('+1 month');
    $utc = new DateTimeZone('UTC');
    return [$month, $start->setTimezone($utc)->format('Y-m-d H:i:s'), $end->setTimezone($utc)->format('Y-m-d H:i:s')];
}

// Per-member numbers for a month: orders, revenue (excluding cancelled/returned), delivered, and targets.
function team_performance(string $month, ?int $onlyUser = null): array
{
    [$month, $from, $to] = cairo_month_bounds($month);
    $pdo = db();
    $sql = "SELECT u.id, u.name, u.role, u.active,
            COALESCE(t.orders_target, 0) AS orders_target, COALESCE(t.revenue_target, 0) AS revenue_target,
            COUNT(o.id) AS orders,
            COALESCE(SUM(CASE WHEN o.status NOT IN ('Cancelled','Returned') THEN o.total END), 0) AS revenue,
            SUM(CASE WHEN o.status = 'Delivered' THEN 1 ELSE 0 END) AS delivered,
            SUM(CASE WHEN o.status IN ('Cancelled','Returned') THEN 1 ELSE 0 END) AS lost,
            MAX(o.created_at) AS last_order
        FROM users u
        LEFT JOIN targets t ON t.user_id = u.id AND t.month = :m
        LEFT JOIN orders o ON o.rep_id = u.id AND o.created_at >= :f AND o.created_at < :t
        WHERE (u.active = 1 OR o.id IS NOT NULL)" . ($onlyUser ? ' AND u.id = :u' : '') . "
        GROUP BY u.id ORDER BY revenue DESC, u.name";
    $st = $pdo->prepare($sql);
    $args = [':m' => $month, ':f' => $from, ':t' => $to];
    if ($onlyUser) $args[':u'] = $onlyUser;
    $st->execute($args);
    $rows = array_map(function ($r) {
        foreach (['id', 'orders', 'delivered', 'lost', 'orders_target', 'active'] as $k) $r[$k] = (int) $r[$k];
        foreach (['revenue', 'revenue_target'] as $k) $r[$k] = (float) $r[$k];
        return $r;
    }, $st->fetchAll());
    return ['month' => $month, 'members' => $rows];
}

// ---------- leads: one lead per phone number / email ----------

// Last 9 digits of an Egyptian number, so 01012345678, +20 101 234 5678 and 00201012345678 all match.
function phone_key(string $text): ?string
{
    $text = strtr($text, ['٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9']);
    $text = preg_replace('/[\w.+-]+@[\w-]+\.[\w.]+/u', ' ', $text); // ignore digits inside an email address
    $digits = preg_replace('/\D/', '', $text);
    return strlen($digits) >= 8 ? substr($digits, -9) : null;
}

function email_key(string $text): ?string
{
    return preg_match('/[\w.+-]+@[\w-]+\.[\w.]+/u', $text, $m) ? strtolower($m[0]) : null;
}

// The existing lead with this phone number or email, if any.
function find_lead(?string $phoneKey, ?string $emailKey): ?array
{
    if (!$phoneKey && !$emailKey) return null;
    $st = db()->prepare('SELECT l.*, u.name AS assigned_name FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
        WHERE (? IS NOT NULL AND l.phone_key = ?) OR (? IS NOT NULL AND l.email_key = ?) ORDER BY l.id LIMIT 1');
    $st->execute([$phoneKey, $phoneKey, $emailKey, $emailKey]);
    return $st->fetch() ?: null;
}

function insert_lead(array $f): int
{
    $contact = (string) $f['contact'];
    db()->prepare('INSERT INTO leads (name, contact, cat, source, status, notes, assigned_to, phone_key, email_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$f['name'], $contact, $f['cat'] ?? '', $f['source'] ?? '', $f['status'] ?? 'New', $f['notes'] ?? '', $f['assigned_to'] ?? null,
            phone_key($contact), email_key($contact)]);
    return (int) db()->lastInsertId();
}

// Add a note (newest first) to an existing lead, optionally changing its status and filling in missing contact details.
function touch_lead(array $lead, string $note, ?string $status, ?int $assignTo, string $contact = ''): void
{
    $notes = mb_substr(trim($note . "\n" . (string) $lead['notes']), 0, 4000);
    $newContact = $lead['contact'];
    if ($contact !== '') {
        // Keep one lead per customer but remember both their phone and email if we learn a new one.
        if (!$lead['phone_key'] && phone_key($contact)) $newContact .= ' · ' . trim(preg_replace('/[\w.+-]+@[\w-]+\.[\w.]+/u', '', $contact), " ·");
        if (!$lead['email_key'] && email_key($contact)) $newContact .= ' · ' . email_key($contact);
    }
    db()->prepare('UPDATE leads SET notes = ?, status = COALESCE(?, status), assigned_to = COALESCE(assigned_to, ?), contact = ?, phone_key = ?, email_key = ? WHERE id = ?')
        ->execute([$notes, $status, $assignTo, mb_substr($newContact, 0, 160), phone_key($newContact), email_key($newContact), $lead['id']]);
}

// Save the customer of any order (website or dashboard) as a Won lead. A returning customer
// (same phone or email) gets the order added to their existing lead instead of a duplicate.
function lead_from_order(array $in, array $order, ?int $repId, string $channel = 'Website'): string
{
    $name = str_in($in['name'] ?? '', 120);
    $phone = str_in($in['phone'] ?? '', 40);
    $email = str_in($in['email'] ?? '', 160);
    $contact = trim($phone . ($email !== '' ? ' · ' . $email : ''), ' ·');
    $st = db()->prepare('SELECT items FROM orders WHERE id = ?');
    $st->execute([$order['id']]);
    $items = json_decode((string) $st->fetchColumn(), true) ?: [];
    $what = implode(', ', array_map(function ($i) { return $i['qty'] . '× ' . $i['name']; }, $items));
    $note = date('Y-m-d') . ' · Order ' . $order['number'] . ' (' . $channel . ') · EGP ' . number_format($order['total']) . ' · ' . $what;

    $existing = find_lead(phone_key($phone), email_key($email));
    if ($existing) {
        touch_lead($existing, $note, 'Won', $repId, $contact);
        return 'updated';
    }
    insert_lead(['name' => $name, 'contact' => $contact, 'cat' => mb_substr($what, 0, 120), 'source' => 'Order ' . $order['number'] . ' · ' . $channel,
        'status' => 'Won', 'notes' => $note, 'assigned_to' => $repId]);
    return 'created';
}
