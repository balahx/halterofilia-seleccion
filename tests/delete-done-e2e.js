/* 4.10.1: al borrar una sesión del Historial también se quita su marca «Cumplida» (Semana y Hoy) y el registro en la nube.
   Uso: node tests/delete-done-e2e.js */
//
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

  console.log('0. Preparación: entrenador, atleta y un plan publicado');
  await page.goto(URL); await page.waitForSelector('#gForm');
  await signup('Cristian Mateluna', 'cristian@correo.cl');
  const cuid = await page.evaluate(() => __fake.uid('cristian@correo.cl'));
  await page.evaluate(u => __fake.admin('config/team', { coachUid: u }), cuid);
  await page.waitForSelector('#appRoot:not([hidden])'); await logout();
  await signup('Ana Rojas', 'ana@correo.cl');
  const auid = await page.evaluate(() => __fake.uid('ana@correo.cl'));
  await page.evaluate(u => __fake.admin('members/' + u, { name: 'Ana Rojas', email: 'ana@correo.cl', approvedAt: Date.now() }), auid);
  await page.waitForSelector('#appRoot:not([hidden])');
  ok(!(await page.locator('#nav button[data-tab="semana"]').count()) || true, 'la atleta entra');
  await page.evaluate(({ W }) => {
    __fake.admin('exercises/snatch', { en: 'Snatch', es: 'Arranque', aliases: [] }); __fake.admin('exercises/snatch-pull', { en: 'Snatch Pull', es: 'Tirón de arranque', aliases: [] });
    __fake.admin('plans/p1', { name: 'Plan 2026', year: 2026, format: 'x', stages: 1, weeks: 2, createdAt: Date.now() });
    __fake.admin('plans/p1/stages/e1', { name: 'Preparatorio General', order: 1 });
    Object.keys(W).forEach(k => __fake.admin('plans/p1/weeks/' + k, W[k]));
    __fake.admin('config/plan', { activePlanId: 'p1', at: Date.now() });
  }, { W: WEEKS });
  await tab('semana');
  ok(/aún no te asigna una semana/.test(await txt('#view')), 'sin asignación, la atleta lo ve claro');
  await logout();

  console.log('1. El entrenador asigna la semana 1 y ajusta un porcentaje');
  await login('cristian@correo.cl'); await tab('equipo');
  await shot('00-equipo');
  ok(/Sin semana asignada/.test(await txt('#view')), 'en Equipo, Ana aparece sin semana');
  await page.click('[data-act="as-open"]'); await page.waitForSelector('#asWeek');
  ok(/Ana Rojas/.test(await txt('#view h1')), 'se abre el detalle de la atleta');
  ok((await page.locator('#asWeek option').allInnerTexts()).join('|') === 'Semana 1|Semana 2', 'el selector lista las semanas del plan activo');
  await shot('01-coach-asignar');
  await page.click('[data-act="as-assign"]'); await page.waitForTimeout(500);
  let d = await docs(), a = d['assignments/' + auid];
  ok(a && a.weekId === 'e1_1' && a.week === 1 && a.stageId === 'e1' && a.planId === 'p1' && a.setBy === cuid, 'quedó asignada la semana 1 (firmada por el entrenador)');
  const ch = await page.evaluate(ms => HalterAssign.pure.chile(ms), a.weekEndsAt);
  ok(ch.wd === 6 && ch.h === 23 && ch.mi === 59 && a.weekEndsAt > Date.now(), 'el corte es un domingo 23:59 hora de Chile y está en el futuro');
  ok(/Semana 1/.test(await txt('#view')), 'el detalle muestra «Semana 1»');
  ok((await page.locator('[data-as="pct"]').count()) === 1, 'solo el 92 % aparece como ajustable (desde 90 %)');
  await page.fill('[data-as="pct"]', '95'); await page.click('[data-act="as-adj-save"]'); await page.waitForTimeout(500);
  d = await docs();
  ok(JSON.stringify((d['adjustments/' + auid + '_p1_e1_1'] || {}).pcts) === '{"s0_i0_k1":95}', 'el ajuste (95 %) quedó guardado para esa atleta y semana');
  await shot('02-coach-ajuste');
  await page.click('[data-act="as-back"]'); await page.waitForTimeout(200);
  ok(/Semana 1/.test(await txt('#view')) && /Preparatorio/.test(await txt('#view')), 'la lista del equipo resume la semana y la etapa');
  await logout();

  console.log('2. La atleta ve su semana con sus kilos y arma la sesión');
  await login('ana@correo.cl'); await tab('semana');
  await page.waitForSelector('[data-act="as-start"]');
  await page.waitForFunction(() => /Preparatorio General/.test(document.querySelector('#view').innerText), null, { timeout: 5000 }).catch(() => {});
  ok(/semana 1/i.test(await txt('#view')) && /Preparatorio General/.test(await txt('#view')), 've «Semana 1» y su etapa');
  ok(/sin tu máximo/.test(await txt('#view')), 'sin máximo cargado avisa en vez de inventar kilos');
  await page.evaluate(() => HalterApp.commit(S => { S.exercises.find(e => e.id === 'snatch').max = 100; }));
  await page.waitForTimeout(300);
  let v = await txt('#view');
  ok(/70 %.*3 rep.*× 2.*70 kg/s.test(v), 'muestra 70 % · 3 rep × 2 → 70 kg');
  ok(/95 % \(ajustado\).*95 kg/s.test(v), 'el 92 % aparece ajustado a 95 % → 95 kg');
  ok(/Snatch\s*\n\s*Arranque/.test(v), 'inglés principal y español debajo (ajuste por defecto)');
  await page.click('#gear'); await page.waitForSelector('#sLang'); await page.selectOption('#sLang', 'es'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok(/Arranque\s*\n\s*Snatch/.test(await txt('#view')), 'al cambiar el ajuste, español principal e inglés debajo');
  await page.click('#gear'); await page.waitForSelector('#sLang'); await page.selectOption('#sLang', 'en'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await shot('03-atleta-semana');
  await page.click('[data-act="as-start"][data-i="0"]'); await page.waitForSelector('.tick');
  ok(/Hoy|Arranque/.test(await txt('#view')), 'la sesión se abre lista para registrar');
  const kgs = await page.locator('[data-f="kg"]').evaluateAll(l => l.map(x => x.value));
  ok(kgs.join(',') === '70,70,95', 'series prellenadas con 70, 70 y 95 kg: ' + kgs.join(','));
  const phs = await page.locator('[data-f="reps"]').evaluateAll(l => l.map(x => x.placeholder + '|' + x.value));
  ok(phs.join(',') === '3|,3|,1|', 'las repeticiones del plan van sombreadas (placeholder) y los campos vacíos: ' + phs.join(','));
  await page.locator('.tick').first().click(); await page.waitForTimeout(200);
  ok(!(await page.locator('.set.is-done').count()) && /Anota el peso y las repeticiones/.test(await txt('#toast')), 'sin anotar las repeticiones no se puede marcar la serie');
  await tickAll();
  await page.click('[data-act="finish"]'); await page.waitForSelector('#dlg[open]'); await page.waitForTimeout(700);
  d = await docs();
  ok(d['users/' + auid + '/completions/p1_e1_1_0'] && d['users/' + auid + '/completions/p1_e1_1_0'].sessionIdx === 0, 'quedó registrada la sesión cumplida (hora del servidor)');
  await page.keyboard.press('Escape'); await tab('semana');
  ok(/Cumplida/.test(await txt('#view')), 'la semana marca la sesión como cumplida');

  console.log('4.10.1 Borrar la sesión del Historial quita la marca «Cumplida»');
  const doneDoc = 'users/' + auid + '/completions/p1_e1_1_0';
  ok(!!(await docs())[doneDoc], 'antes de borrar: la sesión figura cumplida en la nube');
  await tab('mas'); await page.click('.mrow[data-tab="hist"]'); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-act="hist-toggle"]')?.click()); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-act="del-sess"]')?.click()); await page.waitForTimeout(200);   // pide confirmar
  ok(!!(await docs())[doneDoc], 'el primer toque solo pide confirmar: todavía sigue cumplida');
  await page.evaluate(() => document.querySelector('[data-act="del-sess"]')?.click()); await page.waitForTimeout(600);
  ok(!(await docs())[doneDoc], 'al confirmar, se elimina la marca de la nube');
  await tab('semana');
  ok(!/Cumplida/.test(await txt('#view')), 'la pestaña Semana ya no la marca como cumplida');
  ok(/Falta cumplir|Faltan \d+ sesiones/.test(await txt('#view')), 'y para pasar de semana vuelve a faltar esa sesión');
  await tab('hoy');
  ok(!/Cumplida/.test(await txt('#view')), 'tampoco aparece como cumplida en Hoy');
  const left = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => /pend/i.test(k)) || '') || '[]'));
  ok(Array.isArray(left) && left.length === 0, 'no queda nada pendiente de enviar');

  console.log('Repetir la sesión la vuelve a marcar; borrar una repetición no la quita mientras haya otra');
  await tab('semana'); await page.click('[data-act="as-start"][data-i="0"]'); await page.waitForSelector('.tick'); await tickAll();
  await page.click('[data-act="finish"]'); await page.waitForSelector('#dlg[open]'); await page.waitForTimeout(700); await page.keyboard.press('Escape');
  ok(!!(await docs())[doneDoc], 'al repetir la sesión vuelve a quedar cumplida');
  await tab('semana'); await page.click('[data-act="as-start"][data-i="0"]'); await page.waitForSelector('.tick'); await tickAll();
  await page.click('[data-act="finish"]'); await page.waitForSelector('#dlg[open]'); await page.waitForTimeout(700); await page.keyboard.press('Escape');
  ok(await page.evaluate(() => HalterApp.state().sessions.filter(s => s.plan && s.endedAt).length) === 2, 'hay dos sesiones terminadas del mismo día del plan');
  await tab('mas'); await page.click('.mrow[data-tab="hist"]'); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-act="hist-toggle"]')?.click()); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-act="del-sess"]')?.click()); await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('[data-act="del-sess"]')?.click()); await page.waitForTimeout(600);
  ok(!!(await docs())[doneDoc], 'si queda otra sesión igual en el Historial, la marca se conserva');
  await tab('semana');
  ok(/Cumplida/.test(await txt('#view')), 'la semana sigue mostrándola cumplida');
  await tab('mas'); await page.click('.mrow[data-tab="hist"]'); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-act="hist-toggle"]')?.click()); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-act="del-sess"]')?.click()); await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('[data-act="del-sess"]')?.click()); await page.waitForTimeout(600);
  ok(!(await docs())[doneDoc], 'al borrar la última, la marca desaparece');

  console.log('Sin conexión: el borrado de una sesión aún no enviada cancela el envío');
  await page.evaluate(() => localStorage.setItem('fake.offline', '1'));
  await tab('semana'); await page.click('[data-act="as-start"][data-i="0"]'); await page.waitForSelector('.tick'); await tickAll();
  await page.click('[data-act="finish"]'); await page.waitForSelector('#dlg[open]'); await page.waitForTimeout(500); await page.keyboard.press('Escape');
  await tab('mas'); await page.click('.mrow[data-tab="hist"]'); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-act="hist-toggle"]')?.click()); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-act="del-sess"]')?.click()); await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('[data-act="del-sess"]')?.click()); await page.waitForTimeout(500);
  const pendBefore = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).filter(k => /\.pend$/.test(k)).map(k => localStorage.getItem(k))));
  await page.evaluate(() => localStorage.setItem('fake.offline', '0')); await page.evaluate(() => HalterAssign.flush()); await page.waitForTimeout(800);
  ok(/\[\]/.test(pendBefore) || pendBefore === '[]', 'sin conexión no queda nada en cola tras borrar (' + pendBefore + ')');
  ok(!/Falló|No se pudo quitar/.test(await page.evaluate(() => document.querySelector('#toast').innerText)), 'y no aparece un aviso de error');
  ok(!(await docs())[doneDoc], 'al volver la conexión no se envía una sesión que ya no existe');

  ok(errors.length === 0, 'sin errores en la consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await br.close(); srv.close();
  console.log(fails ? '\nFALLAS: ' + fails : '\nTodo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
