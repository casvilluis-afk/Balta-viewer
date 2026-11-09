// Pruebas del núcleo de cálculo (sin navegador). Se ejecutan en GitHub Actions antes de compilar la app.
// node tests/run.js
const fs = require('fs'), path = require('path');
const P = path.join(__dirname, '..', '..', 'plataforma');
global.self = undefined;
const OPC = new Function(fs.readFileSync(path.join(P, 'op_core.js'), 'utf8') + '\nreturn OPC;')();
let fails = 0; const ok = (name, cond, info) => { console.log((cond ? 'OK   ' : 'FALLA') + '  ' + name + (info ? '  · ' + info : '')); if (!cond) fails++; };
const PEND = []; // pruebas que leen archivos (asíncronas)

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
ok('Modelo C: 20 zonas de daño (15 de arcos, 3 de tablero y 2 de pilares por socavación)', frB.zoneDefs.length === 20 && frB.zoneOf.filter(z => z >= 18).length === 2);

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
  ok('Apoyos del Balta: pilares P1 y P2 y estribo derecho', S.length === 3 && S[0].tipo === 'pilar' && S[1].tipo === 'pilar' && S[2].tipo === 'estribo' && near(S[0].a, F.p1_L) && near(S[1].b, F.p2_R), S.map(p => `${p.tipo} ${p.a.toFixed(1)}–${p.b.toFixed(1)}`).join(' · '));
  // tipología sugerida: arco, sin pilono (los postes y árboles no cuentan como torre)
  const dk = OPC.deckLevel(O), gr = OPC.groundLevel(O), T = OPC.suggestType(O, dk, gr, S, { zmin: gr + .2 * (dk - gr), zmax: dk - .38 }, Math.max(3, Math.round(15 * d.n / d.n_original)), { left: 'simetria', right: 'none' });
  ok('Tipología sugerida del Balta: arco, sin torre', T.tipo === 'arco' && !T.atirantado, T.tipo + (T.atirantado ? ' · torre' : ''));
  // tramo recortado por el usuario: el eje queda fijo en x aunque la planta sea casi cuadrada
  const sq = new Float32Array(3 * 4000); for (let i = 0; i < 4000; i++) { sq[3 * i] = (i % 63) * .3; sq[3 * i + 1] = Math.floor(i / 63) * .3; sq[3 * i + 2] = 0; }
  const Oq = OPC.orient({ xyz: sq, offset: [0, 0, 0] }, 'z', 1), Ox = OPC.orient({ xyz: sq, offset: [0, 0, 0], eje: 'x' }, 'z', 1);
  // esviaje: tablero de 40 × 8 m a cota 0 con terreno a −6 y dos muros de pila oblicuos a 30° (en s = 13 y 27 sobre el eje): se mide el ángulo y las pilas quedan en el eje
  { const P = [], k30 = Math.tan(30 * Math.PI / 180); for (let s0 = 0; s0 <= 40; s0 += .25) for (let t = -4; t <= 4; t += .25) { P.push(s0, t, 0); P.push(s0, t, -6); }
    for (const c of [13, 27]) for (let t = -4; t <= 4; t += .1) for (let z = -6; z <= -.8; z += .1) P.push(c + t * k30, t, z);
    const Os = OPC.orient({ xyz: Float32Array.from(P), offset: [0, 0, 0], eje: 'x' }, 'z', 1), Ss = OPC.detectSupports(Os, 0, -6), pil = Ss.supports.filter(p => p.tipo === 'pilar').map(p => (p.a + p.b) / 2);
    ok('Esviaje: ángulo de las pilas medido y pilas en el eje del tablero', Math.abs(Math.abs(Ss.skew) - 30) <= 2 && pil.length === 2 && Math.abs(pil[1] - pil[0] - 14) < .6, `esviaje ${Ss.skew}° · pilas ${pil.map(v => v.toFixed(1)).join(', ')}`); }
  // IA de apoyos: en el Balta coincide con la regla geométrica; en un caso sintético quita un pilar sin columna y propone el que falta
  { const M = JSON.parse(fs.readFileSync(path.join(P, 'data', 'ia_apoyos.json'))), Rb = OPC.iaRefine(O, dk, gr, S, M);
    ok('IA de apoyos: en el Balta no cambia P1, P2 ni el estribo', Rb.usado && !Rb.veto.length && !Rb.rescate.length && !Rb.aEstribo.length && Rb.supports.length === 3, `${Rb.clusters.length} grupos de columnas vistos`);
    const Q = []; for (let s0 = 0; s0 <= 40; s0 += .15) for (let t = -4; t <= 4; t += .15) { Q.push(s0, t, 0); Q.push(s0, t, -.8); Q.push(s0, t, -6); }
    for (const c of [13, 27]) for (const tc of [-2.5, 2.5]) for (let a = 0; a < 6.28; a += .15) for (let z = -6; z <= -.8; z += .1) Q.push(c + .4 * Math.cos(a), tc + .4 * Math.sin(a), z);
    const Oc = OPC.orient({ xyz: Float32Array.from(Q), offset: [0, 0, 0], eje: 'x' }, 'z', 1), Rc = OPC.iaRefine(Oc, 0, -6, [{ a: 0, b: 0, tipo: 'estribo' }, { a: 12.6, b: 13.4, tipo: 'pilar' }, { a: 19.6, b: 20.4, tipo: 'pilar' }, { a: 40, b: 40, tipo: 'estribo' }], M), pc = Rc.supports.filter(p => p.tipo === 'pilar').map(p => (p.a + p.b) / 2);
    ok('IA de apoyos: quita el pilar sin columna (20 m) y propone el que faltaba (27 m)', Rc.veto.length === 1 && Rc.rescate.length === 1 && pc.length === 2 && Math.abs(pc[0] - 13) < .6 && Math.abs(pc[1] - 27) < .6, `pilares ${pc.map(v => v.toFixed(1)).join(', ')}`); }
  // IA de estribos e interpretación del puente completo: en el Balta no cambian nada; en un puente sintético regular la interpretación coincide con la regla
  { const M = JSON.parse(fs.readFileSync(path.join(P, 'data', 'ia_apoyos.json'))), ME = JSON.parse(fs.readFileSync(path.join(P, 'data', 'ia_estribos.json'))), Rb = OPC.iaRefine(O, dk, gr, S, M);
    const Pe = OPC.iaPredict(ME, Rb.R.F, Rb.R.nf, Rb.R.nv), E = OPC.iaEstribos(Rb.R, Pe, dk, Rb.supports), Hb = OPC.hipotesis(O, dk, gr, S, Object.assign({}, Rb, { supports: E.supports }));
    ok('IA de estribos e interpretación del puente completo: el Balta queda igual', !E.cambios.length && !Hb.cambios.quitados.length && !Hb.cambios.agregados.length, `${E.supports.map(p => p.tipo[0] + ((p.a + p.b) / 2).toFixed(1)).join(' ')}`);
    const Q = []; for (let s0 = -6; s0 <= 46; s0 += .2) for (let t = -4; t <= 4; t += .2) { Q.push(s0, t, 0); if (s0 > 0 && s0 < 40) Q.push(s0, t, -6); else Q.push(s0, t, -.2); }
    for (const c of [13, 27]) for (const tc of [-2.5, 2.5]) for (let a = 0; a < 6.28; a += .15) for (let z = -6; z <= -.8; z += .1) Q.push(c + .4 * Math.cos(a), tc + .4 * Math.sin(a), z);
    for (const c of [0, 40]) for (let t = -4; t <= 4; t += .1) for (let z = -6; z <= -.8; z += .1) Q.push(c, t, z);
    const Oc = OPC.orient({ xyz: Float32Array.from(Q), offset: [0, 0, 0], eje: 'x' }, 'z', 1), sc = [{ a: 0, b: 0, tipo: 'estribo' }, { a: 12.6, b: 13.4, tipo: 'pilar' }, { a: 26.6, b: 27.4, tipo: 'pilar' }, { a: 40, b: 40, tipo: 'estribo' }];
    const Hc = OPC.hipotesis(Oc, 0, -6, sc, null), pc = Hc.supports.map(p => p.tipo[0] + Math.round((p.a + p.b) / 2)).join(' ');
    ok('Interpretación del puente completo: puente regular de 3 vanos sin cambios', pc === 'e0 p13 p27 e40', pc); }
  // Estribos por el fin del hueco bajo el tablero: el Balta no cambia; en un puente sintético los estribos puestos 4 m afuera vuelven a la cara (0 y 40 m)
  { const Hb = OPC.estribosHueco(O, dk, gr, S); ok('Fin del hueco: el Balta queda igual', !Hb.cambios.length, Hb.supports.map(p => p.tipo[0] + ((p.a + p.b) / 2).toFixed(1)).join(' '));
    const Q = []; for (let s0 = -8; s0 <= 48; s0 += .2) for (let t = -4; t <= 4; t += .2) { Q.push(s0, t, 0); Q.push(s0, t, s0 > 0 && s0 < 40 ? -6 : -.3); }
    for (const c of [0, 40]) for (let t = -4; t <= 4; t += .1) for (let z = -6; z <= -.4; z += .1) Q.push(c, t, z);
    const Oh = OPC.orient({ xyz: Float32Array.from(Q), offset: [0, 0, 0], eje: 'x' }, 'z', 1), H = OPC.estribosHueco(Oh, 0, -6, [{ a: -4, b: -4, tipo: 'estribo' }, { a: 19.6, b: 20.4, tipo: 'pilar' }, { a: 44, b: 44, tipo: 'estribo' }]), e = H.supports.filter(p => p.tipo === 'estribo').map(p => p.a);
    ok('Fin del hueco: estribos movidos a la cara (0 y 40 m)', e.length === 2 && Math.abs(e[0]) < .8 && Math.abs(e[1] - 40) < .8, e.map(v => v.toFixed(1)).join(', ')); }
  // Superestructura sobre el tablero: arco fino y simétrico → arco superior; mástil con cables rectos → atirantado; tablero solo → nada
  { const base = () => { const Q = []; for (let s0 = 0; s0 <= 200; s0 += .5) for (let t = -6; t <= 6; t += .5) { Q.push(s0, t, 0); Q.push(s0, t, -12); } return Q; };
    const A = base(); for (let s0 = 40; s0 <= 160; s0 += .25) { const z = 30 * (1 - ((s0 - 100) / 60) ** 2); for (const t of [-6, 6]) for (let d = 0; d < .8; d += .2) A.push(s0, t, z - d); if (Math.abs(s0 % 8) < .2) for (let z2 = 1; z2 < z; z2 += .3) { A.push(s0, -6, z2); A.push(s0, 6, z2); } }
    const C = base(); for (const m of [60, 140]) { for (let z = 0; z <= 45; z += .2) for (let d = -.5; d <= .5; d += .25) C.push(m + d, 0, z); for (let k = 1; k <= 8; k++) { const sx = 4.5 * k; for (let u = 0; u <= 1; u += .005) { C.push(m - sx * u, 0, 45 - 45 * u + 1e-3); C.push(m + sx * u, 0, 45 - 45 * u + 1e-3); } } }
    const G = OPC => (Q) => { const Oq = OPC.orient({ xyz: Float32Array.from(Q), offset: [0, 0, 0], eje: 'x' }, 'z', 1); return OPC.superestructura(Oq, 0, -12); };
    const ra = G(OPC)(A), rc = G(OPC)(C), r0 = G(OPC)(base());
    ok('Superestructura: arco sobre el tablero, pilonos con cables y tablero solo', ra.some(x => x.tipo === 'arco_superior' && Math.abs(x.altura - 30) < 2) && rc.filter(x => x.tipo === 'atirantado').length === 2 && !r0.length,
      `arco: ${ra.map(x => x.tipo + ' ' + x.altura).join(', ')} · atirantado: ${rc.map(x => x.tipo + ' ' + x.pilonos.map(p => p.s).join('/')).join(', ')}`); }
  // Pilono único inclinado (como el Erasmusbrug): la continuidad del mástil se busca en una ventana proporcional a su altura
  { const Q = []; for (let s0 = 0; s0 <= 400; s0 += .5) for (let t = -6; t <= 6; t += 1) { Q.push(s0, t, 0); Q.push(s0, t, -12); }
    for (let z = 0; z <= 120; z += .2) for (let d = -.5; d <= .5; d += .25) Q.push(250 + 22 * z / 120 + d, 0, z);
    for (let k = 1; k <= 10; k++) { const zt = 60 + 6 * k, st = 250 + 22 * zt / 120; for (let u = 0; u <= 1; u += .05) { Q.push(st - 20 * k * u, 0, zt * (1 - u) + 1e-3); Q.push(st + 6 * k * u, 0, zt * (1 - u) + 1e-3); } }
    const Oq = OPC.orient({ xyz: Float32Array.from(Q), offset: [0, 0, 0], eje: 'x' }, 'z', 1), r = OPC.superestructura(Oq, 0, -12), at = r.filter(x => x.tipo === 'atirantado');
    ok('Superestructura: pilono único inclinado reconocido como atirantado', at.length === 1 && at[0].pilonos.length === 1, r.map(x => x.tipo + ' ' + x.pilonos.map(p => p.s + '/' + p.h).join(',')).join('; ')); }
  // Calidad de la nube: un tablero completo no da alarmas; uno con un hueco de 10 m y el extremo derecho sobre el vacío sí
  { const mk = (hueco, aire) => { const Q = []; for (let s0 = -30; s0 <= 90; s0 += .25) for (let t = -4; t <= 4; t += .5) {
        const enPuente = s0 >= 0 && s0 <= 60; if (hueco && s0 > 25 && s0 < 35) continue; if (aire && s0 > 60) { if (t === 0) Q.push(s0, t, -8); continue; }
        Q.push(s0, t, enPuente ? 0 : 0); if (enPuente) Q.push(s0, t, -.9); if (!enPuente) for (let z = -8; z < 0; z += 2) if (Math.abs(s0) < .3 || Math.abs(s0 - 60) < .3) Q.push(s0, t, z);
        if (enPuente) Q.push(s0, t, -8); }
      for (const c of [20, 40]) for (let z = -8; z <= -1; z += .1) for (let t = -1; t <= 1; t += .25) Q.push(c, t, z);
      return OPC.orient({ xyz: Float32Array.from(Q), offset: [0, 0, 0], eje: 'x' }, 'z', 1); };
    const sup = [{ a: -.5, b: .5, tipo: 'estribo' }, { a: 19.5, b: 20.5, tipo: 'pilar' }, { a: 39.5, b: 40.5, tipo: 'pilar' }, { a: 59.5, b: 60.5, tipo: 'estribo' }];
    const q0 = OPC.calidadNube(mk(false, false), 0, -8, sup), q1 = OPC.calidadNube(mk(true, true), 0, -8, sup.slice(0, 3));
    const crit = q => q.avisos.filter(a => a.nivel === 'crit').map(a => a.txt.slice(0, 40));
    ok('Calidad de la nube: completo sin alarmas; hueco de 10 m y final en el aire detectados', !crit(q0).length && q1.huecos.some(h => h.a >= 24 && h.b <= 36) && crit(q1).some(t => /aire/.test(t)), `completo: ${crit(q0).length} alarmas · con fallas: ${crit(q1).join(' | ')}`); }
  // Eje curvo: tablero en arco de radio 60 m y 80 m de largo (giro 76°) con terreno 8 m abajo; el recorrido mide largo y giro
  { const Q = [], R = 60, L = 80; for (let s0 = -L / 2 - 10; s0 <= L / 2 + 10; s0 += .3) for (let t = -4; t <= 4; t += .4) { const a = s0 / R, x = (R - t) * Math.sin(a), y = R - (R - t) * Math.cos(a), dentro = Math.abs(s0) <= L / 2;
        Q.push(x, y, dentro ? 0 : 0); if (dentro) Q.push(x, y, -8); }
    const Oq = OPC.orient({ xyz: Float32Array.from(Q), offset: [0, 0, 0] }, 'z', 1), E = OPC.ejeCurvo(Oq, 0);
    ok('Eje curvo: recorre un tablero en arco (radio 60 m) y mide su largo y su giro', E && Math.abs(E.largo - L) < 12 && Math.abs(Math.abs(E.giro) - L / R * 180 / Math.PI) < 15, E ? `largo ${E.largo.toFixed(1)} m (80) · giro ${Math.abs(E.giro).toFixed(0)}° (76)` : 'sin eje'); }
  // Dimensiones: tablero de 1,2 m de canto (calzada en 0, cara inferior en −1,2; la cara inferior es la capa más poblada, como al escanear desde abajo)
  // y un pilar de 1,0 × 5,0 m en s = 25; el terreno está en −8
  { const Q = []; for (let s0 = -10; s0 <= 60; s0 += .2) for (let t = -5; t <= 5; t += .25) { Q.push(s0, t, 0); if (s0 >= 0 && s0 <= 50) { Q.push(s0, t, -1.2); Q.push(s0, t + .1, -1.2); } Q.push(s0, t, -8); }
    for (let z = -8; z <= -1.2; z += .1) { for (let t = -2.5; t <= 2.5; t += .1) { Q.push(24.5, t, z); Q.push(25.5, t, z); } for (let s0 = 24.5; s0 <= 25.5; s0 += .1) { Q.push(s0, -2.5, z); Q.push(s0, 2.5, z); } }
    const Oq = OPC.orient({ xyz: Float32Array.from(Q), offset: [0, 0, 0], eje: 'x' }, 'z', 1), dkq = OPC.deckLevel(Oq);
    const D = OPC.dimensiones(Oq, dkq, -8, [{ a: -.5, b: .5, tipo: 'estribo' }, { a: 24.5, b: 25.5, tipo: 'pilar' }, { a: 49.5, b: 50.5, tipo: 'estribo' }]), P1 = D && D.pilares[0];
    ok('Dimensiones: canto del tablero 1,2 m y pilar de 1,0 × 5,0 m medidos en la nube', D && Math.abs(D.canto - 1.2) <= .15 && P1 && Math.abs(P1.espesor - 1) <= .15 && Math.abs(P1.ancho - 5) <= .3, D ? `canto ${D.canto} m · pilar ${P1 && P1.espesor} × ${P1 && P1.ancho} m · nivel de referencia ${dkq.toFixed(2)} m` : 'sin medida'); }
  // Elementos y modelo IFC: tablero de 1,2 m de canto con barandas de 1,1 m en ambos bordes, un pilar de 1,0 × 5,0 m, en una nube girada 30° y
  // desplazada a coordenadas UTM; se identifican los elementos, se exporta el IFC4X3 y un punto vuelve exacto a las coordenadas del archivo
  { const Q = [], g = 30 * Math.PI / 180, X0 = 279000, Y0 = 8665000, put = (s0, t, z) => Q.push(s0 * Math.cos(g) - t * Math.sin(g), s0 * Math.sin(g) + t * Math.cos(g), z);
    for (let s0 = -10; s0 <= 60; s0 += .2) for (let t = -5; t <= 5; t += .25) { put(s0, t, 0); if (s0 >= 0 && s0 <= 50) { put(s0, t, -1.2); put(s0, t + .1, -1.2); } put(s0, t, -8); }
    for (let s0 = 0; s0 <= 50; s0 += .2) for (let z = .1; z <= 1.1; z += .1) { put(s0, -5, z); put(s0, 5, z); }
    for (let z = -8; z <= -1.2; z += .1) { for (let t = -2.5; t <= 2.5; t += .1) { put(24.5, t, z); put(25.5, t, z); } for (let s0 = 24.5; s0 <= 25.5; s0 += .1) { put(s0, -2.5, z); put(s0, 2.5, z); } }
    const c = { xyz: Float32Array.from(Q), offset: [X0, Y0, 3500] }, Oq = OPC.orient(c, 'z', 1), dkq = OPC.deckLevel(Oq), sup = OPC.detectSupports(Oq, dkq, OPC.groundLevel(Oq)).supports;
    const R = OPC.elementos(Oq, dkq, OPC.groundLevel(Oq), sup), E = R ? R.elementos : [], br = E.filter(e => e.tipo === 'baranda'), pi = E.find(e => e.tipo === 'pilar');
    const ifc = OPC.exportarIFC(R, Oq, { nombre: 'prueba' }), w = OPC.alMundo(Oq, Oq.s[1234], Oq.t[1234], Oq.z[1234]), err = Math.max(...[0, 1, 2].map(k => Math.abs(w[k] - (c.xyz[3 * 1234 + k] + c.offset[k]))));
    ok('Elementos: pilar, dos tableros y dos barandas de 1,1 m; IFC4X3 con puente, pilar y barandas; vuelta exacta a coordenadas UTM',
      pi && E.filter(e => e.tipo === 'tablero').length === 2 && br.length === 2 && br.every(b => Math.abs(b.altura - 1.1) <= .1) && /FILE_SCHEMA\(\('IFC4X3_ADD2'\)\)/.test(ifc) && /IFCBRIDGE\(/.test(ifc) && /IFCCOLUMN\(/.test(ifc) && (ifc.match(/IFCRAILING\(/g) || []).length === 2 && err < .01,
      `${E.map(e => e.tipo).join(', ')} · barandas ${br.map(b => b.altura).join(' y ')} m · IFC ${(ifc.length / 1024).toFixed(0)} kB · error de vuelta ${(err * 1000).toFixed(1)} mm`); }
  // Ficha de inspección: dos fechas del mismo puente; en la segunda, la baranda derecha está empujada 30 cm hacia afuera entre 30 y 34 m (golpe) y falta un
  // bloque de la parte baja del pilar. Los cambios deben quedar asignados a la baranda derecha y al pilar; la calificación pasa al IFC
  { let a0 = 11; const rnd = () => { a0 = (a0 * 1103515245 + 12345) % 2147483648; return a0 / 2147483648; }, N = () => (rnd() + rnd() + rnd() - 1.5) * .02;
    const mk = dano => { const Q = [], put = (s0, t, z) => Q.push(s0 + N(), t + N(), z + N());
      for (let s0 = -10; s0 <= 60; s0 += .2) for (let t = -5; t <= 5; t += .25) { put(s0, t, 0); if (s0 >= 0 && s0 <= 50) put(s0, t, -1.2); put(s0, t, -8); }
      for (let s0 = 0; s0 <= 50; s0 += .1) for (let z = .1; z <= 1.1; z += .05) { put(s0, -5, z); put(s0, 5 + (dano && s0 >= 30 && s0 <= 34 ? .3 : 0), z); }
      for (let z = -8; z <= -1.2; z += .1) { if (dano && z < -5) continue; for (let t = -2.5; t <= 2.5; t += .1) { put(24.5, t, z); put(25.5, t, z); } for (let s0 = 24.5; s0 <= 25.5; s0 += .1) { put(s0, -2.5, z); put(s0, 2.5, z); } }
      return { xyz: Float32Array.from(Q), offset: [0, 0, 0], eje: 'x' }; };
    const cA = mk(false), OA = OPC.orient(cA, 'z', 1), dk = OPC.deckLevel(OA), gr = OPC.groundLevel(OA), sup = OPC.detectSupports(OA, dk, gr).supports, R = OPC.elementos(OA, dk, gr, sup);
    const C = OPC.compararNubes(OA, OPC.orientarComo(mk(true), OA.tr), dk, gr, sup, { georef: true }), F = OPC.fichaInspeccion(OA, R, { comparacion: C });
    const bd = F.elementos.find(e => e.tipo === 'baranda' && e.medidas.lado === 'derecha'), pl = F.elementos.find(e => e.tipo === 'pilar'), ev = it => it ? it.evid.filter(e => e.fuente === 'comparación') : [];
    const ifc = OPC.exportarIFC(R, OA, { nombre: 'ficha', inspeccion: { calif: { [bd ? bd.id : 'x']: { condicion: 3, material: 'acero', danos: ['daño por colisión'] } }, meta: { fecha: '2026-11-08' }, global: 3 } });
    ok('Ficha de inspección: golpe en la baranda derecha y pérdida en el pilar asignados a su elemento; calificación MTC en el IFC',
      ev(bd).some(e => e.a <= 34 && e.b >= 30) && ev(pl).length >= 1 && /'CondicionMTC',\$,IFCINTEGER\(3\)/.test(ifc) && (ifc.match(/Pset_PuenteGemelo_InspeccionMTC/g) || []).length === 2,
      `baranda derecha: ${ev(bd).map(e => e.texto.slice(0, 60)).join(' | ') || 'nada'} · pilar: ${ev(pl).map(e => e.texto.slice(0, 60)).join(' | ') || 'nada'} · sin elemento ${F.sinElemento.length}`); }
  // Nube aérea rala (0,5 m entre puntos) de un puente largo en «lomo» (rasante +8 m al centro, 400 m) con dos pilares macizos de 5 m vistos de lado:
  // los estribos deben quedar en los extremos del tablero (no donde la recta de la rasante se separa de la calzada) y los dos pilares deben aparecer
  { let a0 = 5; const rnd = () => { a0 = (a0 * 1103515245 + 12345) % 2147483648; return a0 / 2147483648; }, Q = [], zr = s0 => 8 * (1 - (s0 / 200) ** 2);
    for (let s0 = -230; s0 <= 230; s0 += .5) for (let t = -10; t <= 10; t += .5) { const enP = Math.abs(s0) <= 200; if (enP) Q.push(s0, t, zr(s0)); Q.push(s0, t, enP ? -15 : zr(200) - .3); }
    for (const c of [-70, 70]) for (let z = -15; z < zr(c) - 1.5; z += .5) for (let t = -10; t <= 10; t += 1) if (rnd() < .5) { Q.push(c - 2.5, t, z); Q.push(c + 2.5, t, z); }
    const Oq = OPC.orient({ xyz: Float32Array.from(Q), offset: [0, 0, 0], eje: 'x' }, 'z', 1), dkq = OPC.deckLevel(Oq), grq = OPC.groundLevel(Oq), S = OPC.estribosHueco(Oq, dkq, grq, OPC.detectSupports(Oq, dkq, grq).supports).supports;
    const es = S.filter(p => p.tipo === 'estribo').map(p => (p.a + p.b) / 2), pl = S.filter(p => p.tipo === 'pilar').map(p => (p.a + p.b) / 2);
    ok('Nube aérea rala con rasante en lomo: estribos en los extremos y los dos pilares macizos', es.length === 2 && Math.abs(es[0] + 200) < 8 && Math.abs(es[1] - 200) < 8 && pl.length === 2 && pl.every(s0 => Math.abs(Math.abs(s0) - 70) < 4),
      `estribos ${es.map(v => v.toFixed(0)).join(', ')} · pilares ${pl.map(v => v.toFixed(0)).join(', ')}`); }
  // Atributos: un PLY binario con color e intensidad se lee con sus atributos; en la calzada, una mancha de 3 m con intensidad 40 % menor
  // se marca como zona a revisar, y un arbusto verde junto al pilar se reconoce como vegetación (la estructura gris no)
  PEND.push((async () => { const P = [], at = []; const add = (s0, t, z, I, r, g, b) => { P.push(s0, t, z); at.push([I, r, g, b]); };
    for (let s0 = -10; s0 <= 60; s0 += .25) for (let t = -4; t <= 4; t += .25) { add(s0, t, 0, s0 > 30 && s0 < 33 ? 60 : 100 + 5 * Math.sin(s0), 128, 128, 130); add(s0, t, -8, 80, 120, 110, 90); if (s0 >= 0 && s0 <= 50) add(s0, t, -1, 90, 128, 128, 130); }
    for (let z = -8; z <= -1; z += .1) for (let t = -2; t <= 2; t += .1) { add(24.5, t, z, 95, 128, 128, 130); add(25.5, t, z, 95, 128, 128, 130); }
    for (let k = 0; k < 3000; k++) { const a = k * 2.399, rr = 1.5 * Math.sqrt((k % 100) / 100); add(20 + rr * Math.cos(a), 6 + rr * Math.sin(a), -7 + (k % 37) / 10, 50, 60, 140, 50); }
    const n = P.length / 3, hdr = `ply\nformat binary_little_endian 1.0\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty float intensity\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
    const buf = new ArrayBuffer(n * 19), dv = new DataView(buf); for (let i = 0; i < n; i++) { const o = i * 19; dv.setFloat32(o, P[3 * i], true); dv.setFloat32(o + 4, P[3 * i + 1], true); dv.setFloat32(o + 8, P[3 * i + 2], true); dv.setFloat32(o + 12, at[i][0], true); dv.setUint8(o + 16, at[i][1]); dv.setUint8(o + 17, at[i][2]); dv.setUint8(o + 18, at[i][3]); }
    const c = await OPC.parseCloud(new Blob([hdr, buf]), 'atr.ply', null); c.eje = 'x'; const Oa = OPC.orient(c, 'z', 1);
    const sup = [{ a: -.5, b: .5, tipo: 'estribo' }, { a: 24.5, b: 25.5, tipo: 'pilar' }, { a: 49.5, b: 50.5, tipo: 'estribo' }], r = OPC.atributosNube(Oa, c.attr, 0, -8, sup);
    const an = r && r.anomalias.find(x => x.zona === 'calzada' && x.signo === 'menor' && x.a >= 29 && x.b <= 34);
    ok('Atributos: PLY con color e intensidad; mancha de 3 m en la calzada y arbusto verde detectados', c.attr && 'intensidad' in c.attr && 'verde' in c.attr && an && r.vegetacion.por.color >= 2500 && r.vegetacion.por.color <= 3200, r ? `atributos ${Object.keys(c.attr).join(',')} · anomalía ${an ? an.a + '–' + an.b + ' m' : 'no'} · vegetación ${r.vegetacion.puntos}` : 'sin análisis'); })());
  // Comparación entre fechas: la segunda nube tiene la calzada 15 cm más baja al centro (flecha senoidal) y un objeto nuevo de 3 × 2 m bajo el tablero;
  // en el mismo sistema de coordenadas, el perfil de la calzada debe mostrar la flecha y el objeto debe salir como «nuevo»
  { let a0 = 7; const rnd = () => { a0 = (a0 * 1103515245 + 12345) % 2147483648; return a0 / 2147483648; }, N = () => (rnd() + rnd() + rnd() - 1.5) * .02;
    const P = (sag, extra) => { const Q = []; for (let s0 = -10; s0 <= 60; s0 += .25) for (let t = -4; t <= 4; t += .25) { const ds = s0 >= 0 && s0 <= 50 ? -sag * Math.sin(Math.PI * s0 / 50) : 0; Q.push(s0 + N(), t + N(), ds + N()); if (s0 >= 0 && s0 <= 50) Q.push(s0 + N(), t + N(), -1.2 + ds + N()); Q.push(s0 + N(), t + N(), -8 + N()); }
      if (extra) for (let x = 40; x <= 43; x += .1) for (let y = -1; y <= 1; y += .1) Q.push(x, y, -6 + N()); return { xyz: Float32Array.from(Q), offset: [0, 0, 0], eje: 'x' }; };
    const OA = OPC.orient(P(0, false), 'z', 1), OB = OPC.orientarComo(P(.15, true), OA.tr), r = OPC.compararNubes(OA, OB, 0, -8, [], { georef: true });
    const mid = r.perfil.filter(p => p[0] > 18 && p[0] < 32 && p[0] !== 25).map(p => p[1]), mm = mid.reduce((x, y) => x + y, 0) / mid.length, nv = r.nuevo.find(g => g.a >= 39 && g.b <= 44);
    ok('Comparación entre fechas: flecha de 15 cm en la calzada y objeto nuevo detectados', Math.abs(mm + .15) < .03 && nv && Math.abs(nv.area - 6) < 4, `flecha media ${(100 * mm).toFixed(1)} cm · nuevo ${nv ? nv.a + '–' + nv.b + ' m, ' + nv.area + ' m²' : 'no'} · detección ±${(100 * r.lodMediano).toFixed(1)} cm`); }
  ok('Eje: planta cuadrada marcada como dudosa; tramo recortado queda en x', Oq.ejeRatio < 3 && Ox.snap === 0, `cociente ${Oq.ejeRatio.toFixed(2)} · recortado: eje ${Ox.snap === 0 ? 'x' : '?'}`); }

// 15. Campaña de registros: los modos que se repiten se separan del ruido que aparece y desaparece, y se estima el efecto de la temperatura
{ let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const W = Array.from({ length: 10 }, (_, i) => { const T = 2 + 1.5 * i; return { T, peaks: [4.6 - .01 * T, 7.2 - .015 * T, 10.6].map(f => ({ f: f + (rnd() - .5) * .01, zeta: .02 })).concat([{ f: 3 + 25 * rnd(), zeta: .01 }, { f: 3 + 25 * rnd(), zeta: .01 }]) }; });
  const R = OPC.peakCampaign(W, { minPres: .5 }), m = R.modes;
  ok('Campaña: tres modos persistentes y pendiente por temperatura', m.length === 3 && Math.abs(m[0].slope + .01) < .002 && Math.abs(m[1].slope + .015) < .002 && m[0].sdComp < m[0].sdRaw, m.map(c => `${c.f.toFixed(2)} Hz ${(1000 * c.slope).toFixed(1)} mHz/°C`).join(' · ')); }

// 16. Rasgos respecto a la línea base: una medición igual a la base no tiene cambio
{ const camp = { f0: [1, 2], sh0: [[1, 2, 3], [3, 2, 1]] }, base = { fm: { 0: 4.6, 1: 7.2 }, shapes: { 0: [.2, .5, .3], 1: [.4, -.1, .3] } }, x = OPC.modalMeasFeat(camp, { f: [0, 1], s: [0, 1], sens: [0, 1, 2] }, base.fm, base.shapes, base);
  ok('Línea base: medición idéntica → rasgos nulos', x.every(v => Math.abs(v) < 1e-12), x.length + ' rasgos'); }

// 18. Geometría no vista en la nube: misma regla para cualquier puente; más incertidumbre donde la nube no registró
{ const A = arches.map((a, i) => Object.assign({}, a, { obs: (k => { const c = MCD.completitud.find(r => r.arch === k), g = MCD.geometria[k]; return { rise: g.flecha, rms: g.rms_cm / 100, clave: c.C_crown, arranque: c.C_springing }; })(['izq', 'centro', 'der'][i]) }));
  const G = Object.assign({}, GB, { arches: A }), S = OPC.geomSigmas('arco', G, 1), r = OPC.mulberry(3); let okPos = true, below = true;
  for (let n = 0; n < 50; n++) { const pg = OPC.perturbGeom('arco', G, r, 2); pg.G.arches.forEach((a, i) => { if (a.a !== A[i].a || a.b !== A[i].b) okPos = false; const yv = -a.coef[1] / (2 * a.coef[0]); if (a.coef[0] >= 0) below = false; const zc = a.coef[0] * yv * yv + a.coef[1] * yv + a.coef[2]; if (zc > G.deckAxis - .3 + 1e-9) below = false; }); }
  const SV = OPC.geomSigmas('viga', { supports: [{ a: 0, b: 0 }, { a: 20, b: 20 }, { a: 45, b: 45 }], cover: [.9, .3] }, 1);
  ok('Geometría no vista: σ mayor donde la nube no registró (arco central del Balta, vano poco cubierto)', S.arches[1].rise > 5 * S.arches[0].rise && SV.spans[1] > SV.spans[0] && OPC.perturbGeom('arco', G, r, 0).G === G && okPos && below,
    `σ flecha ${S.arches.map(s => (100 * s.rise).toFixed(0) + ' cm').join(' / ')} · σ rigidez viga ${SV.spans.map(v => (100 * v).toFixed(1) + ' %').join(' / ')}`); }

// 19. IA con la geometría no vista frente a la IA con geometría nominal, en vigas cuya geometría real difiere del modelo
{ const G = { supports: [{ a: 0, b: 0 }, { a: 19.5, b: 20.5 }, { a: 44.5, b: 45.5 }, { a: 65, b: 65 }], deckAxis: 6, cover: [.9, .3, .8] }, P = { E: 200, rho: 7.85, deck_A: .6, deck_I: .35, w_deck: 80 };
  const fr0 = OPC.build('viga', G, P), m0 = OPC.modal(fr0, 8), sens = OPC.sensorsOf(fr0), Z = fr0.zoneDefs.length, r = OPC.mulberry(4242), gs = () => OPC.gaussR(r);
  const mac = (u, v) => { let a = 0, b = 0, c = 0; for (let i = 0; i < u.length; i++) { a += u[i] * v[i]; b += u[i] * u[i]; c += v[i] * v[i]; } return a * a / (b * c || 1); };
  const sel = { f: [0, 1, 2, 3, 4, 5], s: [0, 1, 2, 3, 4, 5], sens: sens.map((_, i) => i) }, cases = [];
  for (let rep = 0; rep < 10; rep++) { const pg = OPC.perturbGeom('viga', G, r, 1), fr = OPC.build('viga', pg.G, Object.assign({}, P, { E: P.E * .96 })), e0 = new Float64Array(fr.el.length).map(() => Math.exp(gs() * .08));
    fr.zoneOf.forEach((q, t) => { if (q >= 0) e0[t] *= pg.fac[Math.floor(q / 3)]; });
    for (let z = -1; z < Z; z++) { const esc = e0.slice(), sev = z < 0 ? 0 : .2 + .3 * r(); if (z >= 0) fr.zoneOf.forEach((q, t) => { if (q === z) esc[t] *= 1 - sev; }); const md = OPC.modal(fr, 8, esc, 1e-9), fm = {}, sh = {};
      sel.f.forEach(j => { const v0 = sens.map(s => m0.phi[j][s.dof]); let b = -1, k = j; md.phi.forEach((ph, i) => { const M = mac(sens.map(s => ph[s.dof]), v0) * (1 - Math.min(1, Math.abs(md.f[i] / m0.f[j] - 1) * 2)); if (M > b) { b = M; k = i; } }); fm[j] = md.f[k] * (1 + gs() * .005); sh[j] = sens.map(s => md.phi[k][s.dof] * (1 + gs() * .05)); });
      cases.push({ z, fm, sh }); } }
  const res = [0, 1].map(geom => { const camp = OPC.freqCampaign('viga', G, P, { nPerZone: 40, nUndamaged: 80, unc: .05, seed: 7, NM: 8, modelErr: .05, geom }), I = OPC.trainModalIA(camp, sel, .005, .05); let ok = 0, nd = 0, fa = 0, nh = 0;
    cases.forEach(c => { const d = OPC.freqPredict(I, Z, OPC.modalMeasFeat(camp, sel, c.fm, c.sh, null)); if (c.z < 0) { nh++; if (d.cls >= 0 && d.conclusive && !d.ood) fa++; } else { nd++; if (d.cls === c.z && !d.ood) ok++; } }); return { zona: ok / nd, fa, nh }; });
  ok('IA con geometría no vista: menos falsas alarmas y no peor localización que con geometría nominal', res[1].fa < res[0].fa && res[1].zona >= res[0].zona - .02,
    `nominal: zona ${(100 * res[0].zona).toFixed(0)} %, falsas alarmas ${res[0].fa}/${res[0].nh} · con geometría no vista: zona ${(100 * res[1].zona).toFixed(0)} %, falsas alarmas ${res[1].fa}/${res[1].nh}`); }

// 17. Solver 2D de la plataforma contra OpenSees: se verifica en el navegador (pestaña Validación) con los 450 casos de data/fem_525.csv
ok('Dataset OpenSees presente', fs.existsSync(path.join(P, 'data', 'fem_525.csv')));

Promise.all(PEND).catch(e => { console.log('FALLA  prueba asíncrona: ' + e.message); fails++; }).then(() => { console.log(fails ? `\n${fails} prueba(s) fallaron` : '\nTodas las pruebas pasaron'); process.exit(fails ? 1 : 0); });
