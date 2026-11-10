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

console.log('6. Drop, max, movilidad y masajes (5-nov, 2.ª tanda)');
const g6 = [head, ['E', 1, 'Lunes', 1, '', 'AA fuerza + drop 46K 65%', 80, '3', 3, ''], ['E', 1, 'Lunes', 2, '', 'AA fuerza + drop', 80, '3', 3, ''], ['E', 1, 'Lunes', 3, '', 'drop O 65%', 80, '3', 3, ''],
  ['E', 1, 'Lunes', 4, '', 'Jerk drive +2power jerk apenas power jerk', 70, '2', 3, '']];
const i6 = P.parsePlan(g6, []).weeks[0].sessions[0].items;
ok(i6[0].alts[0][1].exId === 'drop-set' && i6[0].alts[0][1].dropPct === 65, '«drop 46K 65%» = serie descendente al 65% (los 46 kg no se guardan)');
ok(i6[1].alts[0][1].exId === 'drop-set' && i6[1].alts[0][1].dropPct === undefined, '«drop» sin % queda como serie descendente sin porcentaje');
ok(i6[2].alts[0][0].exId === 'drop-set' && i6[2].alts[0][0].dropPct === 65, '«drop O 65%» → drop al 65%');
ok(i6[3].alts[0].length === 2 && i6[3].alts[0][1].exId === 'power-jerk' && i6[3].alts[0][1].mult === 2, 'el comentario personal «apenas power jerk» se elimina');
ok(JSON.stringify(P.parsePresc('max')) === '[{"pct":100,"reps":"","sets":null,"max":true,"adjustable":true}]' && P.parsePresc('mac')[0].max === true, '«max» y «mac» = máximo (100% o nuevo 100%)');
// planilla de Cristian en miniatura: «max» arriba del ejercicio y filas de movilidad encima de la semana de transición
const cg = []; const put = (r, c, v) => { while (cg.length <= r) cg.push(new Array(8).fill(null)); cg[r][c] = v; };
put(1, 1, 'Etapa A'); put(3, 1, 'caracteris meso'); put(4, 1, 'semana 1'); put(4, 3, 'lunes'); put(5, 1, 'EQUIPO'); put(5, 3, '70% 3X3'); put(6, 2, 'TEC AA'); put(6, 3, 'AA');
put(7, 3, 'max'); put(7, 4, 'max'); put(7, 5, 'max'); put(8, 3, 'SQ'); put(8, 4, 'FSQ'); put(8, 5, 'pull up');
[3, 4, 5, 6, 7].forEach(c => put(9, c, 'MOVILIDAD Y MASAJES '));
put(11, 1, 'semana 2 de agosto transicion, descanso');
const c6 = P.parsePlan(cg, [{ r1: 1, c1: 1, r2: 1, c2: 7 }, { r1: 11, c1: 1, r2: 11, c2: 7 }]);
const sq = c6.weeks[0].sessions[0].items[1];
ok(sq.alts[0][0].exId === 'squat' && sq.sets[0].max === true, '«max» arriba de «SQ» = máximo en sentadilla');
ok(c6.weeks[0].sessions[0].items.length === 2, 'las filas de movilidad ya no quedan en la semana anterior');
const tw6 = c6.weeks[1];
ok(tw6.kind === 'transition' && tw6.sessions.length === 5 && tw6.sessions[0].items[0].alts[0][0].exId === 'mobility-and-massage', 'esas filas pasan a la semana de transición: movilidad y masajes de lunes a viernes');
// ---------- 4.17.0: lector corregido ----------
const st = a => a.map(x => (x.opt ? 'o' : '') + x.pct + '/' + x.reps + '/' + x.sets).join(' ');
ok(st(P.parsePresc('60% 4 repsX2100 105 110%x2 1 1 x1')) === '60/4/2 100/2/1 105/1/1 110/1/1', '«X2100 105…»: 2 series y luego la lista de % (antes 2100 series)');
ok(st(P.parsePresc('85% 4repsX170% 8repsX1')) === '85/4/1 70/8/1', '«X170%»: 1 serie y luego 70 % (antes 170 series)');
ok(st(P.parsePresc('70% 2 repsX23')) === '70/2/2', '«X23»: 2 series (antes 23)');
ok(st(P.parsePresc('80%3-4-repx4 85% 2-3repsX270% 8repsX1')) === '80/3-4/4 85/2-3/2 70/8/1', '«3-4-rep» y «X270%»');
ok(st(P.parsePresc('80 85 90%1X1 OPCIONAL')) === '80/1/1 85/1/1 90/1/1', '«80 85 90%1X1» = tres % de 1 × 1');
ok(st(P.parsePresc('(65% 3X2) 70% 2 repsX2')) === 'o65/3/2 70/2/2', '«(65% 3X2)» entre paréntesis = opcional');
ok(st(P.parsePresc('(70% 3X3)')) === '70/3/3', 'si todo está entre paréntesis no queda opcional');
ok(st(P.parsePresc('70% 8-10repsX3')) === '70/8-10/3' && st(P.parsePresc('70% 3X10')) === '70/3/10', 'lo de siempre no cambia (incluidas 10 series)');
const jb = { raw: 'jerk balance+jerk / desliz jerk', presc: '(65% 3X2) 70% 2 repsX2 /100 105 110%x2 1 1 x1', alts: [{ p: [{ ex: 'jerk-balance' }, { ex: 'jerk' }] }, { p: [{ ex: 'split-jerk' }] }], sets: [] };
const two = P.reparseItem(jb);
ok(two.length === 2 && two[0].alts.length === 1 && two[1].alts[0].p[0].ex === 'split-jerk', '«A / B» con prescripción «X / Y» = dos ejercicios, ambos se hacen');
ok(st(two[0].sets) === 'o65/3/2 70/2/2' && st(two[1].sets) === '100/2/1 105/1/1 110/1/1' && two[1].raw === 'desliz jerk', 'cada uno con su parte de la prescripción');
const glued = P.reparseItem({ raw: 'droptosplit+jerk/ desliz jerk', presc: '60% 4 repsX2100 105 110%x2 1 1 x1', alts: [{ p: [{ ex: 'a' }] }, { p: [{ ex: 'b' }] }], sets: [] });
ok(glued.length === 2 && st(glued[0].sets) === '60/4/2' && st(glued[1].sets) === '100/2/1 105/1/1 110/1/1', 'sin «/» pero con la lista pegada y dos ejercicios: se separan igual');
ok(P.reparseItem({ raw: 'jerk / power jerk', presc: '70% 3X3', alts: [{ p: [] }, { p: [] }], sets: [] }).length === 1, 'sin «/» en la prescripción, «A / B» siguen siendo variantes');
ok(P.reparseItem({ raw: 'x', presc: '', alts: [], sets: [{ pct: 70, reps: '3', sets: 3 }] })[0].sets[0].pct === 70, 'sin texto de prescripción (plantilla simple) no se toca');
const wk = { id: 'e1_28', stageId: 'e1', week: 28, sessions: [{ day: 4, name: 'Jueves', items: [
  { raw: 'AA', presc: '85%2x1 90%2rx1 95%1x1', alts: [{ p: [{ ex: 'snatch' }] }], sets: [{ reps: '2', pct: 85, sets: 1 }, { sets: 1, pct: 90, reps: '2', adjustable: true }, { pct: 95, reps: '1', sets: 1, adjustable: true }] },
  Object.assign({}, jb, { sets: [{ pct: 65, reps: '3', sets: 2 }, { pct: 70, reps: '2', sets: 2 }] }),
  { raw: 'clean speed pull', presc: '85%2x1 90%2rx1 95%1x1', alts: [{ p: [{ ex: 'csp' }] }], sets: [{ pct: 85, reps: '2', sets: 1 }, { pct: 90, reps: '2', sets: 1, adjustable: true }, { pct: 95, reps: '1', sets: 1, adjustable: true }] }] }] };
const rw = P.reparseWeek(wk);
ok(rw.changed && rw.data.sessions[0].items.length === 4 && !('id' in rw.data), 'la semana publicada se corrige: 3 → 4 ejercicios');
ok(!P.reparseWeek({ id: 'x', sessions: [{ items: [wk.sessions[0].items[0]] }] }).changed, 'una semana sin errores no cambia (el orden de las claves no importa)');
ok(!P.reparseWeek(Object.assign({ id: 'e1_28' }, rw.data)).changed, 'volver a corregir una semana ya corregida no cambia nada');
const adj = P.remapAdj({ s0_i0_k2: 97, s0_i2_k1: 92, s0_i2_k2: 93, f_jerk: 125 }, rw.map);
ok(adj.s0_i0_k2 === 97 && adj.s0_i3_k1 === 92 && adj.s0_i3_k2 === 93 && adj.f_jerk === 125 && !('s0_i2_k1' in adj), 'los ajustes de % siguen a su ejercicio aunque baje una posición');

console.log(fails ? '\n' + fails + ' fallo(s)' : '\nTodo bien'); process.exit(fails ? 1 : 0);
