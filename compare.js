/* Halterofilia · Selección — marcas del equipo y comparación entre atletas (solo entrenador).
   Muestra las marcas de arranque, dos tiempos y total de cada atleta, separadas por sexo y por categoría de peso,
   ordenadas por total, con la diferencia respecto del líder de la categoría. Al tocar un atleta se ven todos sus máximos y metas.
   Lee del perfil de cada atleta (sexo, peso, categoría) y de sus ejercicios (users/{uid}/records/profile, e_snatch, e_cj),
   que las reglas ya dejan leer al entrenador. Cuesta 3 lecturas por atleta al abrir o actualizar (y las del detalle al tocar uno).
   La parte pura (sin DOM) se prueba con Node: node tests/compare-unit.js */
(function (root) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d) => (isFinite(n) ? n : 0).toLocaleString('es-CL', { maximumFractionDigits: d == null ? 1 : d });
  const SEX_ORDER = ['M', 'F', ''];
  const SEX_NAME = { M: 'Masculino', F: 'Femenino', '': 'Sin sexo indicado' };

  /* ---------- Parte pura ---------- */
  /* Cada documento de la nube guarda su contenido como texto JSON en `d` (un registro borrado trae del = true) */
  function parseDoc(doc) {
    if (!doc || doc.del || typeof doc.d !== 'string') return null;
    try { const o = JSON.parse(doc.d); return o && typeof o === 'object' ? o : null; } catch (e) { return null; }
  }
  const num = v => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; };

  /* Una fila de la tabla a partir de los tres documentos. P = { categoryOf } (viene de app.js). */
  function buildRow(member, profileDoc, snDoc, cjDoc, P) {
    const pr = parseDoc(profileDoc) || {}, sn = parseDoc(snDoc), cj = parseDoc(cjDoc);
    const sex = pr.sex === 'M' || pr.sex === 'F' ? pr.sex : '', bw = num(pr.bw) > 0 ? num(pr.bw) : 0;
    const snatch = sn && num(sn.max) > 0 ? num(sn.max) : 0, cjv = cj && num(cj.max) > 0 ? num(cj.max) : 0;
    const log = Array.isArray(pr.bwLog) && pr.bwLog.length ? pr.bwLog[pr.bwLog.length - 1] : null;
    return {
      uid: member.id, name: member.name || pr.name || member.email || '(sin nombre)', sex: sex, bw: bw, bwDate: log && log.d ? String(log.d) : '',
      cat: sex ? P.categoryOf(sex, bw, pr.cat) : '', snatch: snatch, cj: cjv, total: snatch > 0 && cjv > 0 ? snatch + cjv : 0,
      snDate: sn && sn.maxDate ? String(sn.maxDate) : '', cjDate: cj && cj.maxDate ? String(cj.maxDate) : '',
      ratio: snatch > 0 && cjv > 0 ? snatch / cjv * 100 : 0
    };
  }
  /* Ordena por total (mayor primero); sin total al final, por arranque y luego por nombre */
  function rankRows(rows) {
    return rows.slice().sort((a, b) => (b.total - a.total) || (b.snatch - a.snatch) || (b.cj - a.cj) || String(a.name).localeCompare(String(b.name), 'es'));
  }
  /* Grupos [{ sex, cats: [{ cat, rows }] }] según los filtros { sex: 'all' | 'M' | 'F', cat: 'all' | '71' | '+110' | '' }. P = { catSortKey }. */
  function groupRows(rows, f, P) {
    f = f || {};
    const out = [];
    SEX_ORDER.forEach(sx => {
      if (f.sex && f.sex !== 'all' && f.sex !== sx) return;
      const mine = rows.filter(r => r.sex === sx && (!f.cat || f.cat === 'all' || f.cat === r.cat));
      if (!mine.length) return;
      const cats = Array.from(new Set(mine.map(r => r.cat)));
      cats.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : P.catSortKey(a) - P.catSortKey(b)));
      out.push({ sex: sx, cats: cats.map(c => ({ cat: c, rows: rankRows(mine.filter(r => r.cat === c)) })) });
    });
    return out;
  }
  /* Categorías presentes en los datos (para los botones de filtro), de menor a mayor */
  function catsPresent(rows, sex, P) {
    const s = new Set(rows.filter(r => (sex === 'all' || r.sex === sex) && r.cat).map(r => r.cat));
    return Array.from(s).sort((a, b) => P.catSortKey(a) - P.catSortKey(b));
  }
  /* Diferencia de total respecto del líder: 0 para el líder, negativa para el resto, null si no tiene total */
  function gapToLeader(rows) {
    const lead = rows.length && rows[0].total > 0 ? rows[0].total : 0;
    return rows.map(r => (lead > 0 && r.total > 0) ? r.total - lead : null);
  }

  /* ---------- Interfaz ---------- */
  const H = { remote: () => null, members: () => [], toast: () => {}, render: () => {}, err: e => String(e && e.message || e), P: () => (root.HalterApp && root.HalterApp.pure) || {} };
  const K = { sex: 'all', cat: 'all', rows: null, loading: false, err: '', at: 0, reads: 0, open: null, detail: {}, ids: '' };

  function init(o) { Object.assign(H, o || {}); }
  function reset() { Object.assign(K, { sex: 'all', cat: 'all', rows: null, loading: false, err: '', at: 0, reads: 0, open: null, detail: {}, ids: '' }); }

  async function load() {
    if (K.loading) return;
    const r = H.remote(), members = H.members().slice();
    if (!r) return;
    K.loading = true; K.err = '';
    const P = H.P();
    let reads = 0;
    try {
      const rows = await Promise.all(members.map(async m => {
        const g = async k => { reads++; return r.getDoc('users/' + m.id + '/records/' + k); };
        const [pf, sn, cj] = await Promise.all([g('profile'), g('e_snatch'), g('e_cj')]);
        return buildRow(m, pf, sn, cj, P);
      }));
      K.rows = rows; K.at = Date.now(); K.reads = reads; K.ids = members.map(m => m.id).sort().join(',');
    } catch (e) { K.err = H.err(e); K.rows = K.rows || []; }
    K.loading = false;
    H.render();
  }
  async function loadDetail(uid) {
    if (K.detail[uid] && K.detail[uid].list) return;
    K.detail[uid] = { loading: true };
    H.render();
    try {
      const docs = await H.remote().getCol('users/' + uid + '/records', { t: 'exercise' });
      const list = docs.map(parseDoc).filter(e => e && e.id && num(e.max) > 0).map(e => ({ id: e.id, name: e.en || e.name || e.id, cat: e.cat || 'acc', max: num(e.max), date: e.maxDate || '', goal: num(e.goal), goalDate: e.goalDate || '' }));
      const order = ['comp', 'tec', 'tiron', 'fuerza', 'acc', 'cmplx'];
      list.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat) || String(a.name).localeCompare(String(b.name), 'es'));
      K.detail[uid] = { list: list };
    } catch (e) { K.detail[uid] = { err: H.err(e), list: [] }; }
    H.render();
  }

  function dateText(ymd) {
    if (!ymd) return '';
    const P = H.P();
    try { return P.shortDate(P.parseYmd(ymd)); } catch (e) { return ''; }
  }
  function detailHTML(uid) {
    const d = K.detail[uid];
    if (!d || d.loading) return '<div class="cmp-det"><p class="muted">Leyendo marcas…</p></div>';
    if (d.err) return '<div class="cmp-det"><p class="warn-t">' + esc(d.err) + '</p></div>';
    if (!d.list.length) return '<div class="cmp-det">' + window.HalterApp.empty('max', 'Sin máximos guardados', 'Este atleta aún no registra máximos.') + '</div>';
    return '<div class="cmp-det"><div class="ratios">' + d.list.map(e => '<div class="ratio"><span>' + esc(e.name) + (e.date ? ' <small class="dim">' + esc(dateText(e.date)) + '</small>' : '') + '</span><b>' + fmt(e.max, 1) + ' kg' +
      (e.goal > 0 ? ' <small class="dim">meta ' + fmt(e.goal, 1) + (e.goalDate ? ' al ' + esc(dateText(e.goalDate)) : '') + '</small>' : '') + '</b></div>').join('') + '</div></div>';
  }
  function tableHTML(rows, P) {
    const gaps = gapToLeader(rows);
    let h = '<div class="cmp-scroll"><table class="cmp-tab"><thead><tr><th scope="col">Atleta</th><th scope="col">Peso</th><th scope="col">Arranque</th><th scope="col">Dos t.</th><th scope="col">Total</th><th scope="col">Dif.</th></tr></thead><tbody>';
    rows.forEach((r, i) => {
      const lead = i === 0 && r.total > 0;
      h += '<tr' + (lead ? ' class="lead"' : '') + '><td><button class="lnk" data-act="cmp-open" data-uid="' + esc(r.uid) + '" aria-expanded="' + (K.open === r.uid) + '"><b>' + (lead ? '★ ' : '') + esc(r.name) + '</b></button></td>' +
        '<td>' + (r.bw > 0 ? fmt(r.bw, 1) : '<span class="dim">–</span>') + '</td>' +
        '<td>' + (r.snatch > 0 ? fmt(r.snatch, 1) : '<span class="dim">–</span>') + (r.snDate ? '<br><small class="dim">' + esc(dateText(r.snDate)) + '</small>' : '') + '</td>' +
        '<td>' + (r.cj > 0 ? fmt(r.cj, 1) : '<span class="dim">–</span>') + (r.cjDate ? '<br><small class="dim">' + esc(dateText(r.cjDate)) + '</small>' : '') + '</td>' +
        '<td><b>' + (r.total > 0 ? fmt(r.total, 1) : '–') + '</b>' + '</td>' +
        '<td>' + (gaps[i] == null ? '<span class="dim">–</span>' : gaps[i] === 0 ? 'líder' : '−' + fmt(Math.abs(gaps[i]), 1)) + '</td></tr>';
      if (K.open === r.uid) h += '<tr><td colspan="6">' + detailHTML(r.uid) + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  function view() {
    const P = H.P(), members = H.members();
    const ids = members.map(m => m.id).sort().join(',');
    if (!K.loading && (K.rows === null || (K.ids !== ids && members.length))) { if (members.length || K.rows === null) setTimeout(load, 0); }
    let h = '<h1>Marcas del equipo</h1><p class="muted">Máximos de arranque y dos tiempos de cada atleta, por sexo y categoría de peso. Los datos salen de lo que cada atleta tiene guardado en su cuenta.</p>';
    if (K.err) h += '<div class="note warn">' + esc(K.err) + '</div>';
    if (K.rows === null || (K.loading && !K.rows)) return h + '<p class="muted">Leyendo marcas del equipo…</p>';
    const rows = K.rows || [];
    if (!rows.length) return h + window.HalterApp.empty(members.length ? 'prog' : 'team', members.length ? 'Sin datos todavía' : 'Aún no hay atletas aprobados', members.length ? 'Los datos aparecen cuando los atletas registran máximos.' : 'Aprueba solicitudes en «Equipo».');
    const cats = catsPresent(rows, K.sex, P);
    if (K.cat !== 'all' && cats.indexOf(K.cat) < 0) K.cat = 'all';
    const pill = (act, v, label, on) => '<button class="pill" data-act="' + act + '" data-v="' + esc(v) + '" aria-pressed="' + on + '">' + esc(label) + '</button>';
    h += '<div class="cmp-bar" role="group" aria-label="Sexo">' + pill('cmp-sex', 'all', 'Todos', K.sex === 'all') + pill('cmp-sex', 'M', 'Masculino', K.sex === 'M') + pill('cmp-sex', 'F', 'Femenino', K.sex === 'F') + '</div>';
    if (cats.length) h += '<div class="cmp-bar" role="group" aria-label="Categoría de peso">' + pill('cmp-cat', 'all', 'Todas', K.cat === 'all') + cats.map(c => pill('cmp-cat', c, P.catText(c), K.cat === c)).join('') + '</div>';
    const groups = groupRows(rows, { sex: K.sex, cat: K.cat }, P);
    if (!groups.length) h += '<p class="muted">Ningún atleta coincide con el filtro.</p>';
    groups.forEach(g => {
      h += '<section class="cmp-grp"><h2>' + esc(SEX_NAME[g.sex]) + '</h2>';
      if (g.sex === '') h += '<p class="muted">Estos atletas aún no indicaron su sexo: la app se lo pedirá la próxima vez que la abran.</p>';
      g.cats.forEach(c => {
        h += '<div class="card sec"><p class="eyebrow">' + (c.cat ? esc(P.catText(c.cat)) : (g.sex ? 'Sin categoría (falta el peso)' : 'Todos')) + ' · ' + c.rows.length + (c.rows.length === 1 ? ' atleta' : ' atletas') + '</p>' + tableHTML(c.rows, P) + '</div>';
      });
      h += '</section>';
    });
    h += '<div class="cmp-bar"><button class="btn ghost sm" data-act="cmp-refresh"' + (K.loading ? ' disabled' : '') + '>' + (K.loading ? 'Actualizando…' : 'Actualizar') + '</button>' +
      '<span class="muted">' + (K.at ? 'Leído a las ' + new Date(K.at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) + ' · ' + K.reads + ' lecturas' : '') + '</span></div>' +
      '<p class="muted">★ = líder de la categoría por total. Dif. = diferencia de total con el líder. Las categorías siguen la tabla de la IWF vigente; confirma con el reglamento de cada torneo. Compara solo marcas registradas por los atletas, no resultados de competencia oficial.</p>';
    return h;
  }

  function onAct(act, el) {
    switch (act) {
      case 'cmp-sex': K.sex = el.dataset.v; K.cat = 'all'; break;
      case 'cmp-cat': K.cat = el.dataset.v; break;
      case 'cmp-refresh': K.detail = {}; K.rows = K.rows || []; load(); break;
      case 'cmp-open': {
        const u = el.dataset.uid;
        K.open = K.open === u ? null : u;
        if (K.open) loadDetail(u);
        break;
      }
    }
  }

  const api = { parseDoc: parseDoc, buildRow: buildRow, rankRows: rankRows, groupRows: groupRows, catsPresent: catsPresent, gapToLeader: gapToLeader,
    init: init, reset: reset, view: view, onAct: onAct };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HalterCompare = api;
})(typeof window !== 'undefined' ? window : globalThis);
