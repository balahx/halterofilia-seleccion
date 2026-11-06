/* Pruebas de reads.js con un Firestore simulado que cuenta las lecturas.
   Ejecutar:  node tests/reads-unit.js   (desde la carpeta optimizacion-lecturas, con reads.js junto a esta carpeta) */
'use strict';
const assert = require('assert');
const R = require('../reads.js');

let n = 0, fails = 0;
const tick = () => new Promise(r => setTimeout(r, 5));
async function test(name, fn) {
  try { R._useStore(R._memStore()); R._forgetMeta(); await fn(); n++; console.log('  ok  ' + name); }
  catch (e) { fails++; console.log('  FALLA ' + name + '\n       ' + (e && e.stack || e)); }
}

/* Firestore simulado: cuenta una lectura por documento devuelto (mínimo 1 por consulta), como Firestore */
function fakeRemote() {
  const db = {
    plan: { createdAt: 1000, weeks: 3 },
    weeks: { w1: { id: 'w1', week: 1, stageId: 's1' }, w2: { id: 'w2', week: 2, stageId: 's1' }, w3: { id: 'w3', week: 3, stageId: 's2' } },
    stages: [{ id: 's1', order: 1, name: 'Base' }, { id: 's2', order: 2, name: 'Fuerza' }],
    exercises: Array.from({ length: 200 }, (_, i) => ({ id: 'e' + i, en: 'Ex ' + i, es: 'Ej ' + i })),
    members: Array.from({ length: 30 }, (_, i) => ({ id: 'm' + i, name: 'Atleta ' + i })),
    records: [] // { id, at, t, d }
  };
  const r = { reads: 0, offline: false, db: db };
  const net = () => { if (r.offline) { const e = new Error('offline'); e.code = 'unavailable'; throw e; } };
  r.getDoc = async path => {
    net(); r.reads += 1;
    if (path === 'plans/P') return Object.assign({}, db.plan);
    const m = /^plans\/P\/weeks\/(.+)$/.exec(path); if (m) return db.weeks[m[1]] ? Object.assign({}, db.weeks[m[1]]) : null;
    return null;
  };
  r.getCol = async path => {
    net(); let l = [];
    if (path === 'plans/P/weeks') l = Object.values(db.weeks); else if (path === 'plans/P/stages') l = db.stages; else if (path === 'exercises') l = db.exercises; else if (path === 'members') l = db.members;
    r.reads += Math.max(1, l.length); return l.map(x => Object.assign({}, x));
  };
  r.getRecordsSince = async (uid, since) => {
    net(); const l = db.records.filter(x => x.at >= since); r.reads += Math.max(1, l.length); return l.map(x => Object.assign({}, x));
  };
  return r;
}
const nextSession = () => R._forgetMeta();   // equivale a cerrar y volver a abrir la app: la copia local sigue, la memoria de la sesión no

(async () => {
  console.log('reads.js');

  await test('etiquetas de consulta', () => {
    assert.strictEqual(R.labelOf('users/abc/records'), 'users/{id}/records');
    assert.strictEqual(R.labelOf('plans/p1/weeks/w3'), 'plans/{id}/weeks');
    assert.strictEqual(R.labelOf('members'), 'members');
    assert.strictEqual(R.labelOf('assignments/u1'), 'assignments');
  });

  await test('atleta: la semana se baja una vez y después solo se lee la ficha del plan', async () => {
    const r = fakeRemote(); let got = null, fc = null;
    let off = R.feedWeek(r, 'P', 'w2', (d, m) => { got = d; fc = m.fromCache; });
    await tick(); off();
    assert.strictEqual(got.week, 2); assert.strictEqual(fc, false);
    assert.strictEqual(r.reads, 2, 'ficha del plan + semana');
    r.reads = 0; nextSession(); got = null;
    off = R.feedWeek(r, 'P', 'w2', (d, m) => { got = d; fc = m.fromCache; });
    await tick(); off();
    assert.strictEqual(got.week, 2);
    assert.strictEqual(r.reads, 1, 'solo la ficha del plan');
  });

  await test('atleta: lo guardado se muestra enseguida (fromCache) y luego se confirma', async () => {
    const r = fakeRemote(); const seen = [];
    let off = R.feedWeek(r, 'P', 'w1', (d, m) => seen.push(m.fromCache)); await tick(); off();
    nextSession(); seen.length = 0;
    off = R.feedWeek(r, 'P', 'w1', (d, m) => seen.push(m.fromCache)); await tick(); off();
    assert.deepStrictEqual(seen, [true, false]);
  });

  await test('si el entrenador vuelve a publicar el plan, la semana se baja de nuevo', async () => {
    const r = fakeRemote(); let got = null;
    let off = R.feedWeek(r, 'P', 'w1', d => { got = d; }); await tick(); off();
    r.db.plan.createdAt = 2000; r.db.weeks.w1 = { id: 'w1', week: 1, stageId: 's1', note: 'nuevo' };
    nextSession(); r.reads = 0;
    off = R.feedWeek(r, 'P', 'w1', d => { got = d; }); await tick(); off();
    assert.strictEqual(got.note, 'nuevo'); assert.strictEqual(r.reads, 2);
  });

  await test('copia muy antigua: se baja de nuevo aunque la versión del plan no haya cambiado (cambios hechos fuera de la app)', async () => {
    const st = R._memStore(); R._useStore(st);
    const r = fakeRemote(); let got = null;
    let off = R.feedWeek(r, 'P', 'w1', d => { got = d; }); await tick(); off();
    const k = 'wl:week:P:w1', e = await st.get(k); e.t = Date.now() - 25 * 3600 * 1000; await st.set(k, e);   // 25 h
    r.db.weeks.w1 = { id: 'w1', week: 1, stageId: 's1', note: 'editada en la consola' };
    nextSession(); r.reads = 0;
    off = R.feedWeek(r, 'P', 'w1', d => { got = d; }); await tick(); off();
    assert.strictEqual(got.note, 'editada en la consola'); assert.strictEqual(r.reads, 2);
  });

  await test('semana que no existe: se informa como ausente (confirmado por el servidor)', async () => {
    const r = fakeRemote(); let got = 'x', meta = null;
    const off = R.feedWeek(r, 'P', 'w99', (d, m) => { got = d; meta = m; }); await tick(); off();
    assert.strictEqual(got, null); assert.strictEqual(meta.fromCache, false);
  });

  await test('plan borrado: devuelve vacío y limpia la copia', async () => {
    const r = fakeRemote(); let got = 'x';
    let off = R.feedWeek(r, 'P', 'w1', d => { got = d; }); await tick(); off();
    r.getDoc = async () => { r.reads++; return null; }; nextSession();
    off = R.feedWeek(r, 'P', 'w1', d => { got = d; }); await tick(); off();
    assert.strictEqual(got, null);
  });

  await test('sin conexión: se usa la copia guardada y no hay error', async () => {
    const r = fakeRemote(); let got = null, errs = 0;
    let off = R.feedWeek(r, 'P', 'w3', d => { got = d; }, () => errs++); await tick(); off();
    nextSession(); got = null; r.offline = true;
    off = R.feedWeek(r, 'P', 'w3', d => { got = d; }, () => errs++); await tick(); off();
    assert.strictEqual(got.week, 3); assert.strictEqual(errs, 0);
  });

  await test('sin conexión y sin copia: se informa el error', async () => {
    const r = fakeRemote(); r.offline = true; let errs = 0;
    const off = R.feedWeek(r, 'P', 'w3', () => {}, () => errs++); await tick(); off();
    assert.strictEqual(errs, 1);
  });

  await test('entrenador: plan completo y catálogo, una vez por versión', async () => {
    const r = fakeRemote(); let parts = null, cat = null;
    let o1 = R.feedPlan(r, 'P', p => { parts = p; });
    let o2 = R.feedCatalog(r, () => 'P', c => { cat = c; });
    await tick(); await tick(); o1(); o2();
    assert.strictEqual(parts.weeks.length, 3); assert.strictEqual(parts.stages.length, 2); assert.strictEqual(cat.length, 200);
    assert.strictEqual(r.reads, 1 + 3 + 2 + 200, 'ficha 1 + semanas 3 + etapas 2 + catálogo 200 (la ficha se comparte)');
    r.reads = 0; nextSession();
    o1 = R.feedPlan(r, 'P', p => { parts = p; }); o2 = R.feedCatalog(r, () => 'P', c => { cat = c; });
    await tick(); await tick(); o1(); o2();
    assert.strictEqual(r.reads, 1, 'segunda apertura: solo la ficha del plan');
    assert.strictEqual(cat.length, 200);
  });

  await test('catálogo bajado sin plan (primera apertura) no se repite cuando llega el plan', async () => {
    const r = fakeRemote(); let cat = null, planId = null;
    const off = R.feedCatalog(r, () => planId, c => { cat = c; });
    await tick(); assert.strictEqual(cat.length, 200); assert.strictEqual(r.reads, 200);
    planId = 'P'; R.poke('catalog'); await tick(); await tick(); off();
    assert.strictEqual(r.reads, 201, 'solo se sumó la ficha del plan');
  });

  await test('invalidar el plan (publicación) fuerza una nueva descarga de todo', async () => {
    const r = fakeRemote(); let parts = null;
    const off = R.feedPlan(r, 'P', p => { parts = p; }); await tick();
    r.db.plan.createdAt = 5000; r.db.weeks.w4 = { id: 'w4', week: 4, stageId: 's2' }; r.db.plan.weeks = 4;
    r.reads = 0; await R.invalidatePlan('P'); await tick(); await tick(); off();
    assert.strictEqual(parts.weeks.length, 4);
    assert.strictEqual(r.reads, 1 + 4 + 2);
  });

  await test('registros del atleta: historial una vez y después solo lo nuevo', async () => {
    const r = fakeRemote();
    for (let i = 0; i < 300; i++) r.db.records.push({ id: 's_' + i, at: 1000 + i, t: 'session', d: '{}' });
    let res = await R.records(r, 'u1');
    assert.strictEqual(res.list.length, 300); assert.strictEqual(r.reads, 300);
    r.reads = 0; res = await R.records(r, 'u1');
    assert.strictEqual(res.list.length, 300);
    assert.strictEqual(r.reads, 1, 'el borde (at >= último) vuelve a leer 1 documento');
    r.db.records.push({ id: 's_new', at: 5000, t: 'session', d: '{"x":1}' });
    r.db.records[3] = { id: 's_3', at: 5001, t: 'session', d: '{"edit":1}', del: true };
    r.reads = 0; res = await R.records(r, 'u1');
    assert.strictEqual(res.list.length, 301); assert.strictEqual(r.reads, 3, '2 documentos nuevos + el del borde');
    assert.strictEqual(res.list.find(x => x.id === 's_3').del, true);
    assert.strictEqual(res.list.find(x => x.id === 's_new').d, '{"x":1}');
  });

  await test('registros: cada atleta tiene su propia copia', async () => {
    const r = fakeRemote(); r.db.records.push({ id: 'a', at: 10, t: 'session', d: '{}' });
    await R.records(r, 'u1'); r.reads = 0; await R.records(r, 'u2');
    assert.strictEqual(r.reads, 1);   // u2 no tenía copia: lee su historial completo
    r.db.records.push({ id: 'b', at: 11, t: 'session', d: '{}' });
    r.reads = 0; const res = await R.records(r, 'u1');
    assert.strictEqual(res.list.length, 2);
  });

  await test('registros sin conexión: se entrega la copia como desactualizada', async () => {
    const r = fakeRemote(); r.db.records.push({ id: 'a', at: 10, t: 'session', d: '{}' });
    await R.records(r, 'u1'); r.offline = true;
    const res = await R.records(r, 'u1');
    assert.strictEqual(res.stale, true); assert.strictEqual(res.list.length, 1);
  });

  await test('listas con vigencia: se reutilizan dentro del plazo y se renuevan al invalidar', async () => {
    const r = fakeRemote(); let list = null;
    const off = R.feed('members', { ttl: 600000, fetch: () => r.getCol('members'), cb: l => { list = l; } });
    await tick(); assert.strictEqual(list.length, 30); assert.strictEqual(r.reads, 30);
    nextSession(); r.reads = 0;
    const off2 = R.feed('members', { ttl: 600000, fetch: () => r.getCol('members'), cb: l => { list = l; } });
    await tick(); assert.strictEqual(r.reads, 0, 'dentro de la vigencia no se lee nada');
    r.db.members.push({ id: 'm30', name: 'Nuevo' });
    await R.invalidate('members'); await tick(); await tick();
    assert.strictEqual(list.length, 31); assert.strictEqual(r.reads, 31 * 2, 'los dos feeds abiertos se renuevan; la copia nueva se comparte pero cada uno lee al invalidar');
    off(); off2();
  });

  await test('listas con vigencia vencida: muestra lo guardado y luego lo renovado', async () => {
    const r = fakeRemote(); const seen = [];
    let off = R.feed('plans', { ttl: 0, fetch: () => r.getCol('members'), cb: (l, m) => seen.push([l.length, m.fromCache]) });
    await tick(); off(); seen.length = 0;
    off = R.feed('plans', { ttl: 0, fetch: () => r.getCol('members'), cb: (l, m) => seen.push([l.length, m.fromCache]) });
    await tick(); off();
    assert.deepStrictEqual(seen, [[30, true], [30, false]]);
  });

  await test('un feed cerrado no vuelve a avisar', async () => {
    const r = fakeRemote(); let calls = 0;
    const off = R.feed('members', { ttl: 600000, fetch: () => r.getCol('members'), cb: () => { calls++; } });
    off(); await tick(); const c = calls; await R.invalidate('members'); await tick();
    assert.strictEqual(calls, c);
  });

  await test('contador de lecturas', () => {
    R.resetCounter(); R.count('exercises', 200); R.count('members', 30); R.count('exercises', 5);
    const rep = R.report();
    assert.strictEqual(rep.total, 235); assert.deepStrictEqual(rep.by[0], ['exercises', 205]);
    assert.strictEqual(rep.pctOfQuota, 0.5);
  });

  await test('clear() borra las copias (cierre de sesión)', async () => {
    const r = fakeRemote(); r.db.records.push({ id: 'a', at: 10, t: 'session', d: '{}' });
    await R.records(r, 'u1'); await R.clear(); r.reads = 0; await R.records(r, 'u1');
    assert.strictEqual(r.reads, 1);   // volvió a bajar el historial (1 documento)
  });

  console.log('\n' + n + ' pruebas correctas' + (fails ? ', ' + fails + ' con fallas' : ''));
  process.exit(fails ? 1 : 0);
})();
