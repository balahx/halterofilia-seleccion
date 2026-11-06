/* Accesibilidad (A6, P2, P3, P4): en 360 px y 390 px, claro y oscuro, recorre la app con datos de ejemplo y comprueba que
   no hay desborde lateral, que todo lo tocable mide al menos 44 px, que todo botón y campo tiene nombre y que el texto tiene contraste.
   Uso: node tests/a11y-audit.js */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff': 'font/woff' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const CHECK = () => {
  const lum = c => { const a = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
  const parse = s => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const bgOf = el => { let layers = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } } let base = { r: 255, g: 255, b: 255 }; if (!layers.length || layers[layers.length - 1].a < 1) { base = parse(getComputedStyle(document.body).backgroundColor) || base; } for (let i = layers.length - 1; i >= 0; i--) { const c = layers[i]; base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) }; } return base; };
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
  const sel = el => { let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id; else if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.'); if (el.dataset && el.dataset.act) s += '[' + el.dataset.act + ']'; return s; };
  const res = { overflowX: document.documentElement.scrollWidth - window.innerWidth, small: [], noName: [], noLabel: [], lowContrast: [], h1: document.querySelectorAll('#view h1, #gate h1').length, imgNoAlt: 0 };
  const root = document.querySelector('#appRoot:not([hidden])') || document.querySelector('#gate');
  const scope = [...(document.querySelector('dialog[open]') ? [document.querySelector('dialog[open]')] : [root || document.body])][0];
  scope.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab]').forEach(el => {
    if (!vis(el)) return; const r = el.getBoundingClientRect();
    const isSw = el.matches('input[type=checkbox],input[type=radio]') && el.closest('label'); const rr = isSw ? el.closest('label').getBoundingClientRect() : r;
    if ((rr.height < 44 || rr.width < 44) && !(el.matches('.lnk') && el.closest('p, li, small, .muted'))) res.small.push(sel(el) + ' ' + Math.round(rr.width) + 'x' + Math.round(rr.height) + ' "' + (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 18) + '"');
    if (el.matches('button, a, [role=button], [role=tab]')) { const n = (el.innerText || '').trim() || el.getAttribute('aria-label') || el.getAttribute('title') || (el.querySelector('title') || {}).textContent; if (!n) res.noName.push(sel(el)); }
    else { const id = el.id, has = (id && document.querySelector('label[for="' + id + '"]')) || el.closest('label') || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title'); if (!has) res.noLabel.push(sel(el) + ' ph="' + (el.placeholder || '') + '"'); }
  });
  const seen = new Set();
  scope.querySelectorAll('*').forEach(el => {
    if (!vis(el)) return; const t = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim(); if (!t) return;
    const cs = getComputedStyle(el), fg = parse(cs.color); if (!fg) return; const bg = bgOf(el);
    const a = fg.a; const f = { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) };
    const L1 = lum([f.r, f.g, f.b]), L2 = lum([bg.r, bg.g, bg.b]), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700, large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5; const key = sel(el) + '|' + ratio.toFixed(1);
    if (ratio < need && !seen.has(key)) { seen.add(key); res.lowContrast.push(sel(el) + ' ' + ratio.toFixed(2) + ':1 (' + Math.round(size) + 'px) "' + t.slice(0, 26) + '"'); }
  });
  return res;
};

(async () => {
  await new Promise(r => srv.listen(0, r)); const URL = 'http://localhost:' + srv.address().port + '/';
  const br = await chromium.launch(), errors = [];
  for (const [w, scheme] of [[360, 'light'], [360, 'dark'], [390, 'light']]) {
    console.log('Pantalla de ' + w + ' px · ' + scheme);
    const ctx = await br.newContext({ viewport: { width: w, height: 780 }, serviceWorkers: 'block', colorScheme: scheme });
    await ctx.clock.install({ time: new Date('2026-11-04T10:00:00-03:00') });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/net::ERR/.test(m.text())) errors.push(m.text()); });
    await page.route(/cloud\.js/, r => r.abort());
    await page.goto(URL);
    await page.evaluate(() => { document.getElementById('gate').hidden = true; document.getElementById('appRoot').hidden = false; HalterApp.start({ demo: true, storageKey: 'halterofilia.v1.local' }); });
    await page.waitForSelector('#view h1'); await page.evaluate(() => { HalterApp.state().demo = false; HalterApp.render(); });
    const bad = {}; const note = (label, r) => {
      const issues = [];
      if (r.overflowX > 0) issues.push('desborde lateral de ' + r.overflowX + ' px');
      r.small.forEach(x => issues.push('pequeño: ' + x)); r.noName.forEach(x => issues.push('botón sin nombre: ' + x)); r.noLabel.forEach(x => issues.push('campo sin etiqueta: ' + x)); r.lowContrast.forEach(x => issues.push('contraste: ' + x));
      if (issues.length) bad[label] = issues;
    };
    const look = async label => { await page.waitForTimeout(250); note(label, await page.evaluate(CHECK)); };
    for (const t of ['hoy', 'prog', 'max', 'mas']) { await page.click('#nav button[data-tab="' + t + '"]'); await look(t); }
    await page.evaluate(() => document.querySelector('[data-act="tab"][data-tab="hist"]')?.click()); await look('historial');
    await page.click('#nav button[data-tab="hoy"]');
    await page.evaluate(() => document.querySelector('.card [data-act="start"]').click()); await page.waitForSelector('.tick'); await look('sesión en curso');
    await page.evaluate(() => document.querySelector('[data-act="add-ex"]').click()); await look('elegir ejercicio'); await page.keyboard.press('Escape');
    await page.click('#nav button[data-tab="mas"]'); await page.click('[data-act="settings"]'); await page.waitForSelector('#dlg[open] #sZoom'); await look('ajustes'); await page.keyboard.press('Escape');
    await page.evaluate(() => HalterApp.state() && 0);
    const labels = Object.keys(bad);
    ok(labels.length === 0, 'sin problemas en las pantallas recorridas' + (labels.length ? ': ' + labels.map(l => l + ' → ' + bad[l].slice(0, 6).join(' | ')).join(' || ') : ''));
    await ctx.close();
  }
  ok(errors.length === 0, 'sin errores en la consola' + (errors.length ? ': ' + errors[0] : ''));
  await br.close(); srv.close(); console.log(fails ? 'FALLAS: ' + fails : 'Todo bien'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
