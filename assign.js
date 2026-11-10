/* Semana asignada (fase 4).
   - Entrenador: asigna a cada atleta la semana del plan activo, ve qué sesiones cumplió y ajusta los
     porcentajes desde 90 % (el avance de cada atleta es distinto).
   - Atleta: pestaña «Semana» con las sesiones de su semana (kg calculados con sus máximos), inicio de la
     sesión ya armada, y el botón «Pasar a la semana siguiente».
   La hora de corte (domingo 23:59, hora de Chile) la calcula la app; las reglas de Firestore comparan
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
  /* Próximo domingo a las 23:59 (hora de Chile). Si hoy es domingo y aún no son las 23:59, es hoy.
     (Hasta la 4.11 el corte era el viernes; el domingo deja los fines de semana para recuperar sesiones pendientes.) */
  const CUT_WD = 6;   // 0 = lunes … 6 = domingo
  function cutoffFor(nowMs) {
    const p = chile(nowMs), add = (CUT_WD - p.wd + 7) % 7;
    let t = chileToMs(p.y, p.m, p.d + add, 23, 59);
    if (t < nowMs) t = chileToMs(p.y, p.m, p.d + add + 7, 23, 59);
    return t;
  }
  /* Corte de la semana siguiente a otro corte: 7 días después, a las 23:59 de Chile y en el mismo día de la semana
     (las reglas exigen entre 6,9 y 7,08 días de diferencia) */
  const nextCutoff = prevMs => { const p = chile(prevMs); return chileToMs(p.y, p.m, p.d + 7, 23, 59); };
  /* Asignaciones que quedaron con el corte del viernes (hasta la 4.11): se pasan al domingo siguiente */
  const isFridayCut = ms => { const p = chile(ms); return p.wd === 4 && p.h === 23 && p.mi === 59; };
  const fridayToSunday = ms => { const p = chile(ms); return chileToMs(p.y, p.m, p.d + 2, 23, 59); };

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
    'tall-snatch': ['snatch', 1], 'snatch-with-2-s-pause-below-knee-and-1-s-pause-above-knee-sn': ['snatch', 1], 'snatch-with-above-knee-pause-snatch-pull': ['snatch', 1], 'drop-snatch': ['snatch', 1], 'deficit-snatch': ['snatch', 1], 'hip-snatch': ['snatch', 1], 'overhead-squat': ['snatch', 1.2],
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
  /* Tope de series que arma el plan por ejercicio (4.17.0): una celda mal escrita en el Excel (p. ej. % leídos como series) llegaba a
     generar 100 o más. El atleta igual puede agregar o quitar series en la sesión («+ Serie» / «− Serie»). */
  const MAX_PLAN_SETS = 10;
  /* Una fila por serie: la prescripción k repetida `sets` veces (1 si no trae series), hasta MAX_PLAN_SETS en total. Desde 90 % el % se puede ajustar. */
  function expandSets(item, adj, si, ii) {
    const out = [];
    (item.sets || []).forEach((p, k) => {
      const key = adjKey(si, ii, k), ov = adj && adj[key], n = p.sets > 0 ? p.sets : 1;
      const pct = p.adjustable && typeof ov === 'number' && ov > 0 ? ov : p.pct;
      for (let j = 0; j < n && out.length < MAX_PLAN_SETS; j++) out.push({ k: k, key: key, pct: pct, basePct: p.pct, reps: p.reps || '', adjustable: !!p.adjustable, max: !!p.max, orMore: !!p.orMore, adjusted: pct !== p.pct });
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
    if (ps.length === 1) { const id = localIdFor(partId(ps[0])); return { id: id, name: es(ps[0]), en: en(ps[0]), es: es(ps[0]), cat: / \+ /.test(en(ps[0])) ? 'cmplx' : 'acc', parts: [id] }; }   // «A + B» dentro de un solo ejercicio del glosario también es un complejo
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
        const pr = s.max ? '1' : String(s.reps || '');   // lo planificado va sombreado (pr); el atleta anota las repeticiones que hace
        return Object.assign({ kg: ref.kg > 0 && pct > 0 ? roundTo(ref.kg * pct / 100, rounding) : 0, reps: '', pct: pct, rpe: null, done: false, doneAt: null }, pr ? { pr: pr } : {});
      });
      if (!sets.length) sets.push({ kg: 0, reps: '', pct: 0, rpe: null, done: false, doneAt: null });
      const prev = items.find(q => q.exId === e.id);
      if (prev) prev.sets = prev.sets.concat(sets).slice(0, MAX_PLAN_SETS); else items.push({ exId: e.id, rest: e.rest || S.profile.rest || 120, sets: sets });
    });
    const dt = new Date();
    return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'),
      dayIdx: null, name: ses.name || 'Entrenamiento', startedAt: Date.now(), endedAt: null, notes: '', bw: S.profile.bw || null, items: items,
      plan: { planId: ctx.planId, weekId: ctx.weekId, idx: si } };
  }

  /* Sesión de una rutina especial: series con lo planificado sombreado (pr), kilos con el máximo del propio atleta y pausa del entrenador */
  function buildRoutineSession(S, rt, si) {
    const ses = rt && rt.sessions && rt.sessions[si]; if (!ses) return null;
    const rounding = (S.profile && S.profile.rounding) || 1, items = [];
    (ses.items || []).forEach(p => {
      if (!p.exId) return;
      let e = S.exercises.find(q => q.id === p.exId);
      if (!e) { e = Object.assign({ id: p.exId, name: p.name || 'Ejercicio', cat: p.cat || 'acc', rest: S.profile.rest || 120, max: 0, maxDate: null, builtin: false }, p.meas ? { meas: p.meas } : {}); S.exercises.push(e); }
      else if (p.meas && !e.meas) e.meas = p.meas;      // el entrenador definió cómo se mide (tiempo, repeticiones)
      if (p.desc && !e.desc) e.desc = String(p.desc).slice(0, 140);   // y la descripción del ejercicio
      const fixed = p.kg > 0 ? +p.kg : 0, kg = fixed || (e.max > 0 && p.pct > 0 ? roundTo(e.max * p.pct / 100, rounding) : 0), pct = p.pct > 0 ? p.pct : (fixed && e.max > 0 ? Math.round(fixed / e.max * 1000) / 10 : 0), pr = String(p.reps || '');
      const sets = [];
      for (let k = 0; k < (p.sets > 0 ? p.sets : 1); k++) sets.push(Object.assign({ kg: kg, reps: '', pct: pct, rpe: null, done: false, doneAt: null }, pr ? { pr: pr } : {}));
      const prev = items.find(q => q.exId === e.id);
      if (prev) prev.sets = prev.sets.concat(sets); else items.push(Object.assign({ exId: e.id, rest: p.rest > 0 ? p.rest : (e.rest || S.profile.rest || 120), sets: sets }, p.pause > 0 ? { pause: Math.min(Math.round(p.pause), 10) } : {}));
    });
    if (!items.length) return null;
    const dt = new Date();
    return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'),
      dayIdx: null, name: ses.name || rt.name || 'Rutina especial', startedAt: Date.now(), endedAt: null, notes: '', bw: S.profile.bw || null, items: items,
      routine: { id: rt.id, idx: si, name: rt.name } };
  }

  /* ¿Puede el atleta pasar a la semana siguiente? → { ok, why } */
  function advanceState(asg, week, done, now) {
    if (!asg || !week) return { ok: false, why: '' };
    if (!week.next) return { ok: false, why: 'Es la última semana del plan.' };
    const n = (week.sessions || []).length, need = week.kind !== 'transition' && n > 0;
    if (need) {
      // Se exigen todas las sesiones (con más de 7, las reglas exigen las 5 primeras y la última: ver firestore.rules)
      const must = []; for (let k = 0; k < n; k++) if (n <= 7 || k < 5 || k === n - 1) must.push(k);
      const miss = must.filter(k => !done[k]);
      if (miss.length) return { ok: false, why: miss.length === 1 ? 'Falta cumplir una sesión de la semana (' + ((week.sessions[miss[0]] || {}).name || 'sesión ' + (miss[0] + 1)) + ').' : 'Faltan ' + miss.length + ' sesiones por cumplir esta semana.' };
    }
    if (now < asg.weekEndsAt) return { ok: false, why: 'Se habilita el ' + fmtCut(asg.weekEndsAt) + '.' };
    return { ok: true, why: '' };
  }
  const cutFmt = new Intl.DateTimeFormat('es-CL', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const fmtCut = ms => cutFmt.format(new Date(ms)) + ' (hora de Chile)';

  const pure = { buildRoutineSession, factorKey, refMax, refFor, DERIVED, both, cutoffFor, nextCutoff, isFridayCut, fridayToSunday, chile, chileToMs, localIdFor, expandSets, MAX_PLAN_SETS, buildSession, advanceState, exerciseFor, adjKey, LOCAL, slugOf };
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
    weeks: [], stages: [], asg: {}, sel: null, selDone: {}, selAdj: null, selAdjKey: '', selDoneKey: '', draft: null, pick: '', ready: false, busy: '', err: '', selfPick: '',
    me: { asg: undefined, week: null, adj: {}, done: {}, savedAt: 0, routines: [] },
    routines: [], rt: null, rtDel: '', rtPrev: ''   // rutinas especiales: todas (entrenador) · borrador en edición · confirmación de borrado
  };
  let H = null, unsub = [], weekUnsub = [], meUnsub = [], selUnsub = [], adjUnsub = [];   // weekUnsub: semanas del plan activo (entrenador) · meUnsub: mi propia semana
  const cacheKey = () => 'halterofilia.v1.' + A.uid + '.week';
  const pendKey = () => 'halterofilia.v1.' + A.uid + '.pend';
  const rerender = () => { if (H) H.render(); };
  const tsMs = t => (t && typeof t.toMillis === 'function') ? t.toMillis() : (typeof t === 'number' ? t : 0);
  const unwatch = list => { list.splice(0).forEach(u => { try { u(); } catch (e) { /* ya cerrado */ } }); };
  const lang = () => { const S = window.HalterApp.state(); return (S && S.profile && S.profile.exLang) || 'en'; };
  const dayLabel = d => ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][d] || '';
  /* Varios planes a la vez (4.16.0): el entrenador elige el plan de cada atleta. A.plans[planId] = { weeks, stages, ok } (solo entrenador) */
  const MAX_PLANS = 6;
  const planOf = pid => (pid && A.plans[pid]) || { weeks: [], stages: [], ok: false };
  const stageName = (id, pid) => { const list = pid && A.plans[pid] ? A.plans[pid].stages : A.stages; const s = list.find(x => x.id === id); return s ? s.name : ''; };
  const planName = pid => { const p = (A.planList || []).find(x => x.id === pid); return p ? p.name || '' : ''; };
  const plansSorted = () => (A.planList || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es', { numeric: true }));
  /* Quiénes tienen asignada una semana de un plan (para «Planes»: no se elimina un plan en uso) */
  const planUsage = pid => Object.keys(A.asg || {}).filter(uid => A.asg[uid] && A.asg[uid].planId === pid).map(uid => uid === A.uid ? 'tú' : memberName(uid));
  function planOpts(sel) {
    const list = plansSorted();
    return (sel ? '' : '<option value="" selected disabled>Elige un plan</option>') + list.map(p => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(p.name || p.id)}</option>`).join('');
  }
  const weekTitle = w => 'Semana ' + w.week + (w.kind === 'transition' ? ' · Transición' : '');

  let weekKey = '';   // semana que se está escuchando como atleta
  function init(helpers) {
    H = helpers; if (root.HalterReport) root.HalterReport.init(helpers);
    document.addEventListener('change', e => { const t = e.target; if (t && t.dataset && t.dataset.as === 'rtuid' && A.rt) { A.rt.uid = t.value; A.rt.dirty = true; } if (t && t.dataset && t.dataset.as === 'week') { A.pick = t.value; } if (t && t.dataset && t.dataset.as === 'selfweek') { A.selfPick = t.value; }
      if (t && t.dataset && t.dataset.as === 'plan') { A.planPick = t.value; A.pick = ''; rerender(); } if (t && t.dataset && t.dataset.as === 'selfplan') { A.selfPlan = t.value; A.selfPick = ''; rerender(); } });
    document.addEventListener('input', e => {
      const t = e.target; if (t && t.dataset && A.rt && t.dataset.as === 'rtmode') { if (t.checked) { A.rt.mode = t.value === 'replace' ? 'replace' : 'extra'; A.rt.dirty = true; } return; }
      if (t && t.dataset && A.rt && (t.dataset.as === 'rtname' || t.dataset.as === 'rtnote')) { if (t.dataset.as === 'rtname') A.rt.name = t.value; else A.rt.note = t.value; A.rt.dirty = true; return; }
      if (!t || !t.dataset || t.dataset.as !== 'pct') return;
      const v = parseFloat(String(t.value).replace(',', '.')); A.draft = A.draft || {};
      if (t.value === '' || isNaN(v)) delete A.draft[t.dataset.key]; else A.draft[t.dataset.key] = Math.round(v * 10) / 10;
      const b = document.querySelector('[data-act="as-adj-save"]'); if (b) b.disabled = !adjDirty() || !!A.busy;   // el botón se habilita al escribir
    });
  }
  function reset() { if (root.HalterReport) root.HalterReport.reset(); weekKey = ''; unwatch(unsub); unwatch(weekUnsub); unwatch(meUnsub); unwatch(selUnsub); unwatch(adjUnsub); Object.keys(planFeeds).forEach(id => { unwatch(planFeeds[id]); delete planFeeds[id]; }); lastNewest = null; fast.parts = {}; fast.cat = null; fast.catPlan = null; A.uid = null; A.role = null; A.plans = {}; A.planList = []; A.planListOk = false; A.planPick = ''; A.selfPlan = ''; A.names = {}; A.stages = []; A.asg = {}; A.sel = null; A.selDone = {}; A.selAdj = null; A.draft = null; A.pick = ''; A.selfPick = ''; A.ready = false; A.err = ''; A.busy = ''; A.me = { asg: undefined, week: null, adj: {}, done: {}, savedAt: 0, routines: [] }; A.routines = []; A.rt = null; A.rtDel = ''; }

  /* Una sola vez por sesión del entrenador: las semanas asignadas con corte del viernes pasan al domingo 23:59 */
  let cutsChecked = false;
  function migrateCuts(list) {
    if (cutsChecked) return; cutsChecked = true;
    list.filter(x => typeof x.weekEndsAt === 'number' && isFridayCut(x.weekEndsAt)).forEach(x => {
      const d = { planId: x.planId, weekId: x.weekId, week: x.week, stageId: x.stageId, weekEndsAt: fridayToSunday(x.weekEndsAt), setBy: A.uid };
      Promise.resolve().then(() => H.remote().setAssignment(x.id, d)).catch(() => { /* semana que ya no existe: se corrige al reasignar */ });
    });
  }
  /* ---------- Escuchar datos ---------- */
  function startCoach(uid) {
    reset(); cutsChecked = false; A.uid = uid; A.role = 'coach'; const r = H.remote();
    if (root.HalterReads && root.HalterReads.useFast) root.HalterReads.useFast(false);   // el entrenador lee las piezas del plan y con ellas arma el documento único
    unsub.push(r.watchCol('assignments', list => { A.asg = {}; list.forEach(x => { A.asg[x.id] = x; }); migrateCuts(list); A.ready = true; if (A.sel) { watchAdj(); watchDone(); } rerender(); }, e => { A.err = H.err(e); A.ready = true; rerender(); }));
    /* Catálogo: con reads.js se baja una vez por versión del plan y se reutiliza (cloud.js lo pide igual y comparte la misma copia) */
    unsub.push(root.HalterReads ? root.HalterReads.feedCatalog(r, () => newestPlan(), (list, m) => { setNames(list || []); if (list && !(m && m.fromCache)) { fast.cat = list; fast.catPlan = newestPlan(); Object.keys(A.plans).forEach(tryFast); } rerender(); }, () => { /* opcional */ })
      : r.watchCol('exercises', list => { setNames(list); rerender(); }, () => { /* opcional */ }));
    /* Todos los planes publicados (hasta 6): cada uno con su copia local por versión; ya no hay «plan activo» */
    const onPlans = list => { A.planList = (list || []).slice(); A.planListOk = true; watchPlans(A.planList.map(x => x.id)); rerender(); };
    unsub.push(root.HalterReads ? root.HalterReads.feed('plans', { ttl: 10 * 60000, fetch: () => r.getCol('plans'), cb: onPlans, err: () => { A.planListOk = true; rerender(); } })
      : r.watchCol('plans', onPlans, () => { A.planListOk = true; rerender(); }));
    const onRoutines = list => { A.routines = list.slice().sort((a, b) => (tsMs(b.at) - tsMs(a.at))); rerender(); }, onRoutinesErr = e => { A.err = H.err(e); rerender(); };
    unsub.push(root.HalterReads ? root.HalterReads.feed('routines', { ttl: 10 * 60000, fetch: () => r.getCol('routines'), cb: onRoutines, err: onRoutinesErr })   // se renueva al guardar o quitar una rutina
      : r.watchCol('routines', onRoutines, onRoutinesErr));
    selfStart(uid, false, true);   // el entrenador también entrena el plan: su propia semana
  }
  const setNames = list => { A.names = {}; list.forEach(x => { A.names[x.id] = { en: x.en, es: x.es }; }); };
  /* El catálogo de ejercicios es uno solo para todos los planes: se versiona con el plan publicado más reciente */
  const newestPlan = () => { const l = (A.planList || []).slice().sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt)); return l.length ? l[0].id : null; };
  const planFeeds = {};   // planId → [unsub]
  let lastNewest = null;
  function watchPlans(ids) {
    Object.keys(planFeeds).forEach(id => { if (ids.indexOf(id) < 0) { unwatch(planFeeds[id]); delete planFeeds[id]; delete A.plans[id]; } });
    const nw = newestPlan(); if (nw !== lastNewest) { lastNewest = nw; if (root.HalterReads) root.HalterReads.poke('catalog'); }
    const r = H.remote();
    ids.forEach(planId => {
      if (planFeeds[planId]) return;
      const arr = planFeeds[planId] = []; A.plans[planId] = { weeks: [], stages: [], ok: false };
      const put = (stages, weeks, ok) => {
        const st = (stages || []).slice().sort((a, b) => a.order - b.order), ord = id => { const x = st.find(y => y.id === id); return x ? x.order : 0; };
        A.plans[planId] = { stages: st, weeks: (weeks || []).slice().sort((a, b) => ord(a.stageId) - ord(b.stageId) || a.week - b.week), ok: ok };
      };
      if (root.HalterReads) {
        /* Semanas y etapas de cada plan: una copia local por versión; por abrir la app solo se lee la ficha del plan (1 documento) */
        arr.push(root.HalterReads.feedPlan(r, planId, (parts, m) => {
          const ok = !(m && m.fromCache) /* solo vale la lista que confirma el servidor */;
          put(parts && parts.stages, parts && parts.weeks, ok);
          if (parts && ok) { fast.parts[planId] = parts; tryFast(planId); }
          rerender();
        }, () => { /* sin permiso o sin conexión */ }));
        return;
      }
      let wk = [], sg = [];
      arr.push(r.watchCol('plans/' + planId + '/weeks', (list, m) => { wk = list; put(sg, wk, !(m && m.fromCache)); rerender(); }, () => { /* sin permiso o sin conexión */ }));
      arr.push(r.watchCol('plans/' + planId + '/stages', list => { sg = list; put(sg, wk, A.plans[planId].ok); rerender(); }, () => { /* idem */ }));
    });
  }
  /* Plan en un solo documento (4.15.0; desde 4.16.0 uno por cada plan publicado): con las semanas, etapas y catálogo que el servidor
     confirmó, reads.js lo arma o lo renueva solo */
  const fast = { parts: {}, cat: null, catPlan: null };
  function tryFast(planId) {
    const RD = root.HalterReads;
    if (!RD || !RD.ensureFast || A.role !== 'coach' || !planId || !fast.parts[planId] || !fast.cat || fast.catPlan !== newestPlan()) return;
    RD.ensureFast(H.remote(), planId, fast.parts[planId], fast.cat).catch(() => { /* sin conexión: se intenta la próxima vez */ });
  }

  function startAthlete(uid, offline) { reset(); A.uid = uid; A.role = 'athlete'; if (root.HalterReads && root.HalterReads.useFast) root.HalterReads.useFast(true); selfStart(uid, offline, false); }
  /* Mi propia semana (atleta, y el entrenador cuando entrena el plan). noEx: el entrenador ya escucha los ejercicios */
  function selfStart(uid, offline, noEx) {
    try { const c = JSON.parse(LS.get(cacheKey()) || 'null'); if (c && (c.asg || (c.routines && c.routines.length))) { A.me = { asg: c.asg || null, week: c.week || null, adj: c.adj || {}, done: c.done || {}, savedAt: c.savedAt || 0, routines: c.routines || [], planName: c.planName || '' }; A.names = c.names || {}; A.stages = c.stages || []; } } catch (e) { /* caché dañada */ }
    if (offline) return;
    const r = H.remote();
    unsub.push(r.watchDoc('assignments/' + uid, (d, m) => {
      if (m && m.fromCache && d === null) return;
      const was = A.me.asg; A.me.asg = d;
      if (!d) { unwatch(meUnsub); weekKey = ''; A.me.week = null; A.me.adj = {}; A.me.done = {}; rerender(); return; }
      // se escucha la semana una vez por sesión de la app, aunque la asignación sea igual a la guardada en el dispositivo
      const key = d.planId + '|' + d.weekId;
      if (key !== weekKey) { weekKey = key; watchMyWeek(d, !!was && was.planId === d.planId && was.weekId === d.weekId); if (root.HalterReads) root.HalterReads.poke('catalog'); }
      saveCache(); rerender(); flush();
    }, e => { A.err = H.err(e); rerender(); }));
    if (!noEx) unsub.push(r.watchCol('routines', list => { A.me.routines = list.slice().sort((a, b) => (tsMs(b.at) - tsMs(a.at))); saveCache(); rerender(); }, () => { /* sin conexión: quedan las guardadas */ }, { uid: uid }));
    if (!noEx) unsub.push(root.HalterReads ? root.HalterReads.feedCatalog(r, () => (A.me.asg && A.me.asg.planId) || null, list => { setNames(list || []); saveCache(); rerender(); }, () => { /* opcional */ })
      : r.watchCol('exercises', list => { setNames(list); saveCache(); rerender(); }, () => { /* opcional */ }));
    flush();
  }
  function watchMyWeek(a, keepCache) {
    unwatch(meUnsub); const r = H.remote(), pre = a.planId + '_' + a.weekId + '_';
    if (!keepCache) { A.me.week = null; A.me.adj = {}; A.me.done = {}; }
    /* Etapas y semana del plan: con reads.js salen de la copia local si la versión del plan no cambió (1 lectura de la ficha del plan en vez de las etapas + la semana) */
    const RDw = root.HalterReads;
    const onStages = list => { A.stages = list || []; saveCache(); rerender(); };
    const onWeek = (d, m) => {
      A.me.weekErr = ''; A.me.weekMissing = !d && !(m && m.fromCache);   // el servidor confirma que esa semana no existe en el plan
      if (d) { A.me.week = d; saveCache(); } else if (A.me.weekMissing) A.me.week = null; rerender();
    };
    const onWeekErr = e => { A.me.weekErr = H.err(e); rerender(); };
    if (A.role !== 'coach') meUnsub.push(RDw ? RDw.feedStages(r, a.planId, onStages, () => { /* sin conexión: queda la copia guardada */ })
      : r.watchCol('plans/' + a.planId + '/stages', onStages, () => { /* sin conexión: queda la copia guardada */ }));
    /* Nombre del plan para «Hoy» y «Semana» (4.16.0): sale de la ficha del plan, que ya se lee para saber su versión */
    if (A.role !== 'coach') Promise.resolve(RDw && RDw.planMeta ? RDw.planMeta(r, a.planId).then(pm => pm && pm.meta) : r.getDoc('plans/' + a.planId))
      .then(d => { const n = (d && d.name) || ''; if (n !== A.me.planName) { A.me.planName = n; saveCache(); rerender(); } }).catch(() => { /* sin conexión: queda el guardado */ });
    meUnsub.push(RDw ? RDw.feedWeek(r, a.planId, a.weekId, onWeek, onWeekErr) : r.watchDoc('plans/' + a.planId + '/weeks/' + a.weekId, onWeek, onWeekErr));
    meUnsub.push(r.watchDoc('adjustments/' + A.uid + '_' + a.planId + '_' + a.weekId, d => { A.me.adj = (d && d.pcts) || {}; saveCache(); rerender(); }, () => { /* sin ajustes */ }));
    // solo las sesiones cumplidas de la semana asignada (no las de todo el año: son muchas lecturas)
    meUnsub.push(r.watchCol('users/' + A.uid + '/completions', list => {
      const done = {}; list.forEach(x => { if (x.id.indexOf(pre) === 0 && typeof x.sessionIdx === 'number') done[x.sessionIdx] = true; });
      A.me.done = done; saveCache(); rerender();
    }, () => { /* sin conexión */ }, { planId: a.planId, weekId: a.weekId }));
  }
  function saveCache() {
    if (!A.role || !(A.me.asg || (A.me.routines && A.me.routines.length))) return;
    A.me.savedAt = Date.now();
    LS.set(cacheKey(), JSON.stringify({ asg: A.me.asg, week: A.me.week, adj: A.me.adj, done: A.me.done, routines: A.me.routines, names: A.names, stages: A.stages, savedAt: A.me.savedAt, planName: A.me.planName || '' }));
  }

  /* ---------- Sesiones cumplidas (se envían con la hora del servidor; si no hay conexión quedan en cola) ---------- */
  const readPend = () => { try { return JSON.parse(LS.get(pendKey()) || '[]'); } catch (e) { return []; } };
  const writePend = l => LS.set(pendKey(), JSON.stringify(l));
  let flushing = false;
  async function flush() {
    if (flushing || !A.role || !H) return; flushing = true;
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
    if (!s || !s.plan || !A.role) return;
    const q = readPend(); if (!q.some(x => x.planId === s.plan.planId && x.weekId === s.plan.weekId && x.idx === s.plan.idx)) q.push(s.plan);
    writePend(q); flush();
  }

  /* Al borrar una sesión del Historial se quita su marca «Cumplida» (Semana y Hoy). Se conserva si otra sesión terminada del
     Historial cubre la misma sesión del plan (por ejemplo, si se repitió). Si no hay conexión, la baja queda en cola del propio Firestore. */
  function onDelete(s) {
    if (!s || !s.plan || !A.role || !H) return;
    const p = s.plan, id = p.planId + '_' + p.weekId + '_' + p.idx, S = window.HalterApp.state();
    if ((S.sessions || []).some(x => x.endedAt && x.plan && x.plan.planId === p.planId && x.plan.weekId === p.weekId && x.plan.idx === p.idx)) return;
    const q = readPend(), wasPending = q.some(x => x.planId === p.planId && x.weekId === p.weekId && x.idx === p.idx);
    if (wasPending) writePend(q.filter(x => !(x.planId === p.planId && x.weekId === p.weekId && x.idx === p.idx)));   // aún sin enviar: ya no se enviará
    const a = A.me.asg; if (a && a.planId === p.planId && a.weekId === p.weekId && A.me.done[p.idx]) { delete A.me.done[p.idx]; saveCache(); rerender(); }
    if (wasPending) return;
    H.remote().deleteCompletion(A.uid, id).catch(e => { H.toast('No se pudo quitar la marca «Cumplida»: ' + H.err(e)); });
  }

  /* ---------- Atleta ---------- */
  function sessionCard(w, si, ses) {
    const S = window.HalterApp.state(), done = !!A.me.done[si], adj = A.me.adj, rounding = (S.profile && S.profile.rounding) || 1, lang = (S.profile && S.profile.exLang) || 'en';
    const todayNo = ((new Date().getDay() + 6) % 7) + 1;
    let block = null, h = `<div class="card sec${ses.day === todayNo && !done ? ' today' : ''}"><div class="person"><div><b>${esc(dayLabel(ses.day))}${ses.name && ses.name !== dayLabel(ses.day) ? ' · ' + esc(ses.name) : ''}</b><small>${(ses.items || []).length} ${(ses.items || []).length === 1 ? 'ejercicio' : 'ejercicios'}</small></div>` +
      (done ? '<span class="badge ok">Cumplida</span>' : ses.day === todayNo ? '<span class="badge gd">Hoy</span>' : '') + '</div><ul class="plain">';
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
    if (w.kind !== 'transition') h += `<div class="actions"><button class="btn block${done ? ' ghost' : ''}" data-act="as-start" data-i="${si}">${done ? 'Registrar de nuevo' : '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor"/></svg><span>Iniciar esta sesión</span>'}</button></div>`;
    return h + '</div>';
  }
  /* ---------- Avisos de semana (4.14.0) ----------
     En «Hoy» (y arriba de «Semana»): 1) el entrenador asignó una semana nueva; 2) ya se puede pasar a la semana siguiente;
     3) ya pasó el corte pero faltan sesiones. Solo con la app abierta (sin servidor no hay avisos con la app cerrada).
     La última semana vista se guarda en el dispositivo; la primera vez (o tras actualizar la app) se toma la actual sin avisar. */
  const seenKey = () => 'halterofilia.weekSeen.' + A.uid;
  const asgId = a => a ? a.planId + '_' + a.weekId : '';
  const markSeen = a => LS.set(seenKey(), asgId(a));
  const lowerFirst = t => t ? t.charAt(0).toLowerCase() + t.slice(1) : '';
  const noticeBox = (title, text, acts, warn) => `<div class="wknote${warn ? ' warn' : ''}" role="status"><div><b>${esc(title)}</b>${esc(text)}</div>${acts || ''}</div>`;
  /* ¿Hay una semana asignada que este dispositivo aún no mostró? (y deja registro la primera vez) */
  function isNewWeek() {
    if (!H || !A.uid || A.role === 'coach') return false;
    const a = A.me.asg; if (a === undefined) return false;
    const seen = LS.get(seenKey());
    if (seen === null || !a) { if (seen !== asgId(a)) markSeen(a); return false; }   // sin semana se guarda '' para avisar la próxima que llegue
    return seen !== asgId(a);
  }
  function weekNotice(where) {
    if (!H || !A.uid || A.role === 'coach' || replacing()) return '';
    const m = A.me, a = m.asg, hoy = where === 'hoy';
    if (!a) { isNewWeek(); return ''; }
    if (isNewWeek()) {
      if (!hoy) return '';   // en «Semana» ya se ve la semana: athleteView la marca como vista
      const st = stageName(a.stageId), pn = m.planName;
      return noticeBox('Tu entrenador te asignó la semana ' + a.week + (pn ? ' de «' + pn + '»' : ''), (st ? st + '. ' : '') + 'Revisa sus sesiones en «Semana».',
        '<button class="btn sm" data-act="tab" data-tab="semana">Ver mi semana</button><button class="lnk" data-act="wk-seen">Entendido</button>');
    }
    const w = m.week; if (!w) return '';
    const now = Date.now(), st = advanceState(a, w, m.done, now);
    if (st.ok) return noticeBox('Ya puedes pasar a la semana siguiente', 'Cumpliste las sesiones de la semana ' + a.week + ' y ya pasó el corte.',
      `<button class="btn sm" data-act="as-advance"${A.busy ? ' disabled' : ''}>${esc(A.busy || 'Pasar a la semana siguiente')}</button>`);
    if (w.next && now >= a.weekEndsAt && st.why) return noticeBox('Aún no puedes cambiar de semana', 'Ya pasó el corte de la semana ' + a.week + ', pero ' + lowerFirst(st.why),
      hoy ? '<button class="btn sm ghost" data-act="tab" data-tab="semana">Ver mi semana</button>' : '', true);
    return '';
  }
  function athleteView() {
    const m = A.me, a = m.asg;
    let h = '<h1>Mi semana</h1>';
    if (A.err) h += window.HalterApp.errorBox(A.err, { retry: 'sync-now' });
    if (a === undefined) return h + '<div class="card sec"><p class="muted">Cargando…</p></div>';
    const coach = A.role === 'coach';
    if (!a && coach) return h + '<p class="muted">Elige un plan y una semana para entrenarla tú también. Tus sesiones y tus marcas quedan solo en tu cuenta; no entran en las comparaciones del equipo.</p>' + selfPicker(null);
    const rts = coach ? '' : routinesHTML(), rep = !coach && replacing();
    if (!a && rts) return h + rts + (rep ? '' : '<p class="muted">Aún no tienes una semana del plan asignada; mientras tanto, entrena con la rutina de tu entrenador.</p>');
    if (!a) return h + window.HalterApp.empty('semana', 'Aún no tienes semana asignada', 'Tu entrenador aún no te asigna una semana del plan. Mientras tanto puedes registrar tus sesiones en «Hoy».', '<button class="btn" data-act="tab" data-tab="hoy">Ir a Hoy</button>');
    h += rts;
    if (rep) return h + '<div class="card sec"><span class="eyebrow">Plan semanal</span><p class="muted">Tu entrenador reemplazó tu plan semanal por la rutina de arriba. Tu semana asignada queda guardada y vuelve a verse cuando él quite la rutina o la deje como complementaria.</p></div>';
    const w = m.week;
    if (!w && m.weekErr) return h + window.HalterApp.errorBox('No se pudo leer tu semana (' + m.weekErr + ').', { retry: 'sync-now' });
    if (!w && m.weekMissing) return h + window.HalterApp.errorBox('La semana que tienes asignada ya no existe en su plan. ' + (A.role === 'coach' ? 'Elige otra semana más abajo.' : 'Pídele a tu entrenador que te la asigne de nuevo.'), { title: 'Semana no encontrada' }) + (A.role === 'coach' ? selfPicker(a) : '');
    if (!w) return h + '<div class="card sec"><p class="muted">Cargando la semana…</p></div>';
    if (!coach) { if (isNewWeek()) markSeen(a); h += weekNotice('semana'); }   // al abrir «Semana» la semana nueva queda vista
    const pn = coach ? planName(a.planId) : m.planName;
    h += `<div class="card sec wk-card"><span class="eyebrow gd">${esc((pn ? pn + ' · ' : '') + weekTitle(w))}</span><p class="lead">${esc(stageName(w.stageId, a.planId) || '')}</p>` +
      (w.kind === 'transition' ? '<p class="muted">Semana de transición: actividad física y ejercicio libre para la descarga física y mental. Descanso de halterofilia.</p>' : '') +
      (w.notes && w.notes.length && w.kind !== 'transition' ? '<ul class="plain">' + w.notes.map(n => `<li><small>${esc(n)}</small></li>`).join('') + '</ul>' : '') +
      (coach ? '' : `<small class="muted">Cambia de semana desde el ${esc(fmtCut(a.weekEndsAt))}</small>`) + '</div>';
    h += (w.sessions || []).map((s, i) => sessionCard(w, i, s)).join('');
    if (coach) return h + selfPicker(a);
    const st = advanceState(a, w, m.done, Date.now());
    h += `<div class="card sec"><span class="eyebrow">Cambiar de semana</span><p class="muted">${st.ok ? 'Cumpliste la última sesión y ya pasó el corte: puedes pasar a la semana siguiente.' : esc(st.why)}</p>` +
      `<div class="actions"><button class="btn ghost block" data-act="as-advance"${st.ok && !A.busy ? '' : ' disabled'}>${A.busy || 'Pasar a la semana siguiente'}</button></div></div>`;
    return h;
  }
  /* El entrenador elige su propia semana (sin corte ni requisitos: es su plan personal) */
  /* Plan elegido en un selector: el que se tocó, o el de la semana asignada, o el único publicado */
  const pickedPlan = (touched, a) => { const ok = id => id && (A.planList || []).some(p => p.id === id); return ok(touched) ? touched : ok(a && a.planId) ? a.planId : (A.planList || []).length === 1 ? A.planList[0].id : ''; };
  /* Selector de plan + semana (ficha del atleta y «Mi semana» del entrenador) */
  function planWeekPicker(o) {
    if (!A.planListOk) return '<p class="muted">Cargando los planes…</p>';
    if (!(A.planList || []).length) return window.HalterApp.empty('plan', 'Todavía no hay planes', 'Publica uno en «Planes».');
    const pid = o.pid, P = planOf(pid);
    let h = `<label class="lab" for="${o.planEl}">Plan</label><select class="sel tall" id="${o.planEl}" data-f="asx" data-as="${o.planAs}">${planOpts(pid)}</select>`;
    if (!pid) return h + '<p class="muted">Elige el plan para ver sus semanas.</p>';
    if (!P.weeks.length) return h + '<p class="muted">Cargando las semanas del plan…</p>';
    const sel = o.week || (o.a && o.a.planId === pid ? o.a.weekId : '') || P.weeks[0].id;
    return h + `<label class="lab" for="${o.weekEl}">Semana</label><select class="sel tall" id="${o.weekEl}" data-f="asx" data-as="${o.weekAs}">${weekOpts(sel, pid)}</select>` +
      `<div class="stack"><button class="btn${o.ghost ? ' ghost' : ''}" data-act="${o.act}"${A.busy ? ' disabled' : ''}>${A.busy || o.label}</button></div>`;
  }
  function selfPicker(a) {
    const pid = pickedPlan(A.selfPlan, a), change = a && pid !== a.planId;
    return `<div class="card sec"><span class="eyebrow">${a ? 'Cambiar de semana o de plan' : 'Mi semana'}</span>` +
      planWeekPicker({ pid: pid, a: a, week: A.selfPick, planEl: 'myPlan', planAs: 'selfplan', weekEl: 'myWeek', weekAs: 'selfweek', act: 'as-self', ghost: !!a, label: change ? 'Cambiar a este plan' : a ? 'Ir a esta semana' : 'Asignarme' }) + '</div>';
  }
  function assignSelf() {
    const a = A.me.asg, pid = pickedPlan(A.selfPlan, a), P = planOf(pid);
    const wid = A.selfPick || (a && a.planId === pid ? a.weekId : '') || (P.weeks[0] && P.weeks[0].id), w = P.weeks.find(x => x.id === wid);
    if (!w || !pid || A.role !== 'coach') return;
    guard(async () => { await H.remote().setAssignment(A.uid, { planId: pid, weekId: w.id, week: w.week, stageId: w.stageId, weekEndsAt: cutoffFor(Date.now()), setBy: A.uid }); A.selfPlan = ''; A.selfPick = ''; }, 'Estás en la semana ' + w.week + (planName(pid) ? ' de «' + planName(pid) + '»' : ''));
  }
  function startRoutine(rid, i) {
    const rt = (A.me.routines || []).find(x => x.id === rid); if (!rt) return;
    window.HalterApp.startPlanned(S => buildRoutineSession(S, rt, i));
  }
  /* Rutinas especiales que el entrenador armó para mí (se muestran antes que la semana del plan) */
  const replacing = () => (A.me.routines || []).some(r => r.mode === 'replace');
  function routinesHTML(opt) {
    const todayOnly = !!(opt && opt.today), todayNo = ((new Date().getDay() + 6) % 7) + 1;
    let list = A.me.routines || [];
    if (opt && opt.mode) list = list.filter(r => (opt.mode === 'replace') === (r.mode === 'replace'));
    const S = window.HalterApp.state(), done = {};
    (S && S.sessions || []).forEach(x => { if (x.routine && x.endedAt) { const k = x.routine.id + ':' + x.routine.idx; if (!done[k] || x.date > done[k]) done[k] = x.date; } });
    return list.map(r => {
      const rows = (r.sessions || []).map((x, i) => ({ x: x, i: i })).filter(o => !todayOnly || daysOf(o.x).indexOf(todayNo) >= 0);
      if (!rows.length) return '';
      return `<div class="card sec rt-card${todayOnly ? ' today' : ''}"><span class="eyebrow gd">${todayOnly ? 'Hoy · ' : ''}${r.mode === 'replace' ? 'Rutina en lugar del plan semanal' : 'Rutina complementaria'}</span><h2>${esc(r.name)}</h2>` + (r.note ? `<p class="muted">${esc(r.note)}</p>` : '') +
        '<ul class="plain">' + rows.map(o => {
          const x = o.x, i = o.i, d = done[r.id + ':' + i], n = (x.items || []).length, ds = daysOf(x), dl = ds.map(k => dayLabel(k).slice(0, 3)).join(' · '), today = ds.indexOf(todayNo) >= 0;
          return `<li><div><b>${esc(x.name || 'Sesión ' + (i + 1))}</b><small>${dl ? esc(dl) + (today ? ' (hoy)' : '') + ' · ' : ''}${n} ${n === 1 ? 'ejercicio' : 'ejercicios'}${d ? ' · hecha el ' + esc(d.split('-').reverse().join('-')) : ''}</small></div><button class="btn sm${today ? '' : ' ghost'}" data-act="rt-start" data-r="${esc(r.id)}" data-i="${i}">Iniciar</button></li>`;
        }).join('') + '</ul></div>';
    }).join('');
  }
  /* «Hoy»: lo que el entrenador asignó para el día de hoy. Primero la rutina que reemplaza al plan (completa); la sesión del plan
     va minimizada si hay rutina de reemplazo hoy; las rutinas complementarias del día cierran. Devuelve '' si no hay nada para hoy. */
  function todayHTML() {
    if (!H || !A.uid) return '';
    const m = A.me, coach = A.role === 'coach', todayNo = ((new Date().getDay() + 6) % 7) + 1;
    const rep = coach ? '' : routinesHTML({ today: true, mode: 'replace' }), ext = coach ? '' : routinesHTML({ today: true, mode: 'extra' });
    let plan = '';
    const w = m.week, a = m.asg;
    // con una rutina que reemplaza el plan semanal, el plan no se muestra ningún día de la semana (4.10.3)
    if (!coach && !replacing() && a && w && w.kind !== 'transition') (w.sessions || []).forEach((s, i) => { if (s.day === todayNo) plan += sessionCard(w, i, s); });
    if (!rep && !ext && !plan) return '';
    if (plan) plan = `<p class="eyebrow gd plan-tag">${esc((m.planName ? m.planName + ' · ' : '') + weekTitle(w))}</p>` + plan;
    return rep + plan + ext;
  }
  /* ¿El plan semanal está reemplazado por una rutina? → null si no; si sí, [lun…dom] con true en los días que la rutina marca para entrenar */
  function replaceDays() {
    if (!H || !A.uid || A.role === 'coach' || !replacing()) return null;
    const out = [false, false, false, false, false, false, false];
    (A.me.routines || []).forEach(r => { if (r.mode === 'replace') (r.sessions || []).forEach(x => daysOf(x).forEach(d => { out[d - 1] = true; })); });
    return out;
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
      LS.set(seenKey(), a.planId + '_' + w.next);   // la avanzó el propio atleta: no se le avisa como semana nueva
      H.toast('Ahora estás en la semana ' + nx.week);
    } catch (e) { A.err = H.err(e); }
    A.busy = ''; rerender();
  }

  /* ---------- Entrenador ---------- */
  /* La semana asignada ya no existe en el plan activo (por ejemplo, se volvió a subir el plan): el atleta no puede ver su semana */
  /* La semana asignada ya no existe en su plan (se volvió a subir el plan o se eliminó): el atleta no puede ver su semana */
  const isStale = (uid) => {
    const a = A.asg[uid]; if (!a) return false;
    if (A.planListOk && A.planList.length && !A.planList.some(p => p.id === a.planId)) return true;
    const P = A.plans[a.planId]; return !!(P && P.ok && !P.weeks.some(w => w.id === a.weekId));
  };
  const staleList = (uids) => (uids || Object.keys(A.asg)).filter(isStale);
  const asgLine = (uid) => { const a = A.asg[uid]; if (!a) return 'Sin semana asignada'; const pn = planName(a.planId); return (pn ? pn + ' · ' : '') + 'Semana ' + a.week + (stageName(a.stageId, a.planId) ? ' · ' + stageName(a.stageId, a.planId) : '') + (isStale(uid) ? ' · ya no existe en el plan' : ''); };
  function select(uid) {
    if (root.HalterReport) root.HalterReport.reset();
    unwatch(selUnsub); unwatch(adjUnsub); A.sel = uid; A.rtPrev = ''; A.selDone = {}; A.selDoneKey = ''; A.selAdj = null; A.draft = null; A.pick = ''; A.planPick = ''; A.selAdjKey = '';
    if (!uid) { rerender(); return; }
    watchAdj(); watchDone(); rerender();
  }
  /* Sesiones cumplidas de la semana asignada al atleta elegido (las de otras semanas las pide el informe cuando hacen falta) */
  function watchDone() {
    const a = A.asg[A.sel]; if (!a) return;
    const k = A.sel + '_' + a.planId + '_' + a.weekId; if (k === A.selDoneKey) return;
    unwatch(selUnsub); A.selDoneKey = k; A.selDone = {};
    selUnsub.push(H.remote().watchCol('users/' + A.sel + '/completions', list => { A.selDone = {}; list.forEach(x => { A.selDone[x.id] = x.completedAt; }); rerender(); }, () => { /* sin permiso */ }, { planId: a.planId, weekId: a.weekId }));
  }
  function watchAdj() {
    const a = A.asg[A.sel]; if (!a) return;
    const k = A.sel + '_' + a.planId + '_' + a.weekId; if (k === A.selAdjKey) return;
    unwatch(adjUnsub); A.selAdjKey = k; A.selAdj = null; A.draft = null;
    adjUnsub.push(H.remote().watchDoc('adjustments/' + k, d => { A.selAdj = (d && d.pcts) || {}; if (!A.draft) A.draft = Object.assign({}, A.selAdj); rerender(); }, () => { A.selAdj = {}; }));
  }
  const memberName = uid => { const m = (H.members() || []).find(x => x.id === uid); return m ? m.name : uid; };
  function weekOpts(sel, pid) {
    let h = '', last = null;
    planOf(pid).weeks.forEach(w => {
      if (w.stageId !== last) { if (last !== null) h += '</optgroup>'; h += `<optgroup label="${esc(stageName(w.stageId, pid) || w.stageId)}">`; last = w.stageId; }
      h += `<option value="${esc(w.id)}"${w.id === sel ? ' selected' : ''}>Semana ${w.week}${w.kind === 'transition' ? ' · transición' : ''}</option>`;
    });
    return h + (last !== null ? '</optgroup>' : '');
  }
  const adjDirty = () => JSON.stringify(A.draft || {}) !== JSON.stringify(A.selAdj || {});
  function adjustHTML(a) {
    const w = planOf(a.planId).weeks.find(x => x.id === a.weekId); if (!w) return '';
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
    if (A.rt) return rtEditorHTML();
    if (A.rtPrev) { const h = rtPreviewHTML(A.rtPrev); if (h) return h; A.rtPrev = ''; }
    const uid = A.sel, a = A.asg[uid];
    let h = `<p><button class="lnk" data-act="as-back">← Equipo</button></p><h1>${esc(memberName(uid))}</h1>`;
    if (A.err) h += window.HalterApp.errorBox(A.err, { retry: 'sync-now' });
    h += `<div class="card sec"><span class="eyebrow">Semana asignada</span><p class="lead">${esc(asgLine(uid))}</p>` +
      (a ? `<small class="muted">Cambia de semana desde el ${esc(fmtCut(a.weekEndsAt))}</small>` : '');
    const pid = pickedPlan(A.planPick, a), change = a && pid && pid !== a.planId;
    h += `<h3>${a ? 'Mover de semana o cambiar de plan' : 'Asignar plan y semana'}</h3>` +
      planWeekPicker({ pid: pid, a: a, week: A.pick, planEl: 'asPlan', planAs: 'plan', weekEl: 'asWeek', weekAs: 'week', act: 'as-assign', label: change ? 'Cambiar a este plan' : a ? 'Mover' : 'Asignar' }) +
      (change ? '<small class="muted">Al cambiar de plan, su historial y sus marcas se conservan; las sesiones cumplidas y los ajustes de la semana anterior quedan con el plan anterior.</small>' : '');
    h += '</div>';
    if (a) {
      const w = planOf(a.planId).weeks.find(x => x.id === a.weekId);
      if (w) {
        h += '<div class="card sec"><span class="eyebrow">Sesiones de esta semana</span><ul class="plain">' + (w.sessions || []).map((s, i) => {
          const at = A.selDone[a.planId + '_' + a.weekId + '_' + i];
          return `<li><b>${esc(dayLabel(s.day))}${s.name && s.name !== dayLabel(s.day) ? ' · ' + esc(s.name) : ''}</b><small>${at ? 'Cumplida el ' + esc(new Date(at).toLocaleString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) : 'Pendiente'}</small></li>`;
        }).join('') + '</ul></div>';
      }
      h += `<div class="card sec"><span class="eyebrow">Ajustes para este atleta</span>${adjustHTML(a)}</div>`;
    }
    h += rtListHTML(uid);
    if (root.HalterReport && a && planOf(a.planId).weeks.length) h += root.HalterReport.html(reportCtx());
    return h;
  }

  /* ---------- Rutinas especiales (el entrenador las arma con el mismo editor de la app; los kilos los calcula cada atleta) ---------- */
  const nEx = r => (r.sessions || []).reduce((n, x) => n + (x.items || []).length, 0);
  /* Días de una sesión de rutina: `days` (varios) o el antiguo `day` (uno) */
  const daysOf = x => Array.isArray(x.days) && x.days.length ? x.days.filter(d => d >= 1 && d <= 7) : (x.day >= 1 && x.day <= 7 ? [x.day] : []);
  const rtDays = r => { const all = []; (r.sessions || []).forEach(x => daysOf(x).forEach(d => { if (all.indexOf(d) < 0) all.push(d); })); return all.sort((a, b) => a - b).map(d => dayLabel(d).slice(0, 3)).join(' · '); };
  function rtListHTML(uid) {
    const list = A.routines.filter(x => x.uid === uid);
    let h = '<div class="card sec"><span class="eyebrow">Rutinas especiales</span>';
    h += list.length ? list.map(r => `<div class="person"><div class="who-row"><div><b>${esc(r.name)}</b><small>${(r.sessions || []).length} ${(r.sessions || []).length === 1 ? 'sesión' : 'sesiones'} · ${nEx(r)} ejercicios · ${r.mode === 'replace' ? 'reemplaza el plan semanal' : 'complementa el plan semanal'}${rtDays(r) ? ' · ' + rtDays(r) : ''}</small></div></div><div class="acts">` +
      `<button class="btn sm" data-act="rt-edit" data-id="${esc(r.id)}">Editar</button><button class="btn ghost sm" data-act="rt-view" data-id="${esc(r.id)}">Ver como atleta</button><button class="btn ghost sm" data-act="rt-dup" data-id="${esc(r.id)}">Duplicar</button><button class="btn ghost sm" data-act="rt-del" data-id="${esc(r.id)}">${A.rtDel === r.id ? 'Confirmar' : 'Quitar'}</button></div></div>`).join('')
      : '<p class="muted">Sin rutinas especiales. Crea una cuando necesites algo distinto a la semana del plan: el atleta la ve en «Semana».</p>';
    return h + `<div class="stack"><button class="btn${list.length ? ' ghost' : ''}" data-act="rt-new" data-uid="${esc(uid)}">+ Crear rutina</button></div></div>`;
  }
  /* «Ver como atleta»: la rutina como la lee quien la entrena (los kilos salen del máximo de cada atleta, aquí se ven series, % y pausas) */
  function rtPreviewHTML(id) {
    const r = A.routines.find(x => x.id === id); if (!r) return '';
    const nm = memberName(r.uid);
    let h = `<p><button class="lnk" data-act="rt-view-close">← ${esc(nm)}</button></p><div class="note">Así la ve <b>${esc(nm)}</b>. Es solo una vista previa: no registra nada.</div>` +
      `<div class="card sec rt-card"><span class="eyebrow gd">${r.mode === 'replace' ? 'Rutina en lugar del plan semanal' : 'Rutina complementaria'}</span><h2>${esc(r.name)}</h2>` + (r.note ? `<p class="muted">${esc(r.note)}</p>` : '') + '</div>';
    (r.sessions || []).forEach((x, i) => {
      const ds = daysOf(x), items = x.items || [];
      h += `<div class="card sec"><div class="person"><div><b>${esc(x.name || 'Sesión ' + (i + 1))}</b><small>${ds.length ? esc(ds.map(k => dayLabel(k)).join(' · ')) + ' · ' : 'Cualquier día · '}${items.length} ${items.length === 1 ? 'ejercicio' : 'ejercicios'}</small></div></div><ul class="plain">`;
      items.forEach(p => {
        const parts = [(p.sets || 1) + '×' + (p.reps || '?')];
        if (p.pct > 0) parts.push(String(p.pct).replace('.', ',') + ' % del máximo'); if (p.kg > 0) parts.push(String(p.kg).replace('.', ',') + ' kg');
        if (p.pause > 0) parts.push('pausa de ' + p.pause + ' s'); if (p.rest > 0) parts.push('descanso ' + Math.floor(p.rest / 60) + ':' + String(p.rest % 60).padStart(2, '0'));
        h += `<li><div><b>${esc(p.name || p.exId)}</b><small>${esc(parts.join(' · '))}</small>${p.desc ? `<small class="edesc">${esc(p.desc)}</small>` : ''}</div></li>`;
      });
      h += '</ul></div>';
    });
    return h + '<div class="stack"><button class="btn ghost" data-act="rt-view-close">Volver</button></div>';
  }
  const clone = o => JSON.parse(JSON.stringify(o));
  function rtOpen(rt) { A.rt = rt; root.HalterApp.rt.bind(A.rt.sessions, redraw => { A.rt.dirty = true; if (redraw) rerender(); }); rerender(); window.scrollTo(0, 0); }
  function rtEditorHTML() {
    const R = A.rt, ha = root.HalterApp;
    const back = A.sel || R.uid;
    let h = `<p><button class="lnk" data-act="rt-cancel">← ${esc(memberName(back))}</button></p><h1>${R.id ? 'Editar rutina' : R.dup ? 'Duplicar rutina' : 'Nueva rutina'}</h1>` +
      `<p class="muted">${R.id ? `Para <b>${esc(memberName(R.uid))}</b>. ` : ''}Se arma igual que tu plan semanal: series, repeticiones y % del máximo (los kilos los calcula cada atleta con su propio máximo) o, si prefieres, kilos fijos. Cada ejercicio también lleva su descanso y la pausa en el movimiento (0 a 10 s). A cada sesión puedes ponerle un día de entrenamiento.</p>`;
    if (A.err) h += ha.errorBox(A.err, { retry: 'sync-now' });
    if (!R.id) {   // rutina nueva o copia: se elige para qué atleta (por defecto, el que está abierto)
      const ms = (H.members() || []).slice().sort((x, y) => String(x.name || '').localeCompare(String(y.name || ''), 'es'));
      if (!ms.some(x => x.id === R.uid)) ms.unshift({ id: R.uid, name: memberName(R.uid) });
      h += `<div class="card sec"><label class="lab" for="rtUid">Para qué atleta</label><select class="sel tall" id="rtUid" data-as="rtuid">` +
        ms.map(x => `<option value="${esc(x.id)}"${x.id === R.uid ? ' selected' : ''}>${esc(x.name || x.id)}</option>`).join('') + '</select>' +
        (R.dup ? '<small class="muted">Es una copia: la rutina original no cambia. Revisa los días y el modo antes de guardar.</small>' : '') + '</div>';
    }
    h += `<div class="card sec"><label class="lab" for="rtName">Nombre de la rutina</label><input class="txt" id="rtName" data-as="rtname" maxlength="80" placeholder="Ej.: Rehabilitación de hombro" value="${esc(R.name)}"></div>`;
    const md = R.mode === 'replace' ? 'replace' : 'extra';
    h += `<div class="card sec"><span class="eyebrow">¿Cómo se usa esta rutina?</span><label class="opt"><input type="radio" name="rtmode" data-as="rtmode" value="extra"${md === 'extra' ? ' checked' : ''}><span><b>Complementa el plan semanal</b><small>El atleta ve su semana del plan y, además, esta rutina. Puede entrenar una, otra o ambas.</small></span></label>` +
      `<label class="opt"><input type="radio" name="rtmode" data-as="rtmode" value="replace"${md === 'replace' ? ' checked' : ''}><span><b>Reemplaza el plan semanal</b><small>Mientras exista, el plan se reemplaza toda la semana: el atleta solo ve esta rutina y entrena únicamente los días que marques; los demás días son de descanso. Su semana asignada queda guardada, oculta.</small></span></label></div>`;
    h += R.sessions.map((d, i) => ha.rt.card(d, i)).join('');
    h += `<button class="btn ghost block" data-act="rt-ses-add"${R.sessions.length >= 14 ? ' disabled' : ''}>+ Sesión</button>`;
    h += `<div class="card sec"><label class="lab" for="rtNote">Nota para el atleta (opcional)</label><textarea class="txt area" id="rtNote" data-as="rtnote" rows="3" maxlength="400" placeholder="Indicaciones, molestias a cuidar…">${esc(R.note || '')}</textarea></div>`;
    h += `<div class="stack"><button class="btn" data-act="rt-save"${A.busy ? ' disabled' : ''}>${A.busy || 'Guardar rutina'}</button></div>`;
    return h;
  }
  function rtSave() {
    const R = A.rt; if (!R) return;
    const name = (R.name || '').trim();
    if (!name) { H.toast('Ponle un nombre a la rutina.'); const i = document.getElementById('rtName'); if (i) i.focus(); return; }
    const sessions = [];
    for (let i = 0; i < R.sessions.length; i++) {
      const d = R.sessions[i], items = (d.items || []).filter(p => p.exId);
      if (!items.length) { H.toast('La sesión ' + (i + 1) + ' no tiene ejercicios: agrégalos o quítala.'); return; }
      sessions.push({ name: (d.name || '').trim().slice(0, 40) || ('Sesión ' + (i + 1)), day: daysOf(d)[0] || 0, days: daysOf(d).slice().sort((a, b) => a - b), items: items.map(p => Object.assign({ exId: String(p.exId), name: String(p.name || '').slice(0, 80), cat: String(p.cat || 'acc'), sets: Math.min(Math.max(parseInt(p.sets, 10) || 1, 1), 30), reps: String(p.reps || '').replace(/[^\d+]/g, '').slice(0, 12), pct: Math.min(Math.max(+p.pct || 0, 0), 200), kg: Math.min(Math.max(Math.round((+p.kg || 0) * 10) / 10, 0), 600), rest: Math.min(Math.max(Math.round(+p.rest || 0), 0), 900), pause: Math.min(Math.max(Math.round(+p.pause || 0), 0), 10) }, p.meas === 'reps' || p.meas === 'time' || p.meas === 'kg' ? { meas: p.meas } : {}, String(p.desc || '').trim() ? { desc: String(p.desc).replace(/\s+/g, ' ').trim().slice(0, 140) } : {})) });
    }
    const data = { uid: R.uid, name: name.slice(0, 80), mode: R.mode === 'replace' ? 'replace' : 'extra', sessions: sessions, setBy: A.uid }, note = (R.note || '').trim().slice(0, 400); if (note) data.note = note;
    const id = R.id || (R.uid.slice(0, 12) + '_' + Date.now().toString(36));
    guard(async () => { await H.remote().setRoutine(id, data); A.rt = null; }, R.uid !== A.sel && A.sel ? 'Rutina guardada para ' + memberName(R.uid) : 'Rutina guardada');
  }
  function rtAct(act, el) {
    switch (act) {
      case 'rt-new': rtOpen({ id: null, uid: el.dataset.uid || A.sel, name: '', note: '', mode: 'extra', sessions: [{ name: 'Sesión 1', items: [] }], dirty: false }); return true;
      case 'rt-edit': { const r = A.routines.find(x => x.id === el.dataset.id); if (r) rtOpen({ id: r.id, uid: r.uid, name: r.name, note: r.note || '', mode: r.mode === 'replace' ? 'replace' : 'extra', sessions: clone(r.sessions || []), dirty: false }); return true; }
      case 'rt-dup': { const r = A.routines.find(x => x.id === el.dataset.id); if (r) rtOpen({ id: null, dup: true, uid: r.uid, name: (r.name + ' (copia)').slice(0, 80), note: r.note || '', mode: r.mode === 'replace' ? 'replace' : 'extra', sessions: clone(r.sessions || []), dirty: true }); return true; }
      case 'rt-view': A.rtPrev = el.dataset.id; rerender(); window.scrollTo(0, 0); return true;
      case 'rt-view-close': A.rtPrev = ''; rerender(); return true;
      case 'rt-cancel': A.rt = null; A.err = ''; rerender(); return true;
      case 'rt-ses-add': if (A.rt && A.rt.sessions.length < 14) { A.rt.sessions.push({ name: 'Sesión ' + (A.rt.sessions.length + 1), items: [] }); A.rt.dirty = true; rerender(); } return true;
      case 'rt-ses-rm': if (A.rt && A.rt.sessions.length > 1) { A.rt.sessions.splice(+el.dataset.d, 1); A.rt.dirty = true; rerender(); } else H.toast('Una rutina necesita al menos una sesión.'); return true;
      case 'rt-save': rtSave(); return true;
      case 'rt-del': {
        const id = el.dataset.id;
        if (A.rtDel !== id) { A.rtDel = id; rerender(); return true; }
        A.rtDel = ''; guard(() => H.remote().deleteRoutine(id), 'Rutina quitada'); return true;
      }
      case 'rt-start': startRoutine(el.dataset.r, +el.dataset.i); return true;
    }
    return false;
  }
  const reportCtx = () => { const a = A.asg[A.sel] || null, P = planOf(a && a.planId); return { uid: A.sel, name: memberName(A.sel), weeks: P.weeks, stages: P.stages, names: A.names, asg: a, planId: a && a.planId, done: A.selDone, lang: lang() }; };
  async function guard(fn, ok) { A.err = ''; A.busy = 'Guardando…'; rerender(); try { await fn(); if (ok) H.toast(ok); } catch (e) { A.err = H.err(e); } A.busy = ''; rerender(); }
  function assign() {
    const a = A.asg[A.sel], pid = pickedPlan(A.planPick, a), P = planOf(pid);
    const wid = A.pick || (a && a.planId === pid ? a.weekId : '') || (P.weeks[0] && P.weeks[0].id), w = P.weeks.find(x => x.id === wid);
    if (!w || !pid) return;
    guard(async () => { await H.remote().setAssignment(A.sel, { planId: pid, weekId: w.id, week: w.week, stageId: w.stageId, weekEndsAt: cutoffFor(Date.now()), setBy: A.uid }); A.planPick = ''; A.pick = ''; }, (planName(pid) ? '«' + planName(pid) + '» · ' : '') + 'Semana ' + w.week + ' asignada');
  }
  function onAct(act, el) {
    switch (act) {
      case 'as-open': select(el.dataset.uid); return true;
      case 'as-back': select(null); return true;
      case 'as-assign': assign(); return true;
      case 'as-start': startSession(+el.dataset.i); return true;
      case 'as-self': assignSelf(); return true;
      case 'as-advance': advance(); return true;
      case 'wk-seen': markSeen(A.me.asg); rerender(); return true;
      case 'rt-new': case 'rt-edit': case 'rt-dup': case 'rt-view': case 'rt-view-close': case 'rt-cancel': case 'rt-ses-add': case 'rt-ses-rm': case 'rt-save': case 'rt-del': case 'rt-start': return rtAct(act, el);
      case 'rp-toggle': case 'rp-refresh': case 'rp-mode': case 'rp-copy': case 'rp-share': case 'rp-print': return !!root.HalterReport && root.HalterReport.onAct(act, el, reportCtx());
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
    init: init, reset: reset, startCoach: startCoach, startAthlete: startAthlete, athleteView: athleteView, todayHTML: todayHTML, weekNotice: weekNotice, replaceDays: replaceDays, onFinish: onFinish, onDelete: onDelete, flush: flush,
    selected: () => A.sel, detail: detailHTML, planUsage: planUsage, MAX_PLANS: MAX_PLANS, summary: asgLine, isStale: isStale, stale: staleList, onAct: onAct, state: A, pure: pure
  };
})(typeof window !== 'undefined' ? window : globalThis);
