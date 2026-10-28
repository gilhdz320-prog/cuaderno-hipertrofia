import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const CE = require('../src/engine.js');

const exMap = CE.getExMap([]);
const near = (a, b, eps = 0.05) => Math.abs(a - b) < eps;

test('el programa de 4 días reproduce el documento', () => {
  const p = CE.buildProgram({ n: 4, exMap, fit: false });
  const v = CE.volumeOf(p, exMap);
  assert.equal(p.days.length, 4);
  assert.equal(CE.countSets(p), 67, 'series base');
  assert.ok(near(v.glute.total, 14.5), 'glúteo ' + v.glute.total);
  assert.ok(near(v.ham.total, 11.5), 'isquios ' + v.ham.total);
  assert.ok(near(v.back.total, 11.5), 'espalda ' + v.back.total);
  assert.ok(near(v.chest.total, 6), 'pecho ' + v.chest.total);
  assert.ok(near(v.calf.total, 6), 'pantorrilla ' + v.calf.total);
  assert.ok(near(v.quad.total, 9.5), 'cuádriceps ' + v.quad.total);
  assert.ok(near(v.biceps.total, 7), 'bíceps ' + v.biceps.total);
  assert.ok(near(v.triceps.total, 6.5), 'tríceps ' + v.triceps.total);
  const delts = v.delt_front.total + v.delt_side.total + v.delt_rear.total;
  assert.ok(near(delts, 15), 'deltoides ' + delts);
  // técnica del documento: hip thrust primero y 4 series
  assert.equal(p.days[0].slots[0].ex, 'hip_thrust');
  assert.equal(p.days[0].slots[0].sets, 4);
});

test('todas las frecuencias 2–6 son coherentes', () => {
  for (let n = 2; n <= 6; n++) {
    const p = CE.buildProgram({ n, exMap });
    const st = CE.programStats(p, CE.defaultState('2026-10-26').loads, exMap);
    const v = CE.volumeOf(p, exMap);
    assert.equal(p.days.length, n, `${n} días`);
    const cap = CE.capFor(n);
    p.days.forEach(d => {
      const sets = CE.countSets({ days: [d] });
      assert.ok(sets <= cap, `${n}d: ${d.name} tiene ${sets} > ${cap}`);
      assert.ok(sets >= 8, `${n}d: ${d.name} tiene solo ${sets}`);
    });
    assert.ok(v.glute.total >= 12, `${n}d glúteo ${v.glute.total}`);
    assert.ok(st.tonnage > 0);
    st.sessions.forEach(s => assert.ok(s.minutes >= 25 && s.minutes <= 105, `${n}d ${s.name}: ${s.minutes} min`));
  }
});

test('el glúteo se protege al bajar de 4 a 2 días', () => {
  const loads = CE.defaultState('2026-10-26').loads;
  const p4 = CE.buildProgram({ n: 4, exMap, loads, fit: false });
  const p2 = CE.buildProgram({ n: 2, exMap, loads });
  const d = CE.diffPrograms(p4, p2, exMap, loads);
  const g = d.muscles.find(m => m.id === 'glute');
  assert.ok(g.after / g.before >= 0.85, `glúteo ${g.before} → ${g.after}`);
  assert.ok(d.sets.after < d.sets.before, 'menos series totales');
});

test('progresión doble con las reglas del documento', () => {
  const ok = { '2026-10-26': { entries: { bench: { sets: [8, 8, 8].map(r => ({ reps: r, load: 40, rir: 2 })) } } } };
  const a = CE.advise({ ex: 'bench', reps: [6, 8], rir: 2 }, ok, { bench: 40 }, exMap);
  assert.equal(a.action, 'subir');
  assert.equal(a.nextLoad, 42.5, 'en barra el salto mínimo son 2,5 kg');
  assert.match(a.condition, /sube/i);

  const fail = { '2026-10-26': { entries: { bench: { sets: [{ reps: 4, load: 40, rir: 0 }] } } } };
  const b = CE.advise({ ex: 'bench', reps: [6, 8], rir: 2 }, fail, { bench: 40 }, exMap);
  assert.equal(b.action, 'bajar');
  assert.equal(b.nextLoad, 37.5);

  const partial = { '2026-10-26': { entries: { bench: { sets: [{ reps: 7, load: 40, rir: 2 }] } } } };
  assert.equal(CE.advise({ ex: 'bench', reps: [6, 8], rir: 2 }, partial, { bench: 40 }, exMap).action, 'mantener');

  const noData = { '2026-10-26': { entries: { bench: { sets: [{ reps: 0, load: 40 }] } } } };
  assert.equal(CE.advise({ ex: 'bench', reps: [6, 8], rir: 2 }, noData, { bench: 40 }, exMap).action, 'mantener', 'sin reps no se inventa progresión');

  assert.equal(CE.advise({ ex: 'bench', reps: [6, 8], rir: 2 }, {}, { bench: 40 }, exMap).action, 'calibrar');
});

test('progresión en tren inferior: saltos del 5 %', () => {
  const logs = { '2026-10-26': { entries: { hip_thrust: { sets: [10, 10, 10, 10].map(r => ({ reps: r, load: 70, rir: 2 })) } } } };
  const a = CE.advise({ ex: 'hip_thrust', reps: [8, 10], rir: 2 }, logs, { hip_thrust: 70 }, exMap);
  assert.equal(a.action, 'subir');
  assert.equal(a.nextLoad, 72.5);
});

test('preparación: 0–100 con semáforo', () => {
  const fill = v => { const o = {}; CE.READINESS_ITEMS.forEach(i => o[i.id] = i.invert ? 10 - v : v); return o; };
  assert.equal(CE.readiness(fill(10)).score, 100);
  assert.equal(CE.readiness(fill(10)).light, 'green');
  assert.equal(CE.readiness(fill(0)).score, 0);
  assert.equal(CE.readiness(fill(0)).light, 'red');
  assert.equal(CE.readiness(fill(5)).score, 50);
  assert.equal(CE.readiness(fill(5)).light, 'amber');
  assert.equal(CE.readiness({}).light, 'none');
});

test('fases y descarga', () => {
  assert.equal(CE.phaseForWeek(1).id, 'cal');
  assert.equal(CE.phaseForWeek(3).id, 'acc');
  assert.equal(CE.phaseForWeek(6).volume, 0.5);
  assert.equal(CE.phaseForWeek(9).id, 'int');
  assert.equal(CE.phaseForWeek(12).id, 'rev');
  assert.equal(CE.phaseForWeek(13).id, 'ext');
  const loads = CE.defaultState('2026-10-26').loads;
  const full = CE.buildProgram({ n: 4, exMap, loads, fit: false });
  const del = CE.buildProgram({ n: 4, exMap, loads, fit: false, phase: CE.phaseForWeek(6) });
  const ratio = CE.countSets(del) / CE.countSets(full);
  assert.ok(ratio > 0.42 && ratio < 0.63, 'descarga al ~50 %: ' + ratio);
});

test('semanas y fechas', () => {
  assert.equal(CE.weekNumber('2026-10-26', '2026-10-26'), 1);
  assert.equal(CE.weekNumber('2026-10-26', '2026-11-01'), 1, 'el domingo cierra la semana');
  assert.equal(CE.weekNumber('2026-10-26', '2026-11-02'), 2);
  assert.equal(CE.toISODate(CE.mondayOf('2026-10-27')), '2026-10-26');
  assert.equal(CE.weekdayName(1), 'Lunes');
});

test('tonelaje previsto crece con la carga y el volumen', () => {
  const p = CE.buildProgram({ n: 4, exMap, fit: false });
  const low = CE.programStats(p, { hip_thrust: 50, rdl: 40 }, exMap).tonnage;
  const high = CE.programStats(p, { hip_thrust: 100, rdl: 80 }, exMap).tonnage;
  assert.ok(high > low);
  assert.ok(low > 0);
});

test('el registro semanal suma tonelaje, series y preparación', () => {
  const state = CE.defaultState('2026-10-26');
  state.logs['2026-10-26'] = { entries: { bench: { sets: [{ reps: 8, load: 40, rir: 2 }] } }, readiness: { score: 80 } };
  state.logs['2026-10-28'] = { entries: { hip_thrust: { sets: [{ reps: 10, load: 70, rir: 2 }, { reps: 10, load: 70, rir: 2 }] } }, readiness: { score: 60 } };
  const w = CE.weeklySummary(state, exMap);
  assert.equal(w.length, 1);
  assert.equal(w[0].tonnage, 8 * 40 + 20 * 70);
  assert.equal(w[0].sets, 3);
  assert.equal(w[0].avgReadiness, 70);
});

test('normalizeState repara estados incompletos o corruptos', () => {
  assert.ok(CE.normalizeState(null).block);
  const s = CE.normalizeState({ block: { freq: 9 }, logs: null });
  assert.equal(s.block.freq, 6);
  assert.deepEqual(s.logs, {});
  assert.ok(s.loads.hip_thrust > 0);
});

test('las sustituciones de ejercicio sobreviven al cambiar de frecuencia', () => {
  const loads = CE.defaultState('2026-10-26').loads;
  const swaps = { lower_a: { hip_thrust: 'hip_thrust_smith' }, upper_a: { lateral_raise: 'lateral_cable' } };
  const p4 = CE.buildProgram({ n: 4, exMap, loads, fit: false, swaps });
  assert.equal(p4.days[0].slots[0].ex, 'hip_thrust_smith');
  assert.equal(p4.days[1].slots[3].ex, 'lateral_cable');
  const p3 = CE.buildProgram({ n: 3, exMap, loads, swaps });
  assert.equal(p3.days[0].slots[0].ex, 'hip_thrust_smith', 'se mantiene en 3 días');
  assert.equal(p3.days[1].slots[0].ex, 'bench', 'la sesión fusionada conserva sus propios ejercicios');
});

test('equipamiento: qué necesita cada ejercicio y qué hay disponible', () => {
  const ex = CE.getExMap([]);
  assert.deepEqual(CE.requiredEquipment(ex.bench).sort(), ['banco', 'barra']);
  assert.equal(CE.isAvailable(ex.bench, ['barra', 'banco']), true);
  assert.equal(CE.isAvailable(ex.bench, ['barra']), false, 'sin banco no hay banca');
  assert.equal(CE.isAvailable(ex.pullup, []), false, 'sin barra de dominadas no hay dominadas');
  assert.equal(CE.isAvailable(ex.pushup, []), true, 'el peso corporal siempre está');
  assert.equal(CE.isAvailable(ex.bench, null), true, 'sin configurar = todo disponible');
});

test('sustitución: busca la mejor opción con el material disponible', () => {
  const ex = CE.getExMap([]);
  const alt = CE.pickAlternative('bulgarian', { exMap: ex, equipment: ['barra', 'mancuernas', 'banco', 'barra_dominadas'] });
  assert.ok(alt, 'debe encontrar sustituto');
  assert.ok(CE.isAvailable(ex[alt], ['barra', 'mancuernas', 'banco', 'barra_dominadas']));
  assert.notEqual(alt, 'leg_ext', 'prefiere un compuesto antes que un aislamiento');
});

test('restricciones: el programa no deja ejercicios imposibles', () => {
  const ex = CE.getExMap([]);
  for (const equipo of [['barra', 'banco', 'mancuernas'], ['mancuernas', 'banco'], ['barra_dominadas', 'accesorio'], []]) {
    const p = CE.buildProgram({ n: 4, exMap: ex, equipment: equipo });
    p.days.forEach((d) => d.slots.forEach((s) => {
      /* o está disponible, o queda marcado para que la interfaz lo explique */
      assert.ok(CE.isAvailable(ex[s.ex], equipo) || s.flagged === 'sin-equipo',
        `${ex[s.ex].name} no está disponible con ${equipo.join(',') || 'nada'} y no está marcado`);
    }));
    assert.ok(CE.countSets(p) >= 40, 'el programa sigue teniendo volumen');
  }
});

test('sin material el programa es de peso corporal', () => {
  const ex = CE.getExMap([]);
  const p = CE.buildProgram({ n: 3, exMap: ex, equipment: [] });
  const ids = p.days.flatMap((d) => d.slots.map((s) => s.ex));
  assert.ok(ids.indexOf('bench') < 0);
  assert.ok(ids.indexOf('hip_thrust') < 0);
});

test('un ejercicio marcado como «no me gusta» se sustituye', () => {
  const ex = CE.getExMap([]);
  const p = CE.buildProgram({ n: 4, exMap: ex, prefs: { bulgarian: 'dislike' } });
  const ids = p.days.flatMap((d) => d.slots.map((s) => s.ex));
  assert.ok(ids.indexOf('bulgarian') < 0, 'no debe aparecer');
  assert.ok(ids.length > 10);
});

test('migración: un perfil antiguo se convierte en multiusuario sin perder datos', () => {
  const viejo = CE.defaultState('2026-10-26');
  viejo.logs['2026-10-26'] = { entries: { bench: { sets: [{ reps: 8, load: 40, rir: 2, done: true }] } } };
  const db = CE.migrateState(viejo);
  assert.equal(db.version, 3);
  const perfil = db.profiles[db.activeId];
  assert.ok(perfil, 'hay perfil activo');
  assert.equal(Object.keys(perfil.logs).length, 1, 'conserva los registros');
  assert.ok(Array.isArray(perfil.equipment) && perfil.equipment.length > 3, 'equipo por defecto completo');
  assert.equal(db.profiles[perfil.id].prefs && typeof db.profiles[perfil.id].prefs, 'object');
});

test('migración: dos perfiles conviven y uno no ve los datos del otro', () => {
  const a = CE.normalizeProfile({ name: 'Ana' });
  const b = CE.normalizeProfile({ name: 'Bea' });
  a.logs['2026-10-26'] = { entries: { bench: { sets: [{ reps: 8, load: 40 }] } } };
  const db = CE.migrateState({ version: 3, activeId: a.id, profiles: { [a.id]: a, [b.id]: b } });
  assert.equal(Object.keys(db.profiles).length, 2);
  assert.equal(Object.keys(db.profiles[a.id].logs).length, 1);
  assert.equal(Object.keys(db.profiles[b.id].logs).length, 0);
});

test('rangos de reps por tipo de ejercicio', () => {
  const ex = CE.getExMap([]);
  assert.deepEqual(CE.clampRepsFor(ex.leg_ext, [6, 8]), [10, 12], 'la extensión no va a 6-8');
  assert.deepEqual(CE.clampRepsFor(ex.lateral_raise, [6, 8]), [12, 14], 'el lateral, más alto');
  assert.deepEqual(CE.clampRepsFor(ex.bench, [6, 8]), [6, 8], 'el compuesto pesado se respeta');
  assert.deepEqual(CE.clampRepsFor(ex.bulgarian, [20, 25]), [6, 10], 'fuera de banda por arriba');
  assert.deepEqual(CE.clampRepsFor(ex.triceps_pushdown, [6, 8]), [8, 10], 'no deja rangos de una repetición');
  const ancho = (r) => r[1] - r[0];
  assert.ok(ancho(CE.clampRepsFor(ex.calf_standing, [6, 8])) >= 2);
});

test('las cargas iniciales dependen del peso y la experiencia', () => {
  const ligero = CE.seedLoads({ athlete: { weightKg: 55, experience: 'principiante' } });
  const medio = CE.seedLoads({ athlete: { weightKg: 55, experience: 'intermedio' } });
  const pesado = CE.seedLoads({ athlete: { weightKg: 55, experience: 'avanzado' } });
  assert.ok(ligero.bench < medio.bench, 'principiante arranca más bajo');
  assert.ok(pesado.bench > medio.bench, 'avanzado arranca más alto');
  const alto = CE.seedLoads({ athlete: { weightKg: 90, experience: 'intermedio' } });
  assert.ok(alto.hip_thrust > medio.hip_thrust, 'más peso corporal, más carga');
});

test('cardio: el HIIT se coloca lejos del tren inferior', () => {
  const ex = CE.getExMap([]);
  const p4 = CE.buildProgram({ n: 4, exMap: ex });
  const s = CE.suggestCardioDay(p4, ex);
  assert.equal(s.weekday, 6, 'con lunes/jueves de piernas, el sábado es el mejor día');
  assert.deepEqual(CE.cardioWarnings(p4, { hiit: 1, day: 6 }, ex), [], 'sin conflictos');

  const p3 = CE.buildProgram({ n: 3, exMap: ex });
  assert.equal(CE.suggestCardioDay(p3, ex).weekday, 3, 'a 3 días, el miércoles tras el tren superior');
  const w = CE.cardioWarnings(p3, { hiit: 1, day: 3 }, ex);
  assert.ok(w.length === 1 && /tren superior/.test(w[0]), 'avisa de hacerlo después de la sesión');

  const mal = CE.cardioWarnings(p4, { hiit: 1, day: 1 }, ex);
  assert.ok(mal.some((x) => /mismo día que tren inferior/.test(x)), 'el lunes es piernas');
  assert.ok(CE.cardioWarnings(p4, { hiit: 3, day: 6 }, ex).some((x) => /Más de 2/.test(x)), 'más de 2 HIIT avisa');
  assert.deepEqual(CE.cardioWarnings(p4, { hiit: 0, day: 6 }, ex), [], 'sin HIIT no hay avisos');
});

test('ciclo: fases y predicción del siguiente periodo', () => {
  const c = { enabled: true, lastStart: '2026-10-20', cycleLength: 28, periodLength: 5 };
  assert.equal(CE.cycleInfo(c, '2026-10-20').day, 1);
  assert.equal(CE.cycleInfo(c, '2026-10-20').phase, 'menstrual');
  assert.equal(CE.cycleInfo(c, '2026-10-24').phase, 'menstrual');
  assert.equal(CE.cycleInfo(c, '2026-10-28').phase, 'folicular');
  assert.equal(CE.cycleInfo(c, '2026-11-02').phase, 'ovulacion');
  assert.equal(CE.cycleInfo(c, '2026-11-08').phase, 'lutea');
  const next = CE.cycleInfo(c, '2026-11-01');
  assert.equal(next.nextStart, '2026-11-17');
  assert.equal(CE.cycleInfo({ enabled: false, lastStart: '2026-10-20' }, '2026-10-20'), null, 'desactivado no calcula');
});

test('ciclo: el ajuste tiene techo y no toca el programa', () => {
  const info = CE.cycleInfo({ enabled: true, lastStart: '2026-10-20', cycleLength: 28, periodLength: 5 }, '2026-10-21');
  const fuerte = CE.cycleAdjustment(info, { strength: 2, pain: true, sleep: false }, { score: 30 });
  assert.ok(fuerte.loadFactor >= 0.85, 'nunca baja del 85 %');
  assert.equal(fuerte.loadFactor, 0.9, 'fuerza muy baja + preparación roja = −10 %');
  assert.equal(fuerte.setDelta, -2, 'nunca quita más de 2 series');
  assert.ok(fuerte.active);
  const suave = CE.cycleAdjustment(info, { strength: 0 }, null);
  assert.equal(suave.active, false, 'sin síntomas no hay ajuste');
  assert.equal(suave.loadFactor, 1);
});

test('ciclo: patrón propio a partir de los registros', () => {
  const c = { enabled: true, lastStart: '2026-10-01', cycleLength: 28, periodLength: 5 };
  const logs = {
    '2026-10-01': { cycle: { strength: 2 } },
    '2026-10-02': { cycle: { strength: 2 } },
    '2026-10-09': { cycle: { strength: 0 } },
    '2026-10-16': { cycle: { strength: 0 } }
  };
  const pat = CE.cyclePattern(logs, c);
  assert.ok(pat, 'con 4 registros ya hay patrón');
  assert.equal(pat.weakest[0].day, 1, 'el día 1 es el más flojo');
  assert.equal(CE.cyclePattern({ '2026-10-01': { cycle: { strength: 2 } } }, c), null, 'con uno no alcanza');
});

test('historial y estancamiento por ejercicio', () => {
  const logs = {};
  const add = (d, l, r, rir) => { logs[d] = { entries: { bench: { sets: [{ reps: r, load: l, rir: rir, done: true }, { reps: r - 1, load: l, rir: rir, done: true }] } } }; };
  add('2026-10-01', 60, 8, 2); add('2026-10-08', 60, 8, 2); add('2026-10-15', 60, 8, 2);
  const h = CE.exerciseHistory(logs, 'bench');
  assert.equal(h.length, 3);
  assert.ok(Math.abs(h[0].e1rm - 76) < 0.2, 'e1RM de 60x8 ≈ 76');
  assert.equal(CE.stagnation(h, { today: '2026-10-20', reps: [6, 8] }).status, 'flat');
  add('2026-10-22', 65, 8, 2);
  assert.equal(CE.stagnation(CE.exerciseHistory(logs, 'bench'), { today: '2026-10-24', reps: [6, 8] }).status, 'up');
  assert.equal(CE.stagnation(CE.exerciseHistory({ '2026-09-01': logs['2026-10-01'] }, 'bench'), { today: '2026-10-25' }).status, 'stale');
});

test('el alta guiada no se repite a quien ya tenía datos', () => {
  const vigente = CE.migrateState(null);
  const p = Object.values(vigente.profiles)[0];
  assert.equal(p.onboarded, false, 'perfil nuevo: pasa por el alta');
  const conDatos = CE.migrateState({ version: 3, activeId: p.id, profiles: { [p.id]: Object.assign({}, p, { onboarded: undefined, logs: { '2026-10-01': { entries: {} } } }) } });
  assert.equal(Object.values(conDatos.profiles)[0].onboarded, true, 'perfil con datos: sin alta');
});

test('proyección de carga: sube y respeta las descargas', () => {
  const ex = CE.getExMap([]).bench;
  const p = CE.projectBlock(60, ex, { weeks: 12 });
  assert.equal(p.length, 12);
  assert.equal(p[0].load, 60, 'empieza en la carga actual');
  assert.ok(p[11].load > p[0].load, 'termina más alto');
  assert.equal(p[5].deload, true, 'semana 6 descarga');
  assert.equal(p[11].deload, true, 'semana 12 descarga');
  assert.equal(p[5].load, p[4].load, 'la descarga no sube carga');
  for (let i = 1; i < p.length; i++) assert.ok(p[i].load >= p[i - 1].load, 'nunca baja');
});

test('detector de estímulo duplicado por familia de movimiento', () => {
  const ex = CE.getExMap([]);
  const conDosPresses = { id: 'x', weekday: 1, name: 'Prueba', slots: [
    { ex: 'bench', sets: 3, reps: [6, 8], rir: 2 },
    { ex: 'incline_db', sets: 3, reps: [8, 10], rir: 2 }
  ] };
  const r = CE.sessionRedundancy(conDosPresses, ex);
  assert.equal(r.length, 1, 'banca + inclinado es el mismo patrón');
  assert.equal(r[0].label, 'Pecho');

  const bancaYAperturas = { id: 'y', weekday: 1, name: 'Prueba', slots: [
    { ex: 'bench', sets: 3, reps: [6, 8], rir: 2 },
    { ex: 'cable_fly', sets: 3, reps: [10, 15], rir: 1 }
  ] };
  assert.equal(CE.sessionRedundancy(bancaYAperturas, ex).length, 0, 'press y apertura no duplican');

  const planos = { id: 'z', weekday: 1, name: 'Prueba', slots: [
    { ex: 'lat_pulldown', sets: 3, reps: [8, 10], rir: 1.5 },
    { ex: 'row_barbell', sets: 3, reps: [8, 10], rir: 1.5 }
  ] };
  assert.equal(CE.sessionRedundancy(planos, ex).length, 0, 'jalón y remo son planos distintos');
});

test('calculadora de discos por lado', () => {
  assert.deepEqual(CE.platesFor(100).plates.map((p) => [p.plate, p.n]), [[25, 1], [15, 1]]);
  assert.equal(CE.platesFor(100).exact, true);
  assert.deepEqual(CE.platesFor(72.5).plates.map((p) => [p.plate, p.n]), [[25, 1], [1.25, 1]]);
  assert.deepEqual(CE.platesFor(60).plates.map((p) => [p.plate, p.n]), [[20, 1]]);
  assert.equal(CE.platesFor(20).plates.length, 0, 'solo la barra');
  assert.match(CE.platesLabel(100), /25 \+ 15/);
});

test('rampa de aproximación', () => {
  const r = CE.warmupRamp(100);
  assert.deepEqual(r.map((x) => x.load), [40, 60, 80]);
  assert.deepEqual(r.map((x) => x.reps), [5, 3, 2]);
  assert.ok(CE.warmupRamp(60).every((x) => x.load < 60));
  assert.equal(CE.isBarbellExercise({ equipment: 'barra' }), true);
  assert.equal(CE.isBarbellExercise({ equipment: 'polea' }), false);
});
