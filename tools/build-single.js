// Assemble la plateforme en un seul fichier HTML autonome : dist/diambar-2027.html
// Usage : node tools/build-single.js [--artifact chemin]  (--artifact : version sans <html>/<head>/<body>)
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let html = read('index.html');
html = html.replace(/<!--LEAFLET_CSS-->[\s\S]*?<!--\/LEAFLET_CSS-->/, () => `<style>${read('vendor/leaflet/leaflet.css')}</style>`);
html = html.replace('<link rel="stylesheet" href="css/style.css">', () => `<style>${read('css/style.css')}</style>`);
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (m, f) => `<script>${read(f)}</script>`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'diambar-2027.html'), html);
const i = process.argv.indexOf('--artifact');
if (i > 0) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>\s*/, '').replace(/<meta name="viewport"[^>]*>\s*/, '');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  fs.writeFileSync(process.argv[i + 1], head.trim() + '\n' + body.trim() + '\n');
}
console.log('dist/diambar-2027.html', (html.length / 1024).toFixed(0), 'Ko');
