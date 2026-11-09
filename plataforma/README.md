# PuenteGemelo · plataforma web

Segunda parte de la tesis *Implementación de una plataforma digital para la inspección de puentes históricos con inteligencia artificial: caso Puente Balta* (UPC). Autores: Luis Ñuñuvero Castillo y Anthony Tarazona Cerna. Asesor: Rick M. Delgadillo.

Página publicada: https://casvilluis-afk.github.io/Balta-viewer/plataforma/ · Programa de escritorio y descripción completa: [`../app/README.md`](../app/README.md)

## Pestañas

| Pestaña | Qué hace |
|---|---|
| Inicio | Mis puentes (proyectos) y estado del puente activo |
| Gemelo digital | Nube, modelo e IA en 7 pasos (nube → tablero y apoyos, calidad, dimensiones, elementos e IFC, evidencia para la inspección → geometría → modelo y modos → IA → diagnóstico → plan e informe); sismo registrado |
| Monitoreo con IA | Vibración medida (FDD/EFDD), calibración del modelo y diagnóstico |
| Inspección y gestión | Prioridades de inspección (IA), inspección de campo según la Guía del MTC, carga vehicular HL-93, deterioro y mantenimiento |
| Verificación | Pruebas de la plataforma y registro de datos y procedencia |

El Puente Balta viene como proyecto de ejemplo con el material verificado de la primera parte: modelo 2D de 150 nodos y 221 elementos contra OpenSees 3.8.0 (525 casos), sustituto Random Forest, diagnóstico inverso SVM-RBF y nube TLS.

La página no necesita compilación: es HTML y JavaScript y carga Three.js 0.160 desde jsDelivr (la app de escritorio lo trae incluido).

## Archivos

- `index.html`: interfaz, solver 2D (réplica del script de OpenSees), modelo C e IA del Balta, láminas.
- `op_core.js`: núcleo de cálculo sin interfaz (nubes, apoyos, calidad, dimensiones, atributos, comparación, elementos, IFC, modelos, modos, IA, OMA, HL-93, Markov, sismo, DXF).
- `op_ui.js`: flujo de 7 pasos del gemelo desde la nube.
- `pg_mod.js`: módulos del puente activo (vibración, calibración, inspección MTC, HL-93, deterioro, estado).
- `pg_puentes.js`: biblioteca de puentes (proyectos `.puente`).
- `v3d.js`: vista 3D.
- `data/`: modelo 2D, casos de OpenSees, modelos de IA del Balta y procedencia; `codigo/`: scripts de Python que los generan (`pip install numpy pandas scikit-learn` y `python train.py`).
- `docs/Manual_PuenteGemelo.pdf`: guía de uso para inspectores.
