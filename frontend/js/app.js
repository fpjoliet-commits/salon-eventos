/* ===================== CONFIG ===================== */
const API = '/api';

/* ===================== STATE ===================== */
let currentUser = null;
let token = null;
let allClientes = [];
let allIngresos = [];
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

  // Calendario: visible para superadmin y admin
  const canSeeCalendar = isAdmin() || currentUser.usuario === 'admin';
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

  activateTab(tabInicial);
  renderClienteDetail(cliente);
  injectNombreAcciones(cliente);
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
  document.querySelectorAll('.tab-content').forEach(c => {
    const isActive = c.id === `tab-${name}`;
    c.classList.toggle('active', isActive);
    if (isActive) c.classList.remove('hidden');
  });
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
    ${c.otrosPedidos ? `<div class="detail-item detail-full"><span class="detail-label">Otros pedidos</span><span class="detail-value">${esc(c.otrosPedidos)}</span></div>` : ''}
    ${(c.observaciones || '').replace(SUGERENCIA_REGEX,'').trim() ? `<div class="detail-item detail-full"><span class="detail-label">Observaciones</span><span class="detail-value">${esc((c.observaciones || '').replace(SUGERENCIA_REGEX,'').trim())}</span></div>` : ''}
  `;
}

$('btn-editar-cliente').addEventListener('click', () => {
  if (!currentClienteModal) return;
  hideEl($('modal-overlay'));
  openEditForm(currentClienteModal);
});

$('btn-imprimir-cocina').addEventListener('click', () => {
  if (!currentClienteModal) return;
  imprimirFichaCocina(currentClienteModal, currentRestricciones);
});

function imprimirFichaCocina(c, restricciones) {
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

window.openClienteModalById = (idCliente) => {
  const c = allClientes.find(cl => cl.id === idCliente);
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

$('presupuesto-select').addEventListener('change', () => {
  $('monto-group').style.display = $('presupuesto-select').value === 'Sí, tiene monto' ? '' : 'none';
});

$('cancel-form-btn').addEventListener('click', () => navigateTo('clientes'));

$('cliente-form').addEventListener('submit', async e => {
  e.preventDefault();
  hide('form-error'); hide('form-success');

  const form = $('cliente-form');
  const rowIndex = $('edit-row-index').value;
  const isEdit = !!rowIndex;

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
