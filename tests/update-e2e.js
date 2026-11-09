/* «Buscar actualización» en Ajustes: versión visible, aviso de versión nueva y recarga sin perder la sesión. Uso: node tests/update-e2e.js */
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
  const shot = n => page.screenshot({ path: path.join(SHOTS, 'upd-' + n + '.png') });
  const navLabels = () => page.locator('#nav button span').allInnerTexts();
  const css = (sel, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [sel, prop]);
  const logout = async () => { await page.click('#nav [data-tab="mas"]'); await page.click('.mrow[data-act="cl-logout"]'); await page.waitForSelector('#gForm'); await page.waitForTimeout(500); };
  const signup = async (name, email, sex) => { await page.click('[data-g="mode"][data-v="signup"]'); await page.selectOption('#gSex', sex); await page.fill('#gName', name); await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.fill('#gPass2', 'clave123'); await page.check('#gPriv'); await page.click('#gForm button[type=submit]'); await page.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || '')); };
  const login = async email => { await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.click('#gForm button[type=submit]'); await page.waitForSelector('#appRoot:not([hidden])', { timeout: 8000 }); await page.waitForTimeout(300); };

  const V = require('../version.js');
  console.log('1. Ajustes: versión y búsqueda');
  await page.goto(URL); await page.waitForSelector('#gForm');
  await signup('Camila Rojas', 'camila@correo.cl', 'F');
  const cuid = await page.evaluate(() => __fake.uid('camila@correo.cl'));
  await page.evaluate(u => __fake.admin('members/' + u, { name: 'Camila Rojas', email: 'camila@correo.cl', approvedAt: Date.now() }), cuid);
  await page.waitForSelector('#appRoot:not([hidden])'); await page.waitForTimeout(600);
  await page.click('#nav [data-tab="mas"]'); await page.waitForTimeout(250);
  ok(/Created & Developed by Felipe González/.test(await txt('#view')) && !/Versión \d+\.\d+\.\d+/.test(await txt('#verLine')), 'al final de «Más» solo va el crédito del autor (la versión se ve en Ajustes → Aplicación)');
  await page.click('#gear'); await page.waitForSelector('#dlg[open] #updCard'); await page.waitForTimeout(900);
  let card = await txt('#updCard');
  ok(new RegExp('Versión ' + V.n.replace(/\./g, '\\.') + '(?![\\d.])').test(card) && !card.includes(V.v), 'la tarjeta de Ajustes muestra solo «Versión ' + V.n + '»');
  ok(/Ya tienes la última versión/.test(card), 'con la misma versión publicada dice que está al día');
  ok(/Created & Developed by Felipe González/.test(await txt('#dlg #verLine')) && !/Versión/.test(await txt('#dlg #verLine')), 'el crédito va al final de Ajustes, sin repetir la versión');
  await shot('01-al-dia');

  console.log('2. Hay una versión nueva publicada');
  await page.route(/version\.js\?t=/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: "const V = { n: '99.0.0', v: '2099.01.01.1', date: '2099-01-01' };" }));
  await page.click('[data-act="upd-check"]'); await page.waitForTimeout(700);
  card = await txt('#updCard');
  ok(/versión nueva/i.test(card) && /Versión 99\.0\.0(?!\d)/.test(card), 'avisa que hay una versión nueva y cuál es');
  ok(/se conservan/.test(card), 'aclara que los datos y la cuenta se conservan');
  ok(await page.locator('#updCard [data-act="upd-apply"]').count() === 1, 'aparece «Actualizar ahora»');
  ok(await page.evaluate(() => document.documentElement.hasAttribute('data-upd')), 'el engranaje muestra un punto de aviso');
  await shot('02-version-nueva');

  console.log('3. Actualizar ahora conserva la sesión');
  await page.unroute(/version\.js\?t=/);
  await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }), page.click('#updCard [data-act="upd-apply"]')]);
  await page.waitForTimeout(1200);
  ok(await page.locator('#appRoot:not([hidden])').count() === 1 && !(await page.locator('#gForm').isVisible()), 'tras actualizar sigue dentro de la cuenta, sin volver a ingresar');
  ok(/Camila Rojas/.test(await page.evaluate(() => document.body.innerText)) || await page.locator('#nav').count() === 1, 'la app vuelve a abrir con el menú');
  ok(await page.evaluate(() => !document.documentElement.hasAttribute('data-upd')), 'el punto de aviso desaparece');

  console.log('4. Sin conexión al buscar');
  await page.click('#gear'); await page.waitForSelector('#dlg[open] #updCard'); await page.waitForTimeout(300);
  await ctx.setOffline(true);
  await page.click('[data-act="upd-check"]'); await page.waitForTimeout(700);
  ok(/Sin conexión|No se pudo comprobar/.test(await txt('#updCard')), 'sin internet avisa claramente y no se rompe');
  await ctx.setOffline(false);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok(await page.locator('#updBar').isHidden(), 'sin versión nueva (o sin conexión) no aparece el aviso arriba');

  console.log('5. Aviso al abrir la app, sin ir a Ajustes');
  const NEW = r => r.fulfill({ status: 200, contentType: 'text/javascript', body: "const V = { n: '99.0.0', v: '2099.01.01.1', date: '2099-01-01' };" });
  await page.route(/version\.js\?t=/, NEW);
  await page.reload(); await page.waitForSelector('#appRoot:not([hidden])'); await page.waitForSelector('#updBar:not([hidden])', { timeout: 6000 });
  let bar = await txt('#updBar');
  ok(/versión nueva/i.test(bar) && /Versión 99\.0\.0(?!\d)/.test(bar), 'al entrar aparece el aviso con la versión nueva');
  ok(/se conservan/.test(bar) && await page.locator('#updBar [data-act="upd-apply"]').count() === 1 && await page.locator('#updBar [data-act="upd-later"]').count() === 1, 'el aviso ofrece «Actualizar ahora» y «Más tarde»');
  ok(!(await page.locator('#dlg[open]').count()), 'no hace falta abrir Ajustes');
  await shot('03-aviso-al-entrar');
  await page.click('#updBar [data-act="upd-later"]'); await page.waitForTimeout(200);
  ok(await page.locator('#updBar').isHidden(), '«Más tarde» oculta el aviso');
  ok(await page.evaluate(() => document.documentElement.hasAttribute('data-upd')), 'el punto del engranaje sigue marcando que hay versión nueva');
  await page.click('#gear'); await page.waitForSelector('#dlg[open] #updCard'); await page.waitForTimeout(300);
  ok(/versión nueva/i.test(await txt('#updCard')), 'Ajustes sigue ofreciendo la actualización');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok(await page.locator('#updBar').isHidden(), 'tras «Más tarde» el aviso no vuelve en la misma apertura');
  await page.reload(); await page.waitForSelector('#updBar:not([hidden])', { timeout: 6000 });
  ok(true, 'al volver a abrir la app el aviso aparece otra vez');
  await page.unroute(/version\.js\?t=/);
  await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }), page.click('#updBar [data-act="upd-apply"]')]);
  await page.waitForSelector('#appRoot:not([hidden])'); await page.waitForTimeout(2200);
  ok(!(await page.locator('#gForm').isVisible()) && await page.locator('#updBar').isHidden(), '«Actualizar ahora» desde el aviso recarga sin pedir ingresar y el aviso desaparece');

  await br.close(); srv.close();
  ok(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log(fails ? '\nFALLAS: ' + fails : '\nTodo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
