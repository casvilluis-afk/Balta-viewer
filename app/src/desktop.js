/* PuenteGemelo · capa de escritorio: pantalla de inicio, proyectos .puente y órdenes del menú.
   Usa las funciones globales de la plataforma: show, OP, PB (biblioteca de puentes), toast, esc. */
(function () {
  'use strict';

  /* ---------- pantalla de inicio ---------- */
  function inicio(on) {
    let el = document.getElementById('inicio');
    if (!on) { if (el) el.hidden = true; return; }
    if (!el) {
      el = document.createElement('div'); el.id = 'inicio'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Inicio');
      el.innerHTML = `<div class="in-card">
        <div class="in-head"><img src="docs/icono.png" alt=""><div><h1>PuenteGemelo</h1><p>Inspección de puentes históricos con su gemelo digital e inteligencia artificial</p></div></div>
        <div class="in-grid">
         <button class="in-act" data-a="puentes"><b>Mis puentes</b><span>Continúe con un puente que ya agregó: inspecciones, mediciones, estado y mantenimiento.</span></button>
         <button class="in-act" data-a="nuevo"><b>Agregar un puente</b><span>Cargue su nube de puntos (PLY, LAS, XYZ o CSV). La app arma el modelo y entrena una IA para ese puente. Se hace una sola vez.</span></button>
         <button class="in-act" data-a="abrir"><b>Abrir un archivo .puente</b><span>Un puente exportado desde la web o desde otra computadora.</span></button>
         <button class="in-act" data-a="ejemplo"><b>Ver el ejemplo: Puente Balta</b><span>Un puente ya estudiado (Lima, 1871), para conocer la app antes de cargar el suyo.</span></button>
        </div>
        <p class="in-foot">Código abierto (MIT) · datos del Puente Balta CC BY 4.0 · Luis Ñuñuvero Castillo y Anthony Tarazona Cerna · <span id="inVer"></span><br>Herramienta de apoyo a la inspección: no reemplaza la evaluación de un ingeniero.</p>
       </div>`;
      document.body.append(el);
      el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => run(b.dataset.a));
      if (window.desk) window.desk.version().then(v => { const s = document.getElementById('inVer'); if (s) s.textContent = 'versión ' + v; });
    }
    el.hidden = false;
  }

  /* ---------- proyectos: la biblioteca de puentes (pg_puentes.js) es la misma en web y escritorio ---------- */
  function guardar() { if (PB.active === 'balta' || !OP.cloud) { toast('El ejemplo Balta no se exporta; abra o cree un puente propio.'); show('puentes'); return; } pbExport(OP.id); }
  function abrirTexto(text) { inicio(false); pbImportText(text); }
  function abrirDialogo() { inicio(false); pbImportDialog(); }
  function nuevo() { inicio(false); pbNew(); }

  function run(a, arg) {
    if (a === 'nuevo') nuevo();
    else if (a === 'abrir') abrirDialogo();
    else if (a === 'abrir-proyecto-texto') abrirTexto(arg);
    else if (a === 'guardar-proyecto') guardar();
    else if (a === 'ejemplo') { inicio(false); pbActivate('balta', { go: 'estado' }); }
    else if (a === 'puentes') { inicio(false); show('puentes'); }
    else if (a === 'inicio') inicio(true);
    else if (a === 'acerca') { inicio(false); if (typeof pgAbout === 'function') pgAbout(); }
    else if (a === 'dxf') { inicio(false); if (PB.active !== 'balta' && OP.geo) opPlans(); else if (PB.active === 'balta') baltaPlans(); else toast('Complete la geometría del puente antes de exportar planos.'); }
  }
  window.PGapp = { run, guardar, abrirTexto };
  if (window.desk) window.desk.onMenu(run);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { const el = document.getElementById('inicio'); if (el && !el.hidden && S.view) inicio(false); } });
  // la marca de la barra superior abre el inicio
  const mk = document.querySelector('.mark'); if (mk) { mk.style.cursor = 'pointer'; mk.title = 'Inicio'; mk.onclick = () => inicio(true); const b = mk.querySelector('b'); if (b) b.textContent = 'PuenteGemelo'; const s = mk.querySelector('span'); if (s) s.textContent = 'Gemelo digital e inspección de puentes'; }
  document.title = 'PuenteGemelo';
  // en escritorio la guía se abre desde el menú Ayuda
  const gb = document.getElementById('btnGuia'); if (gb) gb.onclick = e => { e.preventDefault(); if (window.desk && window.desk.manual) window.desk.manual(); else toast('La guía está en Ayuda → Manual de uso.'); };
  inicio(true);
})();
