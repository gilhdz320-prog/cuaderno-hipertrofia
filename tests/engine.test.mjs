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
  assert.ok(near(v.triceps.total, 7), 'tríceps ' + v.triceps.total);
  const delts = v.delt_front.total + v.delt_side.total + v.delt_rear.total;
  assert.ok(near(delts, 16), 'deltoides ' + delts);
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
  assert.equal(a.nextLoad, 41.25);
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
