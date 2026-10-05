// Floating "Need help?" assistant for the shop pages.
// A short guided conversation (no AI service, no API keys): it asks what the visitor needs,
// how many / when, their name and phone, then saves them as a lead in the dashboard
// (api/public.php?action=lead) and offers to continue on WhatsApp.
(function () {
  if (window.__wtsChat) return;
  window.__wtsChat = true;

  const WHATSAPP = '201277660666';
  const STORE = 'wts-chat-v1';
  const ACCENT = '#A8552F';

  const NEEDS = [
    { id: 'nfc', label: 'NFC review cards & stands', kind: 'product' },
    { id: 'cosmetics', label: 'Skincare & cosmetics', kind: 'product' },
    { id: 'Printing & signage', label: 'Printing & signage', kind: 'service' },
    { id: 'Acrylic & fabrication', label: 'Acrylic stands & displays', kind: 'service' },
    { id: 'Events & activations', label: 'Exhibition booths & events', kind: 'service' },
    { id: 'Social media & ads', label: 'Marketing, social media & ads', kind: 'service' },
    { id: 'Websites & AI tools', label: 'Websites & AI tools', kind: 'service' },
    { id: 'other', label: 'Something else', kind: 'service' },
  ];
  const QTY = ['1–10', '10–50', '50–200', '200+'];
  const WHEN = ['This week', 'This month', 'Next 1–3 months', 'Just exploring'];

  const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch (e) { return null; } };
  const save = (v) => { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch (e) {} };
  const seen = () => { try { return sessionStorage.getItem(STORE + '-teased') === '1'; } catch (e) { return true; } };
  const markSeen = () => { try { sessionStorage.setItem(STORE + '-teased', '1'); } catch (e) {} };

  let st = load() || { step: 'need', a: {}, log: [], done: false };

  const css = `
  :host{all:initial}
  *{box-sizing:border-box;font-family:'Work Sans',system-ui,-apple-system,sans-serif}
  .launch{position:fixed;right:22px;bottom:22px;z-index:80;display:flex;align-items:center;gap:10px;border:none;cursor:pointer;
    background:#22201D;color:#F7F3ED;border-radius:999px;padding:8px 20px 8px 8px;font-size:14.5px;font-weight:600;
    box-shadow:0 18px 40px -16px rgba(20,18,16,.55);transition:transform .2s ease,box-shadow .2s ease}
  .launch:hover{transform:translateY(-2px);box-shadow:0 22px 44px -16px rgba(20,18,16,.6)}
  .launch .ic{width:40px;height:40px;border-radius:50%;background:${ACCENT};display:grid;place-items:center;position:relative}
  .launch .ic::after{content:'';position:absolute;right:1px;top:1px;width:10px;height:10px;border-radius:50%;background:#4CC26B;border:2px solid #22201D}
  .launch.hide{opacity:0;pointer-events:none;transform:translateY(10px)}
  .tease{position:fixed;right:22px;bottom:86px;z-index:80;max-width:270px;background:#fff;color:#22201D;border-radius:18px 18px 4px 18px;
    padding:14px 36px 14px 16px;font-size:14px;line-height:1.45;box-shadow:0 20px 50px -20px rgba(20,18,16,.45);cursor:pointer;
    animation:up .35s cubic-bezier(.2,.8,.2,1)}
  .tease b{display:block;font-size:14.5px;margin-bottom:2px}
  .tease .x{position:absolute;top:8px;right:8px;border:none;background:none;font-size:16px;color:#8A8478;cursor:pointer;line-height:1;padding:4px}
  .panel{position:fixed;right:22px;bottom:22px;z-index:85;width:min(390px,calc(100vw - 32px));height:min(620px,calc(100vh - 44px));
    background:#F7F3ED;border-radius:24px;overflow:hidden;display:flex;flex-direction:column;
    box-shadow:0 40px 90px -30px rgba(20,18,16,.55),0 0 0 1px rgba(34,32,29,.06);animation:up .3s cubic-bezier(.2,.8,.2,1)}
  @keyframes up{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
  .head{background:#22201D;color:#F7F3ED;padding:18px 18px 18px 20px;display:flex;align-items:center;gap:12px}
  .av{width:42px;height:42px;border-radius:50%;background:#F7F3ED;display:grid;place-items:center;flex:none;overflow:hidden}
  .av img{width:34px;height:20px;object-fit:contain;background:#22201D;border-radius:5px;padding:2px 3px}
  .who{flex:1;min-width:0}
  .who b{display:block;font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:21px;line-height:1.1}
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
  input{flex:1;min-width:0;border:1px solid #DDD6CC;background:#F7F3ED;border-radius:999px;padding:12px 16px;font-size:15px;color:#22201D;outline:none}
  input:focus{border-color:${ACCENT};background:#fff}
  .send{border:none;background:${ACCENT};color:#fff;width:46px;height:46px;border-radius:50%;cursor:pointer;display:grid;place-items:center;flex:none}
  .send:disabled{opacity:.4;cursor:default}
  .err{color:#A13F3F;font-size:12.5px;padding:0 18px 8px}
  .fine{font-size:11.5px;color:#8A8478;text-align:center;padding:0 16px 10px;background:#fff}
  @media (max-width:520px){
    .panel{right:0;bottom:0;width:100vw;height:100dvh;border-radius:0}
    .launch{right:16px;bottom:16px;padding:8px}
    .launch .txt{display:none}
    .tease{right:16px;bottom:76px}
  }
  @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
  `;

  const host = document.createElement('div');
  host.id = 'wts-chat';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>' + css + '</style><div id="r"></div>';
  const r = root.getElementById('r');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const chatIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  const sendIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  const waIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-3.3-.8-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.3z"/></svg>';

  let open = false, typing = false, error = '', busy = false;

  const firstName = () => (st.a.name || '').split(/\s+/)[0] || '';
  const needLabel = () => (NEEDS.find((n) => n.id === st.a.need) || {}).label || st.a.need || '';
  const isProduct = () => (NEEDS.find((n) => n.id === st.a.need) || {}).kind === 'product';

  // What the assistant asks at each step, and the quick replies it offers.
  function prompt(step) {
    switch (step) {
      case 'need': return { q: 'Hi! 👋 I’m the Where To Spot assistant.\nWhat can we help you with today?', chips: NEEDS.map((n) => n.label) };
      case 'size': return isProduct()
        ? { q: 'Great choice. Roughly how many do you need?', chips: QTY }
        : { q: 'Sounds good. When do you need it?', chips: WHEN };
      case 'details': return { q: 'Tell us a little more: your business, branding, sizes or anything else that helps us prepare a quote.', chips: ['Skip'], input: 'Type your message…' };
      case 'name': return { q: 'Thanks! What’s your name?', input: 'Your name' };
      case 'phone': return { q: 'Nice to meet you, ' + firstName() + '. What’s the best phone number (WhatsApp) or email to reach you?', input: '01x xxxx xxxx or email', type: 'tel' };
      default: return { q: '' };
    }
  }

  function say(text, who) { st.log.push({ who, text }); save(st); }

  function botTurn(step) {
    typing = true; render();
    setTimeout(() => { typing = false; st.step = step; say(prompt(step).q, 'bot'); render(true); }, 650);
  }

  function answer(text) {
    error = '';
    const step = st.step;
    text = String(text).trim();
    if (step === 'need') {
      const n = NEEDS.find((x) => x.label === text);
      st.a.need = n ? n.id : text;
      say(text, 'me'); return botTurn('size');
    }
    if (step === 'size') { st.a.size = text; say(text, 'me'); return botTurn('details'); }
    if (step === 'details') { st.a.details = text === 'Skip' ? '' : text.slice(0, 600); say(text, 'me'); return botTurn('name'); }
    if (step === 'name') {
      if (text.length < 2) { error = 'Please type your name.'; return render(); }
      st.a.name = text.slice(0, 120); say(text, 'me'); return botTurn('phone');
    }
    if (step === 'phone') {
      const digits = text.replace(/\D/g, '');
      const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
      if (!email && digits.length < 10) { error = 'Please enter a valid phone number (e.g. 01012345678) or an email.'; return render(); }
      st.a.contact = text.slice(0, 160); say(text, 'me'); return submit();
    }
  }

  function summary() {
    const lines = ['Needs: ' + needLabel()];
    if (st.a.size) lines.push((isProduct() ? 'Quantity: ' : 'Timing: ') + st.a.size);
    if (st.a.details) lines.push('Details: ' + st.a.details);
    lines.push('Page: ' + (document.title || location.pathname));
    return lines.join('\n');
  }

  async function submit() {
    busy = true; typing = true; render();
    try {
      const res = await fetch('api/public.php?action=lead', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: st.a.name, contact: st.a.contact, cat: String(st.a.need).slice(0, 40), source: 'Website chat', notes: summary() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'failed');
      st.done = true; st.step = 'done';
      say('Thank you, ' + firstName() + '! ✨ Our team has your request and will contact you within one business day.\nWant a faster answer? Continue on WhatsApp.', 'bot');
    } catch (e) {
      st.step = 'phone';
      say('Sorry, that didn’t go through. Please try again, or message us on WhatsApp.', 'bot');
    }
    busy = false; typing = false; render(true);
  }

  function waLink() {
    const msg = 'Hello Where To Spot, I’m ' + (st.a.name || '') + '.\n' + summary().split('\nPage:')[0];
    return 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(msg);
  }

  function restart() { st = { step: 'need', a: {}, log: [], done: false }; save(st); botTurn('need'); }

  function render(scroll) {
    if (!open) {
      const showTease = !seen() && !st.done && host.dataset.tease === '1';
      r.innerHTML =
        (showTease ? '<div class="tease" id="tease"><button class="x" id="tx" aria-label="Dismiss">✕</button><b>Looking for something specific?</b>Tell us what you need and we’ll prepare a quote.</div>' : '') +
        '<button class="launch" id="lb" aria-label="Chat with us">' + '<span class="ic">' + chatIcon + '</span><span class="txt">Need help?</span></button>';
      root.getElementById('lb').onclick = openChat;
      const t = root.getElementById('tease');
      if (t) {
        t.onclick = openChat;
        root.getElementById('tx').onclick = (e) => { e.stopPropagation(); markSeen(); host.dataset.tease = '0'; render(); };
      }
      return;
    }
    const p = prompt(st.step);
    const showChips = !typing && !st.done && p.chips;
    const showInput = !st.done && p.input && !typing;
    r.innerHTML =
      '<section class="panel" role="dialog" aria-label="Chat with Where To Spot">' +
        '<div class="head"><div class="av"><img src="images/logo.png" alt=""></div>' +
          '<div class="who"><b>Where To Spot</b><span>Usually replies within a few hours</span></div>' +
          '<button class="hbtn" id="rs" title="Start over" aria-label="Start over">↺</button>' +
          '<button class="hbtn" id="cl" title="Close" aria-label="Close chat">✕</button></div>' +
        '<div class="msgs" id="msgs" aria-live="polite">' +
          st.log.map((m) => '<div class="m ' + m.who + '">' + esc(m.text) + '</div>').join('') +
          (typing ? '<div class="m bot typing"><i></i><i></i><i></i></div>' : '') +
        '</div>' +
        (showChips ? '<div class="chips">' + p.chips.map((c) => '<button class="chip' + (c === 'Skip' ? ' ghost' : '') + '" data-c="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>' : '') +
        (st.done ? '<div class="chips"><a class="chip wa" href="' + esc(waLink()) + '" target="_blank" rel="noopener">' + waIcon + 'Continue on WhatsApp</a>' +
          '<a class="chip ghost" href="index.html#products" id="shop">Browse products</a><button class="chip ghost" id="again">New request</button></div>' : '') +
        (error ? '<div class="err">' + esc(error) + '</div>' : '') +
        (showInput ? '<form id="f"><input id="in" autocomplete="off" ' + (p.type ? 'type="' + p.type + '" inputmode="' + (st.step === 'phone' ? 'tel' : 'text') + '"' : '') + ' placeholder="' + esc(p.input) + '" aria-label="' + esc(p.input) + '"><button class="send" ' + (busy ? 'disabled' : '') + ' aria-label="Send">' + sendIcon + '</button></form>' : '') +
        '<div class="fine">' + (st.done ? 'Thanks for reaching out.' : 'We only use your details to reply to you.') + '</div>' +
      '</section>';
    root.getElementById('cl').onclick = () => { open = false; render(); };
    root.getElementById('rs').onclick = restart;
    root.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => answer(b.dataset.c)));
    const again = root.getElementById('again'); if (again) again.onclick = restart;
    const shop = root.getElementById('shop'); if (shop) shop.onclick = () => { open = false; render(); };
    const f = root.getElementById('f');
    if (f) {
      const inp = root.getElementById('in');
      if (st.step === 'phone' && st.a.contact) inp.value = st.a.contact;
      f.onsubmit = (e) => { e.preventDefault(); if (inp.value.trim()) answer(inp.value); };
      if (matchMedia('(min-width:521px)').matches) setTimeout(() => inp.focus(), 30);
    }
    const msgs = root.getElementById('msgs');
    if (msgs) { msgs.scrollTop = msgs.scrollHeight; requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; }); }
  }

  function openChat() {
    open = true; markSeen(); host.dataset.tease = '0';
    if (!st.log.length) { render(); botTurn('need'); } else render(true);
  }

  // Other parts of the site can open the assistant, e.g. <a href="#chat">.
  window.wtsOpenChat = openChat;
  window.addEventListener('hashchange', () => { if (location.hash === '#chat') openChat(); });

  function mount() {
    document.body.appendChild(host);
    render();
    if (location.hash === '#chat') openChat();
    // A gentle invitation after a short while, once per visit.
    setTimeout(() => { if (!open && !seen() && !st.done) { host.dataset.tease = '1'; render(); } }, 12000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
