/* 4.15.0: plan en un solo documento. La app del entrenador lo arma sola (sin botón) y la del atleta lo usa:
   semana, etapas y catálogo con 1 lectura en vez de una por documento. Uso: node tests/fastplan-e2e.js */
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
  const shot = n => page.screenshot({ path: path.join(SHOTS, 'fast-' + n + '.png') });
  const txt = sel => page.locator(sel).first().innerText();
  const docs = () => page.evaluate(() => __fake.srv().docs);
  const logout = async () => { await page.click('#gear'); await page.click('[data-act="cl-logout"]'); await page.waitForSelector('#gForm'); await page.waitForTimeout(500); };
  const signup = async (name, email) => { await page.click('[data-g="mode"][data-v="signup"]'); await page.selectOption('#gSex', 'F'); await page.fill('#gName', name); await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.fill('#gPass2', 'clave123'); await page.check('#gPriv'); await page.click('#gForm button[type=submit]'); await page.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || '')); };
  const login = async email => { await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.click('#gForm button[type=submit]'); await page.waitForSelector('#appRoot:not([hidden])'); };
  const tab = async t => { await page.click('#nav button[data-tab="' + t + '"]'); await page.waitForTimeout(250); };
  // el atleta anota las repeticiones que hizo (aquí, las mismas del plan) y marca cada serie
  const tickAll = async () => { const r = page.locator('[data-f="reps"]'); for (let i = 0; i < await r.count(); i++) { if (!(await r.nth(i).inputValue())) await r.nth(i).fill(await r.nth(i).getAttribute('placeholder')); } for (const t of await page.locator('.tick').all()) await t.click(); };
  const remoteTry = (fn) => page.evaluate(async src => { try { await (new Function('r', 'return (async()=>{' + src + '})()'))(window.HALTER_REMOTE_FACTORY()); return 'ok'; } catch (e) { return e.code || String(e.message); } }, fn);

  const gets = () => page.evaluate(() => Object.assign({}, __fake.gets || {}));
  const resetGets = () => page.evaluate(() => { __fake.gets = {}; __fake.fastWrites = 0; });
  const fastDoc = () => page.evaluate(() => __fake.srv().docs['plans/p1/fast/all'] || null);

  console.log('0. Preparación: entrenador, atleta y un plan publicado (sin documento único)');
  await page.goto(URL); await page.waitForSelector('#gForm');
  await signup('Cristian Mateluna', 'cristian@correo.cl');
  const cuid = await page.evaluate(() => __fake.uid('cristian@correo.cl'));
  await page.evaluate(u => __fake.admin('config/team', { coachUid: u }), cuid);
  await page.waitForSelector('#appRoot:not([hidden])'); await logout();
  await signup('Ana Rojas', 'ana@correo.cl');
  const auid = await page.evaluate(() => __fake.uid('ana@correo.cl'));
  await page.evaluate(u => __fake.admin('members/' + u, { name: 'Ana Rojas', email: 'ana@correo.cl', approvedAt: Date.now() }), auid);
  await page.waitForSelector('#appRoot:not([hidden])');
  await page.evaluate(({ W }) => {
    for (let i = 0; i < 60; i++) __fake.admin('exercises/x' + i, { en: 'Extra ' + i, es: 'Extra ' + i, aliases: [] });
    __fake.admin('exercises/snatch', { en: 'Snatch', es: 'Arranque', aliases: [] }); __fake.admin('exercises/snatch-pull', { en: 'Snatch Pull', es: 'Tirón de arranque', aliases: [] });
    __fake.admin('plans/p1', { name: 'Plan 2026', year: 2026, format: 'x', stages: 1, weeks: 2, createdAt: Date.now() });
    __fake.admin('plans/p1/stages/e1', { name: 'Preparatorio General', order: 1 });
    Object.keys(W).forEach(k => __fake.admin('plans/p1/weeks/' + k, W[k]));
    __fake.admin('config/plan', { activePlanId: 'p1', at: Date.now() });
  }, { W: WEEKS });
  await page.evaluate(({ u, c }) => __fake.admin('assignments/' + u, { planId: 'p1', weekId: 'e1_1', week: 1, stageId: 'e1', weekEndsAt: HalterAssign.pure.cutoffFor(Date.now()), setBy: c }), { u: auid, c: cuid });
  await page.waitForTimeout(500); await logout();
  ok(!(await fastDoc()), 'antes de que entre el entrenador no existe el documento único');

  console.log('1. El entrenador abre la app: el documento único se arma solo');
  await login('cristian@correo.cl'); await page.waitForTimeout(1500);
  let f = await fastDoc();
  ok(!!f && f.v.indexOf('p1|') === 0 && typeof f.h === 'string' && f.at > 0, 'se creó plans/p1/fast/all con la versión del plan y su huella');
  ok(f && f.enc === 'gzip' && f.z.length < 6000, 'va comprimido (' + (f && f.z.length) + ' caracteres)');
  ok(!(await page.locator('[data-act*="fast"], button:has-text("lectura rápida")').count()), 'sin botón: el entrenador no tiene que hacer nada');
  await tab('equipo'); ok(/Ana Rojas/.test(await txt('#view')), 'la app del entrenador sigue normal');
  await page.reload(); await page.waitForSelector('#appRoot:not([hidden])'); await resetGets(); await page.reload(); await page.waitForSelector('#appRoot:not([hidden])'); await page.waitForTimeout(1500);
  ok(await page.evaluate(() => __fake.fastWrites || 0) === 0, 'al volver a abrir no lo reescribe si nada cambió');
  await logout();

  console.log('2. La atleta entra con el dispositivo vacío: 1 lectura del documento único');
  await resetGets();
  await login('ana@correo.cl'); await page.waitForTimeout(1500);
  let g = await gets();
  ok((g['plans/p1/fast/all'] || 0) === 1, 'leyó el documento único una vez');
  ok(!g['exercises'] && !g['plans/p1/stages'] && !g['plans/p1/weeks/e1_1'], 'no bajó el catálogo, las etapas ni la semana por separado: ' + JSON.stringify(g));
  await tab('semana');
  const v = await txt('#view');
  ok(/Semana 1/i.test(v) && /Preparatorio General/.test(v) && /Snatch/.test(v) && /Arranque/.test(v), 've su semana, la etapa y los ejercicios en ambos idiomas');
  await shot('01-atleta-semana');
  await resetGets(); await page.reload(); await page.waitForSelector('#appRoot:not([hidden])'); await page.waitForTimeout(1500);
  g = await gets();
  ok(!g['plans/p1/fast/all'] && !g['exercises'], 'al volver a abrir sale de la copia guardada (solo la ficha del plan): ' + JSON.stringify(g));

  console.log('3. Se publica una versión nueva del plan: el entrenador lo rearma y la atleta lo baja una vez');
  await logout();
  await page.evaluate(W => __fake.admin('plans/p1/weeks/e1_1', Object.assign({}, W.e1_1, { label: 'nueva' })), WEEKS);
  await login('cristian@correo.cl'); await page.waitForTimeout(1500);
  const f2 = await fastDoc();
  ok(f2 && f2.v !== f.v, 'el documento único quedó con la versión nueva');
  await logout(); await resetGets();
  await login('ana@correo.cl'); await page.waitForTimeout(1500);
  g = await gets();
  ok((g['plans/p1/fast/all'] || 0) === 1 && !g['exercises'], 'la atleta lo bajó una vez: ' + JSON.stringify(g));

  console.log('4. Si el documento único falta o quedó viejo, la atleta lee como antes');
  await page.evaluate(W => __fake.admin('plans/p1/weeks/e1_1', Object.assign({}, W.e1_1, { label: 'otra' })), WEEKS);   // versión nueva sin que el entrenador entre
  await page.waitForTimeout(1200); await tab('semana');
  g = await gets();
  ok(/Semana 1/i.test(await txt('#view')) && (g['plans/p1/weeks/e1_1'] || 0) >= 1, 'documento único viejo: se leyó la semana por separado y se ve igual');

  await br.close(); srv.close();
  ok(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log(fails ? '\nFALLAS: ' + fails : '\nTodo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
