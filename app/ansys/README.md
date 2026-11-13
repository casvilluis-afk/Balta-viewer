# Ansys: verificación del modelo de la plataforma (Puente Balta)

`salida/balta_modeloC_2D.mac` es el **modelo C de PuenteGemelo replicado en Ansys Mechanical APDL**: el pórtico plano del Puente Balta
(3 arcos ajustados a la nube TLS, tablero, montantes y 2 pilares; 156 nodos, 225 vigas BEAM188, 156 masas MASS21).
Sirve para **verificar** que un programa comercial obtiene las mismas frecuencias que la plataforma con las mismas hipótesis.
**No** da las frecuencias reales del puente: las secciones son equivalentes supuestas (no medidas) y E del fierro fundido es nominal.

## Cómo correrlo (Ansys Student 2026 R1)
1. Copie `balta_modeloC_2D.mac` a una carpeta sin espacios ni tildes (por ejemplo `C:\ansys\balta`).
2. Abra **Mechanical APDL Product Launcher 2026 R1**, ponga esa carpeta en *Working Directory* y pulse *Run*.
3. En Mechanical APDL: **File → Read Input from…** y elija `balta_modeloC_2D.mac` (o escriba `/INPUT,balta_modeloC_2D,mac` en la línea de comandos).
4. Al terminar verá el modo 1 deformado. Las frecuencias quedan en **General Postproc → Results Summary** y en el archivo
   `frecuencias_modeloC.txt` de la carpeta de trabajo.
5. Compárelas con `frecuencias_referencia_app.csv`.

## Qué se espera
| Modo | App (Hz) |
|---|---|
| 1 | 7,437 |
| 2 | 7,517 |
| 3 | 7,712 |
| 4 | 8,742 |
| 5 | 9,479 |
| 6 | 9,767 |
| 7 | 15,435 |
| 8 | 15,556 |

El contenido del macro se comprobó con `verificar_mac.py` (lee el .mac y resuelve el mismo problema con numpy): coincide con la app
a menos de 0,01 % en los 8 modos. Diferencias de Ansys de hasta ~1 % son esperables solo si `SECCONTROL` no se aplica a la sección
ASEC en su versión (BEAM188 es una viga de Timoshenko y los pilares son cortos y gruesos); más de 2 % indicaría un error.

## Regenerar
```
node generar_modeloC_apdl.js ../../plataforma/index.html ../../plataforma/data/modelo_c.json salida
python3 verificar_mac.py salida/balta_modeloC_2D.mac salida/frecuencias_referencia_app.csv
```
