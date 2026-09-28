# Diccionario de datos — CRM Joliet

Qué hay en cada hoja de la planilla "CRM Salón de Eventos - PLANILLA BASE", qué
significa cada columna y en qué formato viene. Está pensado para quien conecte
la planilla a una herramienta de análisis (Looker Studio, Power BI, Excel).

Se actualiza **en el mismo commit** que cambia una columna. El orden de las
columnas es el del código (`backend/sheets.js`, funciones `rowTo…` / `…ToRow`).

## Convenciones

| Regla | Detalle |
|---|---|
| Una fila = un hecho | Un evento, un cobro, una cuota, un gasto. La fila 1 es el encabezado; los datos empiezan en la 2. |
| ID único y estable | Columna `id`, con prefijo por tipo: `PER-`, `EVT-`, `ING-`, `EGR-`, `CUO-`, `RES-`, `TIM-`, `EMP-`, `CAT-`, `PED-` Nunca cambia ni se reutiliza. |
| Relaciones por ID | Las hojas se unen por ID, nunca por nombre (ver "Relaciones"). |
| Fechas | Celdas de fecha con formato `AAAA-MM-DD`. Fecha y hora: `AAAA-MM-DD HH:MM:SS`, **hora de Buenos Aires**. |
| Montos | Número real (no texto), con punto o coma según el idioma de quien mira. La moneda va en su propia columna. |
| Moneda | `ARS` o `USD`. Si es `USD`, `cotizacion` guarda el dólar usado y `montoARS` el equivalente en pesos. Un cobro en USD sin cotización tiene `montoARS` vacío: **no sumarlo como pesos**. |
| Listas cerradas | Los campos con opciones solo aceptan los valores de `backend/listas.js`, escritos siempre igual. |
| Quién | `cargadoPor` / `usuario` guardan el nombre de la persona: `Mariana`, `Anita`, `Fabio`, `Lautaro`; `superadmin` es la cuenta compartida de Fabio y Lautaro; `bot-formulario` y `cal-booking` son cargas automáticas. |
| Anulados | Desde 28/09/2026 un cobro o gasto borrado queda con `anulado = 1` (no se borra). Antes se vaciaba la fila. **Filtrar `id` no vacío y `anulado` vacío.** |

**Datos de antes del 28/09/2026** (todavía sin normalizar; se limpian en la Fase 5 del plan):
- `fechaCarga` y la auditoría vieja pueden venir como `28/9/2026` o `28/9/2026, 21:30:05`, y en hora UTC (hasta 3 horas adelantadas).
- Tipos de evento y orígenes escritos distinto (`Cumpleaños de 15` = `XV años`, `Casamiento` = `Boda`, `Recomendacion` = `Referido`). Se corrigen solos cuando alguien vuelve a guardar la ficha.
- Los cobros sin `cargadoPor`: esa columna recién se agregó y no se puede recuperar para atrás.

## Relaciones

```
Personas.id ──< Eventos.personaId
Eventos.id  ──< Ingresos.idEvento
            ──< Cuotas.idCliente          ("cliente" = evento en todo el sistema)
            ──< Restricciones.idCliente
            ──< Timming.idCliente
            ──< PedidosCocina.idCliente
            ──< Egresos.idEvento          (opcional: gastos de un evento)
Empleados.id ─< Egresos.idEmpleado        (pagos al personal)
```

Un "cliente" del CRM es **un evento**: una persona puede tener varios eventos.

---

## Personas — datos de contacto

| Col | Campo | Tipo | Descripción |
|---|---|---|---|
| A | id | texto | `PER-…` |
| B | apellidoNombre | texto | Nombre del cliente |
| C | telefono | texto/número | Teléfono tal como se cargó |
| D | gmail | texto | Mail (minúsculas desde el formulario web) |
| E | redSocial | texto | Usuario de Instagram u otra red |
| F | origen | lista | Cómo llegó: `Instagram`, `Facebook`, `WhatsApp`, `Google`, `TikTok`, `Referido`, `Pasó por la puerta`, `Otro`, `Formulario`, `Cal.com` |
| G | tipoCliente | lista | `Nuevo`, `Excliente`, `Referido` |
| H | exclienteReferencia | texto | Evento anterior, si es excliente |
| I | exclienteNota | texto | Nota sobre el evento anterior |
| J | fechaCarga | fecha | Alta de la persona |
| K | cargadoPor | texto | Quién la cargó |
| L | notaPersona | texto | Nota libre sobre la persona (se lee antes de llamarla) |
| M | modificadoEn | fecha y hora | Última modificación (desde 28/09/2026) |
| N | modificadoPor | texto | Quién hizo la última modificación |

## Eventos — un evento por fila (el "cliente" del CRM)

| Col | Campo | Tipo | Descripción |
|---|---|---|---|
| A | id | texto | `EVT-…` |
| B | personaId | texto | → `Personas.id` |
| C | estado | lista | Embudo: `Consulta`, `Visita agendada`, `Por cerrar`, `Confirmado`, `Realizado`, `Cancelado` |
| D | cargadoPor | texto | Quién lo cargó |
| E | fechaCarga | fecha | Alta del evento (= fecha de la consulta) |
| F | tipoEvento | lista | `Boda`, `XV años`, `Cumpleaños`, `Cumpleaños — 1 año`/`18`/`40`/`50`/`60`/`70`/`80`/`90`, `Bautismo`, `Comunión`, `Egresados`, `Corporativo`, `Otro` |
| G | formato | lista | `Formal`, `Americano` |
| H | fechaEvento | fecha | Día del evento |
| I | estadoFecha | lista | `Tentativa`, `Reservada` |
| J | cantidadInvitados | número | Invitados |
| K | turno | lista | `Almuerzo`, `Tarde`, `Noche` |
| L | presupuesto | lista | Si el cliente dijo cuánto quiere gastar: `Sí, tiene monto`, `No sabe`, `No dice` |
| M | montoPresupuesto | número | Monto presupuestado (ARS) |
| N | menuInfantil | texto | Menú infantil |
| O | otrosPedidos | texto | Pedidos especiales |
| P | observaciones | texto | Observaciones |
| Q | proximoSeguimiento | fecha | Próximo contacto agendado (o fecha de la visita) |
| R–V | menuRecepcion, menuIslas, menuPrimerPlato, menuPrincipal, menuPostre | texto | Menú elegido por etapa |
| W | nombreAgasajado | texto | Quién cumple / se casa |
| X | notaInterna | texto | Nota interna del evento (no la ve el cliente) |
| Y | modalidadPago | lista | `contado`, `cuotas`, `cubiertos` (vacío = sin definir) |
| Z | precioCubierto | número | Precio del cubierto pactado para este evento |
| AA | modificadoEn | fecha y hora | Última modificación (desde 28/09/2026). También evita que dos personas se pisen al editar la misma ficha |
| AB | modificadoPor | texto | Quién hizo la última modificación (`Cal.com` si la tocó el agendamiento) |

## Ingresos — cobros

| Col | Campo | Tipo | Descripción |
|---|---|---|---|
| A | id | texto | `ING-…` |
| B | idEvento | texto | → `Eventos.id` |
| C | tipoIngreso | lista | `Seña`, `Pago a cuenta`, `Cuota`, `Saldo final`, `Otro` |
| D | monto | número | Importe en la moneda de H |
| E | fecha | fecha | Día del cobro |
| F | formaPago | lista | `Efectivo`, `Transferencia`, `Cheque`, `Mercado Pago`, `Otro` |
| G | notas | texto | Detalle (qué cuotas cubrió, etc.) |
| H | moneda | lista | `ARS`, `USD` |
| I | confirmado | 1/0 | `0` = borrador (del bot, en la bandeja "Por confirmar"). **Para análisis, usar solo `1`.** |
| J | cliente | texto | Nombre del cliente al momento del cobro (copia; manda `idEvento`) |
| K | fechaEvento | fecha | Fecha del evento al momento del cobro (copia) |
| L | periodo | texto | `AAAA-MM` del cobro, para agrupar por mes |
| M | cubiertos | número | Modalidad por cubierto: cubiertos que compró este cobro |
| N | precioCubierto | número | Precio del cubierto congelado en este cobro |
| O | cotizacion | número | Dólar usado si fue en USD |
| P | montoARS | número | Equivalente en pesos (ARS: = monto; USD: monto × cotización) |
| Q | cargadoPor | texto | Quién lo cargó (desde 28/09/2026) |
| R | creadoEn | fecha y hora | Alta del registro |
| S | modificadoEn | fecha y hora | Última modificación (o anulación) |
| T | modificadoPor | texto | Quién la hizo |
| U | anulado | 1/vacío | `1` = anulado (borrado): **excluir en análisis** |

## Cuotas — plan de pago

| Col | Campo | Tipo | Descripción |
|---|---|---|---|
| A | id | texto | `CUO-…` |
| B | idCliente | texto | → `Eventos.id` |
| C | numeroCuota | número | 1, 2, 3… |
| D | valorOriginal | número | Valor pactado |
| E | valorActual | número | Valor vigente (ajustado por IPC si corresponde) |
| F | fechaVencimiento | fecha | Vencimiento |
| G | estado | texto | `pendiente`, `parcial`, `pagada`, `cancelada` |
| H | fechaPago | fecha | Cuándo se pagó |
| I | montoPagado | número | Cuánto se pagó |
| J | notas | texto | |
| K | moneda | lista | `ARS`, `USD` |
| L | indexacion | texto | `fija` o `ipc` |
| M | confirmado | 1/0 | `0` = plan en borrador |
| N | ipcHasta | texto | Último mes de IPC aplicado (`AAAA-MM`) |

## Egresos — gastos

| Col | Campo | Tipo | Descripción |
|---|---|---|---|
| A | id | texto | `EGR-…` |
| B | fecha | fecha | Día del gasto |
| C | concepto | texto | Qué se pagó |
| D | categoria | lista | `Servicios`, `Bebidas`, `Personal`, `Evento`, `Mantenimiento`, `Materia Prima` |
| E | monto | número | Importe en la moneda de F |
| F | moneda | lista | `ARS`, `USD` |
| G | idEmpleado | texto | → `Empleados.id` (si es pago al personal) |
| H | nombreEmpleado | texto | Nombre del empleado (copia) |
| I | rolPago | texto | Puesto por el que se le pagó |
| J | notas | texto | |
| K | cargadoPor | texto | Quién lo cargó |
| L | proveedor | texto | A quién se le pagó |
| M | tipoCosto | texto | `Fijo` (del salón) o `Evento` (de un evento puntual) |
| N | idEvento | texto | → `Eventos.id` (si es gasto de un evento) |
| O | evento | texto | "Cliente — dd/mm/aaaa" del evento (copia) |
| P | periodo | texto | `AAAA-MM` del gasto |
| Q | confirmado | 1/0 | `0` = borrador del bot |
| R | cotizacion | número | Dólar usado si fue en USD |
| S | montoARS | número | Equivalente en pesos |
| T | creadoEn | fecha y hora | Alta del registro |
| U | modificadoEn | fecha y hora | Última modificación (o anulación) |
| V | modificadoPor | texto | Quién la hizo |
| W | anulado | 1/vacío | `1` = anulado (borrado): **excluir en análisis** |

## Restricciones — alimentarias por evento

| Col | Campo | Tipo | Descripción |
|---|---|---|---|
| A | id | texto | |
| B | idCliente | texto | → `Eventos.id` |
| C | tipoRestriccion | texto | Celíaco, vegetariano, etc. |
| D | cantidad | número | Cuántos invitados |
| E | coronita | TRUE/FALSE | Si es de la mesa principal |

## Timming — cronograma del evento

| Col | Campo | Tipo | Descripción |
|---|---|---|---|
| A | id | texto | |
| B | idCliente | texto | → `Eventos.id` |
| C | hora | texto | `HH:MM` |
| D | actividad | texto | El paso (en mayúsculas) |
| E | tipo | texto | `maitre` (salón), `cocina`, `maitre-cel` (agregado desde el link de la maître) |
| F | descripcion | texto | |
| G | hecho | `si`/vacío | Tildado en vivo |
| H | horaOriginal | texto | Hora planificada, si se corrió |
| I | notas | JSON | Notas de la maître: `[{ "h": "22:10", "t": "texto" }]` |

## Empleados

| Col | Campo | Tipo | Descripción |
|---|---|---|---|
| A | id | texto | |
| B | nombre | texto | |
| C | activo | texto | `false` = dado de baja |
| D | rolHabitual | texto | Puesto habitual |

## Cocina

**CatalogoItems** — catálogo de productos: `id`, `categoria`, `nombre`, `activo`, `unidad`.

**StockActual** — stock: `id`, `categoria`, `nombre`, `unidad`, `cantidad` (número), `actualizado` (fecha), `minimo` (número).

**PedidosCocina** — pedidos de la semana: `id`, `idCliente` (→ `Eventos.id`), `nombreEvento`, `fecha`, `itemsJSON` (lista de ítems en JSON), `estado` (`preparacion`, `relevado`), `creadoPor`, `fechaCarga`.

## Registro

**Auditoria** — historial de cambios: `fecha` (fecha y hora), `usuario` (persona), `accion`, `entidad`, `idEntidad`, `nombre`, `detalle` (JSON con los campos auditados). Por ahora registra fichas de eventos y planes de cuotas; los cobros y gastos se suman en la tarea 4.3 del plan.

**Estados** — historia del embudo, solo se agregan filas (nunca se editan ni borran): una por cada cambio de estado de un evento. `idEvento` (→ `Eventos.id`), `de` (estado anterior; vacío en el alta), `a` (estado nuevo), `fechaHora` (hora argentina), `quien` (persona; "Cal.com" si lo cambió la reserva de visita). Existe desde el 28/09/2026; lo anterior se rellena desde la Auditoría (Fase 5).

**Papelera** — eventos eliminados: `fechaEliminacion`, `eliminadoPor`, `tipo`, `id`, `datosJSON` (la ficha completa al momento de borrarla).

**Config** — pares `clave` / `valor` (precio general del cubierto, links del timing, vistas guardadas). No es para análisis.

## Hojas que no usar

**Clientes** — formato viejo, de antes de separar Personas y Eventos. Solo la lee la migración única (`POST /api/migrar-clientes`); los datos vigentes están en Personas + Eventos.
