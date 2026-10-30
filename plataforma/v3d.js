/* ============================================================
   Vista 3D a pantalla completa
   Proyecta los resultados de los modelos (esfuerzos, deformadas, modos, zonas de la IA)
   sobre el modelo 3D del puente. Cada vértice del .glb se asocia, por familia y por su
   coordenada longitudinal s, a los nodos y elementos del modelo de cálculo.
   Ejes del mundo: z = s (longitudinal, mismo eje que los modelos), y = cota vertical.
   ============================================================ */
"use strict";
const V3D = (() => {
  let E = null, loading = null, raf = 0, spec = null, t0 = 0, playing = true, amp = 1;
  const famOf = n => /^ARCOS_vano_\d_montante/.test(n) ? 'montante' : /^ARCOS_/.test(n) ? 'arco' : /^(TABLERO|VIGAS)_/.test(n) ? 'tablero' : /^PILAR_/.test(n) ? 'pilar' : null;
  const archOf = n => { const m = n.match(/^ARCOS_vano_(\d)/); return m ? +m[1] - 1 : -1; };
  const ready3 = () => new Promise((res, rej) => { if (window.BaltaThree) return res(window.BaltaThree); window.addEventListener('three-ready', () => res(window.BaltaThree), { once: true }); setTimeout(() => rej(new Error('No se pudo cargar la librería 3D.')), 15000); });

  async function engine(onProg) {
    if (E) return E; if (loading) return loading;
    loading = (async () => {
      const { THREE, GLTFLoader, OrbitControls } = await ready3();
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, .1, 3000);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9399, 1.1)); const dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(60, 90, -30); scene.add(dl); const dl2 = new THREE.DirectionalLight(0xffffff, .5); dl2.position.set(-50, 20, 80); scene.add(dl2);
      const ctl = new OrbitControls(cam, renderer.domElement); ctl.enableDamping = true;
      const g = await new Promise((res, rej) => new GLTFLoader().load(MODEL_URL, res, ev => { if (onProg && ev.total) onProg(ev.loaded / ev.total); }, () => rej(new Error('No se pudo cargar el modelo 3D.'))));
      const root = g.scene; root.rotation.z = Math.PI; scene.add(root); root.updateMatrixWorld(true);
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .8, metalness: .02 });
      const meshes = [], v = new THREE.Vector3();
      root.traverse(o => { if (!o.isMesh) return; const f = famOf(o.name); if (!f || /^PUSH_/.test(o.name)) { o.visible = false; return; }
        const geo = o.geometry = o.geometry.clone(), pos = geo.attributes.position, n = pos.count, s = new Float32Array(n), h = new Float32Array(n);
        for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); s[i] = v.z; h[i] = v.y; }
        let hmin = Infinity, hmax = -Infinity; for (let i = 0; i < n; i++) { if (h[i] < hmin) hmin = h[i]; if (h[i] > hmax) hmax = h[i]; }
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(3 * n).fill(.6), 3));
        const inv = new THREE.Matrix3().setFromMatrix4(o.matrixWorld).invert();
        o.material = mat; meshes.push({ o, name: o.name, fam: f, arch: archOf(o.name), s, h, hmin, hmax, base: Float32Array.from(pos.array), inv, disp: null });
      });
      const box = new THREE.Box3(); meshes.forEach(m => box.expandByObject(m.o)); const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
      ctl.target.copy(c); cam.position.set(c.x + sz.z * .46, c.y - sz.y * .12, c.z - sz.z * .30); ctl.target.y = c.y - sz.y * .1; cam.far = sz.z * 12; cam.updateProjectionMatrix();
      E = { THREE, renderer, scene, cam, ctl, meshes, home: { p: cam.position.clone(), t: ctl.target.clone(), L: sz.z } }; return E;
    })();
    try { return await loading; } catch (e) { loading = null; throw e; }
  }

  /* ---------- adaptadores de modelos ---------- */
  // Modelo 2D anterior (M2) y modelo C (fr de mcBuild) → listas comunes por familia
  function adaptM2(M) {
    const archNames = ['arco_A1_A2', 'arco_A2_A3', 'arco_A3_A4'], nodesArch = archNames.map(() => new Set());
    M.els.forEach(e => { const k = archNames.indexOf(e.group); if (k >= 0) { nodesArch[k].add(e.ii); nodesArch[k].add(e.jj); } });
    const S = i => M.nodes[i].x;
    return { S, deck: M.nodes.map((n, i) => n.deck ? i : -1).filter(i => i >= 0).sort((a, b) => S(a) - S(b)), arches: nodesArch.map(st => [...st].sort((a, b) => S(a) - S(b))),
      elems: M.els.map((e, t) => ({ t, fam: e.fam === 'otro' ? 'pilar' : e.fam, k: archNames.indexOf(e.group), m: (S(e.ii) + S(e.jj)) / 2 })) };
  }
  function adaptMC(fr) {
    const S = i => fr.nodes[i][0], K = { izq: 0, centro: 1, der: 2 };
    return { S, deck: fr.ydeck.map(y => fr.deckN[y]), arches: fr.arches.map(a => a.ids.slice()),
      elems: fr.grp.map((g, t) => { const [i, j] = fr.el[t], f = g.startsWith('arco') ? 'arco' : g.startsWith('montante') ? 'montante' : g.startsWith('pilar') ? 'pilar' : 'tablero'; return { t, fam: f, k: f === 'arco' ? K[g.split('_')[1]] : -1, m: (S(i) + S(j)) / 2 }; }) };
  }
  // interpolación lineal sobre una lista de nodos ordenada por s
  function interp(list, S, s, val) {
    if (!list.length) return [0, 0]; let lo = 0, hi = list.length - 1;
    if (s <= S(list[0])) return val(list[0]); if (s >= S(list[hi])) return val(list[hi]);
    while (hi - lo > 1) { const md = (lo + hi) >> 1; if (S(list[md]) <= s) lo = md; else hi = md; }
    const a = val(list[lo]), b = val(list[hi]), w = (s - S(list[lo])) / (S(list[hi]) - S(list[lo]) || 1); return [a[0] + w * (b[0] - a[0]), a[1] + w * (b[1] - a[1])];
  }
  // desplazamiento en el mundo (ds, dh) para cada vértice a partir de un vector U (3 gdl por nodo: ux=s, uz=vertical)
  function dispField(A, U) {
    const val = i => [U[3 * i], U[3 * i + 1]];
    return m => { const n = m.s.length, D = new Float32Array(2 * n);
      for (let i = 0; i < n; i++) { const s = m.s[i]; let d;
        if (m.fam === 'tablero') d = interp(A.deck, A.S, s, val);
        else if (m.fam === 'arco' && A.arches[m.arch]) d = interp(A.arches[m.arch], A.S, s, val);
        else if (m.fam === 'montante' && A.arches[m.arch]) { const a = interp(A.arches[m.arch], A.S, s, val), b = interp(A.deck, A.S, s, val), w = (m.h[i] - m.hmin) / ((m.hmax - m.hmin) || 1); d = [a[0] + w * (b[0] - a[0]), a[1] + w * (b[1] - a[1])]; }
        else d = [0, 0];
        D[2 * i] = d[0]; D[2 * i + 1] = d[1]; }
      return D; };
  }
  // elemento del modelo más cercano a un vértice dentro de su familia (y arco)
  function elemLookup(A) {
    const groups = {}; A.elems.forEach(e => { const key = e.fam === 'arco' ? 'arco' + e.k : e.fam; (groups[key] = groups[key] || []).push(e); });
    Object.values(groups).forEach(g => g.sort((a, b) => a.m - b.m));
    return (m, i) => { const g = groups[m.fam === 'arco' ? 'arco' + m.arch : m.fam]; if (!g) return -1; const s = m.s[i]; let lo = 0, hi = g.length - 1;
      while (hi - lo > 1) { const md = (lo + hi) >> 1; if (g[md].m <= s) lo = md; else hi = md; } return (Math.abs(g[lo].m - s) <= Math.abs(g[hi].m - s) ? g[lo] : g[hi]).t; };
  }

  /* ---------- colores ---------- */
  const rgb = c => { const x = hex(c); return [x[0] / 255, x[1] / 255, x[2] / 255]; };
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  function diverging(lim) { const lo = rgb(css('--blue')), mid = [.78, .8, .82], hi = rgb(css('--red')); return v => { const x = Math.max(-1, Math.min(1, v / lim)); return x >= 0 ? lerp(mid, hi, x) : lerp(mid, lo, -x); }; }
  function sequential() { const a = [.82, .84, .86], b = rgb(css('--warn')), c = rgb(css('--red')); return v => { const x = Math.max(0, Math.min(1, v)); return x < .5 ? lerp(a, b, 2 * x) : lerp(b, c, 2 * x - 2 * .5); }; }
  const famBase = () => ({ arco: rgb(css('--m-arco')), tablero: rgb(css('--m-tablero')), pilar: rgb(css('--m-pilar')), montante: rgb(css('--m-montante')) });

  /* ---------- superposición ---------- */
  function overlay() {
    let ov = document.getElementById('v3d'); if (ov) return ov;
    ov = document.createElement('div'); ov.id = 'v3d'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Vista 3D'); ov.hidden = true;
    ov.innerHTML = `<div class="v3d-bar"><div class="v3d-t"><b id="v3dTitle"></b><span id="v3dSub" class="dim"></span></div>
      <div class="v3d-c"><span id="v3dAnim"><button class="btn line" id="v3dPlay">Pausar</button><span id="v3dTime" class="mono" style="align-self:center;min-width:64px"></span><label class="f" style="width:190px"><span class="lv">Desplazamiento dibujado <output id="v3dAo"></output></span><input type="range" id="v3dAmp" min="0" max="5" step="0.1"></label></span>
      <button class="btn line" id="v3dCtlB" hidden aria-expanded="true">Parámetros</button><button class="btn line" id="v3dHome">Vista inicial</button><button class="btn" id="v3dClose">Cerrar · Esc</button></div></div>
      <div class="v3d-stage" id="v3dStage"><div class="v3d-st" id="v3dSt">Cargando modelo 3D…</div><div class="v3d-ctl" id="v3dCtl" hidden></div></div><div class="v3d-leg" id="v3dLeg"></div>`;
    document.body.append(ov);
    ov.querySelector('#v3dClose').onclick = close; ov.querySelector('#v3dCtlB').onclick = e => { const p = document.getElementById('v3dCtl'), sh = p.hidden; p.hidden = !sh; e.target.setAttribute('aria-expanded', sh); }; ov.querySelector('#v3dHome').onclick = fitHome;
    ov.querySelector('#v3dPlay').onclick = e => { playing = !playing; e.target.textContent = playing ? 'Pausar' : 'Animar'; };
    ov.querySelector('#v3dAmp').oninput = e => { amp = +e.target.value; upAmp(); };
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !ov.hidden) close(); });
    new ResizeObserver(resize).observe(ov.querySelector('#v3dStage'));
    return ov;
  }
  let realMax = 0; function upAmp() { const o = document.getElementById('v3dAo'); if (o) o.textContent = fmt(amp, 1) + ' m' + (realMax ? ` (×${Math.round(amp / realMax)})` : ''); }
  // vista inicial: misma dirección, distancia para que todo el puente quepa en el ancho de la pantalla
  function fitHome() { if (!E) return; const { cam, ctl, home } = E, dir = home.p.clone().sub(home.t).normalize(), vf = cam.fov * Math.PI / 360, hf = Math.atan(Math.tan(vf) * cam.aspect);
    const d = Math.max(home.L * .5 * 1.04 / Math.tan(hf), home.L * .16 / Math.tan(vf)); ctl.target.copy(home.t); cam.position.copy(home.t).addScaledVector(dir, d * .92); ctl.update(); }
  // acerca la cámara a la zona resaltada (misma dirección de vista)
  function focusOn(sc, hc, size) { if (!E) return; const { cam, ctl, home } = E, dir = home.p.clone().sub(home.t).normalize(), vf = cam.fov * Math.PI / 360, hf = Math.atan(Math.tan(vf) * cam.aspect);
    const d = Math.max(size * .5 * 1.6 / Math.tan(hf), 28); ctl.target.set(home.t.x, hc, sc); cam.position.copy(ctl.target).addScaledVector(dir, d); ctl.update(); }
  function resize() { if (!E) return; const st = document.getElementById('v3dStage'); if (!st || !st.clientWidth) return; E.renderer.setSize(st.clientWidth, st.clientHeight, false); E.cam.aspect = st.clientWidth / st.clientHeight; E.cam.updateProjectionMatrix(); }
  function close() { const ov = document.getElementById('v3d'); if (ov) ov.hidden = true; cancelAnimationFrame(raf); raf = 0; document.body.style.overflow = ''; if (spec && spec.onClose) spec.onClose(); spec = null; }

  // spec: { title, sub, colorAt(m,i)→[r,g,b]|null, disp: (m)→Float32Array(2n)|null (unidades del modelo, se multiplica por amp), ampDefault, animate, legend: html }
  async function open(sp) {
    const ov = overlay(), wasOpen = !ov.hidden && !!spec, prevKey = spec && spec.controls && spec.controls.key; spec = sp; ov.hidden = false; document.body.style.overflow = 'hidden';
    // panel de parámetros: se construye una sola vez por vista para no interrumpir un deslizador en uso
    const pc = document.getElementById('v3dCtl'), pb = document.getElementById('v3dCtlB');
    if (!sp.controls) { pc.hidden = true; pc.innerHTML = ''; pb.hidden = true; }
    else if (!wasOpen || sp.controls.key !== prevKey) { pc.innerHTML = '<div class="v3d-ph">Parámetros · el puente se actualiza al cambiarlos</div>' + sp.controls.html; pc.hidden = false; pb.hidden = false; pb.setAttribute('aria-expanded', 'true'); sp.controls.bind(pc); }
    document.getElementById('v3dTitle').textContent = sp.title; document.getElementById('v3dSub').textContent = sp.sub || ''; document.getElementById('v3dLeg').innerHTML = sp.legend || '';
    const hasDisp = !!sp.disp || !!sp.series; document.getElementById('v3dAnim').hidden = !hasDisp; playing = sp.animate !== false; document.getElementById('v3dPlay').textContent = playing ? 'Pausar' : 'Animar';
    if (!wasOpen) { amp = sp.ampDefault || 1.5; document.getElementById('v3dAmp').value = amp; } realMax = 0;
    let eng; try { eng = await engine(q => { const s = document.getElementById('v3dSt'); if (s) s.textContent = `Cargando modelo 3D… ${Math.round(100 * q)} %`; }); }
    catch (e) { document.getElementById('v3dSt').textContent = e.message; return; }
    if (spec !== sp) return;
    const stg = document.getElementById('v3dStage'), st = document.getElementById('v3dSt'); if (st) st.remove(); if (eng.renderer.domElement.parentNode !== stg) stg.prepend(eng.renderer.domElement); resize(); if (!wasOpen) fitHome();
    const base = famBase();
    eng.meshes.forEach(m => { m.ser = sp.series ? sp.series.fields.map(fn => fn(m)) : null; m.disp = sp.disp ? sp.disp(m) : null; if (!hasDisp) { m.o.geometry.attributes.position.array.set(m.base); m.o.geometry.attributes.position.needsUpdate = true; m.o.geometry.computeVertexNormals(); } });
    if (sp.series) realMax = sp.series.peak; if (sp.disp) { let mx = 0; eng.meshes.forEach(m => { const D = m.disp; for (let i = 0; i < D.length; i += 2) mx = Math.max(mx, Math.hypot(D[i], D[i + 1])); });
      if (mx > 0) eng.meshes.forEach(m => { const D = m.disp; for (let i = 0; i < D.length; i++) D[i] /= mx; }); realMax = sp.physical ? mx : 0; }
    let f0 = Infinity, f1 = -Infinity, g0 = Infinity, g1 = -Infinity;
    eng.meshes.forEach(m => { const col = m.o.geometry.attributes.color, n = m.s.length;
      for (let i = 0; i < n; i++) { const hc = sp.colorAt && sp.colorAt(m, i), c = hc || base[m.fam];
        if (hc && sp.focus) { if (m.s[i] < f0) f0 = m.s[i]; if (m.s[i] > f1) f1 = m.s[i]; if (m.h[i] < g0) g0 = m.h[i]; if (m.h[i] > g1) g1 = m.h[i]; } col.array[3 * i] = c[0]; col.array[3 * i + 1] = c[1]; col.array[3 * i + 2] = c[2]; }
      col.needsUpdate = true; });
    if (sp.focus && f1 > f0 && (!wasOpen || sp.refocus)) focusOn((f0 + f1) / 2, (g0 + g1) / 2, Math.max(f1 - f0, g1 - g0));
    upAmp();
    t0 = performance.now(); cancelAnimationFrame(raf);
    const v = new eng.THREE.Vector3();
    let simT = 0, lastNow = 0; const tEl = document.getElementById('v3dTime'); if (tEl) tEl.textContent = '';
    const loop = () => { raf = requestAnimationFrame(loop); eng.ctl.update();
      if (sp.series) { const Sr = sp.series, now = performance.now(); if (playing) simT += Math.min(.1, (now - (lastNow || now)) / 1000); lastNow = now;
        const N = Sr.q[0].length, k = Math.floor(simT / Sr.dt) % N, qk = Sr.q.map(a => a[k]), M = qk.length, f = amp; if (tEl) tEl.textContent = 't = ' + fmt(k * Sr.dt, 1) + ' s';
        eng.meshes.forEach(m => { if (!m.ser) return; const pos = m.o.geometry.attributes.position, a = pos.array, b = m.base, e = m.inv.elements;
          for (let i = 0; i < m.s.length; i++) { let dz = 0, dy = 0; for (let j = 0; j < M; j++) { const F = m.ser[j]; dz += qk[j] * F[2 * i]; dy += qk[j] * F[2 * i + 1]; } dz *= f; dy *= f;
            a[3 * i] = b[3 * i] + e[3] * dy + e[6] * dz; a[3 * i + 1] = b[3 * i + 1] + e[4] * dy + e[7] * dz; a[3 * i + 2] = b[3 * i + 2] + e[5] * dy + e[8] * dz; }
          pos.needsUpdate = true; }); }
      else if (hasDisp) { const k = playing ? (sp.animate === 'static' ? 1 : Math.sin(2 * Math.PI * (performance.now() - t0) / 1000 * .6)) : (sp.animate === 'static' ? 1 : 1); const f = amp * k;
        eng.meshes.forEach(m => { if (!m.disp) return; const pos = m.o.geometry.attributes.position, a = pos.array, b = m.base, D = m.disp, e = m.inv.elements;
          for (let i = 0; i < m.s.length; i++) { const dz = D[2 * i] * f, dy = D[2 * i + 1] * f; // mundo (0, dy, dz) → local con la inversa de la rotación
            a[3 * i] = b[3 * i] + e[3] * dy + e[6] * dz; a[3 * i + 1] = b[3 * i + 1] + e[4] * dy + e[7] * dz; a[3 * i + 2] = b[3 * i + 2] + e[5] * dy + e[8] * dz; }
          pos.needsUpdate = true; m.o.geometry.computeVertexNormals(); }); }
      eng.renderer.render(eng.scene, eng.cam); };
    loop();
  }
  function legendGradient(stops, labels) { return `<div class="v3d-grad"><i style="background:linear-gradient(90deg,${stops.join(',')})"></i><div>${labels.map(l => `<span>${l}</span>`).join('')}</div></div>`; }
  function legendCats(items) { return `<div class="legend">${items.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>`; }
  return { info: () => E ? { meshes: E.meshes.length, verts: E.meshes.reduce((a, m) => a + m.s.length, 0) } : null, open, close, adaptM2, adaptMC, dispField, elemLookup, diverging, sequential, rgb, legendGradient, legendCats };
})();
