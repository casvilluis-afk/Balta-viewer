// Puente seguro entre la interfaz y el proceso principal (sin acceso a Node desde la página)
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desk', {
  onMenu: cb => ipcRenderer.on('menu', (e, cmd, arg) => cb(cmd, arg)),
  version: () => ipcRenderer.invoke('version'),
  platform: process.platform
});
