<?php
// /p/<product id> (see p/.htaccess): the normal product page (shop-product.dc.html), with the product's
// title, description, share image, canonical link, Arabic/English alternates and schema.org Product
// data filled in on the server, plus a plain-HTML copy of the product for crawlers and AI tools that
// don't run JavaScript. People get the same interactive page as before.

declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

$id = preg_replace('/[^A-Za-z0-9_-]/', '', (string) ($_GET['id'] ?? ''));
$ar = ($_GET['lang'] ?? '') === 'ar';
$product = null;
foreach (seo_products($ar) as $p) if ($p['id'] === $id) { $product = $p; break; }

$html = (string) file_get_contents(dirname(__DIR__) . '/shop-product.dc.html');
// Plain string replacement (product text may contain "$1"-like sequences that preg_replace would expand).
function replace_once(string $html, string $find, string $with): string
{
    $at = strpos($html, $find);
    return $at === false ? $html : substr_replace($html, $with, $at, strlen($find));
}
// Relative links and scripts in the page must resolve from the site root, not from /p/.
$html = replace_once($html, '<head>', "<head>\n<base href=\"/\">");

if (!$product) {
    http_response_code(404);
    header('Content-Type: text/html; charset=utf-8');
    echo replace_once($html, '<head>', "<head>\n<meta name=\"robots\" content=\"noindex\">");
    exit;
}

// Search title and description: hand-written in the admin, or built from the product (api/seo-lib.php).
$title = $product['seoTitle'];
$desc = $product['seoDesc'];
// The page's language from the first byte, so search engines index the Arabic page as Arabic.
$html = replace_once($html, '<html>', $ar ? '<html lang="ar" dir="rtl">' : '<html lang="en" dir="ltr">');
$image = $product['imageUrls'][0] ?? seo_abs('images/share-card.jpg');

// Link-preview bots (WhatsApp, Facebook…) get only the preview tags, so the card shows up in time.
require __DIR__ . '/share-page.php';
if (share_is_preview_bot()) {
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: public, max-age=300');
    echo share_card_html($title, $desc, $image, $product['url'], $ar ? 'ar' : 'en');
    exit;
}

$meta = function (string $html, string $attr, string $key, string $value): string {
    $pattern = '/<meta ' . $attr . '="' . preg_quote($key, '/') . '" content="[^"]*">/';
    $tag = '<meta ' . $attr . '="' . $key . '" content="' . seo_esc($value) . '">';
    return preg_match($pattern, $html) ? preg_replace_callback($pattern, function () use ($tag) { return $tag; }, $html, 1) : replace_once($html, '</head>', $tag . "\n</head>");
};
$html = preg_replace_callback('/<title>.*?<\/title>/s', function () use ($title) { return '<title>' . seo_esc($title) . '</title>'; }, $html, 1);
foreach (['description' => $desc, 'twitter:title' => $title, 'twitter:description' => $desc, 'twitter:image' => $image] as $k => $v) $html = $meta($html, 'name', $k, $v);
foreach (['og:title' => $title, 'og:description' => $desc, 'og:image' => $image, 'og:type' => 'product', 'og:url' => $product['url'], 'og:locale' => $ar ? 'ar_EG' : 'en_US'] as $k => $v) $html = $meta($html, 'property', $k, $v);
$html = preg_replace('/<meta property="og:image:(width|height)" content="[^"]*">\s*/', '', $html);

$breadcrumbs = ['@context' => 'https://schema.org', '@type' => 'BreadcrumbList', 'itemListElement' => [
    ['@type' => 'ListItem', 'position' => 1, 'name' => SEO_SITE, 'item' => seo_base() . '/'],
    ['@type' => 'ListItem', 'position' => 2, 'name' => $product['catLabel'], 'item' => seo_base() . '/#products'],
    ['@type' => 'ListItem', 'position' => 3, 'name' => $product['title'], 'item' => $product['url']],
]];
$json = function ($d) { return '<script type="application/ld+json">' . json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) . '</script>'; };
$head = '<link rel="canonical" href="' . seo_esc($product['url']) . '">' . "\n" .
    '<link rel="alternate" hreflang="en" href="' . seo_esc(seo_product_url($id)) . '">' . "\n" .
    '<link rel="alternate" hreflang="ar" href="' . seo_esc(seo_product_url($id, true)) . '">' . "\n" .
    '<link rel="alternate" hreflang="x-default" href="' . seo_esc(seo_product_url($id)) . '">' . "\n" .
    $json(seo_product_jsonld($product)) . "\n" . $json($breadcrumbs) . "\n" .
    // The plain copy below is for crawlers; people with JavaScript get the interactive page instead.
    '<script>document.documentElement.className += " js";</script><style>.js #seo-product{display:none}</style>' . "\n";
$html = replace_once($html, '</head>', $head . '</head>');

$sizes = '';
if (count($product['sizes']) > 1) {
    $sizes = '<ul>' . implode('', array_map(function ($s) use ($ar) {
        return '<li>' . seo_esc($s['label']) . ': ' . seo_esc($ar ? number_format($s['price']) . ' ج.م' : 'EGP ' . number_format($s['price'])) . ($s['stock'] > 0 ? '' : ($ar ? ' (نفد)' : ' (sold out)')) . '</li>';
    }, $product['sizes'])) . '</ul>';
}
// Features are written in English; the Arabic description carries the same facts.
$features = $product['features'] && !$ar ? '<ul>' . implode('', array_map(function ($f) { return '<li>' . seo_esc($f) . '</li>'; }, $product['features'])) . '</ul>' : '';
$static = '<article id="seo-product" style="max-width:760px;margin:24px auto;padding:0 20px;font-family:system-ui,sans-serif;line-height:1.6">' .
    '<p><a href="/">' . SEO_SITE . '</a> › <a href="/#products">' . seo_esc($product['catLabel']) . '</a></p>' .
    '<h1>' . seo_esc($product['title']) . '</h1>' .
    ($product['partner'] ? '<p>' . ($ar ? 'من ' : 'By ') . seo_esc($product['brand']) . ($ar ? ' — شريك رسمي، منتجات أصلية من العلامة مباشرة.' : ' — official partner; original products supplied directly by the brand.') . '</p>' : '') .
    ($product['imageUrls'] ? '<img src="' . seo_esc($product['imageUrls'][0]) . '" alt="' . seo_esc($product['title'] . ($product['brand'] !== SEO_SITE ? ' – ' . $product['brand'] : '')) . '" width="480" style="max-width:100%;height:auto">' : '') .
    '<p><strong>' . seo_esc(seo_price_text($product, $ar)) . '</strong> · ' . ($product['inStock'] ? ($ar ? 'متوفر' : 'In stock') : ($ar ? 'غير متوفر حاليًا' : 'Out of stock')) . '</p>' . $sizes .
    ($product['summary'] ? '<p>' . seo_esc($product['summary']) . '</p>' : '') . ($product['text'] ? '<p>' . nl2br(seo_esc($product['text'])) . '</p>' : '') . $features .
    '<p>' . ($ar ? 'توصيل لكل مصر خلال 2–5 أيام · الدفع عند الاستلام أو بالبطاقة أو المحفظة · استرجاع خلال 14 يوم.' : 'Delivery across Egypt in 2–5 days · cash on delivery, card or mobile wallet · 14-day returns.') .
    ' <a href="/shipping-policy.html">' . ($ar ? 'التوصيل' : 'Delivery') . '</a> · <a href="/refund-policy.html">' . ($ar ? 'الاسترجاع' : 'Returns') . '</a></p></article>';
$html = replace_once($html, '<body>', "<body>\n" . $static);

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: public, max-age=300');
echo $html;
