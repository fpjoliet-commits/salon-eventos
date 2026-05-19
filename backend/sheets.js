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
let memCuotas = [];
let memTimming = [];

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
    // Sheets con USER_ENTERED convierte 'true'/'false' a boolean nativo al leer
    coronita: row[4] === true || String(row[4]).toLowerCase() === 'true',
  };
}

function restriccionToRow(r) {
  return [r.id, r.idCliente, r.tipoRestriccion, r.cantidad, r.coronita ? 'true' : 'false'].map(v => v || '');
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
// Columnas A-J: id, idCliente, numeroCuota, valorOriginal, valorActual,
//               fechaVencimiento, estado, fechaPago, montoPagado, notas

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
  // valorCuota puede venir explícito (si el usuario lo ajustó) o calculado
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
    range: 'Cuotas!A:J',
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
  // Leer valorActual actual de cada cuota para guardarlo como montoPagado
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

async function initSheets() {
  if (!tieneCredenciales) return;
  try {
    const sheets = getSheets();
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const existing = spreadsheet.data.sheets.map(s => s.properties.title);
    if (!existing.includes('Timming')) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: { requests: [{ addSheet: { properties: { title: 'Timming' } } }] },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Timming!A1:D1',
        valueInputOption: 'USER_ENTERED',
        resource: { values: [['id', 'idCliente', 'hora', 'actividad']] },
      });
      console.log('✅ Hoja "Timming" creada automáticamente.');
    }
    if (!existing.includes('Cuotas')) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: { requests: [{ addSheet: { properties: { title: 'Cuotas' } } }] },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Cuotas!A1:J1',
        valueInputOption: 'USER_ENTERED',
        resource: { values: [['id','idCliente','numeroCuota','valorOriginal','valorActual','fechaVencimiento','estado','fechaPago','montoPagado','notas','moneda']] },
      });
      console.log('✅ Hoja "Cuotas" creada automáticamente.');
    }
  } catch (e) {
    console.error('Error en initSheets:', e.message);
  }
}

module.exports = {
  getClientes, addCliente, updateCliente,
  getIngresos, addIngreso,
  getRestricciones, addRestriccion, deleteRestriccion,
  getTimming, addTimmingItem, updateTimmingItem, deleteTimmingItem,
  getCuotasByCliente, createPlan, pagarCuotas, aplicarIPC, ajustarValorCuotas, cancelarPlan,
  initSheets,
  tieneCredenciales,
};
