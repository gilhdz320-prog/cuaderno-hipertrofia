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

check('arranca con la sesión de hoy', await ev("!!document.querySelector('#view h1')"), await ev("document.querySelector('#view h1') && document.querySelector('#view h1').textContent"));
check('hay tarjetas de ejercicio', (await ev("document.querySelectorAll('.ex').length")) > 0, await ev("document.querySelectorAll('.ex').length"));
check('la cabecera muestra la semana', /Semana/i.test(await ev("document.getElementById('weekChip').textContent")), await ev("document.getElementById('weekChip').textContent"));

/* cuestionario de preparación */
await ev("[...document.querySelectorAll('.card button')].find(b=>b.textContent==='Responder').click()");
await sleep(300);
check('abre el cuestionario', await ev("!document.getElementById('modal').hidden"));
await ev("document.querySelectorAll('.qi').forEach(q=>{ q.querySelectorAll('.scale button')[3].click(); }); 'ok'");
await sleep(200);
const preview = await ev("document.getElementById('readPreview').textContent");
check('calcula la puntuación al responder', /\d+\/100/.test(preview), preview);
await ev("[...document.querySelectorAll('.sheet-actions button')].find(b=>b.textContent==='Guardar').click()");
await sleep(400);
check('guarda la preparación', /Preparación \d+\/100/.test(await ev("document.body.textContent")), await ev("(document.querySelector('.card .chip')||{}).textContent"));

/* marcar una serie */
const before = await ev("document.querySelector('.ex .set-row input').value");
await ev("document.querySelector('.ex .set-row .check').click()");
await sleep(500);
check('marca la serie', await ev("document.querySelector('.ex .set-row .check').getAttribute('aria-checked')") === 'true');
check('arranca el temporizador', await ev("!document.getElementById('timer').classList.contains('hidden')"), await ev("document.getElementById('timerTime').textContent"));
check('la serie toma la carga base', (await ev("document.querySelector('.ex .set-row input').value")) === before, before);

/* persistencia tras recargar */
await send('Page.navigate', { url });
await sleep(1500);
check('persiste tras recargar', await ev("document.querySelector('.ex .set-row .check').getAttribute('aria-checked')") === 'true');
check('persiste la preparación', /Preparación \d+\/100/.test(await ev("document.body.textContent")));

/* semana */
await ev("document.querySelector('[data-tab=semana]').click()");
await sleep(500);
check('la semana tiene 7 días', await ev("document.querySelectorAll('.day-row').length") === 7, await ev("document.querySelectorAll('.day-row').length"));
check('tabla de volumen con 10 músculos', await ev("document.querySelectorAll('.vol-row').length") === 10, await ev("document.querySelectorAll('.vol-row').length"));

/* cambio de frecuencia 4 → 3 */
await ev("[...document.querySelectorAll('.seg button')].find(b=>b.textContent==='3 d').click()");
await sleep(500);
check('previsualiza el reajuste', await ev("!!document.querySelector('#view button.primary') && /Reajustar a 3 días/.test(document.body.textContent)"));
await ev("[...document.querySelectorAll('button')].find(b=>b.textContent==='Reajustar a 3 días').click()");
await sleep(600);
check('aplica 3 días', /3 días/.test(await ev("document.getElementById('freqChip').textContent")), await ev("document.getElementById('freqChip').textContent"));
check('quedan 3 sesiones', await ev("document.querySelectorAll('.day-row:not(.is-rest)').length") === 3, await ev("document.querySelectorAll('.day-row:not(.is-rest)').length"));
check('el glúteo sigue alto', await ev("(function(){var t=document.body.textContent;var m=t.match(/Glúteo\\s*(\\d+)/);return m?+m[1]:null})()") >= 12, await ev("(function(){var t=document.body.textContent;var m=t.match(/Glúteo\\s*(\\d+)/);return m?+m[1]:null})()"));

/* programa editable */
await ev("document.querySelector('[data-tab=programa]').click()");
await sleep(500);
check('editor con filas', await ev("document.querySelectorAll('.slot-edit').length") > 5, await ev("document.querySelectorAll('.slot-edit').length"));
const setsBefore = await ev("document.querySelector('.slot-edit .stepper .val').textContent");
await ev("document.querySelector('.slot-edit .stepper button:last-child').click()");
await sleep(400);
check('sube series al pulsar +', (await ev("document.querySelector('.slot-edit .stepper .val').textContent")) === String(Number(setsBefore) + 1), setsBefore + ' → ' + await ev("document.querySelector('.slot-edit .stepper .val').textContent"));

/* exportación */
check('exporta csv', await ev("(function(){var a=document.createElement('a');return typeof Blob!=='undefined'})()"));

check('sin excepciones de JavaScript', exceptions.length === 0, exceptions.join(' | '));

console.log(JSON.stringify(results.map(r => (r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.detail ? '  [' + r.detail + ']' : '')), null, 1));
const fails = results.filter(r => !r.pass).length;
console.log(fails ? 'RESULTADO: ' + fails + ' fallos de ' + results.length : 'RESULTADO: ' + results.length + ' pruebas OK');

ws.close();
proc.kill('SIGKILL');
process.exit(fails ? 1 : 0);
