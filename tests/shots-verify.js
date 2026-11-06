/* Capturas de «Verifica tu correo» (claro/oscuro, 360 y 1280 px) y de Progreso y Máximos en escritorio. Uso: SHOTS=carpeta node tests/shots-verify.js */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), SHOTS = process.env.SHOTS || path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff': 'font/woff' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL = 'http://localhost:' + srv.address().port + '/';
  const br = await chromium.launch();
  for (const scheme of ['light', 'dark']) for (const [w, h] of [[360, 740], [1280, 800]]) {
    const ctx = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, serviceWorkers: 'block', colorScheme: scheme });
    await ctx.addInitScript({ path: path.join(__dirname, 'fake-remote.js') });
    const page = await ctx.newPage(); await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.goto(URL); await page.waitForSelector('#gForm');
    await page.evaluate(() => localStorage.setItem('fake.noverify', '1'));
    await page.click('[data-g="mode"][data-v="signup"]'); await page.selectOption('#gSex', 'F'); await page.fill('#gName', 'Camila Soto'); await page.fill('#gEmail', 'camila.soto.larga@correo.cl'); await page.fill('#gPass', 'clave123'); await page.fill('#gPass2', 'clave123'); await page.check('#gPriv');
    await page.click('#gForm button[type=submit]');
    await page.waitForFunction(() => /Verifica tu correo/.test(document.querySelector('#gate h1')?.textContent || ''));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, `verifica-${scheme}-${w}.png`) });
    await page.click('[data-g="verified"]'); await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOTS, `verifica-error-${scheme}-${w}.png`) });
    await ctx.close();
  }
  for (const scheme of ['light', 'dark']) {
    const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block', colorScheme: scheme });
    await ctx.clock.install({ time: new Date('2026-11-04T10:00:00-03:00') });
    const page = await ctx.newPage(); await page.route(/fonts\.(googleapis|gstatic)\.com|cloud\.js/, r => r.abort());
    await page.goto(URL); await page.evaluate(() => { document.getElementById('gate').hidden = true; document.getElementById('appRoot').hidden = false; HalterApp.start({ demo: true, storageKey: 'halterofilia.v1.local' }); });
    await page.waitForSelector('#view h1'); await page.evaluate(() => { HalterApp.state().demo = false; HalterApp.render(); }); await page.waitForTimeout(300);
    for (const t of ['prog', 'max']) {
      await page.evaluate(t => document.querySelector('[data-act="tab"][data-tab="' + t + '"], #nav [data-tab="' + t + '"]').click(), t); await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SHOTS, `desktop-${t}-${scheme}.png`), fullPage: true });
    }
    await ctx.close();
  }
  await br.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
