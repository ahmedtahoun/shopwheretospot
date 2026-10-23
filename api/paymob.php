<?php
// Paymob online payments (cards and mobile wallets) through Paymob's Unified Checkout.
//
// Flow: the shop creates the order, then an "intention" here; the customer pays on Paymob's
// hosted page; Paymob calls api/paymob-webhook.php (server to server) and sends the customer
// back to api/paymob-return.php. Both are verified with the HMAC secret, and the payment is
// recorded on the order once (deduplicated by Paymob's transaction id).
//
// Settings live in api/config.local.php on the server, never in git:
//   'paymob' => ['secret_key' => 'egy_sk_…', 'public_key' => 'egy_pk_…', 'hmac_secret' => '…',
//                'card_integration_id' => 1234567, 'wallet_integration_id' => 1234568]

function paymob_cfg(): array
{
    $c = (array) (cfg('paymob') ?: []);
    return $c + ['base_url' => 'https://accept.paymob.com', 'secret_key' => '', 'public_key' => '', 'hmac_secret' => '',
        'card_integration_id' => 0, 'wallet_integration_id' => 0];
}

// Which online methods the checkout can offer right now.
function paymob_methods(): array
{
    $c = paymob_cfg();
    if (!$c['secret_key'] || !$c['public_key'] || !$c['hmac_secret']) return [];
    $m = [];
    if ((int) $c['card_integration_id']) $m['paymob_card'] = (int) $c['card_integration_id'];
    if ((int) $c['wallet_integration_id']) $m['paymob_wallet'] = (int) $c['wallet_integration_id'];
    return $m;
}

function paymob_is_test(): bool
{
    return strpos((string) paymob_cfg()['secret_key'], '_test_') !== false;
}

// Online methods the current visitor may use. With test keys, only testers see them (a browser that
// opened the shop once with ?paytest=1); real customers keep cash on delivery until live keys are in.
function paymob_visible_methods(): array
{
    if (paymob_is_test() && ($_COOKIE['wts_paytest'] ?? '') !== '1') return [];
    return paymob_methods();
}

// Create a payment intention for an order and return the hosted checkout URL.
function paymob_checkout_url(int $orderId, string $method): string
{
    $methods = paymob_methods();
    if (!isset($methods[$method])) throw new ShopError('Online payment is not available right now. Please choose cash on delivery.');
    $c = paymob_cfg();
    $st = db()->prepare('SELECT * FROM orders WHERE id = ?');
    $st->execute([$orderId]);
    $o = $st->fetch();
    if (!$o) throw new ShopError('Order not found.');
    $due = round((float) $o['total'] - order_paid($orderId), 2);
    if ($due <= 0) throw new ShopError('This order is already paid.');
    $cents = (int) round($due * 100);

    $parts = preg_split('/\s+/', trim((string) $o['customer'])) ?: [];
    $first = mb_substr($parts[0] ?? 'Customer', 0, 50);
    $last = mb_substr(count($parts) > 1 ? implode(' ', array_slice($parts, 1)) : $first, 0, 50);
    $site = rtrim(cfg('site_url'), '/');
    $number = order_number($orderId);
    $body = [
        'amount' => $cents,
        'currency' => 'EGP',
        'payment_methods' => [$methods[$method]],
        // One line for the whole order, so discounts and delivery always add up to the amount.
        'items' => [['name' => mb_substr('Where To Spot order ' . $number, 0, 50), 'amount' => $cents, 'quantity' => 1,
            'description' => mb_substr(implode(', ', array_map(function ($i) { return $i['qty'] . '× ' . $i['name']; }, json_decode($o['items'], true) ?: [])), 0, 255)]],
        'billing_data' => [
            'first_name' => $first, 'last_name' => $last, 'email' => $o['email'] ?: 'orders@wheretospot.com',
            'phone_number' => $o['phone'] ?: 'NA', 'street' => mb_substr($o['address'] ?: 'NA', 0, 200), 'building' => 'NA', 'floor' => 'NA',
            'apartment' => 'NA', 'city' => $o['district'] ?: ($o['city'] ?: 'NA'), 'state' => $o['city'] ?: 'NA', 'country' => 'EG',
        ],
        // Unique per attempt (Paymob refuses a reused reference); the order id is the part before the dash.
        'special_reference' => $ref = $number . '-' . bin2hex(random_bytes(3)),
        'notification_url' => $site . '/api/paymob-webhook.php',
        'redirection_url' => $site . '/api/paymob-return.php',
        'extras' => ['order_id' => $orderId],
    ];
    // Remember the reference: order numbers can be reused after test orders are deleted, so a payment
    // only counts for the order whose own payment session it came from.
    db()->prepare("UPDATE orders SET pay_refs = TRIM(COALESCE(pay_refs, '') || ' ' || ?) WHERE id = ?")->execute([$ref, $orderId]);
    $res = paymob_request('POST', '/v1/intention/', $body);
    if (empty($res['client_secret'])) throw new ShopError('Paymob did not start the payment. Please try again or choose cash on delivery.');
    return $c['base_url'] . '/unifiedcheckout/?publicKey=' . rawurlencode($c['public_key']) . '&clientSecret=' . rawurlencode($res['client_secret']);
}

// A link the team sends a customer (e.g. in WhatsApp) to pay what's still due on an order online.
// It never expires: each time it's opened, api/pay.php starts a fresh Paymob payment for the amount due then.
function pay_link_key(int $orderId): string
{
    return substr(hash_hmac('sha256', 'pay-link:' . $orderId, setup_key()), 0, 20);
}

function pay_link_url(int $orderId): string
{
    return rtrim((string) cfg('site_url'), '/') . '/api/pay.php?o=' . $orderId . '&k=' . pay_link_key($orderId);
}

// Can this order be paid by link right now? '' = yes, otherwise the reason.
function pay_link_problem(array $o): string
{
    if (!paymob_methods()) return 'Online payment isn’t set up (Settings → Online payments).';
    if (in_array($o['status'], ['Cancelled', 'Returned', 'Delivered'], true)) return 'This order is ' . strtolower($o['status']) . '.';
    if (round((float) $o['total'] - order_paid((int) $o['id']), 2) <= 0) return 'This order is already paid.';
    return '';
}

function paymob_request(string $method, string $path, ?array $body = null): array
{
    // (paymob_status shows the real Paymob reply to the owner when a test fails)
    $c = paymob_cfg();
    $ch = curl_init(rtrim($c['base_url'], '/') . $path);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 25,
        CURLOPT_HTTPHEADER => ['Authorization: Token ' . $c['secret_key'], 'Content-Type: application/json', 'Accept: application/json'],
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    if ($raw === false) throw new ShopError('Could not reach Paymob (' . $err . '). Please try again.');
    $json = json_decode((string) $raw, true);
    if ($code >= 400 || !is_array($json)) {
        error_log('[paymob] HTTP ' . $code . ' ' . mb_substr((string) $raw, 0, 500));
        $GLOBALS['paymob_last_error'] = 'HTTP ' . $code . ' · ' . mb_substr(is_array($json) ? json_encode($json, JSON_UNESCAPED_UNICODE) : (string) $raw, 0, 300);
        throw new ShopError('Online payment could not be started. Please try again or choose cash on delivery.');
    }
    return $json;
}

// HMAC for transaction callbacks: these fields, in this order, concatenated, SHA-512 with the HMAC secret.
// $get = true for the customer redirect (query parameters), false for the webhook (JSON "obj").
function paymob_hmac_valid(array $t, string $hmac, bool $get): bool
{
    $secret = (string) paymob_cfg()['hmac_secret'];
    if ($secret === '' || $hmac === '') return false;
    $v = function ($x) { return is_bool($x) ? ($x ? 'true' : 'false') : (string) ($x ?? ''); };
    if ($get) {
        $fields = [$t['amount_cents'] ?? '', $t['created_at'] ?? '', $t['currency'] ?? '', $t['error_occured'] ?? '', $t['has_parent_transaction'] ?? '',
            $t['id'] ?? '', $t['integration_id'] ?? '', $t['is_3d_secure'] ?? '', $t['is_auth'] ?? '', $t['is_capture'] ?? '', $t['is_refunded'] ?? '',
            $t['is_standalone_payment'] ?? '', $t['is_voided'] ?? '', $t['order'] ?? ($t['order_id'] ?? ''), $t['owner'] ?? '', $t['pending'] ?? '',
            $t['source_data_pan'] ?? ($t['source_data.pan'] ?? ''), $t['source_data_sub_type'] ?? ($t['source_data.sub_type'] ?? ''),
            $t['source_data_type'] ?? ($t['source_data.type'] ?? ''), $t['success'] ?? ''];
    } else {
        $fields = [$t['amount_cents'] ?? '', $t['created_at'] ?? '', $t['currency'] ?? '', $t['error_occured'] ?? '', $t['has_parent_transaction'] ?? '',
            $t['id'] ?? '', $t['integration_id'] ?? '', $t['is_3d_secure'] ?? '', $t['is_auth'] ?? '', $t['is_capture'] ?? '', $t['is_refunded'] ?? '',
            $t['is_standalone_payment'] ?? '', $t['is_voided'] ?? '', $t['order']['id'] ?? '', $t['owner'] ?? '', $t['pending'] ?? '',
            $t['source_data']['pan'] ?? '', $t['source_data']['sub_type'] ?? '', $t['source_data']['type'] ?? '', $t['success'] ?? ''];
    }
    $calc = hash_hmac('sha512', implode('', array_map($v, $fields)), $secret);
    return hash_equals($calc, strtolower($hmac));
}

// Our order id from Paymob's merchant reference "WTS-1001-ab12cd".
function paymob_order_id(string $merchantRef): int
{
    return preg_match('/^WTS-(\d+)/', $merchantRef, $m) ? (int) $m[1] - 1000 : 0;
}

// Record a successful transaction on the order, once. Returns true if the order is now fully paid.
function paymob_record(int $orderId, string $txnId, int $amountCents, string $label, string $ref = ''): bool
{
    if ($orderId <= 0 || $txnId === '') return false;
    $pdo = db();
    $st = $pdo->prepare('SELECT id, status, pay_refs, payment FROM orders WHERE id = ?');
    $st->execute([$orderId]);
    $o = $st->fetch();
    if (!$o) return false;
    // Orders whose payment page was opened before references were saved have none; they're accepted if they were
    // online-payment orders (a reused number always gets references, and a cash order never takes Paymob money).
    $legacy = trim((string) $o['pay_refs']) === '' && strpos((string) $o['payment'], 'paymob_') === 0;
    if (!$legacy && ($ref === '' || !in_array($ref, preg_split('/\s+/', trim((string) $o['pay_refs'])), true))) {
        log_activity(null, 'Online payment not matched', 'Paymob ' . ($ref ?: '(no reference)') . ' · txn ' . $txnId . ' · EGP ' . number_format($amountCents / 100) . ' — check in Paymob');
        return false;
    }
    tx_begin();
    try {
        $dupe = $pdo->prepare("SELECT 1 FROM payments WHERE order_id = ? AND method = 'paymob' AND note LIKE ?");
        $dupe->execute([$orderId, '%txn ' . $txnId]);
        if (!$dupe->fetchColumn()) {
            add_payment($orderId, $amountCents / 100, 'paymob', mb_substr($label, 0, 120) . ' · txn ' . $txnId, null);
            log_activity(null, 'Online payment received', order_number($orderId) . ' · EGP ' . number_format($amountCents / 100) . ' · ' . $label);
            // Thank the customer on WhatsApp and tell the team on Telegram (api/whatsapp.php), once per payment.
            wa_payment_received($orderId, $amountCents / 100);
        }
        tx_commit();
    } catch (Throwable $e) {
        tx_rollback();
        throw $e;
    }
    $st = $pdo->prepare('SELECT total FROM orders WHERE id = ?');
    $st->execute([$orderId]);
    $full = order_paid($orderId) >= (float) $st->fetchColumn() - 0.5;
    if ($full) confirm_online_order($orderId, 'New order · paid online', 'Confirmed');
    return $full;
}
