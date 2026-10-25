<?php
// The Arabic versions (?lang=ar) of the homepage, the review-link tool and the information pages, built on the
// server (see the main .htaccess) so search engines and AI tools that don't run JavaScript get real Arabic pages:
// lang="ar" dir="rtl", an Arabic title and description, their own canonical address, and only the Arabic text
// (the English blocks are taken out, so each page has one H1). The English pages are the plain .html files.

declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

const PAGE_AR = [
    'index' => ['file' => 'index.html', 'title' => 'كروت وستاندات NFC لتقييمات جوجل والمزيد في مصر | Where To Spot',
        'desc' => 'متجر Where To Spot في مصر: كروت وستاندات NFC لتقييمات جوجل، ستاندات أكريليك، قهوة مختصة، منتجات عناية كورية، وخطط تسويق. توصيل لكل مصر والدفع عند الاستلام.'],
    'google-review-link' => ['file' => 'google-review-link.html', 'title' => 'رابط تقييم جوجل وكود QR مجانًا لنشاطك — Where To Spot',
        'desc' => 'هات رابط تقييم جوجل لنشاطك مجانًا: الصق رابط خرائط جوجل وخد رابط التقييم الرسمي، وكارت QR للطباعة، وزرار تقييم لموقعك.'],
    'about' => ['file' => 'about.html', 'title' => 'من نحن — Where To Spot',
        'desc' => 'Where To Spot استوديو تسويق ومتجر أونلاين في مدينة 6 أكتوبر، الجيزة: كروت تقييم NFC، ستاندات أكريليك، خطط جلب عملاء والمزيد.'],
    'contact' => ['file' => 'contact.html', 'title' => 'تواصل معنا — Where To Spot',
        'desc' => 'تواصل مع Where To Spot: واتساب وتليفون 01277660666، إيميل info@wheretospot.com، والعنوان في مدينة 6 أكتوبر، الجيزة. بنرد خلال يوم عمل.'],
    'sell' => ['file' => 'sell.html', 'title' => 'بيع منتجاتك مع Where To Spot',
        'desc' => 'عندك براند أو منتجات؟ ابعتها لنا وإحنا نعرضها في متجرنا ونسوّق لها بالإعلانات والسوشيال ميديا مقابل عمولة متفق عليها، لكل مصر.'],
    'plans' => ['file' => 'plans.html', 'title' => 'خطط جلب العملاء الشهرية — Where To Spot',
        'desc' => 'خطط تسويق شهرية للشركات في مصر من 299 ج.م: إعلانات، صفحات هبوط، CRM وأتمتة. من غير عقود، وضمان استرداد خلال 14 يوم في أول شهر.'],
    'privacy-policy' => ['file' => 'privacy-policy.html', 'title' => 'سياسة الخصوصية — Where To Spot',
        'desc' => 'إزاي Where To Spot بتجمع وتستخدم وتحمي بياناتك لما تشتري أو تدفع أونلاين أو تكلمنا واتساب أو تستخدم أدواتنا المجانية، وحقوقك.'],
    'refund-policy' => ['file' => 'refund-policy.html', 'title' => 'سياسة الاسترجاع والإلغاء — Where To Spot',
        'desc' => 'الاسترجاع في Where To Spot: 14 يوم للمنتجات اللي ما اتستخدمتش، وإلغاء خطط التسويق في أي وقت مع ضمان استرداد خلال 14 يوم في أول شهر.'],
    'shipping-policy' => ['file' => 'shipping-policy.html', 'title' => 'سياسة التوصيل والشحن — Where To Spot',
        'desc' => 'التوصيل من Where To Spot: لكل مصر خلال 2–5 أيام عمل، 75 ج.م أو مجانًا للطلبات فوق 1,500 ج.م، والدفع عند الاستلام أو بالبطاقة أو المحفظة.'],
    'terms' => ['file' => 'terms.html', 'title' => 'الشروط والأحكام — Where To Spot',
        'desc' => 'الشروط والأحكام للشراء من Where To Spot في مصر: الطلبات، الأسعار بالجنيه، الدفع، التوصيل، الاسترجاع، المنتجات المخصصة وخطط التسويق.'],
];

$key = preg_replace('/[^a-z-]/', '', (string) ($_GET['f'] ?? ''));
$page = PAGE_AR[$key] ?? null;
$html = $page ? @file_get_contents(dirname(__DIR__) . '/' . $page['file']) : false;
if ($html === false) { http_response_code(404); exit('Not found'); }

$base = rtrim((string) cfg('site_url'), '/') . '/' . ($key === 'index' ? '' : $page['file']);
$url = $base . '?lang=ar';
$e = function ($s) { return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); };
$set = function (string $html, string $pattern, string $with): string { return preg_replace_callback($pattern, function () use ($with) { return $with; }, $html, 1) ?? $html; };

// The page's language from the first byte.
$html = $set($html, '/<html[^>]*>/', '<html lang="ar" dir="rtl">');
$html = $set($html, '/<title>.*?<\/title>/s', '<title>' . $e($page['title']) . '</title>');
foreach (['name="description"', 'property="og:description"', 'name="twitter:description"'] as $m) $html = $set($html, '/<meta ' . preg_quote($m, '/') . ' content="[^"]*">/', '<meta ' . $m . ' content="' . $e($page['desc']) . '">');
foreach (['property="og:title"', 'name="twitter:title"'] as $m) $html = $set($html, '/<meta ' . preg_quote($m, '/') . ' content="[^"]*">/', '<meta ' . $m . ' content="' . $e($page['title']) . '">');
$html = $set($html, '/<meta property="og:url" content="[^"]*">/', '<meta property="og:url" content="' . $e($url) . '">');
$html = $set($html, '/<meta property="og:locale" content="[^"]*">/', '<meta property="og:locale" content="ar_EG">');
$html = $set($html, '/<link rel="canonical" href="[^"]*">/', '<link rel="canonical" href="' . $e($url) . '">');

// Only the Arabic text: take out each English-only block whose inside holds no other block of the same kind
// (so a block is never cut in the middle). The homepage's catalogue copy keeps only its Arabic section.
foreach (['main', 'article', 'aside', 'section', 'div', 'p', 'li', 'span'] as $tag) {
    $html = preg_replace_callback('/<' . $tag . '\b[^>]*\bclass="(?:[^"]*\s)?en-only(?:\s[^"]*)?"[^>]*>(.*?)<\/' . $tag . '>/s', function ($m) use ($tag) {
        return preg_match('/<' . $tag . '\b/i', $m[1]) ? $m[0] : '';
    }, $html) ?? $html;
}
if ($key === 'index') $html = preg_replace('/<section lang="en">.*?<\/section>/s', '', $html, 1) ?? $html;

header('Content-Type: text/html; charset=utf-8');
header('Content-Language: ar');
header('Cache-Control: public, max-age=300');
echo $html;
