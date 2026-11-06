/* Halterofilia · Selección — «Buscar actualización» (Ajustes) y versión de la app.
   Compara la versión que corre con la publicada (version.js, siempre pedida a la red). Si hay una nueva, «Actualizar ahora»
   renueva el service worker y recarga la página: la sesión de la cuenta y los datos guardados se conservan (no hay que ingresar otra vez).
   Parte pura (parseVersion, newer) probada con Node: node tests/update-unit.js */
(function (root) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  /* Lee { n, v, date } del texto de version.js (sin ejecutarlo) */
  function parseVersion(text) {
    const v = /v:\s*'([^']+)'/.exec(text || ''), d = /date:\s*'([^']+)'/.exec(text || ''), n = /\bn:\s*(?:'(\d+(?:\.\d+)*)'|(\d+))/.exec(text || '');
    return v ? { n: n ? (n[1] || n[2]) : null, v: v[1], date: d ? d[1] : '' } : null;
  }
  /* ¿La versión publicada es más nueva? Por número («Versión 4.1.1», compara cada parte como número: 4.10.0 > 4.9.0); si alguna no lo trae, por el texto AAAA.MM.DD.n */
  const hasN = x => x && x.n != null && /^\d+(\.\d+)*$/.test(String(x.n));
  function isNewer(remote, local) {
    if (!remote || !local) return false;
    if (hasN(remote) && hasN(local)) return newer(remote.n, local.n);
    return newer(remote.v, local.v);
  }
  /* ¿`remote` es más nueva que `local`? Compara cada parte como número: 2026.11.05.2 > 2026.11.05.1; 4.1.2 > 4.1.1 */
  function newer(remote, local) {
    if (!remote || !local) return false;
    const a = String(remote).split('.').map(Number), b = String(local).split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] || 0, y = b[i] || 0; if (x !== y) return x > y; }
    return false;
  }
  function dateText(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return '';
    return Number(m[3]) + ' ' + MESES[Number(m[2]) - 1] + ' ' + m[1];
  }
  const current = () => root.HALTER_VERSION || { n: null, v: '?', date: '' };
  const label = x => hasN(x) ? String(x.n) : (x && x.v) || '?';
  const versionText = () => 'Versión ' + label(current());

  /* ---------- Estado y acciones (solo navegador) ---------- */
  const U = { state: 'idle', remote: null, at: 0, msg: '' };   // idle | checking | latest | new | applying | error
  const hasDom = typeof document !== 'undefined';

  async function check(force) {
    if (U.state === 'checking' || U.state === 'applying') return;
    if (!force && U.at && Date.now() - U.at < 60000) return;
    U.state = 'checking'; U.msg = ''; paint();
    try {
      const res = await fetch('version.js?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const r = parseVersion(await res.text());
      if (!r) throw new Error('respuesta inesperada');
      U.remote = r; U.at = Date.now();
      U.state = isNewer(r, current()) ? 'new' : 'latest';
    } catch (e) {
      U.state = 'error'; U.msg = (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'Sin conexión: conéctate a internet para buscar actualizaciones.' : 'No se pudo comprobar ahora. Inténtalo de nuevo en un rato.';
    }
    flag(); paint();
  }
  /* Renueva el service worker y borra lo guardado antes; luego recarga. La cuenta sigue abierta. */
  async function apply() {
    if (U.state === 'applying') return;
    U.state = 'applying'; paint();
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          try { await reg.update(); } catch (e) { /* sin red: se sigue con la recarga */ }
          const w = reg.installing || reg.waiting;
          if (w && w.state !== 'activated') await new Promise(res => { const t = setTimeout(res, 4000); w.addEventListener('statechange', () => { if (w.state === 'activated') { clearTimeout(t); res(); } }); });
        }
      }
      if (root.caches) { const keys = await caches.keys(); const cur = 'halterofilia-' + (U.remote ? U.remote.v : current().v); await Promise.all(keys.filter(k => k !== cur).map(k => caches.delete(k))); }
    } catch (e) { /* aun así se recarga */ }
    location.reload();
  }
  function flag() { if (hasDom) { if (U.state === 'new') document.documentElement.setAttribute('data-upd', '1'); else document.documentElement.removeAttribute('data-upd'); } }

  function body() {
    switch (U.state) {
      case 'checking': return '<p class="muted" role="status">Buscando…</p>';
      case 'applying': return '<p class="muted" role="status">Actualizando… la app se reinicia sola. No necesitas volver a entrar.</p>';
      case 'latest': return '<p class="upd-ok" role="status">Ya tienes la última versión.</p>';
      case 'new': return '<p class="upd-new" role="status">Hay una versión nueva: <b>Versión ' + esc(label(U.remote)) + '</b>. Tus datos y tu cuenta se conservan.</p>';
      case 'error': return '<p class="warn-t" role="status">' + esc(U.msg) + '</p>';
      default: return '<p class="muted">Si tu entrenador avisó de cambios, búscalos aquí. No hace falta cerrar la sesión ni volver a ingresar.</p>';
    }
  }
  function button() {
    if (U.state === 'new') return '<button class="btn block" data-act="upd-apply">Actualizar ahora</button>';
    const busy = U.state === 'checking' || U.state === 'applying';
    return '<button class="btn ghost block" data-act="upd-check"' + (busy ? ' disabled' : '') + '>' + (U.state === 'checking' ? 'Buscando…' : 'Buscar actualización') + '</button>';
  }
  function inner() { return '<p class="muted upd-ver">' + esc(versionText()) + '</p>' + body() + button(); }
  /* Tarjeta para la hoja de Ajustes (se vuelve a pintar sola al cambiar el estado) */
  function card() {
    if (hasDom && !U.at && U.state === 'idle') setTimeout(() => check(false), 0);
    return '<p class="eyebrow">Aplicación</p><div id="updCard" class="upd">' + inner() + '</div>';
  }
  function footer() { return '<p class="ver-line" id="verLine"><span class="credit">Created &amp; Developed by Felipe González</span></p>'; }
  function paint() { if (!hasDom) return; const el = document.getElementById('updCard'); if (el) el.innerHTML = inner(); }
  function onAct(act) {
    if (act === 'upd-check') { check(true); return true; }
    if (act === 'upd-apply') { apply(); return true; }
    return false;
  }
  /* Comprobación silenciosa poco después de abrir la app: si hay versión nueva, el engranaje muestra un punto */
  function checkSoon() { if (hasDom) setTimeout(() => check(false), 6000); }

  const api = { parseVersion: parseVersion, newer: newer, isNewer: isNewer, label: label, dateText: dateText, versionText: versionText, card: card, footer: footer, onAct: onAct, check: check, apply: apply, checkSoon: checkSoon, state: U };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HalterUpdate = api;
})(typeof window !== 'undefined' ? window : globalThis);
