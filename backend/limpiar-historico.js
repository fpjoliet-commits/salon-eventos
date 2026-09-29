/* Limpieza del histórico (Fase 5 de docs/plan-arquitectura.md).

   Lleva lo cargado antes de las reglas nuevas a la misma forma que lo de hoy,
   para poder analizar los datos sin casos especiales:
     - fechas "10/9/2026" → "2026-09-10" (y "10/9/2026, 8:51:21" → ISO con hora)
     - tipo de evento, origen, estado, turno, tipo/forma de cobro, categoría:
       sinónimos → valor oficial (backend/listas.js)
     - teléfono "+54 9 …" y mail en minúsculas
     - cargadoPor / usuario: "admin" → Mariana, "empleado" → Anita
     - rellena la hoja Estados con los cambios de estado que quedaron en la
       Auditoría antes de que existiera (4.1)

   Uso (desde la raíz del proyecto):
     node backend/limpiar-historico.js                   muestra qué cambiaría (copia de prueba)
     node backend/limpiar-historico.js --aplicar         lo aplica en la copia de prueba
     node backend/limpiar-historico.js --real            muestra qué cambiaría en la REAL
     node backend/limpiar-historico.js --real --aplicar  lo aplica en la REAL

   Al aplicar: primero duplica cada hoja que va a tocar como pestaña
   "Respaldo <hoja> <fecha>", después escribe SOLO las celdas que cambian, y al
   final verifica que la cantidad de filas y el total de plata sean los mismos.
   Correrlo dos veces no hace nada la segunda vez. */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const ID_PLANILLA_REAL = '1ijCN27RaLLYUG0a6hEYwwC9rQJKrYV_KdsBEGAHULgY';
const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
if (args.includes('--real')) process.env.SPREADSHEET_ID = ID_PLANILLA_REAL;
else if (process.env.SPREADSHEET_ID === ID_PLANILLA_REAL) {
  console.error('❌ backend/.env apunta a la planilla REAL. Para la real se pide --real a propósito.');
  process.exit(1);
}
if (!process.env.GOOGLE_CREDENTIALS_JSON) {
  // Igual que el server en local: la llave está en backend/credentials.json
  process.chdir(__dirname);
}

const sheets = require('./sheets');
const listas = require('./listas');
const ID = process.env.SPREADSHEET_ID;

const PERSONAS_DE_ROL = { admin: 'Mariana', empleado: 'Anita' };
const persona = v => PERSONAS_DE_ROL[String(v || '').trim().toLowerCase()] || v;

// "10/9/2026" → "2026-09-10"; "10/9/2026, 8:51:21" → "2026-09-10 08:51:21". Lo demás, igual.
function fechaISO(v) {
  const m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return v;
  const [, d, mes, a, h, min, s] = m;
  const fecha = `${a}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return h === undefined ? fecha : `${fecha} ${h.padStart(2, '0')}:${min}:${s || '00'}`;
}
const oficial = (tabla, campo) => v => listas.normalizar(tabla, { [campo]: v })[campo];

/* Qué se limpia en cada hoja: columna → función que devuelve el valor limpio */
const REGLAS = {
  Eventos: { hasta: 'AG', cols: {
    C: oficial('evento', 'estado'), D: persona, E: fechaISO, F: oficial('evento', 'tipoEvento'),
    G: oficial('evento', 'formato'), H: fechaISO, I: oficial('evento', 'estadoFecha'),
    K: oficial('evento', 'turno'), Q: fechaISO, AB: persona,
  } },
  Personas: { hasta: 'N', cols: {
    C: listas.normalizarTelefono, D: v => String(v || '').trim().toLowerCase(),
    F: oficial('evento', 'origen'), G: oficial('evento', 'tipoCliente'), J: fechaISO, K: persona, N: persona,
  } },
  Ingresos: { hasta: 'U', cols: {
    C: oficial('ingreso', 'tipoIngreso'), E: fechaISO, F: oficial('ingreso', 'formaPago'),
    H: oficial('ingreso', 'moneda'), Q: persona, T: persona,
  } },
  Egresos: { hasta: 'W', cols: {
    B: fechaISO, D: oficial('egreso', 'categoria'), F: oficial('egreso', 'moneda'), K: persona, V: persona,
  } },
  Auditoria: { hasta: 'G', cols: { A: fechaISO, B: persona } },
};

const colANum = c => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/* Formato de las columnas de fecha. Una celda que ya era fecha conserva su
   formato viejo (d/m/aaaa) aunque se le escriba "2026-09-10": se ve y se lee
   igual que antes. Se fija el formato ISO de toda la columna (solo cómo se
   muestra; el valor no cambia). */
const COLUMNAS_FECHA = {
  Eventos: { E: 'yyyy-mm-dd', H: 'yyyy-mm-dd', Q: 'yyyy-mm-dd', AA: 'yyyy-mm-dd hh:mm:ss' },
  Personas: { J: 'yyyy-mm-dd', M: 'yyyy-mm-dd hh:mm:ss' },
  Ingresos: { E: 'yyyy-mm-dd', R: 'yyyy-mm-dd hh:mm:ss', S: 'yyyy-mm-dd hh:mm:ss' },
  Egresos: { B: 'yyyy-mm-dd', T: 'yyyy-mm-dd hh:mm:ss', U: 'yyyy-mm-dd hh:mm:ss' },
  Auditoria: { A: 'yyyy-mm-dd hh:mm:ss' },
  Estados: { D: 'yyyy-mm-dd hh:mm:ss' },
};
function pedidosDeFormato(hojas) {
  const pedidos = [];
  for (const [hoja, cols] of Object.entries(COLUMNAS_FECHA)) {
    const h = hojas.find(x => x.title === hoja);
    if (!h) continue;
    for (const [col, pattern] of Object.entries(cols)) {
      const c = colANum(col);
      pedidos.push({ repeatCell: {
        range: { sheetId: h.sheetId, startRowIndex: 1, startColumnIndex: c, endColumnIndex: c + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern } } },
        fields: 'userEnteredFormat.numberFormat',
      } });
    }
  }
  return pedidos;
}

async function leer(api, hoja, hasta) {
  const r = await api.values.get({ spreadsheetId: ID, range: `${hoja}!A2:${hasta}` });
  return r.data.values || [];
}

/* Lo que tiene que quedar igual: filas con id y total de plata */
async function controles(api) {
  const suma = (filas, col) => Math.round(filas.filter(f => f[0])
    .reduce((t, f) => t + (parseFloat(f[col]) || 0), 0) * 100) / 100;
  const [ev, pe, ing, egr] = await Promise.all([
    leer(api, 'Eventos', 'A'), leer(api, 'Personas', 'A'), leer(api, 'Ingresos', 'U'), leer(api, 'Egresos', 'W'),
  ]);
  return {
    eventos: ev.filter(f => f[0]).length, personas: pe.filter(f => f[0]).length,
    cobros: ing.filter(f => f[0]).length, gastos: egr.filter(f => f[0]).length,
    totalCobros: suma(ing, 3), totalCobrosARS: suma(ing, 15), totalGastos: suma(egr, 4),
  };
}

/* Cambios de estado que hay en la Auditoría y no en la hoja Estados */
function estadosDesdeAuditoria(auditoria, estados) {
  // Seguro extra: una fila igual a una que ya está nunca se vuelve a agregar
  const yaEstan = new Set(estados.map(([id, de, a, f]) => [id, de || '', a, fechaISO(f)].join('|')));
  const primeroEnEstados = {};
  for (const [id, , , f] of estados) {
    const fecha = fechaISO(f);   // por si la columna todavía muestra d/m/aaaa
    if (id && (!primeroEnEstados[id] || fecha < primeroEnEstados[id])) primeroEnEstados[id] = fecha;
  }
  const porEvento = {};
  for (const f of auditoria) {
    const [fecha, usuario, accion, entidad, idEvento, , detalle] = f;
    if (entidad !== 'Evento' || !['Creó', 'Editó'].includes(accion) || !idEvento) continue;
    let estado;
    try { estado = JSON.parse(detalle || '{}').estado; } catch { continue; }
    if (!estado) continue;
    (porEvento[idEvento] ||= []).push({ fecha: fechaISO(fecha), usuario: persona(usuario), estado: listas.normalizar('evento', { estado }).estado, accion });
  }
  const filas = [];
  for (const [id, cambios] of Object.entries(porEvento)) {
    cambios.sort((a, b) => a.fecha.localeCompare(b.fecha));
    // Antes del alta registrada no se sabe en qué estado estaba: sin "de"
    let anterior = cambios[0].accion === 'Creó' ? '' : null;
    for (const c of cambios) {
      if (primeroEnEstados[id] && c.fecha >= primeroEnEstados[id]) break;  // desde acá ya lo registra la app
      if (anterior === null) { anterior = c.estado; continue; }
      const clave = [id, anterior, c.estado, c.fecha].join('|');
      if (c.estado !== anterior && !yaEstan.has(clave)) filas.push([id, anterior, c.estado, c.fecha, c.usuario || '—']);
      anterior = c.estado;
    }
  }
  return filas;
}

/* Lo que no se puede corregir solo: hace falta que alguien lo complete. Solo
   se lista (no se inventa nada): para pasárselo a Mariana/Fabio. */
function reporteACompletar({ Eventos = [], Personas = [], Ingresos = [] }) {
  const nombre = {};
  Personas.forEach(p => { if (p[0]) nombre[p[0]] = p[1]; });
  const evento = e => `${nombre[e[1]] || e[1]} (${e[0]})`;
  const vivos = Ingresos.filter(i => i[0] && i[20] !== '1');
  const grupos = [
    ['Eventos sin fecha de carga', Eventos.filter(e => e[0] && !e[4]).map(evento)],
    ['Eventos sin tipo de evento', Eventos.filter(e => e[0] && !e[5]).map(evento)],
    ['Confirmados/Realizados sin fecha del evento', Eventos.filter(e => e[0] && ['Confirmado', 'Realizado'].includes(e[2]) && !e[7]).map(evento)],
    ['Cobros sin evento', vivos.filter(i => !i[1]).map(i => `${i[4]} $${i[3]} ${i[6] || ''} (${i[0]})`)],
    ['Cobros sin quién los cargó', vivos.filter(i => !i[16]).map(i => `${i[4]} ${i[9] || '?'} $${i[3]} (${i[0]})`)],
    ['Teléfonos que no se pudieron normalizar', Personas.filter(p => p[0] && p[2] && !String(p[2]).startsWith('+54 9 ')).map(p => `${p[1]}: "${p[2]}"`)],
  ].filter(([, items]) => items.length);
  if (!grupos.length) return;
  console.log('\nA completar a mano (no se corrige solo):');
  for (const [titulo, items] of grupos) {
    console.log(`  ${titulo}: ${items.length}`);
    items.slice(0, 8).forEach(x => console.log(`     - ${x}`));
    if (items.length > 8) console.log(`     … y ${items.length - 8} más`);
  }
}

(async () => {
  const api = sheets.getSheets().spreadsheets;
  const meta = await api.get({ spreadsheetId: ID });
  const titulo = meta.data.properties.title;
  const hojas = meta.data.sheets.map(s => s.properties);
  console.log(`Planilla: "${titulo}"${APLICAR ? '' : '  (solo muestra, no escribe)'}\n`);

  // Con --aplicar: PRIMERO el respaldo de toda hoja que se puede tocar (datos o
  // formato), después el formato ISO de las columnas de fecha y recién ahí leer
  // y escribir. Antes el formato se aplicaba sin respaldo previo.
  let antes = null;
  if (APLICAR) {
    antes = await controles(api);
    const formato = pedidosDeFormato(hojas);
    const idsFormato = new Set(formato.map(r => r.repeatCell.range.sheetId));
    const tocables = new Set([
      ...Object.keys(REGLAS), 'Estados',
      ...hojas.filter(h => idsFormato.has(h.sheetId)).map(h => h.title),
    ].filter(t => hojas.some(h => h.title === t)));
    const sufijo = new Date().toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 16).replace(':', '.');
    await api.batchUpdate({ spreadsheetId: ID, resource: { requests: [...tocables].map(t => ({
      duplicateSheet: { sourceSheetId: hojas.find(h => h.title === t).sheetId, newSheetName: `Respaldo ${t} ${sufijo}` },
    })) } });
    console.log(`Respaldo hecho: ${[...tocables].map(t => `"Respaldo ${t} ${sufijo}"`).join(', ')}`);
    await api.batchUpdate({ spreadsheetId: ID, resource: { requests: formato } });
    console.log('Formato de fecha ISO fijado en las columnas de fecha.\n');
  }

  const escrituras = [];
  const resumen = {};
  const leidas = {};
  for (const [hoja, { hasta, cols }] of Object.entries(REGLAS)) {
    if (!hojas.some(h => h.title === hoja)) continue;
    const filas = await leer(api, hoja, hasta);
    leidas[hoja] = filas;
    filas.forEach((fila, i) => {
      if (!fila[0]) return;
      for (const [col, limpiar] of Object.entries(cols)) {
        const antes = fila[colANum(col)] ?? '';
        if (antes === '') continue;
        const despues = limpiar(antes);
        if (despues === undefined || despues === antes) continue;
        escrituras.push({ range: `${hoja}!${col}${i + 2}`, values: [[despues]] });
        const clave = `${hoja}!${col}`;
        (resumen[clave] ||= { n: 0, ejemplos: new Map() }).n++;
        const r = resumen[clave];
        if (r.ejemplos.size < 4 && !r.ejemplos.has(antes)) r.ejemplos.set(antes, despues);
      }
    });
  }
  for (const [clave, { n, ejemplos }] of Object.entries(resumen)) {
    const ej = [...ejemplos].map(([a, d]) => `"${a}" → "${d}"`).join(', ');
    console.log(`${clave.padEnd(14)} ${String(n).padStart(4)} celdas   ej.: ${ej}`);
  }

  reporteACompletar(leidas);

  const tieneEstados = hojas.some(h => h.title === 'Estados');
  const nuevasEstados = estadosDesdeAuditoria(
    await leer(api, 'Auditoria', 'G'),
    tieneEstados ? await leer(api, 'Estados', 'E') : [],
  );
  console.log(`\nEstados: ${nuevasEstados.length} cambios de estado a recuperar de la Auditoría`);
  nuevasEstados.slice(0, 5).forEach(f => console.log('   ', f.join(' | ')));

  if (!escrituras.length && !nuevasEstados.length) { console.log('\nNada para limpiar.'); return; }
  if (!APLICAR) { console.log('\nPara aplicarlo, sumar --aplicar (también fija el formato ISO de las columnas de fecha).'); return; }
  if (!tieneEstados && nuevasEstados.length) throw new Error('Falta la hoja Estados: arrancar el servidor una vez (initSheets) y volver a correr.');

  // 1) El respaldo ya se hizo arriba, antes de tocar nada
  // 2) Solo las celdas que cambian (de a 500 por pedido)
  for (let i = 0; i < escrituras.length; i += 500) {
    await api.values.batchUpdate({ spreadsheetId: ID, resource: { valueInputOption: 'USER_ENTERED', data: escrituras.slice(i, i + 500) } });
  }
  if (nuevasEstados.length) {
    await api.values.append({ spreadsheetId: ID, range: 'Estados!A:E', valueInputOption: 'USER_ENTERED', resource: { values: nuevasEstados } });
  }
  console.log(`Escritas ${escrituras.length} celdas y ${nuevasEstados.length} filas de Estados.`);

  // 3) Nada se perdió: mismas filas, misma plata
  const despues = await controles(api);
  const distintos = Object.keys(antes).filter(k => antes[k] !== despues[k]);
  console.log('Controles:', JSON.stringify(despues));
  if (distintos.length) {
    console.error(`❌ Cambió ${distintos.join(', ')}. Revisar y, si hace falta, volver a las pestañas de respaldo.`);
    process.exit(1);
  }
  console.log('✅ Mismas filas y mismo total de plata que antes.');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
