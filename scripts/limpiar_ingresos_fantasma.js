/* =============================================================================
   LIMPIEZA DE INGRESOS FANTASMA
   =============================================================================
   Borra de la hoja Ingresos las filas "fantasma": las que tienen id pero no
   tienen ni monto ni fecha. Las creaba POST /api/ingresos cuando todavía no
   validaba el cuerpo del pedido — generaba el id, dejaba todo lo demás en
   blanco y marcaba confirmado=true, así que pasaban los filtros del historial
   y se veían como "Ingreso / Otro / — / sin cliente / $ 0".

   La validación ya está arreglada (no se crean más). Esto limpia las que
   quedaron de antes.

   CÓMO USARLO
   -----------
   1) Primero SIEMPRE en seco, que no toca nada y te dice qué haría:

        node scripts/limpiar_ingresos_fantasma.js

   2) Revisá la lista. Si está bien, ejecutá de verdad:

        node scripts/limpiar_ingresos_fantasma.js --aplicar

   Necesita las mismas credenciales que el servidor (backend/.env y
   backend/credentials.json). Si las tenés solo en Render, corrélo desde la
   Shell de Render, parado en la raíz del proyecto.

   QUÉ HACE EXACTAMENTE
   --------------------
   VACÍA la fila (la deja en blanco), NO la elimina. Es a propósito: borrar la
   fila correría todas las de abajo y rompería el rowIndex que el sistema usa
   para editar y confirmar movimientos. Una fila en blanco no molesta a nadie:
   getIngresos() ahora las descarta.

   SEGURIDAD
   ---------
   - Nunca toca una fila que tenga monto > 0, aunque le falte todo lo demás.
   - Nunca toca una fila que tenga fecha.
   - Antes de escribir, imprime exactamente lo que va a vaciar.
   ========================================================================== */

const path = require('path');
const RAIZ = path.join(__dirname, '..');

require(path.join(RAIZ, 'backend', 'node_modules', 'dotenv'))
  .config({ path: path.join(RAIZ, 'backend', '.env') });
const { google } = require(path.join(RAIZ, 'backend', 'node_modules', 'googleapis'));

const APLICAR = process.argv.includes('--aplicar');
const COLUMNAS = 16;   // A..P

function credenciales() {
  const v = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!v) throw new Error('Falta GOOGLE_SERVICE_ACCOUNT_KEY en backend/.env');
  // Puede ser el JSON entero (Render) o la ruta a un archivo (desarrollo local).
  if (v.trim().startsWith('{')) return JSON.parse(v);
  return require(path.resolve(RAIZ, 'backend', v));
}

(async () => {
  const auth = new google.auth.GoogleAuth({
    credentials: credenciales(),
    scopes: [APLICAR
      ? 'https://www.googleapis.com/auth/spreadsheets'
      : 'https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const api = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const ID = process.env.SPREADSHEET_ID;

  const res = await api.spreadsheets.values.get({
    spreadsheetId: ID,
    range: 'Ingresos!A2:P',
  });
  const filas = res.data.values || [];

  const fantasmas = [];
  filas.forEach((r, i) => {
    const fila = i + 2;                      // +2: la 1 es el encabezado
    const id = (r[0] || '').trim();
    const monto = parseFloat(r[3]);
    const fecha = (r[4] || '').trim();
    if (!id) return;                         // fila ya vacía: nada que hacer
    if (Number.isFinite(monto) && monto > 0) return;   // tiene plata: NO tocar
    if (fecha) return;                                  // tiene fecha: NO tocar
    fantasmas.push({ fila, id, raw: r });
  });

  const reales = filas.filter(r => (r[0] || '').trim()).length - fantasmas.length;
  console.log('');
  console.log('Hoja Ingresos: ' + filas.length + ' filas leídas');
  console.log('  movimientos reales : ' + reales);
  console.log('  fantasmas          : ' + fantasmas.length);
  console.log('');

  if (!fantasmas.length) {
    console.log('No hay nada que limpiar. ✓');
    return;
  }

  console.log('Filas que se van a vaciar:');
  fantasmas.forEach(f => {
    console.log('  fila ' + String(f.fila).padStart(4) + '  id=' + f.id);
    console.log('            contenido actual: ' + JSON.stringify(f.raw));
  });
  console.log('');

  if (!APLICAR) {
    console.log('▶ Modo SECO: no se tocó nada.');
    console.log('  Si la lista de arriba es correcta, volvé a correrlo con:');
    console.log('     node scripts/limpiar_ingresos_fantasma.js --aplicar');
    return;
  }

  // Se vacían en un solo batch para que no quede a medio camino.
  await api.spreadsheets.values.batchUpdate({
    spreadsheetId: ID,
    resource: {
      valueInputOption: 'USER_ENTERED',
      data: fantasmas.map(f => ({
        range: 'Ingresos!A' + f.fila + ':P' + f.fila,
        values: [Array(COLUMNAS).fill('')],
      })),
    },
  });

  console.log('✓ Listo: ' + fantasmas.length + ' fila(s) vaciada(s).');
  console.log('  Las filas quedan en blanco (no eliminadas) para no correr los');
  console.log('  rowIndex del resto. El sistema ya las ignora.');
})().catch(e => {
  console.error('');
  console.error('ERROR: ' + e.message);
  console.error('');
  console.error('Revisá que backend/.env tenga GOOGLE_SERVICE_ACCOUNT_KEY y');
  console.error('SPREADSHEET_ID, y que la cuenta de servicio tenga acceso a la planilla.');
  process.exit(1);
});
