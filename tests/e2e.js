/* Prueba de punta a punta de la fase 1 con un servidor simulado (tests/fake-remote.js).
   Uso: node tests/e2e.js   (necesita playwright instalado) */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end('no'); return; }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
});
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
(async () => {
  await new Promise(r => srv.listen(0, r));
  const URL = 'http://localhost:' + srv.address().port + '/';
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.addInitScript({ path: path.join(__dirname, 'fake-remote.js') });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const shot = n => page.screenshot({ path: path.join(SHOTS, n + '.png') });
  const txt = sel => page.locator(sel).first().innerText();
  const vis = sel => page.locator(sel).first().isVisible();
  const logout = async () => { await page.click('#gear'); await page.click('[data-act="cl-logout"]'); await page.waitForSelector('#gForm'); await page.waitForTimeout(500); };
  const signup = async (name, email, pass, pass2) => {
    await page.click('[data-g="mode"][data-v="signup"]');
    await page.selectOption('#gSex', 'F'); await page.fill('#gName', name); await page.fill('#gEmail', email); await page.fill('#gPass', pass); await page.fill('#gPass2', pass2 == null ? pass : pass2); await page.check('#gPriv');
    await page.click('#gForm button[type=submit]');
  };
  const login = async (email, pass) => { await page.fill('#gEmail', email); await page.fill('#gPass', pass); await page.click('#gForm button[type=submit]'); };

  console.log('1. Sin sesión: solo se ve el ingreso');
  await page.goto(URL); await page.waitForSelector('#gForm');
  ok(await vis('#gate') && !(await vis('#appRoot')), 'se ve el ingreso y no la app');
  ok((await txt('#gate h1')) === 'Iniciar sesión', 'título «Iniciar sesión»');
  await shot('01-login');
  await page.fill('#gEmail', 'x@x.cl'); await page.fill('#gPass', 'mala1234'); await page.click('#gForm button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#gErr').textContent.length > 0);
  ok(/Correo o contraseña incorrectos/.test(await txt('#gErr')), 'clave incorrecta → mensaje en español');
  ok((await page.inputValue('#gEmail')) === 'x@x.cl', 'el correo escrito no se borra');

  console.log('2. Crear cuenta de atleta');
  await signup('Ana Rojas', 'ana@correo.cl', 'clave123', 'otra123');
  ok(/no coinciden/.test(await txt('#gErr')), 'contraseñas distintas → aviso');
  ok((await page.inputValue('#gName')) === 'Ana Rojas', 'los campos no se borran al fallar');
  await page.fill('#gPass2', 'clave123'); await page.uncheck('#gPriv'); await page.click('#gForm button[type=submit]'); await page.waitForTimeout(200);
  ok(/aviso de privacidad/.test(await txt('#gErr')), 'sin marcar el aviso de privacidad no se crea la cuenta');
  ok((await page.locator('#gForm details.priv').count()) === 1 && /Qué se guarda/.test(await page.locator('#gForm details.priv').textContent()) && /Cristian Mateluna/.test(await page.locator('#gForm details.priv').textContent()), 'el aviso está en el formulario de registro y dice qué se guarda y quién lo ve');
  await page.click('#gForm details.priv summary'); await shot('02b-aviso-privacidad');
  await page.check('#gPriv'); await page.click('#gForm button[type=submit]');
  await page.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || ''));
  ok(true, 'queda en «Solicitud enviada»');
  const rq = await page.evaluate(() => Object.entries(__fake.srv().docs).filter(([k]) => k.startsWith('requests/')).map(([k, v]) => v));
  ok(rq.length === 1 && rq[0].name === 'Ana Rojas' && rq[0].email === 'ana@correo.cl' && rq[0].status === 'pending', 'solicitud guardada con nombre y correo');
  ok(!(await vis('#appRoot')), 'la app sigue oculta mientras no la aprueben');
  await shot('02-pendiente');
  await page.evaluate(() => document.querySelector('[data-g="logout"]').click()); await page.waitForSelector('#gForm');

  console.log('3. Entrenador: se configura y aprueba');
  await signup('Cristian Mateluna', 'cristian@correo.cl', 'clave123');
  await page.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || ''));
  const cuid = await page.evaluate(() => __fake.uid('cristian@correo.cl'));
  await page.evaluate(u => __fake.admin('config/team', { coachUid: u }), cuid);
  await page.waitForSelector('#appRoot:not([hidden])');
  ok(await vis('#nav button[data-tab="equipo"]'), 'el entrenador ve la pestaña «Equipo»');
  await page.click('#nav button[data-tab="equipo"]');
  await page.waitForSelector('.person');
  ok((await txt('#view')).includes('Ana Rojas') && !(await txt('#view')).includes('Cristian'), 've la solicitud de Ana y no la suya');
  ok(!(await page.evaluate(() => !!__fake.srv().docs['requests/' + __fake.uid('cristian@correo.cl')])), 'su propia solicitud se borró');
  await shot('03-equipo');
  await page.click('[data-act="eq-approve"]');
  await page.waitForFunction(() => /Atletas aprobados \(1\)/i.test(document.querySelector('#view').innerText));
  const mem = await page.evaluate(() => __fake.srv().docs['members/' + __fake.uid('ana@correo.cl')]);
  ok(mem && mem.name === 'Ana Rojas', 'Ana quedó aprobada');
  ok(!(await page.evaluate(() => !!__fake.srv().docs['requests/' + __fake.uid('ana@correo.cl')])), 'su solicitud se retiró al aprobar');

  console.log('4. Rechazo con confirmación');
  await logout(); await signup('Beto Pino', 'beto@correo.cl', 'clave123');
  await page.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || ''));
  await page.evaluate(() => document.querySelector('[data-g="logout"]').click()); await page.waitForSelector('#gForm');
  await login('cristian@correo.cl', 'clave123'); await page.waitForSelector('#appRoot:not([hidden])');
  await page.click('#nav button[data-tab="equipo"]'); await page.waitForSelector('[data-act="eq-reject"]');
  await page.click('[data-act="eq-reject"]');
  ok((await txt('[data-act="eq-reject"]')) === 'Confirmar', 'primer toque pide confirmar');
  await page.click('[data-act="eq-reject"]');
  await page.waitForFunction(() => /Rechazadas \(1\)/i.test(document.querySelector('#view').innerText));
  ok(true, 'segunda vez rechaza');

  console.log('5. Atleta aprobado entra a la app; el rechazado ve su estado');
  await logout(); await login('ana@correo.cl', 'clave123'); await page.waitForSelector('#appRoot:not([hidden])');
  ok(!(await vis('#nav button[data-tab="equipo"]')), 'el atleta no ve «Equipo»');
  const au = await page.evaluate(() => __fake.uid('ana@correo.cl'));
  const prof = await page.evaluate(u => JSON.parse(localStorage.getItem('halterofilia.v1.' + u)).profile.name, au);
  ok(prof === 'Ana Rojas', 'su perfil parte con su nombre (clave por usuario)');
  ok(!(await page.evaluate(u => JSON.parse(localStorage.getItem('halterofilia.v1.' + u)).demo, au)), 'sin datos de ejemplo');
  await page.click('#gear'); await page.waitForSelector('.acct');
  ok(/Atleta/.test(await txt('.acct')) && /ana@correo.cl/.test(await txt('.acct')), 'Ajustes muestra correo y rol');
  ok((await page.locator('details.priv').count()) === 1 && /Borrar todos mis datos/.test(await page.locator('details.priv').textContent()), 'Ajustes incluye el aviso de privacidad');
  await shot('05-ajustes'); await page.click('[data-act="cl-logout"]'); await page.waitForSelector('#gForm'); await page.waitForTimeout(500);
  await login('beto@correo.cl', 'clave123');
  await page.waitForFunction(() => /no aprobada/.test(document.querySelector('#gate h1')?.textContent || ''));
  ok(true, 'Beto ve «Solicitud no aprobada»');
  await shot('04-rechazada');
  await page.click('[data-g="rerequest"]'); await page.waitForSelector('#gName');
  ok((await page.inputValue('#gName')) === 'Beto Pino', 'al volver a pedir, el nombre viene escrito');
  await page.click('#gForm button[type=submit]');
  await page.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || ''));
  ok(true, 'nueva solicitud enviada');

  console.log('6. La aprobación llega sola; el retiro también');
  const bu = await page.evaluate(() => __fake.uid('beto@correo.cl'));
  await page.evaluate(u => { __fake.admin('members/' + u, { name: 'Beto Pino', email: 'beto@correo.cl', approvedAt: Date.now() }); __fake.admin('requests/' + u, null); }, bu);
  await page.waitForSelector('#appRoot:not([hidden])');
  ok(true, 'al aprobarlo, la pantalla de espera pasa sola a la app');
  await page.evaluate(u => __fake.admin('members/' + u, null), bu);
  await page.waitForSelector('#gate:not([hidden])');
  ok(!(await vis('#appRoot')), 'al retirarle el acceso, vuelve a la pantalla de ingreso');
  await page.evaluate(() => document.querySelector('[data-g="logout"]').click()); await page.waitForSelector('#gForm');

  console.log('7. Sin conexión: un dispositivo con acceso previo abre la app');
  await login('ana@correo.cl', 'clave123'); await page.waitForSelector('#appRoot:not([hidden])');
  await page.evaluate(() => __fake.setOffline(true)); await page.reload(); await page.waitForSelector('#appRoot:not([hidden])');
  ok(true, 'con la nube caída, Ana igual entra');
  await page.click('#gear'); await page.waitForSelector('.acct');
  ok(/Sin confirmar/.test(await txt('.acct')), 'Ajustes avisa «Sin confirmar con el servidor»');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { __fake.setOffline(false); __fake.sdkFail(true); }); await page.reload(); await page.waitForSelector('#appRoot:not([hidden])');
  ok(true, 'si ni siquiera carga el servicio, abre con los datos guardados');
  await page.evaluate(() => localStorage.removeItem('halterofilia.lastAccess')); await page.reload(); await page.waitForSelector('#gate:not([hidden])');
  ok(/Sin conexión/.test(await txt('#gate h1')), 'un dispositivo nuevo sin conexión ve «Sin conexión»');
  await page.evaluate(() => __fake.sdkFail(false));

  console.log('8. Recuperar contraseña');
  await page.click('[data-g="retry"]'); await page.waitForSelector('#appRoot:not([hidden])'); ok(true, 'al volver la conexión y reintentar, entra normal'); await logout();
  await page.click('[data-g="mode"][data-v="reset"]'); await page.fill('#gEmail', 'ana@correo.cl'); await page.click('#gForm button[type=submit]');
  await page.waitForSelector('#gPass');
  ok((await page.evaluate(() => __fake.resets)).includes('ana@correo.cl'), 'se pidió el correo de recuperación');

  console.log('9. Tema oscuro y pantalla chica');
  await page.emulateMedia({ colorScheme: 'dark' }); await shot('09-login-oscuro');
  const w = await page.evaluate(() => document.documentElement.scrollWidth); ok(w <= 390, 'sin desborde horizontal (' + w + ' px)');

  ok(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await br.close(); srv.close();
  console.log(fails ? `\n${fails} FALLAS` : '\nTODO OK'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
