<?php
// Paymob "transaction processed" callback (server to server). Set this as the notification URL
// automatically on every payment; it can also be added in Paymob → Developers → Payment Integrations.
// Always answers 200 for well-formed calls so Paymob doesn't keep retrying.

require __DIR__ . '/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); exit; }
$payload = json_decode((string) file_get_contents('php://input'), true);
$t = is_array($payload) ? ($payload['obj'] ?? null) : null;
if (!is_array($t) || ($payload['type'] ?? '') !== 'TRANSACTION') { http_response_code(200); echo 'ignored'; exit; }

if (!paymob_hmac_valid($t, (string) ($_GET['hmac'] ?? ''), false)) {
    error_log('[paymob] webhook with a bad HMAC for transaction ' . ($t['id'] ?? '?'));
    http_response_code(401);
    echo 'bad hmac';
    exit;
}

$orderId = paymob_order_id((string) ($t['order']['merchant_order_id'] ?? ''));
if (!$orderId && isset($t['payment_key_claims']['extra']['order_id'])) $orderId = (int) $t['payment_key_claims']['extra']['order_id'];
$ok = !empty($t['success']) && empty($t['pending']) && empty($t['is_voided']) && empty($t['is_refunded']) && empty($t['is_void']) && empty($t['is_refund']);

try {
    if ($ok && $orderId) {
        $src = $t['source_data'] ?? [];
        $label = 'Paid online · ' . trim(($src['sub_type'] ?? '') . ' ' . (!empty($src['pan']) ? '•••• ' . $src['pan'] : ''));
        paymob_record($orderId, (string) $t['id'], (int) $t['amount_cents'], $label, (string) ($t['order']['merchant_order_id'] ?? ''));
    } elseif ($orderId && empty($t['pending'])) {
        log_activity(null, 'Online payment failed', order_number($orderId) . ' · ' . mb_substr((string) ($t['data']['message'] ?? 'declined'), 0, 80));
    }
} catch (Throwable $e) {
    error_log('[paymob] webhook error: ' . $e->getMessage());
    http_response_code(500);
    exit;
}
http_response_code(200);
echo 'ok';
