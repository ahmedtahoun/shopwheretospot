<?php
// Telegram alerts: a ping on the team member's phone when a WhatsApp customer is waiting for them,
// even with the dashboard closed.
//
// Setup: create a bot with @BotFather and put its token in the 'telegram' block of api/config.local.php.
// Each person then taps "Connect Telegram" in the WhatsApp inbox: it opens the bot with a one-time code,
// they press Start, and the bot (api/telegram-webhook.php) links their Telegram chat to their account.
// The bot's webhook is set up automatically the first time someone connects.
//
// When: a chat starts waiting for an answer (new chat, or the customer writes after the team replied),
// again if they keep writing and nobody answered for 30 minutes, and when a manager gives someone a chat.
// Not while the person has the dashboard open on screen (it beeps there already).

const TG_REMIND_MINUTES = 30;
const TG_SEEN_SECONDS = 60;

function tg_token(): string
{
    $c = (array) (cfg('telegram') ?: []);
    return trim((string) ($c['bot_token'] ?? ''));
}

function tg_ready(): bool
{
    return tg_token() !== '';
}

// Telegram sends this with every update, so only Telegram can reach the webhook. Made from the bot token.
function tg_secret(): string
{
    return substr(hash_hmac('sha256', 'wts-telegram-webhook', tg_token()), 0, 48);
}

function tg_api(string $method, array $params = []): array
{
    if (!tg_ready()) throw new ShopError('Telegram isn’t set up yet (no bot token in api/config.local.php).');
    $ch = curl_init('https://api.telegram.org/bot' . tg_token() . '/' . $method);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'], CURLOPT_POSTFIELDS => json_encode($params, JSON_UNESCAPED_UNICODE)]);
    $raw = curl_exec($ch);
    if ($raw === false) throw new ShopError('Could not reach Telegram: ' . curl_error($ch));
    $json = json_decode((string) $raw, true);
    if (!is_array($json)) throw new ShopError('Unexpected reply from Telegram.');
    if (empty($json['ok'])) {
        $e = new ShopError('Telegram: ' . ($json['description'] ?? 'request failed'));
        $GLOBALS['tg_last_code'] = (int) ($json['error_code'] ?? 0);
        throw $e;
    }
    return (array) $json['result'];
}

// The bot's @username (for the t.me link), and its webhook pointed at us. Both remembered per bot token,
// so a new token in config.local.php sets itself up again.
function tg_setup(): string
{
    $key = substr(hash('sha256', tg_token()), 0, 16);
    $saved = wa_setting('tg_bot');
    if (is_array($saved) && ($saved['key'] ?? '') === $key && !empty($saved['username'])) return (string) $saved['username'];
    $me = tg_api('getMe');
    tg_api('setWebhook', ['url' => rtrim((string) cfg('site_url'), '/') . '/api/telegram-webhook.php', 'secret_token' => tg_secret(),
        'allowed_updates' => ['message'], 'drop_pending_updates' => true]);
    wa_set_setting('tg_bot', ['key' => $key, 'username' => (string) ($me['username'] ?? '')]);
    return (string) ($me['username'] ?? '');
}

// A one-time link that opens the bot and, on Start, connects it to this person (valid 30 minutes).
function tg_link_url(int $userId): string
{
    $username = tg_setup();
    $code = bin2hex(random_bytes(12));
    wa_set_setting('tg_code.' . $code, ['user' => $userId, 'until' => time() + 1800]);
    return 'https://t.me/' . $username . '?start=' . $code;
}

function tg_send(string $chatId, string $html, ?array $button = null): void
{
    $p = ['chat_id' => $chatId, 'text' => $html, 'parse_mode' => 'HTML', 'disable_web_page_preview' => true];
    if ($button) $p['reply_markup'] = ['inline_keyboard' => [[['text' => $button[0], 'url' => $button[1]]]]];
    tg_api('sendMessage', $p);
}

// Send to a team member; if they blocked the bot, forget their Telegram so we stop trying.
function tg_send_user(array $user, string $html, ?array $button = null): bool
{
    if (empty($user['tg_chat_id'])) return false;
    try { tg_send((string) $user['tg_chat_id'], $html, $button); return true; }
    catch (Throwable $e) {
        if (in_array($GLOBALS['tg_last_code'] ?? 0, [400, 403], true)) db()->prepare("UPDATE users SET tg_chat_id = NULL, tg_name = '' WHERE id = ?")->execute([(int) $user['id']]);
        error_log('[shop] telegram alert: ' . $e->getMessage());
        return false;
    }
}

function tg_h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

// Who hears about a chat: the person it's given to, or (nobody has it) the managers.
function tg_chat_recipients(array $chat): array
{
    if ($chat['assigned_to']) {
        $st = db()->prepare('SELECT id, name, tg_chat_id, wa_seen_at FROM users WHERE id = ? AND active = 1 AND tg_chat_id IS NOT NULL');
        $st->execute([(int) $chat['assigned_to']]);
        return $st->fetchAll();
    }
    $roles = array_keys(array_filter(ROLES, function ($p) { return in_array('whatsapp_all', $p, true); }));
    $in = implode(',', array_fill(0, count($roles), '?'));
    $st = db()->prepare("SELECT id, name, tg_chat_id, wa_seen_at FROM users WHERE active = 1 AND tg_chat_id IS NOT NULL AND role IN ($in)");
    $st->execute($roles);
    return $st->fetchAll();
}

// $wasWaiting: the chat was already waiting for an answer before this message.
function tg_alert_message(array $chat, bool $wasWaiting): void
{
    if (!tg_ready()) return;
    if ($wasWaiting && $chat['tg_alerted_at'] && strtotime($chat['tg_alerted_at'] . ' UTC') > time() - TG_REMIND_MINUTES * 60) return;
    $sent = false;
    foreach (tg_chat_recipients($chat) as $u) {
        // Dashboard open on their screen: it beeps there, no need to ping the phone too.
        if ($u['wa_seen_at'] && strtotime($u['wa_seen_at'] . ' UTC') > time() - TG_SEEN_SECONDS) continue;
        $head = $wasWaiting ? '⏰ Still waiting for an answer · لسه مستني رد' : ($chat['assigned_to'] ? '💬 New WhatsApp message · رسالة واتساب جديدة' : '💬 New WhatsApp chat, nobody has it · محادثة جديدة بدون مسؤول');
        $sent = tg_send_user($u, tg_chat_text($chat, $head), tg_open_button($chat)) || $sent;
    }
    if ($sent || !$wasWaiting) db()->prepare("UPDATE wa_chats SET tg_alerted_at = datetime('now') WHERE id = ?")->execute([(int) $chat['id']]);
}

// A manager gave this chat to someone.
function tg_alert_assigned(array $chat, int $toUserId, string $byName): void
{
    if (!tg_ready()) return;
    $st = db()->prepare('SELECT id, name, tg_chat_id, wa_seen_at FROM users WHERE id = ? AND active = 1 AND tg_chat_id IS NOT NULL');
    $st->execute([$toUserId]);
    $u = $st->fetch();
    if (!$u || ($u['wa_seen_at'] && strtotime($u['wa_seen_at'] . ' UTC') > time() - TG_SEEN_SECONDS)) return;
    tg_send_user($u, tg_chat_text($chat, '👤 ' . tg_h($byName) . ' gave you a WhatsApp chat · أسند لك محادثة واتساب'), tg_open_button($chat));
}

function tg_chat_text(array $chat, string $head): string
{
    $phone = wa_local_phone($chat['wa_id']);
    $name = trim((string) $chat['name']);
    $text = trim((string) $chat['last_text']);
    return '<b>' . $head . '</b>' . "\n" . ($name !== '' && $name !== $phone ? tg_h($name) . ' · ' : '') . tg_h($phone)
        . ($chat['ad_headline'] ? "\n📣 " . tg_h(mb_substr((string) $chat['ad_headline'], 0, 80)) : '')
        . ($text !== '' && ($chat['last_dir'] ?? 'in') === 'in' ? "\n\n" . tg_h(mb_substr($text, 0, 300)) : '');
}

function tg_open_button(array $chat): array
{
    return ['Open chat · افتح المحادثة', rtrim((string) cfg('site_url'), '/') . '/admin/#inbox/' . (int) $chat['id']];
}

// What the bot receives: /start <code> connects, /stop disconnects.
function tg_handle_update(array $u): void
{
    $m = $u['message'] ?? null;
    if (!is_array($m) || ($m['chat']['type'] ?? '') !== 'private') return;
    $chatId = (string) ($m['chat']['id'] ?? '');
    $text = trim((string) ($m['text'] ?? ''));
    $tgName = trim(($m['from']['first_name'] ?? '') . ' ' . ($m['from']['last_name'] ?? '')) ?: (string) ($m['from']['username'] ?? '');
    if (preg_match('/^\/start\s+([a-f0-9]{24})$/', $text, $mm)) {
        $c = wa_setting('tg_code.' . $mm[1]);
        db()->prepare('DELETE FROM kv WHERE key = ?')->execute(['wa.tg_code.' . $mm[1]]);
        if (!is_array($c) || ($c['until'] ?? 0) < time()) {
            tg_send($chatId, 'This link has expired. Tap “Connect Telegram” in the dashboard again.' . "\n" . 'انتهت صلاحية الرابط. اضغط “ربط تيليجرام” في لوحة التحكم مرة أخرى.');
            return;
        }
        // One Telegram account per person: connecting here disconnects it from anyone else.
        db()->prepare("UPDATE users SET tg_chat_id = NULL, tg_name = '' WHERE tg_chat_id = ?")->execute([$chatId]);
        db()->prepare('UPDATE users SET tg_chat_id = ?, tg_name = ? WHERE id = ?')->execute([$chatId, mb_substr($tgName, 0, 80), (int) $c['user']]);
        $st = db()->prepare('SELECT * FROM users WHERE id = ?');
        $st->execute([(int) $c['user']]);
        $user = $st->fetch();
        log_activity($user ?: null, 'Connected Telegram alerts', $tgName);
        tg_send($chatId, '✅ <b>Connected, ' . tg_h((string) ($user['name'] ?? '')) . '.</b>' . "\n" . 'You’ll get a message here when a WhatsApp customer is waiting for you. Send /stop to turn it off.'
            . "\n\n" . '✅ <b>تم الربط.</b>' . "\n" . 'هيوصلك هنا تنبيه لما عميل واتساب يكون مستني ردك. ابعت /stop للإيقاف.');
        return;
    }
    $st = db()->prepare('SELECT id, name FROM users WHERE tg_chat_id = ?');
    $st->execute([$chatId]);
    $user = $st->fetch();
    if ($text === '/stop') {
        if ($user) {
            db()->prepare("UPDATE users SET tg_chat_id = NULL, tg_name = '' WHERE id = ?")->execute([(int) $user['id']]);
            log_activity(null, 'Turned off Telegram alerts', (string) $user['name']);
        }
        tg_send($chatId, 'Alerts are off. Connect again from the WhatsApp inbox in the dashboard.' . "\n" . 'تم إيقاف التنبيهات. تقدر تربط تاني من صندوق واتساب في لوحة التحكم.');
        return;
    }
    tg_send($chatId, $user
        ? 'You’re connected, ' . tg_h((string) $user['name']) . '. Alerts come here; reply to customers from the dashboard. /stop turns alerts off.' . "\n" . 'أنت مربوط. التنبيهات بتوصل هنا، والرد على العملاء من لوحة التحكم. /stop للإيقاف.'
        : 'To get alerts, open the WhatsApp inbox in the Where To Spot dashboard and tap “Connect Telegram”.' . "\n" . 'لاستقبال التنبيهات افتح صندوق واتساب في لوحة التحكم واضغط “ربط تيليجرام”.');
}

function telegram_migrate(PDO $pdo): void
{
    $userCols = $pdo->query('PRAGMA table_info(users)')->fetchAll(PDO::FETCH_COLUMN, 1);
    // tg_chat_id: their private chat with the bot; wa_seen_at: last time the dashboard was on their screen.
    foreach (['tg_chat_id' => 'TEXT', 'tg_name' => "TEXT DEFAULT ''", 'wa_seen_at' => 'TEXT'] as $col => $type) {
        if (!in_array($col, $userCols, true)) $pdo->exec("ALTER TABLE users ADD COLUMN $col $type");
    }
    $chatCols = $pdo->query('PRAGMA table_info(wa_chats)')->fetchAll(PDO::FETCH_COLUMN, 1);
    if (!in_array('tg_alerted_at', $chatCols, true)) $pdo->exec('ALTER TABLE wa_chats ADD COLUMN tg_alerted_at TEXT');
}
