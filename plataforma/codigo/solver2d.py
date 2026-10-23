"""Pórtico 2D elástico (3 gdl/nodo) que replica 06_simulaciones_parametricas.py (OpenSees elasticBeamColumn, Linear)."""
import json, numpy as np
SRC='../../data/fem-original/scenario-model.json'
M=json.load(open(SRC))
NODES=M['nodes']; ELEMS=M['elements']
nid=[n['id'] for n in NODES]; idx={k:i for i,k in enumerate(nid)}
X=np.array([[n['x'],n['z']] for n in NODES])
FIX=[idx[n['id']] for n in NODES if n['fixed']]
deck=sorted([n for n in NODES if n['deck']],key=lambda n:n['x'])
DECK=[idx[n['id']] for n in deck]; dx=np.array([n['x'] for n in deck])
trib=np.empty(len(dx)); trib[0]=.5*(dx[1]-dx[0]); trib[-1]=.5*(dx[-1]-dx[-2]); trib[1:-1]=.5*(dx[2:]-dx[:-2])
def damaged(g,t):
    g=g.lower()
    if t=='sin_danio': return False
    if t.startswith('arco'): return t in g
    return {'tablero':'tablero','pilares':'pilar','montantes':'montante'}[t] in g
def section(g):
    g=g.lower()
    for k in ['arco','tablero','pilar','montante']:
        if k in g: return k
    return 'default'
def solve(q,E,target='sin_danio',pct=0.0,efac=None):
    """efac: dict element_id->factor de rigidez (opcional, sobreescribe)."""
    n=len(NODES); K=np.zeros((3*n,3*n)); info=[]
    for e in ELEMS:
        i,j=idx[e['i']],idx[e['j']]; d=X[j]-X[i]; L=np.hypot(*d); c,s=d/L
        Ee=E*1e9*((1-pct) if damaged(e['group'],target) else 1.0)
        if efac and e['id'] in efac: Ee*=efac[e['id']]
        A,I=e['A'],e['I']
        k=np.zeros((6,6)); a=Ee*A/L; b=Ee*I/L**3
        k[0,0]=k[3,3]=a; k[0,3]=k[3,0]=-a
        k[1,1]=k[4,4]=12*b; k[1,4]=k[4,1]=-12*b
        k[1,2]=k[2,1]=k[1,5]=k[5,1]=6*b*L; k[2,4]=k[4,2]=k[4,5]=k[5,4]=-6*b*L
        k[2,2]=k[5,5]=4*b*L*L; k[2,5]=k[5,2]=2*b*L*L
        T=np.zeros((6,6)); r=np.array([[c,s,0],[-s,c,0],[0,0,1]]); T[:3,:3]=r; T[3:,3:]=r
        kg=T.T@k@T; dof=[3*i,3*i+1,3*i+2,3*j,3*j+1,3*j+2]
        K[np.ix_(dof,dof)]+=kg; info.append((e,dof,kg,section(e['group'])))
    F=np.zeros(3*n)
    for t,ni in zip(trib,DECK): F[3*ni+1]-=q*1000*t
    fixed=set(); [fixed.update([3*f,3*f+1,3*f+2]) for f in FIX]
    free=np.array([k for k in range(3*n) if k not in fixed])
    U=np.zeros(3*n); U[free]=np.linalg.solve(K[np.ix_(free,free)],F[free])
    ux=U[0::3]; uz=U[1::3]; ut=np.hypot(ux,uz)
    out=dict(u_total_max_mm=ut.max()*1e3, uz_min_mm=min(uz.min(),0)*1e3, ux_max_abs_mm=np.abs(ux).max()*1e3)
    smax={'arco':0,'tablero':0,'pilar':0}; sall=0; elem_sigma={}
    for e,dof,kg,sec in info:
        f=kg@U[dof]  # fuerzas globales (como eleForce)
        P=max(abs(f[0]),abs(f[3])); Mm=max(abs(f[2]),abs(f[5]))
        A,I=e['A'],e['I']; sg=(P/A+Mm*np.sqrt(I/A)/I)/1e6
        elem_sigma[e['id']]=sg; sall=max(sall,sg)
        if sec in smax: smax[sec]=max(smax[sec],sg)
    out.update(max_sigma_MPa=sall,max_sigma_arco_MPa=smax['arco'],max_sigma_tablero_MPa=smax['tablero'],max_sigma_pilar_MPa=smax['pilar'])
    out['deck_uz_mm']=uz[DECK]*1e3; out['ux_mm']=ux*1e3; out['uz_mm']=uz*1e3; out['elem_sigma']=elem_sigma
    return out
