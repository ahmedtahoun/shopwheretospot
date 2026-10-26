<?php
// Ad tracking in the browser: loads the Meta Pixel and Google Analytics 4 when their IDs are set in
// api/config.local.php (nothing loads otherwise). Pages report shop events with
//   (window.wtsQ = window.wtsQ || []).push(['AddToCart', { value, currency, contents }, eventId]);
// in Meta's names; they're passed to the pixel and, renamed, to GA4. Clicks on WhatsApp and phone links are a "Contact".

declare(strict_types=1);

$c = is_file(__DIR__ . '/config.local.php') ? (array) require __DIR__ . '/config.local.php' : [];
$pixel = preg_match('/^\d{6,20}$/', (string) ($c['meta']['pixel_id'] ?? '')) ? (string) $c['meta']['pixel_id'] : '';
$ga4 = preg_match('/^G-[A-Z0-9]{4,16}$/', (string) ($c['ga4_id'] ?? '')) ? (string) $c['ga4_id'] : '';

header('Content-Type: application/javascript; charset=utf-8');
header('Cache-Control: public, max-age=600');
header('X-Content-Type-Options: nosniff');
?>
(function () {
  var P = <?= json_encode($pixel) ?>, G = <?= json_encode($ga4) ?>;
  if (!P && !G) { window.wtsQ = { push: function () {} }; return; }
  if (P) {
    !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', P);
    fbq('track', 'PageView');
  }
  if (G) {
    var g = document.createElement('script'); g.async = true; g.src = 'https://www.googletagmanager.com/gtag/js?id=' + G; document.head.appendChild(g);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', G);
  }
  var STD = { ViewContent: 1, AddToCart: 1, InitiateCheckout: 1, AddPaymentInfo: 1, Purchase: 1, Lead: 1, Contact: 1, Search: 1, SubmitApplication: 1, CompleteRegistration: 1 };
  var GA = { ViewContent: 'view_item', AddToCart: 'add_to_cart', InitiateCheckout: 'begin_checkout', AddPaymentInfo: 'add_payment_info', Purchase: 'purchase', Lead: 'generate_lead', Contact: 'contact', Search: 'search', SubmitApplication: 'seller_application', CompleteRegistration: 'sign_up' };
  function send(ev, p, id) {
    p = p || {};
    var contents = p.contents || [];
    if (P && window.fbq) {
      var m = {};
      for (var k in p) if (k !== 'contents') m[k] = p[k];
      if (contents.length) {
        m.contents = contents.map(function (c) { return { id: String(c.id), quantity: c.quantity || 1, item_price: c.item_price }; });
        m.content_ids = m.content_ids || m.contents.map(function (c) { return c.id; });
        m.content_type = m.content_type || 'product';
      }
      fbq(STD[ev] ? 'track' : 'trackCustom', ev, m, id ? { eventID: id } : undefined);
    }
    if (G && window.gtag) {
      var a = { currency: p.currency, value: p.value };
      if (contents.length) a.items = contents.map(function (c) { return { item_id: String(c.id), item_name: c.name || String(c.id), price: c.item_price, quantity: c.quantity || 1 }; });
      if (ev === 'Purchase' && id) a.transaction_id = String(id).replace(/^order-/, '');
      if (p.search_string) a.search_term = p.search_string;
      if (p.content_category) a.content_category = p.content_category;
      gtag('event', GA[ev] || ev, a);
    }
  }
  var q = window.wtsQ && window.wtsQ.length ? window.wtsQ : [];
  window.wtsQ = { push: function (a) { try { send(a[0], a[1], a[2]); } catch (e) {} } };
  q.forEach(window.wtsQ.push);
  // A tap on a WhatsApp or phone link is a contact (once per page, so double taps don't count twice).
  var told = {};
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var h = a.getAttribute('href') || '', kind = /wa\.me|api\.whatsapp\.com|whatsapp:\/\//i.test(h) ? 'whatsapp' : /^tel:/i.test(h) ? 'phone' : '';
    if (!kind || told[kind]) return;
    told[kind] = 1;
    send('Contact', { content_category: kind });
  }, true);
})();
