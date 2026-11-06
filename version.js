/* Versión de la app. Se cambia en CADA publicación (así el botón «Buscar actualización» de Ajustes sabe que hay algo nuevo
   y el service worker renueva su caché). Se muestra solo «Versión X.Y.Z» (n): sube en CADA publicación — el último número (Z) con arreglos,
   el del medio (Y) con funciones nuevas, el primero (X) con cambios grandes. v (AAAA.MM.DD.n) nombra el caché y se mantiene por compatibilidad. */
(function (root) {
  'use strict';
  const V = { n: '4.10.0', v: '2026.11.06.18', date: '2026-11-06' };   // n: lo que se muestra («Versión 4.1.4»); v: identifica el caché
  root.HALTER_VERSION = V;
  if (typeof module !== 'undefined' && module.exports) module.exports = V;
})(typeof self !== 'undefined' ? self : globalThis);
