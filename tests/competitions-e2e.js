/* Competencias (4.10) de punta a punta con el servidor simulado y sus reglas: el entrenador crea competencias, inscribe atletas y
   carga marcas oficiales; la atleta ve la cuenta regresiva, la lista y sus marcas; los demás no pueden escribir.
   Uso: node tests/competitions-e2e.js */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const dayStr = n => { const d = new Date(Date.now() + n * 86400000); return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); };

(async () => {
  await new Promise(r => srv.listen(0, r)); const URL = 'http://localhost:' + srv.address().port + '/';
  const br = await chromium.launch(), errors = [];
  const ctx = await br.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await ctx.addInitScript({ path: path.join(__dirname, 'fake-remote.js') });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const txt = sel => page.locator(sel).first().innerText();
  const docs = () => page.evaluate(() => __fake.srv().docs);
  const logout = async () => { await page.click('#gear'); await page.click('[data-act="cl-logout"]'); await page.waitForSelector('#gForm'); await page.waitForTimeout(500); };
  const signup = async (name, email) => { await page.click('[data-g="mode"][data-v="signup"]'); await page.selectOption('#gSex', 'F'); await page.fill('#gName', name); await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.fill('#gPass2', 'clave123'); await page.check('#gPriv'); await page.click('#gForm button[type=submit]'); };
  const login = async email => { await page.fill('#gEmail', email); await page.fill('#gPass', 'clave123'); await page.click('#gForm button[type=submit]'); await page.waitForSelector('#appRoot:not([hidden])'); };
  const goComp = async () => { await page.click('#nav button[data-tab="mas"]'); await page.waitForTimeout(250); await page.click('.mrow[data-tab="competencias"]'); await page.waitForTimeout(500); };
  const remoteTry = fn => page.evaluate(async src => { try { await (new Function('r', 'return (async()=>{' + src + '})()'))(window.HALTER_REMOTE_FACTORY()); return 'ok'; } catch (e) { return e.code || String(e.message); } }, fn);

  console.log('0. Preparación: entrenador y dos atletas');
  await page.goto(URL); await page.waitForSelector('#gForm');
  await signup('Cristian Mateluna', 'cristian@correo.cl');
  const cuid = await page.evaluate(() => __fake.uid('cristian@correo.cl'));
  await page.evaluate(u => __fake.admin('config/team', { coachUid: u }), cuid);
  await page.waitForSelector('#appRoot:not([hidden])'); await logout();
  await signup('Ana Rojas', 'ana@correo.cl');
  const auid = await page.evaluate(() => __fake.uid('ana@correo.cl'));
  await page.evaluate(u => __fake.admin('members/' + u, { name: 'Ana Rojas', email: 'ana@correo.cl', approvedAt: Date.now() }), auid);
  await page.waitForSelector('#appRoot:not([hidden])');
  await goComp();
  ok(/Aún no hay competencias/.test(await txt('#view')), 'sin competencias, la atleta ve el estado vacío');
  await logout();
  await signup('Bea Soto', 'bea@correo.cl');
  const buid = await page.evaluate(() => __fake.uid('bea@correo.cl'));
  await page.evaluate(u => __fake.admin('members/' + u, { name: 'Bea Soto', email: 'bea@correo.cl', approvedAt: Date.now() }), buid);
  await page.waitForSelector('#appRoot:not([hidden])'); await logout();

  console.log('1. El entrenador crea una competencia próxima');
  await login('cristian@correo.cl'); await goComp();
  ok(/Aún no hay competencias/.test(await txt('#view')) && (await page.locator('[data-act="cp-new"]').count()) === 1, 'el entrenador ve «Nueva competencia»');
  await page.click('[data-act="cp-new"]'); await page.waitForSelector('#cpName');
  await page.click('[data-act="cp-save"]'); await page.waitForTimeout(200);
  ok(/Escribe el nombre/.test(await txt('#view')), 'no deja guardar sin nombre');
  await page.fill('#cpName', 'Campeonato Nacional'); await page.click('[data-act="cp-save"]'); await page.waitForTimeout(200);
  ok(/Elige la fecha/.test(await txt('#view')), 'ni sin fecha');
  await page.fill('#cpDate', dayStr(10)); await page.dispatchEvent('#cpDate', 'change'); await page.fill('#cpPlace', 'Santiago');
  await page.locator('input[data-cp="ath"]').first().check();
  ok((await page.locator('input[data-cp="ath"]').count()) === 2, 'se listan los dos atletas aprobados');
  await page.click('[data-act="cp-save"]'); await page.waitForTimeout(500);
  let d = await docs(), ks = Object.keys(d).filter(k => k.startsWith('competitions/'));
  ok(ks.length === 1 && d[ks[0]].name === 'Campeonato Nacional' && d[ks[0]].by === cuid && d[ks[0]].athletes.length === 1 && d[ks[0]].place === 'Santiago', 'quedó guardada, firmada por el entrenador, con un inscrito');
  ok(/Campeonato Nacional/.test(await txt('#view')) && /Santiago/.test(await txt('#view')) && /Inscritos: (Ana|Bea)/.test(await txt('#view')), 'aparece en la lista con sus inscritos');
  ok(/^10\s*\n?\s*días/i.test((await page.locator('.cp-count').first().innerText()).trim().replace(/\n+/g, ' ').replace(/^(\d+) (DÍAS)/i, '$1\n$2')) || /10/.test(await page.locator('.cp-count').first().innerText()), 'cuenta regresiva: 10 días');
  const enrolledUid = d[ks[0]].athletes[0], enrolledEmail = enrolledUid === auid ? 'ana@correo.cl' : 'bea@correo.cl', otherEmail = enrolledUid === auid ? 'bea@correo.cl' : 'ana@correo.cl';
  const cid = ks[0].split('/')[1];
  await page.click('#nav button[data-tab="hoy"]'); await page.waitForTimeout(400);
  ok(/Próxima competencia del equipo/i.test(await txt('#view')) && /Campeonato Nacional/.test(await txt('#view')), '«Mi sesión» del entrenador muestra la próxima competencia del equipo');

  console.log('2. Una competencia pasada con marcas oficiales');
  await goComp(); await page.click('[data-act="cp-new"]'); await page.waitForSelector('#cpName');
  await page.fill('#cpName', 'Copa Chile'); await page.fill('#cpDate', dayStr(-20)); await page.dispatchEvent('#cpDate', 'change');
  await page.locator('input[data-cp="ath"]').nth(enrolledUid === auid ? 0 : 1).check();
  ok((await page.locator('[data-cp="res"]').count()) === 4, 'al inscribir a alguien aparecen sus campos de marca oficial');
  await page.fill('[data-cp="res"][data-k="sn"]', '90'); await page.fill('[data-cp="res"][data-k="cj"]', '110,5');
  ok((await txt('[data-cp-total]')).trim() === '200,5', 'el total se calcula solo (200,5)');
  await page.fill('[data-cp="res"][data-k="cat"]', '−61'); await page.fill('[data-cp="res"][data-k="place"]', '2');
  await page.click('[data-act="cp-save"]'); await page.waitForTimeout(500);
  d = await docs(); const past = Object.keys(d).filter(k => k.startsWith('competitions/') && d[k].name === 'Copa Chile')[0];
  const res = d[past].results[enrolledUid];
  ok(res && res.sn === 90 && res.cj === 110.5 && res.total === 200.5 && res.cat === '−61' && res.place === 2, 'el resultado quedó guardado con total y puesto');
  ok(/Copa Chile/.test(await txt('#view')) && /Total 200,5 kg/.test(await txt('#view')) && /2\.º lugar/.test(await txt('#view')), 'la lista del entrenador muestra la marca oficial');
  await page.click('.cp-card:has-text("Copa Chile") [data-act="cp-edit"]'); await page.waitForSelector('#cpName');
  ok((await page.inputValue('#cpName')) === 'Copa Chile' && (await page.inputValue('[data-cp="res"][data-k="sn"]')) === '90', 'al editar se cargan los datos y la marca');
  await page.click('[data-act="cp-cancel"]'); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, 'competencias-entrenador.png'), fullPage: true });
  await logout();

  console.log('3. La atleta inscrita ve su cuenta regresiva y su marca');
  await login(enrolledEmail);
  ok(/Tu próxima competencia/i.test(await txt('#view')) && /Campeonato Nacional/.test(await txt('#view')), '«Hoy» muestra «Tu próxima competencia»');
  ok(/^10/.test((await page.locator('.cp-next .cp-count').innerText()).trim()), 'con 10 días de cuenta regresiva');
  await page.screenshot({ path: path.join(SHOTS, 'competencias-hoy.png'), fullPage: true });
  await goComp();
  ok(/Mejor total oficial/i.test(await txt('#view')) && /200,5/.test(await txt('#view')), 've su mejor total oficial (200,5)');
  ok(/Estás inscrito/.test(await txt('#view')) && /Total 200,5 kg/.test(await txt('#view')) && (await page.locator('[data-act="cp-new"]').count()) === 0, 'figura inscrita, con su marca y sin botones de entrenador');
  await page.screenshot({ path: path.join(SHOTS, 'competencias-atleta.png'), fullPage: true });
  const tries = [await remoteTry("await r.setCompetition('x1', { name: 'Hack', date: '2026-12-01', athletes: [], by: JSON.parse(localStorage.getItem('fake.cur')).uid })"),
    await remoteTry("await r.deleteCompetition('" + cid + "')")];
  ok(tries[0] === 'permission-denied' && tries[1] === 'permission-denied', 'la atleta no puede crear ni borrar competencias (reglas)');
  await logout();

  console.log('4. La otra atleta no inscrita');
  await login(otherEmail);
  ok(!/Tu próxima competencia/i.test(await txt('#view')), 'sin inscripción no hay cuenta regresiva en «Hoy»');
  await goComp();
  ok(/Campeonato Nacional/.test(await txt('#view')) && /Sin inscripción/.test(await txt('#view')) && !/Copa Chile/.test(await txt('#view')), 've las próximas como «Sin inscripción» y solo sus propias competencias pasadas');
  await logout();

  console.log('5. Eliminar');
  await login('cristian@correo.cl'); await goComp();
  await page.click('.cp-card:has-text("Copa Chile") [data-act="cp-del"]'); await page.waitForTimeout(200);
  ok(await page.locator('#cfm[open]').count() === 1 && /¿Eliminar «Copa Chile»\?/.test(await txt('#cfm')), 'pide confirmar al centro antes de eliminar');
  await page.click('#cfmOk'); await page.waitForTimeout(500);
  d = await docs();
  ok(!Object.keys(d).some(k => k.startsWith('competitions/') && d[k].name === 'Copa Chile') && !/Copa Chile/.test(await txt('#view')), 'la competencia se elimina');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'sin desborde horizontal');

  console.log(errors.length ? 'Errores: ' + errors.join(' | ') : 'Sin errores de consola ni de página');
  await br.close(); srv.close();
  console.log(fails || errors.length ? 'HAY FALLAS' : 'Todo bien'); process.exit(fails || errors.length ? 1 : 0);
})();
