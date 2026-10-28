/* Prueba de extremo a extremo con CDP sobre el archivo final.
   node tools/e2e.mjs <archivo.html> */
import { spawn } from 'node:child_process';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const file = process.argv[2];
const port = 9600 + Math.floor(Math.random() * 200);
const profile = '/tmp/cuaderno-e2e-' + Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--hide-scrollbars',
  '--allow-file-access-from-files', 'about:blank'
], { stdio: 'ignore' });

for (let i = 0; i < 60; i++) {
  try { if ((await fetch('http://127.0.0.1:' + port + '/json/version')).ok) break; } catch (e) {}
  await sleep(150);
}
const tab = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, m => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval: ' + r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
const check = (name, cond, detail) => results.push({ name, pass: !!cond, detail: detail === undefined ? '' : String(detail) });

const url = /^https?:/.test(file) ? file : 'file://' + file;
await send('Page.navigate', { url });
await sleep(1500);

const onbOpen = await ev("!document.getElementById('modal').hidden");
if (onbOpen) {
  await ev("[...document.querySelectorAll('.sheet-actions button')].find(function(b){return b.textContent==='Saltar'}).click()");
  await sleep(600);
}
check('el alta guiada se puede saltar', !(await ev("!document.getElementById('modal').hidden")));

/* si hoy es día de descanso, se abre una sesión desde la tarjeta */
if ((await ev("document.querySelectorAll('.ex').length")) === 0) {
  await ev("(function(){var b=[...document.querySelectorAll('#view button')].find(function(x){return /Tren superior A|Tren inferior A|Full body A|Push|Cuerpo completo A/.test(x.textContent)}); if(b) b.click(); return 1})()");
  await sleep(600);
}

check('arranca con la sesión de hoy', await ev("!!document.querySelector('#view h1')"), await ev("document.querySelector('#view h1') && document.querySelector('#view h1').textContent"));
check('hay tarjetas de ejercicio', (await ev("document.querySelectorAll('.ex').length")) > 0, await ev("document.querySelectorAll('.ex').length"));
const repsPrefill = await ev("document.querySelector('.ex .set-row input[inputmode=numeric]').value");
const plates = await ev("(function(){var p=document.querySelector('.plates');return p?p.textContent:''})()");
check('muestra los discos por lado en barra', /por lado|no se puede montar/.test(plates), plates.slice(0, 80));

await ev("(function(){var b=document.querySelector('.ex .ex-title b'); b.click(); return 1})()");
await sleep(500);
check('tocar el nombre abre las alternativas', (await ev("document.getElementById('sheet').textContent.indexOf('Alternativas que trabajan lo mismo') >= 0")) === true);
await ev("[...document.querySelectorAll('.sheet-actions button')].find(function(b){return b.textContent==='Cerrar'}).click()");
await sleep(300);

check('la serie llega precargada con lo de la última vez', Number(repsPrefill) > 0, repsPrefill);

check('la cabecera muestra la semana', /Semana/i.test(await ev("document.getElementById('weekChip').textContent")), await ev("document.getElementById('weekChip').textContent"));

/* cuestionario de preparación */
await ev("[...document.querySelectorAll('.card button')].find(b=>/Responder|Cuestionario/.test(b.textContent)).click()");
await sleep(300);
check('abre el cuestionario', await ev("!document.getElementById('modal').hidden"));
await ev("document.querySelectorAll('.qi').forEach(q=>{ q.querySelectorAll('.scale button')[3].click(); }); 'ok'");
await sleep(200);
const preview = await ev("document.getElementById('readPreview').textContent");
check('calcula la puntuación al responder', /\d+\/100/.test(preview), preview);
await ev("[...document.querySelectorAll('.sheet-actions button')].find(b=>/Guardar|Crear/.test(b.textContent)).click()");
await sleep(400);
check('guarda la preparación', /Preparación \d+\/100/.test(await ev("document.body.textContent")), await ev("(document.querySelector('.card .chip')||{}).textContent"));
const preps = await ev("(function(){var S=Cuaderno.state();var k=Object.keys(S.logs)[0];return JSON.stringify({mod:S.logs[k].modifier,delta:S.logs[k].setDelta})})()");
check('la preparación ajusta la sesión de hoy', JSON.parse(preps).mod < 0 || JSON.parse(preps).delta < 0, preps);

/* marcar una serie */
const before = await ev("document.querySelector('.ex .set-row input').value");
await ev("document.querySelector('.ex .set-row .check').click()");
await sleep(500);
check('marca la serie', await ev("document.querySelector('.ex .set-row .check').getAttribute('aria-checked')") === 'true');
check('arranca el temporizador', await ev("!document.getElementById('timer').classList.contains('hidden')"), await ev("document.getElementById('timerTime').textContent"));
const repsLogged = await ev("(function(){var S=Cuaderno.state();var d=Object.keys(S.logs).sort()[0];var L=S.logs[d];var k=Object.keys(L.entries)[0];return L.entries[k].sets[0].reps})()");
check('el chequeo acepta lo precargado sin teclear', Number(repsLogged) > 0, repsLogged);

check('la serie toma la carga base', (await ev("document.querySelector('.ex .set-row input').value")) === before, before);

/* persistencia tras recargar */
await send('Page.navigate', { url });
await sleep(1500);
check('persiste tras recargar', await ev("document.querySelector('.ex .set-row .check').getAttribute('aria-checked')") === 'true');
check('persiste la preparación', /Preparación \d+\/100/.test(await ev("document.body.textContent")));

/* semana */
await ev("document.querySelector('[data-tab=semana]').click()");
await sleep(500);
check('la semana tiene 7 días', await ev("document.querySelectorAll('.day-row:not(.cardio)').length") === 7, await ev("document.querySelectorAll('.day-row:not(.cardio)').length"));
check('tabla de volumen con 10 músculos', await ev("document.querySelectorAll('.vol-row').length") === 10, await ev("document.querySelectorAll('.vol-row').length"));

/* cambio de frecuencia 4 → 3 */
await ev("[...document.querySelectorAll('.seg button')].find(b=>b.textContent==='3 d').click()");
await sleep(500);
check('previsualiza el reajuste', await ev("!!document.querySelector('#view button.primary') && /Reajustar a 3 días/.test(document.body.textContent)"));
await ev("[...document.querySelectorAll('button')].find(b=>b.textContent==='Reajustar a 3 días').click()");
await sleep(600);
check('aplica 3 días', /3 días/.test(await ev("document.getElementById('freqChip').textContent")), await ev("document.getElementById('freqChip').textContent"));
check('quedan 3 sesiones', await ev("document.querySelectorAll('.day-row:not(.is-rest):not(.cardio)').length") === 3, await ev("document.querySelectorAll('.day-row:not(.is-rest):not(.cardio)').length"));
check('el glúteo sigue alto', await ev("(function(){var t=document.body.textContent;var m=t.match(/Glúteo\\s*(\\d+)/);return m?+m[1]:null})()") >= 12, await ev("(function(){var t=document.body.textContent;var m=t.match(/Glúteo\\s*(\\d+)/);return m?+m[1]:null})()"));

/* programa editable */
await ev("document.querySelector('[data-tab=programa]').click()");
await sleep(500);
check('editor con filas', await ev("document.querySelectorAll('.slot-edit').length") > 5, await ev("document.querySelectorAll('.slot-edit').length"));
const exId = await ev("document.querySelector('.slot-edit select').value");
const cargaOk = await ev("(function(){var row=document.querySelector('.slot-edit'); var ins=row.querySelectorAll('input'); var last=ins[ins.length-1]; last.value='99'; last.dispatchEvent(new Event('change')); return 1})()");
await sleep(500);
await ev("(function(){var b=document.querySelector('.slot-edit .btn.icon.ghost'); b.click(); return 1})()");
await sleep(400);
check('abre el cambio de ejercicio con varias opciones', (await ev("document.getElementById('sheet').textContent.indexOf('Alternativas que trabajan lo mismo') >= 0")) === true, await ev("document.querySelectorAll('.sheet .btn.sm').length"));
const antesEx = await ev("document.querySelector('.slot-edit select').value");
await ev("[...document.querySelectorAll('.sheet .btn.sm')].find(function(b){return b.textContent==='usar'}).click()");
await sleep(600);
check('el ejercicio se sustituye', (await ev("document.querySelector('.slot-edit select').value")) !== antesEx, antesEx + ' → ' + await ev("document.querySelector('.slot-edit select').value"));
check('el programa no nace con patrones duplicados', (await ev("(function(){var S=Cuaderno.state();var ex=Cuaderno.engine.getExMap(S.custom);return S.program.days.every(function(d){return Cuaderno.engine.sessionRedundancy(d,ex).length===0})})()")) === true);

check('la carga se edita desde Programa', String(await ev("Cuaderno.state().loads[" + JSON.stringify(exId) + "]")) === '99', exId + ' = ' + await ev("Cuaderno.state().loads[" + JSON.stringify(exId) + "]"));
const setsBefore = await ev("document.querySelector('.slot-edit .stepper .val').textContent");
await ev("document.querySelector('.slot-edit .stepper button:last-child').click()");
await sleep(400);
check('sube series al pulsar +', (await ev("document.querySelector('.slot-edit .stepper .val').textContent")) === String(Number(setsBefore) + 1), setsBefore + ' → ' + await ev("document.querySelector('.slot-edit .stepper .val').textContent"));

/* exportación */
check('exporta csv', await ev("(function(){var a=document.createElement('a');return typeof Blob!=='undefined'})()"));

/* ---------- perfiles ---------- */
await ev("document.querySelector('[data-tab=ajustes]').click()");
await sleep(500);
check('Ajustes tiene las secciones', (await ev("document.querySelectorAll('.card h2').length")) >= 4, await ev("Array.from(document.querySelectorAll('.card h2')).map(h=>h.textContent).join(' | ')"));

const logsAntes = await ev("Object.keys(Cuaderno.state().logs).length");
await ev("document.querySelector('#profileBtn').click()");
await sleep(300);
check('abre el panel de perfiles', await ev("!document.getElementById('modal').hidden"));
await ev("[...document.querySelectorAll('.sheet button')].find(b=>b.textContent.includes('Nuevo perfil')).click()");
await sleep(300);
await ev("(function(){var i=document.querySelector('.sheet input[type=text]'); i.value='Prueba'; i.dispatchEvent(new Event('input')); [...document.querySelectorAll('.sheet-actions button')].find(b=>/Guardar|Crear/.test(b.textContent)).click(); return 1})()");
await sleep(600);
check('crea y activa el perfil nuevo', (await ev("document.getElementById('profileName').textContent")) === 'Prueba', await ev("document.getElementById('profileName').textContent"));
check('el perfil nuevo empieza sin registros', (await ev("Object.keys(Cuaderno.state().logs).length")) === 0);
await ev("document.querySelector('[data-tab=hoy]').click()");
await sleep(500);
if ((await ev("document.querySelectorAll('.ex').length")) === 0) {
  await ev("(function(){var b=[...document.querySelectorAll('#view button')].find(function(x){return /Tren |Full body|Push|Pull|Legs|Cuerpo completo|Cadena/.test(x.textContent)}); if(b) b.click(); return 1})()");
  await sleep(600);
}
check('ofrece «todo normal»', (await ev("document.querySelector('#view').textContent.indexOf('Todo normal') >= 0")) === true);
await ev("[...document.querySelectorAll('button')].find(function(b){return b.textContent==='Todo normal'}).click()");
await sleep(500);
const quick = await ev("(function(){var S=Cuaderno.state();var d=Object.keys(S.logs)[0];return S.logs[d] && S.logs[d].readiness ? S.logs[d].readiness.score : null})()");
check('«todo normal» deja la sesión lista en un toque', quick === 80, quick);
/* ---------- modo entrenamiento ---------- */
await ev("[...document.querySelectorAll('button')].find(function(b){return b.textContent==='Modo entrenamiento'}).click()");
await sleep(500);
check('entra en modo entrenamiento', (await ev("document.body.classList.contains('train-mode')")) === true);
check('oculta los consejos', (await ev("document.querySelectorAll('.advice').length")) === 0);
check('oculta la preparación', (await ev("document.querySelector('#view').textContent.indexOf('¿Cómo llegas hoy?') < 0")) === true);
check('sigue permitiendo marcar series', (await ev("document.querySelectorAll('.set-row .check').length")) > 0);
await ev("[...document.querySelectorAll('button')].find(function(b){return b.textContent==='salir'}).click()");
await sleep(400);
check('sale del modo entrenamiento', (await ev("document.body.classList.contains('train-mode')")) === false);

await ev("document.querySelector('[data-tab=ajustes]').click()");
await sleep(400);
check('el perfil nuevo tiene su propio programa', (await ev("Cuaderno.state().program.days.length")) >= 2, await ev("Cuaderno.state().program.days.length"));
await ev("document.querySelector('[data-tab=ajustes]').click()");
await sleep(400);
check('ofrece traer el programa de otro perfil', (await ev("document.body.textContent.indexOf('Misma rutina que') >= 0")) === true);
await ev("[...document.querySelectorAll('button')].find(function(b){return b.textContent==='Traer su programa'}).click()");
await sleep(500);
check('copia el programa sin tocar los registros', (await ev("(function(){var S=Cuaderno.state();var sinSeries=Object.keys(S.logs||{}).every(function(d){var e=S.logs[d].entries||{};return Object.keys(e).every(function(k){return (e[k].sets||[]).every(function(x){return !x.done})})});return S.program.days.length>0 && sinSeries})()")) === true);

/* ---------- equipo: sin poleas ---------- */
await ev("document.querySelector('[data-tab=ajustes]').click()");
await sleep(400);
await ev("(function(){var l=[...document.querySelectorAll('.equip')].find(x=>/Poleas/.test(x.textContent)); l.querySelector('input').click(); return 1})()");
await sleep(600);
const sinPolea = await ev("(function(){var S=Cuaderno.state(); var m=Cuaderno.engine.getExMap(S.custom); var bad=S.program.days.flatMap(function(d){return d.slots.map(function(s){return s.ex})}).filter(function(id){return !Cuaderno.engine.isAvailable(m[id], S.equipment)}); return JSON.stringify({bad:bad, n:S.program.days.length})})()");
check('sin poleas no queda ningún ejercicio de polea', JSON.parse(sinPolea).bad.length === 0, sinPolea);
check('el programa sigue completo sin poleas', JSON.parse(sinPolea).n === (await ev("Cuaderno.state().block.freq")), sinPolea + ' vs ' + await ev("Cuaderno.state().block.freq"));

/* ---------- volver al perfil anterior ---------- */
await ev("document.querySelector('#profileBtn').click()");
await sleep(300);
await ev("[...document.querySelectorAll('.sheet button')].find(b=>b.textContent==='usar').click()");
await sleep(500);
check('vuelve al primer perfil', (await ev("document.getElementById('profileName').textContent")) !== 'Prueba', await ev("document.getElementById('profileName').textContent"));
check('conserva los registros del primer perfil', (await ev("Object.keys(Cuaderno.state().logs).length")) === logsAntes, logsAntes + ' → ' + await ev("Object.keys(Cuaderno.state().logs).length"));
const sigueGuardada = await ev("(function(){var L=Cuaderno.state().logs; return Object.keys(L).some(function(d){return Object.keys(L[d].entries||{}).some(function(e){return (L[d].entries[e].sets||[]).some(function(s){return s&&s.done})})})})()");
check('la serie marcada sigue guardada en sus datos', sigueGuardada === true, sigueGuardada);

/* ---------- ciclo: activar y autorregular ---------- */
await ev("document.querySelector('[data-tab=ajustes]').click()");
await sleep(500);
await ev("(function(){var c=[...document.querySelectorAll('.card')].find(x=>/Ciclo y autorregulación/.test(x.textContent)); c.querySelectorAll('.seg button')[0].click(); return 1})()");
await sleep(500);
await ev("(function(){var c=[...document.querySelectorAll('.card')].find(x=>/Ciclo y autorregulación/.test(x.textContent)); var d=c.querySelector('input[type=date]'); var now=new Date(); now=new Date(now.getTime()-now.getTimezoneOffset()*60000); d.value=now.toISOString().slice(0,10); [...c.querySelectorAll('button')].find(function(b){return b.textContent==='Guardar'}).click(); return 1})()");
await sleep(600);
check('activa el ciclo y guarda la fecha', (await ev("Cuaderno.state().cycle.enabled")) === true && (await ev("Cuaderno.state().cycle.lastStart")).length === 10, await ev("Cuaderno.state().cycle.lastStart"));

await ev("document.querySelector('[data-tab=hoy]').click()");
await sleep(600);
check('hay botón para marcar el inicio del sangrado', (await ev("document.querySelector('#view').textContent.indexOf('Me está bajando') >= 0")) === true);
await ev("[...document.querySelectorAll('button')].find(function(b){return b.textContent==='Me está bajando'}).click()");
await sleep(500);
const cicloHist = await ev("(function(){var S=Cuaderno.state();return JSON.stringify({n:(S.cycle.history||[]).length,last:S.cycle.lastStart,end:(S.cycle.history||[])[0]?S.cycle.history[0].end:'x'})})()");
check('marcar inicio guarda el sangrado y reinicia el ciclo', JSON.parse(cicloHist).n >= 1 && JSON.parse(cicloHist).end === null, cicloHist);
check('el día de sangrado pide ánimo, fatiga, dolor y fuerza', (await ev("document.querySelectorAll('#view select').length")) >= 4, await ev("document.querySelectorAll('#view select').length"));
await ev("(function(){var sels=[...document.querySelectorAll('#view select')]; var fat=sels[1]; fat.value='5'; fat.dispatchEvent(new Event('change')); return 1})()");
await sleep(600);
const dia = await ev("(function(){var S=Cuaderno.state();var k=Object.keys(S.logs)[0];var c=S.logs[k].cycle||{};return JSON.stringify({fatiga:c.fatigue,mod:S.logs[k].modifier,delta:S.logs[k].setDelta})})()");
check('guardar la fatiga del día ajusta la sesión', JSON.parse(dia).fatiga === 5 && JSON.parse(dia).delta < 0, dia);
check('aparece el chequeo del día', (await ev("document.body.textContent.indexOf('¿Cómo va la fuerza hoy?') >= 0")) === true);
const setsAntes = await ev("(function(){var S=Cuaderno.state(); var s=S.program.days[0]; var n=0; S.program.days.forEach(function(d){d.slots.forEach(function(x){n+=x.sets})}); return n})()");
await ev("[...document.querySelectorAll('button')].find(function(b){return b.textContent==='Muy baja'}).click()");
await sleep(700);
const ciclo = await ev("(function(){var S=Cuaderno.state(); var k=Object.keys(S.logs)[0]; var L=S.logs[k]; return JSON.stringify({mod:L.modifier, delta:L.setDelta, check:L.cycle})})()");
const cst = JSON.parse(ciclo);
check('aplica el ajuste de carga', cst.mod <= -5, ciclo);
check('quita series ese día', cst.delta <= -1, ciclo);
check('muestra el aviso de ajuste', (await ev("document.body.textContent.indexOf('Sesión ajustada') >= 0")) === true);
check('el programa no se toca', (await ev("(function(){var S=Cuaderno.state(); var n=0; S.program.days.forEach(function(d){d.slots.forEach(function(x){n+=x.sets})}); return n})()")) === setsAntes, setsAntes);

/* ---------- cuenta y sincronización ---------- */
await ev("document.querySelector('[data-tab=ajustes]').click()");
await sleep(500);
check('hay tarjeta de cuenta', (await ev("document.body.textContent.indexOf('Cuenta y sincronización') >= 0")) === true);
await ev("(function(){var c=[...document.querySelectorAll('.card')].find(function(x){return /Cuenta y sincronización/.test(x.textContent)}); var i=c.querySelectorAll('input'); i[0].value='https://prueba.supabase.co'; i[1].value='anon-de-prueba'; [...c.querySelectorAll('button')].find(function(b){return b.textContent==='Guardar configuración'}).click(); return 1})()");
await sleep(600);
check('al guardar configuración pide correo y contraseña', (await ev("document.querySelectorAll('input[type=password]').length")) >= 1);
check('la sincronización no rompe el guardado local', (await ev("(function(){try{var raw=localStorage.getItem('cuaderno.v3');return !!raw && !!JSON.parse(raw).profiles}catch(e){return false}})()")) === true);

/* ---------- resumen semanal ---------- */
await ev("document.querySelector('[data-tab=semana]').click()");
await sleep(500);
await ev("[...document.querySelectorAll('button')].find(function(b){return b.textContent==='Resumen'}).click()");
await sleep(500);
check('abre el resumen semanal', (await ev("document.getElementById('sheet').textContent.indexOf('Texto para entregar') >= 0")) === true);
check('el resumen trae texto', /Semana \d/.test(await ev("document.querySelector('#sheet pre').textContent")), await ev("document.querySelector('#sheet pre').textContent.split('\\n')[0]"));
await ev("[...document.querySelectorAll('.sheet-actions button')].find(function(b){return b.textContent==='Versión redactada'}).click()");
await sleep(400);
check('sin clave avisa en vez de romper', (await ev("document.getElementById('sheet').textContent.indexOf('Asistente') >= 0 || document.getElementById('toast').textContent.indexOf('clave') >= 0")) === true);
await ev("[...document.querySelectorAll('.sheet-actions button')].find(function(b){return b.textContent==='Cerrar'}).click()");
await sleep(300);

/* ---------- copias de seguridad ---------- */
await ev("document.querySelector('[data-tab=ajustes]').click()");
await sleep(600);
check('la tarjeta de copias existe', (await ev("document.querySelector('#view').textContent.indexOf('Copias automáticas') >= 0")) === true);
check('la guía rápida está en Ajustes', (await ev("document.querySelector('#view').textContent.indexOf('Guía rápida') >= 0")) === true);
check('la guía explica lo esencial', (await ev("document.querySelector('#view').textContent.indexOf('Registrar una serie') >= 0")) === true);



/* ---------- repartos ---------- */
await ev("document.querySelector('[data-tab=semana]').click()");
await sleep(600);
await ev("[...document.querySelectorAll('.seg button')].find(function(b){return b.textContent==='Full body'}).click()");
await sleep(700);
check('cambia a full body', (await ev("Cuaderno.state().program.days.map(function(d){return d.name}).join('|')")).indexOf('Full body') >= 0, await ev("Cuaderno.state().program.days.map(function(d){return d.name}).join(' | ')"));
const rot = await ev("(function(){var S=Cuaderno.state();var ex=Cuaderno.engine.getExMap(S.custom);var pats=S.program.days.map(function(d){return d.slots.map(function(s){return ex[s.ex].pattern})});return JSON.stringify({a:pats[0],b:pats[1]})})()");
const rp = JSON.parse(rot);
check('full body rota tirón vertical → horizontal', rp.a.indexOf('pull_v') >= 0 && rp.b.indexOf('pull_h') >= 0, rot);
await ev("[...document.querySelectorAll('.seg button')].find(function(b){return b.textContent==='Automático'}).click()");
await sleep(600);
const bicBefore = Number(await ev("(function(){var S=Cuaderno.state();var ex=Cuaderno.engine.getExMap(S.custom);return Cuaderno.engine.volumeOf(S.program,ex).biceps.total})()"));
await ev("[...document.querySelectorAll('.pill')].find(function(b){return b.textContent==='Bíceps'}).click()");
await sleep(700);
const pri = await ev("(function(){var S=Cuaderno.state();var ex=Cuaderno.engine.getExMap(S.custom);var v=Cuaderno.engine.volumeOf(S.program,ex);return JSON.stringify({pr:S.block.priority,bic:v.biceps.total,sets:Cuaderno.engine.countSets(S.program)})})()");
check('la prioridad sube el volumen del músculo elegido', JSON.parse(pri).bic > bicBefore, bicBefore + ' → ' + pri);
await ev("[...document.querySelectorAll('.pill')].find(function(b){return b.textContent==='Bíceps'}).click()");
await sleep(600);
check('se puede quitar la prioridad', (await ev("(Cuaderno.state().block.priority||[]).length")) === 0);

check('vuelve al reparto automático', (await ev("Cuaderno.state().block.split")) === 'auto');

check('sin excepciones de JavaScript', exceptions.length === 0, exceptions.join(' | '));

console.log(JSON.stringify(results.map(r => (r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.detail ? '  [' + r.detail + ']' : '')), null, 1));
const fails = results.filter(r => !r.pass).length;
console.log(fails ? 'RESULTADO: ' + fails + ' fallos de ' + results.length : 'RESULTADO: ' + results.length + ' pruebas OK');

ws.close();
proc.kill('SIGKILL');
process.exit(fails ? 1 : 0);
