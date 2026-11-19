// Utilidades compartidas por TPV y Administración
const POP = (() => {
  const LS = {
    get(k, d = null) { try { const v = localStorage.getItem('popollo.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('popollo.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem('popollo.' + k); } catch { /* */ } }
  };
  let token = null;
  const setToken = (t, key) => { token = t; if (key) { if (t) LS.set(key, t); else LS.del(key); } };

  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch { /* */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Error de conexión con el servidor');
      err.status = res.status; throw err;
    }
    return data;
  }

  const eur = (n, sign = false) => {
    const v = Number(n || 0);
    return (sign && v > 0 ? '+' : '') + v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  };
  const num = (n, d = 2) => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: d });
  const pct = (n) => num(n, 1) + ' %';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const daysAgo = (n) => { const d = new Date(Date.now() - n * 864e5); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const time = (s) => (s || '').slice(11, 16);
  const dateEs = (s) => { if (!s) return ''; const [y, m, d] = s.slice(0, 10).split('-'); return `${d}/${m}/${y}` + (s.length > 10 ? ' ' + s.slice(11, 16) : ''); };
  const parseNum = (v) => Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0;
  const parseInput = (v) => Number(String(v ?? '').replace(',', '.')) || 0;

  function toast(msg, type = 'ok') {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast toast-' + type; t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.classList.add('out'), type === 'error' ? 4200 : 2400);
    setTimeout(() => t.remove(), type === 'error' ? 4700 : 2900);
  }

  // Modal sencillo: devuelve {el, close}
  function modal(html, { wide = false, onClose, cls = '' } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-back';
    wrap.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''} ${cls}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(wrap);
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    const first = wrap.querySelector('input:not([type=hidden]),select,textarea');
    if (first && !first.hasAttribute('data-noautofocus')) setTimeout(() => first.focus(), 30);
    return { el: wrap.querySelector('.modal'), close };
  }

  function confirmBox(msg, { ok = 'Sí', cancel = 'Cancelar', danger = false } = {}) {
    return new Promise((resolve) => {
      const m = modal(`<div class="modal-body center"><p class="big-q">${esc(msg)}</p></div>
        <div class="modal-foot"><button class="btn btn-ghost" data-r="0">${esc(cancel)}</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-r="1">${esc(ok)}</button></div>`,
      { onClose: () => resolve(false) });
      m.el.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => { const r = b.dataset.r === '1'; resolve(r); m.close(); }));
    });
  }

  // Ticket térmico 80 mm
  function ticketHtml(o, st) {
    const lines = o.lines.map((l) => `<tr><td style="padding-right:6px">${num(Math.abs(l.qty), 2)}</td><td>${esc(l.name)}${l.notes ? `<br><small>${esc(l.notes)}</small>` : ''}</td><td class="r">${eur(l.total)}</td></tr>`).join('');
    const vat = (o.vat_breakdown || []).map((v) => `<tr><td>IVA ${num(v.vat)} %</td><td class="r">Base ${eur(v.base)}</td><td class="r">Cuota ${eur(v.cuota)}</td></tr>`).join('');
    const pays = (o.payments || []).map((p) => `<div class="row"><span>${esc(METHOD_LABEL[p.method] || p.method)}</span><span>${eur(p.given ?? p.amount)}</span></div>${p.change ? `<div class="row"><span>Cambio</span><span>${eur(p.change)}</span></div>` : ''}`).join('');
    const isRefund = o.type === 'devolucion';
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.full_number || 'Pedido')}</title><style>
      @page { size: 80mm auto; margin: 3mm; }
      body { font: 12px/1.35 ui-monospace, Menlo, Consolas, monospace; width: 74mm; margin: 0 auto; color:#000; }
      h1 { font: 800 20px/1 system-ui, sans-serif; text-align:center; margin: 4px 0; letter-spacing:.5px }
      .c { text-align:center } .r { text-align:right; white-space:nowrap } table { width:100%; border-collapse:collapse }
      td { vertical-align:top; padding:1px 0 } hr { border:0; border-top:1px dashed #000; margin:6px 0 }
      .row { display:flex; justify-content:space-between } .tot { font-size:17px; font-weight:800 } small{font-size:10px}
      .hash { font-size:8px; word-break:break-all }
      .qr { margin:6px 0 } .qr svg { width:35mm; height:35mm; display:block; margin:0 auto }
    </style></head><body>
      <h1>popolló</h1>
      <div class="c">${esc(o.issuer_name || st.company_name || '')} · NIF ${esc(o.issuer_nif || st.company_nif || '')}<br>${esc(o.store_name)}<br>${esc(o.store_address || '')} ${esc(o.store_city || '')}</div><hr>
      ${o.verifactu && typeof QR !== 'undefined' ? `<div class="c qr">${QR.svg(o.verifactu.qr_url)}<b>VERI*FACTU</b><br><small>Factura verificable en la sede electrónica de la AEAT</small>${o.verifactu.test ? '<br><small>** ENTORNO DE PRUEBAS · SIN VALIDEZ **</small>' : ''}</div><hr>` : ''}
      <div class="c"><b>${isRefund ? 'FACTURA RECTIFICATIVA SIMPLIFICADA (DEVOLUCIÓN)' : 'FACTURA SIMPLIFICADA'}</b></div>
      <div class="row"><span>Nº ${esc(o.full_number || 'PENDIENTE DE COBRO')}</span><span>${dateEs(o.paid_at || o.created_at)}</span></div>
      ${o.ref ? `<div>Rectifica a: ${esc(o.ref.full_number)}</div>` : ''}
      <div class="row"><span>${esc(CHANNEL_LABEL[o.channel] || o.channel)}</span><span>Atiende: ${esc(o.user_name || '')}</span></div>
      ${o.platform_ref ? `<div>Ref. plataforma: ${esc(o.platform_ref)}</div>` : ''}
      ${o.customer_name || o.customer_phone ? `<div>Cliente: ${esc(o.customer_name || '')} ${esc(o.customer_phone || '')}</div>` : ''}
      ${o.customer_address ? `<div>Entrega: ${esc(o.customer_address)}</div>` : ''}
      ${o.notes ? `<div>Nota: ${esc(o.notes)}</div>` : ''}
      <hr><table>${lines}</table><hr>
      ${o.discount_pct ? `<div class="row"><span>Descuento aplicado</span><span>${num(o.discount_pct)} %</span></div>` : ''}
      <div class="row tot"><span>TOTAL</span><span>${eur(o.total)}</span></div>
      <div class="c"><small>Precios con IVA incluido</small></div>
      <table style="margin-top:4px">${vat}</table><hr>${pays}
      ${o.status === 'pendiente' ? '<div class="c"><b>PENDIENTE DE COBRO</b></div>' : ''}
      <hr><div class="c">${esc(st.ticket_footer || '')}</div>
      ${o.hash ? `<div class="hash c">Huella: ${esc(o.hash.slice(0, 32))}</div>` : ''}
    </body></html>`;
  }
  function printHtml(html) {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
    setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { /* */ } setTimeout(() => f.remove(), 1500); }, 250);
  }

  const CHANNEL_LABEL = { local: 'Mostrador', llevar: 'Para llevar', domicilio: 'A domicilio', glovo: 'Glovo', ubereats: 'Uber Eats', justeat: 'Just Eat' };
  const CHANNEL_COLOR = { local: '#2B1A12', llevar: '#F29E0C', domicilio: '#E2401B', glovo: '#E8B100', ubereats: '#0E8A4F', justeat: '#F36D00' };
  const METHOD_LABEL = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', bizum: 'Bizum', plataforma: 'Pagado en plataforma' };
  const KITCHEN_LABEL = { nuevo: 'Nuevo', preparando: 'Preparando', listo: 'Listo', en_reparto: 'En reparto', entregado: 'Entregado' };

  return { LS, api, setToken, eur, num, pct, esc, today, daysAgo, time, dateEs, parseNum, parseInput, toast, modal, confirmBox, ticketHtml, printHtml, CHANNEL_LABEL, CHANNEL_COLOR, METHOD_LABEL, KITCHEN_LABEL };
})();
