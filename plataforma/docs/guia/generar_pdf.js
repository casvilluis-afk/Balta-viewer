// Genera Manual_PuenteGemelo.pdf a partir de guia.html (dos pasadas: la segunda escribe los números de página del índice). Uso: node generar_pdf.js (requiere playwright y pdftotext).
const { chromium } = require('playwright'); const { execSync } = require('child_process');
const OUT = require('path').join(__dirname, '..', 'Manual_PuenteGemelo.pdf');
const hdr = `<style>*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style><div style="width:100%;margin:0 20mm;font-family:Arial;font-size:7.5pt"><table style="width:100%;border-collapse:collapse"><tr>
<td style="border:1px solid #0b5cad;background:#0b5cad;color:#fff;padding:3px 6px;font-weight:bold;width:46%">MANUAL DE USUARIO – PuenteGemelo</td>
<td style="border:1px solid #0b5cad;padding:3px 6px;color:#0b5cad">Versión: 2.20.2</td><td style="border:1px solid #0b5cad;padding:3px 6px;color:#0b5cad">Fecha: 26/11/2026</td>
<td style="border:1px solid #0b5cad;padding:3px 6px;color:#0b5cad">Página <span class="pageNumber"></span> de <span class="totalPages"></span></td></tr></table></div>`;
const foot = `<style>*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style><div style="width:100%;margin:0 20mm;font-family:Arial;font-size:7pt;color:#5a6470;border-top:1.5px solid #0b5cad;padding-top:2px">Tesis UPC 2026 · Ñuñuvero Castillo y Tarazona Cerna · Plataforma digital para la inspección de puentes históricos con IA (caso Puente Balta)</div>`;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + require('path').join(__dirname, 'guia.html')); await p.waitForTimeout(800);
  const heads = await p.evaluate(() => [...document.querySelectorAll('h1[id],h2[id],h3[id]')].map(h => ({ id: h.id, t: h.textContent.trim(), l: +h.tagName[1] })));
  const fill = async pages => { await p.evaluate(({ heads, pages }) => { document.getElementById('indice').innerHTML = heads.map(h => `<div class="l${h.l}"><span>${h.t}</span><span class="d"></span><span>${pages[h.id] || '00'}</span></div>`).join(''); }, { heads, pages }); };
  const pdf = () => p.pdf({ path: OUT, format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: hdr, footerTemplate: foot, margin: { top: '27mm', bottom: '18mm', left: '20mm', right: '20mm' } });
  await fill({}); await pdf();
  const n = +execSync(`pdfinfo ${OUT} | grep Pages | awk '{print $2}'`).toString().trim(); const pages = {};
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const txt = []; for (let i = 1; i <= n; i++) txt.push(norm(execSync(`pdftotext -f ${i} -l ${i} -layout ${OUT} -`).toString()));
  for (const h of heads) { const t = norm(h.t); for (let i = 2; i < n; i++) { if (txt[i].includes(t) || txt[i].toUpperCase().includes(t.toUpperCase())) { pages[h.id] = i + 1; break; } } }
  await fill(pages); await pdf(); console.log(n, JSON.stringify(pages)); await b.close();
})();
