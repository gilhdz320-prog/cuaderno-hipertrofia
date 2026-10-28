/* ============================================================================
   cuaderno · app.js — interfaz
   Depende de engine.js (window.CE).
   ========================================================================== */
(function () {
  'use strict';

  const CE = window.CE;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  const KEY = 'cuaderno.v3';
  const KEY_OLD = 'cuaderno.v2';
  const THEME_KEY = 'cuaderno.theme';

  let DB = null;         // todos los perfiles + cuál está activo
  let S = null;          // perfil activo (atajo: todo el código de vistas usa S)
  let EX = null;         // mapa de ejercicios (pool + propios)
  let P = null;          // programa activo (con fase aplicada)
  let TAB = 'hoy';
  let WEEK_OFFSET = 0;   // navegación de semanas
  let PICKED_DATE = null;
  let storageOK = true;

  /* ------------------------------------------------------------------ *
   * utilidades
   * ------------------------------------------------------------------ */
  const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });

  function kg(v) { return nf.format(Math.round((v || 0) * 100) / 100); }
  function tn(v) { return nf.format(Math.round((v || 0) / 100) / 10) + ' t'; }
  function num(v) { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SVG_TAGS = { svg: 1, rect: 1, line: 1, path: 1, text: 1, circle: 1, g: 1, title: 1, tspan: 1 };
  function el(tag, attrs) {
    const n = SVG_TAGS[tag] ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(k => {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') { if (n instanceof SVGElement) n.setAttribute('class', v); else n.className = v; }
        else if (k === 'text') n.textContent = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k === 'dataset') Object.keys(v).forEach(d => { n.dataset[d] = v[d]; });
        else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) n.setAttribute(k, '');
        else n.setAttribute(k, v);
      });
    }
    for (let i = 2; i < arguments.length; i++) add(n, arguments[i]);
    return n;
  }
  function add(n, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(k => add(n, k)); return; }
    n.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }

  let toastT = null;
  function toast(msg, action) {
    const t = $('#toast');
    if (!t) return;
    clear(t);
    t.appendChild(document.createTextNode(msg));
    if (action) {
      t.appendChild(el('button', {
        class: 'btn sm', text: action.label,
        onclick: () => { action.onClick(); t.classList.remove('show'); }
      }));
    }
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), action ? 9000 : 2400);
  }

  function debounce(fn, ms) {
    let t = null;
    return function () { const a = arguments, self = this; clearTimeout(t); t = setTimeout(() => fn.apply(self, a), ms); };
  }

  function weekdayOf(dateISO) {
    const d = CE.parseDate(dateISO).getDay();
    return d === 0 ? 7 : d;
  }
  function todayISO() { return CE.toISODate(new Date()); }

  function dateLabel(dateISO) {
    const d = CE.parseDate(dateISO);
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return CE.weekdayName(weekdayOf(dateISO)) + ' ' + d.getDate() + ' de ' + months[d.getMonth()];
  }
  function shortDate(dateISO) {
    const d = CE.parseDate(dateISO);
    return d.getDate() + ' ' + ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][d.getMonth()];
  }

  /* ------------------------------------------------------------------ *
   * estado
   * ------------------------------------------------------------------ */
  function readStore() {
    /* v3: varios perfiles */
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return CE.migrateState(JSON.parse(raw));
    } catch (e) { storageOK = false; }
    /* v2: un solo perfil → se migra sin perder nada */
    try {
      const old = localStorage.getItem(KEY_OLD);
      if (old) {
        const migrated = CE.migrateState(JSON.parse(old));
        try { localStorage.setItem(KEY, JSON.stringify(migrated)); } catch (e2) {}
        return migrated;
      }
    } catch (e) { }
    return CE.migrateState(null);
  }
  function writeStore() {
    DB.updatedAt = new Date().toISOString();
    if (S) S.updatedAt = DB.updatedAt;
    try { localStorage.setItem(KEY, JSON.stringify(DB)); storageOK = true; }
    catch (e) { storageOK = false; }
    flashSaved();
    scheduleSync();
  }

  /* ---------- perfiles ---------- */
  function profileList() { return Object.keys(DB.profiles).map((id) => DB.profiles[id]); }
  function createProfile(opts) {
    opts = opts || {};
    const name = opts.name || 'Atleta';
    const p = CE.normalizeProfile({ name: name, athlete: { name: name, weightKg: opts.weightKg || 65, experience: opts.experience || 'intermedio' } });
    p.program = CE.buildProgram({
      n: p.block.freq, exMap: CE.getExMap(p.custom), loads: p.loads,
      equipment: p.equipment, prefs: p.prefs, swaps: p.swaps
    });
    p.loads = CE.seedLoads(p);
    p.onboarded = true;
    p.program = CE.buildProgram({ n: p.block.freq, exMap: CE.getExMap(p.custom), loads: p.loads, equipment: p.equipment, prefs: p.prefs, swaps: p.swaps });
    DB.profiles[p.id] = p;
    DB.activeId = p.id;
    save(true);
    return p;
  }
  function switchProfile(id) {
    if (!DB.profiles[id]) return;
    DB.activeId = id;
    S = DB.profiles[id];
    save(true);
    refreshDerived();
    render();
    toast('Perfil: ' + (S.name || 'Atleta'));
  }
  let saveT = null;
  function save(now) {
    const s = $('#saveState');
    if (s) { s.classList.add('saving'); s.textContent = 'guardando…'; }
    clearTimeout(saveT);
    if (now) { writeStore(); return; }
    saveT = setTimeout(writeStore, 350);
  }
  let flashT = null;
  function flashSaved() {
    const s = $('#saveState');
    if (!s) return;
    s.classList.remove('saving');
    s.innerHTML = '';
    s.appendChild(el('i', { class: 'dot' }));
    s.appendChild(document.createTextNode(storageOK ? 'guardado' : 'sin guardar'));
    clearTimeout(flashT);
    flashT = setTimeout(() => { if (!storageOK) return; }, 1200);
  }

  /* SQL de instalación. Mantener en sintonía con supabase/schema.sql */
  const SETUP_SQL = [
    'create table if not exists public.profiles (',
    '  id text primary key,',
    '  user_id uuid not null references auth.users (id) on delete cascade,',
    "  name text not null default 'Atleta',",
    "  data jsonb not null default '{}'::jsonb,",
    '  updated_at timestamptz not null default now()',
    ');',
    'create index if not exists profiles_user_id_idx on public.profiles (user_id);',
    'alter table public.profiles enable row level security;',
    'drop policy if exists "own rows" on public.profiles;',
    'create policy "own rows" on public.profiles for all',
    '  using (auth.uid() = user_id) with check (auth.uid() = user_id);'
  ].join('\n');

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return false; });
      }
    } catch (e) {}
    return Promise.resolve(false);
  }

  /* ---------- sincronización (Supabase) ---------- */
  const SYNC_CFG_KEY = 'cuaderno.supabase';
  let SYNC_CLIENT = null;
  let SYNC_STATE = 'off';
  let SYNC_ERR = null;
  let SYNC_LAST = null;
  let syncTimer = null;

  function syncCfg() {
    const def = window.CUADERNO_CONFIG || {};
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(SYNC_CFG_KEY) || '{}'); } catch (e) { saved = {}; }
    return { url: saved.url || def.supabaseUrl || '', key: saved.key || def.supabaseAnonKey || '' };
  }
  function saveSyncCfg(url, key) {
    try { localStorage.setItem(SYNC_CFG_KEY, JSON.stringify({ url: url, key: key })); } catch (e) {}
  }
  function initSync() {
    const c = syncCfg();
    SYNC_CLIENT = null;
    if (!c.url || !c.key || !window.CuadernoSync) { SYNC_STATE = 'off'; return; }
    SYNC_CLIENT = window.CuadernoSync.createSync({
      url: c.url, anonKey: c.key,
      storage: {
        get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
        remove: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
      }
    });
    SYNC_STATE = SYNC_CLIENT.session() ? 'on' : 'off';
  }

  function renderSyncChip() {
    const chip = $('#syncChip');
    if (!chip) return;
    if (SYNC_STATE === 'off') { chip.classList.add('hidden'); return; }
    chip.classList.remove('hidden');
    chip.className = 'chip ' + (SYNC_STATE === 'on' ? 'green' : SYNC_STATE === 'error' ? 'red' : 'amber');
    chip.textContent = SYNC_STATE === 'on' ? '☁︎ sincronizado'
      : SYNC_STATE === 'syncing' ? '☁︎ guardando…'
      : '☁︎ sin conexión';
    const mail = SYNC_CLIENT && SYNC_CLIENT.userEmail ? SYNC_CLIENT.userEmail() : '';
    chip.title = SYNC_ERR || (SYNC_STATE === 'on'
      ? 'En la nube' + (mail ? ' como ' + mail : '') + (SYNC_LAST ? ' · última vez ' + SYNC_LAST.toLocaleTimeString('es-ES') : '')
      : 'Tu cuaderno está solo en este navegador');
  }

  function scheduleSync() {
    if (!SYNC_CLIENT || !SYNC_CLIENT.session()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { pushActive().catch(function () {}); }, 4000);
  }

  async function pushActive() {
    if (!SYNC_CLIENT) return false;
    SYNC_STATE = 'syncing'; renderSyncChip();
    try {
      await SYNC_CLIENT.push(S);
      SYNC_STATE = 'on'; SYNC_LAST = new Date(); SYNC_ERR = null;
    } catch (e) {
      SYNC_STATE = 'error'; SYNC_ERR = e.message || String(e);
    }
    renderSyncChip();
    return SYNC_STATE === 'on';
  }

  async function syncNow() {
    if (!SYNC_CLIENT) throw new Error('Falta configurar el proyecto en Ajustes → Cuenta.');
    SYNC_STATE = 'syncing'; renderSyncChip();
    try {
      const rows = await SYNC_CLIENT.pull();
      const rec = window.CuadernoSync.reconcile(profileList(), rows);
      rec.toLocal.forEach(function (p) { DB.profiles[p.id] = CE.normalizeProfile(p); });
      for (const p of rec.toRemote) await SYNC_CLIENT.push(p);
      if (!DB.profiles[DB.activeId]) DB.activeId = Object.keys(DB.profiles)[0];
      S = DB.profiles[DB.activeId];
      SYNC_STATE = 'on'; SYNC_LAST = new Date(); SYNC_ERR = null;
      save(true); refreshDerived(); render();
      return rec;
    } catch (e) {
      SYNC_STATE = 'error'; SYNC_ERR = e.message || String(e);
      renderSyncChip();
      throw e;
    }
  }

  function refreshDerived() {
    if (DB && DB.profiles && DB.profiles[DB.activeId]) S = DB.profiles[DB.activeId];
    EX = CE.getExMap(S.custom);
    const base = S.program && S.program.days ? S.program : CE.buildProgram({ n: S.block.freq, exMap: EX, loads: S.loads, swaps: S.swaps, equipment: S.equipment, prefs: S.prefs });
    S.program = base;
    const ph = CE.phaseForWeek(currentWeek());
    P = ph.volume === 1 ? base : CE.applyVolume(JSON.parse(JSON.stringify(base)), ph.volume);
  }

  function currentWeek() { return CE.weekNumber(S.block.start, todayISO()); }
  function phaseNow() { return CE.phaseForWeek(currentWeek()); }
  function blockWeek(dateISO) { return CE.weekNumber(S.block.start, dateISO || todayISO()); }

  function logFor(dateISO, sessionId) {
    if (!S.logs[dateISO]) S.logs[dateISO] = { sessionId: sessionId || null, entries: {}, readiness: null, note: '', modifier: 0, optional: {} };
    const L = S.logs[dateISO];
    if (sessionId && !L.sessionId) L.sessionId = sessionId;
    if (!L.entries) L.entries = {};
    if (!L.optional) L.optional = {};
    return L;
  }
  function adjustedSets(slot, L) {
    const d = (L && L.setDelta) || 0;
    return Math.max(2, slot.sets + d);
  }

  function entryFor(dateISO, exId, slot) {
    const L = logFor(dateISO);
    const mod = 1 + ((L.modifier || 0) / 100);
    if (!L.entries[exId]) L.entries[exId] = { sets: [], load: Math.round((S.loads[exId] || 0) * mod * 2) / 2, adjusted: 0 };
    const e = L.entries[exId];
    if (!e.sets) e.sets = [];
    if (slot) {
      const n = adjustedSets(slot, L);
      while (e.sets.length < n) e.sets.push({});
    }
    return e;
  }
  function logsBefore(dateISO) {
    const out = {};
    Object.keys(S.logs).forEach(d => { if (d < dateISO) out[d] = S.logs[d]; });
    return out;
  }
  function sessionDay(dateISO) {
    const wd = weekdayOf(dateISO);
    return P.days.filter(d => d.weekday === wd)[0] || null;
  }
  function dayById(id) { return P.days.filter(d => d.id === id)[0] || null; }

  /* ------------------------------------------------------------------ *
   * cabecera y pestañas
   * ------------------------------------------------------------------ */
  function renderChrome() {
    const week = currentWeek();
    const ph = phaseNow();
    const wc = $('#weekChip');
    if (wc) {
      wc.textContent = week >= 1 ? 'Semana ' + week + ' · ' + ph.name : 'Sin empezar';
      wc.className = 'chip ' + (ph.id === 'del' || ph.id === 'rev' ? 'amber' : ph.id === 'int' ? 'accent' : '');
    }
    const fc = $('#freqChip');
    if (fc) {
      const total = CE.countSets(P);
      fc.textContent = P.days.length + ' días · ' + total + ' series';
    }
    const bn = $('#blockName');
    if (bn) bn.textContent = S.block.name;
    const pn = $('#profileName');
    if (pn) pn.textContent = S.name || 'Atleta';
    renderSyncChip();
    const av = $('#avatarInitial');
    if (av) av.textContent = (S.name || 'A').trim().charAt(0);
    $$('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === TAB ? 'true' : 'false'));
    document.body.dataset.tab = TAB;
  }

  function go(tab, opts) {
    TAB = tab;
    try { history.replaceState(null, '', '#' + tab); } catch (e) {}
    if (opts && opts.week !== undefined) WEEK_OFFSET = opts.week;
    render();
    window.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
  }

  /* ------------------------------------------------------------------ *
   * gráficos (SVG a mano)
   * ------------------------------------------------------------------ */
  function barChart(data, opts) {
    opts = opts || {};
    const w = opts.width || 640, h = opts.height || 170, pad = { t: 14, r: 8, b: 22, l: 8 };
    const max = Math.max.apply(null, data.map(d => d.value).concat([1]));
    const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
    const bw = innerW / Math.max(1, data.length) * 0.5;
    const svg = el('svg', { class: 'chart', viewBox: '0 0 ' + w + ' ' + h, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': opts.label || 'Gráfico de tonelaje', style: { width: '100%', height: 'auto', aspectRatio: w + ' / ' + h } });
    svg.appendChild(el('line', { class: 'axis', x1: pad.l, y1: h - pad.b, x2: w - pad.r, y2: h - pad.b }));
    data.forEach((d, i) => {
      const x = pad.l + (innerW / Math.max(1, data.length)) * (i + 0.5);
      const bh = (d.value / max) * innerH;
      const y = h - pad.b - bh;
      const bar = el('rect', { class: 'bar' + (d.today ? ' today' : ''), x: x - bw / 2, y: y, width: bw, height: Math.max(1, bh), rx: 2 });
      bar.appendChild(el('title', { text: d.label + ': ' + nf0.format(d.value) + ' kg' }));
      svg.appendChild(bar);
      if (d.label) svg.appendChild(el('text', { x: x, y: h - 6, 'text-anchor': 'middle', text: d.short || d.label }));
    });
    if (opts.target) {
      const y = h - pad.b - (opts.target / max) * innerH;
      svg.appendChild(el('line', { x1: pad.l, y1: y, x2: w - pad.r, y2: y, stroke: 'var(--line-2)', 'stroke-dasharray': '3 3' }));
    }
    return svg;
  }

  function lineChart(points, opts) {
    opts = opts || {};
    const w = opts.width || 640, h = opts.height || 150, pad = { t: 14, r: 10, b: 22, l: 10 };
    const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
    const vals = points.map(p => p.y);
    let min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (max - min < 1) { max += 1; min -= 1; }
    const svg = el('svg', { class: 'chart', viewBox: '0 0 ' + w + ' ' + h, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': opts.label || 'Evolución', style: { width: '100%', height: 'auto', aspectRatio: w + ' / ' + h } });
    svg.appendChild(el('line', { class: 'axis', x1: pad.l, y1: h - pad.b, x2: w - pad.r, y2: h - pad.b }));
    const X = i => pad.l + (points.length === 1 ? innerW / 2 : (innerW / (points.length - 1)) * i);
    const Y = v => h - pad.b - ((v - min) / (max - min)) * innerH;
    const d = points.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ');
    if (opts.area !== false && points.length > 1) {
      svg.appendChild(el('path', { class: 'area', d: d + ' L' + X(points.length - 1) + ' ' + (h - pad.b) + ' L' + X(0) + ' ' + (h - pad.b) + ' Z' }));
    }
    svg.appendChild(el('path', { class: 'line', d: d }));
    points.forEach((p, i) => {
      svg.appendChild(el('circle', { cx: X(i), cy: Y(p.y), r: 2.6, fill: 'var(--accent)' }));
      if (p.label) svg.appendChild(el('text', { x: X(i), y: h - 6, 'text-anchor': 'middle', text: p.label }));
    });
    return svg;
  }

  /* ------------------------------------------------------------------ *
   * HOY
   * ------------------------------------------------------------------ */
  function viewToday() {
    const date = PICKED_DATE || todayISO();
    const wrap = el('div', { class: 'stack' });
    const wd = weekdayOf(date);
    let day = sessionDay(date);
    const L = logFor(date, day ? day.id : null);

    /* si el día no tiene sesión asignada pero hay una sesión guardada, se usa esa */
    if (!day && L.sessionId) day = dayById(L.sessionId);
    if (!day && Object.keys(L.entries || {}).length) {
      day = { id: L.sessionId || 'libre', name: 'Sesión libre', focus: 'Sin plantilla', slots: [] };
    }

    /* cabecera */
    const head = el('div', { class: 'session-head' });
    const left = el('div', {});
    left.appendChild(el('div', { class: 'kicker', text: dateLabel(date) + (date === todayISO() ? ' · hoy' : '') }));
    left.appendChild(el('h1', { text: day ? day.name : 'Día de descanso' }));
    left.appendChild(el('div', { class: 'session-focus', text: day ? day.focus : 'Sin sesión programada. El descanso también forma parte del plan.' }));
    head.appendChild(left);

    if (day) {
      const st = CE.sessionStats(day, S.loads, EX);
      const box = el('div', { class: 'session-stats' });
      box.appendChild(el('div', { class: 'stat' }, el('span', { class: 'v', id: 'st-sets', text: String(st.sets) }), el('span', { class: 'k', text: 'series' })));
      box.appendChild(el('div', { class: 'stat' }, el('span', { class: 'v', id: 'st-ton', text: tn(st.tonnage) }), el('span', { class: 'k', text: 'previsto' })));
      box.appendChild(el('div', { class: 'stat' }, el('span', { class: 'v', text: st.minutes + '′' }), el('span', { class: 'k', text: 'estimado' })));
      head.appendChild(box);
    }
    wrap.appendChild(head);

    if (!day) {
      wrap.appendChild(restCard(date, L));
      return wrap;
    }

    const iosHint = iosInstallHint();
    if (iosHint) wrap.appendChild(iosHint);

    /* aviso de descarga */
    const ph = phaseNow();
    if (ph.volume !== 1) {
      wrap.appendChild(el('div', { class: 'banner warn' },
        el('b', { text: 'Semana de descarga. ' }),
        el('span', { text: 'Las series de hoy están a la mitad (' + Math.round(ph.volume * 100) + ' %). La carga se mantiene y el RIR objetivo sube a ' + ph.rir + '. ' + ph.note })
      ));
    }
    if (L.modifier || L.setDelta) {
      const bits = [];
      if (L.modifier) bits.push('carga ' + L.modifier + ' %');
      if (L.setDelta) bits.push(L.setDelta + ' series');
      wrap.appendChild(el('div', { class: 'banner' },
        el('b', { text: 'Sesión ajustada: ' + bits.join(' y ') + '. ' }),
        el('span', { text: 'Por cómo llegas hoy o por el ciclo. El programa y la carga base no cambian.' }),
        el('button', { class: 'btn sm ghost', text: 'quitar ajuste', onclick: () => { L.modifier = 0; L.setDelta = 0; save(); render(); } })
      ));
    }

    /* preparación */
    wrap.appendChild(readinessCard(date, L));
    const cyc = cycleCard(date, L);
    if (cyc) wrap.appendChild(cyc);

    if (phaseNow().id === 'cal') {
      wrap.appendChild(el('div', { class: 'banner good' },
        el('b', { text: 'Semana 1: calibración. ' }),
        el('span', { text: 'Deja 3 repeticiones en reserva y no busques récords. Las cargas de partida son una sugerencia calculada sobre tu peso: ajústalas en la primera serie y quedarán fijadas.' })
      ));
    }

    /* ejercicios */
    const list = el('div', {});
    if (!day.slots.length) {
      list.appendChild(el('div', { class: 'empty', text: 'Esta sesión no tiene ejercicios. Añádelos en la pestaña Programa.' }));
    }
    day.slots.forEach((slot, idx) => list.appendChild(exerciseCard(date, day, slot, idx, L)));
    wrap.appendChild(list);

    /* progreso + acciones */
    const done = countDoneSets(L);
    const totalSets = day.slots.reduce((a, s) => a + (s.optional && !L.optional[idxOfSlot(day, s)] ? 0 : adjustedSets(s, L)), 0);
    const foot = el('div', { class: 'card' });
    const line = el('div', { class: 'row between' });
    line.appendChild(el('div', { class: 'row', style: { gap: '10px' } },
      el('b', { text: done + ' / ' + totalSets + ' series registradas' }),
      el('span', { class: 'muted tiny', id: 'st-done', text: '' })
    ));
    line.appendChild(el('div', { class: 'row tight' },
      el('button', { class: 'btn sm', text: 'Hoy está muy pesado', onclick: () => heavyDay(L) }),
      el('button', { class: 'btn primary', text: 'Terminar sesión', onclick: () => finishSession(date, day, L) })
    ));
    foot.appendChild(line);
    wrap.appendChild(foot);

    return wrap;
  }

  function idxOfSlot(day, slot) { return day.slots.indexOf(slot); }

  function countDoneSets(L) {
    let n = 0;
    Object.keys(L.entries || {}).forEach(k => {
      (L.entries[k].sets || []).forEach(s => { if (s && s.done) n++; });
    });
    return n;
  }

  function restCard(date, L) {
    const card = el('div', { class: 'card' });
    card.appendChild(el('p', { class: 'hint', text: 'Hoy no hay sesión de tren. Si quieres adelantar o mover el plan, elige una sesión:' }));
    const row = el('div', { class: 'row' });
    P.days.forEach(d => row.appendChild(el('button', {
      class: 'btn sm', text: d.name,
      onclick: () => { L.sessionId = d.id; save(); logFor(date, d.id); render(); }
    })));
    card.appendChild(row);
    const next = P.days.slice().sort((a, b) => ((a.weekday - weekdayOf(date) + 7) % 7) - ((b.weekday - weekdayOf(date) + 7) % 7))[0];
    if (next) {
      card.appendChild(el('hr', { class: 'sep' }));
      card.appendChild(el('p', { class: 'hint', html: 'Siguiente sesión: <b>' + next.name + '</b> · ' + CE.weekdayName(next.weekday) + ' · ' + next.focus }));
    }
    return card;
  }

  function readinessCard(date, L) {
    const card = el('div', { class: 'card tight' });
    const r = L.readiness;
    const line = el('div', { class: 'row between' });
    if (r && typeof r.score === 'number') {
      const color = r.light === 'green' ? 'green' : r.light === 'amber' ? 'amber' : 'red';
      line.appendChild(el('div', { class: 'row' },
        el('span', { class: 'chip ' + color, text: 'Preparación ' + r.score + '/100' }),
        el('span', { class: 'tiny muted', text: r.light === 'green' ? 'verde' : r.light === 'amber' ? 'ámbar' : 'rojo' })
      ));
      line.appendChild(el('button', { class: 'btn sm ghost', text: 'repetir', onclick: () => openReadiness(date, L) }));
      card.appendChild(line);
      card.appendChild(el('p', { class: 'hint', style: { margin: '8px 0 0' }, text: r.advice }));
    } else {
      line.appendChild(el('span', { class: 'muted', html: '<b>¿Cómo llegas hoy?</b> El cuestionario ajusta la sesión: en déficit la preparación manda más que el plan escrito.' }));
      line.appendChild(el('button', { class: 'btn sm', text: 'Responder', onclick: () => openReadiness(date, L) }));
      card.appendChild(line);
    }
    return card;
  }

  function cycleCard(date, L) {
    if (!S.cycle || !S.cycle.enabled) return null;
    const info = CE.cycleInfo(S.cycle, date);
    if (!info) return null;
    const check = L.cycle || {};
    const adj = CE.cycleAdjustment(info, check, L.readiness);
    const card = el('div', { class: 'card tight' });

    const head = el('div', { class: 'row between' });
    head.appendChild(el('div', { class: 'row' },
      el('span', { class: 'chip' + (info.phase === 'menstrual' ? ' red' : '') , text: 'Día ' + info.day + ' · ' + CE.CYCLE_PHASE_LABEL[info.phase] }),
      info.daysToNext <= 3 ? el('span', { class: 'tiny muted', text: 'próximo periodo en ' + info.daysToNext + ' días' }) : null
    ));
    card.appendChild(head);

    if (info.day <= S.cycle.periodLength + 2 || L.cycle) {
      card.appendChild(el('p', { class: 'hint', style: { margin: '8px 0 6px' }, text: '¿Cómo va la fuerza hoy? Con esto se ajusta la sesión, no el programa.' }));
      const row = el('div', { class: 'row tight' });
      [['Normal', 0], ['Algo baja', 1], ['Muy baja', 2]].forEach(([label, v]) => {
        row.appendChild(el('button', {
          class: 'btn sm' + (check.strength === v ? ' primary' : ''),
          text: label,
          onclick: () => setCycleCheck(date, L, { strength: check.strength === v ? undefined : v })
        }));
      });
      card.appendChild(row);
      const row2 = el('div', { class: 'row tight', style: { marginTop: '8px' } });
      row2.appendChild(el('button', {
        class: 'btn sm' + (check.pain ? ' primary' : ' ghost'), text: 'Dolor / malestar',
        onclick: () => setCycleCheck(date, L, { pain: !check.pain })
      }));
      row2.appendChild(el('button', {
        class: 'btn sm' + (check.sleep === false ? ' primary' : ' ghost'), text: 'Dormí mal',
        onclick: () => setCycleCheck(date, L, { sleep: check.sleep === false ? true : false })
      }));
      card.appendChild(row2);
    }

    if (adj.active) {
      card.appendChild(el('div', { class: 'banner warn', style: { marginTop: '10px' } },
        el('b', { text: 'Sesión ajustada: ' + adj.loadPct + ' % y ' + (adj.setDelta < 0 ? adj.setDelta + ' series' : 'mismas series') + '. ' }),
        el('span', { text: adj.reasons.join(', ') + '. La carga base del bloque no cambia.' })
      ));
    } else if (L.cycle && typeof check.strength === 'number') {
      card.appendChild(el('div', { class: 'banner good', style: { marginTop: '10px' } }, el('span', { text: 'Sin ajuste: entrenas con el plan normal.' })));
    }
    return card;
  }

  function setCycleCheck(date, L, patch) {
    L.cycle = Object.assign({}, L.cycle, patch);
    const info = CE.cycleInfo(S.cycle, date);
    const adj = CE.cycleAdjustment(info, L.cycle, L.readiness);
    L.modifier = adj.loadPct;
    L.setDelta = adj.setDelta;
    Object.keys(L.entries || {}).forEach((exId) => {
      const e = L.entries[exId];
      const base = Math.round((S.loads[exId] || 0) * (1 + adj.loadPct / 100) * 2) / 2;
      (e.sets || []).forEach((st) => { if (!st.done) st.load = base; });
      e.load = base;
    });
    save(true); render();
    toast(adj.active ? 'Sesión ajustada al ' + (100 + adj.loadPct) + ' %' : 'Sin ajuste');
  }

  function exerciseCard(date, day, slot, idx, L) {
    const ex = CE.exOf(slot.ex, EX);
    const isOptionalOff = slot.optional && !L.optional[idx];
    const entry = entryFor(date, slot.ex, isOptionalOff ? null : slot);
    const advised = CE.advise({ ex: slot.ex, reps: slot.reps, rir: slot.rir }, logsBefore(date), S.loads, EX);
    const last = CE.lastEntryFor(logsBefore(date), slot.ex);
    const card = el('article', { class: 'ex' });

    /* cabecera */
    const head = el('div', { class: 'ex-head' });
    const title = el('div', { class: 'ex-title' });
    title.appendChild(el('b', {}, ex.name, slot.optional ? el('span', { class: 'pill opt', style: { marginLeft: '8px' }, text: 'opcional' }) : null));
    const nSets = adjustedSets(slot, L);
    title.appendChild(el('span', { class: 'spec', text: nSets + ' × ' + slot.reps[0] + '–' + slot.reps[1] + ' · RIR ' + slot.rir + ' · ' + fmtRest(slot.rest || ex.rest) + ' descanso' }));
    if (nSets !== slot.sets) title.appendChild(el('span', { class: 'pill', text: 'hoy ' + nSets + ' series' }));
    if (slot.flagged === 'sin-equipo') {
      title.appendChild(el('span', { class: 'pill', style: { borderColor: 'var(--amber)', color: 'var(--amber)' }, text: 'necesita ' + CE.requiredEquipment(ex).filter((t) => t !== 'peso_corporal').map((t) => ((CE.EQUIPMENT.filter((e) => e.id === t)[0] || {}).label || t).toLowerCase()).join(' o ') }));
    }
    if (last) {
      const sets = last.entry.sets.filter(s => s && s.reps);
      const maxLoad = Math.max.apply(null, sets.map(s => s.load || 0).concat([0]));
      title.appendChild(el('span', { class: 'prev', text: 'última vez (' + shortDate(last.date) + '): ' + kg(maxLoad) + ' kg · ' + sets.map(s => s.reps).join('/') }));
    }
    head.appendChild(title);

    if (!isOptionalOff) {
      const tools = el('div', { class: 'row tight' });
      const loadBox = el('div', { class: 'stepper' });
      const val = el('span', { class: 'val', id: 'load-' + idx, text: kg(entry.load || 0) });
      loadBox.appendChild(el('button', { text: '−', 'aria-label': 'bajar carga', onclick: () => bumpLoad(date, slot, entry, -1 * (ex.step || 2.5)) }));
      loadBox.appendChild(val);
      loadBox.appendChild(el('button', { text: '+', 'aria-label': 'subir carga', onclick: () => bumpLoad(date, slot, entry, (ex.step || 2.5)) }));
      tools.appendChild(loadBox);
      tools.appendChild(el('span', { class: 'tiny muted', text: 'kg' }));
      if (!last) tools.appendChild(el('span', { class: 'pill', title: 'Calculada desde tu peso corporal; se corrige en la primera serie', text: 'estimada' }));
      head.appendChild(tools);
    } else {
      head.appendChild(el('button', { class: 'btn sm', text: 'Incluir hoy', onclick: () => { L.optional[idx] = true; save(); render(); } }));
    }
    card.appendChild(head);

    if (isOptionalOff) {
      card.appendChild(el('div', { class: 'ex-body' }, el('span', { class: 'tiny muted', text: 'Fuera del cómputo hasta que la actives. Es la palanca barata para subir cuádriceps.' })));
      return card;
    }

    const body = el('div', { class: 'ex-body' });
    body.appendChild(el('div', { class: 'set-labels' },
      el('span', { text: '#' }), el('span', { text: 'kg' }), el('span', { text: 'reps' }), el('span', { text: 'rir' }), el('span', { text: '' })
    ));
    const sets = el('div', { class: 'sets' });
    for (let i = 0; i < nSets; i++) {
      const st = entry.sets[i] || (entry.sets[i] = {});
      const row = el('div', { class: 'set-row' });
      row.appendChild(el('span', { class: 'idx', text: String(i + 1) }));
      row.appendChild(el('input', {
        type: 'number', inputmode: 'decimal', step: 'any', min: '0', value: st.load != null ? st.load : (entry.load || ''), placeholder: 'kg',
        'aria-label': 'kilos serie ' + (i + 1),
        oninput: (ev) => { st.load = num(ev.target.value); if (i === 0) entry.load = st.load; touch(date); }
      }));
      row.appendChild(el('input', {
        type: 'number', inputmode: 'numeric', step: '1', min: '0', value: st.reps != null ? st.reps : '', placeholder: slot.reps[0] + '–' + slot.reps[1],
        'aria-label': 'repeticiones serie ' + (i + 1),
        oninput: (ev) => { st.reps = ev.target.value === '' ? undefined : num(ev.target.value); touch(date); }
      }));
      row.appendChild(el('input', {
        type: 'number', inputmode: 'decimal', step: '0.5', min: '0', max: '5', value: st.rir != null ? st.rir : '', placeholder: String(slot.rir),
        'aria-label': 'RIR serie ' + (i + 1),
        oninput: (ev) => { st.rir = ev.target.value === '' ? undefined : num(ev.target.value); touch(date); }
      }));
      row.appendChild(el('button', {
        class: 'check', 'aria-checked': st.done ? 'true' : 'false', title: 'Marcar serie',
        text: st.done ? '✓' : '',
        onclick: () => toggleSet(date, day, slot, entry, i, st)
      }));
      sets.appendChild(row);
    }
    body.appendChild(sets);

    /* consejo de progresión */
    if (advised && advised.action !== 'calibrar') {
      const cls = advised.action === 'subir' ? 'up' : advised.action === 'bajar' ? 'down' : '';
      const box = el('div', { class: 'advice ' + cls });
      box.appendChild(el('span', { class: 'ico', text: advised.action === 'subir' ? '↑' : advised.action === 'bajar' ? '↓' : '=' }));
      const txt = el('div', {});
      txt.appendChild(el('div', { html: '<b>' + adviseTitle(advised) + '</b> ' + esc(advised.reason) }));
      txt.appendChild(el('div', { class: 'tiny muted', text: advised.condition }));
      box.appendChild(txt);
      if (advised.action === 'subir' && Math.abs(advised.nextLoad - (entry.load || 0)) > 0.01) {
        box.appendChild(el('button', {
          class: 'btn sm', text: 'usar ' + kg(advised.nextLoad) + ' kg',
          onclick: () => { entry.load = advised.nextLoad; entry.sets.forEach(s => { if (!s.done) s.load = advised.nextLoad; }); save(); render(); }
        }));
      }
      body.appendChild(box);
    }

    /* pie */
    const foot = el('div', { class: 'ex-foot' });
    const left = el('div', { class: 'load-edit' });
    if (Math.abs((entry.load || 0) - (S.loads[slot.ex] || 0)) > 0.01) {
      left.appendChild(el('span', { text: 'base del bloque: ' + kg(S.loads[slot.ex] || 0) + ' kg' }));
      left.appendChild(el('button', {
        class: 'btn sm ghost', text: 'fijar como base',
        onclick: () => { S.loads[slot.ex] = entry.load; toast('Carga base actualizada a ' + kg(entry.load) + ' kg'); save(); render(); }
      }));
    } else {
      left.appendChild(el('span', { text: 'carga base del bloque' }));
    }
    foot.appendChild(left);
    if (slot.optional) {
      foot.appendChild(el('button', {
        class: 'btn sm ghost', text: 'quitar de hoy',
        onclick: () => { L.optional[idx] = false; save(); render(); }
      }));
    }
    body.appendChild(foot);
    card.appendChild(body);
    if (entry.sets.some(s => s.done)) card.classList.add('is-done');
    return card;
  }

  function adviseTitle(a) {
    if (a.action === 'subir') return 'Sube a ' + kg(a.nextLoad) + ' kg.';
    if (a.action === 'bajar') return 'Baja a ' + kg(a.nextLoad) + ' kg.';
    if (a.action === 'calibrar') return 'Calibra.';
    return 'Mantén ' + kg(a.nextLoad) + ' kg.';
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function fmtRest(sec) { const m = Math.floor((sec || 0) / 60), s = (sec || 0) % 60; return m + ':' + String(s).padStart(2, '0'); }

  function bumpLoad(date, slot, entry, delta) {
    const ex = CE.exOf(slot.ex, EX);
    const cur = entry.load || S.loads[slot.ex] || 0;
    entry.load = Math.max(ex.step || 2.5, Math.round((cur + delta) / (ex.step || 2.5)) * (ex.step || 2.5));
    entry.sets.forEach(s => { if (!s.done) s.load = entry.load; });
    save();
    render();
  }

  const touch = debounce((date) => { save(); }, 300);

  function toggleSet(date, day, slot, entry, i, st) {
    if (!st.done) {
      if (st.load == null || st.load === 0) st.load = entry.load || S.loads[slot.ex] || 0;
      if (st.reps == null || st.reps === 0) st.reps = slot.reps[0];
      if (st.rir == null) st.rir = slot.rir;
      st.done = true;
      startTimer(slot.rest || CE.exOf(slot.ex, EX).rest || 90, CE.exOf(slot.ex, EX).name);
    } else {
      st.done = false;
    }
    save(); render();
  }

  function heavyDay(L) {
    L.modifier = Math.round((L.modifier || 0) - 5);
    Object.keys(L.entries || {}).forEach(k => {
      const e = L.entries[k];
      e.sets.forEach(s => { if (!s.done) s.load = Math.round((S.loads[k] || 0) * (1 + L.modifier / 100) * 2) / 2; });
    });
    save(); render();
    toast('Sesión al ' + L.modifier + ' %. La carga base se mantiene.');
  }

  /* ------------------------------------------------------------------ *
   * temporizador
   * ------------------------------------------------------------------ */
  let TIMER = { end: 0, total: 0, label: '', on: false };
  let timerRAF = null;
  let audioCtx = null;

  function beep() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      [0, 0.18, 0.36].forEach((t, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = i === 2 ? 1040 : 880;
        o.type = 'sine';
        g.gain.setValueAtTime(0, now + t);
        g.gain.linearRampToValueAtTime(0.12, now + t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.14);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(now + t); o.stop(now + t + 0.16);
      });
    } catch (e) { /* sin audio */ }
  }

  function startTimer(seconds, label) {
    TIMER = { end: Date.now() + seconds * 1000, total: seconds, label: label || 'descanso', on: true };
    const box = $('#timer');
    if (box) box.classList.remove('hidden', 'done');
    tick();
  }
  function stopTimer() {
    TIMER.on = false;
    const box = $('#timer');
    if (box) box.classList.add('hidden');
  }
  function tick() {
    if (!TIMER.on) return;
    const left = Math.max(0, Math.round((TIMER.end - Date.now()) / 1000));
    const box = $('#timer');
    if (!box) return;
    const t = $('#timerTime');
    if (t) t.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    const lab = $('#timerLabel');
    if (lab) lab.textContent = TIMER.label;
    if (left <= 0) {
      box.classList.add('done');
      beep();
      TIMER.on = false;
      return;
    }
    timerRAF = setTimeout(tick, 250);
  }

  /* ------------------------------------------------------------------ *
   * preparación (modal)
   * ------------------------------------------------------------------ */
  const READ_LABELS = ['Fatal', 'Mal', 'Regular', 'Bien', 'Muy bien'];

  function openReadiness(date, L) {
    const current = L.readiness && L.readiness.answers ? L.readiness.answers : {};
    const answers = Object.assign({}, current);
    const body = el('div', {});
    CE.READINESS_ITEMS.forEach(it => {
      const qi = el('div', { class: 'qi' });
      const q = el('div', { class: 'q' });
      q.appendChild(el('b', { text: it.label }));
      q.appendChild(el('span', { text: it.hint }));
      qi.appendChild(q);
      const scale = el('div', { class: 'scale' });
      for (let v = 1; v <= 5; v++) {
        scale.appendChild(el('button', {
          type: 'button', text: String(v), 'aria-pressed': answers[it.id] === v ? 'true' : 'false',
          onclick: (ev) => {
            answers[it.id] = v;
            $$('button', scale).forEach((b, i) => b.setAttribute('aria-pressed', i + 1 === v ? 'true' : 'false'));
            const preview = CE.readiness(Object.keys(answers).reduce((o, k) => { o[k] = (answers[k] - 1) * 2.5; return o; }, {}));
            const lab = $('#readPreview');
            if (lab) {
              lab.textContent = preview.score === null ? 'responde todo para ver el resultado' : preview.score + '/100 · ' + (preview.light === 'green' ? 'verde' : preview.light === 'amber' ? 'ámbar' : 'rojo');
              lab.className = 'chip ' + (preview.light === 'none' ? '' : preview.light);
            }
          }
        }));
      }
      qi.appendChild(scale);
      body.appendChild(qi);
    });
    body.appendChild(el('div', { class: 'row', style: { marginTop: '12px' } }, el('span', { class: 'chip', id: 'readPreview', text: 'responde todo para ver el resultado' })));
    body.appendChild(el('p', { class: 'tiny muted', style: { marginTop: '8px' }, text: '1 = muy mal, 5 = muy bien. En las preguntas de dolor, estrés, agujetas y dureza, 5 es lo peor. La puntuación va de 0 a 100.' }));

    openSheet('Cuestionario de preparación', 'Sueño, energía, estrés, dolor y técnica. En un déficit agresivo esto es más fiable que el plan escrito.', body, [
      { label: 'Cancelar', ghost: true, onClick: closeSheet },
      {
        label: 'Guardar', primary: true, onClick: () => {
          const scaled = {};
          Object.keys(answers).forEach(k => { scaled[k] = (answers[k] - 1) * 2.5; });
          const r = CE.readiness(scaled);
          r.answers = answers;
          L.readiness = r;
          /* aplica el ajuste del día: carga y series */
          const adj = CE.cycleAdjustment(null, L.cycle || {}, r);
          L.modifier = adj.loadPct;
          L.setDelta = Math.min(L.setDelta || 0, adj.setDelta);
          S.logs[date] = L;
          save(); closeSheet(); render();
          toast('Preparación: ' + r.score + '/100');
        }
      }
    ]);
  }

  /* ------------------------------------------------------------------ *
   * modales
   * ------------------------------------------------------------------ */
  let SHEET_ONCLOSE = null;
  function openSheet(title, sub, body, actions) {
    const m = $('#modal');
    const sheet = $('#sheet');
    clear(sheet);
    sheet.appendChild(el('h2', { text: title }));
    if (sub) sheet.appendChild(el('div', { class: 'sub', text: sub }));
    sheet.appendChild(body);
    const act = el('div', { class: 'sheet-actions' });
    (actions || []).forEach(a => act.appendChild(el('button', {
      class: 'btn ' + (a.primary ? 'primary' : a.ghost ? 'ghost' : ''), text: a.label, onclick: a.onClick
    })));
    sheet.appendChild(act);
    m.hidden = false;
    SHEET_ONCLOSE = () => { m.hidden = true; };
    const first = sheet.querySelector('button, input, select');
    if (first) setTimeout(() => first.focus(), 50);
  }
  function closeSheet() { const m = $('#modal'); if (m) m.hidden = true; }

  /* ------------------------------------------------------------------ *
   * terminar sesión
   * ------------------------------------------------------------------ */
  function finishSession(date, day, L) {
    const sets = [], byEx = {};
    Object.keys(L.entries || {}).forEach(exId => {
      const e = L.entries[exId];
      const done = (e.sets || []).filter(s => s && s.done);
      if (!done.length) return;
      byEx[exId] = done;
      done.forEach(s => sets.push(s));
    });
    if (!sets.length) { toast('Aún no has registrado ninguna serie.'); return; }

    const tonnage = sets.reduce((a, s) => a + (s.reps || 0) * (s.load || 0), 0);
    const rir = sets.filter(s => typeof s.rir === 'number').map(s => s.rir);
    const avgRir = rir.length ? rir.reduce((a, b) => a + b, 0) / rir.length : null;

    const body = el('div', {});
    const stats = el('div', { class: 'grid three' });
    [['Series', String(sets.length)], ['Tonelaje', tn(tonnage)], ['RIR medio', avgRir === null ? '—' : nf.format(Math.round(avgRir * 10) / 10)]].forEach(x => {
      stats.appendChild(el('div', { class: 'stat' }, el('span', { class: 'v', text: x[1] }), el('span', { class: 'k', text: x[0] })));
    });
    body.appendChild(stats);

    const rows = [];
    Object.keys(byEx).forEach(exId => {
      const slot = (day.slots || []).filter(s => s.ex === exId)[0] || { ex: exId, reps: [8, 10], rir: 2 };
      const adv = CE.advise(slot, S.logs, S.loads, EX);
      rows.push({ exId: exId, name: CE.exOf(exId, EX).name, adv: adv });
    });
    const tbl = el('table', { class: 'tbl' });
    tbl.appendChild(el('thead', {}, el('tr', {},
      el('th', { text: 'Ejercicio' }), el('th', { class: 'r', text: 'Ahora' }), el('th', { class: 'r', text: 'Próxima' }), el('th', { text: 'Por qué' })
    )));
    const tb = el('tbody');
    rows.forEach(r => {
      tb.appendChild(el('tr', {},
        el('td', { text: r.name }),
        el('td', { class: 'r', text: kg(r.adv.nextLoad) + ' kg' }),
        el('td', { class: 'r' }, el('b', { text: r.adv.action === 'subir' ? '+' + r.adv.pct + '%' : r.adv.action === 'bajar' ? '−5%' : '=' })),
        el('td', { class: 'tiny muted', text: r.adv.action === 'subir' ? 'tocó el techo del rango' : r.adv.action === 'bajar' ? 'se pasó de RIR' : 'suma repeticiones' })
      ));
    });
    tbl.appendChild(tb);
    body.appendChild(el('div', { style: { marginTop: '14px' } }, tbl));

    openSheet('Sesión terminada', day.name + ' · ' + sets.length + ' series · ' + tn(tonnage), body, [
      { label: 'Seguir editando', ghost: true, onClick: closeSheet },
      {
        label: 'Guardar y aplicar cargas', primary: true, onClick: () => {
          Object.keys(byEx).forEach(exId => {
            const slot = (day.slots || []).filter(s => s.ex === exId)[0] || { ex: exId, reps: [8, 10], rir: 2 };
            const adv = CE.advise(slot, S.logs, S.loads, EX);
            if (adv.action === 'subir' || adv.action === 'bajar') S.loads[exId] = adv.nextLoad;
            else if (adv.nextLoad) S.loads[exId] = adv.nextLoad;
          });
          L.completed = true;
          save(true); closeSheet(); render();
          toast('Sesión guardada. Cargas actualizadas.');
        }
      }
    ]);
  }


  /* ------------------------------------------------------------------ *
   * SEMANA
   * ------------------------------------------------------------------ */
  let PENDING_FREQ = null;

  function viewWeek() {
    const baseMonday = CE.mondayOf(todayISO());
    const ws = CE.addDays(baseMonday, WEEK_OFFSET * 7);
    const dates = [];
    for (let i = 0; i < 7; i++) dates.push(CE.toISODate(CE.addDays(ws, i)));
    const weekNo = CE.weekNumber(S.block.start, dates[0]);
    const ph = CE.phaseForWeek(weekNo);
    const wrap = el('div', { class: 'stack' });

    /* cabecera con navegación */
    const head = el('div', { class: 'view-head' });
    const hl = el('div', {});
    hl.appendChild(el('div', { class: 'kicker', text: 'Semana ' + weekNo + ' de ' + S.block.weeks + ' · ' + ph.name }));
    hl.appendChild(el('h1', { text: shortDate(dates[0]) + ' – ' + shortDate(dates[6]) }));
    hl.appendChild(el('p', { text: ph.note }));
    head.appendChild(hl);
    head.appendChild(el('div', { class: 'row tight' },
      el('button', { class: 'btn sm', text: '←', 'aria-label': 'semana anterior', onclick: () => { WEEK_OFFSET--; render(); } }),
      el('button', { class: 'btn sm', text: 'Hoy', onclick: () => { WEEK_OFFSET = 0; render(); } }),
      el('button', { class: 'btn sm', text: '→', 'aria-label': 'semana siguiente', onclick: () => { WEEK_OFFSET++; render(); } })
    ));
    wrap.appendChild(head);

    /* semana: días */
    const days = el('div', {});
    dates.forEach(d => {
      const day = sessionDay(d);
      const L = S.logs[d];
      const dow = CE.weekdayName(weekdayOf(d));
      const isToday = d === todayISO();
      const row = el('div', { class: 'day-row' + (isToday ? ' is-today' : '') + (!day ? ' is-rest' : '') });
      row.appendChild(el('div', { class: 'dow', text: dow + ' ' + CE.parseDate(d).getDate() }));
      const what = el('div', { class: 'what' });
      if (day) {
        what.appendChild(el('b', { text: day.name }));
        what.appendChild(el('span', { text: CE.countSets({ days: [day] }) + ' series · ' + day.focus }));
      } else {
        what.appendChild(el('b', { text: 'Descanso' }));
        what.appendChild(el('span', { text: 'Sin sesión programada' }));
      }
      row.appendChild(what);
      let status = 'pendiente';
      if (!day) status = '—';
      else if (L && L.completed) status = 'hecha';
      else if (L && CE.logSets(L) > 0) status = 'en curso';
      row.appendChild(el('button', {
        class: 'btn sm ' + (status === 'hecha' ? 'ghost' : ''),
        text: status === 'hecha' ? '✓ hecha' : status === 'en curso' ? 'seguir' : day ? 'abrir' : '—',
        disabled: !day,
        onclick: () => { PICKED_DATE = d; TAB = 'hoy'; render(); }
      }));
      days.appendChild(row);
      if (S.cardio && S.cardio.hiit > 0 && weekdayOf(d) === S.cardio.day) days.appendChild(cardioRow(d));
    });
    wrap.appendChild(days);

    /* resumen de la semana */
    let plannedSets = 0, plannedTon = 0, doneSets = 0, realTon = 0, readiness = [];
    dates.forEach(d => {
      const day = sessionDay(d);
      if (day) {
        const st = CE.sessionStats(day, S.loads, EX);
        plannedSets += st.sets; plannedTon += st.tonnage;
      }
      const L = S.logs[d];
      if (L) {
        doneSets += CE.logSets(L); realTon += CE.logTonnage(L);
        if (L.readiness && typeof L.readiness.score === 'number') readiness.push(L.readiness.score);
      }
    });
    const avgRead = readiness.length ? Math.round(readiness.reduce((a, b) => a + b, 0) / readiness.length) : null;
    const cards = el('div', { class: 'grid three' });
    cards.appendChild(statCard(doneSets + ' / ' + plannedSets, 'series registradas', plannedSets ? Math.round(doneSets / plannedSets * 100) + ' % del plan' : ''));
    cards.appendChild(statCard(tn(realTon), 'tonelaje real', 'previsto ' + tn(plannedTon)));
    cards.appendChild(statCard(avgRead === null ? '—' : String(avgRead), 'preparación media', avgRead === null ? 'sin datos' : avgRead < 55 ? 'ojo: descarga' : avgRead < 75 ? 'ámbar' : 'verde'));
    wrap.appendChild(cards);

    /* volumen de la semana */
    const volCard = el('div', { class: 'card' });
    volCard.appendChild(el('div', { class: 'card-title' },
      el('h2', { text: 'Volumen semanal' }),
      el('span', { class: 'meta', text: CE.countSets(P) + ' series duras · ' + P.days.length + ' días' })
    ));
    const rows = CE.volumeRows(CE.volumeOf(P, EX));
    const max = Math.max.apply(null, rows.map(r => Math.max(r.range[1] * 1.15, r.total * 1.1)).concat([1]));
    rows.forEach(r => volCard.appendChild(volRow(r, max)));
    volCard.appendChild(el('p', { class: 'tiny muted', style: { marginTop: '10px' }, text: 'Series efectivas = directas (1) + indirectas (0,5). La banda verde es el rango del documento. El glúteo va al extremo alto a propósito; pecho y cuádriceps, al bajo.' }));
    wrap.appendChild(volCard);

    /* frecuencia */
    wrap.appendChild(frequencyCard());
    return wrap;
  }

  function cardioRow(date) {
    const pr = CE.CARDIO_PROTOCOLS[(S.cardio && S.cardio.protocol) || 'hiit_10x1'] || CE.CARDIO_PROTOCOLS.hiit_10x1;
    const done = !!(S.cardioLog && S.cardioLog[date] && S.cardioLog[date].done);
    const row = el('div', { class: 'day-row cardio' + (done ? ' is-done' : '') });
    row.appendChild(el('div', { class: 'dow', text: 'Cardio' }));
    const what = el('div', { class: 'what' });
    what.appendChild(el('b', { text: pr.label }));
    what.appendChild(el('span', { text: pr.minutes + ' min · ' + pr.rpe + ' · ' + (done ? 'hecho' : 'pendiente') }));
    row.appendChild(what);
    row.appendChild(el('button', {
      class: 'btn sm' + (done ? ' ghost' : ''), text: done ? '✓ hecho' : 'marcar',
      onclick: () => {
        S.cardioLog = S.cardioLog || {};
        S.cardioLog[date] = { done: !done, minutes: pr.minutes };
        save(true); render();
        toast(done ? 'Cardio desmarcado' : 'Cardio marcado como hecho');
      }
    }));
    return row;
  }

  function statCard(v, k, d) {
    return el('div', { class: 'card tight' },
      el('div', { class: 'stat' }, el('span', { class: 'v', text: v }), el('span', { class: 'k', text: k }), el('span', { class: 'd', text: d || '' }))
    );
  }

  function volRow(r, max) {
    const lo = r.range[0], hi = r.range[1];
    const row = el('div', { class: 'vol-row' });
    row.appendChild(el('div', { class: 'name' }, r.label, el('small', { text: ' ' + lo + '–' + hi })));
    const track = el('div', { class: 'vol-track' });
    track.appendChild(el('div', { class: 'vol-band', style: { left: (lo / max * 100) + '%', width: ((hi - lo) / max * 100) + '%' } }));
    track.appendChild(el('div', { class: 'vol-fill ' + r.status, style: { width: Math.min(100, (r.total / max * 100)) + '%' } }));
    row.appendChild(track);
    row.appendChild(el('div', { class: 'val ' + r.status, text: String(r.total) }));
    return row;
  }

  function frequencyCard() {
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-title' },
      el('h2', { text: 'Días disponibles esta semana' }),
      el('span', { class: 'meta', text: 'ahora: ' + S.block.freq + ' días' })
    ));
    card.appendChild(el('p', { class: 'hint', text: 'Si esta semana no puedes ir 4 veces, baja a 3 o 2. El motor recalcula series, tonelaje y duración: el glúteo se protege, el resto se reparte.' }));
    const seg = el('div', { class: 'seg' });
    [2, 3, 4, 5, 6].forEach(n => seg.appendChild(el('button', {
      type: 'button', text: n + ' d', 'aria-pressed': (PENDING_FREQ || S.block.freq) === n ? 'true' : 'false',
      onclick: () => { PENDING_FREQ = n; render(); }
    })));
    card.appendChild(el('div', { class: 'row', style: { marginTop: '10px' } }, seg));

    const n = PENDING_FREQ || S.block.freq;
    if (n !== S.block.freq) {
      const cand = CE.buildProgram({ n: n, exMap: EX, loads: S.loads, swaps: S.swaps, equipment: S.equipment, prefs: S.prefs });
      const diff = CE.diffPrograms(S.program, cand, EX, S.loads);
      card.appendChild(el('hr', { class: 'sep' }));
      card.appendChild(el('h3', { text: 'Pasar a ' + n + ' días: esto es lo que cambia' }));

      const tbl = el('table', { class: 'tbl' });
      tbl.appendChild(el('thead', {}, el('tr', {},
        el('th', { text: 'Músculo' }), el('th', { class: 'c', text: 'Ahora' }), el('th', { class: 'c', text: n + ' días' }), el('th', { class: 'c', text: 'Δ' })
      )));
      const tb = el('tbody');
      diff.muscles.forEach(m => {
        const cls = m.delta < -0.6 ? 'amber' : m.delta > 0.6 ? 'green' : 'muted';
        tb.appendChild(el('tr', {},
          el('td', { text: m.label }),
          el('td', { class: 'c', text: String(m.before) }),
          el('td', { class: 'c', text: String(m.after) }),
          el('td', { class: 'c ' + cls, text: m.delta === 0 ? '—' : (m.delta > 0 ? '+' : '−') + kg(Math.abs(m.delta)) })
        ));
      });
      tbl.appendChild(tb);
      card.appendChild(el('div', { class: 'scroll-x' }, tbl));

      const totals = el('div', { class: 'grid three', style: { marginTop: '12px' } });
      totals.appendChild(el('div', { class: 'stat' }, el('span', { class: 'v', text: String(diff.sets.after) }), el('span', { class: 'k', text: 'series/semana' }), el('span', { class: 'd', text: 'antes ' + diff.sets.before })));
      totals.appendChild(el('div', { class: 'stat' }, el('span', { class: 'v', text: tn(diff.tonnage.after) }), el('span', { class: 'k', text: 'tonelaje previsto' }), el('span', { class: 'd', text: 'antes ' + tn(diff.tonnage.before) })));
      totals.appendChild(el('div', { class: 'stat' }, el('span', { class: 'v', text: String(diff.minutes.after) + '′' }), el('span', { class: 'k', text: 'total semanal' }), el('span', { class: 'd', text: 'por sesión ' + Math.round(diff.minutes.after / n) + '′' })));
      card.appendChild(totals);

      const lows = diff.muscles.filter(m => m.after < (CE.RANGE[m.id] ? CE.RANGE[m.id][0] : 0));
      if (lows.length) {
        card.appendChild(el('div', { class: 'banner warn', style: { marginTop: '12px' } },
          el('b', { text: 'Coste de bajar a ' + n + ' días: ' }),
          el('span', { text: lows.map(m => m.label.toLowerCase() + ' ' + m.after + ' series').join(', ') + ' quedan por debajo de su rango. Se mantiene el estímulo principal, no todo el volumen.' })
        ));
      }
      if (n <= 2) {
        card.appendChild(el('div', { class: 'banner', style: { marginTop: '8px' } },
          el('b', { text: 'Con 2 días es mantenimiento. ' }),
          el('span', { text: 'Pecho, espalda y brazos caen cerca de la mitad. Para conservar músculo en déficit, 3 días es el mínimo cómodo.' })
        ));
      }
      if (n >= 5) {
        card.appendChild(el('div', { class: 'banner', style: { marginTop: '8px' } },
          el('b', { text: 'Más días no es más estímulo. ' }),
          el('span', { text: 'En déficit, el recurso escaso es la recuperación. Las sesiones extra son cortas y de prioridad, no más volumen bruto.' })
        ));
      }

      const act = el('div', { class: 'row', style: { marginTop: '14px' } });
      act.appendChild(el('button', { class: 'btn primary', text: 'Reajustar a ' + n + ' días', onclick: () => applyFrequency(n) }));
      act.appendChild(el('button', { class: 'btn ghost', text: 'cancelar', onclick: () => { PENDING_FREQ = null; render(); } }));
      card.appendChild(act);
    } else {
      card.appendChild(el('p', { class: 'tiny muted', style: { marginTop: '10px' }, text: 'Cambia de día y verás la previsión antes de aplicar nada. Tus cargas, tus ejercicios elegidos y tu historial se conservan; lo que se recalcula son las series.' }));
    }
    return card;
  }

  function applyFrequency(n) {
    const cand = CE.buildProgram({ n: n, exMap: EX, loads: S.loads, swaps: S.swaps, equipment: S.equipment, prefs: S.prefs });
    S.program = cand;
    S.block.freq = n;
    PENDING_FREQ = null;
    save(true);
    render();
    toast('Plan reajustado a ' + n + ' días · ' + CE.countSets(cand) + ' series');
  }

  /* ------------------------------------------------------------------ *
   * PROGRAMA (edición)
   * ------------------------------------------------------------------ */
  function viewProgram() {
    const wrap = el('div', { class: 'stack' });
    const head = el('div', { class: 'view-head' });
    const hl = el('div', {});
    hl.appendChild(el('div', { class: 'kicker', text: 'Bloque · edición' }));
    hl.appendChild(el('h1', { text: 'Programa' }));
    hl.appendChild(el('p', { text: 'Cambia ejercicios, series, repeticiones, RIR o descanso. Todo se guarda y el volumen y el tonelaje se recalculan solos.' }));
    head.appendChild(hl);
    head.appendChild(el('div', { class: 'row tight' },
      el('button', { class: 'btn sm', text: 'Optimizar reparto', onclick: optimize }),
      el('button', { class: 'btn sm ghost', text: 'Ajustes', onclick: () => go('ajustes') })
    ));
    wrap.appendChild(head);

    const total = CE.countSets(S.program, true);
    const stats = CE.programStats(S.program, S.loads, EX);
    wrap.appendChild(el('div', { class: 'grid three' },
      statCard(String(total), 'series por semana', 'con opcionales'),
      statCard(tn(stats.tonnage), 'tonelaje previsto', 'rango ' + tn(stats.tonnageMin) + '–' + tn(stats.tonnageMax)),
      statCard(String(stats.minutes) + '′', 'tiempo semanal', Math.round(stats.minutes / S.program.days.length) + '′ por sesión')
    ));

    S.program.days.forEach((day, di) => {
      const card = el('div', { class: 'card' });
      const title = el('div', { class: 'card-title' },
        el('div', {}, el('h2', { text: day.name }), el('span', { class: 'meta', text: CE.weekdayName(day.weekday) + ' · ' + day.focus })),
        el('div', { class: 'row tight' },
          el('span', { class: 'chip', text: CE.countSets({ days: [day] }) + ' series · ' + CE.sessionMinutes(day, EX) + '′' }),
          el('button', { class: 'btn sm ghost', text: '+ ejercicio', onclick: () => pickExercise(day) })
        )
      );
      card.appendChild(title);
      day.slots.forEach((slot, si) => card.appendChild(slotEditor(day, slot, si)));
      wrap.appendChild(card);
    });

    wrap.appendChild(libraryCard());
    return wrap;
  }

  function slotEditor(day, slot, si) {
    const ex = CE.exOf(slot.ex, EX);
    const row = el('div', { class: 'slot-edit' });

    const sel = el('select', {
      'aria-label': 'ejercicio',
      onchange: (ev) => {
        const prev = slot.ex;
        slot.ex = ev.target.value;
        if (prev !== slot.ex) {
          S.swaps = S.swaps || {};
          const key = day.kind || day.id;
          S.swaps[key] = S.swaps[key] || {};
          S.swaps[key][prev] = slot.ex;
        }
        save(); render();
      }
    });
    const byPattern = {};
    Object.keys(EX).forEach(id => {
      const e = EX[id];
      const disponible = CE.isAvailable(e, S.equipment) || id === slot.ex;
      if (!disponible) return; // no ofrecer lo que no puede hacer
      byPattern[e.pattern] = byPattern[e.pattern] || [];
      byPattern[e.pattern].push({ id: id, name: e.name });
    });
    Object.keys(byPattern).sort().forEach(pat => {
      const g = el('optgroup', { label: PATTERN_LABEL[pat] || pat });
      byPattern[pat].sort((a, b) => a.name.localeCompare(b.name, 'es')).forEach(o => {
        g.appendChild(el('option', { value: o.id, text: o.name, selected: o.id === slot.ex ? true : null }));
      });
      sel.appendChild(g);
    });
    row.appendChild(sel);

    const st = el('div', { class: 'stepper' });
    st.appendChild(el('button', { text: '−', 'aria-label': 'menos series', onclick: () => { slot.sets = Math.max(1, slot.sets - 1); save(); render(); } }));
    st.appendChild(el('span', { class: 'val', text: String(slot.sets) }));
    st.appendChild(el('button', { text: '+', 'aria-label': 'más series', onclick: () => { slot.sets = Math.min(8, slot.sets + 1); save(); render(); } }));
    row.appendChild(st);

    const band = CE.repsBandFor(ex);
    const fuera = slot.reps[0] < band[0] || slot.reps[1] > band[1];
    if (fuera) row.appendChild(el('span', { class: 'tiny amber', style: { gridColumn: '1 / -1' }, text: 'sugerido para este tipo: ' + band[0] + '–' + band[1] + ' reps' }));
    const reps = el('div', { class: 'reps' });
    reps.appendChild(el('input', { type: 'number', min: '1', max: '40', value: slot.reps[0], 'aria-label': 'reps mínimo', onchange: (ev) => { slot.reps[0] = Math.max(1, num(ev.target.value)); save(); render(); } }));
    reps.appendChild(el('span', { class: 'muted', text: '–' }));
    reps.appendChild(el('input', { type: 'number', min: '1', max: '40', value: slot.reps[1], 'aria-label': 'reps máximo', onchange: (ev) => { slot.reps[1] = Math.max(slot.reps[0], num(ev.target.value)); save(); render(); } }));
    row.appendChild(reps);

    const rir = el('select', { 'aria-label': 'RIR', onchange: (ev) => { slot.rir = num(ev.target.value); save(); render(); } });
    [0, 1, 1.5, 2, 2.5, 3, 4].forEach(v => rir.appendChild(el('option', { value: v, text: 'RIR ' + v, selected: v === slot.rir ? true : null })));
    row.appendChild(rir);

    row.appendChild(el('input', { type: 'number', min: '0', step: '15', value: slot.rest || ex.rest, 'aria-label': 'descanso en segundos', title: 'descanso en segundos', onchange: (ev) => { slot.rest = num(ev.target.value); save(); render(); } }));

    if (slot.flagged === 'sin-equipo') {
      row.appendChild(el('div', { class: 'row', style: { gridColumn: '1 / -1', marginTop: '2px' } },
        el('span', { class: 'pill', style: { borderColor: 'var(--amber)', color: 'var(--amber)' }, text: 'no tienes el material: ' + CE.requiredEquipment(ex).filter((t) => t !== 'peso_corporal').map((t) => ((CE.EQUIPMENT.filter((e) => e.id === t)[0] || {}).label || t).toLowerCase()).join(' o ') })
      ));
    }
    const tools = el('div', { class: 'row tight', style: { gap: '2px' } });
    tools.appendChild(el('button', { class: 'btn icon ghost', text: '↑', title: 'subir', disabled: si === 0, onclick: () => { swapSlots(day, si, si - 1); } }));
    tools.appendChild(el('button', { class: 'btn icon ghost', text: '↓', title: 'bajar', disabled: si === day.slots.length - 1, onclick: () => { swapSlots(day, si, si + 1); } }));
    tools.appendChild(el('button', { class: 'btn icon ghost', text: '✕', title: 'quitar', onclick: () => { day.slots.splice(si, 1); save(); render(); toast('Ejercicio quitado'); } }));
    row.appendChild(tools);
    return row;
  }

  function swapSlots(day, a, b) {
    const t = day.slots[a]; day.slots[a] = day.slots[b]; day.slots[b] = t;
    save(); render();
  }

  function pickExercise(day) {
    const search = el('input', { type: 'text', placeholder: 'buscar ejercicio…', oninput: (ev) => filter(ev.target.value) });
    const list = el('div', { class: 'stack', style: { gap: '6px', maxHeight: '46vh', overflow: 'auto' } });
    function filter(q) {
      clear(list);
      q = (q || '').toLowerCase();
      Object.keys(EX).filter(id => EX[id].name.toLowerCase().indexOf(q) >= 0).slice(0, 60).forEach(id => {
        const e = EX[id];
        list.appendChild(el('button', {
          class: 'btn wide', style: { justifyContent: 'space-between' },
          onclick: () => { addSlot(day, id); closeSheet(); }
        }, el('span', { text: e.name }), el('span', { class: 'tiny muted', text: (CE.MUSCLE_LABEL[e.primary] || '') })));
      });
    }
    filter('');
    openSheet('Añadir ejercicio', day.name, el('div', { class: 'stack' }, search, list), [{ label: 'Cerrar', ghost: true, onClick: closeSheet }]);
  }

  function addSlot(day, exId) {
    const e = CE.exOf(exId, EX);
    const reps = ['calf', 'lateral', 'rear_delt', 'biceps', 'triceps', 'abduction', 'kickback', 'knee_ext', 'knee_flex'].indexOf(e.pattern) >= 0 ? [12, 15] : [8, 10];
    day.slots.push({ ex: exId, sets: 3, reps: reps, rir: 1, rest: e.rest || 90 });
    save(); render(); toast('Añadido: ' + e.name);
  }

  const PATTERN_LABEL = {
    hip_thrust: 'Glúteo · empuje de cadera', hinge: 'Bisagra', squat: 'Sentadilla / prensa', lunge: 'Unilateral',
    knee_ext: 'Extensión', knee_flex: 'Femoral', abduction: 'Abducción', kickback: 'Patada',
    calf: 'Pantorrilla', push_h: 'Empuje horizontal', push_i: 'Empuje inclinado', push_v: 'Empuje vertical',
    lateral: 'Deltoides lateral', rear_delt: 'Deltoides posterior', triceps: 'Tríceps',
    pull_v: 'Tirón vertical', pull_h: 'Tirón horizontal', pull_uni: 'Tirón unilateral', biceps: 'Bíceps', core: 'Core'
  };

  function optimize() {
    const moves = CE.rebalance(S.program, EX);
    CE.fitToTarget(S.program, EX);
    save(true); render();
    toast(moves.length ? 'Reparto ajustado: ' + moves.length + ' cambios de series' : 'El reparto ya estaba equilibrado');
  }

  function libraryCard() {
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-title' }, el('h2', { text: 'Mis ejercicios' }), el('span', { class: 'meta', text: S.custom.length + ' propios' })));
    card.appendChild(el('p', { class: 'hint', text: 'Los ejercicios propios aparecen en los desplegables y cuentan para el volumen igual que los de fábrica.' }));
    if (S.custom.length) {
      S.custom.forEach((e, i) => {
        card.appendChild(el('div', { class: 'row between', style: { padding: '6px 0', borderBottom: '1px solid var(--line)' } },
          el('div', {}, el('b', { text: e.name }), el('div', { class: 'tiny muted', text: (CE.MUSCLE_LABEL[e.primary] || e.primary) + ' · ' + (PATTERN_LABEL[e.pattern] || e.pattern) })),
          el('button', { class: 'btn sm ghost', text: 'eliminar', onclick: () => { S.custom.splice(i, 1); save(); render(); } })
        ));
      });
    }
    card.appendChild(el('div', { class: 'row', style: { marginTop: '10px' } },
      el('button', { class: 'btn sm', text: '+ crear ejercicio', onclick: openNewExercise })
    ));
    return card;
  }

  function openNewExercise() {
    const name = el('input', { type: 'text', placeholder: 'Nombre del ejercicio' });
    const primary = el('select');
    CE.MUSCLES.forEach(m => primary.appendChild(el('option', { value: m.id, text: m.label, selected: m.id === 'glute' ? true : null })));
    const pattern = el('select');
    Object.keys(PATTERN_LABEL).forEach(k => pattern.appendChild(el('option', { value: k, text: PATTERN_LABEL[k], selected: k === 'hip_thrust' ? true : null })));
    const step = el('input', { type: 'number', value: '2.5', step: '0.25', min: '0.25' });
    const rest = el('input', { type: 'number', value: '90', step: '15', min: '0' });
    const body = el('div', { class: 'stack' },
      el('label', { class: 'fld' }, 'Nombre', name),
      el('div', { class: 'grid two' },
        el('label', { class: 'fld' }, 'Músculo principal', primary),
        el('label', { class: 'fld' }, 'Patrón', pattern)
      ),
      el('div', { class: 'grid two' },
        el('label', { class: 'fld' }, 'Salto de carga (kg)', step),
        el('label', { class: 'fld' }, 'Descanso (s)', rest)
      )
    );
    openSheet('Nuevo ejercicio', 'Se guarda en tu biblioteca y se puede usar en cualquier sesión.', body, [
      { label: 'Cancelar', ghost: true, onClick: closeSheet },
      {
        label: 'Crear', primary: true, onClick: () => {
          const nm = name.value.trim();
          if (!nm) { toast('Ponle nombre'); return; }
          const id = 'ex_' + nm.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').slice(0, 32) + '_' + Math.random().toString(36).slice(2, 5);
          S.custom.push({
            id: id, name: nm, primary: primary.value, secondary: [], pattern: pattern.value,
            equipment: 'otro', incPct: 2.5, axial: 0, unilateral: false,
            rest: num(rest.value) || 90, bwFactor: 0, step: num(step.value) || 2.5, cue: ''
          });
          EX = CE.getExMap(S.custom);
          save(); closeSheet(); render(); toast('Ejercicio creado');
        }
      }
    ]);
  }

  /* ------------------------------------------------------------------ *
   * PROGRESO
   * ------------------------------------------------------------------ */
  function viewProgress() {
    const wrap = el('div', { class: 'stack' });
    const head = el('div', { class: 'view-head' });
    const hl = el('div', {});
    hl.appendChild(el('div', { class: 'kicker', text: 'Datos' }));
    hl.appendChild(el('h1', { text: 'Progreso' }));
    hl.appendChild(el('p', { text: 'En déficit el progreso se mide en repeticiones a la misma carga, no en kilos añadidos. Aquí está lo que llevas y lo que toca.' }));
    head.appendChild(hl);
    head.appendChild(el('div', { class: 'row tight' },
      el('button', { class: 'btn sm', text: 'Exportar CSV', onclick: exportCSV }),
      el('button', { class: 'btn sm', text: 'Copia .json', onclick: exportJSON })
    ));
    wrap.appendChild(head);

    const weeks = CE.weeklySummary(S, EX);
    const chartCard = el('div', { class: 'card' });
    chartCard.appendChild(el('div', { class: 'card-title' }, el('h2', { text: 'Tonelaje por semana' }), el('span', { class: 'meta', text: weeks.length === 1 ? '1 semana registrada' : weeks.length + ' semanas registradas' })));
    if (weeks.length) {
      const cw = CE.toISODate(CE.mondayOf(todayISO()));
      chartCard.appendChild(barChart(weeks.slice(-12).map(w => ({
        value: w.tonnage,
        label: 'S' + CE.weekNumber(S.block.start, w.weekStart),
        short: 'S' + CE.weekNumber(S.block.start, w.weekStart),
        today: w.weekStart === cw
      })), { label: 'Tonelaje semanal', target: average(weeks.slice(-4).map(w => w.tonnage)) }));
      chartCard.appendChild(el('p', { class: 'tiny muted', text: 'La línea discontinua es tu media de las últimas 4 semanas. Si el tonelaje sube de golpe en déficit, suele ser una señal de que las series se están volviendo basura.' }));
    } else {
      chartCard.appendChild(el('div', { class: 'empty', text: 'Aún no hay sesiones registradas. Empieza por la pestaña Hoy.' }));
    }
    wrap.appendChild(chartCard);

    /* preparación */
    const readCard = el('div', { class: 'card' });
    readCard.appendChild(el('div', { class: 'card-title' }, el('h2', { text: 'Preparación' }), el('span', { class: 'meta', text: '0–100' })));
    const rpts = Object.keys(S.logs).sort().filter(d => S.logs[d].readiness && typeof S.logs[d].readiness.score === 'number')
      .map(d => ({ y: S.logs[d].readiness.score, label: shortDate(d) }));
    if (rpts.length > 1) {
      readCard.appendChild(lineChart(rpts, { label: 'Preparación' }));
      const avg = Math.round(average(rpts.map(p => p.y)));
      readCard.appendChild(el('p', { class: 'tiny muted', text: 'Media ' + avg + '/100. Por debajo de 55 dos semanas seguidas: adelanta una descarga.' }));
    } else {
      readCard.appendChild(el('p', { class: 'hint', text: 'Responde el cuestionario antes de entrenar y aquí verás la tendencia. Es el mejor predictor de si el bloque está funcionando.' }));
    }
    wrap.appendChild(readCard);

    wrap.appendChild(historyCard());
    wrap.appendChild(stallCard());

    /* progresión por ejercicio */
    const loadCard = el('div', { class: 'card' });
    loadCard.appendChild(el('div', { class: 'card-title' }, el('h2', { text: 'Carga y próxima subida' }), el('span', { class: 'meta', text: 'doble progresión' })));
    const tbl = el('table', { class: 'tbl' });
    tbl.appendChild(el('thead', {}, el('tr', {},
      el('th', { text: 'Ejercicio' }), el('th', { class: 'r', text: 'Base' }), el('th', { class: 'c', text: '↑/↓' }),
      el('th', { class: 'r', text: 'Última' }), el('th', { class: 'r', text: 'Próxima' }), el('th', { text: 'Condición' })
    )));
    const tb = el('tbody');
    const seen = {};
    S.program.days.forEach(d => d.slots.forEach(s => {
      if (seen[s.ex]) return;
      seen[s.ex] = 1;
      const adv = CE.advise({ ex: s.ex, reps: s.reps, rir: s.rir }, S.logs, S.loads, EX);
      const last = CE.lastEntryFor(S.logs, s.ex);
      tb.appendChild(el('tr', {},
        el('td', { text: CE.exOf(s.ex, EX).name }),
        el('td', { class: 'r', text: kg(S.loads[s.ex] || 0) }),
        el('td', { class: 'c tiny' }, el('span', { class: 'green', text: '↑' + adv.history.up }), ' ', el('span', { class: 'red', text: '↓' + adv.history.down })),
        el('td', { class: 'r', text: last ? kg(Math.max.apply(null, last.entry.sets.map(x => x.load || 0))) : '—' }),
        el('td', { class: 'r' }, el('b', { text: kg(adv.nextLoad) })),
        el('td', { class: 'tiny muted', text: adv.condition })
      ));
    }));
    tbl.appendChild(tb);
    loadCard.appendChild(el('div', { class: 'scroll-x' }, tbl));
    wrap.appendChild(loadCard);

    /* medidas */
    wrap.appendChild(measurementsCard());
    return wrap;
  }

  function average(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

  /* ---------- historial por ejercicio ---------- */
  let HIST_EX = null;

  function historyCard() {
    const ids = [];
    S.program.days.forEach((d) => d.slots.forEach((sl) => { if (ids.indexOf(sl.ex) < 0) ids.push(sl.ex); }));
    Object.keys(S.logs || {}).forEach((date) => {
      Object.keys((S.logs[date] && S.logs[date].entries) || {}).forEach((id) => { if (ids.indexOf(id) < 0) ids.push(id); });
    });
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-title' }, el('h2', { text: 'Historial por ejercicio' }), el('span', { class: 'meta', text: 'e1RM estimado (Epley)' })));

    if (!ids.length) { card.appendChild(el('div', { class: 'empty', text: 'Aún no hay ejercicios registrados.' })); return card; }
    const exId = (HIST_EX && ids.indexOf(HIST_EX) >= 0) ? HIST_EX : ids[0];
    const sel = el('select', { style: { maxWidth: '320px' }, onchange: (e) => { HIST_EX = e.target.value; render(); } });
    ids.forEach((id) => sel.appendChild(el('option', { value: id, text: CE.exOf(id, EX).name, selected: id === exId ? true : null })));
    card.appendChild(sel);

    const hist = CE.exerciseHistory(S.logs, exId);
    if (!hist.length) {
      card.appendChild(el('div', { class: 'empty', style: { marginTop: '12px' }, text: 'Sin registros de este ejercicio todavía.' }));
      return card;
    }
    const first = hist[0], last = hist[hist.length - 1];
    const delta = first.e1rm ? (last.e1rm - first.e1rm) / first.e1rm : 0;
    const stats = el('div', { class: 'grid three', style: { margin: '12px 0' } });
    stats.appendChild(el('div', { class: 'stat' }, el('span', { class: 'v', text: kg(last.e1rm) }), el('span', { class: 'k', text: 'e1RM actual' }), el('span', { class: 'd', text: kg(last.load) + ' × ' + last.reps })));
    stats.appendChild(el('div', { class: 'stat' }, el('span', { class: 'v ' + (delta > 0.015 ? 'green' : delta < -0.015 ? 'red' : 'muted'), text: (delta > 0 ? '+' : '') + Math.round(delta * 100) + ' %' }), el('span', { class: 'k', text: 'desde la primera' }), el('span', { class: 'd', text: hist.length + ' sesiones' })));
    stats.appendChild(el('div', { class: 'stat' }, el('span', { class: 'v', text: tn(last.tonnage) }), el('span', { class: 'k', text: 'tonelaje última' }), el('span', { class: 'd', text: last.sets + ' series' })));
    card.appendChild(stats);

    if (hist.length > 1) {
      card.appendChild(lineChart(hist.map((h) => ({ y: h.e1rm, label: shortDate(h.date) })), { label: 'e1RM de ' + CE.exOf(exId, EX).name }));
    }
    const st = CE.stagnation(hist, { today: todayISO(), reps: (S.program.days.flatMap((d) => d.slots).filter((sl) => sl.ex === exId)[0] || {}).reps });
    const cls = st.status === 'up' ? 'green' : st.status === 'flat' ? 'amber' : 'muted';
    card.appendChild(el('div', { class: 'banner ' + (st.status === 'up' ? 'good' : st.status === 'flat' ? 'warn' : '') },
      el('b', { text: st.status === 'up' ? 'En progreso. ' : st.status === 'flat' ? 'Estancado. ' : st.status === 'stale' ? 'Sin uso. ' : '' }),
      el('span', { text: st.suggestion })
    ));
    return card;
  }

  /* ---------- estancamientos ---------- */
  let STALL_ALL = false;

  function stallCard() {
    const seen = {};
    const rows = [];
    S.program.days.forEach((d) => d.slots.forEach((sl) => {
      if (seen[sl.ex]) return;
      seen[sl.ex] = true;
      const hist = CE.exerciseHistory(S.logs, sl.ex);
      if (!hist.length) return;
      const st = CE.stagnation(hist, { today: todayISO(), reps: sl.reps });
      rows.push({ exId: sl.ex, slot: sl, st: st, hist: hist });
    }));
    const flat = rows.filter((r) => r.st.status === 'flat' || r.st.status === 'stale');
    const up = rows.filter((r) => r.st.status === 'up');
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-title' },
      el('h2', { text: 'Estancamientos' }),
      el('span', { class: 'meta', text: up.length + ' en progreso · ' + flat.length + ' parados' })
    ));
    if (!rows.length) { card.appendChild(el('div', { class: 'empty', text: 'Con dos o tres semanas de registros aquí aparecen los ejercicios que se han parado.' })); return card; }
    if (!flat.length) { card.appendChild(el('div', { class: 'banner good' }, el('span', { text: 'Ningún ejercicio parado en las últimas tres sesiones. Todo sube.' }))); return card; }

    flat.sort((a, b) => (b.st.status === 'stale' ? 1 : 0) - (a.st.status === 'stale' ? 1 : 0) || b.hist.length - a.hist.length);
    const shown = STALL_ALL ? flat : flat.slice(0, 5);
    shown.forEach((r) => {
      const inc = CE.exOf(r.exId, EX).incPct || 2.5;
      const row = el('div', { class: 'row between', style: { padding: '10px 0', borderBottom: '1px solid var(--line)', alignItems: 'flex-start' } });
      const left = el('div', { style: { flex: '1 1 260px' } });
      left.appendChild(el('div', {}, el('b', { text: CE.exOf(r.exId, EX).name }), ' ', el('span', { class: 'chip ' + (r.st.status === 'stale' ? '' : 'amber'), text: r.st.status === 'stale' ? 'sin uso' : 'parado' })));
      left.appendChild(el('div', { class: 'tiny muted', style: { marginTop: '3px' }, text: r.st.suggestion }));
      row.appendChild(left);
      if (r.st.status === 'flat') {
        row.appendChild(el('button', {
          class: 'btn sm', text: 'subir ' + inc + ' %',
          onclick: () => {
            const step = CE.exOf(r.exId, EX).step || 2.5;
            S.loads[r.exId] = CE.roundTo((S.loads[r.exId] || 0) * (1 + inc / 100), step);
            save(true); render(); toast(CE.exOf(r.exId, EX).name + ' → ' + kg(S.loads[r.exId]) + ' kg');
          }
        }));
      } else {
        row.appendChild(el('button', {
          class: 'btn sm ghost', text: 'bajar 10 %',
          onclick: () => {
            const step = CE.exOf(r.exId, EX).step || 2.5;
            S.loads[r.exId] = CE.roundTo((S.loads[r.exId] || 0) * 0.9, step);
            save(true); render(); toast('Carga suavizada para reintroducir');
          }
        }));
      }
      card.appendChild(row);
    });
    if (flat.length > 5) {
      card.appendChild(el('div', { class: 'row', style: { marginTop: '10px' } },
        el('button', {
          class: 'btn sm ghost',
          text: STALL_ALL ? 'ver solo los 5 primeros' : '+ ' + (flat.length - 5) + ' más',
          onclick: () => { STALL_ALL = !STALL_ALL; render(); }
        })
      ));
    }
    return card;
  }

  function measurementsCard() {
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-title' }, el('h2', { text: 'Medidas' }), el('span', { class: 'meta', text: S.measurements.length + ' registros' })));

    const date = el('input', { type: 'date', value: todayISO() });
    const weight = el('input', { type: 'number', step: '0.1', placeholder: 'kg' });
    const waist = el('input', { type: 'number', step: '0.5', placeholder: 'cm' });
    const hip = el('input', { type: 'number', step: '0.5', placeholder: 'cm' });
    const thigh = el('input', { type: 'number', step: '0.5', placeholder: 'cm' });
    const arm = el('input', { type: 'number', step: '0.5', placeholder: 'cm' });

    const form = el('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(84px, 1fr))', gap: '6px', marginTop: '8px' } },
      el('label', { class: 'fld' }, 'fecha', date),
      el('label', { class: 'fld' }, 'peso', weight),
      el('label', { class: 'fld' }, 'cintura', waist),
      el('label', { class: 'fld' }, 'cadera', hip),
      el('label', { class: 'fld' }, 'muslo', thigh),
      el('label', { class: 'fld' }, 'brazo', arm)
    );
    card.appendChild(form);
    card.appendChild(el('div', { class: 'row', style: { marginTop: '8px' } }, el('button', {
      class: 'btn sm', text: 'Añadir medida',
      onclick: () => {
        const rec = { date: date.value || todayISO() };
        if (num(weight.value)) rec.weight = num(weight.value);
        if (num(waist.value)) rec.waist = num(waist.value);
        if (num(hip.value)) rec.hip = num(hip.value);
        if (num(thigh.value)) rec.thigh = num(thigh.value);
        if (num(arm.value)) rec.arm = num(arm.value);
        if (Object.keys(rec).length < 2) { toast('Añade al menos una medida'); return; }
        S.measurements.push(rec);
        S.measurements.sort((a, b) => a.date < b.date ? -1 : 1);
        if (rec.weight) S.athlete.weightKg = rec.weight;
        save(true); render(); toast('Medida guardada');
      }
    })));

    if (S.measurements.length) {
      const withW = S.measurements.filter(m => m.weight);
      if (withW.length > 1) {
        card.appendChild(el('div', { style: { marginTop: '14px' } }, lineChart(withW.map(m => ({ y: m.weight, label: shortDate(m.date) })), { label: 'Peso corporal' })));
      }
      const tbl = el('table', { class: 'tbl' });
      tbl.appendChild(el('thead', {}, el('tr', {}, ['Fecha', 'Peso', 'Cintura', 'Cadera', 'Muslo', 'Brazo'].map((h, i) => el('th', { class: i ? 'r' : '', text: h })))));
      const tb = el('tbody');
      S.measurements.slice(-10).reverse().forEach(m => {
        tb.appendChild(el('tr', {},
          el('td', { text: shortDate(m.date) }),
          el('td', { class: 'r', text: m.weight ? kg(m.weight) : '—' }),
          el('td', { class: 'r', text: m.waist ? kg(m.waist) : '—' }),
          el('td', { class: 'r', text: m.hip ? kg(m.hip) : '—' }),
          el('td', { class: 'r', text: m.thigh ? kg(m.thigh) : '—' }),
          el('td', { class: 'r', text: m.arm ? kg(m.arm) : '—' })
        ));
      });
      tbl.appendChild(tb);
      card.appendChild(el('div', { class: 'scroll-x', style: { marginTop: '8px' } }, tbl));
    }
    return card;
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportCSV() {
    const rows = ['fecha,sesion,ejercicio,serie,kg,reps,rir'];
    Object.keys(S.logs).sort().forEach(d => {
      const L = S.logs[d];
      Object.keys(L.entries || {}).forEach(exId => {
        (L.entries[exId].sets || []).forEach((s, i) => {
          if (!s || (!s.reps && !s.load)) return;
          rows.push([d, L.sessionId || '', '"' + CE.exOf(exId, EX).name + '"', i + 1, s.load || '', s.reps || '', s.rir == null ? '' : s.rir].join(','));
        });
      });
    });
    download('cuaderno-registro.csv', rows.join('\n'), 'text/csv;charset=utf-8');
    toast('CSV descargado');
  }

  function exportJSON() {
    /* nunca se exporta la clave de OpenAI */
    download('cuaderno-copia-' + todayISO() + '.json', JSON.stringify(DB, null, 2), 'application/json');
    toast('Copia de ' + profileList().length + ' perfil(es) descargada');
  }

  /* ------------------------------------------------------------------ *
   * BLOQUE (el documento)
   * ------------------------------------------------------------------ */
  function viewDoc() {
    const wrap = el('div', { class: 'stack' });
    const head = el('div', { class: 'view-head no-print' });
    const hl = el('div', {});
    hl.appendChild(el('div', { class: 'kicker', text: 'Documento del bloque' }));
    hl.appendChild(el('h1', { text: S.block.name }));
    head.appendChild(hl);
    head.appendChild(el('div', { class: 'row tight' },
      el('button', { class: 'btn sm', text: 'Imprimir', onclick: () => window.print() })
    ));
    wrap.appendChild(head);

    const doc = el('div', { class: 'card doc' });
    const ph = phaseNow();

    doc.appendChild(el('h1', { class: 'print-only', text: S.block.name }));
    doc.appendChild(el('p', { class: 'print-only print-sub', text: 'Programa de hipertrofia en déficit · ' + P.days.length + ' días por semana · ' + CE.countSets(P) + ' series semanales · ' + Math.round(S.athlete.weightKg) + ' kg · ' + nf0.format(S.athlete.kcal) + ' kcal' }));

    doc.appendChild(el('p', { class: 'lead', text: 'Este documento sustituye, para el bloque actual, al programa de powerbuilding del 19 de octubre de 2026. No lo borra: lo deja archivado, porque la decisión fue posponer la fuerza, no abandonarla.' }));

    doc.appendChild(el('h2', { text: 'Por qué este bloque no es de fuerza' }));
    doc.appendChild(el('p', { text: 'A ' + nf0.format(S.athlete.kcal) + ' kcal diarias no se construye músculo a la velocidad de un superávit. En déficit no hay margen energético para sintetizar tejido nuevo de forma agresiva, y lo que sí puede pasar es que se pierda masa si el estímulo es insuficiente o si la proteína no llega. El objetivo no es ganar fuerza ni batir récords: es conservar el músculo que ya hay, mejorar la forma y llegar al final del déficit con el terreno preparado para un bloque de construcción cuando las calorías suban.' }));
    doc.appendChild(el('p', { text: 'Eso cambia tres cosas de raíz. La intensidad deja de perseguirse como número absoluto: no hay singles, no hay test de e1RM como eje, no hay series a RIR 0 en ejercicios axiales. El volumen no se sube para compensar que se come menos: se mantiene en rango medio, porque en déficit el recurso escaso es la recuperación, no el estímulo. Y el progreso se mide en repeticiones a la misma carga, no en kilos añadidos.' }));

    doc.appendChild(el('h2', { text: 'Qué esperar del glúteo, con honestidad' }));
    doc.appendChild(el('p', { text: 'En déficit el glúteo puede mantener su masa e incluso ganar algo si el estímulo es nuevo y la proteína está alta, pero el cambio visual de las próximas semanas viene sobre todo de perder grasa encima y alrededor, no de que el músculo crezca dos centímetros. La forma mejora rápido; el volumen tarda. Si en ocho semanas se espera un glúteo notablemente más grande, la conversación va a ser incómoda; si se espera un glúteo más definido, más firme y con mejor forma, va a estar contenta.' }));
    doc.appendChild(el('p', { text: 'Lo que juega a favor es que el glúteo tolera volumen y frecuencia mejor que casi cualquier músculo, y responde a dos estímulos distintos en la misma semana: cadera en acortamiento (hip thrust, patada, puente) y cadera en alargamiento (peso muerto rumano, sumo, búlgara). Por eso el plan tiene dos exposiciones directas por semana, no una sesión de glúteo y ya.' }));

    doc.appendChild(el('h2', { text: 'Los ' + numToWord(P.days.length) + ' días' }));
    doc.appendChild(el('p', { text: 'Sesiones de 45–75 minutos. Ninguna pasa de ' + CE.capFor(P.days.length) + ' series duras, que es el techo donde una sesión deja de caber en el tiempo disponible y empieza a cobrar factura en recuperación.' }));
    P.days.forEach(day => {
      doc.appendChild(el('h3', { text: CE.weekdayName(day.weekday) + ' · ' + day.name + ' — ' + day.focus }));
      const tbl = el('table', { class: 'tbl' });
      tbl.appendChild(el('thead', {}, el('tr', {},
        el('th', { text: 'Ejercicio' }), el('th', { class: 'c', text: 'Series × reps' }), el('th', { class: 'c', text: 'RIR' }), el('th', { class: 'c', text: 'Descanso' })
      )));
      const tb = el('tbody');
      day.slots.forEach(s => {
        tb.appendChild(el('tr', {},
          el('td', {}, CE.exOf(s.ex, EX).name, s.optional ? el('span', { class: 'pill opt', text: 'opcional' }) : null),
          el('td', { class: 'c', text: s.sets + ' × ' + s.reps[0] + '–' + s.reps[1] }),
          el('td', { class: 'c', text: String(s.rir) }),
          el('td', { class: 'c', text: fmtRest(s.rest) })
        ));
      });
      tbl.appendChild(tb);
      doc.appendChild(docTable(tbl));
      doc.appendChild(el('p', { class: 'note', text: CE.countSets({ days: [day] }) + ' series · ' + CE.sessionMinutes(day, EX) + ' minutos estimados.' }));
    });

    doc.appendChild(el('h2', { text: 'Volumen semanal y por qué está repartido así' }));
    const vt = el('table', { class: 'tbl' });
    vt.appendChild(el('thead', {}, el('tr', {},
      el('th', { text: 'Músculo' }), el('th', { class: 'c', text: 'Series efectivas / semana' }), el('th', { class: 'c', text: 'Rango del plan' }), el('th', { class: 'c', text: 'Frecuencia' })
    )));
    const vtb = el('tbody');
    CE.volumeRows(CE.volumeOf(P, EX)).forEach(r => {
      vtb.appendChild(el('tr', {},
        el('td', { text: r.label }),
        el('td', { class: 'c' }, el('b', { text: String(r.total) })),
        el('td', { class: 'c muted', text: r.range[0] + '–' + r.range[1] }),
        el('td', { class: 'c muted', text: '2×' })
      ));
    });
    vt.appendChild(vtb);
    doc.appendChild(docTable(vt));
    doc.appendChild(el('p', { text: 'Series efectivas = directas (1) más indirectas (0,5). El total semanal ronda las ' + CE.countSets(P) + ' series duras: es volumen medio, deliberadamente. La excepción es el glúteo, que va al extremo alto porque es la prioridad declarada, y el cuádriceps y el pecho, que quedan en el extremo bajo a propósito: en un déficit con ' + CE.countSets(P) + ' series no se puede tener todo en el techo.' }));

    doc.appendChild(el('h2', { text: 'Cómo se progresa' }));
    doc.appendChild(el('p', { text: 'Doble progresión, sin porcentajes mágicos. La carga se mantiene hasta que todas las series del ejercicio tocan el techo del rango con el RIR objetivo; ahí se sube un escalón pequeño (2,5 % en tren superior, 5 % en tren inferior). Si una serie queda por debajo del mínimo del rango, o la primera llega a RIR 0, se baja un 5 % y se sigue. Si falta el dato de reps y RIR, la semana siguiente repite la carga en lugar de inventar progresión.' }));
    doc.appendChild(el('p', { text: 'En déficit hay una regla adicional que manda sobre las demás: no se persigue el récord. Pasar de 8 a 10 repeticiones con el mismo peso es progresar, y es lo que hay que buscar.' }));

    doc.appendChild(el('h2', { text: 'Fases del bloque' }));
    const phases = [
      ['1', 'Calibración', 'Cargas que dejen 3 repeticiones en reserva. Sin test de e1RM obligatorio.'],
      ['2–5', 'Acumulación', 'El RIR baja de 2 a 1–2 conforme se asientan las cargas.'],
      ['6', 'Descarga', 'El volumen cae a la mitad, la carga se mantiene y el RIR objetivo sube a 3–4.'],
      ['7–11', 'Intensificación', 'Las mismas repeticiones, RIR 1–2; la carga se mantiene mientras suben las repeticiones.'],
      ['12', 'Descarga y revisión', 'No hay re-test de fuerza: se revisan medidas, fotos y la preparación media del bloque.']
    ];
    phases.forEach(p => {
      doc.appendChild(el('p', {}, el('b', { text: 'Semana ' + p[0] + ' · ' + p[1] + '. ' }), p[2]));
    });
    doc.appendChild(el('p', { class: 'note', text: 'Si el déficit se extiende a 15 semanas, el bloque se repite desde la semana 1 con las cargas alcanzadas como nuevo punto de partida, o se inserta una descarga extra en la 13 si la preparación media cae por debajo de 55 o el semáforo sale rojo dos semanas seguidas.' }));

    doc.appendChild(el('h2', { text: 'Ciclo y autorregulación' }));
    doc.appendChild(el('p', { text: 'La fuerza no cambia igual para todas a lo largo del ciclo: el meta-análisis de McNulty y colaboradores (2020) encuentra efectos de triviales a pequeños, con más síntomas en la fase menstrual y peor tolerancia al esfuerzo en la lútea. Por eso el plan no asume un patrón: pregunta cada día de sangrado cómo está la fuerza y ajusta esa sesión, sin tocar el programa ni la progresión.' }));
    doc.appendChild(el('p', { class: 'note', text: 'El ajuste tiene techo: nunca más del 15 % de carga ni más de dos series. Si el registro muestra varios días seguidos de fuerza muy baja, la decisión correcta es descansar o adelantar la descarga, no seguir recortando series.' }));

    doc.appendChild(el('h2', { text: 'Cardio y pasos' }));
    doc.appendChild(el('p', { text: 'La interferencia entre cardio y fuerza depende de la dosis y de la proximidad, no de la existencia del cardio: aparece sobre todo con volumen alto de resistencia, en el mismo músculo y sin separación suficiente. Por eso la base son los pasos (' + nf0.format((S.cardio && S.cardio.steps) || 8000) + ' al día) y el HIIT va ' + (S.cardio && S.cardio.hiit ? 'una o dos veces por semana' : 'fuera del plan') + ', separado del tren inferior.' }));
    doc.appendChild(el('p', { class: 'note', text: 'Regla práctica: HIIT en un día sin piernas o al final de una sesión de tren superior, con al menos 6 horas desde que terminaste; y nunca la tarde anterior a sentadilla o peso muerto. Los intervalos cortos afectan poco la señal de síntesis proteica, que dura entre 24 y 48 horas después de entrenar; el problema real es la recuperación acumulada en déficit.' }));

    doc.appendChild(el('h2', { text: 'Descanso y autorregulación' }));
    doc.appendChild(el('p', { text: 'Entre series, 2–3 minutos en hip thrust, RDL, sumo, búlgara y prensa; 60–90 segundos en aislamientos. En déficit el descanso largo no es pereza: es lo que permite mantener la carga con buena técnica cuando la energía está baja. El temporizador está en cada ejercicio.' }));
    doc.appendChild(el('p', { text: 'Al anotar la primera serie, el cuaderno compara reps y RIR reales con el objetivo y ofrece bajar las series siguientes, mantenerlas o subir si sobró margen. El botón «Hoy está muy pesado» aplica un −5 % a la sesión completa sin tocar la carga base, y el cuestionario de preparación produce una puntuación de 0 a 100 con semáforo. En un déficit agresivo, la señal de preparación es más fiable que el plan escrito.' }));

    doc.appendChild(el('h2', { text: 'Nutrición y recuperación, que aquí son parte del programa' }));
    doc.appendChild(el('p', { text: 'A ' + nf0.format(S.athlete.kcal) + ' kcal, la proteína es la variable que decide si este bloque conserva masa o la pierde: ' + S.athlete.proteinMin + '–' + S.athlete.proteinMax + ' g por kilo de peso corporal (' + Math.round(S.athlete.proteinMin * S.athlete.weightKg) + '–' + Math.round(S.athlete.proteinMax * S.athlete.weightKg) + ' g), repartida en tres o cuatro comidas. Sin eso, el entrenamiento no puede hacer su trabajo por bien programado que esté.' }));
    doc.appendChild(el('p', { text: 'Conviene mantener los pasos altos en lugar de añadir HIIT: el cardio interválico compite por la misma recuperación que el entrenamiento de fuerza. Sueño de siete a nueve horas, y si una semana el sueño se cae, esa es la semana para recortar accesorios, no para añadir series.' }));

    doc.appendChild(el('h2', { text: 'Qué se dejó fuera y por qué' }));
    doc.appendChild(el('p', { text: 'La sentadilla con barra libre y el 3×5 desaparecen como eje: su costo axial y su demanda de recuperación no encajan en un déficit con prioridad de glúteo, y el cuádriceps se cubre con hack, prensa y búlgara. La serie tope con back-offs al −8 % también sale: era una herramienta para expresar fuerza máxima, no para acumular estímulo hipertrófico. El test de e1RM queda como opcional para poner una carga inicial sensata, no como objetivo del bloque.' }));

    doc.appendChild(el('h2', { text: 'Cómo se vuelve a fuerza' }));
    doc.appendChild(el('p', { text: 'Cuando salga del déficit y las calorías suban, el camino de vuelta es corto: se reintroduce la sentadilla con barra como patrón principal, se sube el RIR objetivo de los básicos a 2 con un día de series más pesadas, se recupera la progresión por carga y se vuelve a medir e1RM. El bloque de hipertrofia no se pierde: el trabajo de glúteo, femoral y pantorrilla es exactamente el que sostiene un peso muerto grande.' }));
    doc.appendChild(el('blockquote', { text: 'Semana actual: ' + (currentWeek() >= 1 ? currentWeek() : '—') + ' · ' + ph.name + '. ' + ph.note }));

    wrap.appendChild(doc);

    const dataCard = el('div', { class: 'card no-print' });
    dataCard.appendChild(el('h2', { text: 'Datos de esta copia' }));
    dataCard.appendChild(el('p', { class: 'hint', text: 'Todo se guarda en este navegador. Descarga una copia si vas a cambiar de dispositivo o quieres conservarlo.' }));
    dataCard.appendChild(el('div', { class: 'row' },
      el('button', { class: 'btn sm', text: 'Descargar .json', onclick: exportJSON }),
      el('label', { class: 'btn sm', text: 'Importar .json' },
        el('input', {
          type: 'file', accept: '.json,application/json', class: 'hidden',
          onchange: (ev) => importJSON(ev.target.files[0])
        })
      ),
      el('button', { class: 'btn sm ghost', text: 'Borrar y empezar de cero', onclick: confirmReset })
    ));
    wrap.appendChild(dataCard);
    return wrap;
  }

  function docTable(tbl) { return el('div', { class: 'scroll-x' }, tbl); }

  function numToWord(n) {
    return ({ 2: 'dos', 3: 'tres', 4: 'cuatro', 5: 'cinco', 6: 'seis' })[n] || String(n);
  }

  function importJSON(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result));
        DB = CE.migrateState(obj);
        S = DB.profiles[DB.activeId];
        if (!S.program || !S.program.days) {
          S.program = CE.buildProgram({ n: S.block.freq, exMap: CE.getExMap(S.custom), loads: S.loads, equipment: S.equipment, prefs: S.prefs, swaps: S.swaps });
        }
        save(true); refreshDerived(); render(); toast('Copia importada: ' + profileList().length + ' perfil(es)');
      } catch (e) { toast('Ese archivo no es una copia válida'); }
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------------ *
   * PERFILES
   * ------------------------------------------------------------------ */
  function promptText(title, sub, value, onOk) {
    const input = el('input', { type: 'text', value: value || '', placeholder: 'Nombre' });
    openSheet(title, sub, el('div', { class: 'stack' }, el('label', { class: 'fld' }, 'Nombre', input)), [
      { label: 'Cancelar', ghost: true, onClick: closeSheet },
      { label: 'Guardar', primary: true, onClick: () => { const v = input.value.trim(); if (v) onOk(v); } }
    ]);
    setTimeout(() => { input.focus(); input.select(); }, 60);
  }

  function openProfiles() {
    const body = el('div', { class: 'stack' });
    const list = profileList();
    list.forEach((p) => {
      const active = p.id === DB.activeId;
      const sessions = Object.keys(p.logs || {}).length;
      body.appendChild(el('div', { class: 'row between', style: { padding: '10px 0', borderBottom: '1px solid var(--line)' } },
        el('div', {},
          el('b', { text: p.name || 'Atleta' }),
          el('div', { class: 'tiny muted', text: sessions + ' sesiones registradas · ' + (p.equipment ? p.equipment.length : 0) + ' equipos' + (p.block ? ' · ' + p.block.freq + ' días' : '') })
        ),
        el('div', { class: 'row tight' },
          active ? el('span', { class: 'chip', text: 'activo' }) : el('button', { class: 'btn sm', text: 'usar', onclick: () => { switchProfile(p.id); closeSheet(); } }),
          el('button', {
            class: 'btn sm ghost', text: 'renombrar',
            onclick: () => promptText('Renombrar perfil', null, p.name, (v) => { p.name = v; p.athlete.name = v; save(true); closeSheet(); render(); })
          }),
          list.length > 1 ? el('button', {
            class: 'btn sm ghost', text: 'borrar',
            onclick: () => {
              openSheet('Borrar «' + (p.name || 'Atleta') + '»', 'Se eliminan sus cargas, su programa y sus ' + sessions + ' sesiones. No se puede deshacer.', el('div', {}), [
                { label: 'Cancelar', ghost: true, onClick: closeSheet },
                {
                  label: 'Borrar perfil', primary: true, onClick: () => {
                    delete DB.profiles[p.id];
                    if (DB.activeId === p.id) DB.activeId = Object.keys(DB.profiles)[0];
                    S = DB.profiles[DB.activeId];
                    save(true); refreshDerived(); closeSheet(); render();
                    toast('Perfil borrado');
                  }
                }
              ]);
            }
          }) : null
        )
      ));
    });
    body.appendChild(el('button', {
      class: 'btn wide', style: { marginTop: '10px' }, text: '+ Nuevo perfil',
      onclick: newProfileSheet
    }));
    openSheet('Perfiles', 'Cada persona guarda sus cargas, su programa y sus registros por separado, en este dispositivo.', body, [{ label: 'Cerrar', ghost: true, onClick: closeSheet }]);
  }

  function newProfileSheet() {
    const name = el('input', { type: 'text', placeholder: 'Nombre' });
    const weight = el('input', { type: 'number', step: '0.1', min: '30', max: '200', value: '65' });
    const exp = el('select');
    [['principiante', 'Principiante · menos de 1 año'], ['intermedio', 'Intermedio · 1 a 3 años'], ['avanzado', 'Avanzado · más de 3 años']].forEach(([id, label]) => {
      exp.appendChild(el('option', { value: id, text: label, selected: id === 'intermedio' ? true : null }));
    });
    const body = el('div', { class: 'stack' },
      el('label', { class: 'fld' }, 'Nombre', name),
      el('div', { class: 'grid two' },
        el('label', { class: 'fld' }, 'Peso corporal (kg)', weight),
        el('label', { class: 'fld' }, 'Experiencia', exp)
      ),
      el('p', { class: 'tiny muted', text: 'El peso y la experiencia solo se usan para estimar las cargas de la primera semana. En cuanto registres una serie, manda tu dato.' })
    );
    openSheet('Nuevo perfil', 'Tendrá su propio programa, sus cargas y sus registros.', body, [
      { label: 'Cancelar', ghost: true, onClick: closeSheet },
      {
        label: 'Crear', primary: true, onClick: () => {
          const p = createProfile({ name: name.value.trim() || 'Atleta', weightKg: num(weight.value) || 65, experience: exp.value });
          closeSheet(); refreshDerived(); render();
          toast('Perfil «' + p.name + '» creado');
        }
      }
    ]);
    setTimeout(() => name.focus(), 60);
  }

  /* ------------------------------------------------------------------ *
   * ALTA GUIADA (3 pasos)
   * ------------------------------------------------------------------ */
  let ONB = null;

  function openOnboarding() {
    ONB = {
      step: 0,
      name: S.name && S.name !== 'Atleta' ? S.name : '',
      weightKg: S.athlete.weightKg || 65,
      experience: S.athlete.experience || 'intermedio',
      equipment: (S.equipment || []).slice(),
      freq: S.block.freq || 4,
      hiit: (S.cardio && S.cardio.hiit) || 0,
      cycle: !!(S.cycle && S.cycle.enabled),
      lastStart: (S.cycle && S.cycle.lastStart) || ''
    };
    renderOnboarding();
  }

  function renderOnboarding() {
    const body = el('div', { class: 'stack' });
    const dots = el('div', { class: 'row tight', style: { marginBottom: '4px' } });
    for (let i = 0; i < 3; i++) {
      dots.appendChild(el('span', { style: { width: '22px', height: '3px', borderRadius: '2px', background: i <= ONB.step ? 'var(--ink)' : 'var(--line-2)' } }));
    }
    body.appendChild(dots);

    if (ONB.step === 0) {
      const name = el('input', { type: 'text', value: ONB.name, placeholder: 'Nombre' });
      const weight = el('input', { type: 'number', step: '0.1', min: '30', max: '200', value: ONB.weightKg });
      const exp = el('select');
      [['principiante', 'Menos de 1 año'], ['intermedio', '1 a 3 años'], ['avanzado', 'Más de 3 años']].forEach(([id, label]) => {
        exp.appendChild(el('option', { value: id, text: label, selected: ONB.experience === id ? true : null }));
      });
      name.addEventListener('input', () => { ONB.name = name.value; });
      weight.addEventListener('input', () => { ONB.weightKg = num(weight.value); });
      exp.addEventListener('change', () => { ONB.experience = exp.value; });
      body.appendChild(el('p', { class: 'hint', text: 'Con esto se estiman las cargas de la primera semana. En cuanto registres una serie, mandan tus datos.' }));
      body.appendChild(el('label', { class: 'fld' }, 'Nombre', name));
      body.appendChild(el('div', { class: 'grid two' },
        el('label', { class: 'fld' }, 'Peso corporal (kg)', weight),
        el('label', { class: 'fld' }, 'Experiencia', exp)
      ));
    }

    if (ONB.step === 1) {
      body.appendChild(el('p', { class: 'hint', text: 'Marca lo que tienes. El programa se construye solo con eso: lo que no tengas se sustituye por una variante equivalente.' }));
      const grid = el('div', { class: 'equip-grid' });
      CE.EQUIPMENT.forEach((item) => {
        if (item.always) return;
        const on = ONB.equipment.indexOf(item.id) >= 0;
        const box = el('input', { type: 'checkbox', checked: on ? true : null });
        box.addEventListener('change', () => {
          if (box.checked) { if (ONB.equipment.indexOf(item.id) < 0) ONB.equipment.push(item.id); }
          else ONB.equipment = ONB.equipment.filter((x) => x !== item.id);
        });
        grid.appendChild(el('label', { class: 'equip' + (on ? '' : ' off') }, box, el('span', {}, el('b', { text: item.label }), el('span', { text: item.hint || '' }))));
      });
      body.appendChild(grid);
      body.appendChild(el('button', { class: 'btn sm ghost', text: 'Seleccionar todo', onclick: () => { ONB.equipment = CE.EQUIPMENT.map((e) => e.id); renderOnboarding(); } }));
    }

    if (ONB.step === 2) {
      const seg = el('div', { class: 'seg' });
      [2, 3, 4, 5, 6].forEach((n) => seg.appendChild(el('button', {
        type: 'button', text: n + ' d', 'aria-pressed': ONB.freq === n ? 'true' : 'false',
        onclick: () => { ONB.freq = n; renderOnboarding(); }
      })));
      body.appendChild(el('label', { class: 'fld' }, 'Días por semana', seg));

      const hiit = el('div', { class: 'seg', style: { marginTop: '10px' } });
      [0, 1, 2].forEach((n) => hiit.appendChild(el('button', {
        type: 'button', text: n === 0 ? 'sin HIIT' : n + '/semana', 'aria-pressed': ONB.hiit === n ? 'true' : 'false',
        onclick: () => { ONB.hiit = n; renderOnboarding(); }
      })));
      body.appendChild(el('label', { class: 'fld' }, 'HIIT', hiit));

      const cyc = el('div', { class: 'seg', style: { marginTop: '10px' } });
      [[false, 'No'], [true, 'Sí']].forEach(([v, label]) => cyc.appendChild(el('button', {
        type: 'button', text: label, 'aria-pressed': ONB.cycle === v ? 'true' : 'false',
        onclick: () => { ONB.cycle = v; renderOnboarding(); }
      })));
      body.appendChild(el('label', { class: 'fld' }, 'Registrar ciclo menstrual', cyc));

      if (ONB.cycle) {
        const last = el('input', { type: 'date', value: ONB.lastStart });
        last.addEventListener('change', () => { ONB.lastStart = last.value; });
        body.appendChild(el('label', { class: 'fld', style: { marginTop: '8px' } }, 'Primer día del último periodo', last));
      }
      body.appendChild(el('p', { class: 'tiny muted', text: 'Podrás cambiarlo todo después en Ajustes.' }));
    }

    const actions = [];
    if (ONB.step > 0) actions.push({ label: 'Atrás', ghost: true, onClick: () => { ONB.step--; renderOnboarding(); } });
    actions.push({ label: 'Saltar', ghost: true, onClick: () => finishOnboarding(true) });
    actions.push({
      label: ONB.step < 2 ? 'Siguiente' : 'Crear mi plan', primary: true,
      onClick: () => { if (ONB.step < 2) { ONB.step++; renderOnboarding(); } else finishOnboarding(false); }
    });
    openSheet('Tu cuaderno en 3 pasos', 'Paso ' + (ONB.step + 1) + ' de 3', body, actions);
  }

  function finishOnboarding(skip) {
    if (!skip) {
      S.name = (ONB.name || '').trim() || S.name || 'Atleta';
      S.athlete.name = S.name;
      S.athlete.weightKg = ONB.weightKg || S.athlete.weightKg;
      S.athlete.experience = ONB.experience;
      S.equipment = ONB.equipment.slice();
      S.block.freq = ONB.freq;
      S.loads = CE.seedLoads(S);
      const sug = CE.suggestCardioDay(CE.buildProgram({ n: ONB.freq, exMap: EX, loads: S.loads, equipment: S.equipment }), EX);
      S.cardio = Object.assign({}, S.cardio, { hiit: ONB.hiit, day: sug.weekday, steps: (S.cardio && S.cardio.steps) || 8000 });
      S.cycle = Object.assign({}, S.cycle, { enabled: ONB.cycle, lastStart: ONB.lastStart || (S.cycle && S.cycle.lastStart) || '' });
      S.program = CE.buildProgram({ n: ONB.freq, exMap: EX, loads: S.loads, equipment: S.equipment, prefs: S.prefs, swaps: S.swaps });
    }
    S.onboarded = true;
    save(true);
    closeSheet();
    refreshDerived();
    render();
    toast(skip ? 'Puedes configurarlo todo en Ajustes' : 'Plan creado: ' + S.program.days.length + ' días');
  }

  /* ------------------------------------------------------------------ *
   * AJUSTES
   * ------------------------------------------------------------------ */
  let AI_RESULT = null;
  let AI_BUSY = false;
  let AI_PROMPT = '';
  let AI_UNDO = null;

  function viewSettings() {
    const wrap = el('div', { class: 'stack' });
    const head = el('div', { class: 'view-head' });
    const hl = el('div', {});
    hl.appendChild(el('div', { class: 'kicker', text: 'Tu cuenta' }));
    hl.appendChild(el('h1', { text: 'Ajustes' }));
    hl.appendChild(el('p', { text: 'Perfil, material disponible, ejercicios que no quieres y el asistente. Todo lo de aquí cambia el programa solo.' }));
    head.appendChild(hl);
    head.appendChild(el('button', { class: 'btn sm', text: 'Cambiar de perfil', onclick: openProfiles }));
    wrap.appendChild(head);

    wrap.appendChild(profileCard());
    wrap.appendChild(equipmentCard());
    wrap.appendChild(cycleCardSettings());
    wrap.appendChild(cardioCard());
    wrap.appendChild(prefsCard());
    wrap.appendChild(accountCard());
    wrap.appendChild(aiCard());
    wrap.appendChild(dataCard());
    return wrap;
  }

  function profileCard() {
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-title' }, el('h2', { text: 'Perfil' }), el('span', { class: 'meta', text: 'solo este dispositivo' })));
    const name = el('input', { type: 'text', value: S.name || '' });
    const blockName = el('input', { type: 'text', value: S.block.name || '', placeholder: 'Ej.: Bloque de fuerza · Ana' });
    const weight = el('input', { type: 'number', step: '0.1', value: S.athlete.weightKg });
    const kcal = el('input', { type: 'number', step: '10', value: S.athlete.kcal });
    const pmin = el('input', { type: 'number', step: '0.1', value: S.athlete.proteinMin });
    const pmax = el('input', { type: 'number', step: '0.1', value: S.athlete.proteinMax });
    const start = el('input', { type: 'date', value: S.block.start });
    const weeks = el('input', { type: 'number', min: '4', max: '24', value: S.block.weeks });

    card.appendChild(el('div', { class: 'grid two' },
      el('label', { class: 'fld' }, 'Nombre', name),
      el('label', { class: 'fld' }, 'Nombre del bloque (aparece arriba)', blockName),
      el('label', { class: 'fld' }, 'Peso corporal (kg)', weight),
      el('label', { class: 'fld' }, 'Calorías diarias', kcal),
      el('label', { class: 'fld' }, 'Proteína mín. (g/kg)', pmin),
      el('label', { class: 'fld' }, 'Proteína máx. (g/kg)', pmax),
      el('label', { class: 'fld' }, 'Primer lunes', start),
      el('label', { class: 'fld' }, 'Semanas del bloque', weeks)
    ));
    card.appendChild(el('div', { class: 'row', style: { marginTop: '12px' } },
      el('button', {
        class: 'btn primary', text: 'Guardar',
        onclick: () => {
          S.name = name.value.trim() || S.name;
          S.athlete.name = S.name;
          S.block.name = blockName.value.trim() || S.block.name;
          S.athlete.weightKg = num(weight.value) || S.athlete.weightKg;
          S.athlete.kcal = num(kcal.value) || S.athlete.kcal;
          S.athlete.proteinMin = num(pmin.value) || S.athlete.proteinMin;
          S.athlete.proteinMax = num(pmax.value) || S.athlete.proteinMax;
          S.block.start = start.value || S.block.start;
          S.block.weeks = Math.max(4, num(weeks.value) || 12);
          save(true); render(); toast('Perfil guardado');
        }
      }),
      el('button', { class: 'btn sm ghost', text: 'Repetir el alta guiada', onclick: openOnboarding }),
      el('span', { class: 'tiny muted', text: 'Proteína objetivo: ' + Math.round(S.athlete.proteinMin * S.athlete.weightKg) + '–' + Math.round(S.athlete.proteinMax * S.athlete.weightKg) + ' g/día' })
    ));
    const exp = el('select');
    [['principiante', 'Principiante · menos de 1 año'], ['intermedio', 'Intermedio · 1 a 3 años'], ['avanzado', 'Avanzado · más de 3 años']].forEach(([id, label]) => {
      exp.appendChild(el('option', { value: id, text: label, selected: (S.athlete.experience || 'intermedio') === id ? true : null }));
    });
    card.appendChild(el('div', { class: 'row', style: { marginTop: '10px', alignItems: 'flex-end' } },
      el('label', { class: 'fld', style: { maxWidth: '280px' } }, 'Experiencia (para estimar cargas)', exp),
      el('button', {
        class: 'btn sm', text: 'Recalcular cargas estimadas',
        onclick: () => {
          S.athlete.experience = exp.value;
          const fresh = CE.seedLoads(S);
          let n = 0;
          Object.keys(fresh).forEach((exId) => {
            const tieneDatos = CE.lastEntryFor(S.logs, exId);
            if (!tieneDatos && fresh[exId]) { S.loads[exId] = fresh[exId]; n++; }
          });
          save(true); render();
          toast(n ? 'Recalculadas ' + n + ' cargas (las que ya registraste no se tocan)' : 'No hay cargas estimadas que cambiar');
        }
      })
    ));
    card.appendChild(el('p', { class: 'tiny muted', style: { marginTop: '6px' }, text: 'Las cargas son una estimación a partir de tu peso corporal y tu experiencia (banca ≈ 0,40 × peso; hip thrust ≈ 1,10 ×; lateral ≈ 0,05 ×). En cuanto registras una serie, manda tu dato.' }));

    const otros = profileList().filter(function (p) { return p.id !== S.id; });
    if (otros.length) {
      const sel = el('select', { style: { maxWidth: '240px' } });
      otros.forEach(function (p) { sel.appendChild(el('option', { value: p.id, text: p.name || 'Atleta' })); });
      card.appendChild(el('hr', { class: 'sep' }));
      card.appendChild(el('div', { class: 'row', style: { alignItems: 'flex-end' } },
        el('label', { class: 'fld' }, 'Misma rutina que', sel),
        el('button', {
          class: 'btn sm', text: 'Traer su programa',
          onclick: () => {
            const src = DB.profiles[sel.value];
            if (!src || !src.program) { toast('Ese perfil no tiene programa'); return; }
            S.program = JSON.parse(JSON.stringify(src.program));
            S.block.freq = src.block.freq;
            const fresh = CE.seedLoads(S);
            Object.keys(fresh).forEach(function (exId) {
              if (!CE.lastEntryFor(S.logs, exId)) S.loads[exId] = fresh[exId];
            });
            save(true); render();
            toast('Programa copiado · tus cargas se calculan con tu peso');
          }
        })
      ));
      card.appendChild(el('p', { class: 'tiny muted', style: { marginTop: '6px' }, text: 'Copia ejercicios, series, repeticiones y RIR. Tus cargas y tus registros no se tocan: se recalculan con tu peso y tu experiencia.' }));
    }
    return card;
  }

  function equipmentCard() {
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-title' },
      el('h2', { text: 'Material disponible' }),
      el('span', { class: 'meta', text: S.equipment.length + ' de ' + CE.EQUIPMENT.length })
    ));
    card.appendChild(el('p', { class: 'hint', text: 'Desmarca lo que no tengas: el programa cambia esos ejercicios por variantes que sí puedes hacer, sin tocar tus series ni tus repeticiones. El peso corporal siempre cuenta.' }));
    const grid = el('div', { class: 'equip-grid' });
    CE.EQUIPMENT.forEach((item) => {
      const on = item.always || S.equipment.indexOf(item.id) >= 0;
      const box = el('input', { type: 'checkbox', checked: on ? true : null, disabled: item.always ? true : null });
      const lab = el('label', { class: 'equip' + (on ? '' : ' off') + (item.always ? ' always' : '') },
        box,
        el('span', {}, el('b', { text: item.label }), el('span', { text: item.hint || '' }))
      );
      box.addEventListener('change', () => {
        let eq = S.equipment.slice();
        if (box.checked) { if (eq.indexOf(item.id) < 0) eq.push(item.id); }
        else eq = eq.filter((id) => id !== item.id);
        S.equipment = eq;
        /* en sitio: conserva tus series, reps y ejercicios elegidos */
        const changes = CE.applyConstraints(S.program, { exMap: EX, equipment: S.equipment, prefs: S.prefs });
        save(true); render();
        const replaced = changes.filter((c) => c.to).length;
        toast(replaced ? 'Cambiados ' + replaced + ' ejercicios por falta de material' : 'Material actualizado');
      });
      grid.appendChild(lab);
    });
    card.appendChild(grid);
    card.appendChild(el('div', { class: 'row', style: { marginTop: '12px' } },
      el('button', {
        class: 'btn sm ghost', text: 'Reconstruir desde la plantilla',
        onclick: () => {
          S.program = CE.buildProgram({ n: S.block.freq, exMap: EX, loads: S.loads, equipment: S.equipment, prefs: S.prefs, swaps: S.swaps });
          save(true); render();
          toast('Programa reconstruido con tu material y tus gustos');
        }
      }),
      el('span', { class: 'tiny muted', text: 'vuelve al reparto original del bloque' })
    ));
    return card;
  }

  function cycleCardSettings() {
    const c = S.cycle || { enabled: false };
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-title' },
      el('h2', { text: 'Ciclo y autorregulación' }),
      el('span', { class: 'meta', text: c.enabled ? 'activo' : 'desactivado' })
    ));
    card.appendChild(el('p', { class: 'hint', text: 'Si lo activas, la app te pregunta por la fuerza en los días de sangrado y ajusta la sesión de ese día (−5 a −8 % y una o dos series menos). No cambia el programa ni la progresión: solo lo que haces hoy.' }));

    const toggle = el('div', { class: 'seg' });
    [['Sí', true], ['No', false]].forEach(([label, val]) => {
      toggle.appendChild(el('button', {
        type: 'button', text: label, 'aria-pressed': !!c.enabled === val ? 'true' : 'false',
        onclick: () => {
          S.cycle = Object.assign({}, S.cycle, { enabled: val });
          save(true); render();
          toast(val ? 'Ciclo activado' : 'Ciclo desactivado');
        }
      }));
    });
    card.appendChild(el('div', { class: 'row' }, el('span', { class: 'tiny muted', text: 'Registrar ciclo' }), toggle));

    if (c.enabled) {
      const last = el('input', { type: 'date', value: c.lastStart || '' });
      const len = el('input', { type: 'number', min: '21', max: '45', value: c.cycleLength || 28 });
      const period = el('input', { type: 'number', min: '2', max: '10', value: c.periodLength || 5 });
      card.appendChild(el('div', { class: 'grid three', style: { marginTop: '10px' } },
        el('label', { class: 'fld' }, 'Último periodo (primer día)', last),
        el('label', { class: 'fld' }, 'Duración del ciclo', len),
        el('label', { class: 'fld' }, 'Días de sangrado', period)
      ));
      card.appendChild(el('div', { class: 'row', style: { marginTop: '8px' } },
        el('button', {
          class: 'btn sm', text: 'Guardar',
          onclick: () => {
            S.cycle = Object.assign({}, S.cycle, {
              lastStart: last.value || S.cycle.lastStart,
              cycleLength: num(len.value) || 28,
              periodLength: num(period.value) || 5
            });
            save(true); render(); toast('Ciclo guardado');
          }
        })
      ));
      const info = CE.cycleInfo(S.cycle, todayISO());
      if (info) {
        card.appendChild(el('div', { class: 'banner', style: { marginTop: '10px' } },
          el('b', { text: 'Hoy: día ' + info.day + ' · ' + CE.CYCLE_PHASE_LABEL[info.phase] + '. ' }),
          el('span', { text: 'Próximo periodo el ' + shortDate(info.nextStart) + ' (' + info.daysToNext + ' días).' })
        ));
      }
      const pat = CE.cyclePattern(S.logs, S.cycle);
      if (pat) {
        card.appendChild(el('p', { class: 'tiny muted', style: { marginTop: '8px' }, text: 'Con ' + pat.samples + ' registros: los días ' + pat.weakest.map((w) => w.day).join(', ') + ' son los que más veces marcas fuerza baja.' }));
      } else {
        card.appendChild(el('p', { class: 'tiny muted', style: { marginTop: '8px' }, text: 'A partir de 4 registros la app empieza a ver tu patrón y a sugerir el ajuste antes de que lo pidas.' }));
      }
    }
    return card;
  }

  function cardioCard() {
    const card = el('div', { class: 'card' });
    const c = S.cardio || { steps: 8000, hiit: 1, protocol: 'hiit_10x1', day: 6 };
    card.appendChild(el('div', { class: 'card-title' },
      el('h2', { text: 'Cardio y pasos' }),
      el('span', { class: 'meta', text: c.hiit ? c.hiit + ' HIIT/semana' : 'sin HIIT' })
    ));
    card.appendChild(el('p', { class: 'hint', text: 'El cardio no compite con la hipertrofia por hacerlo, sino por hacerlo cerca de la fuerza y con demasiada dosis. La base son los pasos; el HIIT va separado de las piernas.' }));

    const steps = el('input', { type: 'number', step: '500', min: '0', max: '30000', value: c.steps });
    const protocol = el('select');
    Object.keys(CE.CARDIO_PROTOCOLS).forEach((id) => {
      const pr = CE.CARDIO_PROTOCOLS[id];
      protocol.appendChild(el('option', { value: id, text: pr.label + ' · ' + pr.minutes + '′', selected: c.protocol === id ? true : null }));
    });
    const day = el('select');
    for (let i = 1; i <= 7; i++) day.appendChild(el('option', { value: i, text: CE.weekdayName(i), selected: c.day === i ? true : null }));

    const hiit = el('div', { class: 'seg' });
    [0, 1, 2].forEach((n) => hiit.appendChild(el('button', {
      type: 'button', text: n === 1 ? '1 / semana' : n === 0 ? 'ninguno' : n + ' / semana',
      'aria-pressed': c.hiit === n ? 'true' : 'false',
      onclick: () => { S.cardio = Object.assign({}, S.cardio, { hiit: n }); save(true); render(); }
    })));

    card.appendChild(el('div', { class: 'grid three' },
      el('label', { class: 'fld' }, 'Pasos al día', steps),
      el('label', { class: 'fld' }, 'HIIT', hiit),
      el('label', { class: 'fld' }, 'Protocolo', protocol)
    ));
    card.appendChild(el('div', { class: 'row', style: { marginTop: '10px', alignItems: 'flex-end' } },
      el('label', { class: 'fld', style: { maxWidth: '220px' } }, 'Día del HIIT', day),
      el('button', {
        class: 'btn sm', text: 'Guardar',
        onclick: () => {
          S.cardio = Object.assign({}, S.cardio, { steps: num(steps.value) || 8000, protocol: protocol.value, day: num(day.value) || 6 });
          save(true); render(); toast('Cardio actualizado');
        }
      })
    ));

    const rec = CE.suggestCardioDay(S.program, EX);
    const warn = CE.cardioWarnings(S.program, S.cardio, EX);
    card.appendChild(el('div', { class: 'row', style: { marginTop: '12px', alignItems: 'center' } },
      el('span', { class: 'tiny muted', text: 'Recomendado para tu reparto: ' + CE.weekdayName(rec.weekday) + ' (' + rec.reason + ')' }),
      rec.weekday !== S.cardio.day ? el('button', {
        class: 'btn sm ghost', text: 'usar',
        onclick: () => { S.cardio.day = rec.weekday; save(true); render(); toast('HIIT movido a ' + CE.weekdayName(rec.weekday)); }
      }) : null
    ));
    warn.forEach((w) => card.appendChild(el('div', { class: 'banner warn', style: { marginTop: '8px' } }, el('span', { text: w }))));
    if (!warn.length) card.appendChild(el('div', { class: 'banner good', style: { marginTop: '8px' } }, el('span', { text: 'Sin conflictos: el HIIT cae lejos del tren inferior.' })));
    return card;
  }

  function prefsCard() {
    const seen = {};
    const rows = [];
    S.program.days.forEach((d) => d.slots.forEach((sl) => { if (!seen[sl.ex]) { seen[sl.ex] = 1; rows.push(sl.ex); } }));
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-title' }, el('h2', { text: 'Ejercicios que no quieres' }), el('span', { class: 'meta', text: rows.length + ' ejercicios' })));
    card.appendChild(el('p', { class: 'hint', text: 'Marca «no» y el motor busca el mejor sustituto con tu material. Marca «sí» y lo prefiere cuando hay empate.' }));
    const list = el('div', { class: 'pref-list' });
    rows.forEach((exId) => {
      const e = CE.exOf(exId, EX);
      const pref = S.prefs[exId] || 'neutral';
      const sg = el('div', { class: 'sg' });
      [['like', 'sí'], ['neutral', 'igual'], ['dislike', 'no']].forEach(([val, label]) => {
        sg.appendChild(el('button', {
          type: 'button', text: label, class: val === 'dislike' ? 'no' : '',
          'aria-pressed': pref === val ? 'true' : 'false',
          onclick: () => setPreference(exId, val)
        }));
      });
      list.appendChild(el('div', { class: 'pref-row' },
        el('div', { class: 'nm' }, e.name),
        sg
      ));
    });
    card.appendChild(list);
    return card;
  }

  function setPreference(exId, value) {
    if (value === 'neutral') delete S.prefs[exId];
    else S.prefs[exId] = value;
    let msg = 'Preferencia guardada';
    if (value === 'dislike') {
      const before = S.program.days.reduce((n, d) => n + d.slots.filter((s) => s.ex === exId).length, 0);
      const changes = CE.applyConstraints(S.program, { exMap: EX, equipment: S.equipment, prefs: S.prefs });
      const replaced = changes.filter((c) => c.to && c.from === exId);
      if (replaced.length) msg = 'Cambiado por «' + replaced[0].toName + '»';
      else if (before) msg = 'No hay sustituto mejor; se queda por ahora';
    }
    save(true); render();
    toast(msg);
  }

  function accountCard() {
    const card = el('div', { class: 'card' });
    const cfg = syncCfg();
    const sess = SYNC_CLIENT && SYNC_CLIENT.session();
    card.appendChild(el('div', { class: 'card-title' },
      el('h2', { text: 'Cuenta y sincronización' }),
      el('span', { class: 'chip ' + (sess ? 'green' : '') , text: sess ? 'conectado' : cfg.url ? 'sin sesión' : 'solo local' })
    ));
    card.appendChild(el('p', { class: 'hint', text: 'Opcional. Sin cuenta, el cuaderno vive solo en este navegador. Con cuenta, tus perfiles se guardan en tu Supabase y puedes abrirlos desde otro dispositivo.' }));

    if (!cfg.url) {
      const url = el('input', { type: 'text', placeholder: 'https://xxxx.supabase.co', value: '' });
      const key = el('input', { type: 'text', placeholder: 'publishable (sb_publishable_…) o anon (eyJ…)', value: '' });
      card.appendChild(el('div', { class: 'grid two' },
        el('label', { class: 'fld' }, 'URL del proyecto', url),
        el('label', { class: 'fld' }, 'anon key', key)
      ));
      const det = el('details', { style: { marginTop: '12px' } });
      det.appendChild(el('summary', { style: { cursor: 'pointer', fontSize: '.85rem', fontWeight: '600' }, text: 'Paso 1: crear la tabla en Supabase (SQL)' }));
      const pre = el('pre', { class: 'sql', text: SETUP_SQL });
      det.appendChild(pre);
      det.appendChild(el('div', { class: 'row tight', style: { marginTop: '6px' } },
        el('button', {
          class: 'btn sm', text: 'Copiar SQL',
          onclick: () => copyText(SETUP_SQL).then(function (ok) {
            if (ok) toast('SQL copiado: pégalo en Supabase → SQL Editor');
            else {
              const r = document.createRange(); r.selectNodeContents(pre);
              const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
              toast('Seleccionado: copia con Cmd + C');
            }
          })
        }),
        el('span', { class: 'tiny muted', text: 'Supabase → SQL Editor → New query → pegar → Run' })
      ));
      card.appendChild(det);

      card.appendChild(el('div', { class: 'row', style: { marginTop: '10px' } },
        el('button', {
          class: 'btn sm primary', text: 'Guardar configuración',
          onclick: () => {
            const u = window.CuadernoSync.normalizeUrl(url.value), k = key.value.trim();
            if (!u || !k) { toast('Faltan la URL o la clave'); return; }
            saveSyncCfg(u, k);
            initSync(); render();
            toast('Proyecto conectado: ahora crea la cuenta');
          }
        }),
        el('span', { class: 'tiny muted', text: 'Está en Supabase → Settings → API Keys (o en el botón Connect). Es pública; la protección la pone RLS.' })
      ));
      return card;
    }

    if (!sess) {
      const email = el('input', { type: 'email', placeholder: 'tu@correo.com', autocomplete: 'email' });
      const pass = el('input', { type: 'password', placeholder: 'Contraseña (mínimo 6)', autocomplete: 'current-password' });
      card.appendChild(el('div', { class: 'grid two' },
        el('label', { class: 'fld' }, 'Correo', email),
        el('label', { class: 'fld' }, 'Contraseña', pass)
      ));
      const run = async (mode) => {
        const e = email.value.trim(), pw = pass.value;
        if (!e || !pw) { toast('Escribe correo y contraseña'); return; }
        try {
          if (mode === 'up') {
            const r = await SYNC_CLIENT.signUp(e, pw);
            if (r && r.pending) { toast('Cuenta creada: confirma el correo y luego entra'); return; }
          } else {
            await SYNC_CLIENT.signIn(e, pw);
          }
          SYNC_STATE = 'on';
          const rec = await syncNow();
          toast('Conectado · ' + rec.toLocal.length + ' desde la nube, ' + rec.toRemote.length + ' subidos');
        } catch (err) {
          const msg = String(err.message || err);
          if (/invalid login credentials/i.test(msg)) {
            toast(mode === 'in' ? 'Ese correo no tiene cuenta todavía: pulsa «Crear cuenta»' : 'No se pudo crear: revisa correo y contraseña');
          } else if (/already registered|user already/i.test(msg)) {
            toast('Ese correo ya tiene cuenta: pulsa «Entrar»');
          } else if (/email not confirmed/i.test(msg)) {
            toast('Falta confirmar el correo: revisa tu bandeja o desactiva la confirmación en Supabase');
          } else {
            toast('No se pudo: ' + msg);
          }
        }
      };
      card.appendChild(el('div', { class: 'row', style: { marginTop: '10px' } },
        el('button', { class: 'btn sm primary', text: 'Entrar', onclick: () => run('in') }),
        el('button', { class: 'btn sm', text: 'Crear cuenta', onclick: () => run('up') })
      ));
      card.appendChild(el('div', { class: 'row', style: { marginTop: '8px' } },
        el('button', {
          class: 'btn sm', text: 'Probar conexión',
          onclick: async () => {
            try {
              const h = await SYNC_CLIENT.health();
              toast(h.ok ? 'Dominio correcto: ' + h.url : 'Responde ' + h.status + ': revisa la URL');
            } catch (e) {
              toast('No responde: ' + (e.message || e) + '. Copia la URL desde Supabase → Overview → Copy');
            }
          }
        }),
        el('button', { class: 'btn sm ghost', text: 'Cambiar proyecto', onclick: () => { saveSyncCfg('', ''); initSync(); render(); } })
      ));
      return card;
    }

    card.appendChild(el('div', { class: 'banner good' },
      el('b', { text: 'Sesión: ' + (SYNC_CLIENT.userEmail() || '—') + '. ' }),
      el('span', { text: SYNC_LAST ? 'Última sincronización a las ' + SYNC_LAST.toLocaleTimeString('es-ES') + '.' : 'Sincroniza para bajar lo que tengas en la nube.' })
    ));
    card.appendChild(el('div', { class: 'row', style: { marginTop: '10px' } },
      el('button', {
        class: 'btn sm primary', text: 'Sincronizar ahora',
        onclick: async () => {
          try {
            const rec = await syncNow();
            toast('Sincronizado · ' + rec.toLocal.length + ' bajados, ' + rec.toRemote.length + ' subidos');
          } catch (e) { toast('Error: ' + (e.message || e)); }
        }
      }),
      el('button', {
        class: 'btn sm ghost', text: 'Salir',
        onclick: async () => {
          await SYNC_CLIENT.signOut();
          SYNC_STATE = 'off'; SYNC_LAST = null;
          render(); toast('Sesión cerrada (los datos siguen en este navegador)');
        }
      })
    ));
    card.appendChild(el('p', { class: 'tiny muted', style: { marginTop: '8px' }, text: 'El SQL para crear la tabla está en supabase/schema.sql del repositorio. Cada persona ve solo sus filas.' }));
    return card;
  }

  function dataCard() {
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-title' }, el('h2', { text: 'Datos' }), el('span', { class: 'meta', text: profileList().length === 1 ? '1 perfil' : profileList().length + ' perfiles' })));
    card.appendChild(el('p', { class: 'hint', text: 'Todo vive en este navegador. La copia .json incluye todos los perfiles; la clave de OpenAI nunca se exporta.' }));
    card.appendChild(el('div', { class: 'row', style: { marginTop: '8px' } },
      el('button', { class: 'btn sm', text: 'Descargar .json', onclick: exportJSON }),
      el('button', { class: 'btn sm', text: 'Exportar CSV', onclick: exportCSV }),
      el('label', { class: 'btn sm', text: 'Importar .json' },
        el('input', { type: 'file', accept: '.json,application/json', class: 'hidden', onchange: (ev) => importJSON(ev.target.files[0]) })
      ),
      el('button', { class: 'btn sm ghost', text: 'Borrar todo', onclick: confirmReset })
    ));
    return card;
  }

  /* ------------------------------------------------------------------ *
   * IA (OpenAI) — la clave es tuya y se queda en este navegador
   * ------------------------------------------------------------------ */
  const AI_KEY_LS = 'cuaderno.aikey';
  const AI_MODEL_LS = 'cuaderno.aimodel';
  const AI_OK_LS = 'cuaderno.aiok';
  const AI_MODELS = [
    ['gpt-4o-mini', 'gpt-4o-mini · rápido y barato'],
    ['gpt-4o', 'gpt-4o · mejor criterio'],
    ['gpt-4.1-mini', 'gpt-4.1-mini · equilibrado']
  ];

  function aiKey() { try { return localStorage.getItem(AI_KEY_LS) || ''; } catch (e) { return ''; } }
  function aiVerified() { try { return !!localStorage.getItem(AI_OK_LS); } catch (e) { return false; } }
  function setAiVerified(v) { try { if (v) localStorage.setItem(AI_OK_LS, String(Date.now())); else localStorage.removeItem(AI_OK_LS); } catch (e) {} }
  function aiModel() { try { return localStorage.getItem(AI_MODEL_LS) || 'gpt-4o-mini'; } catch (e) { return 'gpt-4o-mini'; } }

  async function aiChat(messages, opts) {
    opts = opts || {};
    const key = aiKey();
    if (!key) throw new Error('Falta la clave. Pégala arriba y guarda.');
    const body = { model: aiModel(), messages: messages, temperature: opts.temperature == null ? 0.4 : opts.temperature };
    if (opts.json) body.response_format = { type: 'json_object' };
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      let detail = res.status + ' ' + res.statusText;
      try { const j = await res.json(); if (j.error && j.error.message) detail = j.error.message; } catch (e) {}
      throw new Error(detail);
    }
    const data = await res.json();
    return (data.choices && data.choices[0] && data.choices[0].message.content) || '';
  }

  function aiCatalog() {
    return Object.keys(EX)
      .filter((id) => CE.isAvailable(EX[id], S.equipment) && S.prefs[id] !== 'dislike')
      .map((id) => id + ' = ' + EX[id].name + ' [' + (CE.MUSCLE_LABEL[EX[id].primary] || '') + ', ' + EX[id].pattern + ']')
      .join('\n');
  }

  function programSummary() {
    return S.program.days.map((d) => d.name + ' (' + CE.weekdayName(d.weekday) + '): ' +
      d.slots.map((s) => (EX[s.ex] ? EX[s.ex].name : s.ex) + ' ' + s.sets + 'x' + s.reps[0] + '-' + s.reps[1] + ' RIR' + s.rir).join('; ')).join('\n');
  }

  function weekdaysFor(n) {
    const map = { 1: [1], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6] };
    return map[Math.max(1, Math.min(6, n))] || [1, 2, 4, 5];
  }

  async function aiDesignWeek() {
    const text = (($('#aiPrompt') && $('#aiPrompt').value) || AI_PROMPT || '').trim();
    AI_PROMPT = text;
    AI_BUSY = true; AI_RESULT = null; render();
    try {
      const system = [
        'Eres entrenador de hipertrofia. Diseñas una semana de entrenamiento en déficit calórico.',
        'Respondes SOLO con un objeto JSON válido, sin markdown ni texto fuera del JSON, con esta forma:',
        '{"notes":"una frase explicando la decisión","frequency":2-6,"days":[{"name":"...","focus":"...","exercises":[{"id":"...","sets":2-5,"reps":[min,max],"rir":0-4,"rest":30-300}]}]}',
        'Reglas: usa solo ids del catálogo; 4-6 ejercicios por sesión; 12-20 series por sesión;',
        'no repitas el mismo ejercicio dos veces en una sesión; si hay 3 o más días, el glúteo aparece al menos dos veces;',
        'en déficit el RIR objetivo es 1-2 en básicos; respeta el material disponible.',
        'rangos de repeticiones por tipo (no los salgas): compuestos 6-10, empuje inclinado y tirón unilateral 8-12,',
        'aislamientos (extensión, femoral, bíceps, tríceps) 8-15, laterales, posterior, pantorrilla y abducción 12-20.',
        'Catálogo (id = nombre [músculo, patrón]):',
        aiCatalog()
      ].join('\n');
      const user = [
        'Perfil: ' + Math.round(S.athlete.weightKg) + ' kg, ' + S.athlete.kcal + ' kcal, déficit calórico, proteína ' + Math.round(S.athlete.proteinMin * S.athlete.weightKg) + '-' + Math.round(S.athlete.proteinMax * S.athlete.weightKg) + ' g.',
        'Días que entrena: ' + S.block.freq,
        'Material: ' + (S.equipment.map((id) => (CE.EQUIPMENT.filter((e) => e.id === id)[0] || {}).label || id).join(', ') || 'solo peso corporal'),
        'Programa actual:', programSummary(),
        'Petición: ' + (text || 'Reajusta la semana para que sea eficiente con lo que tengo.')
      ].join('\n');
      const raw = await aiChat([{ role: 'system', content: system }, { role: 'user', content: user }], { json: true, temperature: 0.3 });
      const clean = String(raw).replace(/```json/gi, '').replace(/```/g, '').trim();
      const plan = JSON.parse(clean);
      AI_RESULT = applyAIPlan(plan);
    } catch (e) {
      AI_RESULT = { kind: 'error', text: e.message || String(e) };
    }
    AI_BUSY = false; render();
  }

  function applyAIPlan(plan) {
    const dropped = [];
    const adjusted = [];
    const days = (plan.days || []).slice(0, 6);
    const built = [];
    days.forEach((d, i) => {
      const slots = [];
      (d.exercises || []).forEach((ex) => {
        const id = String(ex.id || '').trim();
        if (!EX[id]) { dropped.push((ex.id || '?') + ' (no existe)'); return; }
        if (!CE.isAvailable(EX[id], S.equipment)) { dropped.push(EX[id].name + ' (sin material)'); return; }
        if (S.prefs[id] === 'dislike') { dropped.push(EX[id].name + ' (no te gusta)'); return; }
        const sets = Math.max(1, Math.min(6, Math.round(num(ex.sets) || 3)));
        let reps = Array.isArray(ex.reps) ? [Math.max(1, Math.min(30, Math.round(num(ex.reps[0]) || 8))), Math.max(1, Math.min(30, Math.round(num(ex.reps[1]) || 10)))] : [8, 10];
        if (reps[1] < reps[0]) reps = [reps[0], reps[0]];
        const clamped = CE.clampRepsFor(EX[id], reps);
        if (clamped[0] !== reps[0] || clamped[1] !== reps[1]) {
          adjusted.push(EX[id].name + ': ' + reps[0] + '–' + reps[1] + ' → ' + clamped[0] + '–' + clamped[1]);
          reps = clamped;
        }
        slots.push({
          ex: id, sets: sets, reps: reps,
          rir: Math.max(0, Math.min(4, num(ex.rir) === 0 ? 0 : (num(ex.rir) || 2))),
          rest: Math.max(30, Math.min(300, Math.round(num(ex.rest) || 90)))
        });
      });
      if (slots.length) {
        built.push({ id: 'ai_' + (i + 1), kind: 'ai_' + (i + 1), name: d.name || ('Sesión ' + (i + 1)), focus: d.focus || '', weekday: 1, slots: slots });
      }
    });
    if (!built.length) {
      return { kind: 'error', text: 'La propuesta no tenía ejercicios válidos con tu material. Prueba a describir mejor los días o el equipo.' };
    }
    const wd = weekdaysFor(built.length);
    built.forEach((d, i) => { d.weekday = wd[i] || (i + 1); });
    const program = { n: built.length, label: built.length + ' días · propuesta IA', note: plan.notes || '', days: built };
    if (CE.countSets(program) > 76) CE.fitToTarget(program, EX);
    AI_UNDO = { program: JSON.parse(JSON.stringify(S.program)), freq: S.block.freq };
    S.program = program;
    S.block.freq = built.length;
    save(true);
    return {
      kind: 'plan', notes: plan.notes || '', dropped: dropped, adjusted: adjusted,
      days: built.map((d) => ({ name: d.name, focus: d.focus, weekday: d.weekday, slots: d.slots.length })),
      sets: CE.countSets(program),
      tonnage: CE.programStats(program, S.loads, EX).tonnage
    };
  }

  async function aiReview() {
    AI_BUSY = true; AI_RESULT = null; render();
    try {
      const weeks = CE.weeklySummary(S, EX).slice(-4);
      const vol = CE.volumeRows(CE.volumeOf(S.program, EX));
      const payload = {
        perfil: Math.round(S.athlete.weightKg) + ' kg, ' + S.athlete.kcal + ' kcal, déficit',
        dias: S.block.freq,
        material: S.equipment,
        programas: programSummary(),
        volumen_por_musculo: vol.map((r) => ({ musculo: r.label, series: r.total, rango: r.range })),
        semanas: weeks.map((w) => ({ semana: CE.weekNumber(S.block.start, w.weekStart), series: w.sets, tonelaje: w.tonnage, preparacion: w.avgReadiness }))
      };
      const raw = await aiChat([
        { role: 'system', content: 'Eres entrenador de hipertrofia en déficit calórico. Responde en español, en 6 a 10 líneas, concreto y sin rodeos: qué está funcionando, qué ajustarías esta semana y qué vigilar. Sin listas largas ni disclaimers.' },
        { role: 'user', content: JSON.stringify(payload) }
      ], { temperature: 0.5 });
      AI_RESULT = { kind: 'text', title: 'Revisión del bloque', text: raw.trim() };
    } catch (e) {
      AI_RESULT = { kind: 'error', text: e.message || String(e) };
    }
    AI_BUSY = false; render();
  }

  async function aiTest() {
    AI_BUSY = true; AI_RESULT = null; render();
    try {
      const raw = await aiChat([{ role: 'user', content: 'Responde solo: conexión correcta' }], { temperature: 0 });
      setAiVerified(true);
      AI_RESULT = { kind: 'text', title: 'Conexión correcta', text: raw.trim() };
    } catch (e) {
      setAiVerified(false);
      AI_RESULT = { kind: 'error', text: e.message || String(e) };
    }
    AI_BUSY = false; render();
  }

  function aiCard() {
    const card = el('div', { class: 'card' });
    const hasKey = !!aiKey();
    card.appendChild(el('div', { class: 'card-title' },
      el('h2', { text: 'Asistente' }),
      el('span', {
        class: 'chip ' + (aiVerified() ? 'green' : hasKey ? 'amber' : ''),
        text: aiVerified() ? 'probado y conectado' : hasKey ? 'clave guardada, sin probar' : 'sin clave'
      })
    ));
    card.appendChild(el('p', { class: 'hint', text: 'Propone programas y revisa tu progreso. La clave es tuya, se guarda solo en este navegador y las llamadas van directas a OpenAI; nunca pasa por un servidor nuestro.' }));

    const key = el('input', { type: 'password', placeholder: 'sk-...', value: hasKey ? '••••••••••••' : '', autocomplete: 'off' });
    const model = el('select');
    AI_MODELS.forEach(([id, label]) => model.appendChild(el('option', { value: id, text: label, selected: aiModel() === id ? true : null })));
    card.appendChild(el('div', { class: 'grid two' },
      el('label', { class: 'fld' }, 'Clave de OpenAI', key),
      el('label', { class: 'fld' }, 'Modelo', model)
    ));
    card.appendChild(el('div', { class: 'row', style: { marginTop: '10px' } },
      el('button', {
        class: 'btn sm', text: 'Guardar clave',
        onclick: () => {
          const v = key.value.trim();
          if (!v || /^•+$/.test(v)) { toast('Escribe la clave completa'); return; }
          try { localStorage.setItem(AI_KEY_LS, v); localStorage.setItem(AI_MODEL_LS, model.value); } catch (e) {}
          render(); toast('Clave guardada en este navegador');
        }
      }),
      el('button', { class: 'btn sm', text: 'Probar', disabled: AI_BUSY || !hasKey, onclick: aiTest }),
      hasKey ? el('button', {
        class: 'btn sm ghost', text: 'olvidar',
        onclick: () => { try { localStorage.removeItem(AI_KEY_LS); } catch (e) {} render(); toast('Clave borrada'); }
      }) : null
    ));
    if (!hasKey) {
      const help = el('div', { class: 'banner', style: { marginTop: '10px', flexDirection: 'column', alignItems: 'stretch', gap: '6px' } });
      help.appendChild(el('b', { text: 'Cómo conseguir la clave (2 minutos)' }));
      const steps = el('ol', { style: { margin: '4px 0 0 18px', padding: '0', fontSize: '.82rem', lineHeight: '1.6' } });
      steps.appendChild(el('li', {}, 'Entra en ', el('a', { href: 'https://platform.openai.com/api-keys', target: '_blank', rel: 'noopener', text: 'platform.openai.com/api-keys' }), ' e inicia sesión (o crea la cuenta).'));
      steps.appendChild(el('li', {}, 'Si es la primera vez, añade saldo en ', el('a', { href: 'https://platform.openai.com/settings/organization/billing/overview', target: '_blank', rel: 'noopener', text: 'Billing' }), '. La API es de pago por uso, no entra con ChatGPT Plus.'));
      steps.appendChild(el('li', {}, 'Pulsa ', el('b', { text: 'Create new secret key' }), ', ponle nombre (por ejemplo «cuaderno») y crea.'));
      steps.appendChild(el('li', {}, 'Copia la clave: empieza por ', el('span', { class: 'mono', text: 'sk-' }), ' y solo se muestra una vez.'));
      steps.appendChild(el('li', {}, 'Pégala arriba, pulsa ', el('b', { text: 'Guardar clave' }), ' y luego ', el('b', { text: 'Probar' }), '.'));
      help.appendChild(steps);
      help.appendChild(el('div', { class: 'row tight', style: { marginTop: '6px' } },
        el('a', { class: 'btn sm', href: 'https://platform.openai.com/api-keys', target: '_blank', rel: 'noopener', text: 'Abrir OpenAI → API keys' }),
        el('a', { class: 'btn sm ghost', href: 'https://platform.openai.com/settings/organization/limits', target: '_blank', rel: 'noopener', text: 'Poner límite de gasto' })
      ));
      help.appendChild(el('div', { class: 'ai-warn', style: { marginTop: '6px' }, text: 'Recomendado: una clave solo para el cuaderno y con límite mensual. Si la clave se filtra, se borra y se crea otra.' }));
      card.appendChild(help);
    }

    card.appendChild(el('hr', { class: 'sep' }));
    const ta = el('textarea', { id: 'aiPrompt', placeholder: 'Ej.: 3 días, tengo barra, mancuernas y banco. No me gusta la sentadilla búlgara. Quiero prioridad glúteo y hombro, y que las sesiones no pasen de 60 minutos.' });
    ta.value = AI_PROMPT;
    ta.addEventListener('input', () => { AI_PROMPT = ta.value; });
    card.appendChild(el('label', { class: 'fld' }, 'Qué quieres cambiar', ta));
    card.appendChild(el('div', { class: 'ai-actions', style: { marginTop: '10px' } },
      el('button', { class: 'btn primary', text: AI_BUSY ? 'Pensando…' : 'Diseñar mi semana', disabled: (AI_BUSY || !hasKey) ? true : null, onclick: aiDesignWeek }),
      el('button', { class: 'btn', text: 'Revisar mi progreso', disabled: (AI_BUSY || !hasKey) ? true : null, onclick: aiReview })
    ));

    if (AI_RESULT) card.appendChild(renderAIResult(AI_RESULT));
    return card;
  }

  function renderAIResult(r) {
    const box = el('div', { class: 'ai-out', style: { marginTop: '12px' } });
    if (r.kind === 'error') {
      box.appendChild(el('b', { class: 'red', text: 'No se pudo completar. ' }));
      box.appendChild(document.createTextNode(r.text));
      box.appendChild(el('div', { class: 'tiny muted', style: { marginTop: '6px' }, text: 'Si es un error de clave o de cuota, revísala en platform.openai.com. Si es un bloqueo del navegador, prueba desde la app instalada.' }));
      return box;
    }
    if (r.kind === 'text') {
      box.appendChild(el('h3', { text: r.title }));
      box.appendChild(document.createTextNode(r.text));
      return box;
    }
    box.appendChild(el('h3', { text: 'Semana propuesta · ' + r.days.length + ' días · ' + r.sets + ' series' }));
    if (r.notes) box.appendChild(el('div', { style: { marginBottom: '8px' } }, el('i', { text: r.notes })));
    r.days.forEach((d) => box.appendChild(el('div', { class: 'tiny', text: CE.weekdayName(d.weekday) + ' · ' + d.name + ' — ' + d.slots + ' ejercicios' })));
    if (r.dropped && r.dropped.length) {
      box.appendChild(el('div', { class: 'tiny amber', style: { marginTop: '8px' }, text: 'Descartado: ' + r.dropped.join(', ') }));
    }
    if (r.adjusted && r.adjusted.length) {
      box.appendChild(el('div', { class: 'tiny muted', style: { marginTop: '4px' }, text: 'Rangos corregidos: ' + r.adjusted.join(' · ') }));
    }
    box.appendChild(el('div', { class: 'tiny muted', style: { marginTop: '8px' }, text: 'Tonelaje previsto ' + tn(r.tonnage) + '. Ya está aplicado: revísalo en Programa.' }));
    if (AI_UNDO) {
      box.appendChild(el('div', { class: 'row', style: { marginTop: '8px' } },
        el('button', {
          class: 'btn sm', text: 'Deshacer y volver a mi programa anterior',
          onclick: () => {
            S.program = AI_UNDO.program;
            S.block.freq = AI_UNDO.freq;
            AI_UNDO = null; AI_RESULT = null;
            save(true); render(); toast('Programa anterior restaurado');
          }
        })
      ));
    }
    return box;
  }

  function confirmReset() {
    openSheet('Borrar todo', 'Se borran todos los perfiles, sus registros y sus cargas de este navegador. Descarga antes una copia si la quieres conservar.', el('div', {}), [
      { label: 'Cancelar', ghost: true, onClick: closeSheet },
      { label: 'Borrar todo', primary: true, onClick: () => { try { localStorage.removeItem(KEY); localStorage.removeItem(KEY_OLD); } catch (e) {} location.reload(); } }
    ]);
  }

  /* ------------------------------------------------------------------ *
   * render raíz
   * ------------------------------------------------------------------ */
  function render() {
    refreshDerived();
    renderChrome();
    const root = $('#view');
    if (!root) return;
    clear(root);
    root.appendChild(viewFor(TAB));
    const banner = $('#storageBanner');
    if (banner) banner.classList.toggle('hidden', storageOK);
  }

  function viewFor(tab) {
    if (tab === 'semana') return viewWeek();
    if (tab === 'programa') return viewProgram();
    if (tab === 'progreso') return viewProgress();
    if (tab === 'ajustes') return viewSettings();
    if (tab === 'bloque') return viewDoc();
    return viewToday();
  }

  /* ------------------------------------------------------------------ *
   * PWA: instalar, offline y actualizaciones
   * ------------------------------------------------------------------ */
  let DEFERRED_PROMPT = null;

  function isStandalone() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  function iosInstallHint() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIOS || isStandalone()) return null;
    try { if (localStorage.getItem('cuaderno.iosInstall') === '1') return null; } catch (e) {}
    return el('div', { class: 'banner' },
      el('div', {}, el('b', { text: 'Úsalo como app: ' }), 'Compartir → Añadir a pantalla de inicio. Se abre a pantalla completa y funciona sin cobertura.'),
      el('button', {
        class: 'btn sm ghost', text: 'entendido',
        onclick: () => { try { localStorage.setItem('cuaderno.iosInstall', '1'); } catch (e) {} render(); }
      })
    );
  }

  function setupPWA() {
    /* En iOS una PWA sin usar puede perder el almacenamiento; esto lo reduce. */
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(function () {});
    }
    const btn = $('#installBtn');
    window.addEventListener('beforeinstallprompt', (ev) => {
      ev.preventDefault();
      DEFERRED_PROMPT = ev;
      if (btn) btn.classList.remove('hidden');
    });
    window.addEventListener('appinstalled', () => {
      if (btn) btn.classList.add('hidden');
      toast('Añadida a la pantalla de inicio');
    });
    if (btn) btn.addEventListener('click', function () {
      if (!DEFERRED_PROMPT) { toast('Usa el menú del navegador: «Instalar aplicación»'); return; }
      DEFERRED_PROMPT.prompt();
      DEFERRED_PROMPT.userChoice.then((choice) => {
        if (choice && choice.outcome === 'accepted') toast('Instalando…');
        DEFERRED_PROMPT = null;
        btn.classList.add('hidden');
      });
    });

    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Hay una versión nueva', { label: 'recargar', onClick: () => location.reload() });
          }
        });
      });
    }).catch(() => { /* sin service worker: la app sigue funcionando online */ });
  }

  /* ------------------------------------------------------------------ *
   * arranque
   * ------------------------------------------------------------------ */
  function init() {
    DB = readStore();
    S = DB.profiles[DB.activeId];
    if (!S.program || !S.program.days) {
      S.program = CE.buildProgram({ n: S.block.freq, exMap: CE.getExMap(S.custom), loads: S.loads, swaps: S.swaps, equipment: S.equipment, prefs: S.prefs });
    }
    if (!S.loads || !Object.keys(S.loads).length) S.loads = CE.seedLoads(S);
    refreshDerived();

    /* tema */
    const savedTheme = (function () { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } })();
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

    /* pestañas */
    $$('.tab').forEach(t => t.addEventListener('click', () => go(t.dataset.tab)));

    const pbtn = $('#profileBtn');
    if (pbtn) pbtn.addEventListener('click', openProfiles);

    const themeBtn = $('#themeBtn');
    if (themeBtn) themeBtn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', cur);
      try { localStorage.setItem(THEME_KEY, cur); } catch (e) {}
    });

    const modal = $('#modal');
    if (modal) modal.addEventListener('click', (ev) => { if (ev.target === modal) closeSheet(); });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeSheet(); });

    const tSkip = $('#timerSkip');
    if (tSkip) tSkip.addEventListener('click', stopTimer);
    const tPlus = $('#timerPlus');
    if (tPlus) tPlus.addEventListener('click', () => { TIMER.end += 15000; TIMER.on = true; tick(); });
    const tMinus = $('#timerMinus');
    if (tMinus) tMinus.addEventListener('click', () => { TIMER.end = Math.max(Date.now() + 5000, TIMER.end - 15000); TIMER.on = true; tick(); });

    /* enlace directo a una pestaña: #semana, #programa… */
    const hash = (location.hash || '').replace('#', '');
    if (['hoy', 'semana', 'programa', 'progreso', 'ajustes', 'bloque'].indexOf(hash) >= 0) TAB = hash;

    setupPWA();
    initSync();
    /* Si venimos de un enlace de confirmación de Supabase, el token está en la URL */
    if (SYNC_CLIENT) {
      try {
        if (SYNC_CLIENT.adoptUrl(location.hash)) {
          SYNC_STATE = 'on';
          history.replaceState(null, '', location.pathname + location.search);
          setTimeout(function () { toast('Cuenta confirmada. Sincronizando…'); }, 400);
        }
      } catch (e) { /* hash no válido */ }
    }

    save(true);
    const params = new URLSearchParams(location.search);
    if (!S.onboarded && params.get('demo') !== '1' && params.get('selftest') !== '1') openOnboarding();
    if (new URLSearchParams(location.search).get('selftest') === '1') return runSelfTest();
    if (new URLSearchParams(location.search).get('demo') === '1') seedDemo();
    render();
    if (SYNC_CLIENT && SYNC_CLIENT.session()) {
      syncNow().catch(function (e) { SYNC_STATE = 'error'; SYNC_ERR = e.message; renderSyncChip(); });
    }
  }

  /* ------------------------------------------------------------------ *
   * autoprueba visual (para verificar sin consola)
   * ------------------------------------------------------------------ */
  function runSelfTest() {
    const res = CE.selfTest();
    const root = $('#view');
    clear(root);
    const card = el('div', { class: 'card' });
    const fails = res.filter(r => !r.pass);
    card.appendChild(el('h1', { text: fails.length ? 'FALLOS: ' + fails.length + '/' + res.length : 'OK: ' + res.length + ' pruebas' }));
    const ul = el('ul');
    res.forEach(r => ul.appendChild(el('li', { text: (r.pass ? '✔ ' : '✖ ') + r.name + (r.detail ? ' — ' + r.detail : '') })));
    card.appendChild(ul);
    root.appendChild(card);
    document.title = fails.length ? 'SELFTEST FAIL' : 'SELFTEST OK';
  }

  /* datos de demostración, solo con ?demo=1 y sin registros previos */
  function seedDemo() {
    if (Object.keys(S.logs).length) return;
    const today = new Date();
    const monday = CE.mondayOf(today);
    const first = CE.addDays(monday, -21);
    S.block.start = CE.toISODate(first);
    const plan = S.program.days;
    for (let w = 0; w < 4; w++) {
      plan.forEach(d => {
        const date = CE.toISODate(CE.addDays(first, w * 7 + (d.weekday - 1)));
        if (CE.parseDate(date) > today) return;
        const score = 58 + Math.round(Math.random() * 32);
        const light = score >= 75 ? 'green' : score >= 50 ? 'amber' : 'red';
        const advice = light === 'green'
          ? 'Verde: mantén el plan. Si te sobra margen, añade una serie al primer ejercicio, nunca al último.'
          : light === 'amber'
            ? 'Ámbar: baja una serie en los dos últimos ejercicios y sube el RIR objetivo a 2–3. Hoy no se suben cargas.'
            : 'Rojo: aplica −5 % en toda la sesión, recorta dos series de accesorios y no busques récords.';
        const log = { sessionId: d.id, entries: {}, readiness: { score: score, light: light, advice: advice }, modifier: 0, optional: {}, completed: true };
        d.slots.forEach(s => {
          if (s.optional) return;
          const base = S.loads[s.ex] || 20;
          const load = Math.round(base * (1 + w * 0.02) / 2.5) * 2.5;
          log.entries[s.ex] = {
            load: load,
            sets: Array.from({ length: s.sets }, (_, i) => ({
              load: load, reps: Math.max(s.reps[0], s.reps[1] - (i > 1 ? 1 : 0)), rir: s.rir, done: true
            }))
          };
        });
        S.logs[date] = log;
      });
    }
    S.onboarded = true;
    save(true);
  }

  window.Cuaderno = {
    render: render, state: () => S, engine: CE, demo: seedDemo,
    reset: () => { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
