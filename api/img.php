<?php
// Serve product photos at the size they are shown: api/img.php?src=images/x.png&w=300
// Resized copies are generated once (WebP when the server supports it, otherwise JPEG/PNG),
// stored in uploads/thumbs/, and cached by browsers for a year. The originals are untouched.

declare(strict_types=1);

const IMG_WIDTHS = [120, 300, 600, 1000];

$src = (string) ($_GET['src'] ?? '');
$w = (int) ($_GET['w'] ?? 300);
$root = dirname(__DIR__);

// Only photos inside images/ or uploads/products/; no "..", no other folders.
if (!preg_match('#^(images|uploads/products)/[A-Za-z0-9 _./-]+\.(png|jpe?g|webp)$#i', $src) || strpos($src, '..') !== false) {
    http_response_code(404);
    exit;
}
$file = realpath($root . '/' . $src);
if (!$file || strpos($file, realpath($root)) !== 0 || !is_file($file)) {
    http_response_code(404);
    exit;
}
$maxW = max(IMG_WIDTHS);
foreach (IMG_WIDTHS as $allowed) { if ($w <= $allowed) { $w = $allowed; break; } }
if ($w > $maxW) $w = $maxW;

$accept = $_SERVER['HTTP_ACCEPT'] ?? '';
$webp = function_exists('imagewebp') && strpos($accept, 'image/webp') !== false;
$info = @getimagesize($file);
if (!$info) { http_response_code(404); exit; }
[$ow, $oh] = $info;
$mime = $info['mime'];
$alpha = $mime === 'image/png' || $mime === 'image/webp';
$ext = $webp ? 'webp' : ($alpha ? 'png' : 'jpg');

$cacheDir = $root . '/uploads/thumbs';
$cacheFile = $cacheDir . '/' . sha1($src . '|' . filemtime($file)) . '-' . $w . '.' . $ext;
$types = ['webp' => 'image/webp', 'png' => 'image/png', 'jpg' => 'image/jpeg'];

$send = function (string $path, string $type) {
    $etag = '"' . md5($path . filemtime($path)) . '"';
    header('Content-Type: ' . $type);
    header('Cache-Control: public, max-age=31536000, immutable');
    header('Vary: Accept');
    header('ETag: ' . $etag);
    if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); exit; }
    header('Content-Length: ' . filesize($path));
    readfile($path);
    exit;
};

if (is_file($cacheFile)) $send($cacheFile, $types[$ext]);

// Small originals, or no GD: send the original as is.
if (!function_exists('imagecreatetruecolor') || $ow <= $w) $send($file, $mime);

$load = ['image/png' => 'imagecreatefrompng', 'image/jpeg' => 'imagecreatefromjpeg', 'image/webp' => 'imagecreatefromwebp'][$mime] ?? null;
if (!$load || !function_exists($load) || !($im = @$load($file))) $send($file, $mime);

$nh = (int) round($oh * $w / $ow);
$out = imagecreatetruecolor($w, $nh);
if ($alpha) {
    imagealphablending($out, false);
    imagesavealpha($out, true);
    imagefill($out, 0, 0, imagecolorallocatealpha($out, 0, 0, 0, 127));
}
imagecopyresampled($out, $im, 0, 0, 0, 0, $w, $nh, $ow, $oh);
if (!is_dir($cacheDir)) @mkdir($cacheDir, 0755, true);
$tmp = $cacheFile . '.' . bin2hex(random_bytes(4));
$ok = $ext === 'webp' ? imagewebp($out, $tmp, 80) : ($ext === 'png' ? imagepng($out, $tmp, 7) : imagejpeg($out, $tmp, 82));
imagedestroy($im);
imagedestroy($out);
if ($ok && @rename($tmp, $cacheFile)) $send($cacheFile, $types[$ext]);
@unlink($tmp);
$send($file, $mime);
