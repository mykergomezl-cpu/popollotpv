#!/usr/bin/env bash
# Instalación de POPOLLO TPV en un VPS Ubuntu 22.04/24.04 (por ejemplo Hostinger KVM 1 o 2).
# Ejecutar en el VPS como root, dentro de la carpeta del programa (clonada de GitHub o descomprimida):
#   sudo bash deploy/instalar-vps.sh caja.tudominio.es tu@email.com
set -euo pipefail

DOMINIO="${1:?Indica el dominio, p. ej. caja.popollo.es}"
EMAIL="${2:?Indica un email para el certificado HTTPS}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR=/var/lib/popollo-tpv
APP_USER=popollo

echo "== 1/6 Paquetes del sistema"
apt-get update -y
apt-get install -y curl ca-certificates nginx certbot python3-certbot-nginx ufw

echo "== 2/6 Node.js 22"
if ! node -v 2>/dev/null | grep -qE '^v2[2-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2

echo "== 3/6 Usuario y carpeta de datos"
id "$APP_USER" &>/dev/null || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$DATA_DIR"
chown -R "$APP_USER:$APP_USER" "$DATA_DIR" "$APP_DIR"
chmod 700 "$DATA_DIR"

echo "== 4/6 Configuración (.env)"
if [ ! -f "$APP_DIR/.env" ]; then
  read -rsp "PIN para el usuario Administración (6 a 8 cifras): " PIN; echo
  [[ "$PIN" =~ ^[0-9]{6,8}$ ]] || { echo "PIN no válido"; exit 1; }
  cat > "$APP_DIR/.env" <<ENV
NODE_ENV=production
PORT=8080
HOST=127.0.0.1
TZ=Europe/Madrid
POPOLLO_DATA=$DATA_DIR
POPOLLO_ADMIN_PIN=$PIN
SESSION_DAYS=7
BACKUP_KEEP=30
ENV
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"; chmod 600 "$APP_DIR/.env"
fi

echo "== 5/6 Arranque con PM2"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && pm2 start ecosystem.config.js && pm2 save"
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" | tail -1 | bash || true

echo "== 6/6 nginx + HTTPS + cortafuegos"
sed "s/caja.tudominio.es/$DOMINIO/g" "$APP_DIR/deploy/nginx-popollo-tpv.conf" > /etc/nginx/sites-available/popollo-tpv
ln -sf /etc/nginx/sites-available/popollo-tpv /etc/nginx/sites-enabled/popollo-tpv
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot --nginx -d "$DOMINIO" -m "$EMAIL" --agree-tos --non-interactive --redirect
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable

echo
echo "Listo: https://$DOMINIO   (TPV: /tpv · Administración: /admin)"
echo "Datos y copias diarias en $DATA_DIR. Borra POPOLLO_ADMIN_PIN de $APP_DIR/.env tras el primer acceso."
