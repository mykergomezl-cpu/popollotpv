// Pruebas de VeriFactu: npm test
const test = require('node:test');
const assert = require('node:assert');
const vf = require('../verifactu');

test('huella: ejemplos oficiales de la AEAT', () => {
  const r1 = { nif: '89890001K', num_serie: '12345678/G33', fecha_expedicion: '01-01-2024', tipo_factura: 'F1', cuota_total: '12.35', importe_total: '123.45', prev_huella: '', fecha_hora_huso: '2024-01-01T19:20:30+01:00' };
  const h1 = vf.huellaAlta(r1);
  assert.strictEqual(h1, '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60');
  const h2 = vf.huellaAlta({ ...r1, num_serie: '12345679/G34', prev_huella: h1, fecha_hora_huso: '2024-01-01T19:20:35+01:00' });
  assert.strictEqual(h2, 'F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97');
});

test('validación de NIF y CIF', () => {
  for (const ok of ['12345678Z', 'B12345674', 'A58818501', 'X1234567L', '89890001K']) assert.ok(vf.validNif(ok), ok);
  for (const ko of ['', '12345678A', 'B12345675', 'ABC']) assert.ok(!vf.validNif(ko), ko);
});

const rec = (over = {}) => {
  const base = { id: 1, nif: 'B12345674', issuer_name: 'Rustidor & Cía <S.L.>', tipo_factura: 'F2', num_serie: 'AV01-2026-000001', fecha_expedicion: '19-11-2026',
    cuota_total: '1.05', importe_total: '11.50', fecha_hora_huso: '2026-11-19T20:00:00+01:00', prev_huella: '',
    data: JSON.stringify({ desglose: [{ tipo: 10, base: '10.45', cuota: '1.05' }], descripcion: 'Venta', prev: null, rectificada: null }), ...over };
  base.huella = vf.huellaAlta(base); return base;
};

test('sobre SOAP: estructura, escapado y encadenamiento', () => {
  const a = rec(); const b = rec({ id: 2, num_serie: 'AV01-R2026-000001', tipo_factura: 'R5', importe_total: '-11.50', cuota_total: '-1.05', prev_huella: a.huella,
    data: JSON.stringify({ desglose: [{ tipo: 10, base: '-10.45', cuota: '-1.05' }], descripcion: 'Devolución', prev: { nif: 'B12345674', num_serie: a.num_serie, fecha_expedicion: a.fecha_expedicion, huella: a.huella }, rectificada: { nif: 'B12345674', num_serie: a.num_serie, fecha_expedicion: a.fecha_expedicion } }) });
  const xml = vf.envelope('B12345674', a.issuer_name, [a, b], {}, false);
  assert.match(xml, /<sum1:PrimerRegistro>S<\/sum1:PrimerRegistro>/);
  assert.match(xml, new RegExp(`<sum1:Huella>${a.huella}</sum1:Huella></sum1:RegistroAnterior>`));
  assert.match(xml, /<sum1:TipoRectificativa>I<\/sum1:TipoRectificativa>/);
  assert.match(xml, /Rustidor &amp; Cía &lt;S\.L\.&gt;/);
  assert.strictEqual((xml.match(/<sum:RegistroFactura>/g) || []).length, 2);
});

test('respuesta: correcta y rechazada', () => {
  const ok = vf.parseResponse(vf.simulatorResponse(vf.envelope('B12345674', 'X', [rec()], {}, false)));
  assert.strictEqual(ok.estado, 'Correcto'); assert.strictEqual(ok.lineas[0].estado, 'Correcto'); assert.ok(ok.csv);
  const bad = vf.parseResponse(vf.simulatorResponse(vf.envelope('B12345675', 'X', [rec({ nif: 'B12345675' })], {}, false)));
  assert.strictEqual(bad.estado, 'Incorrecto'); assert.strictEqual(bad.lineas[0].codigo, '4104');
  const fault = vf.parseResponse('<env:Envelope xmlns:env="x"><env:Body><env:Fault><faultcode>env:Client</faultcode><faultstring>Codigo[4102].El XML no cumple el esquema</faultstring></env:Fault></env:Body></env:Envelope>');
  assert.match(fault.fault, /4102/);
});

test('URL del QR', () => {
  const u = vf.qrUrl('produccion', { nif: 'B12345674', num_serie: 'AV01-2026-000001', fecha: '19-11-2026', importe: '11.50' });
  assert.strictEqual(u, 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345674&numserie=AV01-2026-000001&fecha=19-11-2026&importe=11.50');
});
