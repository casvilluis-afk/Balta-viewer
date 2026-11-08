// Rasgos por vóxel de una nube etiquetada (mismo código que usa la app: OPC.iaFeatures).
// uso: node extraer_rasgos.js <nube.ply> <etiquetas.u8> <salida>   → <salida>.f32 (rasgos) y <salida>.y (clase)
// Etiquetas de Lee (2026): 0 Background, 1 Superstructure, 2 Column, 3 Pier Cap, 4 Guardrail → fondo 0, tablero 1 (1 y 4), apoyo 2 (2 y 3)
const fs = require('fs'), path = require('path'); global.self = undefined;
const OPC = new Function(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'plataforma', 'op_core.js'), 'utf8') + '\nreturn OPC;')();
(async () => { const [, , f, labf, out] = process.argv;
  const c = await OPC.parseCloud(new Blob([fs.readFileSync(f)]), path.basename(f), () => {});
  const O = OPC.orient(c, 'z', 1), dk = OPC.deckLevel(O), gr = OPC.groundLevel(O), R = OPC.iaFeatures(O, dk, gr);
  const lab = new Uint8Array(fs.readFileSync(labf)), MAP = [0, 1, 2, 2, 1], h = new Uint32Array(R.nv * 3);
  for (let i = 0; i < O.n; i++) h[R.pv[i] * 3 + MAP[lab[i]]]++;
  const y = new Uint8Array(R.nv); for (let j = 0; j < R.nv; j++) { let b = 0; for (let k = 1; k < 3; k++) if (h[j * 3 + k] > h[j * 3 + b]) b = k; y[j] = b; }
  fs.writeFileSync(out + '.f32', Buffer.from(R.F.buffer)); fs.writeFileSync(out + '.y', Buffer.from(y.buffer));
  console.log(JSON.stringify({ nube: path.basename(f), puntos: O.n, voxeles: R.nv, rasgos: R.nf })); })();
