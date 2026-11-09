"""Valida los modelos IFC que exporta PuenteGemelo con IfcOpenShell: esquema (IFC4X3_ADD2), reglas de atributos y geometría.
Uso: python validar_ifc.py archivo1.ifc [archivo2.ifc ...]  -> sale con código 1 si algún archivo tiene errores."""
import sys, logging, ifcopenshell, ifcopenshell.validate, ifcopenshell.geom, ifcopenshell.util.element as ue
mal = 0
for f in sys.argv[1:]:
    m = ifcopenshell.open(f)
    log = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(m, log, express_rules=True)
    errs = list(log.statements)
    st = ifcopenshell.geom.settings(); st.set(st.USE_WORLD_COORDS, True)
    ok = fallos = 0; lo = [1e18] * 3; hi = [-1e18] * 3; tipos = {}
    for e in m.by_type('IfcElement'):
        tipos[e.is_a()] = tipos.get(e.is_a(), 0) + 1
        try:
            sh = ifcopenshell.geom.create_shape(st, e); v = sh.geometry.verts
            for i in range(0, len(v), 3):
                for k in range(3): lo[k] = min(lo[k], v[i + k]); hi[k] = max(hi[k], v[i + k])
            ok += 1
        except Exception as ex:
            fallos += 1; print('   geometría falla:', e.is_a(), e.Name, ex)
    psets = sum(1 for e in m.by_type('IfcElement') if ue.get_psets(e).get('Pset_PuenteGemelo_Medido'))
    print(f'{f}: esquema {m.schema}, elementos {dict(sorted(tipos.items()))}, con geometría {ok}, fallos {fallos}, con Pset medido {psets}, '
          f'caja {[round(a,1) for a in lo]} → {[round(b,1) for b in hi]}, avisos de validación {len(errs)}')
    for s in errs[:15]: print('   ', str(s)[:300])
    if errs or fallos: mal += 1
sys.exit(1 if mal else 0)
