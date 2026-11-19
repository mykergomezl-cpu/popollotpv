// Crea subir-a-hostinger/popollo-tpv-nodejs.zip para Hostinger › Node.js Web Apps
// Uso: npm run zip   (necesita el comando "zip", incluido en macOS y Linux)
const { execSync } = require('node:child_process');
const { mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'subir-a-hostinger');
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
const exclude = ['data/*', 'popollo-data/*', 'node_modules/*', '.git/*', 'subir-a-hostinger/*', '*.db', '*.db-*', '*.p12', '*.pfx', '*verifactu.json', '.env', '*.DS_Store'];
execSync(`zip -qr subir-a-hostinger/popollo-tpv-nodejs.zip . -x ${exclude.map((e) => `"${e}"`).join(' ')}`, { cwd: root, stdio: 'inherit' });
console.log('Listo: subir-a-hostinger/popollo-tpv-nodejs.zip (sin datos, sin certificados, sin .env)');
