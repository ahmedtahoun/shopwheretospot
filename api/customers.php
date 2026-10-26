<?php
// Customer accounts for the shop. No passwords: the customer types their email, we send a 6-digit
// code, and the code signs them in on that device (a cookie with a random token, kept 180 days).
// The account keeps their delivery details for checkout, lists their orders with tracking, and
// stores preferences. Orders placed with the same email before they signed up show up too,
// because signing in proves they own that email.

const CUSTOMER_COOKIE = 'wts_cust';
const CUSTOMER_DAYS = 180;

function customer_cookie(string $value, int $expires): void
{
    setcookie(CUSTOMER_COOKIE, $value, ['expires' => $expires, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true, 'samesite' => 'Lax']);
}

function current_customer(): ?array
{
    $token = (string) ($_COOKIE[CUSTOMER_COOKIE] ?? '');
    if (strlen($token) < 32) return null;
    $st = db()->prepare('SELECT c.* FROM customer_sessions s JOIN customers c ON c.id = s.customer_id WHERE s.token_hash = ? AND s.expires > ?');
    $st->execute([hash('sha256', $token), time()]);
    return $st->fetch() ?: null;
}

// Step 1: email a sign-in code. Same answer whether or not the email has an account.
function customer_send_code(string $email, string $lang): void
{
    $email = strtolower(trim($email));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new ShopError('Please enter a valid email.');
    if (too_many_attempts('ccode', 8, 3600)) throw new ShopError('Too many tries. Please wait a while.');
    record_attempt('ccode');
    $pdo = db();
    $st = $pdo->prepare('SELECT sent_at, sends FROM customer_codes WHERE email = ?');
    $st->execute([$email]);
    $row = $st->fetch();
    if ($row && (int) $row['sent_at'] > time() - 45) throw new ShopError('We just sent a code — please check your email (and spam), or wait a minute to get a new one.');
    $sends = $row && (int) $row['sent_at'] > time() - 3600 ? (int) $row['sends'] + 1 : 1;
    if ($sends > 5) throw new ShopError('Too many tries. Please wait a while.');
    $code = (string) random_int(100000, 999999);
    $pdo->prepare('INSERT OR REPLACE INTO customer_codes (email, code_hash, expires, tries, sent_at, sends) VALUES (?, ?, ?, 0, ?, ?)')
        ->execute([$email, password_hash($code, PASSWORD_DEFAULT), time() + 900, time(), $sends]);
    $ar = $lang === 'ar';
    $title = $ar ? 'كود الدخول: ' . $code : 'Your sign-in code: ' . $code;
    $inner = '<p style="font-size:15px;line-height:1.6">' . ($ar ? 'استخدم هذا الكود لتسجيل الدخول إلى حسابك في متجر Where To Spot:' : 'Use this code to sign in to your Where To Spot shop account:') . '</p>'
        . '<div style="font-size:34px;font-weight:bold;letter-spacing:8px;background:#F7F3ED;border-radius:12px;padding:16px;text-align:center;margin:16px 0">' . $code . '</div>'
        . '<p style="font-size:13px;color:#6B6660">' . ($ar ? 'الكود صالح لمدة 15 دقيقة. إذا لم تطلبه، تجاهل هذه الرسالة.' : 'The code works for 15 minutes. If you didn’t ask for it, you can ignore this email.') . '</p>';
    send_mail_later([$email], $title, email_shell($ar ? 'تسجيل الدخول' : 'Sign in', $inner, 'customer'),
        ($ar ? 'كود الدخول: ' : 'Your sign-in code: ') . $code . "\n" . ($ar ? 'صالح لمدة 15 دقيقة.' : 'It works for 15 minutes.'));
}

// Step 2: check the code, create the account on first sign-in, and start a session on this device.
function customer_verify(string $email, string $code): array
{
    $email = strtolower(trim($email));
    $code = preg_replace('/\D/', '', $code);
    if (too_many_attempts('cverify', 20, 3600)) throw new ShopError('Too many tries. Please wait a while.');
    $pdo = db();
    $st = $pdo->prepare('SELECT * FROM customer_codes WHERE email = ?');
    $st->execute([$email]);
    $row = $st->fetch();
    if (!$row || (int) $row['expires'] < time()) throw new ShopError('This code has expired. Please ask for a new one.');
    if ((int) $row['tries'] >= 5) throw new ShopError('Too many wrong codes. Please ask for a new one.');
    if (!password_verify($code, $row['code_hash'])) {
        record_attempt('cverify');
        $pdo->prepare('UPDATE customer_codes SET tries = tries + 1 WHERE email = ?')->execute([$email]);
        throw new ShopError('That code isn’t right. Check the latest email we sent.');
    }
    $pdo->prepare('DELETE FROM customer_codes WHERE email = ?')->execute([$email]);
    $pdo->prepare('INSERT OR IGNORE INTO customers (email) VALUES (?)')->execute([$email]);
    $st = $pdo->prepare('SELECT * FROM customers WHERE email = ?');
    $st->execute([$email]);
    $c = $st->fetch();
    // Fill an empty profile from their latest order, so checkout is ready straight away.
    if ($c['name'] === '' && $c['phone'] === '') {
        $o = $pdo->prepare("SELECT * FROM orders WHERE email = ? COLLATE NOCASE ORDER BY id DESC LIMIT 1");
        $o->execute([$email]);
        if ($last = $o->fetch()) customer_remember_order((int) $c['id'], $last);
    }
    $token = bin2hex(random_bytes(32));
    $pdo->prepare('DELETE FROM customer_sessions WHERE expires < ?')->execute([time()]);
    $pdo->prepare('INSERT INTO customer_sessions (token_hash, customer_id, expires) VALUES (?, ?, ?)')->execute([hash('sha256', $token), $c['id'], time() + CUSTOMER_DAYS * 86400]);
    $pdo->prepare("UPDATE customers SET last_login = datetime('now') WHERE id = ?")->execute([$c['id']]);
    customer_cookie($token, time() + CUSTOMER_DAYS * 86400);
    $st->execute([$email]);
    return $st->fetch();
}

function customer_logout(): void
{
    $token = (string) ($_COOKIE[CUSTOMER_COOKIE] ?? '');
    if ($token !== '') db()->prepare('DELETE FROM customer_sessions WHERE token_hash = ?')->execute([hash('sha256', $token)]);
    customer_cookie('', time() - 3600);
}

// Keep the delivery details of an order on the account (what "saves my information" means).
function customer_remember_order(int $customerId, array $o, array $area = []): void
{
    db()->prepare("UPDATE customers SET name = ?, phone = ?, address = ?, city = ?, city_id = ?, district_id = ?, district = ?,
        zone_id = COALESCE(?, zone_id), area_title = COALESCE(?, area_title), area_sub = COALESCE(?, area_sub) WHERE id = ?")
        ->execute([$o['customer'], $o['phone'], $o['address'], $o['city'], $o['city_id'], $o['district_id'], $o['district'] ?? '',
            $area['zone_id'] ?? null, $area['area_title'] ?? null, $area['area_sub'] ?? null, $customerId]);
}

function customer_out(array $c): array
{
    return ['email' => $c['email'], 'name' => $c['name'], 'phone' => $c['phone'], 'address' => $c['address'], 'city' => $c['city'],
        'cityId' => $c['city_id'], 'districtId' => $c['district_id'], 'zoneId' => $c['zone_id'], 'areaTitle' => $c['area_title'], 'areaSub' => $c['area_sub'],
        'lang' => $c['lang'], 'contact' => $c['contact_pref'], 'offers' => (bool) $c['offers'], 'since' => substr((string) $c['created_at'], 0, 10),
        'addresses' => customer_addresses($c)];
}

// Delivery addresses used on the account's orders (newest first, no repeats).
function customer_addresses(array $c): array
{
    $st = db()->prepare("SELECT address, city, district, city_id, district_id FROM orders WHERE (customer_id = ? OR email = ? COLLATE NOCASE)
        AND TRIM(address) != '' ORDER BY id DESC LIMIT 40");
    $st->execute([$c['id'], $c['email']]);
    $out = [];
    $seen = [];
    foreach ($st->fetchAll() as $r) {
        $k = mb_strtolower(preg_replace('/\s+/', ' ', trim($r['address']))) . '|' . $r['district_id'];
        if (isset($seen[$k])) continue;
        $seen[$k] = true;
        $out[] = ['address' => $r['address'], 'city' => $r['city'], 'district' => $r['district'], 'cityId' => $r['city_id'], 'districtId' => $r['district_id'],
            'current' => trim($r['address']) === trim((string) $c['address']) && (string) $r['district_id'] === (string) $c['district_id']];
        if (count($out) >= 5) break;
    }
    return $out;
}

// Orders on the account: placed while signed in, or with the account's email.
function customer_orders(array $c): array
{
    $st = db()->prepare("SELECT * FROM orders WHERE (customer_id = ? OR email = ? COLLATE NOCASE)
        AND NOT (status = 'Cancelled' AND notes LIKE ?) ORDER BY id DESC LIMIT 50");
    $st->execute([$c['id'], $c['email'], '%' . UNPAID_EXPIRED_NOTE . '%']);
    $imgs = [];
    foreach (db()->query('SELECT product_id, path FROM product_images ORDER BY sort, id') as $i) if (!isset($imgs[$i['product_id']])) $imgs[$i['product_id']] = $i['path'];
    $active = db()->query("SELECT id FROM products WHERE status = 'Active'")->fetchAll(PDO::FETCH_COLUMN);
    return array_map(function ($o) use ($imgs, $active) {
        $paid = order_paid((int) $o['id']);
        $items = json_decode($o['items'], true) ?: [];
        return [
            'number' => order_number((int) $o['id']), 'date' => substr($o['created_at'], 0, 10), 'status' => $o['status'],
            'total' => (float) $o['total'], 'shipping' => (float) $o['shipping'], 'discount' => (float) $o['discount'],
            'paid' => $paid >= (float) $o['total'] - 0.5, 'due' => max(0, round((float) $o['total'] - $paid, 2)), 'payment' => $o['payment'],
            'tracking' => $o['tracking_number'] ?: '', 'shipment' => $o['tracking_number'] ? bosta_state_label($o['bosta_state'] === null ? null : (int) $o['bosta_state']) : '',
            'address' => trim($o['address'] . ($o['district'] ? ', ' . $o['district'] : '') . ($o['city'] ? ', ' . $o['city'] : ''), ', '),
            'items' => array_map(function ($it) use ($imgs, $active) {
                $id = (string) ($it['id'] ?? '');
                return ['id' => $id, 'variant' => $it['variant'] ?? null, 'addons' => $it['addons'] ?? [], 'name' => $it['name'], 'qty' => (int) $it['qty'],
                    'total' => (float) ($it['total'] ?? $it['qty'] * $it['price']), 'image' => $imgs[$id] ?? '', 'available' => in_array($id, $active, true)];
            }, $items),
        ];
    }, $st->fetchAll());
}

function customer_save(array $c, array $b): array
{
    $name = str_in($b['name'] ?? $c['name'], 120);
    $phone = str_in($b['phone'] ?? $c['phone'], 40);
    $contact = in_array($b['contact'] ?? '', ['whatsapp', 'call', 'email'], true) ? $b['contact'] : $c['contact_pref'];
    $lang = in_array($b['lang'] ?? '', ['ar', 'en'], true) ? $b['lang'] : $c['lang'];
    db()->prepare('UPDATE customers SET name = ?, phone = ?, address = ?, contact_pref = ?, lang = ?, offers = ? WHERE id = ?')
        ->execute([$name, $phone, str_in($b['address'] ?? $c['address'], 500), $contact, $lang,
            array_key_exists('offers', $b) ? (empty($b['offers']) ? 0 : 1) : (int) $c['offers'], $c['id']]);
    // "Use this address": an earlier delivery area becomes the default too.
    if (array_key_exists('districtId', $b)) {
        db()->prepare("UPDATE customers SET city = ?, city_id = ?, district_id = ?, district = ?, zone_id = NULL, area_title = ?, area_sub = ? WHERE id = ?")
            ->execute([str_in($b['city'] ?? '', 80), str_in($b['cityId'] ?? '', 40) ?: null, str_in($b['districtId'] ?? '', 40) ?: null, str_in($b['district'] ?? '', 120),
                str_in($b['district'] ?? '', 120), str_in($b['city'] ?? '', 80), $c['id']]);
    }
    $st = db()->prepare('SELECT * FROM customers WHERE id = ?');
    $st->execute([$c['id']]);
    return $st->fetch();
}
