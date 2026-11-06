/* Teléfono: pantalla fija (sin zoom), campos de 16 px, temporizador que se abre tocándolo en cualquier parte
   (menos el botón de pausa) y repeticiones planificadas sombreadas. Uso: node tests/phone-e2e.js */
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

  console.log('0. Preparación');
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

  console.log('1. Pantalla fija');
  const vp = await page.evaluate(() => document.querySelector('meta[name=viewport]').content);
  ok(/maximum-scale=1/.test(vp) && /user-scalable=no/.test(vp), 'el viewport impide el zoom: ' + vp);
  ok((await page.evaluate(() => getComputedStyle(document.documentElement).touchAction)) === 'manipulation', 'sin zoom por doble toque (touch-action: manipulation)');
  const gest = await page.evaluate(() => { const e = new Event('gesturestart', { cancelable: true, bubbles: true }); document.body.dispatchEvent(e); return e.defaultPrevented; });
  ok(gest, 'el gesto de pellizco (iOS) se bloquea');
  const pinch = await page.evaluate(() => {
    const mk = (id, x) => new Touch({ identifier: id, target: document.body, clientX: x, clientY: 100 });
    const e = new TouchEvent('touchmove', { touches: [mk(1, 50), mk(2, 150)], cancelable: true, bubbles: true }); document.body.dispatchEvent(e);
    const one = new TouchEvent('touchmove', { touches: [mk(1, 50)], cancelable: true, bubbles: true }); document.body.dispatchEvent(one);
    return [e.defaultPrevented, one.defaultPrevented];
  });
  ok(pinch[0] === true && pinch[1] === false, 'el pellizco con dos dedos se bloquea y el desplazamiento con uno no');

  console.log('2. Ningún campo baja de 16 px (iOS acerca la pantalla al tocarlos)');
  const small = () => page.evaluate(() => [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([hidden]), select, textarea')].filter(e => e.offsetParent !== null).map(e => ({ id: e.id || e.className, fs: parseFloat(getComputedStyle(e).fontSize) })).filter(x => x.fs < 16));
  await page.evaluate(() => HalterApp.commit(S => { S.exercises.find(e => e.id === 'snatch').max = 120; }));
  await tab('semana'); await page.waitForSelector('#myWeek');
  await page.selectOption('#myWeek', 'e1_1'); await page.click('[data-act="as-self"]'); await page.waitForSelector('[data-act="as-start"]');
  ok((await small()).length === 0, 'Mi semana: ' + JSON.stringify(await small()));
  await page.click('[data-act="as-start"][data-i="0"]'); await page.waitForSelector('.tick');
  ok((await small()).length === 0, 'sesión en curso (kg, reps, %, observación): ' + JSON.stringify(await small()));
  await page.click('#gear'); await page.waitForSelector('#sSex');
  ok((await small()).length === 0, 'Ajustes: ' + JSON.stringify(await small()));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await tab('equipo');
  ok((await small()).length === 0, 'Equipo: ' + JSON.stringify(await small()));
  await tab('hoy');

  console.log('3. Repeticiones del plan sombreadas');
  const ph = await page.locator('[data-f="reps"]').evaluateAll(l => l.map(x => x.placeholder + '|' + x.value));
  ok(ph.join(',') === '3|,3|,1|', 'placeholder con lo planificado y valor vacío: ' + ph.join(','));
  const col = await page.evaluate(() => { const i = document.querySelector('[data-f="reps"]'); return getComputedStyle(i, '::placeholder').opacity; });
  ok(parseFloat(col) < 1, 'el texto sombreado se ve más tenue que lo escrito');
  await page.locator('.tick').first().click();
  ok((await page.locator('.set.is-done').count()) === 0, 'no se puede marcar una serie sin anotar las repeticiones');
  await page.locator('[data-f="reps"]').first().fill('2'); await page.locator('.tick').first().click();
  ok((await page.locator('.set.is-done').count()) === 1, 'con las repeticiones anotadas, sí');

  console.log('4. Temporizador: se abre tocándolo en cualquier parte, salvo el botón de pausa');
  await page.waitForSelector('#dockBox');
  const hide = page.locator('[data-act="dock-min"]').first();
  if (!(await page.locator('#dockBox.min').count())) { await hide.click(); await page.waitForTimeout(200); }
  ok((await page.locator('#dockBox.min').count()) === 1, 'el temporizador está minimizado');
  await page.screenshot({ path: path.join(SHOTS, 'phone-dock-min.png') });
  const bb = await page.locator('#dockBox').boundingBox();
  await page.click('#dockBox .rbtn.play'); await page.waitForTimeout(200);
  ok((await page.locator('#dockBox.min').count()) === 1, 'el botón de pausa/reanudar no lo abre');
  // borde izquierdo de la barra (fuera del texto) y centro entre el reloj y el botón
  await page.mouse.click(bb.x + 3, bb.y + bb.height / 2); await page.waitForTimeout(250);
  ok((await page.locator('#dockBox.min').count()) === 0, 'tocar el borde de la barra lo abre');
  await page.click('[data-act="dock-min"]:has-text("Ocultar")'); await page.waitForTimeout(200);
  const bb2 = await page.locator('#dockBox').boundingBox();
  await page.mouse.click((bb2.x + bb2.width) - 3, bb2.y + 3); await page.waitForTimeout(250);
  ok((await page.locator('#dockBox.min').count()) === 0, 'tocar cualquier otra zona (esquina) también lo abre');
  await page.click('[data-act="dock-min"]:has-text("Ocultar")'); await page.waitForTimeout(200);
  await page.click('#dockBox .dock-time'); await page.waitForTimeout(250);
  ok((await page.locator('#dockBox.min').count()) === 0, 'tocar el reloj lo abre');

  ok(errors.length === 0, 'sin errores en la consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await br.close(); srv.close();
  console.log(fails ? '\nFALLAS: ' + fails : '\nTodo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
