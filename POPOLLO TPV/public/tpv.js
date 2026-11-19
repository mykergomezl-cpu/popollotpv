// POPOLLO · Terminal punto de venta
(() => {
  const { LS, api, eur, num, esc, toast, modal, confirmBox, time, dateEs, ticketHtml, printHtml, CHANNEL_LABEL, CHANNEL_COLOR, METHOD_LABEL, KITCHEN_LABEL } = POP;
  const app = document.getElementById('app');
  const PLATFORMS = ['glovo', 'ubereats', 'justeat'];
  const S = {
    store: LS.get('tpv.store'), user: null, catalog: null, cash: null,
    channel: 'local', cat: null, lines: [], customer: null, notes: '', platform_ref: '',
    discount_pct: 0, auth_pin: null, activeCount: 0, search: '', pay: 'efectivo'
  };
  let poll = null;

  // -------------------------------------------------------------- arranque
  async function boot() {
    const t = LS.get('tpv.token');
    if (t && S.store) {
      POP.setToken(t);
      try { S.user = await api('/me'); return afterLogin(); } catch { POP.setToken(null, 'tpv.token'); }
    }
    if (!S.store) return renderStores();
    renderLogin();
  }

  async function renderStores() {
    app.innerHTML = `<div class="login"><div class="logo"><img src="/logo.svg" alt="">popolló</div><h2>¿En qué local está esta caja?</h2><div class="store-list" id="sl">Cargando…</div></div>`;
    try {
      const stores = await api('/public/stores');
      const sl = document.getElementById('sl');
      sl.innerHTML = stores.map((s) => `<button data-id="${s.id}">${esc(s.name)}<small>${esc(s.code)} · ${esc(s.city || '')} · ${esc(s.status)}</small></button>`).join('');
      sl.querySelectorAll('button').forEach((b) => b.onclick = () => {
        S.store = stores.find((s) => s.id === Number(b.dataset.id)); LS.set('tpv.store', S.store); renderLogin();
      });
    } catch (e) { toast(e.message, 'error'); }
  }

  async function renderLogin() {
    stopPoll();
    app.innerHTML = `<div class="login"><div class="logo"><img src="/logo.svg" alt="">popolló</div>
      <button class="store-tag" id="chg">${esc(S.store.name)} · cambiar</button>
      <h2>¿Quién eres?</h2><div class="user-grid" id="ug"></div></div>`;
    document.getElementById('chg').onclick = () => pinPrompt('PIN de encargado para cambiar de local', async (pin) => {
      const users = await api('/public/users?store_id=' + S.store.id);
      for (const u of users.filter((x) => x.role !== 'cajero')) {
        try { const r = await api('/login', { body: { user_id: u.id, pin } }); POP.setToken(r.token); await api('/logout', { body: {} }); POP.setToken(null); LS.del('tpv.store'); S.store = null; return renderStores(); } catch { /* siguiente */ }
      }
      throw new Error('PIN incorrecto');
    });
    try {
      const users = await api('/public/users?store_id=' + S.store.id);
      const ug = document.getElementById('ug');
      ug.innerHTML = users.map((u) => `<button class="user-tile" data-id="${u.id}"><span class="avatar" style="background:${esc(u.color)}">${esc(u.name[0])}</span>${esc(u.name)}<small>${esc(u.role)}</small></button>`).join('');
      ug.querySelectorAll('button').forEach((b) => b.onclick = () => {
        const u = users.find((x) => x.id === Number(b.dataset.id));
        pinPrompt(`Hola, ${u.name}`, async (pin) => {
          const r = await api('/login', { body: { user_id: u.id, pin } });
          POP.setToken(r.token, 'tpv.token'); S.user = r.user; afterLogin();
        });
      });
    } catch (e) { document.getElementById('ug').innerHTML = `<p>${esc(e.message)}</p>`; }
  }

  // Teclado de PIN reutilizable (acceso y autorizaciones de encargado)
  function pinPrompt(title, onPin, { sub = 'Introduce tu PIN', onCancel } = {}) {
    let pin = '', ok = false;
    const m = modal(`<div class="modal-head"><h2>${esc(title)}</h2><button class="x" data-close>×</button></div>
      <div class="modal-body"><p class="center muted" style="margin:0">${esc(sub)}</p><div class="pin-dots">${'<span></span>'.repeat(4)}</div>
      <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}<button data-k="c">C</button><button data-k="0">0</button><button data-k="ok" style="background:var(--green);color:#fff">✓</button></div></div>`, { onClose: () => { if (!ok && onCancel) onCancel(); } });
    const dots = m.el.querySelector('.pin-dots');
    const paint = () => { const n = Math.max(4, pin.length); dots.innerHTML = Array.from({ length: n }, (_, i) => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join(''); };
    const submit = async () => {
      if (!pin) return;
      try { await onPin(pin); ok = true; m.close(); }
      catch (e) { pin = ''; paint(); dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); toast(e.message, 'error'); }
    };
    const press = (k) => { if (k === 'c') pin = ''; else if (k === 'ok') return submit(); else if (pin.length < 8) pin += k; paint(); if (pin.length === 4 && title.startsWith('Hola')) submit(); };
    m.el.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => press(b.dataset.k));
    const onKey = (e) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') { pin = pin.slice(0, -1); paint(); } else if (e.key === 'Enter') submit(); };
    document.addEventListener('keydown', onKey);
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { document.removeEventListener('keydown', onKey); obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
  }
  const askSupervisor = (why) => new Promise((resolve) => {
    if (S.user.role !== 'cajero') return resolve(null);
    pinPrompt('Autorización de encargado', async (pin) => resolve(pin), { sub: why, onCancel: () => resolve(false) });
  });

  async function afterLogin() {
    try {
      S.catalog = await api('/catalog');
      S.cash = await api('/cash/current?store_id=' + S.store.id);
    } catch (e) { toast(e.message, 'error'); return logout(); }
    if (!S.cash) return renderOpenCash();
    renderSale();
  }

  async function logout() {
    try { await api('/logout', { body: {} }); } catch { /* */ }
    POP.setToken(null, 'tpv.token'); S.user = null; renderLogin();
  }

  // ------------------------------------------------------------ apertura caja
  function renderOpenCash() {
    app.innerHTML = `<div class="login"><div class="logo"><img src="/logo.svg" alt="">popolló</div>
      <div class="modal" style="animation:none"><div class="modal-head"><h2>Abrir caja · ${esc(S.store.name)}</h2></div>
      <div class="modal-body"><p class="muted" style="margin-top:0">Cuenta el dinero del cajón e indica el fondo inicial.</p>
      <div class="amount-box"><small>FONDO DE CAJA</small><span id="fv">0,00 €</span></div>
      <div class="pinpad" id="np"></div></div>
      <div class="modal-foot"><button class="btn btn-ghost" id="out">Salir</button><button class="btn btn-ok btn-lg" id="go">Abrir caja</button></div></div></div>`;
    const np = numpad(document.getElementById('np'), (v) => document.getElementById('fv').textContent = eur(v));
    document.getElementById('out').onclick = logout;
    document.getElementById('go').onclick = async () => {
      try { S.cash = await api('/cash/open', { body: { store_id: S.store.id, opening_float: np.value() } }); toast('Caja abierta'); renderSale(); }
      catch (e) { toast(e.message, 'error'); }
    };
  }

  // Teclado numérico para importes
  function numpad(el, onChange, { initial = '' } = {}) {
    let s = initial;
    el.innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'].map((k) => `<button data-k="${k}">${k}</button>`).join('');
    const val = () => Number(s.replace(',', '.')) || 0;
    el.querySelectorAll('button').forEach((b) => b.onclick = () => {
      const k = b.dataset.k;
      if (k === '⌫') s = s.slice(0, -1);
      else if (k === ',') { if (!s.includes(',')) s = (s || '0') + ','; }
      else if (!(s.includes(',') && s.split(',')[1].length >= 2)) s += k;
      onChange(val(), s);
    });
    return { value: val, set(v) { s = v; onChange(val(), s); }, raw: () => s };
  }

  // ------------------------------------------------------------- iconos
  const ICON = {
    cart: '<path d="M3 4h2l2.4 11h11l2-8H6.2"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/>',
    list: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    cash: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    truck: '<path d="M3 7h13v10H3z"/><path d="M16 10h3l2 3v4h-5"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
    chev: '<path d="M6 9l6 6 6-6"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    minus: '<path d="M5 12h14"/>',
    note: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
    card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>',
    bill: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5M18 9.5v5"/>',
    phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18h2"/>',
    pollo: '<path d="M15 3.5a5.5 5.5 0 0 1 5.5 5.5c0 3.4-3 6-6.4 5.5l-3.6 3.6a2.2 2.2 0 1 1-2.9 2.9 2.2 2.2 0 1 1-2.9-2.9 2.2 2.2 0 1 1 2.9-2.9l3.6-3.6C10.6 8 12 3.5 15 3.5z"/>',
    guarn: '<path d="M5.5 10h13L17 21H7z"/><path d="M8 10V4.5M11 10V3M14 10V4M16.5 10V5.5"/>',
    salsa: '<path d="M4 11h16"/><path d="M5.5 11l1.5 8h10l1.5-8"/><path d="M8.5 11c0-2.5 1.6-4.5 3.5-4.5s3.5 2 3.5 4.5"/>',
    bebida: '<path d="M6.5 6h11L16 21H8z"/><path d="M7 11h10"/><path d="M12.5 6l2-3.5h3"/>',
    plato: '<path d="M3 12h18a9 8 0 0 1-18 0z"/><path d="M8 8c0-1.5 1-2.5 2-2.5M13 7c0-2 1-3 2.5-3"/>'
  };
  const svg = (name, size = 20, sw = 1.9) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
  const LOGO = '<svg width="40" height="40" viewBox="0 0 140 140" role="img" aria-label="POPOLLO"><rect width="140" height="140" rx="32" fill="#E2401B"/><g transform="translate(15,0)"><circle cx="36" cy="48" r="10" fill="#FFC93C"/><circle cx="50" cy="40" r="12" fill="#FFC93C"/><circle cx="64" cy="48" r="10" fill="#FFC93C"/><polygon points="88,90 108,99 88,108" fill="#2B1A12"/><circle cx="50" cy="98" r="33" fill="none" stroke="#FFC93C" stroke-width="20"/><circle cx="58" cy="92" r="6" fill="#2B1A12"/></g></svg>';

  // Tono claro de fondo y tono oscuro de icono a partir del color de la categoría
  const mix = (hex, to, t) => {
    const a = hex.replace('#', ''), b = to.replace('#', '');
    const c = [0, 2, 4].map((i) => Math.round(parseInt(a.substr(i, 2), 16) * (1 - t) + parseInt(b.substr(i, 2), 16) * t));
    return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
  };
  const catOf = (p) => S.catalog.categories.find((c) => c.id === p.category_id);
  const kindOf = (p) => {
    const n = (catOf(p)?.name || '').toLowerCase();
    if (n.includes('pollo')) return 'pollo';
    if (n.includes('guarn') || n.includes('patata')) return 'guarn';
    if (n.includes('salsa')) return 'salsa';
    if (n.includes('bebida')) return 'bebida';
    return 'plato';
  };
  const tintOf = (p) => { const base = p.color || catOf(p)?.color || '#FFC93C'; return `--bg:${mix(base, '#ffffff', 0.84)};--fg:${mix(base, '#000000', 0.45)}`; };
  const CH_DARK = { local: '#2B1A12', llevar: '#B8300F', domicilio: '#B8300F', glovo: '#6B4E00', ubereats: '#0B6B3E', justeat: '#A33F00' };

  // ------------------------------------------------------------- pantalla venta
  function renderSale() {
    const u = S.user;
    const boss = u.role !== 'cajero';
    const today = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    app.innerHTML = `
      <header class="topbar">
        <div class="brand">${LOGO}<div><b>popolló</b><small>${esc(S.store.name.replace(/^POPOLLO\s*/i, ''))}</small></div></div>
        <nav class="channels" id="channels" aria-label="Canal de venta"></nav>
        <div class="top-actions">
          <button class="icon-btn" id="b-orders">${svg('truck')} Pedidos <span class="badge hidden" id="badge">0</span></button>
          <div class="me"><span class="avatar">${esc(u.name[0])}</span><div><b>${esc(u.name)}</b><small>Caja abierta · ${time(S.cash?.session?.opened_at)}</small></div></div>
        </div>
      </header>
      <div class="brand-line"></div>
      <div class="sale">
        <aside class="side" aria-label="Menú">
          <label class="search">${svg('search', 18, 2)}<input id="q" type="search" placeholder="Buscar producto" aria-label="Buscar producto" value="${esc(S.search)}"></label>
          <span class="side-h">Menú</span>
          <button class="nav on" data-a="sale" aria-current="page">${svg('cart')}<span>Nueva venta</span></button>
          <button class="nav" data-a="orders">${svg('list')}<span>Pedidos en curso</span><b class="nav-badge hidden" id="badge2">0</b></button>
          <button class="nav" data-a="tickets">${svg('receipt')}<span>Tickets y devoluciones</span></button>
          <button class="nav" data-a="cash">${svg('cash')}<span>Caja y cierre</span></button>
          <button class="nav" data-a="waste">${svg('trash')}<span>Registrar merma</span></button>
          <button class="nav" data-a="disc">${svg('tag')}<span>Descuento</span></button>
          ${boss ? `<button class="nav" data-a="admin">${svg('chart')}<span>Administración</span></button>` : ''}
          <div class="side-foot">
            <button class="nav" data-a="lock">${svg('lock')}<span>Cambiar de usuario</span></button>
            <div class="store-card"><span>${esc(S.store.code.slice(0, 2))}</span><div><b>Local ${esc(S.store.code)}</b><small>${esc(S.store.city || '')}</small></div></div>
          </div>
        </aside>
        <main class="catalog">
          <div class="cat-head"><h1>Nueva venta</h1><span>${esc(today.charAt(0).toUpperCase() + today.slice(1))}</span></div>
          <div class="cats" id="cats"></div>
          <div class="sep"></div>
          <div class="products-wrap"><div class="products" id="products"></div></div>
        </main>
        <section class="ticket" id="ticket" aria-label="Pedido actual"></section>
      </div>`;
    document.getElementById('b-orders').onclick = ordersPanel;
    const actions = {
      sale: () => { S.search = ''; document.getElementById('q').value = ''; renderProducts(); },
      orders: ordersPanel, tickets: ticketsModal, cash: cashModal, waste: wasteModal, disc: discountModal, lock: logout,
      admin: () => window.open('/admin', '_blank')
    };
    app.querySelectorAll('.side [data-a]').forEach((b) => b.onclick = () => actions[b.dataset.a]());
    const q = document.getElementById('q');
    q.oninput = () => { S.search = q.value.trim(); renderCats(); renderProducts(); };
    if (!S.cat) S.cat = S.catalog.categories[0]?.id ?? 'all';
    renderChannels(); renderCats(); renderProducts(); renderTicket();
    startPoll();
  }

  function renderChannels() {
    const el = document.getElementById('channels');
    el.innerHTML = Object.keys(CHANNEL_LABEL).map((c) => `<button type="button" data-c="${c}" aria-pressed="${S.channel === c}" class="${S.channel === c ? 'on' : ''}" style="${S.channel === c ? 'background:' + CH_DARK[c] : ''}">${CHANNEL_LABEL[c]}</button>`).join('');
    el.querySelectorAll('button').forEach((b) => b.onclick = () => setChannel(b.dataset.c));
  }
  function setChannel(c) {
    S.channel = c;
    for (const l of S.lines) { const p = prod(l.product_id); if (p) l.price = priceOf(p); }
    if (PLATFORMS.includes(c)) S.pay = 'plataforma'; else if (S.pay === 'plataforma') S.pay = 'efectivo';
    renderChannels(); renderProducts(); renderTicket();
    if (c === 'domicilio' && !S.customer) customerModal();
  }
  const prod = (id) => S.catalog.products.find((p) => p.id === id);
  const priceOf = (p) => (PLATFORMS.includes(S.channel) ? p.price_platform : p.price);

  function renderCats() {
    const el = document.getElementById('cats');
    const all = [{ id: 'all', name: 'Todo', n: S.catalog.products.length }, ...S.catalog.categories.map((c) => ({ id: c.id, name: c.name, n: S.catalog.products.filter((p) => p.category_id === c.id).length }))];
    const on = (id) => !S.search && S.cat === id;
    el.innerHTML = all.map((c) => `<button type="button" data-id="${c.id}" aria-pressed="${on(c.id)}" class="cat ${on(c.id) ? 'on' : ''}"><b>${esc(c.name)}</b><small>${c.n} productos</small></button>`).join('');
    el.querySelectorAll('button').forEach((b) => b.onclick = () => {
      S.cat = b.dataset.id === 'all' ? 'all' : Number(b.dataset.id);
      if (S.search) { S.search = ''; document.getElementById('q').value = ''; }
      renderCats(); renderProducts();
    });
  }
  function renderProducts() {
    const el = document.getElementById('products'); if (!el) return;
    const term = S.search.toLowerCase();
    const list = S.catalog.products.filter((p) => (term ? (p.name + ' ' + (p.short_name || '')).toLowerCase().includes(term) : S.cat === 'all' || p.category_id === S.cat));
    el.innerHTML = list.map((p) => {
      const inT = S.lines.filter((l) => l.product_id === p.id).reduce((a, l) => a + l.qty, 0);
      return `<button type="button" class="prod ${inT ? 'in' : ''}" data-id="${p.id}" aria-label="${esc(p.name)}, ${eur(priceOf(p))}${inT ? ', ' + num(inT) + ' en el pedido' : ''}">
        <span class="pimg" style="${tintOf(p)}">${svg(kindOf(p), 52, 1.5)}${inT ? `<span class="q">${num(inT)}</span>` : ''}</span>
        <span class="pinfo"><span class="n">${esc(p.short_name || p.name)}</span><span class="p">${eur(priceOf(p))}</span></span></button>`;
    }).join('') || `<p class="muted">${term ? 'Ningún producto coincide con la búsqueda.' : 'Sin productos en esta categoría.'}</p>`;
    el.querySelectorAll('.prod').forEach((b) => b.onclick = () => addLine(Number(b.dataset.id)));
  }

  function addLine(pid) {
    const p = prod(pid);
    const ex = S.lines.find((l) => l.product_id === pid && !l.notes);
    if (ex) ex.qty += 1; else S.lines.push({ key: Math.random().toString(36).slice(2), product_id: pid, name: p.name, short: p.short_name || p.name, price: priceOf(p), vat: p.vat ?? 10, qty: 1, notes: '' });
    renderTicket(); renderProducts();
  }

  const subtotal = () => S.lines.reduce((a, l) => a + l.qty * l.price, 0);
  const fee = () => (S.channel === 'domicilio' && S.lines.length ? S.catalog.settings.home_delivery_fee : 0);
  const totalNow = () => Math.round((subtotal() * (1 - S.discount_pct / 100) + fee()) * 100) / 100;
  const vatNow = () => {
    const k = 1 - S.discount_pct / 100;
    const base = S.lines.reduce((a, l) => a + (l.qty * l.price * k) / (1 + (l.vat ?? 10) / 100), 0) + fee() / 1.1;
    return Math.round((totalNow() - base) * 100) / 100;
  };

  function renderTicket() {
    const el = document.getElementById('ticket'); if (!el) return;
    const c = S.customer;
    const plat = PLATFORMS.includes(S.channel);
    const units = S.lines.reduce((a, l) => a + l.qty, 0);
    const custText = plat ? (S.platform_ref ? `Ref. ${S.platform_ref}` : `Nº de pedido de ${CHANNEL_LABEL[S.channel]}`)
      : c && (c.name || c.phone) ? `${c.name || ''} ${c.phone || ''}`.trim() : S.channel === 'local' ? 'Cliente de mostrador' : 'Teléfono o nombre del cliente';
    const pays = plat ? [['plataforma', 'Pagado en app', 'check']] : [['efectivo', 'Efectivo', 'bill'], ['tarjeta', 'Tarjeta', 'card'], ['bizum', 'Bizum', 'phone']];
    if (!pays.find((p) => p[0] === S.pay)) S.pay = pays[0][0];
    el.innerHTML = `
      <div class="t-top">
        <span class="t-label">Cliente</span>
        <button type="button" class="cust-btn ${c || S.platform_ref ? 'set' : ''}" id="t-cust">${svg('user', 18, 2)}<span>${esc(custText)}</span>${svg('chev', 18, 2)}</button>
        ${c?.address ? `<span class="addr">${esc(c.address)}</span>` : ''}
        <div class="t-title"><b>Tu pedido</b><span class="chip" style="background:${CH_DARK[S.channel]}">${CHANNEL_LABEL[S.channel]}</span>
          <button type="button" class="link-btn ${S.notes ? 'set' : ''}" id="t-note">${svg('note', 16)} ${S.notes ? 'Nota añadida' : 'Nota'}</button></div>
      </div>
      <div class="lines">${S.lines.length ? S.lines.map((l) => {
        const p = prod(l.product_id) || {};
        return `<div class="line" data-k="${l.key}">
          <span class="thumb" style="${p.id ? tintOf(p) : ''}">${svg(p.id ? kindOf(p) : 'plato', 26, 1.7)}</span>
          <div class="lbody">
            <div class="lrow"><span class="nm">${esc(l.name)}${l.notes ? `<small class="nt">${esc(l.notes)}</small>` : ''}</span>
              <button type="button" class="del" data-a="x" aria-label="Eliminar ${esc(l.name)}">${svg('trash', 16, 2)}</button></div>
            <div class="lrow"><button type="button" class="qbtn" data-a="-" aria-label="Quitar una">${svg('minus', 16, 2.4)}</button><span class="qty">${num(l.qty)}</span>
              <button type="button" class="qbtn" data-a="+" aria-label="Añadir una">${svg('plus', 16, 2.4)}</button>
              <button type="button" class="note-btn" data-a="n">Nota</button><span class="tt">${eur(l.qty * l.price)}</span></div>
          </div></div>`;
      }).join('') : `<div class="empty">${svg('pollo', 44, 1.4)}<span>Toca un producto para empezar</span></div>`}</div>
      <div class="t-foot">
        <div class="sumbox">
          <div class="kv"><span>Subtotal (${num(units)} uds.)</span><b>${eur(subtotal())}</b></div>
          ${fee() ? `<div class="kv"><span>Gastos de envío</span><b>${eur(fee())}</b></div>` : ''}
          ${S.discount_pct ? `<div class="kv disc"><span>Descuento ${num(S.discount_pct)} % · <button type="button" class="link-btn" id="t-nodisc">quitar</button></span><b>−${eur(subtotal() * S.discount_pct / 100)}</b></div>` : ''}
          <div class="kv"><span>IVA incluido</span><b>${eur(vatNow())}</b></div>
          <div class="total-row"><span>Total</span><b>${eur(totalNow())}</b></div>
        </div>
        <div><span class="t-label">Forma de pago</span>
          <div class="paysel ${plat ? 'one' : ''}">${pays.map(([k, lbl, ic]) => `<button type="button" data-p="${k}" aria-pressed="${S.pay === k}" class="${S.pay === k ? 'on' : ''}">${svg(ic, 18)} ${lbl}</button>`).join('')}</div></div>
        <div class="foot-row">
          <button type="button" class="btn btn-ghost" id="t-clear" ${S.lines.length ? '' : 'disabled'}>Vaciar</button>
          <button type="button" class="btn btn-yellow" id="t-save" ${S.lines.length && S.channel !== 'local' ? '' : 'disabled'}>Cobrar luego</button>
        </div>
        <button type="button" class="pay-btn" id="t-pay" ${S.lines.length ? '' : 'disabled'}>Cobrar ${S.lines.length ? eur(totalNow()) : ''} ${svg('arrow', 22, 2.4)}</button>
      </div>`;
    el.querySelectorAll('.line').forEach((row) => row.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => {
      const l = S.lines.find((x) => x.key === row.dataset.k);
      const a = b.dataset.a;
      if (a === '+') l.qty += 1;
      else if (a === '-') { l.qty -= 1; if (l.qty <= 0) S.lines = S.lines.filter((x) => x !== l); }
      else if (a === 'x') S.lines = S.lines.filter((x) => x !== l);
      else if (a === 'n') return lineNote(l);
      renderTicket(); renderProducts();
    }));
    el.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { S.pay = b.dataset.p; renderTicket(); });
    el.querySelector('#t-note').onclick = orderNote;
    el.querySelector('#t-cust').onclick = customerModal;
    el.querySelector('#t-nodisc')?.addEventListener('click', () => { S.discount_pct = 0; S.auth_pin = null; renderTicket(); });
    el.querySelector('#t-clear').onclick = async () => { if (await confirmBox('¿Vaciar el ticket?', { ok: 'Vaciar', danger: true })) resetTicket(); };
    el.querySelector('#t-save').onclick = () => checkout(false);
    el.querySelector('#t-pay').onclick = () => checkout(true);
  }

  function resetTicket() {
    S.lines = []; S.customer = null; S.notes = ''; S.platform_ref = ''; S.discount_pct = 0; S.auth_pin = null;
    if (S.channel !== 'local') { S.channel = 'local'; renderChannels(); }
    S.pay = 'efectivo';
    renderTicket(); renderProducts();
  }

  const QUICK_NOTES = ['Sin salsa', 'Bien hecho', 'Partido en cuartos', 'Partido por la mitad', 'Sin sal', 'Picante aparte', 'Sin cebolla', 'Para alérgico: revisar'];
  function lineNote(l) {
    const m = modal(`<div class="modal-head"><h2>Nota · ${esc(l.short)}</h2><button class="x" data-close>×</button></div>
      <div class="modal-body"><div class="toggle" style="margin-bottom:12px">${QUICK_NOTES.map((n) => `<button data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>
      <div class="field"><input id="nt" value="${esc(l.notes)}" placeholder="Escribe una nota para cocina"></div></div>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="ok">Guardar</button></div>`);
    const inp = m.el.querySelector('#nt');
    m.el.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => { inp.value = inp.value ? inp.value + ', ' + b.dataset.n : b.dataset.n; });
    m.el.querySelector('#ok').onclick = () => {
      const v = inp.value.trim();
      if (l.qty > 1 && v && !l.notes) { l.qty -= 1; S.lines.push({ ...l, key: Math.random().toString(36).slice(2), qty: 1, notes: v }); }
      else l.notes = v;
      m.close(); renderTicket();
    };
  }
  function orderNote() {
    const m = modal(`<div class="modal-head"><h2>Nota del pedido</h2><button class="x" data-close>×</button></div>
      <div class="modal-body"><div class="field"><textarea id="nt" rows="3" placeholder="Ej.: recoge a las 14:30, alergia a frutos secos…">${esc(S.notes)}</textarea></div></div>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="ok">Guardar</button></div>`);
    m.el.querySelector('#ok').onclick = () => { S.notes = m.el.querySelector('#nt').value.trim(); m.close(); renderTicket(); };
  }

  // Datos de cliente (domicilio / para llevar / plataformas)
  function customerModal(then) {
    const c = S.customer || {};
    const plat = PLATFORMS.includes(S.channel);
    const m = modal(`<div class="modal-head"><h2>${plat ? 'Pedido ' + CHANNEL_LABEL[S.channel] : 'Datos del cliente'}</h2><button class="x" data-close>×</button></div>
      <div class="modal-body">
        ${plat ? `<div class="field"><label>Nº de pedido en ${CHANNEL_LABEL[S.channel]}</label><input id="pref" value="${esc(S.platform_ref)}" placeholder="Ej.: 4F7K2"></div>` : ''}
        <div class="field"><label>Teléfono</label><input id="ph" inputmode="tel" value="${esc(c.phone || '')}" placeholder="600 000 000" autocomplete="off"></div>
        <div id="sug"></div>
        <div class="field"><label>Nombre</label><input id="nm" value="${esc(c.name || '')}" autocomplete="off"></div>
        ${S.channel === 'domicilio' ? `<div class="field"><label>Dirección de entrega</label><textarea id="ad" rows="2" placeholder="Calle, número, piso, timbre…">${esc(c.address || '')}</textarea></div>` : ''}
      </div>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="ok">Guardar</button></div>`);
    const ph = m.el.querySelector('#ph'), sug = m.el.querySelector('#sug');
    let to;
    ph.oninput = () => {
      clearTimeout(to); to = setTimeout(async () => {
        const list = await api('/customers?phone=' + encodeURIComponent(ph.value.replace(/\s/g, ''))).catch(() => []);
        sug.innerHTML = list.length ? `<div class="toggle" style="margin:-4px 0 12px">${list.map((x, i) => `<button data-i="${i}">↺ ${esc(x.name || '')} · ${esc(x.phone)}${x.address ? ' · ' + esc(x.address.slice(0, 30)) : ''}</button>`).join('')}</div>` : '';
        sug.querySelectorAll('button').forEach((b) => b.onclick = () => {
          const x = list[Number(b.dataset.i)]; ph.value = x.phone; m.el.querySelector('#nm').value = x.name || '';
          const ad = m.el.querySelector('#ad'); if (ad) ad.value = x.address || ''; sug.innerHTML = '';
        });
      }, 250);
    };
    m.el.querySelector('#ok').onclick = () => {
      const phone = ph.value.replace(/\s/g, ''), name = m.el.querySelector('#nm').value.trim(), address = m.el.querySelector('#ad')?.value.trim() || '';
      if (S.channel === 'domicilio' && (!phone || !address)) return toast('Para domicilio hacen falta teléfono y dirección', 'error');
      S.customer = phone || name || address ? { phone, name, address } : null;
      if (plat) S.platform_ref = m.el.querySelector('#pref').value.trim();
      m.close(); renderTicket(); if (typeof then === 'function') then();
    };
  }

  // ------------------------------------------------------------------ cobro
  // Efectivo abre la ventana de cobro; tarjeta, Bizum y plataformas cobran directamente
  async function checkout(payNow) {
    if (!S.lines.length) return;
    if (S.channel === 'domicilio' && !(S.customer?.phone && S.customer?.address)) return customerModal(() => checkout(payNow));
    if (!payNow) {
      try { const o = await submitOrder(null); toast(`Pedido #${o.id} guardado. Se cobra al recoger o entregar.`); } catch { /* ya avisado */ }
      return;
    }
    const total = totalNow();
    if (S.pay === 'efectivo') return payModal(total, (payments) => submitOrder(payments));
    if (S.pay !== 'plataforma' && !(await confirmBox(`¿Cobrado ${eur(total)} con ${METHOD_LABEL[S.pay].toLowerCase()}?`, { ok: 'Sí, cobrado', cancel: 'No' }))) return;
    try { doneModal(await submitOrder([{ method: S.pay, amount: total }])); } catch { /* ya avisado */ }
  }

  async function submitOrder(payments) {
    const body = {
      store_id: S.store.id, channel: S.channel, notes: S.notes, platform_ref: S.platform_ref, customer: S.customer,
      discount_pct: S.discount_pct, auth_pin: S.auth_pin,
      lines: S.lines.map((l) => ({ product_id: l.product_id, qty: l.qty, notes: l.notes })), payments
    };
    try {
      const o = await api('/orders', { body });
      resetTicket(); refreshBadge();
      return o;
    } catch (e) { toast(e.message, 'error'); throw e; }
  }

  const quickBills = (r) => [...new Set([Math.ceil(r), Math.ceil(r / 5) * 5, Math.ceil(r / 10) * 10, 20, 50, 100])].filter((v) => v > r).sort((a, b) => a - b).slice(0, 3);

  function doneModal(o) {
    const change = o?.change || 0;
    const m = modal(`<div class="modal-body"><div class="done"><div class="ok">${svg('check', 44, 2.6)}</div><h2>Cobrado ${eur(o.total)}</h2>
      ${change ? `<div class="change-l">Cambio a devolver</div><div class="change">${eur(change)}</div>` : ''}
      <p class="muted">${esc(o.full_number || '')}</p>
      <div class="done-btns"><button type="button" class="btn btn-ghost btn-lg" id="pr">${svg('print')} Imprimir ticket</button><button type="button" class="btn btn-ok btn-lg" id="nx">Siguiente cliente</button></div></div></div>`);
    m.el.querySelector('#pr').onclick = () => printHtml(ticketHtml(o, S.catalog.settings));
    m.el.querySelector('#nx').onclick = m.close;
    setTimeout(() => m.el.querySelector('#nx')?.focus(), 50);
  }

  // Ventana de cobro. onPay(payments) debe devolver el pedido creado/cobrado
  function payModal(total, onPay) {
    const plat = PLATFORMS.includes(S.channel);
    const payments = [];
    const paid = () => Math.round(payments.reduce((a, p) => a + p.amount, 0) * 100) / 100;
    const rem = () => Math.round((total - paid()) * 100) / 100;
    const m = modal(`<div class="modal-head"><h2>Cobrar · ${CHANNEL_LABEL[S.channel]}</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
      <div class="modal-body" id="pb"></div>`, { wide: true, cls: 'pay-modal' });
    const body = m.el.querySelector('#pb');
    let np;
    const draw = () => {
      body.innerHTML = `<div class="pay"><div class="pay-left">
          <div class="pay-total"><div><span>${payments.length ? 'Queda por cobrar' : 'Total a cobrar'}</span><b>${eur(rem())}</b></div>
            ${plat ? '' : '<div class="r"><span>Cambio</span><b id="chg">—</b></div>'}</div>
          ${plat ? `<div class="methods"><button type="button" class="m on" data-m="plataforma" style="grid-column:1/-1">${svg('check', 28)} Pagado en ${CHANNEL_LABEL[S.channel]}</button></div>`
          : `<div class="methods">
              <button type="button" class="m on" data-m="efectivo">${svg('bill', 28)} Efectivo</button>
              <button type="button" class="m" data-m="tarjeta">${svg('card', 28)} Tarjeta</button>
              <button type="button" class="m" data-m="bizum">${svg('phone', 28)} Bizum</button></div>
            <span class="t-label">Entrega rápida</span>
            <div class="quick"><button type="button" id="exact">Exacto</button>${quickBills(rem()).map((v) => `<button type="button" data-q="${v}">${v} €</button>`).join('')}</div>`}
          ${payments.length ? `<div class="paid-list">${payments.map((p) => `<div><span>${METHOD_LABEL[p.method]}</span><b>${eur(p.amount)}</b></div>`).join('')}</div>` : ''}
        </div>
        ${plat ? '' : `<div class="pay-pad"><span class="t-label">Importe entregado</span><div class="amount-box" id="av">—</div><div class="pinpad" id="np"></div>
          <p class="muted small">Para pago mixto, escribe una parte y elige el método; el resto se cobra después.</p></div>`}</div>`;
      if (!plat) np = numpad(body.querySelector('#np'), (v, s) => {
        body.querySelector('#av').textContent = s ? eur(v) : '—';
        body.querySelector('#chg').textContent = s && v >= rem() ? eur(v - rem()) : '—';
      });
      body.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => pay(b.dataset.m, np ? np.value() : 0));
      body.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => pay('efectivo', Number(b.dataset.q)));
      body.querySelector('#exact')?.addEventListener('click', () => pay('efectivo', rem()));
    };
    const pay = async (method, entered) => {
      const r = rem();
      if (method === 'efectivo') {
        const given = entered || r;
        if (given >= r) payments.push({ method, amount: r, given });
        else payments.push({ method, amount: given, given });
      } else {
        const amt = entered && entered < r ? entered : r;
        payments.push({ method, amount: amt });
      }
      if (rem() > 0.001) return draw();
      body.innerHTML = '<p class="center muted" style="padding:40px">Registrando…</p>';
      try { const o = await onPay(payments); m.close(); doneModal(o); }
      catch { payments.length = 0; draw(); }
    };
    draw();
  }

  // ------------------------------------------------------------- pedidos
  function startPoll() { stopPoll(); refreshBadge(); poll = setInterval(refreshBadge, 15000); }
  function stopPoll() { if (poll) clearInterval(poll); poll = null; }
  async function refreshBadge() {
    try {
      const list = await api('/orders/active?store_id=' + S.store.id);
      S.activeCount = list.length;
      const b = document.getElementById('badge');
      for (const b of [document.getElementById('badge'), document.getElementById('badge2')]) if (b) { b.textContent = list.length; b.classList.toggle('hidden', !list.length); }
      return list;
    } catch (e) { if (e.status === 401) logout(); return []; }
  }

  async function ordersPanel() {
    const m = modal(`<div class="modal-head"><h2>Pedidos en curso</h2><div style="display:flex;gap:8px"><button type="button" class="btn btn-sm btn-ghost" id="hist">${svg('receipt', 16)} Tickets de hoy</button><button class="x" data-close aria-label="Cerrar">×</button></div></div>
      <div class="modal-body" id="ob"></div>`, { wide: true, cls: 'orders-modal', onClose: () => clearInterval(iv) });
    m.el.querySelector('#hist').onclick = () => { m.close(); ticketsModal(); };
    const ob = m.el.querySelector('#ob');
    const COLS = [
      ['Preparando', '#F29E0C', (o) => ['nuevo', 'preparando'].includes(o.kitchen_status)],
      ['Listo para salir', '#2E7D4F', (o) => o.kitchen_status === 'listo'],
      ['En reparto', '#1B5FAF', (o) => o.kitchen_status === 'en_reparto'],
      ['Entregado sin cobrar', '#B8300F', (o) => o.kitchen_status === 'entregado']
    ];
    const draw = async () => {
      const list = await refreshBadge();
      const nowMs = Date.now();
      const card = (o) => {
        const mins = Math.floor((nowMs - new Date(o.created_at.replace(' ', 'T')).getTime()) / 60000);
        const next = { nuevo: 'preparando', preparando: 'listo', listo: o.channel === 'domicilio' ? 'en_reparto' : 'entregado', en_reparto: 'entregado' }[o.kitchen_status];
        const nextLbl = { preparando: 'Empezar', listo: 'Marcar listo', en_reparto: 'Sale a reparto', entregado: PLATFORMS.includes(o.channel) ? 'Entregado al rider' : 'Entregado' }[next];
        const late = mins >= 30 && o.kitchen_status !== 'entregado';
        return `<article class="ocard ${late ? 'late' : ''}">
          <div class="h"><span class="chip" style="background:${CH_DARK[o.channel]}">${CHANNEL_LABEL[o.channel]}</span><span class="muted">#${o.id}</span><span class="timer">${mins} min</span></div>
          <div class="s">${esc(o.summary || '')}</div>
          ${o.customer_name || o.customer_phone ? `<div class="meta">${esc([o.customer_name, o.customer_phone].filter(Boolean).join(' · '))}</div>` : ''}
          ${o.customer_address ? `<div class="meta">${esc(o.customer_address)}</div>` : ''}
          ${o.platform_ref ? `<div class="meta">Ref. ${esc(o.platform_ref)}</div>` : ''}
          ${o.notes ? `<div class="meta note">${esc(o.notes)}</div>` : ''}
          <div class="h"><span class="paid ${o.status === 'pendiente' ? 'no' : 'yes'}">${o.status === 'pendiente' ? 'Sin cobrar' : 'Cobrado'}</span><b style="margin-left:auto">${eur(o.total)}</b></div>
          <div class="acts">
            ${next ? `<button type="button" class="btn btn-sm ${next === 'listo' || next === 'preparando' ? 'btn-yellow' : 'btn-dark'}" data-st="${next}" data-id="${o.id}">${nextLbl}</button>` : ''}
            ${o.status === 'pendiente' ? `<button type="button" class="btn btn-sm btn-primary" data-pay="${o.id}">Cobrar</button>` : ''}
            <button type="button" class="btn btn-sm btn-ghost" data-view="${o.id}">Ver</button>
          </div></article>`;
      };
      ob.innerHTML = `<div class="board">${COLS.map(([title, color, fn]) => {
        const items = list.filter(fn);
        return `<section class="col"><div class="col-h"><span class="dot" style="background:${color}"></span><h3>${title}</h3><span class="n">${items.length}</span></div>
          ${items.map(card).join('') || '<p class="col-empty">Nada aquí</p>'}</section>`;
      }).join('')}</div>`;
      ob.querySelectorAll('[data-st]').forEach((b) => b.onclick = async () => { try { await api(`/orders/${b.dataset.id}/status`, { body: { kitchen_status: b.dataset.st } }); draw(); } catch (e) { toast(e.message, 'error'); } });
      ob.querySelectorAll('[data-pay]').forEach((b) => b.onclick = () => payPending(Number(b.dataset.pay), draw));
      ob.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => orderView(Number(b.dataset.view), draw));
    };
    const iv = setInterval(draw, 15000);
    draw();
  }

  async function payPending(id, after) {
    const o = await api('/orders/' + id);
    const prevCh = S.channel; S.channel = o.channel;
    payModal(o.total, async (payments) => {
      try { const r = await api(`/orders/${id}/pay`, { body: { payments } }); refreshBadge(); after && after(); return r; }
      catch (e) { toast(e.message, 'error'); throw e; }
      finally { S.channel = prevCh; }
    });
  }

  async function ticketsModal() {
    const m = modal(`<div class="modal-head"><h2>Tickets de hoy</h2><button class="x" data-close>×</button></div>
      <div class="modal-body"><div class="field"><input id="q" placeholder="Buscar por número, teléfono o nombre"></div><div id="tl"></div></div>`, { wide: true });
    const tl = m.el.querySelector('#tl'); const qi = m.el.querySelector('#q');
    const draw = async () => {
      try {
        const list = await api(`/orders?store_id=${S.store.id}&q=${encodeURIComponent(qi.value)}`);
        tl.innerHTML = list.length ? `<table class="tbl"><thead><tr><th>Hora</th><th>Número</th><th>Canal</th><th>Pago</th><th>Estado</th><th class="r">Total</th></tr></thead><tbody>
          ${list.map((o) => `<tr class="click" data-id="${o.id}"><td>${time(o.created_at)}</td><td>${esc(o.full_number || '#' + o.id)}${o.type === 'devolucion' ? ' <span class="pill" style="background:var(--red)">DEV</span>' : ''}</td>
          <td><span class="pill" style="background:${CHANNEL_COLOR[o.channel]}">${CHANNEL_LABEL[o.channel]}</span></td><td>${esc((o.methods || '').split(',').map((x) => METHOD_LABEL[x] || x).join(' + '))}</td>
          <td>${esc(o.status)}</td><td class="r"><b>${eur(o.total)}</b></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Sin tickets</div>';
        tl.querySelectorAll('tr[data-id]').forEach((r) => r.onclick = () => orderView(Number(r.dataset.id), draw));
      } catch (e) { toast(e.message, 'error'); }
    };
    let to; qi.oninput = () => { clearTimeout(to); to = setTimeout(draw, 250); };
    draw();
  }

  async function orderView(id, after) {
    let o;
    try { o = await api('/orders/' + id); } catch (e) { return toast(e.message, 'error'); }
    const refundable = o.type === 'venta' && o.status === 'pagado';
    const m = modal(`<div class="modal-head"><h2>${esc(o.full_number || 'Pedido #' + o.id)}</h2><button class="x" data-close>×</button></div>
      <div class="modal-body">
        <div class="kv"><span>Fecha</span><b>${dateEs(o.created_at)}</b></div>
        <div class="kv"><span>Canal</span><b>${CHANNEL_LABEL[o.channel]}</b></div>
        <div class="kv"><span>Estado</span><b>${esc(o.status)} · ${KITCHEN_LABEL[o.kitchen_status] || ''}</b></div>
        ${o.customer_name || o.customer_phone ? `<div class="kv"><span>Cliente</span><b>${esc(o.customer_name || '')} ${esc(o.customer_phone || '')}</b></div>` : ''}
        ${o.customer_address ? `<div class="kv"><span>Dirección</span><b>${esc(o.customer_address)}</b></div>` : ''}
        <table class="tbl" style="margin-top:10px"><tbody>${o.lines.map((l) => `<tr><td>${num(l.qty)} ×</td><td>${esc(l.name)}${l.notes ? `<br><small class="muted">${esc(l.notes)}</small>` : ''}</td><td class="r">${eur(l.total)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td></td><td>TOTAL</td><td class="r">${eur(o.total)}</td></tr></tfoot></table>
        ${o.payments.length ? `<p class="muted">Pago: ${o.payments.map((p) => METHOD_LABEL[p.method] + ' ' + eur(p.amount)).join(' + ')}</p>` : ''}
        ${o.refunds.length ? `<p style="color:var(--red);font-weight:800">Devoluciones: ${o.refunds.map((r) => esc(r.full_number) + ' (' + eur(r.total) + ')').join(', ')}</p>` : ''}
      </div>
      <div class="modal-foot">
        ${o.status === 'pendiente' ? '<button class="btn btn-danger" id="cancel">Anular</button><button class="btn btn-ok" id="pay">Cobrar</button>' : ''}
        ${refundable ? '<button class="btn btn-danger" id="refund">Devolución</button>' : ''}
        <button class="btn btn-ghost" id="print">${svg('print', 18)} Imprimir</button></div>`);
    m.el.querySelector('#print').onclick = () => printHtml(ticketHtml(o, S.catalog.settings));
    m.el.querySelector('#pay')?.addEventListener('click', () => { m.close(); payPending(o.id, after); });
    m.el.querySelector('#refund')?.addEventListener('click', () => { m.close(); refundModal(o, after); });
    m.el.querySelector('#cancel')?.addEventListener('click', async () => {
      if (!(await confirmBox('¿Anular este pedido sin cobrar?', { ok: 'Anular', danger: true }))) return;
      const pin = await askSupervisor('Para anular un pedido'); if (pin === false) return;
      try { await api(`/orders/${o.id}/cancel`, { body: { reason: 'Anulado en TPV', auth_pin: pin } }); toast('Pedido anulado'); m.close(); refreshBadge(); after && after(); }
      catch (e) { toast(e.message, 'error'); }
    });
  }

  function refundModal(o, after) {
    const done = new Map(); // ya devuelto por línea
    const qty = new Map(o.lines.map((l) => [l.id, 0]));
    let method = o.payments[0]?.method || 'efectivo';
    let restock = false;
    const m = modal(`<div class="modal-head"><h2>Devolución · ${esc(o.full_number)}</h2><button class="x" data-close>×</button></div>
      <div class="modal-body"><p class="muted" style="margin-top:0">Marca qué se devuelve. Se emitirá una factura rectificativa.</p>
        <div class="sel-lines" id="sl"></div>
        <div style="margin:12px 0"><button class="btn btn-sm btn-ghost" id="allb">Devolver todo</button></div>
        <div class="field"><label>Devolver el dinero en</label><div class="toggle" id="mt"></div></div>
        <div class="field"><label>Motivo</label><input id="rs" placeholder="Ej.: producto frío, error en el pedido…"></div>
        <div class="field"><label>¿El producto vuelve al almacén?</label><div class="toggle" id="rk"><button data-v="0" class="on">No (se tira)</button><button data-v="1">Sí, está intacto</button></div></div>
        <div class="total-row"><span class="lbl">A DEVOLVER</span><span class="val" id="tv" style="font-size:30px">0,00 €</span></div>
      </div>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-danger" id="ok">Hacer devolución</button></div>`, { wide: true });
    const sl = m.el.querySelector('#sl');
    const refunded = (l) => done.get(l.id) || 0;
    const drawLines = () => {
      sl.innerHTML = o.lines.map((l) => {
        const max = l.qty - refunded(l);
        return `<div class="row" data-id="${l.id}"><span class="n">${esc(l.name)} <small class="muted">(${num(max)} disp.)</small></span>
          <button class="qbtn" data-a="-">−</button><b style="min-width:30px;text-align:center">${num(qty.get(l.id))}</b><button class="qbtn" data-a="+">+</button>
          <span style="min-width:90px;text-align:right">${eur((l.total / l.qty) * qty.get(l.id))}</span></div>`;
      }).join('');
      sl.querySelectorAll('.row').forEach((r) => r.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => {
        const l = o.lines.find((x) => x.id === Number(r.dataset.id)); const max = l.qty - refunded(l);
        qty.set(l.id, Math.max(0, Math.min(max, qty.get(l.id) + (b.dataset.a === '+' ? 1 : -1)))); drawLines();
      }));
      m.el.querySelector('#tv').textContent = eur(o.lines.reduce((a, l) => a + (l.total / l.qty) * qty.get(l.id), 0));
    };
    const mt = m.el.querySelector('#mt');
    const drawM = () => { mt.innerHTML = ['efectivo', 'tarjeta', 'bizum', 'plataforma'].map((k) => `<button data-k="${k}" class="${method === k ? 'on' : ''}">${METHOD_LABEL[k]}</button>`).join(''); mt.querySelectorAll('button').forEach((b) => b.onclick = () => { method = b.dataset.k; drawM(); }); };
    m.el.querySelectorAll('#rk button').forEach((b) => b.onclick = () => { restock = b.dataset.v === '1'; m.el.querySelectorAll('#rk button').forEach((x) => x.classList.toggle('on', x === b)); });
    m.el.querySelector('#allb').onclick = () => { for (const l of o.lines) qty.set(l.id, l.qty - refunded(l)); drawLines(); };
    m.el.querySelector('#ok').onclick = async () => {
      const lines = [...qty].filter(([, q]) => q > 0).map(([line_id, q]) => ({ line_id, qty: q }));
      if (!lines.length) return toast('Marca al menos un producto', 'error');
      const pin = await askSupervisor('Las devoluciones las autoriza un encargado'); if (pin === false) return;
      try {
        const r = await api(`/orders/${o.id}/refund`, { body: { lines, method, reason: m.el.querySelector('#rs').value, restock, auth_pin: pin } });
        m.close(); toast('Devolución registrada: ' + eur(r.total));
        if (await confirmBox('¿Imprimir el ticket de devolución?', { ok: 'Imprimir', cancel: 'No' })) printHtml(ticketHtml(r, S.catalog.settings));
        after && after();
      } catch (e) { toast(e.message, 'error'); }
    };
    // cantidades ya devueltas
    Promise.all(o.refunds.map((r) => api('/orders/' + r.id))).then((rs) => {
      for (const r of rs) for (const l of r.lines) done.set(l.ref_line_id, (done.get(l.ref_line_id) || 0) - l.qty);
      drawLines();
    });
    drawM(); drawLines();
  }

  function discountModal() {
    if (!S.lines.length) return toast('Primero añade productos al ticket', 'error');
    const m = modal(`<div class="modal-head"><h2>Descuento sobre el ticket</h2><button class="x" data-close>×</button></div>
      <div class="modal-body"><div class="toggle">${[5, 10, 15, 20, 25, 50, 100].map((v) => `<button data-v="${v}" class="${S.discount_pct === v ? 'on' : ''}">${v === 100 ? 'Invitación (100 %)' : v + ' %'}</button>`).join('')}</div>
      <p class="muted">Necesita la autorización de un encargado.</p></div>`);
    m.el.querySelectorAll('[data-v]').forEach((b) => b.onclick = async () => {
      m.close();
      const pin = await askSupervisor('Para aplicar un descuento'); if (pin === false) return;
      S.discount_pct = Number(b.dataset.v); S.auth_pin = pin; renderTicket();
    });
  }

  function wasteModal() {
    const prods = S.catalog.products;
    const m = modal(`<div class="modal-head"><h2>Registrar merma</h2><button class="x" data-close>×</button></div>
      <div class="modal-body"><p class="muted" style="margin-top:0">Producto que se tira o se aprovecha (descuenta del stock con su escandallo).</p>
        <div class="field"><label>Producto</label><select id="pp">${S.catalog.categories.map((c) => `<optgroup label="${esc(c.name)}">${prods.filter((p) => p.category_id === c.id).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</optgroup>`).join('')}</select></div>
        <div class="grid2"><div class="field"><label>Cantidad</label><input id="qq" type="number" min="0.5" step="0.5" value="1"></div>
        <div class="field"><label>Motivo</label><select id="mm"><option>Sobrante fin de servicio (aprovechamiento)</option><option>Caducado</option><option>Quemado / mal hecho</option><option>Caído / roto</option><option>Consumo de personal</option><option>Otro</option></select></div></div>
      </div><div class="modal-foot"><button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="ok">Registrar</button></div>`);
    m.el.querySelector('#ok').onclick = async () => {
      try { await api('/waste', { body: { store_id: S.store.id, product_id: Number(m.el.querySelector('#pp').value), qty: Number(m.el.querySelector('#qq').value), note: m.el.querySelector('#mm').value } }); toast('Merma registrada'); m.close(); }
      catch (e) { toast(e.message, 'error'); }
    };
  }

  // ------------------------------------------------------------------ caja
  async function cashModal() {
    let sum;
    try { sum = await api('/cash/current?store_id=' + S.store.id); } catch (e) { return toast(e.message, 'error'); }
    if (!sum) return renderOpenCash();
    const m = modal(`<div class="modal-head"><h2>Caja · abierta a las ${time(sum.session.opened_at)}</h2><button class="x" data-close>×</button></div>
      <div class="modal-body" id="cb"></div>
      <div class="modal-foot"><button class="btn btn-ghost" id="in">+ Entrada dinero</button><button class="btn btn-ghost" id="out">− Salida dinero</button><button class="btn btn-dark" id="close">Cerrar caja (Z)</button></div>`, { wide: true });
    const draw = (s) => {
      m.el.querySelector('#cb').innerHTML = `<div class="grid2"><div>
        <div class="kv"><span>Fondo inicial</span><b>${eur(s.session.opening_float)}</b></div>
        ${['efectivo', 'tarjeta', 'bizum', 'plataforma'].map((k) => `<div class="kv"><span>${METHOD_LABEL[k]}</span><b>${eur(s.byMethod.find((x) => x.method === k)?.total || 0)}</b></div>`).join('')}
        ${s.moves.map((mv) => `<div class="kv"><span>${mv.type === 'entrada' ? '＋' : '－'} ${esc(mv.reason || mv.type)}</span><b>${eur(mv.type === 'entrada' ? mv.amount : -mv.amount)}</b></div>`).join('')}
        <div class="kv" style="font-size:18px"><span>Efectivo que debe haber</span><b>${eur(s.expected_cash)}</b></div></div>
        <div><div class="kv"><span>Tickets</span><b>${s.tickets}</b></div><div class="kv"><span>Ticket medio</span><b>${eur(s.avg_ticket)}</b></div>
        <div class="kv"><span>Devoluciones</span><b>${s.refunds} (${eur(s.refunds_total)})</b></div>
        ${Object.entries(s.byChannel).map(([c, v]) => `<div class="kv"><span>${CHANNEL_LABEL[c]}</span><b>${eur(v)}</b></div>`).join('')}
        <div class="kv" style="font-size:18px"><span>Total vendido</span><b>${eur(s.total)}</b></div></div></div>`;
    };
    draw(sum);
    const move = (type) => {
      const mm = modal(`<div class="modal-head"><h2>${type === 'entrada' ? 'Entrada de dinero' : 'Salida de dinero'}</h2><button class="x" data-close>×</button></div>
        <div class="modal-body"><div class="field"><label>Importe (€)</label><input id="a" type="number" step="0.01" min="0"></div>
        <div class="field"><label>Motivo</label><input id="r" placeholder="${type === 'entrada' ? 'Cambio, fondo extra…' : 'Pago a proveedor, retirada a banco…'}"></div></div>
        <div class="modal-foot"><button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="ok">Guardar</button></div>`);
      mm.el.querySelector('#ok').onclick = async () => {
        let pin = null;
        if (type === 'salida') { pin = await askSupervisor('Sacar dinero de caja'); if (pin === false) return; }
        try { sum = await api('/cash/move', { body: { session_id: sum.session.id, type, amount: Number(mm.el.querySelector('#a').value), reason: mm.el.querySelector('#r').value, auth_pin: pin } }); draw(sum); mm.close(); toast('Movimiento guardado'); }
        catch (e) { toast(e.message, 'error'); }
      };
    };
    m.el.querySelector('#in').onclick = () => move('entrada');
    m.el.querySelector('#out').onclick = () => move('salida');
    m.el.querySelector('#close').onclick = () => { m.close(); closeCash(sum); };
  }

  const BILLS = [50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
  function closeCash(sum) {
    const counts = new Map(BILLS.map((b) => [b, 0]));
    const m = modal(`<div class="modal-head"><h2>Cierre de caja · arqueo</h2><button class="x" data-close>×</button></div>
      <div class="modal-body"><p class="muted" style="margin-top:0">Cuenta el efectivo del cajón (incluido el fondo). El sistema calcula la diferencia.</p>
        <div class="grid3" id="bl">${BILLS.map((b) => `<div class="field"><label>${b >= 5 ? 'Billetes' : 'Monedas'} de ${eur(b)}</label><input type="number" min="0" step="1" data-b="${b}" inputmode="numeric" placeholder="0" data-noautofocus></div>`).join('')}</div>
        <div class="kv" style="font-size:18px"><span>Contado</span><b id="ct">0,00 €</b></div>
        <div class="kv"><span>Debe haber</span><b>${eur(sum.expected_cash)}</b></div>
        <div class="kv" style="font-size:18px"><span>Diferencia</span><b id="df">${eur(-sum.expected_cash)}</b></div>
        <div class="field" style="margin-top:10px"><label>Observaciones</label><input id="nt" data-noautofocus></div></div>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-dark" id="ok">Cerrar caja e imprimir Z</button></div>`, { wide: true });
    const total = () => [...counts].reduce((a, [b, n]) => a + b * n, 0);
    m.el.querySelectorAll('[data-b]').forEach((i) => i.oninput = () => {
      counts.set(Number(i.dataset.b), Number(i.value) || 0);
      const t = Math.round(total() * 100) / 100, d = Math.round((t - sum.expected_cash) * 100) / 100;
      m.el.querySelector('#ct').textContent = eur(t);
      const df = m.el.querySelector('#df'); df.textContent = eur(d, true); df.className = d < -0.009 ? 'diff-neg' : 'diff-pos';
    });
    m.el.querySelector('#ok').onclick = async () => {
      const body = { counted_cash: Math.round(total() * 100) / 100, notes: m.el.querySelector('#nt').value };
      let r;
      try { r = await api(`/cash/${sum.session.id}/close`, { body }); }
      catch (e) {
        if (e.status === 409 && e.message.includes('sin cobrar') && await confirmBox(e.message + ' ¿Cerrar igualmente?', { ok: 'Cerrar igualmente', danger: true })) {
          try { r = await api(`/cash/${sum.session.id}/close`, { body: { ...body, force: true } }); } catch (e2) { return toast(e2.message, 'error'); }
        } else return toast(e.message, 'error');
      }
      m.close(); printHtml(zReport(r)); toast('Caja cerrada');
      S.cash = null; logout();
    };
  }

  function zReport(s) {
    const st = S.catalog.settings;
    const row = (a, b) => `<div class="row"><span>${a}</span><span>${b}</span></div>`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>Cierre Z</title><style>@page{size:80mm auto;margin:3mm}body{font:12px/1.4 ui-monospace,Menlo,monospace;width:74mm;margin:0 auto}
      h1{font:800 18px system-ui;text-align:center;margin:4px 0}.row{display:flex;justify-content:space-between}hr{border:0;border-top:1px dashed #000}.b{font-weight:800;font-size:14px}</style></head><body>
      <h1>CIERRE DE CAJA (Z)</h1><div style="text-align:center">${esc(st.company_name)} · ${esc(s.session.store_name)}</div><hr>
      ${row('Apertura', dateEs(s.session.opened_at))}${row('Cierre', dateEs(s.session.closed_at))}${row('Abrió', esc(s.session.opened_by_name || ''))}${row('Cerró', esc(s.session.closed_by_name || ''))}<hr>
      ${s.byMethod.map((m) => row(METHOD_LABEL[m.method] + ' (' + m.n + ')', eur(m.total))).join('')}<hr>
      ${Object.entries(s.byChannel).map(([c, v]) => row(CHANNEL_LABEL[c], eur(v))).join('')}<hr>
      ${s.vat.map((v) => row(`IVA ${num(v.vat)} % base ${eur(v.base)}`, eur(v.cuota))).join('')}<hr>
      ${row('Tickets', s.tickets)}${row('Ticket medio', eur(s.avg_ticket))}${row('Devoluciones', s.refunds + ' / ' + eur(s.refunds_total))}
      <div class="row b">${'<span>TOTAL</span><span>' + eur(s.total) + '</span>'}</div><hr>
      ${row('Fondo inicial', eur(s.session.opening_float))}${s.moves.map((m) => row(esc(m.type + ': ' + (m.reason || '')), eur(m.amount))).join('')}
      ${row('Efectivo esperado', eur(s.session.expected_cash))}${row('Efectivo contado', eur(s.session.counted_cash))}
      <div class="row b"><span>DIFERENCIA</span><span>${eur(s.session.difference, true)}</span></div>
      ${s.session.notes ? '<hr>' + esc(s.session.notes) : ''}</body></html>`;
  }

  boot();
})();
