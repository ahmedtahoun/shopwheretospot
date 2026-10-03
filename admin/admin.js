// Where To Spot team dashboard. Plain JS, talks to ../api/admin.php.
(function () {
  'use strict';

  const API = '../api/admin.php';
  const app = document.getElementById('app');
  const S = { user: null, csrf: null, meta: {}, team: [], cats: [], products: [], route: 'dashboard', range: 30 };

  // ---------- utils ----------
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const egp = (n) => 'EGP ' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const date = (s) => { if (!s) return '—'; const d = new Date(s.replace(' ', 'T') + 'Z'); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const dateTime = (s) => { if (!s) return '—'; const d = new Date(s.replace(' ', 'T') + 'Z'); return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  const can = (perm) => !!(S.user && S.user.perms.includes(perm));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function toast(msg, bad) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = ''; }, 2600);
  }

  async function api(action, { method = 'GET', body, query = '', form } = {}) {
    const opts = { method, credentials: 'same-origin', headers: {} };
    if (method !== 'GET') opts.headers['X-CSRF-Token'] = S.csrf || '';
    if (form) opts.body = form;
    else if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(API + '?action=' + action + query, opts);
    let data = {};
    try { data = await res.json(); } catch (e) { /* non-JSON */ }
    if (res.status === 401 && action !== 'login') { S.user = null; render(); }
    if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
    return data;
  }

  const ORDER_TONE = { Pending: ['warn', '●'], Confirmed: ['info', '◆'], Designing: ['accent', '✎'], 'Awaiting approval': ['warn', '⏳'], 'In production': ['accent', '⚙'], Ready: ['good', '▣'], Shipped: ['info', '➜'], Delivered: ['good', '✓'], Cancelled: ['bad', '✕'], Returned: ['bad', '↩'] };
  const LEAD_TONE = { New: ['accent', '●'], Contacted: ['info', '◆'], Quoted: ['warn', '✎'], Won: ['good', '✓'], Lost: ['bad', '✕'] };
  const PRODUCT_TONE = { Active: ['good', '✓'], Draft: ['warn', '✎'], Archived: ['bad', '▪'] };
  const pill = (map, s) => { const t = map[s] || ['', '•']; return '<span class="pill ' + t[0] + '">' + t[1] + ' ' + esc(s) + '</span>'; };
  const ROLE_INFO = { sales: 'Enters orders, sees only their own orders, targets and leads', owner: 'Everything, including team and settings', manager: 'Products, orders, leads and activity', staff: 'Orders and leads only' };

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
    } catch (e) {
      app.innerHTML = '<div class="auth"><div class="auth-card"><h1>Can’t reach the server</h1><p>' + esc(e.message) + '</p></div></div>';
      return;
    }
    window.addEventListener('hashchange', route);
    route();
  }

  function route() {
    const h = (location.hash || '#dashboard').slice(1);
    S.route = h || 'dashboard';
    render();
  }

  function render() {
    closeDrawer();
    if (!S.user) return S.meta.needsSetup ? renderSetup() : renderLogin();
    const nav = [
      ['dashboard', 'Dashboard', '▦'], ['orders', 'Orders', '🧾'], ['products', 'Products', '▣'],
      ['leads', 'Leads', '✉'], ['team', 'Team', '👥'], ['activity', 'Activity', '↺'],
    ].filter(([k]) => can(k));
    if (!nav.some(([k]) => k === S.route)) S.route = nav[0][0];
    app.innerHTML =
      '<div class="mobilebar"><button id="menuBtn" aria-label="Menu">☰</button><b>Where To Spot</b></div>' +
      '<div class="shell"><nav class="side" id="side">' +
      '<div class="brand"><img src="../images/logo.png" alt="">Team</div>' +
      nav.map(([k, label, icon]) => '<a class="nav' + (S.route === k ? ' on' : '') + '" href="#' + k + '"><span aria-hidden="true">' + icon + '</span>' + label + '</a>').join('') +
      '<a class="nav" href="../index.html" target="_blank" rel="noopener"><span aria-hidden="true">↗</span>View shop</a>' +
      '<div class="foot"><b>' + esc(S.user.name) + '</b><br>' + esc(S.user.role) + ' · ' + esc(S.user.email) +
      '<div style="margin-top:8px"><button id="pwBtn">Change password</button><button id="outBtn">Sign out</button></div></div>' +
      '</nav><main class="main" id="main"><div class="boot">Loading…</div></main></div>';
    $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
    $$('#side a.nav').forEach((a) => a.addEventListener('click', () => $('#side').classList.remove('open')));
    $('#outBtn').onclick = async () => { await api('logout', { method: 'POST' }).catch(() => {}); S.user = null; S.csrf = null; render(); };
    $('#pwBtn').onclick = changePassword;
    const pages = { dashboard: pageDashboard, orders: pageOrders, products: pageProducts, leads: pageLeads, team: pageTeam, activity: pageActivity };
    pages[S.route]().catch((e) => { $('#main').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }

  function renderLogin() {
    app.innerHTML = '<div class="auth"><form class="auth-card stack" id="f">' +
      '<div><h1>Team sign in</h1><p>Where To Spot shop dashboard</p></div>' +
      '<label class="field">Email<input type="email" name="email" required autocomplete="username"></label>' +
      '<label class="field">Password<input type="password" name="password" required autocomplete="current-password"></label>' +
      '<div class="err" id="err"></div><button class="btn primary" type="submit">Sign in</button></form></div>';
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      $('#err').textContent = '';
      try { await api('login', { method: 'POST', body: formData(e.target) }); await boot(); }
      catch (err) { $('#err').textContent = err.message; }
    };
    $('input[name=email]').focus();
  }

  function renderSetup() {
    app.innerHTML = '<div class="auth"><form class="auth-card stack" id="f">' +
      '<div><h1>Create the owner account</h1><p>First-time setup. Enter the setup key from <code>' + esc(S.meta.setupKeyPath || 'SETUP_KEY.txt') + '</code> on the server (open it in cPanel → File Manager). The key stops working once this account exists.</p></div>' +
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

  function header(title, sub, actions) {
    return '<div class="top"><div><h1>' + esc(title) + '</h1>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div><div class="row">' + (actions || '') + '</div></div>';
  }

  // ---------- dashboard ----------
  async function pageDashboard() {
    const d = await api('dashboard', { query: '&days=' + S.range });
    const k = d.kpi;
    const statuses = S.meta.orderStatuses.map((s) => [s, d.statusCounts[s] || 0]);
    const maxStatus = Math.max(1, ...statuses.map((s) => s[1]));
    const rangeSeg = '<div class="seg" id="range">' + [7, 30, 90].map((n) => '<button data-d="' + n + '" class="' + (S.range === n ? 'on' : '') + '">' + n + ' days</button>').join('') + '</div>';
    const perf = d.performance || { members: [] };
    const monthName = new Date(perf.month + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const mine = d.own ? perf.members[0] : null;
    const actions = (can('sell') ? '<button class="btn primary" id="dashNew">+ New order</button>' : '') + rangeSeg;
    $('#main').innerHTML = header('Dashboard', 'Hello ' + esc(S.user.name.split(' ')[0]) + ' — here’s ' + (d.own ? 'your work in' : '') + ' the last ' + d.days + ' days.', actions) +
      (mine ? '<div class="me">' + targetCard('My orders · ' + monthName, mine.orders, mine.orders_target, (n) => n) +
        targetCard('My sales · ' + monthName, mine.revenue, mine.revenue_target, egp) + '</div>' : '') +
      '<div class="kpis">' +
      kpi('Revenue', egp(k.revenue), 'excl. cancelled & returned') +
      kpi('Orders', k.orders, 'avg ' + egp(k.aov)) +
      kpi('Waiting to confirm', k.pending, can('orders') ? '<a href="#orders" data-status="Pending">View pending →</a>' : 'orders') +
      kpi('New leads', k.newLeads, can('leads') ? '<a href="#leads">Open leads →</a>' : '') +
      kpi('Live products', k.products, can('products') ? '<a href="#products">Manage →</a>' : '') +
      '</div>' +
      '<div class="dash"><div class="cards">' +
      '<div class="card"><h2>Daily revenue (EGP)</h2><div class="chart" id="chart"></div></div>' +
      '<div class="card"><h2>Recent orders<span class="spacer"></span>' + (can('orders') ? '<a class="btn sm" href="#orders">All orders</a>' : '') + '</h2>' +
      (d.recentOrders.length ? '<div class="table-wrap" style="border:none"><table><tbody>' + d.recentOrders.map((o) =>
        '<tr><td><b>' + esc(o.number) + '</b><div class="small muted">' + esc(o.customer) + '</div></td><td>' + pill(ORDER_TONE, o.status) + '</td><td class="small muted">' + dateTime(o.createdAt) + '</td><td class="num"><b>' + egp(o.total) + '</b></td></tr>').join('') +
        '</tbody></table></div>' : '<div class="empty">No orders yet.</div>') + '</div>' +
      '</div><div class="cards">' +
      '<div class="card"><h2>Orders by status</h2>' + statuses.map(([s, n]) =>
        '<div class="hbar"><span>' + pill(ORDER_TONE, s) + '</span><div class="track"><div class="fill" style="width:' + (n / maxStatus * 100) + '%"></div></div><span class="num" style="text-align:right">' + n + '</span></div>').join('') + '</div>' +
      '<div class="card"><h2>Top products</h2>' + (d.topProducts.length ? '<div class="list">' + d.topProducts.map((p) =>
        '<div class="li"><span>' + esc(p.name) + ' <span class="muted small">× ' + p.qty + '</span></span><b>' + egp(p.revenue) + '</b></div>').join('') + '</div>' : '<div class="muted">No sales in this period.</div>') + '</div>' +
      '<div class="card"><h2>Low stock <span class="pill warn">⚠ 5 or fewer</span></h2>' + (d.lowStock.length ? '<div class="list">' + d.lowStock.map((p) =>
        '<div class="li"><span>' + esc(p.name) + '</span><b>' + p.stock + ' left</b></div>').join('') + '</div>' : '<div class="muted">All products are well stocked.</div>') + '</div>' +
      (d.sources && d.sources.length ? '<div class="card"><h2>Orders by source</h2><div class="list">' + d.sources.map((r) =>
        '<div class="li"><span>' + esc(r.source) + ' <span class="muted small">' + r.n + ' orders</span></span><b>' + egp(r.revenue) + '</b></div>').join('') + '</div></div>' : '') +
      '</div></div>' +
      (!d.own ? teamPerformanceCard(perf, monthName) : '');
    $$('#range button').forEach((b) => b.onclick = () => { S.range = +b.dataset.d; pageDashboard(); });
    const dn = $('#dashNew'); if (dn) dn.onclick = () => newOrderDrawer();
    const tb = $('#setTargets'); if (tb) tb.onclick = () => targetsDrawer(perf.month);
    const pend = $('[data-status=Pending]'); if (pend) pend.onclick = () => { S.orderStatus = 'Pending'; };
    drawChart($('#chart'), d.series);
  }
  const pct = (v, t) => t > 0 ? Math.min(100, Math.round(v / t * 100)) : 0;
  const progress = (v, t) => t > 0 ? '<div class="prog' + (v >= t ? ' done' : '') + '" role="progressbar" aria-valuenow="' + pct(v, t) + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + pct(v, t) + '%"></i></div>' : '';
  function targetCard(label, value, target, fmt) {
    return '<div class="kpi"><div class="label">' + esc(label) + '</div><div class="value">' + esc(fmt(value)) + (target ? ' <span class="muted" style="font-size:18px">/ ' + esc(fmt(target)) + '</span>' : '') + '</div>' +
      (target ? progress(value, target) + '<div class="note">' + (value >= target ? '✓ Target reached' : pct(value, target) + '% of target · ' + esc(fmt(Math.max(0, target - value))) + ' to go') + '</div>'
        : '<div class="note">No target set for this month</div>') + '</div>';
  }
  function teamPerformanceCard(perf, monthName) {
    const rows = perf.members.filter((m) => m.orders || m.orders_target || m.revenue_target || m.role === 'sales');
    return '<div class="card" style="margin-top:16px"><h2>Team this month · ' + esc(monthName) + '<span class="spacer"></span>' +
      (can('targets') ? '<button class="btn sm" id="setTargets">🎯 Set targets</button>' : '') + '</h2>' +
      (rows.length ? '<div class="table-wrap" style="border:none"><table class="perf"><thead><tr><th>Team member</th><th>Orders</th><th>Sales (EGP)</th><th class="num">Delivered</th><th class="num">Cancelled / returned</th><th>Last order</th></tr></thead><tbody>' +
        rows.map((m) => '<tr><td><b>' + esc(m.name) + '</b><div class="small muted">' + esc(m.role) + '</div></td>' +
          '<td>' + m.orders + (m.orders_target ? ' <span class="muted">/ ' + m.orders_target + '</span>' : '') + progress(m.orders, m.orders_target) + '</td>' +
          '<td>' + egp(m.revenue) + (m.revenue_target ? ' <span class="muted">/ ' + egp(m.revenue_target) + '</span>' : '') + progress(m.revenue, m.revenue_target) + '</td>' +
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
        new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) + '</option>').join('') + '</select></label>' +
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
  function drawChart(el, series) {
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
      if (i % every === 0) svg += '<text class="axis" x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + new Date(s.date + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) + '</text>';
    });
    svg += '</svg><div class="tip" id="tip"></div>';
    el.innerHTML = svg;
    const tip = $('#tip', el), svgEl = $('svg', el);
    $$('g[data-i]', el).forEach((g) => {
      g.addEventListener('mouseenter', () => {
        const s = series[+g.dataset.i], rect = svgEl.getBoundingClientRect(), k = rect.width / W;
        const x = (L + (+g.dataset.i + 0.5) * bw) * k, yy = y(s.revenue) * k;
        tip.innerHTML = '<b>' + new Date(s.date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) + '</b><br>' + egp(s.revenue) + ' · ' + s.orders + ' order' + (s.orders === 1 ? '' : 's');
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
    $('#main').innerHTML = header('Orders', d.orders.length + ' shown' + (can('own_orders') ? ' · only orders credited to you' : ''),
      '<div class="seg" id="view"><button data-v="list" class="' + (S.orderView !== 'board' ? 'on' : '') + '">List</button><button data-v="board" class="' + (S.orderView === 'board' ? 'on' : '') + '">Production board</button></div>' +
      '<a class="btn" href="' + API + '?action=orders&format=csv&status=' + encodeURIComponent(status) + '">Export CSV</a>' + (can('sell') ? '<button class="btn primary" id="newOrder">+ New order</button>' : '')) +
      '<div class="row" style="margin-bottom:14px"><div class="seg" id="tabs">' + tabs.map((t) => '<button data-s="' + t + '" class="' + (t === status ? 'on' : '') + '">' + (t || 'All') + '</button>').join('') + '</div>' +
      '<span class="spacer"></span><input type="search" id="q" placeholder="Search name, phone, email or WTS-…" value="' + esc(q) + '" style="max-width:300px"></div>' +
      (bosta.enabled ? '<div class="row card" id="bulk" style="display:none;margin-bottom:14px;padding:12px 16px"><b id="selCount"></b><span class="spacer"></span>' +
        '<button class="btn primary sm" id="bulkShip">🚚 Create Bosta shipments</button><button class="btn sm" id="bulkAwb">🖨 Print waybills</button></div>' : '') +
      (d.orders.length ? '<div class="table-wrap"><table><thead><tr>' + (bosta.enabled ? '<th style="width:34px"><input type="checkbox" id="selAll" aria-label="Select all"></th>' : '') +
        '<th>Order</th><th>Customer</th><th>Items</th><th>Status</th>' + (bosta.enabled ? '<th>Bosta</th>' : '') + '<th>Date</th><th class="num">Total</th></tr></thead><tbody>' +
        d.orders.map((o, i) => '<tr class="click" data-i="' + i + '">' + (bosta.enabled ? '<td data-nosel><input type="checkbox" class="sel" data-id="' + o.id + '" aria-label="Select ' + esc(o.number) + '"></td>' : '') +
          '<td><b>' + esc(o.number) + '</b></td><td>' + esc(o.customer) + '<div class="small muted">' + esc(o.phone) + ' · ' + esc([o.district, o.city].filter(Boolean).join(', ')) + '</div></td>' +
          '<td class="small">' + o.items.map((it) => esc(it.qty + '× ' + it.name)).join('<br>') + '</td><td>' + pill(ORDER_TONE, o.status) + '<div class="small muted">' + esc(o.source) + (o.rep ? ' · ' + esc(o.rep) : '') + '</div></td>' +
          (bosta.enabled ? '<td>' + bostaPill(o) + '</td>' : '') +
          '<td class="small muted">' + dateTime(o.createdAt) + '</td><td class="num"><b>' + egp(o.total) + '</b></td></tr>').join('') +
        '</tbody></table></div>' : '<div class="card empty">No orders match.</div>');
    $$('#tabs button').forEach((b) => b.onclick = () => { S.orderStatus = b.dataset.s; pageOrders(); });
    const nb = $('#newOrder'); if (nb) nb.onclick = () => newOrderDrawer();
    $$('#view button').forEach((b) => b.onclick = () => { S.orderView = b.dataset.v; S.orderStatus = ''; pageOrders(); });
    let t; $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { S.orderQ = e.target.value; pageOrders().then(() => { const el = $('#q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); }, 350); };
    $$('tr[data-i]').forEach((tr) => tr.onclick = (e) => { if (e.target.closest('[data-nosel]')) return; orderDrawer(d.orders[+tr.dataset.i]); });
    if (!bosta.enabled) return;
    const sync = () => {
      S.sel = new Set($$('.sel').filter((c) => c.checked).map((c) => +c.dataset.id));
      $('#bulk').style.display = S.sel.size ? 'flex' : 'none';
      $('#selCount').textContent = S.sel.size + ' selected';
    };
    $$('.sel').forEach((c) => c.onchange = sync);
    const all = $('#selAll'); if (all) all.onchange = () => { $$('.sel').forEach((c) => { c.checked = all.checked; }); sync(); };
    $('#bulkAwb').onclick = () => window.open(API + '?action=bosta_awb&ids=' + [...S.sel].join(','), '_blank');
    $('#bulkShip').onclick = () => bulkShip([...S.sel]);
  }

  // Kanban-style board: one column per open stage; move orders with the arrows or open them for details.
  const BOARD = ['Pending', 'Confirmed', 'Designing', 'Awaiting approval', 'In production', 'Ready', 'Shipped'];
  function pageBoard(orders, bosta) {
    const open = orders.filter((o) => BOARD.includes(o.status));
    $('#main').innerHTML = header('Orders', open.length + ' open orders' + (can('own_orders') ? ' · only orders credited to you' : ''),
      '<div class="seg" id="view"><button data-v="list">List</button><button data-v="board" class="on">Production board</button></div>' +
      (can('sell') ? '<button class="btn primary" id="newOrder">+ New order</button>' : '')) +
      '<div style="display:grid;grid-template-columns:repeat(' + BOARD.length + ',minmax(210px,1fr));gap:12px;overflow-x:auto;padding-bottom:10px">' +
      BOARD.map((st, si) => {
        const list = open.filter((o) => o.status === st);
        return '<div style="background:#EFEAE3;border-radius:14px;padding:10px;min-height:200px"><div class="row" style="margin-bottom:8px">' + pill(ORDER_TONE, st) + '<span class="spacer"></span><b class="small">' + list.length + '</b></div>' +
          list.map((o) => '<div class="card" style="padding:12px;margin-bottom:8px;cursor:pointer" data-open="' + o.id + '">' +
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
      '<div class="grid2"><label class="field">Package size<select id="bSize">' + ['SMALL', 'MEDIUM', 'LARGE'].map((z) => '<option' + (z === bosta.defaultSize ? ' selected' : '') + '>' + z + '</option>').join('') + '</select></label>' +
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
        '<div class="small muted">Updated ' + dateTime(o.bostaUpdatedAt) + ' · status changes arrive automatically</div>' +
        '<div class="row"><a class="btn sm primary" target="_blank" href="' + API + '?action=bosta_awb&ids=' + o.id + '">🖨 Print waybill</a>' +
        '<button class="btn sm" id="bRefresh">↻ Refresh status</button><a class="btn sm" target="_blank" rel="noopener" href="' + trackUrl(o.tracking) + '">Track on Bosta ↗</a>' +
        '<span class="spacer"></span>' + ([10, 11, 20].includes(o.bostaState) ? '<button class="btn sm danger" id="bCancel">Cancel shipment</button>' : '') + '</div></div>';
    }
    if (!physical) return '<div class="card small muted">🚚 Nothing to ship — this order only has marketing plans.</div>';
    if (o.status === 'Cancelled') return '<div class="card small muted">🚚 Cancelled orders can’t be shipped.</div>';
    const locOpts = (bosta.locations || []).map((l) => '<option value="' + esc(l.id) + '"' + ((bosta.defaultLocation ? l.id === bosta.defaultLocation : l.isDefault) ? ' selected' : '') + '>' + esc(l.name + (l.city ? ' — ' + l.city : '')) + '</option>').join('');
    return '<form id="bf" class="card stack"><h2 style="margin:0">🚚 Ship with Bosta</h2>' +
      '<div class="field" style="position:relative">Find area <span class="hint">Type in English or Arabic, e.g. Nasr City / مدينة نصر</span>' +
      '<input type="search" id="bSearch" autocomplete="off" placeholder="🔍 Search Bosta areas"><div id="bResults" class="card" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:5;padding:0;max-height:260px;overflow:auto"></div>' +
      '<div id="bSuggest" class="row small" style="margin-top:4px"></div></div>' +
      '<div class="grid3"><label class="field">Governorate<select name="city_id" id="bCity"><option value="">Loading…</option></select></label>' +
      '<label class="field">Area<select id="bZone" required><option value="">Choose governorate first</option></select></label>' +
      '<label class="field">Neighbourhood<select name="district_id" id="bDist" required><option value="">—</option></select></label></div>' +
      '<label class="field">Street address <span class="hint">More than 5 characters</span><input type="text" name="address" required minlength="6" value="' + esc(o.address) + '"></label>' +
      '<div class="grid3"><label class="field">Building<input type="text" name="building"></label><label class="field">Floor<input type="text" name="floor"></label><label class="field">Apartment<input type="text" name="apartment"></label></div>' +
      '<label class="field">Nearby landmark<input type="text" name="landmark"></label>' +
      '<div class="grid3"><label class="field">Package size<select name="size">' + ['SMALL', 'MEDIUM', 'LARGE'].map((z) => '<option' + (z === bosta.defaultSize ? ' selected' : '') + '>' + z + '</option>').join('') + '</select></label>' +
      '<label class="field">Cash to collect (EGP)<input type="number" name="cod" min="0" max="30000" step="0.01" value="' + esc(o.payment === 'cod' ? o.total : 0) + '"></label>' +
      '<label class="field">Pick up from<select name="location_id">' + locOpts + '</select></label></div>' +
      (bosta.locationsError ? '<div class="small" style="color:var(--bad)">' + esc(bosta.locationsError) + '</div>' : '') +
      '<label class="field">Notes for the courier<input type="text" name="notes" placeholder="e.g. Call before arriving"></label>' +
      '<div><button class="btn primary" type="submit" id="bCreate">Create Bosta shipment</button></div></form>';
  }

  async function orderDrawer(o) {
    const bosta = await bostaInfo();
    const body = '<div class="stack">' +
      '<div class="card"><div class="grid2"><div><div class="small muted">Customer</div><b>' + esc(o.customer) + '</b><div>' + esc(o.email) + '</div><div><a href="tel:' + esc(o.phone) + '">' + esc(o.phone) + '</a> · <a href="https://wa.me/' + esc(o.phone.replace(/\D/g, '').replace(/^0/, '20')) + '" target="_blank" rel="noopener">WhatsApp</a></div></div>' +
      '<div><div class="small muted">Deliver to</div>' + esc(o.address || '—') + '<div>' + esc([o.district, o.city].filter(Boolean).join(', ')) + '</div><div class="small muted" style="margin-top:6px">Placed ' + dateTime(o.createdAt) + ' · ' + esc(o.paymentLabel) + '</div>' +
      '<div class="small muted">Source: ' + esc(o.source) + (o.rep ? ' · credited to ' + esc(o.rep) : '') + (o.createdBy && o.createdBy !== o.rep ? ' · entered by ' + esc(o.createdBy) : '') + '</div></div></div></div>' +
      '<div class="card"><div class="list">' + o.items.map((it) => '<div class="li"><span>' + esc(it.qty + '× ' + it.name) + '</span><span>' + egp(it.total != null ? it.total : it.qty * it.price) + '</span></div>').join('') +
      '<div class="li muted"><span>Subtotal</span><span>' + egp(o.subtotal) + '</span></div>' +
      (o.discount ? '<div class="li muted"><span>Promo ' + esc(o.promo) + '</span><span>−' + egp(o.discount) + '</span></div>' : '') +
      '<div class="li muted"><span>Delivery</span><span>' + (o.shipping ? egp(o.shipping) : 'Free') + '</span></div>' +
      '<div class="li"><b>Total</b><b>' + egp(o.total) + '</b></div></div></div>' +
      bostaSection(o, bosta) +
      '<form id="of" class="stack">' +
      '<div class="card stack"><b>Personalisation</b>' +
      '<div class="grid2"><label class="field">Business / brand name<input type="text" name="business_name" value="' + esc(o.businessName) + '"></label>' +
      '<label class="field">Google review link' + (o.reviewLink ? ' <a class="hint" href="' + esc(/^https?:\/\//.test(o.reviewLink) ? o.reviewLink : 'https://' + o.reviewLink) + '" target="_blank" rel="noopener">open ↗</a>' : '') +
      '<input type="text" name="review_link" value="' + esc(o.reviewLink) + '"></label></div>' +
      '<label class="field">Social links / website<textarea name="links" style="min-height:50px">' + esc(o.links) + '</textarea></label>' +
      '<label class="field">Design notes<textarea name="design_notes" style="min-height:50px">' + esc(o.designNotes) + '</textarea></label>' +
      '<div><b class="small">Files</b><div class="list" id="oFiles"></div>' +
      '<div class="row" style="margin-top:8px"><select id="oFileKind" style="width:auto"><option>Logo</option><option selected>Design proof</option><option>Final design</option><option>Other</option></select>' +
      '<label class="btn sm" style="cursor:pointer">⬆ Upload file<input type="file" id="oFile" accept="image/jpeg,image/png,image/webp,application/pdf" hidden></label>' +
      '<span class="hint">JPG, PNG, WebP or PDF up to 5 MB</span></div></div></div>' +
      '<label class="field">Status<select name="status">' + S.meta.orderStatuses.map((s) => '<option' + (s === o.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
      '<span class="hint">Cancelling or returning puts the items back in stock.' + (o.tracking ? ' Bosta updates move this to Shipped, Delivered or Returned automatically.' : '') + '</span></label>' +
      '<label class="field">Internal notes<textarea name="notes" placeholder="e.g. Confirmed by phone">' + esc(o.notes) + '</textarea></label></form></div>';
    openDrawer('Order ' + o.number, body, '<span class="spacer"></span><button class="btn" data-close>Close</button><button class="btn primary" form="of" type="submit">Save</button>');
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
    const pickArea = (r) => {
      citySel.value = r.cityId; fillZones();
      zoneSel.value = r.zoneId; fillDistricts();
      distSel.value = r.districtId;
      $('#bResults').style.display = 'none'; $('#bSearch').value = '';
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
        $('#bSuggest').innerHTML = '<span class="muted">✨ From the address:</span>' + list.map((r, i) => '<button type="button" class="btn sm" data-s="' + i + '">' + esc(r.title + ' — ' + r.sub.replace(' · any neighbourhood', '')) + '</button>').join('');
        $$('[data-s]', $('#bSuggest')).forEach((b) => b.onclick = () => pickArea(list[+b.dataset.s]));
      }).catch(() => {});
    }

    bf.onsubmit = async (e) => {
      e.preventDefault();
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
  async function newOrderDrawer() {
    const cat = await api('order_catalog');
    const lines = [];
    let area = null; // { districtId, cityId, title, sub }
    const physicalProducts = () => lines.some((l) => (l.custom ? l.ship : l.p.cat !== 'services'));
    const lineCalc = (l) => l.custom ? { total: Math.round(l.price * l.qty), name: l.name } : priceLine(l.p, l.variant, l.addons, l.qty);
    const repOpts = can('targets') ? '<label class="field">Credit this sale to<select name="rep_id">' +
      cat.reps.map((r) => '<option value="' + r.id + '"' + (r.id === S.user.id ? ' selected' : '') + '>' + esc(r.name) + ' (' + esc(r.role) + ')</option>').join('') + '</select></label>' : '';
    const body = '<form id="nf" class="stack">' +
      '<div class="card stack"><b>Customer</b><div class="grid2"><label class="field">Name<input type="text" name="name" required></label>' +
      '<label class="field">Phone / WhatsApp<input type="tel" name="phone" required placeholder="01xxxxxxxxx"></label></div>' +
      '<label class="field">Email <span class="hint">Optional</span><input type="email" name="email"></label></div>' +
      '<div class="card stack"><b>Products</b><div class="row"><select id="nProd" style="flex:1;min-width:200px"><option value="">Choose a product…</option>' +
      cat.products.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + ' — ' + ((p.variants && p.variants.length) || (p.tiers && p.tiers.length) ? 'from ' + egp(p.fromPrice) : egp(p.price)) + (p.cat === 'services' ? ' / month' : ' · ' + p.stock + ' in stock') + '</option>').join('') +
      '</select><input type="number" id="nQty" min="1" value="1" style="width:80px" aria-label="Quantity"><button type="button" class="btn" id="nAdd">Add</button></div>' +
      '<div class="row" id="nOpts"></div><div class="small muted" id="nPreview"></div>' +
      '<div class="lines" id="nLines"></div>' +
      '<details id="nCustomBox"><summary class="small" style="cursor:pointer;font-weight:600">＋ Custom item (anything not in the catalog)</summary>' +
      '<div class="row" style="margin-top:8px"><input type="text" id="cName" placeholder="Description, e.g. 30 mixed stands with logo" style="flex:1;min-width:200px">' +
      '<input type="number" id="cQty" min="1" value="1" style="width:70px" aria-label="Custom quantity"><span class="small">× EGP</span><input type="number" id="cPrice" min="0" step="0.01" style="width:100px" placeholder="each" aria-label="Price each">' +
      '<label class="row small"><input type="checkbox" id="cShip" checked> needs delivery</label><button type="button" class="btn sm" id="cAdd">Add</button></div>' +
      '<div class="small muted" style="margin-top:4px">Tip: for "30 for EGP 7,000" enter 30 × 233.33 — totals round to whole pounds.</div></details></div>' +
      '<div class="card stack" id="nPers"><b>Personalisation</b> <span class="hint">What to print — shown on the order for the design team</span>' +
      '<div class="grid2"><label class="field">Business / brand name<input type="text" name="business_name"></label>' +
      '<label class="field">Google review link<input type="url" name="review_link" placeholder="https://g.page/r/…"></label></div>' +
      '<label class="field">Social links / website<textarea name="links" style="min-height:50px" placeholder="One per line"></textarea></label>' +
      '<label class="field">Design notes<textarea name="design_notes" style="min-height:50px" placeholder="Colours, text, logo comes on WhatsApp…"></textarea></label>' +
      '<span class="hint">You can upload the logo and design files on the order after it’s created.</span></div>' +
      '<div class="card stack" id="nDelivery"><b>Delivery</b>' +
      '<label class="field">Street address<textarea name="address" id="nAddr" style="min-height:60px" placeholder="Street, building, floor, apartment"></textarea></label>' +
      '<div class="field">Area <span class="hint">Search in English or Arabic, e.g. Nasr City / مدينة نصر</span><div class="pick" id="nPick"></div></div></div>' +
      '<div class="card stack"><b>Sale details</b><div class="grid3">' +
      '<label class="field">Source<select name="source">' + cat.sources.filter((x) => x !== 'Website').map((x) => '<option' + (x === 'WhatsApp' ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></label>' +
      '<label class="field">Payment<select name="payment" id="nPay">' + Object.entries(cat.payments).map(([k, v]) => '<option value="' + k + '">' + esc(v) + '</option>').join('') + '</select></label>' +
      '<label class="field">Status<select name="status"><option>Pending</option><option selected>Confirmed</option></select></label></div>' +
      '<div class="grid3"><label class="field">Discount (EGP)<input type="number" name="discount" id="nDisc" min="0" step="1" placeholder="0"></label>' +
      '<label class="field">Delivery fee (EGP)<input type="number" name="shipping" id="nShip" min="0" step="1" placeholder="auto"><span class="hint" id="nShipHint"></span></label>' +
      repOpts + '</div>' +
      '<label class="field">Notes<textarea name="notes" style="min-height:60px" placeholder="e.g. Customer wants delivery after 5pm"></textarea></label></div>' +
      '<div class="card" id="nTotals"></div></form>';
    openDrawer('New order', body, '<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" form="nf" type="submit" id="nSubmit">Create order</button>');

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
      const cod = $('#nPay').value === 'cod';
      $('#nTotals').innerHTML = '<div class="list"><div class="li muted"><span>Subtotal</span><span>' + egp(sub) + '</span></div>' +
        (disc ? '<div class="li muted"><span>Discount</span><span>−' + egp(disc) + '</span></div>' : '') +
        '<div class="li muted"><span>Delivery</span><span>' + (ship ? egp(ship) : 'Free') + '</span></div>' +
        '<div class="li"><b>Total</b><b>' + egp(sub - disc + ship) + '</b></div>' +
        '<div class="li small muted"><span>' + (cod ? 'Customer pays on delivery' : 'Already paid — courier collects nothing') + '</span><span></span></div></div>';
      $('#nDelivery').style.opacity = lines.length && !physicalProducts() ? '.55' : '1';
    };
    const renderLines = () => {
      $('#nLines').innerHTML = lines.length ? lines.map((l, i) => { const c = lineCalc(l);
        return '<div class="line"><span>' + esc(c.name) + (l.custom ? ' <span class="pill">custom</span>' : '') + '<div class="small muted">' + egp(c.total / l.qty) + ' each</div></span>' +
        '<input type="number" min="1" value="' + l.qty + '" data-q="' + i + '" aria-label="Quantity">' +
        '<b style="text-align:right">' + egp(c.total) + '</b><button type="button" class="btn sm" data-x="' + i + '" aria-label="Remove">✕</button></div>'; }).join('')
        : '<div class="small muted" style="padding:6px 0">No products yet.</div>';
      $$('[data-q]', $('#nLines')).forEach((inp) => inp.onchange = () => { lines[+inp.dataset.q].qty = Math.max(1, +inp.value || 1); renderLines(); });
      $$('[data-x]', $('#nLines')).forEach((b) => b.onclick = () => { lines.splice(+b.dataset.x, 1); renderLines(); });
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
    $('#nProd').onchange = () => {
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
      $('#nProd').value = ''; $('#nQty').value = 1; $('#nOpts').innerHTML = ''; preview();
      renderLines();
    };
    $('#cAdd').onclick = () => {
      const name = $('#cName').value.trim(), price = +$('#cPrice').value, qty = Math.max(1, +$('#cQty').value || 1);
      if (!name || !(price > 0)) return toast('Enter a description and a price for the custom item', true);
      lines.push({ custom: true, key: 'c' + Date.now(), name, price, qty, ship: $('#cShip').checked });
      $('#cName').value = ''; $('#cPrice').value = ''; $('#cQty').value = 1;
      renderLines();
    };
    ['#nDisc', '#nShip', '#nPay'].forEach((sel) => { $(sel).oninput = renderTotals; $(sel).onchange = renderTotals; });
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
        (suggestions && suggestions.length ? '<div class="row small"><span class="muted">✨ From the address:</span>' + suggestions.map((r, i) => '<button type="button" class="btn sm" data-sg="' + i + '">' + esc(r.title + ' — ' + r.sub.replace(' · any neighbourhood', '')) + '</button>').join('') + '</div>' : '');
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
      if (!lines.length) return toast('Add at least one product', true);
      if (physicalProducts() && !area) return toast('Choose the delivery area', true);
      const data = formData(e.target);
      data.items = lines.map((l) => l.custom ? { custom: 1, name: l.name, price: l.price, qty: l.qty, ship: l.ship ? 1 : 0 } : { id: l.p.id, variant: l.variant, addons: l.addons, qty: l.qty });
      if (area) { data.city_id = area.cityId; data.district_id = area.districtId; }
      if (data.shipping === '') delete data.shipping;
      const btn = $('#nSubmit'); btn.disabled = true; btn.textContent = 'Creating…';
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
  async function pageProducts() {
    const d = await api('products');
    S.products = d.products; S.cats = d.categories;
    const cat = S.prodCat || '';
    const q = (S.prodQ || '').toLowerCase();
    const list = d.products.filter((p) => (!cat || p.cat === cat) && (!q || (p.name + ' ' + p.sku + ' ' + p.vendor).toLowerCase().includes(q)));
    const catLabel = (k) => (d.categories.find((c) => c.key === k) || {}).label || k;
    $('#main').innerHTML = header('Products', d.products.length + ' products · ' + d.categories.length + ' categories',
      '<button class="btn" id="catsBtn">Categories</button><button class="btn primary" id="addBtn">+ Add product</button>') +
      '<div class="row" style="margin-bottom:14px"><select id="cat" style="max-width:220px"><option value="">All categories</option>' +
      d.categories.map((c) => '<option value="' + esc(c.key) + '"' + (c.key === cat ? ' selected' : '') + '>' + esc(c.label) + ' (' + c.count + ')</option>').join('') +
      '</select><span class="spacer"></span><input type="search" id="q" placeholder="Search name, SKU, brand" value="' + esc(S.prodQ || '') + '" style="max-width:280px"></div>' +
      (list.length ? '<div class="table-wrap"><table><thead><tr><th></th><th>Product</th><th>Category</th><th class="num">Price</th><th class="num">Stock</th><th>Status</th></tr></thead><tbody>' +
        list.map((p) => {
          const img = p.images[0] ? '../' + p.images[0].path : '';
          const sale = (p.variants && p.variants.length) || (p.tiers && p.tiers.length) ? p.fromPrice : (p.discountPct ? Math.round(p.price * (1 - p.discountPct / 100)) : p.price);
          return '<tr class="click" data-id="' + esc(p.id) + '"><td style="width:60px">' + (img ? '<img class="thumb" src="' + esc(img) + '" alt="">' : '<div class="thumb"></div>') + '</td>' +
            '<td><b>' + esc(p.name) + '</b><div class="small muted">' + esc([p.sku, p.vendor].filter(Boolean).join(' · ')) + ' · ' + p.images.length + ' photo' + (p.images.length === 1 ? '' : 's') + '</div></td>' +
            '<td>' + esc(catLabel(p.cat)) + (p.variants && p.variants.length ? '<div class="small muted">' + p.variants.length + ' sizes</div>' : '') + '</td><td class="num">' + ((p.variants && p.variants.length) || (p.tiers && p.tiers.length) ? '<span class="small muted">from </span>' : '') + egp(sale) + (p.discountPct ? '<div class="small muted"><s>' + egp(p.price) + '</s></div>' : '') + (p.period ? '<div class="small muted">/ month</div>' : '') + '</td>' +
            '<td class="num">' + (p.cat === 'services' ? '—' : (p.stock <= 5 ? '<span class="pill warn">⚠ ' + p.stock + '</span>' : p.stock)) + '</td><td>' + pill(PRODUCT_TONE, p.status) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="card empty">No products here yet. <button class="btn primary sm" id="addBtn2">Add one</button></div>');
    $('#cat').onchange = (e) => { S.prodCat = e.target.value; pageProducts(); };
    let t; $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { S.prodQ = e.target.value; pageProducts().then(() => { const el = $('#q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); }, 250); };
    $('#addBtn').onclick = () => productDrawer(null);
    const a2 = $('#addBtn2'); if (a2) a2.onclick = () => productDrawer(null);
    $('#catsBtn').onclick = categoriesDrawer;
    $$('tr[data-id]').forEach((tr) => tr.onclick = () => productDrawer(S.products.find((p) => p.id === tr.dataset.id)));
  }

  function productDrawer(p) {
    const isNew = !p;
    p = p || { id: '', name: '', sku: '', vendor: '', cat: S.prodCat || (S.cats[0] || {}).key, price: '', cost: '', stock: 0, discountPct: 0, label: '', status: 'Active', sub: '', desc: '', features: [], images: [], variants: [], tiers: [], addons: [], personalized: false };
    // Working copy of sizes / quantity prices / extras, edited in the "Sizes & prices" card.
    const opt = {
      variants: JSON.parse(JSON.stringify(p.variants || [])),
      tiers: JSON.parse(JSON.stringify(p.tiers || [])),
      addons: JSON.parse(JSON.stringify(p.addons || [])),
    };
    const body = '<form id="pf" class="stack">' +
      '<label class="field">Product name<input type="text" name="name" required value="' + esc(p.name) + '"></label>' +
      '<div class="grid2"><label class="field">Category<select name="cat">' + S.cats.map((c) => '<option value="' + esc(c.key) + '"' + (c.key === p.cat ? ' selected' : '') + '>' + esc(c.label) + '</option>').join('') + '</select></label>' +
      '<label class="field">Status<select name="status">' + ['Active', 'Draft', 'Archived'].map((s) => '<option' + (s === p.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select><span class="hint">Only Active products show in the shop.</span></label></div>' +
      '<div class="grid3"><label class="field">Price (EGP)<input type="number" name="price" min="0" step="0.01" value="' + esc(p.price) + '"><span class="hint" id="priceHint">Price for one piece</span></label>' +
      '<label class="field">Discount %<input type="number" name="discountPct" min="0" max="90" step="0.01" value="' + esc(p.discountPct) + '"></label>' +
      '<label class="field" id="stockField">Stock<input type="number" name="stock" min="0" step="1" value="' + esc(p.stock) + '"><span class="hint">Ignored for plans</span></label></div>' +
      '<div class="card stack" id="optCard"></div>' +
      '<label class="row" style="font-weight:600"><input type="checkbox" name="personalized" ' + (p.personalized ? 'checked' : '') + '> Needs personalisation <span class="hint" style="font-weight:400">Checkout asks for business name, review link, logo and design notes</span></label>' +
      '<div class="grid3"><label class="field">Cost (EGP)<input type="number" name="cost" min="0" step="0.01" value="' + esc(p.cost) + '"><span class="hint">Private — not shown in shop</span></label>' +
      '<label class="field">SKU<input type="text" name="sku" value="' + esc(p.sku) + '"></label>' +
      '<label class="field">Brand / vendor<input type="text" name="vendor" value="' + esc(p.vendor) + '"></label></div>' +
      '<div class="grid2"><label class="field">Short line<input type="text" name="sub" value="' + esc(p.sub) + '" placeholder="e.g. 150ml, hydrating cleanser"></label>' +
      '<label class="field">Badge<input type="text" name="label" value="' + esc(p.label) + '" placeholder="e.g. 3+1 Free, New"></label></div>' +
      '<label class="field">Description<textarea name="desc">' + esc(p.desc) + '</textarea></label>' +
      '<label class="field">Features / bullet points <span class="hint">One per line (shown on plan cards)</span><textarea name="features" style="min-height:70px">' + esc((p.features || []).join('\n')) + '</textarea></label>' +
      '</form>' +
      '<div class="stack" style="margin-top:22px"><div class="row"><b>Photos</b><span class="muted small">First photo is the cover. JPG, PNG or WebP up to 5 MB — big photos are resized automatically.</span></div>' +
      (isNew ? '<div class="card muted small">Save the product first, then add photos.</div>' : '<div class="photos" id="photos"></div>') + '</div>';
    const foot = (isNew ? '' : '<button class="btn danger" id="delBtn">Delete</button>') + '<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" form="pf" type="submit">' + (isNew ? 'Create product' : 'Save changes') + '</button>';
    openDrawer(isNew ? 'Add product' : p.name, body, foot);
    $$('#drawer [data-close]').forEach((b) => b.addEventListener('click', closeDrawer));
    if (!isNew) renderPhotos(p);
    renderOptions(opt);
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
    card.innerHTML = '<div class="row"><b>Sizes &amp; prices</b><span class="spacer"></span>' +
      '<label class="row small" style="font-weight:600"><input type="checkbox" id="optSizes" ' + (hasSizes ? 'checked' : '') + '> Comes in sizes</label></div>' +
      (hasSizes ? opt.variants.map((v, i) => '<div class="card" style="padding:12px;background:#FBF8F4">' +
          '<div class="row"><input type="text" placeholder="Size, e.g. 15×10 cm" style="flex:1;min-width:140px" data-path="variants.' + i + '.label" value="' + esc(v.label) + '">' +
          '<input type="text" placeholder="SKU" style="width:110px" data-path="variants.' + i + '.sku" value="' + esc(v.sku || '') + '">' +
          '<span class="small">Stock</span><input type="number" min="0" style="width:80px" data-path="variants.' + i + '.stock" value="' + esc(v.stock || 0) + '">' +
          '<button type="button" class="btn sm danger" data-del="variants.' + i + '">Remove size</button></div>' +
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
    if (addSize) addSize.onclick = () => { opt.variants.push({ label: '', sku: '', stock: 0, tiers: [{ min: 1, price: '' }] }); renderOptions(opt); };
    $('#optSizes').onchange = (e) => {
      if (e.target.checked && !opt.variants.length) opt.variants.push({ label: '', sku: '', stock: 0, tiers: opt.tiers.length ? opt.tiers : [{ min: 1, price: '' }] });
      if (!e.target.checked && opt.variants.length && !confirm('Remove all sizes and their prices and stock?')) { e.target.checked = true; return; }
      if (!e.target.checked) opt.variants = [];
      renderOptions(opt);
    };
    $$('[data-add-option]', card).forEach((b) => b.onclick = () => { opt.addons[+b.dataset.addOption].options.push({ label: '', price: 0, per: 'unit' }); renderOptions(opt); });
    $('[data-add-group]', card).onclick = () => { opt.addons.push({ group: '', options: [{ label: '', price: 0, per: 'unit' }] }); renderOptions(opt); };
    const design = $('[data-add-design]', card);
    if (design) design.onclick = () => { opt.addons.push({ group: 'Design', options: [{ label: 'Standard design', price: 0, per: 'unit' }, { label: 'Custom design', price: 100, per: 'unit' }] }); renderOptions(opt); };
    const sf = $('#stockField'); if (sf) sf.style.display = hasSizes ? 'none' : '';
    const ph = $('#priceHint'); if (ph) ph.textContent = hasSizes || opt.tiers.length ? 'Optional — the lowest size / quantity price is used' : 'Price for one piece';
  }

  function renderPhotos(p) {
    const box = $('#photos');
    if (!box) return;
    box.innerHTML = p.images.map((im, i) =>
      '<div class="photo">' + (i === 0 ? '<span class="cover">Cover</span>' : '') + '<img src="../' + esc(im.path) + '" alt="">' +
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
    const rows = S.cats.map((c) => '<tr><td><input type="text" data-k="' + esc(c.key) + '" data-f="label" value="' + esc(c.label) + '"></td>' +
      '<td><input type="text" data-k="' + esc(c.key) + '" data-f="descr" value="' + esc(c.descr) + '"></td>' +
      '<td style="width:80px"><input type="number" data-k="' + esc(c.key) + '" data-f="sort" value="' + esc(c.sort) + '"></td>' +
      '<td class="num">' + c.count + '</td><td><button class="btn sm" data-save="' + esc(c.key) + '">Save</button> ' +
      (c.key !== 'services' ? '<button class="btn sm danger" data-rm="' + esc(c.key) + '">Delete</button>' : '') + '</td></tr>').join('');
    openDrawer('Categories',
      '<p class="muted" style="margin-top:0">Categories with at least one Active product appear in the shop. Order sets their position.</p>' +
      '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Description</th><th>Order</th><th class="num">Products</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<form id="cf" class="card stack" style="margin-top:18px"><b>New category</b><div class="grid2"><input type="text" name="label" placeholder="Name" required><input type="text" name="descr" placeholder="Short description"></div>' +
      '<div><button class="btn primary" type="submit">Add category</button></div></form>');
    const get = (k, f) => ($('[data-k="' + k + '"][data-f="' + f + '"]') || {}).value;
    $$('[data-save]').forEach((b) => b.onclick = async () => {
      const k = b.dataset.save;
      try { await api('category_save', { method: 'POST', body: { key: k, label: get(k, 'label'), descr: get(k, 'descr'), sort: get(k, 'sort') } }); toast('Category saved'); await pageProducts(); categoriesDrawer(); }
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

  async function pageLeads() {
    const [d] = await Promise.all([api('leads'), loadTeam()]);
    const st = S.leadStatus || '';
    const list = d.leads.filter((l) => !st || l.status === st);
    $('#main').innerHTML = header('Leads', 'Bulk-order requests from the shop, plus leads your team adds.',
      '<a class="btn" href="' + API + '?action=leads&format=csv">Export CSV</a><button class="btn primary" id="addLead">+ Add lead</button>') +
      '<div class="row" style="margin-bottom:14px"><div class="seg" id="tabs">' + [''].concat(S.meta.leadStatuses).map((t) => '<button data-s="' + t + '" class="' + (t === st ? 'on' : '') + '">' + (t || 'All') + '</button>').join('') + '</div></div>' +
      (list.length ? '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Contact</th><th>Interest</th><th>Status</th><th>Assigned</th><th>Received</th></tr></thead><tbody>' +
        list.map((l) => '<tr class="click" data-id="' + l.id + '"><td><b>' + esc(l.name) + '</b><div class="small muted">' + esc(l.source) + '</div></td><td>' + esc(l.contact) + '</td><td>' + esc(l.cat) + '</td><td>' + pill(LEAD_TONE, l.status) + '</td><td>' + esc(l.assigned_name || '—') + '</td><td class="small muted">' + dateTime(l.created_at) + '</td></tr>').join('') +
        '</tbody></table></div>' : '<div class="card empty">No leads here.</div>');
    $$('#tabs button').forEach((b) => b.onclick = () => { S.leadStatus = b.dataset.s; pageLeads(); });
    $('#addLead').onclick = () => leadDrawer(null);
    $$('tr[data-id]').forEach((tr) => tr.onclick = () => leadDrawer(d.leads.find((l) => l.id === +tr.dataset.id)));
  }

  function leadDrawer(l) {
    const isNew = !l;
    l = l || { name: '', contact: '', cat: '', status: 'New', notes: '', assigned_to: '' };
    const teamOpts = '<option value="">— Nobody —</option>' + S.team.filter((u) => u.active !== 0).map((u) => '<option value="' + u.id + '"' + (+l.assigned_to === u.id ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('');
    const body = '<form id="lf" class="stack">' +
      (isNew ? '<div class="grid2"><label class="field">Name<input type="text" name="name" required></label><label class="field">Email or phone<input type="text" name="contact" required></label></div>' +
        '<label class="field">Interested in<input type="text" name="cat" placeholder="e.g. NFC cards for 3 branches"></label>'
        : '<div class="card"><b>' + esc(l.name) + '</b><div>' + esc(l.contact) + '</div><div class="small muted">' + esc(l.cat) + ' · ' + esc(l.source) + ' · ' + dateTime(l.created_at) + '</div></div>') +
      '<div class="grid2"><label class="field">Status<select name="status">' + S.meta.leadStatuses.map((s) => '<option' + (s === l.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label>' +
      '<label class="field">Assigned to<select name="assigned_to">' + teamOpts + '</select></label></div>' +
      '<label class="field">Notes<textarea name="notes">' + esc(l.notes) + '</textarea></label></form>';
    openDrawer(isNew ? 'Add lead' : 'Lead', body, (isNew || !can('leads') ? '' : '<button class="btn danger" id="delLead">Delete</button>') + '<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" form="lf" type="submit">Save</button>');
    $$('#drawer [data-close]').forEach((b) => b.addEventListener('click', closeDrawer));
    $('#lf').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('lead_save', { method: 'POST', body: Object.assign({ id: l.id || 0 }, formData(e.target)) }); closeDrawer(); toast('Lead saved'); pageLeads(); }
      catch (err) { toast(err.message, true); }
    };
    const del = $('#delLead');
    if (del) del.onclick = async () => {
      if (!confirm('Delete this lead?')) return;
      try { await api('lead_delete', { method: 'POST', body: { id: l.id } }); closeDrawer(); toast('Lead deleted'); pageLeads(); }
      catch (err) { toast(err.message, true); }
    };
  }

  // ---------- team ----------
  async function pageTeam() {
    await loadTeam();
    $('#main').innerHTML = header('Team', 'Who can sign in to this dashboard, and what they can do.', (can('targets') ? '<button class="btn" id="teamTargets">🎯 Monthly targets</button>' : '') + '<button class="btn" id="testMail">Send test alert to me</button><button class="btn primary" id="addU">+ Add team member</button>') +
      '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Referral code</th><th>Order alerts</th><th>Status</th><th>Last sign-in</th></tr></thead><tbody>' +
      S.team.map((u) => '<tr class="click" data-id="' + u.id + '"><td><b>' + esc(u.name) + '</b>' + (u.id === S.user.id ? ' <span class="pill">You</span>' : '') + '<div class="small muted">' + esc(u.email) + (u.phone ? ' · ' + esc(u.phone) : '') + '</div></td>' +
        '<td><b>' + esc(u.role) + '</b><div class="small muted">' + esc(ROLE_INFO[u.role]) + '</div></td><td>' + (u.ref_code ? '<code>' + esc(u.ref_code) + '</code>' : '—') + '</td>' +
        '<td>' + (u.notify ? '<span class="pill info">✉ Email</span>' : '<span class="muted">Off</span>') + '</td>' +
        '<td>' + (u.active ? '<span class="pill good">✓ Active</span>' : '<span class="pill bad">✕ Disabled</span>') + '</td><td class="small muted">' + dateTime(u.last_login) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<p class="muted small" style="margin-top:14px">Referral codes: when a customer enters a team member’s code at checkout, the order is credited to them. Orders a team member enters in the dashboard are credited to them too, and count toward their monthly target.</p>';
    $('#addU').onclick = () => userDrawer(null);
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
      '<label class="row" style="font-weight:600"><input type="checkbox" name="active" ' + (u.active ? 'checked' : '') + '> Can sign in</label></form>';
    openDrawer(isNew ? 'Add team member' : u.name, body, '<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" form="uf" type="submit">Save</button>');
    $$('#drawer [data-close]').forEach((b) => b.addEventListener('click', closeDrawer));
    $('#uf').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('team_save', { method: 'POST', body: Object.assign({ id: u.id || 0 }, formData(e.target)) }); closeDrawer(); toast('Team member saved'); pageTeam(); }
      catch (err) { toast(err.message, true); }
    };
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
