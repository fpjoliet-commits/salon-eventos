const fs = require('fs');
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

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

/* ===================== GOOGLE SHEETS CLIENT ===================== */
function getSheets() {
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    credentials: credencialesJSON,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
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
  };
}

function personaToRow(p) {
  return [
    p.id, p.apellidoNombre, p.telefono, p.gmail, p.redSocial,
    p.origen, p.tipoCliente, p.exclienteReferencia, p.exclienteNota,
    p.fechaCarga, p.cargadoPor,
  ].map(v => v || '');
}

/* ===================== EVENTOS ===================== */
// Columnas A-V: id, personaId, estado, cargadoPor, fechaCarga, tipoEvento,
//               formato, fechaEvento, estadoFecha, cantidadInvitados, turno,
//               presupuesto, montoPresupuesto, menuInfantil, otrosPedidos,
//               observaciones, proximoSeguimiento,
//               menuRecepcion, menuIslas, menuPrimerPlato, menuPrincipal, menuPostre

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
  };
}

function eventoToRow(e) {
  return [
    e.id, e.personaId, e.estado, e.cargadoPor, e.fechaCarga,
    e.tipoEvento, e.formato, e.fechaEvento, e.estadoFecha,
    e.cantidadInvitados, e.turno, e.presupuesto, e.montoPresupuesto,
    e.menuInfantil, e.otrosPedidos, e.observaciones, e.proximoSeguimiento,
    e.menuRecepcion, e.menuIslas, e.menuPrimerPlato, e.menuPrincipal, e.menuPostre,
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
    range: 'Personas!A2:K',
  });
  return (res.data.values || []).map((row, i) => rowToPersona(row, i)).filter(p => p.id);
}

async function addPersona(data) {
  const id = generateId('PER');
  const now = new Date().toLocaleDateString('es-AR');
  const persona = { ...data, id, fechaCarga: data.fechaCarga || now };
  if (!tieneCredenciales) {
    persona.rowIndex = memPersonas.length + 2;
    memPersonas.push(persona);
    return persona;
  }
  const sheets = getSheets();
  const colA = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Personas!A:A',
  });
  const nextRow = (colA.data.values || []).length + 1;
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Personas!A:K',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [personaToRow(persona)] },
  });
  persona.rowIndex = nextRow;
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
    range: `Personas!A${rowIndex}:K${rowIndex}`,
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
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Eventos!A2:V' }),
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Personas!A2:K' }),
  ]);
  const personas = (perRes.data.values || []).map((row, i) => rowToPersona(row, i)).filter(p => p.id);
  const personaMap = {};
  personas.forEach(p => { personaMap[p.id] = p; });
  const eventos = (evRes.data.values || []).map((row, i) => rowToEvento(row, i)).filter(e => e.id);
  const countMap = {};
  eventos.forEach(e => { countMap[e.personaId] = (countMap[e.personaId] || 0) + 1; });
  return eventos.map(e => enrichEvento(e, personaMap[e.personaId], countMap[e.personaId]));
}

async function addCliente(data) {
  const now = new Date().toLocaleDateString('es-AR');
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
  };

  if (!tieneCredenciales) {
    evento.rowIndex = memEventos.length + 2;
    memEventos.push(evento);
    return enrichEvento(evento, persona, 1);
  }

  const sheets = getSheets();
  const colA = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Eventos!A:A',
  });
  const nextRow = (colA.data.values || []).length + 1;
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Eventos!A:V',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [eventoToRow(evento)] },
  });
  evento.rowIndex = nextRow;
  return enrichEvento(evento, persona, 1);
}

async function updateCliente(rowIndex, data) {
  // rowIndex = fila en hoja Eventos
  // data.personaRowIndex = fila en hoja Personas (si se envía, se actualiza la persona también)
  if (!tieneCredenciales) {
    const eIdx = memEventos.findIndex(e => e.rowIndex === rowIndex);
    if (eIdx !== -1) {
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
        menuPostre: data.menuPostre,
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
  const eventoData = {
    id: data.id, personaId: data.personaId, estado: data.estado,
    cargadoPor: data.cargadoPor, fechaCarga: data.fechaCarga,
    tipoEvento: data.tipoEvento, formato: data.formato, fechaEvento: data.fechaEvento,
    estadoFecha: data.estadoFecha, cantidadInvitados: data.cantidadInvitados,
    turno: data.turno, presupuesto: data.presupuesto, montoPresupuesto: data.montoPresupuesto,
    menuInfantil: data.menuInfantil, otrosPedidos: data.otrosPedidos,
    observaciones: data.observaciones, proximoSeguimiento: data.proximoSeguimiento,
    menuRecepcion: data.menuRecepcion, menuIslas: data.menuIslas,
    menuPrimerPlato: data.menuPrimerPlato, menuPrincipal: data.menuPrincipal,
    menuPostre: data.menuPostre,
  };

  const ops = [
    sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Eventos!A${rowIndex}:V${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [eventoToRow(eventoData)] },
    }),
  ];

  if (data.personaRowIndex) {
    const personaData = {
      id: data.personaId,
      apellidoNombre: data.apellidoNombre, telefono: data.telefono,
      gmail: data.gmail, redSocial: data.redSocial, origen: data.origen,
      tipoCliente: data.tipoCliente, exclienteReferencia: data.exclienteReferencia,
      exclienteNota: data.exclienteNota, fechaCarga: data.fechaCarga,
      cargadoPor: data.cargadoPor,
    };
    ops.push(
      sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Personas!A${data.personaRowIndex}:K${data.personaRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [personaToRow(personaData)] },
      })
    );
  }

  await Promise.all(ops);
  return data;
}

/* ===================== INGRESOS ===================== */
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
  };
}

function ingresoToRow(i) {
  return [i.id, i.idCliente, i.tipoIngreso, i.monto, i.fecha, i.formaPago, i.notas].map(v => v || '');
}

async function getIngresos() {
  if (!tieneCredenciales) return memIngresos;
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Ingresos!A2:G',
  });
  return (res.data.values || []).map((row, i) => rowToIngreso(row, i));
}

async function addIngreso(data) {
  const id = generateId('ING');
  const ingreso = { ...data, id };
  if (!tieneCredenciales) {
    ingreso.rowIndex = memIngresos.length + 2;
    memIngresos.push(ingreso);
    return ingreso;
  }
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Ingresos!A:G',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [ingresoToRow(ingreso)] },
  });
  return ingreso;
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
function rowToTimming(row, index) {
  return {
    rowIndex: index + 2,
    id: row[0] || '',
    idCliente: row[1] || '',
    hora: row[2] || '',
    actividad: row[3] || '',
  };
}

function timmingToRow(t) {
  return [t.id, t.idCliente, t.hora, t.actividad].map(v => v || '');
}

async function getTimming(idCliente) {
  if (!tieneCredenciales) {
    return memTimming.filter(t => t.idCliente === idCliente).sort((a, b) => a.hora.localeCompare(b.hora));
  }
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Timming!A2:D',
  });
  return (res.data.values || [])
    .map((row, i) => rowToTimming(row, i))
    .filter(t => t.idCliente === idCliente && t.id)
    .sort((a, b) => a.hora.localeCompare(b.hora));
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
    range: 'Timming!A:D',
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
    range: `Timming!C${rowIndex}:D${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[data.hora, data.actividad]] },
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
    range: `Timming!A${rowIndex}:D${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [['', '', '', '']] },
  });
}

/* ===================== CUOTAS ===================== */
// Columnas A-K: id, idCliente (=idEvento), numeroCuota, valorOriginal, valorActual,
//               fechaVencimiento, estado, fechaPago, montoPagado, notas, moneda

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
  };
}

function cuotaToRow(c) {
  return [
    c.id, c.idCliente, c.numeroCuota, c.valorOriginal, c.valorActual,
    c.fechaVencimiento, c.estado, c.fechaPago || '', c.montoPagado || 0, c.notas || '',
    c.moneda || 'ARS',
  ].map(v => (v !== undefined && v !== null) ? String(v) : '');
}

async function getCuotasByCliente(idCliente) {
  if (!tieneCredenciales) {
    return memCuotas.filter(c => c.idCliente === idCliente && c.estado !== 'cancelada');
  }
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Cuotas!A2:K',
  });
  return (res.data.values || [])
    .map((row, i) => rowToCuota(row, i))
    .filter(c => c.idCliente === idCliente && c.estado !== 'cancelada');
}

async function createPlan(idCliente, montoTotal, cantidadCuotas, valorCuota, fechaInicio, moneda = 'ARS') {
  const valor = valorCuota || Math.round(montoTotal / cantidadCuotas);
  const [y, m, d] = fechaInicio.split('-').map(Number);
  const cuotas = [];
  for (let i = 0; i < cantidadCuotas; i++) {
    const fecha = new Date(y, m - 1 + i, d);
    const fv = `${fecha.getFullYear()}-${String(fecha.getMonth()+1).padStart(2,'0')}-${String(fecha.getDate()).padStart(2,'0')}`;
    cuotas.push({
      id: generateId('CUO'),
      idCliente,
      numeroCuota: i + 1,
      valorOriginal: valor,
      valorActual: valor,
      fechaVencimiento: fv,
      estado: 'pendiente',
      fechaPago: '',
      montoPagado: 0,
      notas: '',
      moneda: moneda || 'ARS',
    });
  }
  if (!tieneCredenciales) {
    cuotas.forEach(c => { c.rowIndex = memCuotas.length + 2; memCuotas.push(c); });
    return cuotas;
  }
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Cuotas!A:K',
    valueInputOption: 'USER_ENTERED',
    resource: { values: cuotas.map(cuotaToRow) },
  });
  return cuotas;
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

async function aplicarIPC(idCliente, porcentaje) {
  const cuotas = await getCuotasByCliente(idCliente);
  const pendientes = cuotas.filter(c => c.estado === 'pendiente');
  if (!pendientes.length) return { updated: 0 };
  if (!tieneCredenciales) {
    pendientes.forEach(c => {
      const idx = memCuotas.findIndex(mc => mc.rowIndex === c.rowIndex);
      if (idx !== -1) memCuotas[idx].valorActual = Math.round(c.valorActual * (1 + porcentaje / 100));
    });
    return { updated: pendientes.length };
  }
  const sheets = getSheets();
  const data = pendientes.map(c => ({
    range: `Cuotas!E${c.rowIndex}`,
    values: [[Math.round(c.valorActual * (1 + porcentaje / 100))]],
  }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { valueInputOption: 'USER_ENTERED', data },
  });
  return { updated: pendientes.length };
}

async function ajustarValorCuotas(idCliente, nuevoValor) {
  const cuotas = await getCuotasByCliente(idCliente);
  const pendientes = cuotas.filter(c => c.estado === 'pendiente');
  if (!pendientes.length) return { updated: 0 };
  if (!tieneCredenciales) {
    pendientes.forEach(c => {
      const idx = memCuotas.findIndex(mc => mc.rowIndex === c.rowIndex);
      if (idx !== -1) memCuotas[idx].valorActual = nuevoValor;
    });
    return { updated: pendientes.length };
  }
  const sheets = getSheets();
  const data = pendientes.map(c => ({
    range: `Cuotas!E${c.rowIndex}`,
    values: [[nuevoValor]],
  }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { valueInputOption: 'USER_ENTERED', data },
  });
  return { updated: pendientes.length };
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

/* ===================== PAPELERA ===================== */
// Columnas A-E: fechaEliminacion, eliminadoPor, tipo, id, datosJSON
// Solo se puede leer desde el Google Sheets directamente (no hay ruta API)

async function archivarEnPapelera(tipo, id, datos, eliminadoPor) {
  const fecha = new Date().toLocaleString('es-AR');
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
  await archivarEnPapelera('Evento', clienteData.id, clienteData, usuario);
  if (!tieneCredenciales) {
    const idx = memEventos.findIndex(e => e.rowIndex === rowIndex);
    if (idx !== -1) memEventos[idx] = { ...memEventos[idx], id: '' }; // blank out
    return;
  }
  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Eventos!A${rowIndex}:V${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [Array(22).fill('')] },
  });
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

    if (toCreate.length) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: { requests: toCreate.map(title => ({ addSheet: { properties: { title } } })) },
      });
    }

    const headers = [];
    if (!existing.includes('Personas')) {
      headers.push({ range: 'Personas!A1:K1', values: [['id','apellidoNombre','telefono','gmail','redSocial','origen','tipoCliente','exclienteReferencia','exclienteNota','fechaCarga','cargadoPor']] });
    }
    if (!existing.includes('Eventos')) {
      headers.push({ range: 'Eventos!A1:V1', values: [['id','personaId','estado','cargadoPor','fechaCarga','tipoEvento','formato','fechaEvento','estadoFecha','cantidadInvitados','turno','presupuesto','montoPresupuesto','menuInfantil','otrosPedidos','observaciones','proximoSeguimiento','menuRecepcion','menuIslas','menuPrimerPlato','menuPrincipal','menuPostre']] });
    }
    if (!existing.includes('Timming')) {
      headers.push({ range: 'Timming!A1:D1', values: [['id','idCliente','hora','actividad']] });
    }
    if (!existing.includes('Cuotas')) {
      headers.push({ range: 'Cuotas!A1:K1', values: [['id','idCliente','numeroCuota','valorOriginal','valorActual','fechaVencimiento','estado','fechaPago','montoPagado','notas','moneda']] });
    }
    if (!existing.includes('Papelera')) {
      headers.push({ range: 'Papelera!A1:E1', values: [['fechaEliminacion','eliminadoPor','tipo','id','datosJSON']] });
    }

    if (headers.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: { valueInputOption: 'USER_ENTERED', data: headers },
      });
      console.log('✅ Hojas creadas:', toCreate.join(', '));
    }
  } catch (e) {
    console.error('Error en initSheets:', e.message);
  }
}

module.exports = {
  getPersonas, addPersona, updatePersona,
  getClientes, addCliente, updateCliente, deleteEvento,
  getIngresos, addIngreso,
  getRestricciones, addRestriccion, deleteRestriccion,
  getTimming, addTimmingItem, updateTimmingItem, deleteTimmingItem,
  getCuotasByCliente, createPlan, pagarCuotas, aplicarIPC, ajustarValorCuotas, cancelarPlan,
  initSheets,
  tieneCredenciales,
};
