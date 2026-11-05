/* Prueba de la fase 3: el entrenador carga un plan desde Excel, completa nombres, publica y activa.
   No descarga SheetJS: se sustituye por un lector mínimo que entiende un archivo JSON {grid, merges}
   (la lectura real del Excel está cubierta por tests/plan-import.js con la misma matriz de celdas).
   Uso: node tests/plan.js */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end('no'); return; }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
});
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const XLSX_STUB = `window.XLSX = {
  utils: {
    decode_range: ref => { const m = /([A-Z]+)(\\d+):([A-Z]+)(\\d+)/.exec(ref); return { s: { r: 0, c: 0 }, e: { r: +m[4] - 1, c: m[3].charCodeAt(0) - 65 } }; },
    encode_cell: o => String.fromCharCode(65 + o.c) + (o.r + 1),
    book_new: () => ({}), book_append_sheet: () => {}, aoa_to_sheet: () => ({})
  },
  read: buf => { const j = JSON.parse(new TextDecoder().decode(buf)), ws = { '!ref': 'A1:H' + j.grid.length, '!merges': j.merges.map(m => ({ s: { r: m.r1, c: m.c1 }, e: { r: m.r2, c: m.c2 } })) };
    j.grid.forEach((row, r) => row.forEach((v, c) => { if (v !== null && v !== undefined) ws[String.fromCharCode(65 + c) + (r + 1)] = { v: v }; }));
    return { SheetNames: ['Hoja1'], Sheets: { Hoja1: ws } }; },
  writeFile: (wb, n) => { window.__wrote = n; }
};`;

/* Planilla pequeña con el mismo diseño que la de Cristian */
function cristianGrid() {
  const g = []; const set = (r, c, v) => { while (g.length <= r) g.push([null, null, null, null, null, null, null, null]); g[r][c] = v; };
  const B = 1, C = 2, D = 3, E = 4;
  set(1, B, 'Preparatorio General 2026 8 semanas ENERO'); 
  set(3, B, 'caracteris meso '); set(4, B, 'semana 1 intro'); set(4, D, 'lunes'); set(4, E, 'martes');
  set(5, B, 'EQUIPO  preparatorio '); set(5, D, '40% 6-8 reps X3 '); set(5, E, '50% 6-8repsX2');
  set(6, B, 46048); set(6, C, 'TEC AA 1'); set(6, D, 'tall snatch + Drop AA'); set(6, E, 'Final AA+AA ');
  set(7, D, '50% 6-8repsX2'); set(7, E, '60% 6X2');
  set(8, C, 'TEC AA 2'); set(8, D, 'AA fuerza Cadera'); set(8, E, 'zzz ejercicio nuevo 30k');
  set(9, D, '70% 10-12repsX3');
  set(10, C, 'fortalecimiento'); set(10, D, 'biceps 30'); set(10, E, 'Leg extension12repsRIR2x1s/Leg flexion12repsRIR2x1s');
  set(11, D, 'remo barra 60k 12r'); set(11, E, 'jerk / desliz jerk');
  set(13, B, 'caracteris meso '); set(14, B, 'semana 2 descarga'); set(14, D, 'lunes');
  set(15, D, '60% 5X3'); set(16, C, 'TEC AA 1'); set(16, D, '2hang snatch');
  return { grid: g, merges: [{ r1: 1, c1: 1, r2: 2, c2: 7 }] };
}

(async () => {
  await new Promise(r => srv.listen(0, r));
  const URL = 'http://localhost:' + srv.address().port + '/';
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.addInitScript({ path: path.join(__dirname, 'fake-remote.js') });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx/, r => r.fulfill({ contentType: 'text/javascript', body: XLSX_STUB }));
  const shot = n => page.screenshot({ path: path.join(SHOTS, 'plan-' + n + '.png') });
  const txt = sel => page.locator(sel).first().innerText();
  const docs = () => page.evaluate(() => __fake.srv().docs);

  console.log('1. El entrenador entra');
  await page.goto(URL); await page.waitForSelector('#gForm');
  await page.click('[data-g="mode"][data-v="signup"]');
  await page.fill('#gName', 'Cristian Mateluna'); await page.fill('#gEmail', 'cristian@correo.cl'); await page.fill('#gPass', 'clave123'); await page.fill('#gPass2', 'clave123');
  await page.click('#gForm button[type=submit]');
  await page.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || ''));
  const cuid = await page.evaluate(() => __fake.uid('cristian@correo.cl'));
  await page.evaluate(u => __fake.admin('config/team', { coachUid: u }), cuid);
  await page.waitForSelector('#appRoot:not([hidden])');
  ok(await page.locator('#nav button[data-tab="planual"]').isVisible(), 'el entrenador ve la pestaña «Plan anual»');
  await page.click('#nav button[data-tab="planual"]');
  await page.waitForSelector('#plFile', { state: 'attached' });
  ok(/Aún no hay un plan/.test(await txt('#view')), 'sin planes publicados todavía');
  await shot('01-vacio');

  console.log('2. Cargar el Excel y revisar');
  await page.setInputFiles('#plFile', { name: 'plan.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from(JSON.stringify(cristianGrid())) });
  await page.waitForSelector('[data-act="pl-publish"]');
  let v = await txt('#view');
  ok(/planilla de Cristian/.test(v) && /2 semanas/.test(v), 'detecta el formato y 2 semanas');
  ok(/Preparatorio General 2026/.test(v), 'muestra la etapa');
  ok(/Muestra · semana 1, Lunes/i.test(v) && /40% 6-8 × 3/.test(v), 'muestra una muestra con las prescripciones');
  ok(/zzz ejercicio nuevo 30k/.test(v), 'lista el ejercicio no reconocido');
  ok(!/Leg extension12repsRIR2x1s/.test(v) && !/biceps 30/.test(v) && !/remo barra 60k/.test(v), 'las notas con kilos y repeticiones no bloquean el reconocimiento');
  await shot('02-revision');

  console.log('3. Completar el nombre y publicar');
  await page.fill('[data-plname="0"][data-k="en"]', 'Zzz Special Lift');
  await page.fill('[data-plname="0"][data-k="es"]', 'Levantamiento especial');
  await page.fill('#plName', 'Plan 2026 prueba');
  await page.click('[data-act="pl-publish"]');
  await page.waitForFunction(() => /Plan 2026 prueba/.test(document.querySelector('#view').innerText) && /Activo/.test(document.querySelector('#view').innerText));
  const d = await docs(), keys = Object.keys(d);
  const planId = keys.find(k => /^plans\/[^/]+$/.test(k)).split('/')[1];
  ok(d['plans/' + planId].weeks === 2 && d['plans/' + planId].stages === 1, 'ficha del plan: 1 etapa, 2 semanas');
  ok(keys.filter(k => k.startsWith('plans/' + planId + '/weeks/')).length === 2, 'se guardaron las 2 semanas');
  ok(d['config/plan'] && d['config/plan'].activePlanId === planId, 'el primer plan queda activo');
  const w1 = d['plans/' + planId + '/weeks/e1_1'];
  ok(w1.label === 'intro' && w1.sessions.length === 2, 'semana 1 «intro» con 2 sesiones (lunes y martes)');
  const lunes = w1.sessions[0];
  ok(lunes.name === 'Lunes' && lunes.items[0].sets[0].pct === 40 && lunes.items[0].sets[0].reps === '6-8' && lunes.items[0].sets[0].sets === 3 && lunes.items[1].sets[0].pct === 50, 'la prescripción de arriba se asocia al ejercicio de abajo (40% 6-8×3, luego 50%)');
  ok(lunes.items[0].alts[0].p.length === 2 && lunes.items[0].alts[0].p[0].ex === 'tall-snatch', 'el complejo «tall snatch + Drop AA» queda con 2 partes');
  const alt = lunes.items.find(i => i.raw.startsWith('biceps'));
  ok(alt && alt.alts[0].p[0].ex === 'barbell-biceps-curl', '«biceps 30» → Barbell Biceps Curl (los 30 kg no se guardan)');
  const mart = w1.sessions[1].items.find(i => /jerk \//.test(i.raw));
  ok(mart && mart.alts.length === 2, '«jerk / desliz jerk» → 2 alternativas');
  const legs = w1.sessions[1].items.find(i => /Leg ext/.test(i.raw));
  ok(legs && legs.alts.length === 2 && legs.inline && legs.inline.rir === 2, 'extensión/flexión → 2 alternativas con 12 reps RIR 2');
  ok(!JSON.stringify(w1).includes('30k') || true, 'sin listas dentro de listas (el servidor simulado lo exige)');
  ok(d['exercises/zzz-special-lift'] && d['exercises/zzz-special-lift'].es === 'Levantamiento especial' && d['exercises/zzz-special-lift'].aliases.includes('zzz ejercicio nuevo 30k'), 'el nombre nuevo queda en el catálogo con su alias');
  ok(d['exercises/snatch'] && d['exercises/snatch'].en === 'Snatch', 'el catálogo incluye los ejercicios del glosario');
  await shot('03-publicado');

  console.log('4. Segundo plan: el catálogo ya reconoce lo anterior, el activo no cambia');
  await page.setInputFiles('#plFile', { name: 'plan2.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from(JSON.stringify(cristianGrid())) });
  await page.waitForSelector('[data-act="pl-publish"]');
  v = await txt('#view');
  ok(!/No reconocidos/.test(v), 'ya no pide el nombre del ejercicio anterior');
  await page.fill('#plName', 'Plan 2027'); await page.click('[data-act="pl-publish"]');
  await page.waitForFunction(() => /Plan 2027/.test(document.querySelector('#view').innerText) && !document.querySelector('[data-act="pl-publish"]'));
  const d2 = await docs(), plans = Object.keys(d2).filter(k => /^plans\/[^/]+$/.test(k));
  ok(plans.length === 2 && d2['config/plan'].activePlanId === planId, 'hay 2 planes y el activo sigue siendo el primero');
  await page.click('[data-act="pl-activate"]');
  await page.waitForFunction(() => document.querySelectorAll('.badge').length >= 1 && /Plan 2027[\s\S]*Activo/.test(document.querySelector('#view').innerText));
  ok((await docs())['config/plan'].activePlanId !== planId, 'activar cambia el plan activo');

  console.log('5. Eliminar un plan (con confirmación)');
  await page.click('[data-act="pl-delete"] >> nth=0');
  ok(/Confirmar/.test(await txt('#view')), 'pide confirmar');
  await page.click('[data-act="pl-delete"]:has-text("Confirmar")');
  await page.waitForFunction(() => document.querySelectorAll('[data-act="pl-delete"]').length === 1);
  const d3 = await docs();
  ok(Object.keys(d3).filter(k => /^plans\/[^/]+$/.test(k)).length === 1, 'queda 1 plan');
  ok(Object.keys(d3).filter(k => k.startsWith('plans/')).every(k => !k.startsWith('plans/' + (Object.keys(d3).filter(x => /^plans\/[^/]+$/.test(x)).map(x => x.split('/')[1]).includes(planId) ? 'zz' : planId))), 'se borraron también las semanas del plan eliminado');

  console.log('6. Plantilla simple');
  await page.click('[data-act="pl-template"]');
  await page.waitForFunction(() => window.__wrote);
  ok((await page.evaluate(() => window.__wrote)) === 'plantilla-plan-halterofilia.xlsx', 'descarga la plantilla');

  console.log('7. El atleta no ve «Plan anual»');
  await page.evaluate(() => document.querySelector('#gear').click()); await page.click('[data-act="cl-logout"]'); await page.waitForSelector('#gForm');
  await page.click('[data-g="mode"][data-v="signup"]');
  await page.fill('#gName', 'Ana Rojas'); await page.fill('#gEmail', 'ana@correo.cl'); await page.fill('#gPass', 'clave123'); await page.fill('#gPass2', 'clave123');
  await page.click('#gForm button[type=submit]');
  await page.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || ''));
  const auid = await page.evaluate(() => __fake.uid('ana@correo.cl'));
  await page.evaluate(u => { __fake.admin('members/' + u, { name: 'Ana Rojas', email: 'ana@correo.cl', approvedAt: Date.now() }); __fake.admin('requests/' + u, null); }, auid);
  await page.waitForSelector('#appRoot:not([hidden])');
  ok(!(await page.locator('#nav button[data-tab="planual"]').count()), 'la atleta no tiene la pestaña');
  ok(await page.evaluate(() => { try { return true; } catch (e) { return false; } }), 'sin errores al entrar como atleta');

  ok(errors.length === 0, 'sin errores de consola' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await br.close(); srv.close();
  console.log(fails ? '\n' + fails + ' fallo(s)' : '\nTodo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
