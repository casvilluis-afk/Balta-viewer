"""Entrena y exporta los modelos de IA de la plataforma.
A) Sustituto RF con escalamiento físico (u·E/q y σ/q), sobre los 450 casos FEM OpenSees con carga.
B) Clasificador inverso SVM-RBF (dónde está el daño) + RF de severidad, sobre una campaña del solver 2D verificado."""
import json, numpy as np, pandas as pd, solver2d as S
from sklearn.ensemble import RandomForestRegressor
from sklearn.svm import SVC
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_absolute_error, accuracy_score, f1_score, confusion_matrix
OUT='../data/'
T=['sin_danio','arco_a1_a2','arco_a2_a3','arco_a3_a4','tablero','pilares','montantes']
def tj(e):
    t=e.tree_; return dict(f=t.feature.tolist(),t=np.round(t.threshold,6).tolist(),l=t.children_left.tolist(),r=t.children_right.tolist(),v=np.round(t.value[:,:,0],6).tolist())
def r2m(Y,P,K): return {k:dict(r2=float(r2_score(Y[:,i],P[:,i])),mae=float(mean_absolute_error(Y[:,i],P[:,i]))) for i,k in enumerate(K)}
# ---------------- A ----------------
d=pd.read_csv('../../data/fem-original/dataset.csv',encoding='utf-8-sig')
d=d[d.q_kN_m>0].reset_index(drop=True)
YK=['u_total_max_mm','max_sigma_MPa','max_sigma_tablero_MPa','max_sigma_pilar_MPa']
Y=d[YK].values; q=d.q_kN_m.values; E=d.E_GPa.values
Xd=np.array([[r.damage_pct]+[1.0*(r.damage_target==k) for k in T[1:]] for r in d.itertuples()])
Xn=np.c_[q,E,Xd]                                   # RF directo (ingenuo)
scale=np.c_[q/E, q, q, q]                           # física lineal: u ∝ q/E, σ ∝ q
Z=Y/scale
def fit_phys(idx): return RandomForestRegressor(n_estimators=40,max_depth=10,random_state=42).fit(Xd[idx],Z[idx])
def fit_naive(idx): return RandomForestRegressor(n_estimators=40,max_depth=10,random_state=42).fit(Xn[idx],Y[idx])
ia=np.arange(len(d)); tr,te=train_test_split(ia,test_size=0.2,random_state=42)
res={}
for name,mtr,mte in [('aleatorio_80_20',tr,te)]+[(f'sin_q{v}',ia[q!=v],ia[q==v]) for v in [75,150]]+[('sin_E50',ia[E!=50],ia[E==50])]:
    p=fit_phys(mtr).predict(Xd[mte])*scale[mte]; n=fit_naive(mtr).predict(Xn[mte])
    res[name]=dict(fisico=r2m(Y[mte],p,YK),directo=r2m(Y[mte],n,YK),n_test=int(len(mte)))
final=fit_phys(ia)
json.dump(dict(features=['damage_pct']+['t_'+k for k in T[1:]],outputs=YK,scaling=['q/E','q','q','q'],
   domain=dict(q=[25,200],E=[40,60],pct=[0,0.4]),trees=[tj(e) for e in final.estimators_]),open(OUT+'rf_surrogate.json','w'),separators=(',',':'))
# ---------------- B ----------------
xs=S.dx; SENS=[int(np.argmin(abs(xs-x))) for x in np.linspace(xs.min()+3,xs.max()-3,9)]
def camp(n,seed):
    r=np.random.default_rng(seed);R=[]
    for t in T:
        for _ in range(n):
            p=0.0 if t=='sin_danio' else r.uniform(.05,.40)
            R.append((t,p,S.solve(100,50,t,p)['deck_uz_mm'][SENS]))  # la forma normalizada no depende de q ni de E (elástico lineal)
    return R
R=camp(150,1); Rt=camp(60,2)
def mk(rows,nls,reps,seed):
    r=np.random.default_rng(seed);F=[];L=[];P=[]
    for _ in range(reps):
        for t,p,u in rows:
            nl=r.choice(nls); un=u+r.normal(0,nl*abs(u).max(),u.shape); F.append(un/abs(un).max()); L.append(t); P.append(p)
    return np.array(F),np.array(L),np.array(P)
F,L,P=mk(R,[0,.005,.01,.02],4,3)
sc=StandardScaler().fit(F); svm=SVC(C=10,gamma='scale',decision_function_shape='ovo').fit(sc.transform(F),L)
ci=np.array([T.index(x) for x in L]); dm=L!='sin_danio'
sev=RandomForestRegressor(n_estimators=40,max_depth=10,random_state=0).fit(np.c_[F,ci][dm],P[dm])
cls=svm.classes_.tolist()
def ovr(Zs):  # réplica exacta de la inferencia que hará la web
    K=np.exp(-svm._gamma*((Zs[:,None,:]-svm.support_vectors_[None])**2).sum(-1))
    st=np.r_[0,np.cumsum(svm.n_support_)]; nc=len(cls); votes=np.zeros((len(Zs),nc)); conf=np.zeros_like(votes); k=0
    for i in range(nc):
        for j in range(i+1,nc):
            a=svm.dual_coef_[j-1,st[i]:st[i+1]]@K[:,st[i]:st[i+1]].T+svm.dual_coef_[i,st[j]:st[j+1]]@K[:,st[j]:st[j+1]].T+svm.intercept_[k]
            votes[:,i]+=a>0; votes[:,j]+=a<=0; conf[:,i]+=a; conf[:,j]-=a; k+=1
    return votes+conf/(3*(np.abs(conf)+1))
f0,l0,_=mk(Rt,[.01],1,9); D=ovr(sc.transform(f0)); Dsk=svm.decision_function(sc.transform(f0)); import sys; print("mismatch argmax-ovr vs sklearn-ovr:",np.mean(D.argmax(1)!=__import__("sklearn.utils.multiclass",fromlist=["x"])._ovr_decision_function(Dsk<0,-Dsk,len(cls)).argmax(1)),"vs predict:",np.mean(np.array(cls)[D.argmax(1)]!=svm.predict(sc.transform(f0))))
TH=1.0  # margen mínimo entre 1.ª y 2.ª clase (en votos) para emitir un diagnóstico
inv={}
for nl in [0,.005,.01,.02,.05]:
    f,l,p=mk(Rt,[nl],1,9); D=ovr(sc.transform(f)); pr=np.array(cls)[D.argmax(1)]; s=np.sort(D,1); ok=(s[:,-1]-s[:,-2])>=TH
    dmg=l!='sin_danio'; sp=sev.predict(np.c_[f,[T.index(x) for x in pr]][dmg])
    inv[str(nl)]=dict(exactitud=float(accuracy_score(l,pr)),f1_macro=float(f1_score(l,pr,average='macro')),
      exactitud_dano_20_40=float(accuracy_score(l[dmg&(p>=.2)],pr[dmg&(p>=.2)])),exactitud_dano_5_20=float(accuracy_score(l[dmg&(p<.2)],pr[dmg&(p<.2)])),
      falsa_alarma=float(np.mean(pr[~dmg]!='sin_danio')),cobertura_concluyente=float(ok.mean()),
      exactitud_concluyentes=float(accuracy_score(l[ok],pr[ok])) if ok.any() else None,mae_severidad=float(mean_absolute_error(p[dmg],sp)))
    if nl==.005: cm=confusion_matrix(l,pr,labels=T).tolist()
Ftr=sc.transform(F)
def nn(Zs): return np.array([np.min(np.linalg.norm(Ftr[::2]-z,axis=1)) for z in Zs])
f,_,_=mk(Rt,[.02],1,5); thr=float(np.percentile(nn(sc.transform(f)),99))
fo,_,_=mk(Rt,[.10],1,6); det=float(np.mean(nn(sc.transform(fo))>thr))
json.dump(dict(classes=cls,mean=sc.mean_.tolist(),scale=sc.scale_.tolist(),gamma=float(svm._gamma),sv=np.round(svm.support_vectors_,7).tolist(),
  nsv=svm.n_support_.tolist(),dual=np.round(svm.dual_coef_,7).tolist(),b=svm.intercept_.tolist(),margin_threshold=TH,
  sensors_node_index=[int(S.DECK[i]) for i in SENS],sensors_x=[round(float(xs[i]),3) for i in SENS],ood_threshold=thr,
  train=np.round(Ftr[::2],4).tolist(),severity_trees=[tj(e) for e in sev.estimators_]),open(OUT+'svm_inverse.json','w'),separators=(',',':'))
M=dict(fecha='2026-10-23',
 sustituto=dict(algoritmo='Random Forest Regressor con escalamiento físico (u·E/q, σ/q); 40 árboles, profundidad 10',
   datos='450 casos FEM OpenSees 3.8.0 con carga (q = 25–200 kN/m, E = 40–60 GPa) del dataset de 525',validaciones=res),
 inversa=dict(algoritmo='SVM-RBF (C = 10, gamma = scale) + Random Forest de severidad',
   datos=f'{len(R)} casos de entrenamiento × 4 réplicas de ruido y {len(Rt)} de prueba, generados con el solver 2D verificado (daño 5–40 %)',
   entradas='9 desplazamientos verticales del tablero normalizados por su máximo; no usa q, E ni la etiqueta',
   sensores_x=[round(float(xs[i]),2) for i in SENS],umbral_margen=TH,por_ruido=inv,confusion_ruido_0_5=dict(labels=T,m=cm),
   fuera_de_dominio=dict(metodo='distancia al vecino de entrenamiento más cercano (percentil 99 con ruido 2 %)',umbral=thr,deteccion_ruido_10=det)))
json.dump(M,open(OUT+'metrics_ia.json','w'),indent=1,ensure_ascii=False)
for k,v in res.items(): print(k,{m:round(v['fisico'][m]['r2'],4) for m in YK},'| directo',{m:round(v['directo'][m]['r2'],3) for m in YK})
for k,v in inv.items(): print(k,{a:(round(b,3) if b is not None else None) for a,b in v.items()})
print('ood',thr,det)
