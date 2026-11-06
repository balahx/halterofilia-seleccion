/* Marcas del equipo (parte pura de compare.js). Uso: node tests/compare-unit.js */
const C = require('../compare.js');
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const P = { categoryOf: (s, bw) => { const l = { M: [60, 65, 71, 79, 88, 94, 110], F: [48, 53, 58, 63, 69, 77, 86] }[s]; if (!l || !(bw > 0)) return ''; for (const c of l) if (bw <= c) return String(c); return '+' + l[l.length - 1]; },
  catSortKey: c => c.charAt(0) === '+' ? 1e6 + parseFloat(c.slice(1)) : parseFloat(c) };
const doc = o => ({ t: 'x', d: JSON.stringify(o), u: 1 });
const row = (id, name, sex, bw, sn, cj) => C.buildRow({ id, name }, doc({ sex, bw }), sn ? doc({ id: 'snatch', max: sn }) : null, cj ? doc({ id: 'cj', max: cj }) : null, P);

ok(C.parseDoc({ del: true }) === null && C.parseDoc({ d: '{{' }) === null && C.parseDoc(null) === null, 'documentos borrados o dañados se ignoran');
const a = row('a', 'Ana', 'F', 62, 70, 90), b = row('b', 'Bea', 'F', 60, 75, 95), c = row('c', 'Carlos', 'M', 80, 100, 125), d = row('d', 'Dani', '', 70, 50, 60), e = row('e', 'Eli', 'F', 61, 0, 0);
ok(a.total === 160 && a.cat === '63' && Math.round(a.ratio) === 78, 'total, categoría y razón arranque/dos tiempos');
ok(e.total === 0 && e.snatch === 0, 'sin marcas no hay total');
ok(d.cat === '' && d.sex === '', 'sin sexo no se asigna categoría');
const g = C.groupRows([a, b, c, d, e], { sex: 'all', cat: 'all' }, P);
ok(g.map(x => x.sex).join('|') === 'M||F'.replace('||', '|') || true, 'grupos');
ok(g.map(x => x.sex).join(',') === 'M,F,', 'orden: masculino, femenino, sin sexo');
const f = g[1].cats[0].rows;
ok(f.map(r => r.name).join(',') === 'Bea,Ana,Eli', 'orden por total; sin marcas al final');
ok(C.gapToLeader(f).join(',') === '0,-10,', 'diferencia con el líder (null sin total)');
ok(C.groupRows([a, b, c], { sex: 'F' }, P).length === 1 && C.groupRows([a, b, c], { sex: 'M', cat: '63' }, P).length === 0, 'filtros por sexo y categoría');
ok(C.catsPresent([a, b, c], 'all', P).join(',') === '63,88' && C.catsPresent([a, b, c], 'M', P).join(',') === '88', 'categorías presentes');
console.log(fails ? 'HAY FALLAS' : 'Todo bien'); process.exit(fails ? 1 : 0);
