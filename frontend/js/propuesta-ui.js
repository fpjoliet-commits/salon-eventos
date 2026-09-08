/* ============================================================
   PROPUESTA COMERCIAL — CAPA DE INTERACCIÓN
   ------------------------------------------------------------
   Movimiento, feedback táctil y escenografía del creador.
   Se carga DESPUÉS de app.js: usa propuestaState y
   goToPropuestaSlide, y publica en window los ganchos que app.js
   llama con ?. (updatePropuestaScenery, syncPropuestaGrupos).
   ============================================================ */

/* ============================================================
   PROPUESTA — CAPA VIVA (interacción)
   Feedback físico al elegir: ripple donde toca el dedo, pop
   elástico, atenuado de las opciones no elegidas, navegación
   por teclado y un fondo que sigue apenas al puntero.
   Todo delegado: también alcanza a lo que se construye después
   (gastronomía, recorrido, resumen).
   ============================================================ */
(function initPropuestaMotion() {
  const view = document.getElementById('view-propuesta');
  if (!view) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const RIPPLE_SEL = [
    '.propuesta-card', '.estilo-fork-card', '.adicional-card', '.espacio-card',
    '.propuesta-servicio-item', '.counter-btn', '.btn-propuesta-primary',
    '.btn-propuesta-nav', '.propuesta-close-btn', '.btn-propuesta-secondary',
    '.gastro-island-row', '.gastro-menu-row', '.gastro-plato-row', '.gastro-premium-row'
  ].join(',');

  // Grupos de elección única: al haber una elegida, el resto se atenúa
  const GRUPOS = ['evento-cards', 'turno-cards', 'espacio-cards', 'estilo-cards'];
  function syncGrupos() {
    GRUPOS.forEach(id => {
      const g = document.getElementById(id);
      if (g) g.classList.toggle('has-pick', !!g.querySelector('.selected'));
    });
  }
  window.syncPropuestaGrupos = syncGrupos;

  view.addEventListener('pointerdown', e => {
    const target = e.target.closest(RIPPLE_SEL);
    if (!target || reduce) return;

    // Ripple desde el punto exacto del click
    const r = target.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.2;
    const ink = document.createElement('span');
    ink.className = 'prop-ripple';
    ink.style.width = ink.style.height = size + 'px';
    ink.style.left = (e.clientX - r.left) + 'px';
    ink.style.top = (e.clientY - r.top) + 'px';
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    target.appendChild(ink);
    setTimeout(() => ink.remove(), 650);
  });

  view.addEventListener('click', e => {
    const target = e.target.closest(RIPPLE_SEL);
    if (target && !reduce) {
      target.classList.remove('prop-pop');
      void target.offsetWidth;
      target.classList.add('prop-pop');
      setTimeout(() => target.classList.remove('prop-pop'), 480);
    }
    // El estado .selected lo escriben los handlers propios: sincronizamos después
    setTimeout(() => { syncGrupos(); window.updatePropuestaScenery?.(); }, 0);
  });

  // Navegación por teclado: flechas y Enter mueven la propuesta
  document.addEventListener('keydown', e => {
    if (!view.classList.contains('active')) return;
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.key === 'ArrowRight') { e.preventDefault(); document.getElementById('btn-prop-next')?.click(); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); document.getElementById('btn-prop-prev')?.click(); }
  });

  // Los dots son navegables: saltar a un paso ya recorrido
  document.getElementById('propuesta-step-dots')?.addEventListener('click', e => {
    const dots = [...document.querySelectorAll('.propuesta-dot')];
    const i = dots.indexOf(e.target);
    if (i < 0 || typeof goToPropuestaSlide !== 'function') return;
    const n = i + 1;
    const cont = document.querySelector('.propuesta-slides-container');
    cont?.classList.toggle('slides-going-back', n < propuestaState.current);
    if (n !== propuestaState.current) goToPropuestaSlide(n);
  });

  // ---- Deslizar entre pasos (tablet) ----
  // La presentación se hace muchas veces en tablet: pasar de paso tiene que
  // poder hacerse con el pulgar, no solo con los botones de abajo.
  const cont = document.querySelector('.propuesta-slides-container');
  if (cont) {
    let x0 = 0, y0 = 0, t0 = 0, tracking = false;
    cont.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) { tracking = false; return; }
      // No robamos el gesto sobre algo que se maneja deslizando
      if (e.target.closest('input, textarea, select, .propuesta-textarea')) { tracking = false; return; }
      const t = e.touches[0];
      x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); tracking = true;
    }, { passive: true });

    cont.addEventListener('touchend', e => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      const dt = Date.now() - t0;
      // Horizontal, decidido y sin ser un scroll vertical disfrazado
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.8 || dt > 700) return;
      if (dx < 0) document.getElementById('btn-prop-next')?.click();
      else        document.getElementById('btn-prop-prev')?.click();
    }, { passive: true });
  }

  // Al reconstruir slides dinámicos, mantener los grupos en sincronía
  document.addEventListener('DOMContentLoaded', syncGrupos);
  syncGrupos();
})();

/* ============================================================
   PROPUESTA — ESCENOGRAFÍA
   El fondo no es decorativo porque sí: cuenta en qué momento del
   camino estamos y qué se eligió. Elegís Boda y empiezan a caer
   pétalos; elegís Noche y sale la luna; llegás al banquete y sube
   el vapor. Todo SVG + CSS (nada de GIFs: pesan y no se adaptan
   al color del salón), decorativo y sin capturar clicks.
   ============================================================ */
(function initPropuestaScenery() {
  const host = document.getElementById('kiosco-scenery');
  if (!host) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  // En tablet bajamos la cantidad de partículas: mismo clima, menos GPU
  const dens = coarse ? .55 : 1;

  const rnd = (a, b) => a + Math.random() * (b - a);

  // Lluvia / ascenso de partículas: n piezas con ritmos distintos para que
  // el patrón nunca se lea como un bucle
  function field(n, cls, svg, opt = {}) {
    const { dur = [9, 16], delay = [0, 12], size = [14, 30], drift = true } = opt;
    let out = '';
    for (let i = 0; i < Math.round(n * dens); i++) {
      const s = rnd(size[0], size[1]);
      out += `<span class="sc-item ${cls}" style="
        left:${rnd(-4, 100)}%;
        width:${s}px;height:${s}px;
        animation-duration:${rnd(dur[0], dur[1]).toFixed(1)}s;
        animation-delay:${(-rnd(delay[0], delay[1])).toFixed(1)}s;
        --sway:${drift ? rnd(-70, 70).toFixed(0) : 0}px;
        --spin:${rnd(-320, 320).toFixed(0)}deg;
        opacity:${rnd(.25, .7).toFixed(2)};
      ">${svg}</span>`;
    }
    return out;
  }

  // ---- Piezas ----
  const PETALO = `<svg viewBox="0 0 24 24"><path d="M12 2C7 7 4 12 6 17c2 4 8 6 12 3 4-3 4-9 1-13-2-3-5-4-7-5z" fill="currentColor"/></svg>`;
  const DESTELLO = `<svg viewBox="0 0 24 24"><path d="M12 0l2.4 8.2L22 12l-7.6 3.8L12 24l-2.4-8.2L2 12l7.6-3.8z" fill="currentColor"/></svg>`;
  const CONFETI = `<svg viewBox="0 0 12 20"><rect width="12" height="20" rx="2" fill="currentColor"/></svg>`;
  const HOJA = `<svg viewBox="0 0 24 24"><path d="M22 2C10 3 3 9 3 17c0 2 1 4 2 5 1-8 7-14 15-16-6 4-10 8-12 15 8 1 14-6 14-19z" fill="currentColor"/></svg>`;
  const BURBUJA = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8.5" cy="8.5" r="2.4" fill="currentColor" opacity=".5"/></svg>`;
  const PLUMA = `<svg viewBox="0 0 24 24"><path d="M20 3c-7 0-13 5-14 12l-2 6 6-2c7-1 12-7 12-14zM8 17c1-5 5-9 10-10-3 4-6 8-10 10z" fill="currentColor"/></svg>`;
  const NOTA = `<svg viewBox="0 0 24 24"><path d="M9 18V5l10-2v13" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="6.5" cy="18" r="2.8" fill="currentColor"/><circle cx="16.5" cy="16" r="2.8" fill="currentColor"/></svg>`;

  // ---- Escenas fijas (piezas grandes, no partículas) ----
  const SOL = `
    <div class="sc-sol">
      <span class="sc-sol-corona"></span>
      <span class="sc-sol-disco"></span>
      <span class="sc-sol-halo"></span>
    </div>`;

  const LUNA = `
    <div class="sc-luna">
      <span class="sc-luna-halo"></span>
      <img class="sc-luna-img" src="img/propuesta/luna.webp" alt="" loading="lazy">
    </div>
    <div class="sc-stars">
      ${Array.from({ length: Math.round(30 * dens) }, () =>
        `<i style="left:${rnd(2, 98).toFixed(1)}%;top:${rnd(3, 78).toFixed(1)}%;
           animation-delay:${rnd(0, 5).toFixed(1)}s;
           animation-duration:${rnd(2.4, 6).toFixed(1)}s;
           transform:scale(${rnd(.6, 1.5).toFixed(2)})"></i>`).join('')}
    </div>`;

  // Salón interior: la bola es la del propio salón, recortada de la foto de
  // la fiesta. Dibujarla quedaba a caricatura. No gira (una foto girando se
  // nota falsa): lo que se mueve son sus reflejos, que es lo que uno ve.
  const ESPEJOS = `
    <div class="sc-bola">
      <span class="sc-bola-hilo"></span>
      <img class="sc-bola-img" src="img/propuesta/bola-espejo.webp" alt="" loading="lazy">
    </div>
    <div class="sc-haces">
      <span class="sc-haz sc-haz-1"></span>
      <span class="sc-haz sc-haz-2"></span>
      <span class="sc-haz sc-haz-3"></span>
    </div>
    <div class="sc-glints">
      ${Array.from({ length: Math.round(34 * dens) }, () =>
        `<i style="left:${rnd(0, 100).toFixed(1)}%;top:${rnd(4, 94).toFixed(1)}%;
           animation-delay:${rnd(0, 5).toFixed(1)}s;
           animation-duration:${rnd(2.4, 5.5).toFixed(1)}s;
           transform:scale(${rnd(.7, 1.6).toFixed(2)})"></i>`).join('')}
    </div>`;

  // Follaje que se mece en los dos bordes + luciérnagas
  const FOLLAJE = `
    <div class="sc-fronda sc-fronda-izq">${HOJA}${HOJA}${HOJA}</div>
    <div class="sc-fronda sc-fronda-der">${HOJA}${HOJA}${HOJA}</div>
    <div class="sc-fireflies">
      ${Array.from({ length: Math.round(14 * dens) }, () =>
        `<i style="left:${rnd(4, 96).toFixed(1)}%;top:${rnd(20, 88).toFixed(1)}%;
           animation-delay:${rnd(0, 8).toFixed(1)}s;
           animation-duration:${rnd(7, 14).toFixed(1)}s;
           --fx:${rnd(-90, 90).toFixed(0)}px;--fy:${rnd(-70, 40).toFixed(0)}px"></i>`).join('')}
    </div>`;

  // Vapor: el banquete que sale de la cocina
  const VAPOR = `
    <div class="sc-steam">
      ${Array.from({ length: Math.round(7 * dens) }, (_, i) =>
        `<svg viewBox="0 0 40 120" style="left:${8 + i * 13}%;
           animation-delay:${(-rnd(0, 9)).toFixed(1)}s;
           animation-duration:${rnd(9, 15).toFixed(1)}s">
           <path d="M20 120C6 96 34 88 20 64 6 40 34 30 20 4" stroke="currentColor"
             stroke-width="3" fill="none" stroke-linecap="round"/>
         </svg>`).join('')}
    </div>`;

  // Copas que brindan al final
  const BRINDIS = `
    <div class="sc-brindis">
      <svg viewBox="0 0 200 120">
        <g class="sc-copa sc-copa-izq">
          <path d="M56 18h34l-6 26a11 11 0 0 1-22 0z" fill="currentColor" opacity=".35"/>
          <path d="M73 55v34" stroke="currentColor" stroke-width="2.5" opacity=".4"/>
          <path d="M60 92h26" stroke="currentColor" stroke-width="2.5" opacity=".4"/>
        </g>
        <g class="sc-copa sc-copa-der">
          <path d="M110 18h34l-6 26a11 11 0 0 1-22 0z" fill="currentColor" opacity=".35"/>
          <path d="M127 55v34" stroke="currentColor" stroke-width="2.5" opacity=".4"/>
          <path d="M114 92h26" stroke="currentColor" stroke-width="2.5" opacity=".4"/>
        </g>
      </svg>
    </div>`;

  // El recorrido: una línea de oro que se dibuja sola, como el hilo de la noche
  const HILO = `
    <div class="sc-hilo">
      <svg viewBox="0 0 1200 300" preserveAspectRatio="none">
        <path d="M-20 210C180 210 200 70 400 70s230 160 430 160 210-130 410-130"
          stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
      </svg>
    </div>`;

  // ---- Qué se muestra en cada momento del camino ----
  function sceneFor(n, d) {
    const diurno = d.turno === 'Almuerzo' || d.turno === 'Tarde';

    // Lo elegido manda por sobre el paso: si ya hay tipo de evento, el clima
    // del evento acompaña el resto del camino
    const porEvento = {
      'Boda':        () => field(13, 'sc-fall sc-rosa', PETALO, { size: [16, 34] }),
      'XV años':     () => field(16, 'sc-fall sc-oro',  DESTELLO, { size: [10, 24], dur: [7, 14] }),
      'Cumpleaños':  () => field(14, 'sc-fall sc-confeti', CONFETI, { size: [9, 18], dur: [7, 13] }),
      'Bautismo':    () => field(11, 'sc-fall sc-nube', PLUMA, { size: [16, 30], dur: [12, 20] }),
      'Comunión':    () => field(11, 'sc-fall sc-nube', HOJA, { size: [14, 26], dur: [12, 20] }),
      'Egresados':   () => field(16, 'sc-fall sc-confeti', CONFETI, { size: [8, 16], dur: [6, 12] }),
      'Corporativo': () => field(8,  'sc-rise sc-sobrio', BURBUJA, { size: [12, 26], dur: [14, 22] }),
    };
    const clima = porEvento[d.tipoEvento] ? porEvento[d.tipoEvento]() : '';

    switch (n) {
      case 1:  // Portada
        return clima || field(10, 'sc-rise sc-oro', DESTELLO, { size: [8, 18], dur: [12, 20] });
      case 2:  // Cómo lo imaginás
        return clima;
      case 3:  // Qué festejamos — acá se ve el efecto de elegir
        return clima;
      case 4:  // Cuándo es — sale el sol o la luna
        return (!d.turno ? '' : diurno ? SOL : LUNA) + clima;
      case 5:  // Cuántos van a ser
        return clima || field(10, 'sc-rise sc-oro', BURBUJA, { size: [10, 22], dur: [12, 20] });
      case 6:  // Dónde los recibimos
        return (d.espacio === 'Interior'  ? ESPEJOS
             :  d.espacio === 'Jardín'    ? FOLLAJE
             :  d.espacio === 'Combinado' ? ESPEJOS + FOLLAJE
             :  '') + clima;
      case 7:  // El recorrido
        return HILO + clima;
      case 8:  // Hacelo único
        return field(14, 'sc-fall sc-confeti', CONFETI, { size: [8, 16], dur: [6, 12] })
             + field(6, 'sc-rise sc-oro', NOTA, { size: [16, 28], dur: [13, 20] });
      case 9:  // El banquete
        return VAPOR;
      case 10: // Algo más
        return clima;
      case 11: // Tu propuesta está lista
        return BRINDIS
             + field(18, 'sc-fall sc-oro', CONFETI, { size: [8, 18], dur: [7, 13] })
             + field(8, 'sc-rise sc-oro', DESTELLO, { size: [10, 22], dur: [11, 18] });
      default:
        return clima;
    }
  }

  let firma = '';
  function update() {
    if (typeof propuestaState === 'undefined') return;
    const d = propuestaState.data || {};
    const n = propuestaState.current;
    // Solo redibujamos cuando cambia de verdad: si no, las partículas
    // reinician su recorrido en cada click y se nota
    const nueva = `${n}|${d.tipoEvento}|${d.turno}|${d.espacio}`;
    if (nueva === firma) return;
    firma = nueva;

    if (reduce) { host.innerHTML = ''; return; }

    host.classList.add('fading');
    setTimeout(() => {
      host.innerHTML = sceneFor(n, d);
      host.classList.remove('fading');
    }, 260);
  }

  window.updatePropuestaScenery = update;
  update();
})();
