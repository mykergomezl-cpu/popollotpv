// VERI*FACTU · Registros de facturación y remisión a la AEAT
// Normativa: RD 1007/2023 (Reglamento de sistemas informáticos de facturación) y Orden HAC/1177/2024.
// - Cada factura genera un registro de alta encadenado con la huella (SHA-256) del registro anterior del mismo NIF.
// - Los registros se envían por servicio web SOAP con certificado electrónico, respetando el control de flujo
//   (TiempoEsperaEnvio devuelto por la AEAT o 1.000 registros acumulados).
const crypto = require('node:crypto');
const https = require('node:https');
const http = require('node:http');
const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');

const NS_LR = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd';
const NS_RESP = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd';
const NS_SI = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd';
const ENDPOINTS = {
  pruebas: { personal: 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP', sello: 'https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP' },
  produccion: { personal: 'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP', sello: 'https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP' }
};
const QR_BASE = {
  produccion: 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR',
  pruebas: 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR',
  simulador: 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR'
};
const MODES = ['desactivado', 'simulador', 'pruebas', 'produccion'];
const MAX_BATCH = 1000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS verifactu_records (
  id INTEGER PRIMARY KEY, order_id INTEGER, store_id INTEGER,
  nif TEXT NOT NULL, issuer_name TEXT, kind TEXT DEFAULT 'alta',
  tipo_factura TEXT, num_serie TEXT, fecha_expedicion TEXT,
  cuota_total TEXT, importe_total TEXT, fecha_hora_huso TEXT,
  prev_id INTEGER, prev_huella TEXT, huella TEXT NOT NULL, data TEXT,
  status TEXT DEFAULT 'pendiente',   -- pendiente | enviando | correcto | aceptado_errores | incorrecto
  env TEXT, attempts INTEGER DEFAULT 0, error_code TEXT, last_error TEXT, envio_id INTEGER, sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_vf_nif ON verifactu_records(nif, id);
CREATE INDEX IF NOT EXISTS ix_vf_status ON verifactu_records(status);
CREATE TABLE IF NOT EXISTS verifactu_envios (
  id INTEGER PRIMARY KEY, nif TEXT, env TEXT, n_records INTEGER, estado TEXT, csv TEXT,
  wait_seconds INTEGER, http_status INTEGER, error TEXT, response TEXT,
  sent_at TEXT DEFAULT (datetime('now','localtime'))
);`;

// ------------------------------------------------------------- formatos
const amount = (n) => (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2);
const fechaES = (ymd) => { const [y, m, d] = String(ymd).slice(0, 10).split('-'); return `${d}-${m}-${y}`; };
function isoNow(date = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  const off = -date.getTimezoneOffset(); const sign = off >= 0 ? '+' : '-'; const a = Math.abs(off);
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}${sign}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}
const xmlEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').toUpperCase();

// Huella del registro de alta (especificación AEAT "Detalle de las especificaciones técnicas para generación de la huella")
function huellaAlta(r) {
  return sha256([
    `IDEmisorFactura=${r.nif.trim()}`, `NumSerieFactura=${r.num_serie.trim()}`, `FechaExpedicionFactura=${r.fecha_expedicion}`,
    `TipoFactura=${r.tipo_factura}`, `CuotaTotal=${r.cuota_total}`, `ImporteTotal=${r.importe_total}`,
    `Huella=${r.prev_huella || ''}`, `FechaHoraHusoGenRegistro=${r.fecha_hora_huso}`
  ].join('&'));
}

// Validación de NIF/CIF español (formato y dígito de control)
function validNif(v) {
  const s = String(v || '').toUpperCase().replace(/[\s-]/g, '');
  const L = 'TRWAGMYFPDXBNJZSQVHLCKE';
  if (/^\d{8}[A-Z]$/.test(s)) return L[Number(s.slice(0, 8)) % 23] === s[8];
  if (/^[XYZ]\d{7}[A-Z]$/.test(s)) return L[Number('XYZ'.indexOf(s[0]) + s.slice(1, 8)) % 23] === s[8];
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(s)) {
    const d = s.slice(1, 8); let sum = 0;
    for (let i = 0; i < 7; i++) { let n = Number(d[i]); if (i % 2 === 0) { n *= 2; n = Math.floor(n / 10) + (n % 10); } sum += n; }
    const c = (10 - (sum % 10)) % 10; const ctl = s[8];
    return ctl === String(c) || ctl === 'JABCDEFGHI'[c];
  }
  return false;
}

// ------------------------------------------------------- creación de registros
// Se llama DENTRO de la transacción de cobro, para que la cadena nunca quede rota.
function createAlta(db, { order, store, settings, lines, original }) {
  const nif = (store.nif || settings.company_nif || '').toUpperCase().replace(/[\s-]/g, '');
  const name = store.legal_name || settings.company_name || '';
  const isRefund = order.type === 'devolucion';
  // Desglose por tipo de IVA (base + cuota cuadran exactamente con el total)
  const byVat = new Map();
  for (const l of lines) byVat.set(Number(l.vat), (byVat.get(Number(l.vat)) || 0) + Number(l.total));
  const desglose = [...byVat].map(([vat, total]) => {
    const t = Math.round(total * 100) / 100; const base = Math.round(t / (1 + vat / 100) * 100) / 100;
    return { tipo: vat, base: amount(base), cuota: amount(t - base) };
  });
  const cuota = amount(desglose.reduce((a, d) => a + Number(d.cuota), 0));
  const prev = db.prepare('SELECT id, huella, num_serie, fecha_expedicion FROM verifactu_records WHERE nif=? ORDER BY id DESC LIMIT 1').get(nif);
  const rec = {
    nif, issuer_name: name, tipo_factura: isRefund ? 'R5' : 'F2', num_serie: order.full_number,
    fecha_expedicion: fechaES(order.paid_at), cuota_total: cuota, importe_total: amount(order.total),
    fecha_hora_huso: isoNow(), prev_huella: prev?.huella || ''
  };
  rec.huella = huellaAlta(rec);
  const data = {
    desglose, descripcion: isRefund ? 'Devolución de venta de comida preparada para llevar' : 'Venta de comida preparada para llevar y a domicilio',
    prev: prev ? { nif, num_serie: prev.num_serie, fecha_expedicion: prev.fecha_expedicion, huella: prev.huella } : null,
    rectificada: isRefund && original ? { nif: (original.nif || nif), num_serie: original.full_number, fecha_expedicion: fechaES(original.paid_at) } : null
  };
  const r = db.prepare(`INSERT INTO verifactu_records(order_id,store_id,nif,issuer_name,kind,tipo_factura,num_serie,fecha_expedicion,cuota_total,importe_total,fecha_hora_huso,prev_id,prev_huella,huella,data)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(order.id, store.id, nif, name, 'alta', rec.tipo_factura, rec.num_serie, rec.fecha_expedicion, rec.cuota_total, rec.importe_total,
    rec.fecha_hora_huso, prev?.id ?? null, rec.prev_huella, rec.huella, JSON.stringify(data));
  return { id: Number(r.lastInsertRowid), huella: rec.huella, prev_huella: rec.prev_huella, nif, name };
}

// URL del código QR (Orden HAC/1177/2024, art. 21)
function qrUrl(mode, { nif, num_serie, fecha, importe }) {
  const base = QR_BASE[mode] || QR_BASE.produccion;
  const q = new URLSearchParams({ nif, numserie: num_serie, fecha, importe });
  return `${base}?${q.toString()}`;
}

// ------------------------------------------------------------------ XML
function sifXml(settings, multiOT) {
  return `<sum1:SistemaInformatico>
          <sum1:NombreRazon>${xmlEsc(settings.sif_producer_name || settings.company_name)}</sum1:NombreRazon>
          <sum1:NIF>${xmlEsc(settings.sif_producer_nif || settings.company_nif)}</sum1:NIF>
          <sum1:NombreSistemaInformatico>${xmlEsc(settings.sif_name || 'POPOLLO TPV')}</sum1:NombreSistemaInformatico>
          <sum1:IdSistemaInformatico>${xmlEsc((settings.sif_id || 'PT').slice(0, 2))}</sum1:IdSistemaInformatico>
          <sum1:Version>${xmlEsc(settings.sif_version || '1.0.0')}</sum1:Version>
          <sum1:NumeroInstalacion>${xmlEsc(settings.sif_installation || 'CENTRAL-01')}</sum1:NumeroInstalacion>
          <sum1:TipoUsoPosibleSoloVerifactu>S</sum1:TipoUsoPosibleSoloVerifactu>
          <sum1:TipoUsoPosibleMultiOT>S</sum1:TipoUsoPosibleMultiOT>
          <sum1:IndicadorMultiplesOT>${multiOT ? 'S' : 'N'}</sum1:IndicadorMultiplesOT>
        </sum1:SistemaInformatico>`;
}

function registroAltaXml(rec, settings, multiOT) {
  const d = JSON.parse(rec.data || '{}');
  const id = (nif, ns, f) => `<sum1:IDEmisorFactura>${xmlEsc(nif)}</sum1:IDEmisorFactura><sum1:NumSerieFactura>${xmlEsc(ns)}</sum1:NumSerieFactura><sum1:FechaExpedicionFactura>${f}</sum1:FechaExpedicionFactura>`;
  return `<sum1:RegistroAlta>
        <sum1:IDVersion>1.0</sum1:IDVersion>
        <sum1:IDFactura>${id(rec.nif, rec.num_serie, rec.fecha_expedicion)}</sum1:IDFactura>
        <sum1:NombreRazonEmisor>${xmlEsc(rec.issuer_name)}</sum1:NombreRazonEmisor>
        <sum1:TipoFactura>${rec.tipo_factura}</sum1:TipoFactura>${rec.tipo_factura.startsWith('R') ? `
        <sum1:TipoRectificativa>I</sum1:TipoRectificativa>` : ''}${d.rectificada ? `
        <sum1:FacturasRectificadas><sum1:IDFacturaRectificada>${id(d.rectificada.nif, d.rectificada.num_serie, d.rectificada.fecha_expedicion)}</sum1:IDFacturaRectificada></sum1:FacturasRectificadas>` : ''}
        <sum1:DescripcionOperacion>${xmlEsc(d.descripcion || 'Venta')}</sum1:DescripcionOperacion>
        <sum1:Desglose>${(d.desglose || []).map((x) => `
          <sum1:DetalleDesglose>
            <sum1:Impuesto>01</sum1:Impuesto>
            <sum1:ClaveRegimen>01</sum1:ClaveRegimen>
            <sum1:CalificacionOperacion>S1</sum1:CalificacionOperacion>
            <sum1:TipoImpositivo>${amount(x.tipo)}</sum1:TipoImpositivo>
            <sum1:BaseImponibleOimporteNoSujeto>${x.base}</sum1:BaseImponibleOimporteNoSujeto>
            <sum1:CuotaRepercutida>${x.cuota}</sum1:CuotaRepercutida>
          </sum1:DetalleDesglose>`).join('')}
        </sum1:Desglose>
        <sum1:CuotaTotal>${rec.cuota_total}</sum1:CuotaTotal>
        <sum1:ImporteTotal>${rec.importe_total}</sum1:ImporteTotal>
        <sum1:Encadenamiento>${d.prev ? `
          <sum1:RegistroAnterior>${id(d.prev.nif, d.prev.num_serie, d.prev.fecha_expedicion)}<sum1:Huella>${d.prev.huella}</sum1:Huella></sum1:RegistroAnterior>` : `
          <sum1:PrimerRegistro>S</sum1:PrimerRegistro>`}
        </sum1:Encadenamiento>
        ${sifXml(settings, multiOT)}
        <sum1:FechaHoraHusoGenRegistro>${rec.fecha_hora_huso}</sum1:FechaHoraHusoGenRegistro>
        <sum1:TipoHuella>01</sum1:TipoHuella>
        <sum1:Huella>${rec.huella}</sum1:Huella>
      </sum1:RegistroAlta>`;
}

function envelope(nif, name, records, settings, multiOT) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sum="${NS_LR}" xmlns:sum1="${NS_SI}">
  <soapenv:Header/>
  <soapenv:Body>
    <sum:RegFactuSistemaFacturacion>
      <sum:Cabecera>
        <sum1:ObligadoEmision>
          <sum1:NombreRazon>${xmlEsc(name)}</sum1:NombreRazon>
          <sum1:NIF>${xmlEsc(nif)}</sum1:NIF>
        </sum1:ObligadoEmision>
      </sum:Cabecera>${records.map((r) => `
      <sum:RegistroFactura>
      ${registroAltaXml(r, settings, multiOT)}
      </sum:RegistroFactura>`).join('')}
    </sum:RegFactuSistemaFacturacion>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// Lectura de la respuesta (los prefijos de espacio de nombres pueden variar)
function tag(xml, name) { const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`)); return m ? m[1].trim() : null; }
function tags(xml, name) { return [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'g'))].map((m) => m[1]); }
function parseResponse(xml) {
  const fault = tag(xml, 'faultstring') || tag(xml, 'Text');
  if (fault && !tag(xml, 'EstadoEnvio')) return { fault: fault.replace(/<[^>]+>/g, '').trim() };
  return {
    estado: tag(xml, 'EstadoEnvio'), csv: tag(xml, 'CSV'), wait: Number(tag(xml, 'TiempoEsperaEnvio') || 60),
    lineas: tags(xml, 'RespuestaLinea').map((l) => ({
      num_serie: tag(l, 'NumSerieFactura'), estado: tag(l, 'EstadoRegistro'),
      codigo: tag(l, 'CodigoErrorRegistro'), descripcion: tag(l, 'DescripcionErrorRegistro')
    }))
  };
}

// Respuesta del simulador local (mismo formato que la AEAT) para probar sin certificado
function simulatorResponse(requestXml) {
  const cab = tag(requestXml, 'Cabecera') || '';
  const nif = tag(cab, 'NIF') || ''; const nombre = tag(cab, 'NombreRazon') || '';
  const regs = tags(requestXml, 'RegistroAlta');
  const lines = regs.map((r) => {
    const ns = tag(r, 'NumSerieFactura'); const f = tag(r, 'FechaExpedicionFactura'); const em = tag(r, 'IDEmisorFactura');
    const err = !validNif(em) ? ['4104', 'El NIF del emisor no está identificado (simulador: revisa el NIF del local o de la empresa).'] : null;
    return `<tikR:RespuestaLinea><tikR:IDFactura><tik:IDEmisorFactura>${em}</tik:IDEmisorFactura><tik:NumSerieFactura>${ns}</tik:NumSerieFactura><tik:FechaExpedicionFactura>${f}</tik:FechaExpedicionFactura></tikR:IDFactura>
      <tikR:Operacion><tik:TipoOperacion>Alta</tik:TipoOperacion></tikR:Operacion><tikR:EstadoRegistro>${err ? 'Incorrecto' : 'Correcto'}</tikR:EstadoRegistro>${err ? `<tikR:CodigoErrorRegistro>${err[0]}</tikR:CodigoErrorRegistro><tikR:DescripcionErrorRegistro>${err[1]}</tikR:DescripcionErrorRegistro>` : ''}</tikR:RespuestaLinea>`;
  });
  const bad = lines.filter((l) => l.includes('Incorrecto')).length;
  const estado = !bad ? 'Correcto' : bad === lines.length ? 'Incorrecto' : 'ParcialmenteCorrecto';
  return `<?xml version="1.0" encoding="UTF-8"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body>
    <tikR:RespuestaRegFactuSistemaFacturacion xmlns:tikR="${NS_RESP}" xmlns:tik="${NS_SI}">${estado !== 'Incorrecto' ? `<tikR:CSV>SIM${crypto.randomBytes(6).toString('hex').toUpperCase()}</tikR:CSV>` : ''}
    <tikR:Cabecera><tik:ObligadoEmision><tik:NombreRazon>${nombre}</tik:NombreRazon><tik:NIF>${nif}</tik:NIF></tik:ObligadoEmision></tikR:Cabecera>
    <tikR:TiempoEsperaEnvio>5</tikR:TiempoEsperaEnvio><tikR:EstadoEnvio>${estado}</tikR:EstadoEnvio>${lines.join('')}
    </tikR:RespuestaRegFactuSistemaFacturacion></env:Body></env:Envelope>`;
}

// ---------------------------------------------------------- certificado
function certConfig(dataDir) {
  let file = process.env.VERIFACTU_CERT, pass = process.env.VERIFACTU_CERT_PASSWORD;
  const cfgPath = path.join(dataDir, 'verifactu.json');
  if (!file && fs.existsSync(cfgPath)) {
    try { const c = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); file = c.certificado; pass = c.password; } catch { /* */ }
  }
  if (file && !path.isAbsolute(file)) file = path.join(dataDir, file);
  return { file, pass, cfgPath };
}
function certStatus(dataDir) {
  const { file, pass, cfgPath } = certConfig(dataDir);
  if (!file) return { ok: false, message: `No hay certificado configurado. Crea ${cfgPath} (ver LEEME).` };
  if (!fs.existsSync(file)) return { ok: false, message: 'No se encuentra el archivo del certificado: ' + path.basename(file) };
  try { tls.createSecureContext({ pfx: fs.readFileSync(file), passphrase: pass || '' }); return { ok: true, message: 'Certificado cargado correctamente: ' + path.basename(file) }; }
  catch (e) { return { ok: false, message: 'No se puede abrir el certificado (¿contraseña incorrecta?): ' + e.message }; }
}

function post(url, body, { pfx, passphrase, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url); const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      method: 'POST', hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, timeout,
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""', 'Content-Length': Buffer.byteLength(body) },
      ...(pfx ? { pfx, passphrase } : {})
    }, (res) => { const ch = []; res.on('data', (c) => ch.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(ch).toString('utf8') })); });
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado')));
    req.on('error', reject);
    req.end(body);
  });
}

// ------------------------------------------------------------ remisión
function createSender({ db, getSettings, dataDir, port, log = console }) {
  db.exec(SCHEMA);
  db.prepare("UPDATE verifactu_records SET status='pendiente' WHERE status='enviando'").run();
  const nextAllowed = new Map(); // nif -> ms
  const backoff = new Map();
  let busy = false, timer = null, lastRun = null;

  async function sendBatch(nif, st, mode, force = false) {
    const pending = db.prepare("SELECT * FROM verifactu_records WHERE nif=? AND status='pendiente' ORDER BY id LIMIT ?").all(nif, MAX_BATCH);
    if (!pending.length) return null;
    const now = Date.now();
    if (!force && pending.length < MAX_BATCH && now < (nextAllowed.get(nif) || 0)) return null;
    const multiOT = db.prepare('SELECT COUNT(DISTINCT nif) n FROM verifactu_records').get().n > 1;
    const xml = envelope(nif, pending[0].issuer_name, pending, st, multiOT);
    const ids = pending.map((r) => r.id);
    db.prepare(`UPDATE verifactu_records SET status='enviando', attempts=attempts+1 WHERE id IN (${ids.join(',')})`).run();
    let res, error = null;
    try {
      if (mode === 'simulador') res = await post(`http://127.0.0.1:${port}/__aeat-simulador`, xml, { timeout: 15000 });
      else {
        const { file, pass } = certConfig(dataDir);
        if (!file || !fs.existsSync(file)) throw new Error('Falta el certificado electrónico para enviar a la AEAT');
        res = await post(ENDPOINTS[mode][st.verifactu_cert_type === 'sello' ? 'sello' : 'personal'], xml, { pfx: fs.readFileSync(file), passphrase: pass || '' });
      }
    } catch (e) { error = e.message; }
    const parsed = res ? parseResponse(res.body) : null;
    if (!res || parsed.fault || !parsed.estado) {
      const msg = error || parsed?.fault || `Respuesta no válida de la AEAT (HTTP ${res?.status})`;
      db.prepare(`UPDATE verifactu_records SET status='pendiente', last_error=? WHERE id IN (${ids.join(',')})`).run(msg);
      db.prepare('INSERT INTO verifactu_envios(nif,env,n_records,estado,http_status,error,response) VALUES(?,?,?,?,?,?,?)').run(nif, mode, ids.length, 'Error', res?.status ?? null, msg, (res?.body || '').slice(0, 20000));
      const b = Math.min((backoff.get(nif) || 30) * 2, 1800); backoff.set(nif, b); nextAllowed.set(nif, Date.now() + b * 1000);
      log.warn(`[VeriFactu] Envío fallido (${nif}): ${msg}. Reintento en ${b} s`);
      return { ok: false, error: msg };
    }
    backoff.delete(nif);
    nextAllowed.set(nif, Date.now() + Math.max(1, parsed.wait) * 1000);
    const envioId = Number(db.prepare('INSERT INTO verifactu_envios(nif,env,n_records,estado,csv,wait_seconds,http_status,response) VALUES(?,?,?,?,?,?,?,?)')
      .run(nif, mode, ids.length, parsed.estado, parsed.csv, parsed.wait, res.status, res.body.slice(0, 20000)).lastInsertRowid);
    const upd = db.prepare('UPDATE verifactu_records SET status=?, env=?, error_code=?, last_error=?, envio_id=?, sent_at=datetime(\'now\',\'localtime\') WHERE id=?');
    for (const r of pending) {
      const l = parsed.lineas.find((x) => x.num_serie === r.num_serie);
      let status = 'correcto', code = null, desc = null;
      if (!l) { status = parsed.estado === 'Correcto' ? 'correcto' : 'pendiente'; desc = l ? null : (parsed.estado === 'Correcto' ? null : 'Sin respuesta para este registro'); }
      else if (l.estado === 'Correcto') status = 'correcto';
      else if (l.estado === 'AceptadoConErrores') { status = 'aceptado_errores'; code = l.codigo; desc = l.descripcion; }
      else if (l.codigo === '3000') { status = 'correcto'; code = l.codigo; desc = 'Ya estaba registrado en la AEAT (duplicado)'; }
      else { status = 'incorrecto'; code = l.codigo; desc = l.descripcion; }
      upd.run(status, mode, code, desc, envioId, r.id);
    }
    log.log(`[VeriFactu] ${nif}: ${ids.length} registro(s) → ${parsed.estado}. Próximo envío en ${parsed.wait} s`);
    return { ok: true, estado: parsed.estado, n: ids.length };
  }

  async function tick(force = false) {
    if (busy) return { busy: true };
    const st = getSettings(); const mode = st.verifactu_mode || 'desactivado';
    if (!['simulador', 'pruebas', 'produccion'].includes(mode)) return { mode, sent: [] };
    busy = true; lastRun = new Date().toISOString();
    const out = [];
    try {
      for (const { nif } of db.prepare("SELECT DISTINCT nif FROM verifactu_records WHERE status='pendiente'").all()) {
        const r = await sendBatch(nif, st, mode, force); if (r) out.push({ nif, ...r });
      }
    } catch (e) { log.error('[VeriFactu]', e); } finally { busy = false; }
    return { mode, sent: out };
  }

  function start() { if (!timer) timer = setInterval(() => tick().catch(() => {}), 10000); timer.unref?.(); }
  function status() {
    const st = getSettings();
    const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM verifactu_records GROUP BY status').all().map((r) => [r.status, r.n]));
    const next = [...nextAllowed].map(([nif, t]) => ({ nif, next_send: new Date(t).toISOString(), seconds: Math.max(0, Math.round((t - Date.now()) / 1000)) }));
    const nifs = db.prepare('SELECT DISTINCT nif FROM verifactu_records').all().map((r) => r.nif);
    return {
      mode: st.verifactu_mode || 'desactivado', endpoint: ENDPOINTS[st.verifactu_mode]?.[st.verifactu_cert_type === 'sello' ? 'sello' : 'personal'] || null,
      cert: ['pruebas', 'produccion'].includes(st.verifactu_mode) || st.verifactu_mode === 'desactivado' ? certStatus(dataDir) : { ok: true, message: 'El simulador no necesita certificado' },
      counts, next, last_run: lastRun, busy, nifs: nifs.map((n) => ({ nif: n, valid: validNif(n) }))
    };
  }
  return { tick, start, status };
}

// Comprobación completa de la cadena de un NIF
function verifyChain(db, nif) {
  const rows = db.prepare('SELECT * FROM verifactu_records WHERE nif=? ORDER BY id').all(nif);
  let prev = ''; const errors = [];
  for (const r of rows) {
    if ((r.prev_huella || '') !== prev || huellaAlta(r) !== r.huella) errors.push(r.num_serie);
    prev = r.huella;
  }
  return { nif, records: rows.length, ok: !errors.length, errors: errors.slice(0, 50), last_huella: prev };
}

module.exports = { SCHEMA, MODES, createAlta, huellaAlta, qrUrl, fechaES, amount, isoNow, registroAltaXml, envelope, parseResponse, simulatorResponse, createSender, verifyChain, certStatus, validNif };
