/* ============================================================
   UX.JS — Capa de usabilidad y accesibilidad del CRM
   Se carga DESPUÉS de app.js y envuelve algunas de sus funciones.
   No reemplaza lógica de negocio: sólo mejora cómo se usa.

   Contenido:
     1. Utilidades (normalizar, debounce, región aria-live)
     2. Foco atrapado en diálogos (WCAG 2.4.3 / 2.1.2)
     3. uiConfirm() — diálogo propio en vez de confirm() nativo
     4. toastUndo() — acción con "Deshacer"
     5. Tamaño de texto A / A+ / A++ (NN/g 60+)
     6. Orden por columna + exportar CSV
     7. Filtros que se recuerdan
     8. Accesibilidad del modal de cliente y de los tabs
     9. Paleta de comandos (Ctrl+K)
    10. Inicio: resumen del día sobre el calendario
   ============================================================ */

(function () {
  'use strict';

  /* ============================================================
     1. UTILIDADES
     ============================================================ */

  const LS = {
    textSize: 'crm_text_size',
    filtros: 'crm_filtros_clientes',
    orden: 'crm_orden_clientes',
  };

  /* Nombres reales detrás de cada usuario del login.
     El login pide un rol, no una persona: si algún día se separa por persona,
     esto sale sobrando. Editable a mano. */
  const NOMBRES = { superadmin: 'Fabio', admin: 'Fabio', empleado: '' };

  /* Comparación sin acentos ni mayúsculas — imprescindible en español */
  const norm = s => (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

  /* app.js declara allClientes y currentUser con `let`, así que NO están en
     window: hay que leer el binding global directamente. Estos accesores
     devuelven siempre el valor vivo. */
  const getClientes = () => {
    try { return allClientes || []; } catch { return []; }
  };
  const getUser = () => {
    try { return currentUser || null; } catch { return null; }
  };

  const debounce = (fn, ms = 180) => {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  };

  const hoyStr = () => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  };

  const escHtml = s => (window.esc ? window.esc(s) : String(s ?? ''));

  /* Región aria-live para los toasts: sin esto un lector de pantalla
     nunca se enteraba de que algo se guardó. */
  function prepararToastContainer() {
    let cont = document.getElementById('toast-container');
    if (!cont) {
      cont = document.createElement('div');
      cont.id = 'toast-container';
      document.body.appendChild(cont);
    }
    cont.setAttribute('role', 'status');
    cont.setAttribute('aria-live', 'polite');
    cont.setAttribute('aria-atomic', 'false');
    return cont;
  }

  /* ============================================================
     2. FOCO ATRAPADO EN DIÁLOGOS
     ============================================================ */

  const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  function focusables(container) {
    return [...container.querySelectorAll(FOCUSABLE)]
      .filter(el => el.offsetParent !== null || el === document.activeElement);
  }

  /* Atrapa el Tab dentro del contenedor y devuelve el foco al cerrar.
     Devuelve una función para liberar. */
  function trapFocus(container, opts = {}) {
    const previo = document.activeElement;

    const onKey = e => {
      if (e.key !== 'Tab') return;
      const f = focusables(container);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    container.addEventListener('keydown', onKey);

    // Enfocar lo indicado, o el primer elemento útil
    const target = opts.initialFocus || focusables(container)[0];
    if (target) setTimeout(() => target.focus(), 30);

    return function liberar() {
      container.removeEventListener('keydown', onKey);
      if (opts.restoreFocus !== false && previo && document.contains(previo)) {
        try { previo.focus(); } catch { /* el elemento ya no existe */ }
      }
    };
  }

  /* ============================================================
     3. uiConfirm() — DIÁLOGO DE CONFIRMACIÓN PROPIO
     El confirm() nativo bloquea el hilo, no se puede agrandar y en tablet
     aparece minúsculo. Este es legible, se cierra con Esc y arranca con el
     foco en el botón seguro (no en el destructivo).
     ============================================================ */

  let _uicSeq = 0;

  function uiConfirm(opts = {}) {
    const idT = `uic-title-${++_uicSeq}`;
    const idB = `uic-body-${_uicSeq}`;
    const {
      titulo = '¿Confirmás?',
      mensaje = '',
      confirmar = 'Sí, continuar',
      cancelar = 'Cancelar',
      tipo = 'warn',          // 'warn' | 'danger' | 'info'
      icono = null,
    } = typeof opts === 'string' ? { mensaje: opts } : opts;

    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'uic-overlay';

      const iconoFinal = icono !== null ? icono
        : tipo === 'danger' ? '🗑'
        : tipo === 'info' ? 'ℹ️'
        : '⚠️';

      const btnConfirmClass = tipo === 'danger' ? 'btn btn-danger' : 'btn btn-primary';

      overlay.innerHTML = `
        <div class="uic-dialog uic-dialog-${tipo}" role="dialog" aria-modal="true"
             aria-labelledby="${idT}" ${mensaje ? `aria-describedby="${idB}"` : ''}>
          ${iconoFinal ? `<div class="uic-icon" aria-hidden="true">${iconoFinal}</div>` : ''}
          <h2 class="uic-title" id="${idT}">${escHtml(titulo)}</h2>
          ${mensaje ? `<div class="uic-body" id="${idB}">${escHtml(mensaje)}</div>` : ''}
          <div class="uic-actions">
            ${cancelar ? `<button type="button" class="btn btn-secondary" data-uic="no">${escHtml(cancelar)}</button>` : ''}
            <button type="button" class="${btnConfirmClass}" data-uic="si">${escHtml(confirmar)}</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('uic-show'));

      const dialog = overlay.querySelector('.uic-dialog');
      const btnNo = overlay.querySelector('[data-uic="no"]');
      const btnSi = overlay.querySelector('[data-uic="si"]');

      // El foco arranca en Cancelar: un Enter accidental no borra nada.
      const liberar = trapFocus(dialog, { initialFocus: btnNo || btnSi });

      let cerrado = false;
      function cerrar(valor) {
        if (cerrado) return;
        cerrado = true;
        document.removeEventListener('keydown', onKey, true);
        liberar();
        overlay.classList.remove('uic-show');
        setTimeout(() => overlay.remove(), 180);
        resolve(valor);
      }

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(false); }
      }
      document.addEventListener('keydown', onKey, true);

      btnNo?.addEventListener('click', () => cerrar(false));
      btnSi.addEventListener('click', () => cerrar(true));
      overlay.addEventListener('click', e => { if (e.target === overlay) cerrar(false); });
    });
  }

  /* Aviso simple (reemplaza alert) */
  function uiAlert(opts = {}) {
    const o = typeof opts === 'string' ? { mensaje: opts } : opts;
    return uiConfirm({
      titulo: o.titulo || 'Atención',
      mensaje: o.mensaje || '',
      confirmar: o.confirmar || 'Entendido',
      cancelar: null,
      tipo: o.tipo || 'info',
    }).then(() => undefined);
  }

  /* ============================================================
     4. toastUndo() — ACCIÓN CON "DESHACER"
     Google Sheets no tiene papelera accesible desde el CRM, así que sin
     esto un borrado es pérdida definitiva. Patrón NN/g: ejecutar ya y
     ofrecer volver atrás por unos segundos.
     ============================================================ */

  function toastUndo(mensaje, onUndo, opts = {}) {
    const { segundos = 9, textoUndo = 'Deshacer' } = opts;
    const cont = prepararToastContainer();

    const el = document.createElement('div');
    el.className = 'toast toast-success toast-undo';
    el.innerHTML = `
      <span class="toast-icon" aria-hidden="true">✓</span>
      <span>${escHtml(mensaje)}</span>
      <button type="button" class="toast-undo-btn">${escHtml(textoUndo)}</button>`;
    cont.appendChild(el);
    requestAnimationFrame(() => el.classList.add('toast-show'));

    let cerrado = false;
    const quitar = () => {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(timer);
      el.classList.remove('toast-show');
      setTimeout(() => el.remove(), 300);
    };
    const timer = setTimeout(quitar, segundos * 1000);

    el.querySelector('.toast-undo-btn').addEventListener('click', async () => {
      quitar();
      try {
        await onUndo();
      } catch (err) {
        window.toast?.('No se pudo deshacer: ' + err.message, 'error');
      }
    });
  }

  /* ============================================================
     5. TAMAÑO DE TEXTO — A / A+ / A++
     El CSS del CRM está en px, así que escalar :root no alcanza.
     Se usa zoom en <html>, que escala todo (incluido lo fijo) igual que
     el zoom del navegador, y queda guardado en el equipo.
     ============================================================ */

  const ESCALAS = [
    { id: 1, zoom: 1,    label: 'A',   titulo: 'Tamaño normal' },
    { id: 2, zoom: 1.12, label: 'A',   titulo: 'Letra grande' },
    { id: 3, zoom: 1.25, label: 'A',   titulo: 'Letra más grande' },
  ];

  function aplicarEscala(id, guardar = true) {
    const esc = ESCALAS.find(e => e.id === Number(id)) || ESCALAS[0];
    document.documentElement.style.zoom = esc.zoom === 1 ? '' : String(esc.zoom);
    if (guardar) localStorage.setItem(LS.textSize, String(esc.id));
    document.querySelectorAll('.textsize-btn').forEach(b => {
      b.setAttribute('aria-pressed', String(Number(b.dataset.size) === esc.id));
    });
  }

  function montarControlTamano() {
    const footer = document.querySelector('.sidebar-footer');
    if (!footer || document.querySelector('.textsize-control')) return;

    const wrap = document.createElement('div');
    wrap.className = 'textsize-control';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Tamaño del texto');
    wrap.innerHTML = `<span class="textsize-label" aria-hidden="true">Letra</span>` +
      ESCALAS.map(e => `
        <button type="button" class="textsize-btn textsize-btn-${e.id}" data-size="${e.id}"
                aria-pressed="false" title="${e.titulo}">${e.label}</button>`).join('');

    footer.insertAdjacentElement('beforebegin', wrap);
    wrap.addEventListener('click', e => {
      const btn = e.target.closest('.textsize-btn');
      if (btn) aplicarEscala(btn.dataset.size);
    });

    aplicarEscala(localStorage.getItem(LS.textSize) || 1, false);
  }

  /* ============================================================
     6. ORDEN POR COLUMNA + EXPORTAR CSV
     ============================================================ */

  /* Los estados se ordenan por su lugar en el embudo, no alfabéticamente:
     "Confirmado" antes que "Consulta" no le sirve a nadie. */
  const ORDEN_ESTADO = ['Consulta', 'Visita agendada', 'Por cerrar', 'Confirmado', 'Realizado', 'Cancelado'];

  const COLUMNAS = [
    { key: 'apellidoNombre',    label: 'Nombre',            tipo: 'texto' },
    { key: 'telefono',          label: 'Teléfono',          tipo: 'texto' },
    { key: 'tipoEvento',        label: 'Evento',            tipo: 'texto' },
    { key: 'fechaEvento',       label: 'Fecha evento',      tipo: 'fecha' },
    { key: 'estado',            label: 'Estado',            tipo: 'estado' },
    { key: 'proximoSeguimiento', label: 'Próx. seguimiento', tipo: 'fecha' },
    { key: 'origen',            label: 'Origen',            tipo: 'texto' },
  ];

  let orden = { key: null, dir: 'asc' };
  let ultimaVista = [];   // lo que se está mostrando (filtrado + ordenado) → para el CSV

  function valorOrden(c, col) {
    const v = c[col.key];
    if (col.tipo === 'estado') {
      const i = ORDEN_ESTADO.indexOf(v);
      return i === -1 ? 999 : i;
    }
    if (col.tipo === 'fecha') {
      // Sin fecha va siempre al final, ordene asc o desc
      return v || '￿';
    }
    return norm(v);
  }

  function ordenarLista(lista) {
    if (!orden.key) return lista;
    const col = COLUMNAS.find(c => c.key === orden.key);
    if (!col) return lista;
    const mult = orden.dir === 'asc' ? 1 : -1;
    return [...lista].sort((a, b) => {
      const va = valorOrden(a, col), vb = valorOrden(b, col);
      if (va === vb) return norm(a.apellidoNombre).localeCompare(norm(b.apellidoNombre));
      if (typeof va === 'number') return (va - vb) * mult;
      return String(va).localeCompare(String(vb), 'es') * mult;
    });
  }

  function pintarEstadoOrden() {
    document.querySelectorAll('#view-clientes .data-table thead th[data-sort-key]').forEach(th => {
      const activo = th.dataset.sortKey === orden.key;
      th.setAttribute('aria-sort', activo ? (orden.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      const flecha = th.querySelector('.th-sort-arrow');
      if (flecha) flecha.textContent = activo ? (orden.dir === 'asc' ? '▲' : '▼') : '⇅';
    });
  }

  function montarOrdenTabla() {
    const thead = document.querySelector('#view-clientes .data-table thead tr');
    if (!thead || thead.dataset.sortReady) return;
    thead.dataset.sortReady = '1';

    [...thead.children].forEach((th, i) => {
      const col = COLUMNAS[i];
      if (!col) return;                       // la última columna (acciones) no se ordena
      th.dataset.sortKey = col.key;
      th.setAttribute('aria-sort', 'none');
      th.innerHTML = `<button type="button" class="th-sort">
          <span>${col.label}</span>
          <span class="th-sort-arrow" aria-hidden="true">⇅</span>
        </button>`;
      th.querySelector('.th-sort').addEventListener('click', () => {
        if (orden.key === col.key) {
          orden.dir = orden.dir === 'asc' ? 'desc' : 'asc';
        } else {
          orden = { key: col.key, dir: 'asc' };
        }
        localStorage.setItem(LS.orden, JSON.stringify(orden));
        window.applyFilters?.();
        pintarEstadoOrden();
      });
    });

    try {
      const g = JSON.parse(localStorage.getItem(LS.orden) || 'null');
      if (g && COLUMNAS.some(c => c.key === g.key)) orden = g;
    } catch { /* preferencia corrupta: se ignora */ }
    pintarEstadoOrden();
  }

  /* --- CSV de la vista actual (respeta filtros y orden) --- */
  const CSV_COLS = [
    ['Nombre', 'apellidoNombre'], ['Teléfono', 'telefono'], ['Gmail', 'gmail'],
    ['Tipo de evento', 'tipoEvento'], ['Fecha del evento', 'fechaEvento'],
    ['Invitados', 'cantidadInvitados'], ['Turno', 'turno'], ['Estado', 'estado'],
    ['Próximo seguimiento', 'proximoSeguimiento'], ['Origen', 'origen'],
    ['Fecha de carga', 'fechaCarga'], ['Cargado por', 'cargadoPor'],
  ];

  function exportarCSV() {
    // Si se dispara desde Ctrl+K sin haber pasado por Clientes, ultimaVista está
    // vacía: exportar todo es más útil que un error.
    const lista = ultimaVista.length ? ultimaVista : getClientes();
    if (!lista.length) { window.toast?.('Todavía no hay clientes para exportar', 'error'); return; }

    const celda = v => {
      const s = (v ?? '').toString();
      // Prefijo ' para que Excel no convierta teléfonos y fechas a su antojo
      const seguro = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return `"${seguro.replace(/"/g, '""')}"`;
    };

    const filas = [CSV_COLS.map(c => celda(c[0])).join(';')];
    lista.forEach(c => filas.push(CSV_COLS.map(col => celda(c[col[1]])).join(';')));

    // BOM para que Excel en español abra los acentos bien
    const blob = new Blob(['﻿' + filas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clientes-joliet-${hoyStr()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    window.toast?.(`${lista.length} cliente${lista.length !== 1 ? 's' : ''} exportado${lista.length !== 1 ? 's' : ''}`);
  }

  /* ============================================================
     7. FILTROS QUE SE RECUERDAN
     Antes se perdían al recargar. Se guardan en el equipo y se reponen
     al entrar, con un aviso visible de que hay un filtro puesto.
     ============================================================ */

  const FILTROS = ['search-input', 'filter-estado', 'filter-origen', 'filter-evento'];

  function guardarFiltros() {
    const data = {};
    FILTROS.forEach(id => { const el = document.getElementById(id); if (el) data[id] = el.value; });
    localStorage.setItem(LS.filtros, JSON.stringify(data));
  }

  function reponerFiltros() {
    let data;
    try { data = JSON.parse(localStorage.getItem(LS.filtros) || 'null'); } catch { return false; }
    if (!data) return false;
    let alguno = false;
    FILTROS.forEach(id => {
      const el = document.getElementById(id);
      if (el && data[id]) { el.value = data[id]; alguno = true; }
    });
    return alguno;
  }


  /* Subconjuntos armados a mano (los KPIs del Inicio y la barra de recordatorios
     llaman a renderClientes con una lista propia, sin pasar por los filtros).

     Sin aviso esto engaña: renderStats() recalcula las tarjetas sobre la lista
     recibida, así que al tocar "3 seguimientos vencidos" la tarjeta de arriba
     pasa a decir "TOTAL CLIENTES 3" y parece que no hay más clientes. */
  let subconjunto = null;   // { n, etiqueta }

  function mostrarSubconjunto(clientes, etiqueta) {
    subconjunto = { n: clientes.length, etiqueta };
    window.renderClientes?.(clientes);
    pintarAvisoFiltros();
  }

  function verTodos() {
    subconjunto = null;
    FILTROS.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    guardarFiltros();
    window.applyFilters?.();
  }

  function pintarAvisoFiltros() {
    const wrap = document.getElementById('filtros-activos-wrap');
    if (!wrap) return;

    let texto = '';
    if (subconjunto) {
      texto = `Mostrando ${subconjunto.n} cliente${subconjunto.n !== 1 ? 's' : ''}: ${subconjunto.etiqueta}`;
    } else {
      const activos = FILTROS
        .map(id => document.getElementById(id))
        .filter(el => el && el.value).length;
      if (activos) {
        texto = `Mostrando una vista filtrada (${activos} filtro${activos > 1 ? 's' : ''})`;
      }
    }

    if (!texto) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = `<span class="filtros-activos">
        <span>${escHtml(texto)}</span>
        <button type="button" class="btn-limpiar-filtros" id="btn-limpiar-filtros">Ver todos</button>
      </span>`;
    document.getElementById('btn-limpiar-filtros').addEventListener('click', verTodos);
  }

  /* ============================================================
     8. ACCESIBILIDAD DEL MODAL DE CLIENTE Y DE LOS TABS
     Antes: sin role, sin aria-modal, sin foco atrapado, y Esc no cerraba.
     ============================================================ */

  let liberarModal = null;

  function cerrarModalCliente() {
    document.getElementById('modal-close-btn')?.click();   // reusa la lógica de app.js
  }

  function montarA11yModal() {
    const overlay = document.getElementById('modal-overlay');
    const modal = overlay?.querySelector('.modal');
    if (!modal) return;

    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'modal-titulo');

    // El modal se abre/cierra agregando y quitando .hidden en el overlay
    const obs = new MutationObserver(() => {
      const abierto = !overlay.classList.contains('hidden');
      if (abierto && !liberarModal) {
        liberarModal = trapFocus(modal);
        document.body.style.overflow = 'hidden';
      } else if (!abierto && liberarModal) {
        liberarModal(); liberarModal = null;
        document.body.style.overflow = '';
      }
    });
    obs.observe(overlay, { attributes: true, attributeFilter: ['class'] });

    // Esc cierra el modal (antes sólo cerraba el drawer de la sidebar)
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.uic-overlay') || document.querySelector('.cmdk-overlay')) return;
      if (!overlay.classList.contains('hidden')) { e.preventDefault(); cerrarModalCliente(); }
    });
  }

  /* Tabs: roles ARIA + navegación con flechas (patrón WAI-ARIA) */
  function montarA11yTabs() {
    document.querySelectorAll('.modal-tabs, .cocina-tabs-nav').forEach(lista => {
      if (lista.dataset.a11yReady) return;
      lista.dataset.a11yReady = '1';
      lista.setAttribute('role', 'tablist');

      const btns = [...lista.querySelectorAll('.tab-btn, .cocina-tab-btn')];
      btns.forEach(btn => {
        btn.setAttribute('role', 'tab');
        const panel = document.getElementById(`tab-${btn.dataset.tab}`);
        if (panel) {
          panel.setAttribute('role', 'tabpanel');
          if (!btn.id) btn.id = `tabbtn-${btn.dataset.tab}`;
          panel.setAttribute('aria-labelledby', btn.id);
          btn.setAttribute('aria-controls', panel.id);
        }
      });

      const sincronizar = () => btns.forEach(b => {
        const activo = b.classList.contains('active');
        b.setAttribute('aria-selected', String(activo));
        b.tabIndex = activo ? 0 : -1;
      });
      sincronizar();
      new MutationObserver(sincronizar).observe(lista, {
        subtree: true, attributes: true, attributeFilter: ['class'],
      });

      lista.addEventListener('keydown', e => {
        const idx = btns.indexOf(document.activeElement);
        if (idx === -1) return;
        const visibles = btns.filter(b => !b.classList.contains('hidden') && b.offsetParent !== null);
        const vi = visibles.indexOf(document.activeElement);
        let dest = null;
        if (e.key === 'ArrowRight') dest = visibles[(vi + 1) % visibles.length];
        else if (e.key === 'ArrowLeft') dest = visibles[(vi - 1 + visibles.length) % visibles.length];
        else if (e.key === 'Home') dest = visibles[0];
        else if (e.key === 'End') dest = visibles[visibles.length - 1];
        if (dest) { e.preventDefault(); dest.focus(); dest.click(); }
      });
    });
  }

  /* ============================================================
     9. PALETA DE COMANDOS (Ctrl+K)
     Un keystroke para llegar a cualquier cliente o acción.
     ============================================================ */

  let cmdkAbierto = false;
  let cmdkSel = 0;
  let cmdkItems = [];

  function accionesDisponibles() {
    const admin = window.isAdmin?.() === true;
    const superadmin = window.isSuperAdmin?.() === true;
    const a = [
      { icono: '➕', titulo: 'Nuevo cliente', sub: 'Cargar una consulta nueva', run: () => window.navigateTo('nuevo-cliente') },
      { icono: '🏠', titulo: 'Ir a Inicio', sub: 'Resumen del día y calendario', run: () => window.navigateTo('calendario') },
      { icono: '👥', titulo: 'Ir a Clientes', sub: 'Listado completo', run: () => window.navigateTo('clientes') },
      { icono: '📱', titulo: 'Ir a Seguimientos', sub: 'Pendientes por contactar', run: () => window.navigateTo('seguimientos') },
      { icono: '📋', titulo: 'Ir a Propuesta', sub: 'Armar una propuesta', run: () => window.navigateTo('propuesta') },
      { icono: '⬇', titulo: 'Exportar clientes a CSV', sub: 'Descarga la vista actual', run: exportarCSV },
    ];
    if (admin) {
      a.push({ icono: '⏱', titulo: 'Ir a Timing Planner', sub: 'Armar el timing de un evento', run: () => window.navigateTo('timing-global') });
      a.push({ icono: '💸', titulo: 'Ir a Egresos', sub: 'Gastos y pagos', run: () => window.navigateTo('egresos') });
    }
    if (superadmin) {
      a.push({ icono: '🍳', titulo: 'Ir a Gestión de Cocina', sub: 'Stock, pedidos y compras', run: () => window.navigateTo('cocina') });
    }
    a.push({ icono: '🔤', titulo: 'Agrandar la letra del sistema', sub: 'Pasa al tamaño más grande', run: () => aplicarEscala(3) });
    a.push({ icono: '🔤', titulo: 'Volver la letra al tamaño normal', sub: 'Tamaño por defecto', run: () => aplicarEscala(1) });
    return a;
  }

  /* Puntaje simple: empezar con el texto buscado vale más que contenerlo */
  function puntaje(texto, q) {
    const t = norm(texto);
    if (!t) return -1;
    if (t === q) return 100;
    if (t.startsWith(q)) return 70;
    // que alguna palabra empiece con lo buscado (apellido, nombre)
    if (t.split(/[\s,]+/).some(p => p.startsWith(q))) return 55;
    if (t.includes(q)) return 30;
    return -1;
  }

  function buscarCmdk(q) {
    const query = norm(q);
    const grupos = [];

    const acciones = accionesDisponibles();
    if (!query) {
      grupos.push({ label: 'Acciones', items: acciones.slice(0, 6) });
      const activos = getClientes()
        .filter(c => c.estado === 'Confirmado' || c.estado === 'Por cerrar')
        .slice(0, 5)
        .map(itemCliente);
      if (activos.length) grupos.push({ label: 'Clientes activos', items: activos });
      return grupos;
    }

    const accMatch = acciones
      .map(a => ({ a, p: Math.max(puntaje(a.titulo, query), puntaje(a.sub, query) - 20) }))
      .filter(x => x.p > 0)
      .sort((x, y) => y.p - x.p)
      .map(x => x.a);
    if (accMatch.length) grupos.push({ label: 'Acciones', items: accMatch.slice(0, 5) });

    const cliMatch = getClientes()
      .map(c => {
        const p = Math.max(
          puntaje(c.apellidoNombre, query),
          puntaje(c.telefono, query) - 5,
          puntaje(c.gmail, query) - 10,
          puntaje(c.tipoEvento, query) - 30,
        );
        return { c, p };
      })
      .filter(x => x.p > 0)
      .sort((x, y) => y.p - x.p || (x.c.fechaEvento || '').localeCompare(y.c.fechaEvento || ''))
      .slice(0, 8)
      .map(x => itemCliente(x.c));
    if (cliMatch.length) grupos.push({ label: 'Clientes', items: cliMatch });

    return grupos;
  }

  function itemCliente(c) {
    const partes = [c.tipoEvento, c.fechaEvento ? window.formatDate?.(c.fechaEvento) : '', c.telefono]
      .filter(Boolean).join(' · ');
    return {
      icono: '👤',
      titulo: c.apellidoNombre || '(sin nombre)',
      sub: partes,
      badge: window.estadoBadge?.(c.estado) || '',
      run: () => window.openClienteModal(c),
    };
  }

  function pintarCmdk(q) {
    const lista = document.getElementById('cmdk-list');
    if (!lista) return;
    const grupos = buscarCmdk(q);
    cmdkItems = grupos.flatMap(g => g.items);
    if (cmdkSel >= cmdkItems.length) cmdkSel = 0;

    if (!cmdkItems.length) {
      lista.innerHTML = `<div class="cmdk-empty">Nada coincide con “${escHtml(q)}”</div>`;
      return;
    }

    let i = 0;
    lista.innerHTML = grupos.map(g => `
      <div class="cmdk-group" role="group" aria-label="${escHtml(g.label)}">
        <div class="cmdk-group-label">${escHtml(g.label)}</div>
        ${g.items.map(it => {
          const idx = i++;
          return `<div class="cmdk-item" role="option" data-idx="${idx}"
                       aria-selected="${idx === cmdkSel}" id="cmdk-item-${idx}">
            <span class="cmdk-item-icon" aria-hidden="true">${it.icono}</span>
            <span class="cmdk-item-main">
              <span class="cmdk-item-title">${escHtml(it.titulo)}</span>
              ${it.sub ? `<span class="cmdk-item-sub">${escHtml(it.sub)}</span>` : ''}
            </span>
            ${it.badge ? `<span class="cmdk-item-badge">${it.badge}</span>` : ''}
          </div>`;
        }).join('')}
      </div>`).join('');

    lista.querySelectorAll('.cmdk-item').forEach(el => {
      el.addEventListener('click', () => ejecutarCmdk(Number(el.dataset.idx)));
      el.addEventListener('mousemove', () => moverCmdk(Number(el.dataset.idx)));
    });
    actualizarSelCmdk();
  }

  function actualizarSelCmdk() {
    const lista = document.getElementById('cmdk-list');
    if (!lista) return;
    lista.querySelectorAll('.cmdk-item').forEach(el => {
      const activo = Number(el.dataset.idx) === cmdkSel;
      el.setAttribute('aria-selected', String(activo));
      if (activo) el.scrollIntoView({ block: 'nearest' });
    });
    document.getElementById('cmdk-input')?.setAttribute('aria-activedescendant', `cmdk-item-${cmdkSel}`);
  }

  function moverCmdk(idx) {
    if (idx === cmdkSel || idx < 0 || idx >= cmdkItems.length) return;
    cmdkSel = idx;
    actualizarSelCmdk();
  }

  function ejecutarCmdk(idx) {
    const it = cmdkItems[idx];
    if (!it) return;
    cerrarCmdk();
    setTimeout(() => { try { it.run(); } catch (e) { window.toast?.('No se pudo abrir: ' + e.message, 'error'); } }, 60);
  }

  let liberarCmdk = null;

  function abrirCmdk() {
    if (cmdkAbierto) return;
    cmdkAbierto = true;
    cmdkSel = 0;

    const overlay = document.createElement('div');
    overlay.className = 'cmdk-overlay';
    overlay.id = 'cmdk-overlay';
    overlay.innerHTML = `
      <div class="cmdk-panel" role="dialog" aria-modal="true" aria-label="Buscar y ejecutar acciones">
        <div class="cmdk-input-wrap">
          <span class="cmdk-input-icon" aria-hidden="true">🔍</span>
          <input type="text" class="cmdk-input" id="cmdk-input" role="combobox"
                 aria-expanded="true" aria-controls="cmdk-list" aria-autocomplete="list"
                 autocomplete="off" spellcheck="false"
                 placeholder="Buscá un cliente o escribí una acción...">
          <span class="cmdk-esc" aria-hidden="true">ESC</span>
        </div>
        <div class="cmdk-list" id="cmdk-list" role="listbox" aria-label="Resultados"></div>
        <div class="cmdk-footer" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> moverse</span>
          <span><kbd>Enter</kbd> abrir</span>
          <span><kbd>Esc</kbd> cerrar</span>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('cmdk-show'));

    const input = document.getElementById('cmdk-input');
    pintarCmdk('');
    liberarCmdk = trapFocus(overlay.querySelector('.cmdk-panel'), { initialFocus: input });

    const repintar = debounce(() => { cmdkSel = 0; pintarCmdk(input.value); }, 90);
    input.addEventListener('input', repintar);

    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moverCmdk(Math.min(cmdkSel + 1, cmdkItems.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moverCmdk(Math.max(cmdkSel - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); ejecutarCmdk(cmdkSel); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrarCmdk(); }
    });

    overlay.addEventListener('click', e => { if (e.target === overlay) cerrarCmdk(); });
  }

  function cerrarCmdk() {
    const overlay = document.getElementById('cmdk-overlay');
    if (!overlay) { cmdkAbierto = false; return; }
    cmdkAbierto = false;
    liberarCmdk?.(); liberarCmdk = null;
    overlay.classList.remove('cmdk-show');
    setTimeout(() => overlay.remove(), 160);
  }

  function montarCmdk() {
    document.addEventListener('keydown', e => {
      // Ctrl+K / ⌘K en cualquier momento
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        cmdkAbierto ? cerrarCmdk() : abrirCmdk();
        return;
      }
      // "/" abre la búsqueda si no estás escribiendo en un campo
      if (e.key === '/' && !cmdkAbierto) {
        const t = e.target;
        const escribiendo = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
        if (escribiendo) return;
        if (document.getElementById('login-screen') && !document.getElementById('login-screen').classList.contains('hidden')) return;
        e.preventDefault();
        abrirCmdk();
      }
    });

    // Botón visible en la sidebar: el atajo tiene que ser descubrible
    const nav = document.querySelector('.sidebar-nav');
    if (nav && !document.getElementById('cmdk-hint')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'cmdk-hint';
      btn.className = 'cmdk-hint';
      const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
      btn.innerHTML = `<span aria-hidden="true">🔍</span><span>Buscar…</span>
        <span class="cmdk-hint-keys">${mac ? '⌘' : 'Ctrl'} K</span>`;
      btn.addEventListener('click', abrirCmdk);
      nav.insertAdjacentElement('beforebegin', btn);
    }
  }

  /* ============================================================
     10. INICIO — RESUMEN DEL DÍA SOBRE EL CALENDARIO
     El landing pasa a responder "¿qué tengo que hacer hoy?" antes de
     mostrar la grilla. Los números son botones: llevan a la lista real.
     ============================================================ */

  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

  function saludo() {
    const h = new Date().getHours();
    if (h < 13) return 'Buen día';
    if (h < 20) return 'Buenas tardes';
    return 'Buenas noches';
  }

  function calcularInicio() {
    const cl = getClientes();
    // fechaLocal/hoyLocal vienen de app.js: parsean AAAA-MM-DD como fecha local.
    // Con new Date('2026-09-10') el string se lee como UTC y en Argentina cae un
    // día antes, así que lo de hoy aparecía como vencido.
    const hoy = hoyLocal();
    const hs = hoyStr();
    const en7 = new Date(hoy); en7.setDate(en7.getDate() + 7);
    const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);

    const activos = cl.filter(c => c.estado !== 'Cancelado' && c.estado !== 'Realizado');
    const fechaSeg = c => fechaLocal(c.proximoSeguimiento);

    const vencidos = activos.filter(c => c.proximoSeguimiento && fechaSeg(c) < hoy);
    const paraHoy = activos.filter(c => c.proximoSeguimiento === hs);
    const semana = activos.filter(c => {
      if (!c.proximoSeguimiento) return false;
      const d = fechaSeg(c);
      return d > hoy && d <= en7;
    });

    const eventosMes = cl.filter(c => {
      if (c.estado !== 'Confirmado' || !c.fechaEvento) return false;
      const d = fechaLocal(c.fechaEvento);
      return d && d >= hoy && d <= finMes;
    });

    const eventosHoy = cl.filter(c => c.fechaEvento === hs && c.estado !== 'Cancelado');

    const visitasHoy = paraHoy.filter(c => c.estado === 'Visita agendada');
    const cobrosHoy = paraHoy.filter(c => ['Confirmado', 'Por cerrar'].includes(c.estado));
    const llamadasHoy = paraHoy.filter(c => c.estado !== 'Visita agendada' && !['Confirmado', 'Por cerrar'].includes(c.estado));

    return { vencidos, paraHoy, semana, eventosMes, eventosHoy, visitasHoy, cobrosHoy, llamadasHoy };
  }

  function textoResumen(d) {
    const trozos = [];
    if (d.eventosHoy.length) trozos.push(`<strong>${d.eventosHoy.length} evento${d.eventosHoy.length > 1 ? 's' : ''}</strong> en el salón`);
    if (d.visitasHoy.length) trozos.push(`<strong>${d.visitasHoy.length} visita${d.visitasHoy.length > 1 ? 's' : ''}</strong>`);
    if (d.cobrosHoy.length) trozos.push(`<strong>${d.cobrosHoy.length} cobro${d.cobrosHoy.length > 1 ? 's' : ''}</strong>`);
    if (d.llamadasHoy.length) trozos.push(`<strong>${d.llamadasHoy.length} llamada${d.llamadasHoy.length > 1 ? 's' : ''}</strong>`);

    if (!trozos.length) {
      return d.vencidos.length
        ? `Hoy no tenés nada agendado, pero hay <strong>${d.vencidos.length} seguimiento${d.vencidos.length > 1 ? 's' : ''} vencido${d.vencidos.length > 1 ? 's' : ''}</strong> esperando.`
        : 'Hoy no tenés tareas agendadas. Todo al día ✓';
    }
    const lista = trozos.length === 1 ? trozos[0]
      : trozos.slice(0, -1).join(', ') + ' y ' + trozos[trozos.length - 1];
    return `Hoy tenés ${lista}.`;
  }

  function abrirLista(clientes, etiqueta) {
    if (!clientes.length) return;
    window.navigateTo('clientes');
    setTimeout(() => mostrarSubconjunto(clientes, etiqueta), 40);
  }

  function renderInicio() {
    const cont = document.getElementById('inicio-hero');
    if (!cont) return;

    const d = calcularInicio();
    const ahora = new Date();
    const nombre = NOMBRES[getUser()?.usuario] || '';
    const fecha = `${DIAS[ahora.getDay()]} ${ahora.getDate()} de ${MESES[ahora.getMonth()]}`;
    const fechaLarga = fecha.charAt(0).toUpperCase() + fecha.slice(1);

    const kpi = (valor, label, cls, activo) => `
      <button type="button" class="inicio-kpi ${cls}" data-kpi="${label}" ${activo ? '' : 'disabled'}>
        <span class="inicio-kpi-valor">${valor}</span>
        <span class="inicio-kpi-label">${label}</span>
      </button>`;

    cont.innerHTML = `
      <div class="inicio-hero-top">
        <h2 class="inicio-saludo">${saludo()}${nombre ? `, ${nombre}` : ''}</h2>
        <span class="inicio-fecha">${fechaLarga}</span>
      </div>
      <p class="inicio-resumen">${textoResumen(d)}</p>
      <div class="inicio-kpis">
        ${kpi(d.vencidos.length, 'Seguimientos vencidos', 'inicio-kpi-urgente', d.vencidos.length)}
        ${kpi(d.paraHoy.length, 'Tareas para hoy', 'inicio-kpi-hoy', d.paraHoy.length)}
        ${kpi(d.semana.length, 'Próximos 7 días', '', d.semana.length)}
        ${kpi(d.eventosMes.length, 'Eventos este mes', 'inicio-kpi-ok', d.eventosMes.length)}
      </div>`;

    const acciones = {
      'Seguimientos vencidos': () => abrirLista(d.vencidos, 'con seguimiento vencido'),
      'Tareas para hoy': () => { window.seleccionarDiaCal?.(hoyStr()); },
      'Próximos 7 días': () => window.navigateTo('seguimientos'),
      'Eventos este mes': () => abrirLista(d.eventosMes, 'evento(s) confirmado(s) este mes'),
    };
    cont.querySelectorAll('.inicio-kpi').forEach(btn => {
      btn.addEventListener('click', () => acciones[btn.dataset.kpi]?.());
    });
  }

  /* En Inicio, la barra de recordatorios de arriba dice exactamente lo mismo
     que los KPIs del hero ("5 vencidos", "3 esta semana"). Duplicar el mismo
     dato dos veces en la misma pantalla resta claridad, así que ahí se esconde
     y se mantiene en el resto de las vistas, donde sí aporta. */
  function sincronizarBarraRecordatorios() {
    const barra = document.getElementById('reminders-bar');
    const inicio = document.getElementById('view-calendario');
    if (!barra || !inicio) return;
    const enInicio = inicio.classList.contains('active');
    barra.style.display = enInicio ? 'none' : '';
  }

  /* ============================================================
     ENVOLTURAS SOBRE app.js
     ============================================================ */

  function envolverFunciones() {
    // renderClientes: aplica el orden elegido y recuerda la vista para el CSV
    if (typeof window.renderClientes === 'function' && !window.renderClientes._uxWrapped) {
      const original = window.renderClientes;
      const envuelta = function (clientes) {
        const listo = ordenarLista(clientes || []);
        ultimaVista = listo;
        original(listo);
        pintarEstadoOrden();
      };
      envuelta._uxWrapped = true;
      window.renderClientes = envuelta;
    }

    // applyFilters: guarda los filtros y actualiza el aviso de "vista filtrada".
    // Volver a filtrar deja de ser un subconjunto armado a mano.
    if (typeof window.applyFilters === 'function' && !window.applyFilters._uxWrapped) {
      const original = window.applyFilters;
      const envuelta = function () {
        subconjunto = null;
        original();
        guardarFiltros();
        pintarAvisoFiltros();
      };
      envuelta._uxWrapped = true;
      window.applyFilters = envuelta;
    }

    // filterReminder (barra de recordatorios de app.js): también pinta una lista
    // propia sin pasar por los filtros, así que necesita el mismo aviso.
    if (typeof window.filterReminder === 'function' && !window.filterReminder._uxWrapped) {
      const envuelta = function (ids) {
        window.navigateTo('clientes');
        const lista = getClientes().filter(c => ids.includes(c.id));
        mostrarSubconjunto(lista, 'visitas de hoy');
      };
      envuelta._uxWrapped = true;
      window.filterReminder = envuelta;
    }

    // renderCalendario: repinta el resumen del día junto con la grilla
    if (typeof window.renderCalendario === 'function' && !window.renderCalendario._uxWrapped) {
      const original = window.renderCalendario;
      const envuelta = function () {
        original.apply(this, arguments);
        renderInicio();
        montarA11yTabs();
      };
      envuelta._uxWrapped = true;
      window.renderCalendario = envuelta;
    }

    // openClienteModal: los tabs recién creados también necesitan sus roles ARIA
    if (typeof window.openClienteModal === 'function' && !window.openClienteModal._uxWrapped) {
      const original = window.openClienteModal;
      const envuelta = function () {
        const r = original.apply(this, arguments);
        montarA11yTabs();
        return r;
      };
      envuelta._uxWrapped = true;
      window.openClienteModal = envuelta;
    }
  }

  /* ============================================================
     RE-BINDEO DE LOS FILTROS
     Dos motivos:

     a) Debounce. app.js llama a applyFilters en cada tecla del buscador: con
        muchos clientes eso recorre y repinta la tabla entera letra por letra.

     b) app.js hace addEventListener('change', applyFilters) guardando la
        REFERENCIA a la función original. Envolver window.applyFilters después
        no cambia esos listeners: seguirían llamando a la versión sin guardado
        de filtros. Hay que soltar los handlers viejos y volver a atar.

     Clonar el nodo es la única forma de descartar listeners anónimos ya atados.
     ============================================================ */

  function reemplazarNodo(id) {
    const viejo = document.getElementById(id);
    if (!viejo || viejo.dataset.uxRebind) return null;
    const nuevo = viejo.cloneNode(true);
    nuevo.dataset.uxRebind = '1';
    viejo.replaceWith(nuevo);
    return nuevo;
  }

  function montarFiltros() {
    const buscador = reemplazarNodo('search-input');
    if (buscador) {
      buscador.addEventListener('input', debounce(() => window.applyFilters?.(), 180));
      // Esc dentro del buscador limpia el texto
      buscador.addEventListener('keydown', e => {
        if (e.key === 'Escape' && buscador.value) {
          e.stopPropagation();
          buscador.value = '';
          window.applyFilters?.();
        }
      });
    }

    ['filter-estado', 'filter-origen', 'filter-evento'].forEach(id => {
      const sel = reemplazarNodo(id);
      sel?.addEventListener('change', () => window.applyFilters?.());
    });
  }

  /* ============================================================
     TECLADO EN LA TABLA DE CLIENTES
     Las filas son clickeables pero no eran alcanzables por teclado.
     ============================================================ */

  function montarTecladoTabla() {
    const tbody = document.getElementById('clientes-tbody');
    if (!tbody || tbody.dataset.uxKeys) return;
    tbody.dataset.uxKeys = '1';

    new MutationObserver(() => {
      tbody.querySelectorAll('tr:not([tabindex])').forEach(tr => {
        tr.tabIndex = 0;
        tr.setAttribute('role', 'button');
        const nombre = tr.querySelector('td strong')?.textContent || 'cliente';
        tr.setAttribute('aria-label', `Ver ficha de ${nombre}`);
      });
    }).observe(tbody, { childList: true });

    tbody.addEventListener('keydown', e => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target !== tr) return;      // si el foco está en un botón, que actúe el botón
        e.preventDefault();
        tr.click();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const filas = [...tbody.querySelectorAll('tr')];
        const i = filas.indexOf(tr);
        const dest = filas[e.key === 'ArrowDown' ? i + 1 : i - 1];
        dest?.focus();
      }
    });
  }

  /* ============================================================
     TECLADOS CORRECTOS EN TABLET (inputmode / autocomplete)
     En la tablet, el campo de teléfono abría el teclado de letras y el de
     monto también. inputmode le dice al sistema qué teclado mostrar.
     Se aplica por patrón de id/name para no tocar 34 inputs a mano, y se
     repite cuando aparecen formularios generados por JS.
     ============================================================ */

  const REGLAS_INPUT = [
    { re: /tel|telefono|celular|whatsapp/i, attrs: { inputmode: 'tel', autocomplete: 'tel' } },
    { re: /mail|gmail|email/i,              attrs: { inputmode: 'email', autocomplete: 'email', spellcheck: 'false' } },
    { re: /monto|precio|valor|importe|total|cuota|sena|seña|stock|cantidad|invitados|pax|porcentaje|anios|años/i,
      attrs: { inputmode: 'decimal' } },
    { re: /dni|cuit|cuil/i,                 attrs: { inputmode: 'numeric' } },
  ];

  function aplicarInputmodes(raiz = document) {
    raiz.querySelectorAll('input:not([data-ux-im])').forEach(el => {
      const tipo = (el.type || '').toLowerCase();
      if (['date', 'time', 'checkbox', 'radio', 'file', 'hidden', 'password', 'color'].includes(tipo)) return;
      el.dataset.uxIm = '1';
      // Sólo id y name: el placeholder es prosa y engaña. "Buscar por nombre o
      // teléfono..." es un campo de nombres, y darle teclado numérico lo rompe.
      const clave = `${el.id || ''} ${el.name || ''}`;

      if (tipo === 'number') {
        // Los number ya traen teclado numérico, pero conviene desactivar el
        // scroll accidental que cambia el valor con la rueda del mouse.
        el.addEventListener('wheel', ev => { if (document.activeElement === el) ev.preventDefault(); }, { passive: false });
        if (!el.getAttribute('inputmode')) el.setAttribute('inputmode', 'decimal');
        return;
      }

      for (const regla of REGLAS_INPUT) {
        if (regla.re.test(clave)) {
          Object.entries(regla.attrs).forEach(([k, v]) => {
            if (!el.getAttribute(k)) el.setAttribute(k, v);
          });
          return;
        }
      }
    });
  }

  /* Buena parte de los formularios se generan con innerHTML después de cargar,
     así que hay que volver a pasar cuando aparecen inputs nuevos. */
  function observarInputsNuevos() {
    const aplicar = debounce(() => aplicarInputmodes(), 120);
    new MutationObserver(muts => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && (n.matches?.('input') || n.querySelector?.('input'))) { aplicar(); return; }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  /* ============================================================
     ARRANQUE
     ============================================================ */

  function init() {
    prepararToastContainer();
    montarControlTamano();
    montarCmdk();
    montarA11yModal();
    montarA11yTabs();
    montarOrdenTabla();
    montarFiltros();
    montarTecladoTabla();
    aplicarInputmodes();
    observarInputsNuevos();
    envolverFunciones();

    // Exportar CSV desde el botón de la barra de herramientas
    document.getElementById('btn-exportar-csv')?.addEventListener('click', exportarCSV);

    // Reponer filtros guardados en cuanto haya datos cargados
    document.addEventListener('crm:clientes-cargados', () => {
      if (!window._uxFiltrosRepuestos) {
        window._uxFiltrosRepuestos = true;
        if (reponerFiltros()) window.applyFilters?.();
      }
      pintarAvisoFiltros();

      /* initApp() dispara loadClientes() y navigateTo('calendario') en paralelo,
         así que el calendario se pintaba con allClientes todavía vacío y quedaba
         sin ningún evento hasta que salías y volvías a entrar. Al llegar los
         datos lo repintamos (esto también actualiza el resumen del Inicio). */
      const vistaInicio = document.getElementById('view-calendario');
      if (vistaInicio && vistaInicio.classList.contains('active')) {
        window.renderCalendario?.();
      } else {
        renderInicio();
      }
      sincronizarBarraRecordatorios();
    });

    // La barra de recordatorios repite lo que ya dice el hero: sólo en Inicio se oculta
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => setTimeout(sincronizarBarraRecordatorios, 30));
    });
    sincronizarBarraRecordatorios();
  }

  /* API pública para app.js */
  window.uiConfirm = uiConfirm;
  window.uiAlert = uiAlert;
  window.toastUndo = toastUndo;
  window.uxRenderInicio = renderInicio;
  window.uxExportarCSV = exportarCSV;
  window.uxAplicarEscala = aplicarEscala;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
