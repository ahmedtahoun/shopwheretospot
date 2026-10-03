<?php
// Bosta shipping (https://docs.bosta.co). The API key lives only in api/config.local.php on the server:
//   'bosta' => ['api_key' => '…', 'business_location_id' => '', 'default_size' => 'SMALL', 'awb_size' => 'A6', 'awb_lang' => 'ar']
// Status updates come back through api/bosta-webhook.php, which is set on every shipment we create.

const BOSTA_EGYPT = '60e4482c7cb7d4bc4849c4d5';

// Bosta state codes (docs: "Get Shipment Status via Webhook").
const BOSTA_STATES = [
    10 => 'Pickup requested', 11 => 'Waiting for route', 20 => 'Route assigned', 21 => 'Picked up from business',
    22 => 'Picking up from consignee', 23 => 'Picked up from consignee', 24 => 'Received at warehouse', 25 => 'Fulfilled',
    30 => 'In transit between hubs', 40 => 'Picking up', 41 => 'Out for delivery', 45 => 'Delivered',
    46 => 'Returned to business', 47 => 'Exception', 48 => 'Terminated', 49 => 'Canceled', 60 => 'Returned to stock',
    100 => 'Lost', 101 => 'Damaged', 102 => 'Investigation', 103 => 'Awaiting your action', 104 => 'Archived', 105 => 'On hold',
];

function bosta_cfg(string $key, $default = null)
{
    $b = (array) (cfg('bosta') ?? []);
    return $b[$key] ?? $default;
}

function bosta_enabled(): bool
{
    return (string) bosta_cfg('api_key', '') !== '';
}

function bosta_request(string $method, string $path, ?array $body = null, bool $auth = true): array
{
    $url = rtrim((string) bosta_cfg('base_url', 'https://app.bosta.co/api/v2'), '/') . $path;
    $headers = ['Accept: application/json'];
    if ($auth) $headers[] = 'Authorization: ' . bosta_cfg('api_key');
    if ($body !== null) $headers[] = 'Content-Type: application/json';
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 25, CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_HTTPHEADER => $headers,
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    if ($raw === false) throw new ShopError('Could not reach Bosta: ' . $err);
    $json = json_decode((string) $raw, true);
    if (!is_array($json)) throw new ShopError('Unexpected reply from Bosta (HTTP ' . $code . ').');
    if ($code >= 400 || (isset($json['success']) && $json['success'] === false)) {
        $msg = $json['message'] ?? ('HTTP ' . $code);
        if ($code === 401) $msg = 'Bosta rejected the API key. Check it in api/config.local.php.';
        if ($code === 403) $msg = 'Your Bosta API key does not have permission for this. (' . $msg . ')';
        throw new ShopError('Bosta: ' . (is_string($msg) ? $msg : json_encode($msg)));
    }
    return $json;
}

// ---------- cached reference data ----------

function bosta_cache(string $name, int $ttl, callable $load)
{
    $file = cfg('data_dir') . '/bosta-' . $name . '.json';
    if (is_file($file) && filemtime($file) > time() - $ttl) {
        $data = json_decode((string) file_get_contents($file), true);
        if ($data) return $data;
    }
    try {
        $data = $load();
        if (!is_dir(cfg('data_dir'))) mkdir(cfg('data_dir'), 0750, true);
        file_put_contents($file, json_encode($data, JSON_UNESCAPED_UNICODE));
        return $data;
    } catch (Throwable $e) {
        // Serve a stale copy rather than nothing if Bosta is briefly unreachable.
        if (is_file($file)) return json_decode((string) file_get_contents($file), true);
        throw $e;
    }
}

// Cities and districts Bosta delivers to. Public endpoint, cached for a day.
function bosta_areas(): array
{
    return bosta_cache('areas-v2', 86400, function () {
        $res = bosta_request('GET', '/cities/getAllDistricts?countryId=' . BOSTA_EGYPT, null, false);
        $out = [];
        foreach ($res['data'] as $c) {
            $districts = [];
            foreach ($c['districts'] as $d) {
                if (empty($d['dropOffAvailability'])) continue;
                $districts[] = ['id' => $d['districtId'], 'name' => $d['districtName'], 'ar' => $d['districtOtherName'] ?? '',
                    'zoneId' => $d['zoneId'] ?? '', 'zone' => $d['zoneName'] ?? '', 'zoneAr' => $d['zoneOtherName'] ?? ''];
            }
            if (!$districts) continue;
            usort($districts, function ($a, $b) { return strcasecmp($a['name'], $b['name']); });
            $out[] = ['id' => $c['cityId'], 'name' => $c['cityName'], 'ar' => $c['cityOtherName'] ?? '', 'districts' => $districts];
        }
        usort($out, function ($a, $b) {
            $top = ['Cairo' => 0, 'Giza' => 1, 'Alexandria' => 2];
            return [$top[$a['name']] ?? 9, $a['name']] <=> [$top[$b['name']] ?? 9, $b['name']];
        });
        return $out;
    });
}

// Group a city's districts under Bosta zones ("Nasr City", "New Cairo"…) so customers pick a familiar
// area first. 'main' is the district to use when the customer doesn't choose a neighbourhood.
function bosta_zones(array $city): array
{
    $zones = [];
    foreach ($city['districts'] as $d) {
        $key = $d['zoneId'] ?: $d['id'];
        if (!isset($zones[$key])) $zones[$key] = ['id' => $key, 'name' => $d['zone'] ?: $d['name'], 'ar' => $d['zoneAr'] ?: $d['ar'], 'districts' => []];
        $zones[$key]['districts'][] = ['id' => $d['id'], 'name' => $d['name'], 'ar' => $d['ar']];
    }
    foreach ($zones as &$z) {
        $main = $z['districts'][0]['id'];
        foreach ($z['districts'] as $d) {
            if (strcasecmp($d['name'], $z['name']) === 0) { $main = $d['id']; break; }
        }
        $z['main'] = $main;
    }
    unset($z);
    usort($zones, function ($a, $b) { return strcasecmp($a['name'], $b['name']); });
    return $zones;
}

// ---------- area search (checkout "type your area" box) ----------

// Normalise Arabic/English spelling so "مدينة نصر", "مدينه نصر" and "Nasr city" all match Bosta's names.
function area_norm(string $s): string
{
    $s = mb_strtolower($s, 'UTF-8');
    $s = preg_replace('/[\x{064B}-\x{065F}\x{0670}\x{0640}]/u', '', $s); // tashkeel, tatweel
    // Hamza forms are dropped entirely: Bosta itself writes "حداءق" where people type "حدائق".
    $s = strtr($s, ['أ' => 'ا', 'إ' => 'ا', 'آ' => 'ا', 'ٱ' => 'ا', 'ة' => 'ه', 'ى' => 'ي', 'ؤ' => 'و', 'ئ' => '', 'ء' => '',
        '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9']);
    $s = preg_replace('/[^\p{L}\p{N}]+/u', ' ', $s);
    return trim(preg_replace('/\s+/u', ' ', $s));
}

// Everyday names customers type that differ from Bosta's official ones.
const AREA_ALIASES = [
    'tagamoa' => 'التجمع', 'tagamo3' => 'التجمع', 'tagamo' => 'التجمع', 'tagamou' => 'التجمع', 'fifth' => '5th',
    'heliopolis' => 'مصر الجديده', 'masr el gedida' => 'مصر الجديده', 'mohandeseen' => 'المهندسين', 'mohandessin' => 'المهندسين',
    'mohandseen' => 'المهندسين', 'downtown' => 'وسط البلد', 'wust el balad' => 'وسط البلد', 'zayed' => 'الشيخ زايد',
    'agami' => 'العجمي', 'agamy' => 'العجمي', 'alex' => 'الاسكندريه', 'alexandria' => 'الاسكندريه', 'october' => 'اكتوبر', 'hadayek' => 'حدائق', 'kobba' => 'القبه', 'qobba' => 'القبه',
];

function area_alias(string $s): string
{
    $n = ' ' . area_norm($s) . ' ';
    foreach (AREA_ALIASES as $from => $to) $n = str_replace(' ' . $from . ' ', ' ' . $to . ' ', $n);
    return trim($n);
}

function area_compact(string $s): string
{
    // Drop Arabic/English articles so "el maadi", "elmaadi", "maadi", "المعادي" and "معادي" line up.
    $words = array_filter(explode(' ', area_norm($s)), function ($w) { return !in_array($w, ['el', 'al', 'ال'], true); });
    $words = array_map(function ($w) { return preg_replace('/^(el|al|ال)(?=\p{L}{3})/u', '', $w); }, $words);
    return implode('', $words);
}

// Flat, pre-normalised index of every deliverable district, cached with the area list.
function area_index(): array
{
    static $idx = null;
    if ($idx !== null) return $idx;
    $file = cfg('data_dir') . '/bosta-area-index.json';
    $areasFile = cfg('data_dir') . '/bosta-areas-v2.json';
    $areas = bosta_areas();
    if (is_file($file) && is_file($areasFile) && filemtime($file) >= filemtime($areasFile)) {
        $idx = json_decode((string) file_get_contents($file), true);
        if ($idx) return $idx;
    }
    $idx = [];
    foreach ($areas as $c) {
        foreach (bosta_zones($c) as $z) {
            foreach ($z['districts'] as $d) {
                $idx[] = [
                    'cityId' => $c['id'], 'city' => $c['name'], 'cityAr' => $c['ar'],
                    'zoneId' => $z['id'], 'zone' => $z['name'], 'zoneAr' => $z['ar'], 'zoneMain' => $d['id'] === $z['main'], 'zoneSize' => count($z['districts']),
                    'id' => $d['id'], 'name' => $d['name'], 'ar' => $d['ar'],
                    'k' => [area_compact($d['name']), area_compact($d['ar']), area_compact($z['name']), area_compact($z['ar']), area_compact($c['name']), area_compact($c['ar'])],
                ];
            }
        }
    }
    @file_put_contents($file, json_encode($idx, JSON_UNESCAPED_UNICODE));
    return $idx;
}

function area_result(array $e, bool $wholeZone): array
{
    if ($wholeZone && $e['zoneSize'] > 1) {
        return ['districtId' => $e['id'], 'cityId' => $e['cityId'], 'zoneId' => $e['zoneId'],
            'title' => $e['zone'], 'titleAr' => $e['zoneAr'], 'sub' => $e['city'] . ' · any neighbourhood', 'subAr' => $e['cityAr']];
    }
    $same = strcasecmp($e['name'], $e['zone']) === 0;
    return ['districtId' => $e['id'], 'cityId' => $e['cityId'], 'zoneId' => $e['zoneId'],
        'title' => $e['name'], 'titleAr' => $e['ar'],
        'sub' => ($same ? '' : $e['zone'] . ', ') . $e['city'], 'subAr' => ($same ? '' : $e['zoneAr'] . '، ') . $e['cityAr']];
}

// Typed search: best matches first, whole areas ("Nasr City · any neighbourhood") before single neighbourhoods.
function area_search(string $q, int $limit = 8): array
{
    $q = area_alias($q);
    $words = array_values(array_filter(array_map('area_compact', explode(' ', area_norm($q)))));
    $full = area_compact($q);
    if (mb_strlen($full) < 2) return [];
    $scored = [];
    foreach (area_index() as $e) {
        [$dEn, $dAr, $zEn, $zAr, $cEn, $cAr] = $e['k'];
        $hay = $dEn . ' ' . $dAr . ' ' . $zEn . ' ' . $zAr . ' ' . $cEn . ' ' . $cAr;
        foreach ($words as $w) if (mb_strpos($hay, $w) === false) continue 2; // every typed word must match somewhere
        $score = 0;
        foreach ([[$dEn, $dAr, 100], [$zEn, $zAr, 80]] as [$en, $ar, $base]) {
            foreach ([$en, $ar] as $k) {
                if ($k === '') continue;
                if ($k === $full) $score = max($score, $base + 30);
                elseif (mb_strpos($k, $full) === 0) $score = max($score, $base + 15);
                elseif (mb_strpos($k, $full) !== false) $score = max($score, $base);
            }
        }
        if (!$score) $score = 20; // matched via city or across fields
        $zoneHit = $zEn === $full || $zAr === $full || mb_strpos($zEn, $full) === 0 || mb_strpos($zAr, $full) === 0;
        if ($zoneHit && $e['zoneMain']) $scored[] = [$score + 40, area_result($e, true)];
        if (!($zoneHit && $e['zoneSize'] > 1 && !$e['zoneMain'] && $score < 100) || count($words) > 1) {
            $scored[] = [$score - mb_strlen($dEn) / 100, area_result($e, false)];
        }
    }
    usort($scored, function ($a, $b) { return $b[0] <=> $a[0]; });
    $out = [];
    foreach ($scored as [, $r]) {
        $key = $r['districtId'] . '|' . $r['title'];
        if (isset($out[$key])) continue;
        $out[$key] = $r;
        if (count($out) >= $limit) break;
    }
    return array_values($out);
}

// Suggestions from the street address the customer typed: find area names mentioned in it.
function area_suggest(string $text, int $limit = 4): array
{
    $t = ' ' . implode(' ', array_map('area_compact', explode(' ', area_alias($text)))) . ' ';
    $tc = str_replace(' ', '', $t);
    if (mb_strlen($tc) < 4) return [];
    $cities = [];
    foreach (area_index() as $e) {
        foreach ([$e['k'][4], $e['k'][5]] as $k) if (mb_strlen($k) >= 4 && mb_strpos($tc, $k) !== false) $cities[$e['cityId']] = true;
    }
    $scored = [];
    foreach (area_index() as $e) {
        if ($cities && !isset($cities[$e['cityId']])) continue;
        [$dEn, $dAr, $zEn, $zAr] = $e['k'];
        $hit = function ($k) use ($tc) { return mb_strlen($k) >= 4 && mb_strpos($tc, $k) !== false; };
        $zoneLen = max($hit($zEn) ? mb_strlen($zEn) : 0, $hit($zAr) ? mb_strlen($zAr) : 0);
        $distLen = max($hit($dEn) ? mb_strlen($dEn) : 0, $hit($dAr) ? mb_strlen($dAr) : 0);
        // A neighbourhood counts most when its area is mentioned too ("Beverly Hills, Sheikh Zayed");
        // a whole area beats a stray neighbourhood name inside a street name ("Abbas El Akkad, Nasr City").
        if ($distLen && ($distLen !== $zoneLen || $e['zoneSize'] === 1)) {
            $scored[] = [$distLen + ($zoneLen ? 8 : 0) + ($cities ? 5 : 0), area_result($e, false)];
        }
        if ($zoneLen && $e['zoneMain']) $scored[] = [$zoneLen + 6 + ($cities ? 5 : 0), area_result($e, true)];
    }
    usort($scored, function ($a, $b) { return $b[0] <=> $a[0]; });
    $out = [];
    foreach ($scored as [, $r]) {
        $out[$r['districtId'] . '|' . $r['title']] = $r;
        if (count($out) >= $limit) break;
    }
    return array_values($out);
}

function bosta_find_area(string $cityId, string $districtId): ?array
{
    foreach (bosta_areas() as $c) {
        if ($c['id'] !== $cityId) continue;
        foreach ($c['districts'] as $d) {
            if ($d['id'] === $districtId) return ['city' => $c, 'district' => $d];
        }
    }
    return null;
}

function bosta_locations(): array
{
    return bosta_cache('locations', 600, function () {
        $res = bosta_request('GET', '/pickup-locations');
        $list = $res['data']['list'] ?? ($res['data'] ?? []);
        return array_map(function ($l) {
            $city = $l['address']['city'] ?? '';
            return ['id' => $l['_id'], 'name' => $l['locationName'] ?? $l['_id'], 'isDefault' => !empty($l['isDefault']),
                'city' => is_array($city) ? ($city['name'] ?? '') : (string) $city];
        }, $list);
    });
}

// Shared secret Bosta sends back on every webhook call (set per shipment via webhookCustomHeaders).
function bosta_webhook_secret(): string
{
    $file = cfg('data_dir') . '/bosta-webhook-secret.txt';
    if (!is_file($file)) file_put_contents($file, bin2hex(random_bytes(20)));
    return trim((string) file_get_contents($file));
}

// ---------- shipments ----------

function bosta_split_name(string $full): array
{
    $parts = preg_split('/\s+/', trim($full), 2);
    return [$parts[0] ?: 'Customer', $parts[1] ?? ''];
}

// Create a Bosta delivery for an order. $opts: size, cod, notes, location_id, city_id, district_id,
// address (first line), building, floor, apartment, landmark, allow_open.
function bosta_create_for_order(array $o, array $opts): array
{
    if (!bosta_enabled()) throw new ShopError('Bosta is not set up yet. Add the API key to api/config.local.php.');
    if (!empty($o['tracking_number'])) throw new ShopError('This order already has a Bosta shipment (' . $o['tracking_number'] . ').');
    $cityId = ($opts['city_id'] ?? '') ?: (string) $o['city_id'];
    $districtId = ($opts['district_id'] ?? '') ?: (string) $o['district_id'];
    $area = ($cityId && $districtId) ? bosta_find_area((string) $cityId, (string) $districtId) : null;
    if (!$area) throw new ShopError('Choose the customer’s city and area (Bosta needs an exact district).');
    $firstLine = trim((string) ($opts['address'] ?? $o['address']));
    if (mb_strlen($firstLine) <= 5) throw new ShopError('The street address must be longer than 5 characters for Bosta.');

    $items = json_decode($o['items'], true) ?: [];
    $physical = array_values(array_filter($items, function ($i) { return ($i['cat'] ?? '') !== 'services'; }));
    if (!$physical) throw new ShopError('This order has no physical products to ship.');
    $count = array_sum(array_map(function ($i) { return (int) $i['qty']; }, $physical));
    $desc = implode(', ', array_map(function ($i) { return $i['qty'] . 'x ' . $i['name']; }, $physical));
    // Already-paid orders (bank transfer, wallet, cash in hand) collect nothing at the door by default.
    $cod = isset($opts['cod']) && $opts['cod'] !== '' ? (float) $opts['cod'] : (($o['payment'] ?? 'cod') === 'cod' ? (float) $o['total'] : 0.0);
    if ($cod < 0 || $cod > 30000) throw new ShopError('Cash to collect must be between 0 and 30,000 EGP (Bosta limit).');
    [$first, $last] = bosta_split_name($o['customer']);
    $goods = array_sum(array_map(function ($i) { return $i['total'] ?? $i['qty'] * $i['price']; }, $physical));

    $payload = [
        'type' => 10,
        'specs' => [
            'packageType' => 'Parcel',
            'size' => in_array($opts['size'] ?? '', ['SMALL', 'MEDIUM', 'LARGE'], true) ? $opts['size'] : bosta_cfg('default_size', 'SMALL'),
            'packageDetails' => ['itemsCount' => max(1, $count), 'description' => mb_substr($desc, 0, 500)],
        ],
        'goodsInfo' => ['amount' => round($goods, 2)],
        'notes' => mb_substr(trim((string) ($opts['notes'] ?? '')), 0, 500),
        'cod' => round($cod, 2),
        'dropOffAddress' => array_filter([
            'city' => $area['city']['name'],
            'districtId' => $area['district']['id'],
            'zoneId' => $area['district']['zoneId'] ?: null,
            'firstLine' => mb_substr($firstLine, 0, 250),
            'secondLine' => trim((string) ($opts['landmark'] ?? '')) ?: null,
            'buildingNumber' => trim((string) ($opts['building'] ?? '')) ?: null,
            'floor' => trim((string) ($opts['floor'] ?? '')) ?: null,
            'apartment' => trim((string) ($opts['apartment'] ?? '')) ?: null,
        ], function ($v) { return $v !== null && $v !== ''; }),
        'businessReference' => order_number((int) $o['id']),
        'uniqueBusinessReference' => order_number((int) $o['id']),
        'receiver' => array_filter(['firstName' => $first, 'lastName' => $last, 'phone' => $o['phone'], 'email' => $o['email']]),
        'webhookUrl' => rtrim(cfg('site_url'), '/') . '/api/bosta-webhook.php',
        'webhookCustomHeaders' => ['Authorization' => 'Bearer ' . bosta_webhook_secret()],
    ];
    $loc = ($opts['location_id'] ?? '') ?: bosta_cfg('business_location_id', '');
    if ($loc) $payload['businessLocationId'] = $loc;
    if (!$payload['notes']) unset($payload['notes']);

    $res = bosta_request('POST', '/deliveries?apiVersion=1', $payload);
    $d = $res['data'] ?? [];
    if (empty($d['trackingNumber'])) throw new ShopError('Bosta did not return a tracking number.');
    return [
        'bosta_id' => (string) ($d['_id'] ?? ''), 'tracking_number' => (string) $d['trackingNumber'],
        'state' => (int) ($d['state']['code'] ?? 10), 'city_id' => $area['city']['id'], 'district_id' => $area['district']['id'],
        'district' => $area['district']['name'], 'city' => $o['city'] ?: $area['city']['name'], 'cod' => $cod,
    ];
}

function bosta_view(string $tracking): array
{
    $res = bosta_request('GET', '/deliveries/business/' . rawurlencode($tracking));
    return $res['data'] ?? [];
}

function bosta_awb_pdf(array $trackingNumbers): string
{
    $res = bosta_request('POST', '/deliveries/mass-awb', [
        'trackingNumbers' => implode(',', $trackingNumbers),
        'requestedAwbType' => bosta_cfg('awb_size', 'A6'),
        'lang' => bosta_cfg('awb_lang', 'ar'),
    ]);
    $b64 = is_string($res['data'] ?? null) ? $res['data'] : ($res['data']['file'] ?? ($res['data']['data'] ?? ''));
    $pdf = base64_decode((string) $b64, true);
    if (!$pdf || strpos($pdf, '%PDF') !== 0) throw new ShopError('Bosta did not return a printable waybill. ' . ($res['message'] ?? ''));
    return $pdf;
}

function bosta_terminate(string $tracking): void
{
    bosta_request('DELETE', '/deliveries/business/' . rawurlencode($tracking) . '/terminate');
}

function bosta_state_label(?int $code): string
{
    return $code === null ? '' : (BOSTA_STATES[$code] ?? ('State ' . $code));
}

// Which shop status a Bosta state moves the order to (null = leave it as it is).
function bosta_order_status(int $code): ?string
{
    if (in_array($code, [21, 24, 30, 41], true)) return 'Shipped';
    if ($code === 45) return 'Delivered';
    if ($code === 46) return 'Returned';
    return null;
}

// Save a Bosta state on an order and move the shop status forward when it makes sense.
function bosta_apply_state(int $orderId, int $code, string $note = ''): void
{
    $pdo = db();
    $st = $pdo->prepare('SELECT status FROM orders WHERE id = ?');
    $st->execute([$orderId]);
    $current = $st->fetchColumn();
    if ($current === false) return;
    $pdo->prepare("UPDATE orders SET bosta_state = ?, bosta_note = ?, bosta_updated_at = datetime('now') WHERE id = ?")
        ->execute([$code, mb_substr($note, 0, 300), $orderId]);
    $next = bosta_order_status($code);
    if ($next && $next !== $current && (ORDER_STAGE[$next] ?? 0) >= (ORDER_STAGE[$current] ?? 0) && $current !== 'Cancelled') {
        set_order_status($orderId, $next);
    }
}
