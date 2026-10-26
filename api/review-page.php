<?php
// The page behind a review link, /rate/<token> (rate/.htaccess): the products of a delivered order, each with
// stars and an optional comment, no sign-in needed (api/review-requests.php). Arabic unless the order was in English.

declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

$t = (string) ($_GET['t'] ?? '');
$o = review_order_by_token($t);
header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex');
header('Cache-Control: no-store');
$q = (string) ($_GET['lang'] ?? '');
$ar = $q === 'ar' || ($q !== 'en' && (!$o || $o['lang'] !== 'en'));
$e = function ($s) { return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); };
$T = function (string $en, string $arText) use ($ar) { return $ar ? $arText : $en; };
$d = $o ? review_page_data($o) : null;
$first = $d ? (preg_split('/\s+/u', trim($d['name']))[0] ?? '') : '';
?><!DOCTYPE html>
<html lang="<?= $ar ? 'ar' : 'en' ?>" dir="<?= $ar ? 'rtl' : 'ltr' ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title><?= $e($T('Rate your order — Where To Spot', 'قيّم طلبك — Where To Spot')) ?></title>
<link rel="icon" href="/favicon.ico?v=3" sizes="48x48">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Work+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{margin:0;background:#F7F3ED;color:#22201D;font-family:<?= $ar ? "'IBM Plex Sans Arabic'," : '' ?>'Work Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.6}
.wrap{max-width:620px;margin:0 auto;padding:24px 16px 64px}
.top{display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit;font-weight:600;margin-bottom:28px}
.top img{width:36px;height:36px;border-radius:50%}
h1{font-family:<?= $ar ? "'IBM Plex Sans Arabic'" : "'Instrument Serif',serif" ?>;font-weight:<?= $ar ? 700 : 400 ?>;font-size:<?= $ar ? '30px' : '40px' ?>;line-height:1.15;margin:0 0 8px}
.lead{color:#6B6660;font-size:16px;margin:0 0 24px}
.card{background:#fff;border:1px solid #E6DFD5;border-radius:22px;padding:18px;margin-bottom:14px}
.p{display:flex;gap:14px;align-items:center}
.p img,.p .ph{width:72px;height:72px;border-radius:14px;object-fit:cover;background:#F3EEE7;flex:none}
.p b{font-size:16px;line-height:1.4}
.stars{display:flex;gap:6px;margin:14px 0 10px}
.stars button{border:none;background:#F7F3ED;border-radius:12px;width:48px;height:48px;font-size:26px;line-height:1;cursor:pointer;color:#D6CEC2;transition:transform .1s,color .1s,background .1s}
.stars button.on{color:#F2B01E;background:#FFF6DD}
.stars button:active{transform:scale(.92)}
textarea,input{width:100%;font:inherit;font-size:16px;border:1px solid #DDD6CC;border-radius:14px;padding:12px 14px;background:#FBF8F4;color:#22201D}
textarea{min-height:76px;resize:vertical}
textarea:focus,input:focus{outline:none;border-color:#A8552F;background:#fff;box-shadow:0 0 0 4px rgba(168,85,47,.12)}
label{display:block;font-weight:600;font-size:14px;margin-bottom:8px}
.hint{font-size:13px;color:#8A8478;margin-top:6px}
.btn{display:flex;align-items:center;justify-content:center;width:100%;border:none;border-radius:999px;background:#A8552F;color:#fff;font:inherit;font-weight:700;font-size:17px;padding:17px;cursor:pointer;text-decoration:none;margin-top:8px}
.btn.line{background:#fff;color:#22201D;border:1px solid #DDD6CC;font-size:15px;padding:14px}
.btn:disabled{opacity:.6}
.err{color:#A13F3F;font-size:14px;min-height:1em;margin:10px 0 0}
.done{text-align:center;padding:30px 20px}
.done .ok{width:64px;height:64px;border-radius:50%;background:#E3EFE5;color:#2F7A45;display:grid;place-items:center;font-size:30px;margin:0 auto 12px}
</style>
</head>
<body>
<div class="wrap">
<a class="top" href="/<?= $ar ? '?lang=ar' : '' ?>"><img src="/images/logo-mark.png?v=3" alt="">Where To Spot</a>
<?php if (!$d): ?>
  <h1><?= $e($T('This link has expired', 'الرابط ده مش شغال')) ?></h1>
  <p class="lead"><?= $e($T('It may be for an order that isn’t delivered yet. Message us on WhatsApp and we’ll help.', 'ممكن يكون لطلب لسه موصلش. كلمنا على واتساب وهنساعدك.')) ?></p>
  <a class="btn" href="https://wa.me/201277660666"><?= $e($T('WhatsApp us', 'كلمنا على واتساب')) ?></a>
<?php else: ?>
  <div id="form">
  <h1><?= $e($ar ? 'أهلًا ' . $first . '، طلبك عجبك؟' : 'Hi ' . $first . ', how was your order?') ?></h1>
  <p class="lead"><?= $e($T('Tap the stars for each product. A few words help other customers a lot (optional).', 'اختار النجوم لكل منتج. كلمتين عن رأيك بيساعدوا عملاء تانيين جدًا (اختياري).')) ?><br><span style="font-size:13px"><?= $e($T('Order', 'طلب')) ?> <?= $e($d['number']) ?></span></p>
  <?php foreach ($d['products'] as $p): $name = $ar && $p['nameAr'] !== '' ? $p['nameAr'] : $p['name']; ?>
  <div class="card" data-p="<?= $e($p['id']) ?>" data-r="<?= (int) $p['rating'] ?>">
    <div class="p"><?php if ($p['img']): ?><img src="/img/200/<?= $e($p['img']) ?>" alt="" loading="lazy"><?php else: ?><span class="ph"></span><?php endif; ?><b><?= $e($name) ?></b></div>
    <div class="stars" role="radiogroup" aria-label="<?= $e($T('Rating', 'التقييم')) ?>"><?php for ($i = 1; $i <= 5; $i++): ?><button type="button" data-s="<?= $i ?>" aria-label="<?= $i ?>">★</button><?php endfor; ?></div>
    <textarea maxlength="1500" placeholder="<?= $e($T('What did you like? How’s the quality?', 'إيه اللي عجبك؟ الجودة عاملة إزاي؟')) ?>"><?= $e($p['text']) ?></textarea>
  </div>
  <?php endforeach; ?>
  <div class="card">
    <label for="nm"><?= $e($T('Your name', 'اسمك')) ?></label>
    <input id="nm" maxlength="60" value="<?= $e($d['name']) ?>" autocomplete="name">
    <div class="hint"><?= $e($T('Shown as your first name and last initial, with a “verified purchase” badge.', 'هيظهر اسمك الأول وأول حرف من اسم العيلة، مع علامة “مشتري مؤكد”.')) ?></div>
  </div>
  <button class="btn" id="send"><?= $e($T('Send my review', 'ابعت تقييمي')) ?></button>
  <div class="err" id="err" role="alert"></div>
  </div>
  <div class="card done" id="done" hidden>
    <div class="ok">✓</div>
    <h1><?= $e($T('Thank you!', 'شكرًا ليك!')) ?></h1>
    <p class="lead"><?= $e($T('Your review is on the product page now.', 'تقييمك ظاهر دلوقتي في صفحة المنتج.')) ?></p>
    <?php if ($d['google'] !== ''): ?><a class="btn" href="<?= $e($d['google']) ?>" target="_blank" rel="noopener">⭐ <?= $e($T('Also rate us on Google', 'قيّمنا كمان على جوجل')) ?></a><?php endif; ?>
    <a class="btn line" href="/<?= $ar ? '?lang=ar' : '' ?>"><?= $e($T('Back to the shop', 'ارجع للمتجر')) ?></a>
  </div>
<?php endif; ?>
</div>
<?php if ($d): ?>
<script>
(function () {
  var cards = document.querySelectorAll('[data-p]');
  cards.forEach(function (c) {
    var paint = function () { var r = +c.dataset.r; c.querySelectorAll('[data-s]').forEach(function (b) { b.classList.toggle('on', +b.dataset.s <= r); b.setAttribute('aria-pressed', +b.dataset.s === r); }); };
    c.querySelectorAll('[data-s]').forEach(function (b) { b.onclick = function () { c.dataset.r = b.dataset.s; paint(); }; });
    paint();
  });
  var send = document.getElementById('send'), err = document.getElementById('err');
  send.onclick = function () {
    var reviews = Array.prototype.map.call(cards, function (c) { return { product_id: c.dataset.p, rating: +c.dataset.r, text: c.querySelector('textarea').value }; }).filter(function (r) { return r.rating > 0; });
    err.textContent = '';
    if (!reviews.length) { err.textContent = <?= json_encode($T('Tap the stars for at least one product.', 'اختار النجوم لمنتج واحد على الأقل.'), JSON_UNESCAPED_UNICODE) ?>; return; }
    send.disabled = true;
    fetch('/api/public.php?action=review_token_save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: <?= json_encode($t) ?>, name: document.getElementById('nm').value, reviews: reviews }) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Error'); return d; }); })
      .then(function () { document.getElementById('form').hidden = true; document.getElementById('done').hidden = false; window.scrollTo(0, 0); })
      .catch(function (x) { err.textContent = x.message || <?= json_encode($T('Something went wrong, please try again.', 'حصلت مشكلة، حاول تاني.'), JSON_UNESCAPED_UNICODE) ?>; send.disabled = false; });
  };
})();
</script>
<?php endif; ?>
</body>
</html>
