<?php
// Which country this copy of the shop sells in. One codebase runs several shops (shop.wheretospot.com = Egypt,
// a UAE shop, …), each with its own api/config.local.php and database. Set 'market' => 'AE' there for the UAE;
// without it the shop is Egypt, exactly as before. Any value below can be overridden with
// 'market_settings' => ['charge_rate' => 13.6, …] in api/config.local.php.
//
// Prices are kept in the market's currency (EGP in Egypt, AED in the UAE). Online payments go through Paymob
// Egypt, which charges in EGP: charge_rate is how many EGP one unit of the market's currency costs (1 in Egypt).

declare(strict_types=1);

const MARKETS = [
    'EG' => [
        'code' => 'EG',
        'currency' => 'EGP',            // ISO code: prices, Meta, Google, structured data
        'cur_en' => 'EGP',              // shown before the amount in English: "EGP 1,000"
        'cur_ar' => 'ج.م',              // shown after the amount in Arabic: "1,000 ج.م"
        'currency_en' => 'Egyptian Pounds',
        'currency_ar' => 'الجنيه المصري',
        'country_en' => 'Egypt',
        'country_ar' => 'مصر',
        'og_locale_ar' => 'ar_EG',
        'timezone' => 'Africa/Cairo',
        'phone_cc' => '20',             // country calling code
        'mobile_local' => '/^01\d{9}$/', // a local mobile number as typed (01012345678)
        'mobile_bare' => '/^1\d{9}$/',  // the same without its first 0 (1012345678)
        'wa_local' => '/^20(1\d{9})$/', // WhatsApp's form of a local mobile, to show it as 0…
        'phone_display' => '+20 127 766 0666', // the shop's own number, in emails and page data
        'charge_currency' => 'EGP',     // what Paymob charges in
        'charge_rate' => 1,             // charge_currency per 1 unit of currency
    ],
    'AE' => [
        'code' => 'AE',
        'currency' => 'AED',
        'cur_en' => 'AED',
        'cur_ar' => 'د.إ',
        'currency_en' => 'UAE Dirhams',
        'currency_ar' => 'الدرهم الإماراتي',
        'country_en' => 'the UAE',
        'country_ar' => 'الإمارات',
        'og_locale_ar' => 'ar_AE',
        'timezone' => 'Asia/Dubai',
        'phone_cc' => '971',
        'mobile_local' => '/^05\d{8}$/', // 0501234567
        'mobile_bare' => '/^5\d{8}$/',
        'wa_local' => '/^971(5\d{8})$/',
        'phone_display' => '+20 127 766 0666', // until the UAE shop has its own number (market_settings.phone_display)
        'charge_currency' => 'EGP',
        'charge_rate' => 0,             // must be set in config.local.php (market_settings.charge_rate) before card payments
    ],
];

function market(?string $key = null)
{
    static $m = null;
    if ($m === null) {
        global $config;
        $code = strtoupper((string) ($config['market'] ?? 'EG'));
        $m = array_merge(MARKETS[$code] ?? MARKETS['EG'], (array) ($config['market_settings'] ?? []));
    }
    return $key === null ? $m : $m[$key];
}

function market_is(string $code): bool
{
    return market('code') === $code;
}

// "EGP 1,250" in English, "1,250 ج.م" in Arabic (whole amounts, as the shop has always shown them).
function money($amount, bool $ar = false): string
{
    return $ar ? number_format((float) $amount) . ' ' . market('cur_ar') : market('cur_en') . ' ' . number_format((float) $amount);
}

function market_tz(): DateTimeZone
{
    return new DateTimeZone((string) market('timezone'));
}

// Digits of a phone number with the country code, for WhatsApp and Meta: a local mobile (01012345678 in Egypt,
// 0501234567 in the UAE) gets the market's code; anything else is left as typed. '' if it's too short.
function market_intl_digits(string $digits): string
{
    if (strpos($digits, '00') === 0) $digits = substr($digits, 2);
    if (preg_match((string) market('mobile_local'), $digits)) $digits = market('phone_cc') . substr($digits, 1);
    return $digits;
}

// The database is labelled with its market the first time a shop opens it (kv 'shop.market'). Egypt's existing
// database has no label yet and gets 'EG'. Another market only takes an unlabelled database that is still empty,
// so a misconfigured UAE shop can never claim Egypt's. A label that doesn't match stops the request.
function market_check_database(PDO $pdo, string $dir): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)');
    $owner = $pdo->query("SELECT value FROM kv WHERE key = 'shop.market'")->fetchColumn();
    $code = (string) market('code');
    if ($owner === false) {
        $tables = (int) $pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT IN ('kv', 'sqlite_sequence')")->fetchColumn();
        if ($code === 'EG' || $tables === 0) {
            $pdo->prepare("INSERT OR IGNORE INTO kv (key, value) VALUES ('shop.market', ?)")->execute([$code]);
            return;
        }
        $owner = 'unlabelled, with data';
    }
    if ($owner === $code) return;
    error_log('[market] ' . $code . ' shop refused the database in ' . $dir . ' (belongs to: ' . $owner . ')');
    if (!headers_sent()) { http_response_code(503); header('Content-Type: text/plain; charset=utf-8'); }
    exit('This shop is set to the ' . $code . ' market but its database belongs to another one (' . $owner . '). '
        . 'Set its own data_dir in api/config.local.php.');
}

// ---------- charging through Paymob Egypt from another currency ----------

function market_charge_rate(): float
{
    return (float) market('charge_rate');
}

// Amount due in the shop's currency -> what Paymob charges, in cents of the charge currency.
function market_charge_cents(float $due, float $rate): int
{
    return (int) round($due * $rate * 100);
}

// The rate a Paymob payment was started with, saved by its reference (only when it isn't 1, i.e. outside Egypt).
function market_remember_rate(string $ref, float $rate): void
{
    if ($rate == 1.0) return;
    db()->prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')->execute(['payrate.' . $ref, json_encode($rate)]);
}

// Money Paymob received (cents of the charge currency) -> the amount in the shop's currency.
function market_received_amount(int $chargedCents, string $ref): float
{
    $rate = 1.0;
    if ($ref !== '') {
        $st = db()->prepare('SELECT value FROM kv WHERE key = ?');
        $st->execute(['payrate.' . $ref]);
        $v = $st->fetchColumn();
        if ($v !== false && (float) json_decode((string) $v) > 0) $rate = (float) json_decode((string) $v);
    }
    return $rate == 1.0 ? $chargedCents / 100 : round($chargedCents / 100 / $rate, 2);
}
