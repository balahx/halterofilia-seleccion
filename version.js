/* Versión de la app. Se cambia en CADA publicación (así el botón «Buscar actualización» de Ajustes sabe que hay algo nuevo
   y el service worker renueva su caché). Formato: AAAA.MM.DD.n (n = número de publicación del día). */
(function (root) {
  'use strict';
  const V = { v: '2026.11.05.2', date: '2026-11-05' };
  root.HALTER_VERSION = V;
  if (typeof module !== 'undefined' && module.exports) module.exports = V;
})(typeof self !== 'undefined' ? self : globalThis);
