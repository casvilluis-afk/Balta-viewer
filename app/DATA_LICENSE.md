# Licencia de los datos del Puente Balta

Los datos del caso de estudio Puente Balta incluidos en la app y en `plataforma/data/`
(nube de puntos reducida, modelo 3D, modelos de cálculo, resultados de OpenSees y modelos de IA entrenados)
se publican bajo **Creative Commons Atribución 4.0 Internacional (CC BY 4.0)**:
https://creativecommons.org/licenses/by/4.0/deed.es

Cite así:
Ñuñuvero Castillo, L. y Tarazona Cerna, A. (2026). *Datos del gemelo digital del Puente Balta (Lima, Perú)*. Universidad Peruana de Ciencias Aplicadas.

Levantamiento TLS con escáner Trimble X7 (2024). Los acelerogramas de CISMID-UNI o del IGP que el usuario cargue en la app
no se incluyen ni se redistribuyen; se rigen por las condiciones de cada institución.

## Modelo de IA de apoyos (`data/ia_apoyos.json`)

Bosque aleatorio entrenado con el conjunto de datos de Lee, C. (2026), *UAV LiDAR bridge point cloud dataset*,
Zenodo, registro 18531104, licencia CC BY 4.0 (https://zenodo.org/records/18531104).
Artículo asociado: *UAV LiDAR bridge point cloud dataset and hybrid deep learning framework for robust semantic segmentation*,
Automation in Construction 188, 107045 (2026), doi 10.1016/j.autcon.2026.107045.
El modelo se distribuye bajo CC BY 4.0 con esta atribución. No contiene puntos de las nubes originales, solo los umbrales y proporciones de los árboles.

## Modelo de IA de estribos (`data/ia_estribos.json`)

Bosque aleatorio entrenado con los estribos etiquetados (clase 3, «abutment») de los 20 puentes TLS de
*Real 3D point clouds of bridges*, Zenodo, registro 18738225, licencia CC BY 4.0 (https://zenodo.org/records/18738225);
clases según github.com/mvg-inatech/3d_bridge_segmentation; artículo asociado arXiv 2512.15369.
El modelo se distribuye bajo CC BY 4.0 con esta atribución. No contiene puntos de las nubes originales.

Los 23 puentes sintéticos de Kellner (Zenodo 18593422, CC BY-NC 1.0) solo se usaron como prueba; no entrenan ningún modelo.
