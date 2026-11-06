import { esc } from './logic.js';

export const IC = {
  hoy: '<path d="M3.5 11L12 4l8.5 7"/><path d="M5.5 9.8V20h13V9.8"/><path d="M10 20v-5.5h4V20"/>',
  plan: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  prog: '<path d="M3 18l5.5-6 4 3.5L21 6"/><path d="M15 6h6v6"/>',
  max: '<path d="M2.5 9.5v5M5.5 7v10M18.5 7v10M21.5 9.5v5M5.5 12h13"/>',
  gear: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  semana: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14.5l2.2 2.2 4.3-4.4"/>',
  team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.3a3 3 0 010 5.4M18.5 14c1.6.7 2.8 2.3 2.8 4.5"/>',
  file: '<path d="M6.5 3h7l4.5 4.5V21h-11.5z"/><path d="M13.5 3v4.5H18M9.5 12.5h5M9.5 16h5"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  chev: '<path d="M9 5.5l6.5 6.5L9 18.5"/>',
  cloud: '<path d="M7 18a4 4 0 010-8 5 5 0 019.6-1A4.5 4.5 0 0117 18z"/><path d="M9.5 13.5l2 2 3.5-3.5"/>',
  out: '<path d="M10 4.5H6a1.5 1.5 0 00-1.5 1.5v12A1.5 1.5 0 006 19.5h4"/><path d="M15 8l4 4-4 4M19 12H9.5"/>',
  timer: '<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V9.5M9.5 3h5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  play: '<path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor"/>',
  pause: '<path d="M8 5.5v13M16 5.5v13" stroke-width="3"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.6-5.9M4 4.5V9h4.5"/>',
  hist: '<path d="M4 12a8 8 0 1 0 2.6-5.9M4 4.5V9h4.5"/><path d="M12 8v4.5l3 1.8"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M8 6H5v1.5A3 3 0 008 10.5M16 6h3v1.5a3 3 0 01-3 3M12 13v4M8.5 20h7M10 17h4"/>',
  warn: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  scale: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 9.5a4.5 4.5 0 017 0M12 14l2-3"/>'
};
export function svg(n, c) {
  return '<svg class="ic ' + (c || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[n] + '</svg>';
}
/* Estado vacío común: icono, título, texto y (opcional) un botón. `text` y `action` son HTML ya escapado. */
export function emptyHTML(ico, title, text, action) {
  return '<div class="empty"><span class="empty-ic">' + svg(ico) + '</span><b>' + esc(title) + '</b>' + (text ? '<p>' + text + '</p>' : '') + (action || '') + '</div>';
}
/* Aviso de error con pantalla propia: icono, título, mensaje y (opcional) «Reintentar». `msg` es texto plano. */
export function errorHTML(msg, o) {
  o = o || {};
  return '<div class="errbox" role="alert"><span class="errbox-ic">' + svg('warn') + '</span><div><b>' + esc(o.title || 'No se pudo cargar') + '</b><p>' + esc(msg) + '</p>' +
    (o.retry ? '<button class="btn sm" data-act="' + esc(o.retry) + '">Reintentar</button>' : '') + '</div></div>';
}
