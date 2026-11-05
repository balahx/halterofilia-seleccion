/* Pruebas de plan-import.js sin navegador. Uso: node tests/plan-import.js */
const P = require('../plan-import.js');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

console.log('1. Plantilla simple');
const head = P.TEMPLATE_HEAD;
const grid = [head,
  ['Base', 1, 'Lunes', 1, 'Técnica', 'AA', 70, '3', 3, ''],
  ['Base', 1, 'Lunes', 1, 'Técnica', 'AA', 75, '2', 2, ''],          // mismo Orden → otra serie del mismo ejercicio
  ['Base', 1, 'Lunes', 2, 'Fuerza', 'BSQ y FSQ', 80, '5', 4, ''],
  ['Base', 1, 'Miércoles', 1, 'Técnica', 'clean + jerk', 80, '2', 3, ''],
  ['Base', 2, 'Lunes', 1, 'Técnica', 'Ejercicio inventado 20k', 70, '3', 3, ''],
  ['Pico', 1, 2, 1, 'Técnica', 'floatingclean', 90, '1', 5, ''],
  ['Base', '', 'Lunes', 1, '', 'AA', 70, '3', 3, '']];                  // sin semana → aviso
const r = P.parsePlan(grid, []);
ok(r.format === 'plantilla' && r.stages.length === 2 && r.weeks.length === 3, 'detecta la plantilla: 2 etapas, 3 semanas');
const w = r.weeks.find(x => x.id === 'e1_1');
ok(w.sessions[0].items.length === 2 && w.sessions[0].items[0].sets.length === 2, 'filas con el mismo Orden = un ejercicio con 2 esquemas');
ok(w.sessions[0].items[0].sets[1].pct === 75 && w.sessions[0].items[0].sets[1].sets === 2, 'esquema 75% × 2');
ok(r.unknown.length === 2 && r.unknown.some(u => u.src.startsWith('Ejercicio inventado')) && r.unknown.some(u => u.src === 'BSQ y FSQ'), 'lo desconocido queda para nombrar (incluye «BSQ y FSQ», que no está en el glosario como ejercicio)');
ok(r.warnings.some(x => /falta la semana/.test(x)), 'avisa de la fila sin semana');
ok(r.weeks.find(x => x.id === 'e2_1').sessions[0].day === 2, 'el día puede ser un número');

console.log('2. Textos de ejercicios');
const D = P.makeDictionary(), grid2 = [head];
const cells = ['Leg extension12repsRIR2x1s/Leg flexion12repsRIR2x1s', 'les ext/flex', 'Exc gastroc/ flex platar 12x2 / 20x2', '2hang snatch', '(PES) SQ', 'hangsnatch MAX', 'remo barra 60k 12r',
  'plancha 30" 65kk', 'Snatch deadlift  75k  80 85 subi mucho el peso)', 'AA P1°2"  P2°1" jalon', 'jerk / desliz jerk', 'hang cclean', 'floatingclean+2hangrclean', '1.5 Front SQ   80K4r 70k8r'];
cells.forEach((c, i) => grid2.push(['E', 1, 'Lunes', i + 1, '', c, 70, '3', 3, '']));
const r2 = P.parsePlan(grid2, []), it = i => r2.weeks[0].sessions[0].items[i];
const id = (i, a, p) => it(i).alts[a || 0][p || 0].exId;
ok(it(0).alts.length === 2 && id(0, 0) === 'leg-extension' && id(0, 1) === 'leg-curl' && it(0).inline.rir === 2, 'extensión / flexión: 2 alternativas con 12 reps RIR 2');
ok(it(1).alts.length === 1 && id(1) === 'leg-extension-leg-curl', '«les ext/flex» es un solo término del glosario');
ok(it(2).alts.length === 1 && id(2) === 'eccentric-calf-raise-plantar-flexion', 'gemelos: las cargas del final no lo rompen');
ok(id(3) === 'hang-snatch' && it(3).alts[0][0].mult === 2, '«2hang snatch» = 2 × Hang Snatch');
ok(it(4).tag === 'PES' && id(4) === 'squat', '(PES) SQ → etiqueta PES + Squat');
ok(id(5) === 'hang-snatch' && it(5).alts[0][0].max === true, '«hangsnatch MAX» → Hang Snatch marcado como máximo');
ok(id(6) === 'barbell-bent-over-row' && id(7) === '30-second-plank', 'remo con kilos y repeticiones al final; plancha 30" con «65kk» (la carga del final no se guarda)');
ok(id(8) === 'snatch-deadlift', 'texto libre después del número no impide reconocerlo');
ok(id(9).startsWith('snatch-with-2-s-pause-below-knee'), 'AA con pausas P1 y P2 + tirón (término completo del glosario)');
ok(it(10).alts.length === 2 && id(10, 1) === 'jerk-split-slide-drill', '«jerk / desliz jerk» = 2 alternativas');
ok(id(11) === 'hang-clean', '«hang cclean» (error de tipeo) = Hang Clean');
ok(it(12).alts[0].length === 2 && it(12).alts[0][1].mult === 2, 'complejo con «2hangrclean»');
ok(id(13) === 'one-and-a-half-rep-front-squat', '«1.5 Front SQ» con cargas al final');

console.log('3. Prescripciones');
const s = P.parsePresc;
ok(JSON.stringify(s('70% 8-10repsX3')) === '[{"pct":70,"reps":"8-10","sets":3}]', '70% 8-10repsX3');
ok(s('85% 2rX2 90% 1rX2  95% 1rX1').length === 3, 'tres esquemas en una celda');
ok(s('70% 10-12repsX4 80%5-7repx2').length === 2 && s('70% 10-12repsX4 80%5-7repx2')[1].reps === '5-7', 'repx (sin s)');
ok(s('60% 6X2')[0].sets === 2 && s('75%3repsX1 80% 2repsX1')[1].pct === 80, 'formatos cortos');

console.log('4. Nombres que escribe el entrenador');
const rr = P.parsePlan([head, ['E', 1, 'Lunes', 1, '', 'cosa rara', 70, '3', 3, '']], []);
const created = P.applyNames(rr, { 'cosa rara': { en: 'Strange Lift', es: 'Levantamiento raro' } });
ok(created['strange-lift'] && created['strange-lift'].es === 'Levantamiento raro' && rr.weeks[0].sessions[0].items[0].alts[0][0].exId === 'strange-lift', 'applyNames asigna id y catálogo');
const again = P.parsePlan([head, ['E', 1, 'Lunes', 1, '', 'cosa rara', 70, '3', 3, '']], [], [{ id: 'strange-lift', en: 'Strange Lift', es: 'Levantamiento raro', aliases: ['cosa rara'] }]);
ok(again.unknown.length === 0, 'con el catálogo guardado ya no queda nada por nombrar');
let threw = false; try { P.parsePlan([['x']], []); } catch (e) { threw = true; } ok(threw, 'un archivo sin semanas da error claro');

console.log('5. Aclaraciones del entrenador (5-nov)');
const g5 = [head, ['E', 1, 'Lunes', 1, '', 'biceps 30', '', '', '', ''], ['E', 1, 'Lunes', 2, '', 'Biceps barra 24 20k', '', '', '', ''], ['E', 1, 'Lunes', 3, '', 'hangmuscclean+hiperCln63k/drive stif + iso carga 80 90 100 (15")', 90, '1', 3, ''],
  ['E', 1, 'Lunes', 4, '', 'AA balance', 70, '3', 3, ''], ['E', 1, 'Lunes', 5, '', 'plancha 30" 65kk', 70, '', 3, ''], ['E', 2, '', '', '', 'Transición', '', '', '', 'descanso']];
const r5 = P.parsePlan(g5, []), its = r5.weeks[0].sessions[0].items;
ok(its[0].alts[0][0].exId === 'barbell-biceps-curl' && its[0].alts[0][0].hold === 30, '«biceps 30» = curl de bíceps con 30 s de espera isométrica');
ok(its[1].alts[0][0].hold === 24, '«Biceps barra 24 20k»: 24 s (los 20 kg no se guardan)');
const iso = its[2].alts[1][1]; ok(iso.exId === 'overload-isometric-hold' && iso.hold === 15 && its[2].alts[0].length === 2, '«iso carga … (15")» = isométrico con sobrecarga, 15 s; «/» separa variantes');
ok(its[3].alts.length === 1 && its[3].alts[0].length === 1 && its[3].alts[0][0].exId === 'snatch-balance', '«AA balance» es un solo ejercicio');
ok(its[4].alts[0][0].exId === '30-second-plank', 'plancha 30\" = 30 s');
ok(its[2].sets[0].adjustable === true && its[3].sets[0].adjustable !== true, 'desde 90% queda marcado como ajustable por el entrenador');
const pr = P.parsePresc('90% 95% |00 o más ');
ok(pr.length === 3 && pr[2].pct === 100 && pr[2].orMore && pr.every(x => x.adjustable), '«90% 95% |00 o más» → 90, 95 y 100 o más, todos ajustables');
const tw = r5.weeks.find(w => w.week === 2);
ok(tw && tw.kind === 'transition' && tw.sessions.length === 0 && /descarga física y mental/.test(tw.notes[0]) && r5.stats.transicion === 1, 'fila «Transición» = semana de transición, sin sesiones');
console.log(fails ? '\n' + fails + ' fallo(s)' : '\nTodo bien'); process.exit(fails ? 1 : 0);
