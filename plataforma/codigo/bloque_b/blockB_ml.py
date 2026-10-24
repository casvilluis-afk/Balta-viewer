import os
import numpy as np, pandas as pd, json
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, balanced_accuracy_score

HERE = os.path.dirname(os.path.abspath(__file__)) + os.sep
df = pd.read_csv(HERE + 'blockB_dataset.csv')
meta = json.load(open(HERE + 'blockB_meta.json'))
FCOL = [c for c in df.columns if c.startswith('df')]
import re
SCOL = [c for c in df.columns if re.fullmatch(r's\d+', c)]   # corregido: antes incluía 'severidad' (fuga del objetivo)
span_of = lambda z: np.where(z < 0, -1, np.where(z >= 15, z - 15, z // 5))

tr, te = train_test_split(df, test_size=0.3, random_state=0, stratify=df.zona)


def noisy(d, sf, ss, seed):
    r = np.random.default_rng(seed)
    X = d[FCOL].values + r.normal(0, sf, (len(d), len(FCOL)))
    S = d[SCOL].values + r.normal(0, ss, (len(d), len(SCOL)))
    return X, S


rows = []
for (sf, ss) in [(0.002, 0.02), (0.005, 0.05), (0.01, 0.10)]:
    for feat in ('frecuencias', 'frecuencias+formas'):
        Xtr_f, Str = noisy(tr, sf, ss, 1); Xte_f, Ste = noisy(te, sf, ss, 2)
        Xtr = Xtr_f if feat == 'frecuencias' else np.c_[Xtr_f, Str]
        Xte = Xte_f if feat == 'frecuencias' else np.c_[Xte_f, Ste]
        for name, clf in (('RF', RandomForestClassifier(n_estimators=400, n_jobs=-1, random_state=0)),
                          ('MLP', make_pipeline(StandardScaler(), MLPClassifier(hidden_layer_sizes=(128, 64), max_iter=800, early_stopping=True, random_state=0)))):
            clf.fit(Xtr, tr.zona); pz = clf.predict(Xte)
            det_true = te.zona.values >= 0; det_pred = pz >= 0
            res = dict(ruido_f=sf, ruido_forma=ss, rasgos=feat, modelo=name,
                       deteccion_bal=balanced_accuracy_score(det_true, det_pred),
                       falsa_alarma=float(np.mean(det_pred[~det_true])),
                       localizacion_acc=accuracy_score(te.zona, pz),
                       localizacion_f1m=f1_score(te.zona, pz, average='macro'),
                       vano_acc=accuracy_score(span_of(te.zona.values), span_of(pz)))
            for lo, hi in ((0.05, 0.15), (0.15, 0.30), (0.30, 0.61)):
                m = (te.severidad.values >= lo) & (te.severidad.values < hi)
                res[f'loc_acc_d{int(lo*100)}-{int(hi*100)}'] = accuracy_score(te.zona.values[m], pz[m])
            # severidad (solo dañados)
            mtr = tr.zona.values >= 0; mte = te.zona.values >= 0
            reg = RandomForestRegressor(n_estimators=400, n_jobs=-1, random_state=0) if name == 'RF' else \
                make_pipeline(StandardScaler(), MLPRegressor(hidden_layer_sizes=(128, 64), max_iter=800, early_stopping=True, random_state=0))
            Xr_tr = np.c_[Xtr[mtr], np.eye(18)[tr.zona.values[mtr]]]
            Xr_te = np.c_[Xte[mte], np.eye(18)[np.clip(pz[mte], 0, 17)]]   # usa la zona predicha
            reg.fit(Xr_tr, tr.severidad.values[mtr])
            res['severidad_MAE'] = mean_absolute_error(te.severidad.values[mte], reg.predict(Xr_te))
            rows.append(res)
            print({k: (round(v, 3) if isinstance(v, float) else v) for k, v in res.items()})
out = pd.DataFrame(rows)
out.to_csv(HERE + 'blockB_results.csv', index=False)
print('SCOL', len(SCOL), SCOL[:3])
