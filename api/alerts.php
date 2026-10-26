<?php
// Problem alerts: when something breaks behind the scenes (a payment that can't be matched or started, Bosta,
// WhatsApp, emails, backups, ad tracking, or an unexpected server error), the owners hear about it on Telegram
// (by email if no owner has connected Telegram) instead of finding out from a customer.
// The same problem alerts at most once an hour; the next alert says how many times it happened meanwhile.
// Every problem is listed in Dashboard → Settings → Problems.

declare(strict_types=1);

const OPS_ALERT_EVERY = 3600; // seconds between alerts for the same problem

function alerts_migrate(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS ops_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        area TEXT NOT NULL,
        message TEXT NOT NULL,
        fp TEXT NOT NULL UNIQUE,
        count INTEGER NOT NULL DEFAULT 1,
        pending INTEGER NOT NULL DEFAULT 0,
        first_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_at TEXT NOT NULL DEFAULT (datetime('now')),
        alerted_at TEXT,
        seen INTEGER NOT NULL DEFAULT 0
    )");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_ops_errors_last ON ops_errors(last_at)');
}

// Record a problem and alert the owners (never throws: an alert must not break what was being done).
// $area: a short name the owner recognises (Paymob, Bosta, WhatsApp, Email, Backups, Ad tracking, Server…).
function ops_error(string $area, string $message, ?Throwable $e = null): void
{
    $message = trim(mb_substr($message . ($e ? ': ' . $e->getMessage() : ''), 0, 600));
    error_log('[' . $area . '] ' . $message);
    try {
        // The same problem with a different order number or time is still the same problem.
        $fp = sha1($area . '|' . preg_replace('/\d+/', '#', mb_strtolower($message)));
        $pdo = db();
        $pdo->prepare("INSERT INTO ops_errors (area, message, fp) VALUES (?, ?, ?)
            ON CONFLICT(fp) DO UPDATE SET count = count + 1, pending = pending + 1, message = excluded.message, last_at = datetime('now'), seen = 0")->execute([$area, $message, $fp]);
        $st = $pdo->prepare('SELECT * FROM ops_errors WHERE fp = ?');
        $st->execute([$fp]);
        $row = $st->fetch();
        if (!$row || ($row['alerted_at'] && strtotime($row['alerted_at'] . ' UTC') > time() - OPS_ALERT_EVERY)) return;
        $pdo->prepare("UPDATE ops_errors SET alerted_at = datetime('now'), pending = 0 WHERE id = ?")->execute([$row['id']]);
        $times = (int) $row['pending'] + 1;
        register_shutdown_function(function () use ($area, $message, $times) {
            try { ops_notify($area, $message, $times); } catch (Throwable $x) { error_log('[alerts] ' . $x->getMessage()); }
        });
    } catch (Throwable $x) {
        error_log('[alerts] could not record: ' . $x->getMessage());
    }
}

function ops_notify(string $area, string $message, int $times): void
{
    $when = (new DateTime('now', new DateTimeZone('Africa/Cairo')))->format('j M, H:i');
    $more = $times > 1 ? ' · ' . $times . '× in the last hour' : '';
    $owners = db()->query("SELECT id, name, email, tg_chat_id FROM users WHERE active = 1 AND role = 'owner'")->fetchAll();
    $url = rtrim((string) cfg('site_url'), '/') . '/admin/#settings';
    $sent = false;
    if (function_exists('tg_ready') && tg_ready()) {
        $text = '⚠️ <b>Problem: ' . tg_h($area) . '</b>' . "\n" . tg_h($message) . "\n<i>" . tg_h($when . $more) . '</i>';
        foreach ($owners as $o) if (!empty($o['tg_chat_id']) && tg_send_user($o, $text, ['Open dashboard · لوحة التحكم', $url])) $sent = true;
    }
    if (!$sent) {
        $to = array_values(array_filter(array_column($owners, 'email')));
        if ($to && $area !== 'Email') { // an email problem can't be reported by email
            send_mail($to, 'Problem: ' . $area . ' — Where To Spot shop', email_shell('Problem: ' . h($area),
                '<p>' . nl2br(h($message)) . '</p><p style="color:#6B6660">' . h($when . $more) . '</p>' . btn($url, 'Open the dashboard')),
                'Problem: ' . $area . "\n" . $message . "\n" . $when . $more . "\n" . $url);
        }
    }
}

// PHP errors that stop a request (a typo in a file just uploaded, memory, timeouts) never reach a catch block.
function alerts_watch_fatal(): void
{
    register_shutdown_function(function () {
        $e = error_get_last();
        if (!$e || !in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) return;
        ops_error('Server', $e['message'] . ' (' . basename((string) $e['file']) . ':' . $e['line'] . ')');
    });
}

// Dashboard → Settings → Problems.
function ops_list(): array
{
    $rows = db()->query('SELECT * FROM ops_errors ORDER BY last_at DESC LIMIT 50')->fetchAll();
    return array_map(function ($r) {
        return ['id' => (int) $r['id'], 'area' => $r['area'], 'message' => $r['message'], 'count' => (int) $r['count'], 'firstAt' => $r['first_at'], 'lastAt' => $r['last_at'], 'seen' => (bool) $r['seen']];
    }, $rows);
}
