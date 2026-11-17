/* 4.20.0: progreso más cómodo — resumen «Esta semana», fichas de arranque y dos tiempos, muro de marcas y mini-tendencias en
   Máximos, con los datos de ejemplo (modo local, sin nube). Uso: node tests/progress-e2e.js */
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';const f=path.resolve(ROOT,'.'+p);if(!f.startsWith(ROOT)||(f!==ROOT&&f[ROOT.length]!==path.sep)){r.writeHead(403);r.end();return;}if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
let URL='';
const bootLocal = async page => { await page.evaluate(() => { document.getElementById('gate').hidden = true; document.getElementById('appRoot').hidden = false; HalterApp.start({ demo: true, storageKey: 'halterofilia.v1.local' }); }); };
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
(async () => {
  await new Promise(r => srv.listen(0, r)); URL = 'http://localhost:' + srv.address().port + '/';
  const browser = await chromium.launch({  });
  const errs = [];
  const mk = async (scheme, w, h) => {
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: w || 390, height: h || 844 }, deviceScaleFactor: 2, colorScheme: scheme || 'light' });
    await ctx.addInitScript(() => { window.HALTER_REMOTE_FACTORY = () => ({ init: () => new Promise(() => {}) }); }); /* la nube no responde: la prueba usa el modo local */
    const page = await ctx.newPage(); await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_|Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
    return page;
  };
  const page = await mk('light');
  await page.goto(URL); await bootLocal(page); await page.waitForSelector('#view h1');
  const txt = s => page.locator(s).innerText();
  const shot = async (n, full) => { await page.screenshot({ path: 'tests/shots/prog-' + n + '.png', fullPage: !!full }); };
  await page.click('[data-act="tab"][data-tab="prog"]'); await page.waitForTimeout(400);

  console.log('1. «Esta semana» en palabras');
  const ws = await txt('.wsum');
  ok(/^ESTA SEMANA|Esta semana/i.test(ws) && /(Esta semana: \d+ sesi|Aún no entrenas esta semana)/.test(ws), 'frase arriba de Progreso: ' + ws.replace(/\n+/g, ' | ').slice(0, 120));
  ok(/sesi(ón|ones)/.test(ws) && /cumplimiento/.test(ws) && /(carga \(UA\)|tonelaje \(kg\))/.test(ws), 'tres datos: sesiones, cumplimiento y carga o tonelaje');
  ok(await page.locator('.wsum').evaluate(e => e.compareDocumentPosition(document.querySelector('.rangebar')) & Node.DOCUMENT_POSITION_FOLLOWING), 'va antes del selector de período');

  console.log('2. Fichas de arranque y dos tiempos');
  const cards = page.locator('article.lift');
  ok(await cards.count() === 2, 'dos fichas');
  const c0 = await cards.nth(0).innerText();
  ok(/(Arranque|Snatch)/i.test(c0) && /kg máximo/.test(c0) && /Mejor serie de las últimas 8 semanas: .* kg × /.test(c0) && /1RM estimado: (sube|baja|estable)/.test(c0), 'máximo, mejor serie del período y tendencia: ' + c0.replace(/\n/g, ' | ').slice(0, 160));
  ok(await cards.nth(0).locator('.lift-last li').count() === 5 && await cards.nth(0).locator('svg.spark').count() === 1, 'últimas 5 sesiones y la línea');
  await cards.nth(1).locator('[data-act="prog-ex"]').click(); await page.waitForTimeout(300);
  ok((await page.inputValue('#progEx')) === 'cj', '«Ver en el gráfico» elige ese ejercicio en el gráfico grande');
  await page.evaluate(() => window.scrollTo(0, 0)); await shot('01-arriba');

  console.log('3. Muro de marcas');
  const wall = page.locator('.recwall li');
  const n0 = await wall.count();
  ok(n0 > 0 && n0 <= 10, 'lista de marcas (hasta 10): ' + n0);
  const r0 = await wall.first().innerText();
  ok(/(Arranque|Dos tiempos|Cargada|Envión|Sentadilla|Snatch|Clean|Jerk|Squat)/i.test(r0) && /(kg a 1 rep|1RM estimado)/.test(r0) && /(hoy|ayer|hace \d+|el \d+)/.test(r0) && /antes .* kg/.test(r0), 'cada marca: ejercicio, kilos, cuándo y lo de antes: ' + r0.replace(/\n/g, ' | '));
  const all0 = await page.evaluate(() => (HalterApp.ui ? 0 : 0));
  await page.click('[data-act="rec-all"]'); await page.waitForTimeout(200);
  ok((await page.getAttribute('[data-act="rec-all"]', 'aria-pressed')) === 'true', '«Todos los ejercicios» se puede activar');
  await page.click('[data-act="rec-all"]'); await page.waitForTimeout(200);
  const recSec = page.locator('section:has(.recwall)'); await recSec.scrollIntoViewIfNeeded(); await shot('02-marcas');
  await wall.first().locator('.rec-b').click(); await page.waitForTimeout(300);
  ok(/Historial/.test(await txt('#view h1')) && await page.locator('.hist.open').count() === 1, 'tocar una marca abre esa sesión en el Historial');

  console.log('3b. Compartir una marca (4.21.0)');
  await page.click('[data-act="tab"][data-tab="prog"]'); await page.waitForTimeout(300);
  await page.locator('.recwall [data-act="rec-share"]').first().click(); await page.waitForSelector('#dlg[open] #shareImg');
  await page.waitForFunction(() => { const i = document.getElementById('shareImg'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 });
  let dim = await page.evaluate(() => { const i = document.getElementById('shareImg'); return [i.naturalWidth, i.naturalHeight]; });
  ok(/Compartir marca/.test(await txt('#dlg h2')) && dim.join('x') === '1080x1920', 'arma la imagen en formato historia (1080 × 1920)');
  ok((await page.getAttribute('[data-act="share-name"]', 'aria-pressed')) === 'false', 'el nombre va apagado por defecto');
  const img1 = await page.evaluate(() => { const i = document.getElementById('shareImg'), c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d').drawImage(i, 0, 0); return Array.from(atob(c.toDataURL('image/png').split(',')[1]), ch => ch.charCodeAt(0)); });
  require('fs').writeFileSync('tests/shots/prog-share-historia.png', Buffer.from(img1));
  await page.click('[data-act="share-fmt"][data-v="post"]');
  await page.waitForFunction(() => { const i = document.getElementById('shareImg'); return i && i.complete && i.naturalHeight === 1350; }, null, { timeout: 8000 });
  ok(true, 'cambia a publicación (1080 × 1350)');
  const before = await page.getAttribute('#shareImg', 'src');
  await page.click('[data-act="share-name"]');
  await page.waitForFunction(b => { const i = document.getElementById('shareImg'); return i && i.src && i.src !== b && i.complete && i.naturalHeight === 1350; }, before, { timeout: 8000 });
  const img2 = await page.evaluate(() => { const i = document.getElementById('shareImg'), c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d').drawImage(i, 0, 0); return Array.from(atob(c.toDataURL('image/png').split(',')[1]), ch => ch.charCodeAt(0)); });
  require('fs').writeFileSync('tests/shots/prog-share-publicacion.png', Buffer.from(img2));
  ok(img2.length > 20000, 'con el nombre, la imagen se vuelve a armar');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('[data-act="share-dl"]')]);
  ok(/^marca-wl-\d{4}-\d{2}-\d{2}\.png$/.test(dl.suggestedFilename()), 'descarga el PNG: ' + dl.suggestedFilename());
  await shot('05-compartir');
  await page.click('[data-act="share-go"]'); await page.waitForTimeout(400);   // en el computador de prueba no hay «compartir archivos»: descarga
  await page.click('[data-act="sheet-close"]'); await page.waitForTimeout(200);

  console.log('4. Mini-tendencias en Máximos');
  await page.click('[data-act="tab"][data-tab="max"]'); await page.waitForTimeout(300);
  const sp = page.locator('.mrow .msp');
  ok(await sp.count() >= 2, 'los máximos con datos tienen su línea: ' + await sp.count());
  ok(/1RM estimado (sube|baja|estable)/.test(await sp.first().innerText()) && (await sp.first().locator('svg').getAttribute('aria-hidden')) === 'true', 'con texto para lectores de pantalla (la línea es decorativa)');
  await page.locator('.mrow').first().scrollIntoViewIfNeeded(); await shot('03-maximos');

  console.log('5. Rendimiento');
  const ms = await page.evaluate(() => { const t = performance.now(); for (let i = 0; i < 5; i++) { document.querySelector('[data-act="tab"][data-tab="prog"]').click(); document.querySelector('[data-act="tab"][data-tab="max"]').click(); } return (performance.now() - t) / 10; });
  ok(ms < 60, 'Progreso y Máximos se dibujan rápido (' + ms.toFixed(1) + ' ms por pantalla)');

  const dk = await mk('dark'); await dk.goto(URL); await bootLocal(dk); await dk.waitForSelector('#view h1');
  await dk.click('[data-act="tab"][data-tab="prog"]'); await dk.waitForTimeout(400); await dk.screenshot({ path: 'tests/shots/prog-04-oscuro.png' });

  await browser.close(); srv.close();
  ok(!errs.length, 'sin errores en consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log(fails ? '\nFALLAS: ' + fails : '\nTodo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
