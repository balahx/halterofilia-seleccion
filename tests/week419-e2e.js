/* 4.19.0: «Semana» con los días plegables (solo hoy abierto), condiciones para cambiar de semana a la vista, sesiones del
   Historial que quedaron sin «Cumplida» se registran solas, y vista previa de la rutina para el atleta antes de iniciarla.
   Uso: node tests/week419-e2e.js */
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
  const shot = n => page.screenshot({ path: path.join(SHOTS, 's419-' + n + '.png') });
  const txt = sel => page.locator(sel).first().innerText();
  const docs = () => page.evaluate(() => __fake.srv().docs);
  const logout = async () => { await page.click('#gear'); await page.click('[data-act="cl-logout"]'); await page.waitForSelector('#gForm'); await page.waitForTimeout(500); };
  const signup = async (name, email) => { await page.click('[data-g="mode"][data-v="signup"]'); await page.selectOption('#gSex', 'F'); await page.fill('#gName', name); await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.fill('#gPass2', 'clave123'); await page.check('#gPriv'); await page.click('#gForm button[type=submit]'); await page.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || '')); };
  const login = async email => { await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.click('#gForm button[type=submit]'); await page.waitForSelector('#appRoot:not([hidden])'); };
  const tab = async t => { await page.click('#nav button[data-tab="' + t + '"]'); await page.waitForTimeout(250); };
  // el atleta anota las repeticiones que hizo (aquí, las mismas del plan) y marca cada serie
  const tickAll = async () => { const r = page.locator('[data-f="reps"]'); for (let i = 0; i < await r.count(); i++) { if (!(await r.nth(i).inputValue())) await r.nth(i).fill(await r.nth(i).getAttribute('placeholder')); } for (const t of await page.locator('.tick').all()) await t.click(); };
  const remoteTry = (fn) => page.evaluate(async src => { try { await (new Function('r', 'return (async()=>{' + src + '})()'))(window.HALTER_REMOTE_FACTORY()); return 'ok'; } catch (e) { return e.code || String(e.message); } }, fn);

  console.log('0. Preparación');
  await page.goto(URL); await page.waitForSelector('#gForm');
  await signup('Cristian Mateluna', 'cristian@correo.cl');
  const cuid = await page.evaluate(() => __fake.uid('cristian@correo.cl'));
  await page.evaluate(u => __fake.admin('config/team', { coachUid: u }), cuid);
  await page.waitForSelector('#appRoot:not([hidden])'); await logout();
  await signup('Ana Rojas', 'ana@correo.cl');
  const auid = await page.evaluate(() => __fake.uid('ana@correo.cl'));
  await page.evaluate(u => __fake.admin('members/' + u, { name: 'Ana Rojas', email: 'ana@correo.cl', approvedAt: Date.now() }), auid);
  await page.waitForSelector('#appRoot:not([hidden])');
  const today = await page.evaluate(() => ((new Date().getDay() + 6) % 7) + 1), other = today % 7 + 1;
  await page.evaluate(({ W, today, other, u, c }) => {
    __fake.admin('exercises/snatch', { en: 'Snatch', es: 'Arranque', aliases: [] }); __fake.admin('exercises/snatch-pull', { en: 'Snatch Pull', es: 'Tirón de arranque', aliases: [] });
    __fake.admin('plans/p1', { name: 'Plan 2026', year: 2026, format: 'x', stages: 1, weeks: 2, createdAt: Date.now() });
    __fake.admin('plans/p1/stages/e1', { name: 'Preparatorio General', order: 1 });
    const w1 = JSON.parse(JSON.stringify(W.e1_1)); w1.sessions[0].day = today; w1.sessions[1].day = other;
    __fake.admin('plans/p1/weeks/e1_1', w1); __fake.admin('plans/p1/weeks/e1_2', W.e1_2);
    __fake.admin('assignments/' + u, { planId: 'p1', weekId: 'e1_1', week: 1, stageId: 'e1', weekEndsAt: Date.now() - 3600000, setBy: c });
    __fake.admin('routines/r1', { uid: u, name: 'Iniciación', note: '', mode: 'extra', setBy: c, at: Date.now(),
      sessions: [{ name: 'Técnica', day: today, days: [today], items: [{ exId: 'snatch', name: 'Snatch', cat: 'comp', sets: 3, reps: '3', pct: 70, kg: 0, rest: 120, pause: 2, desc: 'Barra desde el suelo' }, { exId: 'plank', name: 'Plancha', cat: 'pc', sets: 2, reps: '30', pct: 0, kg: 0, rest: 60, pause: 0, meas: 'time' }] }] });
  }, { W: WEEKS, today, other, u: auid, c: cuid });
  await page.evaluate(() => { const S = HalterApp.state(); S.exercises.find(e => e.id === 'snatch').max = 100; HalterApp.render(); });
  await page.reload(); await page.waitForSelector('#appRoot:not([hidden])'); await page.waitForTimeout(1200);

  console.log('1. «Semana»: solo el día de hoy abierto');
  await tab('semana'); await page.waitForTimeout(500);
  const st = () => page.evaluate(() => [...document.querySelectorAll('#view details.fold')].map(d => d.open));
  ok(JSON.stringify(await st()) === '[true,false]', 'hoy abierto y el otro día plegado: ' + JSON.stringify(await st()));
  const v0 = await txt('#view');
  ok(/Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo/.test(v0) && /Fuerza tracción/.test(await page.evaluate(() => document.querySelectorAll('#view details.fold')[1].querySelector('summary').innerText + document.querySelectorAll('#view details.fold')[1].innerHTML)), 'el día plegado muestra su título');
  await page.locator('#view details.fold >> nth=1').locator('summary').click(); await page.waitForTimeout(150);
  await page.evaluate(() => HalterApp.render()); await page.waitForTimeout(150);
  ok(JSON.stringify(await st()) === '[true,true]', 'al abrirlo queda abierto aunque la pantalla se redibuje');
  await shot('01-semana');

  console.log('2. Condiciones para cambiar de semana a la vista');
  let v = await txt('#view');
  ok(/✗\s*Sesiones cumplidas: 0 de 2 · faltan /.test(v) && /✓\s*Corte: .* · ya pasó/.test(v), 'dice cuántas sesiones faltan (y cuáles) y que el corte ya pasó');
  ok(/la inicias desde esta semana/.test(v), 'explica cuándo una sesión cuenta como cumplida');

  console.log('3. Sesión del plan terminada en el Historial pero sin «Cumplida»: se registra sola');
  await page.evaluate(() => {
    const S = HalterApp.state();
    S.sessions.push({ id: 'perdida', date: '2026-11-10', name: 'Lunes', startedAt: Date.now() - 9e6, endedAt: Date.now() - 8e6, notes: '', plan: { planId: 'p1', weekId: 'e1_1', idx: 1 },
      items: [{ exId: 'snpull', rest: 120, p: 2, sets: [{ kg: 90, reps: '3', done: true, doneAt: Date.now() - 8.5e6 }, { kg: 90, reps: '3', done: true, doneAt: Date.now() - 8.4e6 }] }] });
    S.sessions.push({ id: 'vacia', date: '2026-11-11', name: 'Hoy', startedAt: Date.now() - 7e6, endedAt: Date.now() - 6e6, notes: '', plan: { planId: 'p1', weekId: 'e1_1', idx: 0 }, items: [{ exId: 'snatch', rest: 120, p: 2, sets: [{ kg: 70, reps: '', done: false }] }] });
  });
  await page.reload(); await page.waitForSelector('#appRoot:not([hidden])'); await page.waitForTimeout(1500);
  const d = await docs();
  ok(!!d['users/' + auid + '/completions/p1_e1_1_1'], 'la sesión terminada con series hechas quedó «Cumplida»');
  ok(!d['users/' + auid + '/completions/p1_e1_1_0'], 'una sesión sin nada hecho no cuenta');
  await tab('semana'); await page.waitForTimeout(400);
  ok(/Sesiones cumplidas: 1 de 2/.test(await txt('#view')), 'ahora dice 1 de 2');

  console.log('4. Vista previa de la rutina antes de iniciarla');
  const prev = page.locator('details.rt-prev').first();
  ok(await prev.count() === 1 && !(await prev.evaluate(e => e.open)), 'cada sesión de la rutina tiene «Ver ejercicios» (cerrado)');
  await prev.locator('summary').click(); await page.waitForTimeout(150);
  const pv = await prev.innerText();
  ok(/Arranque|Snatch/.test(pv) && /3 × 3/.test(pv) && /70 % → 70 kg/.test(pv) && /pausa de 2 s en el movimiento/.test(pv) && /descanso 2:00/.test(pv) && /Barra desde el suelo/.test(pv), 'muestra ejercicios, series × reps, % → kg con su máximo, pausa, descanso y descripción: ' + pv.replace(/\n/g, ' | '));
  ok(/Plancha/.test(pv) && /2 × 30 s/.test(pv), 'un ejercicio de tiempo se ve en segundos');
  ok(await page.evaluate(() => !HalterApp.state().sessions.some(x => !x.endedAt)), 'mirar no inicia nada');
  await page.evaluate(() => HalterApp.render()); await page.waitForTimeout(150);
  ok(await page.locator('details.rt-prev').first().evaluate(e => e.open), 'queda abierta al redibujar');
  await shot('02-rutina');

  console.log('5. Semana sin enlace a la siguiente (4.19.1): lo dice claro');
  await page.evaluate(({ today, other }) => { const w = JSON.parse(JSON.stringify(__fake.srv().docs['plans/p1/weeks/e1_1'])); w.next = ''; __fake.admin('plans/p1/weeks/e1_1', w); }, { today, other });
  await page.reload(); await page.waitForSelector('#appRoot:not([hidden])'); await page.waitForTimeout(1200); await tab('semana'); await page.waitForTimeout(400);
  ok(/no está enlazada con la siguiente en el plan \(tiene 2 semanas\)/.test(await txt('#view')), 'avisa que la semana no está enlazada y qué hacer');

  await br.close(); srv.close();
  ok(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log(fails ? '\nFALLAS: ' + fails : '\nTodo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
