/* Sincronización de los datos propios (fase 2).
   Cada sesión, ejercicio (con su máximo), el perfil y el plan semanal se guardan como un registro en
   Firestore: users/{uid}/records/{clave}
     { t: 'session' | 'exercise' | 'profile' | 'plan',
       d: contenido en JSON (texto),   // no existe en un registro borrado
       u: hora de la última modificación en el dispositivo (ms),   // decide quién gana: el más reciente
       del: true,                      // registro borrado (se conserva para avisar a los otros dispositivos)
       at: hora del servidor }         // solo sirve para pedir "lo que cambió desde la última vez"
   Claves: profile, plan, e_<id del ejercicio>, s_<id de la sesión>.
   Sin Cloud Functions. Funciona sin conexión: los cambios quedan en una cola guardada en el dispositivo y se
   envían cuando vuelve la conexión. */
(function (root) {
  'use strict';

  /* ---------- Funciones puras (se prueban también con Node) ---------- */
  function hash(str) { // cyrb53: suficiente para detectar cambios
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  const typeOf = key => key === 'profile' ? 'profile' : key === 'plan' ? 'plan' : key.charAt(0) === 'e' ? 'exercise' : 'session';

  /* Estado → { clave: texto JSON } */
  function toRecords(S) {
    const r = { profile: JSON.stringify(S.profile), plan: JSON.stringify(S.plan) };
    for (const e of S.exercises) r['e_' + e.id] = JSON.stringify(e);
    for (const s of S.sessions) r['s_' + s.id] = JSON.stringify(s);
    return r;
  }
  /* ¿Es igual al estado inicial? (así un dispositivo nuevo no pisa datos reales de la nube) */
  function isDefault(key, json, fresh) {
    if (key === 'profile') { const o = JSON.parse(json); o.name = ''; return JSON.stringify(o) === fresh.profile; }
    return fresh[key] === json;
  }
  function applyRecord(S, key, parsed) {
    if (key === 'profile') S.profile = parsed;
    else if (key === 'plan') S.plan = parsed;
    else if (key.charAt(0) === 'e') { const i = S.exercises.findIndex(e => e.id === parsed.id); if (i >= 0) S.exercises[i] = parsed; else S.exercises.push(parsed); }
    else { const i = S.sessions.findIndex(s => s.id === parsed.id); if (i >= 0) S.sessions[i] = parsed; else S.sessions.push(parsed); }
  }
  function removeRecord(S, key) {
    if (key.charAt(0) === 'e') S.exercises = S.exercises.filter(e => 'e_' + e.id !== key);
    else if (key.charAt(0) === 's') S.sessions = S.sessions.filter(s => 's_' + s.id !== key);
  }
  /* ¿Se puede aplicar este contenido remoto? (los datos de la nube no son de confianza) */
  function validRecord(key, o) {
    if (!o || typeof o !== 'object') return false;
    if (key === 'profile') return true;
    if (key === 'plan') return Array.isArray(o.days);
    if (key.charAt(0) === 'e') return typeof o.id === 'string' && 'e_' + o.id === key && typeof o.name === 'string';
    return typeof o.id === 'string' && 's_' + o.id === key && Array.isArray(o.items);
  }

  /* ---------- Motor ---------- */
  const DEBOUNCE = 3000, RETRY_MIN = 30000, RETRY_MAX = 300000;
  /* Sin conexión el SDK deja la escritura esperando: se corta a los 20 s y se reintenta más tarde */
  function withTimeout(p, ms) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(Object.assign(new Error('sin respuesta'), { code: 'unavailable' })), ms);
      Promise.resolve(p).then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
    });
  }

  class Engine {
    /* deps: { remote, uid, app: { state(), fresh(), commit(fn) }, store, onStatus(status), now() } */
    constructor(deps) {
      this.d = deps; this.now = deps.now || Date.now;
      this.meta = { v: 1, rec: {}, dirty: {}, since: 0, last: 0 };
      this.ready = false; this.busy = false; this.applying = false; this.err = null; this.retryMs = RETRY_MIN;
      this.timer = null; this.unsub = null; this.stopped = false; this.freshJ = null; this.lastStatus = '';
    }
    key() { return 'halterofilia.v1.' + this.d.uid + '.sync'; }
    loadMeta(reset) {
      try { const m = JSON.parse(this.d.store.get(this.key()) || 'null'); if (!reset && m && m.v === 1 && m.rec && m.dirty) this.meta = m; } catch (e) { /* metadatos ilegibles: se parte de cero */ }
    }
    saveMeta() { this.d.store.set(this.key(), JSON.stringify(this.meta)); }

    start(opts) {
      opts = opts || {};
      this.stopped = false;
      const f = this.d.app.fresh(); this.freshJ = toRecords(f); this.freshJ.profile = JSON.stringify(Object.assign({}, f.profile, { name: '' }));
      this.loadMeta(!!opts.fresh); // sin datos locales (primer uso o almacenamiento borrado) se vuelve a bajar todo
      this.diff(); this.saveMeta();
      this.listen();
      this.bindEvents();
      if (Object.keys(this.meta.dirty).length) this.schedule(2000); // quedó algo sin enviar la última vez
      this.status();
    }
    stop() {
      this.stopped = true; clearTimeout(this.timer);
      if (this.unsub) { try { this.unsub(); } catch (e) { /* ya cerrado */ } this.unsub = null; }
      this.unbindEvents();
    }
    bindEvents() {
      if (typeof window === 'undefined') return;
      this.onOnline = () => { this.retryMs = RETRY_MIN; this.schedule(500); this.status(); };
      this.onOffline = () => this.status();
      this.onVis = () => { if (document.visibilityState === 'visible') this.schedule(500); };
      window.addEventListener('online', this.onOnline); window.addEventListener('offline', this.onOffline); document.addEventListener('visibilitychange', this.onVis);
    }
    unbindEvents() {
      if (typeof window === 'undefined' || !this.onOnline) return;
      window.removeEventListener('online', this.onOnline); window.removeEventListener('offline', this.onOffline); document.removeEventListener('visibilitychange', this.onVis);
      this.onOnline = null;
    }

    /* Detecta lo que cambió en el dispositivo desde la última vez y lo deja en la cola */
    diff() {
      const S = this.d.app.state(); if (!S) return false;
      const cur = toRecords(S), m = this.meta, t = this.now(); let changed = false;
      for (const key of Object.keys(cur)) {
        const h = hash(cur[key]), r = m.rec[key];
        if (!r) {
          let u = 0;
          if (!isDefault(key, cur[key], this.freshJ)) {
            u = t;
            if (key.charAt(0) === 's') { try { const s = JSON.parse(cur[key]); u = s.endedAt || s.startedAt || t; } catch (e) { u = t; } }
          }
          m.rec[key] = { u: u, h: h };
          if (u > 0) { m.dirty[key] = 1; changed = true; }
        } else if (r.h !== h) { m.rec[key] = { u: t, h: h }; m.dirty[key] = 1; changed = true; }
      }
      for (const key of Object.keys(m.rec)) {
        if (!(key in cur) && m.rec[key].h !== 'del') { m.rec[key] = { u: t, h: 'del' }; m.dirty[key] = 1; changed = true; }
      }
      return changed;
    }
    /* La app avisa después de cada guardado local */
    onSave() {
      if (this.applying || this.stopped) return;
      if (this.diff()) { this.saveMeta(); this.schedule(DEBOUNCE); }
      this.status();
    }

    listen() {
      if (this.unsub) return;
      try {
        this.unsub = this.d.remote.watchRecords(this.d.uid, this.meta.since,
          (docs, info) => this.onRemote(docs, info || {}),
          e => { this.setErr(e); });
      } catch (e) { this.setErr(e); }
    }

    /* Cambios que llegan de la nube */
    onRemote(docs, info) {
      if (this.stopped) return;
      if (info.fromCache && !docs.length) return; // sin confirmación del servidor: no se saca ninguna conclusión
      const m = this.meta; let maxAt = m.since; const apply = [];
      for (const d of docs) {
        if (typeof d.at !== 'number') continue; // nuestra propia escritura aún sin confirmar
        if (d.at > maxAt) maxAt = d.at;
        const key = d.id, r = m.rec[key], lu = r ? r.u : -1;
        if (typeof d.u !== 'number' || d.u <= lu) continue; // lo local es igual o más reciente
        if (typeof d.t !== 'string' || typeof key !== 'string' || !/^(profile|plan|e_.+|s_.+)$/.test(key)) continue;
        if (d.del) { if (key !== 'profile' && key !== 'plan') apply.push({ key: key, u: d.u, del: true }); continue; }
        let o; try { o = JSON.parse(d.d); } catch (e) { continue; }
        if (!validRecord(key, o)) continue;
        apply.push({ key: key, u: d.u, o: o });
      }
      if (apply.length) {
        this.applying = true;
        try {
          this.d.app.commit(S => { for (const a of apply) { if (a.del) removeRecord(S, a.key); else applyRecord(S, a.key, a.o); } });
          const cur = toRecords(this.d.app.state());
          for (const a of apply) { m.rec[a.key] = { u: a.u, h: a.del ? 'del' : hash(cur[a.key] || '') }; delete m.dirty[a.key]; }
        } finally { this.applying = false; }
      }
      if (!info.fromCache) { this.ready = true; this.err = null; if (maxAt > m.since) m.since = maxAt; m.last = this.now(); }
      this.saveMeta();
      if (Object.keys(m.dirty).length) this.schedule(200);
      this.status();
    }

    /* Envío de la cola */
    schedule(ms) { clearTimeout(this.timer); if (this.stopped) return; this.timer = setTimeout(() => this.flush(), ms); }
    async flush() {
      if (this.busy || this.stopped) return;
      if (!this.unsub) this.listen();
      this.diff();
      const m = this.meta, keys = Object.keys(m.dirty);
      if (!keys.length) { this.saveMeta(); this.status(); return; }
      this.busy = true; this.status();
      let failed = null;
      try {
        const cur = toRecords(this.d.app.state());
        for (const key of keys) {
          const r = m.rec[key]; if (!r) { delete m.dirty[key]; continue; }
          const payload = r.h === 'del' ? { t: typeOf(key), u: r.u, del: true } : { t: typeOf(key), d: cur[key], u: r.u };
          if (r.h !== 'del' && cur[key] == null) { delete m.dirty[key]; continue; }
          await withTimeout(this.d.remote.setRecord(this.d.uid, key, payload), 20000);
          if (m.rec[key] && m.rec[key].u === r.u) delete m.dirty[key];
        }
      } catch (e) { failed = e; }
      this.busy = false;
      if (failed) { this.setErr(failed); this.saveMeta(); return; }
      this.err = null; this.retryMs = RETRY_MIN; m.last = this.now(); this.saveMeta();
      if (Object.keys(m.dirty).length) this.schedule(DEBOUNCE);
      this.status();
    }
    setErr(e) {
      const code = e && e.code;
      this.err = { code: code || 'error', msg: (e && e.message) || '' };
      this.status();
      if (this.stopped) return;
      const wait = code === 'permission-denied' ? RETRY_MAX : this.retryMs;
      this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX);
      if (Object.keys(this.meta.dirty).length) this.schedule(wait);
    }
    syncNow() { this.retryMs = RETRY_MIN; this.err = null; this.status(); return this.flush(); }

    /* Estado para mostrar: { state, pending, last } */
    status() {
      const pending = Object.keys(this.meta.dirty).length;
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      let state;
      if (this.err && this.err.code === 'permission-denied') state = 'denied';
      else if (offline || (this.err && (this.err.code === 'unavailable' || this.err.code === 'failed-precondition'))) state = 'offline';
      else if (this.err) state = 'error';
      else if (this.busy) state = 'syncing';
      else if (pending) state = 'pending';
      else if (!this.ready) state = 'connecting';
      else state = 'ok';
      const s = { state: state, pending: pending, last: this.meta.last || 0 };
      const sig = state + '|' + pending + '|' + s.last;
      if (sig !== this.lastStatus) { this.lastStatus = sig; if (this.d.onStatus) this.d.onStatus(s); }
      this.current = s; return s;
    }
  }

  const api = { Engine: Engine, hash: hash, toRecords: toRecords, isDefault: isDefault, applyRecord: applyRecord, removeRecord: removeRecord, validRecord: validRecord, typeOf: typeOf };
  if (typeof module !== 'undefined') module.exports = api;
  root.HalterSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
