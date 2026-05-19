const fs = require('fs');
const path = require('path');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Credenciales: primero busca variable de entorno (Railway/producción),
// después busca el archivo local credentials.json (desarrollo local)
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

/* ===================== MODO MEMORIA (sin credenciales) ===================== */
let memClientes = [];
let memIngresos = [];
let memRestricciones = [];

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

/* ===================== MODO GOOGLE SHEETS ===================== */
function getSheets() {
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    credentials: credencialesJSON,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

function rowToCliente(row, index) {
  return {
    rowIndex: index + 2,
    id: row[0] || '',
    estado: row[1] || '',
    cargadoPor: row[2] || '',
    fechaCarga: row[3] || '',
    apellidoNombre: row[4] || '',
    telefono: row[5] || '',
    gmail: row[6] || '',
    redSocial: row[7] || '',
    tipoEvento: row[8] || '',
    formato: row[9] || '',
    fechaEvento: row[10] || '',
    estadoFecha: row[11] || '',
    cantidadInvitados: row[12] || '',
    turno: row[13] || '',
    tipoCliente: row[14] || '',
    exclienteReferencia: row[15] || '',
    exclienteNota: row[16] || '',
    origen: row[17] || '',
    presupuesto: row[18] || '',
    montoPresupuesto: row[19] || '',
    menuInfantil: row[20] || '',
    otrosPedidos: row[21] || '',
    observaciones: row[22] || '',
    proximoSeguimiento: row[23] || '',
  };
}

function clienteToRow(c) {
  return [
    c.id, c.estado, c.cargadoPor, c.fechaCarga, c.apellidoNombre,
    c.telefono, c.gmail, c.redSocial, c.tipoEvento, c.formato,
    c.fechaEvento, c.estadoFecha, c.cantidadInvitados, c.turno,
    c.tipoCliente, c.exclienteReferencia, c.exclienteNota, c.origen,
    c.presupuesto, c.montoPresupuesto, c.menuInfantil, c.otrosPedidos,
    c.observaciones, c.proximoSeguimiento,
  ].map(v => v || '');
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
  };
}

function ingresoToRow(i) {
  return [i.id, i.idCliente, i.tipoIngreso, i.monto, i.fecha, i.formaPago, i.notas].map(v => v || '');
}

function rowToRestriccion(row, index) {
  return {
    rowIndex: index + 2,
    id: row[0] || '',
    idCliente: row[1] || '',
    tipoRestriccion: row[2] || '',
    cantidad: row[3] || '',
  };
}

function restriccionToRow(r) {
  return [r.id, r.idCliente, r.tipoRestriccion, r.cantidad].map(v => v || '');
}

/* ===================== API PÚBLICA ===================== */

async function getClientes() {
  if (!tieneCredenciales) return memClientes;
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Clientes!A2:X',
  });
  return (res.data.values || []).map((row, i) => rowToCliente(row, i));
}

async function addCliente(data) {
  const id = generateId('CLI');
  const now = new Date().toLocaleDateString('es-AR');
  const cliente = { ...data, id, fechaCarga: now };
  if (!tieneCredenciales) {
    cliente.rowIndex = memClientes.length + 2;
    memClientes.push(cliente);
    return cliente;
  }
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Clientes!A:X',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [clienteToRow(cliente)] },
  });
  return cliente;
}

async function updateCliente(rowIndex, data) {
  if (!tieneCredenciales) {
    const idx = memClientes.findIndex(c => c.rowIndex === rowIndex);
    if (idx !== -1) memClientes[idx] = { ...memClientes[idx], ...data };
    return data;
  }
  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Clientes!A${rowIndex}:X${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [clienteToRow(data)] },
  });
  return data;
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

async function getRestricciones() {
  if (!tieneCredenciales) return memRestricciones;
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Restricciones!A2:D',
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
    range: 'Restricciones!A:D',
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
    range: `Restricciones!A${rowIndex}:D${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [['', '', '', '']] },
  });
}

module.exports = {
  getClientes, addCliente, updateCliente,
  getIngresos, addIngreso,
  getRestricciones, addRestriccion, deleteRestriccion,
  tieneCredenciales,
};
