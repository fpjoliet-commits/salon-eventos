/* ===================== CONFIG ===================== */
const API = '/api';

/* ===================== STATE ===================== */
let currentUser = null;
let token = null;
let allClientes = [];
let allIngresos = [];
let currentClienteModal = null;

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
  if (section) section.classList.add('active');

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
      <td>${formatDate(c.fechaEvento)}</td>
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
    <div class="detail-item"><span class="detail-label">Fecha del evento</span><span class="detail-value">${formatDate(c.fechaEvento)}</span></div>
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

  const adminContent = $('pagos-admin-content');
  if (isAdmin()) {
    showEl(adminContent);
    loadPagosCliente(cliente);
  } else {
    hideEl(adminContent);
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
  const con = $('calendario-container');
  const eventos = allClientes
    .filter(c => c.fechaEvento && c.estado !== 'Cancelado')
    .sort((a, b) => new Date(a.fechaEvento) - new Date(b.fechaEvento));

  if (!eventos.length) {
    con.innerHTML = '<p class="empty-msg">No hay eventos agendados.</p>';
    return;
  }

  con.innerHTML = `
    <p style="color:#666;margin-bottom:16px">Próximos ${eventos.length} eventos agendados</p>
    <div class="cal-grid">
      ${eventos.map(c => `
        <div class="cal-event-card" onclick="openClienteModal(window._cmap['${c.id}'])">
          <div class="cal-event-date">${formatDate(c.fechaEvento)} · ${c.turno || ''}</div>
          <div class="cal-event-nombre">${c.apellidoNombre}</div>
          <div class="cal-event-tipo">${c.tipoEvento || '—'} · ${c.cantidadInvitados || '?'} inv.</div>
          <div style="margin-top:6px">${estadoBadge(c.estado)}</div>
        </div>
      `).join('')}
    </div>
  `;

  // Map para acceso desde onclick
  window._cmap = {};
  allClientes.forEach(c => { window._cmap[c.id] = c; });
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
