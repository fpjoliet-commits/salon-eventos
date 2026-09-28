/* Avisos técnicos por Telegram — SOLO a Lautaro.

   A Fabio, Mariana y Anita no les llega nada técnico: lo que ellos resuelven ya
   está en el CRM (bandeja "Por confirmar", píldoras de la ficha, seguimientos).
   Regla: a cada uno le llega solo lo que puede resolver.

   Usa el mismo bot de Telegram (TELEGRAM_BOT_TOKEN) y manda al chat de
   TELEGRAM_CHAT_ALERTAS. Sin esas dos variables no manda nada (solo consola).

   Un mismo problema avisa como mucho una vez cada 30 minutos: si Google se cae,
   cada pedido falla, y no tiene sentido recibir cien mensajes iguales. */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ALERTAS;
const ESPERA_MS = 30 * 60 * 1000;
const ultimo = new Map();   // clave del problema → cuándo se avisó

const ACTIVO = !!(TOKEN && CHAT);

async function avisar(clave, texto, { fetchImpl = fetch } = {}) {
  console.error(`🚨 [alerta:${clave}] ${texto}`);
  if (!ACTIVO) return false;
  const ahora = Date.now();
  if (ahora - (ultimo.get(clave) || 0) < ESPERA_MS) return false;
  ultimo.set(clave, ahora);
  return enviar(`🚨 CRM Joliet\n${texto}`, { fetchImpl });
}

/* Manda un mensaje al chat de Lautaro, sin freno (el resumen semanal) */
async function enviar(texto, { fetchImpl = fetch } = {}) {
  if (!ACTIVO) { console.log(`[alertas] (sin TELEGRAM_CHAT_ALERTAS) ${texto}`); return false; }
  try {
    // Sin parse_mode: el texto puede traer mensajes de error con _ o * sueltos
    const r = await fetchImpl(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text: texto }),
    });
    return r.ok;
  } catch (e) {
    console.error('[alertas] no se pudo mandar el aviso:', e.message);
    return false;
  }
}

/* Errores de Google que significan "no hay conexión / no hay permiso", no un
   pedido mal armado: sin credenciales válidas, Google caído o sin red. */
function esCaidaDeGoogle(e) {
  const codigo = Number(e?.code || e?.status || e?.response?.status);
  if ([401, 403].includes(codigo) || codigo >= 500) return true;
  return ['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'].includes(e?.code)
    || /invalid_grant|unauthorized_client|Could not load the default credentials/i.test(e?.message || '');
}

module.exports = { avisar, enviar, esCaidaDeGoogle, ACTIVO, _ultimo: ultimo };
