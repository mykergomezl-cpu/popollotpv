// POPOLLO TPV · servidor central (sin dependencias externas)
// Arranque: npm start   (Node.js 22.5 o superior)
process.env.TZ = process.env.TZ || 'Europe/Madrid'; // la hora de los registros VeriFactu lleva huso horario
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { open, tx, hashPin, checkPin, DB_FILE, DATA_DIR, PRODUCTION } = require('./db');
const vf = require('./verifactu');

const db = open({ reset: process.argv.includes('--reset') });
db.exec(vf.SCHEMA);
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || PRODUCTION; // detrás de Hostinger/nginx la IP real llega en X-Forwarded-For
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 7);        // sesión caduca tras N días sin uso
const PUBLIC = path.join(__dirname, 'public');

// ---------------------------------------------------------------- utilidades
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const r4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
const round05 = (n) => Math.round(n * 20) / 20;
const now = () => {
  const d = new Date(); const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const q = (sql) => db.prepare(sql);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

function settings() {
  const o = {}; for (const r of all('SELECT key,value FROM settings')) o[r.key] = r.value; return o;
}
const DELIVERY_CHANNELS = ['domicilio', 'glovo', 'ubereats', 'justeat'];
const PLATFORM_CHANNELS = ['glovo', 'ubereats', 'justeat'];
const CHANNELS = ['local', 'llevar', 'domicilio', ...PLATFORM_CHANNELS];

// ------------------------------------------------------------- costes / escandallo
function makeCoster() {
  const items = new Map(all('SELECT * FROM items').map((i) => [i.id, i]));
  const lines = all('SELECT * FROM recipe_lines');
  const byParent = new Map();
  for (const l of lines) {
    const k = l.parent_type + ':' + l.parent_id;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(l);
  }
  const memoItem = new Map();
  function itemCost(id, depth = 0) {
    if (memoItem.has(id)) return memoItem.get(id);
    const it = items.get(id); if (!it) return 0;
    let c = it.cost || 0;
    if (it.kind === 'elaboracion' && depth < 8) {
      const ls = byParent.get('item:' + id) || [];
      c = ls.reduce((s, l) => s + l.qty * itemCost(l.item_id, depth + 1), 0) / (it.yield_qty || 1);
    }
    memoItem.set(id, c); return c;
  }
  function productCost(pid, delivery = false, depth = 0) {
    const ls = byParent.get('product:' + pid) || [];
    let food = 0, pack = 0;
    for (const l of ls) {
      if (l.channel === 'delivery' && !delivery) continue;
      if (l.sub_product_id && depth < 5) {
        const sub = productCost(l.sub_product_id, false, depth + 1);
        food += sub.food * l.qty; pack += sub.pack * l.qty;
      } else if (l.item_id) {
        const it = items.get(l.item_id); const c = l.qty * itemCost(l.item_id);
        if (it && it.kind === 'packaging') pack += c; else food += c;
      }
    }
    return { food, pack, total: food + pack };
  }
  // Descompone un producto en artículos base (para descontar stock)
  function explode(pid, qty, delivery, acc = new Map(), depth = 0) {
    const ls = byParent.get('product:' + pid) || [];
    for (const l of ls) {
      if (l.channel === 'delivery' && !delivery) continue;
      if (l.sub_product_id && depth < 5) explode(l.sub_product_id, qty * l.qty, false, acc, depth + 1);
      else if (l.item_id) explodeItem(l.item_id, qty * l.qty, acc);
    }
    return acc;
  }
  function explodeItem(id, qty, acc, depth = 0) {
    const it = items.get(id); if (!it) return acc;
    if (it.kind === 'elaboracion' && depth < 8) {
      for (const l of byParent.get('item:' + id) || []) explodeItem(l.item_id, qty * l.qty / (it.yield_qty || 1), acc, depth + 1);
    } else acc.set(id, (acc.get(id) || 0) + qty);
    return acc;
  }
  return { itemCost, productCost, explode, explodeItem, items };
}

function productPrice(p, channel, st) {
  if (PLATFORM_CHANNELS.includes(channel)) {
    if (p.price_delivery != null && p.price_delivery !== '') return Number(p.price_delivery);
    return round05(p.price * (1 + Number(st.delivery_surcharge_pct || 0) / 100));
  }
  return p.price;
}

// ------------------------------------------------------------------- auth
function authUser(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const row = get(`SELECT u.id,u.name,u.role,u.store_id,u.color, COALESCE(s.last_seen, s.created_at) seen FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND u.active=1`, token);
  if (!row) return null;
  const age = (Date.now() - new Date(row.seen.replace(' ', 'T')).getTime()) / 864e5;
  if (age > SESSION_DAYS) { run('DELETE FROM sessions WHERE token=?', token); return null; }
  if (age > 1 / 288) run('UPDATE sessions SET last_seen=? WHERE token=?', now(), token); // como mucho cada 5 min
  delete row.seen;
  return row;
}

// Bloqueo de intentos: tras 5 PIN fallidos, espera creciente (1, 2, 4… hasta 30 min)
const attempts = new Map();
function clientIp(req) {
  const fwd = TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  return fwd || req.socket.remoteAddress || '?';
}
function checkLock(key) {
  const a = attempts.get(key);
  if (a && a.until > Date.now()) fail(429, `Demasiados intentos. Espera ${Math.ceil((a.until - Date.now()) / 60000)} min.`);
}
function registerFail(key) {
  const a = attempts.get(key) || { n: 0, until: 0 };
  a.n += 1;
  if (a.n >= 5) a.until = Date.now() + Math.min(30, 2 ** (a.n - 5)) * 60000;
  attempts.set(key, a);
}
const clearFails = (key) => attempts.delete(key);
setInterval(() => { const t = Date.now(); for (const [k, a] of attempts) if (a.until < t - 36e5) attempts.delete(k); }, 36e5).unref();
function need(user, ...roles) {
  if (!user) fail(401, 'Sesión caducada. Vuelve a entrar.');
  if (roles.length && !roles.includes(user.role)) fail(403, 'No tienes permiso para esta acción.');
}
function canStore(user, storeId) {
  if (!storeId) fail(400, 'Falta el local.');
  if (user.store_id && Number(user.store_id) !== Number(storeId)) fail(403, 'No tienes acceso a este local.');
}
function supervisorOk(user, pin) {
  if (user.role !== 'cajero') return user;
  if (!pin) return null;
  const key = 'sup:' + user.id; checkLock(key);
  const sups = all(`SELECT * FROM users WHERE active=1 AND role IN ('admin','encargado')`);
  const ok = sups.find((s) => (!s.store_id || s.store_id === user.store_id) && checkPin(pin, s.pin)) || null;
  if (ok) clearFails(key); else registerFail(key);
  return ok;
}
const audit = (user, storeId, action, detail) =>
  run('INSERT INTO audit_log(user_id,store_id,action,detail) VALUES(?,?,?,?)', user?.id ?? null, storeId ?? null, action, typeof detail === 'string' ? detail : JSON.stringify(detail));

// ------------------------------------------------------------------- caja
const openSession = (storeId) => get('SELECT * FROM cash_sessions WHERE store_id=? AND closed_at IS NULL ORDER BY id DESC LIMIT 1', storeId);

function sessionSummary(sid) {
  const s = get('SELECT cs.*, so.name store_name, so.code store_code, u.name opened_by_name, u2.name closed_by_name FROM cash_sessions cs JOIN stores so ON so.id=cs.store_id LEFT JOIN users u ON u.id=cs.opened_by LEFT JOIN users u2 ON u2.id=cs.closed_by WHERE cs.id=?', sid);
  if (!s) fail(404, 'Caja no encontrada');
  const byMethod = all('SELECT method, ROUND(SUM(amount),2) total, COUNT(*) n FROM payments WHERE cash_session_id=? GROUP BY method', sid);
  const moves = all('SELECT m.*, u.name user_name FROM cash_moves m LEFT JOIN users u ON u.id=m.user_id WHERE session_id=? ORDER BY id', sid);
  const orders = all(`SELECT DISTINCT o.* FROM orders o JOIN payments p ON p.order_id=o.id WHERE p.cash_session_id=?`, sid);
  const sales = orders.filter((o) => o.type === 'venta');
  const refunds = orders.filter((o) => o.type === 'devolucion');
  const byChannel = {};
  for (const o of orders) { byChannel[o.channel] = r2((byChannel[o.channel] || 0) + o.total); }
  const vat = all(`SELECT l.vat, ROUND(SUM(l.total),2) total FROM order_lines l WHERE l.order_id IN (SELECT DISTINCT order_id FROM payments WHERE cash_session_id=?) GROUP BY l.vat`, sid)
    .map((v) => ({ vat: v.vat, total: v.total, base: r2(v.total / (1 + v.vat / 100)), cuota: r2(v.total - v.total / (1 + v.vat / 100)) }));
  const cash = byMethod.find((m) => m.method === 'efectivo')?.total || 0;
  const inMoves = moves.filter((m) => m.type === 'entrada').reduce((a, m) => a + m.amount, 0);
  const outMoves = moves.filter((m) => m.type === 'salida').reduce((a, m) => a + m.amount, 0);
  const expected = r2(s.opening_float + cash + inMoves - outMoves);
  return {
    session: s, byMethod, moves, byChannel, vat, expected_cash: expected,
    tickets: sales.length, refunds: refunds.length, refunds_total: r2(refunds.reduce((a, o) => a + o.total, 0)),
    total: r2(orders.reduce((a, o) => a + o.total, 0)),
    avg_ticket: sales.length ? r2(sales.reduce((a, o) => a + o.total, 0) / sales.length) : 0
  };
}

// ---------------------------------------------------------------- pedidos
function nextNumber(store, type) {
  const year = new Date().getFullYear();
  const series = type === 'devolucion' ? `${store.code}-R${year}` : `${store.code}-${year}`;
  const n = (get('SELECT MAX(number) m FROM orders WHERE series=?', series).m || 0) + 1;
  return { series, number: n, full_number: `${series}-${String(n).padStart(6, '0')}` };
}
function applyStock(storeId, map, sign, type, ref, userId, note) {
  const coster = makeCoster();
  const up = q('INSERT INTO stock(store_id,item_id,qty) VALUES(?,?,?) ON CONFLICT(store_id,item_id) DO UPDATE SET qty=ROUND(qty+excluded.qty,4)');
  const mv = q('INSERT INTO stock_moves(store_id,item_id,qty,type,unit_cost,ref,note,user_id) VALUES(?,?,?,?,?,?,?,?)');
  for (const [itemId, qty] of map) {
    const d = r4(qty * sign); if (!d) continue;
    up.run(storeId, itemId, d);
    mv.run(storeId, itemId, d, type, r4(coster.itemCost(itemId)), ref, note || null, userId);
  }
}

function registerPayments(order, payments, user, store, st) {
  const sess = openSession(store.id);
  if (!sess) fail(409, 'La caja está cerrada. Ábrela antes de cobrar.');
  const total = r2(order.total);
  if (!Array.isArray(payments) || !payments.length) fail(400, 'Indica la forma de pago.');
  const sum = r2(payments.reduce((a, p) => a + Number(p.amount || 0), 0));
  if (Math.abs(sum - total) > 0.009) fail(400, `Los pagos (${sum.toFixed(2)} €) no cuadran con el total (${total.toFixed(2)} €).`);
  const ins = q('INSERT INTO payments(order_id,method,amount,given,change,cash_session_id) VALUES(?,?,?,?,?,?)');
  let change = 0;
  for (const p of payments) {
    if (!['efectivo', 'tarjeta', 'bizum', 'plataforma'].includes(p.method)) fail(400, 'Forma de pago no válida.');
    const amount = r2(p.amount);
    let given = null, ch = null;
    if (p.method === 'efectivo' && p.given != null && amount > 0) {
      given = r2(p.given); if (given < amount) fail(400, 'El efectivo entregado no cubre el importe.');
      ch = r2(given - amount); change += ch;
    }
    ins.run(order.id, p.method, amount, given, ch, sess.id);
  }
  const paidAt = now();
  const num = order.full_number ? { series: order.series, number: order.number, full_number: order.full_number } : nextNumber(store, order.type);
  // Registro de facturación VERI*FACTU (alta), encadenado con el anterior del mismo NIF
  const lines = all('SELECT vat, total FROM order_lines WHERE order_id=?', order.id);
  const ref = order.type === 'devolucion' ? get('SELECT o.full_number, o.paid_at, r.nif FROM orders o LEFT JOIN verifactu_records r ON r.order_id=o.id WHERE o.id=(SELECT ref_order_id FROM orders WHERE id=?)', order.id) : null;
  const h = vf.createAlta(db, { order: { id: order.id, type: order.type, full_number: num.full_number, paid_at: paidAt, total }, store, settings: st, lines, original: ref });
  run('UPDATE orders SET status=?, paid_at=?, series=?, number=?, full_number=?, cash_session_id=?, prev_hash=?, hash=? WHERE id=?',
    'pagado', paidAt, num.series, num.number, num.full_number, sess.id, h.prev_huella, h.huella, order.id);
  return { change: r2(change) };
}

function loadOrder(id) {
  const o = get(`SELECT o.*, s.name store_name, s.code store_code, s.address store_address, s.city store_city, s.phone store_phone, u.name user_name
    FROM orders o JOIN stores s ON s.id=o.store_id LEFT JOIN users u ON u.id=o.user_id WHERE o.id=?`, id);
  if (!o) fail(404, 'Pedido no encontrado');
  o.lines = all('SELECT * FROM order_lines WHERE order_id=? ORDER BY id', id);
  o.payments = all('SELECT * FROM payments WHERE order_id=? ORDER BY id', id);
  o.refunds = all('SELECT id, full_number, total, created_at, refund_reason FROM orders WHERE ref_order_id=? ORDER BY id', id);
  if (o.ref_order_id) o.ref = get('SELECT id, full_number, created_at FROM orders WHERE id=?', o.ref_order_id);
  const vat = {};
  for (const l of o.lines) vat[l.vat] = r2((vat[l.vat] || 0) + l.total);
  o.vat_breakdown = Object.entries(vat).map(([rate, total]) => { const base = r2(total / (1 + rate / 100)); return { vat: Number(rate), total, base, cuota: r2(total - base) }; });
  // Emisor de la factura y código QR VERI*FACTU
  const st = settings(); const store = get('SELECT nif, legal_name FROM stores WHERE id=?', o.store_id);
  o.issuer_nif = store.nif || st.company_nif; o.issuer_name = store.legal_name || st.company_name;
  const mode = st.verifactu_mode || 'desactivado';
  if (o.full_number && o.status === 'pagado' && mode !== 'desactivado') {
    const rec = get('SELECT nif, num_serie, fecha_expedicion, importe_total, status FROM verifactu_records WHERE order_id=?', o.id);
    if (rec) o.verifactu = { qr_url: vf.qrUrl(mode, { nif: rec.nif, num_serie: rec.num_serie, fecha: rec.fecha_expedicion, importe: rec.importe_total }), status: rec.status, test: mode !== 'produccion' };
  }
  return o;
}

function createOrder(body, user) {
  const st = settings();
  const store = get('SELECT * FROM stores WHERE id=?', body.store_id);
  if (!store) fail(400, 'Local no válido');
  canStore(user, store.id);
  const channel = body.channel || 'local';
  if (!CHANNELS.includes(channel)) fail(400, 'Canal no válido');
  const lines = (body.lines || []).filter((l) => Number(l.qty) > 0);
  if (!lines.length) fail(400, 'El ticket está vacío.');
  const delivery = DELIVERY_CHANNELS.includes(channel);
  const discount = Math.min(100, Math.max(0, Number(body.discount_pct || 0)));
  if (discount > 0 && !supervisorOk(user, body.auth_pin)) fail(403, 'El descuento necesita el PIN de un encargado.');
  const coster = makeCoster();
  const prodStmt = q('SELECT * FROM products WHERE id=?');

  return tx(db, () => {
    let customerId = null;
    const c = body.customer || {};
    if (c.phone || c.name) {
      const ex = c.phone ? get('SELECT * FROM customers WHERE phone=?', c.phone) : null;
      if (ex) { run('UPDATE customers SET name=COALESCE(?,name), address=COALESCE(?,address) WHERE id=?', c.name || null, c.address || null, ex.id); customerId = ex.id; }
      else customerId = Number(run('INSERT INTO customers(phone,name,address) VALUES(?,?,?)', c.phone || null, c.name || null, c.address || null).lastInsertRowid);
    }
    const kitchen = channel === 'local' ? 'entregado' : 'preparando';
    const oid = Number(run(`INSERT INTO orders(store_id,type,channel,status,kitchen_status,customer_id,customer_name,customer_phone,customer_address,platform_ref,notes,discount_pct,user_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, store.id, 'venta', channel, 'pendiente', kitchen, customerId, c.name || null, c.phone || null, c.address || null,
      body.platform_ref || null, body.notes || null, discount, user.id).lastInsertRowid);

    const insL = q('INSERT INTO order_lines(order_id,product_id,name,qty,unit_price,vat,total,unit_cost,notes) VALUES(?,?,?,?,?,?,?,?,?)');
    let total = 0, cost = 0, base = 0;
    const consumption = new Map();
    for (const l of lines) {
      const p = prodStmt.get(l.product_id);
      if (!p || !p.active) fail(400, 'Producto no disponible');
      const qty = Number(l.qty);
      const unit = productPrice(p, channel, st);
      const lt = r2(qty * unit * (1 - discount / 100));
      const uc = r4(coster.productCost(p.id, delivery).total);
      insL.run(oid, p.id, p.name, qty, unit, p.vat, lt, uc, l.notes || null);
      total += lt; cost += uc * qty; base += lt / (1 + p.vat / 100);
      coster.explode(p.id, qty, delivery, consumption);
    }
    const fee = Number(st.home_delivery_fee || 0);
    if (channel === 'domicilio' && fee > 0 && !body.no_fee) {
      insL.run(oid, null, 'Gastos de envío', 1, fee, Number(st.default_vat || 10), fee, 0, null);
      total += fee; base += fee / (1 + Number(st.default_vat || 10) / 100);
    }
    total = r2(total); base = r2(base);
    run('UPDATE orders SET total=?, base=?, vat_amount=?, cost=? WHERE id=?', total, base, r2(total - base), r4(cost), oid);
    applyStock(store.id, consumption, -1, 'venta', 'T' + oid, user.id);

    let change = 0;
    if (body.payments) change = registerPayments({ id: oid, total, type: 'venta' }, body.payments, user, store, st).change;
    audit(user, store.id, 'venta', { order: oid, total, channel });
    return { ...loadOrder(oid), change };
  });
}

function refundOrder(id, body, user) {
  const st = settings();
  const o = loadOrder(id);
  canStore(user, o.store_id);
  if (o.type !== 'venta' || o.status !== 'pagado') fail(400, 'Solo se pueden devolver tickets cobrados.');
  const sup = supervisorOk(user, body.auth_pin);
  if (!sup) fail(403, 'La devolución necesita el PIN de un encargado.');
  const store = get('SELECT * FROM stores WHERE id=?', o.store_id);
  const already = new Map(all(`SELECT l.ref_line_id, -SUM(l.qty) q FROM order_lines l JOIN orders r ON r.id=l.order_id WHERE r.ref_order_id=? GROUP BY l.ref_line_id`, id).map((r) => [r.ref_line_id, r.q]));
  const req = body.all ? o.lines.map((l) => ({ line_id: l.id, qty: l.qty - (already.get(l.id) || 0) })) : (body.lines || []);
  const sel = [];
  for (const r of req) {
    const l = o.lines.find((x) => x.id === Number(r.line_id)); if (!l) continue;
    const qty = Number(r.qty); if (!(qty > 0)) continue;
    if (qty > l.qty - (already.get(l.id) || 0) + 1e-9) fail(400, `No se pueden devolver más unidades de "${l.name}" que las vendidas.`);
    sel.push({ l, qty });
  }
  if (!sel.length) fail(400, body.all ? 'Este ticket ya está devuelto por completo.' : 'Selecciona qué productos se devuelven.');
  const method = body.method || o.payments[0]?.method || 'efectivo';
  const coster = makeCoster();
  return tx(db, () => {
    const rid = Number(run(`INSERT INTO orders(store_id,type,ref_order_id,channel,status,kitchen_status,customer_id,customer_name,customer_phone,customer_address,refund_reason,user_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, o.store_id, 'devolucion', o.id, o.channel, 'pendiente', 'entregado', o.customer_id, o.customer_name, o.customer_phone, o.customer_address, body.reason || null, user.id).lastInsertRowid);
    const insL = q('INSERT INTO order_lines(order_id,product_id,name,qty,unit_price,vat,total,unit_cost,notes,ref_line_id) VALUES(?,?,?,?,?,?,?,?,?,?)');
    let total = 0, base = 0, cost = 0; const back = new Map();
    for (const { l, qty } of sel) {
      const lt = r2(-(l.total / l.qty) * qty);
      insL.run(rid, l.product_id, l.name, -qty, l.unit_price, l.vat, lt, l.unit_cost, null, l.id);
      total += lt; base += lt / (1 + l.vat / 100); cost -= l.unit_cost * qty;
      if (body.restock && l.product_id) coster.explode(l.product_id, qty, DELIVERY_CHANNELS.includes(o.channel), back);
    }
    total = r2(total); base = r2(base);
    run('UPDATE orders SET total=?, base=?, vat_amount=?, cost=? WHERE id=?', total, base, r2(total - base), body.restock ? r4(cost) : 0, rid);
    if (back.size) applyStock(o.store_id, back, 1, 'devolucion', 'R' + rid, user.id);
    registerPayments({ id: rid, total, type: 'devolucion' }, [{ method, amount: total }], user, store, st);
    audit(user, o.store_id, 'devolucion', { order: o.id, refund: rid, total, authorized_by: sup.id, reason: body.reason });
    return loadOrder(rid);
  });
}

// ------------------------------------------------------------- informes
function dateRange(qs) {
  const today = now().slice(0, 10);
  const from = qs.get('from') || today; const to = qs.get('to') || today;
  return [from + ' 00:00:00', to + ' 23:59:59'];
}
function storeFilter(user, qs, alias = 'o') {
  let sid = qs.get('store_id');
  if (user.store_id) sid = String(user.store_id);
  return sid ? { sql: ` AND ${alias}.store_id=${Number(sid)}`, sid: Number(sid) } : { sql: '', sid: null };
}

function reportSummary(user, qs) {
  const st = settings();
  const [from, to] = dateRange(qs); const sf = storeFilter(user, qs);
  const base = `FROM orders o WHERE o.status='pagado' AND o.paid_at BETWEEN ? AND ?${sf.sql}`;
  const tot = get(`SELECT COUNT(CASE WHEN type='venta' THEN 1 END) tickets, ROUND(SUM(total),2) total, ROUND(SUM(base),2) base, ROUND(SUM(cost),2) cost,
    ROUND(SUM(CASE WHEN type='devolucion' THEN total ELSE 0 END),2) refunds, COUNT(CASE WHEN type='devolucion' THEN 1 END) refund_count ${base}`, from, to);
  const byDay = all(`SELECT substr(paid_at,1,10) day, ROUND(SUM(total),2) total, ROUND(SUM(base),2) base, COUNT(CASE WHEN type='venta' THEN 1 END) tickets ${base} GROUP BY day ORDER BY day`, from, to);
  const byChannel = all(`SELECT channel, ROUND(SUM(total),2) total, ROUND(SUM(base),2) base, COUNT(CASE WHEN type='venta' THEN 1 END) tickets ${base} GROUP BY channel ORDER BY total DESC`, from, to)
    .map((c) => ({ ...c, commission: PLATFORM_CHANNELS.includes(c.channel) ? r2(c.base * Number(st['commission_' + c.channel] || 0) / 100) : 0 }));
  const byStore = all(`SELECT s.id, s.code, s.name, ROUND(SUM(o.total),2) total, ROUND(SUM(o.base),2) base, ROUND(SUM(o.cost),2) cost, COUNT(CASE WHEN o.type='venta' THEN 1 END) tickets
    FROM orders o JOIN stores s ON s.id=o.store_id WHERE o.status='pagado' AND o.paid_at BETWEEN ? AND ?${sf.sql} GROUP BY s.id ORDER BY total DESC`, from, to);
  const storeComm = all(`SELECT o.store_id, o.channel, SUM(o.base) base FROM orders o WHERE o.status='pagado' AND o.paid_at BETWEEN ? AND ?${sf.sql} GROUP BY o.store_id, o.channel`, from, to);
  const days = Math.max(1, Math.round((new Date(to.slice(0, 10)) - new Date(from.slice(0, 10))) / 864e5) + 1);
  const storesInfo = new Map(all('SELECT * FROM stores').map((x) => [x.id, x]));
  for (const b of byStore) {
    b.commission = r2(storeComm.filter((c) => c.store_id === b.id && PLATFORM_CHANNELS.includes(c.channel)).reduce((a, c) => a + c.base * Number(st['commission_' + c.channel] || 0) / 100, 0));
    b.fee = r2((b.base || 0) * Number(st.management_fee_pct || 0) / 100);
    const si = storesInfo.get(b.id);
    b.fixed = r2((si.rent + si.staff_cost + si.utilities + si.other_fixed) * days / 30);
    b.profit = r2((b.base || 0) - (b.cost || 0) - b.commission - b.fee - b.fixed);
  }
  const byHour = all(`SELECT substr(paid_at,12,2) hour, ROUND(SUM(total),2) total, COUNT(*) tickets ${base} AND type='venta' GROUP BY hour ORDER BY hour`, from, to);
  const byMethod = all(`SELECT p.method, ROUND(SUM(p.amount),2) total FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.paid_at BETWEEN ? AND ?${sf.sql} GROUP BY p.method ORDER BY total DESC`, from, to);
  const top = all(`SELECT l.product_id, l.name, ROUND(SUM(l.qty),2) qty, ROUND(SUM(l.total),2) total, ROUND(SUM(l.total/(1+l.vat/100.0)),2) base, ROUND(SUM(l.unit_cost*l.qty),2) cost
    FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE o.status='pagado' AND o.paid_at BETWEEN ? AND ?${sf.sql} GROUP BY l.product_id, l.name ORDER BY total DESC`, from, to);
  const commissions = r2(byChannel.reduce((a, c) => a + c.commission, 0));
  const sales = tot.tickets ? r2((tot.total - (tot.refunds || 0)) / tot.tickets) : 0;
  return {
    from, to, days, ...tot, avg_ticket: sales, food_cost_pct: tot.base ? r2(tot.cost / tot.base * 100) : 0,
    commissions, management_fee: r2((tot.base || 0) * Number(st.management_fee_pct || 0) / 100),
    gross_margin: r2((tot.base || 0) - (tot.cost || 0) - commissions),
    byDay, byChannel, byStore, byHour, byMethod, top
  };
}

function monthlyByStore(user, qs) {
  const sf = storeFilter(user, qs);
  const months = Number(qs.get('months') || 12);
  return all(`SELECT s.id store_id, s.code, substr(o.paid_at,1,7) month, ROUND(SUM(o.total),2) total, ROUND(SUM(o.base),2) base, ROUND(SUM(o.cost),2) cost
    FROM orders o JOIN stores s ON s.id=o.store_id WHERE o.status='pagado' AND o.paid_at >= date('now','-${months} months')${sf.sql}
    GROUP BY s.id, month ORDER BY month`);
}

// --------------------------------------------------------- CRUD genérico
const ENTITIES = {
  stores: { table: 'stores', fields: ['code', 'name', 'address', 'city', 'format', 'status', 'opened_at', 'investment', 'rent', 'staff_cost', 'utilities', 'other_fixed', 'phone', 'active', 'legal_name', 'nif'], order: 'id' },
  suppliers: { table: 'suppliers', fields: ['name', 'category', 'contact', 'phone', 'email', 'cif', 'notes', 'active'], order: 'name' },
  items: { table: 'items', fields: ['name', 'kind', 'unit', 'cost', 'supplier_id', 'purchase_unit', 'purchase_factor', 'yield_qty', 'min_stock', 'notes', 'active'], order: 'kind, name' },
  categories: { table: 'categories', fields: ['name', 'color', 'sort'], order: 'sort, name' },
  products: { table: 'products', fields: ['name', 'short_name', 'category_id', 'price', 'price_delivery', 'vat', 'color', 'sort', 'active', 'notes'], order: 'category_id, sort, name' },
  users: { table: 'users', fields: ['name', 'role', 'store_id', 'color', 'active'], order: 'role, name' }
};

// PIN: 4-8 cifras; en producción, administración y encargados al menos 6
function checkPinRule(pin, role) {
  const min = PRODUCTION && role !== 'cajero' ? 6 : 4;
  if (!new RegExp(`^\\d{${min},8}$`).test(String(pin))) fail(400, `El PIN debe tener entre ${min} y 8 cifras.`);
  if (/^(\d)\1+$/.test(String(pin)) || '0123456789'.includes(String(pin))) fail(400, 'Ese PIN es demasiado fácil (repetido o consecutivo).');
}

function crud(entity, method, id, body, user) {
  const E = ENTITIES[entity]; if (!E) fail(404, 'No encontrado');
  if (method === 'GET') {
    if (entity === 'users') return all('SELECT id,name,role,store_id,color,active FROM users ORDER BY ' + E.order);
    return all(`SELECT * FROM ${E.table} ORDER BY ${E.order}`);
  }
  need(user, 'admin');
  const vals = E.fields.filter((f) => body && f in body).map((f) => [f, body[f] === '' ? null : body[f]]);
  if (method === 'POST') {
    if (entity === 'stores') {
      const max = Number(settings().max_stores || 20);
      const n = get('SELECT COUNT(*) n FROM stores WHERE active=1').n;
      if (n >= max) fail(400, `Has llegado al máximo de ${max} locales configurado en Ajustes.`);
    }
    if (entity === 'users' && !body.pin) fail(400, 'Indica un PIN para el usuario.');
    if (entity === 'users') checkPinRule(body.pin, body.role);
    if (entity === 'users') vals.push(['pin', hashPin(body.pin)]);
    const r = run(`INSERT INTO ${E.table}(${vals.map((v) => v[0]).join(',')}) VALUES(${vals.map(() => '?').join(',')})`, ...vals.map((v) => v[1]));
    const newId = Number(r.lastInsertRowid);
    if (entity === 'stores') for (const it of all("SELECT id FROM items WHERE kind!='elaboracion'")) run('INSERT OR IGNORE INTO stock(store_id,item_id,qty) VALUES(?,?,0)', newId, it.id);
    if (entity === 'items' && body.kind !== 'elaboracion') for (const s of all('SELECT id FROM stores')) run('INSERT OR IGNORE INTO stock(store_id,item_id,qty) VALUES(?,?,0)', s.id, newId);
    audit(user, null, 'alta_' + entity, { id: newId });
    if (entity === 'users') return get('SELECT id,name,role,store_id,color,active FROM users WHERE id=?', newId);
    return get(`SELECT * FROM ${E.table} WHERE id=?`, newId);
  }
  if (method === 'PUT') {
    if (entity === 'users' && body.pin) { checkPinRule(body.pin, body.role || get('SELECT role FROM users WHERE id=?', id)?.role); vals.push(['pin', hashPin(body.pin)]); }
    if (vals.length) run(`UPDATE ${E.table} SET ${vals.map((v) => v[0] + '=?').join(',')} WHERE id=?`, ...vals.map((v) => v[1]), id);
    audit(user, null, 'editar_' + entity, { id, ...Object.fromEntries(vals.filter((v) => v[0] !== 'pin')) });
    return entity === 'users' ? get('SELECT id,name,role,store_id,color,active FROM users WHERE id=?', id) : get(`SELECT * FROM ${E.table} WHERE id=?`, id);
  }
  if (method === 'DELETE') {
    if (E.fields.includes('active')) run(`UPDATE ${E.table} SET active=0 WHERE id=?`, id);
    else run(`DELETE FROM ${E.table} WHERE id=?`, id);
    audit(user, null, 'baja_' + entity, { id });
    return { ok: true };
  }
}

// ------------------------------------------------------------------ rutas
const routes = [];
const route = (method, pattern, handler) => {
  const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

// Públicas (pantalla de acceso del TPV)
route('GET', '/api/public/info', () => { const s = settings(); return { brand: s.brand, company_name: s.company_name }; });
route('GET', '/api/public/stores', () => all("SELECT id, code, name, city, status FROM stores WHERE active=1 ORDER BY id"));
route('GET', '/api/public/users', ({ qs }) => {
  const sid = Number(qs.get('store_id') || 0);
  return all('SELECT id, name, role, color FROM users WHERE active=1 AND (store_id IS NULL OR store_id=?) ORDER BY CASE role WHEN \'cajero\' THEN 0 WHEN \'encargado\' THEN 1 ELSE 2 END, name', sid);
});
route('POST', '/api/login', ({ body, req }) => {
  const ip = clientIp(req);
  const keyU = 'u:' + Number(body.user_id), keyIp = 'ip:' + ip;
  checkLock(keyU); checkLock(keyIp);
  const u = get('SELECT * FROM users WHERE id=? AND active=1', body.user_id);
  if (!u || !checkPin(body.pin, u.pin)) {
    registerFail(keyU); registerFail(keyIp);
    audit(null, null, 'login_fallido', { user_id: Number(body.user_id) || null, ip });
    fail(401, 'PIN incorrecto');
  }
  clearFails(keyU); clearFails(keyIp);
  const token = crypto.randomBytes(24).toString('hex');
  run('INSERT INTO sessions(token,user_id) VALUES(?,?)', token, u.id);
  audit(u, u.store_id, 'login', '');
  return { token, user: { id: u.id, name: u.name, role: u.role, store_id: u.store_id, color: u.color } };
});
route('POST', '/api/logout', ({ req }) => { const t = (req.headers.authorization || '').slice(7); run('DELETE FROM sessions WHERE token=?', t); return { ok: true }; });
route('GET', '/api/me', ({ user }) => { need(user); return user; });

// Catálogo TPV
route('GET', '/api/catalog', ({ user }) => {
  need(user);
  const st = settings();
  const cats = all('SELECT * FROM categories ORDER BY sort, name');
  const prods = all('SELECT * FROM products WHERE active=1 ORDER BY sort, name').map((p) => ({
    id: p.id, name: p.name, short_name: p.short_name, category_id: p.category_id, color: p.color, vat: p.vat,
    price: p.price, price_platform: productPrice(p, 'glovo', st)
  }));
  return { categories: cats, products: prods, settings: { home_delivery_fee: Number(st.home_delivery_fee || 0), brand: st.brand, company_name: st.company_name, company_nif: st.company_nif, company_address: st.company_address, ticket_footer: st.ticket_footer } };
});

// Caja
route('GET', '/api/cash/current', ({ user, qs }) => {
  need(user); const sid = Number(qs.get('store_id')); canStore(user, sid);
  const s = openSession(sid); return s ? sessionSummary(s.id) : null;
});
route('POST', '/api/cash/open', ({ user, body }) => {
  need(user); canStore(user, body.store_id);
  if (openSession(body.store_id)) fail(409, 'La caja ya está abierta.');
  const id = Number(run('INSERT INTO cash_sessions(store_id,opened_by,opening_float) VALUES(?,?,?)', body.store_id, user.id, r2(body.opening_float || 0)).lastInsertRowid);
  audit(user, body.store_id, 'abrir_caja', { id, float: body.opening_float });
  return sessionSummary(id);
});
route('POST', '/api/cash/move', ({ user, body }) => {
  need(user); const s = get('SELECT * FROM cash_sessions WHERE id=? AND closed_at IS NULL', body.session_id);
  if (!s) fail(400, 'Caja no abierta'); canStore(user, s.store_id);
  if (!['entrada', 'salida'].includes(body.type) || !(Number(body.amount) > 0)) fail(400, 'Movimiento no válido');
  if (body.type === 'salida' && !supervisorOk(user, body.auth_pin)) fail(403, 'Sacar dinero de caja necesita el PIN de un encargado.');
  run('INSERT INTO cash_moves(session_id,type,amount,reason,user_id) VALUES(?,?,?,?,?)', s.id, body.type, r2(body.amount), body.reason || null, user.id);
  audit(user, s.store_id, 'mov_caja', body);
  return sessionSummary(s.id);
});
route('GET', '/api/cash/:id', ({ user, params }) => {
  need(user); const sum = sessionSummary(Number(params.id)); canStore(user, sum.session.store_id); return sum;
});
route('POST', '/api/cash/:id/close', ({ user, params, body }) => {
  need(user); const sum = sessionSummary(Number(params.id)); canStore(user, sum.session.store_id);
  if (sum.session.closed_at) fail(400, 'La caja ya está cerrada.');
  const pending = get(`SELECT COUNT(*) n FROM orders WHERE store_id=? AND status='pendiente'`, sum.session.store_id).n;
  if (pending && !body.force) fail(409, `Hay ${pending} pedido(s) sin cobrar. Cóbralos o anúlalos antes de cerrar.`);
  const counted = r2(body.counted_cash || 0);
  run('UPDATE cash_sessions SET closed_by=?, closed_at=?, expected_cash=?, counted_cash=?, difference=?, notes=? WHERE id=?',
    user.id, now(), sum.expected_cash, counted, r2(counted - sum.expected_cash), body.notes || null, sum.session.id);
  audit(user, sum.session.store_id, 'cerrar_caja', { id: sum.session.id, counted, expected: sum.expected_cash });
  return sessionSummary(sum.session.id);
});
route('GET', '/api/cash', ({ user, qs }) => {
  need(user, 'admin', 'encargado'); const sf = storeFilter(user, qs, 'cs'); const [from, to] = dateRange(qs);
  return all(`SELECT cs.*, s.code store_code, s.name store_name, u.name opened_by_name, u2.name closed_by_name,
      (SELECT ROUND(SUM(amount),2) FROM payments p WHERE p.cash_session_id=cs.id) total
    FROM cash_sessions cs JOIN stores s ON s.id=cs.store_id LEFT JOIN users u ON u.id=cs.opened_by LEFT JOIN users u2 ON u2.id=cs.closed_by
    WHERE cs.opened_at BETWEEN ? AND ?${sf.sql} ORDER BY cs.id DESC`, from, to);
});

// Clientes
route('GET', '/api/customers', ({ user, qs }) => {
  need(user); const p = (qs.get('phone') || '').trim(); if (p.length < 3) return [];
  return all('SELECT * FROM customers WHERE phone LIKE ? ORDER BY id DESC LIMIT 8', p + '%');
});

// Pedidos
route('POST', '/api/orders', ({ user, body }) => { need(user); return createOrder(body, user); });
route('GET', '/api/orders/active', ({ user, qs }) => {
  need(user); const sid = Number(qs.get('store_id')); canStore(user, sid);
  const rows = all(`SELECT o.*, (SELECT GROUP_CONCAT(CAST(qty AS INTEGER) || '× ' || name, ' · ') FROM order_lines WHERE order_id=o.id) summary
    FROM orders o WHERE o.store_id=? AND o.type='venta' AND o.status!='anulado'
    AND (o.kitchen_status!='entregado' OR o.status='pendiente') ORDER BY o.id`, sid);
  return rows;
});
route('GET', '/api/orders', ({ user, qs }) => {
  need(user); const [from, to] = dateRange(qs); const sf = storeFilter(user, qs);
  if (user.role === 'cajero' && !sf.sid) fail(400, 'Falta el local');
  let sql = `SELECT o.id, o.store_id, s.code store_code, o.type, o.full_number, o.channel, o.status, o.kitchen_status, o.total, o.cost, o.created_at, o.paid_at,
      o.customer_name, o.customer_phone, o.ref_order_id, u.name user_name,
      (SELECT GROUP_CONCAT(DISTINCT method) FROM payments WHERE order_id=o.id) methods
    FROM orders o JOIN stores s ON s.id=o.store_id LEFT JOIN users u ON u.id=o.user_id WHERE o.created_at BETWEEN ? AND ?${sf.sql}`;
  const args = [from, to];
  if (qs.get('channel')) { sql += ' AND o.channel=?'; args.push(qs.get('channel')); }
  if (qs.get('type')) { sql += ' AND o.type=?'; args.push(qs.get('type')); }
  if (qs.get('status')) { sql += ' AND o.status=?'; args.push(qs.get('status')); }
  if (qs.get('q')) { sql += ' AND (o.full_number LIKE ? OR o.customer_phone LIKE ? OR o.customer_name LIKE ?)'; const t = '%' + qs.get('q') + '%'; args.push(t, t, t); }
  sql += ' ORDER BY o.id DESC LIMIT ' + Math.min(Number(qs.get('limit') || 300), 2000);
  return all(sql, ...args);
});
route('GET', '/api/orders/:id', ({ user, params }) => { need(user); const o = loadOrder(Number(params.id)); canStore(user, o.store_id); return o; });
route('POST', '/api/orders/:id/pay', ({ user, params, body }) => {
  need(user); const o = loadOrder(Number(params.id)); canStore(user, o.store_id);
  if (o.status !== 'pendiente') fail(400, 'Este pedido ya está cobrado o anulado.');
  const store = get('SELECT * FROM stores WHERE id=?', o.store_id);
  return tx(db, () => { const r = registerPayments(o, body.payments, user, store, settings()); audit(user, o.store_id, 'cobro', { order: o.id }); return { ...loadOrder(o.id), change: r.change }; });
});
route('POST', '/api/orders/:id/status', ({ user, params, body }) => {
  need(user); const o = loadOrder(Number(params.id)); canStore(user, o.store_id);
  if (!['nuevo', 'preparando', 'listo', 'en_reparto', 'entregado'].includes(body.kitchen_status)) fail(400, 'Estado no válido');
  run('UPDATE orders SET kitchen_status=? WHERE id=?', body.kitchen_status, o.id); return loadOrder(o.id);
});
route('POST', '/api/orders/:id/cancel', ({ user, params, body }) => {
  need(user); const o = loadOrder(Number(params.id)); canStore(user, o.store_id);
  if (o.status !== 'pendiente') fail(400, 'Un ticket cobrado no se anula: haz una devolución.');
  if (!supervisorOk(user, body.auth_pin)) fail(403, 'Anular necesita el PIN de un encargado.');
  return tx(db, () => {
    run("UPDATE orders SET status='anulado', notes=COALESCE(notes,'') || ? WHERE id=?", ' [Anulado: ' + (body.reason || 's/m') + ']', o.id);
    if (body.restock) {
      const coster = makeCoster(); const back = new Map();
      for (const l of o.lines) if (l.product_id) coster.explode(l.product_id, l.qty, DELIVERY_CHANNELS.includes(o.channel), back);
      applyStock(o.store_id, back, 1, 'devolucion', 'A' + o.id, user.id, 'Pedido anulado');
    }
    audit(user, o.store_id, 'anular', { order: o.id, reason: body.reason }); return loadOrder(o.id);
  });
});
route('POST', '/api/orders/:id/refund', ({ user, params, body }) => { need(user); return refundOrder(Number(params.id), body, user); });

// Mermas desde el TPV o la administración
route('POST', '/api/waste', ({ user, body }) => {
  need(user); canStore(user, body.store_id);
  const qty = Number(body.qty); if (!(qty > 0)) fail(400, 'Cantidad no válida');
  const coster = makeCoster(); const m = new Map();
  if (body.product_id) coster.explode(Number(body.product_id), qty, false, m);
  else if (body.item_id) coster.explodeItem(Number(body.item_id), qty, m);
  else fail(400, 'Indica producto o artículo');
  tx(db, () => applyStock(body.store_id, m, -1, 'merma', null, user.id, body.note || 'Merma'));
  audit(user, body.store_id, 'merma', body);
  return { ok: true };
});

// --------------------------------------------------------- administración
for (const e of Object.keys(ENTITIES)) {
  route('GET', `/api/admin/${e}`, ({ user }) => { need(user, 'admin', 'encargado'); return crud(e, 'GET', null, null, user); });
  route('POST', `/api/admin/${e}`, ({ user, body }) => crud(e, 'POST', null, body, user));
  route('PUT', `/api/admin/${e}/:id`, ({ user, body, params }) => crud(e, 'PUT', Number(params.id), body, user));
  route('DELETE', `/api/admin/${e}/:id`, ({ user, params }) => crud(e, 'DELETE', Number(params.id), null, user));
}
route('GET', '/api/admin/settings', ({ user }) => { need(user, 'admin', 'encargado'); return settings(); });
route('PUT', '/api/admin/settings', ({ user, body }) => {
  need(user, 'admin');
  const next = { ...settings(), ...body };
  if (body.company_nif && !vf.validNif(body.company_nif)) fail(400, 'El NIF de la empresa no es válido.');
  if (['pruebas', 'produccion'].includes(next.verifactu_mode)) {
    const bad = [];
    if (!vf.validNif(next.company_nif)) bad.push('NIF de la empresa');
    if (!vf.validNif(next.sif_producer_nif)) bad.push('NIF del productor del sistema');
    for (const st of all('SELECT code, nif FROM stores WHERE active=1')) if (st.nif && !vf.validNif(st.nif)) bad.push('NIF del local ' + st.code);
    if (bad.length) fail(400, 'Para enviar a la AEAT corrige antes: ' + bad.join(', ') + '.');
    const c = vf.certStatus(path.dirname(DB_FILE)); if (!c.ok) fail(400, c.message);
  }
  for (const [k, v] of Object.entries(body)) run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v));
  audit(user, null, 'ajustes', body); return settings();
});
route('GET', '/api/admin/recipe/:type/:id', ({ user, params }) => {
  need(user, 'admin', 'encargado');
  const coster = makeCoster();
  return all(`SELECT r.*, i.name item_name, i.unit, i.kind, p.name sub_name FROM recipe_lines r LEFT JOIN items i ON i.id=r.item_id LEFT JOIN products p ON p.id=r.sub_product_id
      WHERE r.parent_type=? AND r.parent_id=? ORDER BY r.channel, i.kind, r.id`, params.type, Number(params.id))
    .map((l) => ({ ...l, unit_cost: l.item_id ? r4(coster.itemCost(l.item_id)) : r4(coster.productCost(l.sub_product_id).total), line_cost: r4(l.qty * (l.item_id ? coster.itemCost(l.item_id) : coster.productCost(l.sub_product_id).total)) }));
});
route('PUT', '/api/admin/recipe/:type/:id', ({ user, params, body }) => {
  need(user, 'admin');
  if (!['product', 'item'].includes(params.type)) fail(400, 'Tipo no válido');
  const pid = Number(params.id);
  tx(db, () => {
    run('DELETE FROM recipe_lines WHERE parent_type=? AND parent_id=?', params.type, pid);
    const ins = q('INSERT INTO recipe_lines(parent_type,parent_id,item_id,sub_product_id,qty,channel) VALUES(?,?,?,?,?,?)');
    for (const l of body.lines || []) {
      if (!(Number(l.qty) > 0) || (!l.item_id && !l.sub_product_id)) continue;
      if (params.type === 'product' && Number(l.sub_product_id) === pid) fail(400, 'Un menú no puede contenerse a sí mismo.');
      ins.run(params.type, pid, l.item_id || null, l.sub_product_id || null, Number(l.qty), l.channel === 'delivery' ? 'delivery' : 'all');
    }
  });
  audit(user, null, 'escandallo', { type: params.type, id: pid });
  return { ok: true };
});
// Escandallos calculados de toda la carta
route('GET', '/api/admin/costs', ({ user }) => {
  need(user, 'admin', 'encargado');
  const st = settings(); const coster = makeCoster();
  const products = all('SELECT p.*, c.name category FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY c.sort, p.sort').map((p) => {
    const loc = coster.productCost(p.id, false); const del = coster.productCost(p.id, true);
    const net = p.price / (1 + p.vat / 100); const pp = productPrice(p, 'glovo', st); const netP = pp / (1 + p.vat / 100);
    const comm = netP * Number(st.commission_glovo || 30) / 100;
    return {
      id: p.id, name: p.name, category: p.category, active: p.active, price: p.price, price_platform: pp, vat: p.vat,
      cost_food: r4(loc.food), cost_pack: r4(loc.pack), cost: r4(loc.total), cost_delivery: r4(del.total),
      net: r4(net), margin: r4(net - loc.total), margin_pct: net ? r2((net - loc.total) / net * 100) : 0, food_cost_pct: net ? r2(loc.total / net * 100) : 0,
      margin_platform: r4(netP - del.total - comm), margin_platform_pct: netP ? r2((netP - del.total - comm) / netP * 100) : 0
    };
  });
  const items = all('SELECT id FROM items').map((i) => ({ id: i.id, unit_cost: r4(coster.itemCost(i.id)) }));
  return { products, items };
});

// Stock
route('GET', '/api/stock', ({ user, qs }) => {
  need(user, 'admin', 'encargado'); const sid = Number(qs.get('store_id')); canStore(user, sid);
  const coster = makeCoster();
  return all(`SELECT i.id, i.name, i.kind, i.unit, i.supplier_id, sp.name supplier, COALESCE(s.qty,0) qty, COALESCE(s.min_qty, i.min_stock) min_qty
      FROM items i LEFT JOIN stock s ON s.item_id=i.id AND s.store_id=? LEFT JOIN suppliers sp ON sp.id=i.supplier_id
      WHERE i.kind!='elaboracion' AND i.active=1 ORDER BY i.kind, i.name`, sid)
    .map((r) => ({ ...r, unit_cost: r4(coster.itemCost(r.id)), value: r2(r.qty * coster.itemCost(r.id)) }));
});
route('POST', '/api/stock/count', ({ user, body }) => {
  need(user, 'admin', 'encargado'); canStore(user, body.store_id);
  const coster = makeCoster();
  tx(db, () => {
    for (const c of body.counts || []) {
      if (c.qty === '' || c.qty == null) continue;
      const cur = get('SELECT qty FROM stock WHERE store_id=? AND item_id=?', body.store_id, c.item_id)?.qty || 0;
      const diff = r4(Number(c.qty) - cur); if (!diff) continue;
      run('INSERT INTO stock(store_id,item_id,qty) VALUES(?,?,?) ON CONFLICT(store_id,item_id) DO UPDATE SET qty=excluded.qty', body.store_id, c.item_id, Number(c.qty));
      run('INSERT INTO stock_moves(store_id,item_id,qty,type,unit_cost,note,user_id) VALUES(?,?,?,?,?,?,?)', body.store_id, c.item_id, diff, 'inventario', r4(coster.itemCost(c.item_id)), body.note || 'Recuento de inventario', user.id);
    }
  });
  audit(user, body.store_id, 'inventario', { n: (body.counts || []).length });
  return { ok: true };
});
route('POST', '/api/stock/transfer', ({ user, body }) => {
  need(user, 'admin', 'encargado'); canStore(user, body.from_store_id);
  const qty = Number(body.qty); if (!(qty > 0) || body.from_store_id === body.to_store_id) fail(400, 'Traspaso no válido');
  tx(db, () => {
    applyStock(Number(body.from_store_id), new Map([[Number(body.item_id), qty]]), -1, 'traspaso', 'a ' + body.to_store_id, user.id, body.note);
    applyStock(Number(body.to_store_id), new Map([[Number(body.item_id), qty]]), 1, 'traspaso', 'de ' + body.from_store_id, user.id, body.note);
  });
  return { ok: true };
});
route('GET', '/api/stock/moves', ({ user, qs }) => {
  need(user, 'admin', 'encargado'); const [from, to] = dateRange(qs); const sf = storeFilter(user, qs, 'm');
  let sql = `SELECT m.*, i.name item_name, i.unit, s.code store_code, u.name user_name FROM stock_moves m JOIN items i ON i.id=m.item_id JOIN stores s ON s.id=m.store_id LEFT JOIN users u ON u.id=m.user_id
    WHERE m.created_at BETWEEN ? AND ?${sf.sql}`;
  const a = [from, to];
  if (qs.get('type')) { sql += ' AND m.type=?'; a.push(qs.get('type')); }
  if (qs.get('item_id')) { sql += ' AND m.item_id=?'; a.push(Number(qs.get('item_id'))); }
  return all(sql + ' ORDER BY m.id DESC LIMIT 1000', ...a);
});
route('GET', '/api/stock/consumption', ({ user, qs }) => {
  need(user, 'admin', 'encargado'); const [from, to] = dateRange(qs); const sf = storeFilter(user, qs, 'm');
  return all(`SELECT i.id, i.name, i.unit, i.kind,
      ROUND(-SUM(CASE WHEN m.type IN ('venta','devolucion') THEN m.qty ELSE 0 END),3) sold,
      ROUND(-SUM(CASE WHEN m.type='merma' THEN m.qty ELSE 0 END),3) waste,
      ROUND(SUM(CASE WHEN m.type='compra' THEN m.qty ELSE 0 END),3) bought,
      ROUND(SUM(CASE WHEN m.type='inventario' THEN m.qty ELSE 0 END),3) adjust,
      ROUND(-SUM(CASE WHEN m.type IN ('venta','devolucion','merma') THEN m.qty*m.unit_cost ELSE 0 END),2) cost
    FROM stock_moves m JOIN items i ON i.id=m.item_id WHERE m.created_at BETWEEN ? AND ?${sf.sql} GROUP BY i.id ORDER BY cost DESC`, from, to);
});

// Compras
route('GET', '/api/purchases', ({ user, qs }) => {
  need(user, 'admin', 'encargado'); const sf = storeFilter(user, qs, 'p');
  let sql = `SELECT p.*, s.code store_code, s.name store_name, sp.name supplier_name, (SELECT COUNT(*) FROM purchase_lines WHERE purchase_id=p.id) n_lines
    FROM purchases p JOIN stores s ON s.id=p.store_id LEFT JOIN suppliers sp ON sp.id=p.supplier_id WHERE 1=1${sf.sql}`;
  const a = [];
  if (qs.get('status')) { sql += ' AND p.status=?'; a.push(qs.get('status')); }
  return all(sql + ' ORDER BY p.id DESC LIMIT 500', ...a);
});
function loadPurchase(id) {
  const p = get(`SELECT p.*, s.code store_code, s.name store_name, s.address store_address, sp.name supplier_name, sp.email supplier_email, sp.phone supplier_phone
    FROM purchases p JOIN stores s ON s.id=p.store_id LEFT JOIN suppliers sp ON sp.id=p.supplier_id WHERE p.id=?`, id);
  if (!p) fail(404, 'Compra no encontrada');
  p.lines = all('SELECT l.*, i.name item_name, i.unit, i.kind FROM purchase_lines l JOIN items i ON i.id=l.item_id WHERE purchase_id=? ORDER BY l.id', id);
  return p;
}
function savePurchaseLines(pid, lines) {
  run('DELETE FROM purchase_lines WHERE purchase_id=?', pid);
  const ins = q('INSERT INTO purchase_lines(purchase_id,item_id,qty,unit_cost) VALUES(?,?,?,?)');
  let total = 0;
  for (const l of lines || []) { if (!(Number(l.qty) > 0) || !l.item_id) continue; ins.run(pid, l.item_id, Number(l.qty), Number(l.unit_cost || 0)); total += l.qty * l.unit_cost; }
  run('UPDATE purchases SET total=? WHERE id=?', r2(total), pid);
}
route('GET', '/api/purchases/:id', ({ user, params }) => { need(user, 'admin', 'encargado'); const p = loadPurchase(Number(params.id)); canStore(user, p.store_id); return p; });
route('POST', '/api/purchases', ({ user, body }) => {
  need(user, 'admin', 'encargado'); canStore(user, body.store_id);
  return tx(db, () => {
    const id = Number(run('INSERT INTO purchases(store_id,supplier_id,notes,expected_at,created_by) VALUES(?,?,?,?,?)', body.store_id, body.supplier_id || null, body.notes || null, body.expected_at || null, user.id).lastInsertRowid);
    savePurchaseLines(id, body.lines); return loadPurchase(id);
  });
});
route('PUT', '/api/purchases/:id', ({ user, params, body }) => {
  need(user, 'admin', 'encargado'); const p = loadPurchase(Number(params.id)); canStore(user, p.store_id);
  if (!['borrador', 'pedido'].includes(p.status)) fail(400, 'Esta compra ya no se puede modificar.');
  return tx(db, () => {
    run('UPDATE purchases SET supplier_id=?, notes=?, expected_at=?, status=? WHERE id=?', body.supplier_id ?? p.supplier_id, body.notes ?? p.notes, body.expected_at ?? p.expected_at,
      ['borrador', 'pedido', 'anulado'].includes(body.status) ? body.status : p.status, p.id);
    if (body.lines) savePurchaseLines(p.id, body.lines);
    return loadPurchase(p.id);
  });
});
route('POST', '/api/purchases/:id/receive', ({ user, params, body }) => {
  need(user, 'admin', 'encargado'); const p = loadPurchase(Number(params.id)); canStore(user, p.store_id);
  if (!['borrador', 'pedido'].includes(p.status)) fail(400, 'Esta compra ya está recibida o anulada.');
  const mode = settings().cost_update_mode || 'ultimo';
  return tx(db, () => {
    let total = 0;
    for (const l of p.lines) {
      const r = (body.lines || []).find((x) => Number(x.id) === l.id) || {};
      const rq = r.received_qty != null && r.received_qty !== '' ? Number(r.received_qty) : l.qty;
      const uc = r.unit_cost != null && r.unit_cost !== '' ? Number(r.unit_cost) : l.unit_cost;
      run('UPDATE purchase_lines SET received_qty=?, unit_cost=?, temp_ok=? WHERE id=?', rq, uc, r.temp_ok ? 1 : 0, l.id);
      total += rq * uc;
      if (rq > 0) {
        const it = get('SELECT * FROM items WHERE id=?', l.item_id);
        if (mode === 'medio') {
          const stockAll = get('SELECT COALESCE(SUM(qty),0) q FROM stock WHERE item_id=?', l.item_id).q;
          const prevQ = Math.max(0, stockAll);
          const newCost = prevQ + rq > 0 ? (prevQ * it.cost + rq * uc) / (prevQ + rq) : uc;
          run('UPDATE items SET cost=? WHERE id=?', r4(newCost), l.item_id);
        } else run('UPDATE items SET cost=? WHERE id=?', r4(uc), l.item_id);
        run('INSERT INTO stock(store_id,item_id,qty) VALUES(?,?,?) ON CONFLICT(store_id,item_id) DO UPDATE SET qty=ROUND(qty+excluded.qty,4)', p.store_id, l.item_id, rq);
        run('INSERT INTO stock_moves(store_id,item_id,qty,type,unit_cost,ref,note,user_id) VALUES(?,?,?,?,?,?,?,?)', p.store_id, l.item_id, rq, 'compra', uc, 'C' + p.id, body.invoice_ref || null, user.id);
      }
    }
    run("UPDATE purchases SET status='recibido', received_at=?, received_by=?, invoice_ref=?, total=? WHERE id=?", now(), user.id, body.invoice_ref || null, r2(total), p.id);
    audit(user, p.store_id, 'recepcion', { purchase: p.id, total });
    return loadPurchase(p.id);
  });
});
// Propuesta de pedido: artículos por debajo del mínimo
route('GET', '/api/purchases-suggest', ({ user, qs }) => {
  need(user, 'admin', 'encargado'); const sid = Number(qs.get('store_id')); canStore(user, sid);
  const sup = qs.get('supplier_id');
  return all(`SELECT i.id item_id, i.name item_name, i.unit, i.cost unit_cost, i.supplier_id, COALESCE(s.qty,0) qty_now, COALESCE(s.min_qty,i.min_stock) min_qty
    FROM items i LEFT JOIN stock s ON s.item_id=i.id AND s.store_id=? WHERE i.active=1 AND i.kind!='elaboracion' AND COALESCE(s.qty,0) < COALESCE(s.min_qty,i.min_stock)
    ${sup ? 'AND i.supplier_id=' + Number(sup) : ''} ORDER BY i.supplier_id, i.name`, sid)
    .map((r) => ({ ...r, qty: Math.ceil(Math.max(r.min_qty * 2 - r.qty_now, 0) * 100) / 100 }));
});

// Informes
route('GET', '/api/reports/summary', ({ user, qs }) => { need(user, 'admin', 'encargado'); return reportSummary(user, qs); });
route('GET', '/api/reports/monthly', ({ user, qs }) => { need(user, 'admin', 'encargado'); return monthlyByStore(user, qs); });
route('GET', '/api/reports/verifactu', ({ user, qs }) => {
  need(user, 'admin'); const st = settings(); const store = get('SELECT * FROM stores WHERE id=?', Number(qs.get('store_id')));
  if (!store) fail(404, 'Local no encontrado');
  return vf.verifyChain(db, (store.nif || st.company_nif || '').toUpperCase());
});
route('GET', '/api/admin/audit', ({ user }) => { need(user, 'admin'); return all('SELECT a.*, u.name user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500'); });
route('GET', '/api/admin/export/:what', ({ user, params, qs, res }) => {
  need(user, 'admin', 'encargado');
  let rows = [];
  if (params.what === 'ventas') {
    const [from, to] = dateRange(qs); const sf = storeFilter(user, qs);
    rows = all(`SELECT s.code local, o.full_number numero, o.type tipo, o.channel canal, o.paid_at fecha, o.base base, o.vat_amount iva, o.total total, o.cost coste,
      (SELECT GROUP_CONCAT(method || ':' || amount) FROM payments WHERE order_id=o.id) pagos FROM orders o JOIN stores s ON s.id=o.store_id
      WHERE o.status='pagado' AND o.paid_at BETWEEN ? AND ?${sf.sql} ORDER BY o.paid_at`, from, to);
  } else if (params.what === 'escandallos') {
    rows = crud('products', 'GET').map((p) => p);
  } else fail(404, 'Exportación no disponible');
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const csv = '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => { const v = r[c] ?? ''; return typeof v === 'number' ? String(v).replace('.', ',') : `"${String(v).replace(/"/g, '""')}"`; }).join(';'))].join('\n');
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="popollo-${params.what}.csv"` });
  res.end(csv); return undefined;
});

// ------------------------------------------------------------ salud y copias
route('GET', '/api/health', () => ({ ok: true, version: require('./package.json').version, time: now() }));
const BACKUP_DIR = path.join(DATA_DIR, 'copias');
function makeBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = now().replace(/[-: ]/g, '').slice(0, 12);
  const file = path.join(BACKUP_DIR, `popollo-${stamp}.db`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const keep = Number(process.env.BACKUP_KEEP || 30);
  const list = fs.readdirSync(BACKUP_DIR).filter((f) => /^popollo-\d+\.db$/.test(f)).sort();
  for (const f of list.slice(0, Math.max(0, list.length - keep))) fs.unlinkSync(path.join(BACKUP_DIR, f));
  return file;
}
// Copia automática una vez al día (sirve también en Hostinger, donde no siempre hay cron)
function dailyBackup() {
  try {
    const today = now().slice(0, 10).replace(/-/g, '');
    const has = fs.existsSync(BACKUP_DIR) && fs.readdirSync(BACKUP_DIR).some((f) => f.startsWith('popollo-' + today));
    if (!has) console.log('[Copias] Copia diaria creada:', path.basename(makeBackup()));
  } catch (e) { console.error('[Copias] No se pudo crear la copia:', e.message); }
}
route('GET', '/api/admin/backup', ({ user, res }) => {
  need(user, 'admin');
  const file = makeBackup();
  audit(user, null, 'descarga_copia', path.basename(file));
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${path.basename(file)}"` });
  fs.createReadStream(file).pipe(res);
  return undefined;
});

// ------------------------------------------------------------- VERI*FACTU
const sender = vf.createSender({ db, getSettings: settings, dataDir: path.dirname(DB_FILE), port: PORT });
route('GET', '/api/verifactu/status', ({ user }) => { need(user, 'admin'); return sender.status(); });
route('POST', '/api/verifactu/send', async ({ user }) => { need(user, 'admin'); return sender.tick(); });
route('GET', '/api/verifactu/records', ({ user, qs }) => {
  need(user, 'admin');
  let sql = 'SELECT r.id, r.order_id, r.nif, r.tipo_factura, r.num_serie, r.fecha_expedicion, r.importe_total, r.cuota_total, r.fecha_hora_huso, r.huella, r.status, r.env, r.attempts, r.error_code, r.last_error, r.sent_at, s.code store_code FROM verifactu_records r LEFT JOIN stores s ON s.id=r.store_id WHERE 1=1';
  const a = [];
  if (qs.get('status')) { sql += ' AND r.status=?'; a.push(qs.get('status')); }
  if (qs.get('q')) { sql += ' AND r.num_serie LIKE ?'; a.push('%' + qs.get('q') + '%'); }
  return all(sql + ' ORDER BY r.id DESC LIMIT 500', ...a);
});
route('GET', '/api/verifactu/records/:id/xml', ({ user, params }) => {
  need(user, 'admin'); const r = get('SELECT * FROM verifactu_records WHERE id=?', Number(params.id)); if (!r) fail(404, 'Registro no encontrado');
  const multi = get('SELECT COUNT(DISTINCT nif) n FROM verifactu_records').n > 1;
  return { xml: vf.envelope(r.nif, r.issuer_name, [r], settings(), multi), record: r };
});
route('POST', '/api/verifactu/records/:id/retry', ({ user, params }) => {
  need(user, 'admin'); run("UPDATE verifactu_records SET status='pendiente', last_error=NULL, error_code=NULL WHERE id=? AND status IN ('incorrecto','aceptado_errores')", Number(params.id));
  audit(user, null, 'verifactu_reintento', { id: Number(params.id) }); return { ok: true };
});
route('GET', '/api/verifactu/envios', ({ user }) => { need(user, 'admin'); return all('SELECT id, nif, env, n_records, estado, csv, wait_seconds, http_status, error, sent_at FROM verifactu_envios ORDER BY id DESC LIMIT 100'); });
route('GET', '/api/verifactu/chains', ({ user }) => { need(user, 'admin'); return all('SELECT DISTINCT nif FROM verifactu_records').map((r) => vf.verifyChain(db, r.nif)); });
route('GET', '/api/public/sif', () => { const st = settings(); return { name: st.sif_name, id: st.sif_id, version: st.sif_version, producer: st.sif_producer_name, producer_nif: st.sif_producer_nif, address: st.sif_producer_address, place: st.sif_declaration_place, date: st.sif_declaration_date, installation: st.sif_installation }; });

// --------------------------------------------------------------- servidor
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
  ...(PRODUCTION ? { 'Strict-Transport-Security': 'max-age=31536000' } : {})
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/tpv') pathname = '/tpv.html';
  if (pathname === '/admin') pathname = '/admin.html';
  const file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('No encontrado'); }
  const mtime = fs.statSync(file).mtime.toUTCString();
  if (req.headers['if-modified-since'] === mtime) { res.writeHead(304); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Last-Modified': mtime });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__aeat-simulador' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || '';
    // Solo desde el propio servidor y nunca a través del proxy (que también llega desde 127.0.0.1)
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip) || req.headers['x-forwarded-for'] || req.headers['x-real-ip']) { res.writeHead(403); return res.end(); }
    const ch = []; for await (const c of req) ch.push(c);
    res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
    return res.end(vf.simulatorResponse(Buffer.concat(ch).toString('utf8')));
  }
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  try {
    let body = {};
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > 2e6) fail(413, 'Petición demasiado grande'); chunks.push(c); }
      const raw = Buffer.concat(chunks).toString('utf8'); try { body = raw ? JSON.parse(raw) : {}; } catch { fail(400, 'Datos mal formados'); }
    }
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) fail(404, 'Ruta no encontrada');
    const m = url.pathname.match(r.re); const params = {}; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    const user = authUser(req);
    const out = await r.handler({ req, res, body, params, qs: url.searchParams, user });
    if (out === undefined) return;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(out));
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: status === 500 ? (PRODUCTION ? 'Error interno del servidor' : 'Error interno: ' + e.message) : e.message }));
  }
});

server.listen(PORT, HOST, () => {
  sender.start();
  dailyBackup(); setInterval(dailyBackup, 6 * 36e5).unref();
  console.log(`  Modo: ${PRODUCTION ? 'PRODUCCIÓN' : 'desarrollo (usuarios de prueba)'} · datos en ${DATA_DIR}`);
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`\n  POPOLLO TPV en marcha`);
  console.log(`  · En este equipo:   http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  · En la red local:  http://${ip}:${PORT}`);
  console.log(`  · TPV: /tpv   · Administración: /admin\n`);
});
