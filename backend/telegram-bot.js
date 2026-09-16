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
     GEMINI_MODEL             (opcional) por defecto gemini-flash-latest
   ========================================================================== */

const express = require('express');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// 'gemini-flash-latest' apunta siempre al Flash vigente: evita el 404 cuando Google
// retira un modelo pinneado (ej. gemini-2.5-flash quedó sin acceso para keys nuevas).
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
// Tope de espera por intento a Gemini (ms). Si tarda más, se corta y reintenta.
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 45000;

// El bot está "activo" solo si puede hablar con Telegram y con la IA, Y si tiene
// el secreto del webhook. Sin secreto, /api/webhook/telegram queda abierto:
// cualquiera que conozca la URL puede postear updates falsos y meter borradores
// en la contabilidad. Antes era opcional; ahora, sin secreto el bot no arranca
// y la ruta ni siquiera se monta (falla cerrado, no abierto).
const BOT_CONFIGURADO = Boolean(TOKEN && GEMINI_API_KEY);
const BOT_ACTIVO = Boolean(BOT_CONFIGURADO && WEBHOOK_SECRET);

if (BOT_CONFIGURADO && !WEBHOOK_SECRET) {
  console.error('');
  console.error('❌ BOT DE TELEGRAM DESACTIVADO — falta TELEGRAM_WEBHOOK_SECRET');
  console.error('   El token y la API key están, pero sin secreto el webhook quedaría');
  console.error('   abierto a cualquiera. Para reactivarlo:');
  console.error('   1) Definí TELEGRAM_WEBHOOK_SECRET (inventá un texto largo).');
  console.error('   2) Re-registrá el webhook en Telegram con ese mismo secreto:');
  console.error('      https://api.telegram.org/bot<TOKEN>/setWebhook' +
                '?url=https://salon-eventos.onrender.com/api/webhook/telegram&secret_token=<SECRETO>');
  console.error('');
}

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

// Busca el cliente/evento mencionado por nombre. Matchea tanto por el cliente
// que contrató (apellidoNombre) como por el AGASAJADO/festejado (nombreAgasajado),
// porque el padre puede nombrar a cualquiera de los dos ("el cumple de Sofía").
function matchCliente(nombreBuscado, clientes) {
  const q = normalizar(nombreBuscado);
  if (!q || !Array.isArray(clientes)) return null;
  // Coincidencia por inclusión en ambos sentidos (apellido, nombre parcial, etc.).
  const coincide = campo => campo && (campo.includes(q) || q.includes(campo) ||
    q.split(/\s+/).some(w => w.length > 2 && campo.includes(w)));
  const cand = clientes.filter(c =>
    coincide(normalizar(c.apellidoNombre)) || coincide(normalizar(c.nombreAgasajado)));
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
  "tipo": "ingreso" | "egreso" | null,   // null SOLO si de verdad no se puede saber si entró o salió plata (te lo van a aclarar). No adivines a la fuerza.
  "monto": number,               // solo el número, sin puntos ni símbolos
  "moneda": "ARS" | "USD",       // "USD" si menciona dólares/verdes; si no, "ARS"
  "formaPago": "Efectivo" | "Transferencia" | "Cheque" | "Mercado Pago",
  "tipoIngreso": "Seña" | "Saldo final" | "Otro",   // solo si tipo=ingreso
  "categoria": "Servicios" | "Bebidas" | "Personal" | "Evento" | "Mantenimiento",  // solo si tipo=egreso
  "nombreEmpleado": string | null,  // solo si es pago a una persona: su nombre. Si no, null
  "rolPago": string | null,         // rol/puesto de esa persona, ej "Mozo", "Ayudante de cocina", "Cocinero". Si no aplica, null
  "concepto": string,            // EN CONCEPTO DE QUÉ es el movimiento, en pocas palabras. Para ingresos: "Seña", "Cuota", "Cubiertos", "Mesa dulce", "Cotillón", "Barra de luces", "Adicional", etc. Para gastos: ej "Compra de bebidas"
  "cliente": string | null,      // nombre del CLIENTE que contrató O del AGASAJADO/festejado (ej "cumple de Sofía" -> "Sofía") si lo menciona; si no, null
  "resumen": string              // frase corta para confirmar, ej "Gasto de $80.000 en bebidas"
}
Reglas gastos: si dice "sueldo/mozo/cocinero/ayudante/le pagué a <nombre>" -> categoria "Personal", y completá "nombreEmpleado" con la persona y "rolPago" con su puesto si lo dice. "luz/gas/agua" -> "Servicios". Para gastos que NO son a una persona (bebidas, luz, etc.) dejá nombreEmpleado y rolPago en null.
Reglas ingresos: "tipoIngreso" SOLO puede ser "Seña", "Saldo final" u "Otro". Si es una seña -> "Seña"; si es el pago final/saldo -> "Saldo final"; TODO lo demás (cuota, cubiertos, mesa dulce, cotillón, barra de luces, adicional, lo que sea) -> "Otro", y poné el detalle exacto en "concepto". Nunca inventes un tipoIngreso fuera de esos tres.
Si no estás seguro del monto, poné 0. No inventes cliente si no lo nombran.`;

async function interpretarConGemini(input, { fetchImpl = fetch } = {}) {
  if (!GEMINI_API_KEY) throw new Error('Falta GEMINI_API_KEY');
  const parts = [{ text: PROMPT_SISTEMA }];
  if (input.audioBase64) {
    parts.push({ inline_data: { mime_type: input.mime || 'audio/ogg', data: input.audioBase64 } });
    parts.push({ text: 'Transcribí el audio y devolvé el JSON del movimiento.' });
  } else if (input.imageBase64) {
    parts.push({ inline_data: { mime_type: input.mime || 'image/jpeg', data: input.imageBase64 } });
    parts.push({ text: 'Es la foto de una factura/comprobante. Leé el TOTAL y el concepto y devolvé el JSON del movimiento (tipo egreso salvo que sea claramente un cobro).' });
  } else {
    parts.push({ text: `Mensaje: "${input.texto || ''}"` });
  }
  const cuerpo = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  });

  // Resiliencia: si el modelo está saturado (503) reintentamos, y si insiste
  // probamos un modelo alternativo (flash-lite). Cupo agotado (429) no se reintenta.
  const modelos = [...new Set([GEMINI_MODEL, process.env.GEMINI_MODEL_FALLBACK || 'gemini-flash-lite-latest'])];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let ultimoErr;
  for (const modelo of modelos) {
    for (let intento = 0; intento < 2; intento++) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`;
      let res;
      // Tope de tiempo por intento: si Gemini está lento (saturado), no esperamos
      // eternamente — cortamos y reintentamos/cambiamos de modelo. Evita el "colgado".
      const ac = new AbortController();
      const corte = setTimeout(() => ac.abort(), GEMINI_TIMEOUT_MS);
      try {
        res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cuerpo, signal: ac.signal });
      } catch (e) {
        // AbortError = se pasó del tiempo → lo tratamos como "saturado" y reintentamos.
        if (e.name === 'AbortError') { const err = new Error('Gemini timeout'); err.sobrecargado = true; ultimoErr = err; continue; }
        ultimoErr = e; break;                          // error de red real: pasar al siguiente modelo
      } finally { clearTimeout(corte); }
      if (res.ok) {
        const data = await res.json();
        const txt = (data?.candidates?.[0]?.content?.parts || [])
          .filter(p => !p.thought).map(p => p.text).filter(Boolean).join('');
        return parsearJSON(txt);
      }
      const t = await res.text().catch(() => '');
      const err = new Error(`Gemini ${res.status}: ${t.slice(0, 200)}`);
      if (res.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(t)) err.sinCupo = true;
      if (res.status === 503 || /UNAVAILABLE|high demand|overloaded/i.test(t)) err.sobrecargado = true;
      ultimoErr = err;
      if (err.sinCupo) throw err;                            // cupo agotado: reintentar no sirve
      if (err.sobrecargado) { await sleep(1200); continue; } // saturado: reintentar mismo modelo
      break;                                                 // otro error: pasar al siguiente modelo
    }
  }
  throw ultimoErr;
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
    nombreEmpleado: ext.nombreEmpleado || '',
    rolPago: ext.rolPago || '',
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

async function sendText(chatId, text, { fetchImpl = fetch, reply_markup } = {}) {
  if (!BOT_ACTIVO) return;
  const body = { chat_id: chatId, text, parse_mode: 'Markdown' };
  if (reply_markup) body.reply_markup = reply_markup;
  await fetchImpl(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(e => console.error('[telegram] sendText:', e.message));
}

// Botones inline Sí / No para la confirmación.
const TECLADO_SINO = {
  inline_keyboard: [[
    { text: '✅ Sí, cargar', callback_data: 'conf_si' },
    { text: '❌ No', callback_data: 'conf_no' },
  ]],
};

// Corta el "relojito" del botón después de tocarlo.
async function answerCallback(cqId, { fetchImpl = fetch } = {}) {
  if (!BOT_ACTIVO) return;
  await fetchImpl(`${API}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: cqId }),
  }).catch(e => console.error('[telegram] answerCallback:', e.message));
}

// Descarga un archivo de voz de Telegram y lo devuelve en base64.
async function descargarVoz(fileId, { fetchImpl = fetch } = {}) {
  const info = await fetchImpl(`${API}/getFile?file_id=${fileId}`).then(r => r.json());
  const filePath = info?.result?.file_path;
  if (!filePath) throw new Error('no se pudo obtener el archivo de voz');
  const buf = await fetchImpl(`${FILE_API}/${filePath}`).then(r => r.arrayBuffer());
  return Buffer.from(buf).toString('base64');
}

/* ─────────────────── Confirmación por Telegram (estado en memoria) ──────────
   El bot NO carga nada hasta que el usuario responde "sí". Así, si no confirma
   (o dice otra cosa), no se manda nada al sistema. Estado con vencimiento; si
   Render reinicia, se pierde el pendiente y se vuelve a mandar el movimiento. */
// Cuánto vive un borrador sin confirmar. Largo a propósito: los dueños mandan el
// audio, salen del chat (tarda, cold start), y vuelven horas o al otro día a
// confirmar/descartar — no queremos que para entonces "ya no haya nada". Como el
// borrador es durable (Config), sobrevive reinicios; esto solo evita ghosts eternos.
const CONFIRM_TTL_MS = (Number(process.env.BOT_PEND_TTL_DIAS) || 7) * 24 * 60 * 60 * 1000;
const _pend = new Map();                  // caché en memoria: chatId -> { ext, ts }
const claveConfig = chatId => 'botpend_' + chatId;

// El pendiente se GUARDA de forma durable en la hoja Config (clave-valor), no solo
// en RAM. Así sobrevive a reinicios/redeploys y al dormido de Render: si tus padres
// tardan en tocar "Sí", el pendiente sigue ahí. El Map es solo una caché rápida.
async function getPend(sheets, chatId) {
  let e = _pend.get(chatId);
  if (!e && sheets && sheets.getConfig) {
    try {
      const raw = (await sheets.getConfig())[claveConfig(chatId)];
      if (raw) e = JSON.parse(raw);
    } catch { /* Config inaccesible: seguimos con lo que haya en caché */ }
  }
  if (e && Date.now() - e.ts < CONFIRM_TTL_MS) { _pend.set(chatId, e); return e; }
  await clearPend(sheets, chatId);
  return null;
}
async function setPend(sheets, chatId, ext, faltante = '') {
  const e = { ext, ts: Date.now(), faltante };
  _pend.set(chatId, e);
  if (sheets && sheets.setConfig) {
    try { await sheets.setConfig(claveConfig(chatId), JSON.stringify(e)); } catch { /* queda al menos en caché */ }
  }
}
async function clearPend(sheets, chatId) {
  _pend.delete(chatId);
  if (sheets && sheets.setConfig) {
    try { await sheets.setConfig(claveConfig(chatId), ''); } catch { /* nada que hacer */ }
  }
}

const PALABRAS_SI = new Set(['si', 'sii', 'sisi', 'dale', 'ok', 'oka', 'okey', 'confirmo', 'confirmar', 'cargalo', 'carga', 'cargá', 'va', 'listo', 'correcto', 'bien', 'perfecto']);
const PALABRAS_NO = new Set(['no', 'nop', 'cancelar', 'cancela', 'borra', 'borralo', 'dejalo', 'anula', 'anular', 'mal']);
const PALABRAS_COBRO = new Set(['cobro', 'ingreso', 'entro', 'entró', 'cobre', 'cobré', 'me pagaron', 'pagaron']);
const PALABRAS_GASTO = new Set(['gasto', 'egreso', 'salio', 'salió', 'pague', 'pagué', 'compra', 'compre', 'compré']);

// Botones para aclarar cobro vs gasto cuando la IA no lo pudo determinar sola.
const TECLADO_TIPO = {
  inline_keyboard: [[
    { text: '🟢 Cobro (entró)', callback_data: 'aclara:tipo:ingreso' },
    { text: '🔴 Gasto (salió)', callback_data: 'aclara:tipo:egreso' },
  ]],
};

// Preguntas de aclaración: qué falta → texto + teclado. Se resuelven con un TOQUE,
// sin volver a llamar a la IA (no gasta tokens de más).
const PREGUNTAS = {
  tipo: { texto: '🤔 Una sola cosa: ¿esto fue un *cobro* (entró plata) o un *gasto* (salió plata)?', teclado: TECLADO_TIPO },
};

// Primer dato que falta aclarar para poder registrar bien (o null si está todo).
function primerFaltante(ext) {
  if (ext.tipo !== 'ingreso' && ext.tipo !== 'egreso') return 'tipo';
  return null;
}

// Pregunta de confirmación con el resumen de lo entendido.
function textoPreguntaConfirmar(ext, match) {
  const esIngreso = ext.tipo === 'ingreso';
  const tag = esIngreso ? 'COBRO' : 'GASTO';
  const clase = esIngreso ? (ext.tipoIngreso || 'Otro') : (ext.categoria || 'General');
  // Si matcheó por el agasajado (o el nombre dicho no es el del cliente), lo mostramos
  // entre paréntesis para que se vea a qué evento fue.
  const agas = match && match.nombreAgasajado ? ` (agasajado: ${match.nombreAgasajado})` : '';
  const atrib = match
    ? `\n• Cliente/evento: ${match.apellidoNombre}${agas}`
    : '\n• ⚠️ Sin cliente reconocido — asignalo en el sistema al confirmar';
  const persona = ext.nombreEmpleado
    ? `\n• Empleado: ${ext.nombreEmpleado}${ext.rolPago ? ' (' + ext.rolPago + ')' : ''}` : '';
  return `🧾 Entendí un *${tag}*:\n` +
         `• Monto: $${Number(ext.monto).toLocaleString('es-AR')} ${ext.moneda === 'USD' ? 'USD' : 'ARS'}\n` +
         `• ${clase}${ext.concepto ? ' — ' + ext.concepto : ''}${persona}${atrib}\n\n` +
         `¿Lo cargo? Tocá un botón 👇 (o respondé *sí* / *no*).`;
}

// Confirmación final después de cargar el borrador.
function textoCargado(borr) {
  if (!borr.ok) return 'No pude cargarlo 🤔. Probá de nuevo.';
  const r = borr.registro;
  const tag = borr.tipo === 'ingreso' ? 'COBRO' : 'GASTO';
  return `✅ Cargado: ${tag} de $${Number(r.monto).toLocaleString('es-AR')} ${r.moneda}.\n` +
         `Quedó en *Por confirmar* del CRM para la confirmación final del admin.`;
}

// Carga el pendiente (usado por el botón "Sí" y por el "sí" tipeado).
async function confirmarYCargar(sheets, chatId, usuario, enviar) {
  const pend = await getPend(sheets, chatId);
  if (!pend) {
    await enviar(chatId, 'No hay nada pendiente para confirmar. Mandá el movimiento de nuevo 🙂');
    return { sin_pendiente: true };
  }
  const clientes = await sheets.getClientes().catch(() => []);

  // Si la escritura falla, el usuario tocó "Sí" y se queda esperando: sin este
  // aviso creía que había quedado cargado. NO se borra el pendiente, así puede
  // reintentar con un "sí" sin volver a dictar todo.
  let borr;
  try {
    borr = await crearBorrador(sheets, pend.ext, usuario, clientes);
  } catch (e) {
    console.error('[telegram] crearBorrador:', e.message);
    await enviar(chatId,
      '⚠️ *No pude guardarlo* — hubo un problema con la planilla.\n\n' +
      'No se cargó nada. Respondé *sí* para reintentar (me acuerdo del movimiento), ' +
      'o cargalo a mano en el CRM.');
    return { ok: false, error: e.message };
  }

  await clearPend(sheets, chatId);
  await enviar(chatId, textoCargado(borr));
  return borr;
}
async function cancelarPendiente(sheets, chatId, enviar) {
  await clearPend(sheets, chatId);
  await enviar(chatId, 'Ok, lo descarté 👍 No cargué nada.');
  return { cancelado: true };
}

// Con el ext (parcial o completo): si falta aclarar algo, lo pregunta con botones;
// si está completo, muestra el resumen y pide la confirmación final (Sí/No).
async function continuarConAclaraciones(sheets, chatId, enviar, ext) {
  const falta = primerFaltante(ext);
  if (falta) {
    await setPend(sheets, chatId, ext, falta);
    await enviar(chatId, PREGUNTAS[falta].texto, { reply_markup: PREGUNTAS[falta].teclado });
    return { aclarando: falta };
  }
  const clientes = await sheets.getClientes().catch(() => []);
  const match = ext.cliente ? matchCliente(ext.cliente, clientes) : null;
  await setPend(sheets, chatId, ext);
  await enviar(chatId, textoPreguntaConfirmar(ext, match), { reply_markup: TECLADO_SINO });
  return { pendiente: ext };
}

// Aplica la respuesta de un botón de aclaración (callback "aclara:campo:valor").
async function responderAclaracion(data, sheets, chatId, enviar) {
  const pend = await getPend(sheets, chatId);
  if (!pend) { await enviar(chatId, 'No hay nada pendiente. Reenviá el movimiento 🙂'); return { sin_pendiente: true }; }
  const [, campo, valor] = data.split(':');
  const ext = { ...pend.ext };
  if (campo === 'tipo') ext.tipo = valor;
  return continuarConAclaraciones(sheets, chatId, enviar, ext);
}

// De dónde sacar el chat para avisar, venga el update como mensaje o como botón.
function chatIdDe(update) {
  const c = update?.message?.chat?.id
         ?? update?.edited_message?.chat?.id
         ?? update?.callback_query?.message?.chat?.id;
  return c == null ? '' : String(c);
}

/* ─────────────────── Orquestador de un update (testeable) ────────────────── */

async function processUpdate(update, deps) {
  const { sheets } = deps;
  const interpretar = deps.interpretar || interpretarConGemini;
  const enviar = deps.sendText || sendText;
  const bajarVoz = deps.descargarVoz || descargarVoz;
  const responder = deps.answerCallback || answerCallback;
  const chatMap = deps.chatMap || CHAT_MAP;

  // ── Toque de botón (Sí / No) ──
  const cq = update?.callback_query;
  if (cq) {
    const chatId = String(cq.message?.chat?.id ?? '');
    await responder(cq.id);                       // corta el relojito del botón
    const usuario = chatMap[chatId];
    if (!usuario) return { ignorado: 'chat_no_autorizado' };
    if (cq.data === 'conf_si') return confirmarYCargar(sheets, chatId, usuario, enviar);
    if (cq.data === 'conf_no') return cancelarPendiente(sheets, chatId, enviar);
    if (cq.data && cq.data.startsWith('aclara:')) return responderAclaracion(cq.data, sheets, chatId, enviar);
    return { ignorado: 'callback_desconocido' };
  }

  const msg = update?.message || update?.edited_message;
  if (!msg) return { ignorado: 'sin_mensaje' };

  const chatId = String(msg.chat?.id ?? '');
  const usuario = chatMap[chatId];
  if (!usuario) {
    // Chat no autorizado: no cargamos nada. Le devolvemos SU número de chat para
    // que se lo pase al admin y lo dé de alta (evita el baile de getUpdates/webhook).
    await enviar(chatId,
      '👋 ¡Hola! Este chat todavía *no está habilitado* para cargar movimientos.\n\n' +
      'Pasale este número al administrador para que te dé de alta:\n\n' +
      '🔑 *' + chatId + '*\n\n' +
      'Apenas te habilite, vas a poder cargar cobros y gastos por acá.');
    return { ignorado: 'chat_no_autorizado', chatId };
  }

  // ── ¿Hay algo esperando confirmación en este chat? ──
  const pend = await getPend(sheets, chatId);
  const textoPlano = msg.text ? normalizar(msg.text) : '';
  if (pend) {
    // Si estábamos esperando que aclare cobro/gasto, aceptamos también la palabra tipeada.
    if (pend.faltante === 'tipo' && textoPlano) {
      if (PALABRAS_COBRO.has(textoPlano)) return continuarConAclaraciones(sheets, chatId, enviar, { ...pend.ext, tipo: 'ingreso' });
      if (PALABRAS_GASTO.has(textoPlano)) return continuarConAclaraciones(sheets, chatId, enviar, { ...pend.ext, tipo: 'egreso' });
    }
    if (textoPlano && PALABRAS_SI.has(textoPlano)) return confirmarYCargar(sheets, chatId, usuario, enviar);
    if (textoPlano && PALABRAS_NO.has(textoPlano)) return cancelarPendiente(sheets, chatId, enviar);
    // Cualquier otra cosa: se descarta el pendiente y se interpreta el mensaje nuevo.
    await clearPend(sheets, chatId);
  }

  let input = null;
  if (msg.voice || msg.audio) {
    const fileId = (msg.voice || msg.audio).file_id;
    const audioBase64 = await bajarVoz(fileId);
    input = { audioBase64, mime: (msg.voice || msg.audio).mime_type || 'audio/ogg' };
  } else if (Array.isArray(msg.photo) && msg.photo.length) {
    // Telegram manda varios tamaños; el último es el más grande.
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const imageBase64 = await bajarVoz(fileId);
    input = { imageBase64, mime: 'image/jpeg' };
  } else if (msg.text) {
    input = { texto: msg.text };
  } else {
    await enviar(chatId, 'Mandame un *audio*, un *texto* o la *foto de una factura* con el cobro o gasto 🙂');
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
      : e.sobrecargado
      ? '⏳ La IA está *saturada* en este momento (mucha demanda). Reenviá el mensaje en un minuto, ' +
        'o cargalo a mano en el CRM. Suele durar poco.'
      : 'Tuve un problema para entender el mensaje 😔. Probá de nuevo en un ratito.';
    await enviar(chatId, msg);
    return { error: e.message, sinCupo: !!e.sinCupo };
  }

  // Si no se entendió un monto usable, no guardamos nada y pedimos repetir.
  if (!ext || !(parseFloat(ext.monto) > 0)) {
    await enviar(chatId, 'No entendí bien el monto 🤔. Probá de nuevo diciendo el número y qué es (ej: "gasté 80 mil en bebidas").');
    return { ok: false, motivo: 'sin_monto' };
  }

  // Se entendió el monto. Si falta aclarar algo (ej. cobro/gasto), lo pregunta con
  // botones; si no, pide la confirmación final. Nada se carga hasta el "Sí".
  return continuarConAclaraciones(sheets, chatId, enviar, ext);
}

/* ─────────────────────── Router de Express (webhook) ───────────────────────── */

/* Anti-duplicados: Telegram reintenta los updates que no recibieron un 200.
   Antes la memoria de lo ya procesado era solo un Set en RAM, y Render duerme
   el servicio todo el tiempo: la secuencia "llega el update → el server tarda
   en despertar → Telegram reintenta → el server ya reinició y perdió el Set"
   cargaba el movimiento DOS VECES. Ahora la lista vive también en la hoja
   Config, así sobrevive a reinicios y redeploys.

   Se marca como visto ANTES de procesar: si algo falla, preferimos perder el
   reintento (el usuario recibe el aviso de error) antes que cargar dos veces
   el mismo cobro. */
const VISTOS_MAX = 100;               // alcanza de sobra para la ventana de reintentos
const CLAVE_VISTOS = 'bot_updates_vistos';
const _vistos = new Set();
let _vistosHidratados = false;

async function yaVisto(id, sheets) {
  if (id == null) return false;

  if (!_vistosHidratados && sheets && sheets.getConfig) {
    try {
      const raw = (await sheets.getConfig())[CLAVE_VISTOS];
      if (raw) JSON.parse(raw).forEach(x => _vistos.add(x));
    } catch { /* Config inaccesible: seguimos solo con la memoria */ }
    _vistosHidratados = true;
  }

  if (_vistos.has(id)) return true;
  _vistos.add(id);

  // El Set conserva el orden de inserción: nos quedamos con los más recientes.
  if (_vistos.size > VISTOS_MAX) {
    const recientes = [..._vistos].slice(-VISTOS_MAX);
    _vistos.clear();
    recientes.forEach(x => _vistos.add(x));
  }
  if (sheets && sheets.setConfig) {
    try { await sheets.setConfig(CLAVE_VISTOS, JSON.stringify([..._vistos])); }
    catch { /* al menos queda en memoria */ }
  }
  return false;
}

function crearRouter(sheets) {
  const router = express.Router();

  router.post('/webhook/telegram', async (req, res) => {
    // El secreto ya no es opcional: sin él el router ni se monta (ver BOT_ACTIVO).
    if (req.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) {
      return res.sendStatus(401);
    }
    res.sendStatus(200); // respondemos rápido; procesamos después
    const update = req.body;
    try {
      if (await yaVisto(update?.update_id, sheets)) return;
      await processUpdate(update, { sheets });
    } catch (e) {
      // Red de seguridad: cualquier error no contemplado más adentro. Sin esto
      // el usuario mandaba su audio y no recibía absolutamente nada.
      console.error('[telegram] error procesando update:', e.message);
      const chatId = chatIdDe(update);
      if (chatId) {
        await sendText(chatId,
          '⚠️ Tuve un problema y *no pude procesar el mensaje*. No se cargó nada.\n\n' +
          'Reenvialo en un minuto, o cargalo a mano en el CRM.')
          .catch(() => { /* si tampoco podemos avisar, ya quedó en el log */ });
      }
    }
  });

  return router;
}

module.exports = {
  BOT_ACTIVO,
  BOT_CONFIGURADO,
  crearRouter,
  // Exportados para el simulador / tests:
  processUpdate,
  crearBorrador,
  matchCliente,
  parsearJSON,
  chatIdDe,
  textoConfirmacion,
  interpretarConGemini,
  _chatMap: CHAT_MAP,
  // Solo para tests: simula un reinicio del server vaciando la caché en memoria.
  _vaciarCacheParaTest: () => _pend.clear(),
  yaVisto,
  _vaciarVistosParaTest: () => { _vistos.clear(); _vistosHidratados = false; },
};
