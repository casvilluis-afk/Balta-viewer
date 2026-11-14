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

Primera corrida en Ansys Student 2026 R1 con BEAM188 lineal (opción por defecto), 1 elemento por barra: 7,761 · 7,949 · 8,176 · 10,526 · 12,162 · 12,665 · 18,426 · 18,918 Hz (+4 a +30 %). Causa: el elemento lineal con una sola división por barra es demasiado rígido en flexión. Corrección: `KEYOPT,1,3,3` (forma cúbica) y 4 elementos por barra.

El contenido del macro se comprobó con `verificar_mac.py` (lee el .mac y resuelve el mismo problema con numpy): coincide con la app
a menos de 0,01 % en los 8 modos. Diferencias de Ansys de hasta ~1 % son esperables solo si `SECCONTROL` no se aplica a la sección
ASEC en su versión (BEAM188 es una viga de Timoshenko y los pilares son cortos y gruesos); más de 2 % indicaría un error.

## Regenerar
```
node generar_modeloC_apdl.js ../../plataforma/index.html ../../plataforma/data/modelo_c.json salida
python3 verificar_mac.py salida/balta_modeloC_2D.mac salida/frecuencias_referencia_app.csv
```

Segunda corrida (BEAM188 cúbica, 4 elementos por barra, `SECCONTROL` para anular el cortante): 6,998 · 7,174 · 7,409 · 8,476 · 9,162 · 9,443 · 14,914 · 15,064 Hz (−3 a −6 %).
Un cálculo con viga de Timoshenko (G = E/2,6, área de cortante = A) reproduce esos valores a 0,4–2,8 %: Ansys **sí** incluyó la
deformación por cortante (`SECCONTROL` no se aplica a la sección ASEC). Por eso hay dos macros:
- `balta_modeloC_2D.mac`: G = 10 000 E con `MP,GXY` → Euler-Bernoulli, la misma hipótesis de la app (verificación).
- `balta_modeloC_2D_timoshenko.mac`: G = E/2,6 → con deformación por cortante; mide cuánto sobrestima la app al despreciarla.

## Resultados en Ansys Student 2026 R1 (13-nov-2026)

| Modo | App (Hz) | Ansys, BEAM188 lineal, 1 elem./barra | Ansys Euler-Bernoulli (cúbica, 4 elem./barra) | Dif. | Ansys Timoshenko | Efecto del cortante |
|---|---|---|---|---|---|---|
| 1 | 7.4368 | 7.761 (+4.4 %) | 7.4368 | -0.0006 % | 6.9709 | -6.26 % |
| 2 | 7.5174 | 7.949 (+5.7 %) | 7.5174 | +0.0000 % | 7.1452 | -4.95 % |
| 3 | 7.7123 | 8.176 (+6.0 %) | 7.7123 | +0.0001 % | 7.3785 | -4.33 % |
| 4 | 8.7424 | 10.526 (+20.4 %) | 8.7424 | -0.0001 % | 8.3497 | -4.49 % |
| 5 | 9.4788 | 12.162 (+28.3 %) | 9.4787 | -0.0007 % | 9.0175 | -4.87 % |
| 6 | 9.7670 | 12.665 (+29.7 %) | 9.7670 | +0.0002 % | 9.2955 | -4.83 % |
| 7 | 15.4348 | 18.426 (+19.4 %) | 15.4348 | -0.0002 % | 14.5129 | -5.97 % |
| 8 | 15.5561 | 18.918 (+21.6 %) | 15.5561 | -0.0003 % | 14.6527 | -5.81 % |

Verificación: con la misma hipótesis (Euler-Bernoulli) Ansys reproduce las 8 frecuencias de la app con diferencias menores de 0,001 %. La malla gruesa con elemento lineal sobrestima hasta +30 % (estudio de convergencia). La deformación por cortante, que la app desprecia, baja las frecuencias entre 4,3 y 6,3 % en este modelo (pilares de 3 m y nervios de radio de giro 0,26 m).

## Modelo 3D de barras (`balta_modelo3D.mac`)

Generado por `generar_modelo3D.py` sobre la misma geometría (arcos ajustados a la nube, caras de pilares medidas): 6 nervios por arco,
6 largueros, montantes bajo cada larguero, vigas transversales, diagonales del tablero, arriostres entre nervios y pilares como
6 columnas unidas por una viga de cabeza. 936 nodos de estructura, 7042 elementos BEAM188 cúbicos, 5790 nodos en total.
Todas las secciones de los elementos secundarios y la separación de nervios son supuestas (ver el encabezado del generador).
Vigas de Timoshenko (G = E/2,6). `verificar_mac3D.py` relee el macro y coincide con el generador a menos de 0,001 %.
Frecuencias de referencia en `frecuencias_referencia_3D.csv` (modos 1-3 transversales, 4-12 verticales).

## Modelo 3D con pilares sólidos (`balta_modelo3D_solido.mac`)

Igual al modelo 3D de barras, pero cada pilar es un muro macizo de 12,15 × 3 m mallado con SOLID185 (792 hexaedros en total),
unido a las barras de cabeza por regiones rígidas (CERIG, UXYZ) y empotrado en la base. `verificar_solido.py` relee el macro y lo
resuelve con hexaedros de integración completa (control aproximado; SOLID185 usa B-bar): modos laterales 1,3-2,4 % más bajos que con
pilares de barras, verticales dentro de ±0,5 %. Resultado en `balta_modelo3D_solido_control.csv`.

Resultado en Ansys Student 2026 R1 (pilares sólidos): 4,8037 · 5,2361 · 5,2832 · 6,5195 · 6,6916 · 6,7682 · 6,9129 · 6,9250 · 7,1362 · 7,8756 · 8,4725 · 8,6380 Hz (0,02-0,8 % bajo el control propio; frente a pilares de barras: laterales −1,5 a −3,3 %, verticales ±0,5 %).
