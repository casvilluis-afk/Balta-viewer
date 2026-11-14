"""Modelo 3D de barras del Puente Balta para Ansys Mechanical APDL, construido sobre la geometría del modelo C de la plataforma
(arcos ajustados a la nube TLS, caras de pilares medidas) y verificado con un cálculo propio (numpy/scipy) del mismo modelo.

Uso: python3 generar_modelo3D.py salida/geometria_modeloC.json salida
Unidades: kN, m, t, s.  Ejes: X transversal, Y a lo largo del puente, Z vertical.

HIPÓTESIS (todas SUPUESTAS, ninguna medida en el puente; se declaran en el macro y en la tesis):
- 6 nervios por arco, separados 2,0 m (X = ±1, ±3, ±5 m) dentro del ancho de 12,15 m; sección en I de la plataforma
  (alas 0,25 × 0,05 m, alma 0,04 m, peralte 0,70 m) → la suma de los 6 iguala A e I del modelo 2D.
- 6 largueros del tablero sobre los nervios; cada uno con 1/6 de A e I del tablero 2D; vigas transversales en cada nodo
  del tablero; diagonales horizontales en cada paño del tablero (rigidez lateral del tablero).
- Montantes bajo cada larguero en cada nodo del arco (1/6 de A e I del montante 2D).
- Arriostres transversales entre nervios en los nodos 4, 8, 12, 16 y 20 de cada arco.
- Pilares: muro de 3 m (Y) × 12,15 m (X) representado por 6 columnas de 2,025 m unidas en la cabeza por una viga rígida.
- Fierro fundido E = 100 GPa, ν = 0,3 (G = E/2,6); pilares E = 5 GPa; densidad 7,2 t/m³; tablero 120 kN/m.
- Arranques extremos empotrados; extremos del tablero con desplazamientos impedidos; base de pilares empotrada.
- Vigas de Timoshenko (con deformación por cortante, área de cortante = A), igual que BEAM188 con sección ASEC.
"""
import sys, json, math, numpy as np, scipy.sparse as sp
from scipy.sparse.linalg import eigsh
G = json.load(open(sys.argv[1])); out = sys.argv[2]; p = G['p']
E_ci, E_p, rho = p['E_ci'], p['E_pier'], p['rho_ci']
XS = [-5.0, -3.0, -1.0, 1.0, 3.0, 5.0]; NR = len(XS)
r4 = lambda v: round(v * 1e4) / 1e4
# ---- secciones: nombre → (E, A, Iyy, Izz, J); Iyy = flexión en el plano vertical del elemento (eje y local horizontal)
def rect_J(a, b):
    a, b = max(a, b), min(a, b); return a * b**3 * (1/3 - 0.21 * b / a * (1 - b**4 / (12 * a**4)))
bf, tf, tw, h = .25, .05, .04, p['rib_h']; hw = h - 2 * tf
A_rib = 2 * bf * tf + hw * tw; Iy_rib = 2 * (bf * tf**3 / 12 + bf * tf * ((h - tf) / 2)**2) + tw * hw**3 / 12
Iz_rib = 2 * tf * bf**3 / 12 + hw * tw**3 / 12; J_rib = (2 * bf * tf**3 + hw * tw**3) / 3
bp, tp = p['width'] / NR, p['pier_t']
SEC = {
 'nervio':          (E_ci, A_rib, Iy_rib * p['I_factor'], Iz_rib, J_rib),
 'larguero':        (E_ci, p['deck_A'] / NR, p['deck_I'] / NR, p['deck_I'] / NR, 2 * p['deck_I'] / NR),
 'montante':        (E_ci, p['post_A'] / NR, p['post_I'] / NR, p['post_I'] / NR, 2 * p['post_I'] / NR),
 'viga_transversal':(E_ci, .02, 2e-4, 2e-4, 4e-4),
 'arriostre':       (E_ci, .01, 5e-5, 5e-5, 1e-4),
 'diagonal':        (E_ci, .005, 1e-5, 1e-5, 2e-5),
 'pilar':           (E_p * 1e6 if E_p < 1e6 else E_p, bp * tp, bp * tp**3 / 12, tp * bp**3 / 12, rect_J(bp, tp)),
}
Epil = SEC['pilar'][0]
SEC['pilar_rigido'] = (Epil * 50,) + SEC['pilar'][1:]
SEC['cabezal'] = (Epil * 50, bp * tp, 50.0, 50.0, 100.0)
SID = {k: i + 1 for i, k in enumerate(SEC)}
# ---- nodos y elementos
X, Mn = [], []                                      # coordenadas, masas
def node(x, y, z): X.append((x, y, z)); Mn.append(0.0); return len(X) - 1
EL = []                                             # (i, j, seccion, K o None, grupo)
def el(i, j, s, K=None, g=''): EL.append((i, j, s, K, g or s))
KUP = {x: (x, 0.0, 1e4) for x in XS}                # orientación: z local hacia arriba (plano X = x)
KY = {x: (x, 1e5, 0.0) for x in XS}                 # orientación de verticales: z local hacia +Y
deck = {}; ribs = {}; spr = {}
for x in XS:
    for y in G['ydeck']: deck[(x, r4(y))] = node(x, y, G['zdeck'])
    for a in G['arches']:
        ids = [node(x, y, z) for y, z in zip(a['ys'], a['zs'])]; ribs[(x, a['k'])] = ids
        for i in range(len(ids) - 1): el(ids[i], ids[i + 1], 'nervio', KUP[x])
        for i in range(1, len(ids) - 1): el(ids[i], deck[(x, r4(a['ys'][i]))], 'montante')
    yd = [deck[(x, r4(y))] for y in G['ydeck']]
    for i in range(len(yd) - 1): el(yd[i], yd[i + 1], 'larguero', KUP[x])
tops = {}
for pn, kl, kr, (yt, zt) in [('p1', 'izq', 'centro', G['pier_top'][0]), ('p2', 'centro', 'der', G['pier_top'][1])]:
    for x in XS:
        nl, nr = ribs[(x, kl)][-1], ribs[(x, kr)][0]
        t = node(x, yt, zt); b = node(x, yt, G['zbase'][pn]); tops[(pn, x)] = t
        el(nl, t, 'pilar_rigido', KUP[x], 'pilar'); el(t, nr, 'pilar_rigido', KUP[x], 'pilar')
        el(t, b, 'pilar', KY[x]); yd = min(G['ydeck'], key=lambda v: abs(v - yt)); el(t, deck[(x, r4(yd))], 'pilar', KY[x])
    for a, b2 in zip(XS[:-1], XS[1:]): el(tops[(pn, a)], tops[(pn, b2)], 'cabezal')
for y in G['ydeck']:
    for a, b2 in zip(XS[:-1], XS[1:]): el(deck[(a, r4(y))], deck[(b2, r4(y))], 'viga_transversal')
for j, (y0, y1) in enumerate(zip(G['ydeck'][:-1], G['ydeck'][1:])):
    for k, (a, b2) in enumerate(zip(XS[:-1], XS[1:])):
        if (j + k) % 2: el(deck[(a, r4(y0))], deck[(b2, r4(y1))], 'diagonal')
        else: el(deck[(b2, r4(y0))], deck[(a, r4(y1))], 'diagonal')
for a_ in G['arches']:
    for i in (4, 8, 12, 16, 20):
        for a, b2 in zip(XS[:-1], XS[1:]): el(ribs[(a, a_['k'])][i], ribs[(b2, a_['k'])][i], 'arriostre')
# ---- masas (como en la plataforma: tablero por longitud tributaria; peso propio de barras de fierro a sus extremos)
yd = G['ydeck']; n = len(yd)
lt = [(yd[1] - yd[0]) / 2 if i == 0 else (yd[-1] - yd[-2]) / 2 if i == n - 1 else (yd[i + 1] - yd[i - 1]) / 2 for i in range(n)]
for x in XS:
    for i, y in enumerate(yd): Mn[deck[(x, r4(y))]] += p['w_deck'] / 9.81 * lt[i] / NR
for i, j, s, K, g in EL:
    if s in ('nervio', 'montante', 'viga_transversal', 'arriostre', 'diagonal'):
        L = math.dist(X[i], X[j]); m = rho * SEC[s][1] * L / 2; Mn[i] += m; Mn[j] += m
Mn = [max(m, 1e-3) for m in Mn]
# ---- apoyos
fix = {}
for x in XS:
    fix[ribs[(x, 'izq')][0]] = 'ALL'; fix[ribs[(x, 'der')][-1]] = 'ALL'
    fix[deck[(x, r4(yd[0]))]] = 'UXYZ'; fix[deck[(x, r4(yd[-1]))]] = 'UXYZ'
    for pn in ('p1', 'p2'): pass
for i, (x, y, z) in enumerate(X):
    if any(abs(z - G['zbase'][pn]) < 1e-9 and abs(y - G['pier_top'][k][0]) < 1e-9 for k, pn in enumerate(('p1', 'p2'))): fix[i] = 'ALL'
NN = len(X)
# ================= cálculo propio (Timoshenko 3D, área de cortante = A, G = E/2,6) =================
def ejes(i, j, K):
    a, b = np.array(X[i]), np.array(X[j]); ex = (b - a) / np.linalg.norm(b - a)
    ref = np.array(K) - a if K is not None else (np.array([0, 0, 1.]) if abs(ex[2]) < .9 else np.array([0, 1., 0]))
    ez = ref - ref.dot(ex) * ex; ez /= np.linalg.norm(ez); ey = np.cross(ez, ex); return np.vstack([ex, ey, ez])
def kloc(E, A, Iy, Iz, J, L):
    Gs = E / 2.6; k = np.zeros((12, 12))
    ea, gj = E * A / L, Gs * J / L
    for (a, b, v) in [(0, 0, ea), (6, 6, ea), (0, 6, -ea), (3, 3, gj), (9, 9, gj), (3, 9, -gj)]: k[a, b] = k[b, a] = v
    py = 12 * E * Iz / (Gs * A * L * L); c = E * Iz / (L**3 * (1 + py))      # flexión en el plano x-y (v, θz)
    m = c * np.array([[12, 6*L, -12, 6*L], [6*L, (4+py)*L*L, -6*L, (2-py)*L*L], [-12, -6*L, 12, -6*L], [6*L, (2-py)*L*L, -6*L, (4+py)*L*L]])
    d = [1, 5, 7, 11]; k[np.ix_(d, d)] += m
    pz = 12 * E * Iy / (Gs * A * L * L); c = E * Iy / (L**3 * (1 + pz))      # flexión en el plano x-z (w, θy)
    m = c * np.array([[12, -6*L, -12, -6*L], [-6*L, (4+pz)*L*L, 6*L, (2-pz)*L*L], [-12, 6*L, 12, 6*L], [-6*L, (2-pz)*L*L, 6*L, (4+pz)*L*L]])
    d = [2, 4, 8, 10]; k[np.ix_(d, d)] += m
    return k
rows, cols, vals = [], [], []
for i, j, s, K, g in EL:
    E, A, Iy, Iz, J = SEC[s]; L = math.dist(X[i], X[j]); R = ejes(i, j, K); T = np.kron(np.eye(4), R)
    kg = T.T @ kloc(E, A, Iy, Iz, J, L) @ T; d = list(range(6 * i, 6 * i + 6)) + list(range(6 * j, 6 * j + 6))
    for a in range(12):
        for b in range(12): rows.append(d[a]); cols.append(d[b]); vals.append(kg[a, b])
nd = 6 * NN; K = sp.csr_matrix((vals, (rows, cols)), shape=(nd, nd)); K = (K + K.T) / 2
Md = np.zeros(nd)
for i, m in enumerate(Mn): Md[6*i:6*i+3] = m; Md[6*i+3:6*i+6] = m * 1e-4
fx = set()
for i, t in fix.items(): fx.update(range(6*i, 6*i + (6 if t == 'ALL' else 3)))
free = np.array([g for g in range(nd) if g not in fx])
Kf = K[free][:, free].tocsc(); Mf = sp.diags(Md[free])
NM = 12; w, V = eigsh(Kf, k=NM, M=Mf, sigma=0, which='LM'); o = np.argsort(w); w, V = w[o], V[:, o]
f = np.sqrt(np.maximum(w, 0)) / (2 * np.pi)
def describe(v):
    u = np.zeros(nd); u[free] = v; e = [np.sum(Md[c::6] * u[c::6]**2) for c in range(3)]; tot = sum(e)
    dirn = ['transversal (X)', 'longitudinal (Y)', 'vertical (Z)'][int(np.argmax(e))]
    amp = np.sqrt(u[0::6]**2 + u[1::6]**2 + u[2::6]**2); i = int(np.argmax(amp)); y = X[i][1]
    tramo = 'arco izquierdo' if y < G['pier_top'][0][0] else 'arco central' if y < G['pier_top'][1][0] else 'arco derecho'
    uz = u[2::6]; tors = ''
    if dirn == 'vertical (Z)':          # torsión: los nervios de un lado suben y los del otro bajan
        sel = [k for k in range(NN) if abs(X[k][1] - y) < 1.0]
        l = sum(uz[k] for k in sel if X[k][0] < 0); r = sum(uz[k] for k in sel if X[k][0] > 0)
        if l * r < 0: tors = ', con torsión'
    return f'{dirn}{tors}, máx. en {tramo} (Y = {y:.1f} m)', [round(x / tot, 2) for x in e]
desc = [describe(V[:, k]) for k in range(NM)]
# ================= macro APDL =================
NSUB = {'nervio': 4, 'larguero': 4, 'montante': 4, 'pilar': 4, 'pilar_rigido': 2, 'cabezal': 1, 'viga_transversal': 2, 'arriostre': 2, 'diagonal': 2}
f7 = lambda v: f'{v:.10g}'
L_ = []; A = L_.append
A('! ' + '=' * 100)
A('! Puente Balta - modelo 3D de barras sobre la geometria del modelo C de PuenteGemelo (arcos ajustados a la nube TLS)')
A('! Generado por app/ansys/generar_modelo3D.py. Unidades: kN, m, t, s. Ejes: X transversal, Y longitudinal, Z vertical.')
A('! SECCIONES, ARRIOSTRES, DIAGONALES Y MATERIAL SUPUESTOS (no medidos). Ver el encabezado de generar_modelo3D.py.')
A(f'! Frecuencias del calculo de verificacion (Timoshenko 3D): ' + ', '.join(f'{v:.3f}' for v in f) + ' Hz')
A('! ' + '=' * 100)
A('FINISH'); A('/CLEAR,NOSTART'); A('/TITLE,Puente Balta - modelo 3D de barras (geometria de la nube TLS; secciones supuestas)'); A('/PREP7')
A('ET,1,BEAM188'); A('KEYOPT,1,3,3            ! forma cubica'); A('ET,2,MASS21')
for s, (E, Aa, Iy, Iz, J) in SEC.items():
    k = SID[s]; A(f'MP,EX,{k},{f7(E)}          ! {s}'); A(f'MP,PRXY,{k},0.3'); A(f'SECTYPE,{k},BEAM,ASEC'); A(f'SECDATA,{f7(Aa)},{f7(Iy)},0,{f7(Iz)},0,{f7(J)}')
A('! --- nodos')
for i, (x, y, z) in enumerate(X): A(f'N,{i+1},{f7(x)},{f7(y)},{f7(z)}')
kn = {}; nid = NN
A('! --- nodos de orientacion de las vigas (no forman parte de la estructura)')
for K in list(KUP.values()) + list(KY.values()): nid += 1; kn[K] = nid; A(f'N,{nid},{f7(K[0])},{f7(K[1])},{f7(K[2])}')
A('! --- nodos intermedios y elementos'); A('TYPE,1')
cur = None; lines_n, lines_e = [], []
for i, j, s, K, g in EL:
    k = SID[s]
    if cur != k: lines_e.append(f'MAT,{k}'); lines_e.append(f'SECNUM,{k}          ! {s}'); cur = k
    ns = NSUB[s]; prev = i + 1; a, b = np.array(X[i]), np.array(X[j]); ko = f',{kn[K]}' if K is not None else ''
    for t in range(1, ns):
        nid += 1; q = a + (b - a) * t / ns; lines_n.append(f'N,{nid},{f7(q[0])},{f7(q[1])},{f7(q[2])}'); lines_e.append(f'E,{prev},{nid}{ko}'); prev = nid
    lines_e.append(f'E,{prev},{j+1}{ko}')
L_ += lines_n + lines_e
A('! --- masas concentradas'); A('TYPE,2')
for i, m in enumerate(Mn):
    A(f'R,{100+i},{f7(m)},{f7(m)},{f7(m)},{f7(m*1e-4)},{f7(m*1e-4)},{f7(m*1e-4)}'); A(f'REAL,{100+i}'); A(f'E,{i+1}')
A('! --- apoyos')
for i, t in sorted(fix.items()):
    if t == 'ALL': A(f'D,{i+1},ALL,0')
    else: A(f'D,{i+1},UX,0,,,,UY,UZ')
A('FINISH'); A('/SOLU'); A('ANTYPE,MODAL'); A(f'MODOPT,LANB,{NM}'); A(f'MXPAND,{NM},,,YES'); A('SOLVE'); A('FINISH')
A('/POST1'); A('SET,LIST'); A(f'*DIM,FREQ,ARRAY,{NM}'); A(f'*DO,I,1,{NM}'); A('  *GET,FREQ(I),MODE,I,FREQ'); A('*ENDDO')
A('*CFOPEN,frecuencias_modelo3D,txt'); A('*VWRITE'); A("('    Modo        f_Hz')"); A(f'*DO,I,1,{NM}'); A('*VWRITE,I,FREQ(I)'); A('(F8.0,F12.4)'); A('*ENDDO'); A('*CFCLOS')
A('/RGB,INDEX,100,100,100,0'); A('/RGB,INDEX,0,0,0,15'); A('/PBC,ALL,,0'); A('ESEL,S,TYPE,,1'); A('/VUP,1,Z'); A('/VIEW,1,1,-1,0.6'); A('/ESHAPE,0'); A('/AUTO,1'); A('SET,1,1'); A('PLDISP,1')
open(f'{out}/balta_modelo3D.mac', 'w', encoding='utf-8', newline='\r\n').write('\n'.join(L_) + '\n')
with open(f'{out}/frecuencias_referencia_3D.csv', 'w', encoding='utf-8') as fh:
    fh.write('modo,f_Hz,forma,fraccion_energia_X_Y_Z\n')
    for k in range(NM): fh.write(f"{k+1},{f[k]:.4f},\"{desc[k][0]}\",\"{[float(v) for v in desc[k][1]]}\"\n")
nel = sum(NSUB[s] for _, _, s, _, _ in EL)
print(f'nodos estructura {NN}, nodos totales {nid}, barras {len(EL)}, elementos BEAM188 {nel}, masas {NN}')
for k in range(NM): print(f'modo {k+1:2d}: {f[k]:7.3f} Hz  {desc[k][0]}  XYZ={[float(v) for v in desc[k][1]]}')
