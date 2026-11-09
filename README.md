# PuenteGemelo · Balta-viewer

Repositorio de la tesis *Implementación de una plataforma digital para la inspección de puentes históricos con inteligencia artificial: caso Puente Balta* (UPC, 2026). Autores: Luis Ñuñuvero Castillo y Anthony Tarazona Cerna.

| Carpeta | Contenido |
|---|---|
| `plataforma/` | **PuenteGemelo**, la plataforma web (HTML y JavaScript sin compilación): de la nube de puntos de cualquier puente al gemelo digital, la IA, la inspección de campo MTC y el modelo IFC. Página publicada: https://casvilluis-afk.github.io/Balta-viewer/plataforma/ |
| `app/` | La misma plataforma como programa de escritorio (Electron) para Windows, macOS y Linux; pruebas automáticas en `app/tests/`. Descripción completa, validación y limitaciones: [`app/README.md`](app/README.md) |
| `index.html`, `models/`, `data/`, `assets/` | Primera parte de la tesis: visor del gemelo digital del Puente Balta (modelo 3D, nube TLS y modelo de elementos finitos verificado con OpenSees) |
| `guides/` | Guías de procesamiento de la nube (CloudCompare) |
| `.github/workflows/` | Instaladores (`app.yml`), banco de nubes de prueba (`banco.yml`) y validación de los IFC (`ifc.yml`) |

Guía de uso para inspectores: `app/docs/Manual_PuenteGemelo.pdf`. Cómo citar: `CITATION.cff`. Licencias: código MIT (`app/LICENSE`); datos del Puente Balta CC BY 4.0 (`app/DATA_LICENSE.md`).

> Herramienta de apoyo a la inspección. No reemplaza la evaluación de un ingeniero ni constituye una verificación de seguridad o de capacidad resistente.
