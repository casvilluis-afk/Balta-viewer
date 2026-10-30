// PuenteGemelo · proceso principal de Electron
// La interfaz es la misma plataforma web (app/web), servida con el protocolo app:// para que funcione sin internet.
const { app, BrowserWindow, Menu, protocol, net, shell, dialog, ipcMain } = require('electron');
const path = require('path'), { pathToFileURL } = require('url'), fs = require('fs');

const WEB = path.join(__dirname, '..', 'web');
const REPO = 'https://github.com/casvilluis-afk/Balta-viewer';
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let win = null, pendingFile = null;
const send = (cmd, arg) => { if (win) win.webContents.send('menu', cmd, arg); };

function openProjectFile(file) {
  try { const text = fs.readFileSync(file, 'utf8'); if (win && win.webContents && !win.webContents.isLoading()) send('abrir-proyecto-texto', text); else pendingFile = text; }
  catch (e) { dialog.showErrorBox('PuenteGemelo', 'No se pudo leer el proyecto: ' + e.message); }
}
// Archivo .puente pasado al abrir (doble clic en Windows/Linux)
let argFile = process.argv.find(a => /\.puente$/i.test(a)) || null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600, backgroundColor: '#ffffff', title: 'PuenteGemelo',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadURL('app://local/index.html');
  // enlaces externos en el navegador del sistema
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.webContents.on('did-finish-load', () => { if (argFile) { const f = argFile; argFile = null; openProjectFile(f); } else if (pendingFile) { send('abrir-proyecto-texto', pendingFile); pendingFile = null; } });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const tpl = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'Archivo', submenu: [
      { label: 'Inicio', accelerator: 'CmdOrCtrl+H', click: () => send('inicio') },
      { label: 'Nuevo puente desde una nube de puntos', accelerator: 'CmdOrCtrl+N', click: () => send('nuevo') },
      { label: 'Abrir proyecto…', accelerator: 'CmdOrCtrl+O', click: async () => {
          const r = await dialog.showOpenDialog(win, { title: 'Abrir proyecto', filters: [{ name: 'Proyecto de PuenteGemelo', extensions: ['puente', 'json'] }], properties: ['openFile'] });
          if (!r.canceled && r.filePaths[0]) openProjectFile(r.filePaths[0]); } },
      { label: 'Guardar proyecto…', accelerator: 'CmdOrCtrl+S', click: () => send('guardar-proyecto') },
      { type: 'separator' },
      { label: 'Proyecto de ejemplo: Puente Balta', click: () => send('ejemplo') },
      { type: 'separator' },
      isMac ? { role: 'close', label: 'Cerrar ventana' } : { role: 'quit', label: 'Salir' } ] },
    { label: 'Editar', submenu: [{ role: 'undo', label: 'Deshacer' }, { role: 'redo', label: 'Rehacer' }, { type: 'separator' }, { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Pegar' }, { role: 'selectAll', label: 'Seleccionar todo' }] },
    { label: 'Ver', submenu: [
      { role: 'reload', label: 'Recargar' }, { type: 'separator' },
      { role: 'resetZoom', label: 'Tamaño real' }, { role: 'zoomIn', label: 'Acercar' }, { role: 'zoomOut', label: 'Alejar' }, { type: 'separator' },
      { role: 'togglefullscreen', label: 'Pantalla completa' }, { type: 'separator' }, { role: 'toggleDevTools', label: 'Herramientas de desarrollo' } ] },
    { label: 'Ayuda', submenu: [
      { label: 'Manual de uso (PDF)', click: () => { const f = path.join(WEB, 'docs', 'Manual_PuenteGemelo.pdf').replace('app.asar', 'app.asar.unpacked'); if (fs.existsSync(f)) shell.openPath(f); else shell.openExternal(REPO); } },
      { label: 'Código fuente y reportar un problema', click: () => shell.openExternal(REPO) },
      { type: 'separator' },
      { label: 'Acerca de PuenteGemelo', click: () => dialog.showMessageBox(win, { type: 'info', title: 'Acerca de PuenteGemelo', message: 'PuenteGemelo ' + app.getVersion(),
          detail: 'Gemelo digital e inspección de puentes con nubes de puntos e inteligencia artificial.\n\nLuis Ñuñuvero Castillo y Anthony Tarazona Cerna\nTesis: Implementación de una plataforma digital para la inspección de puentes históricos con inteligencia artificial — caso Puente Balta.\n\nCódigo: licencia MIT. Datos del Puente Balta: CC BY 4.0.\nHerramienta de apoyo a la inspección: no reemplaza la evaluación de un ingeniero.' }) } ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

// Una sola instancia: abrir un .puente con la app abierta lo carga en la ventana existente
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (e, argv) => { const f = argv.find(a => /\.puente$/i.test(a)); if (win) { if (win.isMinimized()) win.restore(); win.focus(); } if (f) openProjectFile(f); });
  app.on('open-file', (e, f) => { e.preventDefault(); if (win) openProjectFile(f); else pendingFile = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; });
  app.whenReady().then(() => {
    protocol.handle('app', req => {
      const u = new URL(req.url); let rel = decodeURIComponent(u.pathname); if (rel === '/' || !rel) rel = '/index.html';
      const file = path.normalize(path.join(WEB, rel)); if (!file.startsWith(WEB)) return new Response('No permitido', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });
    ipcMain.handle('version', () => app.getVersion());
    buildMenu(); createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
