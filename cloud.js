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
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = m => window.HalterApp.toast(m);
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } }
  };
  const K_LAST = 'halterofilia.lastAccess';       // último acceso aprobado en este dispositivo (para abrir sin conexión)
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
      this.db = fs.getFirestore(this.app);
    }
    onAuth(cb) { return this.m.auth.onAuthStateChanged(this.auth, u => cb(u ? { uid: u.uid, email: u.email } : null)); }
    signIn(email, password) { return this.m.auth.signInWithEmailAndPassword(this.auth, email, password); }
    signUp(email, password) { return this.m.auth.createUserWithEmailAndPassword(this.auth, email, password); }
    resetPassword(email) { return this.m.auth.sendPasswordResetEmail(this.auth, email); }
    signOut() { return this.m.auth.signOut(this.auth); }
    _doc(path) { return this.m.fs.doc(this.db, ...path.split('/')); }
    _plain(d) { // Timestamp → milisegundos
      const o = {};
      Object.keys(d).forEach(k => { const v = d[k]; o[k] = v && typeof v.toMillis === 'function' ? v.toMillis() : v; });
      return o;
    }
    watchDoc(path, cb, onErr) {
      return this.m.fs.onSnapshot(this._doc(path), { includeMetadataChanges: true },
        snap => cb(snap.exists() ? this._plain(snap.data()) : null, { fromCache: snap.metadata.fromCache }), onErr);
    }
    watchCol(path, cb, onErr) {
      return this.m.fs.onSnapshot(this.m.fs.collection(this.db, ...path.split('/')), { includeMetadataChanges: true },
        snap => cb(snap.docs.map(d => Object.assign({ id: d.id }, this._plain(d.data()))), { fromCache: snap.metadata.fromCache }), onErr);
    }
    createRequest(uid, name, email) { return this.m.fs.setDoc(this._doc('requests/' + uid), { name, email, status: 'pending', createdAt: this.m.fs.serverTimestamp() }); }
    deleteRequest(uid) { return this.m.fs.deleteDoc(this._doc('requests/' + uid)); }
    rejectRequest(uid) { return this.m.fs.updateDoc(this._doc('requests/' + uid), { status: 'rejected' }); }
    approve(uid, name, email) {
      const { writeBatch, serverTimestamp } = this.m.fs, b = writeBatch(this.db);
      b.set(this._doc('members/' + uid), { name, email, approvedAt: serverTimestamp() });
      b.delete(this._doc('requests/' + uid));
      return b.commit();
    }
    removeMember(uid) { return this.m.fs.deleteDoc(this._doc('members/' + uid)); }
  }

  /* ---------- Estado ---------- */
  const C = {
    remote: null, user: null,
    phase: 'loading',     // loading | nocfg | failed | signedout | resolving | norequest | pending | rejected | noteam | active
    mode: 'login',        // login | signup | reset (pantalla de ingreso)
    role: null,           // coach | athlete
    name: '',
    team: undefined, member: undefined, request: undefined,   // undefined = aún sin respuesta
    defin: { team: false, member: false, request: false },    // respuesta confirmada por el servidor
    members: [], requests: [], colReady: false,
    unsub: [], appRunning: false, err: '', busy: false, confirm: null, offlineCache: false
  };

  /* ---------- Pantallas de ingreso ---------- */
  const gate = () => $('#gate');
  const brand = '<div class="brand"><span class="brand-plate" aria-hidden="true"></span><span class="brand-name">Halterofilia</span></div>';
  function field(id, label, type, extra) { return `<label class="lab" for="${id}">${label}</label><input class="txt" id="${id}" name="${id}" type="${type}" ${extra || ''}>`; }
  function authForm() {
    const m = C.mode;
    const t = { login: ['Iniciar sesión', 'Entra con tu correo y contraseña.', 'Entrar'], signup: ['Crear cuenta', 'Crea tu cuenta y pide acceso. El entrenador debe aprobarte para que puedas usar la app.', 'Crear cuenta y pedir acceso'], reset: ['Restablecer contraseña', 'Te enviaremos un correo con un enlace para elegir una contraseña nueva.', 'Enviar correo'] }[m];
    let f = '';
    if (m === 'signup') f += field('gName', 'Nombre y apellido', 'text', 'autocomplete="name" maxlength="60" required placeholder="Ej. Camila Soto"');
    f += field('gEmail', 'Correo electrónico', 'email', 'autocomplete="username" required placeholder="tu@correo.com" inputmode="email"');
    if (m !== 'reset') f += field('gPass', m === 'signup' ? 'Contraseña (mínimo 6 caracteres)' : 'Contraseña', 'password', `autocomplete="${m === 'signup' ? 'new-password' : 'current-password'}" required`);
    if (m === 'signup') f += field('gPass2', 'Repite la contraseña', 'password', 'autocomplete="new-password" required');
    const alt = m === 'login' ? '<button type="button" class="lnk" data-g="mode" data-v="signup">Crear cuenta</button><button type="button" class="lnk" data-g="mode" data-v="reset">Olvidé mi contraseña</button>'
      : '<button type="button" class="lnk" data-g="mode" data-v="login">Ya tengo cuenta: iniciar sesión</button>';
    return `<h1>${t[0]}</h1><p class="lead">${t[1]}</p><form id="gForm" data-g-form="${m}" novalidate>${f}<p id="gErr" class="form-error" role="alert">${esc(C.err)}</p>` +
      `<div class="stack"><button class="btn" type="submit"${C.busy ? ' disabled' : ''}>${C.busy ? 'Un momento…' : t[2]}</button></div></form><div class="alt">${alt}</div>`;
  }
  function msgView(icon, title, body, actions) {
    const ico = { clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', ban: '<circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/>', cloud: '<path d="M7 18a4 4 0 010-8 5 5 0 019.6-1A4.5 4.5 0 0117 18z"/>', user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6"/>' }[icon];
    return `<div class="big-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ico}</svg></div><h1>${title}</h1>${body}<div class="stack">${actions || ''}</div>`;
  }
  const accountLine = () => `<p class="muted">Sesión: <b>${esc(C.user ? C.user.email : '')}</b></p>`;
  const outBtn = '<button class="lnk" data-g="logout">Cerrar sesión</button>';
  function gateHTML() {
    switch (C.phase) {
      case 'loading': return msgView('cloud', 'Conectando…', '<p class="lead">Un momento.</p>');
      case 'nocfg': return msgView('cloud', 'Falta la configuración', '<p class="lead">No se encontró la configuración de Firebase (<b>firebase-config.js</b>). Revisa el archivo LEEME.md.</p>');
      case 'failed': return msgView('cloud', 'Sin conexión', `<p class="lead">No se pudo cargar el servicio de cuentas (${esc(C.err || 'sin conexión')}). Revisa tu internet.</p>`, '<button class="btn" data-g="retry">Reintentar</button>');
      case 'signedout': return authForm();
      case 'resolving': return msgView('cloud', 'Comprobando tu acceso…', accountLine() + (C.err ? `<div class="note warn">${esc(C.err)}</div>` : ''), (C.err ? '<button class="btn" data-g="rewatch">Reintentar</button>' : '') + outBtn);
      case 'norequest': return `<h1>Pide acceso al equipo</h1><p class="lead">Tu cuenta está creada. Para usar la app, el entrenador debe aprobarte.</p>${accountLine()}<form id="gForm" data-g-form="request" novalidate>${field('gName', 'Nombre y apellido', 'text', `autocomplete="name" maxlength="60" required value="${esc(LS.get(K_NAME) || C.prefill || '')}" placeholder="Ej. Camila Soto"`)}<p id="gErr" class="form-error" role="alert">${esc(C.err)}</p><div class="stack"><button class="btn" type="submit"${C.busy ? ' disabled' : ''}>${C.busy ? 'Enviando…' : 'Enviar solicitud'}</button></div></form><div class="alt">${outBtn}</div>`;
      case 'pending': return msgView('clock', 'Solicitud enviada', `<p class="lead">Tu entrenador debe aprobar tu acceso. Esta pantalla se actualiza sola cuando lo haga; puedes cerrarla y volver más tarde.</p>${accountLine()}`, outBtn) + (C.team === null && C.defin.team ? '<div class="note" style="margin-top:14px">El entrenador aún no está registrado como administrador del equipo en el sistema. Avísale a quien configuró la app.</div>' : '');
      case 'rejected': return msgView('ban', 'Solicitud no aprobada', `<p class="lead">El entrenador no aprobó tu solicitud. Si fue un error, habla con él y vuelve a pedir acceso.</p>${accountLine()}`, '<button class="btn" data-g="rerequest">Volver a pedir acceso</button>' + outBtn);
      case 'noteam': return msgView('user', 'Equipo sin configurar', `<p class="lead">Todavía no hay un entrenador configurado en el sistema.</p>${accountLine()}`, outBtn);
      default: return '';
    }
  }
  let lastKey = '';
  function showGate(force) {
    const g = gate(), key = C.phase + '|' + C.mode + '|' + C.err + '|' + C.busy + '|' + (C.team === null && C.defin.team);
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
  function unwatch() { C.unsub.forEach(u => { try { u(); } catch (e) { /* ya cerrado */ } }); C.unsub = []; }
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
    C.unsub.push(r.watchCol('requests', (list) => {
      const prev = C.requests.filter(x => x.status !== 'rejected').length, fresh = list.filter(x => x.status !== 'rejected');
      const grew = C.colReady && fresh.length > prev;
      C.requests = list; C.colReady = true; window.HalterApp.render();
      if (grew) toast('Nueva solicitud de acceso en «Equipo»');
    }, e => { C.err = dataErr(e); }));
    C.unsub.push(r.watchCol('members', list => { C.members = list; window.HalterApp.render(); }, e => { C.err = dataErr(e); }));
  }
  function decide() { // devuelve { role, definitive } o { phase }
    const uid = C.user.uid;
    if (C.team && C.team.coachUid === uid) return { role: 'coach' };
    if (C.member) return { role: 'athlete' };
    // Respuestas negativas solo valen si vienen del servidor (no de una caché vacía sin conexión)
    if (!C.defin.team || !C.defin.member || !C.defin.request) return { wait: true };
    if (C.request) return { phase: C.request.status === 'rejected' ? 'rejected' : 'pending' };
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

  /* ---------- Arranque de la app ---------- */
  function activate(role, name, offline) {
    const changed = !C.appRunning || C.role !== role;
    C.role = role; C.name = name || C.name; C.phase = 'active'; C.offlineCache = !!offline;
    if (!offline) LS.set(K_LAST, JSON.stringify({ uid: C.user.uid, email: C.user.email, role: role, name: C.name }));
    if (!changed) { window.HalterApp.render(); return; }
    C.appRunning = true; LS.del(K_NAME);
    hideGate();
    window.HalterApp.start({
      cloud: true, storageKey: 'halterofilia.v1.' + C.user.uid, name: C.name,
      tabs: role === 'coach' ? [{ id: 'equipo', label: 'Equipo', icon: 'team', render: teamView }] : [],
      accountHTML: accountHTML, onAct: onAct
    });
    if (role === 'coach' && !offline) watchCoachLists();
  }
  function deactivate() {
    window.HalterApp.stop(); C.appRunning = false; C.role = null; LS.del(K_LAST);
  }

  /* ---------- Contenido propio dentro de la app ---------- */
  function accountHTML() {
    return `<p class="eyebrow">Cuenta</p><div class="acct"><div class="kv"><span>Correo</span><b>${esc(C.user ? C.user.email : '')}</b></div><div class="kv"><span>Rol</span><b>${C.role === 'coach' ? 'Entrenador' : 'Atleta'}</b></div>` +
      (C.offlineCache ? '<div class="kv"><span>Estado</span><b><span class="badge warn">Sin confirmar con el servidor</span></b></div>' : '') +
      '</div><div class="row-end"><button class="lnk" data-act="cl-logout">Cerrar sesión</button></div>';
  }
  const when = ms => ms ? new Date(ms).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }) : '';
  function personRow(p, acts) { return `<div class="person"><div><b>${esc(p.name || '(sin nombre)')}</b><small>${esc(p.email || '')}${p.createdAt || p.approvedAt ? ' · ' + when(p.createdAt || p.approvedAt) : ''}</small></div><div class="acts">${acts}</div></div>`; }
  function teamView() {
    const pend = C.requests.filter(x => x.status !== 'rejected').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const rej = C.requests.filter(x => x.status === 'rejected');
    const mem = C.members.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
    const cf = (key, id, txt, ok) => `<button class="btn ${ok ? '' : 'ghost'} sm" data-act="${key}" data-uid="${esc(id)}">${C.confirm === key + id ? 'Confirmar' : txt}</button>`;
    let h = '<h1>Equipo</h1>';
    if (C.err) h += `<div class="note warn">${esc(C.err)}</div>`;
    h += `<div class="card sec"><span class="eyebrow">Solicitudes pendientes (${pend.length})</span>`;
    h += pend.length ? pend.map(p => personRow(p, `<button class="btn sm" data-act="eq-approve" data-uid="${esc(p.id)}">Aprobar</button>` + cf('eq-reject', p.id, 'Rechazar'))).join('') : '<p class="muted">No hay solicitudes pendientes.</p>';
    h += '</div>';
    h += `<div class="card sec"><span class="eyebrow">Atletas aprobados (${mem.length})</span>`;
    h += mem.length ? mem.map(p => personRow(p, cf('eq-remove', p.id, 'Quitar acceso'))).join('') : '<p class="muted">Aún no has aprobado atletas.</p>';
    h += '</div>';
    if (rej.length) h += `<div class="card sec"><span class="eyebrow">Rechazadas (${rej.length})</span>` + rej.map(p => personRow(p, `<button class="btn sm" data-act="eq-approve" data-uid="${esc(p.id)}">Aprobar</button>` + cf('eq-delreq', p.id, 'Borrar'))).join('') + '</div>';
    h += '<p class="muted">Quitar el acceso a un atleta no borra sus datos: solo le impide volver a entrar.</p>';
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
      case 'eq-approve': { const p = find(uid); if (p) guarded(() => C.remote.approve(uid, p.name, p.email), 'Aprobado: ' + (p.name || p.email)); break; }
      case 'eq-reject': if (twoStep('eq-reject')) guarded(() => C.remote.rejectRequest(uid), 'Solicitud rechazada'); break;
      case 'eq-delreq': if (twoStep('eq-delreq')) guarded(() => C.remote.deleteRequest(uid), 'Solicitud borrada'); break;
      case 'eq-remove': if (twoStep('eq-remove')) guarded(() => C.remote.removeMember(uid), 'Acceso retirado'); break;
    }
  }

  /* ---------- Acciones de las pantallas de ingreso ---------- */
  async function doLogout() {
    try { if (C.appRunning) window.HalterApp.stop(); C.appRunning = false; LS.del(K_LAST); unwatch(); resetAccess(); C.mode = 'login'; C.err = ''; C.autoSent = false;
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
      else if (pass.length < 6) err = 'La contraseña debe tener al menos 6 caracteres';
      else if (pass !== v('gPass2')) err = 'Las contraseñas no coinciden';
    }
    if (err) { setForm(err, false); return; }
    setForm('', true, 'Un momento…');
    try {
      if (kind === 'login') await C.remote.signIn(email, pass);
      else if (kind === 'signup') { LS.set(K_NAME, name); await C.remote.signUp(email, pass); }
      else { await C.remote.resetPassword(email); toast('Listo: revisa tu correo (y la carpeta de spam)'); C.mode = 'login'; C.busy = false; showGate(true); return; }
      /* con éxito, onAuth cambia la pantalla */
    } catch (e) {
      const msg = authErr(e), code = e && e.code ? ` [${e.code}]` : '';
      if (kind === 'signup') LS.del(K_NAME);
      setForm(msg + (msg.startsWith('No se pudo') ? '' : code), false, kind === 'login' ? 'Entrar' : kind === 'signup' ? 'Crear cuenta y pedir acceso' : 'Enviar correo');
    }
  }

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
      if (!u) { C.busy = false; if (C.appRunning) { window.HalterApp.stop(); C.appRunning = false; } C.user = null; resetAccess(); C.phase = 'signedout'; showGate(true); return; }
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
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* sin service worker */ }));
  }
  window.HalterCloud = { state: C }; // para pruebas
})();
