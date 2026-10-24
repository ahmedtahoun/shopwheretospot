<?php
// The review-link tool's account side (google-review-link.html; see api/qrtool.php). No team login:
// shop customer accounts (email code sign-in).
//   GET  ?action=me                       → signed in?, QR balance, their businesses, packs, payment methods
//   POST ?action=code {email}             → email a sign-in code
//   POST ?action=verify {email, code}     → sign in
//   POST ?action=logout
//   POST ?action=create {link, name, …}   → make a QR for a business (uses 1 from the balance; free if already made)
//   POST ?action=update {id, name, target, card_lang, page}
//   POST ?action=logo  (form: id, file)   → logo for the business page
//   POST ?action=buy {pack, method}       → Paymob page for a QR pack

require __DIR__ . '/bootstrap.php';

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

function qr_me(?array $c): array
{
    $packs = [];
    foreach (QR_PACKS as $k => $p) $packs[] = ['id' => $k, 'credits' => $p['credits'], 'price' => $p['price'], 'en' => $p['en'], 'ar' => $p['ar']];
    return ['email' => $c ? $c['email'] : null, 'balance' => $c ? qr_balance((int) $c['id']) : null, 'free' => QR_FREE,
        'businesses' => $c ? qr_businesses((int) $c['id']) : [], 'packs' => $packs, 'payMethods' => array_keys(paymob_visible_methods()),
        'colors' => QR_COLORS];
}

try {
    if ($action === 'me' && $method === 'GET') json_out(qr_me(current_customer()));
    if ($method !== 'POST') fail('Not found', 404);
    $b = body();

    if ($action === 'code') { customer_send_code(str_in($b['email'] ?? '', 160), ($b['lang'] ?? '') === 'ar' ? 'ar' : 'en'); json_out(['ok' => true]); }
    if ($action === 'verify') { $c = customer_verify(str_in($b['email'] ?? '', 160), str_in($b['code'] ?? '', 12)); json_out(qr_me($c)); }
    if ($action === 'logout') { customer_logout(); json_out(qr_me(null)); }

    $c = current_customer();
    if (!$c) fail('Please sign in first.', 401);
    if ($action === 'create') {
        if (too_many_attempts('qrmake', 60, 3600)) fail('Too many requests. Please wait a while.', 429);
        record_attempt('qrmake');
        $biz = qr_create($c, $b);
        json_out(['business' => $biz] + qr_me($c));
    }
    if ($action === 'update') json_out(['business' => qr_update($c, $b)] + qr_me($c));
    if ($action === 'logo') {
        if (too_many_attempts('qrlogo', 20, 3600)) fail('Too many uploads. Please wait a while.', 429);
        record_attempt('qrlogo');
        json_out(['business' => qr_logo($c, (int) ($_POST['id'] ?? 0), $_FILES['file'] ?? [])] + qr_me($c));
    }
    if ($action === 'buy') {
        if (too_many_attempts('qrbuy', 15, 3600)) fail('Too many attempts. Please wait a while.', 429);
        record_attempt('qrbuy');
        json_out(['payUrl' => qr_buy($c, str_in($b['pack'] ?? '', 20), str_in($b['method'] ?? '', 20))]);
    }
    fail('Not found', 404);
} catch (ShopError $e) {
    fail($e->getMessage(), in_array($e->getCode(), [401, 402, 404, 429], true) ? $e->getCode() : 400);
}
