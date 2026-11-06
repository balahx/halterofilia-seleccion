/* Service worker: permite abrir la app sin conexión.
   Estrategia: red primero (así se ven las actualizaciones), con respaldo en caché. */
importScripts('version.js');   // define HALTER_VERSION: cada versión nueva usa un caché nuevo y borra el anterior
const CACHE = 'halterofilia-' + self.HALTER_VERSION.v;
const ASSETS = ['./', './index.html', './styles.css', './app.js', './cloud.js', './sync.js', './plan-import.js', './plan-ui.js', './privacy.js', './assign.js', './report.js', './guard.js', './version.js', './update.js', './backup.js', './compare.js', './firebase-config.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/wl-marca-claro.svg', './icons/wl-marca-oscuro.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  const ok = u.origin === self.location.origin
    || (u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/')) // SDK de Firebase
    || (u.hostname === 'cdnjs.cloudflare.com' && u.pathname.startsWith('/ajax/libs/xlsx/')) // lector de Excel
    || u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';  // tipografías
  if (req.method !== 'GET' || !ok) return;
  if (u.pathname.endsWith('/version.js') && u.searchParams.has('t')) return;   // la comprobación de versión va directo a la red y no se guarda
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});
