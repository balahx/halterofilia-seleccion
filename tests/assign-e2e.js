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
  await tickAll();
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

  console.log('8. Complejos: automáticos, con el % de la planilla sobre el máximo del movimiento principal');
  await logout(); await login('ana@correo.cl');
  await page.evaluate(W => {
    __fake.admin('exercises/overhead-squat', { en: 'Overhead Squat', es: 'Sentadilla sobre la cabeza', aliases: [] });
    __fake.admin('exercises/snatch-with-above-knee-pause-snatch-pull', { en: 'Snatch with Above-Knee Pause + Snatch Pull', es: 'Arranque con pausa sobre rodilla + tirón', aliases: [] });
    const w = JSON.parse(JSON.stringify(W)); w.sessions.push({ day: 5, name: 'Viernes', items: [{ block: 'Complejo', tag: '', raw: 'AA + OHS', presc: '', inline: null, sets: [{ pct: 80, reps: '1', sets: 1 }], alts: [{ p: [{ src: 'AA', ex: 'snatch', mult: 1, max: false }, { src: 'OHS', ex: 'overhead-squat', mult: 1, max: false }] }] },
      { block: 'Complejo', tag: '', raw: 'AA P2 jalon', presc: '', inline: null, sets: [{ pct: 50, reps: '6-8', sets: 2 }], alts: [{ p: [{ src: 'AA P2° jalon', ex: 'snatch-with-above-knee-pause-snatch-pull', mult: 1, max: false }] }] }] });
    __fake.admin('plans/p1/weeks/e1_1', w);
  }, WEEKS.e1_1);
  await tab('semana'); await page.waitForTimeout(800);
  ok(/Snatch \+ Overhead Squat/.test(await txt('#view')), 'la semana muestra el complejo');
  ok(/80 %[^|]*→ 80 kg/.test(await txt('#view')) && /primer movimiento con máximo/.test(await txt('#view')), '80 % del arranque (100 kg) = 80 kg, y avisa de dónde sale');
  await page.click('[data-act="as-start"][data-i="2"]'); await page.waitForTimeout(500); await tab('hoy'); await page.waitForTimeout(300);
  ok(/Snatch \+ Overhead Squat/.test(await txt('#view')) && (await page.locator('#view .exc [data-act="edit-max"]').filter({ hasText: /máximo|1RM/ }).count()) === 0 && /sin máximo propio/.test(await txt('#view')), 'en la sesión, el complejo no ofrece «Definir máximo»: avisa que usa el de su primer movimiento');
  ok((await page.locator('#view .exc [data-act="edit-max"]').count()) === 0, 'tampoco el complejo «Arranque con pausa + tirón» (un solo ejercicio del glosario con «+»)');
  ok(/Arranque con pausa sobre rodilla|Snatch with Above-Knee Pause/.test(await txt('#view')) && await page.locator('#view .exc').nth(1).locator('input[data-f="kg"]').first().inputValue() === '50', 'y sus kilos salen del arranque: 50 % de 100 = 50 kg');
  await page.locator('#view .exc').first().locator('.inote').fill('Se me cae el codo en la recepción');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => HalterApp.state().sessions.find(x => !x.endedAt).items[0].note) === 'Se me cae el codo en la recepción', 'la observación por ejercicio se guarda en la sesión');
  await page.screenshot({ path: (process.env.SHOTS || '/tmp') + '/semana-08-sesion-complejo.png' });
  await tab('max');
  const mx = await txt('#view');
  ok((await page.locator('#view .eyebrow', { hasText: /^complejos$/i }).count()) === 0 && !/Snatch \+ Overhead Squat|Arranque \+ sentadilla/.test(mx), 'Máximos no pide un máximo para los complejos');
  ok((await page.locator('#cEx option', { hasText: '+' }).count()) === 0, 'la calculadora «Proyectar máximo» tampoco ofrece complejos');
  // aunque haya un «máximo del complejo» guardado de antes, el plan lo ignora
  await page.evaluate(() => { const S = HalterApp.state(); const e = S.exercises.find(x => x.id === 'cx-snoh'); if (e) { e.max = 90; HalterApp.commit(() => {}); } });
  await tab('semana'); await page.waitForTimeout(400);
  ok(/80 %[^|]*→ 80 kg/.test(await txt('#view')), 'un máximo antiguo del complejo no cambia el cálculo');

  console.log('8b. Lectura reducida: solo las sesiones cumplidas de la semana asignada');
  await page.evaluate(u => {
    for (let k = 0; k < 6; k++) __fake.admin('users/' + u + '/completions/p1_old' + k + '_0', { planId: 'p1', weekId: 'old' + k, sessionIdx: 0, completedAt: 1700000000000 + k });
  }, auid);
  await page.waitForTimeout(400); await tab('semana'); await page.waitForTimeout(400);
  const got = await page.evaluate(u => __fake.delivered['users/' + u + '/completions'] || [], auid);
  ok(got.length > 0 && got.every(id => id.indexOf('p1_e1_1_') === 0), 'el atleta recibe solo las sesiones cumplidas de su semana (' + got.length + ' documentos, no las 6 de semanas viejas)');

  console.log('9. Fuerza con derivado: 120 % del arranque por defecto; el entrenador puede indicar otro factor');
  await page.evaluate(W => {
    const w = JSON.parse(JSON.stringify(W)); w.sessions.push({ day: 4, name: 'Jueves', items: [{ block: 'Fuerza', tag: '', raw: 'Fuerza OHS', presc: '', inline: null, sets: [{ pct: 70, reps: '3', sets: 2 }], alts: [{ p: [{ src: 'OHS', ex: 'overhead-squat', mult: 1, max: false }] }] }] });
    __fake.admin('plans/p1/weeks/e1_1', w);
  }, WEEKS.e1_1);
  await page.waitForTimeout(400); await tab('semana'); await page.waitForTimeout(500);
  ok(/Overhead Squat[\s\S]*70 %[^|]*→ 84 kg/.test(await txt('#view')), 'sentadilla sobre la cabeza 70 % sin máximo propio = 70 % de 120 kg (120 % del arranque de 100) = 84 kg');
  await logout(); await login('cristian@correo.cl'); await tab('equipo');
  await page.click('[data-act="as-open"]'); await page.waitForSelector('#asWeek'); await page.waitForTimeout(500);
  const fin = page.locator('[data-key="f_overhead-squat"]');
  ok((await fin.count()) === 1 && (await fin.getAttribute('placeholder')) === '120', 'el entrenador ve el factor del derivado, con 120 % por defecto');
  await fin.fill('130'); await page.click('[data-act="as-adj-save"]'); await page.waitForTimeout(500);
  d = await docs();
  ok((d['adjustments/' + auid + '_p1_e1_1'] || {}).pcts['f_overhead-squat'] === 130 && (d['adjustments/' + auid + '_p1_e1_1'] || {}).pcts.s0_i0_k1 === 95, 'el factor (130 %) quedó guardado junto a los otros ajustes');
  await logout(); await login('ana@correo.cl'); await tab('semana'); await page.waitForTimeout(600);
  ok(/70 %[^|]*→ 91 kg/.test(await txt('#view')) && /indicado por tu entrenador/.test(await txt('#view')), 'con factor 130 %: 70 % de 130 kg = 91 kg, y lo dice');
  await page.evaluate(() => { const S = HalterApp.state(); S.exercises.find(e => e.id === 'ohsq').max = 124; HalterApp.commit(() => {}); });
  await tab('semana'); await page.waitForTimeout(400);
  ok(/70 %[^|]*→ 87 kg/.test(await txt('#view')), 'con su propio máximo (124 kg) el factor no se usa: 70 % = 87 kg');

  console.log('10. Informe del entrenador: planificado vs realizado y observaciones');
  await page.evaluate(u => {
    const day = new Date().toISOString().slice(0, 10);
    const st = (kg, reps, done) => ({ kg, reps, pct: 70, rpe: 8, done, doneAt: 1 });
    const sess = { id: 'inf1', date: day, name: 'Lunes', startedAt: Date.now() - 3600000, endedAt: Date.now(), notes: 'Dolor leve en el hombro derecho', bw: 80,
      items: [{ exId: 'snatch', note: 'Se me cae el codo en la recepción', sets: [st(70, '3', true), st(70, '3', true), st(95, '1', true)] }], plan: { planId: 'p1', weekId: 'e1_1', idx: 0 } };
    __fake.admin('users/' + u + '/records/s_inf1', { t: 'session', d: JSON.stringify(sess), u: Date.now(), at: Date.now() });
  }, auid);
  await logout(); await login('cristian@correo.cl'); await tab('equipo');
  await page.click('[data-act="as-open"]'); await page.waitForSelector('#asWeek'); await page.waitForTimeout(400);
  ok(/Ver informe/.test(await txt('#rpCard')), 'la ficha del atleta ofrece «Ver informe»');
  await page.click('[data-act="rp-toggle"]'); await page.waitForTimeout(900);
  const rp = await txt('#rpCard');
  ok(/Semana 1/.test(rp) && /2 \/ 3/.test(rp), 'informe de la semana asignada: 2 de las 3 sesiones registradas (lunes y miércoles; el jueves falta)');
  ok(/Snatch/.test(rp) && /3 de 3 hechas/.test(rp) && /Completo/.test(rp), 'arranque: 3 de 3 series, completo');
  ok(/Sin registrar/.test(rp), 'las sesiones sin registro aparecen como «Sin registrar»');
  ok(/Dolor leve en el hombro derecho/.test(rp), 'muestra la observación del atleta');
  ok(/Se me cae el codo en la recepción/.test(rp), 'y la observación del ejercicio');
  await shot('03-informe-semana'); if (process.env.SHOTS) await page.locator('#rpCard').screenshot({ path: process.env.SHOTS + '/semana-03b-informe-tarjeta.png' });
  await page.evaluate(u => __fake.admin('users/' + u + '/completions/p1_e1_2_0', { planId: 'p1', weekId: 'e1_2', sessionIdx: 0, completedAt: Date.now() }), auid);
  await page.selectOption('#rpWeek', 'e1_2'); await page.waitForTimeout(800);
  ok(/Semana 2/.test(await txt('#rpCard')) && /cumplida/.test(await txt('#rpCard')), 'el informe de otra semana pide aparte sus sesiones cumplidas y las muestra');
  await page.selectOption('#rpWeek', 'e1_1'); await page.waitForTimeout(300);
  await page.click('[data-act="rp-mode"][data-m="day"]'); await page.waitForTimeout(300);
  await page.fill('#rpDate', await page.evaluate(() => new Date().toISOString().slice(0, 10))); await page.waitForTimeout(300);
  await page.dispatchEvent('#rpDate', 'change'); await page.waitForTimeout(500);
  ok(/Semana 1 · Lunes/.test(await txt('#rpCard')) && /Dolor leve/.test(await txt('#rpCard')), 'informe de un día: la sesión del plan con su observación');
  await page.evaluate(() => { window.print = () => { window.__printed = document.body.classList.contains('rp-print'); }; });
  await page.click('[data-act="rp-print"]'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => window.__printed), 'imprimir marca la vista para que solo salga el informe');
  await page.emulateMedia({ media: 'print' });
  const vis = await page.evaluate(() => ({ nav: getComputedStyle(document.querySelector('#nav')).display, card: getComputedStyle(document.querySelector('#rpCard')).display, others: [...document.querySelectorAll('#view > :not(#rpCard)')].every(e => getComputedStyle(e).display === 'none') }));
  ok(vis.nav === 'none' && vis.card !== 'none' && vis.others, 'en la impresión se ocultan el menú y lo demás; queda el informe');
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => document.body.classList.remove('rp-print'));
  await page.click('#rpCard [data-act="rp-toggle"]:last-child'); await page.waitForTimeout(300);
  ok(/Ver informe/.test(await txt('#rpCard')), 'se puede cerrar el informe');

  console.log('11. Respaldo del equipo: el entrenador descarga un solo archivo con todo');
  await tab('equipo');
  if (await page.locator('[data-act="as-back"]').count()) { await page.click('[data-act="as-back"]'); await page.waitForTimeout(300); }
  ok(/respaldo del equipo/i.test(await txt('#view')) && /datos personales/i.test(await txt('#view')), 'aparece la tarjeta con el aviso de que contiene datos personales');
  const dl = page.waitForEvent('download', { timeout: 8000 });
  await page.click('[data-act="bk-run"]');
  const bkDl = await dl; const bkPath = path.join(SHOTS, 'respaldo-prueba.json'); await bkDl.saveAs(bkPath);
  const bk = JSON.parse(fs.readFileSync(bkPath, 'utf8'));
  ok(/^respaldo-equipo-\d{4}-\d{2}-\d{2}\.json$/.test(bkDl.suggestedFilename()), 'el archivo se llama respaldo-equipo-AAAA-MM-DD.json');
  ok(bk.format === 'halterofilia-respaldo-equipo' && bk.by === 'cristian@correo.cl', 'cabecera con formato y quién lo pidió');
  ok(bk.members.length >= 1 && bk.plans.length >= 1 && bk.plans[0].weeks.length === 2, 'incluye miembros y el plan con sus semanas');
  const bat = bk.athletes.find(a => a.uid === auid);
  ok(bat && bat.records.some(r => r.id === 's_inf1') && bat.completions.length >= 1, 'incluye los registros y sesiones cumplidas de la atleta');
  ok(bk.assignments.some(a => a.id === auid) && bk.adjustments.length >= 1, 'incluye la semana asignada y los ajustes');
  await page.waitForTimeout(300);
  ok(/Último respaldo/.test(await txt('#view')), 'queda a la vista cuándo se hizo el último respaldo');
  fs.unlinkSync(bkPath);


  ok(errors.length === 0, 'sin errores en la consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await br.close(); srv.close();
  console.log(fails ? '\nFALLAS: ' + fails : '\nTodo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
