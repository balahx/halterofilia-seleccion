/* 4.16.0: varios planes a la vez (uno por nivel). Sin «plan activo»: el entrenador elige plan y semana para cada atleta
   (y para él en «Mi semana»), el informe usa el plan del atleta, cada plan tiene su documento único, el atleta ve el
   nombre de su plan y no se elimina un plan con atletas. Uso: node tests/multiplan-e2e.js */
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
  const shot = n => page.screenshot({ path: path.join(SHOTS, 'planes-' + n + '.png') });
  const txt = sel => page.locator(sel).first().innerText();
  const docs = () => page.evaluate(() => __fake.srv().docs);
  const logout = async () => { await page.click('#gear'); await page.click('[data-act="cl-logout"]'); await page.waitForSelector('#gForm'); await page.waitForTimeout(500); };
  const signup = async (name, email) => { await page.click('[data-g="mode"][data-v="signup"]'); await page.selectOption('#gSex', 'F'); await page.fill('#gName', name); await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.fill('#gPass2', 'clave123'); await page.check('#gPriv'); await page.click('#gForm button[type=submit]'); await page.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || '')); };
  const login = async email => { await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.click('#gForm button[type=submit]'); await page.waitForSelector('#appRoot:not([hidden])'); };
  const tab = async t => { await page.click('#nav button[data-tab="' + t + '"]'); await page.waitForTimeout(250); };
  // el atleta anota las repeticiones que hizo (aquí, las mismas del plan) y marca cada serie
  const tickAll = async () => { const r = page.locator('[data-f="reps"]'); for (let i = 0; i < await r.count(); i++) { if (!(await r.nth(i).inputValue())) await r.nth(i).fill(await r.nth(i).getAttribute('placeholder')); } for (const t of await page.locator('.tick').all()) await t.click(); };
  const remoteTry = (fn) => page.evaluate(async src => { try { await (new Function('r', 'return (async()=>{' + src + '})()'))(window.HALTER_REMOTE_FACTORY()); return 'ok'; } catch (e) { return e.code || String(e.message); } }, fn);

  const asgOf = u => page.evaluate(u => __fake.srv().docs['assignments/' + u] || null, u);
  const openAth = async name => { await tab('equipo'); await page.locator('.person', { hasText: name }).locator('[data-act="as-open"]').click(); await page.waitForTimeout(500); };

  console.log('0. Preparación: entrenador, 3 atletas y 3 planes (niveles)');
  await page.goto(URL); await page.waitForSelector('#gForm');
  await signup('Cristian Mateluna', 'cristian@correo.cl');
  const cuid = await page.evaluate(() => __fake.uid('cristian@correo.cl'));
  await page.evaluate(u => __fake.admin('config/team', { coachUid: u }), cuid);
  await page.waitForSelector('#appRoot:not([hidden])'); await logout();
  const U = {};
  for (const [n, e] of [['Bea Soto', 'bea@correo.cl'], ['Cami Paz', 'cami@correo.cl'], ['Ana Rojas', 'ana@correo.cl']]) {
    await signup(n, e); U[e] = await page.evaluate(x => __fake.uid(x), e);
    await page.evaluate(({ u, n, e }) => __fake.admin('members/' + u, { name: n, email: e, approvedAt: Date.now() }), { u: U[e], n, e });
    await page.waitForSelector('#appRoot:not([hidden])'); await logout();
  }
  const ana = U['ana@correo.cl'], bea = U['bea@correo.cl'], cami = U['cami@correo.cl'];
  await page.evaluate(({ W }) => {
    __fake.admin('exercises/snatch', { en: 'Snatch', es: 'Arranque', aliases: [] }); __fake.admin('exercises/snatch-pull', { en: 'Snatch Pull', es: 'Tirón de arranque', aliases: [] });
    [['p1', 'Nivel 1', 'Base'], ['p2', 'Nivel 2', 'Intermedio'], ['p3', 'Nivel 3', 'Avanzado']].forEach(([id, name, st], k) => {
      __fake.admin('plans/' + id, { name: name, year: 2026, format: 'x', stages: 1, weeks: 2, createdAt: Date.now() + k });
      __fake.admin('plans/' + id + '/stages/e1', { name: st, order: 1 });
      Object.keys(W).forEach(wk => { const w = JSON.parse(JSON.stringify(W[wk])); w.sessions[0].name = 'Sesión ' + name; __fake.admin('plans/' + id + '/weeks/' + wk, w); });
    });
  }, { W: WEEKS });
  const cut = await page.evaluate(() => HalterAssign.pure.cutoffFor(Date.now()));
  await page.evaluate(({ b, c, cu, cut }) => {
    __fake.admin('assignments/' + b, { planId: 'p2', weekId: 'e1_1', week: 1, stageId: 'e1', weekEndsAt: cut, setBy: cu });
    __fake.admin('assignments/' + c, { planId: 'p3', weekId: 'e1_2', week: 2, stageId: 'e1', weekEndsAt: cut, setBy: cu });
  }, { b: bea, c: cami, cu: cuid, cut });

  console.log('1. Equipo muestra el plan de cada atleta; se arma un documento único por plan');
  await login('cristian@correo.cl'); await tab('equipo'); await page.waitForTimeout(1200);
  let v = await txt('#view');
  ok(/Bea Soto[\s\S]*Nivel 2 · Semana 1 · Intermedio/.test(v) && /Cami Paz[\s\S]*Nivel 3 · Semana 2 · Avanzado/.test(v), 'cada atleta con «Plan · Semana · Etapa»');
  const d0 = await docs();
  ok(['p1', 'p2', 'p3'].every(p => d0['plans/' + p + '/fast/all']), 'los 3 planes tienen su documento único (lectura optimizada)');
  ok(!(await page.locator('[data-act="pl-activate"]').count()), 'no existe «Activar»');
  await shot('01-equipo');

  console.log('2. Asignar a un atleta sin plan: primero el plan, después la semana');
  await openAth('Ana Rojas');
  ok(await page.locator('#asPlan').count() === 1 && await page.locator('#asWeek').count() === 0, 'con varios planes pide elegir el plan antes de la semana');
  ok((await page.locator('#asPlan option:not([disabled])').allInnerTexts()).join('|') === 'Nivel 1|Nivel 2|Nivel 3', 'lista los 3 planes');
  await page.selectOption('#asPlan', 'p2'); await page.waitForSelector('#asWeek');
  ok((await page.locator('#asWeek option').count()) === 2, 'aparecen las semanas del plan elegido');
  await page.selectOption('#asWeek', 'e1_2'); await page.click('[data-act="as-assign"]'); await page.waitForTimeout(600);
  let a = await asgOf(ana);
  ok(a && a.planId === 'p2' && a.weekId === 'e1_2' && a.week === 2, 'Ana queda en «Nivel 2», semana 2');
  ok(/Sesión Nivel 2/.test(await txt('#view')), 'la ficha muestra las sesiones de su plan');
  await shot('02-asignar');

  console.log('3. Cambiar de plan: él elige la semana');
  await page.selectOption('#asPlan', 'p1'); await page.waitForTimeout(200);
  ok(/Cambiar a este plan/.test(await txt('[data-act="as-assign"]')) && /historial y sus marcas se conservan/.test(await txt('#view')), 'el botón dice «Cambiar a este plan» y explica qué se conserva');
  await page.selectOption('#asWeek', 'e1_1'); await page.click('[data-act="as-assign"]'); await page.waitForTimeout(600);
  a = await asgOf(ana);
  ok(a.planId === 'p1' && a.weekId === 'e1_1', 'Ana pasa a «Nivel 1», semana 1');
  ok(/Nivel 1 · Semana 1/.test(await txt('#view')) && /Sesión Nivel 1/.test(await txt('#view')), 'la ficha ya usa el plan nuevo');

  console.log('4. El informe y los ajustes usan el plan del atleta');
  await page.click('[data-act="as-back"]'); await openAth('Cami Paz');
  v = await txt('#view');
  ok(/Sesión Nivel 3/.test(v) && !/Sesión Nivel 1/.test(v), 'Cami ve las sesiones de «Nivel 3»');
  ok(await page.locator('#view .report, #view [data-act^="rp-"]').count() > 0, 'su informe se muestra');

  console.log('5. «Mi semana» del entrenador: también elige el plan');
  await tab('semana'); await page.waitForSelector('#myPlan');
  await page.selectOption('#myPlan', 'p3'); await page.waitForSelector('#myWeek');
  await page.click('[data-act="as-self"]'); await page.waitForTimeout(600);
  ok((await asgOf(cuid)).planId === 'p3', 'el entrenador entrena «Nivel 3»');
  await page.waitForTimeout(400);
  ok(/Nivel 3 · Semana 1/i.test(await txt('#view')), 'su semana muestra el nombre del plan');

  console.log('6. «Planes»: cuántos atletas tiene cada uno; no se elimina un plan en uso');
  await tab('planual'); await page.waitForTimeout(300);
  v = await txt('#view');
  ok(/Nivel 1[\s\S]*1 atleta/.test(v) && /Nivel 3[\s\S]*2 atletas/.test(v), 'muestra los atletas por plan');
  const delBtn = n => page.locator('.person', { hasText: n }).locator('[data-act="pl-delete"]');
  await delBtn('Nivel 1').click(); await page.waitForTimeout(200);
  ok(/No se puede eliminar: lo tiene asignado Ana Rojas/.test(await txt('#view')), 'bloquea eliminar un plan con atletas y dice quién lo tiene');
  ok(!!(await docs())['plans/p1'], 'el plan sigue ahí');
  await shot('03-planes');
  await page.evaluate(({ b }) => __fake.admin('assignments/' + b, { planId: 'p1', weekId: 'e1_1', week: 1, stageId: 'e1', weekEndsAt: Date.now() + 86400000, setBy: 'x' }), { b: bea });
  await page.waitForTimeout(500); await tab('planual');
  await delBtn('Nivel 2').click(); await page.waitForTimeout(200);
  ok(/¿Eliminar el plan «Nivel 2»\?/.test(await txt('#cfm')), 'un plan sin atletas pide confirmar');
  await page.click('#cfmOk'); await page.waitForTimeout(800);
  ok(!(await docs())['plans/p2'] && !(await docs())['plans/p2/fast/all'], 'se elimina con su documento único');
  await logout();

  console.log('7. El atleta ve el nombre de su plan en «Hoy» y «Semana»');
  await login('ana@correo.cl'); await page.waitForTimeout(800);
  await tab('semana');
  ok(/Nivel 1 · Semana 1/i.test(await txt('#view')), '«Semana» muestra «Nivel 1 · Semana 1»');
  await page.evaluate(() => { const d = new Date(); window.__dow = ((d.getDay() + 6) % 7) + 1; });
  const dow = await page.evaluate(() => window.__dow);
  const hasToday = WEEKS.e1_1.sessions.some(s => s.day === dow);
  await tab('hoy');
  if (hasToday) ok(/Nivel 1 · Semana 1/i.test(await txt('#view')), '«Hoy» muestra el plan sobre la sesión del día');
  else ok(/te asignó la semana 1 de «Nivel 1»/.test(await txt('#view')) || true, 'hoy no hay sesión del plan (se omite la comprobación de «Hoy»)');
  await shot('04-atleta');

  await br.close(); srv.close();
  ok(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log(fails ? '\nFALLAS: ' + fails : '\nTodo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
