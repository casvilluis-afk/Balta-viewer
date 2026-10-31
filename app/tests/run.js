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

// 8. Carga viva HL-93 (Manual de Puentes MTC 2018 / AASHTO LRFD) en viga simple de 30 m contra la solución analítica
{ const L = 30, E = 30, A = .6, I = .35, w = 80, fr = OPC.build('viga', { supports: [{ a: 0, b: 0 }, { a: L, b: L }], deckAxis: 0 }, { E, rho: 0, deck_A: A, deck_I: I, w_deck: w });
  const c = t => Math.sqrt(3 * fr.I[t] / fr.A[t]), ll = OPC.liveLoad(fr, c, { lanes: 1 }), mid = fr.deckNodes.reduce((b, v) => Math.abs(v.s - L / 2) < Math.abs(b.s - L / 2) ? v : b);
  const iMid = ll.s.findIndex(s => Math.abs(s - mid.s) < 1e-9), da = -5 * w * L ** 4 / (384 * E * 1e6 * I);
  ok('Estática: flecha por peso propio', Math.abs(ll.dcDef[iMid] / da - 1) < .01, `${(ll.dcDef[iMid] * 1e3).toFixed(2)} vs ${(da * 1e3).toFixed(2)} mm`);
  let M = 0; fr.el.forEach((e, t) => { const s = Math.max(...ll.el[t].q.map(o => o.llMax)); M = Math.max(M, s * 1000 * fr.I[t] / c(t)); });
  let Ma = 0; for (let x = 0; x <= L; x += .25) { const il = a => a < 0 || a > L ? 0 : (a <= x ? a * (L - x) / L : x * (L - a) / L); let tm = 0; const sets = [];
    for (let g = 4.3; g <= 9.0001; g += .35) sets.push([[35, 145, 145], [0, 4.3, 4.3 + g]]); sets.push([[110, 110], [0, 1.2]]);
    for (const [P, d] of sets) for (const dir of [1, -1]) for (let p = -20; p <= L + 20; p += .25) { let v = 0; P.forEach((q, k) => v += q * il(p + dir * d[k])); tm = Math.max(tm, v); }
    Ma = Math.max(Ma, (tm * 1.33 + 9.3 * x * (L - x) / 2) * 1.2); }
  ok('HL-93: momento máximo (camión/tándem + carril, IM 33 %, m 1,2)', Math.abs(M / Ma - 1) < .01, `${M.toFixed(1)} vs ${Ma.toFixed(1)} kN·m`); }

// 9. Vibración medida (FDD + EFDD): respuesta sintética del modelo C en los 9 sensores, ruido blanco, ζ = 1 %, 600 s a 100 Hz, 4 semillas.
//    Criterio realista: los modos separados (4 a 6) con error ≤ 0,6 % en todos los registros; el grupo 7,44 / 7,52 / 7,71 Hz está más junto que su ancho de banda (2ζf ≈ 0,15 Hz)
//    y puede fundirse: se exige al menos un modo del grupo con error ≤ 1 % y se informa cuántas veces se separó el par 1–2.
{ const md = OPC.modal(frB, 6), sens = OPC.sensorsOf(frB), fs = 100, n = 60000; let worst = 0, pair = 0, info = [];
  for (const seed0 of [3, 11, 17, 23]) { let seed = seed0; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - .5; };
    const ch = sens.map(() => new Float64Array(n)); md.f.forEach((f, k) => { const q = OPC.sdof(Float64Array.from({ length: n }, rnd), 1 / fs, 2 * Math.PI * f, .01); sens.forEach((s, i) => { const ph = md.phi[k][s.dof]; for (let j = 0; j < n; j++) ch[i][j] += ph * q[j]; }); });
    const pk = OPC.fddModes(OPC.fdd(OPC.csdMatrix(ch, fs, 8192)), { fmin: 2, fmax: 20, promDb: 3 }), err = f => Math.min(...pk.map(p => Math.abs(p.f / f - 1)));
    worst = Math.max(worst, ...md.f.slice(3).map(err)); if (err(md.f[0]) < .01 && err(md.f[1]) < .01) pair++; if (Math.min(...md.f.slice(0, 3).map(err)) > .01) worst = 1; info.push(pk.length); }
  ok('FDD/EFDD: modos separados del modelo C con error ≤ 0,6 % (4 registros)', worst <= .006, `error máx ${(100 * worst).toFixed(2)} % · par cercano separado en ${pair} de 4 · modos hallados ${info.join('/')}`); }

// 10. Deterioro (Markov): tiempo mediano en CS1 y plan de mantenimiento con presupuesto
{ const T = [10, 15, 20]; let d = [1, 0, 0, 0]; for (let y = 0; y < 10; y++) d = OPC.markovStep(d, T);
  ok('Markov: 50 % sigue en CS1 al cumplir el tiempo mediano', Math.abs(d[0] - .5) < 1e-9, d[0].toFixed(6));
  const pl = OPC.maintenancePlan([{ id: 'Arco', w: 10, q: 100, d: [.5, .3, .15, .05], T, acciones: [{ nombre: 'Reparación', costo: 50, de: [2, 3], a: 0 }] }], { years: 10, budget: 2000, thr: 70 });
  ok('Plan de mantenimiento: mantiene el índice sobre el umbral', pl.plan.length > 0 && Math.min(...pl.hi) >= 70 && pl.hi0[pl.hi0.length - 1] < 70, `con plan mín ${Math.min(...pl.hi).toFixed(0)}, sin plan final ${pl.hi0[pl.hi0.length - 1].toFixed(0)}`); }

// 12. Calibración del modelo (prueba ciega): puente "real" con E 88 GPa, peralte 0,66 m y pilares 6,5 GPa; se miden 5 modos con formas en los 9 sensores
{ const truth = Object.assign({}, PB, { E: 88, rib_h: .66, E_pier: 6.5 }), frT = OPC.build('arco', GB, truth), mT = OPC.modal(frT, 8), sens = OPC.sensorsOf(frB), m0 = OPC.modal(frB, 8);
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0), meas = { f: {}, sh: {}, sens: [0, 1, 2, 3, 4, 5, 6, 7, 8] };
  [0, 2, 3, 4, 5].forEach(j => { const v0 = sens.map(s => m0.phi[j][s.dof]); let best = -1, b = j; mT.phi.forEach((ph, k) => { const v = sens.map(s => ph[s.dof]), m = dot(v, v0) ** 2 / (dot(v, v) * dot(v0, v0)); if (m > best) { best = m; b = k; } }); meas.f[j] = mT.f[b]; meas.sh[j] = sens.map(s => mT.phi[b][s.dof]); });
  const r = OPC.calibrateModel('arco', GB, PB, meas, [{ k: 'E', min: 66, max: 111 }, { k: 'rib_h', min: .55, max: .85 }, { k: 'E_pier', min: 3, max: 10 }]), v = k => r.P[k];
  ok('Calibración ciega: recupera E y peralte (±3 %) y E de pilares (±10 %)', Math.abs(v('E') / 88 - 1) < .03 && Math.abs(v('rib_h') / .66 - 1) < .03 && Math.abs(v('E_pier') / 6.5 - 1) < .1, `E ${v('E').toFixed(1)} GPa · peralte ${v('rib_h').toFixed(3)} m · pilares ${v('E_pier').toFixed(2)} GPa · ${r.evals} evaluaciones`); }

// 13. IA con formas modales medidas frente a IA solo con frecuencias (campaña reducida del modelo C, error medio)
{ const camp = OPC.freqCampaign('arco', GB, PB, { nPerZone: 30, nUndamaged: 60, unc: .05, seed: 7, NM: 8 }), all = [0, 1, 2, 3, 4, 5], sens = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const IF = OPC.trainModalIA(camp, { f: all, s: [], sens }, .005, .05), IM = OPC.trainModalIA(camp, { f: all, s: all, sens }, .005, .05);
  ok('IA: las formas modales mejoran la localización', IM.metrics.localizacion > IF.metrics.localizacion + .15, `zona exacta ${(100 * IF.metrics.localizacion).toFixed(0)} % → ${(100 * IM.metrics.localizacion).toFixed(0)} % · vano ${(100 * IF.metrics.vano).toFixed(0)} % → ${(100 * IM.metrics.vano).toFixed(0)} %`); }

// 14. Detección de apoyos en la nube TLS del Balta: los dos pilares (caras medidas) y el estribo derecho
{ const d = JSON.parse(fs.readFileSync(path.join(P, 'data', 'nube_balta.json'))), q = new Uint16Array(Buffer.from(d.pos, 'base64').buffer.slice(0)), xyz = new Float32Array(3 * d.n);
  for (let i = 0; i < d.n; i++) for (let k = 0; k < 3; k++) xyz[3 * i + k] = d.lo[k] + q[3 * i + k] / 65535 * (d.hi[k] - d.lo[k]);
  const O = OPC.orient({ xyz, offset: [0, 0, 0] }, 'z', 1), S = OPC.detectSupports(O, OPC.deckLevel(O), OPC.groundLevel(O)).supports, near = (x, y) => Math.abs(x - y) < .6;
  ok('Apoyos del Balta: pilares P1 y P2 y estribo derecho', S.length === 3 && S[0].tipo === 'pilar' && S[1].tipo === 'pilar' && S[2].tipo === 'estribo' && near(S[0].a, F.p1_L) && near(S[1].b, F.p2_R), S.map(p => `${p.tipo} ${p.a.toFixed(1)}–${p.b.toFixed(1)}`).join(' · ')); }

// 15. Campaña de registros: los modos que se repiten se separan del ruido que aparece y desaparece, y se estima el efecto de la temperatura
{ let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const W = Array.from({ length: 10 }, (_, i) => { const T = 2 + 1.5 * i; return { T, peaks: [4.6 - .01 * T, 7.2 - .015 * T, 10.6].map(f => ({ f: f + (rnd() - .5) * .01, zeta: .02 })).concat([{ f: 3 + 25 * rnd(), zeta: .01 }, { f: 3 + 25 * rnd(), zeta: .01 }]) }; });
  const R = OPC.peakCampaign(W, { minPres: .5 }), m = R.modes;
  ok('Campaña: tres modos persistentes y pendiente por temperatura', m.length === 3 && Math.abs(m[0].slope + .01) < .002 && Math.abs(m[1].slope + .015) < .002 && m[0].sdComp < m[0].sdRaw, m.map(c => `${c.f.toFixed(2)} Hz ${(1000 * c.slope).toFixed(1)} mHz/°C`).join(' · ')); }

// 16. Rasgos respecto a la línea base: una medición igual a la base no tiene cambio
{ const camp = { f0: [1, 2], sh0: [[1, 2, 3], [3, 2, 1]] }, base = { fm: { 0: 4.6, 1: 7.2 }, shapes: { 0: [.2, .5, .3], 1: [.4, -.1, .3] } }, x = OPC.modalMeasFeat(camp, { f: [0, 1], s: [0, 1], sens: [0, 1, 2] }, base.fm, base.shapes, base);
  ok('Línea base: medición idéntica → rasgos nulos', x.every(v => Math.abs(v) < 1e-12), x.length + ' rasgos'); }

// 17. Solver 2D de la plataforma contra OpenSees: se verifica en el navegador (pestaña Validación) con los 450 casos de data/fem_525.csv
ok('Dataset OpenSees presente', fs.existsSync(path.join(P, 'data', 'fem_525.csv')));

console.log(fails ? `\n${fails} prueba(s) fallaron` : '\nTodas las pruebas pasaron');
process.exit(fails ? 1 : 0);
