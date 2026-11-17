/* Imagen para compartir una marca en redes (4.21.0). Se dibuja en el teléfono con <canvas>, sin servidor ni lecturas de la nube.
   Formatos: historia 1080 × 1920 y publicación 1080 × 1350. Muestra el ejercicio, los kilos, la mejora frente a la marca anterior
   y la fecha; el nombre del atleta solo si lo elige. Nunca peso corporal ni datos de salud. */
export const FORMATS = { story: { w: 1080, h: 1920, label: 'Historia' }, post: { w: 1080, h: 1350, label: 'Publicación' } };
const BLUE = '#274F83', NIGHT = '#0E1A2E', GOLD = '#DDB962', GOLD2 = '#A07E34', WHITE = '#FFFFFF';
const fmt = (n, d) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: d == null ? 1 : d }).format(n);
const longDate = ymd => { const [y, m, d] = String(ymd).split('-').map(Number); return new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d)); };

/* Texto que acompaña a la imagen al compartir */
export function shareText(r) {
  return 'Nueva marca personal: ' + r.exName + ' · ' + fmt(r.kg) + ' kg' + (r.kind === 'single' ? ' a 1 repetición' : ' (1RM estimado)') + ' 💪 #halterofilia';
}

let logoP = null;
function logo() {
  if (!logoP) logoP = new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = './icons/wl-marca-oscuro.svg'; });
  return logoP;
}
async function fontsReady() {
  try { if (document.fonts) await Promise.all([document.fonts.load('700 200px "Barlow Condensed"'), document.fonts.load('600 40px "Barlow"'), document.fonts.load('500 40px "Barlow"'), document.fonts.load('400 40px "Barlow"')]); } catch (e) { /* se usa la de reserva */ }
}
/* Corta un texto en líneas que quepan en maxW (como mucho maxLines; achica la letra si hace falta) */
function fitLines(ctx, text, maxW, size, minSize, maxLines, weight, family) {
  let s = size;
  for (; s >= minSize; s -= 4) {
    ctx.font = weight + ' ' + s + 'px ' + family;
    const words = String(text).split(/\s+/), lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } }
    if (cur) lines.push(cur);
    if (lines.length <= maxLines && lines.every(l => ctx.measureText(l).width <= maxW)) return { lines: lines, size: s };
  }
  ctx.font = weight + ' ' + minSize + 'px ' + family;
  return { lines: [String(text)], size: minSize };
}
function pill(ctx, cx, cy, text, size) {
  ctx.font = '700 ' + size + 'px "Barlow Condensed", sans-serif';
  const w = ctx.measureText(text).width + size * 1.2, h = size * 1.5, x = cx - w / 2, y = cy - h / 2, r = h / 2;
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  ctx.fillStyle = GOLD; ctx.fill(); ctx.fillStyle = NIGHT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, cx, cy + size * 0.04);
}
function spaced(ctx, text, x, y, spacing) {   // texto con espaciado entre letras (centrado)
  const chars = [...text], widths = chars.map(c => ctx.measureText(c).width), total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let cx = x - total / 2; ctx.textAlign = 'left';
  chars.forEach((c, i) => { ctx.fillText(c, cx, y); cx += widths[i] + spacing; });
}

/* r = { exName, kind: 'single'|'e1rm', kg, before, date: 'AAAA-MM-DD', set: {kg, reps}|null }; o = { fmt, name } */
export async function drawRecord(canvas, r, o) {
  const F = FORMATS[o.fmt] || FORMATS.story, W = F.w, H = F.h, story = H > 1500;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  await fontsReady();
  const im = await logo();
  // fondo
  const g = ctx.createLinearGradient(0, 0, W * 0.3, H); g.addColorStop(0, BLUE); g.addColorStop(1, NIGHT);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = 0.10; ctx.strokeStyle = GOLD; ctx.lineWidth = 3;
  for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(W * 0.92, H * 0.12, 220 + k * 120, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = 'rgba(221,185,98,.55)'; ctx.lineWidth = 4; ctx.strokeRect(36, 36, W - 72, H - 72);
  // logo + marca
  const top = story ? 150 : 96, ls = story ? 230 : 170;
  if (im) ctx.drawImage(im, W / 2 - ls / 2, top, ls, ls);
  ctx.fillStyle = WHITE; ctx.textBaseline = 'alphabetic';
  ctx.font = '700 ' + (story ? 92 : 76) + 'px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('WL', W / 2, top + ls + (story ? 100 : 82));
  ctx.fillStyle = GOLD; ctx.font = '600 ' + (story ? 30 : 26) + 'px "Barlow", sans-serif';
  spaced(ctx, 'SELECCIÓN', W / 2, top + ls + (story ? 146 : 120), 10);
  // bloque central
  let y = story ? H * 0.45 : H * 0.40;
  ctx.fillStyle = GOLD; ctx.font = '600 ' + (story ? 44 : 38) + 'px "Barlow", sans-serif';
  spaced(ctx, 'NUEVA MARCA PERSONAL', W / 2, y, 6);
  y += story ? 110 : 92;
  ctx.fillStyle = WHITE;
  const t = fitLines(ctx, r.exName, W - 180, story ? 104 : 88, 56, 2, '700', '"Barlow Condensed", sans-serif');
  ctx.textAlign = 'center'; t.lines.forEach((l, i) => ctx.fillText(l, W / 2, y + i * t.size * 1.02));
  y += (t.lines.length - 1) * t.size * 1.02 + (story ? 300 : 230);
  // kilos
  const big = story ? 330 : 270, num = fmt(r.kg);
  ctx.font = '700 ' + big + 'px "Barlow Condensed", sans-serif';
  const nw = ctx.measureText(num).width; ctx.font = '700 ' + Math.round(big * 0.34) + 'px "Barlow Condensed", sans-serif';
  const kw = ctx.measureText(' kg').width, x0 = W / 2 - (nw + kw) / 2;
  ctx.textAlign = 'left'; ctx.fillStyle = WHITE; ctx.font = '700 ' + big + 'px "Barlow Condensed", sans-serif'; ctx.fillText(num, x0, y);
  ctx.fillStyle = GOLD; ctx.font = '700 ' + Math.round(big * 0.34) + 'px "Barlow Condensed", sans-serif'; ctx.fillText(' kg', x0 + nw, y);
  y += story ? 90 : 76;
  ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.86)'; ctx.font = '500 ' + (story ? 44 : 38) + 'px "Barlow", sans-serif';
  ctx.fillText(r.kind === 'single' ? 'a 1 repetición' : '1RM estimado' + (r.set ? ' · ' + fmt(r.set.kg) + ' kg × ' + r.set.reps : ''), W / 2, y);
  if (r.before > 0 && r.kg > r.before) { y += story ? 110 : 84; pill(ctx, W / 2, y, '+' + fmt(r.kg - r.before) + ' kg', story ? 50 : 44); }
  // pie
  const foot = H - (story ? 170 : 120);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  if (o.name) { ctx.fillStyle = WHITE; ctx.font = '700 ' + (story ? 56 : 48) + 'px "Barlow Condensed", sans-serif'; ctx.fillText(String(o.name).slice(0, 40), W / 2, foot - (story ? 70 : 60)); }
  ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = '500 ' + (story ? 36 : 32) + 'px "Barlow", sans-serif';
  ctx.fillText(longDate(r.date), W / 2, foot);
  ctx.fillStyle = GOLD2; ctx.font = '600 ' + (story ? 26 : 24) + 'px "Barlow", sans-serif';
  spaced(ctx, 'WL · SELECCIÓN DE HALTEROFILIA', W / 2, foot + (story ? 60 : 52), 4);
  return canvas;
}
export function toBlob(canvas) { return new Promise(res => canvas.toBlob(b => res(b), 'image/png')); }
