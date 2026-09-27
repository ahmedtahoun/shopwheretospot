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
    $cod = isset($opts['cod']) && $opts['cod'] !== '' ? (float) $opts['cod'] : (float) $o['total'];
    if ($cod < 0 || $cod > 30000) throw new ShopError('Cash to collect must be between 0 and 30,000 EGP (Bosta limit).');
    [$first, $last] = bosta_split_name($o['customer']);
    $goods = array_sum(array_map(function ($i) { return $i['qty'] * $i['price']; }, $physical));

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
    $rank = ['Pending' => 0, 'Confirmed' => 1, 'Shipped' => 2, 'Delivered' => 3, 'Returned' => 3, 'Cancelled' => 3];
    if ($next && $next !== $current && ($rank[$next] ?? 0) >= ($rank[$current] ?? 0) && $current !== 'Cancelled') {
        set_order_status($orderId, $next);
    }
}
