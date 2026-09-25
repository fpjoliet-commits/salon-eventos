/* Service worker del CRM: guarda la parte visual de la app en el dispositivo.
 *
 * Qué se guarda y cómo:
 * - Archivos con ?v=... (app.js, css): se sirven desde el dispositivo sin preguntar.
 *   Son inmutables: al subir un cambio se cambia la versión en index.html y el
 *   navegador pide el archivo nuevo.
 * - index.html y demás páginas/archivos sin versión: siempre se piden a Render y
 *   no se guardan. Decisión del dueño: prefiere esperar a que Render despierte
 *   antes que ver una versión vieja de la app.
 * - Tipografías de Google: se muestran las guardadas y se refrescan por detrás.
 *
 * Nunca se guarda /api/ (datos de clientes, cobros, sesiones) ni nada que no sea GET.
 */
const CACHE = 'crm-joliet-v2';
const BASE = ['/img/icons/icon-192.png', '/img/icons/favicon-48.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function primeroGuardado(req) {
  const cache = await caches.open(CACHE);
  const guardado = await cache.match(req);
  if (guardado) return guardado;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function guardadoYRefrescar(req) {
  const cache = await caches.open(CACHE);
  const guardado = await cache.match(req);
  const red = fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  }).catch(() => guardado);
  return guardado || red;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return;
    if (url.searchParams.has('v')) return e.respondWith(primeroGuardado(req));
    return; // páginas: directo a Render, sin copia guardada
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    return e.respondWith(guardadoYRefrescar(req));
  }
});
