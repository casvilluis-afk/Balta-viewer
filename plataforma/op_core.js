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
  const V = new Float64Array(nb); for (let k = 0; k < nb; k++) { const zc = zl + (k + .5) * bw; if (zc < zmid) continue; V[k] = h[k] + (h[k - 1] || 0) + (h[k + 1] || 0); if (V[k] > best) { best = V[k]; bi = k; } }
  // si hay dos franjas casi igual de pobladas (rodadura y cara inferior de una losa), la rodadura es la más alta
  for (let k = nb - 1; k > bi; k--) if (V[k] >= .8 * best && (V[k] >= (V[k - 1] || 0)) && (V[k] >= (V[k + 1] || 0))) { bi = k; break; }
  return zl + (bi + .5) * bw;
}
function groundLevel(O) { const a = []; for (let i = 0; i < O.n; i += 3) a.push(O.z[i]); return quantile(a, .001); }
// apoyos: caras de pilares y estribos = bandas densas de puntos en una franja horizontal bajo los arranques (como pier_faces en geom.py)
function detectSupports(O, deckTop, ground, frac = 0.62, tol = 0.25) {
  // 1) huella del tablero en planta (+1 m): fuera de ella quedan taludes y vegetación laterales. Con láser terrestre desde un lado se ven las caras laterales, por eso no se recorta más.
  const dS = [], dT = []; for (let i = 0; i < O.n; i += 2) if (Math.abs(O.z[i] - deckTop) < .3) { dS.push(O.s[i]); dT.push(O.t[i]); }
  const t0 = quantile(dT, .03), t1 = quantile(dT, .97), tm = (t0 + t1) / 2, th = (t1 - t0) / 2 + 1, d0 = quantile(dS, .005), d1 = quantile(dS, .995);
  const core = i => Math.abs(O.t[i] - tm) <= th, H = deckTop - ground;
  const zc = deckTop - frac * H, [sl, sh] = bounds(O.s), bw = 0.1, nb = Math.ceil((sh - sl) / bw) + 1;
  const slice = (z0, tl) => { const h = new Float64Array(nb); for (let i = 0; i < O.n; i++) if (Math.abs(O.z[i] - z0) < tl && core(i)) h[Math.floor((O.s[i] - sl) / bw)]++; return h; };
  const h = slice(zc, tol);
  const sm = h.map((_, k) => (h[k - 1] || 0) * .25 + h[k] * .5 + (h[k + 1] || 0) * .25), nz = Array.from(sm).filter(v => v > 0);
  const thr = Math.max(2, 0.2 * quantile(nz.length ? nz : [0], .98));
  const runs = []; let a = -1;
  for (let k = 0; k <= nb; k++) { const on = k < nb && sm[k] >= thr; if (on && a < 0) a = k; if (!on && a >= 0) { let m = a; for (let j = a; j < k; j++) if (sm[j] > sm[m]) m = j; let tot = 0; for (let j = a; j < k; j++) tot += h[j]; runs.push({ a: sl + a * bw, b: sl + k * bw, peak: sl + (m + .5) * bw, tot }); a = -1; } }
  // 2) un apoyo es un elemento vertical: debe aparecer también en cortes más altos (hacia el tablero) en la misma posición;
  //    el terreno inclinado o el talud cruzan cada corte en otra posición y se descartan
  const hz = [deckTop - Math.min(.9, frac + .13) * H, deckTop - (frac - .12) * H].map(z => slice(z, tol)), occ = (hh, s0) => { let c = 0; for (let k = Math.max(0, Math.floor((s0 - 1.2 - sl) / bw)); k <= Math.min(nb - 1, Math.floor((s0 + 1.2 - sl) / bw)); k++) c += hh[k]; return c; };
  const peakAt = (hh, s0) => { let m = -1, v = -1; for (let k = Math.max(0, Math.floor((s0 - 1.5 - sl) / bw)); k <= Math.min(nb - 1, Math.floor((s0 + 1.5 - sl) / bw)); k++) { const x = (hh[k - 1] || 0) + hh[k] + (hh[k + 1] || 0); if (x > v) { v = x; m = k; } } return sl + (m + .5) * bw; };
  // vegetación: aparece en varias alturas pero sin una cara alineada; un pilar o muro tiene su cara en la misma posición a todas las alturas
  const vert = r => { const o = hz.filter(hh => occ(hh, r.peak) >= Math.max(3, .15 * r.tot)), al = o.filter(hh => peakAt(hh, r.peak) >= r.a - .4 && peakAt(hh, r.peak) <= r.b + .4); return al.length >= 1 && o.length >= (H > 4 ? 2 : 1); };
  const cand = runs.filter(r => r.peak > d0 - 1 && r.peak < d1 + 1), mx = Math.max(0, ...cand.map(q => q.tot)), big = cand.filter(r => r.tot >= 0.1 * mx && vert(r));
  // caras a menos de 4,5 m forman un mismo pilar; la cara exterior de cada grupo es el pico de densidad
  const groups = []; big.forEach(r => { const g = groups[groups.length - 1]; if (g && r.peak - g[g.length - 1].peak <= 4.5) g.push(r); else groups.push([r]); });
  const sup = groups.map(g => ({ a: g[0].peak, b: g[g.length - 1].peak }));
  // es estribo si no hay tablero más allá; si el tablero sigue, es un pilar y el vano extremo se completa por simetría
  const deckBeyond = (s0, dir) => { let c = 0; for (let i = 0; i < O.n; i++) if (Math.abs(O.z[i] - deckTop) < .3 && (dir < 0 ? O.s[i] < s0 - 5 : O.s[i] > s0 + 5)) c++; return c > 200; };
  // 3) estribos en los extremos: donde el terreno bajo el tablero sube hasta cerca de la cara inferior (≤ 2,5 m bajo la rodadura)
  const gb = .5, gn = Math.ceil((d1 - d0) / gb), low = Array.from({ length: gn }, () => []);
  for (let i = 0; i < O.n; i++) { if (!core(i) || O.s[i] < d0 || O.s[i] >= d1 || O.z[i] > deckTop - .6) continue; low[Math.floor((O.s[i] - d0) / gb)].push(O.z[i]); }
  const gz = low.map(b => b.length >= 5 ? quantile(b, .05) : null), clear = k => gz[k] == null ? null : deckTop - gz[k], mid = sup.length ? (sup[0].a + sup[sup.length - 1].b) / 2 : (d0 + d1) / 2, km = Math.min(gn - 1, Math.max(0, Math.floor((mid - d0) / gb)));
  const edge = dir => { for (let k = km; k >= 0 && k < gn; k += dir) { const c = clear(k); if (c != null && c < 2.5) return d0 + (k + (dir > 0 ? 0 : 1)) * gb; } return dir > 0 ? d1 : d0; };
  const clearAt = s0 => { const k = Math.floor((s0 - d0) / gb); let best = null; for (let j = k - 2; j <= k + 2; j++) { const c = j >= 0 && j < gn ? clear(j) : null; if (c != null) best = best == null ? c : Math.min(best, c); } return best; };
  // en los extremos: estribo si más allá el terreno está cerca del tablero (terraplén) o no sigue el tablero; pilar si hay vano libre detrás
  sup.forEach((p, i) => { p.tipo = 'pilar'; const single = groups[i].length === 1, end = i === 0 ? -1 : i === sup.length - 1 ? 1 : 0; if (!end) return;
    const so = end < 0 ? p.a - 4 : p.b + 4, c = clearAt(so), noDeck = !deckBeyond(end < 0 ? p.a : p.b, end);
    if (noDeck || (single && (c == null || c < 2.5))) p.tipo = 'estribo'; });
  // solo se agrega un estribo por terreno donde el apoyo extremo es un pilar con vano libre detrás (p. ej. pilar central de dos vanos)
  const edgeFrom = (s0, dir) => { const k0 = Math.min(gn - 1, Math.max(0, Math.floor((s0 - d0) / gb))); for (let k = k0 + dir * 4; k >= 0 && k < gn; k += dir) { const c = clear(k); if (c != null && c < 2.5) return d0 + (k + (dir > 0 ? 0 : 1)) * gb; } return dir > 0 ? d1 : d0; };
  if (!sup.length) { sup.push({ a: edge(-1), b: edge(-1), tipo: 'estribo', auto: 'terreno' }, { a: edge(1), b: edge(1), tipo: 'estribo', auto: 'terreno' }); }
  else { const f = sup[0], l = sup[sup.length - 1];
    if (f.tipo === 'pilar') { const L = edgeFrom(f.a, -1); if (f.a - L > Math.max(6, .3 * (sup.length > 1 ? sup[1].a - f.b : 0))) sup.unshift({ a: L, b: L, tipo: 'estribo', auto: 'terreno' }); }
    if (l.tipo === 'pilar') { const R = edgeFrom(l.b, 1); if (R - l.b > Math.max(6, .3 * (sup.length > 1 ? l.a - sup[sup.length - 2].b : 0))) sup.push({ a: R, b: R, tipo: 'estribo', auto: 'terreno' }); } }
  // un "estribo" detectado dentro del tablero lejos de los extremos y con terreno libre debajo era talud: se descarta si hay un estribo por terreno más afuera
  return { supports: sup, zSlab: zc, faces: big.map(r => r.peak), deck: [d0, d1], band: [tm - th, tm + th] };
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
  const pA = p.pier_t * p.width, pI = p.width * p.pier_t ** 3 / 12, Ep = p.E_pier * 1e6, fixed = [], stems = [];
  for (let k = 1; k < G.supports.length - 1; k++) {
    const nl = arches[k - 1].ids[NSEG], nr = arches[k].ids[0], [yl, zl] = nodes[nl], [yr, zr] = nodes[nr];
    const top = add((yl + yr) / 2, (zl + zr) / 2), base = add((yl + yr) / 2, G.zBase[k - 1]);
    ae(nl, top, Ep * 50, pA, pI, 'pilar_' + k); ae(top, nr, Ep * 50, pA, pI, 'pilar_' + k); stems.push(el.length); ae(top, base, Ep, pA, pI, 'pilar_' + k);
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
  // pilares: pérdida de rigidez del fuste y de su empotramiento (socavación de la cimentación, como la del Balta en 2009)
  stems.forEach((_, k) => fr.zoneDefs.push(`Pilar ${k + 1} · base (socavación)`));
  const mid = t => (nodes[el[t][0]][0] + nodes[el[t][1]][0]) / 2, na = arches.length;
  fr.zoneOf = el.map((_, t) => { const g = grp[t]; for (const a of arches) { const s0 = a.ys[0], s1 = a.ys[NSEG]; if (g === 'arco_' + a.k) return a.k * 5 + Math.min(Math.floor((mid(t) - s0) / (s1 - s0) * 5), 4); if (g === 'tablero' && s0 <= mid(t) && mid(t) <= s1) return 5 * na + a.k; } const ks = stems.indexOf(t); return ks >= 0 ? 5 * na + fr.spans.length + ks : -1; });
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
    if (opts.modelErr) for (let t = 0; t < esc.length; t++) esc[t] = Math.exp(gaussR(r) * opts.modelErr);
    if (zz >= 0) fr.zoneOf.forEach((z, t) => { if (z === zz) esc[t] *= 1 - d; });
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
  const r = mulberry(opts.seed || 7), NM = opts.NM || 8, fr0 = build(type, G, p), m0 = modal(fr0, NM), f0 = m0.f, Z = fr0.zoneDefs.length;
  // formas en los sensores del tablero (para la IA con formas modales medidas): emparejadas por MAC con el modelo nominal y con el mismo signo
  const sdof = sensorsOf(fr0).map(s => s.dof), at = u => sdof.map(d => u[d]), dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  const sh0 = m0.phi.map(at), mac = (a, b) => dot(a, b) ** 2 / (dot(a, a) * dot(b, b) || 1);
  const jobs = []; for (let i = 0; i < opts.nUndamaged; i++) jobs.push(-1); for (let z = 0; z < Z; z++) for (let i = 0; i < opts.nPerZone; i++) jobs.push(z);
  const rows = [], t0 = Date.now();
  jobs.forEach((zz, n) => { const pp = Object.assign({}, p, { E: p.E * (1 + gaussR(r) * opts.unc / 2), w_deck: p.w_deck * (1 + gaussR(r) * opts.unc / 2) });
    const fr = build(type, G, pp), d = zz < 0 ? 0 : 0.05 + r() * 0.55, esc = new Float64Array(fr.el.length).fill(1);
    // error de modelo: la rigidez real de cada elemento difiere de la supuesta (lognormal, σ = modelErr); evita entrenar y evaluar con el mismo modelo perfecto
    if (opts.modelErr) for (let t = 0; t < esc.length; t++) esc[t] = Math.exp(gaussR(r) * opts.modelErr);
    if (zz >= 0) fr.zoneOf.forEach((z, t) => { if (z === zz) esc[t] *= 1 - d; });
    const md = modal(fr, NM, esc, 1e-9), f = md.f, row = { zona: zz, sev: d, df: f.map((v, i) => (v - f0[i]) / f0[i]) };
    if (opts.shapes !== false) { const S = md.phi.map(at), used = new Set(); row.dfm = []; row.sh = [];
      for (let i = 0; i < NM; i++) { let best = -1, j = 0; for (let k = 0; k < NM; k++) { if (used.has(k)) continue; const m = mac(sh0[i], S[k]) * (1 - Math.min(1, Math.abs(f[k] / f0[i] - 1) * 2)); if (m > best) { best = m; j = k; } } used.add(j);
        const sg = Math.sign(dot(S[j], sh0[i])) || 1; row.dfm.push((f[j] - f0[i]) / f0[i]); row.sh.push(S[j].map(v => +(v * sg).toPrecision(6))); } }
    rows.push(row); if (prog && n % 20 === 0) prog(n / jobs.length, (Date.now() - t0) / 1000); });
  const spanOfZone = fr0.zoneDefs.map((_, z) => { const t = fr0.zoneOf.indexOf(z); if (t < 0) return -1; const [i, j] = fr0.el[t], m = (fr0.nodes[i][0] + fr0.nodes[j][0]) / 2; return fr0.spans.findIndex(S => m >= S.a - 1e-6 && m <= S.b + 1e-6); });
  return { rows, f0, sh0, zones: fr0.zoneDefs, NM, spanOfZone };
}
// Entrena con los k primeros modos y el error de medición sf (fracción de la frecuencia)
function trainVecIA(camp, featOf, prog) { // featOf(row, rng) → vector de rasgos con ruido de medición
  const k = featOf(camp.rows[0], mulberry(1)).length;
  const rows = camp.rows, Z = camp.zones.length, C = Z + 1, r = mulberry(11), byZ = {}; rows.forEach((row, i) => (byZ[row.zona] = byZ[row.zona] || []).push(i)); const tr = [], te = [];
  Object.values(byZ).forEach(ids => { const a = ids.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } const nt = Math.round(a.length * .3); te.push(...a.slice(0, nt)); tr.push(...a.slice(nt)); });
  const rr = mulberry(101), Xtr = [], ytr = [], str = [];
  for (let rep = 0; rep < 3; rep++) tr.forEach(i => { Xtr.push(featOf(rows[i], rr)); ytr.push(rows[i].zona + 1); str.push(rows[i].sev); });
  const mean = new Array(k).fill(0), sd = new Array(k).fill(0); Xtr.forEach(x => x.forEach((v, j) => mean[j] += v / Xtr.length)); Xtr.forEach(x => x.forEach((v, j) => sd[j] += (v - mean[j]) ** 2 / Xtr.length)); sd.forEach((v, j) => sd[j] = Math.sqrt(v) || 1);
  const clf = trainForest(Xtr, ytr, { nTrees: 60, maxDepth: 16, minLeaf: 1, mtry: Math.max(1, Math.round(Math.sqrt(k))), seed: 3 }, true, C, q => prog && prog('Clasificador de zona', q));
  const dmg = ytr.map((y, i) => y > 0 ? i : -1).filter(i => i >= 0), Xs = dmg.map(i => Xtr[i].concat(Array.from({ length: Z }, (_, z) => z === ytr[i] - 1 ? 1 : 0))), ys = dmg.map(i => str[i]);
  const reg = trainForest(Xs, ys, { nTrees: 40, maxDepth: 14, minLeaf: 2, mtry: Math.max(1, Math.round((k + Z) / 3)), seed: 5 }, false, 1, q => prog && prog('Regresor de severidad', q));
  const span = z => z < 0 ? -1 : camp.spanOfZone[z], rt = mulberry(201); let loc = 0, sp = 0, fp = 0, tn = 0; te.forEach(i => { const x = featOf(rows[i], rt), pr = forestPredict(clf, x), c = pr.indexOf(Math.max(...pr)) - 1; if (c === rows[i].zona) loc++; if (span(c) === span(rows[i].zona)) sp++; if (rows[i].zona < 0) { if (c >= 0) fp++; else tn++; } });
  const rs = mulberry(9), sub = []; for (let i = 0; i < Math.min(1500, Xtr.length); i++) sub.push(Xtr[Math.floor(rs() * Xtr.length)].map((v, j) => (v - mean[j]) / sd[j]));
  const nn = x => { const zz = x.map((v, j) => (v - mean[j]) / sd[j]); let b = Infinity; for (const s of sub) { let d = 0; for (let j = 0; j < k; j++) d += (zz[j] - s[j]) ** 2; if (d < b) b = d; } return Math.sqrt(b); };
  const r3 = mulberry(300), dd = te.map(i => nn(featOf(rows[i], r3))).sort((a, b) => a - b), thr = dd[Math.floor(.99 * (dd.length - 1))];
  return { clf, reg, mean, sd, sub, oodThr: thr, k, metrics: { localizacion: loc / te.length, vano: sp / te.length, falsaAlarma: fp / Math.max(1, fp + tn), nTest: te.length } };
}
function trainFreqIA(camp, k, sf, prog) { // k: número de modos (f1…fk) o lista de índices de los modos medidos (p. ej. [0, 2, 3])
  const idx = Array.isArray(k) ? k.slice() : Array.from({ length: k }, (_, i) => i), I = trainVecIA(camp, (row, rr) => idx.map(j => row.df[j] + gaussR(rr) * sf), prog); I.sf = sf; return I; }
// Rasgos con formas modales medidas: Δf de los modos sel.f (emparejados por MAC) + cambio de forma de los modos sel.s en los sensores sel.sens
// (cada forma normalizada a su máximo en esos sensores; se resta la forma del modelo de referencia). ss: error de forma (fracción del máximo).
function modalFeat(row, sh0, sel, sf, ss, rr) { const out = sel.f.map(j => row.dfm[j] + (rr ? gaussR(rr) * sf : 0));
  sel.s.forEach(j => { const v = sel.sens.map(i => row.sh[j][i]), m0 = Math.max(...v.map(Math.abs)) || 1, vn = v.map(x => x / m0 + (rr ? gaussR(rr) * ss : 0)), mx = Math.max(...vn.map(Math.abs)) || 1;
    const r0 = sel.sens.map(i => sh0[j][i]), q = Math.max(...r0.map(Math.abs)) || 1; vn.forEach((x, t) => out.push(x / mx - r0[t] / q)); });
  return out; }
function trainModalIA(camp, sel, sf, ss, prog) { if (!camp.rows[0].sh) throw new Error('La campaña no tiene formas modales.'); const I = trainVecIA(camp, (row, rr) => modalFeat(row, camp.sh0, sel, sf, ss, rr), prog); I.sel = sel; I.sf = sf; I.ss = ss; return I; }
// vector medido en el mismo formato: fm (Hz por modo del modelo), shapes {modo: [valores en sel.sens]}
// base (opcional): medición del puente sano {fm, shapes} con los mismos sensores. Entonces los rasgos son el cambio respecto a esa medición
// (Δf medido y cambio de forma medido) y el modelo solo aporta cómo cambian frecuencias y formas con el daño.
function modalMeasFeat(camp, sel, fm, shapes, base) { if (base) return modalMeasFeatBase(camp, sel, fm, shapes, base); const out = sel.f.map(j => fm[j] / camp.f0[j] - 1);
  sel.s.forEach(j => { const v = shapes[j], r0 = sel.sens.map(i => camp.sh0[j][i]), sg = Math.sign(v.reduce((a, x, t) => a + x * r0[t], 0)) || 1, mx = Math.max(...v.map(Math.abs)) || 1, q = Math.max(...r0.map(Math.abs)) || 1;
    v.forEach((x, t) => out.push(sg * x / mx - r0[t] / q)); });
  return out; }
function modalMeasFeatBase(camp, sel, fm, shapes, base) { const out = sel.f.map(j => fm[j] / base.fm[j] - 1);
  sel.s.forEach(j => { const v = shapes[j], b = base.shapes[j], sg = Math.sign(v.reduce((a, x, t) => a + x * b[t], 0)) || 1, mv = Math.max(...v.map(Math.abs)) || 1, mb = Math.max(...b.map(Math.abs)) || 1;
    v.forEach((x, t) => out.push(sg * x / mv - b[t] / mb)); });
  return out; }
function freqPredict(I, Z, x) { const pr = forestPredict(I.clf, x), o = pr.map((p, i) => [p, i - 1]).sort((a, b) => b[0] - a[0]), cls = o[0][1];
  const zz = x.map((v, j) => (v - I.mean[j]) / I.sd[j]); let b = Infinity; for (const s of I.sub) { let d = 0; for (let j = 0; j < zz.length; j++) d += (zz[j] - s[j]) ** 2; if (d < b) b = d; } const dist = Math.sqrt(b);
  const sev = cls >= 0 ? forestPredict(I.reg, x.concat(Array.from({ length: Z }, (_, z) => z === cls ? 1 : 0)))[0] : null;
  return { cls, p: o[0][0], top: o.slice(0, 4), conclusive: o[0][0] >= .4 && o[0][0] - o[1][0] >= .1, dist, ood: dist > I.oodThr, sev }; }

/* ---------- Planos DXF (AutoCAD R12, ASCII): unidades en metros, láminas A3 con cajetín ---------- */
// Escrito para PuenteGemelo; lo abren AutoCAD, BricsCAD, LibreCAD, DraftSight y QCAD.
const CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x201E: 0x84, 0x2026: 0x85, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2212: 0x2D, 0x2248: 0x7E, 0x2264: 0x3C, 0x2265: 0x3E, 0x03C3: 0x73, 0x0394: 0x44, 0x03B6: 0x7A };
function cp1252(str) { const out = []; for (const ch of str) { const c = ch.codePointAt(0); out.push(c < 128 || (c >= 0xA0 && c < 256) ? c : (CP1252[c] || 0x3F)); } return out; }
function Dxf() {
  const layers = new Map(), ents = []; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const ext = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  const n = v => (Math.round(v * 1e5) / 1e5).toString();
  const D = {
    layer(name, color, lt = 'CONTINUOUS') { if (!layers.has(name)) layers.set(name, { color, lt }); return D; },
    line(l, a, b, c, d) { ext(a, b); ext(c, d); ents.push(`0\nLINE\n8\n${l}\n10\n${n(a)}\n20\n${n(b)}\n30\n0\n11\n${n(c)}\n21\n${n(d)}\n31\n0`); },
    poly(l, pts, closed) { if (pts.length < 2) return; pts.forEach(p => ext(p[0], p[1]));
      ents.push(`0\nPOLYLINE\n8\n${l}\n66\n1\n70\n${closed ? 1 : 0}\n10\n0\n20\n0\n30\n0\n` + pts.map(p => `0\nVERTEX\n8\n${l}\n10\n${n(p[0])}\n20\n${n(p[1])}\n30\n0`).join('\n') + `\n0\nSEQEND\n8\n${l}`); },
    circle(l, x, y, r) { ext(x - r, y - r); ext(x + r, y + r); ents.push(`0\nCIRCLE\n8\n${l}\n10\n${n(x)}\n20\n${n(y)}\n30\n0\n40\n${n(r)}`); },
    point(l, x, y) { ext(x, y); ents.push(`0\nPOINT\n8\n${l}\n10\n${n(x)}\n20\n${n(y)}\n30\n0`); },
    text(l, x, y, h, s, align = 'l', rot = 0) { ext(x, y); const a = { l: 0, c: 1, r: 2 }[align] || 0, t = String(s).replace(/[\r\n]+/g, ' ');
      ents.push(`0\nTEXT\n8\n${l}\n10\n${n(x)}\n20\n${n(y)}\n30\n0\n40\n${n(h)}\n1\n${t}\n50\n${n(rot)}` + (a ? `\n72\n${a}\n11\n${n(x)}\n21\n${n(y)}\n31\n0` : '')); },
    rect(l, a, b, c, d) { D.poly(l, [[a, b], [c, b], [c, d], [a, d]], true); },
    bytes(ltscale = 1) {
      const lt = `0\nTABLE\n2\nLTYPE\n70\n3\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nLTYPE\n2\nDASHED\n70\n0\n3\n__ __ __\n72\n65\n73\n2\n40\n1.5\n49\n1.0\n49\n-0.5\n0\nLTYPE\n2\nCENTER\n70\n0\n3\n____ _ ____\n72\n65\n73\n4\n40\n3.0\n49\n2.0\n49\n-0.4\n49\n0.2\n49\n-0.4\n0\nENDTAB`;
      const ly = `0\nTABLE\n2\nLAYER\n70\n${layers.size + 1}\n0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nCONTINUOUS\n` + [...layers].map(([k, v]) => `0\nLAYER\n2\n${k}\n70\n0\n62\n${v.color}\n6\n${v.lt}`).join('\n') + '\n0\nENDTAB';
      const st = `0\nTABLE\n2\nSTYLE\n70\n1\n0\nSTYLE\n2\nSTANDARD\n70\n0\n40\n0.0\n41\n0.85\n50\n0.0\n71\n0\n42\n2.5\n3\ntxt\n4\n\n0\nENDTAB`;
      const hd = `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$DWGCODEPAGE\n3\nANSI_1252\n9\n$INSBASE\n10\n0.0\n20\n0.0\n30\n0.0\n9\n$EXTMIN\n10\n${n(x0)}\n20\n${n(y0)}\n30\n0\n9\n$EXTMAX\n10\n${n(x1)}\n20\n${n(y1)}\n30\n0\n9\n$LIMMIN\n10\n${n(x0)}\n20\n${n(y0)}\n9\n$LIMMAX\n10\n${n(x1)}\n20\n${n(y1)}\n9\n$LTSCALE\n40\n${n(ltscale)}\n9\n$PDMODE\n70\n0\n9\n$PDSIZE\n40\n0.0\n0\nENDSEC`;
      const txt = `${hd}\n0\nSECTION\n2\nTABLES\n${lt}\n${ly}\n${st}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${ents.join('\n')}\n0\nENDSEC\n0\nEOF\n`;
      return Uint8Array.from(cp1252(txt.replace(/\n/g, '\r\n')));
    }, count: () => ents.length
  };
  return D;
}
// Juego de planos del puente. spec: {proyecto, autores, fecha, nombre, fr, fam(grp), apoyos[{s,label}], luces[{a,b,txt}], notas[{s,z,txt}],
//   nivel{z,txt}, nube{s,z}, intrados[{pts,txt}], modos[{f,phi,partZ}], sensores[{s,z,label}], prioridad(t)→'Alta'|'Media'|'Baja'|null, orden[txt], fuente}
function bridgePlans(spec) {
  const D = Dxf(), fr = spec.fr, N = fr.nodes.length, ACI = { ARCOS: 5, TABLERO: 7, MONTANTES: 8, PILARES: 9, CORDONES: 5, DIAGONALES: 8, ESTRUCTURA: 7 };
  D.layer('MARCO', 7).layer('CAJETIN', 7).layer('TEXTO', 7).layer('COTAS', 3).layer('EJES', 1, 'CENTER').layer('APOYOS', 7).layer('NIVEL', 8, 'DASHED');
  Object.entries(ACI).forEach(([k, c]) => D.layer(k, c));
  let s0 = Infinity, s1 = -Infinity, z0 = Infinity, z1 = -Infinity; fr.nodes.forEach(([s, z]) => { s0 = Math.min(s0, s); s1 = Math.max(s1, s); z0 = Math.min(z0, z); z1 = Math.max(z1, z); });
  if (spec.nivel) z0 = Math.min(z0, spec.nivel.z);
  const Lb = s1 - s0, Hb = z1 - z0, SC = [50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000];
  const pickScale = (w, h) => SC.find(S => w * 1000 / S <= 370 && h * 1000 / S <= 175) || 1000;
  const sheets = []; let ox = 0;
  // lámina A3 apaisada con cajetín; devuelve transformación del dibujo
  function sheet(code, title, w, h, extra) {
    const S = pickScale(w, h), W = .42 * S, H = .297 * S, mm = v => v * S / 1000, x = ox, y = 0;
    D.rect('MARCO', x, y, x + W, y + H); D.rect('MARCO', x + mm(10), y + mm(10), x + W - mm(10), y + H - mm(10));
    const bx = x + W - mm(10) - mm(180), by = y + mm(10), bw = mm(180), bh = mm(40);
    D.rect('CAJETIN', bx, by, bx + bw, by + bh); D.line('CAJETIN', bx, by + mm(26), bx + bw, by + mm(26)); D.line('CAJETIN', bx, by + mm(13), bx + bw, by + mm(13)); D.line('CAJETIN', bx + mm(140), by, bx + mm(140), by + bh); D.line('CAJETIN', bx + mm(70), by, bx + mm(70), by + mm(13));
    const lab = (tx, ty, s) => D.text('CAJETIN', tx, ty, mm(1.8), s);
    lab(bx + mm(2), by + mm(36.5), 'PROYECTO'); D.text('CAJETIN', bx + mm(2), by + mm(28.5), mm(3.5), spec.proyecto);
    lab(bx + mm(2), by + mm(23.5), 'CONTENIDO'); D.text('CAJETIN', bx + mm(2), by + mm(15.5), mm(3.2), title.toUpperCase());
    lab(bx + mm(2), by + mm(10.5), 'ESCALA'); D.text('CAJETIN', bx + mm(2), by + mm(3), mm(2.8), '1:' + S + ' (A3)');
    lab(bx + mm(72), by + mm(10.5), 'FECHA'); D.text('CAJETIN', bx + mm(72), by + mm(3), mm(2.8), spec.fecha);
    lab(bx + mm(142), by + mm(36.5), 'LÁMINA'); D.text('CAJETIN', bx + mm(160), by + mm(16), mm(9), code, 'c');
    lab(bx + mm(142), by + mm(10.5), 'UNIDADES'); D.text('CAJETIN', bx + mm(142), by + mm(3), mm(2.6), 'metros');
    D.text('CAJETIN', x + mm(12), y + mm(12), mm(2), (spec.autores || '') + ' · Generado con PuenteGemelo');
    sheets.push({ code, title, S }); ox += W + mm(20);
    // área de dibujo: sobre el cajetín, centrada
    const ax0 = x + mm(18), ax1 = x + W - mm(18), ay0 = y + mm(62), ay1 = y + H - mm(16);
    const dx = (ax0 + ax1) / 2 - (s0 + s1) / 2, dy = (ay0 + ay1) / 2 - (extra ? extra.cz : (z0 + z1) / 2);
    return { S, mm, X: s => s + dx, Y: z => z + dy, x, y, W, H, ax0, ay0, ax1, ay1 };
  }
  const famL = t => spec.fam(fr.grp[t]) || 'ESTRUCTURA';
  const drawFrame = (T, layerOf, U, k) => fr.el.forEach(([i, j], t) => { const L = layerOf(t); if (!L) return; const P = q => [T.X(fr.nodes[q][0] + (U ? k * U[3 * q] : 0)), T.Y(fr.nodes[q][1] + (U ? k * U[3 * q + 1] : 0))]; const a = P(i), b = P(j); D.line(L, a[0], a[1], b[0], b[1]); });
  const fixedSym = (T) => { for (let q = 0; q < N; q++) if (fr.fx[3 * q] && fr.fx[3 * q + 1]) { const x = T.X(fr.nodes[q][0]), y = T.Y(fr.nodes[q][1]), w = T.mm(3); D.line('APOYOS', x - w, y, x + w, y); for (let h = -2; h <= 2; h++) D.line('APOYOS', x + h * w / 2.5, y, x + h * w / 2.5 - w / 2.5, y - w / 2.5); } };
  const ejes = (T, ytop, ybot) => (spec.apoyos || []).forEach(a => { const x = T.X(a.s), r = T.mm(3.2); D.line('EJES', x, ybot, x, ytop); D.circle('EJES', x, ytop + r, r); D.text('TEXTO', x, ytop + r - T.mm(1.2), T.mm(2.6), a.label, 'c'); });
  const cotas = (T, y) => { (spec.luces || []).forEach(c => { const a = T.X(c.a), b = T.X(c.b), t = T.mm(1.5); D.line('COTAS', a, y, b, y); [a, b].forEach(v => D.line('COTAS', v - t, y - t, v + t, y + t)); D.text('COTAS', (a + b) / 2, y + T.mm(1.2), T.mm(2.5), c.txt, 'c'); }); };
  const escalaGraf = (T) => { const step = [1, 2, 5, 10, 20, 50].find(v => v * 4 * 1000 / T.S >= 30) || 50, x = T.ax0, y = T.ay0 - T.mm(8); for (let k = 0; k < 4; k++) D.rect('TEXTO', x + k * step, y, x + (k + 1) * step, y + T.mm(1.2)); [0, 2, 4].forEach(k => D.text('TEXTO', x + k * step, y - T.mm(3.5), T.mm(2), (k * step) + (k === 4 ? ' m' : ''), 'c')); };
  const leyenda = (T, items) => items.forEach(([L, txt], k) => { const x = T.ax0, y = T.ay0 - T.mm(18) - k * T.mm(4.2); D.line(L, x, y + T.mm(.8), x + T.mm(8), y + T.mm(.8)); D.text('TEXTO', x + T.mm(10), y, T.mm(2.2), txt); });
  const zTop = z1 + 1, base = (T) => { fixedSym(T); if (spec.nivel) { D.line('NIVEL', T.X(s0 - 3), T.Y(spec.nivel.z), T.X(s1 + 3), T.Y(spec.nivel.z)); D.text('TEXTO', T.X(s0 - 3), T.Y(spec.nivel.z) + T.mm(1), T.mm(2), spec.nivel.txt); } };
  // P-01 elevación general
  { const T = sheet('P-01', 'Elevación general del modelo', Lb + 8, Hb + 10); drawFrame(T, famL); base(T); ejes(T, T.Y(zTop) + T.mm(6), T.Y(z0) - T.mm(8)); cotas(T, T.Y(z0) - T.mm(12));
    (spec.notas || []).forEach(o => D.text('TEXTO', T.X(o.s), T.Y(o.z), T.mm(2.2), o.txt, 'c'));
    escalaGraf(T); leyenda(T, [['ARCOS', 'Arcos / cordones'], ['TABLERO', 'Tablero'], ['MONTANTES', 'Montantes / diagonales'], ['PILARES', 'Pilares y estribos'], ['EJES', 'Ejes de apoyo']]);
    D.text('TEXTO', T.ax0 + T.mm(70), T.ay0 - T.mm(18), T.mm(2.2), spec.fuente || ''); }
  // P-02 levantamiento con la nube
  if (spec.nube) { const T = sheet('P-02', 'Levantamiento TLS y geometría ajustada', Lb + 8, Hb + 10); D.layer('NUBE', 8).layer('INTRADOS', 1).layer('ESTRUCTURA_REF', 8, 'DASHED');
    const C = spec.nube; for (let i = 0; i < C.s.length; i++) if (C.s[i] > s0 - 4 && C.s[i] < s1 + 4) D.point('NUBE', T.X(C.s[i]), T.Y(C.z[i]));
    drawFrame(T, () => 'ESTRUCTURA_REF'); (spec.intrados || []).forEach(o => { D.poly('INTRADOS', o.pts.map(p => [T.X(p[0]), T.Y(p[1])])); const m = o.pts[o.pts.length >> 1]; D.text('TEXTO', T.X(m[0]), T.Y(m[1]) - T.mm(7), T.mm(2), o.txt, 'c'); });
    ejes(T, T.Y(zTop) + T.mm(6), T.Y(z0) - T.mm(8)); cotas(T, T.Y(z0) - T.mm(12)); escalaGraf(T);
    leyenda(T, [['NUBE', `Nube de puntos TLS (${C.s.length.toLocaleString('es-PE')} puntos de muestra)`], ['INTRADOS', 'Intradós ajustado (parábola robusta)'], ['ESTRUCTURA_REF', 'Modelo de cálculo']]); }
  // P-03 formas modales (hasta 3, apiladas)
  if (spec.modos && spec.modos.length) { const M = spec.modos.slice(0, 3), gap = Hb + 6, T = sheet('P-03', 'Formas modales', Lb + 8, M.length * gap + 4, { cz: z0 + Hb / 2 - (M.length - 1) * gap / 2 }); D.layer('MODO', 1);
    M.forEach((m, k) => { const off = -k * gap, TT = { ...T, Y: z => T.Y(z + off) }; let mx = 0; for (let q = 0; q < N; q++) mx = Math.max(mx, Math.hypot(m.phi[3 * q], m.phi[3 * q + 1])); const amp = mx ? Math.min(2.5, Lb / 30) / mx : 0;
      drawFrame(TT, () => 'ESTRUCTURA_REF'); drawFrame(TT, () => 'MODO', m.phi, amp); fixedSym(TT);
      D.text('TEXTO', TT.X(s0) - T.mm(4), TT.Y(z1) + T.mm(3), T.mm(3), `Modo ${k + 1} · f = ${m.f.toFixed(3).replace('.', ',')} Hz · T = ${(1 / m.f).toFixed(4).replace('.', ',')} s${m.partZ != null ? ' · participación vertical ' + (100 * m.partZ).toFixed(1).replace('.', ',') + ' %' : ''}`); });
    D.layer('ESTRUCTURA_REF', 8, 'DASHED'); leyenda(T, [['MODO', 'Forma modal (amplitud arbitraria, normalizada para dibujo)'], ['ESTRUCTURA_REF', 'Geometría sin deformar']]); }
  // P-04 plan de inspección
  if (spec.prioridad) { const T = sheet('P-04', 'Plan de verificación en campo', Lb + 8, Hb + 10); D.layer('PRIORIDAD_ALTA', 1).layer('PRIORIDAD_MEDIA', 30).layer('PRIORIDAD_BAJA', 8).layer('SENSORES', 5);
    drawFrame(T, t => { const p = spec.prioridad(t); return p ? 'PRIORIDAD_' + p.toUpperCase() : famL(t); }); base(T); ejes(T, T.Y(zTop) + T.mm(6), T.Y(z0) - T.mm(8));
    (spec.sensores || []).forEach(o => { const x = T.X(o.s), y = T.Y(o.z) + T.mm(1.5), w = T.mm(2); D.poly('SENSORES', [[x, y], [x - w, y + 1.7 * w], [x + w, y + 1.7 * w]], true); D.text('SENSORES', x, y + 2.1 * w, T.mm(2), o.label, 'c'); });
    leyenda(T, [['PRIORIDAD_ALTA', 'Prioridad alta (índice ≥ 0,60)'], ['PRIORIDAD_MEDIA', 'Prioridad media (0,40–0,60)'], ['PRIORIDAD_BAJA', 'Prioridad baja (< 0,40)'], ['SENSORES', 'Puntos de medición de vibración S1–S' + (spec.sensores || []).length]]);
    (spec.orden || []).slice(0, 8).forEach((s, k) => D.text('TEXTO', T.ax0 + T.mm(100), T.ay0 - T.mm(18) - k * T.mm(3.6), T.mm(2.1), s));
    D.text('TEXTO', T.ax0 + T.mm(100), T.ay0 - T.mm(13), T.mm(2.3), 'ORDEN DE VERIFICACIÓN (no es una evaluación de seguridad)'); }
  return { bytes: D.bytes(sheets[0] ? sheets[0].S / 100 : 1), sheets, entities: D.count() };
}

/* ======================= Vibración medida: espectros y FDD ======================= */
function fftInPlace(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr; re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } } } }
function detrend(x) { const n = x.length; let sx = 0, sy = 0, sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sx += i; sy += x[i]; sxx += i * i; sxy += i * x[i]; } const b = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1), a = (sy - b * sx) / n; return Float64Array.from(x, (v, i) => v - a - b * i); }
// Matriz de densidad espectral cruzada (Welch, ventana de Hann, 50 % de traslape). chans: [Float64Array], misma longitud.
function csdMatrix(chans, fs, nfft) { const nc = chans.length, n = chans[0].length; nfft = Math.min(nfft, 1 << Math.floor(Math.log2(n))); const step = nfft >> 1, nb = (nfft >> 1) + 1, w = new Float64Array(nfft);
  let U = 0; for (let i = 0; i < nfft; i++) { w[i] = .5 - .5 * Math.cos(2 * Math.PI * i / (nfft - 1)); U += w[i] * w[i]; }
  const Gr = new Float64Array(nb * nc * nc), Gi = new Float64Array(nb * nc * nc); let segs = 0; const X = chans.map(() => [new Float64Array(nfft), new Float64Array(nfft)]), D = chans.map(detrend);
  for (let s = 0; s + nfft <= n; s += step) { segs++; for (let c = 0; c < nc; c++) { const [re, im] = X[c]; for (let i = 0; i < nfft; i++) { re[i] = D[c][s + i] * w[i]; im[i] = 0; } fftInPlace(re, im); }
    for (let k = 0; k < nb; k++) for (let a = 0; a < nc; a++) for (let b = 0; b < nc; b++) { const ar = X[a][0][k], ai = X[a][1][k], br = X[b][0][k], bi = X[b][1][k], o = (k * nc + a) * nc + b; Gr[o] += ar * br + ai * bi; Gi[o] += ai * br - ar * bi; } }
  const sc = 2 / (fs * U * Math.max(1, segs)); for (let i = 0; i < Gr.length; i++) { Gr[i] *= sc; Gi[i] *= sc; }
  return { f: Float64Array.from({ length: nb }, (_, k) => k * fs / nfft), Gr, Gi, nc, nb, df: fs / nfft, segs, nfft };
}
// FDD: mayor valor singular y su vector en cada frecuencia (matriz hermítica, iteración de potencia compleja)
function fdd(C) { const { nc, nb, Gr, Gi } = C, s1 = new Float64Array(nb), s2 = new Float64Array(nb), V = [[], []];
  const power = (k, defl) => { let xr = new Float64Array(nc).fill(1), xi = new Float64Array(nc); xr[0] = 1.3; let lam = 0;
    for (let it = 0; it < 80; it++) { const yr = new Float64Array(nc), yi = new Float64Array(nc);
      for (let a = 0; a < nc; a++) for (let b = 0; b < nc; b++) { const o = (k * nc + a) * nc + b; let gr = Gr[o], gi = Gi[o];
        if (defl) { const [l1, ur, ui] = defl; gr -= l1 * (ur[a] * ur[b] + ui[a] * ui[b]); gi -= l1 * (ui[a] * ur[b] - ur[a] * ui[b]); }
        yr[a] += gr * xr[b] - gi * xi[b]; yi[a] += gr * xi[b] + gi * xr[b]; }
      let nrm = 0; for (let a = 0; a < nc; a++) nrm += yr[a] * yr[a] + yi[a] * yi[a]; nrm = Math.sqrt(nrm) || 1e-300; for (let a = 0; a < nc; a++) { yr[a] /= nrm; yi[a] /= nrm; }
      xr = yr; xi = yi; if (Math.abs(nrm - lam) <= 1e-10 * nrm) { lam = nrm; break; } lam = nrm; } return [lam, xr, xi]; };
  for (let k = 0; k < nb; k++) { const a = power(k, null); s1[k] = a[0]; V[0].push(a); if (nc > 1) { const b = power(k, a); s2[k] = b[0]; V[1].push(b); } }
  const shapeOf = (k, j = 0) => { const [, r, i] = V[j][k]; let m = 0, ang = 0; for (let a = 0; a < nc; a++) { const mag = Math.hypot(r[a], i[a]); if (mag > m) { m = mag; ang = Math.atan2(i[a], r[a]); } }
    const c = Math.cos(-ang), sn = Math.sin(-ang), out = Array.from({ length: nc }, (_, a) => r[a] * c - i[a] * sn), mx = Math.max(...out.map(Math.abs)) || 1; return out.map(v => v / mx); };
  return { f: C.f, s1, s2, shape: shapeOf, vec: (k, j = 0) => V[j][k] ? [V[j][k][1], V[j][k][2]] : null, nfft: C.nfft, df: C.df };
}
// EFDD: campana del modo (bins vecinos con MAC ≥ umbral respecto al vector del pico) → autocorrelación por IFFT
// → frecuencia por cruces por cero y amortiguamiento por decremento logarítmico (Brincker et al.)
function efdd(D, p, { macThr = .9, hi = .85, lo = .25 } = {}) { const j = p.sv - 1, sv = j ? D.s2 : D.s1, [ur, ui] = D.vec(p.k, j), nb = sv.length, N = D.nfft || 2 * (nb - 1);
  const macC = k => { if (!D.vec(k, j)) return 0; const [vr, vi] = D.vec(k, j); let a = 0, b = 0, c = 0, d = 0; for (let q = 0; q < ur.length; q++) { a += ur[q] * vr[q] + ui[q] * vi[q]; b += ur[q] * vi[q] - ui[q] * vr[q]; c += ur[q] ** 2 + ui[q] ** 2; d += vr[q] ** 2 + vi[q] ** 2; } return (a * a + b * b) / (c * d || 1); };
  const bell = new Float64Array(nb); let k0 = p.k, k1 = p.k; bell[p.k] = sv[p.k];
  while (k0 > 1 && macC(k0 - 1) >= macThr) { k0--; bell[k0] = sv[k0]; } while (k1 < nb - 2 && macC(k1 + 1) >= macThr) { k1++; bell[k1] = sv[k1]; }
  if (k1 - k0 < 4) return null;
  const re = new Float64Array(N), im = new Float64Array(N); for (let k = 0; k < nb; k++) { re[k] = bell[k]; if (k && k < N - k) re[N - k] = bell[k]; } fftInPlace(re, im); // espectro real y par → autocorrelación (salvo escala)
  const R = Array.from(re.slice(0, N >> 1)), r0 = R[0] || 1, dt = 1 / (N * (D.df || (D.f[1] - D.f[0])));
  const ext = []; for (let i = 1; i < R.length - 1; i++) if ((R[i] > R[i - 1] && R[i] >= R[i + 1]) || (R[i] < R[i - 1] && R[i] <= R[i + 1])) ext.push([i, Math.abs(R[i] / r0)]);
  const use = ext.filter(([, v]) => v <= hi && v >= lo); if (use.length < 4) return null;
  const zc = []; for (let i = use[0][0]; i < use[use.length - 1][0]; i++) if (R[i] * R[i + 1] < 0) zc.push(i + R[i] / (R[i] - R[i + 1]));
  if (zc.length < 3) return null; let sx = 0, sy = 0, sxx = 0, sxy = 0; zc.forEach((t, n) => { sx += n; sy += t; sxx += n * n; sxy += n * t; }); const m = zc.length, half = (m * sxy - sx * sy) / (m * sxx - sx * sx) * dt, fd = 1 / (2 * half);
  let ax = 0, ay = 0, axx = 0, axy = 0; use.forEach(([, v], n) => { const y = Math.log(v); ax += n; ay += y; axx += n * n; axy += n * y; }); const u = use.length, slope = (u * axy - ax * ay) / (u * axx - ax * ax), delta = -2 * slope, zeta = delta / Math.sqrt(4 * Math.PI ** 2 + delta ** 2);
  return { f: fd / Math.sqrt(1 - zeta * zeta), zeta, bins: k1 - k0 + 1 }; }
// Modos identificados con FDD/EFDD: picos de s1 y, para modos cercanos, picos de s2 que no repiten una forma ya encontrada; luego EFDD refina f y ζ y une picos duplicados
function fddModes(D, opt = {}) { const mac = (u, v) => { let a = 0, b = 0, c = 0; for (let i = 0; i < u.length; i++) { a += u[i] * v[i]; b += u[i] * u[i]; c += v[i] * v[i]; } return a * a / (b * c || 1); };
  const top = Math.max(...Array.from(D.s1).map((v, k) => D.f[k] >= (opt.fmin || .5) && D.f[k] <= (opt.fmax || Infinity) ? v : 0)), floor = top * Math.pow(10, -(opt.rangeDb || 12) / 10);
  const P1 = pickPeaks(D.f, D.s1, opt).filter(p => D.s1[p.k] >= floor).map(p => ({ ...p, sv: 1, shape: D.shape(p.k, 0) }));
  const P2 = D.s2 && D.s2.some(v => v > 0) ? pickPeaks(D.f, D.s2, opt).filter(p => D.s2[p.k] >= floor).map(p => ({ ...p, sv: 2, shape: D.shape(p.k, 1) })) : [];
  const near = opt.closeHz || .06, df = D.f[1] - D.f[0], out = P1.slice(0, opt.n || 8);
  P2.forEach(p => { const q = out.filter(q => q.sv === 1).sort((a, b) => Math.abs(a.f - p.f) - Math.abs(b.f - p.f))[0];
    if (q && Math.abs(q.f - p.f) <= near && Math.abs(q.f - p.f) >= 1.5 * df && mac(q.shape, p.shape) < .8) out.push({ ...p, cercano: +q.f.toFixed(3) }); });
  if (opt.efdd !== false && D.vec) out.forEach(p => { const e = efdd(D, p); if (e && Math.abs(e.f - p.f) < 5 * df + .02 * p.f) { p.fFdd = p.f; p.f = e.f; p.zeta = e.zeta; p.efdd = e.bins; } });
  // picos del mismo modo (espectro dividido por la varianza): misma forma y frecuencias EFDD casi iguales → se queda el más alto
  out.sort((a, b) => (b.sv === 1 ? D.s1 : D.s2)[b.k] - (a.sv === 1 ? D.s1 : D.s2)[a.k]); const fin = [];
  out.forEach(p => { if (!fin.some(q => mac(q.shape, p.shape) > .9 && Math.abs(q.f - p.f) < Math.max(3 * df, .004 * p.f))) fin.push(p); });
  return fin.sort((a, b) => a.f - b.f); }
// Picos del espectro (prominencia en dB) y amortiguamiento por ancho de banda de media potencia
function pickPeaks(f, s, { fmin = .5, fmax = Infinity, n = 8, promDb = 3 } = {}) {
  const L = Array.from(s, v => 10 * Math.log10(v + 1e-300)), out = [];
  for (let k = 2; k < L.length - 2; k++) { if (f[k] < fmin || f[k] > fmax) continue; if (!(L[k] > L[k - 1] && L[k] >= L[k + 1])) continue;
    let lo = L[k], hi = L[k]; for (let j = k - 1; j >= 0 && L[j] <= L[k]; j--) lo = Math.min(lo, L[j]); let lo2 = L[k]; for (let j = k + 1; j < L.length && L[j] <= L[k]; j++) lo2 = Math.min(lo2, L[j]);
    const prom = L[k] - Math.max(lo, lo2); if (prom >= promDb) out.push({ k, f: f[k], db: L[k], prom }); }
  out.sort((a, b) => b.prom - a.prom); const sel = out.slice(0, n).sort((a, b) => a.f - b.f);
  sel.forEach(p => { // refinamiento parabólico y media potencia
    const k = p.k, a = L[k - 1], b = L[k], c = L[k + 1], d = (a - c) / (2 * (a - 2 * b + c) || 1), df = f[1] - f[0]; p.f = f[k] + d * df;
    const half = s[k] / 2; let i = k; while (i > 0 && s[i] > half) i--; let j = k; while (j < s.length - 1 && s[j] > half) j++;
    const fi = f[i] + (half - s[i]) / ((s[i + 1] - s[i]) || 1) * df, fj = f[j - 1] + (s[j - 1] - half) / ((s[j - 1] - s[j]) || 1) * df; p.zeta = (fj - fi) / (2 * p.f); p.zetaBins = j - i; });
  return sel;
}

/* ======================= Análisis estático, líneas de influencia y HL-93 ======================= */
function staticPrep(fr) { // K en banda, factorizada; resuelve K u = F para muchos F
  const N = fr.nodes.length, nd = 3 * N, order = Array.from({ length: N }, (_, i) => i).sort((i, j) => fr.nodes[i][0] - fr.nodes[j][0] || fr.nodes[i][1] - fr.nodes[j][1]);
  const pos = new Int32Array(nd).fill(-1), free = []; order.forEach(i => { for (let d = 0; d < 3; d++) if (!fr.fx[3 * i + d]) { pos[3 * i + d] = free.length; free.push(3 * i + d); } });
  const nf = free.length; let hb = 0; const kl = [];
  fr.el.forEach(([i1, i2], j) => { const d = [3 * i1, 3 * i1 + 1, 3 * i1 + 2, 3 * i2, 3 * i2 + 1, 3 * i2 + 2].map(x => pos[x]).filter(x => x >= 0); for (const a of d) for (const b of d) hb = Math.max(hb, a - b); });
  const W = hb + 1, L = new Float64Array(nf * W);
  fr.el.forEach(([i1, i2], j) => { const dx = fr.nodes[i2][0] - fr.nodes[i1][0], dz = fr.nodes[i2][1] - fr.nodes[i1][1], Le = Math.hypot(dx, dz), c = dx / Le, s = dz / Le, EA = fr.E[j] * fr.A[j] / Le, EI = fr.E[j] * fr.I[j];
    const k = [[EA, 0, 0, -EA, 0, 0], [0, 12 * EI / Le ** 3, 6 * EI / Le ** 2, 0, -12 * EI / Le ** 3, 6 * EI / Le ** 2], [0, 6 * EI / Le ** 2, 4 * EI / Le, 0, -6 * EI / Le ** 2, 2 * EI / Le], [-EA, 0, 0, EA, 0, 0], [0, -12 * EI / Le ** 3, -6 * EI / Le ** 2, 0, 12 * EI / Le ** 3, -6 * EI / Le ** 2], [0, 6 * EI / Le ** 2, 2 * EI / Le, 0, -6 * EI / Le ** 2, 4 * EI / Le]];
    const T = [[c, s, 0, 0, 0, 0], [-s, c, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0], [0, 0, 0, c, s, 0], [0, 0, 0, -s, c, 0], [0, 0, 0, 0, 0, 1]], dd = [3 * i1, 3 * i1 + 1, 3 * i1 + 2, 3 * i2, 3 * i2 + 1, 3 * i2 + 2]; kl.push({ k, T, dd, Le });
    for (let a = 0; a < 6; a++) { const pa = pos[dd[a]]; if (pa < 0) continue; for (let b = 0; b < 6; b++) { const pb = pos[dd[b]]; if (pb < 0 || pb > pa) continue; let v = 0; for (let u = 0; u < 6; u++) { if (!T[u][a]) continue; for (let w = 0; w < 6; w++) if (T[w][b]) v += T[u][a] * k[u][w] * T[w][b]; } L[pa * W + (pa - pb)] += v; } } });
  for (let j = 0; j < nf; j++) { let s = L[j * W]; for (let k = Math.max(0, j - hb); k < j; k++) { const v = L[j * W + (j - k)]; s -= v * v; } if (s <= 0) throw new Error('El modelo es inestable: revise apoyos y conexiones.'); s = Math.sqrt(s); L[j * W] = s;
    for (let i = j + 1; i <= Math.min(nf - 1, j + hb); i++) { let t = L[i * W + (i - j)]; for (let k = Math.max(0, i - hb); k < j; k++) t -= L[i * W + (i - k)] * L[j * W + (j - k)]; L[i * W + (i - j)] = t / s; } }
  const solve = Ffull => { const y = new Float64Array(nf); for (let i = 0; i < nf; i++) { let s = Ffull[free[i]]; for (let k = Math.max(0, i - hb); k < i; k++) s -= L[i * W + (i - k)] * y[k]; y[i] = s / L[i * W]; }
    const z = new Float64Array(nf); for (let i = nf - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k <= Math.min(nf - 1, i + hb); k++) s -= L[k * W + (k - i)] * z[k]; z[i] = s / L[i * W]; } const U = new Float64Array(nd); free.forEach((g, a) => U[g] = z[a]); return U; };
  // fuerzas en extremos (locales): [N_i, V_i, M_i, N_j, V_j, M_j]
  const forces = U => kl.map(({ k, T, dd }) => { const ul = [0, 0, 0, 0, 0, 0]; for (let a = 0; a < 6; a++) { let v = 0; for (let b = 0; b < 6; b++) v += T[a][b] * U[dd[b]]; ul[a] = v; } return k.map(row => row.reduce((s, x, b) => s + x * ul[b], 0)); });
  return { solve, forces, nd, N };
}
// Esfuerzos normales en fibras extremas (MPa, tracción +): por elemento [sup_i, inf_i, sup_j, inf_j]. c(t): distancia a fibra extrema (m).
function fiberStress(fr, f, c) { return f.map((q, t) => { const A = fr.A[t], I = fr.I[t], ct = c(t), Ni = -q[0], Nj = q[3], Mi = -q[2], Mj = q[5];
  return [(Ni / A - Mi * ct / I) / 1000, (Ni / A + Mi * ct / I) / 1000, (Nj / A - Mj * ct / I) / 1000, (Nj / A + Mj * ct / I) / 1000]; }); }
// Líneas de influencia de los esfuerzos de fibra y de las flechas del tablero (carga unitaria de 1 kN hacia abajo en cada nudo del tablero)
function influence(fr, c) { const S = staticPrep(fr), dn = fr.deckNodes.slice().sort((a, b) => a.s - b.s), ne = fr.el.length;
  const IL = Array.from({ length: ne }, () => [0, 1, 2, 3].map(() => new Float64Array(dn.length))), DEF = dn.map(() => new Float64Array(dn.length));
  dn.forEach((p, k) => { const F = new Float64Array(S.nd); F[3 * p.node + 1] = -1; const U = S.solve(F), st = fiberStress(fr, S.forces(U), c); st.forEach((v, t) => v.forEach((x, q) => IL[t][q][k] = x)); dn.forEach((m, j) => DEF[j][k] = U[3 * m.node + 1]); });
  // carga permanente: peso propio (masas del modelo × g) y carga adicional DW opcional sobre el tablero
  const Fd = new Float64Array(S.nd); for (let i = 0; i < S.N; i++) Fd[3 * i + 1] = -fr.mass[i] * 9.81; const Ud = S.solve(Fd), DC = fiberStress(fr, S.forces(Ud), c);
  return { s: dn.map(p => p.s), nodes: dn.map(p => p.node), IL, DEF, DC, Udc: Ud, S }; }
const HL93 = { truck: [35, 145, 145], gap1: 4.3, gap2: [4.3, 9.0], tandem: [110, 110], tgap: 1.2, lane: 9.3, IM: .33, m: [1.2, 1.0, .85, .65] };
function ilAt(s, y, x) { if (x < s[0] || x > s[s.length - 1]) return 0; let lo = 0, hi = s.length - 1; while (hi - lo > 1) { const md = (lo + hi) >> 1; if (s[md] <= x) lo = md; else hi = md; } const w = (x - s[lo]) / ((s[hi] - s[lo]) || 1); return y[lo] + w * (y[hi] - y[lo]); }
// Efecto extremo de HL-93 por carril sobre una línea de influencia (y en unidades del efecto por kN)
function hl93Extremes(s, y, step = .25) { const x0 = s[0] - 20, x1 = s[s.length - 1] + 20; let tMax = 0, tMin = 0;
  const axleSets = []; for (let g = HL93.gap2[0]; g <= HL93.gap2[1] + 1e-9; g += .35) axleSets.push({ P: HL93.truck, d: [0, HL93.gap1, HL93.gap1 + g] }); axleSets.push({ P: HL93.tandem, d: [0, HL93.tgap] });
  for (const A of axleSets) for (const dir of [1, -1]) for (let x = x0; x <= x1; x += step) { let v = 0; for (let a = 0; a < A.P.length; a++) v += A.P[a] * ilAt(s, y, x + dir * A.d[a]); if (v > tMax) tMax = v; if (v < tMin) tMin = v; }
  let lp = 0, ln = 0; for (let i = 0; i < s.length - 1; i++) { const a = y[i], b = y[i + 1], h = s[i + 1] - s[i]; if (a >= 0 && b >= 0) lp += (a + b) / 2 * h; else if (a <= 0 && b <= 0) ln += (a + b) / 2 * h; else { const xz = a / (a - b) * h; if (a > 0) { lp += a * xz / 2; ln += b * (h - xz) / 2; } else { ln += a * xz / 2; lp += b * (h - xz) / 2; } } }
  return { max: tMax * (1 + HL93.IM) + HL93.lane * lp, min: tMin * (1 + HL93.IM) + HL93.lane * ln, truckMax: tMax, truckMin: tMin, laneP: lp, laneN: ln }; }
// Envolventes HL-93 de todos los esfuerzos de fibra, combinaciones y factores de capacidad (LRFR, por esfuerzos)
function liveLoad(fr, c, opts) { const I = influence(fr, c), nl = Math.max(1, opts.lanes | 0), mp = HL93.m[Math.min(3, nl - 1)], k = nl * mp;
  const dwF = opts.dw || 0; let DW = null; if (dwF > 0) { const F = new Float64Array(I.S.nd), d = I.nodes; I.s.forEach((x, i) => { const L = (i ? (x - I.s[i - 1]) / 2 : 0) + (i < I.s.length - 1 ? (I.s[i + 1] - x) / 2 : 0); F[3 * d[i] + 1] = -dwF * L; }); DW = fiberStress(fr, I.S.forces(I.S.solve(F)), c); }
  const el = fr.el.map((_, t) => { const q = [0, 1, 2, 3].map(j => { const e = hl93Extremes(I.s, I.IL[t][j]), dc = I.DC[t][j], dw = DW ? DW[t][j] : 0;
      return { llMax: e.max * k, llMin: e.min * k, dc, dw }; });
    const cap = opts.cap ? opts.cap(t) : null; let rfInv = null, rfOp = null, gov = null;
    if (cap) for (const o of q) for (const [gLL, key] of [[1.75, 'inv'], [1.35, 'op']]) { const pc = (cap.phi || 1);
      if (o.llMax > 1e-9 && cap.ft > 0) { const r = (pc * cap.ft - (1.25 * o.dc + 1.5 * o.dw)) / (gLL * o.llMax); if (key === 'inv') { if (rfInv == null || r < rfInv) { rfInv = r; gov = 'tracción'; } } else if (rfOp == null || r < rfOp) rfOp = r; }
      if (o.llMin < -1e-9 && cap.fc > 0) { const r = (pc * cap.fc + (1.25 * o.dc + 1.5 * o.dw)) / (-gLL * o.llMin); if (key === 'inv') { if (rfInv == null || r < rfInv) { rfInv = r; gov = 'compresión'; } } else if (rfOp == null || r < rfOp) rfOp = r; } }
    const sMax = Math.max(...q.map(o => 1.25 * o.dc + 1.5 * o.dw + 1.75 * o.llMax)), sMin = Math.min(...q.map(o => 1.25 * o.dc + 1.5 * o.dw + 1.75 * o.llMin));
    const serMax = Math.max(...q.map(o => o.dc + o.dw + o.llMax)), serMin = Math.min(...q.map(o => o.dc + o.dw + o.llMin)), llMax = Math.max(...q.map(o => o.llMax)), llMin = Math.min(...q.map(o => o.llMin));
    return { q, sMax, sMin, serMax, serMin, llMax, llMin, rfInv, rfOp, gov }; });
  // flecha máxima por carga viva (con IM) en cada nudo del tablero
  const defl = I.DEF.map(y => { const e = hl93Extremes(I.s, y); return Math.min(0, e.min) * k; });
  return { el, s: I.s, defl, nl, mp, IL: I.IL, DEF: I.DEF, dcDef: I.nodes.map(n => I.Udc[3 * n + 1]) }; }

/* ======================= Campaña de mediciones: modos persistentes y efecto de la temperatura ======================= */
// win: [{ peaks: [{f, zeta}], T (°C o null), id }]. Un modo real aparece en la mayoría de los registros en la misma banda;
// los picos de ruido (máquinas, perturbaciones) aparecen y desaparecen. Se agrupan picos de todos los registros por cercanía de frecuencia.
function peakCampaign(win, { minPres = .5, tolRel = .02, tolAbs = .08, T0 = null } = {}) {
  const all = []; win.forEach((w, wi) => (w.peaks || []).forEach(p => all.push({ ...p, wi })) ); all.sort((a, b) => a.f - b.f);
  const tol = f => Math.max(tolAbs, tolRel * f), groups = [];
  all.forEach(p => { const g = groups[groups.length - 1]; if (g && p.f - g.ref <= tol(g.ref)) { g.items.push(p); g.ref = median(g.items.map(q => q.f)); } else groups.push({ items: [p], ref: p.f }); });
  const nW = win.length, Ts = win.map(w => w.T).filter(v => v != null && isFinite(v)), Tref = T0 != null ? T0 : (Ts.length ? median(Ts) : null);
  const out = groups.map(g => { const m = median(g.items.map(q => q.f)), by = {};
      g.items.forEach(q => { if (!by[q.wi] || Math.abs(q.f - m) < Math.abs(by[q.wi].f - m)) by[q.wi] = q; });
      const pts = Object.values(by).sort((a, b) => a.wi - b.wi), fs = pts.map(q => q.f), z = pts.map(q => q.zeta).filter(v => v > 0 && v < .2);
      const c = { f: median(fs), q1: quantile(fs, .25), q3: quantile(fs, .75), n: pts.length, pres: pts.length / nW, zeta: z.length ? median(z) : null, pts: pts.map(q => ({ wi: q.wi, f: q.f, T: win[q.wi].T })) };
      const tp = c.pts.filter(q => q.T != null && isFinite(q.T));
      if (tp.length >= 3) { const mt = tp.reduce((a, q) => a + q.T, 0) / tp.length, mf = tp.reduce((a, q) => a + q.f, 0) / tp.length; let sxy = 0, sxx = 0, syy = 0; tp.forEach(q => { sxy += (q.T - mt) * (q.f - mf); sxx += (q.T - mt) ** 2; syy += (q.f - mf) ** 2; });
        const b = sxx > 1e-9 ? sxy / sxx : 0; c.slope = b; c.r2 = sxx > 1e-9 && syy > 0 ? sxy * sxy / (sxx * syy) : 0; c.Tref = Tref; c.fComp = c.pts.map(q => q.T != null ? q.f - b * (q.T - Tref) : null);
        const fc = c.fComp.filter(v => v != null); c.fRef = median(fc); c.sdRaw = Math.sqrt(fs.reduce((a, v) => a + (v - c.f) ** 2, 0) / fs.length); c.sdComp = Math.sqrt(fc.reduce((a, v) => a + (v - c.fRef) ** 2, 0) / fc.length); }
      return c; });
  return { modes: out.filter(c => c.pres >= minPres).sort((a, b) => a.f - b.f), all: out.sort((a, b) => a.f - b.f), nW, Tref }; }
// Promedio de matrices espectrales de varios registros (mismos canales y resolución): reduce el ruido aleatorio del espectro
function csdAverage(list) { const C0 = list[0], Gr = new Float64Array(C0.Gr.length), Gi = new Float64Array(C0.Gi.length); let segs = 0;
  list.forEach(C => { if (C.Gr.length !== Gr.length) throw new Error('Los registros deben tener los mismos canales y la misma resolución.'); for (let i = 0; i < Gr.length; i++) { Gr[i] += C.Gr[i] * C.segs; Gi[i] += C.Gi[i] * C.segs; } segs += C.segs; });
  for (let i = 0; i < Gr.length; i++) { Gr[i] /= segs; Gi[i] /= segs; } return { ...C0, Gr, Gi, segs }; }

/* ======================= Calibración del modelo con mediciones (actualización de modelo) ======================= */
// Nelder-Mead acotado sobre parámetros normalizados a [0, 1]
function nelderMead(fun, x0, { iters = 160, step = .15, tol = 1e-7 } = {}) { const n = x0.length, cl = x => x.map(v => Math.min(1, Math.max(0, v))), F = x => fun(cl(x));
  let S = [x0.slice()]; for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] = x[i] + (x[i] + step <= 1 ? step : -step); S.push(x); } let V = S.map(F), it = 0;
  for (; it < iters; it++) { const o = V.map((v, i) => i).sort((a, b) => V[a] - V[b]); S = o.map(i => S[i]); V = o.map(i => V[i]); if (Math.abs(V[n] - V[0]) < tol) break;
    const c = new Array(n).fill(0); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += S[i][j] / n; const P = (t) => c.map((v, j) => v + t * (S[n][j] - v));
    const xr = P(-1), fr = F(xr); if (fr < V[0]) { const xe = P(-2), fe = F(xe); if (fe < fr) { S[n] = xe; V[n] = fe; } else { S[n] = xr; V[n] = fr; } }
    else if (fr < V[n - 1]) { S[n] = xr; V[n] = fr; } else { const xc = fr < V[n] ? P(-.5) : P(.5), fc = F(xc); if (fc < Math.min(fr, V[n])) { S[n] = xc; V[n] = fc; } else { for (let i = 1; i <= n; i++) { S[i] = S[i].map((v, j) => S[0][j] + .5 * (v - S[0][j])); V[i] = F(S[i]); } } } }
  const k = V.indexOf(Math.min(...V)); return { x: cl(S[k]), v: V[k], iters: it }; }
// meas: { f: {j: Hz}, sh: {j: [valores en sens]}, sens: [índices de sensor] } con j = índice del modo en el modelo nominal
// params: [{ k, min, max }] sobre P (mismas unidades que P). Objetivo: Σ (f_mod/f_med − 1)² + β Σ (1 − MAC)², emparejando por MAC en los sensores.
function calibrateModel(type, G, P, meas, params, { beta = .05, iters = 160, prog } = {}) {
  const fr0 = build(type, G, P), sensAll = sensorsOf(fr0), sd = (meas.sens || []).map(i => sensAll[i].dof), js = Object.keys(meas.f).map(Number), hasSh = meas.sh && sd.length >= 3;
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }, mac = (a, b) => dot(a, b) ** 2 / (dot(a, a) * dot(b, b) || 1), NM = Math.max(8, Math.max(...js) + 3);
  const P0 = params.map(p => P[p.k]), toX = P0.map((v, i) => (v - params[i].min) / (params[i].max - params[i].min)), toP = x => { const q = Object.assign({}, P); params.forEach((p, i) => q[p.k] = p.min + x[i] * (p.max - p.min)); return q; };
  const evalP = q => { const md = modal(build(type, G, q), NM), used = new Set(), out = {}; let J = 0;
    js.forEach(j => { let best = -1, b = j; for (let k = 0; k < md.f.length; k++) { if (used.has(k)) continue; const m = hasSh ? mac(meas.sh[j], sd.map(d => md.phi[k][d])) : 1, df = Math.abs(md.f[k] / meas.f[j] - 1), sc = (hasSh ? m : 0) - 3 * df; if (sc > best) { best = sc; b = k; } }
      used.add(b); const m = hasSh ? mac(meas.sh[j], sd.map(d => md.phi[b][d])) : null; out[j] = { f: md.f[b], mac: m, k: b }; J += (md.f[b] / meas.f[j] - 1) ** 2 + (hasSh ? beta * (1 - m) ** 2 : 0); });
    return { J, out }; };
  let n = 0; const before = evalP(P), r = nelderMead(x => { n++; if (prog && n % 10 === 0) prog(Math.min(1, n / (iters * 1.6))); return evalP(toP(x)).J; }, toX.map(v => Math.min(1, Math.max(0, v))), { iters });
  const Pc = toP(r.x), after = evalP(Pc), atBound = params.filter((p, i) => r.x[i] < .01 || r.x[i] > .99).map(p => p.k);
  return { P: Pc, params: params.map((p, i) => ({ ...p, v0: P0[i], v: Pc[p.k] })), before, after, evals: n, atBound }; }

/* ======================= Deterioro (Markov) y plan de mantenimiento ======================= */
const CS_WF = [1, 2 / 3, 1 / 3, 0];
const pTrans = t => t > 0 ? 1 - Math.pow(.5, 1 / t) : 0; // probabilidad anual de pasar al estado siguiente; t = años medianos
function markovStep(d, T) { const p = T.map(pTrans), o = d.slice(); for (let k = 0; k < 3; k++) { const m = d[k] * p[k]; o[k] -= m; o[k + 1] += m; } return o; }
const elemHI = d => { const s = d.reduce((a, b) => a + b, 0) || 1; return 100 * d.reduce((a, v, k) => a + v * CS_WF[k], 0) / s; };
function bridgeHI(els) { let w = 0, h = 0; els.forEach(e => { const tot = e.d.reduce((a, b) => a + b, 0); if (!tot) return; w += e.w; h += e.w * elemHI(e.d); }); return w ? h / w : null; }
// Calibra un factor α de los tiempos medianos con la historia de un elemento (≥ 2 inspecciones): mínimos cuadrados por sección áurea
function calibrateAlpha(hist, T) { if (!hist || hist.length < 2) return null; const h = hist.slice().sort((a, b) => a.t - b.t), f = d => { const s = d.reduce((a, b) => a + b, 0) || 1; return d.map(v => v / s); };
  const err = a => { let e = 0; for (let i = 1; i < h.length; i++) { let d = f(h[0].d); const yrs = Math.round(h[i].t - h[0].t); for (let y = 0; y < yrs; y++) d = markovStep(d, T.map(t => t * a)); const o = f(h[i].d); for (let k = 0; k < 4; k++) e += (d[k] - o[k]) ** 2; } return e; };
  let a = .2, b = 5; const g = (Math.sqrt(5) - 1) / 2; let c = b - g * (b - a), d = a + g * (b - a); for (let it = 0; it < 60; it++) { if (err(c) < err(d)) b = d; else a = c; c = b - g * (b - a); d = a + g * (b - a); } return (a + b) / 2; }
// Plan voraz con presupuesto anual: en cada año elige las acciones de mayor beneficio/costo. els: [{id, w, q (cantidad), d (fracciones CS1..4), T, acciones:[{nombre, costo (por unidad afectada), de:[estados], a:0}]}]
function maintenancePlan(els, { years = 20, budget = 0, thr = 60 } = {}) { const S = els.map(e => ({ ...e, d: e.d.slice() })), noAct = els.map(e => ({ ...e, d: e.d.slice() })), plan = [], hi = [], hi0 = []; let total = 0;
  for (let y = 0; y <= years; y++) { hi.push(bridgeHI(S)); hi0.push(bridgeHI(noAct)); if (y === years) break; let rem = budget;
    for (;;) { let best = null; S.forEach((e, i) => (e.acciones || []).forEach(a => { const aff = a.de.reduce((s, k) => s + e.d[k], 0); if (aff < 1e-6) return; const cost = a.costo * aff * e.q; if (cost <= 0 || cost > rem) return;
        const nd = e.d.slice(); a.de.forEach(k => { nd[a.a] += nd[k]; nd[k] = 0; }); const gain = (elemHI(nd) - elemHI(e.d)) * e.w * (years - y), r = gain / cost; if (gain > 1e-9 && (!best || r > best.r)) best = { i, a, nd, cost, r, gain }; }));
      if (!best) break; S[best.i].d = best.nd; rem -= best.cost; total += best.cost; plan.push({ year: y, elem: S[best.i].id, accion: best.a.nombre, costo: best.cost }); }
    S.forEach(e => e.d = markovStep(e.d, e.T)); noAct.forEach(e => e.d = markovStep(e.d, e.T)); }
  const life = arr => { const k = arr.findIndex(v => v != null && v < thr); return k < 0 ? null : k; };
  return { plan, hi, hi0, total, vidaSin: life(hi0), vidaCon: life(hi) }; }

return { fftInPlace, detrend, csdMatrix, fdd, efdd, fddModes, pickPeaks, staticPrep, fiberStress, influence, HL93, hl93Extremes, liveLoad, CS_WF, pTrans, markovStep, elemHI, bridgeHI, calibrateAlpha, maintenancePlan, Dxf, bridgePlans, sensorsOf, readAccel, sdof, spectrum, seismic, freqCampaign, peakCampaign, csdAverage, calibrateModel, nelderMead, trainFreqIA, trainVecIA, trainModalIA, modalFeat, modalMeasFeat, modalMeasFeatBase, freqPredict, build, modal, archAll, parseCloud, orient, bounds, deckLevel, groundLevel, detectSupports, spansOf, envelope, fitParabola, polyval, archGeometry, spanCoverage, MATERIALS,
  build, sensorsOf, modal, signConvention, features, campaign, trainIA, forestPredict, LEVELS, noisy, mulberry, gaussR, quantile, median };
})();
if (typeof module !== 'undefined') module.exports = OPC;
