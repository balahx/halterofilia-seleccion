/* Marcas del equipo (entrenador): comparación por sexo y categoría, de punta a punta con el servidor simulado.
   Uso: node tests/compare-e2e.js */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const rec = (o, t) => ({ t: t, d: JSON.stringify(o), u: Date.now(), at: Date.now() });
const ATH = [
  ['a1', 'Ana Rojas', { sex: 'F', bw: 62 }, 70, 90], ['a2', 'Bea Soto', { sex: 'F', bw: 61 }, 75, 95],
  ['a3', 'Carlos Díaz', { sex: 'M', bw: 80, bwLog: [{ d: '2026-11-02', kg: 80 }] }, 100, 125], ['a4', 'Diego Paz', { sex: 'M', bw: 87 }, 105, 130],
  ['a5', 'Eli Mora', { sex: 'M', bw: 112 }, 0, 0], ['a6', 'Fran Luna', {}, 60, 80]
];
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL = 'http://localhost:' + srv.address().port + '/';
  const br = await chromium.launch(), errors = [];
  const ctx = await br.newContext({ viewport: { width: +(process.env.VW || 390), height: +(process.env.VH || 780) }, deviceScaleFactor: +(process.env.DSF || 2), serviceWorkers: 'block' });
  await ctx.addInitScript({ path: path.join(__dirname, 'fake-remote.js') });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const txt = sel => page.locator(sel).first().innerText();
  const tab = async t => { await page.click('#nav button[data-tab="' + t + '"]'); await page.waitForTimeout(400); };
  await page.goto(URL); await page.waitForSelector('#gForm');
  await page.click('[data-g="mode"][data-v="signup"]'); await page.selectOption('#gSex', 'F'); await page.fill('#gName', 'Cristian Mateluna'); await page.fill('#gEmail', 'cristian@correo.cl'); await page.fill('#gPass', 'clave123'); await page.fill('#gPass2', 'clave123');
  await page.check('#gPriv').catch(() => {}); await page.click('#gForm button[type=submit]').catch(() => {});
  await page.waitForTimeout(500);
  const cuid = await page.evaluate(() => __fake.uid('cristian@correo.cl'));
  await page.evaluate(u => __fake.admin('config/team', { coachUid: u }), cuid);
  await page.evaluate(A => A.forEach(a => {
    __fake.admin('members/' + a[0], { name: a[1], email: a[0] + '@x.cl', approvedAt: Date.now() });
    const rec = (o, t) => ({ t: t, d: JSON.stringify(o), u: Date.now(), at: Date.now() });
    __fake.admin('users/' + a[0] + '/records/profile', rec(Object.assign({ name: a[1] }, a[2]), 'profile'));
    if (a[3]) __fake.admin('users/' + a[0] + '/records/e_snatch', rec({ id: 'snatch', name: 'Arranque', max: a[3], maxDate: '2026-10-20', cat: 'comp', goal: a[3] + 5 }, 'exercise'));
    if (a[4]) __fake.admin('users/' + a[0] + '/records/e_cj', rec({ id: 'cj', name: 'Dos tiempos', max: a[4], maxDate: '2026-10-25', cat: 'comp' }, 'exercise'));
  }), ATH);
  await page.reload(); await page.waitForSelector('#appRoot:not([hidden])', { timeout: 8000 }).catch(() => {});
  if (!(await page.locator('#appRoot:not([hidden])').count())) { await page.fill('#gEmail', 'cristian@correo.cl'); await page.fill('#gPass', 'clave123'); await page.click('#gForm button[type=submit]'); await page.waitForSelector('#appRoot:not([hidden])'); }
  ok(await page.locator('#nav button[data-tab="marcas"]').count() === 1, 'el entrenador ve la pestaña «Marcas»');
  await tab('marcas'); await page.waitForSelector('.cmp-tab', { timeout: 8000 });
  await page.screenshot({ path: path.join(SHOTS, 'marcas-1.png'), fullPage: true });
  const h2 = await page.locator('.cmp-grp h2').allInnerTexts();
  ok(h2.join('|') === 'Masculino|Femenino|Sin sexo indicado', 'grupos separados: masculino, femenino y sin sexo');
  const eyes = (await page.locator('.cmp-grp .eyebrow').allInnerTexts()).map(x => x.toLowerCase());
  ok(eyes[0].startsWith('−88 kg') && eyes[1].startsWith('+110 kg') && eyes[2].startsWith('−63 kg'), 'categorías por peso: M −88 y +110; F −63 (' + eyes.join(' / ') + ')');
  const m88 = await page.locator('.cmp-grp').first().locator('.cmp-tab').first().locator('tbody tr').allInnerTexts();
  ok(/Diego Paz/.test(m88[0]) && /235/.test(m88[0]) && /líder/.test(m88[0]), 'M −88: Diego (235) lidera');
  ok(/Carlos Díaz/.test(m88[1]) && /225/.test(m88[1]) && /−10/.test(m88[1]), 'M −88: Carlos 225, 10 kg bajo el líder');
  const f63 = await page.locator('.cmp-grp').nth(1).locator('tbody tr').allInnerTexts();
  ok(/Bea Soto/.test(f63[0]) && /170/.test(f63[0]) && /Ana Rojas/.test(f63[1]) && /−10/.test(f63[1]), 'F −63: Bea (170) sobre Ana (160)');
  ok(!(await page.locator('.cmp-grp').nth(1).innerText()).includes('Carlos'), 'las mujeres no se mezclan con los hombres');
  ok(/Eli Mora/.test(await page.locator('.cmp-grp').first().innerText()) && /–/.test(await page.locator('tr', { hasText: 'Eli Mora' }).innerText()), 'sin marcas: aparece sin total');
  await page.click('.cmp-bar[aria-label="Sexo"] [data-v="F"]');
  ok((await page.locator('.cmp-grp h2').allInnerTexts()).join('|') === 'Femenino', 'filtro por sexo: solo femenino');
  await page.click('.cmp-bar[aria-label="Sexo"] [data-v="all"]'); await page.click('.cmp-bar[aria-label="Categoría de peso"] [data-v="88"]');
  ok(await page.locator('.cmp-tab').count() === 1 && /Diego/.test(await txt('.cmp-tab')), 'filtro por categoría −88');
  await page.click('.cmp-bar[aria-label="Categoría de peso"] [data-v="all"]');
  await page.click('[data-act="cmp-open"][data-uid="a3"]'); await page.waitForSelector('.cmp-det .ratio');
  const det = await txt('.cmp-det');
  ok(/Arranque/.test(det) && /100/.test(det) && /meta 105/.test(det), 'detalle de Carlos: arranque 100 con meta 105');
  await page.screenshot({ path: path.join(SHOTS, 'marcas-2.png'), fullPage: true });
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'sin scroll horizontal en la página');
  console.log(errors.length ? 'Errores: ' + errors.join(' | ') : 'Sin errores de consola ni de página');
  await br.close(); srv.close();
  console.log(fails || errors.length ? 'HAY FALLAS' : 'Todo bien'); process.exit(fails || errors.length ? 1 : 0);
})();
