/* Lecturas económicas de Firestore.
   El plan gratuito permite 50.000 lecturas al día y cada documento descargado es una lectura. Este módulo evita
   volver a descargar lo que casi no cambia (catálogo de ejercicios, plan anual, lista de miembros) y lee solo lo
   nuevo de lo que crece (los registros de cada atleta).

   Qué hay aquí
   - Contador de lecturas por pantalla y por día (HalterReads.report() / HalterReads.print() en la consola).
   - Almacén local (IndexedDB; respaldo en memoria) para guardar lo descargado.
   - Plan y catálogo «con versión»: la versión de un plan es su id + la hora de publicación (plans/{id}.createdAt).
     Por abrir la app se lee 1 documento (la ficha del plan) y solo si la versión cambió se vuelve a bajar todo.
   - Registros de un atleta «incrementales»: la primera vez se baja el historial; después solo lo escrito desde
     la última lectura (campo `at`, hora del servidor).
   - Listas «con vigencia» (miembros, planes, rutinas): se reutilizan durante un tiempo y se renuevan solas al
     cambiar algo desde esta misma app (invalidate) o al volver a la pestaña pasado ese tiempo.

   Todo es opcional: si este archivo no se carga, cloud.js, assign.js y report.js funcionan como antes.
   Las funciones reciben el adaptador `remote` (getCol, getDoc, getRecordsSince) y se prueban con Node (tests/reads-unit.js). */
(function (root) {
  'use strict';

  const MIN = 60000;
  const META_TTL = 5 * MIN;           // cada cuánto se vuelve a mirar la ficha del plan durante una misma sesión
  const MAX_AGE = 24 * 60 * MIN;      // red de seguridad: aunque la versión del plan no cambie, plan y semanas se bajan de nuevo pasado este tiempo
  const CATALOG_MAX_AGE = 7 * MAX_AGE; // ídem para el catálogo de ejercicios
  const QUOTA = 50000;                // lecturas diarias del plan gratuito

  /* ---------- Almacén local ---------- */
  const clone = v => { try { return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)); } catch (e) { return v; } };
  function memStore() {
    const m = new Map();
    return {
      get: async k => (m.has(k) ? clone(m.get(k)) : undefined),
      set: async (k, v) => { m.set(k, clone(v)); },
      del: async k => { m.delete(k); },
      keys: async () => Array.from(m.keys()),
      clear: async () => { m.clear(); }
    };
  }
  function idbStore() {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      try {
        const rq = root.indexedDB.open('halter-reads', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
      } catch (e) { rej(e); }
    }));
    const run = (mode, fn) => open().then(db => new Promise((res, rej) => {
      const t = db.transaction('kv', mode), r = fn(t.objectStore('kv'));
      t.oncomplete = () => res(r ? r.result : undefined);
      t.onerror = t.onabort = () => rej(t.error);
    }));
    return {
      get: k => run('readonly', o => o.get(k)), set: (k, v) => run('readwrite', o => o.put(v, k)), del: k => run('readwrite', o => o.delete(k)),
      keys: () => run('readonly', o => o.getAllKeys()), clear: () => run('readwrite', o => o.clear())
    };
  }
  /* Si IndexedDB falla (navegación privada, almacenamiento lleno) se sigue en memoria: la app funciona igual, solo sin ahorro entre aperturas */
  function safeStore(primary) {
    const mem = memStore(); let broken = false;
    const call = async (op, args) => { if (!broken) { try { return await primary[op](...args); } catch (e) { broken = true; } } return mem[op](...args); };
    return { get: (...a) => call('get', a), set: (...a) => call('set', a), del: (...a) => call('del', a), keys: (...a) => call('keys', a), clear: (...a) => call('clear', a) };
  }
  let S = null;
  const store = () => S || (S = root.indexedDB ? safeStore(idbStore()) : memStore());
  const P = 'wl:';
  const get = k => store().get(P + k);
  const set = (k, v) => store().set(P + k, v);
  const del = k => store().del(P + k);

  /* ---------- Contador de lecturas ---------- */
  const pacificDay = () => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); } };   // la cuota se renueva a medianoche del Pacífico
  const T = { day: '', total: 0, by: {} };
  function loadCounter() {
    T.day = pacificDay(); T.total = 0; T.by = {};
    try { const o = JSON.parse(root.localStorage.getItem('wl.reads') || 'null'); if (o && o.day === T.day) { T.total = o.total || 0; T.by = o.by || {}; } } catch (e) { /* sin almacenamiento */ }
  }
  function saveCounter() { try { root.localStorage.setItem('wl.reads', JSON.stringify(T)); } catch (e) { /* sin almacenamiento */ } }
  /* plans/abc/weeks/w1 → plans/{id}/weeks ; users/uid/records → users/{id}/records */
  function labelOf(path) {
    const s = String(path).split('/'), col = s.length % 2 === 0 ? s.slice(0, -1) : s;
    return col.map((x, i) => (i % 2 === 1 ? '{id}' : x)).join('/');
  }
  function count(label, n) {
    if (!(n > 0)) return;
    if (!T.day || T.day !== pacificDay()) loadCounter();
    T.total += n; T.by[label] = (T.by[label] || 0) + n; saveCounter();
  }
  function report() {
    if (!T.day || T.day !== pacificDay()) loadCounter();
    const by = Object.keys(T.by).map(k => [k, T.by[k]]).sort((a, b) => b[1] - a[1]);
    return { day: T.day, total: T.total, pctOfQuota: Math.round(T.total / QUOTA * 1000) / 10, by: by };
  }
  function print() { const r = report(); if (root.console) { root.console.log('Lecturas de este dispositivo (día del Pacífico ' + r.day + '): ' + r.total + ' (' + r.pctOfQuota + ' % de la cuota diaria)'); if (root.console.table) root.console.table(r.by.map(x => ({ consulta: x[0], lecturas: x[1] }))); } return r; }
  function resetCounter() { T.day = pacificDay(); T.total = 0; T.by = {}; saveCounter(); }

  /* ---------- Avisos entre módulos ---------- */
  const subs = {};
  const on = (name, fn) => { (subs[name] = subs[name] || new Set()).add(fn); return () => { if (subs[name]) subs[name].delete(fn); }; };
  const fire = name => { Array.from(subs[name] || []).forEach(fn => { try { fn(); } catch (e) { /* un aviso fallido no debe frenar a los demás */ } }); };
  const metaMem = {};   // planId → { t, v }

  /* Borra lo guardado bajo `name` (y bajo `name:…`) y avisa a quien lo escucha para que lo vuelva a pedir */
  async function invalidate(name) {
    try {
      const ks = await store().keys();
      for (const k of ks) { if (typeof k !== 'string' || k.indexOf(P) !== 0) continue; const s = k.slice(P.length); if (s === name || s.indexOf(name + ':') === 0) await store().del(k); }
    } catch (e) { /* sin almacén */ }
    fire(name);
  }
  async function invalidatePlan(planId) {
    delete metaMem[planId];
    await Promise.all([invalidate('plan:' + planId), invalidate('stages:' + planId), invalidate('week:' + planId), invalidate('catalog')]);
  }
  const poke = name => fire('poke:' + name);   // «mira si hay algo nuevo» sin borrar nada
  async function clear() { Object.keys(metaMem).forEach(k => delete metaMem[k]); try { await store().clear(); } catch (e) { /* sin almacén */ } }

  /* ---------- Plan y catálogo con versión ---------- */
  async function planMeta(remote, planId, force) {
    const m = metaMem[planId];
    if (!force && m && Date.now() - m.t < META_TTL) return m.v;
    const d = await remote.getDoc('plans/' + planId);
    const v = { exists: !!d, version: d ? planId + '|' + (d.createdAt || 0) + '|' + (d.weeks || 0) : null, meta: d };
    metaMem[planId] = { t: Date.now(), v: v };
    return v;
  }
  /* Entrega primero lo guardado (fromCache: true), confirma la versión con 1 lectura y solo baja de nuevo si cambió */
  async function byVersion(remote, planId, key, fetchFn, cb, force, maxAge) {
    let hit = await get(key);
    if (hit && Date.now() - (hit.t || 0) > (maxAge || MAX_AGE)) { await del(key); hit = undefined; }   // muy antigua: se descarta (cubre cambios hechos fuera de la app, p. ej. en la consola de Firebase)
    if (hit && cb) cb(hit.value, { fromCache: true });
    let pm;
    try { pm = await planMeta(remote, planId, force); } catch (e) { if (hit) return hit.value; throw e; }
    if (!pm.exists) { await del(key); if (cb) cb(null, { fromCache: false, missing: true }); return null; }
    if (hit && hit.version === pm.version) { if (cb) cb(hit.value, { fromCache: false }); return hit.value; }
    const value = await fetchFn();
    await set(key, { version: pm.version, value: value, t: Date.now() });
    if (cb) cb(value, { fromCache: false });
    return value;
  }
  const planParts = (remote, id, cb, force) => byVersion(remote, id, 'plan:' + id, async () => {
    const r = await Promise.all([remote.getCol('plans/' + id + '/weeks'), remote.getCol('plans/' + id + '/stages')]);
    return { weeks: r[0], stages: r[1] };
  }, cb, force);
  const stages = (remote, id, cb, force) => byVersion(remote, id, 'stages:' + id, () => remote.getCol('plans/' + id + '/stages'), cb, force);
  const week = (remote, id, weekId, cb, force) => byVersion(remote, id, 'week:' + id + ':' + weekId, () => remote.getDoc('plans/' + id + '/weeks/' + weekId), cb, force);
  /* Catálogo de ejercicios: con plan activo se versiona con ese plan; sin plan se sirve lo guardado (o se baja una vez) */
  async function catalog(remote, planId, cb, force) {
    if (planId) {
      /* Si hace poco se bajó el catálogo sin saber el plan (primera apertura), se le pone la versión en vez de bajarlo otra vez */
      const h0 = await get('catalog');
      if (h0 && h0.version === null && Date.now() - h0.t < 10 * MIN) {
        try { const pm = await planMeta(remote, planId, force); if (pm.exists) { h0.version = pm.version; await set('catalog', h0); } } catch (e) { /* se resuelve abajo */ }
      }
      return byVersion(remote, planId, 'catalog', () => remote.getCol('exercises'), cb, force, CATALOG_MAX_AGE);
    }
    const hit = await get('catalog');
    if (hit && !force) { if (cb) cb(hit.value, { fromCache: true }); return hit.value; }
    const value = await remote.getCol('exercises');
    await set('catalog', { version: null, value: value, t: Date.now() });
    if (cb) cb(value, { fromCache: false });
    return value;
  }

  /* ---------- Registros de un atleta, solo lo nuevo ---------- */
  async function records(remote, uid, force) {
    const key = 'rec:' + uid, hit = force ? undefined : await get(key), st = hit || { since: 0, map: {} };
    let docs;
    try { docs = await remote.getRecordsSince(uid, st.since); }
    catch (e) { if (hit) return { list: Object.keys(hit.map).map(k => hit.map[k]), stale: true, fresh: 0 }; throw e; }
    let since = st.since;
    docs.forEach(d => { const cur = st.map[d.id]; if (!cur || (d.at || 0) >= (cur.at || 0)) st.map[d.id] = d; if ((d.at || 0) > since) since = d.at; });
    st.since = since;
    await set(key, st);
    return { list: Object.keys(st.map).map(k => st.map[k]), stale: false, fresh: docs.length };
  }

  /* ---------- Listas con vigencia (miembros, planes, rutinas) ---------- */
  async function swr(key, ttl, fetchFn, cb, force) {
    const hit = await get('swr:' + key), fresh = hit && Date.now() - hit.t < ttl;
    if (hit) cb(hit.value, { fromCache: !fresh || !!force });
    if (fresh && !force) return hit.value;
    let value;
    try { value = await fetchFn(); } catch (e) { if (hit) return hit.value; throw e; }
    await set('swr:' + key, { value: value, t: Date.now() });
    cb(value, { fromCache: false });
    return value;
  }

  /* ---------- «Feeds»: lo mismo que un listener, pero con lecturas puntuales ----------
     Devuelven la función para dejar de escuchar (igual que onSnapshot), así caben en las listas `unsub` existentes.
     Se renuevan al invalidar (cambios hechos desde esta app) y al volver a la pestaña. */
  function makeFeed(name, run, err) {
    let dead = false;
    const go = force => { if (dead) return; Promise.resolve().then(() => run(!!force, () => dead)).catch(e => { if (!dead && err) err(e); }); };
    const offs = [on(name, () => go(true)), on('poke:' + name, () => go(false))];
    const vis = () => { if (root.document && root.document.visibilityState === 'visible') go(false); };
    if (root.document) root.document.addEventListener('visibilitychange', vis);
    go(false);
    return () => { dead = true; offs.forEach(f => f()); if (root.document) root.document.removeEventListener('visibilitychange', vis); };
  }
  const guard = (cb, dead) => (v, m) => { if (!dead()) cb(v, m); };
  const feed = (key, o) => makeFeed(key, (force, dead) => swr(key, o.ttl, o.fetch, guard(o.cb, dead), force), o.err);
  const feedCatalog = (remote, getPlanId, cb, err) => makeFeed('catalog', (force, dead) => catalog(remote, getPlanId(), guard(cb, dead), force), err);
  const feedPlan = (remote, id, cb, err) => makeFeed('plan:' + id, (force, dead) => planParts(remote, id, guard(cb, dead), force), err);
  const feedStages = (remote, id, cb, err) => makeFeed('stages:' + id, (force, dead) => stages(remote, id, guard(cb, dead), force), err);
  const feedWeek = (remote, id, weekId, cb, err) => makeFeed('week:' + id, (force, dead) => week(remote, id, weekId, guard(cb, dead), force), err);

  const api = {
    count: count, labelOf: labelOf, report: report, print: print, resetCounter: resetCounter,
    invalidate: invalidate, invalidatePlan: invalidatePlan, poke: poke, clear: clear, on: on,
    planMeta: planMeta, planParts: planParts, stages: stages, week: week, catalog: catalog, records: records, swr: swr,
    feed: feed, feedCatalog: feedCatalog, feedPlan: feedPlan, feedStages: feedStages, feedWeek: feedWeek,
    _useStore: s => { S = s; }, _memStore: memStore, _forgetMeta: () => { Object.keys(metaMem).forEach(k => delete metaMem[k]); }   // _…: solo para las pruebas
  };
  root.HalterReads = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
