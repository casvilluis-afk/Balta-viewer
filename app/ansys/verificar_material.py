"""Control independiente de los macros 3D (con o sin densidad de material; masa consistente de vigas y hexaedros): relee el macro tal cual (vigas subdivididas, hexaedros, masas, apoyos y
regiones rígidas) y resuelve el modal. Vigas de Timoshenko (área de cortante = A, como BEAM188 con ASEC); hexaedros de 8 nodos con
integración completa 2×2×2 (SOLID185 usa B-bar: se esperan diferencias pequeñas, no exactitud); regiones rígidas como restricción
exacta u_esclavo = u_maestro + θ_maestro × r."""
import sys, numpy as np, scipy.sparse as sp
ROT = 0.0 if 'KEYOPT,2,3,2' in open(sys.argv[1], encoding='utf-8').read() else 1.0
from scipy.sparse.linalg import eigsh
L = open(sys.argv[1], encoding='utf-8').read().replace('\r', '').split('\n')
N, EX, NU, RHO, SEC, R, mass, fix, beams, hexa, cer = {}, {}, {}, {}, {}, {}, {}, [], [], [], []
typ = mat = sec = real = cur = None
for l in L:
    l = l.split('!')[0].strip()
    if not l: continue
    a = [x.strip() for x in l.split(',')]; c = a[0].upper()
    if c == 'N': N[int(a[1])] = np.array([float(v) for v in a[2:5]])
    elif c == 'MP': {'EX': EX, 'PRXY': NU, 'DENS': RHO}[a[1]][int(a[2])] = float(a[3])
    elif c == 'SECTYPE': cur = int(a[1])
    elif c == 'SECDATA': SEC[cur] = [float(a[1]), float(a[2]), float(a[4]), float(a[6])]
    elif c == 'TYPE': typ = int(a[1])
    elif c == 'MAT': mat = int(a[1])
    elif c == 'SECNUM': sec = int(a[1])
    elif c == 'R': R[int(a[1])] = float(a[2])
    elif c == 'REAL': real = int(a[1])
    elif c == 'E':
        q = [int(v) for v in a[1:]]
        if typ == 1: beams.append((q[0], q[1], q[2] if len(q) > 2 else None, mat, sec))
        elif typ == 2: mass[q[0]] = R[real]
        else: hexa.append((q, mat))
    elif c == 'D': fix.append((int(a[1]), a[2].upper()))
    elif c == 'CERIG': cer.append((int(a[1]), int(a[2])))
used = set(n for b in beams for n in b[:2]) | set(n for h, _ in hexa for n in h) | set(mass)
ids = sorted(used); ix = {n: k for k, n in enumerate(ids)}; nd = 6 * len(ids)
def kbeam(E, nu, A, Iy, Iz, J, L):
    Gs = E / (2 * (1 + nu)); k = np.zeros((12, 12)); ea, gj = E * A / L, Gs * J / L
    for (p, q, v) in [(0, 0, ea), (6, 6, ea), (0, 6, -ea), (3, 3, gj), (9, 9, gj), (3, 9, -gj)]: k[p, q] = k[q, p] = v
    py = 12 * E * Iz / (Gs * A * L * L); c = E * Iz / (L**3 * (1 + py)); d = [1, 5, 7, 11]
    k[np.ix_(d, d)] += c * np.array([[12, 6*L, -12, 6*L], [6*L, (4+py)*L*L, -6*L, (2-py)*L*L], [-12, -6*L, 12, -6*L], [6*L, (2-py)*L*L, -6*L, (4+py)*L*L]])
    pz = 12 * E * Iy / (Gs * A * L * L); c = E * Iy / (L**3 * (1 + pz)); d = [2, 4, 8, 10]
    k[np.ix_(d, d)] += c * np.array([[12, -6*L, -12, -6*L], [-6*L, (4+pz)*L*L, 6*L, (2-pz)*L*L], [-12, 6*L, 12, 6*L], [-6*L, (2-pz)*L*L, 6*L, (4+pz)*L*L]])
    return k
g = 1 / np.sqrt(3); NAT = np.array([[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]])
def khex(xyz, E, nu):
    lam, mu = E * nu / ((1 + nu) * (1 - 2 * nu)), E / (2 * (1 + nu)); D = np.zeros((6, 6)); D[:3, :3] = lam; D[np.arange(3), np.arange(3)] += 2 * mu; D[3:, 3:] = mu * np.eye(3)
    k = np.zeros((24, 24))
    for gp in NAT * g:
        dN = 0.125 * NAT * np.array([(1 + NAT[:, 1] * gp[1]) * (1 + NAT[:, 2] * gp[2]), (1 + NAT[:, 0] * gp[0]) * (1 + NAT[:, 2] * gp[2]), (1 + NAT[:, 0] * gp[0]) * (1 + NAT[:, 1] * gp[1])]).T
        Jm = dN.T @ xyz; dX = dN @ np.linalg.inv(Jm).T; B = np.zeros((6, 24))
        for a_ in range(8):
            x, y, z = dX[a_]; B[0, 3*a_] = x; B[1, 3*a_+1] = y; B[2, 3*a_+2] = z
            B[3, 3*a_] = y; B[3, 3*a_+1] = x; B[4, 3*a_+1] = z; B[4, 3*a_+2] = y; B[5, 3*a_] = z; B[5, 3*a_+2] = x
        k += B.T @ D @ B * np.linalg.det(Jm)
    return k
# ensamblaje por bloques: los términos se guardan en arreglos numpy y cada ~4 millones se suman a la matriz dispersa
# (con listas de Python la malla extrafina, 115 000 nodos, no cabía en memoria)
class Acum:
    def __init__(s): s.r, s.c, s.v, s.n, s.S = [], [], [], 0, None
    def add(s, d, k):
        d = np.asarray(d, dtype=np.int32); nz = k != 0; I, J = np.nonzero(nz)
        s.r.append(d[I]); s.c.append(d[J]); s.v.append(k[nz]); s.n += len(I)
        if s.n > 4_000_000: s.flush()
    def flush(s):
        if not s.r: return
        B = sp.csr_matrix((np.concatenate(s.v), (np.concatenate(s.r), np.concatenate(s.c))), shape=(nd, nd))
        s.S = B if s.S is None else s.S + B; s.r, s.c, s.v, s.n = [], [], [], 0
    def mat(s): s.flush(); return s.S if s.S is not None else sp.csr_matrix((nd, nd))
AK, AM = Acum(), Acum()
def add(d, k, M=False): (AM if M else AK).add(d, k)
def mbeam(rho, A, Iy, Iz, L):
    m = np.zeros((12, 12)); c = rho * A * L
    for (p, q, v) in [(0, 0, c/3), (6, 6, c/3), (0, 6, c/6), (3, 3, rho*(Iy+Iz)*L/3), (9, 9, rho*(Iy+Iz)*L/3), (3, 9, rho*(Iy+Iz)*L/6)]: m[p, q] = m[q, p] = v
    H = c / 420 * np.array([[156, 22*L, 54, -13*L], [22*L, 4*L*L, 13*L, -3*L*L], [54, 13*L, 156, -22*L], [-13*L, -3*L*L, -22*L, 4*L*L]])
    d = [1, 5, 7, 11]; m[np.ix_(d, d)] += H
    S_ = np.diag([1, -1, 1, -1]); d = [2, 4, 8, 10]; m[np.ix_(d, d)] += S_ @ H @ S_
    return m
def mhex(xyz, rho):
    m = np.zeros((8, 8))
    for gp in NAT * g:
        Nn = 0.125 * (1 + NAT[:, 0] * gp[0]) * (1 + NAT[:, 1] * gp[1]) * (1 + NAT[:, 2] * gp[2])
        dN = 0.125 * NAT * np.array([(1 + NAT[:, 1] * gp[1]) * (1 + NAT[:, 2] * gp[2]), (1 + NAT[:, 0] * gp[0]) * (1 + NAT[:, 2] * gp[2]), (1 + NAT[:, 0] * gp[0]) * (1 + NAT[:, 1] * gp[1])]).T
        m += rho * np.outer(Nn, Nn) * np.linalg.det(dN.T @ xyz)
    return np.kron(m, np.eye(3))
for i, j, K, m, s in beams:
    a, b = N[i], N[j]; Ln = np.linalg.norm(b - a); ex = (b - a) / Ln
    ref = N[K] - a if K else (np.array([0, 0, 1.]) if abs(ex[2]) < .9 else np.array([0, 1., 0]))
    ez = ref - ref.dot(ex) * ex; ez /= np.linalg.norm(ez); T = np.kron(np.eye(4), np.vstack([ex, np.cross(ez, ex), ez]))
    A_, Iy, Iz, J = SEC[s]; dd = list(range(6*ix[i], 6*ix[i]+6)) + list(range(6*ix[j], 6*ix[j]+6)); add(dd, T.T @ kbeam(EX[m], NU.get(m, .3), A_, Iy, Iz, J, Ln) @ T)
    if RHO.get(m, 0) > 0: add(dd, T.T @ mbeam(RHO[m], A_, Iy, Iz, Ln) @ T, True)
for q, m in hexa:
    dd = [6 * ix[n] + c for n in q for c in range(3)]; xyz = np.array([N[n] for n in q]); add(dd, khex(xyz, EX[m], NU.get(m, .3)))
    if RHO.get(m, 0) > 0: add(dd, mhex(xyz, RHO[m]), True)
K = AK.mat(); K = (K + K.T) / 2
Md = np.zeros(nd)
for n, m in mass.items(): Md[6*ix[n]:6*ix[n]+3] = m; Md[6*ix[n]+3:6*ix[n]+6] = m * 1e-4 * ROT
Mc = AM.mat() + sp.diags(Md)
# grados de libertad: fijos, rotaciones de nodos solo-sólido, y esclavos de regiones rígidas
beamn = set(n for b in beams for n in b[:2]) | set(mass); fx = set()
for n, t in fix: fx.update(range(6*ix[n], 6*ix[n] + (6 if t == 'ALL' else 3)))
for n in ids:
    if n not in beamn: fx.update(range(6*ix[n] + 3, 6*ix[n] + 6))
slave = {s: m for m, s in cer}
keepd = [d for d in range(nd) if d not in fx and not (ids[d // 6] in slave and d % 6 < 3)]
col = {d: k for k, d in enumerate(keepd)}; tr, tc, tv = [], [], []
for d in keepd: tr.append(d); tc.append(col[d]); tv.append(1.0)
for s, m in slave.items():
    r = N[s] - N[m]; bs, bm = 6 * ix[s], 6 * ix[m]
    # u_s = u_m + θ × r
    rows = {0: [(0, 1), (4, r[2]), (5, -r[1])], 1: [(1, 1), (5, r[0]), (3, -r[2])], 2: [(2, 1), (3, r[1]), (4, -r[0])]}
    for c_, terms in rows.items():
        for dm, v in terms:
            if bm + dm in col: tr.append(bs + c_); tc.append(col[bm + dm]); tv.append(v)
T = sp.csr_matrix((tv, (tr, tc)), shape=(nd, len(keepd)))
Kr = (T.T @ K @ T).tocsc(); Mr = (T.T @ Mc @ T).tocsc()
try:  # PARDISO (pypardiso) factoriza mallas grandes con mucha menos memoria que SuperLU
    import pypardiso; from scipy.sparse.linalg import LinearOperator
    _ps = pypardiso.PyPardisoSolver(); _ps.set_matrix_type(2); Kp = sp.triu(Kr).tocsr(); _ps.factorize(Kp)
    OPi = LinearOperator(Kr.shape, matvec=lambda x: _ps.solve(Kp, np.asarray(x).reshape(-1)), dtype=float)
    w = eigsh(Kr, k=12, M=Mr, sigma=0, which='LM', OPinv=OPi, return_eigenvectors=False)
except ImportError:
    w = eigsh(Kr, k=12, M=Mr, sigma=0, which='LM', return_eigenvectors=False)
w = np.sort(w); f = np.sqrt(w) / (2 * np.pi)
ref = [float(l.split(',')[1]) for l in open(sys.argv[2], encoding='utf-8').read().split('\n')[1:] if l] if len(sys.argv) > 2 else [float('nan')] * 12
print(f'vigas {len(beams)}, hexaedros {len(hexa)}, regiones rígidas {len(cer)}, nodos {len(ids)}')
for k in range(12): print(f'modo {k+1:2d}: sólido {f[k]:8.4f} Hz   barras {ref[k]:8.4f} Hz   dif {100*(f[k]-ref[k])/ref[k]:+.2f} %')
with open(sys.argv[1].replace('.mac', '_control.csv'), 'w', encoding='utf-8') as fh:
    fh.write('modo,f_control_Hz,f_pilares_de_barras_Hz\n'); [fh.write(f'{k+1},{f[k]:.4f},{ref[k]:.4f}\n') for k in range(12)]
