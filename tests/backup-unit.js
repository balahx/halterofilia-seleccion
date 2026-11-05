/* Respaldo del equipo: parte pura (lectura con un servidor de mentira, armado del archivo, nombre, resumen).
   Uso: node tests/backup-unit.js */
const B = require('../backup.js');
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };

const DB = {
  members: [{ id: 'u1', name: 'Ana', email: 'a@x.cl' }, { id: 'u2', name: 'Beto', email: 'b@x.cl' }],
  requests: [{ id: 'u3', name: 'Cata', status: 'pending' }],
  exercises: [{ id: 'snatch', en: 'Snatch' }],
  plans: [{ id: 'p1', name: 'Plan 2026' }],
  'plans/p1/stages': [{ id: 'e1', name: 'Etapa 1' }],
  'plans/p1/weeks': [{ id: 'e1_1', week: 1, next: '' }, { id: 'e1_2', week: 2, next: '' }],
  assignments: [{ id: 'u1', planId: 'p1', weekId: 'e1_1' }],
  adjustments: [{ id: 'u1_p1_e1_1', pcts: { a: 95 } }],
  'users/u1/records': [{ id: 's_1', t: 'session', d: '{}' }, { id: 'profile', t: 'profile', d: '{}' }],
  'users/u1/completions': [{ id: 'p1_e1_1_0', sessionIdx: 0 }],
  'users/u2/records': [], 'users/u2/completions': []
};
const DOCS = { 'config/plan': { activePlanId: 'p1' }, 'config/team': { coachUid: 'c1' } };
const calls = [];
const remote = {
  async getCol(p) { calls.push(p); if (!(p in DB)) throw Object.assign(new Error('x'), { code: 'permission-denied' }); return DB[p].map(x => Object.assign({}, x)); },
  async getDoc(p) { calls.push(p); return DOCS[p] || null; }
};

(async () => {
  console.log('1. Lectura completa');
  const msgs = [];
  const got = await B.collect(remote, t => msgs.push(t));
  ok(got.data.members.length === 2 && got.data.athletes.length === 2, 'miembros y atletas');
  ok(got.data.plans[0].weeks.length === 2 && got.data.plans[0].stages.length === 1, 'semanas y etapas del plan');
  ok(got.data.plans[0].id === 'p1' && got.data.plans[0].data.name === 'Plan 2026' && !('id' in got.data.plans[0].data), 'ficha del plan sin el id duplicado');
  ok(got.data.athletes[0].records.length === 2 && got.data.athletes[0].completions.length === 1, 'registros y cumplidas de la primera atleta');
  ok(got.data.config.plan.activePlanId === 'p1' && got.data.config.team.coachUid === 'c1', 'configuración');
  // lecturas: 2+1+1+1 + 1+2 (plan) + 2 (config) + 1 + 1 + (2+1) + (0+0) = 15
  ok(got.reads === 15, 'cuenta de lecturas = documentos leídos (' + got.reads + ')');
  ok(msgs.some(m => /atleta 2 de 2/.test(m)), 'informa el avance por atleta');

  console.log('2. Archivo');
  const f = B.build(got.data, { by: 'cristian@correo.cl', reads: got.reads, createdAt: '2026-11-05T12:00:00.000Z' });
  ok(B.isBackup(f) && f.format === 'halterofilia-respaldo-equipo' && f.v === 1, 'cabecera de formato y versión');
  ok(f.by === 'cristian@correo.cl' && f.createdAt === '2026-11-05T12:00:00.000Z', 'autor y fecha');
  ok(f.counts.members === 2 && f.counts.weeks === 2 && f.counts.records === 2 && f.counts.completions === 1 && f.counts.adjustments === 1, 'conteos');
  ok(JSON.parse(JSON.stringify(f)).athletes[0].records[0].id === 's_1', 'sobrevive a JSON');
  ok(!B.isBackup({ v: 1, sessions: [], exercises: [], plan: {} }) && !B.isBackup(null), 'el respaldo personal de un atleta no se confunde con este');
  ok(B.fileName(new Date(2026, 10, 5)) === 'respaldo-equipo-2026-11-05.json', 'nombre del archivo');
  ok(/2 atletas/.test(B.summary(f.counts)) && /1 sesiones cumplidas/.test(B.summary(f.counts)), 'resumen');

  console.log('3. Si algo falla, no hay respaldo a medias');
  DB['users/u2/records'] = undefined; delete DB['users/u2/records'];
  let err = null; try { await B.collect(remote); } catch (e) { err = e; }
  ok(err && err.code === 'permission-denied', 'el error se propaga (no se descarga un archivo incompleto)');

  console.log(fails ? '\n' + fails + ' fallo(s)' : '\nTodo bien'); process.exit(fails ? 1 : 0);
})();
