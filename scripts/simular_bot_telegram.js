/* Simulador del bot de Telegram — prueba el pipeline SIN Telegram ni Gemini.
   Inyecta una interpretación falsa y verifica que el borrador (confirmado:false)
   se cree DIRECTO en la hoja correspondiente, con la atribución matcheada, el
   aviso de posible duplicado y el botón "Me equivoqué".

   Uso:  GOOGLE_CREDENTIALS_JSON=x node scripts/simular_bot_telegram.js
   (el valor inválido fuerza el modo memoria: no toca ninguna planilla). */

const sheets = require('../backend/sheets');
const bot = require('../backend/telegram-bot');

const chatMap = { '111': 'Fabio' };
const enviados = [];
const sendText = async (chatId, text, opts = {}) => { enviados.push({ chatId, text, opts }); };
const ultimo = () => enviados[enviados.length - 1];
let fallas = 0;
const check = (nombre, ok, extra = '') => { if (!ok) fallas++; console.log(`${ok ? '✓' : '✗'} ${nombre}${extra ? ' — ' + extra : ''}`); };

function updateTexto(texto) { return { update_id: Math.random(), message: { chat: { id: 111 }, text: texto } }; }
function tocar(data) { return { update_id: Math.random(), callback_query: { id: 'cb', data, message: { chat: { id: 111 } } } }; }
const deps = (ext) => ({ sheets, sendText, chatMap, interpretar: async () => ext, descargarVoz: async () => '', answerCallback: async () => {} });

(async () => {
  await sheets.addCliente({ apellidoNombre: 'Pérez, Juan', nombreAgasajado: 'Sofía', fechaEvento: '2026-12-20', estado: 'Confirmado' });

  // 1) Un mensaje carga directo, sin pedir "Sí"
  const r1 = await bot.processUpdate(updateTexto('seña de Pérez 200 dólares'), deps({ tipo: 'ingreso', monto: 200, moneda: 'USD', tipoIngreso: 'Seña', formaPago: 'Efectivo', concepto: 'Seña', cliente: 'Perez Juan' }));
  check('Cobro cargado directo como borrador', r1.ok && r1.registro.confirmado === false && r1.match?.apellidoNombre === 'Pérez, Juan');
  const boton = ultimo().opts.reply_markup?.inline_keyboard?.[0]?.[0];
  check('Trae un solo botón "Me equivoqué"', boton && boton.callback_data.startsWith('anular:i:'), boton?.callback_data);
  check('Sin aviso de duplicado la primera vez', !r1.duplicado && !ultimo().text.includes('Ojo'));

  // 2) El mismo monto otra vez dentro de la semana: avisa y marca, pero carga igual
  const r2 = await bot.processUpdate(updateTexto('otra vez la seña'), deps({ tipo: 'ingreso', monto: 200, moneda: 'USD', tipoIngreso: 'Seña', cliente: 'Perez' }));
  check('Duplicado: igual se carga', r2.ok && r2.registro.confirmado === false);
  check('Duplicado: avisa en el chat', ultimo().text.includes('⚠️ *Ojo:*'), ultimo().text.split('\n').pop());
  check('Duplicado: queda marcado en la bandeja (notas)', String(r2.registro.notas).startsWith('⚠️ Posible duplicado'), r2.registro.notas);

  // 3) Mismo monto pero otra moneda o un gasto: no es duplicado
  const r3 = await bot.processUpdate(updateTexto('gasto 200 dólares'), deps({ tipo: 'egreso', monto: 200, moneda: 'USD', categoria: 'Servicios', concepto: 'hosting' }));
  check('Un gasto no choca con un cobro del mismo monto', r3.ok && !r3.duplicado);

  // 4) "Me equivoqué" anula el borrador
  const antes = (await sheets.getIngresos()).length;
  const rA = await bot.processUpdate(tocar(boton.callback_data), deps({}));
  check('Me equivoqué: anula', rA.anulado && (await sheets.getIngresos()).length === antes - 1);
  const rA2 = await bot.processUpdate(tocar(boton.callback_data), deps({}));
  check('Tocarlo dos veces no rompe nada', rA2.sin_pendiente);

  // 5) Si Mariana ya lo confirmó, el bot no lo borra
  await sheets.confirmarIngreso(r2.registro.rowIndex, r2.registro.id, 'Mariana');
  const rC = await bot.processUpdate(tocar(`anular:i:${r2.registro.rowIndex}:${r2.registro.id}`), deps({}));
  check('Ya confirmado: no se borra desde el bot', rC.ya_confirmado);

  // 6) Aclaración cobro/gasto: pregunta, y con el toque carga directo
  const d = deps({ tipo: null, monto: 100000, moneda: 'ARS', concepto: 'Carrefour' });
  const a1 = await bot.processUpdate(updateTexto('100 mil Carrefour'), d);
  const a2 = await bot.processUpdate(tocar('aclara:' + a1.draftId + ':tipo:egreso'), d);
  check('Aclaración: pregunta y después carga', a1.aclarando === 'tipo' && a2.ok && a2.tipo === 'egreso');

  // 7) Botón "Sí" de un mensaje viejo que quedó en el chat: ya no hay pedido
  const rViejo = await bot.processUpdate(tocar('conf_si:dviejo123'), deps({}));
  check('Botón "Sí" viejo no carga nada', rViejo.sin_pendiente);

  // 8) Chat no habilitado: devuelve su número
  const rOnb = await bot.processUpdate({ update_id: 7, message: { chat: { id: 987654321 }, text: 'hola' } }, deps({}));
  check('Chat no habilitado devuelve el ID', rOnb.ignorado === 'chat_no_autorizado' && ultimo().text.includes('987654321'));

  console.log('\nEjemplo del mensaje con duplicado:\n' + enviados.find(e => e.text.includes('Ojo')).text);
  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
