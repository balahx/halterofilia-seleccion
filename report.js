/* Halterofilia · Selección — fase 4b: informes del entrenador (planificado vs realizado y observaciones).
   El entrenador abre la ficha de un atleta y pide el informe de una semana o de un día. Se arma en el momento a partir de:
   - el plan (semana asignada y sus sesiones),
   - los registros del atleta (users/{uid}/records: sesiones, ejercicios) que las reglas dejan leer al entrenador,
   - las sesiones cumplidas (completions, con hora del servidor) y los ajustes de %.
   No envía nada solo (plan gratuito, sin Cloud Functions): se ve en pantalla y se copia, comparte o imprime.
   Parte pura (sin DOM) para probarla con Node: node tests/report-unit.js */
(function (root) {
  'use strict';
  const AP = () => (typeof module !== 'undefined' && module.exports ? require('./assign.js') : root.HalterAssignPure || (root.HalterAssign && root.HalterAssign.pure));
  const mainParts = item => (item.alts && item.alts[0] && item.alts[0].p) || [];

  /* «3» → 3; «1+2» (complex) → 3; vacío → 0 */
  function parseReps(s) {
    return String(s == null ? '' : s).split('+').reduce((t, p) => { const m = p.match(/\d+/); return t + (m ? +m[0] : 0); }, 0);
  }
  const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? 0 : n; };
  const r1 = x => Math.round(x * 10) / 10;
  const fmt = x => String(r1(x)).replace('.', ',');

  /* Lo planificado en una sesión, por ejercicio de la app del atleta (ids iguales a los de buildSession) */
  function plannedByEx(week, si, names, adj) {
    const A = AP(), ses = (week.sessions || [])[si], map = {}, order = [];
    if (!ses) return [];
    (ses.items || []).forEach((it, ii) => {
      if (!mainParts(it).length) return;
      const x = A.exerciseFor(it, names);
      if (!map[x.id]) { map[x.id] = { exId: x.id, en: x.en, es: x.es, sets: [] }; order.push(x.id); }
      map[x.id].sets = map[x.id].sets.concat(A.expandSets(it, adj, si, ii).map(s => ({ pct: s.pct || 0, reps: s.reps, max: !!s.max })));
    });
    return order.map(id => map[id]);
  }

  /* Series hechas → resumen: cantidad, repeticiones, tonelaje, esfuerzo medio y los kilos agrupados («2×(70 kg × 3)») */
  function doneSummary(sets) {
    const all = (sets || []).filter(s => s && s.done), d = all.filter(s => !s.miss), groups = [], missed = all.length - d.length;
    let reps = 0, ton = 0, rs = 0, rn = 0;
    d.forEach(s => {
      const r = parseReps(s.reps), kg = num(s.kg), secs = num(s.secs) > 0 ? Math.round(num(s.secs)) : 0; reps += r; ton += kg * r;
      if (s.rpe != null && s.rpe !== '' && num(s.rpe) > 0) { rs += num(s.rpe); rn++; }
      const key = kg + '|' + (s.reps == null ? '' : s.reps) + '|' + secs, last = groups[groups.length - 1];
      if (last && last.key === key) last.n++; else groups.push({ key: key, kg: kg, secs: secs, reps: String(s.reps == null ? '' : s.reps), n: 1 });
    });
    return { n: d.length, missed: missed, total: (sets || []).length, reps: reps, ton: ton, rpe: rn ? r1(rs / rn) : null,
      text: groups.map(g => (g.n > 1 ? g.n + '×(' : '') + (g.kg > 0 ? fmt(g.kg) + ' kg × ' : '') + (g.secs > 0 ? g.secs + ' s' : (g.reps || '–')) + (g.n > 1 ? ')' : '')).join(', ') };
  }
  function plannedSummary(sets) {
    const pcts = [], seen = {};
    let reps = 0;
    (sets || []).forEach(s => { reps += parseReps(s.reps); const t = s.max ? 'máx' : (s.pct ? fmt(s.pct) + ' %' : ''); if (t && !seen[t]) { seen[t] = 1; pcts.push(t); } });
    return { n: (sets || []).length, reps: reps, text: pcts.join(' / ') };
  }

  const principal = (x, lang) => {
    const en = x.en || x.name || x.exId || '', es = x.es || x.name || '';
    if (!es || es === en) return { p: en, s: '' };
    return lang === 'es' ? { p: es, s: en } : { p: en, s: es };
  };

  /* Informe de una sesión. rec = sesión registrada por el atleta (o null); planned = salida de plannedByEx (o null si fue libre). */
  function sessionReport(rec, planned, ctx) {
    const lang = ctx.lang || 'en', exNames = ctx.exNames || {}, items = [], seen = {};
    const noteOf = id => (rec && rec.items || []).filter(i => i.exId === id && i.note && String(i.note).trim()).map(i => String(i.note).trim()).filter((n, k, a) => a.indexOf(n) === k).join(' · ');
    const recItem = id => (rec && rec.items || []).filter(i => i.exId === id).reduce((a, i) => ({ exId: id, sets: a.sets.concat(i.sets || []) }), { exId: id, sets: [] });
    (planned || []).forEach(p => {
      seen[p.exId] = 1;
      const ps = plannedSummary(p.sets), ds = doneSummary(recItem(p.exId).sets);
      const status = !rec ? 'pending' : (ds.n === 0 && !ds.missed) ? 'omitted' : ds.n < ps.n ? 'partial' : 'ok';
      items.push({ exId: p.exId, name: principal(p, lang), planned: ps, done: ds, status: status, note: noteOf(p.exId) });
    });
    (rec && rec.items || []).forEach(i => {
      if (seen[i.exId]) return; seen[i.exId] = 1;
      const ds = doneSummary(recItem(i.exId).sets); if (!ds.n) return;
      const nm = exNames[i.exId] || { en: i.exId };
      items.push({ exId: i.exId, name: principal(nm, lang), planned: null, done: ds, status: planned ? 'extra' : 'free', note: noteOf(i.exId) });
    });
    const t = { plannedSets: 0, doneSets: 0, reps: 0, ton: 0, rpeSum: 0, rpeN: 0 };
    items.forEach(it => {
      if (it.planned) t.plannedSets += it.planned.n;
      t.doneSets += it.done.n; t.reps += it.done.reps; t.ton += it.done.ton;
      if (it.done.rpe != null) { t.rpeSum += it.done.rpe; t.rpeN++; }
    });
    return { registered: !!rec, date: rec ? rec.date : '', name: rec ? rec.name : '', durationMin: rec && rec.endedAt && rec.startedAt ? Math.round((rec.endedAt - rec.startedAt) / 60000) : 0,
      bw: rec && rec.bw ? rec.bw : null, notes: rec && rec.notes ? String(rec.notes).trim() : '', items: items,
      totals: { plannedSets: t.plannedSets, doneSets: t.doneSets, reps: t.reps, ton: Math.round(t.ton), rpe: t.rpeN ? r1(t.rpeSum / t.rpeN) : null } };
  }

  /* La sesión registrada de la sesión n del plan (si se repitió, la última) */
  function findRecord(sessions, planId, weekId, idx) {
    const c = sessions.filter(s => s.plan && s.plan.planId === planId && s.plan.weekId === weekId && s.plan.idx === idx && s.endedAt);
    c.sort((a, b) => a.endedAt - b.endedAt);
    return c.length ? c[c.length - 1] : null;
  }

  const DAYS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const dayName = d => DAYS[d] || '';
  const dateEs = ymd => { if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return ymd || ''; const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); };

  /* Informe de una semana del plan: cada sesión planificada frente a lo registrado */
  function weekReport(a) {
    const week = a.week, sessions = [], sum = { plannedSessions: 0, doneSessions: 0, plannedSets: 0, doneSets: 0, reps: 0, ton: 0, rpeSum: 0, rpeN: 0 };
    const notes = [];
    (week.sessions || []).forEach((ses, si) => {
      const rec = findRecord(a.sessions || [], a.planId, week.id, si), planned = plannedByEx(week, si, a.names, a.adj);
      const rep = sessionReport(rec, planned, a);
      const at = a.done && a.done[a.planId + '_' + week.id + '_' + si];
      rep.index = si; rep.label = dayName(ses.day) + (ses.name && ses.name !== dayName(ses.day) ? ' · ' + ses.name : ''); rep.completedAt = at || null;
      rep.status = rec ? 'done' : 'missing';
      sessions.push(rep);
      sum.plannedSessions++; if (rec) sum.doneSessions++;
      sum.plannedSets += rep.totals.plannedSets; sum.doneSets += rep.totals.doneSets; sum.reps += rep.totals.reps; sum.ton += rep.totals.ton;
      if (rep.totals.rpe != null) { sum.rpeSum += rep.totals.rpe; sum.rpeN++; }
      if (rep.notes) notes.push({ label: rep.label + (rep.date ? ' (' + dateEs(rep.date) + ')' : ''), text: rep.notes });
      rep.items.forEach(it => { if (it.note) notes.push({ label: rep.label + ' · ' + itemName(it.name) + (rep.date ? ' (' + dateEs(rep.date) + ')' : ''), text: it.note }); });
    });
    return { kind: 'week', athlete: a.athlete, title: 'Semana ' + week.week + (a.stage ? ' · ' + a.stage : '') + (week.kind === 'transition' ? ' · transición' : ''), transition: week.kind === 'transition',
      sessions: sessions, notes: notes,
      totals: { plannedSessions: sum.plannedSessions, doneSessions: sum.doneSessions, plannedSets: sum.plannedSets, doneSets: sum.doneSets, reps: sum.reps, ton: Math.round(sum.ton), rpe: sum.rpeN ? r1(sum.rpeSum / sum.rpeN) : null } };
  }

  /* Informe de un día: todas las sesiones registradas esa fecha (del plan o libres) */
  function dayReport(a) {
    const day = (a.sessions || []).filter(s => s.date === a.date && s.endedAt).sort((x, y) => x.startedAt - y.startedAt);
    const out = [], notes = [], sum = { doneSets: 0, plannedSets: 0, reps: 0, ton: 0, rpeSum: 0, rpeN: 0 };
    day.forEach(rec => {
      let planned = null, extra = '';
      if (rec.plan) {
        const wk = (a.weeks || []).find(w => w.id === rec.plan.weekId);
        if (wk) { planned = plannedByEx(wk, rec.plan.idx, a.names, (a.adjFor && a.adjFor(rec.plan.planId, rec.plan.weekId)) || {}); extra = 'Semana ' + wk.week + ' · ' + dayName(((wk.sessions || [])[rec.plan.idx] || {}).day); }
      }
      const rep = sessionReport(rec, planned, a); rep.label = rec.name || 'Sesión'; rep.plan = extra; rep.status = 'done'; out.push(rep);
      sum.doneSets += rep.totals.doneSets; sum.plannedSets += rep.totals.plannedSets; sum.reps += rep.totals.reps; sum.ton += rep.totals.ton;
      if (rep.totals.rpe != null) { sum.rpeSum += rep.totals.rpe; sum.rpeN++; }
      if (rep.notes) notes.push({ label: rep.label, text: rep.notes });
      rep.items.forEach(it => { if (it.note) notes.push({ label: rep.label + ' · ' + itemName(it.name), text: it.note }); });
    });
    return { kind: 'day', athlete: a.athlete, title: dateEs(a.date), sessions: out, notes: notes,
      totals: { plannedSessions: 0, doneSessions: out.length, plannedSets: sum.plannedSets, doneSets: sum.doneSets, reps: sum.reps, ton: Math.round(sum.ton), rpe: sum.rpeN ? r1(sum.rpeSum / sum.rpeN) : null } };
  }

  const STATUS = { ok: 'Completo', partial: 'Parcial', omitted: 'Omitido', pending: 'Sin registrar', extra: 'Extra', free: '' };
  const itemName = n => n.p + (n.s ? ' (' + n.s + ')' : '');
  function itemLine(it) {
    const plan = it.planned ? it.planned.n + ' serie' + (it.planned.n === 1 ? '' : 's') + (it.planned.text ? ' @ ' + it.planned.text : '') : '';
    const done = it.done.n ? it.done.n + (it.planned ? ' de ' + it.planned.n : '') + ' hecha' + (it.done.n === 1 ? '' : 's') + ': ' + it.done.text + (it.done.rpe != null ? ' · RPE ' + fmt(it.done.rpe) : '') + (it.done.missed ? ' · ' + it.done.missed + (it.done.missed === 1 ? ' fallada' : ' falladas') : '') : (it.done.missed ? it.done.missed + (it.done.missed === 1 ? ' serie fallada' : ' series falladas') : 'sin series hechas');
    return (plan ? 'Plan ' + plan + ' → ' : '') + done;
  }
  const completedText = ms => new Date(ms).toLocaleString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' });

  /* Texto para copiar o compartir */
  function toText(r) {
    const L = [];
    L.push('INFORME · ' + (r.athlete || 'Atleta'));
    L.push(r.title);
    const t = r.totals;
    if (r.kind === 'week' && !r.transition) L.push(`Sesiones: ${t.doneSessions} de ${t.plannedSessions} · Series hechas: ${t.doneSets} de ${t.plannedSets} · Repeticiones: ${t.reps} · Tonelaje: ${t.ton} kg` + (t.rpe != null ? ` · RPE medio ${fmt(t.rpe)}` : ''));
    else if (r.kind === 'day') L.push(`Sesiones: ${t.doneSessions} · Series hechas: ${t.doneSets} · Repeticiones: ${t.reps} · Tonelaje: ${t.ton} kg` + (t.rpe != null ? ` · RPE medio ${fmt(t.rpe)}` : ''));
    if (r.transition) L.push('Semana de transición: descanso de halterofilia.');
    if (!r.sessions.length && r.kind === 'day') L.push('Sin sesiones registradas ese día.');
    r.sessions.forEach(s => {
      L.push('');
      L.push((s.label || 'Sesión') + (s.plan ? ' [' + s.plan + ']' : '') + ' — ' + (s.registered ? 'registrada' + (s.date ? ' el ' + dateEs(s.date) : '') + (s.durationMin ? ' (' + s.durationMin + ' min)' : '') : 'SIN REGISTRAR') + (s.completedAt ? ' · cumplida ' + completedText(s.completedAt) : ''));
      s.items.forEach(it => { L.push('  • ' + itemName(it.name) + (STATUS[it.status] ? ' [' + STATUS[it.status] + ']' : '') + ': ' + itemLine(it)); if (it.note) L.push('      Obs.: ' + it.note); });
      if (s.notes) L.push('  Observaciones: ' + s.notes);
    });
    if (r.notes.length) { L.push(''); L.push('OBSERVACIONES DEL ATLETA'); r.notes.forEach(n => L.push('  - ' + n.label + ': ' + n.text)); }
    else if (r.sessions.some(s => s.registered)) { L.push(''); L.push('Sin observaciones del atleta.'); }
    return L.join('\n');
  }

  const pure = { parseReps, plannedByEx, doneSummary, plannedSummary, sessionReport, findRecord, weekReport, dayReport, toText, dateEs };
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (!root.document) { root.HalterReportPure = pure; return; }

  /* ================== Interfaz (solo en el navegador) ================== */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ymdChile = ms => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); return p; };
  let H = null, unsub = null;
  const R = { uid: null, open: false, mode: 'week', weekId: '', date: '', recs: null, err: '', adj: {}, adjAsked: {}, doneMap: {}, doneAsked: {}, copied: '' };

  function reset() { if (unsub) { try { unsub(); } catch (e) { /* ya cerrado */ } } unsub = null; R.uid = null; R.open = false; R.recs = null; R.err = ''; R.adj = {}; R.adjAsked = {}; R.doneMap = {}; R.doneAsked = {}; R.weekId = ''; R.copied = ''; }
  function init(helpers) {
    H = helpers;
    document.addEventListener('change', e => {
      const t = e.target; if (!t || !t.dataset) return;
      if (t.dataset.as === 'rpweek') { R.weekId = t.value; H.render(); }
      else if (t.dataset.as === 'rpdate') { R.date = t.value; H.render(); }
    });
  }
  function parseRecords(list) {
    const sessions = [], exercises = {};
    list.forEach(x => {
      if (x.del || typeof x.d !== 'string') return;
      let o; try { o = JSON.parse(x.d); } catch (e) { return; }
      if (x.t === 'session' && o && Array.isArray(o.items)) sessions.push(o);
      else if (x.t === 'exercise' && o && o.id) exercises[o.id] = { en: o.en || o.name, es: o.es || o.name, name: o.name };
    });
    return { sessions: sessions, exercises: exercises };
  }
  function start(uid) {
    if (R.uid === uid && unsub) return;
    reset(); R.uid = uid; R.open = true;
    unsub = H.remote().watchCol('users/' + uid + '/records', list => { R.recs = parseRecords(list); R.err = ''; H.render(); }, e => { R.err = H.err(e); R.recs = null; H.render(); });
  }
  function needAdj(uid, planId, weekId) {
    const k = uid + '_' + planId + '_' + weekId; if (R.adjAsked[k]) return;
    R.adjAsked[k] = 1;
    H.remote().getDoc('adjustments/' + k).then(d => { R.adj[k] = (d && d.pcts) || {}; H.render(); }).catch(() => { R.adj[k] = {}; });
  }

  /* Sesiones cumplidas de la semana que se está viendo (una consulta con filtro, una sola vez por semana) */
  function needDone(uid, planId, weekId) {
    const k = uid + '_' + planId + '_' + weekId; if (R.doneAsked[k]) return;
    R.doneAsked[k] = 1;
    H.remote().getCol('users/' + uid + '/completions', { planId: planId, weekId: weekId }).then(list => { list.forEach(x => { R.doneMap[x.id] = x.completedAt; }); H.render(); }).catch(() => { /* sin permiso o sin conexión */ });
  }
  function build(ctx) {
    const athlete = ctx.name, common = { athlete: athlete, names: ctx.names, exNames: R.recs.exercises, sessions: R.recs.sessions, lang: ctx.lang, done: Object.assign({}, R.doneMap, ctx.done), planId: ctx.planId };
    if (R.mode === 'day') {
      (R.recs.sessions || []).filter(s => s.date === R.date && s.plan).forEach(s => needAdj(ctx.uid, s.plan.planId, s.plan.weekId));
      return dayReport(Object.assign({}, common, { date: R.date, weeks: ctx.weeks, adjFor: (p, w) => R.adj[ctx.uid + '_' + p + '_' + w] }));
    }
    const w = ctx.weeks.find(x => x.id === R.weekId); if (!w) return null;
    needAdj(ctx.uid, ctx.planId, w.id); needDone(ctx.uid, ctx.planId, w.id);
    const st = ctx.stages.find(x => x.id === w.stageId);
    return weekReport(Object.assign({}, common, { week: w, adj: R.adj[ctx.uid + '_' + ctx.planId + '_' + w.id] || {}, stage: st ? st.name : '' }));
  }

  const BADGE = { ok: ['ok', 'Completo'], partial: ['warn', 'Parcial'], omitted: ['bad', 'Omitido'], pending: ['', 'Sin registrar'], extra: ['', 'Extra'], free: ['', ''] };
  function reportHTML(r) {
    const t = r.totals; let h = '';
    const stat = (v, l) => `<div class="rp-stat"><b>${esc(v)}</b><small>${esc(l)}</small></div>`;
    if (r.transition) h += '<p class="muted">Semana de transición: descanso de halterofilia, sin sesiones planificadas.</p>';
    else h += '<div class="rp-stats">' + (r.kind === 'week' ? stat(t.doneSessions + ' / ' + t.plannedSessions, 'sesiones') + stat(t.doneSets + ' / ' + t.plannedSets, 'series') : stat(t.doneSessions, 'sesiones') + stat(t.doneSets, 'series')) +
      stat(t.reps, 'repeticiones') + stat(t.ton + ' kg', 'tonelaje') + (t.rpe != null ? stat(fmt(t.rpe), 'RPE medio') : '') + '</div>';
    if (!r.sessions.length && r.kind === 'day') h += '<p class="muted">No hay sesiones registradas ese día.</p>';
    r.sessions.forEach(s => {
      h += `<div class="rp-ses"><div class="person"><div><b>${esc(s.label || 'Sesión')}</b><small>${s.registered ? 'Registrada' + (s.date ? ' el ' + esc(dateEs(s.date)) : '') + (s.durationMin ? ' · ' + s.durationMin + ' min' : '') : 'Sin registrar'}${s.plan ? ' · ' + esc(s.plan) : ''}${s.completedAt ? ' · cumplida ' + esc(completedText(s.completedAt)) : ''}</small></div>` +
        (r.kind === 'week' ? (s.registered ? '<span class="badge ok">Registrada</span>' : '<span class="badge bad">Sin registrar</span>') : '') + '</div><ul class="plain">';
      s.items.forEach(it => {
        const b = BADGE[it.status] || ['', ''];
        h += `<li><b>${esc(it.name.p)}</b>${it.name.s ? `<small class="exsub">${esc(it.name.s)}</small>` : ''}<small>${esc(itemLine(it))}</small>${it.note ? `<small class="inote-h">“${esc(it.note)}”</small>` : ''}${b[1] ? `<span class="badge ${b[0]}">${b[1]}</span>` : ''}</li>`;
      });
      if (!s.items.length) h += '<li><small>Sin ejercicios registrados.</small></li>';
      h += '</ul>' + (s.notes ? `<p class="notes">“${esc(s.notes)}”</p>` : '') + '</div>';
    });
    h += '<h3>Observaciones del atleta</h3>' + (r.notes.length ? '<ul class="plain">' + r.notes.map(n => `<li><b>${esc(n.label)}</b><small>${esc(n.text)}</small></li>`).join('') + '</ul>' : '<p class="muted">Sin observaciones.</p>');
    return h;
  }

  let lastText = '';
  /* ctx: { uid, name, weeks, stages, names, asg, done, lang } */
  function html(ctx) {
    let h = '<div class="card sec" id="rpCard"><span class="eyebrow">Informe del atleta</span>';
    if (!R.open || R.uid !== ctx.uid) {
      return h + '<p class="muted">Planificado frente a lo registrado por el atleta, con sus observaciones. Se arma al abrirlo.</p><div class="stack"><button class="btn" data-act="rp-toggle">Ver informe</button></div></div>';
    }
    if (!R.date) R.date = ymdChile(Date.now());
    if (!R.weekId || !ctx.weeks.some(w => w.id === R.weekId)) R.weekId = (ctx.asg && ctx.asg.weekId) || (ctx.weeks[0] && ctx.weeks[0].id) || '';
    h += `<div class="seg rp-seg" role="group" aria-label="Tipo de informe"><button data-act="rp-mode" data-m="week" aria-pressed="${R.mode === 'week'}">Semana</button><button data-act="rp-mode" data-m="day" aria-pressed="${R.mode === 'day'}">Día</button></div>`;
    if (R.mode === 'week') {
      let opts = '', last = null;
      ctx.weeks.forEach(w => {
        const sn = (ctx.stages.find(x => x.id === w.stageId) || {}).name || w.stageId;
        if (w.stageId !== last) { if (last !== null) opts += '</optgroup>'; opts += `<optgroup label="${esc(sn)}">`; last = w.stageId; }
        opts += `<option value="${esc(w.id)}"${w.id === R.weekId ? ' selected' : ''}>Semana ${w.week}${w.kind === 'transition' ? ' · transición' : ''}</option>`;
      });
      h += `<label class="lab" for="rpWeek">Semana del plan</label><select class="sel tall" id="rpWeek" data-as="rpweek">${opts}${last !== null ? '</optgroup>' : ''}</select>`;
    } else h += `<label class="lab" for="rpDate">Fecha</label><input class="txt" type="date" id="rpDate" data-as="rpdate" value="${esc(R.date)}">`;
    if (R.err) h += window.HalterApp.errorBox(R.err);
    else if (!R.recs) h += '<p class="muted">Cargando los registros del atleta…</p>';
    else {
      const rep = build(ctx);
      if (!rep) h += '<p class="muted">Elige una semana del plan.</p>';
      else {
        lastText = toText(rep);
        h += `<div class="rp-body"><h2>${esc(rep.title)}</h2>${reportHTML(rep)}</div>` +
          `<div class="stack rp-actions"><button class="btn" data-act="rp-copy">${R.copied ? 'Copiado ✓' : 'Copiar texto'}</button>${navigator.share ? '<button class="btn ghost" data-act="rp-share">Compartir</button>' : ''}<button class="btn ghost" data-act="rp-print">Imprimir o guardar PDF</button></div>`;
      }
    }
    return h + '<div class="stack"><button class="btn ghost" data-act="rp-toggle">Cerrar informe</button></div></div>';
  }

  function onAct(act, el, ctx) {
    switch (act) {
      case 'rp-toggle': if (R.open) { const u = R.uid; reset(); R.uid = null; } else start(ctx.uid); return true;
      case 'rp-mode': R.mode = el.dataset.m === 'day' ? 'day' : 'week'; return true;
      case 'rp-copy': {
        const done = () => { R.copied = '1'; H.render(); setTimeout(() => { R.copied = ''; H.render(); }, 2000); };
        try { navigator.clipboard.writeText(lastText).then(done, () => H.toast('No se pudo copiar. Usa «Compartir» o «Imprimir».')); } catch (e) { H.toast('No se pudo copiar. Usa «Compartir» o «Imprimir».'); }
        return true;
      }
      case 'rp-share': try { navigator.share({ title: 'Informe de entrenamiento', text: lastText }).catch(() => { /* cancelado */ }); } catch (e) { /* sin compartir */ } return true;
      case 'rp-print': {
        document.body.classList.add('rp-print');
        const off = () => { document.body.classList.remove('rp-print'); window.removeEventListener('afterprint', off); };
        window.addEventListener('afterprint', off); try { window.print(); } catch (e) { off(); }
        return true;
      }
    }
    return false;
  }

  root.HalterReport = { init: init, reset: reset, html: html, onAct: onAct, state: R, pure: pure };
})(typeof window !== 'undefined' ? window : globalThis);
