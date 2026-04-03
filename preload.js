const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onMenuAction: (callback) => {
        ipcRenderer.on('menu-action', (event, action, data) => callback(action, data));
    },
    saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
    getConfig: () => ipcRenderer.invoke('get-config'),
    geminiRequest: (prompt, useGrounding = false, model = 'gemini-2.5-flash') => ipcRenderer.invoke('gemini-request', prompt, useGrounding, model),
    geminiStream: (prompt, useGrounding = false, model = 'gemini-2.5-flash') => ipcRenderer.invoke('gemini-stream', prompt, useGrounding, model),
    onStreamChunk: (callback) => ipcRenderer.on('gemini-stream-chunk', (e, text) => callback(text)),
    onStreamDone: (callback) => ipcRenderer.on('gemini-stream-done', () => callback()),
    onStreamError: (callback) => ipcRenderer.on('gemini-stream-error', (e, err) => callback(err)),
    removeStreamListeners: () => {
        ipcRenderer.removeAllListeners('gemini-stream-chunk');
        ipcRenderer.removeAllListeners('gemini-stream-done');
        ipcRenderer.removeAllListeners('gemini-stream-error');
    },
    isElectron: true
});
