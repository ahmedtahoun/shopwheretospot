<?php
// Where Paymob sends the customer after paying. The details arrive as query parameters signed
// with the HMAC secret; a verified success is recorded (the webhook may arrive later or earlier,
// both are deduplicated), then the customer lands back on the shop with the result.

require __DIR__ . '/bootstrap.php';

$q = $_GET;
$site = rtrim(cfg('site_url'), '/');
$valid = paymob_hmac_valid($q, (string) ($q['hmac'] ?? ''), true);
$orderId = paymob_order_id((string) ($q['merchant_order_id'] ?? ''));
$success = ($q['success'] ?? '') === 'true' && ($q['pending'] ?? '') !== 'true';

if ($valid && $success && $orderId) {
    try {
        $label = 'Paid online · ' . trim(($q['source_data_sub_type'] ?? ($q['source_data.sub_type'] ?? '')) . ' ' . (($pan = $q['source_data_pan'] ?? ($q['source_data.pan'] ?? '')) ? '•••• ' . $pan : ''));
        paymob_record($orderId, (string) ($q['id'] ?? ''), (int) ($q['amount_cents'] ?? 0), $label, (string) ($q['merchant_order_id'] ?? ''));
    } catch (Throwable $e) {
        error_log('[paymob] return error: ' . $e->getMessage());
    }
}

$number = $orderId ? order_number($orderId) : '';
if (!$valid) $target = $site . '/index.html?pay=check' . ($number ? '&order=' . rawurlencode($number) : '');
elseif ($success) $target = $site . '/index.html?pay=ok&order=' . rawurlencode($number);
else $target = $site . '/index.html?pay=failed&order=' . rawurlencode($number) . '&reason=' . rawurlencode(mb_substr((string) ($q['data_message'] ?? ($q['data.message'] ?? '')), 0, 80));
header('Location: ' . $target, true, 302);
