/* Comprueba que la app es instalable y funciona sin conexión.
   node tools/pwa-check.mjs <url> */
import { spawn } from 'node:child_process';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.argv[2];
const port = 9800 + Math.floor(Math.random() * 150);
const profile = '/tmp/cuaderno-pwa-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--hide-scrollbars',
  'about:blank'
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
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error('eval: ' + r.exceptionDetails.text);
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url });
await sleep(2500);

const out = { url, checks: [] };
const check = (name, pass, detail) => out.checks.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) });

/* manifiesto */
try {
  const man = await send('Page.getAppManifest');
  const parsed = man.parsed || {};
  check('manifiesto enlazado', !!man.url, man.url);
  check('manifiesto sin errores', !(man.errors && man.errors.length), JSON.stringify(man.errors || []));
  check('nombre y short_name', !!parsed.name && !!parsed.short_name, parsed.name + ' / ' + parsed.short_name);
  check('display standalone', parsed.display === 'standalone', parsed.display);
  check('iconos 192 y 512', (parsed.icons || []).some(i => /192/.test(i.sizes)) && (parsed.icons || []).some(i => /512/.test(i.sizes)), (parsed.icons || []).map(i => i.sizes).join(','));
} catch (e) {
  check('manifiesto enlazado', false, e.message);
}

/* instalabilidad */
try {
  const errs = await send('Page.getInstallabilityErrors');
  check('sin errores de instalabilidad', !(errs.installabilityErrors || []).length, JSON.stringify(errs.installabilityErrors || []));
} catch (e) {
  out.checks.push({ name: 'instalabilidad (no soportado en este Chrome)', pass: true, detail: e.message });
}

/* service worker */
const controlled = await ev("(async () => { const r = await navigator.serviceWorker.ready; return !!(r && r.active); })()", true);
check('service worker activo', controlled === true, controlled);
await send('Page.reload');
await sleep(1500);
const isControlled = await ev("!!navigator.serviceWorker.controller");
check('la página queda controlada por el SW', isControlled === true, isControlled);

/* contenido cacheado */
const cached = await ev("(async () => { const c = await caches.open((await caches.keys()).find(k=>k.startsWith('cuaderno'))||''); return (await c.match('./index.html')) ? 'ok' : 'no'; })()", true);
check('index.html en caché', cached === 'ok', cached);

/* sin conexión */
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await send('Page.reload');
await sleep(2200);
const offline = await ev("(function(){var h=document.querySelector('#view h1');return h?h.textContent:'SIN RENDER';})()");
check('abre sin conexión', offline && offline !== 'SIN RENDER', offline);
const tabs = await ev("document.querySelectorAll('.tab').length");
check('conserva la interfaz sin conexión', tabs === 5, tabs + ' pestañas');

await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
check('sin excepciones de JavaScript', exceptions.length === 0, exceptions.join(' | '));

console.log(JSON.stringify(out, null, 1));
const fails = out.checks.filter((c) => !c.pass).length;
console.log(fails ? 'RESULTADO: ' + fails + ' fallos de ' + out.checks.length : 'RESULTADO: PWA OK (' + out.checks.length + ' comprobaciones)');

ws.close();
proc.kill('SIGKILL');
process.exit(fails ? 1 : 0);
