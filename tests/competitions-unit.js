/* Competencias (parte pura, sin navegador). Uso: node tests/competitions-unit.js */
const P = require('../competitions.js');
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('Fechas');
ok(P.ymdOk('2026-11-28') && !P.ymdOk('2026-13-01') && !P.ymdOk('28-11-2026') && !P.ymdOk(''), 'fecha AAAA-MM-DD válida');
ok(P.daysUntil('2026-11-28', '2026-11-06') === 22, 'faltan 22 días');
ok(P.daysUntil('2026-11-06', '2026-11-06') === 0 && P.daysUntil('2026-11-07', '2026-11-06') === 1 && P.daysUntil('2026-11-05', '2026-11-06') === -1, 'hoy, mañana y ayer');
ok(P.daysUntil('2026-04-06', '2026-04-04') === 2 && P.daysUntil('2026-09-08', '2026-09-05') === 3, 'el cambio de hora no altera los días (se cuenta por fecha de calendario)');
ok(P.countdownText(0) === 'Hoy' && P.countdownText(1) === 'Mañana' && P.countdownText(22) === '22', 'texto de la cuenta regresiva');

console.log('Resultados');
ok(eq(P.cleanResult({ sn: '100', cj: '125,5', cat: ' −85 ', place: '2' }), { sn: 100, cj: 125.5, total: 225.5, cat: '−85', place: 2 }), 'total = arranque + dos tiempos; la coma decimal se entiende');
ok(eq(P.cleanResult({ sn: '100', cj: '' }), { sn: 100, cj: 0, total: 0 }), 'sin dos tiempos no hay total (nulo)');
ok(P.cleanResult({}) === null && P.cleanResult({ sn: 'abc', cj: '-5' }) === null, 'vacío o inválido → no se guarda');

console.log('Documento');
const d = P.cleanDoc({ name: '  Nacional  ', date: '2026-11-28', place: ' Santiago ', note: '', athletes: ['a', 'a', 'b', ''], results: { a: { sn: 90, cj: 110 }, b: {}, z: { sn: 50 } } });
ok(d.name === 'Nacional' && d.place === 'Santiago' && !('note' in d), 'recorta espacios y omite lo vacío');
ok(eq(d.athletes, ['a', 'b']), 'sin inscritos repetidos');
ok(eq(Object.keys(d.results), ['a']) && d.results.a.total === 200, 'resultados solo de inscritos y sin filas vacías');
ok(P.validate({ name: '', date: '2026-11-28' }) !== '' && P.validate({ name: 'x', date: '' }) !== '' && P.validate({ name: 'x', date: '2026-11-28' }) === '', 'valida nombre y fecha');

console.log('Listas');
const L = [{ id: '1', name: 'B', date: '2026-12-10', athletes: ['a'] }, { id: '2', name: 'A', date: '2026-11-20', athletes: ['b'] }, { id: '3', name: 'C', date: '2026-10-01', athletes: ['a'], results: { a: { sn: 90, cj: 110, total: 200 } } }, { id: '4', name: 'D', date: '2026-11-06', athletes: ['a'] }, { id: '5', name: 'E', date: 'mal' }];
const sp = P.split(L, '2026-11-06');
ok(eq(sp.next.map(c => c.id), ['4', '2', '1']) && eq(sp.past.map(c => c.id), ['3']), 'próximas (hoy incluido) de la más cercana; pasadas; se ignora la fecha inválida');
ok(P.nextFor(L, 'a', '2026-11-06').id === '4' && P.nextFor(L, 'b', '2026-11-06').id === '2' && P.nextFor(L, 'zz', '2026-11-06') === null, 'próxima competencia del atleta inscrito');
L.push({ id: '6', name: 'F', date: '2026-08-01', athletes: ['a'], results: { a: { sn: 95, cj: 115, total: 210 } } });
const best = P.bestOfficial(L, 'a');
ok(best && best.total === 210 && best.comp.id === '6' && P.bestOfficial(L, 'b') === null, 'mejor total oficial del atleta');

console.log(fails ? 'HAY FALLAS' : 'Todo bien'); process.exit(fails ? 1 : 0);
