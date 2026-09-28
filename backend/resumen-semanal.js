/* Resumen semanal para Lautaro (lunes a la mañana, un solo mensaje).

   Datos con problemas + borradores del bot olvidados + una línea de salud.
   Semana limpia = "✅ Semana sin problemas". Lo dispara el Apps Script del
   backup (scripts/backup-planilla.gs) llamando a /api/avisos/resumen-semanal:
   Render gratis se duerme y no puede despertarse solo a una hora fija.

   construirResumen() es pura (sin red): recibe los datos y devuelve el texto. */

const listas = require('./listas');

const DIA_MS = 24 * 3600 * 1000;
const fechaDe = s => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};

function construirResumen({ eventos = [], ingresos = [], egresos = [], backups = null, hoy = new Date() }) {
  const hace7 = new Date(hoy.getTime() - 7 * DIA_MS);
  const problemas = [];
  const linea = (n, texto, ejemplos) => {
    if (!n) return;
    const ej = ejemplos.filter(Boolean).slice(0, 3).join(', ');
    problemas.push(`• ${n} ${texto}${ej ? ` (${ej}${n > 3 ? '…' : ''})` : ''}`);
  };

  // Datos con problemas
  const cobrosSinEvento = ingresos.filter(i => !i.idCliente && i.confirmado !== false);
  linea(cobrosSinEvento.length, 'cobro(s) confirmado(s) sin evento', cobrosSinEvento.map(i => `$${i.monto} del ${i.fecha}`));
  const sinFecha = eventos.filter(e => ['Confirmado', 'Realizado'].includes(e.estado) && !e.fechaEvento);
  linea(sinFecha.length, 'evento(s) confirmado(s) sin fecha', sinFecha.map(e => e.apellidoNombre));

  const fueraDeLista = [];
  for (const e of eventos) { const err = listas.validar('evento', e); if (err) fueraDeLista.push(`${e.apellidoNombre}: ${err}`); }
  for (const i of ingresos) { const err = listas.validar('ingreso', i); if (err) fueraDeLista.push(`cobro ${i.id}: ${err}`); }
  for (const g of egresos) { const err = listas.validar('egreso', g); if (err) fueraDeLista.push(`gasto ${g.id}: ${err}`); }
  linea(fueraDeLista.length, 'valor(es) fuera de las listas (escritos a mano en la planilla)', fueraDeLista);

  const duplicados = [];
  for (const [nombre, filas] of [['Eventos', eventos], ['Ingresos', ingresos], ['Egresos', egresos]]) {
    const vistos = new Set();
    for (const f of filas) { if (vistos.has(f.id)) duplicados.push(`${nombre} ${f.id}`); vistos.add(f.id); }
  }
  linea(duplicados.length, 'id(s) repetido(s)', duplicados);

  // Borradores del bot olvidados en "Por confirmar"
  const viejo = x => { const f = fechaDe(x.creadoEn || x.fecha); return f && f < hace7; };
  const borradores = [...ingresos, ...egresos].filter(x => x.confirmado === false && viejo(x));
  linea(borradores.length, 'borrador(es) del bot con más de 7 días sin confirmar', borradores.map(x => x.cliente || x.concepto));

  if (backups !== null && backups < 7) problemas.push(`• Solo ${backups} backup(s) en la semana (tendrían que ser 7)`);

  // Salud: qué se cargó en la semana
  const deLaSemana = (filas, campo) => filas.filter(x => { const f = fechaDe(x[campo]); return f && f >= hace7; }).length;
  const salud = `Semana: ${deLaSemana(eventos, 'fechaCarga')} consultas nuevas, ${deLaSemana(ingresos, 'creadoEn')} cobros y ${deLaSemana(egresos, 'creadoEn')} gastos cargados`
    + (backups !== null ? `, ${backups} backups` : '') + '.';

  return problemas.length
    ? `📋 Resumen semanal\n\n${problemas.join('\n')}\n\n${salud}`
    : `📋 Resumen semanal\n✅ Semana sin problemas.\n${salud}`;
}

module.exports = { construirResumen };
