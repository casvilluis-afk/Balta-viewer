// Genera Manual_PuenteGemelo.pdf a partir de guia.html. La paginación (encabezados por capítulo,
// números de página del índice) la hace Paged.js (lib/). Uso: node generar_pdf.js (requiere playwright).
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file://' + path.join(__dirname, 'guia.html'));
  await p.waitForFunction(() => window.__listo === true, null, { timeout: 120000 }); await p.waitForTimeout(500);
  const n = await p.evaluate(() => document.querySelectorAll('.pagedjs_page').length);
  await p.pdf({ path: path.join(__dirname, '..', 'Manual_PuenteGemelo.pdf'), preferCSSPageSize: true, printBackground: true });
  console.log('páginas', n); await b.close();
})();
