"""Modelo 3D del Puente Balta con MATERIALES explícitos (E, ν y densidad por material: la masa sale de la densidad de cada
elemento, no de masas concentradas a mano) y PILARES SÓLIDOS, en tres niveles de malla para el estudio de convergencia.

Uso: python3 generar_modelo3D_material.py salida/geometria_modeloC.json salida
Unidades: kN, m, t, s (E en kN/m², densidad en t/m³). Ejes: X transversal, Y longitudinal, Z vertical.

MATERIALES
- Fierro fundido gris (arcos, montantes, largueros, vigas transversales, arriostres, diagonales): E = 100 GPa (valor de diseño
  de la primera parte; rango 66-111 GPa), ν = 0,26 y ρ = 7,15 t/m³ (fundición gris, matmatch.com, «grey cast iron»).
- Mampostería de piedra (pilares; Wikipedia: «stone pillars»): E = 5 GPa (valor nominal de la plataforma), ν = 0,20,
  ρ = 2,2 t/m³ (supuesto, valor típico de mampostería de piedra; no medido).
- Carga muerta del tablero (pavimento y relleno): 120 kN/m del modelo de la plataforma menos el peso propio de los largueros
  de fierro, como masa no estructural (MASS21) en los nodos de los largueros.
- Uniones rígidas (arranques → cabeza del pilar): 50 E, sin densidad.
GEOMETRÍA Y SECCIONES: las del modelo 3D anterior (6 nervios en I cada 2 m, largueros, montantes, vigas transversales,
diagonales, arriostres; secundarias SUPUESTAS). Pilar: muro macizo 12,15 × 3 m (SOLID185) unido por regiones rígidas.
MALLA: grueso / medio / fino → divisiones por barra primaria 2 / 4 / 8, secundarias 1 / 2 / 4; hexaedros de ~1,0 / 0,5 / 0,3 m.
"""
import sys, json, math, numpy as np
G = json.load(open(sys.argv[1])); out = sys.argv[2]; p = G['p']
XS = [-5.0, -3.0, -1.0, 1.0, 3.0, 5.0]; NR = len(XS); r4 = lambda v: round(v * 1e4) / 1e4; f7 = lambda v: f'{v:.10g}'
MAT = {1: ('fierro fundido gris', 1.0e8, .26, 7.15), 2: ('mamposteria de piedra (pilares)', 5.0e6, .20, 2.2), 3: ('union rigida', 5.0e7 * 50 / 5e6 * 5e6 / 5e6 * 1.0, .26, 0.0)}
MAT[3] = ('union rigida', 50 * 5.0e6, .26, 0.0)
def rect_J(a, b):
    a, b = max(a, b), min(a, b); return a * b**3 * (1/3 - 0.21 * b / a * (1 - b**4 / (12 * a**4)))
bf, tf, tw, h = .25, .05, .04, p['rib_h']; hw = h - 2 * tf
A_rib = 2 * bf * tf + hw * tw; Iy_rib = 2 * (bf * tf**3 / 12 + bf * tf * ((h - tf) / 2)**2) + tw * hw**3 / 12
Iz_rib = 2 * tf * bf**3 / 12 + hw * tw**3 / 12; J_rib = (2 * bf * tf**3 + hw * tw**3) / 3
bp, tp = p['width'] / NR, p['pier_t']
SEC = {  # nombre: (material, A, Iyy, Izz, J)
 'nervio': (1, A_rib, Iy_rib * p['I_factor'], Iz_rib, J_rib),
 'larguero': (1, p['deck_A'] / NR, p['deck_I'] / NR, p['deck_I'] / NR, 2 * p['deck_I'] / NR),
 'montante': (1, p['post_A'] / NR, p['post_I'] / NR, p['post_I'] / NR, 2 * p['post_I'] / NR),
 'viga_transversal': (1, .02, 2e-4, 2e-4, 4e-4), 'arriostre': (1, .01, 5e-5, 5e-5, 1e-4), 'diagonal': (1, .005, 1e-5, 1e-5, 2e-5),
 'union_rigida': (3, bp * tp, bp * tp**3 / 12, tp * bp**3 / 12, rect_J(bp, tp)),
 'pilar_tablero': (2, bp * tp, bp * tp**3 / 12, tp * bp**3 / 12, rect_J(bp, tp)),
}
SID = {k: i + 1 for i, k in enumerate(SEC)}
X = []; EL = []
def node(x, y, z): X.append((x, y, z)); return len(X) - 1
def el(i, j, s, K=None): EL.append((i, j, s, K))
KUP = {x: (x, 0.0, 1e4) for x in XS}; KY = {x: (x, 1e5, 0.0) for x in XS}
deck, ribs, tops = {}, {}, {}
for x in XS:
    for y in G['ydeck']: deck[(x, r4(y))] = node(x, y, G['zdeck'])
    for a in G['arches']:
        ids = [node(x, y, z) for y, z in zip(a['ys'], a['zs'])]; ribs[(x, a['k'])] = ids
        for i in range(len(ids) - 1): el(ids[i], ids[i + 1], 'nervio', KUP[x])
        for i in range(1, len(ids) - 1): el(ids[i], deck[(x, r4(a['ys'][i]))], 'montante')
    yd = [deck[(x, r4(y))] for y in G['ydeck']]
    for i in range(len(yd) - 1): el(yd[i], yd[i + 1], 'larguero', KUP[x])
for pn, kl, kr, (yt, zt) in [('p1', 'izq', 'centro', G['pier_top'][0]), ('p2', 'centro', 'der', G['pier_top'][1])]:
    for x in XS:
        t = node(x, yt, zt); tops[(pn, x)] = t
        el(ribs[(x, kl)][-1], t, 'union_rigida', KUP[x]); el(t, ribs[(x, kr)][0], 'union_rigida', KUP[x])
        yd_ = min(G['ydeck'], key=lambda v: abs(v - yt)); el(t, deck[(x, r4(yd_))], 'pilar_tablero', KY[x])
for y in G['ydeck']:
    for a, b in zip(XS[:-1], XS[1:]): el(deck[(a, r4(y))], deck[(b, r4(y))], 'viga_transversal')
for j, (y0, y1) in enumerate(zip(G['ydeck'][:-1], G['ydeck'][1:])):
    for k, (a, b) in enumerate(zip(XS[:-1], XS[1:])):
        el(*((deck[(a, r4(y0))], deck[(b, r4(y1))]) if (j + k) % 2 else (deck[(b, r4(y0))], deck[(a, r4(y1))])), 'diagonal')
for a_ in G['arches']:
    for i in (4, 8, 12, 16, 20):
        for a, b in zip(XS[:-1], XS[1:]): el(ribs[(a, a_['k'])][i], ribs[(b, a_['k'])][i], 'arriostre')
# masa no estructural del tablero: 120 kN/m menos el peso propio de los 6 largueros (que ya entra por su densidad)
yd = G['ydeck']; n = len(yd); g = 9.81
lt = [(yd[1] - yd[0]) / 2 if i == 0 else (yd[-1] - yd[-2]) / 2 if i == n - 1 else (yd[i + 1] - yd[i - 1]) / 2 for i in range(n)]
w_ns = p['w_deck'] - MAT[1][3] * g * p['deck_A']
MNS = {deck[(x, r4(y))]: w_ns / g * lt[i] / NR for x in XS for i, y in enumerate(yd)}
fix = {}
for x in XS:
    fix[ribs[(x, 'izq')][0]] = 'ALL'; fix[ribs[(x, 'der')][-1]] = 'ALL'; fix[deck[(x, r4(yd[0]))]] = 'UXYZ'; fix[deck[(x, r4(yd[-1]))]] = 'UXYZ'
NN = len(X)
def grid(br, hmax):
    out = [br[0]]
    for a, b in zip(br[:-1], br[1:]):
        k = max(1, math.ceil((b - a) / hmax - 1e-9)); out += [a + (b - a) * q / k for q in range(1, k + 1)]
    return out
NIV = {'grueso': ({'p': 2, 's': 1}, 1.0), 'medio': ({'p': 4, 's': 2}, 0.5), 'fino': ({'p': 8, 's': 4}, 0.3)}
PRIM = {'nervio', 'larguero', 'montante', 'pilar_tablero'}
for niv, (ns_, hs) in NIV.items():
    S = []; A = S.append
    A('! ' + '=' * 100)
    A(f'! Puente Balta - modelo 3D con MATERIALES y PILARES SOLIDOS, malla {niv.upper()} (estudio de convergencia)')
    A('! Generado por app/ansys/generar_modelo3D_material.py sobre la geometria del modelo C de PuenteGemelo (nube TLS).')
    A('! Masa: densidad de cada material (matriz de masa consistente) + carga muerta del tablero como masa no estructural.')
    A('! Secciones secundarias, separacion de nervios y propiedades de la mamposteria SUPUESTAS. Unidades: kN, m, t, s.')
    A('! ' + '=' * 100)
    A('FINISH'); A('/CLEAR,NOSTART'); A(f'/TITLE,Puente Balta - 3D con materiales y pilares solidos - malla {niv}'); A('/PREP7')
    A('ET,1,BEAM188'); A('KEYOPT,1,3,3'); A('ET,2,MASS21'); A('KEYOPT,2,3,2          ! masa 3D sin inercia rotacional'); A('ET,3,SOLID185')
    for k, (nom, E, nu, rho) in MAT.items():
        A(f'MP,EX,{k},{f7(E)}          ! {nom}'); A(f'MP,PRXY,{k},{nu}'); A(f'MP,DENS,{k},{f7(rho) if rho > 0 else 0}')
    for s, (m, Aa, Iy, Iz, J) in SEC.items():
        k = SID[s]; A(f'SECTYPE,{k},BEAM,ASEC          ! {s}'); A(f'SECDATA,{f7(Aa)},{f7(Iy)},0,{f7(Iz)},0,{f7(J)}')
    for i, (x, y, z) in enumerate(X): A(f'N,{i+1},{f7(x)},{f7(y)},{f7(z)}')
    nid = NN; kn = {}
    for K in list(KUP.values()) + list(KY.values()): nid += 1; kn[K] = nid; A(f'N,{nid},{f7(K[0])},{f7(K[1])},{f7(K[2])}')
    ln, le = [], []; cur = None; nbeam = 0
    le.append('TYPE,1')
    for i, j, s, K in EL:
        if cur != s: le.append(f'MAT,{SEC[s][0]}'); le.append(f'SECNUM,{SID[s]}          ! {s}'); cur = s
        ns = ns_['p'] if s in PRIM else ns_['s'] if s != 'union_rigida' else 1
        prev = i + 1; a, b = np.array(X[i]), np.array(X[j]); ko = f',{kn[K]}' if K else ''
        for t in range(1, ns):
            nid += 1; q = a + (b - a) * t / ns; ln.append(f'N,{nid},{f7(q[0])},{f7(q[1])},{f7(q[2])}'); le.append(f'E,{prev},{nid}{ko}'); prev = nid; nbeam += 1
        le.append(f'E,{prev},{j+1}{ko}'); nbeam += 1
    S += ln + le
    A('! --- masa no estructural del tablero'); A('TYPE,2')
    for q, (i, m) in enumerate(sorted(MNS.items())): A(f'R,{100+q},{f7(m)},{f7(m)},{f7(m)}'); A(f'REAL,{100+q}'); A(f'E,{i+1}')
    for i, t in sorted(fix.items()): A(f'D,{i+1},ALL,0' if t == 'ALL' else f'D,{i+1},UX,0,,,,UY,UZ')
    xb = [-p['width'] / 2] + XS[:0] + [-5, -3, -1, 1, 3, 5] + [p['width'] / 2]; xg = grid(xb, hs); nsol = 0
    for k_, pn in enumerate(('p1', 'p2')):
        yt, zt = G['pier_top'][k_]; zb = G['zbase'][pn]; yg = grid([yt - tp / 2, yt, yt + tp / 2], hs); zg = grid([zb, zt], hs)
        A(f'! --- pilar {pn}: muro de mamposteria {p["width"]} x {tp} m, {len(xg)-1} x {len(yg)-1} x {len(zg)-1} hexaedros'); idn = {}
        for a_, x in enumerate(xg):
            for b_, y in enumerate(yg):
                for c_, z in enumerate(zg): nid += 1; idn[(a_, b_, c_)] = nid; A(f'N,{nid},{f7(x)},{f7(y)},{f7(z)}')
        A('TYPE,3'); A('MAT,2')
        for a_ in range(len(xg) - 1):
            for b_ in range(len(yg) - 1):
                for c_ in range(len(zg) - 1):
                    q = [idn[(a_, b_, c_)], idn[(a_+1, b_, c_)], idn[(a_+1, b_+1, c_)], idn[(a_, b_+1, c_)], idn[(a_, b_, c_+1)], idn[(a_+1, b_, c_+1)], idn[(a_+1, b_+1, c_+1)], idn[(a_, b_+1, c_+1)]]
                    A('E,' + ','.join(map(str, q))); nsol += 1
        for a_ in range(len(xg)):
            for b_ in range(len(yg)): A(f'D,{idn[(a_, b_, 0)]},UX,0,,,,UY,UZ')
        top = len(zg) - 1
        for a_, x in enumerate(xg):
            xm = min(XS, key=lambda v: (abs(v - x), v))
            for b_ in range(len(yg)): A(f'CERIG,{tops[(pn, xm)] + 1},{idn[(a_, b_, top)]},UXYZ')
    NM = 12
    A('FINISH'); A('/SOLU'); A('ANTYPE,MODAL'); A(f'MODOPT,LANB,{NM}'); A(f'MXPAND,{NM},,,YES'); A('SOLVE'); A('FINISH')
    A('/POST1'); A('SET,LIST'); A(f'*DIM,FREQ,ARRAY,{NM}'); A(f'*DO,I,1,{NM}'); A('  *GET,FREQ(I),MODE,I,FREQ'); A('*ENDDO')
    A(f'*CFOPEN,frecuencias_material_{niv},txt'); A('*VWRITE'); A("('    Modo        f_Hz')"); A(f'*DO,I,1,{NM}'); A('*VWRITE,I,FREQ(I)'); A('(F8.0,F12.4)'); A('*ENDDO'); A('*CFCLOS')
    A('/RGB,INDEX,100,100,100,0'); A('/RGB,INDEX,0,0,0,15'); A('/PBC,ALL,,0'); A('ESEL,S,TYPE,,1'); A('ESEL,A,TYPE,,3'); A('/VUP,1,Z'); A('/VIEW,1,1,-1,0.6'); A('/ESHAPE,0'); A('/AUTO,1'); A('SET,1,1'); A('PLDISP,1')
    open(f'{out}/balta_3D_material_{niv}.mac', 'w', encoding='utf-8', newline='\r\n').write('\n'.join(S) + '\n')
    print(f'{niv}: nodos {nid}, vigas {nbeam}, hexaedros {nsol}')
print(f'masa no estructural del tablero {w_ns:.1f} kN/m (de {p["w_deck"]} kN/m)')
