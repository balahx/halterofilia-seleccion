/* Capturas de las pantallas de la atleta (datos de ejemplo) para comparar con el diseño. Uso: SHOTS=carpeta node tests/shots-demo.js */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), SHOTS = process.env.SHOTS || path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL = 'http://localhost:' + srv.address().port + '/';
  const br = await chromium.launch();
  for (const scheme of ['light', 'dark']) {
    const ctx = await br.newContext({ viewport: { width: +(process.env.VW || 390), height: +(process.env.VH || 780) }, deviceScaleFactor: +(process.env.DSF || 2), serviceWorkers: 'block', colorScheme: scheme });
    await ctx.clock.install({ time: new Date('2026-11-04T10:00:00-03:00') });
    const page = await ctx.newPage(); await page.route(/fonts\.(googleapis|gstatic)\.com|cloud\.js/, r => r.abort());
    await page.goto(URL); await page.evaluate(() => { document.getElementById('gate').hidden = true; document.getElementById('appRoot').hidden = false; HalterApp.start({ demo: true, storageKey: 'halterofilia.v1.local' }); });
    await page.waitForSelector('#view h1'); await page.evaluate(() => { HalterApp.state().demo = false; HalterApp.render(); }); await page.waitForTimeout(300);
    const shot = async n => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(SHOTS, n + '-' + scheme + '.png') }); };
    const tab = async t => { await page.evaluate(t => { const b = document.querySelector('[data-tab="' + t + '"]'); b && b.click(); }, t); };
    await tab('prog'); await shot('prog');
    await tab('max'); await shot('max');
    await page.evaluate(() => document.querySelector('[data-act="edit-max"]').click()); await shot('max-edit');
    await page.evaluate(() => { const d = document.getElementById('dlg'); d.open && d.close(); });
    await tab('mas'); await tab('plan'); await shot('plan'); await tab('hoy');
    await page.evaluate(() => document.querySelector('[data-act="start"]').click()); await page.waitForTimeout(300);
    await page.evaluate(() => { const d = document.getElementById('dlg'); if (d && d.open) d.close(); });
    await page.evaluate(() => document.querySelector('[data-act="add-ex"]').click()); await shot('pick');
    await page.evaluate(() => { const d = document.getElementById('dlg'); d.open && d.close(); });
    await page.evaluate(() => { const t = document.querySelector('[data-act="tick"]'); t && t.click(); });
    await page.evaluate(() => document.querySelector('[data-act="finish"]').click()); await shot('finish');
    await page.evaluate(() => document.querySelector('[data-act="fin-mark"]').click()); await shot('summary');
    await page.evaluate(() => { const d = document.getElementById('dlg'); d.open && d.close(); });
    await page.evaluate(() => { const S = HalterApp.state(); S.sessions = []; HalterApp.render(); }); await tab('prog'); await shot('empty-prog');
    await tab('hoy'); await shot('hoy-bw');
    await ctx.close();
  }
  await br.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
