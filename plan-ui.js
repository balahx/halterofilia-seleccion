/* Pestaña «Plan anual» del entrenador (fase 3): cargar el Excel del plan, revisar lo que no se reconoció,
   publicarlo en Firestore y elegir cuál plan está activo. Lo conecta cloud.js (sin Cloud Functions).

   Firestore:
     exercises/{exId}                 { en, es, aliases[] }       catálogo de ejercicios; crece con cada importación
     plans/{planId}                   { name, year, format, stages, weeks, createdAt }
     plans/{planId}/stages/{stageId}  { name, order }
     plans/{planId}/weeks/{weekId}    { stageId, week, label, kind, notes[], sessions[], next }   next = id de la semana siguiente ('' en la última)
     config/plan                      { activePlanId, at }        (hasta 4.15) plan activo; desde 4.16.0 no se usa: cada atleta tiene su plan en assignments/{uid}.planId
   Firestore no admite listas dentro de listas: «alts» se guarda como [{ p: [partes] }]. */
(function () {
  'use strict';
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  /* Huella de integridad (SRI): si el archivo en el CDN cambiara un solo byte, el navegador se niega a ejecutarlo. Coincide con la que publica cdnjs. */
  const XLSX_SRI = 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const P = { plans: [], active: null, exercises: [], preview: null, file: '', names: {}, planName: '', busy: '', err: '', confirm: null, plansReady: false };
  let H = null; // { remote(), toast, render }

  /* ---------- Hoja de cálculo (SheetJS, solo se descarga al usarla) ---------- */
  let libPromise = null;
  function loadLib() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!libPromise) libPromise = new Promise((ok, fail) => {
      const s = document.createElement('script'); s.src = XLSX_URL; s.integrity = XLSX_SRI; s.crossOrigin = 'anonymous'; s.async = true;
      s.onload = () => (window.XLSX ? ok(window.XLSX) : fail(new Error('no cargó')));
      s.onerror = () => { libPromise = null; fail(new Error('Sin conexión: no se pudo cargar el lector de Excel')); };
      document.head.appendChild(s);
    });
    return libPromise;
  }
  function sheetToGrid(X, ws) {
    const rg = X.utils.decode_range(ws['!ref'] || 'A1:A1'), grid = [];
    for (let r = 0; r <= rg.e.r; r++) {
      const row = []; for (let c = 0; c <= Math.min(rg.e.c, 14); c++) { const x = ws[X.utils.encode_cell({ r: r, c: c })]; row.push(x ? x.v : null); }
      grid.push(row);
    }
    const merges = (ws['!merges'] || []).map(m => ({ r1: m.s.r, c1: m.s.c, r2: m.e.r, c2: m.e.c }));
    return { grid: grid, merges: merges };
  }

  /* ---------- Importar ---------- */
  const catalogForParser = () => P.exercises.map(x => ({ id: x.id, en: x.en, es: x.es, aliases: x.aliases || [] }));
  async function onFile(file) {
    if (!file) return;
    P.err = ''; P.busy = 'Leyendo el archivo…'; H.render();
    try {
      const X = await loadLib(), buf = await file.arrayBuffer();
      const wb = X.read(buf, { type: 'array', cellDates: false });
      let res = null, lastErr = null;
      for (let i = 0; i < wb.SheetNames.length && !res; i++) {   // primera hoja que tenga un plan
        const ws = wb.Sheets[wb.SheetNames[i]]; if (!ws || !ws['!ref']) continue;
        const g = sheetToGrid(X, ws);
        try { res = window.PlanImport.parsePlan(g.grid, g.merges, catalogForParser()); } catch (e) { lastErr = e; }
      }
      if (!res) throw lastErr || new Error('El archivo no tiene datos');
      P.preview = res; P.file = file.name; P.names = {};
      const yr = (new Date()).getFullYear(); P.planName = 'Plan ' + yr;
    } catch (e) { P.preview = null; P.err = 'No se pudo leer el archivo: ' + (e && e.message ? e.message : e); }
    P.busy = ''; H.render();
  }
  async function downloadTemplate() {
    try {
      const X = await loadLib(), I = window.PlanImport;
      const ex = [['Preparatorio', 1, 'Lunes', 1, 'Técnica arranque', 'AA', 70, '3', 3, ''], ['Preparatorio', 1, 'Lunes', 2, 'Fuerza', 'BSQ', 75, '5', 4, ''],
        ['Preparatorio', 1, 'Miércoles', 1, 'Técnica cargada', 'clean + jerk', 80, '2', 3, 'complejo: se separa con +'], ['Preparatorio', 2, 'Lunes', 1, 'Técnica arranque', 'AA', 72, '3', 3, '']];
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([I.TEMPLATE_HEAD].concat(ex)), 'Plan');
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Cómo se escribe en la planilla', 'Inglés', 'Español']].concat(I.GLOSSARY.map(g => [g[0], g[1], g[2]]))), 'Ejercicios conocidos');
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Instrucciones'], ['Una fila por ejercicio. Los ejercicios que no estén en «Ejercicios conocidos» se pueden usar igual: la app pide su nombre al importar.'],
        ['Etapa: nombre de la etapa. Semana: número. Día: Lunes a Viernes (o 1 a 7). Orden: posición del ejercicio dentro del día.'],
        ['%: porcentaje del máximo de ese mismo ejercicio (arranque o envión). Un ejercicio con varias series distintas usa varias filas con el mismo Orden.']]), 'Instrucciones');
      X.writeFile(wb, 'plantilla-plan-halterofilia.xlsx');
    } catch (e) { H.toast('No se pudo crear la plantilla: ' + (e.message || e)); }
  }

  /* ---------- Publicar ---------- */
  const clean = o => JSON.parse(JSON.stringify(o));
  function weekDoc(w, next) {
    return clean({ stageId: w.stageId, week: w.week, next: next || '', label: w.label || '', kind: w.kind || '', notes: (w.notes || []).slice(0, 12).map(n => String(n).slice(0, 300)),
      sessions: w.sessions.map(s => ({ day: s.day, name: s.name, items: s.items.map(it => ({ block: it.block || '', tag: it.tag || '', raw: String(it.raw).slice(0, 200), presc: it.presc || '',
        sets: it.sets, inline: it.inline || null, alts: it.alts.map(a => ({ p: a.map(p => ({ src: p.src, ex: p.exId, mult: p.mult, max: !!p.max, hold: p.hold, dropPct: p.dropPct })) })) })) })) });
  }
  async function publish() {
    const A = window.HalterAssign, max = (A && A.MAX_PLANS) || 6;
    if (P.plans.length >= max) { P.err = 'Ya hay ' + P.plans.length + ' planes publicados (máximo ' + max + '). Elimina uno que no tenga atletas antes de publicar otro.'; H.render(); return; }
    const I = window.PlanImport, pv = P.preview; if (!pv || P.busy) return;
    const name = (P.planName || '').trim().slice(0, 60); if (!name) { H.toast('Escribe un nombre para el plan'); return; }
    P.busy = 'Publicando…'; P.err = ''; H.render();
    try {
      const created = I.applyNames(pv, P.names), cat = {};
      Object.keys(pv.exercises).forEach(id => { cat[id] = pv.exercises[id]; }); Object.keys(created).forEach(id => { cat[id] = created[id]; });
      const have = {}; P.exercises.forEach(x => { have[x.id] = x; });
      const exDocs = Object.keys(cat).map(id => {
        const e = cat[id], old = have[id], al = {}; (old && old.aliases || []).concat(e.srcs || []).forEach(a => { a = String(a).slice(0, 80); if (a) al[a] = 1; });
        return { id: id, data: { en: old ? old.en : e.en, es: old && old.es ? old.es : (e.es || ''), aliases: Object.keys(al).slice(0, 40) } };
      }).filter(d => !have[d.id] || JSON.stringify(have[d.id].aliases || []) !== JSON.stringify(d.data.aliases) || !have[d.id].es && d.data.es);
      const planId = 'p' + (new Date()).getFullYear() + '-' + Date.now().toString(36);
      await H.remote().publishPlan({ planId: planId, meta: { name: name, year: (new Date()).getFullYear(), format: pv.format, stages: pv.stages.length, weeks: pv.weeks.length },
        stages: pv.stages.map(s => ({ id: s.id, data: { name: String(s.name).slice(0, 160), order: s.order } })), weeks: pv.weeks.map((w, i) => ({ id: w.id, data: weekDoc(w, i + 1 < pv.weeks.length ? pv.weeks[i + 1].id : '') })), exercises: exDocs });
      P.preview = null; P.file = ''; P.names = {};
      H.toast('Plan «' + name + '» publicado. Asígnalo a los atletas desde «Equipo».');
    } catch (e) { P.err = H.err(e); }
    P.busy = ''; H.render();
  }

  /* ---------- Pantalla ---------- */
  function stageSummary(pv) {
    return pv.stages.map(s => { const n = pv.weeks.filter(w => w.stageId === s.id).length; return n ? `<li><b>${esc(s.name)}</b><small>${n} semana${n === 1 ? '' : 's'}</small></li>` : ''; }).join('');
  }
  /* Muestra de la primera semana para comprobar que cada prescripción quedó con su ejercicio */
  function sampleHTML(pv) {
    const w = pv.weeks.filter(x => x.sessions.length)[0]; if (!w) return '';
    const s = w.sessions[0], nm = p => (p.exId && pv.exercises[p.exId] ? pv.exercises[p.exId].en : p.src) + (p.mult > 1 ? ' ×' + p.mult : '') + (p.hold ? ' (' + p.hold + ' s isométrico)' : '') + (p.dropPct ? ' (a ' + p.dropPct + '%)' : '');
    const rows = s.items.slice(0, 8).map(it => {
      const sets = it.sets.length ? it.sets.map(x => x.max ? 'máximo (100% o nuevo 100%)' : (x.pct != null ? x.pct + '% ' : '') + (x.reps ? x.reps + ' × ' + x.sets : '')).join(' · ') : '<i>sin prescripción</i>';
      return `<li><b>${esc(it.alts.map(a => a.map(nm).join(' + ')).join(' / '))}</b><small>${sets}</small></li>`;
    }).join('');
    return `<div class="card sec"><span class="eyebrow">Muestra · semana ${w.week}, ${esc(s.name)}</span><ul class="plain">${rows}</ul>
      <p class="muted">Comprueba que cada ejercicio tenga su % y series. Los % son del máximo del mismo ejercicio (arranque o envión). Desde 90% son una referencia: el entrenador los ajusta a cada atleta.</p></div>`;
  }
  function previewHTML() {
    const pv = P.preview, st = pv.stats;
    let h = `<div class="card sec"><span class="eyebrow">Revisión · ${esc(P.file)}</span>
      <p class="muted">Formato leído: <b>${pv.format === 'plantilla' ? 'plantilla simple' : 'planilla de Cristian'}</b>. ${st.etapas} etapa${st.etapas === 1 ? '' : 's'}, ${st.semanas} semanas, ${st.sesiones} sesiones, ${st.items} ejercicios, ${st.ejercicios} distintos reconocidos.${st.transicion ? ' Semanas de transición (descanso de halterofilia): ' + pv.weeks.filter(w => w.kind === 'transition').map(w => w.week).join(', ') + '.' : ''}</p>
      <ul class="plain">${stageSummary(pv)}</ul></div>`;
    h += sampleHTML(pv);
    if (pv.unknown.length) {
      h += `<div class="card sec"><span class="eyebrow">No reconocidos (${pv.unknown.length})</span>
      <p class="muted">Escribe el nombre en inglés y, si quieres, en español. Si lo dejas vacío se guarda tal como está escrito. La próxima vez que importes un plan, la app ya los reconoce.</p>`;
      h += pv.unknown.map((u, i) => `<div class="unk"><b>${esc(u.src)}</b><small>${u.count} vez${u.count === 1 ? '' : 'es'} · ${esc(u.where)}</small>
        <input class="txt" data-plname="${i}" data-k="en" placeholder="Inglés" maxlength="100" value="${esc((P.names[u.src] || {}).en || '')}" aria-label="Nombre en inglés de ${esc(u.src)}">
        <input class="txt" data-plname="${i}" data-k="es" placeholder="Español (opcional)" maxlength="120" value="${esc((P.names[u.src] || {}).es || '')}" aria-label="Nombre en español de ${esc(u.src)}"></div>`).join('');
      h += '</div>';
    }
    if (pv.warnings.length) h += `<div class="card sec"><details><summary class="eyebrow">Avisos (${pv.warnings.length})</summary><ul class="plain">${pv.warnings.slice(0, 60).map(w => `<li>${esc(w)}</li>`).join('')}</ul></details></div>`;
    h += `<div class="card sec"><label class="lab" for="plName">Nombre del plan</label><input class="txt" id="plName" data-pl="name" maxlength="60" value="${esc(P.planName)}">
      <div class="stack"><button class="btn" data-act="pl-publish"${P.busy ? ' disabled' : ''}>${P.busy || 'Publicar plan'}</button><button class="btn ghost" data-act="pl-cancel">Descartar</button></div></div>`;
    return h;
  }
  function view() {
    let h = '<h1>Planes anuales</h1>';
    if (P.err) h += window.HalterApp.errorBox(P.err, { title: 'No se pudo completar' });
    h += '<div class="card sec"><span class="eyebrow">Planes publicados</span>';
    if (!P.plansReady) h += '<p class="muted">Cargando…</p>';
    else if (!P.plans.length) h += window.HalterApp.empty('plan', 'Aún no hay un plan', 'Sube el Excel de Cristian o la plantilla simple.');
    else h += P.plans.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(p => {
      const users = usage(p.id), n = users.length;
      return `<div class="person"><div><b>${esc(p.name)}</b><small>${p.weeks || 0} semana${p.weeks === 1 ? '' : 's'} · ${p.stages || 0} etapa${p.stages === 1 ? '' : 's'} · ${n ? n + (n === 1 ? ' atleta' : ' atletas') : 'sin atletas'}</small>` +
        (P.blocked === p.id ? `<small class="err-txt">No se puede eliminar: lo tiene${n === 1 ? '' : 'n'} asignado ${esc(users.join(', '))}. ${n === 1 ? 'Muévelo' : 'Muévelos'} a otro plan desde «Equipo».</small>` : '') +
        `</div><div class="row-end"><button class="btn ghost sm" data-act="pl-delete" data-id="${esc(p.id)}">${P.confirm === 'del' + p.id ? 'Confirmar' : 'Eliminar'}</button></div></div>`;
    }).join('');
    h += '</div>';
    if (P.preview) return h + previewHTML();
    h += `<div class="card sec"><span class="eyebrow">Cargar un plan</span>
      <p class="muted">Sube el Excel: la planilla de Cristian o la plantilla simple. Verás una revisión antes de publicar. Puedes tener hasta 6 planes (por ejemplo, uno por nivel); nada cambia para un atleta hasta que le asignes el plan en «Equipo».</p>
      <label class="btn block" for="plFile" role="button">${P.busy || 'Elegir archivo Excel'}</label>
      <input id="plFile" data-pl="file" type="file" accept=".xlsx,.xlsm,.xls" hidden>
      <div class="stack"><button class="lnk" data-act="pl-template">Descargar plantilla simple (con la lista de ejercicios conocidos)</button></div></div>`;
    return h;
  }

  /* Atletas (y el entrenador) con una semana de este plan */
  const usage = id => { const A = window.HalterAssign; return A && A.planUsage ? A.planUsage(id) : []; };
  /* El catálogo se versiona con el plan publicado más reciente */
  const ms = t => (t && typeof t.toMillis === 'function' ? t.toMillis() : +t || 0);
  const newest = () => { const l = P.plans.slice().sort((a, b) => ms(b.createdAt) - ms(a.createdAt)); return l.length ? l[0].id : null; };
  function onAct(act, el) {
    const id = el && el.dataset ? el.dataset.id : null, prev = P.confirm; P.confirm = null; P.blocked = null;
    switch (act) {
      case 'pl-publish': publish(); return true;
      case 'pl-cancel': P.preview = null; P.file = ''; P.names = {}; H.render(); return true;
      case 'pl-template': downloadTemplate(); return true;
      case 'pl-delete':
        if (usage(id).length) { P.blocked = id; H.render(); return true; }   // un plan con atletas no se elimina (4.16.0)
        if (prev !== 'del' + id) { P.confirm = 'del' + id; H.render(); return true; }
        H.remote().deletePlan(id, P.active === id).then(() => H.toast('Plan eliminado'), e => { P.err = H.err(e); H.render(); }); return true;
    }
    return false;
  }

  function init(helpers) {
    H = helpers;
    document.addEventListener('change', e => { const t = e.target; if (t && t.dataset && t.dataset.pl === 'file') { const f = t.files && t.files[0]; t.value = ''; onFile(f); } });
    document.addEventListener('input', e => {
      const t = e.target; if (!t || !t.dataset) return;
      if (t.dataset.pl === 'name') P.planName = t.value;
      if (t.dataset.plname != null && P.preview) { const u = P.preview.unknown[+t.dataset.plname]; if (u) { const n = P.names[u.src] = P.names[u.src] || {}; n[t.dataset.k] = t.value; } }
    });
  }
  window.HalterPlan = {
    init: init, view: view, onAct: onAct, state: P,
    setPlans(list) { P.plans = list; P.plansReady = true; },
    setActive(d) { P.active = d ? d.activePlanId : null; },
    newest: () => newest(),
    setExercises(list) { P.exercises = list; },
    reset() { P.plans = []; P.active = null; P.exercises = []; P.preview = null; P.plansReady = false; P.err = ''; P.busy = ''; }
  };
})();
