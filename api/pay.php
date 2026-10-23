<?php
// A payment link the team sends a customer from the dashboard (WhatsApp inbox → order → Send payment link):
//   /api/pay.php?o=<order id>&k=<key from pay_link_key()>
// Opening it starts a fresh Paymob payment for what's still due and goes straight to Paymob's page.
// With both card and wallet set up, the customer first picks one. Link-preview bots only get a small card,
// so sending the link in WhatsApp doesn't start a payment by itself.

declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/share-page.php';

$id = (int) ($_GET['o'] ?? 0);
$key = (string) ($_GET['k'] ?? '');
$e = function ($s) { return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); };

// A small bilingual page (Arabic first: most customers), in the shop's colours.
function pay_page(string $titleAr, string $titleEn, string $body): void
{
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex');
    echo '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<meta name="robots" content="noindex"><title>' . htmlspecialchars($titleAr . ' · ' . $titleEn) . '</title><link rel="icon" href="/favicon.ico?v=2">'
        . '<style>body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;background:#F6F3EE;color:#1C1B19;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}'
        . '.c{background:#fff;border-radius:18px;padding:28px 22px;max-width:380px;width:100%;box-sizing:border-box;box-shadow:0 6px 24px rgba(0,0,0,.08);text-align:center}'
        . 'img{width:56px;height:56px;border-radius:14px;background:#111;padding:4px;box-sizing:border-box;object-fit:contain}h1{font-size:20px;margin:12px 0 2px}h2{font-size:15px;font-weight:500;color:#6B675F;margin:0 0 16px}'
        . '.amt{font-size:28px;font-weight:700;margin:6px 0 2px}.muted{color:#6B675F;font-size:14px}'
        . 'a.b{display:block;margin-top:12px;padding:14px;border-radius:12px;background:#B5562F;color:#fff;text-decoration:none;font-weight:600}a.b.alt{background:#fff;color:#B5562F;border:1.5px solid #B5562F}'
        . 'small{display:block;font-weight:400;opacity:.85}</style></head><body><div class="c"><img src="/images/logo.png" alt="Where To Spot">'
        . '<h1>' . htmlspecialchars($titleAr) . '</h1><h2 dir="ltr">' . htmlspecialchars($titleEn) . '</h2>' . $body . '</div></body></html>';
    exit;
}

$o = null;
if ($id > 0 && hash_equals(pay_link_key($id), $key)) {
    $st = db()->prepare('SELECT * FROM orders WHERE id = ?');
    $st->execute([$id]);
    $o = $st->fetch() ?: null;
}
if (!$o) { http_response_code(404); pay_page('الرابط غير صحيح', 'This link isn’t valid', '<p class="muted">اطلب رابطًا جديدًا من فريقنا على واتساب.<br><span dir="ltr">Ask our team on WhatsApp for a new link.</span></p>'); }

$number = order_number($id);
$due = round((float) $o['total'] - order_paid($id), 2);
$amount = '<div class="amt" dir="ltr">EGP ' . number_format($due, $due == floor($due) ? 0 : 2) . '</div><div class="muted">طلب رقم · Order <b dir="ltr">' . $e($number) . '</b></div>';

// WhatsApp (and other apps) open the link to draw a preview: show a card, don't start a payment.
if (share_is_preview_bot()) {
    echo share_card_html('Where To Spot · ' . $number . ' · EGP ' . number_format($due), 'ادفع طلبك أونلاين بالبطاقة أو المحفظة · Pay your order online', rtrim((string) cfg('site_url'), '/') . '/images/share-card.jpg', pay_link_url($id), 'ar');
    exit;
}

if ($o['status'] === 'Cancelled' || $o['status'] === 'Returned') pay_page('الطلب ملغي', 'This order was cancelled', '<p class="muted">تواصل معنا على واتساب لعمل طلب جديد.<br><span dir="ltr">Message us on WhatsApp to place it again.</span></p>');
if ($due <= 0) pay_page('تم الدفع ✓', 'Already paid ✓', '<p class="muted">طلب رقم <span dir="ltr">' . $e($number) . '</span> مدفوع بالكامل. شكرًا لك!<br><span dir="ltr">Order ' . $e($number) . ' is fully paid. Thank you!</span></p>');
$methods = paymob_methods();
if (!$methods) pay_page('الدفع أونلاين غير متاح الآن', 'Online payment isn’t available right now', '<p class="muted">تواصل معنا على واتساب.<br><span dir="ltr">Please message us on WhatsApp.</span></p>');

$method = (string) ($_GET['m'] ?? '');
if (!isset($methods[$method])) {
    if (count($methods) > 1) {
        $link = function ($m) use ($id, $key) { return '/api/pay.php?o=' . $id . '&k=' . rawurlencode($key) . '&m=' . $m; };
        pay_page('ادفع طلبك', 'Pay for your order', $amount
            . '<a class="b" href="' . $e($link('paymob_card')) . '">💳 بطاقة بنكية<small dir="ltr">Card · Visa / Mastercard / Meeza</small></a>'
            . '<a class="b alt" href="' . $e($link('paymob_wallet')) . '">📱 محفظة إلكترونية<small dir="ltr">Mobile wallet · Vodafone Cash and others</small></a>'
            . '<p class="muted" style="margin-top:16px">🔒 الدفع آمن عبر Paymob<br><span dir="ltr">Secure payment by Paymob</span></p>');
    }
    $method = array_keys($methods)[0];
}

if (too_many_attempts('paylink', 30, 3600)) pay_page('محاولات كثيرة', 'Too many attempts', '<p class="muted">حاول مرة أخرى بعد قليل.<br><span dir="ltr">Please try again a little later.</span></p>');
record_attempt('paylink');
try {
    $url = paymob_checkout_url($id, $method);
} catch (Throwable $err) {
    log_activity(null, 'Online payment could not start', $number . ' · payment link · ' . mb_substr((string) ($GLOBALS['paymob_last_error'] ?? $err->getMessage()), 0, 250));
    pay_page('تعذر بدء الدفع', 'The payment couldn’t start', '<p class="muted">حاول مرة أخرى بعد قليل أو تواصل معنا على واتساب.<br><span dir="ltr">Try again in a moment, or message us on WhatsApp.</span></p>');
}
header('Location: ' . $url, true, 302);
