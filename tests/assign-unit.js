/* Pruebas de las funciones puras de la fase 4 (assign.js): hora de corte en Chile, armado de la sesión, avance.
   Uso: node tests/assign-unit.js */
const A = require('../assign.js'), P = require('../plan-import.js');
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const iso = ms => new Date(ms).toISOString();

console.log('1. Corte semanal: viernes 23:59 hora de Chile');
// Chile en verano (UTC-3) hasta el 4-abr-2026 y en invierno (UTC-4) hasta el 5-sep-2026
let c = A.cutoffFor(Date.parse('2026-03-30T15:00:00Z'));          // lunes
ok(iso(c) === '2026-04-04T02:59:00.000Z', 'lunes 30-mar → viernes 3-abr 23:59 (UTC-3) = ' + iso(c));
c = A.cutoffFor(Date.parse('2026-04-10T02:00:00Z'));              // jueves 9-abr 22:00 hora de Chile
ok(iso(c) === '2026-04-11T03:59:00.000Z', 'jueves 9-abr → viernes 10-abr 23:59 (UTC-4) = ' + iso(c));
c = A.cutoffFor(Date.parse('2026-04-11T03:00:00Z'));              // viernes 10-abr 23:00 Chile: aún es hoy
ok(iso(c) === '2026-04-11T03:59:00.000Z', 'viernes 23:00 → ese mismo viernes 23:59');
c = A.cutoffFor(Date.parse('2026-04-11T04:30:00Z'));              // viernes 00:30 UTC sábado = 00:30 sábado Chile (pasó el corte)
ok(iso(c) === '2026-04-18T03:59:00.000Z', 'sábado 00:30 → viernes siguiente');
c = A.cutoffFor(Date.parse('2026-11-05T19:00:00Z'));              // jueves 5-nov-2026, hoy
ok(iso(c) === '2026-11-07T02:59:00.000Z', 'jueves 5-nov → viernes 6-nov 23:59 (UTC-3) = ' + iso(c));
// la semana siguiente del corte
let prev = Date.parse('2026-04-04T02:59:00Z'), nx = A.nextCutoff(prev), d = nx - prev;
ok(iso(nx) === '2026-04-11T03:59:00.000Z', 'siguiente corte tras el 3-abr: ' + iso(nx));
ok(d >= 604800000 - 7200000 && d <= 604800000 + 7200000, 'diferencia dentro de ±2 h de 7 días (cambio de horario): ' + d / 3600000 + ' h');
prev = Date.parse('2026-09-05T03:59:00Z'); nx = A.nextCutoff(prev); d = nx - prev;      // viernes 4-sep (UTC-4) → 11-sep (UTC-3)
ok(Math.abs(d - 604800000) <= 7200000, 'cambio de horario de septiembre también dentro de la tolerancia: ' + d / 3600000 + ' h');
const ch = A.chile(A.cutoffFor(Date.parse('2026-06-17T12:00:00Z')));
ok(ch.wd === 4 && ch.h === 23 && ch.mi === 59, 'el corte siempre cae viernes 23:59 hora de Chile');
for (let t = Date.parse('2026-01-01T00:00:00Z'); t < Date.parse('2027-01-01T00:00:00Z'); t += 37 * 3600000) {
  const x = A.chile(A.cutoffFor(t)); if (!(x.wd === 4 && x.h === 23 && x.mi === 59) || A.cutoffFor(t) < t) { ok(false, 'corte inválido para ' + iso(t)); break; }
}
ok(true, 'revisado un año entero cada 37 h: siempre viernes 23:59 y nunca en el pasado');

console.log('2. Ejercicios del catálogo con id propio en la app');
const slugs = new Set(P.GLOSSARY.map(g => P.slug(g[1].replace(/\s*\(.*\)\s*$/, ''))));
Object.keys(A.LOCAL).forEach(k => ok(slugs.has(k), 'existe en el glosario: ' + k + ' → ' + A.LOCAL[k]));

console.log('3. Series y ajuste desde 90 %');
const item = { alts: [{ p: [{ src: 'AA', ex: 'snatch' }] }], sets: [{ pct: 70, reps: '3', sets: 3 }, { pct: 92, reps: '1', sets: 2, adjustable: true }, { pct: 100, reps: '', sets: null, max: true, adjustable: true }] };
let sets = A.expandSets(item, {}, 0, 2);
ok(sets.length === 6 && sets[0].pct === 70 && sets[3].pct === 92 && sets[5].max, 'se expande a 3 + 2 + 1 series');
sets = A.expandSets(item, { [A.adjKey(0, 2, 1)]: 95.5 }, 0, 2);
ok(sets[3].pct === 95.5 && sets[3].adjusted && sets[3].basePct === 92, 'el ajuste reemplaza el % de esa prescripción');
sets = A.expandSets(item, { [A.adjKey(0, 2, 0)]: 80 }, 0, 2);
ok(sets[0].pct === 70, 'bajo 90 % no se ajusta aunque venga un valor');

console.log('4. Sesión armada');
const S = { profile: { rounding: 1, rest: 120, bw: 80 }, exercises: [{ id: 'snatch', name: 'Arranque', max: 100, rest: 120 }, { id: 'snpull', name: 'Tirón', max: 0, rest: 90 }] };
const week = { sessions: [{ day: 1, name: 'Lunes', items: [
  { block: 'Técnica arranque', alts: [{ p: [{ src: 'AA', ex: 'snatch' }] }], sets: [{ pct: 70, reps: '3', sets: 2 }, { pct: 92, reps: '1', sets: 1, adjustable: true }] },
  { block: 'Fuerza', alts: [{ p: [{ src: 'jalon AA', ex: 'snatch-pull' }] }], sets: [{ pct: 100, reps: '3', sets: 2 }] },
  { block: 'Fuerza', alts: [{ p: [{ src: 'tall snatch', ex: 'tall-snatch' }, { src: 'Drop AA', ex: 'drop-snatch' }] }], sets: [{ pct: 50, reps: '2', sets: 2 }] },
  { block: 'Otro', alts: [{ p: [{ src: 'Core', ex: 'core-training' }] }], sets: [] }] }] };
const ses = A.buildSession(S, week, 0, { planId: 'p1', weekId: 'e1_3', names: { 'tall-snatch': { en: 'Tall Snatch', es: 'Arranque erguido' } }, adj: { [A.adjKey(0, 0, 1)]: 94 } });
ok(ses.plan.planId === 'p1' && ses.plan.weekId === 'e1_3' && ses.plan.idx === 0 && ses.name === 'Lunes', 'la sesión recuerda el plan, la semana y la posición');
const sn = ses.items.find(i => i.exId === 'snatch');
ok(sn.sets.length === 3 && sn.sets[0].kg === 70 && sn.sets[2].kg === 94 && sn.sets[2].pct === 94, 'kg = máximo × % (con el % ajustado de la tercera serie)');
const pull = ses.items.find(i => i.exId === 'snpull');
ok(pull.sets.length === 2 && pull.sets[0].kg === 0, 'sin máximo propio los kg quedan en 0 para que los anote');
const cx = ses.items.find(i => i.exId.startsWith('cx-'));
ok(cx && cx.sets.length === 2, 'un complejo se arma como un ejercicio con sus series');
ok(S.exercises.some(e => e.id === 'cx-tall-snatch+drop-snatch' && e.name === 'Arranque erguido + drop-snatch' || (e.id.startsWith('cx-') && e.cat === 'cmplx')), 'el complejo se crea como ejercicio de la app');
ok(S.exercises.some(e => e.id === 'core-training') && ses.items.find(i => i.exId === 'core-training').sets.length === 1, 'un ejercicio sin prescripción queda con una serie vacía');
ok(S.exercises.filter(e => e.id === 'snatch').length === 1, 'no duplica ejercicios que ya existen');

console.log('5. Pasar a la semana siguiente');
const asg = { weekEndsAt: Date.parse('2026-11-07T02:59:00Z') }, wk = { next: 'e1_4', kind: '', sessions: [{ name: 'Lunes' }, { name: 'Viernes' }] };
let st = A.advanceState(asg, wk, { 0: true }, asg.weekEndsAt + 1000);
ok(!st.ok && /última sesión/.test(st.why), 'sin la última sesión cumplida no se habilita');
st = A.advanceState(asg, wk, { 1: true }, asg.weekEndsAt - 60000);
ok(!st.ok && /Se habilita/.test(st.why), 'antes del corte no se habilita');
st = A.advanceState(asg, wk, { 1: true }, asg.weekEndsAt);
ok(st.ok, 'con la última sesión cumplida y pasado el corte, sí');
st = A.advanceState(asg, { next: '', sessions: [] }, {}, asg.weekEndsAt + 1);
ok(!st.ok && /última semana/.test(st.why), 'la última semana del plan no avanza');
st = A.advanceState(asg, { next: 'x', kind: 'transition', sessions: [{}, {}] }, {}, asg.weekEndsAt + 1);
ok(st.ok, 'una semana de transición no exige sesiones cumplidas');

console.log(fails ? '\nFALLAS: ' + fails : '\nTodo bien');
process.exit(fails ? 1 : 0);
