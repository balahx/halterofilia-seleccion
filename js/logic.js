/* Lógica pura de la app (sin DOM ni estado): cálculos de carga, 1RM, discos, indicadores y proyección.
   Módulo ES; app.js lo importa y las pruebas lo cargan con import(). */
'use strict';
/* ===== Lógica pura (sin DOM): cálculos de carga, 1RM, discos y proyección ===== */
export const DAYS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export const DAYS_LONG = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const PLATES = [25, 20, 15, 10, 5, 2.5, 2, 1.5, 1, 0.5];
export const PLATE_COLOR = { '25': 'red', '20': 'blue', '15': 'yellow', '10': 'green', '5': 'white', '2.5': 'red', '2': 'blue', '1.5': 'yellow', '1': 'green', '0.5': 'white' };
export const ZONES = [
  { key: 'white', min: 0, label: 'Menos de 70%' },
  { key: 'green', min: 70, label: '70 – 79%' },
  { key: 'yellow', min: 80, label: '80 – 89%' },
  { key: 'blue', min: 90, label: '90 – 94%' },
  { key: 'red', min: 95, label: '95% o más' }
];

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function parseNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  const t = String(v == null ? '' : v).trim().replace(',', '.');
  if (!t) return NaN;
  const n = Number(t);
  return isFinite(n) ? n : NaN;
}
export function roundTo(x, step) {
  if (!(step > 0)) return x;
  return Math.round(Math.round(x / step) * step * 1000) / 1000;
}
export function fmtNum(n, d) {
  if (d == null) d = 1;
  if (!isFinite(n)) return '–';
  const k = Math.pow(10, d);
  return (Math.round(n * k) / k).toLocaleString('es-CL', { maximumFractionDigits: d });
}
export function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}
export function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') : m + ':' + String(s).padStart(2, '0');
}
export function fmtDur(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}
export function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function parseYmd(s) {
  const p = s.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}
export function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
export function weekdayIdx(d) { return (d.getDay() + 6) % 7; }
export function mondayOf(d) { return addDays(d, -weekdayIdx(d)); }
export function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* Repeticiones: acepta "3" o complejos como "1+2" (cargada + dos jerks). */
export function parseReps(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return { total: 0, complex: false };
  const parts = s.split('+').map(p => parseInt(p, 10)).filter(n => n > 0);
  return { total: parts.reduce((a, b) => a + b, 0), complex: parts.length > 1 };
}

/* Multiplicador 1RM = peso × k(reps). Promedio Epley + Brzycki hasta 10 reps (coinciden en 10); sobre 10, Epley. */
export function kRep(r) {
  if (r <= 1) return 1;
  const ep = 1 + r / 30;
  if (r <= 10) return (ep + 36 / (37 - r)) / 2;
  return ep;
}
export function e1rm(w, r) { return w * kRep(r); }
export function weightForReps(oneRM, r) { return oneRM / kRep(r); }

export function zoneOf(pct) {
  if (!(pct > 0)) return null;
  let z = 'white';
  for (const o of ZONES) if (pct >= o.min) z = o.key;
  return z;
}

/* Discos por lado. Todo en gramos para evitar errores de coma flotante. */
export function platesFor(target, bar) {
  const g = x => Math.round(x * 1000);
  const T = g(target), B = g(bar);
  if (!(T > 0)) return { ok: false, reason: 'empty', perSide: [], loaded: bar, short: 0 };
  if (T < B) return { ok: false, reason: 'below', perSide: [], loaded: bar, short: 0 };
  const side = Math.floor((T - B) / 2);
  let rem = side;
  const perSide = [];
  for (const p of PLATES) {
    const pg = g(p), n = Math.floor(rem / pg);
    if (n > 0) { perSide.push({ kg: p, n: n }); rem -= n * pg; }
  }
  const loaded = (B + 2 * (side - rem)) / 1000;
  return { ok: true, perSide: perSide, loaded: loaded, short: Math.round((T - g(loaded))) / 1000 };
}

/* ----- Series y sesiones ----- */
/* Una serie «fallada» (miss) fue un intento sin levantamiento válido: cuenta como intento, no como trabajo realizado. */
export function setE1rm(st) {
  if (st.miss) return 0;
  const kg = parseNum(st.kg), r = parseReps(st.reps);
  if (!(kg > 0) || r.complex || r.total < 1 || r.total > 10) return 0;
  return kg * kRep(r.total);
}
export function setTon(st) {
  if (st.miss) return 0;
  const kg = parseNum(st.kg), r = parseReps(st.reps);
  return (kg > 0 ? kg : 0) * r.total;
}
export function sessionStats(sess) {
  let ton = 0, sets = 0, reps = 0, pending = 0, missed = 0;
  for (const it of sess.items) for (const s of it.sets) {
    if (s.done && s.miss) missed++;
    else if (s.done) { ton += setTon(s); sets++; reps += parseReps(s.reps).total; } else pending++;
  }
  return { ton: ton, sets: sets, reps: reps, pending: pending, missed: missed };
}

/* ----- Indicadores (puros) ----- */
/* Categorías de peso absolutas (senior y junior) vigentes de la IWF desde el 1 de agosto de 2026; la última es abierta («+110», «+86»).
   Antes de esa fecha regían (desde junio de 2025) M 60, 65, 71, 79, 88, 94, 110 y F 48, 53, 58, 63, 69, 77, 86. Fuente: iwf.sport (3-nov-2025). Confirmar con el reglamento de cada torneo. */
export const WEIGHT_CATS = { M: [60, 65, 70, 75, 85, 95, 110], F: [49, 53, 57, 61, 69, 77, 86] };
export const SEX_LABEL = { M: 'Masculino', F: 'Femenino' };
export function catOptions(sex) {
  const l = WEIGHT_CATS[sex];
  return l ? l.map(String).concat(['+' + l[l.length - 1]]) : [];
}
/* Categoría según el sexo y el peso corporal. `override` (texto de catOptions) manda si es válido para ese sexo. */
export function categoryOf(sex, bw, override) {
  const opts = catOptions(sex);
  if (!opts.length) return '';
  if (override && opts.indexOf(String(override)) >= 0) return String(override);
  const w = parseNum(bw);
  if (!(w > 0)) return '';
  const l = WEIGHT_CATS[sex];
  for (const c of l) if (w <= c) return String(c);
  return '+' + l[l.length - 1];
}
export const catText = c => c ? (c.charAt(0) === '+' ? c + ' kg' : '−' + c + ' kg') : '';
export function catSortKey(c) { return c.charAt(0) === '+' ? 1e6 + parseFloat(c.slice(1)) : parseFloat(c); }

/* Duración de la sesión en minutos: la anotada a mano o, si no, desde el inicio hasta la última serie marcada. */
export function sessionDurMin(s) {
  if (s.durMin > 0) return s.durMin;
  let last = 0;
  (s.items || []).forEach(it => (it.sets || []).forEach(x => { if (x.done && x.doneAt > last) last = x.doneAt; }));
  const end = last > (s.startedAt || 0) ? last : (s.endedAt || 0);
  if (!(s.startedAt > 0) || !(end > s.startedAt)) return 0;
  return Math.min(300, Math.max(1, Math.round((end - s.startedAt) / 60000)));
}
/* RPE de la sesión: el anotado a mano o el promedio de los RPE de sus series. */
export function sessionRpe(s) {
  if (s.srpe > 0) return s.srpe;
  let sum = 0, n = 0;
  (s.items || []).forEach(it => (it.sets || []).forEach(x => { const v = parseNum(x.rpe); if (x.done && v > 0) { sum += v; n++; } }));
  return n ? sum / n : 0;
}
/* Carga de sesión (unidades arbitrarias) = duración (min) × RPE de la sesión. 0 si falta alguno de los dos. */
export function sessionLoad(s) {
  const d = sessionDurMin(s), r = sessionRpe(s);
  return d > 0 && r > 0 ? Math.round(d * r) : 0;
}
/* Series hechas válidas de un ejercicio de sesión (las «falladas» de versiones anteriores no cuentan). */
export function doneSets(it) { return (it.sets || []).filter(x => x.done && !x.miss).length; }
/* Cumplimiento = series hechas / series planificadas. `p` (series planificadas) se anota al armar la sesión desde un plan o una rutina;
   las sesiones sin `p` (libres o anteriores a la 4.3) no entran. Nunca pasa de 100 % por ejercicio. */
export function planCount(sessions, k0, k1) {
  const o = { plan: 0, done: 0 };
  for (const s of sessions) {
    if (!s.endedAt || s.date < k0 || s.date >= k1) continue;
    for (const it of s.items) if (it.p > 0) { o.plan += it.p; o.done += Math.min(it.p, doneSets(it)); }
    for (const k of (s.skip || [])) if (k.p > 0) o.plan += k.p;   // ejercicios planificados que no se hicieron
  }
  return o;
}
/* Resumen de un período [k0, k1) (fechas «AAAA-MM-DD»): sesiones, repeticiones (NL), tonelaje, intensidad media, carga y cumplimiento. */
export function periodStats(sessions, k0, k1) {
  const o = { n: 0, sets: 0, reps: 0, ton: 0, loadSum: 0, loadN: 0, intNum: 0, intDen: 0 };
  for (const s of sessions) {
    if (!s.endedAt || s.date < k0 || s.date >= k1) continue;
    o.n++;
    const l = sessionLoad(s); if (l > 0) { o.loadSum += l; o.loadN++; }
    for (const it of s.items) for (const st of it.sets) {
      if (!st.done || st.miss) continue;
      const r = parseReps(st.reps).total;
      o.sets++; o.reps += r; o.ton += setTon(st);
      if (st.pct > 0 && r > 0) { o.intNum += st.pct * r; o.intDen += r; }
    }
  }
  o.load = o.loadSum;
  o.intAvg = o.intDen ? o.intNum / o.intDen : 0;
  const c = planCount(sessions, k0, k1);
  o.planSets = c.plan; o.planDone = c.done;
  o.cump = c.plan ? c.done / c.plan * 100 : null;
  return o;
}
/* Series hechas / planificadas por ejercicio desde `sinceYmd`. Orden: competencia primero, luego por lo planificado. */
export function complianceByExercise(sessions, sinceYmd, exInfo) {
  const m = new Map();
  for (const s of sessions) {
    if (!s.endedAt || (sinceYmd && s.date < sinceYmd)) continue;
    for (const it of s.items) {
      if (!(it.p > 0)) continue;
      let a = m.get(it.exId); if (!a) { a = { exId: it.exId, plan: 0, done: 0 }; m.set(it.exId, a); }
      a.plan += it.p; a.done += Math.min(it.p, doneSets(it));
    }
    for (const k of (s.skip || [])) {
      if (!(k.p > 0)) continue;
      let a = m.get(k.exId); if (!a) { a = { exId: k.exId, plan: 0, done: 0 }; m.set(k.exId, a); }
      a.plan += k.p;
    }
  }
  const rank = id => { const i = exInfo ? exInfo(id) : null; return i && i.cat === 'comp' ? 0 : 1; };
  return Array.from(m.values()).sort((a, b) => rank(a.exId) - rank(b.exId) || b.plan - a.plan);
}
/* Razones entre máximos (en %): { clave: valor } solo si ambos máximos existen. `max(id)` devuelve el máximo del ejercicio. */
export const RATIOS = [['snatch', 'cj', 'Arranque / Dos tiempos'], ['bsq', 'cj', 'Sentadilla trasera / Dos tiempos'], ['fsq', 'cj', 'Sentadilla frontal / Dos tiempos'], ['snpull', 'snatch', 'Tirón de arranque / Arranque'], ['clpull', 'clean', 'Tirón de cargada / Cargada']];
export function ratiosOf(max) {
  const out = [];
  for (const r of RATIOS) { const a = max(r[0]), b = max(r[1]); if (a > 0 && b > 0) out.push({ label: r[2], pct: a / b * 100 }); }
  return out;
}
/* Meta de una marca: kg que faltan, semanas estimadas según la tendencia (kg por semana) y kg por semana necesarios para la fecha meta. */
export function goalInfo(cur, goal, goalDate, slope, today) {
  if (!(goal > 0) || !(cur > 0)) return null;
  const o = { goal: goal, cur: cur, left: Math.max(0, goal - cur), done: cur >= goal, weeks: null, need: null, daysLeft: null };
  if (o.done) return o;
  if (slope > 0.05) o.weeks = o.left / slope;
  if (goalDate) { const d = daysBetween(today, parseYmd(goalDate)); o.daysLeft = d; if (d > 0) o.need = o.left / (d / 7); }
  return o;
}
export function weeklyBest(sessions, exId) {
  const m = new Map();
  for (const s of sessions) {
    if (!s.endedAt) continue;
    const wk = ymd(mondayOf(parseYmd(s.date)));
    for (const it of s.items) {
      if (it.exId !== exId) continue;
      for (const st of it.sets) {
        if (!st.done) continue;
        const v = setE1rm(st);
        if (v > 0 && v > (m.get(wk) || 0)) m.set(wk, v);
      }
    }
  }
  return Array.from(m.entries()).sort((a, b) => a[0] < b[0] ? -1 : 1).map(e => ({ week: e[0], y: e[1] }));
}
export function topSingle(sessions, exId) {
  let b = 0;
  for (const s of sessions) {
    if (!s.endedAt) continue;
    for (const it of s.items) if (it.exId === exId) for (const st of it.sets) {
      if (!st.done) continue;
      const r = parseReps(st.reps);
      if (r.total === 1 && !r.complex && !st.miss && st.kg > b) b = st.kg;
    }
  }
  return b;
}
export function bestSetE1rm(sessions, exId, sinceYmd) {
  let b = 0;
  for (const s of sessions) {
    if (!s.endedAt || (sinceYmd && s.date < sinceYmd)) continue;
    for (const it of s.items) if (it.exId === exId) for (const st of it.sets) {
      if (st.done) { const v = setE1rm(st); if (v > b) b = v; }
    }
  }
  return b;
}
/* Tendencia lineal del 1RM estimado semanal. Referencial: la pendiente se limita a +1,5 % por semana. */
export function project(pts) {
  if (pts.length < 4) return null;
  if (pts[pts.length - 1].x - pts[0].x < 3) return null;
  const n = pts.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
  const d = n * sxx - sx * sx;
  if (!d) return null;
  let m = (n * sxy - sx * sy) / d;
  const last = pts[n - 1];
  const cap = 0.015 * last.y;
  if (m > cap) m = cap;
  const b = sy / n - m * (sx / n);
  const yl = m * last.x + b;
  return { m: m, yFit: yl, p4: yl + 4 * m, p8: yl + 8 * m, xl: last.x };
}

/* Fecha corta en español de Chile («5 nov») */
export const fmtShort = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short' });
export function shortDate(d) { return fmtShort.format(d).replace('.', ''); }

/* ===== 4.20.0: resumen semanal en palabras, muro de marcas y progreso por ejercicio (todo con datos locales) ===== */

/* «Esta semana» (lunes → hoy) frente a la semana pasada hasta el mismo día. La carga se compara en UA (duración × RPE) si
   ambas semanas la tienen; si no, en tonelaje. plan = { done, total } de la semana asignada (o null). */
export function weekSummary(sessions, now, plan) {
  const mon = mondayOf(now), k0 = ymd(mon), k1 = ymd(addDays(now, 1)), p0 = ymd(addDays(mon, -7)), p1 = ymd(addDays(now, -6));
  const cur = periodStats(sessions, k0, k1), prev = periodStats(sessions, p0, p1);
  const ua = cur.load > 0 && prev.load > 0, metric = ua ? 'ua' : 'kg';
  const a = ua ? cur.load : cur.ton, b = ua ? prev.load : prev.ton;
  const ch = b > 0 && a > 0 ? (a - b) / b * 100 : null;
  return { cur: cur, prev: prev, metric: metric, value: a, before: b, ch: ch, plan: plan && plan.total > 0 ? plan : null, from: k0 };
}

/* Marcas en el tiempo: misma regla que «Marcas de hoy» al terminar una sesión. Por cada sesión (en orden), un ejercicio
   marca si su mejor peso a 1 repetición supera el anterior, o si no, si su 1RM estimado supera el anterior en más de 0,4 kg.
   La primera vez de cada ejercicio es la base (no es marca). isKg(exId) decide qué ejercicios cuentan (los medidos en kilos). */
export function recordsTimeline(sessions, isKg) {
  const list = sessions.filter(s => s.endedAt).slice().sort((a, b) => a.endedAt - b.endedAt);
  const bestS = {}, bestE = {}, out = [];
  for (const s of list) {
    for (const it of s.items || []) {
      if (isKg && !isKg(it.exId)) continue;
      let single = 0, best = 0, bestSet = null;
      for (const st of it.sets || []) {
        if (!st.done || st.miss) continue;
        const r = parseReps(st.reps), kg = parseNum(st.kg);
        if (r.total === 1 && !r.complex && kg > single) single = kg;
        const v = setE1rm(st); if (v > best) { best = v; bestSet = st; }
      }
      const ps = bestS[it.exId] || 0, pb = bestE[it.exId] || 0;
      if (single > 0 && ps > 0 && single > ps) out.push({ exId: it.exId, kind: 'single', kg: single, before: ps, date: s.date, at: s.endedAt, sessId: s.id });
      else if (best > 0 && pb > 0 && best > pb + 0.4) out.push({ exId: it.exId, kind: 'e1rm', kg: best, before: pb, date: s.date, at: s.endedAt, sessId: s.id, set: bestSet ? { kg: parseNum(bestSet.kg), reps: String(bestSet.reps) } : null });
      if (single > ps) bestS[it.exId] = single;
      if (best > pb) bestE[it.exId] = best;
    }
  }
  return out.reverse();   // lo más reciente primero
}

/* Últimas n sesiones con un ejercicio: fecha, mejor serie (por 1RM estimado) y series hechas */
export function lastSessionsOf(sessions, exId, n) {
  const out = [];
  const list = sessions.filter(s => s.endedAt).slice().sort((a, b) => b.endedAt - a.endedAt);
  for (const s of list) {
    let best = null, bv = 0, done = 0;
    for (const it of s.items || []) if (it.exId === exId) for (const st of it.sets || []) {
      if (!st.done || st.miss) continue;
      done++;
      const v = setE1rm(st); if (v > bv) { bv = v; best = { kg: parseNum(st.kg), reps: String(st.reps) }; }
    }
    if (done) out.push({ id: s.id, date: s.date, best: best, e1rm: bv, sets: done });
    if (out.length >= n) break;
  }
  return out;
}

/* Mejor serie desde una fecha (la de mayor 1RM estimado) */
export function bestSetOf(sessions, exId, sinceYmd) {
  let best = null, bv = 0;
  for (const s of sessions) {
    if (!s.endedAt || (sinceYmd && s.date < sinceYmd)) continue;
    for (const it of s.items || []) if (it.exId === exId) for (const st of it.sets || []) {
      if (!st.done) continue;
      const v = setE1rm(st); if (v > bv) { bv = v; best = { kg: parseNum(st.kg), reps: String(st.reps), e1rm: v, date: s.date }; }
    }
  }
  return best;
}

/* Mini-tendencia: puntos de una polilínea en una caja w × h (SVG) y una frase para lectores de pantalla */
export function sparkPoints(vals, w, h) {
  if (!vals || vals.length < 2) return '';
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1, pad = 2;
  return vals.map((v, i) => (pad + i * (w - 2 * pad) / (vals.length - 1)).toFixed(1) + ',' + (h - pad - (v - lo) / span * (h - 2 * pad)).toFixed(1)).join(' ');
}
export function trendText(vals, weeks) {
  if (!vals || vals.length < 2) return '';
  const d = vals[vals.length - 1] - vals[0], per = weeks ? ' en ' + weeks + (weeks === 1 ? ' semana' : ' semanas') : '';
  if (Math.abs(d) < 0.5) return 'estable' + per;
  return (d > 0 ? 'sube ' : 'baja ') + fmtNum(Math.abs(d), 1) + ' kg' + per;
}
