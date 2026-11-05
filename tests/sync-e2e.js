/* Sincronización de punta a punta en la app real con el servidor simulado: envío, cola sin conexión y segundo dispositivo.
   Uso: node tests/sync-e2e.js */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
(async () => {
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port;
  const br = await chromium.launch();
  const errors = [];
  const mk = async () => {
    const ctx = await br.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' });
    await ctx.addInitScript({ path: path.join(__dirname, 'fake-remote.js') });
    const page = await ctx.newPage(); await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) errors.push(m.text()); });
    return page;
  };
  const openSettings = async p => { await p.click('#gear'); await p.waitForSelector('#syncStat'); };
  const closeSettings = async p => { await p.keyboard.press('Escape'); await p.waitForTimeout(150); };
  const recs = (p, uid) => p.evaluate(u => Object.fromEntries(Object.entries(__fake.srv().docs).filter(([k]) => k.startsWith('users/' + u + '/records/')).map(([k, v]) => [k.split('/')[3], v])), uid);
  const syncNow = async p => { await p.click('[data-act="sync-now"]'); await p.waitForTimeout(600); };

  console.log('1. Atleta aprobado: sus cambios llegan a la nube');
  const A = await mk();
  await A.goto('http://localhost:' + port + '/'); await A.waitForSelector('#gForm');
  await A.click('[data-g="mode"][data-v="signup"]');
  await A.fill('#gName', 'Ana Rojas'); await A.fill('#gEmail', 'ana@correo.cl'); await A.fill('#gPass', 'clave123'); await A.fill('#gPass2', 'clave123'); await A.check('#gPriv'); await A.click('#gForm button[type=submit]');
  await A.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || ''));
  const uid = await A.evaluate(() => __fake.uid('ana@correo.cl'));
  await A.evaluate(u => __fake.admin('members/' + u, { name: 'Ana Rojas', email: 'ana@correo.cl', approvedAt: Date.now() }), uid);
  await A.waitForSelector('#appRoot:not([hidden])');
  await openSettings(A);
  ok(/Conectando|Al día/.test(await A.locator('#syncStat').innerText()), 'ajustes muestra el estado de la sincronización');
  await A.fill('#sBw', '82'); await syncNow(A);
  let r = await recs(A, uid);
  ok(r.profile && JSON.parse(r.profile.d).bw === 82, 'el peso corporal llegó al servidor');
  ok(/Al día/.test(await A.locator('#syncStat').innerText()), 'estado «Al día»');
  ok(!r.plan && !Object.keys(r).some(k => k.startsWith('e_')), 'el plan y los ejercicios de fábrica no se envían');

  console.log('2. Sin conexión: queda en cola y se envía al volver');
  await A.evaluate(() => __fake.setOffline(true)); await A.waitForTimeout(300); // la pantalla se actualiza al cambiar la conexión
  await A.fill('#sBw', '83'); await A.click('[data-act="sync-now"]'); await A.waitForTimeout(500);
  ok(/Sin conexión|por enviar/.test(await A.locator('#syncStat').innerText()), 'muestra cambios por enviar: ' + (await A.locator('#syncStat').innerText()));
  r = await recs(A, uid); ok(JSON.parse(r.profile.d).bw === 82, 'el servidor sigue con el valor anterior');
  await A.reload(); await A.waitForSelector('#appRoot:not([hidden])');
  ok(true, 'la app abre sin conexión con los datos locales');
  await A.evaluate(() => __fake.setOffline(false)); await A.waitForTimeout(3500);
  r = await recs(A, uid); ok(JSON.parse(r.profile.d).bw === 83, 'al volver la conexión (y reabrir) se envía lo pendiente');

  console.log('3. Segundo dispositivo: baja los datos y los cambios en vivo');
  const B = await mk();
  await B.goto('http://127.0.0.1:' + port + '/'); await B.waitForSelector('#gForm');
  await B.evaluate(s => __fake.load(s), await A.evaluate(() => __fake.srv()));
  await B.fill('#gEmail', 'ana@correo.cl'); await B.fill('#gPass', 'clave123'); await B.click('#gForm button[type=submit]');
  await B.waitForSelector('#appRoot:not([hidden])'); await B.waitForTimeout(500);
  await openSettings(B);
  ok((await B.inputValue('#sBw')) === '83', 'B ve el peso corporal 83 que se guardó en A');
  const wrote = await B.evaluate(() => __fake.writes.length);
  ok(wrote === 0, 'B no escribió nada solo por abrir (' + wrote + ')');
  await openSettings(A); // A queda con los ajustes abiertos mientras B cambia algo
  await B.fill('#sBw', '84'); await syncNow(B);
  await A.evaluate(s => __fake.load(s), await B.evaluate(() => __fake.srv())); await A.waitForTimeout(700);
  ok((await A.inputValue('#sBw')) === '84', 'A recibe el cambio de B sin recargar');

  console.log('4. Cerrar sesión detiene la sincronización');
  await A.click('[data-act="cl-logout"]'); await A.waitForSelector('#gForm');
  const w0 = await A.evaluate(() => __fake.writes.length); await A.waitForTimeout(800);
  ok((await A.evaluate(() => __fake.writes.length)) === w0, 'sin escrituras después de cerrar sesión');

  ok(errors.length === 0, 'sin errores de consola' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await br.close(); srv.close(); console.log(fails ? fails + ' FALLAS' : 'TODO OK'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
