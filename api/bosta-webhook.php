<?php
// Bosta calls this URL whenever a shipment changes state. It is set on each shipment we create,
// together with a secret Authorization header, so nobody else can change order statuses through it.

require __DIR__ . '/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Not found', 404);

$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
if (!hash_equals('Bearer ' . bosta_webhook_secret(), $auth)) fail('Unauthorized', 401);

$b = json_decode((string) file_get_contents('php://input'), true) ?: [];
$tracking = (string) ($b['trackingNumber'] ?? '');
$code = (int) ($b['state'] ?? 0);
if ($tracking === '' || !$code) fail('Missing trackingNumber or state');

try {
    $st = db()->prepare('SELECT id FROM orders WHERE tracking_number = ?');
    $st->execute([$tracking]);
    $id = $st->fetchColumn();
    if (!$id) json_out(['ok' => true, 'ignored' => 'unknown tracking number']); // not ours; reply 200 so Bosta doesn't retry
    $note = (string) ($b['exceptionReason'] ?? '');
    if (!empty($b['numberOfAttempts'])) $note = trim($note . ' (attempt ' . (int) $b['numberOfAttempts'] . ')');
    bosta_apply_state((int) $id, $code, $note);
    log_activity(['id' => null, 'name' => 'Bosta'], 'Shipment ' . bosta_state_label($code), order_number((int) $id) . ' · ' . $tracking . ($note ? ' · ' . $note : ''));
    json_out(['ok' => true]);
} catch (Throwable $e) {
    error_log('[bosta webhook] ' . $e->getMessage());
    fail('Error', 500);
}
