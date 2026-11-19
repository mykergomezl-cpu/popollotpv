// Base de datos POPOLLO TPV (SQLite integrado en Node.js >= 22.5)
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const os = require('node:os');
const PRODUCTION = process.env.NODE_ENV === 'production';
// En producción los datos van FUERA de la carpeta del programa, para que una nueva subida no los borre
const DATA_DIR = path.resolve(process.env.POPOLLO_DATA || (PRODUCTION ? path.join(os.homedir(), 'popollo-tpv-data') : path.join(__dirname, 'data')));
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'popollo.db');

function hashPin(pin, salt = crypto.randomBytes(8).toString('hex')) {
  const h = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${h}`;
}
function checkPin(pin, stored) {
  if (!stored) return false;
  const [salt, h] = stored.split(':');
  const test = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(test, 'hex'));
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  address TEXT, city TEXT, format TEXT DEFAULT 'Estándar 40 m²',
  status TEXT DEFAULT 'abierto',            -- proyecto | obra | abierto | cerrado
  opened_at TEXT, investment REAL DEFAULT 60000,
  rent REAL DEFAULT 1500, staff_cost REAL DEFAULT 5625, utilities REAL DEFAULT 500, other_fixed REAL DEFAULT 350,
  phone TEXT, active INTEGER DEFAULT 1,
  legal_name TEXT, nif TEXT                 -- sociedad que factura en este local (vacío = la empresa de Ajustes)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, pin TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cajero',      -- admin | encargado | cajero
  store_id INTEGER REFERENCES stores(id),   -- NULL = todos los locales
  color TEXT DEFAULT '#E2401B', active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')), last_seen TEXT
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT, contact TEXT,
  phone TEXT, email TEXT, cif TEXT, notes TEXT, active INTEGER DEFAULT 1
);

-- Artículos: materias primas, packaging y elaboraciones (salsas, adobos...)
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'ingrediente', -- ingrediente | packaging | elaboracion
  unit TEXT NOT NULL DEFAULT 'kg',          -- kg | l | ud
  cost REAL DEFAULT 0,                      -- coste por unidad sin IVA
  supplier_id INTEGER REFERENCES suppliers(id),
  purchase_unit TEXT, purchase_factor REAL DEFAULT 1, -- ej. caja de 100 ud -> factor 100
  yield_qty REAL DEFAULT 1,                 -- elaboraciones: cantidad que produce la receta
  min_stock REAL DEFAULT 0, notes TEXT, active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#FFC93C', sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, short_name TEXT,
  category_id INTEGER REFERENCES categories(id),
  price REAL NOT NULL DEFAULT 0,            -- PVP local IVA incluido
  price_delivery REAL,                      -- PVP plataformas IVA incl. (NULL = automático +recargo)
  vat REAL DEFAULT 10, color TEXT, sort INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1, notes TEXT
);

-- Escandallo: líneas de receta de un producto o de una elaboración
CREATE TABLE IF NOT EXISTS recipe_lines (
  id INTEGER PRIMARY KEY,
  parent_type TEXT NOT NULL,                -- product | item
  parent_id INTEGER NOT NULL,
  item_id INTEGER REFERENCES items(id),
  sub_product_id INTEGER REFERENCES products(id), -- para menús
  qty REAL NOT NULL DEFAULT 1,
  channel TEXT DEFAULT 'all'                -- all | delivery (packaging extra a domicilio)
);
CREATE INDEX IF NOT EXISTS ix_recipe_parent ON recipe_lines(parent_type, parent_id);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY, phone TEXT, name TEXT, address TEXT, notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS cash_sessions (
  id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id),
  opened_by INTEGER REFERENCES users(id), opened_at TEXT DEFAULT (datetime('now','localtime')),
  opening_float REAL DEFAULT 0,
  closed_by INTEGER REFERENCES users(id), closed_at TEXT,
  expected_cash REAL, counted_cash REAL, difference REAL, notes TEXT
);

CREATE TABLE IF NOT EXISTS cash_moves (
  id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
  type TEXT NOT NULL, amount REAL NOT NULL, reason TEXT,
  user_id INTEGER REFERENCES users(id), created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id),
  type TEXT NOT NULL DEFAULT 'venta',       -- venta | devolucion
  ref_order_id INTEGER REFERENCES orders(id),
  series TEXT, number INTEGER, full_number TEXT,
  channel TEXT NOT NULL DEFAULT 'local',    -- local | llevar | domicilio | glovo | ubereats | justeat
  status TEXT NOT NULL DEFAULT 'pagado',    -- pendiente | pagado | anulado
  kitchen_status TEXT DEFAULT 'entregado',  -- nuevo | preparando | listo | en_reparto | entregado
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT, customer_phone TEXT, customer_address TEXT,
  platform_ref TEXT, notes TEXT, refund_reason TEXT,
  discount_pct REAL DEFAULT 0,
  base REAL DEFAULT 0, vat_amount REAL DEFAULT 0, total REAL DEFAULT 0, cost REAL DEFAULT 0,
  user_id INTEGER REFERENCES users(id), cash_session_id INTEGER REFERENCES cash_sessions(id),
  created_at TEXT DEFAULT (datetime('now','localtime')), paid_at TEXT,
  prev_hash TEXT, hash TEXT
);
CREATE INDEX IF NOT EXISTS ix_orders_store_date ON orders(store_id, created_at);

CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER REFERENCES products(id), name TEXT NOT NULL,
  qty REAL NOT NULL, unit_price REAL NOT NULL, vat REAL DEFAULT 10,
  total REAL NOT NULL, unit_cost REAL DEFAULT 0, notes TEXT, ref_line_id INTEGER
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id),
  method TEXT NOT NULL,                     -- efectivo | tarjeta | bizum | plataforma
  amount REAL NOT NULL, given REAL, change REAL,
  cash_session_id INTEGER REFERENCES cash_sessions(id),
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS stock (
  store_id INTEGER NOT NULL REFERENCES stores(id), item_id INTEGER NOT NULL REFERENCES items(id),
  qty REAL DEFAULT 0, min_qty REAL, PRIMARY KEY (store_id, item_id)
);

CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL, item_id INTEGER NOT NULL,
  qty REAL NOT NULL, type TEXT NOT NULL,    -- compra | venta | devolucion | merma | inventario | traspaso
  unit_cost REAL, ref TEXT, note TEXT, user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_moves_store_date ON stock_moves(store_id, created_at);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  status TEXT DEFAULT 'borrador',           -- borrador | pedido | recibido | anulado
  invoice_ref TEXT, notes TEXT, total REAL DEFAULT 0,
  created_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')),
  expected_at TEXT, received_at TEXT, received_by INTEGER
);

CREATE TABLE IF NOT EXISTS purchase_lines (
  id INTEGER PRIMARY KEY, purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id), qty REAL NOT NULL, unit_cost REAL NOT NULL,
  received_qty REAL, temp_ok INTEGER
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, user_id INTEGER, store_id INTEGER, action TEXT, detail TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`;

// Ajustes que se añaden también a bases de datos ya existentes
const DEFAULT_SETTINGS = {
  verifactu_mode: 'desactivado',         // desactivado | simulador | pruebas | produccion
  verifactu_cert_type: 'personal',       // personal (certificado de persona/representante) | sello
  sif_name: 'POPOLLO TPV', sif_id: 'PT', sif_version: '1.1.0', sif_installation: 'CENTRAL-01',
  sif_producer_name: 'Rustidor Global S.L.', sif_producer_nif: '', sif_producer_address: '',
  sif_declaration_place: 'Avilés', sif_declaration_date: ''
};

function open({ reset = false } = {}) {
  if (reset && fs.existsSync(DB_FILE)) {
    for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  const isNew = !fs.existsSync(DB_FILE);
  const pin = process.env.POPOLLO_ADMIN_PIN || '';
  if (isNew && PRODUCTION && (!/^\d{6,8}$/.test(pin) || /^(\d)\1+$/.test(pin) || '0123456789'.includes(pin))) {
    throw new Error('Primera puesta en marcha en producción: define POPOLLO_ADMIN_PIN con un PIN de 6 a 8 cifras (no repetido ni consecutivo) para el usuario Administración.');
  }
  const db = new DatabaseSync(DB_FILE);
  db.exec(SCHEMA);
  // Migraciones suaves para bases de datos creadas con versiones anteriores
  for (const col of ['legal_name TEXT', 'nif TEXT']) { try { db.exec('ALTER TABLE stores ADD COLUMN ' + col); } catch { /* ya existe */ } }
  try { db.exec('ALTER TABLE sessions ADD COLUMN last_seen TEXT'); } catch { /* ya existe */ }
  const n = db.prepare('SELECT COUNT(*) n FROM settings').get().n;
  if (!n) seed(db);
  const def = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) def.run(k, v);
  return db;
}

function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---------------------------------------------------------------------------
// Datos iniciales tomados de los dossiers de POPOLLO (noviembre 2026)
// ---------------------------------------------------------------------------
function seed(db) {
  tx(db, () => {
    const set = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
    const settings = {
      company_name: 'Rustidor Global S.L.', brand: 'POPOLLO', company_nif: '',
      company_address: 'Avilés (Asturias)', ticket_footer: '¡Gracias por elegir POPOLLO! Déjanos tu reseña en Google 💛',
      default_vat: '10', delivery_surcharge_pct: '30', home_delivery_fee: '2.50',
      commission_glovo: '30', commission_ubereats: '30', commission_justeat: '30',
      management_fee_pct: '3', investor_share_stage1: '70', investor_share_stage2: '40',
      cost_update_mode: 'ultimo',            // ultimo | medio
      max_stores: '20'
    };
    for (const [k, v] of Object.entries(settings)) set.run(k, v);

    const st = db.prepare(`INSERT INTO stores(code,name,address,city,format,status,opened_at,investment,rent) VALUES(?,?,?,?,?,?,?,?,?)`);
    st.run('AV01', 'POPOLLO Avilés · Av. de Gijón', 'Avenida de Gijón (AS-19)', 'Avilés', 'Estándar 40 m²', 'abierto', '2026-12-01', 60000, 1500);
    st.run('AV02', 'POPOLLO Avilés · Lagos de Somiedo', 'C/ Lagos de Somiedo 1', 'Avilés', 'Estándar 40 m²', 'obra', null, 60000, 1500);

    const u = db.prepare('INSERT INTO users(name,pin,role,store_id,color) VALUES(?,?,?,?,?)');
    if (PRODUCTION) {
      // En internet no se crean usuarios de prueba: solo Administración, con el PIN de POPOLLO_ADMIN_PIN
      u.run('Administración', hashPin(process.env.POPOLLO_ADMIN_PIN), 'admin', null, '#2B1A12');
    } else {
      u.run('Administración', hashPin('1234'), 'admin', null, '#2B1A12');
      u.run('Encargado Avilés', hashPin('2222'), 'encargado', 1, '#E2401B');
      u.run('Caja 1', hashPin('1111'), 'cajero', 1, '#F29E0C');
      u.run('Caja 2', hashPin('3333'), 'cajero', 1, '#3D8B5A');
    }

    // Proveedores homologados (proveedores_popollo.pdf)
    const sp = db.prepare('INSERT INTO suppliers(name,category,notes) VALUES(?,?,?)');
    const S = {};
    for (const [key, name, cat, notes] of [
      ['avicola', 'Grupo Avícola VMR (Platos de Oro)', 'Pollo', 'Pollo calibre 13 (1,2-1,4 kg). Recepción 0-4 °C'],
      ['sada', 'Sada (Grupo Nutreco)', 'Pollo', 'Proveedor alternativo de volumen'],
      ['coren', 'Coren', 'Pollo', 'Cooperativa gallega'],
      ['especias', 'Funcional Foods / Vin Doré 24K', 'Adobos y salsas', 'Fórmulas maestras: salmueras, adobos y salsas'],
      ['dallant', 'Dallant / Calaf Angles', 'Especias', 'Ingredientes tecnológicos y aromas'],
      ['mccain', 'Eurofrits / McCain', 'Congelados', 'Patatas fritas aptas delivery'],
      ['audens', 'Audens Food / Gedesco', 'Quinta gama', 'Croquetas, canelones, empanadillas'],
      ['horeca', 'Distribuidor Horeca local', 'Alimentación', 'Mayonesa, aceites, verduras, lácteos, bebidas'],
      ['hinojosa', 'Envases Hinojosa / Grupo Lantero', 'Packaging', 'Cajas de cartón ondulado ventiladas'],
      ['garciapou', 'García de Pou / Packix', 'Packaging', 'Envases kraft antigrasa y bolsas de papel'],
      ['qpack', 'Punto Qpack', 'Packaging', 'Impresión con marca (Amarillo #FFC93C)'],
      ['bebidas', 'Distribuidor de bebidas', 'Bebidas', 'Refrescos y agua']
    ]) { S[key] = Number(sp.run(name, cat, notes).lastInsertRowid); }

    // Artículos ------------------------------------------------------------
    const it = db.prepare('INSERT INTO items(name,kind,unit,cost,supplier_id,yield_qty,min_stock,notes) VALUES(?,?,?,?,?,?,?,?)');
    const I = {};
    const addItem = (key, name, kind, unit, cost, sup, min = 0, yieldQty = 1, notes = null) => {
      I[key] = Number(it.run(name, kind, unit, cost, sup ? S[sup] : null, yieldQty, min, notes).lastInsertRowid);
    };
    // Materias primas (precios mayorista España 2026, sin IVA)
    addItem('pollo', 'Pollo limpio calibre 13', 'ingrediente', 'kg', 2.90, 'avicola', 60, 1, 'Calibre 13: 1,2-1,4 kg. Recepción a 0-4 °C');
    addItem('pollo_aprov', 'Pollo asado desmenuzado (aprovechamiento)', 'ingrediente', 'kg', 0, null, 0, 1, 'Sobrante del día desmenuzado y congelado. Coste 0 (ya imputado como merma)');
    addItem('sal', 'Sal', 'ingrediente', 'kg', 0.40, 'horeca', 5);
    addItem('ajo_polvo', 'Ajo en polvo', 'ingrediente', 'kg', 9.00, 'dallant', 1);
    addItem('pimenton', 'Pimentón dulce', 'ingrediente', 'kg', 9.00, 'dallant', 1);
    addItem('pimenton_ahum', 'Pimentón ahumado', 'ingrediente', 'kg', 11.00, 'dallant', 1);
    addItem('pimienta', 'Pimienta negra molida', 'ingrediente', 'kg', 18.00, 'dallant', 0.5);
    addItem('hierbas', 'Tomillo y romero secos', 'ingrediente', 'kg', 16.00, 'dallant', 0.5);
    addItem('oregano', 'Orégano seco', 'ingrediente', 'kg', 12.00, 'dallant', 0.5);
    addItem('comino', 'Comino molido', 'ingrediente', 'kg', 10.00, 'dallant', 0.5);
    addItem('cayena', 'Cayena', 'ingrediente', 'kg', 14.00, 'dallant', 0.3);
    addItem('cebolla_polvo', 'Cebolla en polvo', 'ingrediente', 'kg', 8.00, 'dallant', 0.5);
    addItem('aji_panca', 'Ají panca en pasta', 'ingrediente', 'kg', 12.00, 'especias', 0.5);
    addItem('limon', 'Zumo de limón', 'ingrediente', 'l', 1.50, 'horeca', 3);
    addItem('soja', 'Salsa de soja', 'ingrediente', 'l', 2.50, 'horeca', 2);
    addItem('cerveza', 'Cerveza negra', 'ingrediente', 'l', 2.00, 'horeca', 1);
    addItem('vinagre', 'Vinagre de vino', 'ingrediente', 'l', 0.95, 'horeca', 2);
    addItem('vinagre_manz', 'Vinagre de manzana', 'ingrediente', 'l', 1.20, 'horeca', 1);
    addItem('aceite_gir', 'Aceite de girasol', 'ingrediente', 'l', 1.60, 'horeca', 20);
    addItem('aceite_oliva', 'Aceite de oliva virgen extra', 'ingrediente', 'l', 7.50, 'horeca', 3);
    addItem('bbq_com', 'Salsa barbacoa comercial', 'ingrediente', 'kg', 2.40, 'especias', 3);
    addItem('humo', 'Humo líquido', 'ingrediente', 'l', 12.00, 'especias', 0.3);
    addItem('yogur', 'Yogur natural', 'ingrediente', 'kg', 1.80, 'horeca', 2);
    addItem('mayonesa', 'Mayonesa comercial', 'ingrediente', 'l', 2.80, 'horeca', 10);
    addItem('cilantro', 'Cilantro fresco', 'ingrediente', 'kg', 8.00, 'horeca', 0.3);
    addItem('albahaca', 'Albahaca fresca', 'ingrediente', 'kg', 12.00, 'horeca', 0.2);
    addItem('perejil', 'Perejil fresco', 'ingrediente', 'kg', 6.00, 'horeca', 0.3);
    addItem('ajo', 'Ajo pelado', 'ingrediente', 'kg', 4.00, 'horeca', 1);
    addItem('ajo_cabeza', 'Ajo en cabeza', 'ingrediente', 'kg', 3.50, 'horeca', 1);
    addItem('tomate', 'Tomate maduro', 'ingrediente', 'kg', 1.80, 'horeca', 5);
    addItem('cebolla', 'Cebolla blanca', 'ingrediente', 'kg', 1.10, 'horeca', 5);
    addItem('jalapeno', 'Chile jalapeño', 'ingrediente', 'kg', 3.20, 'horeca', 0.5);
    addItem('choricero', 'Pulpa de pimiento choricero', 'ingrediente', 'kg', 4.50, 'horeca', 0.5);
    addItem('mostaza', 'Mostaza clásica', 'ingrediente', 'l', 2.10, 'horeca', 2);
    addItem('miel', 'Miel multifloral', 'ingrediente', 'kg', 5.50, 'horeca', 2);
    addItem('ketchup', 'Ketchup hostelería', 'ingrediente', 'l', 1.90, 'horeca', 5);
    addItem('azucar_moreno', 'Azúcar moreno', 'ingrediente', 'kg', 1.80, 'horeca', 1);
    addItem('azucar', 'Azúcar blanco', 'ingrediente', 'kg', 1.10, 'horeca', 3);
    addItem('naranja', 'Zumo de naranja', 'ingrediente', 'l', 1.40, 'horeca', 2);
    addItem('maicena', 'Maicena', 'ingrediente', 'kg', 2.20, 'horeca', 0.5);
    addItem('leche_evap', 'Leche evaporada', 'ingrediente', 'l', 2.10, 'horeca', 1);
    addItem('cheddar', 'Queso cheddar rallado', 'ingrediente', 'kg', 6.50, 'horeca', 1);
    addItem('quesitos', 'Queso fundido en porciones', 'ingrediente', 'kg', 4.00, 'horeca', 0.5);
    addItem('caldo', 'Caldo de ave', 'ingrediente', 'l', 0.90, 'horeca', 3);
    addItem('margarina', 'Margarina vegetal', 'ingrediente', 'kg', 2.40, 'horeca', 0.5);
    addItem('harina', 'Harina de trigo', 'ingrediente', 'kg', 0.85, 'horeca', 2);
    addItem('patata', 'Patata fresca', 'ingrediente', 'kg', 0.90, 'horeca', 30);
    addItem('patata_cong', 'Patata frita congelada', 'ingrediente', 'kg', 1.60, 'mccain', 20);
    addItem('arroz', 'Arroz', 'ingrediente', 'kg', 1.20, 'horeca', 10);
    addItem('col', 'Col / repollo', 'ingrediente', 'kg', 0.90, 'horeca', 3);
    addItem('zanahoria', 'Zanahoria', 'ingrediente', 'kg', 0.80, 'horeca', 2);
    addItem('pan_burger', 'Pan brioche hamburguesa', 'ingrediente', 'ud', 0.35, 'horeca', 20);
    addItem('lechuga', 'Lechuga', 'ingrediente', 'kg', 2.00, 'horeca', 1);
    addItem('croqueta_base', 'Bechamel / base croquetas (5ª gama)', 'ingrediente', 'kg', 3.20, 'audens', 2);
    addItem('pan_rallado', 'Pan rallado', 'ingrediente', 'kg', 1.50, 'horeca', 1);
    addItem('placa_canelon', 'Placas de canelón', 'ingrediente', 'ud', 0.08, 'audens', 30);
    addItem('obleas', 'Obleas empanadilla', 'ingrediente', 'ud', 0.07, 'audens', 30);
    addItem('queso_rallado', 'Queso rallado gratinar', 'ingrediente', 'kg', 5.50, 'horeca', 1);
    addItem('coulant', 'Coulant de chocolate (ud)', 'ingrediente', 'ud', 1.10, 'horeca', 10);
    addItem('tarta_queso', 'Tarta de queso (porción)', 'ingrediente', 'ud', 1.30, 'horeca', 10);
    addItem('refresco', 'Refresco lata 33 cl', 'ingrediente', 'ud', 0.45, 'bebidas', 48);
    addItem('agua', 'Agua mineral 50 cl', 'ingrediente', 'ud', 0.20, 'bebidas', 48);
    // Packaging (sin plásticos cerrados: cartón ventilado y kraft)
    addItem('caja_pollo', 'Caja cartón ventilada pollo entero', 'packaging', 'ud', 0.22, 'hinojosa', 200);
    addItem('caja_termica', 'Envase térmico alta resistencia', 'packaging', 'ud', 0.25, 'hinojosa', 50);
    addItem('caja_medio', 'Caja cartón ventilada ½ pollo', 'packaging', 'ud', 0.16, 'hinojosa', 100);
    addItem('envase_kraft', 'Envase kraft antigrasa guarnición', 'packaging', 'ud', 0.12, 'garciapou', 200);
    addItem('tarrina', 'Tarrina salsa 50 ml + tapa', 'packaging', 'ud', 0.04, 'garciapou', 500);
    addItem('vaso', 'Vaso cartón 350 ml + tapa', 'packaging', 'ud', 0.09, 'garciapou', 100);
    addItem('bolsa_kraft', 'Bolsa papel kraft asas', 'packaging', 'ud', 0.08, 'qpack', 300);
    addItem('kit_cubiertos', 'Kit servilleta + cubiertos madera', 'packaging', 'ud', 0.05, 'garciapou', 300);
    addItem('precinto', 'Pegatina precinto de seguridad', 'packaging', 'ud', 0.02, 'qpack', 500);
    addItem('papel_burger', 'Papel antigrasa hamburguesa', 'packaging', 'ud', 0.03, 'garciapou', 200);

    // Elaboraciones (adobos para 10 pollos, salsas para 1 litro) ------------
    const rl = db.prepare('INSERT INTO recipe_lines(parent_type,parent_id,item_id,sub_product_id,qty,channel) VALUES(?,?,?,?,?,?)');
    const elab = (key, name, unit, yieldQty, lines, notes) => {
      addItem(key, name, 'elaboracion', unit, 0, null, 0, yieldQty, notes);
      for (const [k, q] of lines) rl.run('item', I[key], I[k], null, q, 'all');
    };
    elab('adobo_trad', 'Salmuera Tradicional (10 pollos)', 'ud', 10, [['sal', .12], ['ajo_polvo', .03], ['pimenton', .02], ['pimienta', .01], ['hierbas', .015], ['limon', .05]], 'Reposo 12-24 h en cámara. Recipiente VERDE.');
    elab('adobo_peru', 'Adobo Peruano (10 pollos)', 'ud', 10, [['soja', .3], ['cerveza', .1], ['ajo_polvo', .04], ['comino', .03], ['aji_panca', .02], ['oregano', .015], ['sal', .02], ['vinagre', .04]], '24 h en frío. Recipiente ROJO.');
    elab('adobo_limon', 'Salmuera Limón y Finas Hierbas (10 pollos)', 'ud', 10, [['sal', .12], ['limon', .6], ['ajo_polvo', .03], ['cebolla_polvo', .025], ['hierbas', .04]], '12-16 h. Recipiente AMARILLO.');
    elab('adobo_bbq', 'Salmuera base + lacado BBQ (10 pollos)', 'ud', 10, [['sal', .12], ['ajo_polvo', .03], ['pimenton', .02], ['bbq_com', 1.2], ['humo', .012]], 'Lacar con brocha a falta de 15 min. Recipiente AMARILLO.');
    elab('adobo_peri', 'Adobo Peri-Peri (10 pollos)', 'ud', 10, [['sal', .1], ['ajo_polvo', .04], ['pimenton_ahum', .04], ['cayena', .015], ['vinagre', .05], ['aceite_gir', .05]], '18 h. Recipiente ROJO.');
    elab('adobo_arabe', 'Adobo Árabe Shish Taouk (10 pollos)', 'ud', 10, [['yogur', 1.2], ['ajo', .15], ['limon', .1], ['comino', .02], ['pimenton', .03], ['sal', .1], ['aceite_oliva', .1], ['mayonesa', .2]], 'Yogur, especias y crema de ajo. Recipiente AMARILLO.');
    elab('s_verde', 'Salsa Verde de Pollería (1 L)', 'l', 1, [['mayonesa', .85], ['cilantro', .05], ['albahaca', .02], ['ajo', .015], ['limon', .03]], '5 min, sin cocción.');
    elab('s_ajo', 'Mayonesa de Ajo Asado (1 L)', 'l', 1, [['mayonesa', .95], ['ajo_cabeza', .1], ['aceite_oliva', .015]], '30 min horno 180 °C + 5 min.');
    elab('s_tomate', 'Salsa de Tomate Asado "Tatemada" (1 L)', 'l', 1, [['tomate', .7], ['cebolla', .15], ['jalapeno', .08], ['limon', .04], ['aceite_gir', .03], ['sal', .02], ['ajo', .01]], '10 min. Servir fría.');
    elab('s_mojo', 'Mojo Picón Rojo (1 L)', 'l', 1, [['aceite_gir', .6], ['vinagre', .15], ['ajo', .06], ['choricero', .15], ['pimenton', .01], ['comino', .005], ['sal', .01]], '10 min.');
    elab('s_chimi', 'Chimichurri de la Casa (1 L)', 'l', 1, [['aceite_gir', .5], ['aceite_oliva', .15], ['vinagre', .2], ['perejil', .06], ['ajo', .04], ['oregano', .01], ['pimenton', .005], ['sal', .005]], '24 h de reposo.');
    elab('s_mostaza', 'Salsa Mostaza y Miel (1 L)', 'l', 1, [['mostaza', .45], ['miel', .45], ['vinagre', .05], ['aceite_gir', .05]], '5 min.');
    elab('s_bbq', 'Salsa Barbacoa al Caramelo (1 L)', 'l', 1, [['ketchup', .7], ['vinagre_manz', .08], ['azucar_moreno', .08], ['soja', .03], ['humo', .005], ['cebolla_polvo', .005], ['ajo_polvo', .005]], '20 min de cocción.');
    elab('s_agridulce', 'Crema Agridulce Naranja y Soja (1 L)', 'l', 1, [['naranja', .75], ['soja', .15], ['azucar', .1], ['maicena', .03]], '15 min de cocción.');
    elab('s_cheddar', 'Salsa de Queso Cheddar (1 L)', 'l', 1, [['leche_evap', .5], ['cheddar', .3], ['quesitos', .2]], '10 min.');
    elab('s_gravy', 'Salsa de Carne / Gravy (1 L)', 'l', 1, [['caldo', .6], ['margarina', .05], ['harina', .05], ['sal', .005]], 'Con 300 ml de jugos recuperados del asador (coste 0).');

    // Categorías y carta ---------------------------------------------------
    const cat = db.prepare('INSERT INTO categories(name,color,sort) VALUES(?,?,?)');
    const C = {};
    for (const [k, n, c, s] of [
      ['pollos', 'Pollos', '#E2401B', 1], ['menus', 'Menús', '#2B1A12', 2], ['guarn', 'Guarniciones', '#F29E0C', 3],
      ['salsas', 'Salsas', '#FFC93C', 4], ['aprov', 'De la casa', '#B5651D', 5], ['postres', 'Postres', '#C2185B', 6],
      ['bebidas', 'Bebidas', '#1E88E5', 7]
    ]) C[k] = Number(cat.run(n, c, s).lastInsertRowid);

    const pr = db.prepare('INSERT INTO products(name,short_name,category_id,price,vat,color,sort) VALUES(?,?,?,?,?,?,?)');
    const P = {};
    const prod = (key, name, short, c, price, lines, sort = 0, vat = 10) => {
      P[key] = Number(pr.run(name, short, C[c], price, vat, null, sort).lastInsertRowid);
      for (const l of lines) {
        const [k, q, ch = 'all'] = l;
        if (k.startsWith('P:')) rl.run('product', P[key], null, P[k.slice(2)], q, ch);
        else rl.run('product', P[key], I[k], null, q, ch);
      }
    };
    const DEL = [['bolsa_kraft', 1, 'delivery'], ['kit_cubiertos', 1, 'delivery'], ['precinto', 1, 'delivery']];
    prod('p_trad', 'Pollo Tradicional (de la abuela)', 'Tradicional', 'pollos', 11.50, [['pollo', 1.3], ['adobo_trad', 1], ['caja_pollo', 1], ...DEL], 1);
    prod('p_peru', 'Pollo Peruano', 'Peruano', 'pollos', 13.90, [['pollo', 1.3], ['adobo_peru', 1], ['caja_termica', 1], ...DEL], 2);
    prod('p_limon', 'Pollo Limón y Finas Hierbas', 'Limón', 'pollos', 11.90, [['pollo', 1.3], ['adobo_limon', 1], ['caja_pollo', 1], ...DEL], 3);
    prod('p_bbq', 'Pollo Barbacoa Ahumada', 'Barbacoa', 'pollos', 12.50, [['pollo', 1.3], ['adobo_bbq', 1], ['caja_pollo', 1], ...DEL], 4);
    prod('p_peri', 'Pollo Peri-Peri', 'Peri-Peri', 'pollos', 12.90, [['pollo', 1.3], ['adobo_peri', 1], ['caja_pollo', 1], ...DEL], 5);
    prod('p_arabe', 'Pollo Árabe (Shish Taouk)', 'Árabe', 'pollos', 13.50, [['pollo', 1.3], ['adobo_arabe', 1], ['caja_pollo', 1], ...DEL], 6);
    prod('p_medio', '½ Pollo Tradicional', '½ Tradicional', 'pollos', 6.50, [['pollo', .65], ['adobo_trad', .5], ['caja_medio', 1], ...DEL], 7);

    prod('g_asadas', 'Patatas asadas', 'Pat. asadas', 'guarn', 2.90, [['patata', .35], ['aceite_gir', .01], ['sal', .003], ['envase_kraft', 1]], 1);
    prod('g_fritas', 'Patatas fritas', 'Pat. fritas', 'guarn', 2.50, [['patata_cong', .25], ['aceite_gir', .02], ['sal', .002], ['envase_kraft', 1]], 2);
    prod('g_arroz', 'Arroz con ajo', 'Arroz', 'guarn', 2.80, [['arroz', .12], ['ajo', .008], ['aceite_gir', .01], ['caldo', .2], ['envase_kraft', 1]], 3);
    prod('g_col', 'Ensalada de col', 'Ens. col', 'guarn', 3.20, [['col', .2], ['zanahoria', .05], ['mayonesa', .05], ['vinagre', .005], ['envase_kraft', 1]], 4);

    const sauces = [['s_verde', 'Salsa Verde', 'Verde'], ['s_ajo', 'Mayonesa de Ajo Asado', 'Mayo ajo'], ['s_tomate', 'Salsa de Tomate Asado', 'Tomate'],
      ['s_mojo', 'Mojo Picón', 'Mojo'], ['s_chimi', 'Chimichurri', 'Chimichurri'], ['s_mostaza', 'Mostaza y Miel', 'Most. miel'],
      ['s_bbq', 'Salsa Barbacoa', 'Barbacoa'], ['s_agridulce', 'Salsa Agridulce', 'Agridulce'], ['s_cheddar', 'Salsa Cheddar', 'Cheddar'], ['s_gravy', 'Salsa de Carne', 'S. carne']];
    sauces.forEach(([k, n, s], i) => prod('ps_' + k, n, s, 'salsas', 1.20, [[k, .05], ['tarrina', 1]], i + 1));

    prod('a_burger', 'Hamburguesa de pollo desmenuzado', 'Burger pollo', 'aprov', 7.50, [['pollo_aprov', .15], ['pan_burger', 1], ['cheddar', .02], ['lechuga', .02], ['s_ajo', .03], ['papel_burger', 1], ['envase_kraft', 1]], 1);
    prod('a_croq', '6 Croquetas de asador', 'Croquetas', 'aprov', 5.90, [['pollo_aprov', .08], ['croqueta_base', .15], ['pan_rallado', .03], ['aceite_gir', .03], ['envase_kraft', 1]], 2);
    prod('a_canel', 'Canelones gratinados', 'Canelones', 'aprov', 6.90, [['pollo_aprov', .12], ['placa_canelon', 6], ['croqueta_base', .12], ['queso_rallado', .03], ['envase_kraft', 1]], 3);
    prod('a_empa', '3 Empanadillas criollas', 'Empanadillas', 'aprov', 4.80, [['pollo_aprov', .06], ['obleas', 3], ['cebolla', .03], ['aceite_gir', .03], ['envase_kraft', 1]], 4);

    prod('d_coulant', 'Coulant de chocolate', 'Coulant', 'postres', 3.90, [['coulant', 1], ['envase_kraft', 1]], 1);
    prod('d_tarta', 'Tarta de queso', 'Tarta queso', 'postres', 4.20, [['tarta_queso', 1], ['envase_kraft', 1]], 2);

    prod('b_limonada', 'Limonada casera 350 ml', 'Limonada', 'bebidas', 2.90, [['limon', .06], ['azucar', .03], ['vaso', 1]], 1);
    prod('b_refresco', 'Refresco lata', 'Refresco', 'bebidas', 2.20, [['refresco', 1]], 2);
    prod('b_agua', 'Agua mineral', 'Agua', 'bebidas', 1.60, [['agua', 1]], 3);

    prod('m_familiar', 'Menú Familiar (pollo + 2 guarn. + 2 salsas)', 'Familiar', 'menus', 19.90,
      [['P:p_trad', 1], ['P:g_asadas', 1], ['P:g_col', 1], ['P:ps_s_verde', 1], ['P:ps_s_ajo', 1], ...DEL], 1);
    prod('m_mediodia', 'Menú Mediodía (½ pollo + patatas + bebida)', 'Mediodía', 'menus', 9.90,
      [['P:p_medio', 1], ['P:g_fritas', 1], ['P:b_refresco', 1], ...DEL], 2);
    prod('m_burger', 'Menú Burger (burger + patatas + bebida)', 'Menú burger', 'menus', 10.50,
      [['P:a_burger', 1], ['P:g_fritas', 1], ['P:b_refresco', 1], ...DEL], 3);

    // Stock inicial del local abierto
    const stk = db.prepare('INSERT INTO stock(store_id,item_id,qty) VALUES(?,?,?)');
    const items = db.prepare("SELECT id, min_stock FROM items WHERE kind != 'elaboracion'").all();
    for (const s of db.prepare('SELECT id FROM stores').all())
      for (const i of items) stk.run(s.id, i.id, s.id === 1 ? Math.round(i.min_stock * 2 * 100) / 100 : 0);
  });
}

module.exports = { open, tx, hashPin, checkPin, DB_FILE, DATA_DIR, PRODUCTION };
