// Generated from api/review-page.php (its <script> block); do not edit by hand.
import { phpJson, phpJsonPlain } from '../lib/php';
export const reviewJs = (t: string, T: (en: string, ar: string) => string): string => `<script>
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
    if (!reviews.length) { err.textContent = ${phpJson(T('Tap the stars for at least one product.', 'اختار النجوم لمنتج واحد على الأقل.'))}; return; }
    send.disabled = true;
    fetch('/api/public.php?action=review_token_save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: ${phpJsonPlain(t)}, name: document.getElementById('nm').value, reviews: reviews }) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Error'); return d; }); })
      .then(function () { document.getElementById('form').hidden = true; document.getElementById('done').hidden = false; window.scrollTo(0, 0); })
      .catch(function (x) { err.textContent = x.message || ${phpJson(T('Something went wrong, please try again.', 'حصلت مشكلة، حاول تاني.'))}; send.disabled = false; });
  };
})();
</script>
`;
