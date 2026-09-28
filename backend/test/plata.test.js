/* Pruebas de los cálculos de plata. Correr: npm test (desde la raíz).
   No tocan la planilla: son funciones puras de backend/sheets.js. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const s = require('../sheets');
const { normalizarTelefono } = require('../listas');
const { construirResumen } = require('../resumen-semanal');

const cuota = (numeroCuota, valorActual, montoPagado = 0, estado = 'pendiente') =>
  ({ rowIndex: numeroCuota + 1, numeroCuota, valorActual, montoPagado, estado });

/* ---------- Imputación de un cobro a las cuotas ---------- */

test('imputación: paga las cuotas en orden y deja la última en parcial', () => {
  const r = s.calcularImputacion([cuota(2, 1000), cuota(1, 1000), cuota(3, 1000)], 2500);
  assert.deepEqual(r.aplicaciones.map(a => [a.numeroCuota, a.aplicado, a.nuevoEstado]),
    [[1, 1000, 'pagada'], [2, 1000, 'pagada'], [3, 500, 'parcial']]);
  assert.equal(r.sobrante, 0);
});

test('imputación: saltea pagadas y canceladas, completa la parcial primero', () => {
  const r = s.calcularImputacion([cuota(1, 1000, 1000, 'pagada'), cuota(2, 1000, 400, 'parcial'), cuota(3, 1000, 0, 'cancelada'), cuota(4, 1000)], 600);
  assert.deepEqual(r.aplicaciones.map(a => [a.numeroCuota, a.aplicado, a.nuevoEstado]), [[2, 600, 'pagada']]);
});

test('imputación: lo que sobra queda como sobrante, no inventa cuotas', () => {
  const r = s.calcularImputacion([cuota(1, 1000)], 1300);
  assert.equal(r.aplicaciones.length, 1);
  assert.equal(r.sobrante, 300);
});

test('imputación: una diferencia de centavos no deja la cuota en parcial', () => {
  const r = s.calcularImputacion([cuota(1, 1000.4)], 1000);
  assert.equal(r.aplicaciones[0].nuevoEstado, 'pagada');
});

/* ---------- Pago por cubierto ---------- */

test('cubiertos: redondea para abajo y lo que sobra queda a favor', () => {
  assert.deepEqual(s.calcularCompraCubiertos(25000, 0, 10000, null), { cubiertos: 2, usado: 20000, saldoNuevo: 5000, excedente: 0 });
  assert.deepEqual(s.calcularCompraCubiertos(5000, 5000, 10000, null), { cubiertos: 1, usado: 10000, saldoNuevo: 0, excedente: 0 });
});

test('cubiertos: no compra más de los que tiene el evento; el resto es excedente', () => {
  assert.deepEqual(s.calcularCompraCubiertos(50000, 0, 10000, 3), { cubiertos: 3, usado: 30000, saldoNuevo: 0, excedente: 20000 });
});

test('cubiertos: sin precio no compra nada y no pierde la plata', () => {
  assert.deepEqual(s.calcularCompraCubiertos(8000, 1000, 0, null), { cubiertos: 0, usado: 0, saldoNuevo: 9000, excedente: 0 });
});

test('estado de cubiertos: saldo a favor derivado de lo pagado y lo aplicado', () => {
  const e = s.estadoCubiertos({ precioCubierto: 10000, cantidadInvitados: 10 }, [
    { monto: 25000, montoARS: 25000, cubiertos: 2, precioCubierto: 10000 },
    { monto: 99999, cubiertos: 5, precioCubierto: 10000, confirmado: false },   // borrador: no cuenta
  ]);
  assert.equal(e.cubiertosPagados, 2);
  assert.equal(e.saldoAFavor, 5000);
  assert.equal(e.restantes, 8);
  assert.equal(e.faltaPagar, 80000);
  assert.equal(e.completo, false);
});

/* ---------- Cuenta del evento (contado / pagos sueltos) ---------- */

test('cobro en pesos: dólares con cotización se convierten; sin cotización, null', () => {
  assert.equal(s.cobroEnPesos({ monto: '1500', moneda: 'ARS' }), 1500);
  assert.equal(s.cobroEnPesos({ monto: '100', moneda: 'USD', montoARS: '120000' }), 120000);
  assert.equal(s.cobroEnPesos({ monto: '100', moneda: 'USD' }), null);
});

test('cuenta: los dólares sin cotización van aparte y los borradores no suman', () => {
  const c = s.estadoCuenta({ montoPresupuesto: 1000000 }, [
    { monto: 400000, moneda: 'ARS' },
    { monto: 100, moneda: 'USD', montoARS: 120000 },
    { monto: 50, moneda: 'USD' },
    { monto: 999999, moneda: 'ARS', confirmado: false },
  ]);
  assert.equal(c.pagado, 520000);
  assert.equal(c.usdSinConvertir, 50);
  assert.equal(c.falta, 480000);
  assert.equal(c.sinConfirmar, 1);
  assert.equal(c.completo, false);
});

test('cuenta: completo con tolerancia de medio peso; lo de más queda a favor', () => {
  assert.equal(s.estadoCuenta({ montoPresupuesto: 1000 }, [{ monto: 999.6 }]).completo, true);
  assert.equal(s.estadoCuenta({ montoPresupuesto: 1000 }, [{ monto: 1200 }]).aFavor, 200);
});

/* ---------- Las copias del frontend tienen que ser iguales ---------- */

function funcionDelFrontend(nombre) {
  const app = fs.readFileSync(path.join(__dirname, '../../frontend/js/app.js'), 'utf8');
  const inicio = app.indexOf(`function ${nombre}(`);
  assert.ok(inicio !== -1, `${nombre} no está en app.js`);
  // Hasta la llave que cierra la función (cuenta llaves)
  let nivel = 0, fin = app.indexOf('{', inicio);
  for (let i = fin; i < app.length; i++) {
    if (app[i] === '{') nivel++;
    if (app[i] === '}' && --nivel === 0) { fin = i + 1; break; }
  }
  return new Function(`${app.slice(inicio, fin)}; return ${nombre};`)();
}

test('la vista previa de app.js calcula igual que el servidor', () => {
  const imputarFront = funcionDelFrontend('calcularImputacionLocal');
  const cubiertosFront = funcionDelFrontend('calcularCompraCubiertosLocal');
  const casos = [
    [[cuota(1, 1000), cuota(2, 1000, 300, 'parcial')], 1500],
    [[cuota(1, 1000.4), cuota(2, 500)], 3000],
    [[cuota(1, 1000, 1000, 'pagada')], 200],
  ];
  // La vista previa devuelve solo lo que muestra: se comparan esos campos
  const loQueSeVe = r => ({ sobrante: r.sobrante, aplicaciones: r.aplicaciones.map(a =>
    ({ numeroCuota: a.numeroCuota, aplicado: a.aplicado, restaDespues: a.restaDespues, nuevoEstado: a.nuevoEstado })) });
  for (const [c, m] of casos) {
    assert.deepEqual(loQueSeVe(imputarFront(structuredClone(c), m)), loQueSeVe(s.calcularImputacion(structuredClone(c), m)));
  }
  for (const args of [[25000, 0, 10000, null], [50000, 0, 10000, 3], [8000, 1000, 0, null]]) {
    const { usado: _u, ...servidor } = s.calcularCompraCubiertos(...args);   // "usado" no se muestra
    assert.deepEqual(cubiertosFront(...args), servidor);
  }
});

/* ---------- Datos: teléfono y resumen ---------- */

test('teléfono: todas las formas argentinas quedan iguales; lo dudoso no se toca', () => {
  for (const t of ['011 15-2345-6789', '1123456789', '+54 9 11 2345 6789', '5491123456789', '0054 9 11 2345-6789']) {
    assert.equal(normalizarTelefono(t), '+54 9 1123456789', t);
  }
  assert.equal(normalizarTelefono('0351 15 612-3456'), '+54 9 3516123456');
  assert.equal(normalizarTelefono('15 2345 6789'), '15 2345 6789');      // celular sin área
  assert.equal(normalizarTelefono('4567-8901'), '4567-8901');            // fijo sin área
  assert.equal(normalizarTelefono('+1 305 555 1234'), '+1 305 555 1234'); // extranjero
});

test('resumen semanal: semana limpia y semana con problemas', () => {
  const hoy = new Date(2026, 8, 28);
  assert.match(construirResumen({ hoy, backups: 7 }), /Semana sin problemas/);
  const r = construirResumen({
    hoy, backups: 5,
    eventos: [{ id: 'E1', apellidoNombre: 'Ana', estado: 'Confirmado', fechaEvento: '' }],
    ingresos: [{ id: 'I1', idCliente: '', monto: 100, fecha: '2026-09-01', confirmado: true },
               { id: 'I2', idCliente: 'E1', monto: 5, creadoEn: '2026-09-01 10:00:00', confirmado: false, cliente: 'Ana' }],
  });
  assert.match(r, /1 cobro\(s\) confirmado\(s\) sin evento/);
  assert.match(r, /1 evento\(s\) confirmado\(s\) sin fecha/);
  assert.match(r, /1 borrador\(es\) del bot con más de 7 días/);
  assert.match(r, /Solo 5 backup/);
});
