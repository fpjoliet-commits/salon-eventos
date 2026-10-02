/* =============================================================================
   BOT DE WHATSAPP (Joy)  —  WhatsApp Cloud API (oficial de Meta)
   =============================================================================
   Bot REACTIVO y SIN IA. Menú por botones/lista interactiva, respuestas de
   preguntas frecuentes con fotos, agenda de visitas (Cal.com → CRM) y derivación
   a una persona SOLO en el horario configurado. Nunca habla de precios.

   Todo vive detrás de variables de entorno WHATSAPP_*. Si faltan, el módulo
   queda dormido. Contenido editable en bot-config.js. Alta en Meta: ver el chat.
   ========================================================================== */

const crypto = require('crypto');
const express = require('express');
const config = require('./bot-config');

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;
const GRAPH_VERSION = process.env.GRAPH_API_VERSION || 'v21.0';

const BOT_ACTIVO = Boolean(TOKEN && PHONE_NUMBER_ID && VERIFY_TOKEN);

/* ─────────────────────── Estado de conversación ─────────────────────────── */
const STATE_TTL_MS = 6 * 60 * 60 * 1000;
const _conv = new Map();

function getState(telefono) {
  const now = Date.now();
  const e = _conv.get(telefono);
  if (e && now - e.visto < STATE_TTL_MS) { e.visto = now; return e; }
  const nuevo = { leadCreado: false, visto: now };
  _conv.set(telefono, nuevo);
  return nuevo;
}
function limpiarViejos() {
  const now = Date.now();
  for (const [k, v] of _conv) if (now - v.visto > STATE_TTL_MS) _conv.delete(k);
}

/* ─────────────────────── Horario de derivación ───────────────────────────── */
function ahoraLocal(tz, date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  const diasMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hora = parseInt(parts.hour, 10);
  if (hora === 24) hora = 0;
  return { dia: diasMap[parts.weekday], minutos: hora * 60 + parseInt(parts.minute, 10) };
}
const aMinutos = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

function estaEnHorarioDerivacion(date = new Date()) {
  const cfg = config.horarioDerivacion;
  const { dia, minutos } = ahoraLocal(cfg.timezone, date);
  return (cfg.dias[dia] || []).some(([d, h]) => minutos >= aMinutos(d) && minutos < aMinutos(h));
}

const NOMBRE_DIA = ['el domingo', 'el lunes', 'el martes', 'el miércoles', 'el jueves', 'el viernes', 'el sábado'];
function proximoHorarioTexto(date = new Date()) {
  const cfg = config.horarioDerivacion;
  const { dia, minutos } = ahoraLocal(cfg.timezone, date);
  for (let salto = 0; salto < 7; salto++) {
    const d = (dia + salto) % 7;
    for (const [desde] of (cfg.dias[d] || [])) {
      if (salto === 0 && minutos >= aMinutos(desde)) continue;
      const cuando = salto === 0 ? 'hoy' : (salto === 1 ? 'mañana' : NOMBRE_DIA[d]);
      return `${cuando} a partir de las ${desde} hs`;
    }
  }
  return 'en el próximo horario de atención';
}

/* ─────────────────────── Envío a Meta ─────────────────────────────────────
   Un único POST; el "mensaje" cambia según el tipo. */
async function enviarMeta(payload) {
  if (!BOT_ACTIVO) { console.warn('[bot] envío ignorado: bot inactivo'); return; }
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  if (!res.ok) console.error(`[bot] Meta rechazó (${res.status}): ${await res.text().catch(() => '')}`);
}

const sendText = (to, body) => enviarMeta({ to, type: 'text', text: { body } });
const sendImage = (to, link, caption) => enviarMeta({ to, type: 'image', image: { link, caption } });

function sendButtons(to, body, botones) {
  return enviarMeta({
    to, type: 'interactive',
    interactive: {
      type: 'button', body: { text: body },
      action: { buttons: botones.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
    },
  });
}

function sendList(to) {
  const m = config.menu;
  const saludo = config.saludo
    .replace('{asistente}', config.nombreAsistente)
    .replace('{salon}', config.nombreSalon);
  return enviarMeta({
    to, type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: m.header },
      body: { text: saludo },
      footer: { text: m.footer },
      action: {
        button: m.boton,
        sections: [{ title: 'Opciones', rows: m.filas }],
      },
    },
  });
}

/* ─────────────────────── CRM ─────────────────────────────────────────────── */
async function crearLeadCRM(sheets, telefono, observaciones) {
  try {
    const data = {
      apellidoNombre: `WhatsApp ${telefono}`,
      telefono, estado: 'Consulta', origen: 'WhatsApp',
      observaciones: observaciones || '', cargadoPor: 'bot-whatsapp',
    };
    const cliente = await sheets.addCliente(data);
    if (sheets.registrarAuditoria) {
      sheets.registrarAuditoria({
        usuario: 'bot-whatsapp', accion: 'Creó', entidad: 'Evento',
        idEntidad: cliente.id, nombre: data.apellidoNombre, detalle: 'Lead entrante por WhatsApp',
      });
    }
    return cliente;
  } catch (e) { console.error('[bot] no se pudo crear lead:', e.message); return null; }
}

/* ─────────────────────── Lógica (testeable) ───────────────────────────────
   processMessage devuelve una lista de ACCIONES; el webhook (o el simulador)
   las renderiza. Acciones: {kind:'menu'} | {kind:'image',path,caption} |
   {kind:'buttons',body,buttons} | {kind:'text',body}. */

const T = () => config.textos;
function navBotones(ids) {
  const mapa = { agendar: T().btnAgendar, hablar: T().btnHablar, menu: T().btnMenu };
  return ids.map(id => ({ id, title: mapa[id] }));
}

function normalizar(t) {
  return (t || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
const SALUDOS = ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'buen dia', 'hi', 'ola'];

async function processMessage(telefono, input, deps) {
  const { sheets } = deps;
  const ahora = deps.ahora || new Date();
  const crearLead = deps.crearLead || crearLeadCRM;
  const st = deps.state || getState(telefono);

  // La intención viene del id del botón/lista, o del texto escrito.
  let intent = input.id || null;
  if (!intent) {
    const t = normalizar(input.text);
    if (t === 'menu' || SALUDOS.includes(t)) intent = 'menu';
  }

  // Categorías informativas.
  if (config.respuestas[intent]) {
    const r = config.respuestas[intent];
    const nav = { kind: 'buttons', body: T().navPregunta, buttons: navBotones(['agendar', 'hablar', 'menu']) };
    if (r.foto) return [{ kind: 'image', path: r.foto, caption: r.texto }, nav];
    // Sin foto: el texto va como cuerpo del mensaje de botones (una sola burbuja).
    return [{ kind: 'buttons', body: r.texto, buttons: navBotones(['agendar', 'hablar', 'menu']) }];
  }

  if (intent === 'agendar') {
    if (!st.leadCreado) { await crearLead(sheets, telefono, 'Pidió agendar visita por WhatsApp'); st.leadCreado = true; }
    const texto = config.agendar.texto.replace('{link}', config.linkAgendaVisita);
    const nav = { kind: 'buttons', body: T().navPregunta, buttons: navBotones(['hablar', 'menu']) };
    return config.agendar.foto
      ? [{ kind: 'image', path: config.agendar.foto, caption: texto }, nav]
      : [{ kind: 'buttons', body: texto, buttons: navBotones(['hablar', 'menu']) }];
  }

  if (intent === 'hablar') {
    if (!st.leadCreado) { await crearLead(sheets, telefono, 'Pidió hablar con una persona por WhatsApp'); st.leadCreado = true; }
    let body;
    if (estaEnHorarioDerivacion(ahora)) {
      body = config.derivacion.enHorario;
    } else {
      body = config.derivacion.fueraHorario
        .replace('{proximo}', proximoHorarioTexto(ahora))
        .replace('{instagram}', config.contacto.instagram)
        .replace('{mail}', config.contacto.mail);
    }
    return [{ kind: 'buttons', body, buttons: navBotones(['agendar', 'menu']) }];
  }

  if (intent === 'menu') return [{ kind: 'menu' }];

  // No se entendió: mostramos el menú directamente (menos fricción).
  return [{ kind: 'menu' }];
}

/* ─────────────────────── Renderizado real (a Meta) ────────────────────────── */
async function renderAccion(to, accion) {
  switch (accion.kind) {
    case 'menu':    return sendList(to);
    case 'image':   return sendImage(to, config.publicBaseUrl + accion.path, accion.caption);
    case 'buttons': return sendButtons(to, accion.body, accion.buttons);
    case 'text':    return sendText(to, accion.body);
  }
}

/* ─────────────────────── Webhook ──────────────────────────────────────────── */
function verificarFirma(req) {
  if (!APP_SECRET) return true;
  const firma = req.get('x-hub-signature-256');
  if (!firma || !req.rawBody) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(req.rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperado)); } catch { return false; }
}

const _vistos = new Set();
function yaVisto(id) {
  if (!id) return false;
  if (_vistos.has(id)) return true;
  _vistos.add(id);
  if (_vistos.size > 2000) _vistos.clear();
  return false;
}

// Extrae { id, text } de un mensaje entrante (texto o respuesta interactiva).
function leerMensaje(msg) {
  if (msg.type === 'interactive') {
    const i = msg.interactive;
    if (i?.list_reply) return { id: i.list_reply.id, text: i.list_reply.title };
    if (i?.button_reply) return { id: i.button_reply.id, text: i.button_reply.title };
  }
  return { id: null, text: msg.text?.body || '' };
}

function crearRouter(sheets) {
  const router = express.Router();

  router.get('/webhook/whatsapp', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
      console.log('[bot] webhook verificado por Meta');
      return res.status(200).send(req.query['hub.challenge']);
    }
    return res.sendStatus(403);
  });

  router.post('/webhook/whatsapp', async (req, res) => {
    if (!verificarFirma(req)) return res.sendStatus(401);
    res.sendStatus(200);
    try {
      const value = req.body?.entry?.[0]?.changes?.[0]?.value;
      const mensajes = value?.messages;
      if (!Array.isArray(mensajes)) return;
      for (const msg of mensajes) {
        if (yaVisto(msg.id)) continue;
        const from = msg.from;
        const st = getState(from);
        const input = leerMensaje(msg);
        const acciones = await processMessage(from, input, { sheets, state: st });
        for (const a of acciones) await renderAccion(from, a);
      }
      limpiarViejos();
    } catch (e) { console.error('[bot] error procesando webhook:', e.message); }
  });

  return router;
}

module.exports = {
  BOT_ACTIVO, crearRouter, sendText,
  // Para el simulador / tests:
  processMessage, estaEnHorarioDerivacion, proximoHorarioTexto, ahoraLocal, getState,
  _resetState: () => _conv.clear(),
};
