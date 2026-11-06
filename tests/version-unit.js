/* Versión y caché sin conexión: version.js tiene el formato esperado, tools/bump.js sube bien los números y el service worker
   guarda todos los archivos que usa index.html (si falta uno, la app no abre sin conexión). Uso: node tests/version-unit.js */
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const ROOT = path.resolve(__dirname, '..');
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };

console.log('1. version.js');
const V = require(path.join(ROOT, 'version.js'));
ok(/^\d+\.\d+\.\d+$/.test(V.n) && /^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(V.v) && /^\d{4}-\d{2}-\d{2}$/.test(V.date), 'formato: n=' + V.n + ' v=' + V.v + ' date=' + V.date);
ok(V.v.slice(0, 10).replace(/\./g, '-') === V.date, 'v empieza con la misma fecha que date');

console.log('2. tools/bump.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bump-')); fs.mkdirSync(path.join(tmp, 'tools')); fs.copyFileSync(path.join(ROOT, 'tools', 'bump.js'), path.join(tmp, 'tools', 'bump.js'));
fs.writeFileSync(path.join(tmp, 'version.js'), "const V = { n: '4.3.9', v: '2026.11.06.10', date: '2026-11-06' };\n");
const run = (k, d) => { cp.execFileSync('node', [path.join(tmp, 'tools', 'bump.js'), k].concat(d ? [d] : []), { stdio: 'pipe' }); return fs.readFileSync(path.join(tmp, 'version.js'), 'utf8'); };
let t = run('fix', '2026-11-06'); ok(/n: '4\.3\.10', v: '2026\.11\.06\.11'/.test(t), 'arreglo: 4.3.9 → 4.3.10 y el mismo día suma 1 al caché');
t = run('feature', '2026-11-07'); ok(/n: '4\.4\.0', v: '2026\.11\.07\.1', date: '2026-11-07'/.test(t), 'función nueva: 4.3.10 → 4.4.0, día nuevo reinicia el caché en 1');
t = run('big', '2026-11-07'); ok(/n: '5\.0\.0', v: '2026\.11\.07\.2'/.test(t), 'cambio grande: 4.4.0 → 5.0.0');
let bad = false; try { cp.execFileSync('node', [path.join(tmp, 'tools', 'bump.js'), 'otra'], { stdio: 'pipe' }); } catch (e) { bad = true; } ok(bad, 'un tipo desconocido se rechaza');

console.log('3. Caché del service worker');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const assets = (/const ASSETS = \[([\s\S]*?)\];/.exec(sw)[1].match(/'\.\/[^']*'/g) || []).map(x => x.slice(3, -1));
const missing = assets.filter(a => a && !fs.existsSync(path.join(ROOT, a.split('?')[0])));
ok(assets.length > 20 && missing.length === 0, assets.length + ' archivos en la caché, todos existen' + (missing.length ? ' · faltan: ' + missing.join(', ') : ''));
const used = (html.match(/(?:src|href)="([^"#]+)"/g) || []).map(x => x.replace(/^(src|href)="/, '').slice(0, -1)).filter(x => !/^https?:/.test(x)).map(x => x.split('?')[0]);
const notCached = used.filter(u => !assets.includes(u));
ok(notCached.length === 0, 'todo lo que carga index.html está en la caché' + (notCached.length ? ' · falta: ' + notCached.join(', ') : ''));
const jsOnDisk = fs.readdirSync(ROOT).filter(f => f.endsWith('.js') && f !== 'sw.js' && !assets.includes(f));
ok(jsOnDisk.length === 0, 'ningún .js de la app queda fuera de la caché' + (jsOnDisk.length ? ': ' + jsOnDisk.join(', ') : ''));
console.log(fails ? 'FALLAS: ' + fails : 'Todo bien'); process.exit(fails ? 1 : 0);
