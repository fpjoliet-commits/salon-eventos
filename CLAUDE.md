# Salón de Eventos — CRM

Sistema de gestión de clientes y eventos para un salón de fiestas. App web fullstack deployada en Render.

## Stack

- **Backend:** Node.js + Express, JWT auth, Google Sheets como base de datos
- **Frontend:** HTML/CSS/JS vanilla (sin frameworks), sirve desde el mismo backend
- **Storage:** Google Sheets vía `googleapis` — fallback en memoria si no hay credenciales
- **Deploy:** Render — start command: `node backend/server.js`
- **Dev local:** `start.bat` o `node backend/server.js` desde la raíz

## Estructura

```
salon-eventos/
  backend/
    server.js          — Express, rutas API, auth JWT
    sheets.js          — CRUD contra Google Sheets (y modo memoria)
    verificar-conexion.js
    .env               — variables locales (no comitear)
    .env.example       — referencia de variables
  frontend/
    index.html         — SPA completa
    js/app.js          — toda la lógica del cliente
    css/style.css
  railway.json
  start.bat
```

## Usuarios del sistema

| Usuario | Rol      | Notas                        |
|---------|----------|------------------------------|
| Fabio   | admin    | Acceso total, ve ingresos    |
| Mariana | operador | Ve calendario también        |
| Anita   | operador | Sin contraseña en el login   |

## Variables de entorno requeridas

```
SPREADSHEET_ID=         — ID de la Google Sheet
GOOGLE_CREDENTIALS_JSON= — JSON del service account (en Render como var de entorno)
JWT_SECRET=             — secreto para firmar tokens
PORT=3001
PASSWORD_ANITA=
PASSWORD_MARIANA=
PASSWORD_FABIO=
```

En desarrollo local: `backend/credentials.json` (archivo, no variable).

## Modelo de datos — Google Sheets

### Hoja "Clientes" (columnas A–X)
`id, estado, cargadoPor, fechaCarga, apellidoNombre, telefono, gmail, redSocial, tipoEvento, formato, fechaEvento, estadoFecha, cantidadInvitados, turno, tipoCliente, exclienteReferencia, exclienteNota, origen, presupuesto, montoPresupuesto, menuInfantil, otrosPedidos, observaciones, proximoSeguimiento`

Estados posibles: `Consulta | Visita agendada | Por cerrar | Confirmado | Realizado | Cancelado`

### Hoja "Ingresos" (columnas A–G)
`id, idCliente, tipoIngreso, monto, fecha, formaPago, notas`

### Hoja "Restricciones" (columnas A–D)
`id, idCliente, tipoRestriccion, cantidad`

## API endpoints

| Método | Ruta | Auth |
|--------|------|------|
| POST | `/api/login` | — |
| GET | `/api/status` | — |
| GET/POST | `/api/clientes` | auth |
| PUT | `/api/clientes/:rowIndex` | auth |
| GET/POST | `/api/ingresos` | auth / admin |
| GET | `/api/ingresos/totales/:idCliente` | admin |
| GET/POST | `/api/restricciones` | auth |
| DELETE | `/api/restricciones/:rowIndex` | auth |

## Deploy — subir cambios al CRM

1. Editar archivos en `c:\Users\WINDOWS 10\Desktop\salon-eventos`
2. Commitear solo los archivos tocados (nunca `.claude/settings.local.json`):
   ```
   git add frontend/index.html frontend/js/app.js frontend/css/style.css
   # sumar backend/server.js o backend/sheets.js si se modificaron
   git commit -m "descripción"
   git push origin main
   ```
3. Render despliega automáticamente (~1–2 min). Verificar en https://dashboard.render.com
4. URL del CRM: https://salon-eventos.onrender.com (primer request tras inactividad: ~50 seg)

## Arquitectura de pagos

El modal de cliente tiene 4 tabs: **Información · Plan de pago · Restricciones · Historial**

- **Plan de pago** (admin): plan de cuotas + formulario "Registrar cobro" al pie
  - Tipo *Cuota*: muestra cuotas pendientes con checkboxes → las marca pagadas y crea ingreso
  - Tipo *Seña / Saldo final / Otro*: solo crea ingreso, no toca el plan
  - Admite cualquier moneda (ARS/USD) independiente de la moneda del plan
- **Historial** (solo admin/super-admin): lista de todos los ingresos del cliente con toggle para ocultar montos

## Notas importantes

- El `rowIndex` en clientes/restricciones es la fila real de Sheets (empieza en 2 por el header).
- En modo memoria (sin credenciales Google), los datos se pierden al reiniciar.
- El calendario es visible para Fabio y Mariana. Anita no lo ve.
- El tab Historial solo lo ven admin y super-admin. El tab Plan de pago también es admin-only.
