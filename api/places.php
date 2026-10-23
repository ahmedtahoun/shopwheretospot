<?php
// Business lookup for the free review-link tool (google-review-link.html), with Google Places API (New)
// and 'google_places_key' from api/config.local.php:
//   GET api/places.php?q=<name and area>   → matching businesses (search box)
//   GET api/places.php?url=<any Maps link> → the exact business and its verified Place ID
//   GET api/places.php?id=<Place ID>       → that Place ID checked with Google
//   GET api/places.php                     → whether the search key is set up
//
// A Place ID is only returned when Google confirms it: from the link itself (checked), from the link's
// own place number (CID, matched exactly), or from a search near the link's coordinates that matches the
// name within ~150 m. Anything less certain comes back as a short list to choose from, never a guess.

declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

$key = trim((string) (cfg('google_places_key') ?? ''));
const PLACE_FIELDS = 'id,displayName,formattedAddress,location,rating,userRatingCount,googleMapsUri';

function places_call(string $method, string $url, string $key, string $fields, ?array $body = null): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'X-Goog-Api-Key: ' . $key, 'X-Goog-FieldMask: ' . $fields]]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $res = json_decode((string) $raw, true);
    if ($code === 404 || $code === 400 && strpos((string) $raw, 'INVALID_ARGUMENT') !== false) return ['notFound' => true];
    if (!is_array($res) || isset($res['error'])) {
        error_log('[shop] places: ' . substr((string) $raw, 0, 300));
        throw new ShopError('Google search isn’t working right now. Try again in a moment, or paste the review link from your Business Profile.');
    }
    return $res;
}

function place_out(array $p): array
{
    parse_str((string) parse_url((string) ($p['googleMapsUri'] ?? ''), PHP_URL_QUERY), $q);
    return ['id' => (string) $p['id'], 'name' => (string) ($p['displayName']['text'] ?? ''), 'address' => (string) ($p['formattedAddress'] ?? ''),
        'rating' => isset($p['rating']) ? (float) $p['rating'] : null, 'reviews' => (int) ($p['userRatingCount'] ?? 0),
        'lat' => $p['location']['latitude'] ?? null, 'lng' => $p['location']['longitude'] ?? null, 'cid' => (string) ($q['cid'] ?? ''), 'maps' => (string) ($p['googleMapsUri'] ?? ''),
        'link' => 'https://search.google.com/local/writereview?placeid=' . rawurlencode((string) $p['id'])];
}

function place_details(string $id, string $key): ?array
{
    if (!preg_match('/^[A-Za-z0-9_-]{10,300}$/', $id)) return null;
    $r = places_call('GET', 'https://places.googleapis.com/v1/places/' . $id, $key, PLACE_FIELDS);
    return empty($r['notFound']) && !empty($r['id']) ? place_out($r) : null;
}

function places_search(string $text, string $key, ?array $near = null): array
{
    $body = ['textQuery' => $text, 'regionCode' => 'EG', 'languageCode' => preg_match('/\p{Arabic}/u', $text) ? 'ar' : 'en', 'pageSize' => 8];
    if ($near) $body['locationBias'] = ['circle' => ['center' => ['latitude' => $near[0], 'longitude' => $near[1]], 'radius' => 500.0]];
    $r = places_call('POST', 'https://places.googleapis.com/v1/places:searchText', $key, implode(',', array_map(function ($f) { return 'places.' . $f; }, explode(',', PLACE_FIELDS))), $body);
    return array_map('place_out', (array) ($r['places'] ?? []));
}

// A Maps CID is a 64-bit number written in hex in links (0x…:0xCID) and in decimal in Google's own links (?cid=).
function hex_to_dec(string $hex): string
{
    $dec = '0';
    foreach (str_split(strtolower(ltrim($hex, '0x')) ?: '0') as $h) {
        $carry = hexdec($h); $out = '';
        for ($i = strlen($dec) - 1; $i >= 0; $i--) { $v = (int) $dec[$i] * 16 + $carry; $out = ($v % 10) . $out; $carry = intdiv($v, 10); }
        while ($carry) { $out = ($carry % 10) . $out; $carry = intdiv($carry, 10); }
        $dec = ltrim($out, '0') ?: '0';
    }
    return $dec;
}

function dec_to_hex(string $dec): string
{
    $hex = '';
    while ($dec !== '0' && $dec !== '') {
        $rem = 0; $q = '';
        foreach (str_split($dec) as $d) { $v = $rem * 10 + (int) $d; $q .= intdiv($v, 16); $rem = $v % 16; }
        $hex = dechex($rem) . $hex;
        $dec = ltrim($q, '0') ?: '0';
    }
    return $hex ?: '0';
}

// The official review link of a place, made from its place number (CID): the same g.page/r/…/review link
// Google gives owners under "Ask for reviews" (the CID as 8 bytes, wrapped as Google does). Free, no key.
function cid_review_link(string $cid): string
{
    $bytes = strrev(hex2bin(str_pad(dec_to_hex($cid), 16, '0', STR_PAD_LEFT)));
    return 'https://g.page/r/' . rtrim(strtr(base64_encode("\x09" . $bytes . "\x10\x01"), '+/', '-_'), '=') . '/review';
}

// The CID inside a g.page/r/…/review link.
function review_link_cid(string $link): ?string
{
    if (!preg_match('~g\.page/r/([A-Za-z0-9_-]{14,16})~', $link, $m)) return null;
    $b = base64_decode(strtr($m[1], '-_', '+/') . str_repeat('=', (4 - strlen($m[1]) % 4) % 4));
    return $b !== false && strlen($b) >= 9 && $b[0] === "\x09" ? hex_to_dec('0x' . bin2hex(strrev(substr($b, 1, 8)))) : null;
}

// Ask Google where a review link leads: it must open the review box of this very place (its number and !12e1).
// A wrong number lands on google.com instead. Only Google addresses are followed.
function review_link_ok(string $link, string $cid): bool
{
    $url = $link;
    for ($i = 0; $i < 6; $i++) {
        if (!preg_match('~^https://([a-z0-9.-]+\.)?(google\.[a-z.]{2,8}|g\.page)/~i', $url)) return false;
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false, CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4, CURLOPT_RANGE => '0-1000',
            CURLOPT_HTTPHEADER => ['User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36']]);
        curl_exec($ch);
        $next = (string) curl_getinfo($ch, CURLINFO_REDIRECT_URL);
        if ($next === '') break;
        $url = $next;
    }
    return stripos($url, ':0x' . dec_to_hex($cid)) !== false && strpos($url, '!12e1') !== false;
}

function metres(float $a1, float $o1, float $a2, float $o2): float
{
    $r = 6371000; $p = M_PI / 180;
    $x = sin(($a2 - $a1) * $p / 2) ** 2 + cos($a1 * $p) * cos($a2 * $p) * sin(($o2 - $o1) * $p / 2) ** 2;
    return 2 * $r * asin(min(1, sqrt($x)));
}

// How alike two business names are (0–1), ignoring case, punctuation and common words.
function name_match(string $a, string $b): float
{
    $norm = function ($s) {
        $s = mb_strtolower(preg_replace('/[^\p{L}\p{N} ]+/u', ' ', $s));
        $s = preg_replace('/\b(the|and|cafe|café|restaurant|shop|store|egypt|eg)\b/u', ' ', $s);
        return trim(preg_replace('/\s+/', ' ', $s));
    };
    $a = $norm($a); $b = $norm($b);
    if ($a === '' || $b === '') return 0;
    if (mb_strpos($a, $b) !== false || mb_strpos($b, $a) !== false) return 1;
    similar_text($a, $b, $pct);
    return $pct / 100;
}

// Follow a short link (maps.app.goo.gl, share.google, goo.gl…) to the full Google address. Only Google
// addresses are ever requested, at most 6 steps.
function resolve_google_url(string $url): string
{
    $google = '/(^|\.)(google\.[a-z.]{2,8}|goo\.gl|share\.google|g\.co|g\.page)$/i';
    for ($i = 0; $i < 6; $i++) {
        $host = (string) parse_url($url, PHP_URL_HOST);
        if (!preg_match('~^https?://~i', $url) || !preg_match($google, $host)) throw new ShopError('That isn’t a Google Maps link.');
        // Google's cookie page carries the real address in "continue".
        if (stripos($host, 'consent.google') !== false) { parse_str((string) parse_url($url, PHP_URL_QUERY), $q); if (!empty($q['continue'])) { $url = $q['continue']; continue; } }
        $short = preg_match('/(^|\.)(goo\.gl|share\.google|g\.co)$/i', $host) || stripos($host, 'consent.') === 0;
        if (!$short && preg_match('~/maps|[?&](q|cid|ftid|query)=~i', $url)) return $url;
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_NOBODY => false, CURLOPT_FOLLOWLOCATION => false, CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4, CURLOPT_RANGE => '0-2000',
            CURLOPT_HTTPHEADER => ['User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language: en']]);
        $raw = (string) curl_exec($ch);
        $loc = (string) curl_getinfo($ch, CURLINFO_REDIRECT_URL);
        if ($loc === '' && preg_match('/^location:\s*(\S+)/mi', $raw, $m)) $loc = trim($m[1]);
        if ($loc === '') return $url;
        $url = $loc;
    }
    return $url;
}

// What a Maps link tells us: a Place ID, the place's own number (CID), its coordinates, and its name.
function parse_maps_url(string $url): array
{
    $u = rawurldecode(str_replace('+', ' ', $url));
    parse_str((string) parse_url($url, PHP_URL_QUERY), $q);
    $out = ['placeId' => null, 'cid' => null, 'lat' => null, 'lng' => null, 'name' => null];
    if (preg_match('/(?:query_place_id=|place_id[:=]|placeid=|!1s)(ChIJ[A-Za-z0-9_-]{10,}|GhIJ[A-Za-z0-9_-]{10,})/', $u, $m)) $out['placeId'] = $m[1];
    if (preg_match('/0x[0-9a-f]+:(0x[0-9a-f]+)/i', $u, $m)) $out['cid'] = hex_to_dec($m[1]);
    elseif (!empty($q['cid']) && ctype_digit((string) $q['cid'])) $out['cid'] = (string) $q['cid'];
    if (preg_match('/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/', $u, $m) || preg_match('/@(-?\d+\.\d+),(-?\d+\.\d+)/', $u, $m)) { $out['lat'] = (float) $m[1]; $out['lng'] = (float) $m[2]; }
    if (preg_match('~/maps/place/([^/@?]+)~', $u, $m)) $out['name'] = trim($m[1]);
    elseif (!empty($q['q']) && !preg_match('/^-?\d+\.\d+,\s*-?\d+\.\d+$/', $q['q'])) $out['name'] = trim(preg_replace('/^place_id:\S+/', '', (string) $q['q']));
    elseif (!empty($q['query'])) $out['name'] = trim((string) $q['query']);
    // Google adds invisible text-direction marks around names (e.g. Arabic ones): drop them.
    if ($out['name'] !== null) $out['name'] = trim(preg_replace('/[\x{200E}\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', '', $out['name']));
    return $out;
}

// The map that shows the found business: Google's official place map when a browser key for the Maps Embed
// API is set ('google_maps_embed_key', restricted to this website), otherwise a plain map with a pin.
$embed = trim((string) (cfg('google_maps_embed_key') ?? ''));
if ($key === '' && !isset($_GET['url'])) json_out(['ok' => false, 'search' => false, 'embedKey' => $embed]);
if (!isset($_GET['q']) && !isset($_GET['url']) && !isset($_GET['id'])) json_out(['ok' => true, 'search' => true, 'embedKey' => $embed]);
// A few lookups per visitor (Google bills them beyond the free monthly allowance).
if (too_many_attempts('places', 30, 3600)) fail('Too many lookups. Try again in a while, or paste the review link from your Business Profile.', 429);
record_attempt('places');

if (isset($_GET['q'])) {
    $q = trim(str_in($_GET['q'], 120));
    json_out(['ok' => true, 'places' => mb_strlen($q) < 3 ? [] : places_search($q, $key)]);
}

if (isset($_GET['id'])) {
    $p = place_details(trim(str_in($_GET['id'], 300)), $key);
    if (!$p) fail('Google doesn’t know that Place ID. Check it, or paste your Google Maps link instead.', 404);
    json_out(['ok' => true, 'status' => 'verified', 'place' => $p]);
}

// Any Google Maps link → the exact business.
$url = trim(str_in($_GET['url'], 2000));
if (!preg_match('~^https?://~i', $url)) $url = 'https://' . $url;
// An owner's review link (g.page/r/…/review): check it with Google and find its place for the map.
if ($cid = review_link_cid($url)) {
    $link = cid_review_link($cid);
    json_out(['ok' => true, 'status' => review_link_ok($link, $cid) ? 'review_ok' : 'unverified', 'place' => ['name' => '', 'lat' => null, 'lng' => null, 'cid' => $cid,
        'maps' => 'https://maps.google.com/?cid=' . $cid, 'link' => $link]]);
}
$full = resolve_google_url($url);
$info = parse_maps_url($full);
if ($key === '') {
    // Without a key only a Place ID written in the link can be used, and it can't be checked.
    if ($info['placeId']) json_out(['ok' => true, 'status' => 'unverified', 'place' => ['id' => $info['placeId'], 'name' => $info['name'] ?? '', 'address' => '',
        'link' => 'https://search.google.com/local/writereview?placeid=' . rawurlencode($info['placeId'])]]);
    // The place's number is in the link: its official review link, checked with Google (free, no key).
    if ($info['cid']) {
        $link = cid_review_link($info['cid']);
        json_out(['ok' => true, 'status' => review_link_ok($link, $info['cid']) ? 'review_ok' : 'unverified', 'place' => ['name' => (string) ($info['name'] ?? ''),
            'lat' => $info['lat'], 'lng' => $info['lng'], 'cid' => $info['cid'], 'maps' => 'https://maps.google.com/?cid=' . $info['cid'], 'link' => $link]]);
    }
    // Free mode: what the link tells us (name, location, the place's own Maps page) so the person can see the
    // place on a map, then get the review link from their Business Profile or Google's free Place ID Finder.
    json_out(['ok' => true, 'status' => 'need_link', 'place' => ['name' => (string) ($info['name'] ?? ''), 'lat' => $info['lat'], 'lng' => $info['lng'],
        'maps' => $info['cid'] ? 'https://maps.google.com/?cid=' . $info['cid'] : ($info['name'] ? 'https://www.google.com/maps/search/?api=1&query=' . rawurlencode($info['name']) : '')]]);
}

// 1. A Place ID in the link: checked with Google.
if ($info['placeId'] && ($p = place_details($info['placeId'], $key))) json_out(['ok' => true, 'status' => 'verified', 'how' => 'id', 'place' => $p]);
if (!$info['name']) fail('We couldn’t find the business name in that link. Open the business on Google Maps, tap Share, and paste that link.', 422);

// 2. Search by name around the link's location, then match the exact place.
$near = $info['lat'] !== null ? [$info['lat'], $info['lng']] : null;
$found = places_search($info['name'], $key, $near);
if ($info['cid']) foreach ($found as $p) if ($p['cid'] !== '' && $p['cid'] === $info['cid']) json_out(['ok' => true, 'status' => 'verified', 'how' => 'cid', 'place' => $p]);
$good = array_values(array_filter($found, function ($p) use ($info, $near) {
    if (name_match($info['name'], $p['name']) < 0.6) return false;
    return !$near || ($p['lat'] !== null && metres($near[0], $near[1], (float) $p['lat'], (float) $p['lng']) <= 150);
}));
if (count($good) === 1 && $near) json_out(['ok' => true, 'status' => 'verified', 'how' => 'location', 'place' => $good[0]]);
// Not certain (no coordinates in the link, or several branches close by): let the person pick.
$list = $good ?: array_slice($found, 0, 5);
if ($info['cid'] && !$good) {
    $link = cid_review_link($info['cid']);
    if (review_link_ok($link, $info['cid'])) json_out(['ok' => true, 'status' => 'review_ok', 'place' => ['name' => (string) $info['name'], 'lat' => $info['lat'], 'lng' => $info['lng'], 'cid' => $info['cid'], 'maps' => 'https://maps.google.com/?cid=' . $info['cid'], 'link' => $link]]);
}
if (!$list) fail('Google didn’t find this business. Paste the review link from your Business Profile instead.', 404);
json_out(['ok' => true, 'status' => 'choose', 'places' => $list]);
