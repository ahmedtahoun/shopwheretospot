<?php
// Business search for the free review-link tool (google-review-link.html): name → matching Google places
// with their Place ID, which makes the direct "write a review" link. Uses Google Places API (New) with
// 'google_places_key' from api/config.local.php; without a key the tool still works by pasting a link.
//   GET api/places.php?q=<business name and area>

declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

$key = trim((string) (cfg('google_places_key') ?? ''));
$q = trim(str_in($_GET['q'] ?? '', 120));
if ($key === '') json_out(['ok' => false, 'search' => false]);
if (mb_strlen($q) < 3) json_out(['ok' => true, 'search' => true, 'places' => []]);
// A few searches per visitor (Google bills each one beyond the free monthly allowance).
if (too_many_attempts('places', 30, 3600)) fail('Too many searches. Try again in a while, or paste your Google Maps link instead.', 429);
record_attempt('places');

$ch = curl_init('https://places.googleapis.com/v1/places:searchText');
curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'X-Goog-Api-Key: ' . $key,
        'X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount'],
    CURLOPT_POSTFIELDS => json_encode(['textQuery' => $q, 'regionCode' => 'EG', 'languageCode' => preg_match('/\p{Arabic}/u', $q) ? 'ar' : 'en', 'pageSize' => 6], JSON_UNESCAPED_UNICODE)]);
$raw = curl_exec($ch);
$res = json_decode((string) $raw, true);
if (!is_array($res) || isset($res['error'])) {
    error_log('[shop] places search: ' . substr((string) $raw, 0, 300));
    fail('Search isn’t working right now. Paste your Google Maps link instead.', 502);
}
json_out(['ok' => true, 'search' => true, 'places' => array_map(function ($p) {
    return ['id' => (string) $p['id'], 'name' => (string) ($p['displayName']['text'] ?? ''), 'address' => (string) ($p['formattedAddress'] ?? ''),
        'rating' => isset($p['rating']) ? (float) $p['rating'] : null, 'reviews' => (int) ($p['userRatingCount'] ?? 0)];
}, (array) ($res['places'] ?? []))]);
