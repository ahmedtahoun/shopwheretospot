// Where To Spot team dashboard. Plain JS, talks to ../api/admin.php.
(function () {
  'use strict';

  const API = '../api/admin.php';
  const app = document.getElementById('app');
  const S = { user: null, csrf: null, meta: {}, team: [], cats: [], products: [], route: 'dashboard', range: 'month' };

  // ---------- utils ----------
  // Photos at display size via api/img.php (resized + cached), instead of multi-MB originals.
  const thumb = (path, w) => /^(images|uploads\/products)\/[^?#]+\.(png|jpe?g|webp)$/i.test(path || '') ? '../api/img.php?src=' + encodeURIComponent(path) + '&w=' + w + '&v=2' : '../' + path;
  // Arabic dashboard (admin/i18n.js translates the text): Arabic dates with Western digits, amounts as "1,500 ج.م".
  const AR = window.WTS_LANG === 'ar';
  const LOC = AR ? 'ar-EG-u-nu-latn' : 'en-GB';
  const langBtn = () => '<button type="button" class="langbtn" data-lang-toggle>' + (AR ? 'English' : 'العربية') + '</button>';
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const egp = (n) => AR ? Math.round(Number(n) || 0).toLocaleString('en-US') + ' ج.م' : 'EGP ' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const date = (s) => { if (!s) return '—'; const d = new Date(s.replace(' ', 'T') + 'Z'); return d.toLocaleDateString(LOC, { day: 'numeric', month: 'short', year: 'numeric' }); };
  const dateTime = (s) => { if (!s) return '—'; const d = new Date(s.replace(' ', 'T') + 'Z'); return d.toLocaleString(LOC, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  const can = (perm) => !!(S.user && S.user.perms.includes(perm));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function toast(msg, bad) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = ''; }, Math.max(2600, String(msg).length * 55)); // longer messages stay longer
  }

  async function api(action, { method = 'GET', body, query = '', form } = {}) {
    const opts = { method, credentials: 'same-origin', headers: {} };
    if (method !== 'GET') opts.headers['X-CSRF-Token'] = S.csrf || '';
    if (form) opts.body = form;
    else if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    // Reads are retried once after a network error or a server hiccup; writes are never retried.
    let res;
    for (let attempt = 0; ; attempt++) {
      try {
        // A read gives up after 20 s, so one left hanging while the phone slept can't freeze a page that refreshes itself.
        const ctl = method === 'GET' && window.AbortController ? new AbortController() : null;
        const tm = ctl ? setTimeout(() => ctl.abort(), 20000) : 0;
        try { res = await fetch(API + '?action=' + action + query, ctl ? { ...opts, signal: ctl.signal } : opts); } finally { clearTimeout(tm); }
        if (method === 'GET' && res.status >= 500 && attempt === 0) { await new Promise((r) => setTimeout(r, 700)); continue; }
        break;
      } catch (e) {
        if (method !== 'GET' || attempt > 0) throw new Error('Could not reach the server — check your internet connection and try again.');
        await new Promise((r) => setTimeout(r, 700));
      }
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* non-JSON */ }
    if (res.status === 401 && action !== 'login') { S.user = null; render(); }
    if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
    return data;
  }

  const ORDER_TONE = { 'Awaiting payment': ['', '💳'], Pending: ['warn', '●'], Confirmed: ['info', '◆'], Designing: ['accent', '✎'], 'Awaiting approval': ['warn', '⏳'], 'In production': ['accent', '⚙'], Ready: ['good', '▣'], Shipped: ['info', '➜'], Delivered: ['good', '✓'], Cancelled: ['bad', '✕'], Returned: ['bad', '↩'] };
  const QUOTE_TONE = { Draft: ['', '✎'], Sent: ['info', '➜'], Accepted: ['good', '✓'], Declined: ['bad', '✕'], Expired: ['warn', '◷'] };
  const QUOTE_TERMS = 'All prices are in Egyptian Pounds (EGP).\nThis quote is valid until the date shown.\nDelivery across Egypt.';
  const LEAD_TONE = { New: ['accent', '●'], Contacted: ['info', '◆'], Quoted: ['warn', '✎'], Won: ['good', '✓'], Lost: ['bad', '✕'] };
  const PRODUCT_TONE = { Active: ['good', '✓'], Draft: ['warn', '✎'], Archived: ['bad', '▪'] };
  // Under an order total: paid, deposit with balance, or amount still to collect.
  const payState = (o) => {
    if (o.status === 'Cancelled' || o.status === 'Returned') return o.paid > 0 ? '<div class="small pay-part">' + egp(o.paid) + ' paid · refund?</div>' : '';
    if (o.due == null) return '';
    if (o.due <= 0) return '<div class="small pay-ok">✓ Paid</div>';
    return '<div class="small ' + (o.paid > 0 ? 'pay-part' : 'muted') + '">' + (o.paid > 0 ? 'Deposit · ' : '') + egp(o.due) + ' due</div>';
  };
  // "Acrylic Stand A4(21cm * 29.7cm)" → main name + the size/detail part shown in colour.
  const splitName = (n) => {
    n = String(n || '');
    const m = n.match(/^(.*?)\s*(\(.*\)|—\s*.+)$/);
    return m && m[1] ? [m[1], m[2].replace(/^—\s*/, '')] : [n, ''];
  };
  const itemHtml = (it) => { const [a, b] = splitName(it.name); return '<span class="it"><b class="it-q">' + esc(it.qty) + '×</b> ' + esc(a) + (b ? ' <span class="it-sz">' + esc(b) + '</span>' : '') + '</span>'; };
  const pill = (map, s) => { const t = map[s] || ['', '•']; return '<span class="pill ' + t[0] + '">' + t[1] + ' ' + esc(s) + '</span>'; };
  const ROLE_INFO = { owner: 'Everything, including team, settings and revenue', manager: 'Products, orders, leads, activity and revenue',
    sales: 'Enters orders and leads · sees only their own orders and their money', staff: 'Enters orders and leads · sees only their own orders and their money',
    telesales: 'Orders only · sees only the orders they entered and their money' };

  // ---------- drawer ----------
  function openDrawer(title, bodyHtml, footHtml) {
    closeDrawer();
    const wrap = document.createElement('div');
    wrap.id = 'drawer';
    wrap.innerHTML = '<div class="scrim" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<header><h2>' + esc(title) + '</h2><button class="x" data-close aria-label="Close">✕</button></header>' +
      '<div class="body">' + bodyHtml + '</div>' + (footHtml ? '<footer>' + footHtml + '</footer>' : '') + '</aside>';
    document.body.appendChild(wrap);
    $$('[data-close]', wrap).forEach((b) => b.addEventListener('click', closeDrawer));
    document.addEventListener('keydown', escClose);
    const first = $('input,select,textarea', wrap);
    if (first) first.focus();
    return wrap;
  }
  function escClose(e) { if (e.key === 'Escape') closeDrawer(); }
  function closeDrawer() { const d = document.getElementById('drawer'); if (d) d.remove(); document.removeEventListener('keydown', escClose); }

  function formData(form) {
    const o = {};
    new FormData(form).forEach((v, k) => { o[k] = v; });
    $$('input[type=checkbox]', form).forEach((c) => { o[c.name] = c.checked ? 1 : 0; });
    return o;
  }

  // ---------- boot / auth ----------
  async function boot() {
    try {
      const s = await api('session');
      S.user = s.user; S.csrf = s.csrf; S.meta = s;
      if (S.user) sendDeviceHints();
      if (S.user && s.askLocation) {
        // Save the phone's answer quietly (the location, or that it wasn't allowed). A phone that already said
        // "Allow" answers without asking; one that said "Don't allow" isn't asked again.
        const p = S.locPending || locationPermission().then((st) => st === 'denied' ? { denied: 'denied' } : locateOnce()); S.locPending = null;
        p.then((r) => api('login_location', { method: 'POST', body: r }).catch(() => {}));
      } else if (S.user && s.refreshLocation) {
        // Once a day, only where location is already allowed (no prompt ever comes from this).
        locationPermission().then((st) => { if (st === 'granted') locateOnce().then((r) => { if (!r.denied) api('login_location', { method: 'POST', body: r }).catch(() => {}); }); });
      }
    } catch (e) {
      app.innerHTML = '<div class="auth"><div class="auth-card"><h1>Can’t reach the server</h1><p>' + esc(e.message) + '</p></div></div>';
      return;
    }
    window.addEventListener('hashchange', route);
    // WhatsApp inbox on phones: the back gesture closes an open chat; coming back to the app refreshes it at once.
    window.addEventListener('popstate', () => { if (S.route === 'inbox' && waInbox.closeChat && !(history.state && history.state.waChat) && waInbox.chatId) waInbox.closeChat(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && S.route === 'inbox' && waInbox.wake) waInbox.wake(); });
    route();
  }

  // The phone or computer in use (Team → person → Devices): Android Chrome gives the exact model;
  // iPhones only the screen size, which narrows down the model. Sent once per sign-in.
  async function sendDeviceHints() {
    const key = 'wts-dev-' + S.user.id;
    try { if (sessionStorage.getItem(key)) return; } catch (e) {}
    const h = { screen: Math.round(screen.width) + 'x' + Math.round(screen.height) };
    try {
      const uad = navigator.userAgentData;
      if (uad && uad.getHighEntropyValues) { const v = await uad.getHighEntropyValues(['model', 'platform', 'platformVersion']); h.model = v.model || ''; h.platform = v.platform || ''; h.platformVersion = v.platformVersion || ''; }
    } catch (e) {}
    if (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) h.platform = 'iPadOS';
    try { await api('device_hints', { method: 'POST', body: h }); sessionStorage.setItem(key, '1'); } catch (e) {}
  }

  // The owner turned on "Ask for location at sign-in": the phone shows its own Allow / Don't allow,
  // and the answer is saved once with this sign-in.
  // iPhones only show "Allow location?" after a tap, so this asks with a button. Kept outside #app so
  // page changes behind it don't close it.
  // One location reading, as { lat, lng, acc } or { denied: why }.
  // 'granted' (reads silently), 'denied' (won't ask), 'prompt' (the phone would ask) or 'unknown' (older browsers).
  function locationPermission() {
    try { return navigator.permissions && navigator.permissions.query ? navigator.permissions.query({ name: 'geolocation' }).then((p) => p.state, () => 'unknown') : Promise.resolve('unknown'); }
    catch (e) { return Promise.resolve('unknown'); }
  }
  function locateOnce() {
    return new Promise((res) => {
      if (!navigator.geolocation) { res({ denied: 'unavailable' }); return; }
      navigator.geolocation.getCurrentPosition(
        (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
        (e) => res({ denied: e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable' }),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
    });
  }

  function route() {
    let h = (location.hash || '#dashboard').slice(1);
    // #inbox/<chat id>: the "Open chat" button in a Telegram alert.
    const m = h.match(/^inbox\/(\d+)$/);
    if (m) { S.openWaChat = +m[1]; h = 'inbox'; history.replaceState(null, '', '#inbox'); }
    S.route = h || 'dashboard';
    render();
  }

  function render() {
    closeDrawer();
    if (!S.user) return S.meta.needsSetup ? renderSetup() : renderLogin();
    const nav = [
      ['dashboard', 'Dashboard', 'home'], ['inbox', 'Chats', 'chat'], ['orders', 'Orders', 'bag'], ['quotes', 'Quotes', 'file'], ['customers', 'Customers', 'person'], ['products', 'Products', 'box'], ['brands', 'Partner brands', 'star'], ['promos', 'Promo codes', 'tag'],
      ['leads', 'Leads', 'inbox'], ['reports', 'Monthly reports', 'chart'], ['commissions', 'Salaries & commissions', 'coins'], ['expenses', 'Expenses & suppliers', 'receipt'], ['team', 'Team', 'users'], ['activity', 'Activity', 'pulse'], ['backups', 'Backups', 'shield'], ['settings', 'Settings', 'key'],
    ].filter(([k]) => k === 'inbox' ? can('whatsapp') : k === 'commissions' ? can('targets') && can('revenue') : k === 'expenses' || k === 'reports' ? can('revenue') : can('orders_only') ? k === 'dashboard' || k === 'orders' : can(k === 'customers' ? 'orders' : k === 'quotes' ? 'sell' : k === 'settings' ? 'backups' : k === 'promos' || k === 'brands' ? 'products' : k));
    const initials = S.user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    if (!nav.some(([k]) => k === S.route)) S.route = nav[0][0];
    app.innerHTML =
      '<div class="mobilebar"><button id="menuBtn" aria-label="Menu">' + icon('menu') + '</button><span class="brand-mark"><img src="../images/logo.png?v=3" alt="">Where To Spot</span>' + langBtn() + '</div>' +
      '<div class="shell"><nav class="side" id="side">' +
      '<div class="brand"><span class="logo"><img src="../images/logo.png?v=3" alt=""></span><span><b>Where To Spot</b><small>Team workspace</small></span></div>' +
      (can('orders_only') ? '' : '<button class="searchbtn" id="searchBtn">' + icon('search') + '<span>Search</span><kbd>/</kbd></button>') +
      '<div class="nav-label">Workspace</div>' +
      nav.map(([k, label, ic]) => '<a class="nav' + (S.route === k ? ' on' : '') + '" href="#' + k + '">' + icon(ic) + '<span>' + label + '</span>' + (k === 'inbox' ? '<span class="nav-badge" id="waBadge"' + (S.waUnread ? '' : ' hidden') + '>' + (S.waUnread || '') + '</span>' : '') + '</a>').join('') +
      '<div class="nav-label">Shop</div>' +
      '<a class="nav" href="../index.html" target="_blank" rel="noopener">' + icon('external') + '<span>View shop</span></a>' +
      (isStandalone() ? '' : '<button class="nav" id="installBtn"' + (installEvt || isIOS() ? '' : ' hidden') + '>' + icon('download') + '<span>Install the app</span></button>') +
      '<div class="foot"><div class="me-card"><span class="avatar">' + esc(initials) + '</span><span class="who"><b>' + esc(S.user.name) + '</b><small>' + esc(S.user.role) + '</small></span></div>' +
      '<div class="foot-actions"><button id="pwBtn">' + icon('key') + 'Password</button><button id="outBtn">' + icon('logout') + 'Sign out</button></div>' +
      '<div class="foot-actions" style="grid-template-columns:1fr"><button data-lang-toggle>🌐 ' + (AR ? 'English' : 'العربية') + '</button></div></div>' +
      '</nav><main class="main" id="main"><div class="boot">Loading…</div></main></div>';
    $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
    $$('#side a.nav').forEach((a) => a.addEventListener('click', () => $('#side').classList.remove('open')));
    $('#outBtn').onclick = async () => { await api('logout', { method: 'POST' }).catch(() => {}); S.user = null; S.csrf = null; render(); };
    $('#pwBtn').onclick = changePassword;
    const sb = $('#searchBtn'); if (sb) sb.onclick = openSearch;
    const ib = $('#installBtn'); if (ib) ib.onclick = installApp;
    const pages = { dashboard: pageDashboard, inbox: pageInbox, orders: pageOrders, quotes: pageQuotes, customers: pageCustomers, products: pageProducts, brands: pageBrands, promos: pagePromos, leads: pageLeads, commissions: pageCommissions, reports: pageReports, expenses: pageExpenses, team: pageTeam, activity: pageActivity, backups: pageBackups, settings: pageSettings };
    document.body.classList.toggle('in-inbox', S.route === 'inbox');
    pages[S.route]().catch((e) => { $('#main').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
    waWatch();
  }

  const authAside = () => '<aside class="auth-side"><span class="logo"><img src="../images/logo.png?v=3" alt=""></span>' +
    '<div><h2>Orders, leads and production, <em>in one place.</em></h2><p>The Where To Spot team workspace.</p></div>' +
    '<small>© ' + new Date().getFullYear() + ' Where To Spot</small></aside>';

  function renderLogin() {
    app.innerHTML = '<div class="auth">' + authAside() + '<form class="auth-card stack" id="f">' +
      langBtn() + '<div><h1>Welcome back</h1><p>Sign in to the Where To Spot team workspace.</p></div>' +
      '<label class="field">Email<input type="email" name="email" required autocomplete="username"></label>' +
      '<label class="field">Password<input type="password" name="password" required autocomplete="current-password"></label>' +
      '<div class="err" id="err"></div><button class="btn primary" type="submit">Sign in</button></form></div>';
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      $('#err').textContent = '';
      // The Sign in tap also asks for the location: the phone shows its own "Allow location?" and
      // nothing else appears (iPhones only show it from a tap, so it starts here, before any await).
      const loc = S.meta.locationAtSignIn ? locateOnce() : null;
      try { await api('login', { method: 'POST', body: formData(e.target) }); S.locPending = loc; await boot(); }
      catch (err) { $('#err').textContent = err.message; }
    };
    $('input[name=email]').focus();
  }

  function renderSetup() {
    app.innerHTML = '<div class="auth">' + authAside() + '<form class="auth-card stack" id="f">' +
      langBtn() + '<div><h1>Create the owner account</h1><p>First-time setup. Enter the setup key from <code>' + esc(S.meta.setupKeyPath || 'SETUP_KEY.txt') + '</code> on the server (open it in cPanel → File Manager). The key stops working once this account exists.</p></div>' +
      '<label class="field">Setup key<input type="text" name="key" required autocomplete="off"></label>' +
      '<label class="field">Your name<input type="text" name="name" required></label>' +
      '<label class="field">Email<input type="email" name="email" required autocomplete="username"></label>' +
      '<label class="field">Password <span class="hint">At least 8 characters</span><input type="password" name="password" required minlength="8" autocomplete="new-password"></label>' +
      '<div class="err" id="err"></div><button class="btn primary" type="submit">Create account</button></form></div>';
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('setup', { method: 'POST', body: formData(e.target) }); await boot(); }
      catch (err) { $('#err').textContent = err.message; }
    };
  }

  function changePassword() {
    const d = openDrawer('Change password',
      '<form id="pf" class="stack"><label class="field">Current password<input type="password" name="current" required autocomplete="current-password"></label>' +
      '<label class="field">New password <span class="hint">At least 8 characters</span><input type="password" name="new" required minlength="8" autocomplete="new-password"></label><div class="err" id="perr"></div></form>',
      '<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" form="pf" type="submit">Save password</button>');
    $$('[data-close]', d).forEach((b) => b.addEventListener('click', closeDrawer));
    $('#pf').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('password', { method: 'POST', body: formData(e.target) }); closeDrawer(); toast('Password changed'); }
      catch (err) { $('#perr').textContent = err.message; }
    };
  }

  // Line icons for the sidebar (24px grid, stroke-based).
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    bag: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    inbox: '<path d="M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
    logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H4"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
    cart: '<path d="M3 4h2l2.4 11h11l2-8H6.2"/><circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    send: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>',
    clip: '<path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7M9 15v2c0 1.7 2.7 3 6 3s6-1.3 6-3v-5c0-1.7-2.7-3-6-3"/>',
  };
  const icon = (n) => '<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[n] || '') + '</svg>';

  function header(title, sub, actions) {
    return '<div class="top"><div><h1>' + esc(title) + '</h1>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div><div class="row">' + (actions || '') + '</div></div>';
  }

  // ---------- dashboard ----------
  async function pageDashboard() {
    // Calendar months (Cairo) by default; the rolling 7/30/90 days are still there.
    const d = await api('dashboard', { query: typeof S.range === 'string' ? '&period=' + S.range : '&days=' + S.range });
    const fmtDay = (x) => new Date(x + 'T12:00:00').toLocaleDateString(LOC, { day: 'numeric', month: 'short' });
    const periodText = d.period === 'month' ? 'this month (' + fmtDay(d.from) + ' – ' + fmtDay(d.to) + ')' : d.period === 'last' ? new Date(d.from + 'T12:00:00').toLocaleDateString(LOC, { month: 'long', year: 'numeric' }) : 'the last ' + d.days + ' days';
    const periodShort = d.period === 'days' ? 'last ' + d.days + ' days' : d.period === 'month' ? 'this month' : 'last month';
    const k = d.kpi;
    const statuses = S.meta.orderStatuses.map((s) => [s, d.statusCounts[s] || 0]);
    const maxStatus = Math.max(1, ...statuses.map((s) => s[1]));
    const rangeSeg = '<div class="seg" id="range">' + [['month', 'This month'], ['last', 'Last month'], [7, '7 days'], [30, '30 days'], [90, '90 days']].map(([v, l]) => '<button data-d="' + v + '" class="' + (S.range === v ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
    const perf = d.performance || { members: [] };
    const monthName = new Date(perf.month + '-01T00:00:00').toLocaleDateString(LOC, { month: 'long', year: 'numeric' });
    const money = !!d.money;
    const mine = d.own ? perf.members[0] : !money ? perf.members.find((m) => m.id === S.user.id) : null;
    const actions = (can('sell') ? '<button class="btn primary" id="dashNew">+ New order</button>' : '') + rangeSeg;
    $('#main').innerHTML = header('Dashboard', 'Hello ' + esc(S.user.name.split(' ')[0]) + ' — here’s ' + (d.own ? 'your work in ' : '') + periodText + '.', actions) +
      // First week of a month: last month's report is ready.
      (d.reportReady && can('revenue') ? '<a class="banner-link" href="#reports" data-rm="' + d.reportReady + '">📊 <b>' + esc(new Date(d.reportReady + '-01T12:00:00').toLocaleDateString(LOC, { month: 'long', year: 'numeric' })) + ' report is ready</b> <span>· orders, sales, expenses and profit →</span></a>' : '') +
      (mine ? '<div class="me">' + targetCard('My orders · ' + monthName, mine.orders, mine.orders_target, (n) => n) +
        (money ? targetCard('My sales · ' + monthName, mine.revenue, mine.revenue_target, egp)
          : '<div class="kpi"><div class="label">My delivered · ' + esc(monthName) + '</div><div class="value">' + mine.delivered + '</div><div class="note">' + mine.lost + ' cancelled or returned</div></div>') +
        (d.myCommission ? '<div class="kpi"><div class="label">My commission · ' + esc(monthName) + '</div><div class="value pay-ok">' + egp(d.myCommission.commission) + '</div><div class="note">' +
          d.myCommission.pct + '% of ' + egp(d.myCommission.base) + ' delivered' + (d.myCommission.pending > 0 ? ' · ' + egp(d.myCommission.pending) + ' more on the way' : '') + '</div></div>' : '') + '</div>' : '') +
      '<div class="kpis">' +
      (money ? kpi('Revenue', egp(k.revenue), 'excl. cancelled & returned') : kpi('Waiting to confirm', k.pending, '<a href="#orders" data-status="Pending">Call them now →</a>')) +
      kpi('Orders', k.orders, money ? 'avg ' + egp(k.aov) : periodShort + ', excl. cancelled') +
      (money && !d.own ? '' : kpi('Shipped', k.shipped, 'on the way now') + kpi('Delivered', k.delivered, 'all time') + kpi('Cancelled / returned', k.lost, 'all time')) +
      (d.spent ? kpi('Expenses', egp(d.spent.total), periodShort + ' · <a href="#expenses">Open →</a>') : '') +
      (d.spent && d.spent.owed > 0 ? kpi('Owed to suppliers', egp(d.spent.owed), '<a href="#expenses" data-xsup>View suppliers →</a>') : '') +
      (d.toCollect ? kpi('To collect', egp(d.toCollect.amount), d.toCollect.orders ? d.toCollect.orders + ' order' + (d.toCollect.orders > 1 ? 's' : '') + ' with a balance' : 'everything is paid') : '') +
      (d.openQuotes ? kpi('Open quotes', d.openQuotes.n, d.openQuotes.n ? (money ? egp(d.openQuotes.value) + ' waiting · ' : '') + '<a href="#quotes">View →</a>' : '<a href="#quotes">Make a quote →</a>') : '') +
      (money ? kpi('Waiting to confirm', k.pending, can('orders') ? '<a href="#orders" data-status="Pending">View pending →</a>' : 'orders') : '') +
      (can('leads') ? kpi('New leads', k.newLeads, '<a href="#leads">Open leads →</a>') : '') +
      (can('products') ? kpi('Live products', k.products, '<a href="#products">Manage →</a>') : '') +
      '</div>' +
      (can('leads') && (d.followUps || []).length ? '<div style="margin-bottom:16px">' + followUpCard(d.followUps) + '</div>' : '') +
      // Sign-ins from a device the person never used before (owner only, last 7 days).
      ((d.newDevices || []).length ? '<div class="card" style="margin-bottom:16px"><h2>' + icon('shield') + 'New devices this week<span class="spacer"></span><a class="btn sm" href="#team">Team</a></h2><div class="list">' +
        d.newDevices.map((n) => '<div class="li"><span><b>' + esc(n.name) + '</b><div class="small muted">' + esc(n.label || 'Unknown device') + (n.city ? ' · ' + esc(n.city) : '') + (n.isp ? ' · ' + esc(n.isp) : '') + '</div></span><span class="small muted">' + dateTime(n.at) + '</span></div>').join('') + '</div></div>' : '') +
      '<div class="dash"><div class="cards">' +
      '<div class="card"><h2>' + (money ? 'Daily revenue (EGP)' : 'Orders per day') + '</h2><div class="chart" id="chart"></div></div>' +
      '<div class="card"><h2>Recent orders<span class="spacer"></span>' + (can('orders') ? '<a class="btn sm" href="#orders">All orders</a>' : '') + '</h2>' +
      // A two-column list (not a table) so it stays readable on a phone.
      (d.recentOrders.length ? '<div class="list">' + d.recentOrders.map((o) =>
        '<div class="li" style="align-items:flex-start;gap:12px;padding:12px 0"><span style="min-width:0"><b>' + esc(o.number) + '</b><div class="small muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(o.customer) + '</div><div class="small muted">' + dateTime(o.createdAt) + '</div></span>' +
        '<span style="text-align:right;flex-shrink:0">' + (money ? '<b>' + egp(o.total) + '</b>' : '') + '<div style="margin-top:4px">' + pill(ORDER_TONE, o.status) + '</div></span></div>').join('') +
        '</div>' : '<div class="empty">No orders yet.</div>') + '</div>' +
      '</div><div class="cards">' +
      (can('leads') && !(d.followUps || []).length ? followUpCard([]) : '') +
      (can('backups') ? '<div class="card"><h2>' + icon('shield') + 'Backups<span class="spacer"></span><a class="btn sm" href="#backups">Manage</a></h2><div class="small muted">' +
        (d.lastBackup ? 'Last copy saved ' + dateTime(d.lastBackup.created) + ' · ' + fmtSize(d.lastBackup.size) : 'The first backup will be saved in a moment.') + '</div></div>' : '') +
      (d.profit ? '<div class="card"><h2>Estimated profit<span class="spacer"></span><span class="pill good">' + d.profit.margin + '% margin</span></h2>' +
        '<div class="kpi-inline"><b>' + egp(d.profit.profit) + '</b><span class="small muted">from ' + egp(d.profit.revenue) + ' sales − ' + egp(d.profit.cost) + ' cost</span></div>' +
        (d.profit.coverage < 100 ? '<div class="hint" style="margin-top:8px">Covers ' + d.profit.coverage + '% of sales. Add cost prices to the remaining products for a full picture.</div>' : '') + '</div>'
        : can('products') ? '<div class="card"><h2>Estimated profit</h2><div class="small muted">Add a cost price to your products (Products → edit → Cost) and profit for this period appears here.</div></div>' : '') +
      (d.leadSources && d.leadSources.length ? '<div class="card"><h2>Where leads come from</h2><div class="list">' + d.leadSources.map((r) =>
        '<div class="li"><span>' + esc(r.source) + ' <span class="muted small">' + r.n + ' lead' + (r.n > 1 ? 's' : '') + '</span></span><span class="small"><b>' + r.won + '</b> won · ' + Math.round(r.won / r.n * 100) + '%</span></div>').join('') + '</div></div>' : '') +
      // Abandoned checkouts (api/abandoned.php): left at checkout with a phone number, and how many ordered after a follow-up.
      (d.abandoned && d.abandoned.abandoned ? '<div class="card"><h2>Abandoned checkouts</h2><div class="list">' +
        '<div class="li"><span>Left without ordering <span class="muted small">' + d.abandoned.abandoned + '</span></span><b>' + (money ? egp(d.abandoned.abandonedValue) : d.abandoned.abandoned) + '</b></div>' +
        '<div class="li"><span>Recovered after a follow-up <span class="muted small">' + d.abandoned.recovered + ' · ' + Math.round(d.abandoned.recovered / d.abandoned.abandoned * 100) + '%</span></span><b>' + (money ? egp(d.abandoned.recoveredValue) : d.abandoned.recovered) + '</b></div></div>' +
        '<div class="row" style="margin-top:10px"><a class="btn sm" href="#leads" id="abLeads">Follow them up in Leads</a></div></div>' : '') +
      '<div class="card"><h2>Orders by status</h2>' + statuses.map(([s, n]) =>
        '<div class="hbar"><span>' + pill(ORDER_TONE, s) + '</span><div class="track"><div class="fill" style="width:' + (n / maxStatus * 100) + '%"></div></div><span class="num" style="text-align:right">' + n + '</span></div>').join('') + '</div>' +
      '<div class="card"><h2>Top products</h2>' + (d.topProducts.length ? '<div class="list">' + d.topProducts.map((p) =>
        '<div class="li"><span>' + esc(p.name) + (money ? ' <span class="muted small">× ' + p.qty + '</span>' : '') + '</span><b>' + (money ? egp(p.revenue) : p.qty + ' pcs') + '</b></div>').join('') + '</div>' : '<div class="muted">No sales in this period.</div>') + '</div>' +
      (can('orders_only') ? '' : '<div class="card"><h2>Low stock <span class="pill warn">⚠ 5 or fewer</span></h2>' + (d.lowStock.length ? '<div class="list">' + d.lowStock.map((p) =>
        '<div class="li"><span>' + esc(p.name) + '</span><b>' + p.stock + ' left</b></div>').join('') + '</div>' : '<div class="muted">All products are well stocked.</div>') + '</div>') +
      (d.sources && d.sources.length ? '<div class="card"><h2>Orders by source</h2><div class="list">' + d.sources.map((r) =>
        '<div class="li"><span>' + esc(r.source) + (money ? ' <span class="muted small">' + r.n + ' orders</span>' : '') + '</span><b>' + (money ? egp(r.revenue) : r.n + ' orders') + '</b></div>').join('') + '</div></div>' : '') +
      '</div></div>' +
      (!d.own && !can('orders_only') ? teamPerformanceCard(perf, monthName, money) : '');
    $$('#range button').forEach((b) => b.onclick = () => { S.range = /^\d+$/.test(b.dataset.d) ? +b.dataset.d : b.dataset.d; pageDashboard(); });
    const ab = $('#abLeads'); if (ab) ab.onclick = () => { S.leadQ = 'Left checkout'; S.leadStatus = ''; S.leadView = 'list'; };
    const rl = $('[data-rm]'); if (rl) rl.onclick = () => { S.reportMonth = rl.dataset.rm; };
    const dn = $('#dashNew'); if (dn) dn.onclick = () => newOrderDrawer();
    const xsu = $('[data-xsup]'); if (xsu) xsu.onclick = () => { S.expTab = 'suppliers'; };
    const tb = $('#setTargets'); if (tb) tb.onclick = () => targetsDrawer(perf.month);
    const pend = $('[data-status=Pending]'); if (pend) pend.onclick = () => { S.orderStatus = 'Pending'; };
    drawChart($('#chart'), money ? d.series : d.series.map((x) => ({ ...x, revenue: x.orders })), !money);
    $$('[data-fu]').forEach((r) => r.onclick = (e) => { if (e.target.closest('a')) return; S.leadStatus = 'due'; S.leadView = 'list'; S.openLead = +r.dataset.fu; location.hash = '#leads'; });
    const fa = $('#fuAll'); if (fa) fa.onclick = () => { S.leadStatus = 'due'; S.leadView = 'list'; };
  }

  function followUpCard(list) {
    return '<div class="card"><h2>' + icon('clock') + 'Follow up today' + (list.length ? ' <span class="pill bad">' + list.length + '</span>' : '') + '<span class="spacer"></span>' +
      (list.length ? '<a class="btn sm" href="#leads" id="fuAll">View all</a>' : '') + '</h2>' +
      (list.length ? '<div class="list">' + list.map((l) => '<div class="li fu" data-fu="' + l.id + '"><span><b>' + esc(l.name) + '</b><div class="small muted">' + esc(leadInterest(l)) + (l.assigned_name ? ' · ' + esc(l.assigned_name) : '') + '</div></span>' +
        '<span class="row" style="gap:6px;flex-wrap:nowrap">' + followChip(l) + waBtn(l) + '</span></div>').join('') + '</div>'
        : '<div class="muted small">Nothing due. Set a follow-up date on a lead and it shows here on that day.</div>') + '</div>';
  }
  const pct = (v, t) => t > 0 ? Math.min(100, Math.round(v / t * 100)) : 0;
  const progress = (v, t) => t > 0 ? '<div class="prog' + (v >= t ? ' done' : '') + '" role="progressbar" aria-valuenow="' + pct(v, t) + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + pct(v, t) + '%"></i></div>' : '';
  function targetCard(label, value, target, fmt) {
    return '<div class="kpi"><div class="label">' + esc(label) + '</div><div class="value">' + esc(fmt(value)) + (target ? ' <span class="muted" style="font-size:18px">/ ' + esc(fmt(target)) + '</span>' : '') + '</div>' +
      (target ? progress(value, target) + '<div class="note">' + (value >= target ? '✓ Target reached' : pct(value, target) + '% of target · ' + esc(fmt(Math.max(0, target - value))) + ' to go') + '</div>'
        : '<div class="note">No target set for this month</div>') + '</div>';
  }
  function teamPerformanceCard(perf, monthName, money) {
    const rows = perf.members.filter((m) => m.orders || m.orders_target || m.revenue_target || m.role === 'sales' || m.role === 'telesales');
    return '<div class="card" style="margin-top:16px"><h2>Team this month · ' + esc(monthName) + '<span class="spacer"></span>' +
      (can('targets') && money ? '<a class="btn sm" href="#commissions">' + icon('coins') + 'Commissions</a>' : '') + (can('targets') ? '<button class="btn sm" id="setTargets">🎯 Set targets</button>' : '') + '</h2>' +
      (rows.length ? '<div class="table-wrap" style="border:none"><table class="perf"><thead><tr><th>Team member</th><th>Orders</th>' + (money ? '<th>Sales (EGP)</th>' : '') + '<th class="num">Delivered</th><th class="num">Cancelled / returned</th><th>Last order</th></tr></thead><tbody>' +
        rows.map((m) => '<tr><td><b>' + esc(m.name) + '</b><div class="small muted">' + esc(m.role) + '</div></td>' +
          '<td>' + m.orders + (m.orders_target ? ' <span class="muted">/ ' + m.orders_target + '</span>' : '') + progress(m.orders, m.orders_target) + '</td>' +
          (money ? '<td>' + egp(m.revenue) + (m.revenue_target ? ' <span class="muted">/ ' + egp(m.revenue_target) + '</span>' : '') + progress(m.revenue, m.revenue_target) + '</td>' : '') +
          '<td class="num">' + m.delivered + '</td><td class="num">' + m.lost + '</td><td class="small muted">' + dateTime(m.last_order) + '</td></tr>').join('') +
        '</tbody></table></div>' : '<div class="muted">No team orders yet this month. Add sales people in Team, set their targets, and orders they enter will show here.</div>') +
      '<p class="small muted" style="margin:10px 0 0">Orders count toward whoever they’re credited to: the person who entered them, or the referral code used on the website.</p></div>';
  }

  async function targetsDrawer(month) {
    const d = await api('targets', { query: '&month=' + encodeURIComponent(month) });
    const months = [0, 1, 2].map((i) => { const x = new Date(); x.setDate(1); x.setMonth(x.getMonth() + i); return x.toISOString().slice(0, 7); });
    const members = d.members.filter((m) => m.active);
    openDrawer('Monthly targets',
      '<div class="stack"><label class="field">Month<select id="tMonth">' + months.map((m) => '<option value="' + m + '"' + (m === d.month ? ' selected' : '') + '>' +
        new Date(m + '-01T00:00:00').toLocaleDateString(LOC, { month: 'long', year: 'numeric' }) + '</option>').join('') + '</select></label>' +
      '<div class="table-wrap"><table><thead><tr><th>Team member</th><th>Orders target</th><th>Sales target (EGP)</th><th class="num">So far</th></tr></thead><tbody>' +
      members.map((m) => '<tr><td><b>' + esc(m.name) + '</b><div class="small muted">' + esc(m.role) + '</div></td>' +
        '<td><input type="number" min="0" step="1" data-o="' + m.id + '" value="' + (m.orders_target || '') + '" placeholder="0"></td>' +
        '<td><input type="number" min="0" step="100" data-r="' + m.id + '" value="' + (m.revenue_target || '') + '" placeholder="0"></td>' +
        '<td class="num small">' + m.orders + ' orders<br>' + egp(m.revenue) + '</td></tr>').join('') + '</tbody></table></div>' +
      '<p class="small muted" style="margin:0">Leave a target empty or 0 for people who don’t sell.</p></div>',
      '<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="tSave">Save targets</button>');
    $('#tMonth').onchange = (e) => targetsDrawer(e.target.value);
    $('#tSave').onclick = async () => {
      const targets = members.map((m) => ({ user_id: m.id, orders: +($('[data-o="' + m.id + '"]').value || 0), revenue: +($('[data-r="' + m.id + '"]').value || 0) }));
      try { await api('targets_save', { method: 'POST', body: { month: $('#tMonth').value, targets } }); closeDrawer(); toast('Targets saved'); if (S.route === 'dashboard') pageDashboard(); }
      catch (err) { toast(err.message, true); }
    };
  }

  const kpi = (label, value, note) => '<div class="kpi"><div class="label">' + label + '</div><div class="value">' + esc(value) + '</div><div class="note">' + (note || '') + '</div></div>';

  // Single-series bar chart with hover tooltip. One hue, recessive grid, 4px rounded tops anchored to the baseline.
  // countsOnly: bars are numbers of orders, not EGP (team members without revenue access).
  function drawChart(el, series, countsOnly) {
    const W = 720, H = 240, L = 54, R = 8, T = 10, B = 26;
    const max = Math.max(1, ...series.map((s) => s.revenue));
    const step = niceStep(max / 4);
    const top = Math.ceil(max / step) * step;
    const n = series.length, bw = (W - L - R) / n, gap = Math.min(2, bw * 0.2);
    const y = (v) => T + (H - T - B) * (1 - v / top);
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Daily revenue bar chart">';
    for (let v = 0; v <= top; v += step) {
      svg += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text class="axis" x="' + (L - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + short(v) + '</text>';
    }
    const every = Math.ceil(n / 8);
    series.forEach((s, i) => {
      const x = L + i * bw, h = Math.max(0, y(0) - y(s.revenue)), r = Math.min(4, (bw - gap) / 2, h);
      const bx = x + gap / 2, bwid = Math.max(1, bw - gap), by = y(0) - h;
      const path = h > 0 ? 'M' + bx + ',' + y(0) + 'V' + (by + r) + 'Q' + bx + ',' + by + ' ' + (bx + r) + ',' + by + 'H' + (bx + bwid - r) + 'Q' + (bx + bwid) + ',' + by + ' ' + (bx + bwid) + ',' + (by + r) + 'V' + y(0) + 'Z' : '';
      svg += '<g data-i="' + i + '"><rect class="hit" x="' + x + '" y="' + T + '" width="' + bw + '" height="' + (H - T - B) + '"/>' + (path ? '<path class="bar" d="' + path + '"/>' : '') + '</g>';
      if (i % every === 0) svg += '<text class="axis" x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + new Date(s.date + 'T00:00:00Z').toLocaleDateString(LOC, { day: 'numeric', month: 'short', timeZone: 'UTC' }) + '</text>';
    });
    svg += '</svg><div class="tip" id="tip"></div>';
    el.innerHTML = svg;
    const tip = $('#tip', el), svgEl = $('svg', el);
    $$('g[data-i]', el).forEach((g) => {
      g.addEventListener('mouseenter', () => {
        const s = series[+g.dataset.i], rect = svgEl.getBoundingClientRect(), k = rect.width / W;
        const x = (L + (+g.dataset.i + 0.5) * bw) * k, yy = y(s.revenue) * k;
        tip.innerHTML = '<b>' + new Date(s.date + 'T00:00:00Z').toLocaleDateString(LOC, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) + '</b><br>' + (countsOnly ? '' : egp(s.revenue) + ' · ') + s.orders + ' order' + (s.orders === 1 ? '' : 's');
        tip.style.left = x + 'px'; tip.style.top = yy + 'px'; tip.classList.add('show'); g.classList.add('on');
      });
      g.addEventListener('mouseleave', () => { tip.classList.remove('show'); g.classList.remove('on'); });
    });
  }
  function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1)))); const m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
  function short(v) { return v >= 1000 ? (v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'k' : String(v); }

  // ---------- orders ----------
  const BOSTA_TONE = (code) => code == null ? '' : code === 45 ? 'good' : [46, 47, 48, 49, 100, 101, 103].includes(code) ? 'bad' : [10, 11, 20].includes(code) ? 'warn' : 'info';
  const bostaPill = (o) => o.tracking ? '<span class="pill ' + BOSTA_TONE(o.bostaState) + '">🚚 ' + esc(o.bostaLabel || 'Created') + '</span><div class="small muted">#' + esc(o.tracking) + '</div>' : '<span class="muted small">—</span>';
  const trackUrl = (t) => 'https://bosta.co/tracking-shipments?shipment-number=' + encodeURIComponent(t);
  async function bostaInfo() { if (!S.bosta) S.bosta = await api('bosta_info').catch(() => ({ enabled: false })); return S.bosta; }
  async function bostaAreas() { if (!S.bostaAreas) S.bostaAreas = (await api('bosta_areas')).cities; return S.bostaAreas; }

  async function pageOrders() {
    const status = S.orderStatus || '';
    const q = S.orderQ || '';
    const [d, bosta] = await Promise.all([api('orders', { query: '&status=' + encodeURIComponent(status) + '&q=' + encodeURIComponent(q) }), bostaInfo()]);
    S.orders = d.orders;
    S.sel = new Set();
    if (S.orderView === 'board') return pageBoard(d.orders, bosta);
    const tabs = [''].concat(S.meta.orderStatuses);
    const selectable = bosta.enabled || can('team'); // row checkboxes: Bosta bulk actions, and Delete for the owner
    $('#main').innerHTML = header('Orders', d.orders.length + ' shown' + (can('own_orders') ? ' · only orders credited to you' : ''),
      '<div class="seg" id="view"><button data-v="list" class="' + (S.orderView !== 'board' ? 'on' : '') + '">List</button><button data-v="board" class="' + (S.orderView === 'board' ? 'on' : '') + '">Production board</button></div>' +
      (S.bosta && S.bosta.enabled ? '<button class="btn" id="bSync" title="Ask Bosta for the latest state of every open shipment">↻ Sync Bosta</button>' : '') +
      '<a class="btn" href="' + API + '?action=orders&format=csv&status=' + encodeURIComponent(status) + '">Export CSV</a>' + (can('sell') ? '<button class="btn primary" id="newOrder">+ New order</button>' : '')) +
      '<div class="row" style="margin-bottom:14px"><div class="seg" id="tabs">' + tabs.map((t) => '<button data-s="' + t + '" class="' + (t === status ? 'on' : '') + '">' + (t || 'All') + '</button>').join('') + '</div>' +
      '<span class="spacer"></span><input type="search" id="q" placeholder="Search name, phone, email or WTS-…" value="' + esc(q) + '" style="max-width:300px"></div>' +
      (selectable ? '<div class="row card" id="bulk" style="display:none;margin-bottom:14px;padding:12px 16px"><b id="selCount"></b><span class="spacer"></span>' +
        (bosta.enabled ? '<button class="btn primary sm" id="bulkShip">🚚 Create Bosta shipments</button><button class="btn sm" id="bulkAwb">🖨 Print waybills</button>' : '') +
        (can('team') ? '<button class="btn sm danger" id="bulkDel" title="Delete test or mistaken orders for good">Delete</button>' : '') + '</div>' : '') +
      (d.orders.length ? '<div class="table-wrap"><table class="otable"><thead><tr>' + (selectable ? '<th style="width:34px"><input type="checkbox" id="selAll" aria-label="Select all"></th>' : '') +
        '<th>Order</th><th>Customer</th><th>Items</th><th>Status</th>' + (bosta.enabled ? '<th>Bosta</th>' : '') + '<th>Date</th><th class="num">Total</th></tr></thead><tbody>' +
        d.orders.map((o, i) => '<tr class="click" data-i="' + i + '">' + (selectable ? '<td class="o-sel" data-nosel><input type="checkbox" class="sel" data-id="' + o.id + '" aria-label="Select ' + esc(o.number) + '"></td>' : '') +
          '<td class="o-num"><b>' + esc(o.number) + '</b></td><td class="o-cust"><b class="o-name">' + esc(o.customer) + '</b><div class="small muted o-phone">' + esc(o.phone) + '</div><div class="small muted">' + esc([o.district, o.city].filter(Boolean).join(', ')) + '</div></td>' +
          '<td class="small o-items">' + o.items.map(itemHtml).join('') + (o.prepNotes ? '<div class="o-note" title="Order notes">📝 ' + esc(o.prepNotes) + '</div>' : '') + '</td><td class="o-st">' + pill(ORDER_TONE, o.status) + '<div class="small muted">' + esc(o.source) + (o.rep ? ' · ' + esc(o.rep) : '') + '</div></td>' +
          (bosta.enabled ? '<td class="o-bosta">' + bostaPill(o) + '</td>' : '') +
          '<td class="small muted o-date">' + dateTime(o.createdAt) + '</td><td class="num o-tot"><b>' + egp(o.total) + '</b>' + payState(o) + '</td></tr>').join('') +
        '</tbody></table></div>' : '<div class="card empty">No orders match.</div>');
    $$('#tabs button').forEach((b) => b.onclick = () => { S.orderStatus = b.dataset.s; pageOrders(); });
    const nb = $('#newOrder'); if (nb) nb.onclick = () => newOrderDrawer();
    const bs = $('#bSync'); if (bs) bs.onclick = async () => {
      bs.disabled = true; bs.textContent = 'Syncing…';
      try { const r = await api('bosta_sync', { method: 'POST', body: {} }); toast(r.changed ? r.changed + ' of ' + r.checked + ' shipments updated' : 'All ' + r.checked + ' open shipments are up to date'); render(); }
      catch (e) { toast(e.message, true); bs.disabled = false; bs.textContent = '↻ Sync Bosta'; }
    };
    $$('#view button').forEach((b) => b.onclick = () => { S.orderView = b.dataset.v; S.orderStatus = ''; pageOrders(); });
    let t; $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { S.orderQ = e.target.value; pageOrders().then(() => { const el = $('#q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); }, 350); };
    $$('tr[data-i]').forEach((tr) => tr.onclick = (e) => { if (e.target.closest('[data-nosel]')) return; orderDrawer(d.orders[+tr.dataset.i]); });
    if (!selectable) return;
    const sync = () => {
      S.sel = new Set($$('.sel').filter((c) => c.checked).map((c) => +c.dataset.id));
      $('#bulk').style.display = S.sel.size ? 'flex' : 'none';
      $('#selCount').textContent = S.sel.size + ' selected';
    };
    $$('.sel').forEach((c) => c.onchange = sync);
    const all = $('#selAll'); if (all) all.onchange = () => { $$('.sel').forEach((c) => { c.checked = all.checked; }); sync(); };
    if (bosta.enabled) {
      $('#bulkAwb').onclick = () => window.open(API + '?action=bosta_awb&ids=' + [...S.sel].join(','), '_blank');
      $('#bulkShip').onclick = () => bulkShip([...S.sel]);
    }
    const del = $('#bulkDel');
    if (del) del.onclick = async () => {
      const ids = [...S.sel];
      const names = S.orders.filter((o) => S.sel.has(o.id)).map((o) => o.number).join(', ');
      if (!confirm('Delete ' + ids.length + ' order' + (ids.length > 1 ? 's' : '') + ' for good?\n\n' + names + '\n\nUse this only for test or mistaken orders. Stock goes back, their payments are removed, and any Bosta shipment still open is cancelled. This can’t be undone.')) return;
      del.disabled = true;
      try { const r = await api('order_delete', { method: 'POST', body: { ids } }); toast('Deleted ' + r.deleted.join(', ')); render(); }
      catch (e) { toast(e.message, true); del.disabled = false; }
    };
  }

  // Kanban-style board: one column per open stage; move orders with the arrows or open them for details.
  const BOARD = ['Pending', 'Confirmed', 'Designing', 'Awaiting approval', 'In production', 'Ready', 'Shipped'];
  function pageBoard(orders, bosta) {
    const open = orders.filter((o) => BOARD.includes(o.status));
    $('#main').innerHTML = header('Orders', open.length + ' open orders' + (can('own_orders') ? ' · only orders credited to you' : ''),
      '<div class="seg" id="view"><button data-v="list">List</button><button data-v="board" class="on">Production board</button></div>' +
      (can('sell') ? '<button class="btn primary" id="newOrder">+ New order</button>' : '')) +
      '<div class="board" style="grid-template-columns:repeat(' + BOARD.length + ',minmax(230px,1fr))">' +
      BOARD.map((st, si) => {
        const list = open.filter((o) => o.status === st);
        return '<div class="bcol"><div class="bhead">' + pill(ORDER_TONE, st) + '<span class="spacer"></span><span class="bcount">' + list.length + '</span></div>' +
          (list.length ? '' : '<div class="bempty">No orders</div>') +
          list.map((o) => '<div class="bcard" data-open="' + o.id + '">' +
            '<div class="row"><b>' + esc(o.number) + '</b><span class="spacer"></span><span class="small muted">' + egp(o.total) + '</span></div>' +
            '<div class="small">' + esc(o.businessName || o.customer) + '</div>' +
            '<div class="small muted" style="margin:4px 0">' + o.items.map((it) => esc(it.qty + '× ' + it.name)).join('<br>') + '</div>' +
            (o.files && o.files.length ? '<div class="small muted">📎 ' + o.files.length + ' file' + (o.files.length > 1 ? 's' : '') + '</div>' : '') +
            '<div class="small muted">' + esc(o.rep || o.source) + ' · ' + dateTime(o.createdAt) + '</div>' +
            '<div class="row" style="margin-top:8px">' + (si > 0 ? '<button class="btn sm" data-mv="' + o.id + '" data-to="' + BOARD[si - 1] + '" aria-label="Move back">←</button>' : '') +
            '<span class="spacer"></span>' + (si < BOARD.length - 1 ? '<button class="btn sm" data-mv="' + o.id + '" data-to="' + BOARD[si + 1] + '">' + esc(BOARD[si + 1]) + ' →</button>' : '') + '</div></div>').join('') +
          '</div>';
      }).join('') + '</div>' +
      '<p class="small muted">Delivered, cancelled and returned orders are in the List view. Bosta moves shipped orders forward automatically.</p>';
    $$('#view button').forEach((b) => b.onclick = () => { S.orderView = b.dataset.v; pageOrders(); });
    const nb = $('#newOrder'); if (nb) nb.onclick = () => newOrderDrawer();
    $$('[data-open]').forEach((c) => c.onclick = (e) => { if (e.target.closest('[data-mv]')) return; orderDrawer(orders.find((o) => o.id === +c.dataset.open)); });
    $$('[data-mv]').forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try { await api('order_update', { method: 'POST', body: { id: +b.dataset.mv, status: b.dataset.to } }); toast('Moved to ' + b.dataset.to); pageOrders(); }
      catch (err) { toast(err.message, true); b.disabled = false; }
    });
  }

  async function bulkShip(ids) {
    const bosta = await bostaInfo();
    const todo = S.orders.filter((o) => ids.includes(o.id) && !o.tracking);
    const skipped = ids.length - todo.length;
    const locOpts = (bosta.locations || []).map((l) => '<option value="' + esc(l.id) + '"' + ((bosta.defaultLocation ? l.id === bosta.defaultLocation : l.isDefault) ? ' selected' : '') + '>' + esc(l.name + (l.city ? ' — ' + l.city : '')) + '</option>').join('');
    openDrawer('Create ' + todo.length + ' Bosta shipment' + (todo.length === 1 ? '' : 's'),
      '<div class="stack"><p class="muted" style="margin:0">Each order uses the customer’s saved area and address, and collects its full order total in cash. Orders without an area will be skipped — open them to choose one.' +
      (skipped ? ' ' + skipped + ' already shipped order(s) are left out.' : '') + '</p>' +
      '<div class="grid2"><label class="field">Package size<select id="bSize">' + ['SMALL', 'MEDIUM', 'LARGE'].map((z) => '<option value="' + z + '"' + (z === bosta.defaultSize ? ' selected' : '') + '>' + z + '</option>').join('') + '</select></label>' +
      '<label class="field">Pick up from<select id="bLoc">' + locOpts + '</select></label></div>' +
      '<div class="list">' + todo.map((o) => '<div class="li"><span><b>' + esc(o.number) + '</b> ' + esc(o.customer) + ' <span class="small muted">' + esc([o.district, o.city].filter(Boolean).join(', ') || 'no area') + '</span></span><b>' + egp(o.total) + '</b></div>').join('') + '</div>' +
      '<div id="bRes"></div></div>',
      '<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="bGo"' + (todo.length ? '' : ' disabled') + '>Create shipments</button>');
    $('#bGo').onclick = async () => {
      $('#bGo').disabled = true; $('#bGo').textContent = 'Creating…';
      try {
        const r = await api('bosta_create', { method: 'POST', body: { ids: todo.map((o) => o.id), size: $('#bSize').value, location_id: $('#bLoc').value } });
        const ok = r.results.filter((x) => x.tracking);
        $('#bRes').innerHTML = '<div class="card list">' + r.results.map((x) => '<div class="li"><b>' + esc(x.number) + '</b><span class="' + (x.error ? '' : 'muted') + '" style="' + (x.error ? 'color:var(--bad)' : '') + '">' + (x.error ? '✕ ' + esc(x.error) : '✓ #' + esc(x.tracking)) + '</span></div>').join('') + '</div>' +
          (ok.length ? '<p><a class="btn" target="_blank" href="' + API + '?action=bosta_awb&ids=' + ok.map((x) => x.id).join(',') + '">🖨 Print ' + ok.length + ' waybill' + (ok.length === 1 ? '' : 's') + '</a></p>' : '');
        $('#bGo').textContent = 'Done';
        toast(ok.length + ' shipment' + (ok.length === 1 ? '' : 's') + ' created');
        const drawer = document.getElementById('drawer'); drawer.remove();
        await pageOrders(); document.body.appendChild(drawer);
      } catch (err) { toast(err.message, true); $('#bGo').disabled = false; $('#bGo').textContent = 'Create shipments'; }
    };
  }

  function bostaSection(o, bosta) {
    if (!bosta.enabled) return '<div class="card small muted">🚚 Bosta shipping isn’t connected yet — add your Bosta API key in <code>api/config.local.php</code>.</div>';
    const physical = o.items.some((it) => it.cat !== 'services');
    if (o.tracking) {
      return '<div class="card stack"><h2 style="margin:0">🚚 Bosta shipment<span class="spacer"></span><span class="pill ' + BOSTA_TONE(o.bostaState) + '">' + esc(o.bostaLabel || 'Created') + '</span></h2>' +
        '<div>Tracking number <b>' + esc(o.tracking) + '</b>' + (o.bostaCod != null ? ' · collect ' + egp(o.bostaCod) : '') + '</div>' +
        (o.bostaNote ? '<div class="small" style="color:var(--bad)">' + esc(o.bostaNote) + '</div>' : '') +
        (o.prepNotes ? '<div class="small"><b>Order notes:</b> ' + esc(o.prepNotes) + '</div>' : '') +
        '<div class="small muted">Updated ' + dateTime(o.bostaUpdatedAt) + ' · status changes arrive automatically</div>' +
        '<div class="row"><a class="btn sm primary" target="_blank" href="' + API + '?action=bosta_awb&ids=' + o.id + '">🖨 Print waybill</a>' +
        '<button class="btn sm" id="bRefresh">↻ Refresh status</button><a class="btn sm" target="_blank" rel="noopener" href="' + trackUrl(o.tracking) + '">Track on Bosta ↗</a>' +
        '<span class="spacer"></span>' + ([10, 11, 20].includes(o.bostaState) ? '<button class="btn sm danger" id="bCancel">Cancel shipment</button>' : '') + '</div></div>';
    }
    if (!physical) return '<div class="card small muted">🚚 Nothing to ship — this order only has marketing plans.</div>';
    if (o.status === 'Cancelled') return '<div class="card small muted">🚚 Cancelled orders can’t be shipped.</div>';
    const locOpts = (bosta.locations || []).map((l) => '<option value="' + esc(l.id) + '"' + ((bosta.defaultLocation ? l.id === bosta.defaultLocation : l.isDefault) ? ' selected' : '') + '>' + esc(l.name + (l.city ? ' — ' + l.city : '')) + '</option>').join('');
    const hasArea = !!o.districtId;
    const cod = o.payment === 'cod' ? Math.max(0, o.due != null ? o.due : o.total) : 0;
    return '<form id="bf" class="card stack" novalidate><h2 style="margin:0">🚚 Ship with Bosta</h2>' +
      '<div class="ship-sum"><div><span class="small muted">Deliver to</span><b>' + esc([o.district, o.city].filter(Boolean).join(', ') || 'Area not chosen yet') + '</b>' +
        '<span class="small" dir="auto">' + esc(o.address || '') + '</span></div>' +
      '<div><span class="small muted">Courier collects</span><b>' + (cod ? egp(cod) : 'Nothing (paid)') + '</b></div></div>' +
      '<label class="field">Order notes <span class="hint">Sent to Bosta with the shipment (on the order page and the waybill) for whoever packs it</span>' +
        '<textarea name="prep_notes" maxlength="500" style="min-height:52px" placeholder="e.g. Gift wrap it, check the colour is black">' + esc(o.prepNotes || '') + '</textarea></label>' +
      '<div class="row"><button class="btn primary" type="submit" id="bCreate">Create Bosta shipment</button></div>' +
      '<details class="ship-more"' + (hasArea ? '' : ' open') + '><summary>' + (hasArea ? 'Change area, address or package' : 'Choose the delivery area first') + '</summary><div class="stack" style="margin-top:12px">' +
      '<div class="field" style="position:relative">Find area <span class="hint">Type in English or Arabic, e.g. Nasr City / مدينة نصر</span>' +
      '<input type="search" id="bSearch" autocomplete="off" placeholder="🔍 Search Bosta areas"><div id="bResults" class="card" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:5;padding:0;max-height:260px;overflow:auto"></div>' +
      '<div id="bSuggest" class="row small" style="margin-top:4px"></div></div>' +
      '<div class="grid3"><label class="field">Governorate<select name="city_id" id="bCity"><option value="">Loading…</option></select></label>' +
      '<label class="field">Area<select id="bZone" required><option value="">Choose governorate first</option></select></label>' +
      '<label class="field">Neighbourhood<select name="district_id" id="bDist" required><option value="">—</option></select></label></div>' +
      '<label class="field">Street address <span class="hint">More than 5 characters</span><input type="text" name="address" required minlength="6" value="' + esc(o.address) + '"></label>' +
      '<div class="grid3"><label class="field">Building<input type="text" name="building"></label><label class="field">Floor<input type="text" name="floor"></label><label class="field">Apartment<input type="text" name="apartment"></label></div>' +
      '<label class="field">Nearby landmark<input type="text" name="landmark"></label>' +
      '<div class="grid3"><label class="field">Package size<select name="size">' + ['SMALL', 'MEDIUM', 'LARGE'].map((z) => '<option value="' + z + '"' + (z === bosta.defaultSize ? ' selected' : '') + '>' + z + '</option>').join('') + '</select></label>' +
      '<label class="field">Cash to collect (EGP)<input type="number" name="cod" min="0" max="30000" step="0.01" value="' + esc(cod) + '"></label>' +
      '<label class="field">Pick up from<select name="location_id">' + locOpts + '</select></label></div>' +
      (bosta.locationsError ? '<div class="small" style="color:var(--bad)">' + esc(bosta.locationsError) + '</div>' : '') +
      '<label class="field">Notes for the courier<input type="text" name="notes" placeholder="e.g. Call before arriving"></label></div></details></form>';
  }

  // Payments on an order: deposits, transfers, cash on delivery, refunds (negative amounts).
  async function paymentsCard(o) {
    const box = $('#oPay');
    if (!box) return;
    let d;
    try { d = await api('order_payments', { query: '&id=' + o.id }); } catch (err) { box.innerHTML = '<div class="err">' + esc(err.message) + '</div>'; return; }
    const draw = (payments, paid, due) => {
      const closed = o.status === 'Cancelled' || o.status === 'Returned';
      box.innerHTML = '<h2>Payments<span class="spacer"></span>' + (closed ? '' : due <= 0 ? '<span class="pill good">✓ Paid in full</span>' : paid > 0 ? '<span class="pill warn">◐ ' + egp(due) + ' due</span>' : '<span class="pill">' + egp(due) + ' to collect</span>') + '</h2>' +
        '<div class="pay-bar"><i style="width:' + Math.min(100, o.total > 0 ? paid / o.total * 100 : 0) + '%"></i></div>' +
        '<div class="row small muted" style="margin:6px 0 10px"><span>Paid ' + egp(paid) + '</span><span class="spacer"></span><span>Total ' + egp(o.total) + '</span></div>' +
        (payments.length ? '<div class="list">' + payments.map((p) => '<div class="li"><span><b>' + egp(p.amount) + '</b> · ' + esc(p.methodLabel) + (p.note ? ' · ' + esc(p.note) : '') +
          '<div class="small muted">' + dateTime(p.at) + (p.by ? ' · ' + esc(p.by) : '') + '</div></span>' +
          (can('products') ? '<button type="button" class="btn sm" data-pdel="' + p.id + '" aria-label="Delete payment">✕</button>' : '') + '</div>').join('') + '</div>' : '<div class="small muted">No payments recorded yet.</div>') +
        (closed ? '' : '<div class="row" style="margin-top:12px"><input type="number" id="pAmt" step="0.01" placeholder="Amount" value="' + (due > 0 ? due : '') + '" style="width:120px" aria-label="Amount received">' +
          '<select id="pMethod" style="width:auto">' + Object.entries(d.kinds).map(([k, v]) => '<option value="' + k + '"' + (k === 'cash' ? ' selected' : '') + '>' + esc(v) + '</option>').join('') + '</select>' +
          '<input type="text" id="pNote" placeholder="Note (optional)" style="flex:1;min-width:120px"><button type="button" class="btn sm primary" id="pAdd">Record payment</button></div>' +
          '<div class="hint" style="margin-top:6px">Deposit, transfer or cash received. Use a minus amount for a refund. When the order is marked Delivered, any balance is recorded as collected.</div>');
      $$('[data-pdel]', box).forEach((b) => b.onclick = async () => {
        if (!confirm('Delete this payment?')) return;
        try { const r = await api('payment_delete', { method: 'POST', body: { id: +b.dataset.pdel } }); o.paid = r.paid; o.due = r.due; draw(r.payments, r.paid, r.due); }
        catch (err) { toast(err.message, true); }
      });
      const add = $('#pAdd', box);
      if (add) add.onclick = async () => {
        add.disabled = true;
        try {
          const r = await api('payment_add', { method: 'POST', body: { order_id: o.id, amount: $('#pAmt').value, method: $('#pMethod').value, note: $('#pNote').value } });
          o.paid = r.paid; o.due = r.due; draw(r.payments, r.paid, r.due); toast('Payment recorded');
        } catch (err) { toast(err.message, true); add.disabled = false; }
      };
    };
    draw(d.payments, o.paid, o.due);
  }

  async function orderDrawer(o) {
    const bosta = await bostaInfo();
    const body = '<div class="stack">' +
      '<div class="card"><div class="grid2"><div><div class="small muted">Customer</div><b>' + esc(o.customer) + '</b><div>' + esc(o.email) + '</div><div><a href="tel:' + esc(o.phone) + '">' + esc(o.phone) + '</a> · <a href="https://wa.me/' + esc(o.phone.replace(/\D/g, '').replace(/^0/, '20')) + '" target="_blank" rel="noopener">WhatsApp</a></div></div>' +
      '<div><div class="small muted">Deliver to</div>' + esc(o.address || '—') + '<div>' + esc([o.district, o.city].filter(Boolean).join(', ')) + '</div><div class="small muted" style="margin-top:6px">Placed ' + dateTime(o.createdAt) + ' · ' + esc(o.paymentLabel) + '</div>' +
      '<div class="small muted">Source: ' + esc(o.source) + (o.rep ? ' · credited to ' + esc(o.rep) : '') + (o.createdBy && o.createdBy !== o.rep ? ' · entered by ' + esc(o.createdBy) : '') + '</div></div></div></div>' +
      '<div class="card"><div class="list">' + o.items.map((it) => '<div class="li"><span>' + esc(it.qty + '× ' + it.name) + '</span><span>' + egp(it.total != null ? it.total : it.qty * it.price) + '</span></div>').join('') +
      '<div class="li muted"><span>Subtotal</span><span>' + egp(o.subtotal) + '</span></div>' +
      (o.discount ? '<div class="li muted"><span>Promo ' + esc(o.promo) + '</span><span>−' + egp(o.discount) + '</span></div>' : o.promo ? '<div class="li muted"><span>Promo ' + esc(o.promo) + '</span><span>Free delivery</span></div>' : '') +
      '<div class="li muted"><span>Delivery</span><span>' + (o.shipping ? egp(o.shipping) : 'Free') + '</span></div>' +
      '<div class="li"><b>Total</b><b>' + egp(o.total) + '</b></div></div></div>' +
      '<div class="card" id="oPay"><div class="muted small">Loading payments…</div></div>' +
      // Delivered: the customer's review link (sent by email automatically; also on WhatsApp from here).
      (o.rateUrl ? '<div class="card row" style="gap:10px;flex-wrap:wrap"><span><b>⭐ Review</b> <span class="small muted">' + (o.reviewAskedAt ? 'asked ' + dateTime(o.reviewAskedAt) : 'not asked yet') + '</span></span><span class="spacer"></span>' +
        (o.phone ? '<a class="btn sm wa" target="_blank" rel="noopener" href="https://wa.me/' + esc(waNumber(o.phone.replace(/\D/g, ''))) + '?text=' + encodeURIComponent(o.lang === 'en'
          ? 'Hi ' + o.customer.split(/\s+/)[0] + ' 👋 this is ' + S.user.name.split(' ')[0] + ' from Where To Spot. We hope your order ' + o.number + ' arrived and you love it! If you have a minute, rate it here ⭐ ' + o.rateUrl
          : 'أهلًا ' + o.customer.split(/\s+/)[0] + ' 👋 معاك ' + S.user.name.split(' ')[0] + ' من Where To Spot. نتمنى يكون طلبك ' + o.number + ' وصل وعجبك! لو عندك دقيقة قيّمه من هنا ⭐ ' + o.rateUrl) + '">' + icon('chat') + 'Ask on WhatsApp</a>' : '') +
        '<button type="button" class="btn sm" id="oRateCopy">Copy link</button></div>' : '') +
      bostaSection(o, bosta) +
      ((o.businessName || o.reviewLink || o.links || o.designNotes) ? '<div class="card small"><b>Print details from the customer</b><div class="muted" style="white-space:pre-line;margin-top:4px">' +
        esc([o.businessName, o.reviewLink, o.links, o.designNotes].filter(Boolean).join('\n')) + '</div></div>' : '') +
      '<form id="of" class="stack">' +
      '<details class="card ship-more"' + ((o.files || []).length ? ' open' : '') + '><summary>Files' + ((o.files || []).length ? ' (' + o.files.length + ')' : '') + ' <span class="hint" style="font-weight:400">logo, design proof…</span></summary>' +
      '<div class="list" id="oFiles" style="margin-top:8px"></div>' +
      '<div class="row" style="margin-top:8px"><select id="oFileKind" style="width:auto"><option value="Logo">Logo</option><option value="Design proof" selected>Design proof</option><option value="Final design">Final design</option><option value="Other">Other</option></select>' +
      '<label class="btn sm" style="cursor:pointer">⬆ Upload file<input type="file" id="oFile" accept="image/jpeg,image/png,image/webp,application/pdf" hidden></label>' +
      '<span class="hint">JPG, PNG, WebP or PDF up to 5 MB</span></div></details>' +
      '<label class="field">Status<select name="status">' + S.meta.orderStatuses.map((s) => '<option value="' + s + '"' + (s === o.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
      '<span class="hint">Cancelling or returning puts the items back in stock.' + (o.tracking ? ' Bosta updates move this to Shipped, Delivered or Returned automatically.' : '') + '</span></label>' +
      '<label class="field">Internal notes<textarea name="notes" placeholder="e.g. Confirmed by phone">' + esc(o.notes) + '</textarea></label></form></div>';
    openDrawer('Order ' + o.number, body, '<a class="btn" href="doc.html?type=invoice&id=' + o.id + '" target="_blank" rel="noopener">' + icon('file') + 'Invoice</a>' +
      '<span class="spacer"></span><button class="btn" data-close>Close</button><button class="btn primary" form="of" type="submit">Save</button>');
    paymentsCard(o);
    const rc = $('#oRateCopy'); if (rc) rc.onclick = () => navigator.clipboard.writeText(o.rateUrl).then(() => toast('Copied'));
    const reopen = async () => { await pageOrders(); const fresh = S.orders.find((x) => x.id === o.id); if (fresh) orderDrawer(fresh); };
    $('#of').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('order_update', { method: 'POST', body: Object.assign({ id: o.id }, formData(e.target)) }); closeDrawer(); toast('Order updated'); pageOrders(); }
      catch (err) { toast(err.message, true); }
    };
    const renderFiles = (files) => {
      o.files = files;
      $('#oFiles').innerHTML = files.length ? files.map((f, i) =>
        '<div class="li"><span><span class="pill">' + esc(f.kind) + '</span> <a href="../' + esc(f.path) + '" target="_blank" rel="noopener">' + esc(f.name) + '</a>' +
        '<div class="small muted">' + esc(f.by || '') + ' · ' + dateTime(f.at) + '</div></span>' +
        (/\.(jpg|png|webp)$/i.test(f.path) ? '<img src="../' + esc(f.path) + '" alt="" style="width:46px;height:46px;object-fit:contain;border:1px solid var(--line);border-radius:8px;background:#fff">' : '') +
        '<button type="button" class="btn sm" data-fdel="' + i + '" aria-label="Remove file">✕</button></div>').join('') : '<div class="small muted" style="padding:6px 0">No files yet.</div>';
      $$('[data-fdel]', $('#oFiles')).forEach((b) => b.onclick = async () => {
        const f = files[+b.dataset.fdel];
        if (!confirm('Remove ' + f.name + '?')) return;
        try { const r = await api('order_file_delete', { method: 'POST', body: { order_id: o.id, path: f.path } }); renderFiles(r.files); }
        catch (err) { toast(err.message, true); }
      });
    };
    renderFiles(o.files || []);
    $('#oFile').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const fd = new FormData(); fd.append('order_id', o.id); fd.append('kind', $('#oFileKind').value); fd.append('file', f);
      try { const r = await api('order_file_upload', { method: 'POST', form: fd }); renderFiles(r.files); toast('File uploaded'); }
      catch (err) { toast(err.message, true); }
      e.target.value = '';
    };
    const refresh = $('#bRefresh');
    if (refresh) refresh.onclick = async () => {
      refresh.disabled = true;
      try { const r = await api('bosta_refresh', { method: 'POST', body: { id: o.id } }); toast('Bosta: ' + r.label); reopen(); }
      catch (err) { toast(err.message, true); refresh.disabled = false; }
    };
    const cancel = $('#bCancel');
    if (cancel) cancel.onclick = async () => {
      if (!confirm('Cancel Bosta shipment ' + o.tracking + '? The courier won’t pick it up.')) return;
      try { await api('bosta_cancel', { method: 'POST', body: { id: o.id } }); toast('Shipment cancelled'); reopen(); }
      catch (err) { toast(err.message, true); }
    };
    const bf = $('#bf');
    if (!bf) return;
    const citySel = $('#bCity'), zoneSel = $('#bZone'), distSel = $('#bDist');
    const opt = (v, label, sel) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(label) + '</option>';
    let cities = [];
    const fillDistricts = () => {
      const c = cities.find((x) => x.id === citySel.value);
      const z = c && c.zones.find((x) => x.id === zoneSel.value);
      distSel.innerHTML = z ? opt(z.main, 'General / not sure (' + z.name + ')', z.main === o.districtId) +
        z.districts.filter((d) => d.id !== z.main).map((d) => opt(d.id, d.name + (d.ar ? ' · ' + d.ar : ''), d.id === o.districtId)).join('') : opt('', '—');
    };
    const fillZones = () => {
      const c = cities.find((x) => x.id === citySel.value);
      const current = c && c.zones.find((z) => z.districts.some((d) => d.id === o.districtId));
      zoneSel.innerHTML = opt('', c ? 'Choose area' : 'Choose governorate first') +
        (c ? c.zones.map((z) => opt(z.id, z.name + (z.ar ? ' · ' + z.ar : ''), current && current.id === z.id)).join('') : '');
      fillDistricts();
    };
    try {
      cities = await bostaAreas();
      const match = cities.find((c) => c.id === o.cityId) || cities.find((c) => c.name.toLowerCase() === String(o.city || '').toLowerCase());
      citySel.innerHTML = opt('', 'Choose governorate') + cities.map((c) => opt(c.id, c.name + (c.ar ? ' · ' + c.ar : ''), match && c.id === match.id)).join('');
      fillZones();
      citySel.onchange = fillZones;
      zoneSel.onchange = fillDistricts;
    } catch (err) { citySel.innerHTML = opt('', 'Couldn’t load Bosta areas'); toast(err.message, true); }
    // Area search + suggestions from the saved address (same engine as the shop checkout).
    // Keep the summary at the top in step with what's chosen below.
    const showChosen = () => {
      const pickText = (sel) => sel.selectedIndex > 0 || (sel.value && sel.options.length) ? ((t) => t[AR && t[1] ? 1 : 0])(sel.options[sel.selectedIndex].text.split(' · ')).replace(/^(?:General \/ not sure|عام \/ غير متأكد) \((.*)\)$/, '$1') : '';
      const label = [pickText(distSel) || pickText(zoneSel), pickText(citySel)].filter(Boolean).join(AR ? '، ' : ', ');
      if (label) $('.ship-sum b', bf).textContent = label;
      const cod = +bf.elements.cod.value || 0;
      $$('.ship-sum b', bf)[1].textContent = cod ? egp(cod) : 'Nothing (paid)';
    };
    distSel.addEventListener('change', showChosen); zoneSel.addEventListener('change', showChosen); citySel.addEventListener('change', showChosen);
    bf.elements.cod.addEventListener('input', showChosen);
    const pickArea = (r) => {
      citySel.value = r.cityId; fillZones();
      zoneSel.value = r.zoneId; fillDistricts();
      distSel.value = r.districtId;
      $('#bResults').style.display = 'none'; $('#bSearch').value = '';
      showChosen();
    };
    const resultRow = (r, i) => '<button type="button" data-r="' + i + '" style="display:block;width:100%;text-align:left;border:none;border-bottom:1px solid var(--line-2);background:#fff;padding:9px 12px;cursor:pointer">' +
      '<b>' + esc(r.title) + '</b> <span class="muted">' + esc(r.titleAr) + '</span><div class="small muted">' + esc(r.sub) + '</div></button>';
    let sq;
    $('#bSearch').oninput = (e) => {
      clearTimeout(sq);
      const q = e.target.value.trim(), box = $('#bResults');
      if (q.length < 2) { box.style.display = 'none'; return; }
      sq = setTimeout(async () => {
        const res = await fetch('../api/public.php?action=area_search&q=' + encodeURIComponent(q)).then((r) => r.json()).catch(() => ({ results: [] }));
        const list = res.results || [];
        box.innerHTML = list.length ? list.map(resultRow).join('') : '<div class="small muted" style="padding:10px 12px">No match</div>';
        box.style.display = 'block';
        $$('[data-r]', box).forEach((b) => b.onclick = () => pickArea(list[+b.dataset.r]));
      }, 250);
    };
    if (!o.districtId && o.address) {
      fetch('../api/public.php?action=area_suggest&text=' + encodeURIComponent(o.address + ' ' + (o.city || ''))).then((r) => r.json()).then((res) => {
        const list = res.results || [];
        if (!list.length) return;
        $('#bSuggest').innerHTML = '<span class="muted">✨ From the address:</span>' + list.map((r, i) => '<button type="button" class="btn sm" data-s="' + i + '">' + esc((AR && r.titleAr ? r.titleAr : r.title) + ' — ' + r.sub.replace(' · any neighbourhood', '')) + '</button>').join('');
        $$('[data-s]', $('#bSuggest')).forEach((b) => b.onclick = () => pickArea(list[+b.dataset.s]));
      }).catch(() => {});
    }

    bf.onsubmit = async (e) => {
      e.preventDefault();
      // The details are folded away; if something is missing, open them and say what.
      const more = $('.ship-more', bf);
      if (!distSel.value) { more.open = true; toast('Choose the delivery area first', true); return; }
      if ((bf.elements.address.value || '').trim().length < 6) { more.open = true; bf.elements.address.focus(); toast('Add the street address (at least 6 characters)', true); return; }
      const btn = $('#bCreate'); btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const r = await api('bosta_create', { method: 'POST', body: Object.assign({ id: o.id }, formData(bf)) });
        const res = r.results[0];
        if (res.error) throw new Error(res.error);
        toast('Shipment created · #' + res.tracking);
        reopen();
      } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = 'Create Bosta shipment'; }
    };
  }

  // Same pricing rules as api/pricing.php: quantity tiers per size, extras per piece or per order, whole-pound totals.
  function priceLine(p, variantId, addonIds, qty) {
    const vs = p.variants || [];
    const variant = vs.find((v) => v.id === variantId) || (vs.length === 1 ? vs[0] : null);
    const tiers = variant ? (variant.tiers || []) : (p.tiers || []);
    let unit = null, bestMin = 0;
    tiers.forEach((t) => { if (t.min >= 1 && t.min <= qty && t.min >= bestMin && t.price > 0) { unit = t.price; bestMin = t.min; } });
    if (unit === null) unit = variant && variant.price ? variant.price : p.price;
    if (p.discountPct) unit = unit * (1 - p.discountPct / 100);
    let perUnit = 0, perOrder = 0; const labels = [];
    (p.addons || []).forEach((g) => {
      const o = (g.options || []).find((x) => (addonIds || []).includes(x.id)) || (g.options || [])[0];
      if (!o) return;
      if (o.per === 'order') perOrder += o.price; else perUnit += o.price;
      if (!/standard/i.test(o.label) && (o.price || g.options.length > 1)) labels.push(o.label);
    });
    const total = Math.round((unit + perUnit) * qty + perOrder);
    return { total, unit: total / Math.max(1, qty), name: p.name + (variant ? ' — ' + variant.label : '') + (labels.length ? ' · ' + labels.join(' · ') : ''), variant };
  }

  // ---------- team-entered orders ----------
  // New order, or (prefill.mode === 'quote') a new / edited quote. prefill can carry the customer,
  // items in input form ({id, variant, addons, qty} or {custom, name, price, qty, ship}), discount,
  // delivery, area, personalisation, leadId and quoteId.
  async function newOrderDrawer(prefill) {
    prefill = prefill || null;
    const isQuote = !!(prefill && prefill.mode === 'quote');
    const cat = await api('order_catalog');
    const lines = [];
    let area = null; // { districtId, cityId, title, sub }
    const physicalProducts = () => lines.some((l) => (l.custom ? l.ship : l.p.cat !== 'services'));
    const lineCalc = (l) => l.custom ? { total: Math.round(l.price * l.qty), name: l.name } : priceLine(l.p, l.variant, l.addons, l.qty);
    const repOpts = can('targets') ? '<label class="field">Credit this sale to<select name="rep_id">' +
      cat.reps.map((r) => '<option value="' + r.id + '"' + (r.id === S.user.id ? ' selected' : '') + '>' + esc(r.name) + ' (' + esc(r.role) + ')</option>').join('') + '</select></label>' : '';
    const body = '<form id="nf" class="stack">' +
      (prefill && prefill.quoteId && !isQuote ? '<div class="chosen">' + icon('file') + '<span>Order from quote <b>' + esc(prefill.quoteNumber || '') + '</b>. Check the delivery area, then create it — the quote will be marked Accepted.</span></div>'
        : prefill && prefill.leadId ? '<div class="chosen">' + icon('inbox') + '<span>' + (isQuote ? 'Quote' : 'Order') + ' for lead <b>' + esc(prefill.name) + '</b>' + (prefill.interest ? ' · ' + esc(prefill.interest) : '') + (isQuote ? '. The lead will move to Quoted.' : '. The lead will be marked Won.') + '</span></div>' : '') +
      '<div class="card stack"><b>Customer <span class="hint" style="font-weight:400">Type a phone or name — returning customers fill in automatically</span></b>' +
      '<div class="grid2"><label class="field">Phone / WhatsApp<input type="tel" name="phone" id="nPhone" required placeholder="01xxxxxxxxx" autocomplete="off"></label>' +
      '<label class="field">Name<input type="text" name="name" id="nName" required autocomplete="off"></label></div>' +
      '<div class="cust-hits" id="nHits" style="display:none"></div><div id="nCustChip"></div></div>' +
      '<div class="card stack"><b>Products</b><input type="hidden" id="nProd">' +
      '<div class="row" style="gap:8px"><input type="search" id="nPQ" placeholder="Search products…" autocomplete="off" style="flex:1"><button type="button" class="btn sm" id="nPBrowse">Browse all ▾</button></div>' +
      '<div class="pp-list" id="nPL" style="display:none"></div>' +
      '<div class="row" id="nAddRow" style="display:none"><span class="small" id="nChosen" style="flex:1;min-width:0"></span><input type="number" id="nQty" min="1" value="1" style="width:80px" aria-label="Quantity"><button type="button" class="btn primary" id="nAdd">Add</button></div>' +
      '<div class="row" id="nOpts"></div><div class="small muted" id="nPreview"></div>' +
      '<div class="lines" id="nLines"></div>' +
      '<details id="nCustomBox"><summary class="small" style="cursor:pointer;font-weight:600">＋ Custom item (anything not in the catalog)</summary>' +
      '<div class="stack" style="margin-top:8px;gap:8px"><input type="text" id="cName" maxlength="160" placeholder="Item title, e.g. Vinyl wall branding with installation">' +
      '<textarea id="cNote" maxlength="1000" style="min-height:60px" placeholder="Description (optional) — size, material, what’s included… Shows under the title on the quote"></textarea>' +
      '<div class="row"><input type="number" id="cQty" min="1" value="1" style="width:80px" aria-label="Custom quantity"><span class="small">× EGP</span><input type="number" id="cPrice" min="0" step="0.01" style="width:110px" placeholder="each" aria-label="Price each">' +
      '<label class="row small"><input type="checkbox" id="cShip" checked> needs delivery</label><span class="spacer"></span><button type="button" class="btn sm primary" id="cAdd">Add item</button></div></div>' +
      '<div class="small muted" style="margin-top:4px">Tip: for "30 for EGP 7,000" enter 30 × 233.33 — totals round to whole pounds.</div></details></div>' +

      '<div class="card stack" id="nDelivery"><b>Delivery' + (isQuote ? ' <span class="hint">optional on a quote</span>' : '') + '</b>' +
      '<label class="field">Street address<textarea name="address" id="nAddr" style="min-height:60px" placeholder="Street, building, floor, apartment"></textarea></label>' +
      '<div class="field">Area <span class="hint">Search in English or Arabic, e.g. Nasr City / مدينة نصر</span><div class="pick" id="nPick"></div></div></div>' +
(isQuote ? '' :
      '<div class="card stack"><b>Payment</b>' +
      '<label class="field"><select name="payment" id="nPay">' + Object.entries(cat.payments).map(([k, v]) => '<option value="' + k + '">' + esc(v) + '</option>').join('') + '</select></label>' +
      // Deposit: only for cash on delivery; it's taken off what the courier collects.
      '<div id="nDepRow" class="stack" style="gap:6px"><div class="grid2 dep-row"><label class="field">Deposit paid now (EGP)<input type="number" name="paid_now" id="nDep" min="0" step="1" placeholder="0"></label>' +
      '<label class="field">Deposit paid by<select name="deposit_method"><option value="cash">Cash</option><option value="bank">Bank transfer</option><option value="wallet">InstaPay / wallet</option></select></label></div>' +
      '<div class="hint">Optional. The deposit is taken off what the courier collects.</div></div></div>' +
      '<div class="card stack"><label class="field"><b>Order notes</b> <span class="hint">For whoever packs the order — shown on the Bosta shipment and the waybill</span>' +
        '<textarea name="prep_notes" maxlength="500" style="min-height:56px" placeholder="e.g. Gift wrap it, add 2 extra stickers, the logo must be gold"></textarea></label></div>' +
      '<details class="card stack more-opts" id="nMore"><summary><b>More options</b> <span class="hint" style="font-weight:400">email, source, status, discount, delivery fee, notes</span></summary>' +
      '<label class="field">Email <span class="hint">Optional — for the invoice</span><input type="email" name="email" id="nEmail"></label>' +
      '<div class="grid3"><label class="field">Source<select name="source">' + cat.sources.filter((x) => x !== 'Website').map((x) => '<option value="' + esc(x) + '"' + (x === 'WhatsApp' ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></label>' +
      '<label class="field">Status<select name="status"><option value="Pending">Pending</option><option value="Confirmed" selected>Confirmed</option></select></label><span></span></div>' +
      '<div class="grid3"><label class="field">Discount (EGP)<input type="number" name="discount" id="nDisc" min="0" step="1" placeholder="0"></label>' +
      '<label class="field">Delivery fee (EGP)<input type="number" name="shipping" id="nShip" min="0" step="1" placeholder="auto"><span class="hint" id="nShipHint"></span></label>' +
      repOpts + '</div>' +
      '<label class="field">Notes<textarea name="notes" style="min-height:60px" placeholder="e.g. Customer wants delivery after 5pm"></textarea></label></details>') +
      (isQuote ?
      '<div class="card stack"><b>Quote details</b><label class="field">Customer email <span class="hint">Optional</span><input type="email" name="email" id="nEmail"></label><div class="grid3">' +
      '<label class="field">Valid until<input type="date" name="valid_until" value="' + addDays(14) + '"></label>' +
      '<label class="field">Discount (EGP)<input type="number" name="discount" id="nDisc" min="0" step="1" placeholder="0"></label>' +
      '<label class="field">Delivery fee (EGP)<input type="number" name="shipping" id="nShip" min="0" step="1" placeholder="auto"><span class="hint" id="nShipHint"></span></label></div>' +
      '<label class="field">Terms <span class="hint">Printed on the quote</span><textarea name="terms" style="min-height:70px">' + esc(QUOTE_TERMS) + '</textarea></label>' +
      '<label class="field">Internal notes <span class="hint">Not printed</span><textarea name="notes" style="min-height:50px"></textarea></label></div>' : '') +
      '<div class="card" id="nTotals"></div></form>';
    const submitLabel = isQuote ? (prefill.quoteId ? 'Save quote' : 'Create quote') : 'Create order';
    openDrawer(isQuote ? (prefill.quoteId ? 'Edit quote ' + (prefill.quoteNumber || '') : 'New quote') : 'New order', body,
      '<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" form="nf" type="submit" id="nSubmit">' + submitLabel + '</button>');
    if (prefill) {
      const f = $('#nf').elements; // .elements: form.name would be the form's own name
      f.name.value = prefill.name || ''; f.phone.value = prefill.phone || ''; f.email.value = prefill.email || '';
      if (prefill.interest) f.notes.value = 'Lead asked for: ' + prefill.interest;
      ['business_name', 'review_link', 'links', 'design_notes', 'address', 'terms', 'valid_until'].forEach((k) => { if (prefill[k] != null && f[k]) f[k].value = prefill[k]; });
      if (prefill.notes != null && f.notes) f.notes.value = prefill.notes;
      if (prefill.discount) f.discount.value = prefill.discount;
      if (prefill.shipping != null && prefill.shipping !== '') f.shipping.value = prefill.shipping;
      if (prefill.districtId && prefill.cityId) area = { districtId: prefill.districtId, cityId: prefill.cityId, title: prefill.district || 'Saved area', sub: prefill.city || '' };
      const missing = [];
      (prefill.items || []).forEach((it, i) => {
        if (it.custom) { lines.push({ custom: true, key: 'c' + i + Date.now(), name: it.name, note: it.note || '', price: +it.price, qty: +it.qty, ship: !!+it.ship }); return; }
        const p = cat.products.find((x) => x.id === it.id);
        if (!p) { missing.push(it.id); return; }
        lines.push({ key: p.id + '|' + (it.variant || '') + '|' + (it.addons || []).slice().sort().join('+'), p, variant: it.variant || ((p.variants || [])[0] || {}).id, addons: it.addons || [], qty: +it.qty || 1, note: it.note || '' });
      });
      if (missing.length) toast(missing.length + ' item(s) from the quote are no longer in the catalog — add them again', true);
    }

    const autoShip = () => {
      const phys = lines.filter((l) => (l.custom ? l.ship : l.p.cat !== 'services')).reduce((s, l) => s + lineCalc(l).total, 0);
      return phys > 0 && phys < cat.freeShippingThreshold ? cat.shippingFee : 0;
    };
    const renderTotals = () => {
      const sub = lines.reduce((s, l) => s + lineCalc(l).total, 0);
      const disc = Math.min(sub, +($('#nDisc').value || 0));
      const shipVal = $('#nShip').value;
      const ship = shipVal === '' ? autoShip() : +shipVal;
      $('#nShipHint').textContent = 'Auto: ' + (autoShip() ? egp(autoShip()) : 'free');
      const cod = $('#nPay') ? $('#nPay').value === 'cod' : null;
      const total = sub - disc + ship;
      if ($('#nDepRow')) { $('#nDepRow').style.display = cod ? '' : 'none'; if (!cod) $('#nDep').value = ''; }
      const dep = cod ? Math.min(total, Math.max(0, +($('#nDep') && $('#nDep').value) || 0)) : 0;
      $('#nTotals').innerHTML = '<div class="list"><div class="li muted"><span>Subtotal</span><span>' + egp(sub) + '</span></div>' +
        (disc ? '<div class="li muted"><span>Discount</span><span>−' + egp(disc) + '</span></div>' : '') +
        '<div class="li muted"><span>Delivery</span><span>' + (ship ? egp(ship) : 'Free') + '</span></div>' +
        '<div class="li"><b>Total</b><b>' + egp(total) + '</b></div>' +
        (dep ? '<div class="li pay-ok"><span>Deposit paid</span><span>−' + egp(dep) + '</span></div>' : '') +
        (cod === null ? '' : cod ? '<div class="li"><b>Courier collects</b><b>' + egp(total - dep) + '</b></div>'
          : '<div class="li small muted"><span>Already paid — courier collects nothing</span><span></span></div>') + '</div>';
      $('#nDelivery').style.opacity = lines.length && !physicalProducts() ? '.55' : '1';
    };
    const renderLines = () => {
      // One card per item: title (editable for custom items), quantity × price each = total, and a description
      // for the PDF. Quantity and custom prices update the total as you type.
      $('#nLines').innerHTML = lines.length ? lines.map((l, i) => { const c = lineCalc(l);
        const [ln1, ln2] = splitName(c.name);
        return '<div class="qline">' +
          '<div class="ql-head">' + (l.custom ? '<input type="text" class="ql-title" data-t="' + i + '" maxlength="160" value="' + esc(l.name) + '" placeholder="Item title" aria-label="Item title"><span class="pill">custom</span>'
            : '<div class="ql-name"><b>' + esc(ln1) + '</b>' + (ln2 ? ' <span class="it-sz">' + esc(ln2) + '</span>' : '') + '</div>') +
            '<button type="button" class="btn sm ql-x" data-x="' + i + '" aria-label="Remove" title="Remove">✕</button></div>' +
          '<div class="ql-nums"><label class="ql-f"><span>Qty</span><input type="number" min="1" step="1" inputmode="numeric" value="' + l.qty + '" data-q="' + i + '"></label>' +
            '<span class="ql-op">×</span>' +
            (l.custom ? '<label class="ql-f"><span>Price each (EGP)</span><input type="number" min="0" step="0.01" inputmode="decimal" value="' + l.price + '" data-p="' + i + '"></label>'
              : '<div class="ql-f"><span>Price each</span><b class="ql-each" data-each="' + i + '">' + egp(c.total / l.qty) + '</b></div>') +
            '<span class="ql-op">=</span><div class="ql-f ql-sum"><span>Total</span><b data-sum="' + i + '">' + egp(c.total) + '</b></div></div>' +
          '<textarea class="ql-note" data-n="' + i + '" maxlength="1000" rows="2" placeholder="Description (optional) — shows under the item on the PDF">' + esc(l.note || '') + '</textarea></div>'; }).join('')
        : '<div class="small muted" style="padding:6px 0">No products yet.</div>';
      const box = $('#nLines');
      // Live total for one line without redrawing the list (so the box you're typing in keeps focus).
      const refresh = (i) => {
        const l = lines[i], c = lineCalc(l);
        const sum = $('[data-sum="' + i + '"]', box); if (sum) sum.textContent = egp(c.total);
        const each = $('[data-each="' + i + '"]', box); if (each) each.textContent = egp(c.total / l.qty);
        renderTotals();
      };
      $$('[data-n]', box).forEach((t) => t.oninput = () => { lines[+t.dataset.n].note = t.value; });
      $$('[data-t]', box).forEach((t) => t.oninput = () => { lines[+t.dataset.t].name = t.value; });
      $$('[data-q]', box).forEach((inp) => {
        inp.oninput = () => { const v = parseInt(inp.value, 10); if (v >= 1) { lines[+inp.dataset.q].qty = v; refresh(+inp.dataset.q); } };
        inp.onchange = () => { lines[+inp.dataset.q].qty = Math.max(1, parseInt(inp.value, 10) || 1); renderLines(); };
      });
      $$('[data-p]', box).forEach((inp) => {
        inp.oninput = () => { const v = parseFloat(inp.value); if (v > 0) { lines[+inp.dataset.p].price = v; refresh(+inp.dataset.p); } };
        inp.onchange = () => { const v = parseFloat(inp.value); if (!(v > 0)) { toast('Enter a price above 0', true); inp.value = lines[+inp.dataset.p].price; } };
      });
      $$('[data-x]', box).forEach((b) => b.onclick = () => { lines.splice(+b.dataset.x, 1); renderLines(); });
      renderTotals();
    };
    // Size and extras pickers for the chosen product, with a live price preview.
    const chosenOpts = () => {
      const p = cat.products.find((x) => x.id === $('#nProd').value);
      if (!p) return null;
      const vSel = $('#nVariant');
      const addons = $$('[data-addon]').map((el) => el.value);
      return { p, variant: vSel ? vSel.value : ((p.variants || [])[0] || {}).id, addons, qty: Math.max(1, +$('#nQty').value || 1) };
    };
    const preview = () => {
      const c = chosenOpts();
      if (!c) { $('#nPreview').textContent = ''; return; }
      const r = priceLine(c.p, c.variant, c.addons, c.qty);
      const stock = c.p.cat === 'services' ? null : (r.variant ? r.variant.stock : c.p.stock);
      $('#nPreview').textContent = c.qty + ' × ' + r.name + ' = ' + egp(r.total) + ' (' + egp(r.unit) + ' each)' + (stock !== null ? ' · ' + stock + ' in stock' : '');
    };
    // Visual product picker: photo, short name, size in colour, price and stock; tap to choose.
    const pickList = () => {
      const q = ($('#nPQ').value || '').trim().toLowerCase();
      const chosen = $('#nProd').value;
      const list = cat.products.filter((p) => !q || (p.name + ' ' + (p.sub || '') + ' ' + (p.nameAr || '')).toLowerCase().includes(q));
      $('#nPL').innerHTML = list.length ? list.map((p) => { const [a, b] = splitName(p.name); const ranged = (p.variants && p.variants.length) || (p.tiers && p.tiers.length);
        return '<button type="button" class="pp' + (p.id === chosen ? ' on' : '') + '" data-pid="' + esc(p.id) + '">' +
          '<span class="pp-img">' + (p.image ? '<img src="' + esc(thumb(p.image, 120)) + '" alt="" loading="lazy">' : icon('box')) + '</span>' +
          '<span class="pp-t"><b>' + esc(a) + '</b>' + (p.brandId && cat.brands && cat.brands[p.brandId] ? '<span class="small muted">★ ' + esc(cat.brands[p.brandId]) + '</span>' : '') + (AR && p.nameAr ? '<span class="small muted" dir="rtl">' + esc(p.nameAr) + '</span>' : '') + (b ? '<span class="it-sz">' + esc(b) + '</span>' : '') +
          '<span class="pp-m"><b class="pp-price">' + (ranged ? 'from ' : '') + egp(ranged ? p.fromPrice : p.price) + (p.cat === 'services' ? ' / month' : '') + '</b>' +
          (p.cat === 'services' ? '' : '<span class="' + (p.stock <= 5 ? 'pp-low' : '') + '">' + p.stock + ' in stock</span>') + '</span></span></button>'; }).join('')
        : '<div class="small muted" style="padding:8px">No product matches.</div>';
      $$('[data-pid]', $('#nPL')).forEach((b) => b.onclick = () => {
        $('#nProd').value = b.dataset.pid; pickList(); $('#nProd').onchange();
        // Chosen: close the list so the form stays short; the choice shows next to the quantity.
        browsing = false; $('#nPQ').value = ''; $('#nPL').style.display = 'none'; $('#nPBrowse').textContent = 'Browse all ▾';
      });
    };
    let browsing = false;
    const showList = () => { $('#nPL').style.display = browsing || ($('#nPQ').value || '').trim() ? 'flex' : 'none'; $('#nPBrowse').textContent = browsing ? 'Close ▴' : 'Browse all ▾'; };
    $('#nPQ').oninput = () => { pickList(); showList(); };
    $('#nPBrowse').onclick = () => { browsing = !browsing; pickList(); showList(); };
    $('#nProd').onchange = () => {
      const pp = cat.products.find((x) => x.id === $('#nProd').value);
      $('#nAddRow').style.display = pp ? 'flex' : 'none';
      $('#nChosen').innerHTML = pp ? '<b>' + esc(splitName(pp.name)[0]) + '</b>' : '';
      const p = cat.products.find((x) => x.id === $('#nProd').value);
      $('#nOpts').innerHTML = !p ? '' :
        ((p.variants || []).length > 1 ? '<label class="field" style="flex:1">Size<select id="nVariant">' + p.variants.map((v) => '<option value="' + esc(v.id) + '">' + esc(v.label) + ' · ' + v.stock + ' in stock</option>').join('') + '</select></label>' : '') +
        (p.addons || []).map((g) => '<label class="field" style="flex:1">' + esc(g.group) + '<select data-addon>' + g.options.map((o) => '<option value="' + esc(o.id) + '">' + esc(o.label) + (o.price ? ' (+' + egp(o.price) + (o.per === 'order' ? ' once' : ' each') + ')' : '') + '</option>').join('') + '</select></label>').join('');
      $$('#nOpts select').forEach((el) => el.onchange = preview);
      preview();
    };
    $('#nQty').oninput = preview;
    $('#nAdd').onclick = () => {
      const c = chosenOpts();
      if (!c) return toast('Choose a product first', true);
      const key = c.p.id + '|' + (c.variant || '') + '|' + c.addons.slice().sort().join('+');
      const existing = lines.find((l) => l.key === key);
      if (existing) existing.qty += c.qty; else lines.push({ key, p: c.p, variant: c.variant, addons: c.addons, qty: c.qty });
      $('#nProd').value = ''; $('#nQty').value = 1; $('#nOpts').innerHTML = ''; $('#nPQ').value = ''; $('#nAddRow').style.display = 'none'; preview(); pickList();
      renderLines();
    };
    pickList();
    // Adds the custom item being typed. Also run on save, so a filled-in item isn't lost when "Add item" wasn't pressed.
    const addCustom = (quiet) => {
      const name = $('#cName').value.trim(), price = +$('#cPrice').value, qty = Math.max(1, +$('#cQty').value || 1);
      if (!name && !(price > 0)) return true;
      if (!name || !(price > 0)) { $('#nCustomBox').open = true; toast('Enter a title and a price for the custom item', true); return false; }
      lines.push({ custom: true, key: 'c' + Date.now(), name, note: $('#cNote').value.trim(), price, qty, ship: $('#cShip').checked });
      $('#cName').value = ''; $('#cNote').value = ''; $('#cPrice').value = ''; $('#cQty').value = 1;
      renderLines();
      if (!quiet) toast('Item added');
      return true;
    };
    $('#cAdd').onclick = () => addCustom(false);
    ['#nDisc', '#nShip', '#nPay', '#nDep'].forEach((sel) => { const el = $(sel); if (el) { el.oninput = renderTotals; el.onchange = renderTotals; } });
    renderLines();

    // Area picker: search + suggestions from the address, same engine as the shop checkout.
    const pick = $('#nPick');
    const renderPick = (suggestions) => {
      if (area) {
        pick.innerHTML = '<div class="chosen"><span aria-hidden="true">📍</span><div style="flex:1"><b>' + esc(area.title) + '</b><div class="small muted">' + esc(area.sub) + '</div></div><button type="button" class="btn sm" id="nAreaChange">Change</button></div>';
        $('#nAreaChange').onclick = () => { area = null; renderPick(); };
        return;
      }
      pick.innerHTML = '<input type="search" id="nAreaQ" autocomplete="off" placeholder="🔍 Type the area"><div class="results" id="nAreaR" style="display:none"></div>' +
        (suggestions && suggestions.length ? '<div class="row small"><span class="muted">✨ From the address:</span>' + suggestions.map((r, i) => '<button type="button" class="btn sm" data-sg="' + i + '">' + esc((AR && r.titleAr ? r.titleAr : r.title) + ' — ' + r.sub.replace(' · any neighbourhood', '')) + '</button>').join('') + '</div>' : '');
      const choose = (r) => { area = { districtId: r.districtId, cityId: r.cityId, title: r.title + (r.titleAr ? ' · ' + r.titleAr : ''), sub: r.sub }; renderPick(); };
      $$('[data-sg]', pick).forEach((b) => b.onclick = () => choose(suggestions[+b.dataset.sg]));
      let t;
      $('#nAreaQ').oninput = (e) => {
        clearTimeout(t);
        const q = e.target.value.trim(), box = $('#nAreaR');
        if (q.length < 2) { box.style.display = 'none'; return; }
        t = setTimeout(async () => {
          const res = await fetch('../api/public.php?action=area_search&q=' + encodeURIComponent(q)).then((r) => r.json()).catch(() => ({ results: [] }));
          const list = res.results || [];
          box.innerHTML = list.length ? list.map((r, i) => '<button type="button" data-ar="' + i + '"><b>' + esc(r.title) + '</b> <span class="muted">' + esc(r.titleAr) + '</span><div class="small muted">' + esc(r.sub) + '</div></button>').join('')
            : '<div class="small muted" style="padding:10px 12px">No match — try another spelling</div>';
          box.style.display = 'block';
          $$('[data-ar]', box).forEach((b) => b.onclick = () => choose(list[+b.dataset.ar]));
        }, 250);
      };
    };
    renderPick();

    // Returning customers: search by phone or name and fill in everything we know.
    let lookT, lookSeq = 0;
    const hits = $('#nHits');
    const fillCustomer = (c) => {
      const f = $('#nf').elements;
      f.name.value = c.name || f.name.value; f.phone.value = c.phone || f.phone.value;
      if (c.email && f.email) f.email.value = c.email;
      if (c.address) f.address.value = c.address;
      if (c.districtId && c.cityId) { area = { districtId: c.districtId, cityId: c.cityId, title: c.district || c.city, sub: c.district ? c.city : '' }; renderPick(); }
      hits.style.display = 'none';
      $('#nCustChip').innerHTML = '<div class="chosen">' + icon('person') + '<span><b>' + esc(c.name) + '</b> · ' + (c.orders ? c.orders + ' earlier order' + (c.orders > 1 ? 's' : '') : c.from === 'account' ? 'website account' : c.from === 'quote' ? 'from a quote' : 'from leads') +
        (c.address ? ' · address filled in' : '') + '</span></div>';
    };
    const lookup = (q) => {
      clearTimeout(lookT);
      if (q.trim().length < 2) { hits.style.display = 'none'; return; }
      const seq = ++lookSeq;
      lookT = setTimeout(async () => {
        const d = await api('customer_lookup', { query: '&q=' + encodeURIComponent(q.trim()) }).catch(() => ({ results: [] }));
        if (seq !== lookSeq) return;
        if (!d.results.length) { hits.style.display = 'none'; return; }
        hits.innerHTML = '<div class="small muted" style="padding:2px 4px 6px">Existing customers — tap to fill in</div>' + d.results.map((c, i) =>
          '<button type="button" data-hit="' + i + '"><span><b>' + esc(c.name) + '</b><span class="small muted">' + esc([c.phone, [c.district, c.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ')) + '</span></span>' +
          '<span class="small">' + (c.orders ? c.orders + ' order' + (c.orders > 1 ? 's' : '') : c.from === 'account' ? 'account' : c.from === 'quote' ? 'quote' : 'lead') + '</span></button>').join('');
        hits.style.display = 'block';
        $$('[data-hit]', hits).forEach((b) => b.onclick = () => fillCustomer(d.results[+b.dataset.hit]));
      }, 250);
    };
    $('#nPhone').addEventListener('input', (e) => lookup(e.target.value));
    $('#nName').addEventListener('input', (e) => lookup(e.target.value));
    let st;
    $('#nAddr').oninput = (e) => {
      clearTimeout(st);
      const text = e.target.value;
      if (area || text.trim().length < 4) return;
      st = setTimeout(async () => {
        const res = await fetch('../api/public.php?action=area_suggest&text=' + encodeURIComponent(text)).then((r) => r.json()).catch(() => ({ results: [] }));
        if (!area) renderPick(res.results || []);
      }, 600);
    };

    $('#nf').onsubmit = async (e) => {
      e.preventDefault();
      if (!addCustom(true)) return;
      if (lines.some((l) => l.custom && !String(l.name).trim())) return toast('Give every custom item a title', true);
      if (!lines.length) return toast('Add at least one product', true);
      if (!isQuote && physicalProducts() && !area) return toast('Choose the delivery area', true);
      const data = formData(e.target);
      data.items = lines.map((l) => l.custom ? { custom: 1, name: String(l.name).trim(), note: (l.note || '').trim(), price: l.price, qty: l.qty, ship: l.ship ? 1 : 0 }
        : { id: l.p.id, variant: l.variant, addons: l.addons, qty: l.qty, note: (l.note || '').trim() });
      if (area) { data.city_id = area.cityId; data.district_id = area.districtId; }
      if (data.shipping === '') delete data.shipping;
      if (prefill && prefill.leadId) data.lead_id = prefill.leadId;
      const btn = $('#nSubmit'); btn.disabled = true; btn.textContent = 'Saving…';
      if (isQuote) {
        if (prefill.quoteId) data.id = prefill.quoteId;
        try {
          const r = await api('quote_save', { method: 'POST', body: data });
          closeDrawer(); toast('Quote ' + r.quote.number + ' saved · ' + egp(r.quote.total));
          if (S.route === 'quotes') { await pageQuotes(); quoteDrawer(r.quote); } else { S.openQuote = r.quote.id; location.hash = '#quotes'; }
        } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = submitLabel; }
        return;
      }
      if (prefill && prefill.quoteId) data.quote_id = prefill.quoteId;
      try {
        const r = await api('order_create', { method: 'POST', body: data });
        closeDrawer();
        toast('Order ' + r.number + ' created · ' + egp(r.total) + (r.lead === 'created' ? ' · customer added to Leads' : r.lead === 'updated' ? ' · existing lead updated' : ''));
        S.orderStatus = ''; S.orderQ = '';
        if (S.route === 'orders') { await pageOrders(); const o = S.orders.find((x) => x.id === r.id); if (o) orderDrawer(o); }
        else location.hash = '#orders';
      } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = 'Create order'; }
    };
  }

  // ---------- products ----------
  // Product reviews from verified buyers (customers with a delivered order of that product): hide, show or delete.
  async function reviewsDrawer() {
    let d;
    try { d = await api('reviews_list'); } catch (e) { return toast(e.message, true); }
    const stars = (n) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
    const w = openDrawer('Product reviews', '<p class="hint">Only customers whose order with the product was delivered can review it. Hidden reviews don’t show on the site.</p>' +
      (d.reviews.length ? '<div class="stack">' + d.reviews.map((r) => '<div class="card stack" style="gap:6px' + (r.status === 'hidden' ? ';opacity:.55' : '') + '">' +
        '<div class="row"><b>' + esc(r.product) + '</b><span class="spacer"></span><span style="color:var(--accent)">' + stars(r.rating) + '</span></div>' +
        '<div class="small muted">' + esc(r.name) + ' · ' + esc(r.email || '') + (r.order ? ' · ' + esc(r.order) : '') + ' · ' + dateTime(r.at) + (r.status === 'hidden' ? ' · <b>Hidden</b>' : '') + '</div>' +
        '<div style="white-space:pre-line">' + esc(r.text) + '</div>' +
        '<div class="row"><span class="spacer"></span><button class="btn sm" data-rh="' + r.id + '" data-h="' + (r.status === 'hidden' ? 0 : 1) + '">' + (r.status === 'hidden' ? 'Show on site' : 'Hide') + '</button>' +
        '<button class="btn sm danger" data-rd="' + r.id + '">Delete</button></div></div>').join('') + '</div>' : '<div class="muted">No reviews yet.</div>'));
    $$('[data-rh]', w).forEach((b) => b.onclick = async () => { try { await api('review_set', { method: 'POST', body: { id: +b.dataset.rh, hidden: +b.dataset.h } }); reviewsDrawer(); } catch (e) { toast(e.message, true); } });
    $$('[data-rd]', w).forEach((b) => b.onclick = async () => { if (!confirm('Delete this review?')) return; try { await api('review_set', { method: 'POST', body: { id: +b.dataset.rd, delete: 1 } }); reviewsDrawer(); } catch (e) { toast(e.message, true); } });
  }

  async function pageProducts() {
    const d = await api('products');
    S.products = d.products; S.cats = d.categories; S.brands = d.brands || [];
    const cat = S.prodCat || '';
    const q = (S.prodQ || '').toLowerCase();
    // Filters that keep a long catalogue manageable: partner brand, status / stock, and sort order.
    const brand = S.prodBrand || '', show = S.prodShow || '', sort = S.prodSort || '';
    const stockOf = (p) => p.variants && p.variants.length ? p.variants.reduce((a, v) => a + (+v.stock || 0), 0) : (+p.stock || 0);
    const priceOf = (p) => (p.variants && p.variants.length) || (p.tiers && p.tiers.length) ? p.fromPrice : (p.discountPct ? p.price * (1 - p.discountPct / 100) : p.price);
    const physical = (p) => p.cat !== 'services';
    const shows = { live: (p) => p.status === 'Active', hidden: (p) => p.status !== 'Active', out: (p) => p.status === 'Active' && physical(p) && stockOf(p) <= 0,
      low: (p) => p.status === 'Active' && physical(p) && stockOf(p) > 0 && stockOf(p) <= 5 };
    let list = d.products.filter((p) => (!cat || p.cat === cat) && (!q || (p.name + ' ' + (p.nameAr || '') + ' ' + p.sku + ' ' + p.vendor).toLowerCase().includes(q)) &&
      (!brand || (brand === 'own' ? !p.brandId : p.brandId === +brand)) && (!show || shows[show](p)));
    const sorts = { name: (a, b) => a.name.localeCompare(b.name), price: (a, b) => priceOf(a) - priceOf(b), 'price-desc': (a, b) => priceOf(b) - priceOf(a), stock: (a, b) => stockOf(a) - stockOf(b) };
    if (sorts[sort]) list = list.slice().sort(sorts[sort]);
    const filtered = !!(cat || q || brand || show);
    const catName = (c) => (AR && c.label_ar) || c.label;
    const catLabel = (k) => { const c = d.categories.find((x) => x.key === k); return c ? catName(c) : k; };
    $('#main').innerHTML = header('Products', d.products.length + ' products · ' + d.categories.length + ' categories',
      '<button class="btn" id="revBtn">Reviews</button><button class="btn" id="catsBtn">Categories</button><button class="btn primary" id="addBtn">+ Add product</button>') +
      '<div class="row prod-filters"><select id="cat"><option value="">All categories</option>' +
      d.categories.map((c) => '<option value="' + esc(c.key) + '"' + (c.key === cat ? ' selected' : '') + '>' + esc(catName(c)) + ' (' + c.count + ')</option>').join('') + '</select>' +
      (S.brands.length ? '<select id="pBrand"><option value="">All brands</option><option value="own"' + (brand === 'own' ? ' selected' : '') + '>Our own products</option>' +
        S.brands.map((b) => '<option value="' + b.id + '"' + (String(b.id) === brand ? ' selected' : '') + '>' + esc(b.name) + ' (' + d.products.filter((p) => p.brandId === b.id).length + ')</option>').join('') + '</select>' : '') +
      '<select id="pShow">' + [['', 'All statuses'], ['live', 'Live in the shop'], ['hidden', 'Hidden (draft / archived)'], ['out', 'Out of stock'], ['low', 'Low stock (5 or fewer)']].map(([v, l]) =>
        '<option value="' + v + '"' + (v === show ? ' selected' : '') + '>' + l + (v ? ' (' + d.products.filter(shows[v]).length + ')' : '') + '</option>').join('') + '</select>' +
      '<select id="pSort">' + [['', 'Sort: shop order'], ['name', 'Sort: name'], ['price', 'Sort: price, low first'], ['price-desc', 'Sort: price, high first'], ['stock', 'Sort: stock, lowest first']].map(([v, l]) =>
        '<option value="' + v + '"' + (v === sort ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
      '<span class="spacer"></span><input type="search" id="q" placeholder="Search name, SKU, brand" value="' + esc(S.prodQ || '') + '"></div>' +
      (filtered ? '<div class="small muted" style="margin:-4px 0 12px">Showing ' + list.length + ' of ' + d.products.length + ' · <a href="#" id="pClear">Clear filters</a></div>' : '') +
      (list.length ? '<div class="table-wrap"><table><thead><tr><th></th><th>Product</th><th>Category</th><th class="num">Price</th><th class="num">Stock</th><th>Status</th></tr></thead><tbody>' +
        list.map((p) => {
          const img = p.images[0] ? thumb(p.images[0].path, 120) : '';
          const sale = (p.variants && p.variants.length) || (p.tiers && p.tiers.length) ? p.fromPrice : (p.discountPct ? Math.round(p.price * (1 - p.discountPct / 100)) : p.price);
          return '<tr class="click" data-id="' + esc(p.id) + '"><td style="width:60px">' + (img ? '<img class="thumb" src="' + esc(img) + '" alt="" loading="lazy">' : '<div class="thumb"></div>') + '</td>' +
            '<td><b>' + esc(p.name) + '</b>' + brandChip(p.brandId) + '<div class="small muted">' + esc([p.sku, p.vendor].filter(Boolean).join(' · ')) + ' · ' + p.images.length + ' photo' + (p.images.length === 1 ? '' : 's') + '</div></td>' +
            '<td>' + esc(catLabel(p.cat)) + (p.variants && p.variants.length ? '<div class="small muted">' + p.variants.length + ' sizes</div>' : '') + '</td><td class="num">' + ((p.variants && p.variants.length) || (p.tiers && p.tiers.length) ? '<span class="small muted">from </span>' : '') + egp(sale) + (p.discountPct ? '<div class="small muted"><s>' + egp(p.price) + '</s></div>' : '') + (p.period ? '<div class="small muted">/ month</div>' : '') + '</td>' +
            '<td class="num">' + (p.cat === 'services' ? '—' : (stockOf(p) <= 5 ? '<span class="pill warn">⚠ ' + stockOf(p) + '</span>' : stockOf(p))) + '</td><td>' + pill(PRODUCT_TONE, p.status) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : filtered ? '<div class="card empty">No products match these filters.</div>' : '<div class="card empty">No products here yet. <button class="btn primary sm" id="addBtn2">Add one</button></div>');
    $('#cat').onchange = (e) => { S.prodCat = e.target.value; pageProducts(); };
    const pb = $('#pBrand'); if (pb) pb.onchange = (e) => { S.prodBrand = e.target.value; pageProducts(); };
    $('#pShow').onchange = (e) => { S.prodShow = e.target.value; pageProducts(); };
    $('#pSort').onchange = (e) => { S.prodSort = e.target.value; pageProducts(); };
    const pc = $('#pClear'); if (pc) pc.onclick = (e) => { e.preventDefault(); S.prodCat = S.prodQ = S.prodBrand = S.prodShow = ''; pageProducts(); };
    let t; $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { S.prodQ = e.target.value; pageProducts().then(() => { const el = $('#q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); }, 250); };
    $('#addBtn').onclick = () => productDrawer(null);
    const a2 = $('#addBtn2'); if (a2) a2.onclick = () => productDrawer(null);
    $('#catsBtn').onclick = categoriesDrawer;
    $('#revBtn').onclick = reviewsDrawer;
    $$('tr[data-id]').forEach((tr) => tr.onclick = () => productDrawer(S.products.find((p) => p.id === tr.dataset.id)));
    if (S.openProduct) { const p = S.products.find((x) => x.id === S.openProduct); S.openProduct = null; if (p) productDrawer(p); }
    if (S.newBrand) { productDrawer(null); S.newBrand = null; } // "+ Add product" on a partner brand
  }

  function productDrawer(p) {
    const isNew = !p;
    p = p || { id: '', name: '', nameAr: '', subAr: '', descAr: '', sku: '', vendor: '', brandId: S.newBrand || null, cat: S.prodCat || (S.cats[0] || {}).key, price: '', cost: '', stock: 0, discountPct: 0, label: '', status: 'Active', sub: '', desc: '', features: [], images: [], variants: [], tiers: [], addons: [], personalized: false };
    // Working copy of sizes / quantity prices / extras, edited in the "Sizes & prices" card.
    const opt = {
      variants: JSON.parse(JSON.stringify(p.variants || [])),
      tiers: JSON.parse(JSON.stringify(p.tiers || [])),
      addons: JSON.parse(JSON.stringify(p.addons || [])),
    };
    const body = '<form id="pf" class="stack">' +
      '<div class="grid2"><label class="field">Product name<input type="text" name="name" required value="' + esc(p.name) + '"></label>' +
      '<label class="field">Name in Arabic <span class="hint">Shown on the Arabic shop</span><input type="text" name="nameAr" dir="rtl" value="' + esc(p.nameAr || '') + '" placeholder="اسم المنتج بالعربي"></label></div>' +
      '<div class="grid2"><label class="field">Category<select name="cat">' + S.cats.map((c) => '<option value="' + esc(c.key) + '"' + (c.key === p.cat ? ' selected' : '') + '>' + esc((AR && c.label_ar) || c.label) + '</option>').join('') + '</select></label>' +
      '<label class="field">Status<select name="status">' + ['Active', 'Draft', 'Archived'].map((s) => '<option value="' + s + '"' + (s === p.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select><span class="hint">Only Active products show in the shop.</span></label></div>' +
      '<div class="grid3"><label class="field">Price (EGP)<input type="number" name="price" min="0" step="0.01" value="' + esc(p.price) + '"><span class="hint" id="priceHint">Price for one piece</span></label>' +
      '<label class="field">Discount %<input type="number" name="discountPct" min="0" max="90" step="0.01" value="' + esc(p.discountPct) + '"></label>' +
      '<label class="field" id="stockField">Stock<input type="number" name="stock" min="0" step="1" value="' + esc(p.stock) + '"><span class="hint">Ignored for plans</span></label></div>' +
      '<label class="field">Partner brand <span class="hint">Shows the brand’s logo on this product in the shop. Its sales go on the brand’s statement, with your commission.</span><select name="brandId">' +
        '<option value="">Where To Spot (our own product)</option>' + (S.brands || []).map((b) => '<option value="' + b.id + '"' + (b.id === p.brandId ? ' selected' : '') + '>' + esc(b.name) + (b.commission ? ' · ' + b.commission + '% commission' : '') + (b.active ? '' : ' (off)') + '</option>').join('') + '</select></label>' +
      '<div class="card stack brand-pricing" id="brandPricing"><b>Price from the brand</b>' +
        '<div class="grid2"><label class="field">Brand’s price (EGP) <span class="hint">What the brand charges for the main size, before your commission</span><input type="number" name="brandPrice" min="0" step="0.01" value="' + esc(p.brandPrice || '') + '" placeholder="e.g. 750"></label>' +
        '<label class="field">Your margin (%) <span class="hint" id="marginHint"></span><input type="number" name="marginPct" min="0" max="500" step="0.5" value="' + esc(p.marginPct == null ? '' : p.marginPct) + '"></label></div>' +
        '<div class="small" id="brandPriceInfo"></div></div>' +
      '<div class="card stack" id="optCard"></div>' +
      '<label class="row" style="font-weight:600"><input type="checkbox" name="personalized" ' + (p.personalized ? 'checked' : '') + '> Needs personalisation <span class="hint" style="font-weight:400">Checkout asks for business name, review link, logo and design notes</span></label>' +
      '<div class="grid3"><label class="field">Cost (EGP)<input type="number" name="cost" min="0" step="0.01" value="' + esc(p.cost) + '"><span class="hint">Private — not shown in shop</span></label>' +
      '<label class="field">SKU<input type="text" name="sku" value="' + esc(p.sku) + '"></label>' +
      '<label class="field">Brand / vendor<input type="text" name="vendor" value="' + esc(p.vendor) + '"></label></div>' +
      '<div class="grid2"><label class="field">Short line<input type="text" name="sub" value="' + esc(p.sub) + '" placeholder="e.g. 150ml, hydrating cleanser"></label>' +
      '<label class="field">Badge<input type="text" name="label" value="' + esc(p.label) + '" placeholder="e.g. 3+1 Free, New"></label></div>' +
      '<label class="field">Short line in Arabic<input type="text" name="subAr" dir="rtl" value="' + esc(p.subAr || '') + '" placeholder="سطر قصير بالعربي"></label>' +
      '<div class="grid2"><label class="field">Description<textarea name="desc">' + esc(p.desc) + '</textarea></label>' +
      '<label class="field">Description in Arabic<textarea name="descAr" dir="rtl" placeholder="الوصف بالعربي">' + esc(p.descAr || '') + '</textarea></label></div>' +
      '<label class="field">Features / bullet points <span class="hint">One per line (shown on plan cards)</span><textarea name="features" style="min-height:70px">' + esc((p.features || []).join('\n')) + '</textarea></label>' +
      // How the product shows on Google (and what AI assistants read): hand-written, or automatic when empty.
      '<div class="card stack seo-card"><div><b>Google search</b> <span class="hint">How this product shows on Google. Leave a box empty to use the automatic text (shown faded). Best: title up to 60 characters, description up to 160.</span></div>' +
        '<div class="small warn-text" id="seoArWarn"></div>' +
        '<div class="grid2">' + [['en', 'English', 'seoTitle', 'seoDesc', ''], ['ar', 'Arabic', 'seoTitleAr', 'seoDescAr', ' dir="rtl"']].map(([k, label, t, d, dir]) =>
          '<div class="stack"><label class="field">Search title · ' + label + ' <span class="hint seo-n" data-for="' + t + '"></span><input type="text" name="' + t + '"' + dir + ' maxlength="120" value="' + esc(p[t] || '') + '" placeholder="' + esc(((p.seoAuto || {})[k] || [])[0] || '') + '"></label>' +
          '<label class="field">Search description · ' + label + ' <span class="hint seo-n" data-for="' + d + '"></span><textarea name="' + d + '"' + dir + ' maxlength="320" style="min-height:70px" placeholder="' + esc(((p.seoAuto || {})[k] || [])[1] || '') + '">' + esc(p[d] || '') + '</textarea></label>' +
          '<div class="serp"' + dir + ' data-serp="' + k + '"></div></div>').join('') + '</div>' +
        (isNew ? '<div class="hint">The automatic text is written when you save.</div>' : '') + '</div>' +
      '</form>' +
      '<div class="stack" style="margin-top:22px"><div class="row"><b>Photos</b><span class="muted small">First photo is the cover. JPG, PNG or WebP up to 5 MB — big photos are resized automatically.</span></div>' +
      (isNew ? '<div class="card muted small">Save the product first, then add photos.</div>' : '<div class="photos" id="photos"></div>') + '</div>';
    const foot = (isNew ? '' : '<button class="btn danger" id="delBtn">Delete</button>') + '<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" form="pf" type="submit">' + (isNew ? 'Create product' : 'Save changes') + '</button>';
    openDrawer(isNew ? 'Add product' : p.name, body, foot);
    $$('#drawer [data-close]').forEach((b) => b.addEventListener('click', closeDrawer));
    if (!isNew) renderPhotos(p);
    // Partner brand pricing: brand price + margin = the shop price; sizes follow the main price.
    const pf = $('#pf').elements;
    const brandOfForm = () => (S.brands || []).find((b) => b.id === +pf.brandId.value) || null;
    opt.mainPrice = () => {
      const br = brandOfForm(), bp = +pf.brandPrice.value || 0;
      if (br && bp > 0) return Math.round(bp * (1 + (pf.marginPct.value === '' ? br.margin || 0 : +pf.marginPct.value) / 100));
      return +pf.price.value || 0;
    };
    const syncBrandPricing = () => {
      const br = brandOfForm(), bp = +pf.brandPrice.value || 0;
      $('#brandPricing').style.display = br ? '' : 'none';
      $('#marginHint').textContent = br ? 'Leave empty to use ' + br.name + '’s margin (' + (br.margin || 0) + '%)' : '';
      const auto = !!(br && bp > 0);
      pf.price.readOnly = auto;
      if (auto) {
        const main = opt.mainPrice(), comm = bp * (br.commission || 0) / 100;
        pf.price.value = main;
        $('#brandPriceInfo').innerHTML = 'Shop price <b>' + egp(main) + '</b>. On each one you keep <b class="pay-ok">' + egp(main - bp + comm) + '</b> (' + egp(comm) + ' commission + ' + egp(main - bp) + ' margin); ' + esc(br.name) + ' gets ' + egp(bp - comm) + '.';
      } else $('#brandPriceInfo').textContent = br ? 'Enter the brand’s price to work out the shop price automatically.' : '';
      renderOptions(opt);
    };
    ['brandId', 'brandPrice', 'marginPct', 'price'].forEach((n) => pf[n].addEventListener('input', syncBrandPricing));
    pf.brandId.addEventListener('change', syncBrandPricing);
    syncBrandPricing();
    // Google search preview with character counts (typed text, or the automatic one).
    const syncSeo = () => {
      [['en', 'seoTitle', 'seoDesc'], ['ar', 'seoTitleAr', 'seoDescAr']].forEach(([k, t, d]) => {
        const auto = (p.seoAuto || {})[k] || [], title = pf[t].value.trim() || auto[0] || '', desc = pf[d].value.trim() || auto[1] || '';
        [[t, title, 60], [d, desc, 160]].forEach(([n, v, max]) => {
          const el = $('#pf .seo-n[data-for="' + n + '"]');
          el.textContent = v.length + ' / ' + max + (pf[n].value.trim() ? '' : ' · automatic');
          el.classList.toggle('warn-text', v.length > max);
        });
        $('#pf [data-serp="' + k + '"]').innerHTML = '<div class="serp-u">shop.wheretospot.com › p › ' + esc(p.id || '…') + '</div><div class="serp-t">' + esc(title || '—') + '</div><div class="serp-d">' + esc(desc) + '</div>';
      });
      $('#seoArWarn').textContent = pf.nameAr.value.trim() && pf.descAr.value.trim() ? '' : 'Add the Arabic name and description above: without them the Arabic page shows English text, which Google ranks lower.';
    };
    ['seoTitle', 'seoDesc', 'seoTitleAr', 'seoDescAr', 'nameAr', 'descAr'].forEach((n) => pf[n].addEventListener('input', syncSeo));
    syncSeo();
    $('#pf').onsubmit = async (e) => {
      e.preventDefault();
      const data = formData(e.target);
      data.id = p.id;
      data.variants = opt.variants; data.tiers = opt.tiers; data.addons = opt.addons;
      data.features = String(data.features || '').split('\n').map((s) => s.trim()).filter(Boolean);
      try {
        const r = await api('product_save', { method: 'POST', body: data });
        toast(isNew ? 'Product created — now add photos' : 'Saved');
        await pageProducts();
        if (isNew) productDrawer(S.products.find((x) => x.id === r.id)); else closeDrawer();
      } catch (err) { toast(err.message, true); }
    };
    const del = $('#delBtn');
    if (del) del.onclick = async () => {
      if (!confirm('Delete "' + p.name + '" and its photos? This cannot be undone. Tip: set status to Archived to hide it instead.')) return;
      try { await api('product_delete', { method: 'POST', body: { id: p.id } }); closeDrawer(); toast('Product deleted'); pageProducts(); }
      catch (err) { toast(err.message, true); }
    };
  }

  // ---------- sizes, quantity prices and extras ----------
  function tierEditor(tiers, path) {
    return '<div class="small muted" style="margin-top:4px">Quantity prices <span class="hint">price per piece from that quantity — e.g. 3 for EGP 1,000 → 333.33</span></div>' +
      tiers.map((t, i) => '<div class="row" style="margin-top:4px"><span class="small">From</span><input type="number" min="1" step="1" style="width:80px" data-path="' + path + '.' + i + '.min" value="' + esc(t.min) + '">' +
        '<span class="small">pcs → EGP</span><input type="number" min="0" step="0.01" style="width:110px" data-path="' + path + '.' + i + '.price" value="' + esc(t.price) + '"><span class="small muted">each</span>' +
        '<button type="button" class="btn sm" data-del="' + path + '.' + i + '" aria-label="Remove price">✕</button></div>').join('') +
      '<button type="button" class="btn sm" style="margin-top:6px" data-add-tier="' + path + '">+ Price break</button>';
  }
  function renderOptions(opt) {
    const card = $('#optCard');
    if (!card) return;
    const hasSizes = opt.variants.length > 0;
    const main = opt.mainPrice ? opt.mainPrice() : 0;
    card.innerHTML = '<div class="row"><b>Sizes &amp; prices</b><span class="spacer"></span>' +
      '<label class="row small" style="font-weight:600"><input type="checkbox" id="optSizes" ' + (hasSizes ? 'checked' : '') + '> Comes in sizes</label></div>' +
      (hasSizes ? opt.variants.map((v, i) => '<div class="card" style="padding:12px;background:#FBF8F4">' +
          '<div class="row"><input type="text" placeholder="Size, e.g. 15×10 cm" style="flex:1;min-width:140px" data-path="variants.' + i + '.label" value="' + esc(v.label) + '">' +
          '<input type="text" placeholder="SKU" style="width:110px" data-path="variants.' + i + '.sku" value="' + esc(v.sku || '') + '">' +
          '<span class="small">Stock</span><input type="number" min="0" style="width:80px" data-path="variants.' + i + '.stock" value="' + esc(v.stock || 0) + '">' +
          '<button type="button" class="btn sm danger" data-del="variants.' + i + '">Remove size</button></div>' +
          '<div class="row" style="margin-top:8px"><span class="small">Price</span><select data-path="variants.' + i + '.ratio" data-rerender style="width:auto">' +
            [[1, 'Same as the main price'], [0.5, '½ of the main price'], [0.3333, '⅓ of the main price'], [0.25, '¼ of the main price'], [2, '2× the main price'], [0, 'Its own price']]
              .map(([r, l]) => '<option value="' + r + '"' + (Math.abs((+v.ratio || 0) - r) < 0.001 ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
            (+v.ratio > 0 ? '<b class="small">= ' + egp(Math.round(main * +v.ratio)) + '</b>'
              : '<input type="number" min="0" step="0.01" style="width:110px" data-path="variants.' + i + '.price" value="' + esc(v.price || '') + '" placeholder="EGP" aria-label="Price of this size">') + '</div>' +
          tierEditor(v.tiers || [], 'variants.' + i + '.tiers') + '</div>').join('') +
        '<button type="button" class="btn sm" data-add-size>+ Add size</button>'
        : tierEditor(opt.tiers, 'tiers')) +
      '<div style="border-top:1px solid var(--line-2);padding-top:12px"><b>Extras</b> <span class="hint">Choices like Standard / Custom design. The first option is the default.</span></div>' +
      opt.addons.map((g, gi) => '<div class="card" style="padding:12px;background:#FBF8F4"><div class="row"><input type="text" placeholder="Group name, e.g. Design" style="flex:1" data-path="addons.' + gi + '.group" value="' + esc(g.group) + '">' +
          '<button type="button" class="btn sm danger" data-del="addons.' + gi + '">Remove group</button></div>' +
          (g.options || []).map((o, oi) => '<div class="row" style="margin-top:6px"><input type="text" placeholder="Option, e.g. Custom design" style="flex:1;min-width:140px" data-path="addons.' + gi + '.options.' + oi + '.label" value="' + esc(o.label) + '">' +
            '<span class="small">+ EGP</span><input type="number" step="0.01" style="width:90px" data-path="addons.' + gi + '.options.' + oi + '.price" value="' + esc(o.price || 0) + '">' +
            '<select data-path="addons.' + gi + '.options.' + oi + '.per" style="width:auto"><option value="unit"' + (o.per !== 'order' ? ' selected' : '') + '>per piece</option><option value="order"' + (o.per === 'order' ? ' selected' : '') + '>once per order</option></select>' +
            '<button type="button" class="btn sm" data-del="addons.' + gi + '.options.' + oi + '" aria-label="Remove option">✕</button></div>').join('') +
          '<button type="button" class="btn sm" style="margin-top:6px" data-add-option="' + gi + '">+ Option</button></div>').join('') +
      '<div class="row"><button type="button" class="btn sm" data-add-group>+ Extras group</button>' +
      (opt.addons.length ? '' : '<button type="button" class="btn sm" data-add-design>+ Standard / Custom design</button>') + '</div>';
    const get = (path) => path.split('.').reduce((o, k) => o[k], opt);
    const parentOf = (path) => { const parts = path.split('.'); const last = parts.pop(); return [parts.reduce((o, k) => o[k], opt), last]; };
    $$('[data-path]', card).forEach((el) => {
      el.oninput = el.onchange = () => {
        const [parent, key] = parentOf(el.dataset.path);
        parent[key] = el.type === 'number' ? (el.value === '' ? '' : +el.value) : el.value;
        if (el.dataset.rerender !== undefined) renderOptions(opt);
      };
    });
    $$('[data-del]', card).forEach((b) => b.onclick = () => { const [parent, key] = parentOf(b.dataset.del); parent.splice(+key, 1); renderOptions(opt); });
    $$('[data-add-tier]', card).forEach((b) => b.onclick = () => {
      const list = get(b.dataset.addTier);
      const last = list[list.length - 1];
      list.push({ min: last ? last.min + 2 : 1, price: last ? last.price : '' });
      renderOptions(opt);
    });
    const addSize = $('[data-add-size]', card);
    if (addSize) addSize.onclick = () => { opt.variants.push({ label: '', sku: '', stock: 0, ratio: 0, price: '', tiers: [] }); renderOptions(opt); };
    $('#optSizes').onchange = (e) => {
      if (e.target.checked && !opt.variants.length) opt.variants.push({ label: '', sku: '', stock: 0, ratio: 1, tiers: opt.tiers });
      if (!e.target.checked && opt.variants.length && !confirm('Remove all sizes and their prices and stock?')) { e.target.checked = true; return; }
      if (!e.target.checked) opt.variants = [];
      renderOptions(opt);
    };
    $$('[data-add-option]', card).forEach((b) => b.onclick = () => { opt.addons[+b.dataset.addOption].options.push({ label: '', price: 0, per: 'unit' }); renderOptions(opt); });
    $('[data-add-group]', card).onclick = () => { opt.addons.push({ group: '', options: [{ label: '', price: 0, per: 'unit' }] }); renderOptions(opt); };
    const design = $('[data-add-design]', card);
    if (design) design.onclick = () => { opt.addons.push({ group: 'Design', options: [{ label: 'Standard design', price: 0, per: 'unit' }, { label: 'Custom design', price: 100, per: 'unit' }] }); renderOptions(opt); };
    const sf = $('#stockField'); if (sf) sf.style.display = hasSizes ? 'none' : '';
    const ph = $('#priceHint'); if (ph) ph.textContent = $('#pf') && $('#pf').elements.price.readOnly ? 'Worked out from the brand’s price + your margin' : hasSizes ? 'The main price — sizes can follow it (e.g. 250 g = ¼)' : opt.tiers.length ? 'Optional — the lowest quantity price is used' : 'Price for one piece';
  }

  function renderPhotos(p) {
    const box = $('#photos');
    if (!box) return;
    box.innerHTML = p.images.map((im, i) =>
      '<div class="photo">' + (i === 0 ? '<span class="cover">Cover</span>' : '') + '<img src="' + esc(thumb(im.path, 300)) + '" alt="" loading="lazy">' +
      '<div class="tools"><button data-mv="-1" data-i="' + i + '" ' + (i === 0 ? 'disabled' : '') + ' aria-label="Move left">←</button>' +
      '<button data-del="' + im.id + '" aria-label="Remove photo">🗑</button>' +
      '<button data-mv="1" data-i="' + i + '" ' + (i === p.images.length - 1 ? 'disabled' : '') + ' aria-label="Move right">→</button></div></div>').join('') +
      '<label class="drop" id="drop"><input type="file" id="file" accept="image/jpeg,image/png,image/webp" multiple hidden><span>＋ Add photos<br><span class="small">or drop them here</span></span></label>';
    const upload = async (files) => {
      for (const f of files) {
        const fd = new FormData(); fd.append('product_id', p.id); fd.append('file', f);
        try { const r = await api('image_upload', { method: 'POST', form: fd }); p.images.push({ id: r.id, path: r.path }); renderPhotos(p); }
        catch (err) { toast(f.name + ': ' + err.message, true); }
      }
      toast('Photos saved'); refreshProductsQuiet();
    };
    $('#file').onchange = (e) => upload(Array.from(e.target.files));
    const drop = $('#drop');
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); upload(Array.from(e.dataTransfer.files).filter((f) => /^image\//.test(f.type))); };
    $$('[data-del]', box).forEach((b) => b.onclick = async () => {
      if (!confirm('Remove this photo?')) return;
      try { await api('image_delete', { method: 'POST', body: { id: +b.dataset.del } }); p.images = p.images.filter((im) => im.id !== +b.dataset.del); renderPhotos(p); refreshProductsQuiet(); }
      catch (err) { toast(err.message, true); }
    });
    $$('[data-mv]', box).forEach((b) => b.onclick = async () => {
      const i = +b.dataset.i, j = i + +b.dataset.mv;
      [p.images[i], p.images[j]] = [p.images[j], p.images[i]];
      renderPhotos(p);
      try { await api('image_order', { method: 'POST', body: { ids: p.images.map((im) => im.id) } }); refreshProductsQuiet(); }
      catch (err) { toast(err.message, true); }
    });
  }
  function refreshProductsQuiet() {
    // Update the table behind the drawer without closing it.
    const drawer = document.getElementById('drawer');
    if (drawer) drawer.remove();
    pageProducts().then(() => { if (drawer) document.body.appendChild(drawer); });
  }

  function categoriesDrawer() {
    const rows = S.cats.map((c) => '<tr><td><input type="text" data-k="' + esc(c.key) + '" data-f="label" value="' + esc(c.label) + '"><input type="text" dir="rtl" data-k="' + esc(c.key) + '" data-f="label_ar" value="' + esc(c.label_ar || '') + '" placeholder="الاسم بالعربي" style="margin-top:6px"></td>' +
      '<td><input type="text" data-k="' + esc(c.key) + '" data-f="descr" value="' + esc(c.descr) + '"><input type="text" dir="rtl" data-k="' + esc(c.key) + '" data-f="descr_ar" value="' + esc(c.descr_ar || '') + '" placeholder="الوصف بالعربي" style="margin-top:6px"></td>' +
      '<td style="width:80px"><input type="number" data-k="' + esc(c.key) + '" data-f="sort" value="' + esc(c.sort) + '"></td>' +
      '<td class="num">' + c.count + '</td><td><button class="btn sm" data-save="' + esc(c.key) + '">Save</button> ' +
      (c.key !== 'services' ? '<button class="btn sm danger" data-rm="' + esc(c.key) + '">Delete</button>' : '') + '</td></tr>').join('');
    openDrawer('Categories',
      '<p class="muted" style="margin-top:0">Categories with at least one Active product appear in the shop. Order sets their position.</p>' +
      '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Description</th><th>Order</th><th class="num">Products</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<form id="cf" class="card stack" style="margin-top:18px"><b>New category</b><div class="grid2"><input type="text" name="label" placeholder="Name" required><input type="text" name="descr" placeholder="Short description"><input type="text" name="label_ar" dir="rtl" placeholder="الاسم بالعربي"><input type="text" name="descr_ar" dir="rtl" placeholder="الوصف بالعربي"></div>' +
      '<div><button class="btn primary" type="submit">Add category</button></div></form>');
    const get = (k, f) => ($('[data-k="' + k + '"][data-f="' + f + '"]') || {}).value;
    $$('[data-save]').forEach((b) => b.onclick = async () => {
      const k = b.dataset.save;
      try { await api('category_save', { method: 'POST', body: { key: k, label: get(k, 'label'), descr: get(k, 'descr'), label_ar: get(k, 'label_ar'), descr_ar: get(k, 'descr_ar'), sort: get(k, 'sort') } }); toast('Category saved'); await pageProducts(); categoriesDrawer(); }
      catch (err) { toast(err.message, true); }
    });
    $$('[data-rm]').forEach((b) => b.onclick = async () => {
      if (!confirm('Delete this category?')) return;
      try { await api('category_delete', { method: 'POST', body: { key: b.dataset.rm } }); toast('Category deleted'); await pageProducts(); categoriesDrawer(); }
      catch (err) { toast(err.message, true); }
    });
    $('#cf').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('category_save', { method: 'POST', body: formData(e.target) }); toast('Category added'); await pageProducts(); categoriesDrawer(); }
      catch (err) { toast(err.message, true); }
    };
  }

  // ---------- leads ----------
  async function loadTeam() { S.team = (await api('team')).team; }

  // ---------- lead helpers ----------
  const cairoToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const addDays = (n) => { const d = new Date(cairoToday() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const fmtDay = (s) => new Date(s + 'T12:00:00Z').toLocaleDateString(LOC, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const fmtSize = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const phoneOf = (c) => { const m = String(c || '').match(/\+?\d[\d\s-]{7,}\d/); return m ? m[0].replace(/\D/g, '') : ''; };
  const emailOf = (c) => (String(c || '').match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [''])[0];
  const waNumber = (d) => d.startsWith('20') ? d : d.startsWith('0') ? '20' + d.slice(1) : (d.length === 10 && d[0] === '1' ? '20' + d : d);
  const localPhone = (d) => { const w = waNumber(d); return w.startsWith('20') ? '0' + w.slice(2) : d; };
  const CAT_NAMES = { nfc: 'NFC review cards & stands', cosmetics: 'skincare & cosmetics', stands: 'exhibition stands', services: 'marketing services' };
  // What they want: the full "Needs:" line from the chat, unless the team has since edited the interest.
  const leadInterest = (l) => { const m = String(l.notes || '').match(/Needs: (.+)/); return m && (!l.cat || m[1].startsWith(l.cat)) ? m[1] : (CAT_NAMES[l.cat] || l.cat || (m ? m[1] : '')); };
  const isDue = (l) => !!l.follow_up && l.follow_up <= cairoToday() && l.status !== 'Won' && l.status !== 'Lost';
  // WhatsApp link with a ready-made greeting that mentions what they asked for.
  function leadWa(l) {
    const p = phoneOf(l.contact);
    if (!p) return '';
    // Abandoned checkout (api/abandoned.php): a reminder in the customer's language, with their cart and the link that puts it back.
    const resume = String(l.notes || '').match(/https?:\/\/\S+\?restore=[a-f0-9]+/);
    if (resume && l.status !== 'Won' && String(l.notes).indexOf('Left checkout without ordering') !== -1) {
      const ar = /Language: Arabic/.test(l.notes), cart0 = (String(l.notes).match(/Cart: (.+)/) || [])[1] || '', cart = ar ? cart0.replace(/ cm\b/g, ' سم') : cart0;
      const who = String(l.name || '').split(/\s+/)[0], me = S.user.name.split(' ')[0];
      const msg = ar ? 'أهلًا ' + who + ' 👋 معاك ' + me + ' من Where To Spot. لاحظت إنك كنت بتطلب ' + (cart || 'من متجرنا') + ' ومكملتش الطلب. لو عندك أي سؤال عن المنتج أو الدفع أو التوصيل أنا موجود أساعدك 🙏\nتقدر تكمل طلبك من هنا: ' + resume[0]
        : 'Hi ' + who + ' 👋 this is ' + me + ' from Where To Spot. I saw you were ordering ' + (cart || 'from our shop') + ' but didn’t finish. If you have any question about the product, payment or delivery, I’m happy to help 🙏\nYou can complete your order here: ' + resume[0];
      return 'https://wa.me/' + waNumber(p) + '?text=' + encodeURIComponent(msg);
    }
    const first = String(l.name || '').split(/\s+/)[0];
    const interest = leadInterest(l);
    const msg = AR ? 'أهلًا ' + first + '، معك ' + S.user.name.split(' ')[0] + ' من Where To Spot. شكرًا لاهتمامك' + (interest ? ' بـ ' + WTS_T(interest) : '') +
      '. يسعدني أساعدك، ممكن تقولي تفاصيل أكتر عن اللي محتاجه؟'
      : 'Hello ' + first + ', this is ' + S.user.name.split(' ')[0] + ' from Where To Spot. Thank you for your interest' +
      (interest ? ' in ' + interest : '') + '. I’d be happy to help. Could you tell me a bit more about what you need?';
    return 'https://wa.me/' + waNumber(p) + '?text=' + encodeURIComponent(msg);
  }
  function followChip(l) {
    if (!l.follow_up || l.status === 'Won' || l.status === 'Lost') return '<span class="muted">—</span>';
    const t = cairoToday();
    if (l.follow_up < t) return '<span class="pill bad">! Overdue · ' + esc(fmtDay(l.follow_up)) + '</span>';
    if (l.follow_up === t) return '<span class="pill warn">◷ Today</span>';
    return '<span class="small">' + esc(fmtDay(l.follow_up)) + '</span>';
  }
  const waBtn = (l, label) => leadWa(l) ? '<a class="btn sm wa" href="' + esc(leadWa(l)) + '" target="_blank" rel="noopener" title="WhatsApp ' + esc(l.name) + '">' + icon('chat') + (label ? 'WhatsApp' : '') + '</a>' : '';

  // ---------- quotes ----------
  async function pageQuotes() {
    const d = await api('quotes');
    S.quotes = d.quotes;
    const st = S.quoteStatus || '';
    const list = d.quotes.filter((q) => !st || q.status === st);
    // Quote totals by outcome (only here — quotes aren't sales, so they stay out of the dashboard).
    const sum = (arr) => arr.reduce((a, q) => a + q.total, 0);
    const byStatus = (...ss) => d.quotes.filter((q) => ss.includes(q.status));
    const open = byStatus('Draft', 'Sent'), won = byStatus('Accepted'), lost = byStatus('Declined', 'Expired');
    const answered = won.length + lost.length;
    const kpi = (label, count, amount, note, tone) => '<div class="kpi"><div class="label">' + label + '</div><div class="value">' + count + '</div>' +
      '<div class="note"><b class="' + (tone || '') + '">' + egp(amount) + '</b>' + (note ? ' · <span>' + note + '</span>' : '') + '</div></div>';
    $('#main').innerHTML = header('Quotes', 'Prices you offer before an order. Nothing is taken from stock or counted as a sale until the customer accepts.', '<button class="btn primary" id="newQuote">+ New quote</button>') +
      '<div class="kpis">' + kpi('Quotes issued', d.quotes.length, sum(d.quotes), 'all quotes') +
        kpi('Open', open.length, sum(open), 'waiting for an answer') +
        kpi('Closed (accepted)', won.length, sum(won), answered ? Math.round(won.length / answered * 100) + '% win rate' : 'no answers yet', 'pay-ok') +
        kpi('Lost', lost.length, sum(lost), 'declined or expired') + '</div>' +
      '<div class="row" style="margin-bottom:16px"><div class="seg" id="qtabs">' + ['', 'Draft', 'Sent', 'Accepted', 'Declined', 'Expired'].map((t) => {
        const n = t ? byStatus(t).length : d.quotes.length;
        return '<button data-s="' + t + '" class="' + (t === st ? 'on' : '') + '"><span>' + (t || 'All') + '</span> <span class="seg-n">' + n + '</span></button>'; }).join('') + '</div></div>' +
      (list.length ? '<div class="table-wrap"><table><thead><tr><th>Quote</th><th>Customer</th><th>Items</th><th>Status</th><th>Valid until</th><th class="num">Total</th></tr></thead><tbody>' +
        list.map((q) => '<tr class="click" data-q="' + q.id + '"><td><b>' + esc(q.number) + '</b><div class="small muted">' + dateTime(q.createdAt) + (q.rep ? ' · ' + esc(q.rep) : '') + '</div></td>' +
          '<td>' + esc(q.customer) + '<div class="small muted">' + esc([q.businessName, q.phone].filter(Boolean).join(' · ')) + '</div></td>' +
          '<td class="small">' + q.items.map((it) => esc(it.qty + '× ' + it.name)).join('<br>') + '</td>' +
          '<td>' + pill(QUOTE_TONE, q.status) + (q.orderNumber ? '<div class="small muted">→ ' + esc(q.orderNumber) + '</div>' : '') + '</td>' +
          '<td class="small' + (q.status === 'Expired' ? ' pay-part' : '') + '">' + (q.validUntil ? esc(fmtDay(q.validUntil)) : '—') + '</td><td class="num"><b>' + egp(q.total) + '</b></td></tr>').join('') +
        '</tbody></table></div>' : '<div class="card empty">' + (st ? 'No ' + st.toLowerCase() + ' quotes.' : 'No quotes yet. Create one here, or from a lead with “Create quote”.') + '</div>');
    $$('#qtabs button').forEach((b) => b.onclick = () => { S.quoteStatus = b.dataset.s; pageQuotes(); });
    $('#newQuote').onclick = () => newOrderDrawer({ mode: 'quote' });
    $$('tr[data-q]').forEach((tr) => tr.onclick = () => quoteDrawer(d.quotes.find((q) => q.id === +tr.dataset.q)));
    if (S.openQuote) { const q = d.quotes.find((x) => x.id === S.openQuote); S.openQuote = null; if (q) quoteDrawer(q); }
  }

  // Quote -> prefill for the editor or for the order it turns into.
  const quotePrefill = (q, mode) => ({
    mode, quoteId: q.id, quoteNumber: q.number, leadId: q.leadId, name: q.customer, phone: q.phone, email: q.email,
    business_name: q.businessName, review_link: q.reviewLink, links: q.links, design_notes: q.designNotes, address: q.address,
    cityId: q.cityId, districtId: q.districtId, city: q.city, district: q.district, items: q.itemsIn, discount: q.discount,
    shipping: q.shipping, notes: mode === 'quote' ? q.notes : 'From quote ' + q.number + (q.notes ? ' · ' + q.notes : ''),
    terms: q.terms, valid_until: q.validUntil,
  });

  function quoteDrawer(q) {
    const open = q.savedStatus !== 'Accepted' && q.status !== 'Declined';
    const phone = phoneOf(q.phone);
    const waText = AR ? 'أهلًا ' + q.customer.split(/\s+/)[0] + '، ده عرض السعر ' + q.number + ' من Where To Spot:\n' +
      q.items.map((it) => '• ' + it.qty + '× ' + it.name + ': ' + egp(it.total)).join('\n') +
      (q.discount ? '\nالخصم: −' + egp(q.discount) : '') + '\nالتوصيل: ' + (q.shipping ? egp(q.shipping) : 'مجاني') + '\nالإجمالي: ' + egp(q.total) +
      (q.validUntil ? '\nصالح حتى ' + fmtDay(q.validUntil) + '.' : '') + '\n\nملف الـ PDF مرفق. رد علينا بالتأكيد ونبدأ على طول.'
      : 'Hello ' + q.customer.split(/\s+/)[0] + ', here is your quote ' + q.number + ' from Where To Spot:\n' +
      q.items.map((it) => '• ' + it.qty + '× ' + it.name + ': ' + egp(it.total)).join('\n') +
      (q.discount ? '\nDiscount: −' + egp(q.discount) : '') + '\nDelivery: ' + (q.shipping ? egp(q.shipping) : 'Free') + '\nTotal: ' + egp(q.total) +
      (q.validUntil ? '\nValid until ' + fmtDay(q.validUntil) + '.' : '') + '\n\nThe PDF is attached. Just reply to confirm and we’ll start.';
    const wa = phone ? 'https://wa.me/' + waNumber(phone) + '?text=' + encodeURIComponent(waText) : '';
    const body = '<div class="stack">' +
      '<div class="card stack" style="gap:12px"><div class="row" style="align-items:flex-start"><div style="flex:1"><b style="font-size:16px">' + esc(q.customer) + '</b>' + (q.businessName ? '<div>' + esc(q.businessName) + '</div>' : '') +
        '<div class="small muted">' + esc([q.phone, q.email, [q.district, q.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ')) + '</div></div>' + pill(QUOTE_TONE, q.status) + '</div>' +
        '<div class="small muted">Created ' + dateTime(q.createdAt) + (q.rep ? ' by ' + esc(q.rep) : '') + (q.sentAt ? ' · sent ' + dateTime(q.sentAt) : '') + (q.validUntil ? ' · valid until ' + esc(fmtDay(q.validUntil)) : '') + '</div>' +
        (q.orderNumber ? '<div class="chosen">' + icon('bag') + '<span>Accepted — became order <b>' + esc(q.orderNumber) + '</b></span><span class="spacer"></span><button class="btn sm" id="qOrder">Open order</button></div>' : '') + '</div>' +
      '<div class="card"><div class="list">' + q.items.map((it) => '<div class="li"><span>' + esc(it.qty + '× ' + it.name) + (it.note ? '<div class="small" style="white-space:pre-line">' + esc(it.note) + '</div>' : '') + '<div class="small muted">' + egp(it.total / it.qty) + ' each</div></span><span>' + egp(it.total) + '</span></div>').join('') +
        '<div class="li muted"><span>Subtotal</span><span>' + egp(q.subtotal) + '</span></div>' +
        (q.discount ? '<div class="li muted"><span>Discount</span><span>−' + egp(q.discount) + '</span></div>' : '') +
        '<div class="li muted"><span>Delivery</span><span>' + (q.shipping ? egp(q.shipping) : 'Free') + '</span></div>' +
        '<div class="li"><b>Total</b><b>' + egp(q.total) + '</b></div></div></div>' +
      (q.notes ? '<div class="card"><b class="small">Internal notes</b><div class="small" style="white-space:pre-line;margin-top:6px">' + esc(q.notes) + '</div></div>' : '') +
      (open ? '<div class="card stack" style="gap:10px"><b>Next step</b><div class="row">' +
        '<a class="btn" href="doc.html?quote=' + q.id + '" target="_blank" rel="noopener">' + icon('file') + 'Open PDF</a>' +
        (wa ? '<a class="btn wa" href="' + esc(wa) + '" target="_blank" rel="noopener" id="qWa">' + icon('chat') + 'Send on WhatsApp</a>' : '') +
        (q.savedStatus === 'Draft' ? '<button class="btn" data-qs="Sent">➜ Mark as sent</button>' : '') + '</div>' +
        '<div class="row"><button class="btn dark" id="qConvert">' + icon('cart') + 'Customer accepted — create order</button><button class="btn" data-qs="Declined">✕ Declined</button></div>' +
        '<div class="hint">Send the PDF with WhatsApp: open the PDF, save it, then attach it in the chat that opens. Sending marks the quote as Sent.</div></div>'
        : '<div class="row"><a class="btn" href="doc.html?quote=' + q.id + '" target="_blank" rel="noopener">' + icon('file') + 'Open PDF</a>' + (q.status === 'Declined' ? '<button class="btn" data-qs="Draft">Reopen as draft</button>' : '') + '</div>') +
      '</div>';
    openDrawer('Quote ' + q.number, body, (q.savedStatus !== 'Accepted' ? '<button class="btn danger" id="qDel">Delete</button>' : '') + '<span class="spacer"></span>' +
      (q.savedStatus !== 'Accepted' ? '<button class="btn" id="qCopy">Duplicate</button><button class="btn primary" id="qEdit">Edit</button>' : '<button class="btn" id="qCopy">Duplicate</button>'));
    const setStatus = async (status) => {
      try { const r = await api('quote_status', { method: 'POST', body: { id: q.id, status } }); toast('Quote ' + status.toLowerCase()); if (S.route === 'quotes') await pageQuotes(); quoteDrawer(r.quote); }
      catch (err) { toast(err.message, true); }
    };
    $$('[data-qs]').forEach((b) => b.onclick = () => setStatus(b.dataset.qs));
    const w = $('#qWa'); if (w) w.addEventListener('click', () => { if (q.savedStatus === 'Draft') setTimeout(() => setStatus('Sent'), 300); });
    const cv = $('#qConvert'); if (cv) cv.onclick = () => { closeDrawer(); newOrderDrawer(quotePrefill(q, 'order')); };
    const ed = $('#qEdit'); if (ed) ed.onclick = () => { closeDrawer(); newOrderDrawer(quotePrefill(q, 'quote')); };
    $('#qCopy').onclick = () => { closeDrawer(); const p = quotePrefill(q, 'quote'); delete p.quoteId; delete p.quoteNumber; p.valid_until = addDays(14); newOrderDrawer(p); };
    const del = $('#qDel'); if (del) del.onclick = async () => {
      if (!confirm('Delete quote ' + q.number + '?')) return;
      try { await api('quote_delete', { method: 'POST', body: { id: q.id } }); closeDrawer(); toast('Quote deleted'); pageQuotes(); }
      catch (err) { toast(err.message, true); }
    };
    const oo = $('#qOrder'); if (oo) oo.onclick = async () => { const d = await api('orders', { query: '&q=' + encodeURIComponent(q.orderNumber) }); const o = d.orders.find((x) => x.id === q.orderId); if (o) orderDrawer(o); };
  }


  // ---------- WhatsApp inbox ----------
  // One business number; every chat lands here. Team members see their own chats (and unassigned ones),
  // managers see everything and hand chats out. Updates come by polling (every few seconds while open).
  const waTime = (s) => { if (!s) return ''; const d = new Date(s.replace(' ', 'T') + 'Z'); const now = new Date();
    return d.toDateString() === now.toDateString() ? d.toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(LOC, { day: 'numeric', month: 'short' }); };
  const waMins = (s) => s ? Math.max(0, Math.round((Date.now() - new Date(s.replace(' ', 'T') + 'Z').getTime()) / 60000)) : 0;
  const waAgo = (m) => m < 60 ? m + (AR ? ' دقيقة' : ' min') : m < 1440 ? Math.floor(m / 60) + (AR ? ' ساعة' : ' h') : Math.floor(m / 1440) + (AR ? ' يوم' : ' d');
  // Minutes until the 24-hour free-reply window closes (null = closed or unknown).
  const waLeft = (c) => c.windowOpen && c.windowEnds ? Math.max(0, Math.round((new Date(c.windowEnds.replace(' ', 'T') + 'Z') - Date.now()) / 60000)) : null;
  const waSize = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const waLink = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/(^|[\s>])\*([^*\n<]+)\*(?=$|[\s<.,!?])/g, '$1<b>$2</b>').replace(/\n/g, '<br>');
  const WA_TICK = { sending: '🕓', sent: '✓', delivered: '✓✓', read: '✓✓', failed: '⚠' };
  // Which app a chat is on: a small logo on every chat (WhatsApp, Instagram Direct, Messenger).
  const SM_NAME = { wa: 'WhatsApp', ig: 'Instagram', fb: 'Messenger' };
  const SM_LOGO = {
    wa: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#25D366"/><path d="M12 5.2a6.8 6.8 0 0 0-5.9 10.2l-.9 3.4 3.5-.9A6.8 6.8 0 1 0 12 5.2z" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.6 8.9c.2-.4.5-.4.7-.1l.5 1.1c.1.2 0 .4-.1.6l-.3.3c.4.8 1 1.4 1.8 1.8l.3-.3c.2-.2.4-.2.6-.1l1.1.5c.3.2.3.5-.1.7-.7.4-1.6.3-2.6-.3-1-.6-1.8-1.4-2.4-2.4-.6-1-.6-1.9-.3-2.6z" fill="#fff"/></svg>',
    ig: '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="smIg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FEDA75"/><stop offset=".3" stop-color="#FA7E1E"/><stop offset=".6" stop-color="#D62976"/><stop offset="1" stop-color="#4F5BD5"/></linearGradient></defs><rect width="24" height="24" rx="7" fill="url(#smIg)"/><rect x="5.5" y="5.5" width="13" height="13" rx="4" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="12" cy="12" r="3.1" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="16" cy="8" r="1" fill="#fff"/></svg>',
    fb: '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="smFb" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#0099FF"/><stop offset=".6" stop-color="#A033FF"/><stop offset="1" stop-color="#FF5C87"/></linearGradient></defs><circle cx="12" cy="12" r="12" fill="url(#smFb)"/><path d="M12 5.3c-3.8 0-6.7 2.8-6.7 6.5 0 2 .8 3.7 2.2 4.9v2.1l2-1.1c.8.2 1.6.3 2.5.3 3.8 0 6.7-2.8 6.7-6.2S15.8 5.3 12 5.3z" fill="#fff"/><path d="M7.9 13.8l2.5-2.7 1.6 1.4 2.4-2.6-2.5 2.7-1.6-1.4z" fill="none" stroke="url(#smFb)" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  };
  const smLogo = (ch, cls) => SM_LOGO[ch] ? '<span class="sm-logo' + (cls ? ' ' + cls : '') + '" title="' + SM_NAME[ch] + '">' + SM_LOGO[ch] + '</span>' : '';

  // Unread badge + a sound (and a notification, if allowed) when a new customer message arrives — on every page.
  function waWatch() {
    if (!can('whatsapp') || waWatch.on) return;
    waWatch.on = true;
    const tick = async () => {
      if (!S.user || !can('whatsapp')) { waWatch.on = false; return; }
      try {
        // vis: the dashboard is on screen, so the server skips the Telegram ping (it beeps here instead).
        const d = await api('wa_unread', { query: document.visibilityState === 'visible' ? '&vis=1' : '' });
        S.waUnread = d.unread;
        const b = $('#waBadge'); if (b) { b.textContent = d.unread || ''; b.hidden = !d.unread; }
        document.title = (d.unread ? '(' + d.unread + ') ' : '') + document.title.replace(/^\(\d+\) /, '');
        if (waWatch.last != null && d.lastIn > waWatch.last) {
          waBeep();
          if (S.route !== 'inbox' && window.Notification && Notification.permission === 'granted') new Notification('New message', { body: 'Open Chats in the dashboard', icon: '../images/logo.png?v=3' });
          if (S.route === 'inbox' && waInbox.refresh) waInbox.refresh();
        }
        waWatch.last = d.lastIn;
      } catch (e) { /* offline for a moment */ }
      setTimeout(tick, S.route === 'inbox' ? 6000 : 20000);
    };
    tick();
  }
  // Telegram alerts for the signed-in person: connect, send a test, or turn off (api/telegram.php).
  async function tgDrawer(done) {
    let d;
    try { d = await api('tg_status'); } catch (e) { return toast(e.message, true); }
    const body = !d.ready
      ? '<p>Telegram alerts aren’t set up yet. The owner adds the bot token to api/config.local.php on the server (see config.local.example.php).</p>'
      : d.linked
        ? '<p><span class="pill good">✓ Connected</span>' + (d.name ? ' <b>' + esc(d.name) + '</b>' : '') + '</p><p class="muted">You get every new WhatsApp message on Telegram straight away (not while the dashboard is open on your screen), and a reminder when a customer has had no reply for 15 minutes.</p>'
        : '<p>Get a Telegram message on your phone when a WhatsApp customer is waiting for you, even when the dashboard is closed.</p>' +
          '<ol class="small"><li>Tap <b>Connect Telegram</b>. Telegram opens.</li><li>Press <b>Start</b> in the bot.</li><li>Come back here: it says Connected.</li></ol>';
    const foot = !d.ready ? '' : d.linked
      ? '<button class="btn" id="tgOff">Turn off</button><span class="spacer"></span><button class="btn primary" id="tgTest">Send a test</button>'
      : '<span class="spacer"></span><button class="btn primary" id="tgGo">Connect Telegram</button>';
    const w = openDrawer('Telegram alerts', body, foot);
    const go = $('#tgGo', w);
    if (go) go.onclick = async () => {
      // Open the window first (in the tap), then point it at the bot: phones block windows opened later.
      const win = window.open('about:blank', '_blank');
      try {
        const r = await api('tg_link', { method: 'POST' });
        if (win) win.location.href = r.url; else location.href = r.url;
        go.disabled = true; go.textContent = 'Waiting for Start…';
        const until = Date.now() + 5 * 60000;
        const check = async () => {
          if (!document.getElementById('drawer')) return;
          const s = await api('tg_status').catch(() => ({}));
          if (s.linked) { toast('Telegram connected'); closeDrawer(); if (done) done(); return; }
          if (Date.now() < until) setTimeout(check, 3000); else { go.disabled = false; go.textContent = 'Connect Telegram'; }
        };
        setTimeout(check, 3000);
      } catch (e) { if (win) win.close(); toast(e.message, true); }
    };
    const t = $('#tgTest', w); if (t) t.onclick = async () => { try { await api('tg_test', { method: 'POST' }); toast('Test sent — check Telegram'); } catch (e) { toast(e.message, true); } };
    const off = $('#tgOff', w); if (off) off.onclick = async () => { try { await api('tg_unlink', { method: 'POST' }); toast('Telegram alerts are off'); closeDrawer(); if (done) done(); } catch (e) { toast(e.message, true); } };
  }

  function waBeep() {
    try {
      const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain();
      o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.0001, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, a.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.35);
      o.start(); o.stop(a.currentTime + 0.4);
    } catch (e) {}
  }

  // WhatsApp doesn't share customers' profile photos, so each customer gets their own colour (always the
  // same, from their number) and initials, with a small badge: 📣 came from an ad, ⭐ has bought before,
  // 🆕 first message in the last 24 hours.
  const WA_AV = [['#DCEFE3', '#1F7A4D'], ['#E3ECFB', '#2C5DA8'], ['#FCE8DC', '#A8512A'], ['#F3E3F7', '#7D3C93'], ['#FFF1C9', '#8A6400'], ['#DDF2F3', '#1E7178'], ['#FBE3E8', '#A33650'], ['#E8E6F9', '#4B44A0']];
  const waAvatar = (c) => {
    // From the last digits of the number (spread evenly across customers), else from the name.
    const digits = String(c.waId || c.phone || '').replace(/\D/g, '');
    let h = digits.length >= 4 ? parseInt(digits.slice(-6), 10) : 0;
    if (!digits) for (const ch of String(c.name || '')) h = (h * 31 + ch.charCodeAt(0)) % 1000003;
    const [bg, fg] = WA_AV[h % WA_AV.length];
    const words = String(c.name || '').trim().split(/\s+/).filter((w) => w && !/^[+\d]/.test(w));
    // Two letters for Latin names (AT); one for Arabic, where two letters would join into a word.
    const ini = !words.length ? '' : /[\u0600-\u06FF]/.test(words[0][0]) ? words[0][0] : (words[0][0] + (words.length > 1 ? words[1][0] : '')).toUpperCase();
    const isNew = c.createdAt && Date.now() - new Date(c.createdAt.replace(' ', 'T') + 'Z') < 86400000;
    const badge = c.returning ? ['⭐', 'Has bought before'] : c.ad ? ['📣', 'Came from an ad'] : isNew ? ['🆕', 'New customer (first message in the last 24 hours)'] : null;
    return '<span class="wa-av" style="background:' + bg + ';color:' + fg + '">' + (ini ? esc(ini) : icon('person')) +
      (badge ? '<span class="wa-badge" title="' + badge[1] + '">' + badge[0] + '</span>' : '') + smLogo(c.channel, 'wa-chn') + '</span>';
  };
  // Quick replies: {name} becomes the customer's first name. Without a usable name (only a number or a
  // single letter), it's left out together with the "يا" before it: "أهلًا يا {name} 👋" → "أهلًا 👋".
  const waFillName = (text, name) => {
    const first = String(name || '').trim().split(/\s+/)[0] || '';
    const ok = first.length > 1 && !/\d/.test(first);
    return text.replace(/(\s*(?:يا|ya|Ya)\s+|\s+)?\{(?:name|الاسم)\}/g, (m, ya) => ok ? (ya || '') + first : '').replace(/ {2,}/g, ' ');
  };
  // Products for "Send a product", per language (loaded once, then refreshed in the background).
  const waProds = {};
  const waProductList = async (lang, fresh) => {
    if (!fresh && waProds[lang]) return waProds[lang];
    if (!waProductList.busy) waProductList.busy = {};
    if (!waProductList.busy[lang]) waProductList.busy[lang] = api('wa_products', { query: '&lang=' + lang }).then((r) => { waProds[lang] = r.products; return r.products; }).finally(() => { waProductList.busy[lang] = null; });
    return waProductList.busy[lang];
  };
  const waPhone = () => matchMedia('(max-width:820px)').matches;
  const waCopy = (text) => {
    const ok = () => toast('Message copied');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, () => {});
    else { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); ok(); } catch (e) {} t.remove(); }
  };
  // The voice-note format this browser records that WhatsApp accepts: Ogg/Opus (Firefox), WebM/Opus rewrapped
  // as Ogg below (Chrome, Android, Edge), or M4A (iPhone Safari).
  const waVoiceType = () => ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2'].find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  // WebM (what Chrome records) → Ogg, the same Opus sound in the box WhatsApp plays as a voice note. Nothing is re-encoded.
  function waWebmToOgg(b) {
    let p = 0, head = null, channels = 1;
    const packets = [];
    const vint = (isId) => {
      const f = b[p]; let len = 1, m = 0x80;
      while (len <= 8 && !(f & m)) { len++; m >>= 1; }
      if (len > 8) throw new Error('Not a WebM file');
      let v = isId ? f : f & (m - 1), ones = (f & (m - 1)) === m - 1;
      for (let i = 1; i < len; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 0xff) ones = false; }
      p += len;
      return isId ? v : ones ? -1 : v;
    };
    // Segment, Tracks, TrackEntry, Audio, Cluster, BlockGroup: look inside; everything else is skipped by its size.
    const INSIDE = [0x18538067, 0x1654ae6b, 0xae, 0xe1, 0x1f43b675, 0xa0];
    while (p < b.length) {
      const id = vint(true), size = vint(false);
      if (INSIDE.includes(id)) continue;
      const end = size < 0 ? b.length : Math.min(b.length, p + size);
      if (id === 0x63a2) head = b.slice(p, end); // CodecPrivate = OpusHead
      else if (id === 0x9f) channels = b[p] || 1;
      else if (id === 0xa3 || id === 0xa1) { // SimpleBlock / Block: track number, 2-byte time, flags, then the Opus packet
        let l = 1, m = 0x80; while (l <= 8 && !(b[p] & m)) { l++; m >>= 1; }
        if (b[p + l + 2] & 0x06) throw new Error('Laced WebM not supported');
        packets.push(b.slice(p + l + 3, end));
      }
      p = end;
    }
    if (!packets.length) throw new Error('No sound recorded');
    if (!head) { head = new Uint8Array(19); head.set([79, 112, 117, 115, 72, 101, 97, 100, 1, channels, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0]); }
    const tags = new Uint8Array([79, 112, 117, 115, 84, 97, 103, 115, 3, 0, 0, 0, 87, 84, 83, 0, 0, 0, 0]); // "OpusTags", vendor "WTS", no comments
    const crcT = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { let r = i << 24; for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; crcT[i] = r >>> 0; }
    const serial = (Math.random() * 0xffffffff) >>> 0, pages = [];
    let seq = 0;
    const page = (pkts, granule, flags) => {
      const segs = [];
      pkts.forEach((k) => { let n = k.length; while (n >= 255) { segs.push(255); n -= 255; } segs.push(n); });
      const len = 27 + segs.length + pkts.reduce((a, k) => a + k.length, 0), o = new Uint8Array(len), dv = new DataView(o.buffer);
      o.set([79, 103, 103, 83], 0); o[5] = flags;
      dv.setUint32(6, granule % 4294967296, true); dv.setUint32(10, Math.floor(granule / 4294967296), true);
      dv.setUint32(14, serial, true); dv.setUint32(18, seq++, true);
      o[26] = segs.length; o.set(segs, 27);
      let off = 27 + segs.length; pkts.forEach((k) => { o.set(k, off); off += k.length; });
      let crc = 0; for (let i = 0; i < len; i++) crc = ((crc << 8) ^ crcT[((crc >>> 24) ^ o[i]) & 255]) >>> 0;
      dv.setUint32(22, crc, true);
      pages.push(o);
    };
    // Samples (at 48 kHz) in an Opus packet, from its first byte.
    const samples = (k) => { const cfg = k[0] >> 3, ms = cfg < 12 ? [10, 20, 40, 60][cfg & 3] : cfg < 16 ? [10, 20][cfg & 1] : [2.5, 5, 10, 20][cfg & 3], c = k[0] & 3; return (c === 0 ? 1 : c < 3 ? 2 : (k[1] & 0x3f)) * ms * 48; };
    page([head], 0, 2); page([tags], 0, 0);
    let cur = [], nseg = 0, gran = 0;
    packets.forEach((k, i) => {
      const need = Math.floor(k.length / 255) + 1;
      if (nseg + need > 255) { page(cur, gran, 0); cur = []; nseg = 0; }
      cur.push(k); nseg += need; gran += samples(k);
      if (i === packets.length - 1) page(cur, gran, 4);
    });
    const out = new Uint8Array(pages.reduce((a, x) => a + x.length, 0));
    let off = 0; pages.forEach((x) => { out.set(x, off); off += x.length; });
    return out;
  }
  const waInbox = { view: null, q: '', chatId: null, data: null, chat: null, msgs: [], lastId: 0, timer: null };

  async function pageInbox() {
    const st = waInbox;
    if (!st.view) st.view = can('whatsapp_all') ? 'all' : 'mine';
    $('#main').innerHTML = '<div class="wa" id="wa"><section class="wa-list"><div class="wa-lh"><div class="row"><h1>Chats</h1><span class="spacer"></span><span id="waMe"></span></div>' +
      '<div class="seg wa-tabs" id="waTabs"></div><div class="wa-chs" id="waChs" hidden></div><input type="search" id="waQ" placeholder="Search name, number or @username" value="' + esc(st.q) + '"></div><div class="wa-items" id="waItems"><div class="muted small" style="padding:16px">Loading…</div></div></section>' +
      '<section class="wa-chat" id="waChat"><div class="wa-empty">' + icon('chat') + '<div>Choose a chat</div></div></section></div>';
    let qt;
    $('#waQ').oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { st.q = e.target.value; loadList(); }, 300); };
    const loadList = async () => {
      const d = await api('wa_chats', { query: '&view=' + st.view + '&q=' + encodeURIComponent(st.q) + '&ch=' + (st.ch || '') });
      if (S.route !== 'inbox') return;
      st.data = d;
      renderTabs(); renderList();
      if (!st.timer) poll();
    };
    st.refresh = () => { loadList(); if (st.chatId) loadChat(true); };
    const renderTabs = () => {
      const c = st.data.counts, me = st.data.me;
      // Bot: chats the chat bot is answering (Settings → Chat bot), until it hands them to the team.
      const tabs = [['mine', 'Mine', c.mine.unread || ''], ['unassigned', 'Unassigned', c.unassigned || '']].concat(st.data.bot || c.bot ? [['bot', '🤖 Bot', c.bot || '']] : []).concat(me.all ? [['waiting', 'Waiting', c.waiting || ''], ['all', 'All', '']] : [['all', 'All', '']]).concat([['closed', 'Closed', '']]);
      $('#waTabs').innerHTML = tabs.map(([k, l, n]) => '<button data-v="' + k + '" class="' + (st.view === k ? 'on' : '') + '"><span>' + l + '</span>' + (n ? ' <span class="seg-n">' + n + '</span>' : '') + '</button>').join('');
      $$('#waTabs button').forEach((b) => b.onclick = () => { st.view = b.dataset.v; loadList(); });
      // WhatsApp / Instagram / Messenger: shown once more than one app is connected or has chats.
      const chs = st.data.channels || [], cb = $('#waChs');
      cb.hidden = chs.length < 2;
      cb.innerHTML = chs.length < 2 ? '' : '<button data-ch="" class="' + (!st.ch ? 'on' : '') + '"><span>All</span></button>' +
        chs.map((k) => '<button data-ch="' + k + '" class="' + (st.ch === k ? 'on' : '') + '">' + smLogo(k) + '<span>' + SM_NAME[k] + '</span></button>').join('');
      $$('#waChs button').forEach((b) => b.onclick = () => { st.ch = b.dataset.ch; loadList(); });
      $('#waMe').innerHTML = (!st.data.ready ? '<span class="pill warn" title="Settings → WhatsApp">Not connected</span> ' : '') +
        (me.agent ? '<label class="row small wa-away"><input type="checkbox" id="waAway"' + (me.away ? '' : ' checked') + '> <span>Taking chats</span></label>' : '') +
        (window.Notification && Notification.permission === 'default' ? ' <button class="btn sm" id="waNotif" title="Get a notification for new messages">🔔</button>' : '') +
        ' <button class="btn sm" id="waTg" title="Telegram alerts">' + (me.telegram ? '✈️ ✓' : '✈️ <span>Telegram</span>') + '</button>';
      const aw = $('#waAway'); if (aw) aw.onchange = async () => { await api('wa_away', { method: 'POST', body: { away: !aw.checked } }); toast(aw.checked ? 'You’ll get new chats' : 'No new chats will be given to you'); };
      const nb = $('#waNotif'); if (nb) nb.onclick = () => Notification.requestPermission().then(() => renderTabs());
      $('#waTg').onclick = () => tgDrawer(() => loadList());
    };
    const renderList = () => {
      const list = st.data.chats;
      $('#waItems').innerHTML = list.length ? list.map((c) => {
        // Waiting for a reply: grey at first, amber after 15 minutes, red after an hour.
        const wait = c.waitingSince ? Math.max(1, waMins(c.waitingSince)) : 0;
        const left = c.status === 'open' ? waLeft(c) : null;
        return '<button class="wa-item' + (c.id === st.chatId ? ' on' : '') + (c.unread ? ' unread' : '') + '" data-c="' + c.id + '">' +
          waAvatar(c) +
          '<span class="wa-it"><span class="wa-row"><b>' + esc(c.name) + '</b><small>' + waTime(c.lastAt) + '</small></span>' +
          '<span class="wa-row"><span class="wa-last">' + (c.lastDir === 'out' ? (c.bot === 'on' ? '<span class="muted">🤖 </span>' : '<span class="muted">You: </span>') : '') + esc(c.lastText || '') + '</span>' + (c.unread ? '<span class="wa-n">' + c.unread + '</span>' : '') + '</span>' +
          '<span class="wa-tags">' + (wait ? '<span class="wa-wait' + (wait >= 60 ? ' late' : wait >= 15 ? ' warn' : '') + '">⏱ <span>Waiting</span> ' + waAgo(wait) + '</span>' : '') +
            // The free-reply window: warn in the list before it closes, so nobody misses it.
            (left != null && left <= 360 ? '<span class="wa-win' + (left <= 120 ? ' late' : '') + '" title="Free replies end then">⌛ <span>Closes in</span> ' + waAgo(Math.max(1, left)) + '</span>'
              : wait && c.status === 'open' && !c.windowOpen ? '<span class="wa-win late">⌛ <span>Reply window closed</span></span>' : '') + (c.ad ? '<span class="wa-ad" title="' + esc(c.ad.headline) + '">Ad</span>' : '') + (c.bot === 'on' ? '<span class="wa-botc" title="The bot is answering this chat">🤖 <span>Bot</span></span>' : '') +
            (st.data.me.all ? '<span class="muted">' + esc(c.agent || 'Unassigned') + '</span>' : '') + (c.leadStatus ? pill(LEAD_TONE, c.leadStatus) : '') + '</span></span></button>';
      }).join('') : '<div class="muted small" style="padding:16px">' + (st.view === 'mine' ? 'No chats for you right now.' : 'No chats here.') + '</div>';
      $$('#waItems [data-c]').forEach((b) => b.onclick = () => openChat(+b.dataset.c));
    };
    // Phones show one panel at a time: opening a chat adds a step to the history, so the phone's back
    // gesture (or the ← button) returns to the chat list instead of leaving the dashboard.
    const closeChat = () => { const w = $('#wa'); if (w) w.classList.remove('open'); st.chatId = null; if (st.data) renderList(); };
    st.closeChat = closeChat;
    const openChat = async (id) => {
      if (waPhone() && !(history.state && history.state.waChat)) history.pushState({ waChat: id }, '');
      st.chatId = id; st.msgs = []; st.lastId = 0;
      $('#wa').classList.add('open');
      renderList();
      $('#waChat').innerHTML = '<div class="wa-empty"><div>Loading…</div></div>';
      await loadChat(false);
    };
    const loadChat = async (update) => {
      const id = st.chatId;
      let d;
      try { d = await api('wa_chat', { query: '&id=' + id + '&read=1' + (update ? '&after=' + st.lastId : '') }); } catch (e) { if (!update) $('#waChat').innerHTML = '<div class="wa-empty">' + esc(e.message) + '</div>'; return; }
      if (id !== st.chatId || S.route !== 'inbox') return;
      const isNew = !update;
      st.chat = d.chat; st.lead = d.lead; st.orders = d.orders; st.quotes = d.quotes;
      if (isNew) st.msgs = d.messages; else st.msgs = st.msgs.concat(d.messages);
      const ticks = {}; d.ticks.forEach((t) => ticks[t.id] = t);
      st.msgs.forEach((m) => { if (ticks[m.id]) { m.status = ticks[m.id].status; m.error = ticks[m.id].error; } });
      if (st.msgs.length) st.lastId = st.msgs[st.msgs.length - 1].id;
      if (isNew) { renderChat(); return; }
      // Live update: add new messages and refresh ticks without redrawing (a playing video keeps playing).
      if (d.messages.length) appendMessages(d.messages);
      d.ticks.forEach((t) => { const el = $('#waMsgs [data-m="' + t.id + '"] .wa-tick'); if (el && !el.classList.contains(t.status)) { el.className = 'wa-tick ' + t.status; el.textContent = WA_TICK[t.status] || ''; el.title = t.error || t.status;
        // A message sent in the background that WhatsApp refused: show it in red with the reason.
        if (t.status === 'failed') { const m = el.closest('.wa-msg'); if (m && !m.classList.contains('failed')) { m.classList.add('failed'); if (t.error) el.closest('.wa-meta').insertAdjacentHTML('beforebegin', '<div class="wa-err">' + esc(t.error) + '</div>'); } } } });
      const headKey = JSON.stringify([d.chat.assignedTo, d.chat.status, d.chat.name]);
      if (headKey !== st.headKey) renderHead();
      if (d.chat.windowOpen !== st.composeOpen) renderCompose();
      const bn = $('#waBotNote'); if (bn) bn.hidden = d.chat.bot !== 'on';
    };
    const renderChat = () => {
      $('#waChat').innerHTML = '<header class="wa-ch" id="waHead"></header><div class="wa-body"><div class="wa-msgs" id="waMsgs"></div><aside class="wa-side" id="waSide"></aside></div><footer class="wa-compose" id="waCompose"></footer>';
      renderHead(); renderMessages(); renderSide(); renderCompose();
    };
    const renderHead = () => {
      const c = st.chat, all = st.data && st.data.me.all;
      st.headKey = JSON.stringify([c.assignedTo, c.status, c.name]);
      const agents = (st.data && st.data.agents) || [];
      $('#waHead').innerHTML = '<button class="btn sm wa-back" id="waBack" aria-label="Back">' + icon('back') + '</button>' +
        waAvatar(c) + '<div class="wa-who"><b>' + esc(c.name) + '</b><small class="wa-via">' + smLogo(c.channel) +
          (c.channel === 'wa' ? '<span dir="ltr">' + esc(c.phone) + '</span>' + (c.profileName && c.profileName !== c.name ? ' · <span>WhatsApp name:</span> ' + esc(c.profileName) : '')
            : '<span>' + SM_NAME[c.channel] + '</span>' + (c.handle ? ' · <a dir="ltr" href="https://instagram.com/' + encodeURIComponent(c.handle) + '" target="_blank" rel="noopener">@' + esc(c.handle) + '</a>' : '') + (c.profileName && c.profileName !== c.name ? ' · ' + esc(c.profileName) : '')) + '</small></div>' +
        '<span class="spacer"></span>' +
        (all ? '<label class="wa-handled"><span>Handled by</span><select id="waAssign" title="Who handles this chat"><option value="">Unassigned</option>' + agents.map((a) => '<option value="' + a.id + '"' + (a.id === c.assignedTo ? ' selected' : '') + '>' + esc(a.name) + (a.away ? ' (away)' : '') + '</option>').join('') +
            (c.assignedTo && !agents.some((a) => a.id === c.assignedTo) ? '<option value="' + c.assignedTo + '" selected>' + esc(c.agent || '') + '</option>' : '') + '</select></label>'
          : !c.assignedTo ? '<button class="btn sm primary" id="waTake">Take this chat</button>' : '') +
        '<button class="btn sm" id="waClose">' + (c.status === 'closed' ? 'Reopen' : 'Close chat') + '</button>' +
        '<button class="btn sm wa-info-btn" id="waInfo">' + icon('person') + '</button>';
      $('#waBack').onclick = () => { if (history.state && history.state.waChat) history.back(); else closeChat(); };
      const as = $('#waAssign'); if (as) as.onchange = async () => { try { const r = await api('wa_assign', { method: 'POST', body: { chat_id: c.id, user_id: as.value ? +as.value : null } }); st.chat = r.chat; toast(as.value ? 'Chat given to ' + r.chat.agent : 'Chat unassigned'); loadList(); } catch (e) { toast(e.message, true); } };
      const tk = $('#waTake'); if (tk) tk.onclick = async () => { try { const r = await api('wa_assign', { method: 'POST', body: { chat_id: c.id, user_id: S.user.id } }); st.chat = r.chat; renderHead(); loadList(); toast('The chat is yours'); } catch (e) { toast(e.message, true); } };
      $('#waClose').onclick = async () => { try { const r = await api('wa_close', { method: 'POST', body: { chat_id: c.id, open: c.status === 'closed' } }); st.chat = r.chat; renderHead(); loadList(); toast(r.chat.status === 'closed' ? 'Chat closed — it reopens if the customer writes again' : 'Chat reopened'); } catch (e) { toast(e.message, true); } };
      $('#waInfo').onclick = () => $('#wa').classList.toggle('side-open');
    };
    // cont: follows a message from the same side (and same team member) within 5 minutes, so it's drawn
    // as one group, like WhatsApp: tighter spacing, and the time only under the group's last message.
    const msgHtml = (m, cont) => {
      const media = m.media ? '../api/admin.php?action=wa_media&id=' + m.id : '';
      let inner = '';
      if (m.kind === 'image' && media) inner = '<a href="' + media + '" target="_blank" rel="noopener"><img class="wa-img" src="' + media + '" alt="Photo" loading="lazy"></a>';
      else if (m.kind === 'sticker' && media) inner = '<img class="wa-sticker" src="' + media + '" alt="Sticker" loading="lazy">';
      else if (m.kind === 'video' && media) inner = '<video class="wa-img" src="' + media + '" controls preload="metadata"></video>';
      else if (m.kind === 'audio' && media) inner = '<audio src="' + media + '" controls preload="none"></audio>';
      else if (media) inner = '<a class="wa-doc" href="' + media + '" target="_blank" rel="noopener">' + icon('file') + '<span><b>' + esc(m.media.name || 'Document') + '</b><small>' + waSize(m.media.size) + '</small></span></a>';
      else if (['image', 'video', 'audio', 'document'].includes(m.kind)) inner = '<div class="muted small">(' + m.kind + ' not available)</div>';
      if (m.kind === 'reaction') return '<div class="wa-sys">Reacted ' + esc(m.body) + '</div>';
      const text = m.body ? '<div class="wa-text">' + waLink(m.body) + '</div>' : '';
      const ad = m.ad ? '<div class="wa-adref">📣 From ad: <b>' + esc(m.ad.headline || 'Facebook / Instagram ad') + '</b>' + (m.ad.url ? ' · <a href="' + esc(m.ad.url) + '" target="_blank" rel="noopener">view</a>' : '') + '</div>' : '';
      const time = new Date(m.at.replace(' ', 'T') + 'Z').toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
      const meta = '<span class="wa-meta">' + (m.dir === 'out' && m.by ? '<span class="wa-by">' + esc(m.by) + ' · </span>' : '') + time +
        (m.dir === 'out' ? ' <span class="wa-tick ' + esc(m.status) + '" title="' + esc(m.error || m.status) + '">' + (WA_TICK[m.status] || '') + '</span>' : '') + '</span>';
      return '<div class="wa-msg ' + m.dir + (cont ? ' cont' : '') + (m.status === 'failed' ? ' failed' : '') + '" data-m="' + m.id + '" title="' + esc(time) + '">' + ad + inner + text + (m.status === 'failed' && m.error ? '<div class="wa-err">' + esc(m.error) + '</div>' : '') + meta + '</div>';
    };
    const dayOf = (m) => new Date(m.at.replace(' ', 'T') + 'Z').toLocaleDateString(LOC, { weekday: 'short', day: 'numeric', month: 'short' });
    const withDays = (list) => list.map((m) => {
      const d = dayOf(m), p = st.prev, sep = d !== st.day ? '<div class="wa-day">' + esc(d) + '</div>' : '';
      const cont = !sep && p && m.kind !== 'reaction' && p.kind !== 'reaction' && !m.ad && p.dir === m.dir && (p.by || '') === (m.by || '') &&
        new Date(m.at.replace(' ', 'T') + 'Z') - new Date(p.at.replace(' ', 'T') + 'Z') < 5 * 60000;
      st.day = d; st.prev = m;
      return sep + msgHtml(m, cont);
    }).join('');
    // Keep the newest message in view while photos load, unless the person has scrolled up to read.
    const stickDown = (box) => {
      st.stick = true;
      box.onscroll = () => { st.stick = box.scrollHeight - box.scrollTop - box.clientHeight < 80; };
      box.addEventListener('load', (e) => { if (st.stick && /IMG|VIDEO/.test(e.target.tagName)) box.scrollTop = box.scrollHeight; }, true);
      box.addEventListener('loadedmetadata', () => { if (st.stick) box.scrollTop = box.scrollHeight; }, true);
    };
    // Long press on a message (phones) copies its text.
    const copyOnHold = (box) => {
      let t = null, x0 = 0, y0 = 0;
      const stop = () => { clearTimeout(t); t = null; };
      box.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') return;
        const el = e.target.closest('.wa-msg'); const tx = el && $('.wa-text', el); if (!tx || e.target.closest('a,audio,video')) return;
        x0 = e.clientX; y0 = e.clientY; stop();
        t = setTimeout(() => { t = null; waCopy(tx.innerText); el.classList.add('copied'); setTimeout(() => el.classList.remove('copied'), 600); if (navigator.vibrate) navigator.vibrate(15); }, 480);
      });
      box.addEventListener('pointermove', (e) => { if (t && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) stop(); });
      ['pointerup', 'pointercancel', 'scroll'].forEach((ev) => box.addEventListener(ev, stop, true));
      box.addEventListener('contextmenu', (e) => { if (matchMedia('(pointer: coarse)').matches && e.target.closest('.wa-msg')) e.preventDefault(); });
    };
    const renderMessages = () => {
      const box = $('#waMsgs'); if (!box) return;
      copyOnHold(box);
      st.day = ''; st.prev = null;
      box.innerHTML = withDays(st.msgs) || '<div class="muted small wa-none" style="text-align:center;padding:20px">No messages yet.</div>';
      stickDown(box);
      box.scrollTop = box.scrollHeight;
    };
    // New messages at the bottom; the list only scrolls down if you were already at the bottom.
    const appendMessages = (list) => {
      const box = $('#waMsgs'); if (!box) return;
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      const none = $('.wa-none', box); if (none) none.remove();
      list = list.filter((m) => !$('[data-m="' + m.id + '"]', box));
      box.insertAdjacentHTML('beforeend', withDays(list));
      if (atBottom || list.some((m) => m.dir === 'out')) box.scrollTop = box.scrollHeight;
    };
    const renderSide = () => {
      const c = st.chat, l = st.lead;
      $('#waSide').innerHTML = '<div class="stack" style="gap:12px">' +
        (c.ad ? '<div class="card wa-adcard"><small class="muted">Came from ad</small><b>' + esc(c.ad.headline || '—') + '</b>' + (c.ad.body ? '<div class="small">' + esc(c.ad.body) + '</div>' : '') + (c.ad.id ? '<small class="muted">Ad ID ' + esc(c.ad.id) + '</small>' : '') + '</div>' : '') +
        (l ? '<div class="card stack" style="gap:8px"><small class="muted">Lead</small><input type="text" id="waLeadName" value="' + esc(l.name) + '" aria-label="Customer name">' +
          '<select id="waLeadStatus">' + S.meta.leadStatuses.map((s2) => '<option value="' + s2 + '"' + (s2 === l.status ? ' selected' : '') + '>' + s2 + '</option>').join('') + '</select>' +
          '<div class="small muted">' + esc(l.source || '') + (l.cat ? ' · ' + esc(l.cat) : '') + '</div>' +
          '<textarea id="waLeadNote" rows="2" placeholder="Add a note (e.g. call back Thursday)"></textarea><button class="btn sm" id="waLeadSave">Save</button>' +
          (l.notes ? '<details><summary class="small">Notes</summary><div class="small" style="white-space:pre-line;margin-top:6px">' + esc(l.notes) + '</div></details>' : '') + '</div>' : '') +
        '<div class="row"><button class="btn sm" id="waQuote">' + icon('file') + 'New quote</button><button class="btn sm" id="waOrder">' + icon('cart') + 'New order</button></div>' +
        (st.quotes.length ? '<div class="card"><small class="muted">Quotes</small><div class="list">' + st.quotes.map((q) => '<div class="li small"><a href="doc.html?quote=' + q.id + '" target="_blank" rel="noopener">' + esc(q.number) + '</a><span>' + esc(q.status) + ' · ' + egp(q.total) + '</span></div>').join('') + '</div></div>' : '') +
        (st.orders.length ? '<div class="card"><small class="muted">Orders</small><div class="list">' + st.orders.map((o) => '<div class="li small wa-ord"><span>' + esc(o.number) + '</span><span>' + esc(o.status) + ' · ' + egp(o.total) + '</span>' +
          // Still to pay: one tap sends the customer a payment link (card or wallet) in this chat.
          (o.due <= 0 && o.paid > 0 && !['Cancelled', 'Returned'].includes(o.status) ? '<span class="wa-paid">✓ <span>Paid</span></span>' : '') +
          (o.due > 0 && !['Cancelled', 'Returned'].includes(o.status) ? (o.paid > 0 ? '<span class="muted">' + egp(o.paid) + ' <span>paid</span> · </span>' : '') + '<span class="wa-due">' + egp(o.due) + ' <span>due</span></span>' + (o.payable && c.windowOpen ? '<button class="btn sm" data-pay="' + o.id + '">💳 <span>Send payment link</span></button>' : '') : '') +
          '</div>').join('') + '</div></div>' : '') + '</div>';
      const save = $('#waLeadSave');
      if (save) save.onclick = async () => {
        try {
          await api('wa_lead', { method: 'POST', body: { chat_id: c.id, name: $('#waLeadName').value, status: $('#waLeadStatus').value, note: $('#waLeadNote').value } });
          toast('Lead saved'); await loadChat(false);
        } catch (e) { toast(e.message, true); }
      };
      const pre = () => ({ name: l ? l.name : c.name, phone: c.phone, leadId: c.leadId, interest: c.ad ? c.ad.headline : '' });
      $$('[data-pay]', $('#waSide')).forEach((b) => b.onclick = async () => {
        b.disabled = true;
        try {
          const r = await api('wa_pay_link', { method: 'POST', body: { chat_id: c.id, order_id: +b.dataset.pay } });
          st.msgs.push(r.message); st.lastId = Math.max(st.lastId, r.message.id); appendMessages([r.message]); loadList(); toast('Payment link sent');
        } catch (e) { toast(e.message, true); }
        b.disabled = false;
      });
      $('#waQuote').onclick = () => newOrderDrawer(Object.assign(pre(), { mode: 'quote' }));
      $('#waOrder').onclick = () => newOrderDrawer(pre());
    };
    const renderCompose = () => {
      const c = st.chat;
      st.composeOpen = c.windowOpen;
      if (!c.windowOpen && c.channel !== 'wa') {
        // Instagram and Messenger: no templates, so nothing can be sent until the customer writes again.
        $('#waCompose').innerHTML = '<div class="wa-closed">' + icon('clock') + '<span>More than 24 hours since the customer’s last message, so Instagram and Messenger don’t allow a reply. The chat opens again as soon as the customer writes.</span></div>';
        return;
      }
      if (!c.windowOpen) {
        // After 24 hours only an approved template can be sent (Settings → WhatsApp → Message templates).
        $('#waCompose').innerHTML = '<div class="wa-quick wa-prods wa-tpls" id="waTplList" hidden></div><div class="wa-closed">' + icon('clock') + '<span>More than 24 hours since the customer’s last message, so WhatsApp only allows an approved template. The chat opens again as soon as the customer writes.</span>' +
          '<span class="spacer"></span><button class="btn sm primary" id="waTplBtn">Send a template</button></div>';
        const tl = $('#waTplList');
        const drawTpls = async () => {
          $('#waTplItems').innerHTML = '<div class="muted small" style="padding:10px">Loading…</div>';
          let r;
          try { r = await api('wa_templates', { query: '&chat_id=' + c.id + '&lang=' + st.tplLang }); } catch (e) { $('#waTplItems').innerHTML = '<div class="err">' + esc(e.message) + '</div>'; return; }
          $('#waTplItems').innerHTML = r.templates.map((t) => '<div class="wa-tpl' + (t.ready ? '' : ' off') + '"><div class="row"><b>' + esc(t.title) + '</b><span class="pill">' + (t.category === 'MARKETING' ? 'Marketing' : 'Utility') + '</span><span class="spacer"></span>' +
            (t.ready ? '<button class="btn sm primary" data-tpl="' + t.name + '">Send</button>' : '<span class="small muted">' + esc(t.why) + '</span>') + '</div>' +
            '<div class="wa-tpl-text" dir="auto">' + waLink(t.preview) + '</div>' + (t.button ? '<div class="wa-tpl-btn">🔗 ' + esc(t.button) + '</div>' : '') + '</div>').join('');
          $$('[data-tpl]', tl).forEach((b) => b.onclick = async () => {
            tl.hidden = true;
            try { const m = (await api('wa_send_template', { method: 'POST', body: { chat_id: c.id, name: b.dataset.tpl, lang: st.tplLang } })).message; st.msgs.push(m); st.lastId = Math.max(st.lastId, m.id); appendMessages([m]); loadList(); }
            catch (e) { toast(e.message, true); }
          });
        };
        $('#waTplBtn').onclick = () => {
          if (!tl.hidden) { tl.hidden = true; return; }
          st.tplLang = st.tplLang || 'ar';
          tl.innerHTML = '<div class="wa-ph"><b>Message templates</b><span class="spacer"></span><div class="seg"><button data-tl="ar" class="' + (st.tplLang === 'ar' ? 'on' : '') + '">عربي</button><button data-tl="en" class="' + (st.tplLang === 'en' ? 'on' : '') + '">English</button></div></div>' +
            '<div class="small muted wa-phint">Meta charges for each template message. The customer’s name and order are filled in.</div><div id="waTplItems"></div>';
          tl.hidden = false;
          $$('[data-tl]', tl).forEach((b) => b.onclick = () => { st.tplLang = b.dataset.tl; $$('[data-tl]', tl).forEach((x) => x.classList.toggle('on', x === b)); drawTpls(); });
          drawTpls();
        };
        return;
      }
      const touchKeys = matchMedia('(pointer: coarse)').matches; // a phone or tablet keyboard
      const left = c.windowEnds ? Math.max(0, Math.round((new Date(c.windowEnds.replace(' ', 'T') + 'Z') - Date.now()) / 3600000)) : 0;
      $('#waCompose').innerHTML = '<div class="wa-quick" id="waQuickList" hidden></div><div class="wa-quick wa-prods" id="waProdList" hidden></div>' +
        '<div class="wa-botnote" id="waBotNote"' + (c.bot === 'on' ? '' : ' hidden') + '>🤖 <span>The bot is answering this chat. Writing here takes it over.</span></div>' +
        '<div class="wa-cbar' + (c.channel === 'wa' ? '' : ' no-mic') + '"><button class="btn sm" id="waQuickBtn" title="Quick replies">' + icon('bolt') + '</button>' +
        '<button class="btn sm" id="waProdBtn" title="Send a product">' + icon('box') + '</button>' +
        '<label class="btn sm" title="Send a photo, video or file">' + icon('clip') + '<input type="file" id="waFile" hidden accept="' + (c.channel === 'ig' ? 'image/jpeg,image/png,image/gif,video/mp4,video/quicktime,.pdf' : 'image/jpeg,image/png,video/mp4,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt') + '"></label>' +
        '<textarea id="waText" rows="1" dir="auto" placeholder="Write a message" enterkeyhint="enter"' + (touchKeys ? '' : ' title="Enter sends · Shift+Enter adds a new line"') + '></textarea>' +
        // Voice notes are recorded in WhatsApp's format, which Instagram and Messenger don't play.
        (c.channel === 'wa' ? '<button class="btn sm" id="waMic" title="Record a voice note" aria-label="Record a voice note">' + icon('mic') + '</button>' : '') +
        '<button class="btn primary" id="waSend" aria-label="Send">' + icon('send') + '</button></div>' +
        '<div class="wa-window small muted">Free replies for about ' + left + ' more hour' + (left === 1 ? '' : 's') + '</div>';
      const ta = $('#waText');
      const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; };
      // Like WhatsApp on phones: the mic while the box is empty, the send button once there's text.
      const hasText = () => ta.closest('.wa-cbar').classList.toggle('has-text', !!ta.value.trim());
      ta.oninput = () => { grow(); hasText(); };
      const send = async () => {
        const text = ta.value.trim(); if (!text) return;
        $('#waSend').disabled = true;
        try { const r = await api('wa_send', { method: 'POST', body: { chat_id: c.id, text } }); ta.value = ''; grow(); hasText(); st.msgs.push(r.message); st.lastId = Math.max(st.lastId, r.message.id); appendMessages([r.message]); loadList(); }
        catch (e) { toast(e.message, true); }
        $('#waSend').disabled = false; ta.focus();
      };
      $('#waSend').onclick = send;
      // Phones: the keyboard's Enter adds a new line (send with the button). Computers: Enter sends, Shift+Enter adds a line.
      ta.onkeydown = (e) => { if (!touchKeys && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };
      // Send a product: its photo with name, price and the link to order, in Arabic or English.
      const pl = $('#waProdList');
      waProductList(st.prodLang || 'ar').catch(() => {}); // ready before the button is tapped
      const added = (m) => { st.msgs.push(m); st.lastId = Math.max(st.lastId, m.id); appendMessages([m]); loadList(); };
      const drawProducts = () => {
        const q = (st.prodQ || '').toLowerCase();
        const list = (waProds[st.prodLang] || []).filter((p) => !q || (p.name + ' ' + p.other).toLowerCase().includes(q));
        $('#waProdItems').innerHTML = list.length ? list.map((p) => '<button data-p="' + esc(p.id) + '"><span class="wa-pimg">' + (p.image ? '<img src="' + esc(thumb(p.image, 120)) + '" alt="" loading="lazy">' : icon('box')) + '</span>' +
          '<span class="wa-pt"><b dir="auto">' + esc(p.name) + '</b><span dir="auto">' + esc(p.price) + (p.inStock ? '' : ' · <em>Out of stock</em>') + '</span></span></button>').join('')
          : '<div class="muted small" style="padding:10px">No products found.</div>';
        // Sends in the background: the list closes at once, the message appears when WhatsApp accepts it.
        $$('[data-p]', pl).forEach((b) => b.onclick = async () => {
          pl.hidden = true;
          try { const r = await api('wa_send_product', { method: 'POST', body: { chat_id: c.id, product_id: b.dataset.p, lang: st.prodLang } }); if (st.chatId === c.id) added(r.message); }
          catch (err) { toast(err.message, true); }
        });
      };
      // The list is kept for the session (one per language) and refreshed quietly each time it opens.
      const loadProducts = async () => {
        const lang = st.prodLang;
        if (waProds[lang]) drawProducts(); else $('#waProdItems').innerHTML = '<div class="muted small" style="padding:10px">Loading…</div>';
        try { waProds[lang] = (await waProductList(lang, true)); if (st.prodLang === lang && !pl.hidden) drawProducts(); }
        catch (err) { if (!waProds[lang]) $('#waProdItems').innerHTML = '<div class="err">' + esc(err.message) + '</div>'; }
      };
      $('#waProdBtn').onclick = () => {
        $('#waQuickList').hidden = true;
        if (!pl.hidden) { pl.hidden = true; return; }
        st.prodLang = st.prodLang || 'ar';
        pl.innerHTML = '<div class="wa-ph"><input type="search" id="waProdQ" placeholder="Search products" value="' + esc(st.prodQ || '') + '">' +
          '<div class="seg"><button data-pl="ar" class="' + (st.prodLang === 'ar' ? 'on' : '') + '">عربي</button><button data-pl="en" class="' + (st.prodLang === 'en' ? 'on' : '') + '">English</button></div></div>' +
          '<div class="small muted wa-phint">Sends the photo with name, price and the link to order.</div><div id="waProdItems"></div>';
        pl.hidden = false;
        $('#waProdQ').oninput = (e) => { st.prodQ = e.target.value; drawProducts(); };
        $$('[data-pl]', pl).forEach((b) => b.onclick = () => { st.prodLang = b.dataset.pl; $$('[data-pl]', pl).forEach((x) => x.classList.toggle('on', x === b)); loadProducts(); });
        loadProducts();
        $('#waProdQ').focus();
      };
      $('#waFile').onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        const caption = file.type.startsWith('audio') ? '' : ta.value.trim();
        const fd = new FormData(); fd.append('chat_id', c.id); fd.append('file', file); fd.append('caption', caption);
        toast('Sending ' + file.name + '…');
        try { const r = await api('wa_send_file', { method: 'POST', form: fd }); if (caption) { ta.value = ''; grow(); hasText(); } st.msgs.push(r.message); st.lastId = Math.max(st.lastId, r.message.id); appendMessages([r.message]); loadList(); toast('Sent'); }
        catch (err) { toast(err.message, true); }
        e.target.value = '';
      };
      // Voice note: record, then send (or bin it). Sent as a WhatsApp voice message (Ogg/Opus; iPhones record M4A).
      if ($('#waMic')) $('#waMic').onclick = async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { toast('This browser can’t record voice notes.', true); return; }
        let stream;
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); } catch (e) { toast('Allow the microphone to record a voice note.', true); return; }
        const type = waVoiceType();
        let mr;
        try { mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined); } catch (e) { stream.getTracks().forEach((t) => t.stop()); toast('This browser can’t record voice notes.', true); return; }
        const chunks = [];
        mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        const stopped = new Promise((r) => { mr.onstop = r; });
        const bar = $('#waCompose .wa-cbar');
        const rb = document.createElement('div');
        rb.className = 'wa-rec';
        rb.innerHTML = '<button class="btn sm" data-rec="x" title="Delete" aria-label="Delete">' + icon('trash') + '</button><span class="wa-rec-dot"></span><span class="wa-rec-t">0:00</span><span class="small muted">Recording…</span><span class="spacer"></span><button class="btn primary" data-rec="send" aria-label="Send">' + icon('send') + '</button>';
        bar.hidden = true; bar.after(rb);
        const t0 = Date.now();
        let done = false, tick = 0;
        const finish = async (sendIt) => {
          if (done) return; done = true;
          clearInterval(tick);
          if (mr.state !== 'inactive') mr.stop();
          await stopped;
          stream.getTracks().forEach((t) => t.stop());
          rb.remove(); bar.hidden = false;
          if (!sendIt || Date.now() - t0 < 700 || !chunks.length) return;
          let blob = new Blob(chunks, { type: mr.mimeType || type || 'audio/webm' }), name = 'voice.ogg';
          try {
            if (/webm/.test(blob.type)) blob = new Blob([waWebmToOgg(new Uint8Array(await blob.arrayBuffer()))], { type: 'audio/ogg' });
            else if (/mp4|aac/.test(blob.type)) name = 'voice.m4a';
          } catch (e) { toast('Could not prepare the voice note. Try again.', true); return; }
          const fd = new FormData(); fd.append('chat_id', c.id); fd.append('file', new File([blob], name, { type: blob.type })); fd.append('caption', ''); fd.append('voice', '1');
          toast('Sending voice note…');
          try { const r = await api('wa_send_file', { method: 'POST', form: fd }); added(r.message); toast('Sent'); } catch (err) { toast(err.message, true); }
        };
        tick = setInterval(() => { const sec = Math.floor((Date.now() - t0) / 1000); $('.wa-rec-t', rb).textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); if (sec >= 300) finish(true); }, 250);
        $('[data-rec="x"]', rb).onclick = () => finish(false);
        $('[data-rec="send"]', rb).onclick = () => finish(true);
        mr.start(250);
      };
      const ql = $('#waQuickList');
      $('#waQuickBtn').onclick = () => {
        const quick = (st.data && st.data.quick) || [];
        ql.innerHTML = quick.map((q, i) => '<button data-q="' + i + '"><b>' + esc(q.title) + '</b><span>' + esc(q.body) + '</span></button>').join('') +
          (can('whatsapp_all') ? '<button class="wa-qm" id="waQuickManage">✎ Edit quick replies</button>' : '');
        ql.hidden = !ql.hidden; $('#waProdList').hidden = true;
        $$('[data-q]', ql).forEach((b) => b.onclick = () => { ta.value = (ta.value ? ta.value + '\n' : '') + waFillName(quick[+b.dataset.q].body, (st.lead && st.lead.name) || c.name); ql.hidden = true; grow(); hasText(); ta.focus(); });
        const qm = $('#waQuickManage'); if (qm) qm.onclick = () => { ql.hidden = true; waQuickDrawer(); };
      };
    };
    const poll = () => {
      clearTimeout(st.timer);
      st.timer = setTimeout(async () => {
        if (S.route !== 'inbox' || !S.user) { st.timer = null; return; }
        try { await loadList(); if (st.chatId) await loadChat(true); } catch (e) {}
        poll();
      }, 5000);
    };
    // Back on screen (the app was in the background): fetch what came in meanwhile and restart the refresh.
    st.wake = async () => { clearTimeout(st.timer); st.timer = null; try { await loadList(); if (st.chatId) await loadChat(true); } catch (e) {} if (S.route === 'inbox') poll(); };
    clearTimeout(st.timer); st.timer = null;
    await loadList();
    if (S.openWaChat) { const id = S.openWaChat; S.openWaChat = null; openChat(id); }
    else if (st.chatId && !waPhone()) openChat(st.chatId);
    else st.chatId = null; // a phone opens WhatsApp on the chat list
  }

  function waQuickDrawer() {
    const draw = (list) => {
      const d = openDrawer('Quick replies', '<div class="stack">' + list.map((q) => '<div class="card stack" style="gap:6px"><input type="text" data-t="' + q.id + '" value="' + esc(q.title) + '"><textarea data-b="' + q.id + '" rows="3">' + esc(q.body) + '</textarea>' +
        '<div class="row"><span class="spacer"></span><button class="btn sm danger" data-del="' + q.id + '">Delete</button><button class="btn sm" data-save="' + q.id + '">Save</button></div></div>').join('') +
        '<div class="hint">Write {name} where the customer’s first name should go, e.g. أهلًا يا {name} 👋</div>' +
        '<div class="card stack" style="gap:6px"><b>New quick reply</b><input type="text" id="qrT" placeholder="Name, e.g. Prices"><textarea id="qrB" rows="3" placeholder="The message"></textarea><div class="row"><span class="spacer"></span><button class="btn sm primary" id="qrAdd">Add</button></div></div></div>');
      const done = (r) => { if (waInbox.data) waInbox.data.quick = r.quick; draw(r.quick); toast('Saved'); };
      $$('[data-save]', d).forEach((b) => b.onclick = async () => { try { done(await api('wa_quick_save', { method: 'POST', body: { id: +b.dataset.save, title: $('[data-t="' + b.dataset.save + '"]', d).value, body: $('[data-b="' + b.dataset.save + '"]', d).value } })); } catch (e) { toast(e.message, true); } });
      $$('[data-del]', d).forEach((b) => b.onclick = async () => { if (!confirm('Delete this quick reply?')) return; try { done(await api('wa_quick_delete', { method: 'POST', body: { id: +b.dataset.del } })); } catch (e) { toast(e.message, true); } });
      $('#qrAdd', d).onclick = async () => { try { done(await api('wa_quick_save', { method: 'POST', body: { title: $('#qrT', d).value, body: $('#qrB', d).value } })); } catch (e) { toast(e.message, true); } };
    };
    draw((waInbox.data && waInbox.data.quick) || []);
  }

  // ---------- customers ----------
  async function pageCustomers() {
    const d = await api('customers');
    S.customers = d.customers;
    const q = (S.custQ || '').trim().toLowerCase();
    const view = S.custView || '';
    const FILTERS = { account: (c) => !!c.account, guest: (c) => !c.account, offers: (c) => !!(c.account && c.account.offers), repeat: (c) => c.orders > 1 };
    const list = d.customers.filter((c) => (!view || FILTERS[view](c)) && (!q || (c.name + ' ' + c.phone + ' ' + c.email + ' ' + c.business + ' ' + c.city).toLowerCase().includes(q)));
    const repeat = d.customers.filter((c) => c.orders > 1).length;
    const withAcct = d.customers.filter((c) => c.account).length;
    const tabs = [['', 'All', d.customers.length], ['account', 'With shop account', withAcct], ['guest', 'No account', d.customers.length - withAcct],
      ['offers', 'Want offers', d.customers.filter(FILTERS.offers).length], ['repeat', 'Repeat', repeat]];
    $('#main').innerHTML = header('Customers', d.customers.length + ' customers · ' + withAcct + ' with a shop account · ' + repeat + ' ordered more than once' + (can('own_orders') ? ' · your orders only' : ''), '') +
      '<div class="row" style="margin-bottom:16px"><div class="seg" id="ctabs">' + tabs.map(([k, l, n]) => '<button data-v="' + k + '" class="' + (k === view ? 'on' : '') + '">' + esc(l) + ' <span class="muted">' + n + '</span></button>').join('') + '</div>' +
      '<span class="spacer"></span><input type="search" id="cq" placeholder="Search name, phone, business, area…" value="' + esc(S.custQ || '') + '" style="max-width:300px"></div>' +
      (list.length ? '<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Area</th><th class="num">Orders</th><th class="num">Spent</th><th class="num">Balance due</th><th>Last order</th></tr></thead><tbody>' +
        list.map((c, i) => '<tr class="click" data-c="' + esc(c.key) + '"><td><b>' + esc(c.name) + '</b>' + (c.account ? ' <span class="pill good" title="Signed up on the website">● Account</span>' : '') + (c.orders > 1 ? ' <span class="pill accent">↻ Repeat</span>' : '') +
          '<div class="small muted">' + esc([c.business, c.phone].filter(Boolean).join(' · ')) + '</div></td><td class="small">' + esc(c.city || '—') + '</td>' +
          '<td class="num">' + c.orders + '</td><td class="num"><b>' + egp(c.spent) + '</b></td><td class="num">' + (c.due > 0.5 ? '<span class="pay-part">' + egp(c.due) + '</span>' : '<span class="muted">—</span>') + '</td>' +
          '<td class="small muted">' + dateTime(c.last) + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="card empty">' + (q ? 'No customers match.' : 'Customers appear here once orders come in.') + '</div>');
    let t;
    $('#cq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { S.custQ = e.target.value; pageCustomers().then(() => { const i = $('#cq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 200); };
    $$('tr[data-c]').forEach((tr) => tr.onclick = () => customerDrawer(d.customers.find((c) => c.key === tr.dataset.c)));
    $$('#ctabs button').forEach((b) => b.onclick = () => { S.custView = b.dataset.v; pageCustomers(); });
  }

  async function customerDrawer(c) {
    const d = await api('customer', { query: '&key=' + encodeURIComponent(c.key) });
    const phone = phoneOf(c.phone);
    const wa = phone ? 'https://wa.me/' + waNumber(phone) + '?text=' + encodeURIComponent(AR ? 'أهلًا ' + c.name.split(/\s+/)[0] + '، معك ' + S.user.name.split(' ')[0] + ' من Where To Spot. ' : 'Hello ' + c.name.split(/\s+/)[0] + ', this is ' + S.user.name.split(' ')[0] + ' from Where To Spot. ') : '';
    const avg = c.orders ? c.spent / c.orders : 0;
    const body = '<div class="stack">' +
      '<div class="card stack" style="gap:12px"><div class="row" style="align-items:flex-start"><span class="avatar" style="width:46px;height:46px;font-size:15px">' + esc(c.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()) + '</span>' +
      '<div style="flex:1"><b style="font-size:17px">' + esc(c.name) + '</b>' + (c.business ? '<div>' + esc(c.business) + '</div>' : '') + '<div class="small muted">' + esc([c.phone, c.email && c.email.includes('@') ? c.email : '', c.city].filter(Boolean).join(' · ')) + '</div></div></div>' +
      '<div class="row lead-actions">' + (wa ? '<a class="btn sm wa" href="' + esc(wa) + '" target="_blank" rel="noopener">' + icon('chat') + 'WhatsApp</a>' : '') + (phone ? '<a class="btn sm" href="tel:' + esc(c.phone) + '">' + icon('phone') + 'Call</a>' : '') +
      (can('sell') ? '<span class="spacer"></span><button class="btn sm dark" id="cNew">' + icon('cart') + 'New order</button>' : '') + '</div></div>' +
      '<div class="kpis" style="margin:0"><div class="kpi"><div class="label">Orders</div><div class="value">' + c.orders + '</div><div class="note">since ' + dateTime(c.first).split(/[,،]/)[0] + '</div></div>' +
      '<div class="kpi"><div class="label">Total spent</div><div class="value">' + egp(c.spent) + '</div><div class="note">avg ' + egp(avg) + '</div></div>' +
      '<div class="kpi"><div class="label">Balance due</div><div class="value">' + egp(c.due) + '</div><div class="note">' + (c.due > 0.5 ? 'still to collect' : 'nothing owed') + '</div></div></div>' +
      (c.account ? '<div class="card"><h2>' + icon('person') + 'Shop account<span class="spacer"></span><span class="pill good">● Signed up</span></h2><div class="list">' +
        '<div class="li"><span class="muted">Since</span><span>' + dateTime(c.account.since) + '</span></div>' +
        '<div class="li"><span class="muted">Last signed in</span><span>' + (c.account.lastLogin ? dateTime(c.account.lastLogin) : '—') + '</span></div>' +
        '<div class="li"><span class="muted">Contact about orders by</span><span>' + esc({ whatsapp: 'WhatsApp', call: 'Phone call', email: 'Email' }[c.account.contact] || 'WhatsApp') + '</span></div>' +
        '<div class="li"><span class="muted">Offers</span><span>' + (c.account.offers ? '<span class="pill good">✓ Wants offers</span>' : 'No') + '</span></div>' +
        '<div class="li"><span class="muted">Language</span><span>' + (c.account.lang === 'ar' ? 'العربية' : c.account.lang === 'en' ? 'English' : '—') + '</span></div></div></div>'
        : '<div class="card small muted">No shop account yet — they check out as a guest. After their next order the shop offers to create one.</div>') +
      (d.lead ? '<div class="card"><h2>Lead<span class="spacer"></span>' + pill(LEAD_TONE, d.lead.status) + '</h2><div class="small" style="white-space:pre-line;max-height:160px;overflow:auto">' + esc(d.lead.notes || 'No notes.') + '</div></div>' : '') +
      '<div class="card"><h2>Orders</h2>' + (d.orders.length ? '' : '<div class="muted small">No orders yet.</div>') + '<div class="list">' + d.orders.map((o) => '<div class="li fu" data-o="' + o.id + '"><span><b>' + esc(o.number) + '</b> · ' + dateTime(o.createdAt) +
        '<div class="small muted">' + o.items.map((it) => esc(it.qty + '× ' + it.name)).join(', ') + '</div></span><span style="text-align:right">' + pill(ORDER_TONE, o.status) + '<div class="small"><b>' + egp(o.total) + '</b></div>' + payState(o) + '</span></div>').join('') + '</div></div></div>';
    openDrawer('Customer', body, '<span class="spacer"></span><button class="btn" data-close>Close</button>');
    $$('#drawer [data-close]').forEach((b) => b.addEventListener('click', closeDrawer));
    $$('[data-o]').forEach((r) => r.onclick = () => orderDrawer(d.orders.find((o) => o.id === +r.dataset.o)));
    const cn = $('#cNew');
    if (cn) cn.onclick = () => { closeDrawer(); newOrderDrawer({ name: c.name, phone: phone ? localPhone(phone) : '', email: c.email && c.email.includes('@') ? c.email : '' }); };
  }

  // ---------- install as an app (PWA) ----------
  let installEvt = null;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; const b = $('#installBtn'); if (b) b.hidden = false; });
  window.addEventListener('appinstalled', () => { installEvt = null; const b = $('#installBtn'); if (b) b.remove(); toast('App installed — find “WTS Team” on your home screen'); });
  async function installApp() {
    if (installEvt) { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; return; }
    openDrawer('Install the team app', '<div class="stack"><div class="card stack" style="gap:10px"><b>On iPhone or iPad (Safari)</b>' +
      '<ol class="muted" style="margin:0;padding-left:18px;line-height:1.9"><li>Tap the <b>Share</b> button (the square with an arrow).</li><li>Choose <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. “WTS Team” appears on your home screen.</li></ol></div>' +
      '<div class="card stack" style="gap:10px"><b>On Android (Chrome)</b><ol class="muted" style="margin:0;padding-left:18px;line-height:1.9"><li>Tap the <b>⋮</b> menu.</li><li>Choose <b>Install app</b> or <b>Add to Home screen</b>.</li></ol></div>' +
      '<div class="hint">The app opens full-screen, signs you in like the website, and always shows live data.</div></div>', '<span class="spacer"></span><button class="btn" data-close>Done</button>');
    $$('#drawer [data-close]').forEach((b) => b.addEventListener('click', closeDrawer));
  }

  // ---------- quick search ( / or Ctrl+K ) ----------
  function openSearch() {
    if ($('#search')) return;
    const wrap = document.createElement('div');
    wrap.id = 'search';
    wrap.innerHTML = '<div class="scrim" data-sclose></div><div class="palette" role="dialog" aria-label="Search"><div class="pal-in">' + icon('search') +
      '<input type="search" id="sq" placeholder="Search orders, customers, phone numbers, leads, products…" autocomplete="off"><kbd>Esc</kbd></div><div class="pal-res" id="sres"><div class="pal-hint">Type a name, phone number, order number (e.g. 1001) or product.</div></div></div>';
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    $$('[data-sclose]', wrap).forEach((e) => e.onclick = close);
    const inp = $('#sq'); inp.focus();
    let results = [], sel = 0, t, seq = 0;
    const TYPE = { order: ['bag', 'Order'], lead: ['inbox', 'Lead'], product: ['box', 'Product'] };
    const draw = () => {
      $('#sres').innerHTML = results.length ? results.map((r, i) => '<button class="pal-item' + (i === sel ? ' on' : '') + '" data-i="' + i + '">' + icon(TYPE[r.type][0]) +
        '<span><b>' + esc(r.title) + '</b><small>' + esc(r.sub) + '</small></span><em>' + TYPE[r.type][1] + '</em></button>').join('')
        : '<div class="pal-hint">' + (inp.value.trim().length < 2 ? 'Type at least 2 characters.' : 'Nothing found.') + '</div>';
      $$('.pal-item', wrap).forEach((b) => b.onclick = () => go(results[+b.dataset.i]));
    };
    const go = async (r) => {
      close();
      if (r.type === 'order') {
        const d = await api('orders', { query: '&q=' + encodeURIComponent('WTS-' + (1000 + r.id)) });
        const o = d.orders.find((x) => x.id === r.id); if (o) orderDrawer(o);
      } else if (r.type === 'lead') { S.openLead = r.id; S.leadStatus = ''; S.leadQ = ''; S.leadView = 'list'; if (S.route === 'leads') pageLeads(); else location.hash = '#leads'; }
      else if (r.type === 'product') { S.openProduct = r.id; if (S.route === 'products') pageProducts(); else location.hash = '#products'; }
    };
    inp.oninput = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const my = ++seq;
        const q = inp.value.trim();
        if (q.length < 2) { results = []; return draw(); }
        try { const d = await api('search', { query: '&q=' + encodeURIComponent(q) }); if (my !== seq) return; results = d.results; sel = 0; draw(); } catch (e) { /* keep typing */ }
      }, 180);
    };
    inp.onkeydown = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
      else if (e.key === 'Enter' && results[sel]) { e.preventDefault(); go(results[sel]); }
    };
  }
  document.addEventListener('keydown', (e) => {
    if (!S.user) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if (S.user && can('orders_only')) return;
    if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); openSearch(); }
  });

  async function pageLeads() {
    const [d] = await Promise.all([api('leads'), loadTeam()]);
    S.leads = d.leads;
    const st = S.leadStatus || '';
    const q = (S.leadQ || '').trim().toLowerCase();
    const board = S.leadView === 'board';
    const dueCount = d.leads.filter(isDue).length;
    const match = (l) => !q || (l.name + ' ' + l.contact + ' ' + l.cat + ' ' + l.notes + ' ' + l.source).toLowerCase().includes(q);
    const list = d.leads.filter((l) => match(l) && (board || (st === 'due' ? isDue(l) : !st || l.status === st)));
    const tabs = [['', 'All']].concat(S.meta.leadStatuses.map((x) => [x, x]), [['due', 'Follow up due' + (dueCount ? ' · ' + dueCount : '')]]);
    $('#main').innerHTML = header('Leads', 'Enquiries from the website chat and quote form, customers from orders, and leads your team adds.',
      '<div class="seg" id="lview"><button data-v="list" class="' + (board ? '' : 'on') + '">List</button><button data-v="board" class="' + (board ? 'on' : '') + '">Board</button></div>' +
      '<a class="btn" href="' + API + '?action=leads&format=csv">Export CSV</a><button class="btn primary" id="addLead">+ Add lead</button>') +
      '<div class="row" style="margin-bottom:16px">' +
      (board ? '' : '<div class="seg" id="tabs">' + tabs.map(([v, label]) => '<button data-s="' + v + '" class="' + (v === st ? 'on' : '') + (v === 'due' && dueCount ? ' due' : '') + '">' + esc(label) + '</button>').join('') + '</div>') +
      '<span class="spacer"></span><input type="search" id="lq" placeholder="Search name, phone, interest…" value="' + esc(S.leadQ || '') + '" style="max-width:280px"></div>' +
      (board ? leadBoard(list) : list.length ? '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Contact</th><th>Interest</th><th>Status</th><th>Follow up</th><th>Assigned</th><th>Received</th></tr></thead><tbody>' +
        list.map((l) => '<tr class="click" data-id="' + l.id + '"><td><b>' + esc(l.name) + '</b><div class="small muted">' + esc(l.source) + '</div></td>' +
          '<td><div class="row" style="gap:8px;flex-wrap:nowrap"><span>' + esc(l.contact) + '</span>' + waBtn(l) + '</div></td>' +
          '<td class="small">' + esc(leadInterest(l)) + '</td><td>' + pill(LEAD_TONE, l.status) + '</td><td>' + followChip(l) + '</td>' +
          '<td>' + esc(l.assigned_name || '—') + '</td><td class="small muted">' + dateTime(l.created_at) + '</td></tr>').join('') +
        '</tbody></table></div>' : '<div class="card empty">' + (st === 'due' ? 'No follow-ups due. Nice work.' : 'No leads here.') + '</div>');
    $$('#tabs button').forEach((b) => b.onclick = () => { S.leadStatus = b.dataset.s; pageLeads(); });
    $$('#lview button').forEach((b) => b.onclick = () => { S.leadView = b.dataset.v; pageLeads(); });
    let t;
    $('#lq').oninput = (e) => {
      clearTimeout(t);
      t = setTimeout(() => { S.leadQ = e.target.value; pageLeads().then(() => { const i = $('#lq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 250);
    };
    $('#addLead').onclick = () => leadDrawer(null);
    $$('[data-id]').forEach((el) => el.onclick = (e) => { if (e.target.closest('a,button')) return; leadDrawer(d.leads.find((l) => l.id === +el.dataset.id)); });
    $$('[data-lmv]').forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try { await api('lead_move', { method: 'POST', body: { id: +b.dataset.lmv, status: b.dataset.to } }); toast('Moved to ' + b.dataset.to); pageLeads(); }
      catch (err) { toast(err.message, true); b.disabled = false; }
    });
    if (S.openLead) { const l = d.leads.find((x) => x.id === S.openLead); S.openLead = null; if (l) leadDrawer(l); }
  }

  // Pipeline view: one column per status, move leads along with the arrows.
  function leadBoard(list) {
    const sts = S.meta.leadStatuses;
    return '<div class="board" style="grid-template-columns:repeat(' + sts.length + ',minmax(230px,1fr))">' + sts.map((stName, si) => {
      const col = list.filter((l) => l.status === stName);
      const shown = col.slice(0, 40);
      return '<div class="bcol"><div class="bhead">' + pill(LEAD_TONE, stName) + '<span class="spacer"></span><span class="bcount">' + col.length + '</span></div>' +
        (col.length ? '' : '<div class="bempty">No leads</div>') +
        shown.map((l) => '<div class="bcard" data-id="' + l.id + '">' +
          '<div class="row"><b>' + esc(l.name) + '</b><span class="spacer"></span>' + (l.follow_up && stName !== 'Won' && stName !== 'Lost' ? followChip(l) : '') + '</div>' +
          '<div class="small muted" style="margin:3px 0 2px">' + esc(leadInterest(l) || l.source) + '</div>' +
          '<div class="small">' + esc(l.contact) + '</div>' +
          '<div class="row" style="margin-top:10px;gap:6px">' + waBtn(l) +
          (si > 0 ? '<button class="btn sm" data-lmv="' + l.id + '" data-to="' + sts[si - 1] + '" aria-label="Move back to ' + sts[si - 1] + '">←</button>' : '') +
          '<span class="spacer"></span>' + (si < sts.length - 1 ? '<button class="btn sm" data-lmv="' + l.id + '" data-to="' + sts[si + 1] + '">' + esc(sts[si + 1]) + ' →</button>' : '') + '</div></div>').join('') +
        (col.length > shown.length ? '<div class="small muted" style="padding:6px">+ ' + (col.length - shown.length) + ' more in the List view</div>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function leadDrawer(l) {
    const isNew = !l;
    l = l || { name: '', contact: '', cat: '', status: 'New', notes: '', assigned_to: '', follow_up: '' };
    const teamOpts = '<option value="">— Nobody —</option>' + S.team.filter((u) => u.active !== 0).map((u) => '<option value="' + u.id + '"' + (+l.assigned_to === u.id ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('');
    const phone = phoneOf(l.contact), email = emailOf(l.contact);
    const actions = isNew ? '' : '<div class="row lead-actions">' + waBtn(l, true) +
      (phone ? '<a class="btn sm" href="tel:' + esc(phone) + '">' + icon('phone') + 'Call</a>' : '') +
      (email ? '<a class="btn sm" href="mailto:' + esc(email) + '">' + icon('mail') + 'Email</a>' : '') +
      (can('sell') && l.status !== 'Won' ? '<span class="spacer"></span><button type="button" class="btn sm" id="mkQuote">' + icon('file') + 'Create quote</button><button type="button" class="btn sm dark" id="convert">' + icon('cart') + 'Convert to order</button>' : '') + '</div>';
    const body = '<form id="lf" class="stack">' +
      (isNew ? '<div class="grid2"><label class="field">Name<input type="text" name="name" required></label><label class="field">Email or phone<input type="text" name="contact" required></label></div>' +
        '<label class="field">Interested in<input type="text" name="cat" placeholder="e.g. NFC cards for 3 branches"></label>'
        : '<div class="card stack" style="gap:12px"><div class="grid2"><label class="field">Name<input type="text" name="name" required maxlength="120" value="' + esc(l.name) + '"></label>' +
          '<label class="field">Email or phone<input type="text" name="contact" required maxlength="160" value="' + esc(l.contact) + '"></label></div>' +
          '<label class="field">Interested in<input type="text" name="cat" maxlength="120" value="' + esc(leadInterest(l)) + '"></label>' +
          '<div class="small muted">' + esc(l.source) + ' · ' + dateTime(l.created_at) + '</div>' + actions + '</div>') +
      '<div class="grid2"><label class="field">Status<select name="status">' + S.meta.leadStatuses.map((x) => '<option value="' + x + '"' + (x === l.status ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></label>' +
      '<label class="field">Assigned to<select name="assigned_to">' + teamOpts + '</select></label></div>' +
      '<div class="field">Follow up on <span class="hint">It shows on the dashboard from that day until the lead is moved on or the date is cleared</span>' +
      '<div class="row"><input type="date" name="follow_up" id="fuDate" value="' + esc(l.follow_up || '') + '" style="max-width:180px">' +
      [['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7]].map(([t, n]) => '<button type="button" class="btn sm" data-fu-in="' + n + '">' + t + '</button>').join('') +
      '<button type="button" class="btn sm" data-fu-in="">Clear</button></div></div>' +
      '<label class="field">Notes<textarea name="notes" style="min-height:140px">' + esc(l.notes) + '</textarea></label></form>';
    openDrawer(isNew ? 'Add lead' : 'Lead', body, (isNew || !can('leads') ? '' : '<button class="btn danger" id="delLead">Delete</button>') + '<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" form="lf" type="submit">Save</button>');
    $$('#drawer [data-close]').forEach((b) => b.addEventListener('click', closeDrawer));
    $$('[data-fu-in]').forEach((b) => b.onclick = () => { $('#fuDate').value = b.dataset.fuIn === '' ? '' : addDays(+b.dataset.fuIn); });
    $('#lf').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api('lead_save', { method: 'POST', body: Object.assign({ id: l.id || 0 }, formData(e.target)) });
        closeDrawer();
        // A corrected name / phone / email is copied to that customer's orders.
        if (r.shipped && r.shipped.length) toast('Orders updated: ' + r.synced.join(', ') + '. ' + r.shipped.join(', ') + ' already has a Bosta shipment, so tell Bosta the new number.', true);
        else toast(r.synced && r.synced.length ? 'Lead saved · also updated ' + r.synced.join(', ') : 'Lead saved');
        if (S.route === 'leads') pageLeads(); else pageDashboard();
      } catch (err) { toast(err.message, true); }
    };
    const mq = $('#mkQuote');
    if (mq) mq.onclick = () => { closeDrawer(); newOrderDrawer({ mode: 'quote', leadId: l.id, name: l.name, phone: phone ? localPhone(phone) : '', email, interest: leadInterest(l), notes: 'Lead asked for: ' + leadInterest(l) }); };
    const cv = $('#convert');
    if (cv) cv.onclick = () => { closeDrawer(); newOrderDrawer({ leadId: l.id, name: l.name, phone: phone ? localPhone(phone) : '', email, interest: leadInterest(l) }); };
    const del = $('#delLead');
    if (del) del.onclick = async () => {
      if (!confirm('Delete this lead?')) return;
      try { await api('lead_delete', { method: 'POST', body: { id: l.id } }); closeDrawer(); toast('Lead deleted'); pageLeads(); }
      catch (err) { toast(err.message, true); }
    };
  }

  // ---------- settings: online payments check ----------
  async function pageSettings(test) {
    $('#main').innerHTML = header('Settings', 'Checks for the parts of the shop that are configured on the server.', '') + '<div class="card"><div class="muted small">Checking…</div></div>';
    let d;
    try { d = await api('paymob_status', { query: test ? '&test=1' : '' }); } catch (err) { $('#main').innerHTML += '<div class="err">' + esc(err.message) + '</div>'; return; }
    const ok = (b) => b ? '<span class="pill good">✓</span>' : '<span class="pill bad">✕</span>';
    const keyRow = (label, v) => '<div class="li"><span>' + label + '</span><span>' + (v === 'test' ? '<span class="pill warn">✓ Test key</span>' : v === 'live' ? '<span class="pill good">✓ Live key</span>' : v === 'set' ? '<span class="pill good">✓ Set</span>' : v === 'unrecognised' ? '<span class="pill bad">✕ Doesn’t look like a Paymob key</span>' : '<span class="pill bad">✕ Missing</span>') + '</span></div>';
    const problems = [];
    if (!d.fileFound) problems.push('The file api/config.local.php was not found on the server.');
    else if (!d.fileReturnsArray) problems.push('api/config.local.php has a typing error (a missing comma, quote or bracket), so none of its settings load. Check the last lines you added.');
    else if (!d.paymobBlock) problems.push(d.nestedIn ? 'The Paymob settings are inside the “' + d.nestedIn + '” block. Move them out: they must come after the “],” that closes ' + d.nestedIn + '.' : 'There is no “paymob” block in api/config.local.php. Found: ' + (d.topLevel.join(', ') || 'nothing') + '.');
    if (d.paymobBlock) {
      if (d.secretKey !== 'test' && d.secretKey !== 'live') problems.push('secret_key: copy the Secret Key (starts with egy_sk_) from Paymob → Settings → Account Info.');
      if (d.publicKey !== 'test' && d.publicKey !== 'live') problems.push('public_key: copy the Public Key (starts with egy_pk_).');
      if (d.hmac !== 'set') problems.push('hmac_secret: copy the HMAC from Paymob → Settings → Account Info.');
      if (d.secretKey !== d.publicKey && ['test', 'live'].includes(d.secretKey) && ['test', 'live'].includes(d.publicKey)) problems.push('One key is a test key and the other a live key — both must be test, or both live.');
      if (!d.cardId && !d.walletId) problems.push('card_integration_id is 0. Put the Online Card integration ID number (Paymob → Developers → Payment Integrations) — without quotes.');
      if (d.unknownNames.length) problems.push('Unrecognised setting name(s): ' + d.unknownNames.join(', ') + ' — check the spelling.');
      if (!problems.length && !d.phpLoaded) problems.push('The file is correct but the server still uses the old copy. Reload this page in a minute.');
    }
    $('#main').innerHTML = header('Settings', 'Checks for the parts of the shop that are configured on the server.', '') +
      '<div class="card stack" style="gap:14px"><h2>Online payments (Paymob)<span class="spacer"></span>' + (d.methodsOffered.length ? '<span class="pill good">✓ Active at checkout</span>' : '<span class="pill bad">✕ Not active</span>') + '</h2>' +
      '<div class="list">' +
        '<div class="li"><span>Settings file (api/config.local.php)</span><span>' + ok(d.fileFound && d.fileReturnsArray) + '</span></div>' +
        '<div class="li"><span>“paymob” block</span><span>' + ok(d.paymobBlock) + '</span></div>' +
        keyRow('Secret key', d.secretKey) + keyRow('Public key', d.publicKey) + keyRow('HMAC', d.hmac) +
        '<div class="li"><span>Card integration ID</span><span>' + (d.cardId ? '<b>' + d.cardId + '</b>' : '<span class="pill bad">✕ 0</span>') + '</span></div>' +
        '<div class="li"><span>Wallet integration ID</span><span>' + (d.walletId ? '<b>' + d.walletId + '</b>' : '<span class="muted">not set (wallets hidden)</span>') + '</span></div>' +
        '<div class="li"><span>Shown at checkout</span><span>' + (d.methodsOffered.length ? esc(d.methodsOffered.map((m) => m === 'paymob_card' ? 'Card' : 'Mobile wallet').join(' + ')) : '—') + '</span></div>' +
        (d.integrations && d.integrations.length ? d.integrations.map((m) => {
          const role = m.id === d.cardId ? 'Card ID' : m.id === d.walletId ? 'Wallet ID' : 'ID';
          const wrong = (m.id === d.walletId && /card|migs/i.test(m.type + ' ' + m.name)) || (m.id === d.cardId && /wallet/i.test(m.type + ' ' + m.name));
          return '<div class="li"><span>' + role + ' ' + m.id + '</span><span><span class="pill ' + (wrong ? 'bad' : 'good') + '">' + esc((m.name || m.type || 'unknown') + (m.type && m.name ? ' · ' + m.type : '')) + (m.live === false ? ' · TEST' : '') + '</span>' +
            (wrong ? '<div class="small" style="color:var(--bad)">This is not a ' + (m.id === d.walletId ? 'wallet' : 'card') + ' integration. Check the ID in config.local.php.</div>' : '') + '</span></div>';
        }).join('') : '') +
        (d.connection ? '<div class="li"><span>Connection to Paymob</span><span>' + (d.connection === 'ok' ? '<span class="pill good">✓ Keys accepted by Paymob</span>' : '<span class="pill bad">✕ ' + esc(d.connection) + '</span>') + '</span></div>' : '') +
      '</div>' +
      (problems.length ? '<div class="card" style="background:var(--bad-soft);border-color:#F0CFCF"><b>To fix</b><ul style="margin:8px 0 0;padding-left:18px;line-height:1.7">' + problems.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' : '') +
      '<div class="row"><button class="btn" id="psRe">Check again</button>' + (d.methodsOffered.length ? '<button class="btn primary" id="psTest">Test connection with Paymob</button>' : '') + '</div>' +
      '<div class="hint">Secret values are never shown here. The connection test asks Paymob to prepare a EGP 1 payment that nobody pays — nothing is charged.</div></div>';
    $('#psRe').onclick = () => pageSettings(false);
    const t = $('#psTest'); if (t) t.onclick = () => pageSettings(true);
    $('#main').insertAdjacentHTML('beforeend', '<div class="card stack" id="adTrack" style="gap:14px;margin-top:16px"><div class="muted small">Checking ad tracking…</div></div>' +
      '<div class="card stack" id="waSettings" style="gap:14px;margin-top:16px"><div class="muted small">Checking WhatsApp…</div></div>' +
      '<div class="card stack" id="smSettings" style="gap:14px;margin-top:16px" hidden></div>' +
      '<div class="card stack" id="botSettings" style="gap:14px;margin-top:16px"><div class="muted small">Loading the chat bot…</div></div>');
    adTrackCard();
    botSettings();
    waSettings(false);
    problemsCard();
  }

  // Settings → Problems: things that went wrong behind the scenes; the owners also get them on Telegram (api/alerts.php).
  async function problemsCard() {
    let box = $('#opsCard');
    if (!box) { $('#main').firstElementChild.insertAdjacentHTML('afterend', '<div class="card stack" id="opsCard" style="gap:12px;margin-bottom:16px"></div>'); box = $('#opsCard'); }
    let d;
    try { d = await api('ops_errors'); } catch (e) { box.remove(); return; }
    const list = d.problems;
    const recent = list.filter((p) => Date.now() - new Date(p.lastAt.replace(' ', 'T') + 'Z') < 7 * 86400000);
    box.innerHTML = '<h2>Problems<span class="spacer"></span>' + (recent.length ? '<span class="pill bad">' + recent.length + ' this week</span>' : '<span class="pill good">✓ Nothing wrong</span>') + '</h2>' +
      '<div class="hint">When something breaks behind the scenes (payments, Bosta, WhatsApp, emails, backups, ad tracking, the server), the owners get a Telegram message (an email if Telegram isn’t connected) — at most once an hour for the same problem. Send a screenshot of anything here you don’t understand.</div>' +
      (list.length ? '<div class="list">' + list.slice(0, 20).map((p) => '<div class="li" style="align-items:flex-start"><span><b>' + esc(p.area) + '</b> <span class="muted small">' + dateTime(p.lastAt) + (p.count > 1 ? ' · ' + p.count + '×' : '') + '</span><div class="small" style="margin-top:2px;word-break:break-word">' + esc(p.message) + '</div></span></div>').join('') + '</div>' +
        '<div class="row"><button class="btn sm" id="opsClear">Clear the list (fixed)</button></div>' : '');
    const c = $('#opsClear'); if (c) c.onclick = async () => { if (!confirm('Clear the problems list?')) return; try { await api('ops_clear', { method: 'POST' }); problemsCard(); toast('Cleared'); } catch (e) { toast(e.message, true); } };
  }

  // Settings → Ad tracking: Meta Pixel (browser), Conversions API (purchases sent from the server) and Google Analytics 4.
  async function adTrackCard() {
    const box = $('#adTrack'); if (!box) return;
    let d;
    try { d = await api('meta_status'); } catch (e) { box.innerHTML = '<h2>Ad tracking</h2><div class="err">' + esc(e.message) + '</div>'; return; }
    const on = (v, text) => v ? '<span class="pill good">✓ ' + esc(text) + '</span>' : '<span class="pill bad">✕ Not set</span>';
    box.innerHTML = '<h2>Ad tracking</h2>' +
      '<div class="list">' +
        '<div class="li"><span>Meta Pixel <small class="muted">(in the browser: views, add to cart, checkout, purchases, leads)</small></span><span>' + on(d.pixel, d.pixel) + '</span></div>' +
        '<div class="li"><span>Meta Conversions API <small class="muted">(purchases sent from our server)</small></span><span>' + on(d.capi, 'On') + (d.testCode ? ' <span class="pill warn">Test code on</span>' : '') + '</span></div>' +
        '<div class="li"><span>Google Analytics 4</span><span>' + on(d.ga4, d.ga4) + '</span></div>' +
        '<div class="li"><span>Purchases sent to Meta from the server</span><span><b>' + d.sent + '</b></span></div>' +
      '</div>' +
      (d.capi ? '<div class="row"><button class="btn" id="mtTest">Send a test event to Meta</button></div>' : '') +
      '<div class="hint">Set in api/config.local.php on the server: “meta” => [“pixel_id”, “capi_token”, “test_code”] and “ga4_id”. With a test code, server events appear in Meta Events Manager → Test events; remove it when done.' + (d.testCode ? ' <b>The test code is on — remove it once you’ve checked.</b>' : '') + '</div>';
    const t = $('#mtTest'); if (t) t.onclick = async () => { t.disabled = true; try { const r = await api('meta_test', { method: 'POST' }); toast('Meta received ' + r.received + ' test event' + (r.received === 1 ? '' : 's')); } catch (e) { toast(e.message, true); } t.disabled = false; };
  }

  // Settings → WhatsApp: connection, webhook address, who takes chats, how long videos are kept.
  // Settings → WhatsApp → Message templates: our templates with their status at Meta, and submitting them.
  async function waTemplatesCard(r) {
    let box = $('#waTpl');
    if (!box) { $('#waSettings').insertAdjacentHTML('afterend', '<div class="card stack" id="waTpl" style="gap:12px;margin-top:16px"></div>'); box = $('#waTpl'); }
    if (!r) {
      box.innerHTML = '<h2>Message templates</h2><div class="muted small">Asking Meta…</div>';
      try { r = await api('wa_templates_status'); } catch (e) { box.innerHTML = '<h2>Message templates</h2><div class="err">' + esc(e.message) + '</div>'; return; }
    }
    const tone = { APPROVED: ['good', '✓ Approved'], PENDING: ['warn', 'Waiting for Meta'], IN_APPEAL: ['warn', 'In appeal'], REJECTED: ['bad', '✕ Rejected'], PAUSED: ['bad', 'Paused'], DISABLED: ['bad', 'Disabled'], NOT_SUBMITTED: ['', 'Not submitted'] };
    const missing = r.templates.filter((t) => t.status === 'NOT_SUBMITTED').length;
    box.innerHTML = '<h2>Message templates<span class="spacer"></span><button class="btn sm" id="waTplRefresh">Check again</button></h2>' +
      '<div class="hint">After 24 hours without a message from the customer, WhatsApp only allows these pre-approved messages (inbox → Send a template). Meta reviews each one, usually within minutes to a day, and charges per template message (utility less than marketing).</div>' +
      '<div class="table-wrap"><table><thead><tr><th>Template</th><th>Language</th><th>Type</th><th>Status at Meta</th></tr></thead><tbody>' +
      r.templates.map((t) => { const [cls, label] = tone[t.status] || ['', t.status]; return '<tr title="' + esc(t.text) + '"><td>' + esc(t.title) + '</td><td>' + (t.lang === 'ar' ? 'عربي' : 'English') + '</td><td class="small muted">' + (t.category === 'MARKETING' ? 'Marketing' : 'Utility') + '</td><td><span class="pill ' + cls + '">' + esc(label) + '</span>' + (t.reason ? '<div class="small muted">' + esc(t.reason) + '</div>' : '') + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      (r.errors && r.errors.length ? '<div class="err">' + r.errors.map(esc).join('<br>') + '</div>' : '') +
      (missing ? '<div class="row"><button class="btn primary" id="waTplSubmit">Submit ' + missing + ' to Meta</button></div>' : '');
    $('#waTplRefresh').onclick = () => waTemplatesCard();
    const sb = $('#waTplSubmit'); if (sb) sb.onclick = async () => {
      sb.disabled = true; sb.textContent = 'Submitting…';
      try { const res = await api('wa_templates_submit', { method: 'POST' }); toast(res.sent ? 'Sent to Meta for review' : 'Nothing was sent'); waTemplatesCard(res); }
      catch (e) { toast(e.message, true); sb.disabled = false; }
    };
  }

  async function waSettings(test) {
    const box = $('#waSettings'); if (!box) return;
    let d;
    try { d = await api('wa_settings', { query: test ? '&test=1' : '' }); } catch (e) { box.innerHTML = '<div class="err">' + esc(e.message) + '</div>'; return; }
    const ok = (b) => b ? '<span class="pill good">✓</span>' : '<span class="pill bad">✕ Missing</span>';
    const mb = (b) => b == null ? '—' : b > 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : Math.round(b / 1048576) + ' MB';
    box.innerHTML = '<h2>WhatsApp<span class="spacer"></span>' + (d.ready ? '<span class="pill good">✓ Connected</span>' : '<span class="pill warn">Not connected yet</span>') + '</h2>' +
      '<div class="list">' +
        '<div class="li"><span>Access key (token)</span><span>' + ok(d.token) + '</span></div>' +
        '<div class="li"><span>Phone number ID</span><span>' + ok(d.phoneId) + '</span></div>' +
        '<div class="li"><span>App secret (checks that messages really come from Meta)</span><span>' + ok(d.appSecret) + '</span></div>' +
        '<div class="li"><span>Verify token (for the webhook)</span><span>' + ok(d.verifyToken) + '</span></div>' +
        (d.info ? '<div class="li"><span>Number</span><span><b dir="ltr">' + esc(d.info.display_phone_number || '') + '</b> · ' + esc(d.info.verified_name || '') + (d.info.quality_rating ? ' · quality ' + esc(d.info.quality_rating) : '') + '</span></div>' : '') +
        (d.error ? '<div class="li"><span>Connection</span><span class="pill bad">✕ ' + esc(d.error) + '</span></div>' : '') +
        '<div class="li"><span>Last message from Meta</span><span>' + (d.lastWebhook ? dateTime(d.lastWebhook) : '<span class="muted">none yet</span>') + '</span></div>' +
        // What happened to the last message: saved as a chat, a sample for another number, or an error.
        (d.lastNote ? '<div class="li"><span>Last message result · ' + dateTime(d.lastNote.at) + (d.lastNote.kind === 'other_number' ? '<div class="small muted">It was for another number' + (d.lastNote.number ? ' (' + esc(d.lastNote.number) + ')' : '') + ', like the sample from Meta’s Test button, so no chat was made. Send a real message to your business number.</div>' : d.lastNote.kind === 'error' ? '<div class="small muted">' + esc(d.lastNote.error || '') + '</div>' : '') + '</span>' +
          (d.lastNote.kind === 'saved' ? '<span class="pill good">✓ Saved as a chat</span>' : d.lastNote.kind === 'error' ? '<span class="pill bad">✕ Couldn’t save</span>' : '<span class="pill">Sample · skipped</span>') + '</div>' : '') +
        (d.lastRejected && (!d.lastWebhook || d.lastRejected > d.lastWebhook) ? '<div class="li"><span>Message from Meta rejected · ' + dateTime(d.lastRejected) + '<div class="small muted">Meta is sending, but the app secret in api/config.local.php doesn’t match: copy it again from App settings → Basic → App secret.</div></span><span class="pill bad">✕ App secret</span></div>' : '') +
        '<div class="li"><span>Webhook address (paste in Meta → WhatsApp → Configuration)</span><span><code dir="ltr">' + esc(d.webhook) + '</code> <button class="btn sm" id="waCopy">Copy</button></span></div>' +
      '</div>' +
      (d.live ? waLiveChecks(d) : '') +
      // Always there, like Paymob's: re-read the keys on the server, or ask Meta for the full go-live check.
      '<div class="row"><button class="btn" id="waRecheck">Check again</button>' +
        '<button class="btn primary" id="waTest"' + (d.token && d.phoneId ? '' : ' disabled title="Add the access key and phone number ID first"') + '>Test connection with WhatsApp</button></div>' +
      '<div class="hint"><span>' + (d.token && d.phoneId ? 'The test asks Meta about your number, access key and webhook. Nothing is sent to customers.'
        : 'Add the “whatsapp” block to api/config.local.php on the server (see config.local.example.php), then press Check again.') + '</span> <span>Secret values are never shown here.</span></div>' +
      '<h3 style="margin:6px 0 0">Who takes WhatsApp chats</h3><div class="hint">New chats go to these people in turn. “Away” skips someone (they can also switch it themselves in the inbox).</div>' +
      '<div class="table-wrap"><table><thead><tr><th>Team member</th><th>Role</th><th>Takes chats</th><th>Away</th><th>Telegram alerts</th></tr></thead><tbody>' +
        d.users.map((u) => '<tr><td>' + esc(u.name) + '</td><td class="small muted">' + esc(u.role) + '</td><td><input type="checkbox" data-agent="' + u.id + '"' + (u.agent ? ' checked' : '') + '></td><td><input type="checkbox" data-away="' + u.id + '"' + (u.away ? ' checked' : '') + '></td><td>' + (u.telegram ? '<span class="pill good">✓</span>' : '<span class="muted small">—</span>') + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<div class="hint">' + (d.telegram ? 'Telegram alerts: each person taps ✈️ Telegram in the WhatsApp inbox to connect their own phone.' : 'Telegram alerts are off: add the “telegram” bot token to api/config.local.php (see config.local.example.php).') + '</div>' +
      // The 15-minute "no reply" reminders need a cron job that runs every minute.
      (d.tgCron ? '<div class="list"><div class="li"><span>15-minute reminders · cPanel → Cron Jobs, every minute (* * * * *)<div class="small muted">' +
        (d.tgLastCron ? '<span>Last run:</span> ' + dateTime(d.tgLastCron) : 'Not running yet. Until it is, reminders only go out while someone has the dashboard open or new WhatsApp messages arrive.') + '</div></span>' +
        '<span><code dir="ltr" class="small">curl -s "' + esc(d.tgCron) + '"</code> <button class="btn sm" id="tgCronCopy">Copy</button></span></div></div>' : '') +
      (d.telegram ? '<label class="row small"><input type="checkbox" id="tgMgr"' + (d.tgRemindManagers ? ' checked' : '') + '> <span>Owners and managers also get the 15-minute reminders for everyone’s chats</span></label>' +
        '<div class="row small"><label class="row"><input type="checkbox" id="tgDaily"' + (d.tgDaily ? ' checked' : '') + '> <span>Daily summary on Telegram at 9 pm to owners and managers (sales, payments, chats, reply times, who is waiting)</span></label>' +
        '<button class="btn sm" id="tgDailyTest">Send it to me now</button></div>' : '') +
      '<div class="grid2"><label class="field">Keep videos for (days) <span class="hint">0 = keep forever. Photos, voice notes and documents are always kept.</span><input type="number" id="waDays" min="0" max="3650" value="' + d.videoDays + '"></label>' +
        '<div class="field"><span>Space used by chat files</span><b>' + mb(d.storage) + '</b><span class="hint">' + (d.diskFree ? mb(d.diskFree) + ' free on the server · ' : '') + d.chats + ' chats</span></div></div>' +
      '<div class="row"><button class="btn primary" id="waSave">Save WhatsApp settings</button></div>';
    $('#waCopy').onclick = () => { navigator.clipboard.writeText(d.webhook).then(() => toast('Copied')); };
    const dt = $('#tgDailyTest'); if (dt) dt.onclick = async () => { dt.disabled = true; try { await api('tg_daily_test', { method: 'POST' }); toast('Sent — check Telegram'); } catch (e) { toast(e.message, true); } dt.disabled = false; };
    const cc = $('#tgCronCopy'); if (cc) cc.onclick = () => { navigator.clipboard.writeText('curl -s "' + d.tgCron + '" > /dev/null').then(() => toast('Copied')); };
    const tb = $('#waTest'); if (tb) tb.onclick = async () => { tb.disabled = true; tb.textContent = 'Checking…'; await waSettings(true); };
    $('#waRecheck').onclick = async () => { await waSettings(!!d.live); toast('Checked'); };
    const rg = $('#waReg'); if (rg) rg.onclick = async () => {
      try { await api('wa_register', { method: 'POST', body: { pin: $('#waPin').value } }); toast('Number registered'); waSettings(true); } catch (e) { toast(e.message, true); }
    };
    $$('[data-sub]').forEach((b) => b.onclick = async () => {
      try { await api('wa_subscribe', { method: 'POST', body: { waba: b.dataset.sub } }); toast('Webhook connected'); waSettings(true); } catch (e) { toast(e.message, true); }
    });
    waTemplatesCard();
    smSettings(d.social, !!d.live);
    $('#waSave').onclick = async () => {
      const agents = d.users.map((u) => ({ id: u.id, agent: $('[data-agent="' + u.id + '"]').checked, away: $('[data-away="' + u.id + '"]').checked }));
      try { await api('wa_settings_save', { method: 'POST', body: { agents, video_days: +$('#waDays').value, tg_remind_managers: $('#tgMgr') ? ($('#tgMgr').checked ? 1 : 0) : undefined, tg_daily: $('#tgDaily') ? ($('#tgDaily').checked ? 1 : 0) : undefined } }); toast('WhatsApp settings saved'); }
      catch (e) { toast(e.message, true); }
    };
  }

  // Settings → Chat bot (api/bot.php): the menu customers get, each choice's answer, when it hands the
  // chat to the team, and Try it (a pretend chat that sends nothing, with what's on the page, saved or not).
  async function botSettings(d) {
    const box = $('#botSettings'); if (!box) return;
    if (!d) { try { d = await api('bot_settings'); } catch (e) { box.innerHTML = '<h2>Chat bot</h2><div class="err">' + esc(e.message) + '</div>'; return; } }
    const c = JSON.parse(JSON.stringify(d.cfg));
    const LANGS = [['ar', 'Arabic'], ['en', 'English']];
    const two = (key, label, rows) => '<div class="grid2">' + LANGS.map(([l, name]) => '<label class="field"><span><span>' + label + '</span> · <span>' + name + '</span></span>' +
      (rows ? '<textarea rows="' + rows + '" data-two="' + key + '" data-l="' + l + '" dir="' + (l === 'ar' ? 'rtl' : 'ltr') + '">' + esc(c[key][l]) + '</textarea>'
        : '<input type="text" data-two="' + key + '" data-l="' + l + '" maxlength="20" dir="' + (l === 'ar' ? 'rtl' : 'ltr') + '" value="' + esc(c[key][l]) + '">') + '</label>').join('') + '</div>';
    const prodOpts = (sel) => '<option value="">—</option>' + d.products.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === sel ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
    box.innerHTML = '<h2>Chat bot<span class="spacer"></span>' + (d.cfg.on ? '<span class="pill good">✓ On</span>' : '<span class="pill">Off</span>') + '</h2>' +
      '<div class="hint">Answers new WhatsApp, Instagram and Messenger chats with a menu and your ready answers, so the team only gets the chats that need a person. It hands a chat to the team when the customer picks “Talk to us”, sends a voice note or photo, uses words like “complaint”, or isn’t understood twice. While the bot has a chat it isn’t waiting and nobody is alerted (inbox → 🤖 Bot).</div>' +
      (d.week.chats ? '<div class="small"><span>Last 7 days:</span> <b>' + d.week.chats + '</b> <span>chats answered by the bot</span> · <b>' + d.week.handover + '</b> <span>handed to the team</span></div>' : '') +
      '<label class="row"><input type="checkbox" id="botOn"' + (c.on ? ' checked' : '') + '> <b>The bot answers new chats</b></label>' +
      '<div class="row small">' + [['wa', 'WhatsApp'], ['ig', 'Instagram'], ['fb', 'Messenger']].map(([k, n]) => '<label class="row">' + smLogo(k) + '<input type="checkbox" data-bch="' + k + '"' + (c.channels[k] ? ' checked' : '') + '> <span>' + n + '</span></label>').join('') + '</div>' +
      '<h3 style="margin:6px 0 0">First message</h3>' + two('welcome', 'Welcome', 3) + two('menu', 'Menu button (WhatsApp)', 0) +
      '<h3 style="margin:6px 0 0">Menu</h3><div class="hint"><span>Each item is a button (up to 20 characters, Instagram’s limit). Keywords catch the same question when it’s typed instead.</span> <span>{prices:nfc,stands} becomes today’s prices of those categories, {shop} the shop’s link.</span> <span>Categories:</span> <code>' + esc(d.cats.join(', ')) + '</code></div>' +
      '<div class="stack" id="botItems" style="gap:10px"></div><div class="row"><button class="btn sm" id="botAdd">+ Add an item</button></div>' +
      '<h3 style="margin:6px 0 0">Handing to the team</h3>' + two('retry', 'When the bot didn’t understand', 2) + two('handover', 'When it hands the chat to the team', 2) +
      '<label class="field"><span>Words that call a person (comma between them)</span><input type="text" id="botHuman" value="' + esc(c.human_words) + '"></label>' +
      '<div class="grid2"><label class="field"><span>Hand over after this many messages it didn’t understand</span><input type="number" id="botFails" min="1" max="5" value="' + c.fails + '"></label>' +
        '<label class="field"><span>Bot stays quiet after someone from the team writes (hours)</span><input type="number" id="botPause" min="1" max="72" value="' + c.pause_hours + '"></label></div>' +
      (d.ads.length ? '<h3 style="margin:6px 0 0">Ads</h3><div class="hint">A chat that comes from an ad starts with the ad’s product (photo, price, order link), then the menu.</div>' +
        '<div class="table-wrap"><table><thead><tr><th>Ad</th><th>Chats</th><th>Product</th></tr></thead><tbody>' +
        d.ads.map((a) => '<tr><td>' + esc(a.headline || a.id) + '<div class="small muted" dir="ltr">' + esc(a.id) + '</div></td><td>' + a.chats + '</td><td><select data-ad="' + esc(a.id) + '">' + prodOpts(c.ads[a.id] || '') + '</select></td></tr>').join('') + '</tbody></table></div>' : '') +
      '<div class="row"><button class="btn primary" id="botSave">Save the chat bot</button><button class="btn" id="botReset">Start from the suggested texts</button></div>' +
      '<h3 style="margin:6px 0 0">Try it</h3><div class="hint">Write like a customer. Nothing is sent to anyone; it uses what’s on this page, saved or not.</div>' +
      '<div class="bot-try"><div class="bot-msgs" id="botMsgs"></div><form class="row" id="botTryF"><select id="botTryCh"><option value="wa">WhatsApp</option><option value="ig">Instagram</option></select>' +
        '<input type="text" id="botTryT" placeholder="e.g. بكام الكارت؟" style="flex:1;min-width:0"><button class="btn primary">Send</button><button type="button" class="btn" id="botTryNew">Start over</button></form></div>';
    const drawItems = () => {
      $('#botItems').innerHTML = c.items.map((it, i) => '<div class="bot-item" data-i="' + i + '">' +
        '<div class="row"><b>' + (i + 1) + '</b><select data-f="action"><option value="answer"' + (it.action !== 'human' ? ' selected' : '') + '>Sends the answer</option><option value="human"' + (it.action === 'human' ? ' selected' : '') + '>Hands the chat to the team</option></select>' +
          '<span class="spacer"></span><button type="button" class="btn sm" data-mv="-1"' + (i ? '' : ' disabled') + ' aria-label="Up">↑</button><button type="button" class="btn sm" data-mv="1"' + (i < c.items.length - 1 ? '' : ' disabled') + ' aria-label="Down">↓</button><button type="button" class="btn sm" data-rm aria-label="Remove">✕</button></div>' +
        '<div class="grid2">' + LANGS.map(([l, name]) => '<label class="field"><span><span>Button</span> · <span>' + name + '</span></span><input type="text" data-f="title.' + l + '" maxlength="' + d.titleMax + '" dir="' + (l === 'ar' ? 'rtl' : 'ltr') + '" value="' + esc(it.title[l] || '') + '"></label>').join('') + '</div>' +
        '<div class="grid2">' + LANGS.map(([l, name]) => '<label class="field"><span><span>' + (it.action === 'human' ? 'Message before handing over (optional)' : 'Answer') + '</span> · <span>' + name + '</span></span><textarea rows="4" data-f="answer.' + l + '" dir="' + (l === 'ar' ? 'rtl' : 'ltr') + '">' + esc(it.answer[l] || '') + '</textarea></label>').join('') + '</div>' +
        '<label class="field"><span>Keywords (comma between them)</span><input type="text" data-f="keywords" value="' + esc(it.keywords || '') + '"></label></div>').join('');
      $('#botAdd').disabled = c.items.length >= d.maxItems;
      $$('#botItems .bot-item').forEach((el) => {
        const it = c.items[+el.dataset.i];
        $$('[data-f]', el).forEach((f) => f.oninput = f.onchange = () => {
          const [k, l] = f.dataset.f.split('.');
          if (l) it[k][l] = f.value; else it[k] = f.value;
          if (k === 'action') drawItems();
        });
        $$('[data-mv]', el).forEach((b) => b.onclick = () => { const i = +el.dataset.i, j = i + +b.dataset.mv; [c.items[i], c.items[j]] = [c.items[j], c.items[i]]; drawItems(); });
        $('[data-rm]', el).onclick = () => { c.items.splice(+el.dataset.i, 1); drawItems(); };
      });
    };
    drawItems();
    $('#botAdd').onclick = () => { c.items.push({ id: '', action: 'answer', title: { ar: '', en: '' }, answer: { ar: '', en: '' }, keywords: '' }); drawItems(); };
    const collect = () => {
      c.on = $('#botOn').checked;
      $$('[data-bch]', box).forEach((x) => c.channels[x.dataset.bch] = x.checked);
      $$('[data-two]', box).forEach((x) => c[x.dataset.two][x.dataset.l] = x.value);
      c.human_words = $('#botHuman').value; c.fails = +$('#botFails').value; c.pause_hours = +$('#botPause').value;
      $$('[data-ad]', box).forEach((x) => { if (x.value) c.ads[x.dataset.ad] = x.value; else delete c.ads[x.dataset.ad]; });
      return c;
    };
    $('#botSave').onclick = async () => {
      try { const r = await api('bot_save', { method: 'POST', body: collect() }); toast(r.cfg.on ? 'Chat bot saved · it answers new chats now' : 'Chat bot saved · it’s off'); botSettings(r); }
      catch (e) { toast(e.message, true); }
    };
    $('#botReset').onclick = () => {
      if (!confirm('Put back the suggested texts and menu? Your changes on this page are replaced (nothing is saved until you press Save).')) return;
      botSettings(Object.assign({}, d, { cfg: Object.assign({}, d.defaults, { on: $('#botOn').checked, ads: c.ads }) }));
    };
    // Try it: a pretend chat with its own state (a new conversation, failed guesses, the menu's language).
    let t = { fresh: true, fails: 0, lang: '', human: false };
    const msgs = $('#botMsgs');
    const say = (who, html) => { msgs.insertAdjacentHTML('beforeend', '<div class="bot-b ' + who + '">' + html + '</div>'); msgs.scrollTop = msgs.scrollHeight; };
    const NOTE = { handover: 'Handed to the team: the chat now waits for a person, who gets the Telegram alert.', ignore: 'No reply needed (a thank-you or a sticker).', none: 'The bot doesn’t answer this.' };
    const send = async (text, tap) => {
      say('in', '<div class="wa-text">' + esc(text) + '</div>');
      if (t.human) { say('note', '<span>The team has this chat now, so the bot stays quiet.</span>'); return; }
      let r;
      try { r = await api('bot_try', { method: 'POST', body: { cfg: collect(), text, tap: tap || '', fresh: t.fresh ? 1 : 0, fails: t.fails, lang: t.lang, channel: $('#botTryCh').value } }); }
      catch (e) { say('note', esc(e.message)); return; }
      if (r.text) say('out', '<div class="wa-text">' + waLink(r.text) + '</div>' + (r.menu.length ? '<div class="bot-menu">' + r.menu.map((m) => '<button type="button" class="btn sm" data-tap="' + esc(m.id) + '">' + esc(m.title) + '</button>').join('') + '</div>' : ''));
      if (NOTE[r.do]) say('note', '<span>' + NOTE[r.do] + '</span>');
      if (r.do !== 'none') { t.fresh = false; t.fails = r.fails; t.lang = r.lang; t.human = r.do === 'handover'; }
      $$('[data-tap]', msgs).forEach((b) => b.onclick = () => send(b.textContent, b.dataset.tap));
    };
    $('#botTryF').onsubmit = (e) => { e.preventDefault(); const v = $('#botTryT').value.trim(); if (!v) return; $('#botTryT').value = ''; send(v); };
    $('#botTryNew').onclick = () => { t = { fresh: true, fails: 0, lang: '', human: false }; msgs.innerHTML = ''; };
  }

  // Instagram Direct and Messenger in the same inbox (api/social.php): what's set up, and the steps left.
  function smSettings(s, live) {
    const box = $('#smSettings'); if (!box || !s) return;
    box.hidden = false;
    const ok = (b) => b ? '<span class="pill good">✓</span>' : '<span class="pill bad">✕ Missing</span>';
    const step = (okv, title, todo) => '<div class="li" style="align-items:flex-start"><span><b>' + (okv ? '✓ ' : okv === false ? '✕ ' : '• ') + esc(title) + '</b>' + (okv ? '' : '<div class="small muted" style="margin-top:3px">' + todo + '</div>') + '</span>' +
      '<span>' + (okv ? '<span class="pill good">Done</span>' : okv === false ? '<span class="pill bad">To do</span>' : '<span class="pill">Check</span>') + '</span></div>';
    const note = s.lastNote;
    box.innerHTML = '<h2 class="row" style="gap:8px">' + smLogo('ig') + smLogo('fb') + '<span>Instagram &amp; Messenger</span><span class="spacer"></span>' + (s.ready ? '<span class="pill good">✓ Connected</span>' : '<span class="pill warn">Not connected yet</span>') + '</h2>' +
      '<div class="hint">Instagram Direct messages and Facebook Messenger chats come into the same Chats page as WhatsApp, each marked with its app’s logo. They’re handed out, timed and alerted on Telegram just like WhatsApp chats.</div>' +
      '<div class="list">' +
        '<div class="li"><span>Facebook Page ID</span><span>' + ok(s.pageId) + '</span></div>' +
        '<div class="li"><span>Page access key (token)</span><span>' + ok(s.pageToken) + '</span></div>' +
        '<div class="li"><span>App secret (WhatsApp’s, unless the Page uses another Meta app)</span><span>' + ok(s.appSecret) + '</span></div>' +
        (s.page ? '<div class="li"><span>Page</span><span><b>' + esc(s.page) + '</b></span></div>' : '') +
        // The key's own permissions, from Meta: names exactly what to tick when generating it again.
        (s.token ? '<div class="li" style="align-items:flex-start"><span>Access key permissions' + (s.token.app ? ' <span class="small muted">· app ' + esc(s.token.app) + '</span>' : '') +
          (s.token.missing.length ? '<div class="small err" style="margin-top:3px">Missing: <b>' + s.token.missing.map(esc).join(', ') + '</b>. Generate the token again with these ticked (add them to the app first if they aren’t in the list).</div>' : '') +
          (!s.token.pageAllowed ? '<div class="small err" style="margin-top:3px">This key can’t message this Page: give the system user the Page (Assign assets → Pages → Full control) and generate it again.</div>' : '') +
          (s.token.expires ? '<div class="small muted" style="margin-top:3px">Expires ' + esc(new Date(s.token.expires * 1000).toLocaleString(LOC)) + ' — choose “Never” when generating it.</div>' : '') + '</span>' +
          '<span>' + (s.token.valid && !s.token.missing.length && s.token.pageAllowed ? '<span class="pill good">✓ All set</span>' : '<span class="pill bad">✕ Fix</span>') + '</span></div>' : '') +
        (live && s.ready ? '<div class="li"><span>Instagram account linked to the Page</span><span>' + (s.instagram ? '<b dir="ltr">@' + esc(s.instagram) + '</b>' : '<span class="pill bad">✕ None</span>') + '</span></div>' : '') +
        // Meta's errors can be long: shown under the label, wrapping, instead of in a one-line pill.
        s.errors.map((e) => '<div class="li" style="align-items:flex-start"><span>Connection<div class="small err" style="margin-top:3px;overflow-wrap:anywhere">' + esc(e) + '</div></span><span class="pill bad">✕</span></div>').join('') +
        '<div class="li"><span>Last message from Instagram or Messenger</span><span>' + (s.lastWebhook ? dateTime(s.lastWebhook) : '<span class="muted">none yet</span>') + '</span></div>' +
        (note ? '<div class="li"><span>Last message result · ' + dateTime(note.at) + (note.kind === 'error' ? '<div class="small muted">' + esc(note.error || '') + '</div>' : '') + '</span>' +
          (note.kind === 'saved' ? '<span class="pill good">✓ Saved · ' + esc(SM_NAME[note.channel] || '') + '</span>' : '<span class="pill bad">✕ Couldn’t save</span>') + '</div>' : '') +
        '<div class="li"><span>Chats so far</span><span>' + smLogo('ig') + ' ' + s.chats.ig + ' · ' + smLogo('fb') + ' ' + s.chats.fb + '</span></div>' +
      '</div>' +
      (live && s.ready ? '<h3 style="margin:10px 0 0">Go-live checklist</h3><div class="list">' +
        step(s.token ? s.token.valid && s.token.pageAllowed : s.page != null, 'Meta accepts the Page ID and access key', 'Check page_id and page_token in the “social” block of api/config.local.php.') +
        step(s.instagram ? true : false, 'Your Instagram account is linked to the Page', 'In the Instagram app: Settings → Account type and tools → switch to a Professional (Business) account, then Meta Business Suite → Settings → Instagram → Connect account, choosing this Page. Also turn on Instagram → Settings → Messages and story replies → Message controls → Connected tools → Allow access to messages.') +
        step(s.subscribed, 'Messages are sent to this dashboard', 'Press Connect. Also check Meta for Developers → your app → Webhooks: “Page” and “Instagram” both use the address below with the WhatsApp verify token, with “messages” ticked.' +
          '<div class="row" style="margin-top:6px"><button class="btn sm" id="smSub">Connect</button></div>') +
        step(s.lastWebhook ? true : null, 'A real message arrived', 'Message the Page on Messenger and the Instagram account from your own phone, then press Check again. They should appear in Chats with their logos.') +
      '</div>' : '') +
      '<div class="list"><div class="li"><span>Webhook address (Meta → your app → Webhooks → Page and Instagram)</span><span><code dir="ltr">' + esc(s.webhook) + '</code></span></div></div>' +
      '<div class="row"><button class="btn" id="smTest"' + (s.ready ? '' : ' disabled title="Add the Page ID and access key first"') + '>Test Instagram &amp; Messenger</button></div>' +
      '<div class="hint">' + (s.ready ? 'The test asks Meta about your Page, Instagram account and webhook. Nothing is sent to customers.'
        : 'Add the “social” block to api/config.local.php on the server (see config.local.example.php): the Page ID and a Page access key with pages_messaging, pages_manage_metadata, instagram_basic and instagram_manage_messages. Meta must approve the app for these before customers’ messages arrive.') + '</div>';
    const t = $('#smTest'); if (t) t.onclick = async () => { t.disabled = true; t.textContent = 'Checking…'; await waSettings(true); };
    const sb = $('#smSub'); if (sb) sb.onclick = async () => { sb.disabled = true; try { await api('sm_subscribe', { method: 'POST' }); toast('Connected'); await waSettings(true); } catch (e) { toast(e.message, true); sb.disabled = false; } };
  }

  // What still stands between the number and real customer chats, in order, each with what to do.
  function waLiveChecks(d) {
    const L = d.live, n = L.number || {}, t = L.token;
    const step = (okv, title, todo) => '<div class="li" style="align-items:flex-start"><span><b>' + (okv ? '✓ ' : okv === false ? '✕ ' : '• ') + esc(title) + '</b>' + (okv ? '' : '<div class="small muted" style="margin-top:3px">' + todo + '</div>') + '</span>' +
      '<span>' + (okv ? '<span class="pill good">Done</span>' : okv === false ? '<span class="pill bad">To do</span>' : '<span class="pill">Check</span>') + '</span></div>';
    // Only the WhatsApp account that holds the number matters; if we couldn't tell which, show them all.
    const wabas = Object.entries(L.wabas || {}).filter(([id]) => !L.owner || id === L.owner);
    const registered = n.status === 'CONNECTED' || n.platform_type === 'CLOUD_API';
    return '<h3 style="margin:10px 0 0">Go-live checklist</h3><div class="list">' +
      step(!!n.display_phone_number, 'Meta accepts the access key and phone number ID', 'Check the token and phone_number_id in api/config.local.php.') +
      step(t ? t.valid && !t.expires : null, 'The access key never expires', t && t.expires ? 'This key expires ' + esc(new Date(t.expires * 1000).toLocaleString(LOC)) + '. Make a permanent one: Business settings → System users → Generate token (whatsapp_business_messaging + whatsapp_business_management), then replace it in api/config.local.php.' : 'Couldn’t read the key’s details.') +
      step(n.display_phone_number ? !/^\+?1[\s-]?555/.test(n.display_phone_number) && n.account_mode !== 'SANDBOX' : null, 'Your own number (not Meta’s test number)', 'You’re on Meta’s test number. Add your real number in WhatsApp Manager → Phone numbers, then put its Phone number ID in api/config.local.php.') +
      step(n.display_phone_number ? registered : null, 'The number is registered with the WhatsApp API',
        'Enter the number’s six-digit two-step PIN (set it in WhatsApp Manager → Phone numbers → Two-step verification if you never did) and press Register.' +
        '<div class="row" style="margin-top:6px"><input id="waPin" inputmode="numeric" maxlength="6" placeholder="6-digit PIN" style="width:130px"><button class="btn sm" id="waReg">Register</button></div>') +
      step(n.name_status ? n.name_status === 'APPROVED' || n.name_status === 'AVAILABLE_WITHOUT_REVIEW' : null, 'Display name approved' + (n.verified_name ? ' (' + esc(n.verified_name) + ')' : ''), 'Status: ' + esc(n.name_status || 'unknown') + '. Meta reviews it, usually within a day or two; until then you can still chat but sending may be limited.') +
      (L.owner === null && wabas.length ? step(false, 'Couldn’t find the WhatsApp account that holds your number', 'In WhatsApp Manager, open the account that has your number, copy its ID, and put it in api/config.local.php as ’waba_id’. Then press Check again.') : '') +
      (wabas.length ? wabas.map(([id, on]) => step(on, 'Messages are sent to this dashboard (webhook connected to WhatsApp account ' + id + (L.owner === id ? ', which holds your number' : '') + ')',
        'Press Connect. Also check Meta → your app → WhatsApp → Configuration: callback URL and verify token saved, and “messages” subscribed.' +
        '<div class="row" style="margin-top:6px"><button class="btn sm" data-sub="' + esc(id) + '">Connect</button></div>')).join('')
        : step(null, 'Webhook connected', 'Couldn’t find the WhatsApp account ID from the access key. Add ’waba_id’ (WhatsApp Manager → Account tools → WhatsApp account ID) to the whatsapp block in api/config.local.php.')) +
      step(d.lastWebhook ? true : null, 'A real message arrived', 'Send a WhatsApp message to the business number from your own phone, then press Check again. It should also appear in the WhatsApp inbox.') +
      '</div>';
  }

  // ---------- partner brands ----------
  // Brands that supply products we sell under their logo; we keep a commission on each sale.
  const brandChip = (id) => { const b = (S.brands || []).find((x) => x.id === id); return b ? ' <span class="pill brand-pill">' + (b.logo ? '<img src="../' + esc(b.logo) + '" alt="">' : '★ ') + esc(b.name) + '</span>' : ''; };
  const monthLabel = (m) => new Date(m + '-01T00:00:00').toLocaleDateString(LOC, { month: 'long', year: 'numeric' });
  const lastMonths = (n) => Array.from({ length: n }, (_, i) => { const x = new Date(); x.setDate(1); x.setMonth(x.getMonth() - i); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'); });

  // ---------- expenses & suppliers ----------
  // Money going out: everyday costs, and suppliers' bills (owed) and payments (paid in parts or in full).
  async function pageExpenses() {
    const d = await api('expenses', { query: '&month=' + (S.expMonth || '') });
    S.expMonth = d.month; S.exp = d;
    const tab = S.expTab || 'expenses';
    const maxCat = Math.max(1, ...d.byCategory.map((c) => c.amount));
    $('#main').innerHTML = header('Expenses & suppliers', 'Write down what you pay — Bosta, packaging, transport, suppliers — and what you still owe your suppliers.',
      '<select id="xMonth" style="width:auto">' + lastMonths(12).map((m) => '<option value="' + m + '"' + (m === d.month ? ' selected' : '') + '>' + esc(monthLabel(m)) + '</option>').join('') + '</select>' +
      '<button class="btn" id="xCsv">' + icon('download') + 'Download sheet</button><button class="btn primary" id="xAdd">+ Add expense</button>') +
      '<div class="kpis">' + kpi('Spent this month', egp(d.total), d.expenses.length + (d.expenses.length === 1 ? ' entry' : ' entries')) +
        kpi('Sales this month', egp(d.sales), 'orders placed, without cancelled & returned') +
        kpi('Left after expenses', egp(d.net), 'sales − expenses') +
        kpi('Owed to suppliers', egp(d.owed), d.paidSuppliers ? 'paid ' + egp(d.paidSuppliers) + ' this month' : 'all time') + '</div>' +
      (d.byCategory.length ? '<div class="card"><h2>Where the money went · ' + esc(monthLabel(d.month)) + '</h2>' + d.byCategory.map((c) =>
        '<div class="hbar money"><span>' + esc(c.category) + '</span><div class="track"><div class="fill" style="width:' + (c.amount / maxCat * 100) + '%"></div></div><span class="num">' + egp(c.amount) + '</span></div>').join('') + '</div>' : '') +
      '<div class="row" style="margin:16px 0 12px"><div class="seg" id="xTabs"><button data-t="expenses" class="' + (tab === 'expenses' ? 'on' : '') + '">Expenses</button><button data-t="suppliers" class="' + (tab === 'suppliers' ? 'on' : '') + '">Suppliers <span class="seg-n">' + d.suppliers.length + '</span></button></div>' +
        '<span class="spacer"></span>' + (tab === 'suppliers' ? '<button class="btn" id="xSup">+ Add supplier</button>' : '') + '</div>' +
      (tab === 'expenses'
        ? (d.expenses.length ? '<div class="card"><div class="table-wrap" style="border:none"><table><thead><tr><th>Date</th><th>For</th><th>Details</th><th class="num">Amount</th><th></th></tr></thead><tbody>' +
          d.expenses.map((e) => '<tr><td class="small">' + esc(dayLabel(e.on)) + '</td><td><b>' + esc(e.category) + '</b></td><td class="small">' + esc(e.note || '') +
            (e.supplier ? '<div class="muted">Supplier: ' + esc(e.supplier) + '</div>' : '') + (e.order ? '<div class="muted">Order ' + esc(e.order) + '</div>' : '') + (e.by ? '<div class="muted">by ' + esc(e.by) + '</div>' : '') + '</td>' +
            '<td class="num"><b>' + egp(e.amount) + '</b></td><td class="num" style="white-space:nowrap"><button class="btn sm" data-xe="' + e.id + '">Edit</button> <button class="btn sm danger" data-xd="' + e.id + '">Delete</button></td></tr>').join('') +
          '</tbody></table></div></div>' : '<div class="card empty">Nothing written down for ' + esc(monthLabel(d.month)) + ' yet. Press “Add expense”.</div>')
        : (d.suppliers.length ? '<div class="brand-grid">' + d.suppliers.map((s) => '<div class="card' + (s.active ? '' : ' off') + '"><div class="row"><span style="flex:1;min-width:0"><b>' + esc(s.name) + '</b>' +
            '<div class="small muted">' + esc(s.makes || '') + (s.phone ? ' · <span dir="ltr">' + esc(s.phone) + '</span>' : '') + '</div></span>' + (s.active ? '' : '<span class="pill">Not used now</span>') + '</div>' +
            '<div class="brand-nums"><div><span class="small muted">Billed (all time)</span><b>' + egp(s.billed) + '</b><span class="small muted">' + (s.monthBilled ? egp(s.monthBilled) + ' this month' : '&nbsp;') + '</span></div>' +
              '<div><span class="small muted">Paid</span><b>' + egp(s.paid) + '</b><span class="small muted">&nbsp;</span></div>' +
              '<div><span class="small muted">' + (s.balance < 0 ? 'Paid in advance' : 'Still owed') + '</span><b class="' + (s.balance > 0 ? 'pay-part' : 'pay-ok') + '">' + egp(Math.abs(s.balance)) + '</b><span class="small muted">' + (s.balance > 0 ? 'to pay' : 'all settled') + '</span></div></div>' +
            '<div class="row"><button class="btn sm" data-sb="' + s.id + '">+ Bill</button><button class="btn sm primary" data-sp="' + s.id + '">Pay</button><button class="btn sm" data-ss="' + s.id + '">Statement</button><span class="spacer"></span><button class="btn sm" data-se="' + s.id + '">Edit</button></div></div>').join('') + '</div>'
          : '<div class="card empty">No suppliers yet. Add the people who print and produce for you, then record their bills and what you pay them.</div>')) +
      '<p class="small muted" style="margin-top:14px">A supplier’s bill counts as an expense in the month of the bill; paying it only lowers what you owe (it isn’t counted twice). “Left after expenses” is a quick cash view: this month’s sales minus this month’s expenses.</p>';
    $('#xMonth').onchange = (e) => { S.expMonth = e.target.value; pageExpenses(); };
    $$('#xTabs button').forEach((b) => b.onclick = () => { S.expTab = b.dataset.t; pageExpenses(); });
    $('#xAdd').onclick = () => expenseDrawer(null);
    $('#xCsv').onclick = () => expensesSheet(d);
    const xs = $('#xSup'); if (xs) xs.onclick = () => supplierDrawer(null);
    $$('[data-xe]').forEach((b) => b.onclick = () => expenseDrawer(d.expenses.find((e) => e.id === +b.dataset.xe)));
    $$('[data-xd]').forEach((b) => b.onclick = async () => {
      const e = d.expenses.find((x) => x.id === +b.dataset.xd);
      if (!confirm('Delete this expense?\n\n' + e.category + ' · ' + egp(e.amount))) return;
      try { await api('expense_delete', { method: 'POST', body: { id: e.id } }); toast('Expense deleted'); pageExpenses(); } catch (err) { toast(err.message, true); }
    });
    $$('[data-sb]').forEach((b) => b.onclick = () => expenseDrawer(null, +b.dataset.sb));
    $$('[data-sp]').forEach((b) => b.onclick = () => supplierPayDrawer(d.suppliers.find((s) => s.id === +b.dataset.sp)));
    $$('[data-ss]').forEach((b) => b.onclick = () => supplierStatement(+b.dataset.ss));
    $$('[data-se]').forEach((b) => b.onclick = () => supplierDrawer(d.suppliers.find((s) => s.id === +b.dataset.se)));
  }
  const dayLabel = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString(LOC, { day: 'numeric', month: 'short' }) : '—';
  const todayCairo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());

  // Add or edit an expense. supplierId: a new bill from that supplier.
  function expenseDrawer(e, supplierId) {
    const d = S.exp;
    const isNew = !e;
    e = e || { on: todayCairo(), category: supplierId ? d.supplierCategory : '', amount: '', note: '', supplierId: supplierId || null, order: '' };
    const sups = d.suppliers.filter((s) => s.active || s.id === e.supplierId);
    openDrawer(isNew ? (supplierId ? 'New bill · ' + (d.suppliers.find((s) => s.id === supplierId) || {}).name : 'Add expense') : 'Edit expense',
      '<form id="xf" class="stack">' +
      '<div class="grid2"><label class="field">Date<input type="date" name="on" value="' + esc(e.on) + '" required></label>' +
        '<label class="field">Amount (EGP)<input type="number" name="amount" min="0" step="0.01" inputmode="decimal" value="' + esc(e.amount) + '" required placeholder="0"></label></div>' +
      '<label class="field">What was it for? <span class="hint">Choose one or type your own</span><input name="category" list="xCats" value="' + esc(e.category) + '" required maxlength="60" placeholder="e.g. Bosta shipping">' +
        '<datalist id="xCats">' + d.categories.map((c) => '<option value="' + esc(c) + '">').join('') + '</datalist></label>' +
      '<div class="chips-row">' + d.categories.map((c) => '<button type="button" class="chip-btn" data-cat="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>' +
      '<label class="field">Supplier <span class="hint">Only for bills from someone who produces for you</span><select name="supplier_id"><option value="">— none —</option>' +
        sups.map((s) => '<option value="' + s.id + '"' + (s.id === e.supplierId ? ' selected' : '') + '>' + esc(s.name) + (s.balance > 0 ? ' (owed ' + egp(s.balance) + ')' : '') + '</option>').join('') + '</select></label>' +
      (isNew ? '<label class="field" id="xPaidWrap"' + (e.supplierId ? '' : ' hidden') + '>Paid now (EGP) <span class="hint">Leave 0 if you haven’t paid yet; the rest stays as owed</span><input type="number" name="paid_now" min="0" step="0.01" placeholder="0"></label>' : '') +
      '<label class="field">Order <span class="hint">Optional — e.g. WTS-1015 for a Bosta return fee</span><input name="order" value="' + esc(e.order || '') + '" placeholder="WTS-…" dir="ltr"></label>' +
      '<label class="field">Note<input name="note" maxlength="300" value="' + esc(e.note || '') + '" placeholder="e.g. 20 boxes, Uber to the printer"></label></form>',
      '<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="xSave">' + (isNew ? 'Add' : 'Save') + '</button>');
    const f = $('#xf');
    $$('[data-cat]').forEach((b) => b.onclick = () => { f.category.value = b.dataset.cat; });
    f.supplier_id.onchange = () => {
      const w = $('#xPaidWrap'); if (w) w.hidden = !f.supplier_id.value;
      if (f.supplier_id.value && !f.category.value) f.category.value = d.supplierCategory;
    };
    $('#xSave').onclick = async () => {
      if (!f.reportValidity()) return;
      try {
        await api('expense_save', { method: 'POST', body: { id: isNew ? 0 : e.id, on: f.on.value, amount: f.amount.value, category: f.category.value, supplier_id: f.supplier_id.value, paid_now: f.paid_now ? f.paid_now.value : 0, order: f.order.value, note: f.note.value } });
        closeDrawer(); toast(isNew ? 'Expense added' : 'Expense saved');
        if (f.on.value.slice(0, 7) !== S.expMonth) S.expMonth = f.on.value.slice(0, 7);
        pageExpenses();
      } catch (err) { toast(err.message, true); }
    };
  }

  function supplierDrawer(s) {
    const isNew = !s;
    s = s || { name: '', phone: '', makes: '', notes: '', active: true };
    openDrawer(isNew ? 'Add supplier' : 'Edit supplier',
      '<form id="sf" class="stack"><label class="field">Name<input name="name" required maxlength="80" value="' + esc(s.name) + '"></label>' +
      '<div class="grid2"><label class="field">Phone<input name="phone" maxlength="40" dir="ltr" value="' + esc(s.phone) + '"></label>' +
        '<label class="field">What they make<input name="makes" maxlength="120" value="' + esc(s.makes) + '" placeholder="e.g. Acrylic cutting & UV print"></label></div>' +
      '<label class="field">Notes<textarea name="notes" maxlength="500">' + esc(s.notes) + '</textarea></label>' +
      (isNew ? '' : '<label class="row" style="gap:8px;font-weight:600"><input type="checkbox" name="active"' + (s.active ? ' checked' : '') + '> Still working with them</label>') + '</form>',
      '<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="sSave">Save</button>');
    $('#sSave').onclick = async () => {
      const f = $('#sf'); if (!f.reportValidity()) return;
      try { await api('supplier_save', { method: 'POST', body: { id: isNew ? 0 : s.id, ...formData(f) } }); closeDrawer(); toast('Supplier saved'); S.expTab = 'suppliers'; pageExpenses(); }
      catch (err) { toast(err.message, true); }
    };
  }

  function supplierPayDrawer(s) {
    openDrawer('Pay ' + s.name,
      '<form id="pf" class="stack"><div class="card small">' + (s.balance > 0 ? 'You owe <b>' + egp(s.balance) + '</b>.' : 'Nothing owed right now — a payment now counts as paid in advance.') + '</div>' +
      '<div class="grid2"><label class="field">Amount (EGP)<input type="number" name="amount" min="0" step="0.01" required value="' + (s.balance > 0 ? s.balance : '') + '"></label>' +
        '<label class="field">Date<input type="date" name="on" value="' + todayCairo() + '" required></label></div>' +
      '<label class="field">Note<input name="note" maxlength="300" placeholder="e.g. cash, InstaPay, part of the October bill"></label></form>',
      '<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="pSave">Record payment</button>');
    $('#pSave').onclick = async () => {
      const f = $('#pf'); if (!f.reportValidity()) return;
      try { await api('supplier_pay', { method: 'POST', body: { supplier_id: s.id, amount: f.amount.value, on: f.on.value, note: f.note.value } }); closeDrawer(); toast('Payment recorded'); S.expTab = 'suppliers'; pageExpenses(); }
      catch (err) { toast(err.message, true); }
    };
  }

  async function supplierStatement(id) {
    let d;
    try { d = await api('supplier_statement', { query: '&id=' + id }); } catch (e) { toast(e.message, true); return; }
    const s = d.supplier;
    openDrawer(s.name + ' · statement',
      '<div class="stack"><div class="kpis" style="margin:0">' + kpi('Billed', egp(s.billed), 'all time') + kpi('Paid', egp(s.paid), 'all time') +
        kpi(s.balance < 0 ? 'Paid in advance' : 'Still owed', egp(Math.abs(s.balance)), s.balance > 0 ? 'to pay' : 'all settled') + '</div>' +
      (d.rows.length ? '<div class="table-wrap"><table><thead><tr><th>Date</th><th>What</th><th class="num">Amount</th><th class="num">Owed after</th><th></th></tr></thead><tbody>' +
        d.rows.map((r) => '<tr><td class="small">' + esc(dayLabel(r.on)) + '</td><td>' + (r.type === 'bill' ? '<b>Bill</b>' : '<b class="pay-ok">Payment</b>') +
          '<div class="small muted">' + esc(r.note || '') + (r.order ? ' · ' + esc(r.order) : '') + (r.by ? ' · by ' + esc(r.by) : '') + '</div></td>' +
          '<td class="num">' + (r.type === 'bill' ? '+' : '−') + egp(r.amount) + '</td><td class="num small">' + egp(r.balance) + '</td>' +
          '<td class="num">' + (r.type === 'payment' ? '<button class="btn sm danger" data-pd="' + r.id + '">Delete</button>' : '') + '</td></tr>').join('') +
        '</tbody></table></div>' : '<div class="card muted small">No bills or payments yet.</div>') + '</div>',
      '<button class="btn" data-sb2>+ Bill</button><span class="spacer"></span><button class="btn" data-close>Close</button><button class="btn primary" data-sp2>Pay</button>');
    $('[data-sb2]').onclick = () => expenseDrawer(null, s.id);
    $('[data-sp2]').onclick = () => supplierPayDrawer(s);
    $$('[data-pd]').forEach((b) => b.onclick = async () => {
      if (!confirm('Delete this payment?')) return;
      try { await api('supplier_payment_delete', { method: 'POST', body: { id: +b.dataset.pd } }); toast('Payment deleted'); await pageExpenses(); supplierStatement(id); } catch (err) { toast(err.message, true); }
    });
  }

  // The month as a sheet (opens in Excel or Google Sheets).
  function expensesSheet(d) {
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['Month', d.month], ['Spent', d.total], ['Sales', d.sales], ['Left after expenses', d.net], ['Owed to suppliers', d.owed], [],
      ['Date', 'For', 'Amount (EGP)', 'Supplier', 'Order', 'Note', 'By']];
    d.expenses.forEach((e) => rows.push([e.on, e.category, e.amount, e.supplier || '', e.order || '', e.note || '', e.by || '']));
    rows.push([], ['Supplier', 'Billed (all time)', 'Paid', 'Still owed']);
    d.suppliers.forEach((s) => rows.push([s.name, s.billed, s.paid, s.balance]));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'expenses-' + d.month + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- commissions ----------
  // Earned on delivered orders, in the month they're delivered, on the products' value (order total without shipping).
  // ---------- Monthly reports: each Cairo month's orders, money, expenses and profit (api/reports.php) ----------
  async function pageReports() {
    const list = (await api('reports')).months;
    if (!S.reportMonth || !list.some((m) => m.month === S.reportMonth)) S.reportMonth = list[0] ? list[0].month : null;
    const mName = (m) => new Date(m + '-01T12:00:00').toLocaleDateString(LOC, { month: 'long', year: 'numeric' });
    const chg = (now, before) => { if (!before) return ''; const p = Math.round((now - before) / Math.abs(before) * 100); return p ? '<span class="' + (p > 0 ? 'up' : 'down') + '">' + (p > 0 ? '▲' : '▼') + Math.abs(p) + '%</span>' : '<span class="muted">=</span>'; };
    $('#main').innerHTML = header('Monthly reports', 'Each month in Cairo time, from your orders, payments, expenses and the team’s pay. The month that just ended is saved on the 1st.', '') +
      '<div class="card"><div class="table-wrap"><table class="rep-months"><thead><tr><th>Month</th><th class="num">Orders</th><th class="num">Sales</th><th class="num">Delivered</th><th class="num">Collected</th><th class="num">Expenses</th><th class="num">Net profit</th><th class="num">Sales vs month before</th></tr></thead><tbody>' +
      list.map((m, i) => { const prev = list[i + 1];
        return '<tr data-m="' + m.month + '" class="' + (m.month === S.reportMonth ? 'on' : '') + '"><td><b>' + esc(mName(m.month)) + '</b>' + (m.current ? '<div class="small muted">so far · day ' + m.daysSoFar + ' of ' + m.days + '</div>' : '') + '</td><td class="num">' + m.orders + '</td><td class="num">' + egp(m.sales) + '</td><td class="num">' + egp(m.delivered) + '</td><td class="num">' + egp(m.collected) + '</td><td class="num">' + egp(m.expenses) + '</td>' +
          '<td class="num ' + (m.net < 0 ? 'neg' : '') + '">' + egp(m.net) + '</td><td class="num">' + (prev ? chg(m.sales, prev.sales) : '') + '</td></tr>'; }).join('') +
      '</tbody></table></div></div><div id="repMonth"></div>';
    $$('.rep-months [data-m]').forEach((r) => r.onclick = () => { S.reportMonth = r.dataset.m; $$('.rep-months tr').forEach((x) => x.classList.toggle('on', x === r)); reportMonth(); });
    reportMonth();
  }

  async function reportMonth() {
    const box = $('#repMonth'); if (!box || !S.reportMonth) return;
    box.innerHTML = '<div class="muted" style="padding:20px">Loading…</div>';
    const d = await api('report_month', { query: '&month=' + S.reportMonth });
    const r = d.report, p = d.previous;
    const mName = new Date(r.month + '-01T12:00:00').toLocaleDateString(LOC, { month: 'long', year: 'numeric' });
    const vs = (now, before) => { if (!before) return '<span class="muted">no data the month before</span>'; const pc = Math.round((now - before) / Math.abs(before) * 100); return (pc > 0 ? '<span class="up">▲' + pc + '%</span>' : pc < 0 ? '<span class="down">▼' + Math.abs(pc) + '%</span>' : '<span class="muted">same</span>') + ' <span class="muted">vs ' + egp(before) + '</span>'; };
    const card = (label, value, note) => '<div class="kpi"><div class="label">' + label + '</div><div class="value">' + value + '</div><div class="note">' + note + '</div></div>';
    const rows = (title, items, cols) => '<div class="card"><h3 style="margin:0 0 10px">' + title + '</h3>' + (items.length ? '<div class="table-wrap"><table><tbody>' + items.map(cols).join('') + '</tbody></table></div>' : '<div class="muted small">Nothing this month.</div>') + '</div>';
    const saved = d.saved ? (d.saved.changes.length
      ? '<div class="msg-warn">✎ <b>Changed since the month closed</b> (saved ' + dateTime(d.saved.at) + '): ' + d.saved.changes.map((c) => esc(c.label) + ' ' + (c.label === 'Orders' ? c.then + ' → ' + c.now : egp(c.then) + ' → ' + egp(c.now))).join(' · ') + '. Usually an order cancelled or returned later, or an expense added late. The numbers below are the current ones.</div>'
      : '<div class="small muted">✓ Saved when the month closed (' + dateTime(d.saved.at) + ') · no changes since.</div>') : (r.current ? '<div class="small muted">This month so far: day ' + r.daysSoFar + ' of ' + r.days + '. It’s saved on the 1st.</div>' : '');
    box.innerHTML = '<div class="row" style="margin:22px 0 8px"><h2 style="margin:0">' + esc(mName) + '</h2><span class="spacer"></span><button class="btn" id="repCsv">Export for the accountant (CSV)</button></div>' + saved +
      '<div class="kpis" style="margin-top:12px">' +
        card('Sales (orders placed)', egp(r.sales.value), r.sales.orders + ' orders · avg ' + egp(r.sales.avg) + '<br>' + vs(r.sales.value, p.sales.value)) +
        card('Delivered', egp(r.delivered.value), r.delivered.orders + ' orders · what commissions are paid on<br>' + vs(r.delivered.value, p.delivered.value)) +
        card('Money collected', egp(r.collected.value), 'payments received this month<br>' + vs(r.collected.value, p.collected.value)) +
        card('Expenses', egp(r.expenses.value), (r.expenses.paidSuppliers ? egp(r.expenses.paidSuppliers) + ' paid to suppliers<br>' : '') + vs(r.expenses.value, p.expenses.value)) +
        card('Gross profit', egp(r.profit.gross), 'sales − cost of sales' + (r.profit.costCoverage < 90 ? '<br><span class="down">cost known for ' + r.profit.costCoverage + '% of sales</span>' : '') + '<br>' + vs(r.profit.gross, p.profit.gross)) +
        card('Net profit', '<span class="' + (r.profit.net < 0 ? 'neg' : 'pay-ok') + '">' + egp(r.profit.net) + '</span>', 'after expenses, salaries and commissions<br>' + vs(r.profit.net, p.profit.net)) +
      '</div>' +
      '<div class="grid2 rep-grid">' +
        '<div class="card"><h3 style="margin:0 0 10px">How the profit adds up</h3><div class="table-wrap"><table><tbody>' +
          '<tr><td>Sales (orders placed, without cancelled and returned)</td><td class="num">' + egp(r.sales.value) + '</td></tr>' +
          '<tr><td>− Cost of products sold (cost prices)</td><td class="num">' + egp(r.profit.costOfSales - r.profit.customCost) + '</td></tr>' +
          (r.profit.customCost ? '<tr><td>− Supplier bills for custom orders</td><td class="num">' + egp(r.profit.customCost) + '</td></tr>' : '') +
          '<tr class="tot"><td>= Gross profit</td><td class="num">' + egp(r.profit.gross) + '</td></tr>' +
          '<tr><td>− Expenses (ads, shipping, packaging, transport…)</td><td class="num">' + egp(r.expenses.operating) + '</td></tr>' +
          '<tr><td>− Salaries</td><td class="num">' + egp(r.team.salaries) + '</td></tr><tr><td>− Commissions</td><td class="num">' + egp(r.team.commissions) + '</td></tr>' +
          '<tr class="tot"><td>= Net profit</td><td class="num">' + egp(r.profit.net) + '</td></tr></tbody></table></div>' +
          (r.expenses.supplierBills ? '<p class="hint">Supplier / production bills this month: ' + egp(r.expenses.supplierBills) + '. They’re not subtracted again here: bills for custom orders are in that order’s cost above, and buying stock is counted through the products’ cost prices when they sell.</p>' : '') + '</div>' +
        rows('Sales by category', r.byCategory, (c) => '<tr><td>' + esc(c.label) + '</td><td class="num">' + c.qty + ' pcs</td><td class="num">' + egp(c.value) + '</td></tr>') +
        rows('Top products', r.topProducts, (c) => '<tr><td>' + esc(c.name) + '</td><td class="num">' + c.qty + ' pcs</td><td class="num">' + egp(c.value) + '</td></tr>') +
        rows('Where orders came from', r.bySource, (c) => '<tr><td>' + esc(c.source) + '</td><td class="num">' + c.orders + ' orders</td><td class="num">' + egp(c.value) + '</td></tr>') +
        rows('By salesperson', r.byRep, (c) => '<tr><td>' + esc(c.name || 'No salesperson (website)') + '</td><td class="num">' + c.orders + ' orders</td><td class="num">' + egp(c.value) + '</td></tr>') +
        rows('Money collected by method', r.collected.byMethod, (c) => '<tr><td>' + esc(c.method) + '</td><td class="num">' + c.payments + '</td><td class="num">' + egp(c.value) + '</td></tr>') +
        rows('Expenses by category', r.expenses.byCategory, (c) => '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.items + '</td><td class="num">' + egp(c.value) + '</td></tr>') +
        '<div class="card"><h3 style="margin:0 0 10px">Customers & leads</h3><div class="table-wrap"><table><tbody>' +
          '<tr><td>Customers who ordered</td><td class="num">' + r.customers.total + '</td></tr><tr><td>· new (first order ever)</td><td class="num">' + r.customers.new + '</td></tr><tr><td>· returning</td><td class="num">' + r.customers.returning + '</td></tr>' +
          '<tr><td>Cancelled or returned (placed this month)</td><td class="num">' + r.lost.orders + ' · ' + egp(r.lost.value) + '</td></tr>' +
          '<tr><td>New leads</td><td class="num">' + r.leads.new + ' · ' + r.leads.won + ' won</td></tr><tr><td>New WhatsApp chats</td><td class="num">' + r.chats.new + ' · ' + r.chats.fromAds + ' from ads</td></tr></tbody></table></div></div>' +
      '</div>';
    $('#repCsv').onclick = () => {
      const L = [['Where To Spot', mName], [], ['Sales (orders placed)', r.sales.value], ['Orders', r.sales.orders], ['Average order', r.sales.avg], ['Delivered', r.delivered.value], ['Money collected', r.collected.value],
        ['Cost of products sold', r.profit.costOfSales - r.profit.customCost], ['Supplier bills for custom orders', r.profit.customCost], ['Gross profit', r.profit.gross], ['Expenses (operating)', r.expenses.operating], ['Supplier / production bills', r.expenses.supplierBills],
        ['Salaries', r.team.salaries], ['Commissions', r.team.commissions], ['Net profit', r.profit.net], [], ['Expenses by category']].concat(r.expenses.byCategory.map((c) => [c.category, c.value]))
        .concat([[], ['Money collected by method']]).concat(r.collected.byMethod.map((c) => [c.method, c.value])).concat([[], ['Sales by category']]).concat(r.byCategory.map((c) => [c.label, c.value]));
      const csv = '\ufeff' + L.map((row) => row.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = 'where-to-spot-' + r.month + '.csv'; a.click();
    };
  }

  async function pageCommissions() {
    const d = await api('commissions', { query: '&month=' + (S.commMonth || '') });
    S.commMonth = d.month;
    const t = d.totals;
    const ords = (n) => n + (n === 1 ? ' order' : ' orders');
    $('#main').innerHTML = header('Salaries & commissions', 'Each person’s salary, what they sold, and the commission they earned in the month. Check it at the end of the month.',
      '<select id="cMonth" style="width:auto">' + lastMonths(12).map((m) => '<option value="' + m + '"' + (m === d.month ? ' selected' : '') + '>' + esc(monthLabel(m)) + '</option>').join('') + '</select>' +
      '<button class="btn" id="cCsv">' + icon('download') + 'Download sheet</button>') +
      '<div class="kpis">' + kpi('Total to pay', egp(t.pay), esc(monthLabel(d.month)) + ' · salaries + commission') +
        kpi('Commission', egp(t.commission), 'salaries ' + egp(t.salary)) +
        kpi('Delivered sales', egp(t.base), ords(t.delivered) + ' delivered · without shipping') +
        kpi('Sold this month', egp(t.soldValue), ords(t.sold) + ' taken') + '</div>' +
      '<div class="card"><div class="table-wrap" style="border:none"><table class="perf comm"><thead><tr><th>Team member</th><th>Salary</th><th>Rate</th><th class="num">Commission</th><th class="num">Total to pay</th><th class="num">Delivered this month</th><th class="num">Sold this month</th><th class="num">Still on the way</th></tr></thead><tbody>' +
      (d.members.length ? d.members.map((m) => '<tr data-m="' + m.id + '"><td><b>' + esc(m.name) + '</b><div class="small muted">' + esc(m.role) + (m.active ? '' : ' · left') + '</div></td>' +
        '<td><span class="pct-in sal-in"><input type="number" min="0" step="100" data-sal="' + m.id + '" value="' + (m.salary || '') + '" placeholder="0"></span></td>' +
        '<td><span class="pct-in"><input type="number" min="0" max="100" step="0.5" data-pct="' + m.id + '" value="' + (m.pct || '') + '" placeholder="0">%</span></td>' +
        '<td class="num"><b class="' + (m.commission > 0 ? 'pay-ok' : '') + '">' + egp(m.commission) + '</b>' + (m.pct ? '' : '<div class="small pay-part">set a rate</div>') + '</td>' +
        '<td class="num"><b>' + egp(m.pay) + '</b></td>' +
        '<td class="num">' + egp(m.base) + '<div class="small muted">' + ords(m.delivered) + '</div>' + (m.returnedLater ? '<div class="small pay-part">−' + egp(m.returnedBase) + ' returned</div>' : '') + '</td>' +
        '<td class="num">' + egp(m.soldValue) + '<div class="small muted">' + ords(m.sold) + '</div>' + (m.lost ? '<div class="small muted">' + m.lost + ' cancelled / returned</div>' : '') + '</td>' +
        '<td class="num">' + egp(m.openValue) + '<div class="small muted">' + ords(m.open) + '</div></td></tr>').join('')
        : '<tr><td colspan="8" class="muted">No sales people yet. Add them in Team.</td></tr>') +
      '</tbody></table></div></div>' +
      '<p class="small muted" style="margin-top:14px">How it’s worked out: an order counts once it’s delivered, in the month it was delivered, on what the customer paid for the products (shipping not included). ' +
      'If a delivered order comes back in a later month, it comes off that month. Orders count toward whoever they’re credited to. A salary or rate applies from the month you set it on, and carries on until you change it. Click a person to see their orders.</p>';
    $('#cMonth').onchange = (e) => { S.commMonth = e.target.value; pageCommissions(); };
    $$('[data-pct],[data-sal]').forEach((inp) => {
      inp.onclick = (e) => e.stopPropagation();
      inp.onchange = async () => {
        const sal = 'sal' in inp.dataset;
        const body = { month: d.month, user_id: +(inp.dataset.sal || inp.dataset.pct) };
        body[sal ? 'salary' : 'pct'] = +inp.value || 0;
        try { await api('commission_rate', { method: 'POST', body }); toast(sal ? 'Salary saved' : 'Rate saved'); pageCommissions(); }
        catch (err) { toast(err.message, true); }
      };
    });
    $$('[data-m]').forEach((r) => r.onclick = () => commissionDrawer(d, d.members.find((m) => m.id === +r.dataset.m)));
    $('#cCsv').onclick = () => commissionSheet(d);
  }

  function commissionDrawer(d, m) {
    const ords = (n) => n + (n === 1 ? ' order' : ' orders');
    const day = (s) => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString(LOC, { day: 'numeric', month: 'short' }) : '—';
    openDrawer(m.name + ' · ' + monthLabel(d.month),
      '<div class="stack"><div class="kpis" style="margin:0">' + kpi('Total to pay', egp(m.pay), 'salary ' + egp(m.salary) + ' + commission') + kpi('Commission', egp(m.commission), (m.pct || 0) + '% of ' + egp(m.base)) +
        kpi('Delivered', String(m.delivered), 'orders this month') + kpi('Still on the way', egp(m.openValue), ords(m.open)) + '</div>' +
      (m.orders.length ? '<div class="table-wrap"><table><thead><tr><th>Order</th><th>Delivered</th><th class="num">Products</th><th class="num">Commission</th></tr></thead><tbody>' +
        m.orders.map((o) => '<tr><td><a href="#" data-o="' + o.id + '"><b>' + esc(o.number) + '</b></a><div class="small muted">' + esc(o.customer) + ' · ordered ' + day(o.createdAt) + '</div></td>' +
          '<td>' + (o.returnedAt ? '<span class="pay-part">' + esc(o.status) + ' ' + day(o.returnedAt) + '</span><div class="small muted">delivered ' + day(o.deliveredAt) + '</div>' : day(o.deliveredAt) + (o.returnedLater ? '<div class="small muted">' + esc(o.status) + ' ' + day(o.returnedLater) + '</div>' : '')) + '</td>' +
          '<td class="num">' + (o.base < 0 ? '−' : '') + egp(Math.abs(o.base)) + (o.shipping ? '<div class="small muted">+ ' + egp(o.shipping) + ' shipping</div>' : '') + '</td>' +
          '<td class="num"><b' + (o.commission < 0 ? ' class="pay-part"' : '') + '>' + (o.commission < 0 ? '−' : '') + egp(Math.abs(o.commission)) + '</b></td></tr>').join('') +
        '</tbody></table></div>' : '<div class="card muted small">No delivered orders this month.</div>') + '</div>',
      '<span class="spacer"></span><button class="btn" data-close>Close</button>');
    $$('#drawer [data-o]').forEach((a) => a.onclick = async (e) => {
      e.preventDefault();
      const r = await api('orders', { query: '&q=' + encodeURIComponent('WTS-' + (1000 + +a.dataset.o)) });
      const o = r.orders.find((x) => x.id === +a.dataset.o); if (o) orderDrawer(o);
    });
  }

  // One sheet for the month (opens in Excel or Google Sheets): a summary per person, then every order.
  function commissionSheet(d) {
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const rows = [['Month', d.month], [], ['Team member', 'Salary (EGP)', 'Rate %', 'Commission (EGP)', 'Total to pay (EGP)', 'Orders sold', 'Sold (EGP)', 'Orders delivered', 'Delivered products (EGP)', 'Returned later (EGP)', 'Still on the way (EGP)']];
    d.members.forEach((m) => rows.push([m.name, m.salary, m.pct, m.commission, m.pay, m.sold, m.soldValue, m.delivered, m.base, m.returnedBase, m.openValue]));
    rows.push([], ['Team member', 'Order', 'Customer', 'Status', 'Ordered', 'Delivered', 'Products (EGP)', 'Shipping (EGP)', 'Commission (EGP)']);
    d.members.forEach((m) => m.orders.forEach((o) => rows.push([m.name, o.number, o.customer, o.status, (o.createdAt || '').slice(0, 10), (o.deliveredAt || '').slice(0, 10), o.base, o.shipping, o.commission])));
    const csv = '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'salaries-commissions-' + d.month + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Brands | Seller requests ("Sell with us" page), with the number of new requests.
  const brandTabs = (on, nNew) => '<div class="seg" id="bTabs" style="margin-bottom:16px"><button data-t="brands" class="' + (on === 'brands' ? 'on' : '') + '">Brands</button>' +
    '<button data-t="requests" class="' + (on === 'requests' ? 'on' : '') + '"><span>Seller requests</span>' + (nNew ? ' <span class="seg-n">' + nNew + '</span>' : '') + '</button></div>';
  const wireBrandTabs = () => $$('#bTabs button').forEach((b) => b.onclick = () => { S.brandTab = b.dataset.t; pageBrands(); });

  async function pageBrands() {
    if (S.brandTab === 'requests') return pageSellerRequests();
    const month = S.brandMonth || new Date().toISOString().slice(0, 7);
    const [d, sr] = await Promise.all([api('brands', { query: '&month=' + month }), api('seller_requests').catch(() => ({ requests: [] }))]);
    const nNewSellers = sr.requests.filter((r) => r.status === 'New').length;
    S.brands = d.brands;
    const money = d.brands.some((b) => b.month);
    $('#main').innerHTML = header('Partner brands', 'Brands whose products you sell under their logo. Each sale earns your commission; the rest is theirs.',
      (money ? '<select id="bMonth" style="width:auto">' + lastMonths(12).map((m) => '<option value="' + m + '"' + (m === d.month ? ' selected' : '') + '>' + esc(monthLabel(m)) + '</option>').join('') + '</select>' : '') +
      '<button class="btn primary" id="newBrand">+ Add brand</button>') + brandTabs('brands', nNewSellers) +
      (d.brands.length ? '<div class="brand-grid">' + d.brands.map((b) => '<div class="card brand-card' + (b.active ? '' : ' off') + '" data-b="' + b.id + '">' +
        '<div class="row"><span class="brand-logo">' + (b.logo ? '<img src="../' + esc(b.logo) + '" alt="">' : esc(b.name[0] || '?')) + '</span><span style="flex:1;min-width:0"><b>' + esc(b.name) + '</b>' +
          '<div class="small muted">' + b.live + ' live of ' + b.products + ' products · ' + (b.commission ? b.commission + '% commission' : '<span class="pay-part">commission not set</span>') + (b.margin ? ' · ' + b.margin + '% margin' : '') + '</div></span>' +
          (b.active ? '<span class="pill good">✓ On</span>' : '<span class="pill">Off</span>') + '</div>' +
        (b.month ? '<div class="brand-nums"><div><span class="small muted">Sold in ' + esc(monthLabel(d.month)) + '</span><b>' + egp(b.month.sales) + '</b><span class="small muted">' + b.month.pieces + ' pcs · ' + b.month.orders + ' orders</span></div>' +
          '<div><span class="small muted">You keep</span><b class="pay-ok">' + egp(b.month.commission + b.month.margin) + '</b>' + (b.month.margin ? '<span class="small muted">' + egp(b.month.commission) + ' commission + ' + egp(b.month.margin) + ' margin</span>' : '') + '</div>' +
          '<div><span class="small muted">Owed to the brand now</span><b' + (b.balance.owed > 0 ? ' class="pay-part"' : '') + '>' + egp(b.balance.owed) + '</b><span class="small muted">' + (b.balance.pending ? egp(b.balance.pending) + ' more once delivered' : 'delivered orders only') + '</span></div></div>' : '') +
        // Product health in one line, whatever the number of products; the list itself opens in Products, filtered.
        '<div class="brand-health">' + (b.products ? '<button class="btn sm" data-bp="' + b.id + '">View products (' + b.products + ') →</button>' : '') +
          (b.health.out ? '<button class="chip-btn warn" data-bp="' + b.id + '" data-show="out">⚠ ' + b.health.out + ' out of stock</button>' : '') +
          (b.health.low ? '<button class="chip-btn" data-bp="' + b.id + '" data-show="low">' + b.health.low + ' low stock</button>' : '') +
          (b.health.hidden ? '<button class="chip-btn" data-bp="' + b.id + '" data-show="hidden">' + b.health.hidden + ' hidden</button>' : '') +
          (b.products && !b.health.out && !b.health.low ? '<span class="small pay-ok">✓ All in stock</span>' : '') + '</div>' +
        '<div class="row"><button class="btn sm" data-edit="' + b.id + '">Edit brand</button>' + (b.month ? '<button class="btn sm primary" data-st="' + b.id + '">Statement & payments</button>' : '') +
          '<span class="spacer"></span><button class="btn sm" data-add="' + b.id + '">+ Add product</button></div></div>').join('') + '</div>'
        : '<div class="card empty">No partner brands yet. Press “Add brand”.</div>') +
      '<p class="small muted" style="margin-top:14px">How it works: give each product its brand in Products → edit → Partner brand. The shop shows the brand’s logo with an “Official partner” badge. ' +
      'Commission is a share of the item price; delivery fees and promo-code discounts are yours. A sale counts toward what you owe the brand once the order is Delivered.</p>';
    const ms = $('#bMonth'); if (ms) ms.onchange = () => { S.brandMonth = ms.value; pageBrands(); };
    wireBrandTabs();
    $('#newBrand').onclick = () => brandDrawer(null);
    $$('[data-edit]').forEach((b) => b.onclick = () => brandDrawer(d.brands.find((x) => x.id === +b.dataset.edit)));
    $$('[data-st]').forEach((b) => b.onclick = () => brandStatement(+b.dataset.st, d.month));
    $$('[data-add]').forEach((b) => b.onclick = () => { S.newBrand = +b.dataset.add; location.hash = '#products'; });
    $$('[data-bp]').forEach((b) => b.onclick = () => { S.prodBrand = b.dataset.bp; S.prodShow = b.dataset.show || ''; S.prodCat = ''; S.prodQ = ''; location.hash = '#products'; });
  }

  // Brands and makers who asked to sell with us (sell.html). Approve makes a hidden partner brand with draft products.
  async function pageSellerRequests() {
    const d = await api('seller_requests');
    S.sellerReqs = d;
    const nNew = d.requests.filter((r) => r.status === 'New').length;
    const tone = { New: ['warn', '●'], Contacted: ['info', '✆'], Approved: ['good', '✓'], Rejected: ['bad', '✕'] };
    const card = (r) => {
      const wa = 'https://wa.me/' + waNumber(r.phone.replace(/\D/g, '')) + '?text=' + encodeURIComponent(AR ? 'أهلًا ' + r.name.split(/\s+/)[0] + '، معك ' + S.user.name.split(' ')[0] + ' من Where To Spot بخصوص منتجات ' + r.brand + '. '
        : 'Hello ' + r.name.split(/\s+/)[0] + ', this is ' + S.user.name.split(' ')[0] + ' from Where To Spot about selling ' + r.brand + ' with us. ');
      return '<div class="card seller-card" data-r="' + r.id + '"><div class="row" style="align-items:flex-start"><span style="flex:1;min-width:0"><b style="font-size:16px">' + esc(r.brand) + '</b> ' + pill(tone, r.status) +
        '<div class="small muted">' + [esc(r.name), '<span dir="ltr">' + esc(r.phone) + '</span>', esc(r.city), esc(r.category), esc(r.stock), dateTime(r.createdAt)].filter(Boolean).join(' · ') + '</div>' +
        (r.link || r.email ? '<div class="small">' + (r.link ? '<a href="' + esc(r.link) + '" target="_blank" rel="noopener">' + esc(r.link.replace(/^https?:\/\//, '')) + '</a>' : '') + (r.link && r.email ? ' · ' : '') + (r.email ? '<a href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a>' : '') + '</div>' : '') + '</span>' +
        '<a class="btn sm wa" href="' + esc(wa) + '" target="_blank" rel="noopener">' + icon('chat') + 'WhatsApp</a></div>' +
        '<div class="seller-prods">' + r.products.map((p) => '<div class="seller-prod">' + (p.photo ? '<a href="../' + esc(p.photo) + '" target="_blank" rel="noopener"><img src="' + esc(thumb(p.photo, 300)) + '" alt="" loading="lazy"></a>' : '<span class="sp-ph"></span>') +
          '<div><b>' + esc(p.name) + '</b>' + (p.price ? '<div class="small">' + egp(p.price) + '</div>' : '') + (p.desc ? '<div class="small muted">' + esc(p.desc) + '</div>' : '') + '</div></div>').join('') + '</div>' +
        (r.notes ? '<div class="small seller-notes">' + esc(r.notes) + '</div>' : '') +
        '<label class="field small">Team note<textarea data-note="' + r.id + '" rows="2" placeholder="e.g. Agreed 15% on WhatsApp, sending samples Sunday">' + esc(r.teamNote || '') + '</textarea></label>' +
        '<div class="row">' + (r.status === 'Approved'
          ? '<span class="small muted">Approved' + (r.commission != null ? ' · ' + r.commission + '% commission' : '') + '</span><span class="spacer"></span><button class="btn sm" data-gobrand>Open Brands</button>'
          : '<select data-st="' + r.id + '" style="width:auto">' + ['New', 'Contacted', 'Rejected'].map((s) => '<option value="' + s + '"' + (s === r.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
            '<span class="spacer"></span><button class="btn sm primary" data-approve="' + r.id + '">Approve…</button>') + '</div></div>';
    };
    $('#main').innerHTML = header('Partner brands', 'Brands and makers who asked to sell with you from the “Sell with us” page.',
      '<a class="btn" href="../sell.html" target="_blank" rel="noopener">' + icon('external') + 'Open the page</a><button class="btn" id="copySell">Copy share link</button>') + brandTabs('requests', nNew) +
      (d.requests.length ? '<div class="stack">' + d.requests.map(card).join('') + '</div>'
        : '<div class="card empty">No requests yet. Share shop.wheretospot.com/sell with brands and makers you’d like to sell for.</div>');
    wireBrandTabs();
    $('#copySell').onclick = () => navigator.clipboard.writeText('https://shop.wheretospot.com/sell').then(() => toast('Link copied'));
    const save = async (id, status, note) => { try { await api('seller_status', { method: 'POST', body: { id, status, note } }); toast('Saved'); } catch (e) { toast(e.message, true); } };
    $$('[data-st]').forEach((s) => s.onchange = async () => { const id = +s.dataset.st; await save(id, s.value, $('[data-note="' + id + '"]').value); pageSellerRequests(); });
    $$('[data-note]').forEach((t) => t.onchange = () => { const r = d.requests.find((x) => x.id === +t.dataset.note); save(r.id, r.status, t.value); });
    $$('[data-gobrand]').forEach((b) => b.onclick = () => { S.brandTab = 'brands'; pageBrands(); });
    $$('[data-approve]').forEach((b) => b.onclick = () => sellerApproveDrawer(d.requests.find((r) => r.id === +b.dataset.approve), d.categories));
  }

  function sellerApproveDrawer(r, cats) {
    openDrawer('Approve ' + r.brand,
      '<form id="saf" class="stack"><div class="card small">This creates the partner brand <b>' + esc(r.brand) + '</b> (hidden in the shop until you turn it on) and ' + r.products.length + (r.products.length === 1 ? ' draft product' : ' draft products') + ' with their photos and prices. You can edit everything before publishing.</div>' +
      '<div class="grid2"><label class="field">Commission (%) <span class="hint">Your share of each sale, as agreed with them</span><input name="commission" type="number" min="0" max="100" step="0.5" required placeholder="e.g. 15"></label>' +
      '<label class="field">Shop category<select name="cat">' + cats.map((c) => '<option value="' + esc(c.key) + '"' + (c.key === r.shopCat ? ' selected' : '') + '>' + esc(c.label) + '</option>').join('') + '</select></label></div></form>',
      '<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="saOk">Approve</button>');
    $('#saOk').onclick = async () => {
      const f = $('#saf'); if (!f.reportValidity()) return;
      try {
        const res = await api('seller_approve', { method: 'POST', body: { id: r.id, commission: f.commission.value, cat: f.cat.value, brand: r.brand } });
        closeDrawer(); toast('Approved · ' + res.products.length + ' draft products'); S.brandTab = 'brands'; pageBrands();
      } catch (e) { toast(e.message, true); }
    };
  }

  function brandDrawer(b) {
    const isNew = !b;
    b = b || { name: '', nameAr: '', tagline: '', taglineAr: '', about: '', aboutAr: '', link: '', commission: '', active: true, logo: '' };
    const body = '<form id="brf" class="stack">' +
      '<div class="grid2"><label class="field">Brand name<input name="name" required maxlength="80" value="' + esc(b.name) + '"></label>' +
      '<label class="field">Name in Arabic<input name="nameAr" dir="rtl" maxlength="80" value="' + esc(b.nameAr) + '"></label></div>' +
      '<div class="grid2"><label class="field">Commission (%) <span class="hint">Your share of each item’s price</span><input name="commission" type="number" min="0" max="100" step="0.5" value="' + esc(b.commission) + '" placeholder="e.g. 20"></label>' +
      '<label class="field">Your margin (%) <span class="hint">Added on top of the brand’s price for all its products (a product can have its own)</span><input name="margin" type="number" min="0" max="500" step="0.5" value="' + esc(b.margin || '') + '" placeholder="e.g. 25"></label></div>' +
      '<label class="field">Instagram or website<input name="link" type="url" value="' + esc(b.link) + '" placeholder="https://instagram.com/…"></label>' +
      '<div class="grid2"><label class="field">Short line <span class="hint">Under the name, e.g. Specialty coffee roasters</span><input name="tagline" maxlength="120" value="' + esc(b.tagline) + '"></label>' +
      '<label class="field">Short line in Arabic<input name="taglineAr" dir="rtl" maxlength="120" value="' + esc(b.taglineAr) + '"></label></div>' +
      '<div class="grid2"><label class="field">About the brand <span class="hint">Shown on its products</span><textarea name="about" maxlength="1000">' + esc(b.about) + '</textarea></label>' +
      '<label class="field">About, in Arabic<textarea name="aboutAr" dir="rtl" maxlength="1000">' + esc(b.aboutAr) + '</textarea></label></div>' +
      '<label class="row" style="gap:8px;font-weight:600"><input type="checkbox" name="active"' + (b.active ? ' checked' : '') + '> Show the brand in the shop</label>' +
      '<p class="small muted" style="margin:0" id="brPreview"></p></form>' +
      '<div class="stack" style="margin-top:20px"><b>Logo</b>' + (isNew ? '<div class="card muted small">Save the brand first, then add its logo.</div>'
        : '<div class="row"><span class="brand-logo lg" id="brLogo">' + (b.logo ? '<img src="../' + esc(b.logo) + '" alt="">' : '—') + '</span>' +
          '<label class="btn sm" style="cursor:pointer">⬆ Upload logo<input type="file" id="brFile" accept="image/jpeg,image/png,image/webp" hidden></label><span class="hint">PNG with a plain or clear background works best</span></div>') + '</div>';
    const w = openDrawer(isNew ? 'Add brand' : b.name, body, (isNew ? '' : '<button class="btn danger" id="brDel">Delete</button>') +
      '<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" form="brf" type="submit">Save</button>');
    $$('[data-close]', w).forEach((x) => x.addEventListener('click', closeDrawer));
    const f = $('#brf');
    const preview = () => {
      const c = +f.elements.commission.value || 0, m = +f.elements.margin.value || 0, sell = Math.round(1000 * (1 + m / 100));
      $('#brPreview').textContent = c || m ? 'Example: the brand’s price is ' + egp(1000) + ' → the shop sells it for ' + egp(sell) + '. You keep ' + egp(sell - 1000 + 1000 * c / 100) + ' and owe the brand ' + egp(1000 - 1000 * c / 100) + '.' : '';
    };
    f.elements.commission.oninput = preview; f.elements.margin.oninput = preview; preview();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const data = formData(f); data.id = b.id || 0;
      try { const r = await api('brand_save', { method: 'POST', body: data }); toast(r.repriced ? 'Brand saved · ' + r.repriced + ' product prices updated' : 'Brand saved'); if (isNew) { await pageBrands(); brandDrawer(r.brand); } else { closeDrawer(); pageBrands(); } }
      catch (err) { toast(err.message, true); }
    };
    const file = $('#brFile');
    if (file) file.onchange = async () => {
      const fd = new FormData(); fd.append('brand_id', b.id); fd.append('file', file.files[0]);
      try { const r = await api('brand_logo', { method: 'POST', form: fd }); b.logo = r.logo; $('#brLogo').innerHTML = '<img src="../' + esc(r.logo) + '" alt="">'; toast('Logo saved'); }
      catch (err) { toast(err.message, true); }
    };
    const del = $('#brDel');
    if (del) del.onclick = async () => {
      if (!confirm('Delete the brand ' + b.name + '?')) return;
      try { await api('brand_delete', { method: 'POST', body: { id: b.id } }); toast('Brand deleted'); closeDrawer(); pageBrands(); }
      catch (err) { toast(err.message, true); }
    };
  }

  async function brandStatement(id, month) {
    const d = await api('brand_statement', { query: '&id=' + id + '&month=' + month });
    const t = d.totals, bal = d.balance;
    const body = '<div class="stack">' +
      '<div class="row"><select id="stMonth" style="width:auto">' + lastMonths(12).map((m) => '<option value="' + m + '"' + (m === d.month ? ' selected' : '') + '>' + esc(monthLabel(m)) + '</option>').join('') + '</select>' +
        '<span class="spacer"></span><a class="btn sm" target="_blank" rel="noopener" href="doc.html?brand=' + id + '&month=' + d.month + '">' + icon('file') + 'Statement to share</a></div>' +
      '<div class="kpis" style="margin:0"><div class="kpi"><div class="label">Sold</div><div class="value">' + egp(t.sales) + '</div><div class="note">' + t.pieces + ' pcs · ' + t.orders + ' orders</div></div>' +
        '<div class="kpi"><div class="label">You keep</div><div class="value">' + egp(t.commission + t.margin) + '</div><div class="note">' + egp(t.commission) + ' commission + ' + egp(t.margin) + ' margin</div></div>' +
        '<div class="kpi"><div class="label">Brand’s share</div><div class="value">' + egp(t.due) + '</div><div class="note">' + egp(t.deliveredDue) + ' delivered</div></div></div>' +
      '<div class="card"><h2>Items sold in ' + esc(monthLabel(d.month)) + '</h2>' + (d.lines.length ? '<div class="list">' + d.lines.map((l) =>
        '<div class="li"><span><b>' + esc(l.number) + '</b> · ' + esc(l.qty + '× ' + l.name) + '<div class="small muted">' + esc(l.customer) + ' · ' + dateTime(l.at) + '</div></span>' +
        '<span style="text-align:right">' + pill(ORDER_TONE, l.status) + '<div class="small">Sold <b>' + egp(l.sales) + '</b> · brand price ' + egp(l.base) + '</div><div class="small pay-ok">You keep ' + egp(l.commission + l.margin) + ' · brand ' + egp(l.due) + '</div></span></div>').join('') + '</div>'
        : '<div class="small muted">Nothing sold this month.</div>') + '</div>' +
      '<div class="card"><h2>Payments to the brand<span class="spacer"></span>' + (bal.owed > 0 ? '<span class="pill warn">' + egp(bal.owed) + ' owed</span>' : '<span class="pill good">✓ Nothing owed</span>') + '</h2>' +
        '<div class="row small muted" style="margin-bottom:10px"><span>Their share of delivered orders ' + egp(bal.earned) + '</span><span class="spacer"></span><span>Paid ' + egp(bal.paid) + '</span></div>' +
        (d.payouts.length ? '<div class="list">' + d.payouts.map((p) => '<div class="li"><span><b>' + egp(p.amount) + '</b>' + (p.note ? ' · ' + esc(p.note) : '') + '<div class="small muted">' + esc(fmtDay(p.on)) + (p.by ? ' · ' + esc(p.by) : '') + '</div></span>' +
          '<button type="button" class="btn sm" data-pd="' + p.id + '" aria-label="Delete payment">✕</button></div>').join('') + '</div>' : '<div class="small muted">No payments yet.</div>') +
        '<div class="row" style="margin-top:12px"><input type="number" id="poAmt" step="0.01" placeholder="Amount" value="' + (bal.owed > 0 ? bal.owed : '') + '" style="width:130px" aria-label="Amount paid">' +
          '<input type="date" id="poOn" value="' + cairoToday() + '" style="width:auto" aria-label="Paid on"><input type="text" id="poNote" placeholder="Note, e.g. InstaPay" style="flex:1;min-width:120px">' +
          '<button type="button" class="btn sm primary" id="poAdd">Record payment</button></div></div></div>';
    openDrawer(d.brand.name + ' · statement', body, '<span class="spacer"></span><button class="btn" data-close>Close</button>');
    $('#stMonth').onchange = (e) => brandStatement(id, e.target.value);
    $('#poAdd').onclick = async () => {
      try { await api('brand_payout', { method: 'POST', body: { brand_id: id, amount: $('#poAmt').value, on: $('#poOn').value, note: $('#poNote').value } }); toast('Payment recorded'); brandStatement(id, d.month); if (S.route === 'brands') { const dr = document.getElementById('drawer'); dr.remove(); await pageBrands(); document.body.appendChild(dr); } }
      catch (err) { toast(err.message, true); }
    };
    $$('[data-pd]').forEach((b) => b.onclick = async () => {
      if (!confirm('Delete this payment?')) return;
      try { await api('brand_payout_delete', { method: 'POST', body: { id: +b.dataset.pd } }); brandStatement(id, d.month); }
      catch (err) { toast(err.message, true); }
    });
  }

  // ---------- promo codes ----------
  async function pagePromos() {
    const d = await api('promos');
    const today = new Date().toISOString().slice(0, 10);
    const state = (p) => !p.active ? ['', 'Off'] : p.expiresAt && p.expiresAt < today ? ['bad', 'Expired'] : p.startsAt && p.startsAt > today ? ['warn', 'Starts ' + fmtDay(p.startsAt)]
      : p.maxUses != null && p.uses >= p.maxUses ? ['bad', 'Used up'] : ['good', 'Live'];
    const live = d.promos.filter((p) => state(p)[1] === 'Live').length;
    $('#main').innerHTML = header('Promo codes', 'Codes customers type at checkout. Changes work on the shop straight away.',
      '<button class="btn primary" id="newPromo">+ New promo code</button>') +
      '<div class="kpis"><div class="kpi"><div class="label">Live codes</div><div class="value">' + live + '</div></div>' +
      '<div class="kpi"><div class="label">Orders with a code</div><div class="value">' + d.promos.reduce((a, p) => a + p.uses, 0) + '</div></div>' +
      '<div class="kpi"><div class="label">Discounts given</div><div class="value">' + egp(d.promos.reduce((a, p) => a + p.given, 0)) + '</div></div></div>' +
      (d.promos.length ? '<div class="table-wrap"><table><thead><tr><th>Code</th><th>Discount</th><th>Rules</th><th>Status</th><th class="num">Used</th><th class="num">Sales</th></tr></thead><tbody>' +
        d.promos.map((p) => { const [tone, label] = state(p);
          return '<tr class="click" data-id="' + p.id + '"><td><b style="font-family:ui-monospace,monospace;letter-spacing:.04em">' + esc(p.code) + '</b>' + (p.note ? '<div class="small muted">' + esc(p.note) + '</div>' : '') + '</td>' +
            '<td>' + esc(p.label) + '</td><td class="small muted">' + ([p.minOrder ? 'Min. ' + egp(p.minOrder) : '', p.maxUses != null ? 'Max ' + p.maxUses + ' uses' : '', p.expiresAt ? 'Until ' + fmtDay(p.expiresAt) : ''].filter(Boolean).join(' · ') || 'No limits') + '</td>' +
            '<td><span class="pill ' + tone + '">' + esc(label) + '</span></td><td class="num">' + p.uses + (p.maxUses != null ? ' / ' + p.maxUses : '') + '</td><td class="num">' + egp(p.sales) + '</td></tr>'; }).join('') +
        '</tbody></table></div>' : '<div class="card empty">No promo codes yet. Press “New promo code”.</div>');
    $('#newPromo').onclick = () => promoDrawer();
    $$('tr[data-id]').forEach((tr) => { tr.onclick = () => promoDrawer(d.promos.find((p) => p.id === +tr.dataset.id)); });
  }

  function promoDrawer(p) {
    p = p || { code: '', kind: 'percent', value: '', minOrder: 0, maxUses: null, startsAt: '', expiresAt: '', active: true, note: '', uses: 0 };
    const w = openDrawer(p.id ? 'Promo code ' + p.code : 'New promo code',
      '<form id="prf" class="stack">' +
      '<label class="field">Code <span class="hint">Case-sensitive: customers must type it exactly, e.g. Ramadan15</span><input name="code" required maxlength="30" value="' + esc(p.code) + '" style="font-family:ui-monospace,monospace;letter-spacing:.05em" autocomplete="off"></label>' +
      '<div class="grid2"><label class="field">Type<select name="kind"><option value="percent"' + (p.kind === 'percent' ? ' selected' : '') + '>Percentage off (%)</option><option value="fixed"' + (p.kind === 'fixed' ? ' selected' : '') + '>Fixed amount off (EGP)</option><option value="shipping"' + (p.kind === 'shipping' ? ' selected' : '') + '>Free delivery</option></select></label>' +
      '<label class="field" id="valField"><span id="valLabel">Discount</span><input name="amount" type="number" min="1" step="any" required value="' + esc(p.value) + '"></label></div>' +
      '<div class="grid2"><label class="field">Minimum order (EGP) <span class="hint">Optional</span><input name="min_order" type="number" min="0" step="1" value="' + (p.minOrder || '') + '" placeholder="No minimum"></label>' +
      '<label class="field">Max uses <span class="hint">Optional, all customers together</span><input name="max_uses" type="number" min="1" step="1" value="' + (p.maxUses == null ? '' : p.maxUses) + '" placeholder="Unlimited"></label></div>' +
      '<div class="grid2"><label class="field">Starts <span class="hint">Optional</span><input name="starts_at" type="date" value="' + esc(p.startsAt || '') + '"></label>' +
      '<label class="field">Ends (last day) <span class="hint">Optional</span><input name="expires_at" type="date" value="' + esc(p.expiresAt || '') + '"></label></div>' +
      '<label class="field">Note for the team <span class="hint">Optional, e.g. Instagram campaign</span><input name="note" maxlength="200" value="' + esc(p.note || '') + '"></label>' +
      '<label class="row" style="gap:8px;cursor:pointer"><input type="checkbox" name="active"' + (p.active ? ' checked' : '') + '> Active (customers can use it)</label>' +
      '<p class="small muted" id="prPreview" style="margin:0"></p></form>',
      (p.id && !p.uses ? '<button class="btn danger" id="prDel">Delete</button>' : '') + '<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" form="prf" type="submit">Save</button>');
    $$('[data-close]', w).forEach((b) => b.addEventListener('click', closeDrawer));
    const f = $('#prf'), el = f.elements;
    const preview = () => {
      const v = +el.amount.value || 0, fixed = el.kind.value === 'fixed', ship = el.kind.value === 'shipping';
      $('#valField').style.visibility = ship ? 'hidden' : '';
      el.amount.required = !ship;
      if (ship) { $('#prPreview').textContent = 'The customer pays no delivery fee' + (+el.min_order.value ? ' on orders of ' + egp(+el.min_order.value) + ' or more' : '') + '.'; return; }
      $('#valLabel').textContent = fixed ? 'Amount off (EGP)' : 'Percent off (%)';
      $('#prPreview').textContent = v ? 'On an ' + egp(1000) + ' order the customer saves ' + egp(fixed ? Math.min(v, 1000) : 1000 * Math.min(v, 100) / 100) + '.' : '';
    };
    el.kind.onchange = preview; el.amount.oninput = preview; el.min_order.oninput = preview; preview();
    el.code.oninput = () => { el.code.value = el.code.value.replace(/[^A-Za-z0-9_-]/g, ''); };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = { id: p.id || 0, code: el.code.value, kind: el.kind.value, value: el.amount.value, min_order: el.min_order.value, max_uses: el.max_uses.value,
        starts_at: el.starts_at.value, expires_at: el.expires_at.value, note: el.note.value, active: el.active.checked };
      try { await api('promo_save', { method: 'POST', body }); toast('Promo code saved'); closeDrawer(); pagePromos(); }
      catch (err) { toast(err.message, true); }
    };
    const del = $('#prDel');
    if (del) del.onclick = async () => {
      if (!confirm('Delete promo code ' + p.code + '?')) return;
      try { await api('promo_delete', { method: 'POST', body: { id: p.id } }); toast('Deleted'); closeDrawer(); pagePromos(); }
      catch (err) { toast(err.message, true); }
    };
  }

  // ---------- backups ----------
  // Backups → the weekly copy off the server: a locked zip sent to the owners on Telegram (api/offsite.php).
  function offsiteCard(o) {
    const todo = [];
    if (!o.zipLock) todo.push('The server can’t make password-protected zip files. Ask the hosting to enable PHP’s zip extension.');
    if (!o.password) todo.push('Add a backup password (at least 10 characters) to api/config.local.php on the server: \'backup_password\' => \'…\'. Save it somewhere safe too (a password manager or on paper): you need it to open the backups.');
    if (!o.telegram) todo.push('Set up Telegram (Settings → WhatsApp → Telegram alerts).');
    else if (!o.owners.length) todo.push('Connect your Telegram: in the WhatsApp inbox press ✈️ Telegram and follow the link. Only owners receive the backup.');
    const ready = !todo.length;
    const last = o.last ? new Date(o.last.replace(' ', 'T') + 'Z') : null;
    const late = last && Date.now() - last > (o.everyDays + 2) * 86400000;
    return '<div class="card stack" style="margin-bottom:16px;gap:12px"><h2>Copy off the server<span class="spacer"></span>' +
        (ready ? (last && !late ? '<span class="pill good">✓ Weekly on Telegram</span>' : '<span class="pill warn">Not sent yet</span>') : '<span class="pill bad">✕ Not set up</span>') + '</h2>' +
      '<p class="muted" style="margin:0;line-height:1.6">The copies below live on the hosting server. Every ' + o.everyDays + ' days the latest one (with product photos and customers’ order files) is also sent to the owners on Telegram, in a zip locked with your backup password. If the server is ever lost, that file restores the whole shop.</p>' +
      (ready ? '<div class="list"><div class="li"><span>Goes to</span><span><b>' + esc(o.owners.join(', ')) + '</b></span></div>' +
        '<div class="li"><span>Last sent</span><span>' + (last ? dateTime(o.last) + ' · ' + fmtSize(o.lastSize) + (o.lastNote ? ' · <span class="muted">' + esc(o.lastNote) + '</span>' : '') : '—') + '</span></div></div>' : '') +
      (o.error ? '<div class="err">' + esc(o.error) + '</div>' : '') +
      (todo.length ? '<div class="card" style="background:var(--warn-soft, #FFF6E5);border-color:#F0DFB8"><b>To switch it on</b><ul style="margin:8px 0 0;padding-left:18px;line-height:1.7">' + todo.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul></div>' : '') +
      (ready && S.user.role === 'owner' ? '<div class="row"><button class="btn" id="bkOff">Send to Telegram now</button></div>' : '') + '</div>';
  }

  async function pageBackups() {
    const d = await api('backups');
    const last = d.backups[0];
    $('#main').innerHTML = header('Backups', 'A full copy of the database (orders, leads, products, team) is saved automatically every day. The last ' + d.keep + ' days are kept.',
      '<button class="btn primary" id="bkNow">' + icon('shield') + 'Back up now</button>') +
      '<div class="kpis"><div class="kpi"><div class="label">Last backup</div><div class="value" style="font-size:22px">' + (last ? dateTime(last.created) : '—') + '</div><div class="note">' + (last ? fmtSize(last.size) : 'None yet') + '</div></div>' +
      '<div class="kpi"><div class="label">Copies kept</div><div class="value">' + d.backups.length + '</div><div class="note">of ' + d.keep + ' days</div></div></div>' +
      offsiteCard(d.offsite) +
      (d.backups.length ? '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Saved</th><th class="num">Size</th><th></th></tr></thead><tbody>' +
        d.backups.map((b) => '<tr><td><b>' + esc(fmtDay(b.file.slice(5, 15))) + '</b></td><td class="small muted">' + dateTime(b.created) + '</td><td class="num">' + fmtSize(b.size) + '</td>' +
          '<td class="num"><a class="btn sm" href="' + API + '?action=backup_download&file=' + encodeURIComponent(b.file) + '">' + icon('download') + 'Download</a></td></tr>').join('') +
        '</tbody></table></div>' : '<div class="card empty">No backups yet. Press “Back up now”.</div>') +
      '<details class="card" style="margin-top:16px"><summary style="cursor:pointer;font-weight:600">How to restore a backup</summary><ol class="muted" style="line-height:1.8;margin:12px 0 0">' +
      '<li>From Telegram: save the zip and open it with the backup password (Windows: 7-Zip; Mac: Keka or The Unarchiver). Inside is <code>shop.sqlite</code>, plus the <code>uploads</code> folders to put back in the website folder.</li>' +
      '<li>In cPanel → File Manager, open the <code>wts-shop-data</code> folder.</li><li>Rename <code>shop.sqlite</code> to <code>shop-old.sqlite</code> (keep it until you’re sure).</li>' +
      '<li>Upload the backup file and rename it to <code>shop.sqlite</code>. Delete any <code>shop.sqlite-wal</code> and <code>shop.sqlite-shm</code> files.</li><li>Reload the dashboard.</li></ol></details>';
    const os = $('#bkOff'); if (os) os.onclick = async () => {
      os.disabled = true; os.textContent = 'Sending…';
      try { const r = await api('backup_offsite', { method: 'POST' }); toast('Backup sent to ' + r.to.join(', ') + ' on Telegram'); pageBackups(); }
      catch (err) { toast(err.message, true); os.disabled = false; os.textContent = 'Send to Telegram now'; }
    };
    $('#bkNow').onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await api('backup_now', { method: 'POST' }); toast('Backup saved'); pageBackups(); }
      catch (err) { toast(err.message, true); b.disabled = false; }
    };
  }

  // ---------- team ----------
  async function pageTeam() {
    await loadTeam();
    $('#main').innerHTML = header('Team', 'Who can sign in to this dashboard, and what they can do.', (can('targets') ? '<button class="btn" id="teamTargets">🎯 Monthly targets</button>' : '') + '<button class="btn" id="teamHours">' + icon('clock') + 'Working hours</button><button class="btn" id="testMail">Send test alert to me</button><button class="btn primary" id="addU">+ Add team member</button>') +
      '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Referral code</th><th>Order alerts</th><th>Status</th><th>Devices</th><th>Last sign-in</th></tr></thead><tbody>' +
      S.team.map((u) => '<tr class="click" data-id="' + u.id + '"><td><b>' + esc(u.name) + '</b>' + (u.id === S.user.id ? ' <span class="pill">You</span>' : '') + '<div class="small muted">' + esc(u.email) + (u.phone ? ' · ' + esc(u.phone) : '') + '</div></td>' +
        '<td><b>' + esc(u.role) + '</b><div class="small muted">' + esc(ROLE_INFO[u.role]) + '</div></td><td>' + (u.ref_code ? '<code>' + esc(u.ref_code) + '</code>' : '—') + '</td>' +
        '<td>' + (u.notify ? '<span class="pill info">✉ Email</span>' : '<span class="muted">Off</span>') + '</td>' +
        '<td>' + (u.active ? '<span class="pill good">✓ Active</span>' : '<span class="pill bad">✕ Disabled</span>') + '</td><td><b>' + (u.devices || 0) + '</b>' + (u.last_device ? '<div class="small muted dev-last">' + esc(u.last_device) + '</div>' : '') + '</td><td class="small muted">' + dateTime(u.last_login) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<div class="card" id="teamSec" style="margin-top:16px"></div>' +
      '<p class="muted small" style="margin-top:14px">Referral codes: when a customer enters a team member’s code at checkout, the order is credited to them. Orders a team member enters in the dashboard are credited to them too, and count toward their monthly target.</p>';
    $('#addU').onclick = () => userDrawer(null);
    $('#teamHours').onclick = () => hoursDrawer(7);
    teamSecurity();
    const tt = $('#teamTargets'); if (tt) tt.onclick = () => targetsDrawer('');
    $('#testMail').onclick = async (e) => {
      e.target.disabled = true;
      try {
        const r = await api('mail_test', { method: 'POST' });
        toast(r.subscribed ? 'Test sent to ' + r.to + ' via ' + r.via
          : 'Test sent to ' + r.to + ' — but you are NOT subscribed to order alerts. Edit your row and tick “Email me new orders”.', !r.subscribed);
      }
      catch (err) { toast(err.message, true); }
      e.target.disabled = false;
    };
    $$('tr[data-id]').forEach((tr) => tr.onclick = () => userDrawer(S.team.find((u) => u.id === +tr.dataset.id)));
  }

  function userDrawer(u) {
    const isNew = !u;
    u = u || { name: '', email: '', phone: '', role: 'staff', ref_code: '', active: 1, notify: 0 };
    const body = '<form id="uf" class="stack">' +
      '<div class="grid2"><label class="field">Name<input type="text" name="name" required value="' + esc(u.name) + '"></label>' +
      '<label class="field">Phone<input type="tel" name="phone" value="' + esc(u.phone) + '"></label></div>' +
      '<label class="field">Email <span class="hint">Used to sign in</span><input type="email" name="email" required value="' + esc(u.email) + '" autocomplete="off"></label>' +
      '<label class="field">Role<select name="role">' + S.meta.roles.map((r) => '<option value="' + r + '"' + (r === u.role ? ' selected' : '') + '>' + r + ' — ' + ROLE_INFO[r] + '</option>').join('') + '</select></label>' +
      '<label class="field">Referral code <span class="hint">Optional, for sales reps (e.g. AHMED10)</span><input type="text" name="ref_code" value="' + esc(u.ref_code || '') + '"></label>' +
      '<label class="field">' + (isNew ? 'Password' : 'New password') + ' <span class="hint">' + (isNew ? 'At least 8 characters — share it with them privately' : 'Leave blank to keep the current one') + '</span>' +
      '<input type="password" name="password" ' + (isNew ? 'required minlength="8"' : '') + ' autocomplete="new-password"></label>' +
      '<label class="row" style="font-weight:600"><input type="checkbox" name="notify" ' + (u.notify ? 'checked' : '') + '> Email me new orders and enquiries</label>' +
      '<label class="row" style="font-weight:600"><input type="checkbox" name="active" ' + (u.active ? 'checked' : '') + '> Can sign in</label></form>' +
      (isNew ? '' : '<div class="stack" style="margin-top:22px"><h3 style="margin:0">Devices</h3><div class="hint">Phones and computers ' + esc(u.name.split(' ')[0]) + ' signed in from. Android shows the exact model; iPhones only show the likely models (Apple hides it).</div><div id="devList" class="muted small">Loading…</div></div>' +
        '<div class="stack" style="margin-top:22px"><h3 style="margin:0">Recent sign-ins</h3><div id="loginList" class="muted small">Loading…</div></div>' +
        '<div class="stack" style="margin-top:22px"><h3 style="margin:0">Working days</h3><div class="hint">First and last use of the dashboard each day, and how long it was open (last 14 days).</div><div id="dayList" class="muted small">Loading…</div></div>');
    openDrawer(isNew ? 'Add team member' : u.name, body, '<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" form="uf" type="submit">Save</button>');
    $$('#drawer [data-close]').forEach((b) => b.addEventListener('click', closeDrawer));
    if (!isNew) { loadDevices(u); loadPersonActivity(u); }
    $('#uf').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('team_save', { method: 'POST', body: Object.assign({ id: u.id || 0 }, formData(e.target)) }); closeDrawer(); toast('Team member saved'); pageTeam(); }
      catch (err) { toast(err.message, true); }
    };
  }

  async function loadDevices(u, list) {
    const box = $('#devList'); if (!box) return;
    if (!list) { try { list = (await api('devices', { query: '&user=' + u.id })).devices; } catch (e) { box.textContent = e.message; return; } }
    const used = list.filter((d) => !d.signedOut).length;
    box.className = '';
    box.innerHTML = list.length ? '<div class="small muted" style="margin-bottom:8px">' + used + (used === 1 ? ' device' : ' devices') + ' in use' + (list.length > used ? ' · ' + (list.length - used) + ' signed out' : '') + '</div>' +
      '<div class="list">' + list.map((d) => '<div class="li" style="align-items:flex-start"><span><b>' + esc(d.label || 'Unknown device') + '</b>' + (d.thisDevice ? ' <span class="pill info">This device</span>' : '') + (d.signedOut ? ' <span class="pill">Signed out</span>' : '') +
        (d.place ? '<div class="small muted">' + esc(d.place) + '</div>' : '') + '<div class="small muted">Last used ' + dateTime(d.lastSeen) + ' · first ' + dateTime(d.firstSeen) + ' · ' + d.logins + (d.logins === 1 ? ' sign-in' : ' sign-ins') + (d.ip ? ' · IP <span dir="ltr">' + esc(d.ip) + '</span>' : '') + '</div></span>' +
        (d.signedOut || d.thisDevice ? '' : '<button type="button" class="btn sm danger" data-devout="' + d.id + '">Sign out</button>') + '</div>').join('') + '</div>'
      : '<div class="muted small">No sign-ins recorded yet — devices show up from the next time they sign in or open the dashboard.</div>';
    $$('[data-devout]').forEach((b) => b.onclick = async () => {
      if (!confirm('Sign ' + u.name + ' out on this device? They can sign in again with their password. To stop them completely, untick “Can sign in”.')) return;
      try { const r = await api('device_signout', { method: 'POST', body: { id: +b.dataset.devout } }); toast('Device signed out'); loadDevices(u, r.devices); } catch (err) { toast(err.message, true); }
    });
  }

  const timeOnly = (s) => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' }) : '—';
  const hrs = (m) => m >= 60 ? Math.floor(m / 60) + 'h ' + String(Math.round(m % 60)).padStart(2, '0') + 'm' : Math.round(m) + 'm';
  const dayName = (d) => new Date(d + 'T00:00:00').toLocaleDateString(LOC, { weekday: 'short', day: 'numeric', month: 'short' });

  const LOC_NOTE = { denied: 'Location not allowed', unavailable: 'Location unavailable', timeout: 'Location timed out', skipped: 'Skipped sharing location' };

  // Owner's choice: ask team members for their location each time they sign in.
  async function teamSecurity() {
    const box = $('#teamSec'); if (!box) return;
    let d;
    try { d = await api('team_security'); } catch (e) { box.remove(); return; }
    box.innerHTML = '<h2>Sign-in checks</h2><label class="row" style="gap:10px;font-weight:600;align-items:flex-start"><input type="checkbox" id="askLoc"' + (d.askLocation ? ' checked' : '') + ' style="margin-top:3px">' +
      '<span>Ask team members for their location when they sign in<div class="small muted" style="font-weight:400">Their phone asks “Allow location?” once; after “Allow”, the location is saved with each sign-in and refreshed quietly once a day while the dashboard is used (Team → person → Recent sign-ins, with a map). A phone that says no isn’t asked again. Everyone is included, owners too. Tell your team before turning it on.</div></span></label>' +
      '<div class="small muted" style="margin-top:8px">Always on: every sign-in records the device, city and internet provider, and you get an email when someone signs in from a new device.</div>';
    $('#askLoc').onchange = async (e) => {
      try { await api('team_security', { method: 'POST', body: { ask_location: e.target.checked } }); toast(e.target.checked ? 'Location will be asked at sign-in' : 'Location won’t be asked'); }
      catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; }
    };
  }

  // One person's recent sign-ins (device, city, provider, location) and working days.
  async function loadPersonActivity(u) {
    let d;
    try { d = await api('person_activity', { query: '&user=' + u.id }); } catch (e) { const b = $('#loginList'); if (b) b.textContent = e.message; return; }
    const lb = $('#loginList'), dl = $('#dayList'); if (!lb || !dl) return;
    lb.className = ''; dl.className = '';
    lb.innerHTML = d.logins.length ? '<div class="list">' + d.logins.map((l, i) => '<div class="li" style="align-items:flex-start"><span><b>' + dateTime(l.at) + '</b>' + (l.newDevice ? ' <span class="pill warn">New device</span>' : '') +
      '<div class="small muted">' + esc(l.device || 'Unknown device') + '</div><div class="small muted">' + [l.city, l.isp].filter(Boolean).map(esc).join(' · ') +
      (l.ip ? (l.city || l.isp ? ' · ' : '') + 'IP <span dir="ltr">' + esc(l.ip) + '</span>' : '') + '</div></span>' +
      '<span class="small" style="text-align:right;white-space:nowrap">' + (l.location ? '<button type="button" class="btn sm" data-map="' + i + '">📍 Map</button><div class="muted" style="margin-top:4px">±' + l.location.acc + ' m' + (l.location.at && l.location.at.slice(0, 16) !== l.at.slice(0, 16) ? '<br>updated ' + dateTime(l.location.at) : '') + '</div>'
        : l.locStatus ? '<span class="muted">' + esc(LOC_NOTE[l.locStatus] || '') + '</span>' : '') + '</span></div>' +
      (l.location ? '<div class="login-map" id="map' + i + '" hidden></div>' : '')).join('') + '</div>'
      : '<div class="muted small">No sign-ins recorded yet.</div>';
    // The map opens inside the page (the newest location opens by itself), with a link to Google Maps.
    const showMap = (i) => {
      const box = $('#map' + i), l = d.logins[i]; if (!box || !l.location) return;
      if (!box.hidden) { box.hidden = true; return; }
      const q = l.location.lat + ',' + l.location.lng;
      box.innerHTML = '<iframe title="Location at sign-in" loading="lazy" referrerpolicy="no-referrer" src="https://maps.google.com/maps?q=' + q + '&z=16&output=embed"></iframe>' +
        '<div class="small"><a href="https://www.google.com/maps?q=' + q + '" target="_blank" rel="noopener">Open in Google Maps ↗</a> · <span dir="ltr">' + l.location.lat.toFixed(5) + ', ' + l.location.lng.toFixed(5) + '</span></div>';
      box.hidden = false;
    };
    $$('[data-map]').forEach((b) => b.onclick = () => showMap(+b.dataset.map));
    const first = d.logins.findIndex((l) => l.location); if (first >= 0) showMap(first);
    dl.innerHTML = d.days.length ? '<div class="table-wrap"><table><thead><tr><th>Day</th><th>Start</th><th>End</th><th class="num">Dashboard open</th></tr></thead><tbody>' +
      d.days.map((r) => '<tr><td>' + esc(dayName(r.day)) + '</td><td>' + timeOnly(r.first) + '</td><td>' + timeOnly(r.last) + '</td><td class="num">' + hrs(r.onlineMin) + '</td></tr>').join('') + '</tbody></table></div>'
      : '<div class="muted small">No activity in the last 14 days.</div>';
  }

  // Everyone's days: start, end and time with the dashboard open, plus totals per person.
  async function hoursDrawer(days) {
    let d;
    try { d = await api('team_hours', { query: '&days=' + days }); } catch (e) { toast(e.message, true); return; }
    const per = {};
    d.rows.forEach((r) => { const p = per[r.userId] = per[r.userId] || { name: r.name, role: r.role, days: 0, min: 0, starts: [] }; p.days++; p.min += r.onlineMin; p.starts.push(new Date(r.first.replace(' ', 'T') + 'Z')); });
    const avgStart = (arr) => { const m = arr.reduce((a, t) => a + t.getHours() * 60 + t.getMinutes(), 0) / arr.length; const x = new Date(); x.setHours(Math.floor(m / 60), Math.round(m % 60), 0, 0); return x.toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' }); };
    openDrawer('Working hours',
      '<div class="stack"><div class="seg" id="hDays">' + [7, 14, 30].map((n) => '<button data-n="' + n + '" class="' + (n === d.days ? 'on' : '') + '">' + n + ' days</button>').join('') + '</div>' +
      '<div class="hint">Based on when each person has the dashboard open: first and last use each day, and the time it was open (breaks over 15 minutes don’t count).</div>' +
      (Object.keys(per).length ? '<div class="table-wrap"><table><thead><tr><th>Team member</th><th class="num">Days</th><th class="num">Total open</th><th class="num">Per day</th><th class="num">Usual start</th></tr></thead><tbody>' +
        Object.values(per).sort((a, b) => b.min - a.min).map((p) => '<tr><td><b>' + esc(p.name) + '</b><div class="small muted">' + esc(p.role) + '</div></td><td class="num">' + p.days + '</td><td class="num">' + hrs(p.min) + '</td><td class="num">' + hrs(p.min / p.days) + '</td><td class="num">' + avgStart(p.starts) + '</td></tr>').join('') +
        '</tbody></table></div><h3 style="margin:8px 0 0">Day by day</h3><div class="table-wrap"><table><thead><tr><th>Day</th><th>Team member</th><th>Start</th><th>End</th><th class="num">Open</th></tr></thead><tbody>' +
        d.rows.map((r) => '<tr><td class="small">' + esc(dayName(r.day)) + '</td><td>' + esc(r.name) + '</td><td>' + timeOnly(r.first) + '</td><td>' + timeOnly(r.last) + '</td><td class="num">' + hrs(r.onlineMin) + '</td></tr>').join('') + '</tbody></table></div>'
        : '<div class="card empty">No activity recorded yet. It starts counting from the next time people use the dashboard.</div>') + '</div>',
      '<span class="spacer"></span><button class="btn" data-close>Close</button>');
    $$('#hDays button').forEach((b) => b.onclick = () => hoursDrawer(+b.dataset.n));
  }

  // ---------- activity ----------
  async function pageActivity() {
    const d = await api('activity');
    $('#main').innerHTML = header('Activity', 'The latest 300 changes by your team and the website.') +
      (d.activity.length ? '<div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead><tbody>' +
        d.activity.map((a) => '<tr><td class="small muted" style="white-space:nowrap">' + dateTime(a.created_at) + '</td><td>' + esc(a.user_name) + '</td><td><b>' + esc(a.action) + '</b></td><td class="muted">' + esc(a.detail) + '</td></tr>').join('') +
        '</tbody></table></div>' : '<div class="card empty">Nothing yet.</div>');
  }

  boot();
})();
