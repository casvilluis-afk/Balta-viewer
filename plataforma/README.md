# Plataforma de inspección del Puente Balta

Segunda parte de la tesis *Implementación de una plataforma digital para la inspección de puentes históricos con inteligencia artificial: caso del Puente Balta, Lima* (UPC). Autores: Luis Ñuñuvero Castillo y Anthony Tarazona Cerna. Asesor: Rick M. Delgadillo.

Página publicada: https://casvilluis-afk.github.io/Balta-viewer/plataforma/

## Módulos

| Pestaña | Objetivo específico |
|---|---|
| Visor y trazabilidad | OE2: consulta por componente; enlace entre el modelo 3D (`../models/puente-balta-v12.glb`) y los elementos del modelo 2D |
| Simulador con IA | OE3: modelo 2D exacto en el navegador frente al sustituto Random Forest, con alertas de dominio y diagnóstico inverso SVM-RBF |
| Comparador | OE4: dos escenarios lado a lado |
| Inspección priorizada | OE5: índice por zona y reporte copiable |
| Validación | OE6: concordancia con OpenSees, métricas de IA, tiempo de consulta y SUS |
| Base y procedencia | OE1: secciones, hipótesis y huellas SHA-256 |

La página no necesita compilación: es HTML y JavaScript, y carga Three.js 0.160 desde jsDelivr.

## Datos (`data/`)

- `modelo_2d.json`: modelo 2D de 150 nodos y 221 elementos (copia de `../data/fem-original/scenario-model.json`).
- `fem_525.csv`: los 525 casos de OpenSees 3.8.0.
- `rf_surrogate.json`: Random Forest con escalamiento físico (u·E/q, σ/q), entrenado con los 450 casos con carga.
- `svm_inverse.json`: SVM-RBF que localiza el daño a partir de 9 flechas del tablero, más un Random Forest de severidad.
- `metrics_ia.json`: métricas de validación de ambos modelos.
- `procedencia.json`: verificación numérica, secciones e hipótesis.

## Reproducir los modelos (`codigo/`)

```bash
cd plataforma/codigo
pip install numpy pandas scikit-learn
python train.py
```

`solver2d.py` replica el script `06_simulaciones_parametricas.py` (elementos `elasticBeamColumn`, transformación lineal, apoyos empotrados) y reproduce los 450 casos con carga con un error relativo menor a 1e-11. `train.py` regenera los archivos de `data/`.
