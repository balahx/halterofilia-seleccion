/* 4.14.0: avisos de la semana en «Hoy» (semana nueva asignada por el entrenador, ya puede pasar de semana,
   pasó el corte y faltan sesiones) y «Duplicar» rutinas especiales para el mismo u otro atleta.
   Uso: node tests/weeknotice-e2e.js */
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
  const shot = n => page.screenshot({ path: path.join(SHOTS, 'aviso-' + n + '.png') });
  const txt = sel => page.locator(sel).first().innerText();
  const docs = () => page.evaluate(() => __fake.srv().docs);
  const logout = async () => { await page.click('#gear'); await page.click('[data-act="cl-logout"]'); await page.waitForSelector('#gForm'); await page.waitForTimeout(500); };
  const signup = async (name, email) => { await page.click('[data-g="mode"][data-v="signup"]'); await page.selectOption('#gSex', 'F'); await page.fill('#gName', name); await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.fill('#gPass2', 'clave123'); await page.check('#gPriv'); await page.click('#gForm button[type=submit]'); await page.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || '')); };
  const login = async email => { await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.click('#gForm button[type=submit]'); await page.waitForSelector('#appRoot:not([hidden])'); };
  const tab = async t => { await page.click('#nav button[data-tab="' + t + '"]'); await page.waitForTimeout(250); };
  // el atleta anota las repeticiones que hizo (aquí, las mismas del plan) y marca cada serie
  const tickAll = async () => { const r = page.locator('[data-f="reps"]'); for (let i = 0; i < await r.count(); i++) { if (!(await r.nth(i).inputValue())) await r.nth(i).fill(await r.nth(i).getAttribute('placeholder')); } for (const t of await page.locator('.tick').all()) await t.click(); };
  const remoteTry = (fn) => page.evaluate(async src => { try { await (new Function('r', 'return (async()=>{' + src + '})()'))(window.HALTER_REMOTE_FACTORY()); return 'ok'; } catch (e) { return e.code || String(e.message); } }, fn);

  const note = () => page.locator('#view .wknote');
  const setAsg = (u, o) => page.evaluate(({ u, o }) => __fake.admin('assignments/' + u, o), { u, o });
  const hoy = async () => { await tab('hoy'); await page.waitForTimeout(300); };

  console.log('0. Preparación: entrenador, dos atletas y un plan publicado');
  await page.goto(URL); await page.waitForSelector('#gForm');
  await signup('Cristian Mateluna', 'cristian@correo.cl');
  const cuid = await page.evaluate(() => __fake.uid('cristian@correo.cl'));
  await page.evaluate(u => __fake.admin('config/team', { coachUid: u }), cuid);
  await page.waitForSelector('#appRoot:not([hidden])'); await logout();
  await signup('Bea Soto', 'bea@correo.cl');
  const buid = await page.evaluate(() => __fake.uid('bea@correo.cl'));
  await page.evaluate(u => __fake.admin('members/' + u, { name: 'Bea Soto', email: 'bea@correo.cl', approvedAt: Date.now() }), buid);
  await page.waitForSelector('#appRoot:not([hidden])'); await logout();
  await signup('Ana Rojas', 'ana@correo.cl');
  const auid = await page.evaluate(() => __fake.uid('ana@correo.cl'));
  await page.evaluate(u => __fake.admin('members/' + u, { name: 'Ana Rojas', email: 'ana@correo.cl', approvedAt: Date.now() }), auid);
  await page.waitForSelector('#appRoot:not([hidden])');
  await page.evaluate(({ W }) => {
    __fake.admin('exercises/snatch', { en: 'Snatch', es: 'Arranque', aliases: [] }); __fake.admin('exercises/snatch-pull', { en: 'Snatch Pull', es: 'Tirón de arranque', aliases: [] });
    __fake.admin('plans/p1', { name: 'Plan 2026', year: 2026, format: 'x', stages: 1, weeks: 2, createdAt: Date.now() });
    __fake.admin('plans/p1/stages/e1', { name: 'Preparatorio General', order: 1 });
    Object.keys(W).forEach(k => __fake.admin('plans/p1/weeks/' + k, W[k]));
    __fake.admin('config/plan', { activePlanId: 'p1', at: Date.now() });
  }, { W: WEEKS });
  await hoy();
  ok(await note().count() === 0, 'sin semana asignada no hay aviso en «Hoy»');

  console.log('1. El entrenador asigna la semana 1: la atleta lo ve al entrar a «Hoy»');
  const future = await page.evaluate(() => HalterAssign.pure.cutoffFor(Date.now()));
  await setAsg(auid, { planId: 'p1', weekId: 'e1_1', week: 1, stageId: 'e1', weekEndsAt: future, setBy: cuid });
  await page.waitForTimeout(500); await hoy();
  ok(/Tu entrenador te asignó la semana 1/.test(await txt('#view .wknote')) && /Preparatorio General/.test(await txt('#view .wknote')), 'aviso «Tu entrenador te asignó la semana 1» con la etapa');
  ok(await page.locator('#view .wknote [data-tab="semana"]').count() === 1 && await page.locator('#view .wknote [data-act="wk-seen"]').count() === 1, 'ofrece «Ver mi semana» y «Entendido»');
  await shot('01-semana-nueva');
  await page.click('#view .wknote [data-act="wk-seen"]'); await page.waitForTimeout(250);
  ok(await note().count() === 0, '«Entendido» quita el aviso');
  await page.reload(); await page.waitForSelector('#appRoot:not([hidden])'); await page.waitForTimeout(700); await hoy();
  ok(await note().count() === 0, 'al volver a abrir la app no se repite');

  console.log('2. El entrenador la mueve a la semana 2: «Ver mi semana» lleva a «Semana» y el aviso queda visto');
  await setAsg(auid, { planId: 'p1', weekId: 'e1_2', week: 2, stageId: 'e1', weekEndsAt: future, setBy: cuid });
  await page.waitForTimeout(500); await hoy();
  ok(/te asignó la semana 2/.test(await txt('#view .wknote')), 'avisa la semana 2');
  await page.click('#view .wknote [data-tab="semana"]'); await page.waitForTimeout(300);
  ok(/Semana 2/i.test(await txt('#view')) && await note().count() === 0, 'abre «Semana» (sin repetir el aviso de semana nueva)');
  await hoy();
  ok(await note().count() === 0, 'de vuelta en «Hoy» ya no aparece');

  console.log('3. Pasó el corte y faltan sesiones → aviso; con todas cumplidas → «Ya puedes pasar»');
  const past = await page.evaluate(() => HalterAssign.pure.cutoffFor(Date.now() - 8 * 86400000));
  await setAsg(auid, { planId: 'p1', weekId: 'e1_1', week: 1, stageId: 'e1', weekEndsAt: past, setBy: cuid });
  await page.waitForTimeout(500); await hoy();
  await page.click('#view .wknote [data-act="wk-seen"]'); await page.waitForTimeout(300);
  ok(/Aún no puedes cambiar de semana/.test(await txt('#view .wknote')) && /faltan 2 sesiones/.test(await txt('#view .wknote')), 'pasó el corte: dice que faltan 2 sesiones');
  ok(await page.locator('#view .wknote.warn').count() === 1, 'se ve como advertencia');
  await shot('02-faltan');
  await page.evaluate(u => { ['0', '1'].forEach(i => __fake.admin('users/' + u + '/completions/p1_e1_1_' + i, { planId: 'p1', weekId: 'e1_1', sessionIdx: +i, completedAt: Date.now() })); }, auid);
  await page.waitForTimeout(500); await hoy();
  ok(/Ya puedes pasar a la semana siguiente/.test(await txt('#view .wknote')) && await page.locator('#view .wknote [data-act="as-advance"]').count() === 1, '«Ya puedes pasar a la semana siguiente» con el botón');
  await shot('03-puede-pasar');
  await tab('semana');
  ok(/Ya puedes pasar/.test(await txt('#view .wknote')), 'el mismo aviso arriba de «Semana»');
  await hoy();
  await page.click('#view .wknote [data-act="as-advance"]'); await page.waitForTimeout(800);
  const d = await page.evaluate(() => __fake.srv().docs);
  ok(d['assignments/' + auid].weekId === 'e1_2', 'el botón del aviso pasa a la semana 2');
  await hoy();
  ok(await note().count() === 0, 'tras avanzar ella misma no aparece «te asignó la semana 2»');
  await logout();

  console.log('4. El entrenador duplica una rutina para otro atleta');
  await page.evaluate(({ u, c }) => __fake.admin('routines/r1', { uid: u, name: 'Hombro', note: 'Sin dolor', mode: 'extra', setBy: c, at: Date.now(),
    sessions: [{ name: 'Sesión 1', day: 2, days: [2, 4], items: [{ exId: 'snatch', name: 'Snatch', cat: 'oly', sets: 3, reps: '3', pct: 70, kg: 0, rest: 120, pause: 2 }] }] }), { u: auid, c: cuid });
  await login('cristian@correo.cl'); await tab('equipo');
  await page.locator('.person', { hasText: 'Ana Rojas' }).locator('[data-act="as-open"]').click(); await page.waitForTimeout(400);
  ok(await page.locator('[data-act="rt-dup"]').count() === 1, 'cada rutina tiene «Duplicar»');
  await page.click('[data-act="rt-dup"]'); await page.waitForSelector('#rtUid');
  ok(/Duplicar rutina/.test(await txt('#view h1')) && (await page.inputValue('#rtName')) === 'Hombro (copia)', 'abre el editor como copia, con «(copia)» en el nombre');
  ok((await page.locator('#rtUid option').allInnerTexts()).join('|') === 'Ana Rojas|Bea Soto' && (await page.inputValue('#rtUid')) === auid, 'deja elegir el atleta (por defecto el mismo)');
  await page.selectOption('#rtUid', buid);
  await shot('04-duplicar');
  await page.click('[data-act="rt-save"]'); await page.waitForTimeout(700);
  const all = await page.evaluate(() => __fake.srv().docs), rts = Object.keys(all).filter(k => k.startsWith('routines/')).map(k => all[k]);
  const cp = rts.find(r => r.uid === buid), orig = all['routines/r1'];
  ok(rts.length === 2 && cp && cp.name === 'Hombro (copia)' && cp.note === 'Sin dolor' && cp.mode === 'extra', 'se creó la copia para Bea con nombre, nota y modo');
  ok(cp && JSON.stringify(cp.sessions[0].days) === '[2,4]' && cp.sessions[0].items[0].pct === 70 && cp.sessions[0].items[0].pause === 2, 'con las mismas sesiones, días y ejercicios');
  ok(orig.uid === auid && orig.name === 'Hombro', 'la rutina original no cambia');
  ok(/Rutina guardada para Bea Soto/.test(await txt('#toast')), 'avisa para quién se guardó');
  await page.click('[data-act="rt-dup"]'); await page.waitForSelector('#rtUid');
  await page.click('[data-act="rt-save"]'); await page.waitForTimeout(700);
  const all2 = await page.evaluate(() => __fake.srv().docs);
  ok(Object.keys(all2).filter(k => k.startsWith('routines/') && all2[k].uid === auid).length === 2, 'también se puede duplicar para el mismo atleta');

  await br.close(); srv.close();
  ok(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log(fails ? '\nFALLAS: ' + fails : '\nTodo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
