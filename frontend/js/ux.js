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
     8. Roles ARIA del modal de cliente y de los tabs
      9. Inicio: resumen del día sobre el calendario
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
    columnas: 'crm_columnas_clientes',
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
    { key: 'fechaCarga',        label: 'Fecha de carga',    tipo: 'fechaCarga' },
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
    if (col.tipo === 'fechaCarga') {
      // fechaCarga viene DD/MM/YYYY (o ISO): se parsea a timestamp real para
      // ordenar cronológico, no como texto. Sin fecha → al final.
      const d = window.parseFechaCarga?.(v);
      return d ? d.getTime() : Number.POSITIVE_INFINITY;
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

    // La columna de checkboxes no se ordena, así que se saca del mapeo por índice
    const ordenables = [...thead.children].filter(th => !th.classList.contains('th-check'));
    ordenables.forEach((th, i) => {
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

  /* ============================================================
     6b. OCULTAR / REORDENAR COLUMNAS (se recuerda por navegador)
     Trabaja posicionalmente: la tabla es [check][8 columnas][acciones].
     Se reordenan/ocultan tanto los <th> como las celdas de cada fila,
     dejando el check siempre primero y las acciones siempre al final.
     ============================================================ */
  function leerConfigColumnas() {
    const claves = COLUMNAS.map(c => c.key);
    let cfg = { orden: [...claves], ocultas: [] };
    try {
      const g = JSON.parse(localStorage.getItem(LS.columnas) || 'null');
      if (g && Array.isArray(g.orden)) {
        cfg.orden = [
          ...g.orden.filter(k => claves.includes(k)),
          ...claves.filter(k => !g.orden.includes(k)),   // columnas nuevas al final
        ];
        cfg.ocultas = (g.ocultas || []).filter(k => claves.includes(k));
      }
    } catch { /* preferencia corrupta: se ignora */ }
    return cfg;
  }
  function guardarConfigColumnas(cfg) {
    try { localStorage.setItem(LS.columnas, JSON.stringify(cfg)); } catch {}
  }

  function aplicarConfigColumnas() {
    const cfg = leerConfigColumnas();
    const oculta = k => cfg.ocultas.includes(k);
    const thead = document.querySelector('#view-clientes .data-table thead tr');
    if (!thead) return;

    // <th> de datos, indexados por su sort-key
    const thByKey = {};
    thead.querySelectorAll('th[data-sort-key]').forEach(th => { thByKey[th.dataset.sortKey] = th; });
    const actionsTh = [...thead.children].find(th => !th.classList.contains('th-check') && !th.dataset.sortKey);

    cfg.orden.forEach(k => {
      const th = thByKey[k];
      if (!th) return;
      th.style.display = oculta(k) ? 'none' : '';
      thead.insertBefore(th, actionsTh || null);
    });

    // Cada fila: las celdas de datos vienen en el orden por defecto (COLUMNAS)
    document.querySelectorAll('#clientes-tbody tr').forEach(tr => {
      const kids = [...tr.children];
      const check = tr.querySelector('.td-check');
      const actionsTd = tr.querySelector('.acciones-col') || kids[kids.length - 1];
      const dataTds = kids.filter(td => td !== check && td !== actionsTd);
      const tdByKey = {};
      COLUMNAS.forEach((col, i) => { if (dataTds[i]) tdByKey[col.key] = dataTds[i]; });
      cfg.orden.forEach(k => {
        const td = tdByKey[k];
        if (!td) return;
        td.style.display = oculta(k) ? 'none' : '';
        tr.insertBefore(td, actionsTd || null);
      });
    });
  }

  function montarMenuColumnas() {
    const exportBtn = document.getElementById('btn-exportar-csv');
    if (!exportBtn || document.getElementById('btn-columnas')) return;

    const btn = document.createElement('button');
    btn.id = 'btn-columnas';
    btn.type = 'button';
    btn.className = exportBtn.className;
    btn.innerHTML = '☰ Columnas';

    const panel = document.createElement('div');
    panel.id = 'columnas-panel';
    panel.className = 'columnas-panel hidden';

    const cont = document.createElement('span');
    cont.className = 'columnas-wrap';
    exportBtn.parentNode.insertBefore(cont, exportBtn);
    cont.appendChild(btn);
    cont.appendChild(panel);

    const pintarPanel = () => {
      const cfg = leerConfigColumnas();
      const label = k => (COLUMNAS.find(c => c.key === k)?.label || k);
      panel.innerHTML = `<div class="columnas-panel-head">Mostrar columnas · arrastrá ⠿ para ordenar</div>`
        + cfg.orden.map(k => `
          <div class="columnas-row" data-key="${k}">
            <span class="columnas-grip" aria-hidden="true" title="Arrastrá para reordenar">⠿</span>
            <label class="columnas-check">
              <input type="checkbox" ${cfg.ocultas.includes(k) ? '' : 'checked'}> ${escHtml(label(k))}
            </label>
          </div>`).join('')
        + `<button type="button" id="columnas-reset" class="columnas-reset">Restablecer</button>`;
    };

    const abrir = () => { pintarPanel(); panel.classList.remove('hidden'); };
    const cerrar = () => panel.classList.add('hidden');

    btn.addEventListener('click', e => {
      e.stopPropagation();
      panel.classList.contains('hidden') ? abrir() : cerrar();
    });
    document.addEventListener('click', e => {
      if (!cont.contains(e.target)) cerrar();
    });

    panel.addEventListener('change', e => {
      const row = e.target.closest('.columnas-row');
      if (!row) return;
      const k = row.dataset.key;
      const cfg = leerConfigColumnas();
      const set = new Set(cfg.ocultas);
      e.target.checked ? set.delete(k) : set.add(k);
      cfg.ocultas = [...set];
      guardarConfigColumnas(cfg);
      aplicarConfigColumnas();
    });

    panel.addEventListener('click', e => {
      if (e.target.id === 'columnas-reset') {
        try { localStorage.removeItem(LS.columnas); } catch {}
        aplicarConfigColumnas();
        pintarPanel();
      }
    });

    // Reordenar arrastrando desde el asa ⠿ (mouse + touch)
    window.enableTouchDragReorder?.(panel, '.columnas-row', '.columnas-grip', rows => {
      const cfg = leerConfigColumnas();
      cfg.orden = rows.map(r => r.dataset.key);
      guardarConfigColumnas(cfg);
      aplicarConfigColumnas();
    });
  }

  /* --- CSV de la vista actual (respeta filtros y orden) --- */
  const CSV_COLS = [
    ['Nombre', 'apellidoNombre'], ['Teléfono', 'telefono'], ['Gmail', 'gmail'],
    ['Tipo de evento', 'tipoEvento'], ['Fecha del evento', 'fechaEvento'],
    ['Invitados', 'cantidadInvitados'], ['Turno', 'turno'], ['Estado', 'estado'],
    ['Próximo seguimiento', 'proximoSeguimiento'], ['Origen', 'origen'],
    ['Fecha de carga', 'fechaCarga'], ['Cargado por', 'cargadoPor'],
  ];

  function exportarCSV(soloEstos = null) {
    // Sin argumento exporta lo que se está viendo; con lista, sólo esos
    // (lo usa la barra de selección múltiple).
    const lista = soloEstos && soloEstos.length ? soloEstos
                : ultimaVista.length ? ultimaVista
                : getClientes();
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
     8. MODAL DE CLIENTE Y TABS
     Antes: sin role, sin aria-modal y Esc no cerraba.
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
      if (document.querySelector('.uic-overlay')) return;
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

      // Sólo aria-selected. NO se toca tabIndex: son <button>, ya se alcanzan
      // solos, y el tabIndex=-1 del patrón de flechas los volvía inalcanzables.
      const sincronizar = () => btns.forEach(b => {
        b.setAttribute('aria-selected', String(b.classList.contains('active')));
      });
      sincronizar();
      new MutationObserver(sincronizar).observe(lista, {
        subtree: true, attributes: true, attributeFilter: ['class'],
      });
    });
  }

  /* ============================================================
     8.b SELECCIÓN MÚLTIPLE Y ACCIONES MASIVAS
     Patrón NN/g: los checkboxes viven en la tabla, la barra de acciones
     aparece sólo cuando hay algo seleccionado, y toda acción se puede deshacer.

     A propósito NO hay borrado masivo: es la única acción de esta lista que no
     se puede revertir con un botón, y equivocarse ahí sale muy caro.
     ============================================================ */

  const seleccion = new Set();   // ids de clientes tildados

  function clientesSeleccionados() {
    return getClientes().filter(c => seleccion.has(c.id));
  }

  /* Inyecta la columna de checkboxes. Se hace desde acá y no en el HTML para no
     tocar renderClientes() de app.js, que arma las filas con innerHTML. */
  function montarColumnaSeleccion() {
    const thead = document.querySelector('#view-clientes .data-table thead tr');
    if (!thead || thead.dataset.selReady) return;
    thead.dataset.selReady = '1';

    const th = document.createElement('th');
    th.className = 'th-check';
    th.innerHTML = `<input type="checkbox" id="check-todos"
                           aria-label="Seleccionar todos los clientes de la lista">`;
    thead.insertBefore(th, thead.firstChild);

    th.querySelector('#check-todos').addEventListener('change', e => {
      const marcar = e.target.checked;
      ultimaVista.forEach(c => marcar ? seleccion.add(c.id) : seleccion.delete(c.id));
      pintarChecks();
      pintarBarraSeleccion();
    });
  }

  /* Agrega la celda del checkbox a cada fila recién pintada */
  function inyectarChecksEnFilas() {
    const tbody = document.getElementById('clientes-tbody');
    if (!tbody) return;
    const filas = [...tbody.querySelectorAll('tr')];

    filas.forEach((tr, i) => {
      if (tr.querySelector('.td-check')) return;
      const c = ultimaVista[i];
      if (!c) return;

      const td = document.createElement('td');
      td.className = 'td-check';
      td.innerHTML = `<input type="checkbox" class="check-cliente" data-id="${escHtml(c.id)}"
                             aria-label="Seleccionar ${escHtml(c.apellidoNombre || 'cliente')}">`;
      tr.insertBefore(td, tr.firstChild);

      // Tildar no debe abrir la ficha (la fila entera es clickeable)
      td.addEventListener('click', e => e.stopPropagation());
      td.querySelector('input').addEventListener('change', e => {
        e.stopPropagation();
        e.target.checked ? seleccion.add(c.id) : seleccion.delete(c.id);
        pintarChecks();
        pintarBarraSeleccion();
      });
    });

    pintarChecks();
    pintarBarraSeleccion();
  }

  function pintarChecks() {
    document.querySelectorAll('#clientes-tbody .check-cliente').forEach(inp => {
      const marcado = seleccion.has(inp.dataset.id);
      inp.checked = marcado;
      inp.closest('tr')?.classList.toggle('tr-seleccionada', marcado);
    });

    const todos = document.getElementById('check-todos');
    if (todos) {
      const visibles = ultimaVista.length;
      const marcados = ultimaVista.filter(c => seleccion.has(c.id)).length;
      todos.checked = visibles > 0 && marcados === visibles;
      // Estado intermedio: algunos sí, otros no
      todos.indeterminate = marcados > 0 && marcados < visibles;
    }
  }

  function limpiarSeleccion() {
    seleccion.clear();
    pintarChecks();
    pintarBarraSeleccion();
  }

  function pintarBarraSeleccion() {
    let barra = document.getElementById('barra-seleccion');
    const n = seleccion.size;

    // La clase le da aire al pie del contenido para que la barra no tape filas
    document.body.classList.toggle('hay-seleccion', n > 0);

    if (!n) { barra?.remove(); return; }

    if (!barra) {
      barra = document.createElement('div');
      barra.id = 'barra-seleccion';
      barra.className = 'barra-seleccion';
      barra.setAttribute('role', 'region');
      barra.setAttribute('aria-label', 'Acciones sobre los clientes seleccionados');
      document.body.appendChild(barra);
    }

    barra.innerHTML = `
      <span class="bsel-count">${n} seleccionado${n > 1 ? 's' : ''}</span>
      <div class="bsel-acciones">
        <label class="bsel-campo">
          <span>Cambiar estado a</span>
          <select id="bsel-estado" aria-label="Nuevo estado para los seleccionados">
            <option value="">Elegir...</option>
            ${ORDEN_ESTADO.map(e => `<option>${e}</option>`).join('')}
          </select>
        </label>
        <label class="bsel-campo">
          <span>Agendar para</span>
          <input type="date" id="bsel-fecha" aria-label="Nueva fecha de seguimiento">
        </label>
        <button type="button" class="btn btn-secondary btn-sm" id="bsel-csv">⬇ Exportar</button>
      </div>
      <button type="button" class="bsel-cerrar" id="bsel-cerrar"
              aria-label="Quitar la selección">✕</button>`;

    barra.querySelector('#bsel-cerrar').addEventListener('click', limpiarSeleccion);
    barra.querySelector('#bsel-estado').addEventListener('change', e => {
      const nuevo = e.target.value;
      e.target.value = '';
      if (nuevo) aplicarMasivo({ estado: nuevo }, `estado → ${nuevo}`);
    });
    barra.querySelector('#bsel-fecha').addEventListener('change', e => {
      const fecha = e.target.value;
      e.target.value = '';
      if (fecha) aplicarMasivo({ proximoSeguimiento: fecha },
                               `seguimiento → ${window.formatDate?.(fecha) || fecha}`);
    });
    barra.querySelector('#bsel-csv').addEventListener('click', () => {
      exportarCSV(clientesSeleccionados());
    });
  }

  /* Aplica un cambio a todos los seleccionados, de a uno.

     Van en serie a propósito: Google Sheets limita las escrituras por minuto y
     30 PUT en paralelo devuelven 429. Con progreso visible, porque sobre Sheets
     esto tarda de verdad. */
  async function aplicarMasivo(cambios, etiqueta) {
    const lista = clientesSeleccionados();
    if (!lista.length) return;

    const ok = await uiConfirm({
      titulo: `¿Aplicar el cambio a ${lista.length} cliente${lista.length > 1 ? 's' : ''}?`,
      mensaje: `Se va a cambiar el ${etiqueta} en:\n\n`
             + lista.slice(0, 8).map(c => `· ${c.apellidoNombre}`).join('\n')
             + (lista.length > 8 ? `\n· … y ${lista.length - 8} más` : ''),
      confirmar: 'Sí, aplicar',
      icono: '✏️',
    });
    if (!ok) return;

    // Guardamos los valores previos para poder deshacer
    const campos = Object.keys(cambios);
    const previos = lista.map(c => ({
      cliente: c,
      antes: Object.fromEntries(campos.map(k => [k, c[k]])),
    }));

    const fallidos = await escribirEnSerie(lista, cambios, etiqueta);

    allClientes = await apiFetch('/clientes');
    window.applyFilters?.();
    window.renderRemindersBar?.();
    document.dispatchEvent(new CustomEvent('crm:clientes-cargados'));
    limpiarSeleccion();

    if (fallidos.length) {
      toast(`${fallidos.length} de ${lista.length} no se pudieron guardar: ${fallidos[0].error}`, 'error');
      return;
    }

    toastUndo(`${lista.length} cliente${lista.length > 1 ? 's' : ''} actualizado${lista.length > 1 ? 's' : ''}`,
      async () => {
        // Deshacer: devolver cada uno a su valor anterior
        for (const { cliente, antes } of previos) {
          const actual = getClientes().find(x => x.id === cliente.id) || cliente;
          await apiFetch(`/clientes/${actual.rowIndex}`, {
            method: 'PUT',
            body: window.buildClienteBody(actual, antes),
          });
        }
        allClientes = await apiFetch('/clientes');
        window.applyFilters?.();
        window.renderRemindersBar?.();
        document.dispatchEvent(new CustomEvent('crm:clientes-cargados'));
        toast('Cambio deshecho');
      }, { segundos: 12 });
  }

  async function escribirEnSerie(lista, cambios, etiqueta) {
    const fallidos = [];
    const barra = document.getElementById('barra-seleccion');
    const pintarProgreso = i => {
      if (!barra) return;
      barra.innerHTML = `<span class="bsel-count">Guardando ${i} de ${lista.length}…</span>
        <div class="bsel-progreso"><span style="width:${(i / lista.length) * 100}%"></span></div>`;
    };
    pintarProgreso(0);

    for (let i = 0; i < lista.length; i++) {
      const c = lista[i];
      try {
        await apiFetch(`/clientes/${c.rowIndex}`, {
          method: 'PUT',
          body: window.buildClienteBody(c, cambios),
        });
      } catch (err) {
        fallidos.push({ cliente: c, error: err.message });
      }
      pintarProgreso(i + 1);
    }
    return fallidos;
  }

  /* ============================================================
     9. INICIO — RESUMEN DEL DÍA SOBRE EL CALENDARIO
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
        montarColumnaSeleccion();
        inyectarChecksEnFilas();
        aplicarConfigColumnas();
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
    }

    ['filter-estado', 'filter-origen', 'filter-evento'].forEach(id => {
      const sel = reemplazarNodo(id);
      sel?.addEventListener('change', () => window.applyFilters?.());
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
    montarA11yModal();
    montarA11yTabs();
    montarOrdenTabla();
    montarColumnaSeleccion();
    montarMenuColumnas();
    montarFiltros();
    aplicarInputmodes();
    observarInputsNuevos();
    envolverFunciones();

    // Exportar CSV desde el botón de la barra de herramientas
    document.getElementById('btn-exportar-csv')?.addEventListener('click', () => exportarCSV());

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
