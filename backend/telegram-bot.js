/* =============================================================================
   BOT DE TELEGRAM  —  Carga de ingresos/egresos por audio o texto
   =============================================================================
   Cada padre le manda un audio (o texto) a SU chat de Telegram — p. ej.
   "pagué ochenta mil de bebidas para los Pérez" — y el bot:
     1) transcribe + interpreta el movimiento con IA (Gemini),
     2) crea un BORRADOR (confirmado:false) de ingreso o egreso, atribuido,
     3) el borrador cae en la bandeja "Por confirmar" del CRM, donde un admin
        lo revisa, corrige y confirma. El bot NUNCA confirma solo.

   Todo detrás de variables de entorno: si faltan, el módulo queda dormido y no
   toca nada. Ver docs/telegram-bot-setup.md.

   Variables de entorno:
     TELEGRAM_BOT_TOKEN       token del bot (lo da @BotFather)
     TELEGRAM_WEBHOOK_SECRET  (opcional) texto secreto para validar el webhook
     TELEGRAM_CHAT_MAP        "chatId:usuario,chatId:usuario"  (quién puede cargar)
     GEMINI_API_KEY           API key de Google AI Studio (capa gratuita)
     GEMINI_MODEL             (opcional) por defecto gemini-2.5-flash
   ========================================================================== */

const express = require('express');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// El bot está "activo" solo si puede hablar con Telegram y con la IA.
const BOT_ACTIVO = Boolean(TOKEN && GEMINI_API_KEY);

// Mapa chatId -> usuario del CRM. Solo estos chats pueden cargar (seguridad).
function parsearChatMap(raw) {
  const map = {};
  (raw || '').split(',').map(s => s.trim()).filter(Boolean).forEach(par => {
    const i = par.lastIndexOf(':');
    if (i > 0) map[par.slice(0, i).trim()] = par.slice(i + 1).trim();
  });
  return map;
}
const CHAT_MAP = parsearChatMap(process.env.TELEGRAM_CHAT_MAP);

const API = `https://api.telegram.org/bot${TOKEN}`;
const FILE_API = `https://api.telegram.org/file/bot${TOKEN}`;

/* ─────────────────────── Utilidades ───────────────────────── */

function hoyISO(d = new Date()) {
  // Fecha local del salón (America/Argentina/Buenos_Aires) en formato AAAA-MM-DD.
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return f.format(d);
}

function normalizar(t) {
  return (t || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Etiqueta linda de un evento (igual criterio que datosEvento en server.js).
function etiquetaEvento(cli) {
  const nombre = cli.apellidoNombre || '';
  const m = String(cli.fechaEvento || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const fechaLinda = m ? `${m[3]}/${m[2]}/${m[1]}` : (cli.fechaEvento || '');
  return [nombre, fechaLinda].filter(Boolean).join(' — ');
}

// Busca el cliente/evento mencionado por nombre. Devuelve el match o null.
function matchCliente(nombreBuscado, clientes) {
  const q = normalizar(nombreBuscado);
  if (!q || !Array.isArray(clientes)) return null;
  // Coincidencia por inclusión en ambos sentidos (apellido, nombre parcial, etc.).
  const cand = clientes.filter(c => {
    const n = normalizar(c.apellidoNombre);
    return n && (n.includes(q) || q.includes(n) || q.split(/\s+/).some(w => w.length > 2 && n.includes(w)));
  });
  if (!cand.length) return null;
  // Si hay varios, el del evento más próximo/futuro primero.
  cand.sort((a, b) => (b.fechaEvento || '').localeCompare(a.fechaEvento || ''));
  return cand[0];
}

/* ─────────────────── Interpretación con IA (Gemini) ─────────────────────
   input: { texto } o { audioBase64, mime }. Devuelve el objeto extraído o null.
   Aislado a propósito: el simulador puede pasar una función 'interpretar' falsa. */

const PROMPT_SISTEMA = `Sos un asistente que registra movimientos de dinero de un salón de eventos en Argentina.
Te llega un mensaje (texto o audio) de un empleado describiendo un COBRO (entró plata) o un GASTO (salió plata).
Devolvé SOLO un JSON válido, sin explicaciones ni markdown, con esta forma exacta:
{
  "tipo": "ingreso" | "egreso",
  "monto": number,               // solo el número, sin puntos ni símbolos
  "moneda": "ARS" | "USD",       // "USD" si menciona dólares/verdes; si no, "ARS"
  "formaPago": "Efectivo" | "Transferencia" | "Cheque" | "Mercado Pago",
  "tipoIngreso": "Seña" | "Saldo final" | "Otro",   // solo si tipo=ingreso
  "categoria": "Servicios" | "Bebidas" | "Personal" | "Evento" | "Mantenimiento",  // solo si tipo=egreso
  "concepto": string,            // descripción corta, ej "Compra de bebidas"
  "cliente": string | null,      // nombre del cliente/evento si lo menciona, si no null
  "resumen": string              // frase corta para confirmar, ej "Gasto de $80.000 en bebidas"
}
Reglas: si dice "sueldo/mozo/cocinero" -> categoria "Personal". "luz/gas/agua" -> "Servicios".
Si no estás seguro del monto, poné 0. No inventes cliente si no lo nombran.`;

async function interpretarConGemini(input, { fetchImpl = fetch } = {}) {
  if (!GEMINI_API_KEY) throw new Error('Falta GEMINI_API_KEY');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const parts = [{ text: PROMPT_SISTEMA }];
  if (input.audioBase64) {
    parts.push({ inline_data: { mime_type: input.mime || 'audio/ogg', data: input.audioBase64 } });
    parts.push({ text: 'Transcribí el audio y devolvé el JSON del movimiento.' });
  } else {
    parts.push({ text: `Mensaje: "${input.texto || ''}"` });
  }
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const err = new Error(`Gemini ${res.status}: ${t.slice(0, 200)}`);
    // 429 / RESOURCE_EXHAUSTED = nos quedamos sin cupo de IA (rate limit o cuota diaria).
    if (res.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(t)) err.sinCupo = true;
    throw err;
  }
  const data = await res.json();
  const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parsearJSON(txt);
}

// Extrae el JSON aunque venga con ```json ... ``` u otra decoración.
function parsearJSON(txt) {
  if (!txt) return null;
  let s = String(txt).trim().replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a === -1 || b === -1) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

/* ─────────────────── Crear el borrador (testeable, sin red) ───────────────── */

async function crearBorrador(sheets, ext, usuario, clientes) {
  if (!ext || !(parseFloat(ext.monto) > 0)) {
    return { ok: false, motivo: 'sin_monto' };
  }
  const match = ext.cliente ? matchCliente(ext.cliente, clientes) : null;
  const fecha = hoyISO();
  const moneda = ext.moneda === 'USD' ? 'USD' : 'ARS';
  const monto = parseFloat(ext.monto);

  if (ext.tipo === 'ingreso') {
    const ing = await sheets.addIngreso({
      tipoIngreso: ext.tipoIngreso || 'Otro',
      monto, moneda, fecha,
      formaPago: ext.formaPago || 'Efectivo',
      idCliente: match ? match.id : '',
      cliente: match ? match.apellidoNombre : '',
      fechaEvento: match ? (match.fechaEvento || '') : '',
      notas: ext.concepto || '',
      cargadoPor: usuario,
      confirmado: false,
    });
    return { ok: true, tipo: 'ingreso', registro: ing, match };
  }

  // egreso
  const egr = await sheets.addEgreso({
    fecha,
    concepto: ext.concepto || 'Gasto',
    categoria: ext.categoria || 'Servicios',
    monto, moneda,
    idEvento: match ? match.id : '',
    evento: match ? etiquetaEvento(match) : '',
    cargadoPor: usuario,
    confirmado: false,
  });
  return { ok: true, tipo: 'egreso', registro: egr, match };
}

// Texto de confirmación que se le manda al que cargó.
function textoConfirmacion(borr) {
  if (!borr.ok) return 'No entendí bien el monto 🤔. Probá de nuevo diciendo el número y qué es (ej: "gasté 80 mil en bebidas").';
  const r = borr.registro;
  const tag = borr.tipo === 'ingreso' ? 'COBRO' : 'GASTO';
  const atrib = borr.match ? `\nAtribuido a: ${borr.match.apellidoNombre}` : '\n(sin cliente asociado)';
  return `✅ Anoté un ${tag}: $${Number(r.monto).toLocaleString('es-AR')} ${r.moneda}${atrib}\n\n` +
         `Quedó en *Por confirmar* en el CRM para revisar y confirmar. No se cargó definitivo todavía.`;
}

/* ─────────────────────── Telegram API ───────────────────────── */

async function sendText(chatId, text, { fetchImpl = fetch } = {}) {
  if (!BOT_ACTIVO) return;
  await fetchImpl(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  }).catch(e => console.error('[telegram] sendText:', e.message));
}

// Descarga un archivo de voz de Telegram y lo devuelve en base64.
async function descargarVoz(fileId, { fetchImpl = fetch } = {}) {
  const info = await fetchImpl(`${API}/getFile?file_id=${fileId}`).then(r => r.json());
  const filePath = info?.result?.file_path;
  if (!filePath) throw new Error('no se pudo obtener el archivo de voz');
  const buf = await fetchImpl(`${FILE_API}/${filePath}`).then(r => r.arrayBuffer());
  return Buffer.from(buf).toString('base64');
}

/* ─────────────────── Orquestador de un update (testeable) ────────────────── */

async function processUpdate(update, deps) {
  const { sheets } = deps;
  const interpretar = deps.interpretar || interpretarConGemini;
  const enviar = deps.sendText || sendText;
  const bajarVoz = deps.descargarVoz || descargarVoz;
  const chatMap = deps.chatMap || CHAT_MAP;

  const msg = update?.message || update?.edited_message;
  if (!msg) return { ignorado: 'sin_mensaje' };

  const chatId = String(msg.chat?.id ?? '');
  const usuario = chatMap[chatId];
  if (!usuario) {
    // Chat no autorizado: no cargamos nada. Avisamos una vez.
    await enviar(chatId, 'Este chat no está habilitado para cargar movimientos. Pedile al admin que te dé de alta.');
    return { ignorado: 'chat_no_autorizado' };
  }

  let input = null;
  if (msg.voice || msg.audio) {
    const fileId = (msg.voice || msg.audio).file_id;
    const audioBase64 = await bajarVoz(fileId);
    input = { audioBase64, mime: (msg.voice || msg.audio).mime_type || 'audio/ogg' };
  } else if (msg.text) {
    input = { texto: msg.text };
  } else {
    await enviar(chatId, 'Mandame un *audio* o un texto contando el cobro o gasto 🙂');
    return { ignorado: 'sin_contenido' };
  }

  let ext;
  try {
    ext = await interpretar(input, deps);
  } catch (e) {
    console.error('[telegram] interpretar:', e.message);
    const msg = e.sinCupo
      ? '⚠️ Por ahora me quedé *sin cupo de IA* para interpretar mensajes.\n\n' +
        'Podés *cargar el movimiento a mano* en el CRM, o esperar un rato y reenviarlo ' +
        '(el cupo gratuito se renueva solo).'
      : 'Tuve un problema para entender el mensaje 😔. Probá de nuevo en un ratito.';
    await enviar(chatId, msg);
    return { error: e.message, sinCupo: !!e.sinCupo };
  }

  const clientes = await sheets.getClientes().catch(() => []);
  const borr = await crearBorrador(sheets, ext, usuario, clientes);
  await enviar(chatId, textoConfirmacion(borr));
  return borr;
}

/* ─────────────────────── Router de Express (webhook) ───────────────────────── */

// Anti-duplicados: Telegram reintenta. Recordamos los update_id ya procesados.
const _vistos = new Set();
function yaVisto(id) {
  if (id == null) return false;
  if (_vistos.has(id)) return true;
  _vistos.add(id);
  if (_vistos.size > 2000) _vistos.clear();
  return false;
}

function crearRouter(sheets) {
  const router = express.Router();

  router.post('/webhook/telegram', async (req, res) => {
    // Validación del secreto (si está configurado).
    if (WEBHOOK_SECRET && req.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) {
      return res.sendStatus(401);
    }
    res.sendStatus(200); // respondemos rápido; procesamos después
    try {
      const update = req.body;
      if (yaVisto(update?.update_id)) return;
      await processUpdate(update, { sheets });
    } catch (e) {
      console.error('[telegram] error procesando update:', e.message);
    }
  });

  return router;
}

module.exports = {
  BOT_ACTIVO,
  crearRouter,
  // Exportados para el simulador / tests:
  processUpdate,
  crearBorrador,
  matchCliente,
  parsearJSON,
  textoConfirmacion,
  interpretarConGemini,
  _chatMap: CHAT_MAP,
};
