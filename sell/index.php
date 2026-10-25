<?php
// shop.wheretospot.com/sell — share link for the "Sell with us" page: preview bots get a card,
// people go to the page (Arabic unless ?lang=en). See api/share-page.php.
require dirname(__DIR__) . '/api/share-page.php';
$en = ($_GET['lang'] ?? '') === 'en';
if (!share_is_preview_bot()) {
    header('Location: https://shop.wheretospot.com/sell.html' . ($en ? '' : '?lang=ar'), true, 302);
    exit;
}
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: public, max-age=3600');
echo $en
    ? share_card_html('Sell your products with Where To Spot', 'Send us your products — we market and sell them in our shop, ads and social media for an agreed commission.', 'https://shop.wheretospot.com/images/share/business-2.jpg', 'https://shop.wheretospot.com/sell?lang=en', 'en')
    : share_card_html('بيع منتجاتك مع Where To Spot', 'ابعت لنا منتجاتك وإحنا نعرضها في متجرنا ونسوّق لها بالإعلانات والسوشيال ميديا مقابل عمولة متفق عليها.', 'https://shop.wheretospot.com/images/share/business-2.jpg', 'https://shop.wheretospot.com/sell', 'ar');
