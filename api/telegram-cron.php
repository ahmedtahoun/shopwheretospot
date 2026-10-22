<?php
// Every minute from cPanel → Cron Jobs: sends the 15-minute "no reply" reminders (api/telegram.php).
// The exact command, with its key, is in Settings → WhatsApp. Also runs from the command line.

declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

if (PHP_SAPI !== 'cli') {
    $want = tg_ready() ? substr(tg_cron_url(), strrpos(tg_cron_url(), '=') + 1) : '';
    if ($want === '' || !hash_equals($want, (string) ($_GET['key'] ?? ''))) { http_response_code(403); exit('Forbidden'); }
}
wa_set_setting('tg_cron_at', gmdate('Y-m-d H:i:s'));
tg_remind_due();
header('Content-Type: text/plain');
echo "ok\n";
