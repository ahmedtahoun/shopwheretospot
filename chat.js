// Floating chat assistant for the shop pages (a little face in the corner).
// It understands typed questions in English and Arabic (including Egyptian Arabic) with plain
// rules — no AI service, no API keys: keyword matching on normalised text, the live product
// catalog for prices, the shop's delivery / payment / returns facts, order tracking, and a short
// quote flow. Contact details typed anywhere are picked up and saved as a lead in the dashboard
// (api/public.php?action=lead); the team can take over on WhatsApp.
(function () {
  if (window.__wtsChat) return;
  window.__wtsChat = true;

  const WHATSAPP = '201277660666';
  // Arabic when the shop is in Arabic (see i18n.js); each reply follows the language the customer writes in.
  const AR = window.WTS_LANG === 'ar';
  const L = (en, ar) => (AR ? ar : en);
  const STORE = 'wts-chat-v2' + (AR ? '-ar' : '');
  const ACCENT = '#A8552F';

  const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch (e) { return null; } };
  const save = (v) => { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch (e) {} };
  const seen = () => { try { return sessionStorage.getItem(STORE + '-teased') === '1'; } catch (e) { return true; } };
  const markSeen = () => { try { sessionStorage.setItem(STORE + '-teased', '1'); } catch (e) {} };

  const css = `
  :host{all:initial}
  *{box-sizing:border-box;font-family:${AR ? '"IBM Plex Sans Arabic",' : ''}'Work Sans',system-ui,-apple-system,sans-serif}
  .launch{position:fixed;right:22px;bottom:calc(22px + var(--wts-chat-offset, 0px));z-index:80;display:block;border:none;background:none;padding:0;cursor:pointer;
    border-radius:36%;filter:drop-shadow(0 14px 22px rgba(60,40,160,.35));transition:transform .2s ease}
  .launch:hover{transform:translateY(-2px)}
  .launch .bud{width:50px;height:50px}
  .launch .bud .eyes{gap:7px}
  .launch .bud .eyes i{width:8px;height:14px}
  .launch:focus-visible{outline:3px solid #6A55F5;outline-offset:4px}
  .bud{width:42px;height:42px;border-radius:36%;background:linear-gradient(140deg,#4C6FFF 0%,#6A55F5 55%,#7E46EE 100%);display:grid;place-items:center;position:relative;flex:none;
    box-shadow:inset 0 -3px 6px rgba(40,20,120,.25),inset 0 2px 4px rgba(255,255,255,.25);transition:transform .25s cubic-bezier(.3,1.6,.5,1)}
  .bud .eyes{display:flex;gap:6px;transition:transform .14s ease-out;will-change:transform}
  .bud .eyes i{width:7px;height:12px;border-radius:50%;background:#fff;animation:blink 5s infinite}
  @keyframes blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.12)}}
  .launch .bud::after{content:'';position:absolute;right:0;top:0;width:12px;height:12px;border-radius:50%;background:#4CC26B;border:2px solid #fff}
  .launch:hover .bud{transform:rotate(-8deg) scale(1.06)}
  @media (prefers-reduced-motion:reduce){.bud .eyes i{animation:none}.bud,.bud .eyes{transition:none}}
  .launch.hide{opacity:0;pointer-events:none;transform:translateY(10px)}
  .tease{position:fixed;right:22px;bottom:86px;z-index:80;max-width:270px;background:#fff;color:#22201D;border-radius:18px 18px 4px 18px;
    padding:14px 36px 14px 16px;font-size:14px;line-height:1.45;box-shadow:0 20px 50px -20px rgba(20,18,16,.45);cursor:pointer;
    animation:up .35s cubic-bezier(.2,.8,.2,1)}
  .tease b{display:block;font-size:14.5px;margin-bottom:2px}
  .tease .x{position:absolute;top:8px;right:8px;border:none;background:none;font-size:16px;color:#8A8478;cursor:pointer;line-height:1;padding:4px}
  .panel{position:fixed;right:22px;bottom:22px;z-index:85;width:min(390px,calc(100vw - 32px));height:min(620px,calc(100vh - 44px));
    background:#F7F3ED;border-radius:24px;overflow:hidden;display:flex;flex-direction:column;
    box-shadow:0 40px 90px -30px rgba(20,18,16,.55),0 0 0 1px rgba(34,32,29,.06);animation:up .3s cubic-bezier(.2,.8,.2,1)}
  @keyframes sheet{from{transform:translateY(100%)}to{transform:none}}
  @keyframes up{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
  .head{background:#22201D;color:#F7F3ED;padding:18px 18px 18px 20px;display:flex;align-items:center;gap:12px}
  .av{width:42px;height:42px;border-radius:50%;background:#F7F3ED;display:grid;place-items:center;flex:none;overflow:hidden}
  .av img{width:34px;height:20px;object-fit:contain;background:#22201D;border-radius:5px;padding:2px 3px}
  .av.bud{background:linear-gradient(140deg,#4C6FFF 0%,#6A55F5 55%,#7E46EE 100%);border-radius:36%;overflow:visible}
  .who{flex:1;min-width:0}
  .who b{display:block;font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:21px;line-height:1.1}
  .rtl .m.bot{border-bottom-left-radius:18px;border-bottom-right-radius:6px}
  .rtl .m.me{border-bottom-right-radius:18px;border-bottom-left-radius:6px}
  .who span{font-size:12.5px;color:#C9C3B8;display:flex;align-items:center;gap:6px;margin-top:3px}
  .who span::before{content:'';width:7px;height:7px;border-radius:50%;background:#4CC26B}
  .hbtn{border:none;background:rgba(255,255,255,.08);color:#F7F3ED;width:34px;height:34px;border-radius:50%;cursor:pointer;display:grid;place-items:center;font-size:15px}
  .hbtn:hover{background:rgba(255,255,255,.16)}
  .msgs{flex:1;overflow-y:auto;padding:20px 16px 8px;display:flex;flex-direction:column;gap:10px}
  .m{max-width:84%;padding:11px 14px;border-radius:18px;font-size:14.5px;line-height:1.5;white-space:pre-line;animation:fade .25s ease}
  @keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  .bot{background:#fff;color:#22201D;border-bottom-left-radius:6px;align-self:flex-start;box-shadow:0 1px 2px rgba(34,32,29,.06)}
  .me{background:${ACCENT};color:#fff;border-bottom-right-radius:6px;align-self:flex-end}
  .typing{display:flex;gap:4px;padding:14px 16px}
  .typing i{width:7px;height:7px;border-radius:50%;background:#B7AFA3;animation:b 1s infinite}
  .typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}
  @keyframes b{0%,60%,100%{transform:none;opacity:.5}30%{transform:translateY(-4px);opacity:1}}
  .chips{display:flex;flex-wrap:wrap;gap:8px;padding:4px 16px 14px}
  .chip{border:1px solid #D6CEC2;background:#fff;color:#22201D;border-radius:999px;padding:9px 14px;font-size:13.5px;font-weight:500;cursor:pointer;transition:all .15s ease}
  .chip:hover{border-color:#22201D;background:#22201D;color:#fff}
  .chip.wa{background:#1F7A4D;border-color:#1F7A4D;color:#fff;text-decoration:none;display:inline-flex;align-items:center;gap:8px}
  .chip.wa:hover{background:#17603C}
  .chip.ghost{background:none}
  form{display:flex;gap:8px;padding:12px;border-top:1px solid #E4DDD2;background:#fff}
  input{flex:1;min-width:0;border:1px solid #DDD6CC;background:#F7F3ED;border-radius:999px;padding:12px 16px;font-size:16px;color:#22201D;outline:none}
  input:focus{border-color:${ACCENT};background:#fff}
  .send{border:none;background:${ACCENT};color:#fff;width:46px;height:46px;border-radius:50%;cursor:pointer;display:grid;place-items:center;flex:none}
  .send:disabled{opacity:.4;cursor:default}
  .err{color:#A13F3F;font-size:12.5px;padding:0 18px 8px}
  .fine{font-size:11.5px;color:#8A8478;text-align:center;padding:0 16px 10px;background:#fff}
  .scrim{display:none}
  .grab{display:none}
  .cards{display:flex;flex-direction:column;gap:8px;align-self:stretch;max-width:92%}
  .pc{display:flex;gap:10px;align-items:center;background:#fff;border:1px solid #E4DDD2;border-radius:14px;padding:8px;animation:fade .25s ease}
  .pc img,.pc-ph{width:56px;height:56px;border-radius:10px;object-fit:contain;background:#F6F2EC;flex:none}
  .pc-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;font-size:13.5px}
  .pc-t b{font-weight:600;line-height:1.3}
  .pc-t > span{color:${ACCENT};font-weight:700}
  .pc-a{display:flex;gap:8px;margin-top:4px}
  .pc-a a{font-size:12.5px;font-weight:700;color:#22201D;text-decoration:none;border:1px solid #D6CEC2;border-radius:999px;padding:5px 10px}
  .pc-a{flex-wrap:wrap}
  .pc-a a.add{background:#fff;color:#22201D;border-color:#22201D}
  .pc-a a.buy{background:${ACCENT};color:#fff;border-color:${ACCENT}}
  .pc-out{font-size:12.5px;font-weight:700;color:#8A8478;padding:5px 2px}
  .pc-v{margin-top:4px;max-width:100%;font:inherit;font-size:12.5px;padding:5px 8px;border:1px solid #D6CEC2;border-radius:8px;background:#fff;color:#22201D}
  .lk{margin-top:8px;display:flex;flex-wrap:wrap;gap:8px}
  .lk a{color:${ACCENT};font-weight:700;text-decoration:none}
  .me .lk a{color:#fff}
  @media (max-width:520px){
    /* A sheet over the shop (not a separate screen), so it is clear the shop is still there behind it */
    .scrim{display:block;position:fixed;inset:0;z-index:84;background:rgba(20,18,16,.45);animation:fade .2s ease}
    .panel{right:0;left:0;bottom:0;width:100vw;height:88dvh;border-radius:22px 22px 0 0;animation:sheet .3s cubic-bezier(.2,.8,.2,1)}
    .grab{display:block;position:absolute;top:7px;left:50%;width:40px;height:4px;margin-left:-20px;border-radius:4px;background:rgba(255,255,255,.35)}
    .head{position:relative;padding-top:22px}
    .launch{right:16px;bottom:calc(16px + var(--wts-chat-offset, 0px))}
    .launch .bud{width:46px;height:46px}
    .tease{right:16px;bottom:calc(74px + var(--wts-chat-offset, 0px))}
  }
  @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
  `;

  const host = document.createElement('div');
  host.id = 'wts-chat';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>' + css + '</style><div id="r"></div>';
  const r = root.getElementById('r');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // The chat buddy: a little face whose eyes follow the pointer (and blink now and then).
  const eyes = '<span class="eyes"><i></i><i></i></span>';
  const sendIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  const waIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-3.3-.8-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.3z"/></svg>';

  let open = false, typing = false, error = '';

  // ======================================================================
  // Understanding: plain rules, no AI service. Text is normalised (Arabic letter forms, Arabic
  // digits, case) and matched against keyword lists in English, Arabic, Egyptian Arabic and
  // Franco-Arabic. Product questions are answered from the live catalog.
  // ======================================================================

  const norm = (s) => String(s || '').toLowerCase()
    .replace(/[ً-ْـ]/g, '')            // tashkeel, tatweel
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[^\p{L}\p{N}@.+\-\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const hasArabic = (s) => /[؀-ۿ]/.test(s);
  const any = (t, words) => words.some((w) => (w.length <= 3 && !/\s/.test(w) ? new RegExp('(^|\\s)' + w + '(\\s|$)').test(t) : t.includes(w)));

  const INTENTS = {
    greet: ['hi', 'hey', 'hello', 'hola', 'salam', 'السلام', 'سلام', 'اهلا', 'مرحبا', 'هاي', 'ازيك', 'صباح', 'مساء', 'good morning', 'good evening'],
    thanks: ['thank', 'thanks', 'thx', 'merci', 'شكرا', 'متشكر', 'تسلم', 'ميرسي', 'تمام شكرا'],
    price: ['price', 'cost', 'how much', 'prices', 'pricing', 'بكام', 'سعر', 'اسعار', 'الاسعار', 'تمن', 'ثمن', 'كام', 'تكلفه', 'bkam', 'b kam', 'se3r'],
    delivery: ['delivery', 'deliver', 'shipping', 'ship', 'courier', 'arrive', 'how long', 'توصيل', 'شحن', 'يوصل', 'توصلوا', 'بتوصلوا', 'هيوصل', 'يوصل امتي', 'مصاريف الشحن', 'مندوب', 'tawsil', 'sha7n'],
    payment: ['pay ', 'pay?', 'paying', 'payment', 'visa', 'mastercard', 'credit card', 'debit card', 'by card', 'cash', 'cod', 'wallet', 'vodafone cash', 'instapay', 'meeza', 'installment', 'دفع', 'ادفع', 'فيزا', 'كاش', 'محفظه', 'فودافون كاش', 'انستاباي', 'تقسيط', 'ماستر'],
    returns: ['return', 'refund', 'exchange', 'money back', 'guarantee', 'استرجاع', 'ترجيع', 'ارجع', 'استبدال', 'استرداد', 'ضمان', 'رجوع'],
    track: ['track', 'tracking', 'my order', 'order status', 'where is my', 'wts', 'طلبي', 'الاوردر', 'اوردري', 'تتبع', 'فين الطلب', 'فين الاوردر', 'حاله الطلب', 'رقم الطلب', 'شحنتي'],
    human: ['human', 'agent', 'person', 'someone', 'call me', 'talk to', 'speak', 'whatsapp', 'phone number', 'your number', 'contact', 'واتساب', 'واتس', 'كلمني', 'كلموني', 'اكلم', 'حد يكلمني', 'رقمكم', 'رقم التليفون', 'تليفونكم', 'خدمه العملاء', 'تواصل'],
    location: ['address', 'location', 'where are you', 'office', 'visit', 'branch', 'hours', 'open', 'عنوان', 'عنوانكم', 'مكانكم', 'فين مكانكم', 'انتو فين', 'فرع', 'مقر', 'مواعيد', 'ساعات العمل', 'اكتوبر'],
    quote: ['quote', 'quotation', 'bulk', 'wholesale', 'company', 'corporate', 'large order', 'عرض سعر', 'عرض اسعار', 'جمله', 'كميه كبيره', 'شركه', 'كميات', 'للشركه'],
    custom: ['logo', 'design', 'custom', 'branded', 'my brand', 'print', 'personali', 'لوجو', 'شعار', 'تصميم', 'طباعه', 'اطبع', 'براند', 'اسم المحل', 'مخصوص'],
    explain: ['what is', 'what are', 'how does', 'how do', 'how it works', 'explain', 'يعني ايه', 'ايه هو', 'ايه هي', 'ازاي', 'بيشتغل', 'بتشتغل', 'فكرته', 'فكره'],
    nfc: ['nfc', 'how does it work', 'how it works', 'what is', 'google review', 'reviews', 'tap', 'ازاي بيشتغل', 'بيشتغل ازاي', 'يعني ايه', 'ايه هو', 'تقييم', 'تقييمات', 'ريفيو', 'جوجل'],
    services: ['marketing', 'ads', 'advert', 'social media', 'leads', 'campaign', 'website', 'web site', 'store online', 'video', 'photograph', 'signage', 'booth', 'exhibition', 'event', 'تسويق', 'اعلان', 'اعلانات', 'سوشيال', 'حملات', 'عملاء', 'موقع', 'متجر', 'فيديو', 'تصوير', 'يافطه', 'لافته', 'معرض', 'معارض', 'ايفنت'],
    bye: ['bye', 'goodbye', 'see you', 'مع السلامه', 'سلام عليكم', 'باي'],
  };
  // Arabic / Franco words that map to the English words used in product names.
  const SYN = { 'كارت': 'card', 'كروت': 'card', 'كرت': 'card', 'kart': 'card', 'ستاند': 'stand', 'ستاندات': 'stand', 'استاند': 'stand', 'ميداليه': 'keychain', 'ميداليات': 'keychain',
    'سلسله': 'keychain', 'جوجل': 'google', 'تقييم': 'review', 'ريفيو': 'review', 'اكريليك': 'acrylic', 'سيروم': 'serum', 'كريم': 'cream', 'غسول': 'cleanser', 'منظف': 'cleanser',
    'عين': 'eye', 'اسود': 'black', 'ابيض': 'white', 'كيو ار': 'qr', 'باركود': 'qr', 'بشره': 'skin', 'تجميل': 'cosmetics', 'هدايا': 'gift', 'هديه': 'gift' };
  const GOV = [
    [['cairo', 'giza', 'القاهره', 'الجيزه', 'اكتوبر', 'october', 'zayed', 'زايد', 'تجمع', 'tagamo', 'nasr', 'نصر', 'maadi', 'المعادي', 'helwan', 'حلوان', 'shubra', 'شبرا', 'قليوبيه', 'qalyubia'], '1–3', 'cairo'],
    [['alex', 'اسكندريه', 'الاسكندريه', 'dakahlia', 'دقهليه', 'منصوره', 'mansoura', 'sharqia', 'شرقيه', 'زقازيق', 'gharbia', 'غربيه', 'طنطا', 'tanta', 'monufia', 'منوفيه', 'beheira', 'بحيره', 'damanhour', 'kafr', 'كفر', 'damietta', 'دمياط', 'port said', 'بورسعيد', 'ismailia', 'اسماعيليه', 'suez', 'السويس'], '2–5', 'delta'],
    [['fayoum', 'فيوم', 'beni suef', 'بني سويف', 'minya', 'منيا', 'assiut', 'اسيوط', 'sohag', 'سوهاج', 'qena', 'قنا', 'luxor', 'الاقصر', 'aswan', 'اسوان', 'hurghada', 'الغردقه', 'red sea', 'البحر الاحمر', 'sinai', 'سيناء', 'sharm', 'شرم', 'matrouh', 'مطروح', 'new valley', 'الوادي الجديد', 'saeed', 'الصعيد'], '3–7', 'far'],
  ];

  // Facts the assistant may state (keep in sync with shipping-policy.html and refund-policy.html).
  const FACTS = { fee: 75, freeOver: 1500, whatsapp: '+20 127 766 0666', email: 'info@wheretospot.com' };

  let catalog = null;
  const loadCatalog = () => catalog ? Promise.resolve(catalog) : fetch('api/public.php?action=catalog').then((x) => x.json()).then((d) => {
    const cats = {};
    (d.categories || []).forEach((c) => { cats[c.key] = c; });
    catalog = (d.products || []).filter((p) => p.status === 'Active').map((p) => {
      const c = cats[p.cat] || {};
      return { ...p, catLabel: AR ? (c.labelAr || c.label || '') : (c.label || ''),
        hay: norm([p.name, p.nameAr, p.sub, p.subAr, p.vendor, c.label, c.labelAr, p.cat].join(' ')) };
    });
    return catalog;
  }).catch(() => (catalog = []));

  const egp = (n, ar) => ar ? Math.round(n).toLocaleString('en-US') + ' ج.م' : 'EGP ' + Math.round(n).toLocaleString('en-US');
  const priceOf = (p) => (p.variants && p.variants.length) || (p.tiers && p.tiers.length) ? p.fromPrice : (p.discountPct ? p.price * (1 - p.discountPct / 100) : p.price);

  const STOP = ['the', 'and', 'for', 'how', 'much', 'price', 'cost', 'where', 'are', 'you', 'your', 'what', 'want', 'need', 'have', 'can', 'does', 'with', 'from', 'this', 'that',
    'spot', 'wheretospot', 'located', 'please', 'بكام', 'عايز', 'عاوز', 'محتاج', 'كام', 'ايه', 'اللي', 'عندكم', 'سعر', 'فين', 'انتو', 'ممكن', 'هل', 'عندك', 'لو', 'بتاع', 'بتاعت'];
  function findProducts(t, minTop) {
    if (!catalog || !catalog.length) return [];
    let words = t.split(' ');
    Object.keys(SYN).forEach((k) => { if (t.includes(k)) words.push(SYN[k]); });
    words = words.filter((w) => w.length >= 3 || /^a\d$|^\d+x\d+$/.test(w)).filter((w) => !STOP.includes(w));
    if (!words.length) return [];
    const scored = catalog.map((p) => ({ p, s: words.reduce((n, w) => n + (p.hay.includes(w) ? (w.length > 4 ? 2 : 1) : 0), 0) }))
      .filter((x) => x.s >= 2 || (x.s >= 1 && words.length <= 2)).sort((a, b) => b.s - a.s);
    if (!scored.length) return [];
    // Keep only the closest matches (a "black card" question shouldn't list keychains).
    const top = scored[0].s;
    if (minTop && top < minTop) return [];
    return scored.filter((x) => x.s >= top * 0.75).slice(0, 4).map((x) => x.p);
  }
  function categoryProducts(key) { return (catalog || []).filter((p) => p.cat === key).slice(0, 4); }

  const cardFor = (p) => ({ id: p.id, name: AR && p.nameAr ? p.nameAr : p.name, price: priceOf(p), from: !!((p.variants && p.variants.length) || (p.tiers && p.tiers.length)),
    img: p.images && p.images[0] ? 'api/img.php?src=' + encodeURIComponent(p.images[0]) + '&w=160&v=2' : '', options: !!((p.variants && p.variants.length > 1) || (p.addons && p.addons.length)),
    tiers: (p.tiers && p.tiers.length > 1) || (p.variants || []).some((v) => (v.tiers || []).length > 1),
    // Sizes to choose from in the card (Add to cart / Buy now), and whether anything is in stock.
    vars: (p.variants || []).length > 1 ? p.variants.map((v) => ({ id: v.id, label: T(v.label), price: p.discountPct ? v.price * (1 - p.discountPct / 100) : v.price, out: (v.stock | 0) <= 0 })) : null,
    out: (p.variants || []).length ? p.variants.every((v) => (v.stock | 0) <= 0) : (p.stock | 0) <= 0 });
  // Size names in Arabic, with the shop's own translations when it has them.
  const T = (t) => (AR && window.WTS_T ? window.WTS_T(t) : t);

  const NEEDS = [
    { id: 'nfc', en: 'NFC review cards & stands', ar: 'كروت وستاندات تقييم NFC', kind: 'product' },
    { id: 'cosmetics', en: 'Skincare & cosmetics', ar: 'العناية بالبشرة والتجميل', kind: 'product' },
    { id: 'Printing & signage', en: 'Printing & signage', ar: 'الطباعة واللافتات', kind: 'service' },
    { id: 'Acrylic & fabrication', en: 'Acrylic stands & displays', ar: 'ستاندات وعلب عرض أكريليك', kind: 'service' },
    { id: 'Events & activations', en: 'Exhibition booths & events', ar: 'أجنحة المعارض والفعاليات', kind: 'service' },
    { id: 'Social media & ads', en: 'Marketing, social media & ads', ar: 'التسويق والسوشيال ميديا والإعلانات', kind: 'service' },
    { id: 'Websites & AI tools', en: 'Websites & AI tools', ar: 'المواقع وأدوات الذكاء الاصطناعي', kind: 'service' },
    { id: 'other', en: 'Something else', ar: 'شيء آخر', kind: 'service' },
  ];
  const needLabel = (id, ar) => { const n = NEEDS.find((x) => x.id === id); return n ? (ar ? n.ar : n.en) : id || ''; };

  // ---------- conversation state (kept on this device) ----------
  const fresh = () => ({ log: [], a: {}, quote: null, await: null, lastAr: AR, leadSent: false, cid: Math.random().toString(36).slice(2) });
  let st = load() || fresh();
  if (!st.a) st = fresh();

  // Pull contact details and facts out of any message, so we never ask twice.
  function extract(raw) {
    const t = norm(raw);
    const out = {};
    const email = raw.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
    if (email) out.email = email[0].replace(/[.,;]+$/, '');
    const digits = raw.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).match(/(\+?\d[\d\s-]{8,16}\d)/);
    if (digits) { const d = digits[1].replace(/[\s-]/g, ''); if (/^(\+?20)?0?1[0125]\d{8}$/.test(d) || /^\+\d{9,14}$/.test(d)) out.phone = d; }
    const order = t.match(/wts\s*-?\s*(\d{3,6})/);
    if (order) out.order = 'WTS-' + order[1];
    const name = raw.match(/(?:my name is|i am|i'm|this is|اسمي|انا اسمي|معاك|انا)\s+([A-Za-z؀-ۿ]{2,20}(?:\s+[A-Za-z؀-ۿ]{2,20})?)/i);
    if (name && !/^(interested|looking|from|need|want|عايز|محتاج|عاوز|مهتم)/i.test(name[1])) {
      // "اسمي كريم ورقمي …" / "I'm Karim and my number …": stop at the joining word.
      const parts = name[1].trim().split(/\s+/);
      out.name = (parts[1] && !/^(and|my|from|here|و|ورقم|ورقمي|وده|وايميلي|رقمي|رقم|من)/i.test(parts[1]) ? parts.join(' ') : parts[0]);
    }
    const qty = t.match(/(\d{1,5})\s*(?:[\p{L}]+\s+)?(pcs|pieces|piece|cards|card|stands|stand|units|keychains|حته|حتت|قطعه|قطع|كارت|كروت|ستاند|ستاندات|ميداليه|ميداليات|عدد)/u) || t.match(/(?:qty|quantity|عدد|كميه)\s*(\d{1,5})/);
    if (qty && !out.phone) out.qty = +qty[1];
    // What kind of thing they want, from the words they use.
    const NEED_WORDS = [['nfc', ['nfc', 'card', 'cards', 'كارت', 'كروت', 'review', 'تقييم', 'keychain', 'ميداليه', 'qr']], ['cosmetics', ['serum', 'cream', 'skin', 'cleanser', 'سيروم', 'كريم', 'بشره', 'غسول', 'تجميل']],
      ['Acrylic & fabrication', ['acrylic', 'اكريليك', 'display', 'kiosk', 'كشك']], ['Printing & signage', ['print', 'banner', 'sign', 'sticker', 'menu', 'طباعه', 'بانر', 'يافطه', 'لافته', 'ستيكر', 'منيو']],
      ['Events & activations', ['booth', 'exhibition', 'event', 'معرض', 'جناح', 'ايفنت']], ['Social media & ads', ['ads', 'marketing', 'social', 'leads', 'campaign', 'اعلان', 'تسويق', 'سوشيال']],
      ['Websites & AI tools', ['website', 'web site', 'online store', 'موقع', 'متجر الكتروني', 'chatbot']]];
    const when = [['This week', ['this week', 'asap', 'urgent', 'tomorrow', 'الاسبوع ده', 'الاسبوع دا', 'هذا الاسبوع', 'بكره', 'مستعجل', 'ضروري', 'النهارده']],
      ['This month', ['this month', 'الشهر ده', 'الشهر دا', 'هذا الشهر']], ['Next 1–3 months', ['next month', 'الشهر الجاي', 'الشهر القادم', 'next few months', 'كمان شهر', 'كمان شهرين']]].find(([, ws]) => any(t, ws));
    if (when) out.when = when[0];
    const need = NEED_WORDS.find(([, ws]) => any(t, ws));
    if (need) out.need = need[0];
    return out;
  }

  const ints_hint = (raw) => any(norm(raw), INTENTS.quote.concat(INTENTS.custom, ['need', 'want', 'عايز', 'محتاج', 'عاوز']));
  function intents(t) {
    const found = [];
    Object.keys(INTENTS).forEach((k) => { if (any(t, INTENTS[k])) found.push(k); });
    return found;
  }

  // ---------- answers ----------
  function deliveryAnswer(t, ar) {
    const g = GOV.find(([words]) => any(t, words));
    const lines = [];
    if (g) lines.push(ar ? 'التوصيل لمنطقتك خلال ' + g[1] + ' أيام عمل.' : 'Delivery to your area takes ' + g[1] + ' business days.');
    else lines.push(ar ? 'نوصل لكل محافظات مصر: القاهرة والجيزة خلال 1–3 أيام عمل، الإسكندرية والدلتا والقناة 2–5 أيام، والصعيد وسيناء والبحر الأحمر 3–7 أيام.'
      : 'We deliver to every governorate in Egypt: Cairo & Giza in 1–3 business days, Alexandria, Delta and Canal cities in 2–5, Upper Egypt, Sinai and the Red Sea in 3–7.');
    lines.push(ar ? 'رسوم التوصيل ' + egp(FACTS.fee, true) + ' لأي مكان، ومجاني للطلبات من ' + egp(FACTS.freeOver, true) + '.'
      : 'Delivery is ' + egp(FACTS.fee) + ' anywhere, and free on orders of ' + egp(FACTS.freeOver) + ' or more.');
    lines.push(ar ? 'بنأكد كل طلب بالتليفون أو واتساب قبل الشحن.' : 'We confirm every order by phone or WhatsApp before it ships.');
    return lines.join('\n');
  }
  const ANS = {
    payment: (ar) => ar ? 'تقدر تدفع:\n• أونلاين بالبطاقة (فيزا، ماستركارد، ميزة) عبر Paymob\n• بالمحفظة الإلكترونية (فودافون كاش وغيرها)\n• أو كاش عند الاستلام.\nللشركات: تحويل بنكي أو إنستاباي متاح كمان.'
      : 'You can pay:\n• online by card (Visa, Mastercard, Meeza) through Paymob\n• by mobile wallet (Vodafone Cash and others)\n• or cash on delivery.\nFor companies, bank transfer or InstaPay works too.',
    returns: (ar) => ar ? 'تقدر ترجع المنتجات غير المستخدمة خلال 14 يوم من الاستلام في عبوتها الأصلية. منتجات العناية بالبشرة لازم الختم يكون سليم، والمنتجات المطبوع عليها لوجو أو تصميم خاص مش بترجع إلا لو فيها عيب.\nلو المنتج وصل تالف أو غلط، ابعتلنا صورة خلال 48 ساعة ونبدله أو نرجعلك فلوسك بالكامل.'
      : 'You can return unused items within 14 days of delivery in their original packaging. Skincare must have its seal unbroken, and items printed with your logo or design can only be returned if they’re faulty.\nIf something arrives damaged or wrong, send us a photo within 48 hours and we’ll replace it or refund you in full.',
    location: (ar) => ar ? 'مكتبنا في MQR، طريق الواحات، مدينة 6 أكتوبر، الجيزة.\nبنرد على الرسايل كل يوم، ومواعيد الشغل من الأحد للخميس. يُفضل تحدد معاد قبل الزيارة على ' + FACTS.whatsapp + '.'
      : 'Our office is at MQR, El Wahat Road, 6th of October City, Giza.\nWe answer messages every day; office days are Sunday to Thursday. Please book a visit first on ' + FACTS.whatsapp + '.',
    nfc: (ar) => ar ? 'كروت وستاندات NFC بتخلي العميل يكتبلك تقييم على جوجل في ثواني: يقرّب موبايله من الكارت (أو يصوّر الـ QR) فتفتحله صفحة التقييم بتاعتك على طول، من غير تطبيقات.\nبتشتغل مع أغلب الموبايلات الحديثة (آيفون وأندرويد)، وبنبرمجها على رابط محلك، ونقدر نطبع اسمك ولوجو.'
      : 'Our NFC cards and stands get you Google reviews in seconds: the customer taps their phone on the card (or scans the QR) and your Google review page opens straight away — no app needed.\nThey work with most modern iPhones and Androids. We set them up with your business link and can print your name and logo on them.',
    custom: (ar) => (ar ? 'أيوه، بنطبع اسمك ولوجو وألوان البراند على الكروت والستاندات والمطبوعات. بعد الطلب بنبعتلك التصميم توافق عليه قبل التنفيذ.'
      : 'Yes — we print your name, logo and brand colours on cards, stands and print. After you order we send you the design to approve before production.') +
      (st.a.need && st.a.size ? '' : ar ? '\nابعتلي نوع المنتج والكمية، وأنا أجهزلك عرض سعر.' : '\nTell me the product and the quantity and I’ll get you a quote.'),
    services: (ar) => ar ? 'غير المنتجات، بنقدم: خطط شهرية لجلب العملاء (إعلانات وصفحات هبوط) تبدأ من ' + egp(299, true) + '، طباعة ولافتات، أكريليك وتصنيع، أجنحة معارض وفعاليات، فيديو وتصوير، سوشيال ميديا، ومواقع وأدوات ذكاء اصطناعي.\nقولّي محتاج إيه بالظبط وأجهزلك عرض.'
      : 'Besides products we do: monthly lead-generation plans (ads + landing pages) from ' + egp(299) + ', printing and signage, acrylic and fabrication, exhibition booths and events, video and photo, social media, and websites & AI tools.\nTell me what you need and I’ll prepare a quote.',
    human: (ar) => ar ? 'أكيد! تقدر تكلمنا على واتساب أو تليفون ' + FACTS.whatsapp + '، أو تسيبلي رقمك وفريقنا يكلمك خلال يوم عمل.'
      : 'Of course! Message or call us on WhatsApp at ' + FACTS.whatsapp + ', or leave your number here and the team will call you within one business day.',
    thanks: (ar) => ar ? 'العفو! 😊 لو محتاج أي حاجة تانية أنا موجود.' : 'You’re welcome! 😊 I’m here if you need anything else.',
    bye: (ar) => ar ? 'مع السلامة! نورتنا 🌟' : 'Bye for now — thanks for stopping by! 🌟',
  };

  const homeChips = (ar) => ar ? ['كروت وستاندات NFC', 'التوصيل والأسعار', 'تتبع طلبي', 'عايز عرض سعر', 'كلم حد من الفريق']
    : ['NFC cards & stands', 'Delivery & prices', 'Track my order', 'Get a quote', 'Talk to a person'];
  const CHIP_TEXT = { 'Delivery & prices': 'delivery', 'التوصيل والأسعار': 'توصيل', 'NFC cards & stands': 'nfc card stand price', 'كروت وستاندات NFC': 'nfc كارت ستاند بكام',
    'Track my order': 'track my order', 'تتبع طلبي': 'تتبع طلبي', 'Get a quote': 'quote', 'عايز عرض سعر': 'عرض سعر', 'Talk to a person': 'talk to a person', 'كلم حد من الفريق': 'اكلم حد' };

  // ---------- quote flow: what, how many, details, name, phone ----------
  const QUOTE_STEPS = ['need', 'size', 'details', 'name', 'contact'];
  function quoteAsk(step, ar) {
    const isProd = (NEEDS.find((n) => n.id === st.a.need) || {}).kind === 'product';
    switch (step) {
      case 'need': return { text: ar ? 'تمام، خليني أجهزلك عرض سعر. محتاج إيه بالظبط؟' : 'Great — let’s get you a quote. What do you need?', chips: NEEDS.map((n) => ar ? n.ar : n.en) };
      case 'size': return isProd ? { text: ar ? 'محتاج كمية تقريبًا كام؟' : 'Roughly how many do you need?', chips: ['1–10', '10–50', '50–200', '200+'] }
        : { text: ar ? 'محتاجه إمتى؟' : 'When do you need it?', chips: ar ? ['هذا الأسبوع', 'هذا الشهر', 'خلال 1–3 شهور', 'أستكشف فقط'] : ['This week', 'This month', 'Next 1–3 months', 'Just exploring'] };
      case 'details': return { text: ar ? 'قولّي تفاصيل أكتر: اسم النشاط، المقاسات، اللوجو أو أي حاجة تساعدنا.' : 'Tell me a bit more: your business, sizes, logo, anything that helps us prepare it.', chips: [ar ? 'تخطي' : 'Skip'] };
      case 'name': return { text: ar ? 'تمام! اسمك إيه؟' : 'Thanks! What’s your name?' };
      case 'contact': return { text: ar ? 'أهلًا يا ' + first() + '! إيه أنسب رقم واتساب أو إيميل نكلمك عليه؟' : 'Nice to meet you, ' + first() + '. What’s the best WhatsApp number or email to reach you?' };
    }
  }
  const first = () => (st.a.name || '').split(/\s+/)[0] || '';
  function nextQuoteStep() {
    for (const s of QUOTE_STEPS) {
      if (s === 'need' && st.a.need == null) return s;
      if (s === 'size' && st.a.size == null) return s;
      if (s === 'details' && st.a.details == null) return s;
      if (s === 'name' && !st.a.name) return s;
      if (s === 'contact' && !st.a.contact) return s;
    }
    return null;
  }

  function summary() {
    const lines = [];
    if (st.a.need) lines.push('Needs: ' + needLabel(st.a.need, false));
    if (st.a.size) lines.push('Quantity / timing: ' + st.a.size);
    if (st.a.details) lines.push('Details: ' + st.a.details);
    const asked = st.log.filter((m) => m.who === 'me').map((m) => m.text).slice(-8);
    if (asked.length) lines.push('Customer wrote: ' + asked.join(' | ').slice(0, 600));
    if (st.lastAr) lines.push('Language: Arabic');
    lines.push('Page: ' + (document.title || location.pathname));
    return lines.join('\n');
  }

  async function saveLead() {
    const res = await fetch('api/public.php?action=lead', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: st.a.name, contact: st.a.contact, cat: String(st.a.need || 'chat').slice(0, 40), source: 'Website chat', notes: summary() }) });
    if (!res.ok) throw new Error('failed');
    st.leadSent = true;
    (window.wtsQ = window.wtsQ || []).push(['Lead', { content_category: 'website chat' }]); // ad tracking (api/track.php)
  }

  async function trackOrder(number, email, ar) {
    try {
      // Signed-in customers: their account already knows the order.
      const acc = await fetch('api/public.php?action=account', { credentials: 'same-origin' }).then((x) => x.json()).catch(() => ({}));
      let o = acc.orders && acc.orders.find((x) => x.number === number);
      if (!o && email) {
        const d = await fetch('api/public.php?action=track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number, email }) }).then((x) => x.json());
        o = d.orders && d.orders[0];
      }
      if (!o) return null;
      const T = window.WTS_T || ((x) => x);
      const status = ar ? T(o.status) : o.status;
      let text = (ar ? 'طلبك ' + number + ': ' : 'Order ' + number + ': ') + status + '.';
      if (o.tracking) text += ar ? '\nرقم تتبع بوسطة: ' + o.tracking : '\nBosta tracking number: ' + o.tracking;
      if (o.items) text += '\n' + o.items.map((i) => i.qty + '× ' + i.name).join('\n');
      return { text, links: o.tracking ? [{ href: 'https://bosta.co/tracking-shipments?shipment-number=' + encodeURIComponent(o.tracking), label: ar ? 'تتبع على بوسطة ↗' : 'Track on Bosta ↗' }] : [] };
    } catch (e) { return null; }
  }

  // ---------- the brain ----------
  async function think(raw) {
    const ar = hasArabic(raw) ? true : /[a-z]/i.test(raw) ? false : (st.lastAr != null ? st.lastAr : AR);
    st.lastAr = ar;
    const t = norm(raw);
    const ex = extract(raw);
    if (ex.name && !st.a.name) st.a.name = ex.name;
    if (ex.phone) st.a.phone = ex.phone;
    if (ex.email) st.a.email = ex.email;
    if (ex.phone || ex.email) st.a.contact = [st.a.phone, st.a.email].filter(Boolean).join(' · ');
    if (ex.qty && !st.a.size) st.a.size = String(ex.qty);
    if (ex.when && !st.a.size) st.a.size = ex.when;
    if (ex.need && st.a.need == null && (st.quote || ints_hint(raw))) st.a.need = ex.need;
    const ints = intents(t);
    const out = [];
    let chips = null;

    // 1. Waiting for an email to look up an order.
    if (st.await === 'track_email') {
      if (ex.email || ex.phone) {
        st.await = null;
        const res = await trackOrder(st.trackNo, ex.email || '', ar);
        if (res) return { text: res.text, links: res.links, chips: homeChips(ar) };
        return { text: ar ? 'ملقيتش طلب بالرقم ده والإيميل ده. اتأكد منهم، أو كلمنا على ' + FACTS.whatsapp + '.' : 'I couldn’t find an order with that number and email. Please check them, or message us on ' + FACTS.whatsapp + '.', chips: homeChips(ar) };
      }
      if (!ints.length) return { text: ar ? 'محتاج الإيميل اللي استخدمته في الطلب عشان أدورلك.' : 'I need the email you used at checkout to look it up.' };
      st.await = null;
    }

    // 2. In the middle of a quote: take the answer unless they asked something else.
    if (st.quote) {
      const step = nextQuoteStep();
      if (!step) return finishQuote(ar); // the last thing we needed came in this message
      const isAnswer = !ints.some((i) => ['price', 'delivery', 'payment', 'returns', 'track', 'location', 'nfc'].includes(i)) || step === 'details';
      if (step && isAnswer) {
        const contactOnly = !!(ex.phone || ex.email || ex.name);
        if (step === 'need') {
          const n = NEEDS.find((x) => x.en === raw.trim() || x.ar === raw.trim());
          if (n) st.a.need = n.id;
          else if (ex.need) { st.a.need = ex.need; if (raw.trim().length > 12 && st.a.details == null) st.a.details = raw.trim().slice(0, 600); }
          else if (!contactOnly) st.a.need = raw.trim().slice(0, 60);
          else st.a.need = 'other'; // they skipped ahead to their contact details
        }
        else if (step === 'size') { if (ex.qty) st.a.size = String(ex.qty); else if (ex.when) st.a.size = ex.when; else if (!contactOnly) st.a.size = raw.trim().slice(0, 60); else st.a.size = ''; }
        else if (step === 'details') {
          // Name / phone / email typed here are contact details, not order details.
          let rest = raw.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '').replace(/\+?\d[\d\s-]{8,16}\d/g, '');
          if (ex.name) rest = rest.replace(ex.name, '').replace(/(my name is|i am|i'm|this is|اسمي|انا اسمي|معاك|ورقمي|رقمي|and my number is|my number is)/gi, '');
          rest = rest.replace(/\s+/g, ' ').trim();
          st.a.details = /^(skip|تخطي|لا|no)$/i.test(raw.trim()) || rest.length < 6 ? '' : rest.slice(0, 600);
        }
        else if (step === 'name' && !ex.phone && !ex.email) { if (raw.trim().length < 2) return { text: ar ? 'اكتب اسمك من فضلك.' : 'Please type your name.' }; st.a.name = raw.trim().slice(0, 120); }
        else if (step === 'contact' && !st.a.contact) return { text: ar ? 'من فضلك اكتب رقم موبايل صحيح (مثلًا 01012345678) أو إيميل.' : 'Please enter a valid mobile number (e.g. 01012345678) or an email.' };
        const next = nextQuoteStep();
        if (next) { const q = quoteAsk(next, ar); return { text: q.text, chips: q.chips }; }
        return finishQuote(ar);
      }
    }

    // 3. Order tracking.
    if (ex.order || ints.includes('track')) {
      if (ex.order) {
        st.trackNo = ex.order;
        if (ex.email) { const res = await trackOrder(ex.order, ex.email, ar); if (res) return { text: res.text, links: res.links }; }
        const res = await trackOrder(ex.order, '', ar);
        if (res) return { text: res.text, links: res.links };
        st.await = 'track_email';
        return { text: ar ? 'تمام، وإيه الإيميل اللي استخدمته في الطلب ' + ex.order + '؟' : 'Sure — what email did you use for ' + ex.order + '?' };
      }
      out.push(ar ? 'ابعتلي رقم الطلب (زي WTS-1012) وأنا أقولك حالته.' : 'Send me your order number (like WTS-1012) and I’ll tell you where it is.');
    }

    // 4. Products and prices from the catalog ("what is NFC?" gets an explanation, not a product list).
    await loadCatalog();
    const explaining = ints.includes('explain') && ints.includes('nfc') && !ints.includes('price');
    // Information questions (where, delivery, payment…) only list products on a clear match.
    const infoOnly = ints.some((i) => ['location', 'returns', 'payment', 'delivery', 'track', 'human', 'thanks', 'greet', 'bye'].includes(i)) && !ints.includes('price');
    let products = explaining ? [] : findProducts(t, infoOnly ? 4 : 0);
    if (!products.length && ints.includes('nfc') && ints.includes('price')) products = categoryProducts('nfc');
    if (!products.length && ints.includes('price') && !ints.some((i) => ['delivery', 'services'].includes(i))) {
      const cat = (catalog || []).find((p) => t.includes(norm(p.catLabel)) && p.catLabel);
      if (cat) products = categoryProducts(cat.cat);
    }
    let cards = [];
    if (products.length) {
      cards = products.map(cardFor);
      out.push(ar ? (products.length === 1 ? 'ده اللي لقيته:' : 'دي المنتجات المناسبة:') : (products.length === 1 ? 'Here’s what I found:' : 'Here are the best matches:'));
      if (cards.some((c) => c.tiers)) out.push(ar ? 'كل ما الكمية تزيد، سعر القطعة بيقل — شوف أسعار الكميات في صفحة المنتج.' : 'The more you order, the lower the price per piece — see quantity prices on the product page.');
      if (st.a.size && +st.a.size >= 50) out.push(ar ? 'ولكمية ' + st.a.size + ' قطعة أقدر أجهزلك عرض سعر خاص.' : 'For ' + st.a.size + ' pieces I can get you a special quote too.');
      if (st.a.need == null && ['nfc', 'cosmetics'].includes(products[0].cat)) st.a.need = products[0].cat;
    } else if (ints.includes('price') && !ints.some((i) => ['delivery', 'payment', 'services', 'quote', 'custom'].includes(i))) {
      out.push(ar ? 'أسعارنا بالجنيه المصري: كروت تقييم NFC من ' + egp(200, true) + '، ستاندات NFC + QR من ' + egp(299, true) + '، وخطط التسويق الشهرية من ' + egp(299, true) + '. قولّي المنتج اللي في بالك وأقولك سعره بالظبط.'
        : 'Prices are in EGP: NFC review cards from ' + egp(200) + ', NFC + QR stands from ' + egp(299) + ', and monthly marketing plans from ' + egp(299) + '. Tell me the product you have in mind and I’ll give you the exact price.');
    }

    // 5. Questions about how we work.
    if (ints.includes('delivery')) out.push(deliveryAnswer(t, ar));
    ['payment', 'returns', 'location', 'custom', 'services'].forEach((k) => {
      if (!ints.includes(k)) return;
      if (k === 'services' && (ints.includes('quote') || st.quote) && ex.need) return;
      out.push(ANS[k](ar));
    });
    if (ints.includes('nfc') && !products.length && !ints.includes('price')) {
      out.push(ANS.nfc(ar));
      chips = ar ? ['كروت وستاندات NFC', 'عايز عرض سعر', 'التوصيل والأسعار'] : ['NFC cards & stands', 'Get a quote', 'Delivery & prices'];
    }

    // 6. A person / a quote.
    if (ints.includes('human')) { out.push(ANS.human(ar)); chips = ar ? ['اترك رقمي', 'كمّل على واتساب'] : ['Leave my number', 'Continue on WhatsApp']; }
    if (ints.includes('quote') || (ints.includes('custom') && !st.quote) || /^(leave my number|اترك رقمي)$/i.test(raw.trim())) {
      st.quote = true;
      if (/^(leave my number|اترك رقمي)$/i.test(raw.trim()) && !st.a.need) st.a.need = 'other';
      const next = nextQuoteStep();
      if (next) { const q = quoteAsk(next, ar); return { text: [...out, q.text].join('\n\n'), cards, chips: q.chips }; }
      return finishQuote(ar, out);
    }

    // 7. They left a number or email: save it (we only need a name first).
    if (ex.phone || ex.email) {
      if (!st.a.name) { st.quote = true; return { text: [...out, ar ? 'تمام، سجلت ' + (ex.phone || ex.email) + '. اسمك إيه عشان الفريق يكلمك؟' : 'Got it — ' + (ex.phone || ex.email) + '. What’s your name, so the team knows who to ask for?'].join('\n\n'), cards }; }
      const again = st.leadSent;
      try {
        await saveLead();
        out.push(again ? (ar ? 'تمام يا ' + first() + '، حدّثت بياناتك عند الفريق ✓' : 'Thanks ' + first() + ' — I’ve updated your details with the team ✓')
          : (ar ? 'سجلت بياناتك يا ' + first() + '، وفريقنا هيكلمك خلال يوم عمل ✨' : 'Thanks ' + first() + ' — I’ve passed your details to the team; they’ll contact you within one business day ✨'));
      } catch (e) {}
    }

    // 8. Small talk.
    if (!out.length && !cards.length) {
      if (ints.includes('thanks')) return { text: ANS.thanks(ar), chips: homeChips(ar) };
      if (ints.includes('bye')) return { text: ANS.bye(ar) };
      if (ints.includes('greet')) return { text: ar ? 'أهلًا بيك! 👋 اسألني عن أي منتج أو سعر، التوصيل، الدفع، أو قولّي محتاج إيه وأجهزلك عرض سعر.' : 'Hello! 👋 Ask me about any product or price, delivery, payment — or tell me what you need and I’ll prepare a quote.', chips: homeChips(ar) };
      if (ints.includes('nfc')) return { text: ANS.nfc(ar), chips: homeChips(ar) };
    }

    // 9. Not sure: say so honestly and offer the useful paths.
    if (!out.length && !cards.length) {
      st.misses = (st.misses || 0) + 1;
      return { text: ar ? 'معلش، مش متأكد إني فهمت قصدك. أقدر أساعدك في: المنتجات والأسعار، التوصيل، الدفع، الاسترجاع، تتبع طلب، أو عرض سعر لطلب خاص.' + (st.misses > 1 ? '\nولو تحب، فريقنا يرد عليك بنفسه على واتساب.' : '')
        : 'Sorry, I’m not sure I understood. I can help with products and prices, delivery, payment, returns, tracking an order, or a quote for a custom order.' + (st.misses > 1 ? '\nOr, if you prefer, the team can answer you directly on WhatsApp.' : ''),
        chips: st.misses > 1 ? [...homeChips(ar).slice(0, 3), ar ? 'كمّل على واتساب' : 'Continue on WhatsApp'] : homeChips(ar) };
    }
    st.misses = 0;
    // After answering, suggest a natural next step.
    if (!chips) chips = cards.length ? (ar ? ['التوصيل والأسعار', 'عايز عرض سعر', 'طرق الدفع'] : ['Delivery & prices', 'Get a quote', 'Payment options'])
      : (ar ? ['كروت وستاندات NFC', 'عايز عرض سعر', 'كلم حد من الفريق'] : ['NFC cards & stands', 'Get a quote', 'Talk to a person']);
    return { text: out.join('\n\n'), cards, chips };
  }

  async function finishQuote(ar, before) {
    st.quote = null;
    try {
      await saveLead();
      st.done = true;
      return { text: [...(before || []), ar ? 'شكرًا يا ' + first() + '! ✨ فريقنا استلم طلبك وهيتواصل معاك خلال يوم عمل.\nعايز رد أسرع؟ كمّل معانا على واتساب.'
        : 'Thank you, ' + first() + '! ✨ The team has your request and will contact you within one business day.\nWant a faster answer? Continue on WhatsApp.'].join('\n\n'),
        chips: ar ? ['كمّل على واتساب', 'كروت وستاندات NFC'] : ['Continue on WhatsApp', 'NFC cards & stands'] };
    } catch (e) {
      return { text: ar ? 'عذرًا، الطلب ماوصلش. حاول تاني أو راسلنا على واتساب ' + FACTS.whatsapp + '.' : 'Sorry, that didn’t go through. Please try again, or message us on WhatsApp at ' + FACTS.whatsapp + '.' };
    }
  }

  function waLink() {
    const ar = st.lastAr;
    const msg = (ar ? 'أهلًا Where To Spot' + (st.a.name ? '، أنا ' + st.a.name : '') : 'Hello Where To Spot' + (st.a.name ? ', I’m ' + st.a.name : '')) + '.\n' +
      (st.a.need ? (ar ? 'محتاج: ' : 'I need: ') + needLabel(st.a.need, ar) + '\n' : '') + (st.a.size ? (ar ? 'الكمية/الموعد: ' : 'Quantity / timing: ') + st.a.size + '\n' : '') + (st.a.details ? st.a.details : '');
    return 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(msg.trim());
  }

  // ---------- talking ----------
  function say(m) { st.log.push(m); if (st.log.length > 80) st.log = st.log.slice(-80); save(st); }

  async function answer(text) {
    error = '';
    text = String(text).trim();
    if (!text) return;
    if (/^(continue on whatsapp|كمّل على واتساب)$/i.test(text)) { window.open(waLink(), '_blank', 'noopener'); return; }
    say({ who: 'me', text });
    typing = true; render(true);
    const started = Date.now();
    const cid = st.cid;
    let reply;
    try { reply = await think(CHIP_TEXT[text] || text); } catch (e) { reply = { text: L('Sorry, something went wrong. Please try again.', 'عذرًا، حصلت مشكلة. حاول مرة تانية.') }; }
    // A short pause that grows with the answer, so it reads like a considered reply.
    const wait = Math.min(1600, 450 + (reply.text || '').length * 6) - (Date.now() - started);
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    if (st.cid !== cid) return; // they started over while we were answering
    typing = false;
    say({ who: 'bot', text: reply.text, cards: reply.cards || [], links: reply.links || [], chips: reply.chips || null });
    render(true);
  }

  function restart() { st = fresh(); typing = false; save(st); greet(); }
  function greet() {
    say({ who: 'bot', text: L('Hi! 👋 I’m the Where To Spot assistant.\nAsk me anything — prices, delivery, payment — or tell me what you need and I’ll prepare a quote.',
      'أهلًا! 👋 أنا مساعد Where To Spot.\nاسألني عن أي حاجة — الأسعار، التوصيل، الدفع — أو قولّي محتاج إيه وأجهزلك عرض سعر.'), chips: homeChips(AR) });
    render(true);
  }

  // Product cards in the chat: View, Add to cart and Buy now (with a size picker when the product has sizes).
  const addHref = (id, v, buy) => 'index.html?add=' + encodeURIComponent(id) + (v ? '&v=' + encodeURIComponent(v) : '') + (buy ? '&buy=1' : '');
  function cardsHtml(cards, ar) {
    if (!cards || !cards.length) return '';
    return '<div class="cards">' + cards.map((c) => {
      // Starts on the cheapest size in stock (the "from" price).
      const v0 = c.vars ? (c.vars.filter((v) => !v.out).sort((a, b) => a.price - b.price)[0] || c.vars[0]) : null;
      // Older chat history has no size list: those cards keep View only for products with options.
      const canBuy = !c.out && (c.vars || !c.options);
      return '<div class="pc" data-pc="' + esc(c.id) + '">' + (c.img ? '<img src="' + esc(c.img) + '" alt="" loading="lazy">' : '<span class="pc-ph"></span>') +
        '<div class="pc-t"><b>' + esc(c.name) + '</b><span class="pc-p">' + (v0 ? esc(egp(v0.price, ar)) : (c.from ? (ar ? 'يبدأ من ' : 'from ') : '') + esc(egp(c.price, ar))) + '</span>' +
        (c.vars && canBuy ? '<select class="pc-v" aria-label="' + (ar ? 'اختار المقاس' : 'Choose a size') + '">' + c.vars.map((v) => '<option value="' + esc(v.id) + '" data-price="' + v.price + '"' +
          (v === v0 ? ' selected' : '') + (v.out ? ' disabled' : '') + '>' + esc(v.label) + ' — ' + esc(egp(v.price, ar)) + (v.out ? (ar ? ' (نفد)' : ' (sold out)') : '') + '</option>').join('') + '</select>' : '') +
        '<div class="pc-a"><a href="/p/' + encodeURIComponent(c.id) + '">' + (ar ? 'التفاصيل' : 'View') + '</a>' +
        (canBuy ? '<a class="add" data-buy="0" href="' + esc(addHref(c.id, v0 && v0.id)) + '">' + (ar ? 'أضف للسلة' : 'Add to cart') + '</a>' +
          '<a class="buy" data-buy="1" href="' + esc(addHref(c.id, v0 && v0.id, true)) + '">' + (ar ? 'اشتري الآن' : 'Buy now') + '</a>'
          : c.out ? '<span class="pc-out">' + (ar ? 'نفد حاليًا' : 'Sold out') + '</span>' : '') + '</div></div></div>';
    }).join('') + '</div>';
  }
  // Choosing a size updates the price and the two buttons' links.
  function wireCards() {
    root.querySelectorAll('.pc-v').forEach((sel) => {
      sel.onchange = () => {
        const pc = sel.closest('.pc'), id = pc.dataset.pc, opt = sel.selectedOptions[0];
        pc.querySelector('.pc-p').textContent = egp(+opt.dataset.price, AR || hasArabic(pc.textContent));
        pc.querySelectorAll('[data-buy]').forEach((a) => { a.href = addHref(id, sel.value, a.dataset.buy === '1'); });
      };
    });
  }

  function render(scroll) {
    if (!open) {
      // No pop-up invitation on phones: it would cover the products.
      const showTease = !seen() && !st.leadSent && host.dataset.tease === '1' && !matchMedia('(max-width:760px)').matches;
      r.innerHTML =
        (showTease ? '<div class="tease" id="tease"><button class="x" id="tx" aria-label="' + L('Dismiss', 'إغلاق') + '">✕</button><b>' + L('Looking for something specific?', 'بتدور على حاجة معينة؟') + '</b>' + L('Ask me about prices, delivery, or get a quote.', 'اسألني عن الأسعار أو التوصيل أو اطلب عرض سعر.') + '</div>' : '') +
        '<button class="launch" id="lb" aria-label="' + L('Chat with us', 'تحدث معنا') + '">' + '<span class="bud" aria-hidden="true">' + eyes + '</span></button>';
      root.getElementById('lb').onclick = openChat;
      look();
      const tz = root.getElementById('tease');
      if (tz) {
        tz.onclick = openChat;
        root.getElementById('tx').onclick = (e) => { e.stopPropagation(); markSeen(); host.dataset.tease = '0'; render(); };
      }
      return;
    }
    const lastBot = [...st.log].reverse().find((m) => m.who === 'bot');
    const chips = !typing && lastBot && lastBot === st.log[st.log.length - 1] ? lastBot.chips : null;
    const ar = st.lastAr;
    r.innerHTML = '<div class="scrim" id="scrim"></div>' +
      '<section class="panel' + (AR ? ' rtl' : '') + '" dir="' + (AR ? 'rtl' : 'ltr') + '" role="dialog" aria-label="' + L('Chat with Where To Spot', 'تحدث مع Where To Spot') + '">' +
        '<div class="head"><span class="grab"></span><div class="av bud" aria-hidden="true">' + eyes + '</div>' +
          '<div class="who"><b>Where To Spot</b><span>' + L('Assistant · replies instantly', 'المساعد · يرد فورًا') + '</span></div>' +
          '<button class="hbtn" id="rs" title="' + L('Start over', 'ابدأ من جديد') + '" aria-label="' + L('Start over', 'ابدأ من جديد') + '">↺</button>' +
          '<button class="hbtn" id="cl" title="' + L('Close', 'إغلاق') + '" aria-label="' + L('Close chat', 'إغلاق المحادثة') + '">✕</button></div>' +
        '<div class="msgs" id="msgs" aria-live="polite">' +
          st.log.map((m) => '<div class="m ' + m.who + '"' + (hasArabic(m.text || '') ? ' dir="rtl"' : ' dir="auto"') + '>' + esc(m.text) +
            (m.links && m.links.length ? '<div class="lk">' + m.links.map((l) => '<a href="' + esc(l.href) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a>').join('') + '</div>' : '') + '</div>' +
            cardsHtml(m.cards, hasArabic(m.text || '') || AR)).join('') +
          (typing ? '<div class="m bot typing"><i></i><i></i><i></i></div>' : '') +
        '</div>' +
        (chips && chips.length ? '<div class="chips">' + chips.map((c) => '<button class="chip' + (/whatsapp|واتساب/i.test(c) ? ' wa' : /^(skip|تخطي)$/i.test(c) ? ' ghost' : '') + '" data-c="' + esc(c) + '">' + (/whatsapp|واتساب/i.test(c) ? waIcon : '') + esc(c) + '</button>').join('') + '</div>' : '') +
        (error ? '<div class="err">' + esc(error) + '</div>' : '') +
        '<form id="f"><input id="in" autocomplete="off" enterkeyhint="send" placeholder="' + esc(L('Type your question…', 'اكتب سؤالك…')) + '" aria-label="' + esc(L('Your message', 'رسالتك')) + '"><button class="send" ' + (typing ? 'disabled' : '') + ' aria-label="' + L('Send', 'إرسال') + '"' + (AR ? ' style="transform:scaleX(-1)"' : '') + '>' + sendIcon + '</button></form>' +
        '<div class="fine">' + L('Automatic assistant · we only use your details to reply to you.', 'مساعد آلي · نستخدم بياناتك فقط للرد عليك.') + '</div>' +
      '</section>';
    root.getElementById('cl').onclick = closeChat;
    root.getElementById('scrim').onclick = closeChat;
    root.getElementById('rs').onclick = restart;
    root.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => answer(b.dataset.c)));
    wireCards();
    const f = root.getElementById('f');
    const inp = root.getElementById('in');
    f.onsubmit = (e) => { e.preventDefault(); const v = inp.value; inp.value = ''; if (v.trim() && !typing) answer(v); };
    if (matchMedia('(min-width:521px)').matches) setTimeout(() => inp.focus(), 30);
    look();
    const msgs = root.getElementById('msgs');
    if (msgs && scroll !== false) { msgs.scrollTop = msgs.scrollHeight; requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; }); }
  }

  // The phone's Back button closes the chat instead of leaving the site: opening adds a step to the
  // browser history, Back removes it, and closing with ✕ removes it too.
  const ours = () => history.state && history.state.wtsChat;
  function closeChat() {
    if (!open) return;
    open = false; render();
    if (ours()) history.back();
  }
  window.addEventListener('popstate', () => { if (open && !ours()) { open = false; render(); } });

  function openChat() {
    if (open) return;
    if (!ours()) { try { history.pushState({ ...(history.state || {}), wtsChat: 1 }, ''); } catch (e) {} }
    open = true; markSeen(); host.dataset.tease = '0';
    loadCatalog();
    if (!st.log.length) greet(); else render(true);
  }

  // Other parts of the site can open the assistant, e.g. <a href="#chat">.
  window.wtsOpenChat = openChat;
  window.addEventListener('hashchange', () => { if (location.hash === '#chat') openChat(); });

  // Eyes look toward the mouse; on touch screens they glance around now and then.
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let ptr = null, raf = 0;
  function look() {
    raf = 0;
    if (!ptr) return;
    root.querySelectorAll('.eyes').forEach((el) => {
      const b = el.parentNode.getBoundingClientRect();
      if (!b.width) return;
      const dx = ptr[0] - (b.left + b.width / 2), dy = ptr[1] - (b.top + b.height / 2);
      const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 140) * b.width / 42; // bigger face, wider look
      el.style.transform = 'translate(' + (dx / d * 5 * k).toFixed(2) + 'px,' + (dy / d * 4 * k).toFixed(2) + 'px)';
    });
  }
  if (!still) {
    window.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; ptr = [e.clientX, e.clientY]; if (!raf) raf = requestAnimationFrame(look); }, { passive: true });
    if (matchMedia('(hover: none)').matches) {
      setInterval(() => {
        const el = !document.hidden && root.querySelector('.launch .eyes');
        if (!el) return;
        el.style.transform = Math.random() < .4 ? '' : 'translate(' + ((Math.random() * 2 - 1) * 6).toFixed(1) + 'px,' + ((Math.random() * 2 - 1) * 4).toFixed(1) + 'px)';
      }, 2600);
    }
  }

  function mount() {
    document.body.appendChild(host);
    render();
    if (location.hash === '#chat') openChat();
    // A gentle invitation after a short while, once per visit.
    setTimeout(() => { if (!open && !seen() && !st.leadSent) { host.dataset.tease = '1'; render(); } }, 12000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
