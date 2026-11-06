/* Cuentas y acceso (fase 1): inicio de sesión con correo y contraseña, solicitud de acceso,
   aprobación por el entrenador y arranque de la app de entrenamiento.
   No usa Cloud Functions: todo se decide con las reglas de Firestore (firestore.rules).

   Firestore (colecciones de primer nivel):
     config/team        { coachUid }                       lo crea a mano el administrador, una sola vez
     members/{uid}      { name, email, approvedAt }        lo crea el entrenador al aprobar
     requests/{uid}     { name, email, status, createdAt } lo crea el atleta al pedir acceso
*/
(function () {
  'use strict';
  const FB_VERSION = '13.1.0'; // misma versión del SDK que usa la app de finanzas
  /* Lecturas económicas (reads.js). Todo es opcional: sin ese archivo la app lee como antes. */
  const RD = () => window.HalterReads || null;
  const inv = name => { try { const r = RD(); if (r) r.invalidate(name); } catch (e) { /* sin caché */ } };
  const invPlan = id => { try { const r = RD(); if (r) r.invalidatePlan(id); } catch (e) { /* sin caché */ } };
  const cnt = (path, n) => { try { const r = RD(); if (r) r.count(r.labelOf(path), n); } catch (e) { /* solo estadística */ } };
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = m => window.HalterApp.toast(m);
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } }
  };
  const K_LAST = 'halterofilia.lastAccess';       // último acceso aprobado en este dispositivo (para abrir sin conexión)
  const K_PRIV = 'halterofilia.privacySeen.';          // versión del aviso de privacidad que ya vio cada cuenta en este dispositivo
  const K_PRIVNEW = 'halterofilia.privacyNewAccount';  // cuenta recién creada: aceptó el aviso al crearla
  const K_SEX = 'halterofilia.signupSex';          // sexo elegido al crear la cuenta, hasta la primera vez que entra a la app
  const K_NAME = 'halterofilia.signupName';       // nombre escrito al crear la cuenta, hasta enviar la solicitud

  /* ---------- Mensajes de error (mismos que en finanzas) ---------- */
  function authErr(e) {
    const m = {
      'auth/invalid-credential': 'Correo o contraseña incorrectos', 'auth/wrong-password': 'Correo o contraseña incorrectos', 'auth/user-not-found': 'Correo o contraseña incorrectos',
      'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Prueba iniciar sesión.', 'auth/weak-password': 'La contraseña es muy débil (mínimo 6 caracteres)',
      'auth/invalid-email': 'El correo no es válido', 'auth/network-request-failed': 'Sin conexión. Revisa tu internet e inténtalo otra vez.',
      'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.', 'auth/operation-not-allowed': 'Falta activar “Correo y contraseña” en Firebase (ver LEEME.md)',
      'auth/unauthorized-domain': 'Esta dirección no está autorizada en Firebase (ver LEEME.md)'
    };
    return m[e && e.code] || `No se pudo completar (${(e && (e.code || e.message)) || 'error'})`;
  }
  function dataErr(e) {
    const c = e && e.code;
    if (c === 'permission-denied') return 'Firestore rechazó el acceso: faltan publicar las reglas de seguridad (ver LEEME.md)';
    if (c === 'unavailable' || c === 'failed-precondition') return 'Sin conexión con el servidor. Se reintentará solo.';
    return `No se pudo completar (${c || (e && e.message) || 'error'})`;
  }

  /* ---------- Adaptador de Firebase ---------- */
  class FirebaseRemote {
    constructor(config) { this.config = config; this.m = null; }
    async init() {
      if (this.m) return;
      const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
      const [app, auth, fs] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
      this.m = { app, auth, fs };
      this.app = app.initializeApp(this.config);
      this.auth = auth.getAuth(this.app);
      /* Caché local persistente (varias pestañas): al reabrir la app, Firestore reutiliza lo ya descargado en vez de volver a pedirlo.
         Si el navegador no la admite (navegación privada, almacenamiento bloqueado) se usa el modo anterior, sin caché entre aperturas. */
      try { this.db = fs.initializeFirestore(this.app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) }); }
      catch (e) { this.db = fs.getFirestore(this.app); }
    }
    onAuth(cb) { return this.m.auth.onAuthStateChanged(this.auth, u => cb(u ? { uid: u.uid, email: u.email, verified: !!u.emailVerified } : null)); }
    signIn(email, password) { return this.m.auth.signInWithEmailAndPassword(this.auth, email, password); }
    signUp(email, password) { return this.m.auth.createUserWithEmailAndPassword(this.auth, email, password); }
    resetPassword(email) { return this.m.auth.sendPasswordResetEmail(this.auth, email); }
    /* Verificación del correo (S2): se envía el enlace; luego se vuelve a leer la cuenta y a renovar el token para que las reglas vean email_verified */
    sendVerification() { return this.m.auth.sendEmailVerification(this.auth.currentUser); }
    async refreshUser() { const u = this.auth.currentUser; await u.reload(); if (u.emailVerified) await u.getIdToken(true); return !!u.emailVerified; }
    signOut() { const r = RD(); if (r) r.clear(); return this.m.auth.signOut(this.auth); }   // lo guardado en el dispositivo (plan, registros de atletas) no queda para la cuenta siguiente
    _doc(path) { return this.m.fs.doc(this.db, ...path.split('/')); }
    _plain(d) { // Timestamp → milisegundos
      const o = {};
      Object.keys(d).forEach(k => { const v = d[k]; o[k] = v && typeof v.toMillis === 'function' ? v.toMillis() : v; });
      return o;
    }
    /* Estadística de lecturas (solo cuenta; no cambia ningún dato). Primera respuesta del servidor = todos los documentos; después, solo los que cambian. */
    _tally(path, snap, st) {
      try {
        if (snap.metadata.fromCache) return;
        let n;
        if (typeof snap.docChanges === 'function') n = st.first ? Math.max(1, snap.size) : snap.docChanges().length;
        else { const s = JSON.stringify(snap.exists() ? snap.data() : null); n = (st.first || s !== st.last) ? 1 : 0; st.last = s; }
        st.first = false; cnt(path, n);
      } catch (e) { /* solo estadística */ }
    }
    watchDoc(path, cb, onErr) {
      const st = { first: true };
      return this.m.fs.onSnapshot(this._doc(path), { includeMetadataChanges: true },
        snap => { this._tally(path, snap, st); cb(snap.exists() ? this._plain(snap.data()) : null, { fromCache: snap.metadata.fromCache }); }, onErr);
    }
    /* Colección completa o, con `filters` ({ campo: valor }), solo los documentos que cumplen todas las igualdades
       (así se leen pocos documentos: p. ej. las sesiones cumplidas de una semana y no las de todo el año) */
    _col(path, filters) {
      const fs = this.m.fs, c = fs.collection(this.db, ...path.split('/'));
      return filters && Object.keys(filters).length ? fs.query(c, ...Object.keys(filters).map(k => fs.where(k, '==', filters[k]))) : c;
    }
    async getCol(path, filters) {
      const snap = await this.m.fs.getDocs(this._col(path, filters));
      cnt(path, Math.max(1, snap.size));
      return snap.docs.map(d => Object.assign({ id: d.id }, this._plain(d.data())));
    }
    watchCol(path, cb, onErr, filters) {
      const st = { first: true };
      return this.m.fs.onSnapshot(this._col(path, filters), { includeMetadataChanges: true },
        snap => { this._tally(path, snap, st); cb(snap.docs.map(d => Object.assign({ id: d.id }, this._plain(d.data()))), { fromCache: snap.metadata.fromCache }); }, onErr);
    }
    createRequest(uid, name, email) { return this.m.fs.setDoc(this._doc('requests/' + uid), { name, email, status: 'pending', createdAt: this.m.fs.serverTimestamp() }); }
    deleteRequest(uid) { return this.m.fs.deleteDoc(this._doc('requests/' + uid)); }
    rejectRequest(uid) { return this.m.fs.updateDoc(this._doc('requests/' + uid), { status: 'rejected' }); }
    approve(uid, name, email) {
      const { writeBatch, serverTimestamp } = this.m.fs, b = writeBatch(this.db);
      b.set(this._doc('members/' + uid), { name, email, approvedAt: serverTimestamp() });
      b.delete(this._doc('requests/' + uid));
      return b.commit().then(r => { inv('members'); return r; });
    }
    removeMember(uid) { return this.m.fs.deleteDoc(this._doc('members/' + uid)).then(r => { inv('members'); return r; }); }
    /* Datos propios (fase 2): users/{uid}/records. Solo se piden los registros que cambiaron desde `sinceMs` (hora del servidor). */
    watchRecords(uid, sinceMs, cb, onErr) {
      const fs = this.m.fs;
      const q = fs.query(fs.collection(this.db, 'users', uid, 'records'), fs.where('at', '>=', fs.Timestamp.fromMillis(sinceMs || 0)));
      const st = { first: true };
      return fs.onSnapshot(q, { includeMetadataChanges: true },
        snap => { this._tally('users/' + uid + '/records', snap, st); cb(snap.docs.map(d => Object.assign({ id: d.id }, this._plain(d.data()))), { fromCache: snap.metadata.fromCache }); }, onErr);
    }
    /* Registros de un atleta escritos desde `sinceMs` (hora del servidor), una sola vez. Lo usa el informe del entrenador (reads.js) */
    async getRecordsSince(uid, sinceMs) {
      const fs = this.m.fs, path = 'users/' + uid + '/records';
      const snap = await fs.getDocs(fs.query(fs.collection(this.db, 'users', uid, 'records'), fs.where('at', '>=', fs.Timestamp.fromMillis(sinceMs || 0))));
      cnt(path, Math.max(1, snap.size));
      return snap.docs.map(d => Object.assign({ id: d.id }, this._plain(d.data())));
    }
    setRecord(uid, key, data) { return this.m.fs.setDoc(this._doc('users/' + uid + '/records/' + key), Object.assign({}, data, { at: this.m.fs.serverTimestamp() })); }
    /* Plan anual (fase 3). Los documentos del plan se escriben primero y la ficha del plan al final,
       así un plan solo aparece en la lista cuando está completo. */
    async _commit(ops) {
      const { writeBatch } = this.m.fs;
      for (let i = 0; i < ops.length; i += 400) {
        const b = writeBatch(this.db);
        ops.slice(i, i + 400).forEach(o => { if (o.del) b.delete(o.ref); else if (o.merge) b.set(o.ref, o.data, { merge: true }); else b.set(o.ref, o.data); });
        await b.commit();
      }
    }
    async publishPlan(p) {
      const ops = [], base = 'plans/' + p.planId;
      p.stages.forEach(x => ops.push({ ref: this._doc(base + '/stages/' + x.id), data: x.data }));
      p.weeks.forEach(x => ops.push({ ref: this._doc(base + '/weeks/' + x.id), data: x.data }));
      p.exercises.forEach(x => ops.push({ ref: this._doc('exercises/' + x.id), data: x.data, merge: true }));
      await this._commit(ops);
      await this._commit([{ ref: this._doc(base), data: Object.assign({}, p.meta, { createdAt: this.m.fs.serverTimestamp() }) }]);
      invPlan(p.planId); inv('plans');   // el plan nuevo/actualizado se vuelve a bajar una vez (reads.js)
    }
    setBackupStamp(counts, reads) { return this.m.fs.setDoc(this._doc('config/backup'), { at: this.m.fs.serverTimestamp(), by: this.auth.currentUser.uid, counts: counts || {}, reads: reads || 0 }); }
    setActivePlan(id) { return this.m.fs.setDoc(this._doc('config/plan'), { activePlanId: id, at: this.m.fs.serverTimestamp() }); }
    /* Semana asignada (fase 4) */
    async getDoc(path) { const snap = await this.m.fs.getDoc(this._doc(path)); return snap.exists() ? this._plain(snap.data()) : null; }
    setAssignment(uid, d) { return this.m.fs.setDoc(this._doc('assignments/' + uid), Object.assign({}, d, { at: this.m.fs.serverTimestamp() })); }
    advanceAssignment(uid, d) { return this.m.fs.updateDoc(this._doc('assignments/' + uid), Object.assign({}, d, { at: this.m.fs.serverTimestamp() })); }
    setCompletion(uid, id, d) { return this.m.fs.setDoc(this._doc('users/' + uid + '/completions/' + id), Object.assign({}, d, { completedAt: this.m.fs.serverTimestamp() })); }
    deleteCompletion(uid, id) { return this.m.fs.deleteDoc(this._doc('users/' + uid + '/completions/' + id)); }
    setAdjust(id, pcts) { return this.m.fs.setDoc(this._doc('adjustments/' + id), { pcts: pcts, at: this.m.fs.serverTimestamp() }); }
    deleteAdjust(id) { return this.m.fs.deleteDoc(this._doc('adjustments/' + id)); }
    /* Rutinas especiales del entrenador para un atleta */
    setRoutine(id, d) { return this.m.fs.setDoc(this._doc('routines/' + id), Object.assign({}, d, { at: this.m.fs.serverTimestamp() })).then(r => { inv('routines'); return r; }); }
    deleteRoutine(id) { return this.m.fs.deleteDoc(this._doc('routines/' + id)).then(r => { inv('routines'); return r; }); }
    /* Competencias (4.10): las escribe solo el entrenador; la lista se renueva en reads.js */
    setCompetition(id, d) { return this.m.fs.setDoc(this._doc('competitions/' + id), Object.assign({}, d, { at: this.m.fs.serverTimestamp() })).then(r => { inv('competitions'); return r; }); }
    deleteCompetition(id) { return this.m.fs.deleteDoc(this._doc('competitions/' + id)).then(r => { inv('competitions'); return r; }); }
    async deletePlan(id, wasActive) {
      const { getDocs, collection } = this.m.fs, ops = [];
      for (const sub of ['weeks', 'stages']) { const snap = await getDocs(collection(this.db, 'plans', id, sub)); snap.forEach(d => ops.push({ ref: d.ref, del: true })); }
      if (wasActive) ops.push({ ref: this._doc('config/plan'), del: true });
      ops.push({ ref: this._doc('plans/' + id), del: true });
      await this._commit(ops);
      invPlan(id); inv('plans');
    }
  }

  /* ---------- Estado ---------- */
  const C = {
    remote: null, user: null,
    skew: 0,              // desvío del reloj del dispositivo respecto del servidor (ms; 0 = sin corrección)
    phase: 'loading',     // loading | nocfg | failed | signedout | resolving | norequest | pending | rejected | noteam | active
    mode: 'login',        // login | signup | reset (pantalla de ingreso)
    role: null,           // coach | athlete
    name: '',
    team: undefined, member: undefined, request: undefined,   // undefined = aún sin respuesta
    defin: { team: false, member: false, request: false },    // respuesta confirmada por el servidor
    members: [], requests: [], colReady: false,
    unsub: [], appRunning: false, err: '', busy: false, confirm: null, offlineCache: false,
    sync: null            // motor de sincronización de los datos propios (sync.js)
  };

  /* ---------- Sincronización de datos propios ---------- */
  function syncText(s) {
    if (!s) return 'Sin iniciar';
    const ago = s.last ? new Date(s.last).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '';
    switch (s.state) {
      case 'ok': return 'Al día' + (ago ? ' · ' + ago : '');
      case 'syncing': return 'Sincronizando…';
      case 'pending': return s.pending + (s.pending === 1 ? ' cambio por enviar' : ' cambios por enviar');
      case 'offline': return 'Sin conexión' + (s.pending ? ' · ' + s.pending + ' por enviar' : '');
      case 'denied': return 'Sin permiso: faltan las reglas de Firestore';
      case 'error': return 'No se pudo sincronizar. Se reintentará solo.';
      default: return 'Conectando…';
    }
  }
  /* Franja de estado de la nube bajo la cabecera: solo aparece cuando hay un problema (sin conexión, sin permiso, error). */
  function netBarHTML(s) {
    if (!s) return '';
    const st = s.state, pend = s.pending ? ' ' + s.pending + (s.pending === 1 ? ' cambio espera' : ' cambios esperan') + ' para enviarse.' : '';
    if (st === 'offline') return ['Sin conexión', 'Sigues registrando: todo se guarda en este dispositivo y se envía al volver la señal.' + pend, true];
    if (st === 'denied') return ['Sin permiso en la nube', 'Faltan las reglas de Firestore: avisa al entrenador. Tus datos siguen guardados aquí.', false];
    if (st === 'error') return ['No se pudo sincronizar', 'Se reintentará solo.' + pend, true];
    return '';
  }
  function paintNet(s) {
    const el = document.getElementById('netBar'); if (!el) return;
    const b = netBarHTML(s || (C.sync && C.sync.current));
    if (!b) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = '<span class="netbar-ic">' + window.HalterApp.icon('warn') + '</span><div><b>' + esc(b[0]) + '</b><span>' + esc(b[1]) + '</span></div>' + (b[2] ? '<button class="lnk" data-act="sync-now">Reintentar</button>' : '');
  }
  function paintSync(s) { const t = syncText(s || (C.sync && C.sync.current)); document.querySelectorAll('#syncStat, [data-sync]').forEach(el => { el.textContent = t; }); paintNet(s); }
  /* D3 · Corrección del reloj: se mide contra la cabecera Date del servidor de la app (la misma de version.js); sin conexión o sin cabecera, no se corrige */
  async function measureSkew() {
    try {
      const t0 = Date.now(), r = await fetch('version.js?t=' + t0 + '&clock=1', { method: 'HEAD', cache: 'no-store' }), t1 = Date.now(), d = r.headers.get('Date');
      if (r.ok && d && window.HalterSync) C.skew = window.HalterSync.usableSkew(window.HalterSync.clockSkew(d, t0, t1));
    } catch (e) { /* sin conexión: se mantiene la última medición */ }
  }
  window.addEventListener('online', () => { if (C.sync) measureSkew(); });
  function startSync(fresh) {
    stopSync();
    if (!C.remote || typeof C.remote.watchRecords !== 'function' || !window.HalterSync || !C.user) return;
    C.sync = new window.HalterSync.Engine({ remote: C.remote, uid: C.user.uid, app: window.HalterApp, store: LS, onStatus: paintSync, now: () => Date.now() + (C.skew || 0) });
    const eng = C.sync;   // el motor arranca después de medir el reloj (máx. 2,5 s) para que los primeros cambios ya lleven la hora corregida
    Promise.race([measureSkew(), new Promise(r => setTimeout(r, 2500))]).then(() => { if (C.sync === eng) eng.start({ fresh: fresh }); });
  }
  function stopSync() { if (C.sync) { C.sync.stop(); C.sync = null; } const nb = document.getElementById('netBar'); if (nb) { nb.hidden = true; nb.innerHTML = ''; } }

  /* ---------- Pantallas de ingreso ---------- */
  const gate = () => $('#gate');
  const brand = '<div class="hero"><i class="mk" role="img" aria-label="Logo WL"></i><div class="wl">WL</div><div class="sl">SELECCIÓN</div><div class="mt">La fuerza de la disciplina</div></div>';
  function field(id, label, type, extra) { return `<label class="lab" for="${id}">${label}</label><input class="txt" id="${id}" name="${id}" type="${type}" ${extra || ''}>`; }
  function authForm() {
    const m = C.mode;
    const t = { login: ['Iniciar sesión', 'Entra con tu correo y contraseña.', 'Entrar'], signup: ['Crear cuenta', 'Crea tu cuenta y pide acceso. El entrenador debe aprobarte para que puedas usar la app.', 'Crear cuenta y pedir acceso'], reset: ['Restablecer contraseña', 'Te enviaremos un correo con un enlace para elegir una contraseña nueva.', 'Enviar correo'] }[m];
    let f = '';
    if (m === 'signup') f += field('gName', 'Nombre y apellido', 'text', 'autocomplete="name" maxlength="60" required placeholder="Ej. Camila Soto"');
    if (m === 'signup') f += '<label class="lab" for="gSex">Sexo (define tu categoría de peso)</label><select class="txt" id="gSex" name="gSex" required><option value="">Elige una opción</option><option value="F">Femenino</option><option value="M">Masculino</option></select>';
    f += field('gEmail', 'Correo electrónico', 'email', 'autocomplete="username" required placeholder="tu@correo.com" inputmode="email"');
    if (m !== 'reset') f += field('gPass', m === 'signup' ? 'Contraseña (mínimo 6 caracteres)' : 'Contraseña', 'password', `autocomplete="${m === 'signup' ? 'new-password' : 'current-password'}" required`);
    if (m === 'signup') f += field('gPass2', 'Repite la contraseña', 'password', 'autocomplete="new-password" required');
    if (m === 'signup' && window.HalterPrivacy) f += window.HalterPrivacy.html(false) + '<label class="chk"><input type="checkbox" id="gPriv"> <span>He leído el aviso de privacidad y acepto que mis datos se guarden así.</span></label>';
    const alt = m === 'login' ? '<button type="button" class="lnk" data-g="mode" data-v="signup">Crear cuenta</button><button type="button" class="lnk" data-g="mode" data-v="reset">Olvidé mi contraseña</button>'
      : '<button type="button" class="lnk" data-g="mode" data-v="login">Ya tengo cuenta: iniciar sesión</button>';
    return `<h1>${t[0]}</h1><p class="lead">${t[1]}</p><form id="gForm" data-g-form="${m}" novalidate>${f}<p id="gErr" class="form-error" role="alert">${esc(C.err)}</p>` +
      `<div class="stack"><button class="btn" type="submit"${C.busy ? ' disabled' : ''}>${C.busy ? 'Un momento…' : t[2]}</button></div></form><div class="alt">${alt}</div>` +
      (m !== 'signup' && window.HalterPrivacy ? window.HalterPrivacy.html(false) : '');
  }
  function msgView(icon, title, body, actions) {
    const ico = { mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7.5l8 6 8-6"/>', warn: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.5M12 17.2v.1"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', ban: '<circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/>', cloud: '<path d="M7 18a4 4 0 010-8 5 5 0 019.6-1A4.5 4.5 0 0117 18z"/>', user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6"/>' }[icon];
    return `<div class="big-ico${icon === 'warn' ? ' is-warn' : ''}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ico}</svg></div><h1>${title}</h1>${body}<div class="stack">${actions || ''}</div>`;
  }
  const accountLine = () => `<p class="muted">Sesión: <b>${esc(C.user ? C.user.email : '')}</b></p>`;
  const outBtn = '<button class="lnk" data-g="logout">Cerrar sesión</button>';
  function gateHTML() {
    switch (C.phase) {
      case 'loading': return msgView('cloud', 'Conectando…', '<p class="lead">Un momento.</p>');
      case 'nocfg': return msgView('warn', 'Falta la configuración', '<p class="lead">No se encontró la configuración de Firebase (<b>firebase-config.js</b>). Revisa el archivo LEEME.md.</p>');
      case 'failed': return msgView('warn', 'Sin conexión', `<p class="lead">No se pudo cargar el servicio de cuentas (${esc(C.err || 'sin conexión')}). Revisa tu internet.</p>`, '<button class="btn" data-g="retry">Reintentar</button>');
      case 'signedout': return authForm();
      case 'resolving': return msgView('cloud', 'Comprobando tu acceso…', accountLine() + (C.err ? `<div class="note warn">${esc(C.err)}</div>` : ''), (C.err ? '<button class="btn" data-g="rewatch">Reintentar</button>' : '') + outBtn);
      case 'verify': return msgView('mail', 'Verifica tu correo', `<p class="lead">Te enviamos un enlace a</p><p class="mail-chip"><b>${esc(C.user ? C.user.email : '')}</b></p><ol class="vsteps"><li>Abre el correo (revisa también el spam o promociones).</li><li>Toca el enlace del mensaje.</li><li>Vuelve aquí y toca «Ya verifiqué mi correo».</li></ol><p class="muted">Así comprobamos que el correo es tuyo antes de pedir acceso al equipo.</p>${C.err ? `<div class="note warn" role="alert">${esc(C.err)}</div>` : ''}${C.info ? `<p class="muted" role="status">${esc(C.info)}</p>` : ''}`,
        `<button class="btn" data-g="verified"${C.busy ? ' disabled' : ''}>${C.busy ? 'Comprobando…' : 'Ya verifiqué mi correo'}</button><button class="btn ghost" data-g="resend"${C.busy ? ' disabled' : ''}>Reenviar el correo</button>` + outBtn);
      case 'norequest': return `<h1>Pide acceso al equipo</h1><p class="lead">Tu cuenta está creada. Para usar la app, el entrenador debe aprobarte.</p>${accountLine()}<form id="gForm" data-g-form="request" novalidate>${field('gName', 'Nombre y apellido', 'text', `autocomplete="name" maxlength="60" required value="${esc(LS.get(K_NAME) || C.prefill || '')}" placeholder="Ej. Camila Soto"`)}<p id="gErr" class="form-error" role="alert">${esc(C.err)}</p><div class="stack"><button class="btn" type="submit"${C.busy ? ' disabled' : ''}>${C.busy ? 'Enviando…' : 'Enviar solicitud'}</button></div></form><div class="alt">${outBtn}</div>`;
      case 'pending': return msgView('clock', 'Solicitud enviada', `<p class="lead">Tu entrenador debe aprobar tu acceso. Esta pantalla se actualiza sola cuando lo haga; puedes cerrarla y volver más tarde.</p>${accountLine()}`, outBtn) + (C.team === null && C.defin.team ? '<div class="note" style="margin-top:14px">El entrenador aún no está registrado como administrador del equipo en el sistema. Avísale a quien configuró la app.</div>' : '');
      case 'rejected': return msgView('ban', 'Solicitud no aprobada', `<p class="lead">El entrenador no aprobó tu solicitud. Si fue un error, habla con él y vuelve a pedir acceso.</p>${accountLine()}`, '<button class="btn" data-g="rerequest">Volver a pedir acceso</button>' + outBtn);
      case 'noteam': return msgView('user', 'Equipo sin configurar', `<p class="lead">Todavía no hay un entrenador configurado en el sistema.</p>${accountLine()}`, outBtn);
      default: return '';
    }
  }
  let lastKey = '';
  function showGate(force) {
    const g = gate(), key = C.phase + '|' + C.mode + '|' + C.err + '|' + (C.info || '') + '|' + C.busy + '|' + (C.team === null && C.defin.team);
    document.getElementById('appRoot').hidden = true;
    g.hidden = false;
    if (!force && key === lastKey) return;
    lastKey = key;
    g.innerHTML = brand + gateHTML();
  }
  /* Errores y botón ocupado se actualizan sin volver a dibujar (así no se borran los campos escritos) */
  function setForm(err, busy, label) {
    C.err = err || ''; C.busy = !!busy;
    const e = document.getElementById('gErr'), b = document.querySelector('#gForm button[type="submit"]');
    if (e) e.textContent = C.err;
    if (b) { b.disabled = C.busy; if (label) b.textContent = label; }
    lastKey = '';
  }
  function hideGate() { gate().hidden = true; lastKey = ''; document.getElementById('appRoot').hidden = false; }

  /* ---------- Acceso ---------- */
  function unwatch() { C.unsub.forEach(u => { try { u(); } catch (e) { /* ya cerrado */ } }); C.unsub = []; C.live = null; }
  function resetAccess() { C.team = C.member = C.request = undefined; C.defin = { team: false, member: false, request: false }; C.members = []; C.requests = []; C.colReady = false; C.role = null; }
  function watchAccess(user) {
    unwatch(); resetAccess();
    const r = C.remote, uid = user.uid;
    const upd = (key, val, meta) => { if (meta.fromCache && val === null) { evaluate(); return; } /* «no existe» solo vale si lo dice el servidor */ C[key] = val; if (!meta.fromCache) { C.defin[key] = true; C.err = ''; } evaluate(); };
    const bad = e => { C.err = dataErr(e); evaluate(true); };
    C.unsub.push(r.watchDoc('config/team', (d, m) => upd('team', d, m), bad));
    C.unsub.push(r.watchDoc('members/' + uid, (d, m) => upd('member', d, m), bad));
    C.unsub.push(r.watchDoc('requests/' + uid, (d, m) => upd('request', d, m), bad));
  }
  function watchCoachLists() {
    const r = C.remote;
    C.unsub.push(r.watchDoc('config/backup', (d, m) => { if (window.HalterBackup && !(m.fromCache && d === null)) { window.HalterBackup.setStamp(d); window.HalterApp.render(); } }, () => { /* sin permiso o sin datos: no se muestra la fecha */ }));
    C.unsub.push(r.watchCol('requests', (list) => {
      const prev = C.requests.filter(x => x.status !== 'rejected').length, fresh = list.filter(x => x.status !== 'rejected');
      const grew = C.colReady && fresh.length > prev;
      C.requests = list; C.colReady = true; window.HalterApp.render();
      if (grew) toast('Nueva solicitud de acceso en «Equipo»');
    }, e => { C.err = dataErr(e); }));
    const RDm = RD();   // con reads.js: miembros, planes y catálogo se leen una vez y se reutilizan (se renuevan al cambiar algo desde la app o pasados 10 min)
    if (RDm) C.unsub.push(RDm.feed('members', { ttl: 10 * 60000, fetch: () => r.getCol('members'), cb: list => { C.members = list; window.HalterApp.render(); }, err: e => { C.err = dataErr(e); } }));
    else C.unsub.push(r.watchCol('members', list => { C.members = list; window.HalterApp.render(); }, e => { C.err = dataErr(e); }));
    if (window.HalterPlan) {
      const HP = window.HalterPlan;
      if (RDm) {
        C.unsub.push(RDm.feed('plans', { ttl: 10 * 60000, fetch: () => r.getCol('plans'), cb: list => { HP.setPlans(list); window.HalterApp.render(); }, err: e => { HP.state.err = dataErr(e); HP.setPlans([]); window.HalterApp.render(); } }));
        C.unsub.push(RDm.feedCatalog(r, () => HP.state.active, list => { HP.setExercises(list); }, () => { /* el catálogo es opcional */ }));
      } else {
        C.unsub.push(r.watchCol('plans', list => { HP.setPlans(list); window.HalterApp.render(); }, e => { HP.state.err = dataErr(e); HP.setPlans([]); window.HalterApp.render(); }));
        C.unsub.push(r.watchCol('exercises', list => { HP.setExercises(list); }, () => { /* el catálogo es opcional */ }));
      }
      C.unsub.push(r.watchDoc('config/plan', d => { HP.setActive(d); if (RDm) RDm.poke('catalog'); window.HalterApp.render(); }, () => { /* sin plan activo */ }));
    }
  }
  function decide() { // devuelve { role, definitive } o { phase }
    const uid = C.user.uid;
    if (C.team && C.team.coachUid === uid) return { role: 'coach' };
    if (C.member) return { role: 'athlete' };
    // Respuestas negativas solo valen si vienen del servidor (no de una caché vacía sin conexión)
    if (!C.defin.team || !C.defin.member || !C.defin.request) return { wait: true };
    if (C.request) return { phase: C.request.status === 'rejected' ? 'rejected' : 'pending' };
    if (!C.user.verified) return { phase: 'verify' };
    return { phase: 'norequest' };
  }
  function evaluate(errored) {
    if (!C.user) return;
    const d = decide();
    if (d.role) {
      const name = d.role === 'coach' ? (C.request && C.request.name) || (C.member && C.member.name) || (readLast() && readLast().uid === C.user.uid && readLast().name) || nameFromEmail() : C.member.name;
      activate(d.role, name);
      // El entrenador no necesita solicitud: si la creó al registrarse, se borra para no aparecer en su propia lista
      if (d.role === 'coach' && C.request && C.defin.request) { const rq = C.request; C.request = null; C.remote.deleteRequest(C.user.uid).catch(() => { C.request = rq; }); }
      return;
    }
    if (d.wait) {
      // Sin respuesta del servidor: si este dispositivo ya tuvo acceso aprobado, se sigue usando (modo sin conexión)
      const last = readLast();
      if (last && last.uid === C.user.uid && !C.appRunning) { activate(last.role, last.name, true); return; }
      if (C.appRunning) return;
      C.phase = 'resolving'; showGate(); return;
    }
    // Si había acceso y el servidor confirma que ya no existe, se retira
    if (C.appRunning) { deactivate(); }
    C.phase = d.phase;
    if (d.phase === 'norequest' && LS.get(K_NAME) && !C.autoSent) { C.autoSent = true; sendRequest(LS.get(K_NAME)); return; }
    showGate();
  }
  const nameFromEmail = () => (C.user.email || '').split('@')[0];
  function readLast() { try { return JSON.parse(LS.get(K_LAST) || 'null'); } catch (e) { return null; } }

  /* Quien ya usaba la app y no ha visto la versión actual del aviso de privacidad recibe un aviso (una vez) */
  function noticePrivacy() {
    if (!window.HalterPrivacy || !C.user) return;
    const k = K_PRIV + C.user.uid;
    if (LS.get(k) === window.HalterPrivacy.VERSION) return;
    const mine = LS.get(K_PRIVNEW); LS.set(k, window.HalterPrivacy.VERSION); LS.del(K_PRIVNEW);
    if (!mine) setTimeout(() => toast('Publicamos el aviso de privacidad: lo encuentras en Ajustes → Cuenta.'), 1500);
  }

  /* Sexo elegido al crear la cuenta: solo vale para esa misma cuenta (por correo) */
  const sexMap = () => { try { const o = JSON.parse(LS.get(K_SEX) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };
  const sexSet = (email, v) => { const o = sexMap(), k = String(email || '').toLowerCase(); if (v) o[k] = v; else delete o[k]; if (Object.keys(o).length) LS.set(K_SEX, JSON.stringify(o)); else LS.del(K_SEX); };
  function pendingSex() { const v = C.user ? sexMap()[String(C.user.email || '').toLowerCase()] : null; return v === 'F' || v === 'M' ? v : null; }
  /* ---------- Arranque de la app ---------- */
  function activate(role, name, offline) {
    const changed = !C.appRunning || C.role !== role;
    C.role = role; C.name = name || C.name; C.phase = 'active'; C.offlineCache = !!offline;
    if (!offline) LS.set(K_LAST, JSON.stringify({ uid: C.user.uid, email: C.user.email, role: role, name: C.name }));
    if (!changed) { if (!offline) startLive(); window.HalterApp.render(); return; }
    noticePrivacy();
    C.appRunning = true; LS.del(K_NAME); initPlanUI(); initAssignUI(); initBackupUI(); initCompareUI(); initCompUI();
    hideGate();
    const fresh = window.HalterApp.start({
      cloud: true, requireSex: role !== 'coach', sex: role !== 'coach' ? pendingSex() : null, storageKey: 'halterofilia.v1.' + C.user.uid, name: C.name,
      tabs: role === 'coach' ? [{ id: 'equipo', label: 'Equipo', icon: 'team', render: teamView, badge: () => C.requests.filter(x => x.status !== 'rejected').length }].concat(window.HalterCompare ? [{ id: 'marcas', label: 'Marcas', icon: 'prog', render: window.HalterCompare.view }] : []).concat(window.HalterPlan ? [{ id: 'planual', label: 'Planes', icon: 'plan', render: window.HalterPlan.view }] : []).concat(window.HalterAssign ? [{ id: 'semana', label: 'Mi semana', icon: 'semana', render: window.HalterAssign.athleteView }] : []).concat(compTab())
        : (window.HalterAssign ? [{ id: 'semana', label: 'Semana', icon: 'semana', render: window.HalterAssign.athleteView }] : []).concat(compTab()),
      nav: role === 'coach' ? [['equipo'], ['planual'], ['semana', 'Mi semana'], ['hoy', 'Mi sesión'], ['mas']] : [['hoy'], ['semana'], ['prog'], ['max'], ['mas']],
      replaceDays: () => (window.HalterAssign ? window.HalterAssign.replaceDays() : null),
      more: moreInfo, hoyHTML: () => (window.HalterComp ? window.HalterComp.nextCardHTML() : '') + (window.HalterAssign ? window.HalterAssign.todayHTML() : ''),
      accountHTML: accountHTML, onAct: onAct, onSave: () => { if (C.sync) C.sync.onSave(); },
      onFinish: s => { if (window.HalterAssign) window.HalterAssign.onFinish(s); },
      onDelete: s => { if (window.HalterAssign) window.HalterAssign.onDelete(s); }
    });
    if (role !== 'coach' && pendingSex()) sexSet(C.user.email, null);
    startSync(fresh);
    if (offline) { if (window.HalterAssign && role !== 'coach') window.HalterAssign.startAthlete(C.user.uid, true); }   // solo la copia guardada de la semana
    else startLive();
  }
  /* Listas y datos en vivo (atletas, planes, semana asignada). La app instalada abre con el último acceso guardado
     (offline = true) y el servidor responde después: en ese momento hay que empezar a escucharlos. */
  function startLive() {
    const key = C.user.uid + '|' + C.role;
    if (C.live === key) return;
    C.live = key;
    if (C.role === 'coach') watchCoachLists();
    if (window.HalterAssign) { if (C.role === 'coach') window.HalterAssign.startCoach(C.user.uid); else window.HalterAssign.startAthlete(C.user.uid, false); }
    if (window.HalterComp) C.unsub.push(window.HalterComp.start());
  }
  let planInit = false;
  function initPlanUI() {
    if (planInit || !window.HalterPlan) return; planInit = true;
    window.HalterPlan.init({ remote: () => C.remote, toast: toast, render: () => window.HalterApp.render(), err: dataErr });
  }
  let assignInit = false;
  function initAssignUI() {
    if (assignInit || !window.HalterAssign) return; assignInit = true;
    window.HalterAssign.init({ remote: () => C.remote, toast: toast, render: () => window.HalterApp.render(), err: dataErr, members: () => C.members });
  }
  let compareInit = false;
  function initCompareUI() {
    if (compareInit || !window.HalterCompare) return; compareInit = true;
    window.HalterCompare.init({ remote: () => C.remote, toast: toast, render: () => window.HalterApp.render(), err: dataErr, members: () => C.members });
  }
  let compInit = false;
  function initCompUI() {
    if (compInit || !window.HalterComp) return; compInit = true;
    window.HalterComp.init({ remote: () => C.remote, toast: toast, render: () => window.HalterApp.render(), err: dataErr, members: () => C.members, role: () => C.role, uid: () => (C.user ? C.user.uid : '') });
  }
  const compTab = () => window.HalterComp ? [{ id: 'competencias', label: 'Competencias', icon: 'trophy', render: window.HalterComp.view }] : [];
  let backupInit = false;
  function initBackupUI() {
    if (backupInit || !window.HalterBackup) return; backupInit = true;
    window.HalterBackup.init({ remote: () => C.remote, toast: toast, render: () => window.HalterApp.render(), err: dataErr, who: () => (C.user && C.user.email) || '' });
  }
  function deactivate() {
    stopSync(); if (window.HalterAssign) window.HalterAssign.reset(); if (window.HalterBackup) window.HalterBackup.reset(); if (window.HalterCompare) window.HalterCompare.reset(); if (window.HalterComp) window.HalterComp.reset(); window.HalterApp.stop(); C.appRunning = false; C.role = null; LS.del(K_LAST);
  }

  /* Datos de la pantalla «Más» (el resto lo arma app.js) */
  function moreInfo() {
    const coach = C.role === 'coach';
    const o = { coach: coach, logout: true, sync: () => syncText(C.sync && C.sync.current) };
    const cp = window.HalterComp ? { ico: 'trophy', t: 'Competencias', s: window.HalterComp.moreText(), tab: 'competencias' } : null;
    if (!coach && cp) o.team = [cp];
    if (coach) {
      const pend = C.requests.filter(x => x.status !== 'rejected').length;
      o.name = C.name || (C.user && C.user.email) || 'Entrenador';
      o.sub = 'Entrenador · ' + C.members.length + (C.members.length === 1 ? ' atleta aprobado' : ' atletas aprobados');
      o.chip = 'Entrenador';
      o.team = [{ ico: 'cloud', t: 'Descargar respaldo del equipo', s: 'Archivo con todos los datos · guárdalo en un lugar privado', act: 'bk-run' },
        { ico: 'prog', t: 'Marcas del equipo', s: 'Comparar atletas por categoría de peso', tab: 'marcas' }].concat(cp ? [cp] : []).concat([
        { ico: 'team', t: 'Solicitudes de acceso', s: pend ? pend + (pend === 1 ? ' nueva' : ' nuevas') : 'Sin solicitudes nuevas', tab: 'equipo', chip: pend ? String(pend) : '' }]);
    }
    return o;
  }

  /* ---------- Contenido propio dentro de la app ---------- */
  function accountHTML() {
    return `<p class="eyebrow">Cuenta</p><div class="acct"><div class="kv"><span>Correo</span><b>${esc(C.user ? C.user.email : '')}</b></div><div class="kv"><span>Rol</span><b>${C.role === 'coach' ? 'Entrenador' : 'Atleta'}</b></div>` +
      (C.offlineCache ? '<div class="kv"><span>Estado</span><b><span class="badge warn">Sin confirmar con el servidor</span></b></div>' : '') +
      `<div class="kv"><span>Datos en la nube</span><b id="syncStat">${esc(syncText(C.sync && C.sync.current))}</b></div>` +
      '</div><div class="row-end"><button class="lnk" data-act="sync-now">Sincronizar ahora</button><button class="lnk" data-act="cl-logout">Cerrar sesión</button></div>' +
      (window.HalterPrivacy ? window.HalterPrivacy.html(false) : '');
  }
  const when = ms => ms ? new Date(ms).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }) : '';
  const ini = n => { const p = String(n || '').trim().split(/\s+/).filter(Boolean); return p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() : '?'; };
  const av = n => `<span class="av sm" aria-hidden="true">${esc(ini(n))}</span>`;
  function personRow(p, acts) { return `<div class="person"><div class="who-row">${av(p.name)}<div><b>${esc(p.name || '(sin nombre)')}</b><small>${esc(p.email || '')}${p.createdAt || p.approvedAt ? ' · ' + when(p.createdAt || p.approvedAt) : ''}</small></div></div><div class="acts">${acts}</div></div>`; }
  function teamView() {
    const pend = C.requests.filter(x => x.status !== 'rejected').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const rej = C.requests.filter(x => x.status === 'rejected');
    const mem = C.members.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
    const cf = (key, id, txt, ok) => `<button class="btn ${ok ? '' : 'ghost'} sm" data-act="${key}" data-uid="${esc(id)}">${C.confirm === key + id ? 'Confirmar' : txt}</button>`;
    if (window.HalterAssign && window.HalterAssign.selected()) return window.HalterAssign.detail();
    let h = '<h1>Equipo</h1>';
    if (C.err) h += window.HalterApp.errorBox(C.err, { retry: 'sync-now' });
    h += `<div class="card sec"><span class="eyebrow">Solicitudes pendientes (${pend.length})</span>`;
    h += pend.length ? pend.map(p => personRow(p, `<button class="btn sm" data-act="eq-approve" data-uid="${esc(p.id)}">Aprobar</button>` + cf('eq-reject', p.id, 'Rechazar'))).join('') : window.HalterApp.empty('check', 'Sin solicitudes pendientes', '');
    h += '</div>';
    const HA = window.HalterAssign;
    const stale = HA ? HA.stale(mem.map(x => x.id)) : [];
    if (stale.length) h += window.HalterApp.errorBox((stale.length === 1 ? 'Este atleta tiene' : 'Estos atletas tienen') + ' una semana asignada que ya no existe en el plan activo y no ven su semana: ' + stale.map(id => { const m = mem.find(x => x.id === id); return (m && m.name) || '(sin nombre)'; }).join(', ') + '. Asígnales una semana de nuevo con el botón «Semana».', { title: 'Semanas que ya no existen' });
    h += `<div class="card sec"><span class="eyebrow">Atletas aprobados (${mem.length})</span>`;
    h += mem.length ? mem.map(p => `<div class="person"><div class="who-row">${av(p.name)}<div><b>${esc(p.name || '(sin nombre)')}</b><small>${esc(p.email || '')}</small>${HA ? `<small class="asg${HA.isStale(p.id) ? ' warn' : ''}">${esc(HA.summary(p.id))}</small>` : ''}</div></div><div class="acts">` +
      (HA ? `<button class="btn sm" data-act="as-open" data-uid="${esc(p.id)}">Semana</button>` : '') + cf('eq-remove', p.id, 'Quitar acceso') + '</div></div>').join('') : window.HalterApp.empty('team', 'Aún no has aprobado atletas', 'Cuando alguien solicite acceso, aprueba su solicitud aquí arriba.');
    h += '</div>';
    if (rej.length) h += `<div class="card sec"><span class="eyebrow">Rechazadas (${rej.length})</span>` + rej.map(p => personRow(p, `<button class="btn sm" data-act="eq-approve" data-uid="${esc(p.id)}">Aprobar</button>` + cf('eq-delreq', p.id, 'Borrar'))).join('') + '</div>';
    h += '<p class="muted">Quitar el acceso a un atleta no borra sus datos: solo le impide volver a entrar.</p>';
    if (window.HalterBackup) h += window.HalterBackup.card();
    return h;
  }
  async function guarded(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); } catch (e) { C.err = dataErr(e); toast(C.err); window.HalterApp.render(); }
  }
  function onAct(act, el) {
    const uid = el && el.dataset ? el.dataset.uid : null;
    const find = id => C.requests.find(x => x.id === id) || C.members.find(x => x.id === id);
    const prev = C.confirm; C.confirm = null;
    const twoStep = key => { if (prev === key + uid) return true; C.confirm = key + uid; window.HalterApp.render(); return false; };
    switch (act) {
      case 'cl-logout': doLogout(); break;
      case 'sync-now': if (C.sync) { C.sync.syncNow(); toast('Sincronizando…'); } break;
      case 'pl-publish': case 'pl-cancel': case 'pl-template': case 'pl-activate': case 'pl-delete': if (window.HalterPlan) window.HalterPlan.onAct(act, el); break;
      case 'as-open': case 'as-back': case 'as-assign': case 'as-start': case 'as-self': case 'as-advance': case 'as-adj-save': case 'as-adj-clear': case 'rt-new': case 'rt-edit': case 'rt-view': case 'rt-view-close': case 'rt-cancel': case 'rt-ses-add': case 'rt-ses-rm': case 'rt-save': case 'rt-del': case 'rt-start': case 'rp-toggle': case 'rp-refresh': case 'rp-mode': case 'rp-copy': case 'rp-share': case 'rp-print': if (window.HalterAssign) window.HalterAssign.onAct(act, el); window.HalterApp.render(); break;
      case 'bk-run': if (window.HalterBackup) window.HalterBackup.onAct(act); break;
      case 'cp-new': case 'cp-edit': case 'cp-cancel': case 'cp-save': case 'cp-del': if (window.HalterComp) window.HalterComp.onAct(act, el); window.HalterApp.render(); break;
      case 'cmp-sex': case 'cmp-cat': case 'cmp-refresh': case 'cmp-open': if (window.HalterCompare) window.HalterCompare.onAct(act, el); window.HalterApp.render(); break;
      case 'eq-approve': { const p = find(uid); if (p) guarded(() => C.remote.approve(uid, p.name, p.email), 'Aprobado: ' + (p.name || p.email)); break; }
      case 'eq-reject': if (twoStep('eq-reject')) guarded(() => C.remote.rejectRequest(uid), 'Solicitud rechazada'); break;
      case 'eq-delreq': if (twoStep('eq-delreq')) guarded(() => C.remote.deleteRequest(uid), 'Solicitud borrada'); break;
      case 'eq-remove': if (twoStep('eq-remove')) guarded(() => C.remote.removeMember(uid), 'Acceso retirado'); break;
    }
  }

  /* ---------- Acciones de las pantallas de ingreso ---------- */
  async function doLogout() {
    try { stopSync(); if (window.HalterCompare) window.HalterCompare.reset(); if (window.HalterComp) window.HalterComp.reset(); if (window.HalterPlan) window.HalterPlan.reset(); if (C.appRunning) window.HalterApp.stop(); C.appRunning = false; LS.del(K_LAST); unwatch(); resetAccess(); C.mode = 'login'; C.err = ''; C.autoSent = false;
      if (C.remote) await C.remote.signOut(); } catch (e) { /* sin conexión: igual se cierra la sesión local */ }
    C.user = null; C.phase = 'signedout'; showGate(true);
  }
  async function sendRequest(name) {
    name = String(name || '').trim();
    if (name.length < 2) { setForm('Escribe tu nombre y apellido', false); return; }
    setForm('', true, 'Enviando…');
    try { await C.remote.createRequest(C.user.uid, name.slice(0, 60), C.user.email || ''); LS.del(K_NAME); C.busy = false; C.phase = 'pending'; C.request = { name, status: 'pending' }; showGate(true); evaluate(); }
    catch (e) { C.phase = 'norequest'; C.prefill = name; showGate(true); setForm(dataErr(e), false); }
  }
  async function submitForm(kind) {
    const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    if (kind === 'request') { sendRequest(v('gName')); return; }
    const email = v('gEmail').trim(), pass = v('gPass'), name = v('gName').trim();
    let err = '';
    if (!email) err = 'Escribe tu correo';
    else if (kind !== 'reset' && !pass) err = 'Escribe tu contraseña';
    else if (kind === 'signup') {
      if (name.length < 2) err = 'Escribe tu nombre y apellido';
      else if (v('gSex') !== 'F' && v('gSex') !== 'M') err = 'Indica tu sexo: se usa para ubicarte en tu categoría de peso';
      else if (pass.length < 6) err = 'La contraseña debe tener al menos 6 caracteres';
      else if (pass !== v('gPass2')) err = 'Las contraseñas no coinciden';
      else if (window.HalterPrivacy && !(document.getElementById('gPriv') || {}).checked) err = 'Para crear la cuenta, marca que leíste el aviso de privacidad';
    }
    if (err) { setForm(err, false); return; }
    setForm('', true, 'Un momento…');
    try {
      if (kind === 'login') await C.remote.signIn(email, pass);
      else if (kind === 'signup') { LS.set(K_NAME, name); LS.set(K_PRIVNEW, '1'); sexSet(email, v('gSex')); await C.remote.signUp(email, pass); try { await C.remote.sendVerification(); C.resendAt = Date.now() + 60000; C.resendFor = email; } catch (e) { /* el botón «Reenviar» queda disponible */ } }
      else { await C.remote.resetPassword(email); toast('Listo: revisa tu correo (y la carpeta de spam)'); C.mode = 'login'; C.busy = false; showGate(true); return; }
      /* con éxito, onAuth cambia la pantalla */
    } catch (e) {
      const msg = authErr(e), code = e && e.code ? ` [${e.code}]` : '';
      if (kind === 'signup') { LS.del(K_NAME); LS.del(K_PRIVNEW); sexSet(email, null); }
      setForm(msg + (msg.startsWith('No se pudo') ? '' : code), false, kind === 'login' ? 'Entrar' : kind === 'signup' ? 'Crear cuenta y pedir acceso' : 'Enviar correo');
    }
  }

  /* S2: comprobar si ya verificó (a mano con el botón, o solo al volver a la pestaña) y reenviar el enlace */
  async function checkVerified(silent) {
    if (!C.user || C.phase !== 'verify' || C.busy) return;
    C.busy = true; C.err = ''; C.info = ''; if (!silent) showGate(true);
    try {
      const ok = await C.remote.refreshUser();
      C.busy = false;
      if (ok) { C.user.verified = true; C.info = ''; evaluate(); return; }
      if (!silent) C.err = 'Todavía no aparece verificado. Abre el enlace del correo y vuelve a intentarlo.';
    } catch (e) { C.busy = false; if (!silent) C.err = dataErr(e); }
    if (C.phase === 'verify') showGate(true);
  }
  async function resendVerification() {
    if (!C.user || C.busy) return;
    if (Date.now() < (C.resendAt || 0) && C.resendFor === C.user.email) { C.err = ''; C.info = 'Espera un momento antes de pedir otro correo.'; showGate(true); return; }
    C.busy = true; C.err = ''; C.info = ''; showGate(true);
    try { await C.remote.sendVerification(); C.resendAt = Date.now() + 60000; C.resendFor = C.user.email; C.info = 'Listo: reenviamos el correo. Revisa también el spam.'; } catch (e) { C.err = e && e.code === 'auth/too-many-requests' ? 'Demasiados intentos. Espera unos minutos.' : dataErr(e); }
    C.busy = false; if (C.phase === 'verify') showGate(true);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && C.phase === 'verify') checkVerified(true); });
  function bindGate() {
    const g = gate();
    g.addEventListener('submit', e => { const f = e.target.closest('[data-g-form]'); if (!f) return; e.preventDefault(); if (!C.busy) submitForm(f.dataset.gForm); });
    g.addEventListener('click', e => {
      const t = e.target.closest('[data-g]'); if (!t) return;
      switch (t.dataset.g) {
        case 'mode': C.mode = t.dataset.v; C.err = ''; showGate(true); break;
        case 'logout': doLogout(); break;
        case 'retry': boot(); break;
        case 'rerequest': C.autoSent = true; C.prefill = C.request ? C.request.name : ''; guarded(() => C.remote.deleteRequest(C.user.uid)); break;
        case 'rewatch': C.err = ''; watchAccess(C.user); showGate(true); break;
        case 'verified': checkVerified(false); break;
        case 'resend': resendVerification(); break;
      }
    });
  }

  /* ---------- Inicio ---------- */
  async function boot() {
    C.phase = 'loading'; C.err = ''; showGate(true);
    const cfg = window.FIREBASE_CONFIG, factory = window.HALTER_REMOTE_FACTORY;
    if (!factory && (!cfg || !cfg.apiKey)) { C.phase = 'nocfg'; showGate(true); return; }
    if (!factory && !/^https?:$/.test(location.protocol)) { C.phase = 'nocfg'; C.err = 'abre la app desde una dirección https'; showGate(true); return; }
    try {
      C.remote = factory ? factory(cfg) : new FirebaseRemote(cfg);
      await C.remote.init();
    } catch (e) {
      C.err = (e && (e.code || e.message)) || 'sin conexión';
      // Sin SDK ni conexión: si este dispositivo ya tenía un acceso aprobado, se abre la app con los datos locales
      const last = readLast();
      if (last && last.uid) {
        C.user = { uid: last.uid, email: last.email }; C.offlineCache = true;
        activate(last.role, last.name, true); return;
      }
      C.phase = 'failed'; showGate(true); return;
    }
    C.remote.onAuth(u => {
      if (u && C.user && u.uid === C.user.uid) return;
      unwatch();
      if (!u) { C.busy = false; stopSync(); if (C.appRunning) { window.HalterApp.stop(); C.appRunning = false; } C.user = null; resetAccess(); C.phase = 'signedout'; showGate(true); return; }
      C.user = u; C.autoSent = false; C.err = ''; C.busy = false; C.phase = 'resolving';
      const last = readLast();
      if (!(last && last.uid === u.uid)) showGate(true);
      watchAccess(u); evaluate();
    });
  }

  let booted = false;
  const go = () => { if (booted) return; booted = true; bindGate(); boot(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();

  /* Funciona sin conexión y se puede instalar */
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => { /* sin service worker */ }));
  }
  window.HalterCloud = { state: C }; // para pruebas
})();
