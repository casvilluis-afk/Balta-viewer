from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    confusion_matrix,
    classification_report,
    mean_absolute_error,
    mean_squared_error,
    r2_score
)
from sklearn.svm import SVC
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier, RandomForestRegressor
from sklearn.neural_network import MLPClassifier


# ==========================================================
# 07 - IA corregida para riesgo estructural
# Clasificación:
#   Entrada: q_kN_m, E_GPa, damage_target, damage_pct
#   Salida: estado estructural
#
# Regresión / modelo sustituto FEM:
#   Entrada: q_kN_m, E_GPa, damage_target, damage_pct
#   Salida: desplazamiento, esfuerzo e índice de riesgo
# ==========================================================

BASE_DIR = Path(".")
IN_DIR = BASE_DIR / "salidas_06"
OUT_DIR = BASE_DIR / "salidas_07"
OUT_DIR.mkdir(exist_ok=True)

DATA_PATH = IN_DIR / "06_dataset_parametrico_convergido.csv"

if not DATA_PATH.exists():
    raise FileNotFoundError(
        "No encontré salidas_06/06_dataset_parametrico_convergido.csv. "
        "Ejecuta primero el Script 06."
    )

df = pd.read_csv(DATA_PATH)

print("Dataset leído correctamente.")
print(f"Casos disponibles: {len(df)}")

# ==========================================================
# Validación de columnas necesarias
# ==========================================================

required_cols = [
    "q_kN_m",
    "E_GPa",
    "damage_target",
    "damage_pct",
    "u_total_max_mm",
    "uz_min_mm",
    "max_sigma_MPa",
    "risk_index",
    "estado"
]

missing = [c for c in required_cols if c not in df.columns]

if missing:
    raise ValueError(f"Faltan columnas en el dataset: {missing}")

df = df.dropna(subset=required_cols).copy()

df["q_kN_m"] = df["q_kN_m"].astype(float)
df["E_GPa"] = df["E_GPa"].astype(float)
df["damage_pct"] = df["damage_pct"].astype(float)
df["damage_target"] = df["damage_target"].astype(str)
df["estado"] = df["estado"].astype(str)

df["u_total_max_mm"] = df["u_total_max_mm"].astype(float)
df["uz_min_mm"] = df["uz_min_mm"].astype(float)
df["max_sigma_MPa"] = df["max_sigma_MPa"].astype(float)
df["risk_index"] = df["risk_index"].astype(float)

print("\nDistribución de estados:")
print(df["estado"].value_counts().to_string())

# ==========================================================
# Variables de entrada corregidas
# No usamos desplazamientos ni esfuerzos como entrada
# porque esos resultados vienen del FEM.
# ==========================================================

features_num = [
    "q_kN_m",
    "E_GPa",
    "damage_pct"
]

features_cat = [
    "damage_target"
]

X = df[features_num + features_cat]
y = df["estado"]

preprocessor = ColumnTransformer(
    transformers=[
        ("num", StandardScaler(), features_num),
        ("cat", OneHotEncoder(handle_unknown="ignore"), features_cat)
    ]
)

# ==========================================================
# División train/test
# ==========================================================

class_counts = y.value_counts()
min_class_count = class_counts.min()

if min_class_count >= 2:
    stratify_arg = y
else:
    stratify_arg = None
    print("\nAdvertencia: alguna clase tiene menos de 2 muestras. Split sin estratificar.")

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.25,
    random_state=42,
    stratify=stratify_arg
)

print(f"\nCasos de entrenamiento: {len(X_train)}")
print(f"Casos de prueba       : {len(X_test)}")

# ==========================================================
# Modelos de clasificación
# ==========================================================

models = {
    "SVM_RBF": SVC(
        kernel="rbf",
        C=10,
        gamma="scale",
        class_weight="balanced"
    ),

    "Random_Forest": RandomForestClassifier(
        n_estimators=400,
        random_state=42,
        class_weight="balanced"
    ),

    "Gradient_Boosting": GradientBoostingClassifier(
        random_state=42
    ),

    "MLP_Neural_Network": MLPClassifier(
        hidden_layer_sizes=(64, 32),
        activation="relu",
        solver="adam",
        max_iter=3000,
        random_state=42
    )
}

metrics_rows = []
confusion_matrices = {}
classification_reports = {}

labels = sorted(y.unique())

for name, model in models.items():
    print(f"\nEntrenando modelo: {name}")

    clf = Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            ("model", model)
        ]
    )

    clf.fit(X_train, y_train)
    y_pred = clf.predict(X_test)

    acc = accuracy_score(y_test, y_pred)
    prec_w = precision_score(y_test, y_pred, average="weighted", zero_division=0)
    rec_w = recall_score(y_test, y_pred, average="weighted", zero_division=0)
    f1_w = f1_score(y_test, y_pred, average="weighted", zero_division=0)

    prec_m = precision_score(y_test, y_pred, average="macro", zero_division=0)
    rec_m = recall_score(y_test, y_pred, average="macro", zero_division=0)
    f1_m = f1_score(y_test, y_pred, average="macro", zero_division=0)

    cv_mean = np.nan
    cv_std = np.nan

    if min_class_count >= 3:
        n_splits = min(5, min_class_count)
        cv = StratifiedKFold(
            n_splits=n_splits,
            shuffle=True,
            random_state=42
        )

        try:
            cv_scores = cross_val_score(
                clf,
                X,
                y,
                cv=cv,
                scoring="f1_weighted"
            )
            cv_mean = cv_scores.mean()
            cv_std = cv_scores.std()
        except Exception as e:
            print(f"No se pudo calcular validación cruzada para {name}: {e}")

    metrics_rows.append({
        "modelo": name,
        "accuracy": acc,
        "precision_weighted": prec_w,
        "recall_weighted": rec_w,
        "f1_weighted": f1_w,
        "precision_macro": prec_m,
        "recall_macro": rec_m,
        "f1_macro": f1_m,
        "cv_f1_weighted_mean": cv_mean,
        "cv_f1_weighted_std": cv_std
    })

    cm = confusion_matrix(y_test, y_pred, labels=labels)

    confusion_matrices[name] = pd.DataFrame(
        cm,
        index=[f"real_{l}" for l in labels],
        columns=[f"pred_{l}" for l in labels]
    )

    report = classification_report(
        y_test,
        y_pred,
        labels=labels,
        zero_division=0,
        output_dict=True
    )

    classification_reports[name] = pd.DataFrame(report).transpose()

df_metrics = pd.DataFrame(metrics_rows)
df_metrics = df_metrics.sort_values("f1_weighted", ascending=False).reset_index(drop=True)

print("\nComparación de modelos:")
print(df_metrics.to_string(index=False))

best_model_name = df_metrics.iloc[0]["modelo"]
print(f"\nMejor modelo según F1-score ponderado: {best_model_name}")

# ==========================================================
# Matriz de confusión del mejor modelo
# ==========================================================

best_clf = Pipeline(
    steps=[
        ("preprocessor", preprocessor),
        ("model", models[best_model_name])
    ]
)

best_clf.fit(X_train, y_train)
y_best_pred = best_clf.predict(X_test)

cm_best = confusion_matrix(y_test, y_best_pred, labels=labels)

plt.figure(figsize=(8, 6))
plt.imshow(cm_best)
plt.title(f"Matriz de confusión - {best_model_name}")
plt.xlabel("Clase predicha")
plt.ylabel("Clase real")
plt.xticks(range(len(labels)), labels, rotation=45)
plt.yticks(range(len(labels)), labels)

for i in range(len(labels)):
    for j in range(len(labels)):
        plt.text(j, i, str(cm_best[i, j]), ha="center", va="center")

plt.colorbar()
plt.tight_layout()
plt.savefig(OUT_DIR / "07_matriz_confusion_mejor_modelo.png", dpi=300)
plt.close()

# ==========================================================
# Importancia de variables con Random Forest
# ==========================================================

rf_pipeline = Pipeline(
    steps=[
        ("preprocessor", preprocessor),
        ("model", RandomForestClassifier(
            n_estimators=500,
            random_state=42,
            class_weight="balanced"
        ))
    ]
)

rf_pipeline.fit(X_train, y_train)

pre = rf_pipeline.named_steps["preprocessor"]
cat_encoder = pre.named_transformers_["cat"]

cat_names = list(cat_encoder.get_feature_names_out(features_cat))
feature_names = features_num + cat_names

rf_model = rf_pipeline.named_steps["model"]
importances = rf_model.feature_importances_

df_importance = pd.DataFrame({
    "variable": feature_names,
    "importancia": importances
}).sort_values("importancia", ascending=False)

plt.figure(figsize=(10, 6))
plt.barh(df_importance["variable"][::-1], df_importance["importancia"][::-1])
plt.xlabel("Importancia")
plt.ylabel("Variable")
plt.title("Importancia de variables - Random Forest")
plt.tight_layout()
plt.savefig(OUT_DIR / "07_importancia_variables_random_forest.png", dpi=300)
plt.close()

# ==========================================================
# Modelo sustituto FEM por regresión
# Predice variables FEM sin volver a ejecutar OpenSeesPy
# ==========================================================

regression_targets = [
    "uz_min_mm",
    "u_total_max_mm",
    "max_sigma_MPa",
    "risk_index"
]

regression_rows = []

X_reg = df[features_num + features_cat]

preprocessor_reg = ColumnTransformer(
    transformers=[
        ("num", StandardScaler(), features_num),
        ("cat", OneHotEncoder(handle_unknown="ignore"), features_cat)
    ]
)

for target in regression_targets:
    print(f"\nEntrenando modelo sustituto FEM para: {target}")

    y_reg = df[target].astype(float)

    Xr_train, Xr_test, yr_train, yr_test = train_test_split(
        X_reg,
        y_reg,
        test_size=0.25,
        random_state=42
    )

    reg = Pipeline(
        steps=[
            ("preprocessor", preprocessor_reg),
            ("model", RandomForestRegressor(
                n_estimators=500,
                random_state=42
            ))
        ]
    )

    reg.fit(Xr_train, yr_train)
    yr_pred = reg.predict(Xr_test)

    mae = mean_absolute_error(yr_test, yr_pred)
    rmse = mean_squared_error(yr_test, yr_pred) ** 0.5
    r2 = r2_score(yr_test, yr_pred)

    regression_rows.append({
        "variable_predicha": target,
        "MAE": mae,
        "RMSE": rmse,
        "R2": r2
    })

    plt.figure(figsize=(7, 7))
    plt.scatter(yr_test, yr_pred, alpha=0.70, s=18)

    min_val = min(yr_test.min(), yr_pred.min())
    max_val = max(yr_test.max(), yr_pred.max())

    plt.plot([min_val, max_val], [min_val, max_val], linestyle="--")
    plt.xlabel(f"{target} real FEM")
    plt.ylabel(f"{target} predicho IA")
    plt.title(f"Modelo sustituto FEM - {target}")
    plt.grid(True, linewidth=0.3)
    plt.tight_layout()
    plt.savefig(OUT_DIR / f"07_regresion_real_vs_predicho_{target}.png", dpi=300)
    plt.close()

df_regression = pd.DataFrame(regression_rows)

print("\nMétricas de regresión del modelo sustituto FEM:")
print(df_regression.to_string(index=False))

# ==========================================================
# Gráficos comparativos de modelos
# ==========================================================

plt.figure(figsize=(10, 6))
plt.bar(df_metrics["modelo"], df_metrics["accuracy"])
plt.ylabel("Accuracy")
plt.xlabel("Modelo")
plt.title("Accuracy de modelos de clasificación")
plt.xticks(rotation=30)
plt.ylim(0, 1.05)
plt.grid(True, axis="y", linewidth=0.3)
plt.tight_layout()
plt.savefig(OUT_DIR / "07_comparacion_modelos_accuracy.png", dpi=300)
plt.close()

plt.figure(figsize=(10, 6))
plt.bar(df_metrics["modelo"], df_metrics["f1_weighted"])
plt.ylabel("F1-score ponderado")
plt.xlabel("Modelo")
plt.title("Comparación de modelos IA por F1-score")
plt.xticks(rotation=30)
plt.ylim(0, 1.05)
plt.grid(True, axis="y", linewidth=0.3)
plt.tight_layout()
plt.savefig(OUT_DIR / "07_comparacion_modelos_f1.png", dpi=300)
plt.close()

# ==========================================================
# Guardar resultados en Excel y CSV
# ==========================================================

with pd.ExcelWriter(OUT_DIR / "07_resultados_ia_riesgo.xlsx") as writer:
    df.to_excel(writer, sheet_name="dataset_usado", index=False)
    df_metrics.to_excel(writer, sheet_name="metricas_clasificacion", index=False)
    df_importance.to_excel(writer, sheet_name="importancia_variables", index=False)
    df_regression.to_excel(writer, sheet_name="metricas_regresion", index=False)

    for name, cm_df in confusion_matrices.items():
        sheet_name = f"CM_{name}"[:31]
        cm_df.to_excel(writer, sheet_name=sheet_name)

    for name, rep_df in classification_reports.items():
        sheet_name = f"REP_{name}"[:31]
        rep_df.to_excel(writer, sheet_name=sheet_name)

df_metrics.to_csv(OUT_DIR / "07_metricas_clasificacion.csv", index=False)
df_importance.to_csv(OUT_DIR / "07_importancia_variables.csv", index=False)
df_regression.to_csv(OUT_DIR / "07_metricas_regresion.csv", index=False)

# ==========================================================
# Resumen final
# ==========================================================

print("\nEntrenamiento IA terminado.")
print(f"Mejor modelo: {best_model_name}")

print("\nArchivos generados en:")
print(OUT_DIR.resolve())

print("\nRevisa:")
print(" - 07_resultados_ia_riesgo.xlsx")
print(" - 07_comparacion_modelos_accuracy.png")
print(" - 07_comparacion_modelos_f1.png")
print(" - 07_matriz_confusion_mejor_modelo.png")
print(" - 07_importancia_variables_random_forest.png")
print(" - 07_regresion_real_vs_predicho_risk_index.png")