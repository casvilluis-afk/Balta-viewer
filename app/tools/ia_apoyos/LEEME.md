# IA de apoyos: cómo se entrenó

1. Descargar las 6 nubes etiquetadas de Lee (2026), Zenodo 18531104 (CC BY 4.0). El flujo «Banco de nubes» (`.github/workflows/banco.yml`, modo `coreanos`) las reduce a 1,5 millones de puntos y separa las etiquetas en `NOMBRE_etiquetas.u8`.
2. `node extraer_rasgos.js NOMBRE.ply NOMBRE_etiquetas.u8 rasgos/NOMBRE` para cada puente.
3. `python3 entrenar.py rasgos ia_apoyos.json` (scikit-learn 1.9). Imprime la validación dejando un puente fuera y exporta el modelo.

Resultado de la versión 2.5.0: IoU fondo 0,91, tablero 0,81, apoyo 0,48 (dejando un puente fuera).
La regla que usa el modelo para revisar los apoyos (`IA_REGLA` en `op_core.js`) se ajustó con el banco de pruebas descrito en el README de la app.
