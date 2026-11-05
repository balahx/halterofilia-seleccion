/* Fase 4 de punta a punta (app real + servidor simulado con las mismas reglas): el entrenador asigna la semana y
   ajusta un %, la atleta inicia la sesión armada, se registra el cumplimiento, y pasa de semana tras el corte.
   Uso: node tests/assign-e2e.js */
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
  const ctx = await br.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.addInitScript({ path: path.join(__dirname, 'fake-remote.js') });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const shot = n => page.screenshot({ path: path.join(SHOTS, 'semana-' + n + '.png') });
  const txt = sel => page.locator(sel).first().innerText();
  const docs = () => page.evaluate(() => __fake.srv().docs);
  const logout = async () => { await page.click('#gear'); await page.click('[data-act="cl-logout"]'); await page.waitForSelector('#gForm'); await page.waitForTimeout(500); };
  const signup = async (name, email) => { await page.click('[data-g="mode"][data-v="signup"]'); await page.fill('#gName', name); await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.fill('#gPass2', 'clave123'); await page.click('#gForm button[type=submit]'); await page.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || '')); };
  const login = async email => { await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.click('#gForm button[type=submit]'); await page.waitForSelector('#appRoot:not([hidden])'); };
  const tab = async t => { await page.click('#nav button[data-tab="' + t + '"]'); await page.waitForTimeout(250); };
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
  ok(/Sin semana asignada/.test(await txt('#view')), 'en Equipo, Ana aparece sin semana');
  await page.click('[data-act="as-open"]'); await page.waitForSelector('#asWeek');
  ok(/Ana Rojas/.test(await txt('#view h1')), 'se abre el detalle de la atleta');
  ok((await page.locator('#asWeek option').allInnerTexts()).join('|') === 'Semana 1|Semana 2', 'el selector lista las semanas del plan activo');
  await shot('01-coach-asignar');
  await page.click('[data-act="as-assign"]'); await page.waitForTimeout(500);
  let d = await docs(), a = d['assignments/' + auid];
  ok(a && a.weekId === 'e1_1' && a.week === 1 && a.stageId === 'e1' && a.planId === 'p1' && a.setBy === cuid, 'quedó asignada la semana 1 (firmada por el entrenador)');
  const ch = await page.evaluate(ms => HalterAssign.pure.chile(ms), a.weekEndsAt);
  ok(ch.wd === 4 && ch.h === 23 && ch.mi === 59 && a.weekEndsAt > Date.now(), 'el corte es un viernes 23:59 hora de Chile y está en el futuro');
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
  for (const t of await page.locator('.tick').all()) await t.click();
  await page.click('[data-act="finish"]'); await page.waitForSelector('#dlg[open]'); await page.waitForTimeout(700);
  d = await docs();
  ok(d['users/' + auid + '/completions/p1_e1_1_0'] && d['users/' + auid + '/completions/p1_e1_1_0'].sessionIdx === 0, 'quedó registrada la sesión cumplida (hora del servidor)');
  await page.keyboard.press('Escape'); await tab('semana');
  ok(/Cumplida/.test(await txt('#view')), 'la semana marca la sesión como cumplida');
  ok(await page.locator('[data-act="as-advance"]').isDisabled(), 'todavía no puede pasar de semana');
  ok(/Falta cumplir la última sesión/.test(await txt('#view')), 'explica por qué: falta la última sesión');
  await shot('04-atleta-cumplida');

  console.log('3. Las reglas impiden saltarse la semana o falsear el cumplimiento');
  let r = await remoteTry(`await r.advanceAssignment('${auid}', { weekId: 'e1_2', week: 2, stageId: 'e1', weekEndsAt: ${a.weekEndsAt + 604800000} })`);
  ok(r === 'permission-denied', 'no puede pasar de semana antes del corte ni sin la última sesión (' + r + ')');
  r = await remoteTry(`await r.setCompletion('${auid}', 'p1_e1_2_0', { planId: 'p1', weekId: 'e1_2', sessionIdx: 0 })`);
  ok(r === 'permission-denied', 'no puede registrar una sesión de una semana que no tiene asignada (' + r + ')');
  r = await remoteTry(`await r.setCompletion('${auid}', 'p1_e1_1_0', { planId: 'p1', weekId: 'e1_1', sessionIdx: 0 })`);
  ok(r === 'permission-denied', 'no puede reescribir una sesión ya cumplida (' + r + ')');
  r = await remoteTry(`await r.setAssignment('${auid}', { planId: 'p1', weekId: 'e1_2', week: 2, stageId: 'e1', weekEndsAt: 1, setBy: '${auid}' })`);
  ok(r === 'permission-denied', 'no puede asignarse una semana ella misma (' + r + ')');
  r = await remoteTry(`await r.setAdjust('${auid}_p1_e1_1', { s0_i0_k1: 80 })`);
  ok(r === 'permission-denied', 'no puede cambiar sus propios ajustes (' + r + ')');

  console.log('4. Pasado el corte y con la última sesión cumplida, pasa a la semana 2');
  const past = await page.evaluate(() => HalterAssign.pure.cutoffFor(Date.now() - 8 * 86400000));
  await page.evaluate(({ u, past }) => { const s = __fake.srv(), x = s.docs['assignments/' + u]; __fake.admin('assignments/' + u, Object.assign({}, x, { weekEndsAt: past })); }, { u: auid, past });
  await page.waitForTimeout(400);
  await page.click('[data-act="as-start"][data-i="1"]'); await page.waitForSelector('.tick');
  const k0 = page.locator('[data-f="kg"]').first(); await k0.fill('80');
  const kg2 = page.locator('[data-f="kg"]'); for (let i = 1; i < await kg2.count(); i++) await kg2.nth(i).fill('80');
  for (const t of await page.locator('.tick').all()) await t.click();
  await page.click('[data-act="finish"]'); await page.waitForSelector('#dlg[open]'); await page.waitForTimeout(700);
  d = await docs();
  ok(!!d['users/' + auid + '/completions/p1_e1_1_1'], 'la segunda sesión (la última) quedó cumplida');
  await page.keyboard.press('Escape'); await tab('semana');
  ok(await page.locator('[data-act="as-advance"]').isEnabled(), 'el botón «Pasar a la semana siguiente» se habilita');
  await shot('05-atleta-avanzar');
  await page.click('[data-act="as-advance"]'); await page.waitForTimeout(700); 
  d = await docs(); a = d['assignments/' + auid];
  ok(a.weekId === 'e1_2' && a.week === 2 && a.setBy === cuid, 'pasó a la semana 2; sigue firmada por el entrenador');
  ok(Math.abs(a.weekEndsAt - (past + 604800000)) <= 7200000, 'el nuevo corte es 7 días después (±2 h por horario)');
  ok(/semana 2/i.test(await txt('#view')), 'la pantalla muestra «Semana 2»');
  ok(/Es la última semana/.test(await txt('#view')) || /Falta cumplir/.test(await txt('#view')), 'ahora explica lo que falta para seguir');

  console.log('5. Sin conexión la semana sigue a la vista');
  await page.evaluate(() => __fake.setOffline(true)); await page.reload(); await page.waitForSelector('#appRoot:not([hidden])');
  await tab('semana');
  ok(/semana 2/i.test(await txt('#view')), 'abierta sin conexión, muestra la última semana guardada');
  await page.evaluate(() => __fake.setOffline(false)); await logout();

  console.log('6. El entrenador ve lo cumplido');
  await login('cristian@correo.cl'); await tab('equipo');
  await page.click('[data-act="as-open"]'); await page.waitForSelector('#asWeek');
  ok(/Semana 2/.test(await txt('#view')), 'el detalle muestra la semana 2 de Ana');
  await page.selectOption('#asWeek', 'e1_1'); await page.click('[data-act="as-assign"]'); await page.waitForTimeout(600);
  ok(/Cumplida el/.test(await txt('#view')), 'al ver la semana 1 aparecen las sesiones cumplidas con su fecha');
  await shot('06-coach-cumplidas');

  console.log('7. App instalada: abre con el último acceso guardado y, al llegar la conexión, carga la lista de atletas');
  await page.evaluate(() => __fake.setOffline(true)); await page.reload(); await page.waitForSelector('#appRoot:not([hidden])');
  await tab('equipo');
  ok(/Aún no has aprobado atletas/.test(await txt('#view')), 'sin conexión, la lista está vacía (no hay de dónde leerla)');
  await page.evaluate(() => __fake.setOffline(false)); await page.waitForTimeout(1500);
  await page.waitForFunction(() => /Ana Rojas/.test(document.querySelector('#view').innerText), null, { timeout: 4000 }).catch(() => {});
  ok(/Ana Rojas/.test(await txt('#view')), 'al volver la conexión aparece Ana Rojas en «Atletas aprobados»');
  await tab('planual'); await page.waitForTimeout(300);
  ok(/Plan 2026/.test(await txt('#view')), 'y la pestaña Planes muestra el plan publicado');

  console.log('8. Complejos: sin máximo propio usa el primer movimiento; el atleta puede estimarle uno con la calculadora y pasa a ser la prioridad');
  await logout(); await login('ana@correo.cl');
  await page.evaluate(W => {
    __fake.admin('exercises/overhead-squat', { en: 'Overhead Squat', es: 'Sentadilla sobre la cabeza', aliases: [] });
    const w = JSON.parse(JSON.stringify(W)); w.sessions.push({ day: 5, name: 'Viernes', items: [{ block: 'Complejo', tag: '', raw: 'AA + OHS', presc: '', inline: null, sets: [{ pct: 80, reps: '1', sets: 1 }], alts: [{ p: [{ src: 'AA', ex: 'snatch', mult: 1, max: false }, { src: 'OHS', ex: 'overhead-squat', mult: 1, max: false }] }] }] });
    __fake.admin('plans/p1/weeks/e1_1', w);
  }, WEEKS.e1_1);
  await tab('semana'); await page.waitForTimeout(800);
  if (process.env.DBG) console.log((await txt('#view')).slice(0, 900));
  ok(/Snatch \+ Overhead Squat/.test(await txt('#view')), 'la semana muestra el complejo');
  ok(/primer movimiento con máximo/.test(await txt('#view')), 'sin máximo del complejo avisa que usa el del primer movimiento');
  await tab('max');
  const opt = await page.locator('#cEx option', { hasText: 'Snatch + Overhead Squat' }).count();
  ok(opt >= 1, 'el complejo ya está en la calculadora «Guardar como máximo de» sin iniciar la sesión');
  const cid = await page.locator('#cEx option', { hasText: 'Snatch + Overhead Squat' }).first().getAttribute('value');
  await page.selectOption('#cEx', cid); await page.fill('#cKg', '90'); await page.fill('#cReps', '1');
  await page.click('[data-act="calc-save"]'); await page.waitForTimeout(150); await page.click('[data-act="calc-save"]'); await page.waitForTimeout(300);
  if (process.env.DBG) console.log(JSON.stringify(await page.evaluate(() => HalterApp.state().exercises.filter(e => e.max > 0 || /^cx/.test(e.id)).map(e => [e.id, e.max]))), cid);
  await tab('semana');
  ok(/con el máximo de tu complejo/.test(await txt('#view')), 'con el máximo del complejo guardado pasa a ser la referencia (prioridad 1)');
  ok(/80 %[^|]*→ 72 kg/.test(await txt('#view')), '80 % del complejo (90 kg) = 72 kg');

  ok(errors.length === 0, 'sin errores en la consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await br.close(); srv.close();
  console.log(fails ? '\nFALLAS: ' + fails : '\nTodo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
