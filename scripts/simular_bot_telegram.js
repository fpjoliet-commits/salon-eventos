/* Simulador del bot de Telegram — prueba el pipeline SIN Telegram ni Gemini.
   Inyecta una interpretación falsa y verifica que se cree el borrador correcto
   (confirmado:false) en la hoja correspondiente, con la atribución matcheada.

   Uso:  node scripts/simular_bot_telegram.js
   Corre en modo memoria (sin credenciales de Google). */

const sheets = require('../backend/sheets');
const bot = require('../backend/telegram-bot');

const chatMap = { '111': 'fabio' };
const enviados = [];
const sendText = async (chatId, text) => { enviados.push({ chatId, text }); };

// Cada caso trae la "interpretación" que devolvería la IA para ese mensaje.
function updateTexto(texto) { return { update_id: Math.random(), message: { chat: { id: 111 }, text: texto } }; }

(async () => {
  // Cliente para probar la atribución.
  await sheets.addCliente({ apellidoNombre: 'Pérez, Juan', fechaEvento: '2026-12-20', estado: 'Confirmado' });

  const casos = [
    {
      nombre: 'GASTO de evento con cliente',
      ext: { tipo: 'egreso', monto: 80000, moneda: 'ARS', categoria: 'Bebidas', concepto: 'Compra de bebidas', cliente: 'Pérez' },
    },
    {
      nombre: 'GASTO general (luz, sin cliente)',
      ext: { tipo: 'egreso', monto: 145000, moneda: 'ARS', categoria: 'Servicios', concepto: 'Factura de luz', cliente: null },
    },
    {
      nombre: 'PAGO a empleado (Personal, con rol)',
      ext: { tipo: 'egreso', monto: 40000, moneda: 'ARS', categoria: 'Personal', nombreEmpleado: 'Jamaica', rolPago: 'Ayudante de cocina', concepto: 'Pago a empleado', cliente: null },
    },
    {
      nombre: 'COBRO seña en dólares',
      ext: { tipo: 'ingreso', monto: 200, moneda: 'USD', tipoIngreso: 'Seña', formaPago: 'Efectivo', concepto: 'Seña', cliente: 'Perez Juan' },
    },
  ];

  for (const c of casos) {
    const deps = { sheets, sendText, chatMap, interpretar: async () => c.ext, descargarVoz: async () => '' };
    // 1) mensaje -> el bot interpreta y PIDE confirmación (no carga todavía)
    const paso1 = await bot.processUpdate(updateTexto('mensaje de prueba'), deps);
    // 2) el usuario responde "sí" -> recién ahí carga el borrador
    const paso2 = await bot.processUpdate(updateTexto('sí'), deps);
    const reg = paso2.registro || {};
    console.log(`\n▶ ${c.nombre}`);
    console.log(`   paso1: ${paso1.pendiente ? 'pidió confirmación ✓' : JSON.stringify(paso1)}`);
    console.log(`   paso2 (tras "sí"): tipo=${paso2.tipo} monto=${reg.monto} ${reg.moneda} confirmado=${reg.confirmado}` +
                ` atribuido=${paso2.match ? paso2.match.apellidoNombre : '(ninguno)'}` +
                `${reg.nombreEmpleado ? ' empleado=' + reg.nombreEmpleado + '/' + reg.rolPago : ''}`);
  }

  // Caso extra: confirmar tocando el BOTÓN (callback_query) en vez de tipear.
  const depsBtn = { sheets, sendText, chatMap, interpretar: async () => ({ tipo: 'egreso', monto: 33000, moneda: 'ARS', categoria: 'Mantenimiento', concepto: 'arreglo' }), descargarVoz: async () => '', answerCallback: async () => {} };
  await bot.processUpdate(updateTexto('arreglo 33 mil'), depsBtn);
  const rBtn = await bot.processUpdate({ update_id: 999, callback_query: { id: 'cb1', data: 'conf_si', message: { chat: { id: 111 } } } }, depsBtn);
  console.log(`\n▶ Confirmar con BOTÓN: ${rBtn.ok ? 'cargó ✓ ($' + rBtn.registro.monto + ')' : 'FALLÓ'}`);

  // Caso extra: REINICIO del server entre la pregunta y el "Sí".
  // El pendiente debe sobrevivir (está en Config), no perderse con la caché.
  const depsReinicio = { sheets, sendText, chatMap, interpretar: async () => ({ tipo: 'egreso', monto: 50000, moneda: 'ARS', categoria: 'Servicios', concepto: 'internet' }), descargarVoz: async () => '', answerCallback: async () => {} };
  await bot.processUpdate(updateTexto('internet 50 mil'), depsReinicio);
  bot._vaciarCacheParaTest();   // ← simula que Render reinició (RAM vacía)
  const rRe = await bot.processUpdate({ update_id: 1001, callback_query: { id: 'cb2', data: 'conf_si', message: { chat: { id: 111 } } } }, depsReinicio);
  const regRe = rRe.registro || {};
  console.log(`\n▶ Confirmar tras REINICIO: ${regRe.monto ? 'recuperó el pendiente y cargó ✓ ($' + regRe.monto + ')' : 'FALLÓ (se perdió el pendiente) ✗'}`);

  // Caso extra: pide confirmación y el usuario dice "no" -> NO debe cargar nada.
  const depsNo = { sheets, sendText, chatMap, interpretar: async () => ({ tipo: 'egreso', monto: 99999, moneda: 'ARS', categoria: 'Servicios', concepto: 'no cargar' }), descargarVoz: async () => '' };
  await bot.processUpdate(updateTexto('gasto trucho'), depsNo);
  const rNo = await bot.processUpdate(updateTexto('no'), depsNo);
  console.log(`\n▶ Rechazo con "no": ${rNo.cancelado ? 'descartado, no cargó ✓' : 'FALLÓ (cargó algo)'}`);

  const egresos = await sheets.getEgresos();
  const ingresos = await sheets.getIngresos();
  console.log('\n=== RESUMEN ===');
  console.log('Egresos borrador (confirmado=false):', egresos.filter(e => e.confirmado === false).length, '/', egresos.length);
  console.log('Ingresos borrador (confirmado=false):', ingresos.filter(i => i.confirmado === false).length, '/', ingresos.length);
  console.log('Mensajes que hubiera enviado el bot:', enviados.length);
  console.log('\nEjemplo de confirmación al usuario:\n' + enviados[0].text);
})().catch(e => { console.error('ERR', e); process.exit(1); });
