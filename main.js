const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Load local config
let config = {};
try {
    const configPath = path.join(__dirname, 'config.local.json');
    if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
} catch (e) { console.warn('No config.local.json found'); }

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        backgroundColor: '#111111',
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 18 },
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        show: false,
        icon: path.join(__dirname, 'icon.png')
    });

    mainWindow.loadFile('index.html');

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Build menu
    const template = [
        {
            label: 'Reflect',
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Model',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => mainWindow.webContents.send('menu-action', 'new')
                },
                {
                    label: 'Save',
                    accelerator: 'CmdOrCtrl+S',
                    click: () => mainWindow.webContents.send('menu-action', 'save')
                },
                { type: 'separator' },
                {
                    label: 'Export as JSON...',
                    accelerator: 'CmdOrCtrl+Shift+E',
                    click: () => mainWindow.webContents.send('menu-action', 'export')
                },
                {
                    label: 'Import JSON...',
                    accelerator: 'CmdOrCtrl+Shift+I',
                    click: () => mainWindow.webContents.send('menu-action', 'import')
                },
                { type: 'separator' },
                {
                    label: 'Save to File...',
                    accelerator: 'CmdOrCtrl+Shift+S',
                    click: async () => {
                        const result = await dialog.showSaveDialog(mainWindow, {
                            defaultPath: 'nexus-model.json',
                            filters: [{ name: 'JSON', extensions: ['json'] }]
                        });
                        if (!result.canceled && result.filePath) {
                            mainWindow.webContents.send('menu-action', 'save-to-file', result.filePath);
                        }
                    }
                },
                {
                    label: 'Open File...',
                    accelerator: 'CmdOrCtrl+O',
                    click: async () => {
                        const result = await dialog.showOpenDialog(mainWindow, {
                            filters: [{ name: 'JSON', extensions: ['json'] }],
                            properties: ['openFile']
                        });
                        if (!result.canceled && result.filePaths.length > 0) {
                            const data = fs.readFileSync(result.filePaths[0], 'utf-8');
                            mainWindow.webContents.send('menu-action', 'open-file', data);
                        }
                    }
                }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { type: 'separator' },
                {
                    label: 'Fit to View',
                    accelerator: 'CmdOrCtrl+0',
                    click: () => mainWindow.webContents.send('menu-action', 'fit-view')
                },
                {
                    label: 'Zoom In',
                    accelerator: 'CmdOrCtrl+=',
                    click: () => mainWindow.webContents.send('menu-action', 'zoom-in')
                },
                {
                    label: 'Zoom Out',
                    accelerator: 'CmdOrCtrl+-',
                    click: () => mainWindow.webContents.send('menu-action', 'zoom-out')
                },
                { type: 'separator' },
                { role: 'togglefullscreen' },
                { type: 'separator' },
                { role: 'toggleDevTools' }
            ]
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'close' }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// IPC for saving files from renderer
ipcMain.handle('save-file', async (event, filePath, content) => {
    try {
        fs.writeFileSync(filePath, content, 'utf-8');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// IPC for getting config
ipcMain.handle('get-config', () => config);

// IPC for Gemini API calls (proxied through main process)
ipcMain.handle('gemini-request', async (event, prompt, useGrounding = false, model = 'gemini-2.5-flash') => {
    const apiKey = config.gemini_api_key;
    if (!apiKey) return { error: 'No Gemini API key configured' };

    try {
        const body = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 2048
            }
        };

        if (useGrounding) {
            body.tools = [{ google_search: {} }];
        }

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }
        );
        const data = await response.json();
        if (data.candidates && data.candidates[0]) {
            const candidate = data.candidates[0];
            const text = candidate.content.parts[0].text;
            const groundingMeta = candidate.groundingMetadata;
            return { text, groundingMeta };
        }
        return { error: data.error?.message || 'No response from Gemini' };
    } catch (err) {
        return { error: err.message };
    }
});

// Streaming Gemini API
ipcMain.handle('gemini-stream', async (event, prompt, useGrounding = false, model = 'gemini-2.5-flash') => {
    const apiKey = config.gemini_api_key;
    if (!apiKey) { event.sender.send('gemini-stream-error', 'No API key'); return; }

    try {
        const body = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 2048 }
        };
        if (useGrounding) {
            body.tools = [{ google_search: {} }];
        }

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }
        );

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6).trim();
                    if (!jsonStr) continue;
                    try {
                        const chunk = JSON.parse(jsonStr);
                        if (chunk.candidates && chunk.candidates[0]?.content?.parts?.[0]?.text) {
                            event.sender.send('gemini-stream-chunk', chunk.candidates[0].content.parts[0].text);
                        }
                    } catch (e) { /* partial JSON, skip */ }
                }
            }
        }

        event.sender.send('gemini-stream-done');
    } catch (err) {
        event.sender.send('gemini-stream-error', err.message);
    }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
