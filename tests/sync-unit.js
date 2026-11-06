/* Pruebas del motor de sincronización (sync.js) sin navegador: varios «dispositivos» contra un servidor en memoria.
   Uso: node tests/sync-unit.js */
const { Engine, hash, toRecords } = require('../sync.js');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const tick = () => new Promise(r => setTimeout(r, 5));

/* ---- Servidor en memoria con las mismas reglas básicas que firestore.rules ---- */
function makeServer() {
  const srv = { docs: {}, at: 1000, watchers: [], offline: false, deny: false, writes: [], members: new Set(['A']) };
  srv.emit = () => srv.watchers.forEach(w => w.send());
  srv.remote = uid => ({
    watchRecords(u, since, cb, err) {
      const w = { send() {
        if (srv.offline) { cb([], { fromCache: true }); return; }
        if (srv.deny) { err(Object.assign(new Error('x'), { code: 'permission-denied' })); return; }
        cb(Object.keys(srv.docs).filter(k => k.startsWith(u + '/') && srv.docs[k].at >= since).map(k => Object.assign({ id: k.slice(u.length + 1) }, srv.docs[k])), { fromCache: false });
      } };
      srv.watchers.push(w); Promise.resolve().then(() => w.send());
      return () => { srv.watchers = srv.watchers.filter(x => x !== w); };
    },
    async setRecord(u, key, data) {
      if (srv.offline) throw Object.assign(new Error('off'), { code: 'unavailable' });
      if (srv.deny || u !== uid) throw Object.assign(new Error('deny'), { code: 'permission-denied' });
      srv.at += 1; srv.docs[u + '/' + key] = Object.assign({}, data, { at: srv.at }); srv.writes.push(key);
      Promise.resolve().then(() => srv.emit());
    }
  });
  return srv;
}
/* ---- Un «dispositivo»: estado + almacenamiento + motor ---- */
function fresh() {
  return { v: 1, demo: false, profile: { name: '', bw: 0, rest: 120 }, exercises: [{ id: 'snatch', name: 'Arranque', max: 0 }, { id: 'cj', name: 'Dos tiempos', max: 0 }], plan: { days: [{ on: false, items: [] }] }, sessions: [] };
}
function device(srv, uid, store, opts) {
  opts = opts || {};
  const d = { S: opts.S || fresh(), store: store || new Map(), applied: 0 };
  d.eng = new Engine({
    remote: srv.remote(uid), uid, store: { get: k => d.store.has(k) ? d.store.get(k) : null, set: (k, v) => d.store.set(k, v), del: k => d.store.delete(k) },
    app: { state: () => d.S, fresh: () => fresh(), commit: fn => { d.applied++; fn(d.S); d.S.sessions.sort((a, b) => a.startedAt - b.startedAt); } },
    now: opts.now || (() => Date.now())
  });
  d.start = fr => { d.eng.start({ fresh: !!fr }); return tick(); };
  d.save = async () => { d.eng.onSave(); await d.eng.flush(); await tick(); await tick(); };
  return d;
}
const sess = (id, t, extra) => Object.assign({ id, date: '2026-11-05', startedAt: t, endedAt: t + 3600000, items: [{ exId: 'snatch', sets: [{ kg: 60, reps: '2', done: true }] }] }, extra || {});

(async () => {
  console.log('1. Datos propios existentes suben a la nube; lo que es de fábrica no');
  let srv = makeServer();
  const A = device(srv, 'A');
  A.S.sessions.push(sess('s1', 1700000000000)); A.S.exercises[0].max = 80; A.S.profile.name = 'Ana'; A.S.profile.bw = 81;
  await A.start(); await A.eng.flush(); await tick();
  const keys = Object.keys(srv.docs).map(k => k.split('/')[1]).sort();
  ok(keys.includes('s_s1') && keys.includes('e_snatch') && keys.includes('profile'), 'sube la sesión, el ejercicio con máximo y el perfil: ' + keys.join(','));
  ok(!keys.includes('e_cj') && !keys.includes('plan'), 'no sube el ejercicio ni el plan que están como de fábrica');
  const Z = device(makeServer(), 'Z'); Z.S.profile.name = 'Solo nombre'; await Z.start(); await Z.eng.flush();
  ok(Z.eng.status().pending === 0, 'un perfil que solo tiene el nombre puesto cuenta como de fábrica'); Z.eng.stop();
  ok(srv.docs['A/s_s1'].u === 1700000000000 + 3600000, 'la hora de una sesión es la de su término');
  ok(A.eng.status().state === 'ok' && A.eng.status().pending === 0, 'estado «al día», sin cambios pendientes');

  console.log('2. Un dispositivo nuevo baja todo y no pisa nada con sus valores de fábrica');
  const B = device(srv, 'A');
  B.S.profile.name = 'Ana'; // el nombre se rellena al crear la cuenta
  await B.start(true); await tick();
  ok(B.S.sessions.length === 1 && B.S.sessions[0].id === 's1', 'recibe la sesión');
  ok(B.S.exercises.find(e => e.id === 'snatch').max === 80, 'recibe el máximo del arranque');
  ok(srv.writes.length === 3, 'el dispositivo nuevo no escribe nada (' + srv.writes.length + ' escrituras en total)');

  console.log('3. Cambios en un dispositivo llegan al otro; gana el más reciente');
  A.S.exercises[0].max = 85; await A.save(); await tick();
  ok(B.S.exercises.find(e => e.id === 'snatch').max === 85, 'B ve el nuevo máximo');
  const before = srv.writes.length;
  await B.save();
  ok(srv.writes.length === before, 'lo recibido no se vuelve a enviar (sin rebote): ' + (srv.writes.length - before) + ' escrituras');
  // conflicto: ambos cambian lo mismo; B lo hace después
  A.eng.now = () => 5e12; B.eng.now = () => 5e12 + 1000;
  A.S.exercises[0].max = 90; B.S.exercises[0].max = 95;
  srv.offline = true; await A.save(); await B.save(); srv.offline = false;
  ok(A.eng.status().pending === 1 && B.eng.status().pending === 1, 'sin conexión los cambios quedan en la cola');
  await A.eng.flush(); await B.eng.flush(); await tick(); await tick();
  ok(A.S.exercises[0].max === 95 && B.S.exercises[0].max === 95, 'ambos terminan con el cambio más reciente (95)');

  console.log('4. Borrar se propaga; un registro borrado no resucita');
  A.eng.now = B.eng.now = () => 6e12;
  A.S.sessions = A.S.sessions.filter(s => s.id !== 's1'); await A.save(); await tick();
  ok(B.S.sessions.length === 0, 'B también la pierde');
  const C = device(srv, 'A'); C.S.profile.name = 'Ana'; await C.start(true); await tick();
  ok(C.S.sessions.length === 0, 'un dispositivo nuevo no la recupera');

  console.log('5. Sin conexión: la cola se guarda y sobrevive a cerrar la app');
  A.eng.now = () => 7e12; srv.offline = true;
  A.S.sessions.push(sess('s2', 7e12 - 1e6)); await A.save();
  ok(A.eng.status().pending >= 1 && A.eng.status().state === 'offline' || A.eng.status().state === 'error', 'estado sin conexión con cambios pendientes: ' + A.eng.status().state);
  A.eng.stop();
  const A2 = device(srv, 'A', A.store, { S: JSON.parse(JSON.stringify(A.S)) });
  srv.offline = false; await A2.start(); await A2.eng.flush(); await tick();
  ok(!!srv.docs['A/s_s2'] && A2.eng.status().pending === 0, 'al reabrir con conexión se envía lo pendiente');

  console.log('6. Si se pierde el almacenamiento local no se borra la nube');
  const n = Object.keys(srv.docs).filter(k => !srv.docs[k].del).length;
  const D = device(srv, 'A', A2.store); // mismos metadatos, pero estado vacío (almacenamiento de datos perdido)
  D.S.profile.name = 'Ana';
  await D.start(true); await D.eng.flush(); await tick();
  ok(Object.keys(srv.docs).filter(k => !srv.docs[k].del).length === n, 'ningún registro quedó marcado como borrado');
  ok(D.S.sessions.some(s => s.id === 's2'), 'los datos vuelven desde la nube');

  console.log('7. Seguridad y robustez');
  srv.deny = true;
  A2.S.exercises[1].max = 70; await A2.save();
  ok(A2.eng.status().state === 'denied', 'sin permiso → estado «denied»');
  srv.deny = false;
  // datos remotos corruptos o de otro tipo se ignoran
  srv.at += 1; srv.docs['A/s_zzz'] = { t: 'session', d: '{no es json', u: 9e12, at: srv.at };
  srv.at += 1; srv.docs['A/s_yyy'] = { t: 'session', d: JSON.stringify({ id: 'otra', items: [] }), u: 9e12, at: srv.at };
  srv.at += 1; srv.docs['A/profile'] = { t: 'profile', del: true, u: 9e12, at: srv.at };
  srv.emit(); await tick();
  ok(!A2.S.sessions.some(s => s.id === 'zzz' || s.id === 'otra'), 'JSON roto o con id que no coincide con la clave se ignora');
  ok(A2.S.profile && A2.S.profile.name === 'Ana', 'el perfil nunca se borra por un registro «del»');
  A.eng.stop(); A2.eng.stop(); B.eng.stop(); C.eng.stop(); D.eng.stop();

  console.log('8. Registros de otra persona no se mezclan');
  srv = makeServer();
  const X = device(srv, 'A'); X.S.profile.name = 'Ana'; X.S.sessions.push(sess('sx', 1e12)); await X.start(); await X.eng.flush(); await tick();
  const Y = device(srv, 'B'); Y.S.profile.name = 'Beto'; await Y.start(true); await tick();
  ok(Y.S.sessions.length === 0, 'B no ve las sesiones de A');
  Y.S.sessions.push(sess('sy', 1e12)); await Y.save();
  await tick();
  ok(!!srv.docs['B/s_sy'] && !srv.docs['A/s_sy'], 'lo de B queda en su propia carpeta');
  ok(!X.S.sessions.some(s => s.id === 'sy'), 'A no recibe lo de B');
  X.eng.stop(); Y.eng.stop();

  console.log('Reloj del dispositivo (D3)');
const SY = require('../sync.js');
const T0 = Date.parse('2026-11-06T18:00:10Z');
ok(Math.abs(SY.clockSkew('Fri, 06 Nov 2026 18:00:10 GMT', T0, T0 + 200) - 400) < 1, 'skew = hora del servidor (+0,5 s por el truncado) − punto medio de la consulta');
ok(SY.clockSkew('basura', T0, T0) === null && SY.clockSkew(null, T0, T0) === null, 'una cabecera ilegible no da medición');
ok(SY.usableSkew(5000) === 0 && SY.usableSkew(-59000) === 0, 'un desvío menor a 1 minuto es ruido: no se corrige');
ok(SY.usableSkew(3 * 3600000) === 3 * 3600000 && SY.usableSkew(-7200000) === -7200000, 'un reloj 3 h adelantado o 2 h atrasado se corrige');
ok(SY.usableSkew(40 * 86400000) === 0 && SY.usableSkew(null) === 0 && SY.usableSkew(NaN) === 0, 'desvíos de más de 30 días o inválidos se ignoran');
console.log(fails ? fails + ' FALLAS' : 'TODO OK'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
