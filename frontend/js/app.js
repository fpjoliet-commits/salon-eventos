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

function isAdmin() { return currentUser?.role === 'admin'; }
function canManagePagos() { return isAdmin() || currentUser?.usuario === 'admin'; }
function canEditNombre() { return canManagePagos(); }

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
  $('sidebar-role').textContent = isAdmin() ? 'Admin' : 'EMPLEADO';

  // Mostrar/ocultar items de nav según rol
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin() ? '' : 'none';
  });

  // Timing Planner: visible para superadmin y admin (mismo criterio que la pestaña)
  document.querySelectorAll('.nav-item[data-view="timing-global"]').forEach(el => {
    el.style.display = canManagePagos() ? '' : 'none';
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

/* ===================== CARGA HISTÓRICA ===================== */
let historicoCount = 0;

$('historico-form').addEventListener('submit', async e => {
  e.preventDefault();
  const nombre = $('hist-nombre').value.trim();
  const estadoSeleccionado = document.querySelector('input[name="hist-estado"]:checked')?.value || 'Realizado';

  const data = {
    apellidoNombre: nombre,
    telefono: $('hist-telefono').value.trim(),
    tipoEvento: $('hist-tipo').value,
    fechaEvento: $('hist-fecha').value,
    cantidadInvitados: $('hist-pax').value,
    turno: $('hist-turno').value,
    observaciones: $('hist-obs').value.trim(),
    estado: estadoSeleccionado,
    estadoFecha: estadoSeleccionado === 'Confirmado' ? 'Tentativa' : '',
    cargadoPor: currentUser.usuario,
    fechaCarga: new Date().toISOString().split('T')[0],
  };

  try {
    await apiFetch('/clientes', { method: 'POST', body: data });
    historicoCount++;
    const msg = $('historico-success');
    msg.textContent = `✓ "${nombre}" guardado correctamente.`;
    show('historico-success');
    setTimeout(() => hide('historico-success'), 4000);
    $('hist-contador').textContent = `${historicoCount} evento${historicoCount !== 1 ? 's' : ''} cargado${historicoCount !== 1 ? 's' : ''} en esta sesión`;
    $('historico-form').reset();
    $('hist-nombre').focus();
    allClientes = await apiFetch('/clientes');
  } catch (err) {
    alert('Error al guardar: ' + err.message);
  }
});

/* ===================== PERSONAS ===================== */
async function loadPersonas() {
  try { allPersonas = await apiFetch('/personas'); } catch {}
}

/* ===================== RECORDATORIOS ===================== */
function calcReminders() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const visitasHoy = allClientes.filter(c =>
    c.estado === 'Visita agendada' && c.proximoSeguimiento === todayStr
  );

  const eventosProximos = allClientes.filter(c => {
    if (c.estado !== 'Confirmado' || !c.fechaEvento) return false;
    const evDate = new Date(c.fechaEvento); evDate.setHours(0, 0, 0, 0);
    const diff = (evDate - today) / 86400000;
    return diff >= 0 && diff <= 4;
  });

  return { visitasHoy, eventosProximos };
}

function renderRemindersBar() {
  const bar = $('reminders-bar');
  if (!bar) return;
  const { visitasHoy, eventosProximos } = calcReminders();
  if (!visitasHoy.length && !eventosProximos.length) {
    bar.innerHTML = ''; bar.classList.add('hidden'); return;
  }

  const today = new Date(); today.setHours(0,0,0,0);
  let html = '<div class="reminders-inner">';

  if (visitasHoy.length) {
    const ids = visitasHoy.map(c => `'${c.id}'`).join(',');
    html += `<div class="reminder-item reminder-visita" onclick="filterReminder([${ids}])">
      <span class="reminder-icon">📅</span>
      <strong>Visitas hoy:</strong>&nbsp;${visitasHoy.length} cliente${visitasHoy.length > 1 ? 's' : ''}
    </div>`;
  }

  eventosProximos.forEach(c => {
    const evDate = new Date(c.fechaEvento); evDate.setHours(0,0,0,0);
    const diff = Math.round((evDate - today) / 86400000);
    const cuando = diff === 0 ? 'HOY' : diff === 1 ? 'mañana' : `en ${diff} días`;
    html += `<div class="reminder-item reminder-evento" onclick="abrirClientePorId('${c.id}')">
      <span class="reminder-icon">⚠️</span>
      <strong>${esc(c.apellidoNombre)}</strong>&nbsp;— ${c.tipoEvento || 'Evento'} ${cuando}
    </div>`;
  });

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

  let filtered = allClientes.filter(c => {
    const matchSearch = !search ||
      (c.apellidoNombre || '').toLowerCase().includes(search) ||
      (c.telefono || '').includes(search) ||
      (c.gmail || '').toLowerCase().includes(search);
    const matchEstado = !estado ||
      (estado === '__con_fecha__' ? !!c.proximoSeguimiento : c.estado === estado);
    const matchEvento = !evento || c.tipoEvento === evento;
    return matchSearch && matchEstado && matchEvento;
  });

  renderClientes(filtered);
}

$('search-input').addEventListener('input', applyFilters);
$('filter-estado').addEventListener('change', applyFilters);
$('filter-evento').addEventListener('change', applyFilters);

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
  if (canManagePagos()) {
    btnNuevoEvento?.classList.remove('hidden');
    btnEliminar?.classList.remove('hidden');
    btnVerTiming?.classList.remove('hidden');
  } else {
    btnNuevoEvento?.classList.add('hidden');
    btnEliminar?.classList.add('hidden');
    btnVerTiming?.classList.add('hidden');
  }
  tabHistorial?.classList.remove('hidden');

  activateTab(tabInicial);
  renderClienteDetail(cliente);
  injectNombreAcciones(cliente);
  loadRestriccionesModal(cliente);
  initPagoForm(cliente);
  renderHistorialTab(cliente);
  loadCuotasTab(cliente);
  if (canManagePagos()) {
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
  const titulo = $('pago-form')?.querySelector('h4');
  if (titulo) titulo.textContent = canManagePagos() ? 'Registrar cobro' : 'Sugerir cobro';
  // empleados no pueden vincular cuotas directamente
  if (!canManagePagos()) hideEl($('cuotas-a-tachar'));
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
    const confirmados = ingresos.filter(i => i.confirmado !== false);
    const totalARS = confirmados.filter(i => !i.moneda || i.moneda === 'ARS').reduce((s, i) => s + (parseFloat(i.monto) || 0), 0);
    const totalUSD = confirmados.filter(i => i.moneda === 'USD').reduce((s, i) => s + (parseFloat(i.monto) || 0), 0);
    const partes = [];
    if (totalARS > 0) partes.push(formatMoney(totalARS));
    if (totalUSD > 0) partes.push(formatMoneda(totalUSD, 'USD'));
    if (canManagePagos()) {
      $('pagos-total').innerHTML = `Total cobrado: ${partes.length ? partes.join(' · ') : formatMoney(0)}`;
    } else {
      $('pagos-total').innerHTML = '';
    }
    if (!ingresos.length) {
      $('pagos-list').innerHTML = '<p style="color:#999;font-size:13px;margin-bottom:12px">Sin ingresos registrados.</p>';
      return;
    }
    const mostrarMontos = canManagePagos();
    $('pagos-list').innerHTML = `<div class="item-list">${ingresos.map(i => `
      <div class="list-item${!i.confirmado ? ' list-item-sugerido' : ''}">
        <div class="list-item-info">
          <div class="list-item-label">
            ${i.tipoIngreso}${mostrarMontos ? ` — ${formatMoneda(i.monto, i.moneda || 'ARS')}` : ''}
            ${!i.confirmado ? `<span class="badge-sugerido">SUGERIDO</span>` : ''}
          </div>
          <div class="list-item-sub">${formatDate(i.fecha)}${i.formaPago ? ' · ' + i.formaPago : ''}${i.notas ? ' · ' + i.notas : ''}</div>
        </div>
        ${!i.confirmado && canManagePagos() ? `<button class="btn btn-sm btn-confirm-plan btn-confirmar-ingreso" data-row="${i.rowIndex}">✓ Confirmar</button>` : ''}
      </div>
    `).join('')}</div>`;
    document.querySelectorAll('.btn-confirmar-ingreso').forEach(btn => {
      btn.addEventListener('click', async () => {
        const rowIndex = parseInt(btn.dataset.row);
        try {
          btn.disabled = true;
          await apiFetch(`/ingresos/${rowIndex}/confirmar`, { method: 'PUT' });
          loadPagosCliente(currentClienteModal);
        } catch (err) { alert('Error al confirmar: ' + err.message); btn.disabled = false; }
      });
    });
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

  const firstDay = new Date(calYear, calMonth, 1);
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  let startDow = firstDay.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;

  const t = new Date();
  const todayStr = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;

  const pillClass = {
    'Confirmado': 'cal-pill-confirmado',
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
    cells += `<div class="cal-cell${isToday ? ' cal-cell-today' : ''}">
      <span class="cal-cell-num${isToday ? ' cal-num-today' : ''}">${d}</span>
      ${evs.map(c => {
        const sub = [c.tipoEvento, c.cantidadInvitados ? `${c.cantidadInvitados} PAX` : ''].filter(Boolean).join(' · ');
        return `<div class="cal-pill ${pillClass[c.estado] || ''}" onclick="openClienteModal(window._cmap['${c.id}'])" title="${c.apellidoNombre}${c.turno ? ' · '+c.turno : ''}">
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
    return d > hoy && d <= en3;
  }).sort((a, b) => a.proximoSeguimiento.localeCompare(b.proximoSeguimiento));

  // Cobros: Confirmado/Por cerrar con fecha en los próximos 4-14 días (los de hoy/3d ya aparecen arriba)
  const cobros = activos.filter(c => {
    if (!esCobro(c)) return false;
    if (!c.proximoSeguimiento) return false;
    const d = new Date(c.proximoSeguimiento); d.setHours(0,0,0,0);
    return d > en3 && d <= en14;
  }).sort((a, b) => a.proximoSeguimiento.localeCompare(b.proximoSeguimiento));

  const visitas = activos.filter(c => {
    if (c.estado !== 'Visita agendada') return false;
    if (!c.proximoSeguimiento) return true;
    const d = new Date(c.proximoSeguimiento); d.setHours(0,0,0,0);
    return d <= en7;
  }).sort((a, b) => (a.proximoSeguimiento || '').localeCompare(b.proximoSeguimiento || ''));

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

  let html = `<div class="seg-panel-title">Pendientes</div>`;

  const hayAlgo = vencidos.length || paraHoy.length || proximos.length || cobros.length || visitas.length;
  if (!hayAlgo) {
    html += `<p class="seg-empty">Sin tareas para los próximos días ✓</p>`;
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
    html += `<div class="seg-section-label seg-label-prox">Próximos 3 días</div>`;
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

  aside.innerHTML = html;
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

  // Validar: gmail obligatorio y único para personas nuevas
  const personaIdExistente = $('edit-persona-id').value;
  if (!personaIdExistente && !isEdit) {
    const gmail = (form.gmail.value || '').trim().toLowerCase();
    if (!gmail) {
      $('form-error').textContent = 'El Gmail es obligatorio para registrar un nuevo cliente.';
      show('form-error');
      return;
    }
    const duplicadoGmail = allPersonas.find(p => p.gmail && p.gmail.toLowerCase() === gmail);
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

  // Validar: no se puede reservar fecha sin seña
  if (form.estadoFecha.value === 'Reservada') {
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

  const noConfirmadas = cuotas.filter(c => !c.confirmado);
  if (noConfirmadas.length && !canManagePagos()) {
    con.innerHTML = `<div class="sugerencia-banner">
      <span>⏳ Tu sugerencia de plan fue enviada y está pendiente de confirmación por el administrador.</span>
    </div>`;
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
      ${noConfirmadas.length && isAdmin() ? `<button class="btn btn-sm btn-confirm-plan" id="btn-confirmar-plan">✓ Confirmar plan sugerido (${noConfirmadas.length})</button>` : ''}
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
          ${!c.confirmado ? `<span class="badge-sugerido">SUGERIDO</span>` : ''}
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
      <button type="submit" class="btn btn-primary btn-sm">${canManagePagos() ? 'Crear plan' : 'Sugerir plan'}</button>
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
    { nombre: 'Recepción',           desc: 'Cocktails y bocados de bienvenida en el jardín' },
    { nombre: 'Islas gastronómicas', desc: 'Estaciones en vivo mientras todos ingresan al salón' },
    { nombre: 'Primer plato',        desc: 'Pastas artesanales servidas a la mesa' },
    { nombre: 'Plato central',       desc: 'Cortes de carne y ave con guarnición' },
    { nombre: 'Torta homenaje',      desc: 'El momento del brindis y el agasajo' },
    { nombre: 'Mesa de dulces',      desc: 'Pastelería fina sobre mesa principal iluminada' },
    { nombre: 'Cafetería',           desc: 'Café, té e infusiones para cerrar con calma' },
    { nombre: 'Fin de fiesta',       desc: 'Café, pizza, mate — el cierre a su gusto' },
  ],
  Americano: [
    { nombre: 'Recepción',           desc: 'Cocktails, canapés y bocados calientes en el jardín' },
    { nombre: 'Islas gastronómicas', desc: 'Dos estaciones temáticas en vivo, a elección del anfitrión' },
    { nombre: 'Torta homenaje',      desc: 'El momento del brindis y el agasajo' },
    { nombre: 'Postres',             desc: 'Dulces de elaboración propia para seguir disfrutando' },
    { nombre: 'Cafetería',           desc: 'Café, té e infusiones para cerrar con calma' },
    { nombre: 'Fin de fiesta',       desc: 'Café, pizza, mate — el cierre a su gusto' },
  ]
};

const propuestaState = {
  current: 1,
  total: 11,
  data: {
    nombre: '', telefono: '', gmail: '', clienteId: null,
    estilo: '', tipoEvento: '', agasajado: '', fecha: '', turno: '',
    invitados: 100, menuInfantil: false, infantilCant: '',
    espacio: '', adicionales: [], gastroAdicionales: [], pedidos: ''
  }
};

function initPropuesta() {
  const d = propuestaState.data;
  propuestaState.current = 1;
  d.nombre = ''; d.telefono = ''; d.gmail = ''; d.clienteId = null;
  d.estilo = ''; d.tipoEvento = ''; d.agasajado = ''; d.fecha = ''; d.turno = '';
  d.invitados = 100; d.menuInfantil = false; d.infantilCant = '';
  d.espacio = ''; d.adicionales = []; d.gastroAdicionales = []; d.pedidos = '';

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
    const nuevo = await apiFetch('/api/clientes', {
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
    document.querySelectorAll('#gastro-slide-content input[type="checkbox"]:checked').forEach(cb => {
      propuestaState.data.gastroAdicionales.push(cb.value);
    });
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
  document.querySelectorAll('#gastro-slide-content input[type="checkbox"]:checked').forEach(cb => {
    d.gastroAdicionales.push(cb.value);
  });
  d.pedidos = $('prop-pedidos')?.value?.trim() || '';
}

/* ===== GASTRO SLIDE — dinámico por estilo ===== */
const GASTRO_DATA = {
  Formal: {
    pillars: [
      { ico: '🥂', label: 'Recepción<br>& cóctel' },
      { ico: '🍝', label: 'Pastas<br>artesanales' },
      { ico: '🥩', label: 'Plato<br>central' },
      { ico: '🎂', label: 'Mesa de<br>dulces' },
    ],
    islasTitle: 'Islas gastronómicas',
    islasSub: 'Durante la recepción · Incluye una estación',
    islasLabel: 'A ELECCIÓN · UNA INCLUIDA',
    islas: [
      { value: 'Mollejas & Verdeo', name: 'Mollejas & Verdeo', desc: 'Mollejitas doradas y tiernas, salteadas con verdeo fresco · Servidas en pancitos de campo' },
      { value: 'Alma Mexicana', name: 'Alma Mexicana', desc: 'Tacos de carne, pollo o cerdo con toppings clásicos · Nachos crocantes para acompañar' },
      { value: 'Clásicos en Laja', name: 'Clásicos en Laja', desc: 'Selección de fiambres y quesos en lajas de piedra · Variedad de panes y aderezos' },
      { value: 'Estación de Crêpes', name: 'Estación de Crêpes', desc: 'Crêpes finos preparados al momento con rellenos salados y salsas suaves para combinar' },
    ],
    premium: [
      { value: 'Delicias de Mar', name: 'Delicias de Mar', desc: 'Cazuela caliente con mix de mariscos y vegetales en caldo de mar' },
      { value: 'Paella Mediterránea', name: 'Paella Mediterránea', desc: 'Tradicional paella con mariscos, pollo y vegetales, servida caliente' },
      { value: 'Sushi en vivo', name: 'Sushi en vivo', desc: 'Preparación artesanal frente a los invitados' },
    ],
    mode: 'single',
    maxBase: 1,
  },
  Americano: {
    pillars: [
      { ico: '🥂', label: 'Recepción<br>& cóctel' },
      { ico: '🏝️', label: 'Islas en vivo<br>(plato central)' },
      { ico: '🎂', label: 'Postres &<br>torta homenaje' },
    ],
    islasTitle: 'Las islas · el plato central',
    islasSub: 'Sus invitados circulan, eligen y disfrutan a su ritmo',
    islasLabel: 'BASE INCLUIDA · elegí 1 más',
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
    mode: 'multi',
    maxBase: 1,
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
  const hasCarne = freeIslas.some(i => i.cat === 'Carne');

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

  const carneNoteHtml = hasCarne ? `<p class="gastro-carne-note">* Las islas de base carne tienen un pequeño costo adicional · consultanos</p>` : '';

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
    ? `<div class="gastro-counter" id="gastro-base-counter"><span id="gastro-base-count">0</span> / 1 adicional elegido</div>`
    : '';

  container.innerHTML = `
    <div class="gastro-incluido">${pillarsHtml}</div>
    <div class="gastro-islands-section">
      <div class="gastro-section-header">
        <div class="gastro-section-title">${data.islasTitle}</div>
        <div class="gastro-section-sub">${data.islasSub}</div>
        ${counterHtml}
      </div>
      <div class="gastro-section-label">${data.islasLabel}</div>
      <div class="gastro-islands-list" id="gastro-extras-grid">${lockedHtml}${baseIslandsHtml}${carneNoteHtml}</div>
      <div class="gastro-section-label gastro-section-label-premium">PREMIUM · a consultar</div>
      <div class="gastro-premium-list">${premiumHtml}</div>
    </div>`;

  const prev = propuestaState.data.gastroAdicionales || [];
  if (prev.length) {
    container.querySelectorAll('input[type="checkbox"]:not([disabled])').forEach(cb => {
      if (prev.includes(cb.value)) {
        cb.checked = true;
        cb.closest('.gastro-island-row, .gastro-premium-row')?.classList.add('selected');
      }
    });
    if (isAmericano) {
      const count = $('gastro-base-count');
      const grid = $('gastro-extras-grid');
      if (count && grid) {
        const n = grid.querySelectorAll('.gastro-island-row:not(.gastro-island-locked) input[type="checkbox"]:checked').length;
        count.textContent = n;
        const counter = $('gastro-base-counter');
        if (counter) counter.classList.toggle('gastro-counter-full', n >= data.maxBase);
      }
    }
  }

  setupGastroEvents(isAmericano, data.maxBase);
}

function setupGastroEvents(isAmericano, maxBase) {
  const grid = $('gastro-extras-grid');
  if (!grid) return;

  grid.querySelectorAll('.gastro-island-row:not(.gastro-island-locked)').forEach(row => {
    row.addEventListener('click', () => {
      const cb = row.querySelector('input[type="checkbox"]');
      if (isAmericano) {
        const checked = grid.querySelectorAll('.gastro-island-row:not(.gastro-island-locked) input[type="checkbox"]:checked').length;
        if (!cb.checked && checked >= maxBase) return;
        cb.checked = !cb.checked;
        row.classList.toggle('selected', cb.checked);
        const n = grid.querySelectorAll('.gastro-island-row:not(.gastro-island-locked) input[type="checkbox"]:checked').length;
        const count = $('gastro-base-count');
        if (count) count.textContent = n;
        const counter = $('gastro-base-counter');
        if (counter) counter.classList.toggle('gastro-counter-full', n >= maxBase);
      } else {
        const wasChecked = cb.checked;
        grid.querySelectorAll('input[type="checkbox"]').forEach(c => {
          c.checked = false;
          c.closest('.gastro-island-row')?.classList.remove('selected');
        });
        if (!wasChecked) { cb.checked = true; row.classList.add('selected'); }
      }
    });
  });

  $('gastro-slide-content')?.querySelectorAll('.gastro-premium-row').forEach(row => {
    row.addEventListener('click', () => {
      const cb = row.querySelector('input[type="checkbox"]');
      cb.checked = !cb.checked;
      row.classList.toggle('selected', cb.checked);
    });
  });
}

function buildPropuestaResumen() {
  readPropuestaData();
  const d = propuestaState.data;
  const container = $('propuesta-resumen'); if (!container) return;
  const fechaFmt = d.fecha ? formatDate(d.fecha) : '—';
  const infantilStr = d.menuInfantil ? `Sí${d.infantilCant ? ` · ${d.infantilCant} niños` : ''}` : 'No';
  const adicionalesStr = d.adicionales.length ? d.adicionales.join(' · ') : null;
  const gastroStr = d.gastroAdicionales.length ? d.gastroAdicionales.join(' · ') : null;

  container.innerHTML = `
    ${d.nombre ? `<div class="resumen-nombre">${esc(d.nombre)}</div>` : ''}
    <div class="resumen-item">
      <div class="resumen-label">Estilo</div>
      <div class="resumen-value gold">${esc(d.estilo) || '—'}</div>
    </div>
    <div class="resumen-item">
      <div class="resumen-label">Evento</div>
      <div class="resumen-value">${esc(d.tipoEvento) || '—'}${d.agasajado ? ' · ' + esc(d.agasajado) : ''}</div>
    </div>
    <div class="resumen-item">
      <div class="resumen-label">Fecha</div>
      <div class="resumen-value">${fechaFmt}${d.turno ? ' · ' + esc(d.turno) : ''}</div>
    </div>
    <div class="resumen-item">
      <div class="resumen-label">Invitados</div>
      <div class="resumen-value gold">${d.invitados} personas${d.menuInfantil ? ' · Infantil: ' + infantilStr : ''}</div>
    </div>
    <div class="resumen-item full">
      <div class="resumen-label">Espacio</div>
      <div class="resumen-value">${esc(d.espacio) || '—'}</div>
    </div>
    ${gastroStr ? `<div class="resumen-item full">
      <div class="resumen-label">Extras gastronómicos</div>
      <div class="resumen-value">${gastroStr}</div>
    </div>` : ''}
    ${adicionalesStr ? `<div class="resumen-item full">
      <div class="resumen-label">Experiencias & décor</div>
      <div class="resumen-value">${adicionalesStr}</div>
    </div>` : ''}
    ${d.pedidos ? `<div class="resumen-item full">
      <div class="resumen-label">Pedidos especiales</div>
      <div class="resumen-value">${esc(d.pedidos)}</div>
    </div>` : ''}
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

  const gastroTagsHTML = d.gastroAdicionales.length
    ? d.gastroAdicionales.map(a => `<span class="tag">${esc(a)}</span>`).join('') : '';
  const entTagsHTML = d.adicionales.length
    ? d.adicionales.map(a => `<span class="tag">${esc(a)}</span>`).join('') : '';
  const hasAdicionales = gastroTagsHTML || entTagsHTML;

  let secIdx = 2;
  const RN = ['I','II','III','IV','V'];
  const adicSecNum  = hasAdicionales ? RN[secIdx++] : null;
  const jolietSecNum = RN[secIdx];

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
html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
:root{--paper:#FAF7F2;--ink:#1A1A1A;--gold:#9D7E3C;--gold-soft:#C9B27C;--muted:#8B8074;--hairline:#D8CFC0;--warm:#F2EDE3}
body{background:#DDD5C7;font-family:'Inter',sans-serif;color:var(--ink);padding:24px 0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;min-height:297mm;background:var(--paper);margin:0 auto 24px;padding:22mm 20mm;position:relative;overflow:hidden;page-break-after:always}
@page{size:A4;margin:0}
@media print{body{background:white;padding:0}.page{margin:0;box-shadow:none}}
/* COVER */
.cover{padding:0;display:flex;flex-direction:column;justify-content:space-between}
.cover::before{content:'';position:absolute;top:9mm;right:9mm;bottom:9mm;left:9mm;border:.5px solid rgba(157,126,60,.38);pointer-events:none;z-index:1}
.cover::after{content:'';position:absolute;top:11mm;right:11mm;bottom:11mm;left:11mm;border:.5px solid rgba(157,126,60,.18);pointer-events:none;z-index:1}
.cov-top{padding:16mm 20mm 0;text-align:center}
.cov-tag{font-size:9px;letter-spacing:.4em;color:var(--gold);text-transform:uppercase;margin-bottom:14px}
.cov-wm{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:22px;color:var(--ink);margin-top:12px;display:block}
.cov-num{font-size:9px;letter-spacing:.26em;color:var(--muted);text-transform:uppercase;margin-top:5px}
.cov-photo{margin:9mm 20mm 0;height:66mm;background-size:cover;background-position:center;position:relative;overflow:hidden}
.cov-photo::after{content:'';position:absolute;inset:6px;border:1px solid rgba(250,247,242,.32)}
.cov-client{margin:7mm 20mm 0;text-align:center}
.cov-label{font-size:9px;letter-spacing:.3em;color:var(--muted);text-transform:uppercase;margin-bottom:7px}
.cov-name{font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:400;color:var(--ink)}
.cov-meta{display:flex;justify-content:center;gap:20px;margin-top:12px;flex-wrap:wrap}
.meta-item{text-align:center}
.meta-k{display:block;font-size:8px;letter-spacing:.24em;color:var(--muted);text-transform:uppercase;margin-bottom:2px}
.meta-v{display:block;font-family:'Cormorant Garamond',serif;font-size:16px;color:var(--ink)}
.cov-foot{padding:0 20mm 16mm;margin-top:auto;text-align:center;font-size:8.5px;color:var(--muted);letter-spacing:.22em;text-transform:uppercase}
.cov-foot .rule{width:30px;height:1px;background:var(--gold);margin:0 auto 9px}
/* INTERIOR */
.ph{display:flex;justify-content:space-between;align-items:center;padding-bottom:11px;border-bottom:1px solid var(--hairline);margin-bottom:22px}
.ph-wm{font-family:'Cormorant Garamond',serif;font-size:19px;letter-spacing:.14em;font-weight:500}
.ph-folio{font-size:9px;letter-spacing:.16em;color:var(--muted);text-transform:uppercase}
.salut{font-family:'Cormorant Garamond',serif;font-size:19px;font-style:italic;margin-bottom:10px}
.bcopy{font-size:11.5px;line-height:1.7;color:#2A2620;max-width:155mm}
.bcopy p+p{margin-top:7px}
.stitle{margin-top:14mm;margin-bottom:12px;display:flex;align-items:baseline;gap:12px}
.snum{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:13px;color:var(--paper);background:var(--gold);padding:3px 9px 2px;letter-spacing:.08em}
.sname{font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:500;letter-spacing:.02em}
.srule{flex:1;height:1px;background:var(--hairline)}
/* TIMELINE */
.tl{margin-top:4px}
.tl-row{display:grid;grid-template-columns:30px 1fr;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--hairline)}
.tl-row:last-child{border-bottom:none}
.tl-mark{display:flex;flex-direction:column;align-items:center;padding-top:1px}
.tl-dot{width:22px;height:22px;border:1px solid var(--gold);border-radius:50%;background:var(--paper);display:flex;align-items:center;justify-content:center;font-family:'Cormorant Garamond',serif;font-style:italic;font-size:10.5px;color:var(--gold);flex-shrink:0}
.tl-line{width:1px;background:var(--gold-soft);flex:1;min-height:14px;margin-top:2px}
.tl-name{font-family:'Cormorant Garamond',serif;font-size:17px;font-weight:500;letter-spacing:.04em;text-transform:uppercase}
.tl-desc{font-size:10.5px;color:var(--muted);margin-top:1px;line-height:1.45}
/* TAGS */
.tags-wrap{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}
.tag{font-family:'Cormorant Garamond',serif;font-size:12px;letter-spacing:.03em;background:var(--warm);border:1px solid var(--hairline);color:var(--ink);padding:4px 13px}
.add-group-label{font-size:8.5px;letter-spacing:.2em;color:var(--muted);text-transform:uppercase;margin-bottom:3px;margin-top:8px}
/* SERVICES */
.svc-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px 26px;margin-top:5px}
.svc-item{display:flex;align-items:flex-start;gap:9px;padding:6px 0;border-bottom:1px dotted var(--hairline)}
.svc-chk{flex:0 0 15px;height:15px;border:1px solid var(--gold);display:flex;align-items:center;justify-content:center;margin-top:2px}
.svc-chk::after{content:'';width:3px;height:6.5px;border-right:1.5px solid var(--gold);border-bottom:1.5px solid var(--gold);transform:rotate(45deg) translate(-1px,-1px)}
.svc-lbl{font-size:10.5px;color:var(--ink);line-height:1.4}
/* CLOSING */
.closing{margin-top:12mm;text-align:center}
.closing .cl-line{width:44px;height:1px;background:var(--gold);margin:0 auto 12px}
.closing .cl-text{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:15.5px;color:var(--ink);max-width:130mm;margin:0 auto;line-height:1.55}
.closing .cl-sig{font-family:'Cormorant Garamond',serif;font-size:19px;margin-top:16px}
.closing .cl-sig small{display:block;font-family:'Inter',sans-serif;font-size:8.5px;letter-spacing:.24em;color:var(--muted);text-transform:uppercase;margin-top:3px}
.pfoot{position:absolute;bottom:13mm;left:20mm;right:20mm;display:flex;justify-content:space-between;align-items:center;font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.15em;padding-top:9px;border-top:1px solid var(--hairline)}
.ped-box{background:var(--warm);border:1px solid var(--hairline);padding:12px 15px;font-size:11.5px;line-height:1.7;color:#2A2620;margin-top:5px;font-style:italic}
</style>
</head>
<body>

<div class="page cover">
  <div class="cov-top">
    <div class="cov-tag">Salón de Eventos · Ciudad Tesei</div>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="90" height="90" style="display:block;margin:0 auto">
      <circle cx="100" cy="100" r="98" fill="#0f0f0f"/>
      <text x="100" y="113" font-family="'Inter',sans-serif" font-weight="900" font-size="43" fill="white" text-anchor="middle" letter-spacing="2">JOLIET</text>
      <circle cx="112" cy="74" r="3.5" fill="white"/>
      <text x="100" y="136" font-family="'Inter',sans-serif" font-weight="500" font-size="14" fill="white" text-anchor="middle" letter-spacing="6">EVENTOS</text>
    </svg>
    <span class="cov-wm">Propuesta comercial para su evento</span>
    <div class="cov-num">Emitida: ${esc(hoy)}</div>
  </div>

  <div class="cov-photo" style="background-image:linear-gradient(0deg,rgba(26,26,26,.38),rgba(26,26,26,.04)),url('${base}/img/propuesta/portada.jpeg')"></div>

  <div class="cov-client">
    <div class="cov-label">Preparada para</div>
    <div class="cov-name">${esc(d.nombre || d.tipoEvento || 'su evento')}</div>
    <div class="cov-meta">${metaHTML}</div>
  </div>

  <div class="cov-foot">
    <div class="rule"></div>
    Juana Azurduy 531 · Ciudad Tesei · 11 5424 0870 · labartam@gmail.com
  </div>
</div>

<div class="page">
  <div class="ph">
    <div class="ph-wm">Joliet Eventos</div>
    <div class="ph-folio">Propuesta · ${esc(d.nombre || d.tipoEvento || 'evento')} · ${esc(fechaFmt)}</div>
  </div>

  <div class="salut">Estimado/a${d.nombre ? ' ' + esc(d.nombre) + ',' : ','}</div>
  <div class="bcopy">
    <p>Ponemos a su consideración la presente propuesta${d.tipoEvento ? ' para el evento de <strong>' + esc(d.tipoEvento) + '</strong>' : ' para su celebración'}${d.fecha ? ', a realizarse el <strong>' + esc(fechaFmt) + '</strong>' : ''}${d.espacio ? ' en nuestro espacio de <strong>' + esc(d.espacio) + '</strong>' : ' en nuestro salón'}${d.invitados ? ', con una asistencia de <strong>' + d.invitados + ' invitados</strong>' : ''}.</p>
    <p>A continuación encontrará el recorrido de su noche, los adicionales seleccionados y los servicios que hacen de cada evento Joliet una experiencia diferente.</p>
  </div>

  <div class="stitle">
    <span class="snum">I.</span>
    <span class="sname">El recorrido de su noche</span>
    <span class="srule"></span>
  </div>
  <div class="tl">${timelineHTML}</div>

  ${hasAdicionales ? `
  <div class="stitle">
    <span class="snum">${adicSecNum}.</span>
    <span class="sname">Adicionales elegidos</span>
    <span class="srule"></span>
  </div>
  ${gastroTagsHTML ? `<div class="add-group-label">Gastronómicos</div><div class="tags-wrap">${gastroTagsHTML}</div>` : ''}
  ${entTagsHTML ? `<div class="add-group-label">Experiencias &amp; décor</div><div class="tags-wrap">${entTagsHTML}</div>` : ''}
  ` : ''}

  <div class="stitle">
    <span class="snum">${jolietSecNum}.</span>
    <span class="sname">La experiencia Joliet</span>
    <span class="srule"></span>
  </div>
  <div style="font-size:10px;color:var(--muted);margin-bottom:8px;letter-spacing:.04em">Cada evento Joliet incluye, sin excepción</div>
  <div class="svc-grid">
    <div class="svc-item"><span class="svc-chk"></span><span class="svc-lbl">Vajilla de porcelana filete dorado y plato de sitio</span></div>
    <div class="svc-item"><span class="svc-chk"></span><span class="svc-lbl">Maître, mozos, chef, barman y coordinadora general</span></div>
    <div class="svc-item"><span class="svc-chk"></span><span class="svc-lbl">Mantelería a elección y centros de mesa incluidos</span></div>
    <div class="svc-item"><span class="svc-chk"></span><span class="svc-lbl">Cristalería completa y cubertería PATRY</span></div>
    <div class="svc-item"><span class="svc-chk"></span><span class="svc-lbl">Agua, gaseosas, cerveza, vino, sidra y champagne</span></div>
    <div class="svc-item"><span class="svc-chk"></span><span class="svc-lbl">Bar de tragos para la recepción o toda la noche</span></div>
    <div class="svc-item"><span class="svc-chk"></span><span class="svc-lbl">Iluminación de diseño y provisiones completas</span></div>
    <div class="svc-item"><span class="svc-chk"></span><span class="svc-lbl">Coordinación integral y seguimiento personalizado</span></div>
  </div>

  ${d.pedidos ? `
  <div class="stitle" style="margin-top:10mm">
    <span class="sname" style="font-size:19px">Pedidos especiales</span>
    <span class="srule"></span>
  </div>
  <div class="ped-box">${esc(d.pedidos)}</div>` : ''}

  <div class="closing">
    <div class="cl-line"></div>
    <div class="cl-text">Quedamos a su entera disposición para coordinar cada detalle y hacer de esta noche un momento que todos van a recordar.</div>
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
