"""Escribe frecuencias_<nombre>.txt y modos_<nombre>.txt con el MISMO formato que deja el macro exportado por la app al correr en Ansys
(F8.0,F12.4 y F5.0,F7.0,3E16.7), resolviendo el modelo del .mac con numpy (pórtico 2D en Y-Z, masas concentradas, condensación de Guyan).
Sirve para probar la importación de resultados en la app sin Ansys a mano. NO son resultados de Ansys: cuando el usuario corra el macro en
Ansys, los archivos reales reemplazan a estos. Uso: python simular_salida_ansys.py modelo.mac carpeta_salida [--timoshenko]"""
import sys, os, numpy as np
from scipy.linalg import eigh
mac, outd = sys.argv[1], sys.argv[2]; TIMO = '--timoshenko' in sys.argv
L = open(mac, encoding='utf-8').read().replace('\r', '').split('\n')
EX, SEC, nodes, els, R, mass, fix = {}, {}, {}, [], {}, {}, []; mat = sec = typ = real = cur = None; nom = 'puente'; napp = None
for l in L:
    if l.startswith('*CFOPEN,frecuencias_'): nom = l.split('frecuencias_')[1].split(',')[0]
    if l.strip().startswith('*DO,K,1,'): napp = int(l.split(',')[-1])
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
ids = sorted(nodes); ix = {n: k for k, n in enumerate(ids)}; nd = 3 * len(ids); K = np.zeros((nd, nd)); M = np.zeros(nd)
for i, j, E, A, I in els:
    (y1, z1), (y2, z2) = nodes[i], nodes[j]; dy, dz = y2 - y1, z2 - z1; Lh = np.hypot(dy, dz); c, s = dy / Lh, dz / Lh
    ph = 12 * E * I / ((E / 2.6) * A * Lh ** 2) if TIMO else 0.0; EA, b = E * A / Lh, E * I / ((1 + ph) * Lh ** 3)
    k = np.array([[EA,0,0,-EA,0,0],[0,12*b,6*b*Lh,0,-12*b,6*b*Lh],[0,6*b*Lh,(4+ph)*b*Lh**2,0,-6*b*Lh,(2-ph)*b*Lh**2],
                  [-EA,0,0,EA,0,0],[0,-12*b,-6*b*Lh,0,12*b,-6*b*Lh],[0,6*b*Lh,(2-ph)*b*Lh**2,0,-6*b*Lh,(4+ph)*b*Lh**2]])
    T = np.zeros((6, 6)); T[0,:2] = [c, s]; T[1,:2] = [-s, c]; T[2,2] = 1; T[3:,3:] = T[:3,:3]
    d = [3*ix[i], 3*ix[i]+1, 3*ix[i]+2, 3*ix[j], 3*ix[j]+1, 3*ix[j]+2]; K[np.ix_(d, d)] += T.T @ k @ T
for n, (m, Ir) in mass.items(): M[3*ix[n]] = M[3*ix[n]+1] = m; M[3*ix[n]+2] = Ir
fx = set(3*ix[n] + {'UY':0,'UZ':1,'ROTX':2}[d] for n, d in fix); free = [g for g in range(nd) if g not in fx]
ms = [g for g in free if M[g] == 0]; mm = [g for g in free if M[g] > 0]
Kss = K[np.ix_(ms, ms)]; Ksm = K[np.ix_(ms, mm)]; X = np.linalg.solve(Kss, Ksm); K2 = K[np.ix_(mm, mm)] - Ksm.T @ X; K2 = .5 * (K2 + K2.T)
w2, V = eigh(K2, np.diag(M[mm])); o = np.argsort(w2)[:8]; f = np.sqrt(w2[o]) / (2 * np.pi)
U = np.zeros((nd, 8)); U[mm] = V[:, o]; U[ms] = -X @ V[:, o]
def E7(v):
    if v == 0: return '  0.0000000E+00'
    e = int(np.floor(np.log10(abs(v)))) + 1; m = abs(v) / 10 ** e
    if round(m * 1e7) >= 1e7: m /= 10; e += 1
    return ('  ' if v >= 0 else ' -') + '0.' + str(int(round(m * 1e7))).zfill(7) + 'E' + ('-' if e < 0 else '+') + str(abs(e)).zfill(2)
os.makedirs(outd, exist_ok=True); napp = napp or len(mass)
with open(os.path.join(outd, f'frecuencias_{nom}.txt'), 'w') as F:
    F.write('    Modo        f_Hz\n'); [F.write(f'{k+1:7d}.{f[k]:12.4f}\n') for k in range(8)]
with open(os.path.join(outd, f'modos_{nom}.txt'), 'w') as F:
    F.write(' Modo   Nodo              UY              UZ            ROTX\n')
    for k in range(8):
        for n in range(1, napp + 1): g = 3 * ix[n]; F.write(f'{k+1:4d}.{n:6d}.{E7(U[g,k])}{E7(U[g+1,k])}{E7(U[g+2,k])}\n')
print(nom, 'Timoshenko' if TIMO else 'Euler-Bernoulli', ' '.join(f'{v:.4f}' for v in f))
