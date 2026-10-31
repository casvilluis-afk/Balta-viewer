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
| **Estado del puente** | Pantalla de inicio del gemelo digital: índice de salud, calificación MTC, último diagnóstico de la IA, modelo de referencia, carga HL-93, vida proyectada, próxima inspección, alertas, seguimiento de las frecuencias medidas en el tiempo y línea de tiempo con cada medición, diagnóstico, calibración, evaluación e inspección (se guarda en el proyecto). |
| **IA con formas modales** | Con 3 o más sensores, la IA se entrena para la configuración medida (modos y sensores) con frecuencias y cambios de forma modal. Prueba con puentes distintos del modelo (rigidez de cada elemento ±8 %, E −4 %; 160 casos de daño en 20 zonas, incluidos pilares): zona exacta 50 % frente a 21 % solo con frecuencias; vano 75 %; sin falsas alarmas. Entrenada con error de modelo de ±5 % por elemento. |
| **Campañas de medición** | Varios registros a la vez: modos persistentes (los que aparecen en la mayoría de los registros), espectro promedio, efecto de la temperatura por modo (df/dT) y frecuencias compensadas a una temperatura de referencia. Línea base medida del puente sano: la IA compara cada medición con ella y usa el modelo solo para aprender cómo cambian frecuencias y formas con el daño. Validado con datos reales públicos de OpenBridgeLAB (TU Dresden). |
| **Calibración del modelo** | Ajusta E, peralte, módulo de pilares (y opcionalmente el peso) para reproducir las frecuencias y formas medidas (Nelder-Mead acotado). El modelo calibrado puede usarse como referencia de la IA y de los demás análisis. |
| **Vibración medida (OMA)** | Lee registros de acelerómetros o del celular (CSV de phyphox, multicanal), asigna cada canal a un punto del tablero e identifica frecuencias, amortiguamientos y formas modales con FDD/EFDD (dos valores singulares, campana del modo, autocorrelación). Empareja cada modo con el modelo por MAC, estima el ajuste global de rigidez y envía las frecuencias a la IA de diagnóstico (que se entrena con exactamente los modos medidos). Incluye una señal de prueba con daño oculto para validar la cadena medición → IA. |
| **Inspección de campo** | Ficha según la Guía para Inspección de Puentes del MTC (Directiva 01-2006-MTC/14): inventario (Anexo 03-01), tipo de inspección, calificación global 0–5 y por elemento, estados de condición CS1–CS4 por cantidades, defectos con severidad, panel fotográfico desde el celular o la cámara, índice de salud e informe imprimible. La IA sugiere qué elemento inspeccionar primero. |
| **Carga vehicular HL-93** | Líneas de influencia del modelo y envolventes del camión, tándem y carril del Manual de Puentes MTC 2018 (IM 33 %, presencia múltiple), combinación Resistencia I, flechas contra L/800 y factor de capacidad RF por esfuerzos con las resistencias que ingrese el usuario. Vista 3D en el Balta. |
| **Deterioro y mantenimiento** | Cadenas de Markov por elemento a partir de la última inspección, calibración de los tiempos con el historial de inspecciones, pronóstico del índice de salud, vida hasta el umbral y plan de intervenciones con presupuesto anual. |
| **Planos DXF** | Exporta un juego de láminas A3 con cajetín (elevación general, levantamiento TLS con el intradós ajustado, formas modales y plan de verificación con sensores), en metros y por capas, para AutoCAD, BricsCAD, LibreCAD o DraftSight. No requiere AutoCAD instalado. |
| **Ejemplo: Puente Balta** | Modelo 2D verificado contra OpenSees 3.8.0 (450 casos, error relativo < 1e-11), modelo C con la geometría medida (f1 = 7,437 Hz), IA SVM-RBF de 19 clases, nube TLS, vista 3D, plan de inspección y protocolo de validación con evaluadores (SUS). |

Todo se calcula en la computadora del usuario; ningún dato sale a internet.

## Limitaciones conocidas

- El modelo del Puente Balta aún no se compara con mediciones del puente (E, peso del tablero, nervios y peralte son supuestos).
- Modelo estructural 2D: sin torsión ni reparto transversal; esfuerzos de montantes sobreestimados.
- IA entrenada con simulaciones; con datos reales de OpenBridgeLAB (TU Dresden) el efecto ambiental fue del orden del daño, por eso se usa línea base medida y se informa «cambio no explicado».
- Fierro fundido: factor de capacidad solo con resistencias de ensayo. Sismo: registros y comportamiento elástico, sin espectro de norma.
- Deterioro: tiempos de transición supuestos hasta calibrarlos con inspecciones.

## Instalar

Descargue el instalador de la última versión en **Releases** del repositorio:

- Windows: `PuenteGemelo-x.y.z-Windows-instalador.exe` (Windows mostrará un aviso porque el instalador no está firmado: «Más información» → «Ejecutar de todas formas»).
- macOS: `PuenteGemelo-x.y.z-Mac.dmg` (sin firmar: clic derecho → Abrir).
- Linux: `PuenteGemelo-x.y.z-Linux.AppImage` (dar permiso de ejecución).

También funciona en el navegador: https://casvilluis-afk.github.io/Balta-viewer/plataforma/

## Proyectos

`Archivo → Guardar proyecto` crea un archivo `.puente` con la nube (muestra de hasta 500 000 puntos), apoyos, geometría, supuestos, modos, la IA entrenada y el expediente de inspecciones con sus fotos. `Archivo → Abrir proyecto` lo continúa.

## Desarrollo

```bash
cd app
npm install          # Electron, electron-builder y Three.js
npm test             # pruebas del núcleo de cálculo
npm start            # abre la app en modo desarrollo
npm run dist         # genera el instalador del sistema actual en app/dist
```

La interfaz es la misma plataforma web de `plataforma/` (HTML y JavaScript sin compilación). `tools/prepare.js` la copia a `app/web` con Three.js y el modelo 3D locales.
Los instaladores se generan en GitHub Actions cada vez que se suben cambios de `app/` o `plataforma/` a main; el release `app-vX.Y.Z` toma la versión de `app/package.json` (`.github/workflows/app.yml`).

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

PuenteGemelo is an open-source desktop application (Electron) for point-cloud-based digital twins of bridges: geometry extraction, 2D finite-element modal models, vibration-based damage localization with machine learning trained per bridge, operational modal analysis (FDD/EFDD) of measured vibrations, element-level field inspection following Peru's MTC bridge inspection guide, HL-93 live-load rating with influence lines, Markov deterioration forecasting with budget-constrained maintenance planning, response to recorded ground motions, and DXF drawings. Case study: the 1871 cast-iron arch Balta Bridge in Lima, Peru. Code under MIT; Balta data under CC BY 4.0.
