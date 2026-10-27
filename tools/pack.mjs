/* Empaqueta lo que se despliega en public/: solo la app, la PWA y el PDF.
   public/ no se versiona (está en .gitignore); lo genera el build.
   Vercel usa esta carpeta como Output Directory. */
import fs from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const OUT_NAME = 'public';

const FILES = ['index.html', 'sw.js', 'manifest.webmanifest', 'cuaderno-bloque.pdf'];
const DIRS = ['icons'];

const out = new URL(OUT_NAME + '/', ROOT);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const f of FILES) {
  const src = new URL(f, ROOT);
  if (!fs.existsSync(src)) throw new Error('falta ' + f + ' (¿ejecutaste node build.mjs?)');
  fs.copyFileSync(src, new URL(f, out));
}

for (const d of DIRS) {
  const src = new URL(d + '/', ROOT);
  if (!fs.existsSync(src)) throw new Error('falta la carpeta ' + d);
  const dest = new URL(d + '/', out);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) fs.copyFileSync(new URL(f, src), new URL(f, dest));
}

/* comprobaciones: que el HTML referencia lo que copiamos */
const html = fs.readFileSync(new URL('index.html', out), 'utf8');
for (const ref of ['manifest.webmanifest', 'icons/apple-touch-icon.png', 'sw.js']) {
  if (html.indexOf(ref) < 0) throw new Error('index.html no referencia ' + ref);
}
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.webmanifest', out), 'utf8'));
for (const icon of manifest.icons) {
  if (!fs.existsSync(new URL(icon.src, out))) throw new Error('icono del manifiesto no copiado: ' + icon.src);
}

const total = FILES.reduce((n, f) => n + fs.statSync(new URL(f, out)).size, 0) +
  fs.readdirSync(new URL('icons/', out)).reduce((n, f) => n + fs.statSync(new URL('icons/' + f, out)).size, 0);

console.log('public/ listo · ' + (total / 1024).toFixed(0) + ' KB · ' + FILES.length + ' archivos + icons/');
