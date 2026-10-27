/* Capturas reales con emulación de dispositivo vía CDP.
   uso: node tools/shot.mjs <url> <ancho> <alto> <salida> [movil] */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [url, width, height, out, mobile, media, script] = process.argv.slice(2);
const port = 9400 + Math.floor(Math.random() * 200);
const profile = '/tmp/cuaderno-shot-' + Date.now();

const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--hide-scrollbars',
  '--allow-file-access-from-files', 'about:blank'
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitPort(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/version');
      if (r.ok) return await r.json();
    } catch (e) { /* aún no */ }
    await sleep(150);
  }
  throw new Error('chrome no arrancó');
}

await waitPort();
const tab = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    pending.set(id, m => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const errors = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception || {}).description);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + JSON.stringify(m.params.args));
});

await send('Page.enable');
await send('Runtime.enable');
const isMobile = mobile === '1';
await send('Emulation.setDeviceMetricsOverride', {
  width: Number(width), height: Number(height), deviceScaleFactor: isMobile ? 2 : 1, mobile: isMobile
});
if (isMobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
if (media === 'print') await send('Emulation.setEmulatedMedia', { media: 'print' });
await send('Page.navigate', { url });
await sleep(2000);
if (script) { await send('Runtime.evaluate', { expression: script }); await sleep(700); }

const metrics = await send('Runtime.evaluate', {
  expression: 'JSON.stringify({w:innerWidth,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight,title:document.title})',
  returnByValue: true
});
const info = JSON.parse(metrics.result.value);
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(JSON.stringify({ out, info, errors: errors.slice(0, 5) }, null, 1));

ws.close();
proc.kill('SIGKILL');
process.exit(0);
