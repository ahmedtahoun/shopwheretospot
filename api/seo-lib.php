<?php
// Search engines and AI assistants (Google, ChatGPT, Claude, Perplexity…) mostly read a page's HTML
// without running its JavaScript, so the shop's product pages are also served as ready-made HTML at
// /p/<product id>, with Product structured data (schema.org JSON-LD). This file builds that, plus the
// sitemap, a Google Merchant product feed and llms.txt (a plain summary of the shop for AI tools).

const SEO_SITE = 'Where To Spot';

function seo_base(): string { return rtrim((string) cfg('site_url'), '/'); }
function seo_esc($s): string { return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function seo_product_url(string $id, bool $ar = false): string { return seo_base() . '/p/' . rawurlencode($id) . ($ar ? '?lang=ar' : ''); }
function seo_abs(string $path): string { return preg_match('~^https?://~', $path) ? $path : seo_base() . '/' . ltrim($path, '/'); }

// Active products with what the public pages need, in English or Arabic.
function seo_products(bool $ar = false): array
{
    $cats = [];
    foreach (db()->query('SELECT key, label, label_ar FROM categories') as $c) $cats[$c['key']] = $ar && $c['label_ar'] ? $c['label_ar'] : $c['label'];
    $brands = [];
    foreach (load_brands(false) as $b) $brands[$b['id']] = $b;
    $out = [];
    foreach (load_products(true) as $p) {
        $b = $p['brandId'] ? ($brands[$p['brandId']] ?? null) : null;
        $sizes = [];
        foreach ($p['variants'] as $v) {
            $price = (float) ($v['price'] ?: $p['price']);
            if ($p['discountPct']) $price = round($price * (1 - $p['discountPct'] / 100), 2);
            $sizes[] = ['label' => $v['label'], 'price' => $price, 'stock' => (int) $v['stock'], 'sku' => $v['sku'] ?? ''];
        }
        $sale = $p['discountPct'] ? round($p['price'] * (1 - $p['discountPct'] / 100), 2) : (float) $p['price'];
        $out[] = $p + [
            'title' => $ar && $p['nameAr'] ? $p['nameAr'] : $p['name'],
            'summary' => $ar && $p['subAr'] ? $p['subAr'] : (string) $p['sub'],
            'text' => $ar && $p['descAr'] ? $p['descAr'] : (string) $p['desc'],
            'catLabel' => $cats[$p['cat']] ?? $p['cat'],
            'brand' => $b ? ($ar && $b['nameAr'] ? $b['nameAr'] : $b['name']) : ((string) $p['vendor'] ?: SEO_SITE),
            'partner' => (bool) $b,
            'sizes' => $sizes,
            'low' => $sizes ? min(array_column($sizes, 'price')) : $sale,
            'high' => $sizes ? max(array_column($sizes, 'price')) : $sale,
            'inStock' => $p['cat'] === 'services' || ($sizes ? array_sum(array_column($sizes, 'stock')) > 0 : $p['stock'] > 0),
            'imageUrls' => array_map('seo_abs', $p['images']),
            'url' => seo_product_url($p['id'], $ar),
        ];
    }
    return $out;
}

// schema.org Product for one product (Google rich results; read by AI assistants too).
function seo_product_jsonld(array $p): array
{
    $avail = $p['inStock'] ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';
    $seller = ['@type' => 'Organization', 'name' => SEO_SITE, 'url' => seo_base()];
    $shipping = [
        '@type' => 'OfferShippingDetails',
        'shippingRate' => ['@type' => 'MonetaryAmount', 'value' => (float) cfg('shipping_fee'), 'currency' => 'EGP'],
        'shippingDestination' => ['@type' => 'DefinedRegion', 'addressCountry' => 'EG'],
        'deliveryTime' => ['@type' => 'ShippingDeliveryTime',
            'handlingTime' => ['@type' => 'QuantitativeValue', 'minValue' => 0, 'maxValue' => 2, 'unitCode' => 'DAY'],
            'transitTime' => ['@type' => 'QuantitativeValue', 'minValue' => 1, 'maxValue' => 5, 'unitCode' => 'DAY']],
    ];
    $returns = ['@type' => 'MerchantReturnPolicy', 'applicableCountry' => 'EG', 'returnPolicyCategory' => 'https://schema.org/MerchantReturnFiniteReturnWindow',
        'merchantReturnDays' => 14, 'returnMethod' => 'https://schema.org/ReturnByMail', 'returnFees' => 'https://schema.org/ReturnFeesCustomerResponsibility'];
    $offer = function (float $price, string $name = '', string $sku = '') use ($p, $avail, $seller, $shipping, $returns) {
        return array_filter(['@type' => 'Offer', 'name' => $name ?: null, 'sku' => $sku ?: null, 'price' => $price, 'priceCurrency' => 'EGP',
            'availability' => $avail, 'itemCondition' => 'https://schema.org/NewCondition', 'url' => $p['url'], 'seller' => $seller,
            'shippingDetails' => $shipping, 'hasMerchantReturnPolicy' => $returns]);
    };
    $data = [
        '@context' => 'https://schema.org', '@type' => 'Product', 'name' => $p['title'], 'description' => trim($p['text'] ?: $p['summary']),
        'sku' => $p['sku'] ?: $p['id'], 'image' => $p['imageUrls'] ?: [seo_abs('images/og-share.png')], 'category' => $p['catLabel'],
        'brand' => ['@type' => 'Brand', 'name' => $p['brand']], 'url' => $p['url'],
    ];
    if (count($p['sizes']) > 1) {
        $data['offers'] = ['@type' => 'AggregateOffer', 'priceCurrency' => 'EGP', 'lowPrice' => $p['low'], 'highPrice' => $p['high'],
            'offerCount' => count($p['sizes']), 'availability' => $avail,
            'offers' => array_map(function ($s) use ($offer, $p) { return $offer($s['price'], $p['title'] . ' — ' . $s['label'], $s['sku']); }, $p['sizes'])];
    } else {
        $data['offers'] = $offer($p['low']);
    }
    return $data;
}

// Plain-text facts used by the static product page, the feed and llms.txt.
function seo_price_text(array $p, bool $ar = false): string
{
    $fmt = function ($n) use ($ar) { return $ar ? number_format($n) . ' ج.م' : 'EGP ' . number_format($n); };
    if (count($p['sizes']) > 1) return implode(' · ', array_map(function ($s) use ($fmt) { return $s['label'] . ': ' . $fmt($s['price']); }, $p['sizes']));
    return $fmt($p['low']) . ($p['cat'] === 'services' ? ($ar ? ' / شهريًا' : ' / month') : '');
}

// The shop's own details (Organization + store), for the home page and llms.txt.
function seo_org_jsonld(): array
{
    return ['@context' => 'https://schema.org', '@type' => 'OnlineStore', 'name' => SEO_SITE, 'url' => seo_base(), 'logo' => seo_abs('images/logo.png'),
        'email' => 'info@wheretospot.com', 'telephone' => '+20 127 766 0666', 'currenciesAccepted' => 'EGP', 'areaServed' => 'EG',
        'address' => ['@type' => 'PostalAddress', 'streetAddress' => 'MQR, El Wahat Road', 'addressLocality' => '6th of October City', 'addressRegion' => 'Giza', 'addressCountry' => 'EG'],
        'sameAs' => ['https://instagram.com/wheretospot', 'https://facebook.com/wheretospot', 'https://tiktok.com/@wheretospot']];
}

function seo_sitemap(): string
{
    $x = '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml">' . "\n";
    $page = function (string $loc, string $lastmod = '', array $images = [], string $alt = '') {
        $s = '  <url><loc>' . seo_esc($loc) . '</loc>' . ($lastmod ? '<lastmod>' . substr($lastmod, 0, 10) . '</lastmod>' : '');
        if ($alt) $s .= '<xhtml:link rel="alternate" hreflang="en" href="' . seo_esc($loc) . '"/><xhtml:link rel="alternate" hreflang="ar" href="' . seo_esc($alt) . '"/>';
        foreach (array_slice($images, 0, 5) as $img) $s .= '<image:image><image:loc>' . seo_esc($img) . '</image:loc></image:image>';
        return $s . "</url>\n";
    };
    foreach (['', 'plans.html', 'about.html', 'contact.html', 'shipping-policy.html', 'refund-policy.html', 'privacy-policy.html', 'terms.html'] as $f) $x .= $page(seo_base() . '/' . $f);
    foreach (seo_products() as $p) $x .= $page($p['url'], (string) $p['updatedAt'], $p['imageUrls'], seo_product_url($p['id'], true));
    foreach (load_brands(true) as $b) $x .= $page(seo_base() . '/?brand=' . rawurlencode($b['slug']));
    return $x . '</urlset>' . "\n";
}

// Google Merchant Center product feed (free Shopping listings); other AI shopping tools read the same format.
function seo_feed(): string
{
    $x = '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>' . "\n" .
        '<title>' . SEO_SITE . '</title><link>' . seo_esc(seo_base()) . '</link><description>Where To Spot shop, Egypt. Prices in EGP.</description>' . "\n";
    foreach (seo_products() as $p) {
        if ($p['cat'] === 'services') continue;
        $rows = count($p['sizes']) > 1 ? $p['sizes'] : [['label' => '', 'price' => $p['low'], 'stock' => $p['stock'], 'sku' => '']];
        foreach ($rows as $i => $s) {
            $x .= '<item><g:id>' . seo_esc($p['id'] . ($s['label'] !== '' ? '-' . $i : '')) . '</g:id>' . ($s['label'] !== '' ? '<g:item_group_id>' . seo_esc($p['id']) . '</g:item_group_id><g:size>' . seo_esc($s['label']) . '</g:size>' : '') .
                '<g:title>' . seo_esc($p['title'] . ($s['label'] !== '' ? ' — ' . $s['label'] : '')) . '</g:title><g:description>' . seo_esc(trim($p['text'] ?: $p['summary'])) . '</g:description>' .
                '<g:link>' . seo_esc($p['url']) . '</g:link>' . ($p['imageUrls'] ? '<g:image_link>' . seo_esc($p['imageUrls'][0]) . '</g:image_link>' : '') .
                implode('', array_map(function ($u) { return '<g:additional_image_link>' . seo_esc($u) . '</g:additional_image_link>'; }, array_slice($p['imageUrls'], 1, 5))) .
                '<g:availability>' . (($p['cat'] === 'services' || (count($p['sizes']) > 1 ? $s['stock'] : $p['stock']) > 0) ? 'in_stock' : 'out_of_stock') . '</g:availability>' .
                '<g:price>' . number_format($s['price'], 2, '.', '') . ' EGP</g:price><g:condition>new</g:condition><g:brand>' . seo_esc($p['brand']) . '</g:brand>' .
                '<g:identifier_exists>no</g:identifier_exists><g:product_type>' . seo_esc($p['catLabel']) . '</g:product_type>' .
                '<g:shipping><g:country>EG</g:country><g:price>' . number_format((float) cfg('shipping_fee'), 2, '.', '') . ' EGP</g:price></g:shipping></item>' . "\n";
        }
    }
    return $x . '</channel></rss>' . "\n";
}

// llms.txt: what the shop is and sells, in plain words, with links — for ChatGPT, Claude, Perplexity etc.
function seo_llms(): string
{
    $ship = (float) cfg('shipping_fee');
    $free = (float) cfg('free_shipping_threshold');
    $t = "# Where To Spot\n\n> Online shop and marketing studio in Egypt (6th of October City, Giza). Sells NFC Google-review cards and stands, " .
        "acrylic display stands, Korean skincare, specialty coffee from partner roasters, and monthly lead-generation marketing plans. " .
        "All prices are in Egyptian Pounds (EGP). Delivery across Egypt in 2–5 days; cash on delivery, cards and mobile wallets accepted; 14-day returns.\n\n" .
        "- Shop: " . seo_base() . "/\n- Arabic shop: " . seo_base() . "/?lang=ar\n- Contact: info@wheretospot.com · +20 127 766 0666 · WhatsApp +20 127 766 0666\n" .
        "- Delivery: EGP " . number_format($ship) . " across Egypt, free on orders over EGP " . number_format($free) . " (" . seo_base() . "/shipping-policy.html)\n" .
        "- Returns: 14 days (" . seo_base() . "/refund-policy.html)\n- Product feed: " . seo_base() . "/api/seo.php?f=feed\n\n";
    $byCat = [];
    foreach (seo_products() as $p) $byCat[$p['catLabel']][] = $p;
    foreach ($byCat as $cat => $list) {
        $t .= "## " . $cat . "\n\n";
        foreach ($list as $p) {
            $t .= "- [" . $p['title'] . "](" . $p['url'] . "): " . seo_price_text($p) . ($p['partner'] ? " · by " . $p['brand'] . " (official partner)" : '') .
                ($p['inStock'] ? '' : ' · currently out of stock') . ". " . trim(preg_replace('/\s+/', ' ', $p['text'] ?: $p['summary'])) . "\n";
        }
        $t .= "\n";
    }
    $brands = load_brands(true);
    if ($brands) {
        $t .= "## Partner brands\n\n";
        foreach ($brands as $b) $t .= "- " . $b['name'] . ": " . trim($b['about'] ?: $b['tagline']) . " Products: " . seo_base() . "/?brand=" . $b['slug'] . "\n";
        $t .= "\n";
    }
    return $t;
}

// Keep /sitemap.xml and /llms.txt at the site root up to date (called after catalog changes).
function seo_publish(): void
{
    $root = dirname(__DIR__);
    if (!is_writable($root)) return;
    try {
        @file_put_contents($root . '/sitemap.xml', seo_sitemap(), LOCK_EX);
        @file_put_contents($root . '/llms.txt', seo_llms(), LOCK_EX);
    } catch (Throwable $e) {
        error_log('[shop] seo publish failed: ' . $e->getMessage());
    }
}
