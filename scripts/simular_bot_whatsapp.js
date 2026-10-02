/* =============================================================================
   SIMULADOR DEL BOT DE WHATSAPP (Joy)  —  probar sin número real
   =============================================================================
   Corre la lógica con una "planilla" falsa (no toca Google Sheets ni internet).
   Muestra cómo se verían los mensajes: lista, botones y fotos.

   Uso:
     node scripts/simular_bot_whatsapp.js          (guión de prueba)
     node scripts/simular_bot_whatsapp.js chat      (interactivo: escribís ids o texto)
   ========================================================================== */

const bot = require('../backend/whatsapp-bot');
const config = require('../backend/bot-config');

const leads = [];
const sheetsFake = {
  async addCliente(data) {
    const c = { id: 'EVT-' + (leads.length + 1), ...data };
    leads.push(c);
    console.log(`   📥 [CRM] lead: ${data.observaciones}`);
    return c;
  },
  registrarAuditoria() {},
};

const TEL = '5491154240870';
const ident = s => s.split('\n').map(l => '   ' + l).join('\n');

function render(accion) {
  switch (accion.kind) {
    case 'menu': {
      const saludo = config.saludo.replace('{asistente}', config.nombreAsistente).replace('{salon}', config.nombreSalon);
      console.log('🤖 [LISTA]\n' + ident(saludo));
      console.log('   ┌─ ' + config.menu.boton + ' ▾');
      config.menu.filas.forEach(f => console.log(`   │  ${f.title} — ${f.description}`));
      console.log('   └─');
      break;
    }
    case 'image':
      console.log(`🤖 [FOTO: ${accion.path}]\n` + ident(accion.caption));
      break;
    case 'buttons':
      console.log('🤖\n' + ident(accion.body));
      console.log('   ' + accion.buttons.map(b => `[ ${b.title} ]`).join('  '));
      break;
    case 'text':
      console.log('🤖\n' + ident(accion.body));
      break;
  }
}

async function enviar(input, ahora) {
  const state = bot.getState(TEL);
  const etiqueta = input.id ? `(toca: ${input.id})` : input.text;
  console.log(`\n👤 ${etiqueta}`);
  const acciones = await bot.processMessage(TEL, input, { sheets: sheetsFake, state, ahora });
  acciones.forEach(render);
}

async function guion() {
  const enHorario = new Date('2026-10-02T21:00:00Z');   // ~18:00 ART, viernes
  const fueraHorario = new Date('2026-10-05T14:00:00Z'); // ~11:00 ART, domingo

  console.log('══════════ HORARIOS ══════════');
  console.log('Viernes 18hs deriva?', bot.estaEnHorarioDerivacion(enHorario));
  console.log('Domingo 11hs deriva?', bot.estaEnHorarioDerivacion(fueraHorario));
  console.log('Próximo (desde dom 11hs):', bot.proximoHorarioTexto(fueraHorario));

  console.log('\n══════════ CHARLA 1: saludo → recorrer categorías (en horario) ══════════');
  bot._resetState();
  await enviar({ text: 'Hola' }, enHorario);
  await enviar({ id: 'lugar' }, enHorario);
  await enviar({ id: 'comida' }, enHorario);
  await enviar({ id: 'funciona' }, enHorario);
  await enviar({ id: 'agendar' }, enHorario);
  await enviar({ id: 'hablar' }, enHorario);

  console.log('\n══════════ CHARLA 2: hablar FUERA de horario ══════════');
  bot._resetState();
  await enviar({ text: 'buenas noches' }, fueraHorario);
  await enviar({ id: 'hablar' }, fueraHorario);

  console.log('\n══════════ CHARLA 3: texto que no entiende ══════════');
  bot._resetState();
  await enviar({ text: 'tienen fecha para el 20 de diciembre?' }, enHorario);

  console.log(`\n✔ Leads creados en el CRM: ${leads.length}`);
}

async function interactivo() {
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  bot._resetState();
  console.log('Modo chat. Escribí texto, o un id de opción (lugar, eventos, comida, incluye, funciona, agendar, hablar, menu). "salir" para terminar.\n');
  const loop = () => rl.question('👤 Vos: ', async (txt) => {
    if (txt.trim().toLowerCase() === 'salir') return rl.close();
    const ids = ['lugar', 'eventos', 'comida', 'incluye', 'funciona', 'agendar', 'hablar', 'menu'];
    const input = ids.includes(txt.trim()) ? { id: txt.trim() } : { text: txt };
    await enviar(input, new Date());
    loop();
  });
  loop();
}

if (process.argv[2] === 'chat') interactivo();
else guion();
