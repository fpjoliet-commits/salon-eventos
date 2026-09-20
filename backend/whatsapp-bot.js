/* =============================================================================
   BOT DE WHATSAPP  —  WhatsApp Cloud API (oficial de Meta)
   =============================================================================
   Bot REACTIVO y SIN IA. La gente escribe primero; el bot responde con un menú
   numerado, contesta preguntas frecuentes, agenda visitas (vía Cal.com, que ya
   alimenta el CRM) y deriva a una persona SOLO en el horario configurado.

   Todo vive detrás de variables de entorno: si no están seteadas, el módulo
   queda dormido y no toca nada. Ver docs/whatsapp-bot-setup.md.

   Variables de entorno:
     WHATSAPP_TOKEN            token permanente del System User de Meta
     WHATSAPP_PHONE_NUMBER_ID  id del número (NO el número en sí)
     WHATSAPP_VERIFY_TOKEN     texto inventado por vos para validar el webhook
     WHATSAPP_APP_SECRET       (opcional) secreto de la app, para verificar firma
     GRAPH_API_VERSION         (opcional) por defecto v21.0
   ========================================================================== */

const crypto = require('crypto');
const express = require('express');
const config = require('./bot-config');

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;
const GRAPH_VERSION = process.env.GRAPH_API_VERSION || 'v21.0';

// El bot está "activo" solo si tiene lo mínimo para hablar con Meta.
const BOT_ACTIVO = Boolean(TOKEN && PHONE_NUMBER_ID && VERIFY_TOKEN);

/* ─────────────────────── Estado de conversación ───────────────────────────
   En memoria, con vencimiento. Si Render reinicia, la charla vuelve a empezar
   por el menú: es aceptable y mantiene todo gratis y simple. */
const STATE_TTL_MS = 6 * 60 * 60 * 1000;   // 6 horas
const _conv = new Map();                    // telefono -> { paso, leadCreado, visto }

function getState(telefono) {
  const now = Date.now();
  const e = _conv.get(telefono);
  if (e && now - e.visto < STATE_TTL_MS) { e.visto = now; return e; }
  const nuevo = { paso: 'menu', leadCreado: false, visto: now };
  _conv.set(telefono, nuevo);
  return nuevo;
}

// Limpieza perezosa para que el Map no crezca infinito.
function limpiarViejos() {
  const now = Date.now();
  for (const [k, v] of _conv) if (now - v.visto > STATE_TTL_MS) _conv.delete(k);
}

/* ─────────────────────── Horario de derivación ────────────────────────────── */

// Devuelve { dia (0-6), minutos (desde medianoche) } en la zona horaria configurada.
function ahoraLocal(tz, date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  const diasMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dia = diasMap[parts.weekday];
  let hora = parseInt(parts.hour, 10);
  if (hora === 24) hora = 0;                 // algunos runtimes dan "24" a medianoche
  const minutos = hora * 60 + parseInt(parts.minute, 10);
  return { dia, minutos };
}

const aMinutos = hhmm => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function estaEnHorarioDerivacion(date = new Date()) {
  const cfg = config.horarioDerivacion;
  const { dia, minutos } = ahoraLocal(cfg.timezone, date);
  const rangos = cfg.dias[dia] || [];
  return rangos.some(([desde, hasta]) => minutos >= aMinutos(desde) && minutos < aMinutos(hasta));
}

// Texto humano del próximo horario de atención (para el mensaje fuera de horario).
const NOMBRE_DIA = ['el domingo', 'el lunes', 'el martes', 'el miércoles', 'el jueves', 'el viernes', 'el sábado'];
function proximoHorarioTexto(date = new Date()) {
  const cfg = config.horarioDerivacion;
  const { dia, minutos } = ahoraLocal(cfg.timezone, date);
  for (let salto = 0; salto < 7; salto++) {
    const d = (dia + salto) % 7;
    const rangos = cfg.dias[d] || [];
    for (const [desde] of rangos) {
      if (salto === 0 && minutos >= aMinutos(desde)) continue; // ya pasó hoy
      const cuando = salto === 0 ? 'hoy' : (salto === 1 ? 'mañana' : NOMBRE_DIA[d]);
      return `${cuando} a partir de las ${desde} hs`;
    }
  }
  return 'en el próximo horario de atención';
}

/* ─────────────────────── Envío de mensajes a Meta ─────────────────────────── */

async function sendText(to, body) {
  if (!BOT_ACTIVO) { console.warn('[bot] sendText ignorado: bot inactivo'); return; }
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    console.error(`[bot] Meta rechazó el envío (${res.status}): ${detalle}`);
  }
}

/* ─────────────────────── Lógica del bot (testeable) ────────────────────────
   processMessage NO habla con la red: recibe deps y devuelve la lista de
   respuestas de texto. Así el simulador la ejecuta sin número real.
   deps = { sheets, ahora?, crearLead? } */

async function crearLeadCRM(sheets, telefono, nombre, observaciones) {
  try {
    const data = {
      apellidoNombre: nombre || `WhatsApp ${telefono}`,
      telefono,
      estado: 'Consulta',
      origen: 'WhatsApp',
      observaciones: observaciones || '',
      cargadoPor: 'bot-whatsapp',
    };
    const cliente = await sheets.addCliente(data);
    if (sheets.registrarAuditoria) {
      sheets.registrarAuditoria({
        usuario: 'bot-whatsapp', accion: 'Creó', entidad: 'Evento',
        idEntidad: cliente.id, nombre: data.apellidoNombre,
        detalle: 'Lead entrante por WhatsApp',
      });
    }
    return cliente;
  } catch (e) {
    console.error('[bot] no se pudo crear lead:', e.message);
    return null;
  }
}

// Normaliza el texto del usuario: minúsculas, sin espacios extremos, sin tildes.
function normalizar(t) {
  return (t || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const SALUDOS = ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'hi', 'buen dia'];

async function processMessage(telefono, textoCrudo, deps) {
  const { sheets } = deps;
  const ahora = deps.ahora || new Date();
  const crearLead = deps.crearLead || crearLeadCRM;
  const t = config.textos;
  const st = deps.state || getState(telefono);
  const texto = normalizar(textoCrudo);
  const salidas = [];

  // "menu" / saludo → siempre vuelve al menú.
  if (texto === 'menu' || texto === 'menú' || SALUDOS.includes(texto)) {
    st.paso = 'menu';
    salidas.push(t.menu);
    return salidas;
  }

  // Paso especial: estábamos esperando que escriba una fecha (opción 5).
  if (st.paso === 'esperando_fecha') {
    st.paso = 'menu';
    if (!st.leadCreado) {
      await crearLead(sheets, telefono, null, `Consulta de disponibilidad por WhatsApp: "${textoCrudo}"`);
      st.leadCreado = true;
    }
    salidas.push(
      `¡Gracias! 📅 Anoté tu consulta para *${textoCrudo}*.\n` +
      'El equipo te confirma la disponibilidad a la brevedad.\n\n' +
      'Si querés, podés agendar una visita mientras tanto escribiendo *6*.'
    );
    return salidas;
  }

  // Menú principal por número.
  switch (texto) {
    case '1': case '2': case '3': case '4':
      salidas.push(config.faq[texto] + '\n\n_Escribí *menu* para volver._');
      return salidas;

    case '5': // Disponibilidad de fecha
      st.paso = 'esperando_fecha';
      salidas.push('Decime la *fecha* que te interesa (por ej. "15 de marzo 2026") y qué tipo de evento es. 📆');
      return salidas;

    case '6': // Agendar visita
      if (!st.leadCreado) {
        await crearLead(sheets, telefono, null, 'Pidió agendar visita por WhatsApp');
        st.leadCreado = true;
      }
      salidas.push(
        '¡Genial! 🏛️ Reservá el día y horario que mejor te quede desde acá:\n' +
        config.linkAgendaVisita + '\n\n' +
        'Cuando lo confirmes, queda agendado automáticamente. ¡Te esperamos!'
      );
      return salidas;

    case '7': { // Hablar con una persona
      if (!st.leadCreado) {
        await crearLead(sheets, telefono, null, 'Pidió hablar con una persona por WhatsApp');
        st.leadCreado = true;
      }
      if (estaEnHorarioDerivacion(ahora)) {
        salidas.push(t.derivacionEnHorario);
      } else {
        salidas.push(t.derivacionFueraHorario.replace('{proximo}', proximoHorarioTexto(ahora)));
      }
      return salidas;
    }

    default:
      salidas.push(t.noEntendido);
      return salidas;
  }
}

/* ─────────────────────── Router de Express (webhook) ───────────────────────── */

function verificarFirma(req) {
  if (!APP_SECRET) return true; // sin secreto configurado, no verificamos (dev)
  const firma = req.get('x-hub-signature-256');
  if (!firma || !req.rawBody) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(req.rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperado));
  } catch { return false; }
}

// Anti-duplicados: Meta reintenta webhooks. Recordamos los ids ya procesados.
const _vistos = new Set();
function yaVisto(id) {
  if (!id) return false;
  if (_vistos.has(id)) return true;
  _vistos.add(id);
  if (_vistos.size > 2000) _vistos.clear();
  return false;
}

function crearRouter(sheets) {
  const router = express.Router();

  // GET: verificación del webhook (Meta lo llama una vez al configurarlo).
  router.get('/webhook/whatsapp', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[bot] webhook verificado por Meta');
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  });

  // POST: llegada de mensajes.
  router.post('/webhook/whatsapp', async (req, res) => {
    if (!verificarFirma(req)) return res.sendStatus(401);
    res.sendStatus(200); // respondemos rápido; procesamos después

    try {
      const entry = req.body?.entry?.[0];
      const value = entry?.changes?.[0]?.value;
      const mensajes = value?.messages;
      if (!Array.isArray(mensajes)) return; // status updates, etc.

      const perfilNombre = value?.contacts?.[0]?.profile?.name;

      for (const msg of mensajes) {
        if (yaVisto(msg.id)) continue;
        const from = msg.from;
        const texto = msg.text?.body || (msg.button?.text) || (msg.interactive?.button_reply?.title) || '';
        if (!texto) {
          await sendText(from, config.textos.noEntendido);
          continue;
        }
        const st = getState(from);
        if (perfilNombre && !st.nombre) st.nombre = perfilNombre;
        const respuestas = await processMessage(from, texto, { sheets, state: st });
        for (const r of respuestas) await sendText(from, r);
      }
      limpiarViejos();
    } catch (e) {
      console.error('[bot] error procesando webhook:', e.message);
    }
  });

  return router;
}

module.exports = {
  BOT_ACTIVO,
  crearRouter,
  sendText,
  // Exportados para el simulador / tests:
  processMessage,
  estaEnHorarioDerivacion,
  proximoHorarioTexto,
  ahoraLocal,
  getState,
  _resetState: () => _conv.clear(),
};
