require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const sheets = require('./sheets');

const app = express();

// ── Cabeceras de seguridad básicas (sin dependencias externas) ──
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

// ── CORS restringido a orígenes conocidos ──
// La app del CRM se sirve desde el mismo origen que la API (mismo Express), así que
// sus pedidos son same-origin y NO se ven afectados. Esto solo bloquea a sitios de
// terceros que quieran llamar a la API desde otro dominio.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://salon-eventos.onrender.com,https://fpjoliet-commits.github.io')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    // Sin origin = same-origin o llamada server-to-server (ej. webhook de Cal.com) → permitir
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    // Origen no permitido: NO mandamos cabeceras CORS (cb(null,false)) en vez de tirar error.
    // Así el navegador bloquea a terceros cross-origin, pero los pedidos same-origin
    // (la propia app, incluido localhost en desarrollo) siguen funcionando.
    cb(null, false);
  },
}));

// Guardamos el cuerpo crudo (rawBody) para poder verificar la firma del webhook
// de WhatsApp. No afecta al resto de la app.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.static(path.join(process.cwd(), 'frontend')));

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ FALTA JWT_SECRET — sin este secreto no se pueden firmar tokens de forma segura.');
  console.error('   Definí JWT_SECRET en las variables de entorno antes de iniciar el servidor.');
  process.exit(1);
}
const PORT = process.env.PORT || 3001;

// Las variables de entorno guardan el HASH bcrypt de cada contraseña, no la
// contraseña en texto plano. Para generar un hash: node backend/hash-password.js "miContraseña"
const USERS = {
  superadmin: { passwordHash: process.env.PASSWORD_SUPERADMIN, role: 'superadmin' },
  admin: { passwordHash: process.env.PASSWORD_ADMIN, role: 'admin' },
  empleado: { passwordHash: process.env.PASSWORD_EMPLEADO, role: 'operador' },
};

// Si algún hash falta o no tiene pinta de hash bcrypt (empieza con $2), avisamos
// fuerte: probablemente quedó una contraseña vieja en texto plano sin migrar.
for (const [usuario, u] of Object.entries(USERS)) {
  if (!u.passwordHash) {
    console.error(`❌ Falta la variable de entorno de contraseña para "${usuario}".`);
    process.exit(1);
  }
  if (!u.passwordHash.startsWith('$2')) {
    console.error(`❌ La contraseña de "${usuario}" no parece un hash bcrypt (¿quedó en texto plano?).`);
    console.error('   Generá el hash con: node backend/hash-password.js "tuContraseña"');
    process.exit(1);
  }
}

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Sin autenticación' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin')
    return res.status(403).json({ error: 'Sin permiso' });
  next();
}

function superAdminOnly(req, res, next) {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Sin permiso' });
  next();
}

// Visibilidad de movimientos. El superadmin (Lautaro/Fabio) ve TODO.
// Un rol no-super ve lo que cargó con su propio usuario MÁS las etiquetas de
// LABELS_VISIBLES: así Mariana entra como 'admin' y ve tanto lo cargado a mano
// ('admin') como lo que mandó por el bot, etiquetado con su nombre ('Mariana').
// La etiqueta (cargadoPor) es el "quién cargó" que se muestra; la visibilidad
// se decide acá, separada de la etiqueta.
const LABELS_VISIBLES = { admin: ['mariana'] };

function soloPropiosSiNoSuper(items, req) {
  if (req.user.role === 'superadmin') return items;
  const yo = (req.user.usuario || '').toLowerCase();
  const extra = (LABELS_VISIBLES[req.user.role] || []).map(s => s.toLowerCase());
  const permitidos = new Set([yo, ...extra]);
  return items.filter(m => permitidos.has((m.cargadoPor || '').toLowerCase()));
}

/* ===================== VALIDACIÓN DE ENTRADA =====================
   Hasta acá el backend confiaba en lo que mandaba el front. Un pedido armado
   a mano podía escribir cualquier cosa en la planilla (textos gigantes,
   estados inventados, fechas basura). Esto no reemplaza la validación del
   formulario: la duplica del lado que manda. */

const ESTADOS_VALIDOS = [
  'Consulta', 'Visita agendada', 'Por cerrar', 'Confirmado', 'Realizado', 'Cancelado',
];

const LARGO_MAX = 500;          // tope general para cualquier texto
const LARGO_MAX_LARGO = 3000;   // observaciones y campos de texto libre
const CAMPOS_LARGOS = ['observaciones', 'otrosPedidos', 'exclienteNota', 'notas', 'notaInterna'];

const esFechaISO = v => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);

/* Recorta y normaliza cada string del cuerpo. Devuelve { data, error }. */
function limpiarCliente(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Cuerpo del pedido inválido' };
  }

  const data = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === null || v === undefined) { data[k] = ''; continue; }
    if (typeof v === 'object') { data[k] = v; continue; }   // arrays/objetos anidados: se dejan pasar
    if (typeof v === 'boolean' || typeof v === 'number') { data[k] = v; continue; }

    const tope = CAMPOS_LARGOS.includes(k) ? LARGO_MAX_LARGO : LARGO_MAX;
    const s = String(v).trim();
    if (s.length > tope) {
      return { error: `El campo "${k}" es demasiado largo (máximo ${tope} caracteres)` };
    }
    data[k] = s;
  }

  if (!data.apellidoNombre) {
    return { error: 'Falta el nombre del cliente' };
  }
  if (data.estado && !ESTADOS_VALIDOS.includes(data.estado)) {
    return { error: `Estado inválido: "${data.estado}"` };
  }
  for (const campo of ['fechaEvento', 'proximoSeguimiento']) {
    if (data[campo] !== undefined && !esFechaISO(data[campo])) {
      return { error: `La fecha de "${campo}" tiene que ser AAAA-MM-DD` };
    }
  }
  if (data.cantidadInvitados !== undefined && data.cantidadInvitados !== '') {
    const n = Number(data.cantidadInvitados);
    if (!Number.isFinite(n) || n < 0 || n > 5000) {
      return { error: 'La cantidad de invitados no es válida' };
    }
  }
  if (data.gmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.gmail)) {
    return { error: 'El mail no tiene un formato válido' };
  }

  return { data };
}

function validarCliente(req, res, next) {
  const { data, error } = limpiarCliente(req.body);
  if (error) return res.status(400).json({ error });
  req.body = data;
  next();
}

/* rowIndex siempre es una fila real de la planilla: entero >= 2 (la 1 es el header) */
function validarRowIndex(req, res, next) {
  const n = Number(req.params.rowIndex);
  if (!Number.isInteger(n) || n < 2 || n > 100000) {
    return res.status(400).json({ error: 'Fila inválida' });
  }
  next();
}

// Estado del sistema
app.get('/api/status', (req, res) => {
  res.json({ googleSheets: sheets.tieneCredenciales });
});

// Anti fuerza-bruta en login: máx 10 intentos por IP cada 10 min
const _loginAttempts = new Map();
function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
}
function loginRateLimited(ip) {
  const now = Date.now(), windowMs = 10 * 60 * 1000, max = 10;
  const e = _loginAttempts.get(ip) || { count: 0, start: now };
  if (now - e.start > windowMs) { e.count = 0; e.start = now; }
  e.count++;
  _loginAttempts.set(ip, e);
  return e.count > max;
}

// Login
app.post('/api/login', async (req, res) => {
  if (loginRateLimited(clientIp(req))) {
    return res.status(429).json({ error: 'Demasiados intentos. Esperá unos minutos e intentá de nuevo.' });
  }
  const { password } = req.body;
  const usuario = req.body.usuario?.toLowerCase();
  const user = USERS[usuario];
  if (!user) return res.status(401).json({ error: 'Usuario incorrecto' });
  const ok = await bcrypt.compare(String(password || ''), user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta' });
  const token = jwt.sign({ usuario, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, usuario, role: user.role });
});

// Personas (para búsqueda al crear nuevo evento de cliente existente)
app.get('/api/personas', auth, async (req, res) => {
  try {
    const personas = await sheets.getPersonas();
    res.json(personas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Clientes (Eventos enriquecidos)
app.get('/api/clientes', auth, async (req, res) => {
  try {
    const clientes = await sheets.getClientes();
    res.json(clientes);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/clientes', auth, validarCliente, async (req, res) => {
  try {
    const data = { ...req.body, cargadoPor: req.user.usuario };
    const cliente = await sheets.addCliente(data);
    sheets.registrarAuditoria({
      usuario: req.user.usuario, accion: 'Creó', entidad: 'Evento',
      idEntidad: cliente.id, nombre: cliente.apellidoNombre,
      detalle: sheets.fotoAuditoria(cliente),
    });
    res.json(cliente);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/clientes/:rowIndex', auth, validarRowIndex, validarCliente, async (req, res) => {
  try {
    const rowIndex = parseInt(req.params.rowIndex);
    const result = await sheets.updateCliente(rowIndex, req.body);
    sheets.registrarAuditoria({
      usuario: req.user.usuario, accion: 'Editó', entidad: 'Evento',
      idEntidad: req.body.id, nombre: req.body.apellidoNombre,
      detalle: sheets.fotoAuditoria(req.body),
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/clientes/:rowIndex', auth, adminOnly, validarRowIndex, async (req, res) => {
  try {
    const rowIndex = parseInt(req.params.rowIndex);
    await sheets.deleteEvento(rowIndex, req.body, req.user.usuario);
    sheets.registrarAuditoria({
      usuario: req.user.usuario, accion: 'Eliminó', entidad: 'Evento',
      idEntidad: req.body.id, nombre: req.body.apellidoNombre,
      detalle: 'Archivado en la hoja Papelera',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Auditoría: historial de cambios (solo admin)
app.get('/api/auditoria/cliente/:idCliente', auth, adminOnly, async (req, res) => {
  try {
    res.json(await sheets.getAuditoria(req.params.idCliente));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Devuelve { cliente, fechaEvento, etiqueta } de un evento, para desnormalizar en
// las hojas Ingresos/Egresos. La planilla se analiza en Excel: un id opaco no sirve
// como rotulo de tabla dinamica, el nombre del cliente si.
async function datosEvento(idEvento) {
  if (!idEvento) return { cliente: '', fechaEvento: '', etiqueta: '' };
  try {
    const evs = await sheets.getClientes();
    const ev = evs.find(c => c.id === idEvento);
    if (!ev) return { cliente: '', fechaEvento: '', etiqueta: '' };
    const cliente = ev.apellidoNombre || '';
    const fechaEvento = ev.fechaEvento || '';
    // dd/mm/yyyy: es como lo lee el personal y como lo espera Excel con locale es-AR
    const m = String(fechaEvento).match(/^(\d{4})-(\d{2})-(\d{2})/);
    const fechaLinda = m ? `${m[3]}/${m[2]}/${m[1]}` : fechaEvento;
    const etiqueta = [cliente, fechaLinda].filter(Boolean).join(' — ');
    return { cliente, fechaEvento, etiqueta };
  } catch { return { cliente: '', fechaEvento: '', etiqueta: '' }; }
}

app.post('/api/ingresos', auth, async (req, res) => {
  try {
    const { cliente, fechaEvento } = await datosEvento(req.body.idCliente);
    const ingreso = await sheets.addIngreso({
      ...req.body, cargadoPor: req.user.usuario, cliente, fechaEvento,
    });
    res.json(ingreso);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/ingresos/:rowIndex/confirmar', auth, adminOnly, async (req, res) => {
  try {
    await sheets.confirmarIngreso(parseInt(req.params.rowIndex));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Editar un cobro (usado para corregir borradores desde la bandeja "Por confirmar").
app.put('/api/ingresos/:rowIndex', auth, adminOnly, async (req, res) => {
  try {
    const { cliente, fechaEvento } = await datosEvento(req.body.idCliente);
    const actualizado = await sheets.updateIngreso(parseInt(req.params.rowIndex), {
      ...req.body, cliente, fechaEvento,
    });
    res.json(actualizado);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Restricciones
app.get('/api/restricciones', auth, async (req, res) => {
  try {
    const restricciones = await sheets.getRestricciones();
    res.json(restricciones);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/restricciones/cliente/:idCliente', auth, async (req, res) => {
  try {
    const todas = await sheets.getRestricciones();
    const filtradas = todas.filter(r => r.idCliente === req.params.idCliente);
    res.json(filtradas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/restricciones', auth, async (req, res) => {
  try {
    const r = await sheets.addRestriccion(req.body);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/restricciones/:rowIndex', auth, validarRowIndex, async (req, res) => {
  try {
    await sheets.deleteRestriccion(parseInt(req.params.rowIndex));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Totales por cliente (solo admin)
app.get('/api/ingresos/totales/:idCliente', auth, adminOnly, async (req, res) => {
  try {
    const todos = await sheets.getIngresos();
    const filtrados = todos.filter(i => i.idCliente === req.params.idCliente);
    const total = filtrados.reduce((sum, i) => sum + (parseFloat(i.monto) || 0), 0);
    res.json({ total, ingresos: filtrados });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cuotas
app.get('/api/cuotas/cliente/:idCliente', auth, adminOnly, async (req, res) => {
  try { res.json(await sheets.getCuotasByCliente(req.params.idCliente)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cuotas/plan', auth, async (req, res) => {
  try {
    const { idCliente, montoTotal, cantidadCuotas, valorCuota, fechaInicio, moneda, indexacion } = req.body;
    res.json(await sheets.createPlan(idCliente, montoTotal, cantidadCuotas, valorCuota, fechaInicio, moneda, indexacion, req.user.usuario));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/cuotas/confirmar', auth, adminOnly, async (req, res) => {
  try {
    await sheets.confirmarCuotas(req.body.rowIndices);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/cuotas/pagar', auth, async (req, res) => {
  try {
    const { rowIndices, fechaPago, notas, idCliente, formaPago, montoTotal, montoEfectivo, monedaPago, descripcion } = req.body;
    await sheets.pagarCuotas(rowIndices, fechaPago, notas);
    const montoRegistrar = montoEfectivo || montoTotal;
    if (idCliente && montoRegistrar > 0) {
      // Mismo enriquecido que POST /api/ingresos: sin esto los cobros de cuotas
      // caian en la planilla sin el nombre del cliente y no se podian analizar.
      const { cliente, fechaEvento } = await datosEvento(idCliente);
      await sheets.addIngreso({
        idCliente,
        // tipoIngreso es una categoria cerrada y se agrupa por ella; el detalle
        // de que cuotas cubrio va en notas, no pisando la categoria.
        tipoIngreso: 'Cuota',
        monto: montoRegistrar,
        fecha: fechaPago,
        formaPago: formaPago || '',
        notas: [descripcion, notas].filter(Boolean).join(' — '),
        moneda: monedaPago || 'ARS',
        cliente, fechaEvento,
      });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cobro con imputacion automatica: entra un monto, el sistema decide que cuotas
// tapa. Reemplaza al flujo de tildar cuotas a mano (que sigue disponible como
// excepcion en /api/cuotas/pagar).
app.put('/api/cuotas/imputar', auth, adminOnly, async (req, res) => {
  try {
    const { idCliente, monto, fechaPago, notas, formaPago, moneda } = req.body;
    const importe = parseFloat(monto);
    if (!idCliente || !(importe > 0)) {
      return res.status(400).json({ error: 'Falta el cliente o el monto del cobro.' });
    }
    const { aplicaciones, sobrante } = await sheets.imputarPago(idCliente, importe, fechaPago, notas);

    const detalle = aplicaciones.length
      ? 'Cuota' + (aplicaciones.length > 1 ? 's' : '') + ' ' +
        aplicaciones.map(a => a.numeroCuota).join(', ')
      : '';
    const { cliente, fechaEvento } = await datosEvento(idCliente);
    await sheets.addIngreso({
      idCliente,
      tipoIngreso: 'Cuota',
      monto: importe,
      fecha: fechaPago,
      formaPago: formaPago || '',
      notas: [detalle, sobrante > 0.5 ? `sobrante a favor ${Math.round(sobrante)}` : '', notas]
             .filter(Boolean).join(' — '),
      moneda: moneda || 'ARS',
      cargadoPor: req.user.usuario,
      cliente, fechaEvento,
    });
    res.json({ ok: true, aplicaciones, sobrante });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ------------------------- PAGO POR CUBIERTO ------------------------------ */

// Cotizacion del blue. Se toma el promedio entre compra y venta, que es el
// criterio que usa el salon para convertir. Se cachea 10 minutos: no hace falta
// pegarle a la API en cada tecla y evita quedarse sin servicio si hay un pico.
let _cacheDolar = { valor: null, ts: 0 };

async function cotizacionBlue() {
  const AHORA = Date.now();
  if (_cacheDolar.valor && AHORA - _cacheDolar.ts < 10 * 60 * 1000) return _cacheDolar.valor;

  const fuentes = [
    { url: 'https://dolarapi.com/v1/dolares/blue',
      leer: d => ({ compra: d.compra, venta: d.venta }) },
    { url: 'https://api.bluelytics.com.ar/v2/latest',
      leer: d => ({ compra: d.blue.value_buy, venta: d.blue.value_sell }) },
  ];
  for (const f of fuentes) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(f.url, { signal: ctrl.signal });
      clearTimeout(to);
      if (!r.ok) continue;
      const { compra, venta } = f.leer(await r.json());
      if (!(compra > 0) || !(venta > 0)) continue;
      const val = {
        compra, venta,
        promedio: Math.round((compra + venta) / 2),
        fuente: f.url.includes('dolarapi') ? 'DolarAPI (blue)' : 'Bluelytics (blue)',
        actualizado: new Date().toISOString(),
      };
      _cacheDolar = { valor: val, ts: AHORA };
      return val;
    } catch { /* probamos la siguiente fuente */ }
  }
  return null;
}

app.get('/api/cotizacion-blue', auth, async (req, res) => {
  const c = await cotizacionBlue();
  if (!c) return res.status(503).json({ error: 'No se pudo obtener la cotización. Cargala a mano.' });
  res.json(c);
});

// Precio general del cubierto (se propone al crear un evento; cada evento
// despues puede tener el suyo).
app.get('/api/config', auth, async (req, res) => {
  try { res.json(await sheets.getConfig()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/config', auth, superAdminOnly, async (req, res) => {
  try {
    const { clave, valor } = req.body;
    if (!clave) return res.status(400).json({ error: 'Falta la clave.' });
    res.json(await sheets.setConfig(clave, valor));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Estado de cubiertos de un evento: cuantos lleva, cuanto a favor, cuanto falta.
app.get('/api/cubiertos/:idEvento', auth, adminOnly, async (req, res) => {
  try {
    const [eventos, ingresos] = await Promise.all([sheets.getClientes(), sheets.getIngresos()]);
    const ev = eventos.find(e => e.id === req.params.idEvento);
    if (!ev) return res.status(404).json({ error: 'Evento no encontrado' });
    const delEvento = ingresos.filter(i => i.idCliente === ev.id);
    res.json({ ...sheets.estadoCubiertos(ev, delEvento), evento: ev.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Registrar un cobro que compra cubiertos.
app.put('/api/cubiertos/cobrar', auth, adminOnly, async (req, res) => {
  try {
    const { idEvento, monto, moneda, cotizacion, fecha, formaPago, notas, tipoIngreso } = req.body;
    const importe = parseFloat(monto);
    if (!idEvento || !(importe > 0)) {
      return res.status(400).json({ error: 'Falta el evento o el monto del cobro.' });
    }

    const [eventos, ingresos] = await Promise.all([sheets.getClientes(), sheets.getIngresos()]);
    const ev = eventos.find(e => e.id === idEvento);
    if (!ev) return res.status(404).json({ error: 'Evento no encontrado' });

    const estado = sheets.estadoCubiertos(ev, ingresos.filter(i => i.idCliente === idEvento));
    if (!(estado.precio > 0)) {
      return res.status(400).json({ error: 'Este evento no tiene precio de cubierto cargado.' });
    }

    // Doble conversion: dolares -> pesos -> cubiertos. El tipo de cambio usado
    // se guarda en la fila para que el calculo quede reproducible mas adelante.
    const esUSD = (moneda || 'ARS') === 'USD';
    const tc = esUSD ? parseFloat(cotizacion) : 0;
    if (esUSD && !(tc > 0)) {
      return res.status(400).json({ error: 'Falta la cotización del dólar para convertir el cobro.' });
    }
    const montoARS = esUSD ? importe * tc : importe;

    const compra = sheets.calcularCompraCubiertos(
      montoARS, estado.saldoAFavor, estado.precio, estado.restantes);

    const { cliente, fechaEvento } = await datosEvento(idEvento);
    const detalle = [
      compra.cubiertos > 0 ? `${compra.cubiertos} cubierto(s) a ${Math.round(estado.precio)}` : 'sin cubiertos',
      esUSD ? `U$S ${importe} x ${tc}` : '',
      compra.saldoNuevo > 0.5 ? `a favor ${Math.round(compra.saldoNuevo)}` : '',
      compra.excedente > 0.5 ? `excedente ${Math.round(compra.excedente)}` : '',
      notas,
    ].filter(Boolean).join(' — ');

    await sheets.addIngreso({
      idCliente: idEvento,
      tipoIngreso: tipoIngreso || 'Cubiertos',
      monto: importe,
      fecha,
      formaPago: formaPago || '',
      notas: detalle,
      moneda: moneda || 'ARS',
      cargadoPor: req.user.usuario,
      cliente, fechaEvento,
      cubiertos: compra.cubiertos,
      precioCubierto: estado.precio,
      cotizacion: esUSD ? tc : '',
      montoARS,
    });

    const pagadosAhora = estado.cubiertosPagados + compra.cubiertos;
    res.json({
      ok: true,
      montoARS,
      cubiertosComprados: compra.cubiertos,
      precioUsado: estado.precio,
      saldoAFavor: compra.saldoNuevo,
      excedente: compra.excedente,
      cubiertosPagados: pagadosAhora,
      totalCubiertos: estado.total,
      restantes: Math.max(0, estado.total - pagadosAhora),
      faltaPagar: Math.max(0, estado.total - pagadosAhora) * estado.precio,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/cuotas/ipc', auth, async (req, res) => {
  try {
    const { idCliente, porcentaje } = req.body;
    res.json(await sheets.aplicarIPC(idCliente, porcentaje));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Consulta el IPC mensual del INDEC (datos.gob.ar) y lo aplica a cuotas indexadas
app.get('/api/cuotas/ipc-actual', auth, async (req, res) => {
  try {
    const url = 'https://apis.datos.gob.ar/series/api/series/?ids=148.3_INUCLEOMX_DICI_M_19&limit=2&sort=desc&format=json';
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`INDEC respondió ${r.status}`);
    const json = await r.json();
    const data = json.data;
    if (!data || data.length < 2) throw new Error('Datos insuficientes del INDEC');
    const [latest, prev] = data;
    const porcentaje = Math.round(((latest[1] - prev[1]) / prev[1]) * 10000) / 100;
    res.json({ porcentaje, mes: latest[0].substring(0, 7) });
  } catch (e) {
    res.status(502).json({ error: 'No se pudo consultar el INDEC: ' + e.message });
  }
});

app.put('/api/cuotas/ipc-indexados', auth, async (req, res) => {
  try {
    const { idCliente, porcentaje } = req.body;
    res.json(await sheets.aplicarIPCIndexados(idCliente, porcentaje));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/cuotas/ajustar', auth, async (req, res) => {
  try {
    const { idCliente, nuevoValor } = req.body;
    res.json(await sheets.ajustarValorCuotas(idCliente, nuevoValor));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/cuotas/plan/:idCliente', auth, adminOnly, async (req, res) => {
  try {
    await sheets.cancelarPlan(req.params.idCliente);
    sheets.registrarAuditoria({
      usuario: req.user.usuario, accion: 'Borró el plan de pagos',
      entidad: 'Cuotas', idEntidad: req.params.idCliente,
      detalle: 'Se eliminaron todas las cuotas del cliente',
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Timming — admin y superadmin
function canManageTimming(req) {
  return req.user.role === 'admin' || req.user.role === 'superadmin';
}

app.get('/api/timming/cliente/:idCliente', auth, async (req, res) => {
  if (!canManageTimming(req)) return res.status(403).json({ error: 'Sin permiso' });
  try { res.json(await sheets.getTimming(req.params.idCliente)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/timming', auth, async (req, res) => {
  if (!canManageTimming(req)) return res.status(403).json({ error: 'Sin permiso' });
  try { res.json(await sheets.addTimmingItem(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/timming/:rowIndex', auth, async (req, res) => {
  if (!canManageTimming(req)) return res.status(403).json({ error: 'Sin permiso' });
  try { res.json(await sheets.updateTimmingItem(parseInt(req.params.rowIndex), req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/timming/:rowIndex', auth, async (req, res) => {
  if (!canManageTimming(req)) return res.status(403).json({ error: 'Sin permiso' });
  try { await sheets.deleteTimmingItem(parseInt(req.params.rowIndex)); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Migración única: Clientes → Personas + Eventos (admin y superadmin)
app.post('/api/migrar-clientes', auth, adminOnly, async (req, res) => {
  try {
    const result = await sheets.migrarClientesAPersonasEventos();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Empleados
app.get('/api/empleados', auth, adminOnly, async (req, res) => {
  try { res.json(await sheets.getEmpleados()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/empleados', auth, adminOnly, async (req, res) => {
  try { res.json(await sheets.addEmpleado(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Datos crudos para el dashboard externo ───────────────────────────────────
// Un unico endpoint a proposito: la PC que lo consume arranca Render dormido y
// cada request extra son ~50s de espera. Devuelve todo lo necesario de una.
app.get('/api/dashboard-data', auth, superAdminOnly, async (req, res) => {
  try {
    const [clientes, ingresos, egresos, cuotas] = await Promise.all([
      sheets.getClientes(),
      sheets.getIngresos(),
      sheets.getEgresos(),
      sheets.getAllCuotas(),
    ]);
    res.json({
      generado: new Date().toISOString(),
      clientes, ingresos, egresos, cuotas,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Todos los ingresos confirmados (para el historial de movimientos del salón).
app.get('/api/ingresos', auth, adminOnly, async (req, res) => {
  try {
    const ingresos = await sheets.getIngresos();
    res.json(soloPropiosSiNoSuper(ingresos.filter(i => i.confirmado !== false), req));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Egresos
app.get('/api/egresos', auth, adminOnly, async (req, res) => {
  try { res.json(soloPropiosSiNoSuper(await sheets.getEgresos(), req)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Bandeja "Por confirmar": ingresos y egresos que un humano todavia no valido.
// Los ingresos cargados por 'empleado' y los egresos cargados por el bot nacen sin confirmar.
app.get('/api/pendientes', auth, adminOnly, async (req, res) => {
  try {
    const [ingresos, egresos] = await Promise.all([sheets.getIngresos(), sheets.getEgresos()]);
    res.json({
      ingresos: soloPropiosSiNoSuper(ingresos.filter(i => i.confirmado === false), req),
      egresos: soloPropiosSiNoSuper(egresos.filter(e => e.confirmado === false), req),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/egresos', auth, adminOnly, async (req, res) => {
  if (req.body.categoria === 'Materia Prima' && req.user.role !== 'superadmin')
    return res.status(403).json({ error: 'Solo el superadmin puede registrar Materia Prima' });
  try {
    const { etiqueta } = await datosEvento(req.body.idEvento);
    res.json(await sheets.addEgreso({
      ...req.body, cargadoPor: req.user.usuario, evento: etiqueta,
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/egresos/:rowIndex', auth, adminOnly, async (req, res) => {
  try {
    const rowIndex = parseInt(req.params.rowIndex);
    const { etiqueta } = await datosEvento(req.body.idEvento);
    res.json(await sheets.updateEgreso(rowIndex, { ...req.body, evento: etiqueta }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Confirmar un egreso borrador (cargado por el bot). Espejo de confirmar ingreso.
app.put('/api/egresos/:rowIndex/confirmar', auth, adminOnly, async (req, res) => {
  try {
    await sheets.confirmarEgreso(parseInt(req.params.rowIndex));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Borrar egreso — solo superadmin, igual criterio que el boton de editar.
app.delete('/api/egresos/:rowIndex', auth, superAdminOnly, async (req, res) => {
  try {
    res.json(await sheets.deleteEgreso(parseInt(req.params.rowIndex)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Formulario público de consultas ──────────────────────────────────────────

// Rate limiter en memoria: max 5 envíos por IP cada 10 min
const _rlMap = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const window = 10 * 60 * 1000;
  const entry = _rlMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > window) { entry.count = 1; entry.start = now; }
  else entry.count++;
  _rlMap.set(ip, entry);
  return entry.count > 5;
}

app.get('/consulta', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/consulta.html'));
});

app.post('/api/leads', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  if (checkRateLimit(ip)) return res.status(429).json({ error: 'Demasiadas solicitudes. Intentá más tarde.' });

  // Honeypot: si el campo oculto tiene valor, es un bot
  if (req.body._hp) return res.status(400).json({ error: 'Formulario inválido.' });

  const { nombre, telefono, email, tipoEvento, fechaEvento, cantidadInvitados, turno, mensaje } = req.body;

  if (!nombre?.trim() || !telefono?.trim() || !email?.trim() || !tipoEvento || !turno) {
    return res.status(400).json({ error: 'Faltan campos obligatorios.' });
  }
  if (cantidadInvitados && parseInt(cantidadInvitados) < 80) {
    return res.status(400).json({ error: 'La capacidad mínima del salón es de 80 invitados.' });
  }

  try {
    const ORIGENES_VALIDOS = ['Instagram','TikTok','Facebook','Google','WhatsApp','Recomendacion','Otro'];
    const origenRaw = req.body.origen || req.body.utm_source || '';
    const origen = ORIGENES_VALIDOS.includes(origenRaw) ? origenRaw : 'Formulario';

    const cliente = await sheets.addCliente({
      apellidoNombre: nombre.trim(),
      telefono: telefono.trim(),
      gmail: email.trim(),
      tipoEvento,
      fechaEvento: fechaEvento || '',
      cantidadInvitados: cantidadInvitados || '',
      turno,
      observaciones: mensaje?.trim() || '',
      estado: 'Consulta',
      origen,
      cargadoPor: 'bot-formulario',
    });
    res.json({ ok: true, rowIndex: cliente.rowIndex });
  } catch (e) {
    console.error('Error en /api/leads:', e.message);
    res.status(500).json({ error: 'Error al registrar la consulta. Intentá más tarde.' });
  }
});

// Webhook de Cal.com — se llama cuando alguien agenda una visita al salón
app.post('/api/cal-booking', async (req, res) => {
  // Verificación opcional: si definís CAL_WEBHOOK_SECRET, el webhook debe llamarse
  // con ?secret=ESE_VALOR en la URL. Sin la variable, funciona como antes (no rompe).
  const expectedSecret = process.env.CAL_WEBHOOK_SECRET;
  if (expectedSecret && req.query.secret !== expectedSecret) {
    return res.status(401).json({ error: 'Webhook no autorizado' });
  }
  try {
    const { triggerEvent, payload } = req.body;
    if (triggerEvent !== 'BOOKING_CREATED') return res.json({ ok: true });

    // Formato YYYY-MM-DD que espera el calendario del CRM (sv-SE da ISO sin hora)
    const visitDate = new Date(payload.startTime).toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });

    const rowIndex = parseInt(payload?.metadata?.rowIndex);

    if (rowIndex && !isNaN(rowIndex)) {
      // Vino desde el formulario: actualizar el registro existente
      await sheets.patchEvento(rowIndex, {
        estado: 'Visita agendada',
        proximoSeguimiento: visitDate,
      });
      console.log(`cal-booking: rowIndex ${rowIndex} → Visita agendada el ${visitDate}`);
    } else {
      // Reserva directa en Cal.com: crear registro nuevo en el CRM
      const attendee = payload?.attendees?.[0] || {};
      const nombre = attendee.name || payload?.responses?.name?.value || 'Sin nombre';
      const email  = attendee.email || payload?.responses?.email?.value || '';
      await sheets.addCliente({
        apellidoNombre: nombre,
        gmail: email,
        telefono: '',
        estado: 'Visita agendada',
        proximoSeguimiento: visitDate,
        origen: 'Cal.com',
        cargadoPor: 'cal-booking',
      });
      console.log(`cal-booking: nuevo registro → ${nombre} / Visita agendada el ${visitDate}`);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('Error en /api/cal-booking:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ===================== COCINA (superadmin) ===================== */

app.get('/api/catalogo-items', auth, superAdminOnly, async (req, res) => {
  try {
    const items = await sheets.getCatalogoItems();
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/catalogo-items', auth, superAdminOnly, async (req, res) => {
  try {
    const { categoria, nombre, unidad } = req.body;
    if (!categoria || !nombre) return res.status(400).json({ error: 'categoria y nombre requeridos' });
    const item = await sheets.addCatalogoItem({ categoria, nombre, unidad });
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/catalogo-items/:rowIndex', auth, superAdminOnly, async (req, res) => {
  try {
    const { unidad, nombre, categoria } = req.body;
    const data = {};
    if (unidad !== undefined) data.unidad = unidad;
    if (nombre !== undefined) data.nombre = nombre;
    if (categoria !== undefined) data.categoria = categoria;
    if (!Object.keys(data).length) return res.status(400).json({ error: 'nada para actualizar' });
    await sheets.updateCatalogoItem(parseInt(req.params.rowIndex), data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Mover un ítem de grupo (categoría) desde la vista de stock (drag & drop)
app.post('/api/stock-actual/mover', auth, superAdminOnly, async (req, res) => {
  try {
    const { id, categoria } = req.body;
    if (!id || !categoria) return res.status(400).json({ error: 'id y categoria requeridos' });
    await sheets.cambiarCategoriaItem(id, categoria);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Editar un ítem por id (nombre / unidad / grupo) desde stock o desde el pedido.
// Va por id y no por rowIndex porque el frontend no siempre tiene la fila a mano.
app.put('/api/catalogo-items/por-id/:id', auth, superAdminOnly, async (req, res) => {
  try {
    const { nombre, unidad, categoria } = req.body;
    await sheets.editarItemCatalogo(req.params.id, { nombre, unidad, categoria });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Baja definitiva de un ítem (sale del catálogo y del stock).
app.delete('/api/catalogo-items/por-id/:id', auth, superAdminOnly, async (req, res) => {
  try {
    await sheets.eliminarItemCatalogo(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/catalogo-items/:rowIndex', auth, superAdminOnly, async (req, res) => {
  try {
    await sheets.deleteCatalogoItem(parseInt(req.params.rowIndex));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/catalogo-items/sync', auth, superAdminOnly, async (req, res) => {
  try {
    const result = await sheets.sincronizarCatalogoConInicial();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/pedidos-cocina', auth, superAdminOnly, async (req, res) => {
  try {
    const pedidos = await sheets.getPedidosCocina();
    res.json(pedidos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/pedidos-cocina', auth, superAdminOnly, async (req, res) => {
  try {
    const pedido = await sheets.addPedidoCocina({ ...req.body, creadoPor: req.user.usuario });
    res.json(pedido);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/pedidos-cocina/:rowIndex', auth, superAdminOnly, async (req, res) => {
  try {
    const pedido = await sheets.updatePedidoCocina(parseInt(req.params.rowIndex), req.body);
    res.json(pedido);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/pedidos-cocina/:rowIndex', auth, superAdminOnly, async (req, res) => {
  try {
    await sheets.deletePedidoCocina(parseInt(req.params.rowIndex));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stock-actual', auth, superAdminOnly, async (req, res) => {
  try {
    res.json(await sheets.getStockActual());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Stock mínimo deseado por ítem (par level): por debajo de esto se marca "reponer".
app.post('/api/stock-actual/minimo', auth, superAdminOnly, async (req, res) => {
  try {
    const { id, minimo } = req.body;
    if (!id) return res.status(400).json({ error: 'id requerido' });
    await sheets.actualizarMinimoStock(id, minimo);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/stock-actual/actualizar', auth, superAdminOnly, async (req, res) => {
  try {
    const { actualizaciones } = req.body;
    if (!Array.isArray(actualizaciones)) return res.status(400).json({ error: 'actualizaciones requerido' });
    await sheets.actualizarStockActual(actualizaciones);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ── Bot de Telegram (carga de ingresos/egresos por audio → bandeja Por confirmar) ──
const telegramBot = require('./telegram-bot');
if (telegramBot.BOT_ACTIVO) {
  app.use('/api', telegramBot.crearRouter(sheets));
  console.log('🤖 Bot de Telegram activo (webhook en /api/webhook/telegram)');
} else {
  console.log('🤖 Bot de Telegram inactivo (faltan TELEGRAM_BOT_TOKEN o GEMINI_API_KEY)');
}

// Serve frontend — debe ir ÚLTIMO para no capturar rutas API
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  sheets.initSheets();
});
