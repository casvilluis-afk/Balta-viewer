/* ============================================================
   Tu puente · interfaz (pestaña 8)
   Usa OPC (op_core.js) y las utilidades de la página: $, fmt, pct, sgn, css, esc, sheet, legendRow, toast, download.
   ============================================================ */
"use strict";
const OP = { step: 1, cloud: null, O: null, info: null, deckTop: null, deckThick: 0.2, ground: null, supports: [], ends: { left: 'simetria', right: 'simetria' },
  type: 'arco', band: null, minPts: 15, geo: null, mat: 'fierro', P: null, model: null, modes: null, camp: null, ia: null, worker: null, busy: false, dx: { zone: 0, sev: .3, lev: 1, n: 1 }, name: '' };
const OP_STEPS = [['nube', 'Nube de puntos'], ['apoyos', 'Tablero y apoyos'], ['geometria', 'Geometría y completitud'], ['modelo', 'Modelo y modos'], ['ia', 'Entrenar la IA'], ['diagnostico', 'Diagnóstico con IA'], ['plan', 'Plan e informe']];
const OP_DEFAULTS = {
  arco: { rib_h: .70, n_ribs: 6, I_factor: 1, deck_A: .36, deck_I: .005, post_A: .05, post_I: 5e-4, E_pier: 5, pier_t: 3, width: 12.15, w_deck: 120, springing: 'fixed' },
  viga: { deck_A: .60, deck_I: .35, w_deck: 80 },
  armadura: { panels: 10, truss_h: 5, chord_A: .03, chord_I: 2e-4, web_A: .015, web_I: 5e-5, w_deck: 60 } };
const OP_PARAMS = {
  arco: [['rib_h', 'Peralte del nervio', 'm', .01], ['n_ribs', 'Nervios por arco', '', 1], ['deck_A', 'Área del tablero', 'm²', .01], ['deck_I', 'Inercia del tablero', 'm⁴', .001], ['post_A', 'Área de montante', 'm²', .005], ['post_I', 'Inercia de montante', 'm⁴', 1e-4], ['E_pier', 'Módulo de pilares', 'GPa', .5], ['pier_t', 'Espesor de pilar', 'm', .1], ['width', 'Ancho de pilar', 'm', .1], ['w_deck', 'Peso del tablero', 'kN/m', 1]],
  viga: [['deck_A', 'Área de la sección', 'm²', .01], ['deck_I', 'Inercia de la sección', 'm⁴', .01], ['w_deck', 'Peso del tablero', 'kN/m', 1]],
  armadura: [['panels', 'Paneles por vano', '', 2], ['truss_h', 'Altura de la armadura', 'm', .1], ['chord_A', 'Área de cordones', 'm²', .005], ['chord_I', 'Inercia de cordones', 'm⁴', 1e-5], ['web_A', 'Área de diagonales y montantes', 'm²', .005], ['web_I', 'Inercia de diagonales', 'm⁴', 1e-5], ['w_deck', 'Peso del tablero', 'kN/m', 1]] };
const OP_TYPES = { arco: 'Arcos con tablero superior', viga: 'Vigas (simple o continua)', armadura: 'Armadura Pratt, tablero inferior' };

function vTu() {
  const done = k => ({ nube: !!OP.O, apoyos: OP.supports.length > 0 && OP.deckTop != null, geometria: !!OP.geo, modelo: !!OP.modes, ia: !!OP.ia, diagnostico: !!OP.ia, plan: !!OP.ia }[k]);
  $('#left').innerHTML = `<div class="ph">Tu puente · pasos</div><ul class="tree">${OP_STEPS.map(([k, l], i) => `<li><button data-s="${i + 1}" aria-pressed="${OP.step === i + 1}" ${i > 0 && !done(OP_STEPS[i - 1][0]) ? 'disabled style="opacity:.45;cursor:default"' : ''}><span class="sq" ${done(k) ? 'style="background:var(--ok);border-color:var(--ok)"' : ''}></span>${i + 1}. ${l}<span class="ct">${done(k) ? 'listo' : ''}</span></button></li>`).join('')}</ul>
    <div class="pb help">Reproduce el método del Balta con otra nube: geometría desde los puntos, modelo con los supuestos que usted ingrese y una IA entrenada para ese puente. Todo se calcula en este navegador; la nube no se sube a ningún servidor.</div>`;
  $('#left').querySelectorAll('.tree button').forEach(b => b.onclick = () => { if (b.disabled) return; OP.step = +b.dataset.s; vTu(); });
  [opNube, opApoyos, opGeometria, opModelo, opIA, opDiag, opPlan][OP.step - 1]();
}
function opNext(label = 'Continuar') { return `<div style="display:flex;justify-content:flex-end"><button class="btn" id="opNext">${label} →</button></div>`; }
function opBindNext() { const b = $('#opNext'); if (b) b.onclick = () => { OP.step++; vTu(); }; }

/* ---------- 1 · Nube ---------- */
function opNube() {
  $('#canvas').innerHTML = `<div class="doc"><h2>1 · Cargar la nube de puntos</h2>
   <p>Formatos: PLY (ASCII o binario), LAS, XYZ, TXT o CSV con x, y, z en las tres primeras columnas. Se leen hasta 1,5 millones de puntos; si el archivo tiene más, se toma una muestra aleatoria. Los archivos E57 y LAZ deben convertirse antes en CloudCompare (Archivo → Guardar como → PLY binario).</p>
   <div id="opDrop" style="border:1.5px dashed var(--rule);padding:22px;text-align:center;display:grid;gap:8px;justify-items:center">
    <span>Arrastre aquí su archivo o</span><label class="btn" style="display:inline-block">Elegir archivo<input type="file" id="opFile" accept=".ply,.las,.xyz,.txt,.csv,.pts,.asc,.e57,.laz" hidden></label>
    <span class="help">También puede probar el flujo con la nube del Balta (186 442 puntos).</span><button class="btn line" id="opDemo">Usar la nube del Balta</button></div>
   <div style="display:flex;gap:12px;flex-wrap:wrap"><label class="f" style="width:200px">Eje vertical de la nube<select id="opUp"><option value="z">Z hacia arriba</option><option value="y">Y hacia arriba</option></select></label>
    <label class="f" style="width:200px">Unidades del archivo<select id="opUnit"><option value="1">metros</option><option value="0.01">centímetros</option><option value="0.001">milímetros</option></select></label></div>
   <div id="opLoad" class="help"></div></div><div id="opInfo"></div>`;
  const go = async (blob, name) => {
    try { OP.busy = true; $('#opLoad').textContent = 'Leyendo ' + name + '…';
      const c = await OPC.parseCloud(blob, name, async q => { $('#opLoad').textContent = `Leyendo ${name}… ${Math.round(100 * q)} %`; await new Promise(r => setTimeout(r, 0)); });
      opSetCloud(c, name, 15 * Math.min(1, c.kept / Math.max(c.kept, 601243)));
    } catch (e) { $('#opLoad').innerHTML = `<div class="msg crit"><b>No se pudo leer el archivo.</b> ${esc(e.message)}</div>`; } finally { OP.busy = false; } };
  $('#opFile').onchange = e => { const f = e.target.files[0]; if (f) go(f, f.name); };
  const dz = $('#opDrop'); dz.ondragover = e => { e.preventDefault(); dz.style.borderColor = 'var(--ink)'; }; dz.ondragleave = () => dz.style.borderColor = ''; dz.ondrop = e => { e.preventDefault(); dz.style.borderColor = ''; const f = e.dataTransfer.files[0]; if (f) go(f, f.name); };
  $('#opDemo').onclick = async () => { $('#opLoad').textContent = 'Cargando la nube del Balta…';
    try { const d = await fetch('data/nube_balta.json').then(r => { if (!r.ok) throw 0; return r.json(); }), b64 = t => Uint8Array.from(atob(t), ch => ch.charCodeAt(0)), q = new Uint16Array(b64(d.pos).buffer), xyz = new Float32Array(3 * d.n);
      for (let i = 0; i < d.n; i++) for (let k = 0; k < 3; k++) xyz[3 * i + k] = d.lo[k] + q[3 * i + k] / 65535 * (d.hi[k] - d.lo[k]);
      $('#opUp').value = 'z'; $('#opUnit').value = '1'; opSetCloud({ xyz, total: d.n_original, kept: d.n, offset: [0, 0, 0] }, 'Puente Balta (muestra de la nube TLS)', Math.max(3, Math.round(15 * d.n / d.n_original)));
    } catch (e) { $('#opLoad').innerHTML = '<div class="msg crit"><b>No se pudo cargar la nube de ejemplo.</b></div>'; } };
  opInfo(); opRightHelp('Una nube de un puente completo, ya limpia de vegetación y vehículos en lo posible. El eje longitudinal se obtiene por componentes principales; si la nube ya está alineada con x o y se conservan sus coordenadas.');
}
function opSetCloud(c, name, minPts) {
  OP.cloud = c; OP.name = name; OP.up = $('#opUp').value; OP.unit = +$('#opUnit').value; OP.O = OPC.orient(c, OP.up, OP.unit); OP.minPts = Math.max(3, Math.round(minPts));
  OP.deckTop = OPC.deckLevel(OP.O); OP.ground = OPC.groundLevel(OP.O); const S = OPC.detectSupports(OP.O, OP.deckTop, OP.ground); OP.supports = S.supports.map(p => ({ ...p })); OP.zSlab = S.zSlab; const sp = OP.supports; OP.ends = { left: sp.length && sp[0].tipo === 'estribo' ? 'none' : 'simetria', right: sp.length && sp[sp.length - 1].tipo === 'estribo' ? 'none' : 'simetria' };
  OP.band = { zmin: OP.ground + .2 * (OP.deckTop - OP.ground), zmax: OP.deckTop - .38 }; OP.geo = OP.model = OP.modes = OP.camp = OP.ia = null;
  $('#opLoad').textContent = ''; opInfo(); vTu();
}
function opInfo() { if (!OP.O || !$('#opInfo')) return; const [s0, s1] = OPC.bounds(OP.O.s), [z0, z1] = OPC.bounds(OP.O.z);
  $('#opInfo').innerHTML = `<div class="doc"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline"><h2>${esc(OP.name)}</h2><span class="mono dim" style="font-size:.76rem">${OP.cloud.kept.toLocaleString('es-PE')} puntos usados de ${OP.cloud.total.toLocaleString('es-PE')}</span></div>
   <div class="tw"><table class="data"><tbody><tr><td>Longitud</td><td class="n">${fmt(s1 - s0, 2)} m</td><td>Desnivel</td><td class="n">${fmt(z1 - z0, 2)} m</td><td>Eje longitudinal</td><td class="n">${OP.O.snap == null ? 'girado ' + fmt(OP.O.angleDeg, 1) + '°' : (OP.O.snap === 0 ? 'eje x de la nube' : 'eje y de la nube')}</td></tr></tbody></table></div>
   <canvas id="opElev" style="width:100%;height:280px;display:block;background:var(--sheet);border:1px solid var(--rule)"></canvas><p class="help">Elevación de la nube (densidad de puntos). Escala vertical exagerada para ver los arcos y apoyos.</p></div>${opNext()}`;
  opDrawElev({}); opBindNext(); }

/* ---------- dibujo de la elevación ---------- */
function opMap(cv) { const [s0, s1] = OPC.bounds(OP.O.s), z0 = Math.min(OP.ground, OPC.bounds(OP.O.z)[0]), z1 = OPC.bounds(OP.O.z)[1], pad = 30, W = cv.width, H = cv.height;
  return { X: s => pad + (s - s0) / (s1 - s0) * (W - 2 * pad), Z: z => H - pad - (z - z0) / (z1 - z0) * (H - 2 * pad), S: x => s0 + (x - pad) / (W - 2 * pad) * (s1 - s0), s0, s1, z0, z1 }; }
function opDrawElev({ overlay = null }) {
  const cv = $('#opElev'); if (!cv) return; const dpr = Math.min(2, devicePixelRatio || 1); cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
  const g = cv.getContext('2d'), M = opMap(cv), W = cv.width, H = cv.height, acc = new Float32Array(W * H);
  for (let i = 0; i < OP.O.n; i++) { const x = Math.round(M.X(OP.O.s[i])), y = Math.round(M.Z(OP.O.z[i])); if (x >= 0 && x < W && y >= 0 && y < H) acc[y * W + x]++; }
  let mx = 0; for (const v of acc) if (v > mx) mx = v; const lm = Math.log1p(mx), img = g.createImageData(W, H), ink = hex(css('--ink')), bg = hex(css('--sheet'));
  for (let i = 0; i < acc.length; i++) { const t = acc[i] ? .25 + .75 * Math.log1p(acc[i]) / lm : 0; for (let k = 0; k < 3; k++) img.data[4 * i + k] = Math.round(bg[k] + (ink[k] - bg[k]) * t); img.data[4 * i + 3] = 255; }
  g.putImageData(img, 0, 0); g.save(); g.scale(1, 1); g.lineWidth = 1.2 * dpr; g.font = `${10 * dpr}px "DM Mono", monospace`;
  const line = (z, col, lab, dash = []) => { g.strokeStyle = col; g.setLineDash(dash.map(v => v * dpr)); g.beginPath(); g.moveTo(M.X(M.s0), M.Z(z)); g.lineTo(M.X(M.s1), M.Z(z)); g.stroke(); g.setLineDash([]); g.fillStyle = col; g.fillText(lab, M.X(M.s0) + 4, M.Z(z) - 4); };
  if (OP.deckTop != null) line(OP.deckTop, css('--blue'), 'superficie del tablero');
  if (overlay) overlay(g, M, dpr);
  OP.supports.forEach((p, i) => { g.fillStyle = 'rgba(196,22,28,.18)'; const x0 = M.X(p.a), x1 = Math.max(M.X(p.b), x0 + 2 * dpr); g.fillRect(x0, 0, x1 - x0, H); g.strokeStyle = css('--red'); g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0, H); g.moveTo(x1, 0); g.lineTo(x1, H); g.stroke(); g.fillStyle = css('--red'); g.fillText((p.tipo === 'estribo' ? 'E' : 'P') + (i + 1), x0 + 3, 14 * dpr); });
  g.fillStyle = css('--ink-3'); for (let s = Math.ceil(M.s0 / 10) * 10; s <= M.s1; s += 10) g.fillText(s + ' m', M.X(s) - 10 * dpr, H - 8 * dpr);
  g.restore(); return M;
}
function hex(c) { c = c.replace('#', ''); if (c.length === 3) c = c.split('').map(x => x + x).join(''); return [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16)); }
function opRightHelp(t) { $('#right').innerHTML = `<div class="ph">Ayuda</div><div class="pb" style="font-size:.84rem">${t}</div>`; }

/* ---------- 2 · Tablero y apoyos ---------- */
function opApoyos() {
  $('#canvas').innerHTML = `<div class="doc"><h2>2 · Tablero y apoyos</h2>
   <p>La plataforma estima la superficie del tablero y las caras de pilares y estribos. Revise los valores sobre la elevación y corríjalos si hace falta. Para agregar un apoyo, haga clic en la elevación.</p>
   <canvas id="opElev" style="width:100%;height:300px;display:block;background:var(--sheet);border:1px solid var(--rule);cursor:crosshair"></canvas>
   <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end"><label class="f" style="width:170px">Superficie del tablero (m)<input type="number" id="opDeck" step="0.01" value="${OP.deckTop.toFixed(2)}"></label>
    <label class="f" style="width:170px">Espesor tablero → eje (m)<input type="number" id="opThick" step="0.05" value="${OP.deckThick}"></label>
    <label class="f" style="width:170px">Cota del terreno o agua (m)<input type="number" id="opGround" step="0.1" value="${OP.ground.toFixed(2)}"></label>
    <button class="btn line" id="opRedetect">Detectar apoyos otra vez</button></div>
   <h3>Apoyos (caras en metros a lo largo del puente)</h3><div class="tw" id="opSupTbl"></div>
   <div style="display:flex;gap:12px;flex-wrap:wrap"><label class="f" style="width:260px">Extremo izquierdo<select id="opEndL"><option value="simetria">Sin estribo visible: completar por simetría</option><option value="none">El primer apoyo es el estribo</option></select></label>
    <label class="f" style="width:260px">Extremo derecho<select id="opEndR"><option value="simetria">Sin estribo visible: completar por simetría</option><option value="none">El último apoyo es el estribo</option></select></label></div>
   <p class="help">"Completar por simetría" cierra el vano extremo con la misma luz que da el arco ajustado respecto de su clave (para vigas y armaduras se usa la luz del vano vecino).</p></div>${opNext()}`;
  $('#opEndL').value = OP.ends.left; $('#opEndR').value = OP.ends.right;
  const redraw = () => { opSupTable(); opDrawElev({}); };
  $('#opDeck').onchange = e => { OP.deckTop = +e.target.value; OP.band.zmax = OP.deckTop - .38; OP.geo = null; redraw(); };
  $('#opThick').onchange = e => { OP.deckThick = +e.target.value; OP.geo = null; };
  $('#opGround').onchange = e => { OP.ground = +e.target.value; OP.band.zmin = OP.ground + .2 * (OP.deckTop - OP.ground); OP.geo = null; redraw(); };
  $('#opEndL').onchange = e => { OP.ends.left = e.target.value; OP.geo = null; }; $('#opEndR').onchange = e => { OP.ends.right = e.target.value; OP.geo = null; };
  $('#opRedetect').onclick = () => { const S = OPC.detectSupports(OP.O, OP.deckTop, OP.ground); OP.supports = S.supports; const sp = OP.supports; OP.ends = { left: sp.length && sp[0].tipo === 'estribo' ? 'none' : 'simetria', right: sp.length && sp[sp.length - 1].tipo === 'estribo' ? 'none' : 'simetria' }; $('#opEndL').value = OP.ends.left; $('#opEndR').value = OP.ends.right; OP.geo = null; redraw(); };
  $('#opElev').onclick = ev => { const cv = $('#opElev'), r = cv.getBoundingClientRect(), M = opMap(cv), s = M.S((ev.clientX - r.left) * cv.width / r.width); OP.supports.push({ a: +(s - .5).toFixed(2), b: +(s + .5).toFixed(2), tipo: 'pilar' }); OP.supports.sort((p, q) => p.a - q.a); OP.geo = null; redraw(); };
  redraw(); opBindNext();
  opRightHelp('<p>Un <b>pilar</b> tiene dos caras: la izquierda y la derecha. Un <b>estribo</b> visible puede tener ambas caras iguales.</p><p>Los arcos se ajustan entre caras consecutivas. Si la nube no muestra un estribo, elija "completar por simetría" en ese extremo.</p><p>La franja de búsqueda de apoyos está a 62 % de la altura entre el tablero y el terreno, como en el análisis del Balta.</p>');
}
function opSupTable() {
  $('#opSupTbl').innerHTML = OP.supports.length ? `<table class="data"><thead><tr><th>N.º</th><th>Tipo</th><th class="n">Cara izquierda (m)</th><th class="n">Cara derecha (m)</th><th></th></tr></thead><tbody>${OP.supports.map((p, i) => `<tr><td class="mono">${i + 1}</td><td><select data-i="${i}" data-k="tipo" style="width:auto"><option value="pilar" ${p.tipo === 'pilar' ? 'selected' : ''}>Pilar</option><option value="estribo" ${p.tipo === 'estribo' ? 'selected' : ''}>Estribo</option></select></td><td class="n"><input type="number" step="0.05" data-i="${i}" data-k="a" value="${p.a.toFixed(2)}" style="width:100px"></td><td class="n"><input type="number" step="0.05" data-i="${i}" data-k="b" value="${p.b.toFixed(2)}" style="width:100px"></td><td><button class="btn line" data-del="${i}" style="padding:2px 8px">Quitar</button></td></tr>`).join('')}</tbody></table>` : '<p class="help">No se detectaron apoyos. Haga clic en la elevación para agregarlos.</p>';
  $('#opSupTbl').querySelectorAll('[data-k]').forEach(el => el.onchange = () => { const p = OP.supports[+el.dataset.i]; p[el.dataset.k] = el.dataset.k === 'tipo' ? el.value : +el.value; OP.supports.sort((u, v) => u.a - v.a); OP.geo = null; opSupTable(); opDrawElev({}); });
  $('#opSupTbl').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { OP.supports.splice(+b.dataset.del, 1); OP.geo = null; opSupTable(); opDrawElev({}); });
}

/* ---------- 3 · Geometría y completitud ---------- */
function opGeometria() {
  $('#canvas').innerHTML = `<div class="doc"><h2>3 · Geometría y completitud</h2>
   <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end"><label class="f" style="width:260px">Tipología<select id="opType">${Object.entries(OP_TYPES).map(([k, l]) => `<option value="${k}" ${k === OP.type ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f" style="width:150px">Búsqueda: cota mín. (m)<input type="number" id="opZmin" step="0.1" value="${OP.band.zmin.toFixed(2)}"></label>
    <label class="f" style="width:150px">Búsqueda: cota máx. (m)<input type="number" id="opZmax" step="0.1" value="${OP.band.zmax.toFixed(2)}"></label>
    <label class="f" style="width:150px">Mín. puntos por intervalo<input type="number" id="opMin" step="1" min="2" value="${OP.minPts}"></label>
    <button class="btn" id="opGo">Calcular geometría</button></div>
   <canvas id="opElev" style="width:100%;height:300px;display:block;background:var(--sheet);border:1px solid var(--rule)"></canvas><div id="opGeoOut"></div></div>${OP.geo ? opNext() : ''}`;
  const run = () => { OP.type = $('#opType').value; OP.band.zmin = +$('#opZmin').value; OP.band.zmax = +$('#opZmax').value; OP.minPts = Math.max(2, +$('#opMin').value | 0); OP.model = OP.modes = OP.camp = OP.ia = null;
    const sup = OP.supports.slice().sort((p, q) => p.a - q.a); if (sup.length < (OP.type === 'arco' ? 1 : 2) && !(OP.ends.left === 'simetria' && OP.ends.right === 'simetria')) { $('#opGeoOut').innerHTML = '<div class="msg crit"><b>Faltan apoyos.</b> Defina al menos dos apoyos en el paso 2.</div>'; return; }
    if (OP.type === 'arco') { const A = OPC.archAll(OP.O, sup, OP.band.zmin, OP.band.zmax, OP.minPts, OP.ends); OP.geo = { arches: A, ok: A.every(a => a.ok) }; }
    else { const cs = sup.map(p => ({ ...p })), Lr = cs.length > 1 ? OPC.median(cs.slice(1).map((p, i) => p.a - cs[i].b)) : 25;
      if (OP.ends.left === 'simetria') cs.unshift({ a: cs[0].a - Lr, b: cs[0].a - Lr, tipo: 'estribo', virtual: true }); if (OP.ends.right === 'simetria') cs.push({ a: cs[cs.length - 1].b + Lr, b: cs[cs.length - 1].b + Lr, tipo: 'estribo', virtual: true });
      const spans = OPC.spansOf(cs); OP.geo = { supports: cs, spans: spans.map(s => ({ ...s, coverage: OPC.spanCoverage(OP.O, s, OP.band.zmin, OP.band.zmax, OP.minPts) })), ok: spans.length > 0 }; }
    opGeoShow(); };
  $('#opGo').onclick = () => { run(); opGeometria(); };
  if (OP.geo) opGeoShow(); else opDrawElev({});
  opBindNext();
  opRightHelp('<p>Para arcos se reproduce el procedimiento del artículo: envolvente inferior de los puntos (percentil 3 en intervalos de 0,25 m), parábola robusta con recorte de residuos y completitud por zona (arranques, riñones y clave). Un intervalo cuenta como observado si su envolvente está a menos de 0,15 m de la parábola.</p><p>Para vigas y armaduras se informa la cobertura bajo el tablero por vano.</p>');
}
function opGeoShow() {
  const G = OP.geo; let ov;
  if (OP.type === 'arco') {
    ov = (g, M, dpr) => { G.arches.forEach(a => { if (!a.E) return; g.fillStyle = css('--blue'); a.E.yc.forEach((y, i) => { g.fillRect(M.X(y) - dpr, M.Z(a.E.zc[i]) - dpr, 2 * dpr, 2 * dpr); });
      if (a.ok) { g.strokeStyle = css('--red'); g.lineWidth = 2 * dpr; g.beginPath(); for (let k = 0; k <= 60; k++) { const y = a.a + (a.b - a.a) * k / 60, x = M.X(y), z = M.Z(OPC.polyval(a.coef, y)); k ? g.lineTo(x, z) : g.moveTo(x, z); } g.stroke(); } }); };
    $('#opGeoOut').innerHTML = `<h3>Arcos ajustados</h3><div class="tw"><table class="data"><thead><tr><th>Arco</th><th class="n">Desde (m)</th><th class="n">Hasta (m)</th><th class="n">Luz (m)</th><th class="n">Flecha (m)</th><th class="n">f/L</th><th class="n">RMS (cm)</th><th class="n">Compl. total</th><th class="n">Arranques</th><th class="n">Riñones</th><th class="n">Clave</th></tr></thead><tbody>${G.arches.map((a, i) => a.ok ? `<tr${a.completeness.total < .5 ? ' class="hl"' : ''}><td>Arco ${i + 1}${a.symmetric ? ' <span class="dim">(luz por simetría)</span>' : ''}</td><td class="n">${fmt(a.a, 2)}</td><td class="n">${fmt(a.b, 2)}</td><td class="n">${fmt(a.L, 2)}</td><td class="n">${fmt(a.rise, 2)}</td><td class="n">1/${fmt(a.L / a.rise, 1)}</td><td class="n">${fmt(100 * a.rms, 2)}</td><td class="n">${pct(a.completeness.total, 0)}</td><td class="n">${pct(a.completeness.arranque, 0)}</td><td class="n">${pct(a.completeness['riñón'], 0)}</td><td class="n">${pct(a.completeness.clave, 0)}</td></tr>` : `<tr class="hl"><td>Arco ${i + 1}</td><td colspan="10">${esc(a.msg || 'No se pudo ajustar')}. Revise los apoyos o la franja de búsqueda.</td></tr>`).join('')}</tbody></table></div>
      <p class="help">Puntos azules: envolvente del intradós. Línea roja: parábola robusta.</p>${G.ok ? '' : '<div class="msg crit"><b>Hay arcos sin ajustar.</b> Corrija apoyos o franja antes de continuar.</div>'}`;
  } else {
    ov = (g, M, dpr) => { g.strokeStyle = css('--blue'); g.setLineDash([4 * dpr, 3 * dpr]); [OP.band.zmin, OP.band.zmax].forEach(z => { g.beginPath(); g.moveTo(M.X(M.s0), M.Z(z)); g.lineTo(M.X(M.s1), M.Z(z)); g.stroke(); }); g.setLineDash([]); };
    $('#opGeoOut').innerHTML = `<h3>Vanos</h3><div class="tw"><table class="data"><thead><tr><th>Vano</th><th class="n">Desde (m)</th><th class="n">Hasta (m)</th><th class="n">Luz (m)</th><th class="n">Cobertura bajo el tablero</th></tr></thead><tbody>${G.spans.map((s, i) => `<tr><td>Vano ${i + 1}</td><td class="n">${fmt(s.a, 2)}</td><td class="n">${fmt(s.b, 2)}</td><td class="n">${fmt(s.b - s.a, 2)}</td><td class="n">${pct(s.coverage, 0)}</td></tr>`).join('')}</tbody></table></div><p class="help">Para vigas y armaduras la luz se mide entre centros de apoyo en el modelo.</p>`;
  }
  opDrawElev({ overlay: ov });
}

/* ---------- 4 · Modelo y modos ---------- */
function opParams() { if (!OP.P || OP.P.__type !== OP.type) { const m = OPC.MATERIALS[OP.mat]; OP.P = Object.assign({ __type: OP.type, E: m.E, rho: m.rho }, OP_DEFAULTS[OP.type]); } return OP.P; }
function opModelG() {
  const dAxis = OP.deckTop - OP.deckThick;
  if (OP.type === 'arco') { const A = OP.geo.arches; const sup = [{ a: A[0].a, b: A[0].a }]; for (let k = 0; k < A.length - 1; k++) sup.push({ a: A[k].b, b: A[k + 1].a }); sup.push({ a: A[A.length - 1].b, b: A[A.length - 1].b });
    if (!OP.P.zBase || OP.P.zBase.length !== A.length - 1) OP.P.zBase = new Array(A.length - 1).fill(+OP.ground.toFixed(2));
    return { supports: sup, arches: A.map(a => ({ a: a.a, b: a.b, coef: a.coef })), deckAxis: dAxis, zBase: OP.P.zBase }; }
  return { supports: OP.geo.supports, deckAxis: dAxis };
}
function opModelo() {
  const P = opParams();
  $('#canvas').innerHTML = `<div class="doc"><h2>4 · Supuestos, modelo y modos</h2>
   <p>La nube da la geometría; las secciones, el material y las cargas no se ven en ella. Ingrese sus valores. Los valores iniciales son los del modelo C del Balta y quedan marcados como supuestos en el informe.</p>
   <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:10px" id="opPar">
    <label class="f">Material<select id="opMat">${Object.entries(OPC.MATERIALS).map(([k, m]) => `<option value="${k}" ${k === OP.mat ? 'selected' : ''}>${m.label}</option>`).join('')}</select></label>
    <label class="f">Módulo E (GPa)<input type="number" step="1" data-p="E" value="${P.E}"></label><label class="f">Densidad (t/m³)<input type="number" step="0.05" data-p="rho" value="${P.rho}"></label>
    ${OP_PARAMS[OP.type].map(([k, l, u, st]) => `<label class="f">${l}${u ? ' (' + u + ')' : ''}<input type="number" step="${st}" data-p="${k}" value="${P[k]}"></label>`).join('')}
    ${OP.type === 'arco' ? `<label class="f">Arranques<select data-p="springing"><option value="fixed" ${P.springing === 'fixed' ? 'selected' : ''}>Empotrados</option><option value="pinned" ${P.springing === 'pinned' ? 'selected' : ''}>Articulados</option></select></label>${(OP.P.zBase || opModelG().zBase).map((z, i) => `<label class="f">Base del pilar ${i + 1} (m)<input type="number" step="0.1" data-zb="${i}" value="${z}"></label>`).join('')}` : ''}
   </div><div><button class="btn" id="opRun">Calcular modos</button></div><div id="opModOut"></div></div><div class="sheet" id="opSheet"></div>${OP.modes ? opNext('Entrenar la IA') : ''}`;
  $('#opMat').onchange = e => { OP.mat = e.target.value; const m = OPC.MATERIALS[OP.mat]; OP.P.E = m.E; OP.P.rho = m.rho; OP.modes = null; opModelo(); };
  $('#opPar').querySelectorAll('[data-p]').forEach(el => el.onchange = () => { OP.P[el.dataset.p] = el.tagName === 'SELECT' ? el.value : +el.value; OP.modes = OP.camp = OP.ia = null; });
  $('#opPar').querySelectorAll('[data-zb]').forEach(el => el.onchange = () => { OP.P.zBase[+el.dataset.zb] = +el.value; OP.modes = OP.camp = OP.ia = null; });
  $('#opRun').onclick = () => { try { const t = performance.now(); OP.model = OPC.build(OP.type, opModelG(), OP.P); OP.modes = OPC.modal(OP.model, 6); OP.modes.ms = performance.now() - t; OP.modeSel = 0; opModelo(); } catch (e) { $('#opModOut').innerHTML = `<div class="msg crit"><b>No se pudo calcular el modelo.</b> ${esc(e.message)}</div>`; } };
  if (OP.modes) opModesShow(); opBindNext();
  opRightHelp('<p>El modelo es un pórtico 2D elástico (elementos viga-columna de Euler-Bernoulli), igual al del artículo. Para arcos se arma el modelo C: nervios con sección I, montantes al tablero, pilares con un elemento rígido en los arranques.</p><p>Las frecuencias se obtienen con iteración en subespacio sobre K φ = λ M φ.</p>');
}
function opModesShow() {
  const r = OP.modes, fr = OP.model;
  $('#opModOut').innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px" class="toggle" role="group">${r.f.map((f, i) => `<button data-m="${i}" aria-pressed="${i === OP.modeSel}">Modo ${i + 1} · ${fmt(f, 2)} Hz</button>`).join('')}</div>
   <div class="tw" style="margin-top:8px"><table class="data"><thead><tr><th>Modo</th><th class="n">f (Hz)</th><th class="n">T (s)</th><th class="n">Part. vertical</th><th class="n">Part. longitudinal</th></tr></thead><tbody>${r.f.map((f, i) => `<tr${i === OP.modeSel ? ' class="hl"' : ''}><td class="mono">${i + 1}</td><td class="n">${fmt(f, 3)}</td><td class="n">${fmt(1 / f, 4)}</td><td class="n">${pct(r.part[i].Z, 1)}</td><td class="n">${pct(r.part[i].Y, 1)}</td></tr>`).join('')}</tbody></table></div>
   <p class="help">${fr.nodes.length} nodos · ${fr.el.length} elementos · masa ${fmt(r.totalMass, 0)} t · ${fmt(r.ms, 0)} ms · <button class="btn line" id="opDxf4" style="padding:1px 8px">Planos DXF</button></p>`;
  $('#opModOut').querySelectorAll('[data-m]').forEach(b => b.onclick = () => { OP.modeSel = +b.dataset.m; opModesShow(); }); const dx4 = $('#opDxf4'); if (dx4) dx4.onclick = opPlans;
  $('#opSheet').innerHTML = sheet({ no: 'T-01', model: `${fr.nodes.length} n · ${fr.el.length} e`, title: `${OP_TYPES[OP.type]} · modo ${OP.modeSel + 1} · ${fmt(r.f[OP.modeSel], 2)} Hz`, scale: 'esquema', content: opFrameSVG(fr, r.phi[OP.modeSel]), notes: `<text x="40" y="470">${esc(OP.name)}</text><text x="40" y="484">Geometría desde la nube; secciones y cargas según supuestos del usuario</text>` });
}
function opFrameSVG(fr, phi, hl) {
  const xs = fr.nodes.map(n => n[0]), zs = fr.nodes.map(n => n[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const bw = 900, bh = 300, sx = bw / (x1 - x0 || 1), sz = Math.min(sx * 1.5, bh / ((z1 - z0) || 1)), X = x => 50 + (x - x0) * sx, Z = z => 80 + (z1 - z) * sz, ink = css('--ink'), rule = css('--rule');
  let mx = 0; if (phi) for (let i = 0; i < fr.nodes.length; i++) mx = Math.max(mx, Math.hypot(phi[3 * i], phi[3 * i + 1])); const k = phi && mx ? 2.0 / mx * Math.max(1, (x1 - x0) / 60) : 0;
  const P = (i, sg = 1) => [X(fr.nodes[i][0] + sg * k * (phi ? phi[3 * i] : 0)), Z(fr.nodes[i][1] + sg * k * (phi ? phi[3 * i + 1] : 0))];
  const w = g => g.startsWith('pilar') ? 3 : g.startsWith('montante') || g === 'diagonal' ? .8 : 1.7; let s = '';
  if (phi) fr.el.forEach(([i, j], t) => { const [a, b] = P(i, -1), [c, d] = P(j, -1); s += `<line x1="${a.toFixed(1)}" y1="${b.toFixed(1)}" x2="${c.toFixed(1)}" y2="${d.toFixed(1)}" stroke="${rule}" stroke-width="${w(fr.grp[t])}"/>`; });
  fr.el.forEach(([i, j], t) => { const [a, b] = P(i), [c, d] = P(j), col = (hl && hl(t)) || ink; s += `<line x1="${a.toFixed(1)}" y1="${b.toFixed(1)}" x2="${c.toFixed(1)}" y2="${d.toFixed(1)}" stroke="${col}" stroke-width="${(hl && hl(t)) ? 2.6 : w(fr.grp[t])}" stroke-linecap="round"/>`; });
  for (let i = 0; i < fr.nodes.length; i++) if (fr.fx[3 * i + 1]) { const [x, z] = [X(fr.nodes[i][0]), Z(fr.nodes[i][1])]; s += `<path d="M${x - 6} ${z + 8}h12l-6-8z" fill="${css('--ink-2')}"/>`; }
  for (let v = Math.ceil(x0 / 10) * 10; v <= x1; v += 10) s += `<text x="${X(v)}" y="${80 + bh + 26}" font-size="8" text-anchor="middle" fill="${css('--ink-3')}">${v} m</text>`;
  return s;
}

/* ---------- 5 · Entrenar la IA (Web Worker) ---------- */
let OP_CORE_SRC = null;
async function opWorker() {
  if (!OP_CORE_SRC) OP_CORE_SRC = await fetch('op_core.js?v=2.5.0').then(r => { if (!r.ok) throw new Error('No se encontró op_core.js'); return r.text(); });
  const src = OP_CORE_SRC + `\nself.onmessage = e => { const m = e.data; try {
    const camp = OPC.campaign(m.type, m.G, m.P, m.opts, (q, s) => self.postMessage({ kind: 'prog', stage: 'Simulaciones de daño', q, s }));
    self.postMessage({ kind: 'prog', stage: 'Entrenando la IA', q: 0 });
    const ia = OPC.trainIA(camp, (stage, q) => self.postMessage({ kind: 'prog', stage, q }));
    self.postMessage({ kind: 'done', camp: { f0: camp.f0, phi0: camp.phi0.map(a => Array.from(a)), zones: camp.zones, sensors: camp.sensors, sens20: camp.sens20, NM: camp.NM, spanOfZone: camp.spanOfZone, n: camp.rows.length }, ia });
  } catch (err) { self.postMessage({ kind: 'error', msg: err.message }); } };`;
  return new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
}
function opIA() {
  const Z = OP.model ? OP.model.zoneDefs.length : 0;
  $('#canvas').innerHTML = `<div class="doc"><h2>5 · Entrenar la IA para este puente</h2>
   <p>La IA del Balta no sirve para otro puente: sus ejemplos dependen de la geometría y de los sensores. Aquí se repite la campaña del bloque B sobre su modelo: daños de 5 a 60 % en ${Z} zonas, incertidumbre de modelo en E y en el peso del tablero, y 9 o más puntos de medición en el tablero. Con esos casos se entrenan dos Random Forest: uno elige la zona dañada y otro estima la severidad.</p>
   <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">
    <label class="f" style="width:190px">Escenarios por zona<select id="opNz"><option value="40">40 (rápido)</option><option value="60" selected>60</option><option value="120">120</option><option value="260">260 (como el artículo)</option></select></label>
    <label class="f" style="width:190px">Incertidumbre de modelo<select id="opUnc"><option value="0.05" selected>±5 % (2σ)</option><option value="0.10">±10 % (2σ)</option></select></label>
    <button class="btn" id="opTrain" ${OP.busy ? 'disabled' : ''}>Entrenar la IA</button><span class="help" id="opEta"></span></div>
   <div id="opProg"></div><div id="opIAOut"></div></div>${OP.ia ? opNext('Probar el diagnóstico') : ''}`;
  $('#opNz').value = OP.nz || 60; $('#opEta').textContent = `≈ ${Z * (+$('#opNz').value) + 100} simulaciones`;
  $('#opNz').onchange = e => { $('#opEta').textContent = `≈ ${Z * (+e.target.value) + 100} simulaciones`; };
  $('#opTrain').onclick = async () => {
    OP.nz = +$('#opNz').value; OP.busy = true; $('#opTrain').disabled = true; OP.ia = null; const t0 = performance.now();
    try { if (OP.worker) OP.worker.terminate(); OP.worker = await opWorker(); } catch (e) { $('#opProg').innerHTML = `<div class="msg crit"><b>No se pudo iniciar el cálculo.</b> ${esc(e.message)}</div>`; OP.busy = false; return; }
    OP.worker.onmessage = ev => { const m = ev.data;
      if (m.kind === 'prog') { const el = $('#opProg'); if (el) el.innerHTML = `<p class="mono" style="font-size:.82rem">${m.stage}: ${Math.round(100 * m.q)} %${m.s ? ` · ${Math.round(m.s)} s` : ''}</p><div class="meter" style="height:8px"><i style="width:${100 * m.q}%"></i></div>`; }
      else if (m.kind === 'done') { OP.camp = m.camp; OP.ia = m.ia; OP.ia.secs = (performance.now() - t0) / 1000; OP.busy = false; OP.worker.terminate(); OP.worker = null; OP.dx = { zone: 0, sev: .3, lev: 1, n: 1 }; if (S.view === 'tupuente' && OP.step === 5) opIA(); toast('IA entrenada para este puente.'); }
      else if (m.kind === 'error') { OP.busy = false; const el = $('#opProg'); if (el) el.innerHTML = `<div class="msg crit"><b>Falló el entrenamiento.</b> ${esc(m.msg)}</div>`; } };
    OP.worker.postMessage({ type: OP.type, G: opModelG(), P: OP.P, opts: { nPerZone: OP.nz, nUndamaged: 100, unc: +$('#opUnc').value, seed: 7, NM: Math.min(8, OP.modes.f.length + 2) } });
  };
  if (OP.ia) opIAShow();
  opRightHelp('<p>El cálculo corre en segundo plano en su navegador; puede tardar uno o dos minutos con 60 escenarios por zona.</p><p>La validación usa 30 % de los casos que la IA no vio, con tres niveles de ruido de medición: bajo (0,2 % en frecuencias), medio (0,5 %) y alto (1 %).</p>');
}
function opIAShow() {
  const M = OP.ia.metrics, L = { bajo: 'Bajo · Δf 0,2 %', medio: 'Medio · Δf 0,5 %', alto: 'Alto · Δf 1 %' };
  $('#opIAOut').innerHTML = `<div class="msg" style="border-left-color:var(--ok)"><b>IA lista.</b> ${OP.camp.n} simulaciones, ${OP.ia.nTrain} para entrenar y ${OP.ia.nTest} para validar · ${fmt(OP.ia.secs, 0)} s</div>
   <h3>Desempeño en casos no vistos</h3><div class="tw"><table class="data"><thead><tr><th>Ruido</th><th class="n">Detección</th><th class="n">Falsa alarma</th><th class="n">Zona exacta</th><th class="n">Vano correcto</th><th class="n">Daño 5–15 %</th><th class="n">15–30 %</th><th class="n">30–60 %</th><th class="n">MAE severidad</th></tr></thead><tbody>${Object.entries(M).map(([k, m]) => `<tr><td>${L[k]}</td><td class="n">${pct(m.deteccion)}</td><td class="n">${pct(m.falsaAlarma)}</td><td class="n">${pct(m.localizacion)}</td><td class="n">${pct(m.vano)}</td><td class="n">${pct(m.d5_15)}</td><td class="n">${pct(m.d15_30)}</td><td class="n">${pct(m.d30_60)}</td><td class="n">${fmt(100 * m.mae, 1)} pp</td></tr>`).join('')}</tbody></table></div>
   <h3>Aciertos por zona (ruido medio)</h3><div class="tw"><table class="data"><tbody>${OP.camp.zones.map((z, i) => `<tr><td>${esc(z)}</td><td style="width:50%"><div class="meter"><i style="width:${100 * M.medio.recall[i]}%"></i></div></td><td class="n">${pct(M.medio.recall[i], 0)}</td></tr>`).join('')}</tbody></table></div>`;
}

/* ---------- 6 · Diagnóstico ---------- */
function opMeasure(clean, L, n) { const r = OPC.mulberry(1000003 * n + 7919); return clean.map((v, i) => v + OPC.gaussR(r) * (i < OP.camp.NM ? L.sf : L.ss)); }
function opClean() { const X = OP.dx, key = X.zone + '|' + X.sev; if (OP.cleanC && OP.cleanC.key === key) return OP.cleanC.x;
  const fr = OP.model, esc = new Float64Array(fr.el.length).fill(1); if (X.zone >= 0) fr.zoneOf.forEach((z, t) => { if (z === X.zone) esc[t] = 1 - X.sev; });
  const m = OPC.modal(fr, OP.camp.NM, esc), x = OPC.features(m.f, m.phi, OP.camp.f0, OP.camp.phi0, OP.camp.sensors.map(s => s.dof), OP.camp.NM); OP.cleanC = { key, x }; return x; }
function opPredict(x) { const I = OP.ia, pr = OPC.forestPredict(I.clf, x), o = pr.map((p, i) => [p, i - 1]).sort((a, b) => b[0] - a[0]), cls = o[0][1], Z = OP.camp.zones.length;
  const z = x.map((v, k) => (v - I.mean[k]) / I.sd[k]); let b = Infinity; for (const s of I.sub) { let d = 0; for (let k = 0; k < z.length; k++) d += (z[k] - s[k]) ** 2; if (d < b) b = d; } const dist = Math.sqrt(b);
  const sev = cls >= 0 ? OPC.forestPredict(I.reg, x.concat(Array.from({ length: Z }, (_, k) => k === cls ? 1 : 0)))[0] : null;
  return { cls, p: o[0][0], second: o[1][1], p2: o[1][0], top: o.slice(0, 4), conclusive: o[0][0] >= .4 && o[0][0] - o[1][0] >= .1, dist, ood: dist > I.oodThr, sev }; }
const opZ = z => z < 0 ? 'Sin daño' : OP.camp.zones[z], opSpan = z => z < 0 ? -1 : OP.camp.spanOfZone[z];
function opDiag() {
  const X = OP.dx, Lv = OPC.LEVELS;
  $('#canvas').innerHTML = `<div class="doc"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline"><h2>6 · IA · Diagnóstico de daño por vibración</h2><span class="mono dim" style="font-size:.74rem">${OP.camp.sensors.length} sensores · ${OP.camp.NM} modos · Random Forest</span></div>
   <p style="font-size:.86rem">Igual que en el Balta: se simula un daño en su modelo, se "mide" con ruido y la IA propone la zona y la severidad sin conocer el escenario. El mismo número de medición da siempre el mismo resultado.</p>
   <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:10px;align-items:end">
    <label class="f">Zona dañada<select id="odZ"><option value="-1">Sin daño</option>${OP.camp.zones.map((z, i) => `<option value="${i}" ${i === X.zone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></label>
    <label class="f"><span class="lv">Pérdida de rigidez <output id="odSo">${Math.round(X.sev * 100)} %</output></span><input type="range" id="odS" min="5" max="60" step="1" value="${Math.round(X.sev * 100)}"></label>
    <label class="f">Ruido de medición<select id="odL">${Lv.map((l, i) => `<option value="${i}" ${i === X.lev ? 'selected' : ''}>${['Bajo · Δf 0,2 %', 'Medio · Δf 0,5 %', 'Alto · Δf 1 %'][i]}</option>`).join('')}</select></label>
    <label class="f">Medición n.º<input type="number" id="odN" min="1" step="1" value="${X.n}"></label></div>
   <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn line" id="odGo">Nueva medición</button><button class="btn" id="odRep">Repetir 100 mediciones</button></div>
   <div id="odOut"></div><div id="odStats"></div></div><div class="sheet" id="odSheet"></div><div class="doc" id="fqDocTu"></div>`;
  $('#odZ').value = X.zone; $('#odS').disabled = X.zone < 0;
  const reset = () => { X.n = 1; $('#odN').value = 1; $('#odStats').innerHTML = ''; opDxRun(); };
  $('#odZ').onchange = e => { X.zone = +e.target.value; $('#odS').disabled = X.zone < 0; reset(); }; $('#odS').oninput = e => $('#odSo').textContent = e.target.value + ' %'; $('#odS').onchange = e => { X.sev = e.target.value / 100; reset(); };
  $('#odL').onchange = e => { X.lev = +e.target.value; reset(); }; $('#odN').onchange = e => { X.n = Math.max(1, Math.round(+e.target.value || 1)); e.target.value = X.n; opDxRun(); };
  $('#odGo').onclick = () => { X.n++; $('#odN').value = X.n; opDxRun(); }; $('#odRep').onclick = opDxRepeat; opDxRun(); fqRender($('#fqDocTu'), { id: 'tu', type: OP.type, G: opModelG(), P: OP.P, title: OP.name });
  opRightHelp('<p>La confianza combina dos controles: la fracción de árboles que vota por la zona elegida (se exige al menos 40 % y 10 puntos de ventaja sobre la segunda) y la distancia de la medición a los casos de entrenamiento.</p>');
}
function opVerdict(d, truth) { return d.ood ? ['crit', 'Medición fuera de dominio'] : !d.conclusive ? ['warn', 'No concluyente'] : d.cls === truth ? ['ok', 'Zona correcta'] : opSpan(d.cls) === opSpan(truth) ? ['warn', 'Vano correcto, zona distinta'] : ['crit', 'No coincide']; }
function opDxRun() {
  const X = OP.dx, L = OPC.LEVELS[X.lev], clean = opClean(), x = opMeasure(clean, L, X.n), d = opPredict(x), v = opVerdict(d, X.zone), M = OP.ia.metrics[L.k];
  $('#odOut').innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:18px;margin-top:10px">
   <div class="tw"><table class="data"><tbody><tr><td>Medición n.º ${X.n}</td><td class="n"><span class="flag ${v[0]}">${v[1]}</span></td></tr>
    <tr><td>Zona propuesta</td><td class="n" style="font-weight:600">${esc(opZ(d.cls))}</td></tr>
    <tr><td>Severidad estimada</td><td class="n">${d.sev == null ? '—' : pct(Math.max(0, d.sev), 0)} <span class="dim">(real ${X.zone < 0 ? '0 %' : pct(X.sev, 0)})</span></td></tr>
    <tr><td>Distancia al dominio</td><td class="n">${fmt(d.dist, 2)} <span class="dim">/ umbral ${fmt(OP.ia.oodThr, 2)}</span></td></tr></tbody></table>
    <h3 style="margin-top:12px">Votos de los árboles</h3><div class="tw"><table class="data"><tbody>${d.top.map(([p, c]) => `<tr${c === X.zone ? ' class="hl"' : ''}><td>${esc(opZ(c))}${c === X.zone ? ' <span class="dim">(real)</span>' : ''}</td><td style="width:42%"><div class="meter"><i style="width:${100 * p}%"></i></div></td><td class="n">${pct(p, 0)}</td></tr>`).join('')}</tbody></table></div></div>
   <div class="tw"><table class="data"><thead><tr><th>Modo</th><th class="n">f₀ (Hz)</th><th class="n">Δf sin ruido</th><th class="n">Δf medido</th></tr></thead><tbody>${OP.camp.f0.map((f, i) => `<tr><td class="mono">${i + 1}</td><td class="n">${fmt(f, 3)}</td><td class="n">${sgn(clean[i], 2)}</td><td class="n">${sgn(x[i], 2)}</td></tr>`).join('')}</tbody></table>
    <p class="help" style="margin-top:6px">Validación con este ruido: zona ${pct(M.localizacion, 0)}, vano ${pct(M.vano, 0)}, falsas alarmas ${pct(M.falsaAlarma, 0)}.</p></div></div>`;
  const red = css('--red'), blue = css('--blue'), fr = OP.model;
  $('#odSheet').innerHTML = sheet({ no: 'T-02', model: `${fr.nodes.length} n · ${fr.el.length} e`, title: `Diagnóstico · ${opZ(X.zone)} · medición ${X.n}`, scale: 'esquema', content: opFrameSVG(fr, null, t => fr.zoneOf[t] === d.cls && d.cls >= 0 ? red : fr.zoneOf[t] === X.zone && X.zone >= 0 ? blue : null), notes: legendRow([['line', blue, 'Zona dañada en la simulación'], ['line', red, 'Zona propuesta por la IA']], 40, 466) });
}
async function opDxRepeat() {
  const X = OP.dx, L = OPC.LEVELS[X.lev], clean = opClean(), N = 100, btn = $('#odRep'); btn.disabled = true; const R = [];
  for (let n = 1; n <= N; n++) { R.push(opPredict(opMeasure(clean, L, n))); if (n % 10 === 0) { btn.textContent = `Midiendo… ${n}/${N}`; await new Promise(r => setTimeout(r, 0)); } }
  btn.textContent = 'Repetir 100 mediciones'; btn.disabled = false;
  const cnt = new Map(); R.forEach(d => cnt.set(d.cls, (cnt.get(d.cls) || 0) + 1)); const top = [...cnt].sort((a, b) => b[1] - a[1]);
  const ok = R.filter(d => d.cls === X.zone).length, sp = R.filter(d => opSpan(d.cls) === opSpan(X.zone)).length, conc = R.filter(d => !d.ood && d.conclusive), cOk = conc.filter(d => d.cls === X.zone).length;
  const sv = R.filter(d => d.cls === X.zone && d.sev != null).map(d => d.sev).sort((a, b) => a - b), q = p => sv[Math.min(sv.length - 1, Math.floor(p * (sv.length - 1)))], lvl = ok >= 80 ? ['ok', 'alta'] : ok >= 50 ? ['warn', 'media'] : ['crit', 'baja'];
  $('#odStats').innerHTML = `<div style="margin-top:14px;border-top:1.5px solid var(--ink);padding-top:10px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline"><h3 style="margin:0">Confiabilidad de la IA en este escenario · ${N} mediciones</h3><span class="flag ${lvl[0]}">Confiabilidad ${lvl[1]}</span></div>
   <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:18px;margin-top:6px">
    <div class="tw"><table class="data"><tbody><tr><td>Zona correcta</td><td class="n" style="font-weight:600">${ok} de ${N}</td></tr><tr><td>Vano correcto</td><td class="n">${sp} de ${N}</td></tr><tr><td>Resultados concluyentes</td><td class="n">${conc.length} de ${N}</td></tr><tr><td>Aciertos entre los concluyentes</td><td class="n">${conc.length ? pct(cOk / conc.length, 0) : '—'}</td></tr>
     <tr><td>Severidad cuando acierta la zona</td><td class="n">${sv.length ? `${pct(Math.max(0, q(.5)), 0)} <span class="dim">(p5–p95: ${pct(Math.max(0, q(.05)), 0)}–${pct(Math.max(0, q(.95)), 0)})</span>` : '—'}</td></tr></tbody></table></div>
    <div class="tw"><table class="data"><thead><tr><th>Zona elegida</th><th></th><th class="n">Veces</th></tr></thead><tbody>${top.slice(0, 6).map(([c, k]) => `<tr${c === X.zone ? ' class="hl"' : ''}><td>${esc(opZ(c))}${c === X.zone ? ' <span class="dim">(real)</span>' : ''}</td><td style="width:40%"><div class="meter"><i style="width:${k}%;${c === X.zone ? 'background:var(--ok)' : ''}"></i></div></td><td class="n">${k}</td></tr>`).join('')}</tbody></table></div></div></div>`;
}

/* ---------- 7 · Plan e informe ---------- */
function opZoneGeoUnc(z) { // incertidumbre geométrica de la zona según la completitud medida
  if (OP.type === 'arco') { const na = OP.geo.arches.length; if (z < 5 * na) { const a = OP.geo.arches[Math.floor(z / 5)], k = z % 5, part = k === 2 ? 'clave' : (k === 1 || k === 3) ? 'riñón' : 'arranque'; return { u: 1 - a.completeness[part], known: true, txt: `${part}: ${pct(a.completeness[part], 0)} observado` }; } return { u: .5, known: false, txt: 'tablero: sin medir' }; }
  const s = OP.geo.spans[OP.camp.spanOfZone[z]]; return s ? { u: 1 - s.coverage, known: true, txt: `cobertura del vano ${pct(s.coverage, 0)}` } : { u: .5, known: false, txt: 'sin dato' }; }
function opPlanData() { const Z = OP.camp.zones.length, mS = Math.max(...OP.camp.sens20), rec = OP.ia.metrics.medio.recall;
  return OP.camp.zones.map((name, z) => { const g = opZoneGeoUnc(z), s = OP.camp.sens20[z] / mS, d = 1 - rec[z], score = .4 * s + .3 * g.u + .3 * d; return { z, name, s, g, d, score, level: score >= .6 ? 'Alta' : score >= .4 ? 'Media' : 'Baja' }; }).sort((a, b) => b.score - a.score); }
function opPlan() {
  const P = opPlanData(), M = OP.ia.metrics, d = new Date().toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' });
  let r = `INFORME · ${OP.name}\nGenerado con la Plataforma Balta (Tu puente) · ${d}\n\nNUBE\n${OP.cloud.kept.toLocaleString('es-PE')} puntos usados de ${OP.cloud.total.toLocaleString('es-PE')}; superficie del tablero ${fmt(OP.deckTop, 2)} m; terreno ${fmt(OP.ground, 2)} m.\n\nGEOMETRÍA (${OP_TYPES[OP.type]})\n`;
  if (OP.type === 'arco') OP.geo.arches.forEach((a, i) => r += `Arco ${i + 1}: ${fmt(a.a, 2)}–${fmt(a.b, 2)} m, luz ${fmt(a.L, 2)} m${a.symmetric ? ' (por simetría)' : ''}, flecha ${fmt(a.rise, 2)} m, RMS ${fmt(100 * a.rms, 2)} cm; completitud ${pct(a.completeness.total, 0)} (arranques ${pct(a.completeness.arranque, 0)}, riñones ${pct(a.completeness['riñón'], 0)}, clave ${pct(a.completeness.clave, 0)})\n`);
  else OP.geo.spans.forEach((s, i) => r += `Vano ${i + 1}: ${fmt(s.a, 2)}–${fmt(s.b, 2)} m, luz ${fmt(s.b - s.a, 2)} m, cobertura ${pct(s.coverage, 0)}\n`);
  r += `\nSUPUESTOS DEL USUARIO\nMaterial ${OPC.MATERIALS[OP.mat].label}, E = ${OP.P.E} GPa, densidad ${OP.P.rho} t/m³; ${OP_PARAMS[OP.type].map(([k, l, u]) => `${l.toLowerCase()} ${OP.P[k]}${u ? ' ' + u : ''}`).join('; ')}.\n\nMODOS\n${OP.modes.f.map((f, i) => `Modo ${i + 1}: ${fmt(f, 3)} Hz`).join('\n')}\n\nIA (Random Forest, ${OP.camp.n} simulaciones, ${OP.camp.sensors.length} sensores)\n`;
  Object.entries(M).forEach(([k, m]) => r += `Ruido ${k}: zona exacta ${pct(m.localizacion, 0)}, vano ${pct(m.vano, 0)}, falsas alarmas ${pct(m.falsaAlarma, 0)}, MAE severidad ${fmt(100 * m.mae, 1)} pp\n`);
  r += `\nORDEN DE VERIFICACIÓN EN CAMPO (sensibilidad 0,4 · incertidumbre geométrica 0,3 · dificultad de detección 0,3)\n`; P.forEach((o, i) => r += `${i + 1}. ${o.name} · prioridad ${o.level.toLowerCase()} (${o.score.toFixed(2)}) · ${o.g.txt} · aciertos IA ${pct(1 - o.d, 0)}\n`);
  r += `\nEl índice ordena dónde verificar primero. No es una evaluación de seguridad ni de capacidad resistente. Las secciones, materiales y cargas son supuestos del usuario.`;
  $('#canvas').innerHTML = `<div class="doc"><h2>7 · Plan de inspección e informe</h2>
   <div class="tw"><table class="data"><thead><tr><th>N.º</th><th>Zona</th><th class="n">Índice</th><th>Prioridad</th><th>Sensibilidad</th><th>Incertidumbre geométrica</th><th>Dificultad IA</th></tr></thead><tbody>${P.map((o, i) => `<tr${o.level === 'Alta' ? ' class="hl"' : ''}><td class="mono">${i + 1}</td><td>${esc(o.name)}</td><td class="n">${fmt(o.score, 2)}</td><td><span class="flag ${o.level === 'Alta' ? 'crit' : o.level === 'Media' ? 'warn' : 'na'}">${o.level}</span></td>${[o.s, o.g.u, o.d].map((v, k) => `<td><div class="meter" title="${fmt(v, 2)}"><i style="width:${100 * v}%;${k === 1 && !o.g.known ? 'opacity:.35' : ''}"></i></div></td>`).join('')}</tr>`).join('')}</tbody></table></div>
   <p class="help">Barras tenues: zona sin dato de cobertura (se asume 0,5).</p>
   <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="opCopy">Copiar informe</button><button class="btn line" id="opJson">Descargar proyecto (JSON)</button><button class="btn line" id="opCsv">Descargar orden de verificación (CSV)</button><button class="btn line" id="opDxf">Planos DXF (AutoCAD)</button></div>
   <div class="report" id="opRep" tabindex="0"></div></div>`;
  $('#opDxf').onclick = opPlans; $('#opRep').textContent = r; $('#opCopy').onclick = e => copyText(r, e.target, $('#opRep'));
  $('#opJson').onclick = () => download('proyecto_puente.json', 'application/json', JSON.stringify({ nombre: OP.name, fecha: new Date().toISOString(), nube: { usados: OP.cloud.kept, total: OP.cloud.total, tablero: OP.deckTop, terreno: OP.ground }, apoyos: OP.supports, extremos: OP.ends, tipologia: OP.type,
    geometria: OP.type === 'arco' ? OP.geo.arches.map(a => ({ a: a.a, b: a.b, coef: a.coef, luz: a.L, flecha: a.rise, rms_m: a.rms, completitud: a.completeness, simetria: a.symmetric || null })) : OP.geo.spans, supuestos: { material: OP.mat, ...OP.P }, modos_Hz: OP.modes.f, ia: { simulaciones: OP.camp.n, zonas: OP.camp.zones, metricas: OP.ia.metrics }, plan: P.map(o => ({ zona: o.name, indice: o.score, prioridad: o.level })) }, null, 1));
  $('#opCsv').onclick = () => download('orden_verificacion.csv', 'text/csv', ['orden,zona,indice,prioridad,sensibilidad,incertidumbre_geometrica,dificultad_ia', ...P.map((o, i) => [i + 1, `"${o.name}"`, o.score.toFixed(3), o.level, o.s.toFixed(3), o.g.u.toFixed(3), o.d.toFixed(3)].join(','))].join('\n'));
  opRightHelp('<p>El orden combina tres criterios por zona: cuánto cambia la frecuencia si la zona pierde 20 % de rigidez, cuánto de la zona no se vio en la nube y qué tan difícil es para la IA localizar daño allí.</p><p>El proyecto JSON guarda geometría, supuestos, modos y métricas; no incluye la nube.</p>');
}

/* ---------- Planos DXF del puente del usuario ---------- */
function opPlans() {
  try {
    if (!OP.model || !OP.modes) { toast('Calcule primero el modelo y sus modos (paso 4).'); return; }
    const fr = OP.model, G = opModelG(), sup = G.supports, n2 = v => fmt(v, 2), O = OP.O, step = Math.max(1, Math.ceil(O.n / 50000)), s = [], z = [];
    for (let i = 0; i < O.n; i += step) { s.push(O.s[i]); z.push(O.z[i]); }
    const lab = sup.map((p, i) => i === 0 ? 'E.I.' : i === sup.length - 1 ? 'E.D.' : 'P' + i);
    const arco = OP.type === 'arco', A = arco ? OP.geo.arches : [];
    let lvz = null, orden = [];
    if (OP.ia && OP.camp) { const P = opPlanData(); lvz = {}; P.forEach(o => lvz[o.z] = o.level); orden = P.map((o, i) => `${i + 1}. ${o.name} · índice ${fmt(o.score, 2)} · ${o.level.toLowerCase()}`); }
    const out = OPC.bridgePlans({ proyecto: (OP.name || 'PUENTE').toUpperCase().slice(0, 60), autores: 'Generado con PuenteGemelo', fecha: new Date().toLocaleDateString('es-PE'), fr,
      fam: g => g.startsWith('arco') ? 'ARCOS' : g === 'tablero' ? 'TABLERO' : g.startsWith('montante') ? 'MONTANTES' : g.startsWith('pilar') ? 'PILARES' : g.startsWith('cordon') ? 'CORDONES' : g === 'diagonal' ? 'DIAGONALES' : null,
      apoyos: sup.map((p, i) => ({ s: (p.a + p.b) / 2, label: lab[i] })),
      luces: arco ? A.map(a => ({ a: a.a, b: a.b, txt: n2(a.L) + (a.symmetric ? ' *' : '') })) : OP.geo.spans.map(p => ({ a: p.a, b: p.b, txt: n2(p.b - p.a) })),
      notas: arco ? A.map(a => { const yc = -a.coef[1] / (2 * a.coef[0]); return { s: yc, z: OPC.polyval(a.coef, yc) - 1.4, txt: `f = ${n2(a.rise)} m` }; }) : [],
      nivel: { z: OP.ground, txt: 'TERRENO O AGUA (NUBE)' }, nube: { s, z },
      intrados: arco ? A.map(a => ({ pts: Array.from({ length: 41 }, (_, i) => { const y = a.a + (a.b - a.a) * i / 40; return [y, OPC.polyval(a.coef, y)]; }), txt: `Completitud ${pct(a.completeness.total, 0)} · arranques ${pct(a.completeness.arranque, 0)} · riñones ${pct(a.completeness['riñón'], 0)} · clave ${pct(a.completeness.clave, 0)}` })) : [],
      modos: OP.modes.f.slice(0, 3).map((f, k) => ({ f, phi: OP.modes.phi[k], partZ: OP.modes.part[k].Z })),
      sensores: OPC.sensorsOf(fr).map((o, k) => ({ s: o.s, z: fr.nodes[o.node][1], label: 'S' + (k + 1) })),
      prioridad: lvz ? (t => { const zz = fr.zoneOf[t]; return zz >= 0 && lvz[zz] ? lvz[zz] : null; }) : null, orden,
      fuente: `${OP_TYPES[OP.type]} · geometría desde la nube; secciones y cargas según supuestos del usuario${arco && A.some(a => a.symmetric) ? ' · * luz por simetría' : ''}` });
    const nombre = (OP.name || 'puente').replace(/\.[a-z0-9]+$/i, '').replace(/[^\wáéíóúñÁÉÍÓÚÑ -]+/g, '').trim() || 'puente';
    download('Planos_' + nombre + '.dxf', 'application/dxf', new Blob([out.bytes], { type: 'application/dxf' }));
    toast(`Planos DXF: ${out.sheets.map(x => x.code).join(', ')} · escala 1:${out.sheets[0].S} en A3 · unidades en metros.`);
  } catch (e) { toast('No se pudieron generar los planos: ' + e.message); }
}
