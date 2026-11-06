/* Estados de error y escritorio de WL · Selección. Uso: node tests/error-e2e.js  (con SHOTS=carpeta guarda capturas) */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };

(async () => {
  await new Promise(r => srv.listen(0, r)); const URL = 'http://localhost:' + srv.address().port + '/';
  const br = await chromium.launch(), errors = [];
  const ctx = await br.newContext({ viewport: { width: +(process.env.VW || 390), height: +(process.env.VH || 780) }, deviceScaleFactor: +(process.env.DSF || 2), serviceWorkers: 'block', colorScheme: 'light' });
  await ctx.addInitScript({ path: path.join(__dirname, 'fake-remote.js') });
  await ctx.addInitScript(() => { window.__viol = []; document.addEventListener('securitypolicyviolation', e => window.__viol.push(e.violatedDirective + ' ' + e.blockedURI)); });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const txt = sel => page.locator(sel).first().innerText();
  const shot = n => page.screenshot({ path: path.join(SHOTS, 'err-' + n + '.png') });
  const navLabels = () => page.locator('#nav button span').allInnerTexts();
  const css = (sel, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [sel, prop]);
  const logout = async () => { await page.click('#nav [data-tab="mas"]'); await page.click('.mrow[data-act="cl-logout"]'); await page.waitForSelector('#gForm'); await page.waitForTimeout(500); };
  const signup = async (name, email, sex) => { await page.click('[data-g="mode"][data-v="signup"]'); await page.selectOption('#gSex', sex); await page.fill('#gName', name); await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.fill('#gPass2', 'clave123'); await page.check('#gPriv'); await page.click('#gForm button[type=submit]'); await page.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || '')); };
  const login = async email => { await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.click('#gForm button[type=submit]'); await page.waitForSelector('#appRoot:not([hidden])', { timeout: 8000 }); await page.waitForTimeout(300); };

  console.log('1. Sin servicio de cuentas: pantalla de error con reintento');
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('__t')) localStorage.setItem('fake.sdkfail', '1'); } catch (e) { /* sin storage */ } });
  await page.goto(URL); await page.waitForSelector('#gate .big-ico');
  ok(await page.locator('#gate .big-ico.is-warn').count() === 1, 'el icono de error va en rojo');
  ok(/Sin conexión/.test(await txt('#gate h1')) && /Reintentar/.test(await txt('#gate')), 'título «Sin conexión» y botón Reintentar');
  await shot('01-sin-servicio');
  await page.evaluate(() => { localStorage.setItem('fake.sdkfail', '0'); });
  await page.click('[data-g="retry"]'); await page.waitForSelector('#gForm', { timeout: 8000 });
  ok(true, 'al reintentar vuelve el ingreso');

  console.log('2. Atleta sin conexión: franja de aviso y reintento');
  await signup('Camila Rojas', 'camila@correo.cl', 'F');
  const cuid = await page.evaluate(() => __fake.uid('camila@correo.cl'));
  await page.evaluate(u => __fake.admin('members/' + u, { name: 'Camila Rojas', email: 'camila@correo.cl', approvedAt: Date.now() }), cuid);
  await page.waitForSelector('#appRoot:not([hidden])'); await page.waitForTimeout(500);
  ok(await page.locator('#netBar').isHidden(), 'con conexión no hay franja');
  await ctx.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline'))); await page.waitForTimeout(500);
  ok(await page.locator('#netBar').isVisible(), 'sin conexión aparece la franja');
  ok(/Sin conexión/.test(await txt('#netBar')) && /dispositivo/.test(await txt('#netBar')), 'dice que todo se guarda en el dispositivo');
  await shot('02-sin-conexion');
  await ctx.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online'))); await page.waitForTimeout(900);
  ok(await page.locator('#netBar').isHidden(), 'al volver la señal la franja desaparece');

  console.log('3. Aviso de error común (errorBox)');
  const html = await page.evaluate(() => HalterApp.errorBox('Sin permiso: faltan las reglas de Firestore.', { retry: 'sync-now' }));
  ok(/role="alert"/.test(html) && /No se pudo cargar/.test(html) && /Reintentar/.test(html) && /data-act="sync-now"/.test(html), 'tiene rol de alerta, título y reintento');
  ok(!/Reintentar/.test(await page.evaluate(() => HalterApp.errorBox('x'))), 'sin acción no hay botón');
  ok(!/<b>x<\/b>|<script/.test(await page.evaluate(() => HalterApp.errorBox('<script>x</script>'))), 'el texto se escapa');
  await page.evaluate(h => { document.querySelector('#view').insertAdjacentHTML('afterbegin', h); }, html);
  await shot('03-aviso-error');
  ok(await page.locator('#view .errbox').count() === 1, 'se muestra en la pantalla');

  console.log('4. Escritorio: barra lateral y columnas');
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(250);
  const nav = await page.evaluate(() => { const r = document.querySelector('#nav').getBoundingClientRect(), v = document.querySelector('#view').getBoundingClientRect(); return { x: r.left, w: r.width, h: r.height, vx: v.left }; });
  ok(nav.x === 0 && nav.w > 200 && nav.w < 300 && nav.h > 400, 'el menú es una barra lateral (' + Math.round(nav.w) + ' px de ancho)');
  ok(nav.vx > nav.w, 'el contenido empieza a la derecha de la barra');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'sin desborde horizontal a 1280 px');
  ok((await page.evaluate(() => getComputedStyle(document.querySelector('#nav button')).flexDirection)) === 'row', 'los botones del menú van en fila (icono + texto)');
  await shot('04-escritorio-hoy');
  await page.click('#nav [data-tab="prog"]'); await page.waitForTimeout(250);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Progreso sin desborde a 1280 px');
  await page.setViewportSize({ width: 390, height: 780 }); await page.waitForTimeout(250);
  const nav2 = await page.evaluate(() => { const r = document.querySelector('#nav').getBoundingClientRect(); return { y: r.top, h: r.height }; });
  ok(nav2.y > 600 && nav2.h < 100, 'en el celular el menú vuelve a ir abajo');

  await br.close(); srv.close();
  ok(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log(fails ? '\nFALLAS: ' + fails : '\nTodo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
