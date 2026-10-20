<?php
// Team devices: which phones and computers each person signs in from. Each browser gets a long-lived
// device cookie; the phone model comes from the browser (Android Chrome tells the exact model,
// iPhones only say "iPhone", so the screen size gives the likely models). The owner can sign a device out.

declare(strict_types=1);

function devices_migrate(PDO $pdo): void
{
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
    $st = db()->prepare('SELECT id, dev_id, label, first_seen, last_seen, last_ip, logins, revoked FROM user_devices WHERE user_id = ? ORDER BY revoked, last_seen DESC');
    $st->execute([$uid]);
    $mine = device_id();
    return array_map(function ($d) use ($mine) {
        return ['id' => (int) $d['id'], 'label' => $d['label'], 'firstSeen' => $d['first_seen'], 'lastSeen' => $d['last_seen'], 'ip' => $d['last_ip'],
            'logins' => (int) $d['logins'], 'signedOut' => (bool) $d['revoked'], 'thisDevice' => $d['dev_id'] === $mine];
    }, $st->fetchAll());
}
