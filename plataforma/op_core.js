/* ============================================================
   Tu puente · núcleo de cálculo (sin interfaz)
   Lectura de nubes, ejes, apoyos, geometría, modelos, campaña de daño e IA.
   Se usa en la página y en el Web Worker (y en Node para verificar).
   ============================================================ */
"use strict";
const OPC = (() => {
const MAXP = 1500000;

/* ---------- utilidades numéricas ---------- */
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gaussR(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function quantile(arr, q) { if (!arr.length) return NaN; const a = Float64Array.from(arr).sort(); const p = (a.length - 1) * q, i = Math.floor(p), f = p - i; return i + 1 < a.length ? a[i] * (1 - f) + a[i + 1] * f : a[i]; }
function median(arr) { return quantile(arr, .5); }

/* ---------- lectura de nubes ---------- */
// blob: objeto con size y slice(a,b) → {arrayBuffer(), text()} (File/Blob en el navegador)
class Sampler {
  constructor(max, seed = 12345) { this.max = max; this.n = 0; this.buf = new Float64Array(3 * Math.min(max, 1 << 20)); this.r = mulberry(seed); this.off = null; }
  push(x, y, z) {
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
    if (!this.off) this.off = [x, y, z].map(v => Math.round(v));
    x -= this.off[0]; y -= this.off[1]; z -= this.off[2];
    let k;
    if (this.n < this.max) { k = this.n; if (3 * k + 3 > this.buf.length) { const b = new Float64Array(Math.min(3 * this.max, this.buf.length * 2)); b.set(this.buf); this.buf = b; } }
    else { k = Math.floor(this.r() * (this.n + 1)); if (k >= this.max) { this.n++; return; } }
    this.buf[3 * k] = x; this.buf[3 * k + 1] = y; this.buf[3 * k + 2] = z; this.n++;
  }
  result() { const m = Math.min(this.n, this.max); return { xyz: Float32Array.from(this.buf.subarray(0, 3 * m)), total: this.n, kept: m, offset: this.off || [0, 0, 0] }; }
}
async function readText(blob, onLine, prog) {
  const CH = 16 << 20; let rest = '';
  for (let pos = 0; pos < blob.size; pos += CH) {
    const t = rest + await blob.slice(pos, Math.min(blob.size, pos + CH)).text();
    const lines = t.split(/\r?\n/); rest = lines.pop();
    for (const l of lines) onLine(l);
    if (prog) await prog(Math.min(1, (pos + CH) / blob.size));
  }
  if (rest) onLine(rest);
}
function numbers3(l) {
  const m = l.trim().split(/[\s,;]+/); if (m.length < 3) return null;
  const x = +m[0], y = +m[1], z = +m[2]; return (isFinite(x) && isFinite(y) && isFinite(z)) ? [x, y, z] : null;
}
async function parseCloud(blob, name, prog, max = MAXP) {
  const ext = (name.split('.').pop() || '').toLowerCase(), S = new Sampler(max);
  if (ext === 'ply') {
    const head = new TextDecoder('latin1').decode(await blob.slice(0, Math.min(blob.size, 65536)).arrayBuffer());
    const he = head.indexOf('end_header'); if (he < 0) throw new Error('El archivo PLY no tiene cabecera válida.');
    const hdr = head.slice(0, he), dataStart = he + 'end_header'.length + (head[he + 10] === '\r' ? 2 : 1);
    const fmt = (hdr.match(/format\s+(\S+)/) || [])[1];
    let inV = false, nV = 0; const props = [];
    for (const l of hdr.split(/\r?\n/)) {
      const w = l.trim().split(/\s+/);
      if (w[0] === 'element') { inV = w[1] === 'vertex'; if (inV) nV = +w[2]; }
      else if (w[0] === 'property' && inV) { if (w[1] === 'list') throw new Error('Propiedades de lista en vértices no soportadas.'); props.push({ t: w[1], n: w[2] }); }
    }
    const ix = ['x', 'y', 'z'].map(k => props.findIndex(p => p.n === k)); if (ix.some(i => i < 0)) throw new Error('El PLY no tiene coordenadas x, y, z.');
    if (fmt === 'ascii') {
      let row = 0; await readText(blob.slice(dataStart, blob.size), l => { if (row >= nV) return; const m = l.trim().split(/\s+/); if (m.length < props.length) return; row++; S.push(+m[ix[0]], +m[ix[1]], +m[ix[2]]); }, prog);
    } else if (fmt === 'binary_little_endian' || fmt === 'binary_big_endian') {
      const le = fmt === 'binary_little_endian', SZ = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2, int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
      let off = 0; const offs = props.map(p => { const o = off; off += SZ[p.t]; return o; }), stride = off;
      const rd = ix.map(i => (props[i].t === 'double' || props[i].t === 'float64') ? 'getFloat64' : 'getFloat32');
      const per = Math.floor((32 << 20) / stride);
      for (let i0 = 0; i0 < nV; i0 += per) {
        const n = Math.min(per, nV - i0), dv = new DataView(await blob.slice(dataStart + i0 * stride, dataStart + (i0 + n) * stride).arrayBuffer());
        for (let i = 0; i < n; i++) { const b = i * stride; S.push(dv[rd[0]](b + offs[ix[0]], le), dv[rd[1]](b + offs[ix[1]], le), dv[rd[2]](b + offs[ix[2]], le)); }
        if (prog) await prog((i0 + n) / nV);
      }
    } else throw new Error('Formato PLY no reconocido: ' + fmt);
  } else if (ext === 'las') {
    const h = new DataView(await blob.slice(0, 375).arrayBuffer());
    if (String.fromCharCode(h.getUint8(0), h.getUint8(1), h.getUint8(2), h.getUint8(3)) !== 'LASF') throw new Error('El archivo no es LAS.');
    const vmin = h.getUint8(25), offP = h.getUint32(96, true), recLen = h.getUint16(105, true);
    let nP = h.getUint32(107, true); if (vmin >= 4 && !nP) nP = Number(h.getBigUint64(247, true));
    const sc = [131, 139, 147].map(o => h.getFloat64(o, true)), of = [155, 163, 171].map(o => h.getFloat64(o, true));
    const per = Math.floor((32 << 20) / recLen);
    for (let i0 = 0; i0 < nP; i0 += per) {
      const n = Math.min(per, nP - i0), dv = new DataView(await blob.slice(offP + i0 * recLen, offP + (i0 + n) * recLen).arrayBuffer());
      for (let i = 0; i < n; i++) { const b = i * recLen; S.push(dv.getInt32(b, true) * sc[0] + of[0], dv.getInt32(b + 4, true) * sc[1] + of[1], dv.getInt32(b + 8, true) * sc[2] + of[2]); }
      if (prog) await prog((i0 + n) / nP);
    }
  } else if (['xyz', 'txt', 'csv', 'pts', 'asc'].includes(ext)) {
    await readText(blob, l => { const v = numbers3(l); if (v) S.push(v[0], v[1], v[2]); }, prog);
  } else if (ext === 'e57' || ext === 'laz') {
    throw new Error(`Los archivos .${ext} no se pueden leer en el navegador. Conviértalo a PLY binario o XYZ en CloudCompare (guía en esta misma pestaña).`);
  } else throw new Error('Formato no reconocido. Use PLY, LAS, XYZ, TXT o CSV.');
  const r = S.result(); if (r.kept < 1000) throw new Error('El archivo tiene muy pocos puntos válidos.'); return r;
}

/* ---------- ejes del puente ---------- */
// up: 'z' o 'y'. Devuelve s (longitudinal), t (transversal), z (vertical) como Float32Array y la transformación.
function orient(cloud, up = 'z', scale = 1) {
  const P = cloud.xyz, n = P.length / 3, iu = up === 'y' ? 1 : 2, ih = up === 'y' ? [0, 2] : [0, 1];
  let mx = 0, my = 0; const step = Math.max(1, Math.floor(n / 200000)); let c = 0;
  for (let i = 0; i < n; i += step) { mx += P[3 * i + ih[0]]; my += P[3 * i + ih[1]]; c++; } mx /= c; my /= c;
  let sxx = 0, syy = 0, sxy = 0; for (let i = 0; i < n; i += step) { const a = P[3 * i + ih[0]] - mx, b = P[3 * i + ih[1]] - my; sxx += a * a; syy += b * b; sxy += a * b; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); let u = [Math.cos(th), Math.sin(th)];
  // si el eje principal está a menos de 2° de un eje de coordenadas, se usa ese eje sin girar ni mover el origen
  let snap = null; const deg = Math.abs(Math.atan2(u[1], u[0]) * 180 / Math.PI) % 180;
  if (deg < 2 || deg > 178) snap = 0; else if (Math.abs(deg - 90) < 2) snap = 1;
  const s = new Float32Array(n), t = new Float32Array(n), z = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = P[3 * i + ih[0]], b = P[3 * i + ih[1]];
    if (snap === 0) { s[i] = (a + cloud.offset[ih[0]]) * scale; t[i] = (b + cloud.offset[ih[1]]) * scale; }
    else if (snap === 1) { s[i] = (b + cloud.offset[ih[1]]) * scale; t[i] = (a + cloud.offset[ih[0]]) * scale; }
    else { const da = a - mx, db = b - my; s[i] = (da * u[0] + db * u[1]) * scale; t[i] = (-da * u[1] + db * u[0]) * scale; }
    z[i] = (P[3 * i + iu] + cloud.offset[iu]) * scale;
  }
  if (snap == null) { let m = Infinity; for (let i = 0; i < n; i++) m = Math.min(m, s[i]); for (let i = 0; i < n; i++) s[i] -= m; }
  return { s, t, z, n, snap, angleDeg: th * 180 / Math.PI };
}
function bounds(a) { let lo = Infinity, hi = -Infinity; for (let i = 0; i < a.length; i++) { const v = a[i]; if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; }

/* ---------- tablero y apoyos ---------- */
// superficie del tablero: la franja horizontal más poblada en la mitad superior de la nube
function deckLevel(O) {
  const [zl, zh] = bounds(O.z), bw = 0.05, nb = Math.ceil((zh - zl) / bw) + 1, h = new Uint32Array(nb);
  for (let i = 0; i < O.n; i++) h[Math.floor((O.z[i] - zl) / bw)]++;
  const zmid = quantile(Array.from(O.z.filter((_, i) => i % 7 === 0)), .5); let best = -1, bi = 0;
  for (let k = 0; k < nb; k++) { const zc = zl + (k + .5) * bw; if (zc < zmid) continue; const v = h[k] + (h[k - 1] || 0) + (h[k + 1] || 0); if (v > best) { best = v; bi = k; } }
  return zl + (bi + .5) * bw;
}
function groundLevel(O) { const a = []; for (let i = 0; i < O.n; i += 3) a.push(O.z[i]); return quantile(a, .001); }
// apoyos: caras de pilares y estribos = bandas densas de puntos en una franja horizontal bajo los arranques (como pier_faces en geom.py)
function detectSupports(O, deckTop, ground, frac = 0.62, tol = 0.25) {
  const zc = deckTop - frac * (deckTop - ground), [sl, sh] = bounds(O.s), bw = 0.1, nb = Math.ceil((sh - sl) / bw) + 1, h = new Float64Array(nb);
  for (let i = 0; i < O.n; i++) if (Math.abs(O.z[i] - zc) < tol) h[Math.floor((O.s[i] - sl) / bw)]++;
  const sm = h.map((_, k) => (h[k - 1] || 0) * .25 + h[k] * .5 + (h[k + 1] || 0) * .25), nz = Array.from(sm).filter(v => v > 0);
  const thr = Math.max(2, 0.2 * quantile(nz, .98));
  const runs = []; let a = -1;
  for (let k = 0; k <= nb; k++) { const on = k < nb && sm[k] >= thr; if (on && a < 0) a = k; if (!on && a >= 0) { let m = a; for (let j = a; j < k; j++) if (sm[j] > sm[m]) m = j; let tot = 0; for (let j = a; j < k; j++) tot += h[j]; runs.push({ a: sl + a * bw, b: sl + k * bw, peak: sl + (m + .5) * bw, tot }); a = -1; } }
  const big = runs.filter(r => r.tot >= 0.1 * Math.max(...runs.map(q => q.tot)));
  // caras a menos de 4,5 m forman un mismo pilar; la cara exterior de cada grupo es el pico de densidad
  const groups = []; big.forEach(r => { const g = groups[groups.length - 1]; if (g && r.peak - g[g.length - 1].peak <= 4.5) g.push(r); else groups.push([r]); });
  const sup = groups.map(g => ({ a: g[0].peak, b: g[g.length - 1].peak }));
  // es estribo si no hay tablero más allá; si el tablero sigue, es un pilar y el vano extremo se completa por simetría
  const deckBeyond = (s0, dir) => { let c = 0; for (let i = 0; i < O.n; i++) if (Math.abs(O.z[i] - deckTop) < .3 && (dir < 0 ? O.s[i] < s0 - 5 : O.s[i] > s0 + 5)) c++; return c > 200; };
  // un grupo de una sola cara en un extremo es un estribo (se ve solo la cara hacia el vano); también si no hay tablero más allá
  sup.forEach((p, i) => { p.tipo = 'pilar'; const single = groups[i].length === 1, end = i === 0 ? -1 : i === sup.length - 1 ? 1 : 0;
    if (end && (single || !deckBeyond(end < 0 ? p.a : p.b, end))) p.tipo = 'estribo'; });
  return { supports: sup, zSlab: zc, faces: big.map(r => r.peak) };
}
function spansOf(sup) { const sp = []; for (let k = 0; k < sup.length - 1; k++) sp.push({ a: sup[k].b, b: sup[k + 1].a, k }); return sp; }

/* ---------- geometría de arcos (réplica de geom.py) ---------- */
function envelope(O, y0, y1, zmin, zmax, minPts = 15, dy = 0.25, q = 0.03) {
  const nb = Math.max(1, Math.round((y1 - y0) / dy)), B = Array.from({ length: nb }, () => []);
  for (let i = 0; i < O.n; i++) { const s = O.s[i], z = O.z[i]; if (s < y0 || s >= y0 + nb * dy || z <= zmin || z >= zmax) continue; B[Math.floor((s - y0) / dy)].push(z); }
  const yc = [], zc = [], cnt = [];
  B.forEach((b, k) => { if (b.length >= minPts) { b.sort((u, v) => u - v); const p = (b.length - 1) * q, i = Math.floor(p), f = p - i; yc.push(y0 + (k + .5) * dy); zc.push(i + 1 < b.length ? b[i] * (1 - f) + b[i + 1] * f : b[i]); cnt.push(b.length); } });
  return { yc, zc, cnt };
}
function lstsq3(y, z, w) { // z = a y² + b y + c, ecuaciones normales con centrado para estabilidad
  let m = 0, n = 0; for (let i = 0; i < y.length; i++) if (w[i]) { m += y[i]; n++; } m /= n;
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
  for (let i = 0; i < y.length; i++) if (w[i]) { const u = y[i] - m, v = [u * u, u, 1]; for (let a = 0; a < 3; a++) { r[a] += v[a] * z[i]; for (let b = 0; b < 3; b++) S[a][b] += v[a] * v[b]; } }
  const det = M => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const D = det(S); const sol = [0, 1, 2].map(k => det(S.map((row, i) => row.map((v, j) => j === k ? r[i] : v))) / D);
  const [A, Bc, Cc] = sol; return [A, Bc - 2 * A * m, A * m * m - Bc * m + Cc]; // vuelve a coordenada y
}
const polyval = (c, y) => c[0] * y * y + c[1] * y + c[2];
function fitParabola(y, z, iters = 5, k = 2.5) {
  let w = y.map(() => true), coef = null;
  for (let it = 0; it < iters; it++) {
    if (w.filter(Boolean).length < 4) break;
    coef = lstsq3(y, z, w); const r = z.map((v, i) => v - polyval(coef, y[i])), rw = r.filter((_, i) => w[i]);
    const md = median(rw), mad = median(rw.map(v => Math.abs(v - md))), s = 1.4826 * mad;
    w = r.map(v => Math.abs(v) < k * Math.max(s, 0.02));
  }
  return { coef, inliers: w };
}
function archGeometry(O, span, zmin, zmax, minPts) {
  const E = envelope(O, span.a + 0.2, span.b - 0.2, zmin, zmax, minPts);
  if (E.yc.length < 8) return { ok: false, E, msg: 'Pocos puntos del intradós en este vano.' };
  const F = fitParabola(E.yc, E.zc); if (!F.coef || F.coef[0] >= 0) return { ok: false, E, msg: 'El ajuste no da un arco (curvatura hacia arriba).' };
  const c = F.coef, yv = -c[1] / (2 * c[0]), L = span.b - span.a, zs = Math.min(polyval(c, span.a), polyval(c, span.b));
  // completitud por zonas (Ec. 7): intervalos de 0,25 m entre caras; observado si hay envolvente a < 0,15 m de la parábola
  const nb = Math.round(L / 0.25), obs = new Uint8Array(nb);
  E.yc.forEach((y, i) => { const k = Math.floor((y - span.a) / 0.25); if (k >= 0 && k < nb && Math.abs(E.zc[i] - polyval(c, y)) < 0.15) obs[k] = 1; });
  const zone = r => r < .15 || r > .85 ? 'arranque' : (r < .35 || r > .65) ? 'riñón' : 'clave', Cz = { arranque: [0, 0], 'riñón': [0, 0], clave: [0, 0] };
  for (let k = 0; k < nb; k++) { const z = zone((k + .5) / nb); Cz[z][0] += obs[k]; Cz[z][1]++; }
  const rms = Math.sqrt(median(E.zc.map((v, i) => (v - polyval(c, E.yc[i])) ** 2).filter((_, i) => F.inliers[i])));
  return { ok: true, E, coef: c, inliers: F.inliers, vertexY: yv, rise: polyval(c, yv) - zs, L, rms, obs: Array.from(obs),
    completeness: { total: obs.reduce((a, b) => a + b, 0) / nb, arranque: Cz.arranque[0] / Cz.arranque[1], 'riñón': Cz['riñón'][0] / Cz['riñón'][1], clave: Cz.clave[0] / Cz.clave[1] } };
}
// arcos de todos los vanos. Los vanos extremos sin estribo detectado se cierran por simetría respecto de la clave ajustada.
function archAll(O, supports, zmin, zmax, minPts, ends = { left: 'simetria', right: 'simetria' }) {
  const sup = supports.slice().sort((p, q) => p.a - q.a), out = [];
  const inner = []; for (let k = 0; k < sup.length - 1; k++) inner.push({ a: sup[k].b, b: sup[k + 1].a, k });
  const Lref = inner.length ? median(inner.map(s => s.b - s.a)) : 25;
  if (ends.left === 'simetria' && sup.length) out.push({ a: sup[0].a - 1.15 * Lref, b: sup[0].a, side: 'left' });
  inner.forEach(s => out.push({ a: s.a, b: s.b }));
  if (ends.right === 'simetria' && sup.length) out.push({ a: sup[sup.length - 1].b, b: sup[sup.length - 1].b + 1.15 * Lref, side: 'right' });
  return out.map(sp => {
    let g = archGeometry(O, sp, zmin, zmax, minPts);
    if (sp.side && g.ok) { const yv = g.vertexY, span = sp.side === 'left' ? { a: 2 * yv - sp.b, b: sp.b } : { a: sp.a, b: 2 * yv - sp.a }; g = archGeometry(O, span, zmin, zmax, minPts); g.symmetric = sp.side; g.a = span.a; g.b = span.b; }
    else { g.a = sp.a; g.b = sp.b; }
    return g;
  });
}
// cobertura genérica bajo el tablero (vigas y armaduras): fracción de intervalos con puntos entre zmin y zmax
function spanCoverage(O, span, zmin, zmax, minPts) {
  const nb = Math.max(1, Math.round((span.b - span.a) / 0.25)), c = new Uint32Array(nb);
  for (let i = 0; i < O.n; i++) { const s = O.s[i], z = O.z[i]; if (s < span.a || s >= span.b || z <= zmin || z >= zmax) continue; c[Math.min(nb - 1, Math.floor((s - span.a) / 0.25))]++; }
  let o = 0; for (let k = 0; k < nb; k++) if (c[k] >= minPts) o++; return o / nb;
}

/* ---------- materiales de referencia (supuestos editables) ---------- */
const MATERIALS = {
  fierro: { label: 'Fierro fundido', E: 100, rho: 7.2 }, acero: { label: 'Acero', E: 200, rho: 7.85 },
  concreto: { label: 'Concreto', E: 30, rho: 2.4 }, mamposteria: { label: 'Mampostería', E: 5, rho: 2.2 }, madera: { label: 'Madera', E: 11, rho: 0.6 } };

/* ---------- constructores de pórtico 2D (kN, m, s, t) ---------- */
// salida compatible con mcModal: {nodes,el,E,A,I,grp,mass,fx, deckNodes:[{s,node}], spans, zoneOf}
function finish(nodes, el, E, A, I, grp, extraMass, fx, p) { // el peso del tablero va completo en w_deck; se suma el peso propio de los demás miembros
  const m = new Float64Array(nodes.length);
  extraMass.forEach(([i, v]) => m[i] += v);
  el.forEach(([i, j], t) => { const L = Math.hypot(nodes[j][0] - nodes[i][0], nodes[j][1] - nodes[i][1]); const rho = (grp[t].startsWith('pilar') || grp[t] === 'tablero') ? 0 : p.rho; m[i] += rho * A[t] * L / 2; m[j] += rho * A[t] * L / 2; });
  for (let i = 0; i < m.length; i++) m[i] = Math.max(m[i], 1e-3);
  return { nodes, el, E, A, I, grp, mass: m, fx };
}
function ribSection(h, n, b = .25, tf = .05, tw = .04) { const hw = h - 2 * tf, A = 2 * b * tf + hw * tw, I = 2 * (b * tf ** 3 / 12 + b * tf * ((h - tf) / 2) ** 2) + tw * hw ** 3 / 12; return [n * A, n * I]; }
function buildArch(G, p) { // G: {supports, arches:[{a,b,coef}], deckAxis, zBase:[...por pilar]}
  const NSEG = 24, nodes = [], el = [], E = [], A = [], I = [], grp = [], ext = [], add = (y, z) => (nodes.push([y, z]), nodes.length - 1);
  const ae = (i, j, e, a, ii, g) => { el.push([i, j]); E.push(e); A.push(a); I.push(ii); grp.push(g); };
  let [Ar, Ir] = ribSection(p.rib_h, p.n_ribs); Ir *= p.I_factor || 1;
  const Eci = p.E * 1e6, arches = [];
  G.arches.forEach((ar, k) => { const ys = [], zs = [], ids = []; for (let i = 0; i <= NSEG; i++) { const y = ar.a + (ar.b - ar.a) * i / NSEG; ys.push(y); zs.push(polyval(ar.coef, y) + p.rib_h / 2); ids.push(add(y, zs[i])); }
    for (let i = 0; i < NSEG; i++) ae(ids[i], ids[i + 1], Eci, Ar, Ir, 'arco_' + k); arches.push({ k, ids, ys, zs }); });
  const r4 = v => Math.round(v * 1e4) / 1e4, yset = new Set(); arches.forEach(a => a.ys.forEach(y => yset.add(r4(y))));
  const pc = []; for (let k = 1; k < G.supports.length - 1; k++) { const s = G.supports[k]; pc.push(r4((s.a + s.b) / 2)); yset.add(pc[pc.length - 1]); }
  const yd = [...yset].sort((a, b) => a - b), dN = {}; yd.forEach(y => dN[y] = add(y, G.deckAxis)); const dk = yd.map(y => dN[y]);
  for (let i = 0; i < dk.length - 1; i++) ae(dk[i], dk[i + 1], Eci, p.deck_A, p.deck_I, 'tablero');
  arches.forEach(a => { for (let i = 1; i < a.ids.length - 1; i++) ae(a.ids[i], dN[r4(a.ys[i])], Eci, p.post_A, p.post_I, 'montante_' + a.k); });
  const pA = p.pier_t * p.width, pI = p.width * p.pier_t ** 3 / 12, Ep = p.E_pier * 1e6, fixed = [];
  for (let k = 1; k < G.supports.length - 1; k++) {
    const nl = arches[k - 1].ids[NSEG], nr = arches[k].ids[0], [yl, zl] = nodes[nl], [yr, zr] = nodes[nr];
    const top = add((yl + yr) / 2, (zl + zr) / 2), base = add((yl + yr) / 2, G.zBase[k - 1]);
    ae(nl, top, Ep * 50, pA, pI, 'pilar_' + k); ae(top, nr, Ep * 50, pA, pI, 'pilar_' + k); ae(top, base, Ep, pA, pI, 'pilar_' + k);
    const ydn = yd.reduce((b, v) => Math.abs(v - (yl + yr) / 2) < Math.abs(b - (yl + yr) / 2) ? v : b, yd[0]); ae(top, dN[ydn], Ep, pA, pI, 'pilar_' + k); fixed.push(base);
  }
  const fx = new Uint8Array(3 * nodes.length), fixAll = i => { fx[3 * i] = fx[3 * i + 1] = fx[3 * i + 2] = 1; };
  fixed.forEach(fixAll); const ends = [arches[0].ids[0], arches[arches.length - 1].ids[NSEG]];
  if (p.springing === 'pinned') ends.forEach(i => { fx[3 * i] = fx[3 * i + 1] = 1; }); else ends.forEach(fixAll);
  [dk[0], dk[dk.length - 1]].forEach(i => { fx[3 * i] = fx[3 * i + 1] = 1; });
  const lt = yd.map((y, i) => i === 0 ? (yd[1] - yd[0]) / 2 : i === yd.length - 1 ? (yd[i] - yd[i - 1]) / 2 : (yd[i + 1] - yd[i - 1]) / 2);
  yd.forEach((y, i) => ext.push([dN[y], p.w_deck / 9.81 * lt[i]]));
  const fr = finish(nodes, el, E, A, I, grp, ext, fx, { rho: p.rho });
  fr.deckNodes = yd.map(y => ({ s: y, node: dN[y] }));
  fr.spans = arches.map(a => ({ a: a.ys[0], b: a.ys[NSEG] }));
  fr.zoneDefs = []; arches.forEach(a => ['arranque izq', 'riñón izq', 'clave', 'riñón der', 'arranque der'].forEach(l => fr.zoneDefs.push(`Arco ${a.k + 1} · ${l}`))); fr.spans.forEach((_, k) => fr.zoneDefs.push(`Tablero vano ${k + 1}`));
  const mid = t => (nodes[el[t][0]][0] + nodes[el[t][1]][0]) / 2, na = arches.length;
  fr.zoneOf = el.map((_, t) => { const g = grp[t]; for (const a of arches) { const s0 = a.ys[0], s1 = a.ys[NSEG]; if (g === 'arco_' + a.k) return a.k * 5 + Math.min(Math.floor((mid(t) - s0) / (s1 - s0) * 5), 4); if (g === 'tablero' && s0 <= mid(t) && mid(t) <= s1) return 5 * na + a.k; } return -1; });
  return fr;
}
function buildGirder(G, p) { // vigas continuas sobre los apoyos
  const nodes = [], el = [], E = [], A = [], I = [], grp = [], ext = [], add = (y, z) => (nodes.push([y, z]), nodes.length - 1), ae = (i, j, e, a, ii, g) => { el.push([i, j]); E.push(e); A.push(a); I.push(ii); grp.push(g); };
  const cs = G.supports.map(s => (s.a + s.b) / 2), ys = []; for (let k = 0; k < cs.length - 1; k++) for (let i = 0; i < 16; i++) ys.push(cs[k] + (cs[k + 1] - cs[k]) * i / 16); ys.push(cs[cs.length - 1]);
  const ids = ys.map(y => add(y, G.deckAxis)); const Ed = p.E * 1e6;
  for (let i = 0; i < ids.length - 1; i++) ae(ids[i], ids[i + 1], Ed, p.deck_A, p.deck_I, 'tablero');
  const fx = new Uint8Array(3 * nodes.length); cs.forEach((c, k) => { const i = ids[k * 16]; fx[3 * i + 1] = 1; if (k === 0) fx[3 * i] = 1; });
  ys.forEach((y, i) => { const l = i === 0 ? (ys[1] - ys[0]) / 2 : i === ys.length - 1 ? (ys[i] - ys[i - 1]) / 2 : (ys[i + 1] - ys[i - 1]) / 2; ext.push([ids[i], p.w_deck / 9.81 * l]); });
  const fr = finish(nodes, el, E, A, I, grp, ext, fx, { rho: p.rho });
  fr.deckNodes = ys.map((y, i) => ({ s: y, node: ids[i] })); fr.spans = cs.slice(0, -1).map((c, k) => ({ a: c, b: cs[k + 1] }));
  fr.zoneDefs = []; fr.spans.forEach((_, k) => ['tercio izq', 'centro', 'tercio der'].forEach(l => fr.zoneDefs.push(`Vano ${k + 1} · ${l}`)));
  fr.zoneOf = el.map(([i, j]) => { const m = (nodes[i][0] + nodes[j][0]) / 2; for (let k = 0; k < fr.spans.length; k++) { const S = fr.spans[k]; if (m >= S.a && m <= S.b) return 3 * k + Math.min(2, Math.floor((m - S.a) / (S.b - S.a) * 3)); } return -1; });
  return fr;
}
function buildTruss(G, p) { // armadura Pratt de tablero inferior, vanos simplemente apoyados
  const nodes = [], el = [], E = [], A = [], I = [], grp = [], ext = [], add = (y, z) => (nodes.push([y, z]), nodes.length - 1), ae = (i, j, e, a, ii, g) => { el.push([i, j]); E.push(e); A.push(a); I.push(ii); grp.push(g); };
  const cs = G.supports.map(s => (s.a + s.b) / 2), Es = p.E * 1e6, fx0 = [], deck = [], np = Math.max(4, Math.round(p.panels / 2) * 2);
  const spans = [];
  for (let k = 0; k < cs.length - 1; k++) {
    const a = cs[k], b = cs[k + 1], bot = [], top = []; spans.push({ a, b });
    for (let i = 0; i <= np; i++) { const y = a + (b - a) * i / np; bot.push(add(y, G.deckAxis)); top.push(i === 0 || i === np ? null : add(y, G.deckAxis + p.truss_h)); }
    for (let i = 0; i < np; i++) ae(bot[i], bot[i + 1], Es, p.chord_A, p.chord_I, 'cordon_inf');
    for (let i = 1; i < np - 1; i++) ae(top[i], top[i + 1], Es, p.chord_A, p.chord_I, 'cordon_sup');
    ae(bot[0], top[1], Es, p.chord_A, p.chord_I, 'cordon_sup'); ae(top[np - 1], bot[np], Es, p.chord_A, p.chord_I, 'cordon_sup');
    for (let i = 1; i < np; i++) ae(bot[i], top[i], Es, p.web_A, p.web_I, 'montante');
    for (let i = 1; i < np - 1; i++) { if (i < np / 2) ae(top[i], bot[i + 1], Es, p.web_A, p.web_I, 'diagonal'); else ae(bot[i], top[i + 1], Es, p.web_A, p.web_I, 'diagonal'); }
    fx0.push([bot[0], 'pin'], [bot[np], 'roller']); bot.forEach((n, i) => deck.push({ s: a + (b - a) * i / np, node: n, l: (b - a) / np * (i === 0 || i === np ? .5 : 1) }));
  }
  const fx = new Uint8Array(3 * nodes.length); fx0.forEach(([i, t]) => { fx[3 * i + 1] = 1; if (t === 'pin') fx[3 * i] = 1; });
  deck.forEach(d => ext.push([d.node, p.w_deck / 9.81 * d.l]));
  const fr = finish(nodes, el, E, A, I, grp, ext, fx, { rho: p.rho });
  fr.deckNodes = deck.map(d => ({ s: d.s, node: d.node })); fr.spans = spans;
  fr.zoneDefs = []; spans.forEach((_, k) => ['tercio izq', 'centro', 'tercio der'].forEach(l => fr.zoneDefs.push(`Vano ${k + 1} · ${l}`)));
  fr.zoneOf = el.map(([i, j]) => { const m = (nodes[i][0] + nodes[j][0]) / 2; for (let k = 0; k < spans.length; k++) { const S = spans[k]; if (m >= S.a - 1e-6 && m <= S.b + 1e-6) return 3 * k + Math.min(2, Math.max(0, Math.floor((m - S.a) / (S.b - S.a) * 3))); } return -1; });
  return fr;
}
function build(type, G, p) { return type === 'arco' ? buildArch(G, p) : type === 'viga' ? buildGirder(G, p) : buildTruss(G, p); }
function sensorsOf(fr) { const out = []; fr.spans.forEach(S => [.25, .5, .75].forEach(r => { const y = S.a + r * (S.b - S.a); const d = fr.deckNodes.reduce((b, v) => Math.abs(v.s - y) < Math.abs(b.s - y) ? v : b, fr.deckNodes[0]); out.push({ s: y, node: d.node, dof: 3 * d.node + 1 }); })); return out; }

/* ---------- análisis modal (iteración en subespacio, problema generalizado) ---------- */
function Kmat(fr, esc) {
  const N = fr.nodes.length, nd = 3 * N, K = new Float64Array(nd * nd);
  fr.el.forEach(([i1, i2], j) => {
    const dx = fr.nodes[i2][0] - fr.nodes[i1][0], dz = fr.nodes[i2][1] - fr.nodes[i1][1], L = Math.hypot(dx, dz), c = dx / L, s = dz / L;
    const Ej = fr.E[j] * (esc ? esc[j] : 1), EA = Ej * fr.A[j] / L, EI = Ej * fr.I[j];
    const k = [[EA, 0, 0, -EA, 0, 0], [0, 12 * EI / L ** 3, 6 * EI / L ** 2, 0, -12 * EI / L ** 3, 6 * EI / L ** 2], [0, 6 * EI / L ** 2, 4 * EI / L, 0, -6 * EI / L ** 2, 2 * EI / L], [-EA, 0, 0, EA, 0, 0], [0, -12 * EI / L ** 3, -6 * EI / L ** 2, 0, 12 * EI / L ** 3, -6 * EI / L ** 2], [0, 6 * EI / L ** 2, 2 * EI / L, 0, -6 * EI / L ** 2, 4 * EI / L]];
    const T = [[c, s, 0, 0, 0, 0], [-s, c, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0], [0, 0, 0, c, s, 0], [0, 0, 0, -s, c, 0], [0, 0, 0, 0, 0, 1]], d = [3 * i1, 3 * i1 + 1, 3 * i1 + 2, 3 * i2, 3 * i2 + 1, 3 * i2 + 2];
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) { let v = 0; for (let u = 0; u < 6; u++) { if (!T[u][a]) continue; for (let w = 0; w < 6; w++) if (T[w][b]) v += T[u][a] * k[u][w] * T[w][b]; } K[d[a] * nd + d[b]] += v; }
  });
  return K;
}
function jacobi(Ain, n) { const A = Float64Array.from(Ain), V = new Float64Array(n * n); for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sw = 0; sw < 60; sw++) { let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i * n + j] ** 2; if (off < 1e-22) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) { const apq = A[p * n + q]; if (Math.abs(apq) < 1e-300) continue; const th = (A[q * n + q] - A[p * n + p]) / (2 * apq), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const x = A[k * n + p], y = A[k * n + q]; A[k * n + p] = c * x - s * y; A[k * n + q] = s * x + c * y; }
      for (let k = 0; k < n; k++) { const x = A[p * n + k], y = A[q * n + k]; A[p * n + k] = c * x - s * y; A[q * n + k] = s * x + c * y; }
      for (let k = 0; k < n; k++) { const x = V[k * n + p], y = V[k * n + q]; V[k * n + p] = c * x - s * y; V[k * n + q] = s * x + c * y; } } }
  return { ev: Array.from({ length: n }, (_, i) => A[i * n + i]), V }; }
function modal(fr, nmodes = 8, esc = null, tol = 1e-12) {
  // matriz de rigidez en banda: los gdl libres se numeran por la coordenada longitudinal de su nodo
  const N = fr.nodes.length, nd = 3 * N, order = Array.from({ length: N }, (_, i) => i).sort((i, j) => fr.nodes[i][0] - fr.nodes[j][0] || fr.nodes[i][1] - fr.nodes[j][1]);
  const pos = new Int32Array(nd).fill(-1), free = []; order.forEach(i => { for (let d = 0; d < 3; d++) if (!fr.fx[3 * i + d]) { pos[3 * i + d] = free.length; free.push(3 * i + d); } });
  const nf = free.length; let hb = 0;
  fr.el.forEach(([i1, i2]) => { const d = [3 * i1, 3 * i1 + 1, 3 * i1 + 2, 3 * i2, 3 * i2 + 1, 3 * i2 + 2].map(x => pos[x]).filter(x => x >= 0); for (const a of d) for (const b of d) hb = Math.max(hb, a - b); });
  const W = hb + 1, L = new Float64Array(nf * W); // L[i*W + (i-j)] = K(i,j), j ≤ i
  fr.el.forEach(([i1, i2], j) => {
    const dx = fr.nodes[i2][0] - fr.nodes[i1][0], dz = fr.nodes[i2][1] - fr.nodes[i1][1], Le = Math.hypot(dx, dz), c = dx / Le, s = dz / Le;
    const Ej = fr.E[j] * (esc ? esc[j] : 1), EA = Ej * fr.A[j] / Le, EI = Ej * fr.I[j];
    const k = [[EA, 0, 0, -EA, 0, 0], [0, 12 * EI / Le ** 3, 6 * EI / Le ** 2, 0, -12 * EI / Le ** 3, 6 * EI / Le ** 2], [0, 6 * EI / Le ** 2, 4 * EI / Le, 0, -6 * EI / Le ** 2, 2 * EI / Le], [-EA, 0, 0, EA, 0, 0], [0, -12 * EI / Le ** 3, -6 * EI / Le ** 2, 0, 12 * EI / Le ** 3, -6 * EI / Le ** 2], [0, 6 * EI / Le ** 2, 2 * EI / Le, 0, -6 * EI / Le ** 2, 4 * EI / Le]];
    const T = [[c, s, 0, 0, 0, 0], [-s, c, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0], [0, 0, 0, c, s, 0], [0, 0, 0, -s, c, 0], [0, 0, 0, 0, 0, 1]], dd = [3 * i1, 3 * i1 + 1, 3 * i1 + 2, 3 * i2, 3 * i2 + 1, 3 * i2 + 2];
    for (let a = 0; a < 6; a++) { const pa = pos[dd[a]]; if (pa < 0) continue; for (let b = 0; b < 6; b++) { const pb = pos[dd[b]]; if (pb < 0 || pb > pa) continue; let v = 0; for (let u = 0; u < 6; u++) { if (!T[u][a]) continue; for (let w = 0; w < 6; w++) if (T[w][b]) v += T[u][a] * k[u][w] * T[w][b]; } L[pa * W + (pa - pb)] += v; } }
  });
  const Md = new Float64Array(nd); for (let i = 0; i < N; i++) { Md[3 * i] = Md[3 * i + 1] = fr.mass[i]; Md[3 * i + 2] = fr.mass[i] * 1e-4; }
  const m = free.map(i => Md[i]);
  // Cholesky en banda
  for (let j = 0; j < nf; j++) {
    let s = L[j * W]; const k0 = Math.max(0, j - hb); for (let k = k0; k < j; k++) { const v = L[j * W + (j - k)]; s -= v * v; }
    if (s <= 0) throw new Error('El modelo es inestable: revise apoyos y conexiones.'); s = Math.sqrt(s); L[j * W] = s;
    const i1 = Math.min(nf - 1, j + hb);
    for (let i = j + 1; i <= i1; i++) { let t = L[i * W + (i - j)]; const kk = Math.max(0, i - hb); for (let k = kk; k < j; k++) t -= L[i * W + (i - k)] * L[j * W + (j - k)]; L[i * W + (i - j)] = t / s; }
  }
  const solve = x => { const y = new Float64Array(nf); for (let i = 0; i < nf; i++) { let s = x[i]; for (let k = Math.max(0, i - hb); k < i; k++) s -= L[i * W + (i - k)] * y[k]; y[i] = s / L[i * W]; }
    const z = new Float64Array(nf); for (let i = nf - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k <= Math.min(nf - 1, i + hb); k++) s -= L[k * W + (k - i)] * z[k]; z[i] = s / L[i * W]; } return z; };
  const q = Math.min(nf, nmodes + 8), rnd = mulberry(12345); let X = []; for (let j = 0; j < q; j++) { const v = new Float64Array(nf); for (let i = 0; i < nf; i++) v[i] = (rnd() - .5) / Math.sqrt(m[i]); X.push(v); }
  let lam = null, prev = null;
  for (let it = 0; it < 300; it++) {
    const MX = X.map(v => v.map((x, i) => x * m[i])), Y = MX.map(solve), Kr = new Float64Array(q * q), Mr = new Float64Array(q * q);
    for (let a = 0; a < q; a++) for (let b = a; b < q; b++) { let s = 0, t = 0; for (let i = 0; i < nf; i++) { s += Y[a][i] * MX[b][i]; t += Y[a][i] * Y[b][i] * m[i]; } Kr[a * q + b] = Kr[b * q + a] = s; Mr[a * q + b] = Mr[b * q + a] = t; }
    const C = Float64Array.from(Mr); for (let j = 0; j < q; j++) { let s = C[j * q + j]; for (let k = 0; k < j; k++) s -= C[j * q + k] ** 2; s = Math.sqrt(s); C[j * q + j] = s; for (let i = j + 1; i < q; i++) { let t = C[i * q + j]; for (let k = 0; k < j; k++) t -= C[i * q + k] * C[j * q + k]; C[i * q + j] = t / s; } for (let i = 0; i < j; i++) C[i * q + j] = 0; }
    const Ci = new Float64Array(q * q); for (let c = 0; c < q; c++) for (let i = 0; i < q; i++) { let s = i === c ? 1 : 0; for (let k = 0; k < i; k++) s -= C[i * q + k] * Ci[k * q + c]; Ci[i * q + c] = s / C[i * q + i]; }
    const T = new Float64Array(q * q); for (let a = 0; a < q; a++) for (let b = 0; b < q; b++) { let s = 0; for (let k = 0; k < q; k++) for (let l = 0; l < q; l++) s += Ci[a * q + k] * Kr[k * q + l] * Ci[b * q + l]; T[a * q + b] = s; }
    for (let a = 0; a < q; a++) for (let b = a + 1; b < q; b++) { const v = .5 * (T[a * q + b] + T[b * q + a]); T[a * q + b] = T[b * q + a] = v; }
    const { ev, V } = jacobi(T, q), ord = ev.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    X = ord.map(([, c]) => { const z = new Float64Array(q); for (let k = 0; k < q; k++) { let s = 0; for (let l = 0; l < q; l++) s += Ci[l * q + k] * V[l * q + c]; z[k] = s; } const v = new Float64Array(nf); for (let k = 0; k < q; k++) if (z[k]) for (let i = 0; i < nf; i++) v[i] += z[k] * Y[k][i]; return v; });
    lam = ord.map(o => o[0]);
    if (prev) { let ok = true; for (let j = 0; j < nmodes; j++) if (Math.abs(lam[j] - prev[j]) > tol * lam[j]) ok = false; if (ok) break; } prev = lam.slice(); X.iters = it;
  }
  const f = lam.slice(0, nmodes).map(l => Math.sqrt(Math.max(l, 0)) / (2 * Math.PI)), phi = X.slice(0, nmodes).map(v => { const u = new Float64Array(nd); free.forEach((g, a) => u[g] = v[a]); return u; });
  let mt = 0; for (let i = 0; i < N; i++) mt += Md[3 * i];
  const part = phi.map(u => { let mm = 0; for (let i = 0; i < nd; i++) mm += u[i] * u[i] * Md[i]; const g = [0, 1].map(dd => { let s = 0; for (let i = 0; i < N; i++) s += u[3 * i + dd] * Md[3 * i + dd]; return s / mm; }); return { Y: g[0] ** 2 * mm / mt, Z: g[1] ** 2 * mm / mt }; });
  return { f, phi, part, totalMass: mt };
}
// rasgos medibles: Δf de NM modos emparejados por MAC y formas de 4 modos en los sensores (signo: componente máxima positiva)
function signConvention(phi, sdof) { return phi.map(u => { let mx = 0, s = 1; sdof.forEach(d => { if (Math.abs(u[d]) > mx) { mx = Math.abs(u[d]); s = Math.sign(u[d]) || 1; } }); return s < 0 ? u.map(v => -v) : u; }); }
function features(f, phi, f0, phi0, sdof, NM = 8, NS = 4) {
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }, df = [], sh = [];
  for (let i = 0; i < NM; i++) { let best = -1, j = 0; for (let k = 0; k < NM; k++) { const m = dot(phi0[i], phi[k]) ** 2 / (dot(phi0[i], phi0[i]) * dot(phi[k], phi[k])); if (m > best) { best = m; j = k; } }
    df.push((f[j] - f0[i]) / f0[i]);
    if (i < NS) { const v = sdof.map(d => phi[j][d]), v0 = sdof.map(d => phi0[i][d]), sg = Math.sign(dot(v, v0)) || 1, mx = Math.max(...v.map(Math.abs)) || 1; v.forEach(x => sh.push(x * sg / mx)); } }
  return df.concat(sh);
}

/* ---------- campaña de daño ---------- */
function campaign(type, G, p, opts, prog) {
  const r = mulberry(opts.seed || 7), NM = opts.NM || 8, fr0 = build(type, G, p), sens = sensorsOf(fr0), sdof = sens.map(s => s.dof);
  const b = modal(fr0, NM); const phi0 = signConvention(b.phi, sdof), f0 = b.f, Z = fr0.zoneDefs.length;
  const jobs = []; for (let i = 0; i < opts.nUndamaged; i++) jobs.push(-1); for (let z = 0; z < Z; z++) for (let i = 0; i < opts.nPerZone; i++) jobs.push(z);
  const rows = []; let t0 = Date.now();
  jobs.forEach((zz, n) => {
    const pp = Object.assign({}, p, { E: p.E * (1 + gaussR(r) * opts.unc / 2), w_deck: p.w_deck * (1 + gaussR(r) * opts.unc / 2) });
    const fr = build(type, G, pp), d = zz < 0 ? 0 : 0.05 + r() * 0.55, esc = new Float64Array(fr.el.length).fill(1);
    if (zz >= 0) fr.zoneOf.forEach((z, t) => { if (z === zz) esc[t] = 1 - d; });
    const m = modal(fr, NM, esc, 1e-9); rows.push({ zona: zz, sev: d, x: features(m.f, m.phi, f0, phi0, sdof, NM) });
    if (prog && n % 20 === 0) prog(n / jobs.length, (Date.now() - t0) / 1000);
  });
  // sensibilidad: cambio máximo de frecuencia con 20 % de pérdida de rigidez en cada zona (modelo nominal)
  const sens20 = []; for (let z = 0; z < Z; z++) { const esc = new Float64Array(fr0.el.length).fill(1); fr0.zoneOf.forEach((zz, t) => { if (zz === z) esc[t] = .8; }); const m = modal(fr0, NM, esc); sens20.push(Math.max(...m.f.map((v, i) => Math.abs(v / f0[i] - 1)))); }
  const spanOfZone = fr0.zoneDefs.map((_, z) => { const t = fr0.zoneOf.indexOf(z); if (t < 0) return -1; const [i, j] = fr0.el[t], m = (fr0.nodes[i][0] + fr0.nodes[j][0]) / 2; return fr0.spans.findIndex(S => m >= S.a - 1e-6 && m <= S.b + 1e-6); });
  return { rows, f0, phi0, zones: fr0.zoneDefs, sensors: sens, sens20, NM, spanOfZone };
}

/* ---------- Random Forest (CART) ---------- */
function buildTree(X, y, idx, opt, r, isClf, C) {
  const f = [], t = [], l = [], rr = [], v = [];
  const leafVal = ids => { if (isClf) { const c = new Array(C).fill(0); ids.forEach(i => c[y[i]]++); return c.map(k => k / ids.length); } let s = 0; ids.forEach(i => s += y[i]); return [s / ids.length]; };
  const imp = ids => { if (isClf) { const c = new Array(C).fill(0); ids.forEach(i => c[y[i]]++); let g = 1; c.forEach(k => g -= (k / ids.length) ** 2); return g; } let s = 0, s2 = 0; ids.forEach(i => { s += y[i]; s2 += y[i] * y[i]; }); return s2 / ids.length - (s / ids.length) ** 2; };
  const p = X[0].length, stack = [[idx, 0, -1, 0]];
  while (stack.length) {
    const [ids, depth, parent, side] = stack.pop(), node = f.length; f.push(-1); t.push(0); l.push(-1); rr.push(-1); v.push(null);
    if (parent >= 0) (side ? rr : l)[parent] = node;
    const im = imp(ids);
    if (depth >= opt.maxDepth || ids.length < 2 * opt.minLeaf || im < 1e-12) { v[node] = leafVal(ids); continue; }
    let best = { g: Infinity };
    const feats = []; while (feats.length < opt.mtry) { const k = Math.floor(r() * p); if (!feats.includes(k)) feats.push(k); }
    for (const k of feats) {
      const ord = ids.slice().sort((a, b) => X[a][k] - X[b][k]), n = ord.length;
      if (isClf) { const Lc = new Array(C).fill(0), Rc = new Array(C).fill(0); ord.forEach(i => Rc[y[i]]++);
        let gl = 0, gr = 0; Rc.forEach(c => gr += c * c);
        for (let i = 0; i < n - 1; i++) { const c = y[ord[i]]; gl += 2 * Lc[c] + 1; Lc[c]++; gr -= 2 * Rc[c] - 1; Rc[c]--;
          if (i + 1 < opt.minLeaf || n - i - 1 < opt.minLeaf || X[ord[i]][k] === X[ord[i + 1]][k]) continue;
          const nl = i + 1, nr = n - nl, g = nl * (1 - gl / (nl * nl)) + nr * (1 - gr / (nr * nr));
          if (g < best.g) best = { g, k, th: (X[ord[i]][k] + X[ord[i + 1]][k]) / 2 }; } }
      else { let sl = 0, sl2 = 0, st = 0, st2 = 0; ord.forEach(i => { st += y[i]; st2 += y[i] * y[i]; });
        for (let i = 0; i < n - 1; i++) { const yy = y[ord[i]]; sl += yy; sl2 += yy * yy;
          if (i + 1 < opt.minLeaf || n - i - 1 < opt.minLeaf || X[ord[i]][k] === X[ord[i + 1]][k]) continue;
          const nl = i + 1, nr = n - nl, sr = st - sl, sr2 = st2 - sl2, g = (sl2 - sl * sl / nl) + (sr2 - sr * sr / nr);
          if (g < best.g) best = { g, k, th: (X[ord[i]][k] + X[ord[i + 1]][k]) / 2 }; } }
    }
    if (best.g === Infinity) { v[node] = leafVal(ids); continue; }
    const L = ids.filter(i => X[i][best.k] <= best.th), R = ids.filter(i => X[i][best.k] > best.th);
    f[node] = best.k; t[node] = best.th; stack.push([R, depth + 1, node, 1], [L, depth + 1, node, 0]);
  }
  return { f, t, l, r: rr, v };
}
function trainForest(X, y, opt, isClf, C, prog) {
  const r = mulberry(opt.seed || 1), n = X.length, trees = [];
  for (let k = 0; k < opt.nTrees; k++) { const idx = Array.from({ length: n }, () => Math.floor(r() * n)); trees.push(buildTree(X, y, idx, opt, r, isClf, C)); if (prog) prog((k + 1) / opt.nTrees); }
  return trees;
}
function treePredict(t, x) { let i = 0; while (t.l[i] !== -1) i = x[t.f[i]] <= t.t[i] ? t.l[i] : t.r[i]; return t.v[i]; }
function forestPredict(trees, x) { const o = new Float64Array(trees[0].v.find(Boolean).length); for (const t of trees) { const v = treePredict(t, x); for (let k = 0; k < o.length; k++) o[k] += v[k]; } return Array.from(o, v => v / trees.length); }

/* ---------- entrenamiento y validación de la IA ---------- */
const LEVELS = [{ k: 'bajo', sf: .002, ss: .02 }, { k: 'medio', sf: .005, ss: .05 }, { k: 'alto', sf: .01, ss: .10 }];
function noisy(x, L, r, NM) { return x.map((v, i) => v + gaussR(r) * (i < NM ? L.sf : L.ss)); }
function trainIA(camp, prog) {
  const rows = camp.rows, Z = camp.zones.length, C = Z + 1, NM = camp.NM, r = mulberry(11);
  // partición 70/30 estratificada por zona
  const byZ = {}; rows.forEach((row, i) => (byZ[row.zona] = byZ[row.zona] || []).push(i)); const tr = [], te = [];
  Object.values(byZ).forEach(ids => { const a = ids.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } const nt = Math.round(a.length * .3); te.push(...a.slice(0, nt)); tr.push(...a.slice(nt)); });
  const Xtr = [], ytr = [], str = []; LEVELS.forEach((L, li) => { const rr = mulberry(100 + li); tr.forEach(i => { Xtr.push(noisy(rows[i].x, L, rr, NM)); ytr.push(rows[i].zona + 1); str.push(rows[i].sev); }); });
  const p = Xtr[0].length, mean = new Array(p).fill(0), sd = new Array(p).fill(0); Xtr.forEach(x => x.forEach((v, k) => mean[k] += v / Xtr.length)); Xtr.forEach(x => x.forEach((v, k) => sd[k] += (v - mean[k]) ** 2 / Xtr.length)); sd.forEach((v, k) => sd[k] = Math.sqrt(v) || 1);
  const clf = trainForest(Xtr, ytr, { nTrees: 60, maxDepth: 16, minLeaf: 1, mtry: Math.max(1, Math.round(Math.sqrt(p))), seed: 3 }, true, C, q => prog && prog('Clasificador de zona', q));
  const dmg = ytr.map((y, i) => y > 0 ? i : -1).filter(i => i >= 0);
  const Xs = dmg.map(i => Xtr[i].concat(Array.from({ length: Z }, (_, z) => z === ytr[i] - 1 ? 1 : 0))), ys = dmg.map(i => str[i]);
  const reg = trainForest(Xs, ys, { nTrees: 40, maxDepth: 14, minLeaf: 2, mtry: Math.max(1, Math.round((p + Z) / 3)), seed: 5 }, false, 1, q => prog && prog('Regresor de severidad', q));
  const span = z => z < 0 ? -1 : camp.spanOfZone[z];
  const metrics = {};
  LEVELS.forEach((L, li) => { const rr = mulberry(200 + li); let tp = 0, fn = 0, tn = 0, fp = 0, loc = 0, sp = 0, ae = 0, na = 0; const band = { a: [0, 0], b: [0, 0], c: [0, 0] }, rec = new Array(Z).fill(0), cnt = new Array(Z).fill(0);
    te.forEach(i => { const row = rows[i], x = noisy(row.x, L, rr, NM), pr = forestPredict(clf, x), c = pr.indexOf(Math.max(...pr)) - 1;
      const dt = row.zona >= 0, dp = c >= 0; if (dt && dp) tp++; else if (dt) fn++; else if (dp) fp++; else tn++;
      if (c === row.zona) loc++; if (span(c) === span(row.zona)) sp++;
      if (dt) { cnt[row.zona]++; if (c === row.zona) rec[row.zona]++; const b = row.sev < .15 ? 'a' : row.sev < .3 ? 'b' : 'c'; band[b][1]++; if (c === row.zona) band[b][0]++;
        const s = forestPredict(reg, x.concat(Array.from({ length: Z }, (_, z) => z === Math.max(0, c) ? 1 : 0)))[0]; ae += Math.abs(s - row.sev); na++; } });
    metrics[L.k] = { deteccion: .5 * (tp / (tp + fn) + tn / (tn + fp)), falsaAlarma: fp / (fp + tn), localizacion: loc / te.length, vano: sp / te.length, mae: ae / na,
      d5_15: band.a[0] / band.a[1], d15_30: band.b[0] / band.b[1], d30_60: band.c[0] / band.c[1], recall: rec.map((v, z) => cnt[z] ? v / cnt[z] : 0), nTest: te.length }; });
  // fuera de dominio: distancia estandarizada al vecino de entrenamiento más cercano
  const rs = mulberry(9), sub = []; for (let i = 0; i < Math.min(1500, Xtr.length); i++) sub.push(Xtr[Math.floor(rs() * Xtr.length)].map((v, k) => (v - mean[k]) / sd[k]));
  const nn = x => { const z = x.map((v, k) => (v - mean[k]) / sd[k]); let b = Infinity; for (const s of sub) { let d = 0; for (let k = 0; k < z.length; k++) d += (z[k] - s[k]) ** 2; if (d < b) b = d; } return Math.sqrt(b); };
  const rr = mulberry(300), dd = te.map(i => nn(noisy(rows[i].x, LEVELS[2], rr, NM))).sort((a, b) => a - b), thr = dd[Math.floor(.99 * (dd.length - 1))];
  return { clf, reg, mean, sd, sub, oodThr: thr, metrics, nTrain: tr.length, nTest: te.length };
}

/* ---------- registros sísmicos (CISMID, IGP u otros en texto) ---------- */
// Lee columnas numéricas de un archivo de texto. Busca el intervalo de muestreo en el encabezado (dt, delta, intervalo, muestreo, sps, Hz).
function readAccel(text) {
  const lines = text.split(/\r?\n/), head = [], rows = [];
  for (const l of lines) { const t = l.trim(); if (!t) continue; const parts = t.replace(/[;,\t]+/g, ' ').split(/\s+/); const nums = parts.map(Number);
    if (parts.length >= 1 && parts.length <= 6 && nums.every(Number.isFinite)) rows.push(nums); else if (!rows.length || rows.length < 5) head.push(t); }
  if (rows.length < 50) throw new Error('No se encontraron columnas numéricas suficientes (al menos 50 filas).');
  const nc = rows.map(r => r.length).reduce((a, b, _, arr) => { const c = {}; arr.forEach(x => c[x] = (c[x] || 0) + 1); return +Object.entries(c).sort((p, q) => q[1] - p[1])[0][0]; }, 0);
  const R = rows.filter(r => r.length === nc), cols = Array.from({ length: nc }, (_, k) => Float64Array.from(R, r => r[k]));
  const H = head.join('\n'); let dt = null, how = '';
  const m1 = H.match(/(?:\bdt\b|delta\s*t|intervalo(?:\s+de\s+muestreo)?|time\s*step|sampling\s*interval)\s*[:=]?\s*([0-9]*[.,]?[0-9]+)\s*(ms|s)?/i);
  const m2 = H.match(/(?:muestreo|sampling(?:\s*rate)?|frecuencia\s+de\s+muestreo|sps|samples\s*per\s*second)\s*[:=]?\s*([0-9]+[.,]?[0-9]*)\s*(hz|sps|m\/s)?/i);
  if (m1) { dt = parseFloat(m1[1].replace(',', '.')) * (m1[2] && m1[2].toLowerCase() === 'ms' ? 1e-3 : 1); how = 'encabezado (intervalo)'; }
  else if (m2) { const fs = parseFloat(m2[1].replace(',', '.')); if (fs > 1) { dt = 1 / fs; how = 'encabezado (frecuencia de muestreo)'; } }
  // si la primera columna crece de forma uniforme es el tiempo
  let tcol = -1; if (nc >= 2) { const c = cols[0], d = c[1] - c[0]; let ok = d > 0; for (let i = 2; i < Math.min(c.length, 2000) && ok; i++) if (Math.abs((c[i] - c[i - 1]) - d) > 1e-6 + 1e-3 * d) ok = false; if (ok) { tcol = 0; if (!dt) { dt = d; how = 'columna de tiempo'; } } }
  return { cols, tcol, dt, how, header: H.slice(0, 1500), n: R.length };
}
// Integración exacta por tramos lineales (Nigam y Jennings) de u'' + 2ζω u' + ω² u = −a(t)
function nigam(w, z, dt) {
  const wd = w * Math.sqrt(1 - z * z), e = Math.exp(-z * w * dt), s = Math.sin(wd * dt), c = Math.cos(wd * dt), k = w * w, r = Math.sqrt(1 - z * z);
  return { A: e * (z / r * s + c), B: e * s / wd,
    C: (2 * z / (w * dt) + e * (((1 - 2 * z * z) / (wd * dt) - z / r) * s - (1 + 2 * z / (w * dt)) * c)) / k,
    D: (1 - 2 * z / (w * dt) + e * ((2 * z * z - 1) / (wd * dt) * s + 2 * z / (w * dt) * c)) / k,
    A1: -e * (w / r * s), B1: e * (c - z / r * s),
    C1: (-1 / dt + e * ((w / r + z / (dt * r)) * s + c / dt)) / k,
    D1: (1 - e * (z / r * s + c)) / (k * dt) };
}
function sdof(ag, dt, w, z) { const q = nigam(w, z, dt), n = ag.length, u = new Float64Array(n); let x = 0, v = 0;
  for (let i = 0; i < n - 1; i++) { const p0 = -ag[i], p1 = -ag[i + 1], xn = q.A * x + q.B * v + q.C * p0 + q.D * p1, vn = q.A1 * x + q.B1 * v + q.C1 * p0 + q.D1 * p1; x = xn; v = vn; u[i + 1] = x; } return u; }
function spectrum(ag, dt, z, T) { return T.map(t => { const w = 2 * Math.PI / t, u = sdof(ag, dt, w, z); let m = 0; for (let i = 0; i < u.length; i++) m = Math.max(m, Math.abs(u[i])); return { T: t, Sd: m, Sa: w * w * m }; }); }
// Superposición modal: excitación uniforme en la base; aY longitudinal y aZ vertical en m/s² (cualquiera puede ser null)
function seismic(fr, md, aY, aZ, dt, z) {
  const N = fr.nodes.length, nd = 3 * N, Md = new Float64Array(nd); for (let i = 0; i < N; i++) { Md[3 * i] = Md[3 * i + 1] = fr.mass[i]; Md[3 * i + 2] = fr.mass[i] * 1e-4; }
  let mt = 0; for (let i = 0; i < N; i++) mt += Md[3 * i];
  const n = (aY || aZ).length, modes = md.phi.map((u, k) => { let mm = 0, LY = 0, LZ = 0; for (let i = 0; i < nd; i++) mm += u[i] * u[i] * Md[i]; for (let i = 0; i < N; i++) { LY += u[3 * i] * Md[3 * i]; LZ += u[3 * i + 1] * Md[3 * i + 1]; }
    const GY = LY / mm, GZ = LZ / mm, w = 2 * Math.PI * md.f[k], q = new Float64Array(n);
    if (aY) { const d = sdof(aY, dt, w, z); for (let i = 0; i < n; i++) q[i] += GY * d[i]; }
    if (aZ) { const d = sdof(aZ, dt, w, z); for (let i = 0; i < n; i++) q[i] += GZ * d[i]; }
    let qm = 0; for (let i = 0; i < n; i++) qm = Math.max(qm, Math.abs(q[i]));
    return { f: md.f[k], GY, GZ, mY: LY * LY / mm / mt, mZ: LZ * LZ / mm / mt, q, qmax: qm }; });
  // historia de desplazamientos nodales (y, z) y sus máximos
  const peakY = new Float64Array(N), peakZ = new Float64Array(N); let gmax = 0, tmax = 0, nmax = -1;
  const M = modes.length; for (let i = 0; i < n; i++) for (let j = 0; j < N; j++) { let y = 0, zz = 0; for (let k = 0; k < M; k++) { const ph = md.phi[k], qi = modes[k].q[i]; y += ph[3 * j] * qi; zz += ph[3 * j + 1] * qi; }
    const ay = Math.abs(y), az = Math.abs(zz); if (ay > peakY[j]) peakY[j] = ay; if (az > peakZ[j]) peakZ[j] = az; const h = Math.hypot(y, zz); if (h > gmax) { gmax = h; tmax = i * dt; nmax = j; } }
  return { modes, peakY, peakZ, gmax, tmax, nmax, n, dt, cumY: modes.reduce((s, m) => s + m.mY, 0), cumZ: modes.reduce((s, m) => s + m.mZ, 0) };
}

/* ---------- IA solo con frecuencias (cuando el usuario entrega frecuencias medidas o calculadas) ---------- */
// Campaña: Δf de los NM primeros modos ordenados por frecuencia (sin formas modales, como en una medición de solo frecuencias).
function freqCampaign(type, G, p, opts, prog) {
  const r = mulberry(opts.seed || 7), NM = opts.NM || 8, fr0 = build(type, G, p), f0 = modal(fr0, NM).f, Z = fr0.zoneDefs.length;
  const jobs = []; for (let i = 0; i < opts.nUndamaged; i++) jobs.push(-1); for (let z = 0; z < Z; z++) for (let i = 0; i < opts.nPerZone; i++) jobs.push(z);
  const rows = [], t0 = Date.now();
  jobs.forEach((zz, n) => { const pp = Object.assign({}, p, { E: p.E * (1 + gaussR(r) * opts.unc / 2), w_deck: p.w_deck * (1 + gaussR(r) * opts.unc / 2) });
    const fr = build(type, G, pp), d = zz < 0 ? 0 : 0.05 + r() * 0.55, esc = new Float64Array(fr.el.length).fill(1); if (zz >= 0) fr.zoneOf.forEach((z, t) => { if (z === zz) esc[t] = 1 - d; });
    const f = modal(fr, NM, esc, 1e-9).f; rows.push({ zona: zz, sev: d, df: f.map((v, i) => (v - f0[i]) / f0[i]) }); if (prog && n % 20 === 0) prog(n / jobs.length, (Date.now() - t0) / 1000); });
  const spanOfZone = fr0.zoneDefs.map((_, z) => { const t = fr0.zoneOf.indexOf(z); if (t < 0) return -1; const [i, j] = fr0.el[t], m = (fr0.nodes[i][0] + fr0.nodes[j][0]) / 2; return fr0.spans.findIndex(S => m >= S.a - 1e-6 && m <= S.b + 1e-6); });
  return { rows, f0, zones: fr0.zoneDefs, NM, spanOfZone };
}
// Entrena con los k primeros modos y el error de medición sf (fracción de la frecuencia)
function trainFreqIA(camp, k, sf, prog) {
  const rows = camp.rows, Z = camp.zones.length, C = Z + 1, r = mulberry(11), byZ = {}; rows.forEach((row, i) => (byZ[row.zona] = byZ[row.zona] || []).push(i)); const tr = [], te = [];
  Object.values(byZ).forEach(ids => { const a = ids.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } const nt = Math.round(a.length * .3); te.push(...a.slice(0, nt)); tr.push(...a.slice(nt)); });
  const nz = (x, rr) => x.slice(0, k).map(v => v + gaussR(rr) * sf), rr = mulberry(101), Xtr = [], ytr = [], str = [];
  for (let rep = 0; rep < 3; rep++) tr.forEach(i => { Xtr.push(nz(rows[i].df, rr)); ytr.push(rows[i].zona + 1); str.push(rows[i].sev); });
  const mean = new Array(k).fill(0), sd = new Array(k).fill(0); Xtr.forEach(x => x.forEach((v, j) => mean[j] += v / Xtr.length)); Xtr.forEach(x => x.forEach((v, j) => sd[j] += (v - mean[j]) ** 2 / Xtr.length)); sd.forEach((v, j) => sd[j] = Math.sqrt(v) || 1);
  const clf = trainForest(Xtr, ytr, { nTrees: 60, maxDepth: 16, minLeaf: 1, mtry: Math.max(1, Math.round(Math.sqrt(k))), seed: 3 }, true, C, q => prog && prog('Clasificador de zona', q));
  const dmg = ytr.map((y, i) => y > 0 ? i : -1).filter(i => i >= 0), Xs = dmg.map(i => Xtr[i].concat(Array.from({ length: Z }, (_, z) => z === ytr[i] - 1 ? 1 : 0))), ys = dmg.map(i => str[i]);
  const reg = trainForest(Xs, ys, { nTrees: 40, maxDepth: 14, minLeaf: 2, mtry: Math.max(1, Math.round((k + Z) / 3)), seed: 5 }, false, 1, q => prog && prog('Regresor de severidad', q));
  const span = z => z < 0 ? -1 : camp.spanOfZone[z], rt = mulberry(201); let loc = 0, sp = 0, fp = 0, tn = 0; te.forEach(i => { const x = nz(rows[i].df, rt), pr = forestPredict(clf, x), c = pr.indexOf(Math.max(...pr)) - 1; if (c === rows[i].zona) loc++; if (span(c) === span(rows[i].zona)) sp++; if (rows[i].zona < 0) { if (c >= 0) fp++; else tn++; } });
  const rs = mulberry(9), sub = []; for (let i = 0; i < Math.min(1500, Xtr.length); i++) sub.push(Xtr[Math.floor(rs() * Xtr.length)].map((v, j) => (v - mean[j]) / sd[j]));
  const nn = x => { const zz = x.map((v, j) => (v - mean[j]) / sd[j]); let b = Infinity; for (const s of sub) { let d = 0; for (let j = 0; j < k; j++) d += (zz[j] - s[j]) ** 2; if (d < b) b = d; } return Math.sqrt(b); };
  const r3 = mulberry(300), dd = te.map(i => nn(nz(rows[i].df, r3))).sort((a, b) => a - b), thr = dd[Math.floor(.99 * (dd.length - 1))];
  return { clf, reg, mean, sd, sub, oodThr: thr, k, sf, metrics: { localizacion: loc / te.length, vano: sp / te.length, falsaAlarma: fp / Math.max(1, fp + tn), nTest: te.length } };
}
function freqPredict(I, Z, x) { const pr = forestPredict(I.clf, x), o = pr.map((p, i) => [p, i - 1]).sort((a, b) => b[0] - a[0]), cls = o[0][1];
  const zz = x.map((v, j) => (v - I.mean[j]) / I.sd[j]); let b = Infinity; for (const s of I.sub) { let d = 0; for (let j = 0; j < zz.length; j++) d += (zz[j] - s[j]) ** 2; if (d < b) b = d; } const dist = Math.sqrt(b);
  const sev = cls >= 0 ? forestPredict(I.reg, x.concat(Array.from({ length: Z }, (_, z) => z === cls ? 1 : 0)))[0] : null;
  return { cls, p: o[0][0], top: o.slice(0, 4), conclusive: o[0][0] >= .4 && o[0][0] - o[1][0] >= .1, dist, ood: dist > I.oodThr, sev }; }

return { readAccel, sdof, spectrum, seismic, freqCampaign, trainFreqIA, freqPredict, build, modal, archAll, parseCloud, orient, bounds, deckLevel, groundLevel, detectSupports, spansOf, envelope, fitParabola, polyval, archGeometry, spanCoverage, MATERIALS,
  build, sensorsOf, modal, signConvention, features, campaign, trainIA, forestPredict, LEVELS, noisy, mulberry, gaussR, quantile, median };
})();
if (typeof module !== 'undefined') module.exports = OPC;
