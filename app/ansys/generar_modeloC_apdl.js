/* Genera el macro APDL (Ansys Mechanical APDL) que replica EXACTAMENTE el modelo C de la plataforma (pórtico 2D del Puente Balta:
   3 arcos ajustados a la nube, tablero, montantes, 2 pilares) y calcula con el mismo código de la app las frecuencias de referencia.
   Uso: node generar_modeloC_apdl.js <index.html de la plataforma> <modelo_c.json> <carpeta de salida>
   Unidades del modelo: kN, m, t, s  →  E en kN/m², masa en t, frecuencias en Hz. */
const fs = require('fs'), path = require('path');
const [, , htmlF, jsonF, outD] = process.argv;
const H = fs.readFileSync(htmlF, 'utf8');
const grab = name => { const i = H.indexOf(name); if (i < 0) throw new Error('no encuentro ' + name); let d = 0, j = H.indexOf('{', i); for (let k = j; k < H.length; k++) { if (H[k] === '{') d++; else if (H[k] === '}') { d--; if (!d) return H.slice(i, k + 1); } } };
const src = ['const MC_NSEG=24;', grab('function mcRibSection('), grab('function mcPolyval('), grab('function mcBuild('), grab('function mcK('), grab('function mcJacobi('), grab('function mcModal(')].join('\n');
const M = new Function(src + '\nreturn {mcBuild, mcModal};')();
const D = JSON.parse(fs.readFileSync(jsonF, 'utf8'));
const fr = M.mcBuild(D, {}), NM = 8, R = M.mcModal(fr, NM);
const N = fr.nodes.length, p = fr.p;
/* materiales y secciones: una combinación (E, A, I) por grupo */
const props = [], key = j => [fr.E[j], fr.A[j], fr.I[j]].join('|'), pid = {};
fr.el.forEach((_, j) => { const k = key(j); if (!(k in pid)) { pid[k] = props.length + 1; props.push({ E: fr.E[j], A: fr.A[j], I: fr.I[j], grp: fr.grp[j].replace(/_.*/, '') }); } });
const f6 = v => Number(v).toPrecision(10), NSUB = 4;
fr.el.forEach(([i, j], t) => { const q = props[pid[key(t)] - 1], L = Math.hypot(fr.nodes[j][0] - fr.nodes[i][0], fr.nodes[j][1] - fr.nodes[i][1]) / NSUB, v = 1000 * 12 * q.E * q.I / (L * L); q.kGA = Math.max(q.kGA || 0, v); }); /* cada barra del modelo se divide en NSUB elementos (nodos intermedios sin masa) */
function genera(TIMO) {
let s = `! =====================================================================================
! Puente Balta - Modelo C de la plataforma PuenteGemelo, replicado en Ansys Mechanical APDL
! Generado por app/ansys/generar_modeloC_apdl.js a partir de data/modelo_c.json (geometría ajustada a la nube TLS)
! Pórtico plano en el plano Y-Z (Y: eje del puente, Z: vertical). Unidades: kN, m, t, s (E en kN/m2, masa en t).
! Secciones: SUPUESTAS (equivalentes de la plataforma, no medidas). Este modelo sirve para VERIFICAR que Ansys
! reproduce las frecuencias del modelo de la app, no para afirmar las frecuencias reales del puente.
! Nodos: ${N} con masa + ${fr.el.length * (NSUB - 1)} intermedios   Elementos viga: ${fr.el.length * NSUB} (BEAM188 cúbica)   Masas: ${N}
! Frecuencias de referencia (código de la app): ${R.f.map(v => v.toFixed(3)).join(', ')} Hz
! =====================================================================================
FINISH
/CLEAR,NOSTART
/TITLE,Puente Balta - Modelo C ${TIMO ? '(Timoshenko: con cortante)' : '(Euler-Bernoulli: verificacion de la plataforma)'}
/PREP7
ET,1,BEAM188            ! viga 3D (se restringe al plano)
KEYOPT,1,3,3            ! funciones de forma cúbicas (con la opción lineal por defecto la malla gruesa sale rígida: +4 a +30 %)
ET,2,MASS21             ! masa puntual con inercia rotacional (KEYOPT(3)=0)
! --- materiales y secciones (ASEC: A, Iyy, Iyz, Izz, Iw, J); Iyy = Izz para no depender de la orientación
`;
props.forEach((q, k) => { const id = k + 1; s += `MP,EX,${id},${f6(q.E)}          ! ${q.grp}\nMP,PRXY,${id},0.3\n` + (TIMO ? `! cortante con G = E/2,6 (viga de Timoshenko, deformación por cortante real de la sección supuesta)\n` : `MP,GXY,${id},${f6(1e4 * q.E)}          ! G = 10 000 E: sin deformación por cortante (Euler-Bernoulli, como la app)\n`) + `SECTYPE,${id},BEAM,ASEC\nSECDATA,${f6(q.A)},${f6(q.I)},0,${f6(q.I)},0,${f6(2 * q.I)}\n`; });
s += `! --- nodos (Y, Z)\n`;
fr.nodes.forEach(([y, z], i) => { s += `N,${i + 1},0,${f6(y)},${f6(z)}\n`; });
s += `! --- elementos viga\nTYPE,1\n`;
let nid = N; const extra = [];
fr.el.forEach(([i, j], t) => { const id = pid[key(t)]; s += `MAT,${id}\nSECNUM,${id}          ! ${fr.grp[t]}\n`; let prev = i + 1; const [y1, z1] = fr.nodes[i], [y2, z2] = fr.nodes[j];
  for (let k = 1; k < NSUB; k++) { nid++; extra.push(`N,${nid},0,${f6(y1 + (y2 - y1) * k / NSUB)},${f6(z1 + (z2 - z1) * k / NSUB)}`); s += `E,${prev},${nid}\n`; prev = nid; } s += `E,${prev},${j + 1}\n`; });
s = s.replace('! --- elementos viga\n', '! --- nodos intermedios (sin masa; ' + NSUB + ' elementos por barra)\n' + extra.join('\n') + '\n! --- elementos viga\n');
s += `! --- masas concentradas (tablero: peso/g por longitud tributaria; arcos y montantes: rho*A*L/2 a cada extremo)\nTYPE,2\n`;
for (let i = 0; i < N; i++) { const m = fr.mass[i]; s += `R,${100 + i},${f6(m)},${f6(m)},${f6(m)},${f6(m * 1e-4)},${f6(m * 1e-4)},${f6(m * 1e-4)}\nREAL,${100 + i}\nE,${i + 1}\n`; }
s += `! --- condiciones de borde (pilares empotrados en la base, arranques extremos ${p.springing === 'fixed' ? 'empotrados' : 'articulados'}, extremos del tablero con apoyo simple)\n`;
const dof = ['UY', 'UZ', 'ROTX'];
for (let i = 0; i < N; i++) for (let d = 0; d < 3; d++) if (fr.fx[3 * i + d]) s += `D,${i + 1},${dof[d]},0\n`;
s += `! --- plano Y-Z: se bloquean los grados de libertad fuera del plano
NSEL,ALL
D,ALL,UX,0
D,ALL,ROTY,0
D,ALL,ROTZ,0
FINISH
! --- análisis modal
/SOLU
ANTYPE,MODAL
MODOPT,LANB,${NM}
MXPAND,${NM},,,YES
SOLVE
FINISH
! --- frecuencias a un archivo de texto (frecuencias_modeloC.txt en la carpeta de trabajo)
/POST1
SET,LIST
*DIM,FREQ,ARRAY,${NM}
*DO,I,1,${NM}
  *GET,FREQ(I),MODE,I,FREQ
*ENDDO
*CFOPEN,frecuencias_modeloC${TIMO ? '_timoshenko' : ''},txt
*VWRITE
('    Modo        f_Hz')
*DO,I,1,${NM}
*VWRITE,I,FREQ(I)
(F8.0,F12.4)
*ENDDO
*CFCLOS
/ESHAPE,1
/VIEW,1,1,0,0
SET,1,1
PLDISP,1
`;
return s; }
fs.mkdirSync(outD, { recursive: true });
fs.writeFileSync(path.join(outD, 'balta_modeloC_2D.mac'), genera(false).replace(/\n/g, '\r\n'));
fs.writeFileSync(path.join(outD, 'balta_modeloC_2D_timoshenko.mac'), genera(true).replace(/\n/g, '\r\n'));
const ref = ['modo,f_app_Hz'].concat(R.f.map((v, i) => `${i + 1},${v.toFixed(4)}`)).join('\n') + '\n';
fs.writeFileSync(path.join(outD, 'frecuencias_referencia_app.csv'), ref);
console.log('nodos', N, 'elementos', fr.el.length, 'secciones', props.length, '\nfrecuencias app (Hz):', R.f.map(v => v.toFixed(3)).join(', '));
console.log(props.map((q, k) => `${k + 1} ${q.grp} E=${q.E} A=${q.A.toFixed(4)} I=${q.I.toExponential(3)}`).join('\n'));
