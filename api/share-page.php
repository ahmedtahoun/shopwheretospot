<?php
// Link previews (WhatsApp, Facebook, Instagram, Telegram, iMessage…): their preview bots give up after a few
// seconds, and the full shop page is too big to arrive in time — so links showed up bare. Preview bots get a
// tiny page with just the title, text and picture; people are sent straight on to the real page.

function share_is_preview_bot(): bool
{
    return (bool) preg_match('/WhatsApp|facebookexternalhit|Facebot|meta-externalagent|Twitterbot|TelegramBot|Slackbot|LinkedInBot|Discordbot|Pinterest|SkypeUriPreview|Viber|Snapchat|redditbot|Iframely|Embedly/i',
        (string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
}

// The small page a preview bot reads.
function share_card_html(string $title, string $desc, string $image, string $url, string $lang): string
{
    $e = function ($s) { return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); };
    return '<!doctype html><html lang="' . $lang . '"' . ($lang === 'ar' ? ' dir="rtl"' : '') . '><head><meta charset="utf-8">' .
        '<title>' . $e($title) . '</title><meta name="description" content="' . $e($desc) . '">' .
        '<meta property="og:type" content="website"><meta property="og:site_name" content="Where To Spot">' .
        '<meta property="og:title" content="' . $e($title) . '"><meta property="og:description" content="' . $e($desc) . '">' .
        '<meta property="og:image" content="' . $e($image) . '"><meta property="og:image:alt" content="' . $e($title) . '">' .
        '<meta property="og:url" content="' . $e($url) . '"><meta property="og:locale" content="' . ($lang === 'ar' ? 'ar_EG' : 'en_US') . '">' .
        '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' . $e($title) . '">' .
        '<meta name="twitter:description" content="' . $e($desc) . '"><meta name="twitter:image" content="' . $e($image) . '">' .
        '<link rel="icon" href="/favicon.ico?v=2" sizes="48x48"><link rel="icon" type="image/png" sizes="192x192" href="/images/favicon-192.png?v=2">' .
        '<link rel="canonical" href="' . $e($url) . '"></head><body><a href="' . $e($url) . '">' . $e($title) . '</a></body></html>';
}

// /ar and /en: the shop's own share links (one per language).
function share_shop_link(string $lang): void
{
    $base = 'https://shop.wheretospot.com';
    $ar = $lang === 'ar';
    $target = $base . '/?lang=' . $lang;
    if (!share_is_preview_bot()) { header('Location: ' . $target, true, 302); exit; }
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: public, max-age=3600');
    echo share_card_html(
        $ar ? 'Where To Spot | كروت وستاندات تقييم جوجل وقهوة مختصة' : 'Where To Spot | Google review NFC stands, specialty coffee & more',
        $ar ? 'كروت وستاندات NFC وQR لتقييمات جوجل، كوسترات وستاندات أكريليك مطبوعة بتصميمك، وقهوة مختصة. الدفع عند الاستلام وتوصيل لكل مصر.'
            : 'NFC & QR Google review cards and stands, custom-printed acrylic coasters and stands, and specialty coffee. Cash on delivery across Egypt.',
        $base . '/images/share-card.jpg', $base . '/' . $lang, $lang);
    exit;
}

// /business, /cafes, /coffee, /beauty, /bonds: a link per kind of visitor. People land on that part of the
// shop (index.html?for=…); the preview card speaks to them. Arabic by default, ?lang=en for English.
// Pictures are 1200x630 (the shape WhatsApp and Facebook show large); a new file name makes apps fetch the new picture.
const SHARE_PAGES = [
    'business' => ['for=business', 'business-2.jpg',
        ['ستاندات وكروت تقييم جوجل NFC + QR | Where To Spot', 'زوّد تقييماتك على جوجل ومتابعينك ومدفوعاتك: ستاندات وكروت NFC وQR مطبوعة بتصميمك، كوسترات وستاندات أكريليك، وخطط تسويق شهرية. الدفع عند الاستلام.'],
        ['Google review NFC + QR stands & cards | Where To Spot', 'Get more Google reviews, followers and payments: NFC & QR stands and cards printed with your design, acrylic coasters and stands, and monthly marketing plans. Cash on delivery.']],
    'cafes' => ['for=cafes', 'cafes-2.jpg',
        ['كل اللي الكافيه محتاجه | Where To Spot', 'ستاندات تقييم جوجل، كوسترات منيو QR وأرقام طاولات مطبوعة بلوجو الكافيه — وقهوة مختصة من بوندز بالجملة أو باسمك التجاري.'],
        ['Everything your café needs | Where To Spot', 'Google review stands, QR menu coasters and table numbers printed with your logo — plus specialty coffee from Bonds, wholesale or under your own label.']],
    'coffee' => ['for=coffee', 'coffee-2.jpg',
        ['قهوة مختصة محمصة طازة | Where To Spot', 'بلندات وقهوة أحادية المصدر من بوندز لتحميص القهوة، 250 جم و1 كجم، توصيل لكل مصر والدفع عند الاستلام. أسعار جملة للكافيهات.'],
        ['Freshly roasted specialty coffee | Where To Spot', 'Blends and single origins from Bonds Coffee Roasters, 250 g and 1 kg, delivered across Egypt with cash on delivery. Wholesale prices for cafés.']],
    'beauty' => ['for=beauty', 'beauty-2.jpg',
        ['عناية كورية بالبشرة | Where To Spot', 'منتجات أصلية من ذا فيس شوب وراوند لاب، توصيل لكل مصر والدفع عند الاستلام.'],
        ['Korean skincare | Where To Spot', 'Original products from The Face Shop and Round Lab, delivered across Egypt with cash on delivery.']],
    'bonds' => ['brand=bonds', 'bonds.jpg',
        ['بوندز لتحميص القهوة — شريك رسمي | Where To Spot', 'قهوة بوندز المختصة: بلندات وأحادية المصدر، وبرامج قهوة للكافيهات وتحميص حسب الطلب وعلامتك الخاصة.'],
        ['Bonds Coffee Roasters — official partner | Where To Spot', 'Bonds specialty coffee: blends and single origins, coffee programs for cafés, tailored roasting and private label.']],
];

function share_for_link(string $key): void
{
    $base = 'https://shop.wheretospot.com';
    [$query, $img, $ar, $en] = SHARE_PAGES[$key];
    $lang = ($_GET['lang'] ?? '') === 'en' ? 'en' : 'ar';
    if (!share_is_preview_bot()) {
        header('Location: ' . $base . '/?' . $query . (isset($_GET['lang']) ? '&lang=' . $lang : '') . '#products', true, 302);
        exit;
    }
    [$title, $desc] = $lang === 'en' ? $en : $ar;
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: public, max-age=3600');
    echo share_card_html($title, $desc, $base . '/images/share/' . $img, $base . '/' . $key . ($lang === 'en' ? '?lang=en' : ''), $lang);
    exit;
}
