/* Gráficos SVG de Progreso (líneas y barras) sin librerías. Reciben el elemento y los datos; no tocan el estado de la app. */
import { esc, fmtNum, shortDate } from './logic.js';

const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

export function niceTicks(min, max, n) {
  const rng = Math.max(1e-9, max - min), raw = rng / n, pow = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { lo: lo, hi: hi, ticks: ticks };
}
export function drawLine(el, d) {
  const W = Math.max(260, Math.round(el.clientWidth || 340)), H = 210, m = { l: 40, r: 20, t: 20, b: 28 };
  const pts = d.pts, pj = d.proj;
  if (!pts.length) { el.innerHTML = '<p class="muted">Sin registros de este ejercicio en el período.</p>'; return; }
  const ts = pts.map(p => +p.t).concat(pj ? [+pj.to.t] : []);
  let x0 = Math.min.apply(null, ts), x1 = Math.max.apply(null, ts);
  if (x1 === x0) { x0 -= 3 * 864e5; x1 += 3 * 864e5; }
  const ys = pts.map(p => p.y).concat(pj ? [pj.to.y] : []);
  const nt = niceTicks(Math.min.apply(null, ys) - 1, Math.max.apply(null, ys) + 1, 4);
  const sx = t => m.l + (t - x0) / (x1 - x0) * (W - m.l - m.r), sy = v => m.t + (1 - (v - nt.lo) / (nt.hi - nt.lo)) * (H - m.t - m.b);
  const cx = x => Math.min(Math.max(x, m.l + 16), W - m.r - 16), f1 = n => n.toFixed(1);
  let g = '';
  nt.ticks.forEach(v => { const y = sy(v); g += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + f1(y) + '" y2="' + f1(y) + '"/><text class="ax" x="' + (m.l - 8) + '" y="' + f1(y + 4) + '" text-anchor="end">' + fmtNum(v, 0) + '</text>'; });
  const xl = [pts[0]];
  if (pts.length >= 5) xl.push(pts[Math.floor((pts.length - 1) / 2)]);
  if (pts.length > 1) xl.push(pts[pts.length - 1]);
  xl.forEach(p => { g += '<text class="ax" x="' + f1(cx(sx(+p.t))) + '" y="' + (H - 8) + '" text-anchor="middle">' + shortDate(p.t) + '</text>'; });
  if (pj) g += '<text class="ax" x="' + f1(cx(sx(+pj.to.t))) + '" y="' + (H - 8) + '" text-anchor="middle">' + shortDate(pj.to.t) + '</text>';
  if (pts.length > 1) g += '<path class="ln" d="' + pts.map((p, i) => (i ? 'L' : 'M') + f1(sx(+p.t)) + ' ' + f1(sy(p.y))).join(' ') + '"/>';
  if (pj) {
    g += '<path class="ln proj" d="M' + f1(sx(+pj.from.t)) + ' ' + f1(sy(pj.from.y)) + ' L' + f1(sx(+pj.to.t)) + ' ' + f1(sy(pj.to.y)) + '"/>';
    g += '<circle class="mk hollow" cx="' + f1(sx(+pj.to.t)) + '" cy="' + f1(sy(pj.to.y)) + '" r="5"/><text class="lbl" x="' + f1(sx(+pj.to.t) + 2) + '" y="' + f1(sy(pj.to.y) - 12) + '" text-anchor="end">≈ ' + fmtNum(pj.to.y, 0) + '</text>';
  }
  g += '<line class="xh" id="xh" y1="' + m.t + '" y2="' + (H - m.b) + '" style="display:none"/>';
  pts.forEach((p, i) => {
    g += '<circle class="mk" tabindex="0" role="img" data-i="' + i + '" cx="' + f1(sx(+p.t)) + '" cy="' + f1(sy(p.y)) + '" r="' + (i === pts.length - 1 ? 6 : 5) + '" aria-label="' + esc(p.label + ': ' + fmtNum(p.y, 1) + ' kg') + '"/>';
  });
  const lp = pts[pts.length - 1];
  g += '<text class="lbl" x="' + f1(sx(+lp.t) - 2) + '" y="' + f1(sy(lp.y) - 12) + '" text-anchor="end">' + fmtNum(lp.y, 1) + '</text>';
  el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc('Evolución del 1RM estimado de ' + d.name + ': de ' + fmtNum(pts[0].y, 1) + ' a ' + fmtNum(lp.y, 1) + ' kg') + '">' + g + '</svg><div class="tip" hidden></div>';
  const svgEl = el.querySelector('svg'), tip = el.querySelector('.tip'), xh = el.querySelector('.xh');
  const show = i => {
    const p = pts[i], x = sx(+p.t), y = sy(p.y);
    xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.style.display = '';
    tip.hidden = false; tip.textContent = p.label + ' · ' + fmtNum(p.y, 1) + ' kg';
    tip.style.left = Math.min(Math.max(x, 80), W - 80) + 'px'; tip.style.top = Math.max(y - 14, 34) + 'px';
  };
  const hide = () => { xh.style.display = 'none'; tip.hidden = true; };
  const near = e => {
    const r = svgEl.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width);
    let bi = 0, bd = 1e9;
    pts.forEach((p, i) => { const dd = Math.abs(sx(+p.t) - px); if (dd < bd) { bd = dd; bi = i; } });
    show(bi);
  };
  svgEl.addEventListener('pointermove', near); svgEl.addEventListener('pointerdown', near); svgEl.addEventListener('pointerleave', hide);
  $$('circle[data-i]', el).forEach(c => { c.addEventListener('focus', () => show(+c.dataset.i)); c.addEventListener('blur', hide); });
}
export function roundedTop(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  const f = n => n.toFixed(1);
  return 'M' + f(x) + ' ' + f(y + h) + ' L' + f(x) + ' ' + f(y + r) + ' Q' + f(x) + ' ' + f(y) + ' ' + f(x + r) + ' ' + f(y) + ' L' + f(x + w - r) + ' ' + f(y) + ' Q' + f(x + w) + ' ' + f(y) + ' ' + f(x + w) + ' ' + f(y + r) + ' L' + f(x + w) + ' ' + f(y + h) + ' Z';
}
export function drawBars(el, d) {
  const W = Math.max(260, Math.round(el.clientWidth || 340)), H = 200, m = { l: 46, r: 10, t: 22, b: 28 };
  const it = d.items, n = it.length, vmax = Math.max.apply(null, it.map(x => x.v));
  const unit = d.unit || 'kg';
  if (!(vmax > 0)) { el.innerHTML = '<p class="muted">' + esc(d.empty || 'Sin tonelaje registrado en el período.') + '</p>'; return; }
  const nt = niceTicks(0, vmax, 3), sy = v => m.t + (1 - v / nt.hi) * (H - m.t - m.b), band = (W - m.l - m.r) / n, bw = Math.min(24, band - 6), every = n <= 6 ? 1 : n <= 8 ? 2 : 3;
  let g = '';
  nt.ticks.forEach(v => { const y = sy(v).toFixed(1); g += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y + '" y2="' + y + '"/><text class="ax" x="' + (m.l - 8) + '" y="' + (+y + 4) + '" text-anchor="end">' + fmtNum(v, 0) + '</text>'; });
  let peak = 0; it.forEach((x, i) => { if (x.v > it[peak].v) peak = i; });
  it.forEach((x, i) => {
    const c = m.l + band * (i + 0.5), h = (x.v / nt.hi) * (H - m.t - m.b);
    if (x.v > 0) g += '<path class="bar' + (x.cur ? ' soft' : '') + '" id="bar' + i + '" d="' + roundedTop(c - bw / 2, sy(x.v), bw, h, 4) + '"/>';
    if ((n - 1 - i) % every === 0) g += '<text class="ax" x="' + c.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + x.label + '</text>';
    if (i === peak) g += '<text class="lbl" x="' + c.toFixed(1) + '" y="' + (sy(x.v) - 6).toFixed(1) + '" text-anchor="middle">' + fmtNum(x.v, 0) + '</text>';
  });
  it.forEach((x, i) => {
    g += '<rect class="hit" tabindex="0" role="img" data-i="' + i + '" x="' + (m.l + band * i).toFixed(1) + '" y="' + m.t + '" width="' + band.toFixed(1) + '" height="' + (H - m.t - m.b) + '" aria-label="' + esc('Semana del ' + x.label + ': ' + fmtNum(x.v, 0) + ' ' + unit + ' en ' + x.n + (x.n === 1 ? ' sesión' : ' sesiones')) + '"/>';
  });
  el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="group" aria-label="' + esc((d.what || 'Tonelaje semanal') + ' en ' + unit) + '">' + g + '</svg><div class="tip" hidden></div>';
  const tip = el.querySelector('.tip');
  const show = i => {
    $$('.bar', el).forEach(b => b.classList.remove('hl'));
    const b = el.querySelector('#bar' + i); if (b) b.classList.add('hl');
    const x = it[i], c = m.l + band * (i + 0.5);
    tip.hidden = false; tip.textContent = 'Semana del ' + x.label + ' · ' + fmtNum(x.v, 0) + ' ' + unit + ' · ' + x.n + (x.n === 1 ? ' sesión' : ' sesiones') + (x.cur ? ' (en curso)' : '');
    tip.style.left = Math.min(Math.max(c, 110), W - 110) + 'px'; tip.style.top = Math.max(sy(x.v) - 10, 34) + 'px';
  };
  const hide = () => { tip.hidden = true; $$('.bar', el).forEach(b => b.classList.remove('hl')); };
  $$('.hit', el).forEach(r => {
    r.addEventListener('pointerenter', () => show(+r.dataset.i)); r.addEventListener('pointerdown', () => show(+r.dataset.i));
    r.addEventListener('pointerleave', hide); r.addEventListener('focus', () => show(+r.dataset.i)); r.addEventListener('blur', hide);
  });
}
