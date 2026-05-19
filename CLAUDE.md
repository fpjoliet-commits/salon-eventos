# Salón de Eventos — CRM

Sistema de gestión de clientes y eventos para un salón de fiestas. App web fullstack deployada en Railway.

## Stack

- **Backend:** Node.js + Express, JWT auth, Google Sheets como base de datos
- **Frontend:** HTML/CSS/JS vanilla (sin frameworks), sirve desde el mismo backend
- **Storage:** Google Sheets vía `googleapis` — fallback en memoria si no hay credenciales
- **Deploy:** Railway (`railway.json`) — start command: `node backend/server.js`
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
GOOGLE_CREDENTIALS_JSON= — JSON del service account (en Railway como var de entorno)
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

## Notas importantes

- El `rowIndex` en clientes/restricciones es la fila real de Sheets (empieza en 2 por el header).
- En modo memoria (sin credenciales Google), los datos se pierden al reiniciar.
- El calendario es visible para Fabio (admin) y Mariana. Anita no lo ve.
- La vista de ingresos global solo la ve Fabio. Todos pueden cargar un pago desde el modal del cliente.
