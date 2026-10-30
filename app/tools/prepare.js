// Prepara app/web a partir de la plataforma publicada (plataforma/), con Three.js y el modelo 3D locales: la app funciona sin internet.
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '..'), ROOT = path.join(APP, '..'), SRC = path.join(ROOT, 'plataforma'), WEB = path.join(APP, 'web');
const cp = (a, b) => { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(a, b); };
fs.rmSync(WEB, { recursive: true, force: true }); fs.mkdirSync(WEB, { recursive: true });
let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const swap = (from, to) => { if (!html.includes(from)) throw new Error('No se encontró en index.html: ' + from); html = html.split(from).join(to); };
swap("const MODEL_URL='../models/puente-balta-v12.glb';", "const MODEL_URL='models/puente-balta-v12.glb';");
swap('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', './vendor/three/build/three.module.js');
swap('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/', './vendor/three/examples/jsm/');
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="default-src \'self\' app: blob: data:; script-src \'self\' app: \'unsafe-inline\' blob:; worker-src \'self\' blob:; style-src \'self\' \'unsafe-inline\'; img-src \'self\' app: data: blob:; connect-src \'self\' app: blob: data:">');
html += '\n<link rel="stylesheet" href="desktop.css">\n<script src="desktop.js"></script>\n';
fs.writeFileSync(path.join(WEB, 'index.html'), html);
for (const f of ['v3d.js', 'op_core.js', 'op_ui.js', 'pg_mod.js']) cp(path.join(SRC, f), path.join(WEB, f));
for (const f of fs.readdirSync(path.join(SRC, 'data'))) cp(path.join(SRC, 'data', f), path.join(WEB, 'data', f));
cp(path.join(ROOT, 'models', 'puente-balta-v12.glb'), path.join(WEB, 'models', 'puente-balta-v12.glb'));
const T = path.join(APP, 'node_modules', 'three'); if (!fs.existsSync(path.join(T, 'build', 'three.module.js'))) throw new Error('Falta three en node_modules: ejecute npm install');
for (const f of ['build/three.module.js', 'examples/jsm/loaders/GLTFLoader.js', 'examples/jsm/controls/OrbitControls.js', 'examples/jsm/utils/BufferGeometryUtils.js', 'LICENSE'])
  cp(path.join(T, f), path.join(WEB, 'vendor', 'three', f));
cp(path.join(APP, 'src', 'desktop.js'), path.join(WEB, 'desktop.js'));
cp(path.join(APP, 'src', 'desktop.css'), path.join(WEB, 'desktop.css'));
for (const f of fs.readdirSync(path.join(APP, 'docs'))) cp(path.join(APP, 'docs', f), path.join(WEB, 'docs', f));
console.log('app/web listo:', fs.readdirSync(WEB).join(', '));
