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
      nombre: 'COBRO seña en dólares',
      ext: { tipo: 'ingreso', monto: 200, moneda: 'USD', tipoIngreso: 'Seña', formaPago: 'Efectivo', concepto: 'Seña', cliente: 'Perez Juan' },
    },
  ];

  for (const c of casos) {
    const r = await bot.processUpdate(updateTexto('mensaje de prueba'), {
      sheets, sendText, chatMap,
      interpretar: async () => c.ext,          // IA falsa
      descargarVoz: async () => '',
    });
    const reg = r.registro || {};
    console.log(`\n▶ ${c.nombre}`);
    console.log(`   tipo=${r.tipo} monto=${reg.monto} ${reg.moneda} confirmado=${reg.confirmado}` +
                ` atribuido=${r.match ? r.match.apellidoNombre : '(ninguno)'}`);
  }

  const egresos = await sheets.getEgresos();
  const ingresos = await sheets.getIngresos();
  console.log('\n=== RESUMEN ===');
  console.log('Egresos borrador (confirmado=false):', egresos.filter(e => e.confirmado === false).length, '/', egresos.length);
  console.log('Ingresos borrador (confirmado=false):', ingresos.filter(i => i.confirmado === false).length, '/', ingresos.length);
  console.log('Mensajes que hubiera enviado el bot:', enviados.length);
  console.log('\nEjemplo de confirmación al usuario:\n' + enviados[0].text);
})().catch(e => { console.error('ERR', e); process.exit(1); });
