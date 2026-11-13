"""Lee el macro APDL generado y resuelve el problema modal con numpy (viga de Euler-Bernoulli 2D en Y-Z, masas concentradas),
para comprobar que el archivo que se entrega a Ansys contiene exactamente el modelo de la app (nodos, conectividad, secciones,
masas y apoyos). No reemplaza a Ansys: verifica el contenido del archivo, no la sintaxis."""
import sys, re, numpy as np
from scipy.linalg import eigh
L = open(sys.argv[1], encoding='utf-8').read().replace('\r', '').split('\n')
EX, SEC, nodes, els, R, mass, fix = {}, {}, {}, [], {}, {}, []
mat = sec = typ = real = None; cur = None
for l in L:
    l = l.split('!')[0].strip()
    if not l: continue
    a = [x.strip() for x in l.split(',')]; c = a[0].upper()
    if c == 'MP' and a[1].upper() == 'EX': EX[int(a[2])] = float(a[3])
    elif c == 'SECTYPE': cur = int(a[1])
    elif c == 'SECDATA': SEC[cur] = (float(a[1]), float(a[2]))
    elif c == 'N': nodes[int(a[1])] = (float(a[3]), float(a[4]))
    elif c == 'TYPE': typ = int(a[1])
    elif c == 'MAT': mat = int(a[1])
    elif c == 'SECNUM': sec = int(a[1])
    elif c == 'R': R[int(a[1])] = (float(a[2]), float(a[5]))
    elif c == 'REAL': real = int(a[1])
    elif c == 'E':
        if typ == 1: els.append((int(a[1]), int(a[2]), EX[mat], *SEC[sec]))
        else: mass[int(a[1])] = R[real]
    elif c == 'D' and a[1].upper() != 'ALL': fix.append((int(a[1]), a[2].upper()))
ids = sorted(nodes); ix = {n: k for k, n in enumerate(ids)}; nd = 3 * len(ids)
K = np.zeros((nd, nd)); M = np.zeros(nd)
for i, j, E, A, I in els:
    (y1, z1), (y2, z2) = nodes[i], nodes[j]; dy, dz = y2 - y1, z2 - z1; Lh = np.hypot(dy, dz); c, s = dy / Lh, dz / Lh
    EA, EI = E * A / Lh, E * I
    k = np.array([[EA,0,0,-EA,0,0],[0,12*EI/Lh**3,6*EI/Lh**2,0,-12*EI/Lh**3,6*EI/Lh**2],[0,6*EI/Lh**2,4*EI/Lh,0,-6*EI/Lh**2,2*EI/Lh],
                  [-EA,0,0,EA,0,0],[0,-12*EI/Lh**3,-6*EI/Lh**2,0,12*EI/Lh**3,-6*EI/Lh**2],[0,6*EI/Lh**2,2*EI/Lh,0,-6*EI/Lh**2,4*EI/Lh]])
    T = np.zeros((6, 6)); T[0,:2] = [c, s]; T[1,:2] = [-s, c]; T[2,2] = 1; T[3:,3:] = T[:3,:3]
    d = [3*ix[i], 3*ix[i]+1, 3*ix[i]+2, 3*ix[j], 3*ix[j]+1, 3*ix[j]+2]; K[np.ix_(d, d)] += T.T @ k @ T
for n, (m, Ir) in mass.items(): M[3*ix[n]] = M[3*ix[n]+1] = m; M[3*ix[n]+2] = Ir
fx = set(3*ix[n] + {'UY':0,'UZ':1,'ROTX':2}[d] for n, d in fix)
free = [g for g in range(nd) if g not in fx]
Kf = K[np.ix_(free, free)]; Kf = .5 * (Kf + Kf.T)
# problema mal condicionado (masas rotacionales 1e-4 m): se resuelve completo, no por subconjunto, para que sea exacto
w2 = np.sort(eigh(Kf, np.diag(M[free]), eigvals_only=True))[:8]
f = np.sqrt(w2) / (2 * np.pi)
ref = [float(x.split(',')[1]) for x in open(sys.argv[2]).read().split('\n')[1:] if x]
print('nodos', len(ids), 'vigas', len(els), 'masas', len(mass), 'restricciones', len(fix))
for k, (a, b) in enumerate(zip(f, ref)): print(f'modo {k+1}: archivo {a:8.4f} Hz   app {b:8.4f} Hz   dif {100*(a-b)/b:+.4f} %')
