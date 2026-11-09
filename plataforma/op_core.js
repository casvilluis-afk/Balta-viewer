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
// atributos por punto que se conservan si el archivo los trae (además de x, y, z)
const ATR = ['intensidad', 'rojo', 'verde', 'azul', 'retorno', 'retornos', 'clase'];
class Sampler {
  constructor(max, seed = 12345) { this.max = max; this.n = 0; this.buf = new Float64Array(3 * Math.min(max, 1 << 20)); this.r = mulberry(seed); this.off = null; this.an = null; this.ab = null; }
  // nombres de los atributos presentes (subconjunto de ATR); se llama antes de empujar puntos
  atributos(names) { this.an = names.length ? names : null; if (this.an) this.ab = this.an.map(() => new Float32Array(Math.min(this.max, 1 << 20))); }
  push(x, y, z, a) {
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
    if (!this.off) this.off = [x, y, z].map(v => Math.round(v));
    x -= this.off[0]; y -= this.off[1]; z -= this.off[2];
    let k;
    if (this.n < this.max) { k = this.n; if (3 * k + 3 > this.buf.length) { const b = new Float64Array(Math.min(3 * this.max, this.buf.length * 2)); b.set(this.buf); this.buf = b; }
      if (this.ab && k >= this.ab[0].length) this.ab = this.ab.map(v => { const w = new Float32Array(Math.min(this.max, v.length * 2)); w.set(v); return w; }); }
    else { k = Math.floor(this.r() * (this.n + 1)); if (k >= this.max) { this.n++; return; } }
    this.buf[3 * k] = x; this.buf[3 * k + 1] = y; this.buf[3 * k + 2] = z; if (this.ab && a) for (let j = 0; j < this.ab.length; j++) this.ab[j][k] = a[j]; this.n++;
  }
  result() { const m = Math.min(this.n, this.max), r = { xyz: Float32Array.from(this.buf.subarray(0, 3 * m)), total: this.n, kept: m, offset: this.off || [0, 0, 0] };
    if (this.an) { r.attr = {}; this.an.forEach((nm, j) => r.attr[nm] = this.ab[j].slice(0, m)); } return r; }
}
// subconjunto de una nube (recortes, filtros) conservando los atributos
function subCloud(c, keep, extra = {}) { const m = keep.length, xyz = new Float32Array(3 * m); for (let j = 0; j < m; j++) { const i = keep[j]; xyz[3 * j] = c.xyz[3 * i]; xyz[3 * j + 1] = c.xyz[3 * i + 1]; xyz[3 * j + 2] = c.xyz[3 * i + 2]; }
  const r = Object.assign({ xyz, total: c.total, kept: m, offset: c.offset }, extra); if (c.attr) { r.attr = {}; for (const k in c.attr) { const v = new Float32Array(m); for (let j = 0; j < m; j++) v[j] = c.attr[k][keep[j]]; r.attr[k] = v; } } return r; }
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
    // elementos del PLY: se usa el primero que tenga x, y, z (se llame «vertex», «point» u otro nombre)
    const EL = []; for (const l of hdr.split(/\r?\n/)) { const w = l.trim().split(/\s+/);
      if (w[0] === 'element') EL.push({ name: w[1], n: +w[2], props: [], list: false }); else if (w[0] === 'property' && EL.length) { const e = EL[EL.length - 1]; if (w[1] === 'list') e.list = true; else e.props.push({ t: w[1], n: w[2] }); } }
    const ie = EL.findIndex(e => ['x', 'y', 'z'].every(k => e.props.some(p => p.n === k))); if (ie < 0) throw new Error('El PLY no tiene coordenadas x, y, z.');
    if (EL[ie].list) throw new Error('Propiedades de lista en los puntos no soportadas.');
    const props = EL[ie].props, nV = EL[ie].n, ix = ['x', 'y', 'z'].map(k => props.findIndex(p => p.n === k));
    // atributos reconocidos por nombre (las etiquetas de entrenamiento como «label» no se leen: no vienen en una nube real)
    const pn = props.map(p => p.n.toLowerCase()), busca = f => pn.findIndex(f);
    const ia = { intensidad: busca(n => /intens|reflectance/.test(n)), rojo: busca(n => n === 'red' || n === 'r' || n === 'diffuse_red'), verde: busca(n => n === 'green' || n === 'g' || n === 'diffuse_green'), azul: busca(n => n === 'blue' || n === 'b' || n === 'diffuse_blue'),
      retorno: busca(n => n === 'return_number' || n === 'returnnumber'), retornos: busca(n => n === 'number_of_returns' || n === 'numberofreturns'), clase: busca(n => n === 'classification') };
    const an = ATR.filter(k => ia[k] >= 0), aix = an.map(k => ia[k]); S.atributos(an);
    if (fmt === 'ascii') {
      let row = 0; await readText(blob.slice(dataStart, blob.size), l => { if (row >= nV) return; const m = l.trim().split(/\s+/); if (m.length < props.length) return; row++; S.push(+m[ix[0]], +m[ix[1]], +m[ix[2]], aix.length ? aix.map(j => +m[j]) : null); }, prog);
    } else if (fmt === 'binary_little_endian' || fmt === 'binary_big_endian') {
      const le = fmt === 'binary_little_endian', SZ = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2, int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
      let skip = 0; for (let k = 0; k < ie; k++) { if (EL[k].list) throw new Error('El PLY tiene elementos con listas antes de los puntos.'); skip += EL[k].n * EL[k].props.reduce((a, p) => a + SZ[p.t], 0); }
      let off = 0; const offs = props.map(p => { const o = off; off += SZ[p.t]; return o; }), stride = off;
      const rd = ix.map(i => (props[i].t === 'double' || props[i].t === 'float64') ? 'getFloat64' : 'getFloat32');
      const GET = { char: 'getInt8', int8: 'getInt8', uchar: 'getUint8', uint8: 'getUint8', short: 'getInt16', int16: 'getInt16', ushort: 'getUint16', uint16: 'getUint16', int: 'getInt32', int32: 'getInt32', uint: 'getUint32', uint32: 'getUint32', float: 'getFloat32', float32: 'getFloat32', double: 'getFloat64', float64: 'getFloat64' };
      const ag = aix.map(j => GET[props[j].t]), ao = aix.map(j => offs[j]), av = new Array(aix.length);
      // color de 16 bits (0–65535) se lleva a 0–255
      const c16 = an.map((k, q) => ['rojo', 'verde', 'azul'].includes(k) && /short|16/.test(props[aix[q]].t) ? 1 / 257 : 1);
      const per = Math.floor((32 << 20) / stride);
      for (let i0 = 0; i0 < nV; i0 += per) {
        const n = Math.min(per, nV - i0), dv = new DataView(await blob.slice(dataStart + skip + i0 * stride, dataStart + skip + (i0 + n) * stride).arrayBuffer());
        for (let i = 0; i < n; i++) { const b = i * stride; for (let q = 0; q < ag.length; q++) av[q] = dv[ag[q]](b + ao[q], le) * c16[q]; S.push(dv[rd[0]](b + offs[ix[0]], le), dv[rd[1]](b + offs[ix[1]], le), dv[rd[2]](b + offs[ix[2]], le), ag.length ? av : null); }
        if (prog) await prog((i0 + n) / nV);
      }
    } else throw new Error('Formato PLY no reconocido: ' + fmt);
  } else if (ext === 'las') {
    const h = new DataView(await blob.slice(0, 375).arrayBuffer());
    if (String.fromCharCode(h.getUint8(0), h.getUint8(1), h.getUint8(2), h.getUint8(3)) !== 'LASF') throw new Error('El archivo no es LAS.');
    const vmin = h.getUint8(25), offP = h.getUint32(96, true), recLen = h.getUint16(105, true);
    let nP = h.getUint32(107, true); if (vmin >= 4 && !nP) nP = Number(h.getBigUint64(247, true));
    const sc = [131, 139, 147].map(o => h.getFloat64(o, true)), of = [155, 163, 171].map(o => h.getFloat64(o, true));
    // formato de punto: intensidad (todos), retornos y clase (0–5: bytes 14–15; 6–10: bytes 14 y 16), color (2: byte 20; 3 y 5: 28; 7, 8 y 10: 30)
    const pf = h.getUint8(104) & 63, nuevo = pf >= 6, rgbOff = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 }[pf];
    const an = ['intensidad', 'retorno', 'retornos', 'clase', ...(rgbOff != null ? ['rojo', 'verde', 'azul'] : [])], av = new Array(an.length); S.atributos(an);
    let rgbMax = 0;
    const per = Math.floor((32 << 20) / recLen);
    for (let i0 = 0; i0 < nP; i0 += per) {
      const n = Math.min(per, nP - i0), dv = new DataView(await blob.slice(offP + i0 * recLen, offP + (i0 + n) * recLen).arrayBuffer());
      for (let i = 0; i < n; i++) { const b = i * recLen, rb = dv.getUint8(b + 14); av[0] = dv.getUint16(b + 12, true);
        if (nuevo) { av[1] = rb & 15; av[2] = rb >> 4; av[3] = dv.getUint8(b + 16); } else { av[1] = rb & 7; av[2] = (rb >> 3) & 7; av[3] = dv.getUint8(b + 15) & 31; }
        if (rgbOff != null) { av[4] = dv.getUint16(b + rgbOff, true); av[5] = dv.getUint16(b + rgbOff + 2, true); av[6] = dv.getUint16(b + rgbOff + 4, true); if (av[4] > rgbMax) rgbMax = av[4]; }
        S.push(dv.getInt32(b, true) * sc[0] + of[0], dv.getInt32(b + 4, true) * sc[1] + of[1], dv.getInt32(b + 8, true) * sc[2] + of[2], av); }
      if (prog) await prog((i0 + n) / nP);
    }
    S.rgb16 = rgbMax > 255;
  } else if (['xyz', 'txt', 'csv', 'pts', 'asc'].includes(ext)) {
    await readText(blob, l => { const v = numbers3(l); if (v) S.push(v[0], v[1], v[2]); }, prog);
  } else if (ext === 'e57' || ext === 'laz') {
    throw new Error(`Los archivos .${ext} no se pueden leer en el navegador. Conviértalo a PLY binario o XYZ en CloudCompare (guía en esta misma pestaña).`);
  } else throw new Error('Formato no reconocido. Use PLY, LAS, XYZ, TXT o CSV.');
  const r = S.result(); if (r.kept < 1000) throw new Error('El archivo tiene muy pocos puntos válidos.');
  if (r.attr) { if (S.rgb16) for (const k of ['rojo', 'verde', 'azul']) if (r.attr[k]) for (let i = 0; i < r.kept; i++) r.attr[k][i] /= 257;
    // un atributo constante no informa (p. ej. LAS sin color o sin clasificar): se descarta
    for (const k of Object.keys(r.attr)) { const v = r.attr[k]; let mn = Infinity, mx = -Infinity; for (let i = 0; i < v.length; i += 7) { if (v[i] < mn) mn = v[i]; if (v[i] > mx) mx = v[i]; } if (!(mx > mn)) delete r.attr[k]; }
    if (!Object.keys(r.attr).length) delete r.attr; }
  return r;
}

/* ---------- ejes del puente ---------- */
// up: 'z' o 'y'. Devuelve s (longitudinal), t (transversal), z (vertical) como Float32Array y la transformación.
function orient(cloud, up = 'z', scale = 1) {
  const P = cloud.xyz, n = P.length / 3, iu = up === 'y' ? 1 : 2, ih = up === 'y' ? [0, 2] : [0, 1];
  let mx = 0, my = 0; const step = Math.max(1, Math.floor(n / 200000)); let c = 0;
  // el eje del puente se busca con los puntos a la altura del tablero (la franja horizontal más poblada de la mitad superior):
  // así el terreno, la vegetación o las calles de abajo no tuercen el eje cuando la nube es casi cuadrada
  const zs = []; for (let i = 0; i < n; i += step) zs.push(P[3 * i + iu]); zs.sort((a, b) => a - b);
  const zlo = zs[0], zhi = zs[zs.length - 1], zmed = zs[zs.length >> 1], nb = Math.max(1, Math.ceil((zhi - zlo) / .1)), hz = new Uint32Array(nb + 1); zs.forEach(z => hz[Math.floor((z - zlo) / .1)]++);
  let kb = -1, vb = -1; for (let k = 1; k < nb; k++) { const zc = zlo + (k + .5) * .1; if (zc < zmed) continue; const v = hz[k - 1] + hz[k] + hz[k + 1]; if (v > vb) { vb = v; kb = k; } }
  const zd = zlo + (kb + .5) * .1, near = i => Math.abs(P[3 * i + iu] - zd) < .6; let nd = 0; for (let i = 0; i < n; i += step) if (near(i)) nd++;
  const use = nd >= 2000 ? near : () => true;
  for (let i = 0; i < n; i += step) { if (!use(i)) continue; mx += P[3 * i + ih[0]]; my += P[3 * i + ih[1]]; c++; } mx /= c; my /= c;
  let sxx = 0, syy = 0, sxy = 0; for (let i = 0; i < n; i += step) { if (!use(i)) continue; const a = P[3 * i + ih[0]] - mx, b = P[3 * i + ih[1]] - my; sxx += a * a; syy += b * b; sxy += a * b; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); let u = [Math.cos(th), Math.sin(th)];
  // si el eje principal está a menos de 2° de un eje de coordenadas, se usa ese eje sin girar ni mover el origen
  let snap = null; const deg = Math.abs(Math.atan2(u[1], u[0]) * 180 / Math.PI) % 180;
  if (deg < 2 || deg > 178) snap = 0; else if (Math.abs(deg - 90) < 2) snap = 1;
  // tramo recortado por el usuario: el eje ya es x
  if (cloud.eje === 'x') snap = 0;
  // claridad del eje: cociente de varianzas principales de los puntos del tablero (≈1 si la planta es casi cuadrada y el eje es dudoso)
  const tr = sxx + syy, dt = Math.sqrt(Math.max(0, (sxx - syy) * (sxx - syy) / 4 + sxy * sxy)), l1 = tr / 2 + dt, l2 = Math.max(1e-9, tr / 2 - dt), ejeRatio = cloud.eje === 'x' ? Infinity : l1 / l2;
  const s = new Float32Array(n), t = new Float32Array(n), z = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = P[3 * i + ih[0]], b = P[3 * i + ih[1]];
    if (snap === 0) { s[i] = (a + cloud.offset[ih[0]]) * scale; t[i] = (b + cloud.offset[ih[1]]) * scale; }
    else if (snap === 1) { s[i] = (b + cloud.offset[ih[1]]) * scale; t[i] = (a + cloud.offset[ih[0]]) * scale; }
    else { const da = a - mx, db = b - my; s[i] = (da * u[0] + db * u[1]) * scale; t[i] = (-da * u[1] + db * u[0]) * scale; }
    z[i] = (P[3 * i + iu] + cloud.offset[iu]) * scale;
  }
  let smin = 0; if (snap == null) { let m = Infinity; for (let i = 0; i < n; i++) m = Math.min(m, s[i]); for (let i = 0; i < n; i++) s[i] -= m; smin = m; }
  // la transformación queda guardada para llevar OTRA nube (otra fecha) al mismo marco
  return { s, t, z, n, snap, angleDeg: th * 180 / Math.PI, ejeRatio, tr: { mx, my, u, snap, scale, iu, ih, offset: cloud.offset.slice(), smin } };
}
// otra nube en el marco de una ya orientada (misma rotación, origen y escala); si las dos están georreferenciadas, quedan superpuestas
function orientarComo(cloud, tr) { const P = cloud.xyz, n = P.length / 3, s = new Float32Array(n), t = new Float32Array(n), z = new Float32Array(n), d = [0, 1, 2].map(k => cloud.offset[k] - tr.offset[k]);
  for (let i = 0; i < n; i++) { const a = P[3 * i + tr.ih[0]], b = P[3 * i + tr.ih[1]];
    if (tr.snap === 0) { s[i] = (a + cloud.offset[tr.ih[0]]) * tr.scale; t[i] = (b + cloud.offset[tr.ih[1]]) * tr.scale; }
    else if (tr.snap === 1) { s[i] = (b + cloud.offset[tr.ih[1]]) * tr.scale; t[i] = (a + cloud.offset[tr.ih[0]]) * tr.scale; }
    else { const da = a + d[tr.ih[0]] - tr.mx, db = b + d[tr.ih[1]] - tr.my; s[i] = (da * tr.u[0] + db * tr.u[1]) * tr.scale - tr.smin; t[i] = (-da * tr.u[1] + db * tr.u[0]) * tr.scale; }
    z[i] = (P[3 * i + tr.iu] + cloud.offset[tr.iu]) * tr.scale; }
  return { s, t, z, n, snap: tr.snap, tr }; }
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
  // puente de tablero inferior (armadura o arco de paso inferior): la franja elegida puede ser el arriostramiento superior. Sobre una rodadura
  // siempre hay barandas o parapetos (0,4–1,4 m sobre ella) en casi todo el largo; si no los hay, se baja a la franja densa más alta que sí los tenga
  const zAt = k => zl + (k + .5) * bw;
  if (railFrac(O, zAt(bi)) < .3) { const W = new Float64Array(nb); for (let k = 0; k < nb; k++) W[k] = h[k] + (h[k - 1] || 0) + (h[k + 1] || 0); const top = Math.max(...W);
    for (let k = bi - 1; k > 0; k--) if (W[k] >= .3 * top && W[k] >= W[k - 1] && W[k] >= (W[k + 1] || 0) && railFrac(O, zAt(k)) >= .6) { bi = k; break; } }
  return zAt(bi);
}
// fracción del largo de una franja horizontal (±0,15 m) que tiene puntos entre 0,4 y 1,4 m sobre ella (barandas, parapetos)
function railFrac(O, zc) { const S = []; for (let i = 0; i < O.n; i += 2) if (Math.abs(O.z[i] - zc) < .15) S.push(O.s[i]); if (S.length < 100) return 0; S.sort((a, b) => a - b);
  const s0 = S[Math.floor(.05 * S.length)], s1 = S[Math.floor(.95 * S.length)], n = Math.max(1, Math.ceil(s1 - s0)), c = new Uint16Array(n);
  for (let i = 0; i < O.n; i++) { const d = O.z[i] - zc; if (d > .4 && d < 1.4) { const k = Math.floor(O.s[i] - s0); if (k >= 0 && k < n) c[k]++; } }
  let m = 0; for (const v of c) if (v >= 3) m++; return m / n; }
function groundLevel(O) { const a = []; for (let i = 0; i < O.n; i += 3) a.push(O.z[i]); return quantile(a, .001); }
// apoyos: caras de pilares y estribos = bandas densas de puntos en una franja horizontal bajo los arranques (como pier_faces en geom.py)
// perfil de la rodadura: tableros en pendiente (rampas, puentes peatonales) se siguen con una recta; si la pendiente es < 0,4 % se toma horizontal
function deckProfile(O, deckTop) { const [sl, sh] = bounds(O.s), bw = 2, nb = Math.ceil((sh - sl) / bw) + 1, H = Array.from({ length: nb }, () => new Uint32Array(100)), lo = deckTop - 2.5;
  for (let i = 0; i < O.n; i += 2) { const z = O.z[i]; if (z < lo || z >= deckTop + 2.5) continue; H[Math.floor((O.s[i] - sl) / bw)][Math.floor((z - lo) / .05)]++; }
  const X = [], Y = []; H.forEach((h, k) => { let m = -1, v = 0; for (let j = 0; j < 100; j++) { const c = h[j] + (h[j - 1] || 0) + (h[j + 1] || 0); if (c > v) { v = c; m = j; } } if (v >= 30) { X.push(sl + (k + .5) * bw); Y.push(lo + (m + .5) * .05); } });
  const flat = { slope: 0, at: () => deckTop }; if (X.length < 6) return flat;
  let use = X.map(() => true), a = 0, b = deckTop;
  for (let it = 0; it < 3; it++) { const xs = X.filter((_, i) => use[i]), ys = Y.filter((_, i) => use[i]), n = xs.length, mx = xs.reduce((p, q) => p + q, 0) / n, my = ys.reduce((p, q) => p + q, 0) / n;
    let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; }); a = sxx ? sxy / sxx : 0; b = my - a * mx;
    const r = X.map((x, i) => Math.abs(Y[i] - (a * x + b))), md = median(r) || .05; use = r.map(v => v <= Math.max(.15, 3 * md)); }
  /* rasante con curva vertical (puentes largos con contraflecha o en «lomo»): se sigue la calzada desde el tramo más poblado, bin a bin de 2 m,
     buscando la capa más densa a ±0,25 m de la cota anterior (pendiente ≤ 12 %: no trepa por arcos ni tirantes); si la recta deja residuos > 0,3 m se usa ese recorrido en lugar de la recta */
  const lin = Math.abs(a) < .004 ? flat : { slope: a, at: s => a * s + b };
  const zs = Array.from({ length: nb }, () => []); for (let i = 0; i < O.n; i += 2) zs[Math.floor((O.s[i] - sl) / bw)].push(O.z[i]);
  let seed = -1, sv = 0; zs.forEach((v, k) => { let c = 0; for (const z of v) if (Math.abs(z - deckTop) < .3) c++; if (c > sv) { sv = c; seed = k; } });
  if (seed < 0 || sh - sl < 150) return lin; /* en puentes cortos la recta basta; los residuos ahí vienen de veredas o de la cara inferior */ const tr = new Array(nb).fill(null);
  const mode = (v, z0, w = .25) => { const nn = Math.round(2 * w / .05), h = new Uint32Array(nn); let n = 0; for (const z of v) { const j = Math.floor((z - z0 + w) / .05); if (j >= 0 && j < nn) { h[j]++; n++; } } if (n < 15) return null; let m = 0; for (let j = 1; j < nn; j++) if (h[j] + (h[j - 1] || 0) + (h[j + 1] || 0) > h[m] + (h[m - 1] || 0) + (h[m + 1] || 0)) m = j; return z0 - w + (m + .5) * .05; };
  tr[seed] = mode(zs[seed], deckTop, .6) ?? deckTop;
  for (const dir of [-1, 1]) { let prev = tr[seed], gap = 0; for (let k = seed + dir; k >= 0 && k < nb; k += dir) { const z = mode(zs[k], prev); if (z == null) { if (++gap * bw > 20) break; continue; } gap = 0; tr[k] = z; prev = z; } }
  const ks = [], vs = []; tr.forEach((v, k) => { if (v != null) { ks.push(k); vs.push(v); } }); if (ks.length < 6) return lin;
  const res = ks.map((k, j) => Math.abs(vs[j] - lin.at(sl + (k + .5) * bw))).sort((x, y) => x - y); if (res[Math.floor(res.length * .9)] <= .3) return lin;
  const sm = vs.map((_, j) => { const w = vs.slice(Math.max(0, j - 2), j + 3).sort((x, y) => x - y); return w[w.length >> 1]; }), xs = ks.map(k => sl + (k + .5) * bw);
  const at = s => { if (s <= xs[0]) return sm[0]; if (s >= xs[xs.length - 1]) return sm[sm.length - 1]; let lo = 0, hi = xs.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= s) lo = m; else hi = m; } const f = (s - xs[lo]) / (xs[hi] - xs[lo]); return sm[lo] + f * (sm[hi] - sm[lo]); };
  return { slope: a, at, curva: true }; }
let CONC_MIN = 0;
function setConcMin(v) { CONC_MIN = v; }
// Esviaje: en un puente oblicuo las pilas y los estribos forman líneas que no son perpendiculares al eje. Se mide el ángulo φ con los puntos
// bajo el tablero (pilas, estribos, taludes): es el corte s' = s − (t − t_m)·tan φ que deja la proyección más concentrada. Si φ es claro
// (|φ| ≥ 8° y la concentración mejora ≥ 30 %), los apoyos se buscan con s' y quedan medidos en el eje del tablero.
function skewAngle(O, deckTop, ground) {
  const td = []; for (let i = 0; i < O.n; i += 7) if (Math.abs(O.z[i] - deckTop) < .3) td.push(O.t[i]); if (td.length < 200) return { phi: 0, gain: 1, tm: 0 };
  td.sort((a, b) => a - b); const t0 = td[Math.floor(.05 * td.length)], t1 = td[Math.floor(.95 * td.length)], tm = (t0 + t1) / 2, S = [], T = [], st = Math.max(1, Math.floor(O.n / 400000));
  for (let i = 0; i < O.n; i += st) { const z = O.z[i]; if (z > ground + .5 && z < deckTop - 1.5 && O.t[i] >= t0 && O.t[i] <= t1) { S.push(O.s[i]); T.push(O.t[i] - tm); } }
  if (S.length < 2000) return { phi: 0, gain: 1, tm };
  const sc = phi => { const k = Math.tan(phi * Math.PI / 180), h = new Map(); for (let j = 0; j < S.length; j++) { const b = Math.floor((S[j] - T[j] * k) / .2); h.set(b, (h.get(b) || 0) + 1); } let q = 0; for (const v of h.values()) q += v * v; return q; };
  const s0 = sc(0); let best = 0, bv = s0; for (let p = -60; p <= 60; p++) { const v = sc(p); if (v > bv) { bv = v; best = p; } }
  return { phi: best, gain: bv / s0, tm };
}
// nube «enderezada»: s' = s − (t − t_m)·tan φ; las posiciones a lo largo del puente quedan medidas en el eje del tablero
function applySkew(O, sk) { const k = Math.tan(sk.phi * Math.PI / 180), s = new Float32Array(O.n); for (let i = 0; i < O.n; i++) s[i] = O.s[i] - (O.t[i] - sk.tm) * k; return { ...O, s, skew: sk }; }
function detectSupports(O, deckTop, ground, frac = 0.62, tol = 0.25) {
  const sk = skewAngle(O, deckTop, ground);
  if (Math.abs(sk.phi) < 8 || sk.gain < 1.3) return { ...detectSupports0(O, deckTop, ground, frac, tol), skew: 0 };
  return { ...detectSupports0(applySkew(O, sk), deckTop, ground, frac, tol), skew: sk.phi, skewTm: sk.tm };
}
function detectSupports0(O, deckTop, ground, frac = 0.62, tol = 0.25) {
  // 0) rodadura (recta si el tablero está en pendiente) y profundidad de cada punto bajo ella
  const DP = deckProfile(O, deckTop), rel = i => O.z[i] - DP.at(O.s[i]);
  // 1) huella del tablero en planta (+1 m): fuera de ella quedan taludes y vegetación laterales. Con láser terrestre desde un lado se ven las caras laterales, por eso no se recorta más.
  const dS = [], dT = []; for (let i = 0; i < O.n; i += 2) if (Math.abs(rel(i)) < .3) { dS.push(O.s[i]); dT.push(O.t[i]); }
  const t0 = quantile(dT, .03), t1 = quantile(dT, .97), tm = (t0 + t1) / 2, th = (t1 - t0) / 2 + 1, d0 = quantile(dS, .005), d1 = quantile(dS, .995);
  const core = i => Math.abs(O.t[i] - tm) <= th;
  /* separación media entre puntos en la calzada: láser terrestre ≈ 1–5 cm, aéreo ≈ 0,3–0,7 m. En nubes ralas las caras verticales tienen pocos puntos y
     las pruebas de continuidad se hacen con franjas y ventanas proporcionales a esa separación */
  const espP = Math.sqrt(Math.max(1e-6, (d1 - d0) * (t1 - t0)) / Math.max(1, 2 * dS.length)), rala = espP > .15;
  // altura libre: si el punto más bajo de la nube (cauce, otra calzada) está muy por debajo del terreno típico bajo el tablero, los apoyos se buscan respecto del terreno típico
  let H = deckTop - ground; { const dep = []; for (let k = 0; k < Math.ceil((d1 - d0) / 2); k++) dep.push([]); for (let i = 0; i < O.n; i += 3) { if (!core(i) || O.s[i] < d0 || O.s[i] >= d1) continue; const r = rel(i); if (r < -1.5) dep[Math.floor((O.s[i] - d0) / 2)].push(-r); }
    const loc = dep.filter(a => a.length >= 20).map(a => quantile(a, .95)); if (loc.length >= 5) { const Hl = median(loc); if (H - Hl > 3 && Hl > 2) H = Hl; } }
  // nube sin terreno bajo el tablero (puente limpiado, solo la estructura): no hay altura libre donde buscar pilares; estribos en los extremos del tablero
  if (H < 2) return { cands: [], supports: [{ a: d0, b: d0, tipo: 'estribo', auto: 'extremo' }, { a: d1, b: d1, tipo: 'estribo', auto: 'extremo' }], zSlab: deckTop - .6 * H, faces: [], deck: [d0, d1], band: [tm - th, tm + th], slope: DP.slope, sinTerreno: true };
  const zc = -frac * H, [sl, sh] = bounds(O.s), bw = 0.1, nb = Math.ceil((sh - sl) / bw) + 1;
  const slice = (z0, tl) => { const h = new Float64Array(nb); for (let i = 0; i < O.n; i++) if (Math.abs(rel(i) - z0) < tl && core(i)) h[Math.floor((O.s[i] - sl) / bw)]++; return h; };
  const h = slice(zc, tol);
  const sm = h.map((_, k) => (h[k - 1] || 0) * .25 + h[k] * .5 + (h[k + 1] || 0) * .25), nz = Array.from(sm).filter(v => v > 0);
  const thr = Math.max(2, 0.2 * quantile(nz.length ? nz : [0], .98));
  const runs = []; let a = -1;
  for (let k = 0; k <= nb; k++) { const on = k < nb && sm[k] >= thr; if (on && a < 0) a = k; if (!on && a >= 0) { let m = a; for (let j = a; j < k; j++) if (sm[j] > sm[m]) m = j; let tot = 0; for (let j = a; j < k; j++) tot += h[j]; runs.push({ a: sl + a * bw, b: sl + k * bw, peak: sl + (m + .5) * bw, tot }); a = -1; } }
  // 2) un apoyo es un elemento vertical: debe aparecer también en cortes más altos (hacia el tablero) en la misma posición;
  //    el terreno inclinado o el talud cruzan cada corte en otra posición y se descartan
  const hz = [-Math.min(.9, frac + .13) * H, -(frac - .12) * H].map(z => slice(z, tol)), occ = (hh, s0) => { let c = 0; for (let k = Math.max(0, Math.floor((s0 - 1.2 - sl) / bw)); k <= Math.min(nb - 1, Math.floor((s0 + 1.2 - sl) / bw)); k++) c += hh[k]; return c; };
  const peakAt = (hh, s0) => { let m = -1, v = -1; for (let k = Math.max(0, Math.floor((s0 - 1.5 - sl) / bw)); k <= Math.min(nb - 1, Math.floor((s0 + 1.5 - sl) / bw)); k++) { const x = (hh[k - 1] || 0) + hh[k] + (hh[k + 1] || 0); if (x > v) { v = x; m = k; } } return sl + (m + .5) * bw; };
  // vegetación: aparece en varias alturas pero sin una cara alineada; un pilar o muro tiene su cara en la misma posición a todas las alturas
  const vert = r => { const o = hz.filter(hh => occ(hh, r.peak) >= Math.max(3, .15 * r.tot)), al = o.filter(hh => peakAt(hh, r.peak) >= r.a - .4 && peakAt(hh, r.peak) <= r.b + .4); return al.length >= 1 && o.length >= (H > 4 ? 2 : 1); };
  // concentración: un pilar o muro concentra sus puntos en una franja angosta a lo largo del eje en todas las alturas; la vegetación y los taludes los reparten
  const conc = r => { const lv = []; for (let f = .2; f <= .9; f += .1) { const z0 = -f * H; let inn = 0, tot = 0; for (let i = 0; i < O.n; i += 2) { const s = O.s[i]; if (s < r.peak - 2.5 || s > r.peak + 2.5 || !core(i) || Math.abs(rel(i) - z0) > .3) continue; tot++; if (s >= Math.min(r.a, r.peak - .75) - .3 && s <= Math.max(r.b, r.peak + .75) + .3) inn++; } if (tot >= 15) lv.push(inn / tot); }
    return lv.length ? { c: median(lv), n: lv.length } : { c: 0, n: 0 }; };
  // continuidad vertical: una columna, pilar o muro tiene puntos en todas las alturas entre el terreno y el tablero en su misma posición;
  // los arbustos y los taludes dejan alturas vacías. Se mide en ±0,75 m del pico, en franjas de 0,25 m entre el terreno y 1,5 m bajo la rodadura.
  const cst = O.n > 600000 ? 2 : 1, cdz = rala ? Math.max(.25, 2.5 * espP) : .25, cw = rala ? Math.max(.75, 3 * espP) : .75, cont = r => { let ok = 0, tt = 0; for (let zz = -.85 * H; zz < Math.min(-1.5, -.3 * H); zz += cdz) { tt++; let c = 0; for (let i = 0; i < O.n; i += cst) { const s = O.s[i]; if (s < r.peak - cw || s > r.peak + cw) continue; const rr = rel(i); if (rr >= zz && rr < zz + cdz && core(i)) { if (++c >= 3) break; } } if (c >= 3) ok++; } return tt ? ok / tt : 1; };
  // umbral de tamaño respecto de los candidatos angostos (muros de estribo y taludes, más anchos que 5 m, no fijan la escala)
  // (y solo con caras verticales y delgadas, ≤ 1,5 m: un talud denso o con árboles no debe dejar fuera columnas delgadas)
  const cMin = rala ? .6 : .87; /* en nubes aéreas la parte baja de las caras queda tapada o con pocos puntos */
  const cand = runs.filter(r => r.peak > d0 - 1 && r.peak < d1 + 1); cand.forEach(r => { r.vert = vert(r); });
  const narrow = cand.filter(q => q.b - q.a <= 5), nv = narrow.filter(q => q.vert && q.b - q.a <= 1.5), mx = Math.max(0, ...(nv.length ? nv : narrow.length ? narrow : cand).map(q => q.tot));
  cand.forEach(r => { if (r.tot >= 0.1 * mx && r.vert) { r.cont = cont(r); const k = conc(r); r.conc = k.c; r.nlv = k.n; } });
  const big0 = cand.filter(r => r.tot >= 0.1 * mx && r.vert);
  // caras a menos de 4,5 m (8 m en nubes aéreas, donde se ven las dos caras de pilares macizos) forman un mismo pilar; la cara exterior de cada grupo es el pico de densidad
  const groups0 = []; big0.forEach(r => { const g = groups0[groups0.length - 1]; if (g && r.peak - g[g.length - 1].peak <= (rala ? 8 : 4.5)) g.push(r); else groups0.push([r]); });
  // se descarta un grupo cuyas caras no llegan de forma continua del terreno al tablero (arbustos, taludes); no se aplica cerca de los extremos del tablero (estribos)
  const deckOut = (s0, dir) => { let c = 0; for (let i = 0; i < O.n; i++) if (Math.abs(rel(i)) < .3 && (dir < 0 ? O.s[i] < s0 - 5 : O.s[i] > s0 + 5)) c++; return c > 200; };
  // el grupo más externo de cada lado puede ser la cara de un estribo: se conserva si detrás el terreno llega casi al tablero o no hay datos bajo el tablero (terraplén)
  const behind = (s0, dir) => { const z = []; for (let i = 0; i < O.n; i++) { const d = (O.s[i] - s0) * dir; if (d >= 3 && d <= 5 && core(i) && rel(i) <= -.6) z.push(rel(i)); } return z.length >= 5 ? -quantile(z, .05) : null; };
  const isAbut = (g, k) => { if (k !== 0 && k !== groups0.length - 1) return false; const dir = k === 0 ? -1 : 1, s0 = dir < 0 ? g[0].peak : g[g.length - 1].peak, c = behind(s0, dir); return !deckOut(s0, dir) || (g.length === 1 && (c == null || c < 2.5)); };
  // un grupo interior con pocos puntos (< 20 % de la cara mayor: poste, letrero, tronco) no es un pilar; en los extremos se admite (cara pequeña de un estribo)
  const small = (g, k) => k !== 0 && k !== groups0.length - 1 && Math.max(...g.map(r => r.tot)) < .2 * mx;
  const groups = groups0.filter((g, k) => !small(g, k) && (H <= 3 || g.some(r => r.b - r.a > 5 || r.cont == null || r.cont >= cMin) || isAbut(g, k))), big = [].concat(...groups);
  // las caras de vegetación pegadas a un pilar no amplían el apoyo: se usan solo las caras continuas (si hay)
  const sup = groups.map(g => { const f = g.filter(r => r.cont == null || r.cont >= cMin), u = f.length ? f : g; return { a: u[0].peak, b: u[u.length - 1].peak, _g: g }; });
  // es estribo si no hay tablero más allá; si el tablero sigue, es un pilar y el vano extremo se completa por simetría
  const deckBeyond = (s0, dir) => { let c = 0; for (let i = 0; i < O.n; i++) if (Math.abs(rel(i)) < .3 && (dir < 0 ? O.s[i] < s0 - 5 : O.s[i] > s0 + 5)) c++; return c > 200; };
  // 3) estribos en los extremos: donde el terreno bajo el tablero sube hasta cerca de la cara inferior (≤ 2,5 m bajo la rodadura)
  const gb = .5, gn = Math.ceil((d1 - d0) / gb), low = Array.from({ length: gn }, () => []);
  for (let i = 0; i < O.n; i++) { if (!core(i) || O.s[i] < d0 || O.s[i] >= d1 || rel(i) > -.6) continue; low[Math.floor((O.s[i] - d0) / gb)].push(rel(i)); }
  const gz = low.map(b => b.length >= 5 ? quantile(b, .05) : null);
  // tablero apoyado en relleno: hacia los extremos, bins con rodadura pero sin ningún punto 0,6 m por debajo; la tierra llega a la losa (altura libre ≈ 0,6 m).
  // Solo los bins vacíos contiguos a cada extremo, para no confundirlos con un vano que la nube no ve por debajo
  { const dk = new Uint32Array(gn); for (let i = 0; i < O.n; i++) { if (!core(i) || O.s[i] < d0 || O.s[i] >= d1 || Math.abs(rel(i)) > .3) continue; dk[Math.floor((O.s[i] - d0) / gb)]++; }
    for (const [k0, dir] of [[0, 1], [gn - 1, -1]]) for (let k = k0; k >= 0 && k < gn && gz[k] == null; k += dir) if (dk[k] >= 20) gz[k] = -.6; }
  const clear = k => gz[k] == null ? null : -gz[k], mid = sup.length ? (sup[0].a + sup[sup.length - 1].b) / 2 : (d0 + d1) / 2, km = Math.min(gn - 1, Math.max(0, Math.floor((mid - d0) / gb)));
  const high = (k, dir) => { let n = 0; for (let j = 0; j < 6; j++) { const c = clear(k + dir * j); if (c != null && c >= 2.5) return false; if (c != null) n++; } return n >= 3; };
  /* el terraplén sigue hasta el final de la nube: desde ahí hacia afuera casi todo el terreno medido queda cerca del tablero. Una losa paralela más baja,
     la estructura inferior de una armadura o un segundo tablero dan «terreno alto» a mitad del puente, pero más allá vuelve el vano libre */
  const hastaFin = (k, dir) => { let n = 0, lo = 0; for (let kk = k; kk >= 0 && kk < gn; kk += dir) { const c = clear(kk); if (c == null) continue; n++; if (c < 2.5) lo++; } return n < 20 || lo >= .7 * n; };
  const edge = dir => { for (let k = km; k >= 0 && k < gn; k += dir) { if (high(k, dir) && hastaFin(k, dir)) return d0 + (k + (dir > 0 ? 0 : 1)) * gb; } return dir > 0 ? d1 : d0; };
  const clearAt = s0 => { const k = Math.floor((s0 - d0) / gb); let best = null; for (let j = k - 2; j <= k + 2; j++) { const c = j >= 0 && j < gn ? clear(j) : null; if (c != null) best = best == null ? c : Math.min(best, c); } return best; };
  // en los extremos: estribo si más allá el terreno está cerca del tablero (terraplén) o no sigue el tablero; pilar si hay vano libre detrás
  sup.forEach((p, i) => { p.tipo = 'pilar'; const single = p._g.length === 1, end = i === 0 ? -1 : i === sup.length - 1 ? 1 : 0; if (!end) return;
    const so = end < 0 ? p.a - 4 : p.b + 4, c = clearAt(so), noDeck = !deckBeyond(end < 0 ? p.a : p.b, end);
    if (noDeck || (single && (c == null || c < 2.5))) p.tipo = 'estribo'; });
  // solo se agrega un estribo por terreno donde el apoyo extremo es un pilar con vano libre detrás (p. ej. pilar central de dos vanos)
  // terreno alto que aparece de golpe (salto > 1,5 m respecto del bin anterior) solo cuenta si sigue alto ≥ 5 m: un tramo corto así es el agua de un
  // cauce (sin puntos de fondo, solo la losa) o un objeto bajo el tablero, no el terraplén
  const persist = (k, dir) => { let n = 0; for (let j = 0; j < 10; j++) { const kk = k + dir * j; if (kk < 0 || kk >= gn) return n >= 3; const c = clear(kk); if (c != null && c >= 2.5) return false; if (c != null) n++; } return true; };
  const edgeFrom = (s0, dir) => { const k0 = Math.min(gn - 1, Math.max(0, Math.floor((s0 - d0) / gb))); let prev = null;
    for (let k = k0 + dir * 4; k >= 0 && k < gn; k += dir) { const c = clear(k); if (high(k, dir) && hastaFin(k, dir) && !(prev != null && c != null && prev - c > 1.5 && !persist(k, dir))) return d0 + (k + (dir > 0 ? 0 : 1)) * gb; if (c != null) prev = c; } return dir > 0 ? d1 : d0; };
  if (!sup.length) { sup.push({ a: edge(-1), b: edge(-1), tipo: 'estribo', auto: 'terreno' }, { a: edge(1), b: edge(1), tipo: 'estribo', auto: 'terreno' }); }
  else if (sup.length === 1 && sup[0].tipo === 'estribo') {
    // un solo estribo: el vano está del lado con más gálibo y el otro estribo se busca por el terreno de ese lado
    const p = sup[0], cl = clearAt(p.a - 4), cr = clearAt(p.b + 4), dir = (cr || 0) >= (cl || 0) ? 1 : -1, E = edgeFrom(dir > 0 ? p.b : p.a, dir);
    if (Math.abs(E - p.a) > 4) { const q = { a: E, b: E, tipo: 'estribo', auto: 'terreno' }; if (dir > 0) sup.push(q); else sup.unshift(q); } }
  else { const f = sup[0], l = sup[sup.length - 1];
    // (el vano vecino solo cuenta si su otro apoyo se midió, no si se puso por el terreno)
    // si el terreno llega al tablero muy cerca (< 4 m), más allá de un apoyo extremo de una sola cara (muro) no cabe otro vano: ese apoyo es el estribo
    // (se exige ver el terraplén: en los 10 m siguientes hay terreno medido y casi todo está a menos de 2,5 m bajo la rodadura)
    const freeBeyond = (s0, dir) => { const k0 = Math.floor((s0 - d0) / gb); let n = 0, lo = 0; for (let j = 0; j < 20; j++) { const k = k0 + dir * j; if (k < 0 || k >= gn) break; const c = clear(k); if (c == null) continue; n++; if (c < 2.5) lo++; } return !(n >= 6 && lo >= .8 * n); };
    if (f.tipo === 'pilar') { const L = edgeFrom(f.a, -1); if (f.a - L > Math.max(6, .3 * (sup.length > 1 && !sup[1].auto ? sup[1].a - f.b : 0))) sup.unshift({ a: L, b: L, tipo: 'estribo', auto: 'terreno' }); else if (L > d0 + .5 && f.a - L < 4 && f._g && f._g.length === 1 && !freeBeyond(L, -1)) f.tipo = 'estribo'; }
    if (l.tipo === 'pilar') { const R = edgeFrom(l.b, 1); if (R - l.b > Math.max(6, .3 * (sup.length > 1 && !sup[sup.length - 2].auto ? l.a - sup[sup.length - 2].b : 0))) sup.push({ a: R, b: R, tipo: 'estribo', auto: 'terreno' }); else if (R < d1 - .5 && R - l.b < 4 && l._g && l._g.length === 1 && !freeBeyond(R, 1)) l.tipo = 'estribo'; } }
  // estribo por terreno: el apoyo está donde el relleno ya llega a la losa (altura libre ≤ 1,5 m), no donde el talud cruza 2,5 m; se avanza hacia afuera hasta 6 m
  sup.forEach((p, i) => { if (p.auto !== 'terreno' || sup.length < 2 || (i !== 0 && i !== sup.length - 1)) return; const dir = i === 0 ? -1 : 1; let k = Math.floor((p.a - d0) / gb);
    for (let j = 0; j < 12; j++, k += dir) { if (k < 0 || k >= gn) break; const c = clear(k); if (c != null && c <= 1.5) { p.a = p.b = d0 + (k + .5) * gb; break; } } });
  // un estribo hallado por el terreno queda donde el talud baja de 2,5 m bajo la rodadura; si a menos de 6 m, hacia el vano, hay una cara vertical
  // plana y delgada (muro del estribo, ≤ 1 m de espesor en la nube; la vegetación es más difusa), el estribo se pone en esa cara
  sup.forEach((p, i) => { if (p.auto !== 'terreno') return; const dir = i === 0 ? -1 : 1, nb = sup[i - dir], lim = nb ? (dir < 0 ? nb.a : nb.b) : null;
    const f = cand.filter(r => r.vert && r.b - r.a <= 1 && (r.cont == null || r.cont >= .75) && r.tot >= .05 * mx && (p.a - r.peak) * dir >= 0 && (p.a - r.peak) * dir <= 6 && (lim == null || (r.peak - lim) * dir > 3)).sort((x, y) => Math.abs(x.peak - p.a) - Math.abs(y.peak - p.a))[0];
    if (f) { p.a = p.b = f.peak; p.auto = 'cara'; } });
  // apoyos con mucha masa sobre el tablero en esa misma posición (copa de árbol, torre): se marcan como dudosos para que el usuario los confirme.
  // Masa sobre el tablero = puntos más de 1,5 m sobre la rodadura por metro de puente (a cualquier distancia transversal), comparada con la densidad media de la nube.
  { const n1 = Math.ceil(sh - sl) + 1, ab = new Float64Array(n1); for (let i = 0; i < O.n; i++) if (rel(i) > 1.5) ab[Math.floor(O.s[i] - sl)]++;
    const per = (s0, s1) => { let c = 0; const k0 = Math.max(0, Math.floor(s0 - sl)), k1 = Math.min(n1 - 1, Math.floor(s1 - sl)); for (let k = k0; k <= k1; k++) c += ab[k]; return c / Math.max(1, k1 - k0 + 1); };
    const typ = []; for (let k = Math.max(0, Math.floor(d0 - sl)); k <= Math.min(n1 - 1, Math.floor(d1 - sl)); k++) typ.push(ab[k]); const med = median(typ.length ? typ : [0]), dens = O.n / Math.max(1, d1 - d0);
    sup.forEach(p => { if (p.tipo !== 'pilar') return; const v = per(p.a - 2.5, p.b + 2.5), g = p._g || [];
      if (v > Math.max(5 * med, .06 * dens)) p.duda = 'hay mucha masa sobre el tablero en esa posición (¿árbol o torre?). Confirme que es un pilar.';
      else if (g.length && g.every(r => r.cont != null && r.cont < .99 && r.b - r.a <= 5)) p.duda = 'no llega de forma continua del terreno al tablero (¿vegetación?). Confirme que es un pilar.'; }); }
  sup.forEach(p => delete p._g);
  /* nubes aéreas: pilares macizos que el láser ve de lado con pocos puntos. Columna de 1 m a lo largo del eje con puntos en ≥ 70 % de los niveles de 1 m
     entre el terreno local + 1 m y 3 m bajo la rodadura (≥ 5 niveles), de ≤ 12 m de largo y que ocupa ≥ 50 % del ancho del tablero (un árbol aislado no) */
  if (rala && sup.length >= 2) { const L0 = sup[0].b, L1 = sup[sup.length - 1].a, nB = Math.max(0, Math.ceil(L1 - L0)), lv = Array.from({ length: nB }, () => new Map()), gmin = new Float64Array(nB).fill(Infinity), W = t1 - t0;
    for (let i = 0; i < O.n; i++) { const s = O.s[i]; if (s < L0 || s >= L1 || !core(i)) continue; const k = Math.floor(s - L0), z = O.z[i]; if (z < gmin[k]) gmin[k] = z; }
    for (let i = 0; i < O.n; i++) { const s = O.s[i]; if (s < L0 || s >= L1 || !core(i)) continue; const k = Math.floor(s - L0), r = rel(i); if (r > -3 || O.z[i] < gmin[k] + 1) continue; const lz = Math.floor(O.z[i]); let m = lv[k].get(lz); if (!m) lv[k].set(lz, m = [Infinity, -Infinity]); m[0] = Math.min(m[0], O.t[i]); m[1] = Math.max(m[1], O.t[i]); }
    const col = lv.map((m, k) => { const top = DP.at(L0 + k + .5) - 3, n = Math.floor(top) - Math.ceil(gmin[k] + 1); if (!isFinite(gmin[k]) || n < 5) return false; let ok = 0, t0c = Infinity, t1c = -Infinity; for (const [z, v] of m) if (z >= gmin[k] + 1 && z < top) { ok++; t0c = Math.min(t0c, v[0]); t1c = Math.max(t1c, v[1]); } return ok >= .7 * n && t1c - t0c >= .5 * W ? 1 : ok / Math.max(1, n) * .99; });
    for (let k = 0; k < nB; k++) { if (col[k] !== 1) continue; let e = k; while (e + 1 < nB && col[e + 1] === 1) e++; const a = L0 + k, b = L0 + e + 1, c = (a + b) / 2, k0 = k; k = e;
      /* a los lados de la columna (3 m) el espacio debe quedar casi vacío: un talud o un relleno ocupan las alturas de forma continua */
      const lado = [k0 - 3, k0 - 2, k0 - 1, e + 1, e + 2, e + 3].filter(j => j >= 0 && j < nB).map(j => col[j] || 0), vac = lado.length ? lado.reduce((x, y) => x + y, 0) / lado.length : 1;
      if (vac >= .75 || b - a > 12 || sup.some(p => Math.abs((p.a + p.b) / 2 - c) < 8)) continue; const q = { a: +a.toFixed(2), b: +b.toFixed(2), tipo: 'pilar', auto: 'columna', duda: 'Pilar hallado como columna de puntos en altura (nube aérea, pocas caras visibles). Confirme.' }; sup.push(q); }
    sup.sort((x, y) => x.a - y.a); }
  /* estribo puesto por el terreno: ¿hay una cara vertical medida cerca? (si no la hay, no se convierte en pilar aunque el hueco siga) */
  sup.forEach(p => { if (p.auto === 'terreno') p.caraCerca = cand.some(r => r.vert && Math.abs(r.peak - (p.a + p.b) / 2) <= 8); });
  return { cands: cand.map(r => ({ peak: +r.peak.toFixed(2), a: +r.a.toFixed(2), b: +r.b.toFixed(2), tot: r.tot, vert: r.vert, cont: r.cont, conc: r.conc })), supports: sup, zSlab: deckTop + zc, faces: big.map(r => r.peak), deck: [d0, d1], band: [tm - th, tm + th], slope: DP.slope };
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
  // control de calidad: una parábola que no sigue los puntos (terreno, vegetación, vigas) no es un arco
  const rise0 = polyval(c, yv) - zs;
  if (rms > Math.max(.15, .006 * L) || rise0 / L > .45 || rise0 / L < .03) return { ok: false, E, msg: `Los puntos bajo el tablero no forman un arco (error del ajuste ${(100 * rms).toFixed(0)} cm, flecha/luz ${(rise0 / L).toFixed(2)}). ¿Es un puente de vigas o armadura?` };
  return { ok: true, E, coef: c, inliers: F.inliers, vertexY: yv, rise: polyval(c, yv) - zs, L, rms, obs: Array.from(obs),
    completeness: { total: obs.reduce((a, b) => a + b, 0) / nb, arranque: Cz.arranque[0] / Cz.arranque[1], 'riñón': Cz['riñón'][0] / Cz['riñón'][1], clave: Cz.clave[0] / Cz.clave[1] } };
}
// revisión de coherencia de cada paso: avisos con nivel 'ok' | 'revisar' | 'error' (orientativos; no bloquean)
// banda típica de la primera frecuencia vertical según la luz: EN 1991-2, figura 6.10 (puentes ferroviarios):
// superior 94,76·L^-0,748; inferior 80/L (4–20 m) y 23,58·L^-0,592 (20–100 m). Se usa solo como referencia de orden de magnitud.
function f1Band(L) { L = Math.max(4, Math.min(100, L)); return { lo: L <= 20 ? 80 / L : 23.58 * Math.pow(L, -.592), hi: 94.76 * Math.pow(L, -.748) }; }
function coherence(step, d) {
  const out = [], add = (n, t) => out.push({ nivel: n, texto: t }), f = (v, k = 1) => Number(v).toFixed(k).replace('.', ',');
  if (step === 'nube') { const { largo, ancho, alto } = d;
    if (largo > 3000) add('error', `La nube mide ${f(largo, 0)} m de largo: ¿está en milímetros o centímetros? Revise «Unidades».`);
    else if (largo < 3) add('error', `La nube mide ${f(largo, 2)} m de largo: ¿está en kilómetros o mal escalada?`);
    else add('ok', `Tamaño razonable: ${f(largo, 0)} m de largo, ${f(alto, 0)} m de alto.`);
    if (alto > 1.2 * largo) add('revisar', 'La nube es más alta que larga: ¿el eje vertical es el correcto?');
    if (ancho > .45 * largo) add('revisar', 'La nube es muy ancha para su largo: puede incluir accesos, curvas u otras estructuras. Recorte un tramo recto.'); }
  if (step === 'apoyos') { const sp = d.spans || [], H = d.clearance;
    if (sp.length < 1) add('error', 'No hay vanos: faltan apoyos.');
    sp.forEach((L, i) => { if (L < 3) add('error', `El vano ${i + 1} mide ${f(L)} m: dos apoyos casi juntos; probablemente sobra uno.`); else if (L > 300) add('revisar', `El vano ${i + 1} mide ${f(L, 0)} m: inusual para un puente histórico.`); });
    for (let i = 1; i < sp.length; i++) { const r = sp[i] / sp[i - 1]; if (r > 3 || r < 1 / 3) add('revisar', `Los vanos ${i} y ${i + 1} son muy distintos (${f(sp[i - 1])} y ${f(sp[i])} m): revise si falta o sobra un apoyo.`); }
    if (H != null && H < 1) add('revisar', `El tablero queda solo ${f(H)} m sobre el terreno: revise la cota del tablero y la del terreno.`);
    (d.flags || []).forEach(t => add('revisar', t));
    if (!out.some(o => o.nivel !== 'ok') && sp.length) add('ok', `${sp.length} vano${sp.length > 1 ? 's' : ''} de ${sp.map(v => f(v)).join(', ')} m.`); }
  if (step === 'geometria') {
    if (d.tipo === 'arco') (d.arches || []).forEach((a, i) => { if (!a.ok) return; const r = a.rise / a.L;
      if (r < 1 / 12 || r > 1 / 2) add('revisar', `Arco ${i + 1}: flecha/luz = ${f(r, 2)}, fuera de lo habitual (1/12 a 1/2).`);
      if (a.rms > .1) add('revisar', `Arco ${i + 1}: la parábola se separa ${f(100 * a.rms, 0)} cm de los puntos; puede no ser una parábola o haber vegetación.`);
      if (a.comp && a.comp.total < .3) add('revisar', `Arco ${i + 1}: la nube solo muestra el ${f(100 * a.comp.total, 0)} % del arco.`); });
    else (d.spans || []).forEach((s, i) => { if (s.cov != null && s.cov < .3) add('revisar', `Vano ${i + 1}: la nube muestra poco de la parte inferior (${f(100 * s.cov, 0)} %).`); });
    if (!out.length) add('ok', 'La geometría es coherente con el tipo de puente elegido.'); }
  if (step === 'modos') { const L = d.Lmax, f1 = d.f1v; if (L && f1) { const b = f1Band(L);
      if (f1 < .5 * b.lo || f1 > 1.5 * b.hi) add('revisar', `La primera frecuencia vertical (${f(f1, 2)} Hz) está lejos de lo habitual para ${f(L, 0)} m de luz (${f(b.lo, 1)} a ${f(b.hi, 1)} Hz). Revise material, secciones y peso del tablero.`);
      else if (f1 < b.lo || f1 > b.hi) add('ok', `La primera frecuencia vertical (${f(f1, 2)} Hz) está algo ${f1 > b.hi ? 'por encima' : 'por debajo'} del rango habitual para ${f(L, 0)} m de luz (${f(b.lo, 1)} a ${f(b.hi, 1)} Hz), dentro del margen aceptado (×0,5 a ×1,5). ${f1 > b.hi ? 'Puede ser un tablero rígido o liviano, o luces cortas continuas.' : 'Puede ser un tablero pesado o flexible.'}`);
      else add('ok', `La primera frecuencia vertical (${f(f1, 2)} Hz) está dentro del rango habitual para ${f(L, 0)} m de luz (${f(b.lo, 1)} a ${f(b.hi, 1)} Hz).`); }
    if (d.massPerM != null) { if (d.massPerM < .3 || d.massPerM > 60) add('revisar', `La masa del tablero (${f(d.massPerM, 1)} t/m) parece ${d.massPerM < .3 ? 'muy baja' : 'muy alta'}. Revise densidad y peso del tablero.`); } }
  if (step === 'ia') { const m = d.metrics, Z = d.zonas; if (m) {
      if (m.localizacion < 2 / Z) add('revisar', `La IA acierta la zona casi como al azar (${f(100 * m.localizacion, 0)} % con ${Z} zonas). Use más sensores o confíe solo en el vano.`);
      if (m.falsaAlarma > .3) add('revisar', `Falsas alarmas altas (${f(100 * m.falsaAlarma, 0)} %): compare con una medición del puente sano antes de concluir.`);
      if (!out.length) add('ok', 'Los aciertos de la IA son coherentes con el número de zonas y de sensores.'); } }
  return out; }
// sugerencia de tipología a partir de la nube (orientativa; el usuario decide):
// arco si la parábola del intradós ajusta bien en los vanos; armadura si hay barras continuas 2,5–7 m sobre el tablero;
// torre alta sobre el tablero → posible puente atirantado o colgante (no soportado); si no, vigas.
function suggestType(O, deckTop, ground, sup, band, minPts, ends) {
  const [s0, s1] = bounds(O.s), nb = Math.max(1, Math.round((s1 - s0) / .5)), hiTr = new Uint16Array(nb);
  // franja transversal del tablero (puntos a la altura de la rodadura), ampliada 3 m a cada lado para incluir pilonos laterales
  const td = []; for (let i = 0; i < O.n; i += 7) if (Math.abs(O.z[i] - deckTop) < .3) td.push(O.t[i]); td.sort((a, b) => a - b);
  const tq = q => td.length ? td[Math.floor(q * (td.length - 1))] : 0, ta = tq(.05) - 3, tb = tq(.95) + 3, inT = i => O.t[i] >= ta && O.t[i] <= tb;
  // torre o pilono: columna que sube sin interrupción desde el tablero hasta más de 12 m sobre él (los cables aéreos y las copas de árboles no son continuos)
  const nl = 10, col = Array.from({ length: Math.ceil((s1 - s0) / 1) + 1 }, () => new Uint8Array(nl + 1));
  for (let i = 0; i < O.n; i++) { const k = Math.min(nb - 1, Math.floor((O.s[i] - s0) / .5)), dz = O.z[i] - deckTop; if (dz > 2.5 && dz < 7) hiTr[k]++; if (dz > 2 && inT(i)) { const L = Math.min(nl, Math.floor((dz - 2) / 1)); col[Math.floor(O.s[i] - s0)][L] = 1; } }
  // un pilono es angosto (2 a 6 m a lo largo del puente; un poste de luz ocupa menos) y está aislado: a su lado no hay nada por encima de 7 m. Una copa de árbol es ancha y difusa.
  const isCol = col.map(c => !!c[nl] && c.slice(0, nl).reduce((a, b) => a + b, 0) >= nl - 1), hi7 = col.map(c => c.slice(5).some(v => v));
  const sa = sup && sup.length >= 2 ? sup[0].a - s0 : 0, sb = sup && sup.length >= 2 ? sup[sup.length - 1].b - s0 : col.length;
  let tower = 0; for (let k = 0; k < col.length; k++) { if (!isCol[k]) continue; let e = k; while (e + 1 < col.length && hi7[e + 1]) e++; let b = k; while (b - 1 >= 0 && hi7[b - 1]) b--;
    const w = e - b + 1, ok = w >= 2 && w <= 6 && b >= 2 && e <= col.length - 3 && !hi7[b - 1] && !hi7[b - 2] && !hi7[e + 1] && !hi7[e + 2] && k >= sa - 2 && k <= sb + 2; if (ok) tower = 1; k = e; }
  const occ = a => a.filter(v => v >= 3).length / nb;
  let arcoOk = false, arcs = null;
  try { arcs = archAll(O, sup, band.zmin, band.zmax, minPts, ends); arcoOk = arcs.length > 0 && arcs.every(a => a.ok && a.rms <= Math.max(.1, .03 * a.rise)); } catch (e) {}
  // (para proponer «arco» la parábola debe ceñirse a los puntos: ≤ 10 cm o ≤ 3 % de la flecha; un fondo de cauce o un talud la siguen peor)
  const why = [];
  if (tower > .01) why.push('hay estructura alta sobre el tablero (torre o pilono)');
  let SS = []; try { SS = superestructura(O, deckTop, ground); } catch (e) { SS = []; }
  const pil = [].concat(...SS.filter(x => x.tipo === 'atirantado').map(x => x.pilonos)).sort((a, b) => a.s - b.s), arS = SS.filter(x => x.tipo === 'arco_superior' && x.L >= 30).sort((a, b) => b.L - a.L)[0], trS = SS.find(x => x.tipo === 'armadura' && x.L >= 30);
  const extra = { superestructura: SS }; tower = 0; why.length = 0;
  try { const C = composicion(SS, sup); if (C.length >= 2 && new Set(C.map(t => t.tipo)).size >= 2) extra.composicion = C; } catch (e) {}
  if (pil.length) { extra.pilonos = pil.map(p => p.s); if (pil.length >= 2) extra.vanoPrincipal = +(pil[pil.length - 1].s - pil[0].s).toFixed(1); why.push(`pilonos con cables rectos en ${pil.map(p => p.s.toFixed(1).replace('.', ',') + ' m').join(' y ')}${extra.vanoPrincipal ? ', vano principal ≈ ' + extra.vanoPrincipal.toFixed(1).replace('.', ',') + ' m' : ''}`); tower = 1; }
  if (arcoOk) return Object.assign({ tipo: 'arco', atirantado: tower > .01, why: ['los puntos bajo el tablero forman arcos'].concat(why) }, extra);
  // armadura: dos planos de barras, uno en cada borde del tablero, entre 3 y 9 m sobre la rodadura y en ≥ 70 % del largo entre apoyos extremos.
  // Se exige que estén los dos bordes para no confundir con vehículos (centro del tablero), árboles o postes (un solo lado, discontinuos).
  let chord = 0; { const a = Math.max(0, Math.floor(sa)), b = Math.min(col.length, Math.ceil(sb)), e0 = tq(.05), e1 = tq(.95), L = new Uint16Array(col.length), R = new Uint16Array(col.length);
    for (let i = 0; i < O.n; i++) { const dz = O.z[i] - deckTop; if (dz < 3 || dz >= 9) continue; const t = O.t[i], k = Math.floor(O.s[i] - s0); if (Math.abs(t - e0) <= 1.5) L[k]++; else if (Math.abs(t - e1) <= 1.5) R[k]++; }
    let cl = 0, cr = 0; for (let k = a; k < b; k++) { if (L[k] >= 5) cl++; if (R[k] >= 5) cr++; } chord = Math.min(cl, cr) / Math.max(1, b - a); }
  if (chord >= .7 && !pil.length) return Object.assign({ tipo: 'armadura', atirantado: false, why: ['hay barras continuas sobre el tablero, en ambos bordes y a lo largo de casi todo el puente'].concat(arS ? ['el cordón superior es curvo'] : []) }, extra);
  if (arS && !pil.length) { const la = arS.luzArco, ap = la && la.apoyos, Lc = la ? la.L : arS.L;
    extra.arcoSuperior = { a: la ? la.a : arS.a, b: la ? la.b : arS.b, L: Lc, flecha: arS.altura, parteAlta: arS.L, ...(ap ? { apoyos: ap } : {}) };
    return Object.assign({ tipo: 'viga', arcoSuperior: true, atirantado: false, why: [`hay un arco sobre el tablero (tablero inferior o arco atirantado) de ${arS.altura.toFixed(1).replace('.', ',')} m de flecha sobre la calzada; la parábola del arco corta la calzada con unos ${Lc.toFixed(0)} m de luz` + (ap ? ` y bajo la calzada hay pilas en ${ap.a.toFixed(0)} m y ${ap.b.toFixed(0)} m (≈ ${ap.L.toFixed(0)} m entre pilas, donde el arco arranca)` : '')] }, extra); }
  if (chord >= .7 && !tower) return Object.assign({ tipo: 'armadura', atirantado: false, why: ['hay barras continuas sobre el tablero, en ambos bordes y a lo largo de casi todo el puente'] }, extra);
  return Object.assign({ tipo: 'viga', atirantado: tower > .01, why: ['bajo el tablero no hay arcos'].concat(why) }, extra);
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
// incertidumbre de la geometría oculta (supuesto explícito, válido para cualquier puente):
// arcos: desviación típica de la flecha y de la altura de los arranques según la parte del intradós que la nube NO registró
//   σ_flecha = m·(rms + 0,12·f·(1 − C_clave)),  σ_arranque = m·(rms + 0,08·f·(1 − C_arranque))
// vigas y armaduras: la altura de la sección oculta se desconoce; factor lognormal de rigidez por vano σ = m·(0,03 + 0,15·(1 − cobertura))
// sin dato de cobertura se asume 0,5. m = 0 (ninguna), 1 (según la nube), 2 (doble).
function archRise(a) { const c = a.coef, yv = -c[1] / (2 * c[0]); return polyval(c, yv) - Math.min(polyval(c, a.a), polyval(c, a.b)); }
function geomSigmas(type, G, mult = 1) {
  if (type === 'arco') return { arches: (G.arches || []).map(a => { const o = a.obs || {}, R = o.rise != null ? o.rise : archRise(a), rms = o.rms != null ? o.rms : .02,
    cc = o.clave != null ? o.clave : .5, cs = o.arranque != null ? o.arranque : .5;
    return { rise: mult * (rms + .12 * R * (1 - cc)), spr: mult * (rms + .08 * R * (1 - cs)), known: !!a.obs }; }) };
  const n = Math.max(1, (G.supports || []).length - 1), cov = G.cover || [];
  return { spans: Array.from({ length: n }, (_, k) => mult * (.03 + .15 * (1 - (cov[k] != null ? cov[k] : .5)))), known: cov.length === n };
}
function perturbGeom(type, G, r, mult) {
  if (!mult) return { G, fac: null };
  const S = geomSigmas(type, G, mult), cl = v => Math.max(-2.5, Math.min(2.5, v));
  if (type === 'arco') {
    const arches = G.arches.map((a, i) => { const s = S.arches[i], dR = cl(gaussR(r)) * s.rise, dS = cl(gaussR(r)) * s.spr, L = a.b - a.a, ym = (a.a + a.b) / 2, k = (dS - dR) * 4 / (L * L), c = a.coef;
      // δ(y) = Δflecha·(1 − u²) + Δarranque·u², u = 2(y − ym)/L  (los arranques no se mueven en planta)
      let c2 = [c[0] + k, c[1] - 2 * k * ym, c[2] + k * ym * ym + dR]; if (c2[0] >= 0) c2 = c.slice();
      const yv = -c2[1] / (2 * c2[0]), top = G.deckAxis - .3; if (yv > a.a && yv < a.b && polyval(c2, yv) > top) c2[2] -= polyval(c2, yv) - top;
      return Object.assign({}, a, { coef: c2 }); });
    return { G: Object.assign({}, G, { arches }), fac: null };
  }
  return { G, fac: S.spans.map(sg => Math.exp(cl(gaussR(r)) * sg)) };
}
function campaign(type, G, p, opts, prog) {
  const r = mulberry(opts.seed || 7), NM = opts.NM || 8, fr0 = build(type, G, p), sens = sensorsOf(fr0), sdof = sens.map(s => s.dof);
  const b = modal(fr0, NM); const phi0 = signConvention(b.phi, sdof), f0 = b.f, Z = fr0.zoneDefs.length;
  const jobs = []; for (let i = 0; i < opts.nUndamaged; i++) jobs.push(-1); for (let z = 0; z < Z; z++) for (let i = 0; i < opts.nPerZone; i++) jobs.push(z);
  const rows = []; let t0 = Date.now();
  jobs.forEach((zz, n) => {
    const pp = Object.assign({}, p, { E: p.E * (1 + gaussR(r) * opts.unc / 2), w_deck: p.w_deck * (1 + gaussR(r) * opts.unc / 2) });
    const pg = perturbGeom(type, G, r, opts.geom || 0), fr = build(type, pg.G, pp), d = zz < 0 ? 0 : 0.05 + r() * 0.55, esc = new Float64Array(fr.el.length).fill(1);
    if (opts.modelErr) for (let t = 0; t < esc.length; t++) esc[t] = Math.exp(gaussR(r) * opts.modelErr);
    if (pg.fac) fr.zoneOf.forEach((z, t) => { if (z >= 0) esc[t] *= pg.fac[Math.min(pg.fac.length - 1, Math.floor(z / 3))]; });
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
    const pg = perturbGeom(type, G, r, opts.geom || 0), fr = build(type, pg.G, pp), d = zz < 0 ? 0 : 0.05 + r() * 0.55, esc = new Float64Array(fr.el.length).fill(1);
    // error de modelo: la rigidez real de cada elemento difiere de la supuesta (lognormal, σ = modelErr); evita entrenar y evaluar con el mismo modelo perfecto
    if (opts.modelErr) for (let t = 0; t < esc.length; t++) esc[t] = Math.exp(gaussR(r) * opts.modelErr);
    // geometría oculta: cada simulación usa una geometría plausible distinta según lo que la nube no registró
    if (pg.fac) fr.zoneOf.forEach((z, t) => { if (z >= 0) esc[t] *= pg.fac[Math.min(pg.fac.length - 1, Math.floor(z / 3))]; });
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

/* ---------- IA de apoyos: clasificador de puntos (fondo / tablero / apoyo) ----------
   Bosque aleatorio entrenado con los 6 puentes etiquetados de Lee (2026, Zenodo 18531104, CC BY 4.0).
   Rasgos geométricos por vóxel de 0,15 m (covarianza local a 0,4, 0,8 y 1,6 m, altura y columna en planta).
   Se usa como segunda opinión sobre los pilares que encuentra la regla geométrica. */
function eig3(a) {
  const A = [[a[0], a[1], a[2]], [a[1], a[3], a[4]], [a[2], a[4], a[5]]], V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let it = 0; it < 12; it++) {
    let p = 0, q = 1, m = Math.abs(A[0][1]);
    if (Math.abs(A[0][2]) > m) { p = 0; q = 2; m = Math.abs(A[0][2]); }
    if (Math.abs(A[1][2]) > m) { p = 1; q = 2; m = Math.abs(A[1][2]); }
    if (m < 1e-12) break;
    const th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
    for (let k = 0; k < 3; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
    for (let k = 0; k < 3; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
    for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
  }
  const idx = [0, 1, 2].sort((i, j) => A[j][j] - A[i][i]);
  return { l: idx.map(i => Math.max(A[i][i], 0)), v: idx.map(i => [V[0][i], V[1][i], V[2][i]]) };
}
const IA_SCALES = [0.4, 0.8, 1.6], IA_NAMES = [];
for (const c of IA_SCALES) for (const n of ['lin', 'pla', 'esf', 'vertN', 'vertP', 'llen']) IA_NAMES.push(n + '_' + c);
IA_NAMES.push('hRel', 'hTab', 'hLoc', 'spanCol', 'occCol', 'techo', 'debajo', 'distEje');
function iaFeatures(O, dk, gr, vox = 0.15) {
  const n = O.n, H = Math.max(dk - gr, 1), K3 = (a, b, d) => (a + 1e5) * 8e8 + (b + 1e5) * 4e3 + (d + 2000);
  const vm = new Map(), pv = new Int32Array(n), cx = [], cy = [], cz = [], cnt = [];
  for (let i = 0; i < n; i++) {
    const key = K3(Math.floor(O.s[i] / vox), Math.floor(O.t[i] / vox), Math.floor(O.z[i] / vox));
    let j = vm.get(key);
    if (j === undefined) { j = cx.length; vm.set(key, j); cx.push(0); cy.push(0); cz.push(0); cnt.push(0); }
    cx[j] += O.s[i]; cy[j] += O.t[i]; cz[j] += O.z[i]; cnt[j]++; pv[i] = j;
  }
  const nv = cx.length, X = new Float32Array(nv), Y = new Float32Array(nv), Z = new Float32Array(nv);
  for (let j = 0; j < nv; j++) { X[j] = cx[j] / cnt[j]; Y[j] = cy[j] / cnt[j]; Z[j] = cz[j] / cnt[j]; }
  const nf = IA_NAMES.length, F = new Float32Array(nv * nf);
  IA_SCALES.forEach((c, si) => {
    const g = new Map(), cell = new Int32Array(nv * 3);
    for (let j = 0; j < nv; j++) {
      const a = Math.floor(X[j] / c), b = Math.floor(Y[j] / c), d = Math.floor(Z[j] / c); cell[3 * j] = a; cell[3 * j + 1] = b; cell[3 * j + 2] = d;
      const k = K3(a, b, d); let m = g.get(k); if (!m) { m = new Float64Array(10); g.set(k, m); }
      const x = X[j], y = Y[j], z = Z[j]; m[0]++; m[1] += x; m[2] += y; m[3] += z; m[4] += x * x; m[5] += x * y; m[6] += x * z; m[7] += y * y; m[8] += y * z; m[9] += z * z;
    }
    const memo = new Map();
    for (let j = 0; j < nv; j++) {
      const a = cell[3 * j], b = cell[3 * j + 1], d = cell[3 * j + 2], k0 = K3(a, b, d);
      let r = memo.get(k0);
      if (!r) {
        const s = new Float64Array(10);
        for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) for (let dd = -1; dd <= 1; dd++) { const m = g.get(K3(a + da, b + db, d + dd)); if (m) for (let q = 0; q < 10; q++) s[q] += m[q]; }
        const N = s[0], mx = s[1] / N, my = s[2] / N, mz = s[3] / N; r = new Float32Array(6);
        if (N >= 4) {
          const e = eig3([s[4] / N - mx * mx, s[5] / N - mx * my, s[6] / N - mx * mz, s[7] / N - my * my, s[8] / N - my * mz, s[9] / N - mz * mz]), l1 = e.l[0] + 1e-9;
          r[0] = (e.l[0] - e.l[1]) / l1; r[1] = (e.l[1] - e.l[2]) / l1; r[2] = e.l[2] / l1; r[3] = 1 - Math.abs(e.v[2][2]); r[4] = Math.abs(e.v[0][2]);
          r[5] = Math.min(N / Math.pow(3 * c / vox, 2) / 9, 3);
        } else r[5] = N / Math.pow(3 * c / vox, 2) / 9;
        memo.set(k0, r);
      }
      for (let q = 0; q < 6; q++) F[j * nf + si * 6 + q] = r[q];
    }
  });
  const cc = 0.5, col = new Map(), ck = (a, b) => (a + 1e5) * 2e5 + (b + 1e5);
  for (let j = 0; j < nv; j++) {
    const k = ck(Math.floor(X[j] / cc), Math.floor(Y[j] / cc)); let m = col.get(k);
    if (!m) { m = { zmin: 1e9, zmax: -1e9, lv: new Set(), techo: 0 }; col.set(k, m); }
    if (Z[j] < m.zmin) m.zmin = Z[j]; if (Z[j] > m.zmax) m.zmax = Z[j];
    if (Z[j] < dk - 0.8) m.lv.add(Math.floor((Z[j] - gr) / 0.3));
    if (Math.abs(Z[j] - dk) < 1.0) m.techo = 1;
  }
  const gm = new Map();
  for (let j = 0; j < nv; j++) { const k = ck(Math.floor(X[j]), Math.floor(Y[j])); const v = gm.get(k); if (v === undefined || Z[j] < v) gm.set(k, Z[j]); }
  const tt = []; for (let j = 0; j < nv; j++) if (Math.abs(Z[j] - dk) < 0.5) tt.push(Y[j]); tt.sort((a, b) => a - b);
  const tm = tt.length ? tt[tt.length >> 1] : 0, hw = tt.length ? Math.max((tt[Math.floor(tt.length * .97)] - tt[Math.floor(tt.length * .03)]) / 2, 1) : 5, o = IA_SCALES.length * 6;
  for (let j = 0; j < nv; j++) {
    const a = Math.floor(X[j] / cc), b = Math.floor(Y[j] / cc), m = col.get(ck(a, b));
    let gl = 1e9; const ga = Math.floor(X[j]), gb = Math.floor(Y[j]);
    for (let da = -2; da <= 2; da++) for (let db = -2; db <= 2; db++) { const v = gm.get(ck(ga + da, gb + db)); if (v !== undefined && v < gl) gl = v; }
    const nlev = Math.max(1, Math.floor((dk - 0.8 - Math.max(gl, gr)) / 0.3));
    F[j * nf + o] = (Z[j] - gr) / H; F[j * nf + o + 1] = (Z[j] - dk) / H; F[j * nf + o + 2] = Math.min((Z[j] - gl) / H, 2);
    F[j * nf + o + 3] = (m.zmax - m.zmin) / H; F[j * nf + o + 4] = Math.min(m.lv.size / nlev, 1.5);
    let techo = 0; for (let da = -1; da <= 1 && !techo; da++) for (let db = -1; db <= 1; db++) { const q = col.get(ck(a + da, b + db)); if (q && q.techo) { techo = 1; break; } }
    F[j * nf + o + 5] = techo; F[j * nf + o + 6] = Z[j] < dk - 1 ? 1 : 0; F[j * nf + o + 7] = Math.min(Math.abs(Y[j] - tm) / hw, 3);
  }
  return { F, nf, nv, pv, X, Y, Z, names: IA_NAMES };
}
function iaPredict(model, F, nf, nv) {
  const K = model.clases.length, P = new Float32Array(nv * K);
  for (const T of model.arboles) for (let j = 0; j < nv; j++) {
    let k = 0; while (T.l[k] >= 0) k = F[j * nf + T.f[k]] <= T.t[k] ? T.l[k] : T.r[k];
    const v = T.v[k]; for (let c = 0; c < K; c++) P[j * K + c] += v[c];
  }
  const m = model.arboles.length; for (let i = 0; i < P.length; i++) P[i] /= m;
  return P;
}
// Grupos de vóxeles «apoyo» con cara vertical en la parte baja del gálibo, a lo largo del eje (celdas de 0,5 m).
function iaClusters(R, P, dk, gr) {
  let s0 = 1e9, s1 = -1e9; for (const x of R.X) { if (x < s0) s0 = x; if (x > s1) s1 = x; }
  const bw = .5, nb = Math.ceil((s1 - s0) / bw) + 1, cnt = new Float32Array(nb), lg = new Float32Array(nb).fill(1e9), nf = R.nf;
  for (let j = 0; j < R.nv; j++) { const b = Math.floor((R.X[j] - s0) / bw); if (R.Z[j] < lg[b]) lg[b] = R.Z[j]; }
  const lg2 = lg.map((v, b) => { let m = v; for (let k = Math.max(0, b - 4); k <= Math.min(nb - 1, b + 4); k++) m = Math.min(m, lg[k]); return Math.max(m, gr); });
  const sup = j => P[j * 3 + 2] > .5;
  for (let j = 0; j < R.nv; j++) { const b = Math.floor((R.X[j] - s0) / bw); if (R.Z[j] < lg2[b] + .6 * (dk - lg2[b]) && sup(j) && R.F[j * nf + 9] > .6) cnt[b]++; }
  let mx = 0; for (const v of cnt) if (v > mx) mx = v; if (!mx) return [];
  const thr = Math.max(5, .03 * mx), C = []; let cur = null;
  for (let b = 0; b < nb; b++) if (cnt[b] >= thr) { if (cur && b - cur.b <= 2) cur.b = b; else { cur = { a: b, b }; C.push(cur); } }
  return C.map(c => {
    const a = s0 + c.a * bw, b = s0 + (c.b + 1) * bw; let g = 1e9; for (let k = Math.max(0, c.a - 2); k <= Math.min(nb - 1, c.b + 2); k++) g = Math.min(g, lg[k]);
    let pk = 0, ka = -1, kb = -1; for (let k = c.a; k <= c.b; k++) pk = Math.max(pk, cnt[k]); for (let k = c.a; k <= c.b; k++) if (cnt[k] >= .5 * pk) { if (ka < 0) ka = k; kb = k; }
    const lv = new Set(), ss = [], tq = [], zz = []; let n = 0;
    for (let j = 0; j < R.nv; j++) {
      if (R.X[j] < a || R.X[j] > b || !sup(j)) continue; if (R.Z[j] < dk) zz.push(R.Z[j]);
      if (R.Z[j] >= dk - 1 || R.F[j * nf + 9] <= .6) continue; n++; ss.push(R.X[j]); tq.push(R.Y[j]); lv.add(Math.floor((R.Z[j] - g) / .3));
    }
    if (!n) return null; ss.sort((x, y) => x - y); tq.sort((x, y) => x - y); zz.sort((x, y) => x - y);
    const nl = Math.max(1, Math.floor((dk - 1 - g) / .3)); let occ = 0; for (let k = 0; k < nl; k++) if (lv.has(k)) occ++;
    let nuc = 0; for (let k = c.a; k <= c.b; k++) if (cnt[k] >= .5 * pk) nuc++;
    return { s: (ss[Math.floor(n * .1)] + ss[Math.floor(n * .9)]) / 2, a: s0 + ka * bw, b: s0 + (kb + 1) * bw, n, pico: pk / mx, nucleo: nuc * bw, cont: occ / nl, altura: dk - g,
      techo: dk - zz[Math.floor(zz.length * .98)], fondo: zz[Math.floor(zz.length * .02)] - g, anchoT: tq[Math.floor(n * .9)] - tq[Math.floor(n * .1)] };
  }).filter(Boolean);
}
// Segunda opinión de la IA sobre los apoyos de la regla geométrica.
// Umbrales elegidos con el banco de pruebas (puentes coreanos con modelos que no los vieron, 20 puentes TLS, Balta y Rayitos).
const IA_REGLA = { HMAX: 10, VETO: .15, DV: 1.5, PICO: .6, NMIN: 300, NUC: 1.5, TECHO: 1.8, FONDO: 1.5, WK: 1.2, WA: .5, REFP: .6 };
function iaRefine(O, dk, gr, supports, model, U = IA_REGLA) {
  const R = iaFeatures(O, dk, gr), P = iaPredict(model, R.F, R.nf, R.nv), C = iaClusters(R, P, dk, gr);
  const H = C.reduce((m, c) => Math.max(m, c.altura), 0), out = { supports: supports.map(p => ({ ...p })), veto: [], rescate: [], aEstribo: [], clusters: C, usado: false, R };
  if (!C.length) { out.motivo = 'la IA no encontró columnas bajo el tablero'; return out; }
  if (H > U.HMAX) { out.motivo = `gálibo de ${H.toFixed(0)} m, fuera del rango con que se entrenó la IA (hasta unos 8 m)`; return out; }
  out.usado = true;
  const near = (p, th) => C.filter(c => c.s >= p.a - U.DV && c.s <= p.b + U.DV && c.pico >= th);
  let S = out.supports.sort((p, q) => p.a - q.a);
  S = S.filter((p, i) => {
    if (p.tipo !== 'pilar' || near(p, U.VETO).length) return true;
    if (i > 0 && i < S.length - 1) { out.veto.push(p); return false; }
    p.tipo = 'estribo'; p.auto = 'ia'; p.duda = 'La IA no ve una columna en este extremo; se tomó como estribo. Confirme.'; out.aEstribo.push(p); return true;
  });
  const ref = []; for (const p of S) if (p.tipo === 'pilar') for (const c of near(p, U.REFP)) ref.push(c.anchoT);
  ref.sort((x, y) => x - y); const wmax = ref.length ? U.WK * ref[ref.length >> 1] + U.WA : 1e9;
  for (const c of C) {
    if (c.pico < U.PICO || c.n < U.NMIN || c.nucleo > U.NUC || c.techo > U.TECHO || c.fondo > U.FONDO || c.anchoT > wmax) continue;
    if (S.some(p => Math.abs(c.s - (p.a + p.b) / 2) <= 3)) continue;
    const q = { a: +c.a.toFixed(2), b: +c.b.toFixed(2), tipo: 'pilar', auto: 'ia', duda: `Lo propuso la IA: ve una columna de ${c.altura.toFixed(1).replace('.', ',')} m bajo el tablero que la regla geométrica no encontró. Confirme.` };
    S.push(q); out.rescate.push(q);
  }
  out.supports = S.sort((p, q) => p.a - q.a);
  return out;
}
/* ---------- Hipótesis de puente completo ----------
   Arma las interpretaciones posibles (estribo izquierdo, pilares, estribo derecho) y elige la más creíble:
   evidencia de la nube (regla geométrica + IA de apoyos) + restricciones físicas + conocimiento de diseño
   (vanos regulares, vanos extremos de 0,6 a 1,05 veces los interiores, simetría). */
const HIP_W = { G: .7, GD: .6, RV: .3, K: .6, CLIP: 3, PCLR: 2, SPCLR: 1.5, SPFR: .75, MINS: 4, BETA: 1, GAMMA: .5, OPEN: .4, BON: 1, BTER: .5, BEXT: .3, BWALL: .5, ABCLR: 4.5, ALFA: .5, CAB: 1.5 };
function clearanceProfile(O, dk, bw = .5) {
  const tt = []; for (let i = 0; i < O.n; i++) if (Math.abs(O.z[i] - dk) < .3) tt.push(O.t[i]); tt.sort((a, b) => a - b);
  const tm = tt.length ? tt[tt.length >> 1] : 0, hw = tt.length ? (tt[Math.floor(tt.length * .95)] - tt[Math.floor(tt.length * .05)]) / 2 : 5;
  let s0 = 1e9, s1 = -1e9; for (let i = 0; i < O.n; i++) { if (O.s[i] < s0) s0 = O.s[i]; if (O.s[i] > s1) s1 = O.s[i]; }
  const nb = Math.ceil((s1 - s0) / bw) + 1, g = new Float32Array(nb).fill(NaN);
  for (let i = 0; i < O.n; i++) { if (Math.abs(O.t[i] - tm) > .7 * hw || O.z[i] > dk - .3) continue; const b = Math.floor((O.s[i] - s0) / bw); if (!(g[b] <= O.z[i])) g[b] = O.z[i]; }
  const prof = Array.from(g, v => v === v ? dk - v : null);
  const clr = s => { const b = Math.floor((s - s0) / bw); let v = null; for (let k = b - 1; k <= b + 1; k++) if (k >= 0 && k < nb && prof[k] != null) v = v == null ? prof[k] : Math.min(v, prof[k]); return v; };
  const ss = []; for (let i = 0; i < O.n; i++) if (Math.abs(O.z[i] - dk) < .3) ss.push(O.s[i]); ss.sort((a, b) => a - b);
  return { prof, s0, bw, clr, d0: ss[Math.floor(ss.length * .01)], d1: ss[Math.floor(ss.length * .99)] };
}
function hipotesis(O, dk, gr, geo, ia, W = HIP_W) {
  const CP = clearanceProfile(O, dk), mid = p => (p.a + p.b) / 2, antes = (ia && ia.usado ? ia.supports : geo).slice().sort((p, q) => p.a - q.a);
  // candidatos a pilar
  const C = [], add = (s, e, src, ref) => { const q = C.find(x => Math.abs(x.s - s) <= 2); if (q) { q.e = Math.max(q.e, e); q.src += src; if (ref && !q.ref) q.ref = ref; } else C.push({ s, e, src, ref }); };
  for (const p of antes) if (p.tipo === 'pilar') add(mid(p), p.duda ? W.GD : W.G, 'p', p);
  if (ia && ia.usado) {
    for (const k of ia.clusters) if (k.pico >= .25 && k.n >= 150) add(k.s, W.K * k.pico, 'c', { a: +k.a.toFixed(2), b: +k.b.toFixed(2), tipo: 'pilar', auto: 'hipotesis' });
    for (const p of ia.veto) add(mid(p), W.RV, 'v', p);
  }
  for (const q of C) { const e = Math.min(Math.max(q.e, 1e-3), 1 - 1e-3); q.llr = Math.max(-W.CLIP, Math.min(W.CLIP, Math.log(e / (1 - e)))); q.clr = CP.clr(q.s); }
  const P0 = C.filter(q => q.clr == null || q.clr > W.PCLR).sort((p, q) => p.s - q.s);
  // candidatos a estribo
  const BON = { '': W.BON, iaface: W.BON, hueco: W.BON, terreno: W.BTER, extremo: W.BEXT, ia: W.BEXT }, AB = [];
  for (const p of antes) if (p.tipo === 'estribo') AB.push({ s: mid(p), bon: BON[p.auto || ''] ?? W.BEXT, clr: null, ref: p });
  const addA = (s, bon, ref) => { if (s < CP.d0 - 2 || s > CP.d1 + 2 || AB.some(b => Math.abs(b.s - s) < 1.5)) return; AB.push({ s, bon, clr: CP.clr(s), ref }); };
  for (const p of geo) if (p.tipo === 'pilar') { const c = CP.clr(mid(p)); if (c != null && c <= W.ABCLR) addA(mid(p), W.BWALL, p); }
  for (let b = 1; b < CP.prof.length; b++) { const u = CP.prof[b - 1], v = CP.prof[b]; if (u != null && v != null && (u - 2) * (v - 2) < 0) addA(CP.s0 + b * CP.bw, 0); }
  addA(CP.d0, 0); addA(CP.d1, 0);
  const abSc = a => !a ? 0 : a.bon ? a.bon : -W.ALFA * (a.clr != null ? Math.max(0, a.clr - W.CAB) : 1);
  const fr = (a, b) => { const v = []; for (let k = Math.max(0, Math.floor((a - CP.s0) / CP.bw)); k <= Math.floor((b - CP.s0) / CP.bw) && k < CP.prof.length; k++) if (CP.prof[k] != null) v.push(CP.prof[k]); return v.length >= 4 ? v.filter(x => x >= W.SPCLR).length / v.length : 1; };
  const prior = L => { const n = L.length, m = L.slice().sort((x, y) => x - y)[n >> 1]; let p = 0;
    L.forEach((l, i) => { const r = Math.log(l / m); if (i === 0 || i === n - 1) { if (n > 1) p += Math.max(0, Math.log(.6) - r, r - Math.log(1.05)); } else p += Math.abs(r); });
    let sy = 0; for (let i = 0; i < n; i++) sy += Math.abs(L[i] - L[n - 1 - i]); const mean = L.reduce((a, b) => a + b) / n; return -W.BETA * p - W.GAMMA * sy / mean / n; };
  let best = null;
  for (const AL of [null, ...AB]) for (const AR of [null, ...AB]) {
    if (AL && AR && AR.s - AL.s < W.MINS) continue;
    const lo = AL ? AL.s : -1e9, hi = AR ? AR.s : 1e9, cand = P0.filter(q => q.s > lo + 2 && q.s < hi - 2); if (cand.length > 14) continue;
    for (let mask = 0; mask < (1 << cand.length); mask++) {
      const P = cand.filter((_, i) => mask >> i & 1); if ((!AL || !AR) && !P.length) continue;
      const pos = [...(AL ? [AL.s] : []), ...P.map(q => q.s), ...(AR ? [AR.s] : [])], L = []; for (let i = 1; i < pos.length; i++) L.push(pos[i] - pos[i - 1]);
      if (L.some(l => l < W.MINS)) continue; let ok = true; for (let i = 1; i < pos.length && ok; i++) if (fr(pos[i - 1], pos[i]) < W.SPFR) ok = false; if (!ok) continue;
      const Lf = [...(AL ? [] : [L[0] || 1]), ...L, ...(AR ? [] : [L[L.length - 1] || 1])];
      const sc = P.reduce((s, q) => s + q.llr, 0) + abSc(AL) + abSc(AR) + prior(Lf) - (AL ? 0 : W.OPEN) - (AR ? 0 : W.OPEN);
      if (!best || sc > best.sc) best = { sc, AL, AR, P, Lf };
    }
  }
  if (!best) return { supports: antes.map(p => ({ ...p })), cambios: [], usado: false };
  const asE = a => a.ref ? { ...a.ref, tipo: 'estribo', ...(a.ref.tipo === 'pilar' ? { auto: 'hipotesis', duda: 'La interpretación del puente completo tomó este muro como estribo. Confirme.' } : {}) } : { a: +a.s.toFixed(2), b: +a.s.toFixed(2), tipo: 'estribo', auto: 'hipotesis', duda: 'Estribo puesto por la interpretación del puente completo, donde el terreno llega al tablero. Confirme.' };
  const out = [...(best.AL ? [asE(best.AL)] : []), ...best.P.map(q => q.ref.tipo === 'pilar' && q.ref.auto !== 'hipotesis' && !q.src.startsWith('v') ? { ...q.ref } : { ...q.ref, tipo: 'pilar', auto: 'hipotesis', duda: 'Pilar propuesto por la interpretación del puente completo (vanos regulares). Confirme.' }), ...(best.AR ? [asE(best.AR)] : [])].sort((p, q) => p.a - q.a);
  const key = p => p.tipo[0] + Math.round(mid(p)), k0 = new Set(antes.map(key)), k1 = new Set(out.map(key));
  const cambios = { quitados: antes.filter(p => !k1.has(key(p))).map(p => ({ tipo: p.tipo, s: +mid(p).toFixed(1) })), agregados: out.filter(p => !k0.has(key(p))).map(p => ({ tipo: p.tipo, s: +mid(p).toFixed(1) })) };
  return { supports: out, cambios, usado: true, vanos: best.Lf.length, abiertos: [!best.AL, !best.AR], puntaje: best.sc };
}

/* ---------- IA de estribos: cara del estribo ----------
   Bosque aleatorio entrenado con los estribos etiquetados de 20 puentes escaneados con láser terrestre
   (Zenodo 18738225, CC BY 4.0). La cara se busca solo más allá del último pilar: dentro del puente la IA confunde pilares con estribos. */
const EST_W = { P: .5, DEJE: 1.2, NMIN: 200, FR: .45, Q: .9, MINS: 4, DMAX: 6, DPIL: 4 };
function iaEstribos(R, Pe, dk, supports, W = EST_W) {
  const nf = R.nf, ss = []; for (let j = 0; j < R.nv; j++) if (Math.abs(R.Z[j] - dk) < .3) ss.push(R.X[j]); ss.sort((a, b) => a - b);
  const out = supports.map(p => ({ ...p })).sort((p, q) => p.a - q.a), cambios = [];
  if (ss.length < 100) return { supports: out, cambios };
  const d0 = ss[Math.floor(ss.length * .01)], d1 = ss[Math.floor(ss.length * .99)], mid = p => (p.a + p.b) / 2, pil = out.filter(p => p.tipo === 'pilar').map(mid);
  const lo = pil.length ? Math.min(...pil) - 2 : d0 + W.FR * (d1 - d0), hi = pil.length ? Math.max(...pil) + 2 : d1 - W.FR * (d1 - d0);
  const L = [], Rr = []; for (let j = 0; j < R.nv; j++) { if (Pe[j * 2 + 1] <= W.P || R.Z[j] >= dk - .5 || R.F[j * nf + 25] >= W.DEJE) continue; if (R.X[j] < lo) L.push(R.X[j]); else if (R.X[j] > hi) Rr.push(R.X[j]); }
  L.sort((a, b) => a - b); Rr.sort((a, b) => a - b);
  const msg = 'Cara del estribo ubicada por la IA de estribos. Confirme.';
  if (L.length >= W.NMIN) { const f = +L[Math.floor(L.length * W.Q)].toFixed(2), e = out[0];
    if (pil.length && Math.min(...pil) - f < W.DPIL) {} else if (e && e.tipo === 'estribo') { if (Math.abs(mid(e) - f) > W.DMAX) {} else { if (Math.abs(mid(e) - f) > .3) cambios.push({ lado: 'izquierdo', de: +mid(e).toFixed(1), a: f }); Object.assign(e, { a: f, b: f, auto: 'iaface', duda: msg }); } }
    else if (!e || mid(e) - f >= W.MINS) { out.unshift({ a: f, b: f, tipo: 'estribo', auto: 'iaface', duda: msg }); cambios.push({ lado: 'izquierdo', de: null, a: f }); } }
  if (Rr.length >= W.NMIN) { const f = +Rr[Math.floor(Rr.length * (1 - W.Q))].toFixed(2), e = out[out.length - 1];
    if (pil.length && f - Math.max(...pil) < W.DPIL) {} else if (e && e.tipo === 'estribo') { if (Math.abs(mid(e) - f) > W.DMAX) {} else { if (Math.abs(mid(e) - f) > .3) cambios.push({ lado: 'derecho', de: +mid(e).toFixed(1), a: f }); Object.assign(e, { a: f, b: f, auto: 'iaface', duda: msg }); } }
    else if (!e || f - mid(e) >= W.MINS) { out.push({ a: f, b: f, tipo: 'estribo', auto: 'iaface', duda: msg }); cambios.push({ lado: 'derecho', de: null, a: f }); } }
  return { supports: out, cambios };
}

/* ---------- Estribos por el fin del hueco bajo el tablero ----------
   Teoría: un puente termina donde su superestructura deja de tener espacio libre debajo, porque ahí se apoya en el estribo;
   más allá, la calzada va sobre terreno macizo. En cada celda de 0,5 m del eje se busca bajo el tablero una separación vertical
   ≥ 0,8 m; la región principal con hueco (uniendo cortes ≤ 4 m, que son pilas) da las caras de los estribos. */
const GAP_W = { TH: .8, TOL: 4, CONV: 2.5, DMAX: 12, CORE: .5, BW: .5 };
function gapProfile(O, dk, gr, W = GAP_W) {
  const tt = []; for (let i = 0; i < O.n; i++) if (Math.abs(O.z[i] - dk) < .3) tt.push(O.t[i]); tt.sort((a, b) => a - b);
  if (tt.length < 50) return null;
  const tm = tt[tt.length >> 1], hw = (tt[Math.floor(tt.length * .95)] - tt[Math.floor(tt.length * .05)]) / 2;
  let s0 = 1e9, s1 = -1e9; for (let i = 0; i < O.n; i++) { if (O.s[i] < s0) s0 = O.s[i]; if (O.s[i] > s1) s1 = O.s[i]; }
  const bw = W.BW, nb = Math.ceil((s1 - s0) / bw) + 1, Z = Array.from({ length: nb }, () => []);
  for (let i = 0; i < O.n; i++) { if (Math.abs(O.t[i] - tm) > W.CORE * hw || O.z[i] > dk - .15) continue; Z[Math.floor((O.s[i] - s0) / bw)].push(O.z[i]); }
  const gap = new Array(nb).fill(null);
  for (let b = 0; b < nb; b++) { const z = Z[b].sort((a, c) => c - a); if (!z.length) continue; let top = dk, g = 0;
    for (let k = 0; k < z.length; k++) { if (top - z[k] >= 1) { g = top - z[k]; break; } top = z[k]; }
    gap[b] = g ? g : (top - gr >= 1 && z[z.length - 1] > gr + 1 ? null : 0); }
  return { s0, bw, nb, gap };
}
function gapEnds(G, W = GAP_W) {
  if (!G) return null; const { gap, nb, bw, s0 } = G, ok = gap.map(g => g != null && g >= W.TH), unk = gap.map(g => g == null), runs = [];
  for (let i = 0; i < nb;) { if (ok[i]) { let j = i; while (j + 1 < nb && (ok[j + 1] || unk[j + 1])) j++; while (j > i && unk[j]) j--; runs.push([i, j]); i = j + 1; } else i++; }
  if (!runs.length) return null; const M = [runs[0]]; for (const r of runs.slice(1)) { if ((r[0] - M[M.length - 1][1]) * bw <= W.TOL) M[M.length - 1][1] = r[1]; else M.push(r); }
  const b = M.reduce((x, y) => y[1] - y[0] > x[1] - x[0] ? y : x);
  return { L: s0 + b[0] * bw, R: s0 + (b[1] + 1) * bw, abiertoL: b[0] * bw < 1.5, abiertoR: (nb - 1 - b[1]) * bw < 1.5 };
}
/* Puentes de arco: un montante o la zona de arranque, con nube densa, pasa las pruebas de «pilar». Si el intradós a ambos lados de un apoyo
   intermedio es un mismo arco (la parábola del tramo unido ajusta tan bien como las de cada lado y es un arco de verdad: flecha ≥ 6 % de la luz),
   ese apoyo no es un pilar y se quita. En los extremos, si el arco sigue más allá del estribo, el estribo se lleva al arranque simétrico. */
function arcoContinuo(O, dk, gr, S, cambios) { const zmin = gr + .2 * (dk - gr), zmax = dk - .38, mp = Math.max(3, Math.round(15 * Math.min(1, O.n / 601243)));
  const G = (a, b) => b - a > 3 ? archGeometry(O, { a, b }, zmin, zmax, mp) : { ok: false }, bueno = (g, L) => g.ok && g.rise >= .06 * L;
  for (let it = 0; it < 6; it++) { let quitado = false;
    for (let k = 1; k < S.length - 1; k++) { const p = S[k]; if (p.tipo !== 'pilar') continue; const a = S[k - 1].b, b = S[k + 1].a, L = G(a, p.a), R = G(p.b, b), M = G(a, b);
      /* un lado muy corto (< 6 m, junto a un estribo) no alcanza para su propia parábola: basta que el arco unido ajuste bien */
      const corto = (!L.ok && p.a - a < 6) || (!R.ok && b - p.b < 6); if ((!L.ok || !R.ok) && !corto || !bueno(M, b - a)) continue; const yv = -M.coef[1] / (2 * M.coef[0]); if (yv < a + .2 * (b - a) || yv > b - .2 * (b - a)) continue;
      if (M.rms <= (corto ? .02 : Math.max(.02, 1.5 * Math.max(L.rms || 0, R.rms || 0)))) { cambios.push({ tipo: 'montante', s: +((p.a + p.b) / 2).toFixed(1) }); S.splice(k, 1); quitado = true; break; } }
    if (!quitado) break; }
  for (const [i, j, dir] of [[0, 1, -1], [S.length - 1, S.length - 2, 1]]) { const e = S[i], n = S[j]; if (!e || !n || e.tipo !== 'estribo') continue;
    const a = dir < 0 ? e.b : n.b, b = dir < 0 ? n.a : e.a, g = G(a, b); if (!bueno(g, b - a)) continue; const yv = -g.coef[1] / (2 * g.coef[0]), sym = 2 * yv - (dir < 0 ? b : a);
    if ((dir < 0 ? e.a - sym : sym - e.b) < 2) continue; const g2 = dir < 0 ? G(sym, b) : G(a, sym);
    if (g2.ok && g2.rms <= 1.5 * g.rms + .005 && g2.E && g2.E.yc.length >= 1.1 * g.E.yc.length) { cambios.push({ tipo: 'movido', lado: dir < 0 ? 'izquierdo' : 'derecho', de: +((e.a + e.b) / 2).toFixed(1), a: +sym.toFixed(1), motivo: 'arco' }); S[i] = { ...e, a: +sym.toFixed(2), b: +sym.toFixed(2), auto: 'arco', duda: 'El arco sigue más allá: el estribo se puso en el arranque simétrico del arco. Confirme.' }; } } }
function estribosHueco(O, dk, gr, supports, W = GAP_W) {
  const GP = gapProfile(O, dk, gr, W), E = gapEnds(GP, W), m = p => (p.a + p.b) / 2, cambios = [];
  // mediana del hueco entre dos posiciones (para saber si «más allá» sigue habiendo un vano de verdad)
  const medGap = (x0, x1) => { if (!GP) return 0; const v = []; for (let b = Math.max(0, Math.floor((Math.min(x0, x1) - GP.s0) / GP.bw)); b <= Math.min(GP.nb - 1, Math.floor((Math.max(x0, x1) - GP.s0) / GP.bw)); b++) if (GP.gap[b] != null && GP.gap[b] > 0) v.push(GP.gap[b]); v.sort((a, c) => a - c); return v.length ? v[v.length >> 1] : 0; };
  let S = supports.map(p => ({ ...p })).sort((p, q) => p.a - q.a); if (!E) { arcoContinuo(O, dk, gr, S, cambios); return { supports: S, cambios }; }
  const msg = 'Estribo donde termina el espacio libre bajo el tablero (ahí se apoya la superestructura). Confirme.';
  const lado = (end, isL) => { if (isL ? E.abiertoL : E.abiertoR) return; end = +end.toFixed(2); const i = isL ? 0 : S.length - 1, p = S[i], nm = isL ? 'izquierdo' : 'derecho';
    if (p && p.tipo === 'pilar' && Math.abs(m(p) - end) <= W.CONV) { cambios.push({ tipo: 'a_estribo', lado: nm, de: +m(p).toFixed(1), a: end }); S[i] = { a: end, b: end, tipo: 'estribo', auto: 'hueco', duda: msg }; return; }
    if (p && p.tipo === 'estribo' && (isL ? m(p) - end : end - m(p)) > 4 && medGap(m(p), end) >= .5 * medGap(E.L, E.R)) { // el hueco sigue más allá del «estribo»: era una pila
      /* un «estribo» puesto solo por el terreno (sin cara vertical medida) no se vuelve pilar: se mueve al final del hueco */
      if (p.auto === 'terreno' && !p.caraCerca) { cambios.push({ tipo: 'movido', lado: nm, de: +m(p).toFixed(1), a: end }); S[i] = { ...p, a: end, b: end, auto: 'hueco', duda: msg }; return; }
      cambios.push({ tipo: 'a_pilar', lado: nm, de: +m(p).toFixed(1), a: end }); S[i] = { ...p, tipo: 'pilar', auto: 'hueco', duda: 'El espacio libre bajo el tablero continúa más allá: se tomó como pilar. Confirme.' };
      const q = { a: end, b: end, tipo: 'estribo', auto: 'hueco', duda: msg }; isL ? S.unshift(q) : S.push(q); return; }
    if (p && p.tipo === 'estribo') { if (Math.abs(m(p) - end) <= W.DMAX && Math.abs(m(p) - end) > .3) { cambios.push({ tipo: 'movido', lado: nm, de: +m(p).toFixed(1), a: end }); S[i] = { ...p, a: end, b: end, auto: 'hueco', duda: msg }; } return; }
    if (!p || (isL ? m(p) - end : end - m(p)) >= 4) { cambios.push({ tipo: 'agregado', lado: nm, a: end }); const q = { a: end, b: end, tipo: 'estribo', auto: 'hueco', duda: msg }; isL ? S.unshift(q) : S.push(q); } };
  lado(E.L, true); lado(E.R, false);
  // pilares fuera del puente (sobre el terraplén), después de convertir los extremos
  const fuera = S.filter(p => p.tipo === 'pilar' && ((!E.abiertoL && m(p) < E.L - W.CONV) || (!E.abiertoR && m(p) > E.R + W.CONV)));
  for (const p of fuera) cambios.push({ tipo: 'quitado', s: +m(p).toFixed(1) });
  S = S.filter(p => !fuera.includes(p));
  if (fuera.length) { if (S.length && S[0].tipo !== 'estribo') lado(E.L, true); if (S.length && S[S.length - 1].tipo !== 'estribo') lado(E.R, false); }
  arcoContinuo(O, dk, gr, S, cambios);
  return { supports: S, cambios, extremos: E };
}

/* Superestructura sobre el tablero: perfil del tablero local, envolvente superior y clasificación por forma.
   - Atirantado: envolvente en triángulo (cables rectos) con un mástil continuo en el vértice.
   - Arco superior: envolvente parabólica sin mástil.
   - Armadura: cordón superior casi plano a altura constante. */
function supra(O, dk, W = {}, disp = null) {
  W = Object.assign({ bw: 2, hmin: 3, Lmin: 30 }, W);
  const tt = []; for (let i = 0; i < O.n; i++) if (Math.abs(O.z[i] - dk) < 1.5) tt.push(O.t[i]); tt.sort((a, b) => a - b);
  const t0 = tt[Math.floor(tt.length * .03)] - 1, t1 = tt[Math.floor(tt.length * .97)] + 1;
  let s0 = 1e9, s1 = -1e9; for (let i = 0; i < O.n; i++) { if (O.s[i] < s0) s0 = O.s[i]; if (O.s[i] > s1) s1 = O.s[i]; }
  const nb = Math.ceil((s1 - s0) / W.bw) + 1, Z = Array.from({ length: nb }, () => []);
  for (let i = 0; i < O.n; i++) { if (O.t[i] < t0 || O.t[i] > t1) continue; Z[Math.floor((O.s[i] - s0) / W.bw)].push(O.z[i]); }
  // tablero local: la capa más poblada cerca del tablero global (±8 m), suavizada
  const deck0 = new Float32Array(nb).fill(NaN);
  for (let b = 0; b < nb; b++) { const z = Z[b].filter(v => Math.abs(v - dk) < 8); if (z.length < 5) continue; const h = new Map(); for (const v of z) { const k = Math.round(v * 2); h.set(k, (h.get(k) || 0) + 1); } let bk = 0, bv = -1; for (const [k, v] of h) if (v > bv) { bv = v; bk = k; } const near = z.filter(v => Math.abs(v - bk / 2) < 1).sort((a, c) => a - c); deck0[b] = near[Math.floor(near.length * .9)]; }
  const deck = new Float32Array(nb).fill(NaN); for (let b = 0; b < nb; b++) { const v = []; for (let k = b - 10; k <= b + 10; k++) if (deck0[k] === deck0[k]) v.push(deck0[k]); if (v.length) { v.sort((a, c) => a - c); deck[b] = v[v.length >> 1]; } }
  const E = new Float32Array(nb).fill(0), occ = Array.from({ length: nb }, () => new Set());
  for (let b = 0; b < nb; b++) { if (deck[b] !== deck[b]) continue; for (const v of Z[b]) { const h = v - deck[b]; if (h > 1.5) { if (h > E[b]) E[b] = h; occ[b].add(Math.floor(h / 2)); } } }
  const cnt = new Int32Array(nb); for (let b = 0; b < nb; b++) if (deck[b] === deck[b]) for (const v of Z[b]) if (v - deck[b] > 1.5) cnt[b]++;
  const occF = b => { const lev = Math.max(1, Math.floor(E[b] / 2)); let n = 0; for (let j = 1; j <= lev; j++) if (occ[b].has(j)) n++; return n / lev; };
  const hi = Array.from(E, (e, b) => e >= W.hmin && cnt[b] >= 8), segs = [];
  for (let b = 0; b < nb;) { if (!hi[b]) { b++; continue; } let e = b; while (e + 1 < nb && (hi[e + 1] || (e + 2 < nb && hi[e + 2]))) e++; if ((e - b + 1) * W.bw >= W.Lmin) segs.push([b, e]); b = e + 1; }
  const sAt = b => s0 + (b + .5) * W.bw, out = [];
  const lin = (xs, ys) => { const n = xs.length, mx = xs.reduce((a, c) => a + c) / n, my = ys.reduce((a, c) => a + c) / n; let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; } const k = sxx ? sxy / sxx : 0; let r = 0; for (let i = 0; i < n; i++) r += (ys[i] - my - k * (xs[i] - mx)) ** 2; return { k, r }; };
  // segmentos con un núcleo mucho más alto (arco o pilono sobre catenaria o barandas): se separa el núcleo
  const segs2 = [];
  for (const [b, e] of segs) { const ys0 = []; for (let k = b; k <= e; k++) if (hi[k]) ys0.push(E[k]); ys0.sort((x, y) => x - y); const med = ys0[Math.floor(ys0.length * .25)], tp = ys0[ys0.length - 1];
    let mastIn = false; for (let k = b; k <= e; k++) { if (E[k] < .6 * tp) continue; const lev = Math.floor(E[k] / 2); let n = 0; for (let j = 1; j < lev; j++) if (occ[k].has(j)) n++; if (n / Math.max(1, lev - 1) >= .8 && E[k] >= 15) { mastIn = true; break; } }
    if (!mastIn && tp > 1.5 * med && tp - med > 4) { const th = med + .35 * (tp - med); let k = b; while (k <= e) { if (E[k] < th) { k++; continue; } let j = k; while (j + 1 <= e && (E[j + 1] >= th || (j + 2 <= e && E[j + 2] >= th))) j++;
        // extender hacia afuera mientras la envolvente siga bajando
        let a0 = k, b0 = j; const base = med + 1; while (a0 - 1 >= b && E[a0 - 1] > base && E[a0 - 1] <= E[a0] + .3) a0--; while (b0 + 1 <= e && E[b0 + 1] > base && E[b0 + 1] <= E[b0] + .3) b0++;
        if ((b0 - a0 + 1) * W.bw >= W.Lmin) segs2.push([a0, b0]); k = j + 1; } }
    else segs2.push([b, e]); }
  for (const [b, e] of segs2) {
    // dentro del segmento puede haber varios vértices (dos pilonos): se buscan máximos locales con mástil
    const bins = []; for (let k = b; k <= e; k++) if (hi[k]) bins.push(k);
    const xs = bins.map(sAt), ys = bins.map(k => E[k]);
    const masts = []; for (let k = b; k <= e; k++) { const top = E[k]; if (top < 15) continue; const lev = Math.floor(top / 2), wn = Math.max(1, Math.round(.08 * top / W.bw)); let n = 0; for (let j = 1; j < lev; j++) { let ok = false; for (let d = -wn; d <= wn && !ok; d++) if (occ[k + d] && occ[k + d].has(j)) ok = true; if (ok) n++; } const cont = n / Math.max(1, lev - 1); // pilono inclinado: ventana proporcional a la altura
      const isMax = E[k] >= Math.max(E[k - 1] || 0, E[k + 1] || 0, E[k - 2] || 0, E[k + 2] || 0); if (cont >= .8 && isMax) masts.push({ s: +sAt(k).toFixed(1), h: +top.toFixed(1), cont: +cont.toFixed(2) }); }
    // fusionar mástiles a < 10 m
    const M = []; for (const m of masts) { const q = M[M.length - 1]; if (q && m.s - q.s < Math.max(10, .25 * Math.max(m.h, q.h))) { if (m.h > q.h) M[M.length - 1] = m; } else M.push(m); }
    // parábola en la envolvente
    const xm = xs.reduce((a, c) => a + c) / xs.length; let S = [0, 0, 0, 0, 0], T = [0, 0, 0];
    for (let j = 0; j < xs.length; j++) { const x = xs[j] - xm, z = ys[j]; S[0]++; S[1] += x; S[2] += x * x; S[3] += x ** 3; S[4] += x ** 4; T[0] += z; T[1] += x * z; T[2] += x * x * z; }
    const A = [[S[4], S[3], S[2]], [S[3], S[2], S[1]], [S[2], S[1], S[0]]], y = [T[2], T[1], T[0]], det = Q => Q[0][0] * (Q[1][1] * Q[2][2] - Q[1][2] * Q[2][1]) - Q[0][1] * (Q[1][0] * Q[2][2] - Q[1][2] * Q[2][0]) + Q[0][2] * (Q[1][0] * Q[2][1] - Q[1][1] * Q[2][0]);
    const D = det(A), [a2, a1, a0] = [0, 1, 2].map(c => det(A.map((r, i) => r.map((v, j) => j === c ? y[i] : v))) / D);
    let rp = 0; for (let j = 0; j < xs.length; j++) { const x = xs[j] - xm; rp += (a2 * x * x + a1 * x + a0 - ys[j]) ** 2; } rp = Math.sqrt(rp / xs.length);
    const top = Math.max(...ys), L = (e - b + 1) * W.bw, std = Math.sqrt(ys.reduce((a, c) => a + (c - ys.reduce((p, q) => p + q) / ys.length) ** 2, 0) / ys.length);
    const Mh = M.filter(m => m.h >= .6 * top);
    const rough = (() => { const d = []; for (let j = 1; j < ys.length; j++) d.push(Math.abs(ys[j] - ys[j - 1])); d.sort((a, c) => a - c); return d.length ? d[d.length >> 1] : 0; })();
    const oc = bins.map(occF).sort((a, c) => a - c)[bins.length >> 1];
    const esf = disp ? disp(sAt(b), sAt(e)) : null, estructura = esf == null || (esf.n >= 500 && esf.esf <= .16);
    let tipo = 'otro';
    // cables: a una altura de pilono de distancia, la envolvente sigue alta (cables rectos que bajan); junto a un árbol cae a cero
    const conCables = m => { const k0 = Math.round((m.s - s0) / W.bw - .5), dh = Math.max(2, Math.round(m.h / W.bw)); let lados = 0; // los dos lados: cables rectos que llegan lejos (≥ 1,5 alturas)
      for (const d of [-1, 1]) { const xs = [], ys = []; for (let j = 1; j <= 3 * dh; j++) { const k = k0 + d * j; if (k < 0 || k >= nb) break; if (E[k] >= 1.5) { xs.push(j * W.bw); ys.push(E[k]); } }
        if (xs.length < 4) continue; let sxy = 0, sxx = 0; for (let i = 0; i < xs.length; i++) { sxy += xs[i] * (ys[i] - m.h); sxx += xs[i] * xs[i]; } const sl = sxy / sxx; if (sl >= 0) continue;
        const R = -m.h / sl; let r = 0, n = 0; for (let i = 0; i < xs.length; i++) if (xs[i] <= R) { r += (m.h + sl * xs[i] - ys[i]) ** 2; n++; } const rms = Math.sqrt(r / Math.max(1, n)), cob = n / Math.max(1, Math.floor(R / W.bw));
        (m.alcance = m.alcance || [null, null])[d < 0 ? 0 : 1] = +Math.min(R, 6 * m.h).toFixed(1); // hasta dónde llegan los cables de ese lado
        if (R >= 1.5 * m.h && rms <= .15 * m.h && cob >= .6) lados++; }
      return lados === 2; };
    const McC = Mh.filter(conCables); for (const m of Mh) if (!m.alcance) m.alcance = [null, null];
    if (!estructura && !McC.length) tipo = 'otro';
    else if (estructura && a2 < 0 && rp <= Math.max(.8, .06 * top) && top / L >= .08 && top >= 6) {
      // un arco es un miembro fino (los puntos se concentran bajo la envolvente) y simétrico
      let nn = 0, nt = 0; for (let k = b; k <= e; k++) { if (deck[k] !== deck[k]) continue; for (const v of Z[k]) { const h = v - deck[k]; if (h <= 2) continue; nt++; if (E[k] - h <= 2) nn++; } }
      let sd = 0, ns = 0; for (let k = b; k <= e; k++) { const k2 = b + e - k; if (hi[k] && hi[k2]) { sd += Math.abs(E[k] - E[k2]); ns++; } }
      const fino = nt ? nn / nt : 0, asim = ns ? sd / ns : 99;
      if (fino >= .4 && asim <= .15 * top) tipo = 'arco_superior'; }
    else if (Mh.length && (estructura || McC.length)) tipo = 'atirantado';
    const cov = bins.length / (e - b + 1), cm = bins.map(k => cnt[k]).sort((x, y) => x - y)[bins.length >> 1];
    if (tipo === 'otro' && estructura && std <= .2 * top && top >= 3 && top <= 15 && rough <= .3 && oc >= .5 && cov >= .9 && cm >= 30) tipo = 'armadura';
    let luz = null; if (tipo === 'arco_superior') { const disc = a1 * a1 - 4 * a2 * a0; if (disc > 0) { const r1 = (-a1 + Math.sqrt(disc)) / (2 * a2) + xm, r2 = (-a1 - Math.sqrt(disc)) / (2 * a2) + xm; luz = { a: +Math.min(r1, r2).toFixed(1), b: +Math.max(r1, r2).toFixed(1), L: +Math.abs(r1 - r2).toFixed(1), flecha: +(a0 - a1 * a1 / (4 * a2)).toFixed(1) }; } }
    out.push({ tipo, luzArco: luz, a: +sAt(b).toFixed(1), b: +sAt(e).toFixed(1), L: +L.toFixed(1), altura: +top.toFixed(1), rmsParabola: +rp.toFixed(2), rugosidad: +rough.toFixed(2), dispersion: esf && +esf.esf.toFixed(2), ocupacion: +oc.toFixed(2), cobertura: +cov.toFixed(2), puntosMed: cm, pilonos: tipo === 'atirantado' ? (estructura ? Mh : McC) : [] });
  }
  return { segmentos: out, pendienteTablero: [deck.find(v => v === v), deck[nb - 1]] };
}


/* ---------- Calidad de la nube: qué vio el escáner y qué falta ----------
   Por cada metro del eje: puntos de la calzada (tablero), de la cara inferior (bajo el tablero) y de la subestructura.
   Detecta huecos del tablero, cortes en los extremos, apoyos vistos en poca altura y el tipo de captura probable. */
function calidadNube(O, dk, gr, supports = [], W = {}) {
  W = Object.assign({ bw: 1, HMIN: 3, TOP: .6, BAJO: 3 }, W);
  const tt = []; for (let i = 0; i < O.n; i++) if (Math.abs(O.z[i] - dk) < 1) tt.push(O.t[i]); tt.sort((a, b) => a - b);
  if (tt.length < 50) return null;
  const t0 = tt[Math.floor(tt.length * .03)], t1 = tt[Math.floor(tt.length * .97)]; let tb0 = t0, tb1 = t1;
  let s0 = 1e9, s1 = -1e9; for (let i = 0; i < O.n; i++) { if (O.s[i] < s0) s0 = O.s[i]; if (O.s[i] > s1) s1 = O.s[i]; }
  const bw = W.bw, nb = Math.max(1, Math.ceil((s1 - s0) / bw)), bin = s => Math.min(nb - 1, Math.max(0, Math.floor((s - s0) / bw)));
  // tablero local (puentes con pendiente y rampas): se parte de la celda más poblada cerca del tablero global
  // y se sigue la capa más poblada a ±1 m del último valor, hacia ambos extremos (hasta 15 m sin calzada)
  const Hs = Array.from({ length: nb }, () => new Map());
  for (let i = 0; i < O.n; i++) { if (O.t[i] < t0 || O.t[i] > t1) continue; const m = Hs[bin(O.s[i])], k = Math.round(O.z[i] * 2); m.set(k, (m.get(k) || 0) + 1); }
  const capa = (b, z, r) => { let bk = 0, bv = 0; for (const [k, v] of Hs[b]) if (Math.abs(k / 2 - z) <= r && v > bv) { bv = v; bk = k; } return bv >= 3 ? [bk / 2, bv] : null; };
  // la calzada es la superficie extensa más alta: en la ventana se toma la capa más alta con al menos 30 % de la más poblada;
  // la ventana es estrecha (pendiente ≤ 30 %) para no bajar a la cara inferior ni al terreno bajo el puente
  const capaAlta = (b, z, r) => { let mx = 0; for (const [k, v] of Hs[b]) if (Math.abs(k / 2 - z) <= r && v > mx) mx = v; if (mx < 3) return null; let bk = -1e9; for (const [k, v] of Hs[b]) if (Math.abs(k / 2 - z) <= r && v >= .3 * mx && k > bk) bk = k; return bk / 2; };
  let seed = -1, sv = 0; for (let b = 0; b < nb; b++) { const c = capa(b, dk, .5); if (c && c[1] > sv) { sv = c[1]; seed = b; } }
  const d0 = new Float32Array(nb).fill(NaN); if (seed < 0) return null; d0[seed] = capaAlta(seed, dk, .5);
  for (const d of [1, -1]) { let last = d0[seed], miss = 0; for (let b = seed + d; b >= 0 && b < nb; b += d) { const z = capaAlta(b, last, Math.min(1.5, .3 * bw * (1 + miss))); if (z != null) { d0[b] = z; last = z; miss = 0; } else if (++miss * bw > 15) break; } }
  const deck = new Float32Array(nb); const R = Math.round(5 / bw);
  for (let b = 0; b < nb; b++) { const v = []; for (let k = b - R; k <= b + R; k++) if (d0[k] === d0[k]) v.push(d0[k]); v.sort((x, y) => x - y); deck[b] = v.length ? v[v.length >> 1] : NaN; }
  for (const d of [1, -1]) { let last = dk; for (let b = d > 0 ? 0 : nb - 1; b >= 0 && b < nb; b += d) { if (deck[b] === deck[b]) last = deck[b]; else if (d < 0 || true) deck[b] = deck[b] === deck[b] ? deck[b] : NaN; } }
  { let first = deck.findIndex(v => v === v); for (let b = 0; b < first; b++) deck[b] = deck[first]; let last = dk; for (let b = 0; b < nb; b++) { if (deck[b] === deck[b]) last = deck[b]; else deck[b] = last; } }
  // ancho real del tablero: puntos a nivel de la calzada donde ésta está elevada (ahí el terreno queda lejos)
  { const t2 = []; for (let i = 0; i < O.n; i++) { const b = bin(O.s[i]); if (deck[b] - gr >= 2.5 && Math.abs(O.z[i] - deck[b]) < W.TOP) t2.push(O.t[i]); }
    if (t2.length > 200) { t2.sort((a, b) => a - b); tb0 = t2[Math.floor(t2.length * .03)]; tb1 = t2[Math.floor(t2.length * .97)]; } }
  const top = new Int32Array(nb), bajo = new Int32Array(nb), alto = new Int32Array(nb), hAlto = new Float32Array(nb), zmin = new Float32Array(nb).fill(1e9), cerca = new Int32Array(nb);
  for (let i = 0; i < O.n; i++) { const b = bin(O.s[i]), h = O.z[i] - deck[b]; if (O.z[i] < zmin[b]) zmin[b] = O.z[i]; if (Math.abs(h) < 1.5) cerca[b]++; if (O.t[i] < tb0 || O.t[i] > tb1) continue; if (h > W.HMIN) { alto[b]++; if (h > hAlto[b]) hAlto[b] = h; continue; }
    if (Math.abs(h) < W.TOP) top[b]++; else if (h <= -.8 && O.z[i] > gr + .5) bajo[b]++; }
  // cara inferior vista: puntos dentro del ancho del tablero, más de 0,8 m bajo la calzada y sobre el terreno
  const ancho = Math.max(tb1 - tb0, .5);
  // eje en planta: centro de la calzada por celda (mediana de t); si se desplaza mucho, el puente no es recto (curvo, quebrado o con rampas)
  const tc = Array.from({ length: nb }, () => []); for (let i = 0; i < O.n; i++) { const b = bin(O.s[i]); if (O.t[i] >= tb0 && O.t[i] <= tb1 && Math.abs(O.z[i] - deck[b]) < W.TOP) tc[b].push(O.t[i]); }
  const spE = supports.slice().sort((p, q) => p.a - q.a), dA = spE.length >= 2 ? bin(spE[0].b) : 0, dB = spE.length >= 2 ? bin(spE[spE.length - 1].a) : nb - 1; // solo entre los apoyos extremos (los accesos a nivel del terreno ensanchan la calzada)
  // ancho local de la calzada en cada celda (p10–p90 de t) frente al ancho de toda la banda: en un puente recto son parecidos; si el eje se quiebra, la banda es mucho más ancha que la calzada
  const wl = tc.map((v, b) => { if (b < dA || b > dB || v.length < 10) return null; v.sort((x, y) => x - y); return v[Math.floor(v.length * .9)] - v[Math.floor(v.length * .1)]; }).filter(v => v != null).sort((x, y) => x - y);
  const anchoLocal = wl.length >= 10 ? wl[wl.length >> 1] : null, desvio = anchoLocal ? (tb1 - tb0) - anchoLocal : 0;
  const nz = Array.from(top).filter(v => v > 0).sort((a, b) => a - b), med = nz.length ? nz[nz.length >> 1] : 0;
  const thr = Math.max(3, .15 * med), thrB = Math.max(2, .03 * med), cov = Array.from(top, v => v >= thr), vacio = Array.from(top, v => v < Math.max(2, .03 * med));
  let e0 = cov.indexOf(true), e1 = cov.lastIndexOf(true); if (e0 < 0) return null;
  // huecos del tablero ≥ 3 m dentro de su extensión
  const huecos = []; for (let b = e0; b <= e1;) { if (!vacio[b]) { b++; continue; } let e = b; while (e + 1 <= e1 && vacio[e + 1]) e++; if ((e - b + 1) * bw >= 3) huecos.push({ a: +(s0 + b * bw).toFixed(1), b: +(s0 + (e + 1) * bw).toFixed(1), conAlto: Array.from(alto).slice(b, e + 1).some(v => v > 0) }); b = e + 1; }
  const spO = supports.slice().sort((p, q) => p.a - q.a), uA = spO.length >= 2 ? bin(spO[0].b) : e0, uB = spO.length >= 2 ? bin(spO[spO.length - 1].a) : e1; // bajo el puente: entre los apoyos extremos
  let nT = 0, nB = 0, cT = 0; for (let b = e0; b <= e1; b++) { if (cov[b]) nT++; if (b < uA || b > uB || deck[b] - gr < 2.5) continue; cT++; if (bajo[b] >= thrB) nB++; } // solo donde hay gálibo
  const L = (e1 - e0 + 1) * bw, fracTop = nT / (e1 - e0 + 1), fracBajo = cT ? nB / cT : 1;
  // espaciado típico en la calzada: área de la celda / puntos
  const esp = med ? Math.sqrt(bw * ancho / med) : null;
  // cortes en los extremos: el tablero llega al borde de la nube; algo alto sigue fuera
  // estructura alta en el borde: casi todas las celdas de los últimos 4 m con puntos a más de 6 m sobre la calzada (un poste ocupa una sola)
  const borde = Math.max(1, Math.round(5 / bw)), b4 = Math.max(2, Math.round(4 / bw)), altoEn = (a, b) => { let n = 0; for (let k = a; k < b; k++) if (alto[k] > 5 && hAlto[k] > 6) n++; return n >= .75 * (b - a); };
  // el tablero termina «en el aire»: bajo su último metro el punto más bajo de la nube (±5 m) está lejos y no hay apoyo
  // se mira HACIA AFUERA del tablero (d = −1 a la izquierda, +1 a la derecha); si la nube ya terminó, es un corte, no un final en el aire
  const enAire = (e, d) => { let z = 1e9, n = 0, c = 0; for (let k = e + d; k >= 0 && k < nb && Math.abs(k - e) * bw <= 5; k += d) { n++; c += cerca[k]; if (zmin[k] < z) z = zmin[k]; } return n && z < 1e8 && c < 10 ? deck[e] - z : 0; }; // con terraplén o muro a nivel de la calzada no está «en el aire»
  const cortes = { izq: e0 < borde, der: e1 > nb - 1 - borde, altoIzq: altoEn(0, Math.min(nb, b4)), altoDer: altoEn(Math.max(0, nb - b4), nb), aireIzq: +enAire(e0, -1).toFixed(1), aireDer: +enAire(e1, 1).toFixed(1) };
  // apoyos: fracción de su altura con puntos (niveles de 0,5 m entre terreno y tablero)
  const sp = supports.slice().sort((p, q) => p.a - q.a), apoyos = sp.map((p, i) => {
    const b = bin((p.a + p.b) / 2), zt = deck[b] - W.TOP, nl = Math.max(1, Math.floor((zt - gr) / .5)), lv = new Uint8Array(nl);
    for (let j = 0; j < O.n; j++) { if (O.s[j] < p.a - .5 || O.s[j] > p.b + .5) continue; const k = Math.floor((O.z[j] - gr) / .5); if (k >= 0 && k < nl) lv[k] = 1; }
    let n = 0; for (const v of lv) n += v; return { i: i + 1, tipo: p.tipo, s: +((p.a + p.b) / 2).toFixed(1), frac: +(n / nl).toFixed(2) }; });
  const vanos = []; for (let k = 1; k < sp.length; k++) { const a = sp[k - 1].b, b = sp[k].a; if (b - a < 1) continue; const ba = bin(a), bb = bin(b); let c = 0, cb = 0, pts = 0;
    for (let q = ba; q <= bb; q++) { if (cov[q]) c++; if (bajo[q] >= thrB) cb++; pts += top[q]; } const nn = bb - ba + 1; vanos.push({ i: k, a: +a.toFixed(1), b: +b.toFixed(1), tablero: +(c / nn).toFixed(2), bajo: +(cb / nn).toFixed(2), densidad: Math.round(pts / ((b - a) * ancho)) }); }
  const origen = fracBajo < .2 && fracTop > .6 ? 'desde arriba' : fracBajo >= .5 ? 'desde abajo o los costados' : 'mixta';
  // avisos y recomendaciones (texto para el inspector)
  const f1 = v => v.toFixed(1).replace('.', ','), pc = v => Math.round(100 * v) + ' %', avisos = [], rec = [];
  /* muchos huecos o huecos que suman mucho largo: la nube casi seguro incluye calles, edificios o el terreno alrededor (por ejemplo una hoja completa de un vuelo LiDAR) */
  { const hl = huecos.reduce((a, h) => a + (h.b - h.a), 0); if (huecos.length >= 6 || hl > .25 * L) { avisos.unshift({ nivel: 'crit', txt: `La nube tiene ${huecos.length} huecos en el tablero que suman ${f1(hl)} m de ${f1(L)} m: parece incluir mucho más que el puente (calles, edificios o una hoja completa de un vuelo LiDAR). La detección de apoyos y de tipología no es confiable así.` }); rec.unshift('Recortar en el paso 1 una franja a lo largo del puente (con el terreno de ambos extremos) y volver a detectar.'); } }
  if (anchoLocal && (tb1 - tb0) > 4 * anchoLocal + 4) { avisos.push({ nivel: 'crit', txt: `El tablero no sigue un eje recto en planta: en cada metro la calzada mide unos ${f1(anchoLocal)} m de ancho, pero a lo largo de la nube ocupa una franja de ${f1(tb1 - tb0)} m. Parece un puente curvo, quebrado o con rampas; la app mide sobre un eje recto, así que los huecos, vanos y apoyos de esta nube no son confiables.` }); rec.push('Recortar en el paso 1 cada tramo recto del puente y analizarlo por separado.'); }
  for (const h of huecos) { avisos.push({ nivel: 'crit', txt: `Hueco en el tablero entre ${f1(h.a)} y ${f1(h.b)} m (${f1(h.b - h.a)} m sin puntos de calzada)${h.conAlto ? '; sobre él sí hay estructura alta' : ''}. Las medidas de ese tramo no son confiables.` }); rec.push(`Completar la nube entre ${f1(h.a)} y ${f1(h.b)} m (otra posición del escáner o otra pasada).`); }
  const estCerca = (x) => sp.some(p => p.tipo === 'estribo' && Math.abs((p.a + p.b) / 2 - x) < 6); if (cortes.izq && estCerca(s0 + e0 * bw)) cortes.izq = false; if (cortes.der && estCerca(s0 + (e1 + 1) * bw)) cortes.der = false;
  if (cortes.izq || cortes.der) avisos.push({ nivel: 'warn', txt: `La nube corta el tablero en el extremo ${cortes.izq && cortes.der ? 'izquierdo y derecho' : cortes.izq ? 'izquierdo' : 'derecho'}: el puente puede seguir fuera de la nube y faltar un estribo.` });
  if (cortes.altoIzq || cortes.altoDer) { avisos.push({ nivel: 'info', txt: `Hay algo alto sobre la calzada (arco, pilono, armadura o árboles) justo en el borde ${cortes.altoIzq ? 'izquierdo' : 'derecho'} de la nube: si es parte del puente, continúa fuera de la nube.` }); rec.push('Ampliar el recorte o la captura para incluir la estructura completa.'); }
  if (fracBajo < .6) { avisos.push({ nivel: 'warn', txt: `Bajo el puente, entre los apoyos extremos, solo el ${pc(fracBajo)} del largo tiene puntos de la cara inferior, vigas, arcos o pilas: la parte de abajo está ${fracBajo < .3 ? 'poco' : 'parcialmente'} cubierta. Pasa cuando se escanea desde arriba (avión, dron cenital), desde el propio tablero o con pocas estaciones bajo el puente.` }); rec.push('Escanear bajo el tablero desde las márgenes, desde abajo o con dron oblicuo para ver la cara inferior, los apoyos y las pilas.'); }
  const finS = (e, d) => sp.some(p => Math.abs((d < 0 ? p.b : p.a) - (s0 + (e + (d < 0 ? 1 : 0)) * bw)) < 4);
  if (!cortes.izq && cortes.aireIzq > 4 && !finS(e0, 1)) { avisos.push({ nivel: 'crit', txt: `El tablero termina en el aire en ${f1(s0 + e0 * bw)} m (${f1(cortes.aireIzq)} m sobre lo más bajo de la nube) sin un estribo: falta parte del puente en la nube.` }); rec.push('Capturar la continuación del puente en el extremo izquierdo.'); }
  if (!cortes.der && cortes.aireDer > 4 && !finS(e1, -1)) { avisos.push({ nivel: 'crit', txt: `El tablero termina en el aire en ${f1(s0 + (e1 + 1) * bw)} m (${f1(cortes.aireDer)} m sobre lo más bajo de la nube) sin un estribo: falta parte del puente en la nube.` }); rec.push('Capturar la continuación del puente en el extremo derecho.'); }
  for (const a of apoyos) if (a.tipo === 'pilar' && a.frac < .5) { avisos.push({ nivel: 'warn', txt: `${a.tipo === 'pilar' ? 'Pilar' : 'Estribo'} ${a.i} (en ${f1(a.s)} m): solo se ve el ${pc(a.frac)} de su altura.` }); rec.push(`Escanear el apoyo ${a.i} de costado, desde una posición con vista hasta su base.`); }
  for (const v of vanos) if (v.tablero < .8 && !huecos.some(h => h.a >= v.a - 1 && h.b <= v.b + 1)) avisos.push({ nivel: 'warn', txt: `Vano ${v.i}: la calzada está cubierta solo en el ${pc(v.tablero)} de su largo.` });
  if (esp != null && esp > .1) avisos.push({ nivel: 'info', txt: `Espaciado típico de puntos en la calzada ≈ ${Math.round(100 * esp)} cm: suficiente para la geometría general, no para medir fisuras ni secciones finas.` });
  return { s0, bw, deck: Array.from(deck), top: Array.from(top), bajo: Array.from(bajo), alto: Array.from(alto), thr, thrB, extension: [+(s0 + e0 * bw).toFixed(1), +(s0 + (e1 + 1) * bw).toFixed(1)], largo: L, ancho: +ancho.toFixed(1), tb: [+tb0.toFixed(2), +tb1.toFixed(2)], noRecto: !!(anchoLocal && (tb1 - tb0) > 4 * anchoLocal + 4), desvioEje: +desvio.toFixed(1), anchoLocal: anchoLocal && +anchoLocal.toFixed(1), fracTablero: +fracTop.toFixed(2), fracBajo: +fracBajo.toFixed(2), espaciado: esp && +esp.toFixed(3), origen, huecos, cortes, apoyos, vanos, avisos, recomendaciones: rec };
}

// Superestructura sobre el tablero con la dispersión local de los puntos (miembros lineales frente a follaje)
function superestructura(O, dk, gr) {
  const F = iaFeatures(O, dk, gr), disp = (a, b) => { let n = 0, e = 0; for (let j = 0; j < F.nv; j++) { if (F.X[j] < a || F.X[j] > b || F.Z[j] < dk + 2) continue; n++; e += F.F[j * F.nf + 8]; } return { n, esf: n ? e / n : 1 }; };
  const seg = supra(O, dk, {}, disp).segmentos;
  for (const g of seg) if (g.tipo === 'arco_superior' && g.luzArco) { const ap = apoyosArco(O, dk, gr, g.luzArco); if (ap) g.luzArco.apoyos = ap; }
  return seg;
}
/* ---------- Eje curvo: se recorre la calzada en planta y se «desenrolla» el puente ----------
   Para puentes curvos, quebrados o con rampas. Parte de la zona más poblada a la altura del tablero y avanza en pasos de 2 m:
   en cada paso prueba direcciones (giro máximo 45° por paso), elige la que tiene más calzada a la altura esperada (pendiente ≤ 15 %),
   recentra el eje en la calzada y sigue la altura. Luego cada punto se proyecta sobre esa línea: s = largo sobre el eje, t = distancia al eje. */
function ejeCurvo(O, dk, W = {}) {
  W = Object.assign({ paso: 2, celda: 1, dz: .5, giro: 45, pend: .15, hueco: 8, R: 40 }, W);
  const c = W.celda, key = (a, b) => (a + 50000) * 100000 + (b + 50000), G = new Map();
  for (let i = 0; i < O.n; i++) { const k = key(Math.floor(O.s[i] / c), Math.floor(O.t[i] / c)); let v = G.get(k); if (!v) G.set(k, v = []); v.push(i); }
  // puntos de calzada cerca de (x, y) a la altura h: [n, mediana z]
  const disco = (x, y, r, h, dz) => { let n = 0; const zs = []; const a0 = Math.floor((x - r) / c), a1 = Math.floor((x + r) / c), b0 = Math.floor((y - r) / c), b1 = Math.floor((y + r) / c);
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) { const v = G.get(key(a, b)); if (!v) continue; for (const i of v) { const dx = O.s[i] - x, dy = O.t[i] - y; if (dx * dx + dy * dy > r * r || Math.abs(O.z[i] - h) > dz) continue; n++; if (zs.length < 300) zs.push(O.z[i]); } }
    zs.sort((p, q) => p - q); return [n, zs.length ? zs[zs.length >> 1] : h]; };
  // ¿hay espacio libre bajo la calzada aquí? (puntos 2 m o más abajo, en un círculo de radio r)
  const libreBajo = (x, y, r, h) => { const a0 = Math.floor((x - r) / c), a1 = Math.floor((x + r) / c), b0 = Math.floor((y - r) / c), b1 = Math.floor((y + r) / c); let n = 0;
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) { const v = G.get(key(a, b)); if (!v) continue; for (const i of v) { const dx = O.s[i] - x, dy = O.t[i] - y; if (dx * dx + dy * dy <= r * r && O.z[i] < h - 2) n++; } } return n >= 3; };
  // corte transversal en (x, y) con dirección d: centro y ancho de la calzada
  const corte = (x, y, d, h, wmax) => { const ts = []; const r = wmax; const a0 = Math.floor((x - r) / c), a1 = Math.floor((x + r) / c), b0 = Math.floor((y - r) / c), b1 = Math.floor((y + r) / c);
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) { const v = G.get(key(a, b)); if (!v) continue; for (const i of v) { const dx = O.s[i] - x, dy = O.t[i] - y, al = dx * d[0] + dy * d[1], ac = -dx * d[1] + dy * d[0]; if (Math.abs(al) > W.paso / 2 || Math.abs(ac) > wmax || Math.abs(O.z[i] - h) > .8) continue; ts.push(ac); } }
    if (ts.length < 10) return null; ts.sort((p, q) => p - q); return { off: ts[ts.length >> 1], w: ts[Math.floor(ts.length * .9)] - ts[Math.floor(ts.length * .1)], n: ts.length }; };
  // altura de la calzada: la franja horizontal de 0,2 m más poblada de la mitad superior (como al orientar); dk solo si no hay otra
  { const zs = []; for (let i = 0; i < O.n; i += Math.max(1, Math.floor(O.n / 200000))) zs.push(O.z[i]); zs.sort((a, b) => a - b); const zlo = zs[0], zmed = zs[zs.length >> 1], H = new Map();
    for (const z of zs) { if (z < zmed) continue; const k = Math.floor((z - zlo) / .2); H.set(k, (H.get(k) || 0) + 1); } let bk = null, bv = 0; for (const [k, v] of H) { const t = v + (H.get(k - 1) || 0) + (H.get(k + 1) || 0); if (t > bv) { bv = t; bk = k; } } if (bk != null) dk = zlo + (bk + .5) * .2; }
  // semilla: celda con más puntos a la altura de la calzada
  // semilla: entre las celdas de calzada con espacio libre debajo (puntos 2 m o más abajo en la misma celda), la que tiene el tramo recto
  // de calzada continua más largo (una plaza o un terraplén son cortos; un puente es largo)
  const cand = []; for (const [k, v] of G) { let n = 0, bajo = 0; for (const i of v) { const h = O.z[i] - dk; if (Math.abs(h) < .3) n++; else if (h < -2) bajo++; } if (n >= 3) cand.push({ sc: n * (bajo >= 3 ? 1 : .05), libre: bajo >= 3, i: v.find(i => Math.abs(O.z[i] - dk) < .3) }); }
  if (!cand.length) return null; cand.sort((a, b) => b.sc - a.sc);
  const rayo = (p, h) => { let d = [1, 0], lmax = -1; for (let g = 0; g < 180; g += 5) { const r = g * Math.PI / 180, dd = [Math.cos(r), Math.sin(r)]; let L = 0;
      for (const sg of [-1, 1]) { let miss = 0; for (let k = 1; k < 200; k++) { const q = [p[0] + sg * k * dd[0], p[1] + sg * k * dd[1]]; if (disco(q[0], q[1], .75, h, .3 + .05 * k)[0] >= 2) { L++; miss = 0; } else if (++miss > 3) break; } }
      if (L > lmax) { lmax = L; d = dd; } } return { d, lmax }; };
  let p0, h0, d0, lmax = -1, libre0 = false; const usados = [];
  for (const c0 of cand) { if (usados.length >= 12) break; const p = [O.s[c0.i], O.t[c0.i]]; if (usados.some(u => Math.hypot(u[0] - p[0], u[1] - p[1]) < 10)) continue; usados.push(p);
    const h = disco(p[0], p[1], 3, dk, .3)[1], r = rayo(p, h); if (r.lmax > lmax) { lmax = r.lmax; p0 = p; h0 = h; d0 = r.d; libre0 = c0.libre; } }
  const cs = corte(p0[0], p0[1], d0, h0, 20); if (cs) p0 = [p0[0] - cs.off * d0[1], p0[1] + cs.off * d0[0]]; const ws = [-6, -3, 0, 3, 6].map(k => corte(p0[0] + k * d0[0], p0[1] + k * d0[1], d0, h0, 20)).filter(Boolean).map(c => c.w).sort((a, b) => a - b); const wd = ws.length ? Math.max(1.5, ws[ws.length >> 1]) : 4, wTope = 1.6 * wd + 2; // si la calzada se ensancha mucho, se salió del puente (terreno a nivel)
    let xs0 = 1e9, xs1 = -1e9, ys0 = 1e9, ys1 = -1e9; for (let i = 0; i < O.n; i++) { if (O.s[i] < xs0) xs0 = O.s[i]; if (O.s[i] > xs1) xs1 = O.s[i]; if (O.t[i] < ys0) ys0 = O.t[i]; if (O.t[i] > ys1) ys1 = O.t[i]; }
  const maxIt = Math.ceil(1.5 * Math.hypot(xs1 - xs0, ys1 - ys0) / W.paso), visto = new Set(), vk = (x, y) => key(Math.floor(x / W.paso), Math.floor(y / W.paso));
  const andar = sg => { const L = []; let p = p0.slice(), d = [sg * d0[0], sg * d0[1]], h = h0, sl = 0, miss = 0, w = wd, ancho = 0, sinLibre = 0;
    for (let it = 0; it < maxIt; it++) { let mejor = null;
      for (let g = -W.giro; g <= W.giro; g += 7.5) { const r = g * Math.PI / 180, dd = [d[0] * Math.cos(r) - d[1] * Math.sin(r), d[0] * Math.sin(r) + d[1] * Math.cos(r)], q = [p[0] + W.paso * dd[0], p[1] + W.paso * dd[1]];
        const [n, zm] = disco(q[0], q[1], Math.max(1.5, w / 2), h + sl * W.paso, Math.max(W.dz, W.pend * W.paso)), sc = n * Math.exp(-((g / 15) ** 2)); if (n >= 5 && (!mejor || sc > mejor.sc)) mejor = { sc, dd, q, zm, n }; }
      if (!mejor) { if (++miss * W.paso > W.hueco) { break; } p = [p[0] + W.paso * d[0], p[1] + W.paso * d[1]]; L.push({ x: p[0], y: p[1], h, hueco: true }); continue; }
      miss = 0; let q = mejor.q; const cx = corte(q[0], q[1], mejor.dd, mejor.zm, Math.max(3, 1.5 * w));
      // fin del puente: con espacio libre debajo en la semilla (escáner terrestre o dron), cuando deja de haberlo 8 m seguidos (ahí está el estribo);
      // sin él (LiDAR aéreo), cuando la calzada se ensancha mucho (terreno a nivel)
      if (libre0) { if (!libreBajo(q[0], q[1], Math.max(2, w / 2), mejor.zm)) { if (++sinLibre * W.paso >= 8) { L.splice(Math.max(0, L.length - sinLibre + 1)); break; } } else sinLibre = 0; }
      else if (cx && cx.w > wTope) { if (++ancho >= 4) { L.splice(L.length - 3, 3); break; } } else ancho = 0;
      if (cx && cx.w <= wTope) { const off = Math.max(-.5 * w, Math.min(.5 * w, cx.off)); /* recentrado completo: manda el centro de la calzada */ q = [q[0] - off * mejor.dd[1], q[1] + off * mejor.dd[0]]; w = Math.min(25, .8 * w + .2 * Math.max(1.5, cx.w)); }
      const pr = L.length >= 4 ? [L[L.length - 4].x, L[L.length - 4].y] : p, nd = [q[0] - pr[0], q[1] - pr[1]], nn = Math.hypot(nd[0], nd[1]) || 1; // dirección: cuerda de los últimos 8 m (suave aunque el centro salte)
      d = [nd[0] / nn, nd[1] / nn];
      sl = Math.max(-W.pend, Math.min(W.pend, .7 * sl + .3 * (mejor.zm - h) / W.paso)); h = mejor.zm; p = q;
      const vv = vk(p[0], p[1]); if (visto.has(vv) && L.length > 3) { break; } // no volver sobre lo recorrido
      if (L.length > 2) visto.add(vk(L[L.length - 3].x, L[L.length - 3].y)); L.push({ x: p[0], y: p[1], h, w }); }
    while (L.length && L[L.length - 1].hueco) L.pop(); return L; };
  const A = andar(-1).reverse(), B = andar(1); const P = [...A, { x: p0[0], y: p0[1], h: h0, w: wd }, ...B];
  if (P.length < 5) return null;
  // suavizado (media de 5) y largo acumulado
  const S = P.map((_, i) => { let x = 0, y = 0, n = 0; for (let j = Math.max(0, i - 2); j <= Math.min(P.length - 1, i + 2); j++) { x += P[j].x; y += P[j].y; n++; } return { x: x / n, y: y / n, h: P[i].h, w: P[i].w }; });
  return desenrollar(O, S, wd);
}
/* Proyecta cada punto sobre la polilínea S (eje en planta): s = largo sobre el eje, t = distancia al eje; recorta la franja del puente. */
function desenrollar(O, S, wd, W = { R: 40 }) {
  const key = (a, b) => (a + 50000) * 100000 + (b + 50000);
  const cum = [0]; for (let i = 1; i < S.length; i++) cum.push(cum[i - 1] + Math.hypot(S[i].x - S[i - 1].x, S[i].y - S[i - 1].y));
  // proyección de cada punto sobre la polilínea (índice de segmentos en celdas de 5 m)
  const C = 5, SG = new Map(); for (let i = 0; i + 1 < S.length; i++) { const a0 = Math.floor(Math.min(S[i].x, S[i + 1].x) / C), a1 = Math.floor(Math.max(S[i].x, S[i + 1].x) / C), b0 = Math.floor(Math.min(S[i].y, S[i + 1].y) / C), b1 = Math.floor(Math.max(S[i].y, S[i + 1].y) / C);
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) { const k = key(a, b); let v = SG.get(k); if (!v) SG.set(k, v = []); v.push(i); } }
  const s = new Float32Array(O.n), t = new Float32Array(O.n), z = new Float32Array(O.n), dentro = new Uint8Array(O.n); let fuera = 0;
  const proj = (x, y, i) => { const ax = S[i].x, ay = S[i].y, bx = S[i + 1].x, by = S[i + 1].y, vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1e-9; let u = ((x - ax) * vx + (y - ay) * vy) / L2; const ue = u; u = Math.max(0, Math.min(1, u)); const px = ax + u * vx, py = ay + u * vy, L = Math.sqrt(L2);
    return { d2: (x - px) ** 2 + (y - py) ** 2, s: cum[i] + u * L + (i === 0 && ue < 0 ? ue * L : 0) + (i === S.length - 2 && ue > 1 ? (ue - 1) * L : 0), t: ((x - ax) * (-vy) + (y - ay) * vx) / L * -1, i }; };
  for (let k = 0; k < O.n; k++) { const x = O.s[k], y = O.t[k], a = Math.floor(x / C), b = Math.floor(y / C); let m = null;
    for (let r = 0; r <= Math.ceil(W.R / C) && !m; r++) { for (let da = -r; da <= r; da++) for (let db = -r; db <= r; db++) { if (Math.max(Math.abs(da), Math.abs(db)) !== r) continue; const v = SG.get(key(a + da, b + db)); if (!v) continue; for (const i of v) { const q = proj(x, y, i); if (!m || q.d2 < m.d2) m = q; } } if (m && r >= 1) break; }
    if (!m) { m = proj(x, y, 0); const q = proj(x, y, S.length - 2); if (q.d2 < m.d2) m = q; fuera++; } else dentro[k] = 1;
    s[k] = m.s; t[k] = m.t; z[k] = O.z[k]; }
  // giro total del eje (grados) y radio mínimo aproximado
  let giro = 0, rmin = Infinity; for (let i = 2; i < S.length; i++) { const a1 = Math.atan2(S[i - 1].y - S[i - 2].y, S[i - 1].x - S[i - 2].x), a2 = Math.atan2(S[i].y - S[i - 1].y, S[i].x - S[i - 1].x); let da = a2 - a1; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; giro += da;
    if (i >= 6) { const b1 = Math.atan2(S[i - 4].y - S[i - 6].y, S[i - 4].x - S[i - 6].x); let db = a2 - b1; while (db > Math.PI) db -= 2 * Math.PI; while (db < -Math.PI) db += 2 * Math.PI; const ds = cum[i] - cum[i - 5]; if (Math.abs(db) > 1e-3) rmin = Math.min(rmin, ds / Math.abs(db)); } }
  // franja del puente: solo los puntos a menos de máx(3 anchos, ancho + 10 m) del eje y hasta 30 m más allá de sus extremos
  // (otras ramas, rampas o calles que cruzan quedan fuera; se analizan recortándolas aparte)
  const wm = S.map(p => p.w).filter(v => v > 0).sort((a, b) => a - b), wq = wm.length ? wm[wm.length >> 1] : wd, lim = Math.max(3 * wq, wq + 10), Lt = cum[cum.length - 1];
  let m = 0; for (let k = 0; k < O.n; k++) if (Math.abs(t[k]) <= lim && s[k] >= -30 && s[k] <= Lt + 30) m++;
  const s2 = new Float32Array(m), t2 = new Float32Array(m), z2 = new Float32Array(m), src = new Int32Array(m); let j = 0; for (let k = 0; k < O.n; k++) if (Math.abs(t[k]) <= lim && s[k] >= -30 && s[k] <= Lt + 30) { s2[j] = s[k]; t2[j] = t[k]; z2[j] = z[k]; src[j] = O.src ? O.src[k] : k; j++; } // src: índice del punto en la nube (para sus atributos)
  return { O: { s: s2, t: t2, z: z2, src, n: m, snap: null, angleDeg: O.angleDeg, ejeRatio: Infinity, curvo: true }, franja: +lim.toFixed(1), descartados: O.n - m, eje: S.map((p, i) => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2), h: +p.h.toFixed(2), s: +cum[i].toFixed(2) })), largo: cum[cum.length - 1], giro: giro * 180 / Math.PI, radioMin: rmin, fuera };
}

/* Eje curvo por ajuste: para curvas suaves (el eje sigue siendo función del largo recto). Centro de la calzada por celda de 2 m
   (puntos a ±0,4 m de la calzada local) y polinomio robusto de grado 3. */
function ejePoli(O, dk) {
  const q = calidadNube(O, dk, groundLevel(O), []); if (!q) return null;
  const bw = 2, nb = Math.ceil(q.deck.length * q.bw / bw), T = Array.from({ length: nb }, () => []);
  for (let i = 0; i < O.n; i++) { const k = Math.floor((O.s[i] - q.s0) / q.bw); if (k < 0 || k >= q.deck.length) continue; if (Math.abs(O.z[i] - q.deck[k]) > .4) continue; const b = Math.floor((O.s[i] - q.s0) / bw); if (T[b].length < 3000) T[b].push(O.t[i]); }
  let X = [], Y = []; for (let b = 0; b < nb; b++) { const v = T[b]; if (v.length < 10) continue; v.sort((a, c) => a - c); X.push(q.s0 + (b + .5) * bw); Y.push((v[Math.floor(v.length * .1)] + v[Math.floor(v.length * .9)]) / 2); }
  if (X.length < 8) return null; const xm = X.reduce((a, c) => a + c) / X.length, xs = Math.max(1, Math.max(...X.map(x => Math.abs(x - xm))));
  const fit = (X, Y) => { const n = 4, A = Array.from({ length: n }, () => new Float64Array(n + 1)); for (let i = 0; i < X.length; i++) { const u = (X[i] - xm) / xs, p = [1, u, u * u, u * u * u]; for (let r = 0; r < n; r++) { for (let c = 0; c < n; c++) A[r][c] += p[r] * p[c]; A[r][n] += p[r] * Y[i]; } }
    for (let c = 0; c < n; c++) { let m = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[m][c])) m = r; [A[c], A[m]] = [A[m], A[c]]; for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; } }
    const co = A.map((r, i) => r[n] / r[i]); return x => { const u = (x - xm) / xs; return co[0] + co[1] * u + co[2] * u * u + co[3] * u * u * u; }; };
  let f = fit(X, Y); for (let it = 0; it < 3; it++) { const r = X.map((x, i) => Math.abs(Y[i] - f(x))), m = r.slice().sort((a, c) => a - c)[r.length >> 1] || .1, k = X.map((_, i) => r[i] <= Math.max(1, 3 * m)); const X2 = X.filter((_, i) => k[i]), Y2 = Y.filter((_, i) => k[i]); if (X2.length < 8) break; f = fit(X2, Y2); }
  // fuera de los datos, el eje sigue recto con la tangente del extremo (un polinomio extrapolado se dispara)
  const x0 = X[0], x1 = X[X.length - 1], d0 = (f(x0 + 1) - f(x0)), d1 = (f(x1) - f(x1 - 1)), g = x => x < x0 ? f(x0) + d0 * (x - x0) : x > x1 ? f(x1) + d1 * (x - x1) : f(x);
  const S = []; for (let x = x0 - 30; x <= x1 + 30; x += 1) S.push({ x, y: g(x), h: dk, w: q.ancho });
  // flecha del eje en planta: separación máxima entre la curva ajustada y la recta que une sus extremos
  let sag = 0; const y0 = f(x0), y1 = f(x1); for (let x = x0; x <= x1; x += 1) { const yl = y0 + (y1 - y0) * (x - x0) / Math.max(1e-6, x1 - x0); sag = Math.max(sag, Math.abs(f(x) - yl) / Math.hypot(1, (y1 - y0) / Math.max(1e-6, x1 - x0))); }
  S.sagita = sag; S.largoDatos = x1 - x0; S.ancho = q.anchoLocal || q.ancho;
  return S;
}
/* Elección automática: se prueban el ajuste suave y el recorrido; gana el que deja el puente más «derecho»
   (franja ocupada por la calzada más cercana a su ancho por metro, medida con la misma calidad de la nube). */
function ejeAuto(O, dk, forzar = false) {
  // ¿hace falta? flecha del eje en planta mayor que máx(2 m, 1/4 del ancho de la calzada)
  const S0 = ejePoli(O, dk); if (!S0) return null; const umbral = Math.max(2, .25 * (S0.ancho || 4));
  if (!forzar && S0.sagita <= umbral) return { innecesario: true, sagita: S0.sagita };
  const C = [];
  try { const E = desenrollar(O, S0, 4); E.metodo = 'ajuste suave'; C.push(E); } catch (e) {}
  try { const E = ejeCurvo(O, dk); if (E) { E.metodo = 'recorrido de la calzada'; C.push(E); } } catch (e) {}
  // gana el que deja el eje más recto (menor flecha remanente medida con el mismo ajuste)
  let best = null; for (const E of C) { let r = Infinity; try { const S1 = ejePoli(E.O, deckLevel(E.O)); if (S1) r = S1.sagita; } catch (e) {} E.resto = r; if (!best || r < best.resto) best = E; }
  if (best) { best.sagita = S0.sagita; if (!(best.resto < S0.sagita)) return { innecesario: true, sagita: S0.sagita }; }
  return best;
}

/* ---------- Dimensiones de los elementos medidas en la nube ----------
   Pilares: espesor a lo largo del eje, ancho transversal, número de columnas, altura e inclinación.
   Tablero: canto (de la calzada al fondo de la sección), por vano, solo donde se ve la cara inferior. */
function dimensiones(O, dk, gr, supports, W = {}) {
  W = Object.assign({ HUECO: 1, BW: 1 }, W);
  const q = calidadNube(O, dk, gr, supports); if (!q) return null;
  const deckAt0 = s => { const k = Math.floor((s - q.s0) / q.bw); return q.deck[Math.max(0, Math.min(q.deck.length - 1, k))]; };
  // superficie de la calzada: la capa horizontal MÁS ALTA y extensa (no la más poblada). En un escaneo desde abajo la capa más poblada
  // suele ser la cara inferior del tablero; la calzada queda encima. Por celda de 1 m: capas de 0,2 m con ≥ 20 % de la más poblada
  // que cubran al menos la mitad del ancho; se toma la más alta entre −1 y +4 m del nivel de referencia, y se suaviza (mediana ±5 m).
  const nq = q.deck.length, Lz = Array.from({ length: nq }, () => new Map());
  { const tb = []; for (let i = 0; i < O.n; i++) if (Math.abs(O.z[i] - deckAt0(O.s[i])) < .5) tb.push(O.t[i]); tb.sort((a, b) => a - b); var u0 = tb[Math.floor(tb.length * .03)], u1 = tb[Math.floor(tb.length * .97)]; }
  for (let i = 0; i < O.n; i++) { const t = O.t[i]; if (t < u0 || t > u1) continue; const k = Math.floor((O.s[i] - q.s0) / q.bw); if (k < 0 || k >= nq) continue; const h = O.z[i] - q.deck[k]; if (h < -1 || h > 4) continue;
    const L = Math.floor(h / .2), m = Lz[k]; let c = m.get(L); if (!c) m.set(L, c = { n: 0, t: new Set() }); c.n++; c.t.add(Math.floor((t - u0) / .5)); }
  const top0 = new Float32Array(nq).fill(NaN); for (let k = 0; k < nq; k++) { let mx = 0; for (const c of Lz[k].values()) mx = Math.max(mx, c.n); let best = null;
    for (const [L, c] of Lz[k]) { if (c.n < .2 * mx || c.n < 5) continue; if (c.t.size < .5 * Math.ceil((u1 - u0) / .5)) continue; /* la calzada ocupa todo el ancho; una baranda, solo los bordes */ if (best == null || L > best) best = L; }
    if (best != null) top0[k] = q.deck[k] + (best + .5) * .2; }
  const topS = new Float32Array(nq); for (let k = 0; k < nq; k++) { const v = []; for (let j = k - 5; j <= k + 5; j++) if (top0[j] === top0[j]) v.push(top0[j]); v.sort((a, b) => a - b); topS[k] = v.length ? v[v.length >> 1] : q.deck[k]; }
  const deckAt = s => { const k = Math.floor((s - q.s0) / q.bw); return topS[Math.max(0, Math.min(nq - 1, k))]; };
  const tt = []; for (let i = 0; i < O.n; i++) if (Math.abs(O.z[i] - deckAt(O.s[i])) < .5) tt.push(O.t[i]); tt.sort((a, b) => a - b);
  const tm = tt[tt.length >> 1], t0 = tt[Math.floor(tt.length * .03)], t1 = tt[Math.floor(tt.length * .97)], B = t1 - t0;
  const sp = supports.slice().sort((a, b) => a.a - b.a), pct = (v, p) => v[Math.min(v.length - 1, Math.max(0, Math.floor(p * (v.length - 1))))];
  // canto del tablero: por celda de 1 m del eje (lejos de los apoyos), en todo el ancho: de la calzada al borde superior del mayor hueco vertical (≥ 1 m)
  const nb = Math.ceil((q.s0 + q.deck.length * q.bw - q.s0) / W.BW), cel = new Map();
  for (let i = 0; i < O.n; i++) { const s = O.s[i], t = O.t[i]; if (t < t0 || t > t1) continue; if (sp.some(p => s > p.a - 3 && s < p.b + 3)) continue; const zs = deckAt(s), z = O.z[i]; if (z > zs + .3 || z < zs - 15 || z < gr - 1) continue; /* el terreno entra: el mayor hueco es el espacio libre */
    const k = Math.floor((s - q.s0) / W.BW) * 4096; let v = cel.get(k); if (!v) cel.set(k, v = []); v.push(z); }
  const canto = []; // [s, profundidad]
  for (const [k, v] of cel) { if (v.length < 6) continue; v.sort((a, b) => b - a); const s = q.s0 + (Math.floor(k / 4096) + .5) * W.BW, zs = deckAt(s); if (v[0] < zs - .3) continue; // la celda debe tener calzada
    // el fondo de la sección está sobre el MAYOR hueco vertical (el espacio libre bajo el puente), no sobre el primero: entre vigas,
    // o en almas vistas de lejos, hay huecos menores que no son el fondo
    let fondo = null, gmax = 0; for (let j = 1; j < v.length; j++) { const g = v[j - 1] - v[j]; if (g > gmax) { gmax = g; fondo = v[j - 1]; } } if (gmax < W.HUECO) fondo = null;
    if (fondo == null || zs - fondo < .15) continue; // sin hueco, o el hueco empieza bajo la calzada misma: no se ve la sección
    canto.push([s, zs - fondo]); }
  // por bin de eje: el canto mayor de las franjas (el fondo de las vigas, no solo la losa)
  const porS = new Map(); for (const [s, d] of canto) { const k = Math.floor(s); porS.set(k, Math.max(porS.get(k) || 0, d)); }
  const cs = [...porS.values()].sort((a, b) => a - b), cantoMed = cs.length >= 5 ? pct(cs, .5) : null;
  const vanos = []; for (let k = 1; k < sp.length; k++) { const a = sp[k - 1].b, b = sp[k].a, v = [...porS].filter(([s]) => s >= a && s <= b).map(x => x[1]).sort((x, y) => x - y); vanos.push({ i: k, a: +a.toFixed(1), b: +b.toFixed(1), canto: v.length >= 5 ? +pct(v, .5).toFixed(2) : null, n: v.length }); }
  // pilares
  // pilares: celdas de 0,25 × 0,25 m en planta con puntos en muchos niveles entre el terreno y el fondo del tablero (un fuste es continuo en altura;
  // el terreno, la vegetación baja o el talud no)
  const hTab = cantoMed || .5, pil = sp.filter(p => p.tipo === 'pilar').map((p, i) => {
    const sc = (p.a + p.b) / 2, zt = deckAt(sc) - hTab - .3, idx = []; let zg = Infinity;
    for (let j = 0; j < O.n; j++) { const s = O.s[j]; if (s < p.a - 2 || s > p.b + 2) continue; const t = O.t[j]; if (t < t0 - 3 || t > t1 + 3) continue; if (O.z[j] < zg) zg = O.z[j]; if (O.z[j] <= zt) idx.push(j); }
    const z0 = Math.max(gr, zg) + .5, nl = Math.max(2, Math.floor((zt - z0) / .5)); if (zt - z0 < 1 || idx.length < 30) return { i: i + 1, s: +sc.toFixed(1), n: idx.length };
    const C = new Map(); for (const j of idx) { const z = O.z[j]; if (z < z0) continue; const k = Math.floor(O.s[j] / .25) * 1e6 + Math.floor(O.t[j] / .25) + 5e5; let c = C.get(k); if (!c) C.set(k, c = new Set()); c.add(Math.floor((z - z0) / .5)); }
    const col0 = []; for (const [k, v] of C) if (v.size >= .6 * nl) col0.push({ k, s: (Math.floor(k / 1e6) + .5) * .25, t: (k % 1e6 - 5e5 + .5) * .25, n: v.size });
    // grupos conexos de celdas (vecinas a ≤ 0,5 m); el fuste es el grupo con más celdas cerca del centro del apoyo, y se le suman los grupos
    // alineados con él a lo largo del eje (columnas del mismo pórtico). Un muro, un talud o árboles a un lado quedan fuera.
    const seen = new Set(), grp = []; for (const c of col0) { if (seen.has(c.k)) continue; const g = [c]; seen.add(c.k); for (let q = 0; q < g.length; q++) for (const d of col0) if (!seen.has(d.k) && Math.abs(d.s - g[q].s) <= .5 && Math.abs(d.t - g[q].t) <= .5) { seen.add(d.k); g.push(d); } grp.push(g); }
    const cen = g => g.reduce((x, c) => x + c.s, 0) / g.length, main = grp.filter(g => g.length >= 2 && Math.abs(cen(g) - sc) <= Math.max(2, (p.b - p.a) / 2 + 1)).sort((x, y) => y.length - x.length)[0];
    if (!main) return { i: i + 1, s: +sc.toFixed(1), n: idx.length, sinFuste: true };
    const sm = cen(main), col = grp.filter(g => g.length >= 2 && Math.abs(cen(g) - sm) <= 1).flat().map(c => [c.s, c.t]);
    // extensión por los puntos del fuste (no por las celdas, que agregan 0,25 m)
    const enF = new Set(col.map(c => Math.floor(c[0] / .25) * 1e6 + Math.floor(c[1] / .25) + 5e5)), Ps = [], Pt = []; for (const j of idx) { if (O.z[j] < z0) continue; const k = Math.floor(O.s[j] / .25) * 1e6 + Math.floor(O.t[j] / .25) + 5e5; if (enF.has(k)) { Ps.push(O.s[j]); Pt.push(O.t[j]); } }
    Ps.sort((x, y) => x - y); Pt.sort((x, y) => x - y);
    const Ss = col.map(c => c[0]).sort((x, y) => x - y), Ts = col.map(c => c[1]).sort((x, y) => x - y);
    const ks = [...new Set(Ts.map(t => Math.round(t / .25)))].sort((x, y) => x - y), cols = []; for (const k of ks) { const c = cols[cols.length - 1]; if (c && k - c.b <= 3) c.b = k; else cols.push({ a: k, b: k }); }
    // inclinación: centro en s de los puntos del fuste por nivel de 1 m (pendiente en mm/m)
    const enFuste = new Set(col.map(c => Math.floor(c[0] / .25) * 1e6 + Math.floor(c[1] / .25) + 5e5)), lv = new Map();
    for (const j of idx) { const z = O.z[j]; if (z < z0) continue; const k = Math.floor(O.s[j] / .25) * 1e6 + Math.floor(O.t[j] / .25) + 5e5; if (!enFuste.has(k)) continue; const L = Math.floor(z); let v = lv.get(L); if (!v) lv.set(L, v = []); v.push(O.s[j]); }
    const P = [...lv].filter(([, v]) => v.length >= 5).map(([k, v]) => { v.sort((x, y) => x - y); return [k + .5, v[v.length >> 1]]; }); let incl = null;
    // solo con al menos 6 niveles y un ajuste limpio (residuo ≤ 5 % del espesor); si no, la inclinación no se informa
    if (P.length >= 6) { const mz = P.reduce((x, y) => x + y[0], 0) / P.length, ms = P.reduce((x, y) => x + y[1], 0) / P.length; let num = 0, den = 0; for (const [z, s] of P) { num += (z - mz) * (s - ms); den += (z - mz) ** 2; } const b = den ? num / den : 0;
      const rs = Math.sqrt(P.reduce((x, [z, s]) => x + (s - ms - b * (z - mz)) ** 2, 0) / P.length), esp = Ss[Ss.length - 1] - Ss[0] + .25; if (den && rs <= .05 * esp + .02) incl = 1000 * b; }
    return { i: i + 1, s: +sc.toFixed(1), n: idx.length, espesor: +(pct(Ps, .99) - pct(Ps, .01)).toFixed(2), ancho: +(pct(Pt, .99) - pct(Pt, .01)).toFixed(2), columnas: cols.length,
      anchoColumna: +(Math.max(...cols.map(c => c.b - c.a + 1)) * .25).toFixed(2), completo: (pct(Pt, .99) - pct(Pt, .01)) >= .25 * B, /* fuste angosto bajo un tablero ancho: visto solo en parte */ altura: +(zt + .3 + hTab - z0 + .5).toFixed(2), inclinacion: incl != null ? +incl.toFixed(1) : null }; });
  let dTop = []; for (let k = 0; k < nq; k++) if (top0[k] === top0[k]) dTop.push(topS[k] - q.deck[k]); dTop.sort((a, b) => a - b); const sobre = dTop.length ? dTop[dTop.length >> 1] : 0;
  return { calzadaSobreReferencia: +sobre.toFixed(2), anchoTablero: +B.toFixed(2), canto: cantoMed != null ? +cantoMed.toFixed(2) : null, cantoN: cs.length, vanos, pilares: pil };
}

/* ---------- Atributos de cada punto: vegetación, materiales y zonas anómalas ----------
   attr: atributos de la nube (intensidad, rojo, verde, azul, retorno, retornos, clase), alineados con la nube; O.src da el índice si O es un subconjunto.
   Vegetación: clase ASPRS 3–5; retorno que no es el último de varios (el láser atravesó follaje), fuera de la calzada; o verde dominante (exceso de verde).
   Zonas: calzada, cara inferior y vigas, pilares, estructura sobre la calzada. A lo largo del eje, celdas de 1 m cuya intensidad (o rojez)
   se aparta de su entorno (mediana móvil de ±15 m) en más de 4 desviaciones robustas, en 3 m o más seguidos: cambio de material, humedad,
   suciedad, óxido o reparación; se revisan en campo (la intensidad también cambia con la distancia y el ángulo del escáner). */
function atributosNube(O, attr, dk, gr, supports = [], q = null, canto = null) {
  if (!attr) return null; const A = k => attr[k] ? (O.src ? (i => attr[k][O.src[i]]) : (i => attr[k][i])) : null;
  const I = A('intensidad'), R = A('rojo'), G = A('verde'), Bl = A('azul'), RN = A('retorno'), NR = A('retornos'), CL = A('clase');
  q = q || calidadNube(O, dk, gr, supports); if (!q) return null;
  const deckAt = s => { const k = Math.floor((s - q.s0) / q.bw); return q.deck[Math.max(0, Math.min(q.deck.length - 1, k))]; };
  const n = O.n, veg = new Uint8Array(n), por = { clase: 0, retornos: 0, color: 0 };
  const color = R && G && Bl ? (() => { let gris = 0; for (let i = 0; i < n; i += 97) if (Math.abs(R(i) - G(i)) < 1 && Math.abs(G(i) - Bl(i)) < 1) gris++; return gris < .9 * Math.ceil(n / 97); })() : false; // color real (no gris de intensidad)
  // por vóxel de 1 m: el follaje es un volumen (dispersión alta) con muchos retornos intermedios o puntos verdes; un cable, un arco o un
  // pendolón también dan retornos intermedios, pero en una línea (dispersión baja), y una estructura verdosa no es verde en todo el vóxel
  const vk = i => (Math.floor(O.s[i]) + 50000) * 1e8 + (Math.floor(O.t[i]) + 5000) * 1e4 + (Math.floor(O.z[i]) + 5000), V = new Map();
  for (let i = 0; i < n; i++) { const k = vk(i); let v = V.get(k); if (!v) V.set(k, v = { n: 0, mi: 0, gr: 0, m: new Float64Array(9) }); v.n++;
    if (RN && NR) { const nr = NR(i), rn = RN(i); if (nr > 1 && rn < nr) v.mi++; }
    if (color) { const r = R(i), g = G(i), b = Bl(i), exg = (2 * g - r - b) / (r + g + b + 1); if (exg > .08 && g > r && g > b) v.gr++; }
    const x = O.s[i], y = O.t[i], z = O.z[i], m = v.m; m[0] += x; m[1] += y; m[2] += z; m[3] += x * x; m[4] += x * y; m[5] += x * z; m[6] += y * y; m[7] += y * z; m[8] += z * z; }
  const esf = v => { const N = v.n, m = v.m, mx = m[0] / N, my = m[1] / N, mz = m[2] / N, e = eig3([m[3] / N - mx * mx, m[4] / N - mx * my, m[5] / N - mx * mz, m[6] / N - my * my, m[7] / N - my * mz, m[8] / N - mz * mz]); return e.l[2] / (e.l[0] + 1e-9); };
  for (const v of V.values()) { v.veg = 0; if (v.n < 5) continue; const d = esf(v); if (v.mi >= .3 * v.n && d >= .08) v.veg = 2; else if (v.gr >= .6 * v.n && d >= .05) v.veg = 3; }
  for (let i = 0; i < n; i++) { if (CL) { const c = CL(i); if (c === 3 || c === 4 || c === 5) { veg[i] = 1; por.clase++; continue; } }
    const v = V.get(vk(i)); if (!v || !v.veg) continue; const h = O.z[i] - deckAt(O.s[i]); if (Math.abs(h) < .4) continue; // la calzada nunca es vegetación
    veg[i] = 1; if (v.veg === 2) por.retornos++; else por.color++; }
  let nv = 0; for (let i = 0; i < n; i++) nv += veg[i];
  // zonas
  const sp = supports.slice().sort((a, b) => a.a - b.a), hc = canto || 1.5, tt = []; for (let i = 0; i < n; i += 3) if (Math.abs(O.z[i] - deckAt(O.s[i])) < .4) tt.push(O.t[i]); tt.sort((a, b) => a - b);
  const t0 = tt[Math.floor(tt.length * .03)], t1 = tt[Math.floor(tt.length * .97)];
  const zona = i => { if (veg[i]) return -1; const s = O.s[i], t = O.t[i], h = O.z[i] - deckAt(s); if (t < t0 - 1 || t > t1 + 1) return -1;
    if (Math.abs(h) < .4) return 0; if (h > 2) return 3; const enApoyo = sp.some(p => p.tipo === 'pilar' && s >= p.a - .5 && s <= p.b + .5);
    if (enApoyo && h < -hc - .3 && O.z[i] > gr + .5) return 2; if (h <= -.4 && h >= -hc - .3) return 1; return -1; };
  const NOM = ['calzada', 'cara inferior y vigas', 'pilares', 'estructura sobre la calzada'], Z = NOM.map(() => ({ I: [], RI: [], L: [] }));
  const zi = new Int8Array(n); for (let i = 0; i < n; i++) { const z = zona(i); zi[i] = z; if (z < 0) continue; const Zz = Z[z]; if (Zz.I.length < 60000 || i % 5 === 0) { if (I) Zz.I.push(I(i)); if (color) { const r = R(i), g = G(i), b = Bl(i); Zz.RI.push((r - g) / (r + g + 1)); Zz.L.push((r + g + b) / 3); } } }
  const med = v => { if (!v.length) return null; v = v.slice().sort((a, b) => a - b); return v[v.length >> 1]; }, pc = (v, p) => { v = v.slice().sort((a, b) => a - b); return v[Math.floor(p * (v.length - 1))]; };
  const zonas = NOM.map((nm, k) => ({ zona: nm, puntos: Z[k].I.length || Z[k].RI.length, intensidad: Z[k].I.length >= 200 ? { mediana: +med(Z[k].I).toFixed(1), p10: +pc(Z[k].I, .1).toFixed(1), p90: +pc(Z[k].I, .9).toFixed(1) } : null,
    rojez: Z[k].RI.length >= 200 ? +med(Z[k].RI).toFixed(3) : null, brillo: Z[k].L.length >= 200 ? +med(Z[k].L).toFixed(0) : null })).filter(z => z.puntos >= 200);
  // perfiles a lo largo del eje y zonas anómalas (calzada y cara inferior)
  const anom = [], perfiles = {};
  const perfil = (zz, f, nombre) => { const nb = q.deck.length, B = Array.from({ length: nb }, () => []);
    for (let i = 0; i < n; i++) if (zi[i] === zz) { const b = Math.floor((O.s[i] - q.s0) / q.bw); if (b >= 0 && b < nb && B[b].length < 400) B[b].push(f(i)); }
    const v = B.map(x => x.length >= 20 ? med(x) : null), tr = v.map((_, b) => { const w = []; for (let j = b - 15; j <= b + 15; j++) if (j >= 0 && j < nb && v[j] != null) w.push(v[j]); return w.length >= 8 ? med(w) : null; });
    const res = v.map((x, b) => x != null && tr[b] != null ? x - tr[b] : null), rr = res.filter(x => x != null); if (rr.length < 20) return; const nivel = Math.abs(med(tr.filter(x => x != null))) || 1;
    const mad = Math.max(med(rr.map(Math.abs)) * 1.4826, .02 * nivel, nombre.startsWith('rojez') ? .01 : 1e-6); // piso: 2 % del nivel (y 0,01 de rojez), para que valores casi iguales no den desvíos enormes
    perfiles[nombre] = { s0: q.s0, bw: q.bw, valor: v.map(x => x == null ? null : +x.toFixed(3)) };
    for (let b = 0; b < nb;) { const zb = res[b] != null ? res[b] / mad : 0; if (Math.abs(zb) < 4) { b++; continue; } const sg = Math.sign(zb); let e = b; while (e + 1 < nb && res[e + 1] != null && Math.sign(res[e + 1]) === sg && Math.abs(res[e + 1] / mad) >= 4) e++;
      if ((e - b + 1) * q.bw >= 3) { let mz = 0; for (let j = b; j <= e; j++) mz = Math.max(mz, Math.abs(res[j] / mad)); anom.push({ zona: NOM[zz], atributo: nombre.split(' ')[0], a: +(q.s0 + b * q.bw).toFixed(1), b: +(q.s0 + (e + 1) * q.bw).toFixed(1), signo: sg > 0 ? 'mayor' : 'menor', desvios: +mz.toFixed(1), cambio: tr[b] ? +(100 * res[b] / Math.abs(tr[b])).toFixed(0) : null }); }
      b = e + 1; } };
  if (I) { perfil(0, I, 'intensidad calzada'); perfil(1, I, 'intensidad cara inferior'); }
  if (color) { const ri = i => { const r = R(i), g = G(i); return (r - g) / (r + g + 1); }; perfil(0, ri, 'rojez calzada'); perfil(1, ri, 'rojez cara inferior'); }
  // las más marcadas primero; se listan hasta 10 (en la calzada, marcas viales, parches de asfalto o vehículos también las producen)
  anom.sort((x, y) => y.desvios - x.desvios); const nAnom = anom.length;
  return { presentes: Object.keys(attr), colorReal: color, vegetacion: { puntos: nv, fraccion: +(nv / n).toFixed(3), por }, mascaraVeg: veg, zonas, anomalias: anom.slice(0, 10), nAnomalias: nAnom, perfiles };
}

/* ---------- Comparación entre dos fechas (dos nubes del mismo puente) ----------
   A = nube de referencia (fecha 1) y B = otra fecha, en el mismo marco (orientarComo). Si no se superponen, se alinean con ICP
   (punto a punto, recortado al 80 % más cercano, sobre muestras de vóxel de 0,5 m).
   Cambio en cada punto núcleo de A (vóxel de 0,5 m): se toma la normal local de A (componente menor de sus vecinos a 1 m) y,
   dentro de un cilindro de radio 0,5 m y ±1 m a lo largo de esa normal, se comparan las posiciones medias de A y de B (como M3C2).
   Si las dos nubes están en el mismo sistema de coordenadas (georref) no se alinean: un puente nuevo arrastraría el ajuste; el desfase vertical
   entre campañas se estima en el suelo marcado (clase 2) y se descuenta. Si no, ICP (en un puente largo y prismático puede deslizar a lo largo del eje).
   Nivel de detección al 95 %: 1,96·√(σA²/nA + σB²/nB) + error de registro. Sin puntos de B cerca: «no está en la otra fecha»
   (se quitó, cambió mucho o no se escaneó); puntos de B sin A cerca: «nuevo». */
function compararNubes(OA, OB, dk, gr, supports = [], W = {}) {
  W = Object.assign({ vox: .5, rn: 1, rc: .5, h: 1, icp: 'auto', regErr: null, sueloA: null, georef: false }, W);
  if (W.icp === 'auto') W.icp = W.georef ? 'no' : 'si'; // mismo sistema de coordenadas: no se alinea (un puente nuevo arrastraría el ajuste); si no, ICP
  const key = (a, b, c) => (a + 50000) * 1e10 + (b + 50000) * 1e5 + (c + 50000);
  const grid = (O, c, idx) => { const G = new Map(); const L = idx ? idx.length : O.n; for (let q = 0; q < L; q++) { const i = idx ? idx[q] : q; const k = key(Math.floor(O.s[i] / c), Math.floor(O.t[i] / c), Math.floor(O.z[i] / c)); let v = G.get(k); if (!v) G.set(k, v = []); v.push(i); } return G; };
  const vecinos = (G, c, O, x, y, z, r, out) => { out.length = 0; const a0 = Math.floor((x - r) / c), a1 = Math.floor((x + r) / c), b0 = Math.floor((y - r) / c), b1 = Math.floor((y + r) / c), c0 = Math.floor((z - r) / c), c1 = Math.floor((z + r) / c);
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) for (let d = c0; d <= c1; d++) { const v = G.get(key(a, b, d)); if (!v) continue; for (const i of v) { const dx = O.s[i] - x, dy = O.t[i] - y, dz = O.z[i] - z; if (dx * dx + dy * dy + dz * dz <= r * r) out.push(i); } } return out; };
  // núcleos: un punto por vóxel (el más cercano al centroide)
  const nucleos = O => { const V = new Map(); for (let i = 0; i < O.n; i++) { const k = key(Math.floor(O.s[i] / W.vox), Math.floor(O.t[i] / W.vox), Math.floor(O.z[i] / W.vox)); if (!V.has(k)) V.set(k, i); } return [...V.values()]; };
  // B en una copia (para moverla con el ICP sin tocar la original)
  let Bs = Float32Array.from(OB.s), Bt = Float32Array.from(OB.t), Bz = Float32Array.from(OB.z); const B = { s: Bs, t: Bt, z: Bz, n: OB.n };
  const CA = nucleos(OA), GA = grid(OA, 1);
  const solape = () => { const CB = nucleos(B), m = Math.min(CB.length, 20000), st = Math.max(1, Math.floor(CB.length / m)), tmp = []; let ok = 0, tot = 0; for (let q = 0; q < CB.length; q += st) { const i = CB[q]; tot++; if (vecinos(GA, 1, OA, B.s[i], B.t[i], B.z[i], .5, tmp).length) ok++; } return ok / Math.max(1, tot); };
  let sol0 = solape(), icp = null;
  if (W.icp === 'si') {
    // ICP punto a punto con rotaciones pequeñas (Kabsch), sobre muestras; correspondencias al 80 % más cercano
    const muestra = nucleos(B).filter((_, k) => k % 3 === 0).slice(0, 30000); let R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], T = [0, 0, 0], rms = Infinity; const tmp = [];
    for (let it = 0; it < 30; it++) { const pares = []; for (const i of muestra) { const x = R[0][0] * Bs[i] + R[0][1] * Bt[i] + R[0][2] * Bz[i] + T[0], y = R[1][0] * Bs[i] + R[1][1] * Bt[i] + R[1][2] * Bz[i] + T[1], z = R[2][0] * Bs[i] + R[2][1] * Bt[i] + R[2][2] * Bz[i] + T[2];
        let best = -1, bd = Infinity; for (const j of vecinos(GA, 1, OA, x, y, z, it < 10 ? 3 : 1.5, tmp)) { const d = (OA.s[j] - x) ** 2 + (OA.t[j] - y) ** 2 + (OA.z[j] - z) ** 2; if (d < bd) { bd = d; best = j; } } if (best >= 0) pares.push([x, y, z, OA.s[best], OA.t[best], OA.z[best], bd, i]); }
      if (pares.length < 100) break; pares.sort((a, b) => a[6] - b[6]); const P = pares.slice(0, Math.floor(pares.length * .8));
      const cb = [0, 0, 0], ca = [0, 0, 0]; for (const p of P) for (let k = 0; k < 3; k++) { cb[k] += p[k]; ca[k] += p[3 + k]; } for (let k = 0; k < 3; k++) { cb[k] /= P.length; ca[k] /= P.length; }
      const H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const p of P) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) H[a][b] += (p[a] - cb[a]) * (p[3 + b] - ca[b]);
      // rotación de Kabsch por cuaternión (Horn): mayor vector propio de la matriz N de 4×4
      const [[Sxx, Sxy, Sxz], [Syx, Syy, Syz], [Szx, Szy, Szz]] = H, N = [[Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx], [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz], [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy], [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz]];
      let qv = [1, 0, 0, 0]; const sh = Math.abs(N[0][0]) + Math.abs(N[1][1]) + Math.abs(N[2][2]) + Math.abs(N[3][3]) + 1; for (let k = 0; k < 60; k++) { const w = [0, 0, 0, 0]; for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) w[a] += (N[a][b] + (a === b ? sh : 0)) * qv[b]; const nn = Math.hypot(...w); qv = w.map(x => x / nn); }
      const [q0, q1, q2, q3] = qv, dR = [[q0 * q0 + q1 * q1 - q2 * q2 - q3 * q3, 2 * (q1 * q2 - q0 * q3), 2 * (q1 * q3 + q0 * q2)], [2 * (q1 * q2 + q0 * q3), q0 * q0 - q1 * q1 + q2 * q2 - q3 * q3, 2 * (q2 * q3 - q0 * q1)], [2 * (q1 * q3 - q0 * q2), 2 * (q2 * q3 + q0 * q1), q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3]];
      const dT = [0, 1, 2].map(a => ca[a] - (dR[a][0] * cb[0] + dR[a][1] * cb[1] + dR[a][2] * cb[2]));
      R = dR.map((row, a) => [0, 1, 2].map(b => row[0] * R[0][b] + row[1] * R[1][b] + row[2] * R[2][b])); T = [0, 1, 2].map(a => dR[a][0] * T[0] + dR[a][1] * T[1] + dR[a][2] * T[2] + dT[a]);
      const nr = Math.sqrt(P.reduce((x, p) => x + p[6], 0) / P.length); const mov = Math.hypot(...dT); rms = nr; if (mov < 1e-3 && it > 5) break; }
    for (let i = 0; i < B.n; i++) { const x = Bs[i], y = Bt[i], z = Bz[i]; Bs[i] = R[0][0] * x + R[0][1] * y + R[0][2] * z + T[0]; Bt[i] = R[1][0] * x + R[1][1] * y + R[1][2] * z + T[1]; Bz[i] = R[2][0] * x + R[2][1] * y + R[2][2] * z + T[2]; }
    icp = { traslacion: T.map(v => +v.toFixed(3)), giroGrados: +(Math.acos(Math.min(1, (R[0][0] + R[1][1] + R[2][2] - 1) / 2)) * 180 / Math.PI).toFixed(3), rms: +rms.toFixed(3), solapeAntes: +sol0.toFixed(2) }; sol0 = solape(); }
  const GB = grid(B, 1);
  // calidad de la zona de cada núcleo (con el tablero local de A)
  const q = calidadNube(OA, dk, gr, supports); const deckAt = s => { if (!q) return dk; const k = Math.floor((s - q.s0) / q.bw); return q.deck[Math.max(0, Math.min(q.deck.length - 1, k))]; };
  const tt = []; for (let i = 0; i < OA.n; i += 3) if (Math.abs(OA.z[i] - deckAt(OA.s[i])) < .4) tt.push(OA.t[i]); tt.sort((a, b) => a - b); const t0 = tt[Math.floor(tt.length * .03)], t1 = tt[Math.floor(tt.length * .97)];
  const sp = supports.slice().sort((a, b) => a.a - b.a);
  const zona = (s, t, z) => { const h = z - deckAt(s); if (t < t0 - 1 || t > t1 + 1) return z < gr + 1 ? 'terreno o agua' : 'fuera del tablero'; if (Math.abs(h) < .4) return 'calzada'; if (h > 2) return 'estructura sobre la calzada';
    if (sp.some(p => p.tipo === 'pilar' && s >= p.a - .5 && s <= p.b + .5) && z > gr + .5 && h < -.4) return 'pilares'; if (h < -.4 && h > -3) return 'cara inferior y vigas'; if (z < gr + 1) return 'terreno o agua'; return 'otros'; };
  const tmpA = [], tmpB = [], res = []; let sinB = 0;
  for (const i of CA) { const x = OA.s[i], y = OA.t[i], z = OA.z[i], NA = vecinos(GA, 1, OA, x, y, z, W.rn, tmpA); if (NA.length < 5) continue;
    let mx = 0, my = 0, mz = 0; for (const j of NA) { mx += OA.s[j]; my += OA.t[j]; mz += OA.z[j]; } mx /= NA.length; my /= NA.length; mz /= NA.length;
    const C = [0, 0, 0, 0, 0, 0]; for (const j of NA) { const a = OA.s[j] - mx, b = OA.t[j] - my, c = OA.z[j] - mz; C[0] += a * a; C[1] += a * b; C[2] += a * c; C[3] += b * b; C[4] += b * c; C[5] += c * c; }
    const e = eig3(C.map(v => v / NA.length)), nv = e.v[2], nrm = nv[2] < 0 ? nv.map(v => -v) : nv; // normal hacia arriba (o hacia +s/+t si es vertical)
    const proy = (O, L) => { const d = []; for (const j of L) { const a = O.s[j] - x, b = O.t[j] - y, c = O.z[j] - z, p = a * nrm[0] + b * nrm[1] + c * nrm[2], lat2 = a * a + b * b + c * c - p * p; if (lat2 <= W.rc * W.rc && Math.abs(p) <= W.h) d.push(p); } return d; };
    const dA = proy(OA, vecinos(GA, 1, OA, x, y, z, Math.hypot(W.rc, W.h), tmpA)), dB = proy(B, vecinos(GB, 1, B, x, y, z, Math.hypot(W.rc, W.h), tmpB));
    if (dA.length < 3) continue; const zn = zona(x, y, z); if (dB.length < 3) { sinB++; res.push({ s: x, t: y, z, zona: zn, d: null }); continue; }
    const m = v => v.reduce((a, b) => a + b, 0) / v.length, sd = (v, mu) => Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, v.length - 1));
    const ma = m(dA), mb = m(dB), lod = 1.96 * Math.sqrt(sd(dA, ma) ** 2 / dA.length + sd(dB, mb) ** 2 / dB.length);
    res.push({ s: x, t: y, z, zona: zn, d: mb - ma, lod, nz: Math.abs(nrm[2]), suelo: W.sueloA ? W.sueloA[i] === 1 : false }); }
  // desfase vertical sistemático entre campañas, medido en el terreno plano: se descuenta en la componente vertical de cada cambio
  // solo con puntos de suelo marcados en A (clase 2): el agua de un río o la vegetación cambian de nivel entre campañas y no sirven de referencia
  let dzTerreno = 0, nSuelo = 0; if (W.sueloA) { const v = res.filter(r => r.suelo && r.d != null && r.nz > .95).map(r => r.d).sort((a, b) => a - b); nSuelo = v.length; if (v.length >= 200) { dzTerreno = v[v.length >> 1]; for (const r of res) if (r.d != null) r.d -= dzTerreno * r.nz; } }
  // error de registro entre campañas: la dispersión del cambio en el suelo (que no cambia) o, sin suelo marcado, en toda la escena
  // (desviación robusta). Se suma al nivel de detección: sin esto, el ruido propio de cada vuelo o escaneo parece cambio.
  let sRef = W.regErr; if (sRef == null) { const v = (nSuelo >= 200 ? res.filter(r => r.suelo && r.d != null && r.nz > .95) : res.filter(r => r.d != null)).map(r => r.d), m = v.slice().sort((a, b) => a - b)[v.length >> 1] || 0;
    const ad = v.map(x => Math.abs(x - m)).sort((a, b) => a - b); sRef = ad.length ? 1.4826 * ad[ad.length >> 1] : 0; if (icp) sRef = Math.max(sRef, icp.rms); }
  for (const r of res) if (r.d != null) r.lod += 1.96 * sRef;
  // puntos de B sin A cerca: lo nuevo
  // «nuevo»: núcleo de B sin A a 1 m, pero con A en la misma columna de 1 m en planta (A vio ese lugar, a otra altura: algo se construyó encima);
  // si A no tiene nada en esa columna, es una zona que A no escaneó (no se cuenta como cambio). Igual al revés para «no está en la otra fecha».
  const colA = new Set(), colB = new Set(); for (let i = 0; i < OA.n; i++) colA.add(Math.floor(OA.s[i]) * 1e5 + Math.floor(OA.t[i])); for (let i = 0; i < B.n; i++) colB.add(Math.floor(B.s[i]) * 1e5 + Math.floor(B.t[i]));
  const CB = nucleos(B), tmp = []; let nuevos = 0, sinA = 0; const nuevosS = []; for (const i of CB) if (!vecinos(GA, 1, OA, B.s[i], B.t[i], B.z[i], 1, tmp).length) { if (colA.has(Math.floor(B.s[i]) * 1e5 + Math.floor(B.t[i]))) { nuevos++; nuevosS.push([B.s[i], B.t[i], B.z[i]]); } else sinA++; }
  for (const r of res) if (r.d == null && !colB.has(Math.floor(r.s) * 1e5 + Math.floor(r.t))) r.noVisto = true;
  // resumen por zona
  const med = v => { if (!v.length) return null; v = v.slice().sort((a, b) => a - b); return v[v.length >> 1]; }, pc = (v, p) => { v = v.slice().sort((a, b) => a - b); return v[Math.floor(p * (v.length - 1))]; };
  const zonas = {}; for (const r of res) { const z = zonas[r.zona] || (zonas[r.zona] = { nucleos: 0, d: [], sig: 0, sinB: 0 }); z.nucleos++; if (r.d == null) { z.sinB++; continue; } z.d.push(r.d); if (Math.abs(r.d) > r.lod) z.sig++; }
  const resumen = Object.entries(zonas).map(([nm, z]) => ({ zona: nm, nucleos: z.nucleos, mediana: z.d.length ? +med(z.d).toFixed(3) : null, p5: z.d.length ? +pc(z.d, .05).toFixed(3) : null, p95: z.d.length ? +pc(z.d, .95).toFixed(3) : null, significativos: +(z.sig / Math.max(1, z.d.length)).toFixed(2), sinOtraFecha: +(z.sinB / z.nucleos).toFixed(2) })).sort((a, b) => b.nucleos - a.nucleos);
  // perfil del cambio vertical de la calzada a lo largo del eje (celdas de 2 m): asentamientos o flechas
  const pf = new Map(); for (const r of res) if (r.zona === 'calzada' && r.d != null && r.nz > .8) { const k = Math.floor(r.s / 2); let v = pf.get(k); if (!v) pf.set(k, v = []); v.push(r.d); }
  const perfil = [...pf].filter(([, v]) => v.length >= 5).sort((a, b) => a[0] - b[0]).map(([k, v]) => [k * 2 + 1, +med(v).toFixed(3)]);
  // grupos de cambio significativo (≥ 2 m²) y de lo nuevo, en planta
  const agrupar = (pts, c) => { const G = new Map(); for (const p of pts) { const k = Math.floor(p[0] / c) * 1e6 + Math.floor(p[1] / c); let v = G.get(k); if (!v) G.set(k, v = []); v.push(p); } const seen = new Set(), out = [];
    for (const [k] of G) { if (seen.has(k)) continue; const cola = [k], cel = []; seen.add(k); while (cola.length) { const u = cola.pop(); cel.push(u); const a = Math.floor(u / 1e6), b = u - a * 1e6; for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) { const w = (a + da) * 1e6 + (b + db); if (G.has(w) && !seen.has(w)) { seen.add(w); cola.push(w); } } }
      const P = cel.flatMap(u => G.get(u)); if (cel.length * c * c < 2) continue; const ss = P.map(p => p[0]).sort((x, y) => x - y), zz = P.map(p => p[2]).sort((x, y) => x - y);
      const tt2 = P.map(p => p[1]).sort((x, y) => x - y); out.push({ a: +ss[0].toFixed(1), b: +ss[ss.length - 1].toFixed(1), tmin: +tt2[0].toFixed(1), tmax: +tt2[tt2.length - 1].toFixed(1), area: +(cel.length * c * c).toFixed(1), zmin: +zz[0].toFixed(1), zmax: +zz[zz.length - 1].toFixed(1), d: P[0].length > 3 ? +med(P.map(p => p[3])).toFixed(2) : null, n: P.length }); }
    return out.sort((x, y) => y.area - x.area); };
  const cambios = agrupar(res.filter(r => r.d != null && Math.abs(r.d) > r.lod && Math.abs(r.d) >= .1).map(r => [r.s, r.t, r.z, r.d]), 1).slice(0, 15);
  const nuevo = agrupar(nuevosS, 1).slice(0, 15), quitado = agrupar(res.filter(r => r.d == null && !r.noVisto).map(r => [r.s, r.t, r.z]), 1).slice(0, 15);
  const lods = res.filter(r => r.d != null).map(r => r.lod);
  return { solape: +sol0.toFixed(2), icp, dzTerreno: +dzTerreno.toFixed(3), nSuelo, errorRegistro: +(sRef || 0).toFixed(3), nucleos: res.length, sinOtraFecha: sinB, noVistoEnB: res.filter(r => r.noVisto).length, nuevos, noVistoEnA: sinA, lodMediano: lods.length ? +med(lods).toFixed(3) : null, resumen, perfil, cambios, nuevo, quitado, B };
}

/* ---------- Elementos del puente identificados en la nube (para el gemelo y el modelo IFC) ----------
   Tablero por vano, pilares (con sus columnas), estribos, arcos bajo el tablero y sus montantes, arco sobre el tablero y sus péndolas,
   pilonos y sus tirantes, barandas. Cada elemento lleva sus medidas y de dónde salen. Los miembros delgados (péndolas, tirantes,
   montantes) se cuentan como picos de puntos a lo largo del eje en una franja de altura donde solo ellos cruzan. */
function elementos(O, dk, gr, supports, opt = {}) {
  const q = opt.calidad || calidadNube(O, dk, gr, supports); if (!q) return null;
  const D = opt.dims || dimensiones(O, dk, gr, supports), SS = opt.superestructura || superestructura(O, dk, gr);
  const deckAt = s => { const k = Math.floor((s - q.s0) / q.bw); return q.deck[Math.max(0, Math.min(q.deck.length - 1, k))]; };
  /* superficie de la calzada metro a metro: en el centro del ancho (60 %), la capa de 20 cm más alta que cubre a lo ancho (celdas de 0,5 m) al menos la mitad que la capa más extendida de ese metro,
     buscada entre 1,5 m bajo y 2,5 m sobre el seguimiento grueso del tablero; se suaviza con la mediana de ±3 m. La cobertura a lo ancho separa la calzada
     de vehículos o postes, y no depende de si el escáner vio más la cara inferior o la superior. */
  const tdA = q.tb ? q.tb[0] : -Infinity, tdB = q.tb ? q.tb[1] : Infinity, tq0 = tdA + .2 * (tdB - tdA), tq1 = tdB - .2 * (tdB - tdA), nbz = q.deck.length, zb = Array.from({ length: nbz }, () => []);
  const nct = Math.max(1, Math.ceil((tq1 - tq0) / .5));
  for (let i = 0; i < O.n; i++) { const t = O.t[i]; if (t < tq0 || t > tq1) continue; const k = Math.floor((O.s[i] - q.s0) / q.bw); if (k < 0 || k >= nbz) continue; const dz = O.z[i] - q.deck[k]; if (dz > -1.5 && dz < 2.5) zb[k].push(i); }
  const cand = zb.map((v, k) => { if (v.length < 20) return []; const lo = q.deck[k] - 1.5, cel = Array.from({ length: 40 }, () => new Set()), zz = Array.from({ length: 40 }, () => []);
    for (const i of v) { const j = Math.min(39, Math.floor((O.z[i] - lo) / .1)); cel[j].add(Math.floor((O.t[i] - tq0) / .5)); zz[j].push(O.z[i]); }
    const cov = cel.map((c, j) => j ? new Set([...c, ...cel[j - 1]]).size : c.size), cmx = Math.max(...cov); if (cmx < 4) return []; const C = [];
    for (let j = 39; j >= 1; j--) if (cov[j] >= .5 * cmx && cov[j] >= cov[j + 1 < 40 ? j + 1 : j] && (!C.length || C[C.length - 1].j - j > 2)) { const w = zz[j].concat(zz[j - 1]).sort((a, b) => a - b); C.push({ j, z: w[w.length >> 1] }); } return C; });
  /* una capa es calzada si continúa a lo largo del eje: candidatos de ±10 m a la misma cota (±0,3 m más 6 % de pendiente). Vehículos, árboles o postes son cortos */
  const zc0 = cand.map((C, k) => { if (!C.length) return null; const R = Math.round(10 / q.bw), sup = C.map(c => { let n = 0; for (let d = -R; d <= R; d++) { const D2 = cand[k + d]; if (!D2 || !D2.length) continue; if (D2.some(x => Math.abs(x.z - c.z) <= .3 + .06 * Math.abs(d * q.bw))) n++; } return n; }), smx = Math.max(...sup);
    for (let m = 0; m < C.length; m++) if (sup[m] >= .6 * smx) return C[m].z; return C[0].z; });
  const zcal = zc0.map((_, k) => { const w = []; for (let j = k - 3; j <= k + 3; j++) if (zc0[j] != null) w.push(zc0[j]); if (!w.length) return null; w.sort((a, b) => a - b); return w[w.length >> 1]; });
  const top = s => { const k = Math.max(0, Math.min(nbz - 1, Math.floor((s - q.s0) / q.bw))); if (zcal[k] != null) return zcal[k]; for (let d = 1; d < nbz; d++) { if (zcal[k - d] != null) return zcal[k - d]; if (zcal[k + d] != null) return zcal[k + d]; } return deckAt(s) + (D && D.calzadaSobreReferencia > .5 ? D.calzadaSobreReferencia : 0); }, canto = D && D.canto ? D.canto : null;
  const tt = []; for (let i = 0; i < O.n; i += 3) if (Math.abs(O.z[i] - deckAt(O.s[i])) < .4) tt.push(O.t[i]); tt.sort((a, b) => a - b);
  /* bordes del tablero: el ancho medido solo donde la calzada está elevada (calidadNube); el suelo al mismo nivel junto a los estribos no cuenta */
  const t0 = q.tb ? q.tb[0] : tt[Math.floor(tt.length * .03)], t1 = q.tb ? q.tb[1] : tt[Math.floor(tt.length * .97)], tm = (t0 + t1) / 2, B = t1 - t0;
  const sp = supports.slice().sort((a, b) => a.a - b.a), mid = p => (p.a + p.b) / 2, E = [], r2 = v => +v.toFixed(2);
  // picos de puntos a lo largo del eje (celdas de 0,5 m suavizadas) dentro de un filtro; separación mínima entre miembros
  const picos = (f, a, b, sep) => { const bw = .5, nb = Math.max(1, Math.ceil((b - a) / bw)), h = new Float32Array(nb);
    for (let i = 0; i < O.n; i++) { const s = O.s[i]; if (s < a || s >= b || !f(i)) continue; h[Math.floor((s - a) / bw)]++; }
    const g = h.map((_, k) => (h[k - 1] || 0) * .25 + h[k] * .5 + (h[k + 1] || 0) * .25), nz = [...g].filter(v => v > 0).sort((x, y) => x - y); if (nz.length < 3) return [];
    const thr = Math.max(3, 2 * nz[nz.length >> 1] * .5, .15 * nz[nz.length - 1]), P = [];
    for (let k = 0; k < nb; k++) if (g[k] >= thr && g[k] >= (g[k - 1] || 0) && g[k] > (g[k + 1] || 0)) { const s = a + (k + .5) * bw; if (P.length && s - P[P.length - 1].s < sep) { if (g[k] > P[P.length - 1].v) P[P.length - 1] = { s, v: g[k] }; } else P.push({ s, v: g[k] }); }
    return P.map(p => r2(p.s)); };
  // tablero por vano
  for (let k = 1; k < sp.length; k++) { const a = sp[k - 1].b, b = sp[k].a; if (b - a < 1) continue; const v = D && D.vanos.find(x => Math.abs(x.a - a) < .5);
    const sm = (a + b) / 2, perfil = []; for (let s = a; s <= b + 1e-6; s += Math.max(1, (b - a) / 20)) perfil.push([r2(s), r2(top(s))]);
    E.push({ tipo: 'tablero', id: 'T' + k, vano: k, a: r2(a), b: r2(b), luz: r2(b - a), ancho: r2(B), t0: r2(t0), t1: r2(t1), canto: v && v.canto != null ? v.canto : canto, cota: r2(top(sm)), perfil, fuente: v && v.canto != null ? 'canto medido en este vano' : canto ? 'canto medido (mediana del puente)' : 'canto no visible' }); }
  // pilares y estribos
  for (const p of sp) { if (p.tipo === 'pilar') { const d = D && D.pilares.find(x => Math.abs(x.s - mid(p)) < 1.5);
      E.push({ tipo: 'pilar', id: 'P' + (E.filter(e => e.tipo === 'pilar').length + 1), s: r2(mid(p)), espesor: d && d.espesor != null ? d.espesor : p.b - p.a > .1 ? r2(p.b - p.a) : null, ancho: d && d.ancho != null ? d.ancho : null, columnas: d && d.columnas || 1, anchoColumna: d && d.anchoColumna || null,
        zBase: r2(gr), zTop: r2(top(mid(p)) - (canto || .5)), inclinacion: d ? d.inclinacion : null, completo: d ? !!d.completo : false, fuente: d && d.espesor != null ? 'fuste medido' : 'caras del apoyo' }); }
    else E.push({ tipo: 'estribo', id: 'E' + (E.filter(e => e.tipo === 'estribo').length + 1), s: r2(mid(p)), espesor: r2(Math.max(1, p.b - p.a)), ancho: r2(B), zBase: r2(gr), zTop: r2(top(mid(p))) }); }
  // arcos bajo el tablero (vanos de arco) y sus montantes
  const ARC = opt.arcos || []; ARC.forEach((A, k) => { if (!A || !A.coef) return; const zA = s => polyval(A.coef, s), cr = (A.a + A.b) / 2; let zc = -Infinity, sc = cr; for (let s = A.a; s <= A.b; s += .5) if (zA(s) > zc) { zc = zA(s); sc = s; }
    const mont = picos(i => { const s = O.s[i], z = O.z[i], t = O.t[i]; if (t < t0 - 1 || t > t1 + 1) return false; const za = zA(s), zd = top(s) - (canto || .5) - .3; return zd - za > 1.5 && z > za + .8 && z < zd; }, A.a + 1, A.b - 1, 1.5);
    E.push({ tipo: 'arco', id: 'A' + (k + 1), a: r2(A.a), b: r2(A.b), luz: r2(A.b - A.a), flecha: r2(zc - Math.min(zA(A.a), zA(A.b))), coef: A.coef.map(c => +c.toPrecision(8)), zClave: r2(zc), ancho: r2(B), montantes: mont }); });
  /* vanos de arco sin tablero propio (el primer o último apoyo del arco no quedó entre los apoyos): se agrega el tablero sobre ese arco */
  for (const A of E.filter(e => e.tipo === 'arco')) if (!E.some(e => e.tipo === 'tablero' && Math.min(e.b, A.b) - Math.max(e.a, A.a) > .5 * A.luz)) { const perfil = []; for (let s = A.a; s <= A.b + 1e-6; s += Math.max(1, A.luz / 20)) perfil.push([r2(s), r2(top(s))]);
    E.push({ tipo: 'tablero', id: 'T' + A.id, vano: 'arco ' + A.id, a: A.a, b: A.b, luz: A.luz, ancho: r2(B), t0: r2(t0), t1: r2(t1), canto, cota: r2(top((A.a + A.b) / 2)), perfil, fuente: canto ? 'canto medido (mediana del puente)' : 'canto no visible' }); }
  // superestructura sobre la calzada
  for (const g of SS || []) {
    if (g.tipo === 'arco_superior' && g.luzArco) { const la = g.luzArco, c = (la.a + la.b) / 2, h = la.L / 2, zA = s => top(s) + la.flecha * (1 - ((s - c) / h) ** 2);
      const lados = [[t0 - 2, tm], [tm, t1 + 2]].map(([u0, u1]) => { let n = 0, st = 0; for (let i = 0; i < O.n; i++) { const s = O.s[i], t = O.t[i]; if (t < u0 || t > u1 || s < c - h / 2 || s > c + h / 2) continue; if (O.z[i] > top(s) + .6 * la.flecha) { n++; st += t; } } return n > 50 ? r2(st / n) : null; }).filter(v => v != null);
      const pend = picos(i => { const s = O.s[i], z = O.z[i], t = O.t[i], hz = zA(s) - top(s); if (t < t0 - 2 || t > t1 + 2 || hz < 5) return false; return z > top(s) + 2.5 && z < top(s) + .6 * hz; }, la.a + 2, la.b - 2, 2.5);
      E.push({ tipo: 'arco_superior', id: 'AS1', a: r2(la.a), b: r2(la.b), luz: r2(la.L), flecha: r2(la.flecha), nervios: lados.length || 1, tNervios: lados, pendolas: pend, apoyos: la.apoyos || null }); }
    if (g.tipo === 'atirantado') for (const m of g.pilonos) { const H = m.h, zt = top(m.s), tir = [];
      /* cortes horizontales a 25, 45 y 65 % de la altura del pilono; por lado se queda el corte con más cruces (los tirantes en abanico se separan mejor abajo) */
      for (const lado of [-1, 1]) { const a = lado < 0 ? m.s - 3 * H : m.s + 1.5, b = lado < 0 ? m.s - 1.5 : m.s + 3 * H; let mejor = { cr: [], f: .45 };
        for (const f of [.25, .45, .65]) { const zc = zt + f * H, cr = picos(i => Math.abs(O.z[i] - zc) < .6 && O.t[i] > t0 - 2 && O.t[i] < t1 + 2, a, b, 1.5); if (cr.length > mejor.cr.length) mejor = { cr, f }; }
        for (const sc of mejor.cr) tir.push({ lado: lado < 0 ? 'izquierdo' : 'derecho', cruce: sc, corte: mejor.f, anclaje: r2(m.s + (sc - m.s) / (1 - mejor.f)) }); }
      E.push({ tipo: 'pilono', id: 'PL' + (E.filter(e => e.tipo === 'pilono').length + 1), s: r2(m.s), altura: r2(H), zBase: r2(gr), zTop: r2(zt + H), tirantes: tir }); } }
  /* barandas: en cada metro se buscan los bordes de la calzada (puntos a ±0,25 m de su superficie) y, junto a cada borde, puntos 0,3–2,8 m más arriba.
     Hay baranda si aparece en ≥ 50 % de los metros con borde visto; altura = mediana por metro del percentil 95 (postes de luz o árboles aislados no la mueven) */
  const L0 = sp.length ? sp[0].a : q.extension[0], L1 = sp.length ? sp[sp.length - 1].b : q.extension[1], nm = Math.max(1, Math.ceil(L1 - L0)), cz = Array.from({ length: nm }, () => []);
  for (let i = 0; i < O.n; i++) { const s = O.s[i]; if (s < L0 || s >= L1) continue; if (Math.abs(O.z[i] - top(s)) < .25) cz[Math.floor(s - L0)].push(O.t[i]); }
  const bord = cz.map(v => { if (v.length < 10) return null; v.sort((a, b) => a - b); return [v[Math.floor(v.length * .02)], v[Math.floor(v.length * .98)]]; });
  const hb = [0, 1].map(() => Array.from({ length: nm }, () => []));
  for (let i = 0; i < O.n; i++) { const s = O.s[i]; if (s < L0 || s >= L1) continue; const k = Math.floor(s - L0), e = bord[k]; if (!e) continue; const h = O.z[i] - top(s); if (h < .3 || h > 2.8) continue; const t = O.t[i];
    if (t > e[0] - 1 && t < e[0] + 1.2) hb[0][k].push(h); else if (t < e[1] + 1 && t > e[1] - 1.2) hb[1][k].push(h); }
  const nVis = bord.filter(Boolean).length;
  ['izquierda', 'derecha'].forEach((lado, w) => { const ph = hb[w].filter(v => v.length >= 3).map(v => { v.sort((a, b) => a - b); return v[Math.floor(v.length * .95)]; }), cob = ph.length / Math.max(1, nVis);
    if (nVis >= 5 && cob >= .5) { ph.sort((a, b) => a - b); const tb = bord.filter(Boolean).map(e => e[w]).sort((a, b) => a - b); E.push({ tipo: 'baranda', id: 'B' + (w + 1), lado, t: r2(tb[tb.length >> 1]), a: r2(L0), b: r2(L1), altura: r2(ph[ph.length >> 1]), cobertura: r2(cob) }); } });
  return { elementos: E, marco: { t0: r2(t0), t1: r2(t1), ancho: r2(B) }, calzada: { s0: q.s0, bw: q.bw, z: zcal.map(v => v == null ? null : r2(v)) } };
}

/* ---------- Mapa de desviaciones: dónde la superficie medida se aparta de la forma ideal del elemento ----------
   Para cada superficie se arma un campo en una grilla (celda ≈ 2 veces la separación entre puntos): calzada z(s,t), intradós del arco z(s,t)
   (lo más bajo del nervio), caras de pilares s(t,z), borde superior y línea de cada baranda. A cada campo se le quita su forma ideal (polinomio
   de la calzada con bombeo y contraflecha, parábola de cada franja del arco, plano de la cara del pilar, recta de la baranda) y luego la mediana
   local de 2 m (lo que queda es lo local: abolladuras, hundimientos, desprendimientos, golpes). Umbral = máx(3,5 σ del ruido, 1,5 cm);
   las celdas fuera del umbral se agrupan y se informan las zonas de al menos 0,1 m² (o 4 celdas). No hay calificación: son zonas para revisar. */
function desviaciones(O, R, opt = {}) {
  if (!R || !R.elementos || !R.calzada) return null; const E = R.elementos, Z = R.calzada, m = R.marco, tm = (m.t0 + m.t1) / 2;
  const r4 = v => +(+v).toFixed(4), esp = opt.espaciado || .05, cel = Math.max(.1, Math.min(1, 2 * esp)), r2 = v => +(+v).toFixed(2), c1 = v => String(+(+v).toFixed(1)).replace('.', ',');
  const top = s => { const k = Math.max(0, Math.min(Z.z.length - 1, Math.floor((s - Z.s0) / Z.bw))); for (let d = 0; d < Z.z.length; d++) { if (Z.z[k - d] != null) return Z.z[k - d]; if (Z.z[k + d] != null) return Z.z[k + d]; } return 0; };
  const med = a => { if (!a.length) return null; const b = Float64Array.from(a).sort(); return b[b.length >> 1]; };
  // campo: grilla nu × nv con la mediana (o el mínimo) de los puntos de cada celda
  const grilla = (u0, u1, v0, v1) => { const nu = Math.max(1, Math.ceil((u1 - u0) / cel)), nv = Math.max(1, Math.ceil((v1 - v0) / cel)); return { u0, v0, nu, nv, b: Array.from({ length: nu * nv }, () => []) }; };
  const meter = (G, u, v, w) => { const i = Math.floor((u - G.u0) / cel), j = Math.floor((v - G.v0) / cel); if (i < 0 || j < 0 || i >= G.nu || j >= G.nv) return; G.b[i * G.nv + j].push(w); };
  const valor = (G, f) => Float64Array.from(G.b, a => a.length >= 2 ? f(a) : NaN);
  // mediana local en ventana (2 m) ignorando celdas vacías
  /* soloU: la ventana corre solo a lo largo del eje (calzada, intradós): cordones, veredas y bordes que siguen el eje no se toman por defecto */
  const mediana2D = (G, F, W, soloU, soloV) => { const h0 = Math.max(1, Math.round(W / 2 / cel)), h = soloV ? 0 : h0, hv = soloU ? 0 : h0, out = new Float64Array(F.length).fill(NaN);
    for (let i = 0; i < G.nu; i++) for (let j = 0; j < G.nv; j++) { if (isNaN(F[i * G.nv + j])) continue; const w = []; for (let a = Math.max(0, i - h); a <= Math.min(G.nu - 1, i + h); a += h > 6 && !soloU ? 2 : 1) for (let b = Math.max(0, j - hv); b <= Math.min(G.nv - 1, j + hv); b += hv > 6 ? 2 : 1) { const x = F[a * G.nv + b]; if (!isNaN(x)) w.push(x); } out[i * G.nv + j] = w.length >= 5 ? med(w) : NaN; } return out; };
  // ajuste por mínimos cuadrados robusto (3 vueltas descartando > 3 MAD) de un modelo lineal en parámetros
  const ajusta = (X, y) => { let use = y.map(() => true), b = null; for (let it = 0; it < 3; it++) { const k = X[0].length, A = Array.from({ length: k }, () => new Float64Array(k)), r = new Float64Array(k);
      X.forEach((x, n) => { if (!use[n]) return; for (let a = 0; a < k; a++) { r[a] += x[a] * y[n]; for (let c = 0; c < k; c++) A[a][c] += x[a] * x[c]; } });
      for (let a = 0; a < k; a++) A[a][a] += 1e-9; b = resolver(A, r); if (!b) return null; const e = X.map((x, n) => Math.abs(y[n] - x.reduce((s, v, a) => s + v * b[a], 0))), md = med(e.filter((_, n) => use[n])) || .01; use = e.map(v => v <= Math.max(.02, 4.5 * md)); } return b; };
  const resolver = (A, r) => { const n = r.length, M = A.map((row, i) => [...row, r[i]]); for (let i = 0; i < n; i++) { let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k; [M[i], M[p]] = [M[p], M[i]]; if (Math.abs(M[i][i]) < 1e-12) return null; for (let k = i + 1; k < n; k++) { const f = M[k][i] / M[i][i]; for (let c = i; c <= n; c++) M[k][c] -= f * M[i][c]; } }
    const x = new Float64Array(n); for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c]; x[i] = s / M[i][i]; } return x; };
  const zonas = [], ruidos = [], campos = []; let descartadas = 0;
  // analiza un campo: quita la forma ideal (base), la mediana local y agrupa lo que queda fuera del umbral
  const erosion = (G, F, soloU) => F.map((v, k) => { if (isNaN(v)) return NaN; const i = Math.floor(k / G.nv), j = k % G.nv; for (const [a, b] of soloU ? [[1, 0], [-1, 0]] : [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= G.nu || jj >= G.nv || isNaN(F[ii * G.nv + jj])) return NaN; } return v; });
  const analizar = (G, F0, base, info) => { const F = erosion(G, F0, info.angosto); /* sin el borde de cada zona medida: sombras de vehículos, peatones y bordes del levantamiento */ const r0 = F.map((v, k) => isNaN(v) ? NaN : v - base(k)), ref = mediana2D(G, r0, 2, info.soloU, info.soloV), d = r0.map((v, k) => isNaN(v) || isNaN(ref[k]) ? NaN : v - ref[k]);
    let ab = [...d].filter(v => !isNaN(v)).map(Math.abs); if (ab.length < 20) return null; let sig = 1.4826 * med(ab), thr = Math.max(3.5 * sig, .015);
    /* miembros angostos (nervios del arco): las filas del borde mezclan intradós y costado; una fila con > 25 % de celdas fuera del umbral no es confiable y se quita */
    if (info.angosto) { for (let j = 0; j < G.nv; j++) { let n = 0, o = 0; for (let i = 0; i < G.nu; i++) { const v = d[i * G.nv + j]; if (isNaN(v)) continue; n++; if (Math.abs(v) >= thr) o++; } if (n && o > .25 * n) for (let i = 0; i < G.nu; i++) d[i * G.nv + j] = NaN; }
      ab = [...d].filter(v => !isNaN(v)).map(Math.abs); if (ab.length < 20) return null; sig = 1.4826 * med(ab); thr = Math.max(3.5 * sig, .015); }
    ruidos.push(sig);
    const seen = new Uint8Array(d.length), area1 = cel * cel, minC = Math.max(4, Math.ceil(.1 / area1)), def = [];
    for (let k = 0; k < d.length; k++) { if (seen[k] || isNaN(d[k]) || Math.abs(d[k]) < thr) continue; const sg = Math.sign(d[k]), cola = [k], cs = []; seen[k] = 1;
      while (cola.length) { const u = cola.pop(); cs.push(u); const i = Math.floor(u / G.nv), j = u % G.nv; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= G.nu || jj >= G.nv) continue; const w = ii * G.nv + jj; if (!seen[w] && !isNaN(d[w]) && Math.abs(d[w]) >= thr && Math.sign(d[w]) === sg) { seen[w] = 1; cola.push(w); } } }
      if (cs.length < minC) continue; let mx = 0, u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity; for (const u of cs) { const i = Math.floor(u / G.nv), j = u % G.nv; if (Math.abs(d[u]) > Math.abs(mx)) mx = d[u]; u0 = Math.min(u0, G.u0 + i * cel); u1 = Math.max(u1, G.u0 + (i + 1) * cel); v0 = Math.min(v0, G.v0 + j * cel); v1 = Math.max(v1, G.v0 + (j + 1) * cel); }
      if (Math.abs(mx) > (info.maxDef || .3)) { descartadas++; continue; } /* más de 30 cm: otra pieza, borde o vehículo, no un defecto de superficie */
      def.push({ u0, u1, v0, v1, area: cs.length * area1, max: mx }); }
    // forma global: cuánto se aparta la mediana local de la forma ideal (deformación de conjunto, no local)
    const glob = [...ref].filter(v => !isNaN(v)).sort((a, b) => a - b), g95 = glob.length ? Math.max(Math.abs(glob[Math.floor(glob.length * .02)]), Math.abs(glob[Math.floor(glob.length * .98)])) : null;
    for (const z of def) zonas.push({ ...info.zona(z), elemento: info.id, parte: info.parte, area: r2(z.area), max: r4(z.max), umbral: r4(thr) });
    if (opt.campos) campos.push({ id: info.id, parte: info.parte, u0: G.u0, v0: G.v0, nu: G.nu, nv: G.nv, cel, umbral: thr, d: Float32Array.from(d) });
    return { id: info.id, parte: info.parte, ruido: r4(sig), umbral: r4(thr), celdas: ab.length, forma: g95 != null ? r2(g95) : null, zonas: def.length }; };
  const res = [];
  // 1) calzada de cada tablero: z(s,t) con la mediana de la celda; forma ideal = contraflecha (s, s²) + bombeo (t, t²) por vano
  for (const T of E.filter(e => e.tipo === 'tablero')) { const sa = T.a + .75, sb = T.b - .75; if (sb - sa < 2) continue; /* sin las juntas de los extremos del vano */ const G = grilla(sa, sb, m.t0 + .5, m.t1 - .5);
    for (let i = 0; i < O.n; i++) { const s = O.s[i]; if (s < sa || s >= sb) continue; const t = O.t[i]; if (t < m.t0 + .5 || t > m.t1 - .5) continue; const z = O.z[i] - top(s); if (z > -.15 && z < .25) meter(G, s, t, O.z[i]); } /* hasta 15 cm bajo la rasante: más abajo suele ser otra capa (cara inferior, losa bajo el pavimento) */
    /* cota de la celda = percentil 90 (la cara superior): si la losa es delgada, el escáner ve también su cara inferior en la misma celda */
    const F = valor(G, a => Float64Array.from(a).sort()[Math.floor(a.length * .9)]), X = [], y = [], sc = (T.a + T.b) / 2, L = Math.max(1, (T.b - T.a) / 2), W = Math.max(1, (m.t1 - m.t0) / 2);
    /* solo la calzada: se descartan las franjas longitudinales (veredas, cordones, bermas) cuya cota mediana se aparta más de 6 cm de la rasante */
    const fuera = new Set(), mos = []; for (let j = 0; j < G.nv; j++) { const o = []; for (let i = 0; i < G.nu; i++) { const v = F[i * G.nv + j]; if (!isNaN(v)) o.push(v - top(G.u0 + (i + .5) * cel)); } mos.push(o.length >= 5 ? med(o) : null); }
    /* la cota de cada franja se compara con el bombeo ajustado a todas las franjas (recta + parábola en t), no con el eje: la calzada puede caer 10–15 cm hacia los bordes */
    { const X = [], y = []; mos.forEach((v, j) => { if (v != null) { const t = (G.v0 + (j + .5) * cel - tm) / W; X.push([1, t, t * t]); y.push(v); } }); const bb = y.length >= 5 ? ajusta(X, y) : null;
      mos.forEach((v, j) => { const t = (G.v0 + (j + .5) * cel - tm) / W; if (v == null || !bb || Math.abs(v - (bb[0] + bb[1] * t + bb[2] * t * t)) > .06) fuera.add(j); }); }
    for (const j of [...fuera]) for (const jj of [j - 1, j, j + 1]) if (jj >= 0 && jj < G.nv) for (let i = 0; i < G.nu; i++) F[i * G.nv + jj] = NaN; /* y la franja vecina (borde del cordón) */
    for (let k = 0; k < F.length; k++) if (!isNaN(F[k])) { const s = (G.u0 + (Math.floor(k / G.nv) + .5) * cel - sc) / L, t = (G.v0 + (k % G.nv + .5) * cel - tm) / W; X.push([1, s, s * s, t, t * t]); y.push(F[k]); }
    if (y.length < 20) continue; const b = ajusta(X, y); if (!b) continue;
    const base = k => { const s = (G.u0 + (Math.floor(k / G.nv) + .5) * cel - sc) / L, t = (G.v0 + (k % G.nv + .5) * cel - tm) / W; return b[0] + b[1] * s + b[2] * s * s + b[3] * t + b[4] * t * t; };
    const r = analizar(G, F, base, { id: T.id, parte: 'calzada', soloU: true, zona: z => ({ a: r2(z.u0), b: r2(z.u1), t0: r2(z.v0), t1: r2(z.v1), texto: `${z.max < 0 ? 'hundimiento' : 'resalto u objeto sobre la calzada'} de ${c1(Math.abs(z.max) * 100)} cm en ${c1(z.area)} m² (de ${c1(z.u0)} a ${c1(z.u1)} m)` }) }); if (r) res.push(r); }
  // 2) intradós de cada arco: lo más bajo del nervio en z(s,t); forma ideal = curva suave (polinomio de grado 4, admite arcos no parabólicos) de cada franja transversal de 1 m
  for (const A of E.filter(e => e.tipo === 'arco' && e.coef)) { const za = s => A.coef[0] * s * s + A.coef[1] * s + A.coef[2], G = grilla(A.a, A.b, m.t0 - .5, m.t1 + .5);
    for (let i = 0; i < O.n; i++) { const s = O.s[i]; if (s < A.a || s >= A.b) continue; const dz = O.z[i] - za(s); if (dz < -.4 || dz > .5) continue; meter(G, s, O.t[i], O.z[i]); }
    const F = valor(G, a => Math.min(...a)), fr = new Map();
    for (let k = 0; k < F.length; k++) if (!isNaN(F[k])) { const j = Math.floor((k % G.nv) * cel), s = G.u0 + (Math.floor(k / G.nv) + .5) * cel; let v = fr.get(j); if (!v) fr.set(j, v = { X: [], y: [] }); const x = (s - (A.a + A.b) / 2) / Math.max(1, A.luz / 2); v.X.push([1, x, x * x, x ** 3, x ** 4]); v.y.push(F[k]); }
    const coefs = new Map(); for (const [j, v] of fr) if (v.y.length >= 15) { const b = ajusta(v.X, v.y); if (b) coefs.set(j, b); }
    const base = k => { const j = Math.floor((k % G.nv) * cel), b = coefs.get(j), x = (G.u0 + (Math.floor(k / G.nv) + .5) * cel - (A.a + A.b) / 2) / Math.max(1, A.luz / 2); return b ? b[0] + b[1] * x + b[2] * x * x + b[3] * x ** 3 + b[4] * x ** 4 : NaN; };
    const r = analizar(G, F, base, { id: A.id, parte: 'intradós', soloU: true, angosto: true, zona: z => ({ a: r2(z.u0), b: r2(z.u1), t0: r2(z.v0), t1: r2(z.v1), texto: `${z.max < 0 ? 'abultamiento hacia abajo' : 'pérdida o hueco hacia arriba'} de ${c1(Math.abs(z.max) * 100)} cm en ${c1(z.area)} m² del intradós (de ${c1(z.u0)} a ${c1(z.u1)} m)` }) }); if (r) res.push(r); }
  // 3) caras de los pilares: para cada cara (hacia − y + del eje), posición s(t,z) del punto más afuera de la celda; forma ideal = plano (admite inclinación)
  for (const P of E.filter(e => e.tipo === 'pilar' && e.espesor)) { /* caras: percentiles 2 y 98 de s de los puntos del fuste (el centro del apoyo puede venir corrido) */
    const ss = []; for (let i = 0; i < O.n; i++) { const s = O.s[i]; if (Math.abs(s - P.s) > P.espesor / 2 + 1 || O.z[i] < P.zBase + .5 || O.z[i] > P.zTop - .5) continue; ss.push(s); }
    if (ss.length < 50) continue; ss.sort((x, y) => x - y); const f0 = ss[Math.floor(ss.length * .02)], f1 = ss[Math.floor(ss.length * .98)], pc = (f0 + f1) / 2, h = (f1 - f0) / 2;
    for (const lado of [-1, 1]) { const G = grilla(m.t0 - 1, m.t1 + 1, P.zBase + .3, P.zTop - .5); /* sin la unión con el tablero */
      for (let i = 0; i < O.n; i++) { const ds = (O.s[i] - pc) * lado; if (ds < h - .4 || ds > h + .4) continue; meter(G, O.t[i], O.z[i], ds); }
      const F = valor(G, a => Math.max(...a)), X = [], y = []; for (let k = 0; k < F.length; k++) if (!isNaN(F[k])) { X.push([1, G.u0 + (Math.floor(k / G.nv) + .5) * cel, G.v0 + (k % G.nv + .5) * cel]); y.push(F[k]); }
      if (y.length < 20) continue; const b = ajusta(X, y); if (!b) continue; const base = k => b[0] + b[1] * (G.u0 + (Math.floor(k / G.nv) + .5) * cel) + b[2] * (G.v0 + (k % G.nv + .5) * cel);
      const r = analizar(G, F, base, { id: P.id, parte: 'cara ' + (lado < 0 ? 'hacia el inicio' : 'hacia el final'), soloV: true, zona: z => ({ a: r2(pc + lado * h), b: r2(pc + lado * h), t0: r2(z.u0), t1: r2(z.u1), z0: r2(z.v0), z1: r2(z.v1), texto: `${z.max < 0 ? 'desprendimiento o pérdida de sección' : 'protuberancia o material adherido'} de ${c1(Math.abs(z.max) * 100)} cm en ${c1(z.area)} m² (cota ${c1(z.v0)} a ${c1(z.v1)} m)` }) }); if (r) res.push(r); } }
  // 4) barandas: altura sobre la calzada y posición transversal metro a metro; forma ideal = constante (altura) y recta (línea)
  for (const B of E.filter(e => e.tipo === 'baranda')) { const w = B.lado === 'izquierda' ? -1 : 1, n = Math.max(1, Math.ceil(B.b - B.a)), H = Array.from({ length: n }, () => []), T = Array.from({ length: n }, () => []);
    for (let i = 0; i < O.n; i++) { const s = O.s[i]; if (s < B.a || s >= B.b) continue; const dt = (O.t[i] - B.t) * w; if (dt < -1 || dt > 1) continue; const hz = O.z[i] - top(s); if (hz < .3 || hz > 2.8) continue; const k = Math.floor(s - B.a); H[k].push(hz); T[k].push(O.t[i]); }
    const alt = H.map(a => a.length >= 3 ? Float64Array.from(a).sort()[Math.floor(a.length * .95)] : NaN), lin = T.map(a => a.length >= 3 ? med(a) : NaN);
    for (const [F, parte, txt] of [[alt, 'altura', d => d < 0 ? 'tramo más bajo o faltante' : 'tramo más alto (objeto o poste)'], [lin, 'alineación', d => (d * w > 0 ? 'desplazada hacia afuera' : 'desplazada hacia adentro')]]) {
      const ok = [...F].filter(v => !isNaN(v)); if (ok.length < 10) continue; const X = [], y = []; F.forEach((v, k) => { if (!isNaN(v)) { X.push([1, k]); y.push(v); } }); const b = parte === 'altura' ? [med(ok), 0] : ajusta(X, y); if (!b) continue;
      const dv = F.map((v, k) => isNaN(v) ? NaN : v - (b[0] + b[1] * k)), ab = dv.filter(v => !isNaN(v)).map(Math.abs), sig = 1.4826 * med(ab), thr = Math.max(4 * sig, parte === 'altura' ? .15 : .1); ruidos.push(sig); if (sig > .1) { res.push({ id: B.id, parte: 'baranda ' + parte, ruido: r4(sig), umbral: r4(thr), celdas: ok.length, forma: null, zonas: 0, nota: 'medida muy dispersa: no se analiza' }); continue; }
      let k = 0, nz = 0; while (k < n) { if (isNaN(dv[k]) || Math.abs(dv[k]) < thr) { k++; continue; } const sg = Math.sign(dv[k]); let e = k, mx = dv[k]; while (e + 1 < n && !isNaN(dv[e + 1]) && Math.abs(dv[e + 1]) >= thr && Math.sign(dv[e + 1]) === sg) { e++; if (Math.abs(dv[e]) > Math.abs(mx)) mx = dv[e]; }
        if (Math.abs(mx) > .5) { descartadas++; k = e + 1; continue; } /* postes de luz, carteles u otros objetos junto a la baranda */
        if (e - k + 1 >= 2) { nz++; zonas.push({ elemento: B.id, parte: 'baranda ' + parte, a: r2(B.a + k), b: r2(B.a + e + 1), max: r4(mx), umbral: r4(thr), area: null, texto: `baranda ${B.lado}: ${txt(mx)} ${c1(Math.abs(mx) * 100)} cm entre ${c1(B.a + k)} y ${c1(B.a + e + 1)} m` }); } k = e + 1; }
      res.push({ id: B.id, parte: 'baranda ' + parte, ruido: r4(sig), umbral: r4(thr), celdas: ok.length, forma: null, zonas: nz }); } }
  /* rasgos de diseño, no defectos: (a) lo que aparece a la misma altura y con el mismo signo en las dos caras de un pilar (cornisas, zócalos, molduras);
     (b) cambios de la baranda a menos de 1,5 m de un apoyo (pilastras y remates de la baranda sobre pilares y estribos) */
  const apoyosS = E.filter(e => e.tipo === 'pilar' || e.tipo === 'estribo').map(e => e.s), quitar = new Set();
  zonas.forEach((z, i) => { if (z.parte.startsWith('cara') && z.z0 != null) { const o = zonas.find((w, j) => j !== i && w.elemento === z.elemento && w.parte.startsWith('cara') && w.parte !== z.parte && Math.sign(w.max) === Math.sign(z.max) && Math.min(w.z1, z.z1) - Math.max(w.z0, z.z0) > .5 * Math.min(w.z1 - w.z0, z.z1 - z.z0)); if (o) quitar.add(i); }
    if (z.parte.startsWith('baranda') && apoyosS.some(sa => sa > z.a - 1.5 && sa < z.b + 1.5)) quitar.add(i); });
  for (const i of [...quitar].sort((a, b) => b - a)) { zonas.splice(i, 1); descartadas++; }
  zonas.sort((x, y) => Math.abs(y.max) * (y.area || 1) - Math.abs(x.max) * (x.area || 1));
  for (const x of res) if (!x.nota) x.zonas = zonas.filter(z => z.elemento === x.id && z.parte === x.parte).length; /* después de quitar los rasgos de diseño */
  return { celda: r2(cel), superficies: res, zonas, descartadas, campos: opt.campos ? campos : undefined, ruidoMediano: ruidos.length ? r2(med(ruidos)) : null };
}
/* ---------- Evidencia de la nube por elemento (para la inspección de campo MTC) ----------
   No califica: junta para cada elemento lo que la nube dice de él (cuánto se vio, medidas incompletas, zonas anómalas por intensidad o color,
   cambios entre fechas, huecos de la nube). La calificación (escala 0–5 de la Directiva N° 01-2006-MTC/14) la pone el inspector en
   «Inspección de campo (MTC)», donde esta evidencia aparece junto a cada elemento del expediente. */
const MTC = { escala: [[0, 'Muy bueno'], [1, 'Bueno'], [2, 'Regular'], [3, 'Malo'], [4, 'Muy malo'], [5, 'Pésimo']] };
function fichaInspeccion(O, R, ex = {}) {
  if (!R || !R.elementos) return null; const Z = R.calzada, m = R.marco, tm = (m.t0 + m.t1) / 2, r1 = v => +(+v).toFixed(1), c1 = v => String(+(+v).toFixed(1)).replace('.', ',');
  const top = s => { if (!Z) return 0; const k = Math.max(0, Math.min(Z.z.length - 1, Math.floor((s - Z.s0) / Z.bw))); for (let d = 0; d < Z.z.length; d++) { if (Z.z[k - d] != null) return Z.z[k - d]; if (Z.z[k + d] != null) return Z.z[k + d]; } return 0; };
  const rng = (a, b, f) => { let lo = Infinity, hi = -Infinity; for (let s = a; s <= b + 1e-6; s += Math.max(.5, (b - a) / 30)) { const v = f(s); lo = Math.min(lo, v); hi = Math.max(hi, v); } return [lo, hi]; };
  const NOM = { tablero: 'Tablero', pilar: 'Pilar', estribo: 'Estribo', arco: 'Arco', arco_superior: 'Arco superior', pilono: 'Pilono', tirantes: 'Tirantes', baranda: 'Baranda' };
  const items = [];
  for (const e of R.elementos) { const it = { id: e.id, tipo: e.tipo, nombre: NOM[e.tipo] + ' ' + e.id + (e.lado ? ' (' + e.lado + ')' : ''), cajas: [], evid: [], medidas: e };
    if (e.tipo === 'tablero') { const [lo, hi] = rng(e.a, e.b, top), c = e.canto || 1.5; it.cajas.push({ parte: 'calzada', s0: e.a, s1: e.b, t0: m.t0 - .5, t1: m.t1 + .5, z0: lo - .3, z1: hi + .3 }, { parte: 'cara inferior', s0: e.a, s1: e.b, t0: m.t0 - .5, t1: m.t1 + .5, z0: lo - c - .5, z1: hi - .3 }); }
    else if (e.tipo === 'baranda') { const [lo, hi] = rng(e.a, e.b, top), w = e.t < tm ? [e.t - 1.2, e.t + 1] : [e.t - 1, e.t + 1.2]; it.cajas.push({ parte: 'baranda', s0: e.a, s1: e.b, t0: w[0], t1: w[1], z0: lo + .3, z1: hi + e.altura + .3 }); }
    else if (e.tipo === 'pilar') { const h = (e.espesor || 1) / 2 + .5; it.cajas.push({ parte: 'fuste', eje: 'z', s0: e.s - h, s1: e.s + h, t0: m.t0 - 1, t1: m.t1 + 1, z0: e.zBase + .3, z1: e.zTop }); }
    else if (e.tipo === 'estribo') it.cajas.push({ parte: 'cara', eje: 'z', s0: e.s - 2, s1: e.s + 2, t0: m.t0 - 1, t1: m.t1 + 1, z0: e.zBase + .3, z1: e.zTop - .3 });
    else if (e.tipo === 'arco') { const za = s => e.coef[0] * s * s + e.coef[1] * s + e.coef[2], [lo] = rng(e.a, e.b, za), [, hi] = rng(e.a, e.b, s => top(s) - .5); it.cajas.push({ parte: 'arco y montantes', s0: e.a, s1: e.b, t0: m.t0 - .5, t1: m.t1 + .5, z0: lo - .5, z1: hi }); }
    else if (e.tipo === 'arco_superior') { const [lo, hi] = rng(e.a, e.b, top); it.cajas.push({ parte: 'nervios y péndolas', s0: e.a, s1: e.b, t0: m.t0 - 2, t1: m.t1 + 2, z0: lo + 1, z1: hi + e.flecha + 3 }); }
    else if (e.tipo === 'pilono') { it.cajas.push({ parte: 'fuste', eje: 'z', s0: e.s - 4, s1: e.s + 4, t0: m.t0 - 3, t1: m.t1 + 3, z0: e.zBase + .3, z1: e.zTop + 2 });
      if (e.tirantes.length) { const an = e.tirantes.map(c => c.anclaje).concat([e.s]), zt = top(e.s); items.push({ id: e.id + 'T', tipo: 'tirantes', nombre: 'Tirantes de ' + e.id + ' (' + e.tirantes.length + ' contados)', cajas: [{ parte: 'tirantes', s0: Math.min(...an), s1: Math.max(...an), t0: m.t0 - 2, t1: m.t1 + 2, z0: zt + 2, z1: e.zTop }], evid: [], medidas: { tirantes: e.tirantes } }); } }
    items.push(it); }
  // cobertura: metros del elemento (a lo largo del eje; en altura para pilares, estribos y pilonos) con ≥ 5 puntos dentro de su caja, por parte
  const cnt = items.map(it => it.cajas.map(c => new Uint16Array(Math.max(1, Math.ceil(c.eje === 'z' ? c.z1 - c.z0 : c.s1 - c.s0)))));
  for (let i = 0; i < O.n; i++) { const s = O.s[i], t = O.t[i], z = O.z[i];
    for (let k = 0; k < items.length; k++) { const cs = items[k].cajas; for (let j = 0; j < cs.length; j++) { const c = cs[j]; if (s < c.s0 || s >= c.s1 || t < c.t0 || t > c.t1 || z < c.z0 || z > c.z1) continue; const v = cnt[k][j], b = Math.min(v.length - 1, Math.floor(c.eje === 'z' ? z - c.z0 : s - c.s0)); if (v[b] < 65535) v[b]++; } } }
  items.forEach((it, k) => { it.cobertura = it.cajas.map((c, j) => ({ parte: c.parte, f: +(cnt[k][j].filter(v => v >= 5).length / cnt[k][j].length).toFixed(2) }));
    for (const c of it.cobertura) if (c.f < .6) it.evid.push({ fuente: 'cobertura', nivel: c.f < .3 ? 'alto' : 'medio', texto: `${c.parte}: la nube cubre solo ${Math.round(c.f * 100)} % ${it.cajas.find(x => x.parte === c.parte).eje === 'z' ? 'de la altura' : 'del largo'}; el resto debe inspeccionarse en campo` }); });
  // asignación por volumen compartido con las cajas
  const caja = (s0, s1, t0, t1, z0, z1, tipos) => { let best = null, bv = 0; for (const it of items) { if (tipos && !tipos.includes(it.tipo)) continue; for (const c of it.cajas) { const v = Math.max(0, Math.min(s1, c.s1) - Math.max(s0, c.s0) + .01) * Math.max(0, Math.min(t1, c.t1) - Math.max(t0, c.t0) + .01) * Math.max(0, Math.min(z1, c.z1) - Math.max(z0, c.z0) + .01);
    if (Math.min(s1, c.s1) < Math.max(s0, c.s0) - .5 || Math.min(z1, c.z1) < Math.max(z0, c.z0) - .5) continue; if (v > bv) { bv = v; best = { it, parte: c.parte }; } } } return best; };
  const sinElemento = [];
  // medidas que el inspector debe revisar
  for (const it of items) { const e = it.medidas;
    if (it.tipo === 'pilar' && e.completo === false && e.espesor != null) it.evid.push({ fuente: 'medición', nivel: 'medio', texto: 'fuste visto en parte (ancho medido < 1/4 del tablero): sus medidas no son completas' });
    if (it.tipo === 'pilar' && e.inclinacion != null) it.evid.push({ fuente: 'medición', nivel: 'info', texto: `inclinación medida del fuste ${e.inclinacion} mm/m (con ruido de la nube; compárela con la de otra campaña)` });
    if (it.tipo === 'tablero' && e.canto == null) it.evid.push({ fuente: 'medición', nivel: 'medio', texto: 'canto no medido: no se separa una cara inferior del tablero en la nube' }); }
  // huecos de la nube sobre el tablero
  for (const h of (ex.calidad && ex.calidad.huecos) || []) { const b = caja(h.a, h.b, m.t0, m.t1, -1e9, 1e9, ['tablero']); if (b) b.it.evid.push({ fuente: 'cobertura', nivel: 'alto', a: h.a, b: h.b, texto: `hueco sin puntos en la calzada de ${c1(h.a)} a ${c1(h.b)} m` }); }
  // zonas anómalas por intensidad o color
  const ZT = { calzada: [['tablero'], 'calzada'], 'cara inferior y vigas': [['arco', 'tablero'], null], pilares: [['pilar'], null], 'estructura sobre la calzada': [['arco_superior', 'pilono', 'tirantes', 'baranda'], null] };
  for (const an of (ex.atributos && ex.atributos.anomalias) || []) { const zt = ZT[an.zona]; let b = null; if (zt) { const cand = items.filter(it => zt[0].includes(it.tipo) && it.cajas.some(c => Math.min(an.b, c.s1) > Math.max(an.a, c.s0) - .5)); b = cand.length ? { it: cand.sort((x, y) => zt[0].indexOf(x.tipo) - zt[0].indexOf(y.tipo))[0] } : null; }
    const txt = `${an.zona} ${c1(an.a)} a ${c1(an.b)} m: ${an.atributo} ${an.signo} que su entorno (${c1(an.desvios)} desviaciones${an.cambio != null ? ', ' + (an.cambio > 0 ? '+' : '') + an.cambio + ' %' : ''}); puede ser material, humedad, suciedad, óxido, una reparación o la geometría del escaneo`;
    (b ? b.it.evid : sinElemento).push({ fuente: 'atributos', nivel: 'medio', a: an.a, b: an.b, texto: txt }); }
  // desviaciones de la forma ideal (cada zona ya trae su elemento)
  for (const z of (ex.desviaciones && ex.desviaciones.zonas) || []) { const it = items.find(x => x.id === z.elemento); if (!it) continue; it.evid.push({ fuente: 'forma', nivel: Math.abs(z.max) >= .05 && z.max < 0 ? 'alto' : 'medio', a: z.a, b: z.b, texto: z.texto }); }
  // cambios entre fechas
  const C = ex.comparacion; if (C) { const add = (g, tipo) => { const b = caja(g.a, g.b, g.tmin != null ? g.tmin : m.t0, g.tmax != null ? g.tmax : m.t1, g.zmin, g.zmax);
      const txt = tipo === 'cambio' ? `cambio de ${g.d > 0 ? '+' : ''}${Math.round(g.d * 100)} cm entre fechas (${c1(g.a)} a ${c1(g.b)} m, ${c1(g.area)} m²)` : tipo === 'nuevo' ? `aparece algo nuevo entre fechas (${c1(g.a)} a ${c1(g.b)} m, ${c1(g.area)} m², cota ${c1(g.zmin)} a ${c1(g.zmax)} m)` : `ya no está en la segunda fecha (${c1(g.a)} a ${c1(g.b)} m, ${c1(g.area)} m²)`;
      (b ? b.it.evid : sinElemento).push({ fuente: 'comparación', nivel: tipo === 'cambio' && Math.abs(g.d) >= .05 ? 'alto' : 'medio', a: g.a, b: g.b, texto: (b ? b.parte + ': ' : '') + txt }); };
    (C.cambios || []).forEach(g => add(g, 'cambio')); (C.nuevo || []).forEach(g => add(g, 'nuevo')); (C.quitado || []).forEach(g => add(g, 'quitado'));
    if (C.perfil && C.perfil.length) for (const it of items.filter(x => x.tipo === 'tablero')) { const p = C.perfil.filter(q => q[0] >= it.medidas.a && q[0] <= it.medidas.b && q[1] != null); if (p.length >= 3) { const dm = p.reduce((a, q) => a + q[1], 0) / p.length; it.evid.push({ fuente: 'comparación', nivel: Math.abs(dm) >= .05 ? 'alto' : 'info', texto: `calzada: cambio medio de cota ${dm > 0 ? '+' : ''}${c1(dm * 100)} cm entre fechas en este vano` }); } } }
  for (const it of items) delete it.cajas;
  return { elementos: items, sinElemento };
}
/* (s,t,z) del marco del puente -> coordenadas absolutas del archivo original (deshace sesgo, giro, intercambio de ejes y escala) */
function alMundo(O, s, t, z, curvo) { const tr = O.tr, sk = O.skew; if (sk && sk.phi) s = s + (t - sk.tm) * Math.tan(sk.phi * Math.PI / 180); const W = [0, 0, 0];
  if (!tr || curvo) return [s, t, z]; const S = s / tr.scale, T = t / tr.scale;
  if (tr.snap === 0) { W[tr.ih[0]] = S; W[tr.ih[1]] = T; } else if (tr.snap === 1) { W[tr.ih[1]] = S; W[tr.ih[0]] = T; }
  else { const s2 = (s + tr.smin) / tr.scale, da = s2 * tr.u[0] - T * tr.u[1], db = s2 * tr.u[1] + T * tr.u[0]; W[tr.ih[0]] = da + tr.mx + tr.offset[tr.ih[0]]; W[tr.ih[1]] = db + tr.my + tr.offset[tr.ih[1]]; }
  W[tr.iu] = z / tr.scale; return W; }
/* ---------- Modelo IFC (IFC4X3) de los elementos identificados ----------
   Escribe un archivo STEP con IfcProject > IfcSite > IfcBridge y un objeto por elemento (tablero, pilares, estribos, arcos, péndolas,
   montantes, pilono, tirantes, barandas). Cada uno lleva el conjunto de propiedades «Pset_PuenteGemelo_Medido» con lo que salió de la nube
   y, cuando una sección no se pudo medir, lo dice. Las coordenadas vuelven al sistema del archivo original (deshaciendo giro, sesgo y escala);
   el modelo queda alrededor de un origen redondeado y IfcMapConversion guarda ese origen. */
function exportarIFC(R, O, opt = {}) {
  if (!R || !R.elementos) return null; const tr = O.tr, sk = O.skew, curvo = !!opt.curvo || !!O.curvo;
  const mundo = (s, t, z) => alMundo(O, s, t, z, curvo);
  const E = R.elementos, m = R.marco, tm = (m.t0 + m.t1) / 2, sc = mundo(E.length ? (Math.min(...E.map(e => e.a != null ? e.a : e.s)) + Math.max(...E.map(e => e.b != null ? e.b : e.s))) / 2 : 0, tm, 0);
  const org = sc.map((v, k) => k === (tr ? tr.iu : 2) ? 0 : Math.round(v / 10) * 10);
  const P = (s, t, z) => { const w = mundo(s, t, z); return [w[0] - org[0], w[1] - org[1], w[2] - org[2]]; };
  const dir = (p, q) => { const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], L = Math.hypot(...d) || 1; return d.map(v => v / L); };
  const L = [], id = () => L.length + 1, add = x => { L.push(x); return '#' + L.length; }, f = v => { const x = (+v).toFixed(4).replace(/0+$/, ''); return x.endsWith('.') ? x : x.includes('.') ? x : x + '.'; };
  const str = v => "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/[^\x20-\x7e]/g, c => '\\X2\\' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0') + '\\X0\\') + "'";
  const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  const guid = () => { const b = new Uint8Array(16); for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    let n = 0n; for (const x of b) n = (n << 8n) | BigInt(x); let s = ''; for (let i = 0; i < 22; i++) { s = B64[Number(n & 63n)] + s; n >>= 6n; } return "'" + s + "'"; };
  const pt = p => add(`IFCCARTESIANPOINT((${p.map(f).join(',')}))`), dr = d => add(`IFCDIRECTION((${d.map(f).join(',')}))`);
  const ax = (o, z, x) => add(`IFCAXIS2PLACEMENT3D(${pt(o)},${z ? dr(z) : '$'},${x ? dr(x) : '$'})`);
  const perp = (z, h) => { const d = h[0] * z[0] + h[1] * z[1] + h[2] * z[2], x = [h[0] - d * z[0], h[1] - d * z[1], h[2] - d * z[2]], n = Math.hypot(...x); return n > 1e-6 ? x.map(v => v / n) : (Math.abs(z[2]) < .9 ? [0, 0, 1] : [1, 0, 0]); };
  // dirección "a lo ancho" del puente en el mundo
  const eT = dir(P(0, 0, 0), P(0, 1, 0)), eZ = dir(P(0, 0, 0), P(0, 0, 1));
  // header + contexto
  const H = [];
  add(`IFCPERSON($,${str(opt.autor || 'PuenteGemelo')},$,$,$,$,$,$)`);
  const uL = add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)"), uA = add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)"), uV = add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)"), uR = add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)");
  const ua = add(`IFCUNITASSIGNMENT((${uL},${uA},${uV},${uR}))`);
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${ax([0, 0, 0], null, null)},$)`);
  const body = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const proj = add(`IFCPROJECT(${guid()},$,${str(opt.proyecto || 'Gemelo digital del puente')},${str('Elementos identificados en la nube de puntos por PuenteGemelo ' + (opt.version || ''))},$,$,$,(${ctx}),${ua})`);
  if (opt.georef !== false && !curvo && tr) { const crs = add(`IFCPROJECTEDCRS(${str(opt.crs || 'CRS del archivo de nube (no declarado)')},$,$,$,$,$,$)`);
    add(`IFCMAPCONVERSION(${ctx},${crs},${f(org[0])},${f(org[1])},${f(org[2])},$,$,$,$,$)`); }
  const site = add(`IFCSITE(${guid()},$,'Sitio',$,$,${add(`IFCLOCALPLACEMENT($,${ax([0, 0, 0], null, null)})`)},$,$,.ELEMENT.,$,$,$,$,$)`);
  const brP = add(`IFCLOCALPLACEMENT($,${ax([0, 0, 0], null, null)})`);
  const bridge = add(`IFCBRIDGE(${guid()},$,${str(opt.nombre || 'Puente')},${str(opt.tipo ? 'Tipología sugerida: ' + opt.tipo : '')},$,${brP},$,$,.ELEMENT.,.${opt.tipoIFC || 'NOTDEFINED'}.)`);
  add(`IFCRELAGGREGATES(${guid()},$,$,$,${proj},(${site}))`); add(`IFCRELAGGREGATES(${guid()},$,$,$,${site},(${bridge}))`);
  // sólidos
  const caja = (o, ez, ex, dx, dy, h) => add(`IFCEXTRUDEDAREASOLID(${add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,$,${f(Math.max(dx, .01))},${f(Math.max(dy, .01))})`)},${ax(o, ez, perp(ez, ex))},${dr([0, 0, 1])},${f(Math.max(h, .01))})`);
  const tubo = (pts, r) => add(`IFCSWEPTDISKSOLID(${add(`IFCPOLYLINE((${pts.map(pt).join(',')}))`)},${f(r)},$,$,$)`);
  const prods = [];
  const objeto = (cls, nombre, tipo, solidos, props, rtype) => { const rep = add(`IFCSHAPEREPRESENTATION(${body},'Body',${str(rtype || 'SweptSolid')},(${solidos.join(',')}))`);
    const pr = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`), pl = add(`IFCLOCALPLACEMENT(${brP},${ax([0, 0, 0], null, null)})`);
    const [pt_, ot] = tipo.includes(':') ? ['USERDEFINED', tipo.split(':')[1]] : [tipo, null];
    const o = add(`${cls}(${guid()},$,${str(nombre)},$,${ot ? str(ot) : '$'},${pl},${pr},$,${cls === 'IFCELEMENTASSEMBLY' ? '$,' : ''}.${pt_}.)`); prods.push(o);
    const vals = Object.entries(props).filter(([, v]) => v != null && v !== '').map(([k, v]) => add(`IFCPROPERTYSINGLEVALUE(${str(k)},$,${typeof v === 'number' ? (Number.isInteger(v) && !/m$|altura|ancho|espesor|canto|luz|flecha|cota|cobertura/i.test(k) ? `IFCINTEGER(${v})` : `IFCREAL(${f(v)})`) : typeof v === 'boolean' ? `IFCBOOLEAN(.${v ? 'T' : 'F'}.)` : `IFCTEXT(${str(v)})`},$)`));
    if (vals.length) { const ps = add(`IFCPROPERTYSET(${guid()},$,'Pset_PuenteGemelo_Medido',$,(${vals.join(',')}))`); add(`IFCRELDEFINESBYPROPERTIES(${guid()},$,$,$,(${o}),${ps})`); }
    const ins = opt.inspeccion, c = ins && ins.calif[cur]; if (c && !hecho.has(cur) && (c.condicion != null || c.obs || (c.danos && c.danos.length))) { hecho.add(cur); inspPset(o, c); }
    return o; };
  /* calificación del inspector (escala de la Directiva N° 01-2006-MTC/14) */
  const inspPset = (o, c) => { const ins = opt.inspeccion, v = [];
    const P2 = (k, x) => v.push(add(`IFCPROPERTYSINGLEVALUE(${str(k)},$,${x},$)`));
    if (c.condicion != null) { P2('CondicionMTC', `IFCINTEGER(${c.condicion})`); P2('CondicionTexto', `IFCTEXT(${str(MTC.escala[c.condicion][1])})`); }
    if (c.material) P2('Material', `IFCLABEL(${str(c.material)})`); if (c.danos && c.danos.length) P2('Defectos', `IFCTEXT(${str(c.danos.join('; '))})`); if (c.obs) P2('Observaciones', `IFCTEXT(${str(c.obs)})`);
    if (ins.meta) { if (ins.meta.fecha) P2('FechaInspeccion', `IFCLABEL(${str(ins.meta.fecha)})`); if (ins.meta.inspector) P2('Inspector', `IFCLABEL(${str(ins.meta.inspector)})`); if (ins.meta.tipo) P2('TipoInspeccion', `IFCLABEL(${str(ins.meta.tipo)})`); }
    P2('Norma', `IFCTEXT('Directiva N 01-2006-MTC/14, Guia para inspeccion de puentes')`);
    const ps = add(`IFCPROPERTYSET(${guid()},$,'Pset_PuenteGemelo_InspeccionMTC',$,(${v.join(',')}))`); add(`IFCRELDEFINESBYPROPERTIES(${guid()},$,$,$,(${o}),${ps})`); };
  let cur = null; const hecho = new Set();
  if (opt.inspeccion && opt.inspeccion.global != null) inspPset(bridge, { condicion: opt.inspeccion.global });
  const tops = {}; for (const e of E) if (e.tipo === 'tablero') tops[e.id] = e;
  const zTopAt = s => { const T = E.find(e => e.tipo === 'tablero' && s >= e.a - .5 && s <= e.b + .5) || E.find(e => e.tipo === 'tablero'); if (!T) return 0; let best = T.perfil[0]; for (const p of T.perfil) if (Math.abs(p[0] - s) < Math.abs(best[0] - s)) best = p; return best[1]; };
  const nota = 'sección no medida en la nube: radio simbólico';
  for (const e of E) { cur = e.id;
    if (e.tipo === 'tablero') { const c = e.canto || .5, sols = [];
      for (let k = 1; k < e.perfil.length; k++) { const [s0, z0] = e.perfil[k - 1], [s1, z1] = e.perfil[k], p0 = P(s0, tm, z0 - c / 2), p1 = P(s1, tm, z1 - c / 2), d = dir(p0, p1), Lg = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]); sols.push(caja(p0, d, eT, e.ancho, c, Lg)); }
      objeto('IFCSLAB', 'Tablero vano ' + e.vano, 'USERDEFINED:Tablero', sols, { Luz: e.luz, Ancho: e.ancho, Canto: e.canto, CantoFuente: e.fuente, CotaCalzada: e.cota, InicioEje_m: e.a, FinEje_m: e.b, Nota: e.canto ? null : 'canto no visible: se dibuja con 0,5 m' }); }
    else if (e.tipo === 'pilar') { const h = e.zTop - e.zBase, n = e.columnas || 1, an = e.ancho || e.espesor || 1, wc = n > 1 && e.anchoColumna ? e.anchoColumna : an / n, sols = [];
      for (let k = 0; k < n; k++) { const t = n > 1 ? tm - an / 2 + wc / 2 + k * (an - wc) / (n - 1) : tm; sols.push(caja(P(e.s, t, e.zBase), eZ, eT, wc, Math.max(e.espesor || .5, .1), h)); }
      objeto('IFCCOLUMN', 'Pilar ' + e.id, 'PIERSTEM', sols, { Espesor: e.espesor, Ancho: e.ancho, Columnas: n, AnchoColumna: e.anchoColumna, Altura: +h.toFixed(2), Inclinacion_grados: e.inclinacion, VistoCompleto: e.completo, PosicionEje_m: e.s, Fuente: e.fuente, Nota: e.ancho ? null : 'ancho no medido: se dibuja igual al espesor' }); }
    else if (e.tipo === 'estribo') objeto('IFCELEMENTASSEMBLY', 'Estribo ' + e.id, 'ABUTMENT', [caja(P(e.s, tm, e.zBase), eZ, eT, e.ancho, e.espesor, e.zTop - e.zBase)], { PosicionEje_m: e.s, Ancho: e.ancho, Altura: +(e.zTop - e.zBase).toFixed(2), Nota: 'espesor y fondo del estribo no se miden: caja de referencia de 1 m' }, 'SweptSolid');
    else if (e.tipo === 'arco') { const zA = s => polyval(e.coef, s), pts = []; for (let k = 0; k <= 24; k++) { const s = e.a + (e.b - e.a) * k / 24; pts.push(P(s, tm, zA(s))); }
      objeto('IFCMEMBER', 'Arco ' + e.id, 'ARCH_SEGMENT', [tubo(pts, .3)], { Luz: e.luz, Flecha: e.flecha, CotaClave: e.zClave, Ancho: e.ancho, Montantes: e.montantes.length, Nota: 'intradós ajustado a la nube; ' + nota }, 'AdvancedSweptSolid');
      for (const s of e.montantes) { const z0 = zA(s), z1 = zTopAt(s) - .5; if (z1 - z0 > .3) objeto('IFCMEMBER', 'Montante ' + e.id + ' s=' + s, 'POST', [tubo([P(s, tm, z0), P(s, tm, z1)], .1)], { PosicionEje_m: s, Largo: +(z1 - z0).toFixed(2), Nota: nota }, 'AdvancedSweptSolid'); } }
    else if (e.tipo === 'arco_superior') { const c = (e.a + e.b) / 2, h = e.luz / 2, zA = s => zTopAt(s) + e.flecha * (1 - ((s - c) / h) ** 2), ts = e.tNervios && e.tNervios.length ? e.tNervios : [tm];
      for (const [k, t] of ts.entries()) { const pts = []; for (let j = 0; j <= 30; j++) { const s = e.a + (e.b - e.a) * j / 30; pts.push(P(s, t, zA(s))); }
        objeto('IFCMEMBER', 'Arco superior nervio ' + (k + 1), 'ARCH_SEGMENT', [tubo(pts, .5)], { Luz: e.luz, Flecha: e.flecha, Pendolas: e.pendolas.length, Nota: 'parábola ajustada a la nube; ' + nota }, 'AdvancedSweptSolid');
        for (const s of e.pendolas) objeto('IFCMEMBER', 'Péndola nervio ' + (k + 1) + ' s=' + s, 'USERDEFINED:Péndola', [tubo([P(s, t, zTopAt(s)), P(s, t, zA(s))], .05)], { PosicionEje_m: s, Nota: nota }, 'AdvancedSweptSolid'); } }
    else if (e.tipo === 'pilono') { const zt = e.zTop, zd = zTopAt(e.s);
      objeto('IFCCOLUMN', 'Pilono ' + e.id, 'USERDEFINED:Pilono', [tubo([P(e.s, tm, e.zBase), P(e.s, tm, zt)], 1)], { PosicionEje_m: e.s, AlturaSobreTablero: e.altura, Tirantes: e.tirantes.length, Nota: nota }, 'AdvancedSweptSolid');
      cur = e.id + 'T'; for (const c of e.tirantes) objeto('IFCMEMBER', 'Tirante ' + c.lado + ' anclaje s=' + c.anclaje, 'STAY_CABLE', [tubo([P(c.anclaje, tm, zTopAt(c.anclaje)), P(e.s, tm, zt)], .1)], { Lado: c.lado, AnclajeTablero_m: c.anclaje, Cruce_m: c.cruce, Nota: 'recta del tope del pilono al anclaje estimado; ' + nota }, 'AdvancedSweptSolid'); }
    else if (e.tipo === 'baranda') { const sols = [], N = Math.max(1, Math.ceil((e.b - e.a) / 20));
      for (let k = 0; k < N; k++) { const s0 = e.a + (e.b - e.a) * k / N, s1 = e.a + (e.b - e.a) * (k + 1) / N, p0 = P(s0, e.t, zTopAt(s0)), p1 = P(s1, e.t, zTopAt(s1)); sols.push(caja([p0[0] + eZ[0] * e.altura / 2, p0[1] + eZ[1] * e.altura / 2, p0[2] + eZ[2] * e.altura / 2], dir(p0, p1), eT, .1, e.altura, Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]))); }
      objeto('IFCRAILING', 'Baranda ' + e.lado, 'GUARDRAIL', sols, { Lado: e.lado, Altura: e.altura, Cobertura: e.cobertura, Nota: 'espesor de 0,1 m de referencia (no medido)' }); }
  }
  if (prods.length) add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${guid()},$,$,$,(${prods.join(',')}),${bridge})`);
  const now = new Date().toISOString().slice(0, 19);
  return ['ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');", `FILE_NAME(${str((opt.nombre || 'puente') + '.ifc')},'${now}',(${str(opt.autor || '')}),(''),'PuenteGemelo','PuenteGemelo ${opt.version || ''}','');`, "FILE_SCHEMA(('IFC4X3_ADD2'));", 'ENDSEC;', 'DATA;',
    ...L.map((x, i) => '#' + (i + 1) + '=' + x + ';'), 'ENDSEC;', 'END-ISO-10303-21;', ''].join('\n');
}

// Puente combinado: tramos con distinto sistema a lo largo del eje (atirantado, arco sobre el tablero, armadura, tramos apoyados en pilares).
// Cada sistema ocupa lo que alcanzan sus elementos (cables de cada pilono, raíces o pilas del arco, cordones de la armadura); el resto del tablero
// entre los apoyos extremos son tramos apoyados, con los vanos que marcan los apoyos.
function composicion(SS, supports) {
  const sp = (supports || []).slice().sort((p, q) => p.a - q.a), T = [], mid = p => (p.a + p.b) / 2;
  for (const g of SS || []) {
    if (g.tipo === 'atirantado') for (const m of g.pilonos) { const al = m.alcance || [], a = m.s - (al[0] || .75 * m.h * 2), b = m.s + (al[1] || .75 * m.h * 2); T.push({ a, b, tipo: 'atirantado', pilonos: [m.s] }); }
    else if (g.tipo === 'arco_superior') { const la = g.luzArco, ap = la && la.apoyos; T.push({ a: ap ? ap.a : la ? la.a : g.a, b: ap ? ap.b : la ? la.b : g.b, tipo: 'arco_superior' }); }
    else if (g.tipo === 'armadura') T.push({ a: g.a, b: g.b, tipo: 'armadura' }); }
  T.sort((p, q) => p.a - q.a); const M = []; for (const t of T) { const q = M[M.length - 1];
    // dos pilonos seguidos forman un solo atirantado si el hueco entre lo que alcanzan sus cables es menor que la mitad de la distancia entre ellos
    // (desde el aire los cables del centro del vano principal se ven poco)
    const mismo = q && q.tipo === t.tipo && (t.a <= q.b + 5 || (t.tipo === 'atirantado' && t.a - q.b < .5 * (t.pilonos[0] - q.pilonos[q.pilonos.length - 1])));
    if (mismo) { q.b = Math.max(q.b, t.b); if (t.pilonos) q.pilonos = (q.pilonos || []).concat(t.pilonos); } else M.push({ ...t }); }
  if (!sp.length) return M.map(t => ({ ...t, a: +t.a.toFixed(1), b: +t.b.toFixed(1) }));
  const A = sp[0].a, B = sp[sp.length - 1].b, out = []; let cur = A;
  const apoyado = (a, b) => { if (b - a < 3) return; const den = sp.filter(p => mid(p) > a + 1 && mid(p) < b - 1 && p.tipo === 'pilar'); out.push({ a, b, tipo: 'apoyado', pilares: den.length, vanos: den.length + 1 }); };
  for (const t of M) { const a = Math.max(A, t.a), b = Math.min(B, t.b); if (b <= a) continue; if (a > cur) apoyado(cur, a); out.push({ ...t, a, b }); cur = Math.max(cur, b); }
  if (B > cur) apoyado(cur, B);
  // un «tramo apoyado» de menos de 8 m entre el estribo y un sistema es el apoyo de ese sistema: se une a su vecino
  for (let i = out.length - 1; i >= 0; i--) if (out[i].tipo === 'apoyado' && out[i].b - out[i].a < 8 && out.length > 1) { const o = out[i]; out.splice(i, 1); if (i > 0 && (i >= out.length || out[i - 1].b >= o.a - .1)) out[i - 1].b = o.b; else if (out[i]) out[i].a = o.a; }
  return out.map(t => ({ ...t, a: +t.a.toFixed(1), b: +t.b.toFixed(1) }));
}

// Pilas donde arranca un arco superior: en LiDAR aéreo el tablero tapa casi todo, pero bajo la calzada, cerca de cada raíz de la parábola,
// aparece un grupo angosto de puntos que baja hasta el terreno (la pila o el pilono). Se toma el centroide de ese grupo.
function apoyosArco(O, dk, gr, la, W = { R: 15, BW: 2, NB: 10, NMIN: 150, VERT: .5, ANCHO: 28 }) {
  const tt = []; for (let i = 0; i < O.n; i++) if (Math.abs(O.z[i] - dk) < 1) tt.push(O.t[i]); tt.sort((a, b) => a - b); if (tt.length < 100) return null;
  const t0 = tt[Math.floor(tt.length * .03)] - 2, t1 = tt[Math.floor(tt.length * .97)] + 2, clr = dk - gr; if (clr < 6) return null;
  const uno = r => { const nb = Math.ceil(2 * W.R / W.BW), cnt = new Int32Array(nb), zl = new Float32Array(nb).fill(1e9), zh = new Float32Array(nb).fill(-1e9), ws = new Float64Array(nb);
    for (let i = 0; i < O.n; i++) { const k = Math.floor((O.s[i] - r + W.R) / W.BW); if (k < 0 || k >= nb || O.t[i] < t0 || O.t[i] > t1) continue; const z = O.z[i]; if (z > dk - 2.5 || z < gr + 1.5) continue; cnt[k]++; ws[k] += O.s[i]; if (z < zl[k]) zl[k] = z; if (z > zh[k]) zh[k] = z; }
    let best = null; for (let k = 0; k < nb;) { if (cnt[k] < W.NB) { k++; continue; } let e = k; while (e + 1 < nb && (cnt[e + 1] >= W.NB || (e + 2 < nb && cnt[e + 2] >= W.NB))) e++;
      let n = 0, sw = 0, lo = 1e9, hi = -1e9; for (let j = k; j <= e; j++) { n += cnt[j]; sw += ws[j]; if (cnt[j]) { lo = Math.min(lo, zl[j]); hi = Math.max(hi, zh[j]); } }
      const c = sw / n; if (n >= W.NMIN && (e - k + 1) * W.BW <= W.ANCHO && (hi - lo) / clr >= W.VERT && (!best || Math.abs(c - r) < Math.abs(best - r))) best = c; k = e + 1; }
    return best; };
  const a = uno(la.a), b = uno(la.b); return a != null && b != null ? { a: +a.toFixed(1), b: +b.toFixed(1), L: +(b - a).toFixed(1) } : null;
}

return { desviaciones, MTC, fichaInspeccion, alMundo, exportarIFC, elementos, compararNubes, orientarComo, atributosNube, subCloud, ATR, dimensiones, ejeCurvo, ejePoli, desenrollar, ejeAuto, composicion, calidadNube, supra, superestructura, apoyosArco, gapProfile, gapEnds, estribosHueco, GAP_W, hipotesis, clearanceProfile, iaEstribos, HIP_W, EST_W, iaFeatures, iaPredict, iaClusters, iaRefine, IA_NAMES, IA_REGLA, fftInPlace, detrend, csdMatrix, fdd, efdd, fddModes, pickPeaks, staticPrep, fiberStress, influence, HL93, hl93Extremes, liveLoad, CS_WF, pTrans, markovStep, elemHI, bridgeHI, calibrateAlpha, maintenancePlan, Dxf, bridgePlans, sensorsOf, readAccel, sdof, spectrum, seismic, freqCampaign, setConcMin, suggestType, applySkew, coherence, f1Band, geomSigmas, perturbGeom, archRise, peakCampaign, csdAverage, calibrateModel, nelderMead, trainFreqIA, trainVecIA, trainModalIA, modalFeat, modalMeasFeat, modalMeasFeatBase, freqPredict, build, modal, archAll, parseCloud, orient, bounds, deckLevel, groundLevel, detectSupports, spansOf, envelope, fitParabola, polyval, archGeometry, spanCoverage, MATERIALS,
  build, sensorsOf, modal, signConvention, features, campaign, trainIA, forestPredict, LEVELS, noisy, mulberry, gaussR, quantile, median };
})();
if (typeof module !== 'undefined') module.exports = OPC;
