# Salón de Eventos — CRM (Joliet)

Sistema de gestión de clientes, eventos, pagos y cocina para un salón de fiestas.
App web fullstack deployada en Render.

## Stack

- **Backend:** Node.js + Express 5, auth JWT con contraseñas hasheadas en bcrypt (`bcryptjs`)
- **Frontend:** HTML/CSS/JS vanilla (sin frameworks), servido por el mismo backend desde `frontend/`
- **Storage:** Google Sheets vía `googleapis` — fallback en memoria si no hay credenciales
- **Deploy:** Render — start command: `node backend/server.js`
- **Dev local:** `start.bat` o `npm start` (= `node backend/server.js`) desde la raíz

## Usuarios y roles

Hay **3 cuentas de login**, definidas por hash bcrypt en variables de entorno
(`PASSWORD_SUPERADMIN`, `PASSWORD_ADMIN`, `PASSWORD_EMPLEADO`). Generar un hash:
`node backend/hash-password.js "miContraseña"`.

| Cuenta (login) | Rol interno  | Nombre real     | Acceso                                          |
|----------------|--------------|-----------------|-------------------------------------------------|
| `superadmin`   | `superadmin` | Fabio / Lautaro | Todo: egresos de materia prima, cocina, config  |
| `admin`        | `admin`      | Mariana         | Bandeja "Por confirmar", plan de pago, historial|
| `empleado`     | `operador`   | Anita           | Carga básica; sin bandeja ni ingresos           |

Mapeo nombre↔rol para etiquetas/visibilidad: `ETIQUETAS_DE_ROL` en `backend/server.js`.
Helpers de permiso: `auth`, `adminOnly` (admin+superadmin), `superAdminOnly`.

## Variables de entorno

Ver `backend/.env.example`. Obligatorias: `JWT_SECRET`, `SPREADSHEET_ID`, los 3
`PASSWORD_*`. Credenciales de Google: `GOOGLE_CREDENTIALS_JSON` (env var, en Render)
**o** `backend/credentials.json` (archivo, dev local — se usa como fallback).
Opcionales: bots (Telegram/WhatsApp), `CAL_WEBHOOK_SECRET`, `ALLOWED_ORIGINS`,
`PDFSHIFT_API_KEY` + `PUBLIC_BASE_URL` (PDF de la propuesta: sin la key, el
creador cae al diálogo de impresión del navegador en vez de descargar solo).

## Modelo de datos — Google Sheets

Un "cliente" del CRM = una fila de **Eventos** + su fila en **Personas** (unidas por
`personaRowIndex`). Hojas y rangos (orden exacto de columnas en `backend/sheets.js`):

| Hoja           | Rango    | Contenido                                    |
|----------------|----------|----------------------------------------------|
| `Personas`     | A:K      | Datos de contacto del cliente                |
| `Eventos`      | A:Z      | Evento (fecha, estado, presupuesto…)         |
| `Ingresos`     | A:P      | Cobros (con flag `confirmado`)               |
| `Egresos`      | A:Q      | Gastos, incluye personal y materia prima     |
| `Cuotas`       | A:M      | Plan de pago / cuotas (con IPC indexado)     |
| `Restricciones`| A:E      | Restricciones alimentarias por cliente       |
| `Timming`      | A:F      | Timing del evento (comanda del día)          |
| `Empleados`    | A:C      | Personal                                     |
| `Config`       | A:B      | Configuración (superadmin)                   |
| `Papelera`     | A:E      | Soft-delete de eventos                       |

Cocina/stock (superadmin): catálogo de ítems, stock actual y pedidos de cocina.

Estados de un cliente/evento: `Consulta | Visita agendada | Por cerrar | Confirmado | Realizado | Cancelado`

## Módulos principales

- **Ficha de cliente** (modal, 5 tabs): **Información · Plan de pago · Restricciones · Historial · Propuesta**
  - **Plan de pago** (admin): plan de cuotas + "Registrar cobro". Cuota → marca pagadas
    y crea ingreso; Seña/Saldo/Otro → solo crea ingreso. Cualquier moneda (ARS/USD).
    Cuotas indexables por IPC (INDEC vía datos.gob.ar).
  - **Historial** (admin/superadmin): ingresos del cliente, con toggle para ocultar montos.
- **Calendario**: visible para admin y superadmin (no para operador/Anita).
- **Timing Planner** (admin+): timing por evento; imprime la comanda del día.
- **Cocina** (superadmin): Stock actual · Pedido de semana · Catálogo · Compras.
- **Egresos** (admin; materia prima solo superadmin).
- **Formulario público** `/consulta` → `POST /api/leads` (captura leads sin auth).
- **Cotización dólar blue**: `GET /api/cotizacion-blue`.

## Bots (carga de movimientos por mensaje)

- **Telegram** (`backend/telegram-bot.js`): **activo** si están las env vars. Cada dueño
  manda audio/texto → IA (Gemini) interpreta → crea un **borrador** (`confirmado:false`)
  de ingreso/egreso que cae en la bandeja "Por confirmar". El bot **nunca confirma solo**.
  Webhook en `/api/webhook/telegram`. Setup: `docs/telegram-bot-setup.md`.
- **WhatsApp** (`backend/whatsapp-bot.js`): **dormido** (código listo, falta alta en Meta).
  Bot reactivo sin IA (Cloud API). Config en `backend/bot-config.js`. Setup: `docs/whatsapp-bot-setup.md`.

## Deploy — subir cambios al CRM

1. Editar archivos en `c:\Users\WINDOWS 10\Desktop\salon-eventos`
2. Commitear solo los archivos tocados (**nunca** `.claude/settings.local.json`,
   `backend/credentials.json` ni `dashboard/config.json` — están gitignoreados):
   ```
   git add frontend/index.html frontend/js/app.js frontend/css/style.css
   # sumar backend/server.js o backend/sheets.js si se modificaron
   git commit -m "descripción"
   git push origin main
   ```
3. Render despliega automáticamente (~1–2 min). Verificar en https://dashboard.render.com
4. URL del CRM: https://salon-eventos.onrender.com (primer request tras inactividad: ~50 seg)

## Notas importantes

- El `rowIndex` (en Eventos, Personas, etc.) es la fila real de Sheets: empieza en 2 por el header.
- En modo memoria (sin credenciales Google), los datos se pierden al reiniciar.
- Un borrador del bot es "huérfano" si su etiqueta no llega a ningún rol con acceso a
  la bandeja (p. ej. cargado por Anita): el superadmin los ve como red de seguridad.
- El `dashboard/` es un dashboard de escritorio aparte; su `config.json` guarda la
  contraseña de superadmin y **no** se commitea.
