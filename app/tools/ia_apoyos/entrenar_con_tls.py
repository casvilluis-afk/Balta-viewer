# Entrena la IA de apoyos con Corea + 20 TLS y la IA de estribos con los 20 TLS (modelos por pliegue y finales).
# Rasgos: node extraer_rasgos.js (Corea, en d/) y node extraer_rasgos_tls.js (TLS, en d9/ con clases crudas 0–8).
import numpy as np, glob, os, json
from sklearn.ensemble import RandomForestClassifier
NF=26;K=['Wonli','Ssanghak','Banwol','Ipbuk','Palgok','Seokdap'];T=sorted(os.path.basename(f)[:-4] for f in glob.glob('d9/*.f32'))
names=json.load(open('names.json'))
M3=np.array([255,0,0,0,1,1,1,0,2],np.uint8);MA=np.array([255,0,0,1,0,0,0,0,0],np.uint8)
D3={b:(np.fromfile(f'd/{b}.f32',np.float32).reshape(-1,NF),np.fromfile(f'd/{b}.y',np.uint8)) for b in K}
for b in T: D3[b]=(np.fromfile(f'd9/{b}.f32',np.float32).reshape(-1,NF),M3[np.fromfile(f'd9/{b}.y9',np.uint8)])
DA={b:(D3[b][0],MA[np.fromfile(f'd9/{b}.y9',np.uint8)]) for b in T}
def fit(D,bs,ms):
    X=np.vstack([D[b][0] for b in bs]);y=np.concatenate([D[b][1] for b in bs]);k=y<255
    return RandomForestClassifier(n_estimators=40,max_depth=14,min_samples_leaf=40,class_weight='balanced_subsample',n_jobs=2,random_state=0,max_samples=ms).fit(X[k],y[k])
def exp(m,clases,tr,path,extra={}):
    A=[]
    for e in m.estimators_:
        t=e.tree_;v=t.value[:,0,:];v=v/v.sum(1,keepdims=True)
        A.append({'f':t.feature.tolist(),'t':[round(float(x),5) for x in t.threshold],'l':t.children_left.tolist(),'r':t.children_right.tolist(),'v':[[round(float(a),3) for a in r] for r in v]})
    json.dump(dict({'clases':clases,'rasgos':names,'entrenado_con':tr,'arboles':A},**extra),open(path,'w'),separators=(',',':'))
os.makedirs('m26',exist_ok=True)
rng=np.random.default_rng(0);perm=list(rng.permutation(T));folds=[perm[i::5] for i in range(5)];json.dump(folds,open('m26/pliegues.json','w'))
for i,f in enumerate(folds):
    tr=K+[b for b in T if b not in f];exp(fit(D3,tr,80000),['fondo','tablero','apoyo'],tr,f'm26/apoyos_pliegue{i}.json')
    tr=[b for b in T if b not in f];exp(fit(DA,tr,80000),['otro','estribo'],tr,f'm26/estribos_pliegue{i}.json')
for b in K:
    tr=[o for o in K if o!=b]+T;exp(fit(D3,tr,80000),['fondo','tablero','apoyo'],tr,f'm26/apoyos_sin_{b}.json')
exp(fit(D3,K+T,80000),['fondo','tablero','apoyo'],K+T,'m26/apoyos_todo.json')
exp(fit(DA,T,80000),['otro','estribo'],T,'m26/estribos_todo.json')
print('listo',os.listdir('m26'))
