<?php
// Meta webhook for WhatsApp, and for Instagram Direct and Messenger (api/social.php). In Meta for Developers → your app:
//   WhatsApp → Configuration, and Webhooks → Page and → Instagram (same address and verify token for all three):
//   Callback URL:  https://shop.wheretospot.com/api/whatsapp-webhook.php
//   Verify token:  the 'verify_token' from the 'whatsapp' block in api/config.local.php
//   Subscribe to:  messages (Page also: messaging_postbacks, message_deliveries, message_reads, message_echoes, messaging_referrals, message_reactions)
// GET = Meta checking the address once; POST = new messages and delivery/read updates, signed with the app secret.

declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $given = (string) ($_GET['hub_verify_token'] ?? '');
    $ok = false;
    foreach ([(string) wa_cfg('verify_token', ''), (string) sm_cfg('verify_token', '')] as $token) if ($token !== '' && hash_equals($token, $given)) $ok = true;
    if (($_GET['hub_mode'] ?? '') === 'subscribe' && $ok) {
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
$sig = (string) ($_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '');
$signed = false;
foreach (array_unique([(string) wa_cfg('app_secret', ''), sm_app_secret()]) as $secret) {
    if ($secret !== '' && hash_equals('sha256=' . hash_hmac('sha256', $raw, $secret), $sig)) $signed = true;
}
if (!$signed) {
    // Shown in Settings → WhatsApp: Meta is sending, but the app secret in config.local.php doesn't match.
    if ($sig !== '') { try { wa_set_setting('last_rejected', gmdate('Y-m-d H:i:s')); } catch (Throwable $e) {} }
    http_response_code(401);
    exit('Bad signature');
}
$payload = json_decode($raw, true);
if (!is_array($payload)) { http_response_code(400); exit; }

try {
    // Instagram ('instagram') and Messenger ('page') come here too.
    if (in_array($payload['object'] ?? '', ['page', 'instagram'], true)) sm_handle_webhook($payload);
    else wa_handle_webhook($payload);
    wa_cleanup();
    tg_remind_later(); // 15-minute reminders (api/telegram.php)
} catch (Throwable $e) {
    ops_error('WhatsApp', 'A message from WhatsApp could not be processed', $e);
}
// Always 200 once the signature is right, so Meta doesn't keep resending the same update.
http_response_code(200);
header('Content-Type: application/json');
echo '{"ok":true}';
