import os
"""Bloque B: dataset de identificación de daño a partir de datos modales medibles con 9 sensores en el tablero."""
import numpy as np, pandas as pd, time
from modelC import build, NOMINAL, FACES

HERE = os.path.dirname(os.path.abspath(__file__)) + os.sep
NM = 8          # modos usados
rng = np.random.default_rng(7)

fr0, meta0 = build(return_meta=True)
f0, phi0, _ = fr0.modal(NM)
ydeck = np.array(meta0['ydeck'])

# --- sensores: arranques/4, clave y 3/4 de cada vano (9 puntos verticales en el tablero)
spans = [(meta0['arch_nodes'][k][2][0], meta0['arch_nodes'][k][2][-1]) for k in range(3)]
sens_y = [a + r * (b - a) for a, b in spans for r in (0.25, 0.5, 0.75)]
sens_nodes = [meta0['deck_nodes'][min(meta0['ydeck'], key=lambda v: abs(v - y))] for y in sens_y]
sens_dof = [3 * n + 1 for n in sens_nodes]

# --- zonas de daño: 5 por arco + tablero por vano = 18
def zone_of_elements(fr, meta):
    z = np.full(len(fr.el), -1)
    names = []
    for ai, (k, ids, ys, zs) in enumerate(meta['arch_nodes']):
        a, b = ys[0], ys[-1]
        for zi, lab in enumerate(('arranque_izq', 'riñon_izq', 'clave', 'riñon_der', 'arranque_der')):
            names.append(f'arco_{k}_{lab}')
    for k in ('izq', 'centro', 'der'):
        names.append(f'tablero_{k}')
    mid = fr.X[fr.el].mean(axis=1)[:, 0]
    for j, g in enumerate(fr.grp):
        for ai, (k, ids, ys, zs) in enumerate(meta['arch_nodes']):
            a, b = ys[0], ys[-1]
            if g == f'arco_{k}':
                r = (mid[j] - a) / (b - a)
                z[j] = ai * 5 + min(int(r * 5), 4)
            if g == 'tablero' and a <= mid[j] <= b:
                z[j] = 15 + ai
    return z, names

zones, ZNAMES = zone_of_elements(fr0, meta0)
NZ = len(ZNAMES)


def features(f, phi):
    """Δf/f0 de NM modos (emparejados por MAC) + formas modales en sensores de los 4 primeros modos."""
    ps0 = phi0[sens_dof, :]; ps = phi[sens_dof, :]
    full0 = phi0; out_f, out_s = [], []
    for i in range(NM):
        macs = [(full0[:, i] @ phi[:, k])**2 / ((full0[:, i] @ full0[:, i]) * (phi[:, k] @ phi[:, k])) for k in range(NM)]
        j = int(np.argmax(macs))
        out_f.append((f[j] - f0[i]) / f0[i])
        if i < 4:
            v = ps[:, j]; v0 = ps0[:, i]
            v = v * np.sign(v @ v0) / np.abs(v).max()
            out_s.append(v)
    return np.r_[out_f], np.concatenate(out_s)


def sample(n_per_zone=260, n_undamaged=400, model_unc=0.05):
    rows = []
    jobs = [(-1, 0.0)] * n_undamaged + [(zz, None) for zz in range(NZ) for _ in range(n_per_zone)]
    t = time.time()
    for zz, sev in jobs:
        # incertidumbre residual del modelo calibrado (±5 %) en E del fierro y peso del tablero
        p = dict(E_ci=NOMINAL['E_ci'] * (1 + rng.normal(0, model_unc / 2)),
                 w_deck=NOMINAL['w_deck'] * (1 + rng.normal(0, model_unc / 2)))
        fr = build(p)
        d = 0.0 if zz < 0 else rng.uniform(0.05, 0.60)
        esc = np.ones(len(fr.el))
        if zz >= 0:
            esc[zones == zz] = 1 - d
        f, phi, _ = fr.modal(NM, escale=esc)
        df_, sh = features(f, phi)
        rows.append(dict(zona=zz, severidad=d, **{f'df{i+1}': v for i, v in enumerate(df_)},
                         **{f's{i}': v for i, v in enumerate(sh)}))
    print('simulaciones', len(rows), 'en', round(time.time() - t, 1), 's')
    return pd.DataFrame(rows)


if __name__ == '__main__':
    df = sample()
    df.to_csv(HERE + 'blockB_dataset.csv', index=False)
    print(df.groupby('zona').size().head(), ZNAMES[:5])
    import json; json.dump(dict(zonas=ZNAMES, sens_y=[float(v) for v in sens_y], f0=f0.tolist()), open(HERE + 'blockB_meta.json', 'w'), ensure_ascii=False)
