/* Datos base de la app: categorías, ajustes por defecto, ejercicios de fábrica, estado inicial, datos de ejemplo y normalización del estado guardado. Sin acceso al DOM ni al estado en curso. */
import { parseNum, parseReps, roundTo, ymd, addDays, mondayOf, mulberry32, uid, catOptions } from './logic.js';

export const CATS = [['comp', 'Competencia'], ['cmplx', 'Complejos'], ['tec', 'Técnica'], ['tiron', 'Tirones'], ['fuerza', 'Fuerza'], ['acc', 'Accesorios'], ['mov', 'Movilidad'], ['pc', 'Peso corporal']];
/* Cómo se mide un ejercicio: 'kg' (peso y repeticiones), 'reps' (solo repeticiones), 'time' (segundos) o 'kgt' (peso y tiempo:
   isométricos con carga, p. ej. plancha con discos; desde 4.18.0). Movilidad y peso corporal parten sin kilos. */
export const MEAS = [['kg', 'Peso y repeticiones'], ['reps', 'Solo repeticiones'], ['time', 'Tiempo'], ['kgt', 'Peso y tiempo']];
export const measOf = e => e && (e.meas === 'kg' || e.meas === 'reps' || e.meas === 'time' || e.meas === 'kgt') ? e.meas : (e && e.cat === 'mov' ? 'time' : e && e.cat === 'pc' ? 'reps' : 'kg');
/* «45» o «1:30» → segundos; 0 si no es válido. */
export function parseSecs(v) {
  const t = String(v == null ? '' : v).trim(); if (!t) return 0;
  const m = /^(\d{1,3}):([0-5]?\d)$/.exec(t); if (m) return +m[1] * 60 + +m[2];
  return /^\d{1,5}$/.test(t) ? +t : 0;
}
export const secsIn = n => n >= 60 ? Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0') : String(n);   // como se escribe en el campo
export const fmtSecs = n => n >= 60 ? secsIn(n) + ' min' : n + ' s';
/* ¿La serie tiene lo necesario para marcarla como hecha? */
export function setReady(st, m) {
  if (m === 'time' || m === 'kgt') return parseSecs(st.secs) > 0;   // en «peso y tiempo» los kilos son opcionales (puede hacerse sin discos)
  if (m === 'reps') return parseReps(st.reps).total >= 1;
  return parseNum(st.kg) > 0 && parseReps(st.reps).total >= 1;
}
export const REST_OPTS = [30, 45, 60, 90, 120, 150, 180, 240, 300];
export const DEFAULT_PROFILE = { name: '', bw: 0, bar: 20, rounding: 1, rest: 120, timerEnabled: true, autoTimer: false, timerMode: 'down', sound: true, vibrate: true, keepAwake: true, showRpe: true, prefs: 2, exLang: 'en', sex: '', cat: '' };

export const EN_NAMES = { snatch: 'Snatch', cj: 'Clean & Jerk', psnatch: 'Power Snatch', clean: 'Clean', pclean: 'Power Clean', jerk: 'Jerk', ohsq: 'Overhead Squat', snpull: 'Snatch Pull', clpull: 'Clean Pull',
  bsq: 'Back Squat', fsq: 'Front Squat', pp: 'Push Press', press: 'Military Press', rdl: 'Romanian Deadlift', row: 'Barbell Row', 'cx-clfj': 'Clean + Front Squat + Jerk', 'cx-snoh': 'Snatch + Overhead Squat' };
export function defaultExercises() {
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
export function freshState() {
  return {
    v: 1, demo: false, profile: Object.assign({}, DEFAULT_PROFILE), exercises: defaultExercises(),
    plan: { days: Array.from({ length: 7 }, () => ({ on: false, name: '', items: [] })) }, sessions: []
  };
}

export function demoState() {
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
          item.sets.push(Object.assign({ kg: kg, reps: p.reps, pct: pct, rpe: null, done: true, doneAt: t }));
        }
        if (item.sets.length) items.push(item);
      }
      st.sessions.push({ id: uid(), date: ymd(date), dayIdx: d, name: day.name, startedAt: start.getTime(), endedAt: t + 120000, notes: '', bw: 81, srpe: deload ? 5 : 6 + Math.round(rnd() * 3), items: items });
    }
  }
  return st;
}

export function normalize(o) {
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
