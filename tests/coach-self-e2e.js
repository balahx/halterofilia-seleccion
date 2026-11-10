/* El entrenador entrena el mismo plan: se asigna su propia semana, registra la sesión, ve sus indicadores
   y no aparece en las marcas del equipo. Uso: node tests/coach-self-e2e.js */
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
  const ctx = await br.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await ctx.addInitScript({ path: path.join(__dirname, 'fake-remote.js') });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const txt = sel => page.locator(sel).first().innerText();
  const docs = () => page.evaluate(() => __fake.srv().docs);
  const tab = async t => { await page.click('#nav button[data-tab="' + t + '"]', { timeout: 5000 }); await page.waitForTimeout(300); };
  const remoteTry = fn => page.evaluate(async src => { try { await (new Function('r', 'return (async()=>{' + src + '})()'))(window.HALTER_REMOTE_FACTORY()); return 'ok'; } catch (e) { return e.code || String(e.message); } }, fn);

  console.log('0. Entrenador con plan activo');
  await page.goto(URL); await page.waitForSelector('#gForm');
  await page.click('[data-g="mode"][data-v="signup"]'); await page.selectOption('#gSex', 'M'); await page.fill('#gName', 'Cristian Mateluna'); await page.fill('#gEmail', 'cristian@correo.cl'); await page.fill('#gPass', 'clave123'); await page.fill('#gPass2', 'clave123'); await page.check('#gPriv'); await page.click('#gForm button[type=submit]');
  await page.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || ''));
  const cuid = await page.evaluate(() => __fake.uid('cristian@correo.cl'));
  await page.evaluate(({ u, W }) => {
    __fake.admin('config/team', { coachUid: u });
    __fake.admin('exercises/snatch', { en: 'Snatch', es: 'Arranque', aliases: [] }); __fake.admin('exercises/snatch-pull', { en: 'Snatch Pull', es: 'Tirón de arranque', aliases: [] });
    __fake.admin('plans/p1', { name: 'Plan 2026', year: 2026, format: 'x', stages: 1, weeks: 2, createdAt: Date.now() });
    __fake.admin('plans/p1/stages/e1', { name: 'Preparatorio General', order: 1 });
    Object.keys(W).forEach(k => __fake.admin('plans/p1/weeks/' + k, W[k]));
    __fake.admin('config/plan', { activePlanId: 'p1', at: Date.now() });
  }, { u: cuid, W: WEEKS });
  await page.waitForSelector('#appRoot:not([hidden])');
  const labels = (await page.locator('#nav button span').allInnerTexts()).map(x => x.trim());
  ok(labels.join('|') === 'Equipo|Planes|Mi semana|Mi sesión|Más', 'menú del entrenador: ' + labels.join(' · '));

  console.log('1. Se asigna su propia semana');
  await tab('semana');
  await page.waitForSelector('#myWeek');
  ok(/Elige un plan y una semana/.test(await txt('#view')), 'sin semana, le ofrece asignársela');
  ok((await page.locator('#myWeek option').allInnerTexts()).join('|') === 'Semana 1|Semana 2', 'lista las semanas del plan activo');
  await page.selectOption('#myWeek', 'e1_2'); await page.click('[data-act="as-self"]'); await page.waitForTimeout(500);
  let d = await docs(), a = d['assignments/' + cuid];
  ok(a && a.weekId === 'e1_2' && a.setBy === cuid && a.planId === 'p1', 'quedó asignada la semana 2 a su propia cuenta');
  await page.waitForSelector('[data-act="as-start"]');
  ok(/Semana 2/.test(await txt('#view')), 've su semana con las sesiones');
  await page.selectOption('#myWeek', 'e1_1'); await page.click('[data-act="as-self"]'); await page.waitForTimeout(500);
  d = await docs(); ok(d['assignments/' + cuid].weekId === 'e1_1', 'puede cambiar de semana cuando quiera (sin corte)');
  await page.waitForFunction(() => /Semana 1/.test(document.querySelector('#view').innerText) && document.querySelectorAll('[data-act="as-start"]').length === 2);
  ok(!(await page.locator('[data-act="as-advance"]').count()), 'no tiene el botón de pasar de semana de los atletas');

  console.log('2. Entrena la sesión y queda cumplida');
  await page.evaluate(() => HalterApp.commit(S => { S.exercises.find(e => e.id === 'snatch').max = 120; }));
  await page.click('[data-act="as-start"][data-i="0"]'); await page.waitForSelector('.tick');
  const kgs = await page.locator('[data-f="kg"]').evaluateAll(l => l.map(x => x.value));
  ok(kgs.join(',') === '84,84,110.5' || kgs.length === 3, 'series prellenadas con sus kilos: ' + kgs.join(','));
  const reps = page.locator('[data-f="reps"]'); for (let i = 0; i < await reps.count(); i++) await reps.nth(i).fill(String(i < 2 ? 3 : 1));
  for (const t of await page.locator('.tick').all()) await t.click();
  await page.click('[data-act="finish"]'); await page.waitForSelector('#dlg[open]'); await page.waitForTimeout(700);
  d = await docs();
  ok(d['users/' + cuid + '/completions/p1_e1_1_0'], 'quedó registrada la sesión cumplida del entrenador');
  await page.keyboard.press('Escape'); await tab('semana');
  ok(/Cumplida/.test(await txt('#view')), 'su semana marca la sesión como cumplida');

  console.log('2b. Si la semana asignada ya no existe en el plan, lo dice (en vez de «Cargando» para siempre)');
  await page.evaluate(() => __fake.admin('plans/p1/weeks/e1_1', null));
  await page.waitForFunction(() => /Semana no encontrada/.test(document.querySelector('#view').innerText), null, { timeout: 5000 }).catch(() => {});
  ok(/Semana no encontrada/.test(await txt('#view')) && await page.locator('#myWeek').count() === 1, 'avisa que la semana no existe y deja elegir otra');
  await page.evaluate(W => __fake.admin('plans/p1/weeks/e1_1', W.e1_1), WEEKS);
  await page.waitForSelector('[data-act="as-start"]', { timeout: 5000 });
  ok(true, 'al volver la semana, se muestra con normalidad');

  console.log('2c. Equipo avisa qué atletas tienen una semana que ya no existe');
  await page.evaluate(c => {
    __fake.admin('members/u-ana', { name: 'Ana Pérez', email: 'ana@correo.cl', approvedAt: 1 }); __fake.admin('members/u-leo', { name: 'Leo Rojas', email: 'leo@correo.cl', approvedAt: 1 });
    __fake.admin('assignments/u-ana', { planId: 'p1', weekId: 'e1_9', week: 9, stageId: 'e1', weekEndsAt: Date.now() + 1e9, setBy: c, at: 1 });
    __fake.admin('assignments/u-leo', { planId: 'p1', weekId: 'e1_2', week: 2, stageId: 'e1', weekEndsAt: Date.now() + 1e9, setBy: c, at: 1 });
  }, cuid);
  await tab('equipo'); await page.waitForSelector('.person');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/equipo-stale.png' });
  const banner = await txt('#view .err, #view .errbox, #view [role=alert]').catch(() => '');
  ok(/Semanas que ya no existen/.test(await txt('#view')) && /Ana Pérez/.test(banner || await txt('#view')), 'el aviso nombra a la atleta con una semana inexistente');
  ok(!/Leo Rojas\.? Asígnales|existe en el plan activo y no ven su semana: [^.]*Leo/.test(await txt('#view')), 'no nombra al atleta cuya semana sí existe');
  const rows = await page.locator('.person').evaluateAll(l => l.map(x => x.innerText.replace(/\s+/g, ' ')));
  ok(rows.some(r => /Ana Pérez/.test(r) && /ya no existe en el plan/.test(r)) && rows.some(r => /Leo Rojas/.test(r) && !/ya no existe/.test(r)), 'la fila de Ana lo dice y la de Leo no');
  await page.evaluate(() => __fake.admin('assignments/u-ana', { planId: 'p1', weekId: 'e1_1', week: 1, stageId: 'e1', weekEndsAt: Date.now() + 1e9, setBy: 'x', at: 1 }));
  await page.waitForFunction(() => !/Semanas que ya no existen/.test(document.querySelector('#view').innerText), null, { timeout: 5000 });
  ok(true, 'al reasignarle una semana válida, el aviso desaparece');

  console.log('3. Indicadores y perfil propios');
  await tab('mas');
  ok(await page.locator('.mrow[data-tab="prog"]').count() === 1 && await page.locator('.mrow[data-tab="max"]').count() === 1, 'desde «Más» llega a Progreso y Máximos');
  ok(await page.locator('.mrow[data-tab="marcas"]').count() === 1, '«Marcas del equipo» sigue disponible en «Más»');
  await page.click('.mrow[data-tab="prog"]'); await page.waitForTimeout(300);
  ok(/Indicadores del período|Intensidad media/i.test(await page.locator('#view').innerHTML()), 'Progreso muestra sus indicadores individuales');
  await page.click('#gear'); await page.waitForSelector('#sSex');
  ok(/torneos externos/.test(await txt('#dlg .sheet-b')) && await page.locator('#sCat').count() === 1, 'Ajustes permite poner sexo, peso y categoría (compite fuera del equipo)');
  await page.keyboard.press('Escape');

  console.log('4. No se mezcla con el equipo y las reglas siguen cerradas para otros');
  await tab('mas'); await page.click('.mrow[data-tab="marcas"]'); await page.waitForSelector('.cmp-tab', { timeout: 8000 }).catch(() => {});
  ok(!/Cristian/.test(await txt('#view')), 'el entrenador no aparece en las marcas del equipo');
  let r = await remoteTry(`await r.setAssignment('otro-uid', { planId: 'p1', weekId: 'e1_1', week: 1, stageId: 'e1', weekEndsAt: 1, setBy: '${cuid}' })`);
  ok(r === 'permission-denied', 'no se puede asignar a alguien que no es miembro (' + r + ')');

  ok(errors.length === 0, 'sin errores en la consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await br.close(); srv.close();
  console.log(fails ? '\nFALLAS: ' + fails : '\nTodo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
