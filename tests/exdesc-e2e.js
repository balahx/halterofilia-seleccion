/* 4.11.0: descripción breve en todos los ejercicios (crear, editar, verla en Máximos, al elegir y en la sesión).
   Uso: node tests/exdesc-e2e.js */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL = 'http://localhost:' + srv.address().port + '/';
  const br = await chromium.launch(), errors = [];
  const ctx = await br.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' });
  await ctx.clock.install({ time: new Date('2026-11-04T10:00:00-03:00') });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com|cloud\.js/, r => r.abort());
  await page.goto(URL);
  await page.evaluate(() => { document.getElementById('gate').hidden = true; document.getElementById('appRoot').hidden = false; HalterApp.start({ demo: true, storageKey: 'halterofilia.v1.local' }); });
  await page.waitForSelector('#view h1'); await page.evaluate(() => { const S = HalterApp.state(); S.demo = false; S.sessions = []; HalterApp.render(); });
  const txt = sel => page.locator(sel).first().innerText();
  const ex = id => page.evaluate(i => JSON.parse(JSON.stringify(HalterApp.state().exercises.find(e => e.id === i) || null)), id);

  console.log('1. Crear un ejercicio con descripción');
  await page.click('#nav [data-tab="max"]'); await page.click('[data-act="ex-new"]'); await page.waitForSelector('#dlg[open] #exName');
  ok(await page.locator('#exDesc').count() === 1 && (await page.locator('#exDesc').getAttribute('maxlength')) === '140', 'el formulario tiene «Descripción breve (opcional)» de hasta 140 caracteres');
  ok(parseFloat(await page.locator('#exDesc').evaluate(e => getComputedStyle(e).fontSize)) >= 16, 'el campo mide 16 px o más (iOS no acerca la pantalla)');
  await page.fill('#exName', 'Sentadilla pausa'); await page.fill('#exDesc', '  Pausa de 2 s   abajo, sin rebote  '); await page.click('[data-act="ex-save"]'); await page.waitForTimeout(300);
  const nuevo = await page.evaluate(() => HalterApp.state().exercises.find(e => e.name === 'Sentadilla pausa'));
  ok(nuevo && nuevo.desc === 'Pausa de 2 s abajo, sin rebote', 'se guarda limpia (sin espacios de más): ' + (nuevo && nuevo.desc));
  ok(/Pausa de 2 s abajo, sin rebote/.test(await txt('#view')), 'se ve bajo el nombre en la lista de Máximos');

  console.log('2. Sin descripción no se guarda el campo y no deja huecos');
  await page.click('[data-act="ex-new"]'); await page.waitForSelector('#dlg[open] #exName'); await page.fill('#exName', 'Sin nota'); await page.click('[data-act="ex-save"]'); await page.waitForTimeout(300);
  const sin = await page.evaluate(() => HalterApp.state().exercises.find(e => e.name === 'Sin nota'));
  ok(sin && !('desc' in sin), 'un ejercicio sin descripción no lleva el campo `desc`');

  console.log('3. Todos los ejercicios admiten descripción: también los de fábrica');
  await page.click('[data-act="edit-max"][data-ex="snatch"]'); await page.waitForSelector('#dlg[open]'); await page.click('[data-act="ex-edit"]'); await page.waitForSelector('#exDesc');
  await page.fill('#exDesc', 'Agarre ancho, barra pegada al cuerpo'); await page.click('[data-act="ex-save"]'); await page.waitForTimeout(300);
  ok((await ex('snatch')).desc === 'Agarre ancho, barra pegada al cuerpo', 'el arranque (ejercicio de fábrica) guarda su descripción');
  await page.click('[data-act="edit-max"][data-ex="snatch"]'); await page.waitForSelector('#dlg[open]'); await page.click('[data-act="ex-edit"]'); await page.waitForSelector('#exDesc');
  ok((await page.inputValue('#exDesc')) === 'Agarre ancho, barra pegada al cuerpo', 'al volver a editar aparece la descripción guardada');
  await page.fill('#exDesc', ''); await page.click('[data-act="ex-save"]'); await page.waitForTimeout(300);
  ok(!('desc' in (await ex('snatch'))), 'vaciar el campo la quita');
  await page.click('[data-act="edit-max"][data-ex="snatch"]'); await page.waitForSelector('#dlg[open]'); await page.click('[data-act="ex-edit"]'); await page.waitForSelector('#exDesc');
  await page.fill('#exDesc', 'x'.repeat(200)); await page.click('[data-act="ex-save"]'); await page.waitForTimeout(300);
  ok((await ex('snatch')).desc.length === 140, 'el tope es de 140 caracteres');
  await page.evaluate(() => { const e = HalterApp.state().exercises.find(x => x.id === 'snatch'); e.desc = 'Agarre ancho, barra pegada al cuerpo'; HalterApp.save && HalterApp.save(); });

  console.log('4. Se ve al elegir el ejercicio y dentro de la sesión');
  await page.click('#nav [data-tab="hoy"]'); await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('[data-act="start"]:not([data-d])').click()); await page.waitForSelector('[data-act="add-ex"]');
  await page.click('[data-act="add-ex"]'); await page.waitForSelector('#dlg[open] .pick');
  ok(/Pausa de 2 s abajo, sin rebote/.test(await txt('#dlg')), 'la lista «Elegir ejercicio» muestra la descripción');
  await page.fill('#pickQ', 'pausa'); await page.waitForTimeout(200); await page.click('#dlg .pick'); await page.waitForSelector('.exc');
  ok(/Pausa de 2 s abajo, sin rebote/.test(await txt('.exc')), 'la tarjeta del ejercicio en la sesión la muestra');
  const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  ok(!over, 'sin desborde horizontal a 390 px');

  ok(errors.length === 0, 'sin errores en la consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await br.close(); srv.close();
  console.log(fails ? '\nFALLAS: ' + fails : '\nTodo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
