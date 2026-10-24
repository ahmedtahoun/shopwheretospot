<?php
// Telegram alerts: a ping on the team member's phone when a WhatsApp customer is waiting for them,
// even with the dashboard closed.
//
// Setup: create a bot with @BotFather and put its token in the 'telegram' block of api/config.local.php.
// Each person then taps "Connect Telegram" in the WhatsApp inbox: it opens the bot with a one-time code,
// they press Start, and the bot (api/telegram-webhook.php) links their Telegram chat to their account.
// The bot's webhook is set up automatically the first time someone connects.
//
// When: every new customer message, straight away (not while the person has the dashboard open on
// screen: it beeps there already); a reminder when a customer has had no reply for 15 minutes (always,
// once per wait); and when a manager gives someone a chat. Chats nobody has go to the managers, and
// owners and managers also get the 15-minute reminders for everyone's chats (can be turned off).
//
// The 15-minute reminders are checked by tg_remind_due(): every minute by the cPanel cron job
// (api/telegram-cron.php, shown in Settings → WhatsApp), and also whenever a WhatsApp message arrives
// or someone has the dashboard open.

const TG_REMIND_MINUTES = 15;
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

// Owners and managers who connected Telegram.
function tg_managers(): array
{
    $roles = array_keys(array_filter(ROLES, function ($p) { return in_array('whatsapp_all', $p, true); }));
    $in = implode(',', array_fill(0, count($roles), '?'));
    $st = db()->prepare("SELECT id, name, tg_chat_id, wa_seen_at FROM users WHERE active = 1 AND tg_chat_id IS NOT NULL AND role IN ($in)");
    $st->execute($roles);
    return $st->fetchAll();
}

// Who hears about a chat: the person it's given to, or (nobody has it) the managers.
function tg_chat_recipients(array $chat): array
{
    if ($chat['assigned_to']) {
        $st = db()->prepare('SELECT id, name, tg_chat_id, wa_seen_at FROM users WHERE id = ? AND active = 1 AND tg_chat_id IS NOT NULL');
        $st->execute([(int) $chat['assigned_to']]);
        return $st->fetchAll();
    }
    return tg_managers();
}

// A new customer message: to whoever has the chat, unless the dashboard is on their screen.
function tg_alert_message(array $chat): void
{
    if (!tg_ready()) return;
    foreach (tg_chat_recipients($chat) as $u) {
        if ($u['wa_seen_at'] && strtotime($u['wa_seen_at'] . ' UTC') > time() - TG_SEEN_SECONDS) continue;
        tg_send_user($u, tg_chat_text($chat, $chat['assigned_to'] ? '💬 New WhatsApp message · رسالة واتساب جديدة' : '💬 WhatsApp message, nobody has this chat · رسالة واتساب بدون مسؤول'), tg_open_button($chat));
    }
}

// Customers waiting 15 minutes or more without a reply: one reminder per wait. At most once a minute,
// however many requests call it. Only waits that started in the last day (no flood of old chats).
function tg_remind_due(): void
{
    if (!tg_ready()) return;
    $last = (int) wa_setting('tg_remind_run', 0);
    if ($last > time() - 50) return;
    wa_set_setting('tg_remind_run', time());
    try { tg_daily_due(); } catch (Throwable $e) { error_log('[shop] daily summary: ' . $e->getMessage()); }
    try { tg_monthly_due(); } catch (Throwable $e) { error_log('[shop] monthly report: ' . $e->getMessage()); }
    $st = db()->prepare("SELECT * FROM wa_chats WHERE status = 'open' AND waiting_since IS NOT NULL AND waiting_since <= datetime('now', ?) AND waiting_since > datetime('now', '-1 day')
        AND (tg_reminded_for IS NULL OR tg_reminded_for != waiting_since) ORDER BY waiting_since LIMIT 50");
    $st->execute(['-' . TG_REMIND_MINUTES . ' minutes']);
    $done = db()->prepare('UPDATE wa_chats SET tg_reminded_for = waiting_since WHERE id = ?');
    foreach ($st->fetchAll() as $chat) {
        $done->execute([(int) $chat['id']]);
        $mins = max(TG_REMIND_MINUTES, (int) round((time() - strtotime($chat['waiting_since'] . ' UTC')) / 60));
        $head = '⏰ No reply for ' . $mins . ' min · محدش رد من ' . $mins . ' دقيقة';
        $sentTo = [];
        foreach (tg_chat_recipients($chat) as $u) {
            $sentTo[(int) $u['id']] = true;
            tg_send_user($u, tg_chat_text($chat, $head), tg_open_button($chat));
        }
        // Owners and managers also hear about everyone's unanswered chats, with whose chat it is
        // (Settings → WhatsApp can turn this off).
        if (!wa_setting('tg_remind_managers', true) || !$chat['assigned_to']) continue;
        $who = db()->prepare('SELECT name FROM users WHERE id = ?');
        $who->execute([(int) $chat['assigned_to']]);
        $agent = (string) $who->fetchColumn();
        foreach (tg_managers() as $u) {
            if (isset($sentTo[(int) $u['id']])) continue;
            tg_send_user($u, tg_chat_text($chat, $head . "\n" . '👤 ' . tg_h($agent) . '’s chat · محادثة ' . tg_h($agent)), tg_open_button($chat));
        }
    }
}

// Run the reminder check after the reply has gone out, so nobody waits for Telegram.
function tg_remind_later(): void
{
    register_shutdown_function(function () {
        if (function_exists('litespeed_finish_request')) litespeed_finish_request();
        elseif (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        try { tg_remind_due(); } catch (Throwable $e) { error_log('[shop] telegram reminders: ' . $e->getMessage()); }
    });
}

// The cron job's address (Settings → WhatsApp). The key is made from the bot token.
function tg_cron_url(): string
{
    return rtrim((string) cfg('site_url'), '/') . '/api/telegram-cron.php?key=' . substr(hash_hmac('sha256', 'wts-telegram-cron', tg_token()), 0, 32);
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
    // tg_reminded_for: the waiting_since a 15-minute reminder was already sent for (one per wait).
    if (!in_array('tg_reminded_for', $chatCols, true)) $pdo->exec('ALTER TABLE wa_chats ADD COLUMN tg_reminded_for TEXT');
}

// ---------- daily summary ----------
// Every evening at 9 pm (Cairo time), owners and managers who connected Telegram get the day in one
// message: sales, payments, WhatsApp chats, reply times per person, who is still waiting, unpaid orders.
// Sent by the same check as the reminders (the cron job), once a day. Settings → WhatsApp can turn it off.

const TG_DAILY_HOUR = 21;

function tg_daily_due(): void
{
    if (!wa_setting('tg_daily', true)) return;
    $now = new DateTime('now', new DateTimeZone('Africa/Cairo'));
    if ((int) $now->format('G') < TG_DAILY_HOUR || wa_setting('tg_daily_sent') === $now->format('Y-m-d')) return;
    wa_set_setting('tg_daily_sent', $now->format('Y-m-d'));
    $text = tg_daily_summary();
    foreach (tg_managers() as $u) tg_send_user($u, $text, ['Open dashboard · لوحة التحكم', rtrim((string) cfg('site_url'), '/') . '/admin/']);
}

// Today in Cairo, as UTC times (the database keeps UTC).
function tg_day_range(): array
{
    $tz = new DateTimeZone('Africa/Cairo');
    $start = new DateTime('today', $tz);
    $end = (clone $start)->modify('+1 day');
    $utc = new DateTimeZone('UTC');
    return [$start->setTimezone($utc)->format('Y-m-d H:i:s'), $end->setTimezone($utc)->format('Y-m-d H:i:s'), (new DateTime('today', $tz))];
}

function tg_daily_summary(): string
{
    [$from, $to, $day] = tg_day_range();
    $db = db();
    $one = function (string $sql, array $args = []) use ($db) { $st = $db->prepare($sql); $st->execute($args); return $st->fetch(PDO::FETCH_NUM) ?: []; };
    $all = function (string $sql, array $args = []) use ($db) { $st = $db->prepare($sql); $st->execute($args); return $st->fetchAll(); };
    $egp = function ($n) { return 'EGP ' . number_format((float) $n); };
    $mins = function ($m) { $m = (int) round($m); return $m < 60 ? $m . ' min' : ($m < 1440 ? intdiv($m, 60) . ' h ' . ($m % 60) . ' min' : intdiv($m, 1440) . ' d ' . intdiv($m % 1440, 60) . ' h'); };
    $real = "status NOT IN ('Cancelled', 'Returned', 'Awaiting payment')";

    [$orders, $sales] = $one("SELECT COUNT(*), COALESCE(SUM(total), 0) FROM orders WHERE $real AND created_at >= ? AND created_at < ?", [$from, $to]);
    [$paidIn, $online] = $one("SELECT COALESCE(SUM(amount), 0), COALESCE(SUM(CASE WHEN method = 'paymob' THEN amount ELSE 0 END), 0) FROM payments WHERE created_at >= ? AND created_at < ?", [$from, $to]);
    [$delivered] = $one("SELECT COUNT(*) FROM orders WHERE status = 'Delivered' AND delivered_at >= ? AND delivered_at < ?", [$from, $to]);
    [$cancelled] = $one("SELECT COUNT(*) FROM orders WHERE status = 'Cancelled' AND updated_at >= ? AND updated_at < ? AND created_at < ?", [$from, $to, $to]);
    [$leads] = $one('SELECT COUNT(*) FROM leads WHERE created_at >= ? AND created_at < ?', [$from, $to]);

    [$newChats, $fromAds] = $one("SELECT COUNT(*), SUM(CASE WHEN ad_id != '' OR ad_headline != '' THEN 1 ELSE 0 END) FROM wa_chats WHERE created_at >= ? AND created_at < ?", [$from, $to]);
    [$talked] = $one("SELECT COUNT(DISTINCT chat_id) FROM wa_messages WHERE dir = 'in' AND kind != 'reaction' AND created_at >= ? AND created_at < ?", [$from, $to]);
    [$sent] = $one("SELECT COUNT(*) FROM wa_messages WHERE dir = 'out' AND user_id IS NOT NULL AND created_at >= ? AND created_at < ?", [$from, $to]);
    $waiting = $all("SELECT c.name, c.wa_id, c.waiting_since, u.name AS agent FROM wa_chats c LEFT JOIN users u ON u.id = c.assigned_to
        WHERE c.status = 'open' AND c.waiting_since IS NOT NULL ORDER BY c.waiting_since LIMIT 50");

    // Each person today: first replies to new customers (and how fast), messages sent, orders entered.
    $people = [];
    foreach ($all("SELECT first_reply_by AS id, COUNT(*) AS n, AVG((julianday(first_reply_at) - julianday(first_in_at)) * 1440) AS avg FROM wa_chats
        WHERE first_reply_by IS NOT NULL AND first_reply_at >= ? AND first_reply_at < ? GROUP BY first_reply_by", [$from, $to]) as $r) $people[(int) $r['id']]['reply'] = $r;
    foreach ($all("SELECT user_id AS id, COUNT(*) AS n FROM wa_messages WHERE dir = 'out' AND user_id IS NOT NULL AND created_at >= ? AND created_at < ? GROUP BY user_id", [$from, $to]) as $r) $people[(int) $r['id']]['msgs'] = (int) $r['n'];
    foreach ($all("SELECT rep_id AS id, COUNT(*) AS n, SUM(total) AS t FROM orders WHERE $real AND rep_id IS NOT NULL AND created_at >= ? AND created_at < ? GROUP BY rep_id", [$from, $to]) as $r) $people[(int) $r['id']]['orders'] = $r;
    $names = [];
    if ($people) {
        $ids = array_keys($people);
        $st = $db->prepare('SELECT id, name FROM users WHERE id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')');
        $st->execute($ids);
        foreach ($st->fetchAll() as $u) $names[(int) $u['id']] = $u['name'];
    }

    [$unpaidN, $unpaidSum] = $one("SELECT COUNT(*), COALESCE(SUM(total), 0) FROM orders WHERE status = 'Awaiting payment'");

    $L = [];
    $L[] = '📊 <b>Daily summary · ملخص اليوم</b>';
    $L[] = $day->format('l j F Y');
    $L[] = '';
    $L[] = '🛒 <b>Sales · المبيعات</b>';
    $L[] = $orders ? $orders . ' new order' . ($orders == 1 ? '' : 's') . ' · <b>' . $egp($sales) . '</b>' : 'No new orders today';
    $L[] = 'Money in · المحصّل: ' . $egp($paidIn) . ($online > 0 ? ' (online ' . $egp($online) . ')' : '');
    if ($delivered || $cancelled) $L[] = ($delivered ? $delivered . ' delivered' : '') . ($delivered && $cancelled ? ' · ' : '') . ($cancelled ? $cancelled . ' cancelled' : '');
    if ($leads) $L[] = $leads . ' new lead' . ($leads == 1 ? '' : 's');
    $L[] = '';
    $L[] = '💬 <b>WhatsApp · واتساب</b>';
    $L[] = (int) $newChats . ' new chat' . ($newChats == 1 ? '' : 's') . ($fromAds ? ' (' . (int) $fromAds . ' from ads)' : '') . ' · ' . (int) $talked . ' customer' . ($talked == 1 ? '' : 's') . ' wrote · ' . (int) $sent . ' replies sent';
    foreach ($people as $id => $p) {
        $bits = [];
        if (!empty($p['reply'])) $bits[] = $p['reply']['n'] . ' new · first reply ' . $mins($p['reply']['avg']);
        if (!empty($p['msgs'])) $bits[] = $p['msgs'] . ' msgs';
        if (!empty($p['orders'])) $bits[] = $p['orders']['n'] . ' order' . ($p['orders']['n'] == 1 ? '' : 's') . ' ' . $egp($p['orders']['t']);
        if ($bits) $L[] = '👤 ' . tg_h($names[$id] ?? ('#' . $id)) . ': ' . implode(' · ', $bits);
    }
    if ($waiting) {
        $L[] = '';
        $L[] = '⏰ <b>Still waiting for a reply · مستنيين رد: ' . count($waiting) . '</b>';
        foreach (array_slice($waiting, 0, 5) as $w) {
            $m = (time() - strtotime($w['waiting_since'] . ' UTC')) / 60;
            $L[] = '• ' . tg_h(trim((string) $w['name']) ?: wa_local_phone($w['wa_id'])) . ' · ' . $mins($m) . ' · ' . tg_h($w['agent'] ?: 'nobody');
        }
        if (count($waiting) > 5) $L[] = '… and ' . (count($waiting) - 5) . ' more';
    } else {
        $L[] = '✅ Nobody is waiting for a reply · مفيش حد مستني رد';
    }
    if ($unpaidN) {
        $L[] = '';
        $L[] = '💳 Unpaid online orders · طلبات لم تُدفع: ' . $unpaidN . ' · ' . $egp($unpaidSum);
    }
    return implode("\n", $L);
}

// ---------- monthly report ----------
// On the 1st from 9 am (Cairo), owners and managers get last month in one message, with the change from the
// month before, and a link to the full report (dashboard → Monthly reports). The month is saved then too.

function tg_monthly_due(): void
{
    $now = new DateTime('now', new DateTimeZone('Africa/Cairo'));
    if ((int) $now->format('j') !== 1 || (int) $now->format('G') < 9) return;
    $month = (clone $now)->modify('first day of last month')->format('Y-m');
    if (wa_setting('tg_monthly_sent') === $month) return;
    wa_set_setting('tg_monthly_sent', $month);
    report_close_months();
    $r = month_report($month);
    $p = month_report((new DateTime($month . '-01'))->modify('-1 month')->format('Y-m'));
    $egp = function ($n) { return 'EGP ' . number_format((float) $n); };
    $vs = function ($a, $b) { if (!$b) return ''; $pc = (int) round(($a - $b) / abs($b) * 100); return $pc > 0 ? ' (▲' . $pc . '%)' : ($pc < 0 ? ' (▼' . abs($pc) . '%)' : ' (=)'); };
    $name = (new DateTime($month . '-01'))->format('F Y');
    $L = ['📅 <b>' . $name . ' report · تقرير الشهر</b>', '',
        '🛒 Sales · المبيعات: <b>' . $egp($r['sales']['value']) . '</b>' . $vs($r['sales']['value'], $p['sales']['value']) . ' · ' . $r['sales']['orders'] . ' orders, avg ' . $egp($r['sales']['avg']),
        '📦 Delivered · تم التوصيل: ' . $egp($r['delivered']['value']) . ' (' . $r['delivered']['orders'] . ')',
        '💵 Collected · المحصّل: ' . $egp($r['collected']['value']) . $vs($r['collected']['value'], $p['collected']['value']),
        '🧾 Expenses · المصروفات: ' . $egp($r['expenses']['value']) . $vs($r['expenses']['value'], $p['expenses']['value']),
        '👥 Salaries + commissions: ' . $egp($r['team']['pay']),
        '📈 Gross profit: ' . $egp($r['profit']['gross']) . ' · <b>Net profit · صافي الربح: ' . $egp($r['profit']['net']) . '</b>' . $vs($r['profit']['net'], $p['profit']['net']),
        ''];
    if ($r['byCategory']) $L[] = '🏷 Top category: ' . tg_h($r['byCategory'][0]['label']) . ' · ' . $egp($r['byCategory'][0]['value']);
    if ($r['topProducts']) $L[] = '⭐ Top product: ' . tg_h($r['topProducts'][0]['name']) . ' · ' . $r['topProducts'][0]['qty'] . ' pcs';
    $L[] = '🙋 Customers: ' . $r['customers']['total'] . ' (' . $r['customers']['new'] . ' new) · leads ' . $r['leads']['new'] . ' · WhatsApp chats ' . $r['chats']['new'];
    if ($r['lost']['orders']) $L[] = '↩️ Cancelled / returned: ' . $r['lost']['orders'] . ' · ' . $egp($r['lost']['value']);
    $text = implode("\n", $L);
    foreach (tg_managers() as $u) tg_send_user($u, $text, ['Open the full report · التقرير كامل', rtrim((string) cfg('site_url'), '/') . '/admin/#reports']);
}
