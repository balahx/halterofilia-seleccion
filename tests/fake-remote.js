/* Servidor simulado en el navegador, solo para pruebas automáticas (nunca se carga en la app real).
   Imita Auth + Firestore con las mismas reglas que firestore.rules y guarda su estado en localStorage,
   así sobrevive a recargas de página igual que una sesión real. */
(function () {
  const L = localStorage;
  const rd = () => JSON.parse(L.getItem('fake.srv') || '{"docs":{},"users":{},"n":0}');
  const wr = s => L.setItem('fake.srv', JSON.stringify(s));
  const watchers = [];
  const authCbs = [];
  const err = (code, message) => Object.assign(new Error(message || code), { code });
  const offline = () => L.getItem('fake.offline') === '1';
  const curUser = () => { const u = L.getItem('fake.cur'); return u ? JSON.parse(u) : null; };
  const isCoach = (s, uid) => !!(s.docs['config/team'] && s.docs['config/team'].coachUid === uid);
  const keysOnly = (o, ks) => Object.keys(o).every(k => ks.includes(k));

  /* Mismas condiciones que firestore.rules */
  function allowed(op, path, data, prev) {
    const u = curUser(), s = rd();
    if (!u) return false;
    const [col, id] = path.split('/'), coach = isCoach(s, u.uid), member = !!s.docs['members/' + u.uid];
    const ps = path.split('/');
    const wkDoc = (pid, wid) => s.docs['plans/' + pid + '/weeks/' + wid];
    if (col === 'users' && ps[2] === 'completions') {
      const owner = u.uid === id;
      if (op === 'get' || op === 'list') return coach || (owner && member);
      if (op !== 'create' || (prev && Object.keys(prev).length)) return false;   // solo se crea, nunca se reescribe
      const d = data || {}, a = s.docs['assignments/' + id], w = a && wkDoc(d.planId, d.weekId);
      return owner && member && keysOnly(d, ['planId', 'weekId', 'sessionIdx', 'completedAt']) && ['planId', 'weekId', 'sessionIdx', 'completedAt'].every(k => k in d)
        && Number.isInteger(d.sessionIdx) && d.sessionIdx >= 0 && !!a && a.planId === d.planId && a.weekId === d.weekId && !!w && d.sessionIdx < w.sessions.length
        && ps[3] === d.planId + '_' + d.weekId + '_' + d.sessionIdx;
    }
    if (col === 'assignments') {
      if (op === 'get') return coach || (u.uid === id && member);
      if (op === 'list') return coach;
      if (op === 'delete') return coach;
      const d = data || {}, w = wkDoc(d.planId, d.weekId);
      if (coach) {
        if (keysOnly(d, ['planId', 'weekId', 'week', 'stageId', 'weekEndsAt', 'setBy', 'at']) && ['planId', 'weekId', 'week', 'stageId', 'weekEndsAt', 'setBy', 'at'].every(k => k in d)
          && Number.isInteger(d.week) && typeof d.weekEndsAt === 'number' && d.setBy === u.uid && !!s.docs['members/' + id] && !!w && w.stageId === d.stageId && w.week === d.week) return true;
      }
      if (op === 'update' && u.uid === id && member) {   // el atleta solo avanza a la semana siguiente
        const cur = prev, cw = wkDoc(cur.planId, cur.weekId), nw = cw && cw.next ? wkDoc(cur.planId, cw.next) : null;
        const merged = Object.assign({}, cur, d), changed = Object.keys(merged).filter(k => JSON.stringify(cur[k]) !== JSON.stringify(merged[k]));
        const last = cw && (cw.kind === 'transition' || cw.sessions.length === 0 || !!s.docs['users/' + id + '/completions/' + cur.planId + '_' + cur.weekId + '_' + (cw.sessions.length - 1)]);
        return changed.every(k => ['weekId', 'week', 'stageId', 'weekEndsAt', 'at'].includes(k)) && !!nw && d.weekId === cw.next && d.week === nw.week && d.stageId === nw.stageId
          && Date.now() >= cur.weekEndsAt && d.weekEndsAt >= cur.weekEndsAt + 597600000 && d.weekEndsAt <= cur.weekEndsAt + 612000000 && !!last;
      }
      return false;
    }
    if (col === 'adjustments') {
      if (op === 'get' || op === 'list') return coach || (id.startsWith(u.uid + '_') && member);
      if (op === 'delete') return coach;
      return coach && keysOnly(data, ['pcts', 'at']) && data.pcts && typeof data.pcts === 'object' && Object.keys(data.pcts).length <= 400;
    }
    if (col === 'users') { // users/{uid}/records/{clave}
      const owner = u.uid === id;
      if (op === 'get' || op === 'list') return coach || (owner && member);
      if (op === 'delete') return false;
      const d = data || {}, key = path.split('/')[3] || '';
      return owner && (member || coach) && keysOnly(d, ['t', 'd', 'u', 'del', 'at']) && ['t', 'u', 'at'].every(k => k in d)
        && ['profile', 'plan', 'exercise', 'session'].includes(d.t) && typeof d.u === 'number' && d.u <= Date.now() + 600000
        && (!('d' in d) || (typeof d.d === 'string' && d.d.length <= 300000)) && (!('del' in d) || typeof d.del === 'boolean') && key.length <= 120;
    }
    if (col === 'config' && id === 'plan') {
      if (op === 'get' || op === 'list') return coach || member;
      if (op === 'delete') return coach;
      return coach && keysOnly(data, ['activePlanId', 'at']) && typeof data.activePlanId === 'string' && data.activePlanId.length > 0;
    }
    if (col === 'config') return op === 'get' || op === 'list';
    if (col === 'exercises' || col === 'plans') {
      if (op === 'get' || op === 'list') return coach || member;
      if (!coach) return false;
      if (op === 'delete') return true;
      const depth = path.split('/').length;
      if (col === 'exercises') return keysOnly(data, ['en', 'es', 'aliases']) && typeof data.en === 'string' && data.en.length > 0 && Array.isArray(data.aliases) && data.aliases.length <= 40;
      if (depth === 2) return keysOnly(data, ['name', 'year', 'format', 'stages', 'weeks', 'createdAt']) && typeof data.name === 'string' && data.name.length > 0;
      const hasNested = o => Array.isArray(o) ? o.some(x => Array.isArray(x) || hasNested(x)) : (o && typeof o === 'object' ? Object.keys(o).some(k => hasNested(o[k])) : false);
      if (hasNested(data)) return false;   // Firestore no admite listas dentro de listas
      return path.split('/')[2] === 'stages' ? keysOnly(data, ['name', 'order']) : (keysOnly(data, ['stageId', 'week', 'label', 'kind', 'notes', 'sessions', 'next']) && typeof data.next === 'string');
    }
    if (col === 'members') {
      if (op === 'get') return u.uid === id || coach;
      if (op === 'list') return coach;
      if (op === 'create' || op === 'update') return coach && keysOnly(data, ['name', 'email', 'approvedAt']) && typeof data.name === 'string' && data.name.length > 0 && data.name.length <= 60 && typeof data.email === 'string';
      if (op === 'delete') return coach;
    }
    if (col === 'requests') {
      if (op === 'get') return u.uid === id || coach;
      if (op === 'list') return coach;
      if (op === 'create') return u.uid === id && keysOnly(data, ['name', 'email', 'status', 'createdAt']) && Object.keys(data).length === 4 && typeof data.name === 'string' && data.name.length >= 2 && data.name.length <= 60 && data.email === u.email && data.status === 'pending';
      if (op === 'update') return coach && data.status === 'rejected' && Object.keys(data).every(k => k === 'status' || prev[k] === data[k]);
      if (op === 'delete') return u.uid === id || coach;
    }
    return false;
  }
  function emit() {
    const s = rd();
    watchers.slice().forEach(w => {
      if (offline()) { (w.col || w.rec) ? w.cb([], { fromCache: true }) : w.cb(null, { fromCache: true }); return; }
      if (w.rec) {
        if (!allowed('list', 'users/' + w.uid + '/records/x', null)) { w.err && w.err(err('permission-denied')); return; }
        const pre = 'users/' + w.uid + '/records/';
        w.cb(Object.keys(s.docs).filter(k => k.startsWith(pre) && s.docs[k].at >= w.since).map(k => Object.assign({ id: k.slice(pre.length) }, s.docs[k])), { fromCache: false });
      } else if (w.col) {
        if (!allowed('list', w.path + '/x', null)) { w.err && w.err(err('permission-denied')); return; }
        const got = Object.keys(s.docs).filter(k => k.startsWith(w.path + '/') && k.split('/').length === w.path.split('/').length + 1 && matches(s.docs[k], w.filters)).map(k => Object.assign({ id: k.split('/').pop() }, s.docs[k]));
        window.__fake.delivered[w.path] = got.map(x => x.id);   // qué documentos llegaron a esa lectura (para comprobar cuántas lecturas se piden)
        w.cb(got, { fromCache: false });
      } else {
        if (!allowed('get', w.path)) { w.err && w.err(err('permission-denied')); return; }
        w.cb(s.docs[w.path] ? Object.assign({}, s.docs[w.path]) : null, { fromCache: false });
      }
    });
  }
  const matches = (d, f) => !f || Object.keys(f).every(k => d[k] === f[k]);
  const later = f => setTimeout(f, 5);
  function mutate(op, path, data) {
    if (offline()) throw err('unavailable');
    const s = rd(), prev = s.docs[path] || {};
    if (!allowed(op, path, data, prev)) throw err('permission-denied');
    if (op === 'delete') delete s.docs[path]; else s.docs[path] = Object.assign({}, op === 'update' ? prev : {}, data);
    wr(s); later(emit);
  }
  function setUser(u) { if (u) L.setItem('fake.cur', JSON.stringify(u)); else L.removeItem('fake.cur'); later(() => authCbs.forEach(cb => cb(u))); }

  class FakeRemote {
    async init() { if (L.getItem('fake.sdkfail') === '1') throw err('sdk', 'no se pudo cargar el SDK'); }
    onAuth(cb) { authCbs.push(cb); later(() => cb(curUser())); return () => {}; }
    async signIn(email, pass) { const s = rd(), x = s.users[email]; if (!x || x.pass !== pass) throw err('auth/invalid-credential'); setUser({ uid: x.uid, email }); }
    async signUp(email, pass) {
      const s = rd(); if (pass.length < 6) throw err('auth/weak-password'); if (s.users[email]) throw err('auth/email-already-in-use');
      s.n++; const uid = 'uid' + s.n; s.users[email] = { uid, pass }; wr(s); setUser({ uid, email });
    }
    async resetPassword(email) { window.__fake.resets.push(email); }
    async signOut() { setUser(null); }
    watchDoc(path, cb, onErr) { const w = { path, cb, err: onErr }; watchers.push(w); later(emit); return () => { const i = watchers.indexOf(w); if (i >= 0) watchers.splice(i, 1); }; }
    async getCol(path, filters) {
      if (offline()) throw err('unavailable'); if (!allowed('list', path + '/x', null)) throw err('permission-denied');
      const s = rd(); window.__fake.reads = (window.__fake.reads || 0);
      return Object.keys(s.docs).filter(k => k.startsWith(path + '/') && k.split('/').length === path.split('/').length + 1 && matches(s.docs[k], filters)).map(k => Object.assign({ id: k.split('/').pop() }, s.docs[k]));
    }
    watchCol(path, cb, onErr, filters) { const w = { path, col: true, cb, err: onErr, filters }; watchers.push(w); later(emit); return () => { const i = watchers.indexOf(w); if (i >= 0) watchers.splice(i, 1); }; }
    watchRecords(uid, since, cb, onErr) { const w = { rec: true, uid, since: since || 0, cb, err: onErr }; watchers.push(w); later(emit); return () => { const i = watchers.indexOf(w); if (i >= 0) watchers.splice(i, 1); }; }
    async setRecord(uid, key, data) {
      window.__fake.writes.push(key);
      const at = Math.max(Date.now(), (window.__fake.lastAt || 0) + 1); window.__fake.lastAt = at;
      mutate('create', 'users/' + uid + '/records/' + key, Object.assign({}, data, { at }));
    }
    async createRequest(uid, name, email) { mutate('create', 'requests/' + uid, { name, email, status: 'pending', createdAt: Date.now() }); }
    async deleteRequest(uid) { mutate('delete', 'requests/' + uid); }
    async rejectRequest(uid) { mutate('update', 'requests/' + uid, { status: 'rejected' }); }
    async approve(uid, name, email) { mutate('create', 'members/' + uid, { name, email, approvedAt: Date.now() }); mutate('delete', 'requests/' + uid); }
    async removeMember(uid) { mutate('delete', 'members/' + uid); }
    async publishPlan(p) {
      const base = 'plans/' + p.planId;
      p.stages.forEach(x => mutate('create', base + '/stages/' + x.id, x.data));
      p.weeks.forEach(x => mutate('create', base + '/weeks/' + x.id, x.data));
      p.exercises.forEach(x => mutate('create', 'exercises/' + x.id, x.data));
      mutate('create', base, Object.assign({}, p.meta, { createdAt: Date.now() }));
    }
    async setActivePlan(id) { mutate('create', 'config/plan', { activePlanId: id, at: Date.now() }); }
    async getDoc(path) { if (offline()) throw err('unavailable'); if (!allowed('get', path)) throw err('permission-denied'); const d = rd().docs[path]; return d ? Object.assign({}, d) : null; }
    async setAssignment(uid, d) { mutate('create', 'assignments/' + uid, Object.assign({}, d, { at: Date.now() })); }
    async advanceAssignment(uid, d) { mutate('update', 'assignments/' + uid, Object.assign({}, d, { at: Date.now() })); }
    async setCompletion(uid, id, d) { window.__fake.completions.push(id); mutate('create', 'users/' + uid + '/completions/' + id, Object.assign({}, d, { completedAt: Date.now() })); }
    async setAdjust(id, pcts) { mutate('create', 'adjustments/' + id, { pcts, at: Date.now() }); }
    async deleteAdjust(id) { mutate('delete', 'adjustments/' + id); }
    async deletePlan(id, wasActive) {
      Object.keys(rd().docs).filter(k => k.startsWith('plans/' + id + '/')).forEach(k => mutate('delete', k));
      if (wasActive) mutate('delete', 'config/plan');
      mutate('delete', 'plans/' + id);
    }
  }
  window.HALTER_REMOTE_FACTORY = () => new FakeRemote();
  window.__fake = {
    resets: [], writes: [], completions: [], delivered: {},
    srv: rd,
    load(srv) { wr(srv); later(emit); }, // reemplaza el estado del servidor (para simular otro dispositivo que ve lo mismo)
    uid: email => rd().users[email] && rd().users[email].uid,
    admin(path, data) { const s = rd(); if (data === null) delete s.docs[path]; else s.docs[path] = data; wr(s); later(emit); }, // salta las reglas (como la consola de Firebase)
    setOffline(v) { L.setItem('fake.offline', v ? '1' : '0'); later(emit); },
    sdkFail(v) { L.setItem('fake.sdkfail', v ? '1' : '0'); }
  };
})();
