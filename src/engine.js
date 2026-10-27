/* ============================================================================
   cuaderno · engine.js
   Lógica pura del bloque de hipertrofia en déficit.
   Sin DOM, sin storage: se puede probar con `node --test` y se inyecta en la UI.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CE = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;

  /* ------------------------------------------------------------------ *
   * 1. Músculos y rangos semanales (series efectivas)
   * ------------------------------------------------------------------ */
  const MUSCLES = [
    { id: 'glute',      label: 'Glúteo',              short: 'Glúteo',     group: 'lower' },
    { id: 'glute_med',  label: 'Glúteo medio',        short: 'G. medio',   group: 'lower' },
    { id: 'ham',        label: 'Isquiosurales',       short: 'Isquios',    group: 'lower' },
    { id: 'quad',       label: 'Cuádriceps',          short: 'Cuádriceps', group: 'lower' },
    { id: 'calf',       label: 'Pantorrilla',         short: 'Pantorrilla',group: 'lower' },
    { id: 'back',       label: 'Espalda / dorsal',    short: 'Espalda',    group: 'upper' },
    { id: 'chest',      label: 'Pecho',               short: 'Pecho',      group: 'upper' },
    { id: 'delt_front', label: 'Deltoides anterior',  short: 'Delt. frontal', group: 'upper' },
    { id: 'delt_side',  label: 'Deltoides lateral',   short: 'Delt. lateral', group: 'upper' },
    { id: 'delt_rear',  label: 'Deltoides posterior', short: 'Delt. post.',   group: 'upper' },
    { id: 'biceps',     label: 'Bíceps',              short: 'Bíceps',     group: 'upper' },
    { id: 'triceps',    label: 'Tríceps',             short: 'Tríceps',    group: 'upper' },
    { id: 'core',       label: 'Core',                short: 'Core',       group: 'other' }
  ];

  // Rango del documento (mín, máx) y objetivo operativo.
  const RANGE = {
    glute:      [14, 20], glute_med: [3, 8],   ham:  [10, 15],
    quad:       [6, 10],  calf:      [6, 10],  back: [10, 14],
    chest:      [6, 10],  delt_front:[4, 8],   delt_side: [5, 10],
    delt_rear:  [4, 8],   biceps:    [7, 11],  triceps:   [6, 10],
    core:       [0, 6]
  };
  // Objetivo operativo = punto medio del rango, con el glúteo en el extremo alto
  // porque es la prioridad declarada del bloque.
  const AIM = {
    glute: 16, glute_med: 5, ham: 12, quad: 8, calf: 7,
    back: 11, chest: 7, delt_front: 5, delt_side: 7, delt_rear: 5,
    biceps: 8, triceps: 7, core: 3
  };
  const PRIORITY = ['glute', 'delt_side', 'calf', 'ham']; // no se recortan al bajar frecuencia

  const MUSCLE_LABEL = {};
  MUSCLES.forEach(m => { MUSCLE_LABEL[m.id] = m.label; });

  function rangeOf(id) { return RANGE[id] || [0, 0]; }
  function aimOf(id) { return AIM[id] || 0; }

  /* ------------------------------------------------------------------ *
   * 2. Biblioteca de ejercicios
   *    bwFactor = carga de calibración como fracción del peso corporal.
   * ------------------------------------------------------------------ */
  // pattern: agrupación para sugerir sustitutos en el editor.
  const EX_POOL = {
    /* --- glúteo / cadera --- */
    hip_thrust:      { name: 'Hip thrust con barra',      pattern: 'hip_thrust', equipment: 'barra',   primary: 'glute',      secondary: ['ham'],                incPct: 5,    axial: 0, unilateral: false, rest: 180, bwFactor: 1.10, step: 2.5, cue: 'Costillas abajo, mirada al frente, pausa de 1 s arriba.' },
    hip_thrust_smith:{ name: 'Hip thrust en Smith',       pattern: 'hip_thrust', equipment: 'máquina', primary: 'glute',      secondary: ['ham'],                incPct: 5,    axial: 0, unilateral: false, rest: 180, bwFactor: 1.20, step: 2.5, cue: 'Mismo recorrido, apoyo más estable.' },
    bridge_bb:       { name: 'Puente de glúteo',          pattern: 'hip_thrust', equipment: 'barra',   primary: 'glute',      secondary: ['ham'],                incPct: 5,    axial: 0, unilateral: false, rest: 120, bwFactor: 0.90, step: 2.5, cue: 'Rango corto: no busques hiperextensión.' },
    kickback:        { name: 'Patada de glúteo en polea', pattern: 'kickback',   equipment: 'polea',   primary: 'glute',      secondary: [],                     incPct: 5,    axial: 0, unilateral: true,  rest: 60,  bwFactor: 0.15, step: 2.5, cue: 'Cadera quieta; el movimiento es solo de cadera.' },
    abduction:       { name: 'Abducción de cadera',       pattern: 'abduction',  equipment: 'máquina', primary: 'glute_med',  secondary: [],                     incPct: 5,    axial: 0, unilateral: false, rest: 75,  bwFactor: 0.30, step: 2.5, cue: 'Torso ligeramente inclinado, sin rebote.' },
    /* --- bisagra --- */
    rdl:             { name: 'Peso muerto rumano',        pattern: 'hinge',      equipment: 'barra',   primary: 'ham',        secondary: ['glute'],              incPct: 5,    axial: 1, unilateral: false, rest: 180, bwFactor: 0.70, step: 2.5, cue: 'Bisagra pura: barra pegada, isquios en tensión.' },
    sumo:            { name: 'Peso muerto sumo',          pattern: 'hinge',      equipment: 'barra',   primary: 'glute',      secondary: ['ham', 'quad', 'back'],incPct: 5,    axial: 1, unilateral: false, rest: 180, bwFactor: 0.95, step: 2.5, cue: 'Empuja el suelo, no tires de la espalda.' },
    trap_bar:        { name: 'Peso muerto con trap bar',  pattern: 'hinge',      equipment: 'trap bar',primary: 'glute',      secondary: ['ham', 'quad', 'back'],incPct: 5,    axial: 1, unilateral: false, rest: 180, bwFactor: 1.05, step: 2.5, cue: 'Alternativa al sumo con menos demanda lumbar.' },
    good_morning:    { name: 'Good morning',              pattern: 'hinge',      equipment: 'barra',   primary: 'ham',        secondary: ['glute'],              incPct: 5,    axial: 1, unilateral: false, rest: 150, bwFactor: 0.35, step: 2.5, cue: 'Solo si la técnica está muy asentada.' },
    /* --- cuádriceps --- */
    bulgarian:       { name: 'Sentadilla búlgara',        pattern: 'lunge',      equipment: 'mancuernas', primary: 'quad',    secondary: ['glute'],              incPct: 5,    axial: 0, unilateral: true,  rest: 150, bwFactor: 0.30, step: 2, cue: 'Pie trasero elevado; baja controlando, sin rebote.' },
    hack:            { name: 'Hack squat',                pattern: 'squat',      equipment: 'máquina', primary: 'quad',       secondary: ['glute'],              incPct: 5,    axial: 0, unilateral: false, rest: 120, bwFactor: 0.90, step: 2.5, cue: 'Talones apoyados, profundidad que no rompa la pelvis.' },
    leg_press:       { name: 'Prensa de piernas',         pattern: 'squat',      equipment: 'máquina', primary: 'quad',       secondary: ['glute'],              incPct: 5,    axial: 0, unilateral: false, rest: 120, bwFactor: 1.30, step: 5,   cue: 'Sin bloquear del todo la rodilla arriba.' },
    back_squat:      { name: 'Sentadilla con barra',      pattern: 'squat',      equipment: 'barra',   primary: 'quad',       secondary: ['glute', 'back'],      incPct: 5,    axial: 2, unilateral: false, rest: 180, bwFactor: 0.55, step: 2.5, cue: 'Fuera del bloque; vuelve cuando suban las calorías.' },
    leg_ext:         { name: 'Extensión de rodillas',     pattern: 'knee_ext',   equipment: 'máquina', primary: 'quad',       secondary: [],                     incPct: 5,    axial: 0, unilateral: false, rest: 60,  bwFactor: 0.35, step: 2.5, cue: 'Pausa de 1 s arriba, sin lanzar.' },
    /* --- femoral --- */
    leg_curl_seated: { name: 'Curl femoral sentado',      pattern: 'knee_flex',  equipment: 'máquina', primary: 'ham',        secondary: [],                     incPct: 5,    axial: 0, unilateral: false, rest: 90,  bwFactor: 0.30, step: 2.5, cue: 'Cadera pegada al respaldo, rango completo.' },
    leg_curl_lying:  { name: 'Curl femoral tumbado',      pattern: 'knee_flex',  equipment: 'máquina', primary: 'ham',        secondary: [],                     incPct: 5,    axial: 0, unilateral: false, rest: 90,  bwFactor: 0.25, step: 2.5, cue: 'Pelvis neutra; no arquees la lumbar.' },
    /* --- pantorrilla --- */
    calf_standing:   { name: 'Elevación de pantorrilla de pie', pattern: 'calf', equipment: 'máquina', primary: 'calf',       secondary: [],                     incPct: 5,    axial: 0, unilateral: false, rest: 90,  bwFactor: 0.75, step: 2.5, cue: 'Iso de 3 s arriba y estiramiento abajo.' },
    calf_seated:     { name: 'Elevación de pantorrilla sentado', pattern: 'calf', equipment: 'máquina', primary: 'calf',      secondary: [],                     incPct: 5,    axial: 0, unilateral: false, rest: 75,  bwFactor: 0.50, step: 2.5, cue: 'Rodilla flexionada: trabaja el sóleo.' },
    /* --- empuje --- */
    bench:           { name: 'Press de banca',            pattern: 'push_h',     equipment: 'barra',   primary: 'chest',      secondary: ['triceps', 'delt_front'], incPct: 2.5, axial: 0, unilateral: false, rest: 180, bwFactor: 0.40, step: 1.25, cue: 'Escápulas retraídas, barra a la línea del pezón.' },
    incline_db:      { name: 'Press inclinado con mancuernas', pattern: 'push_i', equipment: 'mancuernas', primary: 'chest',   secondary: ['delt_front', 'triceps'], incPct: 2.5, axial: 0, unilateral: false, rest: 120, bwFactor: 0.22, step: 2, cue: '30–45°, recorrido sin choque de mancuernas.' },
    ohp:             { name: 'Press militar',             pattern: 'push_v',     equipment: 'barra',   primary: 'delt_front', secondary: ['triceps'],            incPct: 2.5, axial: 1, unilateral: false, rest: 150, bwFactor: 0.25, step: 1.25, cue: 'Glúteo y abdomen apretados; no arquees.' },
    lateral_raise:   { name: 'Elevación lateral',         pattern: 'lateral',    equipment: 'mancuernas', primary: 'delt_side', secondary: [],                  incPct: 2.5, axial: 0, unilateral: false, rest: 60,  bwFactor: 0.05, step: 1, cue: 'Codos ligeramente flexionados, hasta la línea del hombro.' },
    lateral_cable:   { name: 'Elevación lateral en polea',pattern: 'lateral',    equipment: 'polea',   primary: 'delt_side',  secondary: [],                     incPct: 2.5, axial: 0, unilateral: true,  rest: 60,  bwFactor: 0.07, step: 2.5, cue: 'Tensión constante; el cable va por delante del cuerpo.' },
    face_pull:       { name: 'Face pull / deltoides posterior', pattern: 'rear_delt', equipment: 'polea', primary: 'delt_rear', secondary: ['back'],          incPct: 2.5, axial: 0, unilateral: false, rest: 60,  bwFactor: 0.20, step: 2.5, cue: 'Cuerda a la cara, codos altos, pausa atrás.' },
    rear_delt_fly:   { name: 'Pájaros en polea',          pattern: 'rear_delt',  equipment: 'polea',   primary: 'delt_rear',  secondary: ['back'],               incPct: 2.5, axial: 0, unilateral: false, rest: 60,  bwFactor: 0.04, step: 1, cue: 'Escápulas estables, movimiento de hombro.' },
    triceps_pushdown:{ name: 'Extensión de tríceps en polea', pattern: 'triceps', equipment: 'polea',  primary: 'triceps',    secondary: [],                     incPct: 2.5, axial: 0, unilateral: false, rest: 60,  bwFactor: 0.20, step: 2.5, cue: 'Codos fijos al costado, extensión completa.' },
    triceps_oh:      { name: 'Extensión de tríceps sobre la cabeza', pattern: 'triceps', equipment: 'polea', primary: 'triceps', secondary: [],                    incPct: 2.5, axial: 0, unilateral: false, rest: 60,  bwFactor: 0.15, step: 2.5, cue: 'Estira el tríceps largo: es el que más crece.' },
    /* --- tirón --- */
    lat_pulldown:    { name: 'Jalón al pecho',            pattern: 'pull_v',     equipment: 'polea',   primary: 'back',       secondary: ['biceps'],             incPct: 2.5, axial: 0, unilateral: false, rest: 120, bwFactor: 0.45, step: 2.5, cue: 'Codos hacia el bolsillo, sin balanceo.' },
    pullup:          { name: 'Dominadas',                 pattern: 'pull_v',     equipment: 'peso corporal', primary: 'back', secondary: ['biceps'],             incPct: 2.5, axial: 0, unilateral: false, rest: 150, bwFactor: 0.00, step: 2.5, cue: 'Si no salen 8, usa jalón o asistencia.' },
    row_barbell:     { name: 'Remo con barra',            pattern: 'pull_h',     equipment: 'barra',   primary: 'back',       secondary: ['biceps'],             incPct: 2.5, axial: 1, unilateral: false, rest: 120, bwFactor: 0.45, step: 1.25, cue: 'Torso a 45°, sin tirones de lumbar.' },
    row_machine:     { name: 'Remo en máquina',           pattern: 'pull_h',     equipment: 'máquina', primary: 'back',       secondary: ['biceps'],             incPct: 2.5, axial: 0, unilateral: false, rest: 120, bwFactor: 0.50, step: 2.5, cue: 'Pecho apoyado: cero trampa.' },
    row_cable_uni:   { name: 'Remo unilateral en polea',  pattern: 'pull_uni',   equipment: 'polea',   primary: 'back',       secondary: ['biceps'],             incPct: 2.5, axial: 0, unilateral: true,  rest: 90,  bwFactor: 0.30, step: 2.5, cue: 'Deja que la escápula avance y vuelva.' },
    /* --- brazos --- */
    biceps_curl:     { name: 'Curl de bíceps',            pattern: 'biceps',     equipment: 'mancuernas', primary: 'biceps',   secondary: [],                     incPct: 2.5, axial: 0, unilateral: false, rest: 60,  bwFactor: 0.09, step: 1, cue: 'Sin columpio; supinación completa arriba.' },
    hammer_curl:     { name: 'Curl martillo',             pattern: 'biceps',     equipment: 'mancuernas', primary: 'biceps',   secondary: [],                     incPct: 2.5, axial: 0, unilateral: false, rest: 60,  bwFactor: 0.10, step: 1, cue: 'Neutro: trabaja braquial y antebrazo.' },
    /* --- core --- */
    ab_wheel:        { name: 'Rueda abdominal',           pattern: 'core',       equipment: 'accesorio', primary: 'core',     secondary: [],                     incPct: 5,    axial: 0, unilateral: false, rest: 60,  bwFactor: 0.00, step: 2.5, cue: 'Costillas cerradas; no dejes caer la lumbar.' },
    plank:           { name: 'Plancha',                   pattern: 'core',       equipment: 'peso corporal', primary: 'core', secondary: [],                    incPct: 5,    axial: 0, unilateral: false, rest: 60,  bwFactor: 0.00, step: 2.5, cue: 'Series por tiempo, no por repeticiones.' }
  };

  const EX = {}; // pool + custom, rellenado por getExMap
  function poolEx(id) { return EX_POOL[id]; }
  function getExMap(custom) {
    const map = {};
    Object.keys(EX_POOL).forEach(k => {
      const e = Object.assign({ id: k }, EX_POOL[k]);
      map[k] = e;
    });
    (custom || []).forEach(e => { if (e && e.id) map[e.id] = Object.assign({}, e); });
    return map;
  }
  function exOf(id, exMap) {
    return (exMap && exMap[id]) || EX_POOL[id] || { id: id, name: id, primary: 'core', secondary: [], incPct: 2.5, step: 2.5, rest: 90, bwFactor: 0 };
  }

  /* ------------------------------------------------------------------ *
   * 3. Plantillas por frecuencia (el 4 es el programa del documento)
   * ------------------------------------------------------------------ */
  function slot(ex, sets, reps, rir, extra) {
    return Object.assign({ ex: ex, sets: sets, reps: reps, rir: rir }, extra || {});
  }

  const TEMPLATE_4 = {
    n: 4,
    label: '4 días · el programa del documento',
    note: 'Dos sesiones de tren inferior con glúteo directo y dos de tren superior. Ninguna pasa de 18 series duras.',
    days: [
      { id: 'lower_a', kind: 'lower_a', weekday: 1, name: 'Tren inferior A', focus: 'Glúteo y cadera', slots: [
        slot('hip_thrust', 4, [8, 10], 2, { rest: 180 }),
        slot('rdl', 3, [8, 10], 2, { rest: 180 }),
        slot('leg_curl_seated', 3, [10, 12], 1, { rest: 90 }),
        slot('abduction', 3, [15, 20], 1, { rest: 75 }),
        slot('calf_standing', 2, [10, 12], 1.5, { rest: 90 }),
        slot('leg_ext', 2, [12, 15], 1, { rest: 60, optional: true })
      ]},
      { id: 'upper_a', kind: 'upper_a', weekday: 2, name: 'Tren superior A', focus: 'Empuje', slots: [
        slot('bench', 3, [6, 8], 2, { rest: 180 }),
        slot('incline_db', 3, [8, 10], 2, { rest: 120 }),
        slot('ohp', 2, [8, 10], 2, { rest: 150 }),
        slot('lateral_raise', 4, [12, 15], 1, { rest: 60 }),
        slot('triceps_pushdown', 3, [10, 12], 1, { rest: 60 }),
        slot('face_pull', 2, [15, 20], 1, { rest: 60 })
      ]},
      { id: 'lower_b', kind: 'lower_b', weekday: 4, name: 'Tren inferior B', focus: 'Glúteo unilateral y cuádriceps', slots: [
        slot('sumo', 3, [6, 8], 2, { rest: 180 }),
        slot('bulgarian', 4, [8, 10], 2, { rest: 150 }),
        slot('hack', 4, [10, 12], 1.5, { rest: 120 }),
        slot('leg_curl_lying', 2, [10, 12], 1, { rest: 90 }),
        slot('kickback', 2, [15, 20], 1, { rest: 60 }),
        slot('calf_seated', 2, [12, 15], 1, { rest: 75 })
      ]},
      { id: 'upper_b', kind: 'upper_b', weekday: 5, name: 'Tren superior B', focus: 'Tirón', slots: [
        slot('lat_pulldown', 3, [8, 10], 1.5, { rest: 120 }),
        slot('row_barbell', 3, [8, 10], 1.5, { rest: 120 }),
        slot('row_cable_uni', 2, [10, 12], 1, { rest: 90 }),
        slot('lateral_cable', 3, [12, 15], 1, { rest: 60 }),
        slot('biceps_curl', 3, [10, 12], 1, { rest: 60 }),
        slot('face_pull', 2, [15, 20], 1, { rest: 60 }),
        slot('calf_standing', 2, [12, 15], 1, { rest: 75 })
      ]}
    ]
  };

  const TEMPLATE_3 = {
    n: 3,
    label: '3 días · cuerpo completo con prioridad glúteo',
    note: 'Se fusionan los dos días de tren superior en uno. Se pierde algo de pecho y brazo; el glúteo se protege.',
    days: [
      { id: 'lower_a', kind: 'lower_a', weekday: 1, name: 'Tren inferior A', focus: 'Glúteo y cadera', slots: [
        slot('hip_thrust', 4, [8, 10], 2, { rest: 180 }),
        slot('rdl', 3, [8, 10], 2, { rest: 180 }),
        slot('leg_curl_seated', 3, [10, 12], 1, { rest: 90 }),
        slot('abduction', 3, [15, 20], 1, { rest: 75 }),
        slot('calf_standing', 2, [10, 12], 1.5, { rest: 90 }),
        slot('leg_ext', 2, [12, 15], 1, { rest: 60, optional: true })
      ]},
      { id: 'upper_full', kind: 'upper_a', weekday: 3, name: 'Tren superior completo', focus: 'Empuje y tirón', slots: [
        slot('bench', 3, [6, 8], 2, { rest: 180 }),
        slot('lat_pulldown', 3, [8, 10], 1.5, { rest: 120 }),
        slot('row_barbell', 3, [8, 10], 1.5, { rest: 120 }),
        slot('ohp', 2, [8, 10], 2, { rest: 150 }),
        slot('lateral_raise', 3, [12, 15], 1, { rest: 60 }),
        slot('face_pull', 2, [15, 20], 1, { rest: 60 }),
        slot('biceps_curl', 2, [10, 12], 1, { rest: 60, superset: 'arms' }),
        slot('triceps_pushdown', 2, [10, 12], 1, { rest: 60, superset: 'arms' })
      ]},
      { id: 'lower_b', weekday: 5, name: 'Tren inferior B', focus: 'Glúteo unilateral y cuádriceps', slots: [
        slot('sumo', 3, [6, 8], 2, { rest: 180 }),
        slot('bulgarian', 4, [8, 10], 2, { rest: 150 }),
        slot('hack', 3, [10, 12], 1.5, { rest: 120 }),
        slot('leg_curl_lying', 2, [10, 12], 1, { rest: 90 }),
        slot('kickback', 2, [15, 20], 1, { rest: 60 }),
        slot('calf_seated', 2, [12, 15], 1, { rest: 75 }),
        slot('abduction', 2, [15, 20], 1, { rest: 60 })
      ]}
    ]
  };

  const TEMPLATE_2 = {
    n: 2,
    label: '2 dias · cuerpo completo (mantenimiento)',
    note: 'Con dos sesiones no cabe todo: se conservan glúteo, bisagra y los básicos; pecho, espalda y brazos caen a la mitad. Es mantenimiento, no el plan completo.',
    days: [
      { id: 'full_a', kind: 'lower_a', weekday: 1, name: 'Cuerpo completo A', focus: 'Glúteo, cuádriceps y empuje', slots: [
        slot('hip_thrust', 5, [8, 10], 2, { rest: 180 }),
        slot('rdl', 3, [8, 10], 2, { rest: 180 }),
        slot('bulgarian', 4, [8, 10], 2, { rest: 150 }),
        slot('bench', 3, [6, 8], 2, { rest: 150 }),
        slot('lat_pulldown', 3, [8, 10], 1.5, { rest: 120 }),
        slot('lateral_raise', 3, [12, 15], 1, { rest: 60 }),
        slot('calf_standing', 2, [12, 15], 1, { rest: 75 })
      ]},
      { id: 'full_b', kind: 'lower_b', weekday: 4, name: 'Cuerpo completo B', focus: 'Cadera, glúteo y tirón', slots: [
        slot('sumo', 3, [6, 8], 2, { rest: 180 }),
        slot('hack', 3, [10, 12], 1.5, { rest: 150 }),
        slot('leg_curl_lying', 2, [10, 12], 1, { rest: 90 }),
        slot('ohp', 2, [8, 10], 2, { rest: 150 }),
        slot('row_barbell', 3, [8, 10], 1.5, { rest: 120 }),
        slot('lateral_raise', 2, [12, 15], 1, { rest: 60 }),
        slot('calf_standing', 2, [12, 15], 1, { rest: 75 }),
        slot('biceps_curl', 2, [10, 12], 1, { rest: 60 }),
        slot('triceps_pushdown', 2, [10, 12], 1, { rest: 60 }),
        slot('abduction', 2, [15, 20], 1, { rest: 60 })
      ]}
    ]
  };

  // Días extra para 5 y 6: sesiones cortas de prioridad, no más volumen bruto.
  const ACCESSORY_5 = {
    id: 'accessory_glute', weekday: 3, name: 'Prioridad · glúteo y brazos', focus: 'Sesión corta', slots: [
      slot('kickback', 3, [12, 15], 1, { rest: 60 }),
      slot('abduction', 3, [15, 20], 1, { rest: 60 }),
      slot('leg_curl_lying', 2, [10, 12], 1, { rest: 75 }),
      slot('biceps_curl', 2, [10, 12], 1, { rest: 60, superset: 'arms2' }),
      slot('triceps_pushdown', 2, [10, 12], 1, { rest: 60, superset: 'arms2' }),
      slot('calf_seated', 2, [12, 15], 1, { rest: 60 })
    ]
  };
  const ACCESSORY_6 = {
    id: 'accessory_delt', weekday: 6, name: 'Prioridad · hombro y pantorrilla', focus: 'Sesión corta', slots: [
      slot('lateral_cable', 3, [12, 15], 1, { rest: 60 }),
      slot('face_pull', 3, [15, 20], 1, { rest: 60 }),
      slot('rear_delt_fly', 2, [15, 20], 1, { rest: 60 }),
      slot('calf_standing', 3, [10, 12], 1, { rest: 60 }),
      slot('biceps_curl', 2, [10, 12], 1, { rest: 60 }),
      slot('triceps_oh', 2, [10, 12], 1, { rest: 60 })
    ]
  };

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function templateFor(n) {
    n = Math.max(2, Math.min(6, n | 0));
    if (n === 2) return clone(TEMPLATE_2);
    if (n === 3) return clone(TEMPLATE_3);
    if (n === 4) return clone(TEMPLATE_4);
    const base = clone(TEMPLATE_4);
    if (n === 5) {
      base.n = 5; base.label = '5 días · 4 sesiones + prioridad';
      base.note = 'Se recortan una o dos series de los accesorios de los 4 días y se añade una sesión corta de prioridad. El total semanal sube poco.';
      // recorte proporcional de accesorios para hacer sitio
      base.days.forEach(d => d.slots.forEach(s => {
        if (['face_pull', 'calf_standing', 'calf_seated', 'leg_ext'].includes(s.ex) && s.sets > 2) s.sets -= 1;
      }));
      base.days.splice(2, 0, clone(ACCESSORY_5));
      return base;
    }
    base.n = 6; base.label = '6 días · 4 sesiones + 2 de prioridad';
    base.note = 'Dos sesiones cortas extra. En déficit, seis días solo se sostienen si el sueño y la proteína están en orden.';
    base.days.forEach(d => d.slots.forEach(s => {
      if (['face_pull', 'calf_standing', 'calf_seated', 'leg_ext', 'abduction'].includes(s.ex) && s.sets > 2) s.sets -= 1;
    }));
    base.days.splice(2, 0, clone(ACCESSORY_5));
    base.days.push(clone(ACCESSORY_6));
    return base;
  }

  /* ------------------------------------------------------------------ *
   * 4. Volumen efectivo y estadísticas
   *    Series efectivas = directas (1,0) + indirectas (0,5 por músculo).
   * ------------------------------------------------------------------ */
  function volumeOf(program, exMap) {
    const vol = {};
    MUSCLES.forEach(m => { vol[m.id] = { direct: 0, indirect: 0, total: 0 }; });
    program.days.forEach(day => day.slots.forEach(s => {
      if (s.optional) return; // las series opcionales no cuentan hasta que se activan
      const e = exOf(s.ex, exMap);
      if (e.primary && vol[e.primary]) vol[e.primary].direct += s.sets;
      else if (e.primary) vol[e.primary] = { direct: s.sets, indirect: 0, total: s.sets };
      (e.secondary || []).forEach(m => { if (vol[m]) vol[m].indirect += s.sets * 0.5; });
    }));
    Object.keys(vol).forEach(k => { vol[k].total = vol[k].direct + vol[k].indirect; });
    return vol;
  }

  function countSets(program, includeOptional) {
    let n = 0;
    program.days.forEach(d => d.slots.forEach(s => { if (!s.optional || includeOptional) n += s.sets; }));
    return n;
  }

  const SET_SECONDS = 40; // tiempo efectivo bajo tensión + transición

  function sessionMinutes(day, exMap) {
    let sec = 8 * 60; // calentamiento
    const supersetGroups = {};
    day.slots.forEach(s => {
      if (s.optional) return;
      const e = exOf(s.ex, exMap);
      const rest = s.rest || e.rest || 90;
      if (s.superset) {
        supersetGroups[s.superset] = supersetGroups[s.superset] || [];
        supersetGroups[s.superset].push({ s, rest });
      } else {
        sec += s.sets * (SET_SECONDS + rest);
      }
    });
    // En superserie el descanso se comparte entre los dos ejercicios.
    Object.keys(supersetGroups).forEach(k => {
      const group = supersetGroups[k];
      const rest = Math.max.apply(null, group.map(g => g.rest));
      const sets = group.reduce((a, g) => a + g.s.sets, 0);
      sec += sets * (SET_SECONDS + rest * 0.55);
    });
    return Math.round(sec / 60);
  }

  function midReps(s) { return (s.reps[0] + s.reps[1]) / 2; }

  function sessionStats(day, loads, exMap) {
    const minutes = sessionMinutes(day, exMap);
    let sets = 0, tonnage = 0, tonnageMin = 0, tonnageMax = 0;
    day.slots.forEach(s => {
      if (s.optional) return;
      const load = (loads && loads[s.ex]) || 0;
      sets += s.sets;
      tonnageMin += s.sets * s.reps[0] * load;
      tonnageMax += s.sets * s.reps[1] * load;
      tonnage += s.sets * midReps(s) * load;
    });
    return { sets: sets, tonnage: Math.round(tonnage), tonnageMin: Math.round(tonnageMin), tonnageMax: Math.round(tonnageMax), minutes: minutes };
  }

  function programStats(program, loads, exMap) {
    const vol = volumeOf(program, exMap);
    let sets = 0, tonnage = 0, tonnageMin = 0, tonnageMax = 0, minutes = 0;
    const sessions = program.days.map(day => {
      const st = sessionStats(day, loads, exMap);
      sets += st.sets; tonnage += st.tonnage; tonnageMin += st.tonnageMin; tonnageMax += st.tonnageMax;
      minutes += st.minutes;
      return Object.assign({ id: day.id, name: day.name, weekday: day.weekday }, st);
    });
    return { sets: sets, tonnage: tonnage, tonnageMin: tonnageMin, tonnageMax: tonnageMax, minutes: minutes, volume: vol, sessions: sessions };
  }

  /* Orden y agrupación únicos para todas las tablas de volumen:
     el deltoides se muestra como una sola fila (suma de sus tres porciones). */
  const VOLUME_ORDER = ['glute', 'ham', 'back', 'deltoids', 'quad', 'chest', 'calf', 'biceps', 'triceps', 'glute_med'];

  function aggregateVolume(vol) {
    return VOLUME_ORDER.map(id => {
      if (id === 'deltoids') {
        const total = (vol.delt_front ? vol.delt_front.total : 0) + (vol.delt_side ? vol.delt_side.total : 0) + (vol.delt_rear ? vol.delt_rear.total : 0);
        return { id: 'deltoids', label: 'Deltoides', total: round1(total), range: [12, 16], aim: 16 };
      }
      return { id: id, label: MUSCLE_LABEL[id] || id, total: round1(vol[id] ? vol[id].total : 0), range: rangeOf(id), aim: aimOf(id) };
    });
  }

  function volumeRows(vol) {
    return aggregateVolume(vol).map(r => {
      const lo = r.range[0], hi = r.range[1];
      let status = 'ok';
      if (r.total < lo - 0.6) status = 'low';
      if (r.total > hi + 0.6) status = 'high';
      return { id: r.id, label: r.label, total: r.total, range: r.range, status: status, aim: r.aim };
    });
  }

  function round1(x) { return Math.round(x * 10) / 10; }
  function roundTo(x, step) { step = step || 2.5; return Math.max(step, Math.round(x / step) * step); }

  /* ------------------------------------------------------------------ *
   * 5. Auto-ajuste de la semana al cambiar la frecuencia
   * ------------------------------------------------------------------ */
  const CAP = { 2: 23, 3: 21, 4: 18, 5: 17, 6: 16 };
  // 67 activas + 2 opcionales = 69, como el documento.
  const TOTAL_TARGET = { 2: 46, 3: 56, 4: 67, 5: 72, 6: 76 };
  function capFor(n) { return CAP[n] || 18; }
  function totalTargetFor(n) { return TOTAL_TARGET[n] || 69; }

  /* Reparte/recorta series hasta acercarse al objetivo semanal, respetando
     el techo por sesión y protegiendo los músculos prioritarios. */
  function fitToTarget(program, exMap) {
    const target = totalTargetFor(program.n);
    const moves = [];
    let guard = 0;
    while (countSets(program) > target && guard++ < 200) {
      // quita de la sesión más cargada, en el accesorio menos prioritario
      const day = program.days.slice().sort((a, b) => countSets({ days: [b] }) - countSets({ days: [a] }))[0];
      const cand = day.slots.filter(s => !s.optional && s.sets > 2 && !PRIORITY.includes(exOf(s.ex, exMap).primary))
        .sort((a, b) => weight(b, exMap) - weight(a, exMap));
      const pick = cand[0] || day.slots.filter(s => !s.optional && s.sets > 1).sort((a, b) => weight(b, exMap) - weight(a, exMap))[0];
      if (!pick) break;
      pick.sets -= 1;
      moves.push({ type: 'remove', ex: pick.ex, name: exOf(pick.ex, exMap).name, session: day.name, sets: 1 });
    }
    guard = 0;
    while (countSets(program) < target && guard++ < 200) {
      const day = program.days.slice().sort((a, b) => countSets({ days: [a] }) - countSets({ days: [b] }))[0];
      if (countSets({ days: [day] }) >= capFor(program.n)) {
        const other = program.days.find(d => countSets({ days: [d] }) < capFor(program.n));
        if (!other) break;
        addSet(other, exMap, moves);
      } else addSet(day, exMap, moves);
    }
    return moves;
  }
  // peso de un ejercicio para decidir qué recortar: menor = menos importante
  function weight(s, exMap) {
    const e = exOf(s.ex, exMap);
    const prio = PRIORITY.includes(e.primary) ? 100 : 0;
    const compound = ['hip_thrust', 'hinge', 'squat', 'lunge', 'push_h', 'push_v', 'pull_v', 'pull_h'].includes(e.pattern) ? 10 : 0;
    return prio + compound + s.sets;
  }
  function addSet(day, exMap, moves) {
    const cand = day.slots.filter(s => !s.optional && s.sets < 5)
      .sort((a, b) => weight(b, exMap) - weight(a, exMap))[0];
    if (!cand) return false;
    cand.sets += 1;
    moves.push({ type: 'add', ex: cand.ex, name: exOf(cand.ex, exMap).name, session: day.name, sets: 1 });
    return true;
  }

  /* Reparto por músculo: sube donde falta, quita donde sobra, respetando techos. */
  function rebalance(program, exMap, opts) {
    opts = opts || {};
    const maxIter = opts.iterations || 12;
    const moves = [];
    for (let it = 0; it < maxIter; it++) {
      const vol = volumeOf(program, exMap);
      const deficits = [], surpluses = [];
      MUSCLES.forEach(m => {
        const total = vol[m.id] ? vol[m.id].total : 0;
        const aim = aimOf(m.id);
        const [lo, hi] = rangeOf(m.id);
        if (aim && total < Math.min(aim, lo) * 0.95) deficits.push({ id: m.id, gap: Math.min(aim, lo) - total });
        if (total > hi + 0.5) surpluses.push({ id: m.id, over: total - hi });
      });
      deficits.sort((a, b) => b.gap - a.gap);
      surpluses.sort((a, b) => b.over - a.over);
      let changed = false;

      if (deficits.length && countSets(program) < totalTargetFor(program.n) + 2) {
        const d = deficits[0];
        const cand = findSlotForMuscle(program, d.id, exMap);
        if (cand) {
          cand.slot.sets += 1; changed = true;
          moves.push({ type: 'add', ex: cand.slot.ex, name: exOf(cand.slot.ex, exMap).name, session: cand.day.name, sets: 1, muscle: d.id });
        }
      }
      if (surpluses.length) {
        const s = surpluses[0];
        if (!PRIORITY.includes(s.id)) {
          const cand = findSlotForMuscle(program, s.id, exMap, { remove: true });
          if (cand) {
            cand.slot.sets -= 1; changed = true;
            moves.push({ type: 'remove', ex: cand.slot.ex, name: exOf(cand.slot.ex, exMap).name, session: cand.day.name, sets: 1, muscle: s.id });
          }
        }
      }
      if (!changed) break;
    }
    return moves;
  }
  function findSlotForMuscle(program, muscleId, exMap, opts) {
    opts = opts || {};
    const limit = opts.remove ? 2 : 5;
    const candidates = [];
    program.days.forEach(day => {
      if (countSets({ days: [day] }) >= capFor(program.n) && !opts.remove) return;
      day.slots.forEach(s => {
        if (s.optional) return;
        const e = exOf(s.ex, exMap);
        if (opts.remove ? (s.sets <= limit) : (s.sets >= limit)) return;
        if (e.primary === muscleId) candidates.push({ day: day, slot: s });
        else if ((e.secondary || []).includes(muscleId) && !opts.remove) candidates.push({ day: day, slot: s, secondary: true });
      });
    });
    // prioriza el ejercicio principal y, si no, el que más aporte
    candidates.sort((a, b) => (a.secondary ? 1 : 0) - (b.secondary ? 1 : 0));
    return candidates[0] || null;
  }

  /* Construye el programa para una frecuencia, con overrides y fase aplicados. */
  function buildProgram(opts) {
    opts = opts || {};
    const n = Math.max(2, Math.min(6, opts.n || 4));
    const exMap = opts.exMap || getExMap(opts.custom);
    const tpl = templateFor(n);
    applyOverrides(tpl, opts.overrides);
    applySwaps(tpl, opts.swaps);
    if (opts.fit !== false) { fitToTarget(tpl, exMap); rebalance(tpl, exMap); }
    if (opts.phase && opts.phase.volume && opts.phase.volume !== 1) applyVolume(tpl, opts.phase.volume);
    return tpl;
  }

  /* Sustituciones guardadas por tipo de sesión: si cambias el hip thrust por
     el de Smith, sigue siendo el de Smith cuando reconstruyes el plan. */
  function applySwaps(program, swaps) {
    if (!swaps) return program;
    program.days.forEach(day => {
      const map = swaps[day.kind] || swaps[day.id];
      if (!map) return;
      day.slots.forEach(slot => { if (map[slot.ex]) slot.ex = map[slot.ex]; });
    });
    return program;
  }

  function applyOverrides(program, overrides) {
    if (!overrides) return program;
    program.days.forEach(day => {
      const ov = overrides[day.id];
      if (!ov) return;
      if (ov.slots) {
        day.slots.forEach((s, i) => {
          const o = ov.slots[i];
          if (!o) return;
          if (o.ex) s.ex = o.ex;
          if (typeof o.sets === 'number') s.sets = o.sets;
          if (o.reps) s.reps = o.reps.slice();
          if (typeof o.rir === 'number') s.rir = o.rir;
          if (typeof o.rest === 'number') s.rest = o.rest;
          if (typeof o.optional === 'boolean') s.optional = o.optional;
        });
      }
    });
    return program;
  }

  function applyVolume(program, factor) {
    program.days.forEach(d => d.slots.forEach(s => {
      s.sets = Math.max(1, Math.round(s.sets * factor));
    }));
    return program;
  }

  /* Diferencia entre dos programas, para enseñar qué cambió al pasar de 4 a 3 días. */
  function diffPrograms(a, b, exMap, loads) {
    const va = aggregateVolume(volumeOf(a, exMap));
    const vb = aggregateVolume(volumeOf(b, exMap));
    const rows = va.map((r, i) => ({
      id: r.id, label: r.label,
      before: r.total,
      after: vb[i] ? vb[i].total : 0,
      delta: round1((vb[i] ? vb[i].total : 0) - r.total)
    })).filter(r => r.before || r.after);
    return {
      muscles: rows,
      sets: { before: countSets(a), after: countSets(b) },
      tonnage: { before: programStats(a, loads, exMap).tonnage, after: programStats(b, loads, exMap).tonnage },
      minutes: { before: programStats(a, loads, exMap).minutes, after: programStats(b, loads, exMap).minutes },
      sessions: { before: a.days.length, after: b.days.length }
    };
  }

  /* ------------------------------------------------------------------ *
   * 6. Fases del bloque
   * ------------------------------------------------------------------ */
  function phaseForWeek(week) {
    if (!week || week < 1) return { id: 'pre', name: 'Antes de empezar', rir: 3, volume: 1, note: 'Calibra cargas en la primera sesión: deja 3 repeticiones en reserva.' };
    if (week === 1) return { id: 'cal', name: 'Calibración', rir: 3, volume: 1, note: 'Cargas que dejen 3 reps en reserva. Sin test de e1RM obligatorio.' };
    if (week <= 5) return { id: 'acc', name: 'Acumulación', rir: week <= 2 ? 2 : 1.5, volume: 1, note: 'El RIR baja de 2 a 1–2 conforme se asientan las cargas.' };
    if (week === 6) return { id: 'del', name: 'Descarga', rir: 3.5, volume: 0.5, note: 'Volumen a la mitad, la carga se mantiene, RIR 3–4.' };
    if (week <= 11) return { id: 'int', name: 'Intensificación', rir: 1.5, volume: 1, note: 'Mismas repeticiones, RIR 1–2: la carga se mantiene mientras suben las repeticiones.' };
    if (week === 12) return { id: 'rev', name: 'Descarga y revisión', rir: 4, volume: 0.5, note: 'Sin re-test de fuerza: medidas, fotos y preparación media del bloque.' };
    return { id: 'ext', name: 'Bloque extra', rir: 1.5, volume: 1, note: 'Si el déficit se extiende: repite desde la semana 1 con las cargas alcanzadas.' };
  }

  /* ------------------------------------------------------------------ *
   * 7. Fechas y semanas
   * ------------------------------------------------------------------ */
  function parseDate(s) {
    if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
    const p = String(s).split('-').map(Number);
    return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
  }
  function toISODate(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  function mondayOf(d) {
    const x = parseDate(d);
    const dow = x.getDay() === 0 ? 7 : x.getDay();
    x.setDate(x.getDate() - (dow - 1));
    return x;
  }
  function addDays(d, n) {
    const x = parseDate(d); x.setDate(x.getDate() + n); return x;
  }
  function weekNumber(blockStart, date) {
    const a = mondayOf(blockStart), b = mondayOf(date);
    const diff = Math.round((b - a) / 86400000);
    return Math.floor(diff / 7) + 1;
  }
  const WEEKDAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  function weekdayName(i) { return WEEKDAY_NAMES[(i + 6) % 7]; }

  /* ------------------------------------------------------------------ *
   * 8. Progresión
   * ------------------------------------------------------------------ */
  function lastEntryFor(logs, exId) {
    const dates = Object.keys(logs || {}).sort().reverse();
    for (const date of dates) {
      const log = logs[date];
      if (!log || !log.entries) continue;
      const e = log.entries[exId];
      if (e && e.sets && e.sets.some(s => s && (s.reps || s.load))) return { date: date, entry: e, log: log };
    }
    return null;
  }

  function loadHistory(logs, exId) {
    const out = [];
    Object.keys(logs || {}).sort().forEach(date => {
      const e = logs[date] && logs[date].entries && logs[date].entries[exId];
      if (!e || !e.sets || !e.sets.length) return;
      const loads = e.sets.map(s => s.load).filter(v => typeof v === 'number' && v > 0);
      if (!loads.length) return;
      out.push({ date: date, load: Math.max.apply(null, loads), reps: e.sets.map(s => s.reps) });
    });
    return out;
  }

  /* Devuelve el consejo de carga y el texto exacto de la condición. */
  function advise(slotOrEx, logs, loads, exMap) {
    const exId = typeof slotOrEx === 'string' ? slotOrEx : slotOrEx.ex;
    const e = exOf(exId, exMap);
    const base = (loads && loads[exId]) || 0;
    const repsMin = (slotOrEx.reps && slotOrEx.reps[0]) || null;
    const repsMax = (slotOrEx.reps && slotOrEx.reps[1]) || null;
    const targetRir = typeof slotOrEx.rir === 'number' ? slotOrEx.rir : 2;
    const step = e.step || 2.5;
    const last = lastEntryFor(logs, exId);
    const empty = { action: 'calibrar', nextLoad: base, pct: 0, reason: 'Sin datos: es la primera vez. Empieza con la carga de calibración y deja 3 reps en reserva.', condition: 'Semana 1: calibra.', history: { up: 0, down: 0, sessions: 0 } };

    if (!last) return empty;
    const history = countChanges(logs, exId);

    const sets = (last.entry.sets || []).filter(s => s && typeof s.reps === 'number' && s.reps > 0);
    if (!sets.length) {
      return { action: 'mantener', nextLoad: base, pct: 0, reason: 'Faltan repeticiones o RIR en el registro: se repite la carga en lugar de inventar progresión.', condition: 'Registra reps y RIR para poder progresar.', history: history, last: last.date };
    }
    const loadsUsed = sets.map(s => s.load).filter(v => typeof v === 'number' && v > 0);
    const used = loadsUsed.length ? Math.max.apply(null, loadsUsed) : base;
    const minReps = Math.min.apply(null, sets.map(s => s.reps));
    const maxReps = Math.max.apply(null, sets.map(s => s.reps));
    const firstRir = typeof sets[0].rir === 'number' ? sets[0].rir : null;
    const meanRir = mean(sets.filter(s => typeof s.rir === 'number').map(s => s.rir));

    if (repsMax && minReps >= repsMax && (firstRir === null || firstRir >= Math.max(0, targetRir - 1)) && (meanRir === null || meanRir <= targetRir + 1)) {
      const pct = e.incPct || 2.5;
      const up = Math.max(roundTo(used * (1 + pct / 100), step), used + step);
      return {
        action: 'subir', nextLoad: up, pct: pct, from: used,
        reason: 'Todas las series tocaron el techo del rango (' + repsMax + ') con RIR ' + round1(meanRir === null ? targetRir : meanRir) + '. Toca subir un escalón del ' + pct + '%.',
        condition: 'Sube ' + (e.unilateral ? 'por lado ' : '') + 'un ' + pct + '% cuando las ' + sets.length + ' series lleguen a ' + repsMax + ' reps con RIR ' + targetRir + '.',
        history: history, last: last.date
      };
    }
    if (firstRir === 0 || (repsMin && minReps < repsMin)) {
      const next = Math.min(roundTo(used * 0.95, step), used - step);
      return {
        action: 'bajar', nextLoad: next, pct: -5, from: used,
        reason: firstRir === 0 ? 'La primera serie llegó a RIR 0: en déficit no se persigue el fallo.' : 'Una serie quedó por debajo del mínimo del rango (' + repsMin + ').',
        condition: 'Baja un 5 % y sigue: ' + (repsMin || '') + '–' + (repsMax || '') + ' reps con RIR ' + targetRir + '.',
        history: history, last: last.date
      };
    }
    const toGo = repsMax ? Math.max(0, repsMax - minReps) : 0;
    return {
      action: 'mantener', nextLoad: used, pct: 0, from: used,
      reason: toGo > 0 ? 'Faltan ' + toGo + ' repetición' + (toGo === 1 ? '' : 'es') + ' para tocar el techo: misma carga y suma reps.' : 'Mantén la carga: aún no se cumple la condición para subir.',
      condition: 'Sube cuando todas las series lleguen a ' + (repsMax || '?') + ' reps con RIR ' + targetRir + '.',
      history: history, last: last.date
    };
  }

  function countChanges(logs, exId) {
    const hist = loadHistory(logs, exId);
    let up = 0, down = 0;
    for (let i = 1; i < hist.length; i++) {
      if (hist[i].load > hist[i - 1].load + 0.01) up++;
      else if (hist[i].load < hist[i - 1].load - 0.01) down++;
    }
    return { up: up, down: down, sessions: hist.length };
  }

  function mean(arr) {
    if (!arr || !arr.length) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /* ------------------------------------------------------------------ *
   * 9. Cuestionario de preparación → 0–100 y semáforo
   * ------------------------------------------------------------------ */
  const READINESS_ITEMS = [
    { id: 'sleep',  label: 'Sueño',      hint: '¿Cómo dormiste?',              weight: 1.3, invert: false },
    { id: 'energy', label: 'Energía',    hint: '¿Con ganas de entrenar?',      weight: 1.2, invert: false },
    { id: 'stress', label: 'Estrés',     hint: 'Carga mental y de trabajo',     weight: 1.0, invert: true },
    { id: 'motivation', label: 'Motivación', hint: 'Ganas de hacerlo bien',     weight: 0.8, invert: false },
    { id: 'pain',   label: 'Dolor',      hint: 'Molestias o dolor articular',   weight: 1.2, invert: true },
    { id: 'rpe',    label: 'Sesión previa', hint: 'Cuán duro te dejó',         weight: 0.8, invert: true },
    { id: 'technique', label: 'Técnica', hint: '¿Sientes la técnica sólida?',   weight: 0.9, invert: false },
    { id: 'pump',   label: 'Bombeo',     hint: 'Respuesta muscular al trabajo', weight: 0.6, invert: false },
    { id: 'doms',   label: 'Agujetas',   hint: 'DOMS de días anteriores',       weight: 0.9, invert: true }
  ];

  function readiness(answers) {
    let sum = 0, wsum = 0, answered = 0;
    READINESS_ITEMS.forEach(it => {
      const raw = answers && answers[it.id];
      if (typeof raw !== 'number') return;
      answered++;
      const v = Math.max(0, Math.min(10, raw)); // 0 = peor, 10 = mejor
      const good = it.invert ? 10 - v : v;
      sum += good * it.weight;
      wsum += it.weight;
    });
    if (!answered) return { score: null, light: 'none', advice: 'Sin datos de preparación: entrena con el plan escrito y ajusta por sensación.', items: answered };
    const score = Math.round((sum / wsum) * 10);
    let light = 'red', advice = '';
    if (score >= 75) {
      light = 'green';
      advice = 'Verde: mantén el plan. Si te sobra margen, añade una serie al primer ejercicio, nunca al último.';
    } else if (score >= 50) {
      light = 'amber';
      advice = 'Ámbar: baja una serie en los dos últimos ejercicios y sube el RIR objetivo a 2–3. Hoy no se suben cargas.';
    } else {
      light = 'red';
      advice = 'Rojo: aplica −5 % en toda la sesión, recorta dos series de accesorios y no busques récords. Si se repite dos semanas, adelanta la descarga.';
    }
    return { score: score, light: light, advice: advice, items: answered };
  }

  /* ------------------------------------------------------------------ *
   * 10. Tonelaje real registrado
   * ------------------------------------------------------------------ */
  function logTonnage(log) {
    if (!log || !log.entries) return 0;
    let t = 0;
    Object.keys(log.entries).forEach(exId => {
      const e = log.entries[exId];
      (e.sets || []).forEach(s => {
        if (s && typeof s.reps === 'number' && typeof s.load === 'number') t += s.reps * s.load;
      });
    });
    return Math.round(t);
  }
  function logSets(log) {
    if (!log || !log.entries) return 0;
    let n = 0;
    Object.keys(log.entries).forEach(exId => {
      const e = log.entries[exId];
      n += (e.sets || []).filter(s => s && (s.reps || s.load)).length;
    });
    return n;
  }
  function logByMuscle(log, exMap) {
    const out = {};
    if (!log || !log.entries) return out;
    Object.keys(log.entries).forEach(exId => {
      const e = exOf(exId, exMap);
      const sets = (log.entries[exId].sets || []).filter(s => s && (s.reps || s.load)).length;
      if (!sets) return;
      if (e.primary) out[e.primary] = (out[e.primary] || 0) + sets;
      (e.secondary || []).forEach(m => { out[m] = (out[m] || 0) + sets * 0.5; });
    });
    return out;
  }

  /* Resumen semanal a partir de los registros (semanas naturales desde el lunes). */
  function weeklySummary(state, exMap) {
    const logs = (state && state.logs) || {};
    const weeks = {};
    Object.keys(logs).sort().forEach(date => {
      const wk = toISODate(mondayOf(date));
      weeks[wk] = weeks[wk] || { weekStart: wk, sets: 0, tonnage: 0, sessions: 0, readiness: [], muscles: {} };
      const log = logs[date];
      weeks[wk].sets += logSets(log);
      weeks[wk].tonnage += logTonnage(log);
      weeks[wk].sessions += 1;
      if (log.readiness && typeof log.readiness.score === 'number') weeks[wk].readiness.push(log.readiness.score);
      const bm = logByMuscle(log, exMap);
      Object.keys(bm).forEach(k => { weeks[wk].muscles[k] = round1((weeks[wk].muscles[k] || 0) + bm[k]); });
    });
    return Object.keys(weeks).sort().map(k => {
      const w = weeks[k];
      w.avgReadiness = w.readiness.length ? Math.round(mean(w.readiness)) : null;
      return w;
    });
  }

  /* ------------------------------------------------------------------ *
   * 11. Estado por defecto
   * ------------------------------------------------------------------ */
  function defaultState(today) {
    const t = today ? parseDate(today) : new Date();
    const monday = mondayOf(t);
    const state = {
      version: VERSION,
      athlete: { name: 'Atleta', weightKg: 65, heightCm: 165, kcal: 1675, proteinMin: 1.8, proteinMax: 2.2 },
      block: {
        name: 'Bloque 3 · Hipertrofia en déficit',
        start: toISODate(monday),
        weeks: 12,
        freq: 4,
        supersedes: 'Powerbuilding · 19 de octubre de 2026',
        goal: 'conservar músculo en déficit'
      },
      loads: {},
      overrides: {},
      custom: [],
      logs: {},
      readiness: {},
      measurements: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.loads = seedLoads(state);
    return state;
  }

  function seedLoads(state) {
    const bw = (state.athlete && state.athlete.weightKg) || 65;
    const out = {};
    Object.keys(EX_POOL).forEach(id => {
      const e = EX_POOL[id];
      out[id] = e.bwFactor ? roundTo(e.bwFactor * bw, e.step || 2.5) : 0;
    });
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 12. Validación / migración del estado guardado
   * ------------------------------------------------------------------ */
  function normalizeState(s) {
    return _ensureObj(s);
  }
  function _ensureObj(s) {
    const d = defaultState();
    if (!s || typeof s !== 'object') return d;
    const out = Object.assign({}, d, s);
    out.athlete = Object.assign({}, d.athlete, s.athlete || {});
    out.block = Object.assign({}, d.block, s.block || {});
    out.loads = Object.assign({}, d.loads, s.loads || {});
    out.logs = s.logs && typeof s.logs === 'object' ? s.logs : {};
    out.custom = Array.isArray(s.custom) ? s.custom : [];
    out.measurements = Array.isArray(s.measurements) ? s.measurements : [];
    out.version = VERSION;
    if (!out.block.start) out.block.start = d.block.start;
    out.block.freq = Math.max(2, Math.min(6, out.block.freq || 4));
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 13. Autopruebas (se ejecutan con ?selftest=1 o desde node)
   * ------------------------------------------------------------------ */
  function selfTest() {
    const res = [];
    const ok = (name, cond, detail) => res.push({ name: name, pass: !!cond, detail: detail || '' });
    const near = (a, b) => Math.abs(a - b) < 0.05;
    const exMap = getExMap([]);
    const st = defaultState('2026-10-26');
    const p4 = buildProgram({ n: 4, exMap: exMap, loads: st.loads, fit: false });
    const v4 = volumeOf(p4, exMap);
    ok('4 días: 67 series base', countSets(p4) === 67, countSets(p4) + ' series');
    ok('4 días: glúteo 14,5', near(v4.glute.total, 14.5), v4.glute.total);
    ok('4 días: isquios 11,5', near(v4.ham.total, 11.5), v4.ham.total);
    ok('4 días: espalda 11,5', near(v4.back.total, 11.5), v4.back.total);
    ok('4 días: deltoides 16', near(v4.delt_front.total + v4.delt_side.total + v4.delt_rear.total, 16), v4.delt_front.total + v4.delt_side.total + v4.delt_rear.total);
    ok('4 días: pecho 6', near(v4.chest.total, 6), v4.chest.total);
    ok('4 días: pantorrilla 6', near(v4.calf.total, 6), v4.calf.total);
    ok('4 días: 4 sesiones', p4.days.length === 4, p4.days.length);

    for (let n = 2; n <= 6; n++) {
      const p = buildProgram({ n: n, exMap: exMap, loads: st.loads });
      const stats = programStats(p, st.loads, exMap);
      const vol = volumeOf(p, exMap);
      const cap = capFor(n);
      const over = p.days.filter(d => countSets({ days: [d] }) > cap);
      ok(n + ' días: sesiones ≤ ' + cap + ' series', over.length === 0, p.days.map(d => countSets({ days: [d] })).join('/'));
      ok(n + ' días: glúteo ≥ 12', vol.glute.total >= 12, round1(vol.glute.total));
      ok(n + ' días: duración 25–105 min', stats.sessions.every(s => s.minutes >= 25 && s.minutes <= 105), stats.sessions.map(s => s.minutes).join('/'));
      ok(n + ' días: tonelaje > 0', stats.tonnage > 0, stats.tonnage);
    }

    // Progresión
    const logs = {};
    logs['2026-10-26'] = { entries: { bench: { sets: [{ reps: 8, load: 40, rir: 2 }, { reps: 8, load: 40, rir: 2 }, { reps: 8, load: 40, rir: 2 }] } } };
    const advUp = advise({ ex: 'bench', reps: [6, 8], rir: 2 }, logs, { bench: 40 }, exMap);
    ok('progresión: sube al tocar el techo', advUp.action === 'subir' && advUp.nextLoad === 41.25, advUp.action + ' ' + advUp.nextLoad);
    const logs2 = { '2026-10-26': { entries: { bench: { sets: [{ reps: 4, load: 40, rir: 0 }] } } } };
    const advDown = advise({ ex: 'bench', reps: [6, 8], rir: 2 }, logs2, { bench: 40 }, exMap);
    ok('progresión: baja con RIR 0', advDown.action === 'bajar' && advDown.nextLoad === 37.5, advDown.action + ' ' + advDown.nextLoad);
    const advNone = advise({ ex: 'bench', reps: [6, 8], rir: 2 }, {}, { bench: 40 }, exMap);
    ok('progresión: sin datos calibra', advNone.action === 'calibrar', advNone.action);
    const logs3 = { '2026-10-26': { entries: { bench: { sets: [{ reps: 7, load: 40, rir: 2 }] } } } };
    ok('progresión: mantiene si falta reps', advise({ ex: 'bench', reps: [6, 8], rir: 2 }, logs3, { bench: 40 }, exMap).action === 'mantener');

    // Preparación
    const all5 = {}; READINESS_ITEMS.forEach(i => all5[i.id] = 5);
    ok('preparación: neutro = 50 ámbar', readiness(all5).score === 50 && readiness(all5).light === 'amber', readiness(all5).score);
    const all10 = {}; READINESS_ITEMS.forEach(i => all10[i.id] = i.invert ? 0 : 10);
    ok('preparación: perfecto = 100 verde', readiness(all10).score === 100 && readiness(all10).light === 'green', readiness(all10).score);
    const allBad = {}; READINESS_ITEMS.forEach(i => allBad[i.id] = i.invert ? 10 : 0);
    ok('preparación: malo = 0 rojo', readiness(allBad).score === 0 && readiness(allBad).light === 'red', readiness(allBad).score);

    // Fases
    ok('fase semana 1 calibración', phaseForWeek(1).id === 'cal');
    ok('fase semana 6 descarga al 50 %', phaseForWeek(6).volume === 0.5);
    ok('fase semana 12 revisión', phaseForWeek(12).id === 'rev');

    // Fechas
    ok('semana 1 en el lunes de inicio', weekNumber('2026-10-26', '2026-10-26') === 1, weekNumber('2026-10-26', '2026-10-26'));
    ok('semana 2 a los 7 días', weekNumber('2026-10-26', '2026-11-02') === 2, weekNumber('2026-10-26', '2026-11-02'));
    ok('domingo pertenece a la misma semana', weekNumber('2026-10-26', '2026-11-01') === 1, weekNumber('2026-10-26', '2026-11-01'));

    // Descarga
    const deload = buildProgram({ n: 4, exMap: exMap, loads: st.loads, fit: false, phase: phaseForWeek(6) });
    ok('descarga: ~mitad de series', countSets(deload) <= 42 && countSets(deload) >= 28, countSets(deload));

    // Cambio de frecuencia: 4 → 3 mantiene glúteo
    const p3 = buildProgram({ n: 3, exMap: exMap, loads: st.loads });
    const d = diffPrograms(p4, p3, exMap, st.loads);
    ok('4→3: el glúteo no cae más de un 15 %', Math.abs(d.muscles.find(m => m.id === 'glute').delta) / 14.5 <= 0.16, JSON.stringify(d.muscles.find(m => m.id === 'glute')));

    return res;
  }

  return {
    VERSION: VERSION,
    MUSCLES: MUSCLES, MUSCLE_LABEL: MUSCLE_LABEL, RANGE: RANGE, AIM: AIM, PRIORITY: PRIORITY,
    READINESS_ITEMS: READINESS_ITEMS, EX_POOL: EX_POOL, WEEKDAY_NAMES: WEEKDAY_NAMES,
    getExMap: getExMap, exOf: exOf,
    templateFor: templateFor, buildProgram: buildProgram, applyOverrides: applyOverrides,
    volumeOf: volumeOf, countSets: countSets, volumeRows: volumeRows,
    sessionMinutes: sessionMinutes, sessionStats: sessionStats, programStats: programStats,
    fitToTarget: fitToTarget, rebalance: rebalance, diffPrograms: diffPrograms, capFor: capFor, totalTargetFor: totalTargetFor,
    applySwaps: applySwaps,
    phaseForWeek: phaseForWeek, applyVolume: applyVolume,
    parseDate: parseDate, toISODate: toISODate, mondayOf: mondayOf, addDays: addDays, weekNumber: weekNumber, weekdayName: weekdayName,
    advise: advise, lastEntryFor: lastEntryFor, loadHistory: loadHistory, countChanges: countChanges,
    readiness: readiness, logTonnage: logTonnage, logSets: logSets, logByMuscle: logByMuscle, weeklySummary: weeklySummary,
    defaultState: defaultState, seedLoads: seedLoads, normalizeState: normalizeState,
    round1: round1, roundTo: roundTo, selfTest: selfTest
  };
});
