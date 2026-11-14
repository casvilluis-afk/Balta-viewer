"""Lee balta_modelo3D.mac y resuelve el modal con un cálculo propio (Timoshenko 3D, área de cortante = A, G = E/2(1+ν)),
uniendo los elementos subdivididos en su barra original, para comprobar que el macro contiene el modelo esperado."""
import sys, math, numpy as np, scipy.sparse as sp
from scipy.sparse.linalg import eigsh
sys.argv += [] ; src = open(sys.argv[1], encoding='utf-8').read().replace('\r', '').split('\n')
N, EX, SEC, R, mass, fix, els = {}, {}, {}, {}, {}, [], []
typ = mat = sec = real = cur = None
for l in src:
    l = l.split('!')[0].strip()
    if not l: continue
    a = [x.strip() for x in l.split(',')]; c = a[0].upper()
    if c == 'N': N[int(a[1])] = tuple(float(v) for v in a[2:5])
    elif c == 'MP' and a[1] == 'EX': EX[int(a[2])] = float(a[3])
    elif c == 'SECTYPE': cur = int(a[1])
    elif c == 'SECDATA': SEC[cur] = [float(a[1]), float(a[2]), float(a[4]), float(a[6])]
    elif c == 'TYPE': typ = int(a[1])
    elif c == 'MAT': mat = int(a[1])
    elif c == 'SECNUM': sec = int(a[1])
    elif c == 'R': R[int(a[1])] = float(a[2])
    elif c == 'REAL': real = int(a[1])
    elif c == 'E':
        if typ == 1: els.append((int(a[1]), int(a[2]), int(a[3]) if len(a) > 3 else None, mat, sec))
        else: mass[int(a[1])] = R[real]
    elif c == 'D': fix.append((int(a[1]), a[2].upper()))
struct = sorted(mass)                                   # nodos con masa = nodos de la estructura
inner = {}; adj = {}
for e in els:
    for n in e[:2]:
        if n not in mass: adj.setdefault(n, []).append(e)
# reconstruir barras: seguir cadenas por nodos intermedios
bars, used = [], set()
for e in els:
    if id(e) in used or (e[0] not in mass): continue
    chain = [e]; used.add(id(e)); cur = e[1]
    while cur not in mass:
        nxt = [x for x in adj[cur] if id(x) not in used][0]; used.add(id(nxt)); chain.append(nxt); cur = nxt[1]
    bars.append((e[0], cur, e[2], e[3], e[4]))
ix = {n: k for k, n in enumerate(struct)}; nd = 6 * len(struct)
def kloc(E, A, Iy, Iz, J, L, nu=.3):
    Gs = E / (2 * (1 + nu)); k = np.zeros((12, 12)); ea, gj = E * A / L, Gs * J / L
    for (a, b, v) in [(0, 0, ea), (6, 6, ea), (0, 6, -ea), (3, 3, gj), (9, 9, gj), (3, 9, -gj)]: k[a, b] = k[b, a] = v
    py = 12 * E * Iz / (Gs * A * L * L); c = E * Iz / (L**3 * (1 + py)); d = [1, 5, 7, 11]
    k[np.ix_(d, d)] += c * np.array([[12, 6*L, -12, 6*L], [6*L, (4+py)*L*L, -6*L, (2-py)*L*L], [-12, -6*L, 12, -6*L], [6*L, (2-py)*L*L, -6*L, (4+py)*L*L]])
    pz = 12 * E * Iy / (Gs * A * L * L); c = E * Iy / (L**3 * (1 + pz)); d = [2, 4, 8, 10]
    k[np.ix_(d, d)] += c * np.array([[12, -6*L, -12, -6*L], [-6*L, (4+pz)*L*L, 6*L, (2-pz)*L*L], [-12, 6*L, 12, 6*L], [-6*L, (2-pz)*L*L, 6*L, (4+pz)*L*L]])
    return k
rows, cols, vals = [], [], []
for i, j, K, m, s in bars:
    a, b = np.array(N[i]), np.array(N[j]); L = np.linalg.norm(b - a); ex = (b - a) / L
    ref = np.array(N[K]) - a if K else (np.array([0, 0, 1.]) if abs(ex[2]) < .9 else np.array([0, 1., 0]))
    ez = ref - ref.dot(ex) * ex; ez /= np.linalg.norm(ez); T = np.kron(np.eye(4), np.vstack([ex, np.cross(ez, ex), ez]))
    A_, Iy, Iz, J = SEC[s]; kg = T.T @ kloc(EX[m], A_, Iy, Iz, J, L) @ T
    d = list(range(6 * ix[i], 6 * ix[i] + 6)) + list(range(6 * ix[j], 6 * ix[j] + 6))
    for p in range(12):
        for q in range(12): rows.append(d[p]); cols.append(d[q]); vals.append(kg[p, q])
K = sp.csr_matrix((vals, (rows, cols)), shape=(nd, nd)); K = (K + K.T) / 2; Md = np.zeros(nd)
for n, m in mass.items(): Md[6*ix[n]:6*ix[n]+3] = m; Md[6*ix[n]+3:6*ix[n]+6] = m * 1e-4
fx = set()
for n, t in fix: fx.update(range(6*ix[n], 6*ix[n] + (6 if t == 'ALL' else 3)))
free = np.array([g for g in range(nd) if g not in fx])
w = np.sort(eigsh(K[free][:, free].tocsc(), k=12, M=sp.diags(Md[free]), sigma=0, which='LM', return_eigenvectors=False))
f = np.sqrt(w) / (2 * np.pi)
ref = [float(l.split(',')[1]) for l in open(sys.argv[2], encoding='utf-8').read().split('\n')[1:] if l]
print(f'barras reconstruidas {len(bars)} (de {len(els)} elementos), nodos {len(struct)}, apoyos {len(fix)}')
for k in range(12): print(f'modo {k+1:2d}: macro {f[k]:8.4f} Hz   generador {ref[k]:8.4f} Hz   dif {100*(f[k]-ref[k])/ref[k]:+.4f} %')
