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
    const [col, id] = path.split('/'), coach = isCoach(s, u.uid);
    if (col === 'config') return op === 'get' || op === 'list';
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
      if (offline()) { w.col ? w.cb([], { fromCache: true }) : w.cb(null, { fromCache: true }); return; }
      if (w.col) {
        if (!allowed('list', w.path + '/x', null)) { w.err && w.err(err('permission-denied')); return; }
        w.cb(Object.keys(s.docs).filter(k => k.startsWith(w.path + '/')).map(k => Object.assign({ id: k.split('/')[1] }, s.docs[k])), { fromCache: false });
      } else {
        if (!allowed('get', w.path)) { w.err && w.err(err('permission-denied')); return; }
        w.cb(s.docs[w.path] ? Object.assign({}, s.docs[w.path]) : null, { fromCache: false });
      }
    });
  }
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
    watchCol(path, cb, onErr) { const w = { path, col: true, cb, err: onErr }; watchers.push(w); later(emit); return () => { const i = watchers.indexOf(w); if (i >= 0) watchers.splice(i, 1); }; }
    async createRequest(uid, name, email) { mutate('create', 'requests/' + uid, { name, email, status: 'pending', createdAt: Date.now() }); }
    async deleteRequest(uid) { mutate('delete', 'requests/' + uid); }
    async rejectRequest(uid) { mutate('update', 'requests/' + uid, { status: 'rejected' }); }
    async approve(uid, name, email) { mutate('create', 'members/' + uid, { name, email, approvedAt: Date.now() }); mutate('delete', 'requests/' + uid); }
    async removeMember(uid) { mutate('delete', 'members/' + uid); }
  }
  window.HALTER_REMOTE_FACTORY = () => new FakeRemote();
  window.__fake = {
    resets: [],
    srv: rd,
    uid: email => rd().users[email] && rd().users[email].uid,
    admin(path, data) { const s = rd(); if (data === null) delete s.docs[path]; else s.docs[path] = data; wr(s); later(emit); }, // salta las reglas (como la consola de Firebase)
    setOffline(v) { L.setItem('fake.offline', v ? '1' : '0'); later(emit); },
    sdkFail(v) { L.setItem('fake.sdkfail', v ? '1' : '0'); }
  };
})();
