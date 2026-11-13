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
const f6 = v => Number(v).toPrecision(10);
let s = `! =====================================================================================
! Puente Balta - Modelo C de la plataforma PuenteGemelo, replicado en Ansys Mechanical APDL
! Generado por app/ansys/generar_modeloC_apdl.js a partir de data/modelo_c.json (geometría ajustada a la nube TLS)
! Pórtico plano en el plano Y-Z (Y: eje del puente, Z: vertical). Unidades: kN, m, t, s (E en kN/m2, masa en t).
! Secciones: SUPUESTAS (equivalentes de la plataforma, no medidas). Este modelo sirve para VERIFICAR que Ansys
! reproduce las frecuencias del modelo de la app, no para afirmar las frecuencias reales del puente.
! Nodos: ${N}   Elementos viga: ${fr.el.length}   Masas: ${N}
! Frecuencias de referencia (código de la app): ${R.f.map(v => v.toFixed(3)).join(', ')} Hz
! =====================================================================================
FINISH
/CLEAR,NOSTART
/TITLE,Puente Balta - Modelo C (verificacion de la plataforma PuenteGemelo)
/PREP7
ET,1,BEAM188            ! viga 3D (se restringe al plano)
ET,2,MASS21             ! masa puntual con inercia rotacional (KEYOPT(3)=0)
! --- materiales y secciones (ASEC: A, Iyy, Iyz, Izz, Iw, J); Iyy = Izz para no depender de la orientación
`;
props.forEach((q, k) => { const id = k + 1; s += `MP,EX,${id},${f6(q.E)}          ! ${q.grp}\nMP,PRXY,${id},0.3\nSECTYPE,${id},BEAM,ASEC\nSECDATA,${f6(q.A)},${f6(q.I)},0,${f6(q.I)},0,${f6(2 * q.I)}\nSECCONTROL,1E14,1E14        ! rigidez a cortante muy alta: viga de Euler-Bernoulli como en la app\n`; });
s += `! --- nodos (Y, Z)\n`;
fr.nodes.forEach(([y, z], i) => { s += `N,${i + 1},0,${f6(y)},${f6(z)}\n`; });
s += `! --- elementos viga\nTYPE,1\n`;
fr.el.forEach(([i, j], t) => { const id = pid[key(t)]; s += `MAT,${id}\nSECNUM,${id}\nE,${i + 1},${j + 1}          ! ${fr.grp[t]}\n`; });
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
*CFOPEN,frecuencias_modeloC,txt
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
fs.mkdirSync(outD, { recursive: true });
fs.writeFileSync(path.join(outD, 'balta_modeloC_2D.mac'), s.replace(/\n/g, '\r\n'));
const ref = ['modo,f_app_Hz'].concat(R.f.map((v, i) => `${i + 1},${v.toFixed(4)}`)).join('\n') + '\n';
fs.writeFileSync(path.join(outD, 'frecuencias_referencia_app.csv'), ref);
console.log('nodos', N, 'elementos', fr.el.length, 'secciones', props.length, '\nfrecuencias app (Hz):', R.f.map(v => v.toFixed(3)).join(', '));
console.log(props.map((q, k) => `${k + 1} ${q.grp} E=${q.E} A=${q.A.toFixed(4)} I=${q.I.toExponential(3)}`).join('\n'));
