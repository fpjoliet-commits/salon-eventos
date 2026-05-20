/* ===================== CONFIG ===================== */
const API = '/api';

/* ===================== STATE ===================== */
let currentUser = null;
let token = null;
let allClientes = [];
let allIngresos = [];
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

  // Calendario: visible para superadmin y admin
  const canSeeCalendar = isAdmin() || currentUser.usuario === 'admin';
  document.querySelectorAll('.calendar-access').forEach(el => {
    el.style.display = canSeeCalendar ? '' : 'none';
  });

  loadClientes();
  loadPersonas();
  navigateTo('clientes');
}

/* ===================== NAVIGATION ===================== */
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(item.dataset.view);
  });
});

function navigateTo(view) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  const navItem = document.querySelector(`.nav-item[data-view="${view}"]`);
  const section = $(`view-${view}`);
  if (navItem) navItem.classList.add('active');
  if (section) { section.classList.remove('hidden'); section.classList.add('active'); }

  if (view === 'ingresos' && isAdmin()) loadIngresos();
  if (view === 'calendario') loadCalendario();
  if (view === 'nuevo-cliente' && !$('edit-row-index').value) resetNuevoClienteForm();
  if (view === 'timing-global') initTimingGlobal();
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

  clientes.forEach(c => {
    const tr = document.createElement('tr');
    const segClass = seguimientoClass(c.proximoSeguimiento);
    const recurrente = (c.eventosCount || 1) > 1;
    tr.innerHTML = `
      <td><strong>${c.apellidoNombre || '—'}</strong>${recurrente ? ' <span class="badge-recurrente" title="Esta persona tiene múltiples eventos">↩</span>' : ''}</td>
      <td>${c.telefono || '—'}</td>
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
    const matchEstado = !estado || c.estado === estado;
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

  // Mostrar u ocultar pestaña Timming según rol
  const timmingBtn = $('tab-btn-timming');
  if (canManagePagos()) {
    timmingBtn.classList.remove('hidden');
  } else {
    timmingBtn.classList.add('hidden');
    if (tabInicial === 'timming') tabInicial = 'info';
  }

  // Botones admin-only en modal
  const btnNuevoEvento = $('btn-nuevo-evento');
  const btnEliminar = $('btn-eliminar-cliente');
  if (canManagePagos()) {
    btnNuevoEvento?.classList.remove('hidden');
    btnEliminar?.classList.remove('hidden');
  } else {
    btnNuevoEvento?.classList.add('hidden');
    btnEliminar?.classList.add('hidden');
  }

  activateTab(tabInicial);
  renderClienteDetail(cliente);
  injectNombreAcciones(cliente);
  loadRestriccionesModal(cliente);
  renderPagosTab(cliente);
  loadCuotasTab(cliente);
  if (canManagePagos()) {
    loadTimmingTab(cliente);
    cargarEventosAnteriores(cliente);
  }

  showEl($('modal-overlay'));
}

$('modal-close-btn').addEventListener('click', () => hideEl($('modal-overlay')));
$('modal-overlay').addEventListener('click', e => { if (e.target === $('modal-overlay')) hideEl($('modal-overlay')); });

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
  const form = $('cliente-form');
  form.reset();

  // Setear hidden inputs DESPUÉS del reset para que no los borre
  $('edit-row-index').value = '';
  $('edit-cliente-id').value = '';
  $('edit-persona-id').value = clienteBase.personaId || '';
  $('edit-persona-row-index').value = clienteBase.personaRowIndex || '';

  // Pre-fill datos de persona (solo lectura semántica, el usuario puede cambiarlos)
  const setVal = (name, val) => { if (form[name]) form[name].value = val || ''; };
  setVal('apellidoNombre', clienteBase.apellidoNombre);
  setVal('telefono', clienteBase.telefono);
  setVal('gmail', clienteBase.gmail);
  setVal('redSocial', clienteBase.redSocial);
  setVal('origen', clienteBase.origen);
  setVal('tipoCliente', 'Excliente');

  // Mostrar card de persona seleccionada
  const card = $('persona-seleccionada-card');
  if (card) {
    card.innerHTML = `<div class="persona-card-inner">
      <span class="persona-card-nombre">👤 ${esc(clienteBase.apellidoNombre)}</span>
      <span class="persona-card-sub">${clienteBase.telefono || ''}</span>
    </div>`;
    card.classList.remove('hidden');
  }
  hide('persona-search-section');
  // No mostramos sección de búsqueda porque ya tenemos la persona

  $('form-titulo').textContent = 'Nuevo evento — ' + (clienteBase.apellidoNombre || 'mismo cliente');
  $('tipo-cliente-select').dispatchEvent(new Event('change'));
  $('presupuesto-select').dispatchEvent(new Event('change'));
  actualizarCampoAgasajado();
  navigateTo('nuevo-cliente');
}

function renderClienteDetail(c) {
  $('cliente-detail-grid').innerHTML = `
    <div class="detail-item"><span class="detail-label">Estado</span><span class="detail-value">${estadoBadge(c.estado)}</span></div>
    <div class="detail-item"><span class="detail-label">Cargado por</span><span class="detail-value">${c.cargadoPor || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Teléfono</span><span class="detail-value">${c.telefono || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Gmail</span><span class="detail-value">${c.gmail || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Tipo de evento</span><span class="detail-value">${c.tipoEvento || '—'}</span></div>
    ${c.nombreAgasajado ? `<div class="detail-item"><span class="detail-label">Agasajad@</span><span class="detail-value" style="font-weight:600">${esc(c.nombreAgasajado)}</span></div>` : ''}
    <div class="detail-item"><span class="detail-label">Formato</span><span class="detail-value">${c.formato || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Fecha del evento</span><span class="detail-value">${formatDateWithDay(c.fechaEvento)}</span></div>
    <div class="detail-item"><span class="detail-label">Estado de la fecha</span><span class="detail-value">${c.estadoFecha || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Invitados</span><span class="detail-value">${c.cantidadInvitados || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Turno</span><span class="detail-value">${c.turno || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Tipo de cliente</span><span class="detail-value">${c.tipoCliente || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Origen</span><span class="detail-value">${c.origen || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Presupuesto</span><span class="detail-value">${c.presupuesto || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Monto presupuesto</span><span class="detail-value">${c.montoPresupuesto ? formatMoney(c.montoPresupuesto) : '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Menú infantil</span><span class="detail-value">${c.menuInfantil || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Red social</span><span class="detail-value">${c.redSocial || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Próx. seguimiento</span><span class="detail-value ${seguimientoClass(c.proximoSeguimiento)}">${formatDate(c.proximoSeguimiento)}</span></div>
    <div class="detail-item"><span class="detail-label">Fecha de carga</span><span class="detail-value">${formatDate(c.fechaCarga)}</span></div>
    ${c.exclienteReferencia ? `<div class="detail-item"><span class="detail-label">Ex-cliente ref.</span><span class="detail-value">${c.exclienteReferencia}</span></div>` : ''}
    ${c.exclienteNota ? `<div class="detail-item"><span class="detail-label">Ex-cliente nota</span><span class="detail-value">${c.exclienteNota}</span></div>` : ''}
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
  `;
}

$('btn-editar-cliente').addEventListener('click', () => {
  if (!currentClienteModal) return;
  hideEl($('modal-overlay'));
  openEditForm(currentClienteModal);
});

$('btn-imprimir-cocina').addEventListener('click', async () => {
  if (!currentClienteModal) return;
  let timmingItems = [];
  if (canManagePagos()) {
    try { timmingItems = await apiFetch(`/timming/cliente/${currentClienteModal.id}`); } catch {}
  }
  imprimirFichaCocina(currentClienteModal, currentRestricciones, timmingItems);
});

function imprimirFichaCocina(c, restricciones, timmingItems = []) {
  const restFilas = restricciones.map(r => `
    <div class="rest-fila${r.coronita ? ' rest-fila-vip' : ''}">
      <span class="rest-tipo">${r.coronita ? '👑 ' : ''}${r.tipoRestriccion}</span>
      <span class="rest-cant">${r.cantidad}</span>
    </div>`).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Ficha Cocina — ${c.apellidoNombre}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; color: #111; background: #fff; }
    .pagina { max-width: 720px; margin: 0 auto; padding: 32px 36px; }

    /* CABECERA EVENTO */
    .cabecera { border-bottom: 3px solid #8f2e4d; padding-bottom: 16px; margin-bottom: 24px; }
    .cab-marca { font-size: 12px; text-transform: uppercase; letter-spacing: 2px; color: #8f2e4d; font-weight: 700; margin-bottom: 6px; }
    .cab-cliente { font-size: 26px; font-weight: 700; margin-bottom: 10px; }
    .cab-datos { display: flex; gap: 32px; flex-wrap: wrap; }
    .cab-dato label { font-size: 11px; color: #888; display: block; text-transform: uppercase; letter-spacing: .5px; }
    .cab-dato span { font-size: 15px; font-weight: 600; }
    .cab-num { font-size: 28px !important; color: #8f2e4d; font-weight: 800 !important; }

    /* SECCIÓN COCINA */
    .cocina-header { display: flex; align-items: center; gap: 8px; background: #f5f5f5; border-radius: 8px 8px 0 0; padding: 12px 16px; border: 1px solid #ddd; border-bottom: none; margin-top: 24px; }
    .cocina-icon { font-size: 18px; }
    .cocina-titulo { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
    .cocina-subtitulo { font-size: 11px; color: #888; margin-top: 2px; }
    .cocina-body { border: 1px solid #ddd; border-radius: 0 0 8px 8px; padding: 20px; }

    /* MENÚ INFANTIL */
    .menu-infantil-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #eee; }
    .menu-infantil-label { font-size: 13px; font-weight: 600; }
    .menu-infantil-num { font-size: 36px; font-weight: 800; color: #8f2e4d; background: #f7d6e2; border-radius: 8px; width: 70px; height: 56px; display: flex; align-items: center; justify-content: center; }

    /* RESTRICCIONES */
    .rest-label { font-size: 12px; color: #666; margin-bottom: 10px; text-transform: uppercase; letter-spacing: .5px; }
    .rest-tabla { border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden; margin-bottom: 20px; }
    .rest-cabecera { display: flex; background: #f0f0f0; padding: 8px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #666; border-bottom: 1px solid #ddd; }
    .rest-fila { display: flex; align-items: center; padding: 10px 12px; border-bottom: 1px solid #eee; font-size: 13px; }
    .rest-fila:last-child { border-bottom: none; }
    .rest-fila-vip { background: #fffbea; border-left: 3px solid #f39c12; font-weight: 600; }
    .rest-tipo { flex: 1; }
    .rest-cant { font-weight: 700; font-size: 15px; min-width: 60px; text-align: center; }
    .rest-vacio { padding: 14px 12px; color: #aaa; font-style: italic; font-size: 13px; }

    /* OTROS PEDIDOS */
    .otros-label { font-size: 12px; color: #666; margin-bottom: 8px; text-transform: uppercase; letter-spacing: .5px; }
    .otros-box { border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px 14px; min-height: 70px; font-size: 13px; line-height: 1.5; background: #fafafa; }
    .otros-box.vacio { color: #bbb; font-style: italic; }

    .footer { margin-top: 28px; font-size: 11px; color: #bbb; border-top: 1px solid #eee; padding-top: 10px; text-align: right; }

    /* MENÚ / TIMING */
    .menu-sec-header { display: flex; align-items: center; gap: 8px; background: #f5f5f5; border-radius: 8px 8px 0 0; padding: 12px 16px; border: 1px solid #ddd; border-bottom: none; margin-top: 24px; }
    .menu-sec-titulo { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
    .menu-sec-body { border: 1px solid #ddd; border-radius: 0 0 8px 8px; padding: 20px; }
    .tim-fila { display: flex; align-items: baseline; gap: 18px; padding: 9px 0; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
    .tim-fila:last-child { border-bottom: none; }
    .tim-fila-h { font-weight: 700; color: #8f2e4d; min-width: 50px; font-variant-numeric: tabular-nums; }
    .tim-fila-a { flex: 1; line-height: 1.4; }
    .tim-vacio { color: #bbb; font-style: italic; font-size: 13px; padding: 8px 0; }

    @media print { .pagina { padding: 16px 20px; } }
  </style>
</head>
<body>
<div class="pagina">

  <div class="cabecera">
    <div class="cab-marca">Joliet Eventos — Ficha de Cocina</div>
    <div class="cab-cliente">${c.apellidoNombre || '—'}</div>
    <div class="cab-datos">
      <div class="cab-dato">
        <label>Fecha del evento</label>
        <span>${formatDateWithDay(c.fechaEvento)}</span>
      </div>
      <div class="cab-dato">
        <label>Turno</label>
        <span>${c.turno || '—'}</span>
      </div>
      <div class="cab-dato">
        <label>Tipo de evento</label>
        <span>${c.tipoEvento || '—'}</span>
      </div>
      <div class="cab-dato">
        <label>Invitados</label>
        <span class="cab-num">${c.cantidadInvitados || '—'}</span>
      </div>
    </div>
  </div>

  <div class="cocina-header">
    <span class="cocina-icon">🍴</span>
    <div>
      <div class="cocina-titulo">Pedidos especiales de cocina</div>
      <div class="cocina-subtitulo">Completar cuando el evento esté confirmado y se afinen los detalles.</div>
    </div>
  </div>
  <div class="cocina-body">

    <div class="menu-infantil-row">
      <span class="menu-infantil-label">Menú infantil</span>
      <div class="menu-infantil-num">${c.menuInfantil || '0'}</div>
    </div>

    <div class="rest-label">Restricciones alimentarias${restricciones.some(r => r.coronita) ? ' &nbsp;👑 = Mesa principal' : ''}</div>
    <div class="rest-tabla">
      <div class="rest-cabecera">
        <span style="flex:1">Tipo de restricción</span>
        <span style="min-width:60px;text-align:center">Cantidad</span>
      </div>
      ${restricciones.length ? restFilas : '<div class="rest-vacio">Sin restricciones registradas</div>'}
    </div>

    <div class="otros-label">Otros pedidos</div>
    <div class="otros-box ${c.otrosPedidos ? '' : 'vacio'}">${c.otrosPedidos || 'Sin pedidos especiales'}</div>

    ${c.observaciones ? `
    <div style="margin-top:16px">
      <div class="otros-label">Observaciones</div>
      <div class="otros-box">${c.observaciones}</div>
    </div>` : ''}

  </div>

  ${(c.menuRecepcion || c.menuIslas || c.menuPrimerPlato || c.menuPrincipal || c.menuPostre) ? `
  <div class="menu-sec-header">
    <span class="cocina-icon">🍽️</span>
    <div><div class="menu-sec-titulo">Menú del evento</div></div>
  </div>
  <div class="menu-sec-body">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      ${c.menuRecepcion ? `<tr><td style="padding:7px 0;font-weight:700;color:#8f2e4d;width:120px">Recepción</td><td style="padding:7px 0">${esc(c.menuRecepcion)}</td></tr>` : ''}
      ${c.menuIslas ? `<tr style="border-top:1px solid #f0f0f0"><td style="padding:7px 0;font-weight:700;color:#8f2e4d">Islas</td><td style="padding:7px 0">${esc(c.menuIslas)}</td></tr>` : ''}
      ${c.menuPrimerPlato ? `<tr style="border-top:1px solid #f0f0f0"><td style="padding:7px 0;font-weight:700;color:#8f2e4d">1° plato</td><td style="padding:7px 0">${esc(c.menuPrimerPlato)}</td></tr>` : ''}
      ${c.menuPrincipal ? `<tr style="border-top:1px solid #f0f0f0"><td style="padding:7px 0;font-weight:700;color:#8f2e4d">Principal</td><td style="padding:7px 0">${esc(c.menuPrincipal)}</td></tr>` : ''}
      ${c.menuPostre ? `<tr style="border-top:1px solid #f0f0f0"><td style="padding:7px 0;font-weight:700;color:#8f2e4d">Postre</td><td style="padding:7px 0">${esc(c.menuPostre)}</td></tr>` : ''}
    </table>
  </div>` : ''}

  ${timmingItems.filter(i => (i.tipo || 'maitre') !== 'cocina').length ? `
  <div class="menu-sec-header">
    <span class="cocina-icon">🕐</span>
    <div><div class="menu-sec-titulo">Cronograma del evento</div></div>
  </div>
  <div class="menu-sec-body">
    ${timmingItems.filter(i => (i.tipo || 'maitre') !== 'cocina').map(it => `
      <div class="tim-fila">
        <span class="tim-fila-h">${it.hora}</span>
        <div style="flex:1">
          <span class="tim-fila-a">${esc(it.actividad)}</span>
          ${it.descripcion ? `<div style="font-size:12px;color:#666;margin-top:2px;font-style:italic">${esc(it.descripcion)}</div>` : ''}
        </div>
      </div>`).join('')}
  </div>` : ''}

  <div class="footer">Impreso ${new Date().toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</div>
</div>
<script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}

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

/* ===================== PAGOS ===================== */
function renderPagosTab(cliente) {
  $('pago-id-cliente').value = cliente.id;
  $('pago-fecha').value = new Date().toISOString().split('T')[0];
  hide('pago-error'); hide('pago-success');

  // Historial visible para Super Admin y Admin
  if (canManagePagos()) {
    showEl($('pagos-admin-content'));
    loadPagosCliente(cliente);
    showEl($('pago-form'));
  } else {
    hideEl($('pagos-admin-content'));
    hideEl($('pago-form'));
    $('tab-pagos').querySelector('.no-access-msg')?.remove();
    const msg = document.createElement('p');
    msg.className = 'no-access-msg';
    msg.style.cssText = 'color:#999;font-size:13px;margin-top:12px';
    msg.textContent = 'Solo Super Admin y Admin pueden registrar pagos.';
    $('tab-pagos').appendChild(msg);
  }
}

async function loadPagosCliente(cliente) {
  $('pagos-list').innerHTML = '<p style="color:#999;font-size:13px">Cargando...</p>';
  try {
    const { total, ingresos } = await apiFetch(`/ingresos/totales/${cliente.id}`);
    $('pagos-total').innerHTML = `Total cobrado: ${formatMoney(total)}`;
    if (!ingresos.length) {
      $('pagos-list').innerHTML = '<p style="color:#999;font-size:13px;margin-bottom:12px">Sin ingresos registrados.</p>';
      return;
    }
    $('pagos-list').innerHTML = `<div class="item-list">${ingresos.map(i => `
      <div class="list-item">
        <div class="list-item-info">
          <div class="list-item-label">${i.tipoIngreso} — ${formatMoney(i.monto)}</div>
          <div class="list-item-sub">${formatDate(i.fecha)} · ${i.formaPago}${i.notas ? ' · ' + i.notas : ''}</div>
        </div>
      </div>
    `).join('')}</div>`;
  } catch (e) {
    $('pagos-list').innerHTML = `<p class="error-msg">${e.message}</p>`;
  }
}

$('pago-form').addEventListener('submit', async e => {
  e.preventDefault();
  hide('pago-error'); hide('pago-success');
  const body = {
    idCliente: $('pago-id-cliente').value,
    tipoIngreso: $('pago-tipo').value,
    monto: $('pago-monto').value,
    fecha: $('pago-fecha').value,
    formaPago: $('pago-forma').value,
    notas: $('pago-notas').value,
  };
  try {
    await apiFetch('/ingresos', { method: 'POST', body });
    $('pago-success').textContent = 'Ingreso registrado correctamente.';
    show('pago-success');
    $('pago-form').reset();
    $('pago-fecha').value = new Date().toISOString().split('T')[0];
    if (isAdmin()) loadPagosCliente(currentClienteModal);
  } catch (err) {
    $('pago-error').textContent = err.message;
    show('pago-error');
  }
});

/* ===================== INGRESOS (admin) ===================== */
async function loadIngresos() {
  $('ingresos-loading').style.display = 'block';
  hide('ingresos-content');
  hide('ingresos-error');
  try {
    allIngresos = await apiFetch('/ingresos');
    applyIngresosFilters();
  } catch (e) {
    $('ingresos-error').textContent = e.message;
    show('ingresos-error');
  } finally {
    $('ingresos-loading').style.display = 'none';
  }
}

function applyIngresosFilters() {
  const search = $('ingresos-search')?.value.toLowerCase() || '';
  const tipo = $('ingresos-filter-tipo')?.value || '';
  const forma = $('ingresos-filter-forma')?.value || '';
  const clienteMap = {};
  allClientes.forEach(c => { clienteMap[c.id] = c.apellidoNombre; });

  const filtrados = allIngresos.filter(i => {
    const nombre = (clienteMap[i.idCliente] || '').toLowerCase();
    const matchSearch = !search || nombre.includes(search);
    const matchTipo = !tipo || (i.tipoIngreso || '').startsWith(tipo === 'Cuota' ? 'Cuota' : tipo);
    const matchForma = !forma || i.formaPago === forma;
    return matchSearch && matchTipo && matchForma;
  });

  renderIngresos(filtrados, clienteMap);
}

function renderIngresos(ingresos, clienteMap) {
  if (!clienteMap) {
    clienteMap = {};
    allClientes.forEach(c => { clienteMap[c.id] = c.apellidoNombre; });
  }
  const total = ingresos.reduce((s, i) => s + (parseFloat(i.monto) || 0), 0);
  $('ingresos-stats').innerHTML = `
    <div class="stat-card"><div class="stat-label">Total filtrado</div><div class="stat-value verde">${formatMoney(total)}</div></div>
    <div class="stat-card"><div class="stat-label">Registros</div><div class="stat-value">${ingresos.length}</div></div>
    <div class="stat-card"><div class="stat-label">Total general</div><div class="stat-value">${formatMoney(allIngresos.reduce((s,i)=>s+(parseFloat(i.monto)||0),0))}</div></div>
  `;

  const tbody = $('ingresos-tbody');
  tbody.innerHTML = ingresos.slice().reverse().map(i => `
    <tr style="cursor:pointer" onclick="openClienteModalById('${i.idCliente}')">
      <td><strong>${clienteMap[i.idCliente] || i.idCliente}</strong></td>
      <td>${i.tipoIngreso}</td>
      <td><strong>${formatMoney(i.monto)}</strong></td>
      <td>${formatDate(i.fecha)}</td>
      <td>${i.formaPago || '—'}</td>
      <td>${i.notas || '—'}</td>
    </tr>
  `).join('');

  show('ingresos-content');
}

window.openClienteModalById = (id) => {
  const c = allClientes.find(cl => cl.id === id);
  if (c) openClienteModal(c, 'pagos');
};

$('ingresos-search')?.addEventListener('input', applyIngresosFilters);
$('ingresos-filter-tipo')?.addEventListener('change', applyIngresosFilters);
$('ingresos-filter-forma')?.addEventListener('change', applyIngresosFilters);

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
    cells += `<div class="cal-cell${isToday ? ' cal-cell-today' : ''}">
      <span class="cal-cell-num${isToday ? ' cal-num-today' : ''}">${d}</span>
      ${evs.map(c => {
        const sub = [c.tipoEvento, c.cantidadInvitados ? `${c.cantidadInvitados} PAX` : ''].filter(Boolean).join(' · ');
        return `<div class="cal-pill ${pillClass[c.estado] || ''}" onclick="openClienteModal(window._cmap['${c.id}'])" title="${c.apellidoNombre}${c.turno ? ' · '+c.turno : ''}">
          <div class="cal-pill-nombre">${c.apellidoNombre}</div>
          ${sub ? `<div class="cal-pill-sub">${sub}</div>` : ''}
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
}

/* ===================== FORM CLIENTE ===================== */
$('tipo-cliente-select').addEventListener('change', () => {
  const v = $('tipo-cliente-select').value;
  $('excliente-ref-group').style.display = (v === 'Excliente' || v === 'Referido') ? '' : 'none';
  $('excliente-nota-group').style.display = v === 'Excliente' ? '' : 'none';
});

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
  show('persona-search-section');
  const card = $('persona-seleccionada-card');
  if (card) { card.classList.add('hidden'); card.innerHTML = ''; }
  const results = $('persona-search-results');
  if (results) { results.classList.add('hidden'); results.innerHTML = ''; }
  const searchInput = $('persona-search-input');
  if (searchInput) searchInput.value = '';
  $('persona-search-clear')?.classList.add('hidden');
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
    const duplicado = allPersonas.find(p => p.gmail && p.gmail.toLowerCase() === gmail);
    if (duplicado) {
      $('form-error').textContent = `Ya existe un cliente con ese Gmail: "${duplicado.apellidoNombre}". Buscalo en el campo de búsqueda de arriba ("¿Es un cliente que ya consultó antes?") para cargarle un nuevo evento.`;
      show('form-error');
      return;
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
    redSocial: form.redSocial.value,
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
    menuInfantil: form.menuInfantil.value,
    otrosPedidos: form.otrosPedidos.value,
    observaciones: form.observaciones.value,
    proximoSeguimiento: form.proximoSeguimiento.value,
    menuRecepcion: form.menuRecepcion.value,
    menuIslas: form.menuIslas.value,
    menuPrimerPlato: form.menuPrimerPlato.value,
    menuPrincipal: form.menuPrincipal.value,
    menuPostre: form.menuPostre.value,
    nombreAgasajado: form.nombreAgasajado.value,
    cargadoPor: currentUser.usuario,
  };

  try {
    if (isEdit) {
      await apiFetch(`/clientes/${rowIndex}`, { method: 'PUT', body });
    } else {
      await apiFetch('/clientes', { method: 'POST', body });
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
  setVal('redSocial', cliente.redSocial);
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
  setVal('menuInfantil', cliente.menuInfantil);
  setVal('otrosPedidos', cliente.otrosPedidos);
  setVal('observaciones', cliente.observaciones);
  setVal('proximoSeguimiento', cliente.proximoSeguimiento);
  setVal('menuRecepcion', cliente.menuRecepcion);
  setVal('menuIslas', cliente.menuIslas);
  setVal('menuPrimerPlato', cliente.menuPrimerPlato);
  setVal('menuPrincipal', cliente.menuPrincipal);
  setVal('menuPostre', cliente.menuPostre);
  setVal('nombreAgasajado', cliente.nombreAgasajado);

  $('tipo-cliente-select').dispatchEvent(new Event('change'));
  $('presupuesto-select').dispatchEvent(new Event('change'));
  document.querySelector('[name="tipoEvento"]')?.dispatchEvent(new Event('change'));
  navigateTo('nuevo-cliente');
}

/* ===================== CUOTAS ===================== */
async function loadCuotasTab(cliente) {
  const con = $('cuotas-content');
  if (!con) return;
  if (!canManagePagos()) {
    con.innerHTML = '<p style="color:#999;font-size:13px;margin-top:12px">Solo Super Admin y Admin pueden gestionar el plan de pagos.</p>';
    return;
  }
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

  // Detectar moneda del plan (todas las cuotas del plan tienen la misma)
  const moneda = cuotas[0]?.moneda || 'ARS';
  const esUSD = moneda === 'USD';

  const totalContrato = cuotas.reduce((s, c) => s + c.valorOriginal, 0);
  const totalPagado = pagadas.reduce((s, c) => s + c.montoPagado, 0);
  const saldoPendiente = pendientes.reduce((s, c) => s + c.valorActual, 0);
  const valorCuotaActual = pendientes.length ? pendientes[0].valorActual : (pagadas[pagadas.length - 1]?.montoPagado || 0);

  con.innerHTML = `
    ${esUSD ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <span style="background:var(--gold-light);border:1px solid var(--gold-border);color:#7a5c10;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;letter-spacing:.04em">U$S PLAN EN DÓLARES</span>
    </div>` : ''}

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
          ${!esUSD ? `
            <input type="number" id="ipc-pct" placeholder="IPC %" min="0" max="100" step="0.1" style="width:90px">
            <span class="tip" data-tip="Ingresá el porcentaje de aumento (ej: 8.4 para un 8,4%). Solo se actualizan las cuotas PENDIENTES. Las ya cobradas no cambian.">?</span>
            <button class="btn btn-sm btn-secondary" id="btn-ipc">Actualizar por IPC</button>
          ` : ''}
          <button class="btn btn-sm btn-secondary" id="btn-ajustar-val">Fijar valor</button>
          <input type="number" id="nuevo-valor" placeholder="Nuevo valor ${esUSD ? 'U$S' : '$'}" min="0" style="width:130px">
          <span class="tip" data-tip="Fijá un importe exacto para todas las cuotas pendientes, reemplazando el valor actual.">?</span>
        </div>
      ` : ''}
      ${isAdmin() ? `<button class="btn btn-sm btn-danger" id="btn-reset-plan" style="margin-left:auto">Borrar plan</button>` : ''}
    </div>

    <div id="fecha-pago-row" class="hidden" style="margin:10px 0;flex-wrap:wrap;display:flex;gap:10px;align-items:center">
      <label style="font-size:13px;font-weight:600">Fecha:</label>
      <input type="date" id="fecha-pago-input" value="${new Date().toISOString().split('T')[0]}" style="width:150px">
      <select id="forma-pago-cuota" style="width:160px">
        <option value="">Forma de pago...</option>
        <option>Efectivo</option>
        <option>Transferencia</option>
        <option>Cheque</option>
        <option>Mercado Pago</option>
        <option>USD</option>
        <option>Otro</option>
      </select>
      <input type="text" id="notas-pago-input" placeholder="Notas (opcional)" style="flex:1;min-width:120px">
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
      }});
      loadCuotasTab(cliente);
    } catch (err) { alert(err.message); btn.disabled = false; }
  });
}

function bindCuotasAcciones(cliente, cuotas, moneda = 'ARS') {
  // Pagar seleccionadas
  $('btn-pagar-sel')?.addEventListener('click', () => {
    const checked = document.querySelectorAll('.cuota-check:checked');
    if (!checked.length) { alert('Seleccioná al menos una cuota.'); return; }
    const row = $('fecha-pago-row');
    row.style.display = 'flex';
    row.classList.remove('hidden');
  });

  $('btn-cancelar-pago')?.addEventListener('click', () => {
    $('fecha-pago-row').style.display = 'none';
    document.querySelectorAll('.cuota-check').forEach(c => { c.checked = false; });
  });

  $('btn-confirmar-pago')?.addEventListener('click', async () => {
    const checked = [...document.querySelectorAll('.cuota-check:checked')];
    if (!checked.length) return;
    const rowIndices = checked.map(c => parseInt(c.dataset.row));
    const numeros = checked.map(c => c.dataset.num);
    const montoTotal = checked.reduce((s, c) => s + (parseFloat(c.dataset.valor) || 0), 0);
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
        descripcion,
      }});
      loadCuotasTab(cliente);
    } catch (err) { alert(err.message); }
  });

  // IPC
  $('btn-ipc')?.addEventListener('click', async () => {
    const pct = parseFloat($('ipc-pct').value);
    if (!pct || pct <= 0) { alert('Ingresá un porcentaje válido.'); return; }
    if (!confirm(`¿Aplicar ${pct}% de IPC a todas las cuotas pendientes?`)) return;
    try {
      const r = await apiFetch('/cuotas/ipc', { method: 'PUT', body: { idCliente: cliente.id, porcentaje: pct } });
      alert(`IPC aplicado a ${r.updated} cuota(s).`);
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
    'Variedad de triples de miga',
  ],
  brochettes: [
    'Criolla de carne', 'Italiana', 'Criolla de pollo',
  ],
  empanaditas: [
    'Fatay de carne', 'Soles de calabaza y semillas grilladas', 'Canastitas de batata y almendra',
    'Jamón y queso', 'Cebolla y queso', 'Paquetitos de boniato y amapola', 'Pollo', 'Fingers de zanahoria',
  ],
  calientesOtros: [
    'Daditos de mozzarella', 'Mini hamburguesas caseras', 'Pollo frito (Buffalo wings)', 'Azteca',
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
  'Mesa de fiambres', 'Tabla de quesos', 'Bruschettas', 'Pastas en vivo', 'Mariscos',
  'Mesa de picada', 'Ensaladas', 'Sushi', 'Arrollados', 'Croquetas de papa',
];
const PLATO_CENTRAL_AVE_OPT = [
  'Pechuga tradición', 'Pechuga caprese', 'Pechuga doble puerro',
];
const PLATO_CENTRAL_CARNE_OPT = [
  'Lomo Reserva', 'Bife del bosque', 'Lomo Dijon',
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
    const items = await apiFetch(`/timming/cliente/${cliente.id}`);
    renderTimming(cliente, items);
  } catch (e) {
    con.innerHTML = `<p style="color:#c0392b;font-size:13px">${e.message}</p>`;
  }
}

function renderTimming(cliente, items) {
  const con = $('timming-content');
  if (!con) return;

  const maitreItems = items.filter(i => (i.tipo || 'maitre') !== 'cocina');
  const cocinaItem = items.find(i => i.tipo === 'cocina');

  con.innerHTML = `
    <div class="tim-subtabs">
      <button class="tim-subtab-btn active" data-subtab="maitre">Timing Maitre</button>
      <button class="tim-subtab-btn" data-subtab="cocina">Timing Cocina</button>
    </div>
    <div id="tim-panel-maitre" class="tim-panel"></div>
    <div id="tim-panel-cocina" class="tim-panel" style="display:none"></div>`;

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
          <input type="time" id="tim-hora" required>
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

  document.querySelectorAll('.btn-tim-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.tim-item');
      const rowIndex = parseInt(row.dataset.row);
      const item = items.find(i => i.rowIndex === rowIndex);
      if (!item) return;
      row.innerHTML = `
        <input type="time" class="tim-edit-hora" value="${item.hora}">
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
      row.querySelector('.tim-edit-hora').focus();

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
    platoCentralCarne: $('coc-plato-carne')?.value || '',
    horaMesaDulces: $('coc-hora-mesa-dulces')?.value || '',
    mesaDulces: getChecked('coc-dulce'),
    postre: $('coc-postre')?.value.trim() || '',
    horaCafeteria: $('coc-hora-cafeteria')?.value || '',
    cafeteria: $('coc-cafeteria')?.checked || false,
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
  if ($('coc-hora-recepcion')) $('coc-hora-recepcion').value = d.horaRecepcion || '';
  setChecked('coc-canape', d.canapes);
  setChecked('coc-bruschetta', d.bruschettas);
  setChecked('coc-rf-otros', d.recepcionOtros);
  setChecked('coc-brochette', d.brochettes);
  setChecked('coc-empanadita', d.empanaditas);
  setChecked('coc-rc-otros', d.calientesOtros);
  if ($('coc-hora-islas')) $('coc-hora-islas').value = d.horaIslas || '';
  setChecked('coc-isla', d.islas);
  if ($('coc-isla-extra')) $('coc-isla-extra').value = '';
  if ($('coc-hora-primer-plato')) $('coc-hora-primer-plato').value = d.horaPrimerPlato || '';
  setChecked('coc-pasta', d.pastas);
  setChecked('coc-pasta-gourmet', d.pastasGourmet);
  if ($('coc-nsalsas')) $('coc-nsalsas').value = d.cantidadSalsas || '';
  setChecked('coc-salsa', d.salsas);
  setChecked('coc-salsa-gourmet', d.salsasGourmet);
  if ($('coc-hora-plato-central')) $('coc-hora-plato-central').value = d.horaPlatoCentral || '';
  if ($('coc-plato-ave')) $('coc-plato-ave').value = d.platoCentralAve || '';
  if ($('coc-plato-carne')) $('coc-plato-carne').value = d.platoCentralCarne || '';
  if ($('coc-hora-mesa-dulces')) $('coc-hora-mesa-dulces').value = d.horaMesaDulces || '';
  setChecked('coc-dulce', d.mesaDulces);
  if ($('coc-postre')) $('coc-postre').value = d.postre || '';
  if ($('coc-hora-cafeteria')) $('coc-hora-cafeteria').value = d.horaCafeteria || '';
  if ($('coc-cafeteria')) $('coc-cafeteria').checked = !!d.cafeteria;
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
      <input type="time" id="${horaId}" class="coc-hora" value="${horaVal || ''}">
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
            <select id="coc-plato-ave" class="coc-select">
              <option value="">-- Ninguna --</option>
              ${PLATO_CENTRAL_AVE_OPT.map(p => `<option${cocinaData.platoCentralAve === p ? ' selected' : ''}>${esc(p)}</option>`).join('')}
            </select>
          </div>
          <div style="flex:1">
            <div class="coc-group-label" style="margin-bottom:6px">Base Carne</div>
            <select id="coc-plato-carne" class="coc-select">
              <option value="">-- Ninguna --</option>
              ${PLATO_CENTRAL_CARNE_OPT.map(p => `<option${cocinaData.platoCentralCarne === p ? ' selected' : ''}>${esc(p)}</option>`).join('')}
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
        <label class="coc-check" style="margin-bottom:10px;font-size:13px">
          <input type="checkbox" id="coc-cafeteria" ${cocinaData.cafeteria ? 'checked' : ''}> Incluye servicio de café
        </label>
        <div class="coc-group-label" style="margin-top:6px">Fin de fiesta</div>
        <div class="coc-checks">${chk('coc-fin-fiesta', FIN_FIESTA_OPT, cocinaData.finFiesta)}</div>
      </div>

      <div id="coc-msg" style="font-size:13px;margin-top:8px;min-height:20px"></div>
    </div>`;

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
  const lista = (arr) => arr && arr.length ? arr.map(i => `<li>${esc(i)}</li>`).join('') : '<li style="color:#aaa">—</li>';
  const secTit = (titulo, hora) =>
    `<div class="sec-title">${titulo}${hora ? `<span class="sec-hora">${hora}</span>` : ''}</div>`;
  const restricFilas = (restricciones || []).map(r => `
    <tr>
      <td style="padding:8px 12px;font-size:13px">${r.coronita ? '👑 ' : ''}${esc(r.tipoRestriccion)}</td>
      <td style="padding:8px 12px;font-size:13px;font-weight:700;text-align:center">${r.cantidad}</td>
    </tr>`).join('');

  const todasPastas = [...(d.pastas || []), ...(d.pastasGourmet || [])];
  const todasSalsas = [...(d.salsas || []), ...(d.salsasGourmet || [])];

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Timing Cocina — ${esc(cliente.apellidoNombre)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111; background: #fff; }
    .pagina { max-width: 720px; margin: 0 auto; padding: 32px 36px; }
    .marca { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #8f2e4d; font-weight: 700; margin-bottom: 6px; }
    .cliente { font-size: 24px; font-weight: 700; margin-bottom: 10px; }
    .cab-datos { display: flex; gap: 28px; flex-wrap: wrap; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 3px solid #8f2e4d; }
    .cab-dato label { font-size: 10px; color: #888; display: block; text-transform: uppercase; letter-spacing: .5px; }
    .cab-dato span { font-size: 14px; font-weight: 600; }
    .cab-num { font-size: 26px !important; color: #8f2e4d; }
    .sec { margin-top: 20px; }
    .sec-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #8f2e4d; border-bottom: 2px solid #8f2e4d; padding-bottom: 5px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
    .sec-hora { font-size: 16px; font-weight: 800; color: #8f2e4d; letter-spacing: 0; font-variant-numeric: tabular-nums; }
    .sub-title { font-size: 11px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: .5px; margin: 10px 0 4px; }
    ul { padding-left: 18px; }
    ul li { padding: 3px 0; font-size: 13px; }
    .row-pair { display: flex; gap: 16px; }
    .row-pair > div { flex: 1; }
    table { width: 100%; border-collapse: collapse; }
    thead th { background: #f5f5f5; padding: 8px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #666; text-align: left; border-bottom: 1px solid #ddd; }
    tbody tr { border-bottom: 1px solid #eee; }
    tbody tr:last-child { border-bottom: none; }
    .footer { margin-top: 28px; font-size: 10px; color: #bbb; border-top: 1px solid #eee; padding-top: 10px; text-align: right; }
    @media print { .pagina { padding: 16px 20px; } }
  </style>
</head>
<body>
<div class="pagina">
  <div class="marca">Joliet Eventos — Timing Cocina</div>
  <div class="cliente">${esc(cliente.apellidoNombre) || '—'}</div>
  <div class="cab-datos">
    <div class="cab-dato"><label>Fecha</label><span>${formatDateWithDay(cliente.fechaEvento)}</span></div>
    <div class="cab-dato"><label>Turno</label><span>${esc(cliente.turno || '—')}</span></div>
    <div class="cab-dato"><label>Tipo</label><span>${esc(cliente.tipoEvento || '—')}</span></div>
    <div class="cab-dato"><label>Invitados</label><span class="cab-num">${cliente.cantidadInvitados || '—'}</span></div>
    <div class="cab-dato"><label>Menú infantil</label><span class="cab-num">${cliente.menuInfantil || '0'}</span></div>
  </div>

  <div class="sec">
    <div class="sec-title">Restricciones alimentarias</div>
    <table>
      <thead><tr><th>Tipo</th><th style="text-align:center;width:80px">Cantidad</th></tr></thead>
      <tbody>${restricFilas || '<tr><td colspan="2" style="padding:10px 12px;color:#aaa;font-style:italic">Sin restricciones registradas</td></tr>'}</tbody>
    </table>
  </div>

  <div class="sec">
    ${secTit('Recepción', d.horaRecepcion)}
    <div class="row-pair">
      <div>
        <div class="sub-title">Canapés</div><ul>${lista(d.canapes)}</ul>
        <div class="sub-title">Bruschettas</div><ul>${lista(d.bruschettas)}</ul>
        ${d.recepcionOtros && d.recepcionOtros.length ? `<div class="sub-title">Otros fríos</div><ul>${lista(d.recepcionOtros)}</ul>` : ''}
      </div>
      <div>
        <div class="sub-title">Brochettes</div><ul>${lista(d.brochettes)}</ul>
        <div class="sub-title">Mini Empanaditas</div><ul>${lista(d.empanaditas)}</ul>
        ${d.calientesOtros && d.calientesOtros.length ? `<div class="sub-title">Otros calientes</div><ul>${lista(d.calientesOtros)}</ul>` : ''}
      </div>
    </div>
  </div>

  <div class="sec">
    ${secTit('Islas', d.horaIslas)}
    <ul>${lista(d.islas)}</ul>
  </div>

  <div class="sec">
    ${secTit('Primer Plato — Mesa Italiana', d.horaPrimerPlato)}
    ${todasPastas.length ? `
      <div class="sub-title">Pastas</div>
      <ul>${lista(todasPastas)}</ul>
      ${d.cantidadSalsas ? `<p style="margin:8px 0 4px;font-size:12px"><strong>Cant. de salsas: ${d.cantidadSalsas}</strong></p>` : ''}
      <div class="sub-title">Salsas</div>
      <ul>${lista(todasSalsas)}</ul>
    ` : '<p style="color:#aaa;font-style:italic">Sin primer plato</p>'}
  </div>

  <div class="sec">
    ${secTit('Plato Central', d.horaPlatoCentral)}
    <div class="row-pair">
      <div><div class="sub-title">Base Ave</div><p style="padding:4px 0">${esc(d.platoCentralAve || '—')}</p></div>
      <div><div class="sub-title">Base Carne</div><p style="padding:4px 0">${esc(d.platoCentralCarne || '—')}</p></div>
    </div>
  </div>

  <div class="sec">
    ${secTit('Mesa de Dulces', d.horaMesaDulces)}
    <ul>${lista(d.mesaDulces)}</ul>
    ${d.postre ? `<p style="margin-top:8px;font-size:12px"><strong>Postre/Torta:</strong> ${esc(d.postre)}</p>` : ''}
  </div>

  <div class="sec">
    ${secTit('Cafetería / Fin de Fiesta', d.horaCafeteria)}
    <p style="margin-bottom:8px">${d.cafeteria ? 'Incluye servicio de café' : 'Sin servicio de café'}</p>
    ${d.finFiesta && d.finFiesta.length ? `<ul>${lista(d.finFiesta)}</ul>` : ''}
  </div>

  <div class="footer">Impreso ${new Date().toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</div>
</div>
<script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}

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
