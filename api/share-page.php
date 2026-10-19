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
