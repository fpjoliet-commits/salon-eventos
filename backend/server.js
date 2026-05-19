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
  Anita: { password: process.env.PASSWORD_ANITA, role: 'operador' },
  Mariana: { password: process.env.PASSWORD_MARIANA, role: 'operador' },
  Fabio: { password: process.env.PASSWORD_FABIO, role: 'admin' },
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
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permiso' });
  next();
}

// Estado del sistema
app.get('/api/status', (req, res) => {
  res.json({ googleSheets: sheets.tieneCredenciales });
});

// Login
app.post('/api/login', (req, res) => {
  const { usuario, password } = req.body;
  const user = USERS[usuario];
  if (!user) return res.status(401).json({ error: 'Usuario incorrecto' });
  const sinContrasena = !user.password;
  if (!sinContrasena && user.password !== password) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  const token = jwt.sign({ usuario, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, usuario, role: user.role });
});

// Clientes
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

// Ingresos — solo admin (Fabio)
app.get('/api/ingresos', auth, adminOnly, async (req, res) => {
  try {
    const ingresos = await sheets.getIngresos();
    res.json(ingresos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/ingresos/cliente/:idCliente', auth, adminOnly, async (req, res) => {
  try {
    const todos = await sheets.getIngresos();
    const filtrados = todos.filter(i => i.idCliente === req.params.idCliente);
    res.json(filtrados);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ingresos', auth, async (req, res) => {
  try {
    const ingreso = await sheets.addIngreso(req.body);
    res.json(ingreso);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

// Serve frontend
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Cuotas
app.get('/api/cuotas/cliente/:idCliente', auth, async (req, res) => {
  try { res.json(await sheets.getCuotasByCliente(req.params.idCliente)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cuotas/plan', auth, async (req, res) => {
  try {
    const { idCliente, montoTotal, cantidadCuotas, valorCuota, fechaInicio } = req.body;
    res.json(await sheets.createPlan(idCliente, montoTotal, cantidadCuotas, valorCuota, fechaInicio));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/cuotas/pagar', auth, async (req, res) => {
  try {
    const { rowIndices, fechaPago, notas } = req.body;
    await sheets.pagarCuotas(rowIndices, fechaPago, notas);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/cuotas/ipc', auth, async (req, res) => {
  try {
    const { idCliente, porcentaje } = req.body;
    res.json(await sheets.aplicarIPC(idCliente, porcentaje));
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

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  sheets.initSheets();
});
