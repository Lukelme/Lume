'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Único ponto de contato entre a página e o Electron.
contextBridge.exposeInMainWorld('Lume', {
  platform: process.platform,
  // Pinta a área dos botões minimizar/maximizar/fechar com as cores da tela atual.
  setTitleBar: (color, symbolColor) => ipcRenderer.send('titlebar', { color, symbolColor }),
  // Recebe o PDF que o Windows mandou abrir (clique duplo, "Abrir com...").
  onOpenFile: (cb) => ipcRenderer.on('lume:open-file', (_e, f) => cb(f))
});