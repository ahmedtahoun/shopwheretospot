<?php
// Order creation shared by the shop checkout (public.php) and team-entered orders (admin.php).
// Prices and stock always come from the database, never from the browser.

const ORDER_SOURCES = ['Website', 'Phone', 'WhatsApp', 'Instagram', 'Facebook', 'TikTok', 'Walk-in', 'Referral', 'Other'];
const PAYMENT_METHODS = ['cod' => 'Cash on delivery', 'bank' => 'Paid — bank transfer', 'wallet' => 'Paid — InstaPay / wallet', 'cash' => 'Paid — cash in hand',
    'paymob_card' => 'Online — card (Paymob)', 'paymob_wallet' => 'Online — mobile wallet (Paymob)'];

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
    tx_begin();
    try {
        $get = $pdo->prepare("SELECT * FROM products WHERE id = ? AND status = 'Active'");
        $lines = [];
        $subtotal = 0.0;
        $physical = 0.0;
        $personalized = false;
        $taken = []; // stock already claimed by earlier lines of this order, per product/variant
        foreach ($items as $it) {
            $qty = max(1, min(9999, (int) ($it['qty'] ?? 1)));
            if (!empty($it['custom'])) {
                // Free-form line (e.g. "30 pieces, mixed sizes"): only the team can add these.
                if (!$team) throw new ShopError('A product in your cart is no longer available. Please refresh.');
                $cname = str_in($it['name'] ?? '', 160);
                $cprice = round((float) ($it['price'] ?? 0), 2);
                if ($cname === '' || $cprice <= 0) throw new ShopError('Custom items need a description and a price.');
                $lineTotal = round($cprice * $qty); // whole pounds, so "30 for 7,000" can be entered as 233.33 each
                $ship = !isset($it['ship']) || !empty($it['ship']);
                $lines[] = ['id' => 'custom', 'name' => $cname, 'qty' => $qty, 'price' => $cprice, 'total' => $lineTotal, 'cat' => $ship ? 'custom' : 'services']
                    + ($team && str_in($it['note'] ?? '', 1000) !== '' ? ['note' => str_in($it['note'], 1000)] : []);
                $subtotal += $lineTotal;
                if ($ship) $physical += $lineTotal;
                $personalized = true;
                continue;
            }
            $get->execute([(string) ($it['id'] ?? '')]);
            $p = $get->fetch();
            if (!$p) throw new ShopError('A product in the order is no longer available. Please refresh.');
            [$unit, $lineTotal, $variant, $addons, $lineName] = price_line($p, isset($it['variant']) ? (string) $it['variant'] : null, (array) ($it['addons'] ?? []), $qty);
            $key = $p['id'] . '|' . ($variant['id'] ?? '');
            $taken[$key] = ($taken[$key] ?? 0) + $qty;
            if ($p['cat'] !== 'services' && variant_stock($p, $variant) < $taken[$key]) {
                throw new ShopError($lineName . ': only ' . variant_stock($p, $variant) . ' left in stock.');
            }
            $line = ['id' => $p['id'], 'name' => $lineName, 'qty' => $qty, 'price' => $unit, 'total' => $lineTotal, 'cat' => $p['cat']];
            if ((float) $p['cost'] > 0) $line['cost'] = (float) $p['cost']; // unit cost at the time of sale, for profit
            if ($variant) $line['variant'] = (string) $variant['id'];
            if ($team && str_in($it['note'] ?? '', 1000) !== '') $line['note'] = str_in($it['note'], 1000);
            if ($addons) $line['addons'] = $addons;
            // Partner brand's product: remember the brand and its commission at the time of sale.
            if (!empty($p['brand_id']) && ($brand = brand_get((int) $p['brand_id']))) {
                $line['brand'] = (int) $brand['id']; $line['comm'] = (float) $brand['commission'];
                $bp = $variant && isset($variant['brandPrice']) ? (float) $variant['brandPrice'] : (float) ($p['brand_price'] ?? 0);
                if ($bp > 0) $line['bp'] = $bp; // the brand's own price per piece
            }
            $lines[] = $line;
            $subtotal += $lineTotal;
            if ($p['cat'] !== 'services') $physical += $lineTotal;
            if (!empty($p['personalized'])) $personalized = true;
        }
        $biz = str_in($in['business_name'] ?? '', 120);
        if ($personalized && !$team && $biz === '') throw new ShopError('Please enter the business or brand name to print on your items.');
        if ($physical > 0 && mb_strlen($address) < 6) throw new ShopError($team ? 'Enter the delivery address.' : 'Please enter your delivery address.');

        $promo = str_in($in['promo'] ?? '', 40);
        $discount = 0.0;
        $freeDelivery = false;
        if ($promo !== '') {
            try { [$pr, $discount] = promo_check($promo, $subtotal); $promo = $pr['code']; $freeDelivery = $pr['kind'] === 'shipping'; }
            catch (ShopError $e) { if (!$team) throw $e; $promo = ''; }
        }
        if (!$discount && !$freeDelivery) $promo = '';
        if ($team && isset($opts['discount']) && (float) $opts['discount'] > 0) {
            $discount = min($subtotal, round((float) $opts['discount'], 2));
            $promo = 'MANUAL';
        }
        $shipping = $physical > 0 && $physical < cfg('free_shipping_threshold') && !$freeDelivery ? (float) cfg('shipping_fee') : 0.0;
        if ($team && isset($opts['shipping']) && $opts['shipping'] !== '' && $opts['shipping'] !== null) $shipping = max(0, round((float) $opts['shipping'], 2));
        $subtotal = round($subtotal, 2);
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
        $status = in_array($opts['status'] ?? '', ['Pending', 'Confirmed', 'Awaiting payment'], true) ? $opts['status'] : 'Pending';

        $files = [];
        $logo = basename((string) ($in['logo_token'] ?? ''));
        if ($logo !== '' && preg_match('/^logo-[a-f0-9]{16}\.(jpg|png|webp|pdf)$/', $logo) && is_file(cfg('order_upload_dir') . '/' . $logo)) {
            $files[] = ['path' => cfg('order_upload_url') . '/' . $logo, 'name' => str_in($in['logo_name'] ?? 'Logo', 120), 'kind' => 'Logo', 'by' => $team ? 'Team' : 'Customer', 'at' => gmdate('Y-m-d H:i:s')];
        }
        $pdo->prepare('INSERT INTO orders (customer, email, phone, address, city, city_id, district_id, district, items, subtotal, discount, shipping, total, promo, payment, rep_id, source, created_by, status, notes,
                business_name, review_link, links, design_notes, files)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$name, $email, $phone, $address, $city, $cityId ?: null, $districtId ?: null, $district, json_encode($lines, JSON_UNESCAPED_UNICODE),
                $subtotal, $discount, $shipping, $total, $promo, $payment, $repId, $source, $opts['created_by'] ?? null, $status, str_in($opts['notes'] ?? '', 2000),
                $biz, str_in($in['review_link'] ?? '', 500), str_in($in['links'] ?? '', 1000), str_in($in['design_notes'] ?? '', 2000), json_encode($files, JSON_UNESCAPED_UNICODE)]);
        $id = (int) $pdo->lastInsertId();
        // Money received now: full amount for paid-upfront orders, or a deposit the team entered.
        $paidNow = isset($opts['paid_now']) && $opts['paid_now'] !== '' ? max(0, min($total, (float) $opts['paid_now'])) : ($payment !== 'cod' ? $total : 0);
        if ($paidNow > 0) add_payment($id, $paidNow, $payment === 'cod' ? ($opts['deposit_method'] ?? 'cash') : $payment,
            $paidNow < $total ? 'Deposit' : 'Paid when the order was placed', $opts['created_by'] ?? null);
        foreach ($lines as $l) {
            if ($l['id'] === 'custom') continue;
            adjust_stock($pdo, $l['id'], $l['variant'] ?? null, -$l['qty']);
        }
        tx_commit();
    } catch (Throwable $e) {
        tx_rollback();
        throw $e;
    }

    // Online-payment orders are announced only once Paymob confirms the payment (see confirm_online_order).
    if ($status !== 'Awaiting payment') notify_order($id);
    return ['id' => $id, 'number' => order_number($id), 'total' => $total, 'shipping' => $shipping, 'discount' => $discount];
}

// "New order" alert to the team, built from the saved order.
function notify_order(int $id): void
{
    $st = db()->prepare('SELECT o.*, u.name AS rep_name FROM orders o LEFT JOIN users u ON u.id = o.rep_id WHERE o.id = ?');
    $st->execute([$id]);
    $o = $st->fetch();
    if (!$o) return;
    notify_new_order(order_number($id), [
        'name' => $o['customer'], 'email' => $o['email'], 'phone' => $o['phone'], 'address' => $o['address'],
        'city' => $o['district'] ? $o['district'] . ', ' . $o['city'] : $o['city'],
        'subtotal' => (float) $o['subtotal'], 'discount' => (float) $o['discount'], 'promo' => $o['promo'], 'shipping' => (float) $o['shipping'],
        'total' => (float) $o['total'], 'rep' => $o['rep_name'] ?: null, 'source' => $o['source'], 'payment' => PAYMENT_METHODS[$o['payment']] ?? $o['payment'],
    ], json_decode($o['items'], true) ?: []);
}

// The customer paid online (or switched to cash on delivery): the order becomes a normal new order,
// the team is alerted and the customer is recorded as a won lead. Safe to call more than once.
// Paid online → 'Confirmed' (the customer has paid, nothing left to confirm); switched to cash → 'Pending'.
function confirm_online_order(int $id, string $why, string $status = 'Pending'): void
{
    $st = db()->prepare('SELECT * FROM orders WHERE id = ?');
    $st->execute([$id]);
    $o = $st->fetch();
    if (!$o) return;
    // An order placed before payments were held back (already announced as Pending) just moves on to Confirmed.
    if ($o['status'] === 'Pending' && $status === 'Confirmed') {
        set_order_status($id, 'Confirmed');
        log_activity(null, $why, order_number($id) . ' · ' . $o['customer'] . ' · EGP ' . number_format((float) $o['total']));
        return;
    }
    $expired = $o['status'] === 'Cancelled' && strpos((string) $o['notes'], UNPAID_EXPIRED_NOTE) !== false;
    if ($o['status'] !== 'Awaiting payment' && !$expired) return;
    set_order_status($id, $status, $expired ? trim(str_replace(UNPAID_EXPIRED_NOTE, '', (string) $o['notes'])) : null);
    log_activity(null, $why, order_number($id) . ' · ' . $o['customer'] . ' · EGP ' . number_format((float) $o['total']));
    notify_order($id);
    try {
        lead_from_order(['name' => $o['customer'], 'phone' => $o['phone'], 'email' => $o['email']], ['id' => $id, 'number' => order_number($id), 'total' => (float) $o['total']],
            $o['rep_id'] ? (int) $o['rep_id'] : null, 'Website');
    } catch (Throwable $e) { error_log('[shop] lead from paid order failed: ' . $e->getMessage()); }
}

const UNPAID_EXPIRED_NOTE = 'Online payment not completed — released automatically.';

// Online orders still unpaid after 3 hours are cancelled (stock goes back) and the customer is kept as a lead to follow up.
function expire_unpaid_orders(): void
{
    $rows = db()->query("SELECT * FROM orders WHERE status = 'Awaiting payment' AND created_at < datetime('now', '-3 hours') LIMIT 50")->fetchAll();
    foreach ($rows as $o) {
        try {
            set_order_status((int) $o['id'], 'Cancelled', trim(UNPAID_EXPIRED_NOTE . ' ' . (string) $o['notes']));
            $items = implode(', ', array_map(function ($i) { return $i['qty'] . '× ' . $i['name']; }, json_decode($o['items'], true) ?: []));
            $note = date('Y-m-d') . ' · Started checkout (' . order_number((int) $o['id']) . ', EGP ' . number_format((float) $o['total']) . ') but didn’t finish paying online · ' . $items;
            $contact = trim($o['phone'] . ($o['email'] !== '' ? ' · ' . $o['email'] : ''), ' ·');
            $lead = find_lead(phone_key((string) $o['phone']), email_key((string) $o['email']));
            if ($lead) touch_lead($lead, $note, $lead['status'] === 'Won' ? null : 'New', $o['rep_id'] ? (int) $o['rep_id'] : null, $contact);
            else insert_lead(['name' => $o['customer'], 'contact' => $contact, 'cat' => mb_substr($items, 0, 120), 'source' => 'Unfinished online payment',
                'status' => 'New', 'notes' => $note, 'assigned_to' => $o['rep_id'] ?: null]);
        } catch (Throwable $e) { error_log('[shop] expiring unpaid order failed: ' . $e->getMessage()); }
    }
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
            COALESCE(SUM(CASE WHEN o.status NOT IN ('Cancelled','Returned','Awaiting payment') THEN o.total END), 0) AS revenue,
            SUM(CASE WHEN o.status = 'Delivered' THEN 1 ELSE 0 END) AS delivered,
            SUM(CASE WHEN o.status IN ('Cancelled','Returned') THEN 1 ELSE 0 END) AS lost,
            MAX(o.created_at) AS last_order
        FROM users u
        LEFT JOIN targets t ON t.user_id = u.id AND t.month = :m
        LEFT JOIN orders o ON o.rep_id = u.id AND o.created_at >= :f AND o.created_at < :t AND o.status != 'Awaiting payment'
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

// Commissions for a month. Earned on delivered orders, in the month they were delivered, on what the customer
// paid for the products (order total without shipping). An order delivered in an earlier month and returned this
// month comes off this month (the earlier month's figures don't change). Also shows what each person sold this month and what is still on the way.
function team_commissions(string $month): array
{
    [$month, $from, $to] = cairo_month_bounds($month);
    $pdo = db();
    // Each person's rate: this month's, or the last one set before it.
    $rates = [];
    $st = $pdo->prepare('SELECT user_id, commission_pct FROM targets WHERE commission_pct IS NOT NULL AND month <= ? ORDER BY month');
    $st->execute([$month]);
    foreach ($st as $r) $rates[(int) $r['user_id']] = (float) $r['commission_pct'];
    $members = [];
    foreach ($pdo->query("SELECT id, name, role, active FROM users ORDER BY name")->fetchAll() as $u) {
        $members[(int) $u['id']] = ['id' => (int) $u['id'], 'name' => $u['name'], 'role' => $u['role'], 'active' => (int) $u['active'],
            'pct' => $rates[(int) $u['id']] ?? 0.0, 'sold' => 0, 'soldValue' => 0.0, 'delivered' => 0, 'base' => 0.0, 'returnedLater' => 0, 'returnedBase' => 0.0,
            'open' => 0, 'openValue' => 0.0, 'lost' => 0, 'commission' => 0.0, 'orders' => []];
    }
    $net = function (array $o): float { return round(max(0, (float) $o['total'] - (float) $o['shipping']), 2); };
    // Sold this month (not cancelled/returned), and lost this month.
    $st = $pdo->prepare("SELECT rep_id, status, total, shipping FROM orders WHERE rep_id IS NOT NULL AND status != 'Awaiting payment' AND created_at >= ? AND created_at < ?");
    $st->execute([$from, $to]);
    foreach ($st as $o) {
        if (!isset($members[(int) $o['rep_id']])) continue;
        $m = &$members[(int) $o['rep_id']];
        if (in_array($o['status'], ['Cancelled', 'Returned'], true)) $m['lost']++;
        else { $m['sold']++; $m['soldValue'] += $net($o); }
        unset($m);
    }
    // Still on the way (any month): commission once delivered.
    foreach ($pdo->query("SELECT rep_id, total, shipping FROM orders WHERE rep_id IS NOT NULL AND status NOT IN ('Awaiting payment','Delivered','Cancelled','Returned')") as $o) {
        if (!isset($members[(int) $o['rep_id']])) continue;
        $members[(int) $o['rep_id']]['open']++;
        $members[(int) $o['rep_id']]['openValue'] += $net($o);
    }
    // Delivered this month, and returned this month after being delivered in an earlier month.
    $st = $pdo->prepare("SELECT id, rep_id, customer, status, total, shipping, created_at, delivered_at, updated_at FROM orders
        WHERE rep_id IS NOT NULL AND delivered_at IS NOT NULL AND (
            (delivered_at >= :f AND delivered_at < :t AND (status = 'Delivered' OR (status IN ('Returned','Cancelled') AND updated_at >= :t))) OR
            (status IN ('Returned','Cancelled') AND delivered_at < :f AND updated_at >= :f AND updated_at < :t))
        ORDER BY delivered_at");
    $st->execute([':f' => $from, ':t' => $to]);
    foreach ($st as $o) {
        if (!isset($members[(int) $o['rep_id']])) continue;
        $m = &$members[(int) $o['rep_id']];
        $base = $net($o);
        // Returned in this month after an earlier month's delivery comes off; returned after this month still counts here.
        $back = $o['status'] !== 'Delivered' && $o['delivered_at'] < $from;
        if ($back) { $m['returnedLater']++; $m['returnedBase'] += $base; } else { $m['delivered']++; $m['base'] += $base; }
        $m['orders'][] = ['id' => (int) $o['id'], 'number' => order_number((int) $o['id']), 'customer' => $o['customer'], 'status' => $o['status'],
            'createdAt' => $o['created_at'], 'deliveredAt' => $o['delivered_at'], 'returnedAt' => $back ? $o['updated_at'] : null, 'returnedLater' => !$back && $o['status'] !== 'Delivered' ? $o['updated_at'] : null,
            'total' => (float) $o['total'], 'shipping' => (float) $o['shipping'], 'base' => $back ? -$base : $base];
        unset($m);
    }
    $totals = ['sold' => 0, 'soldValue' => 0.0, 'delivered' => 0, 'base' => 0.0, 'commission' => 0.0];
    $out = [];
    foreach ($members as $m) {
        $m['base'] = round($m['base'] - $m['returnedBase'], 2);
        $m['commission'] = round($m['base'] * $m['pct'] / 100, 2);
        foreach (['soldValue', 'openValue', 'returnedBase'] as $k) $m[$k] = round($m[$k], 2);
        foreach ($m['orders'] as &$x) $x['commission'] = round($x['base'] * $m['pct'] / 100, 2);
        unset($x);
        // People who sell, or who had anything this month.
        $sells = in_array($m['role'], ['sales', 'telesales', 'staff'], true) && $m['active'];
        if (!$sells && !$m['sold'] && !$m['orders'] && !$m['open'] && !$m['pct']) continue;
        foreach (['sold', 'soldValue', 'delivered', 'base', 'commission'] as $k) $totals[$k] += $m[$k];
        $out[] = $m;
    }
    usort($out, function ($a, $b) { return [$b['commission'], $b['soldValue']] <=> [$a['commission'], $a['soldValue']]; });
    return ['month' => $month, 'members' => $out, 'totals' => $totals];
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
    if (!$existing && !empty($in['lead_id'])) {
        // Order created from a lead ("Convert to order") whose contact details differ: still close that lead.
        $st = db()->prepare('SELECT * FROM leads WHERE id = ?');
        $st->execute([(int) $in['lead_id']]);
        $existing = $st->fetch() ?: null;
    }
    if ($existing) {
        touch_lead($existing, $note, 'Won', $repId, $contact);
        return 'updated';
    }
    insert_lead(['name' => $name, 'contact' => $contact, 'cat' => mb_substr($what, 0, 120), 'source' => 'Order ' . $order['number'] . ' · ' . $channel,
        'status' => 'Won', 'notes' => $note, 'assigned_to' => $repId]);
    return 'created';
}

// ---------- quotes ----------
const QUOTE_STATUSES = ['Draft', 'Sent', 'Accepted', 'Declined'];

// Every quote's customer is kept as a lead: an existing lead (by phone or email) gets a note and moves
// to Quoted; someone new becomes a Quoted lead. The quote is linked to it. Safe to call more than once.
function link_quote_lead(int $quoteId): void
{
    $st = db()->prepare('SELECT * FROM quotes WHERE id = ?');
    $st->execute([$quoteId]);
    $q = $st->fetch();
    if (!$q) return;
    if ($q['lead_id']) {
        $has = db()->prepare('SELECT 1 FROM leads WHERE id = ?');
        $has->execute([(int) $q['lead_id']]);
        if ($has->fetchColumn()) return;
    }
    $note = substr((string) $q['created_at'], 0, 10) . ' · Quote ' . quote_number($quoteId) . ' · EGP ' . number_format((float) $q['total']);
    $contact = trim($q['phone'] . ($q['email'] !== '' ? ' · ' . $q['email'] : ''), ' ·');
    $lead = find_lead(phone_key((string) $q['phone']), email_key((string) $q['email']));
    if ($lead) {
        touch_lead($lead, $note, in_array($lead['status'], ['New', 'Contacted'], true) ? 'Quoted' : null, $q['rep_id'] ? (int) $q['rep_id'] : null, $contact);
        $leadId = (int) $lead['id'];
    } else {
        $items = implode(', ', array_map(function ($i) { return $i['qty'] . '× ' . $i['name']; }, json_decode((string) $q['items'], true) ?: []));
        $leadId = insert_lead(['name' => $q['customer'], 'contact' => $contact, 'cat' => mb_substr($items, 0, 120), 'source' => 'Quote',
            'status' => 'Quoted', 'notes' => $note, 'assigned_to' => $q['rep_id'] ?: null]);
    }
    db()->prepare('UPDATE quotes SET lead_id = ? WHERE id = ?')->execute([$leadId, $quoteId]);
}

function quote_number(int $id): string
{
    return 'Q-' . (1000 + $id);
}

// Price quote lines with the same rules as orders (sizes, quantity tiers, extras, custom lines),
// without checking or reserving stock.
function price_quote_items(array $items): array
{
    if (!$items || count($items) > 50) throw new ShopError('Add at least one product.');
    $get = db()->prepare("SELECT * FROM products WHERE id = ? AND status = 'Active'");
    $lines = []; $clean = []; $subtotal = 0.0; $physical = 0.0;
    foreach ($items as $it) {
        $qty = max(1, min(99999, (int) ($it['qty'] ?? 1)));
        $note = str_in($it['note'] ?? '', 1000); // optional description shown under the item on the quote
        if (!empty($it['custom'])) {
            $cname = str_in($it['name'] ?? '', 160);
            $cprice = round((float) ($it['price'] ?? 0), 2);
            if ($cname === '' || $cprice <= 0) throw new ShopError('Custom items need a description and a price.');
            $lineTotal = round($cprice * $qty);
            $ship = !isset($it['ship']) || !empty($it['ship']);
            $lines[] = ['id' => 'custom', 'name' => $cname, 'qty' => $qty, 'price' => $cprice, 'total' => $lineTotal, 'cat' => $ship ? 'custom' : 'services'] + ($note !== '' ? ['note' => $note] : []);
            $clean[] = ['custom' => 1, 'name' => $cname, 'price' => $cprice, 'qty' => $qty, 'ship' => $ship ? 1 : 0, 'note' => $note];
            $subtotal += $lineTotal;
            if ($ship) $physical += $lineTotal;
            continue;
        }
        $get->execute([(string) ($it['id'] ?? '')]);
        $p = $get->fetch();
        if (!$p) throw new ShopError('A product in the quote is no longer available.');
        $addonIds = array_values(array_map('strval', (array) ($it['addons'] ?? [])));
        [$unit, $lineTotal, $variant, $addons, $lineName] = price_line($p, isset($it['variant']) ? (string) $it['variant'] : null, $addonIds, $qty);
        $lines[] = ['id' => $p['id'], 'name' => $lineName, 'qty' => $qty, 'price' => $unit, 'total' => $lineTotal, 'cat' => $p['cat']] + ($note !== '' ? ['note' => $note] : []);
        $clean[] = ['id' => $p['id'], 'variant' => $variant ? (string) $variant['id'] : null, 'addons' => $addonIds, 'qty' => $qty, 'note' => $note];
        $subtotal += $lineTotal;
        if ($p['cat'] !== 'services') $physical += $lineTotal;
    }
    return [$lines, $clean, round($subtotal, 2), $physical];
}

// Customer logos and design files for an order: images or PDF, random file names, no scripts.
function store_order_file(array $f, string $prefix): string
{
    if ($f['size'] > cfg('max_upload_bytes')) fail('File is too large (max ' . (cfg('max_upload_bytes') >> 20) . ' MB).');
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
    $exts = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'application/pdf' => 'pdf'];
    if (!isset($exts[$mime])) fail('Only JPG, PNG, WebP or PDF files are allowed.');
    if ($mime !== 'application/pdf' && !@getimagesize($f['tmp_name'])) fail('That image file looks damaged.');
    $dir = cfg('order_upload_dir');
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $name = $prefix . '-' . bin2hex(random_bytes(8)) . '.' . $exts[$mime];
    if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $name)) fail('Could not save the file on the server.', 500);
    @chmod($dir . '/' . $name, 0644);
    return cfg('order_upload_url') . '/' . $name;
}

