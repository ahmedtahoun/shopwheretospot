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
    [$cats, $brands] = seo_lookups($ar);
    return array_map(function ($p) use ($ar, $cats, $brands) { return seo_item($p, $ar, $cats, $brands); }, load_products(true));
}

// Category labels and brands, in the page's language.
function seo_lookups(bool $ar): array
{
    $cats = [];
    foreach (db()->query('SELECT key, label, label_ar FROM categories') as $c) $cats[$c['key']] = $ar && $c['label_ar'] ? $c['label_ar'] : $c['label'];
    $brands = [];
    foreach (load_brands(false) as $b) $brands[$b['id']] = $b;
    return [$cats, $brands];
}

// One product (a product_row) with its public facts, search title and search description.
function seo_item(array $p, bool $ar, array $cats, array $brands): array
{
    $b = $p['brandId'] ? ($brands[$p['brandId']] ?? null) : null;
    $sizes = [];
    foreach ($p['variants'] as $v) {
        $price = (float) ($v['price'] ?: $p['price']);
        if ($p['discountPct']) $price = round($price * (1 - $p['discountPct'] / 100)); // whole pounds, like checkout (api/pricing.php)
        $sizes[] = ['label' => $v['label'], 'price' => $price, 'stock' => (int) $v['stock'], 'sku' => $v['sku'] ?? ''];
    }
    $sale = $p['discountPct'] ? round($p['price'] * (1 - $p['discountPct'] / 100)) : (float) $p['price'];
    $item = $p + [
        'title' => $ar && $p['nameAr'] ? $p['nameAr'] : $p['name'],
        'summary' => $ar && $p['subAr'] ? $p['subAr'] : (string) $p['sub'],
        'text' => $ar && $p['descAr'] ? $p['descAr'] : (string) $p['desc'],
        'catLabel' => $cats[$p['cat']] ?? $p['cat'],
        // Partner brand, else the product's own brand (e.g. The Face Shop), else us. A supplier's web
        // address (e.g. "Grevo.io") isn't a brand people search for, so those products count as ours.
        'brand' => $b ? ($ar && $b['nameAr'] ? $b['nameAr'] : $b['name']) : ((string) $p['vendor'] !== '' && strpos((string) $p['vendor'], '.') === false ? (string) $p['vendor'] : SEO_SITE),
        'partner' => (bool) $b,
        'sizes' => $sizes,
        'low' => $sizes ? min(array_column($sizes, 'price')) : $sale,
        'high' => $sizes ? max(array_column($sizes, 'price')) : $sale,
        'was' => $p['discountPct'] && !$sizes ? (float) $p['price'] : 0,
        'inStock' => $p['cat'] === 'services' || ($sizes ? array_sum(array_column($sizes, 'stock')) > 0 : $p['stock'] > 0),
        'imageUrls' => array_map(function ($i) { return seo_abs(is_array($i) ? (string) ($i['path'] ?? '') : (string) $i); }, $p['images']),
        'url' => seo_product_url($p['id'], $ar),
    ];
    $item['seoTitle'] = trim((string) ($ar ? $p['seoTitleAr'] ?? '' : $p['seoTitle'] ?? '')) ?: seo_auto_title($item, $ar);
    $item['seoDesc'] = trim((string) ($ar ? $p['seoDescAr'] ?? '' : $p['seoDesc'] ?? '')) ?: seo_auto_desc($item, $ar);
    return $item;
}

// Cut to a length at a word boundary.
function seo_cut(string $s, int $max): string
{
    $s = trim(preg_replace('/\s+/u', ' ', $s));
    if (mb_strlen($s) <= $max) return $s;
    $cut = mb_substr($s, 0, $max - 1);
    $sp = mb_strrpos($cut, ' ');
    return preg_replace('/[\s,.;:·—–|،-]+$/u', '', $sp > $max * 0.6 ? mb_substr($cut, 0, $sp) : $cut) . '…';
}

// Search title (Google shows about 60 characters): name – brand | Where To Spot, dropping the
// least useful part when it's too long. The brand is skipped when the name already says it.
function seo_auto_title(array $p, bool $ar): string
{
    $name = trim($p['title']);
    $brand = $p['brand'] !== SEO_SITE && mb_stripos($name, $p['brand']) === false ? $p['brand'] : '';
    $tries = $brand ? [$name . ' – ' . $brand . ' | ' . SEO_SITE, $name . ' – ' . $brand, $name . ' | ' . SEO_SITE] : [$name . ' | ' . SEO_SITE];
    foreach ($tries as $t) if (mb_strlen($t) <= 60) return $t;
    return seo_cut($brand && mb_strlen($name) < 45 ? $name . ' – ' . $brand : $name, 60);
}

// Search description (Google shows about 155 characters): what it is and who makes it, the price,
// and why to buy here (cash on delivery, delivery across Egypt). The richest version that fits wins;
// the product text fills any room left.
function seo_auto_desc(array $p, bool $ar): string
{
    $money = function ($n) use ($ar) { return $ar ? number_format($n) . ' ج.م' : 'EGP ' . number_format($n); };
    $size = function ($l) use ($ar) { return $ar ? preg_replace(['/^Without NFC$/u', '/^With NFC$/u', '/\bkg\b/u', '/\bg\b/u', '/\bml\b/u', '/\bcm\b/u'], ['بدون NFC', 'مع NFC', 'كجم', 'جم', 'مل', 'سم'], $l) : $l; };
    $by = $p['brand'] !== SEO_SITE && mb_stripos($p['title'], $p['brand']) === false ? ($ar ? ' من ' : ' by ') . $p['brand'] : '';
    $lead = $p['title'] . $by;
    // The short line, minus the parts that only list the sizes (the price part says them).
    $labels = array_column($p['sizes'], 'label');
    $parts = array_filter(array_map('trim', explode('·', $p['summary'])), function ($part) use ($labels, $size) {
        foreach ($labels as $l) if ($l !== '' && (mb_stripos($part, $l) !== false || mb_stripos($part, $size($l)) !== false)) return false;
        return $part !== '';
    });
    $summary = rtrim(implode(' · ', $parts), '.');
    $partner = '';
    if ($p['cat'] === 'services') {
        $price = ($ar ? 'يبدأ من ' : 'From ') . $money($p['low']) . ($ar ? ' شهريًا' : ' a month');
        $why = $ar ? 'خطة تسويق شهرية لجلب عملاء جدد في مصر.' : 'Monthly lead-generation marketing plan in Egypt.';
    } else {
        if (count($p['sizes']) > 1) {
            $sizes = $p['sizes'];
            usort($sizes, function ($x, $y) { return $x['price'] <=> $y['price']; });
            // Two sizes: both prices. More: the range (the short line or description names the sizes).
            $price = count($sizes) > 2
                ? ($ar ? 'من ' . number_format($p['low']) . ' إلى ' . $money($p['high']) : 'EGP ' . number_format($p['low']) . '–' . number_format($p['high']))
                : implode(' · ', array_map(function ($s) use ($money, $size) { return $size($s['label']) . ' ' . $money($s['price']); }, $sizes));
        } else {
            $price = $p['was'] ? ($ar ? 'الآن ' . $money($p['low']) . ' بدلًا من ' . $money($p['was']) : 'Now ' . $money($p['low']) . ' (was ' . $money($p['was']) . ')') : $money($p['low']);
        }
        $why = $p['inStock']
            ? ($ar ? 'الدفع عند الاستلام وتوصيل لكل مصر خلال 2–5 أيام.' : 'Cash on delivery & 2–5 day delivery across Egypt.')
            : ($ar ? 'غير متوفر حاليًا.' : 'Currently out of stock.');
        if ($p['partner']) $partner = $ar ? 'منتج أصلي من شريك رسمي. ' : 'Original, from an official partner. ';
    }
    $with = function (string $sum, string $extra, ?string $tail = null) use ($lead, $price, $why) { return rtrim($lead . ($sum !== '' ? ': ' . $sum : '') . '. ' . $price . '. ' . $extra . ($tail ?? $why)); };
    // What it is (type, notes, size) matters more for search than the delivery line, so that's dropped first.
    $short = $p['cat'] === 'services' ? '' : ($p['inStock'] ? ($ar ? 'الدفع عند الاستلام في كل مصر.' : 'Cash on delivery in Egypt.') : $why);
    $tries = [$with($summary, $partner), $with($summary, ''), $with($summary, '', $short), $with($summary, '', ''), $with('', $partner), $with('', '')];
    // Still too long with the full short line: drop its last listed items ("…, black tea, orange") one by one.
    for ($sum = $summary; preg_match('/^(.+?)\s*(?:,|،|·|&|\bو)\s*[^,،·&]+$/u', $sum, $m);) {
        $sum = rtrim($m[1], ' ,،·&');
        array_splice($tries, 4, 0, [$with($sum, '', $short)]);
        if (mb_strlen($with($sum, '', $short)) <= 160) break;
    }
    $d = '';
    foreach ($tries as $t) if (mb_strlen($t) <= 160) { $d = $t; break; }
    if ($d === '') return seo_cut(end($tries), 160);
    // Room left? Add the first sentence of the description.
    $text = trim(preg_replace('/\s+/u', ' ', $p['text']));
    if ($text !== '' && mb_strlen($d) < 125) {
        $first = trim(preg_split('/(?<=[.!؟?])\s/u', $text)[0]);
        $longer = $lead . ($summary !== '' ? ': ' . $summary : '') . '. ' . $first . ' ' . $price . '. ' . $partner . $why;
        if (mb_strlen($longer) <= 160) $d = $longer;
    }
    return $d;
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
    return ['@context' => 'https://schema.org', '@type' => 'OnlineStore', 'name' => SEO_SITE, 'url' => seo_base(), 'logo' => seo_abs('images/logo-round.png?v=3'),
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
    // Every page has an Arabic version at ?lang=ar.
    foreach (['', 'plans.html', 'about.html', 'contact.html', 'sell.html', 'shipping-policy.html', 'refund-policy.html', 'privacy-policy.html', 'terms.html'] as $f) $x .= $page(seo_base() . '/' . $f, '', [], seo_base() . '/' . $f . '?lang=ar');
    // The review-link tool: one page in English and Arabic (?lang=ar).
    $x .= $page(seo_base() . '/google-review-link.html', '2026-10-24', [], seo_base() . '/google-review-link.html?lang=ar');
    foreach (seo_products() as $p) $x .= $page($p['url'], (string) $p['updatedAt'], $p['imageUrls'], seo_product_url($p['id'], true));
    foreach (seo_catalog(false) as $c) $x .= $page(seo_category_url($c['key']), '', [], seo_category_url($c['key'], true));
    foreach (load_brands(true) as $b) $x .= $page(seo_brand_url($b['slug']), '', [], seo_brand_url($b['slug'], true));
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
                // Same as checkout: free delivery from the free-shipping amount, otherwise the delivery fee.
                '<g:shipping><g:country>EG</g:country><g:price>' . number_format($s['price'] >= (float) cfg('free_shipping_threshold') ? 0 : (float) cfg('shipping_fee'), 2, '.', '') . ' EGP</g:price></g:shipping></item>' . "\n";
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
        "- Returns: 14 days (" . seo_base() . "/refund-policy.html)\n- Free tool: Google review link and QR code generator (" . seo_base() . "/google-review-link.html, Arabic: ?lang=ar). Paste any Google Maps link to get the business's official review link (g.page/r/…/review), checked with Google. Free: the review link and a review button for websites. QR cards: 2 free with an account, then 5 for EGP 300, 15 for EGP 750, 40 for EGP 1,600; each QR includes a business page (shop.wheretospot.com/r/…) with WhatsApp, Instagram, Facebook, TikTok, menu and location links.\n- Product feed: " . seo_base() . "/api/seo.php?f=feed\n\n";
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
        seo_publish_home();
    } catch (Throwable $e) {
        ops_error('SEO', 'Updating the sitemap / search engines failed', $e);
    }
}

// ---------- category & brand pages, the homepage catalogue for crawlers, IndexNow ----------

function seo_category_url(string $key, bool $ar = false): string { return seo_base() . '/c/' . rawurlencode($key) . ($ar ? '?lang=ar' : ''); }
function seo_brand_url(string $slug, bool $ar = false): string { return seo_base() . '/b/' . rawurlencode($slug) . ($ar ? '?lang=ar' : ''); }

// What each category page says above its products, and the questions under them (Arabic and English).
// Facts here must stay true: prices come from the products themselves, these are only the general answers.
const SEO_CATEGORY_TEXT = [
    'nfc' => [
        'en' => ['title' => 'NFC Google review cards & stands in Egypt', 'intro' => 'Tap-to-review NFC cards, keychains and counter stands that open your Google review box in one tap. Each comes programmed with your business’s review link and works with every recent iPhone and Android phone; stands also carry a QR code for phones without NFC.',
            'faq' => [['How does an NFC review card work?', 'The customer holds their phone near the card and their phone opens your Google review box straight away. No app, no camera and no searching for your business.'],
                ['Does it work with iPhone?', 'Yes. iPhone XS and newer read NFC automatically, as do most Android phones with NFC turned on. Our stands also have a QR code, so every phone works.'],
                ['Do you program the card with my review link?', 'Yes. Send us your Google Maps link or business name when you order and we program it for you. You can also make your review link free with our review link tool.'],
                ['How long does delivery take?', 'Delivery across Egypt takes 2–5 working days, with cash on delivery, card or mobile wallet.']]],
        'ar' => ['title' => 'كروت وستاندات NFC لتقييمات جوجل في مصر', 'intro' => 'كروت وميداليات وستاندات NFC بتفتح خانة تقييم نشاطك على جوجل بلمسة واحدة. كل منتج بيتبرمج برابط تقييم نشاطك، وبيشتغل مع كل موبايلات الآيفون والأندرويد الحديثة، والستاندات عليها كمان كود QR للموبايلات اللي مفيهاش NFC.',
            'faq' => [['كارت NFC للتقييم بيشتغل إزاي؟', 'العميل يقرّب موبايله من الكارت، فيفتح خانة تقييم نشاطك على جوجل على طول، من غير تطبيق ولا كاميرا ولا بحث.'],
                ['بيشتغل مع الآيفون؟', 'أيوه. آيفون XS وأحدث بيقرأ NFC تلقائي، ومعظم موبايلات الأندرويد اللي فيها NFC. والستاندات عليها كمان كود QR عشان كل الموبايلات تشتغل.'],
                ['بتبرمجوا الكارت برابط التقييم بتاعي؟', 'أيوه. ابعتلنا رابط نشاطك على خرائط جوجل أو اسمه مع الطلب وإحنا بنبرمجه. وتقدر كمان تعمل رابط التقييم مجانًا من أداة رابط التقييم بتاعتنا.'],
                ['التوصيل بياخد قد إيه؟', 'التوصيل لكل مصر خلال 2–5 أيام عمل، والدفع عند الاستلام أو بالبطاقة أو المحفظة.']]],
    ],
    'stands' => [
        'en' => ['title' => 'Acrylic stands for menus, prices & QR codes', 'intro' => 'Clear and printed acrylic stands for restaurant menus, price lists, QR codes and table numbers, in several sizes from A4 to small table signs. Printed with your design or left clear for your own inserts.',
            'faq' => [['Which size should I choose?', 'A4 suits full menus and price lists, A5 suits short menus and promotions, and the smaller sizes suit QR codes and table numbers.'],
                ['Can you print my design?', 'Yes. Order a printed stand and send your design or logo; we can also design it for you.'],
                ['How long does delivery take?', 'Delivery across Egypt takes 2–5 working days, with cash on delivery, card or mobile wallet.']]],
        'ar' => ['title' => 'ستاندات أكريليك للمنيو والأسعار وأكواد QR', 'intro' => 'ستاندات أكريليك شفافة ومطبوعة للمنيو وقوايم الأسعار وأكواد QR وأرقام الترابيزات، بمقاسات مختلفة من A4 لحد اللافتات الصغيرة. بنطبعها بتصميمك أو بتيجي شفافة تحط فيها ورقك.',
            'faq' => [['أختار أنهي مقاس؟', 'A4 مناسب للمنيو الكامل وقوايم الأسعار، وA5 للمنيو القصير والعروض، والمقاسات الصغيرة لأكواد QR وأرقام الترابيزات.'],
                ['بتطبعوا التصميم بتاعي؟', 'أيوه. اطلب ستاند مطبوع وابعت التصميم أو اللوجو، وممكن كمان نصممهولك.'],
                ['التوصيل بياخد قد إيه؟', 'التوصيل لكل مصر خلال 2–5 أيام عمل، والدفع عند الاستلام أو بالبطاقة أو المحفظة.']]],
    ],
    'coffee' => [
        'en' => ['title' => 'Specialty coffee delivered in Egypt', 'intro' => 'Specialty coffee blends and single origins from our partner roaster, Bonds Coffee Roasters, delivered across Egypt. Cafés and offices can also ask for wholesale prices, tailored roasting or coffee under their own brand.',
            'faq' => [['Who roasts the coffee?', 'Bonds Coffee Roasters, our official partner. The coffee comes directly from the roaster.'],
                ['Do you supply cafés and offices?', 'Yes. Ask for wholesale prices, tailored roasting or private-label coffee from the shop or on WhatsApp.'],
                ['How long does delivery take?', 'Delivery across Egypt takes 2–5 working days, with cash on delivery, card or mobile wallet.']]],
        'ar' => ['title' => 'قهوة مختصة بتوصيل لكل مصر', 'intro' => 'بلندات قهوة مختصة وقهوة أحادية المصدر من شريكنا بوندز لتحميص القهوة، بتوصيل لكل مصر. والكافيهات والشركات تقدر تطلب أسعار جملة أو تحميص حسب الطلب أو قهوة باسم علامتها.',
            'faq' => [['مين اللي بيحمّص القهوة؟', 'بوندز لتحميص القهوة، شريكنا الرسمي، والقهوة بتيجي من المحمصة مباشرة.'],
                ['بتوردوا للكافيهات والشركات؟', 'أيوه. اطلب أسعار الجملة أو التحميص حسب الطلب أو القهوة باسم علامتك من المتجر أو على واتساب.'],
                ['التوصيل بياخد قد إيه؟', 'التوصيل لكل مصر خلال 2–5 أيام عمل، والدفع عند الاستلام أو بالبطاقة أو المحفظة.']]],
    ],
    'cosmetics' => [
        'en' => ['title' => 'Korean skincare in Egypt: The Face Shop & Round Lab', 'intro' => 'Authentic Korean skincare from The Face Shop and Round Lab: serums, cleansers and creams for everyday routines, delivered across Egypt with cash on delivery.',
            'faq' => [['Are the products original?', 'Yes. We sell authentic products from The Face Shop and Round Lab.'],
                ['Can I return a product?', 'Unused products can be returned within 14 days; see our refund policy.'],
                ['How long does delivery take?', 'Delivery across Egypt takes 2–5 working days, with cash on delivery, card or mobile wallet.']]],
        'ar' => ['title' => 'منتجات عناية كورية في مصر: The Face Shop وRound Lab', 'intro' => 'منتجات عناية بالبشرة كورية أصلية من The Face Shop وRound Lab: سيرومات وغسولات وكريمات للروتين اليومي، بتوصيل لكل مصر والدفع عند الاستلام.',
            'faq' => [['المنتجات أصلية؟', 'أيوه. بنبيع منتجات أصلية من The Face Shop وRound Lab.'],
                ['أقدر أرجّع منتج؟', 'المنتجات اللي ما اتستخدمتش تترجّع خلال 14 يوم، شوف سياسة الاسترجاع.'],
                ['التوصيل بياخد قد إيه؟', 'التوصيل لكل مصر خلال 2–5 أيام عمل، والدفع عند الاستلام أو بالبطاقة أو المحفظة.']]],
    ],
    'services' => [
        'en' => ['title' => 'Monthly marketing plans for Egyptian businesses', 'intro' => 'Monthly lead-generation plans from EGP 299 to EGP 1,499: ad campaigns, landing pages, funnels, CRM and automation, with no long-term contract.',
            'faq' => [['Is there a contract?', 'No long-term contract: you can cancel any time before your next billing date.'],
                ['Is there a guarantee?', 'Yes, a 14-day money-back guarantee on your first month of any plan.']]],
        'ar' => ['title' => 'خطط تسويق شهرية للشركات في مصر', 'intro' => 'خطط جلب عملاء شهرية من 299 ج.م لحد 1,499 ج.م: حملات إعلانية، صفحات هبوط، مسارات تحويل، CRM وأتمتة، ومن غير عقود طويلة.',
            'faq' => [['فيه عقد؟', 'مفيش عقود طويلة: تقدر تلغي في أي وقت قبل موعد الفاتورة الجاية.'],
                ['فيه ضمان؟', 'أيوه، ضمان استرداد المبلغ خلال 14 يوم في أول شهر من أي خطة.']]],
    ],
];

function seo_category_text(string $key, string $label, string $descr, bool $ar): array
{
    $t = SEO_CATEGORY_TEXT[$key][$ar ? 'ar' : 'en'] ?? null;
    return $t ?: ['title' => $label, 'intro' => $descr, 'faq' => []];
}

// The shop's categories that have products, with their products (for the homepage block, category pages, sitemap).
function seo_catalog(bool $ar): array
{
    $cats = [];
    foreach (db()->query('SELECT key, label, label_ar, descr, descr_ar FROM categories ORDER BY sort, label') as $c) {
        $cats[$c['key']] = ['key' => $c['key'], 'label' => $ar && $c['label_ar'] ? $c['label_ar'] : $c['label'], 'descr' => $ar && $c['descr_ar'] ? $c['descr_ar'] : (string) $c['descr'], 'products' => []];
    }
    foreach (seo_products($ar) as $p) if (isset($cats[$p['cat']])) $cats[$p['cat']]['products'][] = $p;
    return array_values(array_filter($cats, function ($c) { return $c['products']; }));
}

// A plain-HTML copy of the catalogue for the homepage (index.html, between the seo:home markers), for
// crawlers and AI tools that don't run JavaScript. People with JavaScript never see it.
function seo_home_block(): string
{
    $out = '';
    foreach ([false, true] as $ar) {
        $out .= '<section lang="' . ($ar ? 'ar' : 'en') . '"' . ($ar ? ' dir="rtl"' : '') . '>';
        $out .= '<h2>' . ($ar ? 'منتجات Where To Spot' : 'Where To Spot products') . '</h2><p>' . ($ar
            ? 'متجر وستوديو تسويق في مدينة 6 أكتوبر، الجيزة: كروت وستاندات NFC لتقييمات جوجل، ستاندات أكريليك، قهوة مختصة، منتجات عناية كورية، وخطط تسويق شهرية. كل الأسعار بالجنيه المصري، توصيل لكل مصر خلال 2–5 أيام، الدفع عند الاستلام أو بالبطاقة أو المحفظة، واسترجاع خلال 14 يوم.'
            : 'Online shop and marketing studio in 6th of October City, Giza: NFC Google review cards and stands, acrylic stands, specialty coffee, Korean skincare and monthly marketing plans. All prices in EGP, delivery across Egypt in 2–5 days, cash on delivery, card or mobile wallet, 14-day returns.') . '</p>';
        foreach (seo_catalog($ar) as $c) {
            $out .= '<h3><a href="' . seo_esc(seo_category_url($c['key'], $ar)) . '">' . seo_esc($c['label']) . '</a></h3><ul>';
            foreach ($c['products'] as $p) $out .= '<li><a href="' . seo_esc($p['url']) . '">' . seo_esc($p['title']) . '</a>: ' . seo_esc(seo_price_text($p, $ar)) . ($p['summary'] ? ' · ' . seo_esc($p['summary']) : '') . '</li>';
            $out .= '</ul>';
        }
        foreach (load_brands(true) as $b) $out .= '<p><a href="' . seo_esc(seo_brand_url($b['slug'], $ar)) . '">' . seo_esc($ar && $b['nameAr'] ? $b['nameAr'] : $b['name']) . '</a> · ' . ($ar ? 'شريك رسمي' : 'official partner') . '</p>';
        $out .= '<p><a href="' . seo_base() . '/google-review-link.html' . ($ar ? '?lang=ar' : '') . '">' . ($ar ? 'أداة مجانية: رابط تقييم جوجل وكود QR' : 'Free tool: Google review link & QR code generator') . '</a> · <a href="' . seo_base() . '/plans.html">' . ($ar ? 'خطط التسويق' : 'Marketing plans') . '</a> · <a href="' . seo_base() . '/contact.html">' . ($ar ? 'تواصل معنا' : 'Contact us') . '</a></p></section>';
    }
    return $out;
}

// Write the homepage block into index.html (only when it changed). The copy in git carries a "stale" mark,
// so after each deploy the first catalogue request fills it in (api/public.php).
function seo_publish_home(): void
{
    $file = dirname(__DIR__) . '/index.html';
    $html = @file_get_contents($file);
    if ($html === false || !is_writable($file)) return;
    $a = strpos($html, '<!--seo:home-->'); $b = strpos($html, '<!--/seo:home-->');
    if ($a === false || $b === false || $b < $a) return;
    $new = substr($html, 0, $a) . '<!--seo:home--><div id="seo-home">' . seo_home_block() . '</div>' . substr($html, $b);
    if ($new === $html) return;
    @file_put_contents($file, $new, LOCK_EX);
    // The catalogue changed (or a deploy just happened): send every page in the sitemap to IndexNow.
    preg_match_all('~<loc>([^<]+)</loc>~', seo_sitemap(), $m);
    try { seo_indexnow(array_map('html_entity_decode', $m[1])); } catch (Throwable $e) {}
}

function seo_home_stale(): bool
{
    $html = @file_get_contents(dirname(__DIR__) . '/index.html');
    return $html !== false && strpos($html, '<!--seo:home:stale-->') !== false;
}

// IndexNow: tell Bing (which also feeds ChatGPT search), Yandex and others that pages changed, straight away.
// The key is a public file at the site root (indexnow-key.txt).
const INDEXNOW_KEY = '7f3c9a2e5b8d41f6a0c4e9b2d7f1a3c5';

function seo_indexnow(array $urls): void
{
    $urls = array_values(array_unique(array_filter($urls)));
    if (!$urls || stripos((string) cfg('site_url'), 'localhost') !== false) return;
    $host = (string) parse_url(seo_base(), PHP_URL_HOST);
    $ch = curl_init('https://api.indexnow.org/indexnow');
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 6, CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json; charset=utf-8'],
        CURLOPT_POSTFIELDS => json_encode(['host' => $host, 'key' => INDEXNOW_KEY, 'keyLocation' => seo_base() . '/indexnow-key.txt', 'urlList' => array_slice($urls, 0, 1000)], JSON_UNESCAPED_SLASHES)]);
    @curl_exec($ch);
}

// After a product changes: its pages (both languages), its category page and the homepage.
function seo_indexnow_product(string $id): void
{
    $urls = [seo_product_url($id), seo_product_url($id, true), seo_base() . '/'];
    $st = db()->prepare('SELECT cat FROM products WHERE id = ?');
    $st->execute([$id]);
    if ($cat = $st->fetchColumn()) { $urls[] = seo_category_url((string) $cat); $urls[] = seo_category_url((string) $cat, true); }
    register_shutdown_function(function () use ($urls) { try { seo_indexnow($urls); } catch (Throwable $e) {} });
}
