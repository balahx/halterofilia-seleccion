/* Halterofilia · Selección — respaldo del equipo (solo entrenador).
   Descarga en un archivo JSON TODO lo que hay en la nube: miembros, plan(es), ejercicios, semanas asignadas, ajustes y,
   por cada atleta, sus registros (sesiones, ejercicios, perfil) y sesiones cumplidas. Sirve de copia propia, gratis,
   por si algo se borra o se daña (el plan gratuito de Firebase no incluye respaldos automáticos).
   Cuesta lecturas de la cuota diaria (50 000 en el plan gratuito): una por cada documento. Por eso es un botón manual.
   Parte pura (sin DOM) para probarla con Node: node tests/backup-unit.js */
(function (root) {
  'use strict';
  const FORMAT = 'halterofilia-respaldo-equipo', VERSION = 1;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Lee todo con `remote` (getCol/getDoc). `onProgress(texto)` informa el avance. Devuelve { data, reads }.
     Si un grupo falla, se corta con el error (un respaldo incompleto no debe parecer completo). */
  async function collect(remote, onProgress) {
    const say = onProgress || (() => {});
    let reads = 0;
    const col = async (path, label) => { if (label) say(label); const l = await remote.getCol(path); reads += l.length; return l; };
    const doc = async path => { const d = await remote.getDoc(path); reads += 1; return d; };   // un get cuenta como 1 lectura (exista o no)

    const members = await col('members', 'Leyendo miembros…');
    const requests = await col('requests');
    const exercises = await col('exercises', 'Leyendo catálogo de ejercicios…');
    const plansList = await col('plans', 'Leyendo planes…');
    const plans = [];
    for (const p of plansList) {
      const stages = await col('plans/' + p.id + '/stages');
      const weeks = await col('plans/' + p.id + '/weeks');
      plans.push({ id: p.id, data: strip(p), stages: stages, weeks: weeks });
    }
    const config = { plan: await doc('config/plan'), team: await doc('config/team') };
    const assignments = await col('assignments', 'Leyendo semanas asignadas…');
    const adjustments = await col('adjustments');
    const athletes = [];
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      say('Leyendo atleta ' + (i + 1) + ' de ' + members.length + ' (' + (m.name || m.email || m.id) + ')…');
      const records = await col('users/' + m.id + '/records');
      const completions = await col('users/' + m.id + '/completions');
      athletes.push({ uid: m.id, records: records, completions: completions });
    }
    return { data: { members: members, requests: requests, exercises: exercises, plans: plans, config: config, assignments: assignments, adjustments: adjustments, athletes: athletes }, reads: reads };
  }
  function strip(o) { const r = {}; Object.keys(o).forEach(k => { if (k !== 'id') r[k] = o[k]; }); return r; }

  /* Arma el archivo final con su cabecera */
  function build(data, meta) {
    meta = meta || {};
    return {
      format: FORMAT, v: VERSION,
      createdAt: meta.createdAt || new Date().toISOString(), by: meta.by || '', reads: meta.reads || 0,
      counts: counts(data),
      members: data.members, requests: data.requests, exercises: data.exercises, plans: data.plans, config: data.config,
      assignments: data.assignments, adjustments: data.adjustments, athletes: data.athletes
    };
  }
  function counts(d) {
    const sum = (arr, f) => (arr || []).reduce((t, x) => t + f(x), 0);
    return {
      members: (d.members || []).length,
      plans: (d.plans || []).length,
      weeks: sum(d.plans, p => (p.weeks || []).length),
      exercises: (d.exercises || []).length,
      assignments: (d.assignments || []).length,
      adjustments: (d.adjustments || []).length,
      records: sum(d.athletes, a => (a.records || []).length),
      completions: sum(d.athletes, a => (a.completions || []).length)
    };
  }
  const pad = n => (n < 10 ? '0' : '') + n;
  function fileName(date) { const d = date || new Date(); return 'respaldo-equipo-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json'; }
  function summary(c) {
    return c.members + ' atletas · ' + c.plans + ' plan(es) · ' + c.records + ' registros · ' + c.completions + ' sesiones cumplidas';
  }
  /* ¿Es un archivo de respaldo del equipo? (para no confundirlo con el respaldo personal de un atleta) */
  function isBackup(o) { return !!o && o.format === FORMAT && o.v === VERSION && Array.isArray(o.members) && Array.isArray(o.athletes); }

  /* ---------- Pantalla (solo en el navegador) ---------- */
  const S = { busy: false, msg: '', last: '', err: '', stamp: undefined };
  const STALE_DAYS = 14;
  /* Días desde el último respaldo (null si nunca o no se sabe) */
  function daysSince(stamp, now) { return stamp && stamp.at ? Math.max(0, Math.floor(((now || Date.now()) - stamp.at) / 86400000)) : null; }
  /* Texto sobre el último respaldo guardado en la nube (undefined = aún no se sabe) */
  function stampText(stamp, now) {
    if (stamp === undefined) return '';
    if (!stamp || !stamp.at) return 'Aún no hay ningún respaldo registrado. Descarga el primero.';
    const d = daysSince(stamp, now);
    return 'Último respaldo: ' + new Date(stamp.at).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Santiago' }) + (d === 0 ? ' (hoy)' : d === 1 ? ' (ayer)' : ' (hace ' + d + ' días)') + (stamp.counts && stamp.counts.members != null ? ' · ' + summary(stamp.counts) : '') + '.';
  }
  const isStale = (stamp, now) => stamp !== undefined && (!stamp || !stamp.at || daysSince(stamp, now) >= STALE_DAYS);
  function setStamp(d) { S.stamp = d || null; }
  let H = null; // { remote(), toast, render, err, who() }
  function init(helpers) { H = helpers; }
  function card() {
    let h = '<div class="card sec"><span class="eyebrow">Respaldo del equipo</span>';
    h += '<p class="muted">Descarga un archivo con los datos de todo el equipo (atletas, planes, semanas asignadas, registros y sesiones cumplidas). Guárdalo en un lugar privado: <b>contiene datos personales y de salud</b>. Cada descarga usa lecturas de la cuota diaria gratuita (una por documento), así que úsala, por ejemplo, una vez por semana.</p>';
    if (S.err) h += window.HalterApp.errorBox(S.err, { title: 'Respaldo no completado' });
    if (S.stamp !== undefined) h += '<p class="' + (isStale(S.stamp) ? 'note warn' : 'muted') + '">' + esc(stampText(S.stamp)) + (isStale(S.stamp) && S.stamp ? ' Conviene descargar uno nuevo.' : '') + '</p>';
    if (S.busy) h += '<p class="muted" role="status">' + esc(S.msg || 'Preparando…') + '</p>';
    else if (S.last) h += '<p class="muted">' + esc(S.last) + '</p>';
    h += '<div class="row-end"><button class="btn sm" data-act="bk-run"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Descargando…' : 'Descargar respaldo') + '</button></div></div>';
    return h;
  }
  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  async function run() {
    if (S.busy || !H) return;
    S.busy = true; S.err = ''; S.msg = 'Preparando…'; H.render();
    try {
      const got = await collect(H.remote(), t => { S.msg = t; H.render(); });
      const file = build(got.data, { by: H.who ? H.who() : '', reads: got.reads });
      download(fileName(), JSON.stringify(file, null, 1));
      S.last = 'Esta descarga: ' + new Date().toLocaleString('es-CL') + ' · ' + summary(file.counts) + ' · ' + got.reads + ' lecturas.';
      try { await H.remote().setBackupStamp(file.counts, got.reads); } catch (e) { /* la fecha en la nube es un recordatorio: si falla, el respaldo ya está descargado */ }
      H.toast('Respaldo descargado.');
    } catch (e) {
      S.err = 'No se pudo completar el respaldo: ' + (H.err ? H.err(e) : (e && e.message) || e) + ' No se descargó nada.'; H.toast(S.err);
    }
    S.busy = false; H.render();
  }
  function reset() { S.busy = false; S.msg = ''; S.last = ''; S.err = ''; S.stamp = undefined; }
  function onAct(act) { if (act === 'bk-run') run(); }

  const api = { FORMAT: FORMAT, VERSION: VERSION, collect: collect, build: build, counts: counts, fileName: fileName, summary: summary, isBackup: isBackup, daysSince: daysSince, stampText: stampText, isStale: isStale, setStamp: setStamp, init: init, reset: reset, card: card, onAct: onAct, state: S };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HalterBackup = api;
})(typeof window !== 'undefined' ? window : globalThis);
