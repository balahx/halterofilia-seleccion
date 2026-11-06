/* Fase 4.4: interruptor de zoom, «Reportar un problema» y registro de errores. Uso: node tests/phase44-e2e.js */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff': 'font/woff' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL = 'http://localhost:' + srv.address().port + '/';
  const br = await chromium.launch(), errors = [];
  const ctx = await br.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.route(/cloud\.js/, r => r.abort());
  const boot = async () => {
    await page.goto(URL);
    await page.evaluate(() => { document.getElementById('gate').hidden = true; document.getElementById('appRoot').hidden = false; HalterApp.start({ demo: true, storageKey: 'halterofilia.v1.local' }); });
    await page.waitForSelector('#view h1'); await page.evaluate(() => { HalterApp.state().demo = false; HalterApp.render(); });
  };
  const vp = () => page.evaluate(() => document.querySelector('meta[name="viewport"]').content);
  const openSettings = async () => { await page.click('#nav button[data-tab="mas"]'); await page.click('[data-act="settings"]'); await page.waitForSelector('#dlg[open] #sZoom'); };
  await boot();

  console.log('1. Zoom');
  ok(/user-scalable=no/.test(await vp()) && /maximum-scale=1/.test(await vp()), 'por defecto la pantalla es fija (sin zoom)');
  await openSettings();
  ok(!(await page.isChecked('#sZoom')), 'el interruptor «Permitir zoom» arranca apagado');
  await page.check('#sZoom');
  ok(!/user-scalable=no|maximum-scale/.test(await vp()) && (await page.evaluate(() => localStorage.getItem('halterofilia.zoom'))) === '1', 'al encenderlo el navegador deja de bloquear el zoom y queda guardado en este dispositivo');
  await page.keyboard.press('Escape'); await boot();
  ok(!/user-scalable=no/.test(await vp()), 'tras cerrar y abrir la app sigue permitido');
  await openSettings(); ok(await page.isChecked('#sZoom'), 'el interruptor sigue encendido');
  await page.uncheck('#sZoom');
  ok(/user-scalable=no/.test(await vp()) && (await page.evaluate(() => localStorage.getItem('halterofilia.zoom'))) === '0', 'al apagarlo vuelve la pantalla fija');
  const prof = await page.evaluate(() => JSON.stringify(HalterApp.state().profile));
  ok(!/zoom/i.test(prof), 'el ajuste no se mezcla con el perfil que se sincroniza entre dispositivos');

  console.log('2. Reportar un problema');
  await page.keyboard.press('Escape'); await openSettings();
  await page.dispatchEvent('body', 'click'); // sin efecto: solo asegura que el diálogo sigue
  await page.evaluate(() => { window.dispatchEvent(new ErrorEvent('error', { message: 'Fallo de prueba', filename: 'http://x/app.js', lineno: 12 })); });
  await page.click('[data-act="report-open"]'); await page.waitForSelector('#rpText');
  let txt = await page.inputValue('#rpText');
  const ver = await page.evaluate(() => window.HALTER_VERSION.n);
  ok(txt.includes('Versión: ' + ver) && /Navegador: /.test(txt) && /Pantalla: 390/.test(txt), 'el reporte trae la versión, la pantalla y el navegador');
  ok(/Fallo de prueba/.test(txt) && /app\.js:12/.test(txt), 'incluye el último error registrado en el dispositivo');
  ok(!/sesiones|kg|Ana|@/.test(txt.replace(/Sesiones guardadas: \d+/, '')), 'no incluye datos de entrenamiento ni correos');
  await page.fill('#rpNote', 'Se congeló al marcar la serie');
  txt = await page.inputValue('#rpText');
  ok(/Qué pasó: Se congeló al marcar la serie/.test(txt), 'lo que escribe la persona entra al reporte al instante');
  ok((await page.locator('[data-act="report-copy"]').count()) === 1, 'hay botón para copiar el reporte');
  const n = await page.evaluate(() => { for (let i = 0; i < 30; i++) window.dispatchEvent(new ErrorEvent('error', { message: 'e' + i })); return JSON.parse(localStorage.getItem('halterofilia.errlog')).length; });
  ok(n === 15, 'el registro guarda solo los últimos 15 errores (' + n + ')');
  ok(errors.length === 0, 'sin errores en la consola' + (errors.length ? ': ' + errors[0] : ''));
  await br.close(); srv.close(); console.log(fails ? 'FALLAS: ' + fails : 'Todo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
