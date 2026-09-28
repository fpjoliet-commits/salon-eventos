# Plan de arquitectura y datos — estado al 28/09/2026

Objetivo: que el CRM se proteja solo (sobre todo la plata) y que todo quede registrado
limpio para conectar herramientas de análisis mañana ("plug and play"). **No** construir
reportes todavía.

Forma de trabajo: una tarea → probar contra la copia de prueba → commit → push → verificar
en producción. Local usa SIEMPRE la copia "CRM PRUEBA - no usar" (ver `docs/planilla-de-prueba.md`).

## Nota al commitear `backend/sheets.js`

Tiene un cambio ajeno sin subir en `updateEgreso` (`Egresos!B${rowIndex}:S${rowIndex}`, en HEAD `:P`). No es de este plan: se deja afuera (cambiarlo a `:P`, `git add`, volverlo a `:S`).

## Hecho (todo en producción)

| # | Tarea | Commit |
|---|---|---|
| 0.1 | Backup diario de la planilla (Apps Script, carpeta "Backups CRM Joliet", 30 copias) | c36f899, 291c3a9 |
| 0.2 | Planilla de prueba + seguro: fuera de Render no arranca contra la real | bf8df33 |
| 0.3 | Clave de Cal.com (`CAL_WEBHOOK_SECRET`) — verificado 401 sin clave | (Render) |
| 1.1 | Textos nunca se ejecutan como fórmula (apóstrofo en el cliente de Sheets) | a3d8938 |
| 1.2 | Permisos de plata en servidor (Anita bloqueada) + columna Ingresos Q `cargadoPor` | 7046537 |
| 1.3 | Descartada: Anita SÍ ve presupuesto y nota interna (decisión del usuario) | — |
| 1.4 | Formulario público `/api/leads` validado en servidor | 04bcb23 |
| 2.1 | Diccionario de datos + encabezados completos en todas las hojas | 3d0513f |
| 2.2 | Hora argentina e ISO en todo lo que pone el servidor; zona de la planilla → Buenos Aires | 0bc8ba5 |
| 2.3 | Números como números (locale es_ES rompía decimales) | 796aedd |
| 2.4 | Listas cerradas en `backend/listas.js` + sinónimos + select no borra valores | 3303776 |
| 2.5 | Cuentas opcionales fabio/lautaro; `cargadoPor` = nombre de la persona | 180ea67 |
| 3.1 | Altas de a una (no se pisan cargas simultáneas) | aaaed4e |
| 3.2 + 3.5 | Revisar id de la fila antes de escribir (409) + deshacer sin pisar | e4ff431 |
| 3.3 + 3.4 | Fichas: el servidor conserva lo que la pantalla no manda (bug que borraba menús/modalidad), rastro Eventos AA:AB / Personas M:N, aviso de edición simultánea | 8a3e344 |
| — | Migración vieja Clientes→Personas+Eventos desactivada (podía borrar todo) | f7a10ff |
| 3.6 | Cobros de cuotas "todo o nada" (compensación) | 7f59cb9 |
| 3.7 | Anular en vez de borrar + rastro en Ingresos R:U / Egresos T:W | 8e33d37 |
| 4.1 | Hoja "Estados" append-only (alta, edición y Cal.com) | 8be35c0 |
| 4.2 | Motivo obligatorio al cancelar (Eventos AC:AD, lista en `listas.js`) | 5b4f3b6 |
| 4.3 | Auditoría de cobros y gastos (alta, edición con antes/después, confirmación, anulación, restauración) | 26b5766 |
| 4.4 | Teléfono `+54 9 …` como texto, mail en minúsculas, duplicados comparando teléfono normalizado | 961129a |
| 4.5 | Campaña del formulario web (Eventos AE:AG) + origen por UTM sin importar mayúsculas | e867303 |
| 5.1 | Script `backend/limpiar-historico.js` (fechas ISO, sinónimos, teléfonos, cargadoPor, Estados desde Auditoría, reporte "a completar a mano"); probado en la copia: 92/92 fichas y plata idéntica. Fecha de corte en el diccionario | 2ebb07d |
| 6.1 | Avisos solo a Lautaro (`backend/alertas.js`): Google caído, Gemini sin cupo/clave, cobro sin devolver cuotas, backup fallido; resumen semanal de los lunes; `/api/salud`; apagado prolijo (SIGTERM vacía las colas) | 31934ee |
| 6.2 | Cerrar sesiones a distancia: botón del superadmin, Config `sesionesDesde` (todas menos la propia) | 21787e9 |
| 6.3 | Pruebas automáticas (`npm test`): imputación, cubiertos, cuenta, USD, copias del frontend iguales al servidor, teléfono, resumen | (este) |

## Pendiente

**Acciones del usuario**
- Confirmar que el backup de las 03:00 apareció en "Backups CRM Joliet".
- Reserva de prueba en Cal.com: confirmar que la URL del webhook tiene `?secret=...` y entra al CRM.
- Superadmin: confirmar/descartar 2 cobros viejos del bot sin dueño en "Por confirmar".
- Activar cuentas de Fabio y Lautaro: `node backend/hash-password.js "clave"` → cargar
  `PASSWORD_FABIO` / `PASSWORD_LAUTARO` en Render.

**Fase 4 — historia de cada venta**

**Fase 5 — limpiar histórico** (script listo y probado en la copia; falta correrlo en la real)
- **Correr en la real** (acción del usuario, ~1 min): `node backend/limpiar-historico.js --real`
  para ver qué cambiaría, y después `node backend/limpiar-historico.js --real --aplicar`. Hace
  las pestañas de respaldo solo y se frena si cambia la cantidad de filas o la plata. Después,
  pasarle a Mariana/Fabio la lista "A completar a mano" que imprime.
- Prueba de conexión con Looker Studio (solo leer) — acción del usuario.

**Fase 6 — operación**
- Alerta si se cae (monitor → Telegram). Apagado prolijo (vaciar cola de auditoría en SIGTERM).
- Cerrar sesiones a distancia. Pruebas automáticas de cálculos de plata. Render pago (decide el usuario).
- **Avisos por Telegram — SOLO a Lautaro** (nueva env var, p. ej. `TELEGRAM_CHAT_ALERTAS`;
  hace falta su chat id). A Fabio/Mariana/Anita NO les llega nada técnico: lo que ellos
  resuelven ya está en el CRM (bandeja "Por confirmar", píldoras de la ficha, seguimientos).
  Regla: a cada uno le llega solo lo que puede resolver.
  - *Urgente, en el momento, solo si algo se rompe:* CRM caído / Google sin conexión; falló el
    backup nocturno; el bot no puede interpretar (Gemini caído o clave vencida); un cobro
    falló y NO se pudieron devolver las cuotas (`conDevolucion` en server.js ya lo loguea).
  - *Resumen semanal, lunes a la mañana, un solo mensaje:* datos con problemas (cobros sin
    evento, fichas sin fecha, valores fuera de `listas.js` escritos a mano en la planilla, ids
    duplicados), borradores del bot con más de 7 días, y una línea de salud (cargas, errores
    del servidor, backups de la semana). Semana limpia = "✅ Semana sin problemas".
- Límite de pedidos por IP se puede esquivar falseando `X-Forwarded-For` (revisar cómo lo arma Render antes de tocar).

## Herramientas de prueba usadas

- Sesiones de prueba sin contraseñas: firmar JWT con `JWT_SECRET` de `backend/.env`.
- Foto antes/después de todos los `get*` y comparación (leyendo la real solo en modo lectura).
- `backend/credentials.json` local (no se sube) da acceso a la copia y a la real.
