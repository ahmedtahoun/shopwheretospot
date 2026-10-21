<?php
// Team devices: which phones and computers each person signs in from. Each browser gets a long-lived
// device cookie; the phone model comes from the browser (Android Chrome tells the exact model,
// iPhones only say "iPhone", so the screen size gives the likely models). The owner can sign a device out.

declare(strict_types=1);

function devices_migrate(PDO $pdo): void
{
    // Every sign-in: which device, and from where (city and internet provider from the IP address).
    $pdo->exec("CREATE TABLE IF NOT EXISTS user_logins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id INTEGER,
        at TEXT NOT NULL DEFAULT (datetime('now')),
        ip TEXT DEFAULT '',
        city TEXT DEFAULT '',
        isp TEXT DEFAULT '',
        new_device INTEGER NOT NULL DEFAULT 0
    )");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_logins_user ON user_logins(user_id, at)');
    // The phone's GPS location at sign-in, when the owner turned it on and the person allowed it.
    $cols = $pdo->query('PRAGMA table_info(user_logins)')->fetchAll(PDO::FETCH_COLUMN, 1);
    foreach (['lat' => 'REAL', 'lng' => 'REAL', 'acc' => 'REAL', 'loc_status' => 'TEXT'] as $c => $t) {
        if (!in_array($c, $cols, true)) $pdo->exec("ALTER TABLE user_logins ADD COLUMN $c $t");
    }
    // City and provider per IP address, kept for 30 days (one lookup per address).
    $pdo->exec("CREATE TABLE IF NOT EXISTS ip_geo (ip TEXT PRIMARY KEY, city TEXT DEFAULT '', isp TEXT DEFAULT '', at TEXT NOT NULL DEFAULT (datetime('now')))");
    // Each person's day: first and last time the dashboard was used, and how long it was open (Cairo days).
    $pdo->exec("CREATE TABLE IF NOT EXISTS user_days (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        first_at TEXT NOT NULL,
        last_at TEXT NOT NULL,
        online_min REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day)
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS user_devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        dev_id TEXT NOT NULL,
        ua TEXT DEFAULT '',
        model TEXT DEFAULT '',
        platform TEXT DEFAULT '',
        platform_version TEXT DEFAULT '',
        screen TEXT DEFAULT '',
        label TEXT DEFAULT '',
        first_seen TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen TEXT NOT NULL DEFAULT (datetime('now')),
        last_ip TEXT DEFAULT '',
        logins INTEGER NOT NULL DEFAULT 0,
        revoked INTEGER NOT NULL DEFAULT 0,
        UNIQUE (user_id, dev_id)
    )");
}

// This browser's device id (a random cookie kept for two years).
function device_id(): string
{
    static $id = null;
    if ($id !== null) return $id;
    $c = (string) ($_COOKIE['wts_dev'] ?? '');
    if (preg_match('/^[a-f0-9]{32}$/', $c)) return $id = $c;
    $id = bin2hex(random_bytes(16));
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    if (!headers_sent()) setcookie('wts_dev', $id, ['expires' => time() + 2 * 365 * 86400, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Lax']);
    return $id;
}

function device_ip(): string
{
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
}

// Phone makers from Android model codes.
function device_brand(string $model): string
{
    $m = trim($model);
    $map = ['/^SM-/i' => 'Samsung', '/^Galaxy/i' => 'Samsung', '/^CPH\d/i' => 'OPPO', '/^RMX\d/i' => 'realme', '/^V2\d{3}/i' => 'vivo', '/^Infinix/i' => '', '/^TECNO/i' => '',
        '/^itel/i' => '', '/^(Redmi|POCO|Mi )/i' => 'Xiaomi', '/^(2\d{3}[0-9A-Z]{3,}|M2\d{3})/' => 'Xiaomi', '/^Pixel/i' => 'Google', '/^moto/i' => 'Motorola', '/^Nokia/i' => '',
        '/^(HUAWEI|ALN-|ANA-|ELS-|NOH-|JAD-|BAL-)/i' => 'Huawei', '/^(HONOR|ANY-|RMO-|CMA-)/i' => 'Honor', '/^(ONEPLUS|CPH25|LE2|NE2|PHB)/i' => 'OnePlus'];
    foreach ($map as $re => $brand) if (preg_match($re, $m)) return $brand;
    return '';
}

// iPhones don't say which model they are; the screen size (in points, portrait) narrows it down.
function device_iphone_guess(string $screen): string
{
    if (!preg_match('/^(\d+)x(\d+)$/', $screen, $m)) return '';
    $w = min((int) $m[1], (int) $m[2]); $h = max((int) $m[1], (int) $m[2]);
    $map = ['320x568' => 'SE (1st)', '375x667' => '6 / 7 / 8 / SE', '414x736' => '6–8 Plus', '375x812' => 'X / XS / 11 Pro / 12–13 mini', '414x896' => 'XR / XS Max / 11 / 11 Pro Max',
        '390x844' => '12 / 13 / 14 / 16e', '428x926' => '12–13 Pro Max / 14 Plus', '393x852' => '14 Pro / 15 / 15 Pro / 16', '430x932' => '14 Pro Max / 15 Plus / 15 Pro Max / 16 Plus',
        '402x874' => '16 Pro / 17 / 17 Pro', '440x956' => '16 Pro Max / 17 Pro Max', '420x912' => 'Air'];
    return $map[$w . 'x' . $h] ?? '';
}

// A readable name: "Samsung SM-A546E · Android 14 · Chrome", "iPhone (likely 14 Pro / 15 / 15 Pro / 16) · iOS 17.5 · Safari".
function device_label(string $ua, string $model = '', string $platform = '', string $pv = '', string $screen = ''): string
{
    $browser = preg_match('/SamsungBrowser\//', $ua) ? 'Samsung Internet' : (preg_match('/Edg[A]?\//', $ua) ? 'Edge' : (preg_match('/OPR\/|Opera/', $ua) ? 'Opera'
        : (preg_match('/CriOS\//', $ua) ? 'Chrome' : (preg_match('/FxiOS\/|Firefox\//', $ua) ? 'Firefox' : (preg_match('/Chrome\//', $ua) ? 'Chrome' : (preg_match('/Safari\//', $ua) ? 'Safari' : 'Browser'))))));
    if (preg_match('/WhatsApp|FBAN|FBAV|Instagram/', $ua)) $browser = 'in-app browser';
    if (preg_match('/iPhone/', $ua)) {
        $v = preg_match('/OS (\d+)_(\d+)/', $ua, $m) ? $m[1] . '.' . $m[2] : '';
        $g = device_iphone_guess($screen);
        return 'iPhone' . ($g ? ' (likely ' . $g . ')' : '') . ($v ? ' · iOS ' . $v : '') . ' · ' . $browser;
    }
    // iPads say "Macintosh"; the dashboard tells us when a "Mac" has a touch screen (platform iPadOS).
    if (preg_match('/iPad/', $ua) || $platform === 'iPadOS') return 'iPad · ' . $browser;
    if (preg_match('/Android ([\d.]+)?;?\s*([^;)]*)/', $ua, $m) || stripos($platform, 'android') !== false) {
        $mod = trim($model !== '' ? $model : (($m[2] ?? '') !== 'K' ? preg_replace('/\s*Build\/.*$/', '', (string) ($m[2] ?? '')) : ''));
        $brand = $mod !== '' ? device_brand($mod) : '';
        $ver = $pv !== '' ? preg_replace('/\.0(\.0)?$/', '', $pv) : (($m[1] ?? '') !== '10' || $model !== '' ? (string) ($m[1] ?? '') : '');
        return trim(($brand ? $brand . ' ' : '') . ($mod !== '' ? $mod : 'Android phone')) . ($ver ? ' · Android ' . $ver : '') . ' · ' . $browser;
    }
    if (preg_match('/Windows NT/', $ua) || stripos($platform, 'windows') !== false) {
        $win = $pv !== '' ? ((int) explode('.', $pv)[0] >= 13 ? 'Windows 11' : 'Windows 10') : 'Windows';
        return $win . ' computer · ' . $browser;
    }
    if (preg_match('/Macintosh|Mac OS X/', $ua) || stripos($platform, 'mac') !== false) return 'Mac · ' . $browser;
    if (preg_match('/CrOS/', $ua)) return 'Chromebook · ' . $browser;
    if (preg_match('/Linux/', $ua)) return 'Linux computer · ' . $browser;
    return 'Unknown device · ' . $browser;
}

// Record that this person is using this device (at sign-in, and at most every 10 minutes after).
// Returns false when the owner has signed this device out.
function device_check(int $uid, bool $login = false): bool
{
    $dev = device_id();
    $pdo = db();
    $st = $pdo->prepare('SELECT id, revoked, last_seen, model, platform, platform_version, screen FROM user_devices WHERE user_id = ? AND dev_id = ?');
    $st->execute([$uid, $dev]);
    $d = $st->fetch();
    $ua = substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 400);
    if (!$d) {
        $pdo->prepare('INSERT INTO user_devices (user_id, dev_id, ua, label, last_ip, logins) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$uid, $dev, $ua, device_label($ua), device_ip(), $login ? 1 : 0]);
        return true;
    }
    if ($login) {
        $pdo->prepare("UPDATE user_devices SET revoked = 0, logins = logins + 1, last_seen = datetime('now'), last_ip = ?, ua = ?, label = ? WHERE id = ?")
            ->execute([device_ip(), $ua, device_label($ua, $d['model'], $d['platform'], $d['platform_version'], $d['screen']), $d['id']]);
        return true;
    }
    if ($d['revoked']) return false;
    if (strtotime($d['last_seen'] . ' UTC') < time() - 600) {
        $pdo->prepare("UPDATE user_devices SET last_seen = datetime('now'), last_ip = ? WHERE id = ?")->execute([device_ip(), $d['id']]);
    }
    return true;
}

// Details only the browser knows (exact Android model, screen size), sent once per sign-in.
function device_hints(int $uid, array $b): void
{
    $clean = function ($v, $n) { return substr(preg_replace('/[^\w .,\-\/()+]/u', '', (string) $v), 0, $n); };
    $model = $clean($b['model'] ?? '', 60);
    $platform = $clean($b['platform'] ?? '', 30);
    $pv = $clean($b['platformVersion'] ?? '', 20);
    $screen = preg_match('/^\d{2,5}x\d{2,5}$/', (string) ($b['screen'] ?? '')) ? (string) $b['screen'] : '';
    $ua = substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 400);
    db()->prepare('UPDATE user_devices SET model = ?, platform = ?, platform_version = ?, screen = ?, ua = ?, label = ? WHERE user_id = ? AND dev_id = ?')
        ->execute([$model, $platform, $pv, $screen, $ua, device_label($ua, $model, $platform, $pv, $screen), $uid, device_id()]);
}

function device_list(int $uid): array
{
    $st = db()->prepare("SELECT d.id, d.dev_id, d.label, d.first_seen, d.last_seen, d.last_ip, d.logins, d.revoked,
            (SELECT TRIM(l.city || CASE WHEN l.isp != '' THEN ' · ' || l.isp ELSE '' END) FROM user_logins l WHERE l.device_id = d.id ORDER BY l.id DESC LIMIT 1) AS place
        FROM user_devices d WHERE d.user_id = ? ORDER BY d.revoked, d.last_seen DESC");
    $st->execute([$uid]);
    $mine = device_id();
    return array_map(function ($d) use ($mine) {
        return ['id' => (int) $d['id'], 'label' => $d['label'], 'firstSeen' => $d['first_seen'], 'lastSeen' => $d['last_seen'], 'ip' => $d['last_ip'],
            'logins' => (int) $d['logins'], 'signedOut' => (bool) $d['revoked'], 'thisDevice' => $d['dev_id'] === $mine, 'place' => trim((string) $d['place'], ' ·')];
    }, $st->fetchAll());
}


// ---------- sign-ins ----------
// Called when someone signs in: records the device and the sign-in, looks up the city and provider
// after the answer is sent, and tells the owner when it's a device this person never used before.
function device_login(array $u): void
{
    $uid = (int) $u['id'];
    $pdo = db();
    $dev = device_id();
    $st = $pdo->prepare('SELECT COUNT(*) FROM user_devices WHERE user_id = ? AND dev_id = ?');
    $st->execute([$uid, $dev]);
    $known = (bool) $st->fetchColumn();
    $st = $pdo->prepare('SELECT COUNT(*) FROM user_devices WHERE user_id = ?');
    $st->execute([$uid]);
    $before = (int) $st->fetchColumn();
    device_check($uid, true);
    $st = $pdo->prepare('SELECT id, label FROM user_devices WHERE user_id = ? AND dev_id = ?');
    $st->execute([$uid, $dev]);
    $d = $st->fetch();
    $isNew = !$known && $before > 0;
    $pdo->prepare('INSERT INTO user_logins (user_id, device_id, ip, new_device) VALUES (?, ?, ?, ?)')->execute([$uid, $d['id'] ?? null, device_ip(), $isNew ? 1 : 0]);
    $loginId = (int) $pdo->lastInsertId();
    $_SESSION['login_id'] = $loginId;
    $ip = device_ip();
    $label = (string) ($d['label'] ?? '');
    register_shutdown_function(function () use ($loginId, $ip, $isNew, $u, $label) {
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        elseif (function_exists('litespeed_finish_request')) litespeed_finish_request();
        $g = ip_geo($ip);
        db()->prepare('UPDATE user_logins SET city = ?, isp = ? WHERE id = ?')->execute([$g['city'], $g['isp'], $loginId]);
        if ($isNew) device_new_alert($u, $label, $g, $ip);
    });
}

// City and internet provider for an IP address. Uses ipinfo.io when 'ipinfo_token' is set in
// config.local.php, otherwise ipapi.co's free lookup (only the IP address is sent).
function ip_geo(string $ip): array
{
    $none = ['city' => '', 'isp' => ''];
    if ($ip === '' || !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) return $none;
    $st = db()->prepare("SELECT city, isp FROM ip_geo WHERE ip = ? AND at > datetime('now', '-30 days')");
    $st->execute([$ip]);
    if ($row = $st->fetch()) return ['city' => $row['city'], 'isp' => $row['isp']];
    $token = (string) (cfg('ipinfo_token') ?? '');
    $url = $token !== '' ? 'https://ipinfo.io/' . rawurlencode($ip) . '/json?token=' . rawurlencode($token) : 'https://ipapi.co/' . rawurlencode($ip) . '/json/';
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 6, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_USERAGENT => 'WhereToSpot-Dashboard/1.0']);
    $j = json_decode((string) curl_exec($ch), true);
    if (!is_array($j) || !empty($j['error']) || !empty($j['bogon'])) return $none;
    $city = trim(implode(', ', array_unique(array_filter([$j['city'] ?? '', $j['region'] ?? '']))));
    // "AS36935 Vodafone Data" → "Vodafone Data"
    $isp = trim(preg_replace('/^AS\d+\s+/', '', (string) ($j['org'] ?? $j['asn_org'] ?? '')));
    $out = ['city' => mb_substr($city, 0, 80), 'isp' => mb_substr($isp, 0, 80)];
    db()->prepare('INSERT INTO ip_geo (ip, city, isp, at) VALUES (?, ?, ?, datetime(\'now\')) ON CONFLICT(ip) DO UPDATE SET city = excluded.city, isp = excluded.isp, at = excluded.at')
        ->execute([$ip, $out['city'], $out['isp']]);
    return $out;
}

// Email to the owner(s): someone signed in from a device they never used before.
function device_new_alert(array $u, string $label, array $geo, string $ip): void
{
    log_activity($u, 'New device', $label . ($geo['city'] ? ' · ' . $geo['city'] : ''));
    $to = db()->query("SELECT email FROM users WHERE role = 'owner' AND active = 1")->fetchAll(PDO::FETCH_COLUMN);
    if (!$to) return;
    $where = trim(implode(' · ', array_filter([$geo['city'], $geo['isp']])));
    $inner = '<p style="margin:0 0 12px"><b>' . h($u['name']) . '</b> just signed in to the dashboard from a device they haven’t used before.</p>' .
        '<p style="margin:0 0 6px"><b>Device:</b> ' . h($label) . '</p>' . ($where ? '<p style="margin:0 0 6px"><b>From:</b> ' . h($where) . '</p>' : '') .
        '<p style="margin:0 0 16px"><b>IP:</b> ' . h($ip) . '</p><p style="margin:0 0 16px">If this wasn’t them, open Team → ' . h($u['name']) . ' → Devices and press Sign out, and change their password.</p>' .
        btn(rtrim((string) cfg('site_url'), '/') . '/admin/#team', 'Open Team');
    send_mail($to, 'New device sign-in: ' . $u['name'], email_shell('New device sign-in', $inner),
        $u['name'] . " signed in from a new device.\nDevice: $label\n" . ($where ? "From: $where\n" : '') . "IP: $ip\n\nIf this wasn't them: Team → " . $u['name'] . ' → Devices → Sign out.');
}

// ---------- location at sign-in (owner's choice) ----------
function team_setting(string $key, $default = null)
{
    $st = db()->prepare('SELECT value FROM kv WHERE key = ?');
    $st->execute(['team.' . $key]);
    $v = $st->fetchColumn();
    return $v === false ? $default : json_decode((string) $v, true);
}

function team_set_setting(string $key, $value): void
{
    db()->prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')->execute(['team.' . $key, json_encode($value)]);
}

// Ask this person for their location now? When the owner turned it on: everyone (owners too, so the
// owner can see it working), once per sign-in.
function login_location_needed(array $u): bool
{
    if (!team_setting('ask_location', false)) return false;
    $id = (int) ($_SESSION['login_id'] ?? 0);
    if (!$id) return false;
    $st = db()->prepare('SELECT loc_status FROM user_logins WHERE id = ? AND user_id = ?');
    $st->execute([$id, (int) $u['id']]);
    return $st->fetchColumn() === null;
}

// Save the answer for this sign-in: the position, or why there isn't one (not allowed, unavailable).
function login_location(int $uid, array $b): void
{
    $id = (int) ($_SESSION['login_id'] ?? 0);
    if (!$id) return;
    if (!isset($b['lat'], $b['lng'])) {
        $why = in_array($b['denied'] ?? '', ['denied', 'unavailable', 'timeout'], true) ? $b['denied'] : 'denied';
        db()->prepare('UPDATE user_logins SET loc_status = ? WHERE id = ? AND user_id = ?')->execute([$why, $id, $uid]);
        return;
    }
    $lat = max(-90, min(90, (float) $b['lat']));
    $lng = max(-180, min(180, (float) $b['lng']));
    db()->prepare("UPDATE user_logins SET lat = ?, lng = ?, acc = ?, loc_status = 'ok' WHERE id = ? AND user_id = ?")
        ->execute([round($lat, 6), round($lng, 6), round(max(0, (float) ($b['acc'] ?? 0))), $id, $uid]);
}

// ---------- working hours ----------
// Counts the time the dashboard is open: first and last use each day, and minutes with activity
// (gaps over 15 minutes, like a closed laptop, don't count). Once a minute at most.
function device_ping(int $uid): void
{
    $now = time();
    if (($now - (int) ($_SESSION['ping'] ?? 0)) < 60) return;
    $prev = (int) ($_SESSION['ping'] ?? 0);
    $_SESSION['ping'] = $now;
    $tz = new DateTimeZone('Africa/Cairo');
    $day = (new DateTime('@' . $now))->setTimezone($tz)->format('Y-m-d');
    $at = gmdate('Y-m-d H:i:s', $now);
    $gap = $prev && $now - $prev <= 900 ? ($now - $prev) / 60 : 0;
    db()->prepare('INSERT INTO user_days (user_id, day, first_at, last_at, online_min) VALUES (?, ?, ?, ?, 0)
        ON CONFLICT(user_id, day) DO UPDATE SET last_at = excluded.last_at, online_min = online_min + ?')->execute([$uid, $day, $at, $at, round($gap, 2)]);
}

// Last sign-ins of one person, newest first.
function login_list(int $uid, int $limit = 20): array
{
    $st = db()->prepare('SELECT l.*, d.label FROM user_logins l LEFT JOIN user_devices d ON d.id = l.device_id WHERE l.user_id = ? ORDER BY l.id DESC LIMIT ' . max(1, min(100, $limit)));
    $st->execute([$uid]);
    return array_map(function ($l) {
        return ['at' => $l['at'], 'device' => $l['label'], 'ip' => $l['ip'], 'city' => $l['city'], 'isp' => $l['isp'], 'newDevice' => (bool) $l['new_device'],
            'location' => ($l['loc_status'] ?? '') === 'ok' ? ['lat' => (float) $l['lat'], 'lng' => (float) $l['lng'], 'acc' => (int) $l['acc']] : null, 'locStatus' => $l['loc_status'] ?? null];
    }, $st->fetchAll());
}

// Working days for everyone (or one person) since a day.
function working_hours(string $since, ?int $uid = null): array
{
    $sql = 'SELECT d.*, u.name, u.role FROM user_days d JOIN users u ON u.id = d.user_id WHERE d.day >= ?' . ($uid ? ' AND d.user_id = ?' : '') . ' ORDER BY d.day DESC, u.name';
    $st = db()->prepare($sql);
    $st->execute($uid ? [$since, $uid] : [$since]);
    return array_map(function ($r) {
        return ['userId' => (int) $r['user_id'], 'name' => $r['name'], 'role' => $r['role'], 'day' => $r['day'], 'first' => $r['first_at'], 'last' => $r['last_at'], 'onlineMin' => (int) round((float) $r['online_min'])];
    }, $st->fetchAll());
}
