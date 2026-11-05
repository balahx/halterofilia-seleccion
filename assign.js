/* Semana asignada (fase 4).
   - Entrenador: asigna a cada atleta la semana del plan activo, ve qué sesiones cumplió y ajusta los
     porcentajes desde 90 % (el avance de cada atleta es distinto).
   - Atleta: pestaña «Semana» con las sesiones de su semana (kg calculados con sus máximos), inicio de la
     sesión ya armada, y el botón «Pasar a la semana siguiente».
   La hora de corte (viernes 23:59, hora de Chile) la calcula la app; las reglas de Firestore comparan
   con la hora del servidor (firestore.rules). Sin Cloud Functions.

   Firestore:
     assignments/{uid}                       { planId, weekId, week, stageId, weekEndsAt (ms), setBy, at }
     users/{uid}/completions/{plan_week_n}   { planId, weekId, sessionIdx, completedAt }   solo se crea
     adjustments/{uid}_{planId}_{weekId}     { pcts: { s0_i3_k1: 92.5, … }, at }
   Las funciones puras de arriba se prueban con Node (tests/assign-unit.js). */
(function (root) {
  'use strict';

  /* ---------- Hora de Chile ---------- */
  const TZ = 'America/Santiago', DAY = 86400000;
  const tzFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function chile(ms) {
    const o = {}; tzFmt.formatToParts(new Date(ms)).forEach(p => { o[p.type] = p.value; });
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, wd: WD.indexOf(o.weekday) };
  }
  /* Fecha y hora de pared en Chile → milisegundos UTC (el desfase cambia con el horario de verano) */
  function chileToMs(y, m, d, h, mi) {
    const want = Date.UTC(y, m - 1, d, h, mi); let g = want;
    for (let i = 0; i < 4; i++) { const p = chile(g), got = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi); if (got === want) break; g += want - got; }
    return g;
  }
  /* Próximo viernes a las 23:59 (hora de Chile). Si hoy es viernes y aún no son las 23:59, es hoy. */
  function cutoffFor(nowMs) {
    const p = chile(nowMs), add = (4 - p.wd + 7) % 7;
    let t = chileToMs(p.y, p.m, p.d + add, 23, 59);
    if (t < nowMs) t = chileToMs(p.y, p.m, p.d + add + 7, 23, 59);
    return t;
  }
  /* Corte de la semana siguiente a otro corte: 7 días después, también un viernes 23:59 de Chile */
  const nextCutoff = prevMs => cutoffFor(prevMs + 2 * DAY);

  /* ---------- Plan → sesión del atleta ---------- */
  /* Ejercicios del catálogo que ya existen en la app del atleta con otro id */
  const LOCAL = { 'snatch': 'snatch', 'clean': 'clean', 'power-snatch': 'psnatch', 'overhead-squat': 'ohsq', 'snatch-pull': 'snpull', 'clean-pull': 'clpull',
    'split-jerk': 'jerk', 'push-press': 'pp', 'back-squat': 'bsq', 'front-squat': 'fsq', 'romanian-deadlift': 'rdl' };
  /* Complejos que la app ya trae con otro id (para que compartan el mismo máximo) */
  const COMPLEX_LOCAL = { 'clean+fsq+jerk': 'cx-clfj', 'snatch+ohsq': 'cx-snoh' };
  const localIdFor = catId => LOCAL[catId] || catId;
  /* Derivados: si el atleta no tiene máximo propio de un ejercicio, el % se calcula sobre el máximo del ejercicio
     principal multiplicado por este factor ([ejercicio principal, factor]). Con máximo propio, se usa ese.
     Ejemplo: sentadilla de arranque 70 % → con 124 kg propios, 70 % de 124; sin máximo, 70 % de 120 % del arranque.
     Lista a confirmar con Cristian (agregar un ejercicio es una línea). */
  const DERIVED = {
    'power-snatch': ['snatch', 1], 'hip-power-snatch': ['snatch', 1], 'hang-power-snatch': ['snatch', 1], 'hang-snatch': ['snatch', 1], 'below-knee-hang-snatch': ['snatch', 1],
    'tall-snatch': ['snatch', 1], 'drop-snatch': ['snatch', 1], 'deficit-snatch': ['snatch', 1], 'hip-snatch': ['snatch', 1], 'overhead-squat': ['snatch', 1.2],
    'hang-clean': ['clean', 1], 'below-knee-hang-clean': ['clean', 1], 'hang-muscle-clean': ['clean', 1], 'clean-from-power-position': ['clean', 1], 'floating-clean': ['clean', 1],
    'no-jump-clean': ['clean', 1], 'deficit-clean': ['clean', 1], 'three-position-clean': ['clean', 1], 'two-position-clean': ['clean', 1]
  };
  /* Máximo de referencia de un ejercicio del catálogo: el propio si lo tiene; si no, el derivado del principal */
  /* El entrenador puede cambiar el factor de un derivado para un atleta y una semana (adj['f_' + ejercicio], en %) */
  const factorKey = catId => 'f_' + catId;
  function refMax(S, catId, adj) {
    const own = S.exercises.find(q => q.id === localIdFor(catId));
    if (own && own.max > 0) return { kg: own.max, how: 'own' };
    const d = DERIVED[catId];
    if (d) {
      const ov = adj && adj[factorKey(catId)], f = ov > 0 ? ov / 100 : d[1];
      const b = S.exercises.find(q => q.id === localIdFor(d[0])); if (b && b.max > 0) return { kg: b.max * f, how: 'derived', base: d[0], f: f, set: ov > 0 };
    }
    return { kg: 0, how: 'none' };
  }
  /* Referencia de un ejercicio de la planilla. Un complejo (a + b + c) no tiene máximo propio: su % se aplica al máximo
     del ejercicio principal del primer movimiento que tenga uno (propio o derivado). Arranque + sentadilla de arranque →
     máximo de arranque; cargada + sentadilla frontal → máximo de cargada. Un complejo al 120 % de un arranque de 100 kg pide 120 kg. */
  function refFor(S, item, adj) {
    const ps = mainParts(item);
    for (let i = 0; i < ps.length; i++) { const r = refMax(S, partId(ps[i]), adj); if (r.kg > 0) return ps.length > 1 ? Object.assign({ via: partId(ps[i]) }, r) : r; }
    return { kg: 0, how: 'none' };
  }
  const slugOf = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'ejercicio';
  const partId = p => p.ex || slugOf(p.src);

  const adjKey = (si, ii, k) => 's' + si + '_i' + ii + '_k' + k;
  /* Una fila por serie: la prescripción k repetida `sets` veces (1 si no trae series). Desde 90 % el % se puede ajustar. */
  function expandSets(item, adj, si, ii) {
    const out = [];
    (item.sets || []).forEach((p, k) => {
      const key = adjKey(si, ii, k), ov = adj && adj[key], n = p.sets > 0 ? p.sets : 1;
      const pct = p.adjustable && typeof ov === 'number' && ov > 0 ? ov : p.pct;
      for (let j = 0; j < n; j++) out.push({ k: k, key: key, pct: pct, basePct: p.pct, reps: p.reps || '', adjustable: !!p.adjustable, max: !!p.max, orMore: !!p.orMore, adjusted: pct !== p.pct });
    });
    return out;
  }
  /* Primera alternativa del ejercicio (las demás son variantes que el atleta puede elegir de palabra) */
  const mainParts = item => (item.alts && item.alts[0] && item.alts[0].p) || [];
  const roundTo = (x, step) => { step = step > 0 ? step : 1; return Math.round(x / step) * step; };

  /* Ejercicio de la app del atleta para una prescripción: uno solo, o un complejo «a + b» */
  function exerciseFor(item, names) {
    const ps = mainParts(item);
    const en = p => (names && names[p.ex] && names[p.ex].en) || p.src || 'Exercise', es = p => (names && names[p.ex] && (names[p.ex].es || names[p.ex].en)) || p.src || 'Ejercicio';
    if (ps.length === 1) { const id = localIdFor(partId(ps[0])); return { id: id, name: es(ps[0]), en: en(ps[0]), es: es(ps[0]), cat: 'acc', parts: [id] }; }
    const ids = ps.map(p => localIdFor(partId(p)));
    const key = ids.join('+');
    return { id: COMPLEX_LOCAL[key] || 'cx-' + key.slice(0, 100), name: ps.map(es).join(' + '), en: ps.map(en).join(' + '), es: ps.map(es).join(' + '), cat: 'cmplx', parts: ids };
  }
  /* Nombre con idioma principal según el ajuste del atleta (inglés por defecto) y el otro como secundario */
  function nameOf(p, names, lang) { return both(p, names, lang).p; }
  function both(p, names, lang) {
    const c = names && names[p.ex], en = (c && c.en) || p.src || 'Exercise', es = (c && c.es) || '';
    if (!es || es === en) return { p: en, s: '' };
    return lang === 'es' ? { p: es, s: en } : { p: en, s: es };
  }

  /* Sesión lista para registrar. S = estado de la app (se agregan los ejercicios que falten). */
  function buildSession(S, week, si, ctx) {
    const ses = week.sessions[si]; if (!ses) return null;
    const rounding = (S.profile && S.profile.rounding) || 1, adj = ctx.adj || {}, names = ctx.names || {};
    const items = [];
    (ses.items || []).forEach((it, ii) => {
      const ps = mainParts(it); if (!ps.length) return;
      const x = exerciseFor(it, names);
      let e = S.exercises.find(q => q.id === x.id);
      if (!e) { e = { id: x.id, name: x.name, en: x.en, es: x.es, cat: x.cat, rest: S.profile.rest || 120, max: 0, maxDate: null, builtin: false }; S.exercises.push(e); }
      // el % es del máximo propio del ejercicio o, si no lo tiene, del derivado del principal (ver DERIVED)
      const ref = refFor(S, it, adj);
      const sets = expandSets(it, adj, si, ii).map(s => {
        const pct = s.pct || 0;
        return { kg: ref.kg > 0 && pct > 0 ? roundTo(ref.kg * pct / 100, rounding) : 0, reps: s.max ? '1' : String(s.reps || ''), pct: pct, rpe: null, done: false, doneAt: null };
      });
      if (!sets.length) sets.push({ kg: 0, reps: '', pct: 0, rpe: null, done: false, doneAt: null });
      const prev = items.find(q => q.exId === e.id);
      if (prev) prev.sets = prev.sets.concat(sets); else items.push({ exId: e.id, rest: e.rest || S.profile.rest || 120, sets: sets });
    });
    const dt = new Date();
    return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'),
      dayIdx: null, name: ses.name || 'Entrenamiento', startedAt: Date.now(), endedAt: null, notes: '', bw: S.profile.bw || null, items: items,
      plan: { planId: ctx.planId, weekId: ctx.weekId, idx: si } };
  }

  /* ¿Puede el atleta pasar a la semana siguiente? → { ok, why } */
  function advanceState(asg, week, done, now) {
    if (!asg || !week) return { ok: false, why: '' };
    if (!week.next) return { ok: false, why: 'Es la última semana del plan.' };
    const n = (week.sessions || []).length, needLast = week.kind !== 'transition' && n > 0;
    if (needLast && !done[n - 1]) return { ok: false, why: 'Falta cumplir la última sesión de la semana (' + ((week.sessions[n - 1] || {}).name || 'sesión ' + n) + ').' };
    if (now < asg.weekEndsAt) return { ok: false, why: 'Se habilita el ' + fmtCut(asg.weekEndsAt) + '.' };
    return { ok: true, why: '' };
  }
  const cutFmt = new Intl.DateTimeFormat('es-CL', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const fmtCut = ms => cutFmt.format(new Date(ms)) + ' (hora de Chile)';

  const pure = { factorKey, refMax, refFor, DERIVED, both, cutoffFor, nextCutoff, chile, chileToMs, localIdFor, expandSets, buildSession, advanceState, exerciseFor, adjKey, LOCAL, slugOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (!root.document) { root.HalterAssignPure = pure; return; }

  /* ================== Interfaz (solo en el navegador) ================== */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }
  };
  const A = {
    uid: null, role: null, active: null, names: {}, plans: [],
    weeks: [], stages: [], asg: {}, sel: null, selDone: {}, selAdj: null, selAdjKey: '', draft: null, pick: '', ready: false, busy: '', err: '',
    me: { asg: undefined, week: null, adj: {}, done: {}, savedAt: 0 }
  };
  let H = null, unsub = [], weekUnsub = [], selUnsub = [], adjUnsub = [];
  const cacheKey = () => 'halterofilia.v1.' + A.uid + '.week';
  const pendKey = () => 'halterofilia.v1.' + A.uid + '.pend';
  const rerender = () => { if (H) H.render(); };
  const unwatch = list => { list.splice(0).forEach(u => { try { u(); } catch (e) { /* ya cerrado */ } }); };
  const lang = () => { const S = window.HalterApp.state(); return (S && S.profile && S.profile.exLang) || 'en'; };
  const dayLabel = d => ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][d] || '';
  const stageName = id => { const s = A.stages.find(x => x.id === id); return s ? s.name : ''; };
  const weekTitle = w => 'Semana ' + w.week + (w.kind === 'transition' ? ' · Transición' : '');

  let weekKey = '';   // semana que se está escuchando como atleta
  function init(helpers) {
    H = helpers; if (root.HalterReport) root.HalterReport.init(helpers);
    document.addEventListener('change', e => { const t = e.target; if (t && t.dataset && t.dataset.as === 'week') { A.pick = t.value; } });
    document.addEventListener('input', e => {
      const t = e.target; if (!t || !t.dataset || t.dataset.as !== 'pct') return;
      const v = parseFloat(String(t.value).replace(',', '.')); A.draft = A.draft || {};
      if (t.value === '' || isNaN(v)) delete A.draft[t.dataset.key]; else A.draft[t.dataset.key] = Math.round(v * 10) / 10;
      const b = document.querySelector('[data-act="as-adj-save"]'); if (b) b.disabled = !adjDirty() || !!A.busy;   // el botón se habilita al escribir
    });
  }
  function reset() { if (root.HalterReport) root.HalterReport.reset(); weekKey = ''; unwatch(unsub); unwatch(weekUnsub); unwatch(selUnsub); unwatch(adjUnsub); A.uid = null; A.role = null; A.active = null; A.names = {}; A.weeks = []; A.stages = []; A.asg = {}; A.sel = null; A.selDone = {}; A.selAdj = null; A.draft = null; A.pick = ''; A.ready = false; A.err = ''; A.busy = ''; A.me = { asg: undefined, week: null, adj: {}, done: {}, savedAt: 0 }; }

  /* ---------- Escuchar datos ---------- */
  function startCoach(uid) {
    reset(); A.uid = uid; A.role = 'coach'; const r = H.remote();
    unsub.push(r.watchCol('assignments', list => { A.asg = {}; list.forEach(x => { A.asg[x.id] = x; }); A.ready = true; if (A.sel) watchAdj(); rerender(); }, e => { A.err = H.err(e); A.ready = true; rerender(); }));
    unsub.push(r.watchCol('exercises', list => { A.names = {}; list.forEach(x => { A.names[x.id] = { en: x.en, es: x.es }; }); rerender(); }, () => { /* opcional */ }));
    unsub.push(r.watchDoc('config/plan', d => { watchPlan(d ? d.activePlanId : null); }, () => { /* sin plan activo */ }));
  }
  function watchPlan(planId) {
    if (planId === A.active && weekUnsub.length) return;
    unwatch(weekUnsub); A.active = planId; A.weeks = []; A.stages = [];
    if (!planId) { rerender(); return; }
    const r = H.remote();
    weekUnsub.push(r.watchCol('plans/' + planId + '/weeks', list => { A.weeks = list.slice().sort((a, b) => stageOrder(a.stageId) - stageOrder(b.stageId) || a.week - b.week); rerender(); }, () => { /* sin permiso o sin conexión */ }));
    weekUnsub.push(r.watchCol('plans/' + planId + '/stages', list => { A.stages = list.slice().sort((a, b) => a.order - b.order); rerender(); }, () => { /* idem */ }));
  }
  const stageOrder = id => { const s = A.stages.find(x => x.id === id); return s ? s.order : 0; };

  function startAthlete(uid, offline) {
    reset(); A.uid = uid; A.role = 'athlete';
    try { const c = JSON.parse(LS.get(cacheKey()) || 'null'); if (c && c.asg) { A.me = { asg: c.asg, week: c.week || null, adj: c.adj || {}, done: c.done || {}, savedAt: c.savedAt || 0 }; A.names = c.names || {}; A.stages = c.stages || []; } } catch (e) { /* caché dañada */ }
    if (offline) return;
    const r = H.remote();
    unsub.push(r.watchDoc('assignments/' + uid, (d, m) => {
      if (m && m.fromCache && d === null) return;
      const was = A.me.asg; A.me.asg = d;
      if (!d) { unwatch(weekUnsub); weekKey = ''; A.me.week = null; A.me.adj = {}; A.me.done = {}; rerender(); return; }
      // se escucha la semana una vez por sesión de la app, aunque la asignación sea igual a la guardada en el dispositivo
      const key = d.planId + '|' + d.weekId;
      if (key !== weekKey) { weekKey = key; watchMyWeek(d, !!was && was.planId === d.planId && was.weekId === d.weekId); }
      saveCache(); rerender(); flush();
    }, e => { A.err = H.err(e); rerender(); }));
    unsub.push(r.watchCol('exercises', list => { A.names = {}; list.forEach(x => { A.names[x.id] = { en: x.en, es: x.es }; }); saveCache(); rerender(); }, () => { /* opcional */ }));
    flush();
  }
  function watchMyWeek(a, keepCache) {
    unwatch(weekUnsub); const r = H.remote(), pre = a.planId + '_' + a.weekId + '_';
    if (!keepCache) { A.me.week = null; A.me.adj = {}; A.me.done = {}; }
    weekUnsub.push(r.watchCol('plans/' + a.planId + '/stages', list => { A.stages = list; saveCache(); rerender(); }, () => { /* sin conexión: queda la copia guardada */ }));
    weekUnsub.push(r.watchDoc('plans/' + a.planId + '/weeks/' + a.weekId, d => { if (d) { A.me.week = d; saveCache(); } rerender(); }, () => { /* sin conexión: queda la copia guardada */ }));
    weekUnsub.push(r.watchDoc('adjustments/' + A.uid + '_' + a.planId + '_' + a.weekId, d => { A.me.adj = (d && d.pcts) || {}; saveCache(); rerender(); }, () => { /* sin ajustes */ }));
    weekUnsub.push(r.watchCol('users/' + A.uid + '/completions', list => {
      const done = {}; list.forEach(x => { if (x.id.indexOf(pre) === 0 && typeof x.sessionIdx === 'number') done[x.sessionIdx] = true; });
      A.me.done = done; saveCache(); rerender();
    }, () => { /* sin conexión */ }));
  }
  function saveCache() {
    if (A.role !== 'athlete' || !A.me.asg) return;
    A.me.savedAt = Date.now();
    LS.set(cacheKey(), JSON.stringify({ asg: A.me.asg, week: A.me.week, adj: A.me.adj, done: A.me.done, names: A.names, stages: A.stages, savedAt: A.me.savedAt }));
  }

  /* ---------- Sesiones cumplidas (se envían con la hora del servidor; si no hay conexión quedan en cola) ---------- */
  const readPend = () => { try { return JSON.parse(LS.get(pendKey()) || '[]'); } catch (e) { return []; } };
  const writePend = l => LS.set(pendKey(), JSON.stringify(l));
  let flushing = false;
  async function flush() {
    if (flushing || A.role !== 'athlete' || !H) return; flushing = true;
    try {
      let q = readPend();
      for (const p of q.slice()) {
        const id = p.planId + '_' + p.weekId + '_' + p.idx;
        try { await H.remote().setCompletion(A.uid, id, { planId: p.planId, weekId: p.weekId, sessionIdx: p.idx }); q = q.filter(x => x !== p && !(x.planId === p.planId && x.weekId === p.weekId && x.idx === p.idx)); writePend(q); }
        catch (e) {
          if (e && e.code === 'permission-denied') {   // ya estaba registrada o la semana cambió: no se reintenta
            const a = A.me.asg; if (!a || a.planId !== p.planId || a.weekId !== p.weekId || A.me.done[p.idx]) { q = q.filter(x => !(x.planId === p.planId && x.weekId === p.weekId && x.idx === p.idx)); writePend(q); continue; }
          }
          break;
        }
      }
    } finally { flushing = false; }
  }
  function onFinish(s) {
    if (!s || !s.plan || A.role !== 'athlete') return;
    const q = readPend(); if (!q.some(x => x.planId === s.plan.planId && x.weekId === s.plan.weekId && x.idx === s.plan.idx)) q.push(s.plan);
    writePend(q); flush();
  }

  /* ---------- Atleta ---------- */
  function sessionCard(w, si, ses) {
    const S = window.HalterApp.state(), done = !!A.me.done[si], adj = A.me.adj, rounding = (S.profile && S.profile.rounding) || 1, lang = (S.profile && S.profile.exLang) || 'en';
    let block = null, h = `<div class="card sec"><div class="person"><div><b>${esc(dayLabel(ses.day))}${ses.name && ses.name !== dayLabel(ses.day) ? ' · ' + esc(ses.name) : ''}</b><small>${(ses.items || []).length} ${(ses.items || []).length === 1 ? 'ejercicio' : 'ejercicios'}</small></div>` +
      (done ? '<span class="badge ok">Cumplida</span>' : '') + '</div><ul class="plain">';
    (ses.items || []).forEach((it, ii) => {
      if (it.block && it.block !== block) { block = it.block; h += `<li class="blk"><span class="eyebrow">${esc(block)}</span></li>`; }
      const ps = mainParts(it), ref = refFor(S, it, adj);
      const sets = expandSets(it, adj, si, ii);
      const rows = [], seen = {};
      sets.forEach(s => { const key = s.k; if (seen[key]) { seen[key].n++; return; } seen[key] = { s: s, n: 1 }; rows.push(seen[key]); });
      const line = rows.map(r => {
        const s = r.s; if (s.max) return 'Máximo (100 % o nuevo 100 %)' + (s.adjusted ? ' · ajustado' : '');
        const kg = ref.kg > 0 && s.pct > 0 ? ' → ' + roundTo(ref.kg * s.pct / 100, rounding) + ' kg' : '';
        return (s.pct ? s.pct + ' %' + (s.adjusted ? ' (ajustado)' : s.adjustable ? ' (referencia)' : '') : '') + (s.orMore ? ' o más' : '') + (s.reps ? ' · ' + s.reps + ' rep' : '') + (r.n > 1 || (it.sets[s.k] && it.sets[s.k].sets) ? ' × ' + r.n : '') + kg;
      }).join(' | ');
      const nb = ps.map(p => both(p, A.names, lang)), prim = nb.map(q => q.p).join(' + '), sec = nb.map(q => q.s || q.p).join(' + ');
      const alt = (it.alts || []).slice(1).map(a => (a.p || []).map(p => both(p, A.names, lang).p).join(' + ')).join(' o ');
      const cxHow = ps.length > 1 ? (ref.via ? ' · % de tu ' + both({ ex: ref.via, src: ref.via }, A.names, lang).p + ' (primer movimiento con máximo)' : '') : '';
      const how = cxHow + (ref.how === 'derived' ? ' · calculado desde tu ' + both({ ex: ref.base, src: ref.base }, A.names, lang).p + (ref.f !== 1 ? ' × ' + ref.f + (ref.set ? ' (indicado por tu entrenador)' : '') : (ref.set ? ' (indicado por tu entrenador)' : '')) : '');
      h += `<li><b>${esc(ps.length ? prim : it.raw)}</b>${ps.length && sec !== prim ? `<small class="exsub">${esc(sec)}</small>` : ''}${alt ? `<small>o ${esc(alt)}</small>` : ''}<small>${esc(line || it.presc || '')}${esc(how)}${ref.how === 'none' && sets.some(s => s.pct) ? (ps.length > 1 ? ' · sin máximo: anota el de uno de sus movimientos en «Máximos»' : ' · sin tu máximo (anótalo en «Máximos» al iniciar la sesión)') : ''}</small></li>`;
    });
    h += '</ul>';
    if (w.kind !== 'transition') h += `<div class="actions"><button class="btn${done ? ' ghost' : ''}" data-act="as-start" data-i="${si}">${done ? 'Registrar de nuevo' : 'Iniciar esta sesión'}</button></div>`;
    return h + '</div>';
  }
  function athleteView() {
    const m = A.me, a = m.asg;
    let h = '<h1>Mi semana</h1>';
    if (A.err) h += `<div class="note warn">${esc(A.err)}</div>`;
    if (a === undefined) return h + '<div class="card sec"><p class="muted">Cargando…</p></div>';
    if (!a) return h + '<div class="card sec"><p class="muted">Tu entrenador aún no te asigna una semana del plan. Mientras tanto puedes registrar tus sesiones en «Hoy».</p></div>';
    const w = m.week;
    if (!w) return h + '<div class="card sec"><p class="muted">Cargando la semana…</p></div>';
    h += `<div class="card sec"><span class="eyebrow">${esc(weekTitle(w))}</span><p class="lead">${esc(stageName(w.stageId) || '')}</p>` +
      (w.kind === 'transition' ? '<p class="muted">Semana de transición: actividad física y ejercicio libre para la descarga física y mental. Descanso de halterofilia.</p>' : '') +
      (w.notes && w.notes.length && w.kind !== 'transition' ? '<ul class="plain">' + w.notes.map(n => `<li><small>${esc(n)}</small></li>`).join('') + '</ul>' : '') +
      `<small class="muted">Cambia de semana desde el ${esc(fmtCut(a.weekEndsAt))}</small></div>`;
    h += (w.sessions || []).map((s, i) => sessionCard(w, i, s)).join('');
    const st = advanceState(a, w, m.done, Date.now());
    h += `<div class="card sec"><span class="eyebrow">Cambiar de semana</span><p class="muted">${st.ok ? 'Cumpliste la última sesión y ya pasó el corte: puedes pasar a la semana siguiente.' : esc(st.why)}</p>` +
      `<div class="actions"><button class="btn" data-act="as-advance"${st.ok && !A.busy ? '' : ' disabled'}>${A.busy || 'Pasar a la semana siguiente'}</button></div></div>`;
    return h;
  }
  function startSession(i) {
    const w = A.me.week, a = A.me.asg; if (!w || !a) return;
    window.HalterApp.startPlanned(S => buildSession(S, w, i, { planId: a.planId, weekId: a.weekId, names: A.names, adj: A.me.adj }));
  }
  async function advance() {
    const a = A.me.asg, w = A.me.week; if (!a || !w || A.busy) return;
    const st = advanceState(a, w, A.me.done, Date.now()); if (!st.ok) { H.toast(st.why); return; }
    A.busy = 'Cambiando…'; rerender();
    try {
      const nx = await H.remote().getDoc('plans/' + a.planId + '/weeks/' + w.next);
      if (!nx) throw new Error('No se encontró la semana siguiente');
      await H.remote().advanceAssignment(A.uid, { weekId: w.next, week: nx.week, stageId: nx.stageId, weekEndsAt: nextCutoff(a.weekEndsAt) });
      H.toast('Ahora estás en la semana ' + nx.week);
    } catch (e) { A.err = H.err(e); }
    A.busy = ''; rerender();
  }

  /* ---------- Entrenador ---------- */
  const asgLine = (uid) => { const a = A.asg[uid]; if (!a) return 'Sin semana asignada'; return 'Semana ' + a.week + (stageName(a.stageId) ? ' · ' + stageName(a.stageId) : ''); };
  function select(uid) {
    if (root.HalterReport) root.HalterReport.reset();
    unwatch(selUnsub); unwatch(adjUnsub); A.sel = uid; A.selDone = {}; A.selAdj = null; A.draft = null; A.pick = ''; A.selAdjKey = '';
    if (!uid) { rerender(); return; }
    const r = H.remote();
    selUnsub.push(r.watchCol('users/' + uid + '/completions', list => { A.selDone = {}; list.forEach(x => { A.selDone[x.id] = x.completedAt; }); rerender(); }, () => { /* sin permiso */ }));
    watchAdj(); rerender();
  }
  function watchAdj() {
    const a = A.asg[A.sel]; if (!a) return;
    const k = A.sel + '_' + a.planId + '_' + a.weekId; if (k === A.selAdjKey) return;
    unwatch(adjUnsub); A.selAdjKey = k; A.selAdj = null; A.draft = null;
    adjUnsub.push(H.remote().watchDoc('adjustments/' + k, d => { A.selAdj = (d && d.pcts) || {}; if (!A.draft) A.draft = Object.assign({}, A.selAdj); rerender(); }, () => { A.selAdj = {}; }));
  }
  const memberName = uid => { const m = (H.members() || []).find(x => x.id === uid); return m ? m.name : uid; };
  function weekOptions() {
    const cur = A.asg[A.sel], sel = A.pick || (cur && cur.weekId) || '';
    let h = '', last = null;
    A.weeks.forEach(w => {
      if (w.stageId !== last) { if (last !== null) h += '</optgroup>'; h += `<optgroup label="${esc(stageName(w.stageId) || w.stageId)}">`; last = w.stageId; }
      h += `<option value="${esc(w.id)}"${w.id === sel ? ' selected' : ''}>Semana ${w.week}${w.kind === 'transition' ? ' · transición' : ''}</option>`;
    });
    return h + (last !== null ? '</optgroup>' : '');
  }
  const adjDirty = () => JSON.stringify(A.draft || {}) !== JSON.stringify(A.selAdj || {});
  function adjustHTML(a) {
    const w = A.weeks.find(x => x.id === a.weekId); if (!w) return '';
    let rows = '';
    (w.sessions || []).forEach((s, si) => (s.items || []).forEach((it, ii) => {
      (it.sets || []).forEach((p, k) => {
        if (!p.adjustable) return;
        const key = adjKey(si, ii, k), ps = mainParts(it), val = A.draft && typeof A.draft[key] === 'number' ? A.draft[key] : '';
        rows += `<div class="adj"><div><b>${esc(ps.map(q => nameOf(q, A.names, lang())).join(' + ') || it.raw)}</b><small>${esc(dayLabel(s.day))} · plan: ${p.max ? 'máximo' : p.pct + ' %'}${p.reps ? ' · ' + esc(p.reps) + ' rep' : ''}${p.sets ? ' × ' + p.sets : ''}</small></div>` +
          `<input class="txt" inputmode="decimal" data-f="asx" data-as="pct" data-key="${key}" value="${val}" placeholder="${p.pct}" aria-label="% para este atleta (plan ${p.pct})"></div>`;
      });
    }));
    // derivados de la semana: factor sobre el máximo del ejercicio principal (solo si el atleta no tiene máximo propio)
    const seen = {}; let frows = '';
    (w.sessions || []).forEach(ses => (ses.items || []).forEach(it => mainParts(it).forEach(q => {
      const id = partId(q), d = DERIVED[id]; if (!d || seen[id]) return; seen[id] = 1;
      const key = factorKey(id), val = A.draft && typeof A.draft[key] === 'number' ? A.draft[key] : '';
      frows += `<div class="adj"><div><b>${esc(nameOf(q, A.names, lang()))}</b><small>% del ${esc(nameOf({ ex: d[0], src: d[0] }, A.names, lang()))} si no tiene máximo propio · por defecto ${Math.round(d[1] * 100)} %</small></div>` +
        `<input class="txt" inputmode="decimal" data-f="asx" data-as="pct" data-key="${key}" value="${val}" placeholder="${Math.round(d[1] * 100)}" aria-label="Factor para este atleta (por defecto ${Math.round(d[1] * 100)} %)"></div>`;
    })));
    if (!rows && !frows) return '<p class="muted">Esta semana no tiene porcentajes de 90 % o más ni ejercicios derivados.</p>';
    const dirty = adjDirty();
    return (rows ? '<p class="muted">Deja vacío para usar el % del plan. El atleta ve el valor ajustado y sus kilos.</p>' + rows : '') +
      (frows ? '<h3>Derivados · factor sobre el ejercicio principal</h3><p class="muted">Un derivado usa su máximo propio; si el atleta no lo tiene, su máximo × este factor (p. ej. sentadilla sobre la cabeza = 120 % del arranque). Deja vacío para el valor por defecto.</p>' + frows : '') +
      `<div class="stack"><button class="btn" data-act="as-adj-save"${dirty && !A.busy ? '' : ' disabled'}>Guardar ajustes</button><button class="btn ghost" data-act="as-adj-clear"${Object.keys(A.selAdj || {}).length ? '' : ' disabled'}>Quitar todos</button></div>`;
  }
  function detailHTML() {
    const uid = A.sel, a = A.asg[uid];
    let h = `<p><button class="lnk" data-act="as-back">← Equipo</button></p><h1>${esc(memberName(uid))}</h1>`;
    if (A.err) h += `<div class="note warn">${esc(A.err)}</div>`;
    h += `<div class="card sec"><span class="eyebrow">Semana asignada</span><p class="lead">${esc(asgLine(uid))}</p>` +
      (a ? `<small class="muted">Cambia de semana desde el ${esc(fmtCut(a.weekEndsAt))}</small>` : '');
    if (!A.active) h += '<p class="muted">Todavía no hay un plan activo. Publica y activa uno en «Planes».</p>';
    else if (!A.weeks.length) h += '<p class="muted">Cargando las semanas del plan…</p>';
    else h += `<label class="lab" for="asWeek">${a ? 'Mover a otra semana' : 'Asignar semana'}</label><select class="sel tall" id="asWeek" data-f="asx" data-as="week">${weekOptions()}</select>` +
      `<div class="stack"><button class="btn" data-act="as-assign"${A.busy ? ' disabled' : ''}>${A.busy || (a ? 'Mover' : 'Asignar')}</button></div>`;
    h += '</div>';
    if (a) {
      const w = A.weeks.find(x => x.id === a.weekId);
      if (w) {
        h += '<div class="card sec"><span class="eyebrow">Sesiones de esta semana</span><ul class="plain">' + (w.sessions || []).map((s, i) => {
          const at = A.selDone[a.planId + '_' + a.weekId + '_' + i];
          return `<li><b>${esc(dayLabel(s.day))}${s.name && s.name !== dayLabel(s.day) ? ' · ' + esc(s.name) : ''}</b><small>${at ? 'Cumplida el ' + esc(new Date(at).toLocaleString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) : 'Pendiente'}</small></li>`;
        }).join('') + '</ul></div>';
      }
      h += `<div class="card sec"><span class="eyebrow">Ajustes para este atleta</span>${adjustHTML(a)}</div>`;
    }
    if (root.HalterReport && A.active && A.weeks.length) h += root.HalterReport.html(reportCtx());
    return h;
  }
  const reportCtx = () => ({ uid: A.sel, name: memberName(A.sel), weeks: A.weeks, stages: A.stages, names: A.names, asg: A.asg[A.sel] || null, planId: A.active, done: A.selDone, lang: lang() });
  async function guard(fn, ok) { A.err = ''; A.busy = 'Guardando…'; rerender(); try { await fn(); if (ok) H.toast(ok); } catch (e) { A.err = H.err(e); } A.busy = ''; rerender(); }
  function assign() {
    const wid = A.pick || (A.asg[A.sel] && A.asg[A.sel].weekId) || (A.weeks[0] && A.weeks[0].id), w = A.weeks.find(x => x.id === wid);
    if (!w || !A.active) return;
    guard(() => H.remote().setAssignment(A.sel, { planId: A.active, weekId: w.id, week: w.week, stageId: w.stageId, weekEndsAt: cutoffFor(Date.now()), setBy: A.uid }), 'Semana ' + w.week + ' asignada');
  }
  function onAct(act, el) {
    switch (act) {
      case 'as-open': select(el.dataset.uid); return true;
      case 'as-back': select(null); return true;
      case 'as-assign': assign(); return true;
      case 'as-start': startSession(+el.dataset.i); return true;
      case 'as-advance': advance(); return true;
      case 'rp-toggle': case 'rp-mode': case 'rp-copy': case 'rp-share': case 'rp-print': return !!root.HalterReport && root.HalterReport.onAct(act, el, reportCtx());
      case 'as-adj-save': {
        const a = A.asg[A.sel]; if (!a) return true;
        const pcts = {}; Object.keys(A.draft || {}).forEach(k => { if (A.draft[k] > 0 && A.draft[k] <= (k.indexOf('f_') === 0 ? 200 : 130)) pcts[k] = A.draft[k]; });
        guard(async () => { await H.remote().setAdjust(A.sel + '_' + a.planId + '_' + a.weekId, pcts); A.selAdj = pcts; }, 'Ajustes guardados'); return true;
      }
      case 'as-adj-clear': {
        const a = A.asg[A.sel]; if (!a) return true;
        guard(async () => { await H.remote().deleteAdjust(A.sel + '_' + a.planId + '_' + a.weekId); A.selAdj = {}; A.draft = {}; }, 'Ajustes quitados'); return true;
      }
    }
    return false;
  }

  root.HalterAssign = {
    init: init, reset: reset, startCoach: startCoach, startAthlete: startAthlete, athleteView: athleteView, onFinish: onFinish, flush: flush,
    selected: () => A.sel, detail: detailHTML, summary: asgLine, onAct: onAct, state: A, pure: pure
  };
})(typeof window !== 'undefined' ? window : globalThis);
