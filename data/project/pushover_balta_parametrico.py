"""Pushover paramétrico para integración virtual; NO calibrado ni apto para diseño."""
from pathlib import Path
import csv,json,math

ROOT=Path(__file__).resolve().parent;D=ROOT/"macro_data";P=ROOT/"pushover_data";P.mkdir(exist_ok=True)
with (D/"nodes.csv").open(encoding="utf-8-sig") as f:nodes={int(r["node_tag"]):r for r in csv.DictReader(f)}
with (D/"elements.csv").open(encoding="utf-8-sig") as f:elements=list(csv.DictReader(f))
quality=json.loads((D/"quality.json").read_text(encoding="utf-8"));mass=quality["total_mass_kg"];g=9.80665
steps=40;dmax=.12;dy=.020;dpeak=.060;vy=.15*mass*g;vpeak=1.15*vy;vres=.75*vy
supports=quality["supports"]
def capacity(d):
 if d<=dy:return vy*d/dy
 if d<=dpeak:return vy+(vpeak-vy)*(d-dy)/(dpeak-dy)
 return vpeak+(vres-vpeak)*(d-dpeak)/(dmax-dpeak)
def state(r):
 if r<.35:return "BAJO"
 if r<.70:return "MODERADO"
 if r<1.0:return "ALTO"
 if r<1.25:return "CRITICO"
 return "FALLA"
curve=[];node_rows=[];element_rows=[];maxima={}
for step in range(steps+1):
 d=dmax*step/steps;v=capacity(d);mu=d/dy if dy else 0;global_demand=(d/dmax)*1.35
 curve.append([step,d,v/1000,mu])
 disp={}
 for tag,r in nodes.items():
  z=float(r["z"]);kind=r["kind"]
  factor=1.0 if kind=="DECK" else .60+.40*max(0,min(1,(z-3.17563)/2.094375))
  # Longitudinal Y pushover with a small coupled transverse/vertical diagnostic component.
  ux=.03*d*math.sin((float(r["y"])-supports[-1])/(supports[0]-supports[-1])*math.pi)
  uy=d*factor;uz=-.015*d*factor
  disp[tag]=(ux,uy,uz);node_rows.append([step,tag,ux,uy,uz,(ux*ux+uy*uy+uz*uz)**.5])
 for e in elements:
  tag=int(e["element_tag"]);ni=int(e["node_i"]);nj=int(e["node_j"]);kind=e["kind"]
  yi=float(nodes[ni]["y"]);yj=float(nodes[nj]["y"]);mid=(yi+yj)/2
  near=min(abs(mid-s) for s in supports);support_factor=1+.45*math.exp(-near/3)
  kind_factor={"ARCH":1.25,"SPANDREL":1.10,"DECK_CROSS":.75,"DECK_LONG":.82}.get(kind,1.0)
  variation=.92+.16*((tag*37)%101)/100
  ratio=global_demand*support_factor*kind_factor*variation
  st=state(ratio);element_rows.append([step,tag,f"M{tag:03d}",kind,ratio,st,mid,near])
  if tag not in maxima or ratio>maxima[tag][0]:maxima[tag]=(ratio,st,kind,mid,near)
with (P/"pushover_curve.csv").open("w",newline="",encoding="utf-8-sig") as f:
 w=csv.writer(f);w.writerow(["step","control_displacement_m","base_shear_kN","ductility"]);w.writerows(curve)
with (P/"pushover_nodes.csv").open("w",newline="",encoding="utf-8-sig") as f:
 w=csv.writer(f);w.writerow(["step","node_tag","ux_m","uy_m","uz_m","magnitude_m"]);w.writerows(node_rows)
with (P/"pushover_element_states.csv").open("w",newline="",encoding="utf-8-sig") as f:
 w=csv.writer(f);w.writerow(["step","element_tag","element_id","kind","demand_ratio","state","mid_y","distance_to_support_m"]);w.writerows(element_rows)
critical=sorted(((v[0],tag,*v[1:]) for tag,v in maxima.items()),reverse=True)
with (P/"critical_elements.csv").open("w",newline="",encoding="utf-8-sig") as f:
 w=csv.writer(f);w.writerow(["max_demand_ratio","element_tag","element_id","final_state","kind","mid_y","distance_to_support_m"])
 for ratio,tag,st,kind,mid,near in critical:w.writerow([ratio,tag,f"M{tag:03d}",st,kind,mid,near])
summary={"status":"PARAMETRIC_NOT_CALIBRATED","steps":steps+1,"direction":"Y","yield_displacement_m":dy,"maximum_displacement_m":dmax,"yield_shear_kN":vy/1000,"peak_shear_kN":vpeak/1000,"residual_shear_kN":vres/1000,"critical_element":f"M{critical[0][1]:03d}","critical_ratio":critical[0][0],"damage_thresholds":{"BAJO":"<0.35","MODERADO":"0.35-0.70","ALTO":"0.70-1.00","CRITICO":"1.00-1.25","FALLA":">=1.25"}}
(P/"pushover_summary.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
print(json.dumps(summary,indent=2))
