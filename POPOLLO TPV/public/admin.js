// POPOLLO · Administración central
(() => {
  const { LS, api, eur, num, pct, esc, toast, modal, confirmBox, today, daysAgo, dateEs, ticketHtml, printHtml, CHANNEL_LABEL, CHANNEL_COLOR, METHOD_LABEL } = POP;
  const app = document.getElementById('app');
  const S = { user: null, stores: [], store: LS.get('adm.store', ''), range: LS.get('adm.range', 'hoy'), from: today(), to: today(), cache: {} };
  const KIND = { ingrediente: 'Materia prima', packaging: 'Packaging', elaboracion: 'Elaboración' };
  const STATUS_STORE = { proyecto: 'Proyecto', obra: 'En obra', abierto: 'Abierto', cerrado: 'Cerrado' };
  const PURCHASE_STATUS = { borrador: ['Borrador', '#7A6656'], pedido: ['Pedido enviado', '#F29E0C'], recibido: ['Recibido', '#2E8B57'], anulado: ['Anulado', '#C62828'] };

  const PAGES = [
    ['g', 'Ventas'], ['panel', '📈 Panel'], ['ventas', '🧾 Tickets'], ['cajas', '💰 Cierres de caja'],
    ['g', 'Producto'], ['carta', '🍗 Carta y escandallos'], ['articulos', '🧂 Artículos y packaging'], ['proveedores', '🚚 Proveedores'],
    ['g', 'Almacén'], ['compras', '📦 Compras'], ['stock', '🏷️ Stock e inventario'],
    ['g', 'Red'], ['locales', '🏪 Locales'], ['verifactu', '🛡️ VeriFactu (AEAT)'], ['proyeccion', '🚀 Proyección 20 locales'], ['usuarios', '👥 Usuarios'], ['ajustes', '⚙️ Ajustes']
  ];

  // ---------------------------------------------------------------- acceso
  async function boot() {
    const t = LS.get('adm.token');
    if (t) { POP.setToken(t); try { S.user = await api('/me'); if (S.user.role === 'cajero') throw new Error(); return start(); } catch { POP.setToken(null, 'adm.token'); } }
    renderLogin();
  }
  async function renderLogin() {
    const stores = await api('/public/stores').catch(() => []);
    const users = [];
    for (const s of [{ id: 0 }, ...stores]) for (const u of await api('/public/users?store_id=' + s.id).catch(() => [])) if (u.role !== 'cajero' && !users.find((x) => x.id === u.id)) users.push(u);
    app.innerHTML = `<div class="login-adm"><div class="modal"><div class="modal-head"><div class="logo"><img src="/logo.svg" alt="">popolló</div><span class="muted" style="font-weight:800">Administración</span></div>
      <form class="modal-body" id="lf"><div class="field"><label>Usuario</label><select id="u">${users.map((u) => `<option value="${u.id}">${esc(u.name)} (${esc(u.role)})</option>`).join('')}</select></div>
      <div class="field"><label>PIN</label><input id="p" type="password" inputmode="numeric" autocomplete="current-password"></div>
      <button class="btn btn-primary" style="width:100%">Entrar</button></form></div></div>`;
    document.getElementById('lf').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api('/login', { body: { user_id: Number(document.getElementById('u').value), pin: document.getElementById('p').value } });
        if (r.user.role === 'cajero') throw new Error('Este usuario solo tiene acceso a la caja.');
        POP.setToken(r.token, 'adm.token'); S.user = r.user; start();
      } catch (er) { toast(er.message, 'error'); }
    };
  }
  async function start() {
    S.stores = await api('/admin/stores');
    if (S.user.store_id) S.store = String(S.user.store_id);
    setRange(S.range, false);
    window.addEventListener('hashchange', route);
    route();
  }
  function setRange(r, reload = true) {
    S.range = r; LS.set('adm.range', r);
    const d = new Date();
    if (r === 'hoy') { S.from = today(); S.to = today(); }
    else if (r === 'ayer') { S.from = daysAgo(1); S.to = daysAgo(1); }
    else if (r === '7d') { S.from = daysAgo(6); S.to = today(); }
    else if (r === '30d') { S.from = daysAgo(29); S.to = today(); }
    else if (r === 'mes') { S.from = today().slice(0, 8) + '01'; S.to = today(); }
    else if (r === 'mesant') { const a = new Date(d.getFullYear(), d.getMonth() - 1, 1), b = new Date(d.getFullYear(), d.getMonth(), 0); const f = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; S.from = f(a); S.to = f(b); }
    else if (r === 'anio') { S.from = today().slice(0, 4) + '-01-01'; S.to = today(); }
    if (reload) route();
  }
  const qsBase = () => `from=${S.from}&to=${S.to}${S.store ? '&store_id=' + S.store : ''}`;

  function layout(title, tools = '', opts = {}) {
    const page = location.hash.slice(1) || 'panel';
    const storeSel = opts.store === false ? '' : `<select id="g-store" ${S.user.store_id ? 'disabled' : ''}>${opts.storeRequired ? '' : '<option value="">Todos los locales</option>'}${S.stores.filter((s) => s.active).map((s) => `<option value="${s.id}" ${String(s.id) === String(S.store) ? 'selected' : ''}>${esc(s.code)} · ${esc(s.name)}</option>`).join('')}</select>`;
    const rangeSel = opts.range ? `<select id="g-range">${[['hoy', 'Hoy'], ['ayer', 'Ayer'], ['7d', 'Últimos 7 días'], ['30d', 'Últimos 30 días'], ['mes', 'Este mes'], ['mesant', 'Mes anterior'], ['anio', 'Este año'], ['custom', 'Personalizado']].map(([k, l]) => `<option value="${k}" ${S.range === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input type="date" id="g-from" value="${S.from}" ${S.range === 'custom' ? '' : 'class="hidden"'}><input type="date" id="g-to" value="${S.to}" ${S.range === 'custom' ? '' : 'class="hidden"'}>` : '';
    app.innerHTML = `<div class="shell"><nav class="side"><div class="logo"><img src="/logo.svg" alt="">popolló</div>
      ${PAGES.map(([k, l]) => k === 'g' ? `<div class="grp">${l}</div>` : (S.user.role !== 'admin' && ['usuarios', 'ajustes', 'proyeccion', 'locales', 'verifactu'].includes(k)) ? '' : `<a href="#${k}" class="${page === k ? 'on' : ''}">${l}</a>`).join('')}
      <div class="foot"><div><b>${esc(S.user.name)}</b> · ${esc(S.user.role)}</div><a href="/tpv" target="_blank">🐔 Abrir TPV</a><a href="#" id="logout">Salir</a></div></nav>
      <div class="main"><div class="bar"><h1>${title}</h1>${rangeSel}${storeSel}${tools}</div><div class="content" id="ct"><div class="empty-state">Cargando…</div></div></div></div>`;
    document.getElementById('logout').onclick = async (e) => { e.preventDefault(); await api('/logout', { body: {} }).catch(() => {}); POP.setToken(null, 'adm.token'); location.hash = ''; renderLogin(); };
    const gs = document.getElementById('g-store');
    if (gs) { if (opts.storeRequired && !S.store) S.store = gs.value; gs.onchange = () => { S.store = gs.value; LS.set('adm.store', S.store); route(); }; }
    const gr = document.getElementById('g-range');
    if (gr) {
      gr.onchange = () => setRange(gr.value);
      const f = document.getElementById('g-from'), t = document.getElementById('g-to');
      f.onchange = t.onchange = () => { S.from = f.value; S.to = t.value; route(); };
    }
    return document.getElementById('ct');
  }

  function route() {
    const page = location.hash.slice(1) || 'panel';
    const fn = { panel, ventas, cajas, carta, articulos, proveedores, compras, stock, locales, proyeccion, usuarios, ajustes, verifactu }[page] || panel;
    fn().catch((e) => { toast(e.message, 'error'); if (e.status === 401) { POP.setToken(null, 'adm.token'); renderLogin(); } });
  }

  // ------------------------------------------------------------- formularios
  function formModal(title, fields, values = {}, onSave, { wide = false, extra = '' } = {}) {
    const input = (f) => {
      const v = values[f.k] ?? f.def ?? '';
      if (f.type === 'select') return `<select name="${f.k}">${f.options.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
      if (f.type === 'textarea') return `<textarea name="${f.k}" rows="3">${esc(v)}</textarea>`;
      if (f.type === 'checkbox') return `<label style="display:flex;gap:8px;align-items:center;font-weight:700;color:var(--text)"><input type="checkbox" name="${f.k}" ${v ? 'checked' : ''} style="width:auto"> ${esc(f.text || 'Sí')}</label>`;
      return `<input name="${f.k}" type="${f.type || 'text'}" value="${esc(v)}" ${f.step ? `step="${f.step}"` : f.type === 'number' ? 'step="any"' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.required ? 'required' : ''}>`;
    };
    const m = modal(`<div class="modal-head"><h2>${esc(title)}</h2><button class="x" data-close>×</button></div>
      <form class="modal-body" id="ff"><div class="${wide ? 'grid3' : 'grid2'}">${fields.map((f) => `<div class="field" style="${f.full ? 'grid-column:1/-1' : ''}"><label>${esc(f.label)}</label>${input(f)}${f.help ? `<small class="muted">${esc(f.help)}</small>` : ''}</div>`).join('')}</div>${extra}</form>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="save">Guardar</button></div>`, { wide });
    const save = async () => {
      const fd = {};
      for (const f of fields) {
        const el = m.el.querySelector(`[name="${f.k}"]`);
        if (f.type === 'checkbox') fd[f.k] = el.checked ? 1 : 0;
        else if (f.type === 'number') fd[f.k] = el.value === '' ? null : Number(el.value);
        else fd[f.k] = el.value;
        if (f.required && (fd[f.k] === '' || fd[f.k] == null)) return toast(`"${f.label}" es obligatorio`, 'error');
      }
      try { await onSave(fd, m); m.close(); } catch (e) { toast(e.message, 'error'); }
    };
    m.el.querySelector('#save').onclick = save;
    m.el.querySelector('#ff').onsubmit = (e) => { e.preventDefault(); save(); };
    return m;
  }

  // ---------------------------------------------------------------- gráficos
  function barChart(data, { h = 220, color = '#E2401B', fmt = eur, labelEvery = 1 } = {}) {
    if (!data.length) return '<div class="empty-state">Sin datos en este periodo</div>';
    const W = 760, H = h, pad = { l: 56, r: 10, t: 12, b: 28 };
    const max = Math.max(...data.map((d) => d.v), 1);
    const bw = Math.min(70, (W - pad.l - pad.r) / data.length);
    const ticks = 4;
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
    for (let i = 0; i <= ticks; i++) {
      const y = pad.t + (H - pad.t - pad.b) * (1 - i / ticks);
      s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" stroke="#EADFC8" stroke-width="1"/><text x="${pad.l - 6}" y="${y + 4}" text-anchor="end">${num(max * i / ticks, 0)}</text>`;
    }
    data.forEach((d, i) => {
      const bh = (H - pad.t - pad.b) * d.v / max, x = pad.l + i * bw + bw * 0.15, y = H - pad.b - bh;
      s += `<rect x="${x}" y="${y}" width="${bw * 0.7}" height="${Math.max(bh, 0)}" rx="4" fill="${d.c || color}"><title>${esc(d.l)}: ${fmt(d.v)}</title></rect>`;
      if (i % labelEvery === 0) s += `<text x="${x + bw * 0.35}" y="${H - 9}" text-anchor="middle">${esc(d.l)}</text>`;
    });
    return s + '</svg>';
  }
  const hbars = (rows, color = '#E2401B') => {
    const max = Math.max(...rows.map((r) => r.v), 1);
    return rows.map((r) => `<div class="bar-row"><span>${esc(r.l)}</span><div class="track"><div class="fill" style="width:${(r.v / max) * 100}%;background:${r.c || color}"></div></div><b class="r">${r.f || eur(r.v)}</b></div>`).join('') || '<div class="empty-state">Sin datos</div>';
  };

  // ------------------------------------------------------------------- panel
  async function panel() {
    const ct = layout('Panel de ventas', `<button class="btn btn-sm btn-ghost no-print" id="exp">⬇ Exportar ventas (CSV)</button>`, { range: true });
    document.getElementById('exp').onclick = () => download('/admin/export/ventas?' + qsBase(), 'popollo-ventas.csv');
    const r = await api('/reports/summary?' + qsBase());
    const net = r.base || 0;
    ct.innerHTML = `
      <div class="kpis">
        <div class="kpi" style="--c:var(--red)"><div class="l">Ventas (IVA incl.)</div><div class="v">${eur(r.total)}</div><div class="s">Sin IVA ${eur(net)}</div></div>
        <div class="kpi" style="--c:var(--yellow)"><div class="l">Tickets</div><div class="v">${num(r.tickets)}</div><div class="s">Ticket medio ${eur(r.avg_ticket)}</div></div>
        <div class="kpi" style="--c:${r.food_cost_pct > 38 ? '#C62828' : 'var(--green)'}"><div class="l">Coste de producto</div><div class="v">${pct(r.food_cost_pct)}</div><div class="s">${eur(r.cost)} teórico (escandallo)</div></div>
        <div class="kpi" style="--c:var(--orange)"><div class="l">Comisiones reparto</div><div class="v">${eur(r.commissions)}</div><div class="s">${net ? pct(r.commissions / net * 100) : '—'} de las ventas</div></div>
        <div class="kpi" style="--c:var(--brown)"><div class="l">Margen tras producto y comisiones</div><div class="v">${eur(r.gross_margin)}</div><div class="s">Cuota gestión ${eur(r.management_fee)}</div></div>
        <div class="kpi" style="--c:#C62828"><div class="l">Devoluciones</div><div class="v">${num(r.refund_count)}</div><div class="s">${eur(r.refunds)}</div></div>
      </div>
      <div class="cols-3-2">
        <div class="card"><h3>Ventas por día</h3>${barChart(r.byDay.map((d) => ({ l: d.day.slice(8, 10) + '/' + d.day.slice(5, 7), v: d.total })), { labelEvery: Math.ceil(r.byDay.length / 15) })}</div>
        <div class="card"><h3>Por canal</h3>${hbars(r.byChannel.map((c) => ({ l: CHANNEL_LABEL[c.channel], v: c.total, c: CHANNEL_COLOR[c.channel] })))}
          <h3 style="margin-top:18px">Por forma de pago</h3>${hbars(r.byMethod.map((m) => ({ l: METHOD_LABEL[m.method], v: m.total, c: '#2B1A12' })))}</div>
      </div>
      <div class="card"><h3>Cuenta de resultados por local</h3><p class="sub">Periodo de ${r.days} día(s). Gastos fijos prorrateados desde la ficha de cada local. Importes sin IVA.</p>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Local</th><th class="r">Tickets</th><th class="r">Ventas sin IVA</th><th class="r">Coste producto</th><th class="r">FC %</th><th class="r">Comisiones</th><th class="r">Cuota gestión</th><th class="r">Fijos</th><th class="r">Resultado</th></tr></thead>
        <tbody>${r.byStore.map((s) => `<tr><td><b>${esc(s.code)}</b> ${esc(s.name)}</td><td class="r">${s.tickets}</td><td class="r">${eur(s.base)}</td><td class="r">${eur(s.cost)}</td><td class="r">${s.base ? pct(s.cost / s.base * 100) : '—'}</td><td class="r">${eur(s.commission)}</td><td class="r">${eur(s.fee)}</td><td class="r">${eur(s.fixed)}</td><td class="r ${s.profit >= 0 ? 'good' : 'bad'}">${eur(s.profit)}</td></tr>`).join('') || '<tr><td colspan="9" class="empty-state">Sin ventas</td></tr>'}</tbody></table></div></div>
      <div class="cols">
        <div class="card"><h3>Productos más vendidos</h3><div class="tbl-wrap" style="max-height:420px"><table class="tbl"><thead><tr><th>Producto</th><th class="r">Uds.</th><th class="r">Ventas</th><th class="r">Margen</th></tr></thead>
          <tbody>${r.top.slice(0, 25).map((p) => `<tr><td>${esc(p.name)}</td><td class="r">${num(p.qty)}</td><td class="r">${eur(p.total)}</td><td class="r">${p.base ? pct((p.base - p.cost) / p.base * 100) : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">Sin ventas</td></tr>'}</tbody></table></div></div>
        <div class="card"><h3>Ventas por hora</h3>${barChart(r.byHour.map((h) => ({ l: h.hour + 'h', v: h.total })), { color: '#F29E0C' })}
          <p class="muted" style="font-size:13px">Horario POPOLLO: 11:00–16:00 y 19:00–23:00.</p></div>
      </div>`;
  }

  async function download(path, name) {
    const res = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + LS.get('adm.token') } });
    if (!res.ok) return toast('No se pudo exportar', 'error');
    const blob = await res.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ------------------------------------------------------------------ tickets
  async function ventas() {
    const ct = layout('Tickets y devoluciones', `<input id="q" placeholder="Nº, teléfono o cliente" class="no-print"><select id="ch"><option value="">Todos los canales</option>${Object.entries(CHANNEL_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><select id="ty"><option value="">Ventas y devoluciones</option><option value="venta">Solo ventas</option><option value="devolucion">Solo devoluciones</option></select>`, { range: true });
    const draw = async () => {
      const qv = document.getElementById('q').value, ch = document.getElementById('ch').value, ty = document.getElementById('ty').value;
      const list = await api(`/orders?${qsBase()}&q=${encodeURIComponent(qv)}&channel=${ch}&type=${ty}&limit=1000`);
      const tot = list.filter((o) => o.status === 'pagado').reduce((a, o) => a + o.total, 0);
      ct.innerHTML = `<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Local</th><th>Número</th><th>Canal</th><th>Cliente</th><th>Pago</th><th>Estado</th><th>Atendió</th><th class="r">Total</th></tr></thead>
        <tbody>${list.map((o) => `<tr class="click" data-id="${o.id}"><td>${dateEs(o.created_at)}</td><td>${esc(o.store_code)}</td><td>${esc(o.full_number || '#' + o.id)} ${o.type === 'devolucion' ? '<span class="pill" style="background:var(--red)">DEV</span>' : ''}</td>
          <td><span class="pill" style="background:${CHANNEL_COLOR[o.channel]}">${CHANNEL_LABEL[o.channel]}</span></td><td>${esc(o.customer_name || '')} ${esc(o.customer_phone || '')}</td>
          <td>${esc((o.methods || '').split(',').filter(Boolean).map((m) => METHOD_LABEL[m]).join(' + '))}</td><td>${esc(o.status)}</td><td>${esc(o.user_name || '')}</td><td class="r"><b>${eur(o.total)}</b></td></tr>`).join('') || '<tr><td colspan="9" class="empty-state">Sin tickets</td></tr>'}</tbody>
        <tfoot><tr><td colspan="8">${list.length} registros · cobrados</td><td class="r">${eur(tot)}</td></tr></tfoot></table></div></div>`;
      ct.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => orderDetail(Number(tr.dataset.id)));
    };
    let to; document.getElementById('q').oninput = () => { clearTimeout(to); to = setTimeout(draw, 300); };
    document.getElementById('ch').onchange = document.getElementById('ty').onchange = draw;
    draw();
  }
  async function orderDetail(id) {
    const o = await api('/orders/' + id);
    const st = await settingsCached();
    const m = modal(`<div class="modal-head"><h2>${esc(o.full_number || 'Pedido #' + o.id)}</h2><button class="x" data-close>×</button></div>
      <div class="modal-body"><div class="grid2"><div>
        <p><b>${esc(o.store_name)}</b><br>${dateEs(o.created_at)} · ${CHANNEL_LABEL[o.channel]}<br>Atendió: ${esc(o.user_name || '')}</p>
        ${o.customer_name || o.customer_phone ? `<p>Cliente: ${esc(o.customer_name || '')} ${esc(o.customer_phone || '')}<br>${esc(o.customer_address || '')}</p>` : ''}
        ${o.refund_reason ? `<p>Motivo devolución: <b>${esc(o.refund_reason)}</b></p>` : ''}
        ${o.ref ? `<p>Rectifica a: <b>${esc(o.ref.full_number)}</b></p>` : ''}
      </div><div><p>Coste teórico: <b>${eur(o.cost)}</b><br>Margen bruto: <b>${o.base ? pct((o.base - o.cost) / o.base * 100) : '—'}</b></p>
        ${o.hash ? `<p class="muted" style="font-size:11px;word-break:break-all">Huella: ${esc(o.hash)}<br>Anterior: ${esc(o.prev_hash || '—')}</p>` : ''}</div></div>
        <table class="tbl"><thead><tr><th>Uds.</th><th>Producto</th><th class="r">Precio</th><th class="r">Total</th><th class="r">Coste ud.</th></tr></thead>
        <tbody>${o.lines.map((l) => `<tr><td>${num(l.qty)}</td><td>${esc(l.name)}${l.notes ? ` <small class="muted">(${esc(l.notes)})</small>` : ''}</td><td class="r">${eur(l.unit_price)}</td><td class="r">${eur(l.total)}</td><td class="r">${eur(l.unit_cost)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td></td><td>Total</td><td></td><td class="r">${eur(o.total)}</td><td></td></tr></tfoot></table>
        <p>${o.payments.map((p) => METHOD_LABEL[p.method] + ': ' + eur(p.amount)).join(' · ')}</p>
        ${o.refunds.length ? `<p class="bad">Devoluciones: ${o.refunds.map((r) => esc(r.full_number) + ' ' + eur(r.total)).join(', ')}</p>` : ''}</div>
      <div class="modal-foot"><button class="btn btn-ghost" id="pr">🧾 Imprimir ticket</button></div>`, { wide: true });
    m.el.querySelector('#pr').onclick = () => printHtml(ticketHtml(o, st));
  }
  async function settingsCached() { if (!S.cache.settings) S.cache.settings = await api('/admin/settings'); return S.cache.settings; }

  // -------------------------------------------------------------------- cajas
  async function cajas() {
    const ct = layout('Cierres de caja', '', { range: true });
    const list = await api('/cash?' + qsBase());
    ct.innerHTML = `<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Local</th><th>Apertura</th><th>Cierre</th><th>Abrió / cerró</th><th class="r">Fondo</th><th class="r">Total cobrado</th><th class="r">Efectivo esperado</th><th class="r">Contado</th><th class="r">Diferencia</th></tr></thead>
      <tbody>${list.map((c) => `<tr class="click" data-id="${c.id}"><td>${esc(c.store_code)}</td><td>${dateEs(c.opened_at)}</td><td>${c.closed_at ? dateEs(c.closed_at) : '<span class="pill" style="background:var(--green)">ABIERTA</span>'}</td>
        <td>${esc(c.opened_by_name || '')}${c.closed_by_name ? ' / ' + esc(c.closed_by_name) : ''}</td><td class="r">${eur(c.opening_float)}</td><td class="r">${eur(c.total)}</td><td class="r">${c.expected_cash != null ? eur(c.expected_cash) : '—'}</td>
        <td class="r">${c.counted_cash != null ? eur(c.counted_cash) : '—'}</td><td class="r ${c.difference < -0.009 ? 'bad' : c.difference > 0.009 ? 'warn' : 'good'}">${c.difference != null ? eur(c.difference, true) : '—'}</td></tr>`).join('') || '<tr><td colspan="9" class="empty-state">Sin cajas en el periodo</td></tr>'}</tbody></table></div></div>`;
    ct.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = async () => {
      const s = await api('/cash/' + tr.dataset.id);
      modal(`<div class="modal-head"><h2>Caja ${esc(s.session.store_code)} · ${dateEs(s.session.opened_at)}</h2><button class="x" data-close>×</button></div>
        <div class="modal-body"><table class="tbl"><tbody>
        ${s.byMethod.map((m) => `<tr><td>${METHOD_LABEL[m.method]} (${m.n})</td><td class="r">${eur(m.total)}</td></tr>`).join('')}
        ${Object.entries(s.byChannel).map(([c, v]) => `<tr><td>${CHANNEL_LABEL[c]}</td><td class="r">${eur(v)}</td></tr>`).join('')}
        ${s.vat.map((v) => `<tr><td>IVA ${num(v.vat)} % · base ${eur(v.base)}</td><td class="r">${eur(v.cuota)}</td></tr>`).join('')}
        ${s.moves.map((m) => `<tr><td>${esc(m.type)}: ${esc(m.reason || '')} (${esc(m.user_name || '')})</td><td class="r">${eur(m.amount)}</td></tr>`).join('')}
        <tr><td>Tickets / ticket medio</td><td class="r">${s.tickets} / ${eur(s.avg_ticket)}</td></tr>
        <tr><td>Devoluciones</td><td class="r">${s.refunds} / ${eur(s.refunds_total)}</td></tr>
        <tr><td><b>Total</b></td><td class="r"><b>${eur(s.total)}</b></td></tr>
        ${s.session.notes ? `<tr><td colspan="2">Notas: ${esc(s.session.notes)}</td></tr>` : ''}</tbody></table></div>`);
    });
  }

  // -------------------------------------------------------- carta y escandallos
  async function carta() {
    const isAdmin = S.user.role === 'admin';
    const ct = layout('Carta y escandallos', isAdmin ? `<button class="btn btn-sm btn-ghost" id="cats">Categorías</button><button class="btn btn-sm btn-primary" id="new">+ Nuevo producto</button>` : '', { store: false });
    const [costs, cats, prods] = await Promise.all([api('/admin/costs'), api('/admin/categories'), api('/admin/products')]);
    const st = await settingsCached();
    const fcCls = (v) => (v > 38 ? 'bad' : v > 32 ? 'warn' : 'good');
    const draw = (filter = '') => {
      const rows = costs.products.filter((p) => !filter || p.category === filter);
      ct.innerHTML = `<div class="notice">Costes calculados en tiempo real desde los escandallos y el último precio de compra de cada artículo. Precios <b>sin IVA</b> para el margen. Plataformas: recargo ${esc(st.delivery_surcharge_pct)} % y comisión ${esc(st.commission_glovo)} % (Glovo). Objetivo de coste de producto ≤ 37 %.</div>
        <div class="tabs">${['', ...cats.map((c) => c.name)].map((c) => `<button data-c="${esc(c)}" class="${c === filter ? 'on' : ''}">${c || 'Todo'}</button>`).join('')}</div>
        <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th class="r">PVP local</th><th class="r">PVP plataformas</th><th class="r">Comida</th><th class="r">Packaging</th><th class="r">Coste total</th><th class="r">Coste %</th><th class="r">Margen €</th><th class="r">Margen %</th><th class="r">Margen plataforma</th></tr></thead>
        <tbody>${rows.map((p) => `<tr class="click" data-id="${p.id}" style="${p.active ? '' : 'opacity:.45'}"><td><b>${esc(p.name)}</b><br><small class="muted">${esc(p.category || '')}</small></td>
          <td class="r">${eur(p.price)}</td><td class="r">${eur(p.price_platform)}</td><td class="r">${eur(p.cost_food)}</td><td class="r">${eur(p.cost_pack)}</td><td class="r"><b>${eur(p.cost)}</b></td>
          <td class="r ${fcCls(p.food_cost_pct)}">${pct(p.food_cost_pct)}</td><td class="r">${eur(p.margin)}</td><td class="r">${pct(p.margin_pct)}</td><td class="r ${p.margin_platform_pct < 30 ? 'bad' : ''}">${pct(p.margin_platform_pct)}</td></tr>`).join('')}</tbody></table></div></div>`;
      ct.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => draw(b.dataset.c));
      ct.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => productEditor(prods.find((p) => p.id === Number(tr.dataset.id)), cats));
    };
    draw();
    if (isAdmin) {
      document.getElementById('new').onclick = () => productEditor({ vat: Number(st.default_vat || 10), active: 1, category_id: cats[0]?.id }, cats);
      document.getElementById('cats').onclick = () => categoriesModal(cats);
    }
  }

  function categoriesModal(cats) {
    const m = modal(`<div class="modal-head"><h2>Categorías de la carta</h2><button class="x" data-close>×</button></div>
      <div class="modal-body"><table class="tbl"><thead><tr><th>Nombre</th><th>Color</th><th>Orden</th><th></th></tr></thead><tbody>
      ${cats.map((c) => `<tr data-id="${c.id}"><td><input class="input" value="${esc(c.name)}" data-f="name"></td><td><input type="color" value="${esc(c.color)}" data-f="color"></td><td><input class="input" type="number" value="${c.sort}" data-f="sort" style="width:70px"></td><td><button class="btn btn-sm btn-ghost" data-save>Guardar</button></td></tr>`).join('')}
      <tr data-id="new"><td><input class="input" placeholder="Nueva categoría" data-f="name"></td><td><input type="color" value="#FFC93C" data-f="color"></td><td><input class="input" type="number" value="${cats.length + 1}" data-f="sort" style="width:70px"></td><td><button class="btn btn-sm btn-primary" data-save>Añadir</button></td></tr>
      </tbody></table></div>`);
    m.el.querySelectorAll('[data-save]').forEach((b) => b.onclick = async () => {
      const tr = b.closest('tr'); const body = {}; tr.querySelectorAll('[data-f]').forEach((i) => (body[i.dataset.f] = i.type === 'number' ? Number(i.value) : i.value));
      if (!body.name) return toast('Pon un nombre', 'error');
      try { if (tr.dataset.id === 'new') await api('/admin/categories', { body }); else await api('/admin/categories/' + tr.dataset.id, { method: 'PUT', body }); toast('Guardado'); m.close(); route(); } catch (e) { toast(e.message, 'error'); }
    });
  }

  // Editor de producto + escandallo
  async function productEditor(p, cats) {
    const isAdmin = S.user.role === 'admin';
    const [items, prods, costs] = await Promise.all([api('/admin/items'), api('/admin/products'), api('/admin/costs')]);
    const st = await settingsCached();
    const itemCost = new Map(costs.items.map((i) => [i.id, i.unit_cost]));
    const prodCost = new Map(costs.products.map((x) => [x.id, x.cost]));
    let lines = p.id ? await api('/admin/recipe/product/' + p.id) : [];
    lines = lines.map((l) => ({ item_id: l.item_id, sub_product_id: l.sub_product_id, qty: l.qty, channel: l.channel }));
    const opts = `<optgroup label="Materias primas">${items.filter((i) => i.kind === 'ingrediente' && i.active).map((i) => `<option value="i${i.id}">${esc(i.name)} (${i.unit})</option>`).join('')}</optgroup>
      <optgroup label="Elaboraciones (salsas, adobos…)">${items.filter((i) => i.kind === 'elaboracion' && i.active).map((i) => `<option value="i${i.id}">${esc(i.name)} (${i.unit})</option>`).join('')}</optgroup>
      <optgroup label="Packaging">${items.filter((i) => i.kind === 'packaging' && i.active).map((i) => `<option value="i${i.id}">${esc(i.name)} (${i.unit})</option>`).join('')}</optgroup>
      <optgroup label="Productos de la carta (para menús)">${prods.filter((x) => x.id !== p.id && x.active).map((x) => `<option value="p${x.id}">${esc(x.name)}</option>`).join('')}</optgroup>`;
    const m = modal(`<div class="modal-head"><h2>${p.id ? esc(p.name) : 'Nuevo producto'}</h2><button class="x" data-close>×</button></div>
      <div class="modal-body">
        <div class="grid3">
          <div class="field" style="grid-column:span 2"><label>Nombre</label><input id="f-name" value="${esc(p.name || '')}"></div>
          <div class="field"><label>Nombre corto (botón TPV)</label><input id="f-short" value="${esc(p.short_name || '')}"></div>
          <div class="field"><label>Categoría</label><select id="f-cat">${cats.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label>PVP local (IVA incl.)</label><input id="f-price" type="number" step="0.05" value="${p.price ?? ''}"></div>
          <div class="field"><label>PVP plataformas (vacío = +${esc(st.delivery_surcharge_pct)} %)</label><input id="f-pd" type="number" step="0.05" value="${p.price_delivery ?? ''}"></div>
          <div class="field"><label>IVA %</label><select id="f-vat">${[10, 21, 4].map((v) => `<option ${Number(p.vat) === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label>Color del botón (opcional)</label><input id="f-color" type="color" value="${esc(p.color || '#FFC93C')}"></div>
          <div class="field"><label>Orden / Activo</label><div style="display:flex;gap:8px"><input id="f-sort" type="number" value="${p.sort ?? 0}" style="width:80px"><label style="display:flex;align-items:center;gap:6px;font-weight:700"><input id="f-active" type="checkbox" ${p.active ? 'checked' : ''} style="width:auto">Activo</label></div></div>
        </div>
        <h3 style="margin:8px 0">Escandallo</h3>
        <p class="muted" style="margin-top:-4px;font-size:13px">Cantidades por 1 unidad vendida, en la unidad del artículo (kg, l, ud). Las líneas "Solo a domicilio" (bolsa, cubiertos, precinto) solo cuentan en domicilio y plataformas.</p>
        <table class="tbl recipe"><thead><tr><th>Artículo</th><th>Cantidad</th><th>Uso</th><th class="r">Coste ud.</th><th class="r">Coste línea</th><th></th></tr></thead><tbody id="rl"></tbody></table>
        <button class="btn btn-sm btn-ghost" id="add" style="margin-top:8px">+ Añadir línea</button>
        <div class="summary-box" id="sum"></div>
      </div>
      <div class="modal-foot">${p.id && isAdmin ? '<button class="btn btn-ghost" id="del" style="margin-right:auto">Dar de baja</button>' : ''}<button class="btn btn-ghost" data-close>Cerrar</button>${isAdmin ? '<button class="btn btn-primary" id="save">Guardar</button>' : ''}</div>`, { wide: true });
    const rl = m.el.querySelector('#rl');
    const unitCost = (l) => (l.item_id ? itemCost.get(l.item_id) || 0 : prodCost.get(l.sub_product_id) || 0);
    const kindOf = (l) => (l.item_id ? items.find((i) => i.id === l.item_id)?.kind : 'producto');
    const drawLines = () => {
      rl.innerHTML = lines.map((l, i) => `<tr data-i="${i}"><td><select data-f="ref">${opts}</select></td><td class="qty"><input data-f="qty" type="number" step="any" value="${l.qty}"></td>
        <td><select data-f="channel"><option value="all">Siempre</option><option value="delivery" ${l.channel === 'delivery' ? 'selected' : ''}>Solo a domicilio</option></select></td>
        <td class="r">${eur(unitCost(l))}</td><td class="r"><b>${eur(unitCost(l) * l.qty)}</b></td><td><button class="x" data-del>×</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">Sin escandallo</td></tr>';
      rl.querySelectorAll('tr[data-i]').forEach((tr) => {
        const l = lines[Number(tr.dataset.i)];
        const sel = tr.querySelector('[data-f=ref]'); sel.value = l.item_id ? 'i' + l.item_id : l.sub_product_id ? 'p' + l.sub_product_id : '';
        sel.onchange = () => { const v = sel.value; l.item_id = v[0] === 'i' ? Number(v.slice(1)) : null; l.sub_product_id = v[0] === 'p' ? Number(v.slice(1)) : null; drawLines(); };
        tr.querySelector('[data-f=qty]').onchange = (e) => { l.qty = Number(e.target.value); drawLines(); };
        tr.querySelector('[data-f=channel]').onchange = (e) => { l.channel = e.target.value; drawSum(); };
        tr.querySelector('[data-del]').onclick = () => { lines.splice(Number(tr.dataset.i), 1); drawLines(); };
      });
      drawSum();
    };
    const drawSum = () => {
      const price = Number(m.el.querySelector('#f-price').value) || 0, vat = Number(m.el.querySelector('#f-vat').value) || 10;
      const pd = Number(m.el.querySelector('#f-pd').value) || Math.round(price * (1 + Number(st.delivery_surcharge_pct) / 100) * 20) / 20;
      const local = lines.filter((l) => l.channel !== 'delivery').reduce((a, l) => a + unitCost(l) * l.qty, 0);
      const pack = lines.filter((l) => l.channel !== 'delivery' && kindOf(l) === 'packaging').reduce((a, l) => a + unitCost(l) * l.qty, 0);
      const deliv = lines.reduce((a, l) => a + unitCost(l) * l.qty, 0);
      const net = price / (1 + vat / 100), netP = pd / (1 + vat / 100), comm = netP * Number(st.commission_glovo || 30) / 100;
      m.el.querySelector('#sum').innerHTML = `<div><span>Coste local</span><b>${eur(local)}</b></div><div><span>de ello packaging</span><b>${eur(pack)}</b></div>
        <div><span>Precio sin IVA</span><b>${eur(net)}</b></div><div><span>Coste producto %</span><b class="${net && local / net > .38 ? 'bad' : 'good'}">${net ? pct(local / net * 100) : '—'}</b></div>
        <div><span>Margen local</span><b>${eur(net - local)} (${net ? pct((net - local) / net * 100) : '—'})</b></div>
        <div><span>Margen plataforma</span><b>${eur(netP - deliv - comm)} (${netP ? pct((netP - deliv - comm) / netP * 100) : '—'})</b></div>`;
    };
    ['#f-price', '#f-pd', '#f-vat'].forEach((s) => m.el.querySelector(s).addEventListener('input', drawSum));
    m.el.querySelector('#add').onclick = () => { lines.push({ item_id: items.find((i) => i.kind === 'ingrediente')?.id, qty: 1, channel: 'all' }); drawLines(); };
    m.el.querySelector('#del')?.addEventListener('click', async () => { if (await confirmBox('¿Dar de baja este producto? Dejará de aparecer en el TPV.', { ok: 'Dar de baja', danger: true })) { await api('/admin/products/' + p.id, { method: 'DELETE' }); m.close(); route(); } });
    m.el.querySelector('#save')?.addEventListener('click', async () => {
      const body = {
        name: m.el.querySelector('#f-name').value.trim(), short_name: m.el.querySelector('#f-short').value.trim(), category_id: Number(m.el.querySelector('#f-cat').value),
        price: Number(m.el.querySelector('#f-price').value), price_delivery: m.el.querySelector('#f-pd').value === '' ? null : Number(m.el.querySelector('#f-pd').value),
        vat: Number(m.el.querySelector('#f-vat').value), color: m.el.querySelector('#f-color').value === '#ffc93c' && !p.color ? null : m.el.querySelector('#f-color').value,
        sort: Number(m.el.querySelector('#f-sort').value), active: m.el.querySelector('#f-active').checked ? 1 : 0
      };
      if (!body.name || !(body.price >= 0)) return toast('Nombre y precio son obligatorios', 'error');
      try {
        const saved = p.id ? await api('/admin/products/' + p.id, { method: 'PUT', body }) : await api('/admin/products', { body });
        await api(`/admin/recipe/product/${saved.id}`, { method: 'PUT', body: { lines } });
        toast('Producto guardado'); m.close(); route();
      } catch (e) { toast(e.message, 'error'); }
    });
    drawLines();
  }

  // --------------------------------------------------------------- artículos
  async function articulos() {
    const isAdmin = S.user.role === 'admin';
    const ct = layout('Artículos, packaging y elaboraciones', isAdmin ? '<button class="btn btn-sm btn-primary" id="new">+ Nuevo artículo</button>' : '', { store: false });
    const [items, sups, costs] = await Promise.all([api('/admin/items'), api('/admin/suppliers'), api('/admin/costs')]);
    const uc = new Map(costs.items.map((i) => [i.id, i.unit_cost]));
    let tab = S.cache.itemTab || 'ingrediente', q = '';
    const draw = () => {
      S.cache.itemTab = tab;
      const rows = items.filter((i) => i.kind === tab && (!q || i.name.toLowerCase().includes(q)));
      ct.innerHTML = `<div class="tabs">${Object.entries(KIND).map(([k, l]) => `<button data-k="${k}" class="${tab === k ? 'on' : ''}">${l} (${items.filter((i) => i.kind === k).length})</button>`).join('')}
        <input class="input" id="iq" placeholder="Buscar…" style="max-width:240px;margin-left:auto" value="${esc(q)}"></div>
        ${tab === 'elaboracion' ? '<div class="notice">Las elaboraciones (salsas, adobos) tienen su propia receta. Su coste por unidad = coste de la receta ÷ rendimiento. Se usan dentro de los escandallos de los productos.</div>' : ''}
        <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Artículo</th><th>Unidad</th><th class="r">Coste / unidad</th>${tab === 'elaboracion' ? '<th class="r">Rinde</th>' : '<th>Proveedor</th><th class="r">Stock mínimo</th>'}<th>Notas</th></tr></thead>
        <tbody>${rows.map((i) => `<tr class="click" data-id="${i.id}" style="${i.active ? '' : 'opacity:.45'}"><td><b>${esc(i.name)}</b></td><td>${esc(i.unit)}</td><td class="r">${eur(uc.get(i.id))}</td>
          ${tab === 'elaboracion' ? `<td class="r">${num(i.yield_qty)} ${esc(i.unit)}</td>` : `<td>${esc(sups.find((s) => s.id === i.supplier_id)?.name || '—')}</td><td class="r">${num(i.min_stock)}</td>`}<td class="muted" style="font-size:13px">${esc(i.notes || '')}</td></tr>`).join('')}</tbody></table></div></div>`;
      ct.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => { tab = b.dataset.k; draw(); });
      const iq = ct.querySelector('#iq'); iq.oninput = () => { q = iq.value.toLowerCase(); const pos = iq.selectionStart; draw(); const n = ct.querySelector('#iq'); n.focus(); n.setSelectionRange(pos, pos); };
      ct.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => itemEditor(items.find((i) => i.id === Number(tr.dataset.id)), sups, items, uc));
    };
    draw();
    if (isAdmin) document.getElementById('new').onclick = () => itemEditor({ kind: tab, unit: tab === 'packaging' ? 'ud' : 'kg', active: 1, yield_qty: 1, purchase_factor: 1 }, sups, items, uc);
  }

  async function itemEditor(it, sups, items, uc) {
    const isAdmin = S.user.role === 'admin';
    const isElab = it.kind === 'elaboracion';
    let lines = isElab && it.id ? (await api('/admin/recipe/item/' + it.id)).map((l) => ({ item_id: l.item_id, qty: l.qty })) : [];
    const fields = [
      { k: 'name', label: 'Nombre', required: true, full: true },
      { k: 'kind', label: 'Tipo', type: 'select', options: Object.entries(KIND) },
      { k: 'unit', label: 'Unidad de control', type: 'select', options: [['kg', 'kg'], ['l', 'litros'], ['ud', 'unidades']] },
      ...(isElab ? [{ k: 'yield_qty', label: 'Rendimiento de la receta (en su unidad)', type: 'number', help: 'Ej.: salsa 1 l → 1; adobo para 10 pollos → 10 ud' }]
        : [{ k: 'cost', label: 'Coste por unidad sin IVA (€)', type: 'number', step: '0.0001', help: 'Se actualiza solo al recibir compras' },
          { k: 'supplier_id', label: 'Proveedor habitual', type: 'select', options: [['', '—'], ...sups.map((s) => [s.id, s.name])] },
          { k: 'min_stock', label: 'Stock mínimo por local', type: 'number', help: 'Por debajo, aparece en la propuesta de pedido' },
          { k: 'purchase_unit', label: 'Formato de compra (opcional)', placeholder: 'Caja 100 ud, saco 25 kg…' }]),
      { k: 'notes', label: 'Notas / ficha técnica', type: 'textarea', full: true },
      { k: 'active', label: 'Estado', type: 'checkbox', text: 'Activo' }
    ];
    const elabOpts = items.filter((i) => i.kind !== 'elaboracion' || i.id !== it.id).filter((i) => i.active).map((i) => `<option value="${i.id}">${esc(i.name)} (${i.unit})</option>`).join('');
    const extra = isElab ? `<h3 style="margin:6px 0">Receta</h3><table class="tbl recipe"><thead><tr><th>Ingrediente</th><th>Cantidad</th><th class="r">Coste</th><th></th></tr></thead><tbody id="el"></tbody></table>
      <button type="button" class="btn btn-sm btn-ghost" id="eadd" style="margin-top:8px">+ Añadir ingrediente</button><div class="summary-box" id="esum"></div>` : '';
    const m = formModal(it.id ? it.name : 'Nuevo artículo', fields, it, async (fd) => {
      if (!isAdmin) throw new Error('Solo administración puede modificar artículos');
      const saved = it.id ? await api('/admin/items/' + it.id, { method: 'PUT', body: fd }) : await api('/admin/items', { body: fd });
      if (isElab) await api('/admin/recipe/item/' + saved.id, { method: 'PUT', body: { lines } });
      toast('Guardado'); route();
    }, { extra });
    if (isElab) {
      const el = m.el.querySelector('#el');
      const draw = () => {
        el.innerHTML = lines.map((l, i) => `<tr data-i="${i}"><td><select>${elabOpts}</select></td><td class="qty"><input type="number" step="any" value="${l.qty}"></td><td class="r">${eur((uc.get(l.item_id) || 0) * l.qty)}</td><td><button type="button" class="x">×</button></td></tr>`).join('');
        el.querySelectorAll('tr').forEach((tr) => {
          const l = lines[Number(tr.dataset.i)]; const s = tr.querySelector('select'); s.value = l.item_id;
          s.onchange = () => { l.item_id = Number(s.value); draw(); };
          tr.querySelector('input').onchange = (e) => { l.qty = Number(e.target.value); draw(); };
          tr.querySelector('.x').onclick = () => { lines.splice(Number(tr.dataset.i), 1); draw(); };
        });
        const tot = lines.reduce((a, l) => a + (uc.get(l.item_id) || 0) * l.qty, 0);
        const y = Number(m.el.querySelector('[name=yield_qty]').value) || 1;
        m.el.querySelector('#esum').innerHTML = `<div><span>Coste receta</span><b>${eur(tot)}</b></div><div><span>Coste por unidad</span><b>${eur(tot / y)}</b></div>${it.unit === 'l' || m.el.querySelector('[name=unit]').value === 'l' ? `<div><span>Ración 50 ml</span><b>${eur(tot / y * 0.05)}</b></div>` : ''}`;
      };
      m.el.querySelector('#eadd').onclick = () => { lines.push({ item_id: items.find((i) => i.kind === 'ingrediente').id, qty: 0.1 }); draw(); };
      m.el.querySelector('[name=yield_qty]').oninput = draw;
      draw();
    }
  }

  // -------------------------------------------------------------- proveedores
  async function proveedores() {
    const isAdmin = S.user.role === 'admin';
    const ct = layout('Proveedores', isAdmin ? '<button class="btn btn-sm btn-primary" id="new">+ Nuevo proveedor</button>' : '', { store: false });
    const [sups, items] = await Promise.all([api('/admin/suppliers'), api('/admin/items')]);
    const fields = [{ k: 'name', label: 'Nombre', required: true, full: true }, { k: 'category', label: 'Categoría' }, { k: 'cif', label: 'CIF' }, { k: 'contact', label: 'Persona de contacto' },
      { k: 'phone', label: 'Teléfono' }, { k: 'email', label: 'Email de pedidos', type: 'email' }, { k: 'notes', label: 'Notas (condiciones, días de reparto…)', type: 'textarea', full: true }, { k: 'active', label: 'Estado', type: 'checkbox', text: 'Activo' }];
    ct.innerHTML = `<div class="card"><table class="tbl"><thead><tr><th>Proveedor</th><th>Categoría</th><th>Contacto</th><th class="r">Artículos</th><th>Notas</th></tr></thead>
      <tbody>${sups.map((s) => `<tr class="click" data-id="${s.id}" style="${s.active ? '' : 'opacity:.45'}"><td><b>${esc(s.name)}</b></td><td>${esc(s.category || '')}</td><td>${esc([s.contact, s.phone, s.email].filter(Boolean).join(' · '))}</td><td class="r">${items.filter((i) => i.supplier_id === s.id).length}</td><td class="muted" style="font-size:13px">${esc(s.notes || '')}</td></tr>`).join('')}</tbody></table></div>`;
    const save = (s) => async (fd) => { if (s.id) await api('/admin/suppliers/' + s.id, { method: 'PUT', body: fd }); else await api('/admin/suppliers', { body: fd }); toast('Guardado'); route(); };
    ct.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { const s = sups.find((x) => x.id === Number(tr.dataset.id)); if (isAdmin) formModal(s.name, fields, s, save(s)); });
    if (isAdmin) document.getElementById('new').onclick = () => formModal('Nuevo proveedor', fields, { active: 1 }, save({}));
  }

  // ------------------------------------------------------------------ compras
  async function compras() {
    const ct = layout('Compras a proveedores', '<select id="pst"><option value="">Todos los estados</option>' + Object.entries(PURCHASE_STATUS).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('') + '</select><button class="btn btn-sm btn-primary" id="new">+ Nuevo pedido</button>');
    const draw = async () => {
      const list = await api(`/purchases?${S.store ? 'store_id=' + S.store : ''}&status=${document.getElementById('pst').value}`);
      ct.innerHTML = `<div class="notice">Flujo: <b>Borrador</b> → <b>Pedido enviado</b> → <b>Recepción</b> (se comprueba cantidad, precio y temperatura). Al recibir, el stock sube y el coste del artículo se actualiza, así los escandallos siempre usan el precio real.</div>
        <div class="card"><table class="tbl"><thead><tr><th>Nº</th><th>Fecha</th><th>Local</th><th>Proveedor</th><th>Estado</th><th class="r">Líneas</th><th class="r">Total sin IVA</th><th>Factura</th></tr></thead>
        <tbody>${list.map((p) => `<tr class="click" data-id="${p.id}"><td>C-${p.id}</td><td>${dateEs(p.created_at)}</td><td>${esc(p.store_code)}</td><td>${esc(p.supplier_name || '—')}</td>
          <td><span class="pill" style="background:${PURCHASE_STATUS[p.status][1]}">${PURCHASE_STATUS[p.status][0]}</span></td><td class="r">${p.n_lines}</td><td class="r">${eur(p.total)}</td><td>${esc(p.invoice_ref || '')}</td></tr>`).join('') || '<tr><td colspan="8" class="empty-state">Sin compras todavía</td></tr>'}</tbody></table></div>`;
      ct.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => purchaseEditor(Number(tr.dataset.id)));
    };
    document.getElementById('pst').onchange = draw;
    document.getElementById('new').onclick = () => purchaseEditor(null);
    draw();
  }

  async function purchaseEditor(id) {
    const [items, sups] = await Promise.all([api('/admin/items'), api('/admin/suppliers')]);
    let p = id ? await api('/purchases/' + id) : { store_id: Number(S.store) || S.stores.find((s) => s.active)?.id, supplier_id: '', status: 'borrador', lines: [] };
    const editable = ['borrador', 'pedido'].includes(p.status);
    let lines = p.lines.map((l) => ({ id: l.id, item_id: l.item_id, qty: l.qty, unit_cost: l.unit_cost, received_qty: l.received_qty }));
    const base = items.filter((i) => i.kind !== 'elaboracion' && i.active);
    const m = modal(`<div class="modal-head"><h2>${id ? 'Pedido C-' + id : 'Nuevo pedido a proveedor'} <span class="pill" style="background:${PURCHASE_STATUS[p.status][1]}">${PURCHASE_STATUS[p.status][0]}</span></h2><button class="x" data-close>×</button></div>
      <div class="modal-body"><div class="grid3">
        <div class="field"><label>Local</label><select id="p-store" ${id ? 'disabled' : ''}>${S.stores.filter((s) => s.active && (!S.user.store_id || s.id === S.user.store_id)).map((s) => `<option value="${s.id}" ${s.id === p.store_id ? 'selected' : ''}>${esc(s.code)} · ${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Proveedor</label><select id="p-sup" ${editable ? '' : 'disabled'}><option value="">— Varios —</option>${sups.filter((s) => s.active).map((s) => `<option value="${s.id}" ${s.id === p.supplier_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Entrega prevista</label><input id="p-exp" type="date" value="${esc(p.expected_at || '')}" ${editable ? '' : 'disabled'}></div></div>
        ${editable ? '<div class="tools"><button class="btn btn-sm btn-yellow" id="sug">✨ Rellenar con lo que falta (stock mínimo)</button></div>' : ''}
        <table class="tbl recipe"><thead><tr><th>Artículo</th><th>Cantidad</th><th>Coste ud. sin IVA</th><th class="r">Importe</th>${p.status === 'recibido' ? '<th class="r">Recibido</th>' : ''}<th></th></tr></thead><tbody id="pl"></tbody></table>
        ${editable ? '<button class="btn btn-sm btn-ghost" id="padd" style="margin-top:8px">+ Añadir artículo</button>' : ''}
        <div class="summary-box"><div><span>Total sin IVA</span><b id="ptot"></b></div>${p.invoice_ref ? `<div><span>Factura</span><b>${esc(p.invoice_ref)}</b></div>` : ''}${p.received_at ? `<div><span>Recibido</span><b>${dateEs(p.received_at)}</b></div>` : ''}</div>
        <div class="field" style="margin-top:12px"><label>Notas</label><input id="p-notes" value="${esc(p.notes || '')}" ${editable ? '' : 'disabled'}></div>
      </div>
      <div class="modal-foot">
        ${id && editable ? '<button class="btn btn-ghost" id="cancel" style="margin-right:auto">Anular</button>' : ''}
        ${id ? '<button class="btn btn-ghost" id="print">🖨 Imprimir / PDF</button>' : ''}
        ${editable ? '<button class="btn btn-ghost" id="save">Guardar borrador</button>' : ''}
        ${editable && p.status === 'borrador' ? '<button class="btn btn-yellow" id="send">Marcar como pedido</button>' : ''}
        ${id && editable ? '<button class="btn btn-ok" id="recv">📥 Recepcionar</button>' : ''}</div>`, { wide: true });
    const pl = m.el.querySelector('#pl');
    const draw = () => {
      pl.innerHTML = lines.map((l, i) => {
        const it = items.find((x) => x.id === l.item_id);
        return `<tr data-i="${i}"><td>${editable ? `<select>${base.map((x) => `<option value="${x.id}" ${x.id === l.item_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : esc(it?.name)}</td>
        <td class="qty">${editable ? `<input data-f="qty" type="number" step="any" value="${l.qty}">` : num(l.qty)} ${esc(it?.unit || '')}</td>
        <td class="qty">${editable ? `<input data-f="unit_cost" type="number" step="0.0001" value="${l.unit_cost}">` : eur(l.unit_cost)}</td>
        <td class="r">${eur(l.qty * l.unit_cost)}</td>${p.status === 'recibido' ? `<td class="r">${num(l.received_qty)}</td>` : ''}<td>${editable ? '<button class="x">×</button>' : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="5" class="empty-state">Añade artículos al pedido</td></tr>';
      pl.querySelectorAll('tr[data-i]').forEach((tr) => {
        const l = lines[Number(tr.dataset.i)];
        tr.querySelector('select')?.addEventListener('change', (e) => { l.item_id = Number(e.target.value); l.unit_cost = items.find((x) => x.id === l.item_id).cost; draw(); });
        tr.querySelectorAll('input[data-f]').forEach((inp) => inp.onchange = () => { l[inp.dataset.f] = Number(inp.value); draw(); });
        tr.querySelector('.x')?.addEventListener('click', () => { lines.splice(Number(tr.dataset.i), 1); draw(); });
      });
      m.el.querySelector('#ptot').textContent = eur(lines.reduce((a, l) => a + l.qty * l.unit_cost, 0));
    };
    const body = (status) => ({ store_id: Number(m.el.querySelector('#p-store').value), supplier_id: Number(m.el.querySelector('#p-sup').value) || null, expected_at: m.el.querySelector('#p-exp').value || null, notes: m.el.querySelector('#p-notes').value, lines, ...(status ? { status } : {}) });
    const persist = async (status) => {
      const b = body(status);
      if (!b.lines.length) throw new Error('El pedido no tiene líneas');
      p = p.id ? await api('/purchases/' + p.id, { method: 'PUT', body: b }) : await api('/purchases', { body: b });
      if (status && !id) p = await api('/purchases/' + p.id, { method: 'PUT', body: { status } });
      return p;
    };
    m.el.querySelector('#padd')?.addEventListener('click', () => {
      const sup = Number(m.el.querySelector('#p-sup').value);
      const first = base.find((x) => !sup || x.supplier_id === sup) || base[0];
      lines.push({ item_id: first.id, qty: 1, unit_cost: first.cost }); draw();
    });
    m.el.querySelector('#sug')?.addEventListener('click', async () => {
      const sup = m.el.querySelector('#p-sup').value;
      const sg = await api(`/purchases-suggest?store_id=${m.el.querySelector('#p-store').value}${sup ? '&supplier_id=' + sup : ''}`);
      if (!sg.length) return toast('No falta nada: todo está por encima del mínimo');
      for (const s of sg) if (!lines.find((l) => l.item_id === s.item_id)) lines.push({ item_id: s.item_id, qty: s.qty, unit_cost: s.unit_cost });
      draw(); toast(`${sg.length} artículo(s) por debajo del mínimo añadidos`);
    });
    m.el.querySelector('#save')?.addEventListener('click', async () => { try { await persist(); toast('Guardado'); m.close(); route(); } catch (e) { toast(e.message, 'error'); } });
    m.el.querySelector('#send')?.addEventListener('click', async () => { try { await persist('pedido'); toast('Marcado como pedido'); m.close(); route(); } catch (e) { toast(e.message, 'error'); } });
    m.el.querySelector('#cancel')?.addEventListener('click', async () => { if (await confirmBox('¿Anular este pedido?', { ok: 'Anular', danger: true })) { await api('/purchases/' + id, { method: 'PUT', body: { status: 'anulado' } }); m.close(); route(); } });
    m.el.querySelector('#print')?.addEventListener('click', () => printPurchase(p, items));
    m.el.querySelector('#recv')?.addEventListener('click', async () => { try { await persist(); m.close(); receiveModal(await api('/purchases/' + id)); } catch (e) { toast(e.message, 'error'); } });
    draw();
  }

  function receiveModal(p) {
    const m = modal(`<div class="modal-head"><h2>Recepción · pedido C-${p.id}</h2><button class="x" data-close>×</button></div>
      <div class="modal-body"><div class="notice">Comprueba cantidades y precios con el albarán. <b>Pollo: debe llegar entre 0 y 4 °C y pesar 1,2–1,4 kg (calibre 13).</b> Si no cumple, rechaza esa línea (recibido 0).</div>
      <table class="tbl recipe"><thead><tr><th>Artículo</th><th>Pedido</th><th>Recibido</th><th>Precio ud. albarán</th><th>Tª / estado OK</th></tr></thead>
      <tbody>${p.lines.map((l) => `<tr data-id="${l.id}"><td><b>${esc(l.item_name)}</b></td><td>${num(l.qty)} ${esc(l.unit)}</td><td class="qty"><input data-f="received_qty" type="number" step="any" value="${l.qty}"></td>
        <td class="qty"><input data-f="unit_cost" type="number" step="0.0001" value="${l.unit_cost}"></td><td><input data-f="temp_ok" type="checkbox" checked style="width:auto"></td></tr>`).join('')}</tbody></table>
      <div class="field" style="margin-top:12px"><label>Nº de factura / albarán</label><input id="inv"></div></div>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-ok" id="ok">Confirmar recepción</button></div>`, { wide: true });
    m.el.querySelector('#ok').onclick = async () => {
      const lines = [...m.el.querySelectorAll('tr[data-id]')].map((tr) => ({ id: Number(tr.dataset.id), received_qty: Number(tr.querySelector('[data-f=received_qty]').value), unit_cost: Number(tr.querySelector('[data-f=unit_cost]').value), temp_ok: tr.querySelector('[data-f=temp_ok]').checked }));
      try { await api(`/purchases/${p.id}/receive`, { body: { lines, invoice_ref: m.el.querySelector('#inv').value } }); toast('Mercancía recibida. Stock y costes actualizados.'); m.close(); route(); }
      catch (e) { toast(e.message, 'error'); }
    };
  }

  function printPurchase(p, items) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Pedido C-${p.id}</title><style>body{font:14px system-ui;margin:30px;color:#2B1A12}h1{color:#E2401B;margin:0}table{width:100%;border-collapse:collapse;margin-top:20px}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}.r{text-align:right}</style></head><body>
      <h1>popolló</h1><p><b>PEDIDO DE COMPRA C-${p.id}</b> · ${dateEs(p.created_at)}</p>
      <p>Proveedor: <b>${esc(p.supplier_name || '')}</b> ${esc(p.supplier_email || '')} ${esc(p.supplier_phone || '')}<br>Entregar en: <b>${esc(p.store_name || '')}</b> ${esc(p.store_address || '')}<br>${p.expected_at ? 'Fecha de entrega: ' + dateEs(p.expected_at) : ''}</p>
      <table><thead><tr><th>Artículo</th><th class="r">Cantidad</th><th class="r">Precio</th><th class="r">Importe</th></tr></thead><tbody>
      ${p.lines.map((l) => `<tr><td>${esc(l.item_name || items.find((i) => i.id === l.item_id)?.name)}</td><td class="r">${num(l.qty)} ${esc(l.unit || '')}</td><td class="r">${eur(l.unit_cost)}</td><td class="r">${eur(l.qty * l.unit_cost)}</td></tr>`).join('')}
      </tbody><tfoot><tr><th colspan="3">Total sin IVA</th><th class="r">${eur(p.total)}</th></tr></tfoot></table>${p.notes ? `<p>Notas: ${esc(p.notes)}</p>` : ''}
      <p style="margin-top:30px;font-size:12px">Recepción: pollo entre 0 y 4 °C, calibre 13 (1,2–1,4 kg). Packaging sin plásticos cerrados.</p></body></html>`;
    printHtml(html);
  }

  // -------------------------------------------------------------------- stock
  async function stock() {
    const ct = layout('Stock e inventario', '', { storeRequired: true });
    let tab = S.cache.stockTab || 'stock';
    const sid = Number(S.store);
    const draw = async () => {
      S.cache.stockTab = tab;
      const tabs = `<div class="tabs">${[['stock', 'Existencias'], ['count', 'Recuento de inventario'], ['moves', 'Movimientos'], ['cons', 'Consumo teórico y mermas']].map(([k, l]) => `<button data-k="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
      if (tab === 'stock' || tab === 'count') {
        const rows = await api('/stock?store_id=' + sid);
        const value = rows.reduce((a, r) => a + r.value, 0), low = rows.filter((r) => r.qty < r.min_qty);
        ct.innerHTML = tabs + `<div class="kpis"><div class="kpi"><div class="l">Valor del stock</div><div class="v">${eur(value)}</div></div><div class="kpi" style="--c:${low.length ? '#C62828' : 'var(--green)'}"><div class="l">Bajo mínimo</div><div class="v">${low.length}</div><div class="s">artículos a reponer</div></div></div>
          ${tab === 'count' ? '<div class="notice">Escribe solo lo que has contado. Al guardar, el sistema ajusta el stock y registra la diferencia (desviación de inventario).</div>' : ''}
          <div class="tools">${tab === 'count' ? '<button class="btn btn-ok" id="savecount">Guardar recuento</button>' : '<button class="btn btn-sm btn-ghost" id="trf">⇄ Traspaso entre locales</button><button class="btn btn-sm btn-ghost" id="wst">🗑 Registrar merma de artículo</button>'}</div>
          <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Artículo</th><th>Tipo</th><th>Proveedor</th><th class="r">Stock</th><th class="r">Mínimo</th><th class="r">Coste ud.</th><th class="r">Valor</th>${tab === 'count' ? '<th>Contado</th>' : '<th>Estado</th>'}</tr></thead>
          <tbody>${rows.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td>${KIND[r.kind]}</td><td class="muted">${esc(r.supplier || '')}</td><td class="r">${num(r.qty, 3)} ${esc(r.unit)}</td><td class="r">${num(r.min_qty)}</td><td class="r">${eur(r.unit_cost)}</td><td class="r">${eur(r.value)}</td>
            ${tab === 'count' ? `<td><input class="input" data-item="${r.id}" type="number" step="any" style="width:110px"></td>` : `<td>${r.qty < 0 ? '<span class="bad">Negativo: revisar</span>' : r.qty < r.min_qty ? '<span class="warn">Reponer</span>' : '<span class="good">OK</span>'}</td>`}</tr>`).join('')}</tbody></table></div></div>`;
        ct.querySelector('#savecount')?.addEventListener('click', async () => {
          const counts = [...ct.querySelectorAll('[data-item]')].filter((i) => i.value !== '').map((i) => ({ item_id: Number(i.dataset.item), qty: Number(i.value) }));
          if (!counts.length) return toast('No has escrito ningún recuento', 'error');
          try { await api('/stock/count', { body: { store_id: sid, counts } }); toast('Inventario actualizado'); tab = 'stock'; draw(); } catch (e) { toast(e.message, 'error'); }
        });
        ct.querySelector('#trf')?.addEventListener('click', () => formModal('Traspaso entre locales', [
          { k: 'item_id', label: 'Artículo', type: 'select', options: rows.map((r) => [r.id, r.name + ' (' + r.unit + ')']), full: true },
          { k: 'to_store_id', label: 'Enviar a', type: 'select', options: S.stores.filter((s) => s.active && s.id !== sid).map((s) => [s.id, s.code + ' · ' + s.name]) },
          { k: 'qty', label: 'Cantidad', type: 'number', required: true }, { k: 'note', label: 'Nota', full: true }], {},
        async (fd) => { await api('/stock/transfer', { body: { ...fd, from_store_id: sid, item_id: Number(fd.item_id), to_store_id: Number(fd.to_store_id) } }); toast('Traspaso hecho'); draw(); }));
        ct.querySelector('#wst')?.addEventListener('click', () => formModal('Merma de artículo', [
          { k: 'item_id', label: 'Artículo', type: 'select', options: rows.map((r) => [r.id, r.name + ' (' + r.unit + ')']), full: true },
          { k: 'qty', label: 'Cantidad', type: 'number', required: true }, { k: 'note', label: 'Motivo', placeholder: 'Caducado, roto, temperatura…' }], {},
        async (fd) => { await api('/waste', { body: { store_id: sid, item_id: Number(fd.item_id), qty: fd.qty, note: fd.note } }); toast('Merma registrada'); draw(); }));
      } else if (tab === 'moves') {
        const rows = await api(`/stock/moves?from=${S.from}&to=${S.to}&store_id=${sid}`);
        ct.innerHTML = tabs + rangeInline() + `<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Artículo</th><th>Tipo</th><th class="r">Cantidad</th><th class="r">Coste</th><th>Ref.</th><th>Usuario</th><th>Nota</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${dateEs(r.created_at)}</td><td>${esc(r.item_name)}</td><td>${esc(r.type)}</td><td class="r ${r.qty < 0 ? 'bad' : 'good'}">${num(r.qty, 3)} ${esc(r.unit)}</td><td class="r">${eur(Math.abs(r.qty) * (r.unit_cost || 0))}</td><td>${esc(r.ref || '')}</td><td>${esc(r.user_name || '')}</td><td class="muted">${esc(r.note || '')}</td></tr>`).join('') || '<tr><td colspan="8" class="empty-state">Sin movimientos</td></tr>'}</tbody></table></div></div>`;
        bindRangeInline(draw);
      } else {
        const rows = await api(`/stock/consumption?from=${S.from}&to=${S.to}&store_id=${sid}`);
        ct.innerHTML = tabs + rangeInline() + `<div class="notice">Consumo teórico = lo que deberían haber gastado las ventas según los escandallos. Compáralo con las compras y con las desviaciones de inventario para detectar mermas no registradas.</div>
          <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Artículo</th><th class="r">Consumo por ventas</th><th class="r">Mermas</th><th class="r">Compras</th><th class="r">Ajustes inventario</th><th class="r">Coste consumido</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="r">${num(r.sold, 3)} ${esc(r.unit)}</td><td class="r">${num(r.waste, 3)}</td><td class="r">${num(r.bought, 3)}</td><td class="r ${r.adjust < 0 ? 'bad' : ''}">${num(r.adjust, 3)}</td><td class="r">${eur(r.cost)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">Sin datos</td></tr>'}</tbody></table></div></div>`;
        bindRangeInline(draw);
      }
      ct.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => { tab = b.dataset.k; draw(); });
    };
    draw();
  }
  const rangeInline = () => `<div class="tools">Desde <input type="date" class="input" id="ri-f" value="${S.from}" style="width:auto"> hasta <input type="date" class="input" id="ri-t" value="${S.to}" style="width:auto"></div>`;
  const bindRangeInline = (cb) => { const f = document.getElementById('ri-f'), t = document.getElementById('ri-t'); f.onchange = t.onchange = () => { S.from = f.value; S.to = t.value; S.range = 'custom'; cb(); }; };

  // ------------------------------------------------------------------ locales
  async function locales() {
    const ct = layout('Locales de la red', '<button class="btn btn-sm btn-primary" id="new">+ Nuevo local</button>', { store: false });
    const [stores, st] = await Promise.all([api('/admin/stores'), settingsCached()]);
    S.stores = stores;
    const max = Number(st.max_stores || 20);
    const active = stores.filter((s) => s.active);
    const fields = [
      { k: 'code', label: 'Código (serie de tickets)', required: true, placeholder: 'AV03' }, { k: 'name', label: 'Nombre', required: true },
      { k: 'address', label: 'Dirección' }, { k: 'city', label: 'Ciudad' }, { k: 'phone', label: 'Teléfono' },
      { k: 'legal_name', label: 'Sociedad que factura (vacío = la de Ajustes)', placeholder: 'POPOLLO Avilés S.L.' }, { k: 'nif', label: 'NIF de esa sociedad', placeholder: 'B12345674' },
      { k: 'format', label: 'Formato', type: 'select', options: [['Pequeño 30 m²', 'Pequeño 30 m² (50.000 €)'], ['Estándar 40 m²', 'Estándar 40 m² (60.000 €)'], ['Grande 50 m²', 'Grande 50 m² (72.000 €)']] },
      { k: 'status', label: 'Estado', type: 'select', options: Object.entries(STATUS_STORE) }, { k: 'opened_at', label: 'Fecha de apertura', type: 'date' },
      { k: 'investment', label: 'Inversión (€)', type: 'number' }, { k: 'rent', label: 'Alquiler mensual (€)', type: 'number' },
      { k: 'staff_cost', label: 'Personal mensual (€)', type: 'number' }, { k: 'utilities', label: 'Suministros mensual (€)', type: 'number' },
      { k: 'other_fixed', label: 'Gestoría y mantenimiento (€)', type: 'number' }, { k: 'active', label: 'Activo en el sistema', type: 'checkbox', text: 'Activo' }];
    ct.innerHTML = `<div class="kpis"><div class="kpi"><div class="l">Locales en el sistema</div><div class="v">${active.length} / ${max}</div><div class="s">capacidad configurada</div></div>
      ${Object.entries(STATUS_STORE).map(([k, l]) => `<div class="kpi" style="--c:${{ proyecto: '#7A6656', obra: '#F29E0C', abierto: '#2E8B57', cerrado: '#C62828' }[k]}"><div class="l">${l}</div><div class="v">${active.filter((s) => s.status === k).length}</div></div>`).join('')}
      <div class="kpi" style="--c:var(--red)"><div class="l">Inversión comprometida</div><div class="v">${eur(active.reduce((a, s) => a + (s.investment || 0), 0))}</div></div></div>
      <div class="card"><table class="tbl"><thead><tr><th>Código</th><th>Local</th><th>Formato</th><th>Estado</th><th>Apertura</th><th class="r">Inversión</th><th class="r">Fijos / mes</th></tr></thead>
      <tbody>${stores.map((s) => `<tr class="click" data-id="${s.id}" style="${s.active ? '' : 'opacity:.45'}"><td><b>${esc(s.code)}</b></td><td>${esc(s.name)}<br><small class="muted">${esc(s.address || '')} ${esc(s.city || '')}</small></td><td>${esc(s.format || '')}</td>
        <td><span class="pill" style="background:${{ proyecto: '#7A6656', obra: '#F29E0C', abierto: '#2E8B57', cerrado: '#C62828' }[s.status]}">${STATUS_STORE[s.status]}</span></td><td>${dateEs(s.opened_at)}</td><td class="r">${eur(s.investment)}</td><td class="r">${eur(s.rent + s.staff_cost + s.utilities + s.other_fixed)}</td></tr>`).join('')}</tbody></table></div>`;
    const save = (s) => async (fd) => { if (s.id) await api('/admin/stores/' + s.id, { method: 'PUT', body: fd }); else await api('/admin/stores', { body: fd }); toast('Local guardado'); S.cache = {}; route(); };
    ct.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { const s = stores.find((x) => x.id === Number(tr.dataset.id)); formModal(s.name, fields, s, save(s), { wide: true }); });
    document.getElementById('new').onclick = () => formModal('Nuevo local', fields, { format: 'Estándar 40 m²', status: 'proyecto', investment: 60000, rent: 1500, staff_cost: 5625, utilities: 500, other_fixed: 350, active: 1, code: 'L' + String(stores.length + 1).padStart(2, '0') }, save({}), { wide: true });
  }

  // --------------------------------------------------------------- proyección
  const e0 = (n) => num(Math.round(n), 0) + ' €';
  const SCEN = { equilibrio: ['Punto de equilibrio', 15694.51], media: ['Previsión media', 19452.38], alta: ['Previsión alta', 24571.43] };
  async function proyeccion() {
    const ct = layout('Proyección de la red · hasta 20 locales', '<button class="btn btn-sm btn-ghost no-print" onclick="window.print()">🖨 Imprimir</button>', { store: false });
    const st = await settingsCached();
    const P = Object.assign({
      target: 20, already: 1, pace: 2, every: 1, horizon: 60, scenario: 'media', sales: SCEN.media[1], growth: 3,
      ramp1: 60, ramp2: 80, ramp3: 90, fc: 37.1, comm: 9.1, fee: Number(st.management_fee_pct || 3), fixed: 7975, invest: 60000,
      s1: Number(st.investor_share_stage1 || 70), s2: Number(st.investor_share_stage2 || 40), start: today().slice(0, 7)
    }, LS.get('adm.proj', {}));
    const real = await api('/reports/monthly?months=12').catch(() => []);
    const inp = (k, l, step = 'any', help = '') => `<div class="field"><label>${l}</label><input class="pj" data-k="${k}" type="${k === 'start' ? 'month' : 'number'}" step="${step}" value="${P[k]}">${help ? `<small class="muted">${help}</small>` : ''}</div>`;
    ct.innerHTML = `<div class="notice">Modelo basado en el dossier de operaciones (nov. 2026): ventas sin IVA, coste de producto 37,1 %, comisiones de reparto 9,1 % de las ventas, cuota de gestión 3 %, gastos fijos 7.975 €/mes y 60.000 € por local. Reparto con el inversor: ${P.s1} % hasta recuperar la inversión de cada local y ${P.s2} % después. Todo es editable.</div>
      <div class="card"><h3>Supuestos</h3>
        <div class="tabs">${Object.entries(SCEN).map(([k, [l, v]]) => `<button data-s="${k}" class="${P.scenario === k ? 'on' : ''}">${l} · ${eur(v)}/mes</button>`).join('')}</div>
        <div class="grid3" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
          ${inp('target', 'Locales objetivo', 1)}${inp('already', 'Locales ya abiertos al inicio', 1)}${inp('pace', 'Aperturas por tanda', 1)}${inp('every', 'Cada cuántos meses', 1)}${inp('start', 'Mes de inicio')}${inp('horizon', 'Meses a proyectar', 1)}
          ${inp('sales', 'Ventas/mes por local a régimen (sin IVA)', 1)}${inp('growth', 'Crecimiento anual de ventas %', 0.5)}${inp('ramp1', 'Arranque mes 1 (% de ventas)', 1)}${inp('ramp2', 'Mes 2 (%)', 1)}${inp('ramp3', 'Mes 3 (%)', 1)}
          ${inp('fc', 'Coste de producto %', 0.1)}${inp('comm', 'Comisiones reparto % s/ventas', 0.1)}${inp('fee', 'Cuota de gestión %', 0.1)}${inp('fixed', 'Gastos fijos por local/mes', 1)}${inp('invest', 'Inversión por local', 100)}
          ${inp('s1', 'Inversor etapa 1 %', 1)}${inp('s2', 'Inversor etapa 2 %', 1)}
        </div></div>
      <div id="pout"></div>`;
    const out = ct.querySelector('#pout');
    const calc = () => {
      const months = [];
      const locs = [];
      const [y0, m0] = P.start.split('-').map(Number);
      let opened = 0;
      for (let i = 0; i < Math.min(P.already, P.target); i++) { locs.push({ open: -12, invested: P.invest, paid: 0, cum: 0 }); opened++; }
      let cumNet = -opened * P.invest, cumInv = opened * P.invest, payback = null, cumInvestor = 0, cumFounders = 0, cumFee = 0;
      const startCash = cumNet;
      for (let mth = 0; mth < P.horizon; mth++) {
        if (opened < P.target && mth % Math.max(1, P.every) === 0) {
          const n = Math.min(P.pace, P.target - opened);
          for (let k = 0; k < n; k++) { locs.push({ open: mth, invested: P.invest, paid: 0, cum: 0 }); opened++; cumInv += P.invest; cumNet -= P.invest; }
        }
        let sales = 0, profit = 0, inv = 0, fnd = 0, fee = 0, active = 0;
        for (const l of locs) {
          const age = mth - l.open; if (age < 0) continue; active++;
          const ramp = age === 0 ? P.ramp1 / 100 : age === 1 ? P.ramp2 / 100 : age === 2 ? P.ramp3 / 100 : 1;
          const s = P.sales * ramp * Math.pow(1 + P.growth / 100, Math.floor(Math.max(age, 0) / 12));
          const f = s * P.fee / 100;
          const pr = s * (1 - P.fc / 100 - P.comm / 100) - f - P.fixed;
          sales += s; profit += pr; fee += f;
          if (pr > 0) {
            const share = l.paid < l.invested ? P.s1 / 100 : P.s2 / 100;
            const toInv = pr * share; l.paid += toInv; inv += toInv; fnd += pr - toInv;
          }
          l.cum += pr;
        }
        cumNet += profit; cumInvestor += inv; cumFounders += fnd; cumFee += fee;
        if (payback == null && cumNet >= 0 && mth > 0) payback = mth + 1;
        const d = new Date(y0, m0 - 1 + mth, 1);
        months.push({ i: mth, label: d.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }), year: d.getFullYear(), active, sales, profit, inv, fnd, fee, cumNet, cumInv });
      }
      return { months, payback, cumInv, cumInvestor, cumFounders, cumFee, startCash, locs };
    };
    const draw = () => {
      LS.set('adm.proj', P);
      const r = calc();
      const full = r.months.find((m) => m.active >= P.target);
      const steady = P.sales * (1 - P.fc / 100 - P.comm / 100) - P.sales * P.fee / 100 - P.fixed;
      const perLocPayback = steady > 0 ? P.invest / (steady * P.s1 / 100) : null;
      const byYear = {};
      for (const m of r.months) { const y = byYear[m.year] ||= { year: m.year, sales: 0, profit: 0, inv: 0, fnd: 0, fee: 0, active: 0 }; y.sales += m.sales; y.profit += m.profit; y.inv += m.inv; y.fnd += m.fnd; y.fee += m.fee; y.active = m.active; }
      const W = 760, H = 240, pad = { l: 70, r: 10, t: 14, b: 26 };
      const minV = Math.min(0, ...r.months.map((m) => m.cumNet)), maxV = Math.max(1, ...r.months.map((m) => m.cumNet));
      const x = (i) => pad.l + (W - pad.l - pad.r) * i / Math.max(1, r.months.length - 1);
      const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - minV) / (maxV - minV || 1));
      const maxA = P.target || 1;
      let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Caja acumulada de la red">`;
      for (let i = 0; i <= 4; i++) { const v = minV + (maxV - minV) * i / 4; svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#EADFC8"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${num(v / 1000, 0)} k€</text>`; }
      r.months.forEach((m, i) => { const bh = (H - pad.t - pad.b) * m.active / maxA * 0.35; svg += `<rect x="${x(i) - 3}" y="${H - pad.b - bh}" width="6" height="${bh}" fill="#FFC93C" opacity=".9"><title>${m.label}: ${m.active} locales</title></rect>`; });
      svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}" stroke="#2B1A12" stroke-dasharray="4 4"/>`;
      svg += `<polyline fill="none" stroke="#E2401B" stroke-width="3" points="${r.months.map((m, i) => `${x(i)},${y(m.cumNet)}`).join(' ')}"/>`;
      r.months.forEach((m, i) => { if (i % Math.ceil(r.months.length / 10) === 0) svg += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${m.label}</text>`; });
      svg += '</svg>';
      const realRows = {}; for (const rr of real) (realRows[rr.code] ||= []).push(rr);
      out.innerHTML = `<div class="kpis">
          <div class="kpi" style="--c:var(--red)"><div class="l">Inversión total</div><div class="v">${e0(r.cumInv)}</div><div class="s">${P.target} locales × ${eur(P.invest)}</div></div>
          <div class="kpi" style="--c:var(--yellow)"><div class="l">Red completa en</div><div class="v">${full ? full.label : '—'}</div><div class="s">${full ? 'mes ' + (full.i + 1) : 'amplía el horizonte'}</div></div>
          <div class="kpi" style="--c:var(--green)"><div class="l">Beneficio/mes por local a régimen</div><div class="v">${eur(steady)}</div><div class="s">Red de ${P.target}: ${e0(steady * P.target)}/mes</div></div>
          <div class="kpi" style="--c:var(--brown)"><div class="l">Recuperación de la red</div><div class="v">${r.payback ? 'mes ' + r.payback : '> ' + P.horizon + ' m'}</div><div class="s">Por local (inversor ${P.s1} %): ${perLocPayback ? num(perLocPayback, 1) + ' meses' : '—'}</div></div>
          <div class="kpi" style="--c:var(--orange)"><div class="l">Cuota de gestión (central)</div><div class="v">${e0(r.cumFee)}</div><div class="s">${eur(P.sales * P.fee / 100 * P.target)}/mes con la red completa</div></div>
          <div class="kpi" style="--c:#1E6FD9"><div class="l">Cobrado inversor / fundadores</div><div class="v" style="font-size:20px">${e0(r.cumInvestor)}</div><div class="s">Fundadores: ${e0(r.cumFounders)}</div></div></div>
        <div class="card"><h3>Caja acumulada de la red (beneficio − inversión)</h3><p class="sub">Línea roja: posición acumulada. Barras amarillas: locales abiertos.</p>${svg}</div>
        <div class="card"><h3>Resumen por año</h3><table class="tbl"><thead><tr><th>Año</th><th class="r">Locales a final de año</th><th class="r">Ventas sin IVA</th><th class="r">Beneficio antes de impuestos</th><th class="r">Cuota gestión</th><th class="r">Para el inversor</th><th class="r">Para fundadores</th></tr></thead>
          <tbody>${Object.values(byYear).map((y) => `<tr><td><b>${y.year}</b></td><td class="r">${y.active}</td><td class="r">${eur(y.sales)}</td><td class="r ${y.profit >= 0 ? 'good' : 'bad'}">${eur(y.profit)}</td><td class="r">${eur(y.fee)}</td><td class="r">${eur(y.inv)}</td><td class="r">${eur(y.fnd)}</td></tr>`).join('')}</tbody></table></div>
        <div class="card"><h3>Real frente a previsión (últimos 12 meses, sin IVA)</h3><p class="sub">Ventas reales registradas por el TPV comparadas con el escenario elegido (${eur(P.sales)}/mes por local).</p>
          ${Object.keys(realRows).length ? `<table class="tbl"><thead><tr><th>Local</th><th>Mes</th><th class="r">Ventas reales</th><th class="r">Previsión</th><th class="r">Desviación</th><th class="r">Coste producto real</th></tr></thead><tbody>
          ${Object.entries(realRows).flatMap(([code, rows]) => rows.map((rr) => `<tr><td>${esc(code)}</td><td>${esc(rr.month)}</td><td class="r">${eur(rr.base)}</td><td class="r">${eur(P.sales)}</td><td class="r ${rr.base >= P.sales ? 'good' : 'bad'}">${pct((rr.base / P.sales - 1) * 100)}</td><td class="r">${rr.base ? pct(rr.cost / rr.base * 100) : '—'}</td></tr>`)).join('')}</tbody></table>` : '<div class="empty-state">Todavía no hay ventas registradas</div>'}</div>
        <details class="card"><summary style="cursor:pointer;font-weight:800">Ver detalle mes a mes</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mes</th><th class="r">Locales</th><th class="r">Ventas</th><th class="r">Beneficio</th><th class="r">Inversor</th><th class="r">Fundadores</th><th class="r">Inversión acumulada</th><th class="r">Caja acumulada</th></tr></thead>
          <tbody>${r.months.map((m) => `<tr><td>${m.label}</td><td class="r">${m.active}</td><td class="r">${eur(m.sales)}</td><td class="r ${m.profit >= 0 ? 'good' : 'bad'}">${eur(m.profit)}</td><td class="r">${eur(m.inv)}</td><td class="r">${eur(m.fnd)}</td><td class="r">${eur(m.cumInv)}</td><td class="r ${m.cumNet >= 0 ? 'good' : 'bad'}">${eur(m.cumNet)}</td></tr>`).join('')}</tbody></table></div></details>`;
    };
    ct.querySelectorAll('.pj').forEach((i) => i.oninput = () => { P[i.dataset.k] = i.dataset.k === 'start' ? i.value : Number(i.value); if (i.dataset.k === 'sales') { P.scenario = 'custom'; ct.querySelectorAll('[data-s]').forEach((b) => b.classList.remove('on')); } draw(); });
    ct.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { P.scenario = b.dataset.s; P.sales = SCEN[b.dataset.s][1]; ct.querySelector('[data-k=sales]').value = P.sales; ct.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b)); draw(); });
    draw();
  }

  // ----------------------------------------------------------------- usuarios
  async function usuarios() {
    const ct = layout('Usuarios y permisos', '<button class="btn btn-sm btn-primary" id="new">+ Nuevo usuario</button>', { store: false });
    const users = await api('/admin/users');
    const ROLES = [['cajero', 'Cajero/a (solo TPV)'], ['encargado', 'Encargado/a (TPV + compras, stock e informes de su local)'], ['admin', 'Administración (todo)']];
    const fields = (isNew) => [{ k: 'name', label: 'Nombre', required: true }, { k: 'role', label: 'Rol', type: 'select', options: ROLES },
      { k: 'store_id', label: 'Local', type: 'select', options: [['', 'Todos los locales'], ...S.stores.map((s) => [s.id, s.code + ' · ' + s.name])] },
      { k: 'pin', label: isNew ? 'PIN (4 a 8 cifras)' : 'Nuevo PIN (vacío = no cambiar)', type: 'password', required: isNew }, { k: 'color', label: 'Color', type: 'color' }, { k: 'active', label: 'Estado', type: 'checkbox', text: 'Activo' }];
    ct.innerHTML = `<div class="notice">Los cajeros solo ven el TPV. Devoluciones, anulaciones, descuentos y salidas de dinero piden el PIN de un encargado.</div>
      <div class="card"><table class="tbl"><thead><tr><th>Usuario</th><th>Rol</th><th>Local</th><th>Estado</th></tr></thead><tbody>
      ${users.map((u) => `<tr class="click" data-id="${u.id}"><td><span class="swatch" style="background:${esc(u.color)}"></span><b>${esc(u.name)}</b></td><td>${esc(ROLES.find((r) => r[0] === u.role)?.[1] || u.role)}</td><td>${esc(S.stores.find((s) => s.id === u.store_id)?.name || 'Todos')}</td><td>${u.active ? '<span class="good">Activo</span>' : '<span class="bad">Baja</span>'}</td></tr>`).join('')}</tbody></table></div>`;
    const save = (u) => async (fd) => {
      if (fd.pin && !/^\d{4,8}$/.test(fd.pin)) throw new Error('El PIN debe tener entre 4 y 8 cifras');
      if (!fd.pin) delete fd.pin; fd.store_id = fd.store_id ? Number(fd.store_id) : null;
      if (u.id) await api('/admin/users/' + u.id, { method: 'PUT', body: fd }); else await api('/admin/users', { body: fd });
      toast('Usuario guardado'); route();
    };
    ct.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { const u = users.find((x) => x.id === Number(tr.dataset.id)); formModal(u.name, fields(false), u, save(u)); });
    document.getElementById('new').onclick = () => formModal('Nuevo usuario', fields(true), { role: 'cajero', color: '#E2401B', active: 1 }, save({}));
  }

  // ------------------------------------------------------------------ ajustes
  async function ajustes() {
    const ct = layout('Ajustes', '', { store: false });
    S.cache.settings = null;
    const st = await settingsCached();
    const fields = [
      ['company_name', 'Razón social'], ['company_nif', 'NIF'], ['company_address', 'Domicilio fiscal'], ['brand', 'Marca'],
      ['ticket_footer', 'Pie del ticket'], ['default_vat', 'IVA por defecto (%)'], ['delivery_surcharge_pct', 'Recargo precios plataformas (%)'], ['home_delivery_fee', 'Gastos de envío reparto propio (€)'],
      ['commission_glovo', 'Comisión Glovo (%)'], ['commission_ubereats', 'Comisión Uber Eats (%)'], ['commission_justeat', 'Comisión Just Eat (%)'], ['management_fee_pct', 'Cuota de gestión central (%)'],
      ['investor_share_stage1', 'Inversor etapa 1 (%)'], ['investor_share_stage2', 'Inversor etapa 2 (%)'], ['max_stores', 'Máximo de locales'],
      ['cost_update_mode', 'Actualizar coste al recibir compras']
    ];
    ct.innerHTML = `<div class="cols"><div class="card"><h3>Empresa y parámetros</h3><form id="sf"><div class="grid2">${fields.map(([k, l]) => `<div class="field"><label>${l}</label>${k === 'cost_update_mode'
      ? `<select name="${k}"><option value="ultimo" ${st[k] === 'ultimo' ? 'selected' : ''}>Último precio de compra</option><option value="medio" ${st[k] === 'medio' ? 'selected' : ''}>Precio medio ponderado</option></select>`
      : `<input name="${k}" value="${esc(st[k] ?? '')}">`}</div>`).join('')}</div><button class="btn btn-primary">Guardar ajustes</button></form></div>
      <div><div class="card"><h3>Facturación VERI*FACTU</h3><p class="sub">Envío a la AEAT, certificado, registros y declaración responsable.</p><a class="btn btn-dark" href="#verifactu">Abrir VeriFactu</a></div>
        <div class="card"><h3>Copias de seguridad</h3><p class="sub">El servidor guarda una copia automática cada día (las últimas 30) en su carpeta de datos, subcarpeta <code>copias</code>. Descarga además una copia de vez en cuando y guárdala fuera del servidor.</p><button class="btn btn-dark" id="bk">Descargar copia ahora</button></div>
        <div class="card"><h3>Últimas acciones</h3><div class="tbl-wrap" style="max-height:300px" id="aud"></div></div></div></div>`;
    ct.querySelector('#bk').onclick = () => download('/admin/backup', 'popollo-copia-' + today() + '.db');
    ct.querySelector('#sf').onsubmit = async (e) => {
      e.preventDefault(); const body = {}; new FormData(e.target).forEach((v, k) => (body[k] = v));
      try { S.cache.settings = await api('/admin/settings', { method: 'PUT', body }); toast('Ajustes guardados'); } catch (er) { toast(er.message, 'error'); }
    };
    if (S.user.role === 'admin') {
      const a = await api('/admin/audit');
      ct.querySelector('#aud').innerHTML = `<table class="tbl"><tbody>${a.slice(0, 100).map((x) => `<tr><td>${dateEs(x.created_at)}</td><td>${esc(x.user_name || '')}</td><td>${esc(x.action)}</td><td class="muted" style="font-size:12px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.detail || '')}</td></tr>`).join('')}</tbody></table>`;
    }
  }

  // ---------------------------------------------------------------- VeriFactu
  const VF_MODE = {
    desactivado: ['Desactivado', '#7A6656', 'Se generan y encadenan los registros, pero no se envían ni se imprime el QR.'],
    simulador: ['Simulador local', '#1E6FD9', 'Envía a un simulador dentro del propio servidor. Sirve para probar el circuito sin certificado. Sin validez fiscal.'],
    pruebas: ['Pruebas AEAT', '#F29E0C', 'Envía al entorno de pruebas (preproducción) de la AEAT con tu certificado. Sin validez fiscal.'],
    produccion: ['Producción AEAT', '#2E8B57', 'Envío real a la AEAT. Cada ticket queda registrado en Hacienda.']
  };
  const VF_STATUS = { pendiente: ['Pendiente', '#F29E0C'], enviando: ['Enviando', '#1E6FD9'], correcto: ['Correcto', '#2E8B57'], aceptado_errores: ['Aceptado con errores', '#C77700'], incorrecto: ['Rechazado', '#C62828'] };

  async function verifactu() {
    const ct = layout('VeriFactu · facturación verificable', '<button class="btn btn-sm btn-ghost" id="decl">📄 Declaración responsable</button><button class="btn btn-sm btn-primary" id="sendnow">↑ Enviar pendientes</button>', { store: false });
    S.cache.settings = null;
    const [stt, st, chains, envios] = await Promise.all([api('/verifactu/status'), settingsCached(), api('/verifactu/chains'), api('/verifactu/envios')]);
    const [ml, mc, md] = VF_MODE[stt.mode] || VF_MODE.desactivado;
    const c = stt.counts;
    const checks = [
      [!!st.company_nif && !stt.nifs.some((n) => !n.valid), 'NIF real de la empresa (Ajustes) y, si cada local es una sociedad, su NIF en Locales'],
      [!!st.sif_producer_nif, 'Datos del productor del sistema (abajo) para la declaración responsable'],
      [!!st.sif_declaration_date, 'Declaración responsable firmada (fecha indicada abajo)'],
      [stt.cert.ok && stt.mode !== 'simulador', 'Certificado electrónico de la empresa instalado en el servidor'],
      [envios.some((e) => e.env === 'pruebas' && e.estado === 'Correcto'), 'Envío correcto en el entorno de pruebas de la AEAT'],
      [stt.mode === 'produccion', 'Modo producción activado (empezando con la base de datos limpia)']
    ];
    ct.innerHTML = `
      <div class="kpis">
        <div class="kpi" style="--c:${mc}"><div class="l">Modo</div><div class="v">${ml}</div><div class="s">${esc(md)}</div></div>
        <div class="kpi" style="--c:#2E8B57"><div class="l">Registros aceptados</div><div class="v">${num((c.correcto || 0) + (c.aceptado_errores || 0))}</div><div class="s">${num(c.aceptado_errores || 0)} con avisos</div></div>
        <div class="kpi" style="--c:#F29E0C"><div class="l">Pendientes de envío</div><div class="v">${num((c.pendiente || 0) + (c.enviando || 0))}</div><div class="s">${stt.next.map((n) => `${esc(n.nif)}: próximo envío en ${n.seconds} s`).join(' · ') || 'Se envían solos cada pocos segundos'}</div></div>
        <div class="kpi" style="--c:#C62828"><div class="l">Rechazados</div><div class="v">${num(c.incorrecto || 0)}</div><div class="s">revisar y reenviar</div></div>
      </div>
      <div class="cols">
        <div class="card"><h3>Puesta en marcha</h3><p class="sub">Obligatorio para sociedades desde el 1 de enero de 2027 (RD 1007/2023 y Orden HAC/1177/2024).</p>
          ${checks.map(([ok, t]) => `<div class="kv" style="display:flex;gap:10px;padding:7px 0;border-bottom:1px dashed var(--line)"><span class="${ok ? 'good' : 'bad'}">${ok ? '✓' : '○'}</span><span>${t}</span></div>`).join('')}
          <div class="field" style="margin-top:14px"><label>Modo de envío</label><select id="vf-mode">${Object.entries(VF_MODE).map(([k, [l]]) => `<option value="${k}" ${stt.mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label>Tipo de certificado</label><select id="vf-cert"><option value="personal" ${st.verifactu_cert_type !== 'sello' ? 'selected' : ''}>Certificado de representante / persona jurídica</option><option value="sello" ${st.verifactu_cert_type === 'sello' ? 'selected' : ''}>Certificado de sello electrónico</option></select></div>
          <div class="notice ${stt.cert.ok ? '' : 'red'}">${stt.cert.ok ? '🔐 ' : '⚠️ '}${esc(stt.cert.message)}${stt.endpoint ? `<br><small>Servicio: ${esc(stt.endpoint)}</small>` : ''}</div>
          <button class="btn btn-primary" id="vf-save">Guardar modo</button></div>
        <div class="card"><h3>Integridad de la cadena</h3><p class="sub">Se recalcula la huella de cada registro con la fórmula oficial de la AEAT. Si alguien modifica un registro, aparece aquí.</p>
          ${chains.map((ch) => `<div class="kv" style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed var(--line)"><span><b>${esc(ch.nif || '(sin NIF)')}</b> · ${num(ch.records)} registros</span>${ch.ok ? '<span class="good">✓ Cadena íntegra</span>' : `<span class="bad">✗ ${ch.errors.length} alterados: ${esc(ch.errors.slice(0, 3).join(', '))}</span>`}</div>`).join('') || '<div class="empty-state">Aún no hay registros. Se crean al cobrar cada ticket.</div>'}
          <h3 style="margin-top:20px">Últimos envíos</h3>
          <div class="tbl-wrap" style="max-height:260px"><table class="tbl"><thead><tr><th>Fecha</th><th>NIF</th><th>Entorno</th><th class="r">Reg.</th><th>Estado</th><th>CSV</th></tr></thead><tbody>
          ${envios.map((e) => `<tr><td>${dateEs(e.sent_at)}</td><td>${esc(e.nif)}</td><td>${esc(e.env)}</td><td class="r">${e.n_records}</td><td class="${e.estado === 'Correcto' ? 'good' : e.estado === 'Error' || e.estado === 'Incorrecto' ? 'bad' : 'warn'}" title="${esc(e.error || '')}">${esc(e.estado)}${e.error ? ' ⓘ' : ''}</td><td style="font-size:12px">${esc(e.csv || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">Sin envíos</td></tr>'}</tbody></table></div></div>
      </div>
      <div class="card"><h3>Registros de facturación</h3>
        <div class="tools"><select class="input" id="vf-st" style="width:auto"><option value="">Todos</option>${Object.entries(VF_STATUS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select><input class="input" id="vf-q" placeholder="Nº de factura" style="width:220px"></div>
        <div class="tbl-wrap" id="vf-recs"></div></div>
      <div class="card"><h3>Sistema informático y productor</h3><p class="sub">Datos que viajan en cada registro (bloque SistemaInformatico) y que aparecen en la declaración responsable.</p>
        <form id="vf-sif"><div class="grid3">${[['sif_name', 'Nombre del sistema'], ['sif_id', 'Código del sistema (2 caracteres)'], ['sif_version', 'Versión'], ['sif_installation', 'Número de instalación'],
          ['sif_producer_name', 'Productor (razón social)'], ['sif_producer_nif', 'NIF del productor'], ['sif_producer_address', 'Dirección postal del productor'], ['sif_declaration_place', 'Lugar de firma de la declaración'], ['sif_declaration_date', 'Fecha de firma (AAAA-MM-DD)']]
          .map(([k, l]) => `<div class="field"><label>${l}</label><input name="${k}" value="${esc(st[k] || '')}" ${k === 'sif_declaration_date' ? 'type="date"' : ''}></div>`).join('')}</div>
          <button class="btn btn-primary">Guardar datos del sistema</button></form></div>`;

    const drawRecs = async () => {
      const list = await api(`/verifactu/records?status=${ct.querySelector('#vf-st').value}&q=${encodeURIComponent(ct.querySelector('#vf-q').value)}`);
      ct.querySelector('#vf-recs').innerHTML = `<table class="tbl"><thead><tr><th>Factura</th><th>Tipo</th><th>Fecha</th><th>NIF</th><th class="r">Importe</th><th class="r">IVA</th><th>Huella</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>
        ${list.map((r) => `<tr class="click" data-id="${r.id}"><td><b>${esc(r.num_serie)}</b></td><td>${r.tipo_factura === 'R5' ? 'Rectificativa' : 'Simplificada'}</td><td>${esc(r.fecha_expedicion)}</td><td>${esc(r.nif)}</td>
          <td class="r">${eur(r.importe_total)}</td><td class="r">${eur(r.cuota_total)}</td><td style="font-family:monospace;font-size:11px">${esc(r.huella.slice(0, 16))}…</td>
          <td><span class="pill" style="background:${(VF_STATUS[r.status] || ['', '#777'])[1]}">${(VF_STATUS[r.status] || [r.status])[0]}</span>${r.env ? ` <small class="muted">${esc(r.env)}</small>` : ''}</td>
          <td class="muted" style="font-size:12px;max-width:280px">${esc([r.error_code, r.last_error].filter(Boolean).join(' · '))}</td></tr>`).join('') || '<tr><td colspan="9" class="empty-state">Sin registros</td></tr>'}</tbody></table>`;
      ct.querySelectorAll('#vf-recs tr[data-id]').forEach((tr) => tr.onclick = () => recordModal(Number(tr.dataset.id)));
    };
    ct.querySelector('#vf-st').onchange = drawRecs;
    let to; ct.querySelector('#vf-q').oninput = () => { clearTimeout(to); to = setTimeout(drawRecs, 300); };
    drawRecs();

    ct.querySelector('#vf-save').onclick = async () => {
      const mode = ct.querySelector('#vf-mode').value;
      if (mode === 'produccion' && !(await confirmBox('En producción cada ticket se comunica a la AEAT y no se puede deshacer. ¿Activar el envío real?', { ok: 'Activar producción', danger: true }))) return;
      try { await api('/admin/settings', { method: 'PUT', body: { verifactu_mode: mode, verifactu_cert_type: ct.querySelector('#vf-cert').value } }); toast('Modo guardado'); route(); }
      catch (e) { toast(e.message, 'error'); }
    };
    ct.querySelector('#vf-sif').onsubmit = async (e) => {
      e.preventDefault(); const body = {}; new FormData(e.target).forEach((v, k) => (body[k] = String(v).trim()));
      if (body.sif_id.length !== 2) return toast('El código del sistema debe tener 2 caracteres', 'error');
      try { await api('/admin/settings', { method: 'PUT', body }); toast('Datos guardados'); route(); } catch (er) { toast(er.message, 'error'); }
    };
    document.getElementById('sendnow').onclick = async () => {
      try { const r = await api('/verifactu/send', { body: {} }); toast(r.mode === 'desactivado' ? 'El envío está desactivado' : r.sent?.length ? r.sent.map((x) => `${x.nif}: ${x.ok ? x.estado + ' (' + x.n + ')' : x.error}`).join(' · ') : 'Nada que enviar ahora (o esperando el tiempo que marca la AEAT)'); route(); }
      catch (e) { toast(e.message, 'error'); }
    };
    document.getElementById('decl').onclick = () => declaracion(st);
  }

  async function recordModal(id) {
    const { xml, record: r } = await api(`/verifactu/records/${id}/xml`);
    const m = modal(`<div class="modal-head"><h2>Registro ${esc(r.num_serie)}</h2><button class="x" data-close>×</button></div>
      <div class="modal-body"><div class="grid2"><div><p>Estado: <b>${(VF_STATUS[r.status] || [r.status])[0]}</b> · intentos ${r.attempts}<br>Generado: ${esc(r.fecha_hora_huso)}<br>${r.sent_at ? 'Enviado: ' + dateEs(r.sent_at) : 'Sin enviar'}</p>
        ${r.last_error ? `<div class="notice red">${esc([r.error_code, r.last_error].filter(Boolean).join(' · '))}</div>` : ''}</div>
        <div><p style="font-size:12px;word-break:break-all">Huella: <b>${esc(r.huella)}</b><br>Anterior: ${esc(r.prev_huella || '(primer registro)')}</p></div></div>
        <pre style="background:#1d140e;color:#f6e7c8;padding:14px;border-radius:12px;font-size:11px;max-height:50vh;overflow:auto;white-space:pre-wrap">${esc(xml)}</pre></div>
      <div class="modal-foot">${['incorrecto', 'aceptado_errores'].includes(r.status) ? '<button class="btn btn-yellow" id="retry">Volver a enviar</button>' : ''}<button class="btn btn-ghost" id="copy">Copiar XML</button></div>`, { wide: true });
    m.el.querySelector('#copy').onclick = () => navigator.clipboard?.writeText(xml).then(() => toast('XML copiado'));
    m.el.querySelector('#retry')?.addEventListener('click', async () => { await api(`/verifactu/records/${id}/retry`, { body: {} }); toast('Marcado para reenviar'); m.close(); route(); });
  }

  function declaracion(st) {
    const d = st.sif_declaration_date ? dateEs(st.sif_declaration_date) : '____ de ____________ de ______';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Declaración responsable · ${esc(st.sif_name)}</title><style>
      body{font:14px/1.6 Georgia,serif;max-width:760px;margin:40px auto;color:#222;padding:0 20px} h1{font-size:20px;text-align:center} h2{font-size:15px;margin-top:22px}
      table{width:100%;border-collapse:collapse} td{border:1px solid #bbb;padding:6px 10px;vertical-align:top} td:first-child{width:42%;font-weight:bold;background:#f6f1e7}
      .firma{margin-top:50px} .draft{border:2px dashed #E2401B;padding:10px;color:#E2401B;font-family:system-ui;font-size:13px}</style></head><body>
      ${!st.sif_producer_nif || !st.sif_declaration_date ? '<p class="draft">BORRADOR: faltan datos del productor o la fecha de firma (Administración → VeriFactu). Revísalo con tu asesor antes de firmarlo.</p>' : ''}
      <h1>DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN</h1>
      <p>Conforme al artículo 13 del Reglamento aprobado por el Real Decreto 1007/2023, de 5 de diciembre, y al artículo 15 de la Orden HAC/1177/2024, de 17 de octubre.</p>
      <h2>1. Sistema informático</h2><table>
        <tr><td>Nombre del sistema informático</td><td>${esc(st.sif_name)}</td></tr>
        <tr><td>Código identificador del sistema</td><td>${esc(st.sif_id)}</td></tr>
        <tr><td>Versión</td><td>${esc(st.sif_version)}</td></tr>
        <tr><td>Componentes y funcionalidades</td><td>Aplicación web con servidor central (Node.js y base de datos SQLite integrada) y terminales de punto de venta en navegador o aplicación instalada (Windows, macOS, tabletas). Funciones: venta en mostrador, para llevar, a domicilio y plataformas de reparto; cobro; devoluciones mediante facturas rectificativas; cierres de caja; generación de registros de facturación de alta encadenados mediante huella SHA-256; remisión automática a la AEAT por servicio web; impresión de código QR y de la leyenda «VERI*FACTU» en las facturas.</td></tr>
        <tr><td>Uso exclusivo como VERI*FACTU</td><td>Sí. El sistema solo puede funcionar remitiendo los registros a la AEAT.</td></tr>
        <tr><td>Uso por varios obligados tributarios</td><td>Sí. Admite una sociedad emisora distinta por local, con cadena de registros independiente para cada NIF.</td></tr>
        <tr><td>Tipos de firma utilizados</td><td>No aplica (modalidad VERI*FACTU: la integridad se garantiza con la remisión a la AEAT y el encadenamiento por huella).</td></tr>
      </table>
      <h2>2. Productor del sistema</h2><table>
        <tr><td>Razón social</td><td>${esc(st.sif_producer_name)}</td></tr>
        <tr><td>NIF</td><td>${esc(st.sif_producer_nif || '________________')}</td></tr>
        <tr><td>Dirección postal completa de contacto</td><td>${esc(st.sif_producer_address || '________________________________________')}</td></tr>
      </table>
      <h2>3. Declaración</h2>
      <p>El productor arriba identificado declara, bajo su responsabilidad, que el sistema informático de facturación descrito, en la versión indicada, cumple con lo dispuesto en el artículo 29.2.j) de la Ley 58/2003, de 17 de diciembre, General Tributaria, en el Reglamento que establece los requisitos que deben adoptar los sistemas y programas informáticos o electrónicos que soporten los procesos de facturación de empresarios y profesionales, aprobado por el Real Decreto 1007/2023, de 5 de diciembre, y en la Orden HAC/1177/2024, de 17 de octubre, así como en el resto de normativa que los desarrolle.</p>
      <p class="firma">En ${esc(st.sif_declaration_place || '__________')}, a ${d}.</p>
      <p style="margin-top:60px">Firmado: ______________________________<br>En representación de ${esc(st.sif_producer_name)}</p>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) return printHtml(html);
    w.document.write(html); w.document.close();
  }

  boot();
})();
