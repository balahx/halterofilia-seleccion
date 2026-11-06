/* Versión de la app. Se cambia en CADA publicación (así el botón «Buscar actualización» de Ajustes sabe que hay algo nuevo
   y el service worker renueva su caché). Se muestra solo «Versión N» (n, que sube de a 1 en cada publicación); v (AAAA.MM.DD.n) nombra el caché y se mantiene por compatibilidad. */
(function (root) {
  'use strict';
  const V = { n: 4, v: '2026.11.06.4', date: '2026-11-06' };   // n: el número que se muestra («Versión 4»); v: identifica el caché
  root.HALTER_VERSION = V;
  if (typeof module !== 'undefined' && module.exports) module.exports = V;
})(typeof self !== 'undefined' ? self : globalThis);
