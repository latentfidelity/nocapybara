const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onMenuAction: (callback) => {
        ipcRenderer.on('menu-action', (event, action, data) => callback(action, data));
    },
    saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
    getConfig: () => ipcRenderer.invoke('get-config'),
    geminiRequest: (prompt) => ipcRenderer.invoke('gemini-request', prompt),
    isElectron: true
});
