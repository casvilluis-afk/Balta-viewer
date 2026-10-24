"""Modelo C con la geometría de arcos del modelo anterior (salidas_04).

Pregunta: ¿cuánto cambia la respuesta modal si el modelo C usa el perfil de arcos del
modelo 2D anterior en vez del ajustado a la nube TLS? Todo lo demás (material, masas,
pilares, tablero, caras de pilares medidas) se mantiene igual.

Definición (documentada): los nodos de arco del modelo anterior son el EJE del nervio.
Su perfil se lleva a cada luz medida con la coordenada normalizada
    ξ = (y − a_ant) / (b_ant − a_ant),   y_C = a_C + ξ (b_C − a_C)
y se convierte a intradós restando rib_h/2 (modelC.build vuelve a sumar rib_h/2).
Así se conservan las cotas de arranque y la flecha del modelo anterior, y solo se
compara el perfil vertical.
"""
import json, numpy as np
from scipy.sparse import csc_matrix, diags
from scipy.sparse.linalg import eigsh
import modelC as C

GROUPS = {'izq': 'arco_A1_A2', 'centro': 'arco_A2_A3', 'der': 'arco_A3_A4'}


def old_arches(path):
    """Perfiles de arco del modelo anterior desde scenario-model.json (o modelo_2d.json)."""
    M = json.load(open(path)); nid = {n['id']: n for n in M['nodes']}; out = {}
    for k, g in GROUPS.items():
        ids = {i for e in M['elements'] if e['group'] == g for i in (e['i'], e['j'])}
        P = sorted((nid[i]['x'], nid[i]['z']) for i in ids)
        out[k] = (np.array([p[0] for p in P]), np.array([p[1] for p in P]))
    return out


def curves_from_old(old, p=None):
    p = {**C.NOMINAL, **(p or {})}; cur = {}
    for k, a, b, _ in C.arch_curves(p):
        y, z = old[k]
        cur[k] = (a, b, (lambda yy, y=y, z=z, a=a, b=b:
                         np.interp(y[0] + (np.asarray(yy, float) - a) / (b - a) * (y[-1] - y[0]), y, z) - p['rib_h'] / 2))
    return cur


def modal(fr, n=6):
    K = fr.K()[np.ix_(fr.free, fr.free)]; K = csc_matrix(0.5 * (K + K.T)); m = fr.Mdiag[fr.free]
    lam, _ = eigsh(K, k=n, M=diags(m), sigma=0)
    return np.sqrt(np.sort(lam)) / (2 * np.pi)


if __name__ == '__main__':
    import sys
    old = old_arches(sys.argv[1] if len(sys.argv) > 1 else 'scenario-model.json')
    f_m = modal(C.build()); f_a = modal(C.build(curves=curves_from_old(old)))
    for k, (y, z) in old.items():
        print(f'{k}: anterior y {y[0]:.2f}–{y[-1]:.2f} m, eje z arranques {z[0]:.2f}/{z[-1]:.2f} m, máx {z.max():.2f} m')
    print('geometría medida  f1–f6:', np.round(f_m, 3))
    print('geometría anterior f1–f6:', np.round(f_a, 3))
    print('cambio en f1: {:+.1f} %'.format(100 * (f_a[0] / f_m[0] - 1)))
