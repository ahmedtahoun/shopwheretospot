<?php
// A chat file for Meta to fetch when the team sends it on Instagram or Messenger (they take files by link).
// Only with a signature made by api/social.php (sm_file_url), and only for an hour; nothing else in wa-media is reachable.

declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

$rel = (string) ($_GET['f'] ?? '');
$path = wa_media_dir() . '/' . $rel;
if (!sm_file_ok($rel, (int) ($_GET['e'] ?? 0), (string) ($_GET['s'] ?? '')) || !preg_match('#^[\w-]+(/[\w.-]+)+$#', $rel) || !is_file($path)) {
    http_response_code(404);
    exit('Not found');
}
header('Content-Type: ' . ((new finfo(FILEINFO_MIME_TYPE))->file($path) ?: 'application/octet-stream'));
header('Content-Length: ' . filesize($path));
header('Cache-Control: private, no-store');
header('X-Robots-Tag: noindex');
header('X-Content-Type-Options: nosniff');
readfile($path);
