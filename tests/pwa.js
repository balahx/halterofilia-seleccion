/* Comprueba que la app se instala (manifest, íconos) y abre sin conexión gracias al service worker. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let slow = false;   // simula una red muy lenta o un servidor que no responde
const handle = (q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); };
const srv = http.createServer((q, r) => slow ? setTimeout(() => handle(q, r), 12000) : handle(q, r));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL = 'http://localhost:' + srv.address().port + '/';
  const br = await chromium.launch(); const ctx = await br.newContext();
  await ctx.addInitScript({ path: path.join(__dirname, 'fake-remote.js') });
  const page = await ctx.newPage(); await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.goto(URL); await page.waitForSelector('#gForm');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForSelector('#gForm'); // ya controlado por el service worker
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  ok(m.display === 'standalone' && m.start_url && m.icons.length >= 3, 'manifest: standalone, start_url e íconos');
  for (const i of m.icons) ok(fs.existsSync(path.join(ROOT, i.src.split('?')[0])), 'ícono existe: ' + i.src);
  ok(!!(await page.evaluate(() => navigator.serviceWorker.controller)), 'service worker controla la página');
  await ctx.setOffline(true);
  await page.reload(); await page.waitForSelector('#gForm');
  ok(true, 'sin conexión la app abre desde la caché');
  const cached = await page.evaluate(async () => (await (await caches.open('halterofilia-' + window.HALTER_VERSION.v)).keys()).map(r => new URL(r.url).pathname));
  ok(['/index.html', '/app.js', '/cloud.js', '/styles.css', '/firebase-config.js', '/plan-import.js', '/plan-ui.js', '/assign.js', '/report.js', '/privacy.js', '/version.js', '/update.js'].every(p => cached.includes(p)), 'archivos en caché: ' + cached.length);
  await ctx.setOffline(false);
  slow = true;   // D1: con la red colgada la app abre en pocos segundos desde la copia guardada, no se queda esperando
  const t0 = Date.now();
  await page.reload({ waitUntil: 'commit' }); await page.waitForSelector('#gForm', { timeout: 9000 });
  const dt = Date.now() - t0;
  ok(dt < 8000, 'con la red colgada abre desde la copia en ' + (dt / 1000).toFixed(1) + ' s (límite 8 s)');
  slow = false;
  await br.close(); srv.close(); console.log(fails ? fails + ' FALLAS' : 'TODO OK'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
