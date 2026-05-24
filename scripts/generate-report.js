/**
 * Generador de informe semanal — Salón de Eventos
 * Corre cada lunes desde Windows Task Scheduler.
 * Lee Eventos e Ingresos de Google Sheets y guarda un HTML en la carpeta configurada.
 */

'use strict';

const { google } = require('googleapis');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ────────────────────────────────────────────────────────────────
// Configuración
// ────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, 'config.json');
const CRED_PATH   = path.join(__dirname, 'credentials.json');

if (!fs.existsSync(CONFIG_PATH)) { console.error('❌ Falta config.json'); process.exit(1); }
if (!fs.existsSync(CRED_PATH))   { console.error('❌ Falta credentials.json'); process.exit(1); }

const config      = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const credentials = JSON.parse(fs.readFileSync(CRED_PATH,   'utf8'));

const SPREADSHEET_ID = config.spreadsheetId;
const SALON_NAME     = config.nombreSalon || 'Salón de Eventos';
const OUTPUT_DIR     = config.carpetaDestino;

// ────────────────────────────────────────────────────────────────
// Utilidades de fecha
// ────────────────────────────────────────────────────────────────
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MESES_CORTO = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function isoToDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function dateToIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDisplay(d) {
  return `${d.getDate()} de ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

/** Lunes de la semana anterior (semana que se reporta este lunes) */
function getReportWeek() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay();
  const daysFromMon = dow === 0 ? 6 : dow - 1;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - daysFromMon);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);
  return { start: lastMonday, end: lastSunday };
}

/** Últimas N semanas terminando en reportWeek (cronológico) */
function getLastNWeeks(reportWeek, n) {
  const weeks = [];
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(reportWeek.start);
    start.setDate(reportWeek.start.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    weeks.push({ start, end });
  }
  return weeks;
}

function inWeek(dateStr, week) {
  const d = isoToDate(dateStr);
  if (!d) return false;
  return d >= week.start && d <= week.end;
}

function inNext30(dateStr) {
  const d = isoToDate(dateStr);
  if (!d) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  const limit = new Date(today); limit.setDate(today.getDate() + 30);
  return d >= today && d <= limit;
}

// ────────────────────────────────────────────────────────────────
// Google Sheets
// ────────────────────────────────────────────────────────────────
async function fetchSheets() {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const [evRes, perRes, ingRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Eventos!A2:W' }),
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Personas!A2:K' }),
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Ingresos!A2:I' }),
  ]);

  const personasMap = {};
  (perRes.data.values || []).forEach(r => { if (r[0]) personasMap[r[0]] = r[1] || ''; });

  const eventos = (evRes.data.values || []).map(r => ({
    id:             r[0] || '',
    personaId:      r[1] || '',
    estado:         r[2] || '',
    fechaCarga:     r[4] || '',
    tipoEvento:     r[5] || '',
    fechaEvento:    r[7] || '',
    cantInvitados:  parseInt(r[9]) || 0,
    apellidoNombre: personasMap[r[1]] || '',
  }));

  const ingresos = (ingRes.data.values || []).map(r => ({
    tipoIngreso: r[2] || '',
    monto:       parseFloat(r[3]) || 0,
    fecha:       r[4] || '',
    formaPago:   r[5] || '',
    moneda:      r[7] || 'ARS',
    confirmado:  r[8] !== '0',
  })).filter(i => i.confirmado && i.monto > 0);

  return { eventos, ingresos };
}

// ────────────────────────────────────────────────────────────────
// Métricas semanales
// ────────────────────────────────────────────────────────────────
function calcWeekMetrics(eventos, ingresos, week) {
  const ingSem      = ingresos.filter(i => inWeek(i.fecha, week));
  const totalARS    = ingSem.filter(i => i.moneda !== 'USD').reduce((s,i) => s + i.monto, 0);
  const totalUSD    = ingSem.filter(i => i.moneda === 'USD').reduce((s,i) => s + i.monto, 0);
  const porTipo     = {};
  const porPago     = {};
  ingSem.forEach(i => {
    const v = i.moneda === 'USD' ? 0 : i.monto;
    porTipo[i.tipoIngreso] = (porTipo[i.tipoIngreso] || 0) + v;
    porPago[i.formaPago]   = (porPago[i.formaPago]   || 0) + v;
  });
  const nuevasConsultas = eventos.filter(e => inWeek(e.fechaCarga, week)).length;
  const realizados      = eventos.filter(e => e.estado === 'Realizado' && inWeek(e.fechaEvento, week)).length;
  return { totalARS, totalUSD, porTipo, porPago, nuevasConsultas, realizados };
}

// ────────────────────────────────────────────────────────────────
// Métricas anuales e históricas
// ────────────────────────────────────────────────────────────────
function calcAnnualMetrics(eventos, ingresos, reportWeek) {
  const year = reportWeek.start.getFullYear();

  // Datos del año hasta la semana reportada
  const ingYear = ingresos.filter(i => {
    const d = isoToDate(i.fecha);
    return d && d.getFullYear() === year && d <= reportWeek.end;
  });
  const evCarYear = eventos.filter(e => {
    const d = isoToDate(e.fechaCarga);
    return d && d.getFullYear() === year && d <= reportWeek.end;
  });
  const evRealYear = eventos.filter(e => {
    const d = isoToDate(e.fechaEvento);
    return d && d.getFullYear() === year && e.estado === 'Realizado';
  });

  const totalARS        = ingYear.filter(i => i.moneda !== 'USD').reduce((s,i) => s + i.monto, 0);
  const totalUSD        = ingYear.filter(i => i.moneda === 'USD').reduce((s,i) => s + i.monto, 0);
  const eventosRealizados = evRealYear.length;
  const consultasTotal  = evCarYear.length;

  // Totales mensuales (12 entradas, índice = mes)
  const monthlyTotals = Array.from({ length: 12 }, (_, i) => ({ mes: MESES[i], mesCorto: MESES_CORTO[i], totalARS: 0, totalUSD: 0 }));
  ingYear.forEach(i => {
    const d = isoToDate(i.fecha);
    if (!d) return;
    if (i.moneda === 'USD') monthlyTotals[d.getMonth()].totalUSD += i.monto;
    else                    monthlyTotals[d.getMonth()].totalARS += i.monto;
  });

  // Semanas del año hasta reportWeek
  // Arrancamos desde el primer lunes del año (o antes si ene 1 cae a mitad de semana)
  const jan1 = new Date(year, 0, 1);
  const dow1 = jan1.getDay();
  const firstMonday = new Date(jan1);
  firstMonday.setDate(jan1.getDate() - (dow1 === 0 ? 6 : dow1 - 1));

  const semanas = [];
  let cur = new Date(firstMonday);
  while (cur <= reportWeek.end) {
    const start = new Date(cur);
    const end   = new Date(cur); end.setDate(cur.getDate() + 6);
    const ingS  = ingYear.filter(i => { const d = isoToDate(i.fecha); return d && d >= start && d <= end; });
    const arsS  = ingS.filter(i => i.moneda !== 'USD').reduce((s,i) => s + i.monto, 0);
    const cons  = evCarYear.filter(e => { const d = isoToDate(e.fechaCarga); return d && d >= start && d <= end; }).length;
    semanas.push({ start: new Date(start), end: new Date(end), totalARS: arsS, consultas: cons });
    cur.setDate(cur.getDate() + 7);
  }

  // Mejor semana ARS y consultas
  const mejorSemanaARS = semanas.reduce((b, s) => s.totalARS > b.totalARS ? s : b, { totalARS: 0 });
  const mejorSemanaConsultas = semanas.reduce((b, s) => s.consultas > b.consultas ? s : b, { consultas: 0 });

  // Mejor mes ARS
  const mejorMes = monthlyTotals.reduce((b, m, i) => m.totalARS > b.total ? { total: m.totalARS, nombre: MESES[i] } : b, { total: 0, nombre: '' });

  // Promedio semanal (solo semanas con algún ingreso)
  const semanasConData = semanas.filter(s => s.totalARS > 0);
  const promedioSemanalARS = semanasConData.length > 0 ? totalARS / semanasConData.length : 0;

  // Racha de semanas consecutivas con crecimiento (desde la más reciente hacia atrás)
  let streak = 0;
  for (let i = semanas.length - 1; i > 0; i--) {
    if (semanas[i].totalARS > semanas[i - 1].totalARS) streak++;
    else break;
  }

  return {
    year, totalARS, totalUSD, eventosRealizados, consultasTotal,
    monthlyTotals, semanas, mejorSemanaARS, mejorSemanaConsultas,
    mejorMes, promedioSemanalARS, streak,
  };
}

// ────────────────────────────────────────────────────────────────
// Destacados automáticos
// ────────────────────────────────────────────────────────────────
function generateHighlights(reportMet, anual, semana) {
  const items = [];

  // Récord de ingresos del año
  if (anual.mejorSemanaARS.totalARS > 0 && reportMet.totalARS >= anual.mejorSemanaARS.totalARS && reportMet.totalARS > 0) {
    items.push({ icon: '🏆', text: `Esta semana fue la que más ingresos tuvo en todo el año: <strong>${formatARS(reportMet.totalARS)}</strong>`, tipo: 'gold' });
  }

  // Récord de consultas del año
  if (anual.mejorSemanaConsultas.consultas > 0 && reportMet.nuevasConsultas >= anual.mejorSemanaConsultas.consultas && reportMet.nuevasConsultas > 0) {
    items.push({ icon: '✨', text: `Récord de consultas nuevas de la semana en el año: <strong>${reportMet.nuevasConsultas}</strong>`, tipo: 'gold' });
  }

  // Comparación con promedio anual
  if (anual.promedioSemanalARS > 0 && reportMet.totalARS > 0) {
    const pct = Math.round(((reportMet.totalARS - anual.promedioSemanalARS) / anual.promedioSemanalARS) * 100);
    if (pct >= 15) {
      items.push({ icon: '📈', text: `Semana <strong>${pct}% por encima</strong> del promedio anual (${formatARS(Math.round(anual.promedioSemanalARS))}/sem)`, tipo: 'green' });
    } else if (pct <= -15) {
      items.push({ icon: '📉', text: `Semana <strong>${Math.abs(pct)}% por debajo</strong> del promedio anual (${formatARS(Math.round(anual.promedioSemanalARS))}/sem)`, tipo: 'red' });
    }
  }

  // Racha de crecimiento
  if (anual.streak >= 2) {
    items.push({ icon: '🚀', text: `<strong>${anual.streak} semanas consecutivas</strong> con crecimiento en ingresos`, tipo: 'green' });
  }

  // Mejor semana del año (informativa, solo si no es la actual)
  if (anual.mejorSemanaARS.totalARS > 0 && reportMet.totalARS < anual.mejorSemanaARS.totalARS) {
    const ms = anual.mejorSemanaARS;
    const label = ms.start ? `${ms.start.getDate()} ${MESES_CORTO[ms.start.getMonth()]}` : '';
    items.push({ icon: '🥇', text: `La mejor semana del año fue la del <strong>${label}</strong> con ${formatARS(ms.totalARS)}`, tipo: 'neutral' });
  }

  // Mejor mes del año
  if (anual.mejorMes.total > 0) {
    items.push({ icon: '📅', text: `Mejor mes del año: <strong>${anual.mejorMes.nombre}</strong> con ${formatARS(anual.mejorMes.total)}`, tipo: 'neutral' });
  }

  // Total acumulado anual
  items.push({ icon: '💰', text: `Total acumulado ${anual.year}: <strong>${formatARS(anual.totalARS)}</strong>${anual.totalUSD > 0 ? ` + <strong>${formatUSD(anual.totalUSD)}</strong> USD` : ''}`, tipo: 'neutral' });

  return items;
}

// ────────────────────────────────────────────────────────────────
// Pipeline de clientes
// ────────────────────────────────────────────────────────────────
function calcEstados(eventos) {
  const estados = {};
  eventos.filter(e => e.estado !== 'Cancelado' && e.estado !== 'Realizado').forEach(e => {
    estados[e.estado] = (estados[e.estado] || 0) + 1;
  });
  return estados;
}

function upcomingEvents(eventos) {
  return eventos
    .filter(e => e.estado === 'Confirmado' && inNext30(e.fechaEvento))
    .sort((a, b) => a.fechaEvento > b.fechaEvento ? 1 : -1)
    .slice(0, 10);
}

// ────────────────────────────────────────────────────────────────
// SVG Charts
// ────────────────────────────────────────────────────────────────
const COLORS = ['#7C6AF7','#4ECDC4','#FF6B6B','#FFD93D','#6BCB77','#4D96FF'];

/** Barras horizontales — últimas 4 semanas */
function barChart4Weeks(weeks, metricas) {
  const W = 520, H = 160, pad = 40, barW = 60, gap = 20;
  const maxVal = Math.max(...metricas.map(m => m.totalARS), 1);

  const bars = metricas.map((m, i) => {
    const barH = Math.max(Math.round((m.totalARS / maxVal) * (H - pad - 24)), m.totalARS > 0 ? 4 : 0);
    const x = pad + i * (barW + gap);
    const y = H - pad - barH;
    const isLast = i === metricas.length - 1;
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${isLast ? COLORS[0] : '#C4BEFF'}" rx="5"/>
      <text x="${x + barW/2}" y="${y - 5}" text-anchor="middle" font-size="10" fill="#444" font-weight="${isLast ? '700' : '400'}">${formatARS(m.totalARS)}</text>
      <text x="${x + barW/2}" y="${H - pad + 15}" text-anchor="middle" font-size="9" fill="${isLast ? '#7C6AF7' : '#aaa'}" font-weight="${isLast ? '700' : '400'}">${isLast ? 'Esta sem.' : `Sem ${i+1}`}</text>
    `;
  });

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${W}px">
    <line x1="${pad}" y1="${H-pad}" x2="${W-10}" y2="${H-pad}" stroke="#e5e5e5" stroke-width="1"/>
    ${bars.join('')}
  </svg>`;
}

/** Barras verticales — 12 meses del año */
function barChartAnual(monthlyTotals, year) {
  const W = 820, H = 180, padL = 10, padB = 36, barW = 42, gap = 24;
  const maxVal = Math.max(...monthlyTotals.map(m => m.totalARS), 1);
  const nowMonth = new Date().getMonth();

  const bars = monthlyTotals.map((m, i) => {
    const barH = Math.max(Math.round((m.totalARS / maxVal) * (H - padB - 28)), m.totalARS > 0 ? 4 : 0);
    const x = padL + i * (barW + gap);
    const y = H - padB - barH;
    const isCurrent = i === nowMonth;
    const color = isCurrent ? COLORS[0] : (m.totalARS > 0 ? '#C4BEFF' : '#f0f0f0');
    const label = m.totalARS > 0 ? formatARS(m.totalARS) : '';
    const fontSize = m.totalARS >= 1000000 ? '8' : '9';
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${color}" rx="4"/>
      ${label ? `<text x="${x + barW/2}" y="${y - 4}" text-anchor="middle" font-size="${fontSize}" fill="#555" font-weight="${isCurrent ? '700' : '400'}">${label}</text>` : ''}
      <text x="${x + barW/2}" y="${H - padB + 14}" text-anchor="middle" font-size="9" fill="${isCurrent ? '#7C6AF7' : '#aaa'}" font-weight="${isCurrent ? '700' : '400'}">${m.mesCorto}</text>
    `;
  });

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%">
    <line x1="${padL}" y1="${H-padB}" x2="${W}" y2="${H-padB}" stroke="#e5e5e5" stroke-width="1"/>
    ${bars.join('')}
  </svg>`;
}

/** Donut — distribución de ingresos por tipo */
function donutChart(porTipo) {
  const entries = Object.entries(porTipo).filter(([, v]) => v > 0);
  if (!entries.length) return '<p style="color:#999;font-size:13px">Sin ingresos ARS registrados esta semana.</p>';

  const total = entries.reduce((s, [, v]) => s + v, 0);
  const R = 60, cx = 75, cy = 75;
  let angle0 = -Math.PI / 2;
  const slices = entries.map(([label, val], i) => {
    const a = (val / total) * 2 * Math.PI;
    const x1 = cx + R * Math.cos(angle0), y1 = cy + R * Math.sin(angle0);
    const x2 = cx + R * Math.cos(angle0 + a), y2 = cy + R * Math.sin(angle0 + a);
    const s = { path: `M${cx},${cy} L${x1},${y1} A${R},${R} 0 ${a > Math.PI ? 1 : 0},1 ${x2},${y2} Z`, color: COLORS[i % COLORS.length], label, pct: Math.round((val/total)*100), val };
    angle0 += a;
    return s;
  });

  const legend = entries.map(([label, val], i) => `
    <div style="display:flex;align-items:center;gap:7px;margin-bottom:6px;font-size:12px">
      <span style="width:12px;height:12px;border-radius:3px;background:${COLORS[i%COLORS.length]};flex-shrink:0"></span>
      <span><strong>${Math.round((val/total)*100)}%</strong> ${label} <span style="color:#999">(${formatARS(val)})</span></span>
    </div>`).join('');

  return `<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap">
    <svg viewBox="0 0 150 150" xmlns="http://www.w3.org/2000/svg" style="width:120px;flex-shrink:0">
      ${slices.map(s => `<path d="${s.path}" fill="${s.color}"/>`).join('')}
      <circle cx="${cx}" cy="${cy}" r="30" fill="white"/>
    </svg>
    <div>${legend}</div>
  </div>`;
}

// ────────────────────────────────────────────────────────────────
// Formateo
// ────────────────────────────────────────────────────────────────
function formatARS(n) {
  if (!n) return '$0';
  return '$' + Math.round(n).toLocaleString('es-AR');
}
function formatUSD(n) {
  if (!n) return 'U$S 0';
  return 'U$S ' + n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function delta(curr, prev) {
  if (!prev) return '';
  const pct = Math.round(((curr - prev) / prev) * 100);
  const sign = pct >= 0 ? '+' : '';
  const color = pct >= 0 ? '#22c55e' : '#ef4444';
  return `<span style="color:${color};font-size:12px;font-weight:600">${pct >= 0 ? '↑' : '↓'} ${sign}${pct}% vs sem. anterior</span>`;
}

// ────────────────────────────────────────────────────────────────
// HTML
// ────────────────────────────────────────────────────────────────
function buildHTML(semana, fourWeeks, metricas, anual, eventos) {
  const reportMet   = metricas[3];
  const prevMet     = metricas[2];
  const estados     = calcEstados(eventos);
  const proxEvs     = upcomingEvents(eventos);
  const confirmados = eventos.filter(e => e.estado === 'Confirmado').length;
  const highlights  = generateHighlights(reportMet, anual, semana);

  // ── Destacados ──────────────────────────────────────────────
  const colorMap = { gold: '#fef9c3', green: '#f0fdf4', red: '#fef2f2', neutral: '#f8f8ff' };
  const borderMap = { gold: '#fcd34d', green: '#86efac', red: '#fca5a5', neutral: '#ddd8ff' };
  const highlightsHTML = highlights.map(h => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:11px 14px;
                background:${colorMap[h.tipo]};border:1px solid ${borderMap[h.tipo]};
                border-radius:10px;font-size:13px;line-height:1.4">
      <span style="font-size:18px;flex-shrink:0">${h.icon}</span>
      <span>${h.text}</span>
    </div>`).join('');

  // ── Clientes por estado ──────────────────────────────────────
  const estadosHTML = Object.entries(estados).length
    ? Object.entries(estados).map(([est, cant]) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">${est}</td>
             <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600">${cant}</td></tr>`
      ).join('')
    : '<tr><td colspan="2" style="padding:12px;color:#999">Sin datos</td></tr>';

  // ── Próximos eventos ─────────────────────────────────────────
  const proxHTML = proxEvs.length
    ? proxEvs.map(e => {
        const d = isoToDate(e.fechaEvento);
        const label = d ? `${d.getDate()} ${MESES_CORTO[d.getMonth()].toUpperCase()}` : e.fechaEvento;
        return `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-weight:600;color:#7C6AF7">${label}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">${e.apellidoNombre || '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#999;font-size:12px">${e.tipoEvento || '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;color:#555">${e.cantInvitados || '—'} inv.</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="4" style="padding:12px;color:#999">Sin eventos confirmados en los próximos 30 días</td></tr>';

  // ── Tabla de semanas del año (últimas 8) ─────────────────────
  const semanasTabla = anual.semanas.slice(-8).reverse();
  const semanasHTML = semanasTabla.map((s, i) => {
    const esEsta = i === 0;
    const d1 = `${s.start.getDate()} ${MESES_CORTO[s.start.getMonth()]}`;
    const d2 = `${s.end.getDate()} ${MESES_CORTO[s.end.getMonth()]}`;
    const bg = esEsta ? 'background:#f5f3ff' : '';
    const fw = esEsta ? 'font-weight:700' : '';
    return `<tr style="${bg}">
      <td style="padding:7px 12px;border-bottom:1px solid #f5f5f5;${fw}">${d1} – ${d2}${esEsta ? ' <span style="color:#7C6AF7;font-size:10px">(esta)</span>' : ''}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #f5f5f5;text-align:right;${fw}">${formatARS(s.totalARS)}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #f5f5f5;text-align:right;color:#888">${s.consultas}</td>
    </tr>`;
  }).join('');

  const semLabel = `${formatDisplay(semana.start)} al ${formatDisplay(semana.end)}`;
  const genDate  = new Date().toLocaleString('es-AR', { dateStyle: 'full', timeStyle: 'short' });

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Informe Semanal — ${SALON_NAME}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f6f6f9; color: #222; }
  .header { background: linear-gradient(135deg, #7C6AF7 0%, #5B4CF5 100%); color: white; padding: 36px 48px; }
  .header h1 { font-size: 26px; font-weight: 700; margin-bottom: 4px; }
  .header p { opacity: .82; font-size: 14px; }
  .content { max-width: 960px; margin: 0 auto; padding: 30px 24px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 24px; }
  .card { background: white; border-radius: 14px; padding: 20px 18px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .card-label { font-size: 10.5px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: #999; margin-bottom: 6px; }
  .card-value { font-size: 27px; font-weight: 700; color: #222; line-height: 1; margin-bottom: 5px; }
  .card-value.green { color: #22c55e; }
  .card-value.purple { color: #7C6AF7; }
  .card-sub { font-size: 11.5px; color: #888; line-height: 1.4; }
  .section { background: white; border-radius: 14px; padding: 22px 20px; margin-bottom: 18px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .section-title { font-size: 13px; font-weight: 700; color: #555; margin-bottom: 16px; text-transform: uppercase; letter-spacing: .07em; border-bottom: 2px solid #f0f0f0; padding-bottom: 11px; }
  .section-title span { font-size: 10px; font-weight: 500; color: #bbb; text-transform: none; letter-spacing: 0; margin-left: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 7px 12px; font-size: 10.5px; color: #bbb; text-transform: uppercase; letter-spacing: .06em; background: #fafafa; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 18px; }
  .highlights-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px; margin-bottom: 24px; }
  .divider { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: #bbb; margin: 28px 0 16px; padding-bottom: 6px; border-bottom: 1px solid #e8e8e8; }
  .footer { text-align: center; font-size: 11px; color: #ccc; padding: 24px; border-top: 1px solid #eee; margin-top: 8px; }
  @media (max-width: 620px) { .two-col { grid-template-columns: 1fr; } .header { padding: 24px 18px; } }
</style>
</head>
<body>

<div class="header">
  <h1>${SALON_NAME}</h1>
  <p>Informe semanal · ${semLabel}</p>
</div>

<div class="content">

  <!-- ── DESTACADOS ─────────────────────────────────────── -->
  <div class="divider">Destacados de la semana</div>
  <div class="highlights-grid">${highlightsHTML}</div>

  <!-- ── MÉTRICAS CLAVE (semana) ────────────────────────── -->
  <div class="divider">Esta semana</div>
  <div class="cards">
    <div class="card">
      <div class="card-label">Ingresado</div>
      <div class="card-value">${formatARS(reportMet.totalARS)}</div>
      <div class="card-sub">${delta(reportMet.totalARS, prevMet.totalARS)}${reportMet.totalUSD > 0 ? `<br>${formatUSD(reportMet.totalUSD)} USD` : ''}</div>
    </div>
    <div class="card">
      <div class="card-label">Nuevas consultas</div>
      <div class="card-value">${reportMet.nuevasConsultas}</div>
      <div class="card-sub">${delta(reportMet.nuevasConsultas, prevMet.nuevasConsultas)}</div>
    </div>
    <div class="card">
      <div class="card-label">Eventos realizados</div>
      <div class="card-value">${reportMet.realizados}</div>
      <div class="card-sub">esta semana</div>
    </div>
    <div class="card">
      <div class="card-label">Eventos confirmados</div>
      <div class="card-value green">${confirmados}</div>
      <div class="card-sub">pendientes de realizar</div>
    </div>
  </div>

  <!-- ── ÚLTIMAS 4 SEMANAS ──────────────────────────────── -->
  <div class="section">
    <div class="section-title">Ingresos ARS — últimas 4 semanas</div>
    ${barChart4Weeks(fourWeeks, metricas)}
  </div>

  <div class="two-col">
    <div class="section">
      <div class="section-title">Distribución por tipo</div>
      ${donutChart(reportMet.porTipo)}
    </div>
    <div class="section">
      <div class="section-title">Clientes activos por estado</div>
      <table>
        <thead><tr><th>Estado</th><th style="text-align:right">Cant.</th></tr></thead>
        <tbody>${estadosHTML}</tbody>
      </table>
    </div>
  </div>

  <!-- ── ANÁLISIS ANUAL ─────────────────────────────────── -->
  <div class="divider">Balance del año ${anual.year}</div>
  <div class="cards">
    <div class="card">
      <div class="card-label">Total recaudado ${anual.year}</div>
      <div class="card-value purple">${formatARS(anual.totalARS)}</div>
      <div class="card-sub">${anual.totalUSD > 0 ? `+ ${formatUSD(anual.totalUSD)} USD` : `en ${anual.semanas.filter(s => s.totalARS > 0).length} semanas activas`}</div>
    </div>
    <div class="card">
      <div class="card-label">Promedio por semana</div>
      <div class="card-value">${formatARS(Math.round(anual.promedioSemanalARS))}</div>
      <div class="card-sub">en semanas con actividad</div>
    </div>
    <div class="card">
      <div class="card-label">Consultas en el año</div>
      <div class="card-value">${anual.consultasTotal}</div>
      <div class="card-sub">nuevos clientes ingresados</div>
    </div>
    <div class="card">
      <div class="card-label">Eventos realizados ${anual.year}</div>
      <div class="card-value">${anual.eventosRealizados}</div>
      <div class="card-sub">fiestas completadas</div>
    </div>
  </div>

  <!-- Gráfico mensual del año -->
  <div class="section">
    <div class="section-title">Ingresos ARS por mes — ${anual.year} <span>(mes actual resaltado)</span></div>
    ${barChartAnual(anual.monthlyTotals, anual.year)}
  </div>

  <!-- Tabla: últimas 8 semanas del año -->
  <div class="section">
    <div class="section-title">Últimas 8 semanas del año</div>
    <table>
      <thead><tr><th>Período</th><th style="text-align:right">Ingresos ARS</th><th style="text-align:right">Consultas</th></tr></thead>
      <tbody>${semanasHTML}</tbody>
    </table>
  </div>

  <!-- ── PRÓXIMOS EVENTOS ───────────────────────────────── -->
  <div class="divider">Agenda</div>
  <div class="section">
    <div class="section-title">Próximos eventos confirmados <span>30 días</span></div>
    <table>
      <thead><tr><th>Fecha</th><th>Cliente</th><th>Tipo</th><th style="text-align:right">Invitados</th></tr></thead>
      <tbody>${proxHTML}</tbody>
    </table>
  </div>

</div>

<div class="footer">
  Generado automáticamente el ${genDate} · ${SALON_NAME}
</div>

</body>
</html>`;
}

// ────────────────────────────────────────────────────────────────
// Guardar archivo
// ────────────────────────────────────────────────────────────────
function saveReport(html, semana) {
  const year   = semana.start.getFullYear();
  const month  = semana.start.getMonth();
  const dir    = path.join(OUTPUT_DIR, String(year), `${String(month+1).padStart(2,'0')} - ${MESES[month]}`);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `Informe_${dateToIso(semana.start)}_al_${dateToIso(semana.end)}.html`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, html, 'utf8');
  return filePath;
}

// ────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────
async function main() {
  console.log('📊 Generando informe semanal...');

  const semana    = getReportWeek();
  const fourWeeks = getLastNWeeks(semana, 4);
  console.log(`  Semana: ${dateToIso(semana.start)} → ${dateToIso(semana.end)}`);

  const { eventos, ingresos } = await fetchSheets();
  console.log(`  Datos: ${eventos.length} eventos, ${ingresos.length} ingresos confirmados.`);

  const metricas = fourWeeks.map(w => calcWeekMetrics(eventos, ingresos, w));
  const anual    = calcAnnualMetrics(eventos, ingresos, semana);
  const html     = buildHTML(semana, fourWeeks, metricas, anual, eventos);
  const filePath = saveReport(html, semana);

  console.log(`✅ Informe guardado en:\n   ${filePath}`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
