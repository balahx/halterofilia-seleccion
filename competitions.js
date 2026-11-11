/* Halterofilia · Selección — calendario de competencias y marcas oficiales (fase 4.10).
   - Entrenador: crea las competencias (nombre, fecha, lugar, nota), marca qué atletas compiten y, después del torneo,
     anota la marca oficial de cada uno (arranque, dos tiempos, categoría, puesto).
   - Atleta: ve la cuenta regresiva de su próxima competencia en «Hoy», la lista de competencias del equipo y sus marcas oficiales.
   Firestore: competitions/{id} { name, date 'AAAA-MM-DD', place?, note?, athletes [uid…], results { uid: { sn, cj, total, cat?, place? } }, by, at }
   Todo el equipo lee la lista; solo el entrenador escribe (firestore.rules). La lista se lee una vez y se reutiliza 10 min (reads.js).
   Las funciones puras se prueban con Node: node tests/competitions-unit.js */
(function (root) {
  'use strict';

  /* ---------- Parte pura ---------- */
  const DAY = 86400000;
  const utc = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const ymdOk = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(utc(s)).toISOString().slice(0, 10) === s;   // descarta fechas como 2026-13-01 o 2026-02-30
  /* Días de calendario desde `from` hasta `to` (ambos 'AAAA-MM-DD'): 0 = hoy, 1 = mañana, negativo = ya pasó */
  function daysUntil(to, from) { return Math.round((utc(to) - utc(from)) / DAY); }
  const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : 0; };
  const int = v => { const n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : 0; };

  /* Lo que se guarda de un resultado: total = arranque + dos tiempos solo si están los dos; sin nada → null */
  function cleanResult(r) {
    r = r || {};
    const sn = num(r.sn), cj = num(r.cj), place = int(r.place), cat = String(r.cat || '').trim().slice(0, 8);
    if (!sn && !cj && !place && !cat) return null;
    const o = { sn: sn, cj: cj, total: sn > 0 && cj > 0 ? Math.round((sn + cj) * 10) / 10 : 0 };
    if (cat) o.cat = cat;
    if (place) o.place = place;
    return o;
  }
  /* Documento listo para guardar (sin `by` ni `at`, que agrega el servidor). Los resultados solo de los inscritos. */
  function cleanDoc(d) {
    const athletes = Array.from(new Set((d.athletes || []).filter(u => typeof u === 'string' && u))).slice(0, 100);
    const results = {};
    athletes.forEach(u => { const r = cleanResult((d.results || {})[u]); if (r) results[u] = r; });
    const o = { name: String(d.name || '').trim().slice(0, 80), date: d.date, athletes: athletes, results: results };
    const place = String(d.place || '').trim().slice(0, 80), note = String(d.note || '').trim().slice(0, 400);
    if (place) o.place = place;
    if (note) o.note = note;
    return o;
  }
  function validate(d) {
    if (!String(d.name || '').trim()) return 'Escribe el nombre de la competencia.';
    if (!ymdOk(d.date)) return 'Elige la fecha de la competencia.';
    return '';
  }
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.name).localeCompare(String(b.name), 'es'));
  /* Próximas (hoy o después, de la más cercana a la más lejana) y pasadas (de la más reciente a la más antigua) */
  function split(list, today) {
    const ok = (list || []).filter(c => c && ymdOk(c.date));
    return { next: ok.filter(c => c.date >= today).sort(byDate), past: ok.filter(c => c.date < today).sort((a, b) => byDate(b, a)) };
  }
  const enrolled = (c, uid) => !!c && Array.isArray(c.athletes) && c.athletes.indexOf(uid) >= 0;
  /* La próxima competencia en la que está inscrito el atleta */
  function nextFor(list, uid, today) { return split(list, today).next.find(c => enrolled(c, uid)) || null; }
  /* Mejor total oficial del atleta entre todas las competencias: { total, sn, cj, comp } o null */
  function bestOfficial(list, uid) {
    let best = null;
    (list || []).forEach(c => { const r = c && c.results && c.results[uid]; if (r && r.total > 0 && (!best || r.total > best.total)) best = { total: r.total, sn: r.sn, cj: r.cj, comp: c }; });
    return best;
  }
  function countdownText(n) { return n === 0 ? 'Hoy' : n === 1 ? 'Mañana' : String(n); }
  const pure = { ymdOk: ymdOk, daysUntil: daysUntil, num: num, cleanResult: cleanResult, cleanDoc: cleanDoc, validate: validate, split: split, enrolled: enrolled, nextFor: nextFor, bestOfficial: bestOfficial, countdownText: countdownText };
  if (!root.document) { root.HalterCompPure = pure; if (typeof module !== 'undefined' && module.exports) module.exports = pure; return; }

  /* ---------- Interfaz ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => (isFinite(n) ? n : 0).toLocaleString('es-CL', { maximumFractionDigits: 1 });
  const H = { remote: () => null, toast: () => {}, render: () => {}, err: e => String(e && e.message || e), members: () => [], role: () => 'athlete', uid: () => '' };
  const CP = { list: null, err: '', edit: null, delAsk: '', busy: false, hist: false };
  const dFmt = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dShort = new Intl.DateTimeFormat('es-CL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const dateLong = d => cap(dFmt.format(new Date(utc(d))));
  const dateShort = d => cap(dShort.format(new Date(utc(d))).replace(/\./g, ''));
  const tzDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' });
  const today = () => tzDay.format(new Date());   // 'AAAA-MM-DD' en hora de Chile
  const isCoach = () => H.role() === 'coach';
  const nameOf = uid => { const m = H.members().find(x => x.id === uid); return (m && m.name) || 'Atleta'; };

  function init(o) { Object.assign(H, o || {}); }
  function reset() { Object.assign(CP, { list: null, err: '', edit: null, delAsk: '', busy: false, hist: false }); }
  /* Empieza a leer la lista; devuelve la función para dejar de leer */
  function start() {
    const r = H.remote(); if (!r) return () => {};
    const onList = list => { CP.list = list || []; CP.err = ''; H.render(); };
    const onErr = e => { CP.err = (e && e.code === 'permission-denied') ? '' : H.err(e); if (CP.list === null) CP.list = []; H.render(); };   // sin permiso (reglas aún sin publicar): se muestra vacía
    if (root.HalterReads) return root.HalterReads.feed('competitions', { ttl: 10 * 60000, fetch: () => r.getCol('competitions'), cb: onList, err: onErr });
    return r.watchCol('competitions', onList, onErr);
  }

  /* Tarjeta de «Hoy»: cuenta regresiva de la próxima competencia (del atleta; para el entrenador, la próxima del equipo) */
  function nextCardHTML() {
    if (!CP.list) return '';
    const t = today(), uid = H.uid();
    const c = isCoach() ? split(CP.list, t).next[0] : nextFor(CP.list, uid, t);
    if (!c) return '';
    const n = daysUntil(c.date, t), cnt = countdownText(n);
    return '<section class="card sec cp-next"><p class="eyebrow">' + (isCoach() ? 'Próxima competencia del equipo' : 'Tu próxima competencia') + '</p>' +
      '<div class="cp-row"><div class="cp-count"><b>' + esc(cnt) + '</b>' + (n > 1 ? '<small>días</small>' : '') + '</div><div class="cp-info"><b>' + esc(c.name) + '</b><span class="muted">' + esc(dateLong(c.date)) + (c.place ? ' · ' + esc(c.place) : '') + '</span>' +
      (isCoach() ? '<span class="muted">' + (c.athletes || []).length + ((c.athletes || []).length === 1 ? ' atleta inscrito' : ' atletas inscritos') + '</span>' : '') + '</div></div>' +
      '<button class="lnk" data-act="tab" data-tab="competencias">Ver competencias</button></section>';
  }
  /* Texto corto para la fila de «Más» */
  function moreText() {
    if (!CP.list) return 'Fechas y marcas oficiales';
    const t = today(), c = isCoach() ? split(CP.list, t).next[0] : nextFor(CP.list, H.uid(), t);
    if (c) { const n = daysUntil(c.date, t); return c.name + ' · ' + (n === 0 ? 'hoy' : n === 1 ? 'mañana' : 'en ' + n + ' días'); }
    return CP.list.length ? 'Sin competencias próximas' : 'Fechas y marcas oficiales';
  }

  function resultLine(r) {
    if (!r) return '';
    const p = [];
    if (r.sn > 0) p.push('Arranque ' + fmt(r.sn) + ' kg');
    if (r.cj > 0) p.push('Dos tiempos ' + fmt(r.cj) + ' kg');
    if (r.total > 0) p.push('<b>Total ' + fmt(r.total) + ' kg</b>');
    if (r.cat) p.push('Cat. ' + esc(r.cat));
    if (r.place) p.push(r.place + '.º lugar');
    return p.join(' · ');
  }
  function compCard(c, t) {
    const uid = H.uid(), n = daysUntil(c.date, t), future = n >= 0, mine = enrolled(c, uid), coach = isCoach();
    const cnt = future ? '<div class="cp-count sm"><b>' + esc(countdownText(n)) + '</b>' + (n > 1 ? '<small>días</small>' : '') + '</div>' : '';
    let h = '<div class="card sec cp-card"><div class="cp-row">' + cnt + '<div class="cp-info"><p class="eyebrow">' + esc(dateShort(c.date)) + '</p><b>' + esc(c.name) + '</b>' +
      (c.place ? '<span class="muted">' + esc(c.place) + '</span>' : '') + (c.note ? '<span class="muted">' + esc(c.note) + '</span>' : '') + '</div></div>';
    if (coach) {
      const names = (c.athletes || []).map(nameOf);
      h += '<p class="muted">' + (names.length ? 'Inscritos: ' + esc(names.join(', ')) : 'Aún no hay atletas inscritos.') + '</p>';
      if (!future) {
        const rs = (c.athletes || []).filter(u => c.results && c.results[u]);
        h += rs.length ? '<ul class="plain cp-res">' + rs.map(u => '<li><b>' + esc(nameOf(u)) + '</b><small>' + resultLine(c.results[u]) + '</small></li>').join('') + '</ul>' : '<p class="muted">Sin resultados cargados.</p>';
      }
      h += '<div class="stack"><button class="btn ghost sm" data-act="cp-edit" data-id="' + esc(c.id) + '">' + (future ? 'Editar' : 'Editar y cargar resultados') + '</button>' +
        '<button class="lnk danger" data-act="cp-del" data-id="' + esc(c.id) + '">' + (CP.delAsk === c.id ? 'Confirmar: eliminar' : 'Eliminar') + '</button></div>';
    } else if (future) {
      h += '<p><span class="badge ' + (mine ? 'ok' : '') + '">' + (mine ? 'Estás inscrito' : 'Sin inscripción') + '</span></p>';
    } else if (mine) {
      const r = c.results && c.results[uid];
      h += r ? '<p class="cp-mine">' + resultLine(r) + '</p>' : '<p class="muted">Sin resultado cargado todavía.</p>';
    }
    return h + '</div>';
  }

  function editorHTML() {
    const e = CP.edit, ms = H.members().slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
    const past = e.date && ymdOk(e.date) && e.date <= today();
    let h = '<h1>' + (e.id ? 'Editar competencia' : 'Nueva competencia') + '</h1>' +
      '<div class="card sec"><label class="lab" for="cpName">Nombre</label><input class="txt" id="cpName" data-cp="name" maxlength="80" value="' + esc(e.name) + '" placeholder="Ej.: Campeonato Nacional Senior">' +
      '<label class="lab" for="cpDate">Fecha</label><input class="txt" type="date" id="cpDate" data-cp="date" value="' + esc(e.date) + '">' +
      '<label class="lab" for="cpPlace">Lugar (opcional)</label><input class="txt" id="cpPlace" data-cp="place" maxlength="80" value="' + esc(e.place) + '" placeholder="Ciudad o recinto">' +
      '<label class="lab" for="cpNote">Nota (opcional)</label><input class="txt" id="cpNote" data-cp="note" maxlength="400" value="' + esc(e.note) + '" placeholder="Pesaje, horario, viaje…"></div>';
    h += '<div class="card sec"><p class="eyebrow">Quiénes compiten</p>' + (ms.length ? '<div class="checks">' + ms.map(m => '<label class="chk"><input type="checkbox" data-cp="ath" data-uid="' + esc(m.id) + '"' + (e.athletes.indexOf(m.id) >= 0 ? ' checked' : '') + '><span>' + esc(m.name || m.email || m.id) + '</span></label>').join('') + '</div>' : '<p class="muted">Aún no hay atletas aprobados.</p>') + '</div>';
    if (e.athletes.length) {
      h += '<div class="card sec"><p class="eyebrow">Marcas oficiales</p><p class="muted">' + (past ? 'Anota lo que levantó cada atleta en la competencia.' : 'Se pueden cargar después de la competencia; lo que escribas se guarda igual.') + ' El total se calcula solo.</p>';
      e.athletes.forEach(u => {
        const r = e.results[u] || {}, t = num(r.sn) > 0 && num(r.cj) > 0 ? fmt(num(r.sn) + num(r.cj)) : '–';
        h += '<fieldset class="cp-fs"><legend>' + esc(nameOf(u)) + '</legend><div class="row2"><label class="fl"><span>Arranque (kg)</span><input class="num sm" inputmode="decimal" data-cp="res" data-uid="' + esc(u) + '" data-k="sn" value="' + esc(r.sn || '') + '"></label>' +
          '<label class="fl"><span>Dos tiempos (kg)</span><input class="num sm" inputmode="decimal" data-cp="res" data-uid="' + esc(u) + '" data-k="cj" value="' + esc(r.cj || '') + '"></label></div>' +
          '<div class="row2"><label class="fl"><span>Categoría</span><input class="txt" maxlength="8" data-cp="res" data-uid="' + esc(u) + '" data-k="cat" value="' + esc(r.cat || '') + '" placeholder="−85"></label>' +
          '<label class="fl"><span>Puesto</span><input class="num sm" inputmode="numeric" data-cp="res" data-uid="' + esc(u) + '" data-k="place" value="' + esc(r.place || '') + '"></label></div>' +
          '<p class="muted">Total: <b data-cp-total="' + esc(u) + '">' + t + '</b> kg</p></fieldset>';
      });
      h += '</div>';
    }
    if (CP.err) h += '<div class="note warn" role="alert">' + esc(CP.err) + '</div>';
    return h + '<div class="stack"><button class="btn" data-act="cp-save"' + (CP.busy ? ' disabled' : '') + '>' + (CP.busy ? 'Guardando…' : 'Guardar') + '</button><button class="btn ghost" data-act="cp-cancel">Cancelar</button></div>';
  }

  function view() {
    if (CP.edit && isCoach()) return editorHTML();
    const t = today(), coach = isCoach();
    let h = '<h1>Competencias</h1><p class="muted">' + (coach ? 'Fechas de los torneos del equipo, quiénes compiten y sus marcas oficiales.' : 'Los torneos del equipo y tus marcas oficiales. Tu entrenador te inscribe en cada competencia.') + '</p>';
    if (coach) h += '<div class="stack cp-top"><button class="btn" data-act="cp-new">+ Nueva competencia</button></div>';
    if (CP.err) h += window.HalterApp.errorBox(CP.err);
    if (CP.list === null) return h + '<p class="muted">Leyendo competencias…</p>';
    const sp = split(CP.list, t);
    if (!CP.list.length) return h + window.HalterApp.empty('trophy', 'Aún no hay competencias', coach ? 'Crea la primera con «Nueva competencia».' : 'Cuando tu entrenador agregue una, la verás aquí.');
    if (!coach) {
      const best = bestOfficial(CP.list, H.uid());
      if (best) h += '<section class="card sec totalc"><p class="eyebrow">Mejor total oficial</p><p class="big">' + fmt(best.total) + ' <small>kg</small></p><p class="muted">Arranque ' + fmt(best.sn) + ' + Dos tiempos ' + fmt(best.cj) + ' · ' + esc(best.comp.name) + ' · ' + esc(dateShort(best.comp.date)) + '</p></section>';
    }
    h += '<h2 class="cp-h">Próximas</h2>' + (sp.next.length ? sp.next.map(c => compCard(c, t)).join('') : '<p class="muted">No hay competencias próximas.</p>');
    const past = coach ? sp.past : sp.past.filter(c => enrolled(c, H.uid()));
    if (past.length) h += '<h2 class="cp-h">Anteriores</h2>' + past.map(c => compCard(c, t)).join('');
    return h;
  }

  /* ---------- Eventos ---------- */
  const blank = () => ({ id: '', name: '', date: '', place: '', note: '', athletes: [], results: {} });
  function open(c) {
    CP.err = ''; CP.delAsk = '';
    CP.edit = c ? { id: c.id, name: c.name || '', date: c.date || '', place: c.place || '', note: c.note || '', athletes: (c.athletes || []).slice(), results: JSON.parse(JSON.stringify(c.results || {})) } : blank();
  }
  function onInput(e) {
    const t = e.target; if (!t || !t.dataset || !t.dataset.cp || !CP.edit) return;
    const k = t.dataset.cp;
    if (k === 'name' || k === 'place' || k === 'note') CP.edit[k] = t.value;
    else if (k === 'date') { CP.edit.date = t.value; if (e.type === 'change') H.render(); }
    else if (k === 'res') {
      const u = t.dataset.uid; CP.edit.results[u] = CP.edit.results[u] || {}; CP.edit.results[u][t.dataset.k] = t.value;
      const r = CP.edit.results[u], el = document.querySelector('[data-cp-total="' + (window.CSS && CSS.escape ? CSS.escape(u) : u) + '"]');
      if (el) el.textContent = num(r.sn) > 0 && num(r.cj) > 0 ? fmt(num(r.sn) + num(r.cj)) : '–';
    }
  }
  function onChange(e) {
    const t = e.target; if (!t || !t.dataset || t.dataset.cp !== 'ath' || !CP.edit) return;
    const u = t.dataset.uid, i = CP.edit.athletes.indexOf(u);
    if (t.checked && i < 0) CP.edit.athletes.push(u); else if (!t.checked && i >= 0) CP.edit.athletes.splice(i, 1);
    H.render();
  }
  document.addEventListener('input', onInput);
  document.addEventListener('change', e => { onInput(e); onChange(e); });

  function save() {
    const e = CP.edit; if (!e || CP.busy) return;
    const bad = validate(e); if (bad) { CP.err = bad; H.render(); return; }
    const r = H.remote(), id = e.id || ('c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
    const doc = cleanDoc(e); doc.by = H.uid();
    CP.busy = true; CP.err = ''; H.render();
    Promise.resolve(r.setCompetition(id, doc)).then(() => {
      CP.busy = false; CP.edit = null; H.toast('Competencia guardada.');
      const i = (CP.list || []).findIndex(x => x.id === id), saved = Object.assign({ id: id }, doc);
      if (CP.list) { if (i >= 0) CP.list[i] = saved; else CP.list.push(saved); }
      H.render();
    }, err => { CP.busy = false; CP.err = H.err(err); H.render(); });
  }
  function remove(id) {
    const c = (CP.list || []).find(x => x.id === id);
    window.HalterApp.ask({ title: '¿Eliminar ' + (c ? '«' + c.name + '»' : 'la competencia') + '?', text: 'Se borran su fecha, los atletas inscritos y sus marcas oficiales. No se puede deshacer.', ok: 'Eliminar competencia' })
      .then(ok => { if (ok) removeNow(id); });
  }
  function removeNow(id) {
    Promise.resolve(H.remote().deleteCompetition(id)).then(() => { CP.list = (CP.list || []).filter(x => x.id !== id); H.toast('Competencia eliminada.'); H.render(); }, err => { CP.err = H.err(err); H.render(); });
  }
  function onAct(act, el) {
    switch (act) {
      case 'cp-new': open(null); break;
      case 'cp-edit': { const c = (CP.list || []).find(x => x.id === el.dataset.id); if (c) open(c); break; }
      case 'cp-cancel': CP.edit = null; CP.err = ''; break;
      case 'cp-save': save(); break;
      case 'cp-del': remove(el.dataset.id); break;
    }
  }

  root.HalterComp = Object.assign({ init: init, reset: reset, start: start, view: view, onAct: onAct, nextCardHTML: nextCardHTML, moreText: moreText }, { pure: pure });
})(typeof window !== 'undefined' ? window : globalThis);
