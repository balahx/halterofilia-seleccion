/* Indicadores del atleta (js/logic.js, sin navegador): series falladas, categoría, carga, efectividad, razones y metas.
   Uso: node tests/indicators-unit.js */
const fs = require('fs'), path = require('path');
(async () => {
// js/logic.js es un módulo ES sin dependencias: se carga como data URL (sin importar la extensión ni el package.json)
const A = await import('data:text/javascript;base64,' + fs.readFileSync(path.join(__dirname, '..', 'js', 'logic.js')).toString('base64'));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const set = (kg, reps, o) => Object.assign({ kg, reps: String(reps), pct: 0, rpe: null, done: true, doneAt: 0 }, o || {});
const T = (h, m) => new Date(2026, 10, 2, h, m).getTime();

console.log('1. Series falladas');
ok(A.setTon(set(100, 2)) === 200 && A.setTon(set(100, 2, { miss: true })) === 0, 'una fallada no suma tonelaje');
ok(A.setE1rm(set(100, 3, { miss: true })) === 0 && A.setE1rm(set(100, 3)) > 100, 'una fallada no cuenta para el 1RM estimado');
const s1 = { items: [{ exId: 'snatch', sets: [set(90, 1), set(95, 1, { miss: true }), set(95, 1, { done: false })] }] };
const st = A.sessionStats(s1);
ok(st.sets === 1 && st.missed === 1 && st.pending === 1 && st.ton === 90, 'sessionStats: 1 válida, 1 fallada, 1 pendiente');
ok(A.topSingle([{ endedAt: 1, items: [{ exId: 'snatch', sets: [set(90, 1), set(100, 1, { miss: true })] }] }], 'snatch') === 90, 'una fallada no es récord');

console.log('2. Categorías de peso');
ok(A.categoryOf('M', 80) === '85' && A.categoryOf('M', 85) === '85' && A.categoryOf('M', 85.1) === '95' && A.categoryOf('M', 60) === '60' && A.categoryOf('M', 70) === '70' && A.categoryOf('M', 130) === '+110', 'masculino: límites y categoría abierta');
ok(A.categoryOf('F', 48) === '49' && A.categoryOf('F', 57) === '57' && A.categoryOf('F', 57.1) === '61' && A.categoryOf('F', 62) === '69' && A.categoryOf('F', 90) === '+86', 'femenino');
ok(JSON.stringify(A.catOptions('M')) === JSON.stringify(['60','65','70','75','85','95','110','+110']) && JSON.stringify(A.catOptions('F')) === JSON.stringify(['49','53','57','61','69','77','86','+86']), 'categorías IWF vigentes desde el 1-ago-2026');
ok(A.categoryOf('', 70) === '' && A.categoryOf('M', 0) === '', 'sin sexo o sin peso: sin categoría');
ok(A.categoryOf('F', 62, '77') === '77' && A.categoryOf('F', 62, '88') === '69' && A.categoryOf('F', 62, '63') === '69', 'categoría elegida a mano solo si es válida para el sexo');
ok(A.catText('75') === '−75 kg' && A.catText('+110') === '+110 kg' && A.catSortKey('+86') > A.catSortKey('77'), 'texto y orden');

console.log('3. Carga de sesión');
const s2 = { startedAt: T(18, 0), endedAt: T(20, 0), items: [{ sets: [set(60, 3, { doneAt: T(18, 50), rpe: 7 }), set(60, 3, { doneAt: T(19, 30), rpe: 8 })] }] };
ok(A.sessionDurMin(s2) === 90, 'duración: hasta la última serie (90 min, no 120)');
ok(A.sessionRpe(s2) === 7.5 && A.sessionLoad(s2) === 675, 'RPE promedio 7,5 × 90 min = 675 UA');
ok(A.sessionLoad(Object.assign({}, s2, { srpe: 7, durMin: 90 })) === 630, 'los valores anotados a mano mandan (90 × 7 = 630)');
ok(A.sessionLoad({ startedAt: T(18, 0), items: [{ sets: [set(60, 3, { doneAt: T(18, 30) })] }] }) === 0, 'sin RPE no hay carga');

console.log('4. Período: intensidad, repeticiones y cumplimiento');
const s3 = { date: '2026-11-02', endedAt: 1, startedAt: T(18, 0), srpe: 7, items: [{ exId: 'snatch', p: 4, sets: [set(60, 3, { pct: 70, doneAt: T(18, 30) }), set(80, 1, { pct: 90 }), set(85, 1, { pct: 95 })] }, { exId: 'bsq', p: 3, sets: [set(100, 5, { pct: 80 })] }], skip: [{ exId: 'press', p: 2 }] };
const p = A.periodStats([s3], '2026-11-02', '2026-11-03');
ok(p.n === 1 && p.reps === 10 && p.sets === 4, 'repeticiones válidas (3 + 1 + 1 + 5)');
ok(Math.abs(p.intAvg - (70 * 3 + 90 + 95 + 80 * 5) / 10) < 1e-9, 'intensidad media ponderada por repeticiones');
ok(p.planSets === 9 && p.planDone === 4 && Math.abs(p.cump - 44.444) < 0.01, 'cumplimiento: 4 series hechas de 9 planificadas (incluye el ejercicio omitido)');
ok(A.periodStats([s3], '2026-11-03', '2026-11-09').n === 0, 'fuera del período no cuenta');
const sOld = { date: '2026-11-02', endedAt: 1, startedAt: T(18, 0), items: [{ exId: 'snatch', sets: [set(60, 3)] }] };
ok(A.periodStats([sOld], '2026-11-02', '2026-11-03').cump === null, 'una sesión sin series planificadas (libre o anterior a la 4.3) no entra al cumplimiento');
const sOver = { date: '2026-11-02', endedAt: 1, items: [{ exId: 'snatch', p: 2, sets: [set(60, 3), set(60, 3), set(60, 3)] }] };
ok(A.periodStats([sOver], '2026-11-02', '2026-11-03').cump === 100, 'hacer más series de las planificadas no pasa de 100 %');
const sMiss = { date: '2026-11-02', endedAt: 1, items: [{ exId: 'snatch', p: 2, sets: [set(60, 3), set(60, 3, { miss: true })] }] };
ok(A.periodStats([sMiss], '2026-11-02', '2026-11-03').cump === 50, 'una serie «fallada» de versiones anteriores no cuenta como hecha');
const cmp = A.complianceByExercise([s3], '', id => ({ cat: id === 'snatch' ? 'comp' : 'acc' }));
ok(cmp.length === 3 && cmp[0].exId === 'snatch' && cmp[0].plan === 4 && cmp[0].done === 3, 'cumplimiento por ejercicio: competencia primero (3 de 4)');
ok(cmp.some(x => x.exId === 'press' && x.plan === 2 && x.done === 0), 'el ejercicio omitido aparece con 0 de 2');

console.log('5. Razones y metas');
const mx = { snatch: 80, cj: 100, bsq: 130, fsq: 0 };
const rt = A.ratiosOf(id => mx[id] || 0);
ok(rt.length === 2 && rt[0].pct === 80 && rt[1].pct === 130, 'razones solo con ambos máximos');
const t0 = new Date(2026, 10, 2);
let g = A.goalInfo(80, 90, '2026-12-14', 1, t0);
ok(g.left === 10 && g.weeks === 10 && Math.abs(g.need - 10 / 6) < 1e-9, 'meta: faltan 10 kg, 10 semanas al ritmo actual, 1,67 kg/sem para la fecha');
ok(A.goalInfo(95, 90, '', 1, t0).done === true, 'meta lograda');
ok(A.goalInfo(80, 90, '', 0, t0).weeks === null, 'sin tendencia, no se inventa un plazo');
ok(A.goalInfo(0, 90, '', 1, t0) === null, 'sin máximo no hay meta que medir');
// ---- 4.20.0: resumen semanal, muro de marcas, fichas y mini-tendencias
{
  const mk = (id, date, at, sets, extra) => Object.assign({ id: id, date: date, startedAt: at - 3600e3, endedAt: at, items: [{ exId: 'snatch', sets: sets.map(([kg, reps]) => ({ kg: kg, reps: String(reps), done: true })) }] }, extra || {});
  const T = d => new Date(d + 'T12:00:00').getTime();
  const ss = [
    mk('a', '2026-11-02', T('2026-11-02'), [[60, 3], [65, 1]]),            // base: no es marca
    mk('b', '2026-11-04', T('2026-11-04'), [[70, 1]]),                      // marca a 1 rep (65 → 70)
    mk('c', '2026-11-06', T('2026-11-06'), [[66, 3]]),                      // 1RM estimado ≈ 71,9 > 70 + 0,4 → marca
    mk('d', '2026-11-10', T('2026-11-10'), [[69, 1], [60, 3]], { rpe: 7 }), // nada nuevo
    mk('e', '2026-11-11', T('2026-11-11'), [[72, 1]])                       // marca a 1 rep
  ];
  const rec = A.recordsTimeline(ss, () => true);
  ok(rec.length === 3 && rec[0].sessId === 'e' && rec[0].kind === 'single' && rec[0].before === 70, 'muro: 3 marcas, la más reciente primero, con lo de antes');
  ok(rec[1].kind === 'e1rm' && rec[1].set.kg === 66 && rec[2].sessId === 'b', 'muro: marca de 1RM estimado con su serie; la primera sesión es la base');
  ok(A.recordsTimeline(ss, id => id !== 'snatch').length === 0, 'muro: solo ejercicios con kilos');
  const now = new Date('2026-11-11T18:00:00');   // miércoles
  const w = A.weekSummary(ss, now, { done: 2, total: 4 });
  ok(w.cur.n === 2 && w.prev.n === 2 && w.metric === 'kg', 'semana a esta altura (lun–mié) frente a la anterior (lun–mié); sin RPE en ambas → tonelaje');
  ok(Math.round(w.ch) === Math.round(((69 + 180 + 72) - (180 + 65 + 70)) / (180 + 65 + 70) * 100) && w.plan.total === 4, 'cambio en % y sesiones del plan');
  ok(A.weekSummary(ss, new Date('2026-11-18T10:00:00'), null).cur.n === 0, 'semana sin entrenar');
  const last = A.lastSessionsOf(ss, 'snatch', 2);
  ok(last.length === 2 && last[0].id === 'e' && last[1].best.kg === 69 && last[1].sets === 2, 'últimas sesiones: mejor serie y series hechas');
  ok(A.bestSetOf(ss, 'snatch', '2026-11-05').kg === 72, 'mejor serie desde una fecha');
  ok(A.sparkPoints([1], 100, 20) === '' && A.sparkPoints([70, 75], 100, 20) === '2.0,18.0 98.0,2.0', 'mini-tendencia: puntos');
  ok(A.trendText([70, 74], 6) === 'sube 4 kg en 6 semanas' && A.trendText([70, 70.2], 3) === 'estable en 3 semanas' && A.trendText([75, 70], 1) === 'baja 5 kg en 1 semana', 'mini-tendencia: frase');
}
console.log(fails ? 'HAY FALLAS' : 'Todo bien'); process.exit(fails ? 1 : 0);
})();
