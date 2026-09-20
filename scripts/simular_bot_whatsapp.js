/* =============================================================================
   SIMULADOR DEL BOT DE WHATSAPP  —  probar sin número real
   =============================================================================
   Corre la lógica del bot con una "planilla" falsa (no toca Google Sheets ni
   internet). Sirve para ver las respuestas y verificar la regla de horarios.

   Uso:
     node scripts/simular_bot_whatsapp.js            (corre el guión de prueba)
     node scripts/simular_bot_whatsapp.js chat        (modo interactivo)
   ========================================================================== */

const bot = require('../backend/whatsapp-bot');

// Planilla falsa: guarda los leads en memoria en vez de Google Sheets.
const leads = [];
const sheetsFake = {
  async addCliente(data) {
    const c = { id: 'EVT-' + (leads.length + 1), ...data };
    leads.push(c);
    console.log(`   📥 [CRM] lead creado: ${data.apellidoNombre} — ${data.observaciones}`);
    return c;
  },
  registrarAuditoria() {},
};

const TELEFONO = '5493411234567';

async function enviar(texto, ahora) {
  bot.getState(TELEFONO); // asegura estado
  const state = bot.getState(TELEFONO);
  const respuestas = await bot.processMessage(TELEFONO, texto, { sheets: sheetsFake, state, ahora });
  console.log(`\n👤 Cliente: ${texto}`);
  for (const r of respuestas) console.log(`🤖 Bot:\n${r.split('\n').map(l => '   ' + l).join('\n')}`);
}

async function guion() {
  // Un miércoles 14:00 (dentro de horario) y un domingo 23:00 (fuera).
  const enHorario = new Date('2026-09-09T17:00:00Z'); // ~14:00 ART miércoles
  const fueraHorario = new Date('2026-09-13T02:00:00Z'); // ~23:00 ART sábado noche

  console.log('══════════ HORARIOS ══════════');
  console.log('¿Miércoles 14hs en horario de derivación?', bot.estaEnHorarioDerivacion(enHorario));
  console.log('¿Sábado 23hs en horario de derivación?  ', bot.estaEnHorarioDerivacion(fueraHorario));
  console.log('Próximo horario (desde sábado 23hs):    ', bot.proximoHorarioTexto(fueraHorario));

  console.log('\n══════════ CHARLA 1: dudas + agendar (en horario) ══════════');
  bot._resetState();
  await enviar('Hola', enHorario);
  await enviar('2', enHorario);
  await enviar('6', enHorario);
  await enviar('7', enHorario);

  console.log('\n══════════ CHARLA 2: hablar con alguien FUERA de horario ══════════');
  bot._resetState();
  await enviar('buenas noches', fueraHorario);
  await enviar('7', fueraHorario);

  console.log('\n══════════ CHARLA 3: consultar disponibilidad de fecha ══════════');
  bot._resetState();
  await enviar('menu', enHorario);
  await enviar('5', enHorario);
  await enviar('15 de marzo 2026, casamiento', enHorario);

  console.log('\n══════════ CHARLA 4: no entiende ══════════');
  bot._resetState();
  await enviar('cuanto sale??', enHorario);

  console.log(`\n✔ Total de leads que se habrían creado en el CRM: ${leads.length}`);
}

async function interactivo() {
  const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  bot._resetState();
  console.log('Modo chat (escribí "salir" para terminar). Empezá saludando.\n');
  const pregunta = () => readline.question('👤 Vos: ', async (texto) => {
    if (texto.trim().toLowerCase() === 'salir') { readline.close(); return; }
    await enviar(texto, new Date());
    pregunta();
  });
  pregunta();
}

if (process.argv[2] === 'chat') interactivo();
else guion();
