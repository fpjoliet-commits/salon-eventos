/* Listas cerradas: la única fuente de verdad de los valores válidos de cada campo
   con opciones. Son las mismas que ofrecen los <select> de frontend/index.html
   (si se agrega una opción allá, se agrega acá) más los valores que pone el
   sistema solo (origen "Formulario" / "Cal.com").

   Por qué: el formulario web usaba otros nombres ("Cumpleaños de 15" en vez de
   "XV años") y al editar esa ficha en el CRM el select quedaba en blanco y se
   borraba el dato. Para analizar los datos mañana, cada concepto tiene que
   estar escrito de UNA sola forma.

   normalizar() traduce sinónimos y mayúsculas al valor oficial (se aplica a
   todo lo que se guarda: app, bot, formulario, Cal.com). validar() rechaza lo
   que no está en la lista (se usa en las rutas que carga una persona). */

const CUMPLES = ['1 año', '18', '40', '50', '60', '70', '80', '90'].map(e => `Cumpleaños — ${e}`);

const LISTAS = {
  evento: {
    estado: ['Consulta', 'Visita agendada', 'Por cerrar', 'Confirmado', 'Realizado', 'Cancelado'],
    tipoEvento: ['Boda', 'XV años', 'Cumpleaños', ...CUMPLES, 'Bautismo', 'Comunión', 'Egresados', 'Corporativo', 'Otro'],
    origen: ['Instagram', 'Facebook', 'WhatsApp', 'Google', 'TikTok', 'Referido', 'Pasó por la puerta', 'Otro', 'Formulario', 'Cal.com'],
    turno: ['Almuerzo', 'Tarde', 'Noche'],
    formato: ['Formal', 'Americano'],
    estadoFecha: ['Tentativa', 'Reservada'],
    tipoCliente: ['Nuevo', 'Excliente', 'Referido'],
    presupuesto: ['Sí, tiene monto', 'No sabe', 'No dice'],
    modalidadPago: ['contado', 'cuotas', 'cubiertos'],
    motivoCancelacion: ['Otro salón', 'Precio', 'Fecha ocupada', 'Se suspendió', 'Dejó de responder', 'Sin motivo', 'Otro'],
  },
  ingreso: {
    tipoIngreso: ['Seña', 'Pago a cuenta', 'Cuota', 'Saldo final', 'Otro'],
    formaPago: ['Efectivo', 'Transferencia', 'Cheque', 'Mercado Pago', 'Otro'],
    moneda: ['ARS', 'USD'],
  },
  egreso: {
    categoria: ['Servicios', 'Bebidas', 'Personal', 'Evento', 'Mantenimiento', 'Materia Prima'],
    moneda: ['ARS', 'USD'],
  },
};

// Sinónimos conocidos → valor oficial. Claves en minúscula.
const SINONIMOS = {
  tipoEvento: { 'cumpleaños de 15': 'XV años', 'quince': 'XV años', '15 años': 'XV años', 'casamiento': 'Boda' },
  origen: { 'recomendacion': 'Referido', 'recomendación': 'Referido' },
};

function oficial(campo, valor, lista) {
  if (typeof valor !== 'string') return valor;
  const v = valor.trim();
  if (!v) return '';
  const min = v.toLowerCase();
  const exacto = lista.find(x => x.toLowerCase() === min);
  if (exacto) return exacto;
  if (SINONIMOS[campo]?.[min]) return SINONIMOS[campo][min];
  // "Cuotas 1, 2, 3" (texto libre de una versión vieja) es un cobro de cuota
  if (campo === 'tipoIngreso' && /^cuotas?\b/i.test(v)) return 'Cuota';
  return v;
}

/* Teléfono argentino en una sola forma: "+54 9 " + los 10 dígitos nacionales
   (código de área + número, sin 0 ni 15). Así "011 15-2345-6789", "1123456789"
   y "+54 9 11 2345 6789" son el mismo teléfono y se detectan duplicados. Los
   espacios hacen que Sheets lo guarde como texto (si no, lo convierte a número).
   Lo que no se puede interpretar (extranjero, fijo sin área) queda como vino. */
function normalizarTelefono(tel) {
  const crudo = String(tel ?? '').trim();
  if (!crudo) return '';
  let n = crudo.replace(/\D/g, '');
  if (crudo.startsWith('+') && !n.startsWith('54')) return crudo;   // extranjero
  n = n.replace(/^00/, '');
  if (n.startsWith('54') && n.length >= 12) n = n.slice(2).replace(/^9/, '');
  n = n.replace(/^0/, '');
  // "15" después del código de área (2 a 4 dígitos): celular en formato local
  if (n.length === 12) {
    for (const k of [2, 3, 4]) {
      if (n.slice(k, k + 2) === '15') { n = n.slice(0, k) + n.slice(k + 2); break; }
    }
  }
  // Ningún código de área empieza con 15: "15 2345 6789" es un celular sin área
  return n.length === 10 && !n.startsWith('15') ? `+54 9 ${n}` : crudo;
}

/* Devuelve una copia con los campos de lista llevados a su valor oficial */
function normalizar(tabla, obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const campos = LISTAS[tabla] || {};
  const nuevo = { ...obj };
  // Datos de contacto (fichas de evento y de persona): una sola forma de escribirlos
  if (typeof nuevo.telefono === 'string') nuevo.telefono = normalizarTelefono(nuevo.telefono);
  if (typeof nuevo.gmail === 'string') nuevo.gmail = nuevo.gmail.trim().toLowerCase();
  for (const [campo, lista] of Object.entries(campos)) {
    if (campo in nuevo) nuevo[campo] = oficial(campo, nuevo[campo], lista);
  }
  return nuevo;
}

/* Error del primer campo con un valor fuera de la lista, o null. Vacío es válido. */
function validar(tabla, obj) {
  const campos = LISTAS[tabla] || {};
  for (const [campo, lista] of Object.entries(campos)) {
    const v = obj?.[campo];
    if (v === undefined || v === null || v === '') continue;
    if (!lista.includes(oficial(campo, v, lista))) return `Valor inválido en "${campo}": "${v}"`;
  }
  return null;
}

/* Para el bot: si la IA devuelve algo fuera de la lista, se usa el valor por defecto */
function oPorDefecto(tabla, campo, valor, porDefecto) {
  const lista = LISTAS[tabla]?.[campo] || [];
  const v = oficial(campo, valor, lista);
  return lista.includes(v) ? v : porDefecto;
}

module.exports = { LISTAS, normalizar, normalizarTelefono, validar, oPorDefecto };
