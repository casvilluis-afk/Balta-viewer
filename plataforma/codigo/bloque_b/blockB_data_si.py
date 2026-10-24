"""Bloque B con el solver modal corregido (desplazamiento-inversión). Idéntico a blockB_data.py salvo:
fr.modal(...) → modal_si(fr, ...). Misma semilla (7), mismas zonas, sensores y rangos."""
import numpy as np, pandas as pd, time, json, sys
import modelC
from modelC import build, NOMINAL
from fe2d_modal_si import modal_si
import blockB_data_original as B   # reutiliza zone_of_elements y la definición de sensores

NM = B.NM
rng = np.random.default_rng(7)
fr0, meta0 = build(return_meta=True)
f0, phi0, _ = modal_si(fr0, NM)
sens_dof = B.sens_dof; zones = B.zones; ZNAMES = B.ZNAMES; NZ = len(ZNAMES)

def features(f, phi):
    ps0 = phi0[sens_dof, :]; ps = phi[sens_dof, :]; out_f, out_s = [], []
    for i in range(NM):
        macs = [(phi0[:, i] @ phi[:, k])**2 / ((phi0[:, i] @ phi0[:, i]) * (phi[:, k] @ phi[:, k])) for k in range(NM)]
        j = int(np.argmax(macs)); out_f.append((f[j] - f0[i]) / f0[i])
        if i < 4:
            v = ps[:, j]; v0 = ps0[:, i]; v = v * np.sign(v @ v0) / np.abs(v).max(); out_s.append(v)
    return np.r_[out_f], np.concatenate(out_s)

def sample(n_per_zone=260, n_undamaged=400, model_unc=0.05):
    rows = []; jobs = [(-1, 0.0)] * n_undamaged + [(zz, None) for zz in range(NZ) for _ in range(n_per_zone)]; t = time.time()
    for n, (zz, sev) in enumerate(jobs):
        p = dict(E_ci=NOMINAL['E_ci'] * (1 + rng.normal(0, model_unc / 2)), w_deck=NOMINAL['w_deck'] * (1 + rng.normal(0, model_unc / 2)))
        fr = build(p); d = 0.0 if zz < 0 else rng.uniform(0.05, 0.60)
        esc = np.ones(len(fr.el))
        if zz >= 0: esc[zones == zz] = 1 - d
        f, phi, _ = modal_si(fr, NM, escale=esc); df_, sh = features(f, phi)
        rows.append(dict(zona=zz, severidad=d, E_ci=p['E_ci'], w_deck=p['w_deck'], **{f'df{i+1}': v for i, v in enumerate(df_)}, **{f's{i}': v for i, v in enumerate(sh)}))
        if n % 500 == 0: print(n, round(time.time() - t, 1), 's', flush=True)
    return pd.DataFrame(rows)

if __name__ == '__main__':
    df = sample(); df.to_csv('blockB_dataset_si.csv', index=False)
    json.dump(dict(zonas=ZNAMES, sens_y=[float(v) for v in B.sens_y], f0=f0.tolist(), solver='modal_si (shift-invert)'), open('blockB_meta_si.json', 'w'), ensure_ascii=False)
    print('listo', len(df))
