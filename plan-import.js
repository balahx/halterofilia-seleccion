/* Lectura del plan anual desde Excel (fase 3).
   Dos formatos:
     1. «planilla de Cristian»: bloques por semana, días en columnas D a H, la prescripción (p. ej. «70% 8-10repsX3»)
        va en la celda de arriba del ejercicio al que se aplica.
     2. «plantilla simple»: una fila por ejercicio (se descarga desde la app). Es la forma recomendada para los
        planes de los años siguientes.
   Este archivo no usa Firebase ni el navegador: se puede probar con Node (tests/plan-import.js).

   Resultado de parsePlan():
     { format, stages:[{id,name,order}],
       weeks:[{id,stageId,week,label,notes[],sessions:[{day,name,items:[{block,tag,raw,alts:[[{src,exId,mult,max}]],sets:[{pct,reps,sets}],presc}]}]}],
       exercises:{ exId:{en,es,flag,known,srcs[]} }, unknown:[{src,count,where}], warnings:[...], stats:{...} } */
(function (root) {
  'use strict';

  /* ---------- Glosario base (Glosario_Halterofilia_Felipe_2026) ---------- */
  // «término de la planilla» | inglés | español.  Varios términos para el mismo ejercicio se separan con « / ».
  const GLOSSARY = [
    ['AA', 'Snatch', 'Arranque'],
    ['Final AA', 'Parallel-Thigh Snatch Balance (descriptive)', 'Final de arranque quinta'],
    ['Hiper AA', 'Deficit Snatch', 'Arranque sobre altura'],
    ['AA cad', 'Hip Snatch (to confirm)', 'Arranque desde cadera (confirmar)'],
    ['AA fuerza', 'Power Snatch', 'Arranque de fuerza'],
    ['AA fuerza Cadera', 'Hip Power Snatch', 'Arranque de fuerza desde cadera'],
    ['AA fuerza hang', 'Hang Power Snatch', 'Arranque de fuerza desde suspensión'],
    ['AA balance / snatchbalance / balance', 'Snatch Balance', 'Balance de arranque'],
    ['heaving AA balance', 'Heaving Snatch Balance', 'Balance de arranque con impulso'],
    ['AASQ / overhead SQ / overhead', 'Overhead Squat', 'Sentadilla de arranque'],
    ['Drop AA', 'Drop Snatch', 'Arranque por deslizamiento'],
    ['Tall snatch', 'Tall Snatch', 'Arranque desde posición erguida'],
    ['Hang snatch', 'Hang Snatch', 'Arranque desde suspensión'],
    ['hangsnatch bajo rod', 'Below-Knee Hang Snatch', 'Arranque desde suspensión bajo rodilla'],
    ['hanghighpull', 'Hang High Pull', 'Tirón alto desde suspensión'],
    ['snatch press', 'Snatch-Grip Press', 'Press con agarre de arranque'],
    ['snatch PUSH press', 'Snatch-Grip Push Press', 'Push press con agarre de arranque'],
    ['snatch PUSH parado', 'Standing Snatch-Grip Push Press', 'Push press de arranque de pie'],
    ['snatch speed pull', 'Snatch Speed Pull', 'Tirón de arranque veloz'],
    ['jalon arranque / jalon AA / jalon de arranque / jalon de AA', 'Snatch Pull', 'Tirón de arranque'],
    ['Snatch DL / Snatch deadlift', 'Snatch Deadlift', 'Peso muerto de arranque'],
    ['AA P1°2" P2°1" jalon', 'Snatch with 2-s Pause Below Knee and 1-s Pause Above Knee + Snatch Pull', 'Arranque con pausas P1 y P2 + tirón'],
    ['AA P2° jalon', 'Snatch with Above-Knee Pause + Snatch Pull', 'Arranque con pausa sobre rodilla + tirón'],
    ['clean', 'Clean', 'Cargada'],
    ['hang clean / hang cclean', 'Hang Clean', 'Cargada desde suspensión'],
    ['hang clean bajo rod', 'Below-Knee Hang Clean', 'Cargada suspendida bajo rodilla'],
    ['hangmuscleclean / hangmuscclean', 'Hang Muscle Clean', 'Cargada muscular desde suspensión'],
    ['cleanfrompowerpostiion', 'Clean from Power Position', 'Cargada desde posición de potencia'],
    ['floatingclean', 'Floating Clean', 'Cargada flotante'],
    ['Cleanwithnojump', 'No-Jump Clean', 'Cargada sin salto'],
    ['hiperClean / hiperCln', 'Deficit Clean (to confirm)', 'Cargada sobre altura (confirmar)'],
    ['3 position clean', 'Three-Position Clean', 'Cargada desde tres posiciones'],
    ['2 position clean', 'Two-Position Clean', 'Cargada desde dos posiciones'],
    ['clean Deadlift / clean dl', 'Clean Deadlift', 'Peso muerto de cargada'],
    ['Clean long pull', 'Clean Long Pull', 'Tirón largo de cargada'],
    ['Clean pull pause bajo rod', 'Clean Pull with Pause Below Knee', 'Tirón de cargada con pausa bajo rodilla'],
    ['hanghighpullbajorod', 'Below-Knee Hang High Pull', 'Tirón alto desde suspensión bajo rodilla'],
    ['hang pull clean', 'Hang Clean Pull', 'Tirón de cargada suspendido'],
    ['clean speed pull', 'Clean Speed Pull', 'Tirón de cargada veloz'],
    ['drop / DR', 'Drop Set', 'Serie descendente (drop)'],
    ['MOVILIDAD Y MASAJES', 'Mobility and Massage', 'Movilidad y masajes'],
    ['iso carga', 'Overload Isometric Hold', 'Isométrico con sobrecarga (sobre 100%)'],
    ['jalon envion / jalon de envion', 'Clean Pull', 'Tirón de cargada'],
    ['jerk', 'Split Jerk (if split reception)', 'Segundo tiempo en tijera'],
    ['push press', 'Push Press', 'Press de impulso'],
    ['pushjerk', 'Push Jerk', 'Segundo tiempo de potencia'],
    ['power jerk', 'Power Jerk', 'Segundo tiempo de potencia'],
    ['pause push press', 'Paused Push Press', 'Press de impulso con pausa'],
    ['Jerk drive', 'Jerk Drive and Immediate Rack Re-Catch (descriptive)', 'Empuje desde posición escapular y recepción inmediata'],
    ['jerk drive sitfness / drive stif / jerk drive stif', 'Short Explosive Jerk Drive and Re-Catch (descriptive)', 'Variante corta y explosiva (rigidez tendinosa)'],
    ['Split Jerk behind the neck', 'Behind-the-Neck Split Jerk', 'Segundo tiempo en tijera detrás del cuello'],
    ['jerk behind the neck / jerkbehindneckFROM SPLIT / jerkbehindtheneckFROM SPLIT', 'Behind-the-Neck Jerk', 'Segundo tiempo detrás del cuello'],
    ['droptosplit', 'Drop to Split', 'Deslizamiento a tijera'],
    ['jerk balance', 'Jerk Balance', 'Balance de segundo tiempo'],
    ['desliz jerk', 'Jerk Split Slide Drill (descriptive)', 'Deslizamiento de segundo tiempo'],
    ['C&J / clean&jerk', 'Clean and Jerk', 'Envión completo'],
    ['SQ', 'Squat', 'Sentadilla'],
    ['BSQ / B SQ', 'Back Squat', 'Sentadilla trasera'],
    ['FSQ / Front SQ / frontSQ', 'Front Squat', 'Sentadilla frontal'],
    ['1.5 Front SQ', 'One-and-a-Half Rep Front Squat', 'Sentadilla frontal de repetición y media'],
    ['RDL', 'Romanian Deadlift', 'Peso muerto rumano'],
    ['pressmilitnolegs', 'Strict Military Press', 'Press militar sin piernas'],
    ['pull up', 'Pull-Up', 'Dominadas'],
    ['remo barra', 'Barbell Bent-Over Row', 'Remo inclinado con barra'],
    ['superior push', 'Upper-Body Push Exercises', 'Empuje de tren superior'],
    ['Leg extension', 'Leg Extension', 'Extensión de rodilla'],
    ['Leg flexion', 'Leg Curl', 'Flexión de rodilla'],
    ['estension dorsal', 'Back Extension', 'Extensión dorsal'],
    ['dorsal banco romano', 'Roman Chair Back Extension', 'Extensión de tronco en banco romano'],
    ['press frances barra parado', 'Standing Barbell Triceps Extension', 'Extensión de tríceps de pie'],
    ['apertura mancuerna', 'Dumbbell Fly', 'Aperturas con mancuernas'],
    ['biceps barra / biceps', 'Barbell Biceps Curl', 'Curl con barra'],
    ['Biceps barra Z', 'EZ-Bar Biceps Curl', 'Curl con barra Z'],
    ['lu xiao raises', 'Lu Xiaojun Raises', 'Elevaciones Lu Xiaojun'],
    ['plancha 30"', '30-Second Plank', 'Plancha de 30 segundos'],
    ['plancha peso 30"', '30-Second Weighted Plank', 'Plancha lastrada de 30 segundos'],
    ['Core', 'Core Training', 'Trabajo de zona media'],
    ['Exc gastroc/ flex platar', 'Eccentric Calf Raise / Plantar Flexion', 'Gemelos excéntricos y flexión plantar'],
    ['les ext/flex', 'Leg Extension / Leg Curl', 'Extensión y flexión de rodilla']
  ];

  /* ---------- Utilidades ---------- */
  const norm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/cclean/g, 'clean').replace(/floeating/g, 'floating').replace(/hangrclean/g, 'hang clean').replace(/[^a-z0-9&]/g, '');
  const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x';
  const FLAG = /\s*\((to confirm|descriptive|if [^)]*)\)\s*/i;
  const FLAG_ES = /\s*\((confirmar|según contexto)\)\s*/i;
  function cleanEntry(en, es) {
    const flag = FLAG.test(en) ? (en.match(FLAG)[1].toLowerCase().indexOf('confirm') >= 0 ? 'confirmar' : 'descriptivo') : '';
    return { en: en.replace(FLAG, '').trim(), es: es.replace(FLAG_ES, '').trim(), flag: flag };
  }

  /* Diccionario: texto normalizado → { exId, en, es, flag, known } */
  function makeDictionary(extra) {
    const D = {};
    GLOSSARY.forEach(g => {
      const e = cleanEntry(g[1], g[2]); e.exId = slug(e.en); e.known = true;
      g[0].split(' / ').forEach(t => { D[norm(t)] = e; });
    });
    // Nombres que el entrenador ya completó en importaciones anteriores: [{id,en,es,aliases[]}]
    (extra || []).forEach(x => {
      const e = { exId: x.id, en: x.en, es: x.es || '', flag: '', known: true };
      [x.en, x.es].concat(x.aliases || []).forEach(t => { if (t) D[norm(t)] = e; });
    });
    return D;
  }

  /* ---------- Un texto de ejercicio → partes ---------- */
  const NUMTAIL = /\s+(?:[\d(\/][^\s]*|[oO])$/;
  function candidates(t, simple) {
    const out = [], seen = {}, add = x => { x = x.trim(); if (x && !seen[x]) { seen[x] = 1; out.push(x); } };
    add(t);
    let u = t.trim();
    for (let i = 0; i < 6 && NUMTAIL.test(u); i++) { u = u.replace(NUMTAIL, ''); add(u); }          // quita cargas y repeticiones del final
    if (simple) return out;
    const cut = t.trim().match(/^(.*?\S)[\s(]+[\d(].*$/); if (cut) add(cut[1]);                      // corta en el primer número suelto
    const glued = t.trim().match(/^(.*?[A-Za-z"])(\d+[\d.,]*\s*(?:reps?|r|k|kg|x).*)$/i); if (glued && glued[1].length > 2) add(glued[1]); // «extension12reps…»
    return out;
  }
  /* Segundos de espera isométrica: «iso carga (15")» y, en los curl de bíceps, un número suelto («biceps 30» = 30 s) */
  const HOLD_BARE = { 'barbell-biceps-curl': 1, 'ez-bar-biceps-curl': 1 };
  function holdOf(entry, t, cand) {
    const tail = t.indexOf(cand) === 0 ? t.slice(cand.length) : '';
    const q = tail.match(/(\d+)\s*(?:"|”|″|'')/); if (q) return +q[1];
    if (HOLD_BARE[entry.exId]) { const b = tail.match(/^\s*(\d+)(?=\s|$)/); if (b) return +b[1]; }
    return undefined;
  }
  /* «drop 46K 65%»: serie descendente al 65% del máximo del mismo ejercicio (normalmente la última serie) */
  function dropPctOf(src) { const m = String(src).match(/(\d+(?:[.,]\d+)?)\s*%/); return m ? parseFloat(m[1].replace(',', '.')) : undefined; }
  function resolvePart(src, D, simple) {
    let t = src.trim(), max = false, mult = 1;
    if (/\s+MAX$/i.test(t)) { max = true; t = t.replace(/\s+MAX$/i, ''); }
    for (let k = 0; k < 2; k++) {
      const cs = candidates(t, simple);
      for (let i = 0; i < cs.length; i++) { const e = D[norm(cs[i])]; if (e) return { src: src.trim(), entry: e, mult: mult, max: max, hold: holdOf(e, t, cs[i]), dropPct: e.exId === 'drop-set' ? dropPctOf(src) : undefined }; }
      const m = t.match(/^(\d)\s*(.+)$/); if (!m) break;                                              // «2hang clean» = 2 × hang clean
      mult = +m[1]; t = m[2];
    }
    return { src: src.trim(), entry: null, mult: 1, max: max };
  }
  const INLINE = /(\d+)\s*reps?\s*RIR\s*(\d+)\s*x\s*(\d+)\s*s/i; // «Leg extension12repsRIR2x1s»

  function resolveCell(text, D) {
    let t = String(text).replace(/\s+/g, ' ').replace(/\s+apenas\b.*$/i, '').trim(), tag = '';   // «apenas power jerk»: comentario personal del entrenador, se descarta
    const mt = t.match(/^\((PES|MOD)\)\s*/i); if (mt) { tag = mt[1].toUpperCase(); t = t.slice(mt[0].length); }
    // 1. la celda completa (cubre «les ext/flex», «Exc gastroc/ flex platar» y los complejos del glosario)
    // (con «/» solo vale si la celda completa, sin cargas al final, es un término del glosario)
    if (!/\+/.test(t)) { const whole = resolvePart(t, D, /\//.test(t)); if (whole.entry) return { tag: tag, alts: [[whole]] }; }
    // 2. alternativas con «/» y complejos con «+»
    const alts = t.split(/\s*\/\s*/).map(a => a.split(/\s*\+\s*/).filter(Boolean).map(p => resolvePart(p, D)));
    const inl = t.match(INLINE);
    return { tag: tag, alts: alts, inline: inl ? { reps: inl[1], rir: +inl[2], sets: +inl[3] } : null };
  }

  /* ---------- Prescripción ---------- */
  const PRESC = /^(?:max|mac)$|^\(?\s*(max\s*\d+k\)?\s*)?\d+(\.\d+)?(\s*-\s*\d+|\s+\d+)*\s*%|^\(\d+k\s*max\)|^\d+\s*[xX]\s*\d|^\(\d+%/i;
  const SEG = /(\d+(?:[.,]\d+)?)\s*%\s*(\d+(?:\s*-\s*\d+)?)\s*(?:reps?|r)?\s*[xX]\s*(\d+)/gi;
  const isPresc = t => PRESC.test(t.trim());
  function parsePresc(t) {
    const out = []; let m; SEG.lastIndex = 0;
    if (/^(max|mac)$/i.test(t.trim())) return [{ pct: 100, reps: '', sets: null, max: true, adjustable: true }];   // «max»: el máximo, 100 % o un nuevo 100 %
    while ((m = SEG.exec(t))) out.push({ pct: parseFloat(m[1].replace(',', '.')), reps: m[2].replace(/\s/g, ''), sets: +m[3] });
    if (!out.length) {                                   // «90% 95% 100 o más»: solo porcentajes, sin repeticiones ni series
      const re = /(\d+(?:[.,]\d+)?)\s*%/g; while ((m = re.exec(t))) out.push({ pct: parseFloat(m[1].replace(',', '.')), reps: '', sets: null });
      if (out.length && /[|1l]00\s*o\s*m[aá]s/i.test(t)) out.push({ pct: 100, reps: '', sets: null, orMore: true });
    }
    out.forEach(o => { if (o.pct >= 90) o.adjustable = true; });   // desde 90% el entrenador lo ajusta según el avance de cada atleta
    return out;
  }

  /* ---------- Planilla de Cristian ---------- */
  const TRANSITION_NOTE = 'Semana de transición: actividad física y ejercicio libre para la descarga física y mental. Descanso de halterofilia.';
  const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
  const BLOCKS = [[/^tecaa/, 'Técnica arranque'], [/^tecclean/, 'Técnica cargada'], [/^tecjer/, 'Técnica segundo tiempo'], [/^fuerzasq/, 'Fuerza sentadilla-press'],
    [/^fuerzapull/, 'Fuerza tracción'], [/^fortalec/, 'Fortalecimiento']];
  function blockOf(label) { const n = norm(label); for (let i = 0; i < BLOCKS.length; i++) if (BLOCKS[i][0].test(n)) return BLOCKS[i][1]; return null; }
  const text = v => (typeof v === 'string' ? v.trim() : (typeof v === 'number' ? String(v) : ''));

  /* grid: matriz [fila][columna] (0 = A). merges: [{r1,c1,r2,c2}] */
  function parseCristian(grid, merges, D) {
    const R = grid.length, B = r => text((grid[r] || [])[1]), Cc = r => text((grid[r] || [])[2]), cell = (r, c) => text((grid[r] || [])[c]);
    const mergedAt = {}; (merges || []).forEach(m => { mergedAt[m.r1] = m; });
    const warnings = [], stages = [], weekRows = [], stageRows = [];
    let stage = null;
    for (let r = 0; r < R; r++) {
      const b = B(r), m = mergedAt[r];
      if (b && m && m.c1 <= 1 && m.c2 >= 7 && !/^semana/i.test(b)) { stage = { id: 'e' + (stages.length + 1), name: b.replace(/\s+/g, ' '), order: stages.length + 1 }; stages.push(stage); stageRows.push(r); }
      if (/^semana\s*\d+/i.test(b)) weekRows.push({ r: r, label: b, stage: stage, text: !!(m && m.c2 >= 7) });
    }
    const hdr = []; for (let r = 0; r < R; r++) if (/^(caracteris|max (rend|deriv))/i.test(B(r))) hdr.push(r);
    if (!weekRows.length) throw new Error('No se encontraron semanas («semana 1», «semana 2»…) en la columna B');
    if (!stages.length) { stage = { id: 'e1', name: 'Plan', order: 1 }; stages.push(stage); weekRows.forEach(w => { w.stage = stage; }); }
    // Filas de recuperación («MOVILIDAD Y MASAJES» en todos los días) que están justo encima de una semana de texto: son de esa semana
    const rowText = (r, c) => cell(r, c), claimed = {};
    weekRows.forEach((w, i) => {
      if (!w.text || !i) return; let r = w.r - 1; while (r > 0 && rowHas(r)) r--;
      for (; r > weekRows[i - 1].r; r--) {
        const vals = []; for (let c = 3; c <= 7; c++) if (rowText(r, c)) vals.push(norm(rowText(r, c)));
        if (B(r) || Cc(r) || vals.length < 3 || vals.some(v => v !== vals[0]) || isPresc(rowText(r, 3) || rowText(r, 4) || rowText(r, 5))) break;
        (w.rec = w.rec || []).unshift(r); weekRows[i - 1].trim = r - 1;
      }
    });
    function rowHas(r) { for (let c = 1; c <= 7; c++) if (cell(r, c)) return false; return true; }
    const weeks = [], used = {}, unknownMap = {}, exercises = {}; let nItems = 0, nDiscard = 0, nNoPresc = 0;
    weekRows.forEach((w, i) => {
      const r0 = w.r, nxt = i + 1 < weekRows.length ? weekRows[i + 1].r : R + 1;
      const stops = hdr.filter(h => h > r0 && h < nxt).concat(stageRows.filter(x => x > r0 && x < nxt), [nxt]);
      let end = Math.min.apply(null, stops) - 1; if (w.trim != null) end = Math.min(end, w.trim);
      const mm = w.label.match(/^semana\s*(\d+)\s*(.*)$/i), num = +mm[1];
      let label = mm[2].replace(/\s+/g, ' ').trim();
      const notes = [];
      for (let r = r0 + 1; r <= end; r++) { const b = B(r); if (b && !/^(equipo|caracteris|max (rend|deriv))/i.test(b)) notes.push(b.replace(/\s+/g, ' ')); }
      const wk = { id: w.stage.id + '_' + num, stageId: w.stage.id, week: num, label: label, notes: notes, sessions: [] };
      if (w.text) {
        wk.notes.unshift(w.label.replace(/\s+/g, ' ')); wk.label = '';
        if (/transici/i.test(w.label)) { wk.kind = 'transition'; wk.label = 'Transición'; wk.notes.unshift(TRANSITION_NOTE); }
        (w.rec || []).forEach(r => {
          for (let c = 3; c <= 7; c++) {
            const t = cell(r, c); if (!t) continue;
            const rc = resolveCell(t, D), ses = wk.sessions.filter(x => x.day === c - 2)[0] || (wk.sessions.push({ day: c - 2, name: DAY_NAMES[c - 3], items: [] }), wk.sessions[wk.sessions.length - 1]);
            ses.items.push({ block: null, tag: '', raw: t, alts: rc.alts.map(a => a.map(p => ({ src: p.src, exId: p.entry ? p.entry.exId : null, mult: p.mult, max: p.max, hold: p.hold, dropPct: p.dropPct }))), sets: [], presc: '' });
            rc.alts.forEach(a => a.forEach(p => collect(p, num, c, r))); nItems++;
          }
        });
        weeks.push(wk); return;
      }
      if (used[wk.id]) { warnings.push('La semana ' + num + ' aparece dos veces en «' + w.stage.name + '». Se conserva la primera.'); return; }
      used[wk.id] = 1;
      for (let c = 3; c <= 7; c++) {
        const items = []; let cur = null, block = null;
        for (let r = r0 + 1; r <= end; r++) {
          const t = cell(r, c); if (!t) continue;
          if (isPresc(t)) { cur = { raw: t, sets: parsePresc(t) }; if (!cur.sets.length) warnings.push('Semana ' + num + ' ' + DAY_NAMES[c - 3] + ' (fila ' + (r + 1) + '): no se pudo interpretar «' + t + '»'); continue; }
          block = blockOf(Cc(r)) || blockOf(Cc(r - 1)) || block;
          const rc = resolveCell(t, D);
          const it = { block: block, tag: rc.tag, raw: t, alts: rc.alts.map(a => a.map(p => ({ src: p.src, exId: p.entry ? p.entry.exId : null, mult: p.mult, max: p.max, hold: p.hold, dropPct: p.dropPct }))), sets: cur ? cur.sets : [], presc: cur ? cur.raw : '' };
          if (rc.inline) it.inline = rc.inline;
          if (!cur) { nNoPresc++; warnings.push('Semana ' + num + ' ' + DAY_NAMES[c - 3] + ' (fila ' + (r + 1) + '): «' + t + '» no tiene series ni % arriba'); }
          rc.alts.forEach(a => a.forEach(p => collect(p, num, c, r)));
          items.push(it); nItems++;
        }
        if (items.length) wk.sessions.push({ day: c - 2, name: DAY_NAMES[c - 3], items: items });
      }
      weeks.push(wk);
    });
    function collect(p, num, c, r) {
      if (p.entry) { const e = exercises[p.entry.exId] || (exercises[p.entry.exId] = { en: p.entry.en, es: p.entry.es, flag: p.entry.flag, known: true, srcs: [] }); if (e.srcs.indexOf(p.src) < 0 && e.srcs.length < 20) e.srcs.push(p.src); return; }
      const k = p.src; (unknownMap[k] = unknownMap[k] || { src: k, count: 0, where: 'semana ' + num + ' ' + DAY_NAMES[c - 3] + ', fila ' + (r + 1) }).count++;
    }
    return { format: 'cristian', stages: stages, weeks: weeks, exercises: exercises, unknown: Object.keys(unknownMap).map(k => unknownMap[k]).sort((a, b) => b.count - a.count),
      warnings: warnings, stats: { items: nItems, sinPrescripcion: nNoPresc } };
  }

  /* ---------- Plantilla simple ---------- */
  const TEMPLATE_HEAD = ['Etapa', 'Semana', 'Día', 'Orden', 'Bloque', 'Ejercicio', '%', 'Repeticiones', 'Series', 'Nota'];
  const DAYMAP = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };
  function findHeader(grid) {
    for (let r = 0; r < Math.min(grid.length, 15); r++) {
      const row = (grid[r] || []).map(x => norm(text(x)));
      if (row.indexOf('ejercicio') >= 0 && row.indexOf('semana') >= 0) return { r: r, col: n => row.indexOf(norm(n)) };
    }
    return null;
  }
  function parseTemplate(grid, D, h) {
    const warnings = [], stagesByName = {}, stages = [], weeksById = {}, weeks = [], exercises = {}, unknownMap = {};
    const col = {}; TEMPLATE_HEAD.forEach(n => { col[n] = h.col(n); });
    if (col['Día'] < 0) col['Día'] = h.col('Dia');
    let nItems = 0;
    for (let r = h.r + 1; r < grid.length; r++) {
      const g = c => (c < 0 ? '' : text((grid[r] || [])[c]));
      const ex = g(col['Ejercicio']); if (!ex) continue;
      const stName = g(col['Etapa']) || 'Plan', num = parseInt(g(col['Semana']), 10), day = DAYMAP[norm(g(col['Día']))];
      if (num && norm(ex) === 'transicion') {   // fila «Transición»: semana de descanso de halterofilia, sin ejercicios
        let st0 = stagesByName[stName]; if (!st0) { st0 = stagesByName[stName] = { id: 'e' + (stages.length + 1), name: stName, order: stages.length + 1 }; stages.push(st0); }
        const wid0 = st0.id + '_' + num;
        if (!weeksById[wid0]) { weeksById[wid0] = { id: wid0, stageId: st0.id, week: num, label: 'Transición', kind: 'transition', notes: [TRANSITION_NOTE, g(col['Nota'])].filter(Boolean), sessions: [] }; weeks.push(weeksById[wid0]); }
        continue;
      }
      if (!num || !day) { warnings.push('Fila ' + (r + 1) + ': falta la semana o el día («' + ex + '»)'); continue; }
      let st = stagesByName[stName]; if (!st) { st = stagesByName[stName] = { id: 'e' + (stages.length + 1), name: stName, order: stages.length + 1 }; stages.push(st); }
      const wid = st.id + '_' + num; let wk = weeksById[wid];
      if (!wk) { wk = weeksById[wid] = { id: wid, stageId: st.id, week: num, label: '', notes: [], sessions: [] }; weeks.push(wk); }
      let ses = wk.sessions.filter(s => s.day === day)[0]; if (!ses) { ses = { day: day, name: DAY_NAMES[day - 1] || 'Día ' + day, items: [] }; wk.sessions.push(ses); }
      const order = g(col['Orden']), pct = parseFloat(g(col['%']).replace(',', '.')), sets = parseInt(g(col['Series']), 10), reps = g(col['Repeticiones']).replace(/\s/g, '');
      const scheme = (isNaN(pct) && !reps && isNaN(sets)) ? null : { pct: isNaN(pct) ? null : pct, reps: reps, sets: isNaN(sets) ? 1 : sets };
      if (scheme && scheme.pct >= 90) scheme.adjustable = true;
      let it = order ? ses.items.filter(i => i.order === order)[0] : null;
      if (it) { if (scheme) it.sets.push(scheme); continue; }
      const rc = resolveCell(ex, D);
      it = { block: g(col['Bloque']) || null, tag: rc.tag, raw: ex, order: order || null, alts: rc.alts.map(a => a.map(p => ({ src: p.src, exId: p.entry ? p.entry.exId : null, mult: p.mult, max: p.max, hold: p.hold, dropPct: p.dropPct }))), sets: scheme ? [scheme] : [], presc: '' };
      if (rc.inline) it.inline = rc.inline;
      if (!scheme) warnings.push('Fila ' + (r + 1) + ': «' + ex + '» sin %, repeticiones ni series');
      rc.alts.forEach(a => a.forEach(p => {
        if (p.entry) { const e = exercises[p.entry.exId] || (exercises[p.entry.exId] = { en: p.entry.en, es: p.entry.es, flag: p.entry.flag, known: true, srcs: [] }); if (e.srcs.indexOf(p.src) < 0 && e.srcs.length < 20) e.srcs.push(p.src); }
        else (unknownMap[p.src] = unknownMap[p.src] || { src: p.src, count: 0, where: 'fila ' + (r + 1) }).count++;
      }));
      ses.items.push(it); nItems++;
    }
    weeks.forEach(w => w.sessions.sort((a, b) => a.day - b.day));
    weeks.sort((a, b) => a.stageId.localeCompare(b.stageId, 'es', { numeric: true }) || a.week - b.week);
    return { format: 'plantilla', stages: stages, weeks: weeks, exercises: exercises, unknown: Object.keys(unknownMap).map(k => unknownMap[k]).sort((a, b) => b.count - a.count), warnings: warnings, stats: { items: nItems, sinPrescripcion: 0 } };
  }

  /* ---------- Entrada principal ---------- */
  function parsePlan(grid, merges, extraCatalog) {
    const D = makeDictionary(extraCatalog), h = findHeader(grid);
    const res = h ? parseTemplate(grid, D, h) : parseCristian(grid, merges, D);
    if (!res.weeks.length) throw new Error('El archivo no tiene semanas con ejercicios');
    res.stats.semanas = res.weeks.length; res.stats.sesiones = res.weeks.reduce((n, w) => n + w.sessions.length, 0);
    res.stats.transicion = res.weeks.filter(w => w.kind === 'transition').length; res.stats.etapas = res.stages.length; res.stats.ejercicios = Object.keys(res.exercises).length;
    return res;
  }

  /* Aplica los nombres que escribió el entrenador para lo no reconocido: names = { texto: {en, es} }.
     Lo que quede sin nombre se guarda con el texto original como nombre en inglés. */
  function applyNames(plan, names) {
    const created = {};
    plan.weeks.forEach(w => w.sessions.forEach(s => s.items.forEach(it => it.alts.forEach(a => a.forEach(p => {
      if (p.exId) return;
      const n = (names && names[p.src]) || {}, en = ((n.en || '').trim() || p.src).slice(0, 120), es = (n.es || '').trim().slice(0, 160);   // límites de las reglas de Firestore
      p.exId = slug(en); created[p.exId] = created[p.exId] || { en: en, es: es, flag: '', known: false, srcs: [] };
      if (created[p.exId].srcs.indexOf(p.src) < 0) created[p.exId].srcs.push(p.src);
    })))));
    return created;
  }

  const api = { GLOSSARY: GLOSSARY, TEMPLATE_HEAD: TEMPLATE_HEAD, parsePlan: parsePlan, applyNames: applyNames, makeDictionary: makeDictionary, slug: slug, norm: norm, parsePresc: parsePresc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PlanImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
