<?php
// A business page made with the review-link tool (/r/<slug>, see api/qrtool.php): logo, name, a big
// "Review us on Google" button, then the owner's links (WhatsApp, Instagram, Facebook, location…).
// Kept out of search results (noindex): each one is a small page for that business's own customers.

declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

$slug = (string) ($_GET['slug'] ?? '');
$st = db()->prepare('SELECT * FROM qr_businesses WHERE slug = ?');
$st->execute([$slug]);
$row = preg_match('/^[a-z0-9-]{3,80}$/', $slug) ? $st->fetch() : null;
$e = function ($s) { return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); };
header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex, follow');
if (!$row) { http_response_code(404); echo '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found</title><p style="font:16px system-ui;text-align:center;margin-top:30vh">This page doesn’t exist. · الصفحة غير موجودة.</p>'; exit; }

// Count real visits (not link-preview bots).
require __DIR__ . '/share-page.php';
if (!share_is_preview_bot()) db()->prepare('UPDATE qr_businesses SET views = views + 1 WHERE id = ?')->execute([$row['id']]);

$b = qr_business_out($row);
$p = $b['page'];
$ar = $p['lang'] === 'ar';
$L = function ($en, $arText) use ($ar) { return $ar ? $arText : $en; };
$labels = ['whatsapp' => ['WhatsApp', 'واتساب'], 'phone' => ['Call us', 'اتصل بنا'], 'instagram' => ['Instagram', 'إنستجرام'], 'facebook' => ['Facebook', 'فيسبوك'],
    'tiktok' => ['TikTok', 'تيك توك'], 'website' => ['Website', 'الموقع'], 'menu' => ['Menu', 'المنيو'], 'location' => ['Location', 'الموقع على الخريطة'], 'email' => ['Email', 'البريد'], 'custom' => ['Link', 'رابط']];
$icons = [
    'whatsapp' => '<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z"/><path d="M8.5 8.7c.2-.5.5-.6.8-.6h.6c.2 0 .4 0 .5.4l.7 1.7c.1.2 0 .4-.1.6l-.5.6c.6 1.1 1.5 2 2.6 2.6l.6-.5c.2-.2.4-.2.6-.1l1.7.7c.3.1.4.3.4.5v.6c0 .3-.1.6-.6.8-.6.3-1.7.4-3.4-.5a9 9 0 0 1-3.4-3.4c-.9-1.7-.8-2.8-.5-3.4Z"/>',
    'phone' => '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
    'instagram' => '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/>',
    'facebook' => '<path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8Z"/>',
    'tiktok' => '<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.5 2.5 2.3 4.2 5 4.5"/>',
    'website' => '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    'menu' => '<path d="M6 3v8a2 2 0 0 0 4 0V3M8 11v10M16 3c-1.5 1.5-2 4-2 6 0 1.5 1 2 2 2v10"/>',
    'location' => '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/>',
    'email' => '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    'custom' => '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
];
$links = '';
foreach ($p['links'] as $l) {
    $href = qr_link_href($l);
    if ($href === '') continue;
    $text = $l['label'] !== '' ? $l['label'] : $labels[$l['type']][$ar ? 1 : 0];
    $links .= '<a class="lk" href="' . $e($href) . '" target="_blank" rel="noopener nofollow"><svg viewBox="0 0 24 24" aria-hidden="true">' . $icons[$l['type']] . '</svg><span>' . $e($text) . '</span></a>';
}
$name = $b['name'] !== '' ? $b['name'] : $L('Our business', 'نشاطنا');
$color = $p['color'];
$initial = mb_strtoupper(mb_substr(trim($name), 0, 1));
?><!doctype html>
<html lang="<?= $ar ? 'ar' : 'en' ?>"<?= $ar ? ' dir="rtl"' : '' ?>>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, follow">
<title><?= $e($name) ?></title>
<meta name="description" content="<?= $e($p['tagline'] ?: $L('Review us on Google and find all our links.', 'قيّمنا على جوجل وكل روابطنا في مكان واحد.')) ?>">
<meta property="og:title" content="<?= $e($name) ?>">
<meta property="og:description" content="<?= $e($p['tagline'] ?: $L('Review us on Google', 'قيّمنا على جوجل')) ?>">
<?php if ($p['logo']): ?><meta property="og:image" content="<?= $e(rtrim((string) cfg('site_url'), '/') . '/' . $p['logo']) ?>"><?php endif; ?>
<meta name="theme-color" content="<?= $e($color) ?>">
<link rel="icon" href="/favicon.ico?v=3">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;600;700&family=Cairo:wght@600;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:linear-gradient(180deg,<?= $e($color) ?> 0 190px,#F7F3ED 190px);font-family:<?= $ar ? "'Cairo'," : '' ?>'Work Sans',system-ui,sans-serif;color:#22201D;display:flex;justify-content:center;padding:28px 16px 40px}
  .c{width:100%;max-width:440px;display:flex;flex-direction:column;align-items:center;gap:14px}
  .logo{width:112px;height:112px;border-radius:50%;background:#fff;box-shadow:0 6px 20px rgba(0,0,0,.15);display:grid;place-items:center;overflow:hidden;font-size:44px;font-weight:700;color:<?= $e($color) ?>;border:4px solid #fff}
  .logo img{width:100%;height:100%;object-fit:contain}
  h1{margin:6px 0 0;font-size:26px;text-align:center;line-height:1.25}
  .tag{margin:0;color:#6B6660;text-align:center;font-size:15px}
  .review{width:100%;display:flex;flex-direction:column;align-items:center;gap:2px;background:<?= $e($color) ?>;color:#fff;text-decoration:none;border-radius:18px;padding:18px;margin-top:8px;box-shadow:0 8px 20px rgba(0,0,0,.14);font-weight:700;font-size:19px}
  .review small{font-weight:400;font-size:13.5px;opacity:.9}
  .stars{color:#FFD24A;font-size:22px;letter-spacing:3px}
  .lk{width:100%;display:flex;align-items:center;gap:12px;background:#fff;border:1.5px solid #E7E1D8;border-radius:14px;padding:14px 16px;color:#22201D;text-decoration:none;font-weight:600;font-size:16px}
  .lk:hover{border-color:<?= $e($color) ?>}
  .lk svg{width:22px;height:22px;flex:none;fill:none;stroke:<?= $e($color) ?>;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .made{margin-top:18px;font-size:12.5px;color:#8A8478;text-decoration:none}
  .made b{color:#A8552F}
</style>
</head>
<body>
<main class="c">
  <div class="logo"><?= $p['logo'] ? '<img src="/' . $e($p['logo']) . '" alt="' . $e($name) . '">' : $e($initial) ?></div>
  <h1><?= $e($name) ?></h1>
  <?php if ($p['tagline']): ?><p class="tag"><?= $e($p['tagline']) ?></p><?php endif; ?>
  <a class="review" href="<?= $e($b['link']) ?>" rel="noopener"><span class="stars">★★★★★</span><?= $e($L('Review us on Google', 'قيّمنا على جوجل')) ?><small><?= $e($L('It takes 10 seconds and helps us a lot', 'بتاخد 10 ثواني وبتفرق معانا جدًا')) ?></small></a>
  <?= $links ?>
  <a class="made" href="<?= $e(rtrim((string) cfg('site_url'), '/')) ?>/google-review-link.html"><?= $e($L('Made free with', 'معمولة مجانًا مع')) ?> <b>Where To Spot</b></a>
</main>
</body>
</html>
