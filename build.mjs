/* Empaqueta src/ en un único HTML autocontenido. */
import fs from 'node:fs';

const dir = new URL('./src/', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, dir), 'utf8');

let html = read('shell.html');
const css = read('styles.css');
const engine = read('engine.js');
const app = read('app.js');

for (const [name, body] of [['engine.js', engine], ['app.js', app]]) {
  if (body.includes('</script')) throw new Error('secuencia </script en ' + name);
}

/* Ojo: una función de reemplazo evita que `$$`, `$&` y compañía del código
   se interpreten como patrones especiales de String.replace. */
const put = (src, token, body) => {
  if (src.indexOf(token) < 0) throw new Error('no encuentro ' + token);
  return src.replace(token, () => body);
};
html = put(html, '<link rel="stylesheet" href="styles.css">', '<style>\n' + css + '\n</style>');
html = put(html, '<script src="engine.js"></script>', '<script>\n' + engine + '\n</script>');
html = put(html, '<script src="app.js"></script>', '<script>\n' + app + '\n</script>');

if (html.includes('src="app.js"') || html.includes('href="styles.css"')) throw new Error('quedan referencias externas');

const out = new URL('../index.html', dir);
fs.writeFileSync(out, html);
console.log('escrito', out.pathname, (html.length / 1024).toFixed(1) + ' KB');
