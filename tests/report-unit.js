/* Pruebas de las funciones puras del informe del entrenador (report.js). Uso: node tests/report-unit.js */
const R = require('../report.js');
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const it = (src, ex, sets) => ({ block: '', tag: '', raw: src, presc: '', inline: null, sets, alts: [{ p: [{ src, ex, mult: 1, max: false }] }] });
const names = { snatch: { en: 'Snatch', es: 'Arranque' }, 'snatch-pull': { en: 'Snatch Pull', es: 'Tirón de arranque' }, 'back-squat': { en: 'Back Squat', es: 'Sentadilla trasera' } };
const week = { id: 'e1_1', week: 1, stageId: 'e1', kind: '', sessions: [
  { day: 1, name: 'Lunes', items: [it('AA', 'snatch', [{ pct: 70, reps: '3', sets: 2 }, { pct: 92, reps: '1', sets: 1, adjustable: true }]), it('jalon', 'snatch-pull', [{ pct: 100, reps: '3', sets: 2 }])] },
  { day: 3, name: 'Miércoles', items: [it('sentadilla', 'back-squat', [{ pct: 80, reps: '5', sets: 3 }])] },
  { day: 5, name: 'Viernes', items: [it('AA', 'snatch', [{ pct: 75, reps: '2', sets: 3 }])] }] };
const st = (kg, reps, done = true, rpe = null) => ({ kg, reps, pct: 0, rpe, done, doneAt: done ? 1 : null });
const rec = (idx, date, items, notes, extra) => Object.assign({ id: 'r' + idx, date, name: 'S' + idx, startedAt: 1000, endedAt: 1000 + 3600000, notes: notes || '', bw: 80, items, plan: { planId: 'p1', weekId: 'e1_1', idx } }, extra || {});
const sessions = [
  rec(0, '2026-11-02', [{ exId: 'snatch', sets: [st(70, '3'), st(70, '3'), st(95, '1', true, 8)] }, { exId: 'snpull', sets: [st(100, '3'), st(100, '3', false)] }, { exId: 'press', sets: [st(40, '5')] }], 'Dolor leve en el hombro derecho'),
  rec(1, '2026-11-04', [{ exId: 'bsq', sets: [st(100, '5', false), st(100, '5', false), st(100, '5', false)] }], ''),
  { id: 'libre', date: '2026-11-02', name: 'Libre', startedAt: 5000, endedAt: 6000, notes: 'Movilidad', items: [{ exId: 'press', sets: [st(30, '10')] }] }
];
const exNames = { press: { en: 'Press', es: 'Press' } };

console.log('1. Repeticiones y resúmenes');
ok(R.parseReps('3') === 3 && R.parseReps('1+2') === 3 && R.parseReps('') === 0 && R.parseReps('max') === 0, 'parseReps: «3», «1+2», vacío');
const ds = R.doneSummary([st(70, '3'), st(70, '3'), st(95, '1', true, 8), st(50, '3', false)]);
ok(ds.n === 3 && ds.total === 4 && ds.reps === 7 && ds.ton === 70 * 6 + 95 && ds.rpe === 8, 'doneSummary: 3 de 4 series, 7 repeticiones, tonelaje y RPE');
ok(ds.text === '2×(70 kg × 3), 95 kg × 1', 'las series iguales se agrupan: ' + ds.text);

console.log('2. Planificado por ejercicio (ids de la app del atleta)');
const pl = R.plannedByEx(week, 0, names, { s0_i0_k1: 95 });
ok(pl.length === 2 && pl[0].exId === 'snatch' && pl[0].sets.length === 3 && pl[0].sets[2].pct === 95, 'arranque: 3 series, la última ajustada a 95 %');
ok(pl[1].exId === 'snpull' && pl[1].sets.length === 2, 'tirón: 2 series');

console.log('3. Informe de la semana');
const wr = R.weekReport({ athlete: 'Ana Rojas', week, planId: 'p1', stage: 'Preparatorio', names, exNames, sessions, adj: { s0_i0_k1: 95 }, lang: 'en', done: { p1_e1_1_0: 1793900000000 } });
ok(wr.title === 'Semana 1 · Preparatorio', 'título de la semana');
ok(wr.totals.plannedSessions === 3 && wr.totals.doneSessions === 2, 'sesiones: 2 de 3 registradas');
const s0 = wr.sessions[0], s1 = wr.sessions[1], s2 = wr.sessions[2];
ok(s0.items[0].status === 'ok' && s0.items[0].done.n === 3, 'arranque completo (3 de 3)');
ok(s0.items[1].status === 'partial' && s0.items[1].done.n === 1 && s0.items[1].planned.n === 2, 'tirón parcial (1 de 2)');
ok(s0.items[2].status === 'extra' && s0.items[2].name.p === 'Press', 'ejercicio fuera del plan queda como extra, con su nombre');
ok(s1.items[0].status === 'omitted', 'sentadilla con todas las series sin marcar = omitido');
ok(s2.registered === false && s2.items[0].status === 'pending', 'el viernes no se registró: sin registrar');
ok(wr.totals.plannedSets === 5 + 3 + 3 && wr.totals.doneSets === 3 + 1 + 1, 'series planificadas 11 y hechas 5 (incluye el extra)');
ok(wr.notes.length === 1 && /hombro/.test(wr.notes[0].text), 'la observación del atleta pasa al informe');
ok(s0.completedAt === 1793900000000, 'conserva la hora de cumplimiento del servidor');
const txt = R.toText(wr);
ok(/INFORME · Ana Rojas/.test(txt) && /Sesiones: 2 de 3/.test(txt) && /SIN REGISTRAR/.test(txt) && /Observaciones: Dolor leve/.test(txt) && /\[Parcial\]/.test(txt) && /\[Omitido\]/.test(txt), 'el texto resume sesiones, estados y observaciones');
const wes = R.weekReport({ athlete: 'Ana', week, planId: 'p1', stage: '', names, exNames, sessions, adj: {}, lang: 'es', done: {} });
ok(wes.sessions[0].items[0].name.p === 'Arranque' && wes.sessions[0].items[0].name.s === 'Snatch', 'con idioma español el nombre principal es el español');

console.log('4. Semana de transición y semana sin registros');
const tr = R.weekReport({ athlete: 'Ana', week: { id: 'e1_30', week: 30, stageId: 'e1', kind: 'transition', sessions: [] }, planId: 'p1', stage: '', names, exNames, sessions, adj: {}, lang: 'en', done: {} });
ok(tr.transition && /transición/.test(tr.title) && /descanso de halterofilia/.test(R.toText(tr)), 'transición: se informa como descanso');
const empty = R.weekReport({ athlete: 'Ana', week, planId: 'p1', stage: '', names, exNames, sessions: [], adj: {}, lang: 'en', done: {} });
ok(empty.totals.doneSessions === 0 && /SIN REGISTRAR/.test(R.toText(empty)) && !/Sin observaciones/.test(R.toText(empty)), 'sin ningún registro: todo «sin registrar»');

console.log('5. Si una sesión se repitió, cuenta la última');
const again = sessions.concat([rec(0, '2026-11-03', [{ exId: 'snatch', sets: [st(60, '3')] }], 'segunda vez', { id: 'r0b', endedAt: 1000 + 7200000 })]);
ok(R.findRecord(again, 'p1', 'e1_1', 0).notes === 'segunda vez', 'findRecord devuelve la más reciente');

console.log('6. Informe de un día');
const dr = R.dayReport({ athlete: 'Ana', date: '2026-11-02', sessions, names, exNames, weeks: [week], lang: 'en', adjFor: () => ({ s0_i0_k1: 95 }) });
ok(dr.sessions.length === 2 && dr.sessions[0].plan === 'Semana 1 · Lunes', 'dos sesiones ese día; la del plan indica su semana y día');
ok(dr.sessions[1].items[0].status === 'free' && dr.sessions[1].items[0].planned === null, 'la sesión libre no se compara con el plan');
ok(dr.notes.length === 2 && dr.totals.doneSessions === 2, 'observaciones de ambas sesiones');
ok(/Sin sesiones registradas ese día/.test(R.toText(R.dayReport({ athlete: 'Ana', date: '2026-11-09', sessions, names, exNames, weeks: [week], lang: 'en' }))), 'un día sin sesiones lo dice');
ok(R.dateEs('2026-11-02') === 'lunes, 2 de noviembre' || /lunes/.test(R.dateEs('2026-11-02')), 'fecha en español: ' + R.dateEs('2026-11-02'));
console.log(fails ? '\nFALLAS: ' + fails : '\nTodo bien'); process.exit(fails ? 1 : 0);
