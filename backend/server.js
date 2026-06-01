require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const sheets = require('./sheets');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.static(path.join(process.cwd(), 'frontend')));

const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 3001;

const USERS = {
  superadmin: { password: process.env.PASSWORD_SUPERADMIN, role: 'superadmin' },
  admin: { password: process.env.PASSWORD_ADMIN, role: 'admin' },
  empleado: { password: process.env.PASSWORD_EMPLEADO, role: 'operador' },
};

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

// Estado del sistema
app.get('/api/status', (req, res) => {
  res.json({ googleSheets: sheets.tieneCredenciales });
});

// Login
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const usuario = req.body.usuario?.toLowerCase();
  const user = USERS[usuario];
  if (!user) return res.status(401).json({ error: 'Usuario incorrecto' });
  if (user.password !== password) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
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

app.post('/api/clientes', auth, async (req, res) => {
  try {
    const data = { ...req.body, cargadoPor: req.user.usuario };
    const cliente = await sheets.addCliente(data);
    res.json(cliente);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/clientes/:rowIndex', auth, async (req, res) => {
  try {
    const rowIndex = parseInt(req.params.rowIndex);
    const result = await sheets.updateCliente(rowIndex, req.body);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/clientes/:rowIndex', auth, adminOnly, async (req, res) => {
  try {
    const rowIndex = parseInt(req.params.rowIndex);
    await sheets.deleteEvento(rowIndex, req.body, req.user.usuario);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ingresos', auth, async (req, res) => {
  try {
    const ingreso = await sheets.addIngreso({ ...req.body, cargadoPor: req.user.usuario });
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

app.delete('/api/restricciones/:rowIndex', auth, async (req, res) => {
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
      await sheets.addIngreso({
        idCliente,
        tipoIngreso: descripcion || 'Cuota',
        monto: montoRegistrar,
        fecha: fechaPago,
        formaPago: formaPago || '',
        notas: notas || '',
        moneda: monedaPago || 'ARS',
      });
    }
    res.json({ ok: true });
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

// Egresos
app.get('/api/egresos', auth, adminOnly, async (req, res) => {
  try { res.json(await sheets.getEgresos()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/egresos', auth, adminOnly, async (req, res) => {
  if (req.body.categoria === 'Materia Prima' && req.user.role !== 'superadmin')
    return res.status(403).json({ error: 'Solo el superadmin puede registrar Materia Prima' });
  try { res.json(await sheets.addEgreso({ ...req.body, cargadoPor: req.user.usuario })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/egresos/:rowIndex', auth, adminOnly, async (req, res) => {
  try {
    const rowIndex = parseInt(req.params.rowIndex);
    res.json(await sheets.updateEgreso(rowIndex, req.body));
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
    const { unidad } = req.body;
    if (!unidad) return res.status(400).json({ error: 'unidad requerida' });
    await sheets.updateCatalogoItem(parseInt(req.params.rowIndex), { unidad });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
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

// Serve frontend — debe ir ÚLTIMO para no capturar rutas API
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  sheets.initSheets();
});
