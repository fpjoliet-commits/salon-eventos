const fs = require('fs');
const listas = require('./listas');
const path = require('path');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

let credencialesJSON = null;
if (process.env.GOOGLE_CREDENTIALS_JSON) {
  try {
    credencialesJSON = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  } catch {
    console.error('❌ GOOGLE_CREDENTIALS_JSON no es un JSON válido.');
  }
} else {
  const KEY_PATH = path.resolve(__dirname, './credentials.json');
  if (fs.existsSync(KEY_PATH)) {
    credencialesJSON = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  }
}

const tieneCredenciales = !!credencialesJSON;

if (!tieneCredenciales) {
  console.warn('⚠️  Sin credenciales de Google — usando almacenamiento en memoria (los datos no persisten al reiniciar).');
}

/* ===================== MODO MEMORIA ===================== */
let memPersonas = [];
let memEventos = [];
let memIngresos = [];
let memRestricciones = [];
let memCuotas = [];
let memTimming = [];
let memEmpleados = [];
let memEgresos = [];
let memCatalogoItems = [];
let memPedidosCocina = [];
let memStockActual = [];

/* Fechas que pone el sistema: siempre en hora argentina y en formato estándar
   (2026-09-28 / 2026-09-28 21:30:05), que ordena bien y lo lee cualquier
   herramienta. Render corre en UTC: toLocaleDateString('es-AR') sin zona ponía
   la fecha de mañana a todo lo cargado después de las 21. */
const ZONA_AR = 'America/Argentina/Buenos_Aires';
const hoyAR = () => new Date().toLocaleDateString('sv-SE', { timeZone: ZONA_AR });
const ahoraAR = () => new Date().toLocaleString('sv-SE', { timeZone: ZONA_AR });

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

/* ===================== GOOGLE SHEETS CLIENT ===================== */
// El cliente se arma una sola vez: antes cada llamada creaba un GoogleAuth nuevo
// y pedía un token nuevo, sumando una vuelta a Google en cada lectura.
//
// Además las lecturas quedan en memoria: cada pantalla del CRM pedía la hoja a
// Google (medio segundo o más por pedido). Cualquier escritura (update, append,
// batchUpdate, clear) vacía la memoria entera, así que después de guardar nunca
// se lee un dato viejo. El vencimiento de 30 s cubre los cambios hechos a mano
// directamente en la planilla.
const TTL_LECTURA_MS = 30 * 1000;
const cacheLecturas = new Map(); // JSON de los parámetros -> { ts, promesa }
let _clienteSheets = null;

function invalidarCacheSheets() {
  cacheLecturas.clear();
}

/* ===================== ALTAS DE A UNA =====================
   Una alta calcula "la próxima fila libre" y escribe ahí. Si dos llegaban juntas
   (Mariana cargando un cobro mientras el bot carga otro) las dos calculaban la
   misma fila y una pisaba a la otra sin avisar. Ahora las altas de cada hoja
   hacen fila: la siguiente recién calcula cuando la anterior terminó de
   escribir. Alcanza con una fila en memoria porque el servidor es un solo
   proceso (Render: WEB_CONCURRENCY=1). */
const _colasDeAlta = new Map(); // hoja -> promesa de la última alta

function enFilaDeAlta(hoja, tarea) {
  const previa = _colasDeAlta.get(hoja) || Promise.resolve();
  const actual = previa.catch(() => {}).then(tarea);
  _colasDeAlta.set(hoja, actual);
  return actual;
}

// Siempre lectura fresca: con la memoria de 30 s podía calcular sobre datos viejos
async function proximaFila(hoja) {
  const colA = await getSheets().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID, range: `${hoja}!A:A`, sinCache: true,
  });
  return (colA.data.values || []).length + 1;
}

/* ===================== DESHACER SEGURO =====================
   "Deshacer" vuelve a escribir el registro borrado en su fila. Si mientras
   tanto una alta nueva ocupó esa fila (pasa cuando se borra el último), se lo
   pisaba y se perdía. Ahora: si la fila sigue vacía (o ya tiene ese mismo
   registro) se restaura ahí; si la ocupa otro, el restaurado va al final. */
async function restaurarEnSuLugar(hoja, ultimaCol, rowIndex, data, aFila) {
  const sheets = getSheets();
  return enFilaDeAlta(hoja, async () => {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID, range: `${hoja}!A${rowIndex}`, sinCache: true,
    });
    const ocupante = String(r.data.values?.[0]?.[0] ?? '');
    const fila = (!ocupante || ocupante === String(data.id)) ? rowIndex : await proximaFila(hoja);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${hoja}!A${fila}:${ultimaCol}${fila}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [aFila(data)] },
    });
    return { ...data, rowIndex: fila };
  });
}

// Deshacer una anulación: si la fila es ese registro, se le saca la marca y se
// sella quién lo recuperó. Devuelve false si la fila no es ese registro (p. ej.
// quedó vacía por un borrado de antes de existir la anulación).
async function desanular(hoja, colDesde, colAnulado, rowIndex, id, quien) {
  if (!id) return false;
  const r = await getSheets().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID, range: `${hoja}!A${rowIndex}`, sinCache: true,
  });
  if (String(r.data.values?.[0]?.[0] ?? '') !== String(id)) return false;
  await getSheets().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${hoja}!${colDesde}${rowIndex}:${colAnulado}${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[ahoraAR(), quien || '', '']] },
  });
  return true;
}

// Sella quién y cuándo modificó una fila (columnas modificadoEn / modificadoPor)
async function sellarModificacion(hoja, colEn, colPor, rowIndex, quien) {
  await getSheets().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${hoja}!${colEn}${rowIndex}:${colPor}${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[ahoraAR(), quien || '']] },
  });
}

/* ===================== REVISAR LA FILA ANTES DE ESCRIBIR =====================
   Todo se escribe por número de fila. Si alguien ordenó, insertó o borró filas
   a mano en la planilla, "la fila 45" pasaba a ser otro cliente y se le
   escribía encima. Antes de escribir se confirma que el id de esa fila sea el
   esperado; si no, no se toca nada y se pide recargar. Sin id no se puede
   comparar (pantallas viejas en caché): se sigue como antes. */
async function verificarFila(hoja, rowIndex, idEsperado) {
  if (!tieneCredenciales || !idEsperado) return;
  const r = await getSheets().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID, range: `${hoja}!A${rowIndex}`, sinCache: true,
  });
  const actual = String(r.data.values?.[0]?.[0] ?? '');
  if (actual !== String(idEsperado)) throw errorFilaMovida();
}

function errorFilaMovida() {
  const e = new Error('La planilla cambió mientras tanto (se movieron filas). Recargá la pantalla y volvé a intentar.');
  e.status = 409;
  return e;
}

function getSheets() {
  if (_clienteSheets) return _clienteSheets;
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    credentials: credencialesJSON,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const cliente = google.sheets({ version: 'v4', auth });
  const valores = cliente.spreadsheets.values;

  const getOriginal = valores.get.bind(valores);
  valores.get = async (params, ...resto) => {
    // sinCache: lectura fresca obligatoria (p. ej. para calcular la próxima fila libre)
    const { sinCache, ...pedido } = params || {};
    params = pedido;
    const clave = JSON.stringify(params);
    let entrada = cacheLecturas.get(clave);
    if (sinCache || !entrada || Date.now() - entrada.ts >= TTL_LECTURA_MS) {
      const promesa = getOriginal(conLecturaReal(params), ...resto)
        .then(r => ({ data: normalizarLectura(r.data, params), status: r.status }));
      entrada = { ts: Date.now(), promesa };
      cacheLecturas.set(clave, entrada);
      // Si falla no queda guardado el error
      promesa.catch(() => { if (cacheLecturas.get(clave) === entrada) cacheLecturas.delete(clave); });
    }
    // Copia: hay funciones que modifican las filas que reciben
    return structuredClone(await entrada.promesa);
  };

  const conInvalidacion = (obj, metodo) => {
    const original = obj[metodo].bind(obj);
    obj[metodo] = async (...args) => {
      invalidarCacheSheets();
      try { return await original(...args); }
      finally { invalidarCacheSheets(); }
    };
  };
  ['update', 'append', 'batchUpdate', 'clear'].forEach(m => conInvalidacion(valores, m));
  conInvalidacion(cliente.spreadsheets, 'batchUpdate');

  // Todo pasa por acá antes de llegar a Google: ninguna escritura se salta el blindaje
  ['update', 'append', 'batchUpdate'].forEach(m => {
    const original = valores[m];
    valores[m] = (params, ...resto) => original(blindarParams(params), ...resto);
  });

  _clienteSheets = cliente;
  return cliente;
}

/* ===================== TEXTOS SIEMPRE COMO TEXTO =====================
   Se escribe con USER_ENTERED (así los números y fechas quedan como tales), pero
   eso hace que un texto que empieza con "=" se ejecute como fórmula. El nombre
   que alguien escribe en el formulario público /consulta llega hasta acá: con
   una fórmula podía leer otras celdas o mandarlas afuera.
   El apóstrofo inicial le dice a Sheets "esto es texto": no se ve en la celda y
   la API lo devuelve sin él. Los números (incluso negativos) no se tocan. */
const ARRANQUE_PELIGROSO = /^[=+\-@']/;
const ES_NUMERO = /^[+-]?\d+([.,]\d+)?$/;
// Número tal como lo escribe JavaScript: punto decimal, sin miles, sin ceros a la
// izquierda. Es lo que producen String(monto), los inputs numéricos, etc.
const NUMERO_JS = /^-?(0|[1-9]\d*)(\.\d+)?$/;

function blindarCelda(v) {
  // Los números viajan como número: la planilla está en locale es_ES y un texto
  // "1500.5" con USER_ENTERED se leía como la fecha "mayo del año 1500".
  if (typeof v === 'string' && NUMERO_JS.test(v) && Number.isSafeInteger(Math.trunc(Number(v)))) return Number(v);
  return typeof v === 'string' && ARRANQUE_PELIGROSO.test(v) && !ES_NUMERO.test(v) ? "'" + v : v;
}

/* ===================== LECTURA DEL VALOR REAL =====================
   Por defecto Google devuelve cada celda "como se ve", y eso depende del idioma
   de la planilla: en es_ES 1500,5 viene con coma y parseFloat lo lee 1500; un
   número con formato de moneda viene "$ 800.000". Se pide el valor real
   (UNFORMATTED_VALUE) y las fechas/horas como texto (FORMATTED_STRING), así
   "2026-09-28" y "21:30" siguen llegando igual que siempre. Los números se
   devuelven como texto con punto decimal, que es lo que el resto del código
   espera (compara '0', hace parseFloat, etc.). */
function conLecturaReal(params) {
  if (!params || params.valueRenderOption) return params; // quien pide otra cosa, la recibe
  return { ...params, valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' };
}

function normalizarLectura(data, params) {
  if (!data || !Array.isArray(data.values) || (params && params.valueRenderOption)) return data;
  const celda = v => typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v;
  return { ...data, values: data.values.map(f => (Array.isArray(f) ? f.map(celda) : f)) };
}

function blindarFilas(filas) {
  return Array.isArray(filas) ? filas.map(f => (Array.isArray(f) ? f.map(blindarCelda) : f)) : filas;
}

function blindarCuerpo(cuerpo) {
  // En batchUpdate el modo viene en el cuerpo; con RAW el apóstrofo quedaría escrito
  if (!cuerpo || typeof cuerpo !== 'object' || cuerpo.valueInputOption === 'RAW') return cuerpo;
  const nuevo = { ...cuerpo };
  if (nuevo.values) nuevo.values = blindarFilas(nuevo.values);
  if (Array.isArray(nuevo.data)) nuevo.data = nuevo.data.map(d => ({ ...d, values: blindarFilas(d.values) }));
  return nuevo;
}

function blindarParams(params) {
  if (!params || params.valueInputOption === 'RAW') return params; // RAW ya guarda todo literal
  const p = { ...params };
  if (p.resource) p.resource = blindarCuerpo(p.resource);
  if (p.requestBody) p.requestBody = blindarCuerpo(p.requestBody);
  return p;
}

/* ===================== PERSONAS ===================== */
// Columnas A-K: id, apellidoNombre, telefono, gmail, redSocial, origen,
//               tipoCliente, exclienteReferencia, exclienteNota, fechaCarga, cargadoPor

function rowToPersona(row, index) {
  return {
    rowIndex: index + 2,
    id: row[0] || '',
    apellidoNombre: row[1] || '',
    telefono: row[2] || '',
    gmail: row[3] || '',
    redSocial: row[4] || '',
    origen: row[5] || '',
    tipoCliente: row[6] || '',
    exclienteReferencia: row[7] || '',
    exclienteNota: row[8] || '',
    fechaCarga: row[9] || '',
    cargadoPor: row[10] || '',
    // Columna L: nota libre de la PERSONA (no del evento). Se muestra arriba de
    // todo en la ficha: es lo que hay que leer antes de llamarla.
    notaPersona: row[11] || '',
    // Rastro: última modificación (fecha y hora argentina) y quién la hizo
    modificadoEn: row[12] || '',
    modificadoPor: row[13] || '',
  };
}

function personaToRow(p) {
  return [
    p.id, p.apellidoNombre, p.telefono, p.gmail, p.redSocial,
    p.origen, p.tipoCliente, p.exclienteReferencia, p.exclienteNota,
    p.fechaCarga, p.cargadoPor, p.notaPersona,
    p.modificadoEn, p.modificadoPor,
  ].map(v => v || '');
}

/* ===================== EVENTOS ===================== */
// Columnas A-W: id, personaId, estado, cargadoPor, fechaCarga, tipoEvento,
//               formato, fechaEvento, estadoFecha, cantidadInvitados, turno,
//               presupuesto, montoPresupuesto, menuInfantil, otrosPedidos,
//               observaciones, proximoSeguimiento,
//               menuRecepcion, menuIslas, menuPrimerPlato, menuPrincipal, menuPostre,
//               nombreAgasajado

function rowToEvento(row, index) {
  return {
    rowIndex: index + 2,
    id: row[0] || '',
    personaId: row[1] || '',
    estado: row[2] || '',
    cargadoPor: row[3] || '',
    fechaCarga: row[4] || '',
    tipoEvento: row[5] || '',
    formato: row[6] || '',
    fechaEvento: row[7] || '',
    estadoFecha: row[8] || '',
    cantidadInvitados: row[9] || '',
    turno: row[10] || '',
    presupuesto: row[11] || '',
    montoPresupuesto: row[12] || '',
    menuInfantil: row[13] || '',
    otrosPedidos: row[14] || '',
    observaciones: row[15] || '',
    proximoSeguimiento: row[16] || '',
    menuRecepcion: row[17] || '',
    menuIslas: row[18] || '',
    menuPrimerPlato: row[19] || '',
    menuPrincipal: row[20] || '',
    menuPostre: row[21] || '',
    nombreAgasajado: row[22] || '',
    notaInterna: row[23] || '',
    // Modalidad de cobro: 'contado' | 'cuotas' | 'cubiertos'. La sena convive
    // con cualquiera de las tres, no es una modalidad.
    modalidadPago: row[24] || '',
    // Precio unitario del cubierto pactado para ESTE evento. Cuando sube, solo
    // afecta a los cubiertos todavia no pagados: los comprados quedan congelados
    // al precio que se pago, que es justamente lo que se le promete al cliente.
    precioCubierto: row[25] || '',
    // Rastro: última modificación (fecha y hora argentina) y quién la hizo.
    // También sirve para avisar si otra persona cambió la ficha mientras tanto.
    modificadoEn: row[26] || '',
    modificadoPor: row[27] || '',
    motivoCancelacion: row[28] || '',
    notaCancelacion: row[29] || '',
  };
}

function eventoToRow(e) {
  return [
    e.id, e.personaId, e.estado, e.cargadoPor, e.fechaCarga,
    e.tipoEvento, e.formato, e.fechaEvento, e.estadoFecha,
    e.cantidadInvitados, e.turno, e.presupuesto, e.montoPresupuesto,
    e.menuInfantil, e.otrosPedidos, e.observaciones, e.proximoSeguimiento,
    e.menuRecepcion, e.menuIslas, e.menuPrimerPlato, e.menuPrincipal, e.menuPostre,
    e.nombreAgasajado, e.notaInterna,
    e.modalidadPago || '', e.precioCubierto || '',
    e.modificadoEn || '', e.modificadoPor || '',
    e.motivoCancelacion || '', e.notaCancelacion || '',
  ].map(v => v || '');
}

// Combina Evento + Persona en un objeto plano backward-compatible con el frontend
function enrichEvento(evento, persona, eventosCount) {
  return {
    ...evento,
    apellidoNombre: persona?.apellidoNombre || '',
    telefono: persona?.telefono || '',
    gmail: persona?.gmail || '',
    redSocial: persona?.redSocial || '',
    origen: persona?.origen || '',
    tipoCliente: persona?.tipoCliente || '',
    exclienteReferencia: persona?.exclienteReferencia || '',
    exclienteNota: persona?.exclienteNota || '',
    notaPersona: persona?.notaPersona || '',
    personaRowIndex: persona?.rowIndex || null,
    eventosCount: eventosCount || 1,
  };
}

/* ===================== API PÚBLICA ===================== */

async function getPersonas() {
  if (!tieneCredenciales) return memPersonas.filter(p => p.id);
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Personas!A2:N',
  });
  return (res.data.values || []).map((row, i) => rowToPersona(row, i)).filter(p => p.id);
}

async function addPersona(data) {
  const id = generateId('PER');
  const now = hoyAR();
  const persona = { ...data, id, fechaCarga: data.fechaCarga || now, modificadoEn: ahoraAR(), modificadoPor: data.cargadoPor || '' };
  if (!tieneCredenciales) {
    persona.rowIndex = memPersonas.length + 2;
    memPersonas.push(persona);
    return persona;
  }
  const sheets = getSheets();
  await enFilaDeAlta('Personas', async () => {
    const nextRow = await proximaFila('Personas');
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Personas!A${nextRow}:N${nextRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [personaToRow(persona)] },
    });
    persona.rowIndex = nextRow;
  });
  return persona;
}

async function updatePersona(rowIndex, data) {
  if (!tieneCredenciales) {
    const idx = memPersonas.findIndex(p => p.rowIndex === rowIndex);
    if (idx !== -1) memPersonas[idx] = { ...memPersonas[idx], ...data };
    return data;
  }
  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Personas!A${rowIndex}:N${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [personaToRow(data)] },
  });
  return data;
}

async function getClientes() {
  if (!tieneCredenciales) {
    const personaMap = {};
    memPersonas.filter(p => p.id).forEach(p => { personaMap[p.id] = p; });
    const countMap = {};
    memEventos.filter(e => e.id).forEach(e => {
      countMap[e.personaId] = (countMap[e.personaId] || 0) + 1;
    });
    return memEventos.filter(e => e.id).map(e =>
      enrichEvento(e, personaMap[e.personaId], countMap[e.personaId])
    );
  }
  const sheets = getSheets();
  const [evRes, perRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Eventos!A2:AD' }),
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Personas!A2:N' }),
  ]);
  const personas = (perRes.data.values || []).map((row, i) => rowToPersona(row, i)).filter(p => p.id);
  const personaMap = {};
  personas.forEach(p => { personaMap[p.id] = p; });
  const eventos = (evRes.data.values || []).map((row, i) => rowToEvento(row, i)).filter(e => e.id);
  const countMap = {};
  eventos.forEach(e => { countMap[e.personaId] = (countMap[e.personaId] || 0) + 1; });
  return eventos.map(e => enrichEvento(e, personaMap[e.personaId], countMap[e.personaId]));
}

/* Pasar a Cancelado pide motivo (de la lista; "Otro" pide además la nota).
   Solo al pasar: editar un cancelado viejo que no tiene motivo no obliga a nada.
   Si deja de estar cancelado, el motivo se borra para no confundir. */
function exigirMotivoCancelacion(estadoAntes, ev) {
  if (ev.estado !== 'Cancelado') { ev.motivoCancelacion = ''; ev.notaCancelacion = ''; return; }
  if (estadoAntes === 'Cancelado') return;
  const e = new Error(!ev.motivoCancelacion
    ? 'Falta el motivo de la cancelación'
    : 'Con motivo "Otro" hay que escribir una nota');
  e.status = 400;
  if (!ev.motivoCancelacion) throw e;
  if (ev.motivoCancelacion === 'Otro' && !String(ev.notaCancelacion || '').trim()) throw e;
}

async function addCliente(data) {
  data = listas.normalizar('evento', data); // valores de lista siempre en su forma oficial
  const now = hoyAR();
  let persona;

  if (data.personaId) {
    const personas = await getPersonas();
    persona = personas.find(p => p.id === data.personaId);
  }

  if (!persona) {
    persona = await addPersona({
      apellidoNombre: data.apellidoNombre,
      telefono: data.telefono,
      gmail: data.gmail,
      redSocial: data.redSocial,
      origen: data.origen,
      tipoCliente: data.tipoCliente,
      exclienteReferencia: data.exclienteReferencia,
      exclienteNota: data.exclienteNota,
      cargadoPor: data.cargadoPor,
    });
  }

  const eventoId = generateId('EVT');
  const evento = {
    id: eventoId,
    personaId: persona.id,
    estado: data.estado,
    cargadoPor: data.cargadoPor,
    fechaCarga: now,
    modificadoEn: ahoraAR(),
    modificadoPor: data.cargadoPor || '',
    tipoEvento: data.tipoEvento,
    formato: data.formato,
    fechaEvento: data.fechaEvento,
    estadoFecha: data.estadoFecha,
    cantidadInvitados: data.cantidadInvitados,
    turno: data.turno,
    presupuesto: data.presupuesto,
    montoPresupuesto: data.montoPresupuesto,
    menuInfantil: data.menuInfantil,
    otrosPedidos: data.otrosPedidos,
    observaciones: data.observaciones,
    proximoSeguimiento: data.proximoSeguimiento,
    menuRecepcion: data.menuRecepcion,
    menuIslas: data.menuIslas,
    menuPrimerPlato: data.menuPrimerPlato,
    menuPrincipal: data.menuPrincipal,
    menuPostre: data.menuPostre,
    nombreAgasajado: data.nombreAgasajado,
    notaInterna: data.notaInterna,
    modalidadPago: data.modalidadPago, precioCubierto: data.precioCubierto,
    motivoCancelacion: data.motivoCancelacion, notaCancelacion: data.notaCancelacion,
  };
  exigirMotivoCancelacion('', evento);

  if (!tieneCredenciales) {
    evento.rowIndex = memEventos.length + 2;
    memEventos.push(evento);
    registrarEstado(eventoId, '', evento.estado, data.cargadoPor);
    return enrichEvento(evento, persona, 1);
  }

  const sheets = getSheets();
  await enFilaDeAlta('Eventos', async () => {
    const nextRow = await proximaFila('Eventos');
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Eventos!A${nextRow}:AD${nextRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [eventoToRow(evento)] },
    });
    evento.rowIndex = nextRow;
  });
  registrarEstado(eventoId, '', evento.estado, data.cargadoPor);
  return enrichEvento(evento, persona, 1);
}

async function updateCliente(rowIndex, data) {
  data = listas.normalizar('evento', data); // valores de lista siempre en su forma oficial
  // rowIndex = fila en hoja Eventos
  // data.personaRowIndex = fila en hoja Personas (si se envía, se actualiza la persona también)
  if (!tieneCredenciales) {
    const eIdx = memEventos.findIndex(e => e.rowIndex === rowIndex);
    if (eIdx !== -1) {
      if (data.estado !== undefined) registrarEstado(memEventos[eIdx].id, memEventos[eIdx].estado, data.estado, data.modificadoPor);
      memEventos[eIdx] = {
        ...memEventos[eIdx],
        estado: data.estado, tipoEvento: data.tipoEvento, formato: data.formato,
        fechaEvento: data.fechaEvento, estadoFecha: data.estadoFecha,
        cantidadInvitados: data.cantidadInvitados, turno: data.turno,
        presupuesto: data.presupuesto, montoPresupuesto: data.montoPresupuesto,
        menuInfantil: data.menuInfantil, otrosPedidos: data.otrosPedidos,
        observaciones: data.observaciones, proximoSeguimiento: data.proximoSeguimiento,
        menuRecepcion: data.menuRecepcion, menuIslas: data.menuIslas,
        menuPrimerPlato: data.menuPrimerPlato, menuPrincipal: data.menuPrincipal,
        menuPostre: data.menuPostre, nombreAgasajado: data.nombreAgasajado,
        notaInterna: data.notaInterna,
        modalidadPago: data.modalidadPago, precioCubierto: data.precioCubierto,
    modalidadPago: data.modalidadPago, precioCubierto: data.precioCubierto,
      };
    }
    if (data.personaRowIndex) {
      const pIdx = memPersonas.findIndex(p => p.rowIndex === data.personaRowIndex);
      if (pIdx !== -1) {
        memPersonas[pIdx] = {
          ...memPersonas[pIdx],
          apellidoNombre: data.apellidoNombre, telefono: data.telefono,
          gmail: data.gmail, redSocial: data.redSocial, origen: data.origen,
          tipoCliente: data.tipoCliente, exclienteReferencia: data.exclienteReferencia,
          exclienteNota: data.exclienteNota,
        };
      }
    }
    return data;
  }

  const sheets = getSheets();
  // Fila actual del evento y de la persona, con lectura fresca. Sirve para tres
  // cosas: revisar que sigan siendo el mismo registro (se movieron filas?),
  // avisar si otra persona la cambió mientras tanto, y CONSERVAR lo que el
  // pedido no trae. Antes se reescribía la fila entera con lo que mandaba la
  // pantalla, y el formulario "Editar" no manda menús, modalidad de pago,
  // precio del cubierto, red social ni nota de la persona: se borraban.
  const [evRes, perRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `Eventos!A${rowIndex}:AD${rowIndex}`, sinCache: true }),
    data.personaRowIndex
      ? sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `Personas!A${data.personaRowIndex}:N${data.personaRowIndex}`, sinCache: true })
      : null,
  ]);
  const actualEv = rowToEvento(evRes.data.values?.[0] || [], rowIndex - 2);
  const actualPer = perRes ? rowToPersona(perRes.data.values?.[0] || [], data.personaRowIndex - 2) : null;
  if (data.id && actualEv.id !== String(data.id)) throw errorFilaMovida();
  if (actualPer && data.personaId && actualPer.id !== String(data.personaId)) throw errorFilaMovida();

  // Edición simultánea: la pantalla manda el modificadoEn que vio al abrir la
  // ficha. Si desde entonces la cambió OTRA persona, no se pisa. Si fue la misma
  // (otra pestaña, un guardado anterior) se sigue: no es un conflicto real.
  const quien = data.modificadoPor || '';
  if (data.modificadoEn !== undefined && actualEv.modificadoEn
      && actualEv.modificadoEn !== data.modificadoEn
      && actualEv.modificadoPor.toLowerCase() !== quien.toLowerCase()) {
    const hora = (actualEv.modificadoEn.match(/\d{2}:\d{2}/) || [''])[0];
    const e = new Error(`${actualEv.modificadoPor || 'Otra persona'} cambió esta ficha${hora ? ' a las ' + hora : ''} mientras la tenías abierta. Recargá para ver sus cambios y volvé a hacer el tuyo.`);
    e.status = 409;
    throw e;
  }

  const ahora = ahoraAR();
  const eventoData = {
    ...actualEv,
    ...soloDefinidos(data, CAMPOS_EVENTO_EDITABLES),
    id: actualEv.id || data.id,
    personaId: actualEv.personaId || data.personaId,
    // Quién lo cargó y cuándo no cambian al editar
    cargadoPor: actualEv.cargadoPor || data.cargadoPor,
    fechaCarga: actualEv.fechaCarga || data.fechaCarga,
    modificadoEn: ahora,
    modificadoPor: quien,
  };
  exigirMotivoCancelacion(actualEv.estado, eventoData);

  const ops = [
    sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Eventos!A${rowIndex}:AD${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [eventoToRow(eventoData)] },
    }),
  ];

  if (actualPer) {
    const personaData = {
      ...actualPer,
      ...soloDefinidos(data, CAMPOS_PERSONA_EDITABLES),
      id: actualPer.id || data.personaId,
      fechaCarga: actualPer.fechaCarga || data.fechaCarga,
      cargadoPor: actualPer.cargadoPor || data.cargadoPor,
      modificadoEn: ahora,
      modificadoPor: quien,
    };
    ops.push(
      sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Personas!A${data.personaRowIndex}:N${data.personaRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [personaToRow(personaData)] },
      })
    );
  }

  await Promise.all(ops);
  registrarEstado(eventoData.id, actualEv.estado, eventoData.estado, quien);
  return { ...data, modificadoEn: ahora, modificadoPor: quien };
}

// Campos que una edición puede cambiar (id, persona, alta y rastro no)
const CAMPOS_EVENTO_EDITABLES = [
  'estado', 'tipoEvento', 'formato', 'fechaEvento', 'estadoFecha', 'cantidadInvitados',
  'turno', 'presupuesto', 'montoPresupuesto', 'menuInfantil', 'otrosPedidos', 'observaciones',
  'proximoSeguimiento', 'menuRecepcion', 'menuIslas', 'menuPrimerPlato', 'menuPrincipal',
  'menuPostre', 'nombreAgasajado', 'notaInterna', 'modalidadPago', 'precioCubierto',
  'motivoCancelacion', 'notaCancelacion',
];
const CAMPOS_PERSONA_EDITABLES = [
  'apellidoNombre', 'telefono', 'gmail', 'redSocial', 'origen', 'tipoCliente',
  'exclienteReferencia', 'exclienteNota', 'notaPersona',
];

// Solo los campos que el pedido trae: lo que no vino se conserva como estaba
function soloDefinidos(data, campos) {
  const r = {};
  for (const k of campos) if (data[k] !== undefined) r[k] = data[k];
  return r;
}

/* ===================== INGRESOS ===================== */
// Deriva 'YYYY-MM' de una fecha ISO o dd/mm/yyyy. Sirve para tablas dinamicas.
function periodoDe(fecha) {
  const f = String(fecha || '').trim();
  let m = f.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  m = f.match(/^\d{1,2}\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[2]}-${String(m[1]).padStart(2, '0')}`;
  return '';
}
function rowToIngreso(row, index) {
  return {
    rowIndex: index + 2,
    id: row[0] || '',
    idCliente: row[1] || '',
    tipoIngreso: row[2] || '',
    monto: row[3] || '',
    fecha: row[4] || '',
    formaPago: row[5] || '',
    notas: row[6] || '',
    moneda: row[7] || 'ARS',
    confirmado: row[8] !== '0',
    cliente: row[9] || '',
    fechaEvento: row[10] || '',
    periodo: row[11] || '',
    // Modalidad "pago por cubierto": cada cobro compra un lote de cubiertos y
    // les congela el precio. Se guarda el precio usado para que el congelamiento
    // quede documentado en la propia fila y no dependa de nada externo.
    cubiertos: parseFloat(row[12]) || 0,
    precioCubierto: parseFloat(row[13]) || 0,
    cotizacion: parseFloat(row[14]) || 0,   // dolar usado, si se pago en USD
    montoARS: parseFloat(row[15]) || 0,     // el importe ya convertido a pesos
    // Quién lo cargó (Mariana, Fabio, bot...). Hasta sep/2026 no se guardaba y
    // todo cobro quedaba "sin dueño": la bandeja por persona no los encontraba.
    cargadoPor: row[16] || '',
    // Rastro y anulación (desde 28/09/2026). Un cobro borrado ya no se vacía:
    // queda marcado anulado=1 con quién y cuándo en modificadoEn/Por.
    creadoEn: row[17] || '',
    modificadoEn: row[18] || '',
    modificadoPor: row[19] || '',
    anulado: row[20] === '1',
  };
}

function ingresoToRow(i) {
  return [
    i.id, i.idCliente, i.tipoIngreso, i.monto, i.fecha, i.formaPago, i.notas,
    i.moneda || 'ARS', i.confirmado === false ? '0' : '1',
    i.cliente || '', i.fechaEvento || '', i.periodo || periodoDe(i.fecha),
    i.cubiertos || '', i.precioCubierto || '', i.cotizacion || '', i.montoARS || '',
    i.cargadoPor || '',
    i.creadoEn || '', i.modificadoEn || '', i.modificadoPor || '', i.anulado ? '1' : '',
  ].map(v => (v !== undefined && v !== null) ? String(v) : '');
}

// Descarta filas sin id, igual que getEgresos: son huecos que deja deleteIngreso
// (vacía la fila en vez de borrarla, para no correr los rowIndex) o filas
// escritas a medias. El rowIndex se calcula ANTES de filtrar, así sigue
// apuntando a la fila real de la planilla.
// Tambien descarta las filas "fantasma": id y nada mas, sin monto ni fecha. Las
// creaba POST /api/ingresos antes de validar el cuerpo. Se ignoran al leer en
// vez de borrarlas de la planilla: mismo resultado, sin escribir en produccion.
const esIngresoFantasma = i => !(parseFloat(i.monto) > 0) && !String(i.fecha || '').trim();

async function getIngresos() {
  if (!tieneCredenciales) return memIngresos.filter(i => i.id && !esIngresoFantasma(i) && !i.anulado);
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Ingresos!A2:U',
  });
  // Los anulados quedan en la planilla (historia) pero no cuentan en la app
  return (res.data.values || []).map((row, i) => rowToIngreso(row, i))
    .filter(i => i.id && !esIngresoFantasma(i) && !i.anulado);
}

async function addIngreso(data) {
  data = listas.normalizar('ingreso', data); // valores de lista siempre en su forma oficial
  const id = generateId('ING');
  // El bot manda confirmado:false explícito; si no viene, regla histórica (empleado = sin confirmar).
  const confirmado = data.confirmado !== undefined
    ? data.confirmado
    : (data.cargadoPor === 'empleado' ? false : true);
  const ahora = ahoraAR();
  const ingreso = { ...data, id, confirmado, periodo: periodoDe(data.fecha),
    creadoEn: ahora, modificadoEn: ahora, modificadoPor: data.cargadoPor || '' };
  if (!tieneCredenciales) {
    ingreso.rowIndex = memIngresos.length + 2;
    memIngresos.push(ingreso);
    return ingreso;
  }
  const sheets = getSheets();
  await enFilaDeAlta('Ingresos', async () => {
    const nextRow = await proximaFila('Ingresos');
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Ingresos!A${nextRow}:U${nextRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [ingresoToRow(ingreso)] },
    });
    ingreso.rowIndex = nextRow;
  });
  return ingreso;
}

async function confirmarIngreso(rowIndex, idEsperado, quien = '') {
  if (!tieneCredenciales) {
    const idx = memIngresos.findIndex(i => i.rowIndex === rowIndex);
    if (idx !== -1) memIngresos[idx].confirmado = true;
    return;
  }
  const sheets = getSheets();
  await verificarFila('Ingresos', rowIndex, idEsperado);
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { valueInputOption: 'USER_ENTERED', data: [
      { range: `Ingresos!I${rowIndex}`, values: [['1']] },
      { range: `Ingresos!S${rowIndex}:T${rowIndex}`, values: [[ahoraAR(), quien]] },
    ] },
  });
}

// "Borrar" un cobro (descartar un borrador o sacar uno cargado mal). Un
// movimiento de plata no se borra: se marca anulado=1, con quién y cuándo. Deja
// de contar en la app, pero la historia queda en la planilla. Antes se vaciaba
// la fila y no quedaba rastro de que había existido.
async function deleteIngreso(rowIndex, idEsperado, quien = '') {
  if (!tieneCredenciales) {
    const idx = memIngresos.findIndex(x => x.rowIndex === rowIndex);
    if (idx !== -1) memIngresos[idx].anulado = true;
    return { ok: true };
  }
  const sheets = getSheets();
  await verificarFila('Ingresos', rowIndex, idEsperado);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Ingresos!S${rowIndex}:U${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[ahoraAR(), quien, '1']] },
  });
  return { ok: true };
}

// Devuelve a la vida una fila borrada: escribe A:P, con el id incluido.
// updateIngreso no sirve para esto porque empieza en B y la fila quedaria sin id.
async function restaurarIngreso(rowIndex, data, quien = '') {
  data = listas.normalizar('ingreso', data); // valores de lista siempre en su forma oficial
  if (!tieneCredenciales) {
    const idx = memIngresos.findIndex(i => i.rowIndex === rowIndex);
    const fila = { ...data, rowIndex, anulado: false };
    if (idx !== -1) memIngresos[idx] = fila; else memIngresos.push(fila);
    return fila;
  }
  // Lo normal: la fila sigue ahí, anulada. Deshacer = sacarle la marca.
  if (await desanular('Ingresos', 'S', 'U', rowIndex, data.id, quien)) return { ...data, rowIndex, anulado: false };
  // Cobros borrados antes del 28/09/2026 (fila vaciada): se reescriben
  return restaurarEnSuLugar('Ingresos', 'U', rowIndex, { ...data, anulado: false }, ingresoToRow);
}

// Edita un ingreso (columnas B:P, sin tocar el id ni forzar confirmado).
// El confirmado se preserva desde data: el modal manda el valor original, asi
// un borrador editado sigue siendo borrador y uno confirmado sigue confirmado.
async function updateIngreso(rowIndex, data) {
  data = listas.normalizar('ingreso', data); // valores de lista siempre en su forma oficial
  if (!tieneCredenciales) {
    const idx = memIngresos.findIndex(i => i.rowIndex === rowIndex);
    if (idx !== -1) memIngresos[idx] = { ...memIngresos[idx], ...data, rowIndex };
    return memIngresos[idx] || { ...data, rowIndex };
  }
  const sheets = getSheets();
  await verificarFila('Ingresos', rowIndex, data.id);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Ingresos!B${rowIndex}:P${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[
        data.idCliente || '', data.tipoIngreso || '', data.monto || '',
        data.fecha || '', data.formaPago || '', data.notas || '',
        data.moneda || 'ARS', data.confirmado === false ? '0' : '1',
        data.cliente || '', data.fechaEvento || '', periodoDe(data.fecha),
        data.cubiertos || '', data.precioCubierto || '', data.cotizacion || '', data.montoARS || '',
      ]],
    },
  });
  await sellarModificacion('Ingresos', 'S', 'T', rowIndex, data.modificadoPor);
  return { ...data, rowIndex };
}

/* ===================== CONFIGURACION GENERAL =====================
 * Hoja Config (A: clave, B: valor). Guarda ajustes del salon que no pertenecen
 * a ningun evento: hoy, el precio general del cubierto que se propone al crear
 * un evento nuevo.
 * ============================================================================= */
let memConfig = {};

async function getConfig() {
  if (!tieneCredenciales) return { ...memConfig };
  const sheets = getSheets();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Config!A2:B',
    });
    const cfg = {};
    (res.data.values || []).forEach(r => { if (r[0]) cfg[r[0]] = r[1] || ''; });
    return cfg;
  } catch { return {}; }
}

async function setConfig(clave, valor) {
  if (!tieneCredenciales) { memConfig[clave] = String(valor); return { [clave]: String(valor) }; }
  const sheets = getSheets();
  // Misma fila de espera que las altas: dos claves nuevas a la vez (vistas
  // guardadas de dos personas) caían en la misma fila y una se perdía.
  await enFilaDeAlta('Config', async () => {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Config!A2:B',
      sinCache: true,
    });
    const filas = res.data.values || [];
    const idx = filas.findIndex(r => r[0] === clave);
    const fila = idx === -1 ? filas.length + 2 : idx + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Config!A${fila}:B${fila}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[clave, String(valor)]] },
    });
  });
  return { [clave]: String(valor) };
}

/* ===================== PAGO POR CUBIERTO =====================
 * El cliente compra cubiertos al precio del dia y se los congela. Si despues
 * el precio sube, solo afecta a los cubiertos que todavia no pago. Es una
 * cobertura contra inflacion para el cliente y plata real anticipada para el
 * salon.
 *
 * Nada de esto se guarda calculado "al total": cada fila de Ingresos guarda
 * cuantos cubiertos compro y a que precio, asi el congelamiento queda
 * documentado pago por pago y se puede auditar en la planilla.
 *
 * OJO: calcularCompraCubiertos() esta duplicada en frontend/js/app.js para la
 * vista previa. Si cambia una, hay que cambiar la otra.
 * ========================================================================= */

// Cuantos cubiertos compra un importe, redondeando SIEMPRE para abajo.
// Lo que sobra no se pierde: queda a favor y se suma al proximo pago.
function calcularCompraCubiertos(montoARS, saldoPrevio, precio, cubiertosRestantes) {
  const disponible = (montoARS || 0) + (saldoPrevio || 0);
  if (!(precio > 0)) return { cubiertos: 0, usado: 0, saldoNuevo: disponible, excedente: 0 };

  let cubiertos = Math.floor(disponible / precio);
  let excedente = 0;
  // No se pueden comprar mas cubiertos que los que tiene el evento.
  if (cubiertosRestantes !== null && cubiertosRestantes !== undefined && cubiertos > cubiertosRestantes) {
    cubiertos = Math.max(0, cubiertosRestantes);
    excedente = disponible - cubiertos * precio;   // pago de mas: sobra plata
  }
  const usado = cubiertos * precio;
  return {
    cubiertos,
    usado,
    saldoNuevo: excedente > 0 ? 0 : disponible - usado,
    excedente,
  };
}

// Foto del evento: cuantos cubiertos lleva pagados, cuanto le queda a favor y
// cuanto le falta al precio de hoy.
function estadoCubiertos(evento, ingresosDelEvento) {
  const precio = parseFloat(evento.precioCubierto) || 0;
  const total = parseInt(evento.cantidadInvitados) || 0;
  const pagos = (ingresosDelEvento || []).filter(i => i.confirmado !== false);

  const cubiertosPagados = pagos.reduce((s, i) => s + (parseFloat(i.cubiertos) || 0), 0);
  // El saldo a favor es lo que se pago menos lo que efectivamente se convirtio
  // en cubiertos. Se deriva, no se guarda: asi no hay dos numeros que puedan
  // dejar de coincidir.
  const totalPagadoARS = pagos.reduce(
    (s, i) => s + (parseFloat(i.montoARS) || parseFloat(i.monto) || 0), 0);
  const aplicadoACubiertos = pagos.reduce(
    (s, i) => s + (parseFloat(i.cubiertos) || 0) * (parseFloat(i.precioCubierto) || 0), 0);
  const saldoAFavor = Math.max(0, totalPagadoARS - aplicadoACubiertos);

  const restantes = Math.max(0, total - cubiertosPagados);
  return {
    precio, total, cubiertosPagados, restantes, saldoAFavor, totalPagadoARS,
    faltaPagar: restantes * precio,
    completo: total > 0 && cubiertosPagados >= total,
  };
}

/* ===================== CUENTA DEL EVENTO (contado / pagos sueltos) =====================
 * "Tu evento vale X" y el cliente trae plata como puede y cuando puede. El
 * precio queda FIJO en pesos hasta el evento: no se indexa ni se congela nada.
 * Los dolares se pasan a pesos con la cotizacion del dia en que entraron, que
 * queda guardada en la fila del cobro (cotizacion / montoARS).
 * ========================================================================= */
// Cuanto vale en pesos un cobro; null si es en dolares y no tiene cotizacion
// (cobros viejos): esos se muestran aparte, nunca se suman como si fueran pesos.
function cobroEnPesos(i) {
  const monto = parseFloat(i.monto) || 0;
  if ((i.moneda || 'ARS') !== 'USD') return monto;
  const ars = parseFloat(i.montoARS) || 0;
  return ars > 0 ? ars : null;
}

function estadoCuenta(evento, ingresosDelEvento) {
  const vale = parseFloat(evento.montoPresupuesto) || 0;
  const pagos = (ingresosDelEvento || []).filter(i => i.confirmado !== false);
  let pagado = 0, usdSinConvertir = 0;
  pagos.forEach(i => {
    const ars = cobroEnPesos(i);
    if (ars === null) usdSinConvertir += parseFloat(i.monto) || 0;
    else pagado += ars;
  });
  return {
    vale, pagado, usdSinConvertir,
    cantidadPagos: pagos.length,
    falta: Math.max(0, vale - pagado),
    aFavor: Math.max(0, pagado - vale),
    completo: vale > 0 && pagado >= vale - 0.5,
    sinConfirmar: (ingresosDelEvento || []).filter(i => i.confirmado === false).length,
  };
}

/* ===================== RESTRICCIONES ===================== */
function rowToRestriccion(row, index) {
  return {
    rowIndex: index + 2,
    id: row[0] || '',
    idCliente: row[1] || '',
    tipoRestriccion: row[2] || '',
    cantidad: row[3] || '',
    coronita: row[4] === true || String(row[4]).toLowerCase() === 'true',
  };
}

function restriccionToRow(r) {
  return [r.id, r.idCliente, r.tipoRestriccion, r.cantidad, r.coronita ? 'true' : 'false'].map(v => v || '');
}

async function getRestricciones() {
  if (!tieneCredenciales) return memRestricciones;
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Restricciones!A2:E',
  });
  return (res.data.values || []).map((row, i) => rowToRestriccion(row, i));
}

async function addRestriccion(data) {
  const id = generateId('RES');
  const r = { ...data, id };
  if (!tieneCredenciales) {
    r.rowIndex = memRestricciones.length + 2;
    memRestricciones.push(r);
    return r;
  }
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Restricciones!A:E',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [restriccionToRow(r)] },
  });
  return r;
}

async function deleteRestriccion(rowIndex) {
  if (!tieneCredenciales) {
    memRestricciones = memRestricciones.filter(r => r.rowIndex !== rowIndex);
    return;
  }
  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Restricciones!A${rowIndex}:E${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [['', '', '', '', '']] },
  });
}

/* ===================== TIMMING ===================== */
// Columnas A-F: id, idCliente, hora, actividad, tipo, descripcion
// tipo: 'maitre' (default) | 'cocina' (datos JSON del menú cocina en actividad)

function rowToTimming(row, index) {
  return {
    rowIndex: index + 2,
    id: row[0] || '',
    idCliente: row[1] || '',
    hora: row[2] || '',
    actividad: row[3] || '',
    tipo: row[4] || 'maitre',
    descripcion: row[5] || '',
    // Lo que toca la maître desde el celular (link /t/...). La hora que corre
    // pisa la C; la del plan queda en horaOriginal para no perderla nunca.
    hecho: row[6] === 'si',
    horaOriginal: row[7] || '',
    notas: parseNotas(row[8]),
  };
}

function parseNotas(v) {
  try { const n = JSON.parse(v || '[]'); return Array.isArray(n) ? n : []; } catch { return []; }
}

function timmingToRow(t) {
  return [t.id, t.idCliente, t.hora, t.actividad, t.tipo || 'maitre', t.descripcion || ''].map(v => String(v || ''));
}

// Treats 00:00–07:59 as "next day" so cross-midnight events sort correctly
function toEventMinutes(hora) {
  const [h, m] = (hora || '00:00').split(':').map(Number);
  const total = h * 60 + (m || 0);
  return total < 8 * 60 ? total + 24 * 60 : total;
}

async function getTimming(idCliente) {
  if (!tieneCredenciales) {
    return memTimming.filter(t => t.idCliente === idCliente).sort((a, b) => toEventMinutes(a.hora) - toEventMinutes(b.hora));
  }
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Timming!A2:I',
  });
  return (res.data.values || [])
    .map((row, i) => rowToTimming(row, i))
    .filter(t => t.idCliente === idCliente && t.id)
    .sort((a, b) => toEventMinutes(a.hora) - toEventMinutes(b.hora));
}

async function addTimmingItem(data) {
  const id = generateId('TIM');
  const item = { ...data, id };
  if (!tieneCredenciales) {
    item.rowIndex = memTimming.length + 2;
    memTimming.push(item);
    return item;
  }
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Timming!A:F',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [timmingToRow(item)] },
  });
  return item;
}

async function updateTimmingItem(rowIndex, data) {
  if (!tieneCredenciales) {
    const idx = memTimming.findIndex(t => t.rowIndex === rowIndex);
    if (idx !== -1) Object.assign(memTimming[idx], data);
    return { ok: true };
  }
  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Timming!C${rowIndex}:F${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[data.hora, data.actividad, data.tipo || 'maitre', data.descripcion || '']] },
  });
  return { ok: true };
}

async function deleteTimmingItem(rowIndex) {
  if (!tieneCredenciales) {
    memTimming = memTimming.filter(t => t.rowIndex !== rowIndex);
    return;
  }
  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Timming!A${rowIndex}:I${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [['', '', '', '', '', '', '', '', '']] },
  });
}

/* Cambios que llegan desde el celular de la maître: hora (si corrió), tilde,
   hora del plan y notas. No toca actividad ni descripción: eso es del CRM.
   RAW para que "22:45" no se convierta en un número de hora de Sheets. */
async function updateTimmingVivo(pasos) {
  if (!tieneCredenciales) {
    pasos.forEach(p => {
      const t = memTimming.find(x => x.rowIndex === p.rowIndex);
      if (t) Object.assign(t, { hora: p.hora, hecho: p.hecho, horaOriginal: p.horaOriginal, notas: p.notas });
    });
    return { ok: true };
  }
  if (!pasos.length) return { ok: true };
  const sheets = getSheets();
  const data = [];
  pasos.forEach(p => {
    data.push({ range: `Timming!C${p.rowIndex}`, values: [[p.hora]] });
    data.push({ range: `Timming!G${p.rowIndex}:I${p.rowIndex}`,
      values: [[p.hecho ? 'si' : '', p.horaOriginal || '', p.notas?.length ? JSON.stringify(p.notas) : '']] });
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { valueInputOption: 'RAW', data },
  });
  return { ok: true };
}

/* ===================== CUOTAS ===================== */
// Columnas A-N: id, idCliente (=idEvento), numeroCuota, valorOriginal, valorActual,
//               fechaVencimiento, estado, fechaPago, montoPagado, notas, moneda, indexacion,
//               confirmado, ipcHasta (ultimo mes del INDEC ya incorporado, AAAA-MM)

function rowToCuota(row, index) {
  return {
    rowIndex: index + 2,
    id: row[0] || '',
    idCliente: row[1] || '',
    numeroCuota: parseInt(row[2]) || 0,
    valorOriginal: parseFloat(row[3]) || 0,
    valorActual: parseFloat(row[4]) || 0,
    fechaVencimiento: row[5] || '',
    estado: row[6] || 'pendiente',
    fechaPago: row[7] || '',
    montoPagado: parseFloat(row[8]) || 0,
    notas: row[9] || '',
    moneda: row[10] || 'ARS',
    indexacion: row[11] || 'fija',
    confirmado: row[12] !== '0',
    ipcHasta: row[13] || '',
  };
}

function cuotaToRow(c) {
  return [
    c.id, c.idCliente, c.numeroCuota, c.valorOriginal, c.valorActual,
    c.fechaVencimiento, c.estado, c.fechaPago || '', c.montoPagado || 0, c.notas || '',
    c.moneda || 'ARS', c.indexacion || 'fija', c.confirmado === false ? '0' : '1',
    c.ipcHasta || '',
  ].map(v => (v !== undefined && v !== null) ? String(v) : '');
}

// Todas las cuotas vigentes, para el dashboard externo (quien debe plata).
async function getAllCuotas() {
  if (!tieneCredenciales) return memCuotas.filter(c => c.estado !== 'cancelada');
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Cuotas!A2:N',
  });
  return (res.data.values || [])
    .map((row, i) => rowToCuota(row, i))
    .filter(c => c.id && c.estado !== 'cancelada');
}

async function getCuotasByCliente(idCliente) {
  if (!tieneCredenciales) {
    return memCuotas.filter(c => c.idCliente === idCliente && c.estado !== 'cancelada');
  }
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Cuotas!A2:N',
  });
  return (res.data.values || [])
    .map((row, i) => rowToCuota(row, i))
    .filter(c => c.idCliente === idCliente && c.estado !== 'cancelada');
}

// opts.numeroInicial: para sumar cuotas a un plan que ya existe (siguen la
// numeracion en vez de arrancar otra vez en 1). opts.ipcHasta: ultimo mes del
// INDEC ya contemplado en el valor de la cuota, para que el ajuste automatico
// arranque desde el mes siguiente y no cobre inflacion ya incluida.
async function createPlan(idCliente, montoTotal, cantidadCuotas, valorCuota, fechaInicio, moneda = 'ARS', indexacion = 'fija', cargadoPor = '', opts = {}) {
  const valor = valorCuota || Math.round(montoTotal / cantidadCuotas);
  const confirmado = cargadoPor === 'empleado' ? false : true;
  const [y, m, d] = fechaInicio.split('-').map(Number);
  const cuotas = [];
  for (let i = 0; i < cantidadCuotas; i++) {
    const fecha = new Date(y, m - 1 + i, d);
    const fv = `${fecha.getFullYear()}-${String(fecha.getMonth()+1).padStart(2,'0')}-${String(fecha.getDate()).padStart(2,'0')}`;
    cuotas.push({
      id: generateId('CUO'),
      idCliente,
      numeroCuota: (opts.numeroInicial || 1) + i,
      valorOriginal: valor,
      valorActual: valor,
      fechaVencimiento: fv,
      estado: 'pendiente',
      fechaPago: '',
      montoPagado: 0,
      notas: '',
      moneda: moneda || 'ARS',
      indexacion: indexacion || 'fija',
      confirmado,
      ipcHasta: indexacion === 'ipc' ? (opts.ipcHasta || '') : '',
    });
  }
  if (!tieneCredenciales) {
    cuotas.forEach(c => { c.rowIndex = memCuotas.length + 2; memCuotas.push(c); });
    return cuotas;
  }
  const sheets = getSheets();
  await enFilaDeAlta('Cuotas', async () => {
    const nextRow = await proximaFila('Cuotas');
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Cuotas!A${nextRow}:N${nextRow + cuotas.length - 1}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: cuotas.map(cuotaToRow) },
    });
    cuotas.forEach((c, i) => { c.rowIndex = nextRow + i; });
  });
  return cuotas;
}

async function confirmarCuotas(rowIndices) {
  if (!tieneCredenciales) {
    rowIndices.forEach(ri => {
      const idx = memCuotas.findIndex(c => c.rowIndex === ri);
      if (idx !== -1) memCuotas[idx].confirmado = true;
    });
    return;
  }
  const sheets = getSheets();
  await Promise.all(rowIndices.map(ri =>
    sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Cuotas!M${ri}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [['1']] },
    })
  ));
}

/* ---------------------------------------------------------------------------
 * Imputacion automatica de un cobro sobre el plan de cuotas.
 *
 * El cliente tipico no paga "la cuota 4, completa, el dia que vence": trae lo
 * que puede cuando puede. A veces adelanta, a veces se atrasa y trae tres
 * juntas, a veces trae de menos. Obligar a alguien a traducir eso a mano a
 * "tildar cuotas" es de donde salia la mayoria de los datos sucios.
 *
 * Regla: la plata tapa las cuotas pendientes mas viejas primero. Lo que no
 * alcanza a cubrir una cuota entera la deja en 'parcial' con el monto real.
 * NUNCA se cobra recargo por mora aca: los atrasos se perdonan, es una
 * decision del negocio.
 *
 * OJO: calcularImputacion() esta duplicada en frontend/js/app.js para poder
 * mostrar la vista previa sin pegarle al servidor (que puede tardar ~50s en
 * despertar). Si cambia una, hay que cambiar la otra.
 * ------------------------------------------------------------------------- */
function calcularImputacion(cuotas, montoRecibido) {
  const pendientes = cuotas
    .filter(c => c.estado !== 'pagada' && c.estado !== 'cancelada')
    .sort((a, b) => a.numeroCuota - b.numeroCuota);

  let restante = montoRecibido;
  const aplicaciones = [];

  for (const c of pendientes) {
    if (restante <= 0.005) break;
    const debe = (c.valorActual || 0) - (c.montoPagado || 0);
    if (debe <= 0.005) continue;
    const aplicar = Math.min(restante, debe);
    const nuevoPagado = (c.montoPagado || 0) + aplicar;
    // Tolerancia de medio peso: evita que un redondeo deje una cuota
    // eternamente en 'parcial' por diferencias de centavos.
    const saldada = nuevoPagado >= (c.valorActual || 0) - 0.5;
    aplicaciones.push({
      rowIndex: c.rowIndex,
      numeroCuota: c.numeroCuota,
      valorActual: c.valorActual || 0,
      yaPagado: c.montoPagado || 0,
      aplicado: aplicar,
      nuevoPagado,
      restaDespues: Math.max(0, (c.valorActual || 0) - nuevoPagado),
      nuevoEstado: saldada ? 'pagada' : 'parcial',
    });
    restante -= aplicar;
  }
  // Sobrante: pago mas que todo lo que debia. Se registra igual como ingreso,
  // pero no se inventa una cuota para meterlo.
  return { aplicaciones, sobrante: Math.max(0, restante) };
}

/* ===================== COBROS "TODO O NADA" =====================
   Pagar cuotas son dos escrituras: marcar las cuotas y crear el cobro. Google
   Sheets no tiene transacciones: si la segunda fallaba, quedaban cuotas pagadas
   sin la plata registrada. Antes de marcar se saca una foto de cómo estaban
   (estado, fecha de pago, monto pagado, notas) y, si el cobro no se pudo crear,
   se devuelven a ese estado. */
async function fotoCuotas(rowIndices) {
  if (!tieneCredenciales || !rowIndices.length) return [];
  const res = await getSheets().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID, range: 'Cuotas!A2:J', sinCache: true,
  });
  const filas = res.data.values || [];
  return rowIndices.map(ri => {
    const f = filas[ri - 2] || [];
    return { rowIndex: ri, valores: [f[6] ?? '', f[7] ?? '', f[8] ?? '', f[9] ?? ''] };
  });
}

async function devolverCuotas(foto) {
  if (!tieneCredenciales || !foto.length) return;
  await getSheets().spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: {
      valueInputOption: 'USER_ENTERED',
      data: foto.map(f => ({ range: `Cuotas!G${f.rowIndex}:J${f.rowIndex}`, values: [f.valores] })),
    },
  });
}

// Las filas de cuotas que tocaría una imputación, sin escribir nada
async function filasDeImputacion(idCliente, montoRecibido) {
  const { aplicaciones } = calcularImputacion(await getCuotasByCliente(idCliente), montoRecibido);
  return aplicaciones.map(a => a.rowIndex);
}

async function imputarPago(idCliente, montoRecibido, fechaPago, notas) {
  const cuotas = await getCuotasByCliente(idCliente);
  const { aplicaciones, sobrante } = calcularImputacion(cuotas, montoRecibido);
  if (!aplicaciones.length) return { aplicaciones, sobrante };

  if (!tieneCredenciales) {
    aplicaciones.forEach(a => {
      const idx = memCuotas.findIndex(c => c.rowIndex === a.rowIndex);
      if (idx !== -1) {
        memCuotas[idx].estado = a.nuevoEstado;
        memCuotas[idx].fechaPago = fechaPago;
        memCuotas[idx].montoPagado = a.nuevoPagado;
        if (notas) memCuotas[idx].notas = notas;
      }
    });
    return { aplicaciones, sobrante };
  }

  const sheets = getSheets();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: {
      valueInputOption: 'USER_ENTERED',
      data: aplicaciones.map(a => ({
        range: `Cuotas!G${a.rowIndex}:J${a.rowIndex}`,
        values: [[a.nuevoEstado, fechaPago, a.nuevoPagado, notas || '']],
      })),
    },
  });
  return { aplicaciones, sobrante };
}

async function pagarCuotas(rowIndices, fechaPago, notas) {
  if (!tieneCredenciales) {
    rowIndices.forEach(ri => {
      const idx = memCuotas.findIndex(c => c.rowIndex === ri);
      if (idx !== -1) {
        memCuotas[idx].estado = 'pagada';
        memCuotas[idx].fechaPago = fechaPago;
        memCuotas[idx].montoPagado = memCuotas[idx].valorActual;
        memCuotas[idx].notas = notas || '';
      }
    });
    return;
  }
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Cuotas!A2:J',
  });
  const rows = res.data.values || [];
  const data = rowIndices.map(ri => {
    const row = rows[ri - 2] || [];
    const valorActual = parseFloat(row[4]) || 0;
    return {
      range: `Cuotas!G${ri}:J${ri}`,
      values: [['pagada', fechaPago, valorActual, notas || '']],
    };
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { valueInputOption: 'USER_ENTERED', data },
  });
}

// Suma cuotas a un plan que ya existe. Hereda moneda e indexacion del plan y
// sigue la numeracion: antes arrancaba otra vez en "Cuota 1" y quedaban dos
// cuotas 1, dos cuotas 2... y la imputacion automatica las mezclaba.
async function agregarCuotas(idCliente, cantidad, valorCuota, fechaInicio, ipcHasta = '', cargadoPor = '') {
  const existentes = await getCuotasByCliente(idCliente);
  if (!existentes.length) throw new Error('Este cliente todavía no tiene plan. Creá el plan primero.');
  const base = existentes[0];
  const siguiente = Math.max(...existentes.map(c => c.numeroCuota || 0)) + 1;
  return createPlan(idCliente, valorCuota * cantidad, cantidad, valorCuota, fechaInicio,
    base.moneda, base.indexacion, cargadoPor, { numeroInicial: siguiente, ipcHasta });
}

// 'parcial' tambien debe plata: cualquier ajuste la tiene que alcanzar.
const cuotaViva = c => c.estado === 'pendiente' || c.estado === 'parcial';

// El ajuste va sobre lo que falta pagar. Si una cuota de $100.000 ya tiene
// $40.000 cobrados, un 10% la lleva a $106.000, no a $110.000: lo que ya
// entro no se indexa.
function valorAjustado(c, factor) {
  const pagado = c.montoPagado || 0;
  const falta = Math.max(0, (c.valorActual || 0) - pagado);
  return Math.round(pagado + falta * factor);
}

// Escribe en bloque los cambios de valor / indexacion / ipcHasta de varias cuotas.
async function escribirCambiosCuotas(cambios) {
  if (!cambios.length) return;
  if (!tieneCredenciales) {
    cambios.forEach(ch => {
      const mc = memCuotas.find(x => x.rowIndex === ch.rowIndex);
      if (!mc) return;
      if (ch.valorActual !== undefined) mc.valorActual = ch.valorActual;
      if (ch.indexacion !== undefined) mc.indexacion = ch.indexacion;
      if (ch.ipcHasta !== undefined) mc.ipcHasta = ch.ipcHasta;
    });
    return;
  }
  const data = [];
  cambios.forEach(ch => {
    if (ch.valorActual !== undefined) data.push({ range: `Cuotas!E${ch.rowIndex}`, values: [[ch.valorActual]] });
    if (ch.indexacion !== undefined) data.push({ range: `Cuotas!L${ch.rowIndex}`, values: [[ch.indexacion]] });
    if (ch.ipcHasta !== undefined) data.push({ range: `Cuotas!N${ch.rowIndex}`, values: [[ch.ipcHasta]] });
  });
  await getSheets().spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { valueInputOption: 'RAW', data },
  });
}

// Ajuste manual por un % (planes de cuotas fijas).
async function aplicarIPC(idCliente, porcentaje) {
  const vivas = (await getCuotasByCliente(idCliente)).filter(cuotaViva);
  const factor = 1 + porcentaje / 100;
  await escribirCambiosCuotas(vivas.map(c => ({ rowIndex: c.rowIndex, valorActual: valorAjustado(c, factor) })));
  return { updated: vivas.length };
}

// Pasa un plan ya creado a indexado por IPC (o lo vuelve a fijo). Solo toca
// las cuotas que todavia deben algo. ipcHasta = ultimo IPC publicado: el valor
// de hoy ya lo incluye, asi que el ajuste arranca con el mes siguiente.
async function setIndexacionPlan(idCliente, indexacion, ipcHasta = '') {
  const vivas = (await getCuotasByCliente(idCliente)).filter(cuotaViva);
  const esIPC = indexacion === 'ipc';
  await escribirCambiosCuotas(vivas.map(c => ({
    rowIndex: c.rowIndex,
    indexacion: esIPC ? 'ipc' : 'fija',
    ipcHasta: esIPC ? (c.ipcHasta || ipcHasta) : '',
  })));
  return { updated: vivas.length };
}

/* ---------------------------------------------------------------------------
 * IPC AUTOMATICO
 * Cada cuota indexada guarda en ipcHasta el ultimo mes del INDEC que ya tiene
 * incorporado. Cuando el INDEC publica un mes nuevo, se aplica a las cuotas
 * que deben algo y se corre ipcHasta. Si pasaron varios meses sin aplicar
 * (el servidor de Render duerme), se encadenan todos, cada uno una sola vez.
 * Es idempotente: correrlo dos veces el mismo dia no cambia nada.
 *
 * serie: [{ mes: 'AAAA-MM', variacion: 1.66 }, ...] en orden ascendente.
 * ------------------------------------------------------------------------- */
async function aplicarIPCAutomatico(serie) {
  if (!serie || !serie.length) return [];
  const ultimo = serie[serie.length - 1].mes;
  const indexadas = (await getAllCuotas()).filter(c => c.indexacion === 'ipc' && cuotaViva(c));

  const cambios = [];
  const porCliente = {};
  indexadas.forEach(c => {
    if (!c.ipcHasta) {
      // Plan indexado de antes de este sistema: se toma hoy como punto de
      // partida, sin subir nada retroactivo por sorpresa.
      cambios.push({ rowIndex: c.rowIndex, ipcHasta: ultimo });
      return;
    }
    const meses = serie.filter(m => m.mes > c.ipcHasta);
    if (!meses.length) return;
    const factor = meses.reduce((f, m) => f * (1 + m.variacion / 100), 1);
    cambios.push({ rowIndex: c.rowIndex, valorActual: valorAjustado(c, factor), ipcHasta: ultimo });
    const r = porCliente[c.idCliente] || (porCliente[c.idCliente] = { idCliente: c.idCliente, cuotas: 0, meses });
    r.cuotas++;
  });
  await escribirCambiosCuotas(cambios);
  return Object.values(porCliente);
}

async function ajustarValorCuotas(idCliente, nuevoValor) {
  const vivas = (await getCuotasByCliente(idCliente)).filter(cuotaViva);
  // Una cuota parcial nunca puede quedar valiendo menos de lo que ya se cobro.
  await escribirCambiosCuotas(vivas.map(c => ({
    rowIndex: c.rowIndex, valorActual: Math.max(nuevoValor, c.montoPagado || 0),
  })));
  return { updated: vivas.length };
}

async function cancelarPlan(idCliente) {
  const cuotas = await getCuotasByCliente(idCliente);
  if (!cuotas.length) return;
  if (!tieneCredenciales) {
    cuotas.forEach(c => {
      const idx = memCuotas.findIndex(mc => mc.rowIndex === c.rowIndex);
      if (idx !== -1) memCuotas[idx].estado = 'cancelada';
    });
    return;
  }
  const sheets = getSheets();
  const data = cuotas.map(c => ({
    range: `Cuotas!G${c.rowIndex}`,
    values: [['cancelada']],
  }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { valueInputOption: 'USER_ENTERED', data },
  });
}

/* ===================== EMPLEADOS ===================== */
// Columnas A-C: id, nombre, activo

function rowToEmpleado(row, index) {
  return {
    rowIndex: index + 2,
    id: row[0] || '',
    nombre: row[1] || '',
    activo: row[2] !== 'false',
    // Columna D: el rol que hace siempre. Se propone al elegirlo en un gasto,
    // para no tener que decir en cada pago que Juan es mozo.
    rolHabitual: row[3] || '',
  };
}

function empleadoToRow(e) {
  return [e.id, e.nombre, e.activo !== false ? 'true' : 'false', e.rolHabitual || ''];
}

async function getEmpleados() {
  if (!tieneCredenciales) return memEmpleados.filter(e => e.id && e.activo !== false);
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Empleados!A2:D',
  });
  return (res.data.values || []).map((row, i) => rowToEmpleado(row, i))
    .filter(e => e.id && e.activo !== false);
}

async function addEmpleado(data) {
  const id = generateId('EMP');
  const e = { ...data, id, activo: true };
  if (!tieneCredenciales) {
    e.rowIndex = memEmpleados.length + 2;
    memEmpleados.push(e);
    return e;
  }
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Empleados!A:D',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [empleadoToRow(e)] },
  });
  return e;
}

async function updateEmpleado(rowIndex, data) {
  if (!tieneCredenciales) {
    const idx = memEmpleados.findIndex(e => e.rowIndex === rowIndex);
    if (idx !== -1) memEmpleados[idx] = { ...memEmpleados[idx], ...data };
    return data;
  }
  const sheets = getSheets();
  const actuales = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID, range: `Empleados!A${rowIndex}:D${rowIndex}`,
  });
  const fila = (actuales.data.values || [[]])[0] || [];
  const e = { ...rowToEmpleado(fila, rowIndex - 2), ...data };
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Empleados!A${rowIndex}:D${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [empleadoToRow(e)] },
  });
  return e;
}

/* ===================== EGRESOS ===================== */
// Columnas A-Q: id, fecha, concepto, categoria, monto, moneda,
//               idEmpleado, nombreEmpleado, rolPago, notas, cargadoPor, proveedor,
//               tipoCosto, idEvento, evento, periodo, confirmado
// tipoCosto: 'Fijo' (gasto general del salon) | 'Evento' (imputado a un evento puntual)
// confirmado (col Q): '0' = borrador por confirmar (ej. cargado por el bot desde un
//   audio); vacio o '1' = confirmado. Los egresos cargados a mano nacen confirmados;
//   los no confirmados no deben sumar en totales/reportes hasta que un humano los valide.
// evento/periodo se guardan desnormalizados a proposito: la planilla se analiza
// en Excel con tablas dinamicas y ahi un id opaco no sirve.

function rowToEgreso(row, index) {
  return {
    rowIndex: index + 2,
    id: row[0] || '',
    fecha: row[1] || '',
    concepto: row[2] || '',
    categoria: row[3] || '',
    monto: row[4] || '',
    moneda: row[5] || 'ARS',
    idEmpleado: row[6] || '',
    nombreEmpleado: row[7] || '',
    rolPago: row[8] || '',
    notas: row[9] || '',
    cargadoPor: row[10] || '',
    proveedor: row[11] || '',
    tipoCosto: row[12] || 'Fijo',
    idEvento: row[13] || '',
    evento: row[14] || '',
    periodo: row[15] || '',
    confirmado: row[16] !== '0',
    // Columnas R y S: si el gasto se pago en dolares, a que dolar se hizo y
    // cuanto fue en pesos. Los ingresos ya lo guardaban; el egreso no, y sin
    // esto un gasto en USD de hace meses no se puede comparar con nada.
    cotizacion: parseFloat(row[17]) || 0,
    montoARS: parseFloat(row[18]) || 0,
    // Rastro y anulación (desde 28/09/2026), igual que en Ingresos
    creadoEn: row[19] || '',
    modificadoEn: row[20] || '',
    modificadoPor: row[21] || '',
    anulado: row[22] === '1',
  };
}

function egresoToRow(e) {
  return [
    e.id, e.fecha, e.concepto, e.categoria,
    e.monto, e.moneda || 'ARS',
    e.idEmpleado || '', e.nombreEmpleado || '', e.rolPago || '',
    e.notas || '', e.cargadoPor || '',
    e.proveedor || '',
    e.tipoCosto || 'Fijo', e.idEvento || '', e.evento || '',
    e.periodo || periodoDe(e.fecha),
    e.confirmado === false ? '0' : '1',
    e.cotizacion || '', e.montoARS || '',
    e.creadoEn || '', e.modificadoEn || '', e.modificadoPor || '', e.anulado ? '1' : '',
  ].map(v => (v !== undefined && v !== null) ? String(v) : '');
}

async function getEgresos() {
  if (!tieneCredenciales) return memEgresos.filter(e => e.id && !e.anulado);
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Egresos!A2:W',
  });
  // Los anulados quedan en la planilla (historia) pero no cuentan en la app
  return (res.data.values || []).map((row, i) => rowToEgreso(row, i)).filter(e => e.id && !e.anulado);
}

async function addEgreso(data) {
  data = listas.normalizar('egreso', data); // valores de lista siempre en su forma oficial
  const id = generateId('EGR');
  const e = {
    ...data, id, periodo: periodoDe(data.fecha),
    tipoCosto: data.idEvento ? 'Evento' : 'Fijo',
    // Los egresos cargados a mano nacen confirmados; el bot los crea con confirmado:false.
    confirmado: data.confirmado !== undefined ? data.confirmado : true,
    creadoEn: ahoraAR(), modificadoEn: ahoraAR(), modificadoPor: data.cargadoPor || '',
  };
  if (!tieneCredenciales) {
    e.rowIndex = memEgresos.length + 2;
    memEgresos.push(e);
    return e;
  }
  const sheets = getSheets();
  // Escritura por fila explicita (no append) para poder devolver el rowIndex real:
  // sin el, el egreso recien cargado no se podia editar hasta recargar la pagina.
  await enFilaDeAlta('Egresos', async () => {
    const nextRow = await proximaFila('Egresos');
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Egresos!A${nextRow}:W${nextRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [egresoToRow(e)] },
    });
    e.rowIndex = nextRow;
  });
  return e;
}

// Igual que deleteIngreso: el gasto se anula (anulado=1), no se vacía la fila
async function deleteEgreso(rowIndex, idEsperado, quien = '') {
  if (!tieneCredenciales) {
    const idx = memEgresos.findIndex(x => x.rowIndex === rowIndex);
    if (idx !== -1) memEgresos[idx].anulado = true;
    return { ok: true };
  }
  const sheets = getSheets();
  await verificarFila('Egresos', rowIndex, idEsperado);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Egresos!U${rowIndex}:W${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[ahoraAR(), quien, '1']] },
  });
  return { ok: true };
}

// Espejo de restaurarIngreso: reescribe la fila entera, con el id.
async function restaurarEgreso(rowIndex, data, quien = '') {
  data = listas.normalizar('egreso', data); // valores de lista siempre en su forma oficial
  if (!tieneCredenciales) {
    const idx = memEgresos.findIndex(e => e.rowIndex === rowIndex);
    const fila = { ...data, rowIndex, anulado: false };
    if (idx !== -1) memEgresos[idx] = fila; else memEgresos.push(fila);
    return fila;
  }
  // Lo normal: la fila sigue ahí, anulada. Deshacer = sacarle la marca.
  if (await desanular('Egresos', 'U', 'W', rowIndex, data.id, quien)) return { ...data, rowIndex, anulado: false };
  // Gastos borrados antes del 28/09/2026 (fila vaciada): se reescriben
  return restaurarEnSuLugar('Egresos', 'W', rowIndex, { ...data, anulado: false }, egresoToRow);
}

async function updateEgreso(rowIndex, data) {
  data = listas.normalizar('egreso', data); // valores de lista siempre en su forma oficial
  if (!tieneCredenciales) {
    const idx = memEgresos.findIndex(x => x.rowIndex === rowIndex);
    if (idx !== -1) memEgresos[idx] = { ...memEgresos[idx], ...data, rowIndex };
    return memEgresos[idx] || { ...data, rowIndex };
  }
  const sheets = getSheets();
  await verificarFila('Egresos', rowIndex, data.id);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Egresos!B${rowIndex}:P${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[
        data.fecha || '', data.concepto || '', data.categoria || '',
        data.monto || '', data.moneda || 'ARS',
        data.idEmpleado || '', data.nombreEmpleado || '', data.rolPago || '',
        data.notas || '', data.cargadoPor || '', data.proveedor || '',
        data.idEvento ? 'Evento' : (data.tipoCosto || 'Fijo'),
        data.idEvento || '', data.evento || '', periodoDe(data.fecha),
      ]],
    },
  });
  await sellarModificacion('Egresos', 'U', 'V', rowIndex, data.modificadoPor);
  return { ...data, rowIndex };
}

// Confirma un egreso borrador (col Q -> '1'). Espejo de confirmarIngreso.
async function confirmarEgreso(rowIndex, idEsperado, quien = '') {
  if (!tieneCredenciales) {
    const idx = memEgresos.findIndex(x => x.rowIndex === rowIndex);
    if (idx !== -1) memEgresos[idx].confirmado = true;
    return;
  }
  const sheets = getSheets();
  await verificarFila('Egresos', rowIndex, idEsperado);
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { valueInputOption: 'USER_ENTERED', data: [
      { range: `Egresos!Q${rowIndex}`, values: [['1']] },
      { range: `Egresos!U${rowIndex}:V${rowIndex}`, values: [[ahoraAR(), quien]] },
    ] },
  });
}

/* ===================== PAPELERA ===================== */
// Columnas A-E: fechaEliminacion, eliminadoPor, tipo, id, datosJSON
// Solo se puede leer desde el Google Sheets directamente (no hay ruta API)

async function archivarEnPapelera(tipo, id, datos, eliminadoPor) {
  const fecha = ahoraAR();
  const fila = [fecha, eliminadoPor, tipo, id, JSON.stringify(datos)];
  if (!tieneCredenciales) return; // en modo memoria no hay papelera
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Papelera!A:E',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [fila] },
  });
}

async function deleteEvento(rowIndex, clienteData, usuario) {
  await verificarFila('Eventos', rowIndex, clienteData.id);
  await archivarEnPapelera('Evento', clienteData.id, clienteData, usuario);
  if (!tieneCredenciales) {
    const idx = memEventos.findIndex(e => e.rowIndex === rowIndex);
    if (idx !== -1) memEventos[idx] = { ...memEventos[idx], id: '' };
    memIngresos.forEach(i => { if (i.idCliente === clienteData.id) i.anulado = true; });
    return;
  }
  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    // Hasta Z: la nota, la modalidad y el precio del cubierto tambien son del evento.
    range: `Eventos!A${rowIndex}:AD${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [Array(28).fill('')] },
  });

  // Si la Persona no tiene otros eventos, limpiar su fila también
  if (clienteData.personaId && clienteData.personaRowIndex) {
    const evRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Eventos!A2:B',
    });
    const otrosEventos = (evRes.data.values || []).filter(
      row => row[0] && row[1] === clienteData.personaId
    );
    if (!otrosEventos.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Personas!A${clienteData.personaRowIndex}:N${clienteData.personaRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [Array(14).fill('')] },
      });
    }
  }

  // Los cobros del evento eliminado se ANULAN (antes se vaciaban): dejan de
  // contar, pero la plata que entró sigue registrada en la planilla.
  const ingRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Ingresos!A2:U',
    sinCache: true,
  });
  const ingRows = ingRes.data.values || [];
  const filasABorrar = ingRows
    .map((row, i) => ({ row, sheetRow: i + 2 }))
    .filter(({ row }) => (row[1] || '') === clienteData.id)
    .map(({ sheetRow }) => sheetRow);

  if (filasABorrar.length) {
    const ahora = ahoraAR();
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data: filasABorrar.map(f => ({ range: `Ingresos!S${f}:U${f}`, values: [[ahora, usuario || '', '1']] })),
      },
    });
  }
}

/* ===================== CATÁLOGO ITEMS COCINA ===================== */
// Columnas A-E: id, categoria, nombre, activo, unidad

function detectarUnidad(categoria, nombre) {
  const cat = (categoria || '').toLowerCase();
  const nom = (nombre || '').toLowerCase();
  if (cat.includes('salsas') || cat.includes('salsa')) return 'lt';
  // Proteínas del plato central: SIEMPRE en unidades (porciones). Lo que se cuenta
  // es cuántas quedan o cuántas hay que hacer, no el peso.
  if (cat.includes('proteína') || cat.includes('proteina')) return 'und';
  return 'und';
}

// Items a desactivar en sheets existentes (nombres viejos o eliminados)
const ITEMS_DEACTIVATE = new Set([
  // Plato Central - Ave: nombres viejos (varias variantes de guiones bajos) — se cubren por patrón en sincronizarCatalogoConInicial
  'Plato Central - Ave||Pechuga tradición — relleno: ________ / salsa: ________',
  'Plato Central - Ave||Pechuga caprese — relleno: tomate / albahaca / mozzarella / salsa: ________',
  'Plato Central - Ave||Pechuga doble puerro — relleno: puerro / salsa: crema de puerro',
  // Plato Central - Ave: nombres intermedios con "·" — reemplazados por nombres limpios
  'Plato Central - Ave||Pechuga tradición · JyQ y mozzarella',
  'Plato Central - Ave||Pechuga caprese · mozzarella, tomate y albahaca',
  'Plato Central - Ave||Pechuga doble puerro · puerros, crema de almendras',
  // Plato Central - Carne: nombres viejos con "— salsa:" — cubiertos también por patrón
  'Plato Central - Carne||Lomo Reserva — salsa: ________',
  'Plato Central - Carne||Bife del bosque — salsa: hongos del bosque',
  'Plato Central - Carne||Lomo Dijon — salsa: mostaza Dijon',
  // Plato Central - Carne: nombres intermedios con "·" — reemplazados por nombres limpios
  'Plato Central - Carne||Lomo Reserva · reducción de Malbec',
  'Plato Central - Carne||Bife del bosque · hongos de pino',
  'Plato Central - Carne||Lomo Dijon · crema de mostaza',
  // Islas externas
  'Islas||Mesa de fiambres', 'Islas||Sushi',
  // Gourmet — se fusionan con las categorías base
  'Primer Plato - Pastas Gourmet||Sorrentinos de trucha y almendras',
  'Primer Plato - Pastas Gourmet||Fagotinnis de cordero y romero',
  'Primer Plato - Pastas Gourmet||Sorrentinos de salmón y philadelphia',
  'Primer Plato - Salsas Gourmet||Portobellos y ciboulette',
  'Primer Plato - Salsas Gourmet||Queso azul y nuez',
  // Guarniciones — categoría renombrada
  'Plato Central - Guarniciones||Rosti de papa',
  'Plato Central - Guarniciones||Papas a la suiza gratinadas',
  'Plato Central - Guarniciones||Milhojas de papa',
  // Mesa de Dulces y Cafetería — externos, no se stockean
  'Mesa de Dulces||Lemon pie', 'Mesa de Dulces||Cheese cake', 'Mesa de Dulces||Chocotorta',
  'Mesa de Dulces||Torta África', 'Mesa de Dulces||Tarta de frutillas', 'Mesa de Dulces||Flan',
  'Mesa de Dulces||Mil Hojas', 'Mesa de Dulces||Brownies relleno', 'Mesa de Dulces||Copas Heladas',
  'Mesa de Dulces||Panqueques', 'Mesa de Dulces||Torta Homenaje', 'Mesa de Dulces||Presentaciones Individuales',
  'Recepción - Fríos||Sanguche de Miga',
]);

// Patrones para desactivar por substring (captura variantes con distinto número de guiones bajos, etc.)
const ITEMS_DEACTIVATE_PATTERNS = [
  ['Plato Central - Ave', 'relleno:'],
  ['Plato Central - Ave', ' · '],
  ['Plato Central - Carne', '— salsa:'],
  ['Plato Central - Carne', ' · '],
];

// Categorías enteras a desactivar (cualquier ítem que pertenezca a estas categorías)
const CATS_DEACTIVATE_ALL = new Set([
  // Gourmet — fusionados en Primer Plato - Pastas / Salsas
  'Pastas Gourmet', 'Primer Plato - Pastas Gourmet',
  'Salsas Gourmet', 'Primer Plato - Salsas Gourmet',
  // Guarniciones — renombrado a "Guarnición plato central"
  'Guarniciones', 'Plato Central - Guarniciones',
  // Ave + Carne — fusionadas en una sola categoría "Proteínas"
  'Plato Central - Ave', 'Plato Central - Carne',
  // Salsas del plato — renombrada a "Salsa plato", con las opciones del armador
  'Plato Central - Salsas',
  // Mesa de Dulces — se contrata a un proveedor externo, no se pide en el pedido semanal de cocina
  'Mesa de Dulces',
]);

// Categorías que NO van a StockActual (no persisten semana a semana)
const CATEGORIAS_SIN_STOCK = new Set([
  'Recepción - Canapés', 'Recepción - Bruschettas', 'Recepción - Fríos',
  'Sanguche de Miga - Blancos', 'Sanguche de Miga - Negros', 'Sanguche de Miga - Totales',
  'Cafetería / Fin de Fiesta',
]);

const CATALOGO_INICIAL = [
  // Recepción - Canapés
  { categoria: 'Recepción - Canapés', nombre: 'Bocado mediterráneo', unidad: 'und' },
  { categoria: 'Recepción - Canapés', nombre: 'Jamón Imperial', unidad: 'und' },
  { categoria: 'Recepción - Canapés', nombre: 'Palma Serrana', unidad: 'und' },
  { categoria: 'Recepción - Canapés', nombre: 'Azul y Nuez', unidad: 'und' },
  { categoria: 'Recepción - Canapés', nombre: 'Bosque y Queso', unidad: 'und' },
  // Recepción - Bruschettas
  { categoria: 'Recepción - Bruschettas', nombre: 'Braseada suave', unidad: 'und' },
  { categoria: 'Recepción - Bruschettas', nombre: 'Campo verde', unidad: 'und' },
  { categoria: 'Recepción - Bruschettas', nombre: 'Delicia Ibérica', unidad: 'und' },
  { categoria: 'Recepción - Bruschettas', nombre: 'BBQ', unidad: 'und' },
  // Recepción - Fríos
  { categoria: 'Recepción - Fríos', nombre: 'Arrollados', unidad: 'und' },
  // Sanguche de Miga - Blancos
  { categoria: 'Sanguche de Miga - Blancos', nombre: 'CyQ', unidad: 'und' },
  { categoria: 'Sanguche de Miga - Blancos', nombre: 'CyR', unidad: 'und' },
  { categoria: 'Sanguche de Miga - Blancos', nombre: 'JyT', unidad: 'und' },
  { categoria: 'Sanguche de Miga - Blancos', nombre: 'JyQ', unidad: 'und' },
  { categoria: 'Sanguche de Miga - Blancos', nombre: 'Atún', unidad: 'und' },
  { categoria: 'Sanguche de Miga - Blancos', nombre: 'JyM', unidad: 'und' },
  { categoria: 'Sanguche de Miga - Blancos', nombre: 'JyH', unidad: 'und' },
  { categoria: 'Sanguche de Miga - Blancos', nombre: 'JyP', unidad: 'und' },
  { categoria: 'Sanguche de Miga - Blancos', nombre: 'Caprese', unidad: 'und' },
  { categoria: 'Sanguche de Miga - Blancos', nombre: 'HyQ', unidad: 'und' },
  // Sanguche de Miga - Negros
  { categoria: 'Sanguche de Miga - Negros', nombre: 'CyQ', unidad: 'und' },
  { categoria: 'Sanguche de Miga - Negros', nombre: 'CyR', unidad: 'und' },
  { categoria: 'Sanguche de Miga - Negros', nombre: 'JyT', unidad: 'und' },
  { categoria: 'Sanguche de Miga - Negros', nombre: 'JyQ', unidad: 'und' },
  { categoria: 'Sanguche de Miga - Negros', nombre: 'Atún', unidad: 'und' },
  { categoria: 'Sanguche de Miga - Negros', nombre: 'JyM', unidad: 'und' },
  { categoria: 'Sanguche de Miga - Negros', nombre: 'JyH', unidad: 'und' },
  { categoria: 'Sanguche de Miga - Negros', nombre: 'JyP', unidad: 'und' },
  { categoria: 'Sanguche de Miga - Negros', nombre: 'Caprese', unidad: 'und' },
  { categoria: 'Sanguche de Miga - Negros', nombre: 'HyQ', unidad: 'und' },
  // Recepción - Brochettes
  { categoria: 'Recepción - Brochettes', nombre: 'Criolla de carne', unidad: 'und' },
  { categoria: 'Recepción - Brochettes', nombre: 'Italiana', unidad: 'und' },
  { categoria: 'Recepción - Brochettes', nombre: 'Criolla de pollo', unidad: 'und' },
  // Recepción - Empanaditas
  { categoria: 'Recepción - Empanaditas', nombre: 'Fatay de carne', unidad: 'und' },
  { categoria: 'Recepción - Empanaditas', nombre: 'Soles de calabaza y semillas grilladas', unidad: 'und' },
  { categoria: 'Recepción - Empanaditas', nombre: 'Canastitas de batata y almendra', unidad: 'und' },
  { categoria: 'Recepción - Empanaditas', nombre: 'Jamón y queso', unidad: 'und' },
  { categoria: 'Recepción - Empanaditas', nombre: 'Cebolla y queso', unidad: 'und' },
  { categoria: 'Recepción - Empanaditas', nombre: 'Paquetitos de boniato y amapola', unidad: 'und' },
  { categoria: 'Recepción - Empanaditas', nombre: 'Pollo', unidad: 'und' },
  { categoria: 'Recepción - Empanaditas', nombre: 'Fingers de zanahoria', unidad: 'und' },
  // Recepción - Calientes
  { categoria: 'Recepción - Calientes', nombre: 'Daditos de mozzarella', unidad: 'und' },
  { categoria: 'Recepción - Calientes', nombre: 'Mini hamburguesas caseras', unidad: 'und' },
  { categoria: 'Recepción - Calientes', nombre: 'Pollo frito (Buffalo wings)', unidad: 'und' },
  { categoria: 'Recepción - Calientes', nombre: 'Croquetitas de papa', unidad: 'und' },
  { categoria: 'Recepción - Calientes', nombre: 'Envoltinis de bondiola', unidad: 'und' },
  // Islas — solo tacos (Mesa de fiambres y Sushi van a pedido externo)
  { categoria: 'Islas', nombre: 'Tacos - Relleno de carne', unidad: 'und' },
  { categoria: 'Islas', nombre: 'Tacos - Relleno de pollo', unidad: 'und' },
  { categoria: 'Islas', nombre: 'Tacos - Guacamole', unidad: 'und' },
  // Primer Plato - Pastas
  { categoria: 'Primer Plato - Pastas', nombre: 'Tagliatelle', unidad: 'und' },
  { categoria: 'Primer Plato - Pastas', nombre: 'Sorrentinos de jamón y queso', unidad: 'und' },
  { categoria: 'Primer Plato - Pastas', nombre: 'Canelones de verdura y ricota', unidad: 'und' },
  { categoria: 'Primer Plato - Pastas', nombre: 'Raviolones de espinaca y parmesano', unidad: 'und' },
  { categoria: 'Primer Plato - Pastas', nombre: 'Agnolotis de pollo', unidad: 'und' },
  { categoria: 'Primer Plato - Pastas', nombre: 'Ñoquis de papa', unidad: 'und' },
  // Primer Plato - Pastas (incluye las antes llamadas Gourmet)
  { categoria: 'Primer Plato - Pastas', nombre: 'Sorrentinos de trucha y almendras', unidad: 'und' },
  { categoria: 'Primer Plato - Pastas', nombre: 'Fagotinnis de cordero y romero', unidad: 'und' },
  { categoria: 'Primer Plato - Pastas', nombre: 'Sorrentinos de salmón y philadelphia', unidad: 'und' },
  // Primer Plato - Salsas (incluye las antes llamadas Gourmet)
  { categoria: 'Primer Plato - Salsas', nombre: 'Filetto', unidad: 'lt' },
  { categoria: 'Primer Plato - Salsas', nombre: 'Bolognesa', unidad: 'lt' },
  { categoria: 'Primer Plato - Salsas', nombre: 'Rosé', unidad: 'lt' },
  { categoria: 'Primer Plato - Salsas', nombre: 'Cuatro quesos', unidad: 'lt' },
  { categoria: 'Primer Plato - Salsas', nombre: 'Crema de espinaca', unidad: 'lt' },
  { categoria: 'Primer Plato - Salsas', nombre: 'Italiana', unidad: 'lt' },
  { categoria: 'Primer Plato - Salsas', nombre: 'Salsa blanca', unidad: 'lt' },
  { categoria: 'Primer Plato - Salsas', nombre: 'Portobellos y ciboulette', unidad: 'lt' },
  { categoria: 'Primer Plato - Salsas', nombre: 'Queso azul y nuez', unidad: 'lt' },
  // Proteínas (antes separadas en "Plato Central - Ave" y "Plato Central - Carne").
  // La carne se compra por peso; el pollo ya viene armado por porción, así que va en unidades.
  { categoria: 'Proteínas', nombre: 'Bife', unidad: 'kg' },
  { categoria: 'Proteínas', nombre: 'Lomo', unidad: 'kg' },
  { categoria: 'Proteínas', nombre: 'Pechuga - JyQ', unidad: 'und' },
  { categoria: 'Proteínas', nombre: 'Pechuga - caprese', unidad: 'und' },
  { categoria: 'Proteínas', nombre: 'Pechuga - puerro', unidad: 'und' },
  // Salsa plato (antes "Plato Central - Salsas"): las que ofrece el armador de propuestas
  { categoria: 'Salsa plato', nombre: 'Cuatro quesos', unidad: 'lt' },
  { categoria: 'Salsa plato', nombre: 'Crema de almendras', unidad: 'lt' },
  { categoria: 'Salsa plato', nombre: 'Reducción de Malbec', unidad: 'lt' },
  { categoria: 'Salsa plato', nombre: 'Hongos de pino', unidad: 'lt' },
  { categoria: 'Salsa plato', nombre: 'Crema de mostaza Dijon', unidad: 'lt' },
  // Guarnición plato central (antes "Plato Central - Guarniciones")
  { categoria: 'Guarnición plato central', nombre: 'Rosti de papa', unidad: 'und' },
  { categoria: 'Guarnición plato central', nombre: 'Papas a la suiza gratinadas', unidad: 'und' },
  { categoria: 'Guarnición plato central', nombre: 'Milhojas de papa', unidad: 'und' },
  // Cafetería: externo — va en pedido pero no en stock
  { categoria: 'Cafetería / Fin de Fiesta', nombre: 'Café con leche y mini facturas', unidad: 'und' },
  { categoria: 'Cafetería / Fin de Fiesta', nombre: 'Pizza con cerveza', unidad: 'und' },
  { categoria: 'Cafetería / Fin de Fiesta', nombre: 'Mate con bizcochitos', unidad: 'und' },
];

// Ingredientes y materias primas que se trackean en stock pero no son ítems de producción
const INGREDIENTES_STOCK = [
  { categoria: 'Bruschetta - Toppings', nombre: 'Cerdo con BBQ', unidad: 'kg' },
  { categoria: 'Bruschetta - Toppings', nombre: 'Carne braseada', unidad: 'kg' },
  { categoria: 'Bruschetta - Toppings', nombre: 'Pollo con verdeo', unidad: 'kg' },
  { categoria: 'Fiambres', nombre: 'Jamón barra', unidad: 'und' },
  { categoria: 'Fiambres', nombre: 'Queso barra', unidad: 'und' },
  { categoria: 'Fiambres', nombre: 'Salame', unidad: 'und' },
  { categoria: 'Fiambres', nombre: 'Salamín', unidad: 'und' },
  { categoria: 'Fiambres', nombre: 'Queso Azul', unidad: 'kg' },
  { categoria: 'Fiambres', nombre: 'Leberwurst', unidad: 'und' },
  { categoria: 'Fiambres', nombre: 'Mar del plata', unidad: 'und' },
  { categoria: 'Fiambres', nombre: 'Crudo', unidad: 'und' },
  { categoria: 'Fiambres', nombre: 'Aceitunas', unidad: 'kg' },
  { categoria: 'Fiambres', nombre: 'Pepinillos', unidad: 'und' },
  { categoria: 'Condimentos', nombre: 'Mayonesa', unidad: 'kg' },
  { categoria: 'Condimentos', nombre: 'Mostaza', unidad: 'kg' },
  { categoria: 'Condimentos', nombre: 'Ketchup', unidad: 'kg' },
  { categoria: 'Condimentos', nombre: 'Barbacoa', unidad: 'kg' },
  { categoria: 'Condimentos', nombre: 'Cheddar', unidad: 'kg' },
  { categoria: 'Básicos', nombre: 'Leche', unidad: 'lt' },
  { categoria: 'Básicos', nombre: 'Manteca', unidad: 'kg' },
  { categoria: 'Básicos', nombre: 'Harina', unidad: 'kg' },
  { categoria: 'Básicos', nombre: 'Azúcar', unidad: 'kg' },
  { categoria: 'Básicos', nombre: 'Huevo', unidad: 'und' },
  { categoria: 'Básicos', nombre: 'Pan rallado', unidad: 'kg' },
  { categoria: 'Verduras', nombre: 'Lechuga', unidad: 'und' },
  { categoria: 'Verduras', nombre: 'Tomate', unidad: 'kg' },
  { categoria: 'Verduras', nombre: 'Papa', unidad: 'kg' },
  { categoria: 'Verduras', nombre: 'Cebolla', unidad: 'kg' },
  { categoria: 'Verduras', nombre: 'Verdeo', unidad: 'und' },
  { categoria: 'Verduras', nombre: 'Puerro', unidad: 'und' },
  { categoria: 'Verduras', nombre: 'Perejil', unidad: 'und' },
  { categoria: 'Verduras', nombre: 'Acelga', unidad: 'und' },
  { categoria: 'Verduras', nombre: 'Batata', unidad: 'kg' },
  { categoria: 'Verduras', nombre: 'Zanahoria', unidad: 'kg' },
  { categoria: 'Aceites y Sales', nombre: 'Aceite girasol', unidad: 'lt' },
  { categoria: 'Aceites y Sales', nombre: 'Aceite oliva', unidad: 'lt' },
  { categoria: 'Aceites y Sales', nombre: 'Sal gruesa', unidad: 'kg' },
  { categoria: 'Aceites y Sales', nombre: 'Sal fina', unidad: 'kg' },
];

// Columna D es un checkbox en Sheets: la API puede devolver el booleano `false`
// (no el string 'false'), así que la comparación tiene que cubrir ambos casos.
function _isActivoCell(v) {
  return String(v).toLowerCase() !== 'false';
}

function rowToCatalogoItem(row, index) {
  return {
    rowIndex: index + 2,
    id: row[0] || '',
    categoria: row[1] || '',
    nombre: row[2] || '',
    activo: _isActivoCell(row[3]),
    unidad: row[4] || detectarUnidad(row[1], row[2]),
  };
}

function catalogoItemToRow(item) {
  return [item.id, item.categoria, item.nombre, item.activo !== false ? 'true' : 'false', item.unidad || 'und'];
}

async function getCatalogoItems() {
  if (!tieneCredenciales) return memCatalogoItems.filter(i => i.id && i.activo !== false);
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'CatalogoItems!A2:E',
  });
  return (res.data.values || []).map((row, i) => rowToCatalogoItem(row, i)).filter(i => i.id && i.activo !== false);
}

async function addCatalogoItem(data) {
  const id = generateId('CAT');
  const unidad = data.unidad || detectarUnidad(data.categoria, data.nombre);
  const item = { ...data, id, activo: true, unidad };
  if (!tieneCredenciales) {
    item.rowIndex = memCatalogoItems.length + 2;
    memCatalogoItems.push(item);
    memStockActual.push({ rowIndex: memStockActual.length + 2, id: item.id, categoria: item.categoria, nombre: item.nombre, unidad: item.unidad, cantidad: 0, actualizado: '', minimo: 0 });
    return item;
  }
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'CatalogoItems!A:E',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [catalogoItemToRow(item)] },
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'StockActual!A:G',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[item.id, item.categoria, item.nombre, item.unidad, 0, '', 0]] },
  });
  return item;
}

async function updateCatalogoItem(rowIndex, data) {
  if (!tieneCredenciales) {
    const idx = memCatalogoItems.findIndex(i => i.rowIndex === rowIndex);
    if (idx !== -1) Object.assign(memCatalogoItems[idx], data);
    return;
  }
  const sheets = getSheets();
  const updates = [];
  if (data.nombre !== undefined) updates.push({ range: `CatalogoItems!C${rowIndex}`, values: [[data.nombre]] });
  if (data.categoria !== undefined) updates.push({ range: `CatalogoItems!B${rowIndex}`, values: [[data.categoria]] });
  if (data.unidad !== undefined) updates.push({ range: `CatalogoItems!E${rowIndex}`, values: [[data.unidad]] });
  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { valueInputOption: 'USER_ENTERED', data: updates },
    });
  }
}

async function deleteCatalogoItem(rowIndex) {
  if (!tieneCredenciales) {
    const idx = memCatalogoItems.findIndex(i => i.rowIndex === rowIndex);
    if (idx !== -1) memCatalogoItems[idx].activo = false;
    return;
  }
  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `CatalogoItems!D${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [['false']] },
  });
}

/* ===================== STOCK ACTUAL COCINA ===================== */
// Columnas A-G: id, categoria, nombre, unidad, cantidad, actualizado, minimo
// `minimo` es el stock mínimo deseado por ítem (par level): por debajo de eso
// el tablero lo marca como "reponer". Vacío o 0 = sin mínimo definido.

function rowToStockItem(row, index) {
  return {
    rowIndex: index + 2,
    id: row[0] || '',
    categoria: row[1] || '',
    nombre: row[2] || '',
    unidad: row[3] || 'und',
    cantidad: parseFloat(row[4]) || 0,
    actualizado: row[5] || '',
    minimo: parseFloat(row[6]) || 0,
  };
}

async function getStockActual() {
  if (!tieneCredenciales) return memStockActual.filter(s => s.id);
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'StockActual!A2:G',
  });
  return (res.data.values || []).map((row, i) => rowToStockItem(row, i)).filter(s => s.id);
}

// Guarda el stock mínimo deseado (par level) de un ítem. Columna G.
async function actualizarMinimoStock(id, minimo) {
  const val = parseFloat(minimo) || 0;
  if (!tieneCredenciales) {
    const idx = memStockActual.findIndex(s => s.id === id);
    if (idx !== -1) memStockActual[idx].minimo = val;
    return;
  }
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'StockActual!A2:A' });
  const rows = res.data.values || [];
  const rowIdx = rows.findIndex(r => r[0] === id);
  if (rowIdx === -1) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `StockActual!G${rowIdx + 2}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[val]] },
  });
}

async function actualizarStockActual(actualizaciones) {
  const now = hoyAR();
  if (!tieneCredenciales) {
    for (const act of actualizaciones) {
      const idx = memStockActual.findIndex(s => s.id === act.id);
      if (idx !== -1) { memStockActual[idx].cantidad = act.cantidad; memStockActual[idx].actualizado = now; }
    }
    return;
  }
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'StockActual!A2:A' });
  const rows = res.data.values || [];
  const updates = [];
  for (const act of actualizaciones) {
    const rowIdx = rows.findIndex(r => r[0] === act.id);
    if (rowIdx !== -1) updates.push({ range: `StockActual!E${rowIdx + 2}:F${rowIdx + 2}`, values: [[act.cantidad, now]] });
  }
  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { valueInputOption: 'USER_ENTERED', data: updates },
    });
  }
}

// Mueve un ítem de categoría (grupo), actualizando CatalogoItems y StockActual a la vez,
// para que el dashboard de stock y los pedidos queden consistentes.
async function cambiarCategoriaItem(id, categoria) {
  if (!id || !categoria) throw new Error('id y categoria requeridos');
  if (!tieneCredenciales) {
    const c = memCatalogoItems.find(i => i.id === id);
    if (c) c.categoria = categoria;
    const s = memStockActual.find(x => x.id === id);
    if (s) s.categoria = categoria;
    return { ok: true };
  }
  const sheets = getSheets();
  // CatalogoItems (col B)
  const catRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'CatalogoItems!A2:A' });
  const catRows = catRes.data.values || [];
  const catIdx = catRows.findIndex(r => r[0] === id);
  // StockActual (col B)
  const stkRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'StockActual!A2:A' });
  const stkRows = stkRes.data.values || [];
  const stkIdx = stkRows.findIndex(r => r[0] === id);
  const updates = [];
  if (catIdx !== -1) updates.push({ range: `CatalogoItems!B${catIdx + 2}`, values: [[categoria]] });
  if (stkIdx !== -1) updates.push({ range: `StockActual!B${stkIdx + 2}`, values: [[categoria]] });
  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { valueInputOption: 'USER_ENTERED', data: updates },
    });
  }
  return { ok: true };
}

// Editar un ítem del catálogo por id (nombre / unidad / categoría), manteniendo
// sincronizada la fila equivalente de StockActual para que no queden nombres viejos.
async function editarItemCatalogo(id, data) {
  if (!id) throw new Error('id requerido');
  const campos = {};
  ['nombre', 'categoria', 'unidad'].forEach(k => {
    if (data[k] !== undefined && String(data[k]).trim() !== '') campos[k] = String(data[k]).trim();
  });
  if (!Object.keys(campos).length) throw new Error('nada para actualizar');

  if (!tieneCredenciales) {
    const c = memCatalogoItems.find(i => i.id === id);
    if (c) Object.assign(c, campos);
    const s = memStockActual.find(x => x.id === id);
    if (s) Object.assign(s, campos);
    return { ok: true };
  }
  const sheets = getSheets();
  const [catRes, stkRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'CatalogoItems!A2:A' }),
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'StockActual!A2:A' }),
  ]);
  const catIdx = (catRes.data.values || []).findIndex(r => r[0] === id);
  const stkIdx = (stkRes.data.values || []).findIndex(r => r[0] === id);
  const updates = [];
  if (catIdx !== -1) {
    const row = catIdx + 2;
    // CatalogoItems: B categoria, C nombre, E unidad
    if (campos.categoria !== undefined) updates.push({ range: `CatalogoItems!B${row}`, values: [[campos.categoria]] });
    if (campos.nombre !== undefined) updates.push({ range: `CatalogoItems!C${row}`, values: [[campos.nombre]] });
    if (campos.unidad !== undefined) updates.push({ range: `CatalogoItems!E${row}`, values: [[campos.unidad]] });
  }
  if (stkIdx !== -1) {
    const row = stkIdx + 2;
    // StockActual: B categoria, C nombre, D unidad
    if (campos.categoria !== undefined) updates.push({ range: `StockActual!B${row}`, values: [[campos.categoria]] });
    if (campos.nombre !== undefined) updates.push({ range: `StockActual!C${row}`, values: [[campos.nombre]] });
    if (campos.unidad !== undefined) updates.push({ range: `StockActual!D${row}`, values: [[campos.unidad]] });
  }
  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { valueInputOption: 'USER_ENTERED', data: updates },
    });
  }
  return { ok: true };
}

// Baja de un ítem por id: se desactiva en el catálogo y se limpia su fila de stock,
// para que deje de aparecer tanto en pedidos como en el stock y sus planillas.
async function eliminarItemCatalogo(id) {
  if (!id) throw new Error('id requerido');
  if (!tieneCredenciales) {
    const c = memCatalogoItems.find(i => i.id === id);
    if (c) { c.activo = false; c.bajaManual = true; }
    memStockActual = memStockActual.filter(x => x.id !== id);
    return { ok: true };
  }
  const sheets = getSheets();
  const [catRes, stkRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'CatalogoItems!A2:A' }),
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'StockActual!A2:A' }),
  ]);
  const catIdx = (catRes.data.values || []).findIndex(r => r[0] === id);
  const stkIdx = (stkRes.data.values || []).findIndex(r => r[0] === id);
  const updates = [];
  // Col D = activo, col F = motivo de la baja. La marca "manual" evita que
  // sincronizarCatalogoConInicial lo reviva por figurar en el catálogo inicial.
  if (catIdx !== -1) updates.push({ range: `CatalogoItems!D${catIdx + 2}:F${catIdx + 2}`, values: [['false', '', 'manual']] });
  if (stkIdx !== -1) updates.push({ range: `StockActual!A${stkIdx + 2}:F${stkIdx + 2}`, values: [['', '', '', '', '', '']] });
  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { valueInputOption: 'USER_ENTERED', data: updates },
    });
  }
  return { ok: true };
}

// Normaliza strings para comparación tolerante: minúsculas, guiones unificados, espacios comprimidos
function _normStr(s) {
  return (s || '').replace(/[–—·]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Categorías con lista cerrada de nombres canónicos: cualquier otra variante (vieja, con
// "relleno:", con "·", con guion, etc.) se desactiva sin necesidad de listar cada caso a mano.
const CANONICAL_NAMES_BY_CAT_NORM = {
};

async function sincronizarCatalogoConInicial() {
  // Sets normalizados para lookup rápido
  const DEACT_KEYS_NORM = new Set([...ITEMS_DEACTIVATE].map(k => {
    const [c, n] = k.split('||');
    return `${_normStr(c)}||${_normStr(n)}`;
  }));
  const DEACT_CATS_NORM = new Set([...CATS_DEACTIVATE_ALL].map(_normStr));
  const DEACT_PAT_NORM = ITEMS_DEACTIVATE_PATTERNS.map(([c, pat]) => [_normStr(c), _normStr(pat)]);

  const shouldDeactivateItem = (cat, nombre) => {
    const catN = _normStr(cat), nomN = _normStr(nombre);
    const allowSet = CANONICAL_NAMES_BY_CAT_NORM[catN];
    if (allowSet && !allowSet.has(nomN)) return true;
    return DEACT_KEYS_NORM.has(`${catN}||${nomN}`) ||
      DEACT_CATS_NORM.has(catN) ||
      catN.includes('gourmet') ||
      DEACT_PAT_NORM.some(([c, pat]) => c === catN && nomN.includes(pat));
  };

  if (!tieneCredenciales) {
    memCatalogoItems.forEach(item => {
      if (shouldDeactivateItem(item.categoria, item.nombre)) item.activo = false;
    });
    const existingKeys = new Set(memCatalogoItems.map(i => `${i.categoria}||${i.nombre}`));
    const bajasManuales = new Set(memCatalogoItems.filter(i => i.bajaManual).map(i => `${i.categoria}||${i.nombre}`));
    const faltantes = CATALOGO_INICIAL.filter(item => !existingKeys.has(`${item.categoria}||${item.nombre}`) && !bajasManuales.has(`${item.categoria}||${item.nombre}`));
    faltantes.forEach(item => {
      memCatalogoItems.push({ ...item, id: generateId('CAT'), activo: true, rowIndex: memCatalogoItems.length + 2 });
    });
    return { desactivados: 0, agregados: faltantes.length };
  }
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'CatalogoItems!A2:F' });
  const rows = res.data.values || [];

  // Desactivar ítems obsoletos (comparación normalizada)
  const toDeactivate = rows
    .map((r, i) => ({ r, rowIndex: i + 2 }))
    .filter(({ r }) => r[0] && _isActivoCell(r[3]) && shouldDeactivateItem(r[1], r[2]));
  if (toDeactivate.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { valueInputOption: 'USER_ENTERED', data: toDeactivate.map(({ rowIndex }) => ({ range: `CatalogoItems!D${rowIndex}`, values: [['false']] })) },
    });
    console.log(`✅ CatalogoItems: ${toDeactivate.length} ítems obsoletos desactivados:`, toDeactivate.map(x => `${x.r[1]}|${x.r[2]}`).join(', '));
  }

  // Reactivar ítems que figuran en el catálogo inicial (canónicos) pero quedaron desactivados
  // por error (p.ej. una versión vieja del denylist) y ya no deberían estar apagados.
  const inicialKeys = new Set(CATALOGO_INICIAL.map(item => `${item.categoria}||${item.nombre}`));
  const toReactivate = rows
    .map((r, i) => ({ r, rowIndex: i + 2 }))
    .filter(({ r }) => r[0] && !_isActivoCell(r[3]) && inicialKeys.has(`${r[1]}||${r[2]}`) &&
      String(r[5] || '').toLowerCase() !== 'manual' && !shouldDeactivateItem(r[1], r[2]));
  if (toReactivate.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { valueInputOption: 'USER_ENTERED', data: toReactivate.map(({ rowIndex }) => ({ range: `CatalogoItems!D${rowIndex}`, values: [['true']] })) },
    });
    console.log(`✅ CatalogoItems: ${toReactivate.length} ítems reactivados:`, toReactivate.map(x => `${x.r[1]}|${x.r[2]}`).join(', '));
  }

  // Agregar ítems faltantes del catálogo inicial
  const existingKeys = new Set(rows.filter(r => r[0]).map(r => `${r[1]}||${r[2]}`));
  const faltantes = CATALOGO_INICIAL.filter(item => !existingKeys.has(`${item.categoria}||${item.nombre}`));
  if (faltantes.length) {
    const newRows = faltantes.map(item => catalogoItemToRow({ ...item, id: generateId('CAT'), activo: true }));
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'CatalogoItems!A:E',
      valueInputOption: 'USER_ENTERED',
      resource: { values: newRows },
    });
    console.log(`✅ CatalogoItems: ${faltantes.length} ítems nuevos desde catálogo inicial.`);
  }
  return {
    desactivados: toDeactivate.length, desactivadosDetalle: toDeactivate.map(x => `${x.r[1]} / ${x.r[2]}`),
    reactivados: toReactivate.length, reactivadosDetalle: toReactivate.map(x => `${x.r[1]} / ${x.r[2]}`),
    agregados: faltantes.length,
  };
}

async function sincronizarStockConCatalogo() {
  if (!tieneCredenciales) {
    const existingIds = new Set(memStockActual.map(s => s.id));
    memCatalogoItems
      .filter(i => i.activo !== false && i.id && !existingIds.has(i.id) && !CATEGORIAS_SIN_STOCK.has(i.categoria))
      .forEach(item => {
        memStockActual.push({ rowIndex: memStockActual.length + 2, id: item.id, categoria: item.categoria, nombre: item.nombre, unidad: item.unidad || 'und', cantidad: 0, actualizado: '' });
      });
    return;
  }
  const sheets = getSheets();
  const [stockRes, catRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'StockActual!A2:A' }),
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'CatalogoItems!A2:E' }),
  ]);
  const stockRows = (stockRes.data.values || []).map((r, i) => ({ id: r[0] || '', rowIndex: i + 2 }));
  const catRows = catRes.data.values || [];

  // IDs de ítems activos en el catálogo
  const activeCatIds = new Set(catRows.filter(r => r[0] && _isActivoCell(r[3])).map(r => r[0]));

  // Blanquear filas de stock cuyo ítem fue desactivado en catálogo (no tocar ING-)
  const toRemove = stockRows.filter(s => s.id && !s.id.startsWith('ING-') && !activeCatIds.has(s.id));
  if (toRemove.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data: toRemove.map(({ rowIndex }) => ({
          range: `StockActual!A${rowIndex}:F${rowIndex}`,
          values: [['', '', '', '', '', '']],
        })),
      },
    });
    console.log(`✅ StockActual: ${toRemove.length} entradas obsoletas eliminadas.`);
  }

  // Agregar ítems activos que faltan en stock
  const existingIds = new Set(stockRows.map(s => s.id).filter(Boolean));
  const faltantes = catRows.filter(r =>
    r[0] && _isActivoCell(r[3]) && !existingIds.has(r[0]) && !CATEGORIAS_SIN_STOCK.has(r[1])
  );
  if (faltantes.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'StockActual!A:F',
      valueInputOption: 'USER_ENTERED',
      resource: { values: faltantes.map(r => [r[0], r[1], r[2], r[4] || detectarUnidad(r[1], r[2]), 0, '']) },
    });
  }
}

async function sincronizarIngredientesStock() {
  if (!tieneCredenciales) {
    const existingIngKeys = new Set(
      memStockActual.filter(s => s.id && s.id.startsWith('ING-')).map(s => `${s.categoria}||${s.nombre}`)
    );
    INGREDIENTES_STOCK.forEach(ing => {
      if (!existingIngKeys.has(`${ing.categoria}||${ing.nombre}`)) {
        memStockActual.push({ rowIndex: memStockActual.length + 2, id: generateId('ING'), categoria: ing.categoria, nombre: ing.nombre, unidad: ing.unidad, cantidad: 0, actualizado: '' });
      }
    });
    return;
  }
  const sheets = getSheets();
  const stockRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'StockActual!A2:F' });
  const rows = stockRes.data.values || [];
  const existingIngKeys = new Set(rows.filter(r => r[0] && r[0].startsWith('ING-')).map(r => `${r[1]}||${r[2]}`));
  const faltantes = INGREDIENTES_STOCK.filter(ing => !existingIngKeys.has(`${ing.categoria}||${ing.nombre}`));
  if (faltantes.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'StockActual!A:F',
      valueInputOption: 'USER_ENTERED',
      resource: { values: faltantes.map(ing => [generateId('ING'), ing.categoria, ing.nombre, ing.unidad, 0, '']) },
    });
    console.log(`✅ StockActual: ${faltantes.length} ingredientes agregados.`);
  }
}

/* ===================== PEDIDOS COCINA ===================== */
// Columnas A-H: id, idCliente, nombreEvento, fecha, itemsJSON, estado, creadoPor, fechaCarga

function rowToPedidoCocina(row, index) {
  let items = [];
  try { items = JSON.parse(row[4] || '[]'); } catch {}
  return {
    rowIndex: index + 2,
    id: row[0] || '',
    idCliente: row[1] || '',
    nombreEvento: row[2] || '',
    fecha: row[3] || '',
    items,
    estado: row[5] || 'preparacion',
    creadoPor: row[6] || '',
    fechaCarga: row[7] || '',
  };
}

function pedidoCocinaToRow(p) {
  return [
    p.id, p.idCliente || '', p.nombreEvento || '', p.fecha || '',
    JSON.stringify(p.items || []), p.estado || 'preparacion',
    p.creadoPor || '', p.fechaCarga || '',
  ].map(v => String(v || ''));
}

async function getPedidosCocina() {
  if (!tieneCredenciales) return memPedidosCocina.filter(p => p.id);
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'PedidosCocina!A2:H',
  });
  return (res.data.values || []).map((row, i) => rowToPedidoCocina(row, i)).filter(p => p.id);
}

async function addPedidoCocina(data) {
  const id = generateId('PED');
  const now = hoyAR();
  const pedido = { ...data, id, estado: 'preparacion', fechaCarga: now };
  if (!tieneCredenciales) {
    pedido.rowIndex = memPedidosCocina.length + 2;
    memPedidosCocina.push(pedido);
    return pedido;
  }
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'PedidosCocina!A:H',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [pedidoCocinaToRow(pedido)] },
  });
  return pedido;
}

async function updatePedidoCocina(rowIndex, data) {
  if (!tieneCredenciales) {
    const idx = memPedidosCocina.findIndex(p => p.rowIndex === rowIndex);
    if (idx !== -1) memPedidosCocina[idx] = { ...memPedidosCocina[idx], ...data, rowIndex };
    return { ...data, rowIndex };
  }
  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `PedidosCocina!A${rowIndex}:H${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [pedidoCocinaToRow({ ...data, rowIndex })] },
  });
  return { ...data, rowIndex };
}

async function deletePedidoCocina(rowIndex) {
  if (!tieneCredenciales) {
    memPedidosCocina = memPedidosCocina.filter(p => p.rowIndex !== rowIndex);
    return;
  }
  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `PedidosCocina!A${rowIndex}:H${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [['', '', '', '', '', '', '', '']] },
  });
}

/* ===================== AUDITORÍA =====================
   Registro de quién cambió qué y cuándo. Antes no había forma de saberlo:
   sólo quedaba `cargadoPor`, que dice quién creó el evento, no quién lo tocó
   después.

   Guarda una FOTO de los campos que importan en cada cambio, no un diff.
   Comparando dos filas consecutivas se ve qué cambió, y no hace falta leer la
   planilla antes de cada escritura (que duplicaría la latencia de todo).

   Las escrituras se acumulan y se mandan juntas: una acción masiva sobre 30
   clientes son 30 escrituras, y sumarle 30 appends sueltos pasaría el límite
   de 60 escrituras por minuto que impone la API de Sheets.

   Nunca hace fallar la operación principal: si el log no se puede escribir, se
   avisa por consola y se sigue. */

const CAMPOS_AUDITADOS = [
  'estado', 'fechaEvento', 'proximoSeguimiento', 'cantidadInvitados',
  'turno', 'tipoEvento', 'montoPresupuesto', 'apellidoNombre', 'telefono',
];

let _colaAuditoria = [];
let _timerAuditoria = null;
let memAuditoria = [];              // modo sin credenciales

/* Extrae sólo los campos que vale la pena registrar */
function fotoAuditoria(data) {
  const foto = {};
  for (const k of CAMPOS_AUDITADOS) {
    if (data[k] !== undefined && data[k] !== '') foto[k] = data[k];
  }
  return foto;
}

function registrarAuditoria({ usuario, accion, entidad, idEntidad, nombre, detalle }) {
  const fila = [
    ahoraAR(),
    usuario || '—',
    accion || '',
    entidad || '',
    idEntidad || '',
    nombre || '',
    typeof detalle === 'string' ? detalle : JSON.stringify(detalle || {}),
  ];

  if (!tieneCredenciales) {
    memAuditoria.push(fila);
    return;
  }

  _colaAuditoria.push(fila);
  if (!_timerAuditoria) {
    _timerAuditoria = setTimeout(volcarAuditoria, 2500);
  }
}

async function volcarAuditoria() {
  _timerAuditoria = null;
  const lote = _colaAuditoria;
  _colaAuditoria = [];
  if (!lote.length || !tieneCredenciales) return;

  try {
    const sheets = getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Auditoria!A:G',
      valueInputOption: 'USER_ENTERED',
      resource: { values: lote },
    });
  } catch (e) {
    // El log no es motivo para romper nada, pero sí para enterarse
    console.error('⚠️  No se pudo escribir la auditoría:', e.message);
  }
}

async function getAuditoria(idEntidad = null) {
  let filas;
  if (!tieneCredenciales) {
    filas = memAuditoria;
  } else {
    // Mandar lo pendiente antes de leer, así el cambio recién hecho ya aparece
    if (_timerAuditoria) { clearTimeout(_timerAuditoria); await volcarAuditoria(); }
    const sheets = getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Auditoria!A2:G',
    });
    filas = res.data.values || [];
  }

  return filas
    .map(r => ({
      fecha: r[0] || '', usuario: r[1] || '', accion: r[2] || '',
      entidad: r[3] || '', idEntidad: r[4] || '', nombre: r[5] || '',
      detalle: r[6] || '',
    }))
    .filter(a => !idEntidad || a.idEntidad === idEntidad)
    .reverse();                     // lo más nuevo primero
}

/* ===================== ESTADOS (historia de cada venta) =====================
   Hoja append-only: una fila por cada cambio de estado de un evento (incluida el
   alta, con "de" vacío). Nunca se edita ni se borra: es la historia del embudo.
   Misma cola que la auditoría, para no gastar escrituras de la API. */

let _colaEstados = [];
let _timerEstados = null;
let memEstados = [];

function registrarEstado(idEvento, de, a, quien) {
  if (!idEvento || (de || '') === (a || '')) return;
  const fila = [idEvento, de || '', a || '', ahoraAR(), quien || '—'];
  if (!tieneCredenciales) { memEstados.push(fila); return; }
  _colaEstados.push(fila);
  if (!_timerEstados) _timerEstados = setTimeout(volcarEstados, 2500);
}

async function volcarEstados() {
  _timerEstados = null;
  const lote = _colaEstados;
  _colaEstados = [];
  if (!lote.length || !tieneCredenciales) return;
  try {
    await getSheets().spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Estados!A:E',
      valueInputOption: 'USER_ENTERED',
      resource: { values: lote },
    });
  } catch (e) {
    console.error('⚠️  No se pudo escribir el cambio de estado:', e.message);
  }
}

/* ===================== INIT SHEETS ===================== */
async function initSheets() {
  if (!tieneCredenciales) return;
  try {
    const sheets = getSheets();
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const existing = spreadsheet.data.sheets.map(s => s.properties.title);

    const toCreate = [];
    if (!existing.includes('Personas')) toCreate.push('Personas');
    if (!existing.includes('Eventos')) toCreate.push('Eventos');
    if (!existing.includes('Timming')) toCreate.push('Timming');
    if (!existing.includes('Cuotas')) toCreate.push('Cuotas');
    if (!existing.includes('Papelera')) toCreate.push('Papelera');
    if (!existing.includes('Empleados')) toCreate.push('Empleados');
    if (!existing.includes('Egresos')) toCreate.push('Egresos');
    if (!existing.includes('CatalogoItems')) toCreate.push('CatalogoItems');
    if (!existing.includes('PedidosCocina')) toCreate.push('PedidosCocina');
    if (!existing.includes('StockActual')) toCreate.push('StockActual');
    if (!existing.includes('Auditoria')) toCreate.push('Auditoria');
    if (!existing.includes('Config')) toCreate.push('Config');
    if (!existing.includes('Estados')) toCreate.push('Estados');

    if (toCreate.length) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: { requests: toCreate.map(title => ({ addSheet: { properties: { title } } })) },
      });
    }

    const headers = [];

    // Encabezados de columnas nuevas en hojas que YA existen. Solo tocan la fila 1,
    // nunca los datos. Necesario para que Excel muestre nombres de columna reales
    // en las tablas dinamicas (el analisis se hace por fuera del sistema).
    if (existing.includes('Ingresos')) {
      headers.push({ range: 'Ingresos!A1:U1', values: [['id','idEvento','tipoIngreso','monto','fecha','formaPago','notas','moneda','confirmado','cliente','fechaEvento','periodo','cubiertos','precioCubierto','cotizacion','montoARS','cargadoPor','creadoEn','modificadoEn','modificadoPor','anulado']] });
    }
    // Columnas que se fueron sumando sin encabezado: las herramientas de análisis
    // las mostraban como columnas sin nombre. Definición: docs/diccionario-de-datos.md
    const encabezadosCompletos = {
      Eventos: ['A1:AD1', ['id','personaId','estado','cargadoPor','fechaCarga','tipoEvento','formato','fechaEvento','estadoFecha','cantidadInvitados','turno','presupuesto','montoPresupuesto','menuInfantil','otrosPedidos','observaciones','proximoSeguimiento','menuRecepcion','menuIslas','menuPrimerPlato','menuPrincipal','menuPostre','nombreAgasajado','notaInterna','modalidadPago','precioCubierto','modificadoEn','modificadoPor','motivoCancelacion','notaCancelacion']],
      Personas: ['A1:N1', ['id','apellidoNombre','telefono','gmail','redSocial','origen','tipoCliente','exclienteReferencia','exclienteNota','fechaCarga','cargadoPor','notaPersona','modificadoEn','modificadoPor']],
      Restricciones: ['A1:E1', ['id','idCliente','tipoRestriccion','cantidad','coronita']],
      Timming: ['A1:I1', ['id','idCliente','hora','actividad','tipo','descripcion','hecho','horaOriginal','notas']],
      Empleados: ['A1:D1', ['id','nombre','activo','rolHabitual']],
      CatalogoItems: ['A1:E1', ['id','categoria','nombre','activo','unidad']],
      StockActual: ['A1:G1', ['id','categoria','nombre','unidad','cantidad','actualizado','minimo']],
    };
    for (const [hoja, [rango, nombres]] of Object.entries(encabezadosCompletos)) {
      if (existing.includes(hoja)) headers.push({ range: `${hoja}!${rango}`, values: [nombres] });
    }
    if (existing.includes('Cuotas')) {
      headers.push({ range: 'Cuotas!A1:N1', values: [['id','idCliente','numeroCuota','valorOriginal','valorActual','fechaVencimiento','estado','fechaPago','montoPagado','notas','moneda','indexacion','confirmado','ipcHasta']] });
    }
    if (existing.includes('Egresos')) {
      headers.push({ range: 'Egresos!A1:W1', values: [['id','fecha','concepto','categoria','monto','moneda','idEmpleado','nombreEmpleado','rolPago','notas','cargadoPor','proveedor','tipoCosto','idEvento','evento','periodo','confirmado','cotizacion','montoARS','creadoEn','modificadoEn','modificadoPor','anulado']] });
    }

    if (!existing.includes('Config')) {
      headers.push({ range: 'Config!A1:B1', values: [['clave','valor']] });
    }
    if (!existing.includes('Personas')) {
      headers.push({ range: 'Personas!A1:L1', values: [['id','apellidoNombre','telefono','gmail','redSocial','origen','tipoCliente','exclienteReferencia','exclienteNota','fechaCarga','cargadoPor','notaPersona']] });
    }
    if (!existing.includes('Eventos')) {
      headers.push({ range: 'Eventos!A1:V1', values: [['id','personaId','estado','cargadoPor','fechaCarga','tipoEvento','formato','fechaEvento','estadoFecha','cantidadInvitados','turno','presupuesto','montoPresupuesto','menuInfantil','otrosPedidos','observaciones','proximoSeguimiento','menuRecepcion','menuIslas','menuPrimerPlato','menuPrincipal','menuPostre']] });
    }
    if (!existing.includes('Timming')) {
      headers.push({ range: 'Timming!A1:F1', values: [['id','idCliente','hora','actividad','tipo','descripcion']] });
    }
    if (!existing.includes('Cuotas')) {
      headers.push({ range: 'Cuotas!A1:N1', values: [['id','idCliente','numeroCuota','valorOriginal','valorActual','fechaVencimiento','estado','fechaPago','montoPagado','notas','moneda','indexacion','confirmado','ipcHasta']] });
    }
    if (!existing.includes('Papelera')) {
      headers.push({ range: 'Papelera!A1:E1', values: [['fechaEliminacion','eliminadoPor','tipo','id','datosJSON']] });
    }
    if (!existing.includes('Empleados')) {
      headers.push({ range: 'Empleados!A1:D1', values: [['id','nombre','activo','rolHabitual']] });
    }
    if (!existing.includes('Egresos')) {
      headers.push({ range: 'Egresos!A1:W1', values: [['id','fecha','concepto','categoria','monto','moneda','idEmpleado','nombreEmpleado','rolPago','notas','cargadoPor','proveedor','tipoCosto','idEvento','evento','periodo','confirmado','cotizacion','montoARS','creadoEn','modificadoEn','modificadoPor','anulado']] });
    }
    if (!existing.includes('CatalogoItems')) {
      headers.push({ range: 'CatalogoItems!A1:E1', values: [['id','categoria','nombre','activo','unidad']] });
    }
    if (!existing.includes('PedidosCocina')) {
      headers.push({ range: 'PedidosCocina!A1:H1', values: [['id','idCliente','nombreEvento','fecha','itemsJSON','estado','creadoPor','fechaCarga']] });
    }
    if (!existing.includes('StockActual')) {
      headers.push({ range: 'StockActual!A1:G1', values: [['id','categoria','nombre','unidad','cantidad','actualizado','minimo']] });
    }
    if (!existing.includes('Auditoria')) {
      headers.push({ range: 'Auditoria!A1:G1', values: [['fecha','usuario','accion','entidad','idEntidad','nombre','detalle']] });
    }
    if (!existing.includes('Estados')) {
      headers.push({ range: 'Estados!A1:E1', values: [['idEvento','de','a','fechaHora','quien']] });
    }

    if (headers.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: { valueInputOption: 'USER_ENTERED', data: headers },
      });
      console.log('✅ Hojas creadas:', toCreate.join(', '));
    }

    // Pre-poblar CatalogoItems si está vacío
    const catRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'CatalogoItems!A2:A',
    });
    if (!(catRes.data.values || []).some(r => r[0])) {
      const rows = CATALOGO_INICIAL.map(item => catalogoItemToRow({ ...item, id: generateId('CAT'), activo: true }));
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'CatalogoItems!A:E',
        valueInputOption: 'USER_ENTERED',
        resource: { values: rows },
      });
      console.log(`✅ CatalogoItems pre-poblado con ${rows.length} ítems.`);
    }

    // Agregar ítems nuevos del catálogo inicial (no borra nada existente), desactivar obsoletos
    await sincronizarCatalogoConInicial();

    // Sincronizar StockActual con el catálogo (agrega ítems producibles, excluye sin-stock)
    await sincronizarStockConCatalogo();

    // Agregar ingredientes y materias primas al stock (fiambres, verduras, básicos, etc.)
    await sincronizarIngredientesStock();
    console.log('✅ StockActual sincronizado con catálogo e ingredientes.');
  } catch (e) {
    console.error('Error en initSheets:', e.message);
  }
}

// Actualiza solo campos específicos de un evento sin tocar el resto de la fila
async function patchEvento(rowIndex, patch) {
  patch = listas.normalizar('evento', patch); // valores de lista siempre en su forma oficial
  if (!tieneCredenciales) {
    const idx = memEventos.findIndex(e => e.rowIndex === rowIndex);
    if (idx !== -1) {
      if (patch.estado !== undefined) registrarEstado(memEventos[idx].id, memEventos[idx].estado, patch.estado, patch.modificadoPor || 'Cal.com');
      Object.assign(memEventos[idx], patch);
    }
    return;
  }
  const sh = getSheets();
  // Estado anterior, para la historia (hoja Estados)
  let antes = null;
  if (patch.estado !== undefined) {
    const r = await sh.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `Eventos!A${rowIndex}:C${rowIndex}`, sinCache: true });
    antes = rowToEvento(r.data.values?.[0] || [], rowIndex - 2);
  }
  const data = [];
  if (patch.estado !== undefined)
    data.push({ range: `Eventos!C${rowIndex}`, values: [[patch.estado]] });
  if (patch.proximoSeguimiento !== undefined)
    data.push({ range: `Eventos!Q${rowIndex}`, values: [[patch.proximoSeguimiento]] });
  if (data.length) {
    // Rastro: quién tocó la ficha por última vez (Cal.com al agendar la visita)
    data.push({ range: `Eventos!AA${rowIndex}:AB${rowIndex}`, values: [[ahoraAR(), patch.modificadoPor || 'Cal.com']] });
    await sh.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { valueInputOption: 'USER_ENTERED', data },
    });
    if (antes) registrarEstado(antes.id, antes.estado, patch.estado, patch.modificadoPor || 'Cal.com');
  }
}

module.exports = {
  getPersonas, addPersona, updatePersona,
  getClientes, addCliente, updateCliente, deleteEvento, patchEvento,
  getIngresos, addIngreso, confirmarIngreso, updateIngreso, deleteIngreso, restaurarIngreso, estadoCuenta, cobroEnPesos,
  getRestricciones, addRestriccion, deleteRestriccion,
  getTimming, addTimmingItem, updateTimmingItem, deleteTimmingItem, updateTimmingVivo,
  getCuotasByCliente, getAllCuotas, createPlan, imputarPago, calcularImputacion,
  calcularCompraCubiertos, estadoCubiertos,
  getConfig, setConfig, pagarCuotas, fotoCuotas, devolverCuotas, filasDeImputacion, aplicarIPC, agregarCuotas, setIndexacionPlan, aplicarIPCAutomatico, ajustarValorCuotas, cancelarPlan, confirmarCuotas,
  getEmpleados, addEmpleado, updateEmpleado,
  getEgresos, addEgreso, updateEgreso, deleteEgreso, restaurarEgreso, confirmarEgreso,
  getCatalogoItems, addCatalogoItem, updateCatalogoItem, deleteCatalogoItem, cambiarCategoriaItem,
  editarItemCatalogo, eliminarItemCatalogo,
  getPedidosCocina, addPedidoCocina, updatePedidoCocina, deletePedidoCocina,
  getStockActual, actualizarMinimoStock, actualizarStockActual, sincronizarStockConCatalogo, sincronizarCatalogoConInicial, sincronizarIngredientesStock,
  initSheets,
  registrarAuditoria, getAuditoria, fotoAuditoria,
  tieneCredenciales,
};
