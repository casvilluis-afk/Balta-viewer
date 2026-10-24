"""IA de la plataforma sobre el modelo C (bloque B corregido).

Protocolo de blockB_ml.py: partición 70/30 estratificada (random_state=0), rasgos = Δf de 8 modos +
formas de 4 modos en 9 sensores, tres niveles de ruido (Δf, forma) = (0,2 %, 0,02), (0,5 %, 0,05), (1 %, 0,10).

Modelos de la plataforma (OE3):
  · SVM-RBF para localizar la zona (19 clases: sin daño + 18 zonas)
  · Random Forest para estimar la severidad (con la zona predicha, como en blockB_ml.py)
Se entrenan con las tres réplicas de ruido juntas y se evalúan en cada nivel por separado.
También se reproduce el RF clasificador del artículo para comparar.
"""
import json, numpy as np, pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.svm import SVC
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, f1_score, balanced_accuracy_score, mean_absolute_error

OUT = '/home/claude/balta-plataforma/site2/data/'
df = pd.read_csv('blockB_dataset_si.csv'); meta = json.load(open('blockB_meta_si.json'))
FCOL = [c for c in df.columns if c.startswith('df')]; SCOL = [c for c in df.columns if c.startswith('s') and c[1:].isdigit()]
COLS = FCOL + SCOL
span_of = lambda z: np.where(z < 0, -1, np.where(z >= 15, z - 15, z // 5))
tr, te = train_test_split(df, test_size=0.3, random_state=0, stratify=df.zona)
LEVELS = [(0.002, 0.02), (0.005, 0.05), (0.01, 0.10)]


def noisy(d, sf, ss, seed):
    r = np.random.default_rng(seed)
    return np.c_[d[FCOL].values + r.normal(0, sf, (len(d), len(FCOL))), d[SCOL].values + r.normal(0, ss, (len(d), len(SCOL)))]


Xtr = np.vstack([noisy(tr, sf, ss, 1 + k) for k, (sf, ss) in enumerate(LEVELS)])
ytr = np.tile(tr.zona.values, 3); sevtr = np.tile(tr.severidad.values, 3)
sc = StandardScaler().fit(Xtr); Ztr = sc.transform(Xtr)
svm = SVC(C=10, gamma='scale', decision_function_shape='ovo').fit(Ztr, ytr)
m = ytr >= 0
reg = RandomForestRegressor(n_estimators=60, max_depth=14, min_samples_leaf=2, random_state=0, n_jobs=-1).fit(np.c_[Xtr[m], np.eye(18)[ytr[m]]], sevtr[m])
rfc = RandomForestClassifier(n_estimators=400, n_jobs=-1, random_state=0)  # referencia del artículo, por nivel

res = {}
for k, (sf, ss) in enumerate(LEVELS):
    Xte = noisy(te, sf, ss, 100 + k); yt = te.zona.values; pz = svm.predict(sc.transform(Xte))
    dmg = yt >= 0
    sev = reg.predict(np.c_[Xte[dmg], np.eye(18)[np.clip(pz[dmg], 0, 17)]])
    r = dict(deteccion_bal=balanced_accuracy_score(yt >= 0, pz >= 0), falsa_alarma=float(np.mean(pz[~dmg] >= 0)),
             localizacion_acc=accuracy_score(yt, pz), localizacion_f1m=f1_score(yt, pz, average='macro'),
             vano_acc=accuracy_score(span_of(yt), span_of(pz)), severidad_MAE=mean_absolute_error(te.severidad.values[dmg], sev))
    for lo, hi in ((0.05, 0.15), (0.15, 0.30), (0.30, 0.61)):
        mm = (te.severidad.values >= lo) & (te.severidad.values < hi); r[f'loc_acc_d{int(lo*100)}-{int(hi*100)}'] = accuracy_score(yt[mm], pz[mm])
    # RF del artículo (entrenado y probado en el mismo nivel, como blockB_ml.py)
    Xa = noisy(tr, sf, ss, 1); Xb = noisy(te, sf, ss, 2)
    rfc.fit(Xa, tr.zona); pr = rfc.predict(Xb)
    r['rf_articulo_localizacion_acc'] = accuracy_score(te.zona, pr); r['rf_articulo_vano_acc'] = accuracy_score(span_of(te.zona.values), span_of(pr))
    if k == 1:
        cm = pd.crosstab(pd.Series(yt, name='real'), pd.Series(pz, name='pred')).reindex(index=range(-1, 18), columns=range(-1, 18), fill_value=0).values.tolist()
    res[f'{sf}_{ss}'] = r
    print(sf, ss, {a: round(b, 3) for a, b in r.items()})

# Fuera de dominio: distancia al vecino más cercano (submuestra de entrenamiento), umbral p99 con el ruido mayor
sub = Ztr[np.random.default_rng(0).choice(len(Ztr), 2500, replace=False)]
def nn(Z): return np.array([np.min(np.linalg.norm(sub - z, axis=1)) for z in Z])
thr = float(np.percentile(nn(sc.transform(noisy(te, *LEVELS[2], 300))), 99))
det = float(np.mean(nn(sc.transform(noisy(te, 0.03, 0.30, 301))) > thr))
print('svm vectores soporte', svm.support_vectors_.shape, 'ood', thr, det)

def tj(e):
    t = e.tree_; return dict(f=t.feature.tolist(), t=np.round(t.threshold, 5).tolist(), l=t.children_left.tolist(), r=t.children_right.tolist(), v=np.round(t.value[:, 0, 0], 4).tolist())

import modelC, blockB_data_original as B
from fe2d_modal_si import modal_si
_fr0 = modelC.build(); _f0, _phi0, _ = modal_si(_fr0, 8)
phi0_ref = _phi0[B.sens_dof, :4].T  # convención de signo de los modos de referencia usada en el dataset
json.dump(dict(phi0_sens_ref=np.round(phi0_ref, 8).tolist(), classes=svm.classes_.tolist(), mean=sc.mean_.tolist(), scale=sc.scale_.tolist(), gamma=float(svm._gamma),
               sv=np.round(svm.support_vectors_, 5).tolist(), nsv=svm.n_support_.tolist(), dual=np.round(svm.dual_coef_, 6).tolist(), b=svm.intercept_.tolist(),
               ood_threshold=thr, train=np.round(sub, 4).tolist(), zonas=meta['zonas'], f0=meta['f0'], sens_y=meta['sens_y'],
               severity_trees=[tj(e) for e in reg.estimators_]), open(OUT + 'ia_modelo_c.json', 'w'), separators=(',', ':'))
json.dump(dict(fecha='2026-10-23', datos=f'{len(df)} simulaciones del modelo C (bloque B, solver de desplazamiento-inversión); entrenamiento {len(tr)} × 3 niveles de ruido, prueba {len(te)}',
               rasgos='Δf de 8 modos + formas de 4 modos en 9 sensores del tablero (44 rasgos)', clasificador='SVM-RBF (C = 10, gamma = scale), 19 clases',
               severidad='Random Forest (60 árboles, profundidad 14) con la zona predicha', por_ruido=res, confusion_ruido_medio=dict(labels=list(range(-1, 18)), m=cm),
               fuera_de_dominio=dict(umbral=thr, deteccion_ruido_3pct=det, metodo='vecino más cercano, percentil 99 con el ruido mayor')),
          open(OUT + 'metrics_ia_c.json', 'w'), indent=1, ensure_ascii=False)
