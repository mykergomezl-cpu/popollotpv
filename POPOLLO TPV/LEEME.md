# POPOLLO TPV · Caja y gestión central

Sistema de caja (TPV) y administración para la red de pollerías POPOLLO (Rustidor Global S.L.).
Funciona en **Windows, Mac, tablets y móviles** desde el navegador, y se puede **instalar como app**
(Chrome o Edge → icono "Instalar" en la barra de direcciones).

## Arrancar

1. Instala **Node.js 22 o superior** (versión LTS): https://nodejs.org
2. Doble clic en:
   - Mac: `Arrancar POPOLLO (Mac).command`
   - Windows: `Arrancar POPOLLO (Windows).bat`
3. Se abre `http://localhost:8080`. Desde otros equipos de la misma red usa la dirección que aparece en la ventana (por ejemplo `http://192.168.1.20:8080`).

No hay que instalar nada más: la base de datos viene incluida en Node.js.

| Pantalla | Dirección | Quién |
|---|---|---|
| Caja (TPV) | `/tpv` | Cajeros y encargados |
| Administración | `/admin` | Administración y encargados |

> **Para subirlo a internet (Hostinger, GitHub):** sigue [DESPLIEGUE.md](DESPLIEGUE.md).

### Usuarios de prueba (solo en tu ordenador; en producción no se crean)

| Usuario | PIN | Rol |
|---|---|---|
| Administración | 1234 | admin (todo) |
| Encargado Avilés | 2222 | encargado |
| Caja 1 | 1111 | cajero |
| Caja 2 | 3333 | cajero |

Para empezar desde cero (borra todas las ventas): `npm run reset`.

## Qué hace

**TPV (pensado para que cualquiera lo use)**
- Botones grandes por categorías con los colores de la marca. Un toque añade el producto.
- Canales: Mostrador, Para llevar, A domicilio (con gastos de envío), Glovo, Uber Eats y Just Eat (precio de plataforma con el recargo del 30 %).
- Cobro en efectivo (calcula el cambio), tarjeta, Bizum y pago mixto. Pedidos "cobrar luego" para recogidas y domicilio.
- Tablero de pedidos: Preparando → Listo → En reparto → Entregado, con aviso de retraso a los 30 min.
- Ficha de cliente por teléfono (recuerda nombre y dirección).
- Devoluciones parciales o totales con factura rectificativa. Anulaciones, descuentos y salidas de dinero piden el PIN de un encargado.
- Apertura de caja, entradas y salidas de dinero, arqueo por billetes y monedas, informe Z impreso.
- Ticket de 80 mm (factura simplificada con desglose de IVA).
- Registro de mermas (pollo sobrante para aprovechamiento, quemado, caducado…).

**Administración**
- Panel de ventas por local, día, hora, canal y forma de pago, con cuenta de resultados por local.
- Carta y escandallos: coste de comida + packaging, % de coste, margen en local y margen en plataformas tras comisión. Menús compuestos por otros productos.
- Artículos: materias primas, packaging y elaboraciones (10 salsas y 6 adobos con su receta y rendimiento).
- Proveedores homologados.
- Compras: propuesta automática según stock mínimo, pedido imprimible, recepción con control de temperatura del pollo (0–4 °C). Al recibir se actualiza el stock y el coste, y los escandallos se recalculan solos.
- Stock por local: existencias, recuento de inventario, traspasos entre locales, movimientos y consumo teórico frente a compras.
- Locales (hasta 20, ampliable en Ajustes) con sus gastos fijos.
- Proyección de la red a 20 locales: ritmo de aperturas, escenarios del dossier (equilibrio, media, alta), reparto inversor 70 % / 40 %, cuota de gestión y comparación real frente a previsión.
- Exportación de ventas a CSV (Excel) para la gestoría.

Los datos iniciales (carta, precios, escandallos, salsas, adobos, packaging y proveedores) salen de los dossiers de noviembre de 2026.

## Para usarlo en 20 locales

Todos los locales deben trabajar contra **un mismo servidor**. Dos opciones:

1. **Servidor en la nube (recomendado):** un VPS pequeño (2 GB de RAM basta para 20 locales) con Node.js, HTTPS y copia de seguridad diaria de `data/popollo.db`. Cada local abre `https://caja.popollo.es/tpv` y la instala como app.
2. **Servidor en la oficina central** con IP fija o VPN hacia los locales.

Copia de seguridad: todo está en `data/popollo.db`. Cópialo a diario.

## VERI*FACTU (facturación verificable, obligatoria desde el 1 de enero de 2027)

Ya incluido:
- **Registro de facturación por cada ticket** con la huella SHA-256 oficial de la AEAT, encadenada con el registro anterior del mismo NIF. La fórmula se ha comprobado con los ejemplos publicados por la AEAT.
- Facturas simplificadas (**F2**) y devoluciones como rectificativas por diferencias (**R5**), que referencian la factura original.
- **Una sociedad por local** si hace falta: en Locales se puede poner la razón social y el NIF de cada local. Cada NIF lleva su propia cadena de registros.
- **Envío automático por servicio web SOAP** con certificado electrónico, con el control de flujo de la AEAT: espera el tiempo que indica la AEAT o hasta acumular 1.000 registros. Si no hay conexión, los tickets se siguen cobrando y los registros esperan en cola.
- **Código QR y leyenda «VERI*FACTU»** en cada ticket.
- Pantalla **Administración → VeriFactu**: modo de envío, estado del certificado, cola, envíos con su CSV, registros con su XML, reenvío de rechazados, comprobación de la cadena y **declaración responsable** lista para imprimir.
- **Simulador local** para probar todo el circuito sin certificado.

### Modos

| Modo | Qué hace |
|---|---|
| Desactivado | Genera y encadena los registros, pero no envía ni imprime el QR |
| Simulador local | Envía a un simulador del propio servidor. Sin validez fiscal |
| Pruebas AEAT | Envía al entorno de pruebas de la AEAT con tu certificado. Sin validez fiscal |
| Producción AEAT | Envío real |

### Certificado electrónico

Copia el certificado de la empresa (.p12 o .pfx) en la carpeta `data` y crea el archivo `data/verifactu.json`:

```json
{ "certificado": "certificado-empresa.p12", "password": "la-contraseña-del-certificado" }
```

La contraseña no se guarda en la base de datos ni se muestra en pantalla. También se pueden usar las variables de entorno `VERIFACTU_CERT` y `VERIFACTU_CERT_PASSWORD`. Protege la carpeta `data`: contiene el certificado y todas las ventas.

### Pasos para activarlo

1. Ajustes: razón social y **NIF real**. En Locales, el NIF de cada sociedad si los locales son sociedades distintas.
2. VeriFactu → datos del productor del sistema (Rustidor Global S.L., NIF, dirección). Imprime la **declaración responsable**, revísala con tu asesor, fírmala e indica la fecha.
3. Instala el certificado (ver arriba) y pon el modo **Pruebas AEAT**. Haz unas ventas y una devolución, y comprueba que los envíos salen **Correcto**.
4. Antes de pasar a **Producción**, empieza con la base limpia (`npm run reset`, después de volver a cargar tus datos) para que la primera factura real abra la cadena.

## Pendiente antes de abrir al público

- **Cambiar los PIN de prueba.**
- **Probar en el entorno de pruebas de la AEAT** con el certificado real. El XML que se envía y el formato de respuesta ya están validados contra los esquemas oficiales de la AEAT (SuministroLR.xsd y RespuestaSuministro.xsd); lo que queda es comprobar las reglas de negocio que solo aplica el servidor de Hacienda.
- **Pruebas automáticas:** `npm test` comprueba la huella con los ejemplos oficiales, el NIF, el XML y la lectura de respuestas. Ejecútalo después de cualquier cambio.
- **IVA de bebidas:** está al 10 % por defecto. Revisa con la gestoría el tipo de los refrescos azucarados en venta para llevar.
- **Impresora de tickets y cajón:** funciona con cualquier impresora térmica de 80 mm instalada en el sistema (diálogo de impresión del navegador). La apertura automática del cajón y la impresión sin diálogo necesitan un pequeño conector local.
- **Datáfono integrado y pedidos automáticos de Glovo/Uber/Just Eat** (Deliverect u Otter): hoy se marcan a mano en el TPV.
- **Modo sin conexión:** si cae internet en el local, el TPV no puede cobrar (si lo que falla es la conexión con la AEAT, sí cobra y envía después).
