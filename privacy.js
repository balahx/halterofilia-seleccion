/* Halterofilia · Selección — aviso de privacidad (fase 5).
   Texto en lenguaje simple. Describe lo que la app hace de verdad; si cambia lo que se guarda, hay que actualizarlo y
   subir VERSION (así se vuelve a avisar a quien ya usa la app). No es asesoría legal: conviene que lo revise quien corresponda. */
(function (root) {
  'use strict';
  const VERSION = '2026-11-05';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const SECTIONS = [
    ['Quién maneja tus datos', 'Esta app es del equipo de halterofilia. El entrenador (Cristian Mateluna) administra el equipo, aprueba quién entra y es quien ve tus datos de entrenamiento. Para cualquier consulta o solicitud sobre tus datos, habla con él.'],
    ['Qué se guarda', ['Tu nombre y tu correo (la contraseña la gestiona Google en su servicio de cuentas; la app no la ve).',
      'Tus sesiones: ejercicios, kilos, repeticiones, esfuerzo percibido (RPE), horas, tu peso corporal si lo anotas, y tus notas y observaciones. Esas notas pueden hablar de molestias o dolores: son datos de salud, así que escribe solo lo que quieras compartir con tu entrenador.',
      'Tus máximos y tus ajustes.',
      'La semana del plan que el entrenador te asigna y qué sesiones cumpliste (con la hora del servidor).']],
    ['Para qué', 'Para registrar tu entrenamiento, calcular tus cargas según el plan y que tu entrenador vea tu avance y arme informes. No se usan para publicidad ni se venden.'],
    ['Quién los ve', 'Tú y el entrenador. Los otros atletas no ven tus datos. Los datos se guardan en tu dispositivo y en la base de datos en la nube del equipo (Google Firebase; la base de datos está en Santiago, Chile). La app carga además las tipografías desde Google Fonts, lo que le muestra tu dirección IP a Google.'],
    ['Cuánto tiempo', 'Mientras sigas en el equipo, o hasta que pidas borrarlos.'],
    ['Tus derechos', ['Puedes ver, corregir y llevarte tus datos: en Ajustes hay un respaldo (JSON y CSV).',
      'En Ajustes, «Borrar todos mis datos» vacía tus sesiones, máximos y perfil en tu dispositivo y en la nube. Quedan tu nombre y correo (tu cuenta) y el registro de qué sesiones cumpliste (fecha y semana).',
      'Para eliminar también eso, o para oponerte a algún uso, pídeselo al entrenador: él lo gestiona con quien administra la app.',
      'La ley chilena de protección de datos personales (Ley 19.628, reformada por la Ley 21.719, que rige desde el 1 de diciembre de 2026) reconoce derechos de acceso, rectificación, supresión, oposición y portabilidad.']]
  ];

  /* Texto del aviso como bloque HTML plegable (`open` para mostrarlo abierto) */
  function html(open) {
    let h = `<details class="priv"${open ? ' open' : ''}><summary>Aviso de privacidad</summary><div class="priv-b">`;
    SECTIONS.forEach(s => {
      h += `<h4>${esc(s[0])}</h4>`;
      h += Array.isArray(s[1]) ? '<ul>' + s[1].map(x => `<li>${esc(x)}</li>`).join('') + '</ul>' : `<p>${esc(s[1])}</p>`;
    });
    return h + `<p class="muted">Versión del ${esc(VERSION.split('-').reverse().join('-'))}.</p></div></details>`;
  }
  const text = () => SECTIONS.map(s => s[0] + '\n' + (Array.isArray(s[1]) ? s[1].map(x => '- ' + x).join('\n') : s[1])).join('\n\n');

  const api = { VERSION: VERSION, html: html, text: text, SECTIONS: SECTIONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HalterPrivacy = api;
})(typeof window !== 'undefined' ? window : globalThis);
