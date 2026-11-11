/* 4.17.0: corrección automática de un plan ya publicado con el lector corregido (sin volver a subir el Excel):
   series pegadas, listas de %, opcionales y «A / B» con prescripción «X / Y» = dos ejercicios; los ajustes se mueven.
   Uso: node tests/repair-e2e.js */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };

const it = (block, src, ex, sets) => ({ block, tag: '', raw: src, presc: '', inline: null, sets, alts: [{ p: [{ src, ex, mult: 1, max: false }] }] });
const WEEKS = {
  e1_1: { stageId: 'e1', week: 1, label: '', kind: '', notes: [], next: 'e1_2', sessions: [
    { day: 1, name: 'Lunes', items: [it('Técnica arranque', 'AA', 'snatch', [{ pct: 70, reps: '3', sets: 2 }, { pct: 92, reps: '1', sets: 1, adjustable: true }])] },
    { day: 3, name: 'Miércoles', items: [it('Fuerza tracción', 'jalon AA', 'snatch-pull', [{ pct: 100, reps: '3', sets: 2 }])] }] },
  e1_2: { stageId: 'e1', week: 2, label: '', kind: '', notes: [], next: '', sessions: [{ day: 1, name: 'Lunes', items: [it('Técnica arranque', 'AA', 'snatch', [{ pct: 75, reps: '2', sets: 3 }])] }] }
};

(async () => {
  await new Promise(r => srv.listen(0, r)); const URL = 'http://localhost:' + srv.address().port + '/';
  const br = await chromium.launch(), errors = [];
  const ctx = await br.newContext({ viewport: { width: +(process.env.VW || 390), height: +(process.env.VH || 780) }, deviceScaleFactor: +(process.env.DSF || 2), serviceWorkers: 'block' });
  await ctx.addInitScript({ path: path.join(__dirname, 'fake-remote.js') });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const shot = n => page.screenshot({ path: path.join(SHOTS, 'repair-' + n + '.png') });
  const txt = sel => page.locator(sel).first().innerText();
  const docs = () => page.evaluate(() => __fake.srv().docs);
  const logout = async () => { await page.click('#gear'); await page.click('[data-act="cl-logout"]'); await page.waitForSelector('#gForm'); await page.waitForTimeout(500); };
  const signup = async (name, email) => { await page.click('[data-g="mode"][data-v="signup"]'); await page.selectOption('#gSex', 'F'); await page.fill('#gName', name); await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.fill('#gPass2', 'clave123'); await page.check('#gPriv'); await page.click('#gForm button[type=submit]'); await page.waitForFunction(() => /Solicitud enviada/.test(document.querySelector('#gate h1')?.textContent || '')); };
  const login = async email => { await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.click('#gForm button[type=submit]'); await page.waitForSelector('#appRoot:not([hidden])'); };
  const tab = async t => { await page.click('#nav button[data-tab="' + t + '"]'); await page.waitForTimeout(250); };
  // el atleta anota las repeticiones que hizo (aquí, las mismas del plan) y marca cada serie
  const tickAll = async () => { const r = page.locator('[data-f="reps"]'); for (let i = 0; i < await r.count(); i++) { if (!(await r.nth(i).inputValue())) await r.nth(i).fill(await r.nth(i).getAttribute('placeholder')); } for (const t of await page.locator('.tick').all()) await t.click(); };
  const remoteTry = (fn) => page.evaluate(async src => { try { await (new Function('r', 'return (async()=>{' + src + '})()'))(window.HALTER_REMOTE_FACTORY()); return 'ok'; } catch (e) { return e.code || String(e.message); } }, fn);

  console.log('0. Preparación: plan publicado con el lector anterior (2100 series y la variante sin %)');
  await page.goto(URL); await page.waitForSelector('#gForm');
  await signup('Cristian Mateluna', 'cristian@correo.cl');
  const cuid = await page.evaluate(() => __fake.uid('cristian@correo.cl'));
  await page.evaluate(u => __fake.admin('config/team', { coachUid: u }), cuid);
  await page.waitForSelector('#appRoot:not([hidden])'); await logout();
  await signup('Ana Rojas', 'ana@correo.cl');
  const auid = await page.evaluate(() => __fake.uid('ana@correo.cl'));
  await page.evaluate(u => __fake.admin('members/' + u, { name: 'Ana Rojas', email: 'ana@correo.cl', approvedAt: Date.now() }), auid);
  await page.waitForSelector('#appRoot:not([hidden])');
  const today = await page.evaluate(() => ((new Date().getDay() + 6) % 7) + 1);
  const OLD = { stageId: 'e1', week: 28, label: '', kind: '', notes: [], next: '', sessions: [{ day: today, name: 'Hoy', items: [
    { block: '', tag: '', raw: 'jerk balance+jerk / desliz jerk', presc: '(65% 3X2) 70% 2 repsX2 /100 105 110%x2 1 1 x1', inline: null,
      alts: [{ p: [{ src: 'jerk balance', ex: 'jerk-balance', mult: 1, max: false }, { src: 'jerk', ex: 'jerk', mult: 1, max: false }] }, { p: [{ src: 'desliz jerk', ex: 'split-jerk', mult: 1, max: false }] }],
      sets: [{ pct: 65, reps: '3', sets: 2 }, { pct: 70, reps: '2', sets: 2 }] },
    { block: '', tag: '', raw: 'clean deadlift', presc: '85% 4repsX170% 8repsX1', inline: null, alts: [{ p: [{ src: 'clean deadlift', ex: 'clean-deadlift', mult: 1, max: false }] }],
      sets: [{ pct: 85, reps: '4', sets: 170 }] },
    { block: '', tag: '', raw: 'AA', presc: '85%2x1 90%2rx1 95%1x1', inline: null, alts: [{ p: [{ src: 'AA', ex: 'snatch', mult: 1, max: false }] }],
      sets: [{ pct: 85, reps: '2', sets: 1 }, { pct: 90, reps: '2', sets: 1, adjustable: true }, { pct: 95, reps: '1', sets: 1, adjustable: true }] },
    { block: 'Fortalecimiento', tag: '', raw: 'Core', presc: '70% 10-12repsX2', inline: null, alts: [{ p: [{ src: 'Core', ex: 'core-training', mult: 1, max: false }] }], sets: [{ pct: 70, reps: '10-12', sets: 2 }] },
    { block: 'Fortalecimiento', tag: '', raw: 'plancha peso 30"', presc: '70% 10-12repsX2', inline: null, alts: [{ p: [{ src: 'plancha peso 30"', ex: 'plank', mult: 1, max: false }] }], sets: [{ pct: 70, reps: '10-12', sets: 2 }] },
    { block: 'Fortalecimiento', tag: '', raw: 'dorsal banco romano', presc: '70% 10-12repsX2', inline: null, alts: [{ p: [{ src: 'dorsal banco romano', ex: 'back-ext', mult: 1, max: false }] }], sets: [{ pct: 70, reps: '10-12', sets: 2 }] }] }] };
  await page.evaluate(({ OLD, u, c }) => {
    ['snatch', 'jerk', 'jerk-balance', 'split-jerk', 'clean-deadlift', 'core-training', 'plank', 'back-ext'].forEach(id => __fake.admin('exercises/' + id, { en: id, es: id, aliases: [] }));
    __fake.admin('plans/p1', { name: 'Plan 2026', year: 2026, format: 'cristian', stages: 1, weeks: 1, createdAt: Date.now() });
    __fake.admin('plans/p1/stages/e1', { name: 'Competitivo', order: 1 });
    __fake.admin('plans/p1/weeks/e1_28', OLD);
    __fake.admin('assignments/' + u, { planId: 'p1', weekId: 'e1_28', week: 28, stageId: 'e1', weekEndsAt: Date.now() + 5 * 86400000, setBy: c });
    __fake.admin('adjustments/' + u + '_p1_e1_28', { pcts: { s0_i2_k2: 97 }, at: Date.now() });
  }, { OLD, u: auid, c: cuid });
  await logout();

  console.log('1. El entrenador abre la app: el plan se corrige solo');
  await login('cristian@correo.cl'); await page.waitForTimeout(2500);
  const d = await docs(), w = d['plans/p1/weeks/e1_28'], items = w.sessions[0].items;
  ok(items.length === 6, '6 ejercicios: la variante pasa a ser un ejercicio aparte y «Core» deja de serlo');
  ok(!items.some(x => /^core$/i.test(x.raw)) && items[4].sub === 'Core' && items[5].sub === 'Core', '«Core» es el título de la plancha y el dorsal');
  ok(items[4].hold === 30 && items[4].meas === 'kgt' && !items[5].hold, 'la plancha: 30 s y se mide en peso y tiempo');
  ok(items[0].raw === 'jerk balance+jerk' && items[0].sets[0].opt === true && items[0].sets[1].pct === 70, 'jerk balance + jerk: 70 % 2×2 y el 65 % como opcional');
  ok(items[1].raw === 'desliz jerk' && items[1].sets.map(x => x.pct + '/' + x.reps).join(' ') === '100/2 105/1 110/1', 'desliz jerk: 100 % ×2, 105 % ×1 y 110 % ×1');
  ok(items[2].sets.map(x => x.pct + 'x' + x.sets).join(' ') === '85x1 70x1', 'clean deadlift: 1 serie al 85 % y 1 al 70 % (antes 170 series)');
  ok(d['adjustments/' + auid + '_p1_e1_28'].pcts.s0_i3_k2 === 97 && !d['adjustments/' + auid + '_p1_e1_28'].pcts.s0_i2_k2, 'el ajuste del 95 % del arranque sigue en su ejercicio (bajó una posición)');
  ok(d['plans/p1'].name === 'Plan 2026' && d['assignments/' + auid].weekId === 'e1_28', 'el plan y la semana asignada siguen igual');
  await page.waitForTimeout(1200);
  const f = (await docs())['plans/p1/fast/all'];
  ok(f && f.v.indexOf('p1|') === 0 && f.v !== 'p1|0|1', 'el documento único se arma con el plan corregido');
  const n1 = await page.evaluate(() => Object.keys(__fake.srv().docs).length);
  await page.reload(); await page.waitForSelector('#appRoot:not([hidden])'); await page.waitForTimeout(1500);
  ok(JSON.stringify((await docs())['plans/p1/weeks/e1_28']) === JSON.stringify(w), 'al volver a abrir no cambia nada más');
  await logout();

  console.log('2. La atleta ve el plan corregido');
  await login('ana@correo.cl'); await page.waitForTimeout(1200); await tab('semana');
  const v = await txt('#view');
  ok(/Opcional: 65 % · 3 rep × 2/.test(v), 've el 65 % como opcional');
  ok(/split-jerk/.test(v) && /100 %[\s\S]*105 %[\s\S]*110 %/.test(v), 've el desliz jerk con 100-105-110 %');
  ok(/CORE[\s\S]*plank[\s\S]*30 s × 2 · kilos a elección[\s\S]*back-ext/i.test(v) && !/core-training/.test(v), '«CORE» como título y la plancha con 30 s × 2');
  await shot('01-semana');
  await page.click('[data-act="as-start"] >> nth=0'); await page.waitForTimeout(800);
  const ses = await page.evaluate(() => { const S = HalterApp.state(); const s = S.sessions.find(x => !x.endedAt) || S.active || null; return s ? s.items.map(i => i.sets.length) : null; });
  ok(ses && ses.join(',') === '2,3,2,3,2,2', 'la sesión trae 2 + 3 + 2 + 3 + 2 + 2 series (sin el opcional y sin las 170): ' + JSON.stringify(ses));
  const pk = await page.evaluate(() => { const S = HalterApp.state(), e = S.exercises.find(x => /plank/i.test(x.en || x.name)); const s = S.sessions.find(x => !x.endedAt); const it = s.items.find(i => i.exId === e.id); return { meas: e.meas, pr: it.sets[0].pr, kg: it.sets[0].kg }; });
  ok(pk.meas === 'kgt' && pk.pr === '30' && !pk.kg, 'la plancha en la sesión: peso y tiempo, 30 s sombreado y kilos libres: ' + JSON.stringify(pk));
  const pi = await page.evaluate(() => { const S = HalterApp.state(), s = S.sessions.find(x => !x.endedAt); return s.items.findIndex(i => /plank/i.test((S.exercises.find(e => e.id === i.exId) || {}).en || '')); });
  const card = page.locator('.exc').nth(pi);
  ok(await card.locator('.set:not(.sethead)').first().locator('[data-f="kg"]').count() === 1 && await card.locator('.set:not(.sethead)').first().locator('[data-f="secs"]').count() === 1 && await card.locator('.set:not(.sethead) [data-f="reps"]').count() === 0, 'cada serie tiene kg y tiempo (sin repeticiones)');
  await card.locator('.set:not(.sethead)').first().locator('[data-act="tick"]').click(); await page.waitForTimeout(200);
  ok(/Anota el tiempo/.test(await txt('#toast')), 'sin tiempo no se marca la serie');
  await card.locator('.set:not(.sethead)').first().locator('[data-f="secs"]').fill('35'); await card.locator('.set:not(.sethead)').first().locator('[data-act="tick"]').click(); await page.waitForTimeout(200);
  ok(await page.evaluate(i => { const s = HalterApp.state().sessions.find(x => !x.endedAt); return s.items[i].sets[0].done && s.items[i].sets[0].secs === 35; }, pi), 'con 35 s y sin discos se marca hecha');
  await shot('02-plancha');

  console.log('2b. Confirmaciones al centro de la pantalla (4.18.0)');
  const nEx = () => page.evaluate(() => HalterApp.state().sessions.find(x => !x.endedAt).items.length);
  const n0 = await nEx();
  await page.locator('[data-act="rm-ex"]').first().click(); await page.waitForSelector('#cfm[open]');
  ok(/¿Quitar .+ de la sesión\?/.test(await txt('#cfmT')) && /Se borran sus 2 series/.test(await txt('#cfmX')) && (await txt('#cfmOk')) === 'Quitar ejercicio', '«Quitar ejercicio» pide confirmar al centro, con el ejercicio y sus series');
  await page.click('#cfmNo'); await page.waitForTimeout(200);
  ok(await nEx() === n0, '«Cancelar» deja el ejercicio');
  await page.locator('[data-act="rm-ex"]').first().click(); await page.waitForSelector('#cfm[open]'); await page.click('#cfmOk'); await page.waitForTimeout(300);
  ok(await nEx() === n0 - 1, 'confirmando se quita');
  await page.click('[data-act="cancel-sess"]'); await page.waitForSelector('#cfm[open]');
  ok(/¿Descartar la sesión\?/.test(await txt('#cfmT')) && /Se borra 1 serie registrada en 5 ejercicios/.test(await txt('#cfmX')) && (await txt('#cfmOk')) === 'Descartar sesión', 'dice qué se pierde y el botón lleva el nombre de la acción');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'cfmNo'), '«Cancelar» queda seleccionado');
  await shot('03-confirmar');
  await page.click('#cfmNo'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => !!HalterApp.state().sessions.find(x => !x.endedAt)), '«Cancelar» no descarta nada');
  await page.click('[data-act="cancel-sess"]'); await page.waitForSelector('#cfm[open]'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => !!HalterApp.state().sessions.find(x => !x.endedAt)), '«Esc» tampoco');
  await page.click('[data-act="cancel-sess"]'); await page.waitForSelector('#cfm[open]'); await page.click('#cfmOk'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => !HalterApp.state().sessions.find(x => !x.endedAt)), 'confirmando se descarta');
  await page.click('[data-act="settings"]'); await page.waitForSelector('#dlg[open]');
  await page.click('[data-act="wipe"]'); await page.waitForSelector('#cfm[open]');
  ok(await page.locator('#cfmOk').isDisabled(), '«Borrar todos mis datos» pide escribir BORRAR');
  await page.fill('#cfmW', 'borrar'); ok(!(await page.locator('#cfmOk').isDisabled()), 'con BORRAR escrito se habilita');
  await page.click('#cfmNo'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => HalterApp.state().exercises.some(e => e.meas === 'kgt')), 'cancelado: los datos siguen');


  console.log('3. Una sesión ya iniciada con el plan viejo (2100 series) se limpia sola al abrir la app (4.17.1)');
  await page.evaluate(() => {
    const S = HalterApp.state(), act = S.sessions.find(x => !x.endedAt); if (act) act.endedAt = Date.now();
    const mk = (done) => ({ kg: 50, reps: done ? '4' : '', pct: 60, rpe: null, done: done, doneAt: done ? Date.now() : null, pr: '4' });
    const big = Array.from({ length: 2100 }, (_, k) => mk(k < 3));
    S.sessions.push({ id: 'viejo', date: '2026-11-10', name: 'Martes', startedAt: Date.now(), endedAt: null, notes: '', items: [{ exId: 'sn', rest: 120, sets: big, p: 2100 }, { exId: 'x2', rest: 120, sets: [mk(false), mk(false)], p: 2 }], plan: { planId: 'p1', weekId: 'e1_28', idx: 0 } });
    S.sessions.push({ id: 'hecha', date: '2026-11-09', name: 'Lunes', startedAt: Date.now() - 86400000, endedAt: Date.now() - 80000000, notes: '', items: [{ exId: 'sn', rest: 120, sets: [mk(true)], p: 170 }], skip: [{ exId: 'q', p: 270 }] });
  });
  await page.reload(); await page.waitForSelector('#appRoot:not([hidden])'); await page.waitForTimeout(800);
  const after = await page.evaluate(() => { const S = HalterApp.state(), v = S.sessions.find(x => x.id === 'viejo'), h = S.sessions.find(x => x.id === 'hecha'); return { n: v.items[0].sets.length, done: v.items[0].sets.filter(x => x.done).length, p: v.items[0].p, n2: v.items[1].sets.length, hp: h.items[0].p, sk: h.skip[0].p }; });
  ok(after.n === 10 && after.done === 3 && after.p === 10, 'la sesión en curso queda con 10 series y conserva las 3 ya hechas: ' + JSON.stringify(after));
  ok(after.n2 === 2, 'los ejercicios normales no cambian');
  ok(after.hp === 10 && after.sk === 10, 'en el historial lo planificado queda en 10 (el cumplimiento no se hunde)');
  await page.waitForTimeout(4000);
  const cloud = await page.evaluate(u => { const d = __fake.srv().docs['users/' + u + '/records/s_viejo']; return d ? JSON.parse(d.d).items[0].sets.length : -1; }, auid);
  ok(cloud === 10, 'la copia de la nube también queda limpia (' + cloud + ')');

  await br.close(); srv.close();
  ok(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log(fails ? '\nFALLAS: ' + fails : '\nTodo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
