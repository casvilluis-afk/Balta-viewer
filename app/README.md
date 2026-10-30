# PuenteGemelo

**Gemelo digital e inspección de puentes con nubes de puntos e inteligencia artificial.**
Programa de escritorio de código abierto (Windows, macOS y Linux) desarrollado en la tesis
*Implementación de una plataforma digital para la inspección de puentes históricos con inteligencia artificial: caso Puente Balta*
(Universidad Peruana de Ciencias Aplicadas, 2026).

> Herramienta de apoyo a la inspección. No reemplaza la evaluación de un ingeniero ni constituye una verificación de seguridad o de capacidad resistente.

## Qué hace

| Módulo | Descripción |
|---|---|
| **Tu puente** | Lee la nube de puntos de cualquier puente (PLY, LAS, XYZ/TXT/CSV, hasta 1,5 M puntos), detecta tablero y apoyos, ajusta la geometría (arcos con tablero superior, vigas, armadura Pratt), mide la completitud del levantamiento, arma un modelo 2D con los supuestos del usuario, calcula sus modos y entrena una IA propia (Random Forest) para localizar daño por vibración. Plan de inspección e informe. |
| **Frecuencias del usuario** | Si el usuario midió o calculó las frecuencias del puente, una IA entrenada solo con cambios de frecuencia propone la zona dañada, con control de dominio. Sin esos datos, la medición se simula. |
| **Sismo registrado** | Lee acelerogramas en texto (por ejemplo, de CISMID-UNI o del IGP — AcelDat-Perú), calcula el espectro de respuesta y la respuesta del puente por superposición modal (integración exacta de Nigam y Jennings) y la anima en 3D. Aproximación: excitación uniforme, modelo elástico y plano. |
| **Ejemplo: Puente Balta** | Modelo 2D verificado contra OpenSees 3.8.0 (450 casos, error relativo < 1e-11), modelo C con la geometría medida (f1 = 7,437 Hz), IA SVM-RBF de 19 clases, nube TLS, vista 3D, plan de inspección y protocolo de validación con evaluadores (SUS). |

Todo se calcula en la computadora del usuario; ningún dato sale a internet.

## Instalar

Descargue el instalador de la última versión en **Releases** del repositorio:

- Windows: `PuenteGemelo-x.y.z-Windows-instalador.exe` (Windows mostrará un aviso porque el instalador no está firmado: «Más información» → «Ejecutar de todas formas»).
- macOS: `PuenteGemelo-x.y.z-Mac.dmg` (sin firmar: clic derecho → Abrir).
- Linux: `PuenteGemelo-x.y.z-Linux.AppImage` (dar permiso de ejecución).

También funciona en el navegador: https://casvilluis-afk.github.io/Balta-viewer/plataforma/

## Proyectos

`Archivo → Guardar proyecto` crea un archivo `.puente` con la nube (muestra de hasta 500 000 puntos), apoyos, geometría, supuestos, modos y la IA entrenada. `Archivo → Abrir proyecto` lo continúa.

## Desarrollo

```bash
cd app
npm install          # Electron, electron-builder y Three.js
npm test             # pruebas del núcleo de cálculo
npm start            # abre la app en modo desarrollo
npm run dist         # genera el instalador del sistema actual en app/dist
```

La interfaz es la misma plataforma web de `plataforma/` (HTML y JavaScript sin compilación). `tools/prepare.js` la copia a `app/web` con Three.js y el modelo 3D locales.
Los instaladores se generan en GitHub Actions al publicar una etiqueta `app-vX.Y.Z` (`.github/workflows/app.yml`).

| Archivo | Contenido |
|---|---|
| `plataforma/index.html` | Interfaz, solver 2D (réplica del script de OpenSees), modelo C, IA del Balta, láminas |
| `plataforma/op_core.js` | Núcleo: lectura de nubes, geometría, modelos 2D, modos, campañas de daño, Random Forest, sismo |
| `plataforma/op_ui.js` | Interfaz de «Tu puente» |
| `plataforma/v3d.js` | Vista 3D a pantalla completa |
| `plataforma/codigo/` | Scripts de Python que generaron los modelos de IA del Balta |
| `app/src/` | Proceso principal de Electron, menú y capa de escritorio |
| `app/tests/run.js` | Pruebas: viga analítica, modelo C (7,437 Hz), Nigam-Jennings vs Newmark, lectura de acelerogramas |

## Licencias

Código: **MIT** (`app/LICENSE`). Datos del Puente Balta: **CC BY 4.0** (`app/DATA_LICENSE.md`).

## Cómo citar

Ver `CITATION.cff` en la raíz del repositorio.

---

### English summary

PuenteGemelo is an open-source desktop application (Electron) for point-cloud-based digital twins of bridges: geometry extraction, 2D finite-element modal models, vibration-based damage localization with machine learning trained per bridge, response to recorded ground motions, and inspection planning. Case study: the 1871 cast-iron arch Balta Bridge in Lima, Peru. Code under MIT; Balta data under CC BY 4.0.
