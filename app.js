/* App Halterofilia · selección. Código de la aplicación (sin paso de compilación). */
(function () {
'use strict';
/* ===== Lógica pura (sin DOM): cálculos de carga, 1RM, discos y proyección ===== */
const DAYS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DAYS_LONG = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const PLATES = [25, 20, 15, 10, 5, 2.5, 2, 1.5, 1, 0.5];
const PLATE_COLOR = { '25': 'red', '20': 'blue', '15': 'yellow', '10': 'green', '5': 'white', '2.5': 'red', '2': 'blue', '1.5': 'yellow', '1': 'green', '0.5': 'white' };
const ZONES = [
  { key: 'white', min: 0, label: 'Menos de 70%' },
  { key: 'green', min: 70, label: '70 – 79%' },
  { key: 'yellow', min: 80, label: '80 – 89%' },
  { key: 'blue', min: 90, label: '90 – 94%' },
  { key: 'red', min: 95, label: '95% o más' }
];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function parseNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  const t = String(v == null ? '' : v).trim().replace(',', '.');
  if (!t) return NaN;
  const n = Number(t);
  return isFinite(n) ? n : NaN;
}
function roundTo(x, step) {
  if (!(step > 0)) return x;
  return Math.round(Math.round(x / step) * step * 1000) / 1000;
}
function fmtNum(n, d) {
  if (d == null) d = 1;
  if (!isFinite(n)) return '–';
  const k = Math.pow(10, d);
  return (Math.round(n * k) / k).toLocaleString('es-CL', { maximumFractionDigits: d });
}
function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}
function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') : m + ':' + String(s).padStart(2, '0');
}
function fmtDur(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}
function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parseYmd(s) {
  const p = s.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}
function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
function weekdayIdx(d) { return (d.getDay() + 6) % 7; }
function mondayOf(d) { return addDays(d, -weekdayIdx(d)); }
function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* Repeticiones: acepta "3" o complejos como "1+2" (cargada + dos jerks). */
function parseReps(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return { total: 0, complex: false };
  const parts = s.split('+').map(p => parseInt(p, 10)).filter(n => n > 0);
  return { total: parts.reduce((a, b) => a + b, 0), complex: parts.length > 1 };
}

/* Multiplicador 1RM = peso × k(reps). Promedio Epley + Brzycki hasta 10 reps (coinciden en 10); sobre 10, Epley. */
function kRep(r) {
  if (r <= 1) return 1;
  const ep = 1 + r / 30;
  if (r <= 10) return (ep + 36 / (37 - r)) / 2;
  return ep;
}
function e1rm(w, r) { return w * kRep(r); }
function weightForReps(oneRM, r) { return oneRM / kRep(r); }

function zoneOf(pct) {
  if (!(pct > 0)) return null;
  let z = 'white';
  for (const o of ZONES) if (pct >= o.min) z = o.key;
  return z;
}

/* Discos por lado. Todo en gramos para evitar errores de coma flotante. */
function platesFor(target, bar) {
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
function setE1rm(st) {
  if (st.miss) return 0;
  const kg = parseNum(st.kg), r = parseReps(st.reps);
  if (!(kg > 0) || r.complex || r.total < 1 || r.total > 10) return 0;
  return kg * kRep(r.total);
}
function setTon(st) {
  if (st.miss) return 0;
  const kg = parseNum(st.kg), r = parseReps(st.reps);
  return (kg > 0 ? kg : 0) * r.total;
}
function sessionStats(sess) {
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
const WEIGHT_CATS = { M: [60, 65, 70, 75, 85, 95, 110], F: [49, 53, 57, 61, 69, 77, 86] };
const SEX_LABEL = { M: 'Masculino', F: 'Femenino' };
function catOptions(sex) {
  const l = WEIGHT_CATS[sex];
  return l ? l.map(String).concat(['+' + l[l.length - 1]]) : [];
}
/* Categoría según el sexo y el peso corporal. `override` (texto de catOptions) manda si es válido para ese sexo. */
function categoryOf(sex, bw, override) {
  const opts = catOptions(sex);
  if (!opts.length) return '';
  if (override && opts.indexOf(String(override)) >= 0) return String(override);
  const w = parseNum(bw);
  if (!(w > 0)) return '';
  const l = WEIGHT_CATS[sex];
  for (const c of l) if (w <= c) return String(c);
  return '+' + l[l.length - 1];
}
const catText = c => c ? (c.charAt(0) === '+' ? c + ' kg' : '−' + c + ' kg') : '';
function catSortKey(c) { return c.charAt(0) === '+' ? 1e6 + parseFloat(c.slice(1)) : parseFloat(c); }

/* Duración de la sesión en minutos: la anotada a mano o, si no, desde el inicio hasta la última serie marcada. */
function sessionDurMin(s) {
  if (s.durMin > 0) return s.durMin;
  let last = 0;
  (s.items || []).forEach(it => (it.sets || []).forEach(x => { if (x.done && x.doneAt > last) last = x.doneAt; }));
  const end = last > (s.startedAt || 0) ? last : (s.endedAt || 0);
  if (!(s.startedAt > 0) || !(end > s.startedAt)) return 0;
  return Math.min(300, Math.max(1, Math.round((end - s.startedAt) / 60000)));
}
/* RPE de la sesión: el anotado a mano o el promedio de los RPE de sus series. */
function sessionRpe(s) {
  if (s.srpe > 0) return s.srpe;
  let sum = 0, n = 0;
  (s.items || []).forEach(it => (it.sets || []).forEach(x => { const v = parseNum(x.rpe); if (x.done && v > 0) { sum += v; n++; } }));
  return n ? sum / n : 0;
}
/* Carga de sesión (unidades arbitrarias) = duración (min) × RPE de la sesión. 0 si falta alguno de los dos. */
function sessionLoad(s) {
  const d = sessionDurMin(s), r = sessionRpe(s);
  return d > 0 && r > 0 ? Math.round(d * r) : 0;
}
/* Resumen de un período [k0, k1) (fechas «AAAA-MM-DD»): sesiones, repeticiones (NL), tonelaje, intensidad media, carga y efectividad. */
function periodStats(sessions, k0, k1) {
  const o = { n: 0, sets: 0, reps: 0, ton: 0, loadSum: 0, loadN: 0, attempts: 0, valid: 0, intNum: 0, intDen: 0 };
  for (const s of sessions) {
    if (!s.endedAt || s.date < k0 || s.date >= k1) continue;
    o.n++;
    const l = sessionLoad(s); if (l > 0) { o.loadSum += l; o.loadN++; }
    for (const it of s.items) for (const st of it.sets) {
      if (!st.done) continue;
      if (parseNum(st.kg) > 0) { o.attempts++; if (!st.miss) o.valid++; }
      if (st.miss) continue;
      const r = parseReps(st.reps).total;
      o.sets++; o.reps += r; o.ton += setTon(st);
      if (st.pct > 0 && r > 0) { o.intNum += st.pct * r; o.intDen += r; }
    }
  }
  o.load = o.loadSum;
  o.intAvg = o.intDen ? o.intNum / o.intDen : 0;
  o.eff = o.attempts ? o.valid / o.attempts * 100 : null;
  return o;
}
/* Intentos válidos / intentos, por ejercicio, y de los intentos desde 90 % (o más). Orden: competencia primero. */
function efficiencyByExercise(sessions, sinceYmd, exInfo) {
  const m = new Map();
  for (const s of sessions) {
    if (!s.endedAt || (sinceYmd && s.date < sinceYmd)) continue;
    for (const it of s.items) for (const st of it.sets) {
      if (!st.done || !(parseNum(st.kg) > 0)) continue;
      let a = m.get(it.exId); if (!a) { a = { exId: it.exId, att: 0, ok: 0, hAtt: 0, hOk: 0 }; m.set(it.exId, a); }
      a.att++; if (!st.miss) a.ok++;
      if (st.pct >= 90) { a.hAtt++; if (!st.miss) a.hOk++; }
    }
  }
  const rank = id => { const i = exInfo ? exInfo(id) : null; return i && i.cat === 'comp' ? 0 : 1; };
  return Array.from(m.values()).sort((a, b) => rank(a.exId) - rank(b.exId) || b.att - a.att);
}
/* Razones entre máximos (en %): { clave: valor } solo si ambos máximos existen. `max(id)` devuelve el máximo del ejercicio. */
const RATIOS = [['snatch', 'cj', 'Arranque / Dos tiempos'], ['bsq', 'cj', 'Sentadilla trasera / Dos tiempos'], ['fsq', 'cj', 'Sentadilla frontal / Dos tiempos'], ['snpull', 'snatch', 'Tirón de arranque / Arranque'], ['clpull', 'clean', 'Tirón de cargada / Cargada']];
function ratiosOf(max) {
  const out = [];
  for (const r of RATIOS) { const a = max(r[0]), b = max(r[1]); if (a > 0 && b > 0) out.push({ label: r[2], pct: a / b * 100 }); }
  return out;
}
/* Meta de una marca: kg que faltan, semanas estimadas según la tendencia (kg por semana) y kg por semana necesarios para la fecha meta. */
function goalInfo(cur, goal, goalDate, slope, today) {
  if (!(goal > 0) || !(cur > 0)) return null;
  const o = { goal: goal, cur: cur, left: Math.max(0, goal - cur), done: cur >= goal, weeks: null, need: null, daysLeft: null };
  if (o.done) return o;
  if (slope > 0.05) o.weeks = o.left / slope;
  if (goalDate) { const d = daysBetween(today, parseYmd(goalDate)); o.daysLeft = d; if (d > 0) o.need = o.left / (d / 7); }
  return o;
}
function weeklyBest(sessions, exId) {
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
function topSingle(sessions, exId) {
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
function bestSetE1rm(sessions, exId, sinceYmd) {
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
function project(pts) {
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

if (typeof module !== 'undefined') {
  module.exports = { parseNum, roundTo, parseReps, kRep, e1rm, weightForReps, zoneOf, platesFor, setE1rm, setTon, sessionStats, weeklyBest, topSingle, bestSetE1rm, project, fmtNum, fmtTime, fmtClock, fmtDur, ymd, parseYmd, addDays, mondayOf, weekdayIdx, esc,
    WEIGHT_CATS, catOptions, categoryOf, catText, catSortKey, sessionDurMin, sessionRpe, sessionLoad, periodStats, efficiencyByExercise, ratiosOf, goalInfo };
}

/* ===== Estado, persistencia, datos de ejemplo, temporizador ===== */
let KEY = 'halterofilia.v1.local';
let APP = { requireSex: false, tabs: [], nav: null, more: null, accountHTML: null, onAct: null, onSave: null, cloud: false }; // lo define cloud.js al iniciar
const CATS = [['comp', 'Competencia'], ['cmplx', 'Complejos'], ['tec', 'Técnica'], ['tiron', 'Tirones'], ['fuerza', 'Fuerza'], ['acc', 'Accesorios']];
const REST_OPTS = [30, 45, 60, 90, 120, 150, 180, 240, 300];
const DEFAULT_PROFILE = { name: '', bw: 0, bar: 20, rounding: 1, rest: 120, timerEnabled: true, autoTimer: false, timerMode: 'down', sound: true, vibrate: true, keepAwake: true, showRpe: true, prefs: 2, exLang: 'en', sex: '', cat: '', trackMiss: true };

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* Nombres de los ejercicios: inglés principal y español debajo (o al revés, según el ajuste de cada atleta) */
const EN_NAMES = { snatch: 'Snatch', cj: 'Clean & Jerk', psnatch: 'Power Snatch', clean: 'Clean', pclean: 'Power Clean', jerk: 'Jerk', ohsq: 'Overhead Squat', snpull: 'Snatch Pull', clpull: 'Clean Pull',
  bsq: 'Back Squat', fsq: 'Front Squat', pp: 'Push Press', press: 'Military Press', rdl: 'Romanian Deadlift', row: 'Barbell Row', 'cx-clfj': 'Clean + Front Squat + Jerk', 'cx-snoh': 'Snatch + Overhead Squat' };
function exNames(e) {
  const en = e.en || EN_NAMES[e.id] || '', es = e.es || e.name || '';
  if (!en || en === es) return { p: es || en || e.name, s: '' };
  return S && S.profile.exLang === 'es' ? { p: es, s: en } : { p: en, s: es };
}
const nm = e => exNames(e).p;
const nmSub = e => { const x = exNames(e).s; return x ? '<small class="exsub">' + esc(x) + '</small>' : ''; };

function defaultExercises() {
  const L = [
    ['snatch', 'Arranque', 'comp', 150], ['cj', 'Dos tiempos', 'comp', 180],
    ['psnatch', 'Arranque de potencia', 'tec', 120], ['clean', 'Cargada', 'tec', 150],
    ['pclean', 'Cargada de potencia', 'tec', 120], ['jerk', 'Jerk', 'tec', 150],
    ['ohsq', 'Sentadilla sobre la cabeza', 'tec', 120],
    ['snpull', 'Tirón de arranque', 'tiron', 120], ['clpull', 'Tirón de cargada', 'tiron', 120],
    ['bsq', 'Sentadilla trasera', 'fuerza', 180], ['fsq', 'Sentadilla frontal', 'fuerza', 180],
    ['pp', 'Push press', 'fuerza', 120], ['press', 'Press militar', 'fuerza', 120],
    ['rdl', 'Peso muerto rumano', 'acc', 120], ['row', 'Remo con barra', 'acc', 90],
    ['cx-clfj', 'Cargada + sentadilla frontal + jerk', 'cmplx', 180], ['cx-snoh', 'Arranque + sentadilla sobre la cabeza', 'cmplx', 180]
  ];
  return L.map(e => ({ id: e[0], name: e[1], cat: e[2], rest: e[3], max: 0, maxDate: null, builtin: true }));
}
function freshState() {
  return {
    v: 1, demo: false, profile: Object.assign({}, DEFAULT_PROFILE), exercises: defaultExercises(),
    plan: { days: Array.from({ length: 7 }, () => ({ on: false, name: '', items: [] })) }, sessions: []
  };
}

function demoState() {
  const rnd = mulberry32(11), st = freshState();
  st.demo = true; st.profile.name = 'Atleta de ejemplo'; st.profile.bw = 81; st.profile.sex = 'M';
  const fm = { snatch: 74, cj: 96, clean: 100, jerk: 98, psnatch: 62, pclean: 82, snpull: 90, clpull: 112, bsq: 128, fsq: 104, pp: 70 };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  st.exercises.forEach(e => { if (fm[e.id]) { e.max = fm[e.id]; e.maxDate = ymd(addDays(today, -10)); } });
  st.exercises.find(e => e.id === 'snatch').goal = 85; st.exercises.find(e => e.id === 'snatch').goalDate = ymd(addDays(today, 84));
  st.profile.bwLog = [-21, -14, -7].map((d, i) => ({ d: ymd(addDays(today, d)), kg: 81 + [0.4, 0.1, 0][i] }));
  const it = (exId, sets, reps, pct) => ({ exId: exId, sets: sets, reps: String(reps), pct: pct, rest: 0 });
  st.plan.days[0] = { on: true, name: 'Volumen', items: [it('snatch', 5, 2, 75), it('snpull', 4, 3, 90), it('bsq', 5, 5, 75)] };
  st.plan.days[2] = { on: true, name: 'Dos tiempos + frontal', items: [it('cj', 4, '1+1', 75), it('clpull', 4, 3, 90), it('fsq', 4, 4, 75)] };
  st.plan.days[4] = { on: true, name: 'Pesado', items: [it('snatch', 3, 1, 92), it('cj', 3, 1, 92), it('pp', 4, 3, 75)] };
  const mon = mondayOf(today);
  for (let w = 9; w >= 0; w--) {
    const deload = (w % 4 === 3), g = 1 - 0.009 * w;
    for (const d of [0, 2, 4]) {
      const date = addDays(mon, -7 * w + d);
      if (date >= today) continue;
      const day = st.plan.days[d];
      const start = new Date(date); start.setHours(18, rnd() < 0.5 ? 0 : 30, 0, 0);
      let t = start.getTime();
      const items = [];
      for (const p of day.items) {
        const e = st.exercises.find(x => x.id === p.exId);
        const item = { exId: p.exId, rest: e.rest, sets: [] };
        for (let k = 0; k < p.sets; k++) {
          if (rnd() < 0.06) continue;
          const pct = p.pct - (deload ? 8 : 0);
          const kg = roundTo(fm[p.exId] * g * pct / 100, 1);
          t += (40 + rnd() * 40) * 1000 + (k ? e.rest * 1000 * (0.85 + rnd() * 0.3) : 0);
          const miss = pct >= 90 && rnd() < 0.15;
          item.sets.push(Object.assign({ kg: kg, reps: p.reps, pct: pct, rpe: null, done: true, doneAt: t }, miss ? { miss: true } : {}));
        }
        if (item.sets.length) items.push(item);
      }
      st.sessions.push({ id: uid(), date: ymd(date), dayIdx: d, name: day.name, startedAt: start.getTime(), endedAt: t + 120000, notes: '', bw: 81, srpe: deload ? 5 : 6 + Math.round(rnd() * 3), items: items });
    }
  }
  return st;
}

let S = null, storageOK = true, saveT = null;
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && o.v === 1 && Array.isArray(o.sessions) && Array.isArray(o.exercises) && o.plan && Array.isArray(o.plan.days)) return o;
    }
  } catch (e) { storageOK = false; }
  return null;
}
function save(now) {
  clearTimeout(saveT);
  const go = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); storageOK = true; } catch (e) { storageOK = false; renderBanner(); } if (S && APP.onSave) { try { APP.onSave(); } catch (e) { /* la sincronización no debe frenar el guardado */ } } };
  if (now) go(); else saveT = setTimeout(go, 250);
}
function normalize(o) {
  const old = o.profile && o.profile.prefs !== 2;
  o.profile = Object.assign({}, DEFAULT_PROFILE, o.profile || {});
  /* una categoría elegida que ya no existe (cambio de la IWF del 1-ago-2026) se descarta: vuelve la automática según el peso */
  if (o.profile.cat && catOptions(o.profile.sex).indexOf(String(o.profile.cat)) < 0) o.profile.cat = '';
  if (old) {
    /* una sola vez: valores iniciales según el cuestionario del equipo */
    o.profile.showRpe = true; o.profile.autoTimer = false; o.profile.prefs = 2;
    defaultExercises().filter(e => e.cat === 'cmplx' && !o.exercises.some(x => x.id === e.id)).forEach(e => o.exercises.push(e));
  }
  while (o.plan.days.length < 7) o.plan.days.push({ on: false, name: '', items: [] });
  return o;
}

function ex(id) {
  return S.exercises.find(e => e.id === id) || { id: id, name: 'Ejercicio eliminado', cat: 'acc', rest: S.profile.rest, max: 0, maxDate: null };
}
function activeSession() { return S.sessions.find(s => !s.endedAt) || null; }
function endedSessions() { return S.sessions.filter(s => s.endedAt); }
/* Las repeticiones de la planificación (pr) se muestran sombreadas como guía; el campo queda vacío y el atleta anota las que hace */
function mkSet(e, reps, pct) {
  const kg = (e.max > 0 && pct > 0) ? roundTo(e.max * pct / 100, S.profile.rounding) : 0, pr = String(reps == null ? '' : reps);
  return Object.assign({ kg: kg, reps: '', pct: pct || 0, rpe: null, done: false, doneAt: null }, pr ? { pr: pr } : {});
}
function lastSetsFor(exId) {
  const list = endedSessions().sort((a, b) => b.endedAt - a.endedAt);
  for (const s of list) {
    const it = s.items.find(i => i.exId === exId);
    if (it && it.sets.length) return it.sets.map(x => ({ kg: x.kg, reps: x.reps, pct: x.pct, rpe: null, done: false, doneAt: null }));
  }
  return null;
}
function newSession(dayIdx) {
  const day = dayIdx != null ? S.plan.days[dayIdx] : null;
  const s = { id: uid(), date: ymd(new Date()), dayIdx: dayIdx, name: day ? (day.name || 'Entrenamiento') : 'Sesión libre', startedAt: Date.now(), endedAt: null, notes: '', bw: S.profile.bw || null, items: [] };
  if (day) for (const p of day.items) {
    const e = ex(p.exId);
    let item = s.items.find(x => x.exId === p.exId);
    if (!item) { item = { exId: p.exId, rest: p.rest > 0 ? p.rest : (e.rest || S.profile.rest), sets: [] }; s.items.push(item); }
    for (let k = 0; k < p.sets; k++) item.sets.push(mkSet(e, p.reps, p.pct));
  }
  return s;
}

/* ===== Temporizador / cronómetro ===== */
const T = { mode: 'down', running: false, start: 0, acc: 0, target: 120, label: '', fired: false };
function tElapsed() { return T.acc + (T.running ? Date.now() - T.start : 0); }
function tStart() { if (!T.running) { T.start = Date.now(); T.running = true; } }
function tPause() { if (T.running) { T.acc += Date.now() - T.start; T.running = false; } }
function tReset(target) { T.acc = 0; T.running = false; T.fired = false; if (target != null) T.target = target; }

let actx = null;
function primeAudio() {
  if (actx) return;
  try { const C = window.AudioContext || window.webkitAudioContext; if (C) { actx = new C(); if (actx.state === 'suspended') actx.resume(); } } catch (e) { actx = null; }
}
function beep() {
  if (!S.profile.sound || !actx) return;
  try {
    if (actx.state === 'suspended') actx.resume();
    const t0 = actx.currentTime;
    [0, 0.3, 0.6].forEach((d, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = i === 2 ? 1175 : 880;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.22);
      o.connect(g); g.connect(actx.destination); o.start(t0 + d); o.stop(t0 + d + 0.25);
    });
  } catch (e) { /* sin audio */ }
}
function alarm() {
  beep();
  if (S.profile.vibrate) { try { if (navigator.vibrate) navigator.vibrate([250, 120, 250, 120, 400]); } catch (e) { /* sin vibración */ } }
}

let wl = null;
async function syncWake() {
  const want = !!(S && S.profile.keepAwake && activeSession() && document.visibilityState === 'visible');
  try {
    if (want && !wl && navigator.wakeLock) {
      wl = await navigator.wakeLock.request('screen');
      wl.addEventListener('release', () => { wl = null; });
    } else if (!want && wl) { const w = wl; wl = null; await w.release(); }
  } catch (e) { wl = null; }
}

/* ===== Iconos, utilidades de interfaz y vistas ===== */
const IC = {
  hoy: '<path d="M3.5 11L12 4l8.5 7"/><path d="M5.5 9.8V20h13V9.8"/><path d="M10 20v-5.5h4V20"/>',
  plan: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  prog: '<path d="M3 18l5.5-6 4 3.5L21 6"/><path d="M15 6h6v6"/>',
  max: '<path d="M2.5 9.5v5M5.5 7v10M18.5 7v10M21.5 9.5v5M5.5 12h13"/>',
  gear: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  semana: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14.5l2.2 2.2 4.3-4.4"/>',
  team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.3a3 3 0 010 5.4M18.5 14c1.6.7 2.8 2.3 2.8 4.5"/>',
  file: '<path d="M6.5 3h7l4.5 4.5V21h-11.5z"/><path d="M13.5 3v4.5H18M9.5 12.5h5M9.5 16h5"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  chev: '<path d="M9 5.5l6.5 6.5L9 18.5"/>',
  cloud: '<path d="M7 18a4 4 0 010-8 5 5 0 019.6-1A4.5 4.5 0 0117 18z"/><path d="M9.5 13.5l2 2 3.5-3.5"/>',
  out: '<path d="M10 4.5H6a1.5 1.5 0 00-1.5 1.5v12A1.5 1.5 0 006 19.5h4"/><path d="M15 8l4 4-4 4M19 12H9.5"/>',
  timer: '<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V9.5M9.5 3h5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  play: '<path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor"/>',
  pause: '<path d="M8 5.5v13M16 5.5v13" stroke-width="3"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.6-5.9M4 4.5V9h4.5"/>',
  hist: '<path d="M4 12a8 8 0 1 0 2.6-5.9M4 4.5V9h4.5"/><path d="M12 8v4.5l3 1.8"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M8 6H5v1.5A3 3 0 008 10.5M16 6h3v1.5a3 3 0 01-3 3M12 13v4M8.5 20h7M10 17h4"/>',
  warn: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  scale: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 9.5a4.5 4.5 0 017 0M12 14l2-3"/>'
};
function svg(n, c) {
  return '<svg class="ic ' + (c || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[n] + '</svg>';
}
/* Estado vacío común: icono, título, texto y (opcional) un botón. `text` y `action` son HTML ya escapado. */
function emptyHTML(ico, title, text, action) {
  return '<div class="empty"><span class="empty-ic">' + svg(ico) + '</span><b>' + esc(title) + '</b>' + (text ? '<p>' + text + '</p>' : '') + (action || '') + '</div>';
}
/* Aviso de error con pantalla propia: icono, título, mensaje y (opcional) «Reintentar». `msg` es texto plano. */
function errorHTML(msg, o) {
  o = o || {};
  return '<div class="errbox" role="alert"><span class="errbox-ic">' + svg('warn') + '</span><div><b>' + esc(o.title || 'No se pudo cargar') + '</b><p>' + esc(msg) + '</p>' +
    (o.retry ? '<button class="btn sm" data-act="' + esc(o.retry) + '">Reintentar</button>' : '') + '</div></div>';
}
function plateDot(z) { return '<i class="pl pl-' + (z || 'none') + '" aria-hidden="true"></i>'; }
function setDot(el, z) { if (el) el.className = 'pl pl-' + (z || 'none'); }

const ui = { tab: 'hoy', range: 8, progEx: null, openSess: null, confirm: null, dockMin: false, sheet: null, histN: 10, charts: {}, calc: null, toastFn: null };
let prevConfirm = null;
const fmtDay = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short' });
const fmtWk = new Intl.DateTimeFormat('es-CL', { weekday: 'short', day: 'numeric', month: 'short' });
function shortDate(d) { return fmtShort.format(d).replace('.', ''); }

function restSelect(val, attrs, auto) {
  const opts = REST_OPTS.slice();
  if (val > 0 && opts.indexOf(val) < 0) { opts.push(val); opts.sort((a, b) => a - b); }
  return '<select class="sel" ' + attrs + ' aria-label="Descanso entre series">' + (auto ? '<option value="0"' + (!val ? ' selected' : '') + '>Auto</option>' : '') +
    opts.map(s => '<option value="' + s + '"' + (s === val ? ' selected' : '') + '>' + fmtTime(s) + '</option>').join('') + '</select>';
}
function confirmLabel(key, normal, ask) { return ui.confirm === key ? ask : normal; }

function legendHTML() {
  const t = ['< 70', '70–79', '80–89', '90–94', '≥ 95'];
  return '<div class="legend" aria-label="Color según % del máximo">' + ZONES.map((z, i) => '<span>' + plateDot(z.key) + t[i] + '</span>').join('') + '<span class="legend-t">% del máximo</span></div>';
}
function planPreview(p, e, rt) {
  const parts = [p.sets + '×' + (p.reps || '?')];
  if (rt) { if (p.pct > 0) parts.push(fmtNum(p.pct, 1) + ' %'); if (p.pause > 0) parts.push('pausa ' + p.pause + ' s'); if (p.rest > 0) parts.push('descanso ' + fmtTime(p.rest)); }   // los kilos los calcula cada atleta con su máximo
  else if (p.pct > 0 && e.max > 0) parts.push('≈ ' + fmtNum(roundTo(e.max * p.pct / 100, S.profile.rounding), 1) + ' kg');
  else if (p.pct > 0) parts.push('sin máximo');
  return parts.join(' · ');
}
function totalsText(s) {
  const st = sessionStats(s);
  return 'Series ' + st.sets + ' de ' + (st.sets + st.missed + st.pending) + (st.missed ? ' (' + st.missed + (st.missed === 1 ? ' fallada' : ' falladas') + ')' : '') + '  ·  Tonelaje ' + fmtNum(st.ton, 0) + ' kg';
}
function updateTotals() { const s = activeSession(); if (s) setText($('#sessTotals'), totalsText(s)); }

/* ----- HOY ----- */
function weekStrip() {
  const now = new Date(), mon = mondayOf(now), done = new Set(endedSessions().map(s => s.date));
  let h = '<ol class="week" aria-label="Semana actual">';
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i), key = ymd(d), isToday = key === ymd(now), planned = S.plan.days[i].on, did = done.has(key);
    const state = did ? 'Entrenado' : planned ? 'Planificado' : 'Descanso';
    h += '<li class="wd' + (isToday ? ' today' : '') + (did ? ' did' : '') + (planned ? ' planned' : '') + '"><span>' + DAYS_SHORT[i] + '</span><b>' + d.getDate() + '</b><i class="wm">' + (did ? svg('check') : planned ? '<em></em>' : '') + '</i><span class="vh">' + state + '</span></li>';
  }
  return h + '</ol>';
}
function planItemsList(day) {
  return '<ul class="plan-list">' + day.items.map(p => {
    const e = ex(p.exId);
    return '<li>' + plateDot(zoneOf(p.pct)) + '<span class="pl-n">' + esc(nm(e)) + '</span><span class="pl-d">' + esc(planPreview(p, e)) + (p.pct > 0 ? '<small>' + fmtNum(p.pct, 1) + '%</small>' : '') + '</span></li>';
  }).join('') + '</ul>';
}
function viewHoy() {
  const a = activeSession();
  if (a) return viewLogger(a);
  const now = new Date(), di = weekdayIdx(now), day = S.plan.days[di];
  const ended = endedSessions().sort((x, y) => y.endedAt - x.endedAt);
  const todayDone = ended.some(s => s.date === ymd(now));
  let title, sub;
  if (todayDone) { title = 'Sesión de hoy registrada'; sub = 'Puedes entrenar de nuevo o revisar tu progreso.'; }
  else if (day.on) { title = day.name || 'Entrenamiento'; sub = day.items.length ? day.items.length + (day.items.length === 1 ? ' ejercicio' : ' ejercicios') + ' en el plan' : 'Este día aún no tiene ejercicios.'; }
  else { title = 'Día de descanso'; sub = 'No tienes sesión planificada hoy.'; }
  let h = '<section class="sec"><p class="eyebrow">' + esc(cap(fmtDay.format(now))) + '</p><h1>' + esc(title) + '</h1><p class="muted">' + esc(sub) + '</p>' + weekStrip() + '</section>';
  if (day.on) {
    h += '<section class="card sec hoy-plan">' + (day.items.length ? planItemsList(day) : emptyHTML('plan', 'Este día no tiene ejercicios', 'Arma la sesión en tu plan semanal.')) +
      '<div class="actions go"><button class="btn block" data-act="start" data-d="' + di + '">' + svg('play') + '<span>Iniciar entrenamiento</span></button>' +
      (day.items.length ? '' : '<button class="btn ghost block" data-act="tab" data-tab="plan">Ir al plan</button>') + '</div></section>';
  }
  const lastBw = Array.isArray(S.profile.bwLog) && S.profile.bwLog.length ? S.profile.bwLog[S.profile.bwLog.length - 1] : null;
  const bwStale = !lastBw || daysBetween(parseYmd(lastBw.d), now) >= 7;
  if (bwStale) {
    h += '<section class="card sec bw-card"><div class="bw-head"><span class="empty-ic">' + svg('scale') + '</span><div><p class="eyebrow">Peso corporal semanal</p><p class="muted">' + (lastBw ? 'Último registro: ' + fmtNum(lastBw.kg, 1) + ' kg el ' + esc(shortDate(parseYmd(lastBw.d))) + '. ' : '') + 'Anótalo una vez por semana: define tu categoría de peso.</p></div></div>' +
      '<div class="row2"><input class="num" id="bwq" data-f="bwq" inputmode="decimal" autocomplete="off" placeholder="kg" aria-label="Peso corporal en kg"><button class="btn" data-act="bw-save">Guardar</button></div></section>';
  }
  const others = [];
  S.plan.days.forEach((d, i) => { if (d.on && i !== di && d.items.length) others.push('<button class="btn ghost sm" data-act="start" data-d="' + i + '">' + DAYS_SHORT[i] + ' · ' + esc(d.name || 'Entrenamiento') + '</button>'); });
  h += '<section class="sec"><p class="eyebrow">Otras opciones</p><div class="chips">' + '<button class="btn ghost sm" data-act="start">Sesión libre</button>' + others.join('') + '</div></section>';
  if (ended.length) {
    const s = ended[0], st = sessionStats(s);
    h += '<section class="card sec"><p class="eyebrow">Última sesión</p><div class="last"><div><b>' + esc(s.name) + '</b><span class="muted"> · ' + esc(cap(fmtWk.format(parseYmd(s.date)).replace('.', ''))) + '</span></div><div class="muted">' + st.sets + ' series · ' + fmtNum(st.ton, 0) + ' kg · ' + fmtDur((s.endedAt - s.startedAt) / 1000) + '</div></div><button class="lnk" data-act="tab" data-tab="prog">Ver historial</button></section>';
  }
  return h;
}

/* ----- Registro de sesión en curso ----- */
function rpeSelect(st, id) {
  const o = ['', 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
  return '<select class="sel rpe" id="' + id + '" data-f="rpe" aria-label="Esfuerzo percibido RPE">' + o.map(v => '<option value="' + v + '"' + (String(st.rpe == null ? '' : st.rpe) === String(v) ? ' selected' : '') + '>' + (v === '' ? '–' : fmtNum(v, 1)) + '</option>').join('') + '</select>';
}
function setRowHTML(i, j, st, it) {
  const e = ex(it.exId), id = 's-' + i + '-' + j, rpe = S.profile.showRpe, tm = S.profile.trackMiss !== false;
  return '<div class="set' + (rpe ? ' rpe' : '') + (tm ? ' tm' : '') + (st.done ? ' is-done' : '') + (st.miss ? ' is-miss' : '') + '" data-i="' + i + '" data-j="' + j + '">' +
    '<span class="set-n">' + (j + 1) + '</span>' +
    '<input class="num" id="' + id + '-kg" data-f="kg" inputmode="decimal" autocomplete="off" aria-label="Peso en kg, serie ' + (j + 1) + '" placeholder="kg" value="' + (st.kg > 0 ? fmtNum(st.kg, 2) : '') + '">' +
    '<input class="num" id="' + id + '-reps" data-f="reps" inputmode="text" autocomplete="off" aria-label="Repeticiones, serie ' + (j + 1) + (st.pr ? ' (planificadas: ' + esc(st.pr) + ')' : '') + '" placeholder="' + esc(st.pr || 'reps') + '" value="' + esc(st.reps) + '">' +
    '<div class="pctw"><input class="num" id="' + id + '-pct" data-f="pct" inputmode="decimal" autocomplete="off" aria-label="Porcentaje del máximo, serie ' + (j + 1) + '" placeholder="%"' + (e.max > 0 ? '' : ' disabled') + ' value="' + (st.pct > 0 ? fmtNum(st.pct, 1) : '') + '">' + plateDot(zoneOf(st.pct)) + '</div>' +
    (rpe ? rpeSelect(st, id + '-rpe') : '') +
    (tm ? '<button class="missb" data-act="miss" aria-pressed="' + !!st.miss + '" aria-label="Serie ' + (j + 1) + ': levantamiento fallado">✕</button>' : '') +
    '<button class="tick" data-act="tick" aria-pressed="' + st.done + '" aria-label="Marcar serie ' + (j + 1) + ' como hecha">' + svg('check') + '</button></div>';
}
/* Complejo: ejercicio de la categoría «Complejos» o con «+» en el nombre (p. ej. «Arranque con pausa + tirón»). No tiene máximo propio. */
const isComplex = e => !!e && (e.cat === 'cmplx' || /\s\+\s/.test(e.en || e.name || ''));
function exerciseCard(it, i) {
  const e = ex(it.exId), rpe = S.profile.showRpe, tm = S.profile.trackMiss !== false;
  return '<article class="card exc" data-i="' + i + '"><header class="exc-h"><div><h3>' + esc(nm(e)) + '</h3>' + nmSub(e) +
    (isComplex(e) ? '<span class="chip-note">Complejo: sin máximo propio, los kilos salen del máximo de su primer movimiento</span>'
      : '<button class="chip" data-act="edit-max" data-ex="' + esc(e.id) + '">' + (e.max > 0 ? '1RM ' + fmtNum(e.max, 1) + ' kg' : 'Definir máximo') + '</button>') +
    (it.pause > 0 ? '<span class="chip-pause">Pausa de ' + it.pause + ' s en el movimiento</span>' : '') + '</div>' +
    '<label class="rest"><span>Descanso</span>' + restSelect(it.rest, 'id="rest-' + i + '" data-f="rest"') + '</label></header>' +
    '<div class="set sethead' + (rpe ? ' rpe' : '') + (tm ? ' tm' : '') + '" aria-hidden="true"><span></span><span>kg</span><span>reps</span><span>%</span>' + (rpe ? '<span>RPE</span>' : '') + (tm ? '<span>Falló</span>' : '') + '<span></span></div>' +
    it.sets.map((st, j) => setRowHTML(i, j, st, it)).join('') +
    '<label class="inote-l"><span class="sr-only">Observación de este ejercicio</span><input class="txt inote" data-f="inote" maxlength="200" autocomplete="off" placeholder="Observación (técnica, dolor…)" value="' + esc(it.note || '') + '"></label>' +
    '<div class="exc-f"><button class="btn ghost sm" data-act="add-set" data-i="' + i + '">+ Serie</button>' +
    '<button class="btn ghost sm" data-act="rm-set" data-i="' + i + '">' + confirmLabel('rs' + i, '− Serie', '¿Quitar hecha?') + '</button>' +
    '<button class="btn ghost sm" data-act="plates" data-i="' + i + '">Discos</button>' +
    '<button class="lnk danger" data-act="rm-ex" data-i="' + i + '">' + confirmLabel('rm' + i, 'Quitar ejercicio', 'Confirmar quitar') + '</button></div></article>';
}
function viewLogger(s) {
  let h = '<section class="sec"><div class="logger-head"><div><p class="eyebrow"><span class="live">En curso</span> · <span id="sessClock">' + fmtClock((Date.now() - s.startedAt) / 1000) + '</span></p><h1>' + esc(s.name) + '</h1></div>' +
    '<button class="btn sm gold" data-act="finish">' + svg('check') + '<span>Terminar</span></button></div>' + legendHTML() + '</section>';
  h += s.items.map((it, i) => exerciseCard(it, i)).join('');
  h += '<button class="btn ghost block" data-act="add-ex">+ Añadir ejercicio</button>';
  h += '<p class="muted hint">Complex: escribe <b>1+2</b> en reps (1 cargada + 2 jerk). ¿No está tu ejercicio o complex? <button class="lnk" data-act="ex-new-sess">Créalo aquí</button></p>';
  h += '<div class="card totals"><span id="sessTotals">' + esc(totalsText(s)) + '</span></div>';
  h += '<section class="sec"><p class="eyebrow">Carga de la sesión</p><div class="row2"><label class="fl"><span>RPE de la sesión (1–10)</span><select class="sel tall" id="srpe" data-f="srpe">' +
    ['', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => '<option value="' + v + '"' + (String(s.srpe || '') === String(v) ? ' selected' : '') + '>' + (v === '' ? (sessionRpe(s) ? 'Auto · ' + fmtNum(sessionRpe(s), 1) : '–') : v) + '</option>').join('') + '</select></label>' +
    '<label class="fl"><span>Duración (min)</span><input class="num" id="durMin" data-f="durMin" inputmode="numeric" autocomplete="off" placeholder="Auto" value="' + (s.durMin > 0 ? s.durMin : '') + '"></label></div>' +
    '<p class="muted hint">Carga = duración × RPE de la sesión. Si lo dejas en «Auto», se calcula con la hora de tu última serie y el promedio de tus RPE.</p></section>';
  h += '<section class="sec"><label class="eyebrow" for="notes">Notas de la sesión</label><textarea class="txt area" id="notes" data-f="notes" rows="3" placeholder="Técnica, sensaciones, molestias…">' + esc(s.notes) + '</textarea>' +
    '<div class="row-end"><button class="lnk danger" data-act="cancel-sess">' + confirmLabel('cancel', 'Descartar sesión', 'Confirmar descartar sesión') + '</button></div></section>';
  return h;
}

/* ----- PLAN ----- */
function planRow(d, i, p, k, rt) {
  const e = rt ? rtEx(p) : ex(p.exId), id = i + '-' + k;
  return '<div class="prow" data-d="' + i + '" data-k="' + k + '"><div class="prow-h"><span class="pn">' + plateDot(zoneOf(p.pct)) + esc(nm(e)) + '</span><span class="pv" id="pv-' + id + '">' + esc(planPreview(p, e, rt)) + '</span>' +
    '<button class="icon-btn sm" data-act="plan-rm" data-d="' + i + '" data-k="' + k + '" aria-label="Quitar ' + esc(nm(e)) + ' del plan">' + svg('close') + '</button></div>' +
    '<div class="prow-f' + (rt ? ' rt' : '') + '"><label><span>Series</span><input class="num sm" id="ps-' + id + '" data-f="psets" inputmode="numeric" value="' + p.sets + '"></label>' +
    '<label><span>Reps</span><input class="num sm" id="pr-' + id + '" data-f="preps" inputmode="text" value="' + esc(p.reps) + '"></label>' +
    '<label><span>% máx.</span><input class="num sm" id="pp-' + id + '" data-f="ppct" inputmode="decimal" value="' + (p.pct > 0 ? fmtNum(p.pct, 1) : '') + '"></label>' +
    '<label><span>Descanso</span>' + restSelect(p.rest, 'id="pd-' + id + '" data-f="prest"', true) + '</label>' +
    (rt ? '<label><span>Pausa (s)</span><input class="num sm" id="pz-' + id + '" data-f="ppause" inputmode="numeric" placeholder="0–10" maxlength="2" aria-label="Pausa en el movimiento, de 0 a 10 segundos" value="' + (p.pause > 0 ? p.pause : '') + '"></label>' : '') + '</div></div>';
}
function dayCard(d, i) {
  const isToday = weekdayIdx(new Date()) === i;
  let h = '<article class="card day' + (d.on ? ' on' : '') + '" data-d="' + i + '"><header class="day-h"><div class="day-t"><p class="eyebrow">' + DAYS_LONG[i] + (isToday ? ' · hoy' : '') + '</p>' +
    (d.on ? '<input class="txt" id="dn-' + i + '" data-f="dname" maxlength="40" value="' + esc(d.name) + '" placeholder="Nombre de la sesión" aria-label="Nombre de la sesión del ' + DAYS_LONG[i] + '">' : '<p class="muted">Descanso</p>') +
    '</div><label class="sw"><input type="checkbox" id="don-' + i + '" data-f="don"' + (d.on ? ' checked' : '') + '><span class="sw-ui"></span><span class="vh">Día de entrenamiento: ' + DAYS_LONG[i] + '</span></label></header>';
  if (d.on) {
    h += d.items.map((p, k) => planRow(d, i, p, k)).join('');
    h += '<button class="btn ghost sm" data-act="plan-add" data-d="' + i + '">+ Ejercicio</button>';
  }
  return h + '</article>';
}
/* ----- Rutinas especiales (el entrenador las arma para un atleta con este mismo editor; la pantalla la dibuja assign.js) ----- */
const RT = { days: null, onChange: null };
const rtEx = p => S.exercises.find(e => e.id === p.exId) || { id: p.exId, name: p.name || 'Ejercicio', cat: p.cat || 'acc', rest: 0, max: 0 };
function rtBind(days, onChange) { RT.days = days; RT.onChange = onChange || null; }
function rtCard(d, i) {
  let h = '<article class="card day on" data-rt="1" data-d="' + i + '"><header class="day-h"><div class="day-t"><p class="eyebrow">Sesión ' + (i + 1) + '</p>' +
    '<input class="txt" id="dn-' + i + '" data-f="dname" maxlength="40" value="' + esc(d.name) + '" placeholder="Nombre de la sesión" aria-label="Nombre de la sesión ' + (i + 1) + '"></div>' +
    '<button class="icon-btn sm" data-act="rt-ses-rm" data-d="' + i + '" aria-label="Quitar la sesión ' + (i + 1) + '">' + svg('close') + '</button></header>';
  h += d.items.map((p, k) => planRow(d, i, p, k, true)).join('');
  return h + '<button class="btn ghost sm" data-act="rt-add" data-d="' + i + '">+ Ejercicio</button></article>';
}
function viewPlan() {
  let h = '<section class="sec"><h1>Plan semanal</h1><p class="muted">Marca los días que entrenas y arma cada sesión. Los kilos salen de tu máximo y del porcentaje.</p>' + legendHTML() + '</section>';
  h += S.plan.days.map((d, i) => dayCard(d, i)).join('');
  return h;
}

/* ----- MÁXIMOS ----- */
function bestRecentSet() {
  const since = ymd(addDays(new Date(), -84));
  let best = null, bv = 0;
  for (const s of endedSessions()) {
    if (s.date < since) continue;
    for (const it of s.items) for (const st of it.sets) {
      if (!st.done) continue;
      const v = setE1rm(st);
      if (v > bv) { bv = v; best = { exId: it.exId, kg: st.kg, reps: parseReps(st.reps).total }; }
    }
  }
  return best;
}
function calcOut(kg, reps) {
  const r = Math.round(reps);
  if (!(kg > 0) || !(r >= 1)) return '<p class="muted">Escribe el peso y las repeticiones de una serie.</p>';
  const E = e1rm(kg, r), step = S.profile.rounding;
  let h = '<p class="big">≈ ' + fmtNum(E, 1) + ' <small>kg</small></p><p class="muted">1RM estimado (promedio Epley y Brzycki).' + (r > 10 ? ' Con más de 10 repeticiones la estimación pierde precisión.' : r > 6 ? ' Con más de 6 repeticiones es más imprecisa.' : '') + '</p>';
  h += '<p class="eyebrow">Con ese máximo</p><div class="grid3">' + [100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50].map(p => '<div class="gc">' + plateDot(zoneOf(p)) + '<span>' + p + '%</span><b>' + fmtNum(roundTo(E * p / 100, step), 1) + '</b></div>').join('') + '</div>';
  h += '<p class="eyebrow">Pesos por repeticiones</p><div class="grid3">' + [1, 2, 3, 4, 5, 6, 8, 10].map(n => '<div class="gc"><span>' + n + (n === 1 ? ' rep' : ' reps') + '</span><b>' + fmtNum(roundTo(weightForReps(E, n), step), 1) + '</b></div>').join('') + '</div>';
  return h;
}
function platesOut(kg, bar) {
  const r = platesFor(kg, bar);
  if (!r.ok) return r.reason === 'below' ? '<p class="muted">El peso es menor que la barra (' + bar + ' kg).</p>' : '<p class="muted">Escribe un peso para ver los discos.</p>';
  const W = k => k >= 10 ? 22 : k >= 5 ? 18 : k >= 2 ? 13 : 10, H = k => k >= 10 ? 78 : k >= 5 ? 64 : k >= 2 ? 50 : k >= 1 ? 42 : 36;
  const flat = [];
  r.perSide.forEach(x => { for (let n = 0; n < x.n; n++) flat.push(x.kg); });
  const viz = '<div class="bar-viz" role="img" aria-label="Discos por lado"><span class="shaft"></span>' + flat.map(k => '<span class="pt pt-' + PLATE_COLOR[k] + '" style="height:' + H(k) + 'px;width:' + W(k) + 'px"><b>' + fmtNum(k, 1) + '</b></span>').join('') + '<span class="tip-end"></span></div>';
  const side = r.perSide.map(x => (x.n > 1 ? x.n + ' × ' : '') + fmtNum(x.kg, 1)).join(' + ') || 'sin discos';
  let h = viz + '<p class="plsum"><b>Por lado:</b> ' + esc(side) + '</p><p class="muted">Barra ' + bar + ' kg + discos = ' + fmtNum(r.loaded, 1) + ' kg' + '</p>';
  if (r.short > 0) h += '<p class="warn-t">Con estos discos no se llega exacto: carga ' + fmtNum(r.loaded, 1) + ' kg (faltan ' + fmtNum(r.short, 1) + ' kg).</p>';
  return h;
}
function platesBlock(p, kg, bar) {
  return '<div class="platesblock" data-p="' + p + '"><div class="row2"><label class="fl"><span>Peso objetivo (kg)</span><input class="num" id="' + p + 'plKg" data-f="plKg" inputmode="decimal" autocomplete="off" value="' + (kg > 0 ? fmtNum(kg, 2) : '') + '" placeholder="0"></label>' +
    '<label class="fl"><span>Barra</span><select class="sel tall" id="' + p + 'plBar" data-f="plBar">' + [20, 15, 10, 5].map(b => '<option value="' + b + '"' + (b === bar ? ' selected' : '') + '>' + b + ' kg</option>').join('') + '</select></label></div>' +
    '<div class="plout" id="' + p + 'plOut" aria-live="polite">' + platesOut(kg, bar) + '</div></div>';
}
/* Ritmo de mejora (kg de 1RM estimado por semana) según las últimas 12 semanas con registros de ese ejercicio. */
function slopeOf(exId) {
  const wb = weeklyBest(S.sessions, exId).slice(-12);
  if (wb.length < 2) return 0;
  const b0 = parseYmd(wb[0].week), pr = project(wb.map(p => ({ x: daysBetween(b0, parseYmd(p.week)) / 7, y: p.y })));
  return pr ? pr.m : 0;
}
function goalHTML(e) {
  if (!(e.goal > 0)) return '';
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const gi = goalInfo(e.max, e.goal, e.goalDate, slopeOf(e.id), t0);
  if (!gi) return '<div class="goal"><span class="muted">Meta ' + fmtNum(e.goal, 1) + ' kg · define tu máximo para ver cuánto falta.</span></div>';
  const pct = Math.min(100, gi.cur / gi.goal * 100);
  let t;
  if (gi.done) t = '¡Meta lograda! ' + fmtNum(gi.goal, 1) + ' kg';
  else {
    t = 'Meta ' + fmtNum(gi.goal, 1) + ' kg · faltan ' + fmtNum(gi.left, 1) + ' kg';
    if (gi.weeks != null) t += ' · a tu ritmo, ≈ ' + Math.ceil(gi.weeks) + (Math.ceil(gi.weeks) === 1 ? ' semana' : ' semanas');
    else t += ' · aún no hay tendencia suficiente para estimar el plazo';
    if (e.goalDate) t += gi.daysLeft > 0 ? ' · para el ' + shortDate(parseYmd(e.goalDate)) + ' necesitas ≈ ' + fmtNum(gi.need, 1) + ' kg por semana' : ' · la fecha ya pasó';
  }
  return '<div class="goal"><span class="goalbar" role="img" aria-label="' + Math.round(pct) + ' % de la meta"><i style="width:' + pct.toFixed(1) + '%"></i></span><span class="muted">' + esc(t) + '</span></div>';
}
function viewMax() {
  const since = ymd(addDays(new Date(), -84));
  const sn = ex('snatch'), cj = ex('cj');
  let h = '<section class="sec"><h1>Máximos</h1><p class="muted">Toca un ejercicio para cambiar su máximo. Los % del plan y de la sesión se calculan con estos números. Los complejos no llevan máximo propio: usan el de su primer movimiento (arranque o cargada).</p></section>';
  if (sn.max > 0 && cj.max > 0) h += '<section class="card sec totalc"><p class="eyebrow">Total de competencia</p><p class="big">' + fmtNum(sn.max + cj.max, 1) + ' <small>kg</small></p><p class="muted">Arranque ' + fmtNum(sn.max, 1) + ' + Dos tiempos ' + fmtNum(cj.max, 1) + (categoryOf(S.profile.sex, S.profile.bw, S.profile.cat) ? ' · categoría ' + catText(categoryOf(S.profile.sex, S.profile.bw, S.profile.cat)) : '') + '</p></section>';
  const rts = ratiosOf(id => ex(id).max), bwv = parseNum(S.profile.bw);
  if (sn.max > 0 && cj.max > 0 && bwv > 0) rts.push({ label: 'Total por kg de peso corporal', txt: fmtNum((sn.max + cj.max) / bwv, 2) + ' kg/kg' });
  if (rts.length) h += '<section class="card sec"><p class="eyebrow">Razones entre máximos</p><div class="ratios">' + rts.map(r => '<div class="ratio"><span>' + esc(r.label) + '</span><b>' + (r.txt || fmtNum(r.pct, 0) + ' %') + '</b></div>').join('') + '</div><p class="muted">Sirven para ver qué parte de tu levantamiento va más atrasada. Tu entrenador define qué razones busca.</p></section>';
  for (const c of CATS) {
    if (c[0] === 'cmplx') continue;   // un complejo no tiene máximo propio: el plan usa el de su movimiento principal
    const list = S.exercises.filter(e => e.cat === c[0] && !isComplex(e));
    if (!list.length) continue;
    h += '<section class="sec"><p class="eyebrow">' + c[1] + '</p><div class="mlist">';
    for (const e of list) {
      const est = bestSetE1rm(S.sessions, e.id, since);
      const better = est > e.max + 0.9;
      h += '<div class="mrow"><button class="mmain" data-act="edit-max" data-ex="' + esc(e.id) + '"><span class="mn">' + esc(nm(e)) + nmSub(e) + '</span><span class="mv">' + (e.max > 0 ? fmtNum(e.max, 1) + '<small> kg</small>' : '<small>definir</small>') + '</span></button>' +
        (est > 0 ? '<span class="me">mejor serie ≈ ' + fmtNum(est, 1) + '</span>' : '') +
        (better ? '<button class="btn ghost sm" data-act="use-est" data-ex="' + esc(e.id) + '">Usar ' + fmtNum(roundTo(est, S.profile.rounding), 1) + '</button>' : '') + goalHTML(e) + '</div>';
    }
    h += '</div></section>';
  }
  h += '<div class="row-end"><button class="btn ghost sm" data-act="ex-new">+ Crear ejercicio</button></div>';
  if (!ui.calc) {
    const b = bestRecentSet();
    ui.calc = b ? { kg: b.kg, reps: b.reps, exId: b.exId } : { kg: 80, reps: 3, exId: 'snatch' };
  }
  if (isComplex(ex(ui.calc.exId))) ui.calc.exId = 'snatch';
  h += '<section class="card sec"><h2>Proyectar máximo</h2><p class="muted">Calcula tu 1RM desde una serie con menos repeticiones.</p><div class="row2"><label class="fl"><span>Peso (kg)</span><input class="num" id="cKg" data-f="cKg" inputmode="decimal" value="' + fmtNum(ui.calc.kg, 2) + '"></label>' +
    '<label class="fl"><span>Repeticiones</span><input class="num" id="cReps" data-f="cReps" inputmode="numeric" value="' + ui.calc.reps + '"></label></div>' +
    '<div id="calcOut" aria-live="polite">' + calcOut(ui.calc.kg, ui.calc.reps) + '</div>' +
    '<div class="row2 save-as"><label class="fl"><span>Guardar como máximo de</span><select class="sel tall" id="cEx" data-f="cEx">' + S.exercises.filter(e => !isComplex(e)).map(e => '<option value="' + esc(e.id) + '"' + (e.id === ui.calc.exId ? ' selected' : '') + '>' + esc(nm(e)) + '</option>').join('') + '</select></label>' +
    '<button class="btn ghost" data-act="calc-save">' + confirmLabel('csave', 'Guardar', 'Confirmar') + '</button></div></section>';
  h += '<section class="card sec fold"><button class="fold-h" data-act="plates-toggle" aria-expanded="' + !!ui.platesOpen + '"><span>Calculadora de discos</span><span class="fold-i" aria-hidden="true">' + (ui.platesOpen ? '−' : '+') + '</span></button>' +
    (ui.platesOpen ? '<p class="muted">Qué discos poner a cada lado de la barra.</p>' + platesBlock('t', ui.platesKg || 0, ui.platesBar || S.profile.bar) : '') + '</section>';
  return h;
}

/* ----- PROGRESO ----- */
function histRow(s) {
  const st = sessionStats(s), open = ui.openSess === s.id;
  let h = '<div class="hist' + (open ? ' open' : '') + '"><button class="hist-h" data-act="hist-toggle" data-id="' + s.id + '" aria-expanded="' + open + '"><span class="hd">' + esc(cap(fmtWk.format(parseYmd(s.date)).replace('.', ''))) + '</span><span class="hn">' + esc(s.name) + '</span><span class="hs">' + fmtNum(st.ton, 0) + ' kg</span></button>';
  if (open) {
    const ld = sessionLoad(s);
    h += '<div class="hist-b"><p class="muted">' + st.sets + ' series' + (st.missed ? ' (+' + st.missed + (st.missed === 1 ? ' fallada' : ' falladas') + ')' : '') + ' · ' + st.reps + ' repeticiones · ' + fmtDur((s.endedAt - s.startedAt) / 1000) + (ld ? ' · carga ' + fmtNum(ld, 0) + ' UA' : '') + '</p>';
    for (const it of s.items) {
      const groups = [];
      for (const x of it.sets) {
        const key = x.kg + '|' + x.reps + '|' + (x.miss ? 1 : 0), last = groups[groups.length - 1];
        if (last && last.key === key) last.n++; else groups.push({ key: key, kg: x.kg, reps: x.reps, n: 1, miss: !!x.miss });
      }
      const gaps = [];
      for (let k = 1; k < it.sets.length; k++) { const dgap = (it.sets[k].doneAt - it.sets[k - 1].doneAt) / 1000; if (dgap > 10 && dgap < 600) gaps.push(dgap); }
      const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
      h += '<div class="hex"><b>' + esc(nm(ex(it.exId))) + '</b><span>' + groups.map(g => fmtNum(g.kg, 1) + ' kg · ' + g.n + '×' + esc(g.reps) + (g.miss ? ' ✕ fallada' : '')).join('  /  ') + (avg ? ' · descanso real ~' + fmtTime(avg) : '') + '</span>' + (it.note ? '<span class="inote-h">“' + esc(it.note) + '”</span>' : '') + '</div>';
    }
    if (s.notes) h += '<p class="notes">“' + esc(s.notes) + '”</p>';
    h += '<div class="row-end"><button class="lnk danger" data-act="del-sess" data-id="' + s.id + '">' + confirmLabel('ds' + s.id, 'Eliminar sesión', 'Confirmar eliminar') + '</button></div></div>';
  }
  return h + '</div>';
}
function tableTwin(head, rows) {
  return '<details class="tv"><summary>Ver tabla</summary><div class="tv-s"><table><thead><tr>' + head.map(x => '<th scope="col">' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></details>';
}
function viewProg() {
  ui.charts = {};
  const now = new Date(), cutYmd = ymd(addDays(now, -ui.range * 7));
  const all = endedSessions(), ss = all.filter(s => s.date >= cutYmd);
  let h = '<section class="sec"><h1>Progreso</h1><div class="rangebar" role="group" aria-label="Período">' + [4, 8, 12].map(n => '<button class="pill" data-act="range" data-v="' + n + '" aria-pressed="' + (ui.range === n) + '">' + n + ' semanas</button>').join('') + '</div></section>';
  if (!all.length) return h + emptyHTML('prog', 'Aún no hay sesiones', 'Cuando termines tu primera sesión aquí verás tu tonelaje, tus intensidades y la proyección de tus máximos.', '<button class="btn" data-act="tab" data-tab="hoy">Ir a Hoy</button>');
  const tot = { ton: 0, sets: 0, reps: 0 };
  ss.forEach(s => { const t = sessionStats(s); tot.ton += t.ton; tot.sets += t.sets; tot.reps += t.reps; });
  h += '<section class="stats" aria-label="Resumen del período"><div><b>' + ss.length + '</b><span>sesiones</span></div><div><b>' + fmtNum(tot.sets, 0) + '</b><span>series</span></div><div><b>' + fmtNum(tot.ton, 0) + '</b><span>kg de tonelaje</span></div></section>';

  /* 1RM estimado semanal + proyección */
  const withData = S.exercises.filter(e => weeklyBest(S.sessions, e.id).length);
  if (withData.length) {
    if (!ui.progEx || !withData.find(e => e.id === ui.progEx)) ui.progEx = (withData.find(e => e.id === 'snatch') || withData[0]).id;
    const wb = weeklyBest(S.sessions, ui.progEx), cutWk = ymd(mondayOf(parseYmd(cutYmd)));
    const shown = wb.filter(p => p.week >= cutWk), base = wb.slice(-12);
    const b0 = parseYmd(base[0].week);
    const pr = project(base.map(p => ({ x: daysBetween(b0, parseYmd(p.week)) / 7, y: p.y })));
    const e = ex(ui.progEx);
    h += '<section class="sec"><div class="sec-h"><h2>1RM estimado</h2><select class="sel" id="progEx" data-f="progEx" aria-label="Ejercicio">' + withData.map(x => '<option value="' + esc(x.id) + '"' + (x.id === ui.progEx ? ' selected' : '') + '>' + esc(nm(x)) + '</option>').join('') + '</select></div>' +
      '<p class="muted">Mejor serie de cada semana. Con pocas repeticiones es un piso, no tu máximo real.</p>';
    const pts = shown.map(p => ({ t: parseYmd(p.week), y: p.y, label: 'Semana del ' + shortDate(parseYmd(p.week)) }));
    let proj = null;
    if (pr && pts.length) {
      const last = pts[pts.length - 1];
      proj = { from: { t: last.t, y: last.y }, to: { t: addDays(last.t, 56), y: pr.p8 } };
    }
    ui.charts.c1 = { kind: 'line', pts: pts, proj: proj, name: nm(e) };
    h += '<div class="chart" data-c="c1"></div>';
    h += pr ? '<p class="proj-t"><b>Tendencia (referencial):</b> ≈ ' + fmtNum(pr.p4, 1) + ' kg en 4 semanas · ≈ ' + fmtNum(pr.p8, 1) + ' kg en 8 semanas. Línea recta sobre tus últimas semanas, con avance limitado a +1,5 % semanal.</p>' : '<p class="muted">Para proyectar necesito al menos 4 semanas con registros de este ejercicio.</p>';
    h += tableTwin(['Semana', '1RM estimado (kg)'], shown.map(p => [shortDate(parseYmd(p.week)), fmtNum(p.y, 1)])) + '</section>';
  }

  /* Indicadores del período: intensidad media, repeticiones (NL) y efectividad */
  const pStats = periodStats(all, cutYmd, ymd(addDays(now, 1)));
  h += '<section class="stats" aria-label="Indicadores del período"><div><b>' + (pStats.intAvg ? fmtNum(pStats.intAvg, 0) + ' %' : '–') + '</b><span>intensidad media</span></div><div><b>' + fmtNum(pStats.reps, 0) + '</b><span>repeticiones (NL)</span></div><div><b>' + (pStats.eff != null ? fmtNum(pStats.eff, 0) + ' %' : '–') + '</b><span>efectividad</span></div></section>';

  /* Tonelaje y carga semanal */
  const mon = mondayOf(now), items = [], litems = [], wrows = [];
  for (let i = ui.range - 1; i >= 0; i--) {
    const w0 = addDays(mon, -7 * i), k0 = ymd(w0), k1 = ymd(addDays(w0, 7)), p = periodStats(all, k0, k1);
    items.push({ label: shortDate(w0), v: p.ton, n: p.n, cur: i === 0 });
    litems.push({ label: shortDate(w0), v: p.load, n: p.n, cur: i === 0 });
    wrows.push([shortDate(w0), String(p.n), fmtNum(p.reps, 0), fmtNum(p.ton, 0), p.intAvg ? fmtNum(p.intAvg, 0) + ' %' : '–', p.load ? fmtNum(p.load, 0) : '–', p.eff != null ? fmtNum(p.eff, 0) + ' %' : '–']);
  }
  ui.charts.c2 = { kind: 'bars', items: items, unit: 'kg', what: 'Tonelaje semanal', empty: 'Sin tonelaje registrado en el período.' };
  h += '<section class="sec"><h2>Tonelaje semanal</h2><p class="muted">Kilos totales levantados (peso × repeticiones) por semana. Las series falladas no suman.</p><div class="chart" data-c="c2"></div></section>';
  ui.charts.c3 = { kind: 'bars', items: litems, unit: 'UA', what: 'Carga semanal', empty: 'Aún no hay carga: anota el RPE de tus series o de la sesión.' };
  const lw = litems[litems.length - 2], lp = litems[litems.length - 3];
  let loadNote = '';
  if (lw && lp && lw.v > 0 && lp.v > 0) {
    const ch = (lw.v - lp.v) / lp.v * 100;
    loadNote = '<p class="' + (ch > 30 ? 'warn-t' : 'muted') + '">Última semana completa: ' + fmtNum(lw.v, 0) + ' UA (' + (ch >= 0 ? '+' : '') + fmtNum(ch, 0) + ' % frente a la anterior).' + (ch > 30 ? ' Es un salto grande: conviene que lo veas con tu entrenador.' : '') + '</p>';
  }
  h += '<section class="sec"><h2>Carga de entrenamiento</h2><p class="muted">Duración de la sesión × RPE de la sesión, en unidades arbitrarias (UA). Sirve para comparar tus semanas entre sí.</p><div class="chart" data-c="c3"></div>' + loadNote +
    tableTwin(['Semana desde', 'Sesiones', 'Reps', 'Tonelaje (kg)', 'Int. media', 'Carga (UA)', 'Efectividad'], wrows) + '</section>';
  const mrows = [];
  for (let m = 5; m >= 0; m--) {
    const a = new Date(now.getFullYear(), now.getMonth() - m, 1), b = new Date(now.getFullYear(), now.getMonth() - m + 1, 1), p = periodStats(all, ymd(a), ymd(b));
    mrows.push([cap(new Intl.DateTimeFormat('es-CL', { month: 'short', year: '2-digit' }).format(a).replace('.', '')), String(p.n), fmtNum(p.reps, 0), fmtNum(p.ton, 0), p.intAvg ? fmtNum(p.intAvg, 0) + ' %' : '–', p.load ? fmtNum(p.load, 0) : '–', p.eff != null ? fmtNum(p.eff, 0) + ' %' : '–']);
  }
  h += '<section class="sec"><h2>Resumen mensual</h2>' + tableTwin(['Mes', 'Sesiones', 'Reps', 'Tonelaje (kg)', 'Int. media', 'Carga (UA)', 'Efectividad'], mrows) + '</section>';

  /* Efectividad por ejercicio */
  const eff = efficiencyByExercise(all, cutYmd, id => ex(id)).slice(0, 8);
  if (eff.length) {
    h += '<section class="sec"><h2>Efectividad</h2><p class="muted">Intentos válidos sobre intentos. Marca con ✕ las series falladas durante la sesión; sin esa marca todo cuenta como válido.</p><div class="etab" role="table" aria-label="Efectividad por ejercicio">' +
      '<div class="er eh" role="row"><span>Ejercicio</span><span>Intentos</span><span>Efect.</span><span>Desde 90 %</span></div>' +
      eff.map(a => '<div class="er" role="row"><span>' + esc(nm(ex(a.exId))) + '</span><span>' + a.ok + '/' + a.att + '</span><b>' + fmtNum(a.ok / a.att * 100, 0) + ' %</b><span>' + (a.hAtt ? a.hOk + '/' + a.hAtt : '–') + '</span></div>').join('') + '</div></section>';
  }

  /* Peso corporal */
  const bwl = Array.isArray(S.profile.bwLog) ? S.profile.bwLog.slice(-12) : [];
  const catNow = categoryOf(S.profile.sex, S.profile.bw, S.profile.cat);
  if (bwl.length || catNow) {
    h += '<section class="sec"><h2>Peso corporal</h2><p class="muted">' + (bwl.length ? 'Último registro: ' + fmtNum(bwl[bwl.length - 1].kg, 1) + ' kg (' + esc(shortDate(parseYmd(bwl[bwl.length - 1].d))) + ')' : 'Sin registros') + (catNow ? ' · categoría ' + catText(catNow) : S.profile.sex ? '' : ' · indica tu sexo en Ajustes para ver tu categoría') + '.</p>' +
      (bwl.length ? tableTwin(['Fecha', 'Peso (kg)'], bwl.slice().reverse().map(x => [shortDate(parseYmd(x.d)), fmtNum(x.kg, 1)])) : '') + '</section>';
  }

  /* Repeticiones por intensidad */
  const zr = {}; ZONES.forEach(z => { zr[z.key] = 0; });
  ss.forEach(s => s.items.forEach(it => it.sets.forEach(st => { if (st.done && st.pct > 0) { const z = zoneOf(st.pct); zr[z] += parseReps(st.reps).total; } })));
  const zmax = Math.max(1, ...ZONES.map(z => zr[z.key]));
  h += '<section class="sec"><h2>Repeticiones por intensidad</h2><p class="muted">Cuántas repeticiones hiciste en cada zona de % del máximo.</p><div class="zones">' +
    ZONES.slice().reverse().map(z => '<div class="zr"><span class="zl">' + plateDot(z.key) + esc(z.label) + '</span><span class="zb"><i class="zbar pl-' + z.key + '" style="width:' + (zr[z.key] / zmax * 100).toFixed(1) + '%"></i></span><span class="zv">' + fmtNum(zr[z.key], 0) + '</span></div>').join('') + '</div></section>';

  /* Historial */
  const list = ss.slice().sort((a, b) => b.endedAt - a.endedAt);
  h += '<section class="sec"><h2>Historial</h2>' + (list.length ? '<div class="hlist">' + list.slice(0, ui.histN).map(histRow).join('') + '</div>' : emptyHTML('hist', 'Sin sesiones en este período', 'Prueba con un rango más amplio o registra una sesión nueva.')) +
    (list.length > ui.histN ? '<div class="row-end"><button class="btn ghost sm" data-act="hist-more">Ver más</button></div>' : '') + '</section>';
  return h;
}

/* ===== «Más» e Historial (diseño WL) ===== */
const initials = n => { const p = String(n || '').trim().split(/\s+/).filter(Boolean); return p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() : 'WL'; };
function mrow(ico, title, sub, attrs, chip) {
  return '<button class="mrow" ' + attrs + '>' + svg(ico) + '<span class="mt"><b>' + esc(title) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' + (chip ? '<span class="chip gd">' + esc(chip) + '</span>' : svg('chev', 'go')) + '</button>';
}
function viewMas() {
  const m = APP.more ? APP.more() : {}, coach = !!m.coach, p = S.profile;
  const cat = categoryOf(p.sex, p.bw, p.cat);
  const sub = m.sub != null ? m.sub : [SEX_LABEL[p.sex] || '', p.bw > 0 ? fmtNum(p.bw, 1) + ' kg' : '', cat ? 'categoría ' + catText(cat) : ''].filter(Boolean).join(' · ');
  const nSess = endedSessions().length;
  let h = '<h1>Más</h1><div class="card more-head"><span class="av" aria-hidden="true">' + esc(initials(m.name || p.name)) + '</span><div class="who"><b>' + esc(m.name || p.name || 'Mi cuenta') + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>' + (m.chip ? '<span class="chip gd">' + esc(m.chip) + '</span>' : '') + '</div>';
  if (m.sync) h += '<div class="card sync-card">' + svg('cloud') + '<div><b>Datos en la nube</b><small data-sync>' + esc(m.sync()) + '</small></div></div>';
  h += '<p class="eyebrow">' + (coach ? 'Mi entrenamiento' : 'Entrenamiento') + '</p><div class="mlist">';
  if (coach) {
    h += mrow('prog', 'Progreso', 'Mis cargas y marcas', 'data-act="tab" data-tab="prog"') + mrow('max', 'Máximos', 'Mis máximos y calculadora', 'data-act="tab" data-tab="max"') + mrow('plan', 'Plan semanal libre', 'Mis días y ejercicios', 'data-act="tab" data-tab="plan"');
  } else {
    h += mrow('plan', 'Plan semanal libre', 'Tus días y ejercicios propios', 'data-act="tab" data-tab="plan"') +
      mrow('prog', 'Historial de sesiones', nSess + (nSess === 1 ? ' sesión' : ' sesiones') + ' · ver, abrir o borrar', 'data-act="tab" data-tab="hist"') +
      mrow('max', 'Mis ejercicios', S.exercises.length + ' ejercicios · crear o editar', 'data-act="tab" data-tab="max"') +
      mrow('timer', 'Calculadora de discos', 'Cómo cargar la barra', 'data-act="open-plates"');
  }
  h += '</div>';
  if (m.team && m.team.length) h += '<p class="eyebrow">Equipo</p><div class="mlist">' + m.team.map(r => mrow(r.ico, r.t, r.s, r.tab ? 'data-act="tab" data-tab="' + esc(r.tab) + '"' : 'data-act="' + esc(r.act) + '"', r.chip)).join('') + '</div>';
  h += '<p class="eyebrow">Cuenta</p><div class="mlist">' + mrow('gear', 'Ajustes', 'Apariencia, nombres, temporizador', 'data-act="settings"') +
    mrow('file', 'Aviso de privacidad', window.HalterPrivacy ? 'Versión ' + window.HalterPrivacy.VERSION : '', 'data-act="privacy"') +
    (m.logout ? mrow('out', 'Cerrar sesión', '', 'data-act="cl-logout"') : '') + '</div>';
  if (window.HalterUpdate) h += window.HalterUpdate.footer();
  return h;
}
function viewHist() {
  const list = endedSessions().sort((a, b) => b.endedAt - a.endedAt);
  return '<section class="sec"><h1>Historial</h1><p class="muted">' + list.length + (list.length === 1 ? ' sesión' : ' sesiones') + ' registradas.</p>' +
    (list.length ? '<div class="hlist">' + list.slice(0, ui.histN).map(histRow).join('') + '</div>' : '<p class="muted">Cuando termines una sesión aparecerá aquí.</p>') +
    (list.length > ui.histN ? '<div class="row-end"><button class="btn ghost sm" data-act="hist-more">Ver más</button></div>' : '') +
    '<div class="row-end"><button class="lnk" data-act="tab" data-tab="mas">Volver a «Más»</button></div></section>';
}

/* ===== Render, gráficos, temporizador, hojas, eventos ===== */
function renderBanner() {
  const el = $('#banner');
  let h = '';
  if (S.demo) h += '<div class="note"><b>Estás viendo datos de ejemplo.</b> Cuando quieras, <button class="lnk" data-act="demo-clear">empieza con tus datos</button>.</div>';
  if (!storageOK) h += '<div class="note warn">Este navegador no permite guardar datos. Usa Ajustes → Exportar respaldo para no perder tus registros.</div>';
  el.innerHTML = h;
}
const BUILTIN_TABS = ['hoy', 'plan', 'prog', 'hist', 'max', 'mas'];
const NAV_LABEL = { hoy: 'Hoy', prog: 'Progreso', max: 'Máximos', mas: 'Más' };
function navItems() {
  const list = APP.nav || [['hoy'], ['prog'], ['max'], ['mas']];
  return list.map(a => { const id = a[0], ct = APP.tabs.find(t => t.id === id); return [id, a[1] || (ct ? ct.label : NAV_LABEL[id] || id), ct ? ct.icon : id === 'mas' ? 'more' : id]; });
}
function buildChrome() {
  $('#nav').innerHTML = navItems().map(a => '<button data-act="tab" data-tab="' + a[0] + '">' + svg(a[2] || a[0]) + '<span>' + esc(a[1]) + '</span></button>').join('');
  $('#gear').innerHTML = svg('gear');
}
function render() {
  const v = $('#view'), a = document.activeElement, keep = (a && a.id && v.contains(a)) ? a.id : null;
  const ct = APP.tabs.find(t => t.id === ui.tab);
  v.dataset.tab = ui.tab;
  v.innerHTML = ct ? ct.render() : ui.tab === 'hoy' ? viewHoy() : ui.tab === 'plan' ? viewPlan() : ui.tab === 'prog' ? viewProg() : ui.tab === 'hist' ? viewHist() : ui.tab === 'mas' ? viewMas() : viewMax();
  const inNav = navItems().some(a => a[0] === ui.tab), cur = inNav ? ui.tab : 'mas';   // las pantallas que viven dentro de «Más» marcan «Más»
  $$('#nav button').forEach(b => { if (b.dataset.tab === cur) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  renderBanner(); renderDock(); drawCharts(); syncWake();
  if (ui.sheet && ui.sheet.kind === 'sex' && S && S.profile.sex) closeSheet();
  else if (APP.requireSex && S && !S.demo && !S.profile.sex && !(ui.sheet && ui.sheet.kind === 'sex')) openSheet('sex');
  if (keep) { const n = document.getElementById(keep); if (n) { n.focus(); try { n.setSelectionRange(n.value.length, n.value.length); } catch (e) { /* select no admite rango */ } } }
}
function refresh() { render(); if (ui.sheet) renderSheet(); }
function askConfirm(key) {
  if (prevConfirm === key) { prevConfirm = null; return true; }
  ui.confirm = key; refresh(); return false;
}
let toastT = null;
function hideToast() {
  const el = $('#toast');
  try { if (el.matches(':popover-open')) el.hidePopover(); } catch (e) { /* sin popover */ }
  el.hidden = true; ui.toastFn = null;
}
function toast(msg, action, fn) {
  const el = $('#toast');
  el.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button class="lnk inv" data-act="toast-act">' + esc(action) + '</button>' : '');
  el.hidden = false; ui.toastFn = fn || null;
  try { if (el.showPopover && !el.matches(':popover-open')) el.showPopover(); } catch (e) { /* sin popover */ }
  clearTimeout(toastT); toastT = setTimeout(hideToast, action ? 7000 : 3400);
}

/* ----- Gráficos ----- */
function niceTicks(min, max, n) {
  const rng = Math.max(1e-9, max - min), raw = rng / n, pow = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { lo: lo, hi: hi, ticks: ticks };
}
function drawCharts() {
  $$('.chart[data-c]').forEach(el => {
    const d = ui.charts[el.dataset.c];
    if (!d) return;
    if (d.kind === 'line') drawLine(el, d); else drawBars(el, d);
  });
}
function drawLine(el, d) {
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
function roundedTop(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  const f = n => n.toFixed(1);
  return 'M' + f(x) + ' ' + f(y + h) + ' L' + f(x) + ' ' + f(y + r) + ' Q' + f(x) + ' ' + f(y) + ' ' + f(x + r) + ' ' + f(y) + ' L' + f(x + w - r) + ' ' + f(y) + ' Q' + f(x + w) + ' ' + f(y) + ' ' + f(x + w) + ' ' + f(y + r) + ' L' + f(x + w) + ' ' + f(y + h) + ' Z';
}
function drawBars(el, d) {
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

/* ----- Temporizador: panel inferior ----- */
function dockVisible() { return S.profile.timerEnabled && (!!activeSession() || T.running || T.acc > 0); }
function renderDock() {
  const el = $('#dock');
  if (!dockVisible()) { el.innerHTML = ''; return; }
  const p = S.profile, down = T.mode === 'down', ico = svg(T.running ? 'pause' : 'play');
  if (ui.dockMin) {
    el.innerHTML = '<div class="dock min" id="dockBox" data-state="idle" data-act="dock-min"><button class="dock-expand" data-act="dock-min" aria-label="Mostrar temporizador completo"><span class="dock-time" id="dockTime">0:00</span><span class="dock-lbl" id="dockLbl"></span></button>' +
      '<button class="rbtn play" data-act="t-toggle" aria-label="Iniciar o pausar">' + ico + '</button></div>';
  } else {
    el.innerHTML = '<div class="dock" id="dockBox" data-state="idle"><div class="dock-r1"><div class="dock-read"><span class="dock-time" id="dockTime">0:00</span><span class="dock-lbl" id="dockLbl"></span></div><div class="dock-ctl">' +
      (down ? '<button class="rbtn" data-act="t-adj" data-v="-15" aria-label="Restar 15 segundos">−15</button>' : '') +
      '<button class="rbtn play" data-act="t-toggle" aria-label="Iniciar o pausar">' + ico + '</button>' +
      (down ? '<button class="rbtn" data-act="t-adj" data-v="15" aria-label="Sumar 15 segundos">+15</button>' : '') +
      '<button class="rbtn" data-act="t-reset" aria-label="Reiniciar">' + svg('reset') + '</button></div></div>' +
      '<div class="dock-r2"><div class="seg" role="group" aria-label="Modo"><button data-act="t-mode" data-v="down" aria-pressed="' + down + '">Temporizador</button><button data-act="t-mode" data-v="up" aria-pressed="' + !down + '">Cronómetro</button></div>' +
      '<label class="chk dock-auto"><input type="checkbox" id="autoTimer" data-f="autoTimer"' + (p.autoTimer ? ' checked' : '') + '><span>Auto</span></label><button class="lnk inv" data-act="dock-min">Ocultar</button></div></div>';
  }
  tick();
}
function tick() {
  if (!S) return;
  const s = activeSession();
  setText($('#sessClock'), s ? fmtClock((Date.now() - s.startedAt) / 1000) : '');
  const box = $('#dockBox');
  if (!box) return;
  const el = tElapsed() / 1000;
  let txt, state, lbl;
  if (T.mode === 'up') {
    txt = fmtTime(el); state = T.running ? 'run' : (T.acc > 0 ? 'pause' : 'idle');
    lbl = T.running ? 'Cronómetro · descansando' : (T.acc > 0 ? 'Cronómetro en pausa' : 'Cronómetro');
  } else {
    const rem = T.target - el;
    if (rem > 0) {
      txt = fmtTime(Math.ceil(rem)); state = T.running ? 'run' : (T.acc > 0 ? 'pause' : 'idle');
      lbl = T.running ? 'Descanso' + (T.label ? ' · ' + T.label : '') : (T.acc > 0 ? 'En pausa' : 'Descanso listo');
    } else {
      txt = (rem < -0.5 ? '+' : '') + fmtTime(rem < -0.5 ? Math.ceil(-rem) : 0); state = 'done'; lbl = '¡A la barra!';
      if (T.running && !T.fired) { T.fired = true; alarm(); }
    }
  }
  setText($('#dockTime'), txt); setText($('#dockLbl'), lbl);
  if (box.dataset.state !== state) box.dataset.state = state;
}
function setMode(m) {
  S.profile.timerMode = m; T.mode = m; tReset(T.target); save(); renderDock();
}
function startRest(it) {
  if (!S.profile.timerEnabled || !S.profile.autoTimer) return;
  primeAudio();
  T.label = nm(ex(it.exId));
  if (T.mode === 'up') { tReset(); tStart(); } else { tReset(it.rest > 0 ? it.rest : S.profile.rest); tStart(); }
  renderDock();
}

/* ----- Sesión: acciones ----- */
function recalcPct(exId) {
  const s = activeSession(), e = ex(exId);
  if (!s) return;
  s.items.forEach(it => { if (it.exId === exId) it.sets.forEach(x => { if (e.max > 0 && x.kg > 0) x.pct = Math.round(x.kg / e.max * 1000) / 10; }); });
}
function startSession(dayIdx) {
  if (S.demo) { openSheet('demo'); return; }
  if (activeSession()) return;
  const s = newSession(dayIdx);
  S.sessions.push(s);
  T.mode = S.profile.timerMode; T.label = '';
  tReset(s.items[0] && s.items[0].rest ? s.items[0].rest : S.profile.rest);
  save(true); ui.tab = 'hoy'; render(); window.scrollTo(0, 0);
}
/* Sesión armada desde fuera (la semana asignada). build(S) devuelve la sesión, y puede agregar ejercicios a S. */
function startPlanned(build) {
  if (!S) return false;
  if (S.demo) { openSheet('demo'); return false; }
  if (activeSession()) { toast('Ya tienes una sesión en curso. Termínala o descártala antes de iniciar otra.'); ui.tab = 'hoy'; render(); return false; }
  const s = build(S); if (!s) return false;
  S.sessions.push(s);
  T.mode = S.profile.timerMode; T.label = '';
  tReset(s.items[0] && s.items[0].rest ? s.items[0].rest : S.profile.rest);
  save(true); ui.tab = 'hoy'; render(); window.scrollTo(0, 0);
  return true;
}
function toggleDone(i, j) {
  const s = activeSession(), it = s.items[i], st = it.sets[j], e = ex(it.exId);
  if (!st.done) {
    const r = parseReps(st.reps);
    if (!(st.kg > 0) || r.total < 1) { toast('Anota el peso y las repeticiones antes de marcar la serie.'); return; }
  }
  st.done = !st.done; st.doneAt = st.done ? Date.now() : null;
  if (!st.done) st.miss = false;
  const row = $('.set[data-i="' + i + '"][data-j="' + j + '"]');
  if (row) {
    row.classList.toggle('is-done', st.done); row.classList.toggle('is-miss', !!st.miss);
    row.querySelector('.tick').setAttribute('aria-pressed', String(st.done));
    const mb = row.querySelector('.missb'); if (mb) mb.setAttribute('aria-pressed', String(!!st.miss));
  }
  updateTotals(); save();
  if (!st.done) return;
  startRest(it);
  const r = parseReps(st.reps);
  if (e.max > 0 && r.total === 1 && !r.complex && st.kg > e.max) {
    const prev = { max: e.max, date: e.maxDate };
    e.max = st.kg; e.maxDate = ymd(new Date()); recalcPct(e.id); save(); render();
    toast('Nuevo máximo de ' + nm(e) + ': ' + fmtNum(st.kg, 1) + ' kg', 'Deshacer', () => { e.max = prev.max; e.maxDate = prev.date; recalcPct(e.id); save(); render(); });
  }
}
/* Levantamiento fallado: cuenta como intento (efectividad) pero no suma tonelaje, repeticiones ni marcas. Si la serie no estaba hecha, la deja hecha. */
function toggleMiss(i, j) {
  const s = activeSession(), it = s.items[i], st = it.sets[j];
  if (!st.miss) {
    if (!(st.kg > 0) || parseReps(st.reps).total < 1) { toast('Anota el peso y las repeticiones antes de marcar la serie.'); return; }
    const wasDone = st.done;
    st.miss = true; st.done = true; if (!wasDone) { st.doneAt = Date.now(); startRest(it); }
  } else st.miss = false;
  const row = $('.set[data-i="' + i + '"][data-j="' + j + '"]');
  if (row) {
    row.classList.toggle('is-done', st.done); row.classList.toggle('is-miss', !!st.miss);
    row.querySelector('.tick').setAttribute('aria-pressed', String(st.done));
    row.querySelector('.missb').setAttribute('aria-pressed', String(!!st.miss));
  }
  updateTotals(); save();
}
function logBw(kg) {
  if (!(kg > 0)) return;
  const today = ymd(new Date());
  S.profile.bwLog = (Array.isArray(S.profile.bwLog) ? S.profile.bwLog : []).filter(x => x.d !== today);
  S.profile.bwLog.push({ d: today, kg: kg });
  S.profile.bwLog.sort((a, b) => a.d < b.d ? -1 : 1);
  if (S.profile.bwLog.length > 120) S.profile.bwLog = S.profile.bwLog.slice(-120);
}
function addExerciseToSession(exId) {
  const s = activeSession();
  if (!s) return;
  const e = ex(exId), prev = lastSetsFor(exId);
  const item = { exId: exId, rest: e.rest || S.profile.rest, sets: prev || [mkSet(e, '', 0)] };
  if (prev) item.sets.forEach(x => { if (e.max > 0 && x.kg > 0) x.pct = Math.round(x.kg / e.max * 1000) / 10; });
  s.items.push(item); save(); render();
}
function finishRequest() {
  const s = activeSession(), st = sessionStats(s);
  if (st.sets === 0) { openSheet('finish', { empty: true }); return; }
  if (st.pending > 0) { openSheet('finish', { pending: st.pending }); return; }
  finalize('drop');
}
function finalize(mode) {
  const s = activeSession();
  if (!s) return;
  if (mode === 'mark') s.items.forEach(it => it.sets.forEach(x => { if (!x.done && x.kg > 0 && parseReps(x.reps).total > 0) { x.done = true; x.doneAt = Date.now(); } }));
  s.items.forEach(it => { it.sets = it.sets.filter(x => x.done); });
  s.items = s.items.filter(it => it.sets.length);
  const prior = endedSessions(), records = [];
  s.items.forEach(it => {
    const e = ex(it.exId), best = Math.max(0, ...it.sets.map(setE1rm)), pb = bestSetE1rm(prior, it.exId);
    const single = Math.max(0, ...it.sets.filter(x => { const r = parseReps(x.reps); return r.total === 1 && !r.complex && !x.miss; }).map(x => x.kg)), ps = topSingle(prior, it.exId);
    if (single > 0 && ps > 0 && single > ps) records.push(nm(e) + ': ' + fmtNum(single, 1) + ' kg a 1 repetición (antes ' + fmtNum(ps, 1) + ')');
    else if (best > 0 && pb > 0 && best > pb + 0.4) records.push(nm(e) + ': 1RM estimado ' + fmtNum(best, 1) + ' kg (antes ' + fmtNum(pb, 1) + ')');
  });
  s.endedAt = Date.now();
  const stt = sessionStats(s), ps = periodStats([s], s.date, ymd(addDays(parseYmd(s.date), 1)));
  tPause(); tReset(); save(true); syncWake();
  if (APP.onFinish) { try { APP.onFinish(s); } catch (e) { /* no debe frenar el cierre de la sesión */ } }
  openSheet('summary', { sum: { name: s.name, dur: (s.endedAt - s.startedAt) / 1000, sets: stt.sets, ton: stt.ton, records: records, missed: stt.missed, eff: ps.eff, intAvg: ps.intAvg, min: sessionDurMin(s), rpe: sessionRpe(s), load: sessionLoad(s) } });
  render();
}
function discardActive() {
  const s = activeSession();
  if (!s) return;
  S.sessions = S.sessions.filter(x => x.id !== s.id);
  tPause(); tReset(); save(true); closeSheet(); render(); syncWake();
}
function clearDemo() {
  S = freshState(); tReset(S.profile.rest); T.mode = S.profile.timerMode; ui.calc = null; ui.progEx = null; ui.tab = 'max'; ui.platesKg = 0;
  save(true); closeSheet(); render(); window.scrollTo(0, 0);
  toast('Listo. Empieza cargando tus máximos.');
}

/* ----- Respaldo y exportación ----- */
function csvCell(v) { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function csvHistory() {
  const num = v => (v == null || v === '') ? '' : String(v).replace('.', ',');
  const rows = [['fecha', 'sesion', 'ejercicio', 'serie', 'kg', 'repeticiones', 'pct_1rm', 'rpe', 'hecha', 'fallada', 'duracion_min', 'rpe_sesion', 'carga_sesion']];
  endedSessions().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.startedAt - b.startedAt).forEach(s => s.items.forEach(it => it.sets.forEach((st, j) => rows.push([s.date, s.name, ex(it.exId).name, j + 1, num(st.kg), st.reps, num(st.pct), num(st.rpe), st.done ? 'sí' : 'no', st.miss ? 'sí' : 'no', sessionDurMin(s) || '', num(sessionRpe(s) ? Math.round(sessionRpe(s) * 10) / 10 : ''), sessionLoad(s) || '']))));
  return '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
}
async function saveFile(name, data) {
  try {
    const blob = new Blob([data], { type: /\.csv$/.test(name) ? 'text/csv;charset=utf-8' : 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Archivo descargado.'); return;
  } catch (e) { /* si el navegador no permite descargar, se muestra el texto para copiar */ }
  openSheet('backup', { name: name, text: data });
}
function tryImport(text) {
  let o = null;
  try { o = JSON.parse(text); } catch (e) { o = null; }
  if (!o || o.v !== 1 || !Array.isArray(o.sessions) || !Array.isArray(o.exercises) || !o.plan || !Array.isArray(o.plan.days)) { toast('Ese archivo no es un respaldo válido de la app.'); return; }
  ui.pendingImport = o; ui.sheet.imp = o.sessions.length; renderSheet();
}

/* ----- Hojas (diálogo inferior) ----- */
function openSheet(kind, data) {
  ui.sheet = Object.assign({ kind: kind }, data || {});
  renderSheet();
  const d = $('#dlg');
  if (!d.open) { try { d.showModal(); } catch (e) { d.setAttribute('open', ''); } }
}
function closeSheet() { const d = $('#dlg'); ui.sheet = null; if (d.open) d.close(); }
function pickList(q) {
  q = q.trim().toLowerCase();
  let h = '';
  for (const c of CATS) {
    const list = S.exercises.filter(e => e.cat === c[0] && (!q || (e.name + ' ' + (e.en || EN_NAMES[e.id] || '')).toLowerCase().indexOf(q) >= 0));
    if (!list.length) continue;
    h += '<p class="eyebrow">' + c[1] + '</p><div class="plist">' + list.map(e => '<button class="pick" data-act="pick" data-ex="' + esc(e.id) + '"><span>' + esc(nm(e)) + nmSub(e) + '</span><small' + (e.max > 0 ? '' : ' class="nomax"') + '>' + (e.max > 0 ? fmtNum(e.max, 1) + ' kg' : 'sin máximo') + '</small></button>').join('') + '</div>';
  }
  return h || emptyHTML('close', 'Sin coincidencias', 'Revisa la búsqueda o crea el ejercicio desde «Más».');
}
function settingsHTML() {
  const p = S.profile, ui2 = ui.sheet;
  const chk = (k, l) => '<label class="chk"><input type="checkbox" data-f="set" data-k="' + k + '"' + (p[k] ? ' checked' : '') + '><span>' + l + '</span></label>';
  const sel = (k, vals, fmt, id) => '<select class="sel tall" id="' + id + '" data-f="set" data-k="' + k + '" data-num="1">' + vals.map(v => '<option value="' + v + '"' + (p[k] === v ? ' selected' : '') + '>' + fmt(v) + '</option>').join('') + '</select>';
  let h = '<div class="form">' + (APP.accountHTML ? APP.accountHTML() : '') + '<p class="eyebrow">Perfil</p><label class="lab" for="sName">Nombre</label><input class="txt" id="sName" data-f="set" data-k="name" maxlength="40" value="' + esc(p.name) + '" placeholder="Tu nombre">' +
    '<div class="row2"><label class="fl"><span>Peso corporal (kg)</span><input class="num" id="sBw" data-f="set" data-k="bw" data-num="1" inputmode="decimal" value="' + (p.bw > 0 ? fmtNum(p.bw, 1) : '') + '" placeholder="—"></label><label class="fl"><span>Barra</span>' + sel('bar', [20, 15, 10, 5], v => v + ' kg', 'sBar') + '</label></div>' +
    '<div class="row2"><label class="fl"><span>Sexo</span><select class="sel tall" id="sSex" data-f="set" data-k="sex">' + [['', '—'], ['F', 'Femenino'], ['M', 'Masculino']].filter(o => o[0] || !p.sex).map(o => '<option value="' + o[0] + '"' + (p.sex === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' +
    '<label class="fl"><span>Categoría de peso</span><select class="sel tall" id="sCat" data-f="set" data-k="cat"' + (p.sex ? '' : ' disabled') + '><option value="">Automática' + (categoryOf(p.sex, p.bw) ? ' · ' + catText(categoryOf(p.sex, p.bw)) : '') + '</option>' + catOptions(p.sex).map(c => '<option value="' + c + '"' + (p.cat === c ? ' selected' : '') + '>' + catText(c) + '</option>').join('') + '</select></label></div>' +
    '<p class="muted">' + (APP.more && APP.more().coach ? 'Solo para tus indicadores personales (por ejemplo, si compites en torneos externos). No entra en las comparaciones del equipo.' : 'Tu entrenador usa tu sexo, tu peso y tu categoría para comparar marcas entre atletas de la misma categoría. Solo lo ven tú y tu entrenador.') + '</p>' +
    '<p class="eyebrow">Cargas</p><div class="row2"><label class="fl"><span>Redondeo de pesos</span>' + sel('rounding', [0.5, 1, 2.5, 5], v => fmtNum(v, 1) + ' kg', 'sRound') + '</label>' +
    '<label class="fl"><span>Descanso predeterminado</span>' + restSelect(p.rest, 'id="sRest" data-f="set" data-k="rest" data-num="1"').replace('class="sel"', 'class="sel tall"') + '</label></div>' +
    '<p class="eyebrow">Temporizador</p><div class="checks">' + chk('timerEnabled', 'Mostrar temporizador y cronómetro') + chk('autoTimer', 'Iniciar solo al marcar una serie como hecha') + chk('sound', 'Sonido al terminar el descanso') + chk('vibrate', 'Vibración al terminar') + '</div>' +
    '<p class="eyebrow">Nombres de los ejercicios</p><label class="fl"><span>Idioma principal</span>' + sel('exLang', ['en', 'es'], v => v === 'en' ? 'English (principal) · Español debajo' : 'Español (principal) · English debajo', 'sLang').replace(' data-num="1"', '') + '</label>' +
    '<p class="eyebrow">Sesión</p><div class="checks">' + chk('keepAwake', 'Mantener la pantalla encendida durante la sesión') + chk('showRpe', 'Anotar esfuerzo percibido (RPE) por serie') + chk('trackMiss', 'Marcar los levantamientos fallados (mide tu efectividad)') + '</div>' +
    '<p class="eyebrow">Tus datos</p><p class="muted">' + (APP.cloud ? 'Se guardan en este dispositivo y se copian solos en tu cuenta, así los ves en cualquier dispositivo donde entres. ' : 'Se guardan en este dispositivo. ') + 'Descarga un respaldo de vez en cuando.</p><div class="stack">' +
    '<button class="btn ghost" data-act="export-json">Exportar respaldo (JSON)</button><button class="btn ghost" data-act="export-csv">Exportar historial (CSV para Excel)</button></div>' +
    '<label class="lab" for="impFile">Importar respaldo</label><input type="file" id="impFile" data-f="impFile" accept=".json,application/json" class="file">' +
    '<textarea class="txt area" id="impText" rows="2" placeholder="…o pega aquí el contenido del respaldo"></textarea><div class="row-end"><button class="btn ghost sm" data-act="import-run">Importar texto</button></div>';
  if (ui2.imp != null) h += '<div class="note warn"><b>Se reemplazarán tus datos actuales' + (APP.cloud ? ' (también en la nube)' : '') + '</b> por un respaldo con ' + ui2.imp + ' sesiones.<div class="actions"><button class="btn sm" data-act="import-confirm">Reemplazar</button><button class="btn ghost sm" data-act="import-cancel">Cancelar</button></div></div>';
  if (window.HalterUpdate) h += window.HalterUpdate.card();
  h += '<div class="row-end"><button class="lnk danger" data-act="wipe">' + confirmLabel('wipe', APP.cloud ? 'Borrar todos mis datos (también en la nube)' : 'Borrar todos mis datos', 'Confirmar: borrar todo') + '</button></div>' + (window.HalterUpdate ? window.HalterUpdate.footer() : '') + '</div>';
  return h;
}
function maxSheetHTML(exId) {
  const e = ex(exId);
  return '<p class="muted">Tu mejor levantamiento a una repetición. Los % se calculan sobre este número.</p><label class="lab" for="mxKg">Máximo (kg)</label><input class="num wide" id="mxKg" inputmode="decimal" autocomplete="off" value="' + (e.max > 0 ? fmtNum(e.max, 2) : '') + '" placeholder="0">' +
    '<div class="row2"><label class="fl"><span>Meta (kg)</span><input class="num" id="mxGoal" inputmode="decimal" autocomplete="off" placeholder="opcional" value="' + (e.goal > 0 ? fmtNum(e.goal, 2) : '') + '"></label>' +
    '<label class="fl"><span>Fecha de la meta</span><input class="txt" id="mxGoalDate" type="date" value="' + esc(e.goalDate || '') + '"></label></div>' +
    '<div class="calc-mini"><p class="eyebrow">O calcúlalo desde una serie</p><div class="row2"><input class="num" id="mxW" data-f="mxW" inputmode="decimal" placeholder="kg" aria-label="Peso de la serie"><input class="num" id="mxR" data-f="mxR" inputmode="numeric" placeholder="reps" aria-label="Repeticiones de la serie"></div>' +
    '<p id="mxEst" class="muted" aria-live="polite">Escribe peso y repeticiones.</p><button class="btn ghost sm" id="mxUse" data-act="mx-use" disabled>Usar este valor</button></div>' +
    '<div class="actions"><button class="btn" data-act="mx-save" data-ex="' + esc(e.id) + '">Guardar</button><button class="lnk" data-act="ex-edit" data-ex="' + esc(e.id) + '">Editar ejercicio</button></div>';
}
function exSheetHTML(id) {
  const e = id ? ex(id) : { name: '', cat: 'acc', rest: S.profile.rest, builtin: false };
  const used = id && (S.sessions.some(s => s.items.some(i => i.exId === id)) || S.plan.days.some(d => d.items.some(i => i.exId === id)));
  return '<div class="form"><label class="lab" for="exName">Nombre</label><input class="txt" id="exName" maxlength="40" value="' + esc(e.name) + '" placeholder="Ej. Arranque colgado">' + (id ? '' : '<p class="muted">Para un complex, ponle nombre (ej. «Cargada + jerk») y elige la categoría Complejos. En cada serie escribes las reps así: 1+2.</p>') +
    '<div class="row2"><label class="fl"><span>Categoría</span><select class="sel tall" id="exCat">' + CATS.map(c => '<option value="' + c[0] + '"' + (e.cat === c[0] ? ' selected' : '') + '>' + c[1] + '</option>').join('') + '</select></label>' +
    '<label class="fl"><span>Descanso habitual</span>' + restSelect(e.rest, 'id="exRest"').replace('class="sel"', 'class="sel tall"') + '</label></div>' +
    '<div class="actions"><button class="btn" data-act="ex-save" data-ex="' + (id || '') + '">Guardar</button>' + (id && !e.builtin && !used ? '<button class="btn ghost" data-act="ex-del" data-ex="' + id + '">Eliminar</button>' : '') + '</div>' +
    (id && used && !e.builtin ? '<p class="muted">No se puede eliminar porque ya tiene registros o está en tu plan.</p>' : '') + '</div>';
}
function summaryHTML(d) {
  let h = '<div class="done-hero"><span class="done-ic">' + svg('check') + '</span><p>¡Buen trabajo! Tu sesión quedó guardada.</p></div><div class="stats"><div><b>' + fmtDur(d.dur) + '</b><span>duración</span></div><div><b>' + d.sets + '</b><span>series</span></div><div><b>' + fmtNum(d.ton, 0) + '</b><span>kg de tonelaje</span></div></div>';
  const extra = [];
  if (d.load > 0) extra.push('Carga de sesión: <b>' + fmtNum(d.load, 0) + ' UA</b> (' + d.min + ' min × RPE ' + fmtNum(d.rpe, 1) + ')');
  else if (d.min > 0) extra.push('Para calcular la carga de la sesión falta el RPE: anótalo por serie o en «Carga de la sesión».');
  if (d.intAvg > 0) extra.push('Intensidad media: <b>' + fmtNum(d.intAvg, 0) + ' %</b> del máximo');
  if (d.eff != null) extra.push('Efectividad: <b>' + fmtNum(d.eff, 0) + ' %</b>' + (d.missed ? ' (' + d.missed + (d.missed === 1 ? ' serie fallada' : ' series falladas') + ')' : ''));
  if (extra.length) h += '<ul class="recs">' + extra.map(x => '<li>' + x + '</li>').join('') + '</ul>';
  h += d.records.length ? '<p class="eyebrow">Marcas de hoy</p><ul class="recs prs">' + d.records.map(r => '<li>' + svg('trophy') + '<span>' + esc(r) + '</span></li>').join('') + '</ul>' : '<p class="muted">Sin marcas nuevas hoy. La constancia también suma.</p>';
  return h + '<div class="actions"><button class="btn" data-act="sheet-close">Listo</button><button class="lnk" data-act="to-prog">Ver progreso</button></div>';
}
function renderSheet() {
  const d = $('#dlg'), sh = ui.sheet;
  if (!sh) return;
  let title = '', body = '';
  switch (sh.kind) {
    case 'settings': title = 'Ajustes'; body = settingsHTML(); break;
    case 'privacy': title = 'Aviso de privacidad'; body = window.HalterPrivacy ? window.HalterPrivacy.html(true) : ''; break;
    case 'pick': title = 'Elegir ejercicio'; body = '<input class="txt" id="pickQ" data-f="pickQ" type="search" placeholder="Buscar ejercicio" autocomplete="off" aria-label="Buscar ejercicio"><div id="pickList">' + pickList(sh.q || '') + '</div><div class="row-end"><button class="btn ghost sm" data-act="ex-new">+ Crear ejercicio</button></div>'; break;
    case 'ex': title = sh.id ? 'Editar ejercicio' : 'Nuevo ejercicio'; body = exSheetHTML(sh.id); break;
    case 'max': title = 'Máximo · ' + nm(ex(sh.exId)); body = maxSheetHTML(sh.exId); break;
    case 'plates': title = 'Discos'; body = platesBlock('s', sh.kg, sh.bar); break;
    case 'finish': title = 'Terminar sesión'; body = sh.empty ? '<p>No marcaste ninguna serie como hecha.</p><div class="actions"><button class="btn" data-act="discard">Descartar sesión</button><button class="btn ghost" data-act="sheet-close">Volver</button></div>' : '<p>Tienes <b>' + sh.pending + '</b> ' + (sh.pending === 1 ? 'serie sin marcar' : 'series sin marcar') + '.</p><div class="stack"><button class="btn" data-act="fin-mark">Marcarlas como hechas y terminar</button><button class="btn ghost" data-act="fin-drop">Descartarlas y terminar</button><button class="btn ghost" data-act="sheet-close">Volver a la sesión</button></div>'; break;
    case 'summary': title = 'Sesión terminada'; body = summaryHTML(sh.sum); break;
    case 'sex': title = 'Indica tu sexo'; body = '<p>Se usa para ubicarte en tu categoría de peso y comparar tus marcas con las de atletas de tu misma categoría. Solo lo ven tú y tu entrenador. Puedes cambiarlo después en Ajustes.</p><div class="stack"><button class="btn" data-act="set-sex" data-v="F">Femenino</button><button class="btn" data-act="set-sex" data-v="M">Masculino</button></div>'; break;
    case 'demo': title = 'Datos de ejemplo'; body = '<p>Estás viendo una cuenta de ejemplo. Para no mezclar tus marcas con las del ejemplo, empieza primero con tus datos.</p><div class="stack"><button class="btn" data-act="demo-clear">Empezar con mis datos</button><button class="btn ghost" data-act="sheet-close">Seguir mirando el ejemplo</button></div>'; break;
    case 'backup': title = 'Copia tu archivo'; body = '<p class="muted">Tu navegador no permite descargar desde aquí. Copia este texto y guárdalo en un archivo llamado <b>' + esc(sh.name) + '</b>.</p><textarea class="txt area" id="bkText" rows="8" readonly>' + esc(sh.text) + '</textarea><div class="actions"><button class="btn" data-act="copy-text">Copiar</button></div>'; break;
  }
  d.innerHTML = '<div class="sheet-h"><h2>' + esc(title) + '</h2>' + (sh.kind === 'sex' ? '' : '<button class="icon-btn" data-act="sheet-close" aria-label="Cerrar">' + svg('close') + '</button>') + '</div><div class="sheet-b">' + body + '</div>';
}

/* ----- Campos ----- */
function setField(t) {
  const row = t.closest('.set'), i = +row.dataset.i, j = +row.dataset.j, s = activeSession();
  if (!s) return;
  const it = s.items[i], st = it.sets[j], e = ex(it.exId), f = t.dataset.f;
  const kgEl = row.querySelector('[data-f="kg"]'), pctEl = row.querySelector('[data-f="pct"]');
  if (f === 'kg') {
    const v = parseNum(t.value); st.kg = isNaN(v) || v < 0 ? 0 : v;
    if (e.max > 0 && st.kg > 0) { st.pct = Math.round(st.kg / e.max * 1000) / 10; pctEl.value = fmtNum(st.pct, 1); }
    else if (!(st.kg > 0)) { st.pct = 0; pctEl.value = ''; }
  } else if (f === 'pct') {
    const v = parseNum(t.value); st.pct = isNaN(v) || v < 0 ? 0 : v;
    if (e.max > 0 && st.pct > 0) { st.kg = roundTo(e.max * st.pct / 100, S.profile.rounding); kgEl.value = fmtNum(st.kg, 2); }
  } else if (f === 'reps') {
    const c = t.value.replace(/[^\d+]/g, ''); if (c !== t.value) t.value = c; st.reps = c;
  } else if (f === 'rpe') { const v = parseNum(t.value); st.rpe = isNaN(v) ? null : v; }
  setDot(row.querySelector('.pl'), zoneOf(st.pct));
  updateTotals(); save();
}
function onSetting(t) {
  const k = t.dataset.k;
  let v;
  if (t.type === 'checkbox') v = t.checked;
  else if (t.dataset.num) { v = parseNum(t.value); if (isNaN(v)) v = 0; }
  else v = t.value;
  S.profile[k] = v;
  if (k === 'sex') S.profile.cat = '';
  if (k === 'bw') logBw(v);
  save();
  if (k === 'timerEnabled') { if (!v) tPause(); renderDock(); }
  if (k === 'showRpe' || k === 'rounding' || k === 'bar' || k === 'exLang' || k === 'sex' || k === 'cat' || k === 'trackMiss') refresh();
}
function onField(t) {
  const f = t.dataset.f, s = activeSession();
  switch (f) {
    case 'kg': case 'reps': case 'pct': case 'rpe': setField(t); break;
    case 'rest': if (s) { s.items[+t.closest('.exc').dataset.i].rest = parseNum(t.value); save(); } break;
    case 'notes': if (s) { s.notes = t.value; save(); } break;
    case 'srpe': if (s) { const v = parseInt(t.value, 10); if (v >= 1 && v <= 10) s.srpe = v; else delete s.srpe; save(); } break;
    case 'durMin': if (s) { const v = parseInt(t.value, 10); if (v >= 1 && v <= 600) s.durMin = v; else delete s.durMin; save(); } break;
    case 'bwq': break;
    case 'inote': if (s) { const it = s.items[+t.closest('.exc').dataset.i]; if (it) { it.note = t.value.slice(0, 200); save(); } } break;
    case 'dname': { const c = t.closest('.day'); if (c.dataset.rt) { RT.days[+c.dataset.d].name = t.value; if (RT.onChange) RT.onChange(); } else { S.plan.days[+c.dataset.d].name = t.value; save(); } break; }
    case 'don': { const d = S.plan.days[+t.closest('.day').dataset.d]; d.on = t.checked; save(); render(); break; }
    case 'psets': case 'preps': case 'ppct': case 'prest': case 'ppause': {
      const row = t.closest('.prow'), isRt = !!t.closest('[data-rt]'), p = (isRt ? RT.days : S.plan.days)[+row.dataset.d].items[+row.dataset.k], e = ex(p.exId);
      if (f === 'psets') { const n = parseInt(t.value, 10); if (n >= 1 && n <= 30) p.sets = n; }
      else if (f === 'preps') { const c = t.value.replace(/[^\d+]/g, ''); if (c !== t.value) t.value = c; p.reps = c; }
      else if (f === 'ppct') { const v = parseNum(t.value); p.pct = isNaN(v) || v < 0 ? 0 : v; setDot(row.querySelector('.pn .pl'), zoneOf(p.pct)); }
      else if (f === 'ppause') { const r = Math.min(Math.max(Math.round(parseNum(t.value) || 0), 0), 10); p.pause = r; if (t.value !== '' && String(r) !== t.value.trim()) t.value = String(r); }
      else p.rest = parseNum(t.value) || 0;
      setText(document.getElementById('pv-' + row.dataset.d + '-' + row.dataset.k), planPreview(p, e, isRt)); if (isRt) { if (RT.onChange) RT.onChange(); } else save(); break;
    }
    case 'autoTimer': S.profile.autoTimer = t.checked; save(); break;
    case 'set': onSetting(t); break;
    case 'progEx': ui.progEx = t.value; render(); break;
    case 'pickQ': if (ui.sheet) { ui.sheet.q = t.value; $('#pickList').innerHTML = pickList(t.value); } break;
    case 'cKg': case 'cReps': case 'cEx': {
      if (f === 'cKg') { const v = parseNum(t.value); ui.calc.kg = isNaN(v) ? 0 : v; }
      else if (f === 'cReps') { const v = parseInt(t.value, 10); ui.calc.reps = isNaN(v) ? 0 : v; }
      else ui.calc.exId = t.value;
      $('#calcOut').innerHTML = calcOut(ui.calc.kg, ui.calc.reps); break;
    }
    case 'plKg': case 'plBar': {
      const p = t.closest('.platesblock').dataset.p, kg = parseNum($('#' + p + 'plKg').value), bar = parseNum($('#' + p + 'plBar').value);
      if (p === 't') { ui.platesKg = isNaN(kg) ? 0 : kg; ui.platesBar = bar; }
      $('#' + p + 'plOut').innerHTML = platesOut(isNaN(kg) ? 0 : kg, bar); break;
    }
    case 'mxW': case 'mxR': {
      const w = parseNum($('#mxW').value), r = parseInt($('#mxR').value, 10), out = $('#mxEst'), btn = $('#mxUse');
      if (w > 0 && r >= 1) {
        const E = e1rm(w, r); out.textContent = '≈ ' + fmtNum(E, 1) + ' kg' + (r > 10 ? ' (poco confiable con más de 10 repeticiones)' : ''); btn.disabled = false; btn.dataset.v = String(roundTo(E, S.profile.rounding));
      } else { out.textContent = 'Escribe peso y repeticiones.'; btn.disabled = true; }
      break;
    }
    case 'impFile': {
      const file = t.files && t.files[0];
      if (!file) break;
      const rd = new FileReader();
      rd.onload = () => tryImport(String(rd.result || ''));
      rd.readAsText(file); break;
    }
  }
}

/* ----- Clics ----- */
/* Pantalla fija: ni pellizco ni doble toque acercan la app (iOS ignora user-scalable, por eso también se frena aquí) */
['gesturestart', 'gesturechange', 'gestureend'].forEach(n => document.addEventListener(n, e => e.preventDefault()));
document.addEventListener('touchmove', e => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener('click', e => {
  primeAudio();
  const t = e.target.closest('[data-act]');
  if (!t) { if (e.target === $('#dlg') && !(ui.sheet && ui.sheet.kind === 'sex')) closeSheet(); return; }
  prevConfirm = ui.confirm; ui.confirm = null;
  const a = t.dataset.act, s = activeSession();
  switch (a) {
    case 'tab': ui.tab = t.dataset.tab; render(); window.scrollTo(0, 0); break;
    case 'settings': openSheet('settings'); break;
    case 'sheet-close': closeSheet(); break;
    case 'to-prog': closeSheet(); ui.tab = 'prog'; render(); window.scrollTo(0, 0); break;
    case 'start': startSession(t.dataset.d === undefined ? null : +t.dataset.d); break;
    case 'tick': { const row = t.closest('.set'); toggleDone(+row.dataset.i, +row.dataset.j); break; }
    case 'add-set': {
      const it = s.items[+t.dataset.i], last = it.sets[it.sets.length - 1];
      it.sets.push(last ? Object.assign({ kg: last.kg, reps: last.pr ? '' : last.reps, pct: last.pct, rpe: null, done: false, doneAt: null }, last.pr ? { pr: last.pr } : {}) : mkSet(ex(it.exId), '', 0));
      save(); render(); break;
    }
    case 'rm-set': {
      const it = s.items[+t.dataset.i], last = it.sets[it.sets.length - 1];
      if (!last) break;
      if (last.done && !askConfirm('rs' + t.dataset.i)) break;
      it.sets.pop(); save(); render(); break;
    }
    case 'rm-ex': if (askConfirm('rm' + t.dataset.i)) { s.items.splice(+t.dataset.i, 1); save(); render(); } break;
    case 'add-ex': openSheet('pick', { cb: addExerciseToSession }); break;
    case 'plates': {
      const it = s.items[+t.dataset.i], nxt = it.sets.find(x => !x.done && x.kg > 0) || it.sets[it.sets.length - 1];
      openSheet('plates', { kg: nxt ? nxt.kg : 0, bar: S.profile.bar }); break;
    }
    case 'edit-max': openSheet('max', { exId: t.dataset.ex }); break;
    case 'set-sex': {
      const v = t.dataset.v;
      if (v !== 'F' && v !== 'M') break;
      S.profile.sex = v; S.profile.cat = ''; save(true); closeSheet(); render(); break;
    }
    case 'miss': { const row = t.closest('.set'); toggleMiss(+row.dataset.i, +row.dataset.j); break; }
    case 'bw-save': {
      const v = parseNum(($('#bwq') || {}).value);
      if (!(v >= 30 && v <= 250)) { toast('Escribe tu peso en kilos (por ejemplo 81,5).'); break; }
      S.profile.bw = v; logBw(v); save(); render(); toast('Peso guardado: ' + fmtNum(v, 1) + ' kg'); break;
    }
    case 'finish': finishRequest(); break;
    case 'fin-drop': finalize('drop'); break;
    case 'fin-mark': finalize('mark'); break;
    case 'discard': discardActive(); break;
    case 'cancel-sess': if (askConfirm('cancel')) discardActive(); break;
    case 'demo-clear': clearDemo(); break;
    case 't-toggle':
      primeAudio();
      if (T.running) tPause();
      else { if (T.mode === 'down' && T.target - tElapsed() / 1000 <= 0) tReset(T.target); tStart(); }
      renderDock(); break;
    case 't-adj': T.target = Math.max(15, T.target + (+t.dataset.v)); if (T.target - tElapsed() / 1000 > 0) T.fired = false; tick(); break;
    case 't-reset': tReset(); renderDock(); break;
    case 't-mode': setMode(t.dataset.v); break;
    case 'dock-min': ui.dockMin = !ui.dockMin; renderDock(); break;
    case 'range': ui.range = +t.dataset.v; render(); break;
    case 'hist-toggle': ui.openSess = ui.openSess === t.dataset.id ? null : t.dataset.id; render(); break;
    case 'hist-more': ui.histN += 10; render(); break;
    case 'del-sess': if (askConfirm('ds' + t.dataset.id)) { S.sessions = S.sessions.filter(x => x.id !== t.dataset.id); ui.openSess = null; save(); render(); } break;
    case 'plan-add': {
      const di = +t.dataset.d;
      openSheet('pick', { cb: id => { S.plan.days[di].items.push({ exId: id, sets: 3, reps: '3', pct: 70, rest: 0, pause: 0 }); save(); render(); } }); break;
    }
    case 'plan-rm': { const rt = !!t.closest('[data-rt]'); (rt ? RT.days : S.plan.days)[+t.dataset.d].items.splice(+t.dataset.k, 1); if (rt) { if (RT.onChange) RT.onChange(true); } else { save(); render(); } break; }
    case 'rt-add': {
      const di = +t.dataset.d;
      openSheet('pick', { cb: id => { const e = ex(id); RT.days[di].items.push({ exId: id, name: e.name, cat: e.cat, sets: 3, reps: '3', pct: 70, rest: 0, pause: 0 }); if (RT.onChange) RT.onChange(true); } }); break;
    }
    case 'pick': { const cb = ui.sheet && ui.sheet.cb; closeSheet(); if (cb) cb(t.dataset.ex); break; }
    case 'plates-toggle': ui.platesOpen = !ui.platesOpen; render(); break;
    case 'open-plates': ui.platesOpen = true; ui.tab = 'max'; render(); window.scrollTo(0, 0); break;
    case 'privacy': openSheet('privacy'); break;
    case 'ex-new-sess': openSheet('ex', { id: null, cb: addExerciseToSession }); break;
    case 'ex-new': openSheet('ex', { id: null, cb: ui.sheet && ui.sheet.kind === 'pick' ? ui.sheet.cb : null }); break;
    case 'ex-edit': openSheet('ex', { id: t.dataset.ex }); break;
    case 'ex-save': {
      const name = $('#exName').value.trim();
      if (!name) { toast('Ponle un nombre al ejercicio.'); break; }
      const cat = $('#exCat').value, rest = parseNum($('#exRest').value) || S.profile.rest, id = t.dataset.ex, cb = ui.sheet.cb;
      if (id) { const e = ex(id); e.name = name; e.cat = cat; e.rest = rest; save(); closeSheet(); render(); }
      else {
        const nid = 'x' + uid();
        S.exercises.push({ id: nid, name: name, cat: cat, rest: rest, max: 0, maxDate: null, builtin: false });
        save(); closeSheet(); render(); if (cb) cb(nid);
      }
      break;
    }
    case 'ex-del': S.exercises = S.exercises.filter(x => x.id !== t.dataset.ex); save(); closeSheet(); render(); toast('Ejercicio eliminado.'); break;
    case 'mx-use': $('#mxKg').value = fmtNum(parseNum(t.dataset.v), 2); break;
    case 'mx-save': {
      const e = ex(t.dataset.ex), v = parseNum($('#mxKg').value), g = parseNum($('#mxGoal') ? $('#mxGoal').value : ''), gd = $('#mxGoalDate') ? $('#mxGoalDate').value : '';
      e.max = v > 0 ? v : 0; e.maxDate = v > 0 ? ymd(new Date()) : null;
      if (g > 0) { e.goal = g; e.goalDate = /^\d{4}-\d{2}-\d{2}$/.test(gd) ? gd : ''; } else { delete e.goal; delete e.goalDate; }
      recalcPct(e.id); save(); closeSheet(); render(); break;
    }
    case 'use-est': {
      const e = ex(t.dataset.ex), est = bestSetE1rm(S.sessions, e.id, ymd(addDays(new Date(), -84)));
      e.max = roundTo(est, S.profile.rounding); e.maxDate = ymd(new Date()); save(); render(); toast('Máximo de ' + nm(e) + ' actualizado a ' + fmtNum(e.max, 1) + ' kg.'); break;
    }
    case 'calc-save': {
      const e = ex(ui.calc.exId), v = ui.calc.kg > 0 && ui.calc.reps >= 1 ? roundTo(e1rm(ui.calc.kg, Math.round(ui.calc.reps)), S.profile.rounding) : 0;
      if (!(v > 0)) { toast('Escribe un peso y repeticiones válidos.'); break; }
      if (e.max > 0 && !askConfirm('csave')) break;
      e.max = v; e.maxDate = ymd(new Date()); save(); render(); toast('Máximo de ' + nm(e) + ' guardado: ' + fmtNum(v, 1) + ' kg.'); break;
    }
    case 'export-json': saveFile('halterofilia-respaldo-' + ymd(new Date()) + '.json', JSON.stringify(S, null, 1)); break;
    case 'export-csv': saveFile('halterofilia-historial-' + ymd(new Date()) + '.csv', csvHistory()); break;
    case 'import-run': tryImport($('#impText').value); break;
    case 'import-confirm':
      if (ui.pendingImport) { S = normalize(ui.pendingImport); ui.pendingImport = null; tReset(S.profile.rest); T.mode = S.profile.timerMode; ui.calc = null; ui.progEx = null; save(true); closeSheet(); render(); toast('Respaldo importado.'); }
      break;
    case 'import-cancel': ui.pendingImport = null; ui.sheet.imp = null; renderSheet(); break;
    case 'wipe': if (askConfirm('wipe')) { S = freshState(); tReset(S.profile.rest); T.mode = S.profile.timerMode; ui.calc = null; ui.progEx = null; save(true); closeSheet(); render(); toast('Datos borrados.'); } break;
    case 'copy-text': {
      const ta = $('#bkText');
      ta.select();
      try { navigator.clipboard.writeText(ta.value).then(() => toast('Copiado.'), () => toast('Selecciona el texto y cópialo manualmente.')); } catch (err) { toast('Selecciona el texto y cópialo manualmente.'); }
      break;
    }
    case 'toast-act': { const fn = ui.toastFn; hideToast(); if (fn) fn(); break; }
    default: if (window.HalterUpdate && window.HalterUpdate.onAct(a)) break; if (APP.onAct) APP.onAct(a, t);
  }
  if (prevConfirm && !ui.confirm) { prevConfirm = null; refresh(); }
});
document.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.f && e.target.dataset.f !== 'impFile') onField(e.target); });
document.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.f === 'impFile') onField(e.target); });

/* ----- Inicio ----- */
let started = false, tickId = null;
/* opts: { storageKey, name, demo, tabs:[{id,label,icon,render}], accountHTML(), onAct(act, el), onSave() }
   onFinish(sesión): se llama al terminar una sesión (la fase 4 registra las sesiones del plan).
   Lo llama cloud.js cuando la persona ya inició sesión y tiene acceso. */
function start(opts) {
  opts = opts || {};
  KEY = opts.storageKey || 'halterofilia.v1.local';
  APP = { requireSex: !!opts.requireSex, tabs: opts.tabs || [], nav: opts.nav || null, more: opts.more || null, accountHTML: opts.accountHTML || null, onAct: opts.onAct || null, onSave: opts.onSave || null, onFinish: opts.onFinish || null, cloud: !!opts.cloud };
  storageOK = true;
  const saved = load(), fresh = !saved;
  if (saved) S = normalize(saved);
  else if (opts.demo) { S = demoState(); save(true); }
  else { S = freshState(); if (opts.name) S.profile.name = opts.name; save(true); }
  if (opts.sex && (opts.sex === 'F' || opts.sex === 'M') && !S.profile.sex) { S.profile.sex = opts.sex; S.profile.cat = ''; save(true); }
  if (!ui.tab || (!BUILTIN_TABS.includes(ui.tab) && !APP.tabs.some(t => t.id === ui.tab))) ui.tab = 'hoy';
  T.mode = S.profile.timerMode; T.target = S.profile.rest;
  buildChrome(); render();
  if (window.HalterUpdate) window.HalterUpdate.checkSoon();
  if (!started) {
    started = true;
    tickId = setInterval(tick, 500);
    $('#dlg').addEventListener('close', () => { ui.sheet = null; ui.pendingImport = null; if (S && APP.requireSex && !S.demo && !S.profile.sex) setTimeout(() => { if (S && !S.profile.sex && !ui.sheet) openSheet('sex'); }, 0); });
    $('#dlg').addEventListener('cancel', e => { if (ui.sheet && ui.sheet.kind === 'sex') e.preventDefault(); });
    document.addEventListener('visibilitychange', () => { if (!S) return; if (document.visibilityState === 'visible') { syncWake(); tick(); } else save(true); });
    window.addEventListener('pagehide', () => { if (S) save(true); });
    let rt = null;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(drawCharts, 150); });
    try { new ResizeObserver(() => document.documentElement.style.setProperty('--barh', $('#bar').offsetHeight + 'px')).observe($('#bar')); } catch (e) { /* sin ResizeObserver */ }
  }
  return fresh; // true si no había datos guardados en este dispositivo
}
function stop() {
  if (S) save(true);
  S = null; ui.sheet = null; ui.tab = 'hoy';
  try { const d = $('#dlg'); if (d.open) d.close(); } catch (e) { /* sin diálogo */ }
}
/* Lo usa sync.js: leer el estado, el estado inicial y aplicar cambios que llegan de la nube */
function commit(fn) {
  if (!S) return;
  fn(S); S = normalize(S);
  S.sessions.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  save(true); softRefresh();
}
/* Si la persona está escribiendo en un campo, la pantalla se actualiza al terminar (así no se pierde lo escrito) */
let refreshLater = false;
function typing() { const a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.dataset && a.dataset.f); }
function softRefresh() { if (!S) return; if (typing()) refreshLater = true; else { refreshLater = false; refresh(); } }
document.addEventListener('focusout', () => { setTimeout(() => { if (refreshLater && S && !typing()) { refreshLater = false; refresh(); } }, 0); });
window.HalterApp = { icon: svg, empty: emptyHTML, rt: { bind: rtBind, card: rtCard, ex: rtEx }, errorBox: errorHTML, start: start, stop: stop, render: () => { softRefresh(); }, toast: toast, esc: esc, state: () => S, fresh: freshState, commit: commit, startPlanned: startPlanned,
  /* cálculos compartidos con la vista del entrenador (compare.js) */
  pure: { categoryOf: categoryOf, catText: catText, catOptions: catOptions, catSortKey: catSortKey, fmtNum: fmtNum, SEX_LABEL: SEX_LABEL, shortDate: shortDate, parseYmd: parseYmd, ymd: ymd } };
})();
