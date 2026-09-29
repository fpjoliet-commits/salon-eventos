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
| 6.3 | Pruebas automáticas (`npm test`): imputación, cubiertos, cuenta, USD, copias del frontend iguales al servidor, teléfono, resumen | b1a48b8 |
| 6.4 | Límites por IP con `CF-Connecting-IP` (X-Forwarded-For se podía falsear: verificado en producción) | 5727f9d |
| 5.2 | Limpieza aplicada en la REAL (28/09 19:46): 200 celdas + 11 Estados, 84/84 fichas, plata idéntica; respaldo en pestañas "Respaldo … 2026-09-28 19.46" | — |
| 5.3 | Formulario web manda los valores oficiales (Boda, XV años, Referido), nombre y apellido separados ("Apellido, Nombre"), teléfono con área obligatorio | (este) |
| — | Bot: carga directa sin "Sí" + botón "Me equivoqué" + aviso de posible duplicado (7 días) | (este) |

## Pendiente

El código del plan está completo. Lo que falta son acciones de personas:

**Lautaro**
- Hecho 28/09: avisos por Telegram (probado), webhook de Cal.com (clave verificada), horarios de Cal.com
  (a propósito: mar–vie hasta 19:00, sáb hasta 19:30).
- Vigilancia del CRM en el Apps Script: pegar la versión nueva, cargar `TELEGRAM_TOKEN` y `TELEGRAM_CHAT`
  y volver a ejecutar `instalar` (reemplaza al monitor externo).
- Opcional: cuentas propias de Fabio y Lautaro (`node backend/hash-password.js "clave"` →
  `PASSWORD_FABIO` / `PASSWORD_LAUTARO` en Render). Solo hace falta si se quiere distinguir quién de
  los dos cargó algo; hoy figura "superadmin".
- Decidido no hacer por ahora: Render pago (el ping de la vigilancia no lo mantiene despierto; la demora
  de ~50 s al abrir ya estaba aceptada) y Looker Studio (datos listos; reportes cuando se quieran).

**Mariana (datos a mano)**
- Fecha de la fiesta de Amaya Barbara Lucía y Nicolás Pérez (confirmados sin fecha).
- Silvina Ferreyra: ¿13/11 o 14/11? (nota interna en la ficha).
- Cobro de $850.000 del 16/09 sin evento: ¿duplicado del de RIOS LAURA?
- Teléfonos sin área: Vanessa Verger, Rocío Di Palma.
- Superadmin: confirmar/descartar 2 cobros viejos del bot sin dueño en "Por confirmar".

## Herramientas de prueba usadas

- Sesiones de prueba sin contraseñas: firmar JWT con `JWT_SECRET` de `backend/.env`.
- Foto antes/después de todos los `get*` y comparación (leyendo la real solo en modo lectura).
- `backend/credentials.json` local (no se sube) da acceso a la copia y a la real.
