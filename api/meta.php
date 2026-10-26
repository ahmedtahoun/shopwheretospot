<?php
// Ad tracking: Meta Pixel + Conversions API, and Google Analytics 4.
// The browser part is api/track.php (loaded on every shop page). Here the server tells Meta about each
// purchase directly, with the same event ID as the browser, so Meta counts it once even when an ad
// blocker or iPhone privacy stops the browser pixel.
// Settings in api/config.local.php: 'meta' => ['pixel_id' => '…', 'capi_token' => '…', 'test_code' => ''], 'ga4_id' => 'G-…'.

declare(strict_types=1);

function meta_cfg(string $key, $default = '')
{
    $c = (array) (cfg('meta') ?: []);
    return $c[$key] ?? $default;
}

// The Conversions API needs the pixel and an access token made for it in Events Manager.
function meta_ready(): bool
{
    return preg_match('/^\d{6,20}$/', (string) meta_cfg('pixel_id')) && (string) meta_cfg('capi_token') !== '';
}

function meta_migrate(PDO $pdo): void
{
    $cols = array_column($pdo->query('PRAGMA table_info(orders)')->fetchAll(), 'name');
    // What the browser had when the order was placed (Meta's cookies, IP, browser), and when Meta was told.
    if (!in_array('track', $cols, true)) $pdo->exec("ALTER TABLE orders ADD COLUMN track TEXT DEFAULT ''");
    if (!in_array('capi_at', $cols, true)) $pdo->exec('ALTER TABLE orders ADD COLUMN capi_at TEXT');
}

// Saved with a website order: Meta's browser cookies (_fbp, and _fbc after an ad click), IP and browser.
function meta_remember_order(int $orderId): void
{
    $t = ['fbp' => (string) ($_COOKIE['_fbp'] ?? ''), 'fbc' => (string) ($_COOKIE['_fbc'] ?? ''), 'ip' => client_ip(), 'ua' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 400)];
    foreach (['fbp', 'fbc'] as $k) if (!preg_match('/^fb\.\d\.\d+\.[A-Za-z0-9_\-\.]+$/', $t[$k])) $t[$k] = '';
    db()->prepare('UPDATE orders SET track = ? WHERE id = ?')->execute([json_encode($t), $orderId]);
}

// Meta matches buyers to ad clicks by these details, always sent hashed (SHA-256), never in plain text.
function meta_hash(string $v): string
{
    return $v === '' ? '' : hash('sha256', $v);
}

function meta_phone(string $phone): string
{
    $d = preg_replace('/\D/', '', $phone);
    if (strpos($d, '00') === 0) $d = substr($d, 2);
    if (preg_match('/^01\d{9}$/', $d)) $d = '2' . $d;   // 010… → 2010… (Egypt)
    return strlen($d) >= 8 ? $d : '';
}

// The order as a Meta "Purchase" event (event ID "order-WTS-1001", the same one the browser sends).
function meta_purchase_event(array $o): array
{
    $t = json_decode((string) ($o['track'] ?? ''), true) ?: [];
    $parts = preg_split('/\s+/', mb_strtolower(trim((string) $o['customer']))) ?: [];
    $u = array_filter([
        'em' => [meta_hash(mb_strtolower(trim((string) $o['email'])))],
        'ph' => [meta_hash(meta_phone((string) $o['phone']))],
        'fn' => [meta_hash((string) ($parts[0] ?? ''))],
        'ln' => [meta_hash(count($parts) > 1 ? (string) end($parts) : '')],
        'ct' => [meta_hash(preg_replace('/[^a-z]/', '', mb_strtolower((string) $o['city'])))],
        'country' => [meta_hash('eg')],
        'external_id' => [meta_hash((string) (phone_key((string) $o['phone']) ?: ''))],
        'client_ip_address' => $t['ip'] ?? '',
        'client_user_agent' => $t['ua'] ?? '',
        'fbp' => $t['fbp'] ?? '',
        'fbc' => $t['fbc'] ?? '',
    ], function ($v) { return is_array($v) ? $v[0] !== '' : $v !== ''; });
    $items = json_decode((string) $o['items'], true) ?: [];
    $contents = [];
    foreach ($items as $i) {
        if (($i['id'] ?? '') === '' || $i['id'] === 'custom') continue;
        $contents[] = ['id' => (string) $i['id'], 'quantity' => (int) ($i['qty'] ?? 1), 'item_price' => round((float) ($i['price'] ?? 0), 2)];
    }
    $number = order_number((int) $o['id']);
    return [
        'event_name' => 'Purchase',
        'event_time' => time(),
        'event_id' => 'order-' . $number,
        'action_source' => 'website',
        'event_source_url' => rtrim((string) cfg('site_url'), '/') . '/index.html',
        'user_data' => $u,
        'custom_data' => ['currency' => 'EGP', 'value' => round((float) $o['total'], 2), 'order_id' => $number, 'content_type' => 'product',
            'content_ids' => array_column($contents, 'id'), 'contents' => $contents, 'num_items' => array_sum(array_column($contents, 'quantity'))],
    ];
}

// Tell Meta about a website purchase, once per order, after the answer has gone back to the customer.
// Cash on delivery: when the order is placed. Card / wallet: when Paymob confirms the payment.
function meta_purchase(int $orderId): void
{
    if (!meta_ready()) return;
    $pdo = db();
    // Claim the order first, so a payment confirmed by both the return page and the webhook is sent once.
    $st = $pdo->prepare("UPDATE orders SET capi_at = datetime('now') WHERE id = ? AND capi_at IS NULL AND created_by IS NULL");
    $st->execute([$orderId]);
    if (!$st->rowCount()) return;
    $st = $pdo->prepare('SELECT * FROM orders WHERE id = ?');
    $st->execute([$orderId]);
    $o = $st->fetch();
    if (!$o) return;
    $event = meta_purchase_event($o);
    register_shutdown_function(function () use ($event, $orderId) {
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        elseif (function_exists('litespeed_finish_request')) litespeed_finish_request();
        try { meta_send([$event]); }
        catch (Throwable $e) {
            error_log('[meta] purchase ' . $orderId . ': ' . $e->getMessage());
            log_activity(null, 'Meta purchase event not sent', order_number($orderId) . ' · ' . mb_substr($e->getMessage(), 0, 200));
        }
    });
}

// POST events to the Conversions API. With a test code (Events Manager → Test events) they show up there live.
function meta_send(array $events): array
{
    $body = ['data' => json_encode($events, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), 'access_token' => (string) meta_cfg('capi_token')];
    if ((string) meta_cfg('test_code') !== '') $body['test_event_code'] = (string) meta_cfg('test_code');
    $ch = curl_init(rtrim((string) meta_cfg('graph_url', 'https://graph.facebook.com'), '/') . '/' . trim((string) meta_cfg('graph_version', 'v23.0'), '/') . '/' . meta_cfg('pixel_id') . '/events');
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => http_build_query($body), CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 8]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    if ($raw === false) throw new RuntimeException('Could not reach Meta: ' . $err);
    $r = json_decode((string) $raw, true) ?: [];
    if ($code >= 400 || isset($r['error'])) throw new RuntimeException((string) ($r['error']['error_user_msg'] ?? $r['error']['message'] ?? ('HTTP ' . $code)));
    return $r;
}

// Settings → Ad tracking: what's switched on, and a test event to check the Conversions API.
function meta_status(): array
{
    return ['pixel' => (string) meta_cfg('pixel_id'), 'capi' => meta_ready(), 'testCode' => (string) meta_cfg('test_code') !== '', 'ga4' => (string) cfg('ga4_id'),
        'sent' => (int) db()->query('SELECT COUNT(*) FROM orders WHERE capi_at IS NOT NULL')->fetchColumn()];
}

function meta_test(): array
{
    if (!meta_ready()) throw new ShopError('Add the pixel ID and the Conversions API token to api/config.local.php first.');
    $r = meta_send([['event_name' => 'PageView', 'event_time' => time(), 'event_id' => 'test-' . bin2hex(random_bytes(6)), 'action_source' => 'website',
        'event_source_url' => rtrim((string) cfg('site_url'), '/') . '/', 'user_data' => ['client_ip_address' => client_ip(), 'client_user_agent' => (string) ($_SERVER['HTTP_USER_AGENT'] ?? '')]]]);
    return ['received' => (int) ($r['events_received'] ?? 0)];
}
