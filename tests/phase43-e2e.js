/* Fase 4.3: sin botón «Falló», cumplimiento (series hechas / planificadas) y ejercicios sin kilos (solo repeticiones o tiempo).
   Uso: node tests/phase43-e2e.js */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL = 'http://localhost:' + srv.address().port + '/';
  const br = await chromium.launch(), errors = [];
  const ctx = await br.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' });
  await ctx.clock.install({ time: new Date('2026-11-04T10:00:00-03:00') });   // miércoles
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com|cloud\.js/, r => r.abort());
  await page.goto(URL);
  await page.evaluate(() => { document.getElementById('gate').hidden = true; document.getElementById('appRoot').hidden = false; HalterApp.start({ demo: true, storageKey: 'halterofilia.v1.local' }); });
  await page.waitForSelector('#view h1'); await page.evaluate(() => { HalterApp.state().demo = false; HalterApp.render(); });
  const txt = sel => page.locator(sel).first().innerText();
  const st = () => page.evaluate(() => JSON.parse(JSON.stringify(HalterApp.state())));

  console.log('1. Sesión del plan: sin «Falló» y con series planificadas');
  await page.evaluate(() => { const S = HalterApp.state(); S.sessions = S.sessions.filter(s => s.endedAt && s.date < '2026-11-04'); });
  await page.evaluate(() => document.querySelector('.card [data-act="start"]').click()); await page.waitForSelector('.tick');
  ok((await page.locator('.missb, [data-act="miss"]').count()) === 0 && !/Falló/.test(await txt('#view')), 'no hay botón ni columna «Falló»');
  let s = (await st()).sessions.find(x => !x.endedAt);
  ok(s.items.length >= 2 && s.items.every(i => i.p === i.sets.length && i.p > 0), 'cada ejercicio guarda cuántas series estaban planificadas: ' + s.items.map(i => i.p).join(','));
  const planned = s.items.reduce((a, i) => a + i.p, 0);
  // hace solo las dos primeras series del primer ejercicio y quita las otras con «− Serie»
  const n0 = s.items[0].sets.length;
  for (let j = 0; j < 2; j++) {
    const row = page.locator('.exc').nth(0).locator('.set[data-j="' + j + '"]');
    await row.locator('[data-f="kg"]').fill('60'); await row.locator('[data-f="reps"]').fill('3'); await row.locator('[data-act="tick"]').click();
  }
  for (let k = 0; k < n0 - 2; k++) { await page.locator('.exc').nth(0).locator('[data-act="rm-set"]').click(); }
  s = (await st()).sessions.find(x => !x.endedAt);
  ok(s.items[0].sets.length === 2 && s.items[0].p === n0, '«− Serie» quita la serie que no se hizo y lo planificado se conserva (' + n0 + ')');
  // los demás ejercicios se omiten: se terminan sin marcar nada
  await page.click('[data-act="finish"]'); await page.waitForSelector('#dlg[open]');
  ok(/pendiente|sin marcar|quedan/i.test(await txt('#dlg')), 'al terminar avisa que quedan series sin marcar');
  await page.click('[data-act="fin-drop"]'); await page.waitForSelector('.done-hero');
  const sum = await txt('#dlg');
  const e = (await st()).sessions.filter(x => x.endedAt).pop();
  ok(e.items.length === 1 && e.skip && e.skip.length === s.items.length - 1 && e.skip.reduce((a, k) => a + k.p, 0) === planned - n0, 'los ejercicios omitidos quedan anotados como planificados que no se hicieron');
  const pct = Math.round(2 / planned * 100);
  ok(new RegExp('Cumplimiento: ' + pct + ' %').test(sum.replace(/\s+/g, ' ')) && new RegExp('2 de ' + planned + ' series').test(sum), 'el resumen muestra el cumplimiento: 2 de ' + planned + ' (' + pct + ' %)');
  ok(!/Efectividad|fallada/i.test(sum), 'el resumen ya no habla de efectividad ni de series falladas');
  await page.keyboard.press('Escape');
  await page.click('#nav button[data-tab="prog"]'); await page.waitForTimeout(400);
  const pv = await txt('#view');
  ok(/cumplimiento/.test(pv) && /Cumplimiento/.test(pv) && !/Efectividad/.test(pv), 'Progreso muestra «Cumplimiento» y ya no «Efectividad»');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'Progreso no se desborda a los lados (' + await page.evaluate(() => document.documentElement.scrollWidth) + ' px)');

  console.log('2. Ejercicios de solo repeticiones y de tiempo (sin kilos)');
  await page.click('#nav button[data-tab="hoy"]'); await page.waitForTimeout(200);
  await page.evaluate(() => { const S = HalterApp.state(); S.sessions = S.sessions.filter(x => x.endedAt); });
  await page.evaluate(() => { HalterApp.commit(S => {
    S.exercises.push({ id: 'xmov', name: 'Movilidad de cadera', cat: 'mov', rest: 30, max: 0, maxDate: null, builtin: false });
    S.exercises.push({ id: 'xdom', name: 'Dominadas', cat: 'pc', rest: 60, max: 0, maxDate: null, builtin: false });
    S.exercises.push({ id: 'xpl', name: 'Plancha', cat: 'pc', meas: 'time', rest: 45, max: 0, maxDate: null, builtin: false });
  }); });
  await page.click('[data-act="start"]:not([data-d])'); await page.waitForSelector('[data-act="add-ex"]');
  for (const id of ['xmov', 'xdom', 'xpl']) { await page.evaluate(i => document.querySelector('[data-act="add-ex"]').click(), id); await page.waitForTimeout(150); await page.evaluate(i => { const b = document.querySelector('#dlg [data-ex="' + i + '"], #dlg [data-pick="' + i + '"]'); if (b) b.click(); }, id); await page.waitForTimeout(200); }
  const items = (await st()).sessions.find(x => !x.endedAt).items;
  ok(items.length === 3, 'se agregaron los tres ejercicios sin kilos: ' + items.map(i => i.exId).join(','));
  const card = id => page.locator('.exc').nth(items.findIndex(i => i.exId === id));
  ok((await card('xmov').locator('[data-f="kg"]').count()) === 0 && (await card('xmov').locator('[data-f="secs"]').count()) === 1, 'movilidad: sin kilos ni %, pide solo el tiempo');
  ok((await card('xdom').locator('[data-f="kg"]').count()) === 0 && (await card('xdom').locator('[data-f="reps"]').count()) === 1 && (await card('xdom').locator('[data-f="secs"]').count()) === 0, 'peso corporal: sin kilos, pide solo repeticiones');
  ok((await card('xpl').locator('[data-f="secs"]').count()) === 1, 'un ejercicio de peso corporal puede medirse en tiempo');
  // marcar sin dato avisa; con dato se marca
  await card('xmov').locator('[data-act="tick"]').first().click();
  ok(/tiempo/i.test(await page.evaluate(() => (document.querySelector('.toast') || document.body).innerText)) && !(await st()).sessions.find(x => !x.endedAt).items.find(i => i.exId === 'xmov').sets[0].done, 'sin tiempo anotado no se marca la serie y avisa');
  await card('xmov').locator('[data-f="secs"]').first().fill('1:30'); await card('xmov').locator('[data-act="tick"]').first().click();
  await card('xdom').locator('[data-f="reps"]').first().fill('8'); await card('xdom').locator('[data-act="tick"]').first().click();
  await card('xpl').locator('[data-f="secs"]').first().fill('45'); await card('xpl').locator('[data-act="tick"]').first().click();
  const its = (await st()).sessions.find(x => !x.endedAt).items;
  console.log('   ', JSON.stringify(its.map(i => [i.exId, i.sets[0]])));
  ok(its.find(i => i.exId === 'xmov').sets[0].done && its.find(i => i.exId === 'xmov').sets[0].secs === 90 && its.find(i => i.exId === 'xdom').sets[0].done && its.find(i => i.exId === 'xpl').sets[0].secs === 45, 'tiempo «1:30» se guarda como 90 s, «45» como 45 s, y las repeticiones sin kilos se marcan');
  await page.click('[data-act="finish"]'); await page.waitForSelector('.done-hero'); await page.keyboard.press('Escape');
  const csv = await page.evaluate(() => HalterApp.csvHistory());
  ok(/;segundos\r?\n/.test(csv.split('\r\n')[0] + '\n') && /;90\r?$/m.test(csv) && /;45\r?$/m.test(csv), 'la exportación a CSV incluye los segundos (90 y 45)');
  await page.click('#nav button[data-tab="mas"]'); await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('[data-act="tab"][data-tab="hist"]')?.click()); await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('[data-act="hist-toggle"]')?.click()); await page.waitForTimeout(300);
  const hv = await txt('#view');
  ok(/1:30/.test(hv) && /45 s/.test(hv) && /8/.test(hv), 'el historial muestra los tiempos y repeticiones sin «0 kg»: ' + (hv.match(/Movilidad[^\n]*/) || [''])[0]);
  const mline = (hv.match(/Movilidad de cadera[^\n]*(\n[^\n]*){0,6}/) || [''])[0];
  ok(/1:30/.test(mline) && !/(^|\D)0 kg/.test(mline), 'no aparece «0 kg» en ejercicios sin kilos: ' + mline.replace(/\n/g, ' | '));

  console.log('3. Ajustes sin la opción de levantamientos fallados');
  await page.evaluate(() => document.querySelector('#nav button[data-tab="mas"]').click()); await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('[data-act="tab"][data-tab="ajustes"], [data-act="settings"]')?.click()); await page.waitForTimeout(200);
  ok(!/levantamientos fallados|mide tu efectividad/.test(await page.evaluate(() => document.body.innerText)), 'Ajustes ya no ofrece marcar levantamientos fallados');
  ok(errors.length === 0, 'sin errores en la consola' + (errors.length ? ': ' + errors[0] : ''));
  await br.close(); srv.close(); console.log(fails ? 'FALLAS: ' + fails : 'Todo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
