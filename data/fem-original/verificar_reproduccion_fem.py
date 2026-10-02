"""Reproduce los 525 casos y audita equilibrio y fuerzas sin modificar las fuentes."""
import ast, json, math, hashlib
from pathlib import Path
import pandas as pd
import openseespy.opensees as ops

root=Path(r'C:\Users\Acer\Desktop\Puente Balta')
source=root/'06_simulaciones_parametricas.py'
tree=ast.parse(source.read_text(encoding='utf-8-sig'))
selected=[n for n in tree.body if isinstance(n,ast.FunctionDef) or (isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='section_props' for t in n.targets))]
env={'ops':ops,'pd':pd,'df_nodes':pd.read_csv(root/'salidas_04/04_nodos_modelo_2D.csv'),'df_elements':pd.read_csv(root/'salidas_04/04_elementos_modelo_2D.csv')}
exec(compile(ast.Module(body=selected,type_ignores=[]),str(source),'exec'),env)
coordinates={int(r.node_id):(float(r.coord_x_m),float(r.coord_z_m)) for _,r in env['df_nodes'].iterrows()}
env['node_coord']=lambda nid:coordinates[nid]
data=pd.read_csv(root/'Backup resultados previos/salidas_06/06_dataset_parametrico_convergido.csv')
indices=range(len(data))
results=[]
for i in indices:
 r=data.iloc[i]
 got=env['run_case'](r.case_id,float(r.q_kN_m),float(r.E_GPa),r.damage_target,float(r.damage_pct))
 comparisons={k:{'archived':float(r[k]),'reproduced':float(got[k]),'matches':math.isclose(float(r[k]),float(got[k]),rel_tol=1e-6,abs_tol=1e-6)} for k in ['u_total_max_mm','uz_min_mm','max_sigma_MPa','total_load_kN','reaction_vertical_total_kN'] if k in got}
 local_sigma=0.0
 for _,element in env['df_elements'].iterrows():
  eid=int(element.element_id)
  local=ops.eleResponse(eid,'localForce')
  if not local or len(local)!=6: continue
  _,props=env['get_section_from_group'](element.grupo)
  axial=max(abs(local[0]),abs(local[3]));moment=max(abs(local[2]),abs(local[5]))
  local_sigma=max(local_sigma,(axial/props['A']+moment*math.sqrt(props['Iz']/props['A'])/props['Iz'])/1e6)
 equilibrium=None if not got['converged'] else abs(got['reaction_vertical_total_kN']+got['total_load_kN'])
 results.append({'case_id':r.case_id,'converged':got['converged'],'comparisons':comparisons,'vertical_equilibrium_residual_kN':equilibrium,'sigma_with_local_forces_same_approximation_MPa':local_sigma})
 if (i+1)%50==0 or i==len(data)-1: print('Casos procesados',i+1,flush=True)
all_match=all(r['converged'] and len(r['comparisons'])==5 and all(x['matches'] for x in r['comparisons'].values()) for r in results)
hashes={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [source,root/'salidas_04/04_nodos_modelo_2D.csv',root/'salidas_04/04_elementos_modelo_2D.csv',root/'Backup resultados previos/salidas_06/06_dataset_parametrico_convergido.csv']}
report={'scope':'525 casos; geometría actual salidas_04; no calibración experimental','opensees':ops.version(),'nodes':len(env['df_nodes']),'elements':len(env['df_elements']),'all_archived_metrics_reproduced':all_match,'cases_checked':len(results),'maximum_equilibrium_residual_kN':max(r['vertical_equilibrium_residual_kN'] or 0 for r in results),'force_review':'El script archivado interpreta eleForce global como axial/cortante. Se contrastó localForce manteniendo c=sqrt(I/A). La distancia c sigue siendo aproximada y requiere sección real.','source_sha256':hashes,'results':results}
out=Path(__file__).parent/'auditoria_reproduccion_fem.json'
out.write_text(json.dumps(report,indent=2),encoding='utf-8')
print(out)
