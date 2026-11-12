"use strict";
/* PuenteGemelo · biblioteca de puentes.
   La plataforma trabaja sobre el PUENTE ACTIVO. Cualquier puente entra por su nube de puntos y se guarda como proyecto
   (nube, geometría, supuestos, modelo, IA, inspecciones, mediciones e historia). El Puente Balta es un proyecto de ejemplo
   que trae además el material verificado de la primera parte de la tesis (modelo C, OpenSees, SVM, Monte Carlo).
   Web: los proyectos se guardan en IndexedDB de este navegador. Escritorio: además se abren y guardan como archivos .puente. */
const PB = { active: 'balta', list: [], ready: false, confirmDel: null };
const PB_OP0 = JSON.parse(JSON.stringify(OP));
const PB_EST = ['step', 'deckTop', 'deckThick', 'ground', 'zSlab', 'supports', 'ends', 'type', 'band', 'minPts', 'geo', 'mat', 'P', 'Pedit', 'Psrc', 'nz', 'dx', 'camp', 'ia', 'geomOpt', 'geomUsed', 'name', 'up', 'unit', 'skew', 'sinTerreno', 'iaRev', 'iaOn', 'hipRev'];
const PB_MAXP = 500000;
const pbPlain = (k, v) => ArrayBuffer.isView(v) ? Array.from(v) : v;
const pbB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const pbUnB64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
const pbCtxId = id => id === 'balta' ? 'balta' : 'u_' + id;
const pbNewId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pbLsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const pbLsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const pbMeta = id => PB.list.find(b => b.id === id);
const PB_EJEMPLO = { id: 'balta', nombre: 'Puente Balta (ejemplo)', tipo: 'arco', ejemplo: true };

/* ---------- estado del proyecto activo ---------- */
function pbEstado() { const e = {}; PB_EST.forEach(k => { if (OP[k] !== undefined) e[k] = OP[k]; }); return JSON.parse(JSON.stringify(e, pbPlain)); }
function pbResumen() { const g = OP.geo, L = g ? (OP.type === 'arco' ? g.arches.filter(a => a.ok !== false).map(a => a.L) : (g.spans || []).map(s => s.b - s.a)) : [];
  return { tipo: OP.type, vanos: L.length, luzTotal: L.reduce((a, b) => a + b, 0), nube: !!OP.O, modelo: !!OP.modes, ia: !!OP.ia, puntos: OP.cloud ? OP.cloud.kept : 0, f1: OP.modes ? OP.modes.f[0] : null }; }
async function pbSaveList() { await PG_DB.set('puentes', PB.list.map(b => Object.assign({}, b))); }
let pbT = 0;
function pbAutosave() { if (!OP.id || !OP.O || PB.active !== OP.id) return; clearTimeout(pbT); pbT = setTimeout(pbSaveNow, 600); }
async function pbSaveNow() { if (!OP.id || !OP.O || PB.active !== OP.id) return; const id = OP.id; let m = pbMeta(id);
  if (!m) { m = { id, creado: new Date().toISOString() }; PB.list.push(m); }
  Object.assign(m, { nombre: OP.name || 'Puente sin nombre', actualizado: new Date().toISOString(), resumen: pbResumen() });
  await PG_DB.set('puente:' + id, pbEstado()); await pbSaveList(); }
async function pbSaveCloud() { if (!OP.id || !OP.cloud) return; const c = OP.cloud, n = c.xyz.length / 3, m = Math.min(n, 1500000), step = n / m, f = new Float32Array(3 * m);
  for (let j = 0; j < m; j++) { const i = Math.floor(j * step); f[3 * j] = c.xyz[3 * i]; f[3 * j + 1] = c.xyz[3 * i + 1]; f[3 * j + 2] = c.xyz[3 * i + 2]; }
  await PG_DB.set('nube:' + OP.id, { xyz: f, total: c.total, kept: c.kept, offset: c.offset, eje: c.eje || null }); }

// reconstruye el modelo y los modos a partir del estado guardado (no se guardan matrices)
function pbRebuild() { OP.O = OPC.orient(OP.cloud, OP.up || 'z', OP.unit || 1); if (OP.skew) OP.O = OPC.applySkew(OP.O, OP.skew); OP.model = OP.modes = null;
  if (OP.geo && OP.P) { try { OP.model = OPC.build(OP.type, opModelG(), OP.P); OP.modes = OPC.modal(OP.model, 6); OP.modes.ms = 0; OP.modeSel = 0; } catch (e) { OP.model = OP.modes = null; } }
  if (!OP.modes) OP.camp = OP.ia = null;
  OP.step = Math.min(OP.step || 1, OP.ia ? 7 : OP.modes ? 5 : OP.geo ? 4 : OP.O ? 2 : 1); }
function pbResetOP() { if (OP.worker) { try { OP.worker.terminate(); } catch (e) {} } Object.keys(OP).forEach(k => { if (!(k in PB_OP0)) delete OP[k]; }); Object.assign(OP, JSON.parse(JSON.stringify(PB_OP0))); }
// claves antiguas (versiones ≤ 1.2: «tu:nombre») → clave del proyecto
function pbMigrate() { const old = 'tu:' + (OP.name || 'sin nombre'), K = pbCtxId(OP.id);
  [['I', pgSave], ['det', null], ['H', () => PG_DB.set('hist', PG.H)], ['cal', pgSaveCal]].forEach(([f, save]) => { if (PG[f] && PG[f][old] && !PG[f][K]) { PG[f][K] = PG[f][old]; if (save) save(); } }); }

async function pbActivate(id, { go = null, silent = false } = {}) {
  if (id === 'balta') { if (OP.id) await pbSaveNow(); PB.active = 'balta'; pbLsSet('pg_activo', 'balta'); }
  else { if (OP.id !== id) { if (OP.id) await pbSaveNow(); const est = await PG_DB.get('puente:' + id), nube = await PG_DB.get('nube:' + id);
      if (!est || !nube) { toast('No se encontró el proyecto en este navegador.'); return false; }
      pbResetOP(); Object.assign(OP, est); OP.id = id; OP.cloud = { xyz: nube.xyz instanceof Float32Array ? nube.xyz : Float32Array.from(nube.xyz), total: nube.total, kept: nube.kept, offset: nube.offset, eje: nube.eje || undefined }; pbRebuild(); pbMigrate(); }
    PB.active = id; pbLsSet('pg_activo', id); }
  if (!silent && DATA_READY) { if (go) show(go); else render(); }
  return true; }
function pbNew() { pbSaveNow(); pbResetOP(); OP.id = pbNewId(); PB.active = OP.id; pbLsSet('pg_activo', OP.id); OP.step = 1; show('tupuente'); }
async function pbDelete(id) { if (id === 'balta') return; const K = pbCtxId(id); clearTimeout(pbT);
  if (PB.active === id || OP.id === id) { pbResetOP(); PB.active = 'balta'; pbLsSet('pg_activo', 'balta'); }
  PB.list = PB.list.filter(b => b.id !== id); await pbSaveList(); await PG_DB.set('puente:' + id, null); await PG_DB.set('nube:' + id, null);
  ['I', 'det', 'H', 'cal', 'bases'].forEach(f => { if (PG[f]) delete PG[f][K]; }); pgSave(); PG_DB.set('hist', PG.H); pgSaveCal(); PG_DB.set('bases', PG.bases);
  toast('Puente eliminado de este navegador.'); render(); }

async function pbRename(id, v) { v = (v || '').trim(); PB.renaming = null; if (!v) return vPuentes(); const m = pbMeta(id); if (!m) return vPuentes();
  m.nombre = v; if (OP.id === id) { OP.name = v; await pbSaveNow(); } else { const e = await PG_DB.get('puente:' + id); if (e) { e.name = v; await PG_DB.set('puente:' + id, e); } await pbSaveList(); }
  render(); }

/* ---------- archivo .puente (el mismo formato en web y escritorio) ---------- */
function pbSerialize() { const c = OP.cloud, n = c.xyz.length / 3, step = n > PB_MAXP ? n / PB_MAXP : 1, m = Math.min(n, PB_MAXP), f = new Float32Array(3 * m);
  for (let j = 0; j < m; j++) { const i = Math.floor(j * step); f[3 * j] = c.xyz[3 * i]; f[3 * j + 1] = c.xyz[3 * i + 1]; f[3 * j + 2] = c.xyz[3 * i + 2]; }
  const K = pbCtxId(OP.id);
  return { obj: { formato: 'PuenteGemelo', version: 2, app: APP_VERSION, guardado: new Date().toISOString(), id: OP.id, nombre: OP.name,
    nube: { puntos: m, total: c.total, usados: c.kept, offset: c.offset, eje_tramo: c.eje || null, eje_vertical: OP.up || 'z', escala: OP.unit || 1, xyz_float32_base64: pbB64(new Uint8Array(f.buffer)) },
    estado: pbEstado(), expediente: PG.I[K] || null, mantenimiento: PG.det[K] || null, historia: PG.H[K] || null, calibracion: PG.cal[K] || null, linea_base: PG.bases[K] || null }, m, n }; }
async function pbExport(id) { if (id && id !== OP.id) { if (!(await pbActivate(id, { silent: true }))) return; }
  if (!OP.cloud || !OP.O) { toast('Este puente aún no tiene nube.'); return; }
  const { obj, m, n } = pbSerialize(), nombre = (OP.name || 'puente').replace(/\.[a-z0-9]+$/i, '').replace(/[^\wáéíóúñÁÉÍÓÚÑ -]+/g, '').trim() || 'puente';
  download(nombre + '.puente', 'application/json', JSON.stringify(obj, pbPlain));
  toast(m < n ? `Proyecto exportado con una muestra de ${m.toLocaleString('es-PE')} puntos de la nube.` : 'Proyecto exportado.'); if (S.view === 'puentes') render(); }
async function pbImportText(text) {
  try { const P = JSON.parse(text); if (P.formato !== 'PuenteGemelo') throw new Error('el archivo no es un proyecto de PuenteGemelo');
    const u8 = pbUnB64(P.nube.xyz_float32_base64), xyz = new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4);
    if (OP.id) await pbSaveNow();
    pbResetOP(); Object.assign(OP, P.estado); OP.id = P.id && !pbMeta(P.id) ? P.id : pbNewId(); OP.name = P.nombre || OP.name;
    OP.cloud = { xyz: Float32Array.from(xyz), total: P.nube.total, kept: P.nube.usados, offset: P.nube.offset, eje: P.nube.eje_tramo || undefined }; OP.up = P.nube.eje_vertical; OP.unit = P.nube.escala; pbRebuild();
    const K = pbCtxId(OP.id), old = 'tu:' + (P.nombre || 'sin nombre');
    if (P.expediente) { PG.I[K] = P.expediente; pgSave(); } if (P.mantenimiento) PG.det[K] = P.mantenimiento;
    if (P.historia) { PG.H[K] = P.historia; PG_DB.set('hist', PG.H); } if (P.calibracion) { PG.cal[K] = P.calibracion; pgSaveCal(); }
    if (P.linea_base) { PG.bases[K] = Object.assign({}, P.linea_base, { ctx: K }); PG_DB.set('bases', PG.bases); }
    void old; PB.active = OP.id; pbLsSet('pg_activo', OP.id); await pbSaveCloud(); await pbSaveNow();
    toast(`Proyecto «${OP.name}» abierto y guardado en «Mis puentes».`); show(OP.modes ? 'estado' : 'tupuente'); return true;
  } catch (e) { toast('No se pudo abrir el proyecto: ' + e.message); return false; } }
function pbImportDialog() { let i = document.getElementById('pbImp');
  if (!i) { i = document.createElement('input'); i.type = 'file'; i.id = 'pbImp'; i.accept = '.puente,.json'; i.hidden = true; document.body.append(i);
    i.onchange = async () => { const f = i.files[0]; if (f) await pbImportText(await f.text()); i.value = ''; }; }
  i.click(); }

/* ---------- selector del puente activo (cabecera y paneles) ---------- */
function pbOptions() { const L = PB.list.slice().sort((a, b) => (b.actualizado || '').localeCompare(a.actualizado || ''));
  const cur = PB.active !== 'balta' && !pbMeta(PB.active) ? `<option value="${PB.active}" selected>${esc(OP.name || 'Puente nuevo')} (sin guardar)</option>` : '';
  return `<option value="balta" ${PB.active === 'balta' ? 'selected' : ''}>Puente Balta (ejemplo)</option>${L.map(b => `<option value="${b.id}" ${b.id === PB.active ? 'selected' : ''}>${esc(b.nombre)}${(b.id === PB.active && typeof OP !== 'undefined' && OP.id === b.id ? !OP.model : b.resumen && !b.resumen.modelo) ? ' · sin modelo' : ''}</option>`).join('')}${cur}<option value="__nuevo">+ Agregar un puente…</option><option value="__lista">Ver todos mis puentes…</option>`; }
function pbSelect(id) { return `<select id="${id}" aria-label="Puente activo">${pbOptions()}</select>`; }
function pbBindSelect(id) { const s = document.getElementById(id); if (!s) return; s.onchange = e => { const v = e.target.value;
  if (v === '__nuevo') return pbNew(); if (v === '__lista') return show('puentes');
  // en las vistas exclusivas de un tipo de puente se pasa a la equivalente
  const go = BALTA_VIEWS.includes(S.view) && v !== 'balta' ? 'tupuente' : S.view === 'tupuente' && v === 'balta' ? 'modelo' : null; pbActivate(v, { go }); }; }
function pbHeader() { const mb = document.getElementById('markBridge'); if (!mb) return; mb.innerHTML = `<label class="hbr">Puente activo ${pbSelect('hdrBr')}</label>`; pbBindSelect('hdrBr'); }
function pbTitle() { return PB.active === 'balta' ? 'Puente Balta (ejemplo)' : (OP.name || 'Puente nuevo'); }

/* ---------- aviso cuando el puente activo aún no tiene modelo ---------- */
function pbNoModel(lab, soloNube) {
  const msg = soloNube ? `<b>Este puente aún no tiene nube de puntos.</b> Para usar ${lab} basta cargar su nube en <a href="#tupuente" id="pbGoTu">Gemelo digital → Nube, modelo e IA</a> (paso 1) y, si quiere la evidencia de la nube por elemento, identificar los elementos en el paso 2. El modelo (pasos 3 y 4) no hace falta para inspeccionar.`
    : `<b>Este puente aún no tiene modelo.</b> Para usar ${lab}, complete en <a href="#tupuente" id="pbGoTu">Gemelo digital → Nube, modelo e IA</a> los pasos 1 a 4 (nube, tablero y apoyos, geometría, modelo y modos).`;
  $('#left').innerHTML = ''; $('#canvas').innerHTML = `<div class="doc"><h2>${esc(pbTitle())}</h2><div class="msg warn">${msg} Todo se guarda en «Mis puentes».</div></div>`;
  const a = document.getElementById('pbGoTu'); if (a) a.onclick = e => { e.preventDefault(); show('tupuente'); };
  $('#right').innerHTML = ''; }

/* ---------- vista «Mis puentes» ---------- */
function pbChips(r) { const ch = (ok, l) => `<span class="flag ${ok ? 'ok' : ''}" style="font-size:.7rem">${ok ? '✓' : '·'} ${l}</span>`;
  return `${ch(r.nube, 'nube')} ${ch(r.modelo, 'modelo y modos')} ${ch(r.ia, 'IA entrenada')}`; }
function pbCard(b) { const r = b.resumen || {}, act = b.id === PB.active, K = pbCtxId(b.id), I = PG.I[K], H = PG.H[K] || [];
  const nIns = I && I.recs ? I.recs.length : 0, nMed = H.filter(e => e.tipo === 'medicion').length;
  const tipo = r.tipo ? OP_TYPES[r.tipo] : '', luz = r.vanos ? `${r.vanos} vano${r.vanos === 1 ? '' : 's'}, ${fmt(r.luzTotal, 1)} m` : '';
  const nm = PB.renaming === b.id ? `<input id="pbRenI" value="${esc(b.nombre)}" style="flex:1;min-width:140px"><button class="btn" data-renok="${b.id}">Guardar</button>` : `<b>${esc(b.nombre)}</b><button class="btn line" style="padding:1px 7px;font-size:.72rem" data-ren="${b.id}" title="Cambiar el nombre">Renombrar</button>`;
  return `<div class="pbc ${act ? 'act' : ''}"><div class="pbh">${nm}${act ? '<span class="flag ok" style="font-size:.7rem">activo</span>' : ''}</div>
    <div class="dim" style="font-size:.82rem">${[tipo, luz, r.f1 ? 'f₁ = ' + fmt(r.f1, 2) + ' Hz' : '', r.puntos ? r.puntos.toLocaleString('es-ES') + ' puntos' : ''].filter(Boolean).join(' · ')}</div>
    <div style="margin:6px 0">${pbChips(r)}</div>
    <div class="dim" style="font-size:.78rem">${nIns} ${nIns === 1 ? 'inspección' : 'inspecciones'} · ${nMed} ${nMed === 1 ? 'medición' : 'mediciones'} · actualizado ${b.actualizado ? new Date(b.actualizado).toLocaleDateString('es-PE') : '—'}</div>
    <div class="pba"><button class="btn ${act ? '' : 'pri'}" data-open="${b.id}">${act ? 'Continuar' : 'Abrir'}</button><button class="btn line" data-exp="${b.id}">Exportar .puente</button>
    ${PB.confirmDel === b.id ? `<button class="btn" style="background:var(--red);color:#fff" data-delok="${b.id}">Confirmar: eliminar</button><button class="btn line" data-delno="1">Cancelar</button>` : `<button class="btn line" data-del="${b.id}">Eliminar</button>`}</div></div>`; }
function vPuentes() {
  $('#left').innerHTML = `<div class="ph">Agregar</div><div class="pb" style="display:grid;gap:8px"><button class="btn pri" id="pbNew">Agregar un puente</button><button class="btn line" id="pbImp2">Abrir un archivo .puente</button>
    <p class="help keep">Los puentes se guardan en este ${window.desk ? 'equipo' : 'navegador'}. Para llevar un puente a otra computadora, use «Exportar .puente».</p></div>`;
  const L = PB.list.slice().sort((a, b) => (b.actualizado || '').localeCompare(a.actualizado || ''));
  const bal = PB.active === 'balta';
  $('#canvas').innerHTML = `<div class="doc"><h2>Mis puentes</h2>
    <p>Agregue un puente con su nube de puntos. La app arma su modelo y entrena una IA para él. Después puede inspeccionarlo, medir su vibración y planificar su mantenimiento.</p>
    <div class="pbg">${L.map(pbCard).join('') || `<div class="pbc"><b>Aún no hay puentes propios</b><p class="dim" style="font-size:.85rem">Pulse «Agregar un puente». Si aún no tiene una nube, puede probar con la muestra del Balta.</p><div class="pba"><button class="btn pri" data-new="1">Agregar un puente</button></div></div>`}</div>
    <h3>Proyecto de ejemplo</h3>
    <div class="pbg"><div class="pbc ${bal ? 'act' : ''}"><div class="pbh"><b>Puente Balta (ejemplo)</b><span class="flag" style="font-size:.7rem">ejemplo</span>${bal ? '<span class="flag ok" style="font-size:.7rem">activo</span>' : ''}</div>
      <div class="dim" style="font-size:.82rem">Arcos de fierro fundido sobre el río Rímac (Lima, 1871) · 3 arcos de unos 24,6 m</div>
      <p style="font-size:.85rem;margin:6px 0">Un puente ya estudiado a fondo, para ver cómo se usa la app antes de cargar el suyo. Incluye además el estudio de la primera parte de la tesis.</p>
      <div class="pba"><button class="btn ${bal ? '' : 'pri'}" data-open="balta">${bal ? 'Continuar' : 'Abrir el ejemplo'}</button></div></div></div></div>`;
  $('#right').innerHTML = `<div class="ph">Cómo se usa</div><div class="pb"><ol class="plain" style="padding-left:18px;margin:0;font-size:.86rem;display:grid;gap:6px"><li><b>Agregue el puente</b> con su nube de puntos. Se hace una sola vez.</li><li><b>Inspecciónelo</b> con la ficha del MTC y sus fotos.</li><li><b>Mida su vibración</b> con acelerómetros o el celular. La IA indica dónde mirar.</li><li><b>Revise el estado</b> y el plan de mantenimiento.</li></ol></div>`;
  const C = $('#canvas'), Lf = $('#left');
  [C, Lf].forEach(el => el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const id = b.dataset.open, m = id === 'balta' ? null : pbMeta(id); pbActivate(id, { go: id === 'balta' ? 'estado' : (m && m.resumen && m.resumen.modelo ? 'estado' : 'tupuente') }); }));
  C.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => pbExport(b.dataset.exp));
  C.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { PB.confirmDel = b.dataset.del; vPuentes(); });
  C.querySelectorAll('[data-delno]').forEach(b => b.onclick = () => { PB.confirmDel = null; vPuentes(); });
  C.querySelectorAll('[data-delok]').forEach(b => b.onclick = () => { PB.confirmDel = null; pbDelete(b.dataset.delok); });
  C.querySelectorAll('[data-new]').forEach(b => b.onclick = pbNew);
  C.querySelectorAll('[data-ren]').forEach(b => b.onclick = () => { PB.renaming = b.dataset.ren; vPuentes(); const i = $('#pbRenI'); if (i) { i.focus(); i.select(); i.onkeydown = e => { if (e.key === 'Enter') $('[data-renok]').click(); }; } });
  C.querySelectorAll('[data-renok]').forEach(b => b.onclick = () => pbRename(b.dataset.renok, $('#pbRenI').value));
  $('#pbNew').onclick = pbNew; $('#pbImp2').onclick = pbImportDialog; }

/* ---------- enganches con el flujo de la nube ---------- */
(function () {
  const st = document.createElement('style');
  st.textContent = '.pbg{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:12px;margin:10px 0 18px}.pbc{border:1px solid var(--rule);padding:12px 14px;background:var(--paper,#fff);display:grid;gap:2px;align-content:start}.pbc.act{border-color:var(--ink);box-shadow:inset 3px 0 0 var(--accent)}.pbh{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.pba{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.hbr{display:inline-flex;gap:6px;align-items:center;font-size:.8rem}.hbr select{max-width:240px;font-size:.8rem;padding:2px 4px}';
  document.head.appendChild(st);
  const _set = opSetCloud;
  opSetCloud = function (c, name, minPts) { if (!OP.id || PB.active !== OP.id) { OP.id = pbNewId(); PB.active = OP.id; pbLsSet('pg_activo', OP.id); }
    // misma nube en otro proyecto: no se borran los datos de inspección del anterior
    _set(c, name, minPts); pbSaveCloud().then(pbSaveNow); };
  const _ias = opIAShow; opIAShow = function () { const r = _ias.apply(this, arguments); pbAutosave(); return r; };
  // cualquier acción en el flujo de la nube (calcular modos, corregir apoyos…) guarda el proyecto
  document.addEventListener('click', () => { if (typeof S !== 'undefined' && S.view === 'tupuente') pbAutosave(); }, true);
  document.addEventListener('change', () => { if (typeof S !== 'undefined' && S.view === 'tupuente') pbAutosave(); }, true);
  const _vTu = vTu;
  vTu = function () { if (PB.active === 'balta') { pbNew(); return; } _vTu(); pbAutosave(); };
})();
async function pbInit() {
  PB.list = (await PG_DB.get('puentes')) || [];
  const a = pbLsGet('pg_activo');
  if (a && a !== 'balta' && pbMeta(a)) await pbActivate(a, { silent: true });
  PB.ready = true; }
