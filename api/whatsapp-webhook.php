<?php
// Meta WhatsApp webhook. Set it up in Meta for Developers → your app → WhatsApp → Configuration:
//   Callback URL:  https://shop.wheretospot.com/api/whatsapp-webhook.php
//   Verify token:  the 'verify_token' from the 'whatsapp' block in api/config.local.php
//   Subscribe to:  messages
// GET = Meta checking the address once; POST = new messages and delivery/read updates, signed with the app secret.

declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $token = (string) wa_cfg('verify_token', '');
    if (($_GET['hub_mode'] ?? '') === 'subscribe' && $token !== '' && hash_equals($token, (string) ($_GET['hub_verify_token'] ?? ''))) {
        header('Content-Type: text/plain');
        echo (string) ($_GET['hub_challenge'] ?? '');
        exit;
    }
    http_response_code(403);
    exit('Forbidden');
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); exit; }

$raw = (string) file_get_contents('php://input');
// Only Meta knows the app secret: anything not signed with it is ignored.
$secret = (string) wa_cfg('app_secret', '');
$sig = (string) ($_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '');
if ($secret === '' || !hash_equals('sha256=' . hash_hmac('sha256', $raw, $secret), $sig)) {
    // Shown in Settings → WhatsApp: Meta is sending, but the app secret in config.local.php doesn't match.
    if ($sig !== '') { try { wa_set_setting('last_rejected', gmdate('Y-m-d H:i:s')); } catch (Throwable $e) {} }
    http_response_code(401);
    exit('Bad signature');
}
$payload = json_decode($raw, true);
if (!is_array($payload)) { http_response_code(400); exit; }

try {
    wa_handle_webhook($payload);
    wa_cleanup();
    tg_remind_later(); // 15-minute reminders (api/telegram.php)
} catch (Throwable $e) {
    ops_error('WhatsApp', 'A message from WhatsApp could not be processed', $e);
}
// Always 200 once the signature is right, so Meta doesn't keep resending the same update.
http_response_code(200);
header('Content-Type: application/json');
echo '{"ok":true}';
