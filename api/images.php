<?php
// Product photos: checked, renamed, shrunk and saved in uploads/products (shared by the dashboard and the
// public "Sell with us" form).

declare(strict_types=1);

function store_image(array $f, string $pid): string
{
    if ($f['size'] > cfg('max_upload_bytes')) fail('Photo is too large (max ' . (cfg('max_upload_bytes') >> 20) . ' MB).');
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
    $exts = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    if (!isset($exts[$mime]) || !@getimagesize($f['tmp_name'])) fail('Only JPG, PNG or WebP photos are allowed.');
    $dir = cfg('upload_dir');
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $safe = preg_replace('/[^a-z0-9]/', '', strtolower($pid)) ?: 'p';
    $name = $safe . '-' . bin2hex(random_bytes(6)) . '.' . $exts[$mime];
    $dest = $dir . '/' . $name;
    if (!resize_image($f['tmp_name'], $dest, $mime, 1600) && !move_uploaded_file($f['tmp_name'], $dest)) {
        fail('Could not save the photo on the server.', 500);
    }
    @chmod($dest, 0644);
    return cfg('upload_url') . '/' . $name;
}

// Shrink big photos so the shop loads fast. Returns false when GD can't handle it (the original is kept).
function resize_image(string $src, string $dest, string $mime, int $max): bool
{
    if (!function_exists('imagecreatetruecolor')) return false;
    [$w, $h] = getimagesize($src);
    if ($w <= $max && $h <= $max) return false;
    $load = ['image/jpeg' => 'imagecreatefromjpeg', 'image/png' => 'imagecreatefrompng', 'image/webp' => 'imagecreatefromwebp'][$mime];
    if (!function_exists($load) || !($im = @$load($src))) return false;
    $scale = $max / max($w, $h);
    $nw = (int) round($w * $scale);
    $nh = (int) round($h * $scale);
    $out = imagecreatetruecolor($nw, $nh);
    imagealphablending($out, false);
    imagesavealpha($out, true);
    imagecopyresampled($out, $im, 0, 0, 0, 0, $nw, $nh, $w, $h);
    $ok = $mime === 'image/png' ? imagepng($out, $dest, 6) : ($mime === 'image/webp' ? imagewebp($out, $dest, 82) : imagejpeg($out, $dest, 82));
    return $ok;
}

// Only files we uploaded are deleted; the original catalog photos in images/ are left alone.
function delete_upload(string $path): void
{
    $prefix = cfg('upload_url') . '/';
    if (strpos($path, $prefix) !== 0) return;
    $file = cfg('upload_dir') . '/' . basename($path);
    if (is_file($file)) @unlink($file);
}
