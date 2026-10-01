"""Macromodelo 3D conectado del Puente Balta para prototipo virtual.

Unidades SI. Geometría tomada del Blender/nube; propiedades mecánicas preliminares.
No válido para diseño ni evaluación hasta calibración documental/experimental.
"""
from pathlib import Path
import csv,json,math
import openseespy.opensees as ops

ROOT=Path(__file__).resolve().parent; OUT=ROOT/"macro_data";OUT.mkdir(exist_ok=True)
SUPPORT_Y=[-36.0606976,-58.1285763,-86.2754555,-113.4715805]
X=[-6.125572,7.506427]
Z_DECK=5.60;Z_SPRING=3.17563;RISE=2.094375;DIV=8
nodes={};elements=[];node_tag=0;element_tag=0
def node(x,y,z,kind):
 global node_tag
 node_tag+=1;nodes[node_tag]=(x,y,z,kind);ops.node(node_tag,x,y,z);return node_tag
def beam(i,j,A,E,G,J,Iy,Iz,transf,kind):
 global element_tag
 element_tag+=1;ops.element("elasticBeamColumn",element_tag,i,j,A,E,G,J,Iy,Iz,transf);elements.append((element_tag,i,j,kind));return element_tag

ops.wipe();ops.model("basic","-ndm",3,"-ndf",6)
ops.geomTransf("Linear",1,0,0,1);ops.geomTransf("Linear",2,1,0,0)
E_m=4.0e9;nu=.2;G_m=E_m/(2*(1+nu));E_d=25e9;G_d=E_d/(2*(1+.2))
# Equivalent preliminary sections.
arch=(3.0,E_m,G_m,1.5,1.0,1.8); deck=(1.2,E_d,G_d,.25,.18,2.5); cross=(.8,E_d,G_d,.15,.12,.8); post=(.7,E_m,G_m,.12,.10,.10)
stations=[]
for a,b in zip(SUPPORT_Y,SUPPORT_Y[1:]):
 for k in range(DIV):stations.append(a+(b-a)*k/DIV)
stations.append(SUPPORT_Y[-1])
deck_nodes={};arch_nodes={}
for side,x in enumerate(X):
 for s,y in enumerate(stations):
  deck_nodes[side,s]=node(x,y,Z_DECK,"DECK")
  # Local span and parabolic arch axis.
  span=min(range(3),key=lambda q:abs(y-(SUPPORT_Y[q]+SUPPORT_Y[q+1])/2))
  a,b=SUPPORT_Y[span],SUPPORT_Y[span+1];xi=max(0,min(1,(y-a)/(b-a)))
  z=Z_SPRING+4*RISE*xi*(1-xi)
  arch_nodes[side,s]=node(x,y,z,"ARCH")
for side in range(2):
 for s in range(len(stations)-1):
  beam(deck_nodes[side,s],deck_nodes[side,s+1],*deck,1,"DECK_LONG")
  # Do not connect across duplicated span boundaries incorrectly; stations are continuous.
  beam(arch_nodes[side,s],arch_nodes[side,s+1],*arch,1,"ARCH")
 for s in range(len(stations)):
  beam(arch_nodes[side,s],deck_nodes[side,s],*post,2,"SPANDREL")
for s in range(len(stations)):
 beam(deck_nodes[0,s],deck_nodes[1,s],*cross,1,"DECK_CROSS")
# Fix arch springings and restrain deck at the four support stations.
support_indices=[]
fixed_y=set();fixed_z=set()
for sy in SUPPORT_Y:
 s=min(range(len(stations)),key=lambda k:abs(stations[k]-sy));support_indices.append(s)
 for side in range(2):
  ops.fix(arch_nodes[side,s],1,1,1,1,1,1)
  fixed_y.add(arch_nodes[side,s]);fixed_z.add(arch_nodes[side,s])
  # Bearings: vertical/transverse restrained; longitudinal free except first abutment.
  if s==support_indices[0]:ops.fix(deck_nodes[side,s],1,1,1,0,0,0);fixed_y.add(deck_nodes[side,s]);fixed_z.add(deck_nodes[side,s])
  else:ops.fix(deck_nodes[side,s],1,0,1,0,0,0);fixed_z.add(deck_nodes[side,s])
# Lumped deck mass from 14.28 m wide, 0.55 m equivalent slab, 2400 kg/m3.
total_length=SUPPORT_Y[0]-SUPPORT_Y[-1];total_mass=total_length*14.28*.55*2400
mass_per=total_mass/(2*len(stations))
for tag,(x,y,z,kind) in nodes.items():
 if kind=="DECK":ops.mass(tag,mass_per,mass_per,mass_per,1e-6,1e-6,1e-6)
 else:ops.mass(tag,1.0,1.0,1.0,1e-6,1e-6,1e-6)
vals=ops.eigen(120);periods=[]
for m,v in enumerate(vals,1):periods.append((m,v,2*math.pi/math.sqrt(v)))
with (OUT/"nodes.csv").open("w",newline="",encoding="utf-8-sig") as f:
 w=csv.writer(f);w.writerow(["node_tag","x","y","z","kind"]);w.writerows((t,*p) for t,p in nodes.items())
with (OUT/"elements.csv").open("w",newline="",encoding="utf-8-sig") as f:
 w=csv.writer(f);w.writerow(["element_tag","node_i","node_j","kind"]);w.writerows(elements)
with (OUT/"modal_periods.csv").open("w",newline="",encoding="utf-8-sig") as f:
 w=csv.writer(f);w.writerow(["mode","eigenvalue","period_s"]);w.writerows(periods)
with (OUT/"modal_shapes.csv").open("w",newline="",encoding="utf-8-sig") as f:
 w=csv.writer(f);w.writerow(["mode","node_tag","ux","uy","uz","rx","ry","rz"])
 for m in range(1,7):
  raw=[(t,list(ops.nodeEigenvector(t,m))) for t in nodes];mx=max(math.sqrt(sum(v[i]**2 for i in range(3))) for _,v in raw)
  for t,v in raw:w.writerow([m,t,*[q/mx for q in v]])
# Elastic preliminary Lima spectrum. Zone 4, assumed S1 soil, 5% damping, R=1.
G=9.80665;Z_FACTOR=.45;SOIL_FACTOR=1.0;TP=.40;TL=2.50
def spectrum_sa(T,vertical=False):
 if T<=TP:C=2.5
 elif T<=TL:C=2.5*TP/T
 else:C=2.5*TP*TL/(T*T)
 sa=Z_FACTOR*SOIL_FACTOR*C*G
 return sa*(2/3 if vertical else 1.0)
mass={t:(mass_per if p[3]=="DECK" else 1.0) for t,p in nodes.items()}
participation=[]
def spectral(direction,name,vertical=False):
 contributions={t:[[] for _ in range(3)] for t in nodes}
 for m,(mode,eig,T) in enumerate(periods,1):
  phi={t:list(ops.nodeEigenvector(t,mode)) for t in nodes}
  den=sum(mass[t]*sum(phi[t][k]**2 for k in range(3)) for t in nodes)
  num=sum(mass[t]*phi[t][direction] for t in nodes);gamma=num/den if den else 0.0
  eff=(num*num/den) if den else 0.0;sa=spectrum_sa(T,vertical);sd=sa/eig
  restrained=fixed_z if direction==2 else fixed_y
  active_mass=sum(value for tag,value in mass.items() if tag not in restrained)
  participation.append([name,mode,T,sa,gamma,eff,100*eff/active_mass])
  for t in nodes:
   for k in range(3):contributions[t][k].append(phi[t][k]*gamma*sd)
 with (OUT/f"spectral_{name.lower()}.csv").open("w",newline="",encoding="utf-8-sig") as f:
  w=csv.writer(f);w.writerow(["node_tag","ux_m","uy_m","uz_m","magnitude_m"])
  for t,axes in contributions.items():
   out=[]
   for values in axes:
    mag=math.sqrt(sum(v*v for v in values));dominant=max(values,key=abs) if values else 0;out.append(math.copysign(mag,dominant) if dominant else 0)
   w.writerow([t,*out,math.sqrt(sum(v*v for v in out))])
spectral(1,"Y",False);spectral(2,"Z",True)
with (OUT/"spectral_modal_participation.csv").open("w",newline="",encoding="utf-8-sig") as f:
 w=csv.writer(f);w.writerow(["direction","mode","period_s","Sa_m_s2","gamma","effective_mass_kg","effective_mass_percent"]);w.writerows(participation)
quality={"status":"PRELIMINARY_PLAUSIBLE" if .05<periods[0][2]<10 else "REVIEW_REQUIRED","fundamental_period_s":periods[0][2],"nodes":len(nodes),"elements":len(elements),"total_mass_kg":total_mass,"supports":SUPPORT_Y,"calibration":"PENDING"}
quality["spectrum"]={"location":"Lima, Peru","zone":4,"Z":Z_FACTOR,"soil_assumption":"S1","S":SOIL_FACTOR,"Tp_s":TP,"Tl_s":TL,"damping":.05,"R":1.0,"vertical_ratio":2/3,"status":"PRELIMINARY_PENDING_GEOTECHNICAL_AND_MTC_CONFIRMATION"}
quality["spectrum"]["modes_used"]=len(periods)
quality["spectrum"]["effective_mass_Y_percent"]=sum(r[6] for r in participation if r[0]=="Y")
quality["spectrum"]["effective_mass_Z_percent"]=sum(r[6] for r in participation if r[0]=="Z")
(OUT/"quality.json").write_text(json.dumps(quality,indent=2),encoding="utf-8")
print(json.dumps(quality,indent=2))
