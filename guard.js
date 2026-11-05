/* Halterofilia · Selección — antifraude de marcos: si alguien intenta mostrar la app dentro de otra página (para engañar
   con clics encima, «clickjacking»), la oculta. La política de contenido en <meta> no puede prohibir marcos, por eso existe este archivo. */
(function () {
  'use strict';
  let framed = false;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }
  if (framed) { document.documentElement.style.display = 'none'; try { window.top.location = window.self.location; } catch (e) { /* bloqueado: queda oculta */ } }
})();
