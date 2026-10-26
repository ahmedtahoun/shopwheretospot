<?php
// Category and brand pages for search engines, AI tools and people: /c/<category> and /b/<brand slug>
// (see c/.htaccess, b/.htaccess), English by default and Arabic with ?lang=ar. Server-rendered: intro,
// every product with its price and link, common questions, and matching structured data.

declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

$ar = ($_GET['lang'] ?? '') === 'ar';
$catKey = preg_replace('/[^a-z0-9_-]/', '', (string) ($_GET['c'] ?? ''));
$brandSlug = preg_replace('/[^a-z0-9_-]/', '', (string) ($_GET['b'] ?? ''));
$L = function ($en, $arText) use ($ar) { return $ar ? $arText : $en; };
$e = 'seo_esc';

$page = null;
if ($catKey !== '') {
    foreach (seo_catalog($ar) as $c) if ($c['key'] === $catKey) {
        $t = seo_category_text($c['key'], $c['label'], $c['descr'], $ar);
        $page = ['kind' => 'category', 'name' => $c['label'], 'title' => $t['title'], 'intro' => $t['intro'], 'faq' => $t['faq'], 'products' => $c['products'],
            'url' => seo_category_url($c['key'], $ar), 'en' => seo_category_url($c['key']), 'ar' => seo_category_url($c['key'], true)];
    }
} elseif ($brandSlug !== '') {
    foreach (load_brands(true) as $b) if ($b['slug'] === $brandSlug) {
        $name = $ar && $b['nameAr'] ? $b['nameAr'] : $b['name'];
        $products = array_values(array_filter(seo_products($ar), function ($p) use ($b) { return $p['brandId'] === (int) $b['id']; }));
        $about = trim((string) ($ar && !empty($b['aboutAr']) ? $b['aboutAr'] : ($b['about'] ?? '')));
        $page = ['kind' => 'brand', 'name' => $name, 'title' => $name . ' — ' . $L('official partner', 'شريك رسمي'),
            'intro' => $about !== '' ? $about : (string) ($b['tagline'] ?? ''), 'faq' => [], 'products' => $products, 'logo' => $b['logo'] ?? '',
            'url' => seo_brand_url($b['slug'], $ar), 'en' => seo_brand_url($b['slug']), 'ar' => seo_brand_url($b['slug'], true)];
    }
}

header('Content-Type: text/html; charset=utf-8');
if (!$page) {
    http_response_code(404);
    echo '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Not found</title><p style="font:16px system-ui;text-align:center;margin-top:30vh"><a href="/">Where To Spot</a></p>';
    exit;
}
header('Cache-Control: public, max-age=600');

$desc = mb_substr($page['intro'], 0, 155);
$lowest = $page['products'] ? min(array_map(function ($p) { return (float) $p['low']; }, $page['products'])) : 0;
$highest = $page['products'] ? max(array_map(function ($p) { return (float) $p['high']; }, $page['products'])) : 0;
$crumbs = [['Where To Spot', seo_base() . '/' . ($ar ? '?lang=ar' : '')], [$page['name'], $page['url']]];
$ld = ['@context' => 'https://schema.org', '@graph' => [
    ['@type' => 'CollectionPage', '@id' => $page['url'] . '#page', 'url' => $page['url'], 'name' => $page['title'], 'description' => $page['intro'], 'inLanguage' => $ar ? 'ar' : 'en',
        'isPartOf' => ['@type' => 'WebSite', 'name' => SEO_SITE, 'url' => seo_base() . '/'],
        'mainEntity' => ['@type' => 'ItemList', 'numberOfItems' => count($page['products']), 'itemListElement' => array_map(function ($p, $i) {
            return ['@type' => 'ListItem', 'position' => $i + 1, 'url' => $p['url'], 'name' => $p['title']];
        }, $page['products'], array_keys($page['products']))]],
    ['@type' => 'BreadcrumbList', 'itemListElement' => array_map(function ($c, $i) { return ['@type' => 'ListItem', 'position' => $i + 1, 'name' => $c[0], 'item' => $c[1]]; }, $crumbs, array_keys($crumbs))],
]];
if ($page['faq']) $ld['@graph'][] = ['@type' => 'FAQPage', 'mainEntity' => array_map(function ($q) { return ['@type' => 'Question', 'name' => $q[0], 'acceptedAnswer' => ['@type' => 'Answer', 'text' => $q[1]]]; }, $page['faq'])];

$price = function ($p) use ($ar) { return seo_price_text($p, $ar); };
$img = function ($p) { $src = $p['images'][0] ?? ''; return $src ? '/api/img.php?src=' . rawurlencode(is_array($src) ? $src['path'] : $src) . '&w=600' : ''; };
?><!doctype html>
<html lang="<?= $ar ? 'ar' : 'en' ?>"<?= $ar ? ' dir="rtl"' : '' ?>>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= $e($page['title']) ?> | Where To Spot</title>
<meta name="description" content="<?= $e($desc) ?>">
<link rel="canonical" href="<?= $e($page['url']) ?>">
<link rel="alternate" hreflang="en" href="<?= $e($page['en']) ?>">
<link rel="alternate" hreflang="ar" href="<?= $e($page['ar']) ?>">
<link rel="alternate" hreflang="x-default" href="<?= $e($page['en']) ?>">
<meta property="og:type" content="website"><meta property="og:site_name" content="Where To Spot">
<meta property="og:title" content="<?= $e($page['title']) ?>"><meta property="og:description" content="<?= $e($desc) ?>"><meta property="og:url" content="<?= $e($page['url']) ?>">
<meta property="og:image" content="<?= $e($page['products'][0]['imageUrls'][0] ?? seo_base() . '/images/share-card.jpg') ?>"><meta property="og:locale" content="<?= $ar ? 'ar_EG' : 'en_US' ?>">
<link rel="icon" href="/favicon.ico?v=3" sizes="48x48"><link rel="icon" type="image/png" sizes="192x192" href="/images/favicon-192.png?v=3">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Work+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/site.css">
<meta name="theme-color" content="#22201D">
<script type="application/ld+json"><?= json_encode($ld, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) ?></script>
<style>
  main.wide{max-width:1100px}
  .crumbs{font-size:13px;color:#8A8478}.crumbs a{color:#6B6660;text-decoration:none}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin:26px 0}
  .pc{background:#fff;border:1px solid #DDD6CC;border-radius:16px;overflow:hidden;text-decoration:none;color:#22201D;display:flex;flex-direction:column}
  .pc:hover{border-color:#A8552F}
  .pc .im{aspect-ratio:1;background:#F6F2EC;display:grid;place-items:center}.pc img{width:100%;height:100%;object-fit:contain}
  .pc .tx{padding:14px;display:flex;flex-direction:column;gap:4px}
  .pc h3{font-size:15.5px;line-height:1.35;margin:0;font-family:'Work Sans',sans-serif;font-weight:600}.pc .pr{color:#A8552F;font-weight:700}.pc small{color:#6B6660;font-size:13px}
  .facts{display:flex;gap:10px 22px;flex-wrap:wrap;font-size:14px;color:#3E3A35;margin:12px 0 0;padding:0;list-style:none}
  html[lang=ar] body{line-height:1.85}
</style>
</head>
<body>
<div class="bar"><?= $L('All prices in Egyptian Pounds (EGP) · Delivery across Egypt · Cash on delivery', 'كل الأسعار بالجنيه المصري · توصيل لكل مصر · الدفع عند الاستلام') ?></div>
<nav><div class="in"><a class="brand" href="/<?= $ar ? '?lang=ar' : '' ?>"><img src="/images/logo-mark.png?v=3" alt="Where To Spot logo" width="40" height="40">Where To Spot</a><div class="links"><a href="/<?= $ar ? '?lang=ar' : '' ?>"><?= $L('Shop', 'المتجر') ?></a><a href="/plans.html"><?= $L('Marketing plans', 'خطط التسويق') ?></a><a href="/google-review-link.html<?= $ar ? '?lang=ar' : '' ?>"><?= $L('Free review link', 'رابط تقييم مجاني') ?></a><a href="/about.html"><?= $L('About us', 'من نحن') ?></a><a href="/contact.html"><?= $L('Contact us', 'تواصل معنا') ?></a><a href="<?= $e($ar ? $page['en'] : $page['ar']) ?>" hreflang="<?= $ar ? 'en' : 'ar' ?>"><?= $ar ? 'English' : 'العربية' ?></a></div></div></nav>
<main class="wide">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/<?= $ar ? '?lang=ar' : '' ?>">Where To Spot</a> › <span aria-current="page"><?= $e($page['name']) ?></span></nav>
<?php if (!empty($page['logo'])): ?><img src="/<?= $e($page['logo']) ?>" alt="<?= $e($page['name']) ?>" width="72" height="72" style="border-radius:50%;margin-top:18px;object-fit:contain;background:#fff"><?php endif; ?>
<h1><?= $e($page['title']) ?></h1>
<p><?= $e($page['intro']) ?></p>
<ul class="facts">
<?php if ($page['products']): ?><li>✓ <?= count($page['products']) ?> <?= $L('products', 'منتج') ?> · <?= $L('from', 'من') ?> <?= $ar ? number_format($lowest) . ' ج.م' : 'EGP ' . number_format($lowest) ?></li><?php endif; ?>
<li>✓ <?= $L('Delivery across Egypt in 2–5 days', 'توصيل لكل مصر خلال 2–5 أيام') ?></li><li>✓ <?= $L('Cash on delivery, card or wallet', 'الدفع عند الاستلام أو بالبطاقة أو المحفظة') ?></li><li>✓ <?= $L('14-day returns', 'استرجاع خلال 14 يوم') ?></li>
</ul>
<h2><?= $L('Products', 'المنتجات') ?></h2>
<div class="grid">
<?php foreach ($page['products'] as $p): ?>
<a class="pc" href="<?= $e($p['url']) ?>"><span class="im"><?php if ($img($p)): ?><img src="<?= $e($img($p)) ?>" alt="<?= $e($p['title']) ?>" loading="lazy" width="300" height="300"><?php endif; ?></span>
<span class="tx"><h3><?= $e($p['title']) ?></h3><span class="pr"><?= $e($price($p)) ?></span><?php if ($p['summary']): ?><small><?= $e($p['summary']) ?></small><?php endif; ?><?php if (!$p['inStock']): ?><small><?= $L('Out of stock', 'غير متوفر حاليًا') ?></small><?php endif; ?></span></a>
<?php endforeach; ?>
</div>
<?php if ($page['faq']): ?>
<h2><?= $L('Questions', 'أسئلة شائعة') ?></h2>
<?php foreach ($page['faq'] as $q): ?><details><summary><?= $e($q[0]) ?></summary><p><?= $e($q[1]) ?></p></details><?php endforeach; ?>
<?php endif; ?>
<?php if ($page['kind'] === 'category' && in_array($catKey, ['nfc', 'stands'], true)): ?>
<p><a class="btn alt" href="/google-review-link.html<?= $ar ? '?lang=ar' : '' ?>"><?= $L('Free: make your Google review link & QR', 'مجانًا: اعمل رابط تقييم جوجل وكود QR') ?></a></p>
<?php endif; ?>
<p><a class="btn" href="/<?= $ar ? '?lang=ar' : '' ?>#products"><?= $L('Visit the shop', 'زيارة المتجر') ?></a></p>
</main>
<footer><div class="in">
<span>© 2026 Where To Spot · <?= $L('MQR, El Wahat Road, 6th of October City, Giza, Egypt', 'MQR، طريق الواحات، مدينة 6 أكتوبر، الجيزة، مصر') ?> · <a href="mailto:info@wheretospot.com">info@wheretospot.com</a> · <a href="tel:+201277660666">+20 127 766 0666</a></span>
<?php foreach (seo_catalog($ar) as $c): ?><a href="<?= $e(seo_category_url($c['key'], $ar)) ?>"><?= $e($c['label']) ?></a><?php endforeach; ?>
<a href="/about.html"><?= $L('About us', 'من نحن') ?></a><a href="/shipping-policy.html"><?= $L('Delivery & shipping', 'التوصيل') ?></a><a href="/refund-policy.html"><?= $L('Refund & cancellation', 'الاسترجاع') ?></a>
</div></footer>
<script src="/api/track.php" async></script>
<script src="/chat.js" defer></script>
</body>
</html>
