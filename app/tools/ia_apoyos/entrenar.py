# Entrena el bosque aleatorio de apoyos y lo exporta a JSON para la app.
# uso: python3 entrenar.py <carpeta con NOMBRE.f32 y NOMBRE.y> <salida.json>
# Imprime la validación dejando un puente fuera (IoU por clase).
import sys, json, numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import confusion_matrix
D, OUT = sys.argv[1], sys.argv[2]
B = ['Wonli', 'Ssanghak', 'Banwol', 'Ipbuk', 'Palgok', 'Seokdap']; NF = 26
data = {b: (np.fromfile(f'{D}/{b}.f32', np.float32).reshape(-1, NF), np.fromfile(f'{D}/{b}.y', np.uint8)) for b in B}
mk = lambda: RandomForestClassifier(n_estimators=40, max_depth=14, min_samples_leaf=40, class_weight='balanced_subsample', n_jobs=2, random_state=0, max_samples=60000)
tot = np.zeros((3, 3), int)
for b in B:
    X = np.vstack([data[o][0] for o in B if o != b]); y = np.concatenate([data[o][1] for o in B if o != b])
    tot += confusion_matrix(data[b][1], mk().fit(X, y).predict(data[b][0]), labels=[0, 1, 2])
print('IoU fondo %.2f tablero %.2f apoyo %.2f' % tuple(tot[k, k] / (tot[k].sum() + tot[:, k].sum() - tot[k, k]) for k in range(3)))
m = mk().fit(np.vstack([data[b][0] for b in B]), np.concatenate([data[b][1] for b in B]))
A = []
for e in m.estimators_:
    t = e.tree_; v = t.value[:, 0, :]; v = v / v.sum(1, keepdims=True)
    A.append({'f': t.feature.tolist(), 't': [round(float(x), 5) for x in t.threshold], 'l': t.children_left.tolist(), 'r': t.children_right.tolist(), 'v': [[round(float(a), 3) for a in r] for r in v]})
json.dump({'clases': ['fondo', 'tablero', 'apoyo'], 'entrenado_con': B, 'arboles': A}, open(OUT, 'w'), separators=(',', ':'))
