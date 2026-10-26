<?php
// Telegram bot webhook (set up automatically by api/telegram.php the first time someone connects).
// Telegram signs every update with the secret we gave it; anything else is ignored.

declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !tg_ready()) { http_response_code(404); exit; }
if (!hash_equals(tg_secret(), (string) ($_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ?? ''))) { http_response_code(401); exit('Bad secret'); }

$update = json_decode((string) file_get_contents('php://input'), true);
try {
    if (is_array($update)) tg_handle_update($update);
} catch (Throwable $e) {
    ops_error('Telegram', 'A message to the Telegram bot could not be processed', $e);
}
// Always 200, so Telegram doesn't keep resending the same update.
header('Content-Type: application/json');
echo '{"ok":true}';
