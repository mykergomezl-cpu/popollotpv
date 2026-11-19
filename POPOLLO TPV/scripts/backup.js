// Copia de seguridad manual o programada (cron): npm run backup
// Crea <carpeta de datos>/copias/popollo-AAAAMMDDHHMM.db sin parar el servidor.
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { DB_FILE, DATA_DIR } = require('../db');

if (!fs.existsSync(DB_FILE)) { console.error('No hay base de datos en', DB_FILE); process.exit(1); }
const dir = path.join(DATA_DIR, 'copias');
fs.mkdirSync(dir, { recursive: true });
const d = new Date(); const p = (x) => String(x).padStart(2, '0');
const file = path.join(dir, `popollo-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}.db`);
const db = new DatabaseSync(DB_FILE);
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
db.close();
console.log('Copia creada:', file);
