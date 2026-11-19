# Subir POPOLLO TPV a internet

El TPV es un programa Node.js con su propia base de datos (un archivo SQLite). No basta con un hosting "solo web" (`public_html`): necesita un plan que **ejecute Node.js 22.13 o superior** y que **conserve archivos** entre reinicios.

| Opción | Plan Hostinger | Para quién |
|---|---|---|
| **A. VPS (recomendada para 20 locales)** | VPS KVM 1 o KVM 2 | Control total, copias, VeriFactu con certificado, dominio propio con HTTPS |
| **B. Node.js Web Apps** | Business o Cloud (el que ya usas para la web) | Lo más rápido para empezar y probar |
| **C. Docker** | VPS con plantilla Docker | Si prefieres contenedores |

En las tres, el código puede venir de **GitHub** (recomendado) o de un **zip**.

> **Antes de nada**
> - Los datos (ventas, clientes, copias, certificado) **no se suben nunca** a GitHub ni van en el zip: `.gitignore` y `npm run zip` los excluyen.
> - En producción (`NODE_ENV=production`) **no se crean los usuarios de prueba**. Solo se crea "Administración", con el PIN que indiques en `POPOLLO_ADMIN_PIN` (6 a 8 cifras). Después crea los cajeros y encargados desde Administración → Usuarios.
> - El repositorio de GitHub debe ser **privado**: contiene tus escandallos, precios y proveedores.

---

## 1. Subirlo a GitHub

1. En github.com → **New repository** → nombre `popollo-tpv` → **Private** → Create (sin README).
2. En el Mac, en la carpeta `POPOLLO TPV` (el repositorio ya está creado, rama `main`). Si es la primera vez que usas Git en este Mac, indica tu nombre y tu email:

```bash
git config --global user.name "Tu Nombre"
```

```bash
git config --global user.email "tu@email.com"
```

Después:

```bash
git add -A
```

```bash
git commit -m "POPOLLO TPV 1.2.0"
```

```bash
git branch -M main
```

```bash
git remote add origin https://github.com/TU-USUARIO/popollo-tpv.git
```

```bash
git push -u origin main
```

GitHub pedirá usuario y un *token* (Settings → Developer settings → Personal access tokens) en lugar de la contraseña. Cada vez que subas cambios, GitHub ejecuta las pruebas automáticas (pestaña **Actions**).

---

## 2. Opción A · VPS de Hostinger (recomendada)

1. Contrata un **VPS KVM 1** (o KVM 2 si vas a muchos locales) con **Ubuntu 24.04**.
2. En tu DNS (Hostinger → Dominios → DNS), crea un registro **A** `caja` → IP del VPS. Quedará en `caja.tudominio.es`.
3. Entra al VPS (hPanel → VPS → Terminal del navegador, o `ssh root@IP`) y descarga el programa:

```bash
git clone https://github.com/TU-USUARIO/popollo-tpv.git /opt/popollo-tpv
```

4. Ejecuta el instalador: instala Node 22, PM2, nginx, el certificado HTTPS gratuito y el cortafuegos, y te pide el PIN de Administración.

```bash
sudo bash /opt/popollo-tpv/deploy/instalar-vps.sh caja.tudominio.es tu@email.com
```

5. Abre `https://caja.tudominio.es/admin`, entra con el PIN, rellena **Ajustes** (NIF, razón social) y crea locales y usuarios. Después borra la línea `POPOLLO_ADMIN_PIN` de `/opt/popollo-tpv/.env`.

**Actualizar** tras subir cambios a GitHub:

```bash
cd /opt/popollo-tpv && sudo -u popollo git pull && sudo -u popollo pm2 restart popollo-tpv
```

**Datos:** en `/var/lib/popollo-tpv`, con una copia diaria automática en `copias/`. Para el certificado de VeriFactu, copia ahí el `.p12` y crea `verifactu.json` (ver LEEME).

---

## 3. Opción B · Hostinger Node.js Web Apps (plan Business o Cloud)

Es el mismo sistema que usaste para la web de POPOLLO.

1. hPanel → **Websites** → **Add website** → **Node.js Web App**.
2. Origen del código:
   - **GitHub:** conecta tu cuenta y elige el repositorio `popollo-tpv`, rama `main`. Cada push se despliega solo.
   - **Zip:** en el Mac ejecuta el comando de abajo y sube `subir-a-hostinger/popollo-tpv-nodejs.zip`.

```bash
npm run zip
```

3. Configuración de la app:
   - **Versión de Node:** 22 (como mínimo 22.13). Si no aparece la 22, este plan no sirve: usa el VPS.
   - **Comando de arranque:** `npm start` (o archivo de entrada `server.js`).
   - **Comando de build:** `npm run build` (no compila nada; está para que Hostinger no falle).
4. **Variables de entorno** (sección Environment variables):
   - `NODE_ENV` = `production`
   - `POPOLLO_ADMIN_PIN` = tu PIN de 6 a 8 cifras (bórrala tras el primer acceso)
   - `POPOLLO_DATA` = una carpeta **fuera** de la de la app, por ejemplo `/home/TU_USUARIO/popollo-tpv-data`. Si no la pones, se usa `~/popollo-tpv-data`.
   - `TZ` = `Europe/Madrid`
   - No pongas `PORT` ni `HOST`: Hostinger asigna el puerto.
5. Despliega y abre el dominio que te asigne, con `/admin` o `/tpv`.

**Comprueba que los datos sobreviven:** haz una venta de prueba, vuelve a desplegar y mira que sigue en Administración → Tickets. Si se pierde, la carpeta de datos no es persistente en tu plan: usa el VPS.

---

## 4. Opción C · Docker (VPS con plantilla Docker)

```bash
git clone https://github.com/TU-USUARIO/popollo-tpv.git && cd popollo-tpv
```

```bash
echo "POPOLLO_ADMIN_PIN=482915" > .env && docker compose up -d --build
```

Los datos quedan en `./popollo-data`. Pon nginx (archivo `deploy/nginx-popollo-tpv.conf`) y certbot delante para el HTTPS.

---

## 5. En cada local

1. Abre `https://caja.tudominio.es/tpv` en Chrome o Edge y pulsa **Instalar** en la barra de direcciones: queda como una aplicación en Windows o Mac.
2. Elige el local una vez (lo pide la primera vez) y entra con el PIN de cada cajero.
3. Impresora de tickets térmica de 80 mm: instálala en el ordenador como impresora predeterminada.

## Seguridad incluida

- **PIN con bloqueo:** después de 5 PIN fallidos se bloquea ese usuario y esa IP durante 1, 2, 4… hasta 30 minutos. Los fallos quedan registrados en Últimas acciones.
- **PIN mínimos:** en producción, administración y encargados necesitan al menos 6 cifras. No se aceptan PIN repetidos (111111) ni consecutivos (123456).
- **Sesiones:** caducan tras `SESSION_DAYS` días sin uso (7 por defecto).
- **Cabeceras de seguridad del navegador** (CSP, HSTS…) y HTTPS obligatorio en el VPS.
- **Copia diaria automática** y botón **Descargar copia ahora** en Administración → Ajustes. Guarda copias también fuera del servidor.
- **Comprobación de que el servidor está vivo:** `https://caja.tudominio.es/api/health`.
