/* ===================== CONFIG ===================== */
const API = '/api';

/* ===================== STATE ===================== */
let currentUser = null;
let token = null;
let allClientes = [];
let allPersonas = [];
let currentClienteModal = null;
let currentRestricciones = [];
let calYear, calMonth;

/* ===================== UTILS ===================== */
const $ = id => document.getElementById(id);
const show = id => $(`${id}`)?.classList.remove('hidden');
const hide = id => $(`${id}`)?.classList.add('hidden');
const showEl = el => el?.classList.remove('hidden');
const hideEl = el => el?.classList.add('hidden');

function formatDate(str) {
  if (!str) return '—';
  if (str.includes('-') && str.length === 10) {
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
  }
  return str;
}

const DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

// Marcador para sugerencias de Empleado almacenadas en observaciones
const SUGERENCIA_REGEX = /\[SUGERENCIA_NOMBRE: "([^"]+)" · [^\]]+\]\n?/;

function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatDateWithDay(str) {
  if (!str) return '—';
  if (str.includes('-') && str.length === 10) {
    const [y, m, d] = str.split('-');
    const dia = DIAS[new Date(+y, +m - 1, +d).getDay()];
    return `${d}/${m}/${y} — ${dia}`;
  }
  return str;
}

function formatMoney(n) {
  if (!n && n !== 0) return '—';
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n);
}

function formatMoneda(n, moneda) {
  if (moneda === 'USD') {
    if (!n && n !== 0) return '—';
    return `U$S ${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
  return formatMoney(n);
}

function estadoBadge(estado) {
  const map = {
    'Consulta': 'badge-consulta',
    'Visita agendada': 'badge-visita',
    'Por cerrar': 'badge-cerrar',
    'Confirmado': 'badge-confirmado',
    'Realizado': 'badge-realizado',
    'Cancelado': 'badge-cancelado',
  };
  const cls = map[estado] || '';
  return `<span class="badge ${cls}">${estado || '—'}</span>`;
}

function seguimientoClass(dateStr) {
  if (!dateStr) return '';
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const d = new Date(dateStr); d.setHours(0,0,0,0);
  const diff = (d - hoy) / 86400000;
  if (diff < 0) return 'seguimiento-urgente';
  if (diff === 0) return 'seguimiento-hoy';
  if (diff <= 3) return 'seguimiento-ok';
  return '';
}

function parseFechaCarga(str) {
  if (!str) return null;
  if (str.includes('/')) {
    const [d, m, y] = str.split('/');
    const date = new Date(+y, +m - 1, +d); date.setHours(0,0,0,0);
    return isNaN(date.getTime()) ? null : date;
  }
  if (str.includes('-')) {
    const date = new Date(str); date.setHours(0,0,0,0);
    return isNaN(date.getTime()) ? null : date;
  }
  return null;
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (res.status === 401) {
    clearSession();
    hide('app');
    show('login-screen');
    $('login-form').reset();
    throw new Error('Sesión expirada. Por favor, ingresá nuevamente.');
  }
  if (!res.ok) throw new Error(data.error || 'Error del servidor');
  return data;
}

/* ===================== AUTH ===================== */
function saveSession(tok, user) {
  token = tok;
  currentUser = user;
  localStorage.setItem('crm_token', tok);
  localStorage.setItem('crm_user', JSON.stringify(user));
}

function clearSession() {
  token = null; currentUser = null;
  localStorage.removeItem('crm_token');
  localStorage.removeItem('crm_user');
}

function isSuperAdmin() { return currentUser?.role === 'superadmin'; }
function isAdmin() { return currentUser?.role === 'admin' || currentUser?.role === 'superadmin'; }
function canManagePagos() { return isAdmin(); }
function canEditNombre() { return isAdmin(); }

// Usuarios sin contraseña
const USUARIOS_SIN_PASSWORD = [];

$('login-usuario').addEventListener('change', () => {
  const usuario = $('login-usuario').value;
  const grupo = $('password-group');
  const input = $('login-password');
  if (USUARIOS_SIN_PASSWORD.includes(usuario)) {
    grupo.style.display = 'none';
    input.value = '';
  } else {
    grupo.style.display = '';
  }
});

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const usuario = $('login-usuario').value;
  const password = $('login-password').value;
  hide('login-error');
  try {
    const data = await apiFetch('/login', { method: 'POST', body: { usuario, password } });
    saveSession(data.token, { usuario: data.usuario, role: data.role });
    initApp();
  } catch (err) {
    $('login-error').textContent = err.message;
    show('login-error');
  }
});

$('logout-btn').addEventListener('click', () => {
  clearSession();
  hide('app');
  show('login-screen');
  $('login-form').reset();
});

/* ===================== INIT APP ===================== */
async function checkStatus() {
  try {
    const s = await apiFetch('/status');
    if (!s.googleSheets) show('demo-banner');
  } catch {}
}

function initApp() {
  hide('login-screen');
  show('app');
  checkStatus();

  $('sidebar-user').textContent = currentUser.usuario;
  $('sidebar-role').textContent = isSuperAdmin() ? 'Super Admin' : isAdmin() ? 'Admin' : 'EMPLEADO';

  // Mostrar/ocultar items de nav según rol
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin() ? '' : 'none';
  });

  // Opciones solo para superadmin (ej: Materia Prima en egresos)
  document.querySelectorAll('.superadmin-only').forEach(el => {
    el.style.display = isSuperAdmin() ? '' : 'none';
  });

  // Timing Planner: visible para admin y superadmin
  document.querySelectorAll('.nav-item[data-view="timing-global"]').forEach(el => {
    el.style.display = isAdmin() ? '' : 'none';
  });

  loadClientes();
  loadPersonas();
  navigateTo('calendario');
}

/* ===================== NAVIGATION ===================== */
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(item.dataset.view);
  });
});

$('btn-nuevo-cliente')?.addEventListener('click', () => navigateTo('nuevo-cliente'));

function navigateTo(view) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  const navItem = document.querySelector(`.nav-item[data-view="${view}"]`);
  const section = $(`view-${view}`);
  if (navItem) navItem.classList.add('active');
  if (section) { section.classList.remove('hidden'); section.classList.add('active'); }

if (view === 'calendario') loadCalendario();
  if (view === 'nuevo-cliente' && !$('edit-row-index').value) resetNuevoClienteForm();
  if (view === 'timing-global') initTimingGlobal();
  if (view === 'propuesta') initPropuesta();
  if (view === 'egresos') initEgresos();
  if (view === 'egresos-cocina') { navigateTo('cocina'); switchCocinaTab('compras'); return; }
  if (view === 'seguimientos') initSeguimientos();
  if (view === 'cocina') loadCocina();
}

/* ===================== TIMING PLANNER GLOBAL ===================== */
function initTimingGlobal() {
  const sel = $('timing-cliente-select');
  const content = $('timing-global-content');
  if (!sel || !content) return;

  // Llenar select con clientes ordenados
  const clientes = [...allClientes].sort((a, b) =>
    (a.apellidoNombre || '').localeCompare(b.apellidoNombre || '')
  );
  sel.innerHTML = '<option value="">-- Seleccioná un cliente --</option>' +
    clientes.map(c => {
      const fecha = c.fechaEvento ? ` (${formatDate(c.fechaEvento)})` : '';
      return `<option value="${c.id}">${esc(c.apellidoNombre)}${fecha}</option>`;
    }).join('');

  content.innerHTML = '';

  // Evitar re-bind si ya estaba inicializado
  sel.onchange = async () => {
    const id = sel.value;
    if (!id) { content.innerHTML = ''; return; }
    const cliente = allClientes.find(c => c.id === id);
    if (!cliente) return;
    content.innerHTML = '<div id="timming-content"></div>';
    await loadTimmingTab(cliente);
  };
}


/* ===================== PERSONAS ===================== */
async function loadPersonas() {
  try { allPersonas = await apiFetch('/personas'); } catch {}
}

/* ===================== RECORDATORIOS ===================== */
function calcReminders() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const en7 = new Date(today); en7.setDate(en7.getDate() + 7);

  const visitasHoy = allClientes.filter(c =>
    c.estado === 'Visita agendada' && c.proximoSeguimiento === todayStr
  );

  const tareasVencidas = allClientes.filter(c => {
    if (c.estado === 'Cancelado' || c.estado === 'Realizado') return false;
    if (!c.proximoSeguimiento) return false;
    const d = new Date(c.proximoSeguimiento); d.setHours(0, 0, 0, 0);
    return d < today;
  });

  const tareasSemana = allClientes.filter(c => {
    if (c.estado === 'Cancelado' || c.estado === 'Realizado') return false;
    if (!c.proximoSeguimiento) return false;
    const d = new Date(c.proximoSeguimiento); d.setHours(0, 0, 0, 0);
    return d >= today && d <= en7;
  });

  return { visitasHoy, tareasVencidas, tareasSemana };
}

function renderRemindersBar() {
  const bar = $('reminders-bar');
  if (!bar) return;
  const { visitasHoy, tareasVencidas, tareasSemana } = calcReminders();
  if (!visitasHoy.length && !tareasVencidas.length && !tareasSemana.length) {
    bar.innerHTML = ''; bar.classList.add('hidden'); return;
  }

  let html = '<div class="reminders-inner">';

  if (tareasVencidas.length) {
    html += `<div class="reminder-item reminder-urgente" onclick="navigateTo('calendario')">
      <span class="reminder-icon">🔴</span>
      <strong>${tareasVencidas.length} seguimiento${tareasVencidas.length > 1 ? 's' : ''} vencido${tareasVencidas.length > 1 ? 's' : ''}</strong>
    </div>`;
  }

  if (tareasSemana.length) {
    html += `<div class="reminder-item reminder-semana" onclick="navigateTo('calendario')">
      <span class="reminder-icon">📋</span>
      <strong>${tareasSemana.length} tarea${tareasSemana.length > 1 ? 's' : ''} esta semana</strong>
    </div>`;
  }

  if (visitasHoy.length) {
    const ids = visitasHoy.map(c => `'${c.id}'`).join(',');
    html += `<div class="reminder-item reminder-visita" onclick="filterReminder([${ids}])">
      <span class="reminder-icon">📅</span>
      <strong>Visitas hoy:</strong>&nbsp;${visitasHoy.length} cliente${visitasHoy.length > 1 ? 's' : ''}
    </div>`;
  }

  html += '</div>';
  bar.innerHTML = html;
  bar.classList.remove('hidden');
}

window.filterReminder = (ids) => {
  navigateTo('clientes');
  const filtered = allClientes.filter(c => ids.includes(c.id));
  renderClientes(filtered);
};

window.abrirClientePorId = (id) => {
  const c = allClientes.find(x => x.id === id);
  if (c) openClienteModal(c);
};

/* ===================== CLIENTES ===================== */
async function loadClientes() {
  $('clientes-loading').style.display = 'block';
  hide('clientes-table-wrap');
  hide('clientes-error');
  hide('clientes-empty');

  try {
    allClientes = await apiFetch('/clientes');
    renderClientes(allClientes);
    renderRemindersBar();
    renderSeguimientosPanel();
    if (allClientes.length === 0 && canManagePagos()) mostrarBannerMigracion();
  } catch (err) {
    $('clientes-error').textContent = err.message;
    show('clientes-error');
  } finally {
    $('clientes-loading').style.display = 'none';
  }
}

function mostrarBannerMigracion() {
  const empty = $('clientes-empty');
  if (!empty) return;
  empty.innerHTML = `
    <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:10px;padding:20px 24px;max-width:520px;margin:24px auto;text-align:center">
      <p style="font-weight:700;font-size:15px;margin-bottom:8px">⚠️ No hay clientes cargados</p>
      <p style="font-size:13px;color:#555;margin-bottom:16px">
        Si ya tenías clientes cargados antes de la actualización, hacé click en el botón para migrar los datos al nuevo formato.
      </p>
      <button id="btn-migrar" class="btn btn-primary">Migrar datos de clientes</button>
      <p id="migrar-msg" style="margin-top:12px;font-size:13px;color:#555"></p>
    </div>`;
  $('btn-migrar').addEventListener('click', async () => {
    const btn = $('btn-migrar');
    const msg = $('migrar-msg');
    btn.disabled = true;
    btn.textContent = 'Migrando…';
    try {
      const res = await apiFetch('/migrar-clientes', { method: 'POST' });
      msg.textContent = `✅ ${res.migradas} cliente${res.migradas !== 1 ? 's' : ''} migrado${res.migradas !== 1 ? 's' : ''}. Recargando…`;
      setTimeout(() => loadClientes(), 1500);
    } catch (e) {
      msg.style.color = '#c0392b';
      msg.textContent = '❌ ' + e.message;
      btn.disabled = false;
      btn.textContent = 'Reintentar';
    }
  });
}

function renderClientes(clientes) {
  renderStats(clientes);
  const tbody = $('clientes-tbody');
  tbody.innerHTML = '';

  if (clientes.length === 0) {
    show('clientes-empty');
    return;
  }
  hide('clientes-empty');

  // Agrupar por personaId (o por teléfono si no hay personaId) manteniendo orden de primera aparición
  const grupKey = c => c.personaId || c.telefono || c.id;
  const grupos = {};
  const orden = [];
  clientes.forEach(c => {
    const k = grupKey(c);
    if (!grupos[k]) { grupos[k] = []; orden.push(k); }
    grupos[k].push(c);
  });
  // Dentro de cada grupo: orden cronológico por fechaEvento
  Object.values(grupos).forEach(g => {
    g.sort((a, b) => (a.fechaEvento || '').localeCompare(b.fechaEvento || ''));
  });

  orden.forEach(k => {
    const grupo = grupos[k];
    grupo.forEach((c, idx) => {
      const tr = document.createElement('tr');
      const segClass = seguimientoClass(c.proximoSeguimiento);
      const isGroup = grupo.length > 1;
      const isCont = isGroup && idx > 0;

      if (isGroup) tr.classList.add(isCont ? 'grupo-cont' : 'grupo-first');
      if (c.estado === 'Confirmado') tr.classList.add('tr-confirmado');
      else if (c.estado === 'Por cerrar') tr.classList.add('tr-por-cerrar');

      const nameCell = isCont
        ? `<span class="grupo-cont-icon">└</span> <strong>${esc(c.apellidoNombre) || '—'}</strong>`
        : `<strong>${esc(c.apellidoNombre) || '—'}</strong>`;

      tr.innerHTML = `
        <td>${nameCell}</td>
        <td>${isCont ? '<span class="grupo-cont-tel">—</span>' : (c.telefono || '—')}</td>
        <td>${c.tipoEvento || '—'}</td>
        <td>${formatDateWithDay(c.fechaEvento)}</td>
        <td>${estadoBadge(c.estado)}</td>
        <td class="${segClass}">${formatDate(c.proximoSeguimiento)}</td>
        <td>${c.origen || '—'}</td>
        <td class="acciones-col">
          <button class="btn btn-sm btn-secondary btn-ver">Ver</button>
          ${canManagePagos() ? `<button class="btn btn-sm btn-pago-rapido">$ Pago</button>` : ''}
        </td>
      `;
      tr.querySelector('.btn-ver').addEventListener('click', e => { e.stopPropagation(); openClienteModal(c); });
      tr.querySelector('.btn-pago-rapido')?.addEventListener('click', e => { e.stopPropagation(); openClienteModal(c, 'pagos'); });
      tr.addEventListener('click', () => openClienteModal(c));
      tbody.appendChild(tr);
    });
  });

  show('clientes-table-wrap');
}

function renderStats(clientes) {
  const total = clientes.length;
  const confirmados = clientes.filter(c => c.estado === 'Confirmado').length;
  const seguimiento = clientes.filter(c => {
    if (!c.proximoSeguimiento) return false;
    const d = new Date(c.proximoSeguimiento); d.setHours(0,0,0,0);
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    return d <= hoy;
  }).length;

  $('clientes-stats').innerHTML = `
    <div class="stat-card"><div class="stat-label">Total clientes</div><div class="stat-value">${total}</div></div>
    <div class="stat-card"><div class="stat-label">Confirmados</div><div class="stat-value verde">${confirmados}</div></div>
    <div class="stat-card"><div class="stat-label">Seguimiento pendiente</div><div class="stat-value amarillo">${seguimiento}</div></div>
    <div class="stat-card"><div class="stat-label">Consultas</div><div class="stat-value">${clientes.filter(c=>c.estado==='Consulta').length}</div></div>
  `;
}

// Filtros
function applyFilters() {
  const search = $('search-input').value.toLowerCase();
  const estado = $('filter-estado').value;
  const evento = $('filter-evento').value;
  const origen = $('filter-origen').value;

  let filtered = allClientes.filter(c => {
    const matchSearch = !search ||
      (c.apellidoNombre || '').toLowerCase().includes(search) ||
      (c.telefono || '').includes(search) ||
      (c.gmail || '').toLowerCase().includes(search);
    const matchEstado = !estado ||
      (estado === '__con_fecha__' ? !!c.proximoSeguimiento : c.estado === estado);
    const matchEvento = !evento || c.tipoEvento === evento;
    const matchOrigen = !origen ||
      (origen === '__formulario__' ? c.cargadoPor === 'bot-formulario' : c.origen === origen);
    return matchSearch && matchEstado && matchEvento && matchOrigen;
  });

  renderClientes(filtered);
}

$('search-input').addEventListener('input', applyFilters);
$('filter-estado').addEventListener('change', applyFilters);
$('filter-evento').addEventListener('change', applyFilters);
$('filter-origen').addEventListener('change', applyFilters);

/* ===================== MODAL CLIENTE ===================== */
function openClienteModal(cliente, tabInicial = 'info') {
  currentClienteModal = cliente;

  // Restaurar header si estaba en modo edición
  const wrap = document.querySelector('.modal-nombre-wrap');
  wrap.innerHTML = `<h3 id="modal-titulo">${esc(cliente.apellidoNombre) || 'Cliente'}</h3>`;

  // Botones admin-only en modal
  const btnNuevoEvento = $('btn-nuevo-evento');
  const btnEliminar = $('btn-eliminar-cliente');
  const btnVerTiming = $('btn-ver-timing');
  const tabHistorial = document.querySelector('.tab-btn[data-tab="pagos"]');
  const tabCuotas = document.querySelector('.tab-btn[data-tab="cuotas"]');
  if (canManagePagos()) {
    btnNuevoEvento?.classList.remove('hidden');
    btnEliminar?.classList.remove('hidden');
    btnVerTiming?.classList.remove('hidden');
    tabHistorial?.classList.remove('hidden');
    tabCuotas?.classList.remove('hidden');
  } else {
    btnNuevoEvento?.classList.add('hidden');
    btnEliminar?.classList.add('hidden');
    btnVerTiming?.classList.add('hidden');
    tabHistorial?.classList.add('hidden');
    tabCuotas?.classList.add('hidden');
  }

  activateTab(tabInicial);
  renderClienteDetail(cliente);
  injectNombreAcciones(cliente);
  loadRestriccionesModal(cliente);
  if (canManagePagos()) {
    initPagoForm(cliente);
    renderHistorialTab(cliente);
    loadCuotasTab(cliente);
    cargarEventosAnteriores(cliente);
  }

  showEl($('modal-overlay'));
}

$('modal-close-btn').addEventListener('click', () => {
  $('modal-overlay').querySelector('.modal')?.classList.remove('vista-cliente');
  $('btn-vista-cliente').textContent = 'Vista cliente';
  hideEl($('modal-overlay'));
});
$('modal-overlay').addEventListener('click', e => {
  if (e.target === $('modal-overlay')) {
    $('modal-overlay').querySelector('.modal')?.classList.remove('vista-cliente');
    $('btn-vista-cliente').textContent = 'Vista cliente';
    hideEl($('modal-overlay'));
  }
});

$('btn-vista-cliente').addEventListener('click', () => {
  const modal = $('modal-overlay').querySelector('.modal');
  const active = modal.classList.toggle('vista-cliente');
  $('btn-vista-cliente').textContent = active ? 'Vista interna' : 'Vista cliente';
});

$('btn-ver-timing')?.addEventListener('click', () => {
  if (!currentClienteModal) return;
  hideEl($('modal-overlay'));
  navigateTo('timing-global');
  setTimeout(() => {
    const sel = $('timing-cliente-select');
    if (sel) { sel.value = currentClienteModal.id; sel.dispatchEvent(new Event('change')); }
  }, 100);
});

$('btn-nuevo-evento')?.addEventListener('click', () => {
  if (!currentClienteModal) return;
  hideEl($('modal-overlay'));
  abrirNuevoEventoParaPersona(currentClienteModal);
});

$('btn-eliminar-cliente')?.addEventListener('click', async () => {
  if (!currentClienteModal) return;
  const c = currentClienteModal;
  const confirmMsg = `¿Eliminar el evento "${c.apellidoNombre}"?\n\nSe archivará en la Papelera de Google Sheets. Esta acción no se puede deshacer desde el CRM.`;
  if (!confirm(confirmMsg)) return;
  try {
    await apiFetch(`/clientes/${c.rowIndex}`, { method: 'DELETE', body: c });
    hideEl($('modal-overlay'));
    allClientes = await apiFetch('/clientes');
    renderClientes(allClientes);
    renderRemindersBar();
  } catch (err) { alert('Error al eliminar: ' + err.message); }
});

async function _saveSegDate(fecha, nuevoEstado) {
  const c = currentClienteModal;
  if (!c) return;
  try {
    const body = { ...c, proximoSeguimiento: fecha };
    if (nuevoEstado) body.estado = nuevoEstado;
    await apiFetch(`/clientes/${c.rowIndex}`, { method: 'PUT', body });
    c.proximoSeguimiento = fecha;
    if (nuevoEstado) c.estado = nuevoEstado;
    const idx = allClientes.findIndex(x => x.id === c.id);
    if (idx !== -1) {
      allClientes[idx].proximoSeguimiento = fecha;
      if (nuevoEstado) allClientes[idx].estado = nuevoEstado;
    }
    renderClienteDetail(c);
    renderSeguimientosPanel();
  } catch (err) { alert('Error al guardar: ' + err.message); }
}

window.guardarProximoSeguimiento = async function() {
  const fecha = $('modal-seg-date')?.value || '';
  const tipo = $('modal-seg-tipo')?.value;
  const c = currentClienteModal;
  let nuevoEstado;
  if (tipo === 'visita' && c && c.estado === 'Consulta') nuevoEstado = 'Visita agendada';
  await _saveSegDate(fecha, nuevoEstado);
};

window.limpiarProximoSeguimiento = async function() {
  if (!confirm('¿Borrar la fecha de seguimiento/cobro?')) return;
  await _saveSegDate('');
};

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

function activateTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => {
    const isActive = c.id === `tab-${name}`;
    c.classList.toggle('active', isActive);
    if (isActive) c.classList.remove('hidden');
  });
}

function cargarEventosAnteriores(cliente) {
  const container = $('cliente-eventos-anteriores');
  if (!container) return;
  const otros = allClientes.filter(c => c.personaId === cliente.personaId && c.id !== cliente.id);
  if (!otros.length) { container.classList.add('hidden'); container.innerHTML = ''; return; }

  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="eventos-ant-titulo">Otros eventos de esta persona (${otros.length}):</div>
    <div class="eventos-ant-lista">
      ${otros.map(c => `
        <div class="evento-ant-item" onclick="openClienteModal(allClientes.find(x=>x.id==='${c.id}'))">
          <span class="evento-ant-tipo">${c.tipoEvento || '—'}</span>
          <span class="evento-ant-fecha">${formatDate(c.fechaEvento) || '—'}</span>
          <span>${estadoBadge(c.estado)}</span>
        </div>`).join('')}
    </div>`;
}

function abrirNuevoEventoParaPersona(clienteBase) {
  // navigateTo primero para que resetNuevoClienteForm() corra antes del pre-fill
  navigateTo('nuevo-cliente');

  const form = $('cliente-form');

  $('edit-persona-id').value = clienteBase.personaId || '';
  $('edit-persona-row-index').value = clienteBase.personaRowIndex || '';

  const setVal = (name, val) => { if (form[name]) form[name].value = val || ''; };
  setVal('apellidoNombre', clienteBase.apellidoNombre);
  setVal('telefono', clienteBase.telefono);
  setVal('gmail', clienteBase.gmail);
  setVal('redSocial', clienteBase.redSocial);
  setVal('origen', clienteBase.origen);
  setVal('tipoCliente', 'Excliente');

  const card = $('persona-seleccionada-card');
  if (card) {
    card.innerHTML = `<div class="persona-card-inner">
      <span class="persona-card-nombre">👤 ${esc(clienteBase.apellidoNombre)}</span>
      <span class="persona-card-sub">${clienteBase.telefono || ''}</span>
    </div>`;
    card.classList.remove('hidden');
  }
  hide('persona-search-section');

  $('form-titulo').textContent = 'Nuevo evento — ' + (clienteBase.apellidoNombre || 'mismo cliente');
  $('tipo-cliente-select').dispatchEvent(new Event('change'));
  $('presupuesto-select').dispatchEvent(new Event('change'));
  actualizarCampoAgasajado();
}

function renderClienteDetail(c) {
  $('cliente-detail-grid').innerHTML = `
    <div class="detail-item"><span class="detail-label">Estado</span><span class="detail-value">${estadoBadge(c.estado)}</span></div>
    <div class="detail-item"><span class="detail-label">Teléfono</span><span class="detail-value">${c.telefono || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Gmail</span><span class="detail-value">${c.gmail || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Tipo de evento</span><span class="detail-value">${c.tipoEvento || '—'}</span></div>
    ${c.nombreAgasajado ? `<div class="detail-item"><span class="detail-label">Agasajad@</span><span class="detail-value" style="font-weight:600">${esc(c.nombreAgasajado)}</span></div>` : ''}
    <div class="detail-item"><span class="detail-label">Formato</span><span class="detail-value">${c.formato || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Fecha del evento</span><span class="detail-value">${formatDateWithDay(c.fechaEvento)}</span></div>
    <div class="detail-item"><span class="detail-label">Estado de la fecha</span><span class="detail-value">${c.estadoFecha || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Invitados</span><span class="detail-value">${c.cantidadInvitados || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Turno</span><span class="detail-value">${c.turno || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Menú infantil</span><span class="detail-value">${c.menuInfantil || '—'}</span></div>
    ${c.otrosPedidos ? `<div class="detail-item detail-full"><span class="detail-label">Otros pedidos</span><span class="detail-value">${esc(c.otrosPedidos)}</span></div>` : ''}
    ${(c.observaciones || '').replace(SUGERENCIA_REGEX,'').trim() ? `<div class="detail-item detail-full"><span class="detail-label">Observaciones</span><span class="detail-value">${esc((c.observaciones || '').replace(SUGERENCIA_REGEX,'').trim())}</span></div>` : ''}
    ${(c.menuRecepcion || c.menuIslas || c.menuPrimerPlato || c.menuPrincipal || c.menuPostre) ? `
      <div class="detail-item detail-full detail-menu-section">
        <span class="detail-label">Menú del evento</span>
        <div class="detail-menu-grid">
          ${c.menuRecepcion ? `<div><span class="menu-cat">Recepción</span> ${esc(c.menuRecepcion)}</div>` : ''}
          ${c.menuIslas ? `<div><span class="menu-cat">Islas</span> ${esc(c.menuIslas)}</div>` : ''}
          ${c.menuPrimerPlato ? `<div><span class="menu-cat">1° plato</span> ${esc(c.menuPrimerPlato)}</div>` : ''}
          ${c.menuPrincipal ? `<div><span class="menu-cat">Principal</span> ${esc(c.menuPrincipal)}</div>` : ''}
          ${c.menuPostre ? `<div><span class="menu-cat">Postre</span> ${esc(c.menuPostre)}</div>` : ''}
        </div>
      </div>` : ''}
    <div class="detail-item detail-full internal-field" data-internal>
      <span class="detail-label">Tipo de cliente</span>
      <span class="detail-value">${c.tipoCliente || '—'}${c.exclienteReferencia ? ` · Ref: ${c.exclienteReferencia}` : ''}${c.exclienteNota ? ` — ${c.exclienteNota}` : ''}</span>
    </div>
    <div class="detail-item internal-field" data-internal><span class="detail-label">Origen</span><span class="detail-value">${c.origen || '—'}</span></div>
    <div class="detail-item internal-field" data-internal><span class="detail-label">Presupuesto</span><span class="detail-value">${c.presupuesto || '—'}</span></div>
    <div class="detail-item internal-field" data-internal><span class="detail-label">Monto presupuesto</span><span class="detail-value">${c.montoPresupuesto ? formatMoney(c.montoPresupuesto) : '—'}</span></div>
    <div class="detail-item internal-field" data-internal><span class="detail-label">Cargado por</span><span class="detail-value">${c.cargadoPor || '—'}</span></div>
    <div class="detail-item internal-field" data-internal><span class="detail-label">Fecha de carga</span><span class="detail-value">${formatDate(c.fechaCarga)}</span></div>
  `;

  // Panel de seguimiento (siempre interno, fuera del grid principal)
  const segPanel = $('modal-seg-panel');
  if (segPanel) {
    const esCobro = ESTADOS_COBRO.includes(c.estado);
    const tipoSelect = esCobro ? '' : `
      <select id="modal-seg-tipo" class="seg-tipo-select">
        <option value="seguimiento"${c.estado !== 'Visita agendada' ? ' selected' : ''}>📞 Llamada / contacto</option>
        <option value="visita"${c.estado === 'Visita agendada' ? ' selected' : ''}>🤝 Visita al salón</option>
      </select>`;
    segPanel.innerHTML = `
      <span class="detail-label">${esCobro ? 'Próxima visita de cobro' : 'Próx. seguimiento'}</span>
      <span class="detail-value modal-seg-editor">
        ${tipoSelect}
        <input type="date" id="modal-seg-date" value="${c.proximoSeguimiento || ''}" class="${seguimientoClass(c.proximoSeguimiento)}">
        <button class="btn btn-secondary btn-sm" onclick="guardarProximoSeguimiento()">Guardar</button>
        ${c.proximoSeguimiento ? `<button class="btn btn-secondary btn-sm" onclick="limpiarProximoSeguimiento()">Borrar</button>` : ''}
      </span>`;
  }
}

$('btn-editar-cliente').addEventListener('click', () => {
  if (!currentClienteModal) return;
  hideEl($('modal-overlay'));
  openEditForm(currentClienteModal);
});


/* ===================== RESTRICCIONES ===================== */
async function loadRestriccionesModal(cliente) {
  $('restricciones-list').innerHTML = '<p style="color:#999;font-size:13px">Cargando...</p>';
  $('rest-id-cliente').value = cliente.id;
  try {
    const data = await apiFetch(`/restricciones/cliente/${cliente.id}`);
    currentRestricciones = data;
    renderRestriccionesList(data);
  } catch (e) {
    $('restricciones-list').innerHTML = `<p class="error-msg">${e.message}</p>`;
  }
}

function renderRestriccionesList(lista) {
  const hint = '<p style="color:#999;font-size:12px;margin-top:8px">Tip: para marcar solo algunos de un mismo tipo como mesa principal, cargalos en dos entradas separadas (ej: "Vegano 3" y "👑 Vegano 1").</p>';
  if (!lista.length) {
    $('restricciones-list').innerHTML = '<p style="color:#999;font-size:13px;margin-bottom:12px">Sin restricciones registradas.</p>' + hint;
    return;
  }
  $('restricciones-list').innerHTML = `<div class="item-list">${lista.map(r => `
    <div class="list-item${r.coronita ? ' list-item-vip' : ''}">
      <div class="list-item-info">
        <div class="list-item-label">${r.coronita ? '👑 ' : ''}${r.tipoRestriccion}</div>
        <div class="list-item-sub">${r.coronita ? '★ Mesa principal · ' : ''}${r.cantidad} persona${r.cantidad != 1 ? 's' : ''}</div>
      </div>
      <button class="btn btn-sm btn-danger" onclick="deleteRestriccion(${r.rowIndex})">✕</button>
    </div>
  `).join('')}</div>` + hint;
}

window.deleteRestriccion = async (rowIndex) => {
  if (!confirm('¿Eliminar esta restricción?')) return;
  try {
    await apiFetch(`/restricciones/${rowIndex}`, { method: 'DELETE' });
    loadRestriccionesModal(currentClienteModal);
  } catch (e) { alert(e.message); }
};

$('rest-tipo').addEventListener('change', () => {
  const isOtro = $('rest-tipo').value === 'Otro';
  $('rest-tipo-otro').style.display = isOtro ? '' : 'none';
  $('rest-tipo-otro').required = isOtro;
});

$('restriccion-form').addEventListener('submit', async e => {
  e.preventDefault();
  const idCliente = $('rest-id-cliente').value;
  const tipoSelect = $('rest-tipo').value;
  const tipoRestriccion = tipoSelect === 'Otro' ? $('rest-tipo-otro').value.trim() : tipoSelect;
  if (!tipoRestriccion) { alert('Ingresá el tipo de restricción'); return; }
  const cantidad = $('rest-cantidad').value;
  const coronita = $('rest-coronita').checked;
  try {
    await apiFetch('/restricciones', { method: 'POST', body: { idCliente, tipoRestriccion, cantidad, coronita } });
    $('rest-tipo').value = '';
    $('rest-tipo-otro').value = '';
    $('rest-tipo-otro').style.display = 'none';
    $('rest-cantidad').value = '';
    $('rest-coronita').checked = false;
    loadRestriccionesModal(currentClienteModal);
  } catch (e) { alert(e.message); }
});

/* ===================== PAGOS / HISTORIAL ===================== */
function initPagoForm(cliente) {
  $('pago-id-cliente').value = cliente.id;
  $('pago-fecha').value = new Date().toISOString().split('T')[0];
  hide('pago-error'); hide('pago-success');
  showEl($('pago-form'));
}

function renderHistorialTab(cliente) {
  // Resetear toggle
  const _hist = $('pagos-historial');
  const _btnH = $('btn-toggle-historial');
  if (_hist) _hist.style.display = '';
  if (_btnH) _btnH.textContent = 'Ocultar historial';

  showEl($('pagos-admin-content'));
  loadPagosCliente(cliente);
}

async function loadPagosCliente(cliente) {
  $('pagos-list').innerHTML = '<p style="color:#999;font-size:13px">Cargando...</p>';
  try {
    const { ingresos } = await apiFetch(`/ingresos/totales/${cliente.id}`);
    const totalARS = ingresos.filter(i => !i.moneda || i.moneda === 'ARS').reduce((s, i) => s + (parseFloat(i.monto) || 0), 0);
    const totalUSD = ingresos.filter(i => i.moneda === 'USD').reduce((s, i) => s + (parseFloat(i.monto) || 0), 0);
    const partes = [];
    if (totalARS > 0) partes.push(formatMoney(totalARS));
    if (totalUSD > 0) partes.push(formatMoneda(totalUSD, 'USD'));
    $('pagos-total').innerHTML = `Total cobrado: ${partes.length ? partes.join(' · ') : formatMoney(0)}`;
    if (!ingresos.length) {
      $('pagos-list').innerHTML = '<p style="color:#999;font-size:13px;margin-bottom:12px">Sin ingresos registrados.</p>';
      return;
    }
    $('pagos-list').innerHTML = `<div class="item-list">${ingresos.map(i => `
      <div class="list-item">
        <div class="list-item-info">
          <div class="list-item-label">${i.tipoIngreso} — ${formatMoneda(i.monto, i.moneda || 'ARS')}</div>
          <div class="list-item-sub">${formatDate(i.fecha)}${i.formaPago ? ' · ' + i.formaPago : ''}${i.notas ? ' · ' + i.notas : ''}</div>
        </div>
      </div>
    `).join('')}</div>`;
  } catch (e) {
    $('pagos-list').innerHTML = `<p class="error-msg">${e.message}</p>`;
  }
}

$('pago-tipo').addEventListener('change', () => {
  const tipo = $('pago-tipo').value;
  const seccion = $('cuotas-a-tachar');
  if (tipo === 'Cuota') {
    showEl(seccion);
    renderCuotasATacharLista();
  } else {
    hideEl(seccion);
  }
});

function renderCuotasATacharLista() {
  const lista = $('cuotas-a-tachar-lista');
  if (!lista) return;
  const pendientes = [...document.querySelectorAll('.cuota-item.cuota-pendiente')];
  if (!pendientes.length) {
    lista.innerHTML = '<p style="color:#999;font-size:12px">No hay cuotas pendientes en el plan.</p>';
    return;
  }
  lista.innerHTML = pendientes.map(el => {
    const row = el.dataset.row;
    const check = el.querySelector('.cuota-check');
    const valor = check?.dataset.valor || '0';
    const num = check?.dataset.num || '';
    const fecha = el.querySelector('.cuota-vence')?.textContent || '';
    const montoStr = el.querySelector('.cuota-valor')?.textContent || '';
    return `<label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;font-size:13px">
      <input type="checkbox" class="tachar-check" data-row="${row}" data-valor="${valor}" data-num="${num}">
      <span>Cuota ${num}</span>
      <span style="color:var(--text-muted)">${fecha}</span>
      <span style="margin-left:auto;font-weight:600">${montoStr}</span>
    </label>`;
  }).join('');

  lista.querySelectorAll('.tachar-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = [...lista.querySelectorAll('.tachar-check:checked')];
      const total = checked.reduce((s, c) => s + (parseFloat(c.dataset.valor) || 0), 0);
      if (total > 0) $('pago-monto').value = total;
    });
  });
}

$('pago-form').addEventListener('submit', async e => {
  e.preventDefault();
  hide('pago-error'); hide('pago-success');
  const tipo = $('pago-tipo').value;
  const moneda = $('pago-moneda').value || 'ARS';
  const monto = $('pago-monto').value;
  const fecha = $('pago-fecha').value;
  const formaPago = $('pago-forma').value;
  const notas = $('pago-notas').value;
  const idCliente = $('pago-id-cliente').value;

  const cuotasSeleccionadas = tipo === 'Cuota'
    ? [...($('cuotas-a-tachar-lista')?.querySelectorAll('.tachar-check:checked') || [])].map(c => parseInt(c.dataset.row))
    : [];

  try {
    if (tipo === 'Cuota' && cuotasSeleccionadas.length) {
      const nums = [...($('cuotas-a-tachar-lista')?.querySelectorAll('.tachar-check:checked') || [])]
        .map(c => c.dataset.num || '');
      await apiFetch('/cuotas/pagar', { method: 'PUT', body: {
        rowIndices: cuotasSeleccionadas,
        fechaPago: fecha,
        notas,
        idCliente,
        formaPago,
        montoTotal: parseFloat(monto),
        montoEfectivo: parseFloat(monto),
        monedaPago: moneda,
        descripcion: `Cuota${nums.length > 1 ? 's' : ''} ${nums.join(', ')}`,
      }});
    } else {
      await apiFetch('/ingresos', { method: 'POST', body: {
        idCliente, tipoIngreso: tipo, moneda, monto, fecha, formaPago, notas,
      }});
    }
    $('pago-success').textContent = 'Cobro registrado correctamente.';
    show('pago-success');
    $('pago-form').reset();
    $('pago-fecha').value = new Date().toISOString().split('T')[0];
    hideEl($('cuotas-a-tachar'));
    if (canManagePagos()) {
      loadPagosCliente(currentClienteModal);
      if (tipo === 'Cuota' && cuotasSeleccionadas.length) loadCuotasTab(currentClienteModal);
    }
  } catch (err) {
    $('pago-error').textContent = err.message;
    show('pago-error');
  }
});

$('btn-toggle-historial').addEventListener('click', () => {
  const hist = $('pagos-historial');
  const isHidden = hist.style.display === 'none';
  hist.style.display = isHidden ? '' : 'none';
  $('btn-toggle-historial').textContent = isHidden ? 'Ocultar historial' : 'Mostrar historial';
});

/* ===================== CALENDARIO ===================== */
function loadCalendario() {
  if (calYear === undefined) {
    const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth();
  }
  renderCalendario();
}

function renderCalendario() {
  const con = $('calendario-container');
  const MES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const DOW = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

  const eventMap = {};
  allClientes.filter(c => c.fechaEvento && c.estado !== 'Cancelado').forEach(c => {
    if (!eventMap[c.fechaEvento]) eventMap[c.fechaEvento] = [];
    eventMap[c.fechaEvento].push(c);
  });

  // Visitas y cobros por proximoSeguimiento (excluye cancelados/realizados y los que ya tienen evento ese mismo día)
  const segMap = {};
  allClientes.filter(c => c.proximoSeguimiento && c.estado !== 'Cancelado' && c.estado !== 'Realizado').forEach(c => {
    if (!segMap[c.proximoSeguimiento]) segMap[c.proximoSeguimiento] = [];
    segMap[c.proximoSeguimiento].push(c);
  });

  // Clientes sin actividad hace 14+ días: aparecen en HOY en el calendario
  const hoyDate = new Date(); hoyDate.setHours(0,0,0,0);
  const sinActividadCal = allClientes.filter(c => {
    if (['Confirmado', 'Realizado', 'Cancelado'].includes(c.estado)) return false;
    const fc = parseFechaCarga(c.fechaCarga);
    if (!fc) return false;
    if ((hoyDate - fc) / 86400000 < 14) return false;
    if (c.proximoSeguimiento) {
      const seg = new Date(c.proximoSeguimiento); seg.setHours(0,0,0,0);
      if (seg >= hoyDate) return false;
    }
    return true;
  });

  const firstDay = new Date(calYear, calMonth, 1);
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  let startDow = firstDay.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;

  const t = new Date();
  const todayStr = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;

  const pillClass = {
    'Visita agendada': 'cal-pill-visita',
    'Por cerrar': 'cal-pill-cerrar',
    'Consulta': 'cal-pill-consulta',
    'Realizado': 'cal-pill-realizado',
  };

  let cells = '';
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell cal-cell-empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = ds === todayStr;
    const evs = eventMap[ds] || [];
    const segs = (segMap[ds] || []).filter(c => c.fechaEvento !== ds); // no duplicar si el evento es ese día
    const sinAct = isToday
      ? sinActividadCal.filter(c => !evs.some(e => e.id === c.id) && !segs.some(s => s.id === c.id))
      : [];
    cells += `<div class="cal-cell${isToday ? ' cal-cell-today' : ''}">
      <span class="cal-cell-num${isToday ? ' cal-num-today' : ''}">${d}</span>
      ${evs.map(c => {
        const sub = [c.tipoEvento, c.cantidadInvitados ? `${c.cantidadInvitados} PAX` : ''].filter(Boolean).join(' · ');
        const tc = c.estado === 'Confirmado' ? tipoColor(c.tipoEvento) : null;
        return `<div class="cal-pill ${tc ? '' : (pillClass[c.estado] || '')}" ${tc ? `style="background:${tc.bg};color:${tc.color};border-left:3px solid ${tc.border}"` : ''} onclick="openClienteModal(window._cmap['${c.id}'])" title="${c.apellidoNombre}${c.turno ? ' · '+c.turno : ''}">
          <div class="cal-pill-nombre">${c.apellidoNombre}</div>
          ${sub ? `<div class="cal-pill-sub">${sub}</div>` : ''}
        </div>`;
      }).join('')}
      ${segs.map(c => {
        const esCobro = ESTADOS_COBRO.includes(c.estado);
        const esVisita = c.estado === 'Visita agendada';
        const icono = esCobro ? '💰' : (esVisita ? '🤝' : '📞');
        const cls = esCobro ? 'cal-pill-seg-cobro' : (esVisita ? 'cal-pill-seg-visita' : 'cal-pill-seg-llamada');
        const titulo = esCobro ? 'Cobro' : (esVisita ? 'Visita' : 'Seguimiento');
        return `<div class="cal-pill cal-pill-seg ${cls}" onclick="openClienteModal(window._cmap['${c.id}'])" title="${titulo}: ${c.apellidoNombre}">
          <div class="cal-pill-nombre">${icono} ${c.apellidoNombre}</div>
        </div>`;
      }).join('')}
      ${sinAct.map(c => {
        const fcDate = parseFechaCarga(c.fechaCarga);
        const dias = fcDate ? Math.round((hoyDate - fcDate) / 86400000) : '?';
        return `<div class="cal-pill cal-pill-seg cal-pill-sin-actividad" onclick="openClienteModal(window._cmap['${c.id}'])" title="Sin actividad (${dias}d): ${c.apellidoNombre}">
          <div class="cal-pill-nombre">📞 ${c.apellidoNombre}</div>
          <div class="cal-pill-sub">${c.tipoEvento || '—'} · ${dias}d</div>
        </div>`;
      }).join('')}
    </div>`;
  }

  con.innerHTML = `
    <div class="cal-nav">
      <button class="btn btn-secondary btn-sm" id="cal-prev">&#8249;</button>
      <span class="cal-month-label">${MES[calMonth]} ${calYear}</span>
      <button class="btn btn-secondary btn-sm" id="cal-next">&#8250;</button>
      <button class="btn btn-secondary btn-sm" id="cal-today">Hoy</button>
    </div>
    <div class="cal-month-grid">
      ${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}
      ${cells}
    </div>`;

  window._cmap = {};
  allClientes.forEach(c => { window._cmap[c.id] = c; });

  $('cal-prev').addEventListener('click', () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendario(); });
  $('cal-next').addEventListener('click', () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendario(); });
  $('cal-today').addEventListener('click', () => { const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth(); renderCalendario(); });

  renderSeguimientosPanel();
}

const ESTADOS_COBRO = ['Confirmado', 'Por cerrar'];

const TIPO_COLOR = {
  'XV años':     { bg: '#f3e8ff', color: '#6b21a8', border: '#d8b4fe' },
  'Casamiento':  { bg: '#fef9c3', color: '#92400e', border: '#fde047' },
  'Cumpleaños':  { bg: '#fce7f3', color: '#9d174d', border: '#f9a8d4' },
  'Bautismo':    { bg: '#e0f2fe', color: '#0c4a6e', border: '#7dd3fc' },
  'Comunión':    { bg: '#ecfdf5', color: '#065f46', border: '#6ee7b7' },
  'Graduación':  { bg: '#fff7ed', color: '#9a3412', border: '#fdba74' },
  'Corporativo': { bg: '#f1f5f9', color: '#334155', border: '#94a3b8' },
  'Aniversario': { bg: '#fff1f2', color: '#9f1239', border: '#fda4af' },
  'Baby shower': { bg: '#fdf2f8', color: '#9d174d', border: '#f0abfc' },
};
const TIPO_COLOR_DEFAULT = { bg: '#f8fafc', color: '#1e293b', border: '#cbd5e1' };
function tipoColor(tipo) { return TIPO_COLOR[tipo] || TIPO_COLOR_DEFAULT; }

function renderSeguimientosPanel() {
  const aside = $('calendario-aside');
  if (!aside) return;

  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const en3 = new Date(hoy); en3.setDate(en3.getDate() + 3);
  const en7 = new Date(hoy); en7.setDate(en7.getDate() + 7);
  const en14 = new Date(hoy); en14.setDate(en14.getDate() + 14);

  const activos = allClientes.filter(c => c.estado !== 'Cancelado' && c.estado !== 'Realizado');

  const esCobro = c => ESTADOS_COBRO.includes(c.estado);

  const vencidos = activos.filter(c => {
    if (!c.proximoSeguimiento) return false;
    const d = new Date(c.proximoSeguimiento); d.setHours(0,0,0,0);
    return d < hoy;
  }).sort((a, b) => a.proximoSeguimiento.localeCompare(b.proximoSeguimiento));

  const paraHoy = activos.filter(c => {
    if (!c.proximoSeguimiento) return false;
    const d = new Date(c.proximoSeguimiento); d.setHours(0,0,0,0);
    return d.getTime() === hoy.getTime();
  });

  const proximos = activos.filter(c => {
    if (!c.proximoSeguimiento) return false;
    const d = new Date(c.proximoSeguimiento); d.setHours(0,0,0,0);
    return d > hoy && d <= en7;
  }).sort((a, b) => a.proximoSeguimiento.localeCompare(b.proximoSeguimiento));

  // Cobros: Confirmado/Por cerrar con fecha en los próximos 8-14 días (los de hoy/7d ya aparecen arriba)
  const cobros = activos.filter(c => {
    if (!esCobro(c)) return false;
    if (!c.proximoSeguimiento) return false;
    const d = new Date(c.proximoSeguimiento); d.setHours(0,0,0,0);
    return d > en7 && d <= en14;
  }).sort((a, b) => a.proximoSeguimiento.localeCompare(b.proximoSeguimiento));

  // Visitas agendadas sin fecha asignada (las que tienen fecha ya aparecen en proximos)
  const visitas = activos.filter(c => {
    if (c.estado !== 'Visita agendada') return false;
    return !c.proximoSeguimiento;
  }).sort((a, b) => (a.apellidoNombre || '').localeCompare(b.apellidoNombre || ''));

  // Eventos confirmados con fechaEvento dentro de los próximos 7 días
  const eventosProximos = allClientes.filter(c => {
    if (c.estado !== 'Confirmado' || !c.fechaEvento) return false;
    const evDate = new Date(c.fechaEvento); evDate.setHours(0,0,0,0);
    const diff = (evDate - hoy) / 86400000;
    return diff >= 0 && diff <= 7;
  }).sort((a, b) => a.fechaEvento.localeCompare(b.fechaEvento));

  // Clientes sin actividad hace 14+ días (no confirmados, sin próximo seguimiento futuro)
  const sinActividad = allClientes.filter(c => {
    if (['Confirmado', 'Realizado', 'Cancelado'].includes(c.estado)) return false;
    const fc = parseFechaCarga(c.fechaCarga);
    if (!fc) return false;
    if ((hoy - fc) / 86400000 < 14) return false;
    if (c.proximoSeguimiento) {
      const seg = new Date(c.proximoSeguimiento); seg.setHours(0,0,0,0);
      if (seg >= hoy) return false;
    }
    return true;
  }).sort((a, b) => (a.apellidoNombre || '').localeCompare(b.apellidoNombre || ''));

  const badge = c => {
    if (esCobro(c)) return '<span class="seg-badge seg-badge-cobro">cobro</span>';
    if (c.estado === 'Visita agendada') return '<span class="seg-badge seg-badge-visita">visita</span>';
    return '<span class="seg-badge seg-badge-seg">seguimiento</span>';
  };

  const item = (c, tipo) => {
    const fecha = c.proximoSeguimiento ? formatDate(c.proximoSeguimiento) : '';
    return `<div class="seg-item seg-item-${tipo}" onclick="openClienteModal(window._cmap['${c.id}'])">
      <div class="seg-item-nombre">${esc(c.apellidoNombre)} ${badge(c)}</div>
      <div class="seg-item-meta">${c.tipoEvento || ''}${fecha ? ` · ${fecha}` : ''}</div>
    </div>`;
  };

  const itemEvento = (c) => {
    const tc = tipoColor(c.tipoEvento);
    const evDate = new Date(c.fechaEvento); evDate.setHours(0,0,0,0);
    const diff = Math.round((evDate - hoy) / 86400000);
    const cuando = diff === 0 ? '¡HOY!' : diff === 1 ? 'Mañana' : `en ${diff} días`;
    return `<div class="seg-item seg-item-evento" style="background:${tc.bg};border-left-color:${tc.border}" onclick="openClienteModal(window._cmap['${c.id}'])">
      <div class="seg-item-nombre" style="color:${tc.color}">${esc(c.apellidoNombre)}</div>
      <div class="seg-item-meta">${c.tipoEvento || 'Evento'} · <strong>${cuando}</strong></div>
    </div>`;
  };

  const itemContactar = (c) => {
    const fc = parseFechaCarga(c.fechaCarga);
    const dias = fc ? Math.round((hoy - fc) / 86400000) : '?';
    return `<div class="seg-item seg-item-contactar" onclick="openClienteModal(window._cmap['${c.id}'])">
      <div class="seg-item-nombre">${esc(c.apellidoNombre)} <span class="seg-badge seg-badge-contactar">seguir</span></div>
      <div class="seg-item-meta">${c.tipoEvento || '—'} · ${dias}d sin actividad</div>
    </div>`;
  };

  let html = `<div class="seg-panel-title">Pendientes</div>`;

  const hayAlgo = vencidos.length || paraHoy.length || proximos.length || cobros.length || visitas.length || eventosProximos.length || sinActividad.length;
  if (!hayAlgo) {
    html += `<p class="seg-empty">Sin tareas para los próximos días ✓</p>`;
  }

  if (eventosProximos.length > 0) {
    html += `<div class="seg-section-label seg-label-evento">🎉 Eventos esta semana</div>`;
    html += eventosProximos.map(c => itemEvento(c)).join('');
  }
  if (vencidos.length > 0) {
    html += `<div class="seg-section-label seg-label-urgente">⚠ Vencidos (${vencidos.length})</div>`;
    html += vencidos.map(c => item(c, 'urgente')).join('');
  }
  if (paraHoy.length > 0) {
    html += `<div class="seg-section-label seg-label-hoy">Hoy</div>`;
    html += paraHoy.map(c => item(c, 'hoy')).join('');
  }
  if (proximos.length > 0) {
    html += `<div class="seg-section-label seg-label-prox">Próximos 7 días</div>`;
    html += proximos.map(c => item(c, 'prox')).join('');
  }
  if (cobros.length > 0) {
    html += `<div class="seg-section-label seg-label-cobro">Cobros programados</div>`;
    html += cobros.map(c => item(c, 'cobro')).join('');
  }
  if (visitas.length > 0) {
    html += `<div class="seg-section-label seg-label-visita">Visitas agendadas</div>`;
    html += visitas.map(c => item(c, 'visita')).join('');
  }
  if (sinActividad.length > 0) {
    html += `<div class="seg-section-label seg-label-contactar">📱 Sin actividad +14d</div>`;
    html += sinActividad.map(c => itemContactar(c)).join('');
  }

  aside.innerHTML = html;
}

/* ===================== SEGUIMIENTOS ===================== */
function initSeguimientos() {
  renderSeguimientosView();
}

function renderSeguimientosView() {
  const con = $('seguimientos-content');
  if (!con) return;

  const hoy = new Date(); hoy.setHours(0,0,0,0);

  const stale = allClientes.filter(c => {
    if (['Confirmado', 'Realizado', 'Cancelado'].includes(c.estado)) return false;
    const fc = parseFechaCarga(c.fechaCarga);
    if (!fc) return false;
    if ((hoy - fc) / 86400000 < 14) return false;
    if (c.proximoSeguimiento) {
      const seg = new Date(c.proximoSeguimiento); seg.setHours(0,0,0,0);
      if (seg >= hoy) return false;
    }
    return true;
  }).sort((a, b) => {
    const fa = parseFechaCarga(a.fechaCarga) || new Date(0);
    const fb = parseFechaCarga(b.fechaCarga) || new Date(0);
    return fa - fb;
  });

  if (!stale.length) {
    con.innerHTML = '<p class="seg-empty" style="padding:40px 0">✓ Ningún cliente sin actividad reciente</p>';
    return;
  }

  const rows = stale.map(c => {
    const fc = parseFechaCarga(c.fechaCarga);
    const dias = fc ? Math.round((hoy - fc) / 86400000) : '?';
    const tel = c.telefono || '';
    const telLink = tel
      ? `<a href="tel:${tel}" class="seg-tel-link" onclick="event.stopPropagation()">${tel}</a>`
      : '—';
    const waNum = tel.replace(/\D/g, '');
    const waLink = waNum
      ? `<a href="https://wa.me/54${waNum}" target="_blank" class="btn btn-sm btn-primary seg-wa-btn" onclick="event.stopPropagation()">💬 WA</a>`
      : '';
    return `<tr class="seg-fila" onclick="openClienteModal(window._cmap['${c.id}'])">
      <td><strong>${esc(c.apellidoNombre)}</strong></td>
      <td>${estadoBadge(c.estado)}</td>
      <td>${c.tipoEvento || '—'}</td>
      <td class="seg-dias-cell">${dias}d</td>
      <td>${telLink} ${waLink}</td>
    </tr>`;
  }).join('');

  con.innerHTML = `
    <p class="seg-view-info">${stale.length} cliente${stale.length > 1 ? 's' : ''} sin actividad en los últimos 14 días o más — hacé clic en una fila para abrir el perfil</p>
    <table class="tabla">
      <thead><tr><th>Cliente</th><th>Estado</th><th>Tipo de evento</th><th>Inactividad</th><th>Contacto</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* ===================== FORM CLIENTE ===================== */
document.querySelector('[name="estado"]')?.addEventListener('change', function() {
  const row = $('visita-fecha-row');
  if (!row) return;
  const esVisita = this.value === 'Visita agendada';
  row.style.display = esVisita ? '' : 'none';
  if (!esVisita) $('fechaVisita').value = '';
});

$('tipo-cliente-select').addEventListener('change', () => {
  const v = $('tipo-cliente-select').value;
  $('excliente-ref-group').style.display = (v === 'Excliente' || v === 'Referido') ? '' : 'none';
  $('excliente-nota-group').style.display = (v === 'Excliente' || v === 'Referido') ? '' : 'none';
});

function poblarDatalistReferidos() {
  const dl = $('clientes-datalist-ref');
  if (!dl) return;
  dl.innerHTML = '';
  const nombres = new Set(allClientes.map(c => c.apellidoNombre).filter(Boolean));
  nombres.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n;
    dl.appendChild(opt);
  });
}

const AGASAJADO_LABELS = {
  'Boda': 'Nombre de los novios',
  'XV años': 'Nombre de la quinceañera',
  'Bautismo': 'Nombre del/la bautizad@',
  'Comunión': 'Nombre del/la comulgante',
  'Egresados': 'Nombre del curso / egresados',
};
const TIPOS_SIN_AGASAJADO = ['Corporativo', 'Otro', ''];

document.querySelector('[name="tipoEvento"]')?.addEventListener('change', actualizarCampoAgasajado);

function actualizarCampoAgasajado() {
  const tipo = document.querySelector('[name="tipoEvento"]')?.value || '';
  const grupo = $('agasajado-group');
  const label = $('agasajado-label');
  if (!grupo) return;
  if (TIPOS_SIN_AGASAJADO.includes(tipo)) {
    grupo.style.display = 'none';
    return;
  }
  let lbl = AGASAJADO_LABELS[tipo];
  if (!lbl) lbl = tipo.startsWith('Cumpleaños') ? 'Nombre del/la festejad@' : 'Nombre del/la agasajad@';
  label.textContent = lbl;
  grupo.style.display = '';
}

$('presupuesto-select').addEventListener('change', () => {
  $('monto-group').style.display = $('presupuesto-select').value === 'Sí, tiene monto' ? '' : 'none';
});

$('cancel-form-btn').addEventListener('click', () => { resetNuevoClienteForm(); navigateTo('clientes'); });

function resetNuevoClienteForm() {
  $('form-titulo').textContent = 'Nuevo cliente';
  $('edit-row-index').value = '';
  $('edit-cliente-id').value = '';
  $('edit-persona-id').value = '';
  $('edit-persona-row-index').value = '';
  const modoHistoricoEl = $('modo-historico');
  if (modoHistoricoEl) modoHistoricoEl.checked = false;
  const visitaRow = $('visita-fecha-row');
  if (visitaRow) visitaRow.style.display = 'none';
  const fechaVisita = $('fechaVisita');
  if (fechaVisita) fechaVisita.value = '';
  show('persona-search-section');
  const card = $('persona-seleccionada-card');
  if (card) { card.classList.add('hidden'); card.innerHTML = ''; }
  const results = $('persona-search-results');
  if (results) { results.classList.add('hidden'); results.innerHTML = ''; }
  const searchInput = $('persona-search-input');
  if (searchInput) searchInput.value = '';
  $('persona-search-clear')?.classList.add('hidden');
  poblarDatalistReferidos();
}

// Búsqueda de persona existente
$('persona-search-input')?.addEventListener('input', () => {
  const q = $('persona-search-input').value.trim().toLowerCase();
  const results = $('persona-search-results');
  if (!results) return;
  if (q.length < 2) { results.classList.add('hidden'); results.innerHTML = ''; return; }

  const matches = allPersonas.filter(p =>
    p.id && (
      (p.apellidoNombre || '').toLowerCase().includes(q) ||
      (p.telefono || '').includes(q)
    )
  ).slice(0, 6);

  if (!matches.length) {
    results.innerHTML = '<div class="persona-result-item persona-result-empty">No se encontraron clientes</div>';
    results.classList.remove('hidden');
    return;
  }
  results.innerHTML = matches.map(p => `
    <div class="persona-result-item" data-id="${p.id}">
      <span class="persona-result-nombre">${esc(p.apellidoNombre)}</span>
      <span class="persona-result-tel">${p.telefono || ''}</span>
    </div>`).join('');
  results.classList.remove('hidden');

  results.querySelectorAll('.persona-result-item[data-id]').forEach(el => {
    el.addEventListener('click', () => seleccionarPersonaExistente(el.dataset.id));
  });
});

function seleccionarPersonaExistente(personaId) {
  const persona = allPersonas.find(p => p.id === personaId);
  if (!persona) return;

  $('edit-persona-id').value = persona.id;
  $('edit-persona-row-index').value = persona.rowIndex || '';

  // Pre-fill campos
  const form = $('cliente-form');
  const setVal = (name, val) => { if (form[name]) form[name].value = val || ''; };
  setVal('apellidoNombre', persona.apellidoNombre);
  setVal('telefono', persona.telefono);
  setVal('gmail', persona.gmail);
  setVal('redSocial', persona.redSocial);
  setVal('origen', persona.origen);
  setVal('tipoCliente', 'Excliente');
  $('tipo-cliente-select').dispatchEvent(new Event('change'));

  // Mostrar card
  const card = $('persona-seleccionada-card');
  if (card) {
    // Contar eventos previos
    const eventosCount = allClientes.filter(c => c.personaId === persona.id).length;
    card.innerHTML = `<div class="persona-card-inner">
      <span class="persona-card-nombre">👤 ${esc(persona.apellidoNombre)}</span>
      <span class="persona-card-sub">${persona.telefono || ''}${eventosCount ? ` · ${eventosCount} evento${eventosCount > 1 ? 's' : ''} anterior${eventosCount > 1 ? 'es' : ''}` : ''}</span>
    </div>`;
    card.classList.remove('hidden');
  }

  const results = $('persona-search-results');
  if (results) { results.classList.add('hidden'); }
  const searchInput = $('persona-search-input');
  if (searchInput) searchInput.value = persona.apellidoNombre;
  $('persona-search-clear')?.classList.remove('hidden');
}

$('persona-search-clear')?.addEventListener('click', () => {
  $('edit-persona-id').value = '';
  $('edit-persona-row-index').value = '';
  const card = $('persona-seleccionada-card');
  if (card) { card.classList.add('hidden'); card.innerHTML = ''; }
  const searchInput = $('persona-search-input');
  if (searchInput) searchInput.value = '';
  $('persona-search-clear')?.classList.add('hidden');
  $('persona-search-results')?.classList.add('hidden');
  // Reset persona fields
  const form = $('cliente-form');
  ['apellidoNombre','telefono','gmail','redSocial','origen','tipoCliente'].forEach(name => {
    if (form[name]) form[name].value = '';
  });
});

$('cliente-form').addEventListener('submit', async e => {
  e.preventDefault();
  hide('form-error'); hide('form-success');

  const form = $('cliente-form');
  const rowIndex = $('edit-row-index').value;
  const isEdit = !!rowIndex;

  const modoHistorico = $('modo-historico')?.checked;

  // Validar: gmail obligatorio y único para personas nuevas (se omite si "cliente histórico" está tildado)
  const personaIdExistente = $('edit-persona-id').value;
  if (!personaIdExistente && !isEdit) {
    const gmail = (form.gmail.value || '').trim().toLowerCase();
    if (!gmail && !modoHistorico) {
      $('form-error').textContent = 'El Gmail es obligatorio. Si el cliente no tiene email, tildá "Cliente histórico" arriba del formulario.';
      show('form-error');
      return;
    }
    const duplicadoGmail = gmail && allPersonas.find(p => p.gmail && p.gmail.toLowerCase() === gmail);
    if (duplicadoGmail) {
      const ok = confirm(`"${duplicadoGmail.apellidoNombre}" ya está registrado con ese Gmail.\n¿Crear un nuevo evento para esa persona?`);
      if (!ok) return;
      seleccionarPersonaExistente(duplicadoGmail.id);
    }

    // Validar: teléfono duplicado (advertencia, no bloqueo)
    const tel = (form.telefono.value || '').trim().replace(/\s/g, '');
    if (tel) {
      const duplicadoTel = allPersonas.find(p => p.telefono && p.telefono.replace(/\s/g, '') === tel);
      if (duplicadoTel) {
        const eventosExist = allClientes.filter(c => c.personaId === duplicadoTel.id);
        const eventosStr = eventosExist.map(c => `${c.tipoEvento || '?'} (${c.estado})`).join(', ');
        const ok = confirm(`⚠️ Ya existe un cliente con ese teléfono: "${duplicadoTel.apellidoNombre}"${eventosStr ? `\nEventos: ${eventosStr}` : ''}.\n\n¿Es un nuevo evento para la misma persona?\n→ Cancelá y buscala arriba en "¿Es un cliente que ya consultó antes?"\n\n¿Es una persona diferente con el mismo número?\n→ Aceptá para continuar.`);
        if (!ok) return;
      }
    }
  }

  // Validar: no se puede reservar fecha sin seña (se omite si "cliente histórico" está tildado)
  if (form.estadoFecha.value === 'Reservada' && !modoHistorico) {
    if (!isEdit) {
      $('form-error').textContent = 'Para reservar la fecha necesitás registrar una seña primero. Guardá el cliente con fecha Tentativa y luego cargá la seña desde su ficha.';
      show('form-error');
      return;
    }
    try {
      const { ingresos } = await apiFetch(`/ingresos/totales/${$('edit-cliente-id').value}`);
      const tieneSeña = ingresos.some(i => i.tipoIngreso === 'Seña');
      if (!tieneSeña) {
        $('form-error').textContent = 'No se puede marcar la fecha como Reservada sin haber registrado una seña. Cargá el pago primero desde la ficha del cliente.';
        show('form-error');
        return;
      }
    } catch {}
  }

  // Validar: máximo 2 eventos por día
  const fechaEv = form.fechaEvento.value;
  if (fechaEv) {
    const currentId = $('edit-cliente-id').value;
    const otrosEnFecha = allClientes.filter(c =>
      c.fechaEvento === fechaEv &&
      c.estado !== 'Cancelado' &&
      c.id !== currentId
    );
    if (otrosEnFecha.length >= 2) {
      $('form-error').textContent = `⚠️ Ya hay 2 eventos registrados para el ${formatDateWithDay(fechaEv)}. No se pueden cargar más de 2 eventos por día.`;
      show('form-error');
      return;
    }
    if (otrosEnFecha.length === 1) {
      const ok = confirm(`⚠️ Ya hay un evento registrado para el ${formatDateWithDay(fechaEv)}: ${otrosEnFecha[0].apellidoNombre}.\n¿Confirmás que habrá 2 eventos ese día?`);
      if (!ok) return;
    }
  }

  $('submit-cliente-btn').disabled = true;

  const body = {
    id: $('edit-cliente-id').value || undefined,
    personaId: $('edit-persona-id').value || undefined,
    personaRowIndex: $('edit-persona-row-index').value ? parseInt($('edit-persona-row-index').value) : undefined,
    estado: form.estado.value,
    apellidoNombre: form.apellidoNombre.value,
    telefono: form.telefono.value,
    gmail: form.gmail.value,
    tipoEvento: form.tipoEvento.value,
    formato: form.formato.value,
    fechaEvento: form.fechaEvento.value,
    estadoFecha: form.estadoFecha.value,
    cantidadInvitados: form.cantidadInvitados.value,
    turno: form.turno.value,
    tipoCliente: form.tipoCliente.value,
    exclienteReferencia: form.exclienteReferencia.value,
    exclienteNota: form.exclienteNota.value,
    origen: form.origen.value,
    presupuesto: form.presupuesto.value,
    montoPresupuesto: form.montoPresupuesto.value,
    otrosPedidos: form.otrosPedidos.value,
    observaciones: form.observaciones.value,
    proximoSeguimiento: (form.estado.value === 'Visita agendada' && form.fechaVisita?.value)
      ? form.fechaVisita.value
      : form.proximoSeguimiento.value,
    nombreAgasajado: form.nombreAgasajado.value,
    cargadoPor: currentUser.usuario,
  };

  try {
    if (isEdit) {
      await apiFetch(`/clientes/${rowIndex}`, { method: 'PUT', body });
    } else {
      const nuevoCliente = await apiFetch('/clientes', { method: 'POST', body });
      // Agregar inmediatamente para evitar lag de consistencia de Sheets
      if (nuevoCliente && nuevoCliente.id) {
        allClientes = [nuevoCliente, ...allClientes];
        renderClientes(allClientes);
      }
    }
    $('form-success').textContent = isEdit ? 'Evento actualizado.' : 'Cliente guardado.';
    show('form-success');
    form.reset();
    resetNuevoClienteForm();
    await Promise.all([loadClientes(), loadPersonas()]);
    setTimeout(() => navigateTo('clientes'), 1000);
  } catch (err) {
    $('form-error').textContent = err.message;
    show('form-error');
  } finally {
    $('submit-cliente-btn').disabled = false;
  }
});

function openEditForm(cliente) {
  $('form-titulo').textContent = 'Editar evento';
  $('edit-row-index').value = cliente.rowIndex;
  $('edit-cliente-id').value = cliente.id;
  $('edit-persona-id').value = cliente.personaId || '';
  $('edit-persona-row-index').value = cliente.personaRowIndex || '';

  // En modo edición ocultamos la sección de búsqueda de persona
  hide('persona-search-section');

  const form = $('cliente-form');
  const setVal = (name, val) => { if (form[name]) form[name].value = val || ''; };

  setVal('estado', cliente.estado);
  setVal('apellidoNombre', cliente.apellidoNombre);
  setVal('telefono', cliente.telefono);
  setVal('gmail', cliente.gmail);
  setVal('tipoEvento', cliente.tipoEvento);
  setVal('formato', cliente.formato);
  setVal('fechaEvento', cliente.fechaEvento);
  setVal('estadoFecha', cliente.estadoFecha);
  setVal('cantidadInvitados', cliente.cantidadInvitados);
  setVal('turno', cliente.turno);
  setVal('tipoCliente', cliente.tipoCliente);
  setVal('exclienteReferencia', cliente.exclienteReferencia);
  setVal('exclienteNota', cliente.exclienteNota);
  setVal('origen', cliente.origen);
  setVal('presupuesto', cliente.presupuesto);
  setVal('montoPresupuesto', cliente.montoPresupuesto);
  setVal('otrosPedidos', cliente.otrosPedidos);
  setVal('observaciones', cliente.observaciones);
  setVal('proximoSeguimiento', cliente.proximoSeguimiento);
  setVal('nombreAgasajado', cliente.nombreAgasajado);

  poblarDatalistReferidos();
  $('tipo-cliente-select').dispatchEvent(new Event('change'));
  $('presupuesto-select').dispatchEvent(new Event('change'));
  document.querySelector('[name="tipoEvento"]')?.dispatchEvent(new Event('change'));
  const estadoSel = document.querySelector('[name="estado"]');
  if (estadoSel) {
    estadoSel.dispatchEvent(new Event('change'));
    if (cliente.estado === 'Visita agendada' && cliente.proximoSeguimiento) {
      const fv = $('fechaVisita');
      if (fv) fv.value = cliente.proximoSeguimiento;
    }
  }
  navigateTo('nuevo-cliente');
}

/* ===================== CUOTAS ===================== */
async function loadCuotasTab(cliente) {
  const con = $('cuotas-content');
  if (!con) return;
  con.innerHTML = '<p style="color:#999;font-size:13px">Cargando...</p>';
  try {
    const cuotas = await apiFetch(`/cuotas/cliente/${cliente.id}`);
    renderCuotas(cliente, cuotas);
  } catch (e) {
    con.innerHTML = `<p class="error-msg">${e.message}</p>`;
  }
}

function renderCuotas(cliente, cuotas) {
  const con = $('cuotas-content');
  const pendientes = cuotas.filter(c => c.estado === 'pendiente');
  const pagadas = cuotas.filter(c => c.estado === 'pagada');

  if (!cuotas.length) {
    con.innerHTML = `
      <p style="color:#666;font-size:13px;margin-bottom:16px">No hay plan de pagos para este cliente.</p>
      ${formCrearPlan(cliente.id)}`;
    bindFormCrearPlan(cliente);
    return;
  }

  // Detectar moneda e indexación del plan (todas las cuotas comparten los mismos)
  const moneda = cuotas[0]?.moneda || 'ARS';
  const indexacion = cuotas[0]?.indexacion || 'fija';
  const esUSD = moneda === 'USD';
  const esIPC = indexacion === 'ipc';

  const totalContrato = cuotas.reduce((s, c) => s + c.valorOriginal, 0);
  const totalPagado = pagadas.reduce((s, c) => s + c.montoPagado, 0);
  const saldoPendiente = pendientes.reduce((s, c) => s + c.valorActual, 0);
  const valorCuotaActual = pendientes.length ? pendientes[0].valorActual : (pagadas[pagadas.length - 1]?.montoPagado || 0);

  con.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      ${esUSD ? `<span style="background:var(--gold-light);border:1px solid var(--gold-border);color:#7a5c10;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;letter-spacing:.04em">U$S PLAN EN DÓLARES</span>` : ''}
      ${esIPC ? `<span style="background:#e8f5e9;border:1px solid #a5d6a7;color:#2e7d32;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;letter-spacing:.04em">📈 INDEXADO POR IPC</span>` : ''}
    </div>

    <div class="cuotas-resumen">
      <div class="cuota-stat"><div class="cuota-stat-label">Contrato original</div><div class="cuota-stat-val">${formatMoneda(totalContrato, moneda)}</div></div>
      <div class="cuota-stat"><div class="cuota-stat-label">Total cobrado</div><div class="cuota-stat-val verde">${formatMoneda(totalPagado, moneda)}</div></div>
      <div class="cuota-stat"><div class="cuota-stat-label">Saldo pendiente</div><div class="cuota-stat-val ${saldoPendiente > 0 ? 'rojo' : 'verde'}">${formatMoneda(saldoPendiente, moneda)}</div></div>
      <div class="cuota-stat"><div class="cuota-stat-label">Valor cuota actual</div><div class="cuota-stat-val">${formatMoneda(valorCuotaActual, moneda)}</div></div>
    </div>

    <div id="cuotas-acciones" class="cuotas-acciones">
      ${pendientes.length ? `
        <button class="btn btn-sm btn-secondary" id="btn-pagar-sel">✓ Marcar seleccionadas como pagadas</button>
        <div class="ipc-inline">
          ${esIPC ? `
            <button class="btn btn-sm btn-secondary" id="btn-ipc-auto">📈 Aplicar IPC del mes</button>
            <span class="tip" data-tip="Consulta el IPC mensual del INDEC (datos.gob.ar) y lo aplica automáticamente a las cuotas pendientes de este plan. Solo funciona con planes marcados como Indexados por IPC.">?</span>
          ` : `
            <input type="number" id="ipc-pct" placeholder="IPC %" min="0" max="100" step="0.1" style="width:90px">
            <span class="tip" data-tip="Ingresá el porcentaje de aumento manualmente. Solo se actualizan las cuotas PENDIENTES.">?</span>
            <button class="btn btn-sm btn-secondary" id="btn-ipc">Ajustar por %</button>
          `}
          <button class="btn btn-sm btn-secondary" id="btn-ajustar-val">Fijar valor</button>
          <input type="number" id="nuevo-valor" placeholder="Nuevo valor ${esUSD ? 'U$S' : '$'}" min="0" style="width:130px">
          <span class="tip" data-tip="Fijá un importe exacto para todas las cuotas pendientes, reemplazando el valor actual.">?</span>
        </div>
      ` : ''}
      ${isAdmin() ? `<button class="btn btn-sm btn-danger" id="btn-reset-plan" style="margin-left:auto">Borrar plan</button>` : ''}
    </div>

    <div id="fecha-pago-row" class="hidden" style="margin:10px 0;flex-wrap:wrap;display:flex;gap:10px;align-items:flex-end">
      <div style="display:flex;flex-direction:column;gap:3px">
        <label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Fecha</label>
        <input type="date" id="fecha-pago-input" value="${new Date().toISOString().split('T')[0]}" style="width:150px">
      </div>
      <div style="display:flex;flex-direction:column;gap:3px">
        <label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Forma de pago</label>
        <select id="forma-pago-cuota" style="width:160px">
          <option value="">—</option>
          <option>Efectivo</option>
          <option>Transferencia</option>
          <option>Cheque</option>
          <option>Mercado Pago</option>
          <option>Otro</option>
        </select>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px">
        <label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Moneda del pago <span class="tip" data-tip="Si el plan es en USD pero el cliente paga en pesos (o viceversa), elegí la moneda real con la que te pagaron y ajustá el monto.">?</span></label>
        <select id="moneda-pago-cuota" style="width:140px">
          <option value="ARS" ${moneda === 'ARS' ? 'selected' : ''}>$ Pesos (ARS)</option>
          <option value="USD" ${moneda === 'USD' ? 'selected' : ''}>U$S Dólares (USD)</option>
        </select>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px">
        <label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Monto recibido <span class="tip" data-tip="Se calcula automáticamente de las cuotas seleccionadas, pero podés editarlo si el cliente paga un monto distinto o en otra moneda.">?</span></label>
        <input type="number" id="monto-efectivo-input" min="0" style="width:130px" placeholder="Auto">
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:120px">
        <label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Notas</label>
        <input type="text" id="notas-pago-input" placeholder="Opcional" style="width:100%">
      </div>
      <button class="btn btn-sm btn-primary" id="btn-confirmar-pago">Confirmar</button>
      <button class="btn btn-sm btn-secondary" id="btn-cancelar-pago">Cancelar</button>
    </div>

    <div class="cuotas-lista">
      ${cuotas.map(c => `
        <div class="cuota-item cuota-${c.estado}" data-row="${c.rowIndex}">
          ${c.estado === 'pendiente' ? `<input type="checkbox" class="cuota-check" data-row="${c.rowIndex}" data-valor="${c.valorActual}" data-num="${c.numeroCuota}">` : '<span class="cuota-check-ph"></span>'}
          <span class="cuota-num">Cuota ${c.numeroCuota}</span>
          <span class="cuota-vence">${formatDateWithDay(c.fechaVencimiento)}</span>
          <span class="cuota-valor">${formatMoneda(c.valorActual, moneda)}</span>
          <span class="cuota-badge cuota-badge-${c.estado}">${c.estado === 'pagada' ? `✓ Pagada ${formatDate(c.fechaPago)}` : 'Pendiente'}</span>
          ${c.estado === 'pagada' && c.montoPagado ? `<span style="font-size:11px;color:#888">cobrado: ${formatMoneda(c.montoPagado, moneda)}</span>` : ''}
        </div>
      `).join('')}
    </div>

    <div style="margin-top:20px;border-top:1px solid var(--border-light);padding-top:16px">
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">¿Necesitás agregar más cuotas al plan?</p>
      ${formAgregarCuotas(cliente.id, cuotas.length, moneda)}
    </div>
  `;

  bindCuotasAcciones(cliente, cuotas, moneda);
}

function formCrearPlan(idCliente) {
  return `
    <form id="form-crear-plan" class="cuotas-form">
      <h4>Crear plan de pagos</h4>
      <div class="form-grid small-grid">
        <div class="form-group">
          <label>Moneda</label>
          <select id="plan-moneda" style="height:38px">
            <option value="ARS">$ Pesos (ARS)</option>
            <option value="USD">U$S Dólares (USD)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Actualización <span class="tip" data-tip="Fija: el valor de cada cuota no cambia salvo que lo modifiques manualmente. Por IPC: el sistema actualiza las cuotas pendientes automáticamente con el dato mensual del INDEC (datos.gob.ar) cuando presionás 'Aplicar IPC del mes'.">?</span></label>
          <select id="plan-indexacion" style="height:38px">
            <option value="fija">Cuotas fijas</option>
            <option value="ipc">Indexadas por IPC (INDEC)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Monto total del contrato <span class="tip" data-tip="El importe total acordado con el cliente por todo el servicio. Las cuotas se calculan sobre este monto.">?</span></label>
          <input type="number" id="plan-monto" min="0" required placeholder="600000">
        </div>
        <div class="form-group">
          <label>Cantidad de cuotas <span class="tip" data-tip="En cuántos pagos mensuales se divide. El sistema genera automáticamente una cuota por mes a partir de la fecha de inicio.">?</span></label>
          <input type="number" id="plan-ncuotas" min="1" max="60" required placeholder="6">
        </div>
        <div class="form-group">
          <label>Valor por cuota <span class="tip" data-tip="Opcional. Si lo dejás vacío se calcula automáticamente (monto ÷ cuotas). Completalo solo si el valor pactado es distinto, por redondeo o descuento especial.">?</span></label>
          <input type="number" id="plan-valor-cuota" min="0" placeholder="Auto (monto ÷ cuotas)">
        </div>
        <div class="form-group">
          <label>Fecha 1° cuota <span class="tip" data-tip="Fecha de vencimiento de la primera cuota. Las siguientes se generan mes a mes desde esta fecha.">?</span></label>
          <input type="date" id="plan-fecha" required value="${new Date().toISOString().split('T')[0]}">
        </div>
      </div>
      <p id="plan-preview" style="font-size:13px;color:#555;margin:6px 0"></p>
      <button type="submit" class="btn btn-primary btn-sm">Crear plan</button>
    </form>`;
}

function formAgregarCuotas(idCliente, totalActual, moneda = 'ARS') {
  const simbolo = moneda === 'USD' ? 'U$S' : '$';
  return `
    <form id="form-agregar-cuotas" class="cuotas-form" style="margin-top:0">
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="form-group" style="margin:0">
          <label style="font-size:12px">Agregar cuotas</label>
          <input type="number" id="agregar-ncuotas" min="1" max="24" placeholder="Cantidad" style="width:100px">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:12px">Valor c/u</label>
          <input type="number" id="agregar-valor" min="0" placeholder="${simbolo}" style="width:120px">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:12px">Fecha 1°</label>
          <input type="date" id="agregar-fecha" value="${new Date().toISOString().split('T')[0]}" style="width:150px">
        </div>
        <button type="submit" class="btn btn-sm btn-secondary">+ Agregar</button>
      </div>
    </form>`;
}

function bindFormCrearPlan(cliente) {
  const updatePreview = () => {
    const monto = parseFloat($('plan-monto')?.value) || 0;
    const n = parseInt($('plan-ncuotas')?.value) || 0;
    const valorCustom = parseFloat($('plan-valor-cuota')?.value) || 0;
    const moneda = $('plan-moneda')?.value || 'ARS';
    if (monto && n) {
      const v = valorCustom || Math.round(monto / n);
      $('plan-preview').textContent = `→ ${n} cuotas de ${formatMoneda(v, moneda)} c/u`;
    } else {
      $('plan-preview').textContent = '';
    }
  };
  $('plan-monto')?.addEventListener('input', updatePreview);
  $('plan-ncuotas')?.addEventListener('input', updatePreview);
  $('plan-valor-cuota')?.addEventListener('input', updatePreview);
  $('plan-moneda')?.addEventListener('change', updatePreview);

  $('form-crear-plan')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await apiFetch('/cuotas/plan', { method: 'POST', body: {
        idCliente: cliente.id,
        montoTotal: parseFloat($('plan-monto').value),
        cantidadCuotas: parseInt($('plan-ncuotas').value),
        valorCuota: parseFloat($('plan-valor-cuota').value) || null,
        fechaInicio: $('plan-fecha').value,
        moneda: $('plan-moneda').value || 'ARS',
        indexacion: $('plan-indexacion').value || 'fija',
      }});
      loadCuotasTab(cliente);
    } catch (err) { alert(err.message); btn.disabled = false; }
  });
}

function bindCuotasAcciones(cliente, cuotas, moneda = 'ARS') {
  // Pagar seleccionadas
  $('btn-pagar-sel')?.addEventListener('click', () => {
    const checked = [...document.querySelectorAll('.cuota-check:checked')];
    if (!checked.length) { alert('Seleccioná al menos una cuota.'); return; }
    // Auto-calcular monto total de las cuotas seleccionadas
    const montoAuto = checked.reduce((s, c) => s + (parseFloat(c.dataset.valor) || 0), 0);
    const montoInput = $('monto-efectivo-input');
    if (montoInput) montoInput.value = montoAuto;
    const row = $('fecha-pago-row');
    row.style.display = 'flex';
    row.classList.remove('hidden');
  });

  $('btn-cancelar-pago')?.addEventListener('click', () => {
    $('fecha-pago-row').style.display = 'none';
    document.querySelectorAll('.cuota-check').forEach(c => { c.checked = false; });
  });

  $('btn-confirmar-plan')?.addEventListener('click', async () => {
    const noConf = cuotas.filter(c => !c.confirmado);
    if (!noConf.length) return;
    try {
      await apiFetch('/cuotas/confirmar', { method: 'PUT', body: { rowIndices: noConf.map(c => c.rowIndex) } });
      loadCuotasTab(cliente);
    } catch (err) { alert('Error al confirmar: ' + err.message); }
  });

  $('btn-confirmar-pago')?.addEventListener('click', async () => {
    const checked = [...document.querySelectorAll('.cuota-check:checked')];
    if (!checked.length) return;
    const rowIndices = checked.map(c => parseInt(c.dataset.row));
    const numeros = checked.map(c => c.dataset.num);
    const montoTotal = checked.reduce((s, c) => s + (parseFloat(c.dataset.valor) || 0), 0);
    const montoEfectivo = parseFloat($('monto-efectivo-input').value) || montoTotal;
    const monedaPago = $('moneda-pago-cuota').value || moneda;
    const descripcion = `Cuota${numeros.length > 1 ? 's' : ''} ${numeros.join(', ')}`;
    const fechaPago = $('fecha-pago-input').value;
    const formaPago = $('forma-pago-cuota').value;
    const notas = $('notas-pago-input').value;
    try {
      await apiFetch('/cuotas/pagar', { method: 'PUT', body: {
        rowIndices, fechaPago, notas,
        idCliente: cliente.id,
        formaPago,
        montoTotal,
        montoEfectivo,
        monedaPago,
        descripcion,
      }});
      loadCuotasTab(cliente);
    } catch (err) { alert(err.message); }
  });

  // IPC automático (solo para planes indexados)
  $('btn-ipc-auto')?.addEventListener('click', async () => {
    const btn = $('btn-ipc-auto');
    btn.disabled = true;
    btn.textContent = 'Consultando INDEC...';
    try {
      const { porcentaje, mes } = await apiFetch('/cuotas/ipc-actual');
      const mesLabel = mes ? ` (${mes})` : '';
      if (!confirm(`IPC del INDEC${mesLabel}: ${porcentaje}%\n\n¿Aplicar a las cuotas pendientes indexadas por IPC?`)) {
        btn.disabled = false; btn.textContent = '📈 Aplicar IPC del mes'; return;
      }
      const r = await apiFetch('/cuotas/ipc-indexados', { method: 'PUT', body: { idCliente: cliente.id, porcentaje } });
      alert(`IPC ${porcentaje}%${mesLabel} aplicado a ${r.updated} cuota(s).`);
      loadCuotasTab(cliente);
    } catch (err) {
      alert('No se pudo obtener el IPC del INDEC.\n' + err.message);
      btn.disabled = false; btn.textContent = '📈 Aplicar IPC del mes';
    }
  });

  // IPC manual (solo para planes fijos con ajuste manual)
  $('btn-ipc')?.addEventListener('click', async () => {
    const pct = parseFloat($('ipc-pct').value);
    if (!pct || pct <= 0) { alert('Ingresá un porcentaje válido.'); return; }
    if (!confirm(`¿Aplicar ${pct}% a todas las cuotas pendientes?`)) return;
    try {
      const r = await apiFetch('/cuotas/ipc', { method: 'PUT', body: { idCliente: cliente.id, porcentaje: pct } });
      alert(`Ajuste aplicado a ${r.updated} cuota(s).`);
      loadCuotasTab(cliente);
    } catch (err) { alert(err.message); }
  });

  // Ajustar valor fijo
  $('btn-ajustar-val')?.addEventListener('click', async () => {
    const val = parseFloat($('nuevo-valor').value);
    if (!val || val <= 0) { alert('Ingresá el nuevo valor de cuota.'); return; }
    if (!confirm(`¿Fijar ${formatMoneda(val, moneda)} como valor de todas las cuotas pendientes?`)) return;
    try {
      const r = await apiFetch('/cuotas/ajustar', { method: 'PUT', body: { idCliente: cliente.id, nuevoValor: val } });
      alert(`Valor actualizado en ${r.updated} cuota(s).`);
      loadCuotasTab(cliente);
    } catch (err) { alert(err.message); }
  });

  // Borrar plan (admin)
  $('btn-reset-plan')?.addEventListener('click', async () => {
    if (!confirm('¿Borrar todo el plan de pagos? Esta acción no se puede deshacer.')) return;
    try {
      await apiFetch(`/cuotas/plan/${cliente.id}`, { method: 'DELETE' });
      loadCuotasTab(cliente);
    } catch (err) { alert(err.message); }
  });

  // Agregar cuotas extra
  $('form-agregar-cuotas')?.addEventListener('submit', async e => {
    e.preventDefault();
    const n = parseInt($('agregar-ncuotas').value);
    const valor = parseFloat($('agregar-valor').value);
    const fecha = $('agregar-fecha').value;
    if (!n || !valor || !fecha) { alert('Completá todos los campos.'); return; }
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await apiFetch('/cuotas/plan', { method: 'POST', body: {
        idCliente: cliente.id,
        montoTotal: valor * n,
        cantidadCuotas: n,
        valorCuota: valor,
        fechaInicio: fecha,
        moneda,
        indexacion,
      }});
      loadCuotasTab(cliente);
    } catch (err) { alert(err.message); btn.disabled = false; }
  });
}

/* ===================== CORRECCIÓN DE NOMBRE ===================== */

// Construye el body completo para un PUT de cliente, con overrides opcionales
function buildClienteBody(c, overrides = {}) {
  return {
    id: c.id,
    personaId: c.personaId,
    personaRowIndex: c.personaRowIndex,
    estado: c.estado,
    apellidoNombre: c.apellidoNombre,
    telefono: c.telefono,
    gmail: c.gmail,
    redSocial: c.redSocial,
    tipoEvento: c.tipoEvento,
    formato: c.formato,
    fechaEvento: c.fechaEvento,
    estadoFecha: c.estadoFecha,
    cantidadInvitados: c.cantidadInvitados,
    turno: c.turno,
    tipoCliente: c.tipoCliente,
    exclienteReferencia: c.exclienteReferencia,
    exclienteNota: c.exclienteNota,
    origen: c.origen,
    presupuesto: c.presupuesto,
    montoPresupuesto: c.montoPresupuesto,
    menuInfantil: c.menuInfantil,
    otrosPedidos: c.otrosPedidos,
    observaciones: c.observaciones,
    proximoSeguimiento: c.proximoSeguimiento,
    menuRecepcion: c.menuRecepcion,
    menuIslas: c.menuIslas,
    menuPrimerPlato: c.menuPrimerPlato,
    menuPrincipal: c.menuPrincipal,
    menuPostre: c.menuPostre,
    nombreAgasajado: c.nombreAgasajado,
    cargadoPor: c.cargadoPor,
    fechaCarga: c.fechaCarga,
    ...overrides,
  };
}

function injectNombreAcciones(cliente) {
  const wrap = document.querySelector('.modal-nombre-wrap');
  const sugerenciaArea = $('nombre-sugerencia-area');
  if (!wrap) return;

  // Limpiar acciones previas (todo excepto el h3)
  wrap.querySelectorAll('.nombre-accion').forEach(el => el.remove());
  if (sugerenciaArea) sugerenciaArea.innerHTML = '';

  const obs = cliente.observaciones || '';
  const match = obs.match(SUGERENCIA_REGEX);

  if (canEditNombre()) {
    // Botón lápiz para editar nombre
    const btn = document.createElement('button');
    btn.className = 'btn-nombre-icono nombre-accion';
    btn.title = 'Editar nombre';
    btn.innerHTML = '✎';
    btn.addEventListener('click', () => startInlineNombreEdit(cliente));
    wrap.appendChild(btn);

    // Si hay sugerencia pendiente de Empleado, mostrar banner
    if (match && sugerenciaArea) {
      renderSugerenciaBanner(sugerenciaArea, match[1], cliente);
    }
  } else if (currentUser.usuario === 'empleado') {
    if (match) {
      // Empleado ya sugirió — mostrar su sugerencia y opción de cambiarla
      const tag = document.createElement('span');
      tag.className = 'nombre-sugerida-tag nombre-accion';
      tag.title = `Sugeriste: "${match[1]}"`;
      tag.textContent = `→ "${match[1]}"`;
      wrap.appendChild(tag);

      const btn = document.createElement('button');
      btn.className = 'btn-nombre-icono sugerir-icon nombre-accion';
      btn.title = 'Cambiar sugerencia';
      btn.innerHTML = '✎';
      btn.addEventListener('click', () => showSugerirNombreForm(cliente));
      wrap.appendChild(btn);
    } else {
      // Empleado no ha sugerido aún — botón de bandera
      const btn = document.createElement('button');
      btn.className = 'btn-nombre-icono sugerir-icon nombre-accion';
      btn.title = 'Sugerir corrección de nombre';
      btn.innerHTML = '⚑';
      btn.addEventListener('click', () => showSugerirNombreForm(cliente));
      wrap.appendChild(btn);
    }
  }
}

function startInlineNombreEdit(cliente, valorInicial = null) {
  const wrap = document.querySelector('.modal-nombre-wrap');
  if (!wrap) return;
  const val = valorInicial !== null ? valorInicial : (cliente.apellidoNombre || '');

  wrap.innerHTML = `
    <div class="nombre-edit-inline">
      <input id="nombre-edit-input" type="text" value="${esc(val)}" placeholder="Apellido y nombre">
      <button class="btn btn-sm btn-primary" id="btn-nombre-save">Guardar</button>
      <button class="btn btn-sm btn-secondary" id="btn-nombre-cancel">Cancelar</button>
    </div>`;

  const input = $('nombre-edit-input');
  input.focus();
  input.select();

  const cancelar = () => {
    wrap.innerHTML = `<h3 id="modal-titulo">${esc(cliente.apellidoNombre) || 'Cliente'}</h3>`;
    injectNombreAcciones(cliente);
  };

  $('btn-nombre-cancel').addEventListener('click', cancelar);
  $('btn-nombre-save').addEventListener('click', () => saveNombreEdit(cliente, input.value.trim()));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveNombreEdit(cliente, input.value.trim());
    if (e.key === 'Escape') cancelar();
  });
}

async function saveNombreEdit(cliente, nuevoNombre) {
  if (!nuevoNombre) return;
  if (nuevoNombre === cliente.apellidoNombre) {
    const wrap = document.querySelector('.modal-nombre-wrap');
    wrap.innerHTML = `<h3 id="modal-titulo">${esc(cliente.apellidoNombre) || 'Cliente'}</h3>`;
    injectNombreAcciones(cliente);
    return;
  }

  const btn = $('btn-nombre-save');
  if (btn) btn.disabled = true;

  try {
    // Al guardar, limpiar también la sugerencia del empleado
    const obsLimpio = (cliente.observaciones || '').replace(SUGERENCIA_REGEX, '').trim();
    const body = buildClienteBody(cliente, { apellidoNombre: nuevoNombre, observaciones: obsLimpio });

    await apiFetch(`/clientes/${cliente.rowIndex}`, { method: 'PUT', body });

    // Actualizar estado local
    cliente.apellidoNombre = nuevoNombre;
    cliente.observaciones = obsLimpio;
    const idx = allClientes.findIndex(c => c.id === cliente.id);
    if (idx !== -1) Object.assign(allClientes[idx], { apellidoNombre: nuevoNombre, observaciones: obsLimpio });

    const wrap = document.querySelector('.modal-nombre-wrap');
    wrap.innerHTML = `<h3 id="modal-titulo">${esc(nuevoNombre)}</h3>`;
    injectNombreAcciones(cliente);
    renderClienteDetail(cliente);

  } catch (err) {
    alert('Error al guardar: ' + err.message);
    if (btn) btn.disabled = false;
  }
}

function showSugerirNombreForm(cliente) {
  const wrap = document.querySelector('.modal-nombre-wrap');
  if (!wrap) return;

  const obs = cliente.observaciones || '';
  const match = obs.match(SUGERENCIA_REGEX);
  const valorActual = match ? match[1] : '';

  wrap.innerHTML = `
    <h3 style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px">${esc(cliente.apellidoNombre) || 'Cliente'}</h3>
    <div class="sugerir-nombre-form">
      <span class="sugerir-arrow">→ debería ser:</span>
      <input id="nombre-sugerido-input" type="text" value="${esc(valorActual)}" placeholder="Nombre correcto...">
      <button class="btn btn-sm btn-primary" id="btn-sugerencia-save">Sugerir</button>
      <button class="btn btn-sm btn-secondary" id="btn-sugerencia-cancel">Cancelar</button>
    </div>`;

  const input = $('nombre-sugerido-input');
  input.focus();

  const cancelar = () => {
    wrap.innerHTML = `<h3 id="modal-titulo">${esc(cliente.apellidoNombre) || 'Cliente'}</h3>`;
    injectNombreAcciones(cliente);
  };

  $('btn-sugerencia-cancel').addEventListener('click', cancelar);
  $('btn-sugerencia-save').addEventListener('click', () => {
    const s = input.value.trim();
    if (s) saveSugerenciaNombre(cliente, s);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const s = input.value.trim(); if (s) saveSugerenciaNombre(cliente, s); }
    if (e.key === 'Escape') cancelar();
  });
}

async function saveSugerenciaNombre(cliente, nombreSugerido) {
  const btn = $('btn-sugerencia-save');
  if (btn) btn.disabled = true;

  try {
    const fecha = new Date().toLocaleDateString('es-AR');
    const marker = `[SUGERENCIA_NOMBRE: "${nombreSugerido}" · Empleado · ${fecha}]`;
    const obsBase = (cliente.observaciones || '').replace(SUGERENCIA_REGEX, '').trim();
    const obsNuevo = obsBase ? `${marker}\n${obsBase}` : marker;

    const body = buildClienteBody(cliente, { observaciones: obsNuevo });
    await apiFetch(`/clientes/${cliente.rowIndex}`, { method: 'PUT', body });

    cliente.observaciones = obsNuevo;
    const idx = allClientes.findIndex(c => c.id === cliente.id);
    if (idx !== -1) allClientes[idx].observaciones = obsNuevo;

    const wrap = document.querySelector('.modal-nombre-wrap');
    wrap.innerHTML = `<h3 id="modal-titulo">${esc(cliente.apellidoNombre) || 'Cliente'}</h3>`;
    injectNombreAcciones(cliente);

  } catch (err) {
    alert('Error al guardar: ' + err.message);
    if (btn) btn.disabled = false;
  }
}

function renderSugerenciaBanner(container, nombreSugerido, cliente) {
  container.innerHTML = `
    <div class="sugerencia-nombre-banner">
      <span style="font-size:16px;flex-shrink:0">⚑</span>
      <div class="sugerencia-banner-body">
        <strong>Empleado sugiere corregir el nombre a:</strong>
        <span class="sugerencia-banner-nombre"> "${esc(nombreSugerido)}"</span>
      </div>
      <div class="sugerencia-banner-acciones">
        <button class="btn btn-sm btn-primary" id="btn-aplicar-sugerencia">Aplicar</button>
        <button class="btn btn-sm btn-secondary" id="btn-descartar-sugerencia">Descartar</button>
      </div>
    </div>`;

  $('btn-aplicar-sugerencia').addEventListener('click', () => {
    startInlineNombreEdit(cliente, nombreSugerido);
  });

  $('btn-descartar-sugerencia').addEventListener('click', async () => {
    if (!confirm('¿Descartás la sugerencia del empleado?')) return;
    const obsLimpio = (cliente.observaciones || '').replace(SUGERENCIA_REGEX, '').trim();
    try {
      const body = buildClienteBody(cliente, { observaciones: obsLimpio });
      await apiFetch(`/clientes/${cliente.rowIndex}`, { method: 'PUT', body });
      cliente.observaciones = obsLimpio;
      const idx = allClientes.findIndex(c => c.id === cliente.id);
      if (idx !== -1) allClientes[idx].observaciones = obsLimpio;
      container.innerHTML = '';
    } catch (err) { alert(err.message); }
  });
}

/* ===================== TIMING PLANNER ===================== */

function timePicker(id, value = '', extraClass = '') {
  const [h = '00', m = '00'] = value ? value.split(':') : ['00', '00'];
  const hrs = Array.from({length: 24}, (_, i) => {
    const v = String(i).padStart(2, '0');
    return `<option value="${v}"${h === v ? ' selected' : ''}>${v}</option>`;
  }).join('');
  const mins = ['00','05','10','15','20','25','30','35','40','45','50','55'].map(v =>
    `<option value="${v}"${m === v ? ' selected' : ''}>${v}</option>`
  ).join('');
  const cls = extraClass ? ` class="${extraClass}"` : '';
  return `<span class="tim-picker-wrap"><select class="tim-pick-h" data-picker="${id}">${hrs}</select><span class="tim-pick-sep">:</span><select class="tim-pick-m" data-picker="${id}">${mins}</select><input type="hidden" id="${id}"${cls} value="${value || h + ':' + m}"></span>`;
}

function bindAllTimePickers(container) {
  (container || document).querySelectorAll('.tim-pick-h, .tim-pick-m').forEach(sel => {
    sel.addEventListener('change', () => {
      const id = sel.dataset.picker;
      const wrap = sel.closest('.tim-picker-wrap');
      if (!wrap) return;
      const hv = wrap.querySelector('.tim-pick-h').value;
      const mv = wrap.querySelector('.tim-pick-m').value;
      const hidden = document.getElementById(id);
      if (hidden) hidden.value = `${hv}:${mv}`;
    });
  });
}

function setTimePicker(id, value) {
  const hidden = document.getElementById(id);
  if (!hidden) return;
  hidden.value = value || '';
  const wrap = hidden.closest('.tim-picker-wrap');
  if (!wrap) return;
  const [h = '00', m = '00'] = (value || '').split(':');
  const hSel = wrap.querySelector('.tim-pick-h');
  const mSel = wrap.querySelector('.tim-pick-m');
  if (hSel) hSel.value = h;
  if (mSel) mSel.value = m.padEnd(2, '0').substring(0, 2);
}

const ACTIVIDADES_TIMMING = [
  'RECEPCIÓN',
  'ISLAS',
  'PRIMER PLATO',
  'PLATO CENTRAL',
  'SHOW',
  'TORTA HOMENAJE',
  'MESA DE DULCES',
  'CAFETERÍA',
  'POSTRE',
  'FIN DE FIESTA',
];

/* ===================== MENÚ COCINA ===================== */
const MENU_COCINA = {
  canapes: [
    'Bocado mediterráneo', 'Jamón Imperial', 'Palma Serrana', 'Azul y Nuez', 'Bosque y Queso',
  ],
  bruschettas: [
    'Braseada suave', 'Campo verde', 'Delicia Ibérica', 'BBQ',
  ],
  recepcionOtros: [
    'Variedad de triples de miga', 'Arrollados',
  ],
  brochettes: [
    'Criolla de carne', 'Italiana', 'Criolla de pollo',
  ],
  empanaditas: [
    'Fatay de carne', 'Soles de calabaza y semillas grilladas', 'Canastitas de batata y almendra',
    'Jamón y queso', 'Cebolla y queso', 'Paquetitos de boniato y amapola', 'Pollo', 'Fingers de zanahoria',
  ],
  calientesOtros: [
    'Daditos de mozzarella', 'Mini hamburguesas caseras', 'Pollo frito (Buffalo wings)', 'Croquetitas de papa',
  ],
};
const PASTAS_OPT = [
  'Tagliatelle', 'Sorrentinos de jamón y queso', 'Canelones de verdura y ricota',
  'Ravioloni de espinaca y parmesano', 'Agnolotis de pollo', 'Ñoquis de papa',
];
const PASTAS_GOURMET_OPT = [
  'Sorrentinos de trucha y almendras', 'Fagotinnis de cordero y romero', 'Sorrentinos de salmón y philadelphia',
];
const SALSAS_OPT = [
  'Filetto', 'Bolognesa', 'Rosé', 'Cuatro quesos', 'Crema de espinaca', 'Italiana', 'Salsa blanca',
];
const SALSAS_GOURMET_OPT = [
  'Portobellos y ciboulette', 'Queso azul y nuez',
];
const ISLAS_OPT = [
  'Mesa de fiambres', 'Sushi', 'Tacos',
];
const PLATO_CENTRAL_AVE_OPT = [
  'Pechuga tradición', 'Pechuga caprese', 'Pechuga doble puerro',
];
const PLATO_CENTRAL_CARNE_OPT = [
  'Lomo Reserva', 'Bife del bosque', 'Lomo Dijon',
];
const GUARNICION_OPT = [
  'Rosti de papa', 'Papas a la suiza gratinadas', 'Milhojas de papa',
];
const MESA_DULCES_OPT = [
  'Lemon pie', 'Cheese cake', 'Chocotorta', 'Torta África', 'Tarta de frutillas',
  'Flan', 'Mil Hojas', 'Brownies relleno', 'Copas Heladas', 'Panqueques',
  'Torta Homenaje', 'Presentaciones Individuales',
];
const FIN_FIESTA_OPT = [
  'Café con leche y mini facturas', 'Pizza con cerveza', 'Mate con bizcochitos',
];

function actividadSelectHTML(selectId, customId, valor = '') {
  const esPredefinida = ACTIVIDADES_TIMMING.includes(valor.toUpperCase());
  const esOtro = valor && !esPredefinida;
  const opts = ACTIVIDADES_TIMMING.map(a =>
    `<option${a === valor.toUpperCase() && esPredefinida ? ' selected' : ''}>${a}</option>`
  ).join('');
  return `
    <select id="${selectId}" class="tim-select">
      <option value="">-- Actividad --</option>
      ${opts}
      <option value="otro"${esOtro ? ' selected' : ''}>✏️ Otro (escribir)</option>
    </select>
    <input type="text" id="${customId}" class="tim-custom-act"
      placeholder="Escribí la actividad…"
      value="${esOtro ? esc(valor) : ''}"
      ${esOtro ? '' : 'hidden'}>`;
}

function bindActividadToggle(selectId, customId) {
  const sel = document.getElementById(selectId);
  const inp = document.getElementById(customId);
  if (!sel || !inp) return;
  sel.addEventListener('change', () => {
    if (sel.value === 'otro') { inp.hidden = false; inp.focus(); }
    else { inp.hidden = true; inp.value = ''; }
  });
}

function getActividadValue(selectId, customId) {
  const sel = document.getElementById(selectId);
  const inp = document.getElementById(customId);
  if (!sel) return '';
  return sel.value === 'otro' ? (inp?.value.trim() || '') : sel.value;
}



async function loadTimmingTab(cliente) {
  const con = $('timming-content');
  if (!con) return;
  con.innerHTML = '<p style="color:#999;font-size:13px;padding:16px 0">Cargando timing...</p>';
  try {
    const [items, restricciones] = await Promise.all([
      apiFetch(`/timming/cliente/${cliente.id}`),
      apiFetch(`/restricciones/cliente/${cliente.id}`),
    ]);
    currentRestricciones = restricciones;
    renderTimming(cliente, items, restricciones);
  } catch (e) {
    con.innerHTML = `<p style="color:#c0392b;font-size:13px">${e.message}</p>`;
  }
}

function renderTimming(cliente, items, restricciones) {
  const con = $('timming-content');
  if (!con) return;

  const maitreItems = items.filter(i => (i.tipo || 'maitre') !== 'cocina');
  const cocinaItem = items.find(i => i.tipo === 'cocina');

  con.innerHTML = `
    <div id="tim-rest-panel"></div>
    <div class="tim-subtabs">
      <button class="tim-subtab-btn active" data-subtab="maitre">Timing Maitre</button>
      <button class="tim-subtab-btn" data-subtab="cocina">Timing Cocina</button>
    </div>
    <div id="tim-panel-maitre" class="tim-panel"></div>
    <div id="tim-panel-cocina" class="tim-panel" style="display:none"></div>`;

  renderTimmingRestricciones(cliente, restricciones || []);
  renderTimmingMaitre(cliente, maitreItems);
  renderTimmingCocina(cliente, cocinaItem);

  con.querySelectorAll('.tim-subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      con.querySelectorAll('.tim-subtab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.subtab;
      $('tim-panel-maitre').style.display = tab === 'maitre' ? '' : 'none';
      $('tim-panel-cocina').style.display = tab === 'cocina' ? '' : 'none';
    });
  });
}

const TIPOS_RESTRICCION = [
  'Sin TACC', 'Celíaco', 'Vegano', 'Vegetariano', 'Diabético', 'Hipertenso',
  'Alérgico al mariscos', 'Alérgico al maní', 'Kosher', 'Halal', 'Otro',
];

function renderTimmingRestricciones(cliente, lista) {
  const panel = $('tim-rest-panel');
  if (!panel) return;

  const filas = lista.length
    ? lista.map(r => `
        <div class="tim-rest-item">
          <span>${r.coronita ? '👑 ' : ''}<strong>${esc(r.tipoRestriccion)}</strong> — ${r.cantidad} pax</span>
          <button class="btn-tim-del" data-row="${r.rowIndex}">✕</button>
        </div>`).join('')
    : '<span class="tim-rest-empty">Sin restricciones.</span>';

  panel.innerHTML = `
    <div class="tim-rest-wrap">
      <div class="tim-rest-header">
        <span class="tim-rest-title">Restricciones alimentarias</span>
        <button class="btn btn-xs btn-secondary" id="btn-toggle-rest-form">+ Agregar</button>
      </div>
      <div class="tim-rest-list">${filas}</div>
      <form id="tim-rest-form" class="tim-rest-form" style="display:none">
        <select id="tim-rest-tipo" class="form-select form-select-sm" style="flex:1;min-width:140px">
          <option value="">-- Tipo --</option>
          ${TIPOS_RESTRICCION.map(t => `<option>${t}</option>`).join('')}
        </select>
        <input type="text" id="tim-rest-tipo-otro" placeholder="Especificar..." style="display:none;flex:1" class="form-input">
        <input type="number" id="tim-rest-cantidad" placeholder="Cant." min="1" value="1" class="form-input" style="width:64px">
        <label style="font-size:12px;display:flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer">
          <input type="checkbox" id="tim-rest-coronita"> 👑 Mesa principal
        </label>
        <button type="submit" class="btn btn-sm btn-primary">Agregar</button>
      </form>
    </div>`;

  $('btn-toggle-rest-form')?.addEventListener('click', () => {
    const form = $('tim-rest-form');
    form.style.display = form.style.display === 'none' ? 'flex' : 'none';
    if (form.style.display !== 'none') $('tim-rest-tipo').focus();
  });

  $('tim-rest-tipo')?.addEventListener('change', () => {
    const isOtro = $('tim-rest-tipo').value === 'Otro';
    $('tim-rest-tipo-otro').style.display = isOtro ? '' : 'none';
  });

  $('tim-rest-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const tipoSelect = $('tim-rest-tipo').value;
    const tipoRestriccion = tipoSelect === 'Otro' ? $('tim-rest-tipo-otro').value.trim() : tipoSelect;
    if (!tipoRestriccion) { alert('Ingresá el tipo'); return; }
    const cantidad = $('tim-rest-cantidad').value;
    const coronita = $('tim-rest-coronita').checked;
    try {
      await apiFetch('/restricciones', { method: 'POST', body: { idCliente: cliente.id, tipoRestriccion, cantidad, coronita } });
      loadTimmingTab(cliente);
    } catch (err) { alert(err.message); }
  });

  panel.querySelectorAll('.btn-tim-del[data-row]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rowIndex = parseInt(btn.dataset.row);
      if (!confirm('¿Eliminar esta restricción?')) return;
      try {
        await apiFetch(`/restricciones/${rowIndex}`, { method: 'DELETE' });
        loadTimmingTab(cliente);
      } catch (err) { alert(err.message); }
    });
  });
}

function renderTimmingMaitre(cliente, items) {
  const panel = $('tim-panel-maitre');
  if (!panel) return;

  const filas = items.length
    ? items.map(it => `
        <div class="tim-item" data-row="${it.rowIndex}">
          <span class="tim-hora">${it.hora}</span>
          <div class="tim-info">
            <span class="tim-actividad">${esc(it.actividad)}</span>
            ${it.descripcion ? `<span class="tim-desc">${esc(it.descripcion)}</span>` : ''}
          </div>
          <div class="tim-acciones">
            <button class="btn-tim-edit" title="Editar">✎</button>
            <button class="btn-tim-del" title="Eliminar">✕</button>
          </div>
        </div>`).join('')
    : '<p class="tim-empty">Sin actividades cargadas aún.</p>';

  panel.innerHTML = `
    <div class="timming-wrap">
      <div class="timming-header-row">
        <h4 class="timming-title">Cronograma del maître</h4>
        <button id="btn-print-timming" class="btn btn-sm btn-secondary">🖨 Imprimir</button>
      </div>
      <div class="tim-list">${filas}</div>
      <form id="timming-add-form" class="tim-add-form">
        <div class="tim-add-row1">
          ${timePicker('tim-hora')}
          <div class="tim-actividad-wrap">
            ${actividadSelectHTML('tim-actividad-select', 'tim-actividad-custom')}
          </div>
        </div>
        <div class="tim-add-row2">
          <input type="text" id="tim-descripcion" placeholder="Descripción / observación (ej: Cantante, preparar escenario)" class="tim-desc-input">
          <button type="submit" class="btn btn-sm btn-primary">+ Agregar</button>
        </div>
      </form>
    </div>`;

  bindMaitreAcciones(cliente, items);
}

function bindMaitreAcciones(cliente, items) {
  bindActividadToggle('tim-actividad-select', 'tim-actividad-custom');
  bindAllTimePickers($('timming-add-form'));

  document.querySelectorAll('.btn-tim-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.tim-item');
      const rowIndex = parseInt(row.dataset.row);
      const item = items.find(i => i.rowIndex === rowIndex);
      if (!item) return;
      row.innerHTML = `
        ${timePicker('tim-edit-hora', item.hora, 'tim-edit-hora')}
        <div class="tim-info" style="flex:1">
          <div class="tim-actividad-wrap">
            ${actividadSelectHTML('tim-edit-act-select', 'tim-edit-act-custom', item.actividad)}
          </div>
          <input type="text" class="tim-edit-desc tim-desc-input" value="${esc(item.descripcion || '')}" placeholder="Descripción / observación">
        </div>
        <div class="tim-acciones">
          <button class="btn-tim-save btn btn-sm btn-primary">✓</button>
          <button class="btn-tim-cancel btn btn-sm btn-secondary">✕</button>
        </div>`;
      bindActividadToggle('tim-edit-act-select', 'tim-edit-act-custom');
      bindAllTimePickers(row);

      row.querySelector('.btn-tim-save').addEventListener('click', async () => {
        const hora = row.querySelector('.tim-edit-hora').value;
        const actividad = getActividadValue('tim-edit-act-select', 'tim-edit-act-custom');
        const descripcion = row.querySelector('.tim-edit-desc').value.trim();
        if (!hora || !actividad) return;
        try {
          await apiFetch(`/timming/${rowIndex}`, { method: 'PUT', body: { hora, actividad, tipo: 'maitre', descripcion } });
          loadTimmingTab(cliente);
        } catch (e) { alert(e.message); }
      });
      row.querySelector('.btn-tim-cancel').addEventListener('click', () => loadTimmingTab(cliente));
    });
  });

  document.querySelectorAll('.btn-tim-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.tim-item');
      const rowIndex = parseInt(row.dataset.row);
      if (!confirm('¿Eliminar esta actividad?')) return;
      try {
        await apiFetch(`/timming/${rowIndex}`, { method: 'DELETE' });
        loadTimmingTab(cliente);
      } catch (e) { alert(e.message); }
    });
  });

  $('timming-add-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const hora = $('tim-hora').value;
    const actividad = getActividadValue('tim-actividad-select', 'tim-actividad-custom');
    const descripcion = $('tim-descripcion')?.value.trim() || '';
    if (!hora || !actividad) return;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await apiFetch('/timming', { method: 'POST', body: { idCliente: cliente.id, hora, actividad, tipo: 'maitre', descripcion } });
      loadTimmingTab(cliente);
    } catch (err) { alert(err.message); btn.disabled = false; }
  });

  $('btn-print-timming')?.addEventListener('click', () => imprimirTimming(cliente, items));
}

/* ===================== TIMING COCINA ===================== */

function checkboxListHTML(items, selectedArr, prefix) {
  return items.map(item => {
    const checked = selectedArr && selectedArr.includes(item) ? 'checked' : '';
    const id = `${prefix}-${item.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '')}`;
    return `<label class="coc-check"><input type="checkbox" class="${prefix}-check" value="${esc(item)}" ${checked}> ${esc(item)}</label>`;
  }).join('');
}

function getCocinaFormData() {
  const getChecked = cls => [...document.querySelectorAll(`.${cls}-check:checked`)].map(el => el.value);
  return {
    horaRecepcion: $('coc-hora-recepcion')?.value || '',
    canapes: getChecked('coc-canape'),
    bruschettas: getChecked('coc-bruschetta'),
    recepcionOtros: getChecked('coc-rf-otros'),
    brochettes: getChecked('coc-brochette'),
    empanaditas: getChecked('coc-empanadita'),
    calientesOtros: getChecked('coc-rc-otros'),
    horaIslas: $('coc-hora-islas')?.value || '',
    islas: [
      ...getChecked('coc-isla'),
      ...($('coc-isla-extra')?.value.trim() ? [$('coc-isla-extra').value.trim()] : []),
    ],
    horaPrimerPlato: $('coc-hora-primer-plato')?.value || '',
    pastas: getChecked('coc-pasta'),
    pastasGourmet: getChecked('coc-pasta-gourmet'),
    cantidadSalsas: parseInt($('coc-nsalsas')?.value) || 0,
    salsas: getChecked('coc-salsa'),
    salsasGourmet: getChecked('coc-salsa-gourmet'),
    horaPlatoCentral: $('coc-hora-plato-central')?.value || '',
    platoCentralAve: $('coc-plato-ave')?.value || '',
    guarnicionAve: $('coc-guarnicion-ave')?.value || '',
    platoCentralCarne: $('coc-plato-carne')?.value || '',
    guarnicionCarne: $('coc-guarnicion-carne')?.value || '',
    horaMesaDulces: $('coc-hora-mesa-dulces')?.value || '',
    mesaDulces: getChecked('coc-dulce'),
    postre: $('coc-postre')?.value.trim() || '',
    horaCafeteria: $('coc-hora-cafeteria')?.value || '',
    finFiesta: getChecked('coc-fin-fiesta'),
  };
}

function setCocinaFormData(d) {
  if (!d) return;
  const setChecked = (cls, arr) => {
    document.querySelectorAll(`.${cls}-check`).forEach(el => {
      el.checked = arr && arr.includes(el.value);
    });
  };
  setTimePicker('coc-hora-recepcion', d.horaRecepcion || '');
  setChecked('coc-canape', d.canapes);
  setChecked('coc-bruschetta', d.bruschettas);
  setChecked('coc-rf-otros', d.recepcionOtros);
  setChecked('coc-brochette', d.brochettes);
  setChecked('coc-empanadita', d.empanaditas);
  setChecked('coc-rc-otros', d.calientesOtros);
  setTimePicker('coc-hora-islas', d.horaIslas || '');
  setChecked('coc-isla', d.islas);
  if ($('coc-isla-extra')) $('coc-isla-extra').value = '';
  setTimePicker('coc-hora-primer-plato', d.horaPrimerPlato || '');
  setChecked('coc-pasta', d.pastas);
  setChecked('coc-pasta-gourmet', d.pastasGourmet);
  if ($('coc-nsalsas')) $('coc-nsalsas').value = d.cantidadSalsas || '';
  setChecked('coc-salsa', d.salsas);
  setChecked('coc-salsa-gourmet', d.salsasGourmet);
  setTimePicker('coc-hora-plato-central', d.horaPlatoCentral || '');
  if ($('coc-plato-ave')) $('coc-plato-ave').value = d.platoCentralAve || '';
  if ($('coc-guarnicion-ave')) $('coc-guarnicion-ave').value = d.guarnicionAve || '';
  if ($('coc-plato-carne')) $('coc-plato-carne').value = d.platoCentralCarne || '';
  if ($('coc-guarnicion-carne')) $('coc-guarnicion-carne').value = d.guarnicionCarne || '';
  setTimePicker('coc-hora-mesa-dulces', d.horaMesaDulces || '');
  setChecked('coc-dulce', d.mesaDulces);
  if ($('coc-postre')) $('coc-postre').value = d.postre || '';
  setTimePicker('coc-hora-cafeteria', d.horaCafeteria || '');
  setChecked('coc-fin-fiesta', d.finFiesta);
}

function renderTimmingCocina(cliente, cocinaItem) {
  const panel = $('tim-panel-cocina');
  if (!panel) return;

  let cocinaData = {};
  let cocinaRowIndex = null;
  if (cocinaItem) {
    try { cocinaData = JSON.parse(cocinaItem.actividad); } catch {}
    cocinaRowIndex = cocinaItem.rowIndex;
  }

  const chk = (cls, items, sel) => checkboxListHTML(items, sel, cls);
  const secHeader = (titulo, horaId, horaVal) => `
    <div class="coc-section-header">
      <div class="coc-section-title">${titulo}</div>
      ${timePicker(horaId, horaVal || '')}
    </div>`;

  panel.innerHTML = `
    <div class="timming-wrap">
      <div class="timming-header-row">
        <h4 class="timming-title">Menú de cocina</h4>
        <div style="display:flex;gap:8px">
          <button id="btn-save-cocina" class="btn btn-sm btn-primary">💾 Guardar</button>
          <button id="btn-print-cocina" class="btn btn-sm btn-secondary">🖨 Imprimir</button>
        </div>
      </div>
      <div class="coc-presets">
        <span style="font-size:12px;color:#888;margin-right:6px">Preset:</span>
        <button class="btn btn-xs btn-secondary" id="coc-preset-formal">Formal</button>
        <button class="btn btn-xs btn-secondary" id="coc-preset-informal">Informal</button>
        <button class="btn btn-xs btn-secondary" id="coc-preset-clear">Limpiar</button>
      </div>

      <div class="coc-section">
        ${secHeader('RECEPCIÓN', 'coc-hora-recepcion', cocinaData.horaRecepcion)}
        <div class="coc-group">
          <div class="coc-group-label">Bocados fríos — Canapés</div>
          <div class="coc-checks">${chk('coc-canape', MENU_COCINA.canapes, cocinaData.canapes)}</div>
        </div>
        <div class="coc-group">
          <div class="coc-group-label">Bocados fríos — Bruschettas</div>
          <div class="coc-checks">${chk('coc-bruschetta', MENU_COCINA.bruschettas, cocinaData.bruschettas)}</div>
        </div>
        <div class="coc-group">
          <div class="coc-group-label">Otros fríos</div>
          <div class="coc-checks">${chk('coc-rf-otros', MENU_COCINA.recepcionOtros, cocinaData.recepcionOtros)}</div>
        </div>
        <div class="coc-group">
          <div class="coc-group-label">Bocados calientes — Brochettes</div>
          <div class="coc-checks">${chk('coc-brochette', MENU_COCINA.brochettes, cocinaData.brochettes)}</div>
        </div>
        <div class="coc-group">
          <div class="coc-group-label">Bocados calientes — Mini Empanaditas</div>
          <div class="coc-checks">${chk('coc-empanadita', MENU_COCINA.empanaditas, cocinaData.empanaditas)}</div>
        </div>
        <div class="coc-group">
          <div class="coc-group-label">Bocados calientes — Otros</div>
          <div class="coc-checks">${chk('coc-rc-otros', MENU_COCINA.calientesOtros, cocinaData.calientesOtros)}</div>
        </div>
      </div>

      <div class="coc-section">
        ${secHeader('ISLAS', 'coc-hora-islas', cocinaData.horaIslas)}
        <div class="coc-checks">${chk('coc-isla', ISLAS_OPT, cocinaData.islas)}</div>
        <input type="text" id="coc-isla-extra" class="coc-input" placeholder="Otra isla..." style="margin-top:8px">
      </div>

      <div class="coc-section">
        ${secHeader('PRIMER PLATO — Mesa Italiana', 'coc-hora-primer-plato', cocinaData.horaPrimerPlato)}
        <div class="coc-group">
          <div class="coc-group-label">Pastas</div>
          <div class="coc-checks">${chk('coc-pasta', PASTAS_OPT, cocinaData.pastas)}</div>
        </div>
        <div class="coc-group">
          <div class="coc-group-label">Pastas Gourmet</div>
          <div class="coc-checks">${chk('coc-pasta-gourmet', PASTAS_GOURMET_OPT, cocinaData.pastasGourmet)}</div>
        </div>
        <div class="coc-row" style="margin-top:10px">
          <label class="coc-label">Cant. de salsas:</label>
          <input type="number" id="coc-nsalsas" class="coc-input-sm" min="0" max="10" value="${cocinaData.cantidadSalsas || ''}">
        </div>
        <div class="coc-group">
          <div class="coc-group-label">Salsas (Filetto + a elección)</div>
          <div class="coc-checks">${chk('coc-salsa', SALSAS_OPT, cocinaData.salsas)}</div>
        </div>
        <div class="coc-group">
          <div class="coc-group-label">Salsas Gourmet</div>
          <div class="coc-checks">${chk('coc-salsa-gourmet', SALSAS_GOURMET_OPT, cocinaData.salsasGourmet)}</div>
        </div>
      </div>

      <div class="coc-section">
        ${secHeader('PLATO CENTRAL', 'coc-hora-plato-central', cocinaData.horaPlatoCentral)}
        <div class="coc-row" style="gap:12px;align-items:flex-start">
          <div style="flex:1">
            <div class="coc-group-label" style="margin-bottom:6px">Base Ave</div>
            <select id="coc-plato-ave" class="coc-select" style="width:100%">
              <option value="">-- Ninguna --</option>
              ${PLATO_CENTRAL_AVE_OPT.map(p => `<option${cocinaData.platoCentralAve === p ? ' selected' : ''}>${esc(p)}</option>`).join('')}
            </select>
            <div class="coc-group-label" style="margin-top:8px;margin-bottom:4px">Guarnición Ave</div>
            <select id="coc-guarnicion-ave" class="coc-select" style="width:100%">
              <option value="">-- Guarnición --</option>
              ${GUARNICION_OPT.map(g => `<option${cocinaData.guarnicionAve === g ? ' selected' : ''}>${esc(g)}</option>`).join('')}
            </select>
          </div>
          <div style="flex:1">
            <div class="coc-group-label" style="margin-bottom:6px">Base Carne</div>
            <select id="coc-plato-carne" class="coc-select" style="width:100%">
              <option value="">-- Ninguna --</option>
              ${PLATO_CENTRAL_CARNE_OPT.map(p => `<option${cocinaData.platoCentralCarne === p ? ' selected' : ''}>${esc(p)}</option>`).join('')}
            </select>
            <div class="coc-group-label" style="margin-top:8px;margin-bottom:4px">Guarnición Carne</div>
            <select id="coc-guarnicion-carne" class="coc-select" style="width:100%">
              <option value="">-- Guarnición --</option>
              ${GUARNICION_OPT.map(g => `<option${cocinaData.guarnicionCarne === g ? ' selected' : ''}>${esc(g)}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="coc-section">
        ${secHeader('MESA DE DULCES', 'coc-hora-mesa-dulces', cocinaData.horaMesaDulces)}
        <div class="coc-checks">${chk('coc-dulce', MESA_DULCES_OPT, cocinaData.mesaDulces)}</div>
        <div class="coc-group" style="margin-top:12px">
          <div class="coc-group-label">Postre / Torta</div>
          <p class="coc-hint">1 opción por cada 10 invitados. Una siempre es la torta principal.</p>
          <textarea id="coc-postre" class="coc-textarea" rows="2" placeholder="Ej: Torta principal + Lemon pie">${esc(cocinaData.postre || '')}</textarea>
        </div>
      </div>

      <div class="coc-section">
        ${secHeader('CAFETERÍA / FIN DE FIESTA', 'coc-hora-cafeteria', cocinaData.horaCafeteria)}
        <div class="coc-checks">${chk('coc-fin-fiesta', FIN_FIESTA_OPT, cocinaData.finFiesta)}</div>
      </div>

      <div id="coc-msg" style="font-size:13px;margin-top:8px;min-height:20px"></div>
    </div>`;

  bindAllTimePickers(panel);

  $('coc-preset-formal')?.addEventListener('click', () => {
    setCocinaFormData({
      canapes: [...MENU_COCINA.canapes],
      bruschettas: [...MENU_COCINA.bruschettas],
      recepcionOtros: [...MENU_COCINA.recepcionOtros],
      brochettes: [...MENU_COCINA.brochettes],
      empanaditas: [...MENU_COCINA.empanaditas],
      calientesOtros: [],
    });
  });
  $('coc-preset-informal')?.addEventListener('click', () => {
    setCocinaFormData({
      canapes: [...MENU_COCINA.canapes],
      bruschettas: [...MENU_COCINA.bruschettas],
      recepcionOtros: [...MENU_COCINA.recepcionOtros],
      brochettes: [...MENU_COCINA.brochettes],
      empanaditas: [...MENU_COCINA.empanaditas],
      calientesOtros: ['Azteca'],
    });
  });
  $('coc-preset-clear')?.addEventListener('click', () => setCocinaFormData({}));

  $('btn-save-cocina')?.addEventListener('click', async () => {
    const data = getCocinaFormData();
    const btn = $('btn-save-cocina');
    const msg = $('coc-msg');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    try {
      const body = { idCliente: cliente.id, hora: '', actividad: JSON.stringify(data), tipo: 'cocina', descripcion: '' };
      if (cocinaRowIndex) {
        await apiFetch(`/timming/${cocinaRowIndex}`, { method: 'PUT', body });
      } else {
        const res = await apiFetch('/timming', { method: 'POST', body });
        cocinaRowIndex = res.rowIndex;
      }
      msg.style.color = '#27ae60';
      msg.textContent = '✅ Menú cocina guardado';
    } catch (e) {
      msg.style.color = '#c0392b';
      msg.textContent = '❌ ' + e.message;
    }
    btn.disabled = false;
    btn.textContent = '💾 Guardar';
  });

  $('btn-print-cocina')?.addEventListener('click', () => {
    const data = getCocinaFormData();
    imprimirTimmingCocina(cliente, currentRestricciones, data);
  });
}

function imprimirTimming(cliente, items) {
  const filas = items.map(it => `
    <div class="tim-row">
      <span class="tim-h">${it.hora}</span>
      <div class="tim-a-wrap">
        <span class="tim-a">${esc(it.actividad)}</span>
        ${it.descripcion ? `<span class="tim-d">${esc(it.descripcion)}</span>` : ''}
      </div>
    </div>`).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Timing Maitre — ${esc(cliente.apellidoNombre)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; color: #111; background: #fff; }
    .pagina { max-width: 640px; margin: 0 auto; padding: 36px 40px; }
    .marca { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #c4993e; font-weight: 700; margin-bottom: 6px; }
    .cliente { font-size: 26px; font-weight: 700; margin-bottom: 4px; }
    .sub { font-size: 13px; color: #666; margin-bottom: 28px; }
    .titulo-sec { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #888; font-weight: 700; border-bottom: 2px solid #c4993e; padding-bottom: 6px; margin-bottom: 16px; }
    .tim-row { display: flex; align-items: flex-start; gap: 20px; padding: 11px 0; border-bottom: 1px solid #f0ece4; }
    .tim-row:last-child { border-bottom: none; }
    .tim-h { font-size: 16px; font-weight: 700; color: #c4993e; min-width: 52px; font-variant-numeric: tabular-nums; padding-top: 1px; }
    .tim-a-wrap { flex: 1; }
    .tim-a { font-size: 14px; line-height: 1.4; display: block; }
    .tim-d { font-size: 12px; color: #666; display: block; margin-top: 2px; font-style: italic; }
    .footer { margin-top: 28px; font-size: 10px; color: #bbb; border-top: 1px solid #eee; padding-top: 10px; text-align: right; }
    @media print { .pagina { padding: 16px 20px; } }
  </style>
</head>
<body>
<div class="pagina">
  <div class="marca">Joliet Eventos — Timing Maitre</div>
  <div class="cliente">${esc(cliente.apellidoNombre) || '—'}</div>
  <div class="sub">${cliente.fechaEvento ? formatDateWithDay(cliente.fechaEvento) : ''}${cliente.turno ? ' &nbsp;·&nbsp; ' + cliente.turno : ''}</div>
  <div class="titulo-sec">Cronograma</div>
  ${filas || '<p style="color:#aaa;font-style:italic">Sin actividades cargadas</p>'}
  <div class="footer">Impreso ${new Date().toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</div>
</div>
<script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}

function imprimirTimmingCocina(cliente, restricciones, cocinaData) {
  const d = cocinaData || {};

  // cols: 1=columna única, 2=dos cols, 3=tres cols, 4=cuatro cols
  const boxGrid = (arr, cols = 2) => {
    if (!arr || !arr.length) return '<span class="empty">—</span>';
    const cls = ['', 'g1', 'g2', 'g3', 'g4'][cols] || 'g2';
    return `<div class="${cls}">${arr.map(i => `<span class="cb">${esc(i)}</span>`).join('')}</div>`;
  };

  const subGrp = (label, arr, cols = 2) => arr && arr.length
    ? `<div class="sg"><span class="sl">${label}</span>${boxGrid(arr, cols)}</div>`
    : '';

  const sHead = (title, hora) =>
    `<div class="sh"><span class="st">${title}</span>${hora ? `<span class="hora">${hora}</span>` : ''}</div>`;

  const todasPastas = [...(d.pastas || []), ...(d.pastasGourmet || [])];
  const todasSalsas = [...(d.salsas || []), ...(d.salsasGourmet || [])];

  const restHtml = (restricciones || []).length
    ? `<div class="rg">${restricciones.map(r =>
        `<div class="rr">${r.coronita ? '👑 ' : ''}<strong>${esc(r.tipoRestriccion)}</strong> <span class="rc">${r.cantidad} pax</span></div>`
      ).join('')}</div>`
    : '<span class="empty">Sin restricciones</span>';

  const html = `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8">
<title>Cocina — ${esc(cliente.apellidoNombre)}</title>
<style>
@page{size:A4 portrait;margin:11mm 13mm}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#111;background:#fff;display:flex;flex-direction:column}
.cab{flex-shrink:0;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #8f2e4d;padding-bottom:6px;margin-bottom:8px}
.marca{font-size:8px;text-transform:uppercase;letter-spacing:1.5px;color:#8f2e4d;font-weight:700}
.nombre{font-size:19px;font-weight:800;line-height:1.1}
.cr{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;justify-content:flex-end}
.dato{text-align:center}.dato label{font-size:7.5px;color:#888;text-transform:uppercase;display:block}
.dato span{font-size:12px;font-weight:700}.dato .big{font-size:21px;color:#8f2e4d}
/* body principal ocupa todo el espacio entre header y footer */
.body{flex:1;display:flex;flex-direction:column;gap:6px}
/* grid externo: secciones lado a lado */
.r2{display:grid;grid-template-columns:1fr 1fr;gap:6px;align-items:start}
/* sección */
.sec{border:1.5px solid #ddd;border-radius:5px;padding:7px 10px}
.sh{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;padding-bottom:4px;border-bottom:1px solid #eee}
.st{font-size:8.5px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#8f2e4d}
.hora{font-size:15px;font-weight:900;color:#8f2e4d}
/* columnas internas dentro de una sección */
.inner2{display:grid;grid-template-columns:1fr 1fr;gap:0 14px;align-items:start}
/* subgrupos */
.sg{margin-bottom:6px}.sg:last-child{margin-bottom:0}
.sl{font-size:8px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px}
/* grillas de checkboxes — columnas fijas, alineación limpia */
.g1{display:flex;flex-direction:column;gap:4px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:3px 12px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:3px 8px}
.g4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:3px 6px}
.cb{display:flex;align-items:center;gap:5px;font-size:11px;line-height:1.6;min-width:0;word-break:break-word}
.cb::before{content:'';display:inline-block;width:12px;height:12px;border:1.5px solid #555;border-radius:2px;flex-shrink:0}
/* restricciones */
.rg{display:grid;grid-template-columns:1fr 1fr;gap:2px 14px}
.rr{font-size:11px;line-height:1.7}.rc{font-size:9.5px;color:#666}
/* plato central */
.pc-row{margin-bottom:7px}.pc-row:last-child{margin-bottom:0}
.pc-tipo{font-size:8px;font-weight:700;color:#555;text-transform:uppercase}
.pc-val{font-size:12.5px;font-weight:700}
.pc-guar{font-size:10.5px;color:#555;font-style:italic}
/* notas: flex:1 → ocupa todo el espacio sobrante de la hoja */
.notas{flex:1;border:1.5px solid #ddd;border-radius:5px;padding:7px 10px;display:flex;flex-direction:column}
.nt{font-size:8.5px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#8f2e4d;margin-bottom:8px;flex-shrink:0}
.notas-lines{flex:1;display:flex;flex-direction:column;justify-content:space-around}
.nl{border-bottom:1px dashed #ccc}
.empty{font-size:10.5px;color:#aaa;font-style:italic}
.postre-note{margin-top:5px;font-size:11px;font-style:italic;color:#444}
.footer{flex-shrink:0;margin-top:5px;font-size:7.5px;color:#bbb;text-align:right;border-top:1px solid #eee;padding-top:3px}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>

<div class="cab">
  <div>
    <div class="marca">Joliet Eventos — Timing Cocina</div>
    <div class="nombre">${esc(cliente.apellidoNombre) || '—'}</div>
  </div>
  <div class="cr">
    <div class="dato"><label>Fecha</label><span>${formatDateWithDay(cliente.fechaEvento)}</span></div>
    <div class="dato"><label>Turno</label><span>${esc(cliente.turno || '—')}</span></div>
    <div class="dato"><label>Tipo</label><span>${esc(cliente.tipoEvento || '—')}</span></div>
    <div class="dato"><label>Invitados</label><span class="big">${cliente.cantidadInvitados || '—'}</span></div>
    <div class="dato"><label>Inf.</label><span class="big">${cliente.menuInfantil || '0'}</span></div>
  </div>
</div>

<div class="body">

  <div class="sec">
    <div class="sh"><span class="st">Restricciones alimentarias</span></div>
    ${restHtml}
  </div>

  <div class="sec">
    ${sHead('Recepción', d.horaRecepcion)}
    <div class="inner2">
      <div>
        ${subGrp('Canapés', d.canapes)}
        ${subGrp('Bruschettas', d.bruschettas)}
        ${subGrp('Bocados fríos', d.recepcionOtros)}
      </div>
      <div>
        ${subGrp('Brochettes', d.brochettes)}
        ${subGrp('Mini Empanaditas', d.empanaditas)}
        ${subGrp('Bocados calientes', d.calientesOtros)}
      </div>
    </div>
  </div>

  <div class="sec">
    ${sHead('Islas', d.horaIslas)}
    ${boxGrid(d.islas, 1)}
  </div>

  <div class="r2">
    <div class="sec">
      ${sHead('Primer Plato — Mesa Italiana', d.horaPrimerPlato)}
      ${todasPastas.length ? `
        ${subGrp('Pastas', todasPastas)}
        <div class="sg">
          <span class="sl">Salsas${d.cantidadSalsas ? ` (elegir ${d.cantidadSalsas})` : ''}</span>
          ${boxGrid(todasSalsas)}
        </div>
      ` : '<span class="empty">Sin primer plato</span>'}
    </div>
    <div class="sec">
      ${sHead('Plato Central', d.horaPlatoCentral)}
      ${d.platoCentralAve ? `
        <div class="pc-row">
          <div class="pc-tipo">Ave</div>
          <div class="pc-val">${esc(d.platoCentralAve)}</div>
          ${d.guarnicionAve ? `<div class="pc-guar">${esc(d.guarnicionAve)}</div>` : ''}
        </div>` : ''}
      ${d.platoCentralCarne ? `
        <div class="pc-row">
          <div class="pc-tipo">Carne</div>
          <div class="pc-val">${esc(d.platoCentralCarne)}</div>
          ${d.guarnicionCarne ? `<div class="pc-guar">${esc(d.guarnicionCarne)}</div>` : ''}
        </div>` : ''}
      ${!d.platoCentralAve && !d.platoCentralCarne ? '<span class="empty">—</span>' : ''}
    </div>
  </div>

  <div class="sec">
    ${sHead('Mesa de Dulces', d.horaMesaDulces)}
    ${boxGrid(d.mesaDulces, 4)}
    ${d.postre ? `<div class="postre-note">Postre / Torta: <strong>${esc(d.postre)}</strong></div>` : ''}
  </div>

  <div class="sec">
    ${sHead('Fin de Fiesta', d.horaCafeteria)}
    ${boxGrid(d.finFiesta && d.finFiesta.length ? d.finFiesta : [], 3)}
  </div>

  <div class="notas">
    <div class="nt">Notas</div>
    <div class="notas-lines">
      ${Array(8).fill('<div class="nl"></div>').join('')}
    </div>
  </div>

</div>

<div class="footer">Impreso ${new Date().toLocaleDateString('es-AR', {weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>

<script>window.onload = () => { window.print(); }<\/script>
</body></html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}

/* ===================== PROPUESTA COMERCIAL ===================== */

const RECORRIDO = {
  Formal: [
    { nombre: 'Recepción',               desc: 'Bienvenida con canapés fríos, bocados calientes y bruschettas en el jardín' },
    { nombre: 'Estaciones de bienvenida',desc: 'Estaciones temáticas en vivo a mediados de la recepción, mientras todos ingresan al salón' },
    { nombre: 'Primer plato',            desc: 'Pastas artesanales con salsas de elaboración propia, servidas a la mesa' },
    { nombre: 'Plato central',           desc: 'Ave o carne a elección del anfitrión · acompañada de guarnición' },
    { nombre: 'Torta homenaje',          desc: 'El momento del brindis y el agasajo' },
    { nombre: 'Mesa de dulces',          desc: 'Pastelería fina y postres individuales sobre mesa principal iluminada' },
    { nombre: 'Cafetería',               desc: 'Café, té e infusiones para acompañar el cierre dulce' },
    { nombre: 'Fin de fiesta',           desc: 'Café, pizza, mate — el cierre a su gusto' },
  ],
  Americano: [
    { nombre: 'Recepción',               desc: 'Bienvenida con canapés fríos, bocados calientes y bruschettas en el jardín' },
    { nombre: 'Islas en vivo',           desc: 'El plato central: dos estaciones temáticas en vivo, abundantes y contundentes, a elección del anfitrión' },
    { nombre: 'Torta homenaje',          desc: 'El momento del brindis y el agasajo' },
    { nombre: 'Postres',                 desc: 'Dulces de elaboración propia para seguir disfrutando' },
    { nombre: 'Cafetería',               desc: 'Café, té e infusiones para cerrar con calma' },
    { nombre: 'Fin de fiesta',           desc: 'Café, pizza, mate — el cierre a su gusto' },
  ]
};

const propuestaState = {
  current: 1,
  total: 11,
  data: {
    nombre: '', telefono: '', gmail: '', clienteId: null,
    estilo: '', tipoEvento: '', agasajado: '', fecha: '', turno: '',
    invitados: 100, menuInfantil: false, infantilCant: '',
    espacio: '', adicionales: [], gastroAdicionales: [],
    pastasSeleccionadas: [], pastasGourmetSeleccionadas: [],
    salsasSeleccionadas: [], salsasGourmetSeleccionadas: [],
    platoCentral: '', platoCentralCarne: [],
    pedidos: ''
  }
};

function initPropuesta() {
  const d = propuestaState.data;
  propuestaState.current = 1;
  d.nombre = ''; d.telefono = ''; d.gmail = ''; d.clienteId = null;
  d.estilo = ''; d.tipoEvento = ''; d.agasajado = ''; d.fecha = ''; d.turno = '';
  d.invitados = 100; d.menuInfantil = false; d.infantilCant = '';
  d.espacio = ''; d.adicionales = []; d.gastroAdicionales = [];
  d.pastasSeleccionadas = []; d.pastasGourmetSeleccionadas = [];
  d.salsasSeleccionadas = []; d.salsasGourmetSeleccionadas = [];
  d.platoCentral = ''; d.platoCentralCarne = [];
  d.pedidos = '';

  document.querySelectorAll('#view-propuesta .propuesta-card').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('#estilo-cards .estilo-fork-card').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('.adicionales-grid input[type="checkbox"]').forEach(cb => { cb.checked = false; });

  const set = (id, val) => { const el = $(id); if (el) el.value = val; };
  set('prop-agasajado', ''); set('prop-fecha', ''); set('prop-infantil-cant', ''); set('prop-pedidos', '');
  set('prop-contacto-nombre', ''); set('prop-contacto-telefono', ''); set('prop-contacto-gmail', '');
  const clSel = $('prop-cliente-existente'); if (clSel) clSel.value = '';
  const invDisplay = $('prop-invitados-display'); if (invDisplay) invDisplay.textContent = '100';
  set('prop-invitados', '100');
  const miCb = $('prop-menu-infantil'); if (miCb) miCb.checked = false;
  const infantilRow = $('infantil-count-row'); if (infantilRow) infantilRow.style.display = 'none';
  const agRow = $('agasajado-row'); if (agRow) agRow.style.display = 'none';
  const guardarStatus = $('prop-guardar-status'); if (guardarStatus) guardarStatus.style.display = 'none';
  const guardarBtn = $('btn-guardar-cliente-propuesta');
  if (guardarBtn) { guardarBtn.disabled = false; guardarBtn.textContent = '💾 Guardar como cliente'; }

  openPropuestaPreForm();
}

function openPropuestaPreForm() {
  const sel = $('prop-cliente-existente');
  if (sel) {
    sel.innerHTML = '<option value="">Buscar cliente existente...</option>';
    (allClientes || []).slice()
      .sort((a, b) => (a.apellidoNombre || '').localeCompare(b.apellidoNombre || ''))
      .forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.rowIndex;
        opt.textContent = c.apellidoNombre + (c.tipoEvento ? ` · ${c.tipoEvento}` : '');
        sel.appendChild(opt);
      });
  }
  showEl($('propuesta-preform'));
  const slidesEl = document.querySelector('.propuesta-slides-container');
  const navEl = document.querySelector('.propuesta-nav');
  if (slidesEl) slidesEl.style.display = 'none';
  if (navEl) navEl.style.display = 'none';
}

function startPropuestaSlides() {
  const clSel = $('prop-cliente-existente');
  if (clSel && clSel.value) {
    const rowIdx = parseInt(clSel.value);
    const cliente = (allClientes || []).find(c => c.rowIndex === rowIdx);
    if (cliente) { preFillPropuestaFromCliente(cliente); return; }
  }
  propuestaState.data.nombre = $('prop-contacto-nombre')?.value?.trim() || '';
  propuestaState.data.telefono = $('prop-contacto-telefono')?.value?.trim() || '';
  propuestaState.data.gmail = $('prop-contacto-gmail')?.value?.trim() || '';
  hideEl($('propuesta-preform'));
  const slidesEl = document.querySelector('.propuesta-slides-container');
  const navEl = document.querySelector('.propuesta-nav');
  if (slidesEl) slidesEl.style.display = '';
  if (navEl) navEl.style.display = '';
  buildPropuestaDots();
  goToPropuestaSlide(1);
  actualizarBtnGuardar();
}

function preFillPropuestaFromCliente(cliente) {
  const d = propuestaState.data;
  d.clienteId = cliente.id;
  d.nombre = cliente.apellidoNombre || '';
  d.telefono = cliente.telefono || '';
  d.gmail = cliente.gmail || '';
  const gi = $('prop-contacto-gmail'); if (gi) gi.value = d.gmail;

  const sinAgasajado = ['Corporativo', 'Otro'];
  if (cliente.tipoEvento) {
    d.tipoEvento = cliente.tipoEvento;
    document.querySelectorAll('#evento-cards .propuesta-card').forEach(c =>
      c.classList.toggle('selected', c.dataset.value === cliente.tipoEvento));
    const agRow = $('agasajado-row');
    if (agRow) agRow.style.display = sinAgasajado.includes(cliente.tipoEvento) ? 'none' : '';
  }
  if (cliente.fechaEvento) {
    d.fecha = cliente.fechaEvento;
    const fi = $('prop-fecha'); if (fi) fi.value = cliente.fechaEvento;
  }
  if (cliente.turno) {
    d.turno = cliente.turno;
    document.querySelectorAll('#turno-cards .propuesta-card').forEach(c =>
      c.classList.toggle('selected', c.dataset.value === cliente.turno));
  }
  if (cliente.cantidadInvitados) {
    const inv = parseInt(cliente.cantidadInvitados) || 100;
    d.invitados = inv;
    const ii = $('prop-invitados'); if (ii) ii.value = inv;
    const id2 = $('prop-invitados-display'); if (id2) id2.textContent = inv;
  }

  hideEl($('propuesta-preform'));
  const slidesEl = document.querySelector('.propuesta-slides-container');
  const navEl = document.querySelector('.propuesta-nav');
  if (slidesEl) slidesEl.style.display = '';
  if (navEl) navEl.style.display = '';
  buildPropuestaDots();
  goToPropuestaSlide(1);
  actualizarBtnGuardar();
}

function startPropuestaFromCliente(cliente) {
  hideEl($('modal-overlay'));
  navigateTo('propuesta');
  setTimeout(() => preFillPropuestaFromCliente(cliente), 60);
}

function actualizarBtnGuardar() {
  const btn = $('btn-guardar-cliente-propuesta');
  if (!btn) return;
  if (propuestaState.data.clienteId) {
    btn.textContent = '✓ Ya está en el sistema';
    btn.disabled = true;
  } else {
    btn.textContent = '💾 Guardar como cliente';
    btn.disabled = false;
  }
}

async function guardarClientePropuesta() {
  readPropuestaData();
  const d = propuestaState.data;
  if (d.clienteId) return;
  const btn = $('btn-guardar-cliente-propuesta');
  const statusEl = $('prop-guardar-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
  try {
    const nuevo = await apiFetch('/clientes', {
      method: 'POST',
      body: {
        apellidoNombre: d.nombre || 'Prospecto sin nombre',
        telefono: d.telefono || '',
        gmail: d.gmail || '',
        tipoEvento: d.tipoEvento || '',
        fechaEvento: d.fecha || '',
        turno: d.turno || '',
        cantidadInvitados: String(d.invitados || ''),
        estado: 'Consulta',
        otrosPedidos: d.pedidos || '',
        formato: d.estilo || '',
      }
    });
    d.clienteId = nuevo.id;
    if (btn) { btn.textContent = '✓ Guardado en el sistema'; btn.disabled = true; }
    if (statusEl) { statusEl.textContent = '¡Listo! Ya aparece en el CRM.'; statusEl.style.display = ''; }
    loadClientes();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar como cliente'; }
    if (statusEl) { statusEl.textContent = 'Error al guardar. Intentá de nuevo.'; statusEl.style.display = ''; }
  }
}

function buildRecorrido() {
  const estilo = propuestaState.data.estilo || 'Formal';
  const pasos = RECORRIDO[estilo] || RECORRIDO.Formal;
  const isFormal = estilo === 'Formal';
  const container = document.getElementById('recorrido-container');
  if (!container) return;
  container.innerHTML = pasos.map((p, i) => `
    <div class="recorrido-step ${isFormal ? 'recorrido-step-formal' : ''}">
      <div class="recorrido-num">${i + 1}</div>
      <div class="recorrido-info">
        <div class="recorrido-name">${p.nombre}</div>
        <div class="recorrido-desc">${p.desc}</div>
      </div>
    </div>
  `).join('');
}

function buildPropuestaDots() {
  const container = $('propuesta-step-dots');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 1; i <= propuestaState.total; i++) {
    const dot = document.createElement('div');
    dot.className = 'propuesta-dot' + (i === propuestaState.current ? ' active' : '');
    container.appendChild(dot);
  }
}

function updatePropuestaNav() {
  const pct = ((propuestaState.current - 1) / (propuestaState.total - 1)) * 100;
  const bar = $('propuesta-progress-bar'); if (bar) bar.style.width = pct + '%';

  document.querySelectorAll('.propuesta-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i + 1 === propuestaState.current);
  });

  const prev = $('btn-prop-prev'); if (prev) prev.disabled = propuestaState.current === 1;
  const next = $('btn-prop-next');
  if (next) next.style.visibility = propuestaState.current === propuestaState.total ? 'hidden' : '';
}

function goToPropuestaSlide(n) {
  if (propuestaState.current === 9) {
    propuestaState.data.gastroAdicionales = [];
    document.querySelectorAll('#gastro-slide-content input[type="checkbox"]:checked:not([disabled])').forEach(cb => {
      propuestaState.data.gastroAdicionales.push(cb.value);
    });
    const d = propuestaState.data;
    d.pastasSeleccionadas = [];
    document.querySelectorAll('#gastro-pasta-list input:checked:not([disabled])').forEach(cb => d.pastasSeleccionadas.push(cb.value));
    d.pastasGourmetSeleccionadas = [];
    document.querySelectorAll('#gastro-pasta-gourmet-list input:checked').forEach(cb => d.pastasGourmetSeleccionadas.push(cb.value));
    d.salsasSeleccionadas = [];
    document.querySelectorAll('#gastro-salsa-list input:checked:not([disabled])').forEach(cb => d.salsasSeleccionadas.push(cb.value));
    d.salsasGourmetSeleccionadas = [];
    document.querySelectorAll('#gastro-salsa-gourmet-list input:checked').forEach(cb => d.salsasGourmetSeleccionadas.push(cb.value));
    d.platoCentral = document.querySelector('#gastro-plato-central input:checked')?.value || '';
    d.platoCentralCarne = [];
  }
  const old = document.querySelector('.propuesta-slide.active');
  if (old) {
    old.classList.remove('active');
    old.classList.add('exiting');
    setTimeout(() => old.classList.remove('exiting'), 300);
  }
  propuestaState.current = n;
  const slide = document.querySelector(`.propuesta-slide[data-slide="${n}"]`);
  if (slide) slide.classList.add('active');
  const container = document.querySelector('.propuesta-slides-container');
  if (container) container.scrollTop = 0;
  updatePropuestaNav();
  if (n === 7) buildRecorrido();
  if (n === 9) buildGastroSlide();
  if (n === 11) buildPropuestaResumen();
}

function readPropuestaData() {
  const d = propuestaState.data;
  const g = id => $(id)?.value?.trim() || '';
  const estiloCard = document.querySelector('#estilo-cards .estilo-fork-card.selected');
  d.estilo = estiloCard ? estiloCard.dataset.estilo : d.estilo;
  const eventoCard = document.querySelector('#evento-cards .propuesta-card.selected');
  d.tipoEvento = eventoCard ? eventoCard.dataset.value : d.tipoEvento;
  d.agasajado = g('prop-agasajado');
  d.fecha = g('prop-fecha');
  const turnoCard = document.querySelector('#turno-cards .propuesta-card.selected');
  d.turno = turnoCard ? turnoCard.dataset.value : d.turno;
  d.invitados = parseInt($('prop-invitados')?.value) || 100;
  d.menuInfantil = !!$('prop-menu-infantil')?.checked;
  d.infantilCant = g('prop-infantil-cant');
  const espacioCard = document.querySelector('#espacio-cards .propuesta-card.selected');
  d.espacio = espacioCard ? espacioCard.dataset.value : d.espacio;
  d.adicionales = [];
  document.querySelectorAll('#view-propuesta .adicionales-grid input[type="checkbox"]:checked').forEach(cb => {
    d.adicionales.push(cb.value);
  });
  d.gastroAdicionales = [];
  document.querySelectorAll('#gastro-slide-content input[type="checkbox"]:checked:not([disabled])').forEach(cb => {
    d.gastroAdicionales.push(cb.value);
  });
  const pp = (sel) => { const a = []; document.querySelectorAll(sel + ' input:checked:not([disabled])').forEach(cb => a.push(cb.value)); return a; };
  if ($('gastro-plato-central')) { d.pastasSeleccionadas = pp('#gastro-pasta-list'); d.pastasGourmetSeleccionadas = pp('#gastro-pasta-gourmet-list'); d.salsasSeleccionadas = pp('#gastro-salsa-list'); d.salsasGourmetSeleccionadas = pp('#gastro-salsa-gourmet-list'); d.platoCentral = document.querySelector('#gastro-plato-central input:checked')?.value || ''; d.platoCentralCarne = []; }
  d.pedidos = $('prop-pedidos')?.value?.trim() || '';
}

/* ===== GASTRO SLIDE — dinámico por estilo ===== */

const PRIMER_PLATO_DATA = {
  pastas: [
    { name: 'Tagliatelle cortados a cuchillo (blancos y de verdura)', locked: true },
    { name: 'Sorrentinos de jamón y queso' },
    { name: 'Canelones de verdura y ricota' },
    { name: 'Ravioloni de espinaca y parmesano' },
    { name: 'Agnolotis de pollo' },
    { name: 'Ñoquis de papa' },
  ],
  pastasGourmet: [
    'Fetuccine Nero di sepia',
    'Sorrentinos de trucha y almendras',
    'Fagotinnis de cordero y romero',
    'Sorrentinos de salmón y philadelphia',
  ],
  salsas: [
    { name: 'Filetto', locked: true },
    { name: 'Bolognesa' },
    { name: 'Rosé' },
    { name: 'Cuatro quesos' },
    { name: 'Crema de espinaca' },
    { name: 'Italiana' },
    { name: 'Salsa blanca' },
  ],
  salsasGourmet: ['Portobellos y ciboulette', 'Queso azul y nuez'],
};

const PLATO_CENTRAL_DATA = {
  opciones: [
    { value: 'Pechuga tradición',   tipo: 'Ave',   desc: 'Rellena de jamón cocido y mozzarella · crema de cuatro quesos · rostí de papa' },
    { value: 'Pechuga caprese',      tipo: 'Ave',   desc: 'Rellena de mozzarella, tomate y albahaca · papas a la suiza gratinadas' },
    { value: 'Pechuga doble puerro', tipo: 'Ave',   desc: 'Rellena de puerros salteados · salsa cremosa con almendras · milhojas de papa' },
    { value: 'Lomo Reserva',         tipo: 'Carne', desc: 'Medallones de lomo en reducción de Malbec · milhojas de papa' },
    { value: 'Bife del bosque',      tipo: 'Carne', desc: 'Ojo de bife en salsa de hongos de pino · rostí de papa dorado' },
    { value: 'Lomo Dijon',           tipo: 'Carne', desc: 'Lomo en crema de mostaza suave · papas a la suiza gratinadas' },
  ],
};

const GASTRO_DATA = {
  Formal: {
    pillars: [
      { ico: '🥂', label: 'Recepción' },
      { ico: '🍝', label: 'Primer<br>plato' },
      { ico: '🍽️', label: 'Plato<br>central' },
      { ico: '🎂', label: 'Mesa de<br>dulces' },
    ],
    islasTitle: 'Estaciones de bienvenida',
    islasSub: 'A mediados de la recepción · incluye una estación',
    islasLabel: 'UNA INCLUIDA · podés agregar más',
    islas: [
      { value: 'Sándwiches gourmets', name: 'Sándwiches gourmets', desc: 'Selección de sándwiches artesanales · rellenos gourmet y panes de masa madre' },
      { value: 'Alma Mexicana', name: 'Alma Mexicana', desc: 'Tacos de carne, pollo o cerdo con toppings clásicos · Nachos crocantes para acompañar' },
      { value: 'Clásicos en Laja', name: 'Clásicos en Laja', desc: 'Selección de fiambres y quesos en lajas de piedra · Variedad de panes y aderezos' },
      { value: 'Estación de Crêpes', name: 'Estación de Crêpes', desc: 'Crêpes finos preparados al momento con rellenos salados y salsas suaves para combinar' },
    ],
    premium: [
      { value: 'Mollejas & Verdeo', name: 'Mollejas & Verdeo', desc: 'Mollejitas doradas y tiernas, salteadas con verdeo fresco · Servidas en pancitos de campo' },
      { value: 'Delicias de Mar', name: 'Delicias de Mar', desc: 'Cazuela caliente con mix de mariscos y vegetales en caldo de mar' },
      { value: 'Paella Mediterránea', name: 'Paella Mediterránea', desc: 'Tradicional paella con mariscos, pollo y vegetales, servida caliente' },
      { value: 'Sushi en vivo', name: 'Sushi en vivo', desc: 'Preparación artesanal frente a los invitados' },
    ],
    mesaDulce: {
      included: { name: 'Pastelería Joliet', desc: 'Lemon pie · Cheese cake · Chocotorta · Torta África · Tarta de frutillas · Flan · Isla flotante · Mil Hojas · Brownies rellenos · Copas heladas · Panqueques' },
      upgrade: { value: 'Mini Cakes Premium', name: 'Mini Cakes Premium', desc: 'Todas las variedades de la pastelería Joliet en formato mini, con diferentes presentaciones y terminaciones' },
    },
    mode: 'multi',
  },
  Americano: {
    pillars: [
      { ico: '🥂', label: 'Recepción' },
      { ico: '🏝️', label: 'Islas en vivo<br>(plato central)' },
      { ico: '🎂', label: 'Postres &<br>torta homenaje' },
    ],
    islasTitle: 'Las islas · el plato central',
    islasSub: 'Tras la recepción · sus invitados circulan, eligen y disfrutan a su ritmo',
    islasLabel: 'BASE INCLUIDA · elegí hasta 2 más',
    islas: [
      { value: 'Bovalino — Pasta Italiana', name: 'Bovalino 🇮🇹', cat: 'Pasta', desc: 'Agnolottis/sorrentinos de jamón y queso con pomodoro, albahaca y oliva · Tagliatelle cortados a cuchillo con ragú alla bolognese', locked: true },
      { value: 'Azteca — Tacos', name: 'Azteca', cat: '', desc: 'Tacos artesanales al momento con pollo, cerdo o carne · Cebolla, pico de gallo fresco y salsa picante · Nachos crocantes con queso fundido' },
      { value: 'Dijon — Pollo a la Mostaza', name: 'Dijon', cat: 'Ave', desc: 'Pollo a la mostaza suave con papas al horno y romero' },
      { value: 'Bianca — Pollo en Vino Blanco', name: 'Bianca', cat: 'Ave', desc: 'Cubos de pollo braseados en reducción de vino blanco y hierbas frescas · Arroz cremoso parmesano' },
      { value: 'Francesa — Lomo Demiglace', name: 'Francesa', cat: 'Carne', desc: 'Lomo en salsa demiglace con papas rústicas en manteca de tomillo' },
      { value: 'Del Bosque — Carne y Hongos', name: 'Del Bosque', cat: 'Carne', desc: 'Cubos de carne braseados en reducción de vino tinto y hongos secos · Arroz perfumado al azafrán' },
    ],
    premium: [
      { value: 'Delicias de Mar', name: 'Delicias de Mar', desc: 'Cazuela caliente con mix de mariscos y vegetales en caldo de mar' },
      { value: 'Paella Mediterránea', name: 'Paella Mediterránea', desc: 'Tradicional paella con mariscos, pollo y vegetales, servida caliente' },
    ],
    mesaDulce: {
      locked: { name: 'Torta Homenaje', desc: 'A pedido del agasajado · colores y decoración a convenir · se sirve después de los postres' },
      postres: [
        { name: 'Pavlova de estación', desc: 'Merengue suizo relleno · La presentación y el relleno se definen según las frutas de temporada o el pedido específico del cliente' },
        { name: 'American Sweet', desc: 'Copa helada con base de Oreo y praliné de frutos secos · Capas de textura y sabor en un solo bocado' },
        { name: 'África de autor', desc: 'La torta de chocolate insignia de Joliet · Una receta única con presentación exclusiva diseñada para el evento · No la encontrás en ninguna carta' },
        { name: 'Key Lime Pie', desc: 'Tarta americana de lima · Cremosa, cítrica y perfectamente equilibrada · Base de galleta con cobertura de crema suave' },
      ],
      maxPostres: 1,
    },
    mode: 'multi',
    maxBase: 2,
  },
};

function buildGastroSlide() {
  const container = $('gastro-slide-content');
  if (!container) return;
  const estilo = propuestaState.data.estilo || 'Formal';
  const data = GASTRO_DATA[estilo] || GASTRO_DATA.Formal;
  const isAmericano = estilo === 'Americano';

  const pillarsHtml = data.pillars.map(p =>
    `<div class="gastro-pilar"><div class="gp-ico">${p.ico}</div><div class="gp-label">${p.label}</div></div>`
  ).join('');

  const lockedIslas = data.islas.filter(i => i.locked);
  const freeIslas = data.islas.filter(i => !i.locked);
  const lockedHtml = lockedIslas.map(isla => `
    <label class="gastro-island-row gastro-island-locked selected">
      <input type="checkbox" value="${isla.value}" checked disabled>
      <div class="island-row-indicator">✓</div>
      <div class="island-row-body">
        <div class="island-row-header">
          <span class="island-row-name">${isla.name}</span>
          ${isla.cat ? `<span class="island-row-cat">${isla.cat}</span>` : ''}
          <span class="island-row-included">siempre incluida</span>
        </div>
        <div class="island-row-desc">${isla.desc}</div>
      </div>
    </label>`).join('');

  const baseIslandsHtml = freeIslas.map(isla => `
    <label class="gastro-island-row">
      <input type="checkbox" value="${isla.value}">
      <div class="island-row-indicator">✓</div>
      <div class="island-row-body">
        <div class="island-row-header">
          <span class="island-row-name">${isla.name}</span>
          ${isla.cat ? `<span class="island-row-cat">${isla.cat}</span>` : ''}
        </div>
        <div class="island-row-desc">${isla.desc}</div>
      </div>
    </label>`).join('');

  const premiumHtml = data.premium.map(p => `
    <label class="gastro-premium-row">
      <input type="checkbox" value="${p.value}">
      <div class="premium-row-indicator">✓</div>
      <div class="premium-row-body">
        <span class="premium-row-name">${p.name}</span>
        <span class="premium-row-desc">${p.desc}</span>
      </div>
    </label>`).join('');

  const counterHtml = isAmericano
    ? `<div class="gastro-counter" id="gastro-base-counter"><span id="gastro-base-count">0</span> / 2 adicionales elegidas</div>`
    : '';

  const primerPlatoHtml = !isAmericano ? (() => {
    const ppd = PRIMER_PLATO_DATA;
    const pastaRows = ppd.pastas.map(p => `
      <label class="gastro-menu-row${p.locked ? ' locked' : ''}"><input type="checkbox" value="${p.name}"${p.locked ? ' checked disabled' : ''}><div class="gastro-menu-indicator">✓</div><span class="gastro-menu-name">${p.name}${p.locked ? ' <small style="opacity:.55;font-size:10px">· siempre incluida</small>' : ''}</span></label>`).join('');
    const pastaGRows = ppd.pastasGourmet.map(p => `
      <label class="gastro-menu-row"><input type="checkbox" value="${p}"><div class="gastro-menu-indicator">✓</div><span class="gastro-menu-name">${p}</span></label>`).join('');
    const salsaRows = ppd.salsas.map(s => `
      <label class="gastro-menu-row${s.locked ? ' locked' : ''}"><input type="checkbox" value="${s.name}"${s.locked ? ' checked disabled' : ''}><div class="gastro-menu-indicator">✓</div><span class="gastro-menu-name">${s.name}${s.locked ? ' <small style="opacity:.55;font-size:10px">· siempre incluida</small>' : ''}</span></label>`).join('');
    const salsaGRows = ppd.salsasGourmet.map(s => `
      <label class="gastro-menu-row"><input type="checkbox" value="${s}"><div class="gastro-menu-indicator">✓</div><span class="gastro-menu-name">${s}</span></label>`).join('');
    const centralRows = PLATO_CENTRAL_DATA.opciones.map(p => `
      <label class="gastro-plato-row"><input type="radio" name="plato-central" value="${p.value}"><div class="gastro-plato-indicator">✓</div><div class="gastro-plato-body"><div class="gastro-plato-header"><div class="gastro-plato-name">${p.value}</div><span class="gastro-plato-tipo">${p.tipo}</span></div><div class="gastro-plato-desc">${p.desc}</div></div></label>`).join('');
    return `
    <div class="gastro-subsection">
      <div class="gastro-subsection-header">
        <div class="gastro-section-title">Primer plato</div>
        <div class="gastro-section-sub">Pastas artesanales · Tagliatelle y Filetto siempre incluidos</div>
      </div>
      <div class="gastro-section-label">PASTAS · Tagliatelle siempre incluido · elegí hasta 5 más <span id="gastro-pasta-counter" class="gastro-count-badge">0/5</span></div>
      <div class="gastro-menu-list" id="gastro-pasta-list">${pastaRows}</div>
      <div class="gastro-section-label gastro-section-label-premium">PASTAS GOURMET · a consultar · cuentan en el límite de 4</div>
      <div class="gastro-menu-list" id="gastro-pasta-gourmet-list">${pastaGRows}</div>
      <div class="gastro-section-label" style="margin-top:14px">SALSAS · Filetto incluida · elegí 4 más <span id="gastro-salsa-counter" class="gastro-count-badge">0/4</span></div>
      <div class="gastro-menu-grid" id="gastro-salsa-list">${salsaRows}</div>
      <div class="gastro-section-label gastro-section-label-premium">SALSAS GOURMET · a consultar · cuentan en el límite de 4</div>
      <div class="gastro-menu-list" id="gastro-salsa-gourmet-list">${salsaGRows}</div>
    </div>
    <div class="gastro-subsection">
      <div class="gastro-subsection-header">
        <div class="gastro-section-title">Plato central</div>
        <div class="gastro-section-sub">Un solo plato central · ave o carne · clickeá de nuevo para deseleccionar</div>
      </div>
      <div class="gastro-section-label">ELEGÍ UNO</div>
      <div class="gastro-plato-list" id="gastro-plato-central">${centralRows}</div>
      <div class="gastro-necesidades-note">Contamos con menús y opciones para cubrir cualquier tipo de necesidad · vegetariano, sin TACC, alergias y más · consultanos sin compromiso</div>
    </div>`;
  })() : '';

  const mesaDulceHtml = (() => {
    const md = data.mesaDulce;
    if (!md) return '';
    const lockedRow = (item) => `
        <label class="gastro-island-row gastro-island-locked selected">
          <input type="checkbox" checked disabled>
          <div class="island-row-indicator">✓</div>
          <div class="island-row-body">
            <div class="island-row-header">
              <span class="island-row-name">${item.name}</span>
              <span class="island-row-included">siempre incluida</span>
            </div>
            <div class="island-row-desc">${item.desc}</div>
          </div>
        </label>`;
    const topLocked = md.included
      ? lockedRow(md.included)
      : (md.locked ? lockedRow(md.locked) : '');
    const selectablePostres = md.postres && md.maxPostres ? `
      <div class="gastro-section-label">ELEGÍ UNA</div>
      <div class="gastro-islands-list" id="gastro-postres-list">
        ${md.postres.map(p => `
        <label class="gastro-island-row">
          <input type="checkbox" value="${p.name}">
          <div class="island-row-indicator">✓</div>
          <div class="island-row-body">
            <div class="island-row-header">
              <span class="island-row-name">${p.name}</span>
            </div>
            <div class="island-row-desc">${p.desc}</div>
          </div>
        </label>`).join('')}
      </div>` : '';
    const upgradeSection = md.upgrade ? `
      <div class="gastro-section-label gastro-section-label-premium">UPGRADE · a consultar</div>
      <div class="gastro-islands-list" id="gastro-mesa-dulce-list">
        <label class="gastro-island-row">
          <input type="checkbox" value="${md.upgrade.value}">
          <div class="island-row-indicator">✓</div>
          <div class="island-row-body">
            <div class="island-row-header">
              <span class="island-row-name">${md.upgrade.name}</span>
            </div>
            <div class="island-row-desc">${md.upgrade.desc}</div>
          </div>
        </label>
      </div>` : '';
    const sub = md.upgrade
      ? 'Pastelería artesanal de elaboración propia · upgrade premium disponible'
      : md.locked
        ? 'Pastelería artesanal · elegí el postre de la noche'
        : 'Pastelería artesanal de elaboración propia';
    const torta = !md.locked ? '<p class="gastro-torta-homenaje-note">Torta Homenaje · se realiza a pedido del agasajado · colores y decoración a convenir · se sirve después de los postres</p>' : '';
    return `
    <div class="gastro-subsection">
      <div class="gastro-subsection-header">
        <div class="gastro-section-title">Mesa de dulces</div>
        <div class="gastro-section-sub">${sub}</div>
      </div>
      ${topLocked ? '<div class="gastro-section-label">INCLUIDA</div>' : ''}
      <div class="gastro-islands-list">
        ${topLocked}
      </div>
      ${selectablePostres}
      ${upgradeSection}
      ${torta}
    </div>`;
  })();

  container.innerHTML = `
    <div class="gastro-incluido">${pillarsHtml}</div>
    <div class="gastro-islands-section">
      <div class="gastro-section-header">
        <div class="gastro-section-title">${data.islasTitle}</div>
        <div class="gastro-section-sub">${data.islasSub}</div>
        ${counterHtml}
      </div>
      <div class="gastro-section-label">${data.islasLabel}</div>
      <div class="gastro-islands-list" id="gastro-extras-grid">${lockedHtml}${baseIslandsHtml}</div>
      ${!isAmericano ? `<p class="gastro-formal-extra-note" id="gastro-formal-extra-note" style="display:none">Una estación está incluida · las adicionales se presupuestan aparte</p>` : ''}
      <div class="gastro-section-label gastro-section-label-premium">PREMIUM · a consultar</div>
      <div class="gastro-premium-list">${premiumHtml}</div>
    </div>${primerPlatoHtml}${mesaDulceHtml}`;

  const prev = propuestaState.data.gastroAdicionales || [];
  if (prev.length) {
    container.querySelectorAll('input[type="checkbox"]:not([disabled])').forEach(cb => {
      if (prev.includes(cb.value)) {
        cb.checked = true;
        cb.closest('.gastro-island-row, .gastro-premium-row')?.classList.add('selected');
      }
    });
    if (isAmericano) {
      updateAmericanoIslandVisuals(data.maxBase);
    } else {
      const grid = $('gastro-extras-grid');
      if (grid) updateFormalIslandVisuals(grid);
    }
  }

  if (!isAmericano) {
    const d = propuestaState.data;
    const restoreMenu = (listId, saved) => {
      const list = $(listId); if (!list || !saved?.length) return;
      list.querySelectorAll('input:not([disabled])').forEach(cb => {
        if (saved.includes(cb.value)) { cb.checked = true; cb.closest('.gastro-menu-row')?.classList.add('selected'); }
      });
    };
    restoreMenu('gastro-pasta-list', d.pastasSeleccionadas);
    restoreMenu('gastro-pasta-gourmet-list', d.pastasGourmetSeleccionadas);
    restoreMenu('gastro-salsa-list', d.salsasSeleccionadas);
    restoreMenu('gastro-salsa-gourmet-list', d.salsasGourmetSeleccionadas);
    if (d.platoCentral) {
      const radio = document.querySelector(`#gastro-plato-central input[value="${CSS.escape(d.platoCentral)}"]`);
      if (radio) { radio.checked = true; radio.closest('.gastro-plato-row')?.classList.add('selected'); }
    }
  }

  setupGastroEvents(isAmericano, data.maxBase);
  if (!isAmericano) setupFormalExtrasEvents();
}

function updateAmericanoIslandVisuals(maxBase) {
  const grid = $('gastro-extras-grid');
  const content = $('gastro-slide-content');
  if (!grid || !content) return;
  const islaRows = Array.from(grid.querySelectorAll('.gastro-island-row:not(.gastro-island-locked)'));
  const premiumRows = Array.from(content.querySelectorAll('.gastro-premium-row'));
  const allRows = [...islaRows, ...premiumRows];
  const selectedRows = allRows.filter(r => r.querySelector('input[type="checkbox"]').checked);
  allRows.forEach(row => {
    const isSelected = row.querySelector('input[type="checkbox"]').checked;
    const idx = selectedRows.indexOf(row);
    const isAdicional = isSelected && idx >= maxBase;
    row.classList.toggle('selected', isSelected && !isAdicional);
    row.classList.toggle('selected-adicional', isAdicional);
    const indicator = row.querySelector('.island-row-indicator, .premium-row-indicator');
    if (indicator) indicator.textContent = isAdicional ? '+' : '✓';
  });
  const n = selectedRows.length;
  const count = $('gastro-base-count');
  if (count) count.textContent = Math.min(n, maxBase);
  const counter = $('gastro-base-counter');
  if (counter) counter.classList.toggle('gastro-counter-full', n >= maxBase);
}

function updateFormalIslandVisuals(grid) {
  const rows = Array.from(grid.querySelectorAll('.gastro-island-row:not(.gastro-island-locked)'));
  const selected = rows.filter(r => r.querySelector('input[type="checkbox"]').checked);
  rows.forEach(row => {
    const isSelected = row.querySelector('input[type="checkbox"]').checked;
    const isExtra = isSelected && selected.indexOf(row) > 0;
    row.classList.toggle('selected-extra', isExtra);
    row.querySelector('.island-row-indicator').textContent = isExtra ? '+' : '✓';
  });
  const note = $('gastro-formal-extra-note');
  if (note) note.style.display = selected.length > 1 ? '' : 'none';
}

function setupGastroEvents(isAmericano, maxBase) {
  const grid = $('gastro-extras-grid');
  if (!grid) return;

  grid.querySelectorAll('.gastro-island-row:not(.gastro-island-locked)').forEach(row => {
    row.addEventListener('click', () => {
      const cb = row.querySelector('input[type="checkbox"]');
      if (isAmericano) {
        const content = $('gastro-slide-content');
        const allRows = [
          ...Array.from(grid.querySelectorAll('.gastro-island-row:not(.gastro-island-locked)')),
          ...Array.from(content?.querySelectorAll('.gastro-premium-row') || []),
        ];
        const currentSelected = allRows.filter(r => r.querySelector('input[type="checkbox"]').checked).length;
        if (!cb.checked && currentSelected >= maxBase + 1) return;
        cb.checked = !cb.checked;
        updateAmericanoIslandVisuals(maxBase);
      } else {
        cb.checked = !cb.checked;
        row.classList.toggle('selected', cb.checked);
        if (!cb.checked) row.classList.remove('selected-extra');
        updateFormalIslandVisuals(grid);
      }
    });
  });

  $('gastro-slide-content')?.querySelectorAll('.gastro-premium-row').forEach(row => {
    row.addEventListener('click', () => {
      const cb = row.querySelector('input[type="checkbox"]');
      if (isAmericano) {
        const content = $('gastro-slide-content');
        const allRows = [
          ...Array.from(grid?.querySelectorAll('.gastro-island-row:not(.gastro-island-locked)') || []),
          ...Array.from(content?.querySelectorAll('.gastro-premium-row') || []),
        ];
        const currentSelected = allRows.filter(r => r.querySelector('input[type="checkbox"]').checked).length;
        if (!cb.checked && currentSelected >= maxBase + 1) return;
        cb.checked = !cb.checked;
        updateAmericanoIslandVisuals(maxBase);
      } else {
        cb.checked = !cb.checked;
        row.classList.toggle('selected', cb.checked);
      }
    });
  });

  const mesaDulceList = $('gastro-mesa-dulce-list');
  if (mesaDulceList) {
    mesaDulceList.querySelectorAll('.gastro-island-row').forEach(row => {
      row.addEventListener('click', () => {
        const cb = row.querySelector('input[type="checkbox"]');
        cb.checked = !cb.checked;
        row.classList.toggle('selected', cb.checked);
      });
    });
  }

  const postresList = $('gastro-postres-list');
  if (postresList) {
    postresList.querySelectorAll('.gastro-island-row').forEach(row => {
      row.addEventListener('click', () => {
        const cb = row.querySelector('input[type="checkbox"]');
        if (cb.checked) {
          cb.checked = false;
          row.classList.remove('selected');
        } else {
          postresList.querySelectorAll('.gastro-island-row').forEach(r => {
            r.querySelector('input[type="checkbox"]').checked = false;
            r.classList.remove('selected');
          });
          cb.checked = true;
          row.classList.add('selected');
        }
      });
    });
  }
}

function setupFormalExtrasEvents() {
  const MAX_PASTA = 5, MAX_SALSAS = 4;

  function getPastaCount() {
    let n = 0;
    $('gastro-pasta-list')?.querySelectorAll('.gastro-menu-row:not(.locked) input:checked').forEach(() => n++);
    $('gastro-pasta-gourmet-list')?.querySelectorAll('input:checked').forEach(() => n++);
    return n;
  }
  function getSalsaCount() {
    let n = 0;
    $('gastro-salsa-list')?.querySelectorAll('.gastro-menu-row:not(.locked) input:checked').forEach(() => n++);
    $('gastro-salsa-gourmet-list')?.querySelectorAll('input:checked').forEach(() => n++);
    return n;
  }
  function updatePastaCounter() {
    const el = $('gastro-pasta-counter'); if (!el) return;
    const c = getPastaCount();
    el.textContent = c + '/' + MAX_PASTA;
    el.style.color = c >= MAX_PASTA ? 'var(--gold-bright)' : '';
  }
  function updateSalsaCounter() {
    const el = $('gastro-salsa-counter'); if (!el) return;
    const c = getSalsaCount();
    el.textContent = c + '/' + MAX_SALSAS;
    el.style.color = c >= MAX_SALSAS ? 'var(--gold-bright)' : '';
  }

  const addPastaListeners = (listId) => {
    const list = $(listId); if (!list) return;
    list.querySelectorAll('.gastro-menu-row:not(.locked)').forEach(row => {
      row.addEventListener('click', () => {
        const inp = row.querySelector('input'); if (!inp || inp.disabled) return;
        if (!inp.checked && getPastaCount() >= MAX_PASTA) return;
        inp.checked = !inp.checked;
        row.classList.toggle('selected', inp.checked);
        updatePastaCounter();
      });
    });
  };
  addPastaListeners('gastro-pasta-list');
  addPastaListeners('gastro-pasta-gourmet-list');

  const addSalsaListeners = (listId) => {
    const list = $(listId); if (!list) return;
    list.querySelectorAll('.gastro-menu-row:not(.locked)').forEach(row => {
      row.addEventListener('click', () => {
        const inp = row.querySelector('input'); if (!inp || inp.disabled) return;
        if (!inp.checked && getSalsaCount() >= MAX_SALSAS) return;
        inp.checked = !inp.checked;
        row.classList.toggle('selected', inp.checked);
        updateSalsaCounter();
      });
    });
  };
  addSalsaListeners('gastro-salsa-list');
  addSalsaListeners('gastro-salsa-gourmet-list');

  const centralList = $('gastro-plato-central');
  if (centralList) {
    centralList.querySelectorAll('.gastro-plato-row').forEach(row => {
      const radio = row.querySelector('input[type="radio"]');
      if (!radio) return;
      let wasChecked = false;
      // Capture state BEFORE the browser processes the label click
      row.addEventListener('mousedown', () => { wasChecked = radio.checked; });
      row.addEventListener('click', () => {
        centralList.querySelectorAll('.gastro-plato-row').forEach(r => {
          r.classList.remove('selected');
          const ri = r.querySelector('input'); if (ri) ri.checked = false;
        });
        if (!wasChecked) {
          radio.checked = true;
          row.classList.add('selected');
        }
      });
    });
  }

  updatePastaCounter();
  updateSalsaCounter();
}

function buildPropuestaResumen() {
  readPropuestaData();
  const d = propuestaState.data;
  const container = $('propuesta-resumen');
  if (!container) return;

  const estilo = d.estilo || 'Formal';
  const gastroData = GASTRO_DATA[estilo];
  const isFormal = estilo === 'Formal';
  const fechaFmt = d.fecha ? formatDate(d.fecha) : null;

  const islaValues = new Set((gastroData?.islas || []).map(i => i.value));
  const allPremiumItems = [...(gastroData?.premium || []), ...(gastroData?.mesaDulce?.upgrade ? [gastroData.mesaDulce.upgrade] : [])];
  const premiumValues = new Set(allPremiumItems.map(i => i.value));
  const selectedIslas = (d.gastroAdicionales || []).filter(v => islaValues.has(v));
  const selectedPremium = (d.gastroAdicionales || []).filter(v => premiumValues.has(v));

  const heroName = d.agasajado || d.tipoEvento || 'Tu evento';

  const metaParts = [
    d.tipoEvento && d.agasajado ? d.tipoEvento : null,
    fechaFmt,
    d.turno,
    d.invitados ? `${d.invitados} personas` : null,
    d.menuInfantil ? `Infantil: ${d.infantilCant || 'sí'}` : null,
    d.espacio || null,
  ].filter(Boolean);

  const pillarsHtml = (gastroData?.pillars || []).map(p =>
    `<div class="res-pilar"><span class="res-pilar-ico">${p.ico}</span><span class="res-pilar-label">${p.label.replace('<br>', ' ')}</span></div>`
  ).join('');

  const islaNames = selectedIslas.map(v => {
    const f = (gastroData?.islas || []).find(i => i.value === v);
    return f ? f.name : v;
  });
  const premiumNames = selectedPremium.map(v => {
    const f = allPremiumItems.find(i => i.value === v);
    return f ? f.name : v;
  });

  const islasHtml = (() => {
    const names = isFormal ? islaNames : [...islaNames, ...premiumNames];
    return names.length
      ? `<div class="res-islas">${names.map(n => `<span class="res-isla-tag">${esc(n)}</span>`).join('')}</div>`
      : '';
  })();
  const premiumHtml = isFormal && premiumNames.length
    ? `<div class="res-premium-tags">${premiumNames.map(n => `<span class="res-isla-tag res-isla-premium">${esc(n)}</span>`).join('')}</div>`
    : '';

  const formalPlatos = isFormal ? (() => {
    const tags = (arr) => arr.map(v => `<span class="res-isla-tag">${esc(v)}</span>`).join('');
    const pastas = ['Tagliatelle cortados a cuchillo', ...(d.pastasSeleccionadas||[]).filter(p=>p!=='Tagliatelle cortados a cuchillo'), ...(d.pastasGourmetSeleccionadas||[])];
    const salsas = ['Filetto', ...(d.salsasSeleccionadas||[]).filter(s=>s!=='Filetto'), ...(d.salsasGourmetSeleccionadas||[])];
    const parts = [];
    if (pastas.length) parts.push(`<div style="margin-top:8px"><span style="font-size:9px;letter-spacing:.12em;opacity:.5;text-transform:uppercase">Pastas</span><div class="res-islas" style="margin-top:4px">${tags(pastas)}</div></div>`);
    if (salsas.length) parts.push(`<div style="margin-top:6px"><span style="font-size:9px;letter-spacing:.12em;opacity:.5;text-transform:uppercase">Salsas</span><div class="res-islas" style="margin-top:4px">${tags(salsas)}</div></div>`);
    if (d.platoCentral) parts.push(`<div style="margin-top:6px"><span style="font-size:9px;letter-spacing:.12em;opacity:.5;text-transform:uppercase">Plato central</span><div class="res-islas" style="margin-top:4px"><span class="res-isla-tag">${esc(d.platoCentral)}</span></div></div>`);
    return parts.join('');
  })() : '';

  const gastroSection = (pillarsHtml || islasHtml || premiumHtml || formalPlatos) ? `
    <div class="res-section">
      <div class="res-section-label">Gastronomía de tu noche</div>
      ${pillarsHtml ? `<div class="res-pillars">${pillarsHtml}</div>` : ''}
      ${islasHtml}${premiumHtml}${formalPlatos}
    </div>` : '';

  const adicionales = d.adicionales || [];
  const adicionalesHtml = adicionales.length ? `
    <div class="res-section">
      <div class="res-section-label">Lo que la hace única</div>
      <div class="res-adicionales-tags">${adicionales.map(a => `<span class="res-adicional-tag">${esc(a)}</span>`).join('')}</div>
    </div>` : '';

  const pedidosHtml = d.pedidos ? `
    <div class="res-section">
      <div class="res-section-label">Pedidos especiales</div>
      <div class="res-pedidos-text">${esc(d.pedidos)}</div>
    </div>` : '';

  container.innerHTML = `
    <div class="res-top">
      ${d.nombre ? `<div class="res-subtitle-label">Preparada para</div>` : ''}
      <div class="res-hero-name">${esc(heroName)}</div>
      ${metaParts.length ? `<div class="res-meta-line">${metaParts.map(p => esc(p)).join(' · ')}</div>` : ''}
    </div>
    <div class="res-estilo-row"><span class="res-estilo-badge">${esc(estilo)}</span></div>
    ${gastroSection}
    ${adicionalesHtml}
    ${pedidosHtml}
    <div class="res-todo-posible">Todo lo que imaginás se puede hacer · esta propuesta es un punto de partida · estamos para construirla con vos</div>
  `;
}

function generatePropuestaPDF() {
  readPropuestaData();
  const d = propuestaState.data;
  const hoy = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
  const anio = new Date().getFullYear();
  const fechaFmt = d.fecha ? formatDate(d.fecha) : '—';
  const infantilStr = d.menuInfantil ? `Sí${d.infantilCant ? ` · ${d.infantilCant} niños` : ''}` : '';
  const estilo = d.estilo || 'Formal';
  const pasos = RECORRIDO[estilo] || RECORRIDO.Formal;
  const base = window.location.origin;

  const timelineHTML = pasos.map((p, i) => `
    <div class="tl-row">
      <div class="tl-mark">
        <div class="tl-dot">${String(i + 1).padStart(2, '0')}</div>
        ${i < pasos.length - 1 ? '<div class="tl-line"></div>' : ''}
      </div>
      <div class="tl-body">
        <div class="tl-name">${esc(p.nombre)}</div>
        <div class="tl-desc">${esc(p.desc)}</div>
      </div>
    </div>`).join('');

  const gastroData = GASTRO_DATA[estilo];
  const isFormal = estilo === 'Formal';

  // Gastro detail with descriptions
  const islaValues = new Set((gastroData?.islas || []).map(i => i.value));
  const allPremiumItems = [...(gastroData?.premium || []), ...(gastroData?.mesaDulce?.upgrade ? [gastroData.mesaDulce.upgrade] : [])];
  const premiumValues = new Set(allPremiumItems.map(i => i.value));
  const selectedIslas = (d.gastroAdicionales || []).filter(v => islaValues.has(v));
  const selectedPremium = (d.gastroAdicionales || []).filter(v => premiumValues.has(v));
  const lockedIslas = (gastroData?.islas || []).filter(i => i.locked);
  const allShownIslas = isFormal
    ? [...lockedIslas.map(i=>i.value), ...selectedIslas]
    : [...lockedIslas.map(i=>i.value), ...selectedIslas, ...selectedPremium];

  // ---- Row & card helpers ----
  const mkRow = (name, desc = '', tags = []) => {
    const tg = tags.map(t => `<span class="dt-${t.toLowerCase()}">${t}</span>`).join('');
    return `<li><div class="mi-info"><span class="mi-name">${esc(name)}${tg ? `&nbsp;${tg}` : ''}</span>${desc ? `<span class="mi-desc">${esc(desc)}</span>` : ''}</div></li>`;
  };
  const mkCard = (name, cat = '', desc = '') =>
    `<div class="i-card"><div class="i-hd"><span class="i-name">${esc(name)}</span>${cat ? `<span class="i-cat">${esc(cat)}</span>` : ''}</div>${desc ? `<div class="i-desc">${esc(desc)}</div>` : ''}</div>`;

  // ---- Recepción (contenido fijo, siempre igual) ----
  const recepcionHTML = `
    <div class="mb-sublbl">Canapés fríos</div>
    <ul class="mi">
      ${mkRow('Bocado mediterráneo','Mozzarella, tomate cherry, albahaca y sal en escamas',['V','SC'])}
      ${mkRow('Jamón Imperial','Jamón natural, mayonesa de huevo de codorniz y pimentón dulce español')}
      ${mkRow('Palma Serrana','Crema de palmitos con virutas de jamón ibérico y toque de oliva')}
      ${mkRow('Azul y Nuez','Queso azul, nueces trituradas y miel',['V'])}
      ${mkRow('Bosque y Queso','Champiñón fresco salteado con queso suave fundido',['V'])}
    </ul>
    <div class="mb-sublbl">Triples de miga</div>
    <ul class="mi">${mkRow('Variedad de triples de miga')}</ul>
    <div class="mb-sublbl">Bruschettas</div>
    <ul class="mi two-col">
      ${mkRow('Braseada suave','Osobuco braseado en reducción de vino tinto y toque de romero')}
      ${mkRow('Campo verde','Pollo al verdeo en mayonesa y queso fundido')}
      ${mkRow('Delicia Ibérica','Jamón crudo, rúcula fresca, parmesano y reducción de aceto')}
      ${mkRow('BBQ','Bondiola en lenta cocción desmenuzada con barbacoa de la casa')}
    </ul>
    <div class="mb-sublbl">Brochettes &amp; bocados calientes</div>
    <ul class="mi two-col">
      ${mkRow('Criolla de carne','Trozos de carne jugosa con morrón asado y cebolla a la parrilla',['SC'])}
      ${mkRow('Criolla de pollo','Bocados de pollo grillados con cherry y vegetales asados',['SC'])}
      ${mkRow('Italiana fría','Mozzarella y tomate con reducción de balsámico y hojas de albahaca',['V','SC'])}
      ${mkRow('Bombitas de queso','Quesillo fundido en panizado crocante, servidas calientes',['V'])}
      ${mkRow('Daditos de mozzarella','',['V','SC'])}
      ${mkRow('Croquetitas de papa','',['V'])}
      ${mkRow('Mini hamburguesas caseras')}
      ${mkRow('Pollo frito Buffalo wings')}
    </ul>
    <div class="mb-sublbl">Mini empanaditas</div>
    <ul class="mi two-col">
      ${mkRow('Fatay de carne')}
      ${mkRow('Soles de calabaza y semillas grilladas','',['V'])}
      ${mkRow('Canastitas de batata y almendra','',['V'])}
      ${mkRow('Jamón y queso')}
      ${mkRow('Cebolla y queso','',['V'])}
      ${mkRow('Paquetitos de boniato y amapola','',['V'])}
      ${mkRow('Pollo')}
      ${mkRow('Fingers de zanahoria','',['V'])}
    </ul>`;

  // ---- Islas (solo las seleccionadas) ----
  const allIslaItems = [...(gastroData?.islas || []), ...allPremiumItems];
  const regularFormalPremium = isFormal ? selectedPremium.filter(v => v !== 'Mini Cakes Premium') : [];
  const hasMiniCakes = isFormal && selectedPremium.includes('Mini Cakes Premium');

  const islasSectionHTML = allShownIslas.length ? (() => {
    if (isFormal) {
      const baseRows = allShownIslas.map(v => {
        const f = allIslaItems.find(i => i.value === v);
        return f ? mkRow(f.name, f.desc || '') : mkRow(v);
      }).join('');
      const premiumRows = regularFormalPremium.map(v => {
        const f = allIslaItems.find(i => i.value === v);
        return f ? mkRow(f.name, f.desc || '') : mkRow(v);
      }).join('');
      const premiumBlock = premiumRows ? `<div class="mb-sublbl" style="margin-top:8px;color:var(--gold)">PREMIUM · A CONSULTAR</div><ul class="mi">${premiumRows}</ul>` : '';
      return `<div class="mb"><div class="mb-head"><span class="mb-roman">ii</span><span class="mb-name">Estaciones de bienvenida</span><span class="mb-line"></span></div>
        <div class="mb-sub">Una incluida · adicionales a consultar</div>
        <ul class="mi">${baseRows}</ul>${premiumBlock}</div>`;
    } else {
      const cards = allShownIslas.map(v => {
        const f = allIslaItems.find(i => i.value === v);
        return f ? mkCard(f.name, f.cat || '', f.desc || '') : mkCard(v);
      }).join('');
      const extraCount = selectedIslas.length + selectedPremium.length;
      const sub = `Base incluida · ${extraCount} adicional${extraCount !== 1 ? 'es' : ''} elegida${extraCount !== 1 ? 's' : ''}`;
      return `<div class="mb"><div class="mb-head"><span class="mb-roman">ii</span><span class="mb-name">Islas en vivo — el plato central</span><span class="mb-line"></span></div>
        <div class="mb-sub">${esc(sub)}</div>
        <div class="i-cards">${cards}</div></div>`;
    }
  })() : '';

  // ---- Primer plato + Plato central (solo Formal) ----
  const formalPlatoHTML = isFormal ? (() => {
    const pastas = ['Tagliatelle cortados a cuchillo', ...(d.pastasSeleccionadas||[]).filter(p=>p!=='Tagliatelle cortados a cuchillo'), ...(d.pastasGourmetSeleccionadas||[])];
    const salsas = ['Filetto', ...(d.salsasSeleccionadas||[]).filter(s=>s!=='Filetto'), ...(d.salsasGourmetSeleccionadas||[])];
    const platoCentral = d.platoCentral ? (PLATO_CENTRAL_DATA.opciones.find(p=>p.value===d.platoCentral) || {value:d.platoCentral,desc:''}) : null;
    const ppRows = pastas.map(p=>mkRow(p)).join('') || mkRow('A definir con el equipo');
    const salRows = salsas.map(s=>mkRow(s)).join('') || mkRow('Filetto siempre incluida · 4 a elección');
    const pcRow = platoCentral ? mkRow(platoCentral.value, platoCentral.desc||'') : mkRow('Plato central · a confirmar');
    return `<div class="mb"><div class="mb-head"><span class="mb-roman">iii</span><span class="mb-name">Primer plato — Pastas</span><span class="mb-line"></span></div>
      <div class="mb-cols"><div><div class="mb-sub">Pastas elegidas</div><ul class="mi">${ppRows}</ul></div><div><div class="mb-sub">Salsas · Filetto incluida</div><ul class="mi">${salRows}</ul></div></div></div>
    <div class="mb"><div class="mb-head"><span class="mb-roman">iv</span><span class="mb-name">Plato central</span><span class="mb-line"></span></div><ul class="mi">${pcRow}</ul></div>`;
  })() : '';

  // ---- Mesa de dulces / Postres ----
  const mesaDulceHTML = (() => {
    const md = gastroData?.mesaDulce;
    if (!md) return '';
    if (isFormal) {
      const jolietRows = [
        mkRow('Lemon pie'),mkRow('Cheese cake'),mkRow('Chocotorta'),mkRow('Torta África'),
        mkRow('Tarta de frutillas'),mkRow('Flan','',['SC']),mkRow('Isla flotante','',['SC']),
        mkRow('Mil Hojas'),mkRow('Brownies rellenos'),mkRow('Copas heladas','',['SC']),mkRow('Panqueques'),
      ].join('');
      const miniCakesBlock = hasMiniCakes ? `<div class="mb-sublbl" style="margin-top:8px;color:var(--gold)">UPGRADE · MINI CAKES PREMIUM</div><ul class="mi">${mkRow('Mini Cakes Premium','Todas las variedades de la pastelería Joliet en formato mini, con diferentes presentaciones y terminaciones')}</ul>` : '';
      return `<div class="mb"><div class="mb-head"><span class="mb-roman">v</span><span class="mb-name">Mesa de dulces</span><span class="mb-line"></span></div>
        <div class="mb-sub">Pastelería artesanal Joliet · elaboración propia</div>
        <ul class="mi two-col">${jolietRows}</ul>${miniCakesBlock}
        <p class="torta-note">Torta Homenaje · se realiza a pedido del agasajado · colores y decoración a convenir</p></div>`;
    } else {
      const selectedPostreItems = (md.postres||[]).filter(p=>(d.gastroAdicionales||[]).includes(p.name));
      const lockedRow = `<li class="mi-locked"><div class="mi-info"><span class="mi-name">Torta Homenaje <span class="mi-badge">siempre incluida</span></span><span class="mi-desc">A pedido del agasajado · colores y decoración a convenir · se sirve después de los postres</span></div></li>`;
      const postreRows = selectedPostreItems.length
        ? selectedPostreItems.map(p=>mkRow(p.name, p.desc)).join('')
        : `<li><div class="mi-info"><span class="mi-name" style="opacity:.6;font-style:italic">Postre a definir con el equipo</span></div></li>`;
      return `<div class="mb"><div class="mb-head"><span class="mb-roman">iii</span><span class="mb-name">Postres &amp; Torta Homenaje</span><span class="mb-line"></span></div>
        <div class="mb-sub">Pastelería artesanal · elaboración propia</div>
        <ul class="mi">${lockedRow}${postreRows}</ul></div>`;
    }
  })();

  // ---- Adicionales ----
  const ADIC_GRUPOS = [
    { label: 'Para la recepción', items: ['Candy Bar'] },
    { label: 'Entre platos & Shows', items: ['Diversos Shows', 'Robot de Luces', 'Música & Entretenimiento'] },
    { label: 'Cabinas & Momentos', items: ['Cabina de Instagram', 'Cabina de Glitter', 'Cabina de Fotos'] },
    { label: 'Decoración & Cotillón', items: ['Cotillón Premium', 'Cotillón Premium Personalizado'] },
  ];
  const adicGrupos = ADIC_GRUPOS.map(g => {
    const found = (d.adicionales||[]).filter(a => g.items.includes(a));
    return found.length ? `<div class="add-group-label">${esc(g.label)}</div><div class="tags-wrap">${found.map(a=>`<span class="tag">${esc(a)}</span>`).join('')}</div>` : '';
  }).join('');
  const hasAdicionales = !!(d.adicionales||[]).length;

  const adicSecNum = hasAdicionales ? 'III' : null;
  const svcSecNum  = hasAdicionales ? 'IV'  : 'III';
  const tcSecNum   = hasAdicionales ? 'V'   : 'IV';

  const metaHTML = [
    d.tipoEvento ? { k: 'Evento',    v: esc(d.tipoEvento) + (d.agasajado ? ' · ' + esc(d.agasajado) : '') } : null,
    d.fecha      ? { k: 'Fecha',     v: esc(fechaFmt) }   : null,
    d.turno      ? { k: 'Turno',     v: esc(d.turno) }    : null,
    { k: 'Invitados', v: d.invitados + ' personas' + (infantilStr ? ' · Infantil: ' + infantilStr : '') },
    d.espacio    ? { k: 'Espacio',   v: esc(d.espacio) }  : null,
    { k: 'Modalidad', v: esc(estilo) },
  ].filter(Boolean).map(x => `
    <div class="meta-item">
      <span class="meta-k">${x.k}</span>
      <span class="meta-v">${x.v}</span>
    </div>`).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Propuesta · Joliet Eventos</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-font-smoothing:antialiased}
:root{--paper:#FAF7F2;--ink:#1A1A1A;--gold:#9D7E3C;--gold-soft:#C9B27C;--muted:#8B8074;--hairline:#D8CFC0;--warm:#F2EDE3}
body{background:#DDD5C7;font-family:'Inter',sans-serif;color:var(--ink);padding:24px 0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;min-height:297mm;background:var(--paper);margin:0 auto 24px;padding:20mm 20mm 28mm;position:relative;overflow:hidden;page-break-after:always}
@page{size:A4;margin:0}
@media print{body{background:white;padding:0}.page{margin:0;box-shadow:none}}
/* PORTADA */
.cover{padding:0;display:flex;flex-direction:column}
.cover::before{content:'';position:absolute;top:9mm;right:9mm;bottom:9mm;left:9mm;border:.5px solid rgba(157,126,60,.38);pointer-events:none;z-index:1}
.cover::after{content:'';position:absolute;top:11mm;right:11mm;bottom:11mm;left:11mm;border:.5px solid rgba(157,126,60,.18);pointer-events:none;z-index:1}
.cov-logo{padding:18mm 20mm 0;text-align:center}
.cov-tag{font-size:9px;letter-spacing:.4em;color:var(--gold);text-transform:uppercase;margin-bottom:16px}
.cov-title{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:26px;color:var(--ink);margin-top:14px;display:block}
.cov-num{font-size:9px;letter-spacing:.26em;color:var(--muted);text-transform:uppercase;margin-top:6px}
.cov-photo{margin:12mm 20mm 0;height:72mm;background-size:cover;background-position:center;background-color:#2a3042;position:relative;overflow:hidden}
.cov-photo::after{content:'';position:absolute;inset:6px;border:1px solid rgba(250,247,242,.3)}
.cov-client{margin:10mm 20mm 0;text-align:center;padding-bottom:4mm}
.cov-label{font-size:9px;letter-spacing:.32em;color:var(--muted);text-transform:uppercase;margin-bottom:8px}
.cov-name{font-family:'Cormorant Garamond',serif;font-size:32px;font-weight:400;color:var(--ink)}
.cov-meta{display:flex;justify-content:center;gap:22px;margin-top:14px;flex-wrap:wrap}
.meta-item{text-align:center}
.meta-k{display:block;font-size:8px;letter-spacing:.24em;color:var(--muted);text-transform:uppercase;margin-bottom:3px}
.meta-v{display:block;font-family:'Cormorant Garamond',serif;font-size:17px;color:var(--ink)}
.cov-foot{position:absolute;bottom:18mm;left:20mm;right:20mm;text-align:center;font-size:8.5px;color:var(--muted);letter-spacing:.22em;text-transform:uppercase}
.cov-foot .rule{width:32px;height:1px;background:var(--gold);margin:0 auto 9px}
/* INTERIOR */
.ph{display:flex;justify-content:space-between;align-items:center;padding-bottom:11px;border-bottom:1px solid var(--hairline);margin-bottom:22px}
.ph-logo{width:34px;height:34px;background:#0f0f0f;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0}
.ph-logo::before{content:'JOLIET';font-family:'Inter',sans-serif;font-weight:900;font-size:6px;color:white;letter-spacing:.06em}
.ph-logo::after{content:'EVENTOS';font-family:'Inter',sans-serif;font-size:3px;color:rgba(255,255,255,.7);letter-spacing:.35em;margin-top:2px}
.ph-folio{font-size:9px;letter-spacing:.16em;color:var(--muted);text-transform:uppercase}
.salut{font-family:'Cormorant Garamond',serif;font-size:19px;font-style:italic;margin-bottom:10px}
.bcopy{font-size:11.5px;line-height:1.7;color:#2A2620;max-width:155mm}
.bcopy p+p{margin-top:7px}
.stitle{margin-top:11mm;margin-bottom:12px;display:flex;align-items:baseline;gap:12px}
.snum{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:13px;color:var(--paper);background:var(--gold);padding:3px 9px 2px;letter-spacing:.08em}
.sname{font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:500;letter-spacing:.02em}
.srule{flex:1;height:1px;background:var(--hairline)}
/* TIMELINE */
.tl{margin-top:4px}
.tl-row{display:grid;grid-template-columns:30px 1fr;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--hairline)}
.tl-row:last-child{border-bottom:none}
.tl-mark{display:flex;flex-direction:column;align-items:center;padding-top:1px}
.tl-dot{width:22px;height:22px;border:1px solid var(--gold);border-radius:50%;background:var(--paper);display:flex;align-items:center;justify-content:center;font-family:'Cormorant Garamond',serif;font-style:italic;font-size:10.5px;color:var(--gold);flex-shrink:0}
.tl-line{width:1px;background:var(--gold-soft);flex:1;min-height:12px;margin-top:2px}
.tl-name{font-family:'Cormorant Garamond',serif;font-size:16px;font-weight:500;letter-spacing:.04em;text-transform:uppercase}
.tl-desc{font-size:10px;color:var(--muted);margin-top:1px;line-height:1.45}
/* MENU BLOCKS */
.mb{margin-bottom:14px;break-inside:avoid}
.mb-head{display:flex;align-items:baseline;gap:11px;margin-bottom:6px}
.mb-roman{font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--gold);font-size:14px;letter-spacing:.12em}
.mb-name{font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:500;letter-spacing:.04em;text-transform:uppercase}
.mb-line{flex:1;height:1px;background:var(--hairline)}
.mb-sub{font-size:8.5px;letter-spacing:.2em;color:var(--gold);text-transform:uppercase;margin-bottom:5px;padding-left:8px}
.mb-cols{display:grid;grid-template-columns:1fr 1fr;gap:0 20px}
.mi{list-style:none;font-family:'Cormorant Garamond',serif;font-size:13px;background:var(--warm);border:1px solid var(--hairline)}
.mi li{display:flex;flex-direction:column;padding:5px 12px;border-bottom:1px solid rgba(216,207,192,.5)}
.mi li:last-child{border-bottom:none}
.mi-info{display:flex;flex-direction:column;gap:1px}
.mi-name{font-size:13px;line-height:1.35}
.mi-desc{font-family:'Inter',sans-serif;font-size:9px;color:var(--muted);font-style:italic;line-height:1.35}
/* TAGS */
.tags-wrap{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}
.tag{font-family:'Cormorant Garamond',serif;font-size:12px;letter-spacing:.03em;background:var(--warm);border:1px solid var(--hairline);color:var(--ink);padding:4px 13px}
.add-group-label{font-size:8.5px;letter-spacing:.2em;color:var(--muted);text-transform:uppercase;margin-bottom:3px;margin-top:10px}
/* SERVICES */
.svc-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin-top:5px}
.svc-item{display:flex;align-items:flex-start;gap:9px;padding:5px 0;border-bottom:1px dotted var(--hairline)}
.svc-chk{flex:0 0 15px;height:15px;border:1px solid var(--gold);display:flex;align-items:center;justify-content:center;margin-top:2px}
.svc-chk::after{content:'';width:3px;height:6.5px;border-right:1.5px solid var(--gold);border-bottom:1.5px solid var(--gold);transform:rotate(45deg) translate(-1px,-1px)}
.svc-lbl{font-size:10.5px;color:var(--ink);line-height:1.4}
/* CLOSING */
.closing{margin-top:10mm;text-align:center}
.closing .cl-line{width:44px;height:1px;background:var(--gold);margin:0 auto 12px}
.closing .cl-text{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:15px;color:var(--ink);max-width:130mm;margin:0 auto;line-height:1.55}
.closing .cl-sig{font-family:'Cormorant Garamond',serif;font-size:19px;margin-top:16px}
.closing .cl-sig small{display:block;font-family:'Inter',sans-serif;font-size:8.5px;letter-spacing:.24em;color:var(--muted);text-transform:uppercase;margin-top:3px}
.pfoot{position:absolute;bottom:11mm;left:20mm;right:20mm;display:flex;justify-content:space-between;align-items:center;font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.15em;padding-top:9px;border-top:1px solid var(--hairline)}
.ped-box{background:var(--warm);border:1px solid var(--hairline);padding:11px 14px;font-size:11.5px;line-height:1.7;color:#2A2620;margin-top:5px;font-style:italic}
/* DIETARY TAGS */
.dt-v,.dt-vg,.dt-sc{font-family:'Inter',sans-serif;font-size:7.5px;font-weight:600;letter-spacing:.06em;padding:1.5px 5px;border-radius:2px;vertical-align:middle;margin-left:4px;display:inline-block;line-height:1}
.dt-v{background:rgba(88,160,88,.13);color:#2a6b2a;border:1px solid rgba(88,160,88,.28)}
.dt-vg{background:rgba(60,130,180,.10);color:#1e5f80;border:1px solid rgba(60,130,180,.22)}
.dt-sc{background:rgba(190,120,40,.10);color:#7a4510;border:1px solid rgba(190,120,40,.22)}
.dt-legend{font-size:7.5px;color:var(--muted);letter-spacing:.09em;margin-bottom:8px;padding-left:2px;display:flex;gap:14px}
/* ISLAND CARDS */
.i-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:6px}
.i-card{background:var(--warm);border:1px solid var(--hairline);padding:7px 9px;break-inside:avoid}
.i-hd{display:flex;flex-direction:column;gap:2px;margin-bottom:3px}
.i-name{font-family:'Cormorant Garamond',serif;font-size:13px;font-weight:500;line-height:1.2}
.i-cat{font-family:'Inter',sans-serif;font-size:7px;letter-spacing:.15em;color:var(--gold);text-transform:uppercase}
.i-desc{font-family:'Inter',sans-serif;font-size:8.5px;color:var(--muted);line-height:1.35;font-style:italic}
/* LISTS */
.two-col{columns:2;column-gap:14px}
.mb-sublbl{font-family:'Inter',sans-serif;font-size:7.5px;letter-spacing:.18em;color:var(--muted);text-transform:uppercase;margin:8px 0 2px;padding-left:2px}
/* LOCKED ROW */
.mi-locked{background:rgba(157,126,60,.06)!important;border-left:2px solid var(--gold)!important}
.mi-badge{font-family:'Inter',sans-serif;font-size:7px;letter-spacing:.1em;color:var(--gold);text-transform:uppercase;border:1px solid rgba(157,126,60,.5);padding:1px 5px;margin-left:6px;vertical-align:middle;display:inline-block}
.torta-note{font-family:'Inter',sans-serif;font-size:8px;font-style:italic;color:var(--muted);padding:5px 8px;margin-top:5px;border-top:1px solid var(--hairline)}
/* T&C */
.tc-body{font-family:'Inter',sans-serif;font-size:7.8px;line-height:1.6;color:#5a5040;text-align:justify;columns:2;column-gap:22px;column-rule:1px solid var(--hairline);margin-top:6px}
.tc-body p+p{margin-top:5px}
.tc-clause{font-weight:700;font-size:7px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);display:block;margin-top:8px;margin-bottom:1px}
</style>
</head>
<body>

<!-- PORTADA -->
<div class="page cover">
  <div class="cov-logo">
    <div class="cov-tag">Salón de Eventos · Ciudad Tesei</div>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="120" height="120" style="display:block;margin:0 auto 12px">
      <circle cx="100" cy="100" r="98" fill="#0f0f0f"/>
      <text x="100" y="113" font-family="'Inter',sans-serif" font-weight="900" font-size="43" fill="white" text-anchor="middle" letter-spacing="2">JOLIET</text>
      <circle cx="112" cy="74" r="3.5" fill="white"/>
      <text x="100" y="136" font-family="'Inter',sans-serif" font-weight="500" font-size="14" fill="white" text-anchor="middle" letter-spacing="6">EVENTOS</text>
    </svg>
    <span class="cov-title">Propuesta comercial para su evento</span>
    <div class="cov-num">Emitida: ${esc(hoy)}</div>
  </div>

  <div class="cov-photo" style="background-image:linear-gradient(0deg,rgba(26,26,26,.38),rgba(26,26,26,.06)),url('${base}/img/propuesta/jardin.jpeg'),linear-gradient(135deg,#2A3548,#5A6478)"></div>

  <div class="cov-client">
    <div class="cov-label">Preparada para</div>
    <div class="cov-name">${esc(d.nombre || (d.tipoEvento && d.agasajado ? d.agasajado : '') || d.tipoEvento || 'su evento')}</div>
    <div class="cov-meta">${metaHTML}</div>
  </div>

  <div class="cov-foot">
    <div class="rule"></div>
    Juana Azurduy 531 · Ciudad Tesei · 11 5424 0870 · labartam@gmail.com
  </div>
</div>

<!-- CARTA + RECORRIDO -->
<div class="page">
  <div class="ph">
    <div class="ph-logo"></div>
    <div class="ph-folio">Propuesta · ${esc(d.nombre || d.tipoEvento || 'evento')} · ${esc(fechaFmt)}</div>
  </div>

  <div class="salut">Estimado/a${d.nombre ? ' ' + esc(d.nombre) + ',' : ','}</div>
  <div class="bcopy">
    <p>Ponemos a su consideración la presente propuesta${d.tipoEvento ? ' para el evento de <strong>' + esc(d.tipoEvento) + '</strong>' : ' para su celebración'}${d.fecha ? ', a realizarse el <strong>' + esc(fechaFmt) + '</strong>' : ''}${d.espacio ? ' en nuestro espacio <strong>' + esc(d.espacio) + '</strong>' : ' en nuestro salón'}${d.invitados ? ', con una asistencia de <strong>' + d.invitados + ' invitados</strong>' : ''}.</p>
    <p>A continuación encontrará el recorrido de su noche, el detalle de la propuesta gastronómica y los adicionales seleccionados.</p>
  </div>

  <div class="stitle" style="margin-top:9mm">
    <span class="snum">I.</span>
    <span class="sname">El recorrido de su noche</span>
    <span class="srule"></span>
  </div>
  <div class="tl">${timelineHTML}</div>

  <div class="stitle">
    <span class="snum">II.</span>
    <span class="sname">La propuesta gastronómica</span>
    <span class="srule"></span>
  </div>
  <div class="dt-legend"><span><span class="dt-v">V</span>&nbsp;Vegetariano</span><span><span class="dt-vg">Vg</span>&nbsp;Vegano</span><span><span class="dt-sc">SC</span>&nbsp;Sin TACC</span></div>
  <div class="mb"><div class="mb-head"><span class="mb-roman">i</span><span class="mb-name">Recepción</span><span class="mb-line"></span></div>
    <div class="mb-sub">Canapés fríos, bruschettas, bocados calientes y mini empanaditas</div>
    ${recepcionHTML}
  </div>
  ${islasSectionHTML}
  ${formalPlatoHTML}
  ${mesaDulceHTML}

  ${adicGrupos ? `
  <div class="stitle">
    <span class="snum">${adicSecNum}.</span>
    <span class="sname">Adicionales elegidos</span>
    <span class="srule"></span>
  </div>
  ${adicGrupos}` : ''}

  <div class="stitle">
    <span class="snum">${svcSecNum}.</span>
    <span class="sname">La experiencia Joliet</span>
    <span class="srule"></span>
  </div>
  <div style="font-size:10px;color:var(--muted);margin-bottom:8px;letter-spacing:.04em">Cada evento Joliet incluye, sin excepción</div>
  <div class="svc-grid">
    <div class="svc-item"><span class="svc-chk"></span><span class="svc-lbl">Vajilla de porcelana y plato de sitio</span></div>
    <div class="svc-item"><span class="svc-chk"></span><span class="svc-lbl">Maître, mozos, chef, barman y coordinadora general</span></div>
    <div class="svc-item"><span class="svc-chk"></span><span class="svc-lbl">Mantelería a elección y centros de mesa incluidos</span></div>
    <div class="svc-item"><span class="svc-chk"></span><span class="svc-lbl">Cristalería y cubertería completa</span></div>
    <div class="svc-item"><span class="svc-chk"></span><span class="svc-lbl">Agua, gaseosas, cerveza, vino, sidra y champagne</span></div>
    <div class="svc-item"><span class="svc-chk"></span><span class="svc-lbl">Bar de tragos para la recepción o toda la noche</span></div>
    <div class="svc-item"><span class="svc-chk"></span><span class="svc-lbl">Iluminación de diseño y provisiones completas</span></div>
    <div class="svc-item"><span class="svc-chk"></span><span class="svc-lbl">Coordinación integral y seguimiento personalizado</span></div>
  </div>

  ${d.pedidos ? `
  <div class="stitle" style="margin-top:8mm">
    <span class="sname" style="font-size:19px">Pedidos especiales</span>
    <span class="srule"></span>
  </div>
  <div class="ped-box">${esc(d.pedidos)}</div>` : ''}

  <div class="pfoot">
    <span>Juana Azurduy 531 · Ciudad Tesei · 11 5424 0870 · labartam@gmail.com</span>
    <span>Joliet Eventos · ${anio}</span>
  </div>
</div>

<!-- TÉRMINOS Y CONDICIONES -->
<div class="page">
  <div class="ph">
    <div class="ph-logo"></div>
    <div class="ph-folio">Propuesta · ${esc(d.nombre || d.tipoEvento || 'evento')} · ${esc(fechaFmt)}</div>
  </div>
  <div class="stitle" style="margin-top:0">
    <span class="snum">${tcSecNum}.</span>
    <span class="sname">Términos y condiciones</span>
    <span class="srule"></span>
  </div>
  <div class="tc-body">
    <p><span class="tc-clause">1. Validez de la propuesta</span>La presente propuesta comercial tiene validez de quince (15) días corridos a partir de la fecha de emisión indicada en la portada. Transcurrido dicho plazo, los valores y las condiciones aquí descritos quedan sujetos a revisión y actualización sin previo aviso. Joliet Eventos no asume compromiso de mantener los precios más allá del período de validez mencionado.</p>
    <p><span class="tc-clause">2. Reserva y confirmación de fecha</span>La seña inicial del 10% sobre el total acordado da inicio al proceso de planificación pero no constituye ni garantiza la reserva ni el bloqueo exclusivo de la fecha. La reserva efectiva y la exclusividad de la fecha quedan garantizadas únicamente a partir del pago de la seña de reserva del 30% sobre el total de la propuesta. Hasta que dicho pago no sea acreditado la fecha podrá ser cedida o asignada a otro cliente sin aviso previo ni obligación de notificación por parte de Joliet Eventos.</p>
    <p><span class="tc-clause">3. Plan de pagos</span>El saldo restante luego de efectuada la reserva podrá ser abonado en cuotas mensuales acordadas entre las partes, conforme al cronograma que se establezca al momento de la firma. Las cuotas deberán estar canceladas en su totalidad con un mínimo de treinta (30) días corridos de anticipación a la fecha del evento. El incumplimiento de este plazo podrá dar lugar a la suspensión del servicio sin derecho a reintegro de los montos ya abonados.</p>
    <p><span class="tc-clause">4. Cantidad de invitados</span>La cantidad definitiva de invitados deberá ser informada y confirmada con no menos de diez (10) días de anticipación a la celebración. A partir de dicha confirmación no se aceptarán bajas en el número de cubiertos bajo ninguna circunstancia. En caso de incorporarse invitados adicionales con posterioridad a la confirmación final, cada cubierto extra se abonará al precio unitario vigente a la fecha de incorporación. Se admiten altas hasta cuarenta y ocho (48) horas antes del evento, sujeto a disponibilidad operativa del equipo.</p>
    <p><span class="tc-clause">5. Política de cancelación</span>No se realizan devoluciones de dinero bajo ningún concepto ni circunstancia, incluyendo casos de fuerza mayor, emergencias médicas o personales, causas climáticas, restricciones gubernamentales u otras contingencias ajenas a la voluntad de las partes. Todos los montos abonados —seña, reserva, cuotas parciales o cualquier pago a cuenta— quedan retenidos en su totalidad por Joliet Eventos en concepto de compensación por la gestión administrativa, la exclusividad de la fecha reservada, los costos de planificación ya incurridos y las reservas de personal y proveedores efectuadas desde la fecha de confirmación.</p>
    <p><span class="tc-clause">6. Necesidades dietarias especiales</span>Joliet Eventos contempla y atiende sin cargo adicional las necesidades dietarias especiales de los invitados, incluyendo dietas celíacas (sin TACC), vegetarianas, veganas y alergias o intolerancias alimentarias. Para poder garantizar la disponibilidad, preparación adecuada y la trazabilidad de los ingredientes, dichas necesidades deberán ser informadas formalmente con un mínimo de quince (15) días de anticipación al evento. Necesidades informadas fuera de ese plazo se atenderán en la medida de lo posible, sin garantía de cobertura completa.</p>
    <p><span class="tc-clause">7. Medios de pago</span>Se aceptan los siguientes medios de pago: efectivo, transferencia bancaria o depósito a CBU informado oportunamente, tarjeta de crédito (todas las marcas) y tarjeta de débito. Los pagos con tarjeta de crédito pueden estar sujetos a los recargos del sistema financiero vigentes al momento del pago, los cuales corren por cuenta del cliente. Los comprobantes de transferencia deben ser enviados por WhatsApp o correo electrónico dentro de las veinticuatro (24) horas de efectuada la operación para ser considerados válidos y registrados.</p>
    <p><span class="tc-clause">8. Modificaciones al servicio contratado</span>Los servicios detallados en esta propuesta corresponden exclusivamente a los acordados al momento de la firma del contrato. Cualquier modificación, incorporación de servicios adicionales o cambio de menú posterior a la confirmación debe ser solicitado por escrito y aceptado expresamente por Joliet Eventos, pudiendo implicar ajustes en el valor total. Joliet Eventos se reserva el derecho de realizar ajustes menores en la presentación de platos o decoración cuando causas operativas o de abastecimiento lo justifiquen, sin que ello constituya incumplimiento de las obligaciones contractuales asumidas.</p>
    <p><span class="tc-clause">9. Responsabilidad sobre bienes y personas</span>Joliet Eventos no se responsabiliza por daños, hurtos, extravíos o deterioro de objetos personales, decoraciones propias del cliente o equipamiento ajeno introducido al salón. El cliente asume plena responsabilidad por cualquier daño causado al mobiliario, instalaciones o equipamiento del salón por parte de sus invitados, familiares o personal externo contratado. Se recomienda enfáticamente la contratación de un seguro de evento para cubrir contingencias no contempladas en el presente contrato.</p>
    <p><span class="tc-clause">10. Confidencialidad y protección de datos personales</span>La información personal suministrada por el cliente —nombre y apellido, datos de contacto, información del evento y medios de pago— será utilizada exclusivamente para la planificación, coordinación y ejecución del evento contratado. Joliet Eventos no cederá, comercializará ni compartirá dicha información con terceros, salvo requerimiento judicial o legal expreso. El cliente consiente el uso de imágenes del evento con fines de comunicación institucional de Joliet Eventos, pudiendo revocar dicho consentimiento en cualquier momento mediante notificación escrita.</p>
  </div>

  <div class="closing">
    <div class="cl-line"></div>
    <div class="cl-text">Sin otro particular, y expresando nuestro sincero agradecimiento por habernos elegido, quedamos a su entera disposición para coordinar cada detalle y hacer de esta noche un momento que todos van a recordar.</div>
    <div class="cl-sig">Mariana Labarta<small>Coordinadora de Eventos · Joliet</small></div>
  </div>

  <div class="pfoot">
    <span>Juana Azurduy 531 · Ciudad Tesei · 11 5424 0870 · labartam@gmail.com</span>
    <span>Joliet Eventos · ${anio}</span>
  </div>
</div>

</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { alert('Permití popups en el navegador para descargar la propuesta'); return; }
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 900);
}

// Listeners de propuesta (se registran una vez al cargar el DOM)
(function initPropuestaListeners() {
  $('btn-prop-comenzar')?.addEventListener('click', () => goToPropuestaSlide(2));

  $('btn-prop-next')?.addEventListener('click', () => {
    document.querySelector('.propuesta-slides-container')?.classList.remove('slides-going-back');
    if (propuestaState.current < propuestaState.total) goToPropuestaSlide(propuestaState.current + 1);
  });
  $('btn-prop-prev')?.addEventListener('click', () => {
    document.querySelector('.propuesta-slides-container')?.classList.add('slides-going-back');
    if (propuestaState.current > 1) goToPropuestaSlide(propuestaState.current - 1);
  });

  $('propuesta-close-btn')?.addEventListener('click', () => navigateTo('clientes'));

  // Fork: Formal / Americano
  document.querySelectorAll('#estilo-cards .estilo-fork-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#estilo-cards .estilo-fork-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      if (propuestaState.data.estilo !== card.dataset.estilo) {
        propuestaState.data.gastroAdicionales = [];
      }
      propuestaState.data.estilo = card.dataset.estilo;
    });
  });

  // Cards: tipo de evento
  document.querySelectorAll('#evento-cards .propuesta-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#evento-cards .propuesta-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      propuestaState.data.tipoEvento = card.dataset.value;
      const sinAgasajado = ['Corporativo', 'Otro'];
      const agRow = $('agasajado-row');
      if (agRow) agRow.style.display = sinAgasajado.includes(card.dataset.value) ? 'none' : '';
    });
  });

  // Cards: turno
  document.querySelectorAll('#turno-cards .propuesta-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#turno-cards .propuesta-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      propuestaState.data.turno = card.dataset.value;
    });
  });

  // Cards: espacio
  document.querySelectorAll('#espacio-cards .propuesta-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#espacio-cards .propuesta-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      propuestaState.data.espacio = card.dataset.value;
    });
  });

  // Counter invitados (step: 10)
  $('counter-minus')?.addEventListener('click', () => {
    const cur = parseInt($('prop-invitados')?.value || '100');
    const next = Math.max(10, cur - 10);
    $('prop-invitados').value = next;
    $('prop-invitados-display').textContent = next;
  });
  $('counter-plus')?.addEventListener('click', () => {
    const cur = parseInt($('prop-invitados')?.value || '100');
    const next = cur + 10;
    $('prop-invitados').value = next;
    $('prop-invitados-display').textContent = next;
  });

  // Menú infantil
  $('prop-menu-infantil')?.addEventListener('change', e => {
    propuestaState.data.menuInfantil = e.target.checked;
    const row = $('infantil-count-row'); if (row) row.style.display = e.target.checked ? '' : 'none';
  });

  $('btn-descargar-pdf')?.addEventListener('click', generatePropuestaPDF);

  // Pre-form: comenzar propuesta
  $('btn-preform-comenzar')?.addEventListener('click', startPropuestaSlides);

  // Pre-form: al elegir cliente existente, pre-llenar nombre y teléfono
  $('prop-cliente-existente')?.addEventListener('change', e => {
    if (!e.target.value) return;
    const cliente = (allClientes || []).find(c => c.rowIndex === parseInt(e.target.value));
    if (!cliente) return;
    const ni = $('prop-contacto-nombre'); if (ni) ni.value = cliente.apellidoNombre || '';
    const ti = $('prop-contacto-telefono'); if (ti) ti.value = cliente.telefono || '';
    const gi = $('prop-contacto-gmail'); if (gi) gi.value = cliente.gmail || '';
  });

  // Botón propuesta desde modal de cliente
  $('btn-propuesta-modal')?.addEventListener('click', () => {
    if (!currentClienteModal) return;
    startPropuestaFromCliente(currentClienteModal);
  });

  // Guardar cliente desde propuesta
  $('btn-guardar-cliente-propuesta')?.addEventListener('click', guardarClientePropuesta);

  buildPropuestaDots();
})();

/* ===================== EGRESOS ===================== */

const EGRESOS_CATEGORIAS = {
  'Servicios':     ['Luz', 'Gas', 'Agua', 'Wifi'],
  'Bebidas':       ['Bebida', 'Hielo', 'Alcohol'],
  'Personal':      ['Mozo', 'Maître', 'Barman', 'Cocinero', 'Ayudante de Cocina', 'Bachero', 'Portero'],
  'Evento':        ['DJ', 'Flores', 'Mantelería', 'Fuegos artificiales', 'Vajilla', 'Show', 'Decoración'],
  'Mantenimiento': ['Plomero', 'Electricista', 'Jardinero', 'Piletero', 'Pintor', 'Limpieza'],
  'Materia Prima': ['(detalle en notas)'],
};

const EGRESOS_NOTAS_OBLIGATORIAS = new Set(['Vajilla', 'Decoración', '(detalle en notas)']);

let allEgresos = [];
let allEmpleados = [];
let egresosCargados = false;

async function loadEmpleados() {
  try {
    allEmpleados = await apiFetch('/empleados');
    populateEmpleadoSelect();
  } catch (e) { console.error('Error cargando empleados:', e); }
}

function populateEmpleadoSelect() {
  const sel = $('egr-empleado');
  if (!sel) return;
  sel.innerHTML = '<option value="">Seleccioná...</option>' +
    allEmpleados.map(e => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('') +
    '<option value="__nuevo__">+ Agregar nuevo...</option>';
}

async function initEgresos() {
  const fechaInput = $('egr-fecha');
  if (fechaInput && !fechaInput.value) {
    fechaInput.value = new Date().toISOString().slice(0, 10);
  }
  document.querySelectorAll('#egr-categoria .superadmin-only').forEach(opt => {
    opt.style.display = isSuperAdmin() ? '' : 'none';
  });
  if (!egresosCargados) {
    await Promise.all([loadEgresos(), loadEmpleados()]);
    egresosCargados = true;
    setupEgresosForm();
  } else {
    renderEgresos();
    populateEmpleadoSelect();
  }
}

function setupEgresosForm() {
  const catSel = $('egr-categoria');
  const concSel = $('egr-concepto');
  const personalRow = $('egr-personal-row');
  const empSel = $('egr-empleado');
  const nuevoEmpInput = $('egr-nuevo-empleado');

  catSel?.addEventListener('change', () => {
    const cat = catSel.value;
    const opts = EGRESOS_CATEGORIAS[cat] || [];
    concSel.innerHTML = opts.length
      ? opts.map(o => `<option value="${o}">${o}</option>`).join('')
      : '<option value="">— elegí categoría primero —</option>';
    const esPersonal = cat === 'Personal';
    personalRow.style.display = esPersonal ? '' : 'none';
    empSel.required = esPersonal;
    $('egr-rol-pago').required = esPersonal;
    updateNotasLabel();
  });

  concSel?.addEventListener('change', updateNotasLabel);

  empSel?.addEventListener('change', () => {
    const esNuevo = empSel.value === '__nuevo__';
    nuevoEmpInput.style.display = esNuevo ? '' : 'none';
    nuevoEmpInput.required = esNuevo;
  });
  if (nuevoEmpInput) nuevoEmpInput.style.display = 'none';

  $('egreso-form')?.addEventListener('submit', submitEgreso);
}

function updateNotasLabel() {
  const concepto = $('egr-concepto')?.value;
  const notasGroup = $('egr-notas-group');
  const obligatorio = EGRESOS_NOTAS_OBLIGATORIAS.has(concepto);
  const lbl = notasGroup?.querySelector('label');
  if (lbl) lbl.textContent = obligatorio ? 'Notas *' : 'Notas';
  const notasEl = $('egr-notas');
  if (notasEl) notasEl.required = obligatorio;
}

async function submitEgreso(e) {
  e.preventDefault();
  hide('egr-error'); hide('egr-success');
  const empSel = $('egr-empleado');
  const nuevoNombre = $('egr-nuevo-empleado')?.value.trim();
  let idEmpleado = '', nombreEmpleado = '';

  if ($('egr-categoria').value === 'Personal') {
    if (empSel?.value === '__nuevo__' && nuevoNombre) {
      try {
        const emp = await apiFetch('/empleados', { method: 'POST', body: { nombre: nuevoNombre } });
        allEmpleados.push(emp);
        populateEmpleadoSelect();
        idEmpleado = emp.id;
        nombreEmpleado = nuevoNombre;
      } catch (err) {
        $('egr-error').textContent = 'Error al guardar empleado: ' + err.message;
        show('egr-error'); return;
      }
    } else {
      idEmpleado = empSel?.value || '';
      nombreEmpleado = allEmpleados.find(emp => emp.id === idEmpleado)?.nombre || '';
    }
  }

  const body = {
    fecha: $('egr-fecha').value,
    concepto: $('egr-concepto').value,
    categoria: $('egr-categoria').value,
    monto: parseFloat($('egr-monto').value) || 0,
    moneda: $('egr-moneda').value,
    idEmpleado, nombreEmpleado,
    rolPago: $('egr-rol-pago')?.value || '',
    notas: $('egr-notas').value.trim(),
  };

  try {
    const nuevo = await apiFetch('/egresos', { method: 'POST', body });
    allEgresos.unshift(nuevo);
    allEgresos.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    renderEgresos();
    show('egr-success');
    setTimeout(() => hide('egr-success'), 3000);
    $('egr-monto').value = '';
    $('egr-notas').value = '';
    if (nuevoNombre && $('egr-nuevo-empleado')) $('egr-nuevo-empleado').value = '';
    if ($('egr-nuevo-empleado')) $('egr-nuevo-empleado').style.display = 'none';
    if (empSel) empSel.value = '';
    if ($('egr-rol-pago')) $('egr-rol-pago').value = '';
  } catch (err) {
    $('egr-error').textContent = err.message;
    show('egr-error');
  }
}

async function loadEgresos() {
  show('egresos-loading');
  hide('egresos-table-wrap');
  hide('egresos-empty');
  hide('egresos-total-bar');
  try {
    allEgresos = await apiFetch('/egresos');
    allEgresos.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    renderEgresos();
  } catch (err) {
    const el = $('egresos-loading');
    if (el) el.textContent = 'Error: ' + err.message;
  }
}

function renderEgresos() {
  hide('egresos-loading');
  const filtCat = $('egr-filtro-cat')?.value || '';
  const filtMoneda = $('egr-filtro-moneda')?.value || '';
  const lista = allEgresos.filter(e => {
    if (filtCat && e.categoria !== filtCat) return false;
    if (filtMoneda && e.moneda !== filtMoneda) return false;
    return true;
  });

  if (!lista.length) {
    hide('egresos-table-wrap');
    show('egresos-empty');
    hide('egresos-total-bar');
    return;
  }

  show('egresos-table-wrap');
  hide('egresos-empty');

  $('egresos-tbody').innerHTML = lista.map(e => {
    const empInfo = e.nombreEmpleado
      ? `<span class="egr-emp-name">${esc(e.nombreEmpleado)}</span>${e.rolPago ? ` <span class="egr-rol-badge">${esc(e.rolPago)}</span>` : ''}`
      : '—';
    const editBtn = isSuperAdmin()
      ? `<button class="btn-egr-edit" data-row="${e.rowIndex}" title="Editar">✏️</button>`
      : '';
    return `<tr>
      <td>${formatDate(e.fecha)}</td>
      <td><span class="egr-cat-badge egr-cat-${(e.categoria||'').toLowerCase().replace(/\s+/g,'-').replace(/[^a-z-]/g,'')}">${esc(e.categoria)}</span></td>
      <td>${esc(e.concepto)}</td>
      <td>${empInfo}</td>
      <td class="num-cell">${formatMoneda(parseFloat(e.monto)||0, e.moneda)}</td>
      <td class="egr-notas-cell">${esc(e.notas)}</td>
      <td class="muted-cell">${esc(e.cargadoPor)}</td>
      <td>${editBtn}</td>
    </tr>`;
  }).join('');

  const totalARS = lista.filter(e => e.moneda !== 'USD').reduce((s, e) => s + (parseFloat(e.monto)||0), 0);
  const totalUSD = lista.filter(e => e.moneda === 'USD').reduce((s, e) => s + (parseFloat(e.monto)||0), 0);
  const totalBar = $('egresos-total-bar');
  let txt = `${lista.length} registros —`;
  if (totalARS > 0) txt += ` <strong>${formatMoney(totalARS)}</strong>`;
  if (totalUSD > 0) txt += `${totalARS > 0 ? ' +' : ''} <strong>U$S ${totalUSD.toLocaleString('es-AR', {minimumFractionDigits: 2})}</strong>`;
  totalBar.innerHTML = txt;
  show('egresos-total-bar');
}

document.addEventListener('change', e => {
  if (e.target.id === 'egr-filtro-cat' || e.target.id === 'egr-filtro-moneda') renderEgresos();
});

/* ===================== EGRESOS COCINA ===================== */

let egresosCocCargados = false;

function initEgresosCocina() {
  if (!isSuperAdmin()) return;
  const fechaEl = $('egc-fecha');
  if (fechaEl && !fechaEl.value) fechaEl.value = new Date().toISOString().split('T')[0];
  if (!egresosCocCargados) {
    egresosCocCargados = true;
    setupEgresosCocinaForm();
    loadEgresosCocina();
  } else {
    renderEgresosCocina();
  }
}

function setupEgresosCocinaForm() {
  $('egc-proveedor')?.addEventListener('change', () => {
    const isOtro = $('egc-proveedor')?.value === '__otro__';
    const row = $('egc-otro-prov-row');
    if (row) row.style.display = isOtro ? '' : 'none';
    if (!isOtro && $('egc-proveedor-otro')) $('egc-proveedor-otro').value = '';
  });

  $('egc-tipo')?.addEventListener('change', () => {
    const isOtros = $('egc-tipo')?.value === '__otros__';
    const otrosRow = $('egc-otros-tipo-row');
    const notasLabel = document.querySelector('label[for="egc-notas"]') || document.querySelector('#egc-notas')?.previousElementSibling;
    if (otrosRow) otrosRow.style.display = isOtros ? '' : 'none';
    if (!isOtros && $('egc-tipo-otros')) $('egc-tipo-otros').value = '';
  });

  $('egreso-cocina-form')?.addEventListener('submit', submitEgresosCocina);
}

async function submitEgresosCocina(e) {
  e.preventDefault();
  hide('egc-error'); hide('egc-success');

  const fecha = $('egc-fecha')?.value;
  const tipoVal = $('egc-tipo')?.value;
  const monto = parseFloat($('egc-monto')?.value || '0');

  const esOtros = tipoVal === '__otros__';
  const tipoOtrosDetalle = ($('egc-tipo-otros')?.value || '').trim();

  if (!fecha || !tipoVal || !monto) {
    show('egc-error');
    $('egc-error').textContent = 'Fecha, tipo y monto son obligatorios';
    return;
  }
  if (esOtros && !tipoOtrosDetalle) {
    show('egc-error');
    $('egc-error').textContent = 'Especificá qué tipo de gasto fue';
    return;
  }

  const concepto = esOtros ? 'Otros' : tipoVal;
  const notasExtra = esOtros ? tipoOtrosDetalle : ($('egc-notas')?.value || '');

  let proveedor = $('egc-proveedor')?.value || '';
  if (proveedor === '__otro__') {
    proveedor = ($('egc-proveedor-otro')?.value || '').trim();
  }

  const body = {
    fecha,
    concepto,
    categoria: 'Materia Prima',
    monto,
    moneda: $('egc-moneda')?.value || 'ARS',
    notas: notasExtra,
    proveedor,
  };

  try {
    const nuevo = await apiFetch('/egresos', { method: 'POST', body });
    allEgresos.unshift(nuevo);
    allEgresos.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    renderEgresosCocina();
    show('egc-success');
    setTimeout(() => hide('egc-success'), 3000);
    e.target.reset();
    $('egc-fecha').value = new Date().toISOString().split('T')[0];
    if ($('egc-otro-prov-row')) $('egc-otro-prov-row').style.display = 'none';
    if ($('egc-otros-tipo-row')) $('egc-otros-tipo-row').style.display = 'none';
  } catch (err) {
    show('egc-error');
    $('egc-error').textContent = err.message || 'Error al guardar';
  }
}

async function loadEgresosCocina() {
  show('egc-loading'); hide('egc-table-wrap'); hide('egc-empty'); hide('egc-total-bar');
  try {
    if (!allEgresos.length) {
      allEgresos = await apiFetch('/egresos');
      allEgresos.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    }
    renderEgresosCocina();
  } catch (err) {
    const el = $('egc-loading');
    if (el) el.textContent = 'Error al cargar';
  }
}

function renderEgresosCocina() {
  hide('egc-loading');
  const filtTipo = $('egc-filtro-tipo')?.value || '';
  const filtProv = $('egc-filtro-prov')?.value || '';
  const filtMoneda = $('egc-filtro-moneda')?.value || '';
  const lista = allEgresos.filter(e => {
    if (e.categoria !== 'Materia Prima') return false;
    if (filtTipo && e.concepto !== filtTipo) return false;
    if (filtProv && e.proveedor !== filtProv) return false;
    if (filtMoneda && e.moneda !== filtMoneda) return false;
    return true;
  });

  if (!lista.length) {
    hide('egc-table-wrap');
    show('egc-empty');
    hide('egc-total-bar');
    return;
  }

  show('egc-table-wrap');
  hide('egc-empty');

  $('egc-tbody').innerHTML = lista.map(e => {
    const slug = (e.concepto || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z-]/g, '');
    const provBadge = e.proveedor
      ? `<span class="egr-proveedor-badge">${esc(e.proveedor)}</span>`
      : '<span class="muted-cell">—</span>';
    return `<tr>
      <td>${formatDate(e.fecha)}</td>
      <td><span class="egr-cat-badge egr-cocina-${slug}">${esc(e.concepto)}</span></td>
      <td>${provBadge}</td>
      <td class="num-cell">${formatMoneda(parseFloat(e.monto) || 0, e.moneda)}</td>
      <td class="egr-notas-cell">${esc(e.notas)}</td>
      <td class="muted-cell">${esc(e.cargadoPor)}</td>
      <td><button class="btn-egr-edit" data-row="${e.rowIndex}" title="Editar">✏️</button></td>
    </tr>`;
  }).join('');

  const totalARS = lista.filter(e => e.moneda !== 'USD').reduce((s, e) => s + (parseFloat(e.monto) || 0), 0);
  const totalUSD = lista.filter(e => e.moneda === 'USD').reduce((s, e) => s + (parseFloat(e.monto) || 0), 0);
  const totalBar = $('egc-total-bar');
  let txt = `${lista.length} registros —`;
  if (totalARS > 0) txt += ` <strong>${formatMoney(totalARS)}</strong>`;
  if (totalUSD > 0) txt += `${totalARS > 0 ? ' +' : ''} <strong>U$S ${totalUSD.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong>`;
  totalBar.innerHTML = txt;
  show('egc-total-bar');
}

document.addEventListener('change', e => {
  if (['egc-filtro-tipo', 'egc-filtro-prov', 'egc-filtro-moneda'].includes(e.target.id)) renderEgresosCocina();
});

/* ===================== EDITAR EGRESO ===================== */

function openEditarEgreso(egreso) {
  $('ede-row-index').value = egreso.rowIndex;
  $('ede-fecha').value = egreso.fecha;
  $('ede-monto').value = egreso.monto;
  $('ede-moneda').value = egreso.moneda || 'ARS';
  $('ede-categoria').value = egreso.categoria;
  $('ede-concepto').value = egreso.concepto;
  $('ede-notas').value = egreso.notas || '';

  const esMateriaP = egreso.categoria === 'Materia Prima';
  const esPersonal = egreso.categoria === 'Personal';

  $('ede-proveedor-group').style.display = esMateriaP ? '' : 'none';
  if (esMateriaP) $('ede-proveedor').value = egreso.proveedor || '';

  $('ede-personal-group').style.display = esPersonal ? '' : 'none';
  if (esPersonal) {
    $('ede-empleado').value = egreso.nombreEmpleado || '';
    $('ede-rol').value = egreso.rolPago || '';
  }

  hide('ede-error');
  show('modal-editar-egreso');
}

async function submitEditarEgreso(ev) {
  ev.preventDefault();
  hide('ede-error');

  const rowIndex = parseInt($('ede-row-index').value);
  const original = allEgresos.find(x => x.rowIndex === rowIndex);
  if (!original) return;

  const updated = {
    ...original,
    fecha: $('ede-fecha').value,
    monto: parseFloat($('ede-monto').value) || 0,
    moneda: $('ede-moneda').value,
    concepto: $('ede-concepto').value.trim(),
    notas: $('ede-notas').value.trim(),
    proveedor: original.categoria === 'Materia Prima' ? ($('ede-proveedor').value.trim()) : (original.proveedor || ''),
    nombreEmpleado: original.categoria === 'Personal' ? ($('ede-empleado').value.trim()) : original.nombreEmpleado,
    rolPago: original.categoria === 'Personal' ? ($('ede-rol').value.trim()) : original.rolPago,
  };

  try {
    await apiFetch(`/egresos/${rowIndex}`, { method: 'PUT', body: updated });
    const idx = allEgresos.findIndex(x => x.rowIndex === rowIndex);
    if (idx !== -1) allEgresos[idx] = updated;
    allEgresos.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    renderEgresos();
    if (egresosCocCargados) renderEgresosCocina();
    hide('modal-editar-egreso');
  } catch (err) {
    show('ede-error');
    $('ede-error').textContent = err.message || 'Error al guardar';
  }
}

document.getElementById('editar-egreso-form')?.addEventListener('submit', submitEditarEgreso);
document.getElementById('close-editar-egreso-btn')?.addEventListener('click', () => hide('modal-editar-egreso'));
document.getElementById('cancel-editar-egreso-btn')?.addEventListener('click', () => hide('modal-editar-egreso'));

document.addEventListener('click', ev => {
  const btn = ev.target.closest('.btn-egr-edit');
  if (!btn) return;
  const rowIndex = parseInt(btn.dataset.row);
  const egreso = allEgresos.find(x => x.rowIndex === rowIndex);
  if (egreso) openEditarEgreso(egreso);
});

/* ===================== COCINA (superadmin) ===================== */

let cocinaCatalogo = [];
let cocinaPedidos = [];
let cocinaPedidoActual = null;
let cocinaStockActual = [];

const COCINA_CAT_COLORS = {
  'Recepción - Canapés':           '#FFF3E0',
  'Recepción - Bruschettas':       '#FFF8E1',
  'Recepción - Fríos':             '#E3F2FD',
  'Sanguche de Miga - Blancos':    '#FFFDE7',
  'Sanguche de Miga - Negros':     '#D7CCC8',
  'Sanguche de Miga - Totales':    '#EFEBE9',
  'Recepción - Brochettes':        '#FCE4EC',
  'Recepción - Empanaditas':       '#E8F5E9',
  'Recepción - Calientes':         '#FBE9E7',
  'Islas':                         '#EDE7F6',
  'Primer Plato - Pastas':         '#E0F7FA',
  'Primer Plato - Salsas':         '#E0F2F1',
  'Plato Central - Ave':           '#FFF9C4',
  'Plato Central - Carne':         '#FFEBEE',
  'Plato Central - Salsas':        '#FFF3E0',
  'Guarnición plato central':      '#F3E5F5',
  'Mesa de Dulces':                '#FCE4EC',
  'Cafetería / Fin de Fiesta':     '#E8EAF6',
  // Ingredientes (solo stock)
  'Bruschetta - Toppings':         '#FFF8E1',
  'Fiambres':                      '#FAFAFA',
  'Condimentos':                   '#F9FBE7',
  'Básicos':                       '#F3F3F3',
  'Verduras':                      '#E8F5E9',
  'Aceites y Sales':               '#FFF3E0',
};

// Categorías que NO aparecen en el stock dashboard (no persisten semana a semana)
const CATS_NO_STOCK_DISPLAY = new Set([
  'Recepción - Canapés', 'Recepción - Bruschettas', 'Recepción - Fríos',
  'Sanguche de Miga - Blancos', 'Sanguche de Miga - Negros', 'Sanguche de Miga - Totales',
  'Mesa de Dulces', 'Cafetería / Fin de Fiesta',
]);

// Orden de categorías en stock dashboard (las que van)
const STOCK_CAT_ORDER = [
  'Recepción - Brochettes', 'Recepción - Empanaditas', 'Recepción - Calientes',
  'Islas',
  'Primer Plato - Pastas', 'Primer Plato - Salsas',
  'Plato Central - Ave', 'Plato Central - Carne', 'Plato Central - Salsas', 'Guarnición plato central',
  'Bruschetta - Toppings', 'Fiambres', 'Condimentos', 'Básicos', 'Verduras', 'Aceites y Sales',
];

// Orden de categorías en formulario de pedido
const PEDIDO_CAT_ORDER = [
  'Recepción - Canapés', 'Recepción - Bruschettas', 'Recepción - Fríos',
  'Sanguche de Miga - Totales', 'Sanguche de Miga - Blancos', 'Sanguche de Miga - Negros',
  'Recepción - Brochettes', 'Recepción - Empanaditas', 'Recepción - Calientes',
  'Islas',
  'Primer Plato - Pastas', 'Primer Plato - Salsas',
  'Plato Central - Ave', 'Plato Central - Carne', 'Plato Central - Salsas', 'Guarnición plato central',
  'Mesa de Dulces', 'Cafetería / Fin de Fiesta',
];

function catDisplayName(cat) {
  return cat
    .replace(/^Recepción - /, '')
    .replace(/^Primer Plato - /, '')
    .replace(/^Plato Central - /, '');
}

function cocCatColor(cat) { return COCINA_CAT_COLORS[cat] || '#F5F5F5'; }

async function loadCocina() {
  if (!isSuperAdmin()) return;
  const loadingEl = $('cocina-loading');
  if (loadingEl) loadingEl.style.display = '';
  $('cocina-form-wrap')?.classList.add('hidden');
  $('cocina-relevamiento-wrap')?.classList.add('hidden');
  $('cocina-actualizar-stock-form')?.classList.add('hidden');
  try {
    [cocinaCatalogo, cocinaPedidos, cocinaStockActual] = await Promise.all([
      apiFetch('/catalogo-items'),
      apiFetch('/pedidos-cocina'),
      apiFetch('/stock-actual'),
    ]);
    if (loadingEl) loadingEl.style.display = 'none';
    renderStockDashboard();
    renderPedidosList();
  } catch (e) {
    if (loadingEl) loadingEl.style.display = 'none';
    alert('Error cargando datos de cocina: ' + e.message);
  }
}

function switchCocinaTab(tabName) {
  document.querySelectorAll('.cocina-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
  document.querySelectorAll('.cocina-tab-pane').forEach(p => p.classList.add('hidden'));
  $(`cocina-tab-${tabName}`)?.classList.remove('hidden');
  if (tabName === 'catalogo') renderCatalogoPanel();
  if (tabName === 'stock') renderStockDashboard();
  if (tabName === 'compras') initEgresosCocina();
}

function renderStockDashboard() {
  const el = $('cocina-stock-dashboard');
  if (!el) return;
  const items = cocinaStockActual.filter(i => !CATS_NO_STOCK_DISPLAY.has(i.categoria));
  if (!items.length) {
    el.innerHTML = '<p class="empty-msg" style="padding:20px 0">Sin datos de stock.</p>';
    return;
  }
  const byCategory = {}, seenCats = new Set();
  items.forEach(item => {
    if (!byCategory[item.categoria]) byCategory[item.categoria] = [];
    byCategory[item.categoria].push(item);
    seenCats.add(item.categoria);
  });
  let catOrder;
  try {
    const saved = JSON.parse(localStorage.getItem('cocina-stock-cat-order') || 'null');
    if (saved && Array.isArray(saved)) {
      catOrder = [...saved.filter(c => seenCats.has(c)), ...[...seenCats].filter(c => !saved.includes(c))];
    }
  } catch {}
  if (!catOrder) {
    catOrder = [...STOCK_CAT_ORDER.filter(c => seenCats.has(c)), ...[...seenCats].filter(c => !STOCK_CAT_ORDER.includes(c))];
  }
  let html = '<div class="stock-dash-grid" id="stock-dash-grid">';
  catOrder.forEach(cat => {
    const color = cocCatColor(cat);
    html += `<div class="stock-dash-section" draggable="true" data-cat="${esc(cat)}">
      <div class="stock-dash-cat-header" style="background:${color}">${esc(catDisplayName(cat))}</div>`;
    byCategory[cat].forEach(item => {
      const level = item.cantidad === 0 ? 'sin-stock' : item.cantidad < 5 ? 'bajo' : 'ok';
      html += `<div class="stock-dash-item-row">
        <span class="stock-dash-nombre">${esc(item.nombre)}</span>
        <span class="stock-dash-cant stock-${level}">${item.cantidad}</span>
        <span class="stock-dash-unidad">${esc(item.unidad||'und')}</span>
      </div>`;
    });
    html += '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
  initStockDashDnD();
}

function initStockDashDnD() {
  const grid = document.getElementById('stock-dash-grid');
  if (!grid) return;
  let dragEl = null;
  grid.addEventListener('dragstart', e => {
    dragEl = e.target.closest('.stock-dash-section');
    if (!dragEl) return;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => dragEl && dragEl.classList.add('stock-dragging'), 0);
  });
  grid.addEventListener('dragend', () => {
    if (dragEl) dragEl.classList.remove('stock-dragging');
    grid.querySelectorAll('.stock-drag-over').forEach(el => el.classList.remove('stock-drag-over'));
    const order = [...grid.querySelectorAll('.stock-dash-section')].map(el => el.dataset.cat);
    try { localStorage.setItem('cocina-stock-cat-order', JSON.stringify(order)); } catch {}
    dragEl = null;
  });
  grid.addEventListener('dragover', e => {
    e.preventDefault();
    if (!dragEl) return;
    const target = e.target.closest('.stock-dash-section');
    if (!target || target === dragEl) return;
    grid.querySelectorAll('.stock-drag-over').forEach(el => el.classList.remove('stock-drag-over'));
    target.classList.add('stock-drag-over');
    const sections = [...grid.querySelectorAll('.stock-dash-section')];
    if (sections.indexOf(dragEl) < sections.indexOf(target)) grid.insertBefore(dragEl, target.nextSibling);
    else grid.insertBefore(dragEl, target);
  });
  grid.addEventListener('drop', e => e.preventDefault());
}

function openActualizarStockForm() {
  const form = $('cocina-actualizar-stock-form');
  const tbody = $('cocina-actualizar-stock-tbody');
  if (!form || !tbody) return;
  const byCategory = {}, catOrder = [];
  cocinaStockActual.forEach(item => {
    if (!byCategory[item.categoria]) { byCategory[item.categoria] = []; catOrder.push(item.categoria); }
    byCategory[item.categoria].push(item);
  });
  let html = '';
  catOrder.forEach(cat => {
    const color = cocCatColor(cat);
    html += `<tr class="cocina-cat-header-row"><td colspan="3" class="cocina-cat-header-cell" style="background:${color}">${esc(catDisplayName(cat))}</td></tr>`;
    byCategory[cat].forEach(item => {
      const step = item.unidad === 'lt' || item.unidad === 'kg' ? '0.5' : '1';
      html += `<tr style="background:${color}22">
        <td style="padding-left:16px;font-size:13px">${esc(item.nombre)}</td>
        <td>${_cantWrap(item.cantidad || 0, step, 'cocina-stock-update-input', `data-item-id="${esc(item.id)}"`)}</td>
        <td class="cocina-unidad-cell">${esc(item.unidad||'und')}</td>
      </tr>`;
    });
  });
  tbody.innerHTML = html;
  _wirePMButtons(tbody);
  form.classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth' });
}

async function guardarActualizacionStock() {
  const inputs = [...document.querySelectorAll('.cocina-stock-update-input')];
  const actualizaciones = inputs.map(i => ({ id: i.dataset.itemId, cantidad: parseFloat(i.value) || 0 }));
  try {
    $('cocina-actualizar-stock-guardar-btn').disabled = true;
    await apiFetch('/stock-actual/actualizar', { method: 'POST', body: { actualizaciones } });
    actualizaciones.forEach(act => {
      const idx = cocinaStockActual.findIndex(s => s.id === act.id);
      if (idx !== -1) cocinaStockActual[idx].cantidad = act.cantidad;
    });
    $('cocina-actualizar-stock-form').classList.add('hidden');
    renderStockDashboard();
  } catch (e) {
    alert('Error al guardar stock: ' + e.message);
  } finally {
    $('cocina-actualizar-stock-guardar-btn').disabled = false;
  }
}

function descontarStockDelPedido() {
  const tbody = $('cocina-items-tbody');
  if (!tbody) return;
  let count = 0;
  tbody.querySelectorAll('tr[data-idx]').forEach(tr => {
    const id = tr.dataset.id;
    if (!id) return;
    const stockItem = cocinaStockActual.find(s => s.id === id);
    if (!stockItem || stockItem.cantidad <= 0) return;
    const input = tr.querySelector('.cocina-cant-input');
    if (!input) return;
    const pedido = parseFloat(input.value) || 0;
    const nuevo = Math.max(0, pedido - stockItem.cantidad);
    if (nuevo !== pedido) { input.value = nuevo; count++; }
  });
  const btn = $('cocina-descontar-stock-btn');
  if (btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = count > 0 ? `✓ ${count} descontados` : '📦 Sin stock disponible';
    setTimeout(() => { btn.innerHTML = orig; }, 2000);
  }
}

function renderPedidosList() {
  const listEl = $('cocina-lista');
  const emptyEl = $('cocina-empty');
  if (!listEl) return;
  const sorted = [...cocinaPedidos].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  if (!sorted.length) {
    emptyEl?.classList.remove('hidden');
    listEl.innerHTML = '';
    return;
  }
  emptyEl?.classList.add('hidden');
  listEl.innerHTML = sorted.map(p => {
    const badgeClass = p.estado === 'relevado' ? 'badge-relevado' : 'badge-preparacion';
    const badgeText = p.estado === 'relevado' ? 'Relevado' : 'En preparación';
    const cantItems = (p.items || []).filter(i => i.cantidad > 0).length;
    return `
      <div class="cocina-pedido-card">
        <div class="cocina-pedido-info">
          <span class="badge ${badgeClass}">${badgeText}</span>
          <strong>${esc(p.nombreEvento || '—')}</strong>
          <span class="cocina-pedido-meta">📅 ${p.fecha ? formatDate(p.fecha) : '—'} · ${cantItems} ítems</span>
        </div>
        <div class="cocina-pedido-acciones">
          <button class="btn btn-sm btn-secondary cocina-btn-editar" data-row="${p.rowIndex}">✏️ Editar</button>
          <button class="btn btn-sm btn-secondary cocina-btn-print-pedido" data-row="${p.rowIndex}">🖨️ Pedido</button>
          ${p.estado !== 'relevado'
            ? `<button class="btn btn-sm btn-secondary cocina-btn-sobrante" data-row="${p.rowIndex}">📦 Cargar stock</button>`
            : `<button class="btn btn-sm btn-secondary cocina-btn-print-rel" data-row="${p.rowIndex}">🖨️ Stock</button>`
          }
          <button class="btn btn-sm btn-danger cocina-btn-eliminar" data-row="${p.rowIndex}">🗑</button>
        </div>
      </div>`;
  }).join('');

  listEl.querySelectorAll('.cocina-btn-editar').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = cocinaPedidos.find(x => x.rowIndex === parseInt(btn.dataset.row));
      if (p) openFormularioPedido(p);
    });
  });
  listEl.querySelectorAll('.cocina-btn-print-pedido').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = cocinaPedidos.find(x => x.rowIndex === parseInt(btn.dataset.row));
      if (p) imprimirPedidoCocina(p);
    }, { once: false });
  });
  listEl.querySelectorAll('.cocina-btn-sobrante').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = cocinaPedidos.find(x => x.rowIndex === parseInt(btn.dataset.row));
      if (p) openFormularioRelevamiento(p);
    });
  });
  listEl.querySelectorAll('.cocina-btn-print-rel').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = cocinaPedidos.find(x => x.rowIndex === parseInt(btn.dataset.row));
      if (p) imprimirRelevamientoCocina(p);
    });
  });
  listEl.querySelectorAll('.cocina-btn-eliminar').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este pedido?')) return;
      try {
        await apiFetch(`/pedidos-cocina/${btn.dataset.row}`, { method: 'DELETE' });
        cocinaPedidos = cocinaPedidos.filter(x => x.rowIndex !== parseInt(btn.dataset.row));
        renderPedidosList();
      } catch (e) { alert('Error al eliminar: ' + e.message); }
    });
  });
}

function openFormularioPedido(pedido = null) {
  switchCocinaTab('pedido');
  cocinaPedidoActual = pedido;
  $('cocina-relevamiento-wrap')?.classList.add('hidden');
  $('cocina-agregar-panel')?.classList.add('hidden');
  $('cocina-form-wrap')?.classList.remove('hidden');
  $('cocina-form-titulo').textContent = pedido ? 'Editar pedido' : 'Nuevo pedido';

  const sel = $('cocina-evento-select');
  if (sel) {
    const confirmados = allClientes.filter(c => c.estado === 'Confirmado');
    sel.innerHTML = '<option value="">— Sin vincular —</option>' +
      confirmados.map(c =>
        `<option value="${esc(c.id)}" data-nombre="${esc(c.apellidoNombre)}" data-fecha="${esc(c.fechaEvento || '')}">${esc(c.apellidoNombre)} – ${formatDate(c.fechaEvento)}</option>`
      ).join('');
    sel.value = pedido?.idCliente || '';
    sel.onchange = () => {
      const opt = sel.selectedOptions[0];
      if (opt?.dataset.nombre) {
        $('cocina-nombre-evento').value = opt.dataset.nombre;
        $('cocina-fecha').value = opt.dataset.fecha || '';
      }
    };
  }

  $('cocina-nombre-evento').value = pedido?.nombreEvento || '';
  $('cocina-fecha').value = pedido?.fecha || '';
  renderItemsTableEditable(pedido?.items || null);
  $('cocina-form-wrap').scrollIntoView({ behavior: 'smooth' });
}

function _wirePMButtons(container) {
  container.querySelectorAll('.cocina-minus-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.nextElementSibling;
      input.value = Math.max(0, (parseFloat(input.value) || 0) - (parseFloat(input.step) || 1));
    });
  });
  container.querySelectorAll('.cocina-plus-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.previousElementSibling;
      input.value = (parseFloat(input.value) || 0) + (parseFloat(input.step) || 1);
    });
  });
}

function _cantWrap(value, step, cls, dataAttr) {
  return `<div class="cocina-cant-wrap"><button type="button" class="cocina-pm-btn cocina-minus-btn" tabindex="-1">−</button><input type="number" class="${cls}" value="${value}" min="0" step="${step}" placeholder="0" ${dataAttr}><button type="button" class="cocina-pm-btn cocina-plus-btn" tabindex="-1">+</button></div>`;
}

function renderItemsTableEditable(existingItems) {
  const tbody = $('cocina-items-tbody');
  if (!tbody) return;

  const baseItems = existingItems?.length
    ? existingItems.map(i => ({
        ...i,
        unidad: i.unidad || cocinaCatalogo.find(c => c.id === i.id)?.unidad || 'und',
      }))
    : cocinaCatalogo.map(c => ({ id: c.id, categoria: c.categoria, nombre: c.nombre, cantidad: '', observaciones: '', unidad: c.unidad || 'und' }));

  // Inject totales placeholders for Sanguche de Miga if there are miga items
  const hasMiga = baseItems.some(i => i.categoria === 'Sanguche de Miga - Blancos' || i.categoria === 'Sanguche de Miga - Negros');
  const existingTotales = baseItems.filter(i => i.categoria === 'Sanguche de Miga - Totales');
  const itemsWithTotales = hasMiga && !existingTotales.length
    ? [
        { id: '', categoria: 'Sanguche de Miga - Totales', nombre: 'Blancos', cantidad: '', observaciones: '', unidad: 'und' },
        { id: '', categoria: 'Sanguche de Miga - Totales', nombre: 'Negros', cantidad: '', observaciones: '', unidad: 'und' },
        ...baseItems,
      ]
    : baseItems;

  const byCategory = {};
  itemsWithTotales.forEach(item => {
    if (!byCategory[item.categoria]) byCategory[item.categoria] = [];
    byCategory[item.categoria].push(item);
  });
  const seenCats = new Set(Object.keys(byCategory));
  const catOrder = [
    ...PEDIDO_CAT_ORDER.filter(c => seenCats.has(c)),
    ...[...seenCats].filter(c => !PEDIDO_CAT_ORDER.includes(c)),
  ];

  let html = '', globalIdx = 0;
  let migaSuperHeaderRendered = false;

  catOrder.forEach(cat => {
    const color = cocCatColor(cat);
    const isMiga = cat === 'Sanguche de Miga - Blancos' || cat === 'Sanguche de Miga - Negros' || cat === 'Sanguche de Miga - Totales';

    if (isMiga && !migaSuperHeaderRendered) {
      migaSuperHeaderRendered = true;
      html += `<tr class="cocina-cat-header-row"><td colspan="6" class="cocina-cat-header-cell" style="background:#EFEBE9">🥪 Sanguche de Miga</td></tr>`;
    }

    if (cat === 'Sanguche de Miga - Totales') {
      const totalesItems = byCategory[cat] || [];
      const tB = totalesItems.find(t => t.nombre === 'Blancos');
      const tN = totalesItems.find(t => t.nombre === 'Negros');
      html += `<tr class="cocina-miga-totales-header-row"><td colspan="6" style="padding:4px 12px;font-size:0.82rem;color:#795548;font-weight:600;background:#EFEBE9">TOTALES</td></tr>`;
      if (tB) {
        html += `<tr data-idx="${globalIdx++}" data-id="" data-cat="Sanguche de Miga - Totales" data-nombre="Blancos" data-unidad="und" style="background:#FFFDE722">
          <td style="padding-left:20px" class="cocina-item-nombre-cell">Blancos (total)</td>
          <td>${_cantWrap(tB.cantidad||'', '1', 'cocina-cant-input', 'data-field="cantidad"')}</td>
          <td class="cocina-unidad-cell">und</td>
          <td class="cocina-stock-col"></td>
          <td><input class="cocina-obs-input" value="" placeholder="" data-field="observaciones"></td>
          <td></td></tr>`;
      }
      if (tN) {
        html += `<tr data-idx="${globalIdx++}" data-id="" data-cat="Sanguche de Miga - Totales" data-nombre="Negros" data-unidad="und" style="background:#D7CCC822">
          <td style="padding-left:20px" class="cocina-item-nombre-cell">Negros (total)</td>
          <td>${_cantWrap(tN.cantidad||'', '1', 'cocina-cant-input', 'data-field="cantidad"')}</td>
          <td class="cocina-unidad-cell">und</td>
          <td class="cocina-stock-col"></td>
          <td><input class="cocina-obs-input" value="" placeholder="" data-field="observaciones"></td>
          <td></td></tr>`;
      }
      html += `<tr class="cocina-miga-totales-header-row"><td colspan="6" style="padding:4px 12px;font-size:0.82rem;color:#795548;font-weight:600;background:#EFEBE9">DESGLOSE</td></tr>`;
      return;
    }

    const catLabel = isMiga ? (cat === 'Sanguche de Miga - Blancos' ? 'Blancos' : 'Negros') : catDisplayName(cat);
    html += `<tr class="cocina-cat-header-row" data-cat="${esc(cat)}"><td colspan="6" class="cocina-cat-header-cell" style="background:${color}">${esc(catLabel)}</td></tr>`;
    byCategory[cat].forEach(item => {
      const step = item.unidad === 'lt' || item.unidad === 'kg' ? '0.5' : '1';
      const stockCant = cocinaStockActual.find(s => s.id === item.id)?.cantidad;
      const stockDisplay = (stockCant != null && stockCant > 0) ? `${stockCant} ${esc(item.unidad||'und')}` : '—';
      html += `<tr data-idx="${globalIdx++}" data-id="${esc(item.id||'')}" data-cat="${esc(item.categoria)}" data-nombre="${esc(item.nombre)}" data-unidad="${esc(item.unidad||'und')}" style="background:${color}22">
        <td style="padding-left:16px" class="cocina-item-nombre-cell">${esc(item.nombre)}</td>
        <td>${_cantWrap(item.cantidad||'', step, 'cocina-cant-input', 'data-field="cantidad"')}</td>
        <td class="cocina-unidad-cell">${esc(item.unidad||'und')}</td>
        <td class="cocina-stock-col cocina-stock-val">${stockDisplay}</td>
        <td><input class="cocina-obs-input" value="${esc(item.observaciones||'')}" placeholder="Obs." data-field="observaciones"></td>
        <td><button type="button" class="btn-icon cocina-remove-row" title="Quitar">✕</button></td>
      </tr>`;
    });
  });
  tbody.innerHTML = html;
  _wirePMButtons(tbody);
  tbody.querySelectorAll('.cocina-remove-row').forEach(btn => btn.addEventListener('click', () => btn.closest('tr').remove()));
  tbody.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('cocina-cant-input')) {
      e.preventDefault();
      const all = [...tbody.querySelectorAll('.cocina-cant-input')];
      const next = all[all.indexOf(e.target) + 1];
      if (next) next.focus();
    }
  });
}

function getItemsFromTable() {
  return [...document.querySelectorAll('#cocina-items-tbody tr[data-idx]')].map(tr => ({
    id: tr.dataset.id || '',
    categoria: tr.dataset.cat || '',
    nombre: tr.dataset.nombre || '',
    cantidad: parseFloat(tr.querySelector('.cocina-cant-input')?.value) || 0,
    unidad: tr.dataset.unidad || 'und',
    observaciones: tr.querySelector('.cocina-obs-input')?.value.trim() || '',
    stock: null,
  })).filter(i => i.nombre);
}

async function guardarPedido() {
  const nombreEvento = $('cocina-nombre-evento').value.trim();
  if (!nombreEvento) { alert('Ingresá una descripción para el pedido.'); return; }
  const payload = {
    idCliente: $('cocina-evento-select').value,
    nombreEvento,
    fecha: $('cocina-fecha').value,
    items: getItemsFromTable(),
  };
  try {
    $('cocina-guardar-btn').disabled = true;
    let saved;
    if (cocinaPedidoActual?.rowIndex) {
      saved = await apiFetch(`/pedidos-cocina/${cocinaPedidoActual.rowIndex}`, {
        method: 'PUT',
        body: { ...cocinaPedidoActual, ...payload, estado: cocinaPedidoActual.estado },
      });
      const idx = cocinaPedidos.findIndex(p => p.rowIndex === cocinaPedidoActual.rowIndex);
      if (idx !== -1) cocinaPedidos[idx] = { ...cocinaPedidoActual, ...payload, ...saved };
    } else {
      saved = await apiFetch('/pedidos-cocina', { method: 'POST', body: payload });
      cocinaPedidos.unshift(saved);
    }
    cocinaPedidoActual = null;
    $('cocina-form-wrap')?.classList.add('hidden');
    $('cocina-agregar-panel')?.classList.add('hidden');
    renderPedidosList();
  } catch (e) {
    alert('Error al guardar: ' + e.message);
  } finally {
    $('cocina-guardar-btn').disabled = false;
  }
}

function toggleAgregarPanel() {
  const panel = $('cocina-agregar-panel');
  if (!panel) return;
  if (panel.classList.contains('hidden')) {
    renderAgregarPanel();
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    panel.classList.add('hidden');
  }
}

function renderAgregarPanel() {
  const panel = $('cocina-agregar-panel');
  if (!panel) return;

  const currentIds = new Set(getItemsFromTable().map(i => i.id).filter(Boolean));
  const currentNombres = new Set(getItemsFromTable().map(i => i.nombre.toLowerCase()));
  const available = cocinaCatalogo.filter(c => !currentIds.has(c.id) && !currentNombres.has(c.nombre.toLowerCase()));

  const byCategory = {}, catOrder = [];
  available.forEach(item => {
    if (!byCategory[item.categoria]) { byCategory[item.categoria] = []; catOrder.push(item.categoria); }
    byCategory[item.categoria].push(item);
  });

  const allCats = [...new Set(cocinaCatalogo.map(c => c.categoria))];
  const catOpts = allCats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('') + '<option value="__nueva__">+ Nueva categoría...</option>';

  let itemsHtml = '';
  if (!available.length) {
    itemsHtml = '<p style="color:#888;font-size:13px;padding:8px 0">Todos los ítems del catálogo ya están en el pedido.</p>';
  } else {
    catOrder.forEach(cat => {
      const color = cocCatColor(cat);
      itemsHtml += `<div class="agregar-cat-label" style="background:${color}">${esc(cat)}</div>`;
      byCategory[cat].forEach(item => {
        itemsHtml += `<button type="button" class="agregar-item-btn" data-id="${esc(item.id)}" data-cat="${esc(item.categoria)}" data-nombre="${esc(item.nombre)}" data-unidad="${esc(item.unidad||'und')}">＋ ${esc(item.nombre)} <span class="agregar-item-unidad">${item.unidad||'und'}</span></button>`;
      });
    });
  }

  panel.innerHTML = `
    <div class="agregar-panel-titulo">Ítems disponibles del catálogo</div>
    <div class="agregar-items-list">${itemsHtml}</div>
    <div class="agregar-nuevo-wrap">
      <div class="agregar-nuevo-titulo">Crear ítem nuevo:</div>
      <div class="agregar-nuevo-fields">
        <input type="text" id="agregar-nuevo-nombre" placeholder="Nombre del ítem">
        <select id="agregar-nuevo-cat">${catOpts}</select>
        <select id="agregar-nuevo-unidad"><option value="und">und</option><option value="lt">lt</option><option value="kg">kg</option><option value="gr">gr</option></select>
      </div>
      <div class="agregar-nuevo-actions">
        <label class="agregar-guardar-label"><input type="checkbox" id="agregar-nuevo-guardar" checked> Guardar en catálogo</label>
        <button type="button" id="agregar-nuevo-confirmar-btn" class="btn btn-primary btn-sm">Agregar al pedido</button>
      </div>
    </div>`;

  panel.querySelectorAll('.agregar-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _agregarItemEnTabla(btn.dataset.id, btn.dataset.cat, btn.dataset.nombre, btn.dataset.unidad);
      btn.remove();
    });
  });

  $('agregar-nuevo-cat')?.addEventListener('change', () => {
    if ($('agregar-nuevo-cat').value === '__nueva__') {
      const nv = prompt('Nombre de la nueva categoría:');
      if (nv?.trim()) {
        const opt = document.createElement('option');
        opt.value = nv.trim(); opt.textContent = nv.trim(); opt.selected = true;
        $('agregar-nuevo-cat').insertBefore(opt, $('agregar-nuevo-cat').lastElementChild);
      } else {
        $('agregar-nuevo-cat').value = allCats[0] || '';
      }
    }
  });

  $('agregar-nuevo-confirmar-btn')?.addEventListener('click', async () => {
    const nombre = $('agregar-nuevo-nombre')?.value.trim();
    const categoria = $('agregar-nuevo-cat')?.value;
    const unidad = $('agregar-nuevo-unidad')?.value || 'und';
    const guardar = $('agregar-nuevo-guardar')?.checked;
    if (!nombre || !categoria || categoria === '__nueva__') { alert('Completá nombre y categoría.'); return; }
    let id = `temp-${Date.now()}`;
    if (guardar) {
      try {
        const nuevo = await apiFetch('/catalogo-items', { method: 'POST', body: { categoria, nombre, unidad } });
        id = nuevo.id;
        cocinaCatalogo.push(nuevo);
      } catch (e) { alert('Error al guardar en catálogo: ' + e.message); return; }
    }
    _agregarItemEnTabla(id, categoria, nombre, unidad);
    $('agregar-nuevo-nombre').value = '';
    panel.classList.add('hidden');
  });
}

function _agregarItemEnTabla(id, categoria, nombre, unidad) {
  const tbody = $('cocina-items-tbody');
  if (!tbody) return;
  const color = cocCatColor(categoria);
  const step = unidad === 'lt' || unidad === 'kg' ? '0.5' : '1';
  const idx = tbody.querySelectorAll('tr[data-idx]').length;
  const newTr = document.createElement('tr');
  newTr.setAttribute('data-idx', idx);
  newTr.setAttribute('data-id', id);
  newTr.setAttribute('data-cat', categoria);
  newTr.setAttribute('data-nombre', nombre);
  newTr.setAttribute('data-unidad', unidad);
  newTr.style.background = `${color}22`;
  const stockCantNew = cocinaStockActual.find(s => s.id === id)?.cantidad;
  const stockDisplayNew = (stockCantNew != null && stockCantNew > 0) ? `${stockCantNew} ${esc(unidad||'und')}` : '—';
  newTr.innerHTML = `
    <td style="padding-left:16px" class="cocina-item-nombre-cell">${esc(nombre)}</td>
    <td>${_cantWrap('', step, 'cocina-cant-input', 'data-field="cantidad"')}</td>
    <td class="cocina-unidad-cell">${esc(unidad)}</td>
    <td class="cocina-stock-col cocina-stock-val">${stockDisplayNew}</td>
    <td><input class="cocina-obs-input" value="" placeholder="Obs." data-field="observaciones"></td>
    <td><button type="button" class="btn-icon cocina-remove-row" title="Quitar">✕</button></td>`;
  _wirePMButtons(newTr);
  newTr.querySelector('.cocina-remove-row').addEventListener('click', () => newTr.remove());

  // Insert after existing category or at end
  const existingHeader = [...tbody.querySelectorAll('.cocina-cat-header-row')].find(r => r.dataset.cat === categoria);
  if (existingHeader) {
    let lastInCat = existingHeader;
    let next = existingHeader.nextElementSibling;
    while (next && !next.classList.contains('cocina-cat-header-row')) { lastInCat = next; next = next.nextElementSibling; }
    lastInCat.insertAdjacentElement('afterend', newTr);
  } else {
    const newHeader = document.createElement('tr');
    newHeader.classList.add('cocina-cat-header-row');
    newHeader.setAttribute('data-cat', categoria);
    newHeader.innerHTML = `<td colspan="6" class="cocina-cat-header-cell" style="background:${color}">${esc(categoria)}</td>`;
    tbody.appendChild(newHeader);
    tbody.appendChild(newTr);
  }
  newTr.querySelector('.cocina-cant-input').focus();
  newTr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function toggleStockActualPanel() {
  const panel = $('cocina-stock-actual-panel');
  if (!panel) return;
  if (panel.classList.contains('hidden')) {
    renderStockActualPanel();
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
}

function renderStockActualPanel() {
  const panel = $('cocina-stock-actual-panel');
  if (!panel) return;
  const byCategory = {}, catOrder = [];
  cocinaCatalogo.forEach(item => {
    if (!byCategory[item.categoria]) { byCategory[item.categoria] = []; catOrder.push(item.categoria); }
    byCategory[item.categoria].push(item);
  });
  let html = '<div class="stock-panel-titulo">📦 Stock actual del salón</div><table class="stock-panel-table">';
  catOrder.forEach(cat => {
    const color = cocCatColor(cat);
    html += `<tr><td colspan="3" class="cocina-cat-header-cell" style="background:${color};font-size:11px;padding:3px 8px">${esc(cat)}</td></tr>`;
    byCategory[cat].forEach(item => {
      const stockItem = cocinaStockActual.find(s => s.id === item.id);
      const cant = stockItem?.cantidad ?? 0;
      const level = cant === 0 ? 'sin-stock' : cant < 5 ? 'stock-bajo' : 'stock-ok';
      html += `<tr>
        <td style="padding-left:12px;font-size:12px">${esc(item.nombre)}</td>
        <td style="text-align:right;font-weight:600;font-size:12px" class="stock-${level}">${cant}</td>
        <td style="font-size:11px;color:#888;width:35px">${esc(item.unidad||'und')}</td>
      </tr>`;
    });
  });
  html += '</table>';
  panel.innerHTML = html;
}

function openFormularioRelevamiento(pedido) {
  switchCocinaTab('pedido');
  cocinaPedidoActual = pedido;
  $('cocina-form-wrap')?.classList.add('hidden');
  $('cocina-agregar-panel')?.classList.add('hidden');
  $('cocina-relevamiento-wrap')?.classList.remove('hidden');
  $('cocina-relevamiento-titulo').textContent = `Control de stock — ${pedido.nombreEvento || ''}`;

  const pedidoMap = {};
  (pedido.items || []).forEach(item => { if (item.id) pedidoMap[item.id] = item; else pedidoMap[item.nombre] = item; });

  const tbody = $('cocina-relevamiento-tbody');
  if (!tbody) return;

  const byCategory = {}, catOrder = [];
  cocinaCatalogo.forEach(item => {
    const pedItem = pedidoMap[item.id] || pedidoMap[item.nombre] || null;
    const preparado = pedItem?.cantidad > 0 ? pedItem.cantidad : 0;
    const stockPrev = cocinaStockActual.find(s => s.id === item.id)?.cantidad || 0;
    if (preparado === 0 && stockPrev === 0) return; // ocultar ítems sin relevancia
    if (!byCategory[item.categoria]) { byCategory[item.categoria] = []; catOrder.push(item.categoria); }
    byCategory[item.categoria].push({ catItem: item, pedItem, preparado, stockPrev });
  });

  let html = '';
  catOrder.forEach(cat => {
    const color = cocCatColor(cat);
    html += `<tr class="cocina-cat-header-row" data-cat="${esc(cat)}"><td colspan="6" class="cocina-cat-header-cell" style="background:${color}">${esc(catDisplayName(cat))}</td></tr>`;
    byCategory[cat].forEach(({ catItem, pedItem, preparado, stockPrev }) => {
      const total = preparado + stockPrev;
      const unidad = catItem.unidad || 'und';
      const step = unidad === 'lt' || unidad === 'kg' ? '0.5' : '1';
      const sobraAnterior = pedItem?.stock != null ? pedItem.stock : '';
      html += `<tr data-item-id="${esc(catItem.id)}" style="background:${color}22">
        <td style="padding-left:16px;font-size:13px">${esc(catItem.nombre)}</td>
        <td style="text-align:center;color:#666;font-size:13px">${stockPrev > 0 ? stockPrev : '—'}</td>
        <td style="text-align:center;font-weight:${preparado>0?'600':'400'};color:${preparado>0?'#333':'#aaa'}">${preparado > 0 ? preparado : '—'}</td>
        <td style="text-align:center;font-weight:700;color:#222">${total}</td>
        <td>${_cantWrap(sobraAnterior, step, 'cocina-sobrante-input', `data-item-id="${esc(catItem.id)}"`)}</td>
        <td class="cocina-unidad-cell">${esc(unidad)}</td>
      </tr>`;
    });
  });
  tbody.innerHTML = html || `<tr><td colspan="6" style="text-align:center;padding:16px;color:#888">No hay ítems con stock o en el pedido</td></tr>`;
  _wirePMButtons(tbody);
  tbody.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('cocina-sobrante-input')) {
      e.preventDefault();
      const all = [...tbody.querySelectorAll('.cocina-sobrante-input')];
      const next = all[all.indexOf(e.target) + 1];
      if (next) next.focus();
    }
  });
  $('cocina-relevamiento-wrap').scrollIntoView({ behavior: 'smooth' });
}

async function guardarRelevamiento() {
  if (!cocinaPedidoActual) return;
  const stockInputs = [...document.querySelectorAll('.cocina-sobrante-input')];
  const stockActs = stockInputs.filter(i => i.value !== '').map(i => ({ id: i.dataset.itemId, cantidad: parseFloat(i.value) || 0 }));

  const pedidoMap = {};
  (cocinaPedidoActual.items || []).forEach(item => { if (item.id) pedidoMap[item.id] = item; });
  const stockMap = {};
  stockInputs.forEach(i => { if (i.value !== '') stockMap[i.dataset.itemId] = parseFloat(i.value) || 0; });

  const itemsActualizados = cocinaPedidoActual.items.map(item => ({
    ...item,
    stock: stockMap[item.id] !== undefined ? stockMap[item.id] : (item.stock ?? null),
  }));

  try {
    $('cocina-relevamiento-guardar-btn').disabled = true;
    await apiFetch(`/pedidos-cocina/${cocinaPedidoActual.rowIndex}`, {
      method: 'PUT',
      body: { ...cocinaPedidoActual, items: itemsActualizados, estado: 'relevado' },
    });
    if (stockActs.length) {
      await apiFetch('/stock-actual/actualizar', { method: 'POST', body: { actualizaciones: stockActs } });
      stockActs.forEach(act => {
        const idx = cocinaStockActual.findIndex(s => s.id === act.id);
        if (idx !== -1) cocinaStockActual[idx].cantidad = act.cantidad;
      });
    }
    const idx = cocinaPedidos.findIndex(p => p.rowIndex === cocinaPedidoActual.rowIndex);
    if (idx !== -1) cocinaPedidos[idx] = { ...cocinaPedidoActual, items: itemsActualizados, estado: 'relevado' };
    cocinaPedidoActual = null;
    $('cocina-relevamiento-wrap')?.classList.add('hidden');
    renderPedidosList();
  } catch (e) {
    alert('Error al guardar stock: ' + e.message);
  } finally {
    $('cocina-relevamiento-guardar-btn').disabled = false;
  }
}

const _PRINT_CAT_COLORS = {
  'Recepción - Canapés':'#FFF3E0','Recepción - Bruschettas':'#FFF8E1','Recepción - Fríos':'#E3F2FD',
  'Recepción - Brochettes':'#FCE4EC','Recepción - Empanaditas':'#E8F5E9','Recepción - Calientes':'#FBE9E7',
  'Islas':'#EDE7F6','Primer Plato - Pastas':'#E0F7FA','Primer Plato - Pastas Gourmet':'#B2EBF2',
  'Primer Plato - Salsas':'#E0F2F1','Primer Plato - Salsas Gourmet':'#B2DFDB',
  'Plato Central - Ave':'#FFF9C4','Plato Central - Carne':'#FFEBEE','Plato Central - Guarniciones':'#F3E5F5',
  'Bruschetta - Toppings':'#FFF8E1','Fiambres':'#FAFAFA','Condimentos':'#F9FBE7',
  'Básicos':'#F3F3F3','Verduras':'#E8F5E9','Aceites y Sales':'#FFF3E0',
};

function imprimirPlanillaStock() {
  const STOCKABLE_CATS = ['Recepción - Fríos','Recepción - Brochettes','Recepción - Empanaditas',
    'Recepción - Calientes','Islas','Primer Plato - Pastas','Primer Plato - Pastas Gourmet',
    'Primer Plato - Salsas','Primer Plato - Salsas Gourmet','Plato Central - Ave',
    'Plato Central - Carne','Plato Central - Guarniciones'];
  const ING_CATS = ['Bruschetta - Toppings','Fiambres','Condimentos','Básicos','Verduras','Aceites y Sales'];
  const hoy = new Date().toLocaleDateString('es-AR');

  function buildCol(items) {
    let html = '';
    const bycat = {}, order = [];
    items.forEach(i => { if (!bycat[i.categoria]) { bycat[i.categoria] = []; order.push(i.categoria); } bycat[i.categoria].push(i); });
    order.forEach(cat => {
      const c = _PRINT_CAT_COLORS[cat] || '#f5f5f5';
      html += `<tr><td colspan="3" style="background:${c};padding:3px 6px;font-size:8pt;font-weight:700;color:#5d4037">${cat}</td></tr>`;
      bycat[cat].forEach(i => {
        html += `<tr><td style="padding:2px 6px 2px 12px;font-size:8pt">${esc(i.nombre)}</td><td style="font-size:8pt;color:#888;width:28px">${esc(i.unidad||'und')}</td><td style="border:1px solid #bbb;width:50px;padding:2px">&nbsp;</td></tr>`;
      });
    });
    return html;
  }

  const stockProdItems = cocinaStockActual.filter(s => STOCKABLE_CATS.includes(s.categoria));
  const stockIngItems = cocinaStockActual.filter(s => ING_CATS.includes(s.categoria));

  const html = `
    <div style="border-bottom:2px solid #333;padding-bottom:6px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:flex-end">
      <h2 style="font-size:13pt;margin:0">JOLIET — PLANILLA DE STOCK</h2>
      <span style="font-size:9pt">Fecha: _______________</span>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <tr>
        <td style="width:50%;vertical-align:top;padding-right:10px">
          <div style="font-size:8.5pt;font-weight:700;background:#e8e8e8;padding:3px 6px;margin-bottom:4px">PRODUCCIÓN</div>
          <table style="width:100%;border-collapse:collapse">${buildCol(stockProdItems)}</table>
        </td>
        <td style="width:50%;vertical-align:top;padding-left:10px;border-left:1px solid #ddd">
          <div style="font-size:8.5pt;font-weight:700;background:#e8e8e8;padding:3px 6px;margin-bottom:4px">INGREDIENTES Y MATERIAS PRIMAS</div>
          <table style="width:100%;border-collapse:collapse">${buildCol(stockIngItems)}</table>
        </td>
      </tr>
    </table>
    <p style="margin-top:10px;font-size:8pt;color:#666;border-top:1px solid #ddd;padding-top:4px">Impreso el ${hoy}</p>`;
  abrirVentanaImpresion(html);
}

function buildPrintPedidoHTML(pedido) {
  const hoy = new Date().toLocaleDateString('es-AR');
  const byCategory = {}, catOrder = [];
  (pedido.items || []).filter(i => i.cantidad > 0).forEach(item => {
    const cat = item.categoria || 'Sin categoría';
    if (!byCategory[cat]) { byCategory[cat] = []; catOrder.push(cat); }
    byCategory[cat].push(item);
  });
  let rows = '';
  catOrder.forEach(cat => {
    const color = _PRINT_CAT_COLORS[cat] || '#f5f5f5';
    rows += `<tr><td colspan="4" style="background:${color};padding:3px 8px;font-weight:700;font-size:8pt;color:#5d4037;border-bottom:1px solid #ccc">${esc(catDisplayName(cat))}</td></tr>`;
    byCategory[cat].forEach(i => {
      rows += `<tr style="background:${color}40"><td style="padding-left:12px">${esc(i.nombre)}</td><td style="text-align:center">${i.cantidad}</td><td style="text-align:center">${esc(i.unidad||'und')}</td><td>${esc(i.observaciones||'')}</td></tr>`;
    });
  });
  const evento = esc(pedido.nombreEvento||'—');
  const fechaEvento = pedido.fecha ? formatDate(pedido.fecha) : '—';
  return `<table class="print-table">
    <thead>
      <tr><td colspan="4" class="print-doc-header">
        <div class="ph-title">JOLIET — PEDIDO DE PRODUCCIÓN</div>
        <div class="ph-meta">
          <span><b>Evento:</b> ${evento}</span>
          <span><b>Fecha del evento:</b> ${fechaEvento}</span>
          <span><b>Generado:</b> ${hoy}</span>
        </div>
        <div class="ph-fill">Completado por: _____________________ &nbsp;&nbsp; Fecha: ___/___/______</div>
      </td></tr>
      <tr><th>Ítem</th><th style="width:60px">Cant.</th><th style="width:50px">Unid.</th><th style="width:28%">Observaciones</th></tr>
    </thead>
    <tbody>${rows||'<tr><td colspan="4" style="text-align:center;padding:12px">Sin ítems con cantidad asignada</td></tr>'}</tbody>
  </table>`;
}

function buildPrintRelevamientoHTML(pedido) {
  const hoy = new Date().toLocaleDateString('es-AR');
  const pedidoMap = {};
  (pedido.items || []).forEach(i => { if (i.id) pedidoMap[i.id] = i; else pedidoMap[i.nombre] = i; });
  const byCategory = {}, catOrder = [];
  cocinaCatalogo.forEach(item => {
    const pedItem = pedidoMap[item.id] || pedidoMap[item.nombre];
    const preparado = pedItem?.cantidad > 0 ? pedItem.cantidad : 0;
    const stockPrev = cocinaStockActual.find(s => s.id === item.id)?.cantidad || 0;
    if (preparado === 0 && stockPrev === 0) return;
    const cat = item.categoria || 'Sin categoría';
    if (!byCategory[cat]) { byCategory[cat] = []; catOrder.push(cat); }
    byCategory[cat].push({ catItem: item, pedItem, preparado, stockPrev });
  });
  let rows = '';
  catOrder.forEach(cat => {
    const color = _PRINT_CAT_COLORS[cat] || '#f5f5f5';
    rows += `<tr><td colspan="5" style="background:${color};padding:3px 8px;font-weight:700;font-size:8pt;color:#5d4037;border-bottom:1px solid #ccc">${esc(catDisplayName(cat))}</td></tr>`;
    byCategory[cat].forEach(({ catItem, pedItem, preparado, stockPrev }) => {
      const total = preparado + stockPrev;
      const unid = catItem.unidad || 'und';
      rows += `<tr style="background:${color}40">
        <td style="padding-left:12px">${esc(catItem.nombre)}</td>
        <td style="text-align:center;color:#555">${stockPrev > 0 ? `${stockPrev} ${esc(unid)}` : '—'}</td>
        <td style="text-align:center;font-weight:${preparado>0?'600':'400'}">${preparado > 0 ? `${preparado} ${esc(unid)}` : '—'}</td>
        <td style="text-align:center;font-weight:700">${total} ${esc(unid)}</td>
        <td></td>
      </tr>`;
    });
  });
  const evento = esc(pedido.nombreEvento||'—');
  const fechaEvento = pedido.fecha ? formatDate(pedido.fecha) : '—';
  return `<table class="print-table">
    <thead>
      <tr><td colspan="5" class="print-doc-header">
        <div class="ph-title">JOLIET — CONTROL DE STOCK POST-EVENTO</div>
        <div class="ph-meta">
          <span><b>Evento:</b> ${evento}</span>
          <span><b>Fecha del evento:</b> ${fechaEvento}</span>
          <span><b>Generado:</b> ${hoy}</span>
        </div>
        <div class="ph-fill">Relevamiento realizado por: _____________________ &nbsp;&nbsp; Fecha: ___/___/______</div>
      </td></tr>
      <tr><th>Ítem</th><th style="width:80px;text-align:center">Stock previo</th><th style="width:80px;text-align:center">Preparado</th><th style="width:80px;text-align:center">Total</th><th style="width:90px;text-align:center">Sobrante</th></tr>
    </thead>
    <tbody>${rows||'<tr><td colspan="5" style="text-align:center;padding:12px">Sin ítems</td></tr>'}</tbody>
  </table>`;
}

function abrirVentanaImpresion(htmlContent) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { alert('Habilitá las ventanas emergentes para este sitio e intentá nuevamente.'); return; }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{font-family:Arial,sans-serif;font-size:8.5pt;color:#000;margin:0;padding:10px;background:#fff}
  thead{display:table-header-group}
  .print-table{width:100%;border-collapse:collapse;font-size:8.5pt;margin-top:0}
  .print-table th{background:#e0e0e0;padding:4px 7px;border:1px solid #999;text-align:left;font-size:8pt}
  .print-table td{border:1px solid #ccc;padding:3px 6px;vertical-align:top}
  .print-doc-header{border:none!important;border-bottom:2px solid #333!important;padding:4px 0 8px 0!important}
  .ph-title{font-size:12.5pt;font-weight:700;margin:0 0 5px 0}
  .ph-meta{font-size:8pt;color:#333;display:flex;gap:20px;flex-wrap:wrap;margin-bottom:3px}
  .ph-fill{font-size:7.5pt;color:#555;margin-top:5px;padding-top:5px;border-top:1px dashed #bbb}
  @page{size:A4 portrait;margin:12mm 15mm 18mm 15mm;@bottom-right{content:"Hoja " counter(page) " / " counter(pages);font-size:7.5pt;color:#888}}
  @media print{body{padding:0;margin:0}}
  </style></head><body>${htmlContent}<script>setTimeout(function(){window.print();},300);<\/script></body></html>`);
  win.document.close();
}

function imprimirPedidoCocina(pedido) {
  document.getElementById('cocina-print-confirm')?.remove();
  const tieneStock = pedido.items.some(i => {
    const s = cocinaStockActual.find(x => x.id === i.id);
    return s && s.cantidad > 0 && i.cantidad > 0;
  });
  if (!tieneStock) { abrirVentanaImpresion(buildPrintPedidoHTML(pedido)); return; }

  const modal = document.createElement('div');
  modal.id = 'cocina-print-confirm';
  modal.className = 'cocina-print-confirm-overlay';
  modal.innerHTML = `
    <div class="cocina-print-confirm-box">
      <p>¿Ajustar cantidades por stock disponible?</p>
      <small>Hay ítems con stock disponible. Si ajustás, en la hoja impresa se muestra solo lo que falta preparar (total pedido − stock en mano).</small>
      <div class="cocina-print-confirm-btns">
        <button id="cpg-si" class="btn btn-primary">✅ Ajustar y imprimir</button>
        <button id="cpg-no" class="btn btn-secondary">🖨️ Imprimir cantidades originales</button>
        <button id="cpg-cancel" class="btn btn-secondary" style="color:#888">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  document.getElementById('cpg-si').addEventListener('click', () => {
    modal.remove();
    const adjustedItems = pedido.items.map(i => {
      const s = cocinaStockActual.find(x => x.id === i.id);
      if (s && s.cantidad > 0 && i.cantidad > 0)
        return { ...i, cantidad: Math.max(0, i.cantidad - s.cantidad) };
      return i;
    });
    abrirVentanaImpresion(buildPrintPedidoHTML({ ...pedido, items: adjustedItems }));
  });
  document.getElementById('cpg-no').addEventListener('click', () => {
    modal.remove();
    abrirVentanaImpresion(buildPrintPedidoHTML(pedido));
  });
  document.getElementById('cpg-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function imprimirRelevamientoCocina(pedido) { abrirVentanaImpresion(buildPrintRelevamientoHTML(pedido)); }

function toggleStockCol() {
  const wrap = $('cocina-form-wrap');
  const btn = $('cocina-toggle-stock-col-btn');
  if (!wrap) return;
  const on = wrap.classList.toggle('stock-col-visible');
  if (btn) btn.textContent = on ? '👁 Ocultar stock' : '👁 Ver stock disponible';
}

function toggleCatalogoPanel() {
  const panel = $('cocina-catalogo-panel');
  if (!panel) return;
  if (panel.classList.contains('hidden')) {
    renderCatalogoPanel();
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
}

function renderCatalogoPanel() {
  const panel = $('cocina-catalogo-panel');
  if (!panel) return;
  const cats = {};
  const catNames = [];
  for (const item of cocinaCatalogo) {
    if (!cats[item.categoria]) { cats[item.categoria] = []; catNames.push(item.categoria); }
    cats[item.categoria].push(item);
  }
  const uniqueCats = [...new Set(catNames)];
  const UNITS = ['und', 'lt', 'kg', 'gr'];
  const catOpts = uniqueCats.map(c => `<option value="${esc(c)}">${esc(catDisplayName(c))}</option>`).join('');

  let html = `<div class="cat-nuevo-form">
    <select id="cat-nuevo-cat" class="cat-nuevo-sel">${catOpts}<option value="__nueva">+ Nueva categoría…</option></select>
    <input id="cat-nueva-cat-txt" class="cat-nuevo-txt hidden" placeholder="Nombre de categoría">
    <input id="cat-nuevo-nombre" class="cat-nuevo-txt" placeholder="Nombre del ítem" style="flex:2">
    <select id="cat-nuevo-unidad" class="cat-panel-unidad-sel">${UNITS.map(u => `<option>${u}</option>`).join('')}</select>
    <button id="cat-nuevo-agregar-btn" class="btn btn-primary btn-sm">＋ Agregar</button>
  </div>
  <div class="cat-panel-body">`;

  for (const [cat, items] of Object.entries(cats)) {
    html += `<div class="cat-panel-group-header" style="background:${cocCatColor(cat)}">${catDisplayName(cat)}</div>`;
    for (const item of items) {
      const opts = UNITS.map(u => `<option value="${u}"${item.unidad === u ? ' selected' : ''}>${u}</option>`).join('');
      html += `<div class="cat-panel-row" data-row="${item.rowIndex}">
        <span class="cat-panel-nombre" data-row="${item.rowIndex}">${esc(item.nombre)}</span>
        <input class="cat-panel-nombre-edit hidden" data-row="${item.rowIndex}" value="${esc(item.nombre)}">
        <button class="cat-panel-edit-btn" data-row="${item.rowIndex}" title="Editar nombre">✏️</button>
        <button class="cat-panel-save-btn hidden" data-row="${item.rowIndex}">✓</button>
        <select class="cat-panel-unidad-sel" data-row="${item.rowIndex}">${opts}</select>
        <span class="cat-panel-status" id="cat-status-${item.rowIndex}"></span>
        <button class="cat-panel-deact-btn" data-row="${item.rowIndex}" title="Desactivar ítem">✕</button>
      </div>`;
    }
  }
  html += '</div>';
  panel.innerHTML = html;

  // Categoría "Nueva" toggle
  document.getElementById('cat-nuevo-cat')?.addEventListener('change', e => {
    document.getElementById('cat-nueva-cat-txt')?.classList.toggle('hidden', e.target.value !== '__nueva');
  });

  // Agregar ítem nuevo
  document.getElementById('cat-nuevo-agregar-btn')?.addEventListener('click', async () => {
    const sel = document.getElementById('cat-nuevo-cat');
    const cat = sel?.value === '__nueva'
      ? (document.getElementById('cat-nueva-cat-txt')?.value.trim() || '')
      : (sel?.value || '');
    const nombre = document.getElementById('cat-nuevo-nombre')?.value.trim() || '';
    const unidad = document.getElementById('cat-nuevo-unidad')?.value || 'und';
    if (!cat || !nombre) { alert('Completá categoría y nombre.'); return; }
    try {
      const nuevo = await apiFetch('/catalogo-items', { method: 'POST', body: { categoria: cat, nombre, unidad } });
      cocinaCatalogo.push(nuevo);
      renderCatalogoPanel();
    } catch (e) { alert('Error al agregar: ' + e.message); }
  });
}

document.addEventListener('change', async ev => {
  const sel = ev.target.closest('.cat-panel-unidad-sel');
  if (!sel) return;
  const rowIndex = parseInt(sel.dataset.row);
  const unidad = sel.value;
  const statusEl = document.getElementById(`cat-status-${rowIndex}`);
  if (statusEl) statusEl.textContent = '…';
  try {
    await apiFetch(`/catalogo-items/${rowIndex}`, { method: 'PUT', body: { unidad } });
    const item = cocinaCatalogo.find(i => i.rowIndex === rowIndex);
    if (item) item.unidad = unidad;
    if (statusEl) { statusEl.textContent = '✓'; setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000); }
  } catch (e) {
    if (statusEl) statusEl.textContent = '✗';
    alert('Error al guardar unidad: ' + e.message);
  }
});

document.addEventListener('click', ev => {
  const editBtn = ev.target.closest('.cat-panel-edit-btn');
  if (editBtn) {
    const row = editBtn.dataset.row;
    document.querySelector(`.cat-panel-nombre[data-row="${row}"]`)?.classList.add('hidden');
    const inp = document.querySelector(`.cat-panel-nombre-edit[data-row="${row}"]`);
    inp?.classList.remove('hidden');
    inp?.focus();
    document.querySelector(`.cat-panel-save-btn[data-row="${row}"]`)?.classList.remove('hidden');
    editBtn.classList.add('hidden');
    return;
  }
});

document.addEventListener('click', async ev => {
  const saveBtn = ev.target.closest('.cat-panel-save-btn');
  if (saveBtn) {
    const row = parseInt(saveBtn.dataset.row);
    const inp = document.querySelector(`.cat-panel-nombre-edit[data-row="${row}"]`);
    const nombre = inp?.value.trim();
    if (!nombre) return;
    const statusEl = document.getElementById(`cat-status-${row}`);
    if (statusEl) statusEl.textContent = '…';
    try {
      await apiFetch(`/catalogo-items/${row}`, { method: 'PUT', body: { nombre } });
      const item = cocinaCatalogo.find(i => i.rowIndex === row);
      if (item) item.nombre = nombre;
      const span = document.querySelector(`.cat-panel-nombre[data-row="${row}"]`);
      if (span) span.textContent = nombre;
      span?.classList.remove('hidden');
      inp?.classList.add('hidden');
      saveBtn.classList.add('hidden');
      document.querySelector(`.cat-panel-edit-btn[data-row="${row}"]`)?.classList.remove('hidden');
      if (statusEl) { statusEl.textContent = '✓'; setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000); }
    } catch (e) {
      if (statusEl) statusEl.textContent = '✗';
    }
    return;
  }
});

document.addEventListener('click', async ev => {
  const btn = ev.target.closest('.cat-panel-deact-btn');
  if (!btn) return;
  const rowIndex = parseInt(btn.dataset.row);
  const item = cocinaCatalogo.find(i => i.rowIndex === rowIndex);
  if (!confirm(`¿Desactivar "${item?.nombre || 'este ítem'}"? No aparecerá más en pedidos ni stock.`)) return;
  btn.disabled = true;
  try {
    await apiFetch(`/catalogo-items/${rowIndex}`, { method: 'DELETE' });
    cocinaCatalogo = cocinaCatalogo.filter(i => i.rowIndex !== rowIndex);
    cocinaStockActual = cocinaStockActual.filter(i => i.id !== item?.id);
    renderCatalogoPanel();
    if ($('cocina-tab-stock') && !$('cocina-tab-stock').classList.contains('hidden')) renderStockDashboard();
  } catch (e) {
    btn.disabled = false;
    alert('Error al desactivar: ' + e.message);
  }
});

// Tabs de cocina
document.querySelectorAll('.cocina-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchCocinaTab(btn.dataset.tab));
});

// Tab stock
$('cocina-actualizar-stock-btn')?.addEventListener('click', openActualizarStockForm);
$('cocina-actualizar-cancel-btn')?.addEventListener('click', () => $('cocina-actualizar-stock-form')?.classList.add('hidden'));
$('cocina-actualizar-stock-guardar-btn')?.addEventListener('click', guardarActualizacionStock);
$('cocina-imprimir-planilla-btn')?.addEventListener('click', imprimirPlanillaStock);

// Tab pedido
$('cocina-nuevo-btn')?.addEventListener('click', () => openFormularioPedido());
$('cocina-toggle-stock-col-btn')?.addEventListener('click', toggleStockCol);
$('cocina-descontar-stock-btn')?.addEventListener('click', descontarStockDelPedido);
$('cocina-form-cancel-btn')?.addEventListener('click', () => {
  $('cocina-form-wrap')?.classList.add('hidden');
  $('cocina-agregar-panel')?.classList.add('hidden');
  cocinaPedidoActual = null;
});
$('cocina-agregar-item-btn')?.addEventListener('click', toggleAgregarPanel);
$('cocina-guardar-btn')?.addEventListener('click', guardarPedido);
$('cocina-relevamiento-cancel-btn')?.addEventListener('click', () => {
  $('cocina-relevamiento-wrap')?.classList.add('hidden');
  cocinaPedidoActual = null;
});
$('cocina-relevamiento-guardar-btn')?.addEventListener('click', guardarRelevamiento);

/* ===================== SESSION RESTORE ===================== */
(function restoreSession() {
  const savedToken = localStorage.getItem('crm_token');
  const savedUser = localStorage.getItem('crm_user');
  if (savedToken && savedUser) {
    token = savedToken;
    currentUser = JSON.parse(savedUser);
    initApp();
  }
})();
