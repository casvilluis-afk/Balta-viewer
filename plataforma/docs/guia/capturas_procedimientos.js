const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const O = '/tmp/claude-0/guia/proc/'; const AD = '/home/claude/balta-viewer/app/ansys/salida/corrida_real_balta_full';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 1500 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.route('**/cdn.jsdelivr.net/npm/three@0.160.0/**', r => { const u = r.request().url().split('three@0.160.0/')[1]; r.fulfill({ path: '/tmp/claude-0/three/' + u, contentType: 'application/javascript' }); });
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(2000);
  const shot = async (name, items, opt = {}) => {
    const R = await p.evaluate(({ items, opt }) => {
      document.querySelectorAll('.__mk').forEach(e => e.remove());
      const get = s => { let e = document.querySelector(s.q); if (!e) return null; if (s.up) e = e.closest(s.up) || e; return e; };
      const first = get(items[0]); if (first && opt.scroll !== false) first.scrollIntoView({ block: opt.block || 'start' });
      const rs = [];
      for (const it of items) { const e = get(it); if (!e) { rs.push(null); continue; } const r = e.getBoundingClientRect(); rs.push([r.left, r.top, r.width, r.height]);
        const d = document.createElement('div'); d.className = '__mk'; d.style.cssText = `position:fixed;left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;border:2px dashed #d0021b;border-radius:3px;z-index:9999;pointer-events:none`;
        const c = document.createElement('div'); c.className = '__mk'; c.textContent = it.n; const L = it.pos === 'r' ? r.right + 2 : r.left - 4, T = r.top - 4;
        c.style.cssText = `position:fixed;left:${L - 12}px;top:${T - 12}px;width:24px;height:24px;border-radius:50%;background:#1d2329;color:#fff;font:700 13px/24px Arial;text-align:center;z-index:10000;box-shadow:0 0 0 2px #fff`;
        document.body.append(d, c); }
      return rs; }, { items, opt });
    const ok = R.filter(Boolean); if (!ok.length) { console.log('SIN', name); return; }
    let x0 = Math.min(...ok.map(r => r[0])), y0 = Math.min(...ok.map(r => r[1])), x1 = Math.max(...ok.map(r => r[0] + r[2])), y1 = Math.max(...ok.map(r => r[1] + r[3]));
    const pad = opt.pad || 40; let clip;
    if (opt.clip === 'win') clip = { x: 0, y: 0, width: 1280, height: opt.h || 820 };
    else if (opt.clip === 'canvas') { clip = { x: 262, y: Math.max(0, y0 - pad), width: 710, height: Math.min(1500, y1 + pad) - Math.max(0, y0 - pad) }; }
    else clip = { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad), width: Math.min(1280, x1 + pad) - Math.max(0, x0 - pad), height: Math.min(1500, y1 + pad) - Math.max(0, y0 - pad) };
    if (opt.minW && clip.width < opt.minW) { const c = clip.x + clip.width / 2; clip.x = Math.max(0, c - opt.minW / 2); clip.width = opt.minW; }
    await p.screenshot({ path: O + name + '.png', clip }); console.log('shot', name, R.map(r => r ? 'ok' : 'NO').join(','));
    await p.evaluate(() => document.querySelectorAll('.__mk').forEach(e => e.remove()));
  };
  // A · agregar puente y paso 1
  await p.evaluate(() => show('puentes')); await p.waitForTimeout(1200);
  await shot('a1', [{ q: '#pbNew', n: 1, pos: 'r' }], { clip: 'win', h: 560 });
  await p.evaluate(() => pbNew()); await p.waitForTimeout(800);
  await shot('a2', [{ q: '#opFile', up: 'label', n: 2 }, { q: '#opUp', n: 3 }, { q: '#opUnit', n: 4 }], { clip: 'canvas', pad: 60 });
  await p.setInputFiles('#opFile', '/tmp/claude-0/data/balta.ply');
  await p.waitForFunction(() => OP.cloud && document.querySelector('#opInfo').innerText.length > 50, null, { timeout: 180000 }); await p.waitForTimeout(800);
  await p.fill('#opName', 'Puente Balta'); await p.evaluate(() => { OP.name = 'Puente Balta'; }); await p.waitForTimeout(300);
  await shot('a3', [{ q: '#opName', n: 5 }, { q: '#opPlan', n: 6 }, { q: '#opNext', n: 7 }], { clip: 'canvas', pad: 30 });
  // B · paso 2
  await p.evaluate(() => { OP.step = 2; vTu(); }); await p.waitForTimeout(4000);
  await shot('b1', [{ q: '#opElev', n: 1 }, { q: '#opSupTbl', n: 2 }, { q: '#opRedetect', n: 3 }], { clip: 'canvas', pad: 30 });
  await shot('b2', [{ q: '#opElmGo', n: 4 }], { clip: 'canvas', pad: 140, block: 'center' });
  await p.click('#opElmGo'); await p.waitForTimeout(6000);
  await shot('b3', [{ q: '#opCnBtn', n: 5 }], { clip: 'canvas', pad: 160, block: 'center' });
  await p.click('#opCnBtn'); await p.waitForFunction(() => document.querySelector('#opCdet') && document.querySelector('#opCdet').innerText.length > 50, null, { timeout: 300000 }); await p.waitForTimeout(2000);
  await shot('b4', [{ q: '#opCdSel', n: 6 }, { q: '#opCdMap0', n: 7 }], { clip: 'canvas', pad: 30 });
  // C · paso 3
  await p.evaluate(() => { OP.step = 3; vTu(); }); await p.waitForTimeout(800); await p.click('#opGo'); await p.waitForTimeout(5000);
  await shot('c1', [{ q: '#opType', n: 1 }, { q: '#opGo', n: 2 }, { q: '#opGeoOut table', n: 3 }], { clip: 'canvas', pad: 30 });
  // D · paso 4
  await p.evaluate(() => { OP.step = 4; vTu(); }); await p.waitForTimeout(800);
  await shot('d1', [{ q: '#opMat', n: 1 }, { q: '#opPar', n: 2 }, { q: '#opRun', n: 3 }], { clip: 'canvas', pad: 30 });
  await p.click('#opRun'); await p.waitForFunction(() => OP.modes, null, { timeout: 120000 }); await p.waitForTimeout(1200);
  await shot('d2', [{ q: '#opModOut .toggle', n: 4 }, { q: '#opModOut table', n: 5 }, { q: '#opV3d', n: 6 }], { clip: 'canvas', pad: 30 });
  // E · Ansys
  await shot('e1', [{ q: '#opAnsys', n: 1 }, { q: '#opAnsysT', up: 'label', n: 2 }, { q: '#opAnsysIn', up: 'label', n: 3 }], { clip: 'canvas', pad: 40 });
  const fls = fs.readdirSync(AD).filter(f => f.endsWith('.txt')).map(f => path.join(AD, f)); await p.setInputFiles('#opAnsysIn', fls); await p.waitForTimeout(2000);
  await shot('e2', [{ q: '#opAnsysRes table', n: 4 }], { clip: 'canvas', pad: 30 });
  // F · paso 5
  await p.evaluate(() => { OP.step = 5; vTu(); }); await p.waitForTimeout(500); await p.click('#opTrain'); await p.waitForFunction(() => OP.ia && !OP.busy, null, { timeout: 600000 }); await p.waitForTimeout(1000);
  await shot('f1', [{ q: '#opTrain', n: 1 }, { q: '#opIAOut', n: 2 }], { clip: 'canvas', pad: 30 });
  // G · monitoreo
  await p.evaluate(() => show('oma')); await p.waitForTimeout(1500);
  await shot('g1', [{ q: '#omaFile', up: 'label', n: 1 }, { q: '#omaSyn', n: 2 }], { clip: 'canvas', pad: 40 });
  await p.click('#omaSyn').catch(e => console.log('omaSyn', e.message)); await p.waitForTimeout(2500);
  await shot('g2', [{ q: '#omaGo', n: 3 }], { clip: 'canvas', pad: 120, block: 'center' });
  await p.click('#omaGo').catch(e => console.log('omaGo', e.message)); await p.waitForTimeout(6000);
  await shot('g3', [{ q: '#omaOut', n: 4 }, { q: '#omaBase', n: 5 }, { q: '#omaIAgo', n: 6 }], { clip: 'canvas', pad: 30 });
  await p.click('#omaIAgo').catch(e => console.log('omaIAgo', e.message)); await p.waitForTimeout(6000);
  await shot('g4', [{ q: '#omaIA', n: 7 }], { clip: 'canvas', pad: 20 });
  // H · inspección
  await p.evaluate(() => show('inspmtc')); await p.waitForTimeout(1500);
  await shot('h1', [{ q: '#inNew', n: 1 }], { clip: 'win', h: 600 });
  await p.click('#inNew').catch(e => console.log('inNew', e.message)); await p.waitForTimeout(2000);
  await shot('h2', [{ q: '[data-ec]', n: 2 }, { q: '[data-cs]', n: 3 }, { q: '[data-adddef]', n: 4 }], { clip: 'canvas', pad: 40 });
  await shot('h3', [{ q: '#inRep', n: 5 }], { clip: 'win', h: 600 });
  await b.close();
})().catch(e => { console.log('FALLO', e.message); process.exit(1); });
