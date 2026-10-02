from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

try:
    import openseespy.opensees as ops
except ImportError:
    raise ImportError("Instala OpenSeesPy con: python -m pip install openseespy")

# ==========================================================
# 06 - Simulaciones paramétricas FEM en OpenSeesPy
# Genera dataset para IA variando:
# - carga vertical
# - módulo de elasticidad
# - daño localizado por reducción de rigidez
# ==========================================================

BASE_DIR = Path(".")
IN_DIR = BASE_DIR / "salidas_04"
OUT_DIR = BASE_DIR / "salidas_06"
OUT_DIR.mkdir(exist_ok=True)

NODES_PATH = IN_DIR / "04_nodos_modelo_2D.csv"
ELEMENTS_PATH = IN_DIR / "04_elementos_modelo_2D.csv"

df_nodes = pd.read_csv(NODES_PATH)
df_elements = pd.read_csv(ELEMENTS_PATH)

# ==========================================================
# Propiedades equivalentes preliminares
# ==========================================================

section_props = {
    "arco": {"A": 0.35, "Iz": 0.050},
    "tablero": {"A": 1.20, "Iz": 0.250},
    "pilar": {"A": 2.00, "Iz": 1.000},
    "montante": {"A": 0.08, "Iz": 0.005},
    "default": {"A": 0.20, "Iz": 0.020},
}

def get_section_from_group(grupo):
    grupo = str(grupo).lower()

    if "arco" in grupo:
        return "arco", section_props["arco"]
    if "tablero" in grupo:
        return "tablero", section_props["tablero"]
    if "pilar" in grupo:
        return "pilar", section_props["pilar"]
    if "montante" in grupo:
        return "montante", section_props["montante"]

    return "default", section_props["default"]

def node_coord(node_id):
    row = df_nodes[df_nodes["node_id"] == node_id].iloc[0]
    return float(row["coord_x_m"]), float(row["coord_z_m"])

def element_length(node_i, node_j):
    xi, zi = node_coord(node_i)
    xj, zj = node_coord(node_j)
    return ((xj - xi) ** 2 + (zj - zi) ** 2) ** 0.5

def is_damaged(grupo, damage_target):
    grupo = str(grupo).lower()
    damage_target = str(damage_target).lower()

    if damage_target == "sin_danio":
        return False

    if damage_target.startswith("arco"):
        return damage_target in grupo

    if damage_target == "tablero":
        return "tablero" in grupo

    if damage_target == "pilares":
        return "pilar" in grupo

    if damage_target == "montantes":
        return "montante" in grupo

    return False

# ==========================================================
# Función para correr un caso
# ==========================================================

def run_case(case_id, q_kN_m, E_GPa, damage_target, damage_pct):
    E_base = E_GPa * 1e9
    q_line = q_kN_m * 1000  # N/m

    ops.wipe()
    ops.model("basic", "-ndm", 2, "-ndf", 3)

    # Crear nodos
    for _, row in df_nodes.iterrows():
        nid = int(row["node_id"])
        x = float(row["coord_x_m"])
        z = float(row["coord_z_m"])
        ops.node(nid, x, z)

    # Apoyos fijos
    base_nodes = df_nodes[df_nodes["tipo"] == "base_apoyo"]["node_id"].astype(int).tolist()

    for nid in base_nodes:
        ops.fix(nid, 1, 1, 1)

    ops.geomTransf("Linear", 1)

    element_info = []

    # Crear elementos
    for _, row in df_elements.iterrows():
        eid = int(row["element_id"])
        ni = int(row["node_i"])
        nj = int(row["node_j"])
        grupo = row["grupo"]

        L = element_length(ni, nj)

        if L < 1e-6:
            continue

        section_name, props = get_section_from_group(grupo)
        A = props["A"]
        Iz = props["Iz"]

        E_elem = E_base

        if is_damaged(grupo, damage_target):
            E_elem = E_base * (1.0 - damage_pct)

        ops.element("elasticBeamColumn", eid, ni, nj, A, E_elem, Iz, 1)

        element_info.append({
            "element_id": eid,
            "node_i": ni,
            "node_j": nj,
            "grupo": grupo,
            "section": section_name,
            "A": A,
            "Iz": Iz,
            "E_elem": E_elem,
            "damage_applied": is_damaged(grupo, damage_target)
        })

    # Cargas verticales sobre tablero
    ops.timeSeries("Linear", 1)
    ops.pattern("Plain", 1, 1)

    deck_nodes_df = df_nodes[df_nodes["tipo"] == "tablero"].copy()
    deck_nodes_df = deck_nodes_df.sort_values("coord_x_m")

    deck_node_ids = deck_nodes_df["node_id"].astype(int).tolist()
    deck_x = deck_nodes_df["coord_x_m"].astype(float).to_numpy()

    total_load_N = 0.0

    for i, nid in enumerate(deck_node_ids):
        if len(deck_node_ids) == 1:
            tributary_length = 1.0
        elif i == 0:
            tributary_length = 0.5 * (deck_x[i + 1] - deck_x[i])
        elif i == len(deck_node_ids) - 1:
            tributary_length = 0.5 * (deck_x[i] - deck_x[i - 1])
        else:
            tributary_length = 0.5 * (deck_x[i + 1] - deck_x[i - 1])

        P = q_line * tributary_length
        total_load_N += P

        ops.load(nid, 0.0, -P, 0.0)

    # Análisis
    ops.system("BandGeneral")
    ops.numberer("RCM")
    ops.constraints("Transformation")
    ops.test("NormDispIncr", 1e-8, 50)
    ops.algorithm("Newton")
    ops.integrator("LoadControl", 1.0)
    ops.analysis("Static")

    ok = ops.analyze(1)

    if ok != 0:
        ops.algorithm("ModifiedNewton")
        ok = ops.analyze(1)

    if ok != 0:
        return {
            "case_id": case_id,
            "converged": False,
            "q_kN_m": q_kN_m,
            "E_GPa": E_GPa,
            "damage_target": damage_target,
            "damage_pct": damage_pct,
        }

    # Desplazamientos
    u_total_max = 0.0
    uz_min = 0.0
    ux_max_abs = 0.0

    for _, row in df_nodes.iterrows():
        nid = int(row["node_id"])
        ux, uz, rz = ops.nodeDisp(nid)

        u_total = (ux**2 + uz**2) ** 0.5
        u_total_max = max(u_total_max, u_total)
        uz_min = min(uz_min, uz)
        ux_max_abs = max(ux_max_abs, abs(ux))

    # Reacciones
    ops.reactions()

    rz_total = 0.0
    rx_total = 0.0

    for nid in base_nodes:
        rx_total += ops.nodeReaction(nid, 1)
        rz_total += ops.nodeReaction(nid, 2)

    # Fuerzas internas y esfuerzo aproximado
    max_P_kN = 0.0
    max_V_kN = 0.0
    max_M_kNm = 0.0
    max_sigma_MPa = 0.0

    max_sigma_arco_MPa = 0.0
    max_sigma_tablero_MPa = 0.0
    max_sigma_pilar_MPa = 0.0

    for elem in element_info:
        eid = int(elem["element_id"])
        A = elem["A"]
        Iz = elem["Iz"]
        section = elem["section"]

        try:
            f = ops.eleForce(eid)
        except Exception:
            continue

        if len(f) < 6:
            continue

        Pi, Vi, Mi, Pj, Vj, Mj = f[:6]

        Pmax = max(abs(Pi), abs(Pj))
        Vmax = max(abs(Vi), abs(Vj))
        Mmax = max(abs(Mi), abs(Mj))

        max_P_kN = max(max_P_kN, Pmax / 1000)
        max_V_kN = max(max_V_kN, Vmax / 1000)
        max_M_kNm = max(max_M_kNm, Mmax / 1000)

        # Estimación simplificada de esfuerzo:
        # sigma = P/A + M*c/I
        # c equivalente aproximado = sqrt(I/A)
        c_eq = (Iz / A) ** 0.5
        sigma = Pmax / A + Mmax * c_eq / Iz
        sigma_MPa = sigma / 1e6

        max_sigma_MPa = max(max_sigma_MPa, sigma_MPa)

        if section == "arco":
            max_sigma_arco_MPa = max(max_sigma_arco_MPa, sigma_MPa)
        elif section == "tablero":
            max_sigma_tablero_MPa = max(max_sigma_tablero_MPa, sigma_MPa)
        elif section == "pilar":
            max_sigma_pilar_MPa = max(max_sigma_pilar_MPa, sigma_MPa)

    return {
        "case_id": case_id,
        "converged": True,
        "q_kN_m": q_kN_m,
        "E_GPa": E_GPa,
        "damage_target": damage_target,
        "damage_pct": damage_pct,
        "damage_pct_percent": damage_pct * 100,
        "total_load_kN": -total_load_N / 1000,
        "reaction_vertical_total_kN": rz_total / 1000,
        "reaction_horizontal_total_kN": rx_total / 1000,
        "u_total_max_mm": u_total_max * 1000,
        "uz_min_mm": uz_min * 1000,
        "ux_max_abs_mm": ux_max_abs * 1000,
        "max_P_kN": max_P_kN,
        "max_V_kN": max_V_kN,
        "max_M_kNm": max_M_kNm,
        "max_sigma_MPa": max_sigma_MPa,
        "max_sigma_arco_MPa": max_sigma_arco_MPa,
        "max_sigma_tablero_MPa": max_sigma_tablero_MPa,
        "max_sigma_pilar_MPa": max_sigma_pilar_MPa,
    }

# ==========================================================
# Definir casos paramétricos
# ==========================================================

q_values = [0, 25, 50, 75, 100, 150, 200]  # kN/m
E_values = [40, 50, 60]  # GPa

damage_targets = [
    "sin_danio",
    "arco_a1_a2",
    "arco_a2_a3",
    "arco_a3_a4",
    "tablero",
    "pilares",
    "montantes",
]

damage_values = [0.10, 0.20, 0.30, 0.40]

cases = []
case_id = 1

for q in q_values:
    for E in E_values:
        # Caso sin daño
        cases.append({
            "case_id": f"S{case_id:04d}",
            "q_kN_m": q,
            "E_GPa": E,
            "damage_target": "sin_danio",
            "damage_pct": 0.0,
        })
        case_id += 1

        # Casos con daño
        for target in damage_targets:
            if target == "sin_danio":
                continue

            for dmg in damage_values:
                cases.append({
                    "case_id": f"S{case_id:04d}",
                    "q_kN_m": q,
                    "E_GPa": E,
                    "damage_target": target,
                    "damage_pct": dmg,
                })
                case_id += 1

print(f"Total de simulaciones a ejecutar: {len(cases)}")

# ==========================================================
# Ejecutar simulaciones
# ==========================================================

results = []

for i, case in enumerate(cases, start=1):
    if i % 25 == 0 or i == 1:
        print(f"Ejecutando caso {i}/{len(cases)}...")

    result = run_case(
        case_id=case["case_id"],
        q_kN_m=case["q_kN_m"],
        E_GPa=case["E_GPa"],
        damage_target=case["damage_target"],
        damage_pct=case["damage_pct"],
    )

    results.append(result)

df = pd.DataFrame(results)

# ==========================================================
# Calcular índice de riesgo simplificado
# ==========================================================

df_ok = df[df["converged"] == True].copy()

def safe_norm(series):
    max_val = series.abs().max()
    if max_val == 0:
        return series * 0
    return series.abs() / max_val

df_ok["norm_disp"] = safe_norm(df_ok["uz_min_mm"])
df_ok["norm_stress"] = safe_norm(df_ok["max_sigma_MPa"])
df_ok["norm_load"] = safe_norm(df_ok["q_kN_m"])
df_ok["norm_damage"] = safe_norm(df_ok["damage_pct"])

df_ok["risk_index"] = (
    0.35 * df_ok["norm_stress"] +
    0.30 * df_ok["norm_disp"] +
    0.20 * df_ok["norm_load"] +
    0.15 * df_ok["norm_damage"]
)

def classify_risk(r):
    if r < 0.35:
        return "seguro"
    elif r < 0.60:
        return "moderado"
    elif r < 0.80:
        return "critico"
    else:
        return "falla_probable"

df_ok["estado"] = df_ok["risk_index"].apply(classify_risk)

# Unir de vuelta
df_final = df.copy()

for col in ["norm_disp", "norm_stress", "norm_load", "norm_damage", "risk_index", "estado"]:
    df_final[col] = None

df_final.loc[df_ok.index, ["norm_disp", "norm_stress", "norm_load", "norm_damage", "risk_index", "estado"]] = df_ok[
    ["norm_disp", "norm_stress", "norm_load", "norm_damage", "risk_index", "estado"]
]

# ==========================================================
# Guardar dataset
# ==========================================================

df_final.to_csv(OUT_DIR / "06_dataset_parametrico_opensees.csv", index=False)
df_ok.to_csv(OUT_DIR / "06_dataset_parametrico_convergido.csv", index=False)

with pd.ExcelWriter(OUT_DIR / "06_dataset_parametrico_opensees.xlsx") as writer:
    df_final.to_excel(writer, sheet_name="todos_los_casos", index=False)
    df_ok.to_excel(writer, sheet_name="casos_convergidos", index=False)

    resumen_estado = df_ok["estado"].value_counts().reset_index()
    resumen_estado.columns = ["estado", "cantidad"]
    resumen_estado.to_excel(writer, sheet_name="resumen_estados", index=False)

    resumen_damage = df_ok.groupby(["damage_target", "damage_pct_percent"])["risk_index"].mean().reset_index()
    resumen_damage.to_excel(writer, sheet_name="riesgo_promedio_danio", index=False)

# ==========================================================
# Gráficos
# ==========================================================

plt.figure(figsize=(10, 6))
plt.hist(df_ok["risk_index"], bins=20)
plt.xlabel("Índice de riesgo")
plt.ylabel("Frecuencia")
plt.title("Distribución del índice de riesgo en simulaciones paramétricas")
plt.grid(True, linewidth=0.3)
plt.tight_layout()
plt.savefig(OUT_DIR / "06_histograma_riesgo.png", dpi=300)
plt.close()

plt.figure(figsize=(10, 6))
plt.scatter(df_ok["q_kN_m"], df_ok["uz_min_mm"], s=12, alpha=0.7)
plt.xlabel("Carga lineal equivalente q (kN/m)")
plt.ylabel("Desplazamiento vertical mínimo Uz (mm)")
plt.title("Carga vs desplazamiento vertical")
plt.grid(True, linewidth=0.3)
plt.tight_layout()
plt.savefig(OUT_DIR / "06_carga_vs_desplazamiento.png", dpi=300)
plt.close()

plt.figure(figsize=(10, 6))
plt.scatter(df_ok["q_kN_m"], df_ok["risk_index"], s=12, alpha=0.7)
plt.xlabel("Carga lineal equivalente q (kN/m)")
plt.ylabel("Índice de riesgo")
plt.title("Carga vs índice de riesgo")
plt.grid(True, linewidth=0.3)
plt.tight_layout()
plt.savefig(OUT_DIR / "06_carga_vs_riesgo.png", dpi=300)
plt.close()

plt.figure(figsize=(12, 6))
df_box = df_ok.copy()
df_box.boxplot(column="risk_index", by="damage_target", rot=45)
plt.title("Índice de riesgo por tipo de daño")
plt.suptitle("")
plt.xlabel("Tipo de daño")
plt.ylabel("Índice de riesgo")
plt.grid(True, linewidth=0.3)
plt.tight_layout()
plt.savefig(OUT_DIR / "06_riesgo_por_tipo_danio.png", dpi=300)
plt.close()

# ==========================================================
# Resumen final
# ==========================================================

print("\nSimulaciones terminadas.")
print(f"Casos totales     : {len(df_final)}")
print(f"Casos convergidos : {len(df_ok)}")
print(f"Casos fallidos    : {len(df_final) - len(df_ok)}")

print("\nResumen por estado:")
print(df_ok["estado"].value_counts().to_string())

print("\nArchivos generados en:")
print(OUT_DIR.resolve())

print("\nRevisa:")
print(" - 06_dataset_parametrico_opensees.xlsx")
print(" - 06_histograma_riesgo.png")
print(" - 06_carga_vs_desplazamiento.png")
print(" - 06_carga_vs_riesgo.png")
print(" - 06_riesgo_por_tipo_danio.png")