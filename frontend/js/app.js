/* ===================== CONFIG ===================== */
const API = '/api';

/* ===================== STATE ===================== */
let currentUser = null;
let token = null;
let allClientes = [];
let allIngresos = [];
let currentClienteModal = null;
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
function canManagePagos() { return isAdmin() || currentUser?.usuario === 'Mariana'; }

// Usuarios sin contraseña
const USUARIOS_SIN_PASSWORD = ['Anita'];

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

  // Calendario: visible para Fabio y Mariana
  const canSeeCalendar = isAdmin() || currentUser.usuario === 'Mariana';
  document.querySelectorAll('.calendar-access').forEach(el => {
    el.style.display = canSeeCalendar ? '' : 'none';
  });

  loadClientes();
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
}

/* ===================== CLIENTES ===================== */
async function loadClientes() {
  $('clientes-loading').style.display = 'block';
  hide('clientes-table-wrap');
  hide('clientes-error');
  hide('clientes-empty');

  try {
    allClientes = await apiFetch('/clientes');
    renderClientes(allClientes);
  } catch (err) {
    $('clientes-error').textContent = err.message;
    show('clientes-error');
  } finally {
    $('clientes-loading').style.display = 'none';
  }
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
    tr.innerHTML = `
      <td><strong>${c.apellidoNombre || '—'}</strong></td>
      <td>${c.telefono || '—'}</td>
      <td>${c.tipoEvento || '—'}</td>
      <td>${formatDateWithDay(c.fechaEvento)}</td>
      <td>${estadoBadge(c.estado)}</td>
      <td class="${segClass}">${formatDate(c.proximoSeguimiento)}</td>
      <td>${c.origen || '—'}</td>
      <td><button class="btn btn-sm btn-secondary">Ver</button></td>
    `;
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
function openClienteModal(cliente) {
  currentClienteModal = cliente;
  $('modal-titulo').textContent = cliente.apellidoNombre || 'Cliente';

  activateTab('info');
  renderClienteDetail(cliente);
  loadRestriccionesModal(cliente);
  renderPagosTab(cliente);
  loadCuotasTab(cliente);

  showEl($('modal-overlay'));
}

$('modal-close-btn').addEventListener('click', () => hideEl($('modal-overlay')));
$('modal-overlay').addEventListener('click', e => { if (e.target === $('modal-overlay')) hideEl($('modal-overlay')); });

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

function activateTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${name}`));
}

function renderClienteDetail(c) {
  $('cliente-detail-grid').innerHTML = `
    <div class="detail-item"><span class="detail-label">Estado</span><span class="detail-value">${estadoBadge(c.estado)}</span></div>
    <div class="detail-item"><span class="detail-label">Cargado por</span><span class="detail-value">${c.cargadoPor || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Teléfono</span><span class="detail-value">${c.telefono || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Gmail</span><span class="detail-value">${c.gmail || '—'}</span></div>
    <div class="detail-item"><span class="detail-label">Tipo de evento</span><span class="detail-value">${c.tipoEvento || '—'}</span></div>
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
    ${c.otrosPedidos ? `<div class="detail-item detail-full"><span class="detail-label">Otros pedidos</span><span class="detail-value">${c.otrosPedidos}</span></div>` : ''}
    ${c.observaciones ? `<div class="detail-item detail-full"><span class="detail-label">Observaciones</span><span class="detail-value">${c.observaciones}</span></div>` : ''}
  `;
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
    renderRestriccionesList(data);
  } catch (e) {
    $('restricciones-list').innerHTML = `<p class="error-msg">${e.message}</p>`;
  }
}

function renderRestriccionesList(lista) {
  if (!lista.length) {
    $('restricciones-list').innerHTML = '<p style="color:#999;font-size:13px;margin-bottom:12px">Sin restricciones registradas.</p>';
    return;
  }
  $('restricciones-list').innerHTML = `<div class="item-list">${lista.map(r => `
    <div class="list-item">
      <div class="list-item-info">
        <div class="list-item-label">${r.tipoRestriccion}</div>
        <div class="list-item-sub">Cantidad: ${r.cantidad}</div>
      </div>
      <button class="btn btn-sm btn-danger" onclick="deleteRestriccion(${r.rowIndex})">✕</button>
    </div>
  `).join('')}</div>`;
}

window.deleteRestriccion = async (rowIndex) => {
  if (!confirm('¿Eliminar esta restricción?')) return;
  try {
    await apiFetch(`/restricciones/${rowIndex}`, { method: 'DELETE' });
    loadRestriccionesModal(currentClienteModal);
  } catch (e) { alert(e.message); }
};

$('restriccion-form').addEventListener('submit', async e => {
  e.preventDefault();
  const idCliente = $('rest-id-cliente').value;
  const tipoRestriccion = $('rest-tipo').value;
  const cantidad = $('rest-cantidad').value;
  try {
    await apiFetch('/restricciones', { method: 'POST', body: { idCliente, tipoRestriccion, cantidad } });
    $('rest-tipo').value = ''; $('rest-cantidad').value = '';
    loadRestriccionesModal(currentClienteModal);
  } catch (e) { alert(e.message); }
});

/* ===================== PAGOS ===================== */
function renderPagosTab(cliente) {
  $('pago-id-cliente').value = cliente.id;
  $('pago-fecha').value = new Date().toISOString().split('T')[0];
  hide('pago-error'); hide('pago-success');

  if (isAdmin()) {
    showEl($('pagos-admin-content'));
    loadPagosCliente(cliente);
  } else {
    hideEl($('pagos-admin-content'));
  }

  if (canManagePagos()) {
    showEl($('pago-form'));
  } else {
    hideEl($('pago-form'));
    $('tab-pagos').querySelector('.no-access-msg')?.remove();
    const msg = document.createElement('p');
    msg.className = 'no-access-msg';
    msg.style.cssText = 'color:#999;font-size:13px;margin-top:12px';
    msg.textContent = 'Solo Fabio y Mariana pueden registrar pagos.';
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
    renderIngresos(allIngresos);
  } catch (e) {
    $('ingresos-error').textContent = e.message;
    show('ingresos-error');
  } finally {
    $('ingresos-loading').style.display = 'none';
  }
}

function renderIngresos(ingresos) {
  const total = ingresos.reduce((s, i) => s + (parseFloat(i.monto) || 0), 0);
  $('ingresos-stats').innerHTML = `
    <div class="stat-card"><div class="stat-label">Total ingresos</div><div class="stat-value verde">${formatMoney(total)}</div></div>
    <div class="stat-card"><div class="stat-label">Registros</div><div class="stat-value">${ingresos.length}</div></div>
  `;

  const clienteMap = {};
  allClientes.forEach(c => { clienteMap[c.id] = c.apellidoNombre; });

  const tbody = $('ingresos-tbody');
  tbody.innerHTML = ingresos.slice().reverse().map(i => `
    <tr>
      <td>${clienteMap[i.idCliente] || i.idCliente}</td>
      <td>${i.tipoIngreso}</td>
      <td><strong>${formatMoney(i.monto)}</strong></td>
      <td>${formatDate(i.fecha)}</td>
      <td>${i.formaPago}</td>
      <td>${i.notas || '—'}</td>
    </tr>
  `).join('');

  show('ingresos-content');
}

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
      ${evs.map(c => `<div class="cal-pill ${pillClass[c.estado] || ''}" onclick="openClienteModal(window._cmap['${c.id}'])" title="${c.apellidoNombre}${c.tipoEvento ? ' — '+c.tipoEvento : ''}${c.turno ? ' · '+c.turno : ''}">${c.apellidoNombre}</div>`).join('')}
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

$('presupuesto-select').addEventListener('change', () => {
  $('monto-group').style.display = $('presupuesto-select').value === 'Sí, tiene monto' ? '' : 'none';
});

$('cancel-form-btn').addEventListener('click', () => navigateTo('clientes'));

$('cliente-form').addEventListener('submit', async e => {
  e.preventDefault();
  hide('form-error'); hide('form-success');
  $('submit-cliente-btn').disabled = true;

  const form = $('cliente-form');
  const rowIndex = $('edit-row-index').value;
  const isEdit = !!rowIndex;

  const body = {
    id: $('edit-cliente-id').value || undefined,
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
  };

  try {
    if (isEdit) {
      await apiFetch(`/clientes/${rowIndex}`, { method: 'PUT', body });
    } else {
      await apiFetch('/clientes', { method: 'POST', body });
    }
    $('form-success').textContent = isEdit ? 'Cliente actualizado.' : 'Cliente guardado.';
    show('form-success');
    form.reset();
    $('edit-row-index').value = '';
    $('edit-cliente-id').value = '';
    $('form-titulo').textContent = 'Nuevo cliente';
    await loadClientes();
    setTimeout(() => navigateTo('clientes'), 1000);
  } catch (err) {
    $('form-error').textContent = err.message;
    show('form-error');
  } finally {
    $('submit-cliente-btn').disabled = false;
  }
});

function openEditForm(cliente) {
  $('form-titulo').textContent = 'Editar cliente';
  $('edit-row-index').value = cliente.rowIndex;
  $('edit-cliente-id').value = cliente.id;

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

  // Trigger conditional displays
  $('tipo-cliente-select').dispatchEvent(new Event('change'));
  $('presupuesto-select').dispatchEvent(new Event('change'));

  navigateTo('nuevo-cliente');
}

/* ===================== CUOTAS ===================== */
async function loadCuotasTab(cliente) {
  const con = $('cuotas-content');
  if (!con) return;
  if (!canManagePagos()) {
    con.innerHTML = '<p style="color:#999;font-size:13px;margin-top:12px">Solo Fabio y Mariana pueden gestionar el plan de pagos.</p>';
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

  const totalContrato = cuotas.reduce((s, c) => s + c.valorOriginal, 0);
  const totalPagado = pagadas.reduce((s, c) => s + c.montoPagado, 0);
  const saldoPendiente = pendientes.reduce((s, c) => s + c.valorActual, 0);
  const valorCuotaActual = pendientes.length ? pendientes[0].valorActual : (pagadas[pagadas.length - 1]?.montoPagado || 0);

  con.innerHTML = `
    <div class="cuotas-resumen">
      <div class="cuota-stat"><div class="cuota-stat-label">Contrato original</div><div class="cuota-stat-val">${formatMoney(totalContrato)}</div></div>
      <div class="cuota-stat"><div class="cuota-stat-label">Total cobrado</div><div class="cuota-stat-val verde">${formatMoney(totalPagado)}</div></div>
      <div class="cuota-stat"><div class="cuota-stat-label">Saldo pendiente</div><div class="cuota-stat-val ${saldoPendiente > 0 ? 'rojo' : 'verde'}">${formatMoney(saldoPendiente)}</div></div>
      <div class="cuota-stat"><div class="cuota-stat-label">Valor cuota actual</div><div class="cuota-stat-val">${formatMoney(valorCuotaActual)}</div></div>
    </div>

    <div id="cuotas-acciones" class="cuotas-acciones">
      ${pendientes.length ? `
        <button class="btn btn-sm btn-secondary" id="btn-pagar-sel">✓ Marcar seleccionadas como pagadas</button>
        <div class="ipc-inline">
          <input type="number" id="ipc-pct" placeholder="IPC %" min="0" max="100" step="0.1" style="width:90px">
          <button class="btn btn-sm btn-secondary" id="btn-ipc">Actualizar por IPC</button>
          <button class="btn btn-sm btn-secondary" id="btn-ajustar-val">Fijar valor</button>
          <input type="number" id="nuevo-valor" placeholder="Nuevo valor $" min="0" style="width:120px">
        </div>
      ` : ''}
      ${isAdmin() ? `<button class="btn btn-sm btn-danger" id="btn-reset-plan" style="margin-left:auto">Borrar plan</button>` : ''}
    </div>

    <div id="fecha-pago-row" class="hidden" style="margin:10px 0;display:flex;gap:10px;align-items:center">
      <label style="font-size:13px;font-weight:600">Fecha del pago:</label>
      <input type="date" id="fecha-pago-input" value="${new Date().toISOString().split('T')[0]}" style="width:160px">
      <input type="text" id="notas-pago-input" placeholder="Notas (opcional)" style="flex:1">
      <button class="btn btn-sm btn-primary" id="btn-confirmar-pago">Confirmar</button>
      <button class="btn btn-sm btn-secondary" id="btn-cancelar-pago">Cancelar</button>
    </div>

    <div class="cuotas-lista">
      ${cuotas.map(c => `
        <div class="cuota-item cuota-${c.estado}" data-row="${c.rowIndex}">
          ${c.estado === 'pendiente' ? `<input type="checkbox" class="cuota-check" data-row="${c.rowIndex}">` : '<span class="cuota-check-ph"></span>'}
          <span class="cuota-num">Cuota ${c.numeroCuota}</span>
          <span class="cuota-vence">${formatDateWithDay(c.fechaVencimiento)}</span>
          <span class="cuota-valor">${formatMoney(c.valorActual)}</span>
          <span class="cuota-badge cuota-badge-${c.estado}">${c.estado === 'pagada' ? `✓ Pagada ${formatDate(c.fechaPago)}` : 'Pendiente'}</span>
          ${c.estado === 'pagada' && c.montoPagado ? `<span style="font-size:11px;color:#888">cobrado: ${formatMoney(c.montoPagado)}</span>` : ''}
        </div>
      `).join('')}
    </div>

    <div style="margin-top:20px;border-top:1px solid var(--gris-borde);padding-top:16px">
      <p style="font-size:12px;color:#999;margin-bottom:10px">¿Necesitás agregar más cuotas al plan?</p>
      ${formAgregarCuotas(cliente.id, cuotas.length)}
    </div>
  `;

  bindCuotasAcciones(cliente, cuotas);
}

function formCrearPlan(idCliente) {
  return `
    <form id="form-crear-plan" class="cuotas-form">
      <h4>Crear plan de pagos</h4>
      <div class="form-grid small-grid">
        <div class="form-group">
          <label>Monto total del contrato</label>
          <input type="number" id="plan-monto" min="0" required placeholder="600000">
        </div>
        <div class="form-group">
          <label>Cantidad de cuotas</label>
          <input type="number" id="plan-ncuotas" min="1" max="60" required placeholder="6">
        </div>
        <div class="form-group">
          <label>Valor por cuota (opcional)</label>
          <input type="number" id="plan-valor-cuota" min="0" placeholder="Se calcula automático">
        </div>
        <div class="form-group">
          <label>Fecha 1° cuota</label>
          <input type="date" id="plan-fecha" required value="${new Date().toISOString().split('T')[0]}">
        </div>
      </div>
      <p id="plan-preview" style="font-size:13px;color:#555;margin:6px 0"></p>
      <button type="submit" class="btn btn-primary btn-sm">Crear plan</button>
    </form>`;
}

function formAgregarCuotas(idCliente, totalActual) {
  return `
    <form id="form-agregar-cuotas" class="cuotas-form" style="margin-top:0">
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="form-group" style="margin:0">
          <label style="font-size:12px">Agregar cuotas</label>
          <input type="number" id="agregar-ncuotas" min="1" max="24" placeholder="Cantidad" style="width:100px">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:12px">Valor c/u</label>
          <input type="number" id="agregar-valor" min="0" placeholder="$" style="width:120px">
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
    if (monto && n) {
      const v = valorCustom || Math.round(monto / n);
      $('plan-preview').textContent = `→ ${n} cuotas de ${formatMoney(v)} c/u`;
    } else {
      $('plan-preview').textContent = '';
    }
  };
  $('plan-monto')?.addEventListener('input', updatePreview);
  $('plan-ncuotas')?.addEventListener('input', updatePreview);
  $('plan-valor-cuota')?.addEventListener('input', updatePreview);

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
      }});
      loadCuotasTab(cliente);
    } catch (err) { alert(err.message); btn.disabled = false; }
  });
}

function bindCuotasAcciones(cliente, cuotas) {
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
    const fechaPago = $('fecha-pago-input').value;
    const notas = $('notas-pago-input').value;
    try {
      await apiFetch('/cuotas/pagar', { method: 'PUT', body: { rowIndices, fechaPago, notas } });
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
    if (!confirm(`¿Fijar ${formatMoney(val)} como valor de todas las cuotas pendientes?`)) return;
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
      }});
      loadCuotasTab(cliente);
    } catch (err) { alert(err.message); btn.disabled = false; }
  });
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
