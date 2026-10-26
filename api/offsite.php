<?php
// Off-site backups: once a week the latest database backup (plus product photos and customers' order files
// while they fit) goes to the owners on Telegram, in a zip locked with AES-256 and the password from
// api/config.local.php ('backup_password'). If the hosting server is ever lost, that file restores the shop.
// Runs on its own: after the daily backup and from the Telegram cron; Dashboard → Backups can send one now.

declare(strict_types=1);

const OFFSITE_EVERY_DAYS = 7;
const OFFSITE_MAX_BYTES = 45 * 1024 * 1024; // Telegram bots can send files up to 50 MB

function offsite_password(): string
{
    return (string) cfg('backup_password');
}

// Owners who connected Telegram (only owners: the file holds every customer's details).
function offsite_owners(): array
{
    return db()->query("SELECT id, name, tg_chat_id FROM users WHERE active = 1 AND role = 'owner' AND tg_chat_id IS NOT NULL")->fetchAll();
}

function offsite_status(): array
{
    return ['password' => strlen(offsite_password()) >= 10, 'telegram' => tg_ready(), 'owners' => array_column(offsite_owners(), 'name'),
        'zipLock' => class_exists('ZipArchive') && method_exists('ZipArchive', 'setEncryptionName'),
        'last' => wa_setting('backup_offsite_at'), 'lastTo' => wa_setting('backup_offsite_to', []), 'lastSize' => (int) wa_setting('backup_offsite_size', 0),
        'lastNote' => (string) wa_setting('backup_offsite_note', ''), 'error' => (string) wa_setting('backup_offsite_error', ''), 'everyDays' => OFFSITE_EVERY_DAYS];
}

// The locked zip: today's database backup, then product photos and order files (customers' logos) while under the size limit.
function offsite_zip(): array
{
    if (!class_exists('ZipArchive') || !method_exists('ZipArchive', 'setEncryptionName')) throw new ShopError('This server’s PHP can’t make password-protected zip files (ZipArchive with encryption). Ask the hosting to enable the PHP zip extension.');
    $db = backup_dir() . '/shop-' . date('Y-m-d') . '.sqlite';
    if (!is_file($db)) $db = backup_dir() . '/' . make_backup();
    $dir = cfg('data_dir') . '/tmp';
    if (!is_dir($dir)) mkdir($dir, 0750, true);
    $zipPath = $dir . '/wheretospot-backup-' . date('Y-m-d') . '-' . bin2hex(random_bytes(4)) . '.zip';
    $zip = new ZipArchive();
    if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) throw new ShopError('Could not create the backup zip.');
    $zip->setPassword(offsite_password());
    $add = function (string $path, string $name) use ($zip) {
        $zip->addFile($path, $name);
        $zip->setEncryptionName($name, ZipArchive::EM_AES_256);
    };
    $add($db, 'shop.sqlite');
    $used = filesize($db);
    $skipped = 0;
    foreach (['uploads/products' => cfg('upload_dir'), 'uploads/orders' => cfg('order_upload_dir')] as $prefix => $folder) {
        foreach (glob(rtrim((string) $folder, '/') . '/*') ?: [] as $f) {
            if (!is_file($f) || basename($f)[0] === '.') continue;
            $size = filesize($f);
            if ($used + $size > OFFSITE_MAX_BYTES) { $skipped++; continue; }
            $add($f, $prefix . '/' . basename($f));
            $used += $size;
        }
    }
    $zip->setArchiveComment('Where To Spot backup ' . date('Y-m-d') . '. Restore: Dashboard → Backups → How to restore.');
    if (!$zip->close()) { @unlink($zipPath); throw new ShopError('Could not finish the backup zip.'); }
    return ['path' => $zipPath, 'skipped' => $skipped];
}

// Telegram's sendDocument: a file upload, so not the JSON request tg_api() makes.
function tg_send_document(string $chatId, string $path, string $caption): void
{
    $ch = curl_init('https://api.telegram.org/bot' . tg_token() . '/sendDocument');
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 120, CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_POSTFIELDS => ['chat_id' => $chatId, 'caption' => $caption, 'parse_mode' => 'HTML', 'document' => new CURLFile($path, 'application/zip', basename($path))]]);
    $raw = curl_exec($ch);
    if ($raw === false) throw new ShopError('Could not reach Telegram: ' . curl_error($ch));
    $json = json_decode((string) $raw, true);
    if (empty($json['ok'])) throw new ShopError('Telegram: ' . ($json['description'] ?? 'the file was not accepted'));
}

// Send the backup to every owner on Telegram now. Remembers when, to whom, and any problem (shown in Dashboard → Backups).
function offsite_send(): array
{
    if (!tg_ready()) throw new ShopError('Telegram isn’t set up yet — connect it in Settings → WhatsApp, then connect your account (Team).');
    if (strlen(offsite_password()) < 10) throw new ShopError('Add a backup password (at least 10 characters) to api/config.local.php: \'backup_password\' => \'…\'. Keep it somewhere safe — you need it to open the backups.');
    $owners = offsite_owners();
    if (!$owners) throw new ShopError('No owner has connected Telegram yet. In the WhatsApp inbox press ✈️ Telegram and follow the link.');
    $z = offsite_zip();
    $size = filesize($z['path']);
    $caption = '🔒 <b>Where To Spot backup</b> · ' . date('j M Y') . "\n" . 'The whole shop: orders, customers, products, team' . ($z['skipped'] ? ' (' . $z['skipped'] . ' photo/file' . ($z['skipped'] === 1 ? '' : 's') . ' too big to include)' : ', with product photos and order files') .
        ".\nOpen it with the backup password. Keep this message — it’s your copy off the server.";
    $sent = []; $errors = [];
    try {
        foreach ($owners as $o) {
            try { tg_send_document((string) $o['tg_chat_id'], $z['path'], $caption); $sent[] = $o['name']; }
            catch (Throwable $e) { $errors[] = $o['name'] . ': ' . $e->getMessage(); }
        }
    } finally { @unlink($z['path']); }
    if (!$sent) { wa_set_setting('backup_offsite_error', implode(' · ', $errors)); throw new ShopError('The backup could not be sent. ' . implode(' · ', $errors)); }
    wa_set_setting('backup_offsite_at', gmdate('Y-m-d H:i:s'));
    wa_set_setting('backup_offsite_to', $sent);
    wa_set_setting('backup_offsite_size', $size);
    wa_set_setting('backup_offsite_note', $z['skipped'] ? $z['skipped'] . ' large file(s) left out' : '');
    wa_set_setting('backup_offsite_error', implode(' · ', $errors));
    log_activity(null, 'Backup sent off the server', 'Telegram → ' . implode(', ', $sent) . ' · ' . round($size / 1048576, 1) . ' MB');
    return ['to' => $sent, 'size' => $size, 'errors' => $errors];
}

// Weekly: when it's been 7 days (or never). Quietly does nothing until Telegram and the password are set up.
function offsite_due(): void
{
    if (!tg_ready() || strlen(offsite_password()) < 10) return;
    $last = (string) wa_setting('backup_offsite_at', '');
    if ($last !== '' && strtotime($last . ' UTC') > time() - OFFSITE_EVERY_DAYS * 86400) return;
    // At most one try a day, so a problem (no owner on Telegram, file refused) doesn't retry every minute.
    $today = date('Y-m-d');
    if (wa_setting('backup_offsite_try') === $today) return;
    wa_set_setting('backup_offsite_try', $today);
    try { offsite_send(); }
    catch (Throwable $e) {
        wa_set_setting('backup_offsite_error', $e->getMessage());
        ops_error('Backups', 'The weekly backup could not be sent off the server', $e);
        log_activity(null, 'Backup not sent off the server', mb_substr($e->getMessage(), 0, 250));
    }
}
