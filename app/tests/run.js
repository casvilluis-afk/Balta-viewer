// Pruebas del núcleo de cálculo (sin navegador). Se ejecutan en GitHub Actions antes de compilar la app.
// node tests/run.js
const fs = require('fs'), path = require('path');
const P = path.join(__dirname, '..', '..', 'plataforma');
global.self = undefined;
const OPC = new Function(fs.readFileSync(path.join(P, 'op_core.js'), 'utf8') + '\nreturn OPC;')();
let fails = 0; const ok = (name, cond, info) => { console.log((cond ? 'OK   ' : 'FALLA') + '  ' + name + (info ? '  · ' + info : '')); if (!cond) fails++; };

// 1. Viga simplemente apoyada: f1 analítica = (π²/2πL²)·√(EI/m)
{ const L = 30, E = 200, A = .5, I = .2, w = 80, G = { supports: [{ a: 0, b: 0 }, { a: L, b: L }], deckAxis: 0 };
  const fr = OPC.build('viga', G, { E, rho: 0, deck_A: A, deck_I: I, w_deck: w }), md = OPC.modal(fr, 1);
  const m = w / 9.81, fa = Math.PI / (2 * L * L) * Math.sqrt(E * 1e6 * I / m);
  ok('Viga simple: frecuencia fundamental analítica', Math.abs(md.f[0] / fa - 1) < 0.01, `${md.f[0].toFixed(4)} Hz vs ${fa.toFixed(4)} Hz`); }

// 2. Modelo C del Puente Balta reconstruido con el núcleo: 156 nodos, 225 elementos, f1 = 7,437 Hz (artículo)
const MCD = JSON.parse(fs.readFileSync(path.join(P, 'data', 'modelo_c.json')));
const F = MCD.faces, fit = MCD.fit, yv = c => -c[1] / (2 * c[0]), N0 = MCD.nominal;
const arches = [{ a: 2 * yv(fit.izq.coef) - F.p1_L, b: F.p1_L, coef: fit.izq.coef }, { a: F.p1_R, b: F.p2_L, coef: fit.centro.coef }, { a: F.p2_R, b: F.abut_R, coef: fit.der.coef }];
const GB = { supports: [{ a: arches[0].a, b: arches[0].a }, { a: F.p1_L, b: F.p1_R }, { a: F.p2_L, b: F.p2_R }, { a: F.abut_R, b: F.abut_R }], arches, deckAxis: MCD.z_deck_axis, zBase: [MCD.z_base.p1, MCD.z_base.p2] };
const PB = { E: N0.E_ci / 1e6, rho: N0.rho_ci, rib_h: N0.rib_h, n_ribs: N0.n_ribs, I_factor: 1, deck_A: N0.deck_A, deck_I: N0.deck_I, post_A: N0.post_A, post_I: N0.post_I, E_pier: N0.E_pier / 1e6, pier_t: N0.pier_t, width: N0.width, w_deck: N0.w_deck, springing: 'fixed' };
const frB = OPC.build('arco', GB, PB), mdB = OPC.modal(frB, 20);
ok('Modelo C: nodos y elementos', frB.nodes.length === 156 && frB.el.length === 225, `${frB.nodes.length} nodos, ${frB.el.length} elementos`);
ok('Modelo C: f1 = 7,437 Hz', Math.abs(mdB.f[0] - 7.437) < 0.001, mdB.f[0].toFixed(4) + ' Hz');
ok('Modelo C: 18 zonas de daño', frB.zoneDefs.length === 18);

// 3. Integración sísmica exacta (Nigam-Jennings) contra Newmark con paso muy fino
{ const dt = .01, n = 3000, ag = Float64Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * 1.3 * i * dt) * Math.exp(-i * dt / 10) * 2), w = 2 * Math.PI * 2, z = .05;
  const u = OPC.sdof(ag, dt, w, z); let a = 0; for (const v of u) a = Math.max(a, Math.abs(v));
  let X = 0, V = 0, A = -ag[0], b = 0; const H = dt / 10, k = w * w, c = 2 * z * w, kh = k + 2 * c / H + 4 / H / H;
  for (let i = 0; i < (n - 1) * 10; i++) { const t = (i + 1) * H, j = Math.floor(t / dt + 1e-9), f = t / dt - j, g = ag[Math.min(n - 1, j)] * (1 - f) + ag[Math.min(n - 1, j + 1)] * f;
    const Xn = (-g + (4 / H / H * X + 4 / H * V + A) + c * (2 / H * X + V)) / kh, Vn = 2 / H * (Xn - X) - V, An = 4 / H / H * (Xn - X) - 4 / H * V - A; X = Xn; V = Vn; A = An; b = Math.max(b, Math.abs(X)); }
  ok('Sismo: Nigam-Jennings = Newmark fino', Math.abs(a / b - 1) < 1e-3, `${a.toExponential(4)} vs ${b.toExponential(4)} m`); }

// 4. Superposición modal: masa participante con 20 modos
{ const ag = new Float64Array(500).map((_, i) => Math.sin(i / 7)), r = OPC.seismic(frB, mdB, ag, ag, .01, .02);
  ok('Sismo: masa participante ≥ 85 % (long. y vert.)', r.cumY > .85 && r.cumZ > .85, `${(100 * r.cumY).toFixed(1)} % y ${(100 * r.cumZ).toFixed(1)} %`); }

// 5. Lectura de acelerogramas: Δt desde el encabezado y desde la columna de tiempo
{ const a = OPC.readAccel('ESTACION X\nMuestreo: 100 Hz\nEW NS UD\n' + Array.from({ length: 200 }, (_, i) => `${i} ${-i} ${i / 2}`).join('\n'));
  const b = OPC.readAccel('t a\n' + Array.from({ length: 200 }, (_, i) => `${(i * .005).toFixed(3)} ${Math.sin(i)}`).join('\n'));
  ok('Acelerograma: Δt del encabezado', Math.abs(a.dt - .01) < 1e-12 && a.cols.length === 3);
  ok('Acelerograma: Δt de la columna de tiempo', Math.abs(b.dt - .005) < 1e-9 && b.tcol === 0); }

// 6. Planos DXF (AutoCAD R12): estructura del archivo, capas y láminas
{ const md = OPC.modal(frB, 3), fam = g => g.startsWith('arco') ? 'ARCOS' : g === 'tablero' ? 'TABLERO' : g.startsWith('montante') ? 'MONTANTES' : 'PILARES';
  const r = OPC.bridgePlans({ proyecto: 'PUENTE BALTA · RÍO RÍMAC', fecha: '30/10/2026', fr: frB, fam, apoyos: [{ s: 40, label: 'P1' }], luces: [{ a: 36, b: 60, txt: '24,50' }],
    nube: { s: [40, 50, 60], z: [-1, -2, -3] }, intrados: [], modos: md.f.map((f, k) => ({ f, phi: md.phi[k] })), sensores: [], prioridad: t => 'Alta', orden: ['1. Prueba'] });
  const t = Buffer.from(r.bytes).toString('latin1'), L = t.split('\r\n');
  ok('DXF: cuatro láminas A3 con escala', r.sheets.length === 4 && r.sheets.every(x => x.S > 0), r.sheets.map(x => x.code + ' 1:' + x.S).join(', '));
  ok('DXF: pares código/valor y fin de archivo', L.length % 2 === 1 && L[L.length - 2] === 'EOF' && t.includes('AC1009') && t.includes('ANSI_1252'));
  ok('DXF: texto con tildes en página de códigos 1252', t.includes('R\xcdO R\xcdMAC')); }

// 7. Solver 2D de la plataforma contra OpenSees: se verifica en el navegador (pestaña Validación) con los 450 casos de data/fem_525.csv
ok('Dataset OpenSees presente', fs.existsSync(path.join(P, 'data', 'fem_525.csv')));

console.log(fails ? `\n${fails} prueba(s) fallaron` : '\nTodas las pruebas pasaron');
process.exit(fails ? 1 : 0);
