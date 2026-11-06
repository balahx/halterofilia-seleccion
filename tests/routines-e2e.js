/* Rutinas especiales: el entrenador arma una rutina para un atleta inscrito con el editor de la app (series, reps, % y descanso, más la pausa en el movimiento en
   segundos); el atleta la ve en «Semana», la inicia con las repeticiones sombreadas y la pausa del entrenador. Uso: node tests/routines-e2e.js */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };

const it = (block, src, ex, sets) => ({ block, tag: '', raw: src, presc: '', inline: null, sets, alts: [{ p: [{ src, ex, mult: 1, max: false }] }] });
const WEEKS = {
  e1_1: { stageId: 'e1', week: 1, label: '', kind: '', notes: [], next: 'e1_2', sessions: [
    { day: 1, name: 'Lunes', items: [it('Técnica arranque', 'AA', 'snatch', [{ pct: 70, reps: '3', sets: 2 }, { pct: 92, reps: '1', sets: 1, adjustable: true }])] },
    { day: 3, name: 'Miércoles', items: [it('Fuerza tracción', 'jalon AA', 'snatch-pull', [{ pct: 100, reps: '3', sets: 2 }])] }] },
  e1_2: { stageId: 'e1', week: 2, label: '', kind: '', notes: [], next: '', sessions: [{ day: 1, name: 'Lunes', items: [it('Técnica arranque', 'AA', 'snatch', [{ pct: 75, reps: '2', sets: 3 }])] }] }
};

(async () => {
  await new Promise(r => srv.listen(0, r)); const URL = 'http://localhost:' + srv.address().port + '/';
  const br = await chromium.launch(), errors = [];
  const ctx = await br.newContext({ viewport: { width: +(process.env.VW || 390), height: +(process.env.VH || 780) }, deviceScaleFactor: +(process.env.DSF || 2), serviceWorkers: 'block' });
  await ctx.addInitScript({ path: path.join(__dirname, 'fake-remote.js') });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const shot = n => page.screenshot({ path: path.join(SHOTS, 'semana-' + n + '.png') });
  const txt = sel => page.locator(sel).first().innerText();
  const docs = () => page.evaluate(() => __fake.srv().docs);
  const logout = async () => { await page.click('#gear'); await page.click('[data-act="cl-logout"]'); await page.waitForSelector('#gForm'); await page.waitForTimeout(500); };
  const signup = async (name, email) => { await page.click('[data-g="mode"][data-v="signup"]'); await page.selectOption('#gSex', 'F'); await page.fill('#gName', name); await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.fill('#gPass2', 'clave123'); await page.check('#gPriv'); await page.click('#gForm button[type=submit]'); await page.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || '')); };
  const login = async email => { await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.click('#gForm button[type=submit]'); await page.waitForSelector('#appRoot:not([hidden])'); };
  const tab = async t => { await page.click('#nav button[data-tab="' + t + '"]'); await page.waitForTimeout(250); };
  // el atleta anota las repeticiones que hizo (aquí, las mismas del plan) y marca cada serie
  const tickAll = async () => { const r = page.locator('[data-f="reps"]'); for (let i = 0; i < await r.count(); i++) { if (!(await r.nth(i).inputValue())) await r.nth(i).fill(await r.nth(i).getAttribute('placeholder')); } for (const t of await page.locator('.tick').all()) await t.click(); };
  const remoteTry = (fn) => page.evaluate(async src => { try { await (new Function('r', 'return (async()=>{' + src + '})()'))(window.HALTER_REMOTE_FACTORY()); return 'ok'; } catch (e) { return e.code || String(e.message); } }, fn);

  console.log('0. Preparación: entrenador, dos atletas y un plan');
  await page.goto(URL); await page.waitForSelector('#gForm');
  await signup('Cristian Mateluna', 'cristian@correo.cl');
  const cuid = await page.evaluate(() => __fake.uid('cristian@correo.cl'));
  await page.evaluate(u => __fake.admin('config/team', { coachUid: u }), cuid);
  await page.waitForSelector('#appRoot:not([hidden])'); await logout();
  await signup('Ana Rojas', 'ana@correo.cl');
  const auid = await page.evaluate(() => __fake.uid('ana@correo.cl'));
  await page.evaluate(u => __fake.admin('members/' + u, { name: 'Ana Rojas', email: 'ana@correo.cl', approvedAt: Date.now() }), auid);
  await page.waitForSelector('#appRoot:not([hidden])'); await logout();
  await signup('Beto Soto', 'beto@correo.cl');
  const buid = await page.evaluate(() => __fake.uid('beto@correo.cl'));
  await page.evaluate(u => __fake.admin('members/' + u, { name: 'Beto Soto', email: 'beto@correo.cl', approvedAt: Date.now() }), buid);
  await page.waitForSelector('#appRoot:not([hidden])');
  await tab('semana');
  ok(/aún no te asigna una semana/.test(await txt('#view')), 'sin semana ni rutina, el atleta ve el aviso de siempre');
  await logout();

  console.log('1. El entrenador crea una rutina especial para Ana');
  await login('cristian@correo.cl'); await tab('equipo');
  await page.click('[data-act="as-open"]:near(:text("Ana Rojas"))').catch(() => {});
  if (!/Ana Rojas/.test(await txt('#view h1').catch(() => ''))) { await page.locator('.person', { hasText: 'Ana Rojas' }).locator('[data-act="as-open"]').click(); }
  await page.waitForSelector('[data-act="rt-new"]');
  ok(/Rutinas especiales/i.test(await txt('#view')) && /Sin rutinas especiales/.test(await txt('#view')), 'el detalle del atleta tiene «Rutinas especiales»');
  await page.click('[data-act="rt-new"]'); await page.waitForSelector('#rtName');
  ok(/Nueva rutina/.test(await txt('#view h1')) && /Ana Rojas/.test(await txt('#view')), 'se abre el editor de rutina para Ana');
  await page.click('[data-act="rt-save"]'); await page.waitForTimeout(250);
  ok(/Ponle un nombre/.test(await txt('#toast')), 'pide un nombre antes de guardar');
  await page.fill('#rtName', 'Rehabilitación de hombro');
  await page.click('[data-act="rt-save"]'); await page.waitForTimeout(250);
  ok(/no tiene ejercicios/.test(await txt('#toast')), 'no deja guardar una sesión sin ejercicios');
  await page.fill('#dn-0', 'Movilidad y técnica');
  await page.click('[data-act="rt-add"][data-d="0"]'); await page.waitForSelector('.pick');
  await page.click('.pick[data-ex="snatch"]'); await page.waitForSelector('.prow');
  ok((await page.locator('.prow').count()) === 1 && (await page.locator('#pd-0-0').getAttribute('data-f')) === 'prest' && (await page.locator('#pz-0-0').getAttribute('data-f')) === 'ppause' && /Descanso/i.test(await txt('.prow')) && /Pausa \(s\)/i.test(await txt('.prow')), 'mismo editor de la app: Descanso (como siempre) y además «Pausa (s)» en el movimiento');
  await page.fill('#ps-0-0', '4'); await page.fill('#pr-0-0', '2'); await page.fill('#pp-0-0', '65'); await page.selectOption('#pd-0-0', '45'); await page.fill('#pz-0-0', '1');
  ok(/4×2/.test(await txt('#pv-0-0')) && /65 %/.test(await txt('#pv-0-0')) && /pausa 1 s/.test(await txt('#pv-0-0')) && /descanso 0:45/.test(await txt('#pv-0-0')), 'la vista previa muestra series, %, pausa y descanso: ' + (await txt('#pv-0-0')));
  await page.click('[data-act="rt-add"][data-d="0"]'); await page.waitForSelector('.pick'); await page.click('.pick[data-ex="bsq"]'); await page.waitForTimeout(200);
  await page.fill('#ps-0-1', '3'); await page.fill('#pr-0-1', '5'); await page.fill('#pp-0-1', '70'); await page.selectOption('#pd-0-1', '90'); await page.fill('#pz-0-1', '2');
  await page.click('[data-act="rt-ses-add"]'); await page.waitForSelector('#dn-1');
  await page.fill('#dn-1', 'Tirones'); await page.click('[data-act="rt-add"][data-d="1"]'); await page.waitForSelector('.pick'); await page.click('.pick[data-ex="snpull"]'); await page.waitForTimeout(200);
  await page.fill('#ps-1-0', '3'); await page.fill('#pr-1-0', '3'); await page.fill('#pp-1-0', '90'); await page.fill('#pz-1-0', '99');
  ok((await page.inputValue('#pz-1-0')) === '10', 'la pausa nunca pasa de 10 segundos (99 queda en 10)');
  await page.fill('#rtNote', 'Sin dolor, parar si molesta el hombro.');
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'rutina-editor.png') });
  await page.click('[data-act="rt-save"]'); await page.waitForSelector('[data-act="rt-edit"]');
  let d = await docs(), rid = Object.keys(d).find(k => k.startsWith('routines/')), r = d[rid];
  ok(r && r.uid === auid && r.name === 'Rehabilitación de hombro' && r.setBy === cuid && r.sessions.length === 2 && r.note.startsWith('Sin dolor'), 'la rutina quedó guardada para Ana');
  ok(r.sessions[0].name === 'Movilidad y técnica' && r.sessions[0].items.length === 2 && r.sessions[0].items[0].sets === 4 && r.sessions[0].items[0].reps === '2' && r.sessions[0].items[0].pct === 65 && r.sessions[0].items[0].rest === 45 && r.sessions[0].items[0].pause === 1 && r.sessions[0].items[1].rest === 90 && r.sessions[0].items[1].pause === 2, 'con series, repeticiones, %, descanso y pausa (segundos) de cada ejercicio');
  ok(/Rehabilitación de hombro/.test(await txt('#view')) && /2 sesiones · 3 ejercicios/.test(await txt('#view')), 'aparece en la lista del atleta');

  console.log('2. Editar y volver a guardar');
  await page.click('[data-act="rt-edit"]'); await page.waitForSelector('#rtName');
  ok(/Editar rutina/.test(await txt('#view h1')) && (await page.inputValue('#pd-0-0')) === '45' && (await page.inputValue('#pz-0-0')) === '1' && (await page.inputValue('#rtName')) === 'Rehabilitación de hombro', 'el editor abre con los datos guardados');
  await page.selectOption('#pd-0-0', '60'); await page.fill('#pz-0-0', '3'); await page.click('[data-act="rt-save"]'); await page.waitForSelector('[data-act="rt-edit"]');
  d = await docs(); ok(d[rid].sessions[0].items[0].rest === 60 && d[rid].sessions[0].items[0].pause === 3 && Object.keys(d).filter(k => k.startsWith('routines/')).length === 1, 'se actualiza la misma rutina (no se duplica)');
  await page.click('[data-act="rt-edit"]'); await page.waitForSelector('#rtName'); await page.click('[data-act="rt-cancel"]');
  ok(await page.locator('[data-act="rt-new"]').count() === 1, 'volver sin guardar regresa al atleta');

  console.log('3. Ana la ve en «Semana» y la entrena');
  await logout(); await login('ana@correo.cl'); await tab('semana');
  await page.waitForSelector('[data-act="rt-start"]');
  const vt = await txt('#view');
  ok(/Rutina de tu entrenador/i.test(vt) && /Rehabilitación de hombro/.test(vt) && /Movilidad y técnica/.test(vt) && /Tirones/.test(vt) && /Sin dolor/.test(vt), 've la rutina, sus sesiones y la nota');
  ok(/mientras tanto, entrena con la rutina/.test(vt), 'aunque no tenga semana del plan, no queda vacío');
  await page.evaluate(() => HalterApp.commit(S => { S.exercises.find(e => e.id === 'snatch').max = 80; }));
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'rutina-atleta.png') });
  await page.click('[data-act="rt-start"][data-i="0"]'); await page.waitForSelector('.tick');
  const rows = await page.locator('.set[data-i]').evaluateAll(l => l.map(x => ({ kg: x.querySelector('[data-f="kg"]').value, ph: x.querySelector('[data-f="reps"]').placeholder, v: x.querySelector('[data-f="reps"]').value })));
  ok(rows.length === 7 && rows.slice(0, 4).every(x => x.kg === '52' && x.ph === '2' && x.v === '') && rows.slice(4).every(x => x.ph === '5' && x.v === ''), 'series: kilos con el máximo de Ana (65 % de 80 = 52) y repeticiones sombreadas: ' + JSON.stringify(rows.slice(0, 2)));
  const rest = await page.evaluate(() => HalterApp.state().sessions.find(s => !s.endedAt).items.map(i => i.rest + '/' + (i.pause || 0)));
  ok(rest.join(',') === '60/3,90/2', 'descanso y pausa de cada ejercicio son los que puso el entrenador: ' + rest);
  ok(/Pausa de 3 s en el movimiento/.test(await txt('.exc')), 'el atleta ve la indicación de pausa en el ejercicio');
  const clock = await page.evaluate(() => document.querySelector('#dockBox') ? document.querySelector('#dockBox').innerText : '');
  ok(/1:00/.test(clock), 'el temporizador parte con el descanso del primer ejercicio (1:00): ' + clock.replace(/\s+/g, ' '));
  const kgs = page.locator('[data-f="kg"]'); for (let i = 4; i < await kgs.count(); i++) await kgs.nth(i).fill('70');   // sentadilla trasera: Ana aún no tiene máximo, anota el peso
  const reps = page.locator('[data-f="reps"]'); for (let i = 0; i < await reps.count(); i++) await reps.nth(i).fill(i < 4 ? '2' : '5');
  for (const t of await page.locator('.tick').all()) await t.click();
  await page.click('[data-act="finish"]'); await page.waitForSelector('#dlg[open]'); await page.waitForTimeout(500);
  const ss = await page.evaluate(() => HalterApp.state().sessions.filter(s => s.endedAt).map(s => s.routine));
  ok(ss.length === 1 && ss[0].id === rid.split('/')[1] && ss[0].idx === 0, 'la sesión queda marcada como de la rutina');
  await page.keyboard.press('Escape'); await tab('semana');
  ok(/hecha el/.test(await txt('#view')), 'en «Semana» la sesión aparece como hecha');

  console.log('4. Solo Ana la ve; las reglas protegen a los demás');
  await logout(); await login('beto@correo.cl'); await tab('semana');
  ok(!/Rutina de tu entrenador/i.test(await txt('#view')), 'Beto no ve la rutina de Ana');
  let res = await remoteTry("await r.setRoutine('x1', { uid: '" + buid + "', name: 'Intento', sessions: [{ name: 'a', items: [] }], setBy: '" + buid + "' })");
  ok(res === 'permission-denied', 'un atleta no puede crear rutinas (' + res + ')');
  res = await remoteTry("await r.deleteRoutine('" + rid.split('/')[1] + "')");
  ok(res === 'permission-denied', 'un atleta no puede borrar rutinas (' + res + ')');
  await logout(); await login('cristian@correo.cl');
  res = await remoteTry("await r.setRoutine('x2', { uid: 'no-es-miembro', name: 'Fantasma', sessions: [{ name: 'a', items: [] }], setBy: '" + cuid + "' })");
  ok(res === 'permission-denied', 'no se puede asignar una rutina a quien no es atleta inscrito (' + res + ')');

  console.log('5. Quitar la rutina');
  await tab('equipo'); await page.locator('.person', { hasText: 'Ana Rojas' }).locator('[data-act="as-open"]').click(); await page.waitForSelector('[data-act="rt-del"]');
  await page.click('[data-act="rt-del"]'); ok(/Confirmar/.test(await txt('[data-act="rt-del"]')), 'pide confirmar antes de quitar');
  await page.click('[data-act="rt-del"]'); await page.waitForTimeout(400);
  d = await docs(); ok(!Object.keys(d).some(k => k.startsWith('routines/')), 'la rutina se quitó');

  ok(errors.length === 0, 'sin errores en la consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await br.close(); srv.close();
  console.log(fails ? '\nFALLAS: ' + fails : '\nTodo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
