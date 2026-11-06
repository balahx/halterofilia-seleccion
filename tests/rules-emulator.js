/* Prueba las reglas REALES de Firestore (firestore.rules) con el emulador de Firebase.
   Solo corre en GitHub Actions (ver .github/workflows/ci.yml), porque necesita Java y firebase-tools:
     npm i --no-save firebase@10.14.1 @firebase/rules-unit-testing@3.0.4
     npx firebase-tools@13 emulators:exec --only firestore --project demo-wl "node tests/rules-emulator.js"
   (tests/fake-remote.js es una copia a mano de las reglas para las pruebas de pantalla; esta prueba es la que dice la verdad.) */
const fs = require('fs'), path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app'); require('firebase/compat/firestore');
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const succeeds = async (p, m) => { try { await assertSucceeds(p); ok(true, m); } catch (e) { ok(false, m + ' · ' + (e.message || e).toString().slice(0, 120)); } };
const denied = async (p, m) => { try { await assertFails(p); ok(true, m); } catch (e) { ok(false, m + ' · se permitió'); } };
const TS = () => firebase.firestore.FieldValue.serverTimestamp();

(async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-wl', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
  await env.clearFirestore();
  const NOW = Date.now();
  const WEEK = { stageId: 'e1', week: 1, label: '', kind: '', notes: [], sessions: [{ day: 1 }, { day: 3 }], next: 'e1_2' };
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await db.doc('config/team').set({ coachUid: 'coach' });
    await db.doc('members/ana').set({ name: 'Ana', email: 'ana@x.cl', approvedAt: new Date() });
    await db.doc('members/beto').set({ name: 'Beto', email: 'beto@x.cl', approvedAt: new Date() });
    await db.doc('plans/p1').set({ name: 'Plan', createdAt: new Date() });
    await db.doc('plans/p1/weeks/e1_1').set(WEEK);
    await db.doc('plans/p1/weeks/e1_2').set(Object.assign({}, WEEK, { week: 2, next: '' }));
    await db.doc('assignments/ana').set({ planId: 'p1', weekId: 'e1_1', week: 1, stageId: 'e1', weekEndsAt: NOW + 86400000, setBy: 'coach', at: new Date() });
  });
  const anon = env.unauthenticatedContext().firestore();
  const coach = env.authenticatedContext('coach', { email: 'cristian@x.cl' }).firestore();
  const ana = env.authenticatedContext('ana', { email: 'ana@x.cl' }).firestore();
  const beto = env.authenticatedContext('beto', { email: 'beto@x.cl' }).firestore();
  const carla = env.authenticatedContext('carla', { email: 'carla@x.cl' }).firestore();

  console.log('1. Acceso y cuentas');
  await denied(anon.doc('config/team').get(), 'sin iniciar sesión no se lee nada');
  await succeeds(ana.doc('members/ana').get(), 'una atleta lee su propia ficha de miembro');
  await denied(ana.doc('members/beto').get(), 'una atleta no lee la ficha de otro');
  await succeeds(coach.doc('members/beto').get(), 'el entrenador lee la de cualquiera');
  await denied(ana.doc('members/ana').set({ name: 'Ana', email: 'ana@x.cl', approvedAt: TS() }), 'una atleta no se aprueba a sí misma');
  await succeeds(carla.doc('requests/carla').set({ name: 'Carla Soto', email: 'carla@x.cl', status: 'pending', createdAt: TS() }), 'una persona pide acceso con su propio correo');
  await denied(beto.doc('requests/beto').set({ name: 'Beto Soto', email: 'otro@x.cl', status: 'pending', createdAt: TS() }), 'no se puede pedir acceso con el correo de otra persona');
  await denied(carla.doc('requests/beto').set({ name: 'Beto Soto', email: 'carla@x.cl', status: 'pending', createdAt: TS() }), 'no se puede crear la solicitud de otra persona');

  console.log('2. Datos propios');
  const rec = d => Object.assign({ t: 'session', u: NOW, at: TS(), d: '{}' }, d || {});
  await succeeds(ana.doc('users/ana/records/s1').set(rec()), 'una atleta guarda su registro');
  await denied(ana.doc('users/beto/records/s1').set(rec()), 'no escribe en los registros de otro');
  await denied(ana.doc('users/ana/records/s2').set(rec({ u: NOW + 3600000 })), 'un reloj adelantado más de 10 minutos se rechaza');
  await denied(ana.doc('users/ana/records/s3').set(rec({ t: 'otra' })), 'solo tipos de registro conocidos');
  await denied(beto.doc('users/ana/records/s1').get(), 'otro atleta no lee mis registros');
  await succeeds(coach.doc('users/ana/records/s1').get(), 'el entrenador sí los lee');
  await denied(carla.doc('users/carla/records/s1').set(rec()), 'sin estar aprobada no se escribe');

  console.log('3. Semana asignada');
  await succeeds(ana.doc('assignments/ana').get(), 'la atleta lee su semana');
  await denied(beto.doc('assignments/ana').get(), 'otro atleta no la lee');
  await denied(ana.doc('assignments/ana').update({ weekId: 'e1_2', week: 2, stageId: 'e1', weekEndsAt: NOW + 86400000 + 604800000, at: TS() }), 'no se puede pasar de semana antes del corte');
  await denied(ana.doc('assignments/beto').set({ planId: 'p1', weekId: 'e1_1', week: 1, stageId: 'e1', weekEndsAt: NOW, setBy: 'ana', at: TS() }), 'una atleta no se asigna una semana');
  await succeeds(ana.doc('users/ana/completions/p1_e1_1_0').set({ planId: 'p1', weekId: 'e1_1', sessionIdx: 0, completedAt: TS() }), 'registra una sesión de su semana asignada');
  await denied(ana.doc('users/ana/completions/p1_e1_1_0').set({ planId: 'p1', weekId: 'e1_1', sessionIdx: 0, completedAt: TS() }), 'no se reescribe una sesión ya cumplida');
  await denied(ana.doc('users/ana/completions/p1_e1_2_0').set({ planId: 'p1', weekId: 'e1_2', sessionIdx: 0, completedAt: TS() }), 'no registra sesiones de una semana que no tiene asignada');

  console.log('4. Rutinas');
  const rt = d => Object.assign({ uid: 'ana', name: 'Rehab', mode: 'extra', sessions: [{ name: 'a', day: 1, items: [] }], setBy: 'coach', at: TS() }, d || {});
  await succeeds(coach.doc('routines/r1').set(rt()), 'el entrenador crea una rutina');
  await denied(coach.doc('routines/r2').set(rt({ mode: 'otro' })), 'solo modos «extra» y «replace»');
  await denied(coach.doc('routines/r3').set(rt({ uid: 'carla' })), 'solo para atletas inscritos');
  await denied(ana.doc('routines/r4').set(rt({ setBy: 'ana' })), 'una atleta no crea rutinas');
  await succeeds(ana.collection('routines').where('uid', '==', 'ana').get(), 'la atleta lee las suyas');
  await denied(beto.doc('routines/r1').get(), 'otro atleta no las lee');

  await env.cleanup();
  console.log(fails ? 'FALLAS: ' + fails : 'Todo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
