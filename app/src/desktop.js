/* PuenteGemelo · capa de escritorio: pantalla de inicio, proyectos .puente y órdenes del menú.
   Usa las funciones globales de la plataforma: show, OP, OPC, vTu, opModelG, toast, download, esc. */
(function () {
  'use strict';
  const OP0 = JSON.parse(JSON.stringify(OP));
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
  const plain = (k, v) => ArrayBuffer.isView(v) ? Array.from(v) : v;
  const MAXP = 500000;

  /* ---------- pantalla de inicio ---------- */
  function inicio(on) {
    let el = document.getElementById('inicio');
    if (!on) { if (el) el.hidden = true; return; }
    if (!el) {
      el = document.createElement('div'); el.id = 'inicio'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Inicio');
      el.innerHTML = `<div class="in-card">
        <div class="in-head"><img src="docs/icono.png" alt=""><div><h1>PuenteGemelo</h1><p>Gemelo digital e inspección de puentes con nubes de puntos e inteligencia artificial</p></div></div>
        <div class="in-grid">
         <button class="in-act" data-a="nuevo"><b>Nuevo puente</b><span>Cargue la nube de puntos de un puente (PLY, LAS, XYZ, CSV). La app detecta tablero y apoyos, ajusta la geometría, arma el modelo, calcula sus modos y entrena una IA para ese puente.</span></button>
         <button class="in-act" data-a="abrir"><b>Abrir proyecto…</b><span>Continúe un proyecto guardado (.puente): nube, geometría, supuestos, modos e IA entrenada.</span></button>
         <button class="in-act" data-a="ejemplo"><b>Proyecto de ejemplo: Puente Balta</b><span>Puente de arcos de fierro fundido sobre el río Rímac (Lima, 1871): modelo verificado con OpenSees, dinámica, sismo, IA de diagnóstico y plan de inspección.</span></button>
        </div>
        <p class="in-foot">Código abierto (MIT) · datos del Puente Balta CC BY 4.0 · Luis Ñuñuvero Castillo y Anthony Tarazona Cerna · <span id="inVer"></span><br>Herramienta de apoyo a la inspección: no reemplaza la evaluación de un ingeniero.</p>
       </div>`;
      document.body.append(el);
      el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => run(b.dataset.a));
      if (window.desk) window.desk.version().then(v => { const s = document.getElementById('inVer'); if (s) s.textContent = 'versión ' + v; });
    }
    el.hidden = false;
  }

  /* ---------- proyectos ---------- */
  function guardar() {
    if (!OP.cloud || !OP.O) { toast('Primero cargue un puente en «Tu puente».'); show('tupuente'); return; }
    const c = OP.cloud, n = c.xyz.length / 3, step = n > MAXP ? n / MAXP : 1, m = Math.min(n, MAXP), f = new Float32Array(3 * m);
    for (let j = 0; j < m; j++) { const i = Math.floor(j * step); f[3 * j] = c.xyz[3 * i]; f[3 * j + 1] = c.xyz[3 * i + 1]; f[3 * j + 2] = c.xyz[3 * i + 2]; }
    const K = 'tu:' + (OP.name || 'sin nombre');
    const P = {
      formato: 'PuenteGemelo', version: 1, guardado: new Date().toISOString(), nombre: OP.name,
      nube: { puntos: m, total: c.total, usados: c.kept, offset: c.offset, eje_vertical: OP.up || 'z', escala: OP.unit || 1, xyz_float32_base64: b64(new Uint8Array(f.buffer)) },
      estado: { step: OP.step, deckTop: OP.deckTop, deckThick: OP.deckThick, ground: OP.ground, zSlab: OP.zSlab, supports: OP.supports, ends: OP.ends, type: OP.type, band: OP.band, minPts: OP.minPts, geo: OP.geo, mat: OP.mat, P: OP.P, nz: OP.nz, dx: OP.dx, camp: OP.camp, ia: OP.ia },
      expediente: typeof PG !== 'undefined' ? PG.I[K] || null : null, mantenimiento: typeof PG !== 'undefined' ? PG.det[K] || null : null
    };
    const nombre = (OP.name || 'puente').replace(/\.[a-z0-9]+$/i, '').replace(/[^\wáéíóúñÁÉÍÓÚÑ -]+/g, '').trim() || 'puente';
    download(nombre + '.puente', 'application/json', JSON.stringify(P, plain));
    toast(m < n ? `Proyecto guardado con una muestra de ${m.toLocaleString('es-PE')} puntos de la nube.` : 'Proyecto guardado.');
  }
  function abrirTexto(text) {
    try {
      const P = JSON.parse(text); if (P.formato !== 'PuenteGemelo') throw new Error('El archivo no es un proyecto de PuenteGemelo.');
      const u8 = unb64(P.nube.xyz_float32_base64), xyz = new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4);
      Object.assign(OP, JSON.parse(JSON.stringify(OP0)), P.estado);
      OP.cloud = { xyz, total: P.nube.total, kept: P.nube.usados, offset: P.nube.offset }; OP.name = P.nombre; OP.up = P.nube.eje_vertical; OP.unit = P.nube.escala;
      OP.O = OPC.orient(OP.cloud, OP.up, OP.unit);
      if (OP.geo && OP.P) { try { OP.model = OPC.build(OP.type, opModelG(), OP.P); OP.modes = OPC.modal(OP.model, 6); OP.modes.ms = 0; OP.modeSel = 0; } catch (e) { OP.model = OP.modes = null; } }
      if (!OP.modes) { OP.camp = OP.ia = null; }
      if (typeof PG !== 'undefined') { const K = 'tu:' + (OP.name || 'sin nombre'); if (P.expediente) PG.I[K] = P.expediente; if (P.mantenimiento) PG.det[K] = P.mantenimiento; pgSave(); }
      OP.step = Math.min(OP.step || 1, OP.ia ? 7 : OP.modes ? 5 : OP.geo ? 4 : 2);
      inicio(false); show('tupuente'); toast(`Proyecto «${P.nombre}» abierto.`);
    } catch (e) { toast('No se pudo abrir el proyecto: ' + e.message); }
  }
  function abrirDialogo() {
    let i = document.getElementById('abrirProy');
    if (!i) { i = document.createElement('input'); i.type = 'file'; i.id = 'abrirProy'; i.accept = '.puente,.json'; i.hidden = true; document.body.append(i);
      i.onchange = async () => { const f = i.files[0]; if (f) abrirTexto(await f.text()); i.value = ''; }; }
    i.click();
  }
  function nuevo() { if (OP.worker) { try { OP.worker.terminate(); } catch (e) {} } Object.assign(OP, JSON.parse(JSON.stringify(OP0))); inicio(false); show('tupuente'); }

  function run(a, arg) {
    if (a === 'nuevo') nuevo();
    else if (a === 'abrir') abrirDialogo();
    else if (a === 'abrir-proyecto-texto') abrirTexto(arg);
    else if (a === 'guardar-proyecto') guardar();
    else if (a === 'ejemplo') { inicio(false); show('modelo'); }
    else if (a === 'inicio') inicio(true);
    else if (a === 'dxf') { inicio(false); if (S.view === 'tupuente') opPlans(); else baltaPlans(); }
  }
  window.PG = { run, guardar, abrirTexto };
  if (window.desk) window.desk.onMenu(run);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { const el = document.getElementById('inicio'); if (el && !el.hidden && S.view) inicio(false); } });
  // la marca de la barra superior abre el inicio
  const mk = document.querySelector('.mark'); if (mk) { mk.style.cursor = 'pointer'; mk.title = 'Inicio'; mk.onclick = () => inicio(true); const b = mk.querySelector('b'); if (b) b.textContent = 'PuenteGemelo'; const s = mk.querySelector('span'); if (s) s.textContent = 'Gemelo digital e inspección de puentes'; }
  document.title = 'PuenteGemelo';
  inicio(true);
})();
