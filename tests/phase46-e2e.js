/* Fase 4.6: correo verificado para pedir acceso (S2). Uso: node tests/phase46-e2e.js
   La cuenta nueva no puede pedir acceso hasta abrir el enlace del correo; las cuentas que ya existían no se tocan. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff': 'font/woff' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL = 'http://localhost:' + srv.address().port + '/';
  const br = await chromium.launch(), errors = [];
  const ctx = await br.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' });
  await ctx.addInitScript({ path: path.join(__dirname, 'fake-remote.js') });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/net::ERR|fonts\./.test(m.text())) errors.push(m.text()); });
  const txt = sel => page.locator(sel).first().innerText();
  const docs = () => page.evaluate(() => __fake.srv().docs);
  const signup = async (name, email) => {
    await page.click('[data-g="mode"][data-v="signup"]');
    await page.selectOption('#gSex', 'F'); await page.fill('#gName', name); await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.fill('#gPass2', 'clave123'); await page.check('#gPriv');
    await page.click('#gForm button[type=submit]');
  };

  console.log('1. Cuenta nueva con el correo sin verificar');
  await page.goto(URL); await page.waitForSelector('#gForm');
  await page.evaluate(() => localStorage.setItem('fake.noverify', '1'));
  await signup('Ana Rojas', 'ana@correo.cl');
  await page.waitForFunction(() => /Verifica tu correo/.test(document.querySelector('#gate h1')?.textContent || ''));
  ok(/ana@correo\.cl/.test(await txt('#gate')) && (await page.evaluate(() => __fake.verifs.length)) === 1, 'se pide verificar el correo y se envió el enlace al registrarse');
  ok(!Object.keys(await docs()).some(k => k.startsWith('requests/')), 'todavía no se creó la solicitud de acceso');

  console.log('2. Comprobar sin haber abierto el enlace');
  await page.click('[data-g="verified"]'); await page.waitForTimeout(400);
  ok(/Todavía no aparece verificado/.test(await txt('#gate')) && /Verifica tu correo/.test(await txt('#gate h1')), 'avisa que aún no está verificado y se queda en la pantalla');
  await page.click('[data-g="resend"]'); await page.waitForTimeout(300);
  ok(/Espera un momento/.test(await txt('#gate')) && (await page.evaluate(() => __fake.verifs.length)) === 1, 'no se puede reenviar de inmediato (espera de un minuto)');

  console.log('3. Reglas: el servidor rechaza la solicitud de una cuenta sin verificar');
  const rs = await page.evaluate(async () => { try { await window.HALTER_REMOTE_FACTORY().createRequest(JSON.parse(localStorage.getItem('fake.cur')).uid, 'Ana Rojas', 'ana@correo.cl'); return 'ok'; } catch (e) { return e.code || String(e.message); } });
  ok(rs === 'permission-denied', 'createRequest sin correo verificado → permission-denied (' + rs + ')');

  console.log('4. Abrir el enlace y volver');
  await page.evaluate(() => __fake.verify('ana@correo.cl'));
  await page.click('[data-g="verified"]');
  await page.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || ''), null, { timeout: 8000 });
  const rq = Object.keys(await docs()).filter(k => k.startsWith('requests/'));
  ok(rq.length === 1, 'verificado: la solicitud de acceso se envía sola con el nombre escrito al registrarse');

  console.log('5. Cuentas que ya existían: no se tocan');
  await page.evaluate(() => document.querySelector('[data-g="logout"]').click()); await page.waitForSelector('#gForm');
  await page.evaluate(() => {
    const s = __fake.srv();   // dos cuentas anteriores a 4.6: una con solicitud pendiente y otra ya aprobada, ambas sin verificar
    s.users['vieja@correo.cl'] = { uid: 'uidvieja', pass: 'clave123', verified: false }; s.users['socia@correo.cl'] = { uid: 'uidsocia', pass: 'clave123', verified: false };
    s.docs['requests/uidvieja'] = { name: 'Vieja Pérez', email: 'vieja@correo.cl', status: 'pending', createdAt: Date.now() };
    s.docs['members/uidsocia'] = { name: 'Socia Díaz', email: 'socia@correo.cl', approvedAt: Date.now() }; __fake.load(s);
  });
  await page.fill('#gEmail', 'vieja@correo.cl'); await page.fill('#gPass', 'clave123'); await page.click('#gForm button[type=submit]');
  await page.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || ''));
  ok(true, 'quien ya tenía una solicitud pendiente sigue viéndola (no se le pide verificar)');
  await page.evaluate(() => document.querySelector('[data-g="logout"]').click()); await page.waitForSelector('#gForm');
  await page.fill('#gEmail', 'socia@correo.cl'); await page.fill('#gPass', 'clave123'); await page.click('#gForm button[type=submit]');
  await page.waitForSelector('#appRoot:not([hidden])', { timeout: 8000 });
  ok(true, 'quien ya estaba aprobada entra a la app sin verificar nada');
  await page.evaluate(() => window.HALTER_REMOTE_FACTORY().signOut()); await page.waitForSelector('#gForm'); await page.waitForTimeout(400);

  console.log('6. Si no se pudo enviar el correo, se puede reenviar');
  await page.evaluate(() => { localStorage.setItem('fake.noverify', '1'); localStorage.setItem('fake.sendfail', '1'); });
  await signup('Beto Soto', 'beto@correo.cl');
  await page.waitForFunction(() => /Verifica tu correo/.test(document.querySelector('#gate h1')?.textContent || ''));
  ok(/Verifica tu correo/.test(await txt('#gate h1')), 'aunque falle el envío al registrarse, la pantalla de verificación aparece');
  await page.click('[data-g="resend"]'); await page.waitForTimeout(400);
  ok(/Demasiados intentos/.test(await txt('#gate')), 'si el reenvío falla, lo dice con un mensaje claro');
  await page.evaluate(() => { localStorage.setItem('fake.sendfail', '0'); });
  await page.click('[data-g="resend"]'); await page.waitForTimeout(400);
  ok(/reenviamos el correo/.test(await txt('#gate')), 'al segundo intento se reenvía y lo confirma');


  console.log('7. Reloj del dispositivo 3 horas adelantado (D3): lo que se sincroniza lleva la hora del servidor');
  const ctx2 = await br.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' });
  await ctx2.addInitScript(() => { const n = Date.now.bind(Date); Date.now = () => n() + 3 * 3600000; });   // reloj mal puesto
  await ctx2.addInitScript({ path: path.join(__dirname, 'fake-remote.js') });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errors.push(e.message));
  await p2.goto(URL); await p2.waitForSelector('#gForm');
  await p2.click('[data-g="mode"][data-v="signup"]'); await p2.selectOption('#gSex', 'F'); await p2.fill('#gName', 'Rita Reloj'); await p2.fill('#gEmail', 'rita@correo.cl'); await p2.fill('#gPass', 'clave123'); await p2.fill('#gPass2', 'clave123'); await p2.check('#gPriv');
  await p2.click('#gForm button[type=submit]');
  await p2.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || ''));
  const ruid = await p2.evaluate(() => __fake.uid('rita@correo.cl'));
  await p2.evaluate(u => __fake.admin('members/' + u, { name: 'Rita Reloj', email: 'rita@correo.cl', approvedAt: Date.now() }), ruid);
  await p2.waitForSelector('#appRoot:not([hidden])');
  await p2.waitForFunction(() => Object.keys(__fake.srv().docs).some(k => k.indexOf('/records/') > 0), null, { timeout: 15000 });
  const realNow = Date.now();
  const us = await p2.evaluate(() => Object.keys(__fake.srv().docs).filter(k => k.indexOf('/records/') > 0).map(k => __fake.srv().docs[k].u));
  ok(us.length > 0 && us.every(u => u <= realNow + 120000), 'ningún registro lleva la hora adelantada del dispositivo (máx. diferencia con la hora real: ' + Math.round((Math.max.apply(null, us) - realNow) / 1000) + ' s)');
  await ctx2.close();

  ok(errors.length === 0, 'sin errores en la consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await br.close(); srv.close();
  console.log(fails ? '\nFALLAS: ' + fails : '\nTodo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
