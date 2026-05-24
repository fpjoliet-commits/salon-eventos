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

if (!fs.existsSync(CONFIG_PATH)) {
  console.error('❌ Falta config.json en la carpeta scripts/');
  process.exit(1);
}
if (!fs.existsSync(CRED_PATH)) {
  console.error('❌ Falta credentials.json en la carpeta scripts/');
  process.exit(1);
}

const config      = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const credentials = JSON.parse(fs.readFileSync(CRED_PATH,   'utf8'));

const SPREADSHEET_ID = config.spreadsheetId;
const SALON_NAME     = config.nombreSalon || 'Salón de Eventos';
const OUTPUT_DIR     = config.carpetaDestino;          // Ruta base en el escritorio del padre

// ────────────────────────────────────────────────────────────────
// Utilidades de fecha
// ────────────────────────────────────────────────────────────────
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function isoToDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function dateToIso(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function formatDisplay(d) {
  return `${d.getDate()} de ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

/** Semana anterior completa (lun-dom) */
function getReportWeek() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay(); // 0=dom, 1=lun, ...
  const daysFromMon = dow === 0 ? 6 : dow - 1;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - daysFromMon);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);
  return { start: lastMonday, end: lastSunday };
}

/** Devuelve las 4 semanas terminadas en `endDate` (la más reciente primero si reverse=true) */
function getFourWeeks(reportWeek) {
  const weeks = [];
  for (let i = 3; i >= 0; i--) {
    const start = new Date(reportWeek.start);
    start.setDate(reportWeek.start.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    weeks.push({ start, end });
  }
  return weeks; // cronológico, última semana = weeks[3]
}

function inWeek(dateStr, week) {
  const d = isoToDate(dateStr);
  if (!d) return false;
  return d >= week.start && d <= week.end;
}

function inNext30(dateStr) {
  const d = isoToDate(dateStr);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const limit = new Date(today);
  limit.setDate(today.getDate() + 30);
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
  (perRes.data.values || []).forEach(r => {
    const id = r[0] || '';
    if (id) personasMap[id] = r[1] || '';
  });

  const eventos = (evRes.data.values || []).map(r => ({
    id:              r[0] || '',
    personaId:       r[1] || '',
    estado:          r[2] || '',
    fechaCarga:      r[4] || '',
    tipoEvento:      r[5] || '',
    fechaEvento:     r[7] || '',
    cantInvitados:   parseInt(r[9]) || 0,
    apellidoNombre:  personasMap[r[1]] || '',
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
// Métricas
// ────────────────────────────────────────────────────────────────
function calcWeekMetrics(eventos, ingresos, week) {
  const ingSemana = ingresos.filter(i => inWeek(i.fecha, week));
  const totalARS  = ingSemana.filter(i => i.moneda !== 'USD').reduce((s, i) => s + i.monto, 0);
  const totalUSD  = ingSemana.filter(i => i.moneda === 'USD').reduce((s, i) => s + i.monto, 0);

  // Distribución por tipo
  const porTipo = {};
  ingSemana.forEach(i => {
    porTipo[i.tipoIngreso] = (porTipo[i.tipoIngreso] || 0) + (i.moneda === 'USD' ? 0 : i.monto);
  });

  // Distribución por forma de pago
  const porPago = {};
  ingSemana.forEach(i => {
    porPago[i.formaPago] = (porPago[i.formaPago] || 0) + (i.moneda === 'USD' ? 0 : i.monto);
  });

  // Nuevas consultas (fechaCarga en esa semana, cualquier estado)
  const nuevasConsultas = eventos.filter(e => inWeek(e.fechaCarga, week)).length;

  // Eventos realizados en esa semana
  const realizados = eventos.filter(e => e.estado === 'Realizado' && inWeek(e.fechaEvento, week)).length;

  return { totalARS, totalUSD, porTipo, porPago, nuevasConsultas, realizados };
}

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
    .sort((a, b) => (a.fechaEvento > b.fechaEvento ? 1 : -1))
    .slice(0, 10);
}

// ────────────────────────────────────────────────────────────────
// SVG Charts
// ────────────────────────────────────────────────────────────────
const COLORS = ['#7C6AF7','#4ECDC4','#FF6B6B','#FFD93D','#6BCB77','#4D96FF'];

function barChart(weeks, metricas) {
  const W = 520, H = 160, pad = 40, barW = 60, gap = 20;
  const maxVal = Math.max(...metricas.map(m => m.totalARS), 1);

  const bars = metricas.map((m, i) => {
    const barH = Math.round(((m.totalARS / maxVal) * (H - pad - 20)));
    const x    = pad + i * (barW + gap);
    const y    = H - pad - barH;
    const label = `Sem ${i + 1}`;
    const money  = formatARS(m.totalARS);
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${COLORS[0]}" rx="5" opacity="${i === 3 ? 1 : 0.55}"/>
      <text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" font-size="10" fill="#444" font-weight="${i === 3 ? '700' : '400'}">${money}</text>
      <text x="${x + barW / 2}" y="${H - pad + 15}" text-anchor="middle" font-size="9" fill="#888">${i === 3 ? 'Esta sem.' : label}</text>
    `;
  });

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${W}px">
    <line x1="${pad}" y1="${H - pad}" x2="${W - 10}" y2="${H - pad}" stroke="#e5e5e5" stroke-width="1"/>
    ${bars.join('')}
  </svg>`;
}

function donutChart(porTipo) {
  const entries = Object.entries(porTipo).filter(([, v]) => v > 0);
  if (!entries.length) return '<p style="color:#999;font-size:13px">Sin ingresos registrados esta semana.</p>';

  const total = entries.reduce((s, [, v]) => s + v, 0);
  const R = 60, cx = 75, cy = 75;
  let startAngle = -Math.PI / 2;
  const slices = [];

  entries.forEach(([label, val], i) => {
    const angle = (val / total) * 2 * Math.PI;
    const x1 = cx + R * Math.cos(startAngle);
    const y1 = cy + R * Math.sin(startAngle);
    const x2 = cx + R * Math.cos(startAngle + angle);
    const y2 = cy + R * Math.sin(startAngle + angle);
    const large = angle > Math.PI ? 1 : 0;
    const pct = Math.round((val / total) * 100);
    slices.push({ path: `M${cx},${cy} L${x1},${y1} A${R},${R} 0 ${large},1 ${x2},${y2} Z`, color: COLORS[i % COLORS.length], label, pct, val });
    startAngle += angle;
  });

  const legend = entries.map(([label, val], i) => {
    const pct = Math.round((val / total) * 100);
    return `<div style="display:flex;align-items:center;gap:7px;margin-bottom:6px;font-size:12px">
      <span style="width:12px;height:12px;border-radius:3px;background:${COLORS[i % COLORS.length]};flex-shrink:0"></span>
      <span><strong>${pct}%</strong> ${label} <span style="color:#999">(${formatARS(val)})</span></span>
    </div>`;
  }).join('');

  return `<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap">
    <svg viewBox="0 0 150 150" xmlns="http://www.w3.org/2000/svg" style="width:130px;flex-shrink:0">
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
  const arrow = pct >= 0 ? '↑' : '↓';
  return `<span style="color:${color};font-size:13px;font-weight:600">${arrow} ${sign}${pct}% vs semana anterior</span>`;
}

// ────────────────────────────────────────────────────────────────
// HTML
// ────────────────────────────────────────────────────────────────
function buildHTML(semana, fourWeeks, metricas, eventos) {
  const reportMet  = metricas[3];  // semana reportada
  const prevMet    = metricas[2];  // semana anterior
  const estados    = calcEstados(eventos);
  const proxEvs    = upcomingEvents(eventos);
  const confirmados = eventos.filter(e => e.estado === 'Confirmado').length;

  const estadosHTML = Object.entries(estados).length
    ? Object.entries(estados).map(([est, cant]) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">${est}</td>
             <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600">${cant}</td></tr>`
      ).join('')
    : '<tr><td colspan="2" style="padding:12px;color:#999">Sin datos</td></tr>';

  const proxHTML = proxEvs.length
    ? proxEvs.map(e => {
        const d = isoToDate(e.fechaEvento);
        const label = d ? `${d.getDate()} ${MESES[d.getMonth()].slice(0,3).toUpperCase()}` : e.fechaEvento;
        return `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-weight:600;color:#7C6AF7">${label}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">${e.apellidoNombre || '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#999;font-size:12px">${e.tipoEvento || '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;color:#555">${e.cantInvitados || '—'} inv.</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="4" style="padding:12px;color:#999">Sin eventos confirmados en los próximos 30 días</td></tr>';

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
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f6f6f9; color: #222; min-height: 100vh; }
  .header { background: linear-gradient(135deg, #7C6AF7 0%, #5B4CF5 100%); color: white; padding: 36px 48px; }
  .header h1 { font-size: 26px; font-weight: 700; margin-bottom: 4px; }
  .header p { opacity: .85; font-size: 14px; }
  .content { max-width: 900px; margin: 0 auto; padding: 32px 24px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 28px; }
  .card { background: white; border-radius: 14px; padding: 22px 20px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .card-label { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #999; margin-bottom: 6px; }
  .card-value { font-size: 28px; font-weight: 700; color: #222; line-height: 1; margin-bottom: 6px; }
  .card-value.green { color: #22c55e; }
  .card-sub { font-size: 12px; color: #888; }
  .section { background: white; border-radius: 14px; padding: 24px 22px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .section-title { font-size: 14px; font-weight: 700; color: #444; margin-bottom: 18px; text-transform: uppercase; letter-spacing: .06em; border-bottom: 2px solid #f0f0f0; padding-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 12px; font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: .06em; background: #fafafa; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
  @media (max-width: 600px) { .two-col { grid-template-columns: 1fr; } .header { padding: 24px 20px; } }
  .footer { text-align: center; font-size: 11px; color: #bbb; padding: 24px; border-top: 1px solid #eee; margin-top: 8px; }
  .badge { display: inline-block; padding: 3px 9px; border-radius: 20px; font-size: 10px; font-weight: 700; }
</style>
</head>
<body>

<div class="header">
  <h1>${SALON_NAME}</h1>
  <p>Informe semanal · ${semLabel}</p>
</div>

<div class="content">

  <!-- Cards métricas clave -->
  <div class="cards">
    <div class="card">
      <div class="card-label">Ingresado esta semana</div>
      <div class="card-value">${formatARS(reportMet.totalARS)}</div>
      <div class="card-sub">${delta(reportMet.totalARS, prevMet.totalARS)}${reportMet.totalUSD > 0 ? `<br>${formatUSD(reportMet.totalUSD)} USD` : ''}</div>
    </div>
    <div class="card">
      <div class="card-label">Eventos confirmados</div>
      <div class="card-value green">${confirmados}</div>
      <div class="card-sub">para los próximos meses</div>
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
  </div>

  <!-- Gráfico de barras: últimas 4 semanas -->
  <div class="section">
    <div class="section-title">Ingresos ARS — últimas 4 semanas</div>
    ${barChart(fourWeeks, metricas)}
  </div>

  <div class="two-col">
    <!-- Torta: distribución por tipo -->
    <div class="section">
      <div class="section-title">Distribución por tipo</div>
      ${donutChart(reportMet.porTipo)}
    </div>

    <!-- Estado del pipeline -->
    <div class="section">
      <div class="section-title">Clientes activos por estado</div>
      <table>
        <thead><tr><th>Estado</th><th style="text-align:right">Cant.</th></tr></thead>
        <tbody>${estadosHTML}</tbody>
      </table>
    </div>
  </div>

  <!-- Próximos eventos -->
  <div class="section">
    <div class="section-title">Próximos eventos confirmados (30 días)</div>
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
  const year  = semana.start.getFullYear();
  const month = semana.start.getMonth();       // 0-indexed
  const mesNum  = String(month + 1).padStart(2, '0');
  const mesNom  = MESES[month];

  const dir = path.join(OUTPUT_DIR, String(year), `${mesNum} - ${mesNom}`);
  fs.mkdirSync(dir, { recursive: true });

  const isoStart = dateToIso(semana.start);
  const isoEnd   = dateToIso(semana.end);
  const fileName = `Informe_${isoStart}_al_${isoEnd}.html`;
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
  const fourWeeks = getFourWeeks(semana);

  console.log(`  Semana a reportar: ${dateToIso(semana.start)} → ${dateToIso(semana.end)}`);

  const { eventos, ingresos } = await fetchSheets();
  console.log(`  Datos cargados: ${eventos.length} eventos, ${ingresos.length} ingresos.`);

  const metricas = fourWeeks.map(w => calcWeekMetrics(eventos, ingresos, w));
  const html     = buildHTML(semana, fourWeeks, metricas, eventos);
  const filePath = saveReport(html, semana);

  console.log(`✅ Informe guardado en:\n   ${filePath}`);
}

main().catch(err => {
  console.error('❌ Error al generar informe:', err.message);
  process.exit(1);
});
