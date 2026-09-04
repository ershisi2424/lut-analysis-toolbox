'use strict';

const { app, BrowserWindow, session, shell } = require('electron');
const path = require('node:path');
const { isAllowedLocalPage } = require('./navigation');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#080808',
    autoHideMenuBar: true,
    title: 'LUT分析工具箱',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedLocalPage(url)) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
}

app.setAppUserModelId('cn.lut.analysis.toolbox');
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
